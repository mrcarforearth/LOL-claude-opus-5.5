// 英雄模型（一）：盖伦、德莱厄斯、李青、易、锤石
// 武器约定：武器挂在 wpR/wpL（拳心），沿骨骼局部 +X 延伸（手臂自然下垂时指向正前方），刃宽沿 ±Y。
import * as THREE from 'three';
import { geo, PI, TAU, starPts, addMat, glowSprite, cachedGeo } from './kit.js';
import { humanoid, face, hairCap, cape, linePts, tail } from './body.js';

// 沿 X 轴的圆柱（武器握柄等）
const cylX = (rt, rb, len, s = 10) => { const g = geo.cyl(rt, rb, len, s); g.rotateZ(-PI / 2); return g; };
// 绕 Y 轴的环（腰带/护颈）
const ringY = (R, r, s = 20) => { const g = geo.tor(R, r, 6, s); g.rotateX(PI / 2); return g; };

// ———————————————— 盖伦 ————————————————
export function garen(bp) {
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

// ———————————————— 德莱厄斯 ————————————————
export function darius(bp) {
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

// ———————————————— 李青 ————————————————
export function leesin(bp) {
  const H = 216, U = H / 220;
  const C = { skin: 0xdca47a, pants: 0x3c3432, sash: 0xd87a2a, wrap: 0xece0c4, band: 0xd42a2a, hair: 0x1a1210 };
  const M = humanoid(bp, {
    H, bulk: 1.2, skin: C.skin, muscle: true, noFace: true, legR: 0.062, armR: 0.042,
    c: { pelvis: C.pants, th: C.pants, sn: C.pants, fa: C.skin, hand: C.wrap },
  });
  const R = M.headR, hc = M.headC;
  // 五官（蒙眼：只有鼻与嘴）+ 短发 + 红色蒙眼头带与飘带
  bp.add('head', geo.cone(R * 0.1, R * 0.26, 6), C.skin, { p: [hc[0] + R * 0.95, hc[1] - R * 0.12, 0], r: [0, 0, -PI / 2 - 0.25] });
  bp.add('head', geo.box(R * 0.05, R * 0.05, R * 0.32), 0x6a342c, { p: [hc[0] + R * 0.84, hc[1] - R * 0.4, 0] });
  bp.add('head', geo.sphPart(R * 1.05, 0, TAU, 0, PI * 0.42, 16, 6), C.hair, { p: [hc[0] - R * 0.05, hc[1] + R * 0.04, 0] });
  bp.add('head', geo.sphPart(R * 1.04, -PI / 2, PI, 0, PI * 0.62, 12, 6), C.hair, { p: [hc[0] - R * 0.07, hc[1], 0] });
  bp.add('head', geo.cyl(R * 1.02, R * 1.0, R * 0.36, 20, true), C.band, { p: [hc[0] + R * 0.02, hc[1] + R * 0.1, 0], s: [0.96, 1, 0.92] });
  bp.add('head', geo.cyl(R * 1.05, R * 1.03, R * 0.1, 20, true), 0x8a1414, { p: [hc[0] + R * 0.02, hc[1] + R * 0.28, 0], s: [0.96, 1, 0.92] });
  bp.add('head', geo.sph(R * 0.2, 8, 6), C.band, { p: [hc[0] - R * 0.98, hc[1] + R * 0.1, 0] });
  const rb1 = tail(bp, 'rbA', 'head', [[hc[0] - R, hc[1] + R * 0.1, R * 0.08], [hc[0] - R * 1.9, hc[1] - R * 0.3, R * 0.35], [hc[0] - R * 2.8, hc[1] - R * 0.9, R * 0.45]],
    (t) => (2.4 - t) * U, C.band, { n: 2, segs: 10, rs: 5 });
  const rb2 = tail(bp, 'rbB', 'head', [[hc[0] - R, hc[1] + R * 0.1, -R * 0.08], [hc[0] - R * 1.8, hc[1] - R * 0.5, -R * 0.3], [hc[0] - R * 2.5, hc[1] - R * 1.2, -R * 0.4]],
    (t) => (2.4 - t) * U, C.band, { n: 2, segs: 10, rs: 5 });
  // 缠手布
  for (const f of [-0.02, -0.05, -0.08]) bp.pair('fa', geo.cyl(0.031 * H, 0.03 * H, 0.022 * H, 10), C.wrap, { p: [0, f * H * 1.1, 0], r: [0.12, 0, 0.05] });
  bp.pair('hd', geo.sph(0.03 * H, 10, 8), C.wrap, { p: [0.005 * H, -0.03 * H, 0], s: [1.15, 1.2, 0.95] });
  // 宽松裤子 + 腰带 + 赤脚（脚踝缠布）
  bp.add('hips', ringY(0.085 * H, 3 * U), C.sash, { p: [0, 0.055 * H, 0], s: [0.72, 1, 1.18] });
  bp.add('hips', geo.box(3 * U, 0.1 * H, 0.03 * H), C.sash, { p: [0.062 * H, -0.01 * H, 0.03 * H], r: [0.1, 0, 0.1] });
  bp.pair('th', geo.capsule(0.07 * H, 0.062 * H, M.Lt * 0.95, 12), C.pants, { p: [0, -0.005 * H, 0] });
  bp.pair('sn', geo.capsule(0.06 * H, 0.04 * H, M.Ls * 0.7, 12), C.pants, { p: [0, 0, 0] });
  bp.pair('sn', geo.cyl(0.036 * H, 0.03 * H, 0.05 * H, 10), C.wrap, { p: [0, -M.Ls * 0.82, 0] });
  // 念珠
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    bp.add('chest', geo.sph(2.2 * U, 6, 4), 0x6a3a1a, { p: [Math.cos(a) * 0.06 * H + 0.005 * H, 0.1 * H - Math.max(0, Math.cos(a)) * 0.03 * H, Math.sin(a) * 0.075 * H] });
  }
  bp.meta.style = 'fists';
  bp.meta.height = 222;
  bp.meta.chains = [{ names: rb1, kind: 'ribbon' }, { names: rb2, kind: 'ribbon', phase: 1.3 }];
  bp.meta.rim = (ms) => (ms.ironWill ? { rim: 0xffd26a, rimI: 0.5 } : ms.flurry ? { rim: 0xffb04a, rimI: 0.3 } : null);
}

// ———————————————— 易 ————————————————
export function masteryi(bp) {
  const H = 216, U = H / 220;
  const C = { robe: 0xb4b82a, robeL: 0xe4d860, under: 0x2a3a1c, dark: 0x1e2414, helm: 0x96a22a, lens: 0x9cff4a, skin: 0xd8a47a, steel: 0xe8f0f0, hair: 0x2a2218 };
  const M = humanoid(bp, {
    H, bulk: 1.12, skin: C.skin, noFace: true,
    c: { chest: C.robe, belly: C.under, pelvis: C.under, ua: C.under, fa: C.robe, hand: C.dark, th: C.under, sn: C.robe, foot: C.dark },
  });
  const R = M.headR, hc = M.headC;
  // 头盔 + 多镜片护目镜（发光绿色）
  bp.add('head', geo.sph(R * 1.1, 18, 12), C.helm, { p: [hc[0] - R * 0.02, hc[1] + R * 0.04, 0], s: [1.02, 1.02, 0.96], shine: 0.5 });
  bp.add('head', geo.tor(R * 1.06, 1.6 * U, 6, 22), C.robeL, { p: [hc[0], hc[1] + R * 0.1, 0], r: [PI / 2, 0, 0], shine: 0.8 });
  bp.add('head', geo.box(R * 1.9, R * 0.22, R * 0.2), C.robeL, { p: [hc[0] - R * 0.1, hc[1] + R * 1.08, 0], shine: 0.6 });
  bp.add('head', geo.box(R * 0.5, R * 0.62, R * 1.5), C.dark, { p: [hc[0] + R * 0.9, hc[1] + R * 0.02, 0], s: [1, 1, 1] });
  const lenses = [[0.12, 0.32, 0.3], [-0.26, 0.2, 0.2], [0.02, -0.4, 0.24], [0.32, -0.36, 0.14]];
  for (const [y, z, r] of lenses) {
    bp.add('head', geo.cyl(R * r * 1.25, R * r * 1.25, R * 0.14, 12), C.dark, { p: [hc[0] + R * 1.12, hc[1] + R * y, R * z], r: [0, 0, PI / 2] });
    bp.add('head', geo.sph(R * r, 12, 8), C.lens, { p: [hc[0] + R * 1.2, hc[1] + R * y, R * z], s: [0.45, 1, 1], glow: 1.8 });
  }
  bp.add('head', geo.sph(R * 0.62, 10, 8), C.dark, { p: [hc[0] + R * 0.45, hc[1] - R * 0.55, 0], s: [0.8, 0.55, 1.1] });
  const pt = tail(bp, 'pony', 'head', [[hc[0] - R * 0.9, hc[1] + R * 0.5, 0], [hc[0] - R * 1.6, hc[1] - R * 0.2, 0], [hc[0] - R * 1.7, hc[1] - R * 1.6, 0]],
    (t) => (4.5 - 3 * t) * U, C.hair, { n: 2, segs: 10, rs: 6 });
  // 肩甲（多层片甲）
  for (let i = 0; i < 3; i++) {
    bp.pair('ua', geo.sphPart((15 - i * 1.5) * U, 0, TAU, 0, PI * 0.45, 12, 5), i % 2 ? C.robeL : C.robe,
      { p: [0, (4 - i * 5) * U, (3 + i * 2.4) * U], r: [0.4 + i * 0.18, 0, 0], s: [1, 0.7, 1.05], shine: 0.3 });
  }
  bp.pair('fa', geo.cyl(0.034 * H, 0.03 * H, 0.09 * H, 10), C.robeL, { p: [0, -0.065 * H, 0], shine: 0.4 });
  // 胸前交领与腰带
  bp.add('chest', geo.box(0.03 * H, 0.15 * H, 0.03 * H), C.robeL, { p: [0.072 * H, 0.03 * H, 0.02 * H], r: [0.5, 0, 0] });
  bp.add('chest', geo.box(0.03 * H, 0.15 * H, 0.03 * H), C.robeL, { p: [0.072 * H, 0.03 * H, -0.02 * H], r: [-0.5, 0, 0] });
  bp.add('hips', ringY(0.084 * H, 3.2 * U), C.dark, { p: [0, 0.06 * H, 0], s: [0.72, 1, 1.15] });
  bp.add('hips', geo.box(4 * U, 7 * U, 7 * U), C.robeL, { p: [0.062 * H, 0.06 * H, 0], shine: 0.7 });
  // 长袍前后摆（可摆动）
  const fr = bp.chain('robeF', 'hips', linePts([0.064 * H, 0.03 * H, 0], [0.07 * H, 0.03 * H - 0.3 * H, 0], 2));
  const g1 = geo.cloth(0.1 * H, 0.13 * H, 0.34 * H, -0.01 * H, 4, 5);
  bp.add(fr[0], g1, C.robe, { r: [0, PI, 0], chain: fr, c2: C.robeL });
  const br = bp.chain('robeB', 'hips', linePts([-0.064 * H, 0.03 * H, 0], [-0.07 * H, 0.03 * H - 0.3 * H, 0], 2));
  bp.add(br[0], geo.cloth(0.14 * H, 0.18 * H, 0.36 * H, 0.01 * H, 4, 5), C.robe, { chain: br, c2: C.robeL });
  bp.pair('th', geo.box(0.07 * H, 0.14 * H, 2 * U), C.robe, { p: [0, -0.05 * H, 0.05 * H], r: [0.1, 0, 0] });
  // 太刀（细长、微弯）
  const w = 'wpR';
  bp.add(w, cylX(1.9 * U, 1.9 * U, 26 * U, 8), C.dark, { p: [-3 * U, 0, 0] });
  bp.add(w, geo.cyl(7 * U, 7 * U, 2.2 * U, 12), C.robeL, { p: [11 * U, 0, 0], r: [0, 0, PI / 2], shine: 0.9 });
  const kat = [[12, -2.8], [80, -3.2], [128, -1.2], [142, 2.6], [128, 2.4], [80, 1.6], [12, 2.6]].map(([x, y]) => [x * U, y * U]);
  bp.add(w, geo.extrude(kat, 1.4 * U, 0.4 * U), C.steel, { shine: 1 });
  bp.meta.style = 'katana';
  bp.meta.height = 222;
  bp.meta.chains = [{ names: pt, kind: 'hair' }, { names: fr, kind: 'skirtF' }, { names: br, kind: 'skirtB' }];
  bp.meta.rim = (ms) => (ms.highlander ? { rim: 0xffd84a, rimI: 0.75, tint: 0xfff0a0, tintK: 0.12 } : ms.wuju ? { rim: 0xc8ff6a, rimI: 0.35 } : ms.meditating ? { rim: 0x9aff9a, rimI: 0.3 } : null);
  bp.overlays.push((v) => {
    const g = cachedGeo('yiGlow', () => geo.extrude(kat.map(([x, y]) => [x, y * 2.2]), 4 * U, 1 * U));
    const m = new THREE.Mesh(g, addMat(0xd8ff6a, 0.6));
    m.visible = false;
    v.bones.wpR.add(m);
    const aura = glowSprite(0xffd850, 150 * U, 0.5);
    aura.position.set(0, 110 * U, 0);
    aura.visible = false;
    v.mover.add(aura);
    return {
      update(v2, e) {
        const ms = e.modelState;
        m.visible = !!(ms.wuju || ms.highlander) && v2.opacity > 0.5;
        aura.visible = !!ms.highlander && v2.opacity > 0.5;
        if (aura.visible) { const k = 1 + 0.08 * Math.sin(v2.time * 9); aura.scale.set(150 * U * k, 200 * U * k, 1); }
      },
    };
  });
}

// ———————————————— 锤石 ————————————————
export function thresh(bp) {
  const H = 252, U = H / 220;
  const C = { black: 0x1c1e22, iron: 0x3a3e44, green: 0x2a5a4a, ghost: 0x6affc4, bone: 0xc8c4a8, robe: 0x14261e };
  const M = humanoid(bp, {
    H, bulk: 1.18, skin: C.ghost, noFace: true, noHead: true, prop: { arm: 0.38, leg: 0.44 }, armR: 0.042,
    c: { chest: C.black, belly: C.green, pelvis: C.black, ua: C.iron, fa: C.black, hand: C.ghost, th: C.black, sn: C.iron, foot: C.black },
  });
  const hdR0 = M.headR * 1.0;
  const hc = M.headC;
  // 头：幽绿发光骷髅 + 铁质兜帽/头盔 + 角
  bp.add('head', geo.cyl(0.03 * H, 0.04 * H, 0.05 * H, 8), C.ghost, { p: [0, 0.02 * H, 0], glow: 1.2 });
  bp.add('head', geo.sph(hdR0 * 0.92, 14, 10), C.ghost, { p: [hc[0] + hdR0 * 0.1, hc[1], 0], s: [0.95, 1.05, 0.85], glow: 1.4 });
  bp.add('head', geo.sph(hdR0 * 0.55, 10, 8), C.ghost, { p: [hc[0] + hdR0 * 0.35, hc[1] - hdR0 * 0.62, 0], s: [0.9, 0.5, 0.9], glow: 1.2 });
  for (const s of [-1, 1]) {
    bp.add('head', geo.sph(hdR0 * 0.24, 8, 6), 0x0a1a14, { p: [hc[0] + hdR0 * 0.78, hc[1] + hdR0 * 0.05, s * hdR0 * 0.34], s: [0.5, 0.9, 1] });
    bp.add('head', geo.sph(hdR0 * 0.08, 6, 4), 0xeaffff, { p: [hc[0] + hdR0 * 0.9, hc[1] + hdR0 * 0.05, s * hdR0 * 0.32], glow: 3 });
  }
  for (let i = -2; i <= 2; i++) bp.add('head', geo.box(hdR0 * 0.12, hdR0 * 0.16, hdR0 * 0.1), 0xe8fff4, { p: [hc[0] + hdR0 * 0.8, hc[1] - hdR0 * 0.45, i * hdR0 * 0.13], glow: 1.5 });
  bp.add('head', geo.sphPart(hdR0 * 1.22, -PI * 0.62, PI * 1.24, 0, PI * 0.72, 16, 8), C.iron, { p: [hc[0] - hdR0 * 0.08, hc[1] + hdR0 * 0.05, 0], s: [1.05, 1.08, 1], shine: 0.6 });
  bp.add('head', geo.box(hdR0 * 0.5, hdR0 * 0.2, hdR0 * 1.9), C.black, { p: [hc[0] + hdR0 * 0.55, hc[1] + hdR0 * 0.6, 0], r: [0, 0, -0.35], shine: 0.4 });
  bp.pair('head', geo.cone(3.5 * U, 26 * U, 6), C.bone, { p: [hc[0] - hdR0 * 0.2, hc[1] + hdR0 * 1.1, hdR0 * 0.7], r: [0.55, 0, 0.5] });
  // 铁笼护颈
  for (let i = 0; i < 3; i++) bp.add('chest', ringY((0.07 - i * 0.008) * H, 2.2 * U), C.iron, { p: [0, (0.09 + i * 0.02) * H, 0], s: [0.9, 1, 1.05], shine: 0.6 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    bp.add('chest', geo.box(2 * U, 0.07 * H, 2 * U), C.iron, { p: [Math.cos(a) * 0.058 * H, 0.115 * H, Math.sin(a) * 0.065 * H], shine: 0.6 });
  }
  // 胸甲纹路（幽绿发光）
  bp.add('chest', geo.box(1.5 * U, 0.12 * H, 0.03 * H), C.ghost, { p: [0.074 * H, 0.02 * H, 0], glow: 1.2 });
  bp.add('chest', geo.box(1.5 * U, 0.02 * H, 0.12 * H), C.ghost, { p: [0.07 * H, 0.05 * H, 0], glow: 1.1 });
  // 巨大肩甲
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    const b = 'ua' + sd, mir = s < 0;
    bp.add(b, geo.sphPart(19 * U, 0, TAU, 0, PI * 0.5, 14, 7), C.black, { p: [0, 6 * U, 4 * U], r: [0.35, 0, 0], s: [1.1, 0.8, 1.15], mirror: mir, shine: 0.5 });
    bp.add(b, geo.tor(18.5 * U, 1.6 * U, 6, 18), C.ghost, { p: [0, 5 * U, 4.5 * U], r: [PI / 2 + 0.35, 0, 0], s: [1.1, 1.15, 1], mirror: mir, glow: 1.1 });
    bp.add(b, geo.cone(4 * U, 20 * U, 6), C.bone, { p: [-3 * U, 20 * U, 10 * U], r: [0.5, 0, 0.3], mirror: mir });
  }
  bp.pair('fa', geo.cyl(0.04 * H, 0.03 * H, 0.1 * H, 10), C.iron, { p: [0, -0.07 * H, 0], shine: 0.6 });
  bp.pair('fa', geo.tor(0.038 * H, 1.4 * U, 6, 14), C.ghost, { p: [0, -0.115 * H, 0], r: [PI / 2, 0, 0], glow: 1.2 });
  bp.pair('hd', geo.sph(0.034 * H, 10, 8), C.ghost, { p: [0, -0.03 * H, 0], s: [1.1, 1.3, 0.9], glow: 1.1 });
  // 破碎长袍（前后两片 + 侧片）
  bp.add('hips', ringY(0.086 * H, 3 * U), C.iron, { p: [0, 0.05 * H, 0], s: [0.72, 1, 1.2], shine: 0.5 });
  const rf = bp.chain('robeF', 'hips', linePts([0.066 * H, 0.03 * H, 0], [0.07 * H, 0.03 * H - 0.34 * H, 0], 2));
  bp.add(rf[0], geo.cloth(0.12 * H, 0.16 * H, 0.4 * H, -0.012 * H, 4, 5), C.robe, { r: [0, PI, 0], chain: rf, c2: C.green });
  const rbk = bp.chain('robeB', 'hips', linePts([-0.066 * H, 0.03 * H, 0], [-0.075 * H, 0.03 * H - 0.36 * H, 0], 2));
  bp.add(rbk[0], geo.cloth(0.16 * H, 0.24 * H, 0.43 * H, 0.015 * H, 4, 5), C.robe, { chain: rbk, c2: C.green });
  bp.pair('th', geo.box(0.08 * H, 0.2 * H, 2 * U), C.robe, { p: [0, -0.08 * H, 0.055 * H], r: [0.12, 0, 0], c2: C.green });
  bp.pair('ft', geo.box(0.1 * H, 0.03 * H, 0.055 * H), C.black, { p: [0.024 * H, -0.03 * H, 0] });
  // 灯笼（挂在左手下方，独立骨骼可隐藏/保持下垂）
  bp.bone('lantern', 'wpL', 0, -6 * U, 0);
  const lt = 'lantern';
  bp.add(lt, geo.cyl(0.8 * U, 0.8 * U, 12 * U, 4), C.iron, { p: [0, -6 * U, 0] });
  bp.add(lt, geo.cone(9 * U, 9 * U, 8), C.black, { p: [0, -14 * U, 0], shine: 0.5 });
  bp.add(lt, geo.tor(2.4 * U, 0.8 * U, 4, 10), C.iron, { p: [0, -9 * U, 0] });
  bp.add(lt, geo.sph(6.5 * U, 12, 8), C.ghost, { p: [0, -26 * U, 0], s: [1, 1.3, 1], glow: 2.4 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    bp.add(lt, geo.box(1.4 * U, 22 * U, 1.4 * U), C.iron, { p: [Math.cos(a) * 8 * U, -27 * U, Math.sin(a) * 8 * U], shine: 0.6 });
  }
  bp.add(lt, geo.cyl(9.5 * U, 6 * U, 5 * U, 8), C.black, { p: [0, -39 * U, 0], shine: 0.5 });
  bp.add(lt, geo.cone(3 * U, 8 * U, 6), C.ghost, { p: [0, -45 * U, 0], r: [PI, 0, 0], glow: 1.4 });
  // 镰刀锁链（右手）：短柄 + 弯刃 + 垂下的锁链
  const w = 'wpR';
  bp.add(w, cylX(2.2 * U, 2.2 * U, 34 * U, 8), C.black, { p: [4 * U, 0, 0] });
  bp.add(w, geo.sph(3.4 * U, 8, 6), C.ghost, { p: [-14 * U, 0, 0], glow: 1.4 });
  const sick = [[16, -4], [32, -2], [48, 6], [60, 20], [66, 40], [58, 30], [48, 18], [34, 8], [16, 4]].map(([x, y]) => [x * U, y * U]);
  bp.add(w, geo.extrude(sick, 2 * U, 0.6 * U), 0xa8b4b0, { shine: 1 });
  bp.add(w, geo.extrude(sick.map(([x, y]) => [x, y * 0.9]), 2.6 * U, 0), C.ghost, { s: [0.94, 0.85, 1], p: [2 * U, 0, 0], glow: 0.9 });
  const ch = tail(bp, 'chn', 'wpR', [[-14 * U, 0, 0], [-16 * U, -30 * U, 3 * U], [-8 * U, -60 * U, 6 * U], [4 * U, -80 * U, 4 * U]],
    () => 1.8 * U, 0x5a6a64, { n: 3, segs: 18, rs: 4, glow: 0.35 });
  bp.meta.style = 'lantern';
  bp.meta.height = 262;
  bp.meta.hang = ['lantern'];
  bp.meta.hideBones = { lanternOut: 'lantern' };
  bp.meta.chains = [{ names: rf, kind: 'skirtF' }, { names: rbk, kind: 'skirtB' }, { names: ch, kind: 'chain' }];
  bp.meta.rim = () => ({ rim: 0x4affb0, rimI: 0.28 });
  bp.overlays.push((v) => {
    const s = glowSprite(0x5affb8, 70 * U, 0.75);
    s.position.set(0, -26 * U, 0);
    v.bones.lantern.add(s);
    const s2 = glowSprite(0x5affb8, 60 * U, 0.45);
    s2.position.set(M.headC[0], M.headC[1], 0);
    v.bones.head.add(s2);
    return {
      update(v2, e) {
        s.visible = !e.modelState.lanternOut && v2.opacity > 0.5;
        s2.visible = v2.opacity > 0.5;
        const k = 1 + 0.12 * Math.sin(v2.time * 5.3);
        s.scale.set(70 * U * k, 70 * U * k, 1);
      },
    };
  });
}

export { face, hairCap };
