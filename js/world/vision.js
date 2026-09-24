// 战争迷雾/视野：每队对所有视野源做栅格光线投射（预计算射线父节点表），处理墙体遮挡、草丛规则、暴露、致盲、真视与建筑恒可见
import * as MAPDATA from './mapdata.js';
import { NavGrid } from './navgrid.js';

// 默认视野半径（与 config.RANGES 一致；实体 sightRange > 0 时优先使用实体值）
const DEFAULT_SIGHT = {
  champion: 1350, minion: 1100, turret: 1350, inhibitor: 1200, nexus: 1200, fountainTurret: 1350,
  ward: 900, pet: 800,
};
const STRUCTURE_TYPES = new Set(['turret', 'inhibitor', 'nexus', 'fountainTurret', 'fountain', 'structure']);
const NEARSIGHT_RANGE = 500;
const TRUE_SIGHT_RANGE = 900;
const MAX_RADIUS = 2500;          // 射线表覆盖的最大视野半径（世界单位）
const LISTS = ['champions', 'minions', 'monsters', 'pets', 'wards', 'structures'];

// 射线父节点表：按距离排序的格偏移，每个偏移的父节点是沿射线方向离原点近一格的偏移。
// 逐源投射时按顺序传播「可穿过」标记：父格可见且不透光 → 本格可见。复杂度 O(视野面积)。
function buildRayTable(maxCells) {
  const list = [];
  for (let dy = -maxCells; dy <= maxCells; dy++) {
    for (let dx = -maxCells; dx <= maxCells; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= maxCells + 0.75) list.push([dx, dy, d]);
    }
  }
  list.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  const n = list.length;
  const W = 2 * maxCells + 1;
  const lookup = new Int32Array(W * W).fill(-1);
  for (let k = 0; k < n; k++) lookup[(list[k][1] + maxCells) * W + (list[k][0] + maxCells)] = k;
  const dx = new Int16Array(n), dy = new Int16Array(n), dist = new Float32Array(n), parent = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const [x, y, d] = list[k];
    dx[k] = x; dy[k] = y; dist[k] = d;
    if (k === 0 || d < 1e-6) { parent[k] = -1; continue; }
    const t = Math.max(0, (d - 1) / d);
    const px = Math.round(x * t), py = Math.round(y * t);
    let p = lookup[(py + maxCells) * W + (px + maxCells)];
    if (p < 0 || p >= k) p = 0;
    parent[k] = p;
  }
  return { n, dx, dy, dist, parent };
}
let RAYS = null;

function isStructure(e) { return STRUCTURE_TYPES.has(e?.type) || STRUCTURE_TYPES.has(e?.kind) || e?.isStructure === true; }

export class Vision {
  constructor(game) {
    this.game = game;
    this.cellSize = 100;
    this.cols = 150;
    this.rows = 150;
    const N = this.cols * this.rows;
    // grids[t]：显示用可见栅格（已应用草丛规则），1 = 该队可见；下标 = row * cols + col，row = floor(y / 100)
    this.grids = [new Uint8Array(N), new Uint8Array(N)];
    // los[t]：仅视线（不含草丛规则），实体判定用
    this.los = [new Uint8Array(N), new Uint8Array(N)];
    this.interval = 0.12;            // 更新节流（游戏时间秒）
    this.version = 0;                // 每次重算 +1（迷雾渲染可据此判断是否需要重新上传纹理）
    this._acc = 0;
    this._dirty = true;
    this._revealers = [];
    this.sources = [[], []];          // 最近一次更新的视野源 { x, y, r, brush, entity }
    this._trueSight = [[], []];       // 真视源 { x, y, r }
    this.lastUpdateMs = 0;

    const nav = game?.nav ?? new NavGrid(game?.map ?? MAPDATA);
    this.nav = nav;
    this._buildStatic(nav);
    if (!RAYS) RAYS = buildRayTable(Math.ceil(MAX_RADIUS / this.cellSize));
    this._pass = new Uint8Array(RAYS.n);
  }

  _buildStatic(nav) {
    const N = this.cols * this.rows, cs = this.cellSize;
    this.opaque = new Uint8Array(N);
    this.brushCells = new Int16Array(N).fill(-1);
    const nc = nav.cellSize ?? 50;
    const k = Math.max(1, Math.round(cs / nc));
    const brushCount = Math.max(1, (this.game?.map?.BRUSHES ?? MAPDATA.BRUSHES).length);
    this.brushSeen = [new Uint8Array(brushCount + 1), new Uint8Array(brushCount + 1)];
    const votes = new Map();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        let wall = 0;
        votes.clear();
        for (let j = 0; j < k; j++) {
          for (let i = 0; i < k; i++) {
            const x = c * cs + (i + 0.5) * nc, y = r * cs + (j + 0.5) * nc;
            if (nav.blocksSight(x, y)) wall++;
            const b = nav.brushAt(x, y);
            if (b >= 0) votes.set(b, (votes.get(b) ?? 0) + 1);
          }
        }
        const idx = r * this.cols + c;
        // 大部分为墙才视为不透光（避免墙边格子过度遮挡）
        this.opaque[idx] = wall * 4 >= k * k * 3 ? 1 : 0;
        let best = -1, bv = 0;
        for (const [b, v] of votes) if (v > bv) { bv = v; best = b; }
        if (best >= 0 && bv * 2 >= k * k) this.brushCells[idx] = best;
      }
    }
  }

  cellIndex(x, y) {
    let c = Math.floor(x / this.cellSize), r = Math.floor(y / this.cellSize);
    c = c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
    r = r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
    return r * this.cols + c;
  }

  /**
   * 临时视野源（例如迅捷蟹视野、鹰击长空等）：
   * { team, x, y, radius = 500, duration = 1, follow = null（跟随实体）, trueSight = false, seeBrush = false } → 句柄 { remove() }
   */
  addRevealer({ team, x, y, radius = 500, duration = 1, follow = null, trueSight = false, seeBrush = false } = {}) {
    const now = this.game?.time ?? 0;
    const rv = { team, x: x ?? follow?.x ?? 0, y: y ?? follow?.y ?? 0, radius, until: now + duration, follow, trueSight, seeBrush, dead: false };
    rv.remove = () => { rv.dead = true; this._dirty = true; };
    this._revealers.push(rv);
    this._dirty = true;
    return rv;
  }

  /** 标记需要在下一次 update 时立即重算 */
  invalidate() { this._dirty = true; }

  update(dt = 0) {
    this._acc += dt || 0;
    if (!this._dirty && this._acc < this.interval) return;
    this._acc = 0;
    this._dirty = false;
    this.recompute();
  }

  /** 立即重算两队视野并写入所有实体的 visible[0/1] */
  recompute() {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const g = this.game ?? {};
    const now = g.time ?? 0;
    const nav = g.nav ?? this.nav;
    const S = this.sources, TS = this._trueSight;
    S[0].length = 0; S[1].length = 0; TS[0].length = 0; TS[1].length = 0;

    // —— 收集视野源 ——
    for (const name of LISTS) {
      if (name === 'monsters') continue; // 中立野怪不提供视野
      const list = g[name];
      if (!list) continue;
      for (const e of list) {
        if (!e || e.removed || !e.alive) continue;
        const team = e.team;
        if (team !== 0 && team !== 1) continue;
        let r = e.sightRange > 0 ? e.sightRange : (DEFAULT_SIGHT[e.type] ?? DEFAULT_SIGHT[e.kind] ?? 0);
        if (r <= 0) continue;
        if (typeof e.hasCC === 'function' && e.hasCC('nearsight')) r = Math.min(r, NEARSIGHT_RANGE);
        S[team].push({ x: e.x, y: e.y, r: Math.min(r, MAX_RADIUS), brush: nav.brushAt(e.x, e.y), seeBrush: false, entity: e });
        if (e.type === 'ward' && (e.kind === 'control' || e.trueSight)) TS[team].push({ x: e.x, y: e.y, r: e.trueSightRange ?? TRUE_SIGHT_RANGE });
        else if (e.trueSight && e.type !== 'ward') TS[team].push({ x: e.x, y: e.y, r: e.trueSightRange ?? TRUE_SIGHT_RANGE });
      }
    }
    // 临时视野源
    let w = 0;
    for (const rv of this._revealers) {
      if (rv.dead || now > rv.until || (rv.follow && (rv.follow.removed || rv.follow.alive === false))) continue;
      this._revealers[w++] = rv;
      if (rv.team !== 0 && rv.team !== 1) continue;
      const x = rv.follow ? rv.follow.x : rv.x, y = rv.follow ? rv.follow.y : rv.y;
      S[rv.team].push({ x, y, r: Math.min(rv.radius, MAX_RADIUS), brush: nav.brushAt(x, y), seeBrush: rv.seeBrush, entity: null });
      if (rv.trueSight) TS[rv.team].push({ x, y, r: rv.radius });
    }
    this._revealers.length = w;

    // —— 光线投射 ——
    for (let team = 0; team < 2; team++) {
      const grid = this.grids[team], los = this.los[team], seen = this.brushSeen[team];
      grid.fill(0); los.fill(0); seen.fill(0);
      for (const s of S[team]) {
        if (s.brush >= 0 && s.brush < seen.length) seen[s.brush] = 1;
        this._cast(s, grid, los);
      }
    }

    // —— 写入实体可见性 ——
    this._now = now;
    for (const name of LISTS) {
      const list = g[name];
      if (!list) continue;
      for (const e of list) {
        if (!e) continue;
        if (!e.visible) e.visible = [false, false];
        e.visible[0] = this._canSee(0, e, nav);
        e.visible[1] = this._canSee(1, e, nav);
      }
    }
    this.version++;
    if (t0) this.lastUpdateMs = performance.now() - t0;
  }

  // 单个视野源的投射：按射线父节点表顺序传播
  _cast(src, grid, los) {
    const T = RAYS, cs = this.cellSize, C = this.cols, Rw = this.rows;
    const opaque = this.opaque, brushCells = this.brushCells, pass = this._pass;
    const cx = Math.floor(src.x / cs), cy = Math.floor(src.y / cs);
    const r = src.r, r2 = r * r;
    const lim = r / cs + 0.75;
    const sb = src.seeBrush ? -2 : src.brush;
    const n = T.n, dxs = T.dx, dys = T.dy, dist = T.dist, par = T.parent;
    for (let k = 0; k < n; k++) {
      if (dist[k] > lim) break;
      const c = cx + dxs[k], rr = cy + dys[k];
      if (c < 0 || rr < 0 || c >= C || rr >= Rw) { pass[k] = 0; continue; }
      if (k > 0) {
        const p = par[k];
        if (!pass[p]) { pass[k] = 0; continue; }
      }
      const i = rr * C + c;
      const ex = (c + 0.5) * cs - src.x, ey = (rr + 0.5) * cs - src.y;
      if (k === 0 || ex * ex + ey * ey <= r2) {
        los[i] = 1;
        const b = brushCells[i];
        if (b < 0 || b === sb || sb === -2) grid[i] = 1;
      }
      // 源所在格总是透光；墙格本身可见但阻挡后续
      pass[k] = k === 0 ? 1 : opaque[i] ? 0 : 1;
    }
  }

  /** 该点对某队是否可见（显示栅格，已含草丛规则） */
  isVisible(team, x, y) {
    if (team !== 0 && team !== 1) return true;
    return this.grids[team][this.cellIndex(x, y)] === 1;
  }

  /** 该队是否能看见实体（规则与 update 写入 visible 时一致） */
  canSee(team, entity) {
    if (!entity) return false;
    if (team !== 0 && team !== 1) return true;
    if (this._dirty && this.version === 0) this.recompute();
    this._now = this.game?.time ?? this._now ?? 0;
    return this._canSee(team, entity, this.game?.nav ?? this.nav);
  }

  _canSee(team, e, nav) {
    if (e.team === team) return true;
    if (isStructure(e)) return true;
    const stealthed = e.stealthed === true || (e.type === 'ward' && (e.kind ?? 'stealth') !== 'control');
    if (stealthed) return this._hasTrueSight(team, e.x, e.y);
    if ((e.revealedUntil ?? 0) > (this._now ?? 0) && this._inAnyRadius(team, e.x, e.y)) return true;
    if (!this.los[team][this.cellIndex(e.x, e.y)]) return false;
    const b = nav.brushAt(e.x, e.y);
    if (b >= 0 && !this.brushSeen[team][b]) return false;
    return true;
  }

  _hasTrueSight(team, x, y) {
    for (const s of this._trueSight[team]) if ((s.x - x) ** 2 + (s.y - y) ** 2 <= s.r * s.r) return true;
    return false;
  }

  _inAnyRadius(team, x, y) {
    for (const s of this.sources[team]) if ((s.x - x) ** 2 + (s.y - y) ** 2 <= s.r * s.r) return true;
    return false;
  }

  /** 某队是否有视野源位于指定草丛内（草丛内的单位因此可被看见） */
  teamSeesBrush(team, brushId) { return brushId >= 0 && this.brushSeen[team]?.[brushId] === 1; }
}
