// 英雄模型 · 墨菲特（熔岩巨兽）：高大岩石巨人（≈290），巨型肩背岩块 + 琥珀色晶簇与发光裂缝，小脑袋嵌在双肩之间，巨拳无武器。
// modelState：malphiteShield（花岗岩护盾：金色岩光边缘）、malphiteThunder（W 雷霆拍击强化：双拳/肩部橙色雷光）、
//             malphiteCharging（R 势不可挡冲锋：蜷身前冲姿势 + 橙色边缘光）
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid } from './rig.js';

// —— 动画风格：沉重巨拳 ——
const RA = [0.15, 0.3, 0.1, 0.4];
function curl(A) {
  // 冲锋：前倾蜷身、双臂护在身前
  A.R('spine', 0, 0, -0.6);
  A.R('chest', 0, 0, -0.3);
  A.R('head', 0, 0, 0.6);
  A.arm('R', 1.1, 0.2, 0.55, 1.4);
  A.arm('L', 1.1, 0.2, 0.55, 1.4);
}
const STYLE = {
  runFreq: 1.0,
  runAmp: 0.5,
  runLean: 0.16,
  idle(A, ms, b) {
    const sw = Math.sin(A.time * 1.2);
    A.R('spine', 0, 0.03 * sw, -0.14 + 0.02 * b);
    A.R('chest', 0, 0, -0.08 + 0.02 * b);
    A.R('head', 0, 0.08 * sw, 0.22);
    A.arm('R', RA[0], RA[1], RA[2], RA[3] + 0.04 * b);
    A.arm('L', RA[0], RA[1], RA[2], RA[3] + 0.04 * b);
    A.leg('L', 0.08, 0.13, 0.2);
    A.leg('R', -0.06, 0.13, 0.18);
    if (ms.malphiteCharging) curl(A);
  },
  run(A, ms, s) {
    A.arm('L', -0.55 * s + 0.15, 0.32, 0, 0.5);
    A.arm('R', 0.55 * s + 0.15, 0.32, 0, 0.5);
    if (ms.malphiteCharging) curl(A);
  },
  attack(A, idx) {
    if (idx % 3 === 2) {
      // 双拳锤击
      A.armQ('R', RA, [2.8, 0.25, 0.25, 0.7], [1.0, 0.2, 0.35, 0.15], [0.8, 0.2, 0.35, 0.2]);
      A.armQ('L', RA, [2.8, 0.25, 0.25, 0.7], [1.0, 0.2, 0.35, 0.15], [0.8, 0.2, 0.35, 0.2]);
      A.RQ('spine', [0, 0, -0.14], [0, 0, 0.08], [0, 0, -0.45], [0, 0, -0.4]);
      A.leg('L', A.q(0.08, 0.1, 0.35), 0.15, A.q(0.2, 0.2, 0.55));
      return;
    }
    const sd = idx % 2 ? 'L' : 'R', s = sd === 'R' ? 1 : -1;
    A.armQ(sd, RA, [0.1, 0.55, -0.3, 1.9], [1.45, 0.15, -0.1, 0.1], [1.3, 0.15, 0, 0.2]);
    A.RQ('chest', [0, 0, -0.08], [0, -0.35 * s, 0], [0, 0.4 * s, -0.15]);
    A.RQ('spine', [0, 0, -0.14], [0, -0.1 * s, -0.1], [0, 0.15 * s, -0.25]);
  },
  cast(A, slot, ms, t) {
    if (slot === 'Q') {
      // 地震碎片：过肩投掷
      A.armQ('R', RA, [2.7, 0.35, -0.2, 1.3], [1.3, 0.2, 0.3, 0.1], [0.8, 0.2, 0.3, 0.2]);
      A.RQ('chest', [0, 0, -0.08], [0, -0.3, 0.15], [0, 0.35, -0.2]);
      A.armQ('L', RA, [0.8, 0.3, 0.3, 0.8], [0.1, 0.4, 0, 0.4]);
      return;
    }
    if (slot === 'W') {
      // 雷霆拍击：双拳对撞
      A.armQ('R', RA, [0.9, 0.7, -0.3, 1.0], [1.2, 0.15, 0.75, 1.1]);
      A.armQ('L', RA, [0.9, 0.7, -0.3, 1.0], [1.2, 0.15, 0.75, 1.1]);
      A.R('chest', 0, 0, A.q(-0.08, 0.1, -0.15));
      return;
    }
    if (slot === 'E') {
      // 大地震颤：高举双拳砸地
      A.phases(t / 0.3);
      A.armQ('R', RA, [3.0, 0.35, 0.1, 0.5], [0.7, 0.35, 0.2, 0.1], [0.6, 0.4, 0.2, 0.15]);
      A.armQ('L', RA, [3.0, 0.35, 0.1, 0.5], [0.7, 0.35, 0.2, 0.1], [0.6, 0.4, 0.2, 0.15]);
      A.RQ('spine', [0, 0, -0.14], [0, 0, 0.12], [0, 0, -0.55], [0, 0, -0.5]);
      A.leg('L', A.q(0.08, 0.1, 0.45), 0.2, A.q(0.2, 0.3, 0.9));
      A.leg('R', A.q(-0.06, 0, -0.1), 0.2, A.q(0.18, 0.3, 0.8));
      return;
    }
    if (slot === 'R') { A.phases(t / 0.25); curl(A); return; }
    baseCast(A);
  },
  dash(A, ms) { if (ms.malphiteCharging) curl(A); else A.arm('R', -0.6, 0.35, 0, 0.5); },
};
function baseCast(A) { A.armQ('R', RA, [0.6, 0.4, -0.2, 1.2], [1.4, 0.2, 0.2, 0.2]); }

export function build(bp, def) {
  const H = 290, U = H / 220;
  const C = { rock: 0x8a7a68, rockD: 0x5c4f44, rockL: 0xaa9884, dark: 0x3a322c, amber: 0xffa040, amberL: 0xffd080 };
  const M = humanoid(bp, {
    H, bulk: 1.45, skin: C.rockD, noFace: true, fist: true, handS: 1.7, armR: 0.052, legR: 0.066, depth: 0.78,
    prop: { leg: 0.38, torso: 0.34, head: 0.062, shoulder: 0.17, hipW: 0.066, arm: 0.42, neck: 0.004 },
    c: { chest: C.rock, belly: C.rockD, pelvis: C.rockD, ua: C.rock, fa: C.rockD, hand: C.rock, th: C.rockD, sn: C.rock, foot: C.rockD },
  });
  const R = M.headR, hc = M.headC;
  const rock = (bone, r, col, p, s = 1, rot = [0, 0, 0]) => bp.add(bone, geo.dodec(r), col, { p, s, r: rot });
  const crystal = (bone, r, h, p, rot, glow = 1.5) => bp.add(bone, geo.cone(r, h, 5), C.amber, { p, r: rot, glow, c2: C.amberL });
  // 胸前巨石板 + 腹部
  rock('chest', 0.095 * H, C.rock, [0.035 * H, 0.03 * H, 0.045 * H], [0.75, 0.9, 0.95], [0.3, 0.2, 0.1]);
  rock('chest', 0.09 * H, C.rockL, [0.035 * H, 0.035 * H, -0.045 * H], [0.75, 0.9, 0.95], [-0.2, 0.5, 0.3]);
  rock('spine', 0.08 * H, C.rockD, [0.02 * H, 0.03 * H, 0], [0.85, 0.8, 1.3], [0.1, 0.3, 0]);
  rock('hips', 0.085 * H, C.dark, [0, 0, 0], [0.9, 0.75, 1.3], [0.4, 0, 0.2]);
  // 背部岩山 + 晶簇
  rock('chest', 0.11 * H, C.rock, [-0.06 * H, 0.07 * H, 0], [0.9, 1, 1.25], [0.2, 0.9, 0.4]);
  rock('chest', 0.07 * H, C.rockL, [-0.09 * H, 0.14 * H, 0.05 * H], 1, [0.7, 0.2, 0.1]);
  rock('chest', 0.06 * H, C.rockD, [-0.09 * H, 0.13 * H, -0.06 * H], 1, [0.1, 0.6, 0.9]);
  const cl = [[-0.1, 0.19, 0, 0.05, 0.14, [0, 0, 0.35]], [-0.12, 0.16, 0.06, 0.04, 0.11, [0.5, 0, 0.5]], [-0.12, 0.16, -0.06, 0.04, 0.11, [-0.5, 0, 0.5]],
    [-0.08, 0.2, 0.04, 0.03, 0.09, [0.3, 0, 0.1]], [-0.07, 0.19, -0.05, 0.03, 0.08, [-0.4, 0, 0.1]], [-0.14, 0.08, 0.02, 0.035, 0.09, [0.2, 0, 1.2]]];
  for (const [x, y, z, r, h, rot] of cl) crystal('chest', r * H, h * H, [x * H, y * H, z * H], rot);
  // 胸前发光裂缝（折线）
  const crack = [[0.02, 0.08, 0.01], [0.0, 0.03, -0.01], [0.02, -0.02, 0.02], [0.0, -0.07, 0]];
  for (let i = 0; i < crack.length - 1; i++) {
    const a = crack[i], b = crack[i + 1];
    const dy = (b[1] - a[1]) * H, dz = (b[2] - a[2]) * H;
    bp.add('chest', geo.box(2 * U, Math.hypot(dy, dz) + 2 * U, 2.2 * U), C.amber,
      { p: [0.105 * H, (a[1] + b[1]) * 0.5 * H, (a[2] + b[2]) * 0.5 * H], r: [Math.atan2(dz, -dy), 0, 0], glow: 1.8 });
  }
  bp.add('chest', geo.oct(0.03 * H), C.amber, { p: [0.105 * H, 0.03 * H, 0], s: [0.5, 1.2, 1], glow: 2 });
  // 巨型肩岩 + 肩部晶簇
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    const b = 'ua' + sd;
    rock(b, 0.1 * H, C.rock, [0, 0.03 * H, s * 0.02 * H], [1.05, 0.85, 1.05], [0.3 * s, 0.4, 0.2]);
    rock(b, 0.065 * H, C.rockL, [-0.03 * H, 0.08 * H, s * 0.04 * H], 1, [0.5, 0.2 * s, 0.7]);
    crystal(b, 0.03 * H, 0.1 * H, [-0.02 * H, 0.12 * H, s * 0.02 * H], [s * 0.3, 0, 0.3]);
    crystal(b, 0.022 * H, 0.075 * H, [0.02 * H, 0.1 * H, s * 0.06 * H], [s * 0.7, 0, -0.2]);
    rock('fa' + sd, 0.058 * H, C.rock, [0.004 * H, -0.08 * H, 0], [1, 1.25, 1], [0.2, 0.5 * s, 0.3]);
    rock('fa' + sd, 0.04 * H, C.rockL, [-0.02 * H, -0.03 * H, s * 0.02 * H], 1, [0.8, 0, 0.4]);
    crystal('fa' + sd, 0.016 * H, 0.05 * H, [-0.04 * H, -0.05 * H, s * 0.02 * H], [0, 0, 1.3], 1.2);
    // 巨拳
    rock('hd' + sd, 0.058 * H, C.rockL, [0.005 * H, -0.045 * H, 0], [1.1, 1, 1], [0.4, 0.3, 0.6]);
    // 大腿岩块、膝盖、脚
    rock('th' + sd, 0.07 * H, C.rock, [0.01 * H, -0.05 * H, s * 0.01 * H], [1, 1.2, 1], [0.1, 0.6 * s, 0.2]);
    rock('sn' + sd, 0.05 * H, C.rockL, [0.015 * H, 0, 0], 1, [0.5, 0.2, 0.3]);
    rock('sn' + sd, 0.055 * H, C.rockD, [0.004 * H, -0.1 * H, 0], [1, 1.2, 1], [0.3, 0.8, 0.1]);
    bp.add('ft' + sd, geo.box(0.11 * H, 0.035 * H, 0.075 * H), C.rockD, { p: [0.028 * H, -0.03 * H, 0], r: [0, 0.1 * s, 0] });
    rock('ft' + sd, 0.035 * H, C.rock, [0.06 * H, -0.02 * H, 0], [1.2, 0.7, 1.1]);
  }
  // 小脑袋：岩石头盔 + 眉骨 + 发光眼缝
  rock('head', R * 1.15, C.rock, [hc[0] - R * 0.1, hc[1] + R * 0.25, 0], [1.1, 0.8, 1.05], [0.3, 0.2, 0.5]);
  bp.add('head', geo.box(R * 0.5, R * 0.45, R * 1.9), C.rockL, { p: [hc[0] + R * 0.75, hc[1] + R * 0.25, 0], r: [0, 0, -0.35] });
  bp.add('head', geo.box(R * 0.5, R * 0.7, R * 1.3), C.rockD, { p: [hc[0] + R * 0.7, hc[1] - R * 0.55, 0], r: [0, 0, 0.2] });
  for (const s of [-1, 1]) bp.add('head', geo.box(R * 0.2, R * 0.16, R * 0.55), C.amberL, { p: [hc[0] + R * 0.98, hc[1] - 0.02 * R, s * R * 0.42], r: [s * 0.25, 0, 0], glow: 2.6 });
  crystal('head', R * 0.3, R * 1.1, [hc[0] - R * 0.4, hc[1] + R * 1.0, 0], [0, 0, 0.5], 1.4);

  bp.meta.style = STYLE;
  bp.meta.height = 300;
  bp.meta.portraitSpan = R * 9;
  bp.meta.outline = 3.4;
  bp.meta.rim = (ms) => (ms.malphiteCharging ? { rim: 0xffa040, rimI: 0.6 }
    : ms.malphiteShield ? { rim: 0xffd890, rimI: 0.42, glowK: 1.25 }
      : ms.malphiteThunder ? { rim: 0xffb060, rimI: 0.3 } : null);
  // 雷霆拍击：双拳/肩部橙色雷光（闪烁）
  bp.overlays.push((v) => {
    const sp = [];
    for (const [bone, x, y, sz] of [['hdR', 0, -0.05 * H, 70], ['hdL', 0, -0.05 * H, 70], ['uaR', 0, 0.1 * H, 50], ['uaL', 0, 0.1 * H, 50]]) {
      const s = glowSprite(0xffa850, sz * U, 0.8);
      s.position.set(x, y, 0);
      v.bones[bone].add(s);
      sp.push([s, sz * U]);
    }
    return {
      update(v2, e) {
        const on = !!e.modelState?.malphiteThunder && v2.opacity > 0.5;
        sp.forEach(([s, sz], i) => {
          s.visible = on;
          if (on) s.scale.setScalar(sz * (0.8 + 0.3 * Math.abs(Math.sin(v2.time * 17 + i * 1.7))));
        });
      },
    };
  });
}
