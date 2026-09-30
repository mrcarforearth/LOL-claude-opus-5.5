// AI 对线（控制器混入）：兵线站位、补刀预测（考虑友方小兵/防御塔/弹道飞行时间）、消耗、控线/推线、拆塔
import { mitigate } from '../core/damage.js';
import { TURRET_RANGE } from './world.js';
import { autoDamage } from './combat.js';

// 防御塔对小兵的最大生命百分比伤害（与 entities 一致的近似值）
const TURRET_VS_MINION = { melee: 0.45, caster: 0.7, siege: 0.14, super: 0.07 };
const MINION_VALUE = { siege: 3, super: 2.5, melee: 1.2, caster: 1 };

// 单位对某目标一次普攻的伤害
function hitDamage(u, t) {
  if (u.type === 'turret' && t.type === 'minion') return t.maxHp * (TURRET_VS_MINION[t.kind] ?? 0.45);
  if (u.type === 'champion') return autoDamage(u, t);
  return mitigate(u, t, u.stats.ad, 'physical');
}
function windupOf(u) {
  return Math.max(0.05, (1 / Math.max(0.1, u.stats.attackSpeed)) * (u.baseStats.windup ?? 0.3));
}
function travelTime(u, t) {
  const ms = u.baseStats.missileSpeed || 0;
  if (ms <= 0) return 0;
  return Math.max(0, Math.hypot(t.x - u.x, t.y - u.y) - (t.radius || 0) * 0.5) / ms;
}

export const LaningMixin = {
  // —— 兵线站位 ——
  _lanePosition(lane, { push = false, hold = false } = {}) {
    const c = this.champ;
    const w = this.world;
    const team = c.team;
    const L = w.laneLength(lane);
    const wv = this.brain.waves[lane];
    const range = c.stats.attackRange;
    const ranged = range >= 300;
    const ownFront = w.frontStructure(team, lane);
    const ownF = ownFront ? w.toF(team, lane, w.structureS(ownFront)) : L * 0.1;
    // 该路建筑全灭后，下一个目标是枢纽塔 / 枢纽（不在兵线索引里，现场投影）
    let enemyT = w.frontStructure(1 - team, lane);
    let enemyTF;
    if (enemyT) enemyTF = w.toF(team, lane, w.structureS(enemyT));
    else {
      enemyT = w.nextEnemyStructure(team, lane);
      enemyTF = enemyT ? Math.min(L - 150, w.toF(team, lane, w.project(lane, enemyT.x, enemyT.y))) : L - 600;
    }
    let f;
    // 敌方小兵在身边没有我方小兵可打时，会主动锁定「攻击距离 + 300」内的英雄（远程兵 550）：无兵掩护时站在此距离外
    const reach = 550 + 300 + c.radius + 70;
    if (wv.allyFront != null && wv.allyFront > ownF - 1500) {
      f = wv.allyFront - (ranged ? Math.max(140, range * 0.45) : 80);
      if (wv.enemyFront != null) {
        let gap = ranged ? range + 40 : 230;
        const met = wv.enemyFront - wv.allyFront < 650;
        // 两波兵尚未接触（己方兵线还在身后）：不站到敌方兵线面前
        if (!met) gap = Math.max(gap, reach);
        // 己方兵线薄弱时站到敌方小兵索敌范围（700）之外
        else if (wv.allyNearFront <= 1 && wv.enemyNearFront >= 2) gap = Math.max(gap, ranged ? 760 : 420);
        f = Math.min(f, wv.enemyFront - gap);
      } else {
        // 没有敌方兵线：己方兵线从身后赶来时原地等待，不回头迎兵（避免来回跑）
        const myF = w.toF(team, lane, w.project(lane, c.x, c.y));
        if (w.lastProjDist < 700 && myF > f) f = Math.max(f, Math.min(myF, Math.max(ownF + 1500, L * 0.5)));
      }
      if (this.role === 'support') f += ranged ? 40 : 80;
      if (push) f = Math.max(f, wv.allyFront - (ranged ? range * 0.6 : 120));
    } else if (wv.enemyFront != null) {
      f = Math.min(wv.enemyFront - Math.max(reach, range + 260), ownF + 250);
    } else {
      // 没有兵线：开局或兵线真空，在己方前塔前方等待
      f = ownF + (this.game.time < 100 ? 850 : 450);
    }
    // 守势：不越过己方前塔前方 1200（河道附近）
    if (hold) f = Math.min(f, ownF + 1200);
    // 谨慎站位（对面强势 / 敌方打野可能在附近）：整体后撤一段，只补身边的刀
    if (this.game.time < (this.cautionUntil || 0)) f -= ranged ? 180 : 240;
    // 敌方兵线压到己方塔下：退到塔边（小兵会先打塔），不再往泉水方向退
    if (ownFront && ownFront.type === 'turret' && f < ownF - 200) f = ownF - 200;
    // 塔下规则：无兵线掩护不进入敌塔射程
    const safeF = enemyTF - (TURRET_RANGE + c.radius + 110);
    if (f > safeF) {
      if (push && enemyT && enemyT.type !== 'turret') f = Math.min(f, enemyTF - range * 0.7);
      else if (push && this._towerCovered(enemyT)) f = Math.min(f, enemyTF - Math.max(range * 0.85, 200));
      else f = safeF;
    }
    f = Math.max(250, Math.min(L - 250, f));
    const p = w.pointAtF(team, lane, f);
    const lat = this.role === 'support' ? 190 : this.role === 'adc' ? -70 : (this.slotJitter || 0);
    if (lat) {
      const px = p.x - p.dirY * lat, py = p.y + p.dirX * lat;
      if (this.game.nav.isWalkable(px, py)) { p.x = px; p.y = py; }
    }
    if (!this.game.nav.isWalkable(p.x, p.y)) { const q = this.game.nav.nearestWalkable(p.x, p.y, 600); p.x = q.x; p.y = q.y; }
    p.f = f;
    return p;
  },

  // 敌塔是否被我方小兵掩护（塔在打小兵、塔下至少 2 个我方小兵）
  _towerCovered(t) {
    if (!t || !t.alive) return true;
    if (t.type !== 'turret') return true;
    const c = this.champ;
    const tgt = t.command?.target || t.attackState?.target || t.attackTarget;
    if (tgt === c) return false;
    if (tgt && tgt.type === 'champion' && tgt.team === c.team) return false;
    const mine = this.game.queryUnits({ x: t.x, y: t.y, radius: TURRET_RANGE - 40, allyOf: c, types: ['minion', 'pet'], sort: false });
    let n = 0;
    for (const m of mine) if (m.hp > m.maxHp * 0.15 || m.hp > 120) n++;
    return n >= 2;
  },
  _enemyTurretAt(x, y) {
    for (const t of this.world.turrets(1 - this.champ.team)) {
      if (!t.alive) continue;
      if ((t.x - x) ** 2 + (t.y - y) ** 2 <= (TURRET_RANGE + this.champ.radius + 30) ** 2) return t;
    }
    return null;
  },

  // —— 补刀 ——
  // 统计我方单位（小兵/塔/英雄/宠物）即将对目标集合造成的普攻伤害：Map(minion → [[时间, 伤害], ...])
  _incoming(targets, horizon = 2.5) {
    const game = this.game;
    const c = this.champ;
    const map = new Map();
    if (targets.length === 0) return map;
    const set = new Set(targets);
    const push = (m, t, dmg) => {
      if (t > horizon) return;
      let a = map.get(m);
      if (!a) { a = []; map.set(m, a); }
      a.push(t, dmg);
    };
    // 飞行中的普攻弹道
    const projs = game.projectiles;
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      if (p.dead || !p.homing || !p.isBasicAttack || !set.has(p.target)) continue;
      const o = p.owner;
      if (!o || o.team !== c.team) continue;
      if (o === c) continue; // 自己的弹道单独处理
      const t = Math.max(0, Math.hypot(p.target.x - p.x, p.target.y - p.y)) / Math.max(1, p.speed);
      push(p.target, t, hitDamage(o, p.target));
    }
    // 正在攻击这些小兵的我方单位
    let cx = 0, cy = 0;
    for (const m of targets) { cx += m.x; cy += m.y; }
    cx /= targets.length; cy /= targets.length;
    const attackers = game.queryUnits({ x: cx, y: cy, radius: 1300, allyOf: c, types: ['minion', 'turret', 'pet', 'champion'], sort: false });
    for (const u of attackers) {
      if (u === c || !u.alive) continue;
      const st = u.attackState;
      let tgt = st ? st.target : (u.command && (u.command.type === 'attack' || u.command.type === 'attackMove') ? u.command.target : null);
      if (!tgt && u.type === 'turret') tgt = u.attackTarget;
      if (!tgt || !set.has(tgt)) continue;
      const interval = 1 / Math.max(0.1, u.stats.attackSpeed);
      const dmg = hitDamage(u, tgt);
      let t1;
      if (st) t1 = Math.max(0, st.windup - st.t) + travelTime(u, tgt);
      else if (u.inAttackRange(tgt, 20)) t1 = Math.max(0, u.attackCooldown) + windupOf(u) + travelTime(u, tgt);
      else continue;
      push(tgt, t1, dmg);
      push(tgt, t1 + interval, dmg);
    }
    return map;
  },

  // 预测 t 时刻血量：只计入明确早于我方命中（提前 ≥2 tick）的伤害，同 tick 结算顺序不确定的不算
  _predictHp(m, events, t) {
    let hp = m.hp;
    if (!events) return hp;
    for (let i = 0; i < events.length; i += 2) if (events[i] < t - 0.07) hp -= events[i + 1];
    return hp;
  },

  // 每个小兵一次性的「补刀判断」随机：按难度 lastHit 决定准确 / 过早 / 过晚
  _lhFactor(m) {
    let f = this._lhRoll.get(m);
    if (f == null) {
      const g = this.game;
      // 失误幅度随难度：新手误差大，困难几乎不失误
      const err = 1.2 - this.skill * 0.6;
      // 新手：经常「没注意到」某个小兵（不去补）
      const ignore = Math.max(0, 0.45 - this.skill) * 0.9;
      if (ignore > 0 && g.rng() < ignore) f = 0;
      else if (g.rng() < this.params.lastHit) f = 0.97 + g.rng() * 0.05;
      else if (g.rng() < 0.5) f = 1.06 + g.rng() * 0.3 * err;  // 出手过早
      else f = 0.92 - (0.12 + g.rng() * 0.3) * err;            // 出手过晚
      this._lhRoll.set(m, f);
      if (this._lhRoll.size > 80) {
        for (const k of this._lhRoll.keys()) if (!k.alive || k.removed) this._lhRoll.delete(k);
      }
    }
    return f;
  },

  // 我方普攻命中所需时间
  _hitTime(m) {
    const c = this.champ;
    const R = c.stats.attackRange + c.radius + m.radius;
    const d = c.distTo(m);
    const walk = Math.max(0, d - R) / Math.max(100, c.stats.moveSpeed);
    const cd = Math.max(0, c.attackCooldown - walk);
    const ms = c.baseStats.missileSpeed || 0;
    const travel = ms > 0 ? Math.min(d, R) / ms : 0;
    return walk + cd + windupOf(c) + travel;
  },
  _myHitDamage(m) {
    const c = this.champ;
    return mitigate(c, m, c.stats.ad, 'physical') + (this._onHitBonus || 0);
  },

  // 扫描可补刀小兵：返回 { kill, soon }
  _scanLastHits({ scan = 520 } = {}) {
    const c = this.champ;
    const game = this.game;
    const R = c.stats.attackRange + c.radius;
    const list = game.queryUnits({ x: c.x, y: c.y, radius: R + scan, enemyOf: c, types: ['minion'], targetableBy: c, sort: false });
    if (list.length === 0) return { kill: null, soon: null, count: 0 };
    const inc = this._incoming(list);
    let kill = null, ks = -Infinity, soon = null, ss = Infinity;
    for (const m of list) {
      if (this.isUnderEnemyTurret(m.x, m.y)) {
        const t = this._enemyTurretAt(m.x, m.y);
        if (t && !this._towerCovered(t)) {
          // 无兵掩护：只有能站在塔外打到时才补
          const dT = Math.hypot(m.x - t.x, m.y - t.y);
          if (dT + R + m.radius - 40 < TURRET_RANGE + c.radius + 30) continue;
        }
      }
      const tHit = this._hitTime(m);
      const ev = inc.get(m);
      const hpAt = this._predictHp(m, ev, tHit);
      if (hpAt <= 0) continue;
      const dmg = this._myHitDamage(m) * this._lhFactor(m);
      if (hpAt <= dmg) {
        const sc = (MINION_VALUE[m.kind] ?? 1) - tHit * 0.8;
        if (sc > ks) { ks = sc; kill = m; }
      } else {
        // 预计何时进入斩杀线
        const hp2 = this._predictHp(m, ev, tHit + 1.6);
        if (hp2 <= dmg * 1.05 || m.hp <= dmg * 2.2) {
          const sc = hp2;
          if (sc < ss) { ss = sc; soon = m; }
        }
      }
    }
    return { kill, soon, count: list.length };
  },

  // 每 tick（节流）扫描射程内所有小兵：预测命中时血量进入斩杀线立即出手（同时处理多个残血小兵）
  _microLastHit() {
    const c = this.champ;
    const game = this.game;
    const now = game.time;
    const w = this.lhWatch;
    if (w && (!w.m.alive || w.m.removed || now > w.until)) this.lhWatch = null;
    if (c.castLock > 0 || c.attackCooldown > 0.12) return;
    // 前摇中：只有「推线普攻」（打不死目标的普通攻击小兵/建筑）可以被更有价值的补刀打断
    let cancelable = false;
    if (c.attackState) {
      const at = c.attackState.target;
      if (!at || at.type === 'champion' || this.skill < 0.3) return;
      if (at.type === 'minion' && at.hp <= this._myHitDamage(at) * 1.05) return;
      if (c.attackState.t > c.attackState.windup * 0.7) return;
      cancelable = true;
    }
    if (!cancelable && now < this.lhCommitUntil && c.command && c.command.type === 'attack' && c.command.target?.alive) return;
    const R = c.stats.attackRange + c.radius;
    const list = game.queryUnits({ x: c.x, y: c.y, radius: R + 140, enemyOf: c, types: ['minion'], targetableBy: c, sort: false });
    if (list.length === 0) return;
    const inc = this._incoming(list, 2);
    const shedding = now < (this.shedUntil || 0);
    let best = null, bs = -Infinity, bt = 0;
    for (const m of list) {
      if (shedding && !c.inAttackRange(m, 0)) continue;
      if (this.isUnderEnemyTurret(m.x, m.y)) {
        const t = this._enemyTurretAt(m.x, m.y);
        if (t && !this._towerCovered(t) && Math.hypot(m.x - t.x, m.y - t.y) + R + m.radius - 40 < TURRET_RANGE + c.radius + 30) continue;
      }
      const tHit = this._hitTime(m);
      if (tHit > (c.stats.attackRange < 300 ? 1.0 : 0.8)) continue;
      const hpAt = this._predictHp(m, inc.get(m), tHit);
      if (hpAt <= 0) continue;
      if (hpAt > this._myHitDamage(m) * this._lhFactor(m)) continue;
      const sc = (MINION_VALUE[m.kind] ?? 1) - tHit;
      if (sc > bs) { bs = sc; best = m; bt = tHit; }
    }
    if (!best) { if (!cancelable) this._turretPrep(list); return; }
    if (cancelable && best === c.attackState?.target) return;
    if (this.attack(best)) {
      this.lhCommitUntil = now + bt + 0.25;
      this.lhWatch = null;
    }
  },

  // 己方塔下控刀：塔正在打的小兵若「塔打一下后仍补不掉、塔再打一下就死」，先垫一刀让塔之后留下斩杀血量
  // 塔下补刀规划：计算「防御塔打几下后补」——若只靠塔的若干次攻击永远不会落进我的斩杀线（如远程兵 70%），
  // 就先垫一刀，让塔打完后留下可补的血量。同时规划塔的下一个目标（离塔最近的小兵）
  _turretPrep(list) {
    const c = this.champ;
    if (this.role === 'support' && this._adcInLane()) return false;
    let turret = null;
    for (const t of this.world.turrets(c.team)) {
      if (!t.alive) continue;
      if ((t.x - c.x) ** 2 + (t.y - c.y) ** 2 < (TURRET_RANGE + 300) ** 2) { turret = t; break; }
    }
    if (!turret) return false;
    const cur = turret.attackState?.target || turret.attackTarget;
    // 候选：塔当前目标 + 塔的下一个目标（离塔最近的其他小兵）
    let next = null, nd = Infinity;
    for (const m of list) {
      if (m === cur || !m.alive) continue;
      const d = (m.x - turret.x) ** 2 + (m.y - turret.y) ** 2;
      if (d < TURRET_RANGE * TURRET_RANGE && d < nd) { nd = d; next = m; }
    }
    const now = this.game.time;
    for (const m of [cur, next]) {
      if (!m || !m.alive || m.type !== 'minion' || !list.includes(m)) continue;
      if (!c.inAttackRange(m, 10)) continue;
      const T = hitDamage(turret, m);
      const dmg = this._myHitDamage(m) * 0.97;
      const needPrep = (hp) => {
        // 只靠塔：是否存在 k 使 0 < hp - kT ≤ dmg
        for (let k = 0; k < 8 && hp - k * T > 0; k++) if (hp - k * T <= dmg) return false;
        return true;
      };
      if (!needPrep(m.hp)) continue;
      // 垫 j 刀后是否存在补刀窗口（塔的下一个目标还没挨打，有时间垫 2~3 刀；当前目标只来得及垫 1 刀）
      const maxJ = m === cur ? 1 : 3;
      let ok = false;
      for (let j = 1; j <= maxJ && !ok; j++) {
        const after = m.hp - dmg * j;
        if (after <= 0) break;
        for (let k = 1; k < 8 && after - k * T > 0; k++) if (after - k * T <= dmg) { ok = true; break; }
      }
      if (!ok) continue;
      // 垫刀必须在塔下一次命中之前落地（当前目标）；按难度有概率失误
      if (m === cur) {
        const st = turret.attackState;
        const tNext = st ? Math.max(0, st.windup - st.t) + travelTime(turret, m) : Math.max(0, turret.attackCooldown) + windupOf(turret) + travelTime(turret, m);
        if (this._hitTime(m) > tNext - 0.05) continue;
      }
      const key = m.id;
      if (this._prepRoll?.id !== key) this._prepRoll = { id: key, ok: this.game.rng() < 0.35 + this.params.lastHit * 0.65 };
      if (!this._prepRoll.ok) continue;
      if (this.attack(m)) { this.lhCommitUntil = now + this._hitTime(m) + 0.2; return true; }
    }
    return false;
  },

  // 正在攻击我的敌方小兵：{ n, dps, far（最远攻击者需要拉开的距离） }
  _minionAggro() {
    const c = this.champ;
    const foes = this.game.queryUnits({ x: c.x, y: c.y, radius: 900, enemyOf: c, types: ['minion'], sort: false });
    let n = 0, dps = 0, need = 0;
    for (const m of foes) {
      const t = m.attackState?.target || (m.command && m.command.type === 'attack' ? m.command.target : null);
      if (t !== c) continue;
      n++;
      dps += mitigate(m, c, m.stats.ad, 'physical') * Math.max(0.2, m.stats.attackSpeed);
      // 小兵以边缘距离 ≤ 射程 + 60 判定在攻击范围内
      need = Math.max(need, m.stats.attackRange + m.radius + c.radius + 140 - c.distTo(m));
    }
    return { n, dps, need };
  },

  // 兵线上的后撤点：沿兵线往己方退 back 距离（离开兵线时朝泉水方向）
  _laneBackPoint(lane, back) {
    const c = this.champ;
    const w = this.world;
    const myF = w.toF(c.team, lane, w.project(lane, c.x, c.y));
    let p;
    if (w.lastProjDist < 1500) p = w.pointAtF(c.team, lane, Math.max(250, myF - back));
    else { const f = this.game.fountainOf(c.team); const l = Math.hypot(f.x - c.x, f.y - c.y) || 1; p = { x: c.x + (f.x - c.x) / l * back, y: c.y + (f.y - c.y) / l * back }; }
    if (!this.game.nav.isWalkable(p.x, p.y)) p = this.game.nav.nearestWalkable(p.x, p.y, 500);
    return p;
  },

  // 摆脱小兵仇恨：被小兵集火（或换血后被呼叫支援）时沿兵线后撤拉开，小兵追出一段距离/离开射程约 1 秒后会放弃
  // 返回 true 表示本次思考已处理（后撤中）
  _shedMinionAggro(lane) {
    const c = this.champ;
    const now = this.game.time;
    if (now < (this.shedUntil || 0) && this.shedPt) {
      if (!c.attackState) this.goTo(this.shedPt.x, this.shedPt.y, { force: true, tol: 60 });
      return true;
    }
    const ag = this._minionAggro();
    if (ag.n === 0) return false;
    // 己方塔下且状态健康：交给防御塔处理
    if (this.hpPct() > 0.5 && this._nearOwnTurret(650)) return false;
    const hp = c.hp + (c.totalShield || 0);
    const heavy = ag.n >= 3 || ag.dps * 4 > hp * 0.14 || (ag.n >= 1 && (this.hpPct() < 0.45 || hp < ag.dps * 6));
    if (!heavy) return false;
    // 按难度：新手经常反应不过来（每 1.5 秒判定一次）
    if (now >= (this._shedRollAt || 0)) {
      this._shedRollAt = now + 1.5;
      this._shedOk = this.game.rng() < 0.45 + this.skill * 0.55;
    }
    if (!this._shedOk) return false;
    const back = Math.max(380, Math.min(700, ag.need + 120));
    this.shedPt = this._laneBackPoint(lane, back);
    this.shedUntil = now + 1.1;
    this.lhWatch = null;
    if (!c.attackState) this.goTo(this.shedPt.x, this.shedPt.y, { force: true, tol: 60 });
    return true;
  },

  _nearOwnTurret(r = 700) {
    const c = this.champ;
    for (const t of this.world.turrets(c.team)) {
      if (t.alive && (t.x - c.x) ** 2 + (t.y - c.y) ** 2 < r * r) return t;
    }
    return null;
  },

  // 独自面对敌方兵线（无己方小兵掩护或被多个小兵攻击）：应后撤到兵线后方
  _exposedToWave() {
    const c = this.champ;
    const game = this.game;
    const foes = game.queryUnits({ x: c.x, y: c.y, radius: 620, enemyOf: c, types: ['minion'], sort: false });
    if (foes.length < 2) return false;
    let aggro = 0;
    for (const m of foes) {
      const t = m.attackState?.target || m.attackTarget || m.command?.target;
      if (t === c) aggro++;
    }
    const friends = game.queryUnits({ x: c.x, y: c.y, radius: 750, allyOf: c, types: ['minion'], sort: false }).length;
    // 在己方防御塔下且血量健康：塔会处理小兵
    for (const t of this.world.turrets(c.team)) {
      if (t.alive && (t.x - c.x) ** 2 + (t.y - c.y) ** 2 < 700 * 700 && this.hpPct() > 0.45) return false;
    }
    this._waveAggro = aggro;
    if (aggro >= 3) return true;
    if (aggro >= 2 && (friends <= 1 || this.hpPct() < 0.6 || c.stats.attackRange >= 300)) return true;
    return friends === 0 && foes.length >= 3;
  },

  // 兵线是否已经交战（敌方小兵大多已有攻击目标）：未交战时普攻小兵会吸引整波仇恨
  _waveEngaged() {
    const c = this.champ;
    const foes = this.game.queryUnits({ x: c.x, y: c.y, radius: 900, enemyOf: c, types: ['minion'], sort: false });
    if (foes.length === 0) return true;
    let busy = 0;
    for (const m of foes) if (m.attackState || (m.attackTarget && m.attackTarget.alive)) busy++;
    return busy * 2 >= foes.length;
  },

  // 走到能补刀的位置（射程边缘、我方一侧）
  _approachForLastHit(m) {
    const c = this.champ;
    const R = c.stats.attackRange + c.radius + m.radius;
    const d = c.distTo(m);
    if (d <= R - 20) return false;
    const f = this.game.fountainOf(c.team);
    let dx = f.x - m.x, dy = f.y - m.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const k = Math.max(60, R - 60);
    const px = m.x + dx * k, py = m.y + dy * k;
    if (this.isUnderEnemyTurret(px, py) && !this._towerCovered(this._enemyTurretAt(px, py))) return false;
    return this.goTo(px, py, { tol: 60 });
  },

  // 对线主逻辑；返回 true 表示已处理
  _laneFarm(lane, { push = false } = {}) {
    const c = this.champ;
    const now = this.game.time;
    // 正在补刀出手中
    if (now < this.lhCommitUntil && c.command && c.command.type === 'attack' && c.command.target?.alive) return true;
    const isSupport = this.role === 'support';
    const adcHere = isSupport ? this._adcInLane(lane) : false;
    // 被小兵集火 / 独自站在敌方兵线前：沿兵线后撤脱离仇恨（射程内的补刀仍由微操处理）
    if (this._shedMinionAggro(lane)) return true;
    if (this._exposedToWave()) {
      const back = this._laneBackPoint(lane, 560);
      this.lhWatch = null;
      this.goTo(back.x, back.y, { force: !c.attackState, tol: 80 });
      return true;
    }
    const lh = this._scanLastHits();
    if (lh.kill && (!isSupport || !adcHere)) {
      this.attack(lh.kill);
      this.lhCommitUntil = now + this._hitTime(lh.kill) + 0.25;
      this.lhWatch = null;
      return true;
    }
    if (lh.soon && (!isSupport || !adcHere)) this.lhWatch = { m: lh.soon, until: now + 2.5 };
    // 技能清线：按命中小兵数与法力阈值（推线时更积极；对线期只在能收掉多个小兵时用）
    // 辅助：ADC 在线上时（对线期）不清线、不抢刀
    const supportHold = isSupport && adcHere && this._laningPhase();
    if ((!isSupport || !adcHere || (push && !supportHold)) && now >= (this.nextFarmCastAt || 0)) {
      this.nextFarmCastAt = now + 0.45;
      if (this._useAbilities(push ? 'push' : 'farm', null)) return true;
    }
    // 推线：攻击建筑或小兵（对线期有即将可补的小兵时先等补刀）
    const waitLh = this.lhWatch && !isSupport && this._laningPhase();
    if (push && !waitLh && !supportHold && this._pushAttack(lane, lh)) return true;
    // 等待即将可补的小兵
    if (this.lhWatch && !isSupport) {
      if (this._approachForLastHit(this.lhWatch.m)) return true;
      return true; // 站定等待
    }
    return false;
  },

  _adcInLane(lane) {
    const adc = this.brain.members.find((a) => a.role === 'adc');
    if (!adc) return false;
    const u = adc.champ;
    if (!u.alive || u.isRecalling || u.inFountain) return false;
    return u.distTo(this.champ) < 2200;
  },

  // 推线：拆塔（有兵掩护）或攻击小兵
  _pushAttack(lane, lh) {
    const c = this.champ;
    const w = this.world;
    const next = w.nextEnemyStructure(c.team, lane);
    const R = c.stats.attackRange + c.radius;
    if (next && next.alive && !next.invulnerable) {
      const d = c.distTo(next);
      const covered = this._towerCovered(next);
      const enemyChampsNear = this._countEnemyChamps(next.x, next.y, 1100);
      const alliesNear = this.allies.filter((a) => a.u.distTo(next) < 1300).length + 1;
      const ok = next.type !== 'turret' ? (covered || enemyChampsNear === 0) : covered;
      if (ok && d < R + next.radius + 500 && (enemyChampsNear === 0 || alliesNear > enemyChampsNear)) {
        this.target = next;
        this.attack(next);
        return true;
      }
    }
    // 攻击小兵（不在无掩护敌塔下）：对线期不碰「再打一下就会被别人收掉」的小兵，优先血量高的，避免漏刀
    const mins = this.game.queryUnits({ x: c.x, y: c.y, radius: R + 350, enemyOf: c, types: ['minion', 'pet'], targetableBy: c, sort: false });
    const careful = this._laningPhase() && this.role !== 'support';
    // 对线期：兵线尚未交战时不普攻小兵（避免吸引整波仇恨）
    if (careful && !this._waveEngaged()) return false;
    let best = null, bs = Infinity;
    for (const m of mins) {
      if (this.isUnderEnemyTurret(m.x, m.y) && !this._towerCovered(this._enemyTurretAt(m.x, m.y))) continue;
      let s;
      if (careful && m.type === 'minion') {
        const dmg = this._myHitDamage(m);
        if (m.hp > dmg && m.hp < dmg * 2.3) continue;
        s = -m.hp + c.distTo(m) * 0.8;
      } else s = m.hp + c.distTo(m) * 0.5;
      if (s < bs) { bs = s; best = m; }
    }
    if (best) { this.attack(best); return true; }
    return false;
  },

  // —— 消耗 ——
  _tryHarass(lane) {
    const c = this.champ;
    const now = this.game.time;
    if (now < this.harassUntil && c.command?.type === 'attack' && c.command.target?.type === 'champion') {
      if (c.lastAttackAt > this.harassStart) { this.harassUntil = 0; this._afterHarass(lane); return false; }
      return true;
    }
    if (this.hpPct() < 0.45 || now < this.nextHarassAt) return false;
    let e = null;
    for (const it of this.enemies) {
      if (it.d > 1100) break;
      if (!this.reactable(it.u) || it.u.untargetable) continue;
      e = it.u;
      break;
    }
    if (!e) return false;
    if (this.isUnderEnemyTurret(e.x, e.y) || this.isUnderEnemyTurret(c.x, c.y)) return false;
    const wv = this.brain.waves[lane];
    if (wv.enemyNearFront > wv.allyNearFront + 1) return false;
    const rng = this.game.rng();
    if (rng > this.params.aggression * 0.55) return false;
    // 只在换血不吃亏时消耗：血量不低于对方太多、局势不劣
    if (this.hpPct() < e.hp / e.maxHp - 0.15) return false;
    if (this.danger && this.danger.ratioDef * this.engageFactor < 0.8) return false;
    // 困难：挑时机消耗（对方补刀前摇 / 关键技能冷却 / 手长打手短且对方够不着）
    // 一般：多数时候也挑时机（约 1/3 随手消耗）
    if (this.skill >= 0.5 && (this.skill >= 0.8 || this.game.rng() > 0.35)) {
      const theyFarm = e.attackState?.target?.type === 'minion';
      const outranged = c.stats.attackRange > e.stats.attackRange + 150 && c.distTo(e) > e.stats.attackRange + e.radius + c.radius + 80;
      if (!theyFarm && !outranged && !this._enemyKeyCdDown(e)) return false;
    }
    // 附近敌方小兵多时不消耗（攻击英雄会触发小兵呼叫支援）
    const aggro = this.game.queryUnits({ x: c.x, y: c.y, radius: 700, enemyOf: c, types: ['minion'], sort: false }).length;
    if (aggro > 2) return false;
    this.target = e;
    // 消耗有间隔（避免每次思考都去点人，引发兵线仇恨与全面交战）
    const gap = (3.5 + this.game.rng() * 4) * (1.35 - this.params.aggression * 0.5);
    // 技能消耗（法力不足时只用普攻消耗，留蓝补刀/保命）
    const manaOk = !this._usesMana() || this.manaPct() > this.harassMana - 0.1;
    if (manaOk && this._useAbilities('harass', e)) { this.nextHarassAt = now + gap; this._afterHarass(lane, 0.35); return true; }
    // 普攻消耗：目标在射程内
    const d = c.distTo(e);
    const inRange = c.inAttackRange(e, 20);
    if (c.stats.attackRange >= 350 && inRange && aggro <= 2 && c.attackCooldown <= 0.05) {
      this.attack(e);
      this.harassUntil = now + 0.9;
      this.harassStart = now;
      this.nextHarassAt = now + gap;
      return true;
    }
    if (c.stats.attackRange < 350 && d < c.stats.attackRange + 260 && aggro <= 1 && this.hpPct() >= e.hp / e.maxHp - 0.05) {
      this.attack(e);
      this.harassUntil = now + 1.4;
      this.harassStart = now;
      this.nextHarassAt = now + gap * 1.3;
      return true;
    }
    return false;
  },

  // 被手长的对手白白消耗（对方射程更远、我没在还手）：后撤拉开并谨慎站位几秒（新手常反应不过来）
  _avoidPoke(lane) {
    const c = this.champ;
    const now = this.game.time;
    if (!this._laningPhase()) return false;
    const e = c.lastChampionDamager;
    if (!e || !e.alive || now - (c.lastChampionDamageAt ?? -99) > 1.2) return false;
    if (e.stats.attackRange < c.stats.attackRange + 120 && this.hpPct() > 0.5) return false;
    if (this.hpPct() > 0.85) return false;
    if (now < (this._pokeRollAt || 0) ? !this._pokeOk : false) return false;
    if (now >= (this._pokeRollAt || 0)) { this._pokeRollAt = now + 2; this._pokeOk = this.game.rng() < 0.35 + this.skill * 0.65; if (!this._pokeOk) return false; }
    this.cautionUntil = now + 3.5;
    if (c.attackState) return false;
    const p = this._laneBackPoint(lane, 380);
    this.shedPt = p;
    this.shedUntil = now + 0.8;
    this.goTo(p.x, p.y, { force: true, tol: 60 });
    return true;
  },

  // 消耗之后：若附近有敌方小兵（会响应呼叫支援），立即沿兵线后撤一段，约 1 秒后小兵放弃追击
  _afterHarass(lane, delay = 0) {
    const c = this.champ;
    const now = this.game.time;
    const n = this.game.queryUnits({ x: c.x, y: c.y, radius: 800, enemyOf: c, types: ['minion'], sort: false }).length;
    if (n === 0) return;
    if (this.game.rng() > 0.4 + this.skill * 0.6) return;
    this.shedPt = this._laneBackPoint(lane, 420 + Math.min(3, n) * 40);
    this.shedUntil = now + delay + 1.1;
  },

  // 敌方对线英雄是否缺席（阵亡/回城/长时间不可见）
  // 对线期：对位英雄（阵亡 / 最近在远处出现 / 刚在泉水附近）才算缺席；「消失」（最近在线上、之后看不见）不算缺席，
  // 反而要防 gank（谨慎站位）
  _laneOpponentAbsent(lane) {
    const now = this.game.time;
    const c = this.champ;
    const lanePt = this._lanePosition(lane);
    const brain = this.brain;
    const late = brain.isLateGame();
    let absent = true;
    for (const e of this.game.champions) {
      if (e.team === c.team) continue;
      if (!e.alive) continue;
      const seen = brain.lastSeen(e);
      if (!seen) continue;
      const d = Math.hypot(seen.x - lanePt.x, seen.y - lanePt.y);
      const age = now - seen.t;
      if (age < 6 && d < 2600) { absent = false; continue; }
      if (late) continue;
      // 对位英雄最近 20 秒在线上出现、之后消失：可能去 gank 或绕后，不贸然推线
      const opp = this._isLaneOpponent(e, lane);
      if (opp && age < 20 && d < 3200) { absent = false; this.cautionUntil = Math.max(this.cautionUntil || 0, now + 1.5); }
    }
    return absent;
  },
  _isLaneOpponent(e, lane) {
    const r = e.role;
    if (lane === 'bot') return r === 'adc' || r === 'support';
    return r === lane;
  },
};
