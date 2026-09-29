// 英雄模型 · 伊泽瑞尔（探险家）：金棕色蓬松短发 + 额头护目镜、蓝色外套（金边、后摆）、白衬衫、棕色腰带与长靴，
// 左手发光魔法手套（金色护臂 + 青蓝宝石）；施法射击动作（左臂前推发射）。
// modelState：ezrealStacks（0~5 被动层数，手套光效随层数增强）、ezrealRCharge（R 精准弹幕蓄力，手套强光 + 身体边缘光 + 蓄力姿势）
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid, hairCap, cape, linePts, cylZ, ringY } from './rig.js';

// —— 动画风格：左臂手套射击 ——
const RL = [0.3, 0.22, 0.3, 1.05], RR = [0.05, 0.18, 0, 0.3];
function chargePose(A, k = 1) {
  A.arm('L', 1.45 * k, 0.05, -0.1 * k, 0.1 + 0.9 * (1 - k));
  A.arm('R', 1.2 * k, 0.05, 0.65 * k, 0.7);
  A.R('chest', 0, -0.4 * k, 0);
  A.R('head', 0, 0.3 * k, 0);
  A.R('spine', 0, 0, -0.1 * k);
  A.leg('L', 0.35 * k, 0.16, 0.35 * k);
  A.leg('R', -0.3 * k, 0.16, 0.25 * k);
}
const STYLE = {
  runFreq: 1.5,
  idle(A, ms, b) {
    A.arm('L', RL[0], RL[1] + 0.02 * b, RL[2], RL[3]);
    A.R('hdL', 0, 0, 0.25);
    A.arm('R', RR[0], RR[1], RR[2], RR[3]);
    A.R('hips', 0, -0.1, 0);
    A.R('head', 0, 0.08, 0.04);
    A.leg('L', 0.1, 0.09, 0.14);
    if (ms.ezrealRCharge) { chargePose(A); A.plant(); }
  },
  run(A, ms, s) {
    A.arm('L', 0.35 - 0.25 * s, 0.2, 0.2, 1.2);
  },
  attack(A) {
    A.armQ('L', RL, [0.55, 0.35, 0.55, 2.1], [1.52, 0.08, -0.25, 0.03], [1.42, 0.1, -0.22, 0.1]);
    A.armQ('R', RR, [0.3, 0.25, 0, 0.6], [-0.35, 0.25, 0, 0.3]);
    A.RQ('chest', [0, 0, 0], [0, 0.22, 0], [0, -0.38, -0.03], [0, -0.32, -0.03]);
    A.R('head', 0, A.q(0, -0.18, 0.32, 0.28), 0);
  },
  cast(A, slot, ms, t) {
    if (slot === 'R' || ms.ezrealRCharge) {
      A.phases(t / 0.5);
      chargePose(A, Math.max(A.K, ms.ezrealRCharge ? 1 : 0));
      if (A.S > 0) A.A('chest', 0, 0, 0.12 * A.S * (1 - A.F)); // 发射后坐
      return;
    }
    if (slot === 'E') {
      // 奥术跃迁：左手高举打响指
      A.armQ('L', RL, [2.3, 0.4, 0.3, 0.9], [2.6, 0.3, 0.2, 0.5]);
      A.RQ('chest', [0, 0, 0], [0, 0, 0.12], [0, 0, 0.18]);
      return;
    }
    if (slot === 'W') {
      // 精华跃动：双手合推
      A.armQ('L', RL, [0.5, 0.4, 0.6, 2.0], [1.5, 0.08, 0.35, 0.05]);
      A.armQ('R', RR, [0.5, 0.4, 0.6, 2.0], [1.4, 0.08, 0.6, 0.2]);
      A.RQ('chest', [0, 0, 0], [0, 0.1, 0.05], [0, -0.15, -0.05]);
      return;
    }
    // 秘术射击：弓步 + 左臂猛推
    A.armQ('L', RL, [0.4, 0.4, 0.6, 2.2], [1.55, 0.05, -0.3, 0.02], [1.5, 0.06, -0.28, 0.05]);
    A.armQ('R', RR, [0.4, 0.3, 0, 0.8], [-0.5, 0.3, 0, 0.3]);
    A.RQ('chest', [0, 0, 0], [0, 0.3, 0.05], [0, -0.48, -0.06]);
    A.R('head', 0, A.q(0, -0.25, 0.42), 0);
    A.leg('L', A.q(0, 0, 0.45), 0.16, A.q(0.1, 0.2, 0.5));
    A.leg('R', A.q(0, 0, -0.3), 0.16, A.q(0.1, 0.1, 0.2));
  },
  dash(A) { A.arm('L', -0.8, 0.4, 0, 1.0); },
  channel(A, ms) { chargePose(A); },
};

export function build(bp, def) {
  const H = 212, U = H / 220;
  const C = {
    skin: 0xf2c8a2, hair: 0xc8923a, hairL: 0xf0c870, blue: 0x2f55a8, blueD: 0x1c336a, gold: 0xe8c070, goldD: 0xa8802a,
    shirt: 0xf0ece0, brown: 0x6a4428, brownD: 0x3e2818, pants: 0x5a4632, gem: 0x6fe0ff, lens: 0x9ad8ff,
  };
  const M = humanoid(bp, {
    H, bulk: 0.98, skin: C.skin, eye: 0x3a6ac8, brow: 0x8a5a24, armR: 0.038,
    c: { chest: C.blue, belly: C.shirt, pelvis: C.pants, ua: C.blue, fa: C.blue, hand: C.brownD, th: C.pants, sn: C.brown, foot: C.brownD },
  });
  const R = M.headR, hc = M.headC;
  // 外套：敞开的前襟露白衬衫 + 金色镶边 + 翻领
  bp.add('chest', geo.box(1.6 * U, 0.15 * H, 0.05 * H), C.shirt, { p: [0.071 * H, 0.03 * H, 0] });
  for (const s of [-1, 1]) {
    bp.add('chest', geo.box(1.4 * U, 0.17 * H, 2.2 * U), C.gold, { p: [0.073 * H, 0.03 * H, s * 0.027 * H], r: [s * 0.12, 0, 0], shine: 0.8 });
    bp.add('chest', geo.box(2 * U, 0.06 * H, 0.03 * H), C.blueD, { p: [0.068 * H, 0.1 * H, s * 0.035 * H], r: [s * 0.6, 0, -0.3] });
  }
  bp.add('chest', ringY(0.05 * H, 3 * U), 0xb8402a, { p: [0, 0.108 * H, 0], s: [0.95, 1, 1] }); // 围巾
  bp.add('chest', geo.box(4 * U, 0.05 * H, 5 * U), 0xb8402a, { p: [0.05 * H, 0.08 * H, 0.03 * H], r: [0.3, 0, 0.2] });
  bp.pair('ua', geo.sph(0.046 * H, 10, 8), C.blue, { p: [0, -0.005 * H, 0.004 * H], s: [1, 0.85, 1] });
  bp.pair('ua', ringY(0.04 * H, 1.3 * U), C.gold, { p: [0, 0.006 * H, 0.004 * H], shine: 0.8 });
  bp.add('faR', ringY(0.03 * H, 2.2 * U), C.gold, { p: [0, -0.11 * H, 0], shine: 0.7 });
  // 腰带（交叉双皮带 + 金扣）+ 外套后摆
  bp.add('hips', ringY(0.08 * H, 2.2 * U), C.brown, { p: [0, 0.055 * H, 0], s: [0.74, 1, 1.12] });
  bp.add('hips', geo.tor(0.085 * H, 1.8 * U, 5, 18), C.brownD, { p: [0, 0.028 * H, 0], r: [PI / 2 + 0.2, -0.25, 0], s: [0.78, 1.05, 1] });
  bp.add('hips', geo.box(2 * U, 5 * U, 6 * U), C.gold, { p: [0.062 * H, 0.055 * H, 0], shine: 1 });
  bp.pair('th', geo.box(0.05 * H, 0.05 * H, 3 * U), C.brown, { p: [0, -0.07 * H, 0.05 * H] }); // 腿侧小包
  const cp = cape(bp, 'spine', linePts([-0.06 * H, 0.01 * H, 0], [-0.07 * H, 0.01 * H - 0.26 * H, 0], 3), C.blue, C.blueD,
    { wTop: 0.15 * H, wBot: 0.19 * H, len: 0.3 * H, bulge: 0.03 * H });
  // 长靴（翻边）
  bp.pair('sn', geo.cyl(0.037 * H, 0.03 * H, 0.1 * H, 10), C.brown, { p: [0, -0.14 * H, 0] });
  bp.pair('sn', ringY(0.04 * H, 2 * U), C.brownD, { p: [0, -0.07 * H, 0] });
  // 头发：金棕蓬松短发 + 前额翘发 + 护目镜
  hairCap(bp, M, C.hair, { vol: 1.14, back: 0.6, c2: C.hairL });
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + (i / 6) * 1.8;
    bp.add('head', geo.cone(R * 0.28, R * 0.8, 5), C.hair, { p: [hc[0] + R * 0.2 - Math.abs(a) * R * 0.3, hc[1] + R * 0.95, Math.sin(a) * R * 0.7], r: [a * 0.8, 0, -0.7], c2: C.hairL });
  }
  for (let i = 0; i < 4; i++) bp.add('head', geo.cone(R * 0.25, R * 0.7, 5), C.hair, { p: [hc[0] - R * 0.7, hc[1] + R * (0.5 - i * 0.25), (i % 2 ? 1 : -1) * R * 0.3], r: [0, 0, PI * 0.62], c2: C.hairL });
  bp.add('head', geo.tor(R * 1.1, 1.4 * U, 5, 20), C.brownD, { p: [hc[0], hc[1] + R * 0.48, 0], r: [PI / 2, 0.35, 0], s: [1, 1, 0.95] });
  for (const s of [-1, 1]) {
    bp.add('head', cylZ(R * 0.24, R * 0.24, R * 0.2, 10), C.goldD, { p: [hc[0] + R * 0.78, hc[1] + R * 0.62, s * R * 0.3], r: [0, PI / 2, -0.7], shine: 0.8 });
    bp.add('head', geo.sph(R * 0.19, 8, 6), C.lens, { p: [hc[0] + R * 0.86, hc[1] + R * 0.7, s * R * 0.3], s: [0.5, 1, 1], glow: 0.6, shine: 1 });
  }
  // 魔法手套（左前臂）：金色护臂 + 手背护甲 + 青蓝宝石
  bp.add('faL', geo.cyl(0.036 * H, 0.03 * H, 0.1 * H, 12), C.gold, { p: [0, -0.075 * H, 0], shine: 0.9 });
  bp.add('faL', ringY(0.037 * H, 1.6 * U), C.goldD, { p: [0, -0.03 * H, 0], shine: 0.7 });
  bp.add('faL', ringY(0.032 * H, 1.6 * U), C.goldD, { p: [0, -0.123 * H, 0], shine: 0.7 });
  for (const s of [-1, 1]) bp.add('faL', geo.cone(2.2 * U, 9 * U, 4), C.gold, { p: [0, -0.04 * H, s * 0.034 * H], r: [s * 1.2, 0, 0], shine: 0.8 });
  bp.add('faL', geo.oct(5.2 * U), C.gem, { p: [0.033 * H, -0.08 * H, 0], s: [0.6, 1.35, 1], glow: 1.6 });
  bp.add('hdL', geo.box(0.028 * H, 0.04 * H, 0.04 * H), C.gold, { p: [0.008 * H, -0.03 * H, 0], shine: 0.9 });
  bp.add('hdL', geo.oct(2.4 * U), C.gem, { p: [0.024 * H, -0.03 * H, 0], s: [0.6, 1, 1], glow: 1.4 });

  bp.meta.style = STYLE;
  bp.meta.height = 222;
  bp.meta.chains = [{ names: cp, kind: 'cape' }];
  bp.meta.rim = (ms) => (ms.ezrealRCharge ? { rim: 0xffd870, rimI: 0.55 } : (ms.ezrealStacks || 0) >= 5 ? { rim: 0x8ae8ff, rimI: 0.32 } : null);
  // 手套光效：随被动层数增强，R 蓄力时强烈脉动
  bp.overlays.push((v) => {
    const core = glowSprite(C.gem, 34 * U, 0.85), halo = glowSprite(0xffe08a, 60 * U, 0.5);
    core.position.set(0.04 * H, -0.08 * H, 0); halo.position.copy(core.position);
    v.bones.faL.add(core, halo);
    return {
      update(v2, e) {
        const ms = e.modelState || {};
        const vis = v2.opacity > 0.5;
        const st = e.anim?.state;
        const n = Math.min(5, ms.ezrealStacks || 0);
        const fire = st === 'attack' || st === 'cast' ? 0.35 : 0;
        const k = 0.75 + n * 0.12 + fire + 0.08 * Math.sin(v2.time * 5);
        core.visible = vis;
        core.scale.setScalar(34 * U * k);
        halo.visible = vis && !!ms.ezrealRCharge;
        if (halo.visible) halo.scale.setScalar(60 * U * (1 + 0.25 * Math.sin(v2.time * 14)));
      },
    };
  });
}
