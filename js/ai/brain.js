// 队伍大脑（每队一个，所有 AI 共享）：兵线态势、敌方英雄最后位置与冷却估计、野怪营地计时、团队目标（推线/控龙/男爵/先锋/防守）
import { TIMINGS } from '../config.js';
import { getWorld, TURRET_RANGE } from './world.js';

const LANES = ['top', 'mid', 'bot'];
const WAVE_INTERVAL = 0.25;
const PLAN_INTERVAL = 1.5;

export function getBrain(game, team) {
  if (!game._aiBrains) game._aiBrains = [null, null];
  let b = game._aiBrains[team];
  if (!b) { b = new TeamBrain(game, team); game._aiBrains[team] = b; }
  return b;
}

function emptyWave() {
  return { allyFront: null, allyFrontUnit: null, allyCount: 0, allyNearFront: 0, enemyFront: null, enemyFrontUnit: null, enemyCount: 0, enemyNearFront: 0 };
}

export class TeamBrain {
  constructor(game, team) {
    this.game = game;
    this.team = team;
    this.world = getWorld(game);
    this.members = [];
    this.waves = { top: emptyWave(), mid: emptyWave(), bot: emptyWave() };
    this.enemySeen = new Map();      // 敌方英雄 → { x, y, t, hp, maxHp }
    this.enemyCd = new Map();        // 敌方英雄 → { Q, W, E, R, D, F: 预计就绪时间 }
    this.camps = new Map();          // 营地 id → { respawnAt, checkedAt }
    this._campCache = new WeakMap();
    this.objective = null;           // 团队目标
    this.groupLane = 'mid';
    this.groupLaneSince = -99;
    this.splitPusher = null;
    this.nextWave = 0;
    this.nextPlan = 1;
    this.nextSeen = 0;
    this.lastTeamfightAt = -99;
    this.dragonsTaken = 0;
    this.fightSpot = null;          // 正在进行的团战位置 { x, y, t, allies, enemies }
    this.focus = null;              // 团队集火目标
    this.nextFocus = 0;
    this.waveThreat = { top: null, mid: null, bot: null };   // 敌方兵线压到我方建筑（无人防守）
    this.defenders = new Map();     // 兵线防守分配：lane → { ai, until }
    this.laneSwap = null;           // 中期换线：{ since }（下路组合转中、中单去下路）
    this.splitSince = -99;
    for (const c of this.world.camps) {
      let at = c.firstSpawn ?? TIMINGS.JUNGLE_SPAWN;
      if (c.kind === 'dragon') at = Math.max(at, TIMINGS.DRAGON_SPAWN);
      if (c.kind === 'baron') at = Math.max(at, TIMINGS.BARON_SPAWN);
      if (c.kind === 'herald') at = Math.max(at, TIMINGS.HERALD_SPAWN);
      this.camps.set(c.id, { respawnAt: at, checkedAt: -99, gone: false });
    }
    const ev = game.events;
    ev.on('abilityCast', (e) => this._onCast(e));
    ev.on('summonerCast', (e) => this._onSummoner(e));
    ev.on('death', (e) => this._onDeath(e));
  }

  register(ai) { if (!this.members.includes(ai)) this.members.push(ai); }

  // —— 事件：记录可见敌人的技能冷却 ——
  _onCast(e) {
    const c = e.caster;
    if (!c || c.team === this.team || c.type !== 'champion' || !c.visible?.[this.team]) return;
    const ab = c.abilities?.[e.slot];
    if (!ab || e.isRecast) return;
    let cd = 10;
    try { cd = ab.cooldownFor ? ab.cooldownFor() : 10; } catch { /* 忽略 */ }
    const rec = this.enemyCd.get(c) || {};
    rec[e.slot] = this.game.time + cd;
    this.enemyCd.set(c, rec);
  }
  _onSummoner(e) {
    const c = e.caster;
    if (!c || c.team === this.team || !c.visible?.[this.team]) return;
    const st = c.summoners?.[e.key];
    const rec = this.enemyCd.get(c) || {};
    rec[e.key] = this.game.time + (st?.def?.cooldown ?? 180);
    this.enemyCd.set(c, rec);
  }
  _onDeath(e) {
    const u = e.unit;
    if (!u || u.type !== 'monster') return;
    const def = this._campOf(u);
    if (!def) return;
    // 普通营地只在看到时知道；史诗野怪全图播报
    const known = def.kind === 'dragon' || def.kind === 'baron' || def.kind === 'herald' || u.visible?.[this.team] || (e.killerChampion && e.killerChampion.team === this.team);
    if (!known) return;
    // 营地还有活着的野怪 → 尚未清空（重生计时从全部击杀后开始）
    const others = this.game.monsters.some((m) => m !== u && m.alive && !m.removed && this._campOf(m) === def);
    if (others) return;
    const st = this.camps.get(def.id);
    if (!st) return;
    if (def.kind === 'herald') { st.respawnAt = Infinity; st.gone = true; return; }
    let resp = def.respawn ?? 135;
    if (def.kind === 'dragon') resp = TIMINGS.DRAGON_RESPAWN;
    if (def.kind === 'baron') resp = TIMINGS.BARON_RESPAWN;
    st.respawnAt = this.game.time + resp;
    if (def.kind === 'dragon' && e.killerChampion?.team === this.team) this.dragonsTaken++;
  }
  _campOf(m) {
    const w = this.world;
    if (m.camp && w.campById.has(m.camp)) return w.campById.get(m.camp);
    if (this._campCache.has(m)) return this._campCache.get(m);
    let best = null, bd = 900 * 900;
    const hx = m.homeX ?? m.x, hy = m.homeY ?? m.y;
    for (const c of w.camps) {
      const d = (c.x - hx) ** 2 + (c.y - hy) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    this._campCache.set(m, best);
    return best;
  }
  campOfMonster(m) { return this._campOf(m); }

  // 营地是否（据我方所知）存活
  campUp(def) {
    const st = this.camps.get(def.id);
    if (!st || st.gone) return false;
    const now = this.game.time;
    if (def.kind === 'herald' && now >= (def.despawnAt ?? TIMINGS.HERALD_DESPAWN)) return false;
    return now >= st.respawnAt;
  }
  campRespawnAt(def) { return this.camps.get(def.id)?.respawnAt ?? 0; }
  // 实际看到的营地野怪
  campMonsters(def) {
    const out = [];
    for (const m of this.game.monsters) {
      if (!m.alive || m.removed) continue;
      if (this._campOf(m) !== def) continue;
      out.push(m);
    }
    return out;
  }
  // 我方英雄到达营地却看不到野怪：推断已被清
  markCampChecked(def, seenAlive) {
    const st = this.camps.get(def.id);
    if (!st) return;
    const now = this.game.time;
    st.checkedAt = now;
    if (!seenAlive && now >= st.respawnAt + 4) {
      if (def.kind === 'herald') { st.gone = true; return; }
      st.respawnAt = now + (def.respawn ?? 135) * 0.6;
    }
  }

  // —— 周期更新 ——
  tick() {
    const now = this.game.time;
    if (now >= this.nextSeen) { this.nextSeen = now + 0.2; this._updateSeen(); }
    if (now >= this.nextWave) { this.nextWave = now + WAVE_INTERVAL; this._updateWaves(); }
    if (now >= this.nextPlan) { this.nextPlan = now + PLAN_INTERVAL; this._plan(); }
    if (now >= this.nextFocus) { this.nextFocus = now + 0.3; this._updateFight(); }
  }

  // 团战感知：多名队友交战的位置（供附近队友集结），以及团队集火目标（有效生命低 × 威胁高 × 被控 × 多人可打到）
  _updateFight() {
    const now = this.game.time;
    let fx = 0, fy = 0, n = 0;
    for (const a of this.members) {
      const c = a.champ;
      if (!c.alive || a.mode !== 'fighting' || !a.target || a.target.type !== 'champion') continue;
      fx += c.x; fy += c.y; n++;
    }
    if (n >= 1) {
      fx /= n; fy /= n;
      let enemies = 0;
      for (const e of this.game.champions) {
        if (e.team === this.team || !e.alive || !e.visible[this.team]) continue;
        if ((e.x - fx) ** 2 + (e.y - fy) ** 2 < 1600 * 1600) enemies++;
      }
      if (enemies >= 1 && (n >= 2 || enemies >= 2)) {
        this.fightSpot = { x: fx, y: fy, t: now, allies: n, enemies };
        this.lastTeamfightAt = n + enemies >= 4 ? now : this.lastTeamfightAt;
      }
    }
    if (this.fightSpot && now - this.fightSpot.t > 3) this.fightSpot = null;
    // 集火目标
    let best = null, bs = 0;
    for (const e of this.game.champions) {
      if (e.team === this.team || !e.alive || !e.visible[this.team] || e.untargetable) continue;
      let sc = 0, k = 0;
      for (const a of this.members) {
        const c = a.champ;
        if (!c.alive) continue;
        const d = Math.hypot(c.x - e.x, c.y - e.y);
        const reach = c.stats.attackRange + c.radius + e.radius + 250;
        if (d > Math.max(reach, 900)) continue;
        k++;
        sc += d <= reach ? 1 : 0.5;
      }
      if (k === 0) continue;
      const s = e.stats;
      const ehp = (e.hp + (e.totalShield || 0)) * (1 + ((s.armor || 0) + (s.mr || 0)) / 200);
      const pri = { adc: 1.35, mid: 1.25, jungle: 1.05, top: 0.95, support: 0.85 }[e.role] ?? 1;
      let v = sc * pri * 1000 / Math.max(150, ehp);
      if (e.isHardCCd?.()) v *= 1.3;
      if (this.focus === e) v *= 1.25;  // 集火粘性
      if (v > bs) { bs = v; best = e; }
    }
    this.focus = best;
  }

  _updateSeen() {
    const now = this.game.time;
    for (const c of this.game.champions) {
      if (c.team === this.team) continue;
      if (c.alive && c.visible[this.team]) this.enemySeen.set(c, { x: c.x, y: c.y, t: now, hp: c.hp, maxHp: c.maxHp });
    }
  }
  lastSeen(enemy) { return this.enemySeen.get(enemy) || null; }
  enemyCooldowns(enemy) { return this.enemyCd.get(enemy) || null; }

  // 兵线态势：己方最前小兵、敌方最前（可见）小兵的推进坐标
  _updateWaves() {
    const w = this.world;
    const team = this.team;
    for (const lane of LANES) { const wv = this.waves[lane]; Object.assign(wv, emptyWave()); }
    const fronts = { top: [], mid: [], bot: [] };
    for (const m of this.game.minions) {
      if (!m.alive || m.removed) continue;
      const lane = m.lane;
      const wv = this.waves[lane];
      if (!wv) continue;
      const mine = m.team === team;
      if (!mine && !m.visible[team]) continue;
      const f = w.toF(team, lane, w.project(lane, m.x, m.y));
      if (w.lastProjDist > 1400) continue;
      fronts[lane].push([f, mine, m]);
      if (mine) {
        wv.allyCount++;
        if (wv.allyFront == null || f > wv.allyFront) { wv.allyFront = f; wv.allyFrontUnit = m; }
      } else {
        wv.enemyCount++;
        if (wv.enemyFront == null || f < wv.enemyFront) { wv.enemyFront = f; wv.enemyFrontUnit = m; }
      }
    }
    for (const lane of LANES) {
      const wv = this.waves[lane];
      for (const [f, mine] of fronts[lane]) {
        if (mine && wv.allyFront - f < 700) wv.allyNearFront++;
        if (!mine && f - wv.enemyFront < 700) wv.enemyNearFront++;
      }
    }
  }

  // —— 团队规划 ——
  aliveCounts() {
    let ours = 0, theirs = 0;
    for (const c of this.game.champions) { if (!c.alive) continue; if (c.team === this.team) ours++; else theirs++; }
    return { ours, theirs };
  }
  isLateGame() { return this.game.time >= 14 * 60 || this._outerLost(); }
  _outerLost() {
    const w = this.world;
    for (const t of [0, 1]) for (const l of LANES) {
      const outer = w.laneStructs[t][l].find((s) => s.type === 'turret' && s.tier === 'outer');
      if (outer && !outer.alive && this.game.time >= 10 * 60) return true;
    }
    return false;
  }

  _campByKind(kind) { return this.world.camps.find((c) => c.kind === kind) || null; }

  // 最近 t 秒内在某点附近被看到的敌人数量
  enemiesKnownNear(x, y, r, within = 8) {
    const now = this.game.time;
    let n = 0;
    for (const [c, s] of this.enemySeen) {
      if (!c.alive || now - s.t > within) continue;
      if ((s.x - x) ** 2 + (s.y - y) ** 2 <= r * r) n++;
    }
    return n;
  }

  // 有效人数差：即将复活（10 秒内）的敌人按存活计（复活计时在记分板上公开）
  effectiveAdvantage() {
    let ours = 0, theirs = 0;
    for (const c of this.game.champions) {
      const soon = c.alive || c.respawnRemaining < 10;
      if (c.team === this.team) { if (c.alive) ours++; } else if (soon) theirs++;
    }
    return ours - theirs;
  }

  // 敌方基地是否已被打开（任一路水晶被破 / 枢纽塔可打）
  enemyBaseOpen() {
    const w = this.world;
    const def = 1 - this.team;
    for (const i of w.inhibitors[def] || []) if (!i.alive) return true;
    for (const t of w.nexusTurrets[def] || []) if (!t.alive || !t.invulnerable) return true;
    return false;
  }

  // 敌方是否正在打某史诗野怪（最近在坑附近见到敌人，且野怪掉血或被仇恨）
  _enemyOnEpic(def, within = 5) {
    if (!def) return 0;
    const n = this.enemiesKnownNear(def.x, def.y, 1500, within);
    if (n === 0) return 0;
    for (const m of this.campMonsters(def)) {
      if (!m.visible?.[this.team]) continue;
      const tgt = m.aggroTarget;
      if ((tgt && tgt.team !== this.team) || m.hp < m.maxHp * 0.97) return n;
    }
    return n >= 2 ? n : 0;
  }

  // 团队实力（等级、装备、当前生命）：用于优劣势评估（记分板信息，敌方用最近一次看到的生命）
  teamPower(team) {
    let p = 0;
    for (const c of this.game.champions) {
      if (c.team !== team || !c.alive) continue;
      const items = c.items ? c.items.filter(Boolean).length : 0;
      let hpPct = c.hp / Math.max(1, c.maxHp);
      if (team !== this.team) { const s = this.enemySeen.get(c); hpPct = s ? Math.min(1, s.hp / Math.max(1, s.maxHp) + (this.game.time - s.t) * 0.01) : 1; }
      p += (c.level + items * 1.6 + 4) * (0.45 + 0.55 * hpPct);
    }
    return p;
  }

  // 史诗野怪是否在 win 秒内刷新（用于提前集结布置）
  _spawnSoon(def, win) {
    if (!def) return false;
    const st = this.camps.get(def.id);
    if (!st || st.gone) return false;
    const at = st.respawnAt;
    return !this.campUp(def) && at - this.game.time <= win && at > this.game.time;
  }

  _plan() {
    const game = this.game;
    const now = game.time;
    const { ours, theirs } = this.aliveCounts();
    const advEff = this.effectiveAdvantage();
    this.advEff = advEff;
    const prev = this.objective;
    const late = this.isLateGame();
    const baseOpen = this.enemyBaseOpen();
    const pr = this.teamPower(this.team) / Math.max(1, this.teamPower(1 - this.team));
    this.powerRatio = pr;
    const baronBuff = (game.teams?.[this.team]?.baronUntil ?? -1) > now;
    let obj = null;

    // 0) 残局：敌方基地已开且人数优势明显 → 直接推家（优先于男爵/小龙）
    const endgame = (baseOpen && (advEff >= 2 || (theirs <= 1 && ours >= 2))) || (theirs === 0 && ours >= 2 && late);

    // 1) 防守：敌方英雄出现在我方建筑附近
    const threat = this._structureThreat();
    const earlyLaneThreat = threat && !late && threat.structure.type === 'turret' && (threat.structure.tier === 'outer' || threat.structure.tier === 'inner') && threat.count < 3;
    const ignoreThreat = endgame && threat && (threat.count <= 1 || (!threat.base && advEff >= 2));
    if (threat && (threat.count >= 2 || threat.base) && !earlyLaneThreat && !ignoreThreat) {
      obj = { kind: 'defend', x: threat.x, y: threat.y, lane: threat.lane, structure: threat.structure, since: now, all: threat.base || threat.count >= 3 };
    }

    if (!obj && endgame) {
      const lane = this._chooseGroupLane(advEff, theirs, true);
      obj = { kind: 'push', lane, since: now, all: true, end: true, siegeOk: true };
    }

    // 2) 纳什男爵（含刷新前 45 秒集结布置）
    const baronDef = this._campByKind('baron');
    if (!obj && baronDef && now >= TIMINGS.BARON_SPAWN - 45) {
      const up = this.campUp(baronDef);
      const enemyNear = this.enemiesKnownNear(baronDef.x, baronDef.y, 2500, 10);
      const onIt = up ? this._enemyOnEpic(baronDef) : 0;
      const strong = advEff >= 2 || (theirs <= 2 && ours >= 3) || (advEff >= 1 && pr > 1.2);
      if (up && strong && enemyNear <= Math.max(0, ours - 3)) obj = { kind: 'baron', x: baronDef.x, y: baronDef.y, camp: baronDef, since: now, all: true };
      else if (up && onIt && ours >= 3 && ours >= onIt) obj = { kind: 'baron', x: baronDef.x, y: baronDef.y, camp: baronDef, since: now, all: true, contest: true };
      else if (this._spawnSoon(baronDef, 45) && advEff >= 0 && pr > 1.05 && ours >= 4) obj = { kind: 'baron', x: baronDef.x, y: baronDef.y, camp: baronDef, since: now, all: true, setup: true };
      else if (prev?.kind === 'baron' && this._epicInProgress(baronDef) && advEff >= 0) obj = prev;
    }

    // 3) 元素亚龙（含刷新前 40 秒集结布置）
    const dragonDef = this._campByKind('dragon');
    if (!obj && dragonDef) {
      const up = this.campUp(dragonDef);
      const soon = this._spawnSoon(dragonDef, 40);
      const enemyNear = this.enemiesKnownNear(dragonDef.x, dragonDef.y, 3000, 10);
      const onIt = up ? this._enemyOnEpic(dragonDef) : 0;
      if (late) {
        const good = advEff >= 1 || (advEff >= 0 && (enemyNear === 0 || pr > 1.1) && ours >= 4);
        if (up && good) obj = { kind: 'dragon', x: dragonDef.x, y: dragonDef.y, camp: dragonDef, since: now, all: true };
        else if (up && onIt && ours >= 3 && ours >= onIt) obj = { kind: 'dragon', x: dragonDef.x, y: dragonDef.y, camp: dragonDef, since: now, all: true, contest: true };
        else if (soon && advEff >= 0 && pr > 0.9 && ours >= 4) obj = { kind: 'dragon', x: dragonDef.x, y: dragonDef.y, camp: dragonDef, since: now, all: true, setup: true };
      } else if (up || soon) {
        // 前期：打野 5 级以上、下路至少一人 4 级以上且状态良好才去
        const jg = this.members.find((a) => a.role === 'jungle' && a.champ.alive && a.champ.hpPct > 0.5 && a.champ.level >= 5);
        const bot = this.members.filter((a) => (a.role === 'adc' || a.role === 'support') && a.champ.alive && a.champ.hpPct > 0.5 && a.champ.level >= 4);
        const roles = ['jungle', 'adc', 'support', 'mid'];
        if (jg && bot.length >= 1 && enemyNear <= bot.length && pr > 0.85) obj = { kind: 'dragon', x: dragonDef.x, y: dragonDef.y, camp: dragonDef, since: now, all: false, roles, setup: !up };
        else if (up && onIt && jg && bot.length >= 1 && onIt <= bot.length + 1) obj = { kind: 'dragon', x: dragonDef.x, y: dragonDef.y, camp: dragonDef, since: now, all: false, roles, contest: true };
      }
      if (!obj && prev?.kind === 'dragon' && this._epicInProgress(dragonDef) && enemyNear <= 2) obj = prev;
    }

    // 4) 峡谷先锋（前期，上半区）
    const heraldDef = this._campByKind('herald');
    if (!obj && heraldDef && !late && this.campUp(heraldDef) && now < (heraldDef.despawnAt ?? TIMINGS.HERALD_DESPAWN) - 30) {
      const enemyNear = this.enemiesKnownNear(heraldDef.x, heraldDef.y, 3000, 10);
      const jg = this.members.find((a) => a.role === 'jungle' && a.champ.alive && a.champ.hpPct > 0.5);
      if (jg && enemyNear === 0 && jg.champ.level >= 6) obj = { kind: 'herald', x: heraldDef.x, y: heraldDef.y, camp: heraldDef, since: now, all: false, roles: ['jungle', 'top', 'mid'] };
      else if (prev?.kind === 'herald' && enemyNear <= 1) obj = prev;
    }

    // 5) 中后期：抱团推进（人数优势 / 敌方基地已开 / 20 分钟后全员参与）；明显劣势时守塔清线
    if (!obj && late) {
      const lane = this._chooseGroupLane(advEff, theirs, false);
      const all = advEff >= 1 || theirs <= 3 || baseOpen || now >= 20 * 60 || (prev?.kind === 'push' && prev.all && advEff >= 0);
      // 高地推进时机：人数优势 2+、男爵 Buff、基地已开、己方超级兵、或 30 分钟后
      const siegeOk = advEff >= 2 || baronBuff || baseOpen || (advEff >= 1 && pr > 1.4) || this._superWave(lane) || now >= 30 * 60;
      const behind = advEff <= -1 || (advEff <= 0 && pr < 0.78);
      obj = { kind: 'push', lane, since: now, all, siegeOk, hold: behind && !baronBuff };
    }

    obj = this._commit(obj, prev, advEff);
    if (obj && obj !== prev) obj.setAt = now;
    this.objective = obj;
    if (obj && obj.kind === 'push' && obj.all && advEff >= 2) this.lastPressAt = now;

    // 分推人选：中后期上单（生命值健康）走另一条边路；团队全力推进时不分推；有承诺时间，避免反复切换
    const top = this.members.find((a) => a.role === 'top' && a.champ.alive && a.champ.hpPct > 0.4);
    const wantSplit = obj && obj.kind === 'push' && !obj.all && now >= 16 * 60 && top;
    if (wantSplit) { if (this.splitPusher !== top) { this.splitPusher = top; this.splitSince = now; } }
    else if (this.splitPusher && (!this.splitPusher.champ.alive || now - this.splitSince > 30 || !obj || obj.kind !== 'push' || obj.end || obj.hold)) this.splitPusher = null;

    this._updateWaveThreats(late);
    this._updateLaneSwap(late);
  }

  // 目标承诺：新目标需在旧目标持续一段时间且旧目标失效后才替换（紧急防守/残局/抢龙除外），避免全队来回跑
  _commit(obj, prev, advEff) {
    const now = this.game.time;
    if (!prev) return obj;
    if (obj && obj.kind === prev.kind && obj.lane === prev.lane && obj.camp === prev.camp) {
      obj.since = prev.since; obj.setAt = prev.setAt;
      return obj;
    }
    if (obj && (obj.end || obj.contest)) return obj;
    if (obj && obj.kind === 'defend' && (obj.all || obj.structure?.type !== 'turret' || obj.structure?.tier === 'inhib' || obj.structure?.tier === 'nexus')) return obj;
    const age = now - (prev.setAt ?? prev.since ?? now);
    const hold = { push: 18, dragon: 22, baron: 22, herald: 18, defend: 8 }[prev.kind] ?? 10;
    if (age < hold && this._objValid(prev, advEff)) return prev;
    return obj;
  }
  _objValid(o, advEff) {
    const now = this.game.time;
    if (o.kind === 'dragon' || o.kind === 'baron' || o.kind === 'herald') {
      if (advEff <= -2) return false;
      if (this.campUp(o.camp) || this.campMonsters(o.camp).length) return true;
      return !!o.setup && this.campRespawnAt(o.camp) - now < 50 && this.campRespawnAt(o.camp) > now - 5;
    }
    if (o.kind === 'push') return !!this.world.nextEnemyStructure(this.team, o.lane) && advEff > -2;
    if (o.kind === 'defend') return !!o.structure?.alive;
    return true;
  }

  // 我方正在打该史诗野怪（野怪掉血且仇恨在我方）
  _epicInProgress(def) {
    for (const m of this.campMonsters(def)) {
      if (!m.visible?.[this.team]) continue;
      if (m.hp < m.maxHp * 0.97 && m.aggroTarget && m.aggroTarget.team === this.team) return true;
    }
    return false;
  }

  // 该路是否有己方超级兵 / 男爵强化兵正在推进
  _superWave(lane) {
    for (const m of this.game.minions) {
      if (!m.alive || m.team !== this.team || m.lane !== lane) continue;
      if (m.kind === 'super' || m.empowered) return true;
    }
    return false;
  }

  // 兵线防守：敌方兵线（≥3 个）压到我方塔/水晶附近且附近没有我方小兵 → 记录威胁，分配最近的空闲队友回防
  _updateWaveThreats(late) {
    const w = this.world;
    const now = this.game.time;
    for (const lane of LANES) {
      const wv = this.waves[lane];
      const own = w.frontStructure(this.team, lane) || w.nexusTurrets[this.team]?.find((t) => t.alive) || null;
      let th = null;
      if (own && wv.enemyFront != null && wv.enemyNearFront >= 3) {
        const ownF = w.toF(this.team, lane, w.structureS(own) ?? w.project(lane, own.x, own.y));
        const allyHere = wv.allyFront != null && wv.allyFront > wv.enemyFront - 700;
        if (wv.enemyFront < ownF + 900 && (!allyHere || wv.allyNearFront <= 1)) th = { lane, structure: own, f: wv.enemyFront, n: wv.enemyNearFront, t: now };
      }
      this.waveThreat[lane] = th;
      const cur = this.defenders.get(lane);
      if (!th) { if (cur && now > cur.until) this.defenders.delete(lane); continue; }
      if (cur && cur.ai.champ.alive && now < cur.until) continue;
      if (!late) { this.defenders.delete(lane); continue; }   // 对线期由各路自己处理
      // 选择防守者：离得近、状态好、不在交战；优先分推者/上单/中单
      let best = null, bs = Infinity;
      for (const a of this.members) {
        const c = a.champ;
        if (!c.alive || c.hpPct < 0.4 || a.mode === 'fighting' || a.role === 'support') continue;
        if ([...this.defenders.values()].some((d) => d.ai === a && d.lane !== lane)) continue;
        let d = Math.hypot(c.x - th.structure.x, c.y - th.structure.y);
        if (a === this.splitPusher) d *= 0.6;
        if (a.role === 'top' || a.role === 'mid') d *= 0.85;
        if (d < bs) { bs = d; best = a; }
      }
      if (best && bs < 9000) this.defenders.set(lane, { ai: best, lane, until: now + 20 });
    }
  }
  defenderLane(ai) {
    for (const [lane, d] of this.defenders) if (d.ai === ai && this.game.time < d.until && this.waveThreat[lane]) return lane;
    return null;
  }

  // 中期换线（LoL 常见节奏）：我方下路推掉敌方下路外塔后，下路组合转中路推中塔，中单去下路发育
  _updateLaneSwap(late) {
    const now = this.game.time;
    if (late || now < 8 * 60) { this.laneSwap = null; return; }
    if (this.laneSwap) return;
    const w = this.world;
    const botOuter = w.laneStructs[1 - this.team].bot.find((s) => s.type === 'turret' && s.tier === 'outer');
    const midOuter = w.laneStructs[1 - this.team].mid.find((s) => s.type === 'turret' && s.tier === 'outer');
    if (botOuter && !botOuter.alive && midOuter && midOuter.alive) this.laneSwap = { since: now };
  }
  // 某成员当前应去的兵线
  laneFor(ai) {
    if (this.laneSwap && !this.isLateGame()) {
      if (ai.role === 'adc' || ai.role === 'support') return 'mid';
      if (ai.role === 'mid') return 'bot';
    }
    return ai.lane;
  }

  // 乘胜追击：刚打赢团战 / 残局推家时，不因金币或中等血量回城
  pressing() {
    const o = this.objective;
    return !!(o && o.kind === 'push' && (o.end || (o.all && (this.advEff ?? 0) >= 2)));
  }

  // 选择抱团推进的兵线：敌方建筑越深越残、我方兵线越靠前、离团队越近越好；当前路有粘性，避免来回换线
  _chooseGroupLane(adv, theirsAlive, end = false) {
    const w = this.world;
    const now = this.game.time;
    // 团队重心（存活成员，不含分推者）
    let cx = 0, cy = 0, n = 0;
    for (const a of this.members) {
      const c = a.champ;
      if (!c.alive || a === this.splitPusher) continue;
      cx += c.x; cy += c.y; n++;
    }
    const f = this.game.fountainOf(this.team);
    if (n === 0) { cx = f.x; cy = f.y; } else { cx /= n; cy /= n; }
    let best = this.groupLane, bestScore = -Infinity, curScore = -Infinity;
    for (const lane of LANES) {
      const next = w.nextEnemyStructure(this.team, lane);
      if (!next) continue;
      const tierDepth = next.type === 'nexus' ? 5 : next.type === 'inhibitor' ? 4 : ({ outer: 1, inner: 2, inhib: 3, nexus: 4.5 }[next.tier] ?? 1);
      let score = tierDepth * (end ? 1.6 : 0.9);
      score += (1 - next.hp / next.maxHp) * 2.5;
      const wv = this.waves[lane];
      if (wv.allyFront != null) score += (wv.allyFront / w.laneLength(lane)) * 1.5;
      if (lane === 'mid') score += 1.0;
      // 己方超级兵 / 男爵强化兵线：跟进推进
      if (this._superWave(lane)) score += 1.6;
      if (!end && lane === 'bot') {
        const dr = this._campByKind('dragon');
        if (dr && this.campUp(dr)) score += 0.4;
      }
      // 路程：团队重心到目标建筑（每 3000 单位扣 1 分）
      score -= Math.hypot(next.x - cx, next.y - cy) / 3000;
      // 已知防守者
      score -= this.enemiesKnownNear(next.x, next.y, 2000, 8) * 0.4;
      if (lane === this.groupLane) curScore = score;
      if (score > bestScore) { bestScore = score; best = lane; }
    }
    // 粘性：新路需明显更优（出发 60 秒内更难换线）
    const hold = now - this.groupLaneSince < 60 ? 2.2 : 1.2;
    if (best !== this.groupLane && curScore > -Infinity && bestScore - curScore < hold) best = this.groupLane;
    if (best !== this.groupLane) { this.groupLane = best; this.groupLaneSince = now; }
    return best;
  }

  // 我方建筑受威胁情况
  _structureThreat() {
    const game = this.game;
    const w = this.world;
    let best = null;
    const mine = w.turrets(this.team).concat(w.inhibitors[this.team] || [], w.nexus[this.team] ? [w.nexus[this.team]] : []);
    for (const s of mine) {
      if (!s.alive || s.invulnerable) continue;
      let count = 0;
      for (const c of game.champions) {
        if (c.team === this.team || !c.alive || !c.visible[this.team]) continue;
        if ((c.x - s.x) ** 2 + (c.y - s.y) ** 2 <= (TURRET_RANGE + 700) ** 2) count++;
      }
      if (count === 0) continue;
      const base = s.type === 'nexus' || s.type === 'inhibitor' || s.tier === 'inhib' || s.tier === 'nexus';
      const score = count + (base ? 2 : 0) + (1 - s.hp / s.maxHp);
      if (!best || score > best.score) best = { score, count, base, x: s.x, y: s.y, lane: s.lane || 'mid', structure: s };
    }
    return best;
  }

  // 该 AI 是否参与当前团队目标
  participates(ai) {
    const o = this.objective;
    if (!o) return false;
    if (o.kind === 'push') {
      if (this.splitPusher === ai) return false;
      // 打野在 25 分钟前优先刷野，团队全力推进时再加入
      if (ai.role === 'jungle' && !o.all && this.game.time < 25 * 60) return false;
      return true;
    }
    if (o.all) return true;
    if (o.kind === 'defend') {
      const c = ai.champ;
      return Math.hypot(c.x - o.x, c.y - o.y) < 6000 || o.structure?.type !== 'turret' || o.structure?.tier !== 'outer';
    }
    if (o.roles) {
      if (!o.roles.includes(ai.role)) return false;
      if (ai.role === 'mid') {
        const c = ai.champ;
        return Math.hypot(c.x - o.x, c.y - o.y) < 4500;
      }
      return true;
    }
    return false;
  }
}
