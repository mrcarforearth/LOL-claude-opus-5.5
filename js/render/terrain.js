// 地形总装：高度场网格（分块）+ 程序化地表大纹理 + 岩壁/苔藓着色 + 河道水面 + 树木/岩石/花草（分块实例化）
//          + 草丛（玩家所在草丛半透明）+ 基地与地标 + 光照氛围。heightAt 为高度场双线性采样。
// 子模块：js/render/terrain/{noise,heightfield,groundtex,geo,matpatch,scatter,water,landmarks,fogshared}.js
import * as THREE from 'three';
import { buildHeightfield, computeNormals, DOMAIN } from './terrain/heightfield.js';
import { paintGround, makeDetailTexture, makeGlowTexture, makeRuneTexture } from './terrain/groundtex.js';
import { patch, ENV_UNIFORMS, foliageMaterial, staticMaterial } from './terrain/matpatch.js';
import { scatterAll, scatterBrushes, buildTiles } from './terrain/scatter.js';
import { makeTreeGeos, makeRockGeos, grassClump, makeFlowerGeo, makeMushroomGeo } from './terrain/geo.js';
import { buildWater } from './terrain/water.js';
import { buildLandmarks } from './terrain/landmarks.js';
import { FOG_UNIFORMS, patchFogOfWar } from './terrain/fogshared.js';

// 质量档位：高度场分辨率 / 地表纹理尺寸 / 分块数 / 植被数量与间距 / 阴影
const QUALITY = {
  low: { N: 256, tex: 1024, chunks: 4, trees: 1900, treeSp: 150, rockSp: 300, decoSp: 420, tuftSp: 300, brushSp: 64, blades: 8, treeShadow: false, terrainShadow: false, waterStep: 3, aniso: 2 },
  medium: { N: 384, tex: 2048, chunks: 6, trees: 4200, treeSp: 118, rockSp: 210, decoSp: 230, tuftSp: 160, brushSp: 52, blades: 10, treeShadow: false, terrainShadow: true, waterStep: 2, aniso: 4 },
  high: { N: 512, tex: 4096, chunks: 8, trees: 7000, treeSp: 98, rockSp: 170, decoSp: 170, tuftSp: 115, brushSp: 44, blades: 12, treeShadow: true, terrainShadow: true, waterStep: 2, aniso: 8 },
};

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

// 地表着色：细节噪声 + 坡度岩壁（横向岩层）+ 崖顶苔藓 + 水线湿痕
const GROUND_FRAG = /* glsl */`
{
  vec4 d1 = texture2D(uDetail, vTW.xz * (1.0 / 330.0));
  vec4 d2 = texture2D(uDetail, vTW.xz * (1.0 / 1450.0) + 0.37);
  vec4 d3 = texture2D(uDetail, vTW.xz * (1.0 / 90.0));
  float slope = 1.0 - clamp(vTN.y, 0.0, 1.0);
  diffuseColor.rgb *= 0.86 + 0.2 * d1.r + 0.14 * (d2.g - 0.5) + 0.12 * (d3.a - 0.5);
  float rk = smoothstep(0.30, 0.56, slope + (d1.g - 0.5) * 0.16);
  vec2 ruv = vec2((vTW.x - vTW.z) * 0.0021, vTW.y * 0.0085);
  vec4 r1 = texture2D(uDetail, ruv);
  vec4 r2 = texture2D(uDetail, ruv * 3.1 + 0.21);
  vec3 rock = mix(uRockA, uRockB, clamp(r1.b * 0.9 + r2.r * 0.35 - 0.1, 0.0, 1.0));
  rock *= 0.74 + 0.4 * smoothstep(-40.0, 320.0, vTW.y);
  rock *= 0.84 + 0.24 * smoothstep(0.3, 0.7, sin(vTW.y * 0.075 + r1.g * 5.0) * 0.5 + 0.5);
  rock = mix(rock, rock * vec3(0.9, 1.0, 0.85), smoothstep(0.5, 0.8, d2.g));
  diffuseColor.rgb = mix(diffuseColor.rgb, rock, rk);
  float moss = smoothstep(0.1, 0.28, slope) * (1.0 - rk) * smoothstep(40.0, 150.0, vTW.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.75 + 0.5 * d1.g), moss * 0.55);
  float wet = 1.0 - smoothstep(-38.0, -22.0, vTW.y);
  diffuseColor.rgb *= 1.0 - 0.26 * wet;
}
`;

export class Terrain {
  constructor(renderer, game) {
    this.renderer = renderer;
    this.game = game;
    this.quality = QUALITY[renderer?.quality] ? renderer.quality : 'high';
    this.Q = QUALITY[this.quality];
    this.hf = null;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.time = 0;
    this.brushMeshes = new Map();     // brushId → InstancedMesh[]
    this._brushOn = -1;
    this.landmarks = null;
    this.stats = {};
    this.fogUniforms = FOG_UNIFORMS;
    this.patchFog = patchFogOfWar;
    this._heightAt = null;
  }

  /** 高度（双线性，可走区 ≈ 0 微起伏；墙体隆起；河床 ≈ -60；基地平台 +45） */
  heightAt(x, y) {
    const f = this._heightAt;
    return f ? f(x, y) : 0;
  }

  async build(onProgress = () => {}) {
    const t0 = performance.now();
    const R = this.renderer, game = this.game, md = game.map, Q = this.Q;
    const THREE_ = THREE;
    const report = async (p, label) => { try { onProgress(p, label); } catch { /* 忽略 */ } await yieldFrame(); };
    const mark = (k, t) => { this.stats[k] = Math.round(performance.now() - t); return performance.now(); };
    let t = performance.now();

    // 1) 高度场
    await report(0.02, '正在隆起峡谷地形');
    const hf = buildHeightfield(game, Q.N);
    this.hf = hf;
    const H = hf.H;
    this._heightAt = (x, y) => hf.sample(H, x, y);
    const NRM = computeNormals(hf);
    t = mark('heightfield', t);

    // 2) 散布点（先算树位置，便于在地表纹理上画树影）
    await report(0.12, '正在种植丛林');
    const sc = scatterAll(game, hf, Q);
    const brushes = scatterBrushes(md, hf, Q, md.pointInPoly);
    t = mark('scatter', t);

    // 3) 地表纹理
    await report(0.2, '正在绘制地表');
    const canvas = await paintGround(hf, md, Q.tex, yieldFrame);
    this._paintTreeShadows(canvas, hf, sc);
    const groundTex = new THREE.CanvasTexture(canvas);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = Math.min(Q.aniso, R.webgl?.capabilities?.getMaxAnisotropy?.() || 1);
    groundTex.wrapS = groundTex.wrapT = THREE.ClampToEdgeWrapping;
    const detailTex = makeDetailTexture(THREE_, 256);
    const glowTex = makeGlowTexture(THREE_, 128);
    const runeTex = makeRuneTexture(THREE_, this.quality === 'low' ? 512 : 1024);
    this.textures = { groundTex, detailTex, glowTex, runeTex };
    t = mark('groundTexture', t);

    // 4) 地形网格（分块）
    await report(0.62, '正在铺设地形网格');
    const groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
    patch(groundMat, 'ground', (sh) => {
      sh.uniforms.uDetail = { value: detailTex };
      sh.uniforms.uRockA = { value: new THREE.Color(0x544a40) };
      sh.uniforms.uRockB = { value: new THREE.Color(0x9c907c) };
      sh.uniforms.uMoss = { value: new THREE.Color(0x3c6a34) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nvarying vec3 vTN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nvarying vec3 vTN;\nuniform sampler2D uDetail;\nuniform vec3 uRockA;\nuniform vec3 uRockB;\nuniform vec3 uMoss;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + GROUND_FRAG);
    });
    this.groundMat = groundMat;
    const shadows = !!R.shadowsEnabled;
    const castTerrain = shadows && Q.terrainShadow;
    this._buildChunks(hf, NRM, groundMat, shadows, castTerrain);
    t = mark('mesh', t);

    // 5) 水面
    await report(0.7, '正在引入河水');
    this.water = buildWater(hf, md, detailTex, R, Q.waterStep);
    this.group.add(this.water);
    t = mark('water', t);

    // 6) 植被与散布物
    await report(0.76, '正在布置树木与岩石');
    const treeGeos = makeTreeGeos();
    const treeMat = foliageMaterial('tree', { base: 70, amp: 0.026, freq: 0.9 });
    const castTrees = shadows && Q.treeShadow;
    for (let i = 0; i < 4; i++) buildTiles(this.group, treeGeos[i], treeMat, sc.trees[i], { castShadow: castTrees, receiveShadow: castTrees, name: 'trees-' + i });
    const rockGeos = makeRockGeos();
    const rockMat = staticMaterial('rock');
    for (let i = 0; i < 2; i++) buildTiles(this.group, rockGeos[i], rockMat, sc.rocks[i], { castShadow: castTrees, name: 'rocks-' + i });
    const decoMat = staticMaterial('deco');
    buildTiles(this.group, makeFlowerGeo(), decoMat, sc.flowers, { name: 'flowers', tile: 4000 });
    buildTiles(this.group, makeMushroomGeo(), decoMat, sc.mushrooms, { name: 'mushrooms', tile: 4000 });
    const tuftGeo = grassClump({ blades: 7, hMin: 26, hMax: 50, width: 10, spread: 24, cols: [0x355f22, 0x5f9134, 0xa6cc5c], seed: 3 });
    const tuftMat = foliageMaterial('tuft', { base: 0, amp: 0.09, freq: 1.6, side: THREE.DoubleSide });
    this._noFlip(tuftMat);
    buildTiles(this.group, tuftGeo, tuftMat, sc.tufts, { name: 'tufts', tile: 3000 });
    t = mark('vegetation', t);

    // 7) 草丛
    await report(0.86, '正在长出草丛');
    const bladeGeo = grassClump({ blades: Q.blades, hMin: 105, hMax: 170, width: 19, spread: 42, cols: [0x2d5a1a, 0x74a52e, 0xd4e86e], seed: 7 });
    this.brushMat = this._noFlip(foliageMaterial('brush', { base: 8, amp: 0.1, freq: 1.7, side: THREE.DoubleSide }));
    this.brushMatT = this._noFlip(foliageMaterial('brush-t', { base: 8, amp: 0.1, freq: 1.7, side: THREE.DoubleSide, transparent: true, opacity: 0.4 }));
    for (const b of brushes) {
      if (!b.items.length) continue;
      const meshes = buildTiles(this.group, bladeGeo, this.brushMat, b.items, { name: 'brush-' + b.id, tile: 100000, castShadow: false, renderOrder: 1 });
      this.brushMeshes.set(b.id, meshes);
    }
    t = mark('brushes', t);

    // 8) 基地与地标
    await report(0.93, '正在建造基地与地标');
    this.landmarks = buildLandmarks({ group: this.group, hf, md, Q, glowTex, runeTex, shadows: castTrees });
    t = mark('landmarks', t);

    // 9) 光照与氛围
    this._setupAtmosphere();
    const parent = R.groups?.world || R.scene;
    parent.add(this.group);
    // 预编译着色器，避免首帧卡顿
    try { R.webgl?.compile?.(R.scene, R.camera); } catch { /* 忽略 */ }
    t = mark('compile', t);
    this.stats.total = Math.round(performance.now() - t0);
    this.stats.counts = {
      trees: sc.trees.reduce((a, l) => a + l.length, 0), rocks: sc.rocks[0].length + sc.rocks[1].length,
      flowers: sc.flowers.length, mushrooms: sc.mushrooms.length, tufts: sc.tufts.length,
      brushClumps: brushes.reduce((a, b) => a + b.items.length, 0),
    };
    await report(1, '地形就绪');
  }

  /** 双面草叶：背面不翻转法线（保持明亮） */
  _noFlip(mat) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifndef FLAT_SHADED\nnormal = normalize(vNormal);\n#endif');
    };
    return mat;
  }

  /** 把高度场切成 chunks×chunks 块（每块可独立视锥剔除） */
  _buildChunks(hf, NRM, mat, receive, cast) {
    const { N, V, H, D0, DS, cell } = hf;
    const C = this.Q.chunks, cn = N / C, cv = cn + 1;
    const index = [];
    for (let j = 0; j < cn; j++) {
      for (let i = 0; i < cn; i++) {
        const a = j * cv + i, b = a + 1, c = a + cv, d = c + 1;
        index.push(a, b, c, b, d, c);
      }
    }
    const idxArr = new Uint16Array(index);
    this.chunks = [];
    for (let cj = 0; cj < C; cj++) {
      for (let ci = 0; ci < C; ci++) {
        const pos = new Float32Array(cv * cv * 3), nrm = new Float32Array(cv * cv * 3), uv = new Float32Array(cv * cv * 2);
        for (let j = 0; j < cv; j++) {
          const gj = cj * cn + j;
          for (let i = 0; i < cv; i++) {
            const gi = ci * cn + i, k = gj * V + gi, o = j * cv + i;
            const x = D0 + gi * cell, y = D0 + gj * cell;
            pos[o * 3] = x; pos[o * 3 + 1] = H[k]; pos[o * 3 + 2] = -y;
            nrm[o * 3] = NRM[k * 3]; nrm[o * 3 + 1] = NRM[k * 3 + 1]; nrm[o * 3 + 2] = NRM[k * 3 + 2];
            uv[o * 2] = (x - D0) / DS; uv[o * 2 + 1] = (y - D0) / DS;
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(new THREE.BufferAttribute(idxArr, 1));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = `ground-${ci}-${cj}`;
        mesh.receiveShadow = receive;
        mesh.castShadow = cast;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
        this.chunks.push(mesh);
      }
    }
  }

  /** 在地表纹理上画树影（太阳在西南 → 影子偏东北）与墙边的柔和暗角 */
  _paintTreeShadows(canvas, hf, sc) {
    const S = canvas.width, g = canvas.getContext('2d');
    const { D0, DS } = hf;
    const k = S / DS;
    const blobC = document.createElement('canvas');
    blobC.width = blobC.height = 64;
    const bg = blobC.getContext('2d');
    const gr = bg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(8,22,12,0.55)');
    gr.addColorStop(0.55, 'rgba(8,22,12,0.3)');
    gr.addColorStop(1, 'rgba(8,22,12,0)');
    bg.fillStyle = gr;
    bg.fillRect(0, 0, 64, 64);
    g.save();
    g.setTransform(k, 0, 0, -k, -D0 * k, (D0 + DS) * k);
    const R0 = [150, 125, 80, 190];
    for (let type = 0; type < 4; type++) {
      for (const t of sc.trees[type]) {
        if (t.sdf > 260) continue;
        const r = R0[type] * t.s * 1.25;
        g.globalAlpha = 0.85;
        g.drawImage(blobC, t.x + 70 * t.s - r, t.y + 60 * t.s - r, r * 2, r * 2);
      }
    }
    g.globalAlpha = 0.5;
    for (const list of sc.rocks) for (const r of list) { const rr = r.s * 1.3; g.drawImage(blobC, r.x + rr * 0.3 - rr, r.y + rr * 0.3 - rr, rr * 2, rr * 2); }
    g.restore();
  }

  _setupAtmosphere() {
    const R = this.renderer, scene = R.scene;
    if (R.sun) { R.sun.color.setHex(0xffe3bd); R.sun.intensity = 2.55; }
    if (R.hemi) { R.hemi.color.setHex(0xc2dcf4); R.hemi.groundColor.setHex(0x3a5a2c); R.hemi.intensity = 1.05; }
    if (R.sunDirection) R.sunDirection.set(-0.46, 0.8, 0.38).normalize();
    // 背景：竖直渐变（远处天空般的青蓝 → 深林绿）
    const c = document.createElement('canvas');
    c.width = 2; c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#29485a');
    gr.addColorStop(0.5, '#1d3a36');
    gr.addColorStop(1, '#10231c');
    g.fillStyle = gr;
    g.fillRect(0, 0, 2, 256);
    const bgTex = new THREE.CanvasTexture(c);
    bgTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = bgTex;
    scene.fog = new THREE.Fog(0x1c3432, 6500, 17000);
    this.textures.bgTex = bgTex;
  }

  update(dt, renderer) {
    dt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    this.time += dt;
    ENV_UNIFORMS.uTime.value = this.time;
    if (this.landmarks) this.landmarks.update(this.time, dt);
    // 玩家所在草丛半透明
    const p = this.game.player;
    let bid = -1;
    if (p && p.alive !== false && this.game.nav?.brushAt) bid = this.game.nav.brushAt(p.x, p.y);
    if (bid !== this._brushOn) {
      const prev = this.brushMeshes.get(this._brushOn);
      if (prev) for (const m of prev) { m.material = this.brushMat; m.renderOrder = 1; }
      const cur = this.brushMeshes.get(bid);
      if (cur) for (const m of cur) { m.material = this.brushMatT; m.renderOrder = 4; }
      this._brushOn = bid;
    }
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const t of Object.values(this.textures || {})) t?.dispose?.();
    this.group.parent?.remove(this.group);
  }
}

export default Terrain;
export { DOMAIN };
