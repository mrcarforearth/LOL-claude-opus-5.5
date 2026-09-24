// 安妮专属特效：碎裂之火（火球）、焚烧（火焰扇形喷射）、熔岩护盾（环绕火环）、嗜火（眩晕就绪白焰）、
// 提伯斯之怒（天降火柱召唤爆炸）、提伯斯灼烧光环与消散
import {
  NOOP, TAU, env, easeOut3, geo, mat, mesh, sprite, sphereGeo, sectorGeo, place, flat, stick, upos, unitH, alive, seen, gh, planeGeo,
  launch, burst, decal, ring, shock, flash, pillar, scorch, projView, registrar, converge, shake,
  starTex, runeTex, ringTex, low, rnd,
} from './_kit.js';

const FIRE = 0xff7a1a;
const EMBER = 0xffb040;
const HOT = 0xfff0c0;
const CRIMSON = 0xff3a10;
const SMOKE = 0x3a2a24;
const STUN = 0xfff6d8;

// 通用：火焰爆炸（闪光 + 火球翻滚 + 火星 + 烟 + 焦痕）
function fireBlast(ctx, x, y, R, o = {}) {
  const team = o.team ?? null;
  const k = R / 200;
  flash(ctx, { x, y, h: 70 * k + 30, color: HOT, size: R * 2.4, duration: 0.3, team });
  flash(ctx, { x, y, h: 60 * k + 30, color: FIRE, size: R * 3, duration: 0.55, grow: [0.5, 1.2], team });
  shock(ctx, { x, y, radius: R, color: FIRE, duration: 0.5, team });
  burst(ctx, { x, y, h: 50, count: Math.round(26 * Math.min(2, k)), color: EMBER, color2: CRIMSON, speed: 520 * Math.min(1.6, k), size: 60 * Math.min(1.5, k), life: 0.55, up: 0.7, drag: 2.5, radius: R * 0.25, team });
  burst(ctx, { x, y, h: 40, count: Math.round(16 * Math.min(2, k)), color: HOT, color2: EMBER, speed: 700 * Math.min(1.5, k), size: 16, life: 0.7, up: 0.9, gravity: 900, drag: 1, team });
  if (!low(ctx)) burst(ctx, { x, y, h: 40, count: 12, color: SMOKE, color2: 0x1a1210, speed: 160, size: 110 * Math.min(1.5, k), life: 1.3, up: 0.9, drag: 1.2, radius: R * 0.3, additive: false, opacity: 0.45, team });
  scorch(ctx, { x, y, radius: R * 0.8, duration: o.scorch ?? 2.5 });
}

// —— Q：碎裂之火火球 ——
function qFireball(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.1;
  const stun = !!p.vfx?.stun;
  const root = new T.Group();
  const halo = sprite(ctx, FIRE, 190 * size, 0.6);
  const flame = sprite(ctx, EMBER, 120 * size, 0.9);
  const core = sprite(ctx, HOT, 60 * size, 1);
  root.add(halo, flame, core);
  let ringM = null;
  if (stun) {
    ringM = mesh(ctx, geo(ctx, 'annie_torus', (TT) => new TT.TorusGeometry(1, 0.06, 4, 36)), mat(ctx, STUN, 0.8));
    ringM.scale.setScalar(55 * size);
    root.add(ringM);
  }
  let emit = 0;
  return projView(ctx, p, root, {
    tag: 'annie_q_fireball', face: false,
    trail: { color: EMBER, color2: CRIMSON, width: 70 * size, seg: 20, max: 16, fade: 0.3 },
    update: (dt, proj, cur, age) => {
      const f = 1 + 0.15 * Math.sin(age * 37) + 0.08 * Math.sin(age * 61);
      flame.scale.setScalar(120 * size * f);
      halo.scale.setScalar(190 * size * (2 - f));
      if (ringM) ringM.rotation.set(age * 8, age * 5, 0);
      emit -= dt;
      if (emit <= 0 && cur.vis) {
        emit = low(ctx) ? 0.1 : 0.04;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 3, color: EMBER, color2: stun ? STUN : CRIMSON, speed: 80, size: 34, life: 0.35, up: 0.9, vis: true });
      }
    },
    onDispose: (cur) => {
      if (!cur.vis) return;
      const hh = cur.h - gh(ctx, cur.x, cur.y);
      flash(ctx, { x: cur.x, y: cur.y, h: hh, color: FIRE, size: 240, duration: 0.3 });
      burst(ctx, { x: cur.x, y: cur.y, h: hh, count: 14, color: EMBER, color2: CRIMSON, speed: 300, size: 30, life: 0.4, vis: true });
    },
  });
}

// —— W：焚烧（火焰扇形由近及远喷出） ——
function wCone(ctx, p) {
  const T = ctx.THREE;
  const u = p.unit;
  const x = u ? upos(ctx, u).x : p.x, y = u ? upos(ctx, u).y : p.y;
  const dx = p.dirX ?? 1, dy = p.dirY ?? 0;
  const yaw = Math.atan2(dy, dx);
  const R = p.range || 600;
  const half = ((p.angle || 50) * Math.PI) / 360;
  const team = u?.team ?? null;
  const root = new T.Group();
  const sg = geo(ctx, 'annie_w_sector:' + Math.round(half * 1000), (TT) => sectorGeo(TT, 0.06, 1, half, 28, { radialPow: 0.6 }));
  const outer = mesh(ctx, sg, mat(ctx, FIRE, 0, { vc: true }));
  const inner = mesh(ctx, sg, mat(ctx, HOT, 0, { vc: true }));
  const edge = mesh(ctx, geo(ctx, 'annie_w_edge:' + Math.round(half * 1000), (TT) => sectorGeo(TT, 0.9, 1, half * 1.05, 28, { radialPow: 0.2 })), mat(ctx, EMBER, 0, { vc: true }));
  for (const m of [outer, inner, edge]) flat(m, yaw);
  outer.position.y = 8; inner.position.y = 10; edge.position.y = 12;
  root.add(outer, inner, edge);
  place(ctx, root, x, y, 0);
  root.visible = seen(ctx, x, y, team);
  // 火焰喷流：沿扇形方向的大颗火焰粒子 + 火星 + 烟
  burst(ctx, { x: x + dx * 60, y: y + dy * 60, h: 80, count: 34, color: EMBER, color2: CRIMSON, speed: R * 1.9, size: 90, life: 0.5, up: 0.08, drag: 2.4, dir: yaw, arc: half * 2, team });
  burst(ctx, { x: x + dx * 60, y: y + dy * 60, h: 80, count: 20, color: HOT, color2: EMBER, speed: R * 2.2, size: 30, life: 0.45, up: 0.15, drag: 2, dir: yaw, arc: half * 1.6, team });
  if (!low(ctx)) burst(ctx, { x: x + dx * R * 0.5, y: y + dy * R * 0.5, h: 60, count: 10, color: SMOKE, speed: 120, size: 120, life: 1.1, up: 0.8, radius: R * 0.3, additive: false, opacity: 0.35, team });
  flash(ctx, { x: x + dx * 70, y: y + dy * 70, h: 100, color: HOT, size: 200, duration: 0.25, team });
  if (p.stun) flash(ctx, { x: x + dx * 70, y: y + dy * 70, h: 100, color: STUN, size: 300, duration: 0.3, map: starTex(ctx), team });
  scorch(ctx, { x: x + dx * R * 0.55, y: y + dy * R * 0.55, radius: R * 0.4, duration: 2 });
  const dur = 0.6;
  return launch(ctx, root, {
    duration: dur, tag: 'annie_w_cone',
    update: (t, dt, age) => {
      const grow = easeOut3(Math.min(1, age / 0.22));
      const k = env(age, dur, 0.04, 0.35);
      outer.scale.set(R * grow, R * grow, 1);
      inner.scale.set(R * grow * 0.75, R * grow * 0.75, 1);
      edge.scale.set(R * grow, R * grow, 1);
      outer.material.opacity = 0.75 * k;
      inner.material.opacity = 0.6 * k * (1 - t);
      edge.material.opacity = 0.9 * k;
    },
  });
}

// —— E：熔岩护盾（两道倾斜火环 + 半透明橙色护罩 + 上升火星） ——
function eShield(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const b = p.buff;
  const dur = p.duration || 3;
  const H = unitH(ctx, u, 1);
  const R = Math.max(70, H * 0.48);
  const root = new T.Group();
  const shell = mesh(ctx, sphereGeo(ctx, 20), mat(ctx, FIRE, 0));
  const ringG = geo(ctx, 'annie_e_ring', (TT) => new TT.TorusGeometry(1, 0.07, 5, 44));
  const r1 = mesh(ctx, ringG, mat(ctx, EMBER, 0));
  const r2 = mesh(ctx, ringG, mat(ctx, CRIMSON, 0));
  const flames = [];
  const nf = low(ctx) ? 3 : 6;
  for (let i = 0; i < nf; i++) { const s = sprite(ctx, i % 2 ? FIRE : EMBER, 70, 0); flames.push(s); root.add(s); }
  root.add(shell, r1, r2);
  shell.scale.setScalar(R);
  r1.scale.setScalar(R * 1.05); r2.scale.setScalar(R * 0.98);
  flash(ctx, { follow: u, h: H * 0.5, color: FIRE, size: R * 3.4, duration: 0.35 });
  ring(ctx, { follow: u, radius: R * 1.6, color: FIRE, duration: 0.4 });
  decal(ctx, { follow: u, radius: R * 1.3, color: FIRE, opacity: 0.5, duration: dur, spin: 1.8, map: runeTex(ctx) });
  let emit = 0;
  return launch(ctx, root, {
    duration: dur + 0.1, tag: 'annie_e_shield',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && b && b.removed)) return false;
      if (!stick(ctx, root, u, H * 0.5)) return undefined;
      const k = env(age, dur, 0.12, 0.3);
      shell.material.opacity = 0.12 * k * (0.85 + 0.15 * Math.sin(age * 11));
      r1.rotation.set(Math.PI / 2 + 0.5, age * 3.2, 0);
      r2.rotation.set(Math.PI / 2 - 0.45, -age * 2.6, 0.3);
      r1.material.opacity = 0.85 * k; r2.material.opacity = 0.65 * k;
      for (let i = 0; i < nf; i++) {
        const a = age * 3.4 + (i * TAU) / nf;
        const s = flames[i];
        s.position.set(Math.cos(a) * R, Math.sin(age * 5 + i) * R * 0.35, Math.sin(a) * R);
        s.material.opacity = 0.8 * k;
        s.scale.setScalar(60 + 16 * Math.sin(age * 20 + i * 3));
      }
      emit -= dt;
      if (emit <= 0) {
        emit = low(ctx) ? 0.2 : 0.08;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: 20, count: 3, color: EMBER, color2: CRIMSON, speed: 60, size: 26, life: 0.7, up: 3, drag: 0.6, radius: R * 0.8, vis: true });
      }
      return undefined;
    },
  });
}

// —— 嗜火：眩晕就绪（手中白焰 + 脚下白金旋环，直到消耗） ——
function pyroReady(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const H = unitH(ctx, u, 1);
  flash(ctx, { follow: u, h: H * 0.55, color: STUN, size: 280, duration: 0.4, map: starTex(ctx), grow: [0.4, 1.4] });
  converge(ctx, { follow: u, h: H * 0.55, radius: 200, count: 16, color: STUN, color2: EMBER, size: 24, duration: 0.5, spin: 4 });
  const root = new T.Group();
  const hand = new T.Group();
  const hGlow = sprite(ctx, STUN, 90, 0.7);
  const hCore = sprite(ctx, 0xffffff, 36, 0.9);
  const hFire = sprite(ctx, EMBER, 60, 0.6);
  hand.add(hGlow, hFire, hCore);
  const swirl = mesh(ctx, geo(ctx, 'annie_pyro_swirl', (TT) => sectorGeo(TT, 0.82, 1, Math.PI * 0.7, 30, { sweep: true })), mat(ctx, STUN, 0, { vc: true }));
  const swirl2 = mesh(ctx, geo(ctx, 'annie_pyro_swirl', (TT) => sectorGeo(TT, 0.82, 1, Math.PI * 0.7, 30, { sweep: true })), mat(ctx, EMBER, 0, { vc: true }));
  root.add(hand, swirl, swirl2);
  const R = Math.max(60, (u.radius || 60) * 1.3);
  return launch(ctx, root, {
    duration: 3600, tag: 'annie_pyro_ready',
    update: (t, dt, age) => {
      if (u.removed || (age > 0.2 && u.modelState && !u.modelState.pyroReady)) return false;
      const vis = alive(u) && stick(ctx, root, u, 0);
      root.visible = vis;
      if (!vis) return undefined;
      const f = u.facing || 0;
      const k = Math.min(1, age / 0.3);
      // 右手位置（朝向右侧前方）
      hand.position.set(Math.cos(f - 0.9) * 42, H * 0.5, -Math.sin(f - 0.9) * 42);
      hGlow.scale.setScalar(90 * (1 + 0.15 * Math.sin(age * 9)));
      hFire.scale.setScalar(60 * (1 + 0.2 * Math.sin(age * 23)));
      hGlow.material.opacity = 0.7 * k; hCore.material.opacity = 0.9 * k; hFire.material.opacity = 0.6 * k;
      flat(swirl, age * 2.4); flat(swirl2, -age * 1.8 + 1);
      swirl.position.y = 6; swirl2.position.y = 7;
      swirl.scale.set(R, R, 1); swirl2.scale.set(R * 0.85, R * 0.85, 1);
      swirl.material.opacity = 0.55 * k; swirl2.material.opacity = 0.4 * k;
      return undefined;
    },
  });
}

// 眩晕命中：头顶白金星爆
function stunBurst(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const q = upos(ctx, u);
  const H = unitH(ctx, u, 1);
  flash(ctx, { x: q.x, y: q.y, h: H * 0.6, color: STUN, size: 260, duration: 0.3, map: starTex(ctx), grow: [0.5, 1.5] });
  burst(ctx, { x: q.x, y: q.y, h: H * 0.9, count: 14, color: STUN, color2: EMBER, speed: 260, size: 26, life: 0.45, up: 0.8, map: starTex(ctx) });
  ring(ctx, { x: q.x, y: q.y, radius: 110, color: STUN, duration: 0.35 });
  return NOOP;
}

// —— R：提伯斯之怒（天降火柱 → 爆炸 → 熊落地） ——
function rSummon(ctx, p) {
  const T = ctx.THREE;
  const x = p.x, y = p.y, R = p.radius || 290;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NOOP;
  const vis = seen(ctx, x, y, null);
  // 从天而降的火流星（0.18 秒坠落）
  const root = new T.Group();
  const meteor = sprite(ctx, HOT, 160, 1);
  const mHalo = sprite(ctx, FIRE, 320, 0.7);
  root.add(mHalo, meteor);
  const streak = mesh(ctx, geo(ctx, 'annie_r_streak', (TT) => { const g = new TT.CylinderGeometry(0.2, 1, 1, 16, 1, true); g.translate(0, 0.5, 0); return g; }), mat(ctx, EMBER, 0.7));
  root.add(streak);
  place(ctx, root, x, y, 0);
  root.visible = vis;
  decal(ctx, { x, y, radius: R, color: FIRE, opacity: 0.8, duration: 1.2, spin: 1, map: runeTex(ctx), grow: [1.2, 0.9] });
  let boomed = false;
  const fall = 0.18, dur = 0.45;
  return launch(ctx, root, {
    duration: dur, tag: 'annie_r_summon',
    update: (t, dt, age) => {
      const k = Math.min(1, age / fall);
      const hh = 1400 * (1 - k * k);
      meteor.position.y = hh + 60; mHalo.position.y = hh + 60;
      streak.position.y = hh + 60;
      streak.scale.set(50, 900 * (1 - k * 0.7), 50);
      streak.material.opacity = 0.7 * (1 - k * 0.5);
      if (!boomed && k >= 1) {
        boomed = true;
        meteor.visible = mHalo.visible = streak.visible = false;
        fireBlast(ctx, x, y, R * 1.1, { scorch: 5 });
        pillar(ctx, { x, y, radius: R * 0.55, height: 700, color: FIRE, opacity: 0.85, duration: 0.55, grow: [0.6, 1.2] });
        pillar(ctx, { x, y, radius: R * 0.25, height: 900, color: HOT, opacity: 0.7, duration: 0.4 });
        ring(ctx, { x, y, radius: R * 1.35, color: EMBER, duration: 0.6, grow: [0.3, 1] });
        if (p.stun) flash(ctx, { x, y, h: 120, color: STUN, size: R * 2.2, duration: 0.4, map: starTex(ctx) });
        if (vis) shake(ctx, x, y, 22, 0.4);
      }
      return undefined;
    },
  });
}

// 提伯斯灼烧光环：脚下火焰环 + 身上翻腾火焰
function tibbersAura(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const R = p.radius || 350;
  const root = new T.Group();
  const rim = mesh(ctx, planeGeo(ctx), mat(ctx, FIRE, 0, { map: ringTex(ctx) }));
  const rune = mesh(ctx, planeGeo(ctx), mat(ctx, CRIMSON, 0, { map: runeTex(ctx) }));
  flat(rim); flat(rune);
  rim.scale.set(R * 2, R * 2, 1); rune.scale.set(R * 1.5, R * 1.5, 1);
  rim.position.y = 4; rune.position.y = 5;
  const body = new T.Group();
  const bf = [];
  const nb = low(ctx) ? 2 : 4;
  for (let i = 0; i < nb; i++) { const s = sprite(ctx, i % 2 ? CRIMSON : FIRE, 120, 0); bf.push(s); body.add(s); }
  root.add(rim, rune, body);
  let emit = 0;
  return launch(ctx, root, {
    duration: 90, tag: 'annie_tibbers_aura',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (!stick(ctx, root, u, 0)) return undefined;
      const k = Math.min(1, age / 0.5);
      rim.material.opacity = 0.55 * k * (0.8 + 0.2 * Math.sin(age * 5));
      rune.material.opacity = 0.3 * k;
      rune.rotation.z = age * 0.5;
      const H = unitH(ctx, u, 1);
      for (let i = 0; i < nb; i++) {
        const s = bf[i];
        const ph = (age * 1.3 + i / nb) % 1;
        s.position.set(Math.cos(i * 2.4) * 40, H * (0.35 + ph * 0.8), Math.sin(i * 2.4) * 40);
        s.material.opacity = 0.55 * k * Math.sin(ph * Math.PI);
        s.scale.setScalar(80 + ph * 90);
      }
      emit -= dt;
      if (emit <= 0) {
        emit = low(ctx) ? 0.3 : 0.12;
        const q = upos(ctx, u);
        const a = rnd(0, TAU), r = R * (0.3 + 0.6 * Math.random());
        burst(ctx, { x: q.x + Math.cos(a) * r, y: q.y + Math.sin(a) * r, h: 10, count: 3, color: EMBER, color2: CRIMSON, speed: 50, size: 40, life: 0.7, up: 3, drag: 0.6, vis: true });
      }
      return undefined;
    },
  });
}
function tibbersPoof(ctx, p) {
  const x = p.x, y = p.y;
  if (!Number.isFinite(x)) return NOOP;
  flash(ctx, { x, y, h: 120, color: FIRE, size: 360, duration: 0.4 });
  burst(ctx, { x, y, h: 80, count: 18, color: SMOKE, color2: 0x1a1210, speed: 200, size: 130, life: 1.2, up: 0.8, radius: 60, additive: false, opacity: 0.5 });
  burst(ctx, { x, y, h: 100, count: 22, color: EMBER, color2: CRIMSON, speed: 320, size: 30, life: 0.7, up: 1, gravity: 500 });
  ring(ctx, { x, y, radius: 200, color: FIRE, duration: 0.45 });
  return NOOP;
}

export default function register(fx) {
  const r = registrar(fx, 'annie');
  r.proj('annie_q_fireball', qFireball);
  r.on('annie_w_cone', wCone);
  r.on('annie_e_shield', eShield);
  r.on('annie_pyro_ready', pyroReady);
  r.on('annie_stun_burst', stunBurst);
  r.on('annie_r_summon', rSummon);
  r.on('annie_tibbers_aura', tibbersAura);
  r.on('annie_tibbers_poof', tibbersPoof);
}

