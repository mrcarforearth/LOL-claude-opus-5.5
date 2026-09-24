// 野怪模型：蓝色哨兵、红色树精、魔沼蛙、暗影狼、锋喙鸟、魔像、迅捷蟹
// 每只野怪 1 个合并网格（morph 姿态：walk/breath/raise/strike）+ 少量火焰光晕精灵
import * as THREE from 'three';
import { Rig, UnitView, cachedGeo, setPose, trackAttack, approach, ease, clamp01, prng, PI } from './kit.js';

export const SIDES = [1, -1];

// ———————————————— 蓝色哨兵（石头巨像 + 蓝色符文火焰） ————————————————
function buildBlue(detail) {
  const r = new Rig(detail); const R = 0x5f6d80; const D = 0x3b4556; const L = 0x8c9aae; const G = 0x3ab8ff;
  r.bone('legR', [0, 62, 36]).bone('legL', [0, 62, -36]).bone('torso', [0, 72, 0])
    .bone('head', [40, 168, 0], 'torso').bone('armR', [4, 168, 74], 'torso').bone('armL', [4, 168, -74], 'torso');
  for (const z of SIDES) {
    const b = z > 0 ? 'legR' : 'legL';
    r.seg([0, 66, 36 * z], [8, 16, 40 * z], 22, 19, D, { bone: b });
    r.dod(24, R, { p: [14, 12, 40 * z], s: [1.4, 0.6, 1.1], bone: b });
  }
  r.dod(46, D, { p: [0, 78, 0], s: [1, 0.7, 1.25] });
  r.dod(72, R, { p: [6, 134, 0], s: [1, 0.95, 1.15], bone: 'torso' });
  r.dod(54, D, { p: [-30, 172, 0], s: [1.05, 0.9, 1.1], bone: 'torso' });
  r.dod(40, L, { p: [32, 150, 0], s: [0.8, 0.9, 1.3], bone: 'torso' });
  r.oct(18, G, { p: [64, 142, 0], s: [0.6, 1.3, 1], glow: 2.8, bone: 'torso' });
  for (const z of SIDES) {
    r.box(4, 44, 6, G, { p: [58, 118, 22 * z], r: [0.35 * z, 0, 0.15], glow: 2, bone: 'torso' });
    r.box(4, 30, 5, G, { p: [48, 176, 30 * z], r: [-0.5 * z, 0, 0.1], glow: 1.8, bone: 'torso' });
  }
  for (let i = 0; i < 3; i++) {
    r.cone(13, 54, G, { p: [-48 - (i === 1 ? 10 : 0), 214 - (i === 1 ? 0 : 10), (i - 1) * 28], r: [(i - 1) * 0.45, 0, 0.45], glow: 2.4, bone: 'torso' }, 5);
  }
  // 头
  r.dod(28, R, { p: [64, 170, 0], s: [1.1, 0.9, 1], bone: 'head' });
  r.box(22, 9, 42, D, { p: [80, 182, 0], r: [0, 0, -0.3], bone: 'head' });
  r.box(20, 12, 30, D, { p: [78, 154, 0], bone: 'head' });
  for (const z of SIDES) r.box(3, 4, 7, G, { p: [89, 171, 10 * z], glow: 3.2, bone: 'head' });
  // 双臂
  for (const z of SIDES) {
    const b = z > 0 ? 'armR' : 'armL';
    r.dod(38, D, { p: [4, 174, 78 * z], bone: b });
    r.seg([4, 166, 78 * z], [20, 112, 90 * z], 22, 20, R, { bone: b });
    r.seg([20, 112, 90 * z], [38, 62, 92 * z], 22, 30, R, { bone: b });
    r.box(4, 32, 8, G, { p: [52, 90, 92 * z], r: [0, 0, 0.35], glow: 2, bone: b });
    r.dod(36, D, { p: [44, 46, 94 * z], s: [1.1, 0.9, 1], bone: b });
    for (const dz of [-12, 12]) r.cone(6, 20, L, { p: [66, 50, 94 * z + dz], r: [0, 0, -PI / 2], bone: b }, 5);
  }
  r.pose('walk', { legR: { r: [0, 0, 0.35] }, legL: { r: [0, 0, -0.35] }, armR: { r: [0, 0, -0.2] }, armL: { r: [0, 0, 0.2] }, torso: { r: [0, 0.06, 0] } });
  r.pose('breath', { torso: { s: [1.02, 1.035, 1.02] }, armR: { r: [-0.06, 0, 0.05] }, armL: { r: [0.06, 0, 0.05] }, head: { r: [0, 0, 0.05] } });
  r.pose('raise', { torso: { r: [0, -0.2, 0.12] }, armR: { r: [-0.3, 0, 2.1] }, armL: { r: [0, 0, 0.3] } });
  r.pose('strike', { torso: { r: [0, 0.22, -0.28] }, armR: { r: [0, 0, 0.55] }, armL: { r: [0, 0, -0.1] } });
  return r.build();
}

// ———————————————— 红色树精（燃烧的木石巨兽） ————————————————
function buildRed(detail) {
  const r = new Rig(detail); const B = 0x7e2c1e; const D = 0x46160e; const L = 0xb0502c; const T = 0x2a1812; const G = 0xff6a1a;
  const rnd = prng(7);
  r.bone('legR', [-24, 58, 40]).bone('legL', [-24, 58, -40]).bone('torso', [-10, 70, 0])
    .bone('head', [70, 138, 0], 'torso').bone('armR', [30, 146, 64], 'torso').bone('armL', [30, 146, -64], 'torso');
  for (const z of SIDES) {
    const b = z > 0 ? 'legR' : 'legL';
    r.seg([-24, 62, 42 * z], [-28, 14, 46 * z], 22, 20, D, { bone: b });
    r.dod(22, D, { p: [-16, 12, 46 * z], s: [1.4, 0.6, 1], bone: b });
  }
  r.dod(44, D, { p: [-24, 74, 0], s: [1, 0.8, 1.2] });
  r.sph(68, B, { p: [10, 122, 0], s: [1.25, 0.85, 1.05], bone: 'torso' }, 12, 9);
  r.sph(50, L, { p: [38, 104, 0], s: [1, 0.8, 0.9], bone: 'torso' }, 10, 8);
  for (let i = 0; i < 5; i++) r.box(3, 26 + rnd() * 16, 5, G, { p: [70 + rnd() * 6, 100 + (i - 2) * 9, (i - 2) * 16], r: [rnd() - 0.5, 0, 0.3], glow: 2.2, bone: 'torso' });
  // 背刺
  for (let i = 0; i < 12; i++) {
    const x = -50 + (i % 6) * 18; const z = (i < 6 ? 1 : -1) * (10 + rnd() * 26);
    const y = 160 + Math.sqrt(Math.max(0, 1 - (x / 85) ** 2)) * 28;
    r.cone(8 + rnd() * 6, 34 + rnd() * 24, i % 3 === 0 ? G : T, { p: [x, y, z], r: [z * 0.012, 0, 0.5 + rnd() * 0.4], glow: i % 3 === 0 ? 1.6 : 0, bone: 'torso' }, 5);
  }
  // 头
  r.dod(34, B, { p: [92, 134, 0], s: [1.2, 0.85, 1], bone: 'head' });
  r.box(30, 22, 40, D, { p: [118, 124, 0], bone: 'head' });
  r.box(26, 8, 46, T, { p: [104, 152, 0], r: [0, 0, -0.25], bone: 'head' });
  for (const z of SIDES) {
    r.seg([120, 116, 16 * z], [136, 142, 22 * z], 5, 1, 0xe8d8b0, { bone: 'head' }, 5);
    r.seg([88, 158, 18 * z], [62, 190, 36 * z], 7, 1, T, { bone: 'head' }, 5);
    r.box(3, 4, 7, G, { p: [112, 142, 14 * z], glow: 3, bone: 'head' });
  }
  // 双臂（指节着地）
  for (const z of SIDES) {
    const b = z > 0 ? 'armR' : 'armL';
    r.dod(34, D, { p: [30, 152, 68 * z], bone: b });
    r.seg([30, 146, 68 * z], [56, 96, 80 * z], 22, 20, B, { bone: b });
    r.seg([56, 96, 80 * z], [72, 30, 82 * z], 20, 26, D, { bone: b });
    r.dod(26, B, { p: [76, 18, 82 * z], s: [1.2, 0.8, 1], bone: b });
    r.cone(6, 26, T, { p: [60, 80, 98 * z], r: [PI / 2 * z, 0, 0.3], bone: b }, 5);
    r.box(3, 22, 4, G, { p: [80, 64, 82 * z], r: [0, 0, 0.25], glow: 2, bone: b });
  }
  r.pose('walk', { legR: { r: [0, 0, 0.35] }, legL: { r: [0, 0, -0.35] }, armR: { r: [0, 0, -0.3] }, armL: { r: [0, 0, 0.3] }, torso: { r: [0, 0.05, 0.03] } });
  r.pose('breath', { torso: { s: [1.02, 1.035, 1.02] }, head: { r: [0, 0, 0.06] } });
  r.pose('raise', { armR: { r: [-0.3, 0, 1.9] }, armL: { r: [0.3, 0, 1.9] }, torso: { r: [0, 0, 0.2] } });
  r.pose('strike', { armR: { r: [0, 0, 0.3] }, armL: { r: [0, 0, 0.3] }, torso: { r: [0, 0, -0.25] } });
  return r.build();
}

// ———————————————— 魔沼蛙（巨型蟾蜍） ————————————————
function buildGromp(detail) {
  const r = new Rig(detail); const S = 0x3f7c6c; const D = 0x28504a; const B = 0xb8c890; const P = 0xe0a030; const E = 0xf0d050;
  const rnd = prng(3);
  r.bone('torso', [0, 40, 0]).bone('head', [56, 90, 0], 'torso').bone('throat', [60, 60, 0], 'torso')
    .bone('legFR', [52, 48, 56]).bone('legFL', [52, 48, -56]).bone('legBR', [-40, 44, 60]).bone('legBL', [-40, 44, -60]);
  r.sph(70, S, { p: [0, 76, 0], s: [1.25, 0.82, 1.12], bone: 'torso' }, 14, 10);
  for (let i = 0; i < 12; i++) {
    const a = rnd() * PI * 2; const u = 0.3 + rnd() * 0.6;
    r.sph(5 + rnd() * 5, P, { p: [Math.cos(a) * 70 * u - 10, 76 + 56 * Math.sqrt(1 - u * u) * 0.9, Math.sin(a) * 64 * u], glow: 0.9, bone: 'torso' }, 6, 4);
  }
  for (let i = 0; i < 5; i++) r.cone(7, 22, D, { p: [-40 + i * 16, 130 - Math.abs(i - 2) * 4, 0], r: [0, 0, 0.5], bone: 'torso' }, 4);
  r.sph(54, B, { p: [42, 58, 0], s: [1.05, 0.8, 1.0], bone: 'throat' }, 12, 8);
  r.sph(46, S, { p: [66, 92, 0], s: [1, 0.72, 1.2], bone: 'head' }, 12, 8);
  r.box(10, 5, 86, D, { p: [104, 80, 0], r: [0, 0, -0.2], bone: 'head' });
  for (const z of SIDES) {
    r.sph(17, E, { p: [72, 124, 30 * z], glow: 0.9, bone: 'head' }, 10, 8);
    r.box(4, 15, 6, 0x101010, { p: [87, 124, 30 * z], bone: 'head' });
    r.hemi(19, S, { p: [70, 126, 30 * z], r: [0, 0, 0.5], s: [1, 0.6, 1], bone: 'head' }, 10, 4);
  }
  for (const z of SIDES) {
    const bf = z > 0 ? 'legFR' : 'legFL'; const bb = z > 0 ? 'legBR' : 'legBL';
    r.seg([52, 52, 56 * z], [64, 8, 66 * z], 13, 11, S, { bone: bf });
    r.sph(14, D, { p: [72, 5, 68 * z], s: [1.6, 0.4, 1.4], bone: bf }, 8, 5);
    r.sph(34, S, { p: [-44, 46, 60 * z], s: [1.35, 0.8, 0.8], bone: bb }, 10, 8);
    r.seg([-60, 30, 64 * z], [-20, 6, 70 * z], 12, 10, D, { bone: bb });
    r.sph(16, D, { p: [-6, 5, 72 * z], s: [1.8, 0.4, 1.4], bone: bb }, 8, 5);
  }
  r.pose('walk', { legBR: { r: [0, 0, -0.55] }, legBL: { r: [0, 0, -0.55] }, legFR: { r: [0, 0, 0.45] }, legFL: { r: [0, 0, 0.45] }, torso: { r: [0, 0, -0.12] } });
  r.pose('breath', { throat: { s: [1.12, 1.2, 1.12] }, torso: { s: [1.01, 1.02, 1.01] } });
  r.pose('raise', { torso: { r: [0, 0, 0.22] }, head: { r: [0, 0, 0.15] } });
  r.pose('strike', { torso: { r: [0, 0, -0.18] }, head: { r: [0, 0, -0.1], p: [16, 0, 0] }, throat: { s: [1.2, 1.28, 1.2] } });
  return r.build();
}

// ———————————————— 暗影狼 ————————————————
function buildWolf(detail) {
  const r = new Rig(detail); const F = 0x2e323c; const D = 0x191b22; const M = 0x535a6c; const E = 0x5ae8ff;
  r.bone('legFR', [44, 58, 18]).bone('legFL', [44, 58, -18]).bone('legBR', [-40, 58, 18]).bone('legBL', [-40, 58, -18])
    .bone('torso', [0, 64, 0]).bone('head', [66, 92, 0], 'torso').bone('tail', [-62, 78, 0], 'torso');
  r.sph(40, F, { p: [0, 74, 0], s: [1.55, 0.78, 0.72], bone: 'torso' }, 12, 9);
  r.sph(34, M, { p: [40, 86, 0], s: [1.0, 1.05, 0.95], bone: 'torso' }, 10, 8);
  for (let i = 0; i < 6; i++) r.cone(6, 26, i % 2 ? M : D, { p: [34 - i * 14, 108 - i * 3, (i % 2 ? 6 : -6)], r: [0, 0, 0.9], bone: 'torso' }, 4);
  for (const [b, x, z] of [['legFR', 44, 1], ['legFL', 44, -1], ['legBR', -40, 1], ['legBL', -40, -1]]) {
    const front = x > 0;
    const top = [x, 66, 18 * z]; const knee = [x + (front ? 6 : -12), 34, 20 * z]; const paw = [x + (front ? 2 : -2), 6, 20 * z];
    r.seg(top, knee, front ? 9 : 11, 7, D, { bone: b });
    r.seg(knee, paw, 7, 5.5, D, { bone: b });
    r.sph(8, D, { p: [paw[0] + 4, 4, paw[2]], s: [1.5, 0.6, 1], bone: b }, 8, 5);
  }
  r.sph(22, F, { p: [78, 100, 0], s: [1.2, 0.9, 0.85], bone: 'head' }, 10, 8);
  r.box(32, 15, 17, F, { p: [104, 92, 0], r: [0, 0, -0.1], bone: 'head' });
  r.box(28, 7, 13, D, { p: [100, 81, 0], r: [0, 0, -0.15], bone: 'head' });
  r.sph(4, 0x0a0a0a, { p: [120, 94, 0], bone: 'head' }, 6, 4);
  for (const z of SIDES) {
    r.cone(7, 20, D, { p: [72, 124, 12 * z], r: [0.2 * z, 0, 0.2], bone: 'head' }, 4);
    r.box(4, 3, 5, E, { p: [95, 102, 10 * z], glow: 3.4, bone: 'head' });
    r.cone(1.8, 7, 0xe8e8e0, { p: [112, 84, 5 * z], r: [PI, 0, 0], bone: 'head' }, 4);
  }
  r.seg([-62, 80, 0], [-100, 62, 0], 10, 4, F, { bone: 'tail' });
  r.seg([-100, 62, 0], [-120, 54, 0], 4, 1.5, M, { bone: 'tail' }, 5);
  r.pose('walk', { legFR: { r: [0, 0, 0.55] }, legBL: { r: [0, 0, 0.55] }, legFL: { r: [0, 0, -0.55] }, legBR: { r: [0, 0, -0.55] }, torso: { r: [0, 0, 0.04] }, tail: { r: [0, 0.35, 0] } });
  r.pose('breath', { torso: { s: [1.01, 1.03, 1.02] }, head: { r: [0, 0, 0.04] }, tail: { r: [0, 0.15, 0] } });
  r.pose('raise', { head: { r: [0, 0, 0.3] }, torso: { r: [0, 0, 0.1] }, legFR: { r: [0, 0, 0.3] }, legFL: { r: [0, 0, 0.3] } });
  r.pose('strike', { head: { r: [0, 0, -0.3], p: [16, 0, 0] }, torso: { r: [0, 0, -0.1], p: [10, 0, 0] } });
  return r.build();
}

// ———————————————— 锋喙鸟 ————————————————
function buildRaptor(detail) {
  const r = new Rig(detail); const R = 0xc4302a; const D = 0x6a1a18; const K = 0xe2b24e; const F = 0xf07a2a; const E = 0xffe040;
  r.bone('legR', [-4, 66, 14]).bone('legL', [-4, 66, -14]).bone('torso', [0, 78, 0])
    .bone('neck', [30, 96, 0], 'torso').bone('head', [52, 130, 0], 'neck').bone('tail', [-44, 88, 0], 'torso');
  r.sph(36, R, { p: [0, 90, 0], s: [1.35, 0.85, 0.85], bone: 'torso' }, 12, 9);
  r.sph(28, F, { p: [12, 80, 0], s: [1.2, 0.7, 0.75], bone: 'torso' }, 10, 7);
  for (const z of SIDES) r.sph(24, D, { p: [-4, 96, 26 * z], s: [1.5, 0.5, 0.35], r: [0.2 * z, 0, -0.2], bone: 'torso' }, 10, 6);
  for (let i = 0; i < 3; i++) r.cone(8, 46, i === 1 ? F : R, { p: [-66, 100, (i - 1) * 10], r: [(i - 1) * 0.3, 0, PI / 2 - 0.4], bone: 'tail' }, 5);
  r.seg([30, 98, 0], [50, 130, 0], 13, 9, R, { bone: 'neck' });
  r.sph(15, F, { p: [34, 104, 0], bone: 'neck' }, 8, 6);
  r.sph(15, R, { p: [56, 136, 0], s: [1.2, 1, 0.9], bone: 'head' }, 10, 8);
  r.cone(7, 28, K, { p: [78, 132, 0], r: [0, 0, -PI / 2 - 0.1], bone: 'head' }, 6);
  for (let i = 0; i < 3; i++) r.cone(4, 24 - i * 4, F, { p: [46 - i * 4, 152, (i - 1) * 5], r: [(i - 1) * 0.3, 0, 0.9], bone: 'head' }, 4);
  for (const z of SIDES) r.box(3, 3, 4, E, { p: [66, 140, 8 * z], glow: 2.8, bone: 'head' });
  for (const z of SIDES) {
    const b = z > 0 ? 'legR' : 'legL';
    r.seg([-4, 74, 14 * z], [6, 42, 16 * z], 10, 6, D, { bone: b });
    r.seg([6, 42, 16 * z], [-2, 8, 16 * z], 4, 3.5, K, { bone: b }, 6);
    for (let k = -1; k <= 1; k++) r.seg([-2, 6, 16 * z], [14, 2, (16 + k * 6) * z], 2.5, 1, K, { bone: b }, 4);
  }
  r.pose('walk', { legR: { r: [0, 0, 0.5] }, legL: { r: [0, 0, -0.5] }, torso: { r: [0, 0, 0.05] }, neck: { r: [0, 0, -0.1] }, tail: { r: [0, 0.2, 0] } });
  r.pose('breath', { neck: { r: [0, 0, 0.06] }, torso: { s: [1, 1.03, 1] } });
  r.pose('raise', { neck: { r: [0, 0, 0.35] }, head: { r: [0, 0, 0.2] } });
  r.pose('strike', { neck: { r: [0, 0, -0.55] }, head: { r: [0, 0, -0.3] }, torso: { r: [0, 0, -0.12] } });
  return r.build();
}

// ———————————————— 魔像（远古/普通） ————————————————
function buildKrug(detail, ancient) {
  const r = new Rig(detail); const R = ancient ? 0x6e6258 : 0x7a6e60; const D = 0x463c36; const M = 0x6a7a44; const G = 0xffa030;
  r.bone('legR', [0, 40, 34]).bone('legL', [0, 40, -34]).bone('torso', [0, 48, 0])
    .bone('armR', [12, 112, 66], 'torso').bone('armL', [12, 112, -66], 'torso');
  for (const z of SIDES) {
    const b = z > 0 ? 'legR' : 'legL';
    r.seg([0, 44, 34 * z], [4, 10, 36 * z], 16, 15, D, { bone: b });
    r.dod(18, D, { p: [10, 10, 38 * z], s: [1.4, 0.6, 1], bone: b });
  }
  r.dod(62, R, { p: [0, 104, 0], s: [1.1, 0.95, 1.1], bone: 'torso' });
  r.dod(30, D, { p: [-22, 150, 18], bone: 'torso' });
  r.dod(26, R, { p: [8, 162, -14], bone: 'torso' });
  r.dod(20, M, { p: [-30, 140, -30], s: [1, 0.5, 1], bone: 'torso' });
  for (const z of SIDES) r.box(4, 6, 9, G, { p: [66, 114, 15 * z], glow: 3, bone: 'torso' });
  r.box(6, 10, 30, 0x1a1410, { p: [64, 94, 0], bone: 'torso' });
  if (ancient) {
    for (let i = 0; i < 5; i++) r.box(3, 30, 5, G, { p: [Math.cos(i * 1.3) * 60, 100 + (i - 2) * 12, Math.sin(i * 1.3) * 60], r: [0, -i * 1.3, 0.4], glow: 2.2, bone: 'torso' });
    for (let i = 0; i < 4; i++) r.cone(10, 40, G, { p: [-20 + i * 12, 176 - (i % 2) * 10, (i - 1.5) * 20], r: [(i - 1.5) * 0.3, 0, 0.3], glow: 2, bone: 'torso' }, 5);
  }
  for (const z of SIDES) {
    const b = z > 0 ? 'armR' : 'armL';
    r.seg([12, 114, 70 * z], [26, 64, 82 * z], 18, 22, R, { bone: b });
    r.dod(28, D, { p: [32, 44, 84 * z], bone: b });
    if (ancient) r.box(3, 20, 4, G, { p: [44, 80, 84 * z], r: [0, 0, 0.3], glow: 2, bone: b });
  }
  r.pose('walk', { legR: { r: [0, 0, 0.4] }, legL: { r: [0, 0, -0.4] }, armR: { r: [0, 0, -0.25] }, armL: { r: [0, 0, 0.25] }, torso: { r: [0.05, 0, 0] } });
  r.pose('breath', { torso: { s: [1.02, 1.03, 1.02] } });
  r.pose('raise', { armR: { r: [-0.2, 0, 1.9] }, armL: { r: [0.2, 0, 1.9] }, torso: { r: [0, 0, 0.15] } });
  r.pose('strike', { armR: { r: [0, 0, 0.5] }, armL: { r: [0, 0, 0.5] }, torso: { r: [0, 0, -0.2] } });
  return r.build();
}

// ———————————————— 迅捷蟹 ————————————————
function buildScuttle(detail) {
  const r = new Rig(detail); const S = 0x5a5ec8; const D = 0x2e2e78; const B = 0xb8c8e0; const L = 0x6a74a8; const G = 0x6affd8; const P = 0x9a6aff;
  r.bone('torso', [0, 40, 0]).bone('clawR', [44, 40, 30], 'torso').bone('clawL', [44, 40, -30], 'torso');
  const legs = [];
  for (const z of SIDES) for (let i = 0; i < 3; i++) { const name = `leg${z > 0 ? 'R' : 'L'}${i}`; legs.push([name, z, i]); r.bone(name, [20 - i * 22, 38, 34 * z]); }
  r.hemi(58, S, { p: [-6, 40, 0], s: [1.3, 0.8, 1.1], bone: 'torso' }, 14, 7);
  r.tor(44, 4, D, { p: [-6, 62, 0], r: [PI / 2, 0, 0], s: [1.3, 1.1, 1], bone: 'torso' }, 4, 18);
  r.tor(24, 3.5, D, { p: [-6, 80, 0], r: [PI / 2, 0, 0], s: [1.3, 1.1, 1], bone: 'torso' }, 4, 14);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; r.sph(6, P, { p: [-6 + Math.cos(a) * 52, 58, Math.sin(a) * 44], glow: 1.8, bone: 'torso' }, 6, 4); }
  r.oct(12, G, { p: [-6, 88, 0], s: [1, 1.6, 1], glow: 2.2, bone: 'torso' });
  r.sph(50, B, { p: [0, 38, 0], s: [1.2, 0.35, 1.0], bone: 'torso' }, 12, 6);
  for (const z of SIDES) {
    r.seg([46, 48, 12 * z], [58, 82, 16 * z], 3, 2, L, { bone: 'torso' }, 5);
    r.sph(6.5, G, { p: [58, 85, 16 * z], glow: 2.6, bone: 'torso' }, 8, 6);
  }
  for (const [name, z, i] of legs) {
    const x = 20 - i * 22;
    r.seg([x, 38, 34 * z], [x * 1.1 + 4, 50, 66 * z], 5, 4, L, { bone: name }, 6);
    r.seg([x * 1.1 + 4, 50, 66 * z], [x * 1.2 + 8, 1, 84 * z], 4, 1.5, L, { bone: name }, 6);
  }
  for (const z of SIDES) {
    const b = z > 0 ? 'clawR' : 'clawL';
    r.seg([44, 40, 30 * z], [70, 36, 44 * z], 5, 4, L, { bone: b }, 6);
    r.sph(9, S, { p: [76, 36, 46 * z], s: [1.4, 0.8, 0.9], bone: b }, 8, 6);
    r.cone(3, 12, D, { p: [88, 38, 46 * z], r: [0, 0, -PI / 2], bone: b }, 4);
  }
  const walk = { torso: { p: [0, 2, 0] } };
  for (const [name, z, i] of legs) walk[name] = { r: [((i + (z > 0 ? 0 : 1)) % 2 ? -0.2 : 0.2) * z, ((i + (z > 0 ? 0 : 1)) % 2 ? 0.35 : -0.35), 0] };
  r.pose('walk', walk);
  r.pose('breath', { torso: { s: [1.02, 1.05, 1.02] }, clawR: { r: [0, 0.1, 0.1] }, clawL: { r: [0, -0.1, 0.1] } });
  r.pose('raise', { clawR: { r: [0, 0, 0.6] }, clawL: { r: [0, 0, 0.6] } });
  r.pose('strike', { clawR: { r: [0, 0, -0.3] }, clawL: { r: [0, 0, -0.3] }, torso: { r: [0, 0, -0.08] } });
  return r.build();
}

// 通用兜底：小型岩石生物
function buildBlob(detail) { return buildKrug(detail, false); }

const BLUE_FLAME = 0x4aa8ff; const RED_FLAME = 0xff7a2a;
export const CAMP_SPECS = {
  blue_sentinel: { key: 'blue', build: buildBlue, h: 245, stride: 5, flames: [[-66, 262, 0, 90], [-56, 250, 30, 70], [-56, 250, -30, 70], [66, 196, 0, 46]], flame: BLUE_FLAME },
  red_brambleback: { key: 'red', build: buildRed, h: 215, stride: 5.5, flames: [[-14, 204, 0, 96], [-40, 186, 32, 70], [-40, 186, -32, 70]], flame: RED_FLAME },
  gromp: { key: 'gromp', build: buildGromp, h: 150, stride: 7, hop: true },
  murkwolf: { key: 'wolf', build: buildWolf, h: 128, stride: 12 },
  murkwolf_small: { key: 'wolf', build: buildWolf, h: 88, stride: 14, scale: 0.68 },
  raptor: { key: 'raptor', build: buildRaptor, h: 152, stride: 12 },
  raptor_small: { key: 'raptor', build: buildRaptor, h: 86, stride: 15, scale: 0.56 },
  krug_ancient: { key: 'krugA', build: (d) => buildKrug(d, true), h: 205, stride: 6, scale: 1.12 },
  krug: { key: 'krug', build: (d) => buildKrug(d, false), h: 150, stride: 7, scale: 0.85 },
  krug_split: { key: 'krug', build: (d) => buildKrug(d, false), h: 116, stride: 8, scale: 0.66 },
  krug_mini: { key: 'krug', build: (d) => buildKrug(d, false), h: 80, stride: 10, scale: 0.46 },
  krug_small: { key: 'krug', build: (d) => buildKrug(d, false), h: 80, stride: 10, scale: 0.46 },
  scuttle: { key: 'scuttle', build: buildScuttle, h: 96, stride: 14 },
  blob: { key: 'blob', build: buildBlob, h: 120, stride: 8, scale: 0.7 },
};

// ———————————————— 通用野怪视图 ————————————————
// spec: { key, build, h, stride, scale, hop, flames, flame, glowSprites, extra(v, mesh, dt, e), death: 'side'|'sink', deathTime }
export function createCreatureView(e, renderer, spec, { tint = null, keySuffix = '' } = {}) {
  const v = new UnitView(e, renderer, spec.h);
  v.tint = tint;
  const holder = new THREE.Group();
  const sc = spec.scale || 1;
  holder.scale.setScalar(sc);
  v.body.add(holder);
  v.holder = holder;
  const geo = cachedGeo(`mon|${spec.key}${keySuffix}|${v.detail}`, () => spec.build(v.detail));
  const m = v.mesh(geo, holder);
  v.meshMain = m;
  const flames = [];
  if (spec.flames) {
    const list = v.low ? spec.flames.slice(0, 1) : spec.flames;
    for (const f of list) flames.push({ s: v.sprite(spec.flame, f[3], [f[0], f[1], f[2]], holder, 0.8), base: f[3], y: f[1] });
  }
  if (tint != null) v.refresh();
  const side = (e.id || 0) % 2 ? 1 : -1;
  v.animate = (dt, en) => {
    const a = en.anim || {}; const st = a.state;
    trackAttack(v, v.dead ? {} : a, dt);
    const moving = !v.dead && (st === 'run' || st === 'dash');
    v.walk = approach(v.walk, moving ? 1 : 0, dt * 8);
    const spd = Math.max(0.5, Math.min(2, a.speed || 1));
    if (moving) v.phase += dt * spec.stride * spd;
    const s = Math.sin(v.phase);
    setPose(m, 'walk', spec.hop ? Math.abs(s) * v.walk : s * v.walk);
    setPose(m, 'breath', (0.5 + 0.5 * Math.sin(v.t * (spec.breathRate || 1.8))) * (1 - v.walk * 0.7));
    setPose(m, 'raise', v.raise);
    setPose(m, 'strike', v.strike);
    const b = v.body;
    if (v.dead) {
      const T = spec.deathTime || 0.6;
      const k = ease(v.deadT / T);
      if (spec.death === 'sink') {
        b.position.y = -ease(v.deadT / (T * 2.5)) * spec.h * 1.1;
        b.rotation.z = k * 0.25;
      } else {
        b.rotation.x = side * k * 1.35;
        b.position.y = -Math.max(0, v.deadT - T - 0.4) * 60 * sc;
      }
    } else {
      b.position.y = spec.hop ? Math.abs(s) * 26 * v.walk : Math.abs(s) * 3 * v.walk * sc;
      if (st === 'stunned' || st === 'airborne') b.rotation.z = Math.sin(v.t * 16) * 0.05;
      else b.rotation.z = 0;
      b.rotation.x = 0;
    }
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i];
      const fl = v.dead ? Math.max(0, 1 - v.deadT / 0.6) : 1;
      const k = f.base * fl * (1 + 0.14 * Math.sin(v.t * 9 + i * 2.1) + 0.08 * Math.sin(v.t * 23 + i));
      f.s.scale.set(k * 0.85, k * 1.15, 1);
      f.s.position.y = f.y + Math.sin(v.t * 7 + i) * 4;
    }
    spec.extra?.(v, m, dt, en);
  };
  return v;
}

export function createMonsterViewBasic(e, renderer) {
  const spec = CAMP_SPECS[e.kind] || CAMP_SPECS.blob;
  return createCreatureView(e, renderer, spec);
}
export { clamp01 };
