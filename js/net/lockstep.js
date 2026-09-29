// 局域网确定性锁步（无 DOM，Node 可用）：拦截本地玩家命令发往服务器，按服务器 tick 顺序执行所有玩家命令后 game.step(TICK)，定期上报状态哈希
import { TICK } from '../config.js';

// 允许通过网络执行的英雄命令（input / UI 会调用的全部命令）
export const CHAMP_COMMANDS = [
  'moveTo', 'attackUnit', 'attackMove', 'stop', 'castAbility', 'castSummoner', 'useItem', 'useTrinket',
  'levelUpAbility', 'startRecall', 'cancelRecall',
];
// 商店命令（以 'shop.' 前缀发送）
export const SHOP_COMMANDS = ['buy', 'sell', 'undo', 'autoShop'];
// 其他命令：surrender（投降投票，客户端发送）、leave（仅服务器在玩家断线时插入）
export const ALL_COMMANDS = [...CHAMP_COMMANDS, ...SHOP_COMMANDS.map((m) => `shop.${m}`), 'surrender'];
export const HASH_EVERY = 150;   // 每 150 tick（5 秒）上报一次状态哈希
const MAX_STEPS_PER_FRAME = 8;

// —— 参数序列化：单位引用 → { $e: id }，数字原样保留（JSON 对双精度往返无损） ——
export function serializeArg(v, depth = 0) {
  if (v == null) return null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? v : null;
  if (t === 'string' || t === 'boolean') return v;
  if (t !== 'object' || depth > 4) return null;
  if (Array.isArray(v)) return v.map((x) => serializeArg(x, depth + 1));
  if (typeof v.id === 'number' && typeof v.type === 'string') return { $e: v.id };
  const o = {};
  for (const k of Object.keys(v)) {
    if (typeof v[k] === 'function') continue;
    o[k] = serializeArg(v[k], depth + 1);
  }
  return o;
}
export function deserializeArg(v, game, depth = 0) {
  if (v == null || typeof v !== 'object' || depth > 4) return v ?? null;
  if (Array.isArray(v)) return v.map((x) => deserializeArg(x, game, depth + 1));
  if (typeof v.$e === 'number') return game.entities.get(v.$e) || null;
  const o = {};
  for (const k of Object.keys(v)) o[k] = deserializeArg(v[k], game, depth + 1);
  return o;
}

// 局域网 Config → Game 构造用的阵容：真人（带 humanId）标记 isPlayer，因而不会挂 AI
export function lanTeams(config) {
  const norm = (list) => (list || []).map((e) => ({ ...e, isPlayer: e.humanId != null }));
  return { blue: norm(config.blue), red: norm(config.red) };
}
// humanId → Champion（按队伍与栏位顺序对应 config 条目）
export function mapHumans(game, config) {
  const out = new Map();
  [config.blue || [], config.red || []].forEach((list, team) => {
    const champs = game.champions.filter((c) => c.team === team);
    list.forEach((e, i) => { if (e && e.humanId != null && champs[i]) out.set(e.humanId, champs[i]); });
  });
  return out;
}

// FNV-1a 32 位
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
// 状态哈希：时间/步数、随机数调用次数、单位数量、英雄坐标与生命（取整）、金币、等级、建筑生命
export function stateHash(game, rngCalls = 0) {
  let s = `${game.stepCount}|${Math.round(game.time * 30)}|${rngCalls}|${game.minions.length}|${game.monsters.length}|${game.projectiles.length}|${game.wards.length}|`;
  s += `${game.teams[0].kills}:${game.teams[1].kills}|`;
  for (const c of game.champions) s += `${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.hp)},${Math.floor(c.gold)},${c.level},${c.alive ? 1 : 0};`;
  for (const st of game.structures) s += `${Math.round(st.hp)},`;
  return fnv(s);
}

export class Lockstep {
  /**
   * @param {Game} game
   * @param {object} o
   * @param {number} o.localId      本机玩家 id
   * @param {Map} o.humans          humanId → Champion
   * @param {Function} o.send       (msg) => void，发给服务器
   * @param {Function} [o.createAI] 玩家断线后挂载 AI
   * @param {object} [o.shop]       js/items/shop.js 模块（执行商店命令）
   * @param {Function} [o.onNotice] (text, kind) => void，界面提示
   */
  constructor(game, { localId, humans, send, createAI = null, shop = null, difficulty = null, onNotice = null } = {}) {
    this.game = game;
    this.localId = localId;
    this.humans = humans || new Map();
    this.send = send || (() => {});
    this.createAI = createAI;
    this.shop = shop;
    this.difficulty = difficulty || game.difficulty || 'normal';
    this.onNotice = onNotice;
    this.queue = [];
    this.tick = 0;           // 已执行的最后一个 tick
    this.lastQueued = 0;
    this.acc = 0;
    this.capture = true;     // true：本地调用被拦截发往服务器；执行 tick 时为 false
    this.left = new Set();
    this.votes = [new Set(), new Set()];
    this.hashes = [];        // 最近上报的 [n, hash]（调试用）
    this.gapWarned = false;
    this.localChamp = this.humans.get(localId) || null;
    // 统计 game.rng() 调用次数（纳入状态哈希，不改变随机序列）
    this.rngCalls = 0;
    const orig = game._rng;
    if (typeof orig === 'function') game._rng = () => { this.rngCalls++; return orig(); };
  }

  get started() { return this.tick > 0; }
  get backlog() { return this.queue.length; }

  _sendCmd(c) { this.send({ type: 'cmd', c }); }

  // 包装本地玩家英雄的命令方法：本地调用 → 发送命令并返回 { ok: true, reason: 'queued' }
  wrapChampion(champ = this.localChamp) {
    if (!champ || champ._netWrapped) return champ;
    champ._netWrapped = true;
    for (const m of CHAMP_COMMANDS) {
      const orig = champ[m];
      if (typeof orig !== 'function') continue;
      champ[m] = (...args) => {
        if (!this.capture) return orig.apply(champ, args);
        // 可在本地安全判断（只读）的前置条件：避免界面误报成功
        if (m === 'levelUpAbility' && typeof champ.canLevelAbility === 'function' && !champ.canLevelAbility(args[0])) return false;
        if ((m === 'moveTo' || m === 'attackMove' || m === 'attackUnit') && !champ.alive) return false;
        this._sendCmd([m, ...args.map((a) => serializeArg(a))]);
        return { ok: true, reason: 'queued' };
      };
    }
    return champ;
  }

  // 传给 UI 的商店代理：只读函数原样转发，buy/sell/undo/autoShop 改为发送命令
  shopProxy(shopMod) {
    if (!shopMod) return shopMod;
    const px = Object.assign({}, shopMod);
    px.buy = (champ, id) => {
      if (!this.capture) return shopMod.buy(champ, id);
      let chk = null;
      try { chk = shopMod.canBuy?.(champ, id) || null; } catch { chk = null; }
      if (chk && !chk.ok) return chk;
      this._sendCmd(['shop.buy', String(id)]);
      return { ok: true, reason: 'queued', cost: chk?.cost };
    };
    px.sell = (champ, slot) => {
      if (!this.capture) return shopMod.sell(champ, slot);
      const it = champ?.items?.[slot];
      if (!it) return { ok: false, refund: 0, reason: '空栏位' };
      if (!champ.canShop) return { ok: false, refund: 0, reason: '不在泉水' };
      this._sendCmd(['shop.sell', slot | 0]);
      let refund = 0;
      try { refund = shopMod.sellValue?.(it) || 0; } catch { refund = 0; }
      return { ok: true, reason: 'queued', refund };
    };
    px.undo = (champ) => {
      if (!this.capture) return shopMod.undo(champ);
      let can = false;
      try { can = !!shopMod.canUndo?.(champ); } catch { can = false; }
      if (!can) return false;
      this._sendCmd(['shop.undo']);
      return true;
    };
    px.autoShop = (champ, ...rest) => {
      if (!this.capture) return shopMod.autoShop(champ, ...rest);
      if (!champ?.canShop) return [];
      this._sendCmd(['shop.autoShop']);
      return [];
    };
    return px;
  }

  requestSurrender() { this._sendCmd(['surrender']); }

  // —— 接收 tick ——
  pushTick(msg) {
    if (!msg || typeof msg.n !== 'number') return;
    if (msg.n <= this.lastQueued) return;   // 重复
    if (msg.n !== this.lastQueued + 1 && !this.gapWarned) {
      this.gapWarned = true;
      console.warn(`[局域网] tick 不连续：期望 ${this.lastQueued + 1}，收到 ${msg.n}`);
    }
    this.lastQueued = msg.n;
    this.queue.push(msg);
  }

  _notice(text, kind = 'info') { try { this.onNotice?.(text, kind); } catch { /* 忽略 */ } }

  _nameOf(champ) { return champ?.summonerName || champ?.displayName || champ?.def?.name || '玩家'; }

  _exec(pid, c) {
    if (!Array.isArray(c) || typeof c[0] !== 'string') return;
    const champ = this.humans.get(pid);
    if (!champ) return;
    const [m, ...raw] = c;
    const game = this.game;
    if (m === 'leave') {
      if (this.left.has(pid)) return;
      this.left.add(pid);
      for (const v of this.votes) v.delete(pid);
      if (!champ.controller && typeof this.createAI === 'function') {
        champ.controller = this.createAI(champ, game, { role: champ.role, difficulty: this.difficulty });
      }
      this._notice(`${this._nameOf(champ)} 已断开连接，由电脑接管`, 'leave');
      return;
    }
    if (this.left.has(pid)) return;
    if (m === 'surrender') {
      if (game.over) return;
      const team = champ.team;
      this.votes[team].add(pid);
      let active = 0;
      for (const [id, ch] of this.humans) if (ch.team === team && !this.left.has(id)) active++;
      const n = this.votes[team].size;
      if (n >= active) { this._notice(`${team === 0 ? '蓝色方' : '红色方'}投降`, 'surrender'); game.end(1 - team); }
      else this._notice(`${this._nameOf(champ)} 发起投降投票（${n}/${active}），在菜单中选择投降以同意`, 'vote');
      return;
    }
    const args = raw.map((a) => deserializeArg(a, game));
    try {
      if (CHAMP_COMMANDS.includes(m)) {
        if (typeof champ[m] === 'function') champ[m](...args);
      } else if (m.startsWith('shop.') && this.shop) {
        const fn = m.slice(5);
        if (!SHOP_COMMANDS.includes(fn) || typeof this.shop[fn] !== 'function') return;
        if (fn === 'autoShop') this.shop.autoShop(champ);
        else this.shop[fn](champ, ...args);
      }
    } catch (err) {
      // 所有客户端执行同样的命令会得到同样的异常，吞掉不影响一致性
      console.error(`[局域网] 执行命令 ${m} 出错：`, err);
    }
  }

  // 执行一个 tick：先执行命令，再推进一步
  runTick(t) {
    this.capture = false;
    try {
      for (const cmd of t.cmds || []) this._exec(cmd.pid, cmd.c);
      this.game.step(TICK);
    } finally {
      this.capture = true;
    }
    this.tick = t.n;
    if (t.n % HASH_EVERY === 0) {
      const h = stateHash(this.game, this.rngCalls);
      this.hashes.push([t.n, h]);
      if (this.hashes.length > 20) this.hashes.shift();
      this.send({ type: 'hash', n: t.n, h });
    }
  }

  // 执行所有已收到的 tick（测试用）
  drain() {
    let n = 0;
    while (this.queue.length) { this.runTick(this.queue.shift()); n++; }
    return n;
  }

  // 每帧：按真实时间消费 tick；积压时加速追赶（每帧最多约 8 个，积压很多时放宽）
  frame(realDt) {
    const dt = Math.max(0, Math.min(0.25, realDt || 0));
    const q = this.queue;
    if (!q.length) {
      this.acc = Math.min(this.acc + dt, TICK);
      this.game.alpha = Math.min(1, this.acc / TICK);
      return 0;
    }
    this.acc += dt;
    let want = Math.floor(this.acc / TICK);
    this.acc -= want * TICK;
    const backlog = q.length - want;
    if (backlog > 2) want += Math.ceil(backlog / 3);
    const cap = q.length > 90 ? MAX_STEPS_PER_FRAME * 4 : MAX_STEPS_PER_FRAME;
    const n = Math.min(want, cap, q.length);
    // 追赶时限制单帧耗时（至少执行 1 个 tick），避免页面卡死
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let done = 0;
    while (done < n) {
      this.runTick(q.shift());
      done++;
      if (done >= MAX_STEPS_PER_FRAME && t0 && performance.now() - t0 > 40) break;
    }
    if (!q.length) this.acc = Math.min(this.acc, TICK);
    this.game.alpha = Math.min(1, this.acc / TICK);
    return done;
  }
}
