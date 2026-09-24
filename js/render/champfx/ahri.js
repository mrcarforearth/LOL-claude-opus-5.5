// 阿狸专属特效：欺诈宝珠（蓝粉宝珠往返拖尾）、妖异狐火（环绕狐火与追踪）、魅惑妖术（爱心）、灵魄突袭（紫色灵魄冲刺与灵弹）、摄魂夺魄
import {
  NOOP, TAU, env, geo, mat, mesh, sprite, stick, upos, unitH, alive, shown, gh,
  launch, burst, decal, ring, flash, unitTrail, ghost, projView, registrar, converge,
  heartTex, starTex, runeTex, low, trail,
} from './_kit.js';

const BLUE = 0x8fb8ff;
const PINK = 0xff6ac1;
const VIOLET = 0xb58aff;
const HOT = 0xf4ecff;
const FOX = 0x7f8bff;

// —— Q：欺诈宝珠（去程蓝、回程转白热，外圈粉色涡流） ——
function qOrb(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.2;
  const root = new T.Group();
  const halo = sprite(ctx, p.vfx?.color ?? BLUE, 190 * size, 0.55);
  const core = sprite(ctx, HOT, 80 * size, 1);
  const star = sprite(ctx, BLUE, 130 * size, 0.7, starTex(ctx));
  const wisps = [];
  for (let i = 0; i < 3; i++) {
    const w = sprite(ctx, i % 2 ? PINK : BLUE, 46 * size, 0.85);
    wisps.push(w);
    root.add(w);
  }
  const swirl = mesh(ctx, geo(ctx, 'ahri_q_swirl', (TT) => new TT.TorusGeometry(1, 0.05, 4, 36, Math.PI * 1.4)), mat(ctx, PINK, 0.6));
  swirl.scale.setScalar(52 * size);
  root.add(halo, star, core, swirl);
  let spark = 0;
  return projView(ctx, p, root, {
    tag: 'ahri_q_orb', face: false,
    trail: { color: BLUE, color2: PINK, width: 64 * size, seg: 22, max: 20, fade: 0.35 },
    update: (dt, proj, cur, age) => {
      const back = !!proj.returning;
      for (let i = 0; i < wisps.length; i++) {
        const a = age * (back ? -14 : 11) + (i * TAU) / wisps.length;
        wisps[i].position.set(Math.cos(a) * 48 * size, Math.sin(a * 1.3) * 16 * size, Math.sin(a) * 48 * size);
      }
      swirl.rotation.set(Math.PI / 2 + Math.sin(age * 5) * 0.4, age * (back ? -9 : 9), 0);
      star.material.rotation = age * 4;
      core.material.color.setHex(back ? 0xffffff : HOT);
      halo.material.color.setHex(back ? 0xe0d6ff : (p.vfx?.color ?? BLUE));
      const pulse = 1 + 0.1 * Math.sin(age * 30);
      core.scale.setScalar(80 * size * pulse * (back ? 1.15 : 1));
      spark -= dt;
      if (spark <= 0 && cur.vis && !low(ctx)) {
        spark = 0.06;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 3, color: back ? HOT : BLUE, color2: PINK, speed: 70, size: 20, life: 0.4, up: 0.3, vis: true });
      }
    },
  });
}

// —— W：环绕狐火（与模拟层相同的角度公式，已射出的狐火隐藏） ——
function foxWisp(ctx, size = 1) {
  const T = ctx.THREE;
  const g = new T.Group();
  const outer = sprite(ctx, FOX, 90 * size, 0.6);
  const inner = sprite(ctx, HOT, 34 * size, 0.95);
  const tip = sprite(ctx, VIOLET, 50 * size, 0.7);
  g.add(outer, tip, inner);
  g.userData.parts = { outer, inner, tip };
  return g;
}
function flickerWisp(g, age, seed, size = 1) {
  const { outer, inner, tip } = g.userData.parts;
  const f = 1 + 0.18 * Math.sin(age * 23 + seed * 5) + 0.08 * Math.sin(age * 41 + seed);
  outer.scale.setScalar(90 * size * f);
  inner.scale.setScalar(34 * size * (2 - f));
  tip.position.y = 22 * size * f;
}
function wOrbit(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const count = p.count || 3, R = p.radius || 110, spd = p.orbitSpeed || 5.5, start = Number.isFinite(p.start) ? p.start : (ctx.game?.time ?? 0);
  const dur = (p.duration || 2.5) + 0.2;
  const root = new T.Group();
  const wisps = [];
  const heads = [];
  for (let i = 0; i < count; i++) {
    const w = foxWisp(ctx, 1);
    root.add(w);
    wisps.push(w);
    heads.push({ x: 0, y: 0, h: 0, vis: false, on: true });
  }
  // 每颗狐火一条短拖尾（低画质省略）
  const trails = low(ctx) ? [] : heads.map((hd) => trail(ctx, {
    color: FOX, color2: VIOLET, width: 34, seg: 14, max: 10, fade: 0.2, maxLife: dur + 1,
    head: () => (hd.on ? hd : null),
  }));
  ring(ctx, { follow: u, radius: R + 40, color: FOX, duration: 0.5, opacity: 0.7 });
  burst(ctx, { x: u.x, y: u.y, h: 110, count: 14, color: FOX, color2: PINK, speed: 260, size: 26, life: 0.45, team: u.team });
  const b = p.buff;
  return launch(ctx, root, {
    duration: dur, tag: 'ahri_w_orbit',
    update: (t, dt, age) => {
      const over = !alive(u) || (b && b.removed);
      const fired = b?.data?.fired ?? 0;
      if (over || fired >= count) { for (const hd of heads) hd.on = false; return false; }
      const q = upos(ctx, u);
      const vis = shown(ctx, u);
      const base = gh(ctx, q.x, q.y) + (q.z || 0) + unitH(ctx, u, 0.55);
      const gt = ctx.game?.time ?? start + age;
      for (let i = 0; i < count; i++) {
        const w = wisps[i], hd = heads[i];
        const on = i >= fired;
        w.visible = on && vis;
        hd.on = on;
        if (!on) continue;
        const a = (gt - start) * spd + (i * TAU) / count;
        const x = q.x + Math.cos(a) * R, y = q.y + Math.sin(a) * R;
        const hh = base + Math.sin(age * 6 + i * 2) * 14;
        w.position.set(x, hh, -y);
        flickerWisp(w, age, i);
        hd.x = x; hd.y = y; hd.h = hh; hd.vis = vis;
      }
      return undefined;
    },
    // 结束时关闭拖尾头部，拖尾随后自行淡出
    onEnd: () => { for (const hd of heads) hd.on = false; void trails; },
  });
}

// W：追踪狐火
function wFire(ctx, p) {
  const root = foxWisp(ctx, (p.vfx?.size || 1) * 1.05);
  let emit = 0;
  return projView(ctx, p, root, {
    tag: 'ahri_w_fire', face: false,
    trail: { color: FOX, color2: VIOLET, width: 44, seg: 18, max: 14, fade: 0.25 },
    update: (dt, proj, cur, age) => {
      flickerWisp(root, age, 3);
      emit -= dt;
      if (emit <= 0 && cur.vis && !low(ctx)) {
        emit = 0.08;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 2, color: FOX, color2: PINK, speed: 50, size: 22, life: 0.35, up: 0.8, vis: true });
      }
    },
    onDispose: (cur) => {
      if (cur.vis) flash(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), color: FOX, size: 150, duration: 0.25 });
    },
  });
}

// —— E：魅惑妖术（粉色爱心投射物） ——
function eHeart(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1;
  const root = new T.Group();
  const halo = sprite(ctx, PINK, 170 * size, 0.5);
  const heart = sprite(ctx, 0xff8fd0, 96 * size, 1, heartTex(ctx));
  const core = sprite(ctx, 0xffe0f2, 60 * size, 0.8, heartTex(ctx));
  root.add(halo, heart, core);
  let emit = 0;
  return projView(ctx, p, root, {
    tag: 'ahri_e_heart', face: false,
    trail: { color: PINK, color2: 0x9a3aff, width: 58 * size, seg: 20, max: 16, fade: 0.3 },
    update: (dt, proj, cur, age) => {
      const beat = 1 + 0.16 * Math.max(0, Math.sin(age * 16));
      heart.scale.setScalar(96 * size * beat);
      core.scale.setScalar(52 * size * beat);
      emit -= dt;
      if (emit <= 0 && cur.vis) {
        emit = low(ctx) ? 0.18 : 0.08;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 2, color: PINK, color2: 0xffb0e0, speed: 60, size: 30, life: 0.5, up: 0.9, map: heartTex(ctx), vis: true });
      }
    },
  });
}

// E 命中：魅惑（头顶飘爱心 + 脚下粉色光圈）
function charm(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = Math.max(0.3, p.duration || 1.4);
  const H = unitH(ctx, u, 1);
  flash(ctx, { follow: u, h: H * 0.55, color: PINK, size: 300, duration: 0.35, map: heartTex(ctx), grow: [0.5, 1.4] });
  burst(ctx, { x: u.x, y: u.y, h: H * 0.6, count: 16, color: PINK, color2: 0xffc0ea, speed: 280, size: 34, life: 0.6, up: 0.6, map: heartTex(ctx), team: u.team });
  decal(ctx, { follow: u, radius: Math.max(70, (u.radius || 60) * 1.4), color: PINK, opacity: 0.55, duration: dur, spin: 1.2, map: runeTex(ctx) });
  const root = new T.Group();
  const hearts = [];
  const n = low(ctx) ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const s = sprite(ctx, i ? 0xff9ad6 : PINK, 44, 0, heartTex(ctx));
    root.add(s);
    hearts.push(s);
  }
  return launch(ctx, root, {
    duration: dur, tag: 'ahri_charm',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      stick(ctx, root, u, H * 1.05);
      const k = env(age, dur, 0.1, 0.25);
      for (let i = 0; i < n; i++) {
        const ph = (age * 0.9 + i / n) % 1;
        const a = age * 2 + i * 2.1;
        hearts[i].position.set(Math.cos(a) * 26, ph * 70, Math.sin(a) * 26);
        hearts[i].material.opacity = k * Math.sin(ph * Math.PI);
        hearts[i].scale.setScalar(30 + ph * 28);
      }
    },
  });
}

// —— 被动：摄魂夺魄（精魄汇入阿狸，big=击杀英雄） ——
function passiveHeal(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const big = !!p.big;
  const H = unitH(ctx, u, 0.55);
  converge(ctx, { follow: u, h: H, radius: big ? 320 : 220, count: big ? 26 : 14, color: BLUE, color2: PINK, size: big ? 34 : 26, duration: big ? 0.8 : 0.6, spin: 2.2 });
  flash(ctx, { follow: u, h: H, color: 0xd8c6ff, size: big ? 340 : 220, duration: big ? 0.6 : 0.4 });
  ring(ctx, { follow: u, radius: big ? 180 : 120, color: 0x9ae6c8, duration: 0.6, opacity: 0.7 });
  if (big) burst(ctx, { x: u.x, y: u.y, h: 40, count: 18, color: 0x9affc8, color2: PINK, speed: 120, size: 30, life: 0.9, up: 1.6, radius: 60, team: u.team });
  return NOOP;
}

// —— R：灵魄突袭（紫色灵魄冲刺 + 狐尾残影） ——
function rDash(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 0.6;
  const x1 = p.x1 ?? u.x, y1 = p.y1 ?? u.y, x2 = p.x2 ?? u.x, y2 = p.y2 ?? u.y;
  const arrived = () => Math.hypot(u.x - x2, u.y - y2) < 25;
  flash(ctx, { x: x1, y: y1, h: 100, color: VIOLET, size: 280, duration: 0.3, team: u.team });
  burst(ctx, { x: x1, y: y1, h: 90, count: 16, color: VIOLET, color2: BLUE, speed: 300, size: 28, life: 0.45, team: u.team });
  unitTrail(ctx, u, { color: VIOLET, color2: 0x4a2aa8, width: 120, seg: 26, max: 18, duration: dur, fade: 0.35, until: arrived });
  unitTrail(ctx, u, { color: HOT, color2: PINK, width: 34, seg: 26, max: 14, duration: dur, fade: 0.25, hf: 0.65, until: arrived });
  const holder = new T.Group();
  let next = 0, emit = 0;
  return launch(ctx, holder, {
    duration: dur + 0.1, tag: 'ahri_r_dash',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (age > 0.05 && (arrived() || age >= dur)) {
        const q = upos(ctx, u);
        flash(ctx, { x: q.x, y: q.y, h: 100, color: VIOLET, size: 320, duration: 0.35, team: u.team });
        ring(ctx, { x: q.x, y: q.y, radius: 200, color: VIOLET, duration: 0.45, team: u.team });
        burst(ctx, { x: q.x, y: q.y, h: 80, count: 20, color: VIOLET, color2: PINK, speed: 340, size: 26, life: 0.5, team: u.team });
        return false;
      }
      if (age >= next) { next = age + 0.07; ghost(ctx, u, { color: VIOLET, opacity: 0.45, duration: 0.35 }); }
      emit -= dt;
      if (emit <= 0 && shown(ctx, u)) {
        emit = low(ctx) ? 0.08 : 0.035;
        const q = upos(ctx, u);
        burst(ctx, { x: q.x, y: q.y, h: 90, count: 3, color: VIOLET, color2: BLUE, speed: 90, size: 30, life: 0.45, up: 0.6, vis: true });
      }
      return undefined;
    },
  });
}

// R：灵弹（追踪紫色灵光）
function rBolt(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1;
  const root = new T.Group();
  const halo = sprite(ctx, VIOLET, 130 * size, 0.6);
  const star = sprite(ctx, 0xe0ccff, 90 * size, 0.9, starTex(ctx));
  const core = sprite(ctx, HOT, 40 * size, 1);
  root.add(halo, star, core);
  return projView(ctx, p, root, {
    tag: 'ahri_r_bolt', face: false,
    trail: { color: VIOLET, color2: BLUE, width: 40 * size, seg: 18, max: 14, fade: 0.25 },
    update: (dt, proj, cur, age) => {
      star.material.rotation = age * 8 + (p.vfx?.index || 0);
      halo.scale.setScalar(130 * size * (1 + 0.15 * Math.sin(age * 28)));
    },
  });
}

export default function register(fx) {
  const r = registrar(fx, 'ahri');
  r.proj('ahri_q_orb', qOrb);
  r.on('ahri_w_orbit', wOrbit);
  r.proj('ahri_w_fire', wFire);
  r.proj('ahri_e_heart', eHeart);
  r.on('ahri_charm', charm);
  r.on('ahri_passive_heal', passiveHeal);
  r.on('ahri_r_dash', rDash);
  r.proj('ahri_r_bolt', rBolt);
}
