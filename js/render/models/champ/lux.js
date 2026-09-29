// 英雄模型 · 拉克丝（光辉女郎）：金色长马尾、白蓝长裙、星形宝石魔杖（发光精灵）；modelState.finalSpark 光芒增强
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI, TAU, starPts } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid, hairCap, tail, cylX, ringY } from './rig.js';

export function build(bp, def) {
  const H = 198, U = H / 220;
  const C = { skin: 0xf8dcc8, hair: 0xf6d470, hairL: 0xfff0b0, white: 0xf6f2e8, blue: 0x3a6ad8, blueD: 0x22408a, gold: 0xf0c860 };
  const M = humanoid(bp, {
    H, female: true, bulk: 0.88, skin: C.skin, eye: 0x3a86e0, brow: 0xc8a050, fist: false,
    c: { chest: C.white, belly: C.white, pelvis: C.blue, ua: C.white, fa: C.skin, hand: C.white, th: C.skin, sn: C.blue, foot: C.blueD, bust: C.white },
  });
  const R = M.headR, hc = M.headC;
  // 胸甲与蓝色肩饰
  bp.add('chest', geo.lathe([[0.07 * H, -0.03 * H], [0.086 * H, 0.02 * H], [0.08 * H, 0.06 * H]], 14), C.blue, { s: [0.72, 1, 0.92] });
  bp.add('chest', ringY(0.08 * H, 1.3 * U), C.gold, { p: [0, 0.058 * H, 0], s: [0.72, 1, 0.92], shine: 0.9 });
  bp.add('chest', geo.oct(4 * U), 0x7ad0ff, { p: [0.062 * H, 0.015 * H, 0], s: [0.6, 1.2, 1], glow: 1.2 });
  bp.pair('ua', geo.sphPart(11 * U, 0, TAU, 0, PI * 0.5, 12, 5), C.blue, { p: [0, 3 * U, 2.5 * U], r: [0.35, 0, 0], s: [1, 0.75, 1.05] });
  bp.pair('ua', geo.tor(10.6 * U, 1.1 * U, 5, 16), C.gold, { p: [0, 2.2 * U, 2.8 * U], r: [PI / 2 + 0.35, 0, 0], shine: 0.9 });
  bp.pair('fa', geo.cyl(0.028 * H, 0.03 * H, 0.08 * H, 10), C.white, { p: [0, -0.1 * H, 0] });
  // 裙摆：白色外层 + 蓝色内层 + 金边
  bp.add('hips', geo.lathe([[0.125 * H, -0.2 * H], [0.11 * H, -0.12 * H], [0.088 * H, -0.03 * H], [0.074 * H, 0.05 * H]], 18), C.blueD, { s: [0.82, 1, 1.1] });
  bp.add('hips', geo.lathe([[0.118 * H, -0.15 * H], [0.1 * H, -0.08 * H], [0.086 * H, -0.02 * H], [0.078 * H, 0.055 * H]], 18), C.white, { s: [0.84, 1, 1.12], p: [0.004 * H, 0, 0] });
  bp.add('hips', ringY(0.118 * H, 1.4 * U), C.gold, { p: [0.004 * H, -0.148 * H, 0], s: [0.84, 1, 1.12], shine: 0.9 });
  bp.add('hips', ringY(0.078 * H, 2 * U), C.blue, { p: [0, 0.05 * H, 0], s: [0.8, 1, 1.1] });
  bp.pair('sn', geo.cyl(0.036 * H, 0.03 * H, 0.012 * H, 10), C.gold, { p: [0, -0.004 * H, 0], shine: 0.8 });
  // 金发：发帽 + 刘海 + 长马尾 + 鬓发 + 头饰
  hairCap(bp, M, C.hair, { vol: 1.12, back: 0.72, c2: C.hairL });
  const pony = tail(bp, 'pony', 'head', [[hc[0] - R * 0.9, hc[1] + R * 0.35, 0], [hc[0] - R * 1.7, hc[1] - R * 0.2, 0], [hc[0] - R * 2.0, hc[1] - R * 1.6, 0], [hc[0] - R * 2.1, hc[1] - R * 3.4, 0], [hc[0] - R * 1.9, hc[1] - R * 4.6, 0]],
    (t) => (1 + 8.5 * Math.pow(Math.sin(PI * Math.min(1, 0.12 + t * 0.9)), 0.8)) * U, C.hair, { n: 3, segs: 16, rs: 8, c2: C.hairL });
  for (const s of [-1, 1]) {
    bp.add('head', geo.tube([[hc[0] + R * 0.55, hc[1] + R * 0.3, s * R * 0.88], [hc[0] + R * 0.5, hc[1] - R * 0.7, s * R * 0.98], [hc[0] + R * 0.35, hc[1] - R * 1.6, s * R * 0.9]], (t) => (5 - 3 * t) * U, 8, 6), C.hair);
  }
  bp.add('head', geo.tor(R * 1.08, 1.1 * U, 5, 22, PI * 1.1), C.gold, { p: [hc[0] - R * 0.02, hc[1] + R * 0.42, 0], r: [PI / 2, 0, PI * 0.95], shine: 0.9 });
  bp.add('head', geo.oct(R * 0.14), 0x6ac0ff, { p: [hc[0] + R * 1.02, hc[1] + R * 0.45, 0], glow: 1.4 });
  bp.add('head', geo.sph(R * 0.28, 8, 6), C.blue, { p: [hc[0] - R * 0.92, hc[1] + R * 0.35, 0] });
  // 星辰魔杖（沿 +X）
  const w = 'wpR';
  bp.add(w, cylX(1.9 * U, 1.6 * U, 104 * U, 8), C.white, { p: [30 * U, 0, 0], shine: 0.4 });
  for (const x of [-20, 0, 60, 76]) bp.add(w, cylX(2.7 * U, 2.7 * U, 3 * U, 8), C.gold, { p: [x * U, 0, 0], shine: 1 });
  bp.add(w, geo.cone(3.2 * U, 8 * U, 6), C.gold, { p: [-26 * U, 0, 0], r: [0, 0, PI / 2], shine: 1 });
  bp.add(w, geo.tor(13 * U, 1.5 * U, 5, 20), C.gold, { p: [96 * U, 0, 0], shine: 1 });
  bp.add(w, geo.extrude(starPts(5, 11 * U, 4.6 * U, 0), 3.2 * U, 1.2 * U), 0xfff0a0, { p: [96 * U, 0, 0], glow: 1.8 });
  bp.add(w, geo.oct(3 * U), 0x8ad8ff, { p: [96 * U, 0, 0], s: [1, 1, 2.2], glow: 2 });
  bp.meta.style = 'wand';
  bp.meta.height = 204;
  bp.meta.chains = [{ names: pony, kind: 'hair' }];
  bp.meta.rim = (ms) => (ms.finalSpark ? { rim: 0xfff2a0, rimI: 0.6 } : null);
  bp.overlays.push((v) => {
    const s = glowSprite(0xfff0a0, 46 * U, 0.8);
    s.position.set(96 * U, 0, 0);
    v.bones.wpR.add(s);
    return {
      update(v2, e) {
        s.visible = v2.opacity > 0.5;
        const k = (e.modelState.finalSpark ? 2.2 : 1) * (1 + 0.12 * Math.sin(v2.time * 5));
        s.scale.set(46 * U * k, 46 * U * k, 1);
      },
    };
  });
}
