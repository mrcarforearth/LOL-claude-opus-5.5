// 英雄模型工具包：程序化几何、蓝图（骨骼 + 部件）→ 合并为单个 SkinnedMesh（顶点色 + 顶点特效属性 aFx）、共享卡通材质及其变体、发光贴图
// 约定：原点在脚底中心，正前方 +X，上方 +Y，右侧 +Z（左侧 -Z）。绑定姿态下所有骨骼无旋转，部件坐标 = 骨骼局部偏移。
import * as THREE from 'three';

export const PI = Math.PI;
export const TAU = PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
export const mix = (a, b, t) => a + (b - a) * t;

// 细节等级（圆形截面分段倍率），低画质时降低
export const DETAIL = { k: 1 };
const sg = (n, min = 3) => Math.max(min, Math.round(n * DETAIL.k));

// —— 基础几何 ——
export const geo = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  sph: (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, sg(ws), sg(hs, 2)),
  // 部分球面：phi 为经度（phi=π 指向 +X 前方），theta 为纬度（0 = 顶部）
  sphPart: (r, phiStart, phiLen, thStart, thLen, ws = 14, hs = 8) =>
    new THREE.SphereGeometry(r, sg(ws), sg(hs, 2), phiStart, phiLen, thStart, thLen),
  cyl: (rt, rb, h, s = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, sg(s), 1, open),
  cone: (r, h, s = 10) => new THREE.ConeGeometry(r, h, sg(s)),
  tor: (R, r, rs = 8, ts = 20, arc = TAU) => new THREE.TorusGeometry(R, r, sg(rs), sg(ts), arc),
  lathe: (pts, s = 14) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(Math.max(0, p[0]), p[1])), sg(s)),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  oct: (r) => new THREE.OctahedronGeometry(r),
  dodec: (r) => new THREE.DodecahedronGeometry(r),
  // 二维轮廓挤出（XY 平面轮廓，沿 Z 居中挤出）
  extrude(pts, depth, bevel = 0) {
    const sh = new THREE.Shape();
    pts.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, {
      depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4, steps: 1,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  },
  // 锥形胶囊：关节在原点，沿 -Y 延伸 len；上端半径 r0，下端 r1（两端为半球，便于关节旋转无缝）
  capsule(r0, r1, len, s = 12) {
    const pts = [];
    const n = 4;
    for (let i = 0; i <= n; i++) { const a = -PI / 2 + (i / n) * (PI / 2); pts.push([Math.cos(a) * r1, -len + Math.sin(a) * r1]); }
    for (let i = 0; i <= n; i++) { const a = (i / n) * (PI / 2); pts.push([Math.cos(a) * r0, Math.sin(a) * r0]); }
    return geo.lathe(pts, s);
  },
  // 锥形管（沿曲线，半径可为函数 r(t)），写入参数属性 tp（0..1，供链式蒙皮）
  tube(points, radius, segs = 16, rs = 8) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    segs = sg(segs, 4); rs = sg(rs);
    const fr = curve.computeFrenetFrames(segs, false);
    const pos = [], nor = [], tp = [], idx = [];
    const P = new THREE.Vector3(), N = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      curve.getPointAt(t, P);
      const r = typeof radius === 'function' ? radius(t) : radius;
      for (let j = 0; j <= rs; j++) {
        const a = (j / rs) * TAU;
        N.copy(fr.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(fr.binormals[i], Math.sin(a)).normalize();
        pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
        nor.push(N.x, N.y, N.z);
        tp.push(t);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < rs; j++) {
        const a = i * (rs + 1) + j, b = (i + 1) * (rs + 1) + j;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('tp', new THREE.Float32BufferAttribute(tp, 1));
    g.setIndex(idx);
    g.userData.curve = curve;
    return g;
  },
  // 细分平面（披风、裙摆等可弯曲布料），默认顶边在 y=0、向 -Y 垂下，法线朝 -X（背后）
  cloth(wTop, wBot, h, bulge = 0, ws = 6, hs = 6) {
    const g = new THREE.PlaneGeometry(1, 1, sg(ws), sg(hs));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = 0.5 - p.getY(i); // v: 0 顶 → 1 底
      const w = mix(wTop, wBot, v);
      const z = (u - 0.5) * w;
      const x = -bulge * Math.cos((u - 0.5) * PI) * (0.4 + 0.6 * v);
      p.setXYZ(i, x, -v * h, z);
    }
    g.computeVertexNormals();
    return g;
  },
};

// 反面副本：翻转绕序与法线（布料双面用）
export function flipGeo(g) {
  const f = g.clone();
  if (!f.index) { const n = f.attributes.position.count; const ix = []; for (let i = 0; i < n; i++) ix.push(i); f.setIndex(ix); }
  const I = f.index;
  for (let t = 0; t < I.count; t += 3) { const b = I.getX(t + 1); I.setX(t + 1, I.getX(t + 2)); I.setX(t + 2, b); }
  const N = f.attributes.normal;
  for (let i = 0; i < N.count; i++) N.setXYZ(i, -N.getX(i), -N.getY(i), -N.getZ(i));
  return f;
}

// 星形轮廓点（拉克丝魔杖宝石等）
export function starPts(n, r0, r1, rot = PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * TAU;
    const r = i % 2 ? r1 : r0;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

// —— 蓝图：骨骼定义 + 部件列表，build() 合并为一个带蒙皮属性的 BufferGeometry ——
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

export class Blueprint {
  constructor(id) {
    this.id = id;
    this.bones = [];
    this.map = new Map();
    this.parts = [];
    this.meta = {};
    this.overlays = []; // (view, bones) => void：每个实例创建的叠加物（发光、精灵等）
  }
  bone(name, parent, x = 0, y = 0, z = 0) {
    const p = parent ? this.map.get(parent) : null;
    if (parent && !p) throw new Error(`骨骼 ${name} 的父骨骼 ${parent} 不存在`);
    const b = { name, parent: parent || null, idx: this.bones.length, pos: [x, y, z], world: p ? [p.world[0] + x, p.world[1] + y, p.world[2] + z] : [x, y, z] };
    this.bones.push(b);
    this.map.set(name, b);
    return b;
  }
  has(name) { return this.map.has(name); }
  // 链式骨骼：沿点列（相对父骨骼）逐段创建，返回骨骼名数组
  chain(prefix, parent, pts) {
    const names = [];
    let prev = parent;
    let last = [0, 0, 0];
    pts.forEach((p, i) => {
      const n = `${prefix}${i}`;
      this.bone(n, prev, p[0] - last[0], p[1] - last[1], p[2] - last[2]);
      last = p; prev = n; names.push(n);
    });
    return names;
  }
  // o: p 位置, r 欧拉旋转, s 缩放, glow 自发光强度, shine 金属高光, c2 顶部渐变色, chain 链式蒙皮骨骼名数组, mirror 沿 Z 镜像
  add(bone, g, color, o = {}) {
    if (!this.map.has(bone)) throw new Error(`部件挂载的骨骼 ${bone} 不存在`);
    this.parts.push({ bone, g, color, o });
    return this;
  }
  // 左右对称：o.p/o.r 以右侧（+Z）为准，左侧自动镜像
  pair(base, g, color, o = {}) {
    this.add(base + 'R', g, color, o);
    this.add(base + 'L', g.clone(), color, { ...o, mirror: true });
    return this;
  }
  build() {
    const prepared = [];
    let nv = 0, ni = 0;
    for (const part of this.parts) {
      let g = part.g;
      if (!g.index) {
        const n = g.attributes.position.count;
        const ix = new Array(n);
        for (let i = 0; i < n; i++) ix[i] = i;
        g.setIndex(ix);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      const o = part.o;
      const bw = this.map.get(part.bone).world;
      const s = o.s == null ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s;
      const r = o.r || [0, 0, 0];
      const p = o.p || [0, 0, 0];
      _e.set(r[0], r[1], r[2], o.order || 'XYZ');
      _q.setFromEuler(_e);
      _m.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
      if (o.mirror) _m.premultiply(new THREE.Matrix4().makeScale(1, 1, -1));
      _m.premultiply(new THREE.Matrix4().makeTranslation(bw[0], bw[1], bw[2]));
      const gg = g.clone();
      gg.applyMatrix4(_m);
      const flip = _m.determinant() < 0;
      prepared.push({ part, g: gg, flip });
      nv += gg.attributes.position.count;
      ni += gg.index.count;
    }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), fx = new Float32Array(nv * 2);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const { part, g, flip } of prepared) {
      const o = part.o;
      const P = g.attributes.position, N = g.attributes.normal;
      const n = P.count;
      const bi = this.map.get(part.bone).idx;
      _c.set(part.color);
      let y0 = 0, y1 = 1;
      if (o.c2 != null) {
        _c2.set(o.c2);
        g.computeBoundingBox();
        y0 = g.boundingBox.min.y; y1 = g.boundingBox.max.y;
      }
      // 链式蒙皮
      let chain = null;
      if (o.chain) {
        chain = o.chain.map((nm) => this.map.get(nm));
        const tpA = g.attributes.tp;
        const a = chain[0].world, b = chain[chain.length - 1].world;
        const D = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const dd = D[0] * D[0] + D[1] * D[1] + D[2] * D[2] || 1;
        chain.param = (i) => {
          if (tpA && o.chainParam !== false) return tpA.getX(i) * chain.length; // 管道：t*n，最后一段只跟随末骨骼
          const x = P.getX(i) - a[0], y = P.getY(i) - a[1], z = P.getZ(i) - a[2];
          return ((x * D[0] + y * D[1] + z * D[2]) / dd) * (chain.length - 1);
        };
      }
      for (let i = 0; i < n; i++) {
        const k = vo + i;
        pos[k * 3] = P.getX(i); pos[k * 3 + 1] = P.getY(i); pos[k * 3 + 2] = P.getZ(i);
        nor[k * 3] = N.getX(i); nor[k * 3 + 1] = N.getY(i); nor[k * 3 + 2] = N.getZ(i);
        if (o.c2 != null) {
          const t = clamp01((P.getY(i) - y0) / (y1 - y0 || 1));
          col[k * 3] = mix(_c.r, _c2.r, t); col[k * 3 + 1] = mix(_c.g, _c2.g, t); col[k * 3 + 2] = mix(_c.b, _c2.b, t);
        } else { col[k * 3] = _c.r; col[k * 3 + 1] = _c.g; col[k * 3 + 2] = _c.b; }
        fx[k * 2] = o.glow || 0; fx[k * 2 + 1] = o.shine || 0;
        if (chain) {
          const sp = clamp(chain.param(i), 0, chain.length - 1);
          const j = Math.min(chain.length - 2, Math.floor(sp));
          if (chain.length === 1 || j < 0) { si[k * 4] = chain[0].idx; sw[k * 4] = 1; }
          else {
            const f = sp - j;
            si[k * 4] = chain[j].idx; sw[k * 4] = 1 - f;
            si[k * 4 + 1] = chain[j + 1].idx; sw[k * 4 + 1] = f;
          }
        } else { si[k * 4] = bi; sw[k * 4] = 1; }
      }
      const I = g.index;
      for (let t = 0; t < I.count; t += 3) {
        const a = I.getX(t), b = I.getX(t + 1), c = I.getX(t + 2);
        index[io++] = vo + a;
        index[io++] = vo + (flip ? c : b);
        index[io++] = vo + (flip ? b : c);
      }
      vo += n;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('aFx', new THREE.BufferAttribute(fx, 2));
    out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    out.setIndex(new THREE.BufferAttribute(index, 1));
    out.computeBoundingBox();
    out.computeBoundingSphere();
    for (const pt of this.parts) pt.g.dispose();
    this.parts.length = 0;
    return out;
  }
}

// 实例化：创建骨骼层级与 SkinnedMesh（几何体共享）
export function instantiate(bp, geometry, material) {
  const bones = bp.bones.map((d) => { const b = new THREE.Bone(); b.name = d.name; b.position.fromArray(d.pos); return b; });
  const roots = [];
  bp.bones.forEach((d, i) => { if (d.parent) bones[bp.map.get(d.parent).idx].add(bones[i]); else roots.push(bones[i]); });
  const inverses = bp.bones.map((d) => new THREE.Matrix4().makeTranslation(-d.world[0], -d.world[1], -d.world[2]));
  const mesh = new THREE.SkinnedMesh(geometry, material);
  for (const r of roots) mesh.add(r);
  mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  const bs = geometry.boundingSphere;
  mesh.boundingSphere = new THREE.Sphere(bs.center.clone(), bs.radius * 1.35 + 20);
  const byName = {};
  bones.forEach((b) => (byName[b.name] = b));
  return { mesh, bones, byName };
}

// —— 材质：卡通渐变 + 边缘光 + 顶点自发光 + 伪金属高光 ——
export const SHARED = { time: { value: 0 } };
let GRAD = null;
function gradientMap() {
  if (GRAD) return GRAD;
  const n = 64;
  const d = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = i / (n - 1);
    const v = 0.4 + 0.42 * smooth((c - 0.4) / 0.14) + 0.2 * smooth((c - 0.68) / 0.24);
    const b = Math.round(clamp01(v) * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  GRAD = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat);
  GRAD.magFilter = GRAD.minFilter = THREE.LinearFilter;
  GRAD.generateMipmaps = false;
  GRAD.needsUpdate = true;
  return GRAD;
}

const MATS = new Map();
const VERT_HEAD = 'attribute vec2 aFx;\nvarying vec2 vFx;\n';
const FRAG_HEAD = 'uniform vec3 uRimColor;\nuniform float uRim;\nuniform float uGlowK;\nuniform float uTime;\nuniform vec3 uTint;\nuniform float uTintK;\nvarying vec2 vFx;\n';
const FRAG_BODY = `#include <emissivemap_fragment>
{
  vec3 vdir = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 2.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, uTint, uTintK);
  totalEmissiveRadiance += uRimColor * (fres * uRim);
  float gl = vFx.x * uGlowK * (0.86 + 0.14 * sin(uTime * 3.1 + vViewPosition.y * 0.02));
  totalEmissiveRadiance += diffuseColor.rgb * gl;
  #if NUM_DIR_LIGHTS > 0
  if (vFx.y > 0.0) {
    vec3 hv = normalize(directionalLights[0].direction + vdir);
    float sp = pow(max(dot(normal, hv), 0.0), 18.0);
    totalEmissiveRadiance += (directionalLights[0].color * 0.1 + diffuseColor.rgb * 0.55) * (sp * vFx.y) + diffuseColor.rgb * (fres * vFx.y * 0.45);
  }
  #endif
}`;

// 变体参数：rim 边缘光颜色/强度，glowK 自发光倍率，tint/tintK 整体染色，opacity
export function champMat({ rim = 0xa8c8ff, rimI = 0.2, glowK = 1, tint = 0xffffff, tintK = 0, opacity = 1 } = {}) {
  const op = opacity >= 0.995 ? 1 : Math.max(0.05, Math.round(opacity * 20) / 20);
  const key = `${rim}|${rimI.toFixed(2)}|${glowK.toFixed(2)}|${tint}|${tintK.toFixed(2)}|${op}`;
  let m = MATS.get(key);
  if (m) return m;
  m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() });
  const u = {
    uRimColor: { value: new THREE.Color(rim) }, uRim: { value: rimI }, uGlowK: { value: glowK },
    uTime: SHARED.time, uTint: { value: new THREE.Color(tint) }, uTintK: { value: tintK },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFx = aFx;');
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <emissivemap_fragment>', FRAG_BODY);
  };
  m.customProgramCacheKey = () => 'champToonV2';
  if (op < 1) { m.transparent = true; m.opacity = op; m.depthWrite = op > 0.5; }
  MATS.set(key, m);
  return m;
}

// 叠加发光材质（加色混合）
const ADD = new Map();
export function addMat(color, opacity = 1) {
  const key = `${color}|${opacity}`;
  let m = ADD.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    ADD.set(key, m);
  }
  return m;
}

// 径向发光贴图（纯数据生成，不依赖 DOM）
let GLOW_TEX = null;
export function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const n = 64;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.pow(clamp01(1 - r), 2.2);
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
    }
  }
  GLOW_TEX = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  GLOW_TEX.magFilter = GLOW_TEX.minFilter = THREE.LinearFilter;
  GLOW_TEX.generateMipmaps = false;
  GLOW_TEX.needsUpdate = true;
  return GLOW_TEX;
}
const SPR = new Map();
export function spriteMat(color, opacity = 0.85) {
  const key = `${color}|${opacity}`;
  let m = SPR.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    SPR.set(key, m);
  }
  return m;
}
export function glowSprite(color, size, opacity = 0.85) {
  const s = new THREE.Sprite(spriteMat(color, opacity));
  s.scale.set(size, size, size);
  s.renderOrder = 5;
  return s;
}

// 共享几何缓存（叠加物使用）
const GEO = new Map();
export function cachedGeo(key, fn) {
  let g = GEO.get(key);
  if (!g) { g = fn(); GEO.set(key, g); }
  return g;
}
