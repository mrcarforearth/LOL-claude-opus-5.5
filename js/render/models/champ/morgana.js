// 英雄模型 · 莫甘娜（堕落天使）：紫色长发 + 银色额冠、深紫长袍（束腰 + 长摆）、背后一对黑紫色堕落羽翼（骨骼扇动）、双手紫色魔法光（叠加物）。
// modelState：morganaChains（R 灵魂镣铐进行中：双臂张开、羽翼展开、手部紫光增强 + 边缘光）；morganaShield 由特效处理（任何英雄都可能带）
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid, hairCap, hairSheet, linePts, ringY } from './rig.js';

// —— 动画风格：双手施法 + 羽翼扇动 ——
const RR = [0.2, 0.35, 0.05, 0.95], RL = [0.2, 0.35, 0.05, 0.95];
function wings(A, lift, fold) {
  const f = Math.sin(A.time * 1.7);
  const up = lift + 0.08 * f, bk = fold + 0.06 * f;
  A.R('wgR', -up, -bk, 0);
  A.R('wgL', up, bk, 0);
}
function spread(A, k) {
  A.arm('R', 0.5, 1.25 * k + 0.35 * (1 - k), 0, 0.3);
  A.arm('L', 0.5, 1.25 * k + 0.35 * (1 - k), 0, 0.3);
  A.R('hdR', -0.6 * k, 0, 0); A.R('hdL', 0.6 * k, 0, 0);
  A.R('head', 0, 0, 0.15 * k);
  wings(A, 0.35 * k, -0.25 * k);
}
const STYLE = {
  idle(A, ms, b) {
    A.arm('R', RR[0], RR[1] + 0.02 * b, RR[2], RR[3]);
    A.arm('L', RL[0], RL[1] + 0.02 * b, RL[2], RL[3]);
    A.R('hdR', -0.5, 0, -0.3); A.R('hdL', 0.5, 0, -0.3);
    A.R('hips', 0.05, 0.08, 0);
    A.R('head', -0.05, -0.05, 0.02);
    A.leg('R', 0.1, 0.04, 0.1);
    wings(A, 0, 0);
    if (ms.morganaChains) spread(A, 1);
  },
  run(A, ms, s) {
    A.arm('R', 0.5 * s + 0.1, 0.3, 0, 0.9);
    A.arm('L', -0.5 * s + 0.1, 0.3, 0, 0.9);
    wings(A, -0.05, 0.3);
    if (ms.morganaChains) spread(A, 0.8);
  },
  attack(A) {
    A.armQ('R', RR, [0.5, 0.5, -0.3, 1.8], [1.42, 0.15, 0.25, 0.08], [1.32, 0.15, 0.25, 0.15]);
    A.RQ('chest', [0, 0, 0], [0, -0.3, 0], [0, 0.25, -0.05]);
  },
  cast(A, slot, ms, t) {
    if (slot === 'R' || ms.morganaChains) { spread(A, A.K); return; }
    if (slot === 'Q') {
      // 暗之禁锢：双手自右侧推出
      A.armQ('R', RR, [0.3, 0.45, -0.3, 1.9], [1.45, 0.1, 0.35, 0.05]);
      A.armQ('L', RL, [0.7, 0.3, 0.7, 1.7], [1.35, 0.1, 0.55, 0.2]);
      A.RQ('chest', [0, 0, 0], [0, -0.35, 0.05], [0, 0.2, -0.08]);
      wings(A, 0.15 * A.K, 0);
      return;
    }
    if (slot === 'W') {
      // 痛苦腐蚀：右手指向地面
      A.armQ('R', RR, [1.8, 0.35, 0, 0.9], [0.95, 0.25, 0.2, 0.05]);
      A.R('head', 0, 0, A.q(0, 0, -0.2));
      return;
    }
    if (slot === 'E') {
      // 黑暗之盾：左手高举
      A.armQ('L', RL, [1.4, 0.45, 0.2, 1.1], [2.5, 0.3, 0.1, 0.35]);
      return;
    }
    A.armQ('R', RR, [0.5, 0.5, -0.3, 1.8], [1.4, 0.15, 0.25, 0.1]);
  },
  dash(A) { A.arm('R', -0.8, 0.45, 0, 0.5); A.arm('L', -0.8, 0.45, 0, 0.5); wings(A, 0.1, 0.4); },
  channel(A, ms) { spread(A, 1); },
};

export function build(bp, def) {
  const H = 216, U = H / 220;
  const C = {
    skin: 0xe8cadc, hair: 0x4a2276, hairL: 0x8a4ac8, robe: 0x3a1a5a, robeD: 0x1e0c30, robeL: 0x6a3a9a, silver: 0xc0c4d8,
    wing: 0x241030, wingL: 0x7a3ab8, glow: 0xb07aff,
  };
  const M = humanoid(bp, {
    H, female: true, bulk: 0.9, skin: C.skin, eye: 0xc86aff, eyeGlow: 0.8, brow: C.hair, fist: false,
    c: { chest: C.robe, belly: C.robeD, pelvis: C.robe, ua: C.skin, fa: C.robe, hand: C.skin, th: C.robeD, sn: C.robeD, foot: C.robeD, bust: C.robe },
  });
  const R = M.headR, hc = M.headC;
  // 束腰上衣：银色镶边 + 胸前紫晶
  bp.add('chest', ringY(0.078 * H, 1.5 * U), C.silver, { p: [0, -0.05 * H, 0], s: [0.68, 1, 0.9], shine: 0.8 });
  bp.add('chest', geo.box(1.6 * U, 0.09 * H, 0.012 * H), C.silver, { p: [0.062 * H, -0.005 * H, 0], shine: 0.8 });
  bp.add('chest', geo.oct(3.4 * U), C.glow, { p: [0.068 * H, 0.06 * H, 0], s: [0.5, 1.2, 1], glow: 1.6 });
  bp.add('chest', geo.tor(0.05 * H, 1.2 * U, 5, 16), C.silver, { p: [0.01 * H, 0.1 * H, 0], r: [PI / 2, 0, 0.35], shine: 0.8 });
  // 喇叭长袖（深紫）+ 银色袖口
  bp.pair('fa', geo.cyl(0.03 * H, 0.055 * H, 0.13 * H, 12, true), C.robe, { p: [0, -0.07 * H, 0], c2: C.robeD });
  bp.pair('fa', geo.cyl(0.056 * H, 0.058 * H, 0.012 * H, 12, true), C.silver, { p: [0, -0.137 * H, 0], shine: 0.7 });
  bp.pair('ua', ringY(0.03 * H, 1.2 * U), C.silver, { p: [0, -0.06 * H, 0], shine: 0.8 });
  // 长袍：短裙身 + 前后长摆 + 两侧长片
  bp.add('hips', geo.lathe([[0.108 * H, -0.15 * H], [0.098 * H, -0.09 * H], [0.084 * H, -0.02 * H], [0.074 * H, 0.05 * H]], 16), C.robe, { s: [0.85, 1, 1.12], c2: C.robeL });
  bp.add('hips', ringY(0.076 * H, 2.2 * U), C.silver, { p: [0, 0.045 * H, 0], s: [0.8, 1, 1.1], shine: 0.8 });
  const rf = bp.chain('robeF', 'hips', linePts([0.07 * H, 0.0, 0], [0.075 * H, -0.3 * H, 0], 2));
  bp.add(rf[0], geo.cloth(0.1 * H, 0.13 * H, 0.38 * H, -0.01 * H, 3, 5), C.robe, { r: [0, PI, 0], chain: rf, c2: C.robeD });
  const rb = bp.chain('robeB', 'hips', linePts([-0.07 * H, 0.0, 0], [-0.08 * H, -0.32 * H, 0], 2));
  bp.add(rb[0], geo.cloth(0.15 * H, 0.22 * H, 0.4 * H, 0.015 * H, 4, 5), C.robe, { chain: rb, c2: C.robeD });
  bp.pair('th', geo.box(0.075 * H, 0.26 * H, 1.8 * U), C.robe, { p: [0, -0.12 * H, 0.05 * H], r: [0.1, 0, 0], c2: C.robeL });
  // 紫色长发 + 两侧长发 + 银色额冠
  hairCap(bp, M, C.hair, { vol: 1.1, back: 0.8, c2: C.hairL });
  const hb = hairSheet(bp, M, 'hairB', C.hair, 0.4 * H, R * 1.8, R * 2.2, C.hairL);
  for (const s of [-1, 1]) {
    bp.add('head', geo.tube([[hc[0] + R * 0.45, hc[1] + R * 0.3, s * R * 0.9], [hc[0] + R * 0.4, hc[1] - R * 1.2, s * R * 1.05], [hc[0] + R * 0.25, hc[1] - R * 2.8, s * R * 0.95]], (t) => (5.5 - 3 * t) * U, 10, 6), C.hair);
  }
  bp.add('head', geo.tor(R * 1.04, 1.2 * U, 5, 20, PI * 1.1), C.silver, { p: [hc[0] + R * 0.05, hc[1] + R * 0.45, 0], r: [PI / 2, 0, PI * 0.45], shine: 0.9 });
  bp.add('head', geo.cone(R * 0.16, R * 0.7, 4), C.silver, { p: [hc[0] + R * 0.95, hc[1] + R * 0.85, 0], r: [0, 0, -0.35], shine: 1 });
  for (const s of [-1, 1]) bp.add('head', geo.cone(R * 0.12, R * 0.55, 4), C.silver, { p: [hc[0] + R * 0.75, hc[1] + R * 0.85, s * R * 0.5], r: [s * 0.4, 0, -0.35], shine: 1 });
  bp.add('head', geo.oct(R * 0.12), C.glow, { p: [hc[0] + R * 1.02, hc[1] + R * 0.55, 0], glow: 2 });
  // 堕落羽翼：翼骨（管道）+ 7 片长羽，挂在 wgR / wgL 骨骼上（左翼镜像）
  bp.bone('wgR', 'chest', -0.075 * H, 0.07 * H, 0.03 * H);
  bp.bone('wgL', 'chest', -0.075 * H, 0.07 * H, -0.03 * H);
  const armG = geo.tube([[0, 0, 0], [-0.05 * H, 0.13 * H, 0.1 * H], [-0.08 * H, 0.2 * H, 0.26 * H], [-0.07 * H, 0.12 * H, 0.42 * H]], (t) => (3.4 - 2 * t) * U, 16, 6);
  const curve = armG.userData.curve;
  bp.pair('wg', armG, C.wing, { shine: 0.3 });
  bp.pair('wg', geo.cone(2.2 * U, 14 * U, 5), C.wing, { p: [-0.08 * H, 0.215 * H, 0.26 * H], r: [0, 0, 0.3] });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = 0.18 + (i / (n - 1)) * 0.8;
    const p = curve.getPointAt(Math.min(1, t));
    const L = (0.2 + 0.2 * (i / (n - 1))) * H, w = (0.05 + 0.015 * Math.sin(i)) * H;
    const leaf = [[0, 0], [w * 0.5, -L * 0.28], [w * 0.32, -L * 0.8], [0, -L], [-w * 0.3, -L * 0.8], [-w * 0.5, -L * 0.28]];
    bp.pair('wg', geo.extrude(leaf, 1.4 * U), C.wingL, { p: [p.x - 2 * U, p.y + 4 * U, p.z], r: [-(0.05 + 0.55 * i / (n - 1)), PI / 2, 0], c2: C.wing, glow: 0.25 });
    if (i % 2 === 0) bp.pair('wg', geo.extrude(leaf.map(([x, y]) => [x * 0.8, y * 0.62]), 1.6 * U), C.wing, { p: [p.x - 3 * U, p.y + 3 * U, p.z - 6 * U], r: [-(0.1 + 0.5 * i / (n - 1)), PI / 2, 0] });
  }

  bp.meta.style = STYLE;
  bp.meta.height = 228;
  bp.meta.chains = [{ names: hb, kind: 'hair' }, { names: rf, kind: 'skirtF' }, { names: rb, kind: 'skirtB' }];
  bp.meta.rim = (ms) => (ms.morganaChains ? { rim: 0xb07aff, rimI: 0.55, glowK: 1.4 } : null);
  // 双手紫色魔法光
  bp.overlays.push((v) => {
    const sp = ['hdR', 'hdL'].map((b) => {
      const s = glowSprite(C.glow, 30 * U, 0.8);
      s.position.set(0.01 * H, -0.04 * H, 0);
      v.bones[b].add(s);
      return s;
    });
    return {
      update(v2, e) {
        const ms = e.modelState || {};
        const st = e.anim?.state;
        const k = (ms.morganaChains ? 1.8 : st === 'cast' || st === 'attack' ? 1.35 : 0.9) * (1 + 0.12 * Math.sin(v2.time * 4.5));
        for (const s of sp) { s.visible = v2.opacity > 0.5; s.scale.setScalar(30 * U * k); }
      },
    };
  });
}
