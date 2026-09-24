// 几何体工具：合并带顶点色的部件 + 树木/岩石/草叶/花/蘑菇/道具的低多边形造型（LoL 手绘风，顶点色做假 AO）
import * as THREE from 'three';
import { valueNoise, mulberry32 } from './noise.js';

const _c = new THREE.Color();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 线性空间颜色数组 */
export function lin(hex, k = 1) { _c.setHex(hex); return [_c.r * k, _c.g * k, _c.b * k]; }

/** 组合变换矩阵 */
export function M(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/**
 * 合并部件 → 非索引 BufferGeometry（position / normal / color）。
 * parts: [{ geo, m?: Matrix4, color: hex | (x,y,z,nx,ny,nz) => [r,g,b]（线性） }]
 */
export function mergeParts(parts) {
  const list = [];
  let total = 0;
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.m) g.applyMatrix4(p.m);
    if (!g.attributes.normal) g.computeVertexNormals();
    list.push([g, p]);
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const [g, p] of list) {
    const P = g.attributes.position.array, N = g.attributes.normal.array, n = g.attributes.position.count;
    pos.set(P, o * 3);
    nrm.set(N, o * 3);
    const fixed = typeof p.color === 'function' ? null : lin(p.color ?? 0xffffff);
    for (let i = 0; i < n; i++) {
      const c = fixed || p.color(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      const q = (o + i) * 3;
      col[q] = c[0]; col[q + 1] = c[1]; col[q + 2] = c[2];
    }
    o += n;
    g.dispose();
    p.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** 不规则球团（树冠）：按原始方向噪声位移，保留平滑球面法线 */
export function blob(radius, detail = 1, amp = 0.18, seed = 1) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const P = g.attributes.position.array, N = g.attributes.normal.array;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i] / radius, y = P[i + 1] / radius, z = P[i + 2] / radius;
    const n = valueNoise(x * 1.9 + 3.1 + seed * 7.3, y * 1.9 + z * 1.4 + seed, seed);
    const k = 1 + (n - 0.5) * 2 * amp;
    P[i] *= k; P[i + 1] *= k; P[i + 2] *= k;
    const l = Math.hypot(x, y, z) || 1;
    N[i] = x / l; N[i + 1] = y / l; N[i + 2] = z / l;
  }
  return g;
}

/** 岩石：位移后平面法线（棱角分明） */
export function rockGeo(detail = 1, amp = 0.32, seed = 1, sy = 0.62) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const P = g.attributes.position.array;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    const n = valueNoise(x * 1.6 + seed * 5.1, y * 1.6 + z * 1.2 + seed * 2.3, seed + 11);
    const k = 1 + (n - 0.5) * 2 * amp;
    P[i] = x * k; P[i + 1] = y * k * sy; P[i + 2] = z * k;
  }
  g.computeVertexNormals();
  return g;
}

/** 树冠配色：底部暗（假 AO）→ 顶部亮，带细微色相噪声 */
function crownColor(hex, y0, y1, seed = 0) {
  const c = lin(hex);
  return (x, y, z, nx, ny) => {
    const t = clamp01((y - y0) / (y1 - y0));
    const k = 0.5 + 0.62 * t + 0.14 * ny;
    const n = valueNoise(x * 0.018 + seed, z * 0.018 + y * 0.012, 7 + seed) - 0.5;
    return [c[0] * k * (1 + n * 0.3), c[1] * k * (1 + n * 0.14), c[2] * k * (1 - n * 0.16)];
  };
}
function gradColor(hexA, hexB, y0, y1) {
  const a = lin(hexA), b = lin(hexB);
  return (x, y) => { const t = clamp01((y - y0) / (y1 - y0)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
}
const trunk = (rt, rb, h, y) => ({ geo: new THREE.CylinderGeometry(rt, rb, h, 6, 1, true), m: M(0, y, 0), color: gradColor(0x2e2219, 0x6a4e38, y - h / 2, y + h / 2) });

/** 4 种树：0 圆冠阔叶 / 1 尖顶针叶 / 2 灌木团 / 3 高大蓝绿乔木 */
export function makeTreeGeos() {
  const A = mergeParts([
    trunk(14, 26, 180, 90),
    { geo: blob(125, 1, 0.2, 1), m: M(0, 245, 0, 1, 0.82, 1), color: crownColor(0x3f7a4c, 130, 360, 1) },
    { geo: blob(92, 1, 0.22, 2), m: M(78, 196, 26), color: crownColor(0x3f7a4c, 120, 330, 2) },
    { geo: blob(86, 1, 0.22, 3), m: M(-62, 204, -52), color: crownColor(0x3a7250, 120, 330, 3) },
    { geo: blob(72, 1, 0.2, 4), m: M(12, 312, -8), color: crownColor(0x4a8650, 150, 380, 4) },
  ]);
  const B = mergeParts([
    trunk(10, 18, 130, 65),
    { geo: new THREE.ConeGeometry(118, 180, 8, 1, true), m: M(0, 150, 0), color: crownColor(0x2b5f4d, 60, 420, 5) },
    { geo: new THREE.ConeGeometry(90, 160, 8, 1, true), m: M(0, 240, 0, 1, 1, 1, 0, 0.4, 0), color: crownColor(0x2e6450, 60, 420, 6) },
    { geo: new THREE.ConeGeometry(62, 150, 7, 1, true), m: M(0, 330, 0, 1, 1, 1, 0, 0.9, 0), color: crownColor(0x33704f, 60, 420, 7) },
  ]);
  const C = mergeParts([
    { geo: blob(72, 1, 0.24, 8), m: M(0, 48, 0, 1, 0.78, 1), color: crownColor(0x4c8442, -10, 120, 8) },
    { geo: blob(56, 1, 0.24, 9), m: M(62, 38, 22, 1, 0.8, 1), color: crownColor(0x4f8a40, -10, 110, 9) },
    { geo: blob(50, 1, 0.24, 10), m: M(-46, 36, -42, 1, 0.8, 1), color: crownColor(0x46803f, -10, 110, 10) },
  ]);
  const D = mergeParts([
    trunk(18, 32, 250, 125),
    { geo: blob(165, 1, 0.16, 11), m: M(0, 370, 0, 1, 1.02, 1), color: crownColor(0x2f6c5e, 220, 540, 11) },
    { geo: blob(104, 1, 0.2, 12), m: M(96, 296, 42), color: crownColor(0x2f6c5e, 200, 500, 12) },
    { geo: blob(98, 1, 0.2, 13), m: M(-84, 306, -54), color: crownColor(0x346e5a, 200, 500, 13) },
  ]);
  return [A, B, C, D];
}

/** 岩石两种（带苔藓顶） */
export function makeRockGeos() {
  const moss = lin(0x5a7442), side = lin(0x7e7668), low = lin(0x4a443c);
  const col = (x, y, z, nx, ny) => {
    const t = clamp01((y + 0.3) / 0.9);
    const m = clamp01((ny - 0.55) / 0.3);
    const n = valueNoise(x * 3 + 1, z * 3 + y * 2, 3) * 0.25 + 0.88;
    const r = [low[0] + (side[0] - low[0]) * t, low[1] + (side[1] - low[1]) * t, low[2] + (side[2] - low[2]) * t];
    return [(r[0] + (moss[0] - r[0]) * m) * n, (r[1] + (moss[1] - r[1]) * m) * n, (r[2] + (moss[2] - r[2]) * m) * n];
  };
  return [
    mergeParts([{ geo: rockGeo(1, 0.3, 1, 0.62), color: col }]),
    mergeParts([{ geo: rockGeo(0, 0.25, 2, 0.8), color: col }, { geo: rockGeo(0, 0.3, 3, 0.7), m: M(0.8, -0.1, 0.3, 0.55, 0.55, 0.55), color: col }]),
  ];
}

/** 草叶簇：blades 片数、高度范围、宽度、颜色（底→中→尖） */
export function grassClump({ blades = 12, hMin = 110, hMax = 170, width = 16, spread = 36, cols = [0x2c5a1c, 0x6d9e2e, 0xcfe46c], seed = 1 } = {}) {
  const rnd = mulberry32(seed);
  const c0 = lin(cols[0]), c1 = lin(cols[1]), c2 = lin(cols[2]);
  const pos = [], nrm = [], col = [];
  const push = (p, c, n) => { pos.push(p[0], p[1], p[2]); col.push(c[0], c[1], c[2]); nrm.push(n[0], n[1], n[2]); };
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = hMin + rnd() * (hMax - hMin), w = width * (0.75 + rnd() * 0.5);
    const face = rnd() * Math.PI * 2, px = Math.cos(face), pz = Math.sin(face);   // 叶面方向
    const lean = 0.25 + rnd() * 0.45, la = a + (rnd() - 0.5) * 1.2;
    const lx = Math.cos(la) * h * lean, lz = Math.sin(la) * h * lean;
    const n = [(-pz) * 0.35, 0.94, px * 0.35];
    const bl = [bx - px * w / 2, 0, bz - pz * w / 2], br = [bx + px * w / 2, 0, bz + pz * w / 2];
    const mh = h * 0.55, mw = w * 0.36;
    const mx = bx + lx * 0.3, mz = bz + lz * 0.3;
    const ml = [mx - px * mw, mh, mz - pz * mw], mr = [mx + px * mw, mh, mz + pz * mw];
    const tip = [bx + lx, h, bz + lz];
    const k = 0.85 + rnd() * 0.3;
    const cb = c0.map((v) => v * k), cm = c1.map((v) => v * k), ct = c2.map((v) => v * k);
    push(bl, cb, n); push(br, cb, n); push(mr, cm, n);
    push(bl, cb, n); push(mr, cm, n); push(ml, cm, n);
    push(ml, cm, n); push(mr, cm, n); push(tip, ct, n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** 花丛（花头白色，由实例色着色）与蘑菇 */
export function makeFlowerGeo() {
  const parts = [];
  const rnd = mulberry32(77);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * 6.28, r = 6 + rnd() * 22;
    parts.push({ geo: new THREE.OctahedronGeometry(7 + rnd() * 3, 0), m: M(Math.cos(a) * r, 12 + rnd() * 12, Math.sin(a) * r, 1, 0.6, 1), color: 0xffffff });
  }
  return mergeParts(parts);
}
export function makeMushroomGeo() {
  const parts = [];
  const spots = [[0, 0, 1], [26, 10, 0.7], [-18, 20, 0.55]];
  for (const [x, z, s] of spots) {
    parts.push({ geo: new THREE.CylinderGeometry(5 * s, 7 * s, 26 * s, 5, 1, true), m: M(x, 13 * s, z), color: 0xe6dcc2 });
    parts.push({ geo: new THREE.SphereGeometry(18 * s, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), m: M(x, 22 * s, z, 1, 0.62, 1), color: (px, py) => lin(py > 29 * s ? 0xd86a4a : 0xb8452e) });
  }
  return mergeParts(parts);
}

/** 石质道具配色 */
export const THEMES = {
  0: { stone: 0xd2ccb6, stoneDark: 0x9e9884, trim: 0xd8b86a, crystal: 0x49b4ff, glow: 0x3aa0ff },
  1: { stone: 0x6a5c68, stoneDark: 0x43384a, trim: 0xa8304e, crystal: 0xe0407a, glow: 0xc0304a },
  2: { stone: 0x9a927e, stoneDark: 0x6b6456, trim: 0x8c7440, crystal: 0xffd27a, glow: 0xffc86a },
};
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);

/** 雕像（守卫者：底座 + 长袍身躯 + 肩甲 + 头 + 双翼 + 长矛），正前方 +X */
export function statueGeo(team) {
  const T = THEMES[team] || THEMES[2];
  const sh = gradColor(T.stoneDark, T.stone, 0, 380);
  return mergeParts([
    { geo: box(190, 60, 190), m: M(0, 30, 0), color: T.stoneDark },
    { geo: box(150, 14, 150), m: M(0, 66, 0), color: T.trim },
    { geo: box(130, 40, 130), m: M(0, 93, 0), color: sh },
    { geo: cyl(36, 58, 210, 8), m: M(0, 218, 0), color: sh },
    { geo: box(64, 34, 150), m: M(0, 316, 0), color: T.trim },
    { geo: new THREE.IcosahedronGeometry(28, 1), m: M(6, 356, 0), color: T.stone },
    { geo: new THREE.ConeGeometry(34, 50, 6), m: M(0, 392, 0), color: T.trim },
    { geo: box(16, 190, 110), m: M(-40, 300, 70, 1, 1, 1, 0.5, 0, 0), color: sh },
    { geo: box(16, 190, 110), m: M(-40, 300, -70, 1, 1, 1, -0.5, 0, 0), color: sh },
    { geo: cyl(5, 6, 420, 5), m: M(40, 250, 88), color: 0x5a4a38 },
    { geo: new THREE.ConeGeometry(14, 60, 4), m: M(40, 490, 88), color: T.trim },
  ]);
}
/** 火盆（三足 + 碗），火焰单独用发光材质 */
export function brazierGeo(team) {
  const T = THEMES[team] || THEMES[2];
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push({ geo: cyl(6, 9, 130, 5), m: M(Math.cos(a) * 34, 60, Math.sin(a) * 34, 1, 1, 1, Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28), color: 0x3c332c });
  }
  parts.push({ geo: cyl(74, 42, 48, 10), m: M(0, 138, 0), color: 0x4a4038 });
  parts.push({ geo: new THREE.TorusGeometry(72, 7, 4, 14), m: M(0, 162, 0, 1, 1, 1, Math.PI / 2, 0, 0), color: T.trim });
  parts.push({ geo: cyl(58, 58, 6, 10), m: M(0, 158, 0), color: 0x2a1a10 });
  return mergeParts(parts);
}
/** 晶柱底座（水晶单独发光） */
export function pillarGeo(team) {
  const T = THEMES[team] || THEMES[2];
  return mergeParts([
    { geo: cyl(86, 108, 60, 8), m: M(0, 30, 0), color: T.stoneDark },
    { geo: cyl(80, 80, 12, 8), m: M(0, 66, 0), color: T.trim },
    { geo: cyl(44, 58, 150, 8), m: M(0, 146, 0), color: gradColor(T.stoneDark, T.stone, 70, 220) },
    { geo: cyl(70, 50, 30, 8), m: M(0, 234, 0), color: T.trim },
  ]);
}
/** 路灯（木杆 + 吊臂 + 灯框），灯芯单独发光 */
export function lanternGeo() {
  return mergeParts([
    { geo: cyl(9, 13, 240, 6), m: M(0, 120, 0), color: gradColor(0x2c2018, 0x5a4230, 0, 240) },
    { geo: box(80, 9, 9), m: M(34, 232, 0), color: 0x4a3626 },
    { geo: box(34, 6, 34), m: M(66, 222, 0), color: 0x2a2420 },
    { geo: box(34, 6, 34), m: M(66, 180, 0), color: 0x2a2420 },
    { geo: new THREE.ConeGeometry(26, 22, 4), m: M(66, 236, 0, 1, 1, 1, 0, Math.PI / 4, 0), color: 0x2a2420 },
  ]);
}
