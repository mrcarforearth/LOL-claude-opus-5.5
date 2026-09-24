// 英雄特效共享工具箱：只依赖契约 FXContext（ctx.THREE/add/toScene/heightAt/renderer/game/textures），供 champfx/<id>.js 复用
// 约定：所有网格按世界坐标放置（scene = (x, h, -y)）；每个特效自有的材质在结束时释放，几何体/纹理/共享材质全局缓存
export const NOOP = Object.freeze({ remove() {}, alive: false, object3d: null });
export const TAU = Math.PI * 2;
export const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);   // 仅表现层随机
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeOut3 = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t) => t * t;
export const sdt = (dt) => (Number.isFinite(dt) && dt >= 0 ? Math.min(dt, 0.1) : 1 / 60);
// 淡入淡出包络：age 秒、dur 总时长
export const env = (age, dur, fin = 0.12, fout = 0.3) => clamp01(Math.min(fin > 0 ? age / fin : 1, fout > 0 ? (dur - age) / fout : 1));

// —— 画质 ——
export const low = (ctx) => ctx?.renderer?.quality === 'low';
export const qn = (ctx, n) => Math.max(1, Math.round(n * (low(ctx) ? 0.4 : ctx?.renderer?.quality === 'medium' ? 0.75 : 1)));

// —— 报错节流 ——
let errCount = 0;
export function report(tag, err) { if (errCount++ < 8) console.error(`[champfx:${tag}]`, err); }

// —— 纹理（canvas 程序化，全局缓存） ——
const TEX = new Map();
function canvasTex(ctx, key, size, draw) {
  let t = TEX.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  draw(g, size);
  t = new ctx.THREE.CanvasTexture(cv);
  TEX.set(key, t);
  return t;
}
export function glowTex(ctx) {
  if (ctx.textures?.glow) return ctx.textures.glow;
  return canvasTex(ctx, 'glow', 64, (g, s) => {
    const r = s / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grd.addColorStop(0.65, 'rgba(255,255,255,0.14)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  });
}
// 柔边圆环（峰值在 0.82 半径处）
export function ringTex(ctx) {
  return canvasTex(ctx, 'ring', 128, (g, s) => {
    const r = s / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.62, 'rgba(255,255,255,0.05)');
    grd.addColorStop(0.8, 'rgba(255,255,255,0.75)'); grd.addColorStop(0.88, 'rgba(255,255,255,1)');
    grd.addColorStop(0.95, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  });
}
// 四芒星火花
export function starTex(ctx) {
  return canvasTex(ctx, 'star', 64, (g, s) => {
    const r = s / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r * 0.5);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'lighter';
    for (const [w, h] of [[s, 3], [3, s]]) {
      const lg = g.createRadialGradient(r, r, 0, r, r, r);
      lg.addColorStop(0, 'rgba(255,255,255,0.95)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.fillRect(r - w / 2, r - h / 2, w, h);
    }
  });
}
// 符文法阵：同心圆 + 刻度 + 内接星形
export function runeTex(ctx) {
  return canvasTex(ctx, 'rune', 256, (g, s) => {
    const r = s / 2;
    g.translate(r, r);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 6;
    const circ = (rad, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, rad, 0, TAU); g.stroke(); };
    circ(r * 0.94, 3); circ(r * 0.84, 1.5); circ(r * 0.5, 2);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU, l = i % 4 === 0 ? 0.76 : 0.8;
      g.lineWidth = i % 4 === 0 ? 2.5 : 1.2;
      g.beginPath(); g.moveTo(Math.cos(a) * r * l, Math.sin(a) * r * l); g.lineTo(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84); g.stroke();
    }
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 5; i++) { const a = (i * 2 / 5) * TAU - Math.PI / 2; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 0.74, Math.sin(a) * r * 0.74); }
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      g.beginPath(); g.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.06, 0, TAU); g.stroke();
    }
  });
}
// 爱心（阿狸魅惑）
export function heartTex(ctx) {
  return canvasTex(ctx, 'heart', 128, (g, s) => {
    const k = s / 128;
    g.scale(k, k);
    const path = () => {
      g.beginPath(); g.moveTo(64, 108);
      g.bezierCurveTo(10, 72, 12, 26, 40, 24); g.bezierCurveTo(54, 23, 62, 32, 64, 42);
      g.bezierCurveTo(66, 32, 74, 23, 88, 24); g.bezierCurveTo(116, 26, 118, 72, 64, 108); g.closePath();
    };
    g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = 16;
    path(); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
    g.shadowBlur = 0;
    const grd = g.createRadialGradient(50, 48, 4, 64, 64, 60);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0.7)');
    path(); g.fillStyle = grd; g.fill();
  });
}
// 细长光条（刀光/子弹拖尾）：沿 U 方向头亮尾暗
export function streakTex(ctx) {
  return canvasTex(ctx, 'streak', 128, (g, s) => {
    const lg = g.createLinearGradient(0, 0, s, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.8, 'rgba(255,255,255,0.7)'); lg.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = lg; g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'destination-in';
    const vg = g.createLinearGradient(0, 0, 0, s);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.5, 'rgba(0,0,0,1)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = vg; g.fillRect(0, 0, s, s);
  });
}
// 焦痕（普通混合，深色）
export function scorchTex(ctx) {
  return canvasTex(ctx, 'scorch', 128, (g, s) => {
    const r = s / 2;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, d = Math.random() * r * 0.35, rr = r * (0.35 + Math.random() * 0.4);
      const x = r + Math.cos(a) * d, y = r + Math.sin(a) * d;
      const grd = g.createRadialGradient(x, y, 0, x, y, rr);
      grd.addColorStop(0, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    }
  });
}
// 自定义 canvas 纹理（各英雄的剪影等）
export function customTex(ctx, key, size, draw) { return canvasTex(ctx, key, size, draw); }

// —— 几何体缓存 ——
const GEO = new Map();
export function geo(ctx, key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(ctx.THREE); GEO.set(key, g); }
  return g;
}
export const planeGeo = (ctx) => geo(ctx, 'plane', (T) => new T.PlaneGeometry(1, 1));
export const sphereGeo = (ctx, d = 16) => geo(ctx, 'sphere' + d, (T) => new T.SphereGeometry(1, d, Math.max(6, Math.round(d * 0.75))));
export const icoGeo = (ctx, detail = 1) => geo(ctx, 'ico' + detail, (T) => new T.IcosahedronGeometry(1, detail));
// 竖直光柱：半径 1、高 1、底部在 0；顶点色底亮顶暗
export const pillarGeo = (ctx) => geo(ctx, 'pillar', (T) => {
  const g = new T.CylinderGeometry(0.8, 1, 1, 28, 6, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = Math.pow(1 - p.getY(i), 1.5); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  return g;
});
// 十字光束：沿 +X 从 0 到 1，宽 1（水平面 + 竖直面），宽度方向中心亮边缘暗
export const beamGeo = (ctx) => geo(ctx, 'beam', (T) => {
  const pos = [], col = [], idx = [];
  const strip = (vert) => {
    const b = pos.length / 3;
    for (const x of [0, 1]) for (const w of [-0.5, 0, 0.5]) {
      pos.push(x, vert ? w : 0, vert ? 0 : w);
      const c = w === 0 ? 1 : 0; col.push(c, c, c);
    }
    idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
  };
  strip(false); strip(true);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
});
// 扇形/弧带（贴地，局部 XY 平面，从角度 -half 到 +half），顶点色：径向外亮 + 可选角向渐变
export function sectorGeo(T, r0, r1, half, segs = 32, { radialPow = 1, sweep = false } = {}) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs, a = -half + k * half * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const av = sweep ? Math.pow(k, 1.6) : 1;
    pos.push(c * r0, s * r0, 0, c * r1, s * r1, 0);
    col.push(av * Math.pow(0.25, radialPow), av * Math.pow(0.25, radialPow), av * Math.pow(0.25, radialPow), av, av, av);
    if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
// 合并多个几何体（按部件着色为顶点色），parts: [[geometry, { p, r, s, c }], ...]
export function merge(T, parts) {
  const list = [];
  let total = 0;
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler();
  for (const [g0, o = {}] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    g0.dispose();
    if (!g.attributes.normal) g.computeVertexNormals();
    q.setFromEuler(e.set(...(o.r || [0, 0, 0])));
    m4.compose(new T.Vector3(...(o.p || [0, 0, 0])), q, new T.Vector3(...(o.s || [1, 1, 1])));
    g.applyMatrix4(m4);
    list.push([g, new T.Color(o.c ?? 0xffffff)]);
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let off = 0;
  for (const [g, c] of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    for (let i = 0; i < n; i++) { col[(off + i) * 3] = c.r; col[(off + i) * 3 + 1] = c.g; col[(off + i) * 3 + 2] = c.b; }
    off += n;
    g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// —— 材质 ——
export function mat(ctx, color, opacity = 1, { additive = true, vc = false, map = null, side = null, depthTest = true } = {}) {
  const T = ctx.THREE;
  return new T.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, depthTest, side: side ?? T.DoubleSide, vertexColors: vc, map,
    blending: additive ? T.AdditiveBlending : T.NormalBlending, toneMapped: false, fog: false,
  });
}
export function smat(ctx, color, opacity = 1, map = null, additive = true) {
  const T = ctx.THREE;
  return new T.SpriteMaterial({ map: map || glowTex(ctx), color, transparent: true, opacity, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, toneMapped: false, fog: false });
}
// 共享（缓存）材质：标记 userData.shared，结束时不释放
const MATS = new Map();
export function sharedMat(ctx, key, make) {
  let m = MATS.get(key);
  if (!m) { m = make(ctx.THREE); m.userData.shared = true; MATS.set(key, m); }
  return m;
}
// 金属/实体部件（受光照）
export function solidMat(ctx, key, color, { metalness = 0.5, roughness = 0.45, emissive = 0x000000, emissiveIntensity = 1, vc = false } = {}) {
  return sharedMat(ctx, 'solid:' + key, (T) => new T.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity, vertexColors: vc }));
}
export function sprite(ctx, color, size, opacity = 1, map = null, additive = true) {
  const s = new ctx.THREE.Sprite(smat(ctx, color, opacity, map, additive));
  s.scale.set(size, size, 1);
  return s;
}
export function mesh(ctx, geometry, material) {
  const m = new ctx.THREE.Mesh(geometry, material);
  m.frustumCulled = false;
  return m;
}

// —— 坐标与单位 ——
export function gh(ctx, x, y) {
  try { const h = ctx.heightAt?.(x, y); return Number.isFinite(h) ? h : 0; } catch { return 0; }
}
export function place(ctx, obj, x, y, h = 0) { obj.position.set(x, gh(ctx, x, y) + h, -y); return obj; }
// 贴地：局部 XY 平面 = 游戏平面，局部 z 旋转 = 游戏角度
export function flat(m, a = 0) { m.rotation.set(-Math.PI / 2, 0, a); return m; }
export function unitH(ctx, u, f = 1) { let h = 0; try { h = Number(ctx.unitHeight?.(u)); } catch { h = 0; } return (h > 0 ? h : 200) * f; }
export function upos(ctx, u) {
  try { const p = ctx.renderer?.renderPos?.(u); if (p && Number.isFinite(p.x)) return p; } catch { /* 忽略 */ }
  return { x: u?.x || 0, y: u?.y || 0, z: u?.z || 0 };
}
export const alive = (u) => !!u && u.alive !== false && !u.removed && !u.dead;
export function shown(ctx, u) {
  if (!u) return true;
  const r = ctx.renderer;
  if (!r || typeof r.isShown !== 'function') return true;
  if (r.revealAll) return true;
  try { return !!r.isShown(u); } catch { return true; }
}
// 某点对玩家是否可见（己方特效总是可见）
export function seen(ctx, x, y, team) {
  const r = ctx.renderer, game = ctx.game;
  if (!r || r.revealAll) return true;
  const pt = r.playerTeam ?? game?.player?.team;
  if (team != null && team === pt) return true;
  try { const v = game?.vision?.isVisible?.(pt, x, y); return v === undefined ? true : !!v; } catch { return true; }
}
// 把物体贴到单位身上（插值位置 + 击飞高度）；返回是否可见
export function stick(ctx, obj, u, h = 0) {
  const p = upos(ctx, u);
  obj.position.set(p.x, gh(ctx, p.x, p.y) + (p.z || 0) + h, -p.y);
  const v = shown(ctx, u);
  obj.visible = v;
  return v;
}
export function yawOf(dx, dy) { return Math.atan2(dy, dx); }
export function shake(ctx, x, y, amt = 18, dur = 0.3, range = 2600) {
  const cam = ctx.renderer?.cameraCtl;
  if (!cam || typeof cam.shake !== 'function') return;
  const t = cam.target;
  let d = 0;
  if (t && Number.isFinite(t.x)) d = Math.hypot(t.x - x, (t.y || 0) - y);
  if (d < range) { try { cam.shake(amt * (1 - d / (range * 1.1)), dur); } catch { /* 忽略 */ } }
}

// —— 生命周期 ——
export function disposeTree(obj) {
  obj?.traverse?.((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) if (!m.userData?.shared) m.dispose?.();
    if (o.geometry && o.userData?.ownGeo) o.geometry.dispose?.();
  });
}
// ctx.add 的防御式包装：update(t, dt, age) 返回 false 结束；结束时释放自有材质
export function launch(ctx, obj, o = {}) {
  if (!ctx || typeof ctx.add !== 'function' || !obj) { disposeTree(obj); return NOOP; }
  const dur = o.duration > 0 ? o.duration : 1;
  const up = o.update;
  let age = 0, done = false;
  const onEnd = () => { if (done) return; done = true; disposeTree(obj); try { o.onEnd?.(); } catch (e) { report('end', e); } };
  let h;
  try {
    h = ctx.add(obj, {
      duration: dur,
      update: (t, dt, a) => {
        dt = sdt(dt);
        age = Number.isFinite(a) ? a : age + dt;
        if (!up) return undefined;
        try { return up(Number.isFinite(t) ? t : clamp01(age / dur), dt, age); } catch (e) { report(o.tag || 'fx', e); return false; }
      },
      onEnd,
    });
  } catch (e) { report('add', e); onEnd(); return NOOP; }
  return h || NOOP;
}
// 同时结束一组句柄
export function group(handles) {
  const hs = handles.filter(Boolean);
  return { get alive() { return hs.some((h) => h.alive); }, object3d: hs[0]?.object3d || null, remove() { for (const h of hs) try { h.remove?.(); } catch { /* 忽略 */ } } };
}

// —— 通用效果积木 ——
// 粒子爆发（一个 Points = 一次绘制）
export function burst(ctx, o = {}) {
  const T = ctx.THREE;
  const {
    x = 0, y = 0, h = 80, color = 0xffffff, color2 = null, speed = 300, size = 30, life = 0.6,
    gravity = 0, drag = 1.5, up = 0.4, radius = 0, dir = null, arc = TAU, additive = true, rise = 0,
    map = null, team = null, vis = null, opacity = 1,
  } = o;
  if (vis === false || (vis == null && !seen(ctx, x, y, team))) return NOOP;
  const n = qn(ctx, o.count ?? 20);
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), col = new Float32Array(n * 3), base = new Float32Array(n * 3), lk = new Float32Array(n);
  const c1 = new T.Color(color), c2 = new T.Color(color2 ?? color);
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const a = dir == null ? Math.random() * TAU : dir + (Math.random() - 0.5) * arc;
    const pa = Math.random() * TAU, r = radius * Math.sqrt(Math.random());
    pos[j] = Math.cos(pa) * r; pos[j + 1] = Math.random() * rise; pos[j + 2] = -Math.sin(pa) * r;
    const sp = speed * (0.35 + 0.65 * Math.random());
    vel[j] = Math.cos(a) * sp; vel[j + 1] = sp * up * (0.4 + 1.0 * Math.random()); vel[j + 2] = -Math.sin(a) * sp;
    const m = Math.random();
    base[j] = c1.r + (c2.r - c1.r) * m; base[j + 1] = c1.g + (c2.g - c1.g) * m; base[j + 2] = c1.b + (c2.b - c1.b) * m;
    col.set([base[j], base[j + 1], base[j + 2]], j);
    lk[i] = 0.5 + 0.5 * Math.random();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  const m = new T.PointsMaterial({
    size, map: map || glowTex(ctx), vertexColors: true, transparent: true, opacity, depthWrite: false, sizeAttenuation: true, toneMapped: false, fog: false,
    blending: additive ? T.AdditiveBlending : T.NormalBlending,
  });
  const pts = new T.Points(g, m);
  pts.frustumCulled = false;
  pts.userData.ownGeo = true;
  place(ctx, pts, x, y, h);
  return launch(ctx, pts, {
    duration: life, tag: 'burst',
    update: (t, dt, age) => {
      const d = Math.max(0, 1 - drag * dt);
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        vel[j + 1] -= gravity * dt;
        vel[j] *= d; vel[j + 1] *= d; vel[j + 2] *= d;
        pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
        if (pos[j + 1] < -h) { pos[j + 1] = -h; vel[j + 1] *= -0.3; }
        const k = clamp01(1 - age / (life * lk[i]));
        const f = additive ? k * k : 1;
        col[j] = base[j] * f; col[j + 1] = base[j + 1] * f; col[j + 2] = base[j + 2] * f;
      }
      if (!additive) m.opacity = opacity * (1 - t);
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    },
  });
}
// 贴地贴花：tex 为纹理（ring/rune/glow/scorch…），可旋转、缩放、跟随单位、按条件提前结束
export function decal(ctx, o = {}) {
  const {
    x = 0, y = 0, radius = 100, color = 0xffffff, opacity = 0.8, duration = 0.6, spin = 0, angle = 0,
    grow = null, fin = 0.08, fout = 0.3, follow = null, h = 3, until = null, additive = true, map = null, team = null, pulse = 0,
    ease = easeOut, onUpdate = null,
  } = o;
  const m = mesh(ctx, planeGeo(ctx), mat(ctx, color, 0, { additive, map: map || ringTex(ctx) }));
  flat(m, angle);
  const setPos = () => {
    if (follow) { const p = upos(ctx, follow); m.position.set(p.x, gh(ctx, p.x, p.y) + h, -p.y); m.visible = shown(ctx, follow); }
    else { place(ctx, m, x, y, h); m.visible = seen(ctx, x, y, team); }
  };
  setPos();
  m.scale.set(radius * 2, radius * 2, 1);
  return launch(ctx, m, {
    duration, tag: 'decal',
    update: (t, dt, age) => {
      if (until && until()) return false;
      if (follow) { if (!alive(follow)) return false; setPos(); }
      const s = grow ? grow[0] + (grow[1] - grow[0]) * ease(t) : 1;
      m.scale.set(radius * 2 * s, radius * 2 * s, 1);
      m.rotation.z = angle + spin * age;
      const p = pulse ? 1 - pulse * 0.5 + pulse * 0.5 * Math.sin(age * 8) : 1;
      m.material.opacity = opacity * env(age, duration, fin, fout) * p;
      if (onUpdate) onUpdate(m, t, age);
    },
  });
}
export const ring = (ctx, o) => decal(ctx, { grow: [0.25, 1], fout: (o.duration ?? 0.5) * 0.7, ...o, map: ringTex(ctx) });
export const glowDisc = (ctx, o) => decal(ctx, { ...o, map: glowTex(ctx) });
export const scorch = (ctx, o) => decal(ctx, { color: 0x1a0c06, opacity: 0.55, duration: 3, fout: 1.5, ...o, additive: false, map: scorchTex(ctx) });
// 冲击波：外扩的环 + 闪光地面
export function shock(ctx, o = {}) {
  const { x, y, radius = 200, color = 0xffffff, duration = 0.5, width = 1, team = null } = o;
  ring(ctx, { x, y, radius, color, duration, opacity: 0.95, grow: [0.15, 1], ease: easeOut3, team });
  if (width > 0) glowDisc(ctx, { x, y, radius: radius * 0.8, color, duration: duration * 0.7, opacity: 0.45, grow: [0.5, 1.1], team });
}
// 闪光精灵
export function flash(ctx, o = {}) {
  const { x = 0, y = 0, h = 80, color = 0xffffff, size = 200, duration = 0.3, map = null, grow = [0.6, 1.3], team = null, opacity = 1, follow = null } = o;
  const s = sprite(ctx, color, size, 0, map);
  const setPos = () => { if (follow) stick(ctx, s, follow, h); else place(ctx, s, x, y, h); };
  setPos();
  if (!follow && !seen(ctx, x, y, team)) s.visible = false;
  return launch(ctx, s, {
    duration, tag: 'flash',
    update: (t) => {
      if (follow) setPos();
      const k = grow[0] + (grow[1] - grow[0]) * easeOut(t);
      s.scale.set(size * k, size * k, 1);
      s.material.opacity = opacity * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
    },
  });
}
// 竖直光柱
export function pillar(ctx, o = {}) {
  const { x = 0, y = 0, radius = 60, height = 600, color = 0xffffff, opacity = 0.7, duration = 0.6, follow = null, grow = [1, 1], team = null, fin = 0.08, fout = 0.35, spin = 0 } = o;
  const m = mesh(ctx, pillarGeo(ctx), mat(ctx, color, 0, { vc: true }));
  const setPos = () => { if (follow) stick(ctx, m, follow, 0); else place(ctx, m, x, y, 0); };
  setPos();
  if (!follow && !seen(ctx, x, y, team)) m.visible = false;
  return launch(ctx, m, {
    duration, tag: 'pillar',
    update: (t, dt, age) => {
      if (follow) { if (!alive(follow)) return false; setPos(); }
      const k = grow[0] + (grow[1] - grow[0]) * easeOut(t);
      m.scale.set(radius * k, height, radius * k);
      m.rotation.y += spin * dt;
      m.material.opacity = opacity * env(age, duration, fin, fout);
    },
  });
}
// 十字光束网格（沿 +X），用 setBeam 设置端点
export function beamMesh(ctx, color, opacity = 1) {
  const m = mesh(ctx, beamGeo(ctx), mat(ctx, color, opacity, { vc: true }));
  return m;
}
const _v1 = { x: 0, y: 0, z: 0 };
export function setBeam(ctx, m, ax, ay, ah, bx, by, bh, width) {
  const T = ctx.THREE;
  const sx = ax, sy = gh(ctx, ax, ay) + ah, sz = -ay;
  const ex = bx, ey = gh(ctx, bx, by) + bh, ez = -by;
  const dx = ex - sx, dy = ey - sy, dz = ez - sz;
  const len = Math.hypot(dx, dy, dz) || 1e-3;
  m.position.set(sx, sy, sz);
  if (!m.userData._q) { m.userData._q = new T.Quaternion(); m.userData._x = new T.Vector3(1, 0, 0); m.userData._d = new T.Vector3(); }
  m.userData._d.set(dx / len, dy / len, dz / len);
  m.quaternion.setFromUnitVectors(m.userData._x, m.userData._d);
  m.scale.set(len, width, width);
  _v1.x = len;
  return len;
}
// 拖尾丝带：head() 返回 { x, y, h(世界高度), vis } 或 null（null 时尾巴收拢淡出）
export function trail(ctx, o = {}) {
  const T = ctx.THREE;
  const max = Math.max(4, Math.round((o.max ?? 18) * (low(ctx) ? 0.6 : 1)));
  const seg = o.seg ?? 22, width = o.width ?? 30, fadeT = o.fade ?? 0.25, pow = o.pow ?? 1.4, taper = o.taper ?? true;
  const pts = [];
  const pos = new Float32Array(max * 6), col = new Float32Array(max * 6), idx = [];
  for (let i = 0; i < max - 1; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
  g.setAttribute('color', new T.BufferAttribute(col, 3).setUsage(T.DynamicDrawUsage));
  g.setIndex(idx);
  g.setDrawRange(0, 0);
  const c1 = new T.Color(o.color ?? 0xffffff), c2 = new T.Color(o.color2 ?? o.color ?? 0xffffff);
  const m = mesh(ctx, g, mat(ctx, 0xffffff, o.opacity ?? 1, { vc: true }));
  m.userData.ownGeo = true;
  let fade = 1;
  return launch(ctx, m, {
    duration: o.maxLife ?? 20, tag: 'trail',
    update: (t, dt) => {
      let hd = null;
      try { hd = o.head(); } catch { hd = null; }
      if (hd) {
        const sx = hd.x, sy = hd.h, sz = -hd.y;
        m.visible = hd.vis !== false;
        const n = pts.length;
        if (n < 2) pts.push([sx, sy, sz]);
        else {
          const p2 = pts[n - 2];
          if (Math.hypot(sx - p2[0], sz - p2[2], sy - p2[1]) >= seg) pts.push([sx, sy, sz]);
          else { const l = pts[n - 1]; l[0] = sx; l[1] = sy; l[2] = sz; }
        }
        while (pts.length > max) pts.shift();
      } else {
        fade -= dt / fadeT;
        if (fade <= 0 || pts.length < 2) return false;
        if (pts.length > 2 && Math.random() < 0.6) pts.shift();
      }
      const n = pts.length;
      if (n < 2) { g.setDrawRange(0, 0); return undefined; }
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], p = pts[i];
        let dx = b[0] - a[0], dz = b[2] - a[2];
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const k = i / (n - 1);
        const w = width * 0.5 * (taper ? 0.2 + 0.8 * k : 1);
        const j = i * 6;
        pos[j] = p[0] - dz * w; pos[j + 1] = p[1]; pos[j + 2] = p[2] + dx * w;
        pos[j + 3] = p[0] + dz * w; pos[j + 4] = p[1]; pos[j + 5] = p[2] - dx * w;
        const v = Math.pow(k, pow) * fade;
        const r = (c2.r + (c1.r - c2.r) * k) * v, gg = (c2.g + (c1.g - c2.g) * k) * v, bb = (c2.b + (c1.b - c2.b) * k) * v;
        col[j] = r; col[j + 1] = gg; col[j + 2] = bb; col[j + 3] = r; col[j + 4] = gg; col[j + 5] = bb;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.setDrawRange(0, (n - 1) * 6);
      return undefined;
    },
  });
}
// 单位拖尾（冲刺/位移）：跟随单位直到 until() 或时长结束
export function unitTrail(ctx, u, o = {}) {
  const hf = o.hf ?? 0.45;
  const dur = o.duration ?? 0.6;
  const t0 = ctx.game?.time ?? 0;
  let frames = 0;
  return trail(ctx, {
    ...o, maxLife: dur + 2,
    head: () => {
      frames++;
      const age = Number.isFinite(ctx.game?.time) ? ctx.game.time - t0 : frames / 60;
      if (!alive(u) || age > dur || (o.until && o.until())) return null;
      const p = upos(ctx, u);
      return { x: p.x, y: p.y, h: gh(ctx, p.x, p.y) + (p.z || 0) + unitH(ctx, u, hf), vis: shown(ctx, u) };
    },
  });
}
// 残影：克隆单位模型并替换为半透明叠加材质
export function ghost(ctx, u, o = {}) {
  const view = ctx.getView?.(u);
  const src = view?.object3d;
  if (!src || !shown(ctx, u)) return NOOP;
  let skinned = false;
  src.traverse((c) => { if (c.isSkinnedMesh) skinned = true; });
  if (skinned) return NOOP;
  const T = ctx.THREE;
  const gm = new T.MeshBasicMaterial({ color: o.color ?? 0xffffff, transparent: true, opacity: o.opacity ?? 0.5, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false, fog: false });
  const clone = src.clone(true);
  const drop = [];
  clone.traverse((c) => {
    if (c.isMesh) c.material = gm;
    else if (c.isSprite || c.isPoints || c.isLine || c.isLight) drop.push(c);
  });
  for (const c of drop) c.parent?.remove(c);
  clone.visible = true;
  clone.position.copy(src.position);
  clone.rotation.copy(src.rotation);
  clone.scale.copy(src.scale);
  if (o.x != null) place(ctx, clone, o.x, o.y, 0);
  if (o.facing != null) clone.rotation.y = o.facing;
  const dur = o.duration ?? 0.4, op = o.opacity ?? 0.5, drift = o.drift ?? 0;
  return launch(ctx, clone, {
    duration: dur, tag: 'ghost',
    update: (t, dt) => {
      gm.opacity = op * (1 - t);
      if (drift) clone.position.y += drift * dt;
      if (o.grow) clone.scale.setScalar(src.scale.x * (1 + o.grow * t));
    },
    onEnd: () => gm.dispose(),
  });
}

// —— 投射物 ——
// 插值后的投射物位置（世界高度含地形）；arc>0 时按抛物线抬高
export function projPos(ctx, p, out = {}) {
  const a = clamp01(Number.isFinite(ctx.game?.alpha) ? ctx.game.alpha : 1);
  const px = Number.isFinite(p.prevX) ? p.prevX : p.x, py = Number.isFinite(p.prevY) ? p.prevY : p.y;
  out.x = px + (p.x - px) * a;
  out.y = py + (p.y - py) * a;
  let h = Number.isFinite(p.h) ? p.h : 100;
  const arc = p.vfx?.arc || 0;
  if (arc > 0 && Number.isFinite(p.range) && p.range > 0) {
    const k = clamp01((p.traveled || 0) / p.range);
    h += arc * 4 * k * (1 - k);
  }
  out.h = gh(ctx, out.x, out.y) + h;
  let dx = p.x - px, dy = p.y - py;
  if (dx * dx + dy * dy < 1e-4) {
    if (p.target && Number.isFinite(p.target.x)) { dx = p.target.x - p.x; dy = p.target.y - p.y; }
    else { dx = p.dirX || 1; dy = p.dirY || 0; }
    if (p.returning) { dx = -dx; dy = -dy; }
  }
  out.yaw = Math.atan2(dy, dx);
  out.vis = seen(ctx, out.x, out.y, p.team ?? p.owner?.team);
  return out;
}
// 标准投射物视图：root 按插值位置/朝向摆放；可选拖尾（投射物结束后拖尾自行淡出）
export function projView(ctx, p, root, o = {}) {
  const cur = projPos(ctx, p, {});
  let age = 0;
  let tr = null;
  if (o.trail && !(o.trail.skipLow && low(ctx))) {
    tr = trail(ctx, {
      ...o.trail,
      head: () => {
        if (p.dead) return null;
        const c = projPos(ctx, p, {});
        return { x: c.x, y: c.y, h: c.h + (o.trail.dh || 0), vis: c.vis };
      },
    });
  }
  const apply = (dt) => {
    projPos(ctx, p, cur);
    root.position.set(cur.x, cur.h, -cur.y);
    if (o.face !== false) root.rotation.y = cur.yaw;
    root.visible = cur.vis;
  };
  apply(0);
  if (o.update) try { o.update(0, p, cur, 0, root); } catch (e) { report(o.tag || 'proj', e); }
  return {
    object3d: root,
    update(dt, proj) {
      dt = sdt(dt);
      age += dt;
      try {
        apply(dt);
        if (o.update) o.update(dt, proj || p, cur, age, root);
      } catch (e) { report(o.tag || 'proj', e); }
    },
    dispose() {
      disposeTree(root);
      try { o.onDispose?.(cur, p); } catch (e) { report(o.tag || 'proj', e); }
    },
  };
}

// —— 注册包装：出错只影响单个特效 ——
export function registrar(fx, tag) {
  return {
    on(name, fn) {
      fx.registerCustom(name, (ctx, p) => {
        try { return fn(ctx, p || {}) || NOOP; } catch (err) { report(`${tag}:${name}`, err); return NOOP; }
      });
    },
    proj(kind, fn) {
      if (typeof fx.registerProjectile !== 'function') return;
      fx.registerProjectile(kind, (ctx, p) => {
        try { const v = fn(ctx, p); if (v && v.object3d) return v; } catch (err) { report(`${tag}:${kind}`, err); }
        // 兜底：一个发光点
        const s = sprite(ctx, p?.vfx?.color ?? 0xffffff, 60 * (p?.vfx?.size || 1));
        return projView(ctx, p, s, { face: false });
      });
    },
  };
}
// 从区域特效参数中取出 Zone（兼容 { zone } / zone 本身 / { ...vfx, zone }）
export function zoneOf(p) {
  if (!p) return null;
  if (p.zone && typeof p.zone === 'object') return p.zone;
  if ('dead' in p && Number.isFinite(p.x) && Number.isFinite(p.radius)) return p;
  return null;
}

// 汇聚粒子：从半径 radius 的球壳飞向中心（跟随单位或固定点），一次绘制；用于蓄力/吸收
export function converge(ctx, o = {}) {
  const T = ctx.THREE;
  const { x = 0, y = 0, h = 100, follow = null, radius = 220, color = 0xffffff, color2 = null, size = 26, duration = 0.6, spin = 0, team = null, fwd = null } = o;
  if (!follow && !seen(ctx, x, y, team)) return NOOP;
  const n = qn(ctx, o.count ?? 18);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), start = new Float32Array(n * 3), base = new Float32Array(n * 3), dl = new Float32Array(n);
  const c1 = new T.Color(color), c2 = new T.Color(color2 ?? color);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, e = (Math.random() - 0.3) * 1.2, r = radius * (0.6 + 0.4 * Math.random());
    start[i * 3] = Math.cos(a) * Math.cos(e) * r; start[i * 3 + 1] = Math.sin(e) * r * 0.7; start[i * 3 + 2] = -Math.sin(a) * Math.cos(e) * r;
    const m = Math.random();
    base[i * 3] = c1.r + (c2.r - c1.r) * m; base[i * 3 + 1] = c1.g + (c2.g - c1.g) * m; base[i * 3 + 2] = c1.b + (c2.b - c1.b) * m;
    dl[i] = Math.random() * 0.45;
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  const m = new T.PointsMaterial({ size, map: glowTex(ctx), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, toneMapped: false, fog: false, blending: T.AdditiveBlending });
  const pts = new T.Points(g, m);
  pts.frustumCulled = false;
  pts.userData.ownGeo = true;
  const setPos = () => {
    if (follow) {
      const p = upos(ctx, follow);
      let px = p.x, py = p.y;
      if (fwd) { px += fwd.x || 0; py += fwd.y || 0; }
      pts.position.set(px, gh(ctx, px, py) + (p.z || 0) + h, -py);
      pts.visible = shown(ctx, follow);
    } else place(ctx, pts, x, y, h);
  };
  setPos();
  return launch(ctx, pts, {
    duration, tag: 'converge',
    update: (t, dt, age) => {
      if (follow) { if (!alive(follow)) return false; setPos(); }
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        const k = clamp01((t - dl[i]) / (1 - dl[i]));
        const f = 1 - k * k, a = spin * k;
        const sx = start[j], sz = start[j + 2];
        pos[j] = (sx * Math.cos(a) - sz * Math.sin(a)) * f; pos[j + 1] = start[j + 1] * f; pos[j + 2] = (sx * Math.sin(a) + sz * Math.cos(a)) * f;
        const v = k <= 0 ? 0 : Math.min(1, k * 3) * (1 - Math.max(0, k - 0.85) / 0.15);
        col[j] = base[j] * v; col[j + 1] = base[j + 1] * v; col[j + 2] = base[j + 2] * v;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    },
  });
}
// 当前相机（用于面向镜头的丝带），可能为空
export const camOf = (ctx) => ctx?.renderer?.camera || null;
// 仅本队可见（队伍专属特效，如锤石灵魂）
export function teamOnlyHidden(ctx, team) {
  const r = ctx.renderer;
  if (team == null || !r || r.revealAll) return false;
  return team !== (r.playerTeam ?? ctx.game?.player?.team);
}
