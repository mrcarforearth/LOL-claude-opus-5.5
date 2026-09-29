// 英雄模型 · 德莱厄斯（诺克萨斯之手）：暗红黑重甲、尖刺肩甲、双刃巨斧、灰白短发；modelState.axeSpin 回旋、axeGlow/noxianMight 发光
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import * as THREE from 'three';
import { geo, PI, TAU } from './kit.js';
import { addMat, cachedGeo } from './materials.js';
import { humanoid, cape, linePts, cylX, ringY } from './rig.js';

export function build(bp, def) {
  const H = 244, U = H / 220;
  const C = { black: 0x26262c, dark: 0x3e3e48, steel: 0x7c808c, red: 0x9a1c20, redB: 0xd23a2a, skin: 0xc79c78, hair: 0xd8d6d0, wood: 0x3a2620, gold: 0xb89a5a };
  const M = humanoid(bp, {
    H, bulk: 1.36, skin: C.skin, brow: 0x9a9690, eye: 0x6a2a1a, armR: 0.045, legR: 0.056,
    c: { chest: C.black, belly: C.red, pelvis: C.black, ua: C.dark, fa: C.black, hand: C.dark, th: C.dark, sn: C.black, foot: C.black },
  });
  const R = M.headR, hc = M.headC;
  // 胸甲分层与诺克萨斯徽记
  bp.add('chest', geo.lathe([[0.07 * H, -0.02 * H], [0.11 * H, 0.03 * H], [0.108 * H, 0.075 * H], [0.07 * H, 0.105 * H]], 16), C.dark, { s: [0.72, 1, 1.36], shine: 0.5 });
  bp.add('chest', geo.extrude([[0, 14], [6, 4], [12, 8], [8, -2], [0, -12], [-8, -2], [-12, 8], [-6, 4]].map(([x, y]) => [x * U, y * U]), 2 * U, 0.5 * U), C.redB,
    { p: [0.08 * H, 0.035 * H, 0], r: [0, PI / 2, 0], glow: 0.25 });
  bp.add('chest', geo.cyl(0.06 * H, 0.085 * H, 0.05 * H, 12), C.black, { p: [0, 0.098 * H, 0], s: [0.85, 1, 1], shine: 0.4 });
  // 尖刺肩甲
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    const b = 'ua' + sd, mir = s < 0;
    bp.add(b, geo.sphPart(18 * U, 0, TAU, 0, PI * 0.55, 14, 7), C.black, { p: [0, 5 * U, 3 * U], r: [0.3, 0, 0], s: [1.1, 0.95, 1.15], mirror: mir, shine: 0.5 });
    bp.add(b, geo.tor(17.5 * U, 2 * U, 6, 18), C.red, { p: [0, 3.6 * U, 3.4 * U], r: [PI / 2 + 0.3, 0, 0], s: [1.1, 1.15, 1], mirror: mir });
    bp.add(b, geo.sphPart(15 * U, 0, TAU, 0, PI * 0.5, 12, 6), C.dark, { p: [0, -4 * U, 7 * U], r: [0.6, 0, 0], mirror: mir, shine: 0.5 });
    [[0, 22, 0.25, 15], [7, 17, 0.9, 11], [-8, 16, 0.75, 11], [0, 12, 1.3, 9]].forEach(([x, y, a, l]) =>
      bp.add(b, geo.cone(3.6 * U, l * U, 6), C.steel, { p: [x * U, y * U, (6 + a * 6) * U], r: [a, 0, x * -0.03], mirror: mir, shine: 0.8 }));
  }
  // 臂甲、腰部布甲
  bp.pair('fa', geo.cyl(0.04 * H, 0.032 * H, 0.1 * H, 10), C.dark, { p: [0, -0.07 * H, 0], shine: 0.5 });
  bp.pair('fa', geo.cone(2.4 * U, 8 * U, 5), C.steel, { p: [-0.02 * H, -0.05 * H, 0.03 * H], r: [0.6, 0, 1.2], shine: 0.8 });
  bp.add('hips', ringY(0.086 * H, 2.6 * U), C.dark, { p: [0, 0.05 * H, 0], s: [0.72, 1, 1.26], shine: 0.4 });
  bp.add('hips', geo.box(9 * U, 9 * U, 3 * U), C.steel, { p: [0.064 * H, 0.05 * H, 0], shine: 0.8 });
  bp.add('hips', geo.box(2 * U, 0.16 * H, 0.09 * H), C.red, { p: [0.068 * H, -0.05 * H, 0], r: [0, 0, 0.1] });
  bp.pair('th', geo.box(0.072 * H, 0.12 * H, 2 * U), C.black, { p: [0.004 * H, -0.035 * H, 0.052 * H], r: [0.12, 0, 0], shine: 0.4 });
  bp.pair('sn', geo.sph(0.034 * H, 10, 8), C.dark, { p: [0.012 * H, 0.004 * H, 0], shine: 0.5 });
  bp.pair('sn', geo.cone(3 * U, 10 * U, 5), C.steel, { p: [0.04 * H, 0.01 * H, 0], r: [0, 0, -PI / 2 + 0.3], shine: 0.8 });
  bp.pair('ft', geo.box(0.1 * H, 0.032 * H, 0.056 * H), C.black, { p: [0.024 * H, -0.03 * H, 0] });
  // 头：灰白短发 + 胡茬
  bp.add('head', geo.sphPart(R * 1.07, 0, TAU, 0, PI * 0.36, 16, 5), C.hair, { p: [hc[0] - R * 0.05, hc[1] + R * 0.05, 0], s: [1.02, 0.9, 0.98] });
  bp.add('head', geo.sphPart(R * 1.06, -PI / 2, PI, 0, PI * 0.62, 12, 6), 0xb8b4ae, { p: [hc[0] - R * 0.06, hc[1], 0], s: [1, 1, 0.97] });
  bp.add('head', geo.sph(R * 0.72, 12, 8), 0x6a5c52, { p: [hc[0] + R * 0.3, hc[1] - R * 0.5, 0], s: [0.8, 0.55, 1.08] });
  bp.add('head', geo.box(R * 0.3, R * 0.09, R * 0.9), 0x3a2622, { p: [hc[0] + R * 0.86, hc[1] + R * 0.28, 0] });
  // 披风（暗红）
  const cp = cape(bp, 'chest', linePts([-0.08 * H, 0.098 * H, 0], [-0.09 * H, 0.098 * H - 0.44 * H, 0], 3), 0x7a1418, 0x2a0a0c,
    { wTop: 0.24 * H, wBot: 0.3 * H, len: 0.46 * H, bulge: 0.03 * H });
  // 双刃战斧（斧柄沿 +X，斧头在远端）
  const w = 'wpR';
  bp.add(w, cylX(2.8 * U, 2.8 * U, 190 * U, 8), C.wood, { p: [70 * U, 0, 0] });
  for (const x of [-18, 30, 110, 135]) bp.add(w, cylX(3.6 * U, 3.6 * U, 5 * U, 8), C.steel, { p: [x * U, 0, 0], shine: 0.8 });
  bp.add(w, geo.cone(4 * U, 12 * U, 6), C.steel, { p: [-30 * U, 0, 0], r: [0, 0, PI / 2], shine: 0.8 });
  const head = [[165, 5], [172, 30], [184, 58], [165, 67], [146, 70], [126, 64], [106, 58], [122, 26], [134, 5], [134, -5], [122, -26], [106, -58], [126, -64], [146, -70], [165, -67], [184, -58], [172, -30], [165, -5]]
    .map(([x, y]) => [x * U, y * U]);
  bp.add(w, geo.extrude(head, 4.5 * U, 1.4 * U), 0x5e626e, { shine: 0.9 });
  bp.add(w, geo.extrude(head.map(([x, y]) => [x, y * 0.9]), 7 * U, 0), C.red, { s: [0.62, 0.5, 1], p: [58 * U, 0, 0], glow: 0.1 });
  bp.add(w, geo.cone(3.6 * U, 26 * U, 6), C.steel, { p: [200 * U, 0, 0], r: [0, 0, -PI / 2], shine: 0.8 });
  bp.meta.style = 'axe';
  bp.meta.height = 250;
  bp.meta.chains = [{ names: cp, kind: 'cape' }];
  bp.meta.rim = (ms) => (ms.noxianMight ? { rim: 0xff3020, rimI: 0.55 } : ms.axeGlow ? { rim: 0xff5a3a, rimI: 0.3 } : null);
  bp.overlays.push((v) => {
    const g = cachedGeo('dariusGlow', () => geo.extrude(head.map(([x, y]) => [x + (x - 150 * U) * 0.1, y * 1.15]), 9 * U, 2 * U));
    const m = new THREE.Mesh(g, addMat(0xff4020, 0.6));
    m.visible = false;
    v.bones.wpR.add(m);
    return { update(v2, e) { m.visible = !!(e.modelState.axeGlow || e.modelState.axeSpin) && v2.opacity > 0.5; } };
  });
}
