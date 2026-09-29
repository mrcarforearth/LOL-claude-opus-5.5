// 英雄模型 · 易（无极剑圣）：多镜片发光绿色护目镜头盔、黄绿长袍、细长太刀；modelState.highlander 金光、meditating 盘坐、hidden 隐藏、wuju 剑光
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import * as THREE from 'three';
import { geo, PI, TAU } from './kit.js';
import { addMat, glowSprite, cachedGeo } from './materials.js';
import { humanoid, linePts, tail, cylX, ringY } from './rig.js';

export function build(bp, def) {
  const H = 216, U = H / 220;
  const C = { robe: 0xb4b82a, robeL: 0xe4d860, under: 0x2a3a1c, dark: 0x1e2414, helm: 0x96a22a, lens: 0x9cff4a, skin: 0xd8a47a, steel: 0xe8f0f0, hair: 0x2a2218 };
  const M = humanoid(bp, {
    H, bulk: 1.12, skin: C.skin, noFace: true,
    c: { chest: C.robe, belly: C.under, pelvis: C.under, ua: C.under, fa: C.robe, hand: C.dark, th: C.under, sn: C.robe, foot: C.dark },
  });
  const R = M.headR, hc = M.headC;
  // 头盔 + 多镜片护目镜（发光绿色）
  bp.add('head', geo.sph(R * 1.1, 18, 12), C.helm, { p: [hc[0] - R * 0.02, hc[1] + R * 0.04, 0], s: [1.02, 1.02, 0.96], shine: 0.5 });
  bp.add('head', geo.tor(R * 1.06, 1.6 * U, 6, 22), C.robeL, { p: [hc[0], hc[1] + R * 0.1, 0], r: [PI / 2, 0, 0], shine: 0.8 });
  bp.add('head', geo.box(R * 1.9, R * 0.22, R * 0.2), C.robeL, { p: [hc[0] - R * 0.1, hc[1] + R * 1.08, 0], shine: 0.6 });
  bp.add('head', geo.box(R * 0.5, R * 0.62, R * 1.5), C.dark, { p: [hc[0] + R * 0.9, hc[1] + R * 0.02, 0], s: [1, 1, 1] });
  const lenses = [[0.12, 0.32, 0.3], [-0.26, 0.2, 0.2], [0.02, -0.4, 0.24], [0.32, -0.36, 0.14]];
  for (const [y, z, r] of lenses) {
    bp.add('head', geo.cyl(R * r * 1.25, R * r * 1.25, R * 0.14, 12), C.dark, { p: [hc[0] + R * 1.12, hc[1] + R * y, R * z], r: [0, 0, PI / 2] });
    bp.add('head', geo.sph(R * r, 12, 8), C.lens, { p: [hc[0] + R * 1.2, hc[1] + R * y, R * z], s: [0.45, 1, 1], glow: 1.8 });
  }
  bp.add('head', geo.sph(R * 0.62, 10, 8), C.dark, { p: [hc[0] + R * 0.45, hc[1] - R * 0.55, 0], s: [0.8, 0.55, 1.1] });
  const pt = tail(bp, 'pony', 'head', [[hc[0] - R * 0.9, hc[1] + R * 0.5, 0], [hc[0] - R * 1.6, hc[1] - R * 0.2, 0], [hc[0] - R * 1.7, hc[1] - R * 1.6, 0]],
    (t) => (4.5 - 3 * t) * U, C.hair, { n: 2, segs: 10, rs: 6 });
  // 肩甲（多层片甲）
  for (let i = 0; i < 3; i++) {
    bp.pair('ua', geo.sphPart((15 - i * 1.5) * U, 0, TAU, 0, PI * 0.45, 12, 5), i % 2 ? C.robeL : C.robe,
      { p: [0, (4 - i * 5) * U, (3 + i * 2.4) * U], r: [0.4 + i * 0.18, 0, 0], s: [1, 0.7, 1.05], shine: 0.3 });
  }
  bp.pair('fa', geo.cyl(0.034 * H, 0.03 * H, 0.09 * H, 10), C.robeL, { p: [0, -0.065 * H, 0], shine: 0.4 });
  // 胸前交领与腰带
  bp.add('chest', geo.box(0.03 * H, 0.15 * H, 0.03 * H), C.robeL, { p: [0.072 * H, 0.03 * H, 0.02 * H], r: [0.5, 0, 0] });
  bp.add('chest', geo.box(0.03 * H, 0.15 * H, 0.03 * H), C.robeL, { p: [0.072 * H, 0.03 * H, -0.02 * H], r: [-0.5, 0, 0] });
  bp.add('hips', ringY(0.084 * H, 3.2 * U), C.dark, { p: [0, 0.06 * H, 0], s: [0.72, 1, 1.15] });
  bp.add('hips', geo.box(4 * U, 7 * U, 7 * U), C.robeL, { p: [0.062 * H, 0.06 * H, 0], shine: 0.7 });
  // 长袍前后摆（可摆动）
  const fr = bp.chain('robeF', 'hips', linePts([0.064 * H, 0.03 * H, 0], [0.07 * H, 0.03 * H - 0.3 * H, 0], 2));
  const g1 = geo.cloth(0.1 * H, 0.13 * H, 0.34 * H, -0.01 * H, 4, 5);
  bp.add(fr[0], g1, C.robe, { r: [0, PI, 0], chain: fr, c2: C.robeL });
  const br = bp.chain('robeB', 'hips', linePts([-0.064 * H, 0.03 * H, 0], [-0.07 * H, 0.03 * H - 0.3 * H, 0], 2));
  bp.add(br[0], geo.cloth(0.14 * H, 0.18 * H, 0.36 * H, 0.01 * H, 4, 5), C.robe, { chain: br, c2: C.robeL });
  bp.pair('th', geo.box(0.07 * H, 0.14 * H, 2 * U), C.robe, { p: [0, -0.05 * H, 0.05 * H], r: [0.1, 0, 0] });
  // 太刀（细长、微弯）
  const w = 'wpR';
  bp.add(w, cylX(1.9 * U, 1.9 * U, 26 * U, 8), C.dark, { p: [-3 * U, 0, 0] });
  bp.add(w, geo.cyl(7 * U, 7 * U, 2.2 * U, 12), C.robeL, { p: [11 * U, 0, 0], r: [0, 0, PI / 2], shine: 0.9 });
  const kat = [[12, -2.8], [80, -3.2], [128, -1.2], [142, 2.6], [128, 2.4], [80, 1.6], [12, 2.6]].map(([x, y]) => [x * U, y * U]);
  bp.add(w, geo.extrude(kat, 1.4 * U, 0.4 * U), C.steel, { shine: 1 });
  bp.meta.style = 'katana';
  bp.meta.height = 222;
  bp.meta.chains = [{ names: pt, kind: 'hair' }, { names: fr, kind: 'skirtF' }, { names: br, kind: 'skirtB' }];
  bp.meta.rim = (ms) => (ms.highlander ? { rim: 0xffd84a, rimI: 0.75, tint: 0xfff0a0, tintK: 0.12 } : ms.wuju ? { rim: 0xc8ff6a, rimI: 0.35 } : ms.meditating ? { rim: 0x9aff9a, rimI: 0.3 } : null);
  bp.overlays.push((v) => {
    const g = cachedGeo('yiGlow', () => geo.extrude(kat.map(([x, y]) => [x, y * 2.2]), 4 * U, 1 * U));
    const m = new THREE.Mesh(g, addMat(0xd8ff6a, 0.6));
    m.visible = false;
    v.bones.wpR.add(m);
    const aura = glowSprite(0xffd850, 150 * U, 0.5);
    aura.position.set(0, 110 * U, 0);
    aura.visible = false;
    v.mover.add(aura);
    return {
      update(v2, e) {
        const ms = e.modelState;
        m.visible = !!(ms.wuju || ms.highlander) && v2.opacity > 0.5;
        aura.visible = !!ms.highlander && v2.opacity > 0.5;
        if (aura.visible) { const k = 1 + 0.08 * Math.sin(v2.time * 9); aura.scale.set(150 * U * k, 200 * U * k, 1); }
      },
    };
  });
}
