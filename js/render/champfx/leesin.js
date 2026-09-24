// 李青专属特效：天音波（金色音波弧）/回音击、金钟罩护盾与铁布衫、天雷破/摧筋断骨、猛龙摆尾（龙焰冲击与击飞拖尾）
import {
  TAU, NOOP, rnd, easeOut3, env, geo, mat, sharedMat, mesh, sprite, sectorGeo, sphereGeo,
  place, flat, stick, upos, unitH, alive, shown, gh, launch, burst, decal, ring, shock, flash, pillar,
  unitTrail, ghost, projView, registrar, shake, runeTex, starTex, scorch, low, yawOf,
} from './_kit.js';

const GOLD = 0xffc860;
const GOLD_HOT = 0xfff0b8;
const SKY = 0x7ac8ff;
const FLAME = 0xff7a2a;
const EMBER = 0xffb040;

// —— Q：天音波投射物（水平 + 竖直两道金色音波弧，外缘天蓝） ——
function qWave(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.2;
  const rim = p.vfx?.color ?? SKY;
  const root = new T.Group();
  const arcG = geo(ctx, 'lee_q_arc', (TT) => sectorGeo(TT, 26, 46, 1.05, 24, { radialPow: 2 }));
  const arcM = sharedMat(ctx, 'lee_q_arc', (TT) => new TT.MeshBasicMaterial({ color: GOLD, vertexColors: true, transparent: true, depthWrite: false, blending: TT.AdditiveBlending, side: TT.DoubleSide, toneMapped: false, fog: false }));
  const rimM = sharedMat(ctx, 'lee_q_rim:' + rim, (TT) => new TT.MeshBasicMaterial({ color: rim, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, blending: TT.AdditiveBlending, side: TT.DoubleSide, toneMapped: false, fog: false }));
  const arcs = [];
  for (let i = 0; i < 3; i++) {
    const h = mesh(ctx, arcG, i === 1 ? rimM : arcM);
    h.rotation.x = -Math.PI / 2;
    h.position.x = -i * 34;
    const v = mesh(ctx, arcG, i === 1 ? rimM : arcM);
    v.position.x = -i * 34;
    const s = 1 - i * 0.18;
    h.scale.setScalar(s * size); v.scale.setScalar(s * size * 0.8);
    root.add(h, v);
    arcs.push(h, v);
  }
  const core = sprite(ctx, GOLD_HOT, 90 * size, 0.9);
  core.position.x = 30 * size;
  const halo = sprite(ctx, rim, 170 * size, 0.35);
  root.add(core, halo);
  let spark = 0;
  return projView(ctx, p, root, {
    tag: 'leesin_q_wave',
    trail: { color: GOLD, color2: rim, width: 70 * size, seg: 24, max: 16, fade: 0.3 },
    update: (dt, proj, cur, age) => {
      const pulse = 1 + 0.12 * Math.sin(age * 38);
      for (let i = 0; i < arcs.length; i++) arcs[i].scale.setScalar(size * (1 - Math.floor(i / 2) * 0.18) * pulse * (i % 2 ? 0.8 : 1));
      core.material.opacity = 0.75 + 0.25 * Math.sin(age * 50);
      spark += dt;
      if (spark > 0.07 && cur.vis && !low(ctx)) {
        spark = 0;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 3, color: GOLD, color2: rim, speed: 90, size: 18, life: 0.35, up: 0.2, vis: true });
      }
    },
  });
}

// Q 命中标记：目标脚下金环 + 胸前旋转的音波光环
function qMark(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 3;
  const root = new T.Group();
  const halo = mesh(ctx, geo(ctx, 'lee_torus', (TT) => new TT.TorusGeometry(1, 0.06, 6, 40)), mat(ctx, GOLD, 0.8));
  const halo2 = mesh(ctx, geo(ctx, 'lee_torus', (TT) => new TT.TorusGeometry(1, 0.06, 6, 40)), mat(ctx, SKY, 0.55));
  const star = sprite(ctx, GOLD_HOT, 70, 0.9, starTex(ctx));
  root.add(halo, halo2, star);
  const R = Math.max(55, (u.radius || 60) * 1.1);
  halo.scale.setScalar(R); halo2.scale.setScalar(R * 0.8);
  decal(ctx, { follow: u, radius: R * 1.4, color: GOLD, opacity: 0.6, duration: dur, spin: 1.5, map: runeTex(ctx), until: () => !u.hasBuff?.('leesin_q_mark') });
  return launch(ctx, root, {
    duration: dur, tag: 'leesin_q_mark',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && u.hasBuff && !u.hasBuff('leesin_q_mark'))) return false;
      const h = unitH(ctx, u, 0.55);
      stick(ctx, root, u, h);
      halo.rotation.set(Math.PI / 2 + Math.sin(age * 3) * 0.35, age * 2, 0);
      halo2.rotation.set(Math.PI / 2 - Math.sin(age * 3) * 0.35, -age * 2.6, 0);
      star.position.y = unitH(ctx, u, 0.55) + 12 * Math.sin(age * 4);
      const k = env(age, dur, 0.15, 0.3) * (0.75 + 0.25 * Math.sin(age * 9));
      halo.material.opacity = 0.8 * k; halo2.material.opacity = 0.55 * k; star.material.opacity = 0.9 * k;
    },
  });
}

function qHit(ctx, p) {
  const x = p.unit ? upos(ctx, p.unit).x : p.x, y = p.unit ? upos(ctx, p.unit).y : p.y;
  const h = p.unit ? unitH(ctx, p.unit, 0.5) : 100;
  flash(ctx, { x, y, h, color: GOLD_HOT, size: 320, duration: 0.3 });
  flash(ctx, { x, y, h, color: SKY, size: 200, duration: 0.45, map: starTex(ctx), grow: [0.4, 1.6] });
  shock(ctx, { x, y, radius: 190, color: GOLD, duration: 0.45 });
  burst(ctx, { x, y, h, count: 26, color: GOLD, color2: GOLD_HOT, speed: 520, size: 26, life: 0.5, up: 0.5, drag: 2.5 });
  pillar(ctx, { x, y, radius: 55, height: 360, color: GOLD, opacity: 0.55, duration: 0.35 });
  shake(ctx, x, y, 8, 0.15);
  return NOOP;
}

// Q2 / W 冲刺：金色风痕 + 残影
function dash(ctx, p, color, color2, dur = 0.9) {
  const u = p.unit, t = p.target;
  if (!u) return NOOP;
  const done = () => (t && alive(t) ? Math.hypot(t.x - u.x, t.y - u.y) < (t.radius || 50) + 90 : false);
  unitTrail(ctx, u, { color, color2, width: 90, seg: 26, max: 18, duration: dur, fade: 0.3, until: done });
  unitTrail(ctx, u, { color: GOLD_HOT, color2: color2, width: 26, seg: 26, max: 14, duration: dur, fade: 0.2, hf: 0.7, until: done });
  const T = ctx.THREE;
  const holder = new T.Group();
  let next = 0, n = 0;
  return launch(ctx, holder, {
    duration: dur, tag: 'leesin_dash',
    update: (tt, dt, age) => {
      if (!alive(u) || (age > 0.05 && done())) {
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: 60, count: 14, color, color2: GOLD_HOT, speed: 300, size: 22, life: 0.4, team: u.team });
        ring(ctx, { x: q.x, y: q.y, radius: 150, color, duration: 0.35, team: u.team });
        return false;
      }
      if (age >= next && n < 3) { next = age + 0.09; n++; ghost(ctx, u, { color, opacity: 0.42, duration: 0.35 }); }
      return undefined;
    },
  });
}

// W：金钟罩护盾（金色护罩 + 两道旋转符文带）
function wShield(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 2;
  const root = new T.Group();
  const shell = mesh(ctx, sphereGeo(ctx, 20), mat(ctx, GOLD, 0.14));
  const inner = mesh(ctx, sphereGeo(ctx, 20), mat(ctx, SKY, 0.08));
  const band = mesh(ctx, geo(ctx, 'lee_band', (TT) => new TT.TorusGeometry(1, 0.035, 4, 48)), mat(ctx, GOLD_HOT, 0.8));
  const band2 = mesh(ctx, geo(ctx, 'lee_band', (TT) => new TT.TorusGeometry(1, 0.035, 4, 48)), mat(ctx, GOLD, 0.6));
  root.add(shell, inner, band, band2);
  const R = unitH(ctx, u, 0.55);
  flash(ctx, { follow: u, h: R, color: GOLD_HOT, size: R * 3, duration: 0.3 });
  burst(ctx, { x: u.x, y: u.y, h: R, count: 16, color: GOLD, speed: 240, size: 22, life: 0.5, radius: 40, team: u.team });
  return launch(ctx, root, {
    duration: dur, tag: 'leesin_w_shield',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (age > 0.15 && Array.isArray(u.shields) && !u.shields.some((s) => s.id === 'leesin_w' && s.amount > 0)) return false;
      stick(ctx, root, u, R * 0.95);
      const pop = age < 0.2 ? easeOut3(age / 0.2) : 1;
      const k = env(age, dur, 0.05, 0.3);
      shell.scale.setScalar(R * 1.05 * pop); inner.scale.setScalar(R * 0.98 * pop);
      band.scale.setScalar(R * 1.08 * pop); band2.scale.setScalar(R * 1.02 * pop);
      band.rotation.set(Math.PI / 2 + 0.5 * Math.sin(age * 2), age * 1.6, 0);
      band2.rotation.set(Math.PI / 2 - 0.6, -age * 2.2, 0.4);
      const fl = 0.85 + 0.15 * Math.sin(age * 11);
      shell.material.opacity = 0.16 * k * fl; inner.material.opacity = 0.08 * k;
      band.material.opacity = 0.8 * k * fl; band2.material.opacity = 0.55 * k;
    },
  });
}

// W2：铁布衫（金红气焰从脚下升腾）
function w2(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 4;
  const root = new T.Group();
  const aura = sprite(ctx, EMBER, unitH(ctx, u, 1.4), 0.3);
  root.add(aura);
  decal(ctx, { follow: u, radius: 110, color: GOLD, opacity: 0.55, duration: dur, spin: -1.2, map: runeTex(ctx), until: () => !alive(u) });
  let emit = 0;
  return launch(ctx, root, {
    duration: dur, tag: 'leesin_w2',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      const vis = stick(ctx, root, u, 0);
      aura.position.y = unitH(ctx, u, 0.5);
      aura.material.opacity = 0.28 * env(age, dur, 0.2, 0.5) * (0.8 + 0.2 * Math.sin(age * 7));
      emit -= dt;
      if (emit <= 0 && vis) {
        emit = low(ctx) ? 0.2 : 0.09;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: 10, count: 4, color: GOLD, color2: FLAME, speed: 60, up: 3, radius: 55, size: 24, life: 0.7, drag: 0.6, vis: true });
      }
    },
  });
}

// E：天雷破（地面冲击波 + 放射裂纹 + 尘土）
function eTempest(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const x = q.x, y = q.y, R = p.radius || 350;
  const team = u?.team;
  shock(ctx, { x, y, radius: R, color: GOLD, duration: 0.5, team });
  ring(ctx, { x, y, radius: R * 0.75, color: SKY, duration: 0.6, grow: [0.1, 1], team });
  decal(ctx, { x, y, radius: R * 0.9, color: GOLD_HOT, opacity: 0.8, duration: 0.7, grow: [0.3, 1], map: runeTex(ctx), spin: 2.5, team });
  flash(ctx, { x, y, h: 60, color: GOLD_HOT, size: R * 1.3, duration: 0.3, team });
  // 放射状金色裂纹
  const T = ctx.THREE;
  const cracks = new T.Group();
  const cg = geo(ctx, 'lee_crack', (TT) => { const g = new TT.PlaneGeometry(1, 1); g.translate(0.5, 0, 0); return g; });
  const cm = mat(ctx, GOLD, 0.9);
  const n = low(ctx) ? 6 : 10;
  for (let i = 0; i < n; i++) {
    const c = mesh(ctx, cg, cm);
    flat(c, (i / n) * TAU + rnd(-0.2, 0.2));
    c.scale.set(R * rnd(0.55, 0.95), rnd(6, 12), 1);
    cracks.add(c);
  }
  place(ctx, cracks, x, y, 4);
  launch(ctx, cracks, {
    duration: 0.8, tag: 'leesin_e_cracks',
    update: (t) => { cracks.scale.setScalar(0.3 + 0.7 * easeOut3(Math.min(1, t * 3))); cm.opacity = 0.9 * (1 - t); },
  });
  burst(ctx, { x, y, h: 20, count: 30, color: 0x9a8a6a, speed: 420, size: 60, life: 0.8, up: 0.25, radius: 60, additive: false, opacity: 0.6, drag: 3, team });
  burst(ctx, { x, y, h: 30, count: 24, color: GOLD, color2: GOLD_HOT, speed: 600, size: 22, life: 0.55, up: 0.5, radius: 40, team });
  shake(ctx, x, y, 12, 0.2);
  return NOOP;
}

// E2：摧筋断骨（目标脚下的蓝色迟缓波纹）
function e2Cripple(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const dur = p.duration || 4;
  const hs = [decal(ctx, { follow: u, radius: 85, color: SKY, opacity: 0.55, duration: dur, pulse: 0.6, fout: 0.6 })];
  burst(ctx, { x: u.x, y: u.y, h: 60, count: 10, color: SKY, speed: 160, size: 20, life: 0.5, team: u.team });
  return hs[0];
}

// R：猛龙摆尾（龙焰冲击 + 目标飞行火焰拖尾 + 落点冲击）
function rKick(ctx, p) {
  const u = p.unit, t = p.target;
  const tx = t ? upos(ctx, t).x : p.x, ty = t ? upos(ctx, t).y : p.y;
  const dirX = p.dirX ?? 1, dirY = p.dirY ?? 0;
  const yaw = yawOf(dirX, dirY);
  const dur = p.duration || 0.5;
  const team = u?.team;
  // 踢击瞬间：龙焰扇形冲击
  const T = ctx.THREE;
  const fan = mesh(ctx, geo(ctx, 'lee_r_fan', (TT) => sectorGeo(TT, 20, 1, 0.55, 28, { radialPow: 1.5 })), mat(ctx, FLAME, 0, { vc: true }));
  flat(fan, yaw);
  place(ctx, fan, tx, ty, 30);
  fan.visible = shown(ctx, t || u);
  launch(ctx, fan, {
    duration: 0.45, tag: 'leesin_r_fan',
    update: (k) => { const s = 120 + 380 * easeOut3(k); fan.scale.set(s, s, 1); fan.material.opacity = 0.95 * (1 - k); },
  });
  flash(ctx, { x: tx, y: ty, h: 110, color: GOLD_HOT, size: 520, duration: 0.35, team });
  flash(ctx, { x: tx, y: ty, h: 110, color: FLAME, size: 700, duration: 0.5, grow: [0.3, 1.2], team });
  shock(ctx, { x: tx, y: ty, radius: 260, color: FLAME, duration: 0.5, team });
  burst(ctx, { x: tx, y: ty, h: 110, count: 40, color: FLAME, color2: GOLD_HOT, speed: 900, size: 30, life: 0.6, dir: yaw, arc: 1.4, up: 0.35, drag: 2.2, team });
  burst(ctx, { x: tx, y: ty, h: 90, count: 16, color: 0x3a2a20, speed: 300, size: 90, life: 0.9, dir: yaw, arc: 1.8, additive: false, opacity: 0.45, up: 0.3, team });
  shake(ctx, tx, ty, 26, 0.35);
  // 金龙虚影：沿踢飞方向的巨大龙焰丝带
  if (t) {
    unitTrail(ctx, t, { color: FLAME, color2: 0x801a00, width: 180, seg: 30, max: 22, duration: dur + 0.1, fade: 0.45, hf: 0.4 });
    unitTrail(ctx, t, { color: GOLD_HOT, color2: FLAME, width: 60, seg: 30, max: 18, duration: dur + 0.1, fade: 0.3, hf: 0.45 });
    const holder = new T.Group();
    let emit = 0;
    launch(ctx, holder, {
      duration: dur + 0.1, tag: 'leesin_r_fly',
      update: (k, dt, age) => {
        if (!alive(t)) return false;
        emit -= dt;
        if (emit <= 0 && shown(ctx, t)) {
          emit = 0.04;
          const q = upos(ctx, t);
          burst(ctx, { x: q.x, y: q.y, h: 80 + (q.z || 0), count: 5, color: FLAME, color2: EMBER, speed: 140, size: 34, life: 0.45, up: 0.6, vis: true });
        }
        if (age >= dur) {
          const q = upos(ctx, t);
          shock(ctx, { x: q.x, y: q.y, radius: 220, color: FLAME, duration: 0.45, team });
          burst(ctx, { x: q.x, y: q.y, h: 20, count: 22, color: 0x8a7a60, speed: 380, size: 70, life: 0.8, additive: false, opacity: 0.55, up: 0.2, team });
          scorch(ctx, { x: q.x, y: q.y, radius: 150, duration: 2.5 });
          return false;
        }
        return undefined;
      },
    });
  }
  return NOOP;
}

function rCollide(ctx, p) {
  const u = p.unit;
  const x = u ? upos(ctx, u).x : p.x, y = u ? upos(ctx, u).y : p.y;
  flash(ctx, { x, y, h: 90, color: FLAME, size: 360, duration: 0.35 });
  shock(ctx, { x, y, radius: 170, color: GOLD, duration: 0.4 });
  burst(ctx, { x, y, h: 90, count: 22, color: FLAME, color2: GOLD_HOT, speed: 560, size: 26, life: 0.5, up: 0.6 });
  return NOOP;
}

export default function register(fx) {
  const r = registrar(fx, 'leesin');
  r.proj('leesin_q_wave', qWave);
  r.on('leesin_q_mark', qMark);
  r.on('leesin_q2_hit', qHit);
  r.on('leesin_q2_dash', (ctx, p) => dash(ctx, p, GOLD, SKY, 1.0));
  r.on('leesin_w_dash', (ctx, p) => dash(ctx, p, SKY, GOLD, 0.8));
  r.on('leesin_w_shield', wShield);
  r.on('leesin_w2', w2);
  r.on('leesin_e_tempest', eTempest);
  r.on('leesin_e2_cripple', e2Cripple);
  r.on('leesin_r_kick', rKick);
  r.on('leesin_r_collide', rCollide);
}
