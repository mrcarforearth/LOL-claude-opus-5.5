// 艾希专属特效：冰霜射击（冰晶箭）、专注（射手专注连射与弓身寒气）、万箭齐发（扇形冰箭）、鹰击长空（鹰灵飞行与盘旋侦察）、
// 魔法水晶箭（巨型冰晶箭 + 冰爆冰刺）
import {
  NOOP, TAU, env, easeOut3, geo, mat, mesh, sprite, sharedMat, solidMat, sectorGeo, merge, place, flat, stick, upos, unitH, alive, seen, gh,
  launch, burst, decal, ring, shock, flash, pillar, projView, registrar, converge, shake, customTex, teamOnlyHidden,
  starTex, runeTex, glowTex, planeGeo, low, rnd,
} from './_kit.js';

const FROST = 0x9ae8ff;
const ICE = 0xc8f2ff;
const DEEP = 0x3a8cff;
const WHITE = 0xf0fbff;

// —— 箭矢几何（沿 +X，箭头在 +X 端），顶点色：箭头白亮、箭杆冰蓝、尾羽深蓝 ——
function arrowParts(T, ox = 0, oz = 0, s = 1, oy = 0) {
  return [
    [new T.CylinderGeometry(1.3, 1.3, 64, 5), { p: [ox - 6 * s, oy, oz], r: [0, 0, -Math.PI / 2], s: [s, s, s], c: 0x7ec8ff }],
    [new T.OctahedronGeometry(1, 0), { p: [ox + 34 * s, oy, oz], s: [16 * s, 5 * s, 5 * s], c: 0xffffff }],
    [new T.OctahedronGeometry(1, 0), { p: [ox + 28 * s, oy, oz], s: [7 * s, 7.5 * s, 7.5 * s], c: 0xbfeaff }],
    [new T.BoxGeometry(14, 0.6, 7), { p: [ox - 34 * s, oy, oz], s: [s, s, s], c: 0x3a8cff }],
    [new T.BoxGeometry(14, 7, 0.6), { p: [ox - 34 * s, oy, oz], s: [s, s, s], c: 0x3a8cff }],
  ];
}
const arrowGeo = (ctx) => geo(ctx, 'ashe_arrow', (T) => merge(T, arrowParts(T)));
// 专注连射：五支箭交错成一束（一次绘制）
const volleyGeo = (ctx, n = 5) => geo(ctx, 'ashe_volley' + n, (T) => {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    parts.push(...arrowParts(T, -Math.abs(k) * 26, k * 18, 0.85, (i % 2) * 8 - 4));
  }
  return merge(T, parts);
});
// 魔法水晶箭：加长箭杆 + 箭头冰晶簇
const bigArrowGeo = (ctx) => geo(ctx, 'ashe_r_arrow', (T) => {
  const parts = arrowParts(T, 0, 0, 3.2);
  const cl = [[0, 0, 0, 1], [-18, 14, 10, 0.6], [-18, -12, -12, 0.6], [-30, 4, -16, 0.5], [-30, -6, 16, 0.5]];
  for (const [dx, dy, dz, s] of cl) parts.push([new T.OctahedronGeometry(1, 0), { p: [110 + dx, dy, dz], s: [34 * s, 12 * s, 12 * s], r: [rnd(0, 1), 0, 0], c: 0xe8f8ff }]);
  return merge(T, parts);
});
const arrowMat = (ctx) => sharedMat(ctx, 'ashe_arrow_m', (T) => new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false, fog: false }));

function arrowView(ctx, p, g, o = {}) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1;
  const root = new T.Group();
  const body = mesh(ctx, g, arrowMat(ctx));
  body.scale.setScalar(size * (o.scale || 1));
  const glow = sprite(ctx, p.vfx?.color ?? FROST, (o.glow || 90) * size, 0.55);
  glow.position.x = 26 * size * (o.scale || 1);
  root.add(body, glow);
  return projView(ctx, p, root, {
    tag: o.tag || 'ashe_arrow',
    trail: o.trail === false ? null : { color: ICE, color2: DEEP, width: (o.tw || 26) * size, seg: 20, max: o.tmax || 10, fade: 0.2, skipLow: true },
    update: (dt, proj, cur, age) => {
      glow.material.opacity = 0.45 + 0.15 * Math.sin(age * 40);
      o.update?.(dt, proj, cur, age);
    },
    onDispose: o.onDispose,
  });
}

// —— 普攻：冰晶箭 ——
const basicArrow = (ctx, p) => arrowView(ctx, p, arrowGeo(ctx), { tag: 'ashe_arrow' });
// 专注：五箭齐射
function volley(ctx, p) {
  const n = Math.max(2, Math.min(8, p.vfx?.arrows || 5));
  return arrowView(ctx, p, volleyGeo(ctx, n), { tag: 'ashe_volley', glow: 150, tw: 70, tmax: 12 });
}
// 万箭齐发：单支冰箭（9 支同时飞行，拖尾更短）
const wArrow = (ctx, p) => arrowView(ctx, p, arrowGeo(ctx), { tag: 'ashe_w_arrow', tw: 22, tmax: 8 });

// Q：射手专注（弓手周围环绕冰晶 + 脚下寒霜法阵）
function qFocus(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 4;
  const H = unitH(ctx, u, 1);
  flash(ctx, { follow: u, h: H * 0.55, color: FROST, size: 300, duration: 0.35, map: starTex(ctx) });
  converge(ctx, { follow: u, h: H * 0.55, radius: 220, count: 16, color: ICE, color2: DEEP, size: 24, duration: 0.45, spin: 3 });
  decal(ctx, { follow: u, radius: 110, color: FROST, opacity: 0.55, duration: dur, spin: 1.4, map: runeTex(ctx) });
  const root = new T.Group();
  const motes = [];
  const n = low(ctx) ? 3 : 5;
  for (let i = 0; i < n; i++) { const s = sprite(ctx, i % 2 ? ICE : FROST, 34, 0, starTex(ctx)); motes.push(s); root.add(s); }
  return launch(ctx, root, {
    duration: dur, tag: 'ashe_q_focus',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (!stick(ctx, root, u, 0)) return undefined;
      const k = env(age, dur, 0.15, 0.4);
      for (let i = 0; i < n; i++) {
        const a = age * 4 + (i * TAU) / n;
        motes[i].position.set(Math.cos(a) * 60, H * (0.35 + 0.25 * ((i % 3) / 2)) + Math.sin(age * 5 + i) * 10, Math.sin(a) * 60);
        motes[i].material.opacity = 0.9 * k;
        motes[i].material.rotation = age * 3 + i;
      }
    },
  });
}

// W：万箭齐发 施放（弓前扇形寒气闪光）
function wCast(ctx, p) {
  const T = ctx.THREE;
  const u = p.unit;
  const q = u ? upos(ctx, u) : { x: p.x, y: p.y };
  const dx = p.dirX ?? 1, dy = p.dirY ?? 0, yaw = Math.atan2(dy, dx);
  const half = ((p.angle || 57.5) * Math.PI) / 360;
  const team = u?.team ?? null;
  const R = 320;
  const m = mesh(ctx, geo(ctx, 'ashe_w_fan', (TT) => sectorGeo(TT, 0.15, 1, (57.5 * Math.PI) / 360, 24, { radialPow: 0.5 })), mat(ctx, FROST, 0, { vc: true }));
  flat(m, yaw);
  place(ctx, m, q.x, q.y, 10);
  m.visible = seen(ctx, q.x, q.y, team);
  const sx = half / ((57.5 * Math.PI) / 360);
  flash(ctx, { x: q.x + dx * 60, y: q.y + dy * 60, h: 110, color: WHITE, size: 220, duration: 0.25, map: starTex(ctx), team });
  burst(ctx, { x: q.x + dx * 50, y: q.y + dy * 50, h: 100, count: 22, color: ICE, color2: DEEP, speed: 700, size: 22, life: 0.35, up: 0.05, drag: 3, dir: yaw, arc: half * 2, team });
  const dur = 0.4;
  return launch(ctx, m, {
    duration: dur, tag: 'ashe_w_cast',
    update: (t) => {
      const g = easeOut3(Math.min(1, t * 2.5));
      m.scale.set(R * g, R * g * sx, 1);
      m.material.opacity = 0.7 * (1 - t);
    },
  });
}

// —— E：鹰击长空（鹰灵：发光身体 + 拍打的羽翼） ——
function wingTex(ctx) {
  return customTex(ctx, 'ashe_wing', 128, (g, S) => {
    // 画布上方 = 翼根，下方 = 翼尖；右侧 = 前缘
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.6, 'rgba(170,230,255,0.85)');
    gr.addColorStop(1, 'rgba(90,170,255,0.2)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(S * 0.78, 0);
    g.quadraticCurveTo(S * 0.98, S * 0.45, S * 0.62, S * 0.98);
    const feathers = 6;
    for (let i = 0; i <= feathers; i++) {
      const k = i / feathers;
      const x = S * (0.62 - 0.5 * k), y = S * (0.98 - 0.72 * k);
      g.lineTo(x - S * 0.06, y - S * 0.14);
      g.lineTo(x - S * 0.08, y - S * 0.02);
    }
    g.lineTo(S * 0.1, 0);
    g.closePath();
    g.fill();
  });
}
function hawkModel(ctx, size = 1) {
  const T = ctx.THREE;
  const root = new T.Group();
  const wg = geo(ctx, 'ashe_wing_geo', (TT) => { const g = new TT.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0, 0.5); return g; });
  const wm = sharedMat(ctx, 'ashe_wing_m', (TT) => new TT.MeshBasicMaterial({ map: wingTex(ctx), color: 0xbfeaff, transparent: true, depthWrite: false, side: TT.DoubleSide, blending: TT.AdditiveBlending, toneMapped: false, fog: false }));
  const right = mesh(ctx, wg, wm);
  const left = mesh(ctx, wg, wm);
  right.scale.set(90 * size, 1, 130 * size);
  left.scale.set(90 * size, 1, -130 * size);
  const body = sprite(ctx, ICE, 90 * size, 0.9);
  const halo = sprite(ctx, FROST, 240 * size, 0.35);
  const head = sprite(ctx, WHITE, 40 * size, 1);
  head.position.x = 40 * size;
  root.add(halo, left, right, body, head);
  root.userData.flap = (age) => {
    const a = Math.sin(age * 9) * 0.55;
    right.rotation.x = -a; left.rotation.x = a;
  };
  return root;
}
function hawk(ctx, p) {
  const size = (p.vfx?.size || 1.4) / 1.4;
  const root = hawkModel(ctx, size);
  return projView(ctx, p, root, {
    tag: 'ashe_hawk',
    trail: { color: ICE, color2: DEEP, width: 60 * size, seg: 26, max: 18, fade: 0.4 },
    update: (dt, proj, cur, age) => root.userData.flap(age),
  });
}
// E 落点：鹰灵在侦察区域上空盘旋 + 淡蓝视野圈（仅本方可见）
function eReveal(ctx, p) {
  if (teamOnlyHidden(ctx, p.team)) return NOOP;
  const T = ctx.THREE;
  const x = p.x, y = p.y, R = p.radius || 1000, dur = p.duration || 5;
  if (!Number.isFinite(x)) return NOOP;
  const root = new T.Group();
  const bird = hawkModel(ctx, 0.9);
  root.add(bird);
  place(ctx, root, x, y, 0);
  ring(ctx, { x, y, radius: R, color: FROST, duration: 0.8, opacity: 0.6, team: p.team });
  decal(ctx, { x, y, radius: R, color: FROST, opacity: 0.18, duration: dur, fout: 0.8, map: glowTex(ctx), team: p.team });
  decal(ctx, { x, y, radius: 220, color: ICE, opacity: 0.4, duration: dur, spin: 0.6, map: runeTex(ctx), team: p.team });
  burst(ctx, { x, y, h: 260, count: 18, color: ICE, color2: DEEP, speed: 280, size: 26, life: 0.6, team: p.team });
  return launch(ctx, root, {
    duration: dur, tag: 'ashe_e_reveal',
    update: (t, dt, age) => {
      const a = age * 1.1;
      const r = 260;
      bird.position.set(Math.cos(a) * r, 320 + Math.sin(age * 2) * 20, -Math.sin(a) * r);
      bird.rotation.y = a + Math.PI / 2;
      bird.rotation.z = 0;
      bird.rotation.x = -0.35;
      bird.userData.flap(age * 0.6);
      const k = env(age, dur, 0.3, 0.8);
      bird.visible = k > 0.02;
      bird.scale.setScalar(Math.max(0.01, k));
    },
  });
}

// —— R：魔法水晶箭 ——
function rArrow(ctx, p) {
  const T = ctx.THREE;
  const size = (p.vfx?.size || 2.4) / 2.4;
  const root = new T.Group();
  const body = mesh(ctx, bigArrowGeo(ctx), arrowMat(ctx));
  body.scale.setScalar(size);
  const halo = sprite(ctx, FROST, 420 * size, 0.5);
  const tip = sprite(ctx, WHITE, 200 * size, 0.9);
  tip.position.x = 120 * size;
  const star = sprite(ctx, ICE, 300 * size, 0.6, starTex(ctx));
  star.position.x = 120 * size;
  const shadow = mesh(ctx, planeGeo(ctx), mat(ctx, FROST, 0.35, { map: glowTex(ctx) }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(420 * size, 160 * size, 1);
  root.add(shadow, halo, body, tip, star);
  let emit = 0;
  return projView(ctx, p, root, {
    tag: 'ashe_r_arrow',
    trail: { color: ICE, color2: DEEP, width: 170 * size, seg: 30, max: 22, fade: 0.5 },
    update: (dt, proj, cur, age) => {
      shadow.position.y = -(cur.h - gh(ctx, cur.x, cur.y)) + 6;
      star.material.rotation = age * 3;
      halo.scale.setScalar(420 * size * (1 + 0.08 * Math.sin(age * 20)));
      body.rotation.x = age * 4;
      emit -= dt;
      if (emit <= 0 && cur.vis) {
        emit = low(ctx) ? 0.08 : 0.03;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 4, color: ICE, color2: DEEP, speed: 140, size: 34, life: 0.6, up: 0.2, radius: 30, map: starTex(ctx), vis: true });
      }
    },
  });
}
function rCast(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const q = upos(ctx, u);
  const dx = p.dirX ?? 1, dy = p.dirY ?? 0;
  const H = unitH(ctx, u, 0.55);
  flash(ctx, { x: q.x + dx * 60, y: q.y + dy * 60, h: H, color: WHITE, size: 420, duration: 0.35, team: u.team });
  flash(ctx, { x: q.x + dx * 60, y: q.y + dy * 60, h: H, color: FROST, size: 560, duration: 0.5, map: starTex(ctx), team: u.team });
  ring(ctx, { x: q.x, y: q.y, radius: 220, color: FROST, duration: 0.45, team: u.team });
  burst(ctx, { x: q.x + dx * 60, y: q.y + dy * 60, h: H, count: 24, color: ICE, color2: DEEP, speed: 520, size: 28, life: 0.45, dir: Math.atan2(dy, dx), arc: 1.4, up: 0.2, team: u.team });
  return NOOP;
}
// R 命中：冰爆 + 地面冰刺（持续眩晕时长后沉入地面）
const spikeGeo = (ctx) => geo(ctx, 'ashe_spikes', (T) => {
  const parts = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(-0.2, 0.2), r = i === 0 ? 0 : rnd(55, 115), h = i === 0 ? 170 : rnd(70, 140);
    const tilt = i === 0 ? 0 : 0.35 + rnd(0, 0.25);
    parts.push([new T.ConeGeometry(1, 1, 5), {
      p: [Math.cos(a) * r, h * 0.45, -Math.sin(a) * r], r: [Math.sin(a) * tilt, rnd(0, 3), Math.cos(a) * tilt], s: [i === 0 ? 34 : rnd(14, 24), h, i === 0 ? 34 : rnd(14, 24)],
      c: i % 3 === 0 ? 0xffffff : 0xa8e4ff,
    }]);
  }
  return merge(T, parts);
});
function rImpact(ctx, p) {
  const T = ctx.THREE;
  const u = p.target;
  const x = u ? upos(ctx, u).x : p.x, y = u ? upos(ctx, u).y : p.y;
  if (!Number.isFinite(x)) return NOOP;
  const R = p.radius || 250;
  const stun = Math.max(0.8, p.stun || 1.5);
  flash(ctx, { x, y, h: 100, color: WHITE, size: R * 2.6, duration: 0.35 });
  flash(ctx, { x, y, h: 100, color: FROST, size: R * 3.2, duration: 0.6, map: starTex(ctx), grow: [0.4, 1.3] });
  shock(ctx, { x, y, radius: R * 1.2, color: FROST, duration: 0.55 });
  ring(ctx, { x, y, radius: R * 1.6, color: ICE, duration: 0.7, grow: [0.4, 1] });
  pillar(ctx, { x, y, radius: 90, height: 600, color: ICE, opacity: 0.6, duration: 0.45 });
  burst(ctx, { x, y, h: 90, count: 34, color: ICE, color2: DEEP, speed: 640, size: 30, life: 0.6, up: 0.6, gravity: 700, drag: 1.2, map: starTex(ctx) });
  if (!low(ctx)) burst(ctx, { x, y, h: 30, count: 14, color: 0xdff4ff, speed: 220, size: 120, life: 1.1, up: 0.4, radius: 60, additive: false, opacity: 0.4 });
  decal(ctx, { x, y, radius: R * 1.1, color: FROST, opacity: 0.55, duration: stun + 0.6, fout: 0.6, map: runeTex(ctx), spin: 0.3 });
  decal(ctx, { x, y, radius: R * 1.3, color: 0xdff6ff, opacity: 0.35, duration: stun + 0.8, fout: 0.8, map: glowTex(ctx) });
  shake(ctx, x, y, 20, 0.35);
  const spikes = mesh(ctx, spikeGeo(ctx), solidMat(ctx, 'ashe_spike', 0xffffff, { metalness: 0.1, roughness: 0.15, emissive: 0x2a6cc8, emissiveIntensity: 0.55, vc: true }));
  const glow = mesh(ctx, spikeGeo(ctx), mat(ctx, FROST, 0.25, { vc: true }));
  glow.scale.setScalar(1.08);
  const root = new T.Group();
  root.add(spikes, glow);
  place(ctx, root, x, y, 0);
  root.rotation.y = rnd(0, TAU);
  root.visible = seen(ctx, x, y, null);
  const dur = stun + 0.5;
  return launch(ctx, root, {
    duration: dur, tag: 'ashe_r_impact',
    update: (t, dt, age) => {
      const up = easeOut3(Math.min(1, age / 0.12));
      const sink = age > stun ? Math.min(1, (age - stun) / 0.5) : 0;
      const s = Math.max(0.01, up * (1 - sink));
      root.scale.set(0.6 + 0.4 * s, s, 0.6 + 0.4 * s);
      glow.material.opacity = 0.25 * (1 - sink) * (0.8 + 0.2 * Math.sin(age * 8));
    },
  });
}

export default function register(fx) {
  const r = registrar(fx, 'ashe');
  r.proj('ashe_arrow', basicArrow);
  r.proj('ashe_volley', volley);
  r.proj('ashe_w_arrow', wArrow);
  r.proj('ashe_hawk', hawk);
  r.proj('ashe_r_arrow', rArrow);
  r.on('ashe_q_focus', qFocus);
  r.on('ashe_w_cast', wCast);
  r.on('ashe_e_reveal', eReveal);
  r.on('ashe_r_cast', rCast);
  r.on('ashe_r_impact', rImpact);
}
