// 墨菲特专属特效：花岗岩护盾（环绕岩壳）、地震碎片（旋转岩块 + 碎石爆裂）、雷霆拍击（熔岩拳光 + 锥形地裂余震）、
// 巨石冲击（冲击波 + 放射裂纹 + 飞石）、势不可挡（熔岩冲锋拖尾 + 落地巨震与石笋）
import {
  NOOP, TAU, rnd, easeOut3, env, geo, mat, mesh, sprite, sectorGeo, icoGeo,
  place, flat, stick, upos, unitH, alive, shown, launch, burst, decal, ring, shock, flash, pillar,
  unitTrail, ghost, projView, registrar, shake, scorch, low, yawOf, solidMat, sphereGeo,
} from './_kit.js';

const ROCK = 0x8a6a4a;
const ROCK_LIGHT = 0xc8a07a;
const DUST = 0x9a8a70;
const LAVA = 0xff7a2a;
const LAVA_HOT = 0xffd080;

// 岩块网格（受光照的实体材质 + 熔岩自发光）
function rock(ctx, size, key = 'malphite_rock') {
  const m = mesh(ctx, icoGeo(ctx, 0), solidMat(ctx, key, ROCK, { metalness: 0.1, roughness: 0.9, emissive: 0x3a1204, emissiveIntensity: 0.6 }));
  m.scale.set(size * rnd(0.8, 1.2), size * rnd(0.7, 1), size * rnd(0.8, 1.2));
  m.rotation.set(rnd(0, TAU), rnd(0, TAU), 0);
  return m;
}

// 放射裂纹（熔岩色贴地细条）
function cracks(ctx, x, y, R, n, color = LAVA, dur = 0.9, fromYaw = null, arc = TAU) {
  const T = ctx.THREE;
  const g = new T.Group();
  const cg = geo(ctx, 'malphite_crack', (TT) => { const pg = new TT.PlaneGeometry(1, 1); pg.translate(0.5, 0, 0); return pg; });
  const cm = mat(ctx, color, 0.9);
  for (let i = 0; i < n; i++) {
    const c = mesh(ctx, cg, cm);
    const a = fromYaw == null ? (i / n) * TAU + rnd(-0.2, 0.2) : fromYaw + (i / Math.max(1, n - 1) - 0.5) * arc;
    flat(c, a);
    c.scale.set(R * rnd(0.55, 1), rnd(7, 14), 1);
    g.add(c);
  }
  place(ctx, g, x, y, 4);
  return launch(ctx, g, {
    duration: dur, tag: 'malphite_cracks',
    update: (t) => { g.scale.setScalar(0.25 + 0.75 * easeOut3(Math.min(1, t * 3))); cm.opacity = 0.9 * (1 - t * t); },
  });
}

// 飞石：若干岩块抛物线飞出后落地
function debris(ctx, x, y, { n = 8, speed = 420, up = 520, size = 18, dur = 0.9 } = {}) {
  const T = ctx.THREE;
  const g = new T.Group();
  const parts = [];
  const cnt = low(ctx) ? Math.ceil(n / 2) : n;
  for (let i = 0; i < cnt; i++) {
    const r = rock(ctx, size * rnd(0.6, 1.3));
    const a = rnd(0, TAU), sp = speed * rnd(0.4, 1);
    parts.push({ m: r, vx: Math.cos(a) * sp, vz: -Math.sin(a) * sp, vy: up * rnd(0.5, 1), spin: rnd(-8, 8) });
    g.add(r);
  }
  place(ctx, g, x, y, 20);
  return launch(ctx, g, {
    duration: dur, tag: 'malphite_debris',
    update: (t, dt) => {
      for (const p of parts) {
        p.vy -= 1600 * dt;
        p.m.position.x += p.vx * dt; p.m.position.z += p.vz * dt; p.m.position.y = Math.max(-15, p.m.position.y + p.vy * dt);
        p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * dt * 0.7;
        if (t > 0.8) p.m.scale.multiplyScalar(0.9);
      }
    },
  });
}

// Q：旋转的岩块 + 尘土拖尾
function qShard(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.2;
  const root = new T.Group();
  const main = rock(ctx, 32 * size, 'malphite_q_rock');
  const bits = [rock(ctx, 12 * size), rock(ctx, 10 * size), rock(ctx, 9 * size)];
  const glow = sprite(ctx, LAVA, 90 * size, 0.45);
  root.add(glow, main, ...bits);
  return projView(ctx, p, root, {
    tag: 'malphite_q_shard',
    trail: { color: DUST, color2: LAVA, width: 40 * size, seg: 20, max: 12, fade: 0.3 },
    update: (dt, proj, cur, age) => {
      main.rotation.x += dt * 11; main.rotation.z += dt * 7;
      for (let i = 0; i < bits.length; i++) {
        const a = age * 10 + (i / bits.length) * TAU;
        bits[i].position.set(-20 - i * 14, Math.sin(a) * 18, Math.cos(a) * 18);
        bits[i].rotation.y += dt * 9;
      }
    },
  });
}

// Q 命中：碎石爆裂 + 施法者获得加速的尘土拖尾
function qHit(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const h = u ? unitH(ctx, u, 0.5) : 100;
  flash(ctx, { x: q.x, y: q.y, h, color: LAVA_HOT, size: 220, duration: 0.25 });
  burst(ctx, { x: q.x, y: q.y, h, count: 18, color: DUST, color2: ROCK_LIGHT, speed: 380, size: 34, life: 0.6, up: 0.5, additive: false, opacity: 0.75, gravity: 600 });
  burst(ctx, { x: q.x, y: q.y, h, count: 10, color: LAVA, color2: LAVA_HOT, speed: 300, size: 18, life: 0.4, up: 0.5 });
  debris(ctx, q.x, q.y, { n: 5, speed: 260, up: 380, size: 12, dur: 0.7 });
  if (u) decal(ctx, { follow: u, radius: 80, color: DUST, opacity: 0.5, duration: Math.min(4, p.duration || 4), additive: false, fout: 0.8 });
  const c = p.caster;
  if (c) unitTrail(ctx, c, { color: DUST, color2: ROCK_LIGHT, width: 50, seg: 26, max: 12, duration: Math.min(4, p.duration || 4), fade: 0.4, hf: 0.15, opacity: 0.6 });
  return NOOP;
}

// 被动：花岗岩护盾（缓慢旋转的岩片外壳 + 半透明石色护罩），护盾消失时碎裂
function granite(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const root = new T.Group();
  const shell = mesh(ctx, sphereGeo(ctx, 16), mat(ctx, ROCK_LIGHT, 0.12));
  root.add(shell);
  const plates = [];
  const n = low(ctx) ? 5 : 9;
  for (let i = 0; i < n; i++) {
    const r = rock(ctx, 22, 'malphite_plate');
    plates.push({ m: r, a: (i / n) * TAU, y: rnd(0.15, 0.95), spd: rnd(0.4, 0.9) });
    root.add(r);
  }
  const H = unitH(ctx, u, 1);
  const R = Math.max(90, (u.radius || 75) * 1.35);
  flash(ctx, { follow: u, h: H * 0.5, color: ROCK_LIGHT, size: H * 1.8, duration: 0.35, opacity: 0.6 });
  const has = () => Array.isArray(u.shields) && u.shields.some((s) => s.id === 'malphite_granite' && s.amount > 0);
  return launch(ctx, root, {
    duration: 3600, tag: 'malphite_granite',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && !has())) {
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: H * 0.5, count: 16, color: ROCK_LIGHT, color2: DUST, speed: 320, size: 30, life: 0.6, up: 0.6, additive: false, opacity: 0.8, gravity: 800 });
        debris(ctx, q.x, q.y, { n: 6, speed: 300, up: 420, size: 14, dur: 0.7 });
        return false;
      }
      stick(ctx, root, u, 0);
      const pop = age < 0.25 ? easeOut3(age / 0.25) : 1;
      shell.position.y = H * 0.5;
      shell.scale.set(R * pop, H * 0.6 * pop, R * pop);
      shell.material.opacity = 0.1 + 0.03 * Math.sin(age * 2);
      for (const pl of plates) {
        const a = pl.a + age * pl.spd;
        pl.m.position.set(Math.cos(a) * R * pop, H * pl.y, -Math.sin(a) * R * pop);
        pl.m.rotation.y = -a;
      }
      return undefined;
    },
  });
}

// W 主动：双拳熔岩光 + 脚下雷鸣符环
function wCast(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 6;
  const root = new T.Group();
  const fl = sprite(ctx, LAVA, 110, 0.7), fr = sprite(ctx, LAVA, 110, 0.7);
  root.add(fl, fr);
  const gone = () => !alive(u) || (u.hasBuff && !u.hasBuff('malphite_w_active'));
  shock(ctx, { x: u.x, y: u.y, radius: 220, color: LAVA, duration: 0.4, team: u.team });
  decal(ctx, { follow: u, radius: 130, color: LAVA, opacity: 0.45, duration: dur, spin: 1.2, until: gone, pulse: 0.5 });
  return launch(ctx, root, {
    duration: dur, tag: 'malphite_w_cast',
    update: (t, dt, age) => {
      if (age > 0.05 && gone()) return false;
      stick(ctx, root, u, 0);
      const f = u.facing || 0, h = unitH(ctx, u, 0.45);
      fl.position.set(Math.cos(f + 1.1) * 70, h, -Math.sin(f + 1.1) * 70);
      fr.position.set(Math.cos(f - 1.1) * 70, h, -Math.sin(f - 1.1) * 70);
      const k = env(age, dur, 0.1, 0.3) * (0.7 + 0.3 * Math.sin(age * 14));
      fl.material.opacity = 0.7 * k; fr.material.opacity = 0.7 * k;
      return undefined;
    },
  });
}

// W 余震：锥形地裂 + 尘土
function wShock(ctx, p) {
  const x = p.x ?? p.unit?.x ?? 0, y = p.y ?? p.unit?.y ?? 0;
  const yaw = yawOf(p.dirX ?? 1, p.dirY ?? 0);
  const R = p.range || 400;
  const half = ((p.angle || 70) * Math.PI) / 360;
  const team = p.unit?.team;
  const fan = mesh(ctx, geo(ctx, 'malphite_w_fan', (TT) => sectorGeo(TT, 0.15, 1, 0.61, 24, { radialPow: 1.5 })), mat(ctx, LAVA, 0, { vc: true }));
  flat(fan, yaw);
  place(ctx, fan, x, y, 5);
  fan.visible = shown(ctx, p.unit);
  launch(ctx, fan, {
    duration: 0.4, tag: 'malphite_w_fan',
    update: (k) => { const s = R * (0.3 + 0.7 * easeOut3(k)); fan.scale.set(s, s * (half / 0.61), 1); fan.material.opacity = 0.75 * (1 - k); },
  });
  cracks(ctx, x, y, R * 0.9, low(ctx) ? 3 : 5, LAVA, 0.7, yaw, half * 2);
  burst(ctx, { x: x + Math.cos(yaw) * R * 0.5, y: y + Math.sin(yaw) * R * 0.5, h: 20, count: 14, color: DUST, speed: 260, size: 50, life: 0.6, dir: yaw, arc: half * 2, up: 0.3, additive: false, opacity: 0.6, team });
  return NOOP;
}

// E：巨石冲击
function eSlam(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const x = q.x, y = q.y, R = p.radius || 400;
  const team = u?.team;
  shock(ctx, { x, y, radius: R, color: LAVA, duration: 0.5, team });
  ring(ctx, { x, y, radius: R * 0.8, color: ROCK_LIGHT, duration: 0.6, grow: [0.1, 1], team, additive: false, opacity: 0.6 });
  flash(ctx, { x, y, h: 50, color: LAVA_HOT, size: R * 1.1, duration: 0.3, team });
  cracks(ctx, x, y, R, low(ctx) ? 6 : 11, LAVA, 1.0);
  scorch(ctx, { x, y, radius: R * 0.6, duration: 2 });
  burst(ctx, { x, y, h: 20, count: 30, color: DUST, color2: ROCK_LIGHT, speed: 480, size: 70, life: 0.8, up: 0.2, radius: 60, additive: false, opacity: 0.6, drag: 3, team });
  debris(ctx, x, y, { n: 10, speed: 480, up: 600, size: 18, dur: 0.9 });
  shake(ctx, x, y, 14, 0.25);
  return NOOP;
}

// R 冲锋：熔岩拖尾 + 岩石残影 + 目标点预警圈
function rCharge(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const x2 = p.x2 ?? u.x, y2 = p.y2 ?? u.y, R = p.radius || 325;
  const done = () => !u.modelState?.malphiteCharging;
  unitTrail(ctx, u, { color: LAVA, color2: 0x401000, width: 150, seg: 26, max: 18, duration: 1, fade: 0.4, hf: 0.35, until: done });
  unitTrail(ctx, u, { color: LAVA_HOT, color2: LAVA, width: 50, seg: 26, max: 14, duration: 1, fade: 0.3, hf: 0.4, until: done });
  decal(ctx, { x: x2, y: y2, radius: R, color: LAVA, opacity: 0.55, duration: 1, until: done, pulse: 0.8, team: u.team });
  const T = ctx.THREE;
  const holder = new T.Group();
  let next = 0, emit = 0;
  return launch(ctx, holder, {
    duration: 1.2, tag: 'malphite_r_charge',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.05 && done())) return false;
      if (age >= next) { next = age + 0.07; ghost(ctx, u, { color: LAVA, opacity: 0.4, duration: 0.3 }); }
      emit -= dt;
      if (emit <= 0 && shown(ctx, u)) {
        emit = 0.05;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: 10, count: 4, color: DUST, speed: 160, size: 50, life: 0.6, up: 0.4, additive: false, opacity: 0.5, vis: true });
      }
      return undefined;
    },
  });
}

// R 落地：巨震冲击 + 石笋 + 飞石 + 镜头震动
function rImpact(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const x = q.x, y = q.y, R = p.radius || 325;
  const team = u?.team;
  flash(ctx, { x, y, h: 100, color: LAVA_HOT, size: R * 2.2, duration: 0.35, team });
  shock(ctx, { x, y, radius: R * 1.25, color: LAVA, duration: 0.6, team });
  ring(ctx, { x, y, radius: R, color: ROCK_LIGHT, duration: 0.8, team, additive: false, opacity: 0.7 });
  cracks(ctx, x, y, R * 1.2, low(ctx) ? 7 : 14, LAVA, 1.4);
  scorch(ctx, { x, y, radius: R, duration: 3.5 });
  pillar(ctx, { x, y, radius: 90, height: 520, color: LAVA, opacity: 0.55, duration: 0.45, team });
  // 石笋从地面刺出
  const T = ctx.THREE;
  const spikes = new T.Group();
  const n = low(ctx) ? 5 : 9;
  const sg = geo(ctx, 'malphite_spike', (TT) => { const g = new TT.ConeGeometry(1, 1, 5); g.translate(0, 0.5, 0); return g; });
  const sm = solidMat(ctx, 'malphite_spike', ROCK, { metalness: 0.1, roughness: 0.95, emissive: 0x401000, emissiveIntensity: 0.5 });
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(-0.3, 0.3), r = R * rnd(0.35, 0.85);
    const m = mesh(ctx, sg, sm);
    m.position.set(Math.cos(a) * r, 0, -Math.sin(a) * r);
    m.rotation.set(rnd(-0.35, 0.35), rnd(0, TAU), rnd(-0.35, 0.35));
    const hgt = rnd(90, 190);
    list.push({ m, hgt, w: hgt * 0.32 });
    spikes.add(m);
  }
  place(ctx, spikes, x, y, 0);
  launch(ctx, spikes, {
    duration: 1.3, tag: 'malphite_r_spikes',
    update: (t) => {
      const k = t < 0.15 ? easeOut3(t / 0.15) : t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      for (const s of list) s.m.scale.set(s.w * Math.max(0.01, k), s.hgt * Math.max(0.01, k), s.w * Math.max(0.01, k));
    },
  });
  burst(ctx, { x, y, h: 30, count: 40, color: DUST, color2: ROCK_LIGHT, speed: 620, size: 80, life: 1, up: 0.3, radius: 80, additive: false, opacity: 0.65, drag: 2.5, team });
  burst(ctx, { x, y, h: 40, count: 26, color: LAVA, color2: LAVA_HOT, speed: 700, size: 26, life: 0.6, up: 0.7, team });
  debris(ctx, x, y, { n: 14, speed: 600, up: 800, size: 24, dur: 1.1 });
  shake(ctx, x, y, 30, 0.45);
  return NOOP;
}

export default function register(fx) {
  const r = registrar(fx, 'malphite');
  r.proj('malphite_q_shard', qShard);
  r.on('malphite_q_hit', qHit);
  r.on('malphite_granite', granite);
  r.on('malphite_w_cast', wCast);
  r.on('malphite_w_shock', wShock);
  r.on('malphite_e_slam', eSlam);
  r.on('malphite_r_charge', rCharge);
  r.on('malphite_r_impact', rImpact);
}
