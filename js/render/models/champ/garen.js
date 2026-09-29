// 英雄模型 · 盖伦（德玛西亚之力）：蓝金重甲、金色镶边、巨大宽刃剑、蓝色披风；modelState.swordGlow 剑发光、spinning 整体旋转
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import * as THREE from 'three';
import { geo, PI, TAU } from './kit.js';
import { addMat, cachedGeo } from './materials.js';
import { humanoid, hairCap, cape, linePts, cylX, ringY } from './rig.js';

export function build(bp, def) {
  const H = 238, U = H / 220;
  const C = { steel: 0xc3ccd8, steelD: 0x66728a, blue: 0x2f60c8, blueD: 0x1d3c86, gold: 0xf0c860, leather: 0x4a3222, skin: 0xe6b894, hair: 0x5a3a22 };
  const M = humanoid(bp, {
    H, bulk: 1.32, skin: C.skin, brow: C.hair, eye: 0x2a4a7a, armR: 0.043,
    c: { chest: C.blue, belly: C.steelD, pelvis: C.blueD, ua: C.steelD, fa: C.steel, hand: C.steelD, th: C.blueD, sn: C.steel, foot: C.steelD },
  });
  const R = M.headR, hc = M.headC;
  // 胸甲镶边与徽记
  bp.add('chest', ringY(0.095 * H, 1.8 * U), C.gold, { p: [0, -0.035 * H, 0], s: [0.7, 1, 1.32], shine: 0.8 });
  bp.add('chest', ringY(0.085 * H, 1.6 * U), C.gold, { p: [0, 0.075 * H, 0], s: [0.72, 1, 1.3], shine: 0.8 });
  bp.add('chest', geo.extrude([[0, 12], [7, 2], [16, 6], [9, -4], [0, -13], [-9, -4], [-16, 6], [-7, 2]].map(([x, y]) => [x * U, y * U]), 2.4 * U, 0.6 * U), C.gold,
    { p: [0.075 * H, 0.03 * H, 0], r: [0, PI / 2, 0], shine: 1 });
  bp.add('chest', geo.oct(3 * U), 0x7ab8ff, { p: [0.082 * H, 0.03 * H, 0], glow: 0.8 });
  // 护颈
  bp.add('chest', geo.cyl(0.058 * H, 0.08 * H, 0.04 * H, 14), C.steel, { p: [0, 0.1 * H, 0], s: [0.8, 1, 1], shine: 0.6 });
  bp.add('chest', ringY(0.06 * H, 1.3 * U), C.gold, { p: [0, 0.12 * H, 0], s: [0.8, 1, 1], shine: 0.8 });
  // 巨型肩甲（三层）
  bp.pair('ua', geo.sphPart(17 * U, 0, TAU, 0, PI * 0.52, 16, 7), C.blue, { p: [0, 5 * U, 3 * U], r: [0.32, 0, 0], s: [1.05, 0.9, 1.1] });
  bp.pair('ua', geo.tor(16.6 * U, 1.9 * U, 6, 20), C.gold, { p: [0, 4.4 * U, 3.3 * U], r: [PI / 2 + 0.32, 0, 0], s: [1.05, 1.1, 1], shine: 0.9 });
  bp.pair('ua', geo.sphPart(14 * U, 0, TAU, 0, PI * 0.5, 14, 6), C.steel, { p: [0, -3 * U, 6 * U], r: [0.55, 0, 0], s: [1, 0.8, 1], shine: 0.6 });
  bp.pair('ua', geo.cone(3 * U, 9 * U, 6), C.gold, { p: [0, 17 * U, 8 * U], r: [0.35, 0, 0], shine: 0.8 });
  // 臂铠、护手
  bp.pair('fa', geo.cyl(0.037 * H, 0.031 * H, 0.1 * H, 12), C.steel, { p: [0, -0.07 * H, 0], shine: 0.6 });
  bp.pair('fa', geo.tor(0.036 * H, 1.5 * U, 6, 16), C.gold, { p: [0, -0.024 * H, 0], r: [PI / 2, 0, 0], shine: 0.8 });
  // 腰带与裙甲
  bp.add('hips', ringY(0.084 * H, 2.4 * U), C.leather, { p: [0, 0.055 * H, 0], s: [0.72, 1, 1.25] });
  bp.add('hips', geo.box(6 * U, 6 * U, 3 * U), C.gold, { p: [0.062 * H, 0.055 * H, 0], shine: 1 });
  bp.add('hips', geo.box(2 * U, 0.12 * H, 0.085 * H), C.blue, { p: [0.068 * H, -0.035 * H, 0], r: [0, 0, 0.12] });
  bp.add('hips', geo.box(1.6 * U, 0.125 * H, 0.095 * H), C.gold, { p: [0.066 * H, -0.036 * H, 0], r: [0, 0, 0.12], shine: 0.8 });
  bp.add('hips', geo.box(2 * U, 0.13 * H, 0.1 * H), C.blueD, { p: [-0.066 * H, -0.04 * H, 0], r: [0, 0, -0.12] });
  bp.pair('th', geo.box(0.07 * H, 0.11 * H, 2 * U), C.steel, { p: [0.004 * H, -0.03 * H, 0.05 * H], r: [0.12, 0, 0], shine: 0.6 });
  bp.pair('th', geo.box(0.074 * H, 2 * U, 2.4 * U), C.gold, { p: [0.004 * H, -0.085 * H, 0.057 * H], r: [0.12, 0, 0], shine: 0.8 });
  // 护膝、靴
  bp.pair('sn', geo.sph(0.033 * H, 10, 8), C.steel, { p: [0.012 * H, 0.004 * H, 0], s: [1, 1.05, 0.95], shine: 0.7 });
  bp.pair('sn', geo.cone(3 * U, 8 * U, 6), C.gold, { p: [0.04 * H, 0.004 * H, 0], r: [0, 0, -PI / 2], shine: 0.8 });
  bp.pair('ft', geo.box(0.1 * H, 0.03 * H, 0.055 * H), C.steelD, { p: [0.024 * H, -0.03 * H, 0], shine: 0.5 });
  // 头盔（开面盔）+ 蓝色冠饰
  hairCap(bp, M, C.hair, { vol: 1.04, fringe: false, back: 0.6 });
  bp.add('head', geo.sphPart(R * 1.14, 0, TAU, 0, PI * 0.46, 18, 7), C.steel, { p: [hc[0] - R * 0.04, hc[1] + R * 0.03, 0], s: [1.04, 1.05, 0.98], shine: 0.8 });
  bp.add('head', geo.sphPart(R * 1.16, -PI / 2, PI, 0, PI * 0.7, 14, 8), C.steel, { p: [hc[0] - R * 0.06, hc[1], 0], s: [1, 1.05, 1], shine: 0.7 });
  bp.add('head', geo.tor(R * 1.12, 1.4 * U, 6, 22), C.gold, { p: [hc[0] - R * 0.03, hc[1] + R * 0.18, 0], r: [PI / 2, 0, 0], s: [1.04, 0.98, 1], shine: 0.9 });
  bp.pair('head', geo.box(R * 0.55, R * 0.8, 1.6 * U), C.steel, { p: [hc[0] + R * 0.18, hc[1] - R * 0.35, R * 0.98], r: [0, 0.18, 0], shine: 0.6 });
  bp.add('head', geo.tube([[R * 0.7, R * 1.05, 0], [0, R * 1.35, 0], [-R * 0.9, R * 1.05, 0], [-R * 1.35, R * 0.3, 0]], (t) => (4.2 - 2.5 * t) * U, 12, 6), C.blue, { p: hc });
  bp.add('head', geo.box(R * 0.2, R * 0.9, 1.6 * U), C.gold, { p: [hc[0] + R * 1.02, hc[1] + R * 0.35, 0], shine: 0.9 });
  // 披风
  const cp = cape(bp, 'chest', linePts([-0.075 * H, 0.095 * H, 0], [-0.085 * H, 0.095 * H - 0.46 * H, 0], 3), 0x2a52b8, 0x16306e,
    { wTop: 0.22 * H, wBot: 0.34 * H, len: 0.5 * H, bulge: 0.035 * H });
  // 巨剑（沿 +X）
  const w = 'wpR';
  bp.add(w, cylX(2.3 * U, 2.3 * U, 22 * U), C.blueD, { p: [0, 0, 0] });
  bp.add(w, geo.sph(4 * U, 10, 8), C.gold, { p: [-13 * U, 0, 0], shine: 1 });
  bp.add(w, geo.box(5 * U, 0.18 * H, 6 * U), C.gold, { p: [12 * U, 0, 0], shine: 1 });
  bp.add(w, geo.oct(3.4 * U), 0x7ab8ff, { p: [12 * U, 0, 3.4 * U], glow: 0.9 });
  const blade = [[14, -11.5], [150, -10], [178, 0], [150, 10], [14, 11.5]].map(([x, y]) => [x * U, y * U]);
  bp.add(w, geo.extrude(blade, 3.2 * U, 0.9 * U), 0xdfe6f0, { shine: 1 });
  bp.add(w, geo.box(118 * U, 3 * U, 5.4 * U), 0x7d8aa0, { p: [80 * U, 0, 0], shine: 0.6 });
  bp.meta.style = 'greatsword';
  bp.meta.height = 252;
  bp.meta.chains = [{ names: cp, kind: 'cape' }];
  bp.meta.rim = (ms) => (ms.swordGlow ? { rim: 0xffe08a, rimI: 0.45 } : null);
  bp.overlays.push((v) => {
    const g = cachedGeo('garenGlow', () => geo.extrude(blade.map(([x, y]) => [x, y * 1.35]), 6 * U, 2 * U));
    const m = new THREE.Mesh(g, addMat(0xffd878, 0.55));
    m.visible = false;
    v.bones.wpR.add(m);
    return {
      update(v2, e) {
        const on = !!e.modelState.swordGlow;
        m.visible = on && v2.opacity > 0.5;
        if (on) m.scale.set(1, 1 + 0.08 * Math.sin(v2.time * 14), 1);
      },
    };
  });
}
