// 史诗野怪：元素亚龙（按元素变色）/远古巨龙、纳什男爵（坑中探出的紫色巨虫）、峡谷先锋（甲壳独眼）
import { Rig, cachedGeo, setPose, approach, PI } from './kit.js';
import { createCreatureView, SIDES } from './monsters.js';
import { DRAGON_PAL, pal } from './palette.js';

// ———————————————— 元素亚龙（约 320） ————————————————
const DRAGON_MOUTH = [262, 244, 0];
function buildDragon(type, detail) {
  const C = DRAGON_PAL[type] || DRAGON_PAL.infernal; const r = new Rig(detail);
  const elder = type === 'elder';
  r.bone('legFR', [72, 100, 52]).bone('legFL', [72, 100, -52]).bone('legBR', [-70, 100, 56]).bone('legBL', [-70, 100, -56])
    .bone('torso', [0, 112, 0]).bone('neck', [110, 160, 0], 'torso').bone('head', [180, 250, 0], 'neck').bone('jaw', [205, 240, 0], 'head')
    .bone('tail', [-120, 130, 0], 'torso').bone('tail2', [-230, 110, 0], 'tail')
    .bone('wingR', [30, 196, 50], 'torso').bone('wingL', [30, 196, -50], 'torso');
  // 躯干
  r.sph(88, C.body, { p: [0, 152, 0], s: [1.55, 0.78, 0.82], bone: 'torso' }, 14, 10);
  r.sph(70, C.belly, { p: [16, 128, 0], s: [1.45, 0.55, 0.72], bone: 'torso' }, 12, 8);
  for (let i = 0; i < 7; i++) {
    const x = 90 - i * 33; const y = 150 + 66 * Math.sqrt(Math.max(0, 1 - (x / 138) ** 2));
    if (type === 'mountain') r.dod(20 - i, C.horn, { p: [x, y, 0], s: [1.2, 0.7, 1], r: [0, i, 0] });
    else r.cone(11 - i * 0.6, 34 - i * 2, i % 2 && type === 'infernal' ? C.glow : C.horn, { p: [x, y + 10, 0], r: [0, 0, 0.45], glow: i % 2 && type === 'infernal' ? 1.8 : 0, bone: 'torso' }, 5);
  }
  if (type === 'infernal') for (let i = 0; i < 5; i++) r.box(3, 30, 5, C.glow, { p: [40 - i * 26, 120, 62 * (i % 2 ? 1 : -1)], r: [0.4, 0, 0.3], glow: 2, bone: 'torso' });
  if (type === 'ocean') r.sheet([[70, 212, 0], [0, 262, 0], [-80, 250, 0], [-120, 200, 0]], C.wing, { bone: 'torso', glow: 0.3 });
  if (type === 'mountain') for (const z of SIDES) r.dod(26, C.horn, { p: [-20, 180, 44 * z], s: [1.4, 0.6, 1], bone: 'torso' });
  // 颈部与头
  r.seg([100, 170, 0], [168, 236, 0], 40, 28, C.body, { bone: 'neck' });
  r.seg([112, 152, 0], [176, 222, 0], 26, 20, C.belly, { bone: 'neck' });
  for (let i = 0; i < 3; i++) r.cone(8, 24, C.horn, { p: [110 + i * 22, 210 + i * 22, 0], r: [0, 0, 0.6], bone: 'neck' }, 4);
  r.sph(36, C.body, { p: [194, 256, 0], s: [1.3, 0.85, 0.95], bone: 'head' }, 12, 8);
  r.box(58, 26, 40, C.body, { p: [236, 252, 0], r: [0, 0, -0.12], bone: 'head' });
  r.box(32, 10, 50, C.dark, { p: [214, 272, 0], r: [0, 0, -0.2], bone: 'head' });
  for (const z of SIDES) {
    r.box(6, 5, 8, C.glow, { p: [226, 266, 21 * z], glow: 3.4, bone: 'head' });
    r.seg([186, 276, 20 * z], [140, 318, 36 * z], elder ? 11 : 9, 1.5, C.horn, { bone: 'head' }, 6);
    r.seg([200, 270, 26 * z], [176, 292, 44 * z], 5, 1, C.horn, { bone: 'head' }, 5);
    if (type === 'ocean' || type === 'cloud') r.sheet([[196, 262, 30 * z], [170, 300, 50 * z], [150, 262, 46 * z]], C.wing, { bone: 'head' });
  }
  r.box(54, 12, 34, C.dark, { p: [232, 232, 0], r: [0, 0, -0.12], bone: 'jaw' });
  for (const z of SIDES) for (let i = 0; i < 3; i++) r.cone(2.4, 9, 0xf0ead8, { p: [220 + i * 12, 240, 13 * z], bone: 'jaw' }, 4);
  // 尾巴
  r.seg([-110, 150, 0], [-230, 120, 0], 36, 20, C.body, { bone: 'tail' });
  r.seg([-230, 120, 0], [-330, 92, 0], 20, 6, C.body, { bone: 'tail2' });
  for (let i = 0; i < 4; i++) r.cone(7 - i, 22 - i * 3, C.horn, { p: [-140 - i * 50, 150 - i * 10, 0], r: [0, 0, 0.7], bone: i < 2 ? 'tail' : 'tail2' }, 4);
  if (type === 'infernal' || elder) r.oct(14, C.glow, { p: [-338, 92, 0], s: [1.6, 1, 1], glow: 2.4, bone: 'tail2' });
  else r.sheet([[-310, 96, 0], [-360, 130, 0], [-350, 80, 0], [-370, 60, 0]], C.wing, { bone: 'tail2' });
  // 四肢
  for (const z of SIDES) {
    const bf = z > 0 ? 'legFR' : 'legFL'; const bb = z > 0 ? 'legBR' : 'legBL';
    r.seg([72, 124, 54 * z], [88, 50, 62 * z], 26, 19, C.body, { bone: bf });
    r.seg([88, 50, 62 * z], [96, 10, 64 * z], 19, 15, C.dark, { bone: bf });
    r.box(36, 12, 30, C.dark, { p: [106, 6, 64 * z], bone: bf });
    for (let k = -1; k <= 1; k++) r.cone(3.5, 14, C.horn, { p: [126, 6, (64 + k * 9) * z], r: [0, 0, -PI / 2], bone: bf }, 4);
    r.sph(40, C.body, { p: [-70, 112, 58 * z], s: [1.2, 1, 0.8], bone: bb }, 10, 8);
    r.seg([-70, 100, 60 * z], [-90, 44, 64 * z], 22, 16, C.body, { bone: bb });
    r.seg([-90, 44, 64 * z], [-78, 10, 64 * z], 16, 14, C.dark, { bone: bb });
    r.box(36, 12, 30, C.dark, { p: [-64, 6, 64 * z], bone: bb });
  }
  // 双翼
  for (const z of SIDES) {
    const b = z > 0 ? 'wingR' : 'wingL';
    const s0 = [30, 196, 52 * z]; const s1 = [10, 290, 140 * z]; const s2 = [-70, 306, 244 * z];
    const f1 = [-160, 200, 256 * z]; const f2 = [-130, 168, 176 * z]; const f3 = [-80, 176, 96 * z];
    r.seg(s0, s1, 11, 8, C.dark, { bone: b }, 6);
    r.seg(s1, s2, 8, 4.5, C.dark, { bone: b }, 6);
    for (const f of [f1, f2, f3]) r.seg(s2, f, 4, 1.5, C.dark, { bone: b }, 5);
    r.cone(4, 16, C.horn, { p: [s1[0], s1[1] + 10, s1[2]], bone: b }, 4);
    r.sheet([s0, s1, s2, f1, f2, f3, [-40, 180, 56 * z]], C.wing, { bone: b, shade: 0.3 });
  }
  r.pose('walk', { legFR: { r: [0, 0, 0.4] }, legBL: { r: [0, 0, 0.4] }, legFL: { r: [0, 0, -0.4] }, legBR: { r: [0, 0, -0.4] }, tail: { r: [0, 0.2, 0] }, tail2: { r: [0, 0.25, 0] }, neck: { r: [0, 0, 0.05] } });
  r.pose('flap', { wingR: { r: [-0.6, 0, 0.1] }, wingL: { r: [0.6, 0, 0.1] } });
  r.pose('breath', { torso: { s: [1.01, 1.03, 1.02] }, neck: { r: [0, 0, 0.04] }, tail: { r: [0, -0.1, 0] } });
  r.pose('raise', { neck: { r: [0, 0, 0.3] }, head: { r: [0, 0, 0.25] }, jaw: { r: [0, 0, -0.35] } });
  r.pose('strike', { neck: { r: [0, 0, -0.3] }, head: { r: [0, 0, -0.15] }, jaw: { r: [0, 0, -0.5] }, torso: { r: [0, 0, -0.05] } });
  const g = r.build();
  g.userData.mouth = { p: DRAGON_MOUTH, d: r.pointDeltas(DRAGON_MOUTH, 'head') };
  return g;
}

function trackPoint(tp, m, name) {
  const inf = m.morphTargetInfluences; const idx = m.geometry.userData.poses;
  const p = tp.p; let x = p[0]; let y = p[1]; let z = p[2];
  for (const k in tp.d) { const w = inf[idx[k]] || 0; if (w) { const d = tp.d[k]; x += d[0] * w; y += d[1] * w; z += d[2] * w; } }
  void name;
  return [x, y, z];
}

export function createDragonView(e, renderer) {
  const type = e.kind === 'elder_dragon' ? 'elder' : (DRAGON_PAL[e.dragonType] ? e.dragonType : 'infernal');
  const C = DRAGON_PAL[type];
  const elder = type === 'elder';
  const spec = {
    key: `dragon_${type}`, build: (d) => buildDragon(type, d), h: elder ? 360 : 330, stride: 6, scale: elder ? 1.18 : 1,
    death: 'side', deathTime: 1.1, breathRate: 1.2,
    extra(v, m, dt) {
      v.flapT = (v.flapT || 0) + dt * (v.walk > 0.2 ? 5 : 1.6);
      const amp = v.dead ? 0 : 0.25 + v.walk * 0.55 + v.raise * 0.4;
      setPose(m, 'flap', Math.sin(v.flapT) * amp + v.raise * 0.5);
      if (v.mouthGlow) {
        const q = trackPoint(m.geometry.userData.mouth, m);
        v.mouthGlow.position.set(q[0], q[1], q[2]);
        const s = v.dead ? 0 : 50 + v.raise * 90 + v.strike * 60 + Math.sin(v.t * 5) * 6;
        v.mouthGlow.scale.set(s, s, 1);
      }
      for (let i = 0; i < v.aura.length; i++) {
        const a = v.aura[i]; const k = v.dead ? 0 : a.base * (1 + 0.15 * Math.sin(v.t * 6 + i * 1.7));
        a.s.scale.set(k, k, 1);
      }
    },
  };
  const v = createCreatureView(e, renderer, spec);
  v.mouthGlow = v.sprite(C.fx, 50, DRAGON_MOUTH, v.holder, 0.85);
  v.aura = [];
  const auraPts = type === 'infernal' ? [[-20, 232, 0, 110], [60, 222, 0, 80], [-338, 96, 0, 70]]
    : elder ? [[-20, 240, 0, 150], [194, 262, 0, 90], [-338, 96, 0, 80]]
      : type === 'cloud' ? [[-40, 240, 120, 90], [-40, 240, -120, 90]]
        : type === 'ocean' ? [[-20, 260, 0, 90]] : [[-20, 236, 0, 80]];
  for (const p of (v.low ? auraPts.slice(0, 1) : auraPts)) v.aura.push({ s: v.sprite(C.fx, p[3], [p[0], p[1], p[2]], v.holder, 0.55), base: p[3] });
  return v;
}

// ———————————————— 纳什男爵（约 450） ————————————————
function buildBaron(detail) {
  const r = new Rig(detail); const S = 0x5a2a7c; const D = 0x2c1244; const B = 0x9a6ac2; const K = 0x1c0a26; const G = 0xd070ff; const P = 0x6a2a9a;
  r.bone('torso', [-100, 20, 0]).bone('neck', [-40, 250, 0], 'torso').bone('head', [50, 330, 0], 'neck').bone('jaw', [110, 318, 0], 'head')
    .bone('armR', [-50, 190, 92], 'torso').bone('armL', [-50, 190, -92], 'torso');
  // 巢坑
  r.tor(176, 30, 0x2a1a24, { p: [-100, 4, 0], r: [PI / 2, 0, 0] }, 5, 22);
  r.cyl(160, 160, 6, P, { p: [-100, 3, 0], glow: 0.7 }, 20);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2 + 0.3; r.dod(26 + (i % 3) * 8, 0x3a2a32, { p: [-100 + Math.cos(a) * 196, 16, Math.sin(a) * 196], s: [1, 0.7, 1] }); }
  // 身躯
  const chain = [[-110, -20, 0, 112], [-104, 110, 0, 102], [-70, 226, 0, 88], [-24, 282, 0, 80], [40, 322, 0, 76]];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i]; const b = chain[i + 1];
    r.seg([a[0], a[1], a[2]], [b[0], b[1], b[2]], a[3], b[3], S, { bone: i < 2 ? 'torso' : 'neck' }, 12);
    r.tor(b[3] * 0.98, 9, D, { p: [b[0], b[1], b[2]], r: [PI / 2, 0, i * 0.25 - 0.1], bone: i < 2 ? 'torso' : 'neck' }, 4, 18);
    r.sph(b[3] * 0.72, B, { p: [(a[0] + b[0]) / 2 + b[3] * 0.45, (a[1] + b[1]) / 2, 0], s: [0.5, 1.1, 1], bone: i < 2 ? 'torso' : 'neck' }, 10, 8);
  }
  for (let i = 0; i < 6; i++) {
    const y = 40 + i * 50; const x = -110 - Math.max(0, 1 - i / 3) * 0 + i * 16;
    r.cone(18 - i, 90 - i * 6, K, { p: [x - 100 + (i > 3 ? 40 : 0), y, 0], r: [0, 0, PI / 2 - 0.3], bone: i < 3 ? 'torso' : 'neck' }, 5);
    for (const z of SIDES) r.cone(10, 48, K, { p: [x - 70, y + 10, 70 * z], r: [0.8 * z, 0, PI / 2 - 0.5], bone: i < 3 ? 'torso' : 'neck' }, 4);
  }
  // 头部
  r.sph(84, S, { p: [70, 340, 0], s: [1.35, 0.82, 1.1], bone: 'head' }, 14, 10);
  r.sph(70, D, { p: [46, 384, 0], s: [1.45, 0.55, 1.2], bone: 'head' }, 12, 8);
  for (let i = 0; i < 4; i++) r.cone(12, 50, K, { p: [30 - i * 26, 412 - i * 4, 0], r: [0, 0, 0.8], bone: 'head' }, 4);
  for (const z of SIDES) {
    for (const [bx, tz, len] of [[70, 40, 1], [30, 60, 1.25]]) {
      const base = [bx, 404, tz * z]; const tip = [bx - 40 * len, 404 + 80 * len, (tz + 40 * len) * z];
      r.seg(base, tip, 13, 6, D, { bone: 'head' }, 6);
      r.sph(13, G, { p: tip, glow: 2.8, bone: 'head' }, 8, 6);
    }
    for (let k = 0; k < 3; k++) r.box(8, 7, 10, G, { p: [160 - k * 12, 350 + k * 10, (46 + k * 8) * z], glow: 3, bone: 'head' });
  }
  r.sph(40, G, { p: [140, 318, 0], s: [1.3, 0.4, 1.1], glow: 2, bone: 'head' }, 10, 6);
  // 下颚与钳颚
  r.box(110, 26, 118, D, { p: [150, 298, 0], r: [0, 0, -0.1], bone: 'jaw' });
  for (const z of SIDES) {
    r.seg([176, 306, 52 * z], [244, 280, 30 * z], 16, 3, K, { bone: 'jaw' }, 6);
    r.seg([160, 330, 60 * z], [236, 344, 38 * z], 12, 2, K, { bone: 'head' }, 6);
    for (let k = 0; k < 4; k++) r.cone(4, 16, 0xe8e0d0, { p: [120 + k * 26, 316, (48 - k * 4) * z], bone: 'jaw' }, 4);
  }
  // 两侧巨爪
  for (const z of SIDES) {
    const b = z > 0 ? 'armR' : 'armL';
    r.seg([-50, 190, 92 * z], [40, 150, 172 * z], 30, 22, S, { bone: b }, 10);
    r.seg([40, 150, 172 * z], [128, 66, 192 * z], 22, 8, D, { bone: b }, 8);
    r.cone(8, 40, K, { p: [140, 44, 194 * z], r: [0, 0, PI * 0.8], bone: b }, 5);
    for (let k = 0; k < 3; k++) r.cone(7, 30, K, { p: [0 + k * 36, 186 - k * 20, (140 + k * 20) * z], r: [0.6 * z, 0, 0.4], bone: b }, 4);
  }
  r.pose('breath', { torso: { s: [1.02, 1.02, 1.02] }, neck: { r: [0, 0, 0.03] }, jaw: { r: [0, 0, -0.06] } });
  r.pose('raise', { neck: { r: [0, 0, 0.25] }, head: { r: [0, 0, 0.2] }, jaw: { r: [0, 0, -0.3] }, armR: { r: [0, 0, 0.5] }, armL: { r: [0, 0, 0.5] } });
  r.pose('strike', { neck: { r: [0, 0, -0.35] }, head: { r: [0, 0, -0.2] }, jaw: { r: [0, 0, -0.45] }, armR: { r: [0, 0, -0.2] }, armL: { r: [0, 0, -0.2] } });
  return r.build();
}

export function createBaronView(e, renderer) {
  const spec = {
    key: 'baron', build: buildBaron, h: 460, stride: 0, death: 'sink', deathTime: 0.9, breathRate: 1.1,
    extra(v) {
      const b = v.body;
      if (!v.dead) {
        b.rotation.x = Math.sin(v.t * 0.7) * 0.05;
        b.rotation.y = Math.sin(v.t * 0.43) * 0.09;
      }
      for (let i = 0; i < v.eyes.length; i++) {
        const k = v.dead ? 0 : 60 * (1 + 0.2 * Math.sin(v.t * 4 + i));
        v.eyes[i].scale.set(k, k, 1);
      }
      const ms = v.dead ? 0 : 120 + v.raise * 120 + v.strike * 80;
      v.maw.scale.set(ms, ms * 0.6, 1);
    },
  };
  const v = createCreatureView(e, renderer, spec);
  v.eyes = [];
  if (!v.low) for (const z of SIDES) v.eyes.push(v.sprite(0xd070ff, 60, [-20, 504, 110 * z], v.holder, 0.7));
  v.maw = v.sprite(0xc060ff, 120, [150, 318, 0], v.holder, 0.7);
  return v;
}

// ———————————————— 峡谷先锋（约 250） ————————————————
function buildHerald(detail) {
  const r = new Rig(detail); const S = 0x46386a; const P = 0x6a5c9c; const F = 0x24163a; const G = 0xb070ff; const E = 0xf0e0ff;
  r.bone('legFR', [50, 80, 64]).bone('legFL', [50, 80, -64]).bone('legBR', [-50, 80, 68]).bone('legBL', [-50, 80, -68])
    .bone('torso', [0, 90, 0]).bone('head', [96, 124, 0], 'torso').bone('clawR', [70, 150, 84], 'torso').bone('clawL', [70, 150, -84], 'torso')
    .bone('eye', [-92, 196, 0], 'torso');
  r.sph(90, S, { p: [-6, 142, 0], s: [1.3, 0.9, 1.05], bone: 'torso' }, 14, 10);
  for (let i = 0; i < 4; i++) r.hemi(64 - i * 6, P, { p: [40 - i * 34, 176 + (i === 1 || i === 2 ? 12 : 0), 0], s: [0.9, 0.7, 1.35], r: [0, 0, 0.35 - i * 0.2], bone: 'torso' }, 12, 5);
  r.sph(76, F, { p: [10, 110, 0], s: [1.2, 0.6, 0.9], bone: 'torso' }, 12, 8);
  for (const z of SIDES) for (let i = 0; i < 3; i++) r.cone(10, 40, P, { p: [-30 + i * 40, 200 - i * 8, 70 * z], r: [0.7 * z, 0, 0.2], bone: 'torso' }, 4);
  // 背部巨眼（默认闭合，eyeOpen 姿态张开）
  r.tor(38, 9, P, { p: [-94, 196, 0], r: [0, PI / 2, 0], s: [1, 1, 1] , bone: 'torso' }, 5, 16);
  r.sph(34, E, { p: [-92, 196, 0], s: [0.7, 0.12, 1], bone: 'eye' }, 12, 8);
  r.sph(20, G, { p: [-112, 196, 0], s: [0.4, 0.14, 1], glow: 3, bone: 'eye' }, 10, 6);
  r.box(4, 3, 7, 0x100818, { p: [-121, 196, 0], bone: 'eye' });
  // 头
  r.sph(40, S, { p: [110, 130, 0], s: [1.2, 0.8, 1], bone: 'head' }, 12, 8);
  for (const z of SIDES) {
    r.seg([136, 112, 18 * z], [170, 96, 8 * z], 8, 2, P, { bone: 'head' }, 5);
    r.box(5, 5, 8, G, { p: [142, 140, 16 * z], glow: 3, bone: 'head' });
    r.seg([100, 160, 20 * z], [70, 200, 40 * z], 8, 1.5, P, { bone: 'head' }, 5);
  }
  // 巨钳
  for (const z of SIDES) {
    const b = z > 0 ? 'clawR' : 'clawL';
    r.seg([70, 150, 84 * z], [130, 124, 112 * z], 22, 18, P, { bone: b });
    r.sph(26, S, { p: [150, 116, 116 * z], s: [1.4, 0.9, 0.9], bone: b }, 10, 8);
    r.cone(10, 50, P, { p: [190, 126, 116 * z], r: [0, 0, -PI / 2 - 0.25], bone: b }, 5);
    r.cone(8, 40, P, { p: [184, 100, 116 * z], r: [0, 0, -PI / 2 + 0.3], bone: b }, 5);
  }
  for (const [b, x, z] of [['legFR', 50, 1], ['legFL', 50, -1], ['legBR', -50, 1], ['legBL', -50, -1]]) {
    r.seg([x, 96, 64 * z], [x * 1.5, 64, 112 * z], 15, 11, S, { bone: b });
    r.seg([x * 1.5, 64, 112 * z], [x * 1.7, 2, 124 * z], 11, 3, F, { bone: b });
  }
  r.pose('walk', { legFR: { r: [0, 0, 0.35] }, legBL: { r: [0, 0, 0.35] }, legFL: { r: [0, 0, -0.35] }, legBR: { r: [0, 0, -0.35] }, torso: { r: [0.04, 0, 0] } });
  r.pose('breath', { torso: { s: [1.02, 1.03, 1.02] }, clawR: { r: [0, 0, 0.06] }, clawL: { r: [0, 0, 0.06] } });
  r.pose('raise', { clawR: { r: [-0.2, 0, 0.9] }, clawL: { r: [0.2, 0, 0.9] }, torso: { r: [0, 0, 0.12] } });
  r.pose('strike', { clawR: { r: [0, 0, -0.4] }, clawL: { r: [0, 0, -0.4] }, torso: { r: [0, 0, -0.12] }, head: { r: [0, 0, -0.1] } });
  r.pose('eyeOpen', { eye: { s: [1, 7.5, 1] } });
  return r.build();
}

export function createHeraldView(e, renderer) {
  const ally = e.kind === 'herald_ally';
  const tint = ally ? pal(e.team).crystal : null;
  const spec = {
    key: 'herald', build: buildHerald, h: 255, stride: 7, death: 'side', deathTime: 0.9, scale: ally ? 0.95 : 1,
    extra(v, m, dt, en) {
      const open = !v.dead && !!(en.modelState && en.modelState.eyeOpen);
      v.eyeW = approach(v.eyeW || 0, open ? 1 : 0, dt * 8);
      setPose(m, 'eyeOpen', v.eyeW);
      const k = v.eyeW * (90 + Math.sin(v.t * 6) * 10);
      v.eyeGlow.scale.set(k, k, 1);
      v.eyeGlow.visible = k > 1;
    },
  };
  const v = createCreatureView(e, renderer, spec, { tint, keySuffix: '' });
  v.eyeGlow = v.sprite(ally ? pal(e.team).crystal : 0xc080ff, 90, [-118, 196, 0], v.holder, 0.8);
  if (ally) v.sprite(pal(e.team).crystal, 160, [0, 200, 0], v.holder, 0.35);
  return v;
}

export { cachedGeo };
