// 特效 GPU 批处理：实例化公告板精灵（QuadBatch，1 次 draw call）与环形缓冲 GPU 粒子（ParticleSystem，着色器内积分运动）
import { ATLAS_N } from './textures.js';

const INSET = 4 / 128;
const ATLAS_GLSL = `
uniform float uTiles;
vec2 atlasUv(float tile, vec2 uv) {
  vec2 t = vec2(mod(tile, uTiles), floor(tile / uTiles + 0.001));
  uv = ${INSET.toFixed(5)} + uv * ${(1 - 2 * INSET).toFixed(5)};
  return vec2((t.x + uv.x) / uTiles, 1.0 - (t.y + 1.0 - uv.y) / uTiles);
}`;

// ———————————————————— 实例化精灵 ————————————————————
// quad 字段：x,y,z（场景坐标）、w,h（世界尺寸）、rot（屏幕内旋转）、ax,ay,az（非零时沿该世界方向拉伸）、r,g,b,a、tile、visible
export class QuadBatch {
  constructor(THREE, { texture, capacity = 2048, additive = true, renderOrder = 30 } = {}) {
    this.THREE = THREE;
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new Float32Array(capacity * 3);
    this.aCol = new Float32Array(capacity * 4);
    this.aSize = new Float32Array(capacity * 3);
    this.aAxis = new Float32Array(capacity * 4);
    const mk = (arr, n) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('iPos', this.bPos = mk(this.aPos, 3));
    g.setAttribute('iColor', this.bCol = mk(this.aCol, 4));
    g.setAttribute('iSize', this.bSize = mk(this.aSize, 3));
    g.setAttribute('iAxis', this.bAxis = mk(this.aAxis, 4));
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uTiles: { value: ATLAS_N } },
      vertexShader: `
        attribute vec3 iPos; attribute vec4 iColor; attribute vec3 iSize; attribute vec4 iAxis;
        varying vec2 vUv; varying vec4 vColor;
        ${ATLAS_GLSL}
        void main() {
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          float ang = iAxis.w;
          if (dot(iAxis.xyz, iAxis.xyz) > 1e-8) { vec3 a = (viewMatrix * vec4(iAxis.xyz, 0.0)).xyz; ang = atan(a.y, a.x); }
          float c = cos(ang), s = sin(ang);
          vec2 p = position.xy * iSize.xy;
          mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          gl_Position = projectionMatrix * mv;
          vUv = atlasUv(iSize.z, uv);
          vColor = iColor;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.003) discard;
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'fxQuads';
    this.live = [];
    this.free = [];
  }
  // 申请一个精灵（容量满时返回 null）
  alloc() {
    if (this.live.length >= this.capacity) return null;
    const q = this.free.pop() || {};
    q.x = q.y = q.z = 0; q.w = q.h = 50; q.rot = 0; q.ax = q.ay = q.az = 0;
    q.r = q.g = q.b = 1; q.a = 1; q.tile = 0; q.visible = true; q.dead = false;
    this.live.push(q);
    return q;
  }
  release(q) { if (q && !q.dead) q.dead = true; }
  setColor(q, color, intensity = 1) {
    q.r = color.r * intensity; q.g = color.g * intensity; q.b = color.b * intensity;
  }
  flush() {
    const L = this.live;
    let n = 0, w = 0;
    const P = this.aPos, C = this.aCol, S = this.aSize, A = this.aAxis;
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      if (q.dead) { this.free.push(q); continue; }
      L[w++] = q;
      if (!q.visible || q.a <= 0.002 || q.w <= 0) continue;
      const i3 = n * 3, i4 = n * 4;
      P[i3] = q.x; P[i3 + 1] = q.y; P[i3 + 2] = q.z;
      C[i4] = q.r; C[i4 + 1] = q.g; C[i4 + 2] = q.b; C[i4 + 3] = q.a;
      S[i3] = q.w; S[i3 + 1] = q.h; S[i3 + 2] = q.tile;
      A[i4] = q.ax; A[i4 + 1] = q.ay; A[i4 + 2] = q.az; A[i4 + 3] = q.rot;
      n++;
    }
    L.length = w;
    this.geometry.instanceCount = n;
    if (n > 0) for (const b of [this.bPos, this.bCol, this.bSize, this.bAxis]) markRange(b, 0, n * b.itemSize);
    this.count = n;
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

function markRange(attr, offset, count) {
  if (typeof attr.addUpdateRange === 'function') { attr.clearUpdateRanges?.(); attr.addUpdateRange(offset, count); }
  else attr.updateRange = { offset, count };
  attr.needsUpdate = true;
}

// ———————————————————— GPU 粒子 ————————————————————
// 每个粒子只在发射时写一次属性；位置 = p0 + v·(1-e^(-drag·t))/drag - ½g·t²（着色器计算），落地不穿透
export class ParticleSystem {
  constructor(THREE, { texture, capacity = 8192, additive = true, renderOrder = 31 } = {}) {
    this.THREE = THREE;
    this.capacity = capacity;
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new Float32Array(capacity * 3);
    this.aVel = new Float32Array(capacity * 3);
    this.aTime = new Float32Array(capacity * 4);     // 出生时间、寿命、起始尺寸、结束尺寸
    this.aCol = new Float32Array(capacity * 4);      // 起始颜色 + alpha
    this.aCol2 = new Float32Array(capacity * 3);     // 结束颜色
    this.aPhys = new Float32Array(capacity * 4);     // 重力、阻力、图集格、地面高度
    for (let i = 0; i < capacity; i++) { this.aTime[i * 4] = -1e6; this.aTime[i * 4 + 1] = 0; }
    const mk = (arr, n) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.attrs = [
      g.setAttribute('position', mk(this.aPos, 3)).getAttribute('position'),
      g.setAttribute('aVel', mk(this.aVel, 3)).getAttribute('aVel'),
      g.setAttribute('aTime', mk(this.aTime, 4)).getAttribute('aTime'),
      g.setAttribute('aCol', mk(this.aCol, 4)).getAttribute('aCol'),
      g.setAttribute('aCol2', mk(this.aCol2, 3)).getAttribute('aCol2'),
      g.setAttribute('aPhys', mk(this.aPhys, 4)).getAttribute('aPhys'),
    ];
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uTiles: { value: ATLAS_N }, uTime: { value: 0 }, uScale: { value: 800 }, uMaxSize: { value: 256 } },
      vertexShader: `
        attribute vec3 aVel; attribute vec4 aTime; attribute vec4 aCol; attribute vec3 aCol2; attribute vec4 aPhys;
        uniform float uTime; uniform float uScale; uniform float uMaxSize;
        varying vec4 vColor; varying float vTile; varying float vRot;
        void main() {
          float age = uTime - aTime.x;
          if (age < 0.0 || age >= aTime.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          float k = age / aTime.y;
          float drag = aPhys.y;
          float f = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
          vec3 p = position + aVel * f;
          p.y -= 0.5 * aPhys.x * age * age;
          p.y = max(p.y, aPhys.w);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = mix(aTime.z, aTime.w, k);
          gl_PointSize = min(uMaxSize, size * uScale / max(1.0, -mv.z));
          float fade = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.55, 1.0, k));
          vColor = vec4(mix(aCol.rgb, aCol2, k), aCol.a * fade);
          vTile = aPhys.z;
          vRot = fract(aTime.x * 7.13) * 6.2831 + age * (fract(aTime.x * 3.7) - 0.5) * 2.0;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec4 vColor; varying float vTile; varying float vRot;
        ${ATLAS_GLSL}
        void main() {
          vec2 pc = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          pc = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y);
          pc = clamp(pc + 0.5, 0.0, 1.0);
          vec4 t = texture2D(uMap, atlasUv(vTile, vec2(pc.x, 1.0 - pc.y)));
          gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.004) discard;
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    this.points.name = additive ? 'fxParticlesAdd' : 'fxParticlesNormal';
    this._dirtyLo = Infinity; this._dirtyHi = -1; this._wrapped = false;
  }
  // 写入一个粒子（场景坐标）；返回槽位
  write(time, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, r2, g2, b2, grav, drag, tile, floor) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    if (this.cursor === 0) this._wrapped = true;
    const i3 = i * 3, i4 = i * 4;
    this.aPos[i3] = x; this.aPos[i3 + 1] = y; this.aPos[i3 + 2] = z;
    this.aVel[i3] = vx; this.aVel[i3 + 1] = vy; this.aVel[i3 + 2] = vz;
    this.aTime[i4] = time; this.aTime[i4 + 1] = life; this.aTime[i4 + 2] = s0; this.aTime[i4 + 3] = s1;
    this.aCol[i4] = r; this.aCol[i4 + 1] = g; this.aCol[i4 + 2] = b; this.aCol[i4 + 3] = a;
    this.aCol2[i3] = r2; this.aCol2[i3 + 1] = g2; this.aCol2[i3 + 2] = b2;
    this.aPhys[i4] = grav; this.aPhys[i4 + 1] = drag; this.aPhys[i4 + 2] = tile; this.aPhys[i4 + 3] = floor;
    if (i < this._dirtyLo) this._dirtyLo = i;
    if (i > this._dirtyHi) this._dirtyHi = i;
    return i;
  }
  // 提前结束某段槽位（句柄 remove 用）
  kill(from, count, birth) {
    for (let k = 0; k < count; k++) {
      const i = (from + k) % this.capacity;
      if (this.aTime[i * 4] !== birth) continue;   // 已被覆盖
      this.aTime[i * 4 + 1] = 0;
      if (i < this._dirtyLo) this._dirtyLo = i;
      if (i > this._dirtyHi) this._dirtyHi = i;
    }
  }
  update(time, scale, maxSize) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uScale.value = scale;
    if (maxSize) u.uMaxSize.value = maxSize;
    if (this._dirtyHi >= 0) {
      const lo = this._dirtyLo, n = this._dirtyHi - lo + 1;
      for (const a of this.attrs) markRange(a, lo * a.itemSize, n * a.itemSize);
      this._dirtyLo = Infinity; this._dirtyHi = -1;
    }
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
