// 英雄模型 · 赵信（德邦总管）：金红德玛西亚风格铠甲、金盔 + 红缨（链式摆动）、络腮短须、红色战袍下摆、金色长枪（红缨枪头）。
// 长柄武器风格：突刺 / 横扫 / 第三击上挑；R 新月护卫整圈横扫。
// modelState：threeTalon（Q 三重爪击强化：枪尖金光）、determination（0~2 被动层数：枪头微光）、charging（E 无畏冲锋：前冲持枪）、
//             crescentGuard（R 护卫期间：周身金色边缘光）
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI, TAU, smooth } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid, cape, linePts, cylX, ringY } from './rig.js';
import { EX } from './anim.js';

// —— 动画风格：长枪 ——
const RR = [0.2, 0.24, 0, 1.2], RW = [0, 0, -0.35], RL = [0.1, 0.2, 0, 0.35];
function lance(A) {
  // 冲锋持枪：枪尖平指前方，左手扶枪
  A.arm('R', 1.3, 0.12, 0.25, 0.12);
  A.R('wpR', 0, 0, -1.45);
  A.arm('L', 1.1, 0.12, 0.6, 0.5);
  A.R('spine', 0, 0, -0.3);
  A.R('chest', 0, 0.25, 0);
}
function thrust(A) {
  A.armQ('R', RR, [-0.25, 0.3, 0.25, 1.75], [1.45, 0.1, -0.22, 0.05], [1.4, 0.1, -0.2, 0.1]);
  A.RQ('wpR', RW, [0, 0, -1.5], [0, 0, -1.5]);
  A.armQ('L', RL, [0.6, 0.3, 0.6, 1.3], [1.2, 0.15, 0.5, 0.3]);
  A.RQ('chest', [0, 0, 0], [0, -0.45, 0], [0, 0.35, -0.08]);
  A.leg('L', A.q(0.1, 0.1, 0.55), 0.14, A.q(0.1, 0.2, 0.6));
  A.leg('R', A.q(0, 0, -0.35), 0.14, A.q(0.1, 0.15, 0.3));
}
function sweep(A) {
  A.armQ('R', RR, [1.1, 0.9, -0.9, 0.3], [1.3, 0.3, 0.9, 0.1], [1.2, 0.3, 1.2, 0.15]);
  A.RQ('wpR', RW, [0, 0, -1.3], [0, 0, -1.35]);
  A.RQ('chest', [0, 0, 0], [0, -0.6, 0], [0, 0.6, -0.05], [0, 0.7, -0.05]);
  A.armQ('L', RL, [0.3, 0.4, 0, 0.5], [-0.2, 0.4, 0, 0.3]);
}
function upper(A) {
  A.armQ('R', RR, [-0.5, 0.35, 0.1, 0.4], [2.3, 0.2, 0.2, 0.3], [2.5, 0.2, 0.2, 0.3]);
  A.RQ('wpR', RW, [0, 0, -1.3], [0, 0, -1.2]);
  A.RQ('chest', [0, 0, 0], [0, -0.3, -0.15], [0, 0.2, 0.18]);
  A.leg('L', A.q(0.1, 0.2, 0.3), 0.14, A.q(0.1, 0.5, 0.2));
}
const STYLE = {
  runLean: 0.16,
  idle(A, ms, b) {
    A.arm('R', RR[0], RR[1], RR[2], RR[3] + 0.03 * b);
    A.R('wpR', RW[0], RW[1], RW[2]);
    A.arm('L', RL[0], RL[1], RL[2], RL[3]);
    A.leg('L', 0.12, 0.12, 0.16);
    A.leg('R', -0.06, 0.12, 0.12);
    A.R('chest', 0, 0.05, 0);
    if (ms.charging) lance(A);
  },
  run(A, ms, s) {
    A.arm('R', 0.12 + 0.08 * s, 0.26, 0, 1.25);
    A.R('wpR', 0, 0, -0.5);
    if (ms.charging) lance(A);
  },
  attack(A, idx, ms) {
    const k = idx % 3;
    if (k === 2) upper(A);   // 第三击上挑（三重爪击击飞）
    else if (k === 1) sweep(A);
    else thrust(A);
  },
  cast(A, slot, ms, t) {
    if (slot === 'R') {
      // 新月护卫：蓄势后一记整圈横扫
      const w = smooth((t - 0.1) / 0.35);
      A.ex[EX.MROT + 1] = -w * TAU;
      A.arm('R', 0.6, 1.3, 0, 0.1);
      A.R('wpR', 0, 0, -1.45);
      A.arm('L', 0.5, 1.1, 0, 0.3);
      A.leg('L', 0.3, 0.3, 0.6);
      A.leg('R', -0.2, 0.3, 0.5);
      A.plant();
      return;
    }
    if (slot === 'W') { A.phases(t / 0.3); sweep(A); return; }
    if (slot === 'E') { lance(A); return; }
    // Q：举枪蓄势
    A.armQ('R', RR, [0.8, 0.3, 0, 1.4], [1.0, 0.25, 0, 1.0]);
    A.RQ('wpR', RW, [0, 0, -0.6], [0, 0, -0.4]);
    A.R('head', 0, 0, 0.1 * A.K);
  },
  dash(A) { lance(A); },
};

export function build(bp, def) {
  const H = 236, U = H / 220;
  const C = {
    gold: 0xd0a444, goldL: 0xf4d27a, goldD: 0x8a6420, red: 0x9a1c16, redL: 0xc8342a, redD: 0x5a0c0a,
    skin: 0xd8a47a, beard: 0x2a1a12, steel: 0xb8c0cc, leather: 0x4a2a1a, wood: 0x5a2a1a,
  };
  const M = humanoid(bp, {
    H, bulk: 1.22, skin: C.skin, eye: 0x2a1a12, brow: C.beard, armR: 0.042,
    c: { chest: C.gold, belly: C.red, pelvis: C.redD, ua: C.red, fa: C.gold, hand: C.leather, th: C.redD, sn: C.gold, foot: C.leather },
  });
  const R = M.headR, hc = M.headC;
  // 胸甲：鳞甲横纹 + 中央红宝石 + 护颈
  for (let i = 0; i < 3; i++) bp.add('chest', ringY((0.098 - i * 0.004) * H, 1.4 * U), C.goldD, { p: [0, (-0.04 + i * 0.035) * H, 0], s: [0.7, 1, 1.22], shine: 0.7 });
  bp.add('chest', geo.extrude([[0, 11], [9, 3], [0, -12], [-9, 3]].map(([x, y]) => [x * U, y * U]), 2 * U, 0.5 * U), C.goldL, { p: [0.074 * H, 0.035 * H, 0], r: [0, PI / 2, 0], shine: 1 });
  bp.add('chest', geo.oct(3 * U), C.redL, { p: [0.082 * H, 0.035 * H, 0], glow: 0.8 });
  bp.add('chest', geo.cyl(0.055 * H, 0.075 * H, 0.035 * H, 14), C.gold, { p: [0, 0.1 * H, 0], s: [0.8, 1, 1], shine: 0.7 });
  // 肩甲：多层金片 + 红边
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    const b = 'ua' + sd, mir = s < 0;
    bp.add(b, geo.sphPart(16 * U, 0, TAU, 0, PI * 0.5, 14, 6), C.gold, { p: [0, 5 * U, 3 * U], r: [0.35, 0, 0], s: [1.05, 0.85, 1.1], mirror: mir, shine: 0.8 });
    bp.add(b, geo.tor(15.6 * U, 1.6 * U, 5, 18), C.redL, { p: [0, 4.4 * U, 3.3 * U], r: [PI / 2 + 0.35, 0, 0], s: [1.05, 1.1, 1], mirror: mir });
    bp.add(b, geo.sphPart(13 * U, 0, TAU, 0, PI * 0.5, 12, 5), C.goldD, { p: [0, -3 * U, 6.5 * U], r: [0.6, 0, 0], s: [1, 0.75, 1], mirror: mir, shine: 0.7 });
    bp.add(b, geo.sphPart(10 * U, 0, TAU, 0, PI * 0.5, 10, 5), C.gold, { p: [0, -9 * U, 9 * U], r: [0.8, 0, 0], s: [1, 0.7, 1], mirror: mir, shine: 0.7 });
  }
  bp.pair('fa', ringY(0.036 * H, 1.4 * U), C.goldL, { p: [0, -0.03 * H, 0], shine: 0.9 });
  bp.pair('fa', geo.box(0.04 * H, 0.09 * H, 2 * U), C.goldD, { p: [0, -0.075 * H, 0.03 * H], shine: 0.7 });
  // 腰带 + 红色战袍下摆（前后）+ 金色腿甲片
  bp.add('hips', ringY(0.084 * H, 2.6 * U), C.leather, { p: [0, 0.055 * H, 0], s: [0.74, 1, 1.2] });
  bp.add('hips', geo.cyl(5 * U, 5 * U, 2 * U, 10), C.goldL, { p: [0.064 * H, 0.055 * H, 0], r: [0, 0, PI / 2], shine: 1 });
  const rf = bp.chain('robeF', 'hips', linePts([0.064 * H, 0.03 * H, 0], [0.07 * H, 0.03 * H - 0.26 * H, 0], 2));
  bp.add(rf[0], geo.cloth(0.1 * H, 0.12 * H, 0.3 * H, -0.01 * H, 3, 4), C.red, { r: [0, PI, 0], chain: rf, c2: C.redL });
  const rb = bp.chain('robeB', 'hips', linePts([-0.066 * H, 0.03 * H, 0], [-0.075 * H, 0.03 * H - 0.28 * H, 0], 2));
  bp.add(rb[0], geo.cloth(0.15 * H, 0.19 * H, 0.32 * H, 0.014 * H, 4, 5), C.red, { chain: rb, c2: C.redL });
  bp.pair('th', geo.box(0.07 * H, 0.1 * H, 2 * U), C.gold, { p: [0.004 * H, -0.035 * H, 0.052 * H], r: [0.12, 0, 0], shine: 0.7 });
  bp.pair('th', geo.box(0.064 * H, 0.08 * H, 2 * U), C.goldD, { p: [0.004 * H, -0.1 * H, 0.056 * H], r: [0.12, 0, 0], shine: 0.6 });
  bp.pair('sn', geo.sph(0.032 * H, 10, 8), C.goldL, { p: [0.012 * H, 0.004 * H, 0], shine: 0.8 });
  bp.pair('ft', geo.box(0.1 * H, 0.03 * H, 0.055 * H), C.leather, { p: [0.024 * H, -0.03 * H, 0] });
  // 短披风（肩后）
  const cp = cape(bp, 'chest', linePts([-0.07 * H, 0.095 * H, 0], [-0.08 * H, 0.095 * H - 0.32 * H, 0], 3), C.red, C.redD,
    { wTop: 0.2 * H, wBot: 0.26 * H, len: 0.36 * H, bulge: 0.03 * H });
  // 面部：络腮短须 + 八字胡
  bp.add('head', geo.sph(R * 0.55, 10, 8), C.beard, { p: [hc[0] + R * 0.45, hc[1] - R * 0.6, 0], s: [0.8, 0.7, 1.1] });
  for (const s of [-1, 1]) bp.add('head', geo.box(R * 0.12, R * 0.1, R * 0.4), C.beard, { p: [hc[0] + R * 0.9, hc[1] - R * 0.28, s * R * 0.2], r: [s * 0.3, 0, 0] });
  // 头盔：金盔 + 前额冠饰 + 护颊 + 顶部红缨
  bp.add('head', geo.sphPart(R * 1.14, 0, TAU, 0, PI * 0.5, 18, 7), C.gold, { p: [hc[0] - R * 0.04, hc[1] + R * 0.06, 0], s: [1.04, 1.08, 0.98], shine: 0.9 });
  bp.add('head', geo.sphPart(R * 1.16, -PI / 2, PI, 0, PI * 0.72, 14, 8), C.goldD, { p: [hc[0] - R * 0.06, hc[1], 0], s: [1, 1.05, 1], shine: 0.7 });
  bp.add('head', geo.tor(R * 1.12, 1.6 * U, 6, 22), C.redL, { p: [hc[0] - R * 0.03, hc[1] + R * 0.12, 0], r: [PI / 2, 0, 0], s: [1.04, 0.98, 1] });
  bp.pair('head', geo.box(R * 0.5, R * 0.75, 1.6 * U), C.gold, { p: [hc[0] + R * 0.2, hc[1] - R * 0.3, R * 0.98], r: [0, 0.2, 0], shine: 0.7 });
  bp.add('head', geo.extrude([[0, 0], [0.35, 0.2], [0.55, 1.0], [0.15, 0.55], [-0.2, 0.25]].map(([x, y]) => [x * R, y * R]), 1.8 * U, 0.4 * U), C.goldL,
    { p: [hc[0] + R * 0.85, hc[1] + R * 0.35, 0], shine: 1 });
  bp.add('head', geo.cyl(2 * U, 3 * U, R * 0.5, 8), C.goldL, { p: [hc[0] - R * 0.05, hc[1] + R * 1.3, 0], shine: 1 });
  const plume = [];
  for (let i = 0; i < 3; i++) {
    const z = (i - 1) * R * 0.22;
    const pts = [[hc[0], hc[1] + R * 1.5, z], [hc[0] - R * 0.6, hc[1] + R * 1.6, z * 1.4], [hc[0] - R * 1.4, hc[1] + R * 0.9, z * 1.8], [hc[0] - R * 1.8, hc[1] - R * 0.5, z * 2]];
    const g = geo.tube(pts, (t) => (3.2 + 3.5 * Math.sin(PI * Math.min(1, t * 0.9 + 0.1))) * U, 12, 6);
    const names = bp.chain(`plm${i}_`, 'head', pts.slice(0, 3));
    bp.add(names[0], g, C.redL, { p: [-pts[0][0], -pts[0][1], -pts[0][2]], chain: names, c2: C.red });
    plume.push(names);
  }
  // 长枪（右手，沿 +X）：乌木枪杆 + 金箍 + 红缨 + 叶形枪头与侧刃
  const w = 'wpR';
  bp.add(w, cylX(1.8 * U, 1.8 * U, 232 * U, 8), C.wood, { p: [45 * U, 0, 0] });
  for (const x of [-70, -10, 10, 100, 158]) bp.add(w, cylX(2.5 * U, 2.5 * U, 3 * U, 8), C.goldL, { p: [x * U, 0, 0], shine: 1 });
  bp.add(w, geo.cone(3 * U, 8 * U, 8), C.goldL, { p: [-75 * U, 0, 0], r: [0, 0, PI / 2], shine: 1 });
  bp.add(w, geo.cone(7 * U, 16 * U, 8), C.redL, { p: [154 * U, 0, 0], r: [0, 0, PI / 2] });
  bp.add(w, geo.extrude([[160, -4], [176, -6.5], [204, 0], [176, 6.5], [160, 4]].map(([x, y]) => [x * U, y * U]), 1.6 * U, 0.5 * U), C.steel, { shine: 1 });
  bp.add(w, geo.box(34 * U, 1 * U, 2.2 * U), C.goldL, { p: [180 * U, 0, 0], shine: 1 });
  for (const s of [-1, 1]) bp.add(w, geo.extrude([[0, 0], [6, s * 10], [14, s * 12], [6, s * 4]].map(([x, y]) => [x * U, y * U]), 1.4 * U), C.gold, { p: [160 * U, s * 2 * U, 0], shine: 0.9 });

  bp.meta.style = STYLE;
  bp.meta.height = 262;
  bp.meta.chains = [{ names: cp, kind: 'cape' }, { names: rf, kind: 'skirtF' }, { names: rb, kind: 'skirtB' }, ...plume.map((n, i) => ({ names: n, kind: 'hair', amp: 1.5, phase: i * 0.6 }))];
  bp.meta.rim = (ms) => (ms.crescentGuard ? { rim: 0xffd060, rimI: 0.55 } : ms.threeTalon ? { rim: 0xffe08a, rimI: 0.3 } : null);
  // 枪尖光：三重爪击强化时明亮，被动层数时微光
  bp.overlays.push((v) => {
    const s = glowSprite(0xffe08a, 50 * U, 0.8);
    s.position.set(185 * U, 0, 0);
    v.bones.wpR.add(s);
    return {
      update(v2, e) {
        const ms = e.modelState || {};
        const k = ms.threeTalon ? 1 : (ms.determination || 0) > 0 ? 0.35 + 0.2 * ms.determination : 0;
        s.visible = k > 0 && v2.opacity > 0.5;
        if (s.visible) s.scale.setScalar(50 * U * k * (1 + 0.15 * Math.sin(v2.time * 9)));
      },
    };
  });
}
