// 通用人形后备模型：尚未制作专属模型的英雄使用。按 def.model（primary/secondary/accent）配色，
// 按 baseStats.range 选择武器：近战（range < 300）= 单手长剑 + 圆盾纹章肩甲 + 披风；远程 = 法杖 + 发光晶石 + 兜帽。
// 用 id 的哈希挑选肤色/发色/体型，使不同英雄的后备模型也互有区别。
import { geo, PI, TAU } from './kit.js';
import { glowSprite } from './materials.js';
import { humanoid, hairCap, cape, linePts, cylX, ringY } from './rig.js';

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
const SKINS = [0xe8bc98, 0xd9a47a, 0xf4d6c2, 0xc08a64, 0xf0cfb4];
const HAIRS = [0x2a1c14, 0x5a3a22, 0x1a1a22, 0xd8d0c0, 0x8a3a24, 0x3a2a4a];

// 颜色辅助：按系数调暗/调亮
function shade(c, k) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = (x) => Math.max(0, Math.min(255, Math.round(k >= 1 ? x + (255 - x) * (k - 1) : x * k)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

export function build(bp, def, ctx = {}) {
  const id = def?.id || ctx.id || 'unknown';
  const hr = hash(id);
  const model = def?.model || {};
  const prim = model.primary ?? 0x5a6a8a;
  const sec = model.secondary ?? 0x2a2a30;
  const acc = model.accent ?? 0xe8e0c8;
  const ranged = (def?.baseStats?.range ?? 175) >= 300;
  const pet = !!ctx.pet;
  const H = pet ? 170 : Math.round(208 + hr * 22);
  const U = H / 220;
  const female = !pet && hash(id + 'f') < (ranged ? 0.55 : 0.3);
  const skin = SKINS[Math.floor(hash(id + 's') * SKINS.length)];
  const hair = HAIRS[Math.floor(hash(id + 'h') * HAIRS.length)];
  const trim = 0xd8b45e;
  const M = humanoid(bp, {
    H, female, bulk: female ? 0.9 : ranged ? 1.05 : 1.2, skin, brow: hair, eye: shade(prim, 0.8),
    c: { chest: prim, belly: shade(prim, 0.7), pelvis: sec, ua: shade(prim, 0.85), fa: sec, hand: shade(sec, 0.8), th: sec, sn: shade(prim, 0.75), foot: shade(sec, 0.6), bust: prim },
  });
  const R = M.headR, hc = M.headC;
  // 胸前饰带 + 纹章晶石
  bp.add('chest', ringY(0.086 * H, 1.6 * U), trim, { p: [0, -0.04 * H, 0], s: [0.72, 1, female ? 0.95 : 1.2], shine: 0.8 });
  bp.add('chest', geo.oct(3.6 * U), acc, { p: [0.075 * H, 0.03 * H, 0], s: [0.6, 1.2, 1], glow: 1.2 });
  bp.add('hips', ringY(0.08 * H, 2.4 * U), shade(sec, 0.7), { p: [0, 0.05 * H, 0], s: [0.74, 1, 1.15] });
  bp.add('hips', geo.box(4 * U, 5 * U, 5 * U), trim, { p: [0.06 * H, 0.05 * H, 0], shine: 1 });
  // 前后腰摆
  bp.add('hips', geo.box(2 * U, 0.12 * H, 0.07 * H), prim, { p: [0.066 * H, -0.04 * H, 0], r: [0, 0, 0.12] });
  bp.add('hips', geo.box(2 * U, 0.13 * H, 0.09 * H), shade(prim, 0.7), { p: [-0.064 * H, -0.04 * H, 0], r: [0, 0, -0.12] });
  // 头发
  hairCap(bp, M, hair, { vol: 1.08, back: female ? 0.8 : 0.62, fringe: true });
  const chains = [];
  if (female) {
    const names = bp.chain('hairB', 'head', linePts([hc[0] - R * 0.85, hc[1] - R * 0.1, 0], [hc[0] - R * 1.0, hc[1] - R * 0.1 - 0.22 * H, 0], 3));
    bp.add(names[0], geo.cloth(R * 1.5, R * 1.8, 0.24 * H, R * 0.25, 5, 6), hair, { chain: names });
    chains.push({ names, kind: 'hair' });
  }
  if (!ranged) {
    // 近战：肩甲 + 披风 + 单手长剑
    bp.pair('ua', geo.sphPart(13 * U, 0, TAU, 0, PI * 0.5, 12, 6), sec, { p: [0, 4 * U, 3 * U], r: [0.35, 0, 0], s: [1.05, 0.85, 1.1], shine: 0.6 });
    bp.pair('ua', geo.tor(12.6 * U, 1.4 * U, 5, 16), trim, { p: [0, 3.4 * U, 3.3 * U], r: [PI / 2 + 0.35, 0, 0], shine: 0.9 });
    bp.pair('fa', geo.cyl(0.036 * H, 0.03 * H, 0.09 * H, 10), shade(sec, 1.3), { p: [0, -0.07 * H, 0], shine: 0.6 });
    const cp = cape(bp, 'chest', linePts([-0.075 * H, 0.095 * H, 0], [-0.085 * H, 0.095 * H - 0.4 * H, 0], 3), prim, shade(prim, 0.55),
      { wTop: 0.2 * H, wBot: 0.28 * H, len: 0.44 * H, bulge: 0.03 * H });
    chains.push({ names: cp, kind: 'cape' });
    const w = 'wpR';
    bp.add(w, cylX(2 * U, 2 * U, 18 * U, 8), shade(sec, 0.6), { p: [0, 0, 0] });
    bp.add(w, geo.sph(3 * U, 8, 6), trim, { p: [-10 * U, 0, 0], shine: 1 });
    bp.add(w, geo.box(4 * U, 26 * U, 5 * U), trim, { p: [10 * U, 0, 0], shine: 1 });
    const blade = [[12, -5], [96, -4.4], [112, 0], [96, 4.4], [12, 5]].map(([x, y]) => [x * U, y * U]);
    bp.add(w, geo.extrude(blade, 2 * U, 0.6 * U), 0xdfe6f0, { shine: 1 });
    bp.add(w, geo.box(70 * U, 1.6 * U, 3.2 * U), acc, { p: [50 * U, 0, 0], glow: 0.5 });
    bp.meta.style = 'greatsword';
  } else {
    // 远程：兜帽 + 法杖 + 晶石
    bp.add('head', geo.sphPart(R * 1.28, -PI * 0.6, PI * 1.2, 0, PI * 0.7, 14, 7), prim, { p: [hc[0] - R * 0.12, hc[1] + R * 0.05, 0], s: [1.05, 1.08, 1.02], c2: shade(prim, 1.2) });
    bp.add('chest', ringY(0.066 * H, 4 * U), shade(prim, 0.7), { p: [0, 0.1 * H, 0], s: [0.9, 1, 1.1] });
    const cp = cape(bp, 'chest', linePts([-0.07 * H, 0.1 * H, 0], [-0.08 * H, 0.1 * H - 0.46 * H, 0], 3), prim, shade(prim, 0.5),
      { wTop: 0.18 * H, wBot: 0.3 * H, len: 0.5 * H, bulge: 0.03 * H });
    chains.push({ names: cp, kind: 'cape' });
    const w = 'wpR';
    bp.add(w, cylX(1.9 * U, 1.6 * U, 110 * U, 8), shade(sec, 0.9), { p: [30 * U, 0, 0] });
    for (const x of [-18, 70]) bp.add(w, cylX(2.7 * U, 2.7 * U, 3 * U, 8), trim, { p: [x * U, 0, 0], shine: 1 });
    bp.add(w, geo.tor(9 * U, 1.4 * U, 5, 16), trim, { p: [88 * U, 0, 0], shine: 1 });
    bp.add(w, geo.oct(6 * U), acc, { p: [90 * U, 0, 0], s: [1.5, 1, 1], glow: 1.8 });
    bp.overlays.push((v) => {
      const s = glowSprite(acc, 34 * U, 0.7);
      s.position.set(90 * U, 0, 0);
      v.bones.wpR.add(s);
      return { update(v2) { s.visible = v2.opacity > 0.5; } };
    });
    bp.meta.style = 'wand';
  }
  bp.meta.height = Math.round(H * 1.04);
  bp.meta.chains = chains;
  bp.meta.generic = true;
}
