// 英雄模型 · 安妮（黑暗之女）：矮小女孩、红裙、红发双马尾、左手抱提伯斯小熊；modelState.tibbersOut 时小熊隐藏、pyroReady 手中火苗
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI, TAU } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid, hairCap, tail, ringY } from './rig.js';

export function build(bp, def) {
  const H = 156, U = H / 220;
  const C = { skin: 0xf8d8c2, hair: 0xd23a34, hairL: 0xf06a4a, red: 0xd8303a, redD: 0x9a1c2c, white: 0xfaf4ee, purple: 0x3c2a52, shoe: 0x5a2a1a, bear: 0x4a3450, bearL: 0x7a6484 };
  const M = humanoid(bp, {
    H, child: true, female: true, bulk: 0.95, skin: C.skin, eye: 0x4a9a3a, brow: 0xa8302a, fist: false, handS: 1.25, headScale: 1,
    prop: { leg: 0.38, torso: 0.26, head: 0.13, shoulder: 0.105, hipW: 0.055, arm: 0.31, neck: 0.018 }, armR: 0.042, legR: 0.056,
    c: { chest: C.red, belly: C.red, pelvis: C.red, ua: C.red, fa: C.skin, hand: C.skin, th: C.purple, sn: C.purple, foot: C.shoe, bust: C.red },
  });
  const R = M.headR, hc = M.headC;
  // 连衣裙（钟形裙摆 + 白色花边 + 领口）
  bp.add('hips', geo.lathe([[0.14 * H, -0.13 * H], [0.125 * H, -0.08 * H], [0.1 * H, -0.02 * H], [0.08 * H, 0.06 * H]], 18), C.red, { s: [0.9, 1, 1.05], c2: C.red });
  bp.add('hips', ringY(0.14 * H, 2.2 * U), C.white, { p: [0, -0.13 * H, 0], s: [0.9, 1, 1.05] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    bp.add('hips', geo.sph(3.4 * U, 6, 4), C.white, { p: [Math.cos(a) * 0.126 * H, -0.14 * H, Math.sin(a) * 0.147 * H] });
  }
  bp.add('chest', ringY(0.052 * H, 3 * U), C.white, { p: [0, 0.098 * H, 0], s: [0.9, 1, 1] });
  bp.add('chest', geo.sph(4 * U, 8, 6), C.redD, { p: [0.05 * H, 0.08 * H, 0] });
  bp.pair('ua', geo.sph(0.052 * H, 10, 8), C.red, { p: [0, -0.02 * H, 0.004 * H], s: [1, 0.9, 1] });
  bp.pair('ua', ringY(0.04 * H, 1.6 * U), C.white, { p: [0, -0.06 * H, 0] });
  bp.pair('ft', geo.box(0.085 * H, 0.012 * H, 0.05 * H), 0x2a140c, { p: [0.022 * H, -0.04 * H, 0] });
  bp.pair('sn', ringY(0.038 * H, 1.8 * U), C.white, { p: [0, -0.01 * H, 0] });
  // 红发：发帽 + 刘海 + 双马尾
  hairCap(bp, M, C.hair, { vol: 1.1, back: 0.7, c2: C.hairL });
  const tl = [], tr = [];
  for (const s of [-1, 1]) {
    const nm = tail(bp, s < 0 ? 'twL' : 'twR', 'head', [[hc[0] - R * 0.35, hc[1] + R * 0.55, s * R * 0.92], [hc[0] - R * 0.7, hc[1] + R * 0.3, s * R * 1.5], [hc[0] - R * 0.85, hc[1] - R * 0.5, s * R * 1.7], [hc[0] - R * 0.7, hc[1] - R * 1.4, s * R * 1.55]],
      (t) => (2 + 7 * Math.pow(Math.sin(PI * Math.min(1, 0.1 + t * 0.9)), 0.7)) * U, C.hair, { n: 2, segs: 12, rs: 7, c2: C.hairL });
    (s < 0 ? tl : tr).push(...nm);
    bp.add('head', geo.tor(R * 0.16, 1.4 * U, 5, 10), C.purple, { p: [hc[0] - R * 0.42, hc[1] + R * 0.55, s * R * 0.95], r: [0, PI / 2, 0.4] });
  }
  // 提伯斯小熊（左手抱在胸前，可隐藏）
  bp.bone('bear', 'hdL', 0.02 * H, 0.01 * H, 0.03 * H);
  const b = 'bear', k = U * 1.4; // 小熊放大，保证俯视角下可辨认
  bp.add(b, geo.sph(10 * k, 10, 8), C.bear, { p: [0, 0, 0], s: [0.9, 1.1, 1] });
  bp.add(b, geo.sph(6 * k, 8, 6), C.bearL, { p: [7 * k, -1 * k, 0], s: [0.5, 0.9, 0.9] });
  bp.add(b, geo.sph(8 * k, 10, 8), C.bear, { p: [0, 15 * k, 0] });
  bp.add(b, geo.sph(3.8 * k, 8, 6), C.bearL, { p: [6.5 * k, 13.5 * k, 0], s: [0.8, 0.8, 1] });
  bp.add(b, geo.sph(1.6 * k, 6, 4), 0x140a14, { p: [9.8 * k, 14 * k, 0] });
  for (const s of [-1, 1]) {
    bp.add(b, geo.sph(3.4 * k, 8, 6), C.bear, { p: [-1 * k, 22 * k, s * 5.5 * k] });
    bp.add(b, geo.sph(4 * k, 8, 6), C.bear, { p: [2 * k, -8 * k, s * 5 * k], s: [1.3, 0.9, 1] });
    bp.add(b, geo.sph(3.6 * k, 8, 6), C.bear, { p: [2 * k, 3 * k, s * 8.5 * k], s: [1, 1.4, 1] });
  }
  bp.add(b, geo.cyl(2.2 * k, 2.2 * k, 1 * k, 8), 0xe8e4dc, { p: [6.4 * k, 17 * k, 3 * k], r: [0, 0, PI / 2] });
  bp.add(b, geo.sph(1.5 * k, 6, 4), 0x0a0a0a, { p: [6.6 * k, 17 * k, -3 * k] });
  bp.add(b, geo.box(0.6 * k, 7 * k, 0.8 * k), 0xc8a0c0, { p: [8.5 * k, 2 * k, 0] });
  bp.meta.style = 'annie';
  bp.meta.height = 164;
  bp.meta.hideBones = { tibbersOut: 'bear' };
  bp.meta.hang = ['bear']; // 小熊始终保持直立、面朝前方
  bp.meta.chains = [{ names: tl, kind: 'hair', amp: 1.4 }, { names: tr, kind: 'hair', amp: 1.4, phase: 0.8 }];
  bp.meta.rim = (ms) => (ms.pyroReady ? { rim: 0xff8a2a, rimI: 0.35 } : null);
  bp.overlays.push((v) => {
    const s = glowSprite(0xff8a30, 26 * U, 0.8);
    s.position.set(0, -0.04 * H, 0);
    v.bones.hdR.add(s);
    return { update(v2, e) { s.visible = v2.opacity > 0.5 && (e.anim.state === 'attack' || e.anim.state === 'cast' || !!e.modelState.pyroReady); } };
  });
}
