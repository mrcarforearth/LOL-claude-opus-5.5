// 战争迷雾共享 uniform 与材质注入（地形/树木/草丛/水面/装饰共用；FogRenderer 负责写入纹理）
// 其他代理的材质也可调用 patchFogOfWar(material, key) 接入迷雾（可选）。
import * as THREE from 'three';

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;

export const FOG_UNIFORMS = {
  uFowTex: { value: white },                 // R 通道：1 = 可见
  uFowStrength: { value: 0 },                // 0 = 无迷雾（FogRenderer 就绪后置 1）
  uFowColor: { value: new THREE.Color(0x0a1420) },
  uFowMap: { value: new THREE.Vector4(0, 0, 1 / 15000, 1 / 15000) },   // uv = (x, y) * zw + xy（游戏坐标）
};

export const FOW_VERT_PARS = /* glsl */`
varying vec2 vFowUv;
uniform vec4 uFowMap;
`;
// 放在 #include <project_vertex> 之后（transformed 已含顶点动画）
export const FOW_VERT = /* glsl */`
{
#ifdef USE_INSTANCING
  vec4 fowWp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
  vec4 fowWp = modelMatrix * vec4(transformed, 1.0);
#endif
  vFowUv = vec2(fowWp.x, -fowWp.z) * uFowMap.zw + uFowMap.xy;
}
`;
export const FOW_FRAG_PARS = /* glsl */`
varying vec2 vFowUv;
uniform sampler2D uFowTex;
uniform float uFowStrength;
uniform vec3 uFowColor;
vec3 applyFow(vec3 c) {
  float v = texture2D(uFowTex, vFowUv).r;
  v = smoothstep(0.08, 0.92, v);
  float k = uFowStrength * (1.0 - v);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 f = mix(c, vec3(l), 0.45) * vec3(0.42, 0.48, 0.62) + uFowColor;
  return mix(c, f, k);
}
`;
// 放在 #include <opaque_fragment> 之后（线性空间、色调映射之前）
export const FOW_FRAG = /* glsl */`
gl_FragColor.rgb = applyFow(gl_FragColor.rgb);
`;

/** 把迷雾注入到着色器对象（onBeforeCompile 内调用） */
export function injectFow(shader) {
  shader.uniforms.uFowTex = FOG_UNIFORMS.uFowTex;
  shader.uniforms.uFowStrength = FOG_UNIFORMS.uFowStrength;
  shader.uniforms.uFowColor = FOG_UNIFORMS.uFowColor;
  shader.uniforms.uFowMap = FOG_UNIFORMS.uFowMap;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + FOW_VERT_PARS)
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + FOW_VERT);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FOW_FRAG_PARS)
    .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + FOW_FRAG);
}

/** 给任意内置材质（Lambert/Standard/Basic/Phong…）接入战争迷雾；保留原 onBeforeCompile */
export function patchFogOfWar(material, key = '') {
  if (!material || material.userData.__fow) return material;
  material.userData.__fow = true;
  const prev = material.onBeforeCompile;
  const custom = material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey;
  const prevKey = custom ? material.customProgramCacheKey.bind(material) : null;
  const prevSrc = typeof prev === 'function' ? prev.toString() : '';
  material.onBeforeCompile = function (shader, r) {
    if (typeof prev === 'function') prev.call(this, shader, r);
    injectFow(shader);
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey() : prevSrc) + '|fow|' + key;
  material.needsUpdate = true;
  return material;
}
