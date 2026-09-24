// 单位模型工具包：部件合并（顶点色 + 顶点自发光）、骨骼姿态（相对 morph target）、共享材质/贴图、视图基类
// 约定：模型原点在脚底中心，正前方 +X，上方 +Y，右侧 +Z。每个 Rig.build() 产出一个合并几何体 = 1 个 draw call。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _n3 = new THREE.Matrix3();
const Z3 = [0, 0, 0];
const O3 = [1, 1, 1];

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
export const approach = (cur, target, rate) => cur + (target - cur) * Math.min(1, rate);

function sv(s) { return s == null ? O3 : typeof s === 'number' ? [s, s, s] : s; }

// 确定性伪随机（仅用于模型造型，不影响模拟）
export function prng(seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ———————————————— 部件合并 + 骨骼姿态 ————————————————
export class Rig {
  constructor(detail = 1) {
    this.detail = detail;
    this.parts = [];
    this.bones = [{ name: 'root', pivot: Z3, parent: -1 }];
    this.boneIdx = { root: 0 };
    this.poses = [];
  }
  n(k, min = 3) { return Math.max(min, Math.round(k * this.detail)); }
  bone(name, pivot, parent = 'root') {
    this.boneIdx[name] = this.bones.length;
    this.bones.push({ name, pivot, parent: this.boneIdx[parent] ?? 0 });
    return this;
  }
  // o: { p 位置, r 欧拉角, s 缩放, bone 所属骨骼, glow 自发光强度 }
  add(geo, color, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = o.p || Z3; const r = o.r || Z3; const s = sv(o.s);
    _m.compose(_v.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
    g.applyMatrix4(_m);
    const n = g.attributes.position.count;
    _c.set(color);
    const col = new Float32Array(n * 3);
    const glow = new Float32Array(n).fill(o.glow || 0);
    // 轻微的自上而下明暗渐变，增加体积感
    const pos = g.attributes.position.array;
    const shade = o.shade ?? 0.12;
    let y0 = Infinity; let y1 = -Infinity;
    for (let i = 0; i < n; i++) { const y = pos[i * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const span = Math.max(1e-3, y1 - y0);
    for (let i = 0; i < n; i++) {
      const k = 1 - shade + shade * ((pos[i * 3 + 1] - y0) / span);
      col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    this.parts.push({ g, bone: this.boneIdx[o.bone || 'root'] ?? 0, n });
    return this;
  }
  box(w, h, d, c, o) { return this.add(new THREE.BoxGeometry(w, h, d), c, o); }
  cyl(rt, rb, h, c, o, seg = 10) { return this.add(new THREE.CylinderGeometry(rt, rb, h, this.n(seg)), c, o); }
  cone(r, h, c, o, seg = 8) { return this.add(new THREE.ConeGeometry(r, h, this.n(seg)), c, o); }
  sph(r, c, o, w = 12, h = 9) { return this.add(new THREE.SphereGeometry(r, this.n(w, 5), this.n(h, 4)), c, o); }
  hemi(r, c, o, w = 12, h = 6) { return this.add(new THREE.SphereGeometry(r, this.n(w, 5), this.n(h, 3), 0, TAU, 0, PI / 2), c, o); }
  ico(r, c, o, det = 0) { return this.add(new THREE.IcosahedronGeometry(r, det), c, o); }
  oct(r, c, o) { return this.add(new THREE.OctahedronGeometry(r, 0), c, o); }
  dod(r, c, o) { return this.add(new THREE.DodecahedronGeometry(r, 0), c, o); }
  tor(r, t, c, o, rs = 6, ts = 16, arc = TAU) { return this.add(new THREE.TorusGeometry(r, t, this.n(rs), this.n(ts, 6), arc), c, o); }
  cap(r, len, c, o, seg = 10) { return this.add(new THREE.CapsuleGeometry(r, len, this.n(3, 2), this.n(seg)), c, o); }
  // 两点之间的圆柱（端点半径 ra/rb），用于肢体、爪、肋条
  seg(a, b, ra, rb, c, o = {}, n = 8) {
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const g = new THREE.CylinderGeometry(rb, ra, len, this.n(n));
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v);
    _m.compose(_s.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m);
    return this.add(g, c, { ...o, p: undefined, r: undefined, s: undefined });
  }
  // 固定分段数圆柱（多边形石柱等，不随画质变化）
  cylx(rt, rb, h, c, o, seg = 8) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), c, o); }
  // 平面多边形（双面，扇形三角化），用于翼膜、旗帜、鳍
  sheet(pts, c, o = {}) {
    const a = []; const p0 = pts[0];
    for (let i = 1; i < pts.length - 1; i++) {
      const p1 = pts[i]; const p2 = pts[i + 1];
      a.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
    g.computeVertexNormals();
    return this.add(g, c, o);
  }
  // 骨骼上某点在各姿态下的位移（morph 线性叠加 → 可精确追踪挂点，如法杖顶端）
  pointDeltas(point, bone) {
    const bi = this.boneIdx[bone] ?? 0; const out = {};
    for (const pose of this.poses) {
      const v = new THREE.Vector3(point[0], point[1], point[2]).applyMatrix4(this._mats(pose.map)[bi]);
      out[pose.name] = [v.x - point[0], v.y - point[1], v.z - point[2]];
    }
    return out;
  }
  // 姿态：{ 骨骼名: { r:[x,y,z], p:[x,y,z], s:[x,y,z] } }，绕骨骼枢轴变换，子骨骼继承父骨骼
  pose(name, map) { this.poses.push({ name, map }); return this; }

  _mats(map) {
    const out = [];
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i]; const o = map[b.name];
      const local = new THREE.Matrix4();
      if (o) {
        const pv = b.pivot; const r = o.r || Z3; const p = o.p || Z3; const s = sv(o.s);
        local.compose(_v.set(pv[0] + p[0], pv[1] + p[1], pv[2] + p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
        local.multiply(_m2.makeTranslation(-pv[0], -pv[1], -pv[2]));
      }
      out.push(b.parent >= 0 ? out[b.parent].clone().multiply(local) : local);
    }
    return out;
  }

  build() {
    const geos = this.parts.map((p) => p.g);
    const g = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    const count = g.attributes.position.count;
    if (this.poses.length) {
      const boneOf = new Uint8Array(count);
      let off = 0;
      for (const p of this.parts) { boneOf.fill(p.bone, off, off + p.n); off += p.n; }
      const P = g.attributes.position.array; const N = g.attributes.normal.array;
      g.morphAttributes.position = [];
      g.morphAttributes.normal = [];
      const idx = {};
      this.poses.forEach((pose, pi) => {
        const mats = this._mats(pose.map);
        const nms = mats.map((m) => new THREE.Matrix3().getNormalMatrix(m));
        const dp = new Float32Array(count * 3); const dn = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const b = boneOf[i];
          if (b === 0 && !pose.map.root) continue;
          const e = mats[b].elements; const ne = nms[b].elements;
          const x = P[i * 3]; const y = P[i * 3 + 1]; const z = P[i * 3 + 2];
          dp[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12] - x;
          dp[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13] - y;
          dp[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14] - z;
          const nx = N[i * 3]; const ny = N[i * 3 + 1]; const nz = N[i * 3 + 2];
          let ax = ne[0] * nx + ne[3] * ny + ne[6] * nz; let ay = ne[1] * nx + ne[4] * ny + ne[7] * nz; let az = ne[2] * nx + ne[5] * ny + ne[8] * nz;
          const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
          dn[i * 3] = ax - nx; dn[i * 3 + 1] = ay - ny; dn[i * 3 + 2] = az - nz;
        }
        g.morphAttributes.position.push(new THREE.BufferAttribute(dp, 3));
        g.morphAttributes.normal.push(new THREE.BufferAttribute(dn, 3));
        idx[pose.name] = pi;
      });
      g.morphTargetsRelative = true;
      g.userData.poses = idx;
    } else g.userData.poses = {};
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.boundingSphere.radius *= 1.3;
    return g;
  }
}
void _n3;

// ———————————————— 缓存 ————————————————
const GEO = new Map();
export function cachedGeo(key, fn) {
  let g = GEO.get(key);
  if (!g) { g = fn(); GEO.set(key, g); }
  return g;
}

// ———————————————— 材质 ————————————————
// 身体材质：顶点色 + 顶点自发光（aGlow），全局脉动强度 GLOW
const GLOW = { value: 1.6 };
let glowStamp = -1;
export function tickGlow(time) {
  if (time === glowStamp) return;
  glowStamp = time;
  GLOW.value = 1.55 + 0.28 * Math.sin(time * 2.4);
}
function patchGlow(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlowPulse = GLOW;
    sh.vertexShader = 'attribute float aGlow;\nvarying float vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = aGlow;');
    sh.fragmentShader = 'varying float vGlow;\nuniform float uGlowPulse;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlowPulse;');
  };
  m.customProgramCacheKey = () => 'unitGlowV1';
}
const MATS = new Map();
const qOp = (op) => (op >= 0.999 ? 1 : Math.max(0.1, Math.round(op * 10) / 10));

export function bodyMat({ hl = null, emp = false, op = 1, tint = null, dim = false } = {}) {
  const q = qOp(op);
  const k = `b|${hl}|${emp}|${q}|${tint}|${dim}`;
  let m = MATS.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.12 });
    if (hl != null) { m.emissive.set(hl); m.emissiveIntensity = 0.32; }
    else if (emp) { m.emissive.set(0x7a3cff); m.emissiveIntensity = 0.2; }
    else if (tint != null) { m.emissive.set(tint); m.emissiveIntensity = 0.25; }
    if (dim) m.color.setScalar(0.55);
    if (q < 1) { m.transparent = true; m.opacity = q; }
    patchGlow(m);
    MATS.set(k, m);
  }
  return m;
}
// 发光晶体材质（按颜色、亮度缓存）
export function crystalMat(color, { ei = 1.5, op = 1, opacity = 1 } = {}) {
  const q = qOp(op * opacity);
  const k = `c|${color}|${ei}|${q}`;
  let m = MATS.get(k);
  if (!m) {
    _c.set(color);
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.6), emissive: color, emissiveIntensity: ei,
      roughness: 0.18, metalness: 0.2, flatShading: true,
    });
    if (q < 1) { m.transparent = true; m.opacity = q; m.depthWrite = q > 0.6; }
    MATS.set(k, m);
  }
  return m;
}

// 径向发光贴图（共享）
let GLOW_TEX = null;
export function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  gr.addColorStop(0.75, 'rgba(255,255,255,0.05)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  GLOW_TEX = new THREE.CanvasTexture(cv);
  GLOW_TEX.colorSpace = THREE.SRGBColorSpace;
  return GLOW_TEX;
}
export function spriteMat(color, opacity = 0.8) {
  const q = Math.round(opacity * 20) / 20;
  const k = `s|${color}|${q}`;
  let m = MATS.get(k);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: q, blending: THREE.AdditiveBlending, depthWrite: false });
    MATS.set(k, m);
  }
  return m;
}

// ———————————————— 攻击时间线 ————————————————
// 返回 [raise, strike]：前摇 0~65% 抬起，65%~100% 挥下，在 windup 时刻到达峰值，随后 0.35s 回收
function atkCurve(t, w) {
  const k = t / w;
  if (k < 0.65) return [ease(k / 0.65), 0];
  if (k < 1) { const u = (k - 0.65) / 0.35; return [1 - u, ease(u)]; }
  const r = (t - w) / 0.35;
  return r < 1 ? [0, 1 - ease(r)] : [0, 0];
}
const ZERO2 = [0, 0];
export function trackAttack(v, a, dt) {
  const st = a.state; const t = a.t || 0; const idx = a.attackIndex || 0;
  if (st === 'attack') {
    const fresh = idx !== v._aIdx || t + 1e-4 < v._aLast;
    v._aIdx = idx; v._aLast = t;
    if (fresh || (v.atkT == null && t < (a.windup || 0.3))) { v.atkT = t; v.atkW = Math.max(0.1, a.windup || 0.3); }
    else if (v.atkT != null) v.atkT += dt;
  } else {
    v._aLast = -1;
    if (v.atkT != null) { if (v.atkT < v.atkW * 0.85) v.atkT = null; else v.atkT += dt; }
  }
  if (v.atkT != null && v.atkT > v.atkW + 0.4) v.atkT = null;
  const c = v.atkT == null ? ZERO2 : atkCurve(v.atkT, v.atkW);
  v.raise = approach(v.raise || 0, c[0], dt * 22);
  v.strike = approach(v.strike || 0, c[1], dt * 22);
  return v;
}

// ———————————————— 视图基类 ————————————————
const BODY = (v) => bodyMat({ hl: v.hl, emp: v.emp, op: v.op, tint: v.tint, dim: v.dimmed });
export class UnitView {
  constructor(entity, renderer, height) {
    this.object3d = new THREE.Group();
    this.body = new THREE.Group();
    this.object3d.add(this.body);
    this.height = height;
    this.renderer = renderer;
    this.low = renderer?.quality === 'low';
    this.detail = this.low ? 0.6 : 1;
    this.team = entity.team;
    this.parts = [];
    this.sprites = [];
    this.hl = null; this.op = 1; this.emp = false; this.tint = null; this.dimmed = false;
    this.dead = !entity.alive; this.deadT = this.dead ? 99 : 0;
    this.t = (entity.id || 0) * 1.37 % 10;
    this.phase = this.t;
    this.walk = 0; this.raise = 0; this.strike = 0; this.atkT = null; this._aIdx = undefined; this._aLast = -1;
    this.animate = null; this.onDie = null; this.onRevive = null;
  }
  mesh(geo, parent = this.body, matFn = BODY, { shadow = true } = {}) {
    const m = new THREE.Mesh(geo, matFn(this));
    m.castShadow = shadow;
    m.receiveShadow = false;
    parent.add(m);
    this.parts.push({ mesh: m, matFn });
    return m;
  }
  sprite(color, size, pos = Z3, parent = this.body, opacity = 0.8) {
    const s = new THREE.Sprite(spriteMat(color, opacity));
    s.scale.set(size, size, 1);
    s.position.set(pos[0], pos[1], pos[2]);
    s.renderOrder = 31;
    s.userData = { color, opacity, size, on: true };
    parent.add(s);
    this.sprites.push(s);
    return s;
  }
  setSprite(s, color = s.userData.color, opacity = s.userData.opacity) {
    s.userData.color = color; s.userData.opacity = opacity;
    s.material = spriteMat(color, opacity * Math.min(1, this.op));
  }
  refresh() {
    for (const p of this.parts) {
      const m = p.matFn(this);
      if (p.mesh.material !== m) p.mesh.material = m;
    }
    for (const s of this.sprites) s.material = spriteMat(s.userData.color, s.userData.opacity * Math.min(1, this.op));
  }
  setHighlight(c) { c = c ?? null; if (c === this.hl) return; this.hl = c; this.refresh(); }
  setOpacity(a) { if (a === this.op) return; this.op = a; this.refresh(); }
  setEmpowered(on) { on = !!on; if (on === this.emp) return; this.emp = on; this.refresh(); }
  update(dt, e, r) {
    if (!(dt >= 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    tickGlow(r?.time ?? 0);
    this.t += dt;
    if (this.dead) this.deadT += dt;
    if (this.animate) this.animate(dt, e || {}, r);
  }
  onDeath(e) { if (this.dead) return; this.dead = true; this.deadT = 0; this.onDie?.(e); }
  onRespawn(e) {
    this.dead = false; this.deadT = 0;
    this.body.position.set(0, 0, 0); this.body.rotation.set(0, 0, 0); this.body.scale.set(1, 1, 1);
    this.onRevive?.(e);
  }
  dispose() {
    // 几何体/材质/贴图均为共享缓存，不释放；只断开引用
    if (this.object3d.parent) this.object3d.parent.remove(this.object3d);
    this.parts.length = 0; this.sprites.length = 0;
  }
}

// morph 权重设置（按姿态名；缺失姿态忽略）
export function setPose(mesh, name, w) {
  const i = mesh.geometry.userData.poses?.[name];
  if (i != null) mesh.morphTargetInfluences[i] = w;
}

// 通用死亡：向后倒下，稍后沉入地面
export function fallDeath(v, { dir = 1, time = 0.45, sink = 60, sinkAt = 0.8, axis = 'z' } = {}) {
  const k = ease(v.deadT / time);
  if (axis === 'z') v.body.rotation.z = dir * k * 1.45;
  else v.body.rotation.x = dir * k * 1.45;
  v.body.position.y = -Math.max(0, v.deadT - sinkAt) * sink;
}

// 安全调用 FX（不存在时忽略）
export function tryFx(renderer, name, params) {
  try { const fx = renderer?.fx; if (fx && typeof fx[name] === 'function') fx[name](params); } catch { /* 特效失败不影响模型 */ }
}
