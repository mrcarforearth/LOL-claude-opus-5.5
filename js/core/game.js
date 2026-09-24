// 游戏主体：固定步长模拟、实体管理、空间查询、伤害/治疗入口、击杀结算、播报
import * as mapdata from '../world/mapdata.js';
import { NavGrid } from '../world/navgrid.js';
import { Vision } from '../world/vision.js';
import { Spawner } from '../entities/spawner.js';
import { EventBus } from './events.js';
import { NullFX } from './nullfx.js';
import { mulberry32, pointSegDist2, pointSegT } from './math.js';
import { applyDamage, applyHeal, creditChampion } from './damage.js';
import { Projectile } from './projectile.js';
import { Zone } from './zone.js';
import { Pet } from './pet.js';
import { placeWard } from './ward.js';
import { Champion } from './champion.js';
import { championKillRewards, minionKillRewards, monsterKillRewards, wardKillRewards, resolveKillerChampion } from './rewards.js';
import { TICK, RANGES, GOLD, TIMINGS, MAP_SIZE } from '../config.js';

const DEFAULT_TYPES = ['champion', 'minion', 'monster', 'pet'];
const GRID_CELL = 500;
const GRID_COLS = Math.ceil(MAP_SIZE / GRID_CELL) + 1;
const SOFT_CELL = 250;

function makeTeamState() {
  return { kills: 0, turretsDestroyed: 0, inhibsDestroyed: 0, dragons: [], baronKills: 0, heraldKills: 0 };
}

export class Game {
  constructor(opts = {}) {
    const {
      blue = [], red = [], champions = {}, createAI = null,
      difficulty = 'normal', speed = 1, seed = 1, headless = false, fx = null, autopilot = false,
    } = opts;
    this.opts = opts;
    this.time = 0;
    this.speed = speed;
    this.paused = false;
    this.over = false;
    this.winner = null;
    this.stepCount = 0;
    this.alpha = 0;
    this.seed = seed;
    this._rng = mulberry32(seed);
    this.events = new EventBus();
    this.headless = headless;
    this.difficulty = difficulty;
    this.autopilot = autopilot;
    this.fx = fx || new NullFX();
    this.championDefs = champions;
    this.createAI = createAI;

    this.champions = [];
    this.minions = [];
    this.structures = [];
    this.monsters = [];
    this.pets = [];
    this.wards = [];
    this.projectiles = [];
    this.zones = [];
    this.entities = new Map();
    this.player = null;
    this.teams = [makeTeamState(), makeTeamState()];
    this.firstBloodDone = false;
    this.firstTurretDone = false;
    this._aceActive = [false, false];

    this._acc = 0;
    this._pendingRemove = [];
    this._timers = [];
    this._unitsCache = null;
    this._grid = null;
    this._gridDirty = true;
    this._gridMaxRadius = 100;
    this._passiveGoldTimer = 0;
    this._fountainCache = [null, null];

    this.map = mapdata;
    this.nav = new NavGrid(mapdata);
    this.vision = new Vision(this);
    this.spawner = new Spawner(this);
    this.spawner.init();

    // 生成英雄
    const fountains = mapdata.FOUNTAINS || [];
    const sides = [[0, blue], [1, red]];
    for (const [team, list] of sides) {
      list.forEach((cfg, i) => {
        const def = champions[cfg.championId];
        if (!def) throw new Error(`未知英雄：${cfg.championId}`);
        const f = fountains[team] || this.fountainOf(team);
        const sps = f.spawns && f.spawns.length ? f.spawns : [{ x: f.x, y: f.y }];
        const sp = sps[i % sps.length];
        const champ = new Champion(this, def, {
          team, role: cfg.role || 'mid', isPlayer: !!cfg.isPlayer, summoners: cfg.summoners || ['flash', 'ignite'],
          name: cfg.name, slot: i, x: sp.x, y: sp.y,
        });
        champ.setPosition(sp.x, sp.y);
        champ.facing = team === 0 ? Math.PI / 4 : -3 * Math.PI / 4;
        this.add(champ);
        if (champ.isPlayer && !this.player) this.player = champ;
      });
    }
    // 挂载 AI
    if (createAI) {
      for (const c of this.champions) {
        if (!c.isPlayer || autopilot) c.controller = createAI(c, this, { role: c.role, difficulty });
      }
    }
    this.events.emit('gameStart', {});
  }

  rng() { return this._rng(); }

  // —— 时间推进 ——
  update(realDt) {
    if (this.paused || this.over) return;
    this._acc += Math.min(0.25, Math.max(0, realDt) * this.speed);
    let n = 0;
    while (this._acc >= TICK && !this.over && n < 16) {
      this.step(TICK);
      this._acc -= TICK;
      n++;
    }
    if (n >= 16) this._acc = 0;
    this.alpha = this._acc / TICK;
  }

  step(dt = TICK) {
    if (this.over) return;
    this.time += dt;
    this.stepCount++;
    this._unitsCache = null;
    this._gridDirty = true;

    this.spawner.update(dt);
    const champs = this.champions;
    for (let i = 0; i < champs.length; i++) if (champs[i].controller) champs[i].controller.update(dt);
    for (let i = 0; i < champs.length; i++) champs[i].update(dt);
    for (const list of [this.pets, this.minions, this.monsters, this.structures, this.wards]) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.removed) e.update(dt);
      }
    }
    this._softCollision();
    const projs = this.projectiles;
    for (let i = 0; i < projs.length; i++) if (!projs[i].dead) projs[i].update(dt);
    const zones = this.zones;
    for (let i = 0; i < zones.length; i++) if (!zones[i].dead) zones[i].update(dt);
    this._runTimers();
    this.vision.update(dt);
    this._passiveGold(dt);
    this._cleanup();
  }

  _passiveGold(dt) {
    if (this.time < TIMINGS.PASSIVE_GOLD_START) return;
    for (const c of this.champions) c._passiveGoldAcc = (c._passiveGoldAcc || 0) + GOLD.PASSIVE_PER_SEC * dt;
    this._passiveGoldTimer += dt;
    if (this._passiveGoldTimer >= 1) {
      this._passiveGoldTimer -= 1;
      for (const c of this.champions) {
        const g = c._passiveGoldAcc;
        c._passiveGoldAcc = 0;
        if (g > 0) c.gainGold(g, 'passive');
      }
    }
  }

  // 延迟回调（模拟时间）；返回 { cancel() }
  after(seconds, fn) {
    const t = { at: this.time + Math.max(0, seconds), fn, cancelled: false, cancel() { this.cancelled = true; } };
    this._timers.push(t);
    return t;
  }
  _runTimers() {
    if (this._timers.length === 0) return;
    const now = this.time;
    const due = [];
    const keep = [];
    for (const t of this._timers) {
      if (t.cancelled) continue;
      if (now >= t.at - 1e-9) due.push(t); else keep.push(t);
    }
    this._timers = keep;
    due.sort((a, b) => a.at - b.at);
    for (const t of due) if (!t.cancelled) t.fn(this);
  }

  // —— 实体管理 ——
  add(entity) {
    switch (entity.type) {
      case 'champion': this.champions.push(entity); break;
      case 'minion': this.minions.push(entity); break;
      case 'turret': case 'inhibitor': case 'nexus': this.structures.push(entity); break;
      case 'monster': this.monsters.push(entity); break;
      case 'pet': this.pets.push(entity); break;
      case 'ward': this.wards.push(entity); break;
      default: break;
    }
    this.entities.set(entity.id, entity);
    this._unitsCache = null;
    this._gridDirty = true;
    this.events.emit('spawn', { entity });
    return entity;
  }

  remove(entity) {
    if (!entity || entity.removed) return;
    entity.removed = true;
    this._pendingRemove.push(entity);
  }

  _cleanup() {
    if (this._pendingRemove.length) {
      const set = new Set(this._pendingRemove);
      this._pendingRemove = [];
      const f = (e) => !set.has(e);
      this.minions = this.minions.filter(f);
      this.monsters = this.monsters.filter(f);
      this.pets = this.pets.filter(f);
      this.wards = this.wards.filter(f);
      this.champions = this.champions.filter(f);
      this.structures = this.structures.filter(f);
      for (const e of set) {
        this.entities.delete(e.id);
        this.events.emit('remove', { entity: e });
      }
      this._unitsCache = null;
      this._gridDirty = true;
    }
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
    if (this.zones.some((z) => z.dead)) this.zones = this.zones.filter((z) => !z.dead);
  }

  markMoved() { this._gridDirty = true; }

  get allUnits() {
    if (this._unitsCache) return this._unitsCache;
    const out = [];
    for (const list of [this.champions, this.minions, this.structures, this.monsters, this.pets]) {
      for (let i = 0; i < list.length; i++) { const u = list[i]; if (u.alive && !u.removed) out.push(u); }
    }
    this._unitsCache = out;
    return out;
  }

  // —— 空间网格 ——
  _buildGrid() {
    const n = GRID_COLS * GRID_COLS;
    if (!this._grid) { this._grid = new Array(n); for (let i = 0; i < n; i++) this._grid[i] = []; }
    const g = this._grid;
    for (let i = 0; i < n; i++) if (g[i].length) g[i].length = 0;
    let maxR = 50;
    const units = this.allUnits;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const cx = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(u.x / GRID_CELL)));
      const cy = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(u.y / GRID_CELL)));
      g[cy * GRID_COLS + cx].push(u);
      if (u.radius > maxR) maxR = u.radius;
    }
    this._gridMaxRadius = maxR;
    this._gridDirty = false;
  }

  // 收集包围盒内候选单位
  _candidates(minX, minY, maxX, maxY, out) {
    if (this._gridDirty || !this._grid) this._buildGrid();
    const m = this._gridMaxRadius + 150;
    const c0 = Math.max(0, Math.floor((minX - m) / GRID_CELL)), c1 = Math.min(GRID_COLS - 1, Math.floor((maxX + m) / GRID_CELL));
    const r0 = Math.max(0, Math.floor((minY - m) / GRID_CELL)), r1 = Math.min(GRID_COLS - 1, Math.floor((maxY + m) / GRID_CELL));
    const g = this._grid;
    for (let r = r0; r <= r1; r++) {
      const row = r * GRID_COLS;
      for (let c = c0; c <= c1; c++) {
        const cell = g[row + c];
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }

  // 通用过滤器
  _makeFilter(o) {
    const types = o.types === 'all' ? null : (o.types || DEFAULT_TYPES);
    const enemyTeam = o.enemyOf != null ? (typeof o.enemyOf === 'number' ? o.enemyOf : o.enemyOf.team) : null;
    const allyTeam = o.allyOf != null ? (typeof o.allyOf === 'number' ? o.allyOf : o.allyOf.team) : null;
    const team = o.team;
    const tb = o.targetableBy || null;
    const includeDead = !!o.includeDead;
    const ex = o.exclude;
    const exIsSet = ex instanceof Set;
    const filter = o.filter || null;
    return (u) => {
      if (u.removed) return false;
      if (!includeDead && !u.alive) return false;
      if (types && !types.includes(u.type)) return false;
      if (enemyTeam != null && u.team === enemyTeam) return false;
      if (allyTeam != null && u.team !== allyTeam) return false;
      if (team != null && u.team !== team) return false;
      if (ex && (exIsSet ? ex.has(u) : ex === u)) return false;
      if (tb && !u.isTargetableBy(tb)) return false;
      if (filter && !filter(u)) return false;
      return true;
    };
  }

  _wantsWards(o) { return o.types === 'all' || (o.types && o.types.includes('ward')); }

  _pool(o, bbox) {
    let pool;
    if (o.includeDead || !bbox) {
      pool = [];
      for (const list of [this.champions, this.minions, this.structures, this.monsters, this.pets]) for (const u of list) pool.push(u);
    } else {
      pool = this._candidates(bbox[0], bbox[1], bbox[2], bbox[3], []);
    }
    if (this._wantsWards(o)) for (const w of this.wards) pool.push(w);
    return pool;
  }

  queryUnits(o = {}) {
    const hasR = o.radius != null && o.x != null;
    const x = o.x ?? 0, y = o.y ?? 0, r = o.radius ?? 0;
    const pool = this._pool(o, hasR ? [x - r, y - r, x + r, y + r] : null);
    const pass = this._makeFilter(o);
    const out = [];
    for (let i = 0; i < pool.length; i++) {
      const u = pool[i];
      if (hasR) {
        const rr = r + (u.radius || 0);
        const dx = u.x - x, dy = u.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > rr * rr) continue;
        if (!pass(u)) continue;
        u._qd = d2;
      } else {
        if (!pass(u)) continue;
        if (o.x != null) { const dx = u.x - x, dy = u.y - y; u._qd = dx * dx + dy * dy; } else u._qd = 0;
      }
      out.push(u);
    }
    if (o.sort !== false && out.length > 1) out.sort((a, b) => a._qd - b._qd);
    return out;
  }

  queryLine(o = {}) {
    const { x1, y1, x2, y2 } = o;
    const w = o.width ?? 60;
    const pool = this._pool(o, [Math.min(x1, x2) - w, Math.min(y1, y2) - w, Math.max(x1, x2) + w, Math.max(y1, y2) + w]);
    const pass = this._makeFilter(o);
    const out = [];
    for (let i = 0; i < pool.length; i++) {
      const u = pool[i];
      const rr = w + (u.radius || 0);
      if (pointSegDist2(u.x, u.y, x1, y1, x2, y2) > rr * rr) continue;
      if (!pass(u)) continue;
      u._qd = pointSegT(u.x, u.y, x1, y1, x2, y2);
      out.push(u);
    }
    if (o.sort !== false && out.length > 1) out.sort((a, b) => a._qd - b._qd);
    return out;
  }

  queryCone(o = {}) {
    const { x, y } = o;
    const range = o.range ?? 500;
    const half = ((o.angle ?? 60) * Math.PI) / 360;
    const dl = Math.hypot(o.dirX ?? 1, o.dirY ?? 0) || 1;
    const dx0 = (o.dirX ?? 1) / dl, dy0 = (o.dirY ?? 0) / dl;
    const list = this.queryUnits({ ...o, radius: range, sort: false });
    const out = [];
    for (const u of list) {
      const vx = u.x - x, vy = u.y - y;
      const d = Math.hypot(vx, vy);
      if (d <= (u.radius || 0) + 1) { out.push(u); continue; }
      const cos = (vx * dx0 + vy * dy0) / d;
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
      const tol = Math.asin(Math.min(1, (u.radius || 0) / d));
      if (ang <= half + tol) out.push(u);
    }
    if (o.sort !== false && out.length > 1) out.sort((a, b) => a._qd - b._qd);
    return out;
  }

  nearest(o = {}) {
    const list = this.queryUnits({ ...o, sort: false });
    if (list.length === 0) return null;
    if (o.x == null) return list[0];
    let best = list[0];
    for (let i = 1; i < list.length; i++) if (list[i]._qd < best._qd) best = list[i];
    return best;
  }

  // —— 软碰撞分离：小兵/野怪/宠物互相推开；被英雄推开；所有单位不能进入建筑 ——
  _softCollision() {
    const units = this.allUnits;
    const nav = this.nav;
    const buckets = this._softBuckets || (this._softBuckets = new Map());
    buckets.clear();
    const soft = [];
    const champs = [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive || u.dashState || u.isStructure) continue;
      if (u.softCollision) {
        if (u.ghosted) continue;
        soft.push(u);
        const key = Math.floor(u.x / SOFT_CELL) * 1000 + Math.floor(u.y / SOFT_CELL);
        let b = buckets.get(key);
        if (!b) { b = []; buckets.set(key, b); }
        b.push(u);
      } else if (u.type === 'champion') champs.push(u);
    }
    const push = (u, px, py) => {
      const nx = u.x + px, ny = u.y + py;
      if (nav.isWalkable(nx, ny)) { u.x = nx; u.y = ny; }
      else if (nav.isWalkable(nx, u.y)) u.x = nx;
      else if (nav.isWalkable(u.x, ny)) u.y = ny;
    };
    // 软单位之间
    for (let i = 0; i < soft.length; i++) {
      const a = soft[i];
      a._softIdx = i;
    }
    for (let i = 0; i < soft.length; i++) {
      const a = soft[i];
      const cx = Math.floor(a.x / SOFT_CELL), cy = Math.floor(a.y / SOFT_CELL);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const b = buckets.get((cx + ox) * 1000 + (cy + oy));
          if (!b) continue;
          for (let j = 0; j < b.length; j++) {
            const o = b[j];
            if (o._softIdx <= i) continue;
            const minD = (a.radius + o.radius) * 0.85;
            let dx = o.x - a.x, dy = o.y - a.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= minD * minD) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-3) { const ang = ((a.id * 7919 + o.id * 104729) % 628) / 100; dx = Math.cos(ang); dy = Math.sin(ang); d = 1; }
            else { dx /= d; dy /= d; }
            const overlap = (minD - d) * 0.25;
            push(a, -dx * overlap, -dy * overlap);
            push(o, dx * overlap, dy * overlap);
          }
        }
      }
    }
    // 英雄推开软单位（单向）
    for (const c of champs) {
      if (c.ghosted) continue;
      const cx = Math.floor(c.x / SOFT_CELL), cy = Math.floor(c.y / SOFT_CELL);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const b = buckets.get((cx + ox) * 1000 + (cy + oy));
          if (!b) continue;
          for (const o of b) {
            const minD = (c.radius + o.radius) * 0.7;
            const dx = o.x - c.x, dy = o.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= minD * minD || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const k = (minD - d) * 0.3 / d;
            push(o, dx * k, dy * k);
          }
        }
      }
    }
    // 建筑是硬障碍
    for (const s of this.structures) {
      if (!s.alive || !s.blocksUnits) continue;
      const near = this._candidates(s.x - s.radius, s.y - s.radius, s.x + s.radius, s.y + s.radius, []);
      for (const u of near) {
        if (u === s || u.isStructure || !u.alive || u.dashState) continue;
        const minD = s.radius + u.radius * 0.5;
        const dx = u.x - s.x, dy = u.y - s.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2) || 1;
        const k = (minD - d) / d;
        push(u, (dx || 1) * k, dy * k);
      }
    }
  }

  // —— 伤害 / 治疗 ——
  dealDamage(source, target, amount, type = 'physical', opts = {}) {
    return applyDamage(this, source, target, amount, type, opts);
  }
  heal(source, target, amount, opts = {}) {
    return applyHeal(this, source, target, amount, opts);
  }

  // —— 生成 ——
  spawnProjectile(opts) {
    const p = new Projectile(this, opts);
    this.projectiles.push(p);
    this.fx.projectile(p);
    return p;
  }
  spawnZone(opts) {
    const z = new Zone(this, opts);
    this.zones.push(z);
    if (z.vfx) this.fx.zone(z);
    return z;
  }
  spawnPet(opts) {
    const owner = opts.owner;
    let x = opts.x ?? owner.x, y = opts.y ?? owner.y;
    if (!this.nav.isWalkable(x, y)) { const p = this.nav.nearestWalkable(x, y); x = p.x; y = p.y; }
    const pet = new Pet(this, { ...opts, x, y });
    this.add(pet);
    return pet;
  }
  placeWard(owner, x, y, kind = 'stealth', opts = {}) {
    return placeWard(this, owner, x, y, kind, opts);
  }

  // —— 死亡结算 ——
  onUnitDeath(unit, killer) {
    const killerChampion = unit.type === 'champion' ? resolveKillerChampion(this, unit, killer) : creditChampion(killer);
    this.events.emit('death', { unit, killer, killerChampion });
    switch (unit.type) {
      case 'champion': championKillRewards(this, unit, killer); break;
      case 'minion': minionKillRewards(this, unit, killer); break;
      case 'monster': if (!unit.customRewards) monsterKillRewards(this, unit, killer); break;
      case 'ward': wardKillRewards(this, unit, killer); break;
      default: break; // 建筑/宠物奖励由各自模块处理
    }
    if (killerChampion && killerChampion !== unit && unit.type !== 'ward' && killerChampion.team !== unit.team) {
      killerChampion.runHooks('onKill', unit);
    }
  }

  announce(key, text, extra = {}) {
    this.events.emit('announce', {
      key, text, team: extra.team ?? null, killer: extra.killer ?? null, victim: extra.victim ?? null, subject: extra.subject ?? null,
    });
  }

  fountainOf(team) {
    let f = this._fountainCache[team];
    if (f) return f;
    const src = this.map.FOUNTAINS?.[team];
    f = src ? { x: src.x, y: src.y, radius: src.radius ?? RANGES.FOUNTAIN }
      : (team === 0 ? { x: 420, y: 420, radius: RANGES.FOUNTAIN } : { x: 14380, y: 14420, radius: RANGES.FOUNTAIN });
    this._fountainCache[team] = f;
    return f;
  }

  isVisible(team, entity) {
    if (team !== 0 && team !== 1) return true;
    if (!entity) return false;
    if (entity.team === team) return true;
    return this.vision.canSee(team, entity);
  }

  getChampion(championId) { return this.champions.find((c) => c.championId === championId) || null; }
  enemyTeam(team) { return 1 - team; }

  end(winner) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.announce('victory', `${winner === 0 ? '蓝色方' : '红色方'}获得胜利！`, { team: winner });
    this.events.emit('gameOver', { winner });
  }
}
