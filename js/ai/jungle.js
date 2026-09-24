// AI 打野（控制器混入）：清野路线（出生侧 BUFF 开 → 按距离与价值）、惩戒、抓人（从草丛/河道接近）、迅捷蟹
import { TIMINGS } from '../config.js';

const CAMP_VALUE = { blue: 3.2, red: 3.2, gromp: 1.7, wolves: 1.5, raptors: 1.7, krugs: 1.9, scuttle_top: 2.2, scuttle_bot: 2.2 };
const EPIC = new Set(['dragon', 'baron', 'herald']);

export const JungleMixin = {
  _smiteKey() {
    const c = this.champ;
    for (const k of ['D', 'F']) if (c.summoners[k]?.id === 'smite') return k;
    return null;
  },
  _smiteDamage() {
    const k = this._smiteKey();
    if (!k) return 0;
    const def = this.champ.summoners[k].def;
    if (typeof def.damage === 'function') { try { return def.damage(this.champ) || 600; } catch { return 600; } }
    return Number.isFinite(def.damage) ? def.damage : 600;
  },

  // 惩戒：野怪血量 ≤ 惩戒伤害时（优先史诗与 BUFF；普通营地在充能满或需要回血时）
  _trySmite(mons) {
    const k = this._smiteKey();
    if (!k) return false;
    const c = this.champ;
    const st = c.summoners[k];
    if (!st.ready) return false;
    const dmg = this._smiteDamage();
    const range = st.def.range || 500;
    for (const m of mons) {
      if (!m.alive || m.large === false) continue;
      if (c.distTo(m) > range + m.radius) continue;
      if (m.hp > dmg) continue;
      const kind = this.brain.campOfMonster(m)?.kind || m.campKind || m.kind;
      const epic = m.epic || EPIC.has(kind);
      const buff = kind === 'blue' || kind === 'red';
      const charges = st.charges ?? 1;
      let use = epic || buff;
      if (!use && kind && kind.startsWith('scuttle')) use = charges >= 2 || this.hpPct() < 0.6;
      if (!use && (charges >= 2 || this.hpPct() < 0.45)) use = this.game.time < TIMINGS.DRAGON_SPAWN - 60 || charges >= 2;
      if (!use) continue;
      const r = c.castSummoner(k, { target: m });
      if (r.ok) return true;
    }
    return false;
  },

  // 选择下一个营地
  _pickCamp() {
    const c = this.champ;
    const now = this.game.time;
    const brain = this.brain;
    const ms = Math.max(250, c.stats.moveSpeed);
    // 开局：出生侧 BUFF
    if (!this.firstCampDone && now < TIMINGS.JUNGLE_SPAWN + 40) {
      if (!this.startCamp) {
        const kind = this.game.rng() < 0.5 ? 'red' : 'blue';
        this.startCamp = this.world.campOfKind(kind, c.team) || this.world.campOfKind('blue', c.team);
      }
      if (this.startCamp && (brain.campUp(this.startCamp) || now < TIMINGS.JUNGLE_SPAWN)) return this.startCamp;
    }
    // 保持当前营地（清理中）
    if (this.camp && (brain.campUp(this.camp) || brain.campMonsters(this.camp).some((m) => m.visible[c.team]))) {
      if (c.distTo(this.camp) < 1500) return this.camp;
    }
    const enemyJg = this.game.champions.find((e) => e.team !== c.team && e.role === 'jungle');
    const enemyJgFar = !enemyJg || !enemyJg.alive || (() => { const s = brain.lastSeen(enemyJg); return s && now - s.t < 15 && Math.hypot(s.x - c.x, s.y - c.y) > 5000; })();
    let best = null, bs = -Infinity;
    for (const camp of this.world.camps) {
      if (EPIC.has(camp.kind)) continue;
      const scuttle = camp.kind.startsWith('scuttle');
      if (camp.side !== c.team && !scuttle) {
        // 反野：中后期、敌方打野阵亡或远离
        if (now < 12 * 60 || !enemyJgFar) continue;
      }
      if (scuttle && now < TIMINGS.SCUTTLE_SPAWN - 20) continue;
      const respawnAt = brain.campRespawnAt(camp);
      const up = brain.campUp(camp);
      const dist = Math.hypot(camp.x - c.x, camp.y - c.y);
      const travel = dist / ms;
      const wait = up ? 0 : Math.max(0, respawnAt - now - travel);
      if (!up && wait > 25) continue;
      let value = CAMP_VALUE[camp.kind] ?? 1.2;
      if (camp.side !== c.team && !scuttle) value *= 1.3;
      if (scuttle && this.scuttleTaken?.[camp.id]) value *= 0.8;
      // 危险：敌方英雄最近出现在附近
      const danger = brain.enemiesKnownNear(camp.x, camp.y, 1400, 6);
      if (danger > 0) value *= 0.3;
      const score = value / (travel + wait + 7);
      if (score > bs) { bs = score; best = camp; }
    }
    return best;
  },

  // 打野主循环
  _jungle() {
    const c = this.champ;
    const now = this.game.time;
    this.mode = 'jungling';
    if (this.gank && this._doGank()) return;
    const camp = this._pickCamp();
    this.camp = camp;
    if (!camp) {
      // 所有营地冷却：去最近的兵线帮忙推线/蹲草
      const lane = this._nearestLane();
      this._followLane(lane, { push: this.brain.isLateGame() });
      return;
    }
    const d = Math.hypot(camp.x - c.x, camp.y - c.y);
    const mons = this.brain.campMonsters(camp).filter((m) => m.isTargetableBy(c));
    if (d < 1000 && mons.length) {
      this._clearCamp(camp, mons);
      return;
    }
    if (d < 450 && mons.length === 0) {
      if (now >= this.brain.campRespawnAt(camp) + 4) {
        this.brain.markCampChecked(camp, false);
        if (camp === this.startCamp) this.firstCampDone = true;
        this.camp = null;
      }
      // 等待刷新：原地小幅走动
      this._idleJitter(camp.x, camp.y, 200);
      return;
    }
    // 前往营地（从营地入口一侧接近）
    const fx = Math.cos(camp.facing || 0), fy = Math.sin(camp.facing || 0);
    let tx = camp.x + fx * 220, ty = camp.y + fy * 220;
    if (!this.game.nav.isWalkable(tx, ty)) { tx = camp.x; ty = camp.y; }
    this.goTo(tx, ty);
  },

  _clearCamp(camp, mons) {
    const c = this.champ;
    const now = this.game.time;
    this.mode = 'jungling';
    this.lastJungleAt = now;
    // 目标：保持当前；否则大型野怪优先，其次血量最低
    let t = this.target && mons.includes(this.target) && this.target.alive ? this.target : null;
    if (!t) {
      let bs = -Infinity;
      for (const m of mons) {
        const s = (m.large !== false ? 1000 : 0) - m.hp * 0.1 + (m.aggroTarget === c ? 200 : 0);
        if (s > bs) { bs = s; t = m; }
      }
    }
    if (!t) return;
    this.target = t;
    this._trySmite(mons);
    if (!this._useAbilities('jungle', t)) this.attack(t);
    else if (!c.command || c.command.target !== t) this.attack(t);
    if (camp.kind.startsWith('scuttle') && t.hp < 200) { this.scuttleTaken = this.scuttleTaken || {}; this.scuttleTaken[camp.id] = now; }
    if (camp === this.startCamp) this.firstCampDone = this.firstCampDone || mons.every((m) => m.hp < m.maxHp);
  },

  _nearestLane() {
    const c = this.champ;
    let best = 'mid', bd = Infinity;
    for (const lane of ['top', 'mid', 'bot']) {
      this.world.project(lane, c.x, c.y);
      if (this.world.lastProjDist < bd) { bd = this.world.lastProjDist; best = lane; }
    }
    return best;
  },

  // —— 抓人 ——
  _evalGank() {
    const c = this.champ;
    const now = this.game.time;
    if (this.gank || c.level < 3 || now < 150 || this.hpPct() < 0.55) return;
    if (now < (this.nextGankEval || 0)) return;
    this.nextGankEval = now + 2;
    const w = this.world;
    let best = null, bs = 0.95 - (this.params.aggression - 0.5) * 0.4;
    for (const e of this.game.champions) {
      if (e.team === c.team || !e.alive || !e.visible[c.team] || e.role === 'jungle') continue;
      const d = c.distTo(e);
      if (d > 6000) continue;
      const lane = e.role === 'top' ? 'top' : e.role === 'mid' ? 'mid' : 'bot';
      const f = w.toF(c.team, lane, w.project(lane, e.x, e.y)) / w.laneLength(lane);
      if (w.lastProjDist > 1500) continue;
      const underT = this.isUnderEnemyTurret(e.x, e.y);
      if (underT && e.hp / e.maxHp > 0.25) continue;
      const allyLaner = this.brain.members.find((a) => a !== this && a.champ.alive && a.lane === lane && a.role !== 'jungle');
      const allyNear = allyLaner && allyLaner.champ.distTo(e) < 1600 ? allyLaner.champ : null;
      let score = (1 - e.hp / e.maxHp) * 1.4;
      if (f < 0.5) score += 0.7;          // 压线到我方半场
      else if (f < 0.6) score += 0.3;
      if (allyNear) score += 0.35 + (allyNear.hp / allyNear.maxHp - 0.5) * 0.6;
      else score -= 0.4;
      score -= d / 7000;
      score -= Math.max(0, e.level - c.level) * 0.2;
      if (this.brain.enemiesKnownNear(e.x, e.y, 1800, 5) > 1) score -= 0.5;
      if (score > bs) { bs = score; best = { e, lane }; }
    }
    if (!best) return;
    this.gank = { target: best.e, lane: best.lane, since: now, approach: this._gankApproach(best.e), reached: false };
  },

  // 接近点：目标附近我方半场或河道的草丛
  _gankApproach(e) {
    const c = this.champ;
    let best = null, bs = Infinity;
    for (const b of this.world.brushes) {
      if (b.side !== c.team && b.side !== 2) continue;
      const de = Math.hypot(b.x - e.x, b.y - e.y);
      if (de > 2200 || de < 450) continue;
      if (this.isUnderEnemyTurret(b.x, b.y)) continue;
      const dm = Math.hypot(b.x - c.x, b.y - c.y);
      const s = dm + de * 1.4;
      if (s < bs) { bs = s; best = b; }
    }
    return best ? { x: best.x, y: best.y } : null;
  },

  _doGank() {
    const g = this.gank;
    const c = this.champ;
    const now = this.game.time;
    const e = g.target;
    const seen = this.brain.lastSeen(e);
    if (!e.alive || now - g.since > 30 || this.hpPct() < 0.4 || !seen || now - seen.t > 6) { this.gank = null; return false; }
    if (this.isUnderEnemyTurret(seen.x, seen.y) && e.hp / e.maxHp > 0.25) { this.gank = null; return false; }
    this.mode = 'roaming';
    if (!g.reached && g.approach) {
      const d = Math.hypot(g.approach.x - c.x, g.approach.y - c.y);
      if (d > 220 && c.distTo(e) > 800) { this.goTo(g.approach.x, g.approach.y); return true; }
      g.reached = true;
    }
    this.goTo(seen.x, seen.y, { tol: 120 });
    return true;
  },
};
