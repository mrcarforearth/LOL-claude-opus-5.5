// 劫专属特效：影分身（劫模型的暗影克隆 + 紫黑烟雾，跟随模拟对象）、手里剑（旋转四刃镖）、鬼斩（红色环斩）、换位烟雾、瞬狱影杀阵（突进/死亡印记/引爆）、灭魂劫
import {
  NOOP, TAU, env, geo, mat, mesh, sprite, runeTex,
  place, flat, stick, upos, unitH, alive, seen, gh, launch, burst, decal, ring, shock, flash, pillar,
  unitTrail, ghost, projView, registrar, shake, low, beamMesh, setBeam,
} from './_kit.js';

const RED = 0xff2a3a;
const RED_HOT = 0xff8a8a;
const SHADOW = 0x7a3ab0;
const DARK = 0x14081e;
const STEEL = 0xd8dce8;

// —— 影分身 ——
// 克隆劫的模型并替换为暗色材质；克隆失败（骨骼网格/无视图）时用简易剪影
function shadowBody(ctx, owner) {
  const T = ctx.THREE;
  const src = ctx.getView?.(owner)?.object3d;
  const dark = new T.MeshBasicMaterial({ color: DARK, transparent: true, opacity: 0.82, depthWrite: true, toneMapped: false, fog: false });
  let skinned = false;
  src?.traverse?.((c) => { if (c.isSkinnedMesh) skinned = true; });
  if (src && !skinned) {
    const clone = src.clone(true);
    const drop = [];
    clone.traverse((c) => {
      if (c.isMesh) c.material = dark;
      else if (c.isSprite || c.isPoints || c.isLine || c.isLight) drop.push(c);
    });
    for (const c of drop) c.parent?.remove(c);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.visible = true;
    return { obj: clone, mat: dark };
  }
  // 后备剪影：身体 + 头
  const g = new T.Group();
  const body = mesh(ctx, geo(ctx, 'zed_sil_body', (TT) => { const b = new TT.CylinderGeometry(28, 38, 150, 10); b.translate(0, 75, 0); return b; }), dark);
  const head = mesh(ctx, geo(ctx, 'zed_sil_head', (TT) => { const b = new TT.SphereGeometry(26, 10, 8); b.translate(0, 180, 0); return b; }), dark);
  g.add(body, head);
  return { obj: g, mat: dark };
}
function shadowFx(ctx, p) {
  const s = p.shadow, owner = p.owner || p.unit;
  if (!s || !owner) return NOOP;
  const T = ctx.THREE;
  const root = new T.Group();
  const { obj, mat: dark } = shadowBody(ctx, owner);
  root.add(obj);
  const H = unitH(ctx, owner, 1);
  const rim = sprite(ctx, SHADOW, H * 1.3, 0.35);
  rim.position.y = H * 0.5;
  const eyes = sprite(ctx, RED, 40, 0.9);
  eyes.position.set(18, H * 0.85, 0);
  root.add(rim, eyes);
  const gdecal = decal(ctx, {
    follow: null, x: s.x, y: s.y, radius: 90, color: SHADOW, opacity: 0.55, duration: p.duration || 6, spin: 1.2, map: runeTex(ctx), team: s.team,
    until: () => !s.alive,
    onUpdate: (m) => { m.position.set(s.x, gh(ctx, s.x, s.y) + 3, -s.y); m.visible = seen(ctx, s.x, s.y, s.team); },
  });
  let smoke = 0, lastAction = -99;
  const dur = p.duration || 6;
  return launch(ctx, root, {
    duration: dur, tag: 'zed_shadow',
    update: (t, dt, age) => {
      if (!s.alive) { gdecal.remove?.(); return false; }
      const vis = seen(ctx, s.x, s.y, s.team);
      root.visible = vis;
      root.position.set(s.x, gh(ctx, s.x, s.y), -s.y);
      root.rotation.y = s.facing || 0;
      const k = Math.min(1, age / 0.15);
      dark.opacity = 0.82 * k;
      rim.material.opacity = (0.3 + 0.08 * Math.sin(age * 5)) * k;
      // 模仿技能时：身体闪红
      if (s.actionAt !== lastAction && s.actionAt > 0) {
        lastAction = s.actionAt;
        if (vis) flash(ctx, { x: s.x, y: s.y, h: H * 0.6, color: s.action === 'E' ? RED : SHADOW, size: 220, duration: 0.25, team: s.team });
      }
      smoke -= dt;
      if (smoke <= 0 && vis && !low(ctx)) {
        smoke = s.arrived ? 0.14 : 0.04;
        burst(ctx, { x: s.x, y: s.y, h: 20, count: 3, color: 0x2a1238, speed: 50, up: 2.5, radius: 45, size: 50, life: 0.8, additive: false, opacity: 0.45, drag: 0.8, vis: true });
      }
      return undefined;
    },
  });
}
function shadowFade(ctx, p) {
  if (!seen(ctx, p.x, p.y, p.team)) return NOOP;
  burst(ctx, { x: p.x, y: p.y, h: 90, count: 18, color: 0x2a1238, speed: 160, up: 0.8, radius: 50, size: 60, life: 0.7, additive: false, opacity: 0.55, vis: true });
  burst(ctx, { x: p.x, y: p.y, h: 100, count: 10, color: SHADOW, speed: 220, size: 22, life: 0.4, vis: true });
  return NOOP;
}

// —— Q：手里剑（四刃旋转镖 + 拖尾） ——
function shurikenGeo(ctx) {
  return geo(ctx, 'zed_shuriken', (T) => {
    const pos = [], idx = [];
    const n = 4, R = 1, r = 0.22;
    pos.push(0, 0, 0);
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * TAU + (i % 2 ? 0.25 : 0);
      const rr = i % 2 ? r : R;
      pos.push(Math.cos(a) * rr, Math.sin(a) * rr, 0);
    }
    for (let i = 1; i <= n * 2; i++) idx.push(0, i, (i % (n * 2)) + 1);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  });
}
function qShuriken(ctx, p) {
  const T = ctx.THREE;
  const shadowT = !!p.vfx?.shadow;
  const root = new T.Group();
  const blade = mesh(ctx, shurikenGeo(ctx), mat(ctx, shadowT ? SHADOW : STEEL, 0.95, { additive: shadowT }));
  const edge = mesh(ctx, shurikenGeo(ctx), mat(ctx, RED, 0.6));
  flat(blade); flat(edge);
  blade.scale.set(46, 46, 1); edge.scale.set(56, 56, 1);
  const glow = sprite(ctx, shadowT ? SHADOW : RED, 110, 0.5);
  root.add(edge, blade, glow);
  return projView(ctx, p, root, {
    tag: 'zed_q_shuriken', face: false,
    trail: { color: shadowT ? SHADOW : RED, color2: DARK, width: 40, seg: 20, max: 12, fade: 0.25 },
    update: (dt, proj, cur, age) => {
      blade.rotation.z = -age * 26;
      edge.rotation.z = -age * 26 + 0.4;
      glow.material.opacity = 0.4 + 0.15 * Math.sin(age * 30);
    },
  });
}

// —— E：鬼斩（红色环形斩击 + 暗色冲击） ——
function eSlash(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const R = p.radius || 290, team = p.team ?? u?.team;
  if (!seen(ctx, q.x, q.y, team)) return NOOP;
  shock(ctx, { x: q.x, y: q.y, radius: R, color: RED, duration: 0.4, team });
  ring(ctx, { x: q.x, y: q.y, radius: R * 0.85, color: SHADOW, duration: 0.5, team });
  decal(ctx, { x: q.x, y: q.y, radius: R * 0.9, color: DARK, opacity: 0.5, duration: 0.6, additive: false, map: runeTex(ctx), spin: -3, team });
  burst(ctx, { x: q.x, y: q.y, h: 70, count: 20, color: RED, color2: RED_HOT, speed: 420, size: 18, life: 0.35, up: 0.2, radius: R * 0.3, team });
  const T = ctx.THREE;
  const root = new T.Group();
  const bladeG = geo(ctx, 'zed_e_blade', (TT) => { const g = new TT.PlaneGeometry(1, 1); g.translate(0.5, 0, 0); return g; });
  const blades = [];
  for (let i = 0; i < 3; i++) {
    const m = mesh(ctx, bladeG, mat(ctx, i === 1 ? RED_HOT : RED, 0.9));
    flat(m, (i / 3) * TAU);
    m.scale.set(R, 18, 1);
    root.add(m);
    blades.push(m);
  }
  place(ctx, root, q.x, q.y, 70);
  return launch(ctx, root, {
    duration: 0.3, tag: 'zed_e_slash',
    update: (t) => {
      for (let i = 0; i < blades.length; i++) {
        blades[i].rotation.z = (i / 3) * TAU - t * TAU * 1.4;
        blades[i].material.opacity = 0.9 * (1 - t);
      }
    },
  });
}

// —— W：放出分身（紫色影线） / 换位（两端烟雾 + 影线） ——
function streak(ctx, x1, y1, x2, y2, color, width, dur, team) {
  if (!seen(ctx, x1, y1, team) && !seen(ctx, x2, y2, team)) return NOOP;
  const m = beamMesh(ctx, color, 0.8);
  setBeam(ctx, m, x1, y1, 90, x2, y2, 90, width);
  return launch(ctx, m, { duration: dur, tag: 'zed_streak', update: (t) => { m.material.opacity = 0.8 * (1 - t); m.scale.y = m.scale.z = width * (1 - t * 0.7); } });
}
function wCast(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const q = upos(ctx, u);
  streak(ctx, q.x, q.y, p.x, p.y, SHADOW, 60, 0.35, u.team);
  burst(ctx, { x: q.x, y: q.y, h: 80, count: 12, color: SHADOW, speed: 200, size: 24, life: 0.4, team: u.team });
  return NOOP;
}
function swap(ctx, p) {
  const team = p.unit?.team;
  shadowFade(ctx, { x: p.x1, y: p.y1, team });
  shadowFade(ctx, { x: p.x2, y: p.y2, team });
  streak(ctx, p.x1, p.y1, p.x2, p.y2, SHADOW, 50, 0.3, team);
  flash(ctx, { x: p.x2, y: p.y2, h: 110, color: SHADOW, size: 260, duration: 0.3, team });
  return NOOP;
}

// —— R：突进（黑红残影） / 死亡印记 / 引爆 ——
function rDash(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const dur = p.duration || 0.45;
  flash(ctx, { x: p.x, y: p.y, h: 100, color: RED, size: 360, duration: 0.35, team: u.team });
  unitTrail(ctx, u, { color: RED, color2: DARK, width: 110, seg: 22, max: 14, duration: dur + 0.05, fade: 0.3, hf: 0.45 });
  const T = ctx.THREE;
  let next = 0, n = 0;
  return launch(ctx, new T.Group(), {
    duration: dur + 0.1, tag: 'zed_r_dash',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (age >= next && n < 4) { next = age + dur / 4; n++; ghost(ctx, u, { color: RED, opacity: 0.4, duration: 0.35 }); }
      return undefined;
    },
  });
}
function rMark(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 3;
  const root = new T.Group();
  const star = mesh(ctx, shurikenGeo(ctx), mat(ctx, RED, 0.9));
  star.scale.set(40, 40, 1);
  const halo = sprite(ctx, RED, 120, 0.5);
  root.add(halo, star);
  decal(ctx, { follow: u, radius: 120, color: RED, opacity: 0.7, duration: dur, spin: 2, map: runeTex(ctx), until: () => !u.hasBuff?.('zed_r_mark') });
  return launch(ctx, root, {
    duration: dur + 0.1, tag: 'zed_r_mark',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && u.hasBuff && !u.hasBuff('zed_r_mark'))) return false;
      stick(ctx, root, u, unitH(ctx, u, 1) + 40);
      star.rotation.set(0, 0, -age * (3 + age * 4));
      const beat = 1 + 0.25 * Math.max(0, Math.sin(age * (4 + age * 5)));
      star.scale.set(40 * beat, 40 * beat, 1);
      halo.material.opacity = (0.35 + 0.25 * t) * env(age, dur, 0.1, 0.1);
    },
  });
}
function rPop(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const h = u ? unitH(ctx, u, 0.55) : 100;
  flash(ctx, { x: q.x, y: q.y, h, color: RED_HOT, size: 520, duration: 0.35 });
  shock(ctx, { x: q.x, y: q.y, radius: 300, color: RED, duration: 0.5 });
  pillar(ctx, { x: q.x, y: q.y, radius: 80, height: 500, color: RED, opacity: 0.6, duration: 0.4 });
  burst(ctx, { x: q.x, y: q.y, h, count: 30, color: RED, color2: DARK, speed: 520, size: 26, life: 0.55, up: 0.5 });
  burst(ctx, { x: q.x, y: q.y, h: 40, count: 14, color: 0x2a1238, speed: 260, size: 60, life: 0.8, additive: false, opacity: 0.5, up: 0.4 });
  shake(ctx, q.x, q.y, 16, 0.3);
  return NOOP;
}
function pHit(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const h = u ? unitH(ctx, u, 0.5) : 90;
  flash(ctx, { x: q.x, y: q.y, h, color: RED, size: 200, duration: 0.25 });
  burst(ctx, { x: q.x, y: q.y, h, count: 10, color: RED, color2: SHADOW, speed: 300, size: 18, life: 0.35 });
  return NOOP;
}

export default function register(fx) {
  const r = registrar(fx, 'zed');
  r.proj('zed_q_shuriken', qShuriken);
  r.on('zed_shadow', shadowFx);
  r.on('zed_shadow_fade', shadowFade);
  r.on('zed_e_slash', eSlash);
  r.on('zed_w_cast', wCast);
  r.on('zed_swap', swap);
  r.on('zed_r_dash', rDash);
  r.on('zed_r_mark', rMark);
  r.on('zed_r_pop', rPop);
  r.on('zed_p_hit', pHit);
}

