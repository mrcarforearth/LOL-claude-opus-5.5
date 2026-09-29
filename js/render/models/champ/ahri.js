// 英雄模型 · 阿狸（九尾妖狐）：狐耳、九条白尾（链式骨骼摆动）、红白衣裙、手中蓝白宝珠（叠加物）、黑长发；modelState.spiritRush 边缘光、orbOut 宝珠飞出时隐藏
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import * as THREE from 'three';
import { geo, PI } from './kit.js';
import { addMat, glowSprite, cachedGeo } from './materials.js';
import { humanoid, hairCap, tail, hairSheet, ringY } from './rig.js';

// 漂浮宝珠：跟随右手上方（内核材质按颜色共享）
const CORE = new Map();
function orbOverlay(v, color, core, r, U) {
  const g = cachedGeo('orb' + r, () => new THREE.SphereGeometry(r, 16, 12));
  if (!CORE.has(core)) CORE.set(core, new THREE.MeshBasicMaterial({ color: core, fog: false }));
  const inner = new THREE.Mesh(g, CORE.get(core));
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

export function build(bp, def) {
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
