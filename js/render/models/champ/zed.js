// 英雄模型 · 劫（影流之主）：黑红忍者装、金属面具（红色发光眼缝 + 头顶刃状冠 + 两条红色飘带）、肩部尖刺肩甲、
// 双臂腕刃、背后巨型四角手里剑。buildZed(bp, def, shadow) 同时供影分身 zed_shadow 使用（同形、黑紫配色、半透明）。
// modelState：eSpin（E 鬼斩：0.3 秒原地旋转一周，腕刃横扫）、deathMark（R 瞬狱影杀阵：红色边缘光）、shadowCount（场上影分身数量：腕刃暗紫微光）
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI, TAU, smooth, starPts } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid, tail, linePts, ringY } from './rig.js';
import { EX } from './anim.js';

// —— 动画风格：忍者腕刃（双手交替斜斩、手里剑甩出、鬼斩旋转） ——
const RR = [0.3, 0.25, 0.15, 0.95], RL = [0.35, 0.25, 0.25, 1.1];
export const ZED_STYLE = {
  runLean: 0.32,
  runFreq: 1.55,
  idle(A, ms, b) {
    A.arm('R', RR[0], RR[1], RR[2], RR[3] + 0.04 * b);
    A.arm('L', RL[0], RL[1], RL[2], RL[3] + 0.04 * b);
    A.R('hdR', 0, 0, -0.2); A.R('hdL', 0, 0, -0.2);
    A.leg('L', 0.28, 0.15, 0.48);
    A.leg('R', -0.16, 0.15, 0.36);
    A.R('hips', 0, 0.25, 0);
    A.R('spine', 0, 0, -0.12 + 0.01 * b);
    A.R('chest', 0, -0.2, 0);
    A.R('head', 0, -0.05, 0.08);
    eSpin(A, ms);
  },
  run(A, ms, s) {
    // 忍者跑：双臂后摆
    A.arm('R', -0.9 + 0.1 * s, 0.3, 0, 0.35);
    A.arm('L', -0.9 - 0.1 * s, 0.3, 0, 0.35);
    eSpin(A, ms);
  },
  attack(A, idx) {
    const sd = idx % 2 ? 'L' : 'R', s = sd === 'R' ? 1 : -1;
    const rest = sd === 'R' ? RR : RL;
    A.armQ(sd, rest, [1.9, 0.9, -0.5, 1.5], [0.95, 0.3, 0.9, 0.15], [0.65, 0.3, 1.05, 0.3]);
    A.RQ('chest', [0, -0.2, 0], [0, -0.45 * s, 0.08], [0, 0.4 * s, -0.12], [0, 0.45 * s, -0.12]);
    A.RQ('spine', [0, 0, -0.12], [0, -0.1 * s, -0.05], [0, 0.12 * s, -0.2]);
  },
  cast(A, slot, ms, t) {
    if (slot === 'Q') {
      // 诸刃：右手横甩手里剑
      A.armQ('R', RR, [1.2, 0.2, 1.1, 1.5], [1.45, 0.2, -0.45, 0.05], [1.35, 0.25, -0.6, 0.1]);
      A.RQ('chest', [0, -0.2, 0], [0, 0.45, 0], [0, -0.35, -0.05]);
      return;
    }
    if (slot === 'W') {
      // 分身：左手前推
      A.armQ('L', RL, [0.4, 0.3, 0.3, 1.9], [1.5, 0.1, 0.12, 0.05]);
      A.RQ('chest', [0, -0.2, 0], [0, 0.2, 0], [0, -0.3, -0.05]);
      return;
    }
    if (slot === 'E' || ms.eSpin) { if (!eSpin(A, ms)) spin(A, t); return; }
    if (slot === 'R') {
      // 瞬狱影杀阵：低身前扑、双刃后拖
      A.R('spine', 0, 0, -0.5 * A.K);
      A.arm('R', -1.0, 0.45, 0, 0.3);
      A.arm('L', -1.0, 0.45, 0, 0.3);
      A.leg('L', 0.8 * A.K, 0.1, 1.1 * A.K);
      A.leg('R', -0.5 * A.K, 0.1, 0.5 * A.K);
      return;
    }
  },
  dash(A) {
    A.arm('R', -1.1, 0.4, 0, 0.3);
    A.arm('L', -1.1, 0.4, 0, 0.3);
  },
};
// 鬼斩：modelState.eSpin 为真的约 0.3 秒内旋转一周（自带计时，不依赖动画状态：E 无施法时间、可边走边放）
function eSpin(A, ms) {
  if (!ms.eSpin) { A._zedSpin0 = -1; return false; }
  if (!(A._zedSpin0 >= 0)) A._zedSpin0 = A.time;
  spin(A, A.time - A._zedSpin0);
  return true;
}
// 鬼斩姿势：双臂张开原地旋转一周
function spin(A, t) {
  A.ex[EX.MROT + 1] = -smooth(t / 0.3) * TAU;
  A.arm('R', 0.55, 1.25, 0, 0.15);
  A.arm('L', 0.55, 1.25, 0, 0.15);
  A.R('spine', 0, 0, -0.15);
  A.leg('L', 0.3, 0.3, 0.6);
  A.leg('R', -0.2, 0.3, 0.5);
  A.plant();
}

const PAL = {
  zed: { black: 0x16161c, dark: 0x2a2a34, red: 0xb01e2c, redD: 0x6a121c, eye: 0xff2a3a, steel: 0x9aa0ac, steelD: 0x4a4e5a, blade: 0xd8dde6, skin: 0xd8b090, glow: 0 },
  shadow: { black: 0x08060c, dark: 0x140e1e, red: 0x3a1a5a, redD: 0x1e0c30, eye: 0xb070ff, steel: 0x2a2038, steelD: 0x1a1426, blade: 0x4a3a6a, skin: 0x100a18, glow: 0.35 },
};

export function buildZed(bp, def, shadow = false) {
  const H = 226, U = H / 220;
  const C = shadow ? PAL.shadow : PAL.zed;
  const g0 = C.glow; // 影分身整体微弱自发光
  const M = humanoid(bp, {
    H, bulk: 1.05, skin: C.skin, noFace: true, armR: 0.039,
    c: { chest: C.black, belly: C.dark, pelvis: C.black, ua: C.dark, fa: C.steelD, hand: C.black, th: C.black, sn: C.dark, foot: C.black, neck: C.black },
  });
  const R = M.headR, hc = M.headC;
  // 胸甲：红色 V 形护胸 + 金属领
  for (const s of [-1, 1]) bp.add('chest', geo.box(2.4 * U, 0.13 * H, 0.03 * H), C.red, { p: [0.072 * H, 0.04 * H, s * 0.028 * H], r: [s * 0.45, 0, 0], glow: g0 });
  bp.add('chest', geo.box(2 * U, 0.06 * H, 0.05 * H), C.steel, { p: [0.074 * H, -0.02 * H, 0], shine: 0.7 });
  bp.add('chest', ringY(0.052 * H, 3 * U), C.steelD, { p: [0, 0.108 * H, 0], s: [0.95, 1, 1], shine: 0.6 });
  // 红色腰带 + 前襟长布 + 后摆
  bp.add('hips', ringY(0.08 * H, 3 * U), C.red, { p: [0, 0.055 * H, 0], s: [0.74, 1, 1.12], glow: g0 });
  bp.add('hips', geo.box(3 * U, 6 * U, 6 * U), C.steel, { p: [0.062 * H, 0.055 * H, 0], shine: 0.9 });
  const rf = bp.chain('robeF', 'hips', linePts([0.064 * H, 0.03 * H, 0], [0.07 * H, 0.03 * H - 0.28 * H, 0], 2));
  bp.add(rf[0], geo.cloth(0.07 * H, 0.05 * H, 0.32 * H, -0.006 * H, 2, 4), C.red, { r: [0, PI, 0], chain: rf, c2: C.redD, glow: g0 });
  const rb = bp.chain('robeB', 'hips', linePts([-0.066 * H, 0.03 * H, 0], [-0.07 * H, 0.03 * H - 0.2 * H, 0], 2));
  bp.add(rb[0], geo.cloth(0.12 * H, 0.1 * H, 0.22 * H, 0.012 * H, 3, 4), C.dark, { chain: rb, c2: C.black });
  // 肩甲 + 尖刺
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    const b = 'ua' + sd, mir = s < 0;
    bp.add(b, geo.sphPart(14 * U, 0, TAU, 0, PI * 0.5, 12, 6), C.steelD, { p: [0, 4 * U, 3 * U], r: [0.4, 0, 0], s: [1.05, 0.8, 1.1], mirror: mir, shine: 0.6 });
    bp.add(b, geo.sphPart(11 * U, 0, TAU, 0, PI * 0.5, 10, 5), C.red, { p: [0, -3 * U, 6 * U], r: [0.7, 0, 0], s: [1, 0.7, 1], mirror: mir, glow: g0 });
    for (let i = 0; i < 3; i++) {
      bp.add(b, geo.cone(2.6 * U, (20 - i * 4) * U, 5), C.steel, { p: [(4 - i * 6) * U, (14 - i * 2) * U, (8 + i * 2) * U], r: [0.6 + i * 0.15, 0, 0.3 - i * 0.35], mirror: mir, shine: 0.8 });
    }
  }
  // 双臂腕刃（前臂外侧沿手臂方向延伸，越过拳头）
  const Lf = M.Lf;
  const blade = [[0, -0.35 * Lf], [5 * U, -0.5 * Lf], [8 * U, -Lf - 12 * U], [6 * U, -Lf - 40 * U], [2 * U, -Lf - 56 * U], [0, -Lf - 30 * U], [-2 * U, -0.6 * Lf]];
  bp.pair('fa', geo.extrude(blade, 1.4 * U, 0.4 * U), C.blade, { p: [0.03 * H, 0, 0.004 * H], shine: 1, glow: g0 * 2 });
  bp.pair('fa', geo.box(1.2 * U, 50 * U, 1.8 * U), C.eye, { p: [0.03 * H + 7 * U, -Lf - 16 * U, 0.004 * H], r: [0, 0, -0.02], glow: shadow ? 1.4 : 0.6 });
  bp.pair('fa', geo.cyl(0.034 * H, 0.03 * H, 0.09 * H, 10), C.steelD, { p: [0, -0.075 * H, 0], shine: 0.6 });
  bp.pair('fa', ringY(0.034 * H, 1.4 * U), C.red, { p: [0, -0.03 * H, 0], glow: g0 });
  // 腿：护膝 + 尖头靴 + 绑腿
  bp.pair('sn', geo.sph(0.03 * H, 8, 6), C.steelD, { p: [0.012 * H, 0.004 * H, 0], shine: 0.6 });
  bp.pair('sn', ringY(0.032 * H, 1.4 * U), C.red, { p: [0, -0.06 * H, 0] });
  bp.pair('ft', geo.cone(0.025 * H, 0.06 * H, 6), C.black, { p: [0.065 * H, -0.03 * H, 0], r: [0, 0, -PI / 2], s: [1, 1, 0.7] });
  // 面具头盔：整头包覆 + 面甲 + 红色眼缝 + 头顶刃冠 + 侧翼
  bp.add('head', geo.sph(R * 1.08, 16, 12), C.steelD, { p: [hc[0] - R * 0.02, hc[1] + R * 0.02, 0], s: [1, 1.04, 0.92], shine: 0.7 });
  bp.add('head', geo.sphPart(R * 1.1, PI * 0.6, PI * 0.8, PI * 0.25, PI * 0.55, 12, 6), C.steel, { p: [hc[0] + R * 0.02, hc[1], 0], s: [1, 1.05, 0.9], shine: 0.9 });
  for (const s of [-1, 1]) bp.add('head', geo.box(R * 0.12, R * 0.1, R * 0.5), C.eye, { p: [hc[0] + R * 1.04, hc[1] + R * 0.12, s * R * 0.33], r: [s * -0.3, 0, 0], glow: 2.8 });
  bp.add('head', geo.extrude([[1.0, 0.5], [0.4, 1.35], [-0.6, 1.5], [-1.5, 1.2], [-0.8, 1.05], [0.2, 0.8]].map(([x, y]) => [x * R, y * R]), 1.6 * U, 0.3 * U), C.steel,
    { p: [hc[0], hc[1], 0], shine: 0.9 });
  for (const s of [-1, 1]) {
    bp.add('head', geo.extrude([[0.2, 0], [-0.6, 0.3], [-1.5, 0.1], [-0.7, -0.15]].map(([x, y]) => [x * R, y * R]), 1.4 * U), C.steel,
      { p: [hc[0], hc[1] + R * 0.2, s * R * 0.9], r: [s * 0.35, 0, 0], shine: 0.8 });
  }
  bp.add('head', geo.box(R * 0.4, R * 0.35, R * 1.2), C.red, { p: [hc[0] + R * 0.25, hc[1] + R * 0.95, 0], r: [0, 0, -0.35], glow: g0 });
  const ribs = [];
  for (const s of [-1, 1]) {
    ribs.push(tail(bp, s < 0 ? 'rbnL' : 'rbnR', 'head', [[hc[0] - R * 0.9, hc[1] + R * 0.3, s * R * 0.3], [hc[0] - R * 1.5, hc[1] - R * 0.1, s * R * 0.5], [hc[0] - R * 2.1, hc[1] - R * 1.0, s * R * 0.6], [hc[0] - R * 2.5, hc[1] - R * 2.2, s * R * 0.7]],
      (t) => (2.4 - 1.2 * t) * U, C.red, { n: 3, segs: 12, rs: 5, glow: g0 }));
  }
  // 背后巨型四角手里剑
  bp.add('chest', geo.extrude(starPts(4, 0.11 * H, 0.028 * H, 0.3), 2.2 * U, 0.5 * U), C.steel, { p: [-0.09 * H, 0.03 * H, 0], r: [0, PI / 2, 0], shine: 0.9 });
  bp.add('chest', geo.tor(0.03 * H, 2 * U, 6, 14), C.red, { p: [-0.1 * H, 0.03 * H, 0], r: [0, PI / 2, 0], glow: g0 + 0.2 });

  bp.meta.style = ZED_STYLE;
  bp.meta.height = 236;
  bp.meta.chains = [{ names: rf, kind: 'skirtF' }, { names: rb, kind: 'skirtB' }, ...ribs.map((n, i) => ({ names: n, kind: 'hair', amp: 1.6, phase: i * 0.9 }))];
  return { H, U, M };
}

export function build(bp, def) {
  const { U } = buildZed(bp, def, false);
  bp.meta.rim = (ms) => (ms.deathMark ? { rim: 0xff2a3a, rimI: 0.6 } : (ms.shadowCount || 0) > 0 ? { rim: 0x8a4aff, rimI: 0.26 } : null);
  // 影分身在场时：面具眼缝旁的红光
  bp.overlays.push((v) => {
    const s = glowSprite(0xff2a3a, 26 * U, 0.7);
    const M = bp.meta.M;
    s.position.set(M.headC[0] + M.headR * 1.05, M.headC[1] + M.headR * 0.12, 0);
    v.bones.head.add(s);
    return { update(v2, e) { s.visible = v2.opacity > 0.5 && (!!e.modelState?.deathMark || (e.modelState?.shadowCount || 0) > 0); } };
  });
}
