// 刷新调度：建筑创建、开局播报、兵线（1:05 起每 30 秒；炮车/超级兵规则）、野怪营地首刷与重生、小龙类型轮换、先锋/男爵时间、BUFF 转移
import { createStructure, updateStructureLocks } from './structures.js';
import { Minion } from './minion.js';
import { Monster, DRAGON_TYPES, DRAGON_INFO, transferJungleBuffs } from './monsters.js';
import { TIMINGS } from '../config.js';

export const MINION_SPAWN_GAP = 0.8;      // 同一波小兵之间的出兵间隔（秒）
export const SPAWN_OFFSET = 250;          // 出兵点：沿兵线离开枢纽的距离
export const ELDER_RESPAWN = 360;
export const HERALD_RESPAWN = 360;
const FORMATION = [0, -55, 55];

// 营地种类 → objectiveKilled 的 kind
function objectiveKind(campKind) {
  if (campKind === 'scuttle_top' || campKind === 'scuttle_bot') return 'scuttle';
  return campKind;
}

export class Spawner {
  constructor(game) {
    this.game = game;
    this.wave = 0;
    this.nextWaveAt = TIMINGS.FIRST_WAVE;
    this.flags = { welcome: false, minions30: false, spawned: false };
    this.camps = [];
    this.campById = new Map();
    this.lanePaths = [{}, {}];         // [team][lane] → 该队小兵的路径点（己方枢纽 → 敌方枢纽）
    this.dragonPlan = [];              // 前两条元素亚龙的类型
    this.soulType = null;              // 第三条起的元素亚龙类型（龙魂类型）
    this.dragonsKilled = 0;            // 已击杀的元素亚龙（不含远古巨龙）
  }

  init() {
    const game = this.game;
    for (const def of game.map.STRUCTURES || []) {
      const s = createStructure(game, def);
      if (s) game.add(s);
    }
    updateStructureLocks(game);
    const lanes = game.map.LANES || {};
    for (const lane of Object.keys(lanes)) {
      this.lanePaths[0][lane] = lanes[lane].map((p) => [p[0], p[1]]);
      this.lanePaths[1][lane] = lanes[lane].slice().reverse().map((p) => [p[0], p[1]]);
    }
    for (const def of game.map.CAMPS || []) {
      const c = {
        id: def.id, def, kind: def.kind, alive: false, units: [], spawnCount: 0,
        nextSpawn: def.firstSpawn ?? TIMINGS.JUNGLE_SPAWN, clearedAt: null, lastClearTeam: null, dragonType: null,
      };
      this.camps.push(c);
      this.campById.set(def.id, c);
    }
    // 元素亚龙类型：前两条随机且不同，第三条起为龙魂类型
    const types = DRAGON_TYPES.slice();
    this.dragonPlan.push(types.splice(Math.floor(game.rng() * types.length), 1)[0]);
    this.dragonPlan.push(types.splice(Math.floor(game.rng() * types.length), 1)[0]);
    this.soulType = types[Math.floor(game.rng() * types.length)];
    // 蓝/红 BUFF 转移：持有者被敌方英雄击杀
    game.events.on('death', (e) => {
      if (e.unit && e.unit.type === 'champion') transferJungleBuffs(game, e.unit, e.killerChampion);
    });
  }

  // 下一条小龙的类型（'elder' = 远古巨龙）
  get nextDragonType() {
    if (this.game.teams.some((t) => t.dragonSoul)) return 'elder';
    if (this.dragonsKilled < this.dragonPlan.length) return this.dragonPlan[this.dragonsKilled];
    return this.soulType;
  }

  camp(id) { return this.campById.get(id) || null; }

  // 距离营地刷新的秒数（存活为 0；不再刷新为 Infinity）
  campTimer(id) {
    const c = this.campById.get(id);
    if (!c) return Infinity;
    if (c.alive) return 0;
    return Math.max(0, c.nextSpawn - this.game.time);
  }

  update() {
    const game = this.game;
    const t = game.time;
    const f = this.flags;
    if (!f.welcome && t >= TIMINGS.WELCOME) { f.welcome = true; game.announce('welcome', '欢迎来到召唤师峡谷！', { team: null }); }
    if (!f.minions30 && t >= TIMINGS.MINIONS_30S) { f.minions30 = true; game.announce('minions30', '敌军还有三十秒到达战场！', { team: null }); }
    if (!f.spawned && t >= TIMINGS.FIRST_WAVE) { f.spawned = true; game.announce('minionsSpawned', '全军出击！', { team: null }); }
    let guard = 0;
    while (t >= this.nextWaveAt && guard++ < 4) {
      this.spawnWave();
      this.nextWaveAt += TIMINGS.WAVE_INTERVAL;
    }
    for (const c of this.camps) this._updateCamp(c, t);
  }

  // —— 兵线 ——
  // 本波是否有炮车：每 3 波；15 分钟后每 2 波；25 分钟后每波
  hasSiege(wave, time) {
    const min = time / 60;
    if (min >= 25) return true;
    if (min >= 15) return wave % 2 === 0;
    return wave % 3 === 0;
  }

  // 某队某路本波的小兵组成（从前到后）
  waveKinds(team, lane, wave = this.wave, time = this.game.time) {
    const game = this.game;
    const enemyInhibs = game.structures.filter((s) => s.type === 'inhibitor' && s.team !== team);
    const allDown = enemyInhibs.length > 0 && enemyInhibs.every((s) => !s.alive);
    const inhib = enemyInhibs.find((s) => s.lane === lane);
    const supers = inhib && !inhib.alive ? (allDown ? 2 : 1) : 0;
    const kinds = [];
    for (let i = 0; i < supers; i++) kinds.push('super');
    kinds.push('melee', 'melee', 'melee');
    // 超级兵取代该路的炮车
    if (supers === 0 && this.hasSiege(wave, time)) kinds.push('siege');
    kinds.push('caster', 'caster', 'caster');
    return kinds;
  }

  // 出兵点：沿兵线离开己方枢纽 SPAWN_OFFSET
  laneSpawnPoint(team, lane) {
    const pts = this.lanePaths[team][lane];
    if (!pts || pts.length === 0) return null;
    let left = SPAWN_OFFSET;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const l = Math.hypot(x1 - x0, y1 - y0) || 1;
      const dx = (x1 - x0) / l, dy = (y1 - y0) / l;
      if (left <= l) return { x: x0 + dx * left, y: y0 + dy * left, dirX: dx, dirY: dy };
      left -= l;
    }
    const p = pts[pts.length - 1];
    return { x: p[0], y: p[1], dirX: 1, dirY: 0 };
  }

  spawnMinion(team, lane, kind, index = 0) {
    const game = this.game;
    const pts = this.lanePaths[team][lane];
    const sp = this.laneSpawnPoint(team, lane);
    if (!pts || !sp) return null;
    const lat = FORMATION[index % FORMATION.length];
    const x = sp.x - sp.dirY * lat, y = sp.y + sp.dirX * lat;
    const m = new Minion(game, { team, kind, lane, waypoints: pts, x, y });
    m.setPosition(x, y);
    m.facing = Math.atan2(sp.dirY, sp.dirX);
    game.add(m);
    return m;
  }

  spawnWave() {
    const game = this.game;
    this.wave++;
    const w = this.wave;
    const hasSiege = this.hasSiege(w, game.time);
    let hasSuper = false;
    for (const team of [0, 1]) {
      for (const lane of Object.keys(this.lanePaths[team])) {
        const kinds = this.waveKinds(team, lane, w, game.time);
        if (kinds[0] === 'super') hasSuper = true;
        kinds.forEach((kind, i) => {
          if (i === 0) { this.spawnMinion(team, lane, kind, i); return; }
          game.after(i * MINION_SPAWN_GAP, () => { if (!game.over) this.spawnMinion(team, lane, kind, i); });
        });
      }
    }
    game.events.emit('minionWave', { wave: w, hasSiege, hasSuper });
  }

  // —— 营地 ——
  _updateCamp(c, t) {
    const def = c.def;
    if (c.alive) {
      // 峡谷先锋 19:45 离开（战斗中则延后，最迟 20:00 男爵刷新时）
      if (def.despawnAt != null && t >= def.despawnAt) {
        const engaged = c.units.some((u) => u.alive && u.inCombat);
        if (!engaged || t >= def.despawnAt + 15) this.despawnCamp(c);
      }
      return;
    }
    if (t < c.nextSpawn) return;
    if (def.despawnAt != null && t >= def.despawnAt) { c.nextSpawn = Infinity; return; }
    if (def.kind === 'baron') {
      for (const o of this.camps) if (o !== c && o.alive && o.def.pit && o.def.pit === def.pit) this.despawnCamp(o);
    }
    this.spawnCamp(c);
  }

  spawnCamp(campOrId) {
    const game = this.game;
    const c = typeof campOrId === 'string' ? this.campById.get(campOrId) : campOrId;
    if (!c) return [];
    const def = c.def;
    const dragonType = def.kind === 'dragon' ? this.nextDragonType : null;
    c.units = [];
    c.dragonType = dragonType;
    const list = def.monsters && def.monsters.length ? def.monsters : [{ kind: def.kind, x: def.x, y: def.y, facing: def.facing }];
    for (const m of list) {
      const mon = new Monster(game, {
        kind: m.kind || def.kind, camp: def.id, campKind: def.kind, campState: c,
        x: m.x ?? def.x, y: m.y ?? def.y, leash: def.leash ?? 900, facing: m.facing ?? def.facing ?? 0,
        dragonType, path: def.path || null,
      });
      mon.setPosition(mon.x, mon.y);
      mon.homeX = mon.x;
      mon.homeY = mon.y;
      game.add(mon);
      c.units.push(mon);
    }
    c.alive = true;
    c.spawnCount++;
    c.spawnedAt = game.time;
    c.nextSpawn = Infinity;
    if (def.kind === 'dragon') {
      const nm = dragonType === 'elder' ? '远古巨龙' : DRAGON_INFO[dragonType].name;
      game.announce('dragonSpawn', `${nm}已刷新`, { team: null, subject: c.units[0] });
    } else if (def.kind === 'baron') {
      game.announce('baronSpawn', '纳什男爵已刷新', { team: null, subject: c.units[0] });
    }
    return c.units;
  }

  // 营地离开（不算击杀）
  despawnCamp(c) {
    const game = this.game;
    for (const u of c.units) {
      if (!u.alive || u.removed) continue;
      u.despawned = true;
      u.alive = false;
      game.remove(u);
    }
    c.units = [];
    c.alive = false;
    c.nextSpawn = Infinity;
  }

  // 野怪死亡（由 Monster.die 调用）：营地清空后计时重生并发出目标事件
  onMonsterDeath(monster, credit, killTeam) {
    const game = this.game;
    const c = monster.campState;
    if (!c || !c.alive) return;
    if (c.units.some((u) => u.alive && !u.removed)) return;
    const def = c.def;
    const t = game.time;
    c.alive = false;
    c.clearedAt = t;
    c.lastClearTeam = killTeam;
    if (def.kind === 'dragon') {
      if (monster.dragonType === 'elder') c.nextSpawn = t + ELDER_RESPAWN;
      else {
        this.dragonsKilled++;
        c.nextSpawn = t + (game.teams.some((ts) => ts.dragonSoul) ? ELDER_RESPAWN : (def.respawn ?? TIMINGS.DRAGON_RESPAWN));
      }
    } else if (def.kind === 'herald') {
      const next = t + HERALD_RESPAWN;
      c.nextSpawn = c.spawnCount < 2 && def.despawnAt != null && next <= def.despawnAt - 60 ? next : Infinity;
    } else {
      c.nextSpawn = t + (def.respawn ?? 135);
    }
    game.events.emit('objectiveKilled', {
      kind: objectiveKind(def.kind), team: killTeam, killerChampion: credit || null,
      dragonType: def.kind === 'dragon' ? monster.dragonType : null, camp: def.id,
    });
  }
}
