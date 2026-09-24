// 植被与散布物：树木/岩石/花/蘑菇/地面草簇/草丛草叶的布点（确定性）与分块 InstancedMesh 构建
import * as THREE from 'three';
import { mulberry32, valueNoise, fbm } from './noise.js';
import { distToPolyline } from './heightfield.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _col = new THREE.Color();

/**
 * 把实例按空间分块生成多个 InstancedMesh（每块独立包围球 → 视锥剔除有效）。
 * items: [{ x, y, h, rot, s, sy?, tilt?, c?: [r,g,b] }]
 */
export function buildTiles(parent, geo, mat, items, { tile = 3000, castShadow = false, receiveShadow = false, name = 'inst', renderOrder = 0 } = {}) {
  const buckets = new Map();
  for (const it of items) {
    const k = Math.floor((it.x + 3000) / tile) * 1000 + Math.floor((it.y + 3000) / tile);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(it);
  }
  const meshes = [];
  for (const list of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      _p.set(it.x, it.h, -it.y);
      _e.set(it.tilt ? it.tilt[0] : 0, it.rot || 0, it.tilt ? it.tilt[1] : 0);
      _q.setFromEuler(_e);
      const s = it.s || 1;
      _s.set(s * (it.sx || 1), s * (it.sy || 1), s * (it.sz || it.sx || 1));
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      if (it.c) mesh.setColorAt(i, _col.setRGB(it.c[0], it.c[1], it.c[2]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

/** 到兵线石板路中心线的最近距离 */
export function makeLaneDist(md) {
  const lanes = (md.DECOR?.lanePaths || []).map((l) => l.pts);
  return (x, y) => { let d = 1e9; for (const p of lanes) d = Math.min(d, distToPolyline(x, y, p)); return d; };
}

const TREE_TINTS = [
  [1, 1, 1], [0.92, 1.04, 1.02], [1.08, 1.06, 0.84], [0.84, 0.96, 1.1], [1.0, 0.94, 0.9], [0.9, 1.08, 0.9],
];

/**
 * 计算所有散布点。返回 { trees: [[],[],[],[]], rocks: [[],[]], flowers, mushrooms, tufts, stats }
 */
export function scatterAll(game, hf, Q) {
  const md = game.map, nav = game.nav;
  const rnd = mulberry32(0x5eed1234);
  const laneDist = makeLaneDist(md);
  const { sample } = hf;
  const heightAt = hf.heightAt;
  const lo = -1500, hi = 16500;
  const inMap = (x, y) => x >= 0 && x <= 15000 && y >= 0 && y <= 15000;

  // —— 树木 ——
  const cand = [];
  const sp = Q.treeSp;
  for (let gy = lo; gy < hi; gy += sp) {
    for (let gx = lo; gx < hi; gx += sp) {
      const x = gx + (rnd() - 0.5) * sp * 0.95, y = gy + (rnd() - 0.5) * sp * 0.95;
      const s = hf.sdfAt(x, y);
      if (s < 38 + 30 * valueNoise(x / 260, y / 260, 51)) continue;
      // 墙内偶尔留出林间空地（换成岩石/灌木）
      const clear = fbm(x / 1400, y / 1400, 2, 61);
      if (s > 260 && clear < 0.3 && rnd() < 0.7) continue;
      cand.push({ x, y, s, r: rnd() });
    }
  }
  let edgeN = 0;
  for (const c of cand) if (c.s < 170) edgeN++;
  const pInner = Math.min(1, Math.max(0.05, (Q.trees - edgeN) / Math.max(1, cand.length - edgeN)));
  const pEdge = Math.min(1, Q.trees / Math.max(1, edgeN));
  const trees = [[], [], [], []];
  for (const c of cand) {
    if (c.r > (c.s < 170 ? pEdge : pInner)) continue;
    const { x, y, s } = c;
    const patch = valueNoise(x / 950, y / 950, 71);
    let type;
    const u = rnd();
    // 靠近可走区只放灌木/小树，避免树冠遮住野区小路
    if (s < 95) type = 2;
    else if (s < 150) type = u < 0.4 ? 2 : u < 0.75 ? 0 : 1;
    else if (patch < 0.38) type = u < 0.7 ? 1 : u < 0.85 ? 0 : 3;
    else type = u < 0.5 ? 0 : u < 0.72 ? 3 : u < 0.9 ? 1 : 2;
    let sc = 0.8 + rnd() * 0.45;
    if (s < 220) sc *= Math.min(1, 0.62 + s / 480);
    if (s > 320) sc *= 1.12;
    if (!inMap(x, y)) sc *= 1.25;
    if (type === 2) sc *= 1.1;
    const tint = TREE_TINTS[(rnd() * TREE_TINTS.length) | 0], b = 0.86 + rnd() * 0.24;
    trees[type].push({
      x, y, h: heightAt(x, y) - 6, rot: rnd() * 6.283, s: sc, sy: 0.88 + rnd() * 0.26,
      c: [tint[0] * b, tint[1] * b, tint[2] * b], sdf: s,
    });
  }

  // —— 岩石：崖脚巨石 + 墙顶散石 ——
  const rocks = [[], []];
  const rsp = Q.rockSp;
  for (let gy = 0; gy < 15000; gy += rsp) {
    for (let gx = 0; gx < 15000; gx += rsp) {
      const x = gx + rnd() * rsp, y = gy + rnd() * rsp;
      const s = hf.sdfAt(x, y);
      if (s < -12 || s > 90) continue;
      if (Math.abs(sample(hf.BV, x, y)) > 0.3 || sample(hf.RV, x, y) < 1.0) continue;
      if (rnd() > 0.42) continue;
      const sc = 34 + rnd() * 62;
      const g = 0.82 + rnd() * 0.3;
      rocks[rnd() < 0.55 ? 0 : 1].push({ x, y, h: heightAt(x, y) - sc * 0.22, rot: rnd() * 6.28, s: sc, sy: 0.8 + rnd() * 0.6, c: [g, g * 0.98, g * 0.94], tilt: [(rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3] });
    }
  }
  // 河道石块
  for (const r of md.DECOR?.riverRocks || []) {
    const sc = r.r * 1.15;
    rocks[rnd() < 0.5 ? 0 : 1].push({ x: r.x, y: r.y, h: heightAt(r.x, r.y) - sc * 0.15, rot: rnd() * 6.28, s: sc, sy: 0.9 + rnd() * 0.4, c: [0.9, 0.92, 0.9] });
  }
  // 中路浅滩两侧石块（半没入水中）
  const ford = md.DECOR?.riverFord;
  if (ford) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd() * 0.3, rr = ford.r * (0.85 + rnd() * 0.35);
      const x = ford.x + Math.cos(a) * rr, y = ford.y + Math.sin(a) * rr;
      if (laneDist(x, y) < 380) continue;
      const sc = 30 + rnd() * 40;
      rocks[1].push({ x, y, h: heightAt(x, y) - sc * 0.2, rot: rnd() * 6.28, s: sc, sy: 0.6 + rnd() * 0.3, c: [0.95, 0.95, 0.92] });
    }
  }
  // 龙坑边缘：大龙紫调、小龙土黄
  for (const [name, p] of Object.entries(md.DECOR?.pits || {})) {
    const baron = name === 'baron';
    const ma = Math.atan2((p.mouth?.y ?? p.y) - p.y, (p.mouth?.x ?? p.x) - p.x);
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.15;
      let da = Math.abs(a - ma) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.55) continue;
      const rr = p.r + 20 + rnd() * 90;
      const x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr;
      const sc = 50 + rnd() * 70;
      const c = baron ? [0.62 + rnd() * 0.1, 0.52, 0.78] : [1.12, 0.94 + rnd() * 0.08, 0.68];
      rocks[rnd() < 0.5 ? 0 : 1].push({ x, y, h: heightAt(x, y) - sc * 0.25, rot: rnd() * 6.28, s: sc, sy: 0.9 + rnd() * 0.7, c });
    }
  }

  // —— 花 / 蘑菇 / 地面草簇 ——
  const flowers = [], mushrooms = [], tufts = [];
  const FLOWER_COLS = [[1.0, 0.55, 0.72], [1.0, 0.92, 0.45], [0.92, 0.9, 1.0], [0.72, 0.6, 1.0], [1.0, 0.7, 0.4]];
  const okGround = (x, y) => Math.abs(sample(hf.BV, x, y)) < 0.08 && sample(hf.RV, x, y) > 1.12 && nav.brushAt(x, y) < 0 && Math.abs(sample(hf.PV, x, y)) < 0.05;
  const fsp = Q.decoSp;
  for (let gy = 0; gy < 15000; gy += fsp) {
    for (let gx = 0; gx < 15000; gx += fsp) {
      const x = gx + rnd() * fsp, y = gy + rnd() * fsp;
      const s = hf.sdfAt(x, y);
      if (s > -25) continue;
      const u = rnd();
      if (s > -230 && u < 0.3) {
        if (!okGround(x, y) || laneDist(x, y) < 400) continue;
        const c = FLOWER_COLS[(rnd() * FLOWER_COLS.length) | 0];
        flowers.push({ x, y, h: heightAt(x, y), rot: rnd() * 6.28, s: 0.8 + rnd() * 0.7, c });
      } else if (s > -90 && u < 0.36) {
        if (!okGround(x, y) || laneDist(x, y) < 650) continue;
        mushrooms.push({ x, y, h: heightAt(x, y), rot: rnd() * 6.28, s: 0.8 + rnd() * 0.8, c: [1, 1, 1] });
      }
    }
  }
  const tsp = Q.tuftSp;
  for (let gy = 0; gy < 15000; gy += tsp) {
    for (let gx = 0; gx < 15000; gx += tsp) {
      const x = gx + rnd() * tsp, y = gy + rnd() * tsp;
      const s = hf.sdfAt(x, y);
      if (s > -30 || rnd() > 0.55) continue;
      if (!okGround(x, y) || laneDist(x, y) < 360) continue;
      const g = 0.85 + rnd() * 0.3;
      tufts.push({ x, y, h: heightAt(x, y) - 2, rot: rnd() * 6.28, s: 0.75 + rnd() * 0.6, c: [g, g, g * 0.95] });
    }
  }
  return { trees, rocks, flowers, mushrooms, tufts };
}

/** 草丛草叶：多边形内抖动网格布点（边缘略矮），返回 [{ id, items }] */
export function scatterBrushes(md, hf, Q, pointInPoly) {
  const rnd = mulberry32(0xb125);
  const out = [];
  for (const b of md.BRUSHES || []) {
    if (!b.poly || b.poly.length < 3) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of b.poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const items = [];
    const sp = Q.brushSp;
    for (let y = y0; y <= y1; y += sp) {
      for (let x = x0; x <= x1; x += sp) {
        const px = x + (rnd() - 0.5) * sp * 0.9, py = y + (rnd() - 0.5) * sp * 0.9;
        if (!pointInPoly(px, py, b.poly)) continue;
        // 到边界距离 → 边缘更矮
        let d = 1e9;
        for (let i = 0, j = b.poly.length - 1; i < b.poly.length; j = i++) d = Math.min(d, segDist(px, py, b.poly[j], b.poly[i]));
        const edge = Math.min(1, d / 90);
        const g = 0.88 + rnd() * 0.24;
        items.push({ x: px, y: py, h: hf.heightAt(px, py) - 3, rot: rnd() * 6.28, s: (0.62 + 0.38 * edge) * (0.85 + rnd() * 0.3), sy: 0.9 + rnd() * 0.25, c: [g, g, g * (0.9 + rnd() * 0.15)] });
      }
    }
    out.push({ id: b.id, items });
  }
  return out;
}
function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y);
}
