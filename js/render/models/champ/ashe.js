// 英雄模型 · 艾希（寒冰射手）：蓝色兜帽 + 白色毛边、银色额饰、白色长发（背后长发片 + 前侧两缕）、毛领长披风、银色胸甲与护腕、
// 冰晶长弓（左手，发光冰蓝）+ 动态弓弦 + 拉弓时右手凝出的冰箭（叠加物）；拉弓射箭动画（bow 风格，anim.windup 时满弦）。
// modelState：focus（射手专注：冰蓝边缘光）
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import * as THREE from 'three';
import { geo, PI, TAU } from './kit.js';
import { addMat, glowSprite, cachedGeo } from './materials.js';
import { humanoid, hairCap, hairSheet, cape, linePts, ringY } from './rig.js';

// 弓弦：两端固定于弓梢，拉弓时中点跟随右手
function bowString(v, boneName, tipX, tipY, color) {
  const pos = new Float32Array(9);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false }));
  line.frustumCulled = false;
  v.bones[boneName].add(line);
  const tmp = new THREE.Vector3();
  return {
    update(v2) {
      line.visible = v2.opacity > 0.5;
      pos[0] = -tipX; pos[1] = tipY; pos[2] = 0;
      pos[6] = tipX; pos[7] = tipY; pos[8] = 0;
      if (v2.drawString > 0.01) {
        v2.bones.hdR.getWorldPosition(tmp);
        v2.bones[boneName].worldToLocal(tmp);
        const k = v2.drawString;
        pos[3] = tmp.x * k; pos[4] = tipY + (tmp.y - tipY) * k; pos[5] = tmp.z * k;
      } else { pos[3] = 0; pos[4] = tipY; pos[5] = 0; }
      g.attributes.position.needsUpdate = true;
    },
    dispose() { g.dispose(); line.material.dispose(); },
  };
}

// 冰箭：拉弦时从弓弦中点（右手）指向弓身前方，满弦时最亮
function iceArrow(v, boneName, U, color) {
  const shaftG = cachedGeo('asheArrow', () => { const g = new THREE.CylinderGeometry(0.9, 0.9, 1, 5, 1); g.translate(0, 0.5, 0); return g; });
  const headG = cachedGeo('asheArrowHead', () => new THREE.OctahedronGeometry(1));
  const grp = new THREE.Group();
  const shaft = new THREE.Mesh(shaftG, addMat(color, 0.9));
  const head = new THREE.Mesh(headG, addMat(0xe8fcff, 0.95));
  const spr = glowSprite(color, 30 * U, 0.8);
  grp.add(shaft, head, spr);
  grp.visible = false;
  v.bones[boneName].add(grp);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  return {
    update(v2) {
      const k = v2.drawString;
      grp.visible = k > 0.2 && v2.opacity > 0.5;
      if (!grp.visible) return;
      v2.bones.hdR.getWorldPosition(a);
      v2.bones[boneName].worldToLocal(a);
      b.set(0, -18 * U, 0);                      // 箭头越过弓身（弓的 -Y 为射出方向）
      d.subVectors(b, a);
      const len = d.length();
      grp.position.copy(a);
      grp.quaternion.setFromUnitVectors(up, d.normalize());
      shaft.scale.set(U, len, U);
      head.position.set(0, len, 0);
      head.scale.set(2.4 * U, 6 * U, 2.4 * U);
      spr.position.set(0, len, 0);
      spr.scale.setScalar(30 * U * (0.6 + 0.6 * k));
    },
  };
}

export function build(bp, def) {
  const H = 210, U = H / 220;
  const C = { skin: 0xf6dccc, hair: 0xf0f2fa, blue: 0x2c52a0, blueD: 0x1a2c5a, silver: 0xb4c6e0, fur: 0xf2f6fa, ice: 0x9ae8ff, glove: 0x24345e };
  const M = humanoid(bp, {
    H, female: true, bulk: 0.9, skin: C.skin, eye: 0x6ab8ff, brow: 0xd8dce8, fist: true,
    c: { chest: C.silver, belly: C.blueD, pelvis: C.blueD, ua: C.blue, fa: C.silver, hand: C.glove, th: 0x283456, sn: C.fur, foot: C.silver, bust: C.silver },
  });
  const R = M.headR, hc = M.headC;
  // 胸甲细节
  bp.add('chest', geo.lathe([[0.07 * H, -0.06 * H], [0.084 * H, -0.02 * H], [0.08 * H, 0.01 * H]], 14), C.blue, { s: [0.72, 1, 0.92] });
  bp.add('chest', geo.oct(3.6 * U), C.ice, { p: [0.062 * H, 0.05 * H, 0], s: [0.6, 1.3, 1], glow: 1.4 });
  bp.pair('ua', geo.sph(0.05 * H, 10, 8), C.fur, { p: [0, 0.01 * H, 0.004 * H], s: [1.1, 0.8, 1] });
  bp.pair('ua', geo.sphPart(12 * U, 0, TAU, 0, PI * 0.5, 12, 5), C.silver, { p: [0, 1 * U, 3 * U], r: [0.4, 0, 0], s: [1, 0.7, 1], shine: 0.7 });
  bp.pair('fa', geo.cyl(0.03 * H, 0.034 * H, 0.012 * H, 10), C.fur, { p: [0, -0.005 * H, 0] });
  // 银色护腕 + 胸前冰晶胸针 + 腰带
  bp.pair('fa', geo.cyl(0.031 * H, 0.027 * H, 0.08 * H, 10), C.silver, { p: [0, -0.085 * H, 0], shine: 0.8 });
  bp.pair('fa', geo.oct(2.4 * U), C.ice, { p: [0.03 * H, -0.085 * H, 0], s: [0.6, 1.2, 1], glow: 1.2 });
  bp.add('chest', geo.tor(3.6 * U, 1.1 * U, 5, 12), C.silver, { p: [0.066 * H, 0.085 * H, 0], r: [0, PI / 2, 0], shine: 0.9 });
  bp.add('hips', geo.box(2 * U, 5 * U, 7 * U), C.silver, { p: [0.062 * H, 0.05 * H, 0], shine: 1 });
  bp.add('hips', geo.oct(2.6 * U), C.ice, { p: [0.066 * H, 0.05 * H, 0], glow: 1.3 });
  // 前摆
  bp.add('hips', ringY(0.078 * H, 2 * U), C.silver, { p: [0, 0.05 * H, 0], s: [0.78, 1, 1.1], shine: 0.7 });
  const fr = bp.chain('robeF', 'hips', linePts([0.06 * H, 0.03 * H, 0], [0.065 * H, 0.03 * H - 0.24 * H, 0], 2));
  bp.add(fr[0], geo.cloth(0.08 * H, 0.1 * H, 0.28 * H, -0.008 * H, 3, 4), C.blue, { r: [0, PI, 0], chain: fr, c2: C.blueD });
  const rb = bp.chain('robeB', 'hips', linePts([-0.062 * H, 0.03 * H, 0], [-0.07 * H, 0.03 * H - 0.26 * H, 0], 2));
  bp.add(rb[0], geo.cloth(0.12 * H, 0.16 * H, 0.3 * H, 0.012 * H, 3, 4), C.blueD, { chain: rb, c2: C.blue });
  bp.pair('sn', ringY(0.04 * H, 2.6 * U), C.fur, { p: [0, -0.01 * H, 0] });
  bp.pair('sn', geo.cyl(0.036 * H, 0.03 * H, 0.11 * H, 10), C.silver, { p: [0, -0.14 * H, 0], shine: 0.6 });
  // 白色长发（前侧两缕 + 背片）
  hairCap(bp, M, C.hair, { vol: 1.08, back: 0.72, c2: 0xdce4f4 });
  const hb = hairSheet(bp, M, 'hairB', C.hair, 0.34 * H, R * 1.5, R * 1.9, 0xdce4f4);
  for (const s of [-1, 1]) {
    bp.add('head', geo.tube([[hc[0] + R * 0.5, hc[1] + R * 0.1, s * R * 0.9], [hc[0] + R * 0.6, hc[1] - R * 1.4, s * R * 1.05], [hc[0] + R * 0.9, hc[1] - R * 3.0, s * R * 0.8]], (t) => (5.5 - 3 * t) * U, 10, 6), C.hair);
  }
  // 兜帽（蓝色外层 + 白色毛边）
  bp.add('head', geo.sphPart(R * 1.3, -PI * 0.58, PI * 1.16, 0, PI * 0.72, 16, 8), C.blue, { p: [hc[0] - R * 0.12, hc[1] + R * 0.06, 0], s: [1.05, 1.08, 1.02], c2: 0x3a64b8 });
  bp.add('head', geo.cone(R * 0.2, R * 0.75, 4), C.silver, { p: [hc[0] + R * 1.12, hc[1] + R * 0.72, 0], r: [0, 0, -0.5], shine: 1 });
  bp.add('head', geo.oct(R * 0.13), C.ice, { p: [hc[0] + R * 1.06, hc[1] + R * 0.5, 0], glow: 1.6 });
  bp.add('head', geo.tor(R * 1.1, 3.2 * U, 6, 18, PI * 1.25), C.fur, { p: [hc[0] + R * 0.55, hc[1] - R * 0.05, 0], r: [0, PI / 2, PI * 0.12], s: [1, 1.12, 1] });
  // 披风（长、毛领）
  bp.add('chest', ringY(0.07 * H, 5 * U), C.fur, { p: [0, 0.1 * H, 0], s: [0.9, 1, 1.15] });
  const cp = cape(bp, 'chest', linePts([-0.07 * H, 0.1 * H, 0], [-0.08 * H, 0.1 * H - 0.54 * H, 0], 3), C.blue, C.blueD,
    { wTop: 0.2 * H, wBot: 0.32 * H, len: 0.6 * H, bulge: 0.03 * H });
  // 冰晶长弓（左手，沿 X 为弓臂，+Y 朝向射手）
  const w = 'wpL';
  const bowPts = [];
  for (let i = 0; i <= 8; i++) {
    const x = -84 + (168 * i) / 8;
    bowPts.push([x * U, (24 * Math.pow(Math.abs(x) / 84, 2.2) - 3 - 6 * Math.pow(Math.abs(x) / 84, 8)) * U, 0]);
  }
  bp.add(w, geo.tube(bowPts, (t) => (1.6 + 2.6 * Math.pow(Math.sin(PI * t), 0.6)) * U, 24, 6), C.ice, { glow: 0.85, shine: 0.6 });
  bp.add(w, geo.box(12 * U, 5 * U, 5 * U), C.silver, { p: [0, -2 * U, 0], shine: 0.8 });
  for (const s of [-1, 1]) {
    bp.add(w, geo.oct(5 * U), 0xd8f8ff, { p: [s * 86 * U, 20 * U, 0], s: [1.8, 0.6, 0.6], glow: 1.4 });
    bp.add(w, geo.oct(4 * U), C.ice, { p: [s * 30 * U, -6 * U, 0], s: [1, 2.2, 0.6], r: [0, 0, s * 0.6], glow: 1.1 });
    bp.add(w, geo.oct(3 * U), 0xd8f8ff, { p: [s * 58 * U, 2 * U, 0], s: [0.8, 2, 0.6], r: [0, 0, s * 0.9], glow: 1.3 });
  }
  const tipY = (24 - 3 - 6) * U;
  bp.meta.style = 'bow';
  bp.meta.height = 218;
  bp.meta.bow = { tipX: 84 * U, tipY };
  bp.meta.chains = [{ names: cp, kind: 'cape' }, { names: fr, kind: 'skirtF' }, { names: rb, kind: 'skirtB' }, { names: hb, kind: 'hair', amp: 0.8 }];
  bp.meta.rim = (ms) => (ms.focus ? { rim: 0x9ae8ff, rimI: 0.45 } : null);
  bp.overlays.push((v) => bowString(v, 'wpL', 84 * U, tipY, C.ice));
  bp.overlays.push((v) => iceArrow(v, 'wpL', U, C.ice));
  // 弓臂中段冰光
  bp.overlays.push((v) => {
    const s = glowSprite(C.ice, 44 * U, 0.55);
    s.position.set(0, 4 * U, 0);
    v.bones.wpL.add(s);
    return { update(v2, e) { s.visible = v2.opacity > 0.5; s.scale.setScalar(44 * U * (e.modelState?.focus ? 1.5 : 1) * (1 + 0.08 * Math.sin(v2.time * 3))); } };
  });
}
