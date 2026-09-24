// 基地与地标：基地围墙与城垛、泉水平台（护栏/灯柱/符文）、枢纽广场符文、DECOR.props（雕像/火盆/晶柱/路灯）、龙坑氛围、地面光斑
import * as THREE from 'three';
import { mergeParts, M, lin, THEMES, statueGeo, brazierGeo, pillarGeo, lanternGeo } from './geo.js';
import { staticMaterial, glowMaterial } from './matpatch.js';
import { mulberry32 } from './noise.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();

function instanced(parent, geo, mat, list, { cast = false, name = 'landmark' } = {}) {
  if (!list.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((it, i) => {
    _p.set(it.x, it.h, -it.y);
    _q.setFromEuler(_e.set(it.rx || 0, it.rot || 0, 0));
    _s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.sx ?? it.s ?? 1);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    if (it.c != null) mesh.setColorAt(i, typeof it.c === 'number' ? _c.setHex(it.c) : _c.setRGB(it.c[0], it.c[1], it.c[2]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = cast;
  mesh.receiveShadow = false;
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

/**
 * 构建地标。返回 { update(t, dt) }。
 * ctx: { group, hf, md, Q, glowTex, runeTex, shadows }
 */
export function buildLandmarks(ctx) {
  const { group, hf, md, Q, glowTex, runeTex } = ctx;
  const H = hf.heightAt;
  const rnd = mulberry32(4242);
  const stoneMat = staticMaterial('stone');
  const anim = [];
  const glows = [];            // 地面光斑 { x, y, r, c }
  const crystals = [];         // 发光水晶 { x, y, h, s, sx, c, bob, spin }
  const decor = md.DECOR || {};

  // ================= 基地围墙与城垛 =================
  const wallParts = [];
  for (const b of decor.bases || []) {
    const T = THEMES[b.team] || THEMES[2];
    const cx = b.nexus.x, cy = b.nexus.y;
    const lines = b.walls || [];
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = line[i], [bx, by] = line[i + 1];
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 20) continue;
        const tx = (bx - ax) / L, ty = (by - ay) / L;
        let nx = -ty, ny = tx;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }   // 法线朝基地外
        const ox = mx + nx * 55, oy = my + ny * 55;
        const base = Math.min(H(ax + nx * 55, ay + ny * 55), H(bx + nx * 55, by + ny * 55), H(ox, oy)) - 12;
        const rot = Math.atan2(ty, tx);   // 局部 X 沿墙
        const wh = 150;
        const pm = (lx, ly, lz, w, h, d, color) => {
          const px = ox + tx * lx + nx * lz, py = oy + ty * lx + ny * lz;
          wallParts.push({ geo: new THREE.BoxGeometry(w, h, d), m: M(px, base + ly, -py, 1, 1, 1, 0, rot, 0), color });
        };
        pm(0, 20, -8, L + 30, 40, 130, T.stoneDark);             // 墙基
        pm(0, 40 + wh / 2, 0, L + 10, wh, 90, T.stone);          // 墙身
        pm(0, 40 + wh + 7, 0, L + 16, 14, 104, T.trim);          // 压顶饰带
        const nM = Math.max(1, Math.floor(L / 105));
        for (let k = 0; k < nM; k++) {                           // 城垛
          const lx = -L / 2 + (k + 0.5) * (L / nM);
          pm(lx, 40 + wh + 14 + 26, -22, 58, 52, 40, T.stone);
        }
      }
      // 折点塔楼 + 顶部水晶
      for (let i = 0; i < line.length; i++) {
        const [px, py] = line[i];
        let nx = px - cx, ny = py - cy; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const x = px + nx * 55, y = py + ny * 55;
        const base = H(x, y) - 12;
        wallParts.push({ geo: new THREE.CylinderGeometry(84, 98, 250, 8), m: M(x, base + 125, -y), color: T.stone });
        wallParts.push({ geo: new THREE.CylinderGeometry(100, 100, 18, 8), m: M(x, base + 250, -y), color: T.trim });
        wallParts.push({ geo: new THREE.CylinderGeometry(74, 90, 40, 8), m: M(x, base + 278, -y), color: T.stoneDark });
        crystals.push({ x, y, h: base + 360, s: 1, sx: 26, sy: 62, c: T.crystal, bob: rnd() * 6, spin: 0.6 });
        glows.push({ x, y, r: 360, c: T.glow, a: 0.35 });
      }
    }

    // ================= 泉水平台 =================
    const fo = b.fountain;
    const toNex = Math.atan2(cy - fo.y, cx - fo.x);
    const fh = H(fo.x, fo.y);
    const seg = 40;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      let da = Math.abs(a - toNex) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.75) continue;                                   // 面向基地的出口
      const r = fo.r - 28;
      const x = fo.x + Math.cos(a) * r, y = fo.y + Math.sin(a) * r;
      const len = (2 * Math.PI * r) / seg + 6;
      wallParts.push({ geo: new THREE.BoxGeometry(len, 46, 54), m: M(x, fh + 20, -y, 1, 1, 1, 0, a + Math.PI / 2, 0), color: T.stone });
      wallParts.push({ geo: new THREE.BoxGeometry(len + 2, 10, 62), m: M(x, fh + 46, -y, 1, 1, 1, 0, a + Math.PI / 2, 0), color: T.trim });
    }
    for (let i = 0; i < 6; i++) {                                // 背侧灯柱
      const a = toNex + Math.PI + ((i - 2.5) / 2.5) * 1.9;
      const r = fo.r - 90;
      const x = fo.x + Math.cos(a) * r, y = fo.y + Math.sin(a) * r;
      wallParts.push({ geo: new THREE.CylinderGeometry(40, 56, 300, 8), m: M(x, fh + 150, -y), color: T.stone });
      wallParts.push({ geo: new THREE.CylinderGeometry(62, 62, 16, 8), m: M(x, fh + 300, -y), color: T.trim });
      crystals.push({ x, y, h: fh + 380, s: 1, sx: 24, sy: 58, c: T.crystal, bob: i * 1.1, spin: 0.8 });
      glows.push({ x, y, r: 300, c: T.glow, a: 0.45 });
    }
    // 泉水符文（自转）与泉池光
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial('rune', { map: runeTex, color: T.glow, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    rune.rotation.x = -Math.PI / 2;
    rune.scale.set(fo.r * 1.72, fo.r * 1.72, 1);
    rune.position.set(fo.x, fh + 3, -fo.y);
    rune.renderOrder = 3;
    group.add(rune);
    anim.push((t) => { rune.rotation.z = t * 0.05; rune.material.opacity = 0.7 + 0.2 * Math.sin(t * 1.6); });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial('pool', { map: glowTex, color: T.glow, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(fo.pool * 2.6, fo.pool * 2.6, 1);
    pool.position.set(fo.x, fh + 4, -fo.y);
    pool.renderOrder = 3;
    group.add(pool);
    anim.push((t) => { const k = 1 + 0.06 * Math.sin(t * 2.2); pool.scale.set(fo.pool * 2.6 * k, fo.pool * 2.6 * k, 1); });

    // ================= 枢纽广场符文 =================
    const pl = b.plaza;
    const ph = H(pl.x, pl.y);
    const prune = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial('rune2', { map: runeTex, color: T.glow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    prune.rotation.x = -Math.PI / 2;
    prune.scale.set(pl.r * 1.5, pl.r * 1.5, 1);
    prune.position.set(pl.x, ph + 3, -pl.y);
    prune.renderOrder = 3;
    group.add(prune);
    anim.push((t) => { prune.rotation.z = -t * 0.03; });
  }
  if (wallParts.length) {
    const walls = new THREE.Mesh(mergeParts(wallParts), stoneMat);
    walls.name = 'base-walls';
    walls.castShadow = ctx.shadows;
    walls.receiveShadow = ctx.shadows;
    group.add(walls);
  }

  // ================= DECOR.props =================
  const byKind = {};
  for (const p of decor.props || []) {
    const key = p.kind + ':' + (p.team ?? 2);
    (byKind[key] = byKind[key] || []).push(p);
  }
  const flames = [];
  for (const [key, list] of Object.entries(byKind)) {
    const [kind, ts] = key.split(':');
    const team = Number(ts);
    const T = THEMES[team] || THEMES[2];
    let geo = null;
    if (kind === 'statue') geo = statueGeo(team);
    else if (kind === 'brazier') geo = brazierGeo(team);
    else if (kind === 'crystalPillar') geo = pillarGeo(team);
    else if (kind === 'lantern') geo = lanternGeo();
    if (!geo) continue;
    const items = list.map((p) => ({ x: p.x, y: p.y, h: H(p.x, p.y) - 4, rot: p.facing || 0, s: p.scale || 1 }));
    instanced(group, geo, stoneMat, items, { cast: ctx.shadows, name: 'prop-' + kind });
    for (const p of list) {
      const s = p.scale || 1, h = H(p.x, p.y), f = p.facing || 0;
      if (kind === 'brazier') {
        flames.push({ x: p.x, y: p.y, h: h + 160 * s, s, ph: rnd() * 6 });
        glows.push({ x: p.x, y: p.y, r: 520 * s, c: 0xff9a3a, a: 0.55 });
      } else if (kind === 'crystalPillar') {
        crystals.push({ x: p.x, y: p.y, h: h + 360 * s, s, sx: 42, sy: 120, c: T.crystal, bob: rnd() * 6, spin: 0.5 });
        glows.push({ x: p.x, y: p.y, r: 520 * s, c: T.glow, a: 0.5 });
      } else if (kind === 'lantern') {
        const lx = p.x + Math.cos(f) * 66 * s, ly = p.y + Math.sin(f) * 66 * s;
        crystals.push({ x: lx, y: ly, h: h + 201 * s, s, sx: 13, sy: 17, c: 0xffd27a, box: true, rot: f });
        glows.push({ x: lx, y: ly, r: 380 * s, c: 0xffc86a, a: 0.5 });
      } else if (kind === 'statue') {
        glows.push({ x: p.x, y: p.y, r: 300 * s, c: T.glow, a: 0.2 });
      }
    }
  }

  // ================= 龙坑氛围 =================
  const pits = decor.pits || {};
  if (pits.baron) {
    const p = pits.baron;
    glows.push({ x: p.x, y: p.y, r: p.r * 1.9, c: 0x8a3cd8, a: 0.5 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd() * 0.2;
      const ma = Math.atan2(p.mouth.y - p.y, p.mouth.x - p.x);
      let da = Math.abs(a - ma) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.6) continue;
      const r = p.r + 60 + rnd() * 80;
      const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      const s = 0.7 + rnd() * 0.8;
      crystals.push({ x, y, h: H(x, y) + 60 * s, s, sx: 30, sy: 120, c: 0xb45cff, rx: (rnd() - 0.5) * 0.6, spin: 0 });
    }
  }
  if (pits.dragon) {
    const p = pits.dragon;
    glows.push({ x: p.x, y: p.y, r: p.r * 1.5, c: 0xff8a3a, a: 0.22 });
  }

  // ================= 水晶（发光） =================
  const crystalMat = glowMaterial('crystal', { color: 0xffffff });
  const octa = new THREE.OctahedronGeometry(1, 0);
  const boxG = new THREE.BoxGeometry(1, 1, 1);
  const cList = crystals.filter((c) => !c.box), bList = crystals.filter((c) => c.box);
  const toItems = (arr) => arr.map((c) => ({ x: c.x, y: c.y, h: c.h, rot: c.rot || 0, rx: c.rx || 0, sx: c.sx * c.s, sy: c.sy * c.s, c: lin(c.c, 1.6) }));
  const cMesh = instanced(group, octa, crystalMat, toItems(cList), { name: 'crystals' });
  instanced(group, boxG, crystalMat, toItems(bList), { name: 'lamps' });
  if (cMesh) {
    anim.push((t) => {
      for (let i = 0; i < cList.length; i++) {
        const c = cList[i];
        if (!c.spin) continue;
        _p.set(c.x, c.h + Math.sin(t * 1.4 + c.bob) * 12, -c.y);
        _q.setFromEuler(_e.set(c.rx || 0, t * c.spin + c.bob, 0));
        _s.set(c.sx * c.s, c.sy * c.s, c.sx * c.s);
        cMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      cMesh.instanceMatrix.needsUpdate = true;
    });
  }

  // ================= 火焰 =================
  if (flames.length) {
    const fg = new THREE.ConeGeometry(1, 1, 7, 1, true);
    fg.translate(0, 0.5, 0);
    const fMat = glowMaterial('flame', { color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const outer = instanced(group, fg, fMat, flames.map((f) => ({ x: f.x, y: f.y, h: f.h, s: 1, sx: 46 * f.s, sy: 120 * f.s, c: lin(0xff7a22, 1.4) })), { name: 'flames' });
    const inner = instanced(group, fg, fMat, flames.map((f) => ({ x: f.x, y: f.y, h: f.h, s: 1, sx: 26 * f.s, sy: 80 * f.s, c: lin(0xffe08a, 1.6) })), { name: 'flames-core' });
    anim.push((t) => {
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        const k = 1 + 0.16 * Math.sin(t * 11 + f.ph) + 0.1 * Math.sin(t * 17.3 + f.ph * 2);
        _p.set(f.x, f.h, -f.y);
        _q.setFromEuler(_e.set(0, t * 2 + f.ph, 0));
        outer.setMatrixAt(i, _m.compose(_p, _q, _s.set(46 * f.s * (2 - k) , 120 * f.s * k, 46 * f.s * (2 - k))));
        inner.setMatrixAt(i, _m.compose(_p, _q, _s.set(26 * f.s, 80 * f.s * (0.9 + (k - 1) * 1.6), 26 * f.s)));
      }
      outer.instanceMatrix.needsUpdate = true;
      inner.instanceMatrix.needsUpdate = true;
    });
  }

  // ================= 地面光斑 =================
  if (glows.length) {
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.rotateX(-Math.PI / 2);
    const gMat = glowMaterial('glow', { map: glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const gm = instanced(group, pg, gMat, glows.map((g) => ({ x: g.x, y: g.y, h: H(g.x, g.y) + 6, sx: g.r * 2, sy: 1, sz: g.r * 2, c: lin(g.c, g.a) })), { name: 'ground-glows' });
    if (gm) gm.renderOrder = 3;
  }

  return { update(t) { for (const f of anim) f(t); } };
}
