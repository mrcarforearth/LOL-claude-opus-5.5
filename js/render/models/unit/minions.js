// 小兵模型：近战（剑盾甲兵）、远程（法杖法师）、炮车（带轮攻城炮）、超级兵（重甲巨兵）
// 性能：按 种类×队伍×画质 缓存合并几何体（顶点色 + morph 姿态）；近战/超级兵 1 个 draw call，法师 2（身体 + 法球光晕），炮车 3（车身 + 前后轮轴）
import { Rig, UnitView, cachedGeo, setPose, trackAttack, approach, ease, PI, clamp01 } from './kit.js';
import { pal } from './palette.js';

const SIDES = [1, -1];

// ———————————————— 近战小兵（约 110） ————————————————
function buildMelee(t, detail) {
  const P = pal(t); const chaos = t === 1; const r = new Rig(detail);
  r.bone('legR', [0, 40, 10]).bone('legL', [0, 40, -10]).bone('torso', [0, 46, 0])
    .bone('head', [0, 82, 0], 'torso').bone('armR', [0, 76, 22], 'torso').bone('handR', [10, 42, 25], 'armR')
    .bone('armL', [0, 76, -22], 'torso');
  for (const z of SIDES) {
    const b = z > 0 ? 'legR' : 'legL';
    r.cyl(6, 7.5, 30, P.l, { p: [0, 26, 10 * z], bone: b });
    r.box(22, 12, 15, P.d, { p: [3, 6, 10 * z], bone: b });
    r.sph(7.5, P.p, { p: [4, 24, 10 * z], s: [1, 1.1, 0.9], bone: b });
  }
  // 腰甲裙
  r.cyl(18, 23, 16, P.a2, { p: [0, 43, 0] }, 10);
  r.box(4, 16, 14, P.m, { p: [21, 42, 0], r: [0, 0, 0.25] });
  // 胸甲
  r.cyl(23, 18, 30, P.a, { p: [0, 62, 0], bone: 'torso' }, 10);
  r.box(9, 26, 30, chaos ? P.p : P.p, { p: [15, 63, 0], r: [0, 0, 0.12], bone: 'torso' });
  r.box(3, 20, 6, P.m, { p: [20, 63, 0], r: [0, 0, 0.12], bone: 'torso' });
  r.tor(19.5, 2.6, P.m, { p: [0, 49, 0], r: [PI / 2, 0, 0], bone: 'torso' });
  for (const z of SIDES) {
    r.sph(13, P.p, { p: [0, 77, 22 * z], s: [1, 0.72, 1], bone: 'torso' });
    r.tor(11.5, 2, P.m, { p: [0, 73, 22 * z], r: [PI / 2, 0, 0], bone: 'torso' });
    if (chaos) {
      r.cone(4, 15, P.m, { p: [-2, 87, 24 * z], r: [0.5 * z, 0, 0.2], bone: 'torso' });
      r.cone(3, 10, P.m, { p: [6, 84, 26 * z], r: [0.8 * z, 0, -0.3], bone: 'torso' });
    }
  }
  // 头盔
  r.sph(15.5, chaos ? P.a2 : P.p, { p: [2, 93, 0], s: [1.05, 1, 0.95], bone: 'head' });
  r.box(7, 5, 20, P.d, { p: [15, 91, 0], bone: 'head' });
  for (const z of SIDES) r.box(2, 2.4, 3.4, P.e, { p: [18.4, 91, 5 * z], bone: 'head', glow: 1.6 });
  r.box(5, 8, 16, chaos ? P.a2 : P.p, { p: [14, 84, 0], r: [0, 0, -0.3], bone: 'head' });
  if (chaos) {
    for (const z of SIDES) r.seg([0, 102, 9 * z], [-9, 118, 17 * z], 3.4, 0.4, P.m, { bone: 'head' }, 6);
    r.cone(3, 12, P.m, { p: [4, 110, 0], r: [0, 0, 0.2], bone: 'head' });
  } else {
    r.box(22, 12, 3, P.m, { p: [-2, 108, 0], r: [0, 0, 0.1], bone: 'head' });
    r.box(14, 7, 5, P.a, { p: [-8, 111, 0], r: [0, 0, 0.3], bone: 'head' });
  }
  // 右臂 + 剑
  r.seg([0, 76, 23], [4, 58, 25], 6, 5.5, P.a, { bone: 'armR' });
  r.seg([4, 58, 25], [10, 44, 25], 5.5, 5, P.l, { bone: 'armR' });
  r.sph(6.5, P.p, { p: [10, 42, 25], bone: 'armR' });
  const sa = 0.25; const cx = Math.cos(sa); const cy = Math.sin(sa);
  const H = [10, 42, 25];
  const at = (k) => [H[0] + cx * k, H[1] + cy * k, H[2]];
  r.seg(at(-7), at(3), 2, 2, P.l, { bone: 'handR' }, 6);
  r.sph(3, P.m, { p: at(-8), bone: 'handR' }, 6, 4);
  r.box(3.5, 3.5, 17, P.m, { p: at(4), r: [0, 0, sa], bone: 'handR' });
  if (chaos) {
    r.box(40, 11, 2.4, P.s, { p: at(25), r: [0, 0, sa], bone: 'handR' });
    r.box(40, 2.4, 2.8, P.accent ?? P.g, { p: at(25), r: [0, 0, sa], bone: 'handR', glow: 0.5 });
    r.cone(6, 10, P.s, { p: at(47), r: [0, 0, sa - PI / 2], bone: 'handR' }, 4);
  } else {
    r.box(42, 7, 2, P.s, { p: at(26), r: [0, 0, sa], bone: 'handR' });
    r.box(38, 1.6, 2.4, P.p, { p: at(24), r: [0, 0, sa], bone: 'handR' });
    r.cone(3.6, 8, P.s, { p: at(51), r: [0, 0, sa - PI / 2], bone: 'handR' }, 4);
  }
  // 左臂 + 盾
  r.seg([0, 76, -23], [6, 58, -26], 6, 5.5, P.a, { bone: 'armL' });
  r.seg([6, 58, -26], [14, 50, -26], 5.5, 5, P.l, { bone: 'armL' });
  if (chaos) {
    r.box(4, 38, 26, P.a2, { p: [18, 54, -27], bone: 'armL' });
    r.box(5, 30, 4, P.m, { p: [19, 54, -27], bone: 'armL' });
    r.cone(4.5, 14, P.m, { p: [25, 54, -27], r: [0, 0, -PI / 2], bone: 'armL' }, 6);
    r.cone(3, 10, P.m, { p: [18, 76, -27], bone: 'armL' }, 5);
    r.cone(3, 10, P.m, { p: [18, 32, -27], r: [PI, 0, 0], bone: 'armL' }, 5);
  } else {
    r.cyl(19, 19, 4, P.a, { p: [18, 54, -27], r: [0, 0, PI / 2], bone: 'armL' }, 14);
    r.tor(18.5, 2.3, P.m, { p: [18, 54, -27], r: [0, PI / 2, 0], bone: 'armL' });
    r.box(1.5, 26, 6, P.p, { p: [20.2, 54, -27], bone: 'armL' });
    r.box(1.5, 6, 26, P.p, { p: [20.2, 54, -27], bone: 'armL' });
    r.sph(5, P.m, { p: [21, 54, -27], bone: 'armL' }, 8, 6);
  }
  r.pose('walk', { legR: { r: [0, 0, 0.55] }, legL: { r: [0, 0, -0.55] }, armR: { r: [0, 0, -0.22] }, armL: { r: [0, 0, 0.18] }, torso: { r: [0, 0.07, 0] } });
  r.pose('raise', { torso: { r: [0, -0.25, 0.12] }, armR: { r: [-0.15, 0, 1.85] }, handR: { r: [0, 0, 0.45] }, armL: { r: [0, 0, 0.45] } });
  r.pose('strike', { torso: { r: [0, 0.22, -0.2] }, armR: { r: [0, 0, 0.75] }, handR: { r: [0, 0, -1.1] }, armL: { r: [0, 0, 0.2] } });
  return r.build();
}

// ———————————————— 远程法师小兵（约 110） ————————————————
const CASTER_TIP = [15, 106, 22];
function buildCaster(t, detail) {
  const P = pal(t); const chaos = t === 1; const r = new Rig(detail);
  r.bone('legR', [0, 24, 8]).bone('legL', [0, 24, -8]).bone('torso', [0, 44, 0])
    .bone('head', [0, 76, 0], 'torso').bone('armR', [0, 70, 18], 'torso').bone('armL', [0, 70, -18], 'torso');
  for (const z of SIDES) {
    const b = z > 0 ? 'legR' : 'legL';
    r.cyl(5, 5.5, 18, P.l, { p: [0, 14, 8 * z], bone: b });
    r.box(19, 8, 12, P.d, { p: [5, 4, 8 * z], bone: b });
  }
  // 长袍
  r.cyl(15, 25, 44, P.c, { p: [0, 30, 0] }, 12);
  r.tor(24, 2.2, P.m, { p: [0, 9, 0], r: [PI / 2, 0, 0] });
  r.box(4, 40, 12, P.p, { p: [20, 30, 0], r: [0, 0, 0.22] });
  r.box(4.5, 36, 3, P.m, { p: [20.5, 30, 0], r: [0, 0, 0.22] });
  // 上身与披肩
  r.cyl(16, 14, 24, P.c, { p: [0, 57, 0], bone: 'torso' }, 10);
  r.tor(14.5, 2.4, P.m, { p: [0, 47, 0], r: [PI / 2, 0, 0], bone: 'torso' });
  r.cyl(23, 18, 9, P.a, { p: [0, 70, 0], bone: 'torso' }, 10);
  r.cyl(25, 23, 3, P.m, { p: [0, 66, 0], bone: 'torso' }, 10);
  if (chaos) for (const z of SIDES) r.cone(3.5, 12, P.m, { p: [-4, 78, 18 * z], r: [0.6 * z, 0, 0.3], bone: 'torso' }, 5);
  // 兜帽 + 发光双眼
  r.sph(12, P.d, { p: [4, 82, 0], bone: 'head' }, 10, 7);
  for (const z of SIDES) r.box(2, 2.2, 3.4, P.e, { p: [15.4, 82, 4.5 * z], bone: 'head', glow: 2 });
  r.sph(15, P.a, { p: [0, 85, 0], s: [1, 1, 1.02], bone: 'head' }, 10, 7);
  if (chaos) {
    r.cone(13, 26, P.a, { p: [-6, 102, 0], r: [0, 0, 0.55], bone: 'head' }, 8);
    for (const z of SIDES) r.seg([-2, 94, 11 * z], [-14, 106, 20 * z], 3.2, 0.4, P.m, { bone: 'head' }, 5);
  } else {
    r.cone(15, 34, P.a, { p: [-5, 104, 0], r: [0, 0, 0.3], bone: 'head' }, 10);
    r.tor(14, 2, P.m, { p: [0, 91, 0], r: [PI / 2 + 0.05, 0, 0.12], bone: 'head' });
    r.sph(3, P.m, { p: [-14, 121, 0], bone: 'head' }, 6, 4);
  }
  // 持杖右臂
  r.seg([0, 70, 19], [6, 55, 22], 5, 4.6, P.c, { bone: 'armR' });
  r.seg([6, 55, 22], [12, 47, 22], 4.6, 4.2, P.c, { bone: 'armR' });
  r.sph(4.5, P.skin, { p: [12.5, 46, 22], bone: 'armR' }, 8, 6);
  r.seg([10, 6, 22], [14.5, 96, 22], 2.1, 2.3, chaos ? P.d : P.wood, { bone: 'armR' }, 6);
  if (chaos) {
    for (const a of [0, 2.1, 4.2]) {
      const dz = Math.sin(a) * 7; const dx = Math.cos(a) * 7;
      r.seg([14.5, 95, 22], [CASTER_TIP[0] + dx, 112, 22 + dz], 1.8, 0.5, P.m, { bone: 'armR' }, 5);
    }
  } else {
    r.tor(8.5, 1.8, P.m, { p: [15, 104, 22], r: [0, PI / 2, 0], bone: 'armR' }, 5, 12);
    r.cone(3, 6, P.m, { p: [15, 114, 22], bone: 'armR' }, 5);
  }
  r.sph(5.5, P.g, { p: CASTER_TIP, bone: 'armR', glow: 3 }, 8, 6);
  // 左臂
  r.seg([0, 70, -19], [5, 55, -22], 5, 4.6, P.c, { bone: 'armL' });
  r.seg([5, 55, -22], [13, 50, -20], 4.6, 4.2, P.c, { bone: 'armL' });
  r.sph(4.2, P.skin, { p: [14, 50, -20], bone: 'armL' }, 8, 6);
  r.pose('walk', { legR: { r: [0, 0, 0.5] }, legL: { r: [0, 0, -0.5] }, armR: { r: [0, 0, 0.1] }, armL: { r: [0, 0, 0.22] }, torso: { r: [0, 0.05, 0] } });
  r.pose('raise', { torso: { r: [0, -0.18, 0.12] }, armR: { r: [-0.1, 0, 0.35], p: [0, 7, 0] }, armL: { r: [-0.3, 0, 0.9] } });
  r.pose('strike', { torso: { r: [0, 0.15, -0.18] }, armR: { r: [0, 0, -0.75], p: [4, 2, 0] }, armL: { r: [0, 0, 0.3] } });
  const g = r.build();
  g.userData.tip = { p: CASTER_TIP, d: r.pointDeltas(CASTER_TIP, 'armR') };
  return g;
}

// ———————————————— 超级兵（约 170） ————————————————
function buildSuper(t, detail) {
  const P = pal(t); const chaos = t === 1; const r = new Rig(detail);
  r.bone('legR', [0, 58, 22]).bone('legL', [0, 58, -22]).bone('torso', [0, 62, 0])
    .bone('head', [18, 124, 0], 'torso').bone('armR', [0, 120, 46], 'torso').bone('armL', [0, 120, -46], 'torso');
  for (const z of SIDES) {
    const b = z > 0 ? 'legR' : 'legL';
    r.seg([0, 60, 22 * z], [2, 16, 24 * z], 13, 12, P.a2, { bone: b });
    r.box(36, 20, 28, P.d, { p: [6, 10, 24 * z], bone: b });
    r.box(10, 12, 30, P.m, { p: [22, 12, 24 * z], r: [0, 0, 0.35], bone: b });
    r.sph(11, P.p, { p: [9, 40, 24 * z], s: [1, 1.25, 0.9], bone: b });
  }
  r.cyl(30, 35, 24, P.a2, { p: [0, 62, 0] }, 12);
  r.box(8, 26, 24, P.m, { p: [32, 58, 0], r: [0, 0, 0.2] });
  // 躯干
  r.cyl(34, 30, 26, P.l, { p: [2, 78, 0], bone: 'torso' }, 12);
  r.sph(46, P.a, { p: [4, 108, 0], s: [0.95, 0.85, 1.08], bone: 'torso' }, 14, 10);
  r.box(16, 36, 46, P.p, { p: [36, 104, 0], r: [0, 0, 0.18], bone: 'torso' });
  r.box(4, 30, 10, P.m, { p: [44, 104, 0], r: [0, 0, 0.18], bone: 'torso' });
  r.tor(33, 3.5, P.m, { p: [2, 88, 0], r: [PI / 2, 0, 0], bone: 'torso' });
  if (chaos) for (let i = 0; i < 4; i++) r.cone(5, 20, P.m, { p: [-38, 104 + i * 10, (i - 1.5) * 14], r: [0, 0, 1.2], bone: 'torso' }, 5);
  else r.box(12, 24, 34, P.a2, { p: [-38, 110, 0], r: [0, 0, -0.2], bone: 'torso' });
  for (const z of SIDES) {
    r.sph(27, P.p, { p: [0, 128, 46 * z], s: [1.1, 0.78, 1], bone: 'torso' }, 12, 8);
    r.tor(24, 3, P.m, { p: [0, 122, 46 * z], r: [PI / 2, 0, 0], bone: 'torso' });
    if (chaos) {
      r.cone(6, 26, P.m, { p: [-4, 150, 52 * z], r: [0.4 * z, 0, 0.15], bone: 'torso' }, 6);
      r.cone(4.5, 18, P.m, { p: [14, 146, 54 * z], r: [0.6 * z, 0, -0.35], bone: 'torso' }, 5);
    } else {
      r.box(30, 5, 12, P.m, { p: [0, 146, 50 * z], r: [0.25 * z, 0, 0], bone: 'torso' });
    }
  }
  // 头（缩在双肩之间）
  r.sph(16, chaos ? P.a2 : P.p, { p: [22, 132, 0], bone: 'head' }, 10, 8);
  r.box(6, 6, 20, P.d, { p: [36, 131, 0], bone: 'head' });
  for (const z of SIDES) r.box(2, 2.6, 4, P.e, { p: [39.2, 131, 5.5 * z], bone: 'head', glow: 1.8 });
  if (chaos) for (const z of SIDES) r.seg([20, 144, 10 * z], [8, 168, 22 * z], 4.2, 0.5, P.m, { bone: 'head' }, 6);
  else { r.box(26, 14, 4, P.m, { p: [18, 150, 0], r: [0, 0, 0.12], bone: 'head' }); r.box(16, 8, 6, P.a, { p: [10, 154, 0], r: [0, 0, 0.3], bone: 'head' }); }
  // 双臂 + 巨拳
  for (const z of SIDES) {
    const b = z > 0 ? 'armR' : 'armL';
    r.seg([0, 120, 50 * z], [6, 84, 56 * z], 13, 12, P.a, { bone: b });
    r.seg([6, 84, 56 * z], [14, 56, 56 * z], 13, 16, P.p, { bone: b });
    r.tor(15, 2.6, P.m, { p: [10, 70, 56 * z], r: [PI / 2, 0, -0.25], bone: b });
    r.box(28, 26, 28, P.m, { p: [16, 44, 56 * z], bone: b });
    if (chaos) for (const dx of [-8, 8]) r.cone(4, 12, P.s, { p: [16 + dx, 44, 56 * z + 16 * z], r: [PI / 2 * z, 0, 0], bone: b }, 5);
    else r.box(6, 20, 30, P.p, { p: [31, 44, 56 * z], bone: b });
  }
  r.pose('walk', { legR: { r: [0, 0, 0.42] }, legL: { r: [0, 0, -0.42] }, armR: { r: [0, 0, -0.24] }, armL: { r: [0, 0, 0.24] }, torso: { r: [0.04, 0.06, 0] } });
  r.pose('raise', { torso: { r: [0, 0, 0.16] }, armR: { r: [-0.25, 0, 2.0] }, armL: { r: [0.25, 0, 2.0] } });
  r.pose('strike', { torso: { r: [0, 0, -0.3] }, armR: { r: [0, 0, 0.6] }, armL: { r: [0, 0, 0.6] } });
  return r.build();
}

// ———————————————— 炮车（约 150） ————————————————
const WHEEL_R = 22;
const AXLES = [32, -30];
function buildSiege(t, detail) {
  const P = pal(t); const chaos = t === 1; const r = new Rig(detail);
  r.bone('barrel', [-10, 76, 0]).bone('flag', [-40, 64, 0]);
  // 底盘
  r.box(96, 20, 52, chaos ? P.d : P.wood, { p: [0, 32, 0] });
  for (const z of SIDES) {
    r.box(86, 26, 4, P.a, { p: [0, 40, 27 * z] });
    r.box(88, 4, 5, P.m, { p: [0, 53, 27.5 * z] });
    r.box(88, 4, 5, P.m, { p: [0, 28, 27.5 * z] });
    for (const x of [-26, 0, 26]) r.sph(3, P.m, { p: [x, 40, 29.5 * z] }, 6, 4);
  }
  // 车头冲角
  if (chaos) {
    r.box(18, 30, 50, P.a2, { p: [50, 38, 0], r: [0, 0, 0.3] });
    for (const z of [-18, -6, 6, 18]) r.cone(4.5, 22, P.m, { p: [64, 34, z], r: [0, 0, -PI / 2 + 0.2] }, 5);
  } else {
    r.box(16, 30, 50, P.p, { p: [50, 38, 0], r: [0, 0, 0.35] });
    r.box(6, 24, 12, P.m, { p: [56, 40, 0], r: [0, 0, 0.35] });
    r.oct(8, P.m, { p: [58, 44, 0], s: [0.5, 1, 1] });
  }
  // 上层车厢
  r.box(66, 24, 44, P.a, { p: [-8, 54, 0] });
  r.box(70, 4, 48, P.m, { p: [-8, 67, 0] });
  r.box(22, 16, 46, P.a2, { p: [-34, 72, 0] });
  // 炮管
  r.sph(17, P.s, { p: [-10, 76, 0], bone: 'barrel' }, 10, 8);
  r.cyl(10.5, 13.5, 66, chaos ? P.s : P.p, { p: [22, 78, 0], r: [0, 0, -PI / 2 + 0.07], bone: 'barrel' }, 12);
  r.tor(12.5, 3.2, P.m, { p: [4, 77, 0], r: [0, PI / 2, 0], bone: 'barrel' });
  r.tor(12, 3.8, P.m, { p: [54, 80, 0], r: [0, PI / 2, 0], bone: 'barrel' });
  r.cyl(8, 8, 3, P.d, { p: [56.5, 80.2, 0], r: [0, 0, PI / 2], bone: 'barrel' }, 10);
  if (chaos) {
    for (const z of SIDES) r.cone(3.5, 12, P.m, { p: [52, 86, 10 * z], r: [0.5 * z, 0, -0.5], bone: 'barrel' }, 5);
    r.cone(4, 14, P.m, { p: [30, 92, 0], r: [0, 0, 0.25], bone: 'barrel' }, 5);
  } else {
    r.box(40, 3, 3, P.m, { p: [26, 91, 0], r: [0, 0, 0.07], bone: 'barrel' });
  }
  // 旗杆与旗帜
  r.seg([-40, 60, 0], [-42, 146, 0], 2.6, 2, chaos ? P.d : P.m, { bone: 'flag' }, 6);
  r.sheet([[-43, 142, 0], [-72, 138, 0], [-68, 118, 0], [-73, 100, 0], [-43, 104, 0]], chaos ? P.a2 : P.a, { bone: 'flag' });
  r.box(10, 10, 1, P.m, { p: [-57, 121, 0], r: [0, 0, PI / 4], bone: 'flag', glow: 0.3 });
  if (chaos) r.cone(3.5, 14, P.m, { p: [-42, 152, 0], bone: 'flag' }, 5);
  else r.sph(4.5, P.m, { p: [-42, 149, 0], bone: 'flag' }, 8, 6);
  r.pose('walk', { flag: { r: [0, 0.35, 0] } });
  r.pose('raise', { barrel: { r: [0, 0, 0.14] } });
  r.pose('strike', { barrel: { p: [-13, 0, 0], r: [0, 0, 0.05] } });
  return r.build();
}
function buildSiegeAxle(t, detail) {
  const P = pal(t); const chaos = t === 1; const r = new Rig(detail);
  r.cyl(2.8, 2.8, 70, P.d, { r: [PI / 2, 0, 0] }, 6);
  for (const z of SIDES) {
    r.cyl(WHEEL_R - 3, WHEEL_R - 3, 8, chaos ? P.d : P.wood, { p: [0, 0, 32 * z], r: [PI / 2, 0, 0] }, 14);
    r.tor(WHEEL_R - 2, 3.2, chaos ? P.s : P.m, { p: [0, 0, 32 * z] }, 5, 16);
    r.cyl(5, 5, 11, P.m, { p: [0, 0, 32 * z], r: [PI / 2, 0, 0] }, 8);
    for (let i = 0; i < 3; i++) r.box(2.5, WHEEL_R * 1.8, 3, P.d, { p: [0, 0, 32 * z + 4.2 * z], r: [0, 0, (i * PI) / 3] });
    if (chaos) for (let i = 0; i < 6; i++) {
      const a = (i * PI) / 3;
      r.cone(2.5, 8, P.s, { p: [Math.cos(a) * (WHEEL_R + 3), Math.sin(a) * (WHEEL_R + 3), 32 * z], r: [0, 0, a - PI / 2] }, 4);
    }
  }
  return r.build();
}

const SPEC = {
  melee: { build: buildMelee, height: 112, stride: 11 },
  caster: { build: buildCaster, height: 112, stride: 10 },
  super: { build: buildSuper, height: 172, stride: 8 },
  siege: { build: buildSiege, height: 152, stride: 0 },
};

// ———————————————— 视图 ————————————————
export function createMinionView(e, renderer) {
  const kind = SPEC[e.kind] ? e.kind : 'melee';
  const t = e.team === 1 ? 1 : 0;
  const spec = SPEC[kind];
  const v = new UnitView(e, renderer, spec.height);
  const geo = cachedGeo(`minion|${kind}|${t}|${v.detail}`, () => spec.build(t, v.detail));
  const m = v.mesh(geo);
  v.emp = !!e.empowered;
  let orb = null; let tip = null; let axles = null;
  if (kind === 'caster') {
    tip = geo.userData.tip;
    orb = v.sprite(pal(t).g, 34, tip.p, v.body, 0.85);
  } else if (kind === 'siege') {
    const ag = cachedGeo(`minion|axle|${t}|${v.detail}`, () => buildSiegeAxle(t, v.detail));
    axles = AXLES.map((x) => { const w = v.mesh(ag); w.position.set(x, WHEEL_R, 0); return w; });
  }
  if (v.emp) v.refresh();
  const W = { walk: 0, raise: 0, strike: 0 };
  let roll = 0;
  v.animate = (dt, en) => {
    const a = en.anim || {};
    if (v.emp !== !!en.empowered) v.setEmpowered(en.empowered);
    const st = v.dead ? 'death' : a.state;
    trackAttack(v, v.dead ? {} : a, dt);
    const moving = st === 'run' || st === 'dash';
    v.walk = approach(v.walk, moving ? 1 : 0, dt * 10);
    const spd = Math.max(0.5, Math.min(2, a.speed || 1));
    if (moving) v.phase += dt * (spec.stride || 6) * spd;
    const s = Math.sin(v.phase);
    if (kind === 'siege') {
      W.walk = Math.sin(v.t * 3.2) * (0.35 + 0.65 * v.walk);
      if (moving) roll -= (dt * 325 * spd) / WHEEL_R;
      for (const w of axles) w.rotation.z = roll;
    } else W.walk = s * v.walk;
    W.raise = v.raise; W.strike = v.strike;
    setPose(m, 'walk', W.walk); setPose(m, 'raise', W.raise); setPose(m, 'strike', W.strike);
    const b = v.body;
    if (v.dead) {
      const k = ease(v.deadT / 0.45);
      if (kind === 'siege') {
        b.rotation.x = k * 0.5; b.rotation.z = -k * 0.15;
        b.position.y = -Math.max(0, v.deadT - 0.5) * 70;
      } else {
        b.rotation.z = k * 1.45;
        b.position.x = -k * 18;
        b.position.y = -Math.max(0, v.deadT - 0.75) * 55;
      }
    } else {
      const bob = kind === 'siege' ? Math.abs(Math.sin(roll * 2)) * 1.6 * v.walk : Math.abs(s) * 4 * v.walk;
      const breath = kind === 'siege' ? 0 : Math.sin(v.t * 2.2) * 0.8 * (1 - v.walk);
      b.position.set(0, bob + breath, 0);
      if (st === 'stunned' || st === 'airborne') { b.rotation.z = Math.sin(v.t * 18) * 0.06; b.rotation.x = 0; }
      else { b.rotation.z = kind === 'siege' ? 0 : -0.06 * v.walk; b.rotation.x = 0; }
    }
    if (orb) {
      const d = tip.d; const p = tip.p; const wv = W.walk; const ra = W.raise; const sk = W.strike;
      orb.position.set(
        p[0] + d.walk[0] * wv + d.raise[0] * ra + d.strike[0] * sk,
        p[1] + d.walk[1] * wv + d.raise[1] * ra + d.strike[1] * sk,
        p[2] + d.walk[2] * wv + d.raise[2] * ra + d.strike[2] * sk);
      const pulse = 30 + Math.sin(v.t * 6) * 3 + v.raise * 16 + v.strike * 10;
      const sz = v.dead ? pulse * (1 - clamp01(v.deadT / 0.4)) : pulse;
      orb.scale.set(sz, sz, 1);
    }
  };
  v.onRevive = () => { v.atkT = null; };
  return v;
}
