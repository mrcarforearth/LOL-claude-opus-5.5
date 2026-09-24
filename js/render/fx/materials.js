// 特效着色器与共享几何体：地面贴花（环/圆盘/矩形/扇形/冲击波/符文/标记/预警）、光束/锁链/闪电、拖尾、刀光弧、菲涅尔护盾、光柱
export const DECAL = { RING: 0, DISC: 1, RECT: 2, CONE: 3, SHOCK: 4, RUNE: 5, MARKER: 6, TELEGRAPH: 7, AURA: 8 };
export const BEAM = { ENERGY: 0, CHAIN: 1, LIGHTNING: 2 };

const DECAL_VS = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// uv 约定：RECT 的 u 沿长度（0 起点 → 1 终点），v 横向；其余模式 p = uv*2-1 以中心为原点
const DECAL_FS = `
uniform int uMode; uniform vec3 uColor; uniform vec3 uColor2; uniform float uOpacity; uniform float uWidth;
uniform float uFill; uniform float uTime; uniform float uProgress; uniform float uAngle; uniform float uArrow;
uniform float uLen; uniform float uInner; uniform sampler2D uNoise;
varying vec2 vUv;
const float PI = 3.14159265;
float band(float x, float a, float b, float aa) { return smoothstep(a - aa, a, x) * (1.0 - smoothstep(b, b + aa, x)); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float aa = max(fwidth(r) * 1.5, 0.002);
  vec3 col = uColor; float a = 0.0;
  if (uMode == 0) {                       // 环
    float w = max(uWidth, aa * 2.0);
    a = band(r, 1.0 - w, 1.0 - aa, aa);
    a += exp(-abs(r - (1.0 - w * 0.5)) / max(w * 1.3, 0.01)) * 0.35 * step(r, 1.0);
    a += uFill * (1.0 - smoothstep(1.0 - w - aa, 1.0 - w, r)) * (0.55 + 0.45 * r * r);
    col = mix(uColor, uColor2, smoothstep(1.0 - w, 1.0, r) * 0.6);
  } else if (uMode == 1 || uMode == 8) {  // 圆盘（区域）/ 光环
    float n = texture2D(uNoise, p * 0.55 + vec2(uTime * 0.03, -uTime * 0.021)).r;
    float n2 = texture2D(uNoise, p * 1.3 - vec2(uTime * 0.05, uTime * 0.04)).r;
    float edge = 1.0 - smoothstep(1.0 - aa * 2.0, 1.0, r);
    float rim = band(r, 1.0 - max(uWidth, 0.03), 1.0 - aa, aa);
    float inner = uFill * (0.45 + 0.55 * r * r) * (0.7 + 0.6 * n * n2);
    if (uMode == 8) {
      float ang = atan(p.y, p.x);
      float sw = 0.5 + 0.5 * sin(ang * 6.0 - uTime * 2.5 + r * 8.0);
      inner = uFill * smoothstep(0.2, 1.0, r) * (0.4 + 0.6 * sw) * (0.6 + 0.8 * n);
    }
    a = (inner + rim * 0.9) * edge;
    col = mix(uColor2, uColor, clamp(r * 1.2, 0.0, 1.0));
  } else if (uMode == 2) {                // 矩形（直线技能/地面线）
    float u = vUv.x, v = abs(vUv.y * 2.0 - 1.0);
    float aw = fwidth(v) * 1.5;
    float au = fwidth(u) * 1.5;
    float body = 1.0 - smoothstep(1.0 - aw, 1.0, v);
    float edgeW = clamp(uWidth, 0.04, 0.5);
    float edge = smoothstep(1.0 - edgeW - aw, 1.0 - edgeW, v) * body;
    float head = 0.0;
    if (uArrow > 0.0) {                   // 末端箭头：三角形轮廓
      float hl = uArrow;                  // 箭头长度（占总长比例）
      float t = (u - (1.0 - hl)) / hl;    // 0..1
      float tri = step(0.0, t) * (1.0 - smoothstep(1.0 - (1.0 - t) - aw * 2.0, 1.0 - t, v));
      float triEdge = tri * smoothstep(1.0 - t - edgeW * 1.8, 1.0 - t - aw, v);
      head = tri * 0.35 + triEdge;
      body *= 1.0 - step(0.0, t);
      edge *= 1.0 - step(0.0, t);
    }
    float startFade = smoothstep(0.0, au * 2.0 + 0.01, u) * (1.0 - smoothstep(1.0 - au * 2.0, 1.0, u));
    float fill = uFill * body * (0.55 + 0.45 * u);
    float prog = uProgress > 0.0 ? body * step(u, uProgress) * 0.45 : 0.0;
    a = (fill + edge * 0.9 + head + prog) * startFade;
    col = mix(uColor, uColor2, edge);
  } else if (uMode == 3) {                // 扇形
    float ang = abs(atan(p.y, p.x));
    float aang = fwidth(ang) * 1.5 + 0.004;
    float inside = (1.0 - smoothstep(1.0 - aa, 1.0, r)) * (1.0 - smoothstep(uAngle - aang, uAngle, ang));
    float rim = band(r, 1.0 - max(uWidth, 0.02), 1.0 - aa, aa) * step(ang, uAngle);
    float side = (1.0 - smoothstep(0.0, max(uWidth, 0.02) * 1.2 / max(r, 0.05), uAngle - ang)) * step(r, 1.0) * step(ang, uAngle);
    float prog = uProgress > 0.0 ? inside * step(r, uProgress) * 0.4 : 0.0;
    a = inside * uFill * (0.4 + 0.6 * r) + (rim + side) * 0.9 + prog;
    col = mix(uColor, uColor2, clamp(rim + side, 0.0, 1.0));
  } else if (uMode == 4) {                // 冲击波（uProgress 0→1 外扩）
    float R = uProgress;
    float w = mix(0.28, 0.05, R);
    float n = texture2D(uNoise, vec2(atan(p.y, p.x) / PI * 2.0, R * 0.5)).r;
    a = exp(-pow((r - R) / w, 2.0)) * (0.7 + 0.5 * n);
    a += (1.0 - smoothstep(0.0, R, r)) * 0.18 * (1.0 - R);
    a *= 1.0 - smoothstep(0.96, 1.0, r);
    col = mix(uColor2, uColor, smoothstep(R - w, R, r));
  } else if (uMode == 5) {                // 符文圈（回城/升级）
    float ang = atan(p.y, p.x);
    float ringA = band(r, 0.93, 0.975, aa) + band(r, 0.7, 0.72, aa) * 0.9 + band(r, 0.36, 0.375, aa) * 0.7;
    float rot = ang + uTime * 0.35;
    float ticks = band(r, 0.76, 0.9, aa) * step(0.72, fract(rot * 18.0 / (2.0 * PI)));
    float glyph = band(r, 0.46, 0.64, aa) * step(0.55, texture2D(uNoise, vec2(floor((ang - uTime * 0.25) * 8.0 / PI) * 0.13, floor(r * 9.0) * 0.21)).r)
      * step(0.25, fract((ang - uTime * 0.25) * 16.0 / (2.0 * PI)));
    float spokes = band(r, 0.375, 0.7, aa) * (1.0 - smoothstep(0.0, 0.03, abs(fract((ang + uTime * 0.2) * 3.0 / (2.0 * PI) + 0.5) - 0.5)));
    float glow = exp(-r * 3.0) * 0.6 + exp(-abs(r - 0.95) * 16.0) * 0.4;
    a = (ringA + ticks * 0.8 + glyph * 0.75 + spokes * 0.7) * smoothstep(0.0, 0.3, uProgress) + glow * uFill;
    col = mix(uColor, uColor2, clamp(1.0 - r, 0.0, 1.0) * 0.7);
  } else if (uMode == 6) {                // 点击标记：四个向内收缩的箭头 + 细环
    float R = mix(1.0, 0.35, uProgress);
    float ang = atan(p.y, p.x) + uAngle;
    float seg = fract(ang / (PI * 0.5) + 0.5) - 0.5;          // 每 90° 一个箭头
    float lat = abs(seg) * r * PI * 0.5;
    float rr = r - R * 0.72;
    float chev = (1.0 - smoothstep(0.035, 0.055, abs(rr - lat * 0.9))) * (1.0 - smoothstep(0.0, 0.16, lat)) * step(-0.02, rr);
    float ring = band(r, R * 0.96 - 0.035, R * 0.96, aa) * 0.55;
    a = (chev + ring) * (1.0 - smoothstep(0.7, 1.0, uProgress));
  } else if (uMode == 7) {                // 预警：外圈 + 由内向外填充
    float rim = band(r, 1.0 - max(uWidth, 0.02), 1.0 - aa, aa);
    float fillR = uProgress;
    float fill = (1.0 - smoothstep(fillR - aa, fillR, r)) * (0.28 + 0.35 * smoothstep(fillR - 0.25, fillR, r));
    float base = (1.0 - smoothstep(1.0 - aa, 1.0, r)) * uFill;
    a = rim * 0.95 + fill + base;
    col = mix(uColor, uColor2, rim);
  }
  if (uInner > 0.0) a *= smoothstep(uInner - aa, uInner, r);   // 环形镂空（内半径）
  gl_FragColor = vec4(col, clamp(a, 0.0, 4.0) * uOpacity);
  if (gl_FragColor.a < 0.003) discard;
  #include <colorspace_fragment>
}`;

export function makeDecalMaterial(THREE, noise, { additive = true } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMode: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uColor2: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 1 }, uWidth: { value: 0.1 }, uFill: { value: 0 }, uTime: { value: 0 }, uProgress: { value: 0 },
      uAngle: { value: 0.5 }, uArrow: { value: 0 }, uLen: { value: 1 }, uInner: { value: 0 }, uNoise: { value: noise },
    },
    vertexShader: DECAL_VS, fragmentShader: DECAL_FS,
    transparent: true, depthWrite: false, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    extensions: { derivatives: true }, fog: false,
  });
}

// 贴地网格：N×N 顶点，位置由 CPU 按地形高度写入（见 placeDecal）
export function makeGridGeometry(THREE, n = 13) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = j / (n - 1);
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const pa = new THREE.BufferAttribute(pos, 3);
  pa.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.n = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return g;
}

// 把贴花网格铺到地面：中心 (cx,cy)，长宽 (sx,sy)，游戏平面旋转 rot；originU/originV 为中心在 uv 中的位置（矩形从起点延伸用）
export function placeDecal(mesh, heightAt, cx, cy, sx, sy, rot, lift = 4, ou = 0.5, ov = 0.5, flat = false) {
  const g = mesh.geometry, n = g.userData.n, P = g.attributes.position.array;
  const c = Math.cos(rot), s = Math.sin(rot);
  const h0 = heightAt(cx, cy);
  let maxH = 0;
  for (let j = 0; j < n; j++) {
    const lv = (j / (n - 1) - ov) * sy;
    for (let i = 0; i < n; i++) {
      const lu = (i / (n - 1) - ou) * sx;
      const dx = lu * c - lv * s, dy = lu * s + lv * c;
      const h = (flat ? h0 : heightAt(cx + dx, cy + dy)) + lift;
      const k = (j * n + i) * 3;
      P[k] = dx; P[k + 1] = h; P[k + 2] = -dy;
      if (h > maxH) maxH = h;
    }
  }
  g.attributes.position.needsUpdate = true;
  g.boundingSphere.center.set(0, maxH * 0.5, 0);
  g.boundingSphere.radius = Math.hypot(sx, sy) * 0.75 + maxH;
  mesh.position.set(cx, 0, -cy);
}

// —— 光束：摄像机朝向的条带（u 沿长度，v 横向）——
const BEAM_FS = `
uniform vec3 uColor; uniform vec3 uCore; uniform float uOpacity; uniform float uTime; uniform float uLen; uniform int uMode; uniform sampler2D uNoise;
varying vec2 vUv;
void main() {
  float u = vUv.x, v = vUv.y * 2.0 - 1.0;
  float ends = smoothstep(0.0, 0.04, u) * (1.0 - smoothstep(0.96, 1.0, u));
  float a = 0.0; vec3 col = uColor;
  if (uMode == 1) {                        // 锁链：链环明暗交替
    float link = fract(u * uLen / 46.0);
    float ring = abs(v) < mix(0.9, 0.45, step(0.5, link)) ? 1.0 : 0.0;
    float shade = 0.55 + 0.45 * sin(link * 6.2831);
    a = ring * (0.6 + 0.4 * shade) * (1.0 - smoothstep(0.7, 1.0, abs(v)));
    col = mix(uColor * 0.55, uCore, shade * 0.6);
    a += exp(-v * v * 3.0) * 0.25;
  } else {
    float wob = uMode == 2 ? (texture2D(uNoise, vec2(u * uLen / 900.0 - uTime * 3.0, uTime * 1.7)).r - 0.5) * 1.6 : 0.0;
    float vv = v - wob;
    float n = texture2D(uNoise, vec2(u * uLen / 380.0 - uTime * 2.2, vUv.y * 0.6 + uTime * 0.3)).r;
    float core = exp(-vv * vv * (uMode == 2 ? 60.0 : 14.0));
    float glow = exp(-vv * vv * (uMode == 2 ? 8.0 : 2.6));
    a = core * 1.2 + glow * (0.35 + 0.65 * n);
    col = mix(uColor, uCore, core);
  }
  gl_FragColor = vec4(col, a * ends * uOpacity);
  if (gl_FragColor.a < 0.003) discard;
  #include <colorspace_fragment>
}`;

export function makeBeamMaterial(THREE, noise) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 1 },
      uTime: { value: 0 }, uLen: { value: 100 }, uMode: { value: 0 }, uNoise: { value: noise },
    },
    vertexShader: DECAL_VS, fragmentShader: BEAM_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}
export function makeStripGeometry(THREE, segs) {
  const g = new THREE.BufferGeometry();
  const n = segs + 1;
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), fade = new Float32Array(n * 2), idx = [];
  for (let i = 0; i < n; i++) {
    uv[i * 4] = i / segs; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = i / segs; uv[i * 4 + 3] = 1;
    if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
  const fa = new THREE.BufferAttribute(fade, 1); fa.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aFade', fa);
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

// —— 拖尾（ribbon）——
export function makeRibbonMaterial(THREE) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 1 } },
    vertexShader: `attribute float aFade; varying vec2 vUv; varying float vFade;
      void main() { vUv = uv; vFade = aFade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uCore; uniform float uOpacity; varying vec2 vUv; varying float vFade;
      void main() {
        float v = vUv.y * 2.0 - 1.0;
        float core = exp(-v * v * 10.0);
        float a = (exp(-v * v * 2.5) * 0.7 + core * 0.6) * pow(vFade, 1.4);
        gl_FragColor = vec4(mix(uColor, uCore, core * vFade * 0.8), a * uOpacity);
        if (gl_FragColor.a < 0.003) discard;
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}

// —— 刀光弧：扇环几何（uv.x 沿弧 0→1，uv.y 径向 0 内 → 1 外），着色器按进度扫过 ——
export function makeArcGeometry(THREE, arcRad, segs = 40, inner = 0.45) {
  const g = new THREE.BufferGeometry();
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, a = -arcRad / 2 + t * arcRad, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * inner, 0, -s * inner, c, 0, -s);
    uv.push(t, 0, t, 1);
    if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
export function makeSlashMaterial(THREE) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 1 }, uProgress: { value: 0 }, uTrail: { value: 0.65 } },
    vertexShader: DECAL_VS,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uCore; uniform float uOpacity; uniform float uProgress; uniform float uTrail; varying vec2 vUv;
      void main() {
        float head = uProgress * (1.0 + uTrail);
        float d = head - vUv.x;                         // 距刀锋前沿（弧向）
        float trail = d >= 0.0 ? exp(-d / (uTrail * 0.45)) : 0.0;
        trail *= 1.0 - smoothstep(0.0, 0.02, -d);
        float radial = pow(vUv.y, 2.2);
        float edge = smoothstep(0.82, 0.97, vUv.y) * (1.0 - smoothstep(0.97, 1.0, vUv.y));
        float a = trail * (radial * 0.9 + edge * 1.4);
        vec3 col = mix(uColor, uCore, clamp(edge * trail * 1.2, 0.0, 1.0));
        gl_FragColor = vec4(col, a * uOpacity);
        if (gl_FragColor.a < 0.003) discard;
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}

// —— 菲涅尔护盾泡 ——
export function makeShieldMaterial(THREE, noise) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, uTime: { value: 0 }, uHit: { value: 0 }, uNoise: { value: noise } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vP = position;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uHit; uniform sampler2D uNoise;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float fres = pow(f, 2.2);
        vec2 q = vec2(atan(vP.z, vP.x) * 0.6366, vP.y * 1.2);
        float n = texture2D(uNoise, q * 0.7 + vec2(uTime * 0.08, -uTime * 0.13)).r;
        float hex = abs(fract(q.x * 5.0 + floor(q.y * 5.0) * 0.5) - 0.5) + abs(fract(q.y * 5.0) - 0.5);
        float cells = smoothstep(0.62, 0.7, hex) * 0.35;
        float band = exp(-pow(fract(vP.y * 0.6 - uTime * 0.5) - 0.5, 2.0) * 60.0) * 0.35;
        float a = fres * (0.85 + 0.5 * n) + (cells + band) * (0.25 + fres) + 0.05 + uHit * 0.6;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), fres * 0.35 + uHit * 0.4), a * uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
  });
}

// —— 光柱（开口圆柱，uv.y 底 0 → 顶 1）——
export function makePillarMaterial(THREE, noise) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 1 }, uTime: { value: 0 }, uNoise: { value: noise } },
    vertexShader: DECAL_VS,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uCore; uniform float uOpacity; uniform float uTime; uniform sampler2D uNoise; varying vec2 vUv;
      void main() {
        float h = vUv.y;
        float streak = texture2D(uNoise, vec2(vUv.x * 3.0, h * 0.8 - uTime * 0.9)).r;
        float streak2 = texture2D(uNoise, vec2(vUv.x * 7.0 + 0.3, h * 1.6 - uTime * 1.7)).r;
        float fall = pow(1.0 - h, 1.6) * smoothstep(0.0, 0.06, h + 0.02);
        float a = fall * (0.45 + 0.9 * streak * streak2);
        gl_FragColor = vec4(mix(uColor, uCore, fall * streak * 0.7), a * uOpacity);
        if (gl_FragColor.a < 0.003) discard;
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}
