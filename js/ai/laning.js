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
  _lanePosition(lane, { push = false } = {}) {
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
    if (wv.allyFront != null && wv.allyFront > ownF - 1500) {
      f = wv.allyFront - (ranged ? Math.max(140, range * 0.45) : 80);
      if (wv.enemyFront != null) {
        let gap = ranged ? range + 40 : 230;
        // 己方兵线薄弱时站到敌方小兵索敌范围（700）之外
        if (wv.allyNearFront <= 1 && wv.enemyNearFront >= 2) gap = Math.max(gap, ranged ? 760 : 320);
        f = Math.min(f, wv.enemyFront - gap);
      } else {
        // 没有敌方兵线：己方兵线从身后赶来时原地等待，不回头迎兵（避免来回跑）
        const myF = w.toF(team, lane, w.project(lane, c.x, c.y));
        if (w.lastProjDist < 700 && myF > f) f = Math.max(f, Math.min(myF, Math.max(ownF + 1500, L * 0.5)));
      }
      if (this.role === 'support') f += ranged ? 40 : 80;
      if (push) f = Math.max(f, wv.allyFront - (ranged ? range * 0.6 : 120));
    } else if (wv.enemyFront != null) {
      f = Math.min(wv.enemyFront - (range + 260), ownF + 250);
    } else {
      // 没有兵线：开局或兵线真空，在己方前塔前方等待
      f = ownF + (this.game.time < 100 ? 850 : 450);
    }
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
      if (g.rng() < this.params.lastHit) f = 0.97 + g.rng() * 0.05;
      else if (g.rng() < 0.5) f = 1.12 + g.rng() * 0.33;  // 出手过早
      else f = 0.45 + g.rng() * 0.35;                     // 出手过晚
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
    if (c.attackState || c.castLock > 0 || c.attackCooldown > 0.12) return;
    if (now < this.lhCommitUntil && c.command && c.command.type === 'attack' && c.command.target?.alive) return;
    const R = c.stats.attackRange + c.radius;
    const list = game.queryUnits({ x: c.x, y: c.y, radius: R + 140, enemyOf: c, types: ['minion'], targetableBy: c, sort: false });
    if (list.length === 0) return;
    const inc = this._incoming(list, 2);
    let best = null, bs = -Infinity, bt = 0;
    for (const m of list) {
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
    if (!best) { this._turretPrep(list); return; }
    if (this.attack(best)) {
      this.lhCommitUntil = now + bt + 0.25;
      this.lhWatch = null;
    }
  },

  // 己方塔下控刀：塔正在打的小兵若「塔打一下后仍补不掉、塔再打一下就死」，先垫一刀让塔之后留下斩杀血量
  _turretPrep(list) {
    const c = this.champ;
    if (!this._laningPhase() || (this.role === 'support' && this._adcInLane())) return false;
    if (this.game.rng() > this.params.lastHit) return false;
    let turret = null;
    for (const t of this.world.turrets(c.team)) {
      if (!t.alive) continue;
      if ((t.x - c.x) ** 2 + (t.y - c.y) ** 2 < (TURRET_RANGE + 300) ** 2) { turret = t; break; }
    }
    if (!turret) return false;
    const m = turret.attackState?.target || turret.command?.target || turret.attackTarget;
    if (!m || !m.alive || m.type !== 'minion' || !list.includes(m)) return false;
    const T = hitDamage(turret, m);
    const dmg = this._myHitDamage(m);
    if (m.hp - T <= dmg) return false;           // 塔打完可直接补
    if (m.hp - T > T) return false;              // 塔要打两下以上，暂不需要垫刀
    const r = m.hp - dmg - T;
    if (r <= 0 || r > dmg * 0.95) return false;
    if (!c.inAttackRange(m, 10)) return false;
    if (this.attack(m)) { this.lhCommitUntil = this.game.time + this._hitTime(m) + 0.2; return true; }
    return false;
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
    // 独自站在敌方兵线前：退到兵线后方（射程内的补刀仍由微操处理）
    if (this._exposedToWave()) {
      // 沿兵线后撤到己方小兵身后（约 550），让己方小兵接手仇恨
      const w = this.world;
      const myF = w.toF(c.team, lane, w.project(lane, c.x, c.y));
      let back;
      if (w.lastProjDist < 1500) back = w.pointAtF(c.team, lane, Math.max(250, myF - 560));
      else { const f = this.game.fountainOf(c.team); const l = Math.hypot(f.x - c.x, f.y - c.y) || 1; back = { x: c.x + (f.x - c.x) / l * 560, y: c.y + (f.y - c.y) / l * 560 }; }
      if (!this.game.nav.isWalkable(back.x, back.y)) back = this.game.nav.nearestWalkable(back.x, back.y, 500);
      this.lhWatch = null;
      this.goTo(back.x, back.y, { force: true, tol: 80 });
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
    // 推线：攻击建筑或小兵（对线期有即将可补的小兵时先等补刀）
    const waitLh = this.lhWatch && !isSupport && this._laningPhase();
    if (push && !waitLh && this._pushAttack(lane, lh)) return true;
    // 技能清线（推线时）
    if (push && this.game.rng() < 0.5 && this._useAbilities('push', null)) return true;
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
      if (c.lastAttackAt > this.harassStart) { this.harassUntil = 0; return false; }
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
    // 附近敌方小兵多时不消耗（攻击英雄会触发小兵呼叫支援）
    const aggro = this.game.queryUnits({ x: c.x, y: c.y, radius: 700, enemyOf: c, types: ['minion'], sort: false }).length;
    if (aggro > 2) return false;
    this.target = e;
    // 消耗有间隔（避免每次思考都去点人，引发兵线仇恨与全面交战）
    const gap = (2.5 + this.game.rng() * 3.5) * (1.35 - this.params.aggression * 0.5);
    // 技能消耗
    if (this._useAbilities('harass', e)) { this.nextHarassAt = now + gap; return true; }
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

  // 敌方对线英雄是否缺席（阵亡/回城/长时间不可见）
  _laneOpponentAbsent(lane) {
    const now = this.game.time;
    const c = this.champ;
    const lanePt = this._lanePosition(lane);
    for (const e of this.game.champions) {
      if (e.team === c.team || !e.alive) continue;
      const seen = this.brain.lastSeen(e);
      if (seen && now - seen.t < 6 && Math.hypot(seen.x - lanePt.x, seen.y - lanePt.y) < 2600) return false;
    }
    return true;
  },
};
