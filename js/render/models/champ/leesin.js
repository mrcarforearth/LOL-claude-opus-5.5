// 英雄模型 · 李青（盲僧）：赤裸上身肌肉、红色蒙眼头带（飘带）、缠手布、宽松裤、赤脚；modelState.ironWill/flurry 边缘光
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI, TAU } from './kit.js';
import { humanoid, tail, ringY } from './rig.js';

export function build(bp, def) {
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
