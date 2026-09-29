// 英雄模型 · 金克丝（暴走萝莉）：瘦小、粉蓝色调；蓝色超长双麻花辫（链式摆动，拖到脚边）、齐刘海、粉色眼睛、子弹带与弹药腰带、
// 左臂云纹刺青、单侧条纹袜；机枪「砰砰」（手持，射击时枪管旋转）与鲨鱼嘴火箭筒「鱼骨头」（扛在右肩）。
// modelState：weapon（'minigun' | 'rocket'，切换显示的武器与持枪姿势）、excited（被动兴奋：粉色边缘光 + 速度感）
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI, TAU } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid, hairCap, tail, cylX, cylZ, ringY } from './rig.js';

export function build(bp, def) {
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
  // 斜挎子弹带（胸前）+ 弹药腰包
  const sa = 0.085 * H, th = PI / 2 + 0.7;
  bp.add('chest', geo.tor(sa, 1.6 * U, 5, 20), 0x8a6a30, { p: [0.004 * H, 0.03 * H, 0], r: [th, 0, 0], s: [0.82, 1.1, 1], shine: 0.6 });
  for (let i = 0; i < 7; i++) {
    const f = -0.9 + i * 0.3, sn = Math.sin(f) * 1.1 * sa;
    bp.add('chest', geo.cyl(1.3 * U, 1.3 * U, 5 * U, 5), 0xe8c050, { p: [0.004 * H + 0.82 * sa * Math.cos(f) + 1.2 * U, 0.03 * H + Math.cos(th) * sn, Math.sin(th) * sn], r: [th - PI / 2, 0, PI / 2], shine: 1 });
  }
  bp.add('hips', geo.box(0.04 * H, 0.04 * H, 0.03 * H), C.purple, { p: [0.02 * H, 0.0, 0.085 * H] });
  bp.add('hips', geo.box(0.035 * H, 0.035 * H, 0.03 * H), C.pink, { p: [-0.03 * H, 0.0, -0.08 * H] });
  // 左上臂云纹刺青（蓝色）
  for (let i = 0; i < 3; i++) bp.add('uaL', geo.sph(2.2 * U, 6, 4), 0x3a7ae8, { p: [0.004 * H, -(0.03 + i * 0.022) * H, -0.022 * H], s: [0.5, 1.4, 1.4], glow: 0.3 });
  // 蓝色头发：发帽 + 齐刘海 + 超长双麻花辫（拖到地面）
  hairCap(bp, M, C.hair, { vol: 1.1, back: 0.7, c2: C.hairL });
  const braids = [];
  for (const s of [-1, 1]) {
    const pts = [[-0.55, 0.3, 0.62], [-1.2, -1.2, 1.0], [-2.0, -3.6, 1.12], [-2.8, -6.2, 1.05], [-3.8, -8.6, 0.8], [-4.8, -9.9, 0.6]]
      .map(([x, y, z]) => [hc[0] + x * R, hc[1] + y * R, s * z * R]);
    braids.push(tail(bp, s < 0 ? 'brL' : 'brR', 'head', pts, (t) => (3.8 - 1.8 * t) * U * (1 + 0.2 * Math.sin(t * 70)), C.hair, { n: 4, segs: 36, rs: 6, c2: C.hairL }));
    bp.add('head', geo.sph(3 * U, 6, 4), C.pink, { p: [hc[0] - R * 0.7, hc[1] + R * 0.05, s * R * 0.78] });
    bp.add('head', geo.cone(R * 0.22, R * 0.6, 5), C.hair, { p: [hc[0] + R * 0.1, hc[1] + R * 0.9, s * R * 0.5], r: [s * 0.5, 0, 0.4], c2: C.hairL }); // 头顶翘发
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
  // 武器切换（weapon 是字符串，hideBones 无法区分，这里在叠加物中直接缩放骨骼）+ 砰砰射击时枪管旋转 + 鱼骨头炮口火光
  bp.overlays.push((v) => {
    const flash = glowSprite(0xffb050, 40 * U, 0.85);
    flash.position.set(78 * U, 0, 0);
    v.bones.rocket.add(flash);
    const muzzle = glowSprite(0xffe070, 26 * U, 0.8);
    muzzle.position.set(44 * U, 0, 0);
    v.bones.barrel.add(muzzle);
    let spin = 0, rpm = 0;
    return {
      update(v2, e, dt) {
        const ms = e.modelState || {};
        const rocket = ms.weapon === 'rocket';
        v2.bones.gun.scale.setScalar(rocket ? 1e-4 : 1);
        v2.bones.rocket.scale.setScalar(rocket ? 1 : 1e-4);
        const st = e.anim?.state;
        const firing = st === 'attack' && (e.anim.t || 0) > (e.anim.windup || 0.3) * 0.7;
        rpm += ((st === 'attack' ? 28 : 0) - rpm) * Math.min(1, dt * 6);
        spin += rpm * dt;
        v2.bones.barrel.rotation.x = spin;
        const vis = v2.opacity > 0.5;
        muzzle.visible = vis && !rocket && firing && Math.sin(v2.time * 60) > 0;
        flash.visible = vis && rocket && firing && (e.anim.t || 0) < (e.anim.windup || 0.3) * 1.5;
      },
    };
  });
}
