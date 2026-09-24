// 小兵：LoL 数值与每 90 秒成长、沿兵线路径点前进、LoL 目标优先级（呼叫支援）、追击距离限制、纳什男爵强化
import { Unit } from '../core/unit.js';
import { RANGES } from '../config.js';

// 基础属性（LoL 数据）
export const MINION_STATS = {
  melee:  { hp: 477, ad: 12, as: 1.25, range: 110, armor: 0, mr: 0, radius: 48, gold: 21, xp: 60.45, missileSpeed: 0, windup: 0.3 },
  caster: { hp: 296, ad: 23.9, as: 0.667, range: 550, armor: 0, mr: 0, radius: 48, gold: 14, xp: 29.76, missileSpeed: 650, windup: 0.25 },
  siege:  { hp: 912, ad: 41, as: 1.0, range: 300, armor: 0, mr: 0, radius: 65, gold: 60, xp: 93, missileSpeed: 1200, windup: 0.25 },
  super:  { hp: 1600, ad: 230, as: 0.85, range: 170, armor: 30, mr: -30, radius: 65, gold: 60, xp: 97, missileSpeed: 0, windup: 0.3 },
};
// 每次成长（每 90 秒一次）增加的生命/攻击力
export const MINION_GROWTH = {
  melee:  { hp: 22, ad: 1 },
  caster: { hp: 8, ad: 1.5 },
  siege:  { hp: 50, ad: 1.5 },
  super:  { hp: 100, ad: 5 },
};
export const MINION_NAMES = { melee: '近战小兵', caster: '远程小兵', siege: '炮车兵', super: '超级兵' };
export const MINION_BASE_MS = 325;
export const ACQUIRE_RANGE = 700;          // 获取目标半径
export const LANE_LEASH = 800;             // 离兵线路径的最大追击距离
export const CALL_FOR_HELP_RANGE = 1000;   // 响应呼叫支援时我方英雄与小兵的最大距离
export const THINK_INTERVAL = 0.25;
export const EMPOWER_RANGE = 1100;         // 纳什男爵之手：强化附近友方小兵的半径
// 纳什男爵强化后的额外属性
export const EMPOWER_STATS = {
  melee:  { adPct: 0.5, damageReduction: 0.3 },
  caster: { adPct: 0.5, damageReduction: 0.3 },
  siege:  { adPct: 0.5, damageReduction: 0.3, attackRange: 450 },
  super:  { adPct: 0.25, damageReduction: 0.3 },
};
// 小兵可以攻击的单位类型（monster 只含两队召唤出的峡谷先锋）
export const TARGET_TYPES = ['minion', 'pet', 'monster', 'champion', 'turret', 'inhibitor', 'nexus'];

const TEAM_COLORS = [0x7ab8ff, 0xff7a8a];

// 当前时间的成长次数
export function minionUpgrades(time) { return Math.max(0, Math.floor(time / 90)); }
// 小兵移速：10 分钟起每 5 分钟 +25（上限 425）
export function minionMoveSpeed(time) {
  const steps = time < 600 ? 0 : Math.min(4, 1 + Math.floor((time - 600) / 300));
  return MINION_BASE_MS + 25 * steps;
}
// 炮车金币：每 90 秒 +3，上限 90
export function siegeGold(time) { return 60 + Math.min(30, 3 * Math.max(0, minionUpgrades(time) - 1)); }

// 点到兵线折线的投影：{ dist, seg（最近线段下标）, t（线段内比例）}
export function laneProjection(pts, x, y) {
  let best = Infinity, seg = 0, bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1];
    const dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x, py = ay + dy * t - y;
    const d2 = px * px + py * py;
    if (d2 < best) { best = d2; seg = i; bt = t; }
  }
  if (pts.length === 1) { const dx = pts[0][0] - x, dy = pts[0][1] - y; best = dx * dx + dy * dy; }
  return { dist: Math.sqrt(best), seg, t: bt };
}

// 单位当前正在普攻的目标（前摇中或 1.5 秒内攻击过）
export function victimOf(u, now) {
  const st = u.attackState;
  if (st && st.target) return st.target;
  const t = u.attackTarget;
  if (t && t.alive && now - (u.lastAttackAt ?? -99) < 1.5) return t;
  return null;
}

export class Minion extends Unit {
  constructor(game, { team, kind = 'melee', lane = 'mid', waypoints = [], x, y } = {}) {
    const s = MINION_STATS[kind] || MINION_STATS.melee;
    const g = MINION_GROWTH[kind] || MINION_GROWTH.melee;
    const up = minionUpgrades(game.time);
    const color = TEAM_COLORS[team] ?? 0xffffff;
    super(game, {
      type: 'minion', team, x, y, name: MINION_NAMES[kind] || '小兵', modelId: `minion_${kind}`,
      baseStats: {
        hp: s.hp + g.hp * up, ad: s.ad + g.ad * up, as: s.as, asRatio: s.as, range: s.range,
        armor: s.armor, mr: s.mr, ms: minionMoveSpeed(game.time), radius: s.radius, windup: s.windup,
        missileSpeed: s.missileSpeed, resource: 'none', hpRegen: 0,
        attackVfx: kind === 'caster' ? { kind: 'casterMinion', color, size: 0.8 }
          : kind === 'siege' ? { kind: 'siegeBall', color, size: 1.2 } : null,
        missileHeight: kind === 'siege' ? 130 : 90,
      },
      radius: s.radius,
    });
    this.kind = MINION_STATS[kind] ? kind : 'melee';
    this.lane = lane;
    this.waypoints = waypoints;
    this.upgrades = up;
    this.softCollision = true;
    this.sightRange = RANGES.SIGHT_MINION;
    this.goldValue = this.kind === 'siege' ? siegeGold(game.time) : s.gold;
    this.xpValue = s.xp;
    this.empowered = false;           // 纳什男爵强化（渲染可读）
    this.targetPriority = 99;         // 当前目标的优先级（1 最高）
    this._laneWalking = false;
    this._helpSet = new Set();
    this._nextThink = game.time + (this.id % 8) * 0.03;
  }

  // 到兵线路径的距离
  laneDistance(x = this.x, y = this.y) {
    if (!this.waypoints || this.waypoints.length === 0) return 0;
    return laneProjection(this.waypoints, x, y).dist;
  }

  // —— 呼叫支援：近期攻击了我方英雄的敌方英雄 ——
  _callsForHelp(now) {
    const set = this._helpSet;
    set.clear();
    const champs = this.game.champions;
    for (let i = 0; i < champs.length; i++) {
      const c = champs[i];
      if (c.team !== this.team || !c.alive) continue;
      if (now - (c.lastChampionDamageAt ?? -99) > 1.0) continue;
      const e = c.lastChampionDamager;
      if (!e || !e.alive || e.team === this.team) continue;
      if (this.distTo(c) > CALL_FOR_HELP_RANGE) continue;
      set.add(e);
    }
    return set;
  }

  // 目标优先级（LoL）：1 攻击我方英雄的敌方英雄；2 攻击我方英雄的敌方小兵；3 攻击我方小兵的敌方小兵；
  // 4 攻击我方小兵的敌方防御塔；5 攻击我方小兵的敌方英雄；6 最近的敌方小兵；6.5 建筑；7 最近的敌方英雄
  _priorityOf(u, helpers, now) {
    switch (u.type) {
      case 'champion': {
        if (helpers.has(u)) return 1;
        const v = victimOf(u, now);
        if (v && v.team === this.team && v.type === 'minion') return 5;
        return 7;
      }
      case 'minion': case 'pet': case 'monster': {
        const v = victimOf(u, now);
        if (v && v.team === this.team) {
          if (v.type === 'champion' && this.distTo(v) <= CALL_FOR_HELP_RANGE) return 2;
          if (v.type === 'minion' || v.type === 'pet') return 3;
        }
        return 6;
      }
      case 'turret': {
        const v = victimOf(u, now);
        if (v && v.team === this.team && v.type === 'minion') return 4;
        return 6.5;
      }
      default: return 6.5;
    }
  }

  _isCandidate(u) {
    if (u.team === this.team || u.team === 2 || u.invulnerable || u.untargetable) return false;
    if (u.type === 'monster' && !u.summoned) return false;
    return true;
  }

  // 扫描获取半径内的最佳目标：{ unit, prio } | null
  _scan(helpers, now) {
    const list = this.game.queryUnits({
      x: this.x, y: this.y, radius: ACQUIRE_RANGE, enemyOf: this, targetableBy: this, types: TARGET_TYPES, sort: false,
      filter: (u) => this._isCandidate(u),
    });
    let best = null, bp = 99, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.isStructure && this.laneDistance(u.x, u.y) > LANE_LEASH) continue;
      const p = this._priorityOf(u, helpers, now);
      const d = u._qd;
      if (p < bp || (p === bp && d < bd)) { best = u; bp = p; bd = d; }
    }
    return best ? { unit: best, prio: bp } : null;
  }

  _targetValid(t, selfLane) {
    if (!t || !t.alive || t.removed || !this._isCandidate(t)) return false;
    if (!t.isTargetableBy(this)) return false;
    if (this.distTo(t) > ACQUIRE_RANGE + (t.radius || 0) + 150) return false;
    if (!t.isStructure) {
      if (selfLane > LANE_LEASH) return false;
      if (this.laneDistance(t.x, t.y) > LANE_LEASH + 100) return false;
    }
    return true;
  }

  _engage(u, prio) {
    this.targetPriority = prio;
    this._laneWalking = false;
    this.attackUnit(u);
  }

  // 回到兵线：从最近的线段继续沿路径点前进
  _walkLane() {
    const pts = this.waypoints;
    if (!pts || pts.length === 0) { this.command = null; return; }
    if (this._laneWalking && this.command && this.command.type === 'move' && this.path.length > 0) return;
    const proj = laneProjection(pts, this.x, this.y);
    let idx = Math.min(pts.length - 1, proj.seg + 1);
    const near = (i) => (pts[i][0] - this.x) ** 2 + (pts[i][1] - this.y) ** 2 < 150 * 150;
    while (idx < pts.length - 1 && near(idx)) idx++;
    if (idx === pts.length - 1 && near(idx)) {
      // 已到兵线尽头：原地待命
      if (this.command && this.command.type === 'move') this.command = null;
      this.path.length = 0;
      this._laneWalking = false;
      return;
    }
    const nav = this.game.nav;
    const path = [];
    const fx = pts[idx][0], fy = pts[idx][1];
    if (!nav.hasLineOfWalk(this.x, this.y, fx, fy)) {
      const p = nav.findPath(this.x, this.y, fx, fy);
      if (p && p.length > 1) for (let i = 0; i < p.length - 1; i++) path.push({ x: p[i].x, y: p[i].y });
    }
    for (let i = idx; i < pts.length; i++) path.push({ x: pts[i][0], y: pts[i][1] });
    const last = pts[pts.length - 1];
    this.attackState = null;
    this.attackTarget = null;
    this.command = { type: 'move', x: last[0], y: last[1], lane: true };
    this.path = path;
    this._chaseGoal = { x: last[0], y: last[1] };
    this.targetPriority = 99;
    this._laneWalking = true;
  }

  // 纳什男爵之手：附近有持有 Buff 的友方英雄时强化
  _updateEmpower(now) {
    let emp = false;
    const ts = this.game.teams && this.game.teams[this.team];
    if (ts && (ts.baronUntil ?? -1) > now) {
      const r2 = EMPOWER_RANGE * EMPOWER_RANGE;
      for (const c of this.game.champions) {
        if (c.team !== this.team || !c.alive || !c.hasBuff('baron')) continue;
        if ((c.x - this.x) ** 2 + (c.y - this.y) ** 2 <= r2) { emp = true; break; }
      }
    }
    if (emp !== this.empowered) {
      this.empowered = emp;
      this.bonusStats = emp ? { ...(EMPOWER_STATS[this.kind] || EMPOWER_STATS.melee) } : {};
    }
  }

  _think() {
    const now = this.game.time;
    this._updateEmpower(now);
    const selfLane = this.laneDistance();
    let cur = this.command && this.command.type === 'attack' ? this.command.target : null;
    if (cur && !this._targetValid(cur, selfLane)) {
      cur = null;
      this.command = null;
      this.attackState = null;
      this.attackTarget = null;
    }
    const helpers = this._callsForHelp(now);
    if (cur) {
      // 已有目标：只有呼叫支援（优先级 1/2）能让小兵转火
      const cp = this._priorityOf(cur, helpers, now);
      this.targetPriority = cp;
      if (cp <= 1) return;
      if (helpers.size === 0 && !this._allyChampNear()) return;
      const best = this._scan(helpers, now);
      if (best && best.prio <= 2 && best.prio < cp && best.unit !== cur) this._engage(best.unit, best.prio);
      return;
    }
    if (selfLane <= LANE_LEASH + 50) {
      const best = this._scan(helpers, now);
      if (best) { this._engage(best.unit, best.prio); return; }
    }
    this._walkLane();
  }

  // 呼叫支援范围内是否有我方英雄（决定是否需要为优先级 2 重新扫描）
  _allyChampNear() {
    const r2 = CALL_FOR_HELP_RANGE * CALL_FOR_HELP_RANGE;
    for (const c of this.game.champions) {
      if (c.team === this.team && c.alive && (c.x - this.x) ** 2 + (c.y - this.y) ** 2 <= r2) return true;
    }
    return false;
  }

  update(dt) {
    if (this.alive && this.game.time >= this._nextThink) {
      this._nextThink = this.game.time + THINK_INTERVAL;
      this._think();
    }
    super.update(dt);
  }
}
