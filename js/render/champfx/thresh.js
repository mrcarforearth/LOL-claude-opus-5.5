// 锤石专属特效：死亡判决（旋钩蓄力、钩链投射物、锁链牵引、死亡飞跃）、魂引之灯（灯笼投掷/停留/牵引/回收）、
// 地狱诅咒（灵魂拾取）、厄运钟摆（锁链横扫）、幽冥监牢（五面幽绿光墙、撞墙碎裂）、普攻灵火
import {
  NOOP, TAU, env, easeOut3, geo, mat, mesh, sprite, solidMat, sectorGeo, merge, place, flat, upos, unitH, alive, shown, seen, gh,
  launch, burst, decal, ring, shock, flash, pillar, trail, unitTrail, beamGeo, ghost, projView, registrar, converge, shake, customTex, teamOnlyHidden,
  starTex, runeTex, glowTex, streakTex, planeGeo, low, rnd, clamp01,
} from './_kit.js';

const SOUL = 0x5affb8;
const DARK = 0x1c8a64;
const PALE = 0xd8fff0;
const DEEP = 0x0e4a38;

// —— 锁链：链环实例化网格（一次绘制）+ 幽绿辉光条 ——
const linkGeo = (ctx) => geo(ctx, 'thresh_link', (T) => { const g = new T.TorusGeometry(1, 0.3, 4, 10); g.scale(1.5, 1, 1); return g; });
const chainMat = (ctx) => solidMat(ctx, 'thresh_chain', 0x9ab8a8, { metalness: 0.8, roughness: 0.35, emissive: 0x1c8a64, emissiveIntensity: 0.9 });
function makeChain(ctx, max = 40, o = {}) {
  const T = ctx.THREE;
  const g = new T.Group();
  const inst = new T.InstancedMesh(linkGeo(ctx), chainMat(ctx), max);
  inst.frustumCulled = false;
  inst.count = 0;
  const glowM = mat(ctx, o.color ?? SOUL, 0.35, { vc: true });
  const glow = mesh(ctx, beamGeo(ctx), glowM);
  g.add(inst, glow);
  const m4 = new T.Matrix4(), q = new T.Quaternion(), qr = new T.Quaternion(), q2 = new T.Quaternion();
  const X = new T.Vector3(1, 0, 0), d = new T.Vector3(), pv = new T.Vector3(), sv = new T.Vector3();
  qr.setFromAxisAngle(X, Math.PI / 2);
  const size = o.size ?? 9, spacing = size * 2.3;
  g.userData.set = (a, b, glowW = 26, opacity = 1) => {
    d.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = d.length();
    if (len < 1) { inst.count = 0; glow.visible = false; return; }
    d.divideScalar(len);
    q.setFromUnitVectors(X, d);
    q2.copy(q).multiply(qr);
    const n = Math.min(max, Math.max(1, Math.round(len / spacing)));
    const step = len / n;
    sv.set(size, size, size);
    for (let i = 0; i < n; i++) {
      pv.set(a.x + d.x * step * (i + 0.5), a.y + d.y * step * (i + 0.5), a.z + d.z * step * (i + 0.5));
      m4.compose(pv, i % 2 ? q2 : q, sv);
      inst.setMatrixAt(i, m4);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    glow.visible = true;
    glow.position.set(a.x, a.y, a.z);
    glow.quaternion.copy(q);
    glow.scale.set(len, glowW, glowW);
    glowM.opacity = 0.35 * opacity;
  };
  g.userData.dispose = () => { try { inst.dispose?.(); } catch { /* 忽略 */ } };
  return g;
}
// 锤石持链的手（右前方）
function handPos(ctx, u, out = {}) {
  const q = upos(ctx, u);
  const f = u.facing || 0;
  const x = q.x + Math.cos(f - 0.8) * 45, y = q.y + Math.sin(f - 0.8) * 45;
  out.x = x; out.z = -y; out.y = gh(ctx, x, y) + (q.z || 0) + unitH(ctx, u, 0.55);
  return out;
}
function chestPos(ctx, u, out = {}) {
  const q = upos(ctx, u);
  out.x = q.x; out.z = -q.y; out.y = gh(ctx, q.x, q.y) + (q.z || 0) + unitH(ctx, u, 0.5);
  return out;
}

// 钩刃：弯月形金属钩 + 幽绿辉光
const hookGeo = (ctx) => geo(ctx, 'thresh_hook', (T) => merge(T, [
  [new T.TorusGeometry(26, 4, 5, 14, Math.PI * 1.25), { r: [0, 0, Math.PI * 0.2], c: 0xc8e8d8 }],
  [new T.ConeGeometry(5, 22, 5), { p: [-22, -14, 0], r: [0, 0, 2.3], c: 0xe8fff4 }],
  [new T.CylinderGeometry(3.5, 3.5, 26, 6), { p: [-8, 0, 0], r: [0, 0, Math.PI / 2], c: 0x6a8a7a }],
]));
function hookModel(ctx, size = 1) {
  const T = ctx.THREE;
  const g = new T.Group();
  const blade = mesh(ctx, hookGeo(ctx), solidMat(ctx, 'thresh_hook', 0xffffff, { metalness: 0.85, roughness: 0.3, emissive: 0x1c8a64, emissiveIntensity: 1.1, vc: true }));
  blade.scale.setScalar(size);
  const halo = sprite(ctx, SOUL, 150 * size, 0.55);
  const core = sprite(ctx, PALE, 50 * size, 0.8);
  g.add(halo, blade, core);
  g.userData.blade = blade;
  return g;
}

// —— Q：旋钩蓄力（身侧飞旋的钩与幽绿涡流） ——
function qWindup(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 0.5;
  const root = new T.Group();
  const hook = hookModel(ctx, 0.9);
  const swirl = mesh(ctx, geo(ctx, 'thresh_swirl', (TT) => sectorGeo(TT, 0.75, 1, Math.PI * 0.8, 28, { sweep: true })), mat(ctx, SOUL, 0, { vc: true }));
  root.add(swirl, hook);
  const hp = {};
  return launch(ctx, root, {
    duration: dur + 0.05, tag: 'thresh_q_windup',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      root.visible = shown(ctx, u);
      handPos(ctx, u, hp);
      const f = u.facing || 0;
      root.position.set(hp.x, hp.y, hp.z);
      root.rotation.set(0, f, 0);
      const a = age * 22;
      const R = 70;
      hook.position.set(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.6 + 20, Math.sin(a) * R);
      hook.userData.blade.rotation.set(a, 0, a * 0.5);
      swirl.rotation.set(0, Math.PI / 2, -a);
      swirl.scale.set(R, R, 1);
      swirl.material.opacity = 0.7 * env(age, dur, 0.08, 0.1);
    },
  });
}

// Q：钩链投射物（钩刃 + 从锤石手中延伸的锁链）
function hookProj(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.1;
  const owner = p.vfx?.owner || p.owner;
  const root = hookModel(ctx, size);
  const chain = owner ? makeChain(ctx, 44) : null;
  const ch = chain ? launch(ctx, chain, { duration: 30, tag: 'thresh_hook_chain', onEnd: () => chain.userData.dispose() }) : null;
  const a = {}, b = {};
  let emit = 0;
  return projView(ctx, p, root, {
    tag: 'thresh_hook',
    trail: { color: SOUL, color2: DEEP, width: 40 * size, seg: 20, max: 10, fade: 0.2, skipLow: true },
    update: (dt, proj, cur, age) => {
      root.userData.blade.rotation.x = Math.sin(age * 20) * 0.3;
      if (chain) {
        chain.visible = cur.vis || shown(ctx, owner);
        if (alive(owner)) {
          handPos(ctx, owner, a);
          b.x = cur.x - Math.cos(cur.yaw) * 20; b.y = cur.h; b.z = -(cur.y - Math.sin(cur.yaw) * 20);
          chain.userData.set(a, b, 24);
        } else chain.visible = false;
      }
      emit -= dt;
      if (emit <= 0 && cur.vis && !low(ctx)) {
        emit = 0.05;
        burst(ctx, { x: cur.x, y: cur.y, h: cur.h - gh(ctx, cur.x, cur.y), count: 2, color: SOUL, color2: PALE, speed: 60, size: 24, life: 0.35, vis: true });
      }
    },
    onDispose: () => { ch?.remove?.(); },
  });
}

// Q 命中：锁链连接锤石与目标（目标失去「死亡判决」即断开）
function qChain(ctx, p) {
  const src = p.from || p.unit, dst = p.to || p.target;
  if (!src || !dst) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 1.5;
  const root = new T.Group();
  const chain = makeChain(ctx, 50);
  const mark = hookModel(ctx, 0.8);
  root.add(chain, mark);
  const H = unitH(ctx, dst, 1);
  flash(ctx, { follow: dst, h: H * 0.5, color: SOUL, size: 320, duration: 0.35, map: starTex(ctx), grow: [0.4, 1.4] });
  burst(ctx, { x: dst.x, y: dst.y, h: H * 0.5, count: 18, color: SOUL, color2: PALE, speed: 340, size: 26, life: 0.45 });
  decal(ctx, { follow: dst, radius: 90, color: SOUL, opacity: 0.6, duration: dur, spin: 2, map: runeTex(ctx), until: () => dst.hasBuff && !dst.hasBuff('thresh_q_hooked') });
  const a = {}, b = {};
  return launch(ctx, root, {
    duration: dur + 0.1, tag: 'thresh_q_chain',
    update: (t, dt, age) => {
      if (!alive(src) || !alive(dst)) return false;
      if (age > 0.1 && dst.hasBuff && !dst.hasBuff('thresh_q_hooked')) return false;
      root.visible = shown(ctx, src) || shown(ctx, dst);
      handPos(ctx, src, a);
      chestPos(ctx, dst, b);
      const pulse = 0.75 + 0.25 * Math.sin(age * 14);
      chain.userData.set(a, b, 30 * pulse, env(age, dur, 0.05, 0.2));
      mark.position.set(b.x, b.y + 10, b.z);
      mark.rotation.y = Math.atan2(-(a.z - b.z), a.x - b.x) + Math.PI;
      mark.userData.blade.rotation.x = Math.sin(age * 6) * 0.2;
    },
    onEnd: () => chain.userData.dispose(),
  });
}
// Q 落空：锁链收回（0.3 秒）
function qMiss(ctx, p) {
  const u = p.unit;
  if (!u || !Number.isFinite(p.x)) return NOOP;
  const T = ctx.THREE;
  const root = new T.Group();
  const chain = makeChain(ctx, 44);
  const hook = hookModel(ctx, 1);
  root.add(chain, hook);
  const hx = p.x, hy = p.y;
  const a = {}, b = {};
  const dur = 0.3;
  return launch(ctx, root, {
    duration: dur, tag: 'thresh_q_miss',
    update: (t) => {
      if (!alive(u)) return false;
      root.visible = shown(ctx, u) || seen(ctx, hx, hy, u.team);
      handPos(ctx, u, a);
      const k = easeOut3(t);
      const hxx = hx + (a.x - hx) * k, hzz = -hy + (a.z + hy) * k;
      b.x = hxx; b.z = hzz; b.y = gh(ctx, hxx, -hzz) + 110 + (a.y - 110 - gh(ctx, hxx, -hzz)) * k;
      chain.userData.set(a, b, 18, 1 - t);
      hook.position.set(b.x, b.y, b.z);
      hook.rotation.y = Math.atan2(-(a.z - b.z), a.x - b.x) + Math.PI;
    },
    onEnd: () => chain.userData.dispose(),
  });
}
// Q2：死亡飞跃（沿锁链飞向目标）
function qLeap(ctx, p) {
  const u = p.unit || p.from, t = p.target || p.to;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = Math.max(0.15, p.duration || 0.4);
  const near = () => (t && alive(t) ? Math.hypot(t.x - u.x, t.y - u.y) < (t.radius || 60) + 120 : true);
  unitTrail(ctx, u, { color: SOUL, color2: DEEP, width: 110, seg: 26, max: 16, duration: dur + 0.1, fade: 0.3, until: near });
  unitTrail(ctx, u, { color: PALE, color2: SOUL, width: 30, seg: 26, max: 12, duration: dur + 0.1, fade: 0.2, hf: 0.7, until: near });
  const root = new T.Group();
  const chain = t ? makeChain(ctx, 50) : null;
  if (chain) root.add(chain);
  const a = {}, b = {};
  let next = 0;
  return launch(ctx, root, {
    duration: dur + 0.15, tag: 'thresh_q_leap',
    update: (k, dt, age) => {
      if (!alive(u)) return false;
      if (age >= next) { next = age + 0.08; ghost(ctx, u, { color: SOUL, opacity: 0.4, duration: 0.3 }); }
      if (chain && alive(t)) {
        root.visible = shown(ctx, u) || shown(ctx, t);
        handPos(ctx, u, a); chestPos(ctx, t, b);
        chain.userData.set(a, b, 22);
      }
      if (age > 0.05 && near()) return false;
      return undefined;
    },
    onEnd: () => chain?.userData.dispose(),
  });
}
function qLeapLand(ctx, p) {
  const x = p.x, y = p.y;
  if (!Number.isFinite(x)) return NOOP;
  const team = p.unit?.team ?? null;
  flash(ctx, { x, y, h: 90, color: SOUL, size: 320, duration: 0.35, team });
  shock(ctx, { x, y, radius: 200, color: SOUL, duration: 0.45, team });
  burst(ctx, { x, y, h: 20, count: 16, color: 0x6a7a70, speed: 300, size: 60, life: 0.7, up: 0.3, additive: false, opacity: 0.45, team });
  burst(ctx, { x, y, h: 60, count: 16, color: SOUL, color2: PALE, speed: 320, size: 22, life: 0.45, team });
  return NOOP;
}

// —— W：魂引之灯 ——
const lanternGeo = (ctx) => geo(ctx, 'thresh_lantern', (T) => {
  const parts = [
    [new T.CylinderGeometry(10, 18, 12, 6), { p: [0, 42, 0], c: 0x3a4a44 }],
    [new T.ConeGeometry(12, 16, 6), { p: [0, 56, 0], c: 0x2a3a34 }],
    [new T.TorusGeometry(9, 2, 4, 12), { p: [0, 70, 0], c: 0x5a6a64 }],
    [new T.CylinderGeometry(18, 13, 8, 6), { p: [0, -2, 0], c: 0x3a4a44 }],
    [new T.ConeGeometry(8, 14, 6), { p: [0, -12, 0], r: [Math.PI, 0, 0], c: 0x2a3a34 }],
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    parts.push([new T.BoxGeometry(2.5, 40, 2.5), { p: [Math.cos(a) * 16, 20, Math.sin(a) * 16], r: [0, -a, 0], c: 0x6a8a7a }]);
  }
  parts.push([new T.OctahedronGeometry(9, 0), { p: [0, 20, 0], s: [1, 1.5, 1], c: 0xb0ffe0 }]);
  return merge(T, parts);
});
function lanternModel(ctx, size = 1) {
  const T = ctx.THREE;
  const g = new T.Group();
  const body = mesh(ctx, lanternGeo(ctx), solidMat(ctx, 'thresh_lantern', 0xffffff, { metalness: 0.7, roughness: 0.4, emissive: 0x1c8a64, emissiveIntensity: 0.8, vc: true }));
  body.scale.setScalar(size);
  const core = sprite(ctx, PALE, 60 * size, 0.95);
  core.position.y = 20 * size;
  const halo = sprite(ctx, SOUL, 190 * size, 0.5);
  halo.position.y = 22 * size;
  g.add(halo, body, core);
  g.userData.core = core; g.userData.halo = halo; g.userData.body = body;
  return g;
}
function lanternThrow(ctx, p) {
  const root = lanternModel(ctx, p.vfx?.size || 1.1);
  return projView(ctx, p, root, {
    tag: 'thresh_lantern_throw', face: false,
    trail: { color: SOUL, color2: DEEP, width: 50, seg: 20, max: 14, fade: 0.3 },
    update: (dt, proj, cur, age) => {
      root.userData.body.rotation.set(Math.sin(age * 10) * 0.4, age * 6, 0);
      root.position.y -= 25;
    },
  });
}
// 灯笼停留（区域视觉）：悬浮摇曳的灯笼 + 地面幽绿光圈
function lantern(ctx, p) {
  const z = p.zone || null;
  const T = ctx.THREE;
  const x = p.x ?? z?.x, y = p.y ?? z?.y;
  if (!Number.isFinite(x)) return NOOP;
  const R = p.radius || 120;
  const team = p.team ?? z?.team ?? null;
  const dur = (p.duration || 6) + 1;
  const root = new T.Group();
  const lamp = lanternModel(ctx, 1.25);
  const rim = mesh(ctx, planeGeo(ctx), mat(ctx, SOUL, 0, { map: runeTex(ctx) }));
  const glow = mesh(ctx, planeGeo(ctx), mat(ctx, SOUL, 0, { map: glowTex(ctx) }));
  flat(rim); flat(glow);
  rim.scale.set(R * 2.2, R * 2.2, 1); glow.scale.set(R * 3.2, R * 3.2, 1);
  rim.position.y = 4; glow.position.y = 3;
  root.add(glow, rim, lamp);
  place(ctx, root, x, y, 0);
  let emit = 0;
  return launch(ctx, root, {
    duration: dur, tag: 'thresh_lantern',
    update: (t, dt, age) => {
      if (z && z.dead) return false;
      root.visible = seen(ctx, x, y, team);
      const k = Math.min(1, age / 0.25);
      lamp.position.y = 70 + Math.sin(age * 2.2) * 10;
      lamp.rotation.set(Math.sin(age * 1.7) * 0.12, age * 0.8, Math.cos(age * 1.3) * 0.1);
      lamp.userData.core.material.opacity = 0.8 + 0.2 * Math.sin(age * 9);
      lamp.userData.halo.scale.setScalar(240 * (1 + 0.1 * Math.sin(age * 4)));
      rim.material.opacity = 0.7 * k; rim.rotation.z = age * 0.7;
      glow.material.opacity = 0.3 * k * (0.8 + 0.2 * Math.sin(age * 3));
      emit -= dt;
      if (emit <= 0 && root.visible) {
        emit = low(ctx) ? 0.35 : 0.15;
        burst(ctx, { x, y, h: 60, count: 2, color: SOUL, color2: PALE, speed: 30, size: 22, life: 1, up: 3, drag: 0.5, radius: 30, vis: true });
      }
      return undefined;
    },
  });
}
function lanternLand(ctx, p) {
  if (!Number.isFinite(p.x)) return NOOP;
  const team = p.unit?.team ?? null;
  flash(ctx, { x: p.x, y: p.y, h: 70, color: SOUL, size: 300, duration: 0.35, team });
  ring(ctx, { x: p.x, y: p.y, radius: 220, color: SOUL, duration: 0.5, team });
  burst(ctx, { x: p.x, y: p.y, h: 60, count: 14, color: SOUL, color2: PALE, speed: 240, size: 24, life: 0.5, team });
  return NOOP;
}
// 友方被灯笼拉回锤石身边：幽绿拖尾 + 光束连线
function lanternPull(ctx, p) {
  const a = p.unit || p.to, th = p.target || p.from;
  if (!a) return NOOP;
  const T = ctx.THREE;
  const dur = Math.max(0.2, p.duration || 0.5);
  unitTrail(ctx, a, { color: SOUL, color2: DEEP, width: 100, seg: 26, max: 16, duration: dur, fade: 0.35 });
  const lamp = lanternModel(ctx, 1);
  const root = new T.Group();
  root.add(lamp);
  const pa = {}, pb = {};
  return launch(ctx, root, {
    duration: dur + 0.1, tag: 'thresh_lantern_pull',
    update: (t, dt, age) => {
      if (!alive(a)) return false;
      root.visible = shown(ctx, a);
      chestPos(ctx, a, pa);
      lamp.position.set(pa.x, pa.y + 30, pa.z);
      lamp.userData.body.rotation.y = age * 8;
      if (th && alive(th) && age > dur * 0.9) {
        handPos(ctx, th, pb);
        lamp.position.lerp(pb, clamp01((age - dur * 0.9) / 0.1));
      }
    },
    onEnd: () => {
      const q = upos(ctx, a);
      flash(ctx, { x: q.x, y: q.y, h: 90, color: SOUL, size: 240, duration: 0.3, team: a.team });
    },
  });
}
function lanternReturn(ctx, p) {
  if (!Number.isFinite(p.x)) return NOOP;
  const team = p.unit?.team ?? null;
  flash(ctx, { x: p.x, y: p.y, h: 80, color: SOUL, size: 220, duration: 0.3, team });
  burst(ctx, { x: p.x, y: p.y, h: 70, count: 12, color: SOUL, color2: DEEP, speed: 120, size: 26, life: 0.8, up: 1.8, team });
  return NOOP;
}

// —— 被动：地狱诅咒 灵魂（仅锤石方可见） ——
function soul(ctx, p) {
  const z = p.zone || null;
  const team = p.teamOnly ?? z?.team ?? null;
  if (teamOnlyHidden(ctx, team)) return NOOP;
  const T = ctx.THREE;
  const x = p.x ?? z?.x, y = p.y ?? z?.y;
  if (!Number.isFinite(x)) return NOOP;
  const dur = (p.duration || 15) + 1;
  const root = new T.Group();
  const halo = sprite(ctx, SOUL, 110, 0.5);
  const core = sprite(ctx, PALE, 40, 0.95);
  const tail = sprite(ctx, DARK, 70, 0.6);
  const ground = mesh(ctx, planeGeo(ctx), mat(ctx, SOUL, 0.3, { map: glowTex(ctx) }));
  flat(ground); ground.scale.set(110, 110, 1); ground.position.y = 3;
  root.add(ground, halo, tail, core);
  place(ctx, root, x, y, 0);
  const seed = rnd(0, 10);
  return launch(ctx, root, {
    duration: dur, tag: 'thresh_soul',
    update: (t, dt, age) => {
      if (z && z.dead) return false;
      const k = Math.min(1, age / 0.4);
      const hh = 55 + Math.sin(age * 2.4 + seed) * 12;
      halo.position.y = core.position.y = hh; tail.position.y = hh - 18;
      const f = 1 + 0.15 * Math.sin(age * 13 + seed);
      halo.scale.setScalar(110 * f); core.scale.setScalar(40 * (2 - f));
      halo.material.opacity = 0.5 * k; core.material.opacity = 0.95 * k; tail.material.opacity = 0.5 * k;
      ground.material.opacity = 0.25 * k;
      return undefined;
    },
  });
}
// 灵魂被收集：幽绿灵火飞入锤石
function soulCollect(ctx, p) {
  const u = p.unit;
  if (!u || !Number.isFinite(p.x)) return NOOP;
  if (teamOnlyHidden(ctx, u.team)) return NOOP;
  const T = ctx.THREE;
  const sx = p.x, sy = p.y;
  const orb = new T.Group();
  const halo = sprite(ctx, SOUL, 100, 0.7);
  const core = sprite(ctx, PALE, 36, 1);
  orb.add(halo, core);
  const head = { x: sx, y: sy, h: 0, vis: true };
  let on = true;
  trail(ctx, { color: SOUL, color2: DEEP, width: 30, seg: 16, max: 12, fade: 0.25, maxLife: 2, head: () => (on ? head : null) });
  const dur = 0.5;
  const tp = {};
  return launch(ctx, orb, {
    duration: dur, tag: 'thresh_soul_collect',
    update: (t, dt, age) => {
      if (!alive(u)) { on = false; return false; }
      chestPos(ctx, u, tp);
      const k = easeOut3(t);
      const gx = sx + (tp.x - sx) * k, gy = sy + (-tp.z - sy) * k;
      const hh = gh(ctx, sx, sy) + 55 + (tp.y - gh(ctx, sx, sy) - 55) * k + Math.sin(k * Math.PI) * 120;
      orb.position.set(gx, hh, -gy);
      head.x = gx; head.y = gy; head.h = hh;
      return undefined;
    },
    onEnd: () => {
      on = false;
      if (alive(u)) {
        flash(ctx, { follow: u, h: unitH(ctx, u, 0.5), color: SOUL, size: 200, duration: 0.3 });
        ring(ctx, { follow: u, radius: 90, color: SOUL, duration: 0.35 });
      }
    },
  });
}

// —— E：厄运钟摆（锁链由身后横扫到身前） ——
function eFlay(ctx, p) {
  const u = p.unit;
  const T = ctx.THREE;
  const x = p.x ?? u?.x, y = p.y ?? u?.y;
  if (!Number.isFinite(x)) return NOOP;
  const dx = p.dirX ?? 1, dy = p.dirY ?? 0, yaw = Math.atan2(dy, dx);
  const L = p.halfLength || 537, W = p.width || 110;
  const dur = p.duration || 0.45;
  const team = u?.team ?? null;
  const root = new T.Group();
  const streak = mesh(ctx, planeGeo(ctx), mat(ctx, SOUL, 0, { map: streakTex(ctx) }));
  const core = mesh(ctx, planeGeo(ctx), mat(ctx, PALE, 0, { map: streakTex(ctx) }));
  flat(streak, yaw); flat(core, yaw);
  streak.position.y = 12; core.position.y = 14;
  const AH = Math.PI / 3;
  const arcG = geo(ctx, 'thresh_flay_arc', (TT) => sectorGeo(TT, 0.55, 1, AH, 32, { sweep: true }));
  const arc = mesh(ctx, arcG, mat(ctx, SOUL, 0, { vc: true }));
  arc.position.y = 16;
  const chain = makeChain(ctx, 30, { size: 8 });
  root.add(streak, core, arc, chain);
  place(ctx, root, x, y, 0);
  root.visible = seen(ctx, x, y, team);
  burst(ctx, { x: x + dx * L * 0.5, y: y + dy * L * 0.5, h: 30, count: 14, color: 0x6a7a70, speed: 200, size: 60, life: 0.7, up: 0.3, radius: L * 0.4, additive: false, opacity: 0.4, team });
  burst(ctx, { x: x + dx * L * 0.6, y: y + dy * L * 0.6, h: 60, count: 22, color: SOUL, color2: PALE, speed: 280, size: 24, life: 0.45, dir: yaw, arc: 0.8, radius: 60, team });
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
  return launch(ctx, root, {
    duration: dur, tag: 'thresh_e_flay',
    update: (t, dt, age) => {
      const sweep = easeOut3(Math.min(1, age / (dur * 0.55)));
      // 光带：从身后 (-L) 扫到身前 (+L)
      const back = -L, front = -L + 2 * L * sweep;
      const len = Math.max(1, front - back), mid = (front + back) / 2;
      const k = env(age, dur, 0.03, 0.25);
      for (const m of [streak, core]) {
        m.position.x = Math.cos(yaw) * mid; m.position.z = -Math.sin(yaw) * mid;
        m.scale.set(len, m === core ? W * 0.5 : W * 1.6, 1);
      }
      streak.material.opacity = 0.8 * k; core.material.opacity = 0.9 * k;
      // 锁链弧：绕锤石从身后甩到身前
      const ang = yaw + Math.PI - Math.PI * sweep;
      // y 轴镜像后亮边在前缘（ang），尾迹拖向来时方向
      flat(arc, ang + AH);
      arc.scale.set(L * 0.55, -L * 0.55, 1);
      arc.material.opacity = 0.55 * k;
      a.x = 0; a.y = 90; a.z = 0;
      b.x = Math.cos(ang) * L * 0.55; b.y = 40; b.z = -Math.sin(ang) * L * 0.55;
      chain.userData.set(a, b, 16, k);
    },
    onEnd: () => chain.userData.dispose(),
  });
}

// —— R：幽冥监牢 ——
function wallTex(ctx) {
  return customTex(ctx, 'thresh_wall', 128, (g, S) => {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, 0, S, S);
    // 竖向光纹（伪随机，固定种子）
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 26; i++) {
      const x = r() * S, w = 2 + r() * 6, h0 = S * (0.3 + r() * 0.7);
      const gr = g.createLinearGradient(0, S, 0, S - h0);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x, S - h0, w, h0);
    }
  });
}
const wallGeo = (ctx) => geo(ctx, 'thresh_wall_geo', (T) => {
  const g = new T.PlaneGeometry(1, 1, 1, 4);
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const v = Math.pow(1 - pos.getY(i), 1.3); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  return g;
});
function rCast(ctx, p) {
  const u = p.unit;
  const x = p.x ?? u?.x, y = p.y ?? u?.y;
  if (!Number.isFinite(x)) return NOOP;
  const R = p.radius || 450, dur = p.duration || 0.75;
  const team = u?.team ?? null;
  decal(ctx, { x, y, radius: R, color: SOUL, opacity: 0.75, duration: dur + 0.2, spin: -1.5, map: runeTex(ctx), grow: [0.2, 1], team });
  decal(ctx, { x, y, radius: R * 0.9, color: DARK, opacity: 0.5, duration: dur + 0.2, map: glowTex(ctx), team });
  if (u) converge(ctx, { follow: u, h: unitH(ctx, u, 0.6), radius: 320, count: 24, color: SOUL, color2: PALE, size: 28, duration: dur, spin: -3 });
  pillar(ctx, { x, y, radius: 70, height: 500, color: SOUL, opacity: 0.5, duration: dur, fin: 0.3, team });
  return NOOP;
}
const BOXES = new WeakMap();
function rBox(ctx, p) {
  const T = ctx.THREE;
  const verts = Array.isArray(p.verts) ? p.verts : null;
  if (!verts || verts.length < 3) return NOOP;
  const broken = Array.isArray(p.broken) ? p.broken : null;
  const x = p.x, y = p.y, R = p.radius || 450;
  const dur = (p.duration || 5) + 0.6;
  const team = p.unit?.team ?? null;
  const n = verts.length;
  const WH = 280;
  const root = new T.Group();
  const walls = [];
  const wg = wallGeo(ctx), tex = wallTex(ctx);
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const yaw = Math.atan2(b.y - a.y, b.x - a.x);
    const g = new T.Group();
    place(ctx, g, mx, my, 0);
    g.rotation.y = yaw;
    const face = mesh(ctx, wg, mat(ctx, SOUL, 0, { vc: true, map: tex }));
    face.scale.set(len, WH, 1);
    const veil = mesh(ctx, wg, mat(ctx, PALE, 0, { vc: true }));
    veil.scale.set(len, WH * 0.6, 1);
    const base = mesh(ctx, planeGeo(ctx), mat(ctx, SOUL, 0, { map: glowTex(ctx) }));
    base.rotation.x = -Math.PI / 2;
    base.scale.set(len * 1.1, 90, 1);
    base.position.y = 4;
    g.add(base, face, veil);
    root.add(g);
    walls.push({ g, face, veil, base, fade: 0, mx, my, len, seed: i * 1.3 });
  }
  const posts = verts.map((v) => { const s = sprite(ctx, PALE, 120, 0); place(ctx, s, v.x, v.y, 60); root.add(s); return s; });
  const floor = mesh(ctx, planeGeo(ctx), mat(ctx, SOUL, 0, { map: runeTex(ctx) }));
  flat(floor); place(ctx, floor, x, y, 5); floor.scale.set(R * 2, R * 2, 1);
  root.add(floor);
  for (const w of walls) burst(ctx, { x: w.mx, y: w.my, h: 40, count: 10, color: SOUL, color2: PALE, speed: 120, size: 30, life: 0.7, up: 2.5, radius: w.len * 0.35, team });
  shake(ctx, x, y, 10, 0.25);
  let ending = -1, emit = 0, forceEnd = false;
  const h = launch(ctx, root, {
    duration: dur + 0.6, tag: 'thresh_r_box',
    update: (t, dt, age) => {
      root.visible = seen(ctx, x, y, team);
      if (ending < 0 && (forceEnd || age >= dur - 0.4)) ending = age;
      const endK = ending < 0 ? 1 : 1 - (age - ending) / 0.4;
      if (endK <= 0) return false;
      const inK = Math.min(1, age / 0.25);
      for (let i = 0; i < n; i++) {
        const w = walls[i];
        const isBroken = broken ? !!broken[i] : false;
        w.fade = isBroken ? Math.max(0, w.fade - dt / 0.3) : Math.min(1, age / 0.25);
        const k = w.fade * endK;
        w.g.visible = k > 0.01;
        if (!w.g.visible) continue;
        const rise = easeOut3(inK);
        const fl = 0.85 + 0.15 * Math.sin(age * 7 + w.seed);
        w.face.scale.y = WH * rise * (0.95 + 0.05 * Math.sin(age * 5 + w.seed));
        w.face.material.opacity = 0.8 * k * fl;
        w.veil.scale.y = WH * 0.6 * rise * (0.8 + 0.3 * Math.abs(Math.sin(age * 3 + w.seed)));
        w.veil.material.opacity = 0.35 * k;
        w.base.material.opacity = 0.6 * k;
      }
      for (let i = 0; i < n; i++) {
        const on = broken ? !(broken[i] && broken[(i + n - 1) % n]) : true;
        posts[i].material.opacity = (on ? 0.8 : 0.2) * endK * inK * (0.8 + 0.2 * Math.sin(age * 9 + i));
      }
      floor.material.opacity = 0.35 * endK * inK;
      floor.rotation.z = age * 0.25;
      emit -= dt;
      if (emit <= 0 && root.visible && !low(ctx)) {
        emit = 0.1;
        const i = Math.floor(Math.random() * n);
        const w = walls[i];
        if (w.fade > 0.5) {
          const a = verts[i], b = verts[(i + 1) % n], k = Math.random();
          burst(ctx, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: 20, count: 3, color: SOUL, color2: PALE, speed: 30, size: 26, life: 0.9, up: 4, drag: 0.4, vis: true });
        }
      }
      return undefined;
    },
    onEnd: () => { if (broken) BOXES.delete(broken); },
  });
  // thresh_r_end 通过同一个 broken 数组引用找到本特效并开始淡出
  if (broken) BOXES.set(broken, { end: () => { forceEnd = true; } });
  return h;
}
function rWallBreak(ctx, p) {
  if (!Number.isFinite(p.x)) return NOOP;
  const x1 = p.x1 ?? p.x, y1 = p.y1 ?? p.y, x2 = p.x2 ?? p.x, y2 = p.y2 ?? p.y;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const team = p.unit?.team ?? null;
  for (let i = 0; i < 3; i++) {
    const k = (i + 0.5) / 3;
    burst(ctx, { x: x1 + (x2 - x1) * k, y: y1 + (y2 - y1) * k, h: 120, count: 10, color: SOUL, color2: PALE, speed: 360, size: 30, life: 0.55, up: 0.6, gravity: 500, radius: len * 0.12, map: starTex(ctx), team });
  }
  flash(ctx, { x: p.x, y: p.y, h: 130, color: SOUL, size: Math.max(300, len * 1.2), duration: 0.35, team });
  pillar(ctx, { x: p.x, y: p.y, radius: 60, height: 420, color: PALE, opacity: 0.6, duration: 0.3, team });
  if (p.unit) ring(ctx, { follow: p.unit, radius: 120, color: SOUL, duration: 0.4 });
  return NOOP;
}
function rEnd(ctx, p) {
  const box = p.broken ? BOXES.get(p.broken) : null;
  if (box) box.end();
  if (Number.isFinite(p.x)) burst(ctx, { x: p.x, y: p.y, h: 60, count: 18, color: SOUL, color2: DARK, speed: 200, size: 30, life: 0.8, up: 1.5, radius: (p.radius || 450) * 0.8 });
  return NOOP;
}

// —— 普攻：灵火镰光 ——
function aa(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 0.8;
  const root = new T.Group();
  const halo = sprite(ctx, SOUL, 110 * size, 0.6);
  const star = sprite(ctx, PALE, 80 * size, 0.9, starTex(ctx));
  const core = sprite(ctx, 0xffffff, 30 * size, 1);
  root.add(halo, star, core);
  return projView(ctx, p, root, {
    tag: 'thresh_aa', face: false,
    trail: { color: SOUL, color2: DEEP, width: 34 * size, seg: 18, max: 10, fade: 0.2, skipLow: true },
    update: (dt, proj, cur, age) => { star.material.rotation = age * 10; },
  });
}

export default function register(fx) {
  const r = registrar(fx, 'thresh');
  r.proj('thresh_hook', hookProj);
  r.proj('thresh_lantern_throw', lanternThrow);
  r.proj('thresh_aa', aa);
  r.on('thresh_q_windup', qWindup);
  r.on('thresh_q_chain', qChain);
  r.on('thresh_q_miss', qMiss);
  r.on('thresh_q_leap', qLeap);
  r.on('thresh_q_leap_land', qLeapLand);
  r.on('thresh_lantern', lantern);
  r.on('thresh_lantern_land', lanternLand);
  r.on('thresh_lantern_pull', lanternPull);
  r.on('thresh_lantern_return', lanternReturn);
  r.on('thresh_soul', soul);
  r.on('thresh_soul_collect', soulCollect);
  r.on('thresh_e_flay', eFlay);
  r.on('thresh_r_cast', rCast);
  r.on('thresh_r_box', rBox);
  r.on('thresh_r_wall_break', rWallBreak);
  r.on('thresh_r_end', rEnd);
}
