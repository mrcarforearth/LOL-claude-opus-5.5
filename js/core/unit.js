// 单位基类：属性、命令（移动/普攻/攻击移动）、普攻前摇与走砍、控制效果、Buff/护盾、位移、引导、钩子、动画状态
import { Entity } from './entity.js';
import { normalizeBaseStats, computeStats } from './stats.js';
import { addBuffTo, removeBuffFrom, updateBuffs, addShieldTo, updateShields } from './buffs.js';
import { creditChampion } from './damage.js';
import { NO_TENACITY_CC, UNCLEANSABLE_CC, MAP_SIZE } from '../config.js';
import { clamp, norm } from './math.js';

// 各类限制对应的控制类型
const MOVE_BLOCK = new Set(['stun', 'root', 'airborne', 'charm', 'fear', 'taunt', 'suppress', 'sleep']);
const ATTACK_BLOCK = new Set(['stun', 'airborne', 'charm', 'fear', 'suppress', 'sleep', 'disarm']);
const CAST_BLOCK = new Set(['stun', 'airborne', 'silence', 'charm', 'fear', 'taunt', 'suppress', 'sleep']);
const SUMMONER_BLOCK = new Set(['stun', 'airborne', 'charm', 'fear', 'taunt', 'suppress', 'sleep']);
const DASH_BLOCK = new Set(['stun', 'root', 'ground', 'airborne', 'suppress', 'sleep', 'charm', 'fear', 'taunt']);
const CHANNEL_BREAK = new Set(['stun', 'airborne', 'charm', 'fear', 'taunt', 'suppress', 'sleep']);
const DASH_BREAK = new Set(['stun', 'airborne', 'suppress', 'sleep', 'charm', 'fear', 'taunt']);
const STUN_LIKE = new Set(['stun', 'suppress', 'sleep']);
const IMMOBILE = new Set(['stun', 'suppress', 'sleep', 'airborne', 'root']);
const IMPAIR = new Set(['stun', 'root', 'airborne', 'charm', 'fear', 'taunt', 'suppress', 'sleep', 'silence', 'disarm', 'ground']);
const STRUCTURE_TYPES = new Set(['turret', 'inhibitor', 'nexus']);
// 攻击移动可自动锁定的目标类型
const ATTACK_MOVE_TYPES = ['champion', 'minion', 'monster', 'pet', 'turret', 'inhibitor', 'nexus', 'ward'];

export class Unit extends Entity {
  constructor(game, { type, team, x, y, name, modelId, baseStats, level = 1, radius } = {}) {
    const bs = normalizeBaseStats(baseStats);
    super(game, { type, team, x, y, radius: radius ?? bs.radius ?? 65 });
    this.name = name || type;
    this.modelId = modelId || type;
    this.level = level;
    this.baseStats = bs;
    this.bonusStats = {};
    this.buffs = [];
    this.shields = [];
    this.ccs = [];                 // [{ type, until, source, amount, x, y, start, duration }]
    this.hooks = {};
    this.owner = null;
    this.command = null;
    this.path = [];
    this.attackTarget = null;
    this.attackCooldown = 0;
    this.attackState = null;
    this.dashState = null;
    this.channel = null;
    this.castLock = 0;
    this._castLockMove = false;    // 施法前摇期间是否锁定移动
    this.anim = { state: 'idle', t: 0, speed: 1, slot: null, windup: 0, attackIndex: 0 };
    this.modelState = {};
    this.invulnerable = false;
    this.untargetable = false;
    this.unstoppable = false;
    this.stealthed = false;
    this.softCollision = false;
    this.lastDamagedAt = -99;
    this.lastCombatAt = -99;
    this.lastAttackAt = -99;
    this.damageLog = new Map();
    this.xpValue = 0;
    this.goldValue = 0;
    this.deathTime = null;
    this.moving = false;           // 本 tick 是否移动（动画用）
    this._repathAt = 0;
    this._chaseTarget = null;
    this._chaseGoal = null;
    this._attackAnimUntil = -1;
    this._castAnimUntil = -1;
    this._airArc = null;
    this._fearDir = null;
    this.stats = computeStats(this, {});
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
  }

  get isStructure() { return STRUCTURE_TYPES.has(this.type); }

  // —— 属性 ——
  recalcStats() {
    const s = this.stats;
    const prevMax = s.maxHp, prevMana = s.maxMana;
    computeStats(this, s);
    if (this.alive) {
      const d = s.maxHp - prevMax;
      if (d > 0) this.hp += d; // 最大生命增加时当前生命同步增加
      if (this.hp > s.maxHp) this.hp = s.maxHp;
      const dm = s.maxMana - prevMana;
      if (dm > 0) this.mana += dm;
      if (this.mana > s.maxMana) this.mana = s.maxMana;
    }
    return s;
  }
  get maxHp() { return this.stats.maxHp; }
  get maxMana() { return this.stats.maxMana; }
  get ad() { return this.stats.ad; }
  get ap() { return this.stats.ap; }
  get armor() { return this.stats.armor; }
  get mr() { return this.stats.mr; }
  get attackSpeed() { return this.stats.attackSpeed; }
  get attackRange() { return this.stats.attackRange; }
  get moveSpeed() { return this.stats.moveSpeed; }
  get hpPct() { return this.stats.maxHp > 0 ? this.hp / this.stats.maxHp : 0; }
  get totalShield() {
    let s = 0;
    for (let i = 0; i < this.shields.length; i++) s += this.shields[i].amount;
    return s;
  }

  // —— 命令 ——
  moveTo(x, y) {
    if (!this.alive) return false;
    if (this.channel && this.channel.interruptOnMove && !this.channel.canMove) this.interruptChannel('move');
    if (this.attackState) this.attackState = null; // 前摇中移动 = 取消普攻（不进 CD）
    this.command = { type: 'move', x, y };
    this._setPathTo(x, y);
    return true;
  }

  attackUnit(target) {
    if (!this.alive || !target || target === this) return false;
    if (this.channel && this.channel.interruptOnMove) this.interruptChannel('move');
    if (this.attackState && this.attackState.target !== target) this.attackState = null;
    if (this.command && this.command.type === 'attack' && this.command.target === target) return true;
    this.command = { type: 'attack', target };
    this.attackTarget = target;
    this._chaseTarget = null;
    this._repathAt = 0;
    return true;
  }

  attackMove(x, y) {
    if (!this.alive) return false;
    if (this.channel && this.channel.interruptOnMove) this.interruptChannel('move');
    this.command = { type: 'attackMove', x, y, target: null, nextScan: 0 };
    this._setPathTo(x, y);
    return true;
  }

  stop() {
    if (this.channel && this.channel.interruptOnMove) this.interruptChannel('stop');
    this.command = null;
    this.path.length = 0;
    this.attackState = null;
    this.attackTarget = null;
  }

  faceTowards(x, y) {
    const dx = x - this.x, dy = y - this.y;
    if (dx * dx + dy * dy > 1e-4) this.facing = Math.atan2(dy, dx);
  }

  resetAttack() { this.attackCooldown = 0; }

  // —— 状态查询 ——
  hasCC(type) {
    const list = this.ccs;
    for (let i = 0; i < list.length; i++) if (list[i].type === type) return true;
    return false;
  }
  _hasAnyCC(set) {
    const list = this.ccs;
    for (let i = 0; i < list.length; i++) if (set.has(list[i].type)) return true;
    return false;
  }
  ccRemaining(type) {
    let m = 0;
    for (const c of this.ccs) if (c.type === type) m = Math.max(m, c.until - this.game.time);
    return m;
  }
  getCC(type) {
    let best = null;
    for (const c of this.ccs) if (c.type === type && (!best || c.until > best.until)) best = c;
    return best;
  }
  isCCd() { return this._hasAnyCC(IMPAIR); }
  isHardCCd() { return this._hasAnyCC(CHANNEL_BREAK); }
  strongestSlow() {
    let m = 0;
    const list = this.ccs;
    for (let i = 0; i < list.length; i++) if (list[i].type === 'slow' && list[i].amount > m) m = list[i].amount;
    return m;
  }
  _attackDisabledByBuff() {
    const b = this.buffs;
    for (let i = 0; i < b.length; i++) if (b[i].disableAttack) return true;
    return false;
  }
  get ghosted() {
    const b = this.buffs;
    for (let i = 0; i < b.length; i++) if (b[i].ghosted) return true;
    return false;
  }

  canMove() {
    if (!this.alive || this.dashState) return false;
    if ((this.baseStats.ms || 0) <= 0) return false;
    if (this.castLock > 0 && this._castLockMove) return false;
    if (this.channel && !this.channel.canMove) return false;
    return !this._hasAnyCC(MOVE_BLOCK);
  }
  canAttack() {
    if (!this.alive || this.dashState) return false;
    if (this.castLock > 0) return false;
    if (this.channel && !this.channel.canAttack) return false;
    if (this._hasAnyCC(ATTACK_BLOCK)) return false;
    return !this._attackDisabledByBuff();
  }
  canCast() {
    if (!this.alive) return false;
    return !this._hasAnyCC(CAST_BLOCK);
  }
  canUseSummoner() {
    if (!this.alive) return false;
    return !this._hasAnyCC(SUMMONER_BLOCK);
  }
  canDash() { return this.alive && !this._hasAnyCC(DASH_BLOCK); }

  isEnemy(other) {
    const t = typeof other === 'number' ? other : other && other.team;
    return t != null && t !== this.team;
  }
  isAlly(other) {
    const t = typeof other === 'number' ? other : other && other.team;
    return t === this.team;
  }
  distTo(o) { const dx = o.x - this.x, dy = o.y - this.y; return Math.sqrt(dx * dx + dy * dy); }
  edgeDist(o) { return this.distTo(o) - this.radius - (o.radius || 0); }
  inAttackRange(target, extra = 0) {
    const r = this.stats.attackRange + this.radius + (target.radius || 0) + extra;
    const dx = target.x - this.x, dy = target.y - this.y;
    return dx * dx + dy * dy <= r * r;
  }
  isTargetableBy(unit) {
    if (!this.alive || this.removed || this.untargetable) return false;
    if (!unit || unit.team === this.team) return true;
    if (unit.team !== 0 && unit.team !== 1) return true; // 中立野怪不受视野限制
    return this.game.isVisible(unit.team, this);
  }
  _validAttackTarget(t) {
    return t && t.alive && !t.removed && !t.untargetable && t.team !== this.team && t.isTargetableBy(this);
  }

  // —— 控制效果 ——
  applyCC(type, duration, { source = null, amount = 0, x, y } = {}) {
    if (!this.alive || !(duration > 0)) return false;
    if (this.unstoppable || this.isStructure) return false;
    let d = duration;
    if (!NO_TENACITY_CC.includes(type)) d *= 1 - (this.stats.tenacity || 0);
    if (d <= 0.01) return false;
    const now = this.game.time;
    // 同来源同类型：合并取较长/较强
    const same = this.ccs.find((c) => c.type === type && c.source === source);
    if (same) {
      same.until = Math.max(same.until, now + d);
      same.amount = Math.max(same.amount, amount || 0);
      same.duration = Math.max(same.duration, d);
      if (x != null) { same.x = x; same.y = y; }
    } else {
      this.ccs.push({ type, until: now + d, source, amount: amount || 0, x, y, start: now, duration: d });
    }
    // 打断引导
    if (this.channel) {
      if (CHANNEL_BREAK.has(type)) this.interruptChannel('cc');
      else if (type === 'silence' && this.channel.id !== 'recall') this.interruptChannel('silence');
    }
    // 打断位移（强制位移除外）
    if (this.dashState && !this.dashState.forced && DASH_BREAK.has(type)) this._endDash(true);
    if (CHANNEL_BREAK.has(type) || type === 'disarm') this.attackState = null;
    if (CAST_BLOCK.has(type) && this.castLock > 0 && this._interruptPendingCast) this._interruptPendingCast(type);
    if (type === 'fear') this._fearDir = null;
    // 助攻判定：控制也计入
    const credit = creditChampion(source);
    if (credit && credit.team !== this.team) this.damageLog.set(credit.championId, now);
    if (source && source !== this) this.lastCombatAt = now;
    this.game.events.emit('cc', { source, target: this, type, duration: d });
    if (type === 'stun' || type === 'silence') this.game.fx.attach({ unit: this, kind: type, duration: d });
    return true;
  }

  slow(amount, duration, source) {
    return this.applyCC('slow', duration, { source, amount: clamp(amount, 0, 0.99) });
  }

  removeCC(type) {
    const before = this.ccs.length;
    this.ccs = this.ccs.filter((c) => c.type !== type);
    return before !== this.ccs.length;
  }

  // 净化：移除除击飞/压制外的控制与可净化的负面 Buff
  cleanse() {
    this.ccs = this.ccs.filter((c) => UNCLEANSABLE_CC.includes(c.type));
    for (const b of this.buffs.slice()) if (b.cleansable && b.isDebuff) removeBuffFrom(this, b, 'cleanse');
    return true;
  }

  _updateCCs() {
    const list = this.ccs;
    if (list.length === 0) return;
    const now = this.game.time;
    for (let i = list.length - 1; i >= 0; i--) if (now >= list[i].until) list.splice(i, 1);
  }

  // —— Buff / 护盾 ——
  addBuff(def) { return addBuffTo(this, def); }
  removeBuff(idOrBuff) { return removeBuffFrom(this, idOrBuff); }
  getBuff(id) {
    const b = this.buffs;
    for (let i = 0; i < b.length; i++) if (b[i].id === id && !b[i].removed) return b[i];
    return null;
  }
  hasBuff(id) { return !!this.getBuff(id); }
  buffStacks(id) { const b = this.getBuff(id); return b ? b.stacks : 0; }
  addShield(amount, duration, opts = {}) { return addShieldTo(this, amount, duration, opts); }
  removeShield(id) {
    const i = this.shields.findIndex((s) => s.id === id);
    if (i >= 0) { this.shields.splice(i, 1); return true; }
    return false;
  }

  // —— 位移 ——
  dash(opts = {}) {
    if (!this.alive || this.isStructure) return false;
    if (!this.canDash()) return false;
    const game = this.game;
    if (this.dashState) this._endDash(true);
    if (this.channel) this.interruptChannel('dash');
    this.attackState = null;
    this.path.length = 0;
    if (this.command && this.command.type === 'move') this.command = null;
    const follow = opts.followTarget || null;
    let tx = follow ? follow.x : opts.x, ty = follow ? follow.y : opts.y;
    if (tx == null || ty == null) return false;
    tx = clamp(tx, 1, MAP_SIZE - 1); ty = clamp(ty, 1, MAP_SIZE - 1);
    const total = Math.hypot(tx - this.x, ty - this.y);
    let speed = opts.speed ?? 1200;
    if (opts.duration != null && opts.duration > 0) speed = Math.max(1, total / opts.duration);
    const d = {
      forced: false, sx: this.x, sy: this.y, tx, ty, speed, total, traveled: 0, elapsed: 0,
      duration: opts.duration ?? null,
      arcHeight: opts.arcHeight || 0, ignoreWalls: !!opts.ignoreWalls,
      unstoppable: !!opts.unstoppable, prevUnstoppable: this.unstoppable,
      hitRadius: opts.hitRadius || 0, onHitUnit: opts.onHitUnit || null, hitFilter: opts.hitFilter || null,
      hitSet: new Set(), onEnd: opts.onEnd || null, faceDir: opts.faceDir !== false,
      followTarget: follow, stopDistance: opts.stopDistance || 0, source: this,
    };
    if (d.unstoppable) this.unstoppable = true;
    if (d.faceDir) this.faceTowards(tx, ty);
    this.dashState = d;
    game.markMoved();
    return true;
  }

  // 强制位移（击退/拉拽）：期间处于 airborne，由 applyCC 负责时长
  _forcedMove(tx, ty, speed, height, source, stopDistance = 0) {
    if (this.dashState) this._endDash(true);
    tx = clamp(tx, 1, MAP_SIZE - 1); ty = clamp(ty, 1, MAP_SIZE - 1);
    const total = Math.hypot(tx - this.x, ty - this.y);
    this.dashState = {
      forced: true, sx: this.x, sy: this.y, tx, ty, speed: Math.max(1, speed), total, traveled: 0, elapsed: 0,
      duration: null, arcHeight: height || 0, ignoreWalls: false, unstoppable: false, prevUnstoppable: this.unstoppable,
      hitRadius: 0, onHitUnit: null, hitFilter: null, hitSet: null, onEnd: null, faceDir: false,
      followTarget: null, stopDistance, source,
    };
    this.path.length = 0;
    this.game.markMoved();
  }

  knockback({ fromX, fromY, distance, duration = 0.4, source = null, height = 120 } = {}) {
    if (!this.alive || this.unstoppable || this.isStructure) return false;
    if (!this.applyCC('airborne', duration, { source })) return false;
    const dir = norm(this.x - fromX, this.y - fromY, { x: -Math.cos(this.facing), y: -Math.sin(this.facing) });
    this._forcedMove(this.x + dir.x * distance, this.y + dir.y * distance, distance / Math.max(0.05, duration), height, source);
    return true;
  }

  knockup(duration, source = null, height = 160) {
    if (!this.alive || this.unstoppable || this.isStructure) return false;
    if (!this.applyCC('airborne', duration, { source })) return false;
    this._airArc = { start: this.game.time, duration, height };
    return true;
  }

  pullTo({ x, y, speed = 1500, source = null, stopDistance = 0, height = 60 } = {}) {
    if (!this.alive || this.unstoppable || this.isStructure) return false;
    const d = Math.max(0, Math.hypot(x - this.x, y - this.y) - stopDistance);
    const duration = Math.max(0.05, d / speed);
    if (!this.applyCC('airborne', duration + 0.05, { source })) return false;
    this._forcedMove(x, y, speed, height, source, stopDistance);
    return true;
  }

  // 瞬移：目标不可走时沿「目标→起点」方向找最近可走点
  blink(x, y) {
    if (!this.alive) return false;
    const nav = this.game.nav;
    let tx = clamp(x, 1, MAP_SIZE - 1), ty = clamp(y, 1, MAP_SIZE - 1);
    if (!nav.isWalkable(tx, ty)) {
      const dx = this.x - tx, dy = this.y - ty;
      const L = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(L / 20));
      let found = false;
      for (let i = 1; i <= steps; i++) {
        const px = tx + (dx * i) / steps, py = ty + (dy * i) / steps;
        if (nav.isWalkable(px, py)) { tx = px; ty = py; found = true; break; }
      }
      if (!found) { const p = nav.nearestWalkable(tx, ty); tx = p.x; ty = p.y; }
    }
    if (this.dashState) this._endDash(true);
    if (this.channel && this.channel.interruptOnMove) this.interruptChannel('move');
    this.x = tx; this.y = ty;
    this.path.length = 0;
    this.attackState = null;
    if (this.command && this.command.type === 'move') this.command = null;
    this._repathAt = 0;
    this.game.markMoved();
    return true;
  }

  // 直接放置到某处（复活/回城用），保证在可走格
  setPosition(x, y) {
    const nav = this.game.nav;
    if (!nav.isWalkable(x, y)) { const p = nav.nearestWalkable(x, y); x = p.x; y = p.y; }
    this.x = x; this.y = y;
    this.path.length = 0;
    this.game.markMoved();
  }

  _endDash(interrupted) {
    const d = this.dashState;
    if (!d) return;
    this.dashState = null;
    this.z = 0;
    const nav = this.game.nav;
    if (!nav.isWalkable(this.x, this.y)) {
      const p = nav.nearestWalkable(this.x, this.y);
      this.x = p.x; this.y = p.y;
    }
    if (d.unstoppable) this.unstoppable = d.prevUnstoppable;
    this.game.markMoved();
    if (d.onEnd) d.onEnd(interrupted, d);
  }

  _updateDash(dt) {
    const d = this.dashState;
    const game = this.game;
    d.elapsed += dt;
    if (d.followTarget) {
      const t = d.followTarget;
      if (t.alive && !t.removed) { d.tx = t.x; d.ty = t.y; }
    }
    const dx = d.tx - this.x, dy = d.ty - this.y;
    const left = Math.hypot(dx, dy);
    const stopAt = d.stopDistance + (d.followTarget ? (d.followTarget.radius || 0) : 0);
    let step = d.speed * dt;
    let arrive = false;
    if (left - stopAt <= step) { step = Math.max(0, left - stopAt); arrive = true; }
    const px = this.x, py = this.y;
    if (left > 1e-6 && step > 0) {
      const nx = this.x + (dx / left) * step, ny = this.y + (dy / left) * step;
      if (!d.ignoreWalls && !game.nav.isWalkable(nx, ny)) {
        // 撞墙：停在最后一个可走点
        const p = game.nav.raycastWalk(this.x, this.y, nx, ny);
        this.x = p.x; this.y = p.y;
        d.hitWall = true;
        arrive = true;
      } else {
        this.x = nx; this.y = ny;
      }
      d.traveled += Math.hypot(this.x - px, this.y - py);
    }
    if (d.faceDir && left > 1) this.facing = Math.atan2(dy, dx);
    // 路径上的碰撞
    if (d.hitRadius > 0 && d.onHitUnit) {
      const hits = game.queryLine({ x1: px, y1: py, x2: this.x, y2: this.y, width: d.hitRadius, enemyOf: this, filter: (u) => !u.untargetable });
      for (const u of hits) {
        if (d.hitSet.has(u)) continue;
        if (d.hitFilter && !d.hitFilter(u)) continue;
        d.hitSet.add(u);
        d.onHitUnit(u);
        if (!this.dashState) return;
      }
    }
    if (d.duration != null && d.elapsed >= d.duration) arrive = true;
    // 高度弧线
    if (d.arcHeight > 0) {
      const total = Math.max(1, d.followTarget ? d.traveled + Math.max(0, left - step - stopAt) : d.total);
      const p = clamp(d.traveled / total, 0, 1);
      this.z = 4 * d.arcHeight * p * (1 - p);
    }
    if (arrive) this._endDash(false);
  }

  // —— 引导 ——
  startChannel({ id, duration, onComplete, onInterrupt, onTick, interruptOnMove = true, interruptOnDamage = false, canMove = false, canAttack = false, anim = 'channel', data = {} } = {}) {
    if (this.channel) this.interruptChannel('replaced');
    if (!canMove) {
      this.path.length = 0;
      this.command = null;
    }
    if (!canAttack) this.attackState = null;
    const game = this.game;
    const ch = {
      id, duration, t: 0, startedAt: game.time, onComplete, onInterrupt, onTick,
      interruptOnMove, interruptOnDamage, canMove, canAttack, anim, data,
      get remaining() { return Math.max(0, this.duration - this.t); },
      get progress() { return this.duration > 0 ? Math.min(1, this.t / this.duration) : 1; },
    };
    this.channel = ch;
    return ch;
  }

  interruptChannel(reason = 'interrupt') {
    const ch = this.channel;
    if (!ch) return false;
    this.channel = null;
    if (ch.onInterrupt) ch.onInterrupt(this, reason, ch);
    return true;
  }

  _updateChannel(dt) {
    const ch = this.channel;
    ch.t += dt;
    if (ch.onTick) ch.onTick(this, ch, dt);
    if (this.channel !== ch) return;
    if (ch.t >= ch.duration - 1e-9) {
      this.channel = null;
      if (ch.onComplete) ch.onComplete(this, ch);
    }
  }

  // —— 钩子 ——
  addHook(name, fn) {
    (this.hooks[name] || (this.hooks[name] = [])).push(fn);
    return () => {
      const list = this.hooks[name];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
  runHooks(name, ...args) {
    const list = this.hooks[name];
    if (!list || list.length === 0) return;
    const snap = list.length === 1 ? list : list.slice();
    for (let i = 0; i < snap.length; i++) snap[i](...args);
  }

  // —— 寻路与移动 ——
  _setPathTo(x, y) {
    const nav = this.game.nav;
    x = clamp(x, 1, MAP_SIZE - 1); y = clamp(y, 1, MAP_SIZE - 1);
    let path = null;
    if (nav.isWalkable(x, y) && nav.hasLineOfWalk(this.x, this.y, x, y)) {
      path = [{ x, y }];
    } else {
      path = nav.findPath(this.x, this.y, x, y);
      if (!path || path.length === 0) {
        const p = nav.nearestWalkable(x, y);
        path = nav.hasLineOfWalk(this.x, this.y, p.x, p.y) ? [p] : [];
      }
    }
    this.path = path;
    this._chaseGoal = { x, y };
    return path.length > 0;
  }

  // 尝试移动到 (nx, ny)，墙体时沿轴滑动；返回是否移动
  _tryMove(nx, ny) {
    const nav = this.game.nav;
    nx = clamp(nx, 1, MAP_SIZE - 1); ny = clamp(ny, 1, MAP_SIZE - 1);
    if (nav.isWalkable(nx, ny)) { this.x = nx; this.y = ny; return true; }
    if (nav.isWalkable(nx, this.y)) { this.x = nx; return true; }
    if (nav.isWalkable(this.x, ny)) { this.y = ny; return true; }
    if (!nav.isWalkable(this.x, this.y)) {
      const p = nav.nearestWalkable(this.x, this.y, 600);
      this.x = p.x; this.y = p.y;
      return true;
    }
    return false;
  }

  // 按移速朝某点直线移动（不寻路）
  _stepTowards(tx, ty, dt, speedMult = 1) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) return false;
    const s = Math.min(d, this.stats.moveSpeed * speedMult * dt);
    const ok = this._tryMove(this.x + (dx / d) * s, this.y + (dy / d) * s);
    if (ok) this.facing = Math.atan2(dy, dx);
    return ok;
  }

  _followPath(dt) {
    if (!this.canMove() || this.path.length === 0) return false;
    let budget = this.stats.moveSpeed * dt;
    let moved = false;
    let guard = 0;
    while (budget > 1e-6 && this.path.length && guard++ < 8) {
      const p = this.path[0];
      const dx = p.x - this.x, dy = p.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-3) this.facing = Math.atan2(dy, dx);
      if (d <= budget) {
        if (!this._tryMove(p.x, p.y)) { this.path.length = 0; break; }
        budget -= d;
        this.path.shift();
        moved = true;
      } else {
        const ox = this.x, oy = this.y;
        if (!this._tryMove(this.x + (dx / d) * budget, this.y + (dy / d) * budget)) { this.path.length = 0; break; }
        if (Math.abs(this.x - ox) + Math.abs(this.y - oy) < 1e-3) { this.path.length = 0; break; }
        budget = 0;
        moved = true;
      }
    }
    return moved;
  }

  _chase(dt, target) {
    const now = this.game.time;
    const g = this._chaseGoal;
    const movedFar = !g || (target.x - g.x) ** 2 + (target.y - g.y) ** 2 > 100 * 100;
    if (this._chaseTarget !== target || now >= this._repathAt || movedFar || this.path.length === 0) {
      this._chaseTarget = target;
      this._repathAt = now + 0.25;
      this._setPathTo(target.x, target.y);
    }
    return this._followPath(dt);
  }

  // —— 普攻 ——
  _startAttack(target) {
    const interval = 1 / this.stats.attackSpeed;
    const windup = Math.max(0.05, interval * (this.baseStats.windup ?? 0.3));
    this.attackState = { phase: 'windup', t: 0, target, windup, interval };
    this.attackTarget = target;
    this.path.length = 0;
    this.faceTowards(target.x, target.y);
    this.anim.attackIndex++;
    this.anim.windup = windup;
    this.anim.state = 'attack';
    this.anim.t = 0;
    this._attackAnimUntil = this.game.time + interval;
    this._castAnimUntil = -1; // 普攻覆盖瞬发技能的施法动画
  }

  _updateAttackWindup(dt) {
    const st = this.attackState;
    if (!st) return;
    const t = st.target;
    if (!this._validAttackTarget(t) || !this.canAttack()) { this.attackState = null; return; }
    st.t += dt;
    this.faceTowards(t.x, t.y);
    if (st.t >= st.windup - 1e-9) {
      this.attackState = null;
      this._launchAttack(t, st);
    }
  }

  _launchAttack(target, st) {
    const game = this.game;
    const crit = this.stats.crit;
    const isCrit = crit > 0 && (crit >= 1 || game.rng() < crit);
    const hit = { damage: 0, type: 'physical', isCrit, extra: [], miss: this.hasCC('blind'), attacker: this };
    this.attackCooldown = Math.max(0, st.interval - st.windup);
    this.lastAttackAt = game.time;
    this.lastCombatAt = game.time;
    this._attackAnimUntil = game.time + Math.min(0.6, (st.interval - st.windup) * 0.85);
    this.runHooks('onAttackLaunch', target, hit);
    game.events.emit('basicAttack', { attacker: this, target, isCrit });
    // 在草丛中普攻会暴露自己
    if ((this.type === 'champion' || this.type === 'pet') && game.nav.brushAt(this.x, this.y) >= 0) {
      this.revealedUntil = Math.max(this.revealedUntil, game.time + 1);
    }
    const ms = this.baseStats.missileSpeed || 0;
    if (ms > 0) {
      game.spawnProjectile({
        owner: this, target, speed: ms, width: 0, isBasicAttack: true,
        vfx: this.baseStats.attackVfx || { kind: 'basic', color: 0xffffff, size: 1 },
        height: this.baseStats.missileHeight || 100,
        onHit: () => { this.resolveAttackHit(target, hit); return true; },
      });
    } else {
      this.resolveAttackHit(target, hit);
    }
  }

  // 普攻命中结算（远程投射物到达时调用）
  resolveAttackHit(target, hit) {
    const game = this.game;
    if (!target || !target.alive) return;
    if (hit.miss) {
      game.fx.text({ x: target.x, y: target.y, text: '未命中', color: 0xcccccc, size: 16 });
      game.events.emit('attackHit', { attacker: this, target, isCrit: false, miss: true });
      return;
    }
    hit.damage = this.stats.ad * (hit.isCrit ? this.stats.critMult : 1);
    this.runHooks('onHit', target, hit);
    const isTurret = this.type === 'turret';
    const isPet = this.type === 'pet';
    game.dealDamage(this, target, hit.damage, hit.type, { isBasicAttack: true, isCrit: hit.isCrit, isTurret, isPet });
    for (let i = 0; i < hit.extra.length; i++) {
      const e = hit.extra[i];
      if (!target.alive) break;
      game.dealDamage(this, target, e.amount, e.type || 'physical', { isOnHit: true, spell: e.spell || null, isAbility: !!e.isAbility, isPet });
    }
    this.runHooks('afterHit', target, hit);
    game.events.emit('attackHit', { attacker: this, target, isCrit: hit.isCrit });
  }

  _updateAttackCommand(dt, target) {
    if (!this._validAttackTarget(target)) {
      if (this.command && this.command.type === 'attack') this.command = null;
      this.path.length = 0;
      this.attackTarget = null;
      return false;
    }
    if (this.inAttackRange(target)) {
      this.path.length = 0;
      if (!this.attackState && this.attackCooldown <= 0 && this.canAttack()) this._startAttack(target);
      else if (!this.attackState && this.canAttack()) this.faceTowards(target.x, target.y);
      return false;
    }
    if (this.attackState) return false; // 前摇中不追击
    return this._chase(dt, target);
  }

  _findAttackMoveTarget(cmd) {
    const g = this.game;
    return g.nearest({
      x: this.x, y: this.y, radius: this.stats.attackRange + this.radius + 300,
      enemyOf: this, targetableBy: this, types: ATTACK_MOVE_TYPES,
      filter: (u) => !u.invulnerable,
    });
  }

  _updateCommand(dt) {
    const cmd = this.command;
    if (!cmd) return false;
    switch (cmd.type) {
      case 'move': {
        const moved = this._followPath(dt);
        if (this.path.length === 0 && this.canMove()) this.command = null;
        return moved;
      }
      case 'attack':
        return this._updateAttackCommand(dt, cmd.target);
      case 'attackMove': {
        const now = this.game.time;
        if (cmd.target && !this._validAttackTarget(cmd.target)) {
          cmd.target = null;
          this._setPathTo(cmd.x, cmd.y);
        }
        if (!cmd.target && now >= cmd.nextScan) {
          cmd.nextScan = now + 0.1;
          const t = this._findAttackMoveTarget(cmd);
          if (t) { cmd.target = t; this.attackTarget = t; }
        }
        if (cmd.target) return this._updateAttackCommand(dt, cmd.target);
        if (this.path.length === 0) this._setPathTo(cmd.x, cmd.y);
        const moved = this._followPath(dt);
        if (Math.hypot(cmd.x - this.x, cmd.y - this.y) < 30 || (this.path.length === 0 && !moved && this.canMove())) this.command = null;
        return moved;
      }
      case 'stop':
        this.command = null;
        this.path.length = 0;
        return false;
      default:
        return this._updateCustomCommand(dt, cmd);
    }
  }

  // 子类扩展命令（如英雄的 castMove）
  _updateCustomCommand(dt, cmd) { this.command = null; return false; } // eslint-disable-line no-unused-vars

  // 魅惑/恐惧/嘲讽的强制行为；返回是否移动
  _updateForcedBehavior(dt) {
    let charm = null, fear = null, taunt = null;
    for (const c of this.ccs) {
      if (c.type === 'charm') charm = c;
      else if (c.type === 'fear') fear = c;
      else if (c.type === 'taunt') taunt = c;
    }
    if (!charm && !fear && !taunt) return null;
    this.path.length = 0;
    // 同时被眩晕/击飞/禁锢等：不能移动
    if (this._hasAnyCC(IMMOBILE)) return false;
    if (charm) {
      const s = charm.source;
      const tx = s && s.alive ? s.x : charm.x ?? this.x, ty = s && s.alive ? s.y : charm.y ?? this.y;
      if (Math.hypot(tx - this.x, ty - this.y) > (s ? s.radius + this.radius : 10)) return this._stepTowards(tx, ty, dt, 0.65);
      return false;
    }
    if (fear) {
      const s = fear.source;
      const now = this.game.time;
      if (!this._fearDir || now >= this._fearDir.until) {
        const sx = s ? s.x : fear.x ?? this.x - 1, sy = s ? s.y : fear.y ?? this.y;
        const base = Math.atan2(this.y - sy, this.x - sx) + (this.game.rng() - 0.5) * 1.2;
        this._fearDir = { a: base, until: now + 0.5 };
      }
      const a = this._fearDir.a;
      return this._stepTowards(this.x + Math.cos(a) * 100, this.y + Math.sin(a) * 100, dt, 1);
    }
    if (taunt) {
      const s = taunt.source;
      if (s && s.alive && !s.removed) {
        if (this.inAttackRange(s)) {
          if (!this.attackState && this.attackCooldown <= 0 && this.canAttack()) this._startAttack(s);
          return false;
        }
        if (this.attackState) return false;
        return this._stepTowards(s.x, s.y, dt, 1);
      }
      return false;
    }
    return null;
  }

  _regen(dt) {
    const s = this.stats;
    if (s.hpRegen > 0 && this.hp < s.maxHp) {
      let r = s.hpRegen * dt;
      if (s.grievous > 0) r *= 1 - s.grievous;
      this.hp = Math.min(s.maxHp, this.hp + r);
    }
    if (s.manaRegen > 0 && this.mana < s.maxMana) this.mana = Math.min(s.maxMana, this.mana + s.manaRegen * dt);
  }

  // 施法前摇结束（英雄实现）
  _finishPendingCast() {}

  // —— 主更新 ——
  update(dt) {
    if (!this.alive) {
      this._updateAnim(dt, false);
      return;
    }
    const now = this.game.time;
    this._updateCCs();
    updateBuffs(this, dt);
    if (!this.alive) return;
    updateShields(this);
    this.recalcStats();
    this._regen(dt);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.castLock > 0) {
      this.castLock -= dt;
      if (this.castLock <= 0) { this.castLock = 0; this._finishPendingCast(); }
      if (!this.alive) return;
    }
    let moved = false;
    if (this.dashState) {
      const px = this.x, py = this.y;
      this._updateDash(dt);
      moved = px !== this.x || py !== this.y;
    } else {
      if (this.channel) this._updateChannel(dt);
      if (!this.alive) return;
      const forced = this._updateForcedBehavior(dt);
      if (forced !== null) moved = forced;
      else if (!this._hasAnyCC(CHANNEL_BREAK)) moved = this._updateCommand(dt);
      this._updateAttackWindup(dt);
    }
    // 击飞（原地）高度
    if (this._airArc && !this.dashState) {
      const a = this._airArc;
      const p = (now - a.start) / a.duration;
      if (p >= 1 || !this.hasCC('airborne')) { this._airArc = null; this.z = 0; } else this.z = 4 * a.height * p * (1 - p);
    }
    this.moving = moved;
    this._updateAnim(dt, moved);
  }

  _updateAnim(dt, moved) {
    const now = this.game.time;
    const a = this.anim;
    if (moved && !this.attackState) this._attackAnimUntil = -1; // 移动取消普攻后摇动画
    if (moved && this.castLock <= 0) this._castAnimUntil = -1;   // 移动取消瞬发技能的施法动画
    let state;
    if (!this.alive) state = 'death';
    else if (this.hasCC('airborne')) state = 'airborne';
    else if (this._hasAnyCC(STUN_LIKE)) state = 'stunned';
    else if (this.dashState) state = 'dash';
    else if (this.channel) state = this.channel.anim === 'recall' ? 'recall' : (this.channel.anim || 'channel');
    else if (this.castLock > 0 || now < this._castAnimUntil) state = 'cast';
    else if (this.attackState || (now < this._attackAnimUntil && !moved)) state = 'attack';
    else if (moved) state = 'run';
    else state = 'idle';
    if (state !== a.state) { a.state = state; a.t = 0; } else a.t += dt;
    if (state === 'attack') a.speed = this.stats.attackSpeed / (this.baseStats.as || 0.625);
    else if (state === 'run') a.speed = this.stats.moveSpeed / (this.baseStats.ms || 325);
    else a.speed = 1;
  }

  // 施法动画（技能/召唤师技能调用）
  playCastAnim(slot, duration = 0.4) {
    this.anim.state = 'cast';
    this.anim.t = 0;
    this.anim.slot = slot;
    this._castAnimUntil = this.game.time + duration;
  }

  // —— 生命周期 ——
  die(killer) {
    if (!this.alive) return;
    // beforeDeath 钩子：设 ctx.cancel = true 可阻止死亡（守护天使等），生命保留至少 1
    if (this.hooks && this.hooks.beforeDeath) {
      const ctx = { killer, cancel: false };
      this.runHooks('beforeDeath', ctx);
      if (ctx.cancel) { this.hp = Math.max(1, this.hp); return; }
    }
    const game = this.game;
    this.alive = false;
    this.hp = 0;
    if (this.channel) this.interruptChannel('death');
    if (this.dashState) this._endDash(true);
    this.attackState = null;
    this.command = null;
    this.path.length = 0;
    this.castLock = 0;
    this.ccs.length = 0;
    this.shields.length = 0;
    this.z = 0;
    this._airArc = null;
    for (const b of this.buffs.slice()) if (!b.persistOnDeath) removeBuffFrom(this, b, 'death');
    this.deathTime = game.time;
    this.anim.state = 'death';
    this.anim.t = 0;
    this.runHooks('onDeath', killer);
    game.onUnitDeath(this, killer);
    if (this.type !== 'champion' && !this.isStructure) game.remove(this);
  }
}
