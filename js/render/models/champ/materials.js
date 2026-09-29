// 英雄模型共享材质：卡通渐变（MeshToonMaterial + 渐变贴图）+ 菲涅尔边缘光 + 顶点自发光（aFx.x）+ 伪金属高光（aFx.y）
// 所有英雄共用同一套着色器程序；不同的边缘光/染色/透明度组合是缓存的材质变体（champMat(opts) 同参数返回同一对象）。
// 另含：加色发光材质 addMat、径向发光精灵 glowSprite、悬停描边材质 outlineMat、共享几何缓存 cachedGeo。
import * as THREE from 'three';
import { clamp01, smooth } from './kit.js';

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

// —— 悬停描边：沿（蒙皮后）法线外扩的背面壳，与本体共享几何与骨架，只在高亮时显示 ——
const OUTLINE = new Map();
export function outlineMat(color, width = 3.2) {
  const key = `${color}|${width}`;
  let m = OUTLINE.get(key);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false, transparent: true, opacity: 0.95, depthWrite: true });
  const u = { uOutline: { value: width } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOutline = u.uOutline;
    sh.vertexShader = 'uniform float uOutline;\n' + sh.vertexShader.replace('#include <skinning_vertex>',
      '#include <skinning_vertex>\n#ifdef USE_SKINNING\n\ttransformed += normalize(objectNormal) * uOutline;\n#endif');
  };
  m.customProgramCacheKey = () => 'champOutlineV1';
  OUTLINE.set(key, m);
  return m;
}
