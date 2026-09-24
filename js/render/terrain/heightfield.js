// 高度场：由 nav.sdf（墙内正、可走负）+ 河道 + 龙坑 + 基地平台 + 泉水合成地形高度，并缓存各区域掩码供纹理/植被使用
import { fbm, valueNoise, smooth } from './noise.js';

export const DOMAIN = { D0: -2000, DS: 19000 };   // 地形覆盖范围（地图外留 2000 边距）
export const WATER_LEVEL = -30;                   // 河面高度
export const RIVER_BED = -62;

/** nav.sdf 双线性采样（地图外按离开距离继续增大） */
export function makeSdfSampler(nav) {
  const cs = nav.cellSize || 50, C = nav.cols, R = nav.rows, sdf = nav.sdf, size = C * cs;
  return function sdfAt(x, y) {
    let ox = 0, oy = 0, cx = x, cy = y;
    if (cx < 0) { ox = -cx; cx = 0; } else if (cx > size) { ox = cx - size; cx = size; }
    if (cy < 0) { oy = -cy; cy = 0; } else if (cy > size) { oy = cy - size; cy = size; }
    let gx = cx / cs - 0.5, gy = cy / cs - 0.5;
    if (gx < 0) gx = 0; else if (gx > C - 1.001) gx = C - 1.001;
    if (gy < 0) gy = 0; else if (gy > R - 1.001) gy = R - 1.001;
    const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy;
    const i = iy * C + ix;
    const a = sdf[i], b = sdf[i + 1], c = sdf[i + C], d = sdf[i + C + 1];
    let s = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    if (ox || oy) s = Math.max(s, 0) + Math.hypot(ox, oy);
    return s;
  };
}

/** 到河道中心线距离 / 当地半宽（<1 在河道内） */
export function riverRatio(x, y, P, HW) {
  let best = 1e12;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][0], ay = P[i][1], dx = P[i + 1][0] - ax, dy = P[i + 1][1] - ay;
    const l2 = dx * dx + dy * dy;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const hw = HW[i] + (HW[i + 1] - HW[i]) * t;
    const ex = ax + dx * t - x, ey = ay + dy * t - y;
    const r2 = (ex * ex + ey * ey) / (hw * hw);
    if (r2 < best) best = r2;
  }
  return Math.sqrt(best);
}

/** 点到多边形的有符号距离（内部为正） */
export function polySignedDist(x, y, poly) {
  let inside = false, best = 1e12;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xi - xj, dy = yi - yj, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - xj) * dx + (y - yj) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = xj + dx * t - x, ey = yj + dy * t - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  const d = Math.sqrt(best);
  return inside ? d : -d;
}

export function distToPolyline(x, y, pts) {
  let best = 1e12;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x, ey = ay + dy * t - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * 生成高度场。N = 每边格数（顶点 N+1）。
 * 返回 { N, V, cell, D0, DS, H, S(sdf), RV(河道比), BV(基地：蓝 +1 / 红 -1), PV(龙坑：小龙 +1 / 大龙 -1), sample(arr,x,y), heightAt(x,y) }
 */
export function buildHeightfield(game, N) {
  const { D0, DS } = DOMAIN;
  const V = N + 1, cell = DS / N;
  const md = game.map, nav = game.nav;
  const sdfAt = makeSdfSampler(nav);
  const total = V * V;
  const H = new Float32Array(total), S = new Float32Array(total), RV = new Float32Array(total);
  const BV = new Float32Array(total), PV = new Float32Array(total);
  const P = md.RIVER.path, HW = md.RIVER.halfWidths;
  const decor = md.DECOR || {};
  const bases = decor.bases || [];
  const baseBoxes = bases.map((b) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of b.boundary) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0: x0 - 200, y0: y0 - 200, x1: x1 + 200, y1: y1 + 200 };
  });
  const pits = decor.pits || {};
  const pitList = [];
  if (pits.dragon) pitList.push({ ...pits.dragon, sign: 1 });
  if (pits.baron) pitList.push({ ...pits.baron, sign: -1 });
  const ford = decor.riverFord || { x: 7420, y: 7430, r: 700 };
  // 河道包围盒
  let rx0 = 1e9, ry0 = 1e9, rx1 = -1e9, ry1 = -1e9;
  for (const [x, y] of P) { rx0 = Math.min(rx0, x); ry0 = Math.min(ry0, y); rx1 = Math.max(rx1, x); ry1 = Math.max(ry1, y); }
  rx0 -= 1100; ry0 -= 1100; rx1 += 1100; ry1 += 1100;

  for (let j = 0; j < V; j++) {
    const y = D0 + j * cell;
    for (let i = 0; i < V; i++) {
      const x = D0 + i * cell;
      const k = j * V + i;
      const s = sdfAt(x, y);
      S[k] = s;
      let h = 0;
      // —— 可走区微起伏 ——
      h += (valueNoise(x / 650, y / 650, 3) - 0.5) * 7;
      // —— 墙体：崖脚不规则 → 陡峭岩壁（两级台阶）→ 顶部起伏 ——
      if (s > -30) {
        const sp = s - 30 * valueNoise(x / 170, y / 170, 5);
        if (sp > 0) {
          const u1 = Math.min(sp / 80, 1);
          const step1 = 1 - (1 - u1) * (1 - u1) * (1 - u1);
          const step2 = smooth(105, 240, sp);
          const top = 175 + 115 * fbm(x / 1100, y / 1100, 3, 9);
          let w = top * (0.5 * step1 + 0.5 * step2);
          const deep = smooth(180, 650, sp);
          w += deep * (fbm(x / 420, y / 420, 3, 21) - 0.35) * 95;
          w += Math.min(Math.max(sp - 240, 0), 1200) * 0.05;
          h += w;
        }
      }
      // —— 地图边缘更高 ——
      const edge = Math.max(Math.abs(x - 7500), Math.abs(y - 7500)) - 6950;
      if (edge > 0 && s > 0) h += Math.min(edge, 2200) * 0.17 * smooth(0, 260, s);
      // —— 河道下凹（中路浅滩更浅） ——
      let dep = 0, rr = 99;
      if (x > rx0 && x < rx1 && y > ry0 && y < ry1) {
        rr = riverRatio(x, y, P, HW);
        if (rr < 1.2) {
          let d = RIVER_BED * (1 - smooth(0.3, 1.02, rr));
          const fd = Math.hypot(x - ford.x, y - ford.y);
          d *= 0.66 + 0.34 * smooth(ford.r * 0.35, ford.r * 1.15, fd);
          d += (valueNoise(x / 220, y / 220, 7) - 0.5) * 6 * (1 - smooth(0.6, 1, rr));
          dep = Math.min(dep, d);
        }
      }
      RV[k] = rr;
      // —— 龙坑下沉 ——
      let pv = 0;
      for (const p of pitList) {
        const dd = Math.hypot(x - p.x, y - p.y);
        if (dd < p.r + 260) {
          const f = 1 - smooth(p.r * 0.72, p.r + 90, dd);
          const d = (-24 + (valueNoise(x / 160, y / 160, 13) - 0.5) * 5) * f;
          dep = Math.min(dep, d);
          if (f > Math.abs(pv)) pv = f * p.sign;
        }
      }
      PV[k] = pv;
      h += dep;
      // —— 基地平台（出口处形成坡道）与泉水石台 ——
      let bv = 0;
      for (let b = 0; b < bases.length; b++) {
        const bb = baseBoxes[b];
        if (x < bb.x0 || x > bb.x1 || y < bb.y0 || y > bb.y1) continue;
        const base = bases[b];
        const sd = polySignedDist(x, y, base.boundary);
        const f = smooth(-150, 150, sd);
        const fo = base.fountain;
        const df = Math.hypot(x - fo.x, y - fo.y);
        const ff = 1 - smooth(fo.r - 40, fo.r + 8, df);
        const m = Math.max(f, ff);
        if (m > 0) {
          h += (base.platformHeight || 45) * m + 16 * ff;
          h -= (valueNoise(x / 650, y / 650, 3) - 0.5) * 7 * m;   // 平台上抹平微起伏
          bv = (base.team === 0 ? 1 : -1) * m;
        }
      }
      BV[k] = bv;
      // 地图内限高（screenToGround 从 420 开始步进）
      if (x >= 0 && x <= 15000 && y >= 0 && y <= 15000 && h > 405) h = 405;
      H[k] = h;
    }
  }

  const inv = 1 / cell;
  function sample(arr, x, y) {
    let gx = (x - D0) * inv, gy = (y - D0) * inv;
    if (gx < 0) gx = 0; else if (gx > N - 0.0001) gx = N - 0.0001;
    if (gy < 0) gy = 0; else if (gy > N - 0.0001) gy = N - 0.0001;
    const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy;
    const k = iy * V + ix;
    const a = arr[k], b = arr[k + 1], c = arr[k + V], d = arr[k + V + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  return { N, V, cell, D0, DS, H, S, RV, BV, PV, sample, sdfAt, heightAt: (x, y) => sample(H, x, y) };
}

/** 计算顶点法线（场景坐标：X = x，Y = h，Z = -y） */
export function computeNormals(hf) {
  const { V, H, cell } = hf;
  const NRM = new Float32Array(V * V * 3);
  const inv2 = 1 / (2 * cell);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = j * V + i;
      const hl = H[j * V + Math.max(i - 1, 0)], hr = H[j * V + Math.min(i + 1, V - 1)];
      const hd = H[Math.max(j - 1, 0) * V + i], hu = H[Math.min(j + 1, V - 1) * V + i];
      const dx = (hr - hl) * inv2, dy = (hu - hd) * inv2;
      const nx = -dx, ny = 1, nz = dy;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      NRM[k * 3] = nx * l; NRM[k * 3 + 1] = ny * l; NRM[k * 3 + 2] = nz * l;
    }
  }
  return NRM;
}
