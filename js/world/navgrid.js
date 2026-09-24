// 导航网格：由 mapdata.WALK 雕刻可走区域；8 邻接 A* + 视线平滑寻路、线段可走检测、最近可走点、SDF、草丛栅格
import * as MAPDATA from './mapdata.js';

const SQRT2 = Math.SQRT2;
const OCT = SQRT2 - 2;

// 螺旋搜索偏移表（按距离升序，单位：格），最近可走点查询共用
let SPIRAL = null;
function spiralTable(maxR) {
  if (SPIRAL && SPIRAL.maxR >= maxR) return SPIRAL;
  const list = [];
  for (let dy = -maxR; dy <= maxR; dy++) {
    for (let dx = -maxR; dx <= maxR; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= maxR + 0.01) list.push([dx, dy, d]);
    }
  }
  list.sort((a, b) => a[2] - b[2]);
  const n = list.length;
  const t = { maxR, n, dx: new Int16Array(n), dy: new Int16Array(n), d: new Float32Array(n) };
  for (let i = 0; i < n; i++) { t.dx[i] = list[i][0]; t.dy[i] = list[i][1]; t.d[i] = list[i][2]; }
  SPIRAL = t;
  return t;
}

/** 两遍向量距离变换（8SSEDT）：返回每格到最近种子格的欧氏距离（格） */
function distanceTransform(cols, rows, isSeed) {
  const N = cols * rows;
  const sx = new Int16Array(N), sy = new Int16Array(N);
  const d2 = new Float64Array(N);
  const INF = 1e12;
  for (let i = 0; i < N; i++) {
    if (isSeed[i]) { sx[i] = i % cols; sy[i] = (i / cols) | 0; d2[i] = 0; } else { sx[i] = -1; d2[i] = INF; }
  }
  const relax = (i, j, c, r) => {
    if (sx[j] < 0) return;
    const ex = c - sx[j], ey = r - sy[j];
    const dd = ex * ex + ey * ey;
    if (dd < d2[i]) { d2[i] = dd; sx[i] = sx[j]; sy[i] = sy[j]; }
  };
  // 第一遍：自下而上（行递增），每行先左→右再右→左
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c > 0) relax(i, i - 1, c, r);
      if (r > 0) {
        relax(i, i - cols, c, r);
        if (c > 0) relax(i, i - cols - 1, c, r);
        if (c < cols - 1) relax(i, i - cols + 1, c, r);
      }
    }
    for (let c = cols - 2; c >= 0; c--) { const i = r * cols + c; relax(i, i + 1, c, r); }
  }
  // 第二遍：自上而下，每行先右→左再左→右
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (c < cols - 1) relax(i, i + 1, c, r);
      if (r < rows - 1) {
        relax(i, i + cols, c, r);
        if (c > 0) relax(i, i + cols - 1, c, r);
        if (c < cols - 1) relax(i, i + cols + 1, c, r);
      }
    }
    for (let c = 1; c < cols; c++) { const i = r * cols + c; relax(i, i - 1, c, r); }
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = d2[i] >= INF ? 1e6 : Math.sqrt(d2[i]);
  return out;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class NavGrid {
  constructor(mapdata = MAPDATA) {
    const md = mapdata ?? MAPDATA;
    this.map = md;
    this.size = md.MAP?.size ?? 15000;
    this.cellSize = 50;
    this.cols = Math.ceil(this.size / this.cellSize);
    this.rows = this.cols;
    const N = this.cols * this.rows;
    this.terrain = new Uint8Array(N);          // 地形可走（不含建筑占地）；视线/地形 SDF 用它
    this.walk = new Uint8Array(N);             // 最终可走 = 地形可走 - 建筑占地
    this.brush = new Int16Array(N).fill(-1);
    this.sdf = new Float32Array(N);            // 地形有符号距离（墙内为正，可走区为负，世界单位）
    this.clearance = new Float32Array(N);      // 可走格到最近不可走格的距离（世界单位）
    this.comp = new Int32Array(N);             // 连通分量编号（0 = 墙）
    this.cost = new Float32Array(N);           // A* 进入该格的代价倍率（贴墙更贵，路径居中）
    this.nearWall = new Uint8Array(N);         // 紧贴墙体/建筑的可走格
    const C = this.cols;
    this._nOff = new Int32Array([1, -1, C, -C, C + 1, C - 1, -C + 1, -C - 1]);
    this._nCost = new Float32Array([1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2]);
    // 对角移动需检查的两个正交邻居偏移
    this._dA = new Int32Array([0, 0, 0, 0, 1, -1, 1, -1]);
    this._dB = new Int32Array([0, 0, 0, 0, C, C, -C, -C]);

    this._carve(md);
    this._border(this.terrain);
    this._removeIslands(md);
    this.walk.set(this.terrain);
    this._footprints(md);
    this._border(this.walk);
    this._computeSdf();
    this._computeClearance();
    this._computeComponents();
    this._rasterBrushes(md);

    // A* 缓冲区（复用，避免 GC）
    this._g = new Float32Array(N);
    this._par = new Int32Array(N);
    this._seen = new Uint32Array(N);
    this._closed = new Uint32Array(N);
    this._gen = 0;
    this._heapCap = 1 << 16;
    this._hN = new Int32Array(this._heapCap);
    this._hF = new Float32Array(this._heapCap);
    this.lastStats = { iterations: 0, found: false };
    // 启发式权重：略大于 1 可显著减少扩展节点，路径最多长约 (w-1) 倍
    this.heuristicWeight = 1.05;
  }

  // ——————————————————— 雕刻 ———————————————————
  _forCells(x0, y0, x1, y1, fn) {
    const cs = this.cellSize;
    const c0 = Math.max(0, Math.floor(x0 / cs)), c1 = Math.min(this.cols - 1, Math.floor(x1 / cs));
    const r0 = Math.max(0, Math.floor(y0 / cs)), r1 = Math.min(this.rows - 1, Math.floor(y1 / cs));
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * cs;
      for (let c = c0; c <= c1; c++) fn(r * this.cols + c, (c + 0.5) * cs, y);
    }
  }
  _circle(grid, x, y, rad, v) {
    const r2 = rad * rad;
    this._forCells(x - rad, y - rad, x + rad, y + rad, (i, cx, cy) => {
      if ((cx - x) ** 2 + (cy - y) ** 2 <= r2) grid[i] = v;
    });
  }
  // 线段胶囊（两端半径可不同，用于河道渐变宽度）
  _capsule(grid, ax, ay, ra, bx, by, rb, v) {
    const m = Math.max(ra, rb);
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    this._forCells(Math.min(ax, bx) - m, Math.min(ay, by) - m, Math.max(ax, bx) + m, Math.max(ay, by) + m, (i, cx, cy) => {
      let t = ((cx - ax) * dx + (cy - ay) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const rr = ra + (rb - ra) * t;
      const ex = ax + dx * t - cx, ey = ay + dy * t - cy;
      if (ex * ex + ey * ey <= rr * rr) grid[i] = v;
    });
  }
  _poly(grid, poly, v) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    this._forCells(x0, y0, x1, y1, (i, cx, cy) => { if (pointInPoly(cx, cy, poly)) grid[i] = v; });
  }
  _carve(md) {
    const g = this.terrain;
    const W = md.WALK ?? {};
    for (const a of W.areas ?? []) this._poly(g, a.poly, 1);
    for (const c of W.clearings ?? []) this._circle(g, c.x, c.y, c.r, 1);
    for (const c of W.corridors ?? []) {
      const h = (c.w ?? 500) / 2;
      for (let i = 0; i < c.pts.length - 1; i++) {
        const [ax, ay] = c.pts[i], [bx, by] = c.pts[i + 1];
        this._capsule(g, ax, ay, h, bx, by, h, 1);
      }
    }
    const rv = md.RIVER;
    if (rv?.path?.length > 1) {
      for (let i = 0; i < rv.path.length - 1; i++) {
        const ha = rv.halfWidths?.[i] ?? rv.width ?? 500, hb = rv.halfWidths?.[i + 1] ?? rv.width ?? 500;
        this._capsule(g, rv.path[i][0], rv.path[i][1], ha, rv.path[i + 1][0], rv.path[i + 1][1], hb, 1);
      }
    }
    for (const p of Object.values(md.PITS ?? {})) this._circle(g, p.x, p.y, p.r, 1);
    for (const b of W.blockers ?? []) this._poly(g, b.poly, 0);
    if (W.edgeNoise?.amp > 0) this._applyEdgeNoise(W.edgeNoise, md.CENTER);
    for (const k of W.keepWalkable ?? []) this._circle(g, k.x, k.y, k.r, 1);
  }
  // 墙体边缘扰动：按有符号距离 + 平滑值噪声重新阈值化，让墙体轮廓更自然（噪声关于地图中心对称）
  _applyEdgeNoise({ amp = 60, scale = 520, seed = 7 }, center) {
    const N = this.cols * this.rows, cs = this.cellSize, g = this.terrain;
    const isWall = new Uint8Array(N);
    for (let i = 0; i < N; i++) isWall[i] = g[i] ? 0 : 1;
    const dW = distanceTransform(this.cols, this.rows, isWall);
    const dK = distanceTransform(this.cols, this.rows, g);
    const cx2 = (center?.x ?? this.size / 2) * 2, cy2 = (center?.y ?? this.size / 2) * 2;
    const hash = (ix, iy) => {
      let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const vn = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
    const noise = (x, y) => (vn(x / scale, y / scale) * 0.65 + vn(x / (scale * 0.42) + 17.3, y / (scale * 0.42) + 5.1) * 0.35) * 2 - 1;
    for (let i = 0; i < N; i++) {
      // 只处理边界附近（±amp）的格子
      const sd = g[i] ? -(dW[i] * cs - cs / 2) : dK[i] * cs - cs / 2;
      if (sd < -amp - cs || sd > amp + cs) continue;
      const x = ((i % this.cols) + 0.5) * cs, y = (((i / this.cols) | 0) + 0.5) * cs;
      const n = 0.5 * (noise(x, y) + noise(cx2 - x, cy2 - y)) * 1.6;
      g[i] = sd < n * amp ? 1 : 0;
    }
  }
  _border(g) {
    const C = this.cols, Rr = this.rows;
    for (let c = 0; c < C; c++) { g[c] = 0; g[(Rr - 1) * C + c] = 0; }
    for (let r = 0; r < Rr; r++) { g[r * C] = 0; g[r * C + C - 1] = 0; }
  }
  // 删除与蓝方泉水不连通的孤立可走块
  _removeIslands(md) {
    const f = md.FOUNTAINS?.[0];
    const seedIdx = this.cellIndex(f?.spawns?.[0]?.x ?? 700, f?.spawns?.[0]?.y ?? 700);
    if (!this.terrain[seedIdx]) return;
    const N = this.cols * this.rows, C = this.cols;
    const mark = new Uint8Array(N);
    const q = new Int32Array(N);
    let h = 0, t = 0;
    q[t++] = seedIdx; mark[seedIdx] = 1;
    while (h < t) {
      const i = q[h++];
      for (const o of [1, -1, C, -C]) {
        const j = i + o;
        if (j >= 0 && j < N && !mark[j] && this.terrain[j]) { mark[j] = 1; q[t++] = j; }
      }
    }
    let removed = 0;
    for (let i = 0; i < N; i++) if (this.terrain[i] && !mark[i]) { this.terrain[i] = 0; removed++; }
    this.islandCellsRemoved = removed;
  }
  _footprints(md) {
    const FP = md.STRUCTURE_FOOTPRINT ?? { turret: 90, inhibitor: 150, nexus: 230, fountainTurret: 110 };
    for (const s of md.STRUCTURES ?? []) {
      const r = FP[s.kind] ?? 0;
      if (r > 0) this._circle(this.walk, s.x, s.y, r, 0);
    }
  }
  _computeSdf() {
    const N = this.cols * this.rows, cs = this.cellSize;
    const isWall = new Uint8Array(N);
    for (let i = 0; i < N; i++) isWall[i] = this.terrain[i] ? 0 : 1;
    const dToWall = distanceTransform(this.cols, this.rows, isWall);
    const dToWalk = distanceTransform(this.cols, this.rows, this.terrain);
    for (let i = 0; i < N; i++) {
      this.sdf[i] = this.terrain[i] ? -(dToWall[i] * cs - cs / 2) : Math.min(dToWalk[i] * cs - cs / 2, 1e5);
    }
  }
  _computeClearance() {
    const N = this.cols * this.rows, cs = this.cellSize;
    const blocked = new Uint8Array(N);
    for (let i = 0; i < N; i++) blocked[i] = this.walk[i] ? 0 : 1;
    const d = distanceTransform(this.cols, this.rows, blocked);
    for (let i = 0; i < N; i++) {
      const dc = this.walk[i] ? d[i] : 0;
      this.clearance[i] = dc * cs;
      this.nearWall[i] = this.walk[i] && dc < 1.5 ? 1 : 0;
      this.cost[i] = dc < 1.5 ? 1.8 : dc < 2.5 ? 1.3 : dc < 3.5 ? 1.1 : 1;
    }
  }
  _computeComponents() {
    const N = this.cols * this.rows;
    const q = new Int32Array(N);
    let id = 0;
    this.comp.fill(0);
    const sizes = [0];
    for (let s = 0; s < N; s++) {
      if (!this.walk[s] || this.comp[s]) continue;
      id++;
      let h = 0, t = 0, n = 0;
      q[t++] = s; this.comp[s] = id;
      while (h < t) {
        const i = q[h++]; n++;
        // 8 邻接（禁止切角）与 A* 一致；边界一圈恒为墙，不会越界
        for (let k = 0; k < 8; k++) {
          const j = i + this._nOff[k];
          if (!this.walk[j] || this.comp[j]) continue;
          if (k >= 4 && (!this.walk[i + this._dA[k]] || !this.walk[i + this._dB[k]])) continue;
          this.comp[j] = id; q[t++] = j;
        }
      }
      sizes.push(n);
    }
    this.componentSizes = sizes;
    this.componentCount = id;
  }
  _rasterBrushes(md) {
    for (const b of md.BRUSHES ?? []) this._poly(this.brush, b.poly, b.id);
    // 草丛只存在于地形可走格
    for (let i = 0; i < this.brush.length; i++) if (!this.terrain[i]) this.brush[i] = -1;
  }

  // ——————————————————— 基础查询 ———————————————————
  cellIndex(x, y) {
    const cs = this.cellSize;
    let c = Math.floor(x / cs), r = Math.floor(y / cs);
    c = c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
    r = r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
    return r * this.cols + c;
  }
  cellCenter(i) {
    return { x: ((i % this.cols) + 0.5) * this.cellSize, y: (Math.floor(i / this.cols) + 0.5) * this.cellSize };
  }
  _inside(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  isWalkable(x, y) {
    if (!(x >= 0 && y >= 0 && x < this.size && y < this.size)) return false;
    return this.walk[this.cellIndex(x, y)] === 1;
  }
  /** 地形是否可走（忽略建筑占地） */
  isTerrainWalkable(x, y) {
    if (!this._inside(x, y)) return false;
    return this.terrain[this.cellIndex(x, y)] === 1;
  }
  brushAt(x, y) {
    if (!this._inside(x, y)) return -1;
    return this.brush[this.cellIndex(x, y)];
  }
  /** 墙体阻挡视线（草丛与建筑不阻挡） */
  blocksSight(x, y) {
    if (!this._inside(x, y)) return true;
    return this.terrain[this.cellIndex(x, y)] === 0;
  }
  sdfAt(x, y) {
    if (!this._inside(x, y)) return 1000;
    return this.sdf[this.cellIndex(x, y)];
  }
  componentAt(x, y) {
    if (!this._inside(x, y)) return 0;
    return this.comp[this.cellIndex(x, y)];
  }

  /** 最近可走点：本身可走则原样返回；否则螺旋搜索，返回最近可走格内离原点最近的点 */
  nearestWalkable(x, y, maxRadius = 1500, comp = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) { x = this.size / 2; y = this.size / 2; }
    if (this.isWalkable(x, y) && (!comp || this.componentAt(x, y) === comp)) return { x, y };
    const cs = this.cellSize;
    const maxR = Math.max(2, Math.ceil(maxRadius / cs) + 1);
    const T = spiralTable(Math.max(maxR, 64));
    const c0 = Math.floor(x / cs), r0 = Math.floor(y / cs);
    let best = null, bd = Infinity, stopAt = Infinity;
    const inset = 3;
    for (let k = 0; k < T.n; k++) {
      const d = T.d[k];
      if (d > maxR || d > stopAt) break;
      const c = c0 + T.dx[k], r = r0 + T.dy[k];
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
      const i = r * this.cols + c;
      if (!this.walk[i] || (comp && this.comp[i] !== comp)) continue;
      const lx = c * cs + inset, hx = (c + 1) * cs - inset, ly = r * cs + inset, hy = (r + 1) * cs - inset;
      const px = x < lx ? lx : x > hx ? hx : x, py = y < ly ? ly : y > hy ? hy : y;
      const dd = (px - x) ** 2 + (py - y) ** 2;
      if (dd < bd) { bd = dd; best = { x: px, y: py }; }
      if (stopAt === Infinity) stopAt = d + 1.5;
    }
    if (best) return best;
    // 兜底：全图扫描最近的可走格中心
    let bi = -1;
    for (let i = 0; i < this.walk.length; i++) {
      if (!this.walk[i] || (comp && this.comp[i] !== comp)) continue;
      const p = this.cellCenter(i);
      const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (dd < bd) { bd = dd; bi = i; }
    }
    return bi >= 0 ? this.cellCenter(bi) : { x, y };
  }

  // ——————————————————— 线段遍历 ———————————————————
  // mode 0：可走检测；mode 1：平滑用（贴墙格只允许出现在端点附近）；mode 2：返回首个不可走格进入参数 t
  _trace(x0, y0, x1, y1, mode) {
    const cs = this.cellSize, C = this.cols;
    const fx0 = x0 / cs, fy0 = y0 / cs, fx1 = x1 / cs, fy1 = y1 / cs;
    let cx = Math.floor(fx0), cy = Math.floor(fy0);
    const ex = Math.floor(fx1), ey = Math.floor(fy1);
    const walk = this.walk;
    const near = this.nearWall;
    const tol2 = (110 / cs) ** 2;
    const ok = (c, r) => {
      if (c < 0 || r < 0 || c >= C || r >= this.rows) return false;
      const i = r * C + c;
      if (!walk[i]) return false;
      if (mode === 1 && near[i]) {
        const mx = c + 0.5, my = r + 0.5;
        if ((mx - fx0) ** 2 + (my - fy0) ** 2 > tol2 && (mx - fx1) ** 2 + (my - fy1) ** 2 > tol2) return false;
      }
      return true;
    };
    if (!ok(cx, cy)) return mode === 2 ? 0 : false;
    const dx = fx1 - fx0, dy = fy1 - fy0;
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tmx = sx > 0 ? (cx + 1 - fx0) / dx : sx < 0 ? (fx0 - cx) / -dx : Infinity;
    let tmy = sy > 0 ? (cy + 1 - fy0) / dy : sy < 0 ? (fy0 - cy) / -dy : Infinity;
    let guard = Math.abs(ex - cx) + Math.abs(ey - cy) + 4;
    while ((cx !== ex || cy !== ey) && guard-- > 0) {
      let t;
      if (Math.abs(tmx - tmy) < 1e-9) {
        // 恰好穿过格点：两侧正交格都必须可走（禁止切角）
        t = tmx;
        if (t > 1) break;
        if (!ok(cx + sx, cy) || !ok(cx, cy + sy)) return mode === 2 ? t : false;
        cx += sx; cy += sy; tmx += tdx; tmy += tdy;
      } else if (tmx < tmy) {
        t = tmx; if (t > 1) break;
        cx += sx; tmx += tdx;
      } else {
        t = tmy; if (t > 1) break;
        cy += sy; tmy += tdy;
      }
      if (!ok(cx, cy)) return mode === 2 ? t : false;
    }
    return mode === 2 ? 2 : true;
  }
  /** 线段上是否全部可走（禁止切角） */
  hasLineOfWalk(x0, y0, x1, y1) { return this._trace(x0, y0, x1, y1, 0); }
  /** 平滑用视线：除端点附近外不贴墙 */
  hasClearLine(x0, y0, x1, y1) { return this._trace(x0, y0, x1, y1, 1); }
  /** 沿线段前进，返回最后一个可走点 */
  raycastWalk(x0, y0, x1, y1) {
    const t = this._trace(x0, y0, x1, y1, 2);
    if (t >= 2) return { x: x1, y: y1 };
    if (t <= 0) return { x: x0, y: y0 };
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const tt = Math.max(0, t - 2 / len);
    return { x: x0 + (x1 - x0) * tt, y: y0 + (y1 - y0) * tt };
  }

  // ——————————————————— A* ———————————————————
  _push(node, f) {
    if (this._hSize >= this._heapCap) {
      const cap = this._heapCap * 2;
      const nN = new Int32Array(cap), nF = new Float32Array(cap);
      nN.set(this._hN); nF.set(this._hF);
      this._hN = nN; this._hF = nF; this._heapCap = cap;
    }
    const hN = this._hN, hF = this._hF;
    let i = this._hSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hF[p] <= f) break;
      hN[i] = hN[p]; hF[i] = hF[p]; i = p;
    }
    hN[i] = node; hF[i] = f;
  }
  _pop() {
    const hN = this._hN, hF = this._hF;
    const top = hN[0];
    const n = --this._hSize;
    if (n > 0) {
      const node = hN[n], f = hF[n];
      let i = 0;
      for (;;) {
        let l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        if (r < n && hF[r] < hF[l]) l = r;
        if (hF[l] >= f) break;
        hN[i] = hN[l]; hF[i] = hF[l]; i = l;
      }
      hN[i] = node; hF[i] = f;
    }
    return top;
  }

  /**
   * 寻路：返回不含起点的路径点数组；终点不可走时走到最近可走点；终点不可达时返回到离终点最近的已探索点的路径。
   * 仅当起点附近完全无可走格时返回 null。
   */
  findPath(sx, sy, tx, ty, { maxIter = 40000 } = {}) {
    const cs = this.cellSize, C = this.cols;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(tx) || !Number.isFinite(ty)) return null;
    let start = { x: sx, y: sy };
    if (!this.isWalkable(sx, sy)) {
      start = this.nearestWalkable(sx, sy, 600);
      if (!this.isWalkable(start.x, start.y)) return null;
    }
    const s = this.cellIndex(start.x, start.y);
    const sComp = this.comp[s];
    let goal = this.isWalkable(tx, ty) ? { x: tx, y: ty } : this.nearestWalkable(tx, ty, 3000);
    if (this.componentAt(goal.x, goal.y) !== sComp) goal = this.nearestWalkable(goal.x, goal.y, 3000, sComp);
    const t = this.cellIndex(goal.x, goal.y);
    const lead = start === null || (start.x === sx && start.y === sy) ? [] : [start];
    if (s === t || this.hasClearLine(start.x, start.y, goal.x, goal.y)) {
      this.lastStats = { iterations: 0, found: true };
      return lead.concat([{ x: goal.x, y: goal.y }]);
    }

    const walk = this.walk, cost = this.cost, g = this._g, par = this._par, seen = this._seen, closed = this._closed;
    const nOff = this._nOff, nCost = this._nCost, dA = this._dA, dB = this._dB;
    const gen = ++this._gen;
    if (gen >= 0xfffffff0) { this._seen.fill(0); this._closed.fill(0); this._gen = 1; }
    const tc = t % C, tr = (t / C) | 0;
    const hw = this.heuristicWeight;
    const H = (i) => {
      const dx = Math.abs((i % C) - tc), dy = Math.abs(((i / C) | 0) - tr);
      return (dx + dy + OCT * (dx < dy ? dx : dy)) * hw;
    };
    this._hSize = 0;
    g[s] = 0; seen[s] = gen; par[s] = -1;
    this._push(s, H(s));
    let best = s, bestH = H(s), found = false, iter = 0;
    while (this._hSize > 0) {
      const i = this._pop();
      if (closed[i] === gen) continue;
      closed[i] = gen;
      if (i === t) { found = true; break; }
      if (++iter > maxIter) break;
      const gi = g[i];
      for (let k = 0; k < 8; k++) {
        const j = i + nOff[k];
        if (!walk[j] || closed[j] === gen) continue;
        if (k >= 4 && (!walk[i + dA[k]] || !walk[i + dB[k]])) continue;
        const ng = gi + nCost[k] * cost[j];
        if (seen[j] === gen && ng >= g[j]) continue;
        g[j] = ng; seen[j] = gen; par[j] = i;
        const h = H(j);
        if (h < bestH) { bestH = h; best = j; }
        this._push(j, ng + h);
      }
    }
    this.lastStats = { iterations: iter, found };
    const end = found ? t : best;
    // 回溯格子序列
    const cells = [];
    for (let i = end; i !== -1 && cells.length < 100000; i = par[i]) cells.push(i);
    cells.reverse();
    const pts = new Array(cells.length);
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      pts[k] = { x: ((i % C) + 0.5) * cs, y: (((i / C) | 0) + 0.5) * cs };
    }
    pts[0] = { x: start.x, y: start.y };
    if (found) pts[pts.length - 1] = { x: goal.x, y: goal.y };
    return lead.concat(this._smooth(pts));
  }
  // 拉绳平滑：从锚点尽量直连更远的点
  _smooth(pts) {
    const out = [];
    if (pts.length <= 1) return pts.slice(1);
    let a = pts[0], i = 1;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.hasClearLine(a.x, a.y, pts[j + 1].x, pts[j + 1].y)) j++;
      out.push(pts[j]);
      a = pts[j];
      i = j + 1;
    }
    return out;
  }

  /** 路径总长（含起点） */
  static pathLength(sx, sy, path) {
    let L = 0, px = sx, py = sy;
    for (const p of path ?? []) { L += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y; }
    return L;
  }
}
