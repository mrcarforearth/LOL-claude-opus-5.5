// 伊泽瑞尔专属特效：金色奥术普攻与秘术射击、橙紫精华跃动法球与标记、奥术跃迁（残影 + 蓝色闪光 + 追踪弹）、
// 咒能高涨满层护手光辉、精准弹幕（蓄力汇聚 + 巨型金色新月弹幕）
import {
  NOOP, TAU, easeOut3, env, geo, mat, mesh, sprite, sectorGeo, sphereGeo, planeGeo,
  place, stick, upos, unitH, alive, shown, launch, burst, decal, ring, shock, flash, pillar,
  ghost, projView, registrar, starTex, runeTex, streakTex, low, yawOf, converge, beamMesh, setBeam,
} from './_kit.js';

const GOLD = 0xffd65a;
const GOLD_HOT = 0xfff4c0;
const ARCANE = 0x6fd8ff;
const ARCANE_HOT = 0xd8f6ff;
const ESSENCE = 0xffa030;
const VIOLET = 0xb070ff;

// 细长光条（沿 +X，头部在 0）
const streakGeo = (ctx) => geo(ctx, 'ez_streak', (T) => { const g = new T.PlaneGeometry(1, 1); g.translate(-0.5, 0, 0); return g; });

// 通用奥术弹：核心 + 光晕 + 水平/竖直两片光条 + 拖尾
function bolt(ctx, p, { color, hot, core = 50, len = 160, width = 36, trailW = 40, tag, sparks = 0 }) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1;
  const root = new T.Group();
  const c = sprite(ctx, hot, core * size, 1);
  const halo = sprite(ctx, color, core * 2.4 * size, 0.55);
  const sTex = streakTex(ctx);
  const s1 = mesh(ctx, streakGeo(ctx), mat(ctx, color, 0.9, { map: sTex }));
  const s2 = mesh(ctx, streakGeo(ctx), mat(ctx, color, 0.9, { map: sTex }));
  s1.rotation.x = -Math.PI / 2;
  s1.scale.set(len * size, width * size, 1);
  s2.scale.set(len * size, width * size * 0.7, 1);
  root.add(halo, s1, s2, c);
  let emit = 0;
  return projView(ctx, p, root, {
    tag,
    trail: { color, color2: hot, width: trailW * size, seg: 22, max: 14, fade: 0.22 },
    update: (dt, proj, cur, age) => {
      c.material.opacity = 0.8 + 0.2 * Math.sin(age * 45);
      if (!sparks) return;
      emit -= dt;
      if (emit <= 0 && cur.vis && !low(ctx)) {
        emit = 0.05;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - (ctx.heightAt?.(cur.x, cur.y) || 0), count: sparks, color, color2: hot, speed: 120, size: 16, life: 0.35, up: 0.3, vis: true, map: starTex(ctx) });
      }
    },
  });
}

const aaBolt = (ctx, p) => bolt(ctx, p, { color: GOLD, hot: GOLD_HOT, core: 36, len: 110, width: 26, trailW: 26, tag: 'ezreal_aa' });
const qBolt = (ctx, p) => bolt(ctx, p, { color: GOLD, hot: GOLD_HOT, core: 70, len: 260, width: 50, trailW: 70, tag: 'ezreal_q_bolt', sparks: 3 });
const eBolt = (ctx, p) => bolt(ctx, p, { color: ARCANE, hot: ARCANE_HOT, core: 55, len: 180, width: 40, trailW: 50, tag: 'ezreal_e_bolt', sparks: 2 });

// Q 命中：金色星芒爆裂
function qHit(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const h = u ? unitH(ctx, u, 0.5) : 100;
  flash(ctx, { x: q.x, y: q.y, h, color: GOLD_HOT, size: 240, duration: 0.25 });
  flash(ctx, { x: q.x, y: q.y, h, color: GOLD, size: 200, duration: 0.35, map: starTex(ctx), grow: [0.5, 1.5] });
  burst(ctx, { x: q.x, y: q.y, h, count: 16, color: GOLD, color2: ARCANE, speed: 420, size: 20, life: 0.4, up: 0.4, drag: 3 });
  return NOOP;
}

// W 法球：旋转的橙色精华核心 + 紫色环绕光点
function wOrb(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.2;
  const root = new T.Group();
  const core = sprite(ctx, 0xffe0a0, 60 * size, 1);
  const halo = sprite(ctx, ESSENCE, 150 * size, 0.6);
  const shell = mesh(ctx, sphereGeo(ctx, 14), mat(ctx, ESSENCE, 0.35));
  shell.scale.setScalar(34 * size);
  const motes = [];
  for (let i = 0; i < 3; i++) { const m = sprite(ctx, VIOLET, 34 * size, 0.9); motes.push(m); root.add(m); }
  root.add(halo, shell, core);
  return projView(ctx, p, root, {
    tag: 'ezreal_w_orb', face: false,
    trail: { color: ESSENCE, color2: VIOLET, width: 60 * size, seg: 22, max: 16, fade: 0.3 },
    update: (dt, proj, cur, age) => {
      for (let i = 0; i < motes.length; i++) {
        const a = age * 9 + (i / motes.length) * TAU;
        motes[i].position.set(Math.cos(a) * 45 * size, Math.sin(a * 1.3) * 20, Math.sin(a) * 45 * size);
      }
      halo.material.opacity = 0.5 + 0.15 * Math.sin(age * 20);
    },
  });
}

// W 标记：目标头顶旋转的精华法球 + 脚下橙色符文，直到标记被引爆/到期
function wMark(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 4;
  const root = new T.Group();
  const core = sprite(ctx, 0xffe0a0, 50, 0.95);
  const halo = sprite(ctx, ESSENCE, 130, 0.5);
  const orbit = [sprite(ctx, VIOLET, 28, 0.9), sprite(ctx, ESSENCE, 24, 0.9)];
  root.add(halo, core, ...orbit);
  const gone = () => !alive(u) || (u.hasBuff && !u.hasBuff('ezreal_w_mark'));
  decal(ctx, { follow: u, radius: Math.max(70, (u.radius || 60) * 1.3), color: ESSENCE, opacity: 0.55, duration: dur, spin: 2, map: runeTex(ctx), until: gone });
  return launch(ctx, root, {
    duration: dur, tag: 'ezreal_w_mark',
    update: (t, dt, age) => {
      if (age > 0.05 && gone()) return false;
      stick(ctx, root, u, unitH(ctx, u, 1.05) + 10 * Math.sin(age * 4));
      for (let i = 0; i < orbit.length; i++) {
        const a = age * 6 + i * Math.PI;
        orbit[i].position.set(Math.cos(a) * 40, Math.sin(a * 2) * 8, Math.sin(a) * 40);
      }
      const k = env(age, dur, 0.12, 0.3);
      core.material.opacity = 0.95 * k; halo.material.opacity = (0.4 + 0.15 * Math.sin(age * 10)) * k;
      return undefined;
    },
  });
}

// W 引爆：橙紫能量炸裂
function wPop(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const h = u ? unitH(ctx, u, 0.6) : 120;
  flash(ctx, { x: q.x, y: q.y, h, color: 0xffe0a0, size: 360, duration: 0.3 });
  flash(ctx, { x: q.x, y: q.y, h, color: VIOLET, size: 300, duration: 0.45, grow: [0.3, 1.4] });
  shock(ctx, { x: q.x, y: q.y, radius: 170, color: ESSENCE, duration: 0.4 });
  burst(ctx, { x: q.x, y: q.y, h, count: 28, color: ESSENCE, color2: VIOLET, speed: 520, size: 24, life: 0.5, up: 0.5, drag: 2.5 });
  return NOOP;
}

// E 奥术跃迁：原地残影与蓝色爆闪，落点蓝色光环，两点之间的奥术粒子
function eBlink(ctx, p) {
  const u = p.unit;
  const x1 = p.x1 ?? u?.x ?? 0, y1 = p.y1 ?? u?.y ?? 0, x2 = p.x2 ?? x1, y2 = p.y2 ?? y1;
  const team = u?.team;
  if (u) ghost(ctx, u, { x: x1, y: y1, color: ARCANE, opacity: 0.55, duration: 0.45, drift: 30 });
  flash(ctx, { x: x1, y: y1, h: 100, color: ARCANE_HOT, size: 300, duration: 0.3, team });
  flash(ctx, { x: x2, y: y2, h: 100, color: ARCANE, size: 360, duration: 0.35, map: starTex(ctx), team });
  ring(ctx, { x: x2, y: y2, radius: 150, color: ARCANE, duration: 0.45, team });
  decal(ctx, { x: x2, y: y2, radius: 110, color: GOLD, opacity: 0.7, duration: 0.6, spin: 3, map: runeTex(ctx), grow: [0.4, 1], team });
  burst(ctx, { x: x1, y: y1, h: 90, count: 18, color: ARCANE, color2: ARCANE_HOT, speed: 260, size: 22, life: 0.45, up: 0.4, team });
  burst(ctx, { x: x2, y: y2, h: 90, count: 18, color: ARCANE, color2: GOLD, speed: 300, size: 22, life: 0.45, up: 0.4, team });
  // 连接两点的淡蓝光束
  const T = ctx.THREE;
  const b = beamMesh(ctx, ARCANE, 0.6);
  const holder = new T.Group();
  holder.add(b);
  setBeam(ctx, b, x1, y1, 100, x2, y2, 100, 30);
  return launch(ctx, holder, {
    duration: 0.25, tag: 'ezreal_e_beam',
    update: (t) => { b.material.opacity = 0.6 * (1 - t); },
  });
}

// 被动满层：护手金光与上升的金色符文
function passiveMax(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 6;
  const root = new T.Group();
  const glow = sprite(ctx, GOLD, 90, 0.7);
  root.add(glow);
  const gone = () => !alive(u) || (u.buffStacks && u.buffStacks('ezreal_rising') < 5);
  flash(ctx, { follow: u, h: unitH(ctx, u, 0.55), color: GOLD_HOT, size: 260, duration: 0.3 });
  let emit = 0;
  return launch(ctx, root, {
    duration: dur, tag: 'ezreal_passive_max',
    update: (t, dt, age) => {
      if (age > 0.05 && gone()) return false;
      const vis = stick(ctx, root, u, 0);
      // 护手在右前方
      const f = u.facing || 0;
      glow.position.set(Math.cos(f - 0.6) * 45, unitH(ctx, u, 0.5), -Math.sin(f - 0.6) * 45);
      glow.material.opacity = 0.55 + 0.25 * Math.sin(age * 12);
      emit -= dt;
      if (emit <= 0 && vis && !low(ctx)) {
        emit = 0.15;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: 40, count: 2, color: GOLD, color2: ARCANE, speed: 30, up: 4, radius: 45, size: 18, life: 0.7, drag: 0.5, map: starTex(ctx), vis: true });
      }
      return undefined;
    },
  });
}

// R 蓄力：金色能量向护手汇聚 + 前方地面细线预警
function rCharge(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const dur = p.duration || 1;
  const dirX = p.dirX ?? 1, dirY = p.dirY ?? 0;
  converge(ctx, { follow: u, h: unitH(ctx, u, 0.55), radius: 260, color: GOLD, color2: ARCANE, count: 26, size: 26, duration: dur, spin: 2, fwd: { x: dirX * 50, y: dirY * 50 } });
  pillar(ctx, { follow: u, radius: 70, height: 320, color: GOLD, opacity: 0.35, duration: dur + 0.1 });
  decal(ctx, { follow: u, radius: 140, color: GOLD, opacity: 0.7, duration: dur, spin: 4, map: runeTex(ctx), grow: [0.3, 1] });
  // 方向细线（贴地，沿施法方向 2500 码）
  const T = ctx.THREE;
  const line = mesh(ctx, planeGeo(ctx), mat(ctx, GOLD, 0, { map: streakTex(ctx) }));
  const L = 2500;
  const root = new T.Group();
  root.add(line);
  line.rotation.set(-Math.PI / 2, 0, yawOf(dirX, dirY) + Math.PI);
  line.scale.set(L, 60, 1);
  return launch(ctx, root, {
    duration: dur, tag: 'ezreal_r_charge',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      const q = upos(ctx, u);
      place(ctx, root, q.x + dirX * L * 0.5, q.y + dirY * L * 0.5, 6);
      root.visible = shown(ctx, u);
      line.material.opacity = 0.35 * easeOut3(t) * (0.8 + 0.2 * Math.sin(age * 20));
      return undefined;
    },
  });
}

// R 弹幕：巨型金色新月 + 蓝白核心 + 宽拖尾
function rWave(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 2.2;
  const root = new T.Group();
  const arcG = geo(ctx, 'ez_r_arc', (TT) => sectorGeo(TT, 60, 100, 1.2, 28, { radialPow: 2 }));
  const arcs = [];
  for (let i = 0; i < 3; i++) {
    const a = mesh(ctx, arcG, mat(ctx, i === 1 ? ARCANE : GOLD, i === 1 ? 0.6 : 0.9, { vc: true }));
    a.rotation.x = -Math.PI / 2;
    a.position.x = -i * 40;
    a.scale.setScalar(size * (1 - i * 0.15));
    const v = mesh(ctx, arcG, mat(ctx, GOLD, 0.5, { vc: true }));
    v.position.x = -i * 40;
    v.scale.setScalar(size * 0.7 * (1 - i * 0.15));
    root.add(a, v);
    arcs.push(a, v);
  }
  const core = sprite(ctx, GOLD_HOT, 180 * size * 0.5, 1);
  const halo = sprite(ctx, GOLD, 520 * size * 0.5, 0.45);
  core.position.x = 60;
  root.add(halo, core);
  let emit = 0;
  return projView(ctx, p, root, {
    tag: 'ezreal_r_wave',
    trail: { color: GOLD, color2: ARCANE, width: 300, seg: 40, max: 20, fade: 0.5 },
    update: (dt, proj, cur, age) => {
      const pulse = 1 + 0.08 * Math.sin(age * 30);
      for (let i = 0; i < arcs.length; i++) arcs[i].scale.setScalar(size * (i % 2 ? 0.7 : 1) * (1 - Math.floor(i / 2) * 0.15) * pulse);
      emit -= dt;
      if (emit <= 0 && cur.vis) {
        emit = low(ctx) ? 0.12 : 0.05;
        burst(ctx, { x: cur.x, y: cur.y, h: 60, count: 5, color: GOLD, color2: ARCANE_HOT, speed: 200, size: 28, life: 0.5, up: 0.3, radius: 120, vis: true, map: starTex(ctx) });
      }
    },
  });
}

export default function register(fx) {
  const r = registrar(fx, 'ezreal');
  r.proj('ezreal_aa', aaBolt);
  r.proj('ezreal_q_bolt', qBolt);
  r.proj('ezreal_w_orb', wOrb);
  r.proj('ezreal_e_bolt', eBolt);
  r.proj('ezreal_r_wave', rWave);
  r.on('ezreal_q_hit', qHit);
  r.on('ezreal_w_mark', wMark);
  r.on('ezreal_w_pop', wPop);
  r.on('ezreal_e_blink', eBlink);
  r.on('ezreal_passive_max', passiveMax);
  r.on('ezreal_r_charge', rCharge);
}
