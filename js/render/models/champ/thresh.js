// 英雄模型 · 锤石（魂锁典狱长）：幽绿色幽灵体（发光骷髅头 + 头顶幽火）、黑色铁甲（铁笼护颈、巨型肩甲、腰间锁链）、破碎长袍、
// 左手幽绿灯笼（始终下垂）、右手镰刀 + 垂落锁链；身周漂浮灵魂光点。
// modelState：lanternOut（灯笼抛出：手中灯笼隐藏）、leaping（Q 二段飞扑：前扑姿势）
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { geo, PI, TAU } from './kit.js';
import { STYLES } from './anim.js';
import { glowSprite } from './materials.js';
import { humanoid, linePts, tail, cylX, ringY } from './rig.js';

// 动画风格：内置灯笼风格 + 飞扑（Q 二段）
const STYLE = {
  ...STYLES.lantern,
  dash(A, ms) {
    if (!ms.leaping) return;
    A.R('spine', 0, 0, -0.55);
    A.R('head', 0, 0, 0.45);
    A.arm('R', 1.6, 0.3, 0.2, 0.3);
    A.R('wpR', 0, 0, -0.9);
    A.arm('L', -0.6, 0.4, 0, 0.5);
    A.leg('L', 1.0, 0.15, 1.6);
    A.leg('R', 0.4, 0.15, 1.2);
  },
};

export function build(bp, def) {
  const H = 252, U = H / 220;
  const C = { black: 0x1c1e22, iron: 0x3a3e44, green: 0x2a5a4a, ghost: 0x6affc4, bone: 0xc8c4a8, robe: 0x14261e };
  const M = humanoid(bp, {
    H, bulk: 1.18, skin: C.ghost, noFace: true, noHead: true, prop: { arm: 0.38, leg: 0.44 }, armR: 0.042,
    c: { chest: C.black, belly: C.green, pelvis: C.black, ua: C.iron, fa: C.black, hand: C.ghost, th: C.black, sn: C.iron, foot: C.black },
  });
  const hdR0 = M.headR * 1.0;
  const hc = M.headC;
  // 头：幽绿发光骷髅 + 铁质兜帽/头盔 + 角
  bp.add('head', geo.cyl(0.03 * H, 0.04 * H, 0.05 * H, 8), C.ghost, { p: [0, 0.02 * H, 0], glow: 1.2 });
  bp.add('head', geo.sph(hdR0 * 0.92, 14, 10), C.ghost, { p: [hc[0] + hdR0 * 0.1, hc[1], 0], s: [0.95, 1.05, 0.85], glow: 1.4 });
  bp.add('head', geo.sph(hdR0 * 0.55, 10, 8), C.ghost, { p: [hc[0] + hdR0 * 0.35, hc[1] - hdR0 * 0.62, 0], s: [0.9, 0.5, 0.9], glow: 1.2 });
  for (const s of [-1, 1]) {
    bp.add('head', geo.sph(hdR0 * 0.24, 8, 6), 0x0a1a14, { p: [hc[0] + hdR0 * 0.78, hc[1] + hdR0 * 0.05, s * hdR0 * 0.34], s: [0.5, 0.9, 1] });
    bp.add('head', geo.sph(hdR0 * 0.08, 6, 4), 0xeaffff, { p: [hc[0] + hdR0 * 0.9, hc[1] + hdR0 * 0.05, s * hdR0 * 0.32], glow: 3 });
  }
  for (let i = -2; i <= 2; i++) bp.add('head', geo.box(hdR0 * 0.12, hdR0 * 0.16, hdR0 * 0.1), 0xe8fff4, { p: [hc[0] + hdR0 * 0.8, hc[1] - hdR0 * 0.45, i * hdR0 * 0.13], glow: 1.5 });
  bp.add('head', geo.sphPart(hdR0 * 1.22, -PI * 0.62, PI * 1.24, 0, PI * 0.72, 16, 8), C.iron, { p: [hc[0] - hdR0 * 0.08, hc[1] + hdR0 * 0.05, 0], s: [1.05, 1.08, 1], shine: 0.6 });
  bp.add('head', geo.box(hdR0 * 0.5, hdR0 * 0.2, hdR0 * 1.9), C.black, { p: [hc[0] + hdR0 * 0.55, hc[1] + hdR0 * 0.6, 0], r: [0, 0, -0.35], shine: 0.4 });
  bp.pair('head', geo.cone(3.5 * U, 26 * U, 6), C.bone, { p: [hc[0] - hdR0 * 0.2, hc[1] + hdR0 * 1.1, hdR0 * 0.7], r: [0.55, 0, 0.5] });
  // 铁笼护颈
  for (let i = 0; i < 3; i++) bp.add('chest', ringY((0.07 - i * 0.008) * H, 2.2 * U), C.iron, { p: [0, (0.09 + i * 0.02) * H, 0], s: [0.9, 1, 1.05], shine: 0.6 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    bp.add('chest', geo.box(2 * U, 0.07 * H, 2 * U), C.iron, { p: [Math.cos(a) * 0.058 * H, 0.115 * H, Math.sin(a) * 0.065 * H], shine: 0.6 });
  }
  // 胸甲纹路（幽绿发光）
  bp.add('chest', geo.box(1.5 * U, 0.12 * H, 0.03 * H), C.ghost, { p: [0.074 * H, 0.02 * H, 0], glow: 1.2 });
  bp.add('chest', geo.box(1.5 * U, 0.02 * H, 0.12 * H), C.ghost, { p: [0.07 * H, 0.05 * H, 0], glow: 1.1 });
  // 巨大肩甲
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    const b = 'ua' + sd, mir = s < 0;
    bp.add(b, geo.sphPart(19 * U, 0, TAU, 0, PI * 0.5, 14, 7), C.black, { p: [0, 6 * U, 4 * U], r: [0.35, 0, 0], s: [1.1, 0.8, 1.15], mirror: mir, shine: 0.5 });
    bp.add(b, geo.tor(18.5 * U, 1.6 * U, 6, 18), C.ghost, { p: [0, 5 * U, 4.5 * U], r: [PI / 2 + 0.35, 0, 0], s: [1.1, 1.15, 1], mirror: mir, glow: 1.1 });
    bp.add(b, geo.cone(4 * U, 20 * U, 6), C.bone, { p: [-3 * U, 20 * U, 10 * U], r: [0.5, 0, 0.3], mirror: mir });
  }
  bp.pair('fa', geo.cyl(0.04 * H, 0.03 * H, 0.1 * H, 10), C.iron, { p: [0, -0.07 * H, 0], shine: 0.6 });
  bp.pair('fa', geo.tor(0.038 * H, 1.4 * U, 6, 14), C.ghost, { p: [0, -0.115 * H, 0], r: [PI / 2, 0, 0], glow: 1.2 });
  bp.pair('hd', geo.sph(0.034 * H, 10, 8), C.ghost, { p: [0, -0.03 * H, 0], s: [1.1, 1.3, 0.9], glow: 1.1 });
  // 破碎长袍（前后两片 + 侧片）
  bp.add('hips', ringY(0.086 * H, 3 * U), C.iron, { p: [0, 0.05 * H, 0], s: [0.72, 1, 1.2], shine: 0.5 });
  const rf = bp.chain('robeF', 'hips', linePts([0.066 * H, 0.03 * H, 0], [0.07 * H, 0.03 * H - 0.34 * H, 0], 2));
  bp.add(rf[0], geo.cloth(0.12 * H, 0.16 * H, 0.4 * H, -0.012 * H, 4, 5), C.robe, { r: [0, PI, 0], chain: rf, c2: C.green });
  const rbk = bp.chain('robeB', 'hips', linePts([-0.066 * H, 0.03 * H, 0], [-0.075 * H, 0.03 * H - 0.36 * H, 0], 2));
  bp.add(rbk[0], geo.cloth(0.16 * H, 0.24 * H, 0.43 * H, 0.015 * H, 4, 5), C.robe, { chain: rbk, c2: C.green });
  bp.pair('th', geo.box(0.08 * H, 0.2 * H, 2 * U), C.robe, { p: [0, -0.08 * H, 0.055 * H], r: [0.12, 0, 0], c2: C.green });
  bp.pair('ft', geo.box(0.1 * H, 0.03 * H, 0.055 * H), C.black, { p: [0.024 * H, -0.03 * H, 0] });
  bp.pair('ft', geo.cone(0.02 * H, 0.05 * H, 5), C.iron, { p: [0.08 * H, -0.03 * H, 0], r: [0, 0, -PI / 2], shine: 0.6 });
  // 腰间缠绕的锁链（一串小环）+ 挂锁
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    bp.add('hips', geo.tor(2.6 * U, 0.8 * U, 4, 8), 0x5a6a64, { p: [Math.cos(a) * 0.075 * H, 0.02 * H - Math.cos(a) * 0.02 * H, Math.sin(a) * 0.1 * H], r: [0, -a, (i % 2) * PI / 2], shine: 0.6 });
  }
  bp.add('hips', geo.box(5 * U, 7 * U, 3 * U), C.iron, { p: [0.08 * H, -0.01 * H, 0.02 * H], shine: 0.7 });
  // 背后铁栏（囚笼背饰）
  for (let i = -1; i <= 1; i++) bp.add('chest', geo.box(2 * U, 0.16 * H, 2 * U), C.iron, { p: [-0.085 * H, 0.14 * H, i * 0.035 * H], r: [i * 0.25, 0, -0.25], shine: 0.6 });
  // 灯笼（挂在左手下方，独立骨骼可隐藏/保持下垂）
  bp.bone('lantern', 'wpL', 0, -6 * U, 0);
  const lt = 'lantern';
  bp.add(lt, geo.cyl(0.8 * U, 0.8 * U, 12 * U, 4), C.iron, { p: [0, -6 * U, 0] });
  bp.add(lt, geo.cone(9 * U, 9 * U, 8), C.black, { p: [0, -14 * U, 0], shine: 0.5 });
  bp.add(lt, geo.tor(2.4 * U, 0.8 * U, 4, 10), C.iron, { p: [0, -9 * U, 0] });
  bp.add(lt, geo.sph(6.5 * U, 12, 8), C.ghost, { p: [0, -26 * U, 0], s: [1, 1.3, 1], glow: 2.4 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    bp.add(lt, geo.box(1.4 * U, 22 * U, 1.4 * U), C.iron, { p: [Math.cos(a) * 8 * U, -27 * U, Math.sin(a) * 8 * U], shine: 0.6 });
  }
  bp.add(lt, geo.cyl(9.5 * U, 6 * U, 5 * U, 8), C.black, { p: [0, -39 * U, 0], shine: 0.5 });
  bp.add(lt, geo.cone(3 * U, 8 * U, 6), C.ghost, { p: [0, -45 * U, 0], r: [PI, 0, 0], glow: 1.4 });
  // 镰刀锁链（右手）：短柄 + 弯刃 + 垂下的锁链
  const w = 'wpR';
  bp.add(w, cylX(2.2 * U, 2.2 * U, 34 * U, 8), C.black, { p: [4 * U, 0, 0] });
  bp.add(w, geo.sph(3.4 * U, 8, 6), C.ghost, { p: [-14 * U, 0, 0], glow: 1.4 });
  const sick = [[16, -4], [32, -2], [48, 6], [60, 20], [66, 40], [58, 30], [48, 18], [34, 8], [16, 4]].map(([x, y]) => [x * U, y * U]);
  bp.add(w, geo.extrude(sick, 2 * U, 0.6 * U), 0xa8b4b0, { shine: 1 });
  bp.add(w, geo.extrude(sick.map(([x, y]) => [x, y * 0.9]), 2.6 * U, 0), C.ghost, { s: [0.94, 0.85, 1], p: [2 * U, 0, 0], glow: 0.9 });
  const ch = tail(bp, 'chn', 'wpR', [[-14 * U, 0, 0], [-16 * U, -30 * U, 3 * U], [-8 * U, -60 * U, 6 * U], [4 * U, -80 * U, 4 * U]],
    () => 1.8 * U, 0x5a6a64, { n: 3, segs: 18, rs: 4, glow: 0.35 });
  bp.meta.style = STYLE;
  bp.meta.height = 262;
  bp.meta.hang = ['lantern'];
  bp.meta.hideBones = { lanternOut: 'lantern' };
  bp.meta.chains = [{ names: rf, kind: 'skirtF' }, { names: rbk, kind: 'skirtB' }, { names: ch, kind: 'chain' }];
  bp.meta.rim = () => ({ rim: 0x4affb0, rimI: 0.28 });
  bp.overlays.push((v) => {
    const s = glowSprite(0x5affb8, 70 * U, 0.75);
    s.position.set(0, -26 * U, 0);
    v.bones.lantern.add(s);
    const s2 = glowSprite(0x5affb8, 60 * U, 0.45);
    s2.position.set(M.headC[0], M.headC[1], 0);
    v.bones.head.add(s2);
    const s3 = glowSprite(0x7affc8, 34 * U, 0.8);
    s3.position.set(M.headC[0] - M.headR * 0.2, M.headC[1] + M.headR * 1.3, 0);
    v.bones.head.add(s3);
    const wisps = [0, 1, 2].map(() => { const w = glowSprite(0x6affc4, 16 * U, 0.7); v.mover.add(w); return w; });
    return {
      update(v2, e) {
        s.visible = !e.modelState.lanternOut && v2.opacity > 0.5;
        s2.visible = s3.visible = v2.opacity > 0.5;
        s3.scale.set(34 * U * (1 + 0.15 * Math.sin(v2.time * 9)), 44 * U * (1 + 0.2 * Math.sin(v2.time * 7)), 1);
        wisps.forEach((w, i) => {
          const a = v2.time * 0.9 + (i * TAU) / 3;
          w.visible = v2.opacity > 0.5 && !v2.dead;
          w.position.set(Math.cos(a) * 60 * U, (130 + 30 * Math.sin(v2.time * 1.7 + i * 2)) * U, Math.sin(a) * 60 * U);
        });
        const k = 1 + 0.12 * Math.sin(v2.time * 5.3);
        s.scale.set(70 * U * k, 70 * U * k, 1);
      },
    };
  });
}

