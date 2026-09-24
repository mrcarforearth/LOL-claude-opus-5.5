// 易大师专属特效：双重打击、阿尔法突袭（残影剑光与十字斩）、冥想（金色莲座）、无极剑道（剑刃青焰）、高原血统（金色气场与疾风）
import {
  NOOP, rnd, easeOut3, env, geo, mat, mesh, sprite, place, stick, upos, unitH, alive, shown, seen,
  launch, burst, decal, ring, shock, flash, pillar, ghost, registrar, shake, runeTex, starTex, streakTex, planeGeo, low, yawOf,
} from './_kit.js';

const LIME = 0xc8ff5a;
const GOLDEN = 0xffd86a;
const HOT = 0xf4ffd8;
const VIOLET = 0xb07aff;

// 刀光：沿 angle 方向的细长光刃（略微倾斜的平面），快速展开后淡出
function slash(ctx, o) {
  const { x, y, h = 110, angle = 0, len = 260, width = 36, color = LIME, duration = 0.28, tilt = 0.5, team = null, vis = null } = o;
  const T = ctx.THREE;
  const g = new T.Group();
  const m = mesh(ctx, planeGeo(ctx), mat(ctx, color, 0, { map: streakTex(ctx) }));
  const core = mesh(ctx, planeGeo(ctx), mat(ctx, HOT, 0, { map: streakTex(ctx) }));
  m.rotation.x = -Math.PI / 2 + tilt; core.rotation.x = m.rotation.x;
  g.add(m, core);
  g.rotation.y = angle;
  place(ctx, g, x, y, h);
  g.visible = vis ?? seen(ctx, x, y, team);
  return launch(ctx, g, {
    duration, tag: 'masteryi_slash',
    update: (t) => {
      const k = easeOut3(Math.min(1, t * 2.2));
      const L = len * (0.3 + 0.7 * k);
      m.scale.set(L, width, 1); core.scale.set(L * 0.9, width * 0.3, 1);
      m.position.x = core.position.x = -len * 0.5 + L * 0.5 + len * 0.25 * t;
      const f = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      m.material.opacity = 0.95 * f; core.material.opacity = f;
    },
  });
}

// 普攻被动：双重打击（两道交叉斩击）
function double(ctx, p) {
  const t = p.target;
  const q = t ? upos(ctx, t) : p;
  const h = t ? unitH(ctx, t, 0.5) : 100;
  const base = p.unit ? yawOf(q.x - p.unit.x, q.y - p.unit.y) : rnd(0, 6.28);
  const team = p.unit?.team;
  slash(ctx, { x: q.x, y: q.y, h, angle: base + 0.8, len: 240, width: 40, color: GOLDEN, duration: 0.26, team });
  slash(ctx, { x: q.x, y: q.y, h: h + 10, angle: base - 0.8, len: 240, width: 40, color: LIME, duration: 0.3, team });
  flash(ctx, { x: q.x, y: q.y, h, color: GOLDEN, size: 180, duration: 0.25, map: starTex(ctx), team });
  burst(ctx, { x: q.x, y: q.y, h, count: 12, color: GOLDEN, color2: LIME, speed: 360, size: 18, life: 0.35, team });
  return NOOP;
}

// Q 开始：原地化作青光消失
function qStart(ctx, p) {
  const u = p.unit;
  const x = p.x ?? u?.x, y = p.y ?? u?.y;
  const team = u?.team;
  if (u) ghost(ctx, u, { color: LIME, opacity: 0.6, duration: 0.45, drift: 160, grow: 0.15 });
  flash(ctx, { x, y, h: 100, color: LIME, size: 320, duration: 0.3, team });
  ring(ctx, { x, y, radius: 160, color: LIME, duration: 0.4, team });
  burst(ctx, { x, y, h: 60, count: 22, color: LIME, color2: HOT, speed: 260, up: 1.4, size: 22, life: 0.55, radius: 50, team });
  return NOOP;
}

// Q 每一击：长剑光划过 + 目标身上十字斩 + 残影
function qStrike(ctx, p) {
  const t = p.target;
  const q = t ? upos(ctx, t) : p;
  const h = t ? unitH(ctx, t, 0.5) : 100;
  const crit = !!p.crit;
  const col = crit ? GOLDEN : LIME;
  const vis = t ? shown(ctx, t) : seen(ctx, q.x, q.y, null);
  const fx0 = p.fromX ?? q.x - 200, fy0 = p.fromY ?? q.y, tx = p.toX ?? q.x + 200, ty = p.toY ?? q.y;
  const ang = yawOf(tx - fx0, ty - fy0);
  const L = Math.max(260, Math.hypot(tx - fx0, ty - fy0) + 120);
  slash(ctx, { x: (fx0 + tx) / 2, y: (fy0 + ty) / 2, h: h + 10, angle: ang, len: L, width: crit ? 60 : 44, color: col, duration: 0.34, tilt: 0.25, vis });
  const cross = ang + Math.PI / 2 + rnd(-0.3, 0.3);
  slash(ctx, { x: q.x, y: q.y, h, angle: cross, len: crit ? 320 : 250, width: crit ? 56 : 40, color: crit ? HOT : GOLDEN, duration: 0.3, tilt: 0.9, vis });
  flash(ctx, { x: q.x, y: q.y, h, color: col, size: crit ? 380 : 240, duration: 0.3, map: starTex(ctx), vis });
  burst(ctx, { x: q.x, y: q.y, h, count: crit ? 26 : 16, color: col, color2: HOT, speed: crit ? 620 : 420, size: 20, life: 0.4, up: 0.5, vis });
  if (crit) shock(ctx, { x: q.x, y: q.y, radius: 170, color: GOLDEN, duration: 0.35 });
  // 残影：在出刀位置显现一瞬
  // 参数不含施法者：按距离找到正在突袭（隐藏中）的易
  let u = p.unit || null;
  if (!u) {
    let best = 1e9;
    for (const c of ctx.game?.champions || []) {
      if (c.championId !== 'masteryi' || !c.modelState?.hidden) continue;
      const d = Math.hypot(c.x - tx, c.y - ty);
      if (d < best) { best = d; u = c; }
    }
  }
  if (u && vis) ghost(ctx, u, { color: col, opacity: 0.55, duration: 0.3, x: tx, y: ty, facing: yawOf(q.x - tx, q.y - ty) });
  return NOOP;
}

function qEnd(ctx, p) {
  const u = p.unit;
  const x = u ? upos(ctx, u).x : p.x, y = u ? upos(ctx, u).y : p.y;
  const team = u?.team;
  flash(ctx, { x, y, h: 110, color: HOT, size: 300, duration: 0.3, team });
  ring(ctx, { x, y, radius: 180, color: LIME, duration: 0.4, team });
  burst(ctx, { x, y, h: 90, count: 18, color: LIME, color2: GOLDEN, speed: 320, size: 20, life: 0.45, team });
  if (u) ghost(ctx, u, { color: LIME, opacity: 0.5, duration: 0.35, grow: 0.2 });
  return NOOP;
}

// W 冥想：金色莲座（旋转法阵 + 半透明光罩 + 上升光点）
function wMeditate(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = (p.duration || 4) + 0.5;
  const root = new T.Group();
  const dome = mesh(ctx, geo(ctx, 'yi_dome', (TT) => new TT.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), mat(ctx, GOLDEN, 0));
  const petals = new T.Group();
  const pg = geo(ctx, 'yi_petal', (TT) => { const g = new TT.CircleGeometry(1, 16); g.scale(0.38, 1, 1); g.translate(0, 1, 0); return g; });
  const pm = mat(ctx, GOLDEN, 0);
  for (let i = 0; i < 8; i++) {
    const pt = mesh(ctx, pg, pm);
    pt.rotation.set(-Math.PI / 2 + 0.55, 0, 0);
    const holder = new T.Group();
    holder.rotation.y = (i / 8) * Math.PI * 2;
    holder.add(pt);
    petals.add(holder);
  }
  const halo = sprite(ctx, GOLDEN, unitH(ctx, u, 1.5), 0);
  root.add(dome, petals, halo);
  const R = 120;
  dome.scale.set(R, unitH(ctx, u, 0.85), R);
  petals.scale.setScalar(70);
  halo.position.y = unitH(ctx, u, 0.55);
  decal(ctx, { follow: u, radius: 150, color: GOLDEN, opacity: 0.7, duration: dur, spin: 0.6, map: runeTex(ctx), until: () => !u.modelState?.meditating });
  let emit = 0;
  return launch(ctx, root, {
    duration: dur, tag: 'masteryi_w',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && !u.modelState?.meditating)) return false;
      const vis = stick(ctx, root, u, 0);
      const k = env(age, dur, 0.3, 0.3);
      const br = 0.8 + 0.2 * Math.sin(age * 2.4);
      dome.material.opacity = 0.12 * k * br;
      pm.opacity = 0.35 * k * br;
      halo.material.opacity = 0.25 * k * br;
      petals.rotation.y = age * 0.4;
      emit -= dt;
      if (emit <= 0 && vis) {
        emit = low(ctx) ? 0.25 : 0.1;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: 10, count: 3, color: GOLDEN, color2: HOT, speed: 30, up: 5, radius: 110, size: 20, life: 1.1, drag: 0.4, vis: true });
      }
    },
  });
}

// E 无极剑道：剑刃（身体右前方）青金色火焰
function eWuju(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = (p.duration || 5) + 0.5;
  const root = new T.Group();
  const blade = sprite(ctx, LIME, 90, 0);
  const blade2 = sprite(ctx, GOLDEN, 60, 0);
  root.add(blade, blade2);
  let emit = 0;
  flash(ctx, { follow: u, h: unitH(ctx, u, 0.5), color: LIME, size: 260, duration: 0.3 });
  return launch(ctx, root, {
    duration: dur, tag: 'masteryi_e',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && !u.modelState?.wuju)) return false;
      const vis = stick(ctx, root, u, 0);
      const f = Number.isFinite(u.facing) ? u.facing : 0;
      // 剑在右手，偏前方
      const ox = Math.cos(f) * 45 + Math.cos(f - Math.PI / 2) * 40, oy = Math.sin(f) * 45 + Math.sin(f - Math.PI / 2) * 40;
      const hh = unitH(ctx, u, 0.5);
      blade.position.set(ox, hh, -oy);
      blade2.position.set(ox * 1.6, hh + 25, -oy * 1.6);
      const k = env(age, dur, 0.1, 0.3) * (0.7 + 0.3 * Math.sin(age * 17));
      blade.material.opacity = 0.7 * k; blade2.material.opacity = 0.6 * k;
      emit -= dt;
      if (emit <= 0 && vis) {
        emit = low(ctx) ? 0.18 : 0.07;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x + ox * 1.3, y: q.y + oy * 1.3, h: hh + (q.z || 0), count: 3, color: LIME, color2: GOLDEN, speed: 40, up: 3, radius: 30, size: 22, life: 0.45, drag: 0.8, vis: true });
      }
    },
  });
}

// R 击杀刷新：金色脉冲
function rTakedown(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const q = upos(ctx, u);
  flash(ctx, { follow: u, h: unitH(ctx, u, 0.55), color: GOLDEN, size: 420, duration: 0.45 });
  ring(ctx, { x: q.x, y: q.y, radius: 260, color: GOLDEN, duration: 0.55, team: u.team });
  pillar(ctx, { follow: u, radius: 70, height: 420, color: GOLDEN, opacity: 0.55, duration: 0.5 });
  burst(ctx, { x: q.x, y: q.y, h: 80, count: 26, color: GOLDEN, color2: HOT, speed: 380, up: 1.2, size: 22, life: 0.6, team: u.team });
  return NOOP;
}

// R 高原血统：金色气场 + 身后疾风光条 + 脚下法阵
function rHighlander(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = (p.duration || 7) + 40;   // 参与击杀会延长；以 modelState 为准
  const root = new T.Group();
  const aura = sprite(ctx, GOLDEN, unitH(ctx, u, 1.7), 0);
  const aura2 = sprite(ctx, VIOLET, unitH(ctx, u, 1.2), 0);
  root.add(aura, aura2);
  const q0 = upos(ctx, u);
  shock(ctx, { x: q0.x, y: q0.y, radius: 300, color: GOLDEN, duration: 0.5, team: u.team });
  pillar(ctx, { follow: u, radius: 90, height: 600, color: GOLDEN, opacity: 0.6, duration: 0.6 });
  burst(ctx, { x: q0.x, y: q0.y, h: 60, count: 30, color: GOLDEN, color2: VIOLET, speed: 420, up: 1, size: 24, life: 0.6, team: u.team });
  shake(ctx, q0.x, q0.y, 8, 0.2);
  decal(ctx, { follow: u, radius: 120, color: GOLDEN, opacity: 0.5, duration: dur, spin: -2, map: runeTex(ctx), until: () => !u.modelState?.highlander });
  let emit = 0, lastX = q0.x, lastY = q0.y;
  return launch(ctx, root, {
    duration: dur, tag: 'masteryi_r',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && !u.modelState?.highlander)) return false;
      const vis = stick(ctx, root, u, 0);
      const hh = unitH(ctx, u, 0.55);
      aura.position.y = hh; aura2.position.y = hh;
      const k = Math.min(1, age / 0.3) * (0.8 + 0.2 * Math.sin(age * 8));
      aura.material.opacity = 0.32 * k; aura2.material.opacity = 0.16 * k;
      const q = upos(ctx, u);
      const mv = Math.hypot(q.x - lastX, q.y - lastY);
      emit -= dt;
      if (emit <= 0 && vis) {
        emit = low(ctx) ? 0.16 : 0.06;
        const back = Number.isFinite(u.facing) ? u.facing + Math.PI : 0;
        burst(ctx, { x: q.x, y: q.y, h: hh * 0.8, count: mv > 1 ? 3 : 1, color: GOLDEN, color2: VIOLET, speed: mv > 1 ? 380 : 60, dir: back, arc: 0.6, up: 0.1, radius: 40, size: 20, life: 0.35, drag: 2, vis: true });
      }
      lastX = q.x; lastY = q.y;
    },
  });
}

export default function register(fx) {
  const r = registrar(fx, 'masteryi');
  r.on('masteryi_double', double);
  r.on('masteryi_q_start', qStart);
  r.on('masteryi_q_strike', qStrike);
  r.on('masteryi_q_end', qEnd);
  r.on('masteryi_w_meditate', wMeditate);
  r.on('masteryi_e_wuju', eWuju);
  r.on('masteryi_r_takedown', rTakedown);
  r.on('masteryi_r_highlander', rHighlander);
}
