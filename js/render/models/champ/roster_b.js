// 英雄模型（二）：阿狸、拉克丝、安妮（含小熊）、艾希、金克丝、提伯斯
import * as THREE from 'three';
import { geo, PI, TAU, starPts, addMat, glowSprite, cachedGeo, clamp01 } from './kit.js';
import { humanoid, hairCap, cape, linePts, tail } from './body.js';

const cylX = (rt, rb, len, s = 10) => { const g = geo.cyl(rt, rb, len, s); g.rotateZ(-PI / 2); return g; };
const cylZ = (rt, rb, len, s = 10) => { const g = geo.cyl(rt, rb, len, s); g.rotateX(PI / 2); return g; };
const ringY = (R, r, s = 20) => { const g = geo.tor(R, r, 6, s); g.rotateX(PI / 2); return g; };

// 长发背片（双面布料，链式骨骼）
function hairSheet(bp, M, prefix, color, len, wTop, wBot, c2 = null) {
  const R = M.headR, hc = M.headC;
  const names = bp.chain(prefix, 'head', linePts([hc[0] - R * 0.82, hc[1] - R * 0.1, 0], [hc[0] - R * 1.0, hc[1] - R * 0.1 - len, 0], 3));
  const g = geo.cloth(wTop, wBot, len, R * 0.25, 5, 7);
  bp.add(names[0], g, color, { chain: names, c2 });
  bp.add(names[0], geo.cloth(wTop * 0.96, wBot * 0.96, len * 0.98, R * 0.2, 5, 7), color, { p: [0.8, 0, 0], r: [0, PI, 0], chain: names, c2 });
  return names;
}

// ———————————————— 阿狸 ————————————————
export function ahri(bp) {
  const H = 204, U = H / 220;
  const C = { skin: 0xf8dccb, hair: 0x241624, white: 0xf8f0f2, red: 0xc8243a, redD: 0x7a1424, gold: 0xf0c060, tail: 0xfdf8fa, tip: 0xffcfe6 };
  const M = humanoid(bp, {
    H, female: true, bulk: 0.88, skin: C.skin, eye: 0xe0a020, brow: C.hair, fist: false,
    c: { chest: C.white, belly: C.skin, pelvis: C.red, ua: C.skin, fa: C.skin, hand: C.skin, th: C.skin, sn: C.white, foot: C.red, bust: C.white },
  });
  const R = M.headR, hc = M.headC;
  // 衣裙：白色上衣红边 + 红色短裙白边 + 腰带
  bp.add('chest', ringY(0.078 * H, 1.6 * U), C.red, { p: [0, -0.05 * H, 0], s: [0.68, 1, 0.9] });
  bp.add('chest', geo.box(1.6 * U, 0.08 * H, 0.02 * H), C.red, { p: [0.062 * H, 0.06 * H, 0.02 * H], r: [0.5, 0, 0] });
  bp.add('chest', geo.box(1.6 * U, 0.08 * H, 0.02 * H), C.red, { p: [0.062 * H, 0.06 * H, -0.02 * H], r: [-0.5, 0, 0] });
  bp.add('hips', geo.lathe([[0.1 * H, -0.13 * H], [0.092 * H, -0.08 * H], [0.08 * H, -0.02 * H], [0.074 * H, 0.05 * H]], 16), C.red, { s: [0.82, 1, 1.12], c2: C.redD });
  bp.add('hips', ringY(0.1 * H, 1.6 * U), C.white, { p: [0, -0.128 * H, 0], s: [0.82, 1, 1.12] });
  bp.add('hips', ringY(0.076 * H, 2.4 * U), C.white, { p: [0, 0.045 * H, 0], s: [0.8, 1, 1.1] });
  bp.add('hips', geo.box(2 * U, 0.12 * H, 0.03 * H), C.gold, { p: [0.058 * H, -0.02 * H, 0.03 * H], r: [0.1, 0, 0.06] });
  // 分离式长袖（白色喇叭袖 + 红色袖口）
  bp.pair('fa', geo.cyl(0.032 * H, 0.058 * H, 0.13 * H, 12, true), C.white, { p: [0, -0.07 * H, 0] });
  bp.pair('fa', geo.cyl(0.058 * H, 0.06 * H, 0.012 * H, 12, true), C.red, { p: [0, -0.137 * H, 0] });
  bp.pair('ua', geo.tor(0.03 * H, 1.2 * U, 5, 12), C.red, { p: [0, -0.1 * H, 0], r: [PI / 2, 0, 0] });
  // 头发与狐耳
  hairCap(bp, M, C.hair, { vol: 1.1, back: 0.78 });
  const hb = hairSheet(bp, M, 'hairB', C.hair, 0.36 * H, R * 1.7, R * 2.1, 0x3a2040);
  for (const s of [-1, 1]) {
    bp.add('head', geo.tube([[hc[0] + R * 0.5, hc[1] + R * 0.2, s * R * 0.9], [hc[0] + R * 0.35, hc[1] - R * 1.2, s * R * 1.0], [hc[0] + R * 0.2, hc[1] - R * 2.6, s * R * 0.95]], (t) => (5.5 - 3.5 * t) * U, 10, 6), C.hair);
    bp.add('head', geo.cone(R * 0.34, R * 0.95, 4), C.hair, { p: [hc[0] - R * 0.1, hc[1] + R * 1.2, s * R * 0.55], r: [s * 0.38, 0, 0.12], s: [0.55, 1, 1] });
    bp.add('head', geo.cone(R * 0.22, R * 0.7, 4), 0xf7b0c8, { p: [hc[0] - R * 0.02, hc[1] + R * 1.12, s * R * 0.55], r: [s * 0.38, 0, 0.12], s: [0.35, 1, 1] });
  }
  bp.add('head', geo.oct(R * 0.14), C.gold, { p: [hc[0] + R * 0.1, hc[1] + R * 0.8, R * 0.72], shine: 1 });
  // 九尾（管道 + 链式骨骼摆动）
  const tails = [];
  for (let i = 0; i < 9; i++) {
    const a = ((i - 4) / 4) * 1.15;
    const ca = Math.cos(a), sa = Math.sin(a);
    const lift = 1 - Math.abs(i - 4) / 6;
    const pts = [[0, 0, 0], [-22 * ca, -2, 22 * sa], [-50 * ca, 12 + 10 * lift, 48 * sa], [-72 * ca, 42 + 26 * lift, 64 * sa], [-82 * ca + 6, 78 + 36 * lift, 64 * sa]]
      .map(([x, y, z]) => [x * U - 0.07 * H, y * U, z * U]);
    const names = tail(bp, `tl${i}_`, 'hips', pts, (t) => (1.6 + 10.5 * Math.pow(Math.sin(PI * Math.min(1, t * 0.92 + 0.06)), 0.75)) * U, C.tail,
      { n: 3, segs: 16, rs: 8, c2: C.tip });
    tails.push(names);
  }
  bp.meta.style = 'orb';
  bp.meta.height = 212;
  bp.meta.chains = [{ names: hb, kind: 'hair' }, ...tails.map((n, i) => ({ names: n, kind: 'tail', phase: i * 0.7 }))];
  bp.meta.rim = (ms) => (ms.spiritRush ? { rim: 0xff7ad8, rimI: 0.5 } : null);
  bp.overlays.push((v) => orbOverlay(v, 0x8ad8ff, 0xffffff, 9 * U, U));
}

// 漂浮宝珠：跟随右手上方
function orbOverlay(v, color, core, r, U) {
  const g = cachedGeo('orb' + r, () => new THREE.SphereGeometry(r, 16, 12));
  const inner = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: core, fog: false }));
  const shell = new THREE.Mesh(g, addMat(color, 0.7));
  shell.scale.setScalar(1.35);
  const spr = glowSprite(color, r * 6, 0.8);
  const grp = new THREE.Group();
  grp.add(inner, shell, spr);
  v.mover.add(grp);
  const tmp = new THREE.Vector3();
  let init = false;
  return {
    update(v2, e, dt) {
      grp.visible = v2.opacity > 0.5 && !e.modelState.orbOut;
      v2.boneWorldInMover('hdR', tmp);
      tmp.y += 20 * U + Math.sin(v2.time * 3) * 3 * U;
      tmp.x += 6 * U;
      if (!init) { grp.position.copy(tmp); init = true; } else grp.position.lerp(tmp, Math.min(1, dt * 14));
      spr.material.rotation = v2.time;
      const k = 1 + 0.1 * Math.sin(v2.time * 6);
      shell.scale.setScalar(1.35 * k);
    },
  };
}

// ———————————————— 拉克丝 ————————————————
export function lux(bp) {
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

// ———————————————— 安妮 ————————————————
export function annie(bp) {
  const H = 156, U = H / 220;
  const C = { skin: 0xf8d8c2, hair: 0xd23a34, hairL: 0xf06a4a, red: 0xd8303a, redD: 0x9a1c2c, white: 0xfaf4ee, purple: 0x3c2a52, shoe: 0x5a2a1a, bear: 0x4a3450, bearL: 0x7a6484 };
  const M = humanoid(bp, {
    H, child: true, female: true, bulk: 0.95, skin: C.skin, eye: 0x4a9a3a, brow: 0xa8302a, fist: false, handS: 1.25, headScale: 1,
    prop: { leg: 0.38, torso: 0.26, head: 0.13, shoulder: 0.105, hipW: 0.055, arm: 0.31, neck: 0.018 }, armR: 0.042, legR: 0.056,
    c: { chest: C.red, belly: C.red, pelvis: C.red, ua: C.red, fa: C.skin, hand: C.skin, th: C.purple, sn: C.purple, foot: C.shoe, bust: C.red },
  });
  const R = M.headR, hc = M.headC;
  // 连衣裙（钟形裙摆 + 白色花边 + 领口）
  bp.add('hips', geo.lathe([[0.14 * H, -0.13 * H], [0.125 * H, -0.08 * H], [0.1 * H, -0.02 * H], [0.08 * H, 0.06 * H]], 18), C.red, { s: [0.9, 1, 1.05], c2: C.red });
  bp.add('hips', ringY(0.14 * H, 2.2 * U), C.white, { p: [0, -0.13 * H, 0], s: [0.9, 1, 1.05] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    bp.add('hips', geo.sph(3.4 * U, 6, 4), C.white, { p: [Math.cos(a) * 0.126 * H, -0.14 * H, Math.sin(a) * 0.147 * H] });
  }
  bp.add('chest', ringY(0.052 * H, 3 * U), C.white, { p: [0, 0.098 * H, 0], s: [0.9, 1, 1] });
  bp.add('chest', geo.sph(4 * U, 8, 6), C.redD, { p: [0.05 * H, 0.08 * H, 0] });
  bp.pair('ua', geo.sph(0.052 * H, 10, 8), C.red, { p: [0, -0.02 * H, 0.004 * H], s: [1, 0.9, 1] });
  bp.pair('ua', ringY(0.04 * H, 1.6 * U), C.white, { p: [0, -0.06 * H, 0] });
  bp.pair('ft', geo.box(0.085 * H, 0.012 * H, 0.05 * H), 0x2a140c, { p: [0.022 * H, -0.04 * H, 0] });
  bp.pair('sn', ringY(0.038 * H, 1.8 * U), C.white, { p: [0, -0.01 * H, 0] });
  // 红发：发帽 + 刘海 + 双马尾
  hairCap(bp, M, C.hair, { vol: 1.1, back: 0.7, c2: C.hairL });
  const tl = [], tr = [];
  for (const s of [-1, 1]) {
    const nm = tail(bp, s < 0 ? 'twL' : 'twR', 'head', [[hc[0] - R * 0.35, hc[1] + R * 0.55, s * R * 0.92], [hc[0] - R * 0.7, hc[1] + R * 0.3, s * R * 1.5], [hc[0] - R * 0.85, hc[1] - R * 0.5, s * R * 1.7], [hc[0] - R * 0.7, hc[1] - R * 1.4, s * R * 1.55]],
      (t) => (2 + 7 * Math.pow(Math.sin(PI * Math.min(1, 0.1 + t * 0.9)), 0.7)) * U, C.hair, { n: 2, segs: 12, rs: 7, c2: C.hairL });
    (s < 0 ? tl : tr).push(...nm);
    bp.add('head', geo.tor(R * 0.16, 1.4 * U, 5, 10), C.purple, { p: [hc[0] - R * 0.42, hc[1] + R * 0.55, s * R * 0.95], r: [0, PI / 2, 0.4] });
  }
  // 提伯斯小熊（左手抱在胸前，可隐藏）
  bp.bone('bear', 'hdL', 0.02 * H, 0.01 * H, 0.03 * H);
  const b = 'bear', k = U;
  bp.add(b, geo.sph(10 * k, 10, 8), C.bear, { p: [0, 0, 0], s: [0.9, 1.1, 1] });
  bp.add(b, geo.sph(6 * k, 8, 6), C.bearL, { p: [7 * k, -1 * k, 0], s: [0.5, 0.9, 0.9] });
  bp.add(b, geo.sph(8 * k, 10, 8), C.bear, { p: [0, 15 * k, 0] });
  bp.add(b, geo.sph(3.8 * k, 8, 6), C.bearL, { p: [6.5 * k, 13.5 * k, 0], s: [0.8, 0.8, 1] });
  bp.add(b, geo.sph(1.6 * k, 6, 4), 0x140a14, { p: [9.8 * k, 14 * k, 0] });
  for (const s of [-1, 1]) {
    bp.add(b, geo.sph(3.4 * k, 8, 6), C.bear, { p: [-1 * k, 22 * k, s * 5.5 * k] });
    bp.add(b, geo.sph(4 * k, 8, 6), C.bear, { p: [2 * k, -8 * k, s * 5 * k], s: [1.3, 0.9, 1] });
    bp.add(b, geo.sph(3.6 * k, 8, 6), C.bear, { p: [2 * k, 3 * k, s * 8.5 * k], s: [1, 1.4, 1] });
  }
  bp.add(b, geo.cyl(2.2 * k, 2.2 * k, 1 * k, 8), 0xe8e4dc, { p: [6.4 * k, 17 * k, 3 * k], r: [0, 0, PI / 2] });
  bp.add(b, geo.sph(1.5 * k, 6, 4), 0x0a0a0a, { p: [6.6 * k, 17 * k, -3 * k] });
  bp.add(b, geo.box(0.6 * k, 7 * k, 0.8 * k), 0xc8a0c0, { p: [8.5 * k, 2 * k, 0] });
  bp.meta.style = 'annie';
  bp.meta.height = 164;
  bp.meta.hideBones = { tibbersOut: 'bear' };
  bp.meta.chains = [{ names: tl, kind: 'hair', amp: 1.4 }, { names: tr, kind: 'hair', amp: 1.4, phase: 0.8 }];
  bp.meta.rim = (ms) => (ms.pyroReady ? { rim: 0xff8a2a, rimI: 0.35 } : null);
  bp.overlays.push((v) => {
    const s = glowSprite(0xff8a30, 26 * U, 0.8);
    s.position.set(0, -0.04 * H, 0);
    v.bones.hdR.add(s);
    return { update(v2, e) { s.visible = v2.opacity > 0.5 && (e.anim.state === 'attack' || e.anim.state === 'cast' || !!e.modelState.pyroReady); } };
  });
}

// ———————————————— 艾希 ————————————————
export function ashe(bp) {
  const H = 210, U = H / 220;
  const C = { skin: 0xf6dccc, hair: 0xf0f2fa, blue: 0x2c52a0, blueD: 0x1a2c5a, silver: 0xb4c6e0, fur: 0xf2f6fa, ice: 0x9ae8ff, glove: 0x24345e };
  const M = humanoid(bp, {
    H, female: true, bulk: 0.9, skin: C.skin, eye: 0x6ab8ff, brow: 0xd8dce8, fist: true,
    c: { chest: C.silver, belly: C.blueD, pelvis: C.blueD, ua: C.blue, fa: C.silver, hand: C.glove, th: 0x283456, sn: C.fur, foot: C.silver, bust: C.silver },
  });
  const R = M.headR, hc = M.headC;
  // 胸甲细节
  bp.add('chest', geo.lathe([[0.07 * H, -0.06 * H], [0.084 * H, -0.02 * H], [0.08 * H, 0.01 * H]], 14), C.blue, { s: [0.72, 1, 0.92] });
  bp.add('chest', geo.oct(3.6 * U), C.ice, { p: [0.062 * H, 0.05 * H, 0], s: [0.6, 1.3, 1], glow: 1.4 });
  bp.pair('ua', geo.sph(0.05 * H, 10, 8), C.fur, { p: [0, 0.01 * H, 0.004 * H], s: [1.1, 0.8, 1] });
  bp.pair('ua', geo.sphPart(12 * U, 0, TAU, 0, PI * 0.5, 12, 5), C.silver, { p: [0, 1 * U, 3 * U], r: [0.4, 0, 0], s: [1, 0.7, 1], shine: 0.7 });
  bp.pair('fa', geo.cyl(0.03 * H, 0.034 * H, 0.012 * H, 10), C.fur, { p: [0, -0.005 * H, 0] });
  // 前摆
  bp.add('hips', ringY(0.078 * H, 2 * U), C.silver, { p: [0, 0.05 * H, 0], s: [0.78, 1, 1.1], shine: 0.7 });
  const fr = bp.chain('robeF', 'hips', linePts([0.06 * H, 0.03 * H, 0], [0.065 * H, 0.03 * H - 0.24 * H, 0], 2));
  bp.add(fr[0], geo.cloth(0.08 * H, 0.1 * H, 0.28 * H, -0.008 * H, 3, 4), C.blue, { r: [0, PI, 0], chain: fr, c2: C.blueD });
  bp.pair('sn', ringY(0.04 * H, 2.6 * U), C.fur, { p: [0, -0.01 * H, 0] });
  // 白色长发（前侧两缕 + 背片）
  hairCap(bp, M, C.hair, { vol: 1.08, back: 0.72 });
  for (const s of [-1, 1]) {
    bp.add('head', geo.tube([[hc[0] + R * 0.5, hc[1] + R * 0.1, s * R * 0.9], [hc[0] + R * 0.6, hc[1] - R * 1.4, s * R * 1.05], [hc[0] + R * 0.9, hc[1] - R * 3.0, s * R * 0.8]], (t) => (5.5 - 3 * t) * U, 10, 6), C.hair);
  }
  // 兜帽（蓝色外层 + 白色毛边）
  bp.add('head', geo.sphPart(R * 1.3, -PI * 0.58, PI * 1.16, 0, PI * 0.72, 16, 8), C.blue, { p: [hc[0] - R * 0.12, hc[1] + R * 0.06, 0], s: [1.05, 1.08, 1.02], c2: 0x3a64b8 });
  bp.add('head', geo.tor(R * 1.1, 3.2 * U, 6, 18, PI * 1.25), C.fur, { p: [hc[0] + R * 0.55, hc[1] - R * 0.05, 0], r: [0, PI / 2, PI * 0.12], s: [1, 1.12, 1] });
  // 披风（长、毛领）
  bp.add('chest', ringY(0.07 * H, 5 * U), C.fur, { p: [0, 0.1 * H, 0], s: [0.9, 1, 1.15] });
  const cp = cape(bp, 'chest', linePts([-0.07 * H, 0.1 * H, 0], [-0.08 * H, 0.1 * H - 0.54 * H, 0], 3), C.blue, C.blueD,
    { wTop: 0.2 * H, wBot: 0.32 * H, len: 0.6 * H, bulge: 0.03 * H });
  // 冰晶长弓（左手，沿 X 为弓臂，+Y 朝向射手）
  const w = 'wpL';
  const bowPts = [];
  for (let i = 0; i <= 8; i++) {
    const x = -84 + (168 * i) / 8;
    bowPts.push([x * U, (24 * Math.pow(Math.abs(x) / 84, 2.2) - 3 - 6 * Math.pow(Math.abs(x) / 84, 8)) * U, 0]);
  }
  bp.add(w, geo.tube(bowPts, (t) => (1.6 + 2.6 * Math.pow(Math.sin(PI * t), 0.6)) * U, 24, 6), C.ice, { glow: 0.85, shine: 0.6 });
  bp.add(w, geo.box(12 * U, 5 * U, 5 * U), C.silver, { p: [0, -2 * U, 0], shine: 0.8 });
  for (const s of [-1, 1]) {
    bp.add(w, geo.oct(5 * U), 0xd8f8ff, { p: [s * 86 * U, 20 * U, 0], s: [1.8, 0.6, 0.6], glow: 1.4 });
    bp.add(w, geo.oct(4 * U), C.ice, { p: [s * 30 * U, -6 * U, 0], s: [1, 2.2, 0.6], r: [0, 0, s * 0.6], glow: 1.1 });
    bp.add(w, geo.oct(3 * U), 0xd8f8ff, { p: [s * 58 * U, 2 * U, 0], s: [0.8, 2, 0.6], r: [0, 0, s * 0.9], glow: 1.3 });
  }
  const tipY = (24 - 3 - 6) * U;
  bp.meta.style = 'bow';
  bp.meta.height = 218;
  bp.meta.bow = { tipX: 84 * U, tipY };
  bp.meta.chains = [{ names: cp, kind: 'cape' }, { names: fr, kind: 'skirtF' }];
  bp.meta.rim = (ms) => (ms.focus ? { rim: 0x9ae8ff, rimI: 0.45 } : null);
  bp.overlays.push((v) => bowString(v, 'wpL', 84 * U, tipY, C.ice));
}

// 弓弦：两端固定于弓梢，拉弓时中点跟随右手
function bowString(v, boneName, tipX, tipY, color) {
  const pos = new Float32Array(9);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false }));
  line.frustumCulled = false;
  v.bones[boneName].add(line);
  const tmp = new THREE.Vector3();
  return {
    update(v2) {
      line.visible = v2.opacity > 0.5;
      pos[0] = -tipX; pos[1] = tipY; pos[2] = 0;
      pos[6] = tipX; pos[7] = tipY; pos[8] = 0;
      if (v2.drawString > 0.01) {
        v2.bones.hdR.getWorldPosition(tmp);
        v2.bones[boneName].worldToLocal(tmp);
        const k = v2.drawString;
        pos[3] = tmp.x * k; pos[4] = tipY + (tmp.y - tipY) * k; pos[5] = tmp.z * k;
      } else { pos[3] = 0; pos[4] = tipY; pos[5] = 0; }
      g.attributes.position.needsUpdate = true;
    },
    dispose() { g.dispose(); line.material.dispose(); },
  };
}

// ———————————————— 金克丝 ————————————————
export function jinx(bp) {
  const H = 204, U = H / 220;
  const C = { skin: 0xf6e0d8, hair: 0x2a5ed8, hairL: 0x5a90ff, dark: 0x2a2434, pink: 0xf05aa8, purple: 0x5a3a7a, steel: 0x4a4a58, teal: 0x6a8e9a, red: 0xc8303a };
  const M = humanoid(bp, {
    H, female: true, bulk: 0.82, slim: 0.8, skin: C.skin, eye: 0xf05aa8, brow: 0x1a3a8a, fist: true,
    prop: { shoulder: 0.11, hipW: 0.046 },
    c: { chest: C.skin, belly: C.skin, pelvis: C.purple, ua: C.skin, fa: C.skin, hand: C.dark, th: C.skin, sn: C.dark, foot: C.dark, bust: C.dark },
  });
  const R = M.headR, hc = M.headC;
  // 上衣束带、短裤、条纹袜、靴
  bp.add('chest', geo.lathe([[0.07 * H, -0.01 * H], [0.078 * H, 0.02 * H], [0.074 * H, 0.045 * H]], 14), C.dark, { s: [0.74, 1, 0.9] });
  bp.pair('chest', geo.box(1.2 * U, 0.07 * H, 1.2 * U), C.pink, { p: [0.03 * H, 0.08 * H, 0.04 * H], r: [0.2, 0, -0.3] });
  bp.add('hips', ringY(0.078 * H, 2 * U), C.pink, { p: [0, 0.05 * H, 0], s: [0.76, 1, 1.08] });
  bp.add('hips', geo.tor(0.09 * H, 1.8 * U, 5, 18), 0xc8a040, { p: [0, 0.02 * H, 0], r: [PI / 2 + 0.25, 0.3, 0], s: [0.78, 1.05, 1], shine: 0.9 });
  for (let i = 0; i < 6; i++) bp.add('thR', ringY((0.05 - i * 0.002) * H * 0.82, 2.4 * U), i % 2 ? C.dark : C.pink, { p: [0, -(0.02 + i * 0.03) * H, 0] });
  bp.pair('sn', geo.cyl(0.038 * H, 0.03 * H, 0.012 * H, 10), C.pink, { p: [0, -0.01 * H, 0] });
  bp.pair('ua', ringY(0.03 * H, 1.2 * U), C.dark, { p: [0, -0.08 * H, 0] });
  bp.add('faL', geo.cyl(0.028 * H, 0.026 * H, 0.07 * H, 10), C.dark, { p: [0, -0.08 * H, 0] });
  // 蓝色头发：发帽 + 齐刘海 + 超长双麻花辫（拖到地面）
  hairCap(bp, M, C.hair, { vol: 1.1, back: 0.7, c2: C.hairL });
  const braids = [];
  for (const s of [-1, 1]) {
    const pts = [[-0.55, 0.3, 0.62], [-1.2, -1.2, 1.0], [-2.0, -3.6, 1.12], [-2.8, -6.2, 1.05], [-3.8, -8.6, 0.8], [-4.8, -9.9, 0.6]]
      .map(([x, y, z]) => [hc[0] + x * R, hc[1] + y * R, s * z * R]);
    braids.push(tail(bp, s < 0 ? 'brL' : 'brR', 'head', pts, (t) => (3.8 - 1.8 * t) * U * (1 + 0.2 * Math.sin(t * 70)), C.hair, { n: 4, segs: 36, rs: 6, c2: C.hairL }));
    bp.add('head', geo.sph(3 * U, 6, 4), C.pink, { p: [hc[0] - R * 0.7, hc[1] + R * 0.05, s * R * 0.78] });
  }
  // 砰砰（机枪，右手）：独立骨骼 gun，枪管骨骼 barrel 可旋转
  bp.bone('gun', 'wpR', 0, 0, 0);
  bp.bone('barrel', 'gun', 44 * U, 2 * U, 0);
  bp.add('gun', cylX(9 * U, 10 * U, 56 * U, 10), C.pink, { p: [14 * U, 2 * U, 0], shine: 0.4 });
  bp.add('gun', cylX(11 * U, 11 * U, 6 * U, 10), C.steel, { p: [40 * U, 2 * U, 0], shine: 0.8 });
  bp.add('gun', cylZ(9 * U, 9 * U, 8 * U, 12), 0x3a6ad8, { p: [10 * U, -10 * U, 0] });
  bp.add('gun', geo.box(8 * U, 12 * U, 4 * U), C.dark, { p: [-4 * U, -7 * U, 0] });
  bp.add('gun', geo.box(24 * U, 3 * U, 3 * U), 0x5ad8ff, { p: [14 * U, 11 * U, 0], glow: 0.7 });
  for (const s of [-1, 1]) bp.add('gun', geo.sph(3 * U, 6, 4), 0xffffff, { p: [30 * U, 7 * U, s * 7 * U], glow: 0.3 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    bp.add('barrel', cylX(1.8 * U, 1.8 * U, 40 * U, 6), C.steel, { p: [20 * U, Math.cos(a) * 5 * U, Math.sin(a) * 5 * U], shine: 0.8 });
  }
  bp.add('barrel', cylX(7 * U, 7 * U, 3 * U, 10), C.pink, { p: [34 * U, 0, 0] });
  // 鱼骨头（鲨鱼火箭筒，扛在右肩）：独立骨骼 rocket
  bp.bone('rocket', 'shR', -0.01 * H, 0.05 * H, 0.03 * H);
  const r = 'rocket';
  bp.add(r, geo.capsule(14 * U, 12 * U, 110 * U, 12), C.teal, { r: [0, 0, PI / 2], p: [-45 * U, 0, 0], shine: 0.4 });
  bp.add(r, geo.sph(12 * U, 12, 8), C.red, { p: [68 * U, -1 * U, 0], s: [0.6, 0.85, 0.95], glow: 0.35 });
  bp.add(r, geo.sphPart(15 * U, 0, TAU, 0, PI * 0.5, 12, 5), C.teal, { p: [66 * U, 5 * U, 0], r: [0, 0, -0.35], s: [1.1, 0.6, 1] });
  bp.add(r, geo.sphPart(14 * U, 0, TAU, PI * 0.5, PI * 0.5, 12, 5), C.teal, { p: [64 * U, -6 * U, 0], r: [0, 0, 0.3], s: [1.1, 0.6, 1] });
  for (let i = 0; i < 7; i++) {
    const z = (i - 3) * 3.6 * U;
    bp.add(r, geo.cone(1.6 * U, 5 * U, 4), 0xffffff, { p: [72 * U, 3 * U, z], r: [PI, 0, 0] });
    bp.add(r, geo.cone(1.6 * U, 5 * U, 4), 0xffffff, { p: [72 * U, -5 * U, z] });
  }
  for (const s of [-1, 1]) {
    bp.add(r, geo.sph(4.4 * U, 8, 6), 0xfff4a0, { p: [52 * U, 9 * U, s * 11 * U], glow: 0.6 });
    bp.add(r, geo.sph(2.2 * U, 6, 4), 0x101010, { p: [54 * U, 9.5 * U, s * 13.4 * U] });
    bp.add(r, geo.extrude([[0, 0], [16, 0], [-6, -14]].map(([x, y]) => [x * U, y * U]), 2 * U), C.steel, { p: [-46 * U, -4 * U, s * 10 * U], r: [s * 0.8, 0, 0] });
  }
  bp.add(r, geo.extrude([[-18, 0], [18, 0], [-10, 24]].map(([x, y]) => [x * U, y * U]), 2.4 * U), C.steel, { p: [14 * U, 12 * U, 0] });
  bp.add(r, geo.box(40 * U, 3 * U, 1 * U), C.pink, { p: [0, 0, 14 * U], glow: 0.2 });
  bp.add(r, geo.box(40 * U, 3 * U, 1 * U), C.pink, { p: [0, 0, -14 * U], glow: 0.2 });
  bp.meta.style = 'gun';
  bp.meta.height = 212;
  bp.meta.chains = braids.map((n, i) => ({ names: n, kind: 'braid', phase: i * 1.1 }));
  bp.meta.rim = (ms) => (ms.excited ? { rim: 0xff5ab8, rimI: 0.55 } : null);
}

// ———————————————— 提伯斯 ————————————————
export function tibbers(bp) {
  const H = 330, U = H / 220;
  const C = { fur: 0x2c2032, fur2: 0x46305a, belly: 0x6a5a78, muzzle: 0x8a7a8c, claw: 0xe8dcc0, fire: 0xff7a24, seam: 0xffa040 };
  const M = humanoid(bp, {
    H, bulk: 1.5, slim: 1.55, skin: C.fur, noFace: true, depth: 0.9, armR: 0.05, legR: 0.064, headScale: 1,
    prop: { leg: 0.32, torso: 0.36, head: 0.13, shoulder: 0.15, hipW: 0.075, arm: 0.42, neck: 0.012 },
    c: { chest: C.fur, belly: C.fur2, pelvis: C.fur, ua: C.fur, fa: C.fur2, hand: C.fur, th: C.fur, sn: C.fur2, foot: C.fur },
  });
  const R = M.headR, hc = M.headC;
  // 大肚腩 + 缝线（发光）
  bp.add('spine', geo.sph(0.12 * H, 14, 10), C.fur2, { p: [0.03 * H, 0.03 * H, 0], s: [0.85, 1, 1.05] });
  bp.add('spine', geo.sph(0.09 * H, 12, 8), C.belly, { p: [0.058 * H, 0.03 * H, 0], s: [0.6, 1, 0.95] });
  for (let i = 0; i < 5; i++) bp.add('spine', geo.box(1.4 * U, 1.4 * U, 8 * U), C.seam, { p: [0.105 * H, (0.075 - i * 0.022) * H, 0], glow: 1.6 });
  bp.add('spine', geo.box(1.4 * U, 0.1 * H, 1.4 * U), C.seam, { p: [0.106 * H, 0.03 * H, 0], glow: 1.6 });
  bp.pair('ua', geo.box(1.4 * U, 1.4 * U, 0.05 * H), C.seam, { p: [0.04 * H, -0.08 * H, 0], glow: 1.4 });
  // 头部：口鼻、纽扣眼、耳朵、毛簇
  bp.add('head', geo.sph(R * 0.62, 12, 8), C.muzzle, { p: [hc[0] + R * 0.72, hc[1] - R * 0.3, 0], s: [0.9, 0.7, 1] });
  bp.add('head', geo.sph(R * 0.2, 8, 6), 0x0e080e, { p: [hc[0] + R * 1.25, hc[1] - R * 0.18, 0], s: [0.8, 0.7, 1.1] });
  bp.add('head', geo.box(R * 0.06, R * 0.06, R * 0.7), 0x1a0e18, { p: [hc[0] + R * 1.18, hc[1] - R * 0.58, 0] });
  for (let i = -2; i <= 2; i++) bp.add('head', geo.box(R * 0.05, R * 0.2, R * 0.04), C.seam, { p: [hc[0] + R * 1.18, hc[1] - R * 0.58, i * R * 0.13], glow: 1.4 });
  bp.add('head', geo.cyl(R * 0.26, R * 0.26, R * 0.1, 12), 0xd8d4cc, { p: [hc[0] + R * 0.8, hc[1] + R * 0.28, R * 0.42], r: [0, 0, PI / 2], shine: 0.4 });
  for (const [dy, dz] of [[0.07, 0.07], [0.07, -0.07], [-0.07, 0.07], [-0.07, -0.07]]) bp.add('head', geo.sph(R * 0.045, 4, 3), 0x3a3a3a, { p: [hc[0] + R * 0.86, hc[1] + R * (0.28 + dy), R * (0.42 + dz)] });
  bp.add('head', geo.sph(R * 0.2, 10, 8), C.fire, { p: [hc[0] + R * 0.82, hc[1] + R * 0.28, -R * 0.42], s: [0.5, 1, 1], glow: 2.6 });
  for (const s of [-1, 1]) {
    bp.add('head', geo.sph(R * 0.38, 10, 8), C.fur, { p: [hc[0] - R * 0.15, hc[1] + R * 0.85, s * R * 0.72], s: [0.6, 1, 1] });
    bp.add('head', geo.sph(R * 0.24, 8, 6), C.belly, { p: [hc[0] - R * 0.02, hc[1] + R * 0.85, s * R * 0.72], s: [0.4, 0.8, 0.8] });
  }
  for (let i = 0; i < 5; i++) bp.add('head', geo.cone(R * 0.2, R * 0.55, 5), C.fur2, { p: [hc[0] - R * (0.2 + i * 0.25), hc[1] + R * (1.0 - i * 0.12), 0], r: [0, 0, 0.5 + i * 0.25] });
  // 肩背毛簇、利爪、大脚掌
  for (let i = 0; i < 6; i++) {
    const a = (i / 5 - 0.5) * 2.2;
    bp.add('chest', geo.cone(0.03 * H, 0.08 * H, 5), C.fur2, { p: [-0.07 * H, 0.08 * H + Math.cos(a) * 0.02 * H, Math.sin(a) * 0.1 * H], r: [Math.sin(a) * 0.6, 0, 0.8] });
  }
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    for (let j = -1; j <= 1; j++) bp.add('hd' + sd, geo.cone(2.6 * U, 12 * U, 5), C.claw, { p: [0.02 * H, -0.05 * H, s * j * 0.012 * H], r: [0, 0, -2.6] });
    bp.add('ft' + sd, geo.sph(0.04 * H, 10, 8), C.fur, { p: [0.03 * H, -0.02 * H, 0], s: [1.6, 0.7, 1.1] });
    for (let j = -1; j <= 1; j++) bp.add('ft' + sd, geo.cone(2.2 * U, 8 * U, 4), C.claw, { p: [0.09 * H, -0.03 * H, j * 0.02 * H], r: [0, 0, -PI / 2] });
  }
  bp.meta.style = 'brute';
  bp.meta.height = 330;
  bp.meta.chains = [];
  bp.meta.rim = () => ({ rim: 0xff6a20, rimI: 0.3 });
  // 火焰（加色锥体，逐帧跳动）
  bp.overlays.push((v) => {
    const g = cachedGeo('tibFlame', () => { const c = new THREE.ConeGeometry(1, 2.4, 7, 1, true); c.translate(0, 1.2, 0); return c; });
    const mOut = addMat(0xff6a1a, 0.55), mIn = addMat(0xffd060, 0.7);
    const spots = [['chest', -0.06, 0.12, 0.1, 1.2], ['chest', -0.06, 0.12, -0.1, 1.2], ['chest', -0.09, 0.06, 0, 1.4], ['head', -0.02, 0.25, 0, 0.9], ['uaR', 0, 0.02, 0.03, 0.9], ['uaL', 0, 0.02, -0.03, 0.9]];
    const flames = spots.map(([bn, x, y, z, s], i) => {
      const grp = new THREE.Group();
      const o = new THREE.Mesh(g, mOut), n = new THREE.Mesh(g, mIn);
      n.scale.set(0.55, 0.7, 0.55);
      grp.add(o, n);
      grp.position.set(x * H, y * H, z * H);
      grp.userData = { s: s * 0.07 * H, ph: i * 1.7 };
      v.bones[bn].add(grp);
      return grp;
    });
    const glow = glowSprite(0xff7a2a, 0.9 * H, 0.35);
    glow.position.set(0, 0.62 * H, 0);
    v.mover.add(glow);
    return {
      update(v2) {
        const on = v2.opacity > 0.5 && !v2.dead;
        glow.visible = on;
        for (const f of flames) {
          f.visible = on;
          if (!on) continue;
          const t = v2.time * 9 + f.userData.ph;
          const k = f.userData.s * (0.85 + 0.25 * Math.sin(t) + 0.12 * Math.sin(t * 2.7));
          f.scale.set(k * 0.8, k * (1 + 0.3 * Math.sin(t * 1.9)), k * 0.8);
          f.rotation.y = t * 0.3;
        }
      },
    };
  });
}

export { clamp01 };
