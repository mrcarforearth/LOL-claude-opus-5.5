// 材质补丁：共享时间 uniform、风吹摆动（树/草）、战争迷雾注入；每个补丁给出独立的 program cache key
import * as THREE from 'three';
import { injectFow } from './fogshared.js';

export const ENV_UNIFORMS = {
  uTime: { value: 0 },
  uWind: { value: 1 },
};

/** 通用：onBeforeCompile 中先执行 fn(shader) 再注入迷雾 */
export function patch(mat, key, fn) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ENV_UNIFORMS.uTime;
    shader.uniforms.uWind = ENV_UNIFORMS.uWind;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;');
    if (fn) fn(shader);
    injectFow(shader);
  };
  mat.customProgramCacheKey = () => 'rift-' + key;
  mat.needsUpdate = true;
  return mat;
}

/**
 * 风吹摆动（放在 begin_vertex 之后）。base = 开始摆动的本地高度，amp = 每单位高度的偏移量。
 * 按实例位置取相位，形成成片的风浪。
 */
export function windChunk(base, amp, freq = 1.3) {
  return /* glsl */`
{
#ifdef USE_INSTANCING
  vec3 ipw = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
  vec3 ipw = vec3(0.0);
#endif
  float ph = ipw.x * 0.0021 + ipw.z * 0.0017;
  float sw = sin(uTime * ${freq.toFixed(3)} + ph * 6.0) * 0.6 + sin(uTime * ${(freq * 2.3).toFixed(3)} + ph * 13.0) * 0.25
           + sin(uTime * 0.37 + ipw.x * 0.0004) * 0.35;
  float hk = max(transformed.y - ${base.toFixed(1)}, 0.0) * ${amp.toFixed(5)} * uWind;
  transformed.x += sw * hk;
  transformed.z += sw * hk * 0.6 + cos(uTime * ${(freq * 1.7).toFixed(3)} + ph * 9.0) * hk * 0.3;
}
`;
}

/** 植被材质（Lambert + 顶点色 + 实例色 + 风 + 迷雾） */
export function foliageMaterial(key, { base = 60, amp = 0.012, freq = 1.3, side = THREE.FrontSide, emissive = 0x000000, transparent = false, opacity = 1 } = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side, emissive, transparent, opacity, depthWrite: !transparent });
  return patch(mat, key, (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + windChunk(base, amp, freq));
  });
}

/** 普通静态材质（Lambert + 顶点色 + 迷雾） */
export function staticMaterial(key, opts = {}) {
  return patch(new THREE.MeshLambertMaterial({ vertexColors: true, ...opts }), key, null);
}

/** 发光材质（Basic，不受光照；可加色混合）+ 迷雾 */
export function glowMaterial(key, opts = {}) {
  return patch(new THREE.MeshBasicMaterial(opts), key, null);
}
