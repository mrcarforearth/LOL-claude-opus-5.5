// 英雄模型 · 提伯斯（安妮 R 召唤的巨熊，modelId 'tibbers'）：黑紫色巨熊、纽扣眼、发光缝线、身上火焰光效
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import * as THREE from 'three';
import { geo, PI } from './kit.js';
import { addMat, glowSprite, cachedGeo } from './materials.js';
import { humanoid } from './rig.js';

export function build(bp, def) {
  const H = 330, U = H / 220;
  const C = { fur: 0x2c2032, fur2: 0x46305a, belly: 0x6a5a78, muzzle: 0x8a7a8c, claw: 0xe8dcc0, fire: 0xff7a24, seam: 0xffa040 };
  const M = humanoid(bp, {
    H, bulk: 1.5, slim: 1.55, skin: C.fur, noFace: true, depth: 0.9, armR: 0.05, legR: 0.064, headScale: 1,
    prop: { leg: 0.32, torso: 0.36, head: 0.13, shoulder: 0.15, hipW: 0.075, arm: 0.42, neck: 0.012 },
    c: { chest: C.fur, belly: C.fur2, pelvis: C.fur, ua: C.fur, fa: C.fur2, hand: C.fur, th: C.fur, sn: C.fur2, foot: C.fur },
  });
  const R = M.headR, hc = M.headC;
  // 大肚腩 + 缝线（发光）
  bp.add('spine', geo.sph(0.12 * H, 14, 10), C.fur2, { p: [0.03 * H, 0.03 * H, 0], s: [0.85, 1, 1.05] });
  bp.add('spine', geo.sph(0.09 * H, 12, 8), C.belly, { p: [0.058 * H, 0.03 * H, 0], s: [0.6, 1, 0.95] });
  for (let i = 0; i < 5; i++) bp.add('spine', geo.box(1.4 * U, 1.4 * U, 8 * U), C.seam, { p: [0.105 * H, (0.075 - i * 0.022) * H, 0], glow: 1.6 });
  bp.add('spine', geo.box(1.4 * U, 0.1 * H, 1.4 * U), C.seam, { p: [0.106 * H, 0.03 * H, 0], glow: 1.6 });
  bp.pair('ua', geo.box(1.4 * U, 1.4 * U, 0.05 * H), C.seam, { p: [0.04 * H, -0.08 * H, 0], glow: 1.4 });
  // 头部：口鼻、纽扣眼、耳朵、毛簇
  bp.add('head', geo.sph(R * 0.62, 12, 8), C.muzzle, { p: [hc[0] + R * 0.72, hc[1] - R * 0.3, 0], s: [0.9, 0.7, 1] });
  bp.add('head', geo.sph(R * 0.2, 8, 6), 0x0e080e, { p: [hc[0] + R * 1.25, hc[1] - R * 0.18, 0], s: [0.8, 0.7, 1.1] });
  bp.add('head', geo.box(R * 0.06, R * 0.06, R * 0.7), 0x1a0e18, { p: [hc[0] + R * 1.18, hc[1] - R * 0.58, 0] });
  for (let i = -2; i <= 2; i++) bp.add('head', geo.box(R * 0.05, R * 0.2, R * 0.04), C.seam, { p: [hc[0] + R * 1.18, hc[1] - R * 0.58, i * R * 0.13], glow: 1.4 });
  bp.add('head', geo.cyl(R * 0.26, R * 0.26, R * 0.1, 12), 0xd8d4cc, { p: [hc[0] + R * 0.8, hc[1] + R * 0.28, R * 0.42], r: [0, 0, PI / 2], shine: 0.4 });
  for (const [dy, dz] of [[0.07, 0.07], [0.07, -0.07], [-0.07, 0.07], [-0.07, -0.07]]) bp.add('head', geo.sph(R * 0.045, 4, 3), 0x3a3a3a, { p: [hc[0] + R * 0.86, hc[1] + R * (0.28 + dy), R * (0.42 + dz)] });
  bp.add('head', geo.sph(R * 0.2, 10, 8), C.fire, { p: [hc[0] + R * 0.82, hc[1] + R * 0.28, -R * 0.42], s: [0.5, 1, 1], glow: 2.6 });
  for (const s of [-1, 1]) {
    bp.add('head', geo.sph(R * 0.38, 10, 8), C.fur, { p: [hc[0] - R * 0.15, hc[1] + R * 0.85, s * R * 0.72], s: [0.6, 1, 1] });
    bp.add('head', geo.sph(R * 0.24, 8, 6), C.belly, { p: [hc[0] - R * 0.02, hc[1] + R * 0.85, s * R * 0.72], s: [0.4, 0.8, 0.8] });
  }
  for (let i = 0; i < 5; i++) bp.add('head', geo.cone(R * 0.2, R * 0.55, 5), C.fur2, { p: [hc[0] - R * (0.2 + i * 0.25), hc[1] + R * (1.0 - i * 0.12), 0], r: [0, 0, 0.5 + i * 0.25] });
  // 肩背毛簇、利爪、大脚掌
  for (let i = 0; i < 6; i++) {
    const a = (i / 5 - 0.5) * 2.2;
    bp.add('chest', geo.cone(0.03 * H, 0.08 * H, 5), C.fur2, { p: [-0.07 * H, 0.08 * H + Math.cos(a) * 0.02 * H, Math.sin(a) * 0.1 * H], r: [Math.sin(a) * 0.6, 0, 0.8] });
  }
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    for (let j = -1; j <= 1; j++) bp.add('hd' + sd, geo.cone(2.6 * U, 12 * U, 5), C.claw, { p: [0.02 * H, -0.05 * H, s * j * 0.012 * H], r: [0, 0, -2.6] });
    bp.add('ft' + sd, geo.sph(0.04 * H, 10, 8), C.fur, { p: [0.03 * H, -0.02 * H, 0], s: [1.6, 0.7, 1.1] });
    for (let j = -1; j <= 1; j++) bp.add('ft' + sd, geo.cone(2.2 * U, 8 * U, 4), C.claw, { p: [0.09 * H, -0.03 * H, j * 0.02 * H], r: [0, 0, -PI / 2] });
  }
  bp.meta.style = 'brute';
  bp.meta.height = 330;
  bp.meta.chains = [];
  bp.meta.rim = () => ({ rim: 0xff6a20, rimI: 0.3 });
  // 火焰（加色锥体，逐帧跳动）
  bp.overlays.push((v) => {
    const g = cachedGeo('tibFlame', () => { const c = new THREE.ConeGeometry(1, 2.4, 7, 1, true); c.translate(0, 1.2, 0); return c; });
    const mOut = addMat(0xff6a1a, 0.55), mIn = addMat(0xffd060, 0.7);
    const spots = [['chest', -0.06, 0.12, 0.1, 1.2], ['chest', -0.06, 0.12, -0.1, 1.2], ['chest', -0.09, 0.06, 0, 1.4], ['head', -0.02, 0.25, 0, 0.9], ['uaR', 0, 0.02, 0.03, 0.9], ['uaL', 0, 0.02, -0.03, 0.9]];
    const flames = spots.map(([bn, x, y, z, s], i) => {
      const grp = new THREE.Group();
      const o = new THREE.Mesh(g, mOut), n = new THREE.Mesh(g, mIn);
      n.scale.set(0.55, 0.7, 0.55);
      grp.add(o, n);
      grp.position.set(x * H, y * H, z * H);
      grp.userData = { s: s * 0.07 * H, ph: i * 1.7 };
      v.bones[bn].add(grp);
      return grp;
    });
    const glow = glowSprite(0xff7a2a, 0.9 * H, 0.35);
    glow.position.set(0, 0.62 * H, 0);
    v.mover.add(glow);
    return {
      update(v2) {
        const on = v2.opacity > 0.5 && !v2.dead;
        glow.visible = on;
        for (const f of flames) {
          f.visible = on;
          if (!on) continue;
          const t = v2.time * 9 + f.userData.ph;
          const k = f.userData.s * (0.85 + 0.25 * Math.sin(t) + 0.12 * Math.sin(t * 2.7));
          f.scale.set(k * 0.8, k * (1 + 0.3 * Math.sin(t * 1.9)), k * 0.8);
          f.rotation.y = t * 0.3;
        }
      },
    };
  });
}

