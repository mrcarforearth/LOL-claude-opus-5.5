// 德莱厄斯专属特效：大杀四方（蓄力血环/横扫斧弧）、致残打击、无情铁手（扇形斧钩拉拽）、诺克萨斯断头台（巨斧虚影落下）、出血、诺克萨斯之力
const NOOP = Object.freeze({ remove() {}, alive: false, object3d: null });
const TAU = Math.PI * 2;

const BLOOD = 0xa3120e;
const RED = 0xff3a22;
const EMBER = 0xff7a3a;
const DARK = 0x5a0604;
const STEEL = 0xd8d0c8;

// —— 小工具（只依赖 FXContext 契约成员） ——
let GLOW = null;
function glowTex(ctx) {
  if (ctx.textures?.glow) return ctx.textures.glow;
  if (GLOW) return GLOW;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  GLOW = new ctx.THREE.CanvasTexture(cv);
  return GLOW;
}
const GEO = new Map();
function geo(ctx, key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(ctx.THREE); GEO.set(key, g); }
  return g;
}
function mat(ctx, color, opacity = 1, { additive = true, vc = false, map = null } = {}) {
  const T = ctx.THREE;
  return new T.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: T.DoubleSide, vertexColors: vc, map,
    blending: additive ? T.AdditiveBlending : T.NormalBlending, toneMapped: false,
  });
}
function spriteMat(ctx, color, opacity = 1) {
  const T = ctx.THREE;
  return new T.SpriteMaterial({ map: glowTex(ctx), color, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
}
function groundAt(ctx, x, y) {
  try { const h = ctx.heightAt?.(x, y); return Number.isFinite(h) ? h : 0; } catch { return 0; }
}
function place(ctx, obj, x, y, h = 0) {
  const v = ctx.toScene(x, y, groundAt(ctx, x, y) + h);
  obj.position.set(v.x, v.y, v.z);
}
// 贴地：局部 XY 平面 = 游戏平面 (x, y)，局部 z 旋转 = 游戏角度
function flat(mesh, a = 0) { mesh.rotation.set(-Math.PI / 2, 0, a); return mesh; }
function unitH(ctx, u, f = 1) { const h = Number(ctx.unitHeight?.(u)); return (h > 0 ? h : 200) * f; }
function launch(ctx, obj, opts = {}) {
  const mats = [];
  obj.traverse((o) => { if (o.material) mats.push(o.material); });
  const onEnd = opts.onEnd;
  const h = ctx.add(obj, { ...opts, onEnd: () => { for (const m of mats) m.dispose?.(); if (onEnd) onEnd(); } });
  return h || NOOP;
}
const safeDt = (dt) => (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 1 / 60);
// 弧带：顶点色从尾部 0 渐变到头部 1（叠加混合下形成拖尾）
function arcBand(T, r0, r1, theta, segs = 64, power = 1.6) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs, a = k * theta;
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r0, s * r0, 0, c * r1, s * r1, 0);
    const v = Math.pow(k, power);
    col.push(v * 0.55, v * 0.55, v * 0.55, v, v, v);
    if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
// 竖直光柱：底部亮、顶部透明
function pillarGeo(T, r, height, segs = 24) {
  const g = new T.CylinderGeometry(r * 0.75, r, height, segs, 4, true);
  g.translate(0, height / 2, 0);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = Math.pow(1 - p.getY(i) / height, 1.6); col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v; }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  return g;
}
// 粒子爆发（Points，一次绘制）
function burst(ctx, o = {}) {
  const T = ctx.THREE;
  const {
    x, y, h = 80, count = 20, color = 0xffffff, color2 = null, speed = 300, size = 30, life = 0.6,
    gravity = 0, drag = 1.5, up = 0.4, radius = 0, dir = null, arc = TAU, additive = true, rise = 0,
  } = o;
  const n = Math.max(1, Math.floor(count));
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), col = new Float32Array(n * 3), base = new Float32Array(n * 3), lk = new Float32Array(n);
  const c1 = new T.Color(color), c2 = new T.Color(color2 ?? color);
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const a = dir == null ? Math.random() * TAU : dir + (Math.random() - 0.5) * arc;
    const pa = Math.random() * TAU, r = radius * Math.sqrt(Math.random());
    pos[j] = Math.cos(pa) * r; pos[j + 1] = Math.random() * rise; pos[j + 2] = -Math.sin(pa) * r;
    const sp = speed * (0.35 + 0.65 * Math.random());
    vel[j] = Math.cos(a) * sp; vel[j + 1] = sp * up * (0.6 + 0.8 * Math.random()); vel[j + 2] = -Math.sin(a) * sp;
    const m = Math.random();
    base[j] = c1.r + (c2.r - c1.r) * m; base[j + 1] = c1.g + (c2.g - c1.g) * m; base[j + 2] = c1.b + (c2.b - c1.b) * m;
    col[j] = base[j]; col[j + 1] = base[j + 1]; col[j + 2] = base[j + 2];
    lk[i] = 0.55 + 0.45 * Math.random();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  const m = new T.PointsMaterial({
    size, map: glowTex(ctx), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, toneMapped: false,
    blending: additive ? T.AdditiveBlending : T.NormalBlending,
  });
  const pts = new T.Points(g, m);
  pts.frustumCulled = false;
  place(ctx, pts, x, y, h);
  return launch(ctx, pts, {
    duration: life,
    update: (t, dt) => {
      dt = safeDt(dt);
      const d = Math.max(0, 1 - drag * dt);
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        vel[j + 1] -= gravity * dt;
        vel[j] *= d; vel[j + 1] *= d; vel[j + 2] *= d;
        pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
        if (pos[j + 1] < -h + 2) { pos[j + 1] = -h + 2; vel[j + 1] = 0; }
        const k = additive ? Math.max(0, 1 - t / lk[i]) : 1;
        col[j] = base[j] * k; col[j + 1] = base[j + 1] * k; col[j + 2] = base[j + 2] * k;
      }
      if (!additive) m.opacity = Math.max(0, 1 - t * t);
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    },
    onEnd: () => g.dispose(),
  });
}
// 地面扩散环
function shockRing(ctx, { x, y, r0 = 50, r1 = 300, width = 22, color = RED, life = 0.4, opacity = 0.9, h = 4 }) {
  const T = ctx.THREE;
  const mesh = flat(new T.Mesh(geo(ctx, 'unitRing', (TT) => new TT.RingGeometry(0.9, 1, 96, 1)), mat(ctx, color, opacity)));
  place(ctx, mesh, x, y, h);
  return launch(ctx, mesh, {
    duration: life,
    update: (t) => {
      const e = 1 - Math.pow(1 - t, 3);
      const r = r0 + (r1 - r0) * e;
      const s = Math.max(1, r);
      mesh.scale.set(s, s, 1);
      // 保持环宽：内半径比例随半径调整
      const k = Math.max(0.5, 1 - width / s);
      mesh.scale.set(s, s, 1);
      mesh.material.opacity = opacity * (1 - t) * (k > 0 ? 1 : 0);
    },
  });
}
function cameraNear(ctx, x, y, d = 1800) {
  const t = ctx.renderer?.cameraCtl?.target;
  return !t || Math.hypot(t.x - x, t.y - y) < d;
}

// —— Q 蓄力：斧刃范围血环逐渐亮起 ——
function qWindup(ctx, p) {
  const T = ctx.THREE;
  const u = p.unit;
  if (!u) return NOOP;
  const inner = p.inner || 205, outer = p.outer || 425, dur = p.duration || 0.75;
  const root = new T.Group();
  const band = flat(new T.Mesh(geo(ctx, `dq_band_${inner}_${outer}`, (TT) => new TT.RingGeometry(inner, outer, 96, 1)), mat(ctx, DARK, 0)));
  const edge = flat(new T.Mesh(geo(ctx, `dq_edge_${outer}`, (TT) => new TT.RingGeometry(outer - 16, outer, 128, 1)), mat(ctx, RED, 0)));
  const inEdge = flat(new T.Mesh(geo(ctx, `dq_in_${inner}`, (TT) => new TT.RingGeometry(inner - 5, inner + 3, 96, 1)), mat(ctx, EMBER, 0)));
  const sweep = flat(new T.Mesh(geo(ctx, `dq_sw_${inner}_${outer}`, (TT) => arcBand(TT, inner + 20, outer - 10, Math.PI * 0.7, 48, 2.2)), mat(ctx, 0xff5030, 0, { vc: true })));
  band.position.y = 1; edge.position.y = 2; inEdge.position.y = 2; sweep.position.y = 3;
  root.add(band, edge, inEdge, sweep);
  let emitAt = 0;
  return launch(ctx, root, {
    duration: dur + 0.05,
    update: (t, dt, age) => {
      if (!u.alive || (t < 0.9 && u.modelState && !u.modelState.axeSpin)) return false;
      place(ctx, root, u.x, u.y, 2);
      const pulse = 0.75 + 0.25 * Math.sin((age ?? t * dur) * 28);
      band.material.opacity = 0.1 + 0.28 * t;
      edge.material.opacity = (0.35 + 0.6 * t) * pulse;
      inEdge.material.opacity = 0.35 * t;
      sweep.rotation.z = (u.facing || 0) + Math.PI * 0.6 + t * Math.PI * 0.9;
      sweep.material.opacity = 0.7 * t;
      const a = age ?? t * dur;
      if (a >= emitAt) {
        emitAt = a + 0.09;
        const ang = Math.random() * TAU;
        const r = inner + (outer - inner) * Math.random();
        burst(ctx, { x: u.x + Math.cos(ang) * r, y: u.y + Math.sin(ang) * r, h: 10, count: 4, color: EMBER, color2: RED, speed: 60, up: 1.6, size: 26, life: 0.45, drag: 1 });
      }
    },
  });
}

// —— Q 横扫：一圈血红斧弧 + 斧刃高度的亮弧 + 血雾 ——
function qSwing(ctx, p) {
  const T = ctx.THREE;
  const u = p.unit;
  const x = p.x ?? u?.x, y = p.y ?? u?.y;
  if (x == null) return NOOP;
  const inner = p.inner || 205, outer = p.outer || 425;
  const root = new T.Group();
  const bandG = geo(ctx, `dq_swing_${inner}_${outer}`, (TT) => arcBand(TT, inner - 10, outer + 5, Math.PI * 1.7, 96, 1.8));
  const airG = geo(ctx, `dq_air_${outer}`, (TT) => arcBand(TT, outer - 95, outer + 15, Math.PI * 1.2, 96, 2.4));
  const band = flat(new T.Mesh(bandG, mat(ctx, 0xff2a18, 1, { vc: true })));
  const air = flat(new T.Mesh(airG, mat(ctx, 0xffc8a8, 1, { vc: true })));
  const floor = flat(new T.Mesh(geo(ctx, `dq_band_${inner}_${outer}`, (TT) => new TT.RingGeometry(inner, outer, 96, 1)), mat(ctx, 0x2a0000, 0.45, { additive: false })));
  band.position.y = 3; floor.position.y = 1;
  air.position.y = 105;
  root.add(floor, band, air);
  place(ctx, root, x, y, 0);
  const a0 = (u?.facing || 0) - Math.PI * 0.4;
  const SWEEP = 0.24;
  shockRing(ctx, { x, y, r0: outer - 30, r1: outer + 70, width: 26, color: RED, life: 0.45, opacity: 0.8 });
  for (let i = 0; i < 10; i++) {
    const a = a0 + (i / 10) * TAU;
    burst(ctx, {
      x: x + Math.cos(a) * (outer - 40), y: y + Math.sin(a) * (outer - 40), h: 90, count: 7, color: BLOOD, color2: 0x5a0000,
      speed: 320, dir: a + Math.PI / 2, arc: 1.2, up: 0.5, gravity: 1100, drag: 1.2, size: 34, life: 0.7, additive: false,
    });
  }
  if (p.heal) burst(ctx, { x, y, h: 60, count: 26, color: 0xff4a3a, color2: 0xffa080, speed: 90, up: 2.2, radius: 60, size: 30, life: 0.9, drag: 0.8 });
  return launch(ctx, root, {
    duration: 0.62,
    update: (t, dt, age) => {
      const a = age ?? t * 0.62;
      const k = Math.min(1, a / SWEEP);
      const e = 1 - Math.pow(1 - k, 2);
      band.rotation.z = a0 + e * TAU * 1.05;
      air.rotation.z = a0 + e * TAU * 1.05 + 0.15;
      const fade = a < SWEEP ? 1 : Math.max(0, 1 - (a - SWEEP) / (0.62 - SWEEP));
      band.material.opacity = fade;
      air.material.opacity = fade * 0.9;
      floor.material.opacity = 0.4 * fade;
    },
  });
}

// —— W：交叉斧痕 ——
function wStrike(ctx, p) {
  const T = ctx.THREE;
  const t0 = p.target, u = p.unit;
  const x = p.x ?? t0?.x, y = p.y ?? t0?.y;
  if (x == null) return NOOP;
  const dir = u ? Math.atan2(y - u.y, x - u.x) : 0;
  const root = new T.Group();
  const slashG = geo(ctx, 'dw_slash', (TT) => arcBand(TT, 70, 92, Math.PI * 0.9, 32, 1.2));
  for (const s of [-1, 1]) {
    const m = flat(new T.Mesh(slashG, mat(ctx, s > 0 ? 0xff5a2a : 0xffb070, 1, { vc: true })), dir + s * 0.7 - Math.PI * 0.45);
    m.position.set(-Math.cos(dir) * 20, 0, Math.sin(dir) * 20);
    root.add(m);
  }
  place(ctx, root, x, y, t0 ? unitH(ctx, t0, 0.5) : 100);
  burst(ctx, { x, y, h: t0 ? unitH(ctx, t0, 0.5) : 100, count: 16, color: 0xffd0a0, color2: EMBER, speed: 420, dir, arc: 1.6, up: 0.3, size: 22, life: 0.35, drag: 3 });
  burst(ctx, { x, y, h: 70, count: 8, color: BLOOD, speed: 200, up: 0.8, gravity: 1000, size: 28, life: 0.6, additive: false });
  if (p.killed) burst(ctx, { x, y, h: 90, count: 22, color: 0xffd060, color2: 0xff7a2a, speed: 260, up: 1.2, size: 34, life: 0.7 });
  return launch(ctx, root, {
    duration: 0.32,
    update: (t) => {
      const s = 0.7 + 0.5 * Math.min(1, t * 4);
      root.scale.set(s, s, s);
      root.children.forEach((c) => { c.material.opacity = 1 - t; });
    },
  });
}

// —— E：扇形斧钩 + 拉拽锁链 ——
function eGrab(ctx, p) {
  const T = ctx.THREE;
  const u = p.unit;
  const x = p.x ?? u?.x, y = p.y ?? u?.y;
  if (x == null) return NOOP;
  const range = p.range || 535, angle = ((p.angle || 50) * Math.PI) / 180;
  const dir = Math.atan2(p.dirY ?? 0, p.dirX ?? 1);
  const root = new T.Group();
  const cone = flat(new T.Mesh(geo(ctx, `de_cone_${range}_${angle.toFixed(3)}`, (TT) => new TT.CircleGeometry(range, 40, -angle / 2, angle)), mat(ctx, 0x8a1810, 0.35)), dir);
  const rim = flat(new T.Mesh(geo(ctx, `de_rim_${range}_${angle.toFixed(3)}`, (TT) => new TT.RingGeometry(range - 18, range, 48, 1, -angle / 2, angle)), mat(ctx, RED, 0.9)), dir);
  const sweep = flat(new T.Mesh(geo(ctx, `de_sw_${range}`, (TT) => arcBand(TT, 60, range, angle, 24, 1)), mat(ctx, 0xff6a40, 0.8, { vc: true })), dir - angle / 2);
  cone.position.y = 2; rim.position.y = 3; sweep.position.y = 4;
  root.add(cone, rim, sweep);
  place(ctx, root, x, y, 0);
  // 锁链：从德莱厄斯到每个被拉的目标
  const chains = [];
  const chainG = geo(ctx, 'de_chain', (TT) => new TT.PlaneGeometry(1, 1));
  for (const t of p.targets || []) {
    const c = new T.Mesh(chainG, mat(ctx, STEEL, 0.95));
    const glow = new T.Mesh(chainG, mat(ctx, RED, 0.6));
    const claw = new T.Sprite(spriteMat(ctx, 0xff5a3a, 0.9));
    claw.scale.set(90, 90, 1);
    const g = new T.Group();
    g.add(glow, c, claw);
    root.parent ? null : null;
    chains.push({ t, g, c, glow, claw });
  }
  const chainRoot = new T.Group();
  for (const ch of chains) chainRoot.add(ch.g);
  root.add(chainRoot);
  return launch(ctx, root, {
    duration: 0.5,
    update: (t) => {
      cone.material.opacity = 0.35 * (1 - t);
      rim.material.opacity = 0.9 * (1 - t);
      sweep.material.opacity = 0.8 * Math.max(0, 1 - t * 2.2);
      const ox = u ? u.x : x, oy = u ? u.y : y;
      // chainRoot 与 root 同原点：用相对坐标
      for (const ch of chains) {
        const dx = ch.t.x - x, dy = ch.t.y - y;
        const sx = ox - x, sy = oy - y;
        const L = Math.hypot(dx - sx, dy - sy);
        const a = Math.atan2(dy - sy, dx - sx);
        const h = 70;
        const mx = (sx + dx) / 2, my = (sy + dy) / 2;
        for (const [m, w] of [[ch.c, 10], [ch.glow, 30]]) {
          m.position.set(mx, h, -my);
          m.rotation.set(-Math.PI / 2, 0, a);
          m.scale.set(Math.max(1, L), w, 1);
          m.material.opacity = (m === ch.c ? 0.95 : 0.55) * (1 - t);
        }
        ch.claw.position.set(dx, h + 10, -dy);
        ch.claw.material.opacity = 0.9 * (1 - t);
      }
    },
  });
}

// —— R 跃起：目标头顶的断头台标记 ——
function rLeap(ctx, p) {
  const T = ctx.THREE;
  const u = p.unit, t0 = p.target;
  if (!t0) return NOOP;
  const root = new T.Group();
  const ring = flat(new T.Mesh(geo(ctx, 'dr_mark', (TT) => new TT.RingGeometry(95, 120, 64, 1)), mat(ctx, RED, 0.9)));
  const inner = flat(new T.Mesh(geo(ctx, 'dr_mark_in', (TT) => new TT.CircleGeometry(95, 48)), mat(ctx, DARK, 0.4, { additive: false })));
  const beam = new T.Mesh(geo(ctx, 'dr_beam', (TT) => pillarGeo(TT, 60, 700)), mat(ctx, 0xff3020, 0.55, { vc: true }));
  ring.position.y = 3; inner.position.y = 2;
  root.add(inner, ring, beam);
  const dur = (p.duration || 0.35) + 0.1;
  let emitAt = 0;
  return launch(ctx, root, {
    duration: dur,
    update: (t, dt, age) => {
      if (!t0.alive) return false;
      place(ctx, root, t0.x, t0.y, 0);
      const s = 1.4 - 0.4 * t;
      ring.scale.set(s, s, 1);
      ring.rotation.z += safeDt(dt) * 6;
      ring.material.opacity = 0.5 + 0.5 * t;
      beam.material.opacity = 0.5 * (1 - t * 0.5);
      beam.scale.set(1 - 0.5 * t, 1, 1 - 0.5 * t);
      const a = age ?? t * dur;
      if (u && a >= emitAt) {
        emitAt = a + 0.04;
        burst(ctx, { x: u.x, y: u.y, h: 90 + (u.z || 0), count: 5, color: EMBER, color2: RED, speed: 80, up: 0.2, size: 36, life: 0.4, drag: 2 });
      }
    },
  });
}

// —— R 落斧：巨斧虚影砸下 + 冲击波 + 击杀血柱 ——
function axeShape(T) {
  const s = new T.Shape();
  // 斧刃（新月形），局部 XY：x 水平，y 向上，斧柄沿 y 轴
  s.moveTo(-18, 250);
  s.lineTo(18, 250);
  s.lineTo(18, 205);
  s.quadraticCurveTo(95, 250, 150, 300);
  s.quadraticCurveTo(170, 200, 150, 95);
  s.quadraticCurveTo(95, 150, 18, 165);
  s.lineTo(18, -60);
  s.lineTo(-18, -60);
  s.lineTo(-18, 165);
  s.quadraticCurveTo(-60, 175, -85, 150);
  s.quadraticCurveTo(-70, 200, -85, 250);
  s.quadraticCurveTo(-55, 215, -18, 205);
  s.lineTo(-18, 250);
  return new T.ShapeGeometry(s, 10);
}
function rImpact(ctx, p) {
  const T = ctx.THREE;
  const x = p.x ?? p.target?.x, y = p.y ?? p.target?.y;
  if (x == null) return NOOP;
  const killed = !!p.killed;
  const root = new T.Group();
  const axeG = geo(ctx, 'dr_axe', axeShape);
  const axe = new T.Mesh(axeG, mat(ctx, killed ? 0xff4a2a : 0xff2a18, 0.95));
  const axeCore = new T.Mesh(axeG, mat(ctx, 0xffd0b0, 0.5));
  axeCore.scale.set(0.8, 0.9, 1);
  axeCore.position.set(0, 12, 1);
  const axeRoot = new T.Group();
  axeRoot.add(axe, axeCore);
  axeRoot.rotation.z = Math.PI; // 斧刃朝下
  axeRoot.scale.set(1.25, 1.25, 1.25);
  const crack = flat(new T.Mesh(geo(ctx, 'dr_crack', (TT) => new TT.CircleGeometry(170, 40)), mat(ctx, 0x180000, 0, { additive: false })));
  crack.position.y = 1.5;
  root.add(crack, axeRoot);
  place(ctx, root, x, y, 0);
  const DROP = 0.12;
  let landed = false;
  let pillar = null;
  if (killed) {
    pillar = new T.Mesh(geo(ctx, 'dr_pillar', (TT) => pillarGeo(TT, 110, 1100)), mat(ctx, 0xff2a18, 0, { vc: true }));
    root.add(pillar);
  }
  return launch(ctx, root, {
    duration: killed ? 1.3 : 0.75,
    update: (t, dt, age) => {
      const a = age ?? t * (killed ? 1.3 : 0.75);
      const k = Math.min(1, a / DROP);
      axeRoot.position.y = 330 + (1 - k * k) * 520;
      if (!landed && k >= 1) {
        landed = true;
        shockRing(ctx, { x, y, r0: 40, r1: 330, width: 30, color: RED, life: 0.45 });
        shockRing(ctx, { x, y, r0: 20, r1: 200, width: 18, color: 0xffc0a0, life: 0.3 });
        burst(ctx, { x, y, h: 60, count: 28, color: BLOOD, color2: 0x4a0000, speed: 460, up: 0.9, gravity: 1300, drag: 1, size: 40, life: 0.9, additive: false });
        burst(ctx, { x, y, h: 40, count: 24, color: 0xffb080, color2: RED, speed: 520, up: 0.15, size: 30, life: 0.45, drag: 3 });
        if (cameraNear(ctx, x, y)) ctx.renderer?.cameraCtl?.shake?.(killed ? 14 : 9, 0.25);
      }
      const after = Math.max(0, a - DROP);
      const fade = landed ? Math.max(0, 1 - after / 0.45) : 1;
      axe.material.opacity = 0.95 * fade;
      axeCore.material.opacity = 0.5 * fade;
      crack.material.opacity = landed ? 0.55 * Math.max(0, 1 - after / 0.9) : 0;
      if (pillar) {
        const pk = landed ? Math.min(1, after / 0.15) * Math.max(0, 1 - Math.max(0, after - 0.4) / 0.75) : 0;
        pillar.material.opacity = 0.8 * pk;
        pillar.scale.set(1 - 0.4 * (after / 1.2), 1, 1 - 0.4 * (after / 1.2));
      }
    },
  });
}

// —— 出血：血滴 ——
function bleed(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const n = p.stacks || 1;
  burst(ctx, { x: u.x, y: u.y, h: unitH(ctx, u, 0.55), count: 2 + n * 2, color: 0xb0140e, color2: 0x5a0000, speed: 110, up: 0.9, gravity: 900, size: 22 + n * 2, life: 0.55, additive: false, radius: 25 });
  if (n >= 5) return shockRing(ctx, { x: u.x, y: u.y, r0: 30, r1: 110, width: 14, color: 0xff2a18, life: 0.35 });
  return NOOP;
}

// —— 诺克萨斯之力：脚下红色战意光环与余烬 ——
function might(ctx, p) {
  const T = ctx.THREE;
  const u = p.unit;
  if (!u) return NOOP;
  const root = new T.Group();
  const ring = flat(new T.Mesh(geo(ctx, 'dm_ring', (TT) => new TT.RingGeometry(88, 104, 64, 1)), mat(ctx, RED, 0.8)));
  const disc = flat(new T.Mesh(geo(ctx, 'dm_disc', (TT) => new TT.CircleGeometry(100, 40)), mat(ctx, 0xff2010, 0.18)));
  const aura = new T.Sprite(spriteMat(ctx, 0xff3a1a, 0.35));
  aura.scale.set(260, 300, 1);
  ring.position.y = 3; disc.position.y = 2;
  root.add(disc, ring, aura);
  if (p.fresh !== false) shockRing(ctx, { x: u.x, y: u.y, r0: 60, r1: 260, width: 24, color: 0xff5a2a, life: 0.5 });
  let emitAt = 0;
  const dur = p.duration || 5;
  return launch(ctx, root, {
    duration: dur + 0.2,
    update: (t, dt, age) => {
      if (!u.alive || (t > 0.02 && u.modelState && u.modelState.noxianMight === false)) return false;
      place(ctx, root, u.x, u.y, 0);
      const a = age ?? t * dur;
      const pulse = 0.7 + 0.3 * Math.sin(a * 7);
      ring.material.opacity = 0.75 * pulse;
      disc.material.opacity = 0.16 * pulse;
      aura.position.y = unitH(ctx, u, 0.55);
      aura.material.opacity = 0.28 * pulse;
      if (a >= emitAt) {
        emitAt = a + 0.1;
        burst(ctx, { x: u.x, y: u.y, h: 20, count: 3, color: EMBER, color2: 0xff2a10, speed: 70, up: 2.4, radius: 70, size: 26, life: 0.7, drag: 0.6 });
      }
    },
  });
}

let errShown = 0;
export default function register(fx) {
  const on = (name, fn) => fx.registerCustom(name, (ctx, p) => {
    try { return fn(ctx, p || {}) || NOOP; } catch (err) {
      if (errShown++ < 3) console.error(`[champfx:darius] ${name}`, err);
      return NOOP;
    }
  });
  on('darius_q_windup', qWindup);
  on('darius_q_swing', qSwing);
  on('darius_w_strike', wStrike);
  on('darius_e_grab', eGrab);
  on('darius_r_leap', rLeap);
  on('darius_r_impact', rImpact);
  on('darius_bleed', bleed);
  on('darius_might', might);
}
