// 英雄 AI 控制器：分层决策（宏观 1~1.4 秒 / 战术 thinkInterval / 微操每 tick，多个 AI 错开思考），
// 对线补刀、消耗换血、躲技能、塔下规则、撤退回城购物、打野与抓人、控龙男爵、抱团推进、团战与走砍；按难度分级，绝不抛异常
import { DIFFICULTY } from '../config.js';
import { getWorld, TURRET_RANGE } from './world.js';
import { getBrain } from './brain.js';
import { ShopPlanner, findPotionSlot } from './shopping.js';
import { Dodger } from './dodge.js';
import { AbilityMixin } from './abilities.js';
import { LaningMixin } from './laning.js';
import { JungleMixin } from './jungle.js';
import { ObjectiveMixin } from './objectives.js';
import { comboDamage, groupStrength, targetScore, threatDamage, autoDamage } from './combat.js';
import { mitigate } from '../core/damage.js';

const LANE_OF_ROLE = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot', jungle: null };
const HARD_CC = ['stun', 'charm', 'fear', 'taunt', 'sleep', 'root', 'suppress'];
const STASIS_RE = /zhonya|stopwatch|中娅|秒表/;

export function createAI(champ, game, { role, difficulty } = {}) {
  return new ChampionAI(champ, game, { role: role || champ.role || 'mid', difficulty: difficulty || game.difficulty || 'normal' });
}

// AI 运行统计（测试用）：异常数、英雄 custom 异常数、最近的异常信息
export function aiStats(game) {
  if (!game._aiStats) game._aiStats = { errors: 0, customErrors: 0, messages: [] };
  return game._aiStats;
}

export class ChampionAI {
  constructor(champ, game, { role = 'mid', difficulty = 'normal' } = {}) {
    this.champ = champ;
    this.game = game;
    this.role = role;
    this.difficulty = difficulty;
    this.params = { ...(DIFFICULTY[difficulty] || DIFFICULTY.normal) };
    this.mode = 'shopping';
    this.target = null;
    this.castContext = 'idle';
    this.lane = LANE_OF_ROLE[role] !== undefined ? LANE_OF_ROLE[role] : 'mid';
    this.world = getWorld(game);
    this.brain = getBrain(game, champ.team);
    this.brain.register(this);
    this.shopPlanner = new ShopPlanner(champ, role);
    this.dodger = new Dodger(this);
    // 难度派生参数
    const agg = this.params.aggression;
    this.retreatHp = 0.5 - agg * 0.3;
    this.engageFactor = 0.8 + agg * 0.5;
    this.harassMana = 0.62 - agg * 0.2;
    // 感知与状态
    this.enemies = [];
    this.allies = [];
    this.danger = null;
    this.plan = null;
    this.retreating = false;
    this.recallIntent = false;
    this.engaged = null;
    this.gank = null;
    this.camp = null;
    this.diving = false;
    this.lhWatch = null;
    this.lhCommitUntil = 0;
    this.harassUntil = 0;
    this.harassStart = 0;
    this.nextHarassAt = 0;
    this.tradeCdUntil = 0;
    this.lastFightAt = -99;
    this.lastCastAt = -99;
    this.lastTurretHitAt = -99;
    this.wantShopGold = false;
    this.errorCount = 0;
    this._lhRoll = new Map();
    this._seenAt = new Map();
    this._lastVis = new Map();
    this._customOff = new Map();
    this._customErrLogged = new Set();
    this._dmgLog = [];
    this._wasAlive = true;
    this._lastMove = { x: 0, y: 0, t: -99 };
    this.nextShopAt = 0;
    this.nextDeadShopAt = 0;
    this.nextPotionAt = 0;
    this.nextIdleCast = 0;
    this.lastPos = { x: champ.x, y: champ.y, t: 0 };
    this.stuckTries = 0;
    this.slotJitter = (((champ.slotIndex || 0) * 37) % 5 - 2) * 25;
    // 错开思考：按队伍与位置分散到不同 tick
    const idx = champ.team * 5 + (champ.slotIndex || 0);
    this.nextTactical = 0.2 + idx * 0.021 + game.rng() * 0.05;
    this.nextMacro = 0.4 + idx * 0.113;
    game.events.on('damage', (e) => { if (e.target === this.champ) this._onDamaged(e); });
  }

  // ———————————————— 公共接口（英雄 ai.custom / ai.when 可调用） ————————————————
  visibleEnemies(radius = 2000) {
    const c = this.champ;
    const team = c.team;
    const out = [];
    for (const e of this.game.champions) {
      if (e.team === team || !e.alive || !e.visible[team] || e.untargetable) continue;
      const d = c.distTo(e);
      if (d <= radius) out.push([d, e]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.map((p) => p[1]);
  }
  nearbyAllies(radius = 1500) {
    const c = this.champ;
    const out = [];
    for (const a of this.game.champions) {
      if (a === c || a.team !== c.team || !a.alive) continue;
      const d = c.distTo(a);
      if (d <= radius) out.push([d, a]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.map((p) => p[1]);
  }
  enemyMinions(radius = 1000) {
    const c = this.champ;
    return this.game.queryUnits({ x: c.x, y: c.y, radius, enemyOf: c, types: ['minion'], targetableBy: c });
  }
  hpPct() { const c = this.champ; return c.maxHp > 0 ? c.hp / c.maxHp : 0; }
  manaPct() { const c = this.champ; return c.maxMana > 0 ? c.mana / c.maxMana : 1; }
  _usesMana() { return this.champ.resourceType === 'mana' && this.champ.maxMana > 0; }
  get isFighting() { return this.mode === 'fighting'; }
  get isRetreating() { return this.mode === 'retreating'; }

  // 线性预判：按目标当前移动方向（考虑难度精度误差）
  predict(unit, delay = 0.3) {
    if (!unit) return { x: this.champ.x, y: this.champ.y };
    let x = unit.x, y = unit.y;
    const ds = unit.dashState;
    if (ds && !ds.followTarget) {
      const left = Math.hypot(ds.tx - x, ds.ty - y);
      const step = Math.min(left, (ds.speed || 1000) * delay);
      if (left > 1) { x += ((ds.tx - x) / left) * step; y += ((ds.ty - y) / left) * step; }
      return { x, y };
    }
    const path = unit.path;
    if (!unit.moving || !path || path.length === 0 || (unit.canMove && !unit.canMove())) return { x, y };
    const p = path[0];
    let dx = p.x - x, dy = p.y - y;
    const l = Math.hypot(dx, dy);
    if (l < 1) return { x, y };
    dx /= l; dy /= l;
    let remain = l;
    for (let i = 1; i < path.length && remain < 3000; i++) remain += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    const acc = this.params.accuracy;
    const rng = this.game.rng();
    const k = 1 + (rng - 0.5) * 2 * (1 - acc) * 0.9;
    const ms = unit.stats.moveSpeed;
    const lead = Math.min(remain + 60, ms * delay * k);
    const lat = (this.game.rng() - 0.5) * 2 * (1 - acc) * ms * delay * 0.4;
    return { x: x + dx * lead - dy * lat, y: y + dy * lead + dx * lat };
  }

  // 施法包装（带瞄准误差）
  castAt(slot, x, y, { exact = false } = {}) {
    const c = this.champ;
    if (!exact) {
      const err = (1 - this.params.accuracy) * 55;
      x += (this.game.rng() - 0.5) * 2 * err;
      y += (this.game.rng() - 0.5) * 2 * err;
    }
    const ab = c.abilities[slot];
    const opts = { x, y };
    if (ab?.def?.targeting === 'unit' && this.target) opts.target = this.target;
    return c.castAbility(slot, opts);
  }
  castOn(slot, unit) {
    if (!unit) return { ok: false, reason: 'target' };
    return this.champ.castAbility(slot, { target: unit, x: unit.x, y: unit.y });
  }
  castSelf(slot) {
    const c = this.champ;
    return c.castAbility(slot, { target: c, x: c.x, y: c.y });
  }

  // 是否在敌方防御塔射程内（含敌方泉水）
  isUnderEnemyTurret(x, y, margin = 30) {
    const team = this.champ.team;
    const R = TURRET_RANGE + this.champ.radius + margin;
    const R2 = R * R;
    for (const t of this.world.turrets(1 - team)) {
      if (!t.alive) continue;
      const dx = t.x - x, dy = t.y - y;
      if (dx * dx + dy * dy <= R2) return true;
    }
    const f = this.world.fountains[1 - team];
    if (f && (f.x - x) ** 2 + (f.y - y) ** 2 <= (f.radius + 300) ** 2) return true;
    return false;
  }

  // 粗略安全评估：不在敌塔下、附近可见敌人不多于友军、没有贴身敌人
  isSafe(x = this.champ.x, y = this.champ.y) {
    if (this.isUnderEnemyTurret(x, y)) return false;
    const c = this.champ;
    let foes = 0, friends = 0;
    for (const u of this.game.champions) {
      if (!u.alive) continue;
      const d2 = (u.x - x) ** 2 + (u.y - y) ** 2;
      if (u.team === c.team) { if (d2 < 1200 * 1200) friends++; continue; }
      if (!u.visible[c.team]) continue;
      if (d2 < 550 * 550) return false;
      if (d2 < 1200 * 1200) foes++;
    }
    return foes === 0 || friends >= foes + 1;
  }

  // 敌人是否已被「反应」过来（首次进入视野超过反应时间）
  reactable(u) {
    const t = this._seenAt.get(u);
    return t != null && this.game.time - t >= this.params.reaction;
  }

  // ———————————————— 主循环 ————————————————
  update(dt) {
    try {
      this._update(dt);
    } catch (err) {
      this._onError(err);
    }
  }

  _onError(err) {
    const st = aiStats(this.game);
    st.errors++;
    this.errorCount++;
    if (st.messages.length < 20) st.messages.push(`${this.champ.displayName}: ${err && err.stack ? err.stack : err}`);
    if (this.errorCount <= 2) console.error(`[AI ${this.champ.displayName}] 异常：`, err);
    this._fallbackUntil = this.game.time + 1;
  }
  _reportCustomError(where, err) {
    const st = aiStats(this.game);
    st.customErrors++;
    const key = `${this.champ.championId}:${where}`;
    if (st.messages.length < 20) st.messages.push(`${key}: ${err && err.stack ? err.stack : err}`);
    if (!this._customErrLogged.has(key)) {
      this._customErrLogged.add(key);
      console.error(`[AI ${this.champ.displayName}] 英雄 AI 提示函数 ${where} 异常：`, err);
    }
  }
  // 降级安全行为：残血回泉水，否则保持当前命令
  _fallback() {
    const c = this.champ;
    if (!c.alive || c.channel) return;
    if (this.hpPct() < 0.35 && !c.inFountain) {
      const f = this.game.fountainOf(c.team);
      if (!c.command || c.command.type !== 'move') c.moveTo(f.x, f.y);
    }
  }

  _update(dt) {
    const c = this.champ;
    const game = this.game;
    const now = game.time;
    this.brain.tick();
    if (c.skillPoints > 0) this._levelSkills();
    if (!c.alive) { this._whileDead(); return; }
    if (!this._wasAlive) this._onRespawn();
    if (game.over) return;
    if (this._fallbackUntil && now < this._fallbackUntil) { this._fallback(); return; }
    if (c.inFountain && now >= this.nextShopAt) { this.nextShopAt = now + 1.5; this._shop(); }
    if (now >= this.nextMacro) { this.nextMacro = now + 1.0 + game.rng() * 0.4; this._macro(); }
    if (now >= this.nextTactical) {
      this.nextTactical = now + this.params.thinkInterval * (0.85 + game.rng() * 0.3);
      this._tactical();
    }
    this._micro(dt);
  }

  _whileDead() {
    const now = this.game.time;
    this.mode = 'dead';
    this.target = null;
    this.retreating = false;
    this.recallIntent = false;
    this.engaged = null;
    this.gank = null;
    this.lhWatch = null;
    this.diving = false;
    this._wasAlive = false;
    if (now >= this.nextDeadShopAt) { this.nextDeadShopAt = now + 2; this._shop(); }
  }

  _onRespawn() {
    this._wasAlive = true;
    this.plan = null;
    this.nextMacro = this.game.time;
    this.lastPos = { x: this.champ.x, y: this.champ.y, t: this.game.time };
    this._shop();
  }

  _shop() {
    const n = this.shopPlanner.shop(this.game.time);
    if (n > 0 && this.champ.alive) this.mode = 'shopping';
    if (this.champ.inFountain) this.recallIntent = false;
  }

  _onDamaged(e) {
    const now = this.game.time;
    const s = e.source;
    if (s && s.type === 'turret') this.lastTurretHitAt = now;
    this._dmgLog.push(now, e.amount || 0);
    if (this._dmgLog.length > 80) this._dmgLog.splice(0, this._dmgLog.length - 40);
  }
  _recentDamage(window = 2) {
    const now = this.game.time;
    let s = 0;
    const L = this._dmgLog;
    for (let i = L.length - 2; i >= 0; i -= 2) {
      if (now - L[i] > window) break;
      s += L[i + 1];
    }
    return s;
  }

  // 技能加点：R 能升就升；1~3 级按 skillOrder 各点一个；之后按 skillOrder 主升
  _levelSkills() {
    const c = this.champ;
    const order = (c.def.ai?.skillOrder || ['Q', 'W', 'E']).filter((s) => s === 'Q' || s === 'W' || s === 'E');
    for (const s of ['Q', 'W', 'E']) if (!order.includes(s)) order.push(s);
    let guard = 0;
    while (c.skillPoints > 0 && guard++ < 6) {
      if (c.canLevelAbility('R') && c.levelUpAbility('R')) continue;
      let done = false;
      if (c.level <= 3) {
        for (const s of order) if (c.abilities[s].rank === 0 && c.canLevelAbility(s)) { done = c.levelUpAbility(s); break; }
      }
      if (!done) for (const s of order) if (c.canLevelAbility(s) && c.levelUpAbility(s)) { done = true; break; }
      if (!done) break;
    }
  }

  // ———————————————— 宏观（每 1~1.4 秒） ————————————————
  _macro() {
    const c = this.champ;
    const now = this.game.time;
    const brain = this.brain;
    this._stuckCheck();
    const obj = brain.objective;
    const late = brain.isLateGame();
    let plan;
    if (obj && brain.participates(this) && this._objectiveViable(obj)) plan = { kind: 'objective', obj };
    else if (late && brain.splitPusher === this) plan = { kind: 'split' };
    else if (this.role === 'jungle') plan = { kind: 'jungle' };
    else if (this._leashCamp()) plan = { kind: 'leash', camp: this._leashCamp() };
    else if (this.role === 'support' && !late) plan = { kind: 'support' };
    else plan = { kind: 'lane', lane: this.lane || 'mid' };
    // 支援附近交战中的队友
    const helpDist = (this.role === 'jungle' || this.role === 'mid' || this.role === 'support' || late) ? 3200 : 1700;
    if (plan.kind !== 'objective' || plan.obj.kind === 'push') {
      const trouble = this._allyInTrouble(helpDist);
      if (trouble && this.hpPct() > 0.45 && !this.retreating && this._assistWorth(trouble)) plan = { kind: 'assist', ally: trouble.ally, enemy: trouble.enemy, until: now + 6 };
      else if (this.plan?.kind === 'assist' && now < this.plan.until && this.plan.ally.alive) plan = this.plan;
    }
    if (this.role === 'jungle' && plan.kind === 'jungle') this._evalGank();
    this.plan = plan;
    this.wantShopGold = c.gold >= this.shopPlanner.nextPurchaseCost();
    this._considerWard();
    // 35 分钟后更积极（避免僵持）
    if (now > 35 * 60) this.engageFactor = 0.95 + this.params.aggression * 0.5;
  }

  // 开局帮打野拉第一组 BUFF（靠近下路的 BUFF 由下路双人帮，否则中单帮）
  _leashCamp() {
    const now = this.game.time;
    if (now < 60 || now > (this.role === 'support' ? 110 : 105) || this.role === 'top' || this.role === 'jungle') return null;
    const jg = this.brain.members.find((m) => m.role === 'jungle');
    const camp = jg?.startCamp;
    if (!camp || !jg.champ.alive) return null;
    const w = this.world;
    w.project('bot', camp.x, camp.y);
    const dBot = w.lastProjDist;
    w.project('top', camp.x, camp.y);
    const dTop = w.lastProjDist;
    const botSide = dBot < dTop;
    if (botSide ? !(this.role === 'adc' || this.role === 'support') : this.role !== 'mid') return null;
    if (now > 93 && !this.brain.campMonsters(camp).some((m) => m.large !== false)) return null;
    return camp;
  }

  _leash(camp) {
    const c = this.champ;
    this.mode = 'laning';
    const mons = this.brain.campMonsters(camp).filter((m) => m.isTargetableBy(c));
    const big = mons.find((m) => m.large !== false) || mons[0];
    const fx = Math.cos(camp.facing || 0), fy = Math.sin(camp.facing || 0);
    let tx = camp.x + fx * 380, ty = camp.y + fy * 380;
    if (!this.game.nav.isWalkable(tx, ty)) { tx = camp.x; ty = camp.y; }
    if (big && (big.aggroTarget || big.hp < big.maxHp) && c.distTo(big) < 900) {
      this.target = big;
      this.attack(big);
      return;
    }
    if (Math.hypot(tx - c.x, ty - c.y) > 200) this.goTo(tx, ty);
    else this._idleJitter(tx, ty, 100);
  }

  // 对线期（非打野、外塔未破且未到 14 分钟）
  _laningPhase() { return this.role !== 'jungle' && !this.brain.isLateGame(); }

  // 是否值得离开当前工作去支援：队友真的在交战/残血；打野清野中、低等级、对线期远距离不去
  _assistWorth(trouble) {
    const c = this.champ;
    const ally = trouble.ally;
    const d = c.distTo(ally);
    const allyAI = this.brain.members.find((m) => m.champ === ally);
    const allyBusy = allyAI ? (allyAI.mode === 'fighting' || allyAI.mode === 'retreating') : true;
    if (!allyBusy && ally.hp / ally.maxHp > 0.6) return false;
    if (this.role === 'jungle') {
      if (c.level < 3 && d > 1400) return false;
      const t = this.target;
      if (t && t.type === 'monster' && t.alive && t.aggroTarget === c && d > 1200) return false;
      return true;
    }
    if (this._laningPhase() && d > 1800) {
      if (!(this.role === 'mid' || this.role === 'support') || c.level < 4) return false;
      if (this.isUnderEnemyTurret(trouble.enemy.x, trouble.enemy.y)) return false;
    }
    return true;
  }

  // 正在打野怪且算得过来（考虑惩戒、野怪秒伤、附近无敌方英雄）：不因血量回城/撤退
  _monsterCommit() {
    const c = this.champ;
    const t = this.target;
    if (!t || t.type !== 'monster' || !t.alive || t.aggroTarget !== c) return false;
    if (this.enemies.length && this.enemies[0].d < 1400) return false;
    if (c.distTo(t) > 600) return false;
    const mons = this.game.queryUnits({ x: c.x, y: c.y, radius: 700, types: ['monster'], sort: false });
    let incoming = 0, need = 0;
    for (const m of mons) {
      if (!m.alive || m.aggroTarget !== c) continue;
      incoming += mitigate(m, c, m.stats.ad, 'physical') * Math.max(0.2, m.stats.attackSpeed) * (this.role === 'jungle' ? 0.8 : 1);
      need += m.hp;
    }
    const k = this._smiteKey?.();
    if (k && c.summoners[k].ready && t.large !== false) need -= Math.min(t.hp, this._smiteDamage());
    const dps = autoDamage(c, t) * c.stats.attackSpeed * (this.role === 'jungle' ? 1.2 : 1) + c.level * 6 + 8;
    const ttk = Math.max(0, need) / Math.max(1, dps);
    return c.hp - incoming * ttk > c.maxHp * 0.08;
  }

  _objectiveViable(obj) {
    if (this.hpPct() < 0.3 && obj.kind !== 'defend') return false;
    if (obj.kind === 'dragon' || obj.kind === 'baron' || obj.kind === 'herald') {
      if (!obj.camp) return false;
      if (!this.brain.campUp(obj.camp) && this.brain.campMonsters(obj.camp).length === 0) return false;
    }
    return true;
  }

  _stuckCheck() {
    const c = this.champ;
    const now = this.game.time;
    const moved = Math.hypot(c.x - this.lastPos.x, c.y - this.lastPos.y);
    const cmd = c.command;
    const attackingInRange = cmd && cmd.type === 'attack' && cmd.target?.alive && c.inAttackRange(cmd.target, 30);
    if (moved > 45 || c.inFountain || c.channel || c.attackState || attackingInRange || c.castLock > 0) {
      this.lastPos = { x: c.x, y: c.y, t: now };
      this.stuckTries = 0;
      return;
    }
    const idle = now - this.lastPos.t;
    const wantsMove = cmd && (cmd.type === 'move' || cmd.type === 'attack' || cmd.type === 'castMove' || cmd.type === 'attackMove');
    if (wantsMove && idle > 3) {
      // 卡住：换个方向绕一下
      this.stuckTries++;
      const a = this.game.rng() * Math.PI * 2;
      const r = 120 + 90 * Math.min(6, this.stuckTries);
      const p = this.game.nav.nearestWalkable(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 500);
      c.moveTo(p.x, p.y);
      this._lastMove = { x: p.x, y: p.y, t: now };
      this.lastPos = { x: c.x, y: c.y, t: now - 1.5 };
    } else if (idle > 6) {
      this.nextJitterAt = 0;
      this._idleJitter(c.x, c.y, 160);
    }
  }

  // ———————————————— 战术（每 thinkInterval） ————————————————
  _perceive() {
    const c = this.champ;
    const now = this.game.time;
    const team = c.team;
    this.enemies.length = 0;
    this.allies.length = 0;
    for (const u of this.game.champions) {
      if (u === c || !u.alive) continue;
      const d = c.distTo(u);
      if (u.team === team) { if (d < 5000) this.allies.push({ u, d }); continue; }
      if (!u.visible[team]) continue;
      const last = this._lastVis.get(u);
      if (last == null || now - last > 1.0) this._seenAt.set(u, now);
      this._lastVis.set(u, now);
      this.enemies.push({ u, d });
    }
    this.enemies.sort((a, b) => a.d - b.d);
    this.allies.sort((a, b) => a.d - b.d);
  }

  _tactical() {
    const c = this.champ;
    const now = this.game.time;
    this._perceive();
    if (c.channel) { this._handleChannel(); return; }
    if (c.castLock > 0) return;
    this.diving = false;
    const d = this._assessDanger();
    this.danger = d;
    this._usePotion();
    this._useCleanse(d);
    // 被防御塔攻击：立即撤出（除非确定击杀）
    if (d.turretAggro && d.underTurret && !this._diveWorth()) { this._escapeTurret(); return; }
    if (this._shouldRetreat(d)) { this._retreat(d); return; }
    const t = this._chooseFight(d);
    if (t) { this._fight(t, d); return; }
    this.engaged = null;
    if (this.mode === 'fighting' || (this.target && this.target.type === 'champion')) this.target = null;
    // 回城
    if ((this.recallIntent || this._shouldRecall()) && !this._monsterCommit()) {
      this.recallIntent = true;
      if (this._doRecall()) return;
    }
    // 在泉水：状态回满再出门
    if (c.inFountain && (this.hpPct() < 0.8 || (this._usesMana() && this.manaPct() < 0.55)) && now > 5) {
      this.mode = 'shopping';
      this._idleJitter(c.x, c.y, 120);
      return;
    }
    this._executePlan();
    // 空闲时给 custom 技能机会（切换类、自身增益管理等）
    if (now >= this.nextIdleCast && this.mode !== 'fighting') {
      this.nextIdleCast = now + 0.6;
      this._useAbilities('idle', this.target);
    }
  }

  _executePlan() {
    const c = this.champ;
    const now = this.game.time;
    const p = this.plan || { kind: this.role === 'jungle' ? 'jungle' : 'lane', lane: this.lane || 'mid' };
    switch (p.kind) {
      case 'objective': {
        const o = p.obj;
        if (o.kind === 'push') { this._objectivePush(o); return; }
        if (o.kind === 'defend') { this._objectiveDefend(o); return; }
        this._objectiveEpic(o);
        return;
      }
      case 'split': this._splitPush(); return;
      case 'leash': this._leash(p.camp); return;
      case 'jungle': this._jungle(); return;
      case 'support': this._supportLane(); return;
      case 'assist': {
        if (now > p.until || !p.ally.alive || p.ally.distTo(c) > 4500) { this.plan = null; break; }
        this.mode = 'roaming';
        const e = p.enemy;
        const tx = e.alive && e.visible[c.team] ? e.x : p.ally.x, ty = e.alive && e.visible[c.team] ? e.y : p.ally.y;
        if (this.isUnderEnemyTurret(tx, ty)) { this._followUnit(p.ally, 300); return; }
        this.goTo(tx, ty, { tol: 150 });
        return;
      }
      default: break;
    }
    const lane = p.lane || this.lane || 'mid';
    this._followLane(lane, { push: this._shouldPushLane(lane) });
  }

  _shouldPushLane(lane) {
    if (this.brain.isLateGame()) return true;
    if (this.hpPct() < 0.5) return false;
    return this._laneOpponentAbsent(lane);
  }

  // —— 危险评估 ——
  _assessDanger() {
    const c = this.champ;
    const now = this.game.time;
    const enemiesNear = [];
    let threat = 0;
    for (const e of this.enemies) {
      if (e.d > 1400) break;
      enemiesNear.push(e.u);
      const reach = Math.max(900, e.u.stats.attackRange + e.u.radius + c.radius + 450);
      if (e.d < reach) threat += threatDamage(e.u, c, { window: 2.5, cd: this.brain.enemyCooldowns(e.u), now });
    }
    const alliesNear = [];
    for (const a of this.allies) { if (a.d > 1400) break; alliesNear.push(a.u); }
    const underTurret = this.isUnderEnemyTurret(c.x, c.y);
    const turretAggro = now - this.lastTurretHitAt < 1.2 || (underTurret && this._turretTargetingMe());
    let ratio = Infinity;
    if (enemiesNear.length) {
      const ref = enemiesNear[0];
      const ours = groupStrength([c, ...alliesNear], ref);
      const theirs = groupStrength(enemiesNear, c);
      let our = ours.power, their = theirs.power;
      const mx = (c.x + ref.x) / 2, my = (c.y + ref.y) / 2;
      const R2 = (TURRET_RANGE + 250) ** 2;
      for (const t of this.world.turrets(1 - c.team)) {
        if (t.alive && (t.x - mx) ** 2 + (t.y - my) ** 2 < R2) their += theirs.ehp * t.stats.ad * 1.2;
      }
      for (const t of this.world.turrets(c.team)) {
        if (t.alive && (t.x - mx) ** 2 + (t.y - my) ** 2 < R2) our += ours.ehp * t.stats.ad * 1.2;
      }
      // 对线期：小兵会响应呼叫支援（我方先动手时敌方小兵全额计入，我方小兵半额）
      if (this._laningPhase()) {
        const eMin = this.game.queryUnits({ x: c.x, y: c.y, radius: 700, enemyOf: c, types: ['minion'], sort: false }).length;
        const aMin = this.game.queryUnits({ x: ref.x, y: ref.y, radius: 700, allyOf: c, types: ['minion'], sort: false }).length;
        their += theirs.ehp * 13 * eMin;
        our += ours.ehp * 13 * aMin * 0.5;
      }
      ratio = our / Math.max(1, their);
    }
    return { enemiesNear, alliesNear, threat, lethal: threat >= (c.hp + c.totalShield) * 0.95, ratio, underTurret, turretAggro };
  }

  _turretTargetingMe() {
    const c = this.champ;
    for (const t of this.world.turrets(1 - c.team)) {
      if (!t.alive) continue;
      if ((t.x - c.x) ** 2 + (t.y - c.y) ** 2 > 1100 * 1100) continue;
      if (t.command?.target === c || t.attackState?.target === c) return true;
    }
    return false;
  }

  _diveWorth() {
    const c = this.champ;
    const t = this.engaged?.target;
    if (!t || !t.alive || !t.visible[c.team]) return false;
    const combo = comboDamage(c, t, { window: 1.5 });
    return combo >= (t.hp + (t.totalShield || 0)) * 1.1 && c.hp > 450 && this.hpPct() > 0.35 && c.distTo(t) < c.stats.attackRange + c.radius + t.radius + 150;
  }

  _escapeTurret() {
    const c = this.champ;
    this.mode = 'retreating';
    this.target = null;
    this.engaged = null;
    this.lhWatch = null;
    let turret = null, bd = Infinity;
    for (const t of this.world.turrets(1 - c.team)) {
      if (!t.alive) continue;
      const d = c.distTo(t);
      if (d < bd) { bd = d; turret = t; }
    }
    const f = this.game.fountainOf(c.team);
    let dx = c.x - (turret ? turret.x : c.x - 1), dy = c.y - (turret ? turret.y : c.y);
    let l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    // 混合「远离塔」与「回泉水」方向
    let fx = f.x - c.x, fy = f.y - c.y;
    l = Math.hypot(fx, fy) || 1;
    fx /= l; fy /= l;
    const ux = dx * 0.6 + fx * 0.4, uy = dy * 0.6 + fy * 0.4;
    const need = Math.max(250, TURRET_RANGE + c.radius + 180 - bd);
    let px = c.x + ux * need, py = c.y + uy * need;
    if (!this.game.nav.isWalkable(px, py)) { const s = this._safeSpot(); px = s.x; py = s.y; }
    this.goTo(px, py, { force: true, tol: 60 });
  }

  _shouldRetreat(d) {
    const c = this.champ;
    const hp = this.hpPct();
    const now = this.game.time;
    const nearest = this.enemies[0];
    const close = nearest && nearest.d < 1100;
    if (this.retreating) {
      if (c.inFountain) { this.retreating = false; return false; }
      if (d.enemiesNear.length === 0 && hp > this.retreatHp + 0.25) { this.retreating = false; return false; }
      // 追兵残血且可击杀：反打
      if (close && nearest.u.hp / nearest.u.maxHp < 0.15 && comboDamage(c, nearest.u, { window: 1.5 }) > nearest.u.hp * 1.3 && d.ratio > 0.9 && hp > 0.15) { this.retreating = false; return false; }
      return true;
    }
    if (hp < this.retreatHp && close) {
      const t = nearest.u;
      if (t.hp / t.maxHp < 0.2 && comboDamage(c, t, { window: 2 }) > t.hp * 1.2 && d.ratio > 0.8) return false;
      return true;
    }
    if (hp < this.retreatHp * 0.65 && now - c.lastDamagedAt < 3 && !this._monsterCommit()) return true;
    if (close && d.lethal && d.ratio < 1.1) return true;
    if (close && nearest.d < 950 && d.ratio * this.engageFactor < 0.45) return true;
    if (d.enemiesNear.length >= d.alliesNear.length + 3) return true;
    return false;
  }

  _retreat(d) {
    const c = this.champ;
    const now = this.game.time;
    this.mode = 'retreating';
    this.retreating = true;
    this.target = null;
    this.engaged = null;
    this.gank = null;
    this.lhWatch = null;
    this._useDefensives(d);
    const chaser = this.enemies[0] && this.enemies[0].d < 800 ? this.enemies[0].u : null;
    if (chaser) this._useAbilities('escape', chaser);
    if (c.castLock > 0) return;
    if (d.enemiesNear.length === 0 && now - c.lastDamagedAt > 2.5 && !c.inFountain) {
      // 脱离危险：状态尚可就回到兵线（对线期有药水时更能坚持），否则回城
      const laning = this._laningPhase();
      const pressing = this.plan?.kind === 'objective' && this.brain.pressing();
      const needHp = pressing ? 0.33 : laning ? (findPotionSlot(c) >= 0 ? 0.3 : 0.4) : 0.6;
      if (this.hpPct() < needHp || (!pressing && this.wantShopGold && this.hpPct() < (laning ? 0.5 : 0.75)) || (this._usesMana() && this.manaPct() < (pressing ? 0.1 : 0.2))) {
        this.recallIntent = true;
        if (this._doRecall()) return;
      } else {
        this.retreating = false;
        return;
      }
    }
    const s = this._safeSpot();
    this.goTo(s.x, s.y, { force: true, tol: 120 });
  }

  // 撤退目标：身后最近的我方防御塔后方，否则泉水
  _safeSpot() {
    const c = this.champ;
    const f = this.game.fountainOf(c.team);
    const myF = Math.hypot(c.x - f.x, c.y - f.y);
    let best = null, bd = Infinity;
    for (const t of this.world.turrets(c.team)) {
      if (!t.alive) continue;
      const tf = Math.hypot(t.x - f.x, t.y - f.y);
      if (tf > myF - 350) continue;
      const d = c.distTo(t);
      if (d < bd) { bd = d; best = t; }
    }
    if (best && bd < 5500) {
      const dx = f.x - best.x, dy = f.y - best.y;
      const l = Math.hypot(dx, dy) || 1;
      const p = { x: best.x + (dx / l) * 320, y: best.y + (dy / l) * 320 };
      if (this.game.nav.isWalkable(p.x, p.y)) return p;
      return this.game.nav.nearestWalkable(p.x, p.y, 500);
    }
    return { x: f.x, y: f.y };
  }

  _shouldRecall() {
    const c = this.champ;
    const now = this.game.time;
    if (c.inFountain) { this.recallIntent = false; return false; }
    if (now < 100) return false;
    const hp = this.hpPct();
    const p = this.plan;
    if (p?.kind === 'objective' && p.obj.kind !== 'push' && hp > 0.35) return false;
    // 乘胜推进/残局推家：状态尚可就不回城
    if (p?.kind === 'objective' && this.brain.pressing() && hp > 0.33 && !(this._usesMana() && this.manaPct() < 0.1)) return false;
    const laning = this._laningPhase();
    const lowHp = laning ? Math.max(0.2, this.retreatHp - (findPotionSlot(c) >= 0 ? 0.08 : 0)) : this.retreatHp + 0.08;
    if (hp < lowHp) return true;
    if (this._usesMana() && this.manaPct() < 0.12 && hp < 0.9) return true;
    const next = this.shopPlanner.nextPurchaseCost();
    if (this.wantShopGold) {
      if (laning) {
        // 对线期：攒够一件大件组件再回（或状态不佳 + 买得起）
        if ((hp < 0.5 && c.gold >= next) || c.gold >= Math.max(next + 500, 1250) || (this._usesMana() && this.manaPct() < 0.2)) return true;
      } else if (hp < 0.6 || c.gold >= next + 450 || (this._usesMana() && this.manaPct() < 0.3)) return true;
    }
    if (c.gold > 2800) return true;
    if (this.role === 'support' && !this.brain.isLateGame()) {
      const adc = this._adc();
      if (adc && adc.isRecalling && adc.distTo(c) < 1300 && (hp < 0.8 || c.gold > 800)) return true;
    }
    return false;
  }

  _doRecall() {
    const c = this.champ;
    const now = this.game.time;
    if (c.inFountain) { this.recallIntent = false; return false; }
    const near = this.enemies.length && this.enemies[0].d < 1700;
    if (near || now - c.lastDamagedAt < 2.2 || this.isUnderEnemyTurret(c.x, c.y)) {
      // 先撤到安全处
      this.mode = 'retreating';
      const s = this._safeSpot();
      this.goTo(s.x, s.y, { force: true, tol: 120 });
      return true;
    }
    if (!c.isRecalling) {
      c.stop();
      if (!c.startRecall()) { const s = this._safeSpot(); this.goTo(s.x, s.y); return true; }
    }
    this.mode = 'recalling';
    this.target = null;
    return true;
  }

  _handleChannel() {
    const c = this.champ;
    if (c.isRecalling) {
      this.mode = 'recalling';
      const e = this.enemies[0];
      if (e && e.d < 1150 && this.reactable(e.u)) { c.cancelRecall(); this.retreating = true; }
    }
    // 其他引导（传送/技能）：不打断
  }

  // —— 交战选择 ——
  _chooseFight(d) {
    const c = this.champ;
    const now = this.game.time;
    if (!this.enemies.length) return null;
    const engageR = (c.def.ai?.engageRange || 500) + c.stats.attackRange * 0.5 + 250;
    const cur = this.engaged?.target;
    const maxR = cur ? Math.max(engageR, 1300) : engageR;
    let best = null, bs = -Infinity;
    for (const e of this.enemies) {
      if (e.d > maxR) break;
      const u = e.u;
      if (u.untargetable || !this.reactable(u)) continue;
      const s = targetScore(c, u, { current: cur, range: c.stats.attackRange + 200 });
      if (s > bs) { bs = s; best = u; }
    }
    if (!best) return null;
    const hp = this.hpPct();
    const combo = comboDamage(c, best, { window: 3 });
    const tEhp = best.hp + (best.totalShield || 0);
    const killable = combo >= tEhp * 1.05;
    const ratio = d.ratio * this.engageFactor;
    // 越塔：只在确定击杀、塔未锁定我方英雄、自身血量健康时
    if (this.isUnderEnemyTurret(best.x, best.y)) {
      const turret = this._enemyTurretAt(best.x, best.y);
      const dive = killable && combo >= tEhp * 1.3 && hp > 0.45 && c.hp > 500 && ratio > 0.7
        && (this._towerCovered(turret) || c.distTo(best) < c.stats.attackRange + c.radius + best.radius + 100);
      if (!dive) return null;
      this.diving = true;
    }
    const laning = this._laningPhase() && this.plan?.kind !== 'objective';
    const recentlyHit = now - c.lastChampionDamageAt < 1.5;
    if (laning) {
      // 对线期：短换血（2.5~4 秒）后拉开，冷却期间只在能击杀/被追打时出手
      if (killable && ratio > 0.6) return best;
      if (this.gank && this.gank.target === best && ratio > 0.7) return best;
      const hitBy = recentlyHit && c.lastChampionDamager === best;
      if (cur === best) {
        const len = now - (this.engaged?.since ?? now);
        if (len < 2.5 + this.params.aggression * 1.5 && ratio > 1.0 && hp > 0.42) return best;
        if (hitBy && ratio > 1.5 && hp > 0.45 && c.inAttackRange(best, 40)) return best;
        this.tradeCdUntil = now + 3.5 + this.game.rng() * 4 * (1.2 - this.params.aggression);
        return null;
      }
      if (now < this.tradeCdUntil) {
        if (hitBy && ratio > 1.5 && hp > 0.5 && c.inAttackRange(best, 40)) return best;
        return null;
      }
      // 主动换血：目标附近敌方小兵不多（否则会被整波小兵集火）
      const minionsAtTarget = this.game.queryUnits({ x: best.x, y: best.y, radius: 800, enemyOf: c, types: ['minion'], sort: false }).length;
      if (ratio > 1.8 && hp > 0.55 && minionsAtTarget <= 2) return best;
      if (best.hp / best.maxHp < 0.3 && ratio > 1.1 && hp > 0.4 && minionsAtTarget <= 3) return best;
      if (hitBy && ratio > 1.15 && hp > 0.5 && hp >= best.hp / best.maxHp - 0.05) return best;
      return null;
    }
    if (cur === best && (ratio > 0.75 || killable)) return best;
    if (killable && ratio > 0.55) return best;
    if (this.gank && this.gank.target === best && ratio > 0.7) return best;
    if (ratio > 1.12) return best;
    if (recentlyHit && ratio > 0.85) return best;
    // 保护队友：敌人正在攻击我方 C 位
    if (ratio > 0.8) {
      for (const a of this.allies) {
        if (a.d > 900) break;
        if ((a.u.role === 'adc' || a.u.role === 'mid') && now - (a.u.lastChampionDamageAt ?? -99) < 1.2 && a.u.lastChampionDamager === best) return best;
      }
    }
    return null;
  }

  _fight(t, d) {
    const c = this.champ;
    const now = this.game.time;
    this.mode = 'fighting';
    this.target = t;
    this.lastFightAt = now;
    if (!this.engaged || this.engaged.target !== t) this.engaged = { target: t, since: now };
    this.lhWatch = null;
    this.gank = null;
    this._offensiveSummoners(t, d);
    this._useDefensives(d);
    this._useItemsInFight(t, d);
    if (this.role === 'support') {
      const adc = this._adc();
      const th = adc && adc.distTo(c) < 1200 ? this._threatTo(adc) : null;
      if (th && this._useAbilities('peel', th)) return;
    }
    if (this._useAbilities('fight', t) && c.castLock > 0) return;
    this._attackOrKite(t);
  }

  _attackOrKite(t) {
    const c = this.champ;
    if (this.dodger.active && this.game.time < this.dodger.active.until) return;
    const ranged = c.stats.attackRange >= 300;
    const inRange = c.inAttackRange(t);
    if (!inRange && this.isUnderEnemyTurret(t.x, t.y) && !this.diving) { this.engaged = null; return; }
    if (!ranged || !inRange || c.attackCooldown <= 0.1 || c.attackState) { this.attack(t); return; }
    // 远程冷却中：交给微操走砍
  }

  // 远程走砍：出手后后撤/横移，攻击就绪时立即普攻
  _microOrbwalk() {
    const c = this.champ;
    const t = this.target;
    const now = this.game.time;
    if (!t || !t.alive || t.type !== 'champion' || !t.isTargetableBy(c)) return;
    if (c.attackState || c.castLock > 0) return;
    if (c.stats.attackRange < 300) return;
    if (c.attackCooldown <= 0.034) { this.attack(t); return; }
    if (!c.inAttackRange(t, 60)) return;
    if (this._kitedFor === c.lastAttackAt || now - c.lastAttackAt > 1.5) return;
    if (c.attackCooldown < 0.2) return;
    // 威胁：近战敌人贴近
    let threat = null, td = Infinity;
    for (const e of this.enemies) {
      if (e.d > 700) break;
      const u = e.u;
      const reach = u.stats.attackRange + u.radius + c.radius + 180;
      if (u.stats.attackRange < c.stats.attackRange - 80 && e.d < reach && e.d < td) { td = e.d; threat = u; }
    }
    this._kitedFor = c.lastAttackAt;
    if (!threat) return;
    let dx = c.x - threat.x, dy = c.y - threat.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const step = Math.min(220, c.stats.moveSpeed * c.attackCooldown * 0.7);
    const nav = this.game.nav;
    for (const a of [0, 0.6, -0.6, 1.1, -1.1]) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = c.x + (dx * ca - dy * sa) * step, py = c.y + (dx * sa + dy * ca) * step;
      if (nav.isWalkable(px, py) && !this.isUnderEnemyTurret(px, py)) { c.moveTo(px, py); return; }
    }
  }

  // —— 召唤师技能与装备 ——
  _offensiveSummoners(t, d) {
    const c = this.champ;
    const dist = c.distTo(t);
    const tHp = t.hp + (t.totalShield || 0);
    for (const k of ['D', 'F']) {
      const st = c.summoners[k];
      if (!st || !st.ready) continue;
      switch (st.id) {
        case 'ignite': {
          if (dist > 600 + t.radius) break;
          const ign = 70 + 20 * c.level;
          if (tHp <= ign * 0.75 + autoDamage(c, t) * 2 || (t.hp / t.maxHp < 0.4 && comboDamage(c, t) >= tHp * 0.75)) {
            if (c.castSummoner(k, { target: t }).ok) return;
          }
          break;
        }
        case 'exhaust': {
          if (dist > 650 + t.radius || t.hp / t.maxHp < 0.15) break;
          const dangerous = t.role === 'adc' || t.role === 'mid' || t.role === 'jungle' || t.stats.ad > c.stats.ad * 1.3;
          if ((this.hpPct() < 0.5 && dangerous) || (d.ratio < 1.4 && dangerous && this.game.time - this.engaged.since > 0.6)) {
            if (c.castSummoner(k, { target: t }).ok) return;
          }
          break;
        }
        case 'flash': {
          if (this.params.aggression < 0.5 || this.hpPct() < 0.35) break;
          const reach = c.stats.attackRange + c.radius + t.radius;
          if (dist <= reach + 60 || dist > reach + 380) break;
          if (this.isUnderEnemyTurret(t.x, t.y) || t.hp / t.maxHp > 0.35) break;
          if (comboDamage(c, t, { window: 2 }) < tHp * 1.15) break;
          const k2 = Math.min(400, dist - reach * 0.6);
          const px = c.x + ((t.x - c.x) / dist) * k2, py = c.y + ((t.y - c.y) / dist) * k2;
          if (c.castSummoner(k, { x: px, y: py }).ok) return;
          break;
        }
        case 'ghost': {
          if (dist > c.stats.attackRange + 300 && comboDamage(c, t) >= tHp) { if (c.castSummoner(k).ok) return; }
          break;
        }
        default: break;
      }
    }
  }

  _useDefensives(d) {
    const c = this.champ;
    const hp = this.hpPct();
    const near = this.enemies[0] ? this.enemies[0].d : Infinity;
    const recent = this._recentDamage(1.5);
    // 凝滞类装备
    if (hp < 0.2 && recent > 0 && near < 800) {
      for (let i = 0; i < c.items.length; i++) {
        const it = c.items[i];
        if (!it || !it.def?.active) continue;
        if (!STASIS_RE.test(`${it.id}${it.def.name || ''}`)) continue;
        if (it.cooldownUntil && this.game.time < it.cooldownUntil) continue;
        if (c.useItem(i, {}).ok) return;
      }
    }
    for (const k of ['D', 'F']) {
      const st = c.summoners[k];
      if (!st || !st.ready) continue;
      switch (st.id) {
        case 'heal': {
          if (hp < 0.22 && recent > 0 && near < 1200) { if (c.castSummoner(k).ok) return; }
          const ally = this.allies.find((a) => a.d < 800 && a.u.hp / a.u.maxHp < 0.15 && this.game.time - a.u.lastDamagedAt < 1);
          if (ally && near < 1200) { if (c.castSummoner(k).ok) return; }
          break;
        }
        case 'barrier':
          if (hp < 0.22 && recent > c.hp * 0.25 && near < 1000) { if (c.castSummoner(k).ok) return; }
          break;
        case 'flash': {
          if (hp < 0.2 && near < 520 && d.threat > c.hp * 0.9 && this.mode !== 'fighting') {
            const s = this._safeSpot();
            let dx = s.x - c.x, dy = s.y - c.y;
            const l = Math.hypot(dx, dy) || 1;
            if (c.castSummoner(k, { x: c.x + (dx / l) * 400, y: c.y + (dy / l) * 400 }).ok) return;
          }
          break;
        }
        case 'ghost':
          if (this.retreating && near < 900 && hp < 0.45) { if (c.castSummoner(k).ok) return; }
          break;
        case 'exhaust': {
          const e = this.enemies[0];
          if (e && hp < 0.35 && e.d < 600 && c.lastChampionDamager === e.u) { if (c.castSummoner(k, { target: e.u }).ok) return; }
          break;
        }
        default: break;
      }
    }
  }

  _useCleanse(d) {
    const c = this.champ;
    if (!d.enemiesNear.length) return;
    let worst = 0;
    for (const t of HARD_CC) worst = Math.max(worst, c.ccRemaining ? c.ccRemaining(t) : 0);
    if (worst < 0.9) return;
    for (const k of ['D', 'F']) {
      const st = c.summoners[k];
      if (st && st.id === 'cleanse' && st.ready) { c.castSummoner(k); return; }
    }
  }

  _usePotion() {
    const c = this.champ;
    const now = this.game.time;
    if (now < this.nextPotionAt || c.inFountain || c.isRecalling) return;
    const hp = this.hpPct();
    const missing = c.maxHp - c.hp;
    if (!(hp < 0.55 || (missing > 280 && hp < 0.72))) return;
    this.nextPotionAt = now + 1.5;
    const slot = findPotionSlot(c);
    if (slot >= 0) c.useItem(slot, {});
  }

  _useItemsInFight(t) {
    const c = this.champ;
    const now = this.game.time;
    for (let i = 0; i < c.items.length; i++) {
      const it = c.items[i];
      const act = it?.def?.active;
      if (!act) continue;
      if (it.cooldownUntil && now < it.cooldownUntil) continue;
      if (STASIS_RE.test(`${it.id}${it.def.name || ''}`)) continue;
      const tg = act.targeting || 'self';
      const range = act.range || 550;
      if (tg === 'unit') { if (c.distTo(t) <= range + t.radius) c.useItem(i, { target: t, x: t.x, y: t.y }); }
      else if (tg === 'point' || tg === 'direction') { if (c.distTo(t) <= range + 100) c.useItem(i, { x: t.x, y: t.y, target: t }); }
      else if (c.distTo(t) < 700) c.useItem(i, {});
    }
  }

  // ———————————————— 微操（每 tick） ————————————————
  _micro() {
    const c = this.champ;
    if (c.channel || !c.alive) return;
    if (this.params.dodge > 0 && c.canMove()) {
      const dg = this.dodger.scan();
      if (dg) {
        if (this._dodgeTarget !== dg) { this._dodgeTarget = dg; c.moveTo(dg.x, dg.y); }
        return;
      }
      this._dodgeTarget = null;
    }
    // 补刀微操：对线/推线时每 2 tick 扫描一次（辅助在 ADC 身边时不补）
    if ((this.mode === 'laning' || this.mode === 'pushing') && !(this.role === 'support' && this._adcInLane())) {
      this._lhTick = ((this._lhTick || 0) + 1) & 1;
      if (this._lhTick === 0 || this.lhWatch) this._microLastHit();
    }
    // 打野：交战/打龙时盯惩戒抢怪
    if (this.role === 'jungle' && (this.mode === 'fighting' || this.mode === 'objective')) {
      this._smTick = ((this._smTick || 0) + 1) % 3;
      if (this._smTick === 0) this._smiteSteal();
    }
    if (this.mode === 'fighting' && this.target) this._microOrbwalk();
  }

  // ———————————————— 移动/攻击命令（去重，避免重复寻路） ————————————————
  goTo(x, y, { force = false, tol = 90 } = {}) {
    const c = this.champ;
    const now = this.game.time;
    if (!force && c.attackState) return false;
    if (!force && this.dodger.active && now < this.dodger.active.until) return false;
    if (c.channel && !c.isRecalling && !c.channel.canMove) return false;
    if (Math.abs(c.x - x) + Math.abs(c.y - y) < 40) return true;
    const cmd = c.command;
    if (cmd && cmd.type === 'move' && Math.abs(cmd.x - x) + Math.abs(cmd.y - y) < tol && (c.path.length || c.moving)) return true;
    const lm = this._lastMove;
    if (Math.abs(lm.x - x) + Math.abs(lm.y - y) < tol && now - lm.t < 1.0 && cmd && cmd.type === 'move') return true;
    c.moveTo(x, y);
    this._lastMove = { x, y, t: now };
    return true;
  }

  attack(u) {
    const c = this.champ;
    if (!u || !u.alive) return false;
    if (this.dodger.active && this.game.time < this.dodger.active.until) return false;
    if (c.channel && !c.isRecalling && !c.channel.canAttack) return false;
    const cmd = c.command;
    if (cmd && cmd.type === 'attack' && cmd.target === u) return true;
    return c.attackUnit(u);
  }
}

Object.assign(ChampionAI.prototype, AbilityMixin, LaningMixin, JungleMixin, ObjectiveMixin);
