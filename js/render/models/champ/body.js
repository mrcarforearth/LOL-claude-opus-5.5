// 人形骨架 + 基础身体（躯干/四肢/头/五官）+ 头发、布料等通用部件
// 骨骼：hips → spine → chest → head；chest → shL/shR → uaL/uaR → faL/faR → hdL/hdR → wpL/wpR；hips → thL/thR → snL/snR → ftL/ftR
import { geo, flipGeo, PI, TAU } from './kit.js';

const DEF_PROP = { leg: 0.46, torso: 0.3, head: 0.088, shoulder: 0.125, hipW: 0.052, arm: 0.36, neck: 0.028 };

// o: { H, bulk, slim, female, child, prop, skin, c:{chest,belly,pelvis,ua,fa,hand,th,sn,foot}, eye, eyeGlow, muscle, fist, noFace, noHead, headScale }
export function humanoid(bp, o) {
  const H = o.H;
  const P = { ...DEF_PROP, ...(o.prop || {}) };
  const bulk = o.bulk ?? 1;
  const slim = o.slim ?? 1;
  const c = { chest: o.skin, belly: o.skin, pelvis: o.skin, ua: o.skin, fa: o.skin, hand: o.skin, th: o.skin, sn: o.skin, foot: o.skin, neck: o.skin, ...(o.c || {}) };
  const hipY = H * P.leg;
  const ankle = H * 0.045;
  const hipJ = hipY - H * 0.015;
  const Lt = (hipJ - ankle) * 0.5, Ls = (hipJ - ankle) * 0.5;
  const spineOff = H * 0.06;
  const chestOff = H * P.torso * 0.45;
  const chestY = hipY + spineOff + chestOff;
  const neckY = hipY + H * P.torso;
  const headR = H * P.head * (o.headScale || 1);
  const shY = neckY - H * 0.04;
  const shW = H * P.shoulder * bulk;
  const La = H * P.arm * 0.52, Lf = H * P.arm * 0.44;
  const M = { H, P, bulk, slim, hipY, hipJ, ankle, Lt, Ls, chestY, neckY, headR, shY, shW, La, Lf, female: !!o.female, child: !!o.child };
  M.headC = [H * 0.008, H * P.neck + headR * 0.88, 0]; // 头部中心（相对 head 骨）
  bp.meta.M = M;

  bp.bone('hips', null, 0, hipY, 0);
  bp.bone('spine', 'hips', 0, spineOff, 0);
  bp.bone('chest', 'spine', 0, chestOff, 0);
  bp.bone('head', 'chest', 0, neckY - chestY, 0);
  for (const [sd, s] of [['L', -1], ['R', 1]]) {
    bp.bone('sh' + sd, 'chest', 0, shY - chestY, s * shW * 0.42);
    bp.bone('ua' + sd, 'sh' + sd, 0, 0, s * shW * 0.58);
    bp.bone('fa' + sd, 'ua' + sd, 0, -La, 0);
    bp.bone('hd' + sd, 'fa' + sd, 0, -Lf, 0);
    bp.bone('wp' + sd, 'hd' + sd, 0, -H * 0.03, 0);
    bp.bone('th' + sd, 'hips', 0, hipJ - hipY, s * H * P.hipW * (o.female ? 1.12 : 1));
    bp.bone('sn' + sd, 'th' + sd, 0, -Lt, 0);
    bp.bone('ft' + sd, 'sn' + sd, 0, -Ls, 0);
  }

  const fem = o.female;
  const wS = bulk; // 躯干横向倍率
  const d = o.depth ?? 0.66; // 躯干前后厚度比
  // —— 骨盆 ——
  bp.add('hips', geo.lathe([[0.001, -0.07 * H], [0.05 * H, -0.068 * H], [0.085 * H, -0.035 * H], [(fem ? 0.094 : 0.088) * H, 0.01 * H], [0.078 * H, 0.07 * H]], 14), c.pelvis,
    { s: [d * 1.05, 1, fem ? 1.08 : wS * 0.95] });
  // —— 腹部 ——
  if (!o.noBelly) {
    bp.add('spine', geo.lathe([[0.075 * H, -0.02 * H], [(fem ? 0.066 : 0.074) * H, 0.035 * H], [(fem ? 0.072 : 0.084) * H, 0.085 * H]], 14), c.belly,
      { s: [d, 1, fem ? 0.95 : wS * 0.95] });
  }
  // —— 胸腔 ——
  if (!o.noChest) {
    const cw = fem ? 0.088 : 0.1;
    bp.add('chest', geo.lathe([[cw * 0.82 * H, -0.075 * H], [cw * H, -0.02 * H], [cw * 1.1 * H, 0.03 * H], [cw * 1.05 * H, 0.07 * H], [cw * 0.8 * H, 0.1 * H], [0.045 * H, 0.118 * H], [0.001, 0.12 * H]], 16), c.chest,
      { s: [d * 1.02, 1, wS] });
    if (fem) bp.pair('chest', geo.sph(0.034 * H, 10, 8), c.bust || c.chest, { p: [0.045 * H, 0.02 * H, -0.03 * H], s: [0.9, 0.95, 1] });
    if (o.muscle) {
      bp.pair('chest', geo.sph(0.05 * H, 10, 8), c.chest, { p: [0.036 * H, 0.035 * H, 0.036 * H], s: [0.55, 0.62, 0.9] });
      for (let i = 0; i < 3; i++) bp.pair('spine', geo.sph(0.022 * H, 8, 6), c.belly, { p: [0.052 * H, (0.075 - i * 0.03) * H, 0.02 * H], s: [0.5, 0.8, 0.9] });
    }
  }
  // —— 头与颈 ——
  if (!o.noHead) {
    bp.add('head', geo.cyl(0.03 * H, 0.036 * H, H * P.neck + 0.02 * H, 10), c.neck, { p: [0, (H * P.neck) / 2, 0] });
    const hc = M.headC;
    bp.add('head', geo.sph(headR, 18, 14), o.skin, { p: hc, s: [0.94, 1.02, 0.88] });
    if (!fem && !o.child) bp.add('head', geo.sph(headR * 0.7, 12, 8), o.skin, { p: [hc[0] + headR * 0.25, hc[1] - headR * 0.42, 0], s: [0.9, 0.7, 1.05] }); // 下颌
    if (!o.noFace) face(bp, M, o);
  }
  // —— 手臂 ——
  const ar = (o.armR ?? 0.04) * H * (o.female ? 0.82 : 1) * slim;
  bp.pair('ua', geo.capsule(ar * bulk, ar * 0.8, La, 12), c.ua);
  bp.pair('fa', geo.capsule(ar * 0.8, ar * 0.66, Lf, 12), c.fa);
  const hs = (o.handS ?? 1) * H * (o.female ? 0.85 : 1);
  if (o.fist !== false) bp.pair('hd', geo.sph(0.03 * hs, 10, 8), c.hand, { p: [0, -0.032 * hs, 0], s: [1.05, 1.2, 0.85] });
  else {
    bp.pair('hd', geo.box(0.045 * hs, 0.05 * hs, 0.018 * hs), c.hand, { p: [0, -0.03 * hs, 0] });
    bp.pair('hd', geo.box(0.018 * hs, 0.03 * hs, 0.014 * hs), c.hand, { p: [0.018 * hs, -0.022 * hs, -0.012 * hs], r: [0, 0, 0.5] });
  }
  // —— 腿 ——
  const lr = (o.legR ?? 0.052) * H * slim * (o.female ? 0.9 : 1);
  if (!o.noLegs) {
    bp.pair('th', geo.capsule(lr, lr * 0.78, Lt, 12), c.th);
    bp.pair('sn', geo.capsule(lr * 0.78, lr * 0.56, Ls, 12), c.sn);
    bp.pair('ft', geo.sph(0.03 * H, 10, 8), c.foot, { p: [0.022 * H, -ankle * 0.55, 0], s: [1.85, 0.8, 1.05] });
  }
  return M;
}

// 五官：眼白 + 虹膜 + 眉 + 鼻 + 嘴
export function face(bp, M, o) {
  const R = M.headR, [cx, cy] = M.headC;
  const big = o.female || o.child ? 1.2 : 1;
  const eyeC = o.eye ?? 0x3a2a1a;
  for (const s of [-1, 1]) {
    const z = s * R * 0.36;
    bp.add('head', geo.sph(R * 0.17 * big, 10, 8), 0xf8f4f0, { p: [cx + R * 0.8, cy + R * 0.06, z], s: [0.45, 0.85, 1] });
    bp.add('head', geo.sph(R * 0.11 * big, 8, 6), eyeC, { p: [cx + R * 0.86, cy + R * 0.04, z * 0.98], s: [0.4, 1, 0.85], glow: o.eyeGlow || 0 });
    bp.add('head', geo.box(R * 0.08, R * 0.06, R * 0.34), o.brow ?? 0x2a1a12, { p: [cx + R * 0.84, cy + R * 0.3, z], r: [s * (o.female ? -0.12 : 0.14), 0, 0] });
  }
  bp.add('head', geo.cone(R * 0.1, R * 0.26, 6), o.skin, { p: [cx + R * 0.95, cy - R * 0.1, 0], r: [0, 0, -PI / 2 - 0.25] });
  bp.add('head', geo.box(R * 0.05, R * 0.05, R * 0.3), o.mouth ?? 0x7a3a34, { p: [cx + R * 0.84, cy - R * 0.38, 0] });
}

// 头发：顶部发帽 + 后脑包裹；opts: { vol 放大倍率, back 后发下垂比例, fringe 刘海 }
export function hairCap(bp, M, color, { vol = 1.1, back = 0.72, fringe = true, c2 = null, top = 0.42 } = {}) {
  const R = M.headR, hc = M.headC;
  bp.add('head', geo.sphPart(R * vol, 0, TAU, 0, PI * top, 18, 7), color, { p: [hc[0] - R * 0.03, hc[1] + R * 0.02, 0], s: [1, 1.05, 0.95], c2 });
  bp.add('head', geo.sphPart(R * vol * 1.02, -PI / 2, PI, 0, PI * back, 14, 8), color, { p: [hc[0] - R * 0.05, hc[1], 0], s: [1, 1.05, 0.96], c2 });
  if (fringe) {
    for (let i = -2; i <= 2; i++) {
      bp.add('head', geo.cone(R * 0.2, R * 0.55, 5), color, { p: [hc[0] + R * 0.78, hc[1] + R * 0.45, i * R * 0.2], r: [i * 0.12, 0, -PI + 0.5] });
    }
  }
}

// 双面布料（披风/裙摆），挂在链式骨骼上；外侧颜色 cOut，内侧 cIn
export function cape(bp, parent, pts, cOut, cIn, { wTop, wBot, len, bulge = 0, p = [0, 0, 0], r = [0, 0, 0], ws = 6, hs = 8 }) {
  const names = bp.chain('cape', parent, pts);
  const g = geo.cloth(wTop, wBot, len, bulge, ws, hs);
  bp.add(names[0], g, cOut, { p, r, chain: names });
  bp.add(names[0], flipGeo(g), cIn, { p: [p[0] + 0.6, p[1], p[2]], r, chain: names });
  return names;
}

// 链式骨骼点列（直线等分）
export function linePts(from, to, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    pts.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]);
  }
  return pts;
}

// 沿曲线布置骨骼（CatmullRom 曲线上 i/n 处），返回相对父骨骼的点
export function curveBonePts(curve, n, origin) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const v = curve.getPointAt(i / n);
    pts.push([v.x - origin[0], v.y - origin[1], v.z - origin[2]]);
  }
  return pts;
}

// 锥形尾巴/发辫：曲线点（相对 parent 骨骼），自动布骨 + 蒙皮
export function tail(bp, prefix, parent, pts, radiusFn, color, { n = 3, segs = 18, rs = 8, glow = 0, c2 = null, shine = 0 } = {}) {
  const g = geo.tube(pts, radiusFn, segs, rs);
  const curve = g.userData.curve;
  const bpts = curveBonePts(curve, n, [0, 0, 0]);
  const names = bp.chain(prefix, parent, bpts);
  bp.add(names[0], g, color, { p: [-bpts[0][0], -bpts[0][1], -bpts[0][2]], chain: names, glow, c2, shine });
  return names;
}
