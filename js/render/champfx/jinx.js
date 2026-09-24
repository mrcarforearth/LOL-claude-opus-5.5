// 金克丝专属特效：机枪子弹、鱼骨头鲨鱼火箭与溅射爆炸、切换武器、兴奋（粉蓝疾风）、震荡电磁波（蓄电 + 闪电弹 + 电击）、
// 嚼火者手雷（抛掷 + 咔嚓咔嚓 + 爆炸）、超究极死神飞弹（蓄力 + 鲨鱼巨弹 + 大爆炸）
import {
  NOOP, TAU, env, easeOut3, geo, mat, mesh, sprite, sharedMat, solidMat, merge, place, upos, unitH, alive, shown, seen, gh,
  launch, burst, decal, ring, shock, flash, pillar, scorch, beamGeo, projView, registrar, converge, shake, unitTrail, customTex, camOf,
  starTex, runeTex, glowTex, planeGeo, low, rnd,
} from './_kit.js';

const PINK = 0xff5ab4;
const CYAN = 0x5ae8ff;
const ZAP = 0x7ad8ff;
const YELLOW = 0xffd35a;
const ORANGE = 0xff7a2a;
const HOT = 0xfff0c8;
const SMOKE = 0x3a3440;

// —— 通用爆炸（大小 R） ——
function blast(ctx, x, y, R, o = {}) {
  const k = Math.max(0.5, R / 200);
  const c1 = o.color ?? ORANGE, c2 = o.color2 ?? PINK;
  flash(ctx, { x, y, h: 60 * k, color: HOT, size: R * 2.2, duration: 0.25 });
  flash(ctx, { x, y, h: 50 * k, color: c1, size: R * 2.8, duration: 0.5, grow: [0.5, 1.2] });
  shock(ctx, { x, y, radius: R, color: c1, duration: 0.45 });
  burst(ctx, { x, y, h: 50, count: Math.round(22 * Math.min(2, k)), color: c1, color2: c2, speed: 480 * Math.min(1.6, k), size: 55 * Math.min(1.6, k), life: 0.5, up: 0.6, drag: 2.5, radius: R * 0.2 });
  burst(ctx, { x, y, h: 40, count: Math.round(16 * Math.min(2, k)), color: HOT, color2: YELLOW, speed: 700 * Math.min(1.5, k), size: 16, life: 0.7, up: 0.8, gravity: 900, drag: 1 });
  if (!low(ctx)) burst(ctx, { x, y, h: 40, count: Math.round(10 * Math.min(2, k)), color: SMOKE, color2: 0x1a1620, speed: 150 * k, size: 110 * Math.min(1.6, k), life: 1.3, up: 0.8, drag: 1.2, radius: R * 0.3, additive: false, opacity: 0.5 });
  scorch(ctx, { x, y, radius: R * 0.75, duration: o.scorch ?? 2.5 });
}

// —— 闪电丝带（面向镜头的锯齿条带，定期重新抖动） ——
function boltTex(ctx) {
  return customTex(ctx, 'jinx_bolt', 64, (g, S) => {
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  });
}
function makeBolt(ctx, n, color, opacity) {
  const T = ctx.THREE;
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
  for (let i = 0; i < n; i++) { uv[i * 4] = i / (n - 1); uv[i * 4 + 1] = 0; uv[i * 4 + 2] = i / (n - 1); uv[i * 4 + 3] = 1; }
  for (let i = 0; i < n - 1; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = mesh(ctx, g, mat(ctx, color, opacity, { map: boltTex(ctx) }));
  m.userData.ownGeo = true;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([0, 0, 0]);
  // a/b 为场景坐标 [x,y,z]；jitter 为最大横向偏移
  m.userData.zap = (a, b, width, jitter) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1), j = i === 0 || i === n - 1 ? 0 : jitter * Math.sin(Math.PI * k);
      pts[i][0] = a[0] + dx * k + rnd(-j, j); pts[i][1] = a[1] + dy * k + rnd(-j, j) * 0.7; pts[i][2] = a[2] + dz * k + rnd(-j, j);
    }
    const cam = camOf(ctx);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      const tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2];
      let vx = 0, vy = 1, vz = 0;
      if (cam) { vx = cam.position.x - p[0]; vy = cam.position.y - p[1]; vz = cam.position.z - p[2]; }
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const l = Math.hypot(sx, sy, sz) || 1;
      const w = width * 0.5 / l;
      sx *= w; sy *= w; sz *= w;
      const j = i * 6;
      pos[j] = p[0] - sx; pos[j + 1] = p[1] - sy; pos[j + 2] = p[2] - sz;
      pos[j + 3] = p[0] + sx; pos[j + 4] = p[1] + sy; pos[j + 5] = p[2] + sz;
    }
    g.attributes.position.needsUpdate = true;
    g.computeBoundingSphere();
  };
  return m;
}

// —— 普攻：机枪子弹（黄色曳光弹，十字光条一次绘制） ——
function bullet(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 0.8;
  const root = new T.Group();
  const m = mesh(ctx, beamGeo(ctx), sharedMat(ctx, 'jinx_bullet_m', (TT) => new TT.MeshBasicMaterial({ color: YELLOW, vertexColors: true, transparent: true, depthWrite: false, blending: TT.AdditiveBlending, side: TT.DoubleSide, toneMapped: false, fog: false })));
  m.scale.set(110 * size, 14 * size, 14 * size);
  m.position.x = -110 * size;
  const head = sprite(ctx, HOT, 40 * size, 0.9);
  root.add(m, head);
  return projView(ctx, p, root, { tag: 'jinx_bullet' });
}

// —— 鱼骨头火箭 / 超究极火箭（鲨鱼造型，合并几何一次绘制） ——
const sharkGeo = (ctx) => geo(ctx, 'jinx_shark', (T) => {
  const parts = [
    [new T.SphereGeometry(1, 14, 10), { s: [60, 20, 20], c: 0xd84a6a }],
    [new T.SphereGeometry(1, 12, 8), { p: [8, -7, 0], s: [46, 12, 17], c: 0xf0e0e8 }],
    [new T.ConeGeometry(1, 1, 4), { p: [-6, 26, 0], r: [0, 0, 0.5], s: [12, 22, 3], c: 0x9a2a4a }],
    [new T.ConeGeometry(1, 1, 4), { p: [-62, 12, 0], r: [0, 0, 0.9], s: [10, 26, 3], c: 0x9a2a4a }],
    [new T.ConeGeometry(1, 1, 4), { p: [-62, -10, 0], r: [0, 0, 2.3], s: [8, 20, 3], c: 0x9a2a4a }],
    [new T.ConeGeometry(1, 1, 4), { p: [0, -8, 20], r: [1.9, 0, 0], s: [8, 18, 3], c: 0x9a2a4a }],
    [new T.ConeGeometry(1, 1, 4), { p: [0, -8, -20], r: [-1.9, 0, 0], s: [8, 18, 3], c: 0x9a2a4a }],
    [new T.SphereGeometry(1, 6, 4), { p: [40, 7, 12], s: [4, 4, 4], c: 0x101010 }],
    [new T.SphereGeometry(1, 6, 4), { p: [40, 7, -12], s: [4, 4, 4], c: 0x101010 }],
  ];
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + (i / 6) * 1.8;
    parts.push([new T.ConeGeometry(1, 1, 3), { p: [50, -1, Math.sin(a) * 13], r: [Math.PI, 0, 0], s: [2.6, 7, 2.6], c: 0xffffff }]);
  }
  return merge(T, parts);
});
const sharkMat = (ctx) => solidMat(ctx, 'jinx_shark', 0xffffff, { metalness: 0.35, roughness: 0.45, emissive: 0x401020, emissiveIntensity: 0.6, vc: true });

function rocketView(ctx, p, o) {
  const T = ctx.THREE;
  const S = o.scale;
  const root = new T.Group();
  const body = mesh(ctx, sharkGeo(ctx), sharkMat(ctx));
  body.scale.setScalar(S);
  const exhaust = sprite(ctx, ORANGE, 120 * S, 0.9);
  exhaust.position.x = -75 * S;
  const exCore = sprite(ctx, HOT, 55 * S, 1);
  exCore.position.x = -70 * S;
  const halo = sprite(ctx, o.halo ?? PINK, 200 * S, 0.3);
  root.add(halo, body, exhaust, exCore);
  let shadow = null;
  if (o.shadow) {
    shadow = mesh(ctx, planeGeo(ctx), mat(ctx, o.halo ?? ORANGE, 0.3, { map: glowTex(ctx) }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(300 * S, 140 * S, 1);
    root.add(shadow);
  }
  let emit = 0, smoke = 0;
  return projView(ctx, p, root, {
    tag: o.tag,
    trail: { color: ORANGE, color2: o.trail2 ?? PINK, width: o.tw, seg: 22, max: o.tmax || 14, fade: 0.35, dh: 0 },
    update: (dt, proj, cur, age) => {
      const f = 1 + 0.25 * Math.sin(age * 47) + 0.1 * Math.sin(age * 83);
      exhaust.scale.setScalar(120 * S * f);
      exCore.scale.setScalar(55 * S * (2 - f));
      body.rotation.x = Math.sin(age * 6) * 0.12;
      if (shadow) shadow.position.y = -(cur.h - gh(ctx, cur.x, cur.y)) + 6;
      if (!cur.vis) return;
      const hh = cur.h - gh(ctx, cur.x, cur.y);
      const bx = cur.x - Math.cos(cur.yaw) * 70 * S, by = cur.y - Math.sin(cur.yaw) * 70 * S;
      emit -= dt;
      if (emit <= 0 && o.sparks) {
        emit = low(ctx) ? 0.08 : 0.035;
        burst(ctx, { x: bx, y: by, h: hh, count: 3, color: YELLOW, color2: ORANGE, speed: 160, size: 26 * S, life: 0.35, up: 0.3, vis: true });
      }
      smoke -= dt;
      if (smoke <= 0 && !low(ctx)) {
        smoke = o.smokeRate;
        burst(ctx, { x: bx, y: by, h: hh, count: 2, color: 0x5a5060, color2: SMOKE, speed: 30, size: 70 * S, life: 0.9, up: 0.5, drag: 1, additive: false, opacity: 0.4, vis: true });
      }
    },
  });
}
const rocket = (ctx, p) => rocketView(ctx, p, { tag: 'jinx_rocket', scale: 0.55 * ((p.vfx?.size || 1.2) / 1.2), tw: 40, tmax: 10, smokeRate: 0.07, sparks: false });
const rRocket = (ctx, p) => rocketView(ctx, p, { tag: 'jinx_r_rocket', scale: 1.9 * ((p.vfx?.size || 2.4) / 2.4), tw: 150, tmax: 24, smokeRate: 0.03, sparks: true, shadow: true, halo: ORANGE, trail2: 0xff2a5a });

function rocketBlast(ctx, p) {
  if (!Number.isFinite(p.x)) return NOOP;
  blast(ctx, p.x, p.y, (p.radius || 250) * 0.8, { scorch: 1.5 });
  return NOOP;
}

// Q：切换武器（机枪 = 蓝黄；火箭 = 粉橙）
function qSwap(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const rocketMode = p.weapon === 'rocket';
  const c1 = rocketMode ? PINK : CYAN, c2 = rocketMode ? ORANGE : YELLOW;
  const H = unitH(ctx, u, 0.6);
  flash(ctx, { follow: u, h: H, color: c1, size: 220, duration: 0.3, map: starTex(ctx) });
  ring(ctx, { follow: u, radius: 130, color: c1, duration: 0.35 });
  burst(ctx, { x: u.x, y: u.y, h: H, count: 12, color: c1, color2: c2, speed: 260, size: 22, life: 0.4, up: 0.6, team: u.team });
  return NOOP;
}

// 被动：兴奋！（粉蓝双色疾风拖尾 + 闪亮火花）
function excited(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 6;
  const H = unitH(ctx, u, 1);
  flash(ctx, { follow: u, h: H * 0.6, color: PINK, size: 360, duration: 0.45, map: starTex(ctx), grow: [0.4, 1.5] });
  shock(ctx, { x: u.x, y: u.y, radius: 260, color: PINK, duration: 0.5, team: u.team });
  burst(ctx, { x: u.x, y: u.y, h: H * 0.6, count: 26, color: PINK, color2: CYAN, speed: 420, size: 28, life: 0.6, up: 0.9, map: starTex(ctx), team: u.team });
  unitTrail(ctx, u, { color: PINK, color2: 0x8a2aff, width: 60, seg: 26, max: 16, duration: dur, fade: 0.4, hf: 0.35 });
  if (!low(ctx)) unitTrail(ctx, u, { color: CYAN, color2: 0x2a6aff, width: 34, seg: 26, max: 14, duration: dur, fade: 0.4, hf: 0.75 });
  const holder = new T.Group();
  let emit = 0;
  return launch(ctx, holder, {
    duration: dur, tag: 'jinx_excited',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      emit -= dt;
      if (emit <= 0 && shown(ctx, u)) {
        emit = low(ctx) ? 0.3 : 0.12;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: H * 0.5, count: 3, color: age % 0.5 < 0.25 ? PINK : CYAN, color2: YELLOW, speed: 120, size: 24, life: 0.5, up: 1, radius: 40, map: starTex(ctx), vis: true });
      }
      return undefined;
    },
  });
}

// —— W：震荡电磁波 ——
function wCharge(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 0.6;
  const dx = p.dirX ?? Math.cos(u.facing || 0), dy = p.dirY ?? Math.sin(u.facing || 0);
  const H = unitH(ctx, u, 0.55);
  converge(ctx, { follow: u, h: H, fwd: { x: dx * 80, y: dy * 80 }, radius: 200, count: 20, color: ZAP, color2: 0xffffff, size: 22, duration: dur, spin: 5 });
  const root = new T.Group();
  const glow = sprite(ctx, ZAP, 120, 0);
  const core = sprite(ctx, 0xffffff, 40, 0);
  const bolts = [makeBolt(ctx, 7, ZAP, 0.9), makeBolt(ctx, 7, 0xffffff, 0.9)];
  root.add(glow, core, ...bolts);
  let jt = 0;
  const a = [0, 0, 0], b = [0, 0, 0];
  return launch(ctx, root, {
    duration: dur, tag: 'jinx_w_charge',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      const vis = shown(ctx, u);
      root.visible = vis;
      const q = upos(ctx, u);
      const gx = q.x + dx * 80, gy = q.y + dy * 80, gz = gh(ctx, gx, gy) + (q.z || 0) + H;
      glow.position.set(gx, gz, -gy); core.position.copy(glow.position);
      const k = easeOut3(t);
      glow.scale.setScalar(60 + 120 * k); core.scale.setScalar(20 + 50 * k);
      glow.material.opacity = 0.8 * (0.7 + 0.3 * Math.sin(age * 50)); core.material.opacity = 1;
      jt -= dt;
      if (jt <= 0 && vis) {
        jt = 0.05;
        for (const bm of bolts) {
          const ang = rnd(0, TAU), r = rnd(40, 90);
          a[0] = gx; a[1] = gz; a[2] = -gy;
          b[0] = gx + Math.cos(ang) * r; b[1] = gz + rnd(-40, 40); b[2] = -gy - Math.sin(ang) * r;
          bm.userData.zap(a, b, 14, 14);
        }
      }
      return undefined;
    },
  });
}
function zap(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.2;
  const root = new T.Group();
  const core = mesh(ctx, beamGeo(ctx), sharedMat(ctx, 'jinx_zap_m', (TT) => new TT.MeshBasicMaterial({ color: 0xe8fbff, vertexColors: true, transparent: true, depthWrite: false, blending: TT.AdditiveBlending, side: TT.DoubleSide, toneMapped: false, fog: false })));
  core.scale.set(160 * size, 26 * size, 26 * size);
  core.position.x = -150 * size;
  const halo = sprite(ctx, ZAP, 200 * size, 0.6);
  const head = sprite(ctx, 0xffffff, 70 * size, 1);
  root.add(halo, core, head);
  // 闪电丝带以世界坐标绘制，单独挂在 holder 上
  const holder = new T.Group();
  const bolts = [makeBolt(ctx, 9, ZAP, 0.85), makeBolt(ctx, 9, 0xffffff, 0.8)];
  if (!low(ctx)) bolts.push(makeBolt(ctx, 9, 0x4aa8ff, 0.7));
  holder.add(...bolts);
  const bh = launch(ctx, holder, { duration: 30, tag: 'jinx_zap_bolts' });
  let jt = 0;
  const a = [0, 0, 0], b = [0, 0, 0];
  return projView(ctx, p, root, {
    tag: 'jinx_zap',
    trail: { color: ZAP, color2: 0x2a5aff, width: 50 * size, seg: 24, max: 14, fade: 0.25 },
    update: (dt, proj, cur, age) => {
      halo.scale.setScalar(200 * size * (1 + 0.2 * Math.sin(age * 60)));
      holder.visible = cur.vis;
      jt -= dt;
      if (jt <= 0 && cur.vis) {
        jt = 0.04;
        for (let i = 0; i < bolts.length; i++) {
          const back = 200 + i * 60;
          a[0] = cur.x; a[1] = cur.h; a[2] = -cur.y;
          b[0] = cur.x - Math.cos(cur.yaw) * back; b[1] = cur.h + rnd(-20, 20); b[2] = -(cur.y - Math.sin(cur.yaw) * back);
          bolts[i].userData.zap(a, b, i === 1 ? 10 : 22, 26);
        }
      }
    },
    onDispose: () => { bh.remove?.(); },
  });
}
function zapHit(ctx, p) {
  const T = ctx.THREE;
  const u = p.target;
  const q0 = u ? upos(ctx, u) : { x: p.x, y: p.y };
  if (!Number.isFinite(q0.x)) return NOOP;
  const dur = Math.min(2.5, p.duration || 2);
  const H = u ? unitH(ctx, u, 1) : 160;
  flash(ctx, { x: q0.x, y: q0.y, h: H * 0.5, color: ZAP, size: 320, duration: 0.3, map: starTex(ctx), grow: [0.4, 1.4] });
  flash(ctx, { x: q0.x, y: q0.y, h: H * 0.5, color: 0xffffff, size: 160, duration: 0.2 });
  burst(ctx, { x: q0.x, y: q0.y, h: H * 0.5, count: 20, color: ZAP, color2: 0xffffff, speed: 420, size: 20, life: 0.4, up: 0.5 });
  ring(ctx, { x: q0.x, y: q0.y, radius: 150, color: ZAP, duration: 0.35 });
  if (u) decal(ctx, { follow: u, radius: 90, color: ZAP, opacity: 0.45, duration: dur, map: runeTex(ctx), spin: 3 });
  const root = new T.Group();
  const bolts = [makeBolt(ctx, 6, ZAP, 0.9), makeBolt(ctx, 6, 0xffffff, 0.8)];
  root.add(...bolts);
  let jt = 0;
  const a = [0, 0, 0], b = [0, 0, 0];
  return launch(ctx, root, {
    duration: dur, tag: 'jinx_zap_hit',
    update: (t, dt, age) => {
      if (u && !alive(u)) return false;
      const q = u ? upos(ctx, u) : q0;
      const vis = u ? shown(ctx, u) : seen(ctx, q.x, q.y, null);
      root.visible = vis;
      jt -= dt;
      if (jt <= 0 && vis) {
        // 间歇性电击闪烁（后半段逐渐稀疏）
        jt = 0.06 + 0.12 * t;
        const base = gh(ctx, q.x, q.y) + (q.z || 0);
        for (const bm of bolts) {
          const a1 = rnd(0, TAU), a2 = a1 + rnd(1.5, 3.5), r = (u?.radius || 60) * 0.9;
          a[0] = q.x + Math.cos(a1) * r; a[1] = base + rnd(0.2, 0.9) * H; a[2] = -(q.y + Math.sin(a1) * r);
          b[0] = q.x + Math.cos(a2) * r; b[1] = base + rnd(0.2, 0.9) * H; b[2] = -(q.y + Math.sin(a2) * r);
          bm.userData.zap(a, b, 12, 22);
        }
      }
      const k = env(age, dur, 0.02, 0.3);
      bolts[0].material.opacity = 0.9 * k * (Math.random() < 0.8 ? 1 : 0.2);
      bolts[1].material.opacity = 0.8 * k;
      return undefined;
    },
  });
}

// —— E：嚼火者（三颗咬合手雷：抛掷 → 落地布防 → 咔嚓待命） ——
const chomperGeo = (ctx) => geo(ctx, 'jinx_chomper', (T) => {
  const parts = [
    [new T.SphereGeometry(1, 12, 8, 0, TAU, 0, Math.PI / 2), { p: [0, 2, 0], s: [30, 22, 30], c: 0xe0542a }],
    [new T.SphereGeometry(1, 12, 8, 0, TAU, Math.PI / 2, Math.PI / 2), { p: [0, -2, 0], s: [30, 16, 30], c: 0x8a2a1a }],
    [new T.TorusGeometry(1, 0.12, 4, 16), { r: [Math.PI / 2, 0, 0], s: [30, 30, 30], c: 0x3a3a44 }],
    [new T.SphereGeometry(1, 6, 4), { p: [20, 14, 10], s: [6, 6, 6], c: 0xfff0a0 }],
    [new T.SphereGeometry(1, 6, 4), { p: [20, 14, -10], s: [6, 6, 6], c: 0xfff0a0 }],
  ];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    parts.push([new T.ConeGeometry(1, 1, 3), { p: [Math.cos(a) * 26, 4, Math.sin(a) * 26], r: [Math.PI, 0, 0], s: [4, 9, 4], c: 0xffffff }]);
  }
  return merge(T, parts);
});
function chompers(ctx, p) {
  const T = ctx.THREE;
  const list = Array.isArray(p.chompers) ? p.chompers : [];
  if (!list.length) return NOOP;
  const z = p.zone || null;
  const team = p.team ?? z?.owner?.team ?? null;
  const arm = p.armTime || 0.5, dur = (p.duration || 5.5) + 0.2;
  const fx0 = Number.isFinite(p.fromX) ? p.fromX : p.x, fy0 = Number.isFinite(p.fromY) ? p.fromY : p.y;
  const root = new T.Group();
  const items = list.map((c, i) => {
    const g = new T.Group();
    const body = mesh(ctx, chomperGeo(ctx), solidMat(ctx, 'jinx_chomper', 0xffffff, { metalness: 0.4, roughness: 0.4, emissive: 0x401008, emissiveIntensity: 0.7, vc: true }));
    body.scale.setScalar(1.2);
    const eye = sprite(ctx, 0xff3a2a, 60, 0);
    eye.position.y = 40;
    g.add(body, eye);
    root.add(g);
    return { c, g, body, eye, seed: i * 1.7, landed: false, rimH: null };
  });
  let emit = 0;
  return launch(ctx, root, {
    duration: dur, tag: 'jinx_chompers',
    update: (t, dt, age) => {
      if (z && z.dead) return false;
      let any = false;
      for (const it of items) {
        const c = it.c;
        if (c.exploded) { it.g.visible = false; if (it.rimH) { it.rimH.remove?.(); it.rimH = null; } continue; }
        any = true;
        const vis = seen(ctx, c.x, c.y, team);
        it.g.visible = vis;
        const k = Math.min(1, age / arm);
        if (k < 1) {
          // 抛物线飞行 + 翻滚
          const x = fx0 + (c.x - fx0) * k, y = fy0 + (c.y - fy0) * k;
          place(ctx, it.g, x, y, 60 + 260 * 4 * k * (1 - k));
          it.body.rotation.set(age * 12 + it.seed, age * 5, 0);
          it.eye.material.opacity = 0;
        } else {
          if (!it.landed) {
            it.landed = true;
            if (vis) burst(ctx, { x: c.x, y: c.y, h: 10, count: 8, color: 0x8a7a60, speed: 160, size: 40, life: 0.5, up: 0.3, additive: false, opacity: 0.5, vis: true });
            it.rimH = ring(ctx, { x: c.x, y: c.y, radius: 90, color: ORANGE, duration: dur - age, opacity: 0.55, grow: [1, 1], fin: 0.1, fout: 0.2, team });
          }
          const ta = age - arm;
          // 咔嚓咔嚓：上下颌开合（纵向缩放跳动）
          const chomp = Math.abs(Math.sin(ta * 9 + it.seed));
          place(ctx, it.g, c.x, c.y, 18 + chomp * 6);
          it.body.rotation.set(0, it.seed + Math.sin(ta * 2 + it.seed) * 0.4, 0);
          it.body.scale.set(1.2, 1.2 * (0.8 + 0.35 * chomp), 1.2);
          const blink = (ta * 2 + it.seed) % 1 < 0.5 ? 1 : 0.25;
          it.eye.material.opacity = 0.9 * blink;
        }
      }
      if (!any) return false;
      emit -= dt;
      if (emit <= 0 && age > arm && !low(ctx)) {
        emit = 0.35;
        const it = items[Math.floor(Math.random() * items.length)];
        if (!it.c.exploded && it.g.visible) burst(ctx, { x: it.c.x, y: it.c.y, h: 40, count: 2, color: YELLOW, color2: ORANGE, speed: 120, size: 16, life: 0.3, up: 1.2, gravity: 600, vis: true });
      }
      return undefined;
    },
    onEnd: () => { for (const it of items) { it.rimH?.remove?.(); it.rimH = null; } },
  });
}
function chomperBlast(ctx, p) {
  if (!Number.isFinite(p.x)) return NOOP;
  const R = p.radius || 150;
  blast(ctx, p.x, p.y, R * 1.2, { color: ORANGE, color2: 0xff3a2a, scorch: 2 });
  pillar(ctx, { x: p.x, y: p.y, radius: R * 0.4, height: 380, color: ORANGE, opacity: 0.6, duration: 0.35 });
  shake(ctx, p.x, p.y, 8, 0.2);
  return NOOP;
}

// —— R：超究极死神飞弹 ——
function rCast(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 0.6;
  const dx = p.dirX ?? 1, dy = p.dirY ?? 0;
  const H = unitH(ctx, u, 0.75);
  converge(ctx, { follow: u, h: H, fwd: { x: dx * 40, y: dy * 40 }, radius: 240, count: 22, color: ORANGE, color2: PINK, size: 28, duration: dur, spin: -3 });
  decal(ctx, { follow: u, radius: 170, color: PINK, opacity: 0.65, duration: dur + 0.2, map: runeTex(ctx), spin: 3, grow: [0.5, 1] });
  const root = new T.Group();
  const glow = sprite(ctx, ORANGE, 100, 0);
  const star = sprite(ctx, HOT, 160, 0, starTex(ctx));
  root.add(glow, star);
  return launch(ctx, root, {
    duration: dur + 0.1, tag: 'jinx_r_cast',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      const q = upos(ctx, u);
      const vis = shown(ctx, u);
      root.visible = vis;
      const gx = q.x + dx * 40, gy = q.y + dy * 40;
      glow.position.set(gx, gh(ctx, gx, gy) + (q.z || 0) + H, -gy); star.position.copy(glow.position);
      const k = easeOut3(Math.min(1, age / dur));
      glow.scale.setScalar(80 + 220 * k); star.scale.setScalar(100 + 260 * k);
      glow.material.opacity = 0.8 * k; star.material.opacity = 0.7 * k; star.material.rotation = age * 6;
      if (age >= dur && !root.userData.fired) {
        root.userData.fired = true;
        if (vis) {
          flash(ctx, { x: gx, y: gy, h: H, color: HOT, size: 520, duration: 0.3, team: u.team });
          burst(ctx, { x: q.x - dx * 60, y: q.y - dy * 60, h: H, count: 16, color: SMOKE, speed: 260, size: 120, life: 1, up: 0.5, dir: Math.atan2(-dy, -dx), arc: 1.4, additive: false, opacity: 0.5, vis: true });
          shake(ctx, q.x, q.y, 10, 0.25);
        }
      }
      return undefined;
    },
  });
}
function rBlast(ctx, p) {
  if (!Number.isFinite(p.x)) return NOOP;
  const x = p.x, y = p.y, R = p.radius || 225;
  blast(ctx, x, y, R * 1.5, { color: ORANGE, color2: 0xff2a5a, scorch: 4 });
  pillar(ctx, { x, y, radius: R * 0.6, height: 800, color: ORANGE, opacity: 0.75, duration: 0.5, grow: [0.6, 1.2] });
  pillar(ctx, { x, y, radius: R * 0.3, height: 1000, color: HOT, opacity: 0.6, duration: 0.35 });
  ring(ctx, { x, y, radius: R * 2, color: PINK, duration: 0.6, grow: [0.3, 1] });
  flash(ctx, { x, y, h: 140, color: PINK, size: R * 4, duration: 0.6, map: starTex(ctx), grow: [0.4, 1.3] });
  shake(ctx, x, y, 28, 0.45);
  return NOOP;
}

export default function register(fx) {
  const r = registrar(fx, 'jinx');
  r.proj('jinx_bullet', bullet);
  r.proj('jinx_rocket', rocket);
  r.proj('jinx_zap', zap);
  r.proj('jinx_r_rocket', rRocket);
  r.on('jinx_rocket_blast', rocketBlast);
  r.on('jinx_q_swap', qSwap);
  r.on('jinx_excited', excited);
  r.on('jinx_w_charge', wCharge);
  r.on('jinx_zap_hit', zapHit);
  r.on('jinx_chompers', chompers);
  r.on('jinx_chomper_blast', chomperBlast);
  r.on('jinx_r_cast', rCast);
  r.on('jinx_r_blast', rBlast);
}

