// AI 中后期（控制器混入）：抱团推线、分推、史诗野怪（小龙/男爵/先锋）、守家、支援队友、辅助跟随 ADC、插眼
import { TURRET_RANGE } from './world.js';
import { findControlWardSlot } from './shopping.js';

export const ObjectiveMixin = {
  // 沿某路推进/对线（通用）：补刀 → 推线 → 站位
  _followLane(lane, { push = false } = {}) {
    const c = this.champ;
    this.mode = push ? 'pushing' : 'laning';
    const pos = this._lanePosition(lane, { push });
    const far = Math.hypot(pos.x - c.x, pos.y - c.y);
    if (far > 1800) {
      // 远离兵线：先赶路（路上遇到可补的兵照补）
      this.goTo(pos.x, pos.y);
      return;
    }
    if (!push && this._tryHarass(lane)) return;
    if (this._laneFarm(lane, { push })) return;
    this.goTo(pos.x, pos.y, { tol: 70 });
  },

  // 团队推进：远处先集合赶路；人数不足且目标有人防守时在兵线后方等队友；否则跟兵拆塔
  _objectivePush(obj) {
    const c = this.champ;
    const lane = obj.lane || 'mid';
    this.mode = 'pushing';
    const brain = this.brain;
    const pos = this._lanePosition(lane, { push: true });
    const far = Math.hypot(pos.x - c.x, pos.y - c.y);
    if (far > 2200) { this._travel(pos.x, pos.y); return; }
    const next = this.world.nextEnemyStructure(c.team, lane);
    let grouped = 1;
    for (const a of this.allies) if (a.d < 1500) grouped++;
    const defenders = next ? brain.enemiesKnownNear(next.x, next.y, 2500, 6) : 0;
    const need = obj.end ? 2 : obj.all ? 3 : 2;
    const nearTarget = next && Math.hypot(next.x - c.x, next.y - c.y) < 2600;
    if (nearTarget && grouped < need && defenders >= grouped) {
      if (this._laneFarm(lane, { push: false })) return;
      const hold = this._lanePosition(lane, { push: false });
      if (Math.hypot(hold.x - c.x, hold.y - c.y) > 160) this.goTo(hold.x, hold.y, { tol: 100 });
      else this._idleJitter(hold.x, hold.y, 120);
      return;
    }
    if (this._laneFarm(lane, { push: true })) return;
    // 辅助跟随 ADC
    if (this.role === 'support') { const adc = this._adc(); if (adc && adc.distTo(c) < 2500 && !adc.inFountain) { this._followUnit(adc, 220); return; } }
    if (Math.hypot(pos.x - c.x, pos.y - c.y) > 120) this.goTo(pos.x, pos.y, { tol: 90 });
    else this._idleJitter(pos.x, pos.y, 110);
  },

  // 惩戒抢史诗野怪/BUFF：交战中也盯着附近残血的大型野怪（打野每 0.1 秒左右检查一次）
  _smiteSteal() {
    const k = this._smiteKey?.();
    if (!k) return false;
    const c = this.champ;
    const st = c.summoners[k];
    if (!st.ready) return false;
    const range = (st.def.range || 500);
    const mons = this.game.queryUnits({ x: c.x, y: c.y, radius: range + 260, types: ['monster'], sort: false });
    if (!mons.length) return false;
    const dmg = this._smiteDamage();
    for (const m of mons) {
      if (!m.alive || m.large === false || !m.visible?.[c.team]) continue;
      const kind = this.brain.campOfMonster(m)?.kind || m.kind;
      if (!(m.epic || kind === 'dragon' || kind === 'baron' || kind === 'herald' || kind === 'blue' || kind === 'red')) continue;
      if (m.hp > dmg || c.distTo(m) > range + m.radius) continue;
      const r = c.castSummoner(k, { target: m });
      if (r.ok) return true;
    }
    return false;
  },

  // 分推：去另一条边路
  _splitPush() {
    const brain = this.brain;
    const g = brain.groupLane;
    let lane = this.lane && this.lane !== g && this.lane !== 'mid' ? this.lane : (g === 'top' ? 'bot' : 'top');
    if (!this.world.nextEnemyStructure(this.champ.team, lane)) lane = g;
    this._followLane(lane, { push: true });
  },

  // 史诗野怪：集合后开打，打野负责惩戒
  _objectiveEpic(obj) {
    const c = this.champ;
    const camp = obj.camp;
    this.mode = 'objective';
    const mons = this.brain.campMonsters(camp).filter((m) => m.isTargetableBy(c));
    const d = Math.hypot(camp.x - c.x, camp.y - c.y);
    let near = 1;
    for (const a of this.allies) if (a.u.distTo(camp) < 1500) near++;
    const need = camp.kind === 'baron' ? 3 : camp.kind === 'dragon' ? (this.brain.isLateGame() ? 3 : 2) : 2;
    if (d > 1300) {
      this._travel(camp.x, camp.y);
      return;
    }
    const monster = mons[0];
    if (!monster) {
      // 未刷新或已被击杀：在坑口等待
      const mouth = this.world.pits?.[camp.pit || camp.kind]?.mouth;
      if (mouth) this._idleJitter(mouth.x, mouth.y, 250);
      else this._idleJitter(camp.x, camp.y, 300);
      if (this.brain.campUp(camp) && d < 500) this.brain.markCampChecked(camp, false);
      return;
    }
    if (near >= need || monster.hp / monster.maxHp < 0.5 || monster.aggroTarget) {
      this.target = monster;
      this.lastJungleAt = this.game.time;
      this._trySmite(mons);
      if (!this._useAbilities('jungle', monster)) this.attack(monster);
      return;
    }
    const mouth = this.world.pits?.[camp.pit || camp.kind]?.mouth || camp;
    this._idleJitter(mouth.x, mouth.y, 220);
  },

  _objectiveDefend(obj) {
    const c = this.champ;
    this.mode = 'roaming';
    const s = obj.structure;
    // 守在建筑后方，等敌人进入塔下再打
    const f = this.game.fountainOf(c.team);
    let dx = f.x - obj.x, dy = f.y - obj.y;
    const l = Math.hypot(dx, dy) || 1;
    const back = s && s.type === 'turret' ? 250 : 450;
    const px = obj.x + (dx / l) * back, py = obj.y + (dy / l) * back;
    if (Math.hypot(px - c.x, py - c.y) > 1800) { this._travel(px, py); return; }
    // 清理塔下小兵
    if (this._laneFarm(obj.lane || 'mid', { push: true })) return;
    this.goTo(px, py, { tol: 120 });
  },

  // 远距离赶路：上单/中单可用传送
  _travel(x, y) {
    const c = this.champ;
    if (Math.hypot(x - c.x, y - c.y) > 7000 && this._tryTeleport(x, y)) return;
    this.goTo(x, y);
  },

  _tryTeleport(x, y) {
    const c = this.champ;
    const key = ['D', 'F'].find((k) => c.summoners[k]?.id === 'teleport');
    if (!key || !c.summoners[key].ready || c.channel) return false;
    if (this.danger && this.danger.enemiesNear.length) return false;
    const r = c.castSummoner(key, { x, y });
    if (r.ok) { this.mode = 'roaming'; this.lastTeleportAt = this.game.time; }
    return r.ok;
  },

  _adc() {
    const a = this.brain.members.find((m) => m.role === 'adc');
    return a && a.champ.alive ? a.champ : null;
  },

  // 跟随某单位（保持距离，站在其后方偏侧）
  _followUnit(u, dist = 250) {
    const c = this.champ;
    const f = this.game.fountainOf(c.team);
    let dx = f.x - u.x, dy = f.y - u.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const px = u.x + dx * dist * 0.4 - dy * dist * 0.8, py = u.y + dy * dist * 0.4 + dx * dist * 0.8;
    const nav = this.game.nav;
    const p = nav.isWalkable(px, py) ? { x: px, y: py } : nav.nearestWalkable(px, py, 500);
    if (Math.hypot(p.x - c.x, p.y - c.y) < 90) return true;
    return this.goTo(p.x, p.y, { tol: 110 });
  },

  // 辅助对线：跟随 ADC，在 ADC 不在时守线
  _supportLane() {
    const c = this.champ;
    const adc = this._adc();
    const lane = 'bot';
    this.mode = 'laning';
    if (adc && !adc.isRecalling && !adc.inFountain && adc.distTo(c) < 3500) {
      if (this._tryHarass(lane)) return;
      // 保护：敌人贴近 ADC 时控制
      const threat = this._threatTo(adc);
      if (threat && this._useAbilities('peel', threat)) return;
      const pos = this._lanePosition(lane);
      // 站在 ADC 与兵线之间偏侧
      const px = (pos.x + adc.x) / 2, py = (pos.y + adc.y) / 2;
      if (Math.hypot(adc.x - pos.x, adc.y - pos.y) < 1400) this.goTo(px, py, { tol: 90 });
      else this._followUnit(adc, 250);
      return;
    }
    // ADC 不在：自己守线（可以补刀）
    this._followLane(lane);
  },

  // 对某队友威胁最大的可见敌人
  _threatTo(ally) {
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      const u = e.u;
      if (!this.reactable(u) || u.untargetable) continue;
      const d = u.distTo(ally);
      const r = u.stats.attackRange + u.radius + ally.radius + 150;
      if (d > Math.max(r, 450)) continue;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  },

  // 是否有队友在附近交战需要支援
  _allyInTrouble(maxDist) {
    const now = this.game.time;
    let best = null, bs = 0;
    for (const a of this.allies) {
      if (a.d > maxDist) continue;
      const u = a.u;
      if (now - (u.lastChampionDamageAt ?? -99) > 2.5) continue;
      const attacker = u.lastChampionDamager;
      if (!attacker || !attacker.alive || !attacker.visible[this.champ.team]) continue;
      const sc = (1 - u.hp / u.maxHp) + 1 - a.d / maxDist;
      if (sc > bs) { bs = sc; best = { ally: u, enemy: attacker }; }
    }
    return best;
  },

  // —— 插眼 ——
  _wardSpots() {
    if (this._wardSpotCache && this.game.time < this._wardSpotCache.until) return this._wardSpotCache.spots;
    const w = this.world;
    const c = this.champ;
    const spots = [];
    const addNear = (x, y, r, filter, n = 2) => {
      const list = w.brushes.filter((b) => filter(b) && Math.hypot(b.x - x, b.y - y) < r).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
      for (const b of list.slice(0, n)) spots.push({ x: b.x, y: b.y, name: b.name });
    };
    const neutral = (b) => b.side === 2;
    const late = this.brain.isLateGame();
    if (this.role === 'support') {
      const dragon = w.camps.find((k) => k.kind === 'dragon');
      const baron = w.camps.find((k) => k.kind === 'baron');
      if (dragon) addNear(dragon.x, dragon.y, 1800, neutral, 2);
      if (late && baron) addNear(baron.x, baron.y, 1800, neutral, 2);
      const mid = w.pointAt('bot', w.laneLength('bot') / 2);
      addNear(mid.x, mid.y, 3200, neutral, 2);
    } else if (this.role === 'jungle') {
      // 敌方野区入口
      addNear(w.center.x, w.center.y, 3000, (b) => b.side === 1 - c.team && b.kind !== 'base', 3);
      const dragon = w.camps.find((k) => k.kind === 'dragon');
      if (dragon) addNear(dragon.x, dragon.y, 1500, neutral, 1);
    } else if (this.lane) {
      const mid = w.pointAt(this.lane, w.laneLength(this.lane) / 2);
      addNear(mid.x, mid.y, 3200, neutral, 3);
      if (late) {
        const baron = w.camps.find((k) => k.kind === 'baron');
        if (baron) addNear(baron.x, baron.y, 1600, neutral, 1);
      }
    }
    this._wardSpotCache = { spots, until: this.game.time + 60 };
    return spots;
  },

  _considerWard() {
    const c = this.champ;
    const now = this.game.time;
    if (now < (this.nextWardAt || 0) || now < 100 || !c.alive || c.channel) return;
    if (this.mode === 'fighting' || this.mode === 'retreating' || this.mode === 'recalling') return;
    const hasTrinket = c.trinket && c.trinket.charges > 0;
    const cwSlot = (this.role === 'support' || this.role === 'jungle' || this.brain.isLateGame()) ? findControlWardSlot(c) : -1;
    if (!hasTrinket && cwSlot < 0) return;
    const spots = this._wardSpots();
    const wards = this.game.wards;
    for (const s of spots) {
      const d = Math.hypot(s.x - c.x, s.y - c.y);
      if (d > 1100) continue;
      let covered = false;
      for (const wd of wards) {
        if (!wd.alive || wd.team !== c.team) continue;
        if ((wd.x - s.x) ** 2 + (wd.y - s.y) ** 2 < 800 * 800) { covered = true; break; }
      }
      if (covered) continue;
      if (this.isUnderEnemyTurret(s.x, s.y)) continue;
      // 优先控制守卫（辅助/打野的关键点）
      if (cwSlot >= 0 && d <= 600) {
        const hasCtrl = wards.some((wd) => wd.alive && wd.owner === c && wd.kind === 'control');
        if (!hasCtrl) {
          const r = c.useItem(cwSlot, { x: s.x, y: s.y });
          if (r.ok) { this.nextWardAt = now + 8; return; }
        }
      }
      if (hasTrinket) {
        if (d <= 600) {
          const r = c.useTrinket(s.x, s.y);
          if (r.ok) { this.nextWardAt = now + 12 + this.game.rng() * 10; return; }
        }
      }
    }
    this.nextWardAt = now + 2;
  },

  // 真人感：长时间站着不动时小幅走动
  _idleJitter(x, y, r) {
    const c = this.champ;
    const now = this.game.time;
    if (now < (this.nextJitterAt || 0)) return;
    this.nextJitterAt = now + 1.8 + this.game.rng() * 2.5;
    const a = this.game.rng() * Math.PI * 2;
    const k = r * (0.3 + this.game.rng() * 0.7);
    let px = x + Math.cos(a) * k, py = y + Math.sin(a) * k;
    if (!this.game.nav.isWalkable(px, py)) { px = x; py = y; }
    if (Math.hypot(px - c.x, py - c.y) < 30) return;
    this.goTo(px, py, { tol: 20 });
  },

  _inTurretRangeOf(t, x, y) {
    return (t.x - x) ** 2 + (t.y - y) ** 2 <= (TURRET_RANGE + this.champ.radius + 30) ** 2;
  },
};
