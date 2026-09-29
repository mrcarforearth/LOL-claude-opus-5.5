// 赵信专属特效：三重爪击（枪尖金光 + 三道爪痕/第三下雷光击飞）、风斩电刺（扇形横扫 + 雷电长枪突刺）、无畏冲锋（金红冲锋拖尾 + 落地冲击）、新月护卫（新月横扫 + 金色护卫圈）、果决
import {
  NOOP, TAU, env, easeOut3, geo, mat, mesh, sprite, sectorGeo, runeTex,
  place, flat, stick, upos, unitH, alive, seen, launch, burst, decal, ring, shock, flash, pillar,
  unitTrail, ghost, registrar, shake, low, scorch,
} from './_kit.js';

const GOLD = 0xffcf5a;
const GOLD_HOT = 0xfff2b0;
const CRIMSON = 0xd83a2a;
const BOLT = 0xbfe0ff;
const HEAL = 0x7aff9a;

// —— Q：三重爪击（枪尖金光与电弧，直到强化结束） ——
function qEmpower(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 4;
  const root = new T.Group();
  const tip = sprite(ctx, GOLD_HOT, 90, 0.9);
  const halo = sprite(ctx, GOLD, 200, 0.35);
  root.add(halo, tip);
  flash(ctx, { follow: u, h: unitH(ctx, u, 0.6), color: GOLD, size: 260, duration: 0.3 });
  let spark = 0;
  return launch(ctx, root, {
    duration: dur, tag: 'xinzhao_q_empower',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && !u.modelState?.threeTalon)) return false;
      const vis = stick(ctx, root, u, unitH(ctx, u, 0.55));
      // 枪尖：面朝方向前方
      const f = u.facing || 0;
      tip.position.set(Math.cos(f) * 110, 20, -Math.sin(f) * 110);
      halo.position.copy(tip.position);
      tip.material.opacity = 0.7 + 0.3 * Math.sin(age * 24);
      halo.material.opacity = 0.3 * env(age, dur, 0.1, 0.3);
      spark -= dt;
      if (spark <= 0 && vis && !low(ctx)) {
        spark = 0.1;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x + Math.cos(f) * 110, y: q.y + Math.sin(f) * 110, h: unitH(ctx, u, 0.55) + 20, count: 3, color: BOLT, color2: GOLD_HOT, speed: 160, size: 14, life: 0.25, vis: true });
      }
    },
  });
}
function qHit(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const q = upos(ctx, u);
  const h = unitH(ctx, u, 0.5);
  const T = ctx.THREE;
  const root = new T.Group();
  const clawG = geo(ctx, 'xin_claw', (TT) => new TT.PlaneGeometry(1, 1));
  const n = 3;
  for (let i = 0; i < n; i++) {
    const m = mesh(ctx, clawG, mat(ctx, p.third ? GOLD_HOT : GOLD, 0.95));
    m.position.set(0, (i - 1) * 26, 0);
    m.rotation.z = 0.6 + (p.index || 1) * 0.5;
    m.scale.set(170, 10, 1);
    root.add(m);
  }
  place(ctx, root, q.x, q.y, h);
  root.rotation.y = (p.owner?.facing || 0) + Math.PI / 2;
  burst(ctx, { x: q.x, y: q.y, h, count: p.third ? 22 : 10, color: GOLD, color2: BOLT, speed: p.third ? 480 : 300, size: 20, life: 0.4, up: p.third ? 1.2 : 0.4, team: p.owner?.team });
  if (p.third) {
    pillar(ctx, { x: q.x, y: q.y, radius: 60, height: 460, color: BOLT, opacity: 0.6, duration: 0.4 });
    shock(ctx, { x: q.x, y: q.y, radius: 170, color: GOLD, duration: 0.4 });
    shake(ctx, q.x, q.y, 8, 0.15);
  }
  return launch(ctx, root, {
    duration: 0.25, tag: 'xinzhao_q_hit',
    update: (t) => { root.children.forEach((m) => { m.material.opacity = 0.95 * (1 - t); m.scale.y = 10 * (1 - t) + 1; }); },
  });
}

// —— W：横扫（扇形金弧） / 突刺（雷电长枪） ——
function wSlash(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const team = u?.team;
  if (!seen(ctx, q.x, q.y, team)) return NOOP;
  const R = p.range || 450, half = ((p.angle || 120) * Math.PI) / 360;
  const a = Math.atan2(p.dirY || 0, p.dirX || 1);
  const arc = mesh(ctx, sectorGeo(ctx.THREE, 0.35, 1, half, 36, { sweep: true }), mat(ctx, GOLD, 0.9, { vc: true }));
  arc.userData.ownGeo = true;
  flat(arc, a);
  place(ctx, arc, q.x, q.y, 50);
  arc.scale.set(R, R, 1);
  burst(ctx, { x: q.x + Math.cos(a) * R * 0.6, y: q.y + Math.sin(a) * R * 0.6, h: 70, count: 14, color: GOLD, color2: GOLD_HOT, speed: 300, size: 18, life: 0.35, dir: a, arc: 1.6, team });
  return launch(ctx, arc, {
    duration: 0.28, tag: 'xinzhao_w_slash',
    update: (t) => {
      arc.rotation.z = a - half + half * 2 * easeOut3(Math.min(1, t * 1.6)) - half * 0.5;
      arc.material.opacity = 0.9 * (1 - t);
    },
  });
}
function wThrust(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const team = u?.team;
  const len = p.length || 900, a = Math.atan2(p.dirY || 0, p.dirX || 1);
  const ex = q.x + Math.cos(a) * len, ey = q.y + Math.sin(a) * len;
  if (!seen(ctx, q.x, q.y, team) && !seen(ctx, ex, ey, team)) return NOOP;
  const T = ctx.THREE;
  const root = new T.Group();
  const sg = geo(ctx, 'xin_thrust', (TT) => { const g = new TT.PlaneGeometry(1, 1); g.translate(0.5, 0, 0); return g; });
  const core = mesh(ctx, sg, mat(ctx, GOLD_HOT, 1));
  const glow = mesh(ctx, sg, mat(ctx, BOLT, 0.55));
  const vcore = mesh(ctx, sg, mat(ctx, GOLD, 0.6));
  flat(core); flat(glow);
  root.add(glow, core, vcore);
  place(ctx, root, q.x, q.y, 80);
  root.rotation.y = a;
  decal(ctx, { x: (q.x + ex) / 2, y: (q.y + ey) / 2, radius: len * 0.5, color: GOLD, opacity: 0.4, duration: 0.4, angle: a, grow: [0.8, 1], team });
  // 沿线电火花
  const n = low(ctx) ? 4 : 8;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    burst(ctx, { x: q.x + Math.cos(a) * len * k, y: q.y + Math.sin(a) * len * k, h: 80, count: 4, color: BOLT, color2: GOLD_HOT, speed: 220, size: 16, life: 0.3, team });
  }
  flash(ctx, { x: ex, y: ey, h: 80, color: BOLT, size: 220, duration: 0.3, team });
  return launch(ctx, root, {
    duration: 0.3, tag: 'xinzhao_w_thrust',
    update: (t) => {
      const k = easeOut3(Math.min(1, t * 3));
      core.scale.set(len * k, 14 * (1 - t) + 2, 1);
      glow.scale.set(len * k, 70 * (1 - t * 0.6), 1);
      vcore.scale.set(len * k, 40 * (1 - t), 1);
      core.material.opacity = 1 - t; glow.material.opacity = 0.55 * (1 - t); vcore.material.opacity = 0.6 * (1 - t);
    },
  });
}

// —— E：无畏冲锋 ——
function eCharge(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const dur = p.duration || 0.4;
  unitTrail(ctx, u, { color: GOLD, color2: CRIMSON, width: 110, seg: 22, max: 14, duration: dur, fade: 0.3, hf: 0.4 });
  unitTrail(ctx, u, { color: GOLD_HOT, color2: GOLD, width: 28, seg: 22, max: 12, duration: dur, fade: 0.2, hf: 0.6 });
  const T = ctx.THREE;
  let next = 0, n = 0;
  return launch(ctx, new T.Group(), {
    duration: dur, tag: 'xinzhao_e_charge',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (age >= next && n < 3) { next = age + dur / 3; n++; ghost(ctx, u, { color: GOLD, opacity: 0.4, duration: 0.3 }); }
      return undefined;
    },
  });
}
function eImpact(ctx, p) {
  const x = p.x, y = p.y, R = p.radius || 225, team = p.unit?.team;
  shock(ctx, { x, y, radius: R, color: GOLD, duration: 0.45, team });
  flash(ctx, { x, y, h: 80, color: GOLD_HOT, size: R * 1.8, duration: 0.3, team });
  burst(ctx, { x, y, h: 20, count: 18, color: 0x9a8a6a, speed: 320, size: 50, life: 0.7, additive: false, opacity: 0.5, up: 0.3, team });
  burst(ctx, { x, y, h: 80, count: 16, color: GOLD, color2: CRIMSON, speed: 380, size: 20, life: 0.4, up: 0.6, team });
  scorch(ctx, { x, y, radius: R * 0.6, duration: 1.8, team });
  shake(ctx, x, y, 10, 0.2);
  return NOOP;
}

// —— R：新月护卫（360° 新月横扫 + 持续护卫圈） ——
function rSweep(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const R = p.radius || 450, team = u?.team;
  if (!seen(ctx, q.x, q.y, team)) return NOOP;
  const T = ctx.THREE;
  const root = new T.Group();
  const arcG = geo(ctx, 'xin_crescent', (TT) => sectorGeo(TT, 0.6, 1, Math.PI * 0.55, 40, { sweep: true }));
  const a1 = mesh(ctx, arcG, mat(ctx, GOLD, 0.95, { vc: true }));
  const a2 = mesh(ctx, arcG, mat(ctx, GOLD_HOT, 0.7, { vc: true }));
  flat(a1); flat(a2);
  a1.scale.set(R, R, 1); a2.scale.set(R * 0.85, R * 0.85, 1);
  root.add(a1, a2);
  place(ctx, root, q.x, q.y, 60);
  shock(ctx, { x: q.x, y: q.y, radius: R, color: GOLD, duration: 0.55, team });
  flash(ctx, { x: q.x, y: q.y, h: 120, color: GOLD_HOT, size: R * 1.6, duration: 0.35, team });
  burst(ctx, { x: q.x, y: q.y, h: 30, count: 26, color: 0x9a8a6a, speed: 480, size: 60, life: 0.8, additive: false, opacity: 0.5, up: 0.2, radius: R * 0.3, team });
  shake(ctx, q.x, q.y, 16, 0.3);
  return launch(ctx, root, {
    duration: 0.4, tag: 'xinzhao_r_sweep',
    update: (t) => {
      const k = easeOut3(t);
      a1.rotation.z = -k * TAU; a2.rotation.z = -k * TAU - 0.6;
      a1.material.opacity = 0.95 * (1 - t); a2.material.opacity = 0.7 * (1 - t);
    },
  });
}
function rGuard(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const R = p.radius || 450, dur = p.duration || 3;
  const root = new T.Group();
  const wallG = geo(ctx, 'xin_guard_wall', (TT) => { const g = new TT.CylinderGeometry(1, 1, 1, 48, 1, true); g.translate(0, 0.5, 0); return g; });
  const wall = mesh(ctx, wallG, mat(ctx, GOLD, 0.18));
  wall.scale.set(R, 120, R);
  root.add(wall);
  decal(ctx, { follow: u, radius: R, color: GOLD, opacity: 0.55, duration: dur, map: runeTex(ctx), spin: 0.6, until: () => !u.modelState?.crescentGuard });
  ring(ctx, { x: u.x, y: u.y, radius: R, color: GOLD_HOT, duration: 0.5, grow: [0.8, 1] });
  return launch(ctx, root, {
    duration: dur, tag: 'xinzhao_r_guard',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && !u.modelState?.crescentGuard)) return false;
      stick(ctx, root, u, 0);
      wall.material.opacity = 0.18 * env(age, dur, 0.15, 0.4) * (0.8 + 0.2 * Math.sin(age * 6));
      wall.rotation.y += dt * 0.8;
    },
  });
}
function rBlock(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const q = upos(ctx, u);
  const a = Math.atan2(p.y - q.y, p.x - q.x);
  const R = 450;
  const x = q.x + Math.cos(a) * R, y = q.y + Math.sin(a) * R;
  flash(ctx, { x, y, h: 90, color: GOLD_HOT, size: 180, duration: 0.25, team: u.team });
  burst(ctx, { x, y, h: 90, count: 8, color: GOLD, speed: 220, size: 16, life: 0.3, dir: a + Math.PI, arc: 2, team: u.team });
  return NOOP;
}

// —— 被动：果决（第三下金色重击 + 回复绿光） ——
function pHit(ctx, p) {
  const u = p.unit, o = p.owner;
  if (u) {
    const q = upos(ctx, u);
    flash(ctx, { x: q.x, y: q.y, h: unitH(ctx, u, 0.5), color: GOLD, size: 220, duration: 0.25, team: o?.team });
  }
  if (o && alive(o)) {
    const q = upos(ctx, o);
    burst(ctx, { x: q.x, y: q.y, h: 40, count: 10, color: HEAL, speed: 60, up: 3, radius: 50, size: 18, life: 0.7, drag: 0.6, team: o.team });
  }
  return NOOP;
}

export default function register(fx) {
  const r = registrar(fx, 'xinzhao');
  r.on('xinzhao_q_empower', qEmpower);
  r.on('xinzhao_q_hit', qHit);
  r.on('xinzhao_w_slash', wSlash);
  r.on('xinzhao_w_thrust', wThrust);
  r.on('xinzhao_e_charge', eCharge);
  r.on('xinzhao_e_impact', eImpact);
  r.on('xinzhao_r_sweep', rSweep);
  r.on('xinzhao_r_guard', rGuard);
  r.on('xinzhao_r_block', rBlock);
  r.on('xinzhao_p_hit', pHit);
}
