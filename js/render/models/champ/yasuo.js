// 英雄模型 · 亚索（疾风剑豪）：蓝色长衣、束起的深棕长马尾、左肩单肩甲、念珠项链、右手武士刀 + 左腰刀鞘，浪客风格。
// modelState：tornadoReady（Q 三段旋风就绪，刀身旋风光）、qStacks（Q 层数，刀身微光）、flowFull（被动剑意满，风之护盾淡蓝边缘光）、
//             lastBreath（R 狂风绝息斩，腾空下劈 + 强边缘光）、dashing（E 踏前斩，冲刺姿势）
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI, TAU, clamp01 } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid, hairCap, tail, linePts, cylX, ringY } from './rig.js';
import { STYLES, EX } from './anim.js';

// —— 动画风格：在内置太刀风格上改写施法（Q 突刺 / W 推掌 / R 腾空下劈） ——
const RR = [-0.05, 0.32, 0, 0.35], RW = [0, -2.6, -0.45], RL = [0.12, 0.2, 0, 0.4];
const STYLE = {
  ...STYLES.katana,
  cast(A, slot, ms, t) {
    if (slot === 'Q') {
      if (ms.tornadoReady) {
        // 第三段：自下而上撩起旋风
        A.armQ('R', RR, [-0.4, 0.4, 0.3, 0.6], [2.3, 0.3, 0.2, 0.3], [2.5, 0.3, 0.2, 0.3]);
        A.RQ('wpR', RW, [0, 0, -1.2], [0, 0, -1.3]);
        A.RQ('chest', [0, 0, 0], [0, -0.5, 0.05], [0, 0.4, 0.15]);
      } else {
        // 斩钢闪：后拉 → 直刺
        A.armQ('R', RR, [-0.3, 0.3, 0.3, 1.6], [1.5, 0.1, -0.2, 0.02], [1.45, 0.1, -0.2, 0.05]);
        A.RQ('wpR', RW, [0, 0, -1.6], [0, 0, -1.5]);
        A.RQ('chest', [0, 0, 0], [0, -0.4, 0], [0, 0.35, -0.05]);
      }
      A.leg('L', A.q(0.1, 0.1, 0.55), 0.14, A.q(0.22, 0.3, 0.6));
      A.leg('R', A.q(-0.05, 0, -0.35), 0.14, A.q(0.18, 0.2, 0.3));
      return;
    }
    if (slot === 'W') {
      A.armQ('L', RL, [0.6, 0.3, 0.2, 1.8], [1.45, 0.1, 0.25, 0.05]);
      A.RQ('chest', [0, 0, 0], [0, 0.3, 0], [0, -0.3, -0.05]);
      return;
    }
    if (slot === 'R' || ms.lastBreath) {
      // 狂风绝息斩：跃起 → 高举 → 下劈
      A.phases(t / 0.35);
      const up = Math.sin(PI * clamp01(t / 0.75));
      A.ex[EX.MPOS + 1] = A.H * 0.3 * up;
      A.armQ('R', RR, [2.9, 0.3, 0.2, 0.5], [0.8, 0.15, 0.4, 0.1], [0.6, 0.15, 0.4, 0.15]);
      A.RQ('wpR', RW, [0, 0, -0.2], [0, 0, -1.2], [0, 0, -1.3]);
      A.armQ('L', RL, [2.6, 0.3, 0.3, 0.6], [0.2, 0.5, 0, 0.3]);
      A.RQ('chest', [0, 0, 0], [0, 0, 0.25], [0, 0, -0.35]);
      A.leg('L', 0.9 * up, 0.12, 1.4 * up);
      A.leg('R', 0.3 * up, 0.12, 1.6 * up);
      return;
    }
    STYLES.katana.cast(A, slot, ms, t);
  },
  dash(A, ms) {
    STYLES.katana.dash(A, ms);
    A.arm('L', -0.6, 0.35, 0, 0.4);
  },
};

export function build(bp, def) {
  const H = 222, U = H / 220;
  const C = {
    skin: 0xdcb088, hair: 0x2a1c16, hairL: 0x4a3024, blue: 0x2f4a86, blueL: 0x5a7ac0, blueD: 0x1c2c54, cream: 0xe8dcc4,
    wrap: 0xcbb690, pants: 0x2a2a34, steel: 0x8a8e98, steelD: 0x4a4c56, brown: 0x5a3a22, bead: 0x7a2a1e, gold: 0xd8b060, blade: 0xe4ecf4,
  };
  const M = humanoid(bp, {
    H, bulk: 1.08, skin: C.skin, eye: 0x2a1a12, brow: C.hair, armR: 0.041,
    c: { chest: C.blue, belly: C.blue, pelvis: C.blueD, ua: C.skin, fa: C.skin, hand: C.wrap, th: C.pants, sn: C.wrap, foot: C.brown },
  });
  const R = M.headR, hc = M.headC;
  // 上衣：前襟交领（奶白内衬 + 蓝色衣襟）
  bp.add('chest', geo.box(1.6 * U, 0.1 * H, 0.03 * H), C.cream, { p: [0.072 * H, 0.06 * H, 0.012 * H], r: [0.45, 0, 0] });
  bp.add('chest', geo.box(1.8 * U, 0.12 * H, 0.022 * H), C.blueL, { p: [0.074 * H, 0.05 * H, -0.02 * H], r: [-0.5, 0, 0] });
  // 念珠项链
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    bp.add('chest', geo.sph(2.6 * U, 6, 4), C.bead, { p: [Math.cos(a) * 0.058 * H, 0.098 * H - Math.max(0, Math.cos(a)) * 0.03 * H, Math.sin(a) * 0.072 * H], shine: 0.4 });
  }
  // 腰带（棕色宽带 + 结）
  bp.add('hips', ringY(0.082 * H, 3 * U), C.brown, { p: [0, 0.055 * H, 0], s: [0.74, 1, 1.12] });
  bp.add('hips', ringY(0.084 * H, 1.2 * U), C.gold, { p: [0, 0.042 * H, 0], s: [0.74, 1, 1.12], shine: 0.7 });
  bp.add('hips', geo.box(4 * U, 7 * U, 6 * U), C.brown, { p: [0.058 * H, 0.05 * H, 0.04 * H] });
  // 长衣下摆（前后两片 + 两侧）
  const rf = bp.chain('robeF', 'hips', linePts([0.064 * H, 0.03 * H, 0], [0.07 * H, 0.03 * H - 0.26 * H, 0], 2));
  bp.add(rf[0], geo.cloth(0.1 * H, 0.12 * H, 0.3 * H, -0.01 * H, 3, 4), C.blue, { r: [0, PI, 0], chain: rf, c2: C.blueL });
  const rb = bp.chain('robeB', 'hips', linePts([-0.066 * H, 0.03 * H, 0], [-0.075 * H, 0.03 * H - 0.3 * H, 0], 2));
  bp.add(rb[0], geo.cloth(0.15 * H, 0.2 * H, 0.34 * H, 0.014 * H, 4, 5), C.blue, { chain: rb, c2: C.blueL });
  bp.pair('th', geo.box(0.07 * H, 0.18 * H, 1.8 * U), C.blueD, { p: [0, -0.07 * H, 0.052 * H], r: [0.12, 0, 0], c2: C.blue });
  // 右臂赤膊 + 护腕缠布；左臂蓝袖 + 单肩甲
  bp.pair('fa', geo.cyl(0.032 * H, 0.028 * H, 0.1 * H, 10), C.wrap, { p: [0, -0.07 * H, 0] });
  bp.add('uaL', geo.cyl(0.046 * H, 0.04 * H, 0.1 * H, 10), C.blue, { p: [0, -0.05 * H, 0] });
  bp.add('uaL', geo.sphPart(18 * U, 0, TAU, 0, PI * 0.5, 14, 6), C.steel, { p: [0, 6 * U, 3 * U], r: [0.4, 0, 0], s: [1.1, 0.85, 1.15], mirror: true, shine: 0.7 });
  bp.add('uaL', geo.sphPart(15 * U, 0, TAU, 0, PI * 0.5, 12, 5), C.steelD, { p: [0, -2 * U, 7 * U], r: [0.65, 0, 0], s: [1.05, 0.75, 1], mirror: true, shine: 0.6 });
  bp.add('uaL', geo.tor(17.6 * U, 1.4 * U, 5, 18), C.gold, { p: [0, 5.4 * U, 3.4 * U], r: [PI / 2 + 0.4, 0, 0], s: [1.1, 1.15, 1], mirror: true, shine: 0.9 });
  bp.add('chest', geo.tube([[0.06 * H, 0.09 * H, 0.06 * H], [0.07 * H, 0.03 * H, 0], [0.04 * H, -0.05 * H, -0.08 * H]], 1.6 * U, 10, 5), C.brown); // 肩甲斜挂皮带
  // 护胫缠布 + 草鞋
  bp.pair('sn', ringY(0.034 * H, 1.6 * U), C.brown, { p: [0, -0.02 * H, 0] });
  bp.pair('sn', ringY(0.03 * H, 1.6 * U), C.brown, { p: [0, -0.12 * H, 0] });
  // 头发：发帽 + 两缕前发 + 高马尾
  hairCap(bp, M, C.hair, { vol: 1.1, back: 0.7, c2: C.hairL });
  for (const s of [-1, 1]) {
    bp.add('head', geo.tube([[hc[0] + R * 0.6, hc[1] + R * 0.6, s * R * 0.5], [hc[0] + R * 0.95, hc[1] - R * 0.1, s * R * 0.75], [hc[0] + R * 0.8, hc[1] - R * 0.9, s * R * 0.85]], (t) => (3.6 - 2.6 * t) * U, 8, 5), C.hair);
  }
  const pony = tail(bp, 'pony', 'head', [[hc[0] - R * 0.7, hc[1] + R * 0.55, 0], [hc[0] - R * 1.45, hc[1] + R * 0.5, 0], [hc[0] - R * 2.0, hc[1] - R * 0.4, 0], [hc[0] - R * 2.1, hc[1] - R * 1.9, 0], [hc[0] - R * 1.9, hc[1] - R * 3.4, 0]],
    (t) => (3 + 8 * Math.pow(Math.sin(PI * Math.min(1, t * 0.85 + 0.12)), 0.7)) * U, C.hair, { n: 3, segs: 16, rs: 8, c2: C.hairL });
  bp.add('head', geo.tor(R * 0.24, 1.8 * U, 5, 10), C.bead, { p: [hc[0] - R * 0.78, hc[1] + R * 0.55, 0], r: [0, PI / 2, 0.3] });
  // 武士刀（右手，沿 +X）：柄 + 圆形护手 + 微弯刀身
  const w = 'wpR';
  bp.add(w, cylX(1.9 * U, 1.9 * U, 24 * U, 8), C.blueD, { p: [-3 * U, 0, 0] });
  bp.add(w, geo.sph(2.6 * U, 8, 6), C.gold, { p: [-15 * U, 0, 0], shine: 1 });
  bp.add(w, cylX(6 * U, 6 * U, 1.6 * U, 12), C.gold, { p: [10 * U, 0, 0], shine: 1 });
  const k = (x) => 5 * Math.pow(Math.max(0, x - 12) / 100, 2);
  const blade = [];
  for (let x = 12; x <= 104; x += 23) blade.push([x, 1.9 + k(x)]);
  blade.push([114, k(114) - 0.4]);
  for (let x = 104; x >= 12; x -= 23) blade.push([x, -2.1 + k(x)]);
  bp.add(w, geo.extrude(blade.map(([x, y]) => [x * U, y * U]), 1.1 * U, 0.3 * U), C.blade, { shine: 1 });
  bp.add(w, geo.box(80 * U, 0.8 * U, 1.4 * U), 0xa8d8ff, { p: [56 * U, 1.9 * U + k(56) * U, 0], glow: 0.5 });
  // 左腰刀鞘
  bp.add('hips', geo.tube([[0.08 * H, 0.04 * H, -0.095 * H], [-0.05 * H, -0.01 * H, -0.105 * H], [-0.2 * H, -0.075 * H, -0.1 * H]], 2.5 * U, 8, 6), 0x1e2238, { shine: 0.4 });
  bp.add('hips', ringY(2.9 * U, 1 * U, 10), C.gold, { p: [0.08 * H, 0.04 * H, -0.095 * H], r: [0, 0, 1.2], shine: 0.9 });

  bp.meta.style = STYLE;
  bp.meta.height = 232;
  bp.meta.chains = [{ names: pony, kind: 'hair', amp: 1.3 }, { names: rf, kind: 'skirtF' }, { names: rb, kind: 'skirtB' }];
  bp.meta.rim = (ms) => (ms.lastBreath ? { rim: 0x9fe8ff, rimI: 0.65 } : ms.flowFull ? { rim: 0xcfeeff, rimI: 0.38 } : null);
  // 刀身旋风光：Q 层数 / 旋风就绪时出现
  bp.overlays.push((v) => {
    const s1 = glowSprite(0x9fe8ff, 46 * U, 0.7), s2 = glowSprite(0xd8f6ff, 30 * U, 0.6);
    s1.position.set(62 * U, 2 * U, 0); s2.position.set(92 * U, 3 * U, 0);
    v.bones.wpR.add(s1, s2);
    return {
      update(v2, e) {
        const ms = e.modelState || {};
        const lv = ms.tornadoReady ? 1 : (ms.qStacks || 0) > 0 ? 0.55 : 0;
        const on = lv > 0 && v2.opacity > 0.5;
        s1.visible = s2.visible = on;
        if (on) {
          const p = 1 + 0.15 * Math.sin(v2.time * 11);
          s1.scale.setScalar(46 * U * lv * p); s2.scale.setScalar(30 * U * lv * (2 - p));
        }
      },
    };
  });
}
