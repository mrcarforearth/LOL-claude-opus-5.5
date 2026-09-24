// 拉克丝专属特效：光之束缚（光球 + 双重光环禁锢）、曲光屏障（棱光法杖 + 虹彩护盾）、透光奇点（金色光球区域 + 爆裂）、
// 终极闪光（蓄力瞄准线 + 巨型激光）、光芒四射（光芒印记与引爆）
import {
  NOOP, TAU, env, easeOut3, geo, mat, mesh, sprite, sphereGeo, place, flat, stick, upos, unitH, alive, shown, seen, gh,
  launch, burst, decal, ring, shock, flash, pillar, beamMesh, setBeam, projView, registrar, converge, shake,
  starTex, runeTex, ringTex, glowTex, planeGeo, low, zoneOf,
} from './_kit.js';

const LIGHT = 0xbfe4ff;
const GOLD = 0xfff0a0;
const WARM = 0xffd66a;
const PINK = 0xffc6ec;
const WHITE = 0xfffbe8;
const PRISM = [0xff9ad8, 0xffe08a, 0x9affd0, 0x9ad8ff, 0xc8a8ff];

const torusGeo = (ctx) => geo(ctx, 'lux_torus', (T) => new T.TorusGeometry(1, 0.045, 5, 48));

// —— Q：光之束缚光球 ——
function qOrb(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.1;
  const root = new T.Group();
  const halo = sprite(ctx, LIGHT, 200 * size, 0.55);
  const core = sprite(ctx, WHITE, 80 * size, 1);
  const star = sprite(ctx, 0xe8f6ff, 150 * size, 0.85, starTex(ctx));
  const r1 = mesh(ctx, torusGeo(ctx), mat(ctx, LIGHT, 0.85));
  const r2 = mesh(ctx, torusGeo(ctx), mat(ctx, GOLD, 0.6));
  r1.scale.setScalar(46 * size); r2.scale.setScalar(36 * size);
  root.add(halo, star, core, r1, r2);
  let emit = 0;
  return projView(ctx, p, root, {
    tag: 'lux_q_orb',
    trail: { color: WHITE, color2: LIGHT, width: 60 * size, seg: 22, max: 18, fade: 0.3 },
    update: (dt, proj, cur, age) => {
      r1.rotation.set(age * 7, 0, Math.PI / 2);
      r2.rotation.set(0, age * 9, Math.PI / 2 + 0.6);
      star.material.rotation = -age * 3;
      core.scale.setScalar(80 * size * (1 + 0.12 * Math.sin(age * 40)));
      emit -= dt;
      if (emit <= 0 && cur.vis && !low(ctx)) {
        emit = 0.05;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 3, color: LIGHT, color2: WHITE, speed: 80, size: 20, life: 0.4, up: 0.3, map: starTex(ctx), vis: true });
      }
    },
  });
}

// Q 命中：目标被三道金白光环上下箍住，脚下法阵
function qBind(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = Math.max(0.3, p.duration || 2);
  const H = unitH(ctx, u, 1);
  const R = Math.max(55, (u.radius || 60) * 1.05);
  flash(ctx, { follow: u, h: H * 0.5, color: WHITE, size: 340, duration: 0.35, map: starTex(ctx), grow: [0.4, 1.5] });
  burst(ctx, { x: u.x, y: u.y, h: H * 0.5, count: 20, color: LIGHT, color2: GOLD, speed: 360, size: 24, life: 0.5, team: u.team });
  decal(ctx, { follow: u, radius: R * 1.8, color: LIGHT, opacity: 0.7, duration: dur, spin: -0.8, map: runeTex(ctx) });
  const root = new T.Group();
  const bands = [];
  for (let i = 0; i < 3; i++) {
    const b = mesh(ctx, torusGeo(ctx), mat(ctx, i === 1 ? GOLD : LIGHT, 0));
    b.rotation.x = Math.PI / 2;
    root.add(b);
    bands.push(b);
  }
  const glow = mesh(ctx, geo(ctx, 'lux_bind_col', (TT) => { const g = new TT.CylinderGeometry(1, 1, 1, 24, 1, true); g.translate(0, 0.5, 0); return g; }), mat(ctx, LIGHT, 0));
  root.add(glow);
  return launch(ctx, root, {
    duration: dur, tag: 'lux_q_bind',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      stick(ctx, root, u, 0);
      const k = env(age, dur, 0.12, 0.3);
      const squeeze = 1 + 0.6 * Math.max(0, 1 - age / 0.25);
      for (let i = 0; i < 3; i++) {
        const b = bands[i];
        b.position.y = H * (0.2 + i * 0.28) + Math.sin(age * 3 + i) * 6;
        b.scale.setScalar(R * squeeze * (1 - i * 0.08));
        b.rotation.z = age * (i % 2 ? -2 : 2);
        b.material.opacity = k * (0.75 + 0.25 * Math.sin(age * 12 + i * 2));
      }
      glow.scale.set(R * 0.95, H * 1.05, R * 0.95);
      glow.material.opacity = 0.12 * k;
    },
  });
}

// —— 被动：光芒印记（胸前旋转的光芒星） ——
function mark(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const b = p.buff;
  const H = unitH(ctx, u, 0.55);
  const root = new T.Group();
  const star = sprite(ctx, WARM, 90, 0, starTex(ctx));
  const star2 = sprite(ctx, WHITE, 60, 0, starTex(ctx));
  const halo = sprite(ctx, GOLD, 120, 0);
  root.add(halo, star, star2);
  const dur = 6.5;
  return launch(ctx, root, {
    duration: dur, tag: 'lux_mark',
    update: (t, dt, age) => {
      if (!alive(u) || (b && b.removed)) return false;
      stick(ctx, root, u, H);
      const k = Math.min(1, age / 0.15) * (0.75 + 0.25 * Math.sin(age * 6));
      star.material.opacity = 0.9 * k; star2.material.opacity = 0.8 * k; halo.material.opacity = 0.35 * k;
      star.material.rotation = age * 1.5; star2.material.rotation = -age * 2.2 + 0.4;
      root.position.y += Math.sin(age * 3) * 8;
    },
  });
}
function markPop(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : { x: p.x, y: p.y };
  const h = u ? unitH(ctx, u, 0.55) : 100;
  flash(ctx, { x: q.x, y: q.y, h, color: WARM, size: 300, duration: 0.3, map: starTex(ctx), grow: [0.5, 1.6] });
  flash(ctx, { x: q.x, y: q.y, h, color: WHITE, size: 180, duration: 0.25 });
  burst(ctx, { x: q.x, y: q.y, h, count: 16, color: GOLD, color2: WHITE, speed: 380, size: 24, life: 0.4, map: starTex(ctx) });
  ring(ctx, { x: q.x, y: q.y, radius: 120, color: GOLD, duration: 0.35 });
  return NOOP;
}

// —— W：曲光屏障法杖（棱光飞杖，往返） ——
function wWand(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1;
  const root = new T.Group();
  const spin = new T.Group();
  const rod = mesh(ctx, geo(ctx, 'lux_rod', (TT) => new TT.CylinderGeometry(4, 4, 110, 6)), mat(ctx, 0xfff4fb, 0.9));
  rod.rotation.z = Math.PI / 2;
  const gem = mesh(ctx, geo(ctx, 'lux_gem', (TT) => new TT.OctahedronGeometry(1, 0)), mat(ctx, PINK, 0.95));
  gem.scale.set(18, 26, 18);
  gem.position.x = 60;
  const gemGlow = sprite(ctx, PINK, 120 * size, 0.8);
  gemGlow.position.x = 60;
  spin.add(rod, gem, gemGlow);
  const halo = sprite(ctx, 0xffe6f6, 220 * size, 0.35);
  root.add(halo, spin);
  const wc = new T.Color(0xffffff);
  let emit = 0;
  return projView(ctx, p, root, {
    tag: 'lux_w_wand',
    trail: { color: PINK, color2: 0x9ad8ff, width: 70 * size, seg: 22, max: 18, fade: 0.35 },
    update: (dt, proj, cur, age) => {
      spin.rotation.y = age * 18;
      const hue = PRISM[Math.floor(age * 10) % PRISM.length];
      gemGlow.material.color.setHex(hue);
      halo.material.color.setHex(hue).lerp(wc, 0.6);
      emit -= dt;
      if (emit <= 0 && cur.vis && !low(ctx)) {
        emit = 0.05;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 3, color: hue, color2: WHITE, speed: 90, size: 22, life: 0.45, up: 0.2, map: starTex(ctx), vis: true });
      }
    },
  });
}

// W：虹彩护盾（半透明泡泡 + 棱光环带，护盾消失即结束）
function wShield(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 2.5;
  const id = p.shieldId;
  const H = unitH(ctx, u, 1);
  const R = Math.max(70, H * 0.5);
  const root = new T.Group();
  const shell = mesh(ctx, sphereGeo(ctx, 24), mat(ctx, PINK, 0));
  const inner = mesh(ctx, sphereGeo(ctx, 24), mat(ctx, 0x9ad8ff, 0));
  const band = mesh(ctx, torusGeo(ctx), mat(ctx, WHITE, 0));
  const band2 = mesh(ctx, torusGeo(ctx), mat(ctx, PINK, 0));
  root.add(shell, inner, band, band2);
  shell.scale.setScalar(R); inner.scale.setScalar(R * 0.92);
  band.scale.setScalar(R * 1.02); band2.scale.setScalar(R * 0.96);
  flash(ctx, { follow: u, h: H * 0.5, color: p.second ? 0xffe0f4 : PINK, size: R * 3.2, duration: 0.3 });
  const has = () => !id || !Array.isArray(u.shields) || u.shields.some((s) => s.id === id && !(s.amount <= 0));
  let end = -1;
  // 同一单位同一护盾 id 只保留最新的护盾特效
  let byId = SHIELDS.get(u);
  if (!byId) { byId = new Map(); SHIELDS.set(u, byId); }
  const key = id || 'lux_w';
  try { byId.get(key)?.remove?.(); } catch { /* 忽略 */ }
  const h = launch(ctx, root, {
    duration: dur + 0.4, tag: 'lux_w_shield',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (end < 0 && (age > dur || (age > 0.1 && !has()))) {
        end = age;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: H * 0.5, count: 14, color: PINK, color2: 0x9ad8ff, speed: 260, size: 24, life: 0.4, map: starTex(ctx), team: u.team });
      }
      const fade = end < 0 ? Math.min(1, age / 0.15) : 1 - (age - end) / 0.25;
      if (fade <= 0) return false;
      stick(ctx, root, u, H * 0.5);
      const hue = PRISM[Math.floor(age * 4) % PRISM.length];
      shell.material.color.setHex(hue);
      shell.material.opacity = 0.16 * fade;
      inner.material.opacity = 0.08 * fade;
      band.rotation.set(Math.PI / 2 + Math.sin(age * 2) * 0.5, age * 1.5, 0);
      band2.rotation.set(Math.PI / 2 - Math.sin(age * 2.4) * 0.5, -age * 2, 0);
      band.material.opacity = 0.75 * fade; band2.material.opacity = 0.55 * fade;
      shell.rotation.y = age;
      return undefined;
    },
    onEnd: () => { if (byId.get(key) === h) byId.delete(key); },
  });
  byId.set(key, h);
  return h;
}
const SHIELDS = new WeakMap();

// —— E：透光奇点（抛物线金色光球） ——
function eOrb(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.1;
  const root = new T.Group();
  const halo = sprite(ctx, GOLD, 200 * size, 0.5);
  const core = sprite(ctx, WHITE, 90 * size, 1);
  const star = sprite(ctx, WARM, 160 * size, 0.7, starTex(ctx));
  const r1 = mesh(ctx, torusGeo(ctx), mat(ctx, WARM, 0.8));
  r1.scale.setScalar(50 * size);
  root.add(halo, star, core, r1);
  return projView(ctx, p, root, {
    tag: 'lux_e_orb', face: false,
    trail: { color: GOLD, color2: 0xffa040, width: 56 * size, seg: 20, max: 16, fade: 0.3 },
    update: (dt, proj, cur, age) => {
      r1.rotation.set(Math.PI / 2 + Math.sin(age * 4) * 0.7, age * 6, 0);
      star.material.rotation = age * 2;
    },
  });
}

// E 区域：地面光阵 + 悬浮光球（区域结束即淡出，由 lux_e_burst 引爆）
function eZone(ctx, p) {
  const z = zoneOf(p);
  const T = ctx.THREE;
  const x = p.x ?? z?.x ?? 0, y = p.y ?? z?.y ?? 0, R = p.radius || z?.radius || 310;
  const dur = (p.duration || 5) + 0.5;
  const team = z?.team ?? z?.owner?.team ?? null;
  const vis = seen(ctx, x, y, team);
  const root = new T.Group();
  const disc = mesh(ctx, planeGeo(ctx), mat(ctx, GOLD, 0, { map: glowTex(ctx) }));
  const rim = mesh(ctx, planeGeo(ctx), mat(ctx, WARM, 0, { map: ringTex(ctx) }));
  const rune = mesh(ctx, planeGeo(ctx), mat(ctx, WHITE, 0, { map: runeTex(ctx) }));
  for (const m of [disc, rim, rune]) { flat(m); m.scale.set(R * 2, R * 2, 1); }
  disc.position.y = 3; rim.position.y = 4; rune.position.y = 5;
  rune.scale.set(R * 1.6, R * 1.6, 1);
  const orb = new T.Group();
  const oHalo = sprite(ctx, GOLD, 220, 0.5);
  const oCore = sprite(ctx, WHITE, 90, 0.95);
  const oStar = sprite(ctx, WARM, 170, 0.7, starTex(ctx));
  orb.add(oHalo, oStar, oCore);
  root.add(disc, rim, rune, orb);
  place(ctx, root, x, y, 0);
  root.visible = vis;
  shock(ctx, { x, y, radius: R, color: GOLD, duration: 0.45, team });
  let emit = 0;
  return launch(ctx, root, {
    duration: dur, tag: 'lux_e_zone',
    update: (t, dt, age) => {
      if (z && z.dead) return false;
      root.visible = seen(ctx, x, y, team);
      const k = Math.min(1, age / 0.2);
      disc.material.opacity = 0.32 * k * (0.85 + 0.15 * Math.sin(age * 4));
      rim.material.opacity = 0.8 * k;
      rune.material.opacity = 0.45 * k;
      rune.rotation.z = age * 0.6;
      orb.position.y = 90 + Math.sin(age * 2.5) * 16;
      oStar.material.rotation = age * 1.2;
      oCore.scale.setScalar(90 * (1 + 0.1 * Math.sin(age * 9)));
      emit -= dt;
      if (emit <= 0 && root.visible) {
        emit = low(ctx) ? 0.3 : 0.12;
        const a = Math.random() * TAU, r = R * Math.sqrt(Math.random()) * 0.9;
        burst(ctx, { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, h: 10, count: 3, color: GOLD, color2: WHITE, speed: 40, size: 22, life: 0.9, up: 3, drag: 0.5, map: starTex(ctx), vis: true });
      }
      return undefined;
    },
  });
}
function eBurst(ctx, p) {
  const x = p.x, y = p.y, R = p.radius || 310;
  flash(ctx, { x, y, h: 90, color: WHITE, size: R * 2.4, duration: 0.35 });
  flash(ctx, { x, y, h: 90, color: WARM, size: R * 2, duration: 0.45, map: starTex(ctx), grow: [0.4, 1.4] });
  shock(ctx, { x, y, radius: R, color: GOLD, duration: 0.5 });
  ring(ctx, { x, y, radius: R * 1.15, color: WHITE, duration: 0.4, grow: [0.6, 1] });
  pillar(ctx, { x, y, radius: 80, height: 520, color: GOLD, opacity: 0.6, duration: 0.4 });
  burst(ctx, { x, y, h: 60, count: 36, color: GOLD, color2: WHITE, speed: 620, size: 28, life: 0.55, up: 0.35, radius: R * 0.4 });
  burst(ctx, { x, y, h: 20, count: 14, color: WARM, speed: 200, size: 30, life: 0.9, up: 2.2, radius: R * 0.8, map: starTex(ctx) });
  shake(ctx, x, y, 8, 0.2);
  return NOOP;
}

// —— R：终极闪光 蓄力（细瞄准线 + 手中聚光） ——
function rCharge(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 1;
  const dx = p.dirX ?? Math.cos(u.facing || 0), dy = p.dirY ?? Math.sin(u.facing || 0);
  const x1 = p.x1 ?? u.x, y1 = p.y1 ?? u.y, x2 = p.x2 ?? x1 + dx * 3400, y2 = p.y2 ?? y1 + dy * 3400;
  const root = new T.Group();
  const line = beamMesh(ctx, WARM, 0);
  const line2 = beamMesh(ctx, WHITE, 0);
  root.add(line, line2);
  const orb = new T.Group();
  const oHalo = sprite(ctx, GOLD, 100, 0.6);
  const oCore = sprite(ctx, WHITE, 40, 1);
  const oStar = sprite(ctx, WARM, 120, 0.8, starTex(ctx));
  orb.add(oHalo, oStar, oCore);
  root.add(orb);
  const H = unitH(ctx, u, 0.55);
  converge(ctx, { follow: u, h: H, fwd: { x: dx * 70, y: dy * 70 }, radius: 260, count: 26, color: GOLD, color2: WHITE, size: 26, duration: dur, spin: 3 });
  decal(ctx, { follow: u, radius: 150, color: GOLD, opacity: 0.7, duration: dur, spin: 2.5, map: runeTex(ctx), grow: [0.5, 1] });
  return launch(ctx, root, {
    duration: dur + 0.05, tag: 'lux_r_charge',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      const vis = shown(ctx, u);
      root.visible = vis;
      const q = upos(ctx, u);
      const ox = q.x + dx * 70, oy = q.y + dy * 70;
      const k = Math.min(1, age / dur);
      setBeam(ctx, line, ox, oy, H, x2 + (q.x - x1), y2 + (q.y - y1), H, 18 + 10 * k);
      setBeam(ctx, line2, ox, oy, H, x2 + (q.x - x1), y2 + (q.y - y1), H, 5);
      line.material.opacity = 0.35 + 0.35 * k * (0.7 + 0.3 * Math.sin(age * 40));
      line2.material.opacity = 0.6 + 0.4 * k;
      orb.position.set(ox, gh(ctx, ox, oy) + (q.z || 0) + H, -oy);
      const s = 0.5 + 1.3 * easeOut3(k);
      oHalo.scale.setScalar(160 * s); oCore.scale.setScalar(70 * s); oStar.scale.setScalar(200 * s);
      oStar.material.rotation = age * 5;
    },
  });
}

// R：巨型激光（多层光束 + 地面灼光带 + 沿线星光）
function rBeam(ctx, p) {
  const T = ctx.THREE;
  const u = p.unit;
  const x1 = p.x1, y1 = p.y1, x2 = p.x2, y2 = p.y2;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return NOOP;
  const W = p.width || 100;
  const dur = p.duration || 0.9;
  const H = u ? unitH(ctx, u, 0.55) : 100;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
  const root = new T.Group();
  const outer = beamMesh(ctx, 0xffd070, 0);
  const mid = beamMesh(ctx, 0xfff2b0, 0);
  const core = beamMesh(ctx, 0xffffff, 0);
  const rim = beamMesh(ctx, 0xff9ad8, 0);
  root.add(outer, rim, mid, core);
  const ground = mesh(ctx, planeGeo(ctx), mat(ctx, WARM, 0, { map: glowTex(ctx) }));
  flat(ground, Math.atan2(dy, dx));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  place(ctx, ground, mx, my, 6);
  ground.scale.set(len * 1.05, W * 2.4, 1);
  root.add(ground);
  const muzzle = sprite(ctx, WHITE, W * 5, 0);
  const muzzleStar = sprite(ctx, WARM, W * 7, 0, starTex(ctx));
  place(ctx, muzzle, x1 + dx * 70, y1 + dy * 70, H);
  muzzleStar.position.copy(muzzle.position);
  root.add(muzzle, muzzleStar);
  const team = u?.team ?? null;
  // 起点爆闪 + 沿线星光
  flash(ctx, { x: x1 + dx * 70, y: y1 + dy * 70, h: H, color: WHITE, size: W * 8, duration: 0.4, team });
  shake(ctx, x1, y1, 14, 0.35);
  const segs = low(ctx) ? 4 : 9;
  for (let i = 1; i <= segs; i++) {
    const k = i / (segs + 1);
    const sx = x1 + (x2 - x1) * k, sy = y1 + (y2 - y1) * k;
    burst(ctx, { x: sx, y: sy, h: H * 0.8, count: 8, color: GOLD, color2: WHITE, speed: 260, size: 30, life: 0.6, up: 0.6, radius: W * 0.6, map: starTex(ctx), team });
  }
  flash(ctx, { x: x2, y: y2, h: H, color: WARM, size: W * 5, duration: 0.5, team });
  return launch(ctx, root, {
    duration: dur, tag: 'lux_r_beam',
    update: (t, dt, age) => {
      // 前 0.1 秒极速展开，随后缓慢收窄淡出
      const open = Math.min(1, age / 0.08);
      const k = open * (1 - Math.pow(Math.max(0, (age - 0.15) / (dur - 0.15)), 1.5));
      if (k <= 0 && age > 0.2) return false;
      const flick = 1 + 0.08 * Math.sin(age * 70);
      const sx = x1 + dx * 70, sy = y1 + dy * 70;
      // 叠加层控制在约 2.4 倍宽度内，避免整屏过曝
      setBeam(ctx, outer, sx, sy, H, x2, y2, H, W * 2.4 * k * flick);
      setBeam(ctx, rim, sx, sy, H, x2, y2, H, W * 1.8 * k);
      setBeam(ctx, mid, sx, sy, H, x2, y2, H, W * 1.1 * k * flick);
      setBeam(ctx, core, sx, sy, H, x2, y2, H, W * 0.5 * k);
      outer.material.opacity = 0.28 * k; rim.material.opacity = 0.22 * k; mid.material.opacity = 0.55 * k; core.material.opacity = 0.9 * k;
      ground.material.opacity = 0.32 * k;
      muzzle.material.opacity = k; muzzle.scale.setScalar(W * 4 * (0.8 + 0.4 * flick) * Math.max(0.3, k));
      muzzleStar.material.opacity = 0.8 * k; muzzleStar.material.rotation = age * 3; muzzleStar.scale.setScalar(W * 6 * Math.max(0.3, k));
      return undefined;
    },
  });
}

export default function register(fx) {
  const r = registrar(fx, 'lux');
  r.proj('lux_q_orb', qOrb);
  r.on('lux_q_bind', qBind);
  r.on('lux_mark', mark);
  r.on('lux_mark_pop', markPop);
  r.proj('lux_w_wand', wWand);
  r.on('lux_w_shield', wShield);
  r.proj('lux_e_orb', eOrb);
  r.on('lux_e_zone', eZone);
  r.on('lux_e_burst', eBurst);
  r.on('lux_r_charge', rCharge);
  r.on('lux_r_beam', rBeam);
}
