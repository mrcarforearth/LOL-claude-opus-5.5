// 河道水面：只在河床低于水位的格子生成网格；着色器含深浅色、流动噪声、菲涅尔、天空反射、高光、岸边泡沫、焦散与战争迷雾
import * as THREE from 'three';
import { WATER_LEVEL } from './heightfield.js';
import { FOG_UNIFORMS, FOW_FRAG_PARS } from './fogshared.js';
import { ENV_UNIFORMS } from './matpatch.js';

export function buildWater(hf, md, detailTex, renderer, step = 2) {
  const { V, H, D0, cell } = hf;
  // 河道包围盒 → 网格范围
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of md.RIVER.path) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = 1300;
  const i0 = Math.max(0, Math.floor((x0 - pad - D0) / cell)), i1 = Math.min(V - 1, Math.ceil((x1 + pad - D0) / cell));
  const j0 = Math.max(0, Math.floor((y0 - pad - D0) / cell)), j1 = Math.min(V - 1, Math.ceil((y1 + pad - D0) / cell));
  const nx = Math.floor((i1 - i0) / step), ny = Math.floor((j1 - j0) / step);
  const W = nx + 1;
  const hAt = (i, j) => H[(j0 + j * step) * V + (i0 + i * step)];
  const vidx = new Int32Array(W * (ny + 1)).fill(-1);
  const pos = [], dep = [], idx = [];
  const vert = (i, j) => {
    const k = j * W + i;
    if (vidx[k] >= 0) return vidx[k];
    const x = D0 + (i0 + i * step) * cell, y = D0 + (j0 + j * step) * cell;
    vidx[k] = pos.length / 3;
    pos.push(x, WATER_LEVEL, -y);
    dep.push(WATER_LEVEL - hAt(i, j));
    return vidx[k];
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const m = Math.min(hAt(i, j), hAt(i + 1, j), hAt(i, j + 1), hAt(i + 1, j + 1));
      if (m > WATER_LEVEL - 0.5) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const sunDir = renderer.sunDirection ? renderer.sunDirection.clone() : new THREE.Vector3(-0.42, 0.82, 0.38).normalize();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uTime: ENV_UNIFORMS.uTime,
    uDetail: { value: detailTex },
    uShallow: { value: new THREE.Color(0x3aa6a0) },
    uDeep: { value: new THREE.Color(0x1f6f7a) },
    uFoam: { value: new THREE.Color(0xe8fff4) },
    uSky: { value: new THREE.Color(0x9fd6e8) },
    uSunDir: { value: sunDir },
    uFowTex: FOG_UNIFORMS.uFowTex, uFowStrength: FOG_UNIFORMS.uFowStrength, uFowColor: FOG_UNIFORMS.uFowColor, uFowMap: FOG_UNIFORMS.uFowMap,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute float aDepth;
      uniform float uTime;
      uniform vec4 uFowMap;
      varying float vDepth;
      varying vec3 vW;
      varying vec2 vFowUv;
      void main() {
        vDepth = aDepth;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += (sin(wp.x * 0.0041 + uTime * 1.3) + cos(wp.z * 0.0053 + uTime * 1.1)) * 1.1 * clamp(aDepth / 12.0, 0.0, 1.0);
        vW = wp.xyz;
        vFowUv = vec2(wp.x, -wp.z) * uFowMap.zw + uFowMap.xy;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform sampler2D uDetail;
      uniform vec3 uShallow, uDeep, uFoam, uSky, uSunDir;
      varying float vDepth;
      varying vec3 vW;
      ${FOW_FRAG_PARS.replace('varying vec2 vFowUv;', 'varying vec2 vFowUv;')}
      void main() {
        float d = clamp(vDepth / 30.0, 0.0, 1.0);
        vec2 p = vW.xz;
        vec2 flow = vec2(uTime * 16.0, -uTime * 10.0);
        float n1 = texture2D(uDetail, (p + flow) / 640.0).g;
        float n2 = texture2D(uDetail, (p.yx * vec2(1.0, -1.0) - flow * 0.7) / 430.0).g;
        float n3 = texture2D(uDetail, (p - flow * 1.6) / 170.0).r;
        float n = (n1 + n2) * 0.5;
        vec3 N = normalize(vec3((n1 - 0.5) * 0.55 + (n3 - 0.5) * 0.18, 1.0, (n2 - 0.5) * 0.55));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.05, 1.0, d));
        col *= 0.88 + 0.28 * n;
        col = mix(col, uSky, clamp(fres * 0.7 + 0.08, 0.0, 0.6));
        vec3 Hh = normalize(uSunDir + V);
        float spec = pow(max(dot(N, Hh), 0.0), 120.0);
        col += vec3(1.0, 0.95, 0.82) * spec * 0.9;
        // 焦散亮纹（浅处）
        float c1 = texture2D(uDetail, (p + flow * 0.4) / 240.0).b;
        float c2 = texture2D(uDetail, (p.yx - flow * 0.5) / 310.0).b;
        col += vec3(0.5, 0.75, 0.7) * smoothstep(0.72, 0.95, min(c1, c2) + 0.25) * (1.0 - d) * 0.35;
        // 岸边泡沫：水深很浅处 + 随时间推移的第二条泡沫线
        float fn = texture2D(uDetail, (p + flow * 1.3) / 150.0).a;
        float foam = (1.0 - smoothstep(0.0, 5.0 + 5.0 * n, vDepth)) * (0.45 + 0.55 * smoothstep(0.3, 0.7, fn));
        float line = 1.0 - smoothstep(0.0, 1.8, abs(vDepth - 8.0 - 2.5 * sin(uTime * 1.2 + n * 7.0)));
        foam += line * 0.4 * smoothstep(0.45, 0.75, fn);
        foam = clamp(foam, 0.0, 1.0);
        col = mix(col, uFoam, foam * 0.85);
        float alpha = mix(0.5, 0.9, smoothstep(0.0, 1.0, d));
        alpha = max(alpha, foam * 0.9);
        alpha *= smoothstep(-0.5, 1.8, vDepth);
        gl_FragColor = vec4(applyFow(col), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'river-water';
  mesh.renderOrder = 2;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
