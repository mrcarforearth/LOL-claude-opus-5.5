// 莫甘娜专属特效：暗紫普攻与暗之禁锢法球、禁锢（缠绕的暗影锁环）、痛苦腐蚀（冒泡的暗影毒池）、
// 黑暗之盾（紫黑护罩）、灵魂镣铐（紫色锁链连接、断链碎裂、3 秒后的眩晕爆发）
import {
  NOOP, TAU, easeOut3, env, geo, mat, mesh, sprite, sphereGeo, planeGeo,
  place, flat, stick, upos, unitH, alive, shown, seen, launch, burst, decal, ring, shock, flash, pillar,
  projView, registrar, shake, starTex, runeTex, glowTex, ringTex, low, beamMesh, setBeam, zoneOf, gh,
} from './_kit.js';

const VIOLET = 0x9a4aff;
const VIOLET_HOT = 0xe0b8ff;
const SHADOW = 0x2a0a4a;
const TOXIC = 0x7aff6a;
const DARK = 0x1a0a2a;

// 暗影法球：深紫外壳 + 亮紫核心 + 暗影拖尾（普通混合的暗色烟雾）
function orb(ctx, p, { core = 60, tag, smoke = true }) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1;
  const root = new T.Group();
  const halo = sprite(ctx, VIOLET, core * 2.6 * size, 0.55);
  const dark = sprite(ctx, DARK, core * 1.8 * size, 0.7, glowTex(ctx), false);
  const c = sprite(ctx, VIOLET_HOT, core * size, 1);
  const wisps = [sprite(ctx, VIOLET, core * 0.5 * size, 0.9), sprite(ctx, VIOLET, core * 0.45 * size, 0.9)];
  root.add(dark, halo, c, ...wisps);
  let emit = 0;
  return projView(ctx, p, root, {
    tag, face: false,
    trail: { color: VIOLET, color2: SHADOW, width: core * 0.9 * size, seg: 22, max: 14, fade: 0.3 },
    update: (dt, proj, cur, age) => {
      for (let i = 0; i < wisps.length; i++) {
        const a = age * 12 + i * Math.PI;
        wisps[i].position.set(Math.cos(a) * core * 0.6 * size, Math.sin(a) * core * 0.6 * size, Math.sin(a * 0.7) * 20);
      }
      c.material.opacity = 0.8 + 0.2 * Math.sin(age * 30);
      if (!smoke) return;
      emit -= dt;
      if (emit <= 0 && cur.vis && !low(ctx)) {
        emit = 0.06;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 2, color: SHADOW, speed: 40, size: 60, life: 0.5, up: 0.2, additive: false, opacity: 0.5, vis: true });
      }
    },
  });
}
const aaOrb = (ctx, p) => orb(ctx, p, { core: 36, tag: 'morgana_aa', smoke: false });
const qOrb = (ctx, p) => orb(ctx, p, { core: 64, tag: 'morgana_q_orb', smoke: true });

// Q 禁锢：目标周身缠绕的暗影锁环 + 脚下紫黑法阵
function qBind(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 2;
  const root = new T.Group();
  const torus = geo(ctx, 'morgana_torus', (TT) => new TT.TorusGeometry(1, 0.07, 6, 36));
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const m = mesh(ctx, torus, mat(ctx, i === 1 ? VIOLET_HOT : VIOLET, 0.8));
    rings.push(m);
    root.add(m);
  }
  const H = unitH(ctx, u, 1);
  const R = Math.max(55, (u.radius || 60) * 1.1);
  const gone = () => !alive(u) || (u.hasCC && !u.hasCC('root'));
  decal(ctx, { follow: u, radius: R * 1.6, color: VIOLET, opacity: 0.7, duration: dur, spin: -1.5, map: runeTex(ctx), until: gone });
  decal(ctx, { follow: u, radius: R * 1.3, color: DARK, opacity: 0.6, duration: dur, additive: false, map: glowTex(ctx), until: gone });
  flash(ctx, { follow: u, h: H * 0.5, color: VIOLET_HOT, size: 260, duration: 0.3 });
  return launch(ctx, root, {
    duration: dur, tag: 'morgana_q_bind',
    update: (t, dt, age) => {
      if (age > 0.05 && gone()) {
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: H * 0.4, count: 12, color: VIOLET, color2: VIOLET_HOT, speed: 240, size: 20, life: 0.4 });
        return false;
      }
      stick(ctx, root, u, 0);
      const k = env(age, dur, 0.1, 0.25);
      for (let i = 0; i < rings.length; i++) {
        const m = rings[i];
        const hy = H * (0.2 + i * 0.28) + Math.sin(age * 3 + i) * 8;
        m.position.y = hy;
        const s = R * (1 - i * 0.12) * (age < 0.15 ? 1.8 - 0.8 * easeOut3(age / 0.15) : 1);
        m.scale.setScalar(s);
        m.rotation.set(Math.PI / 2 + Math.sin(age * 2 + i) * 0.25, 0, age * (i % 2 ? -2 : 2));
        m.material.opacity = 0.8 * k;
      }
      return undefined;
    },
  });
}

// W 痛苦腐蚀：暗紫毒池 + 缓慢旋转的符文 + 冒出的绿色/紫色气泡
function wZone(ctx, p) {
  const z = zoneOf(p);
  const T = ctx.THREE;
  const x = p.x ?? z?.x ?? 0, y = p.y ?? z?.y ?? 0, R = p.radius || z?.radius || 275;
  const dur = (p.duration || 5) + 0.3;
  const team = z?.team ?? null;
  const root = new T.Group();
  const pool = mesh(ctx, planeGeo(ctx), mat(ctx, DARK, 0, { map: glowTex(ctx), additive: false }));
  const glow = mesh(ctx, planeGeo(ctx), mat(ctx, VIOLET, 0, { map: glowTex(ctx) }));
  const rim = mesh(ctx, planeGeo(ctx), mat(ctx, TOXIC, 0, { map: ringTex(ctx) }));
  const rune = mesh(ctx, planeGeo(ctx), mat(ctx, VIOLET_HOT, 0, { map: runeTex(ctx) }));
  for (const m of [pool, glow, rim, rune]) { flat(m); m.scale.set(R * 2, R * 2, 1); }
  pool.position.y = 2; glow.position.y = 3; rim.position.y = 4; rune.position.y = 5;
  rune.scale.set(R * 1.5, R * 1.5, 1);
  root.add(pool, glow, rim, rune);
  place(ctx, root, x, y, 0);
  root.visible = seen(ctx, x, y, team);
  shock(ctx, { x, y, radius: R, color: VIOLET, duration: 0.4, team });
  let emit = 0, fade = 1;
  return launch(ctx, root, {
    duration: dur + 1, tag: 'morgana_w_zone',
    update: (t, dt, age) => {
      if ((z && z.dead) || age > dur) { fade -= dt * 3; if (fade <= 0) return false; }
      root.visible = seen(ctx, x, y, team);
      const k = Math.min(1, age / 0.25) * fade;
      pool.material.opacity = 0.55 * k;
      glow.material.opacity = 0.28 * k * (0.8 + 0.2 * Math.sin(age * 3));
      rim.material.opacity = 0.55 * k;
      rune.material.opacity = 0.35 * k;
      rune.rotation.z = age * 0.4;
      emit -= dt;
      if (emit <= 0 && root.visible && fade >= 1) {
        emit = low(ctx) ? 0.25 : 0.08;
        const a = Math.random() * TAU, r = R * Math.sqrt(Math.random()) * 0.9;
        const green = Math.random() < 0.45;
        burst(ctx, { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, h: 5, count: 2, color: green ? TOXIC : VIOLET, color2: VIOLET_HOT, speed: 20, size: 26, life: 0.9, up: 4, drag: 0.4, vis: true });
      }
      return undefined;
    },
  });
}

// E 黑暗之盾：紫黑色护罩 + 外层旋转的暗影符带，护盾破裂时爆散
function eShield(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 5;
  const id = p.shieldId || 'morgana_e';
  const root = new T.Group();
  const shell = mesh(ctx, sphereGeo(ctx, 20), mat(ctx, VIOLET, 0.16));
  const inner = mesh(ctx, sphereGeo(ctx, 20), mat(ctx, DARK, 0.25, { additive: false }));
  const band = mesh(ctx, geo(ctx, 'morgana_band', (TT) => new TT.TorusGeometry(1, 0.03, 4, 48)), mat(ctx, VIOLET_HOT, 0.8));
  const band2 = mesh(ctx, geo(ctx, 'morgana_band', (TT) => new TT.TorusGeometry(1, 0.03, 4, 48)), mat(ctx, VIOLET, 0.6));
  root.add(inner, shell, band, band2);
  const R = unitH(ctx, u, 0.55);
  flash(ctx, { follow: u, h: R, color: VIOLET_HOT, size: R * 3, duration: 0.3 });
  const has = () => Array.isArray(u.shields) && u.shields.some((s) => s.id === id && s.amount > 0);
  return launch(ctx, root, {
    duration: dur, tag: 'morgana_e_shield',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (age > 0.1 && !has()) {
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: R, count: 20, color: VIOLET, color2: VIOLET_HOT, speed: 380, size: 24, life: 0.5, up: 0.4 });
        return false;
      }
      stick(ctx, root, u, R * 0.95);
      const pop = age < 0.2 ? easeOut3(age / 0.2) : 1;
      const k = env(age, dur, 0.05, 0.3);
      shell.scale.setScalar(R * 1.08 * pop); inner.scale.setScalar(R * 1.0 * pop);
      band.scale.setScalar(R * 1.12 * pop); band2.scale.setScalar(R * 1.05 * pop);
      band.rotation.set(Math.PI / 2 + 0.4 * Math.sin(age * 2), age * 1.8, 0);
      band2.rotation.set(Math.PI / 2 - 0.5, -age * 2.4, 0.3);
      const fl = 0.85 + 0.15 * Math.sin(age * 9);
      shell.material.opacity = 0.18 * k * fl; inner.material.opacity = 0.22 * k;
      band.material.opacity = 0.8 * k * fl; band2.material.opacity = 0.55 * k;
      return undefined;
    },
  });
}

// R 灵魂镣铐：从莫甘娜延伸到每名被链接者的紫色锁链（链节光点沿链流动）+ 莫甘娜脚下暗影法阵
function rChains(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 3;
  const tethers = Array.isArray(p.tethers) ? p.tethers : (p.target ? [{ unit: p.target, broken: false }] : []);
  const R = p.radius || 625;
  const root = new T.Group();
  const links = tethers.map(() => {
    const b = beamMesh(ctx, VIOLET, 0.8);
    const c = beamMesh(ctx, VIOLET_HOT, 0.9);
    const beads = [];
    const nb = low(ctx) ? 3 : 6;
    for (let i = 0; i < nb; i++) { const s = sprite(ctx, VIOLET_HOT, 34, 0.9); beads.push(s); root.add(s); }
    root.add(b, c);
    return { b, c, beads };
  });
  const cast = upos(ctx, u);
  shock(ctx, { x: cast.x, y: cast.y, radius: R, color: VIOLET, duration: 0.5, team: u.team });
  decal(ctx, { follow: u, radius: 160, color: VIOLET, opacity: 0.65, duration: dur, spin: 1.5, map: runeTex(ctx), until: () => !u.modelState?.morganaChains });
  pillar(ctx, { follow: u, radius: 80, height: 380, color: VIOLET, opacity: 0.4, duration: 0.5 });
  for (const t of tethers) if (t.unit) flash(ctx, { follow: t.unit, h: unitH(ctx, t.unit, 0.5), color: VIOLET_HOT, size: 220, duration: 0.3 });
  return launch(ctx, root, {
    duration: dur + 0.2, tag: 'morgana_r_chains',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && !u.modelState?.morganaChains)) return false;
      const a = upos(ctx, u);
      const ah = (a.z || 0) + unitH(ctx, u, 0.6);
      const vis0 = shown(ctx, u);
      let any = false;
      for (let i = 0; i < tethers.length; i++) {
        const L = links[i], tt = tethers[i], v = tt.unit;
        const on = !tt.broken && alive(v);
        L.b.visible = L.c.visible = on && (vis0 || shown(ctx, v));
        for (const s of L.beads) s.visible = L.b.visible;
        if (!on) continue;
        any = true;
        const q = upos(ctx, v);
        const bh = (q.z || 0) + unitH(ctx, v, 0.5);
        // 链条收紧：越接近结束越亮、越细
        const tight = Math.min(1, age / dur);
        setBeam(ctx, L.b, a.x, a.y, ah, q.x, q.y, bh, 26 - 10 * tight);
        setBeam(ctx, L.c, a.x, a.y, ah, q.x, q.y, bh, 8);
        L.b.material.opacity = (0.55 + 0.3 * tight) * (0.85 + 0.15 * Math.sin(age * 14 + i));
        for (let j = 0; j < L.beads.length; j++) {
          const f = ((j / L.beads.length) + age * 0.8) % 1;
          const x = a.x + (q.x - a.x) * f, y = a.y + (q.y - a.y) * f;
          L.beads[j].position.set(x, gh(ctx, x, y) + ah + (bh - ah) * f, -y);
          L.beads[j].material.opacity = 0.9 * Math.sin(f * Math.PI);
        }
      }
      return any ? undefined : false;
    },
  });
}

// R 断链：紫色碎片
function rBreak(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const h = u ? unitH(ctx, u, 0.5) : 100;
  flash(ctx, { x: q.x, y: q.y, h, color: VIOLET, size: 180, duration: 0.3 });
  burst(ctx, { x: q.x, y: q.y, h, count: 16, color: VIOLET, color2: VIOLET_HOT, speed: 320, size: 18, life: 0.45, up: 0.5, map: starTex(ctx) });
  return NOOP;
}

// R 爆发：暗影冲击 + 紫色光柱 + 镜头震动
function rBurst(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const h = u ? unitH(ctx, u, 0.5) : 100;
  flash(ctx, { x: q.x, y: q.y, h, color: VIOLET_HOT, size: 380, duration: 0.3 });
  flash(ctx, { x: q.x, y: q.y, h, color: VIOLET, size: 520, duration: 0.5, grow: [0.3, 1.3] });
  shock(ctx, { x: q.x, y: q.y, radius: 220, color: VIOLET, duration: 0.5 });
  ring(ctx, { x: q.x, y: q.y, radius: 160, color: DARK, duration: 0.8, additive: false, opacity: 0.7 });
  pillar(ctx, { x: q.x, y: q.y, radius: 70, height: 460, color: VIOLET, opacity: 0.6, duration: 0.5 });
  burst(ctx, { x: q.x, y: q.y, h, count: 30, color: VIOLET, color2: VIOLET_HOT, speed: 560, size: 26, life: 0.55, up: 0.5, drag: 2.5 });
  burst(ctx, { x: q.x, y: q.y, h: 40, count: 12, color: SHADOW, speed: 200, size: 90, life: 0.8, up: 0.3, additive: false, opacity: 0.55 });
  shake(ctx, q.x, q.y, 10, 0.2);

  return NOOP;
}

export default function register(fx) {
  const r = registrar(fx, 'morgana');
  r.proj('morgana_aa', aaOrb);
  r.proj('morgana_q_orb', qOrb);
  r.on('morgana_q_bind', qBind);
  r.on('morgana_w_zone', wZone);
  r.on('morgana_e_shield', eShield);
  r.on('morgana_r_chains', rChains);
  r.on('morgana_r_break', rBreak);
  r.on('morgana_r_burst', rBurst);
}
