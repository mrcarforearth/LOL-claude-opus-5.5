// 战争迷雾渲染：vision.grids[playerTeam]（150×150）→ 5 抽头可分离模糊 → 约 0.25 秒时间渐变 → R8 纹理（GPU 双线性上采样）。
// 地形/树木/草丛/水面/地标材质通过共享 uniform（terrain/fogshared.js 的 FOG_UNIFORMS，onBeforeCompile 注入）读取：
// 迷雾区压暗、偏冷、降饱和；可见区保持原色。其他模块可用 fog.patch(material) 接入（可选）。
import * as THREE from 'three';
import { FOG_UNIFORMS, patchFogOfWar } from './terrain/fogshared.js';

const FADE_TIME = 0.25;

export class FogRenderer {
  constructor(renderer, game, terrain) {
    this.renderer = renderer;
    this.game = game;
    this.terrain = terrain;
    const vis = game.vision;
    this.cols = vis?.cols || 150;
    this.rows = vis?.rows || 150;
    this.cellSize = vis?.cellSize || 100;
    const n = this.cols * this.rows;
    this.target = new Float32Array(n);
    this.cur = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.data = new Uint8Array(n);
    const tex = new THREE.DataTexture(this.data, this.cols, this.rows, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.unpackAlignment = 1;   // 150 字节/行，非 4 的倍数
    tex.needsUpdate = true;
    this.texture = tex;
    this.uniforms = FOG_UNIFORMS;
    FOG_UNIFORMS.uFowTex.value = tex;
    // uv = (x, y) / 地图尺寸；纹理第 0 行 = 南（y 0..100）
    FOG_UNIFORMS.uFowMap.value.set(0, 0, 1 / (this.cols * this.cellSize), 1 / (this.rows * this.cellSize));
    FOG_UNIFORMS.uFowStrength.value = 0;
    this._version = -1;
    this._team = -1;
    this._first = true;
    this._animating = false;
    this.uploads = 0;
  }

  /** 让任意材质也受迷雾影响（可选） */
  patch(material, key = '') { return patchFogOfWar(material, key); }

  _computeTarget(grid) {
    const C = this.cols, R = this.rows, T = this.target, tmp = this.tmp;
    // 横向 [1,4,6,4,1]/16
    for (let r = 0; r < R; r++) {
      const o = r * C;
      for (let c = 0; c < C; c++) {
        const a = grid[o + (c > 1 ? c - 2 : 0)], b = grid[o + (c > 0 ? c - 1 : 0)], m = grid[o + c];
        const d = grid[o + (c < C - 1 ? c + 1 : C - 1)], e = grid[o + (c < C - 2 ? c + 2 : C - 1)];
        tmp[o + c] = (a + 4 * b + 6 * m + 4 * d + e) * 0.0625;
      }
    }
    // 纵向
    for (let r = 0; r < R; r++) {
      const ra = (r > 1 ? r - 2 : 0) * C, rb = (r > 0 ? r - 1 : 0) * C, rm = r * C;
      const rd = (r < R - 1 ? r + 1 : R - 1) * C, re = (r < R - 2 ? r + 2 : R - 1) * C;
      for (let c = 0; c < C; c++) {
        T[rm + c] = (tmp[ra + c] + 4 * tmp[rb + c] + 6 * tmp[rm + c] + 4 * tmp[rd + c] + tmp[re + c]) * 0.0625;
      }
    }
  }

  _upload() {
    const cur = this.cur, data = this.data;
    for (let i = 0; i < cur.length; i++) data[i] = (cur[i] * 255 + 0.5) | 0;
    this.texture.needsUpdate = true;
    this.uploads++;
  }

  update(dt) {
    dt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    const R = this.renderer, vis = this.game.vision;
    // 调试全图模式 / 无视野系统 → 关闭迷雾
    const want = !R.revealAll && vis && vis.grids ? 1 : 0;
    const u = FOG_UNIFORMS.uFowStrength;
    if (u.value !== want) u.value = want > u.value ? Math.min(want, u.value + dt * 4) : Math.max(want, u.value - dt * 4);
    if (!vis || !vis.grids) return;
    const team = R.playerTeam === 1 ? 1 : 0;
    const grid = vis.grids[team];
    if (!grid || grid.length !== this.cur.length) return;
    if (vis.version !== this._version || team !== this._team) {
      this._version = vis.version;
      this._team = team;
      this._computeTarget(grid);
      if (this._first) {
        this._first = false;
        this.cur.set(this.target);
        this._upload();
        u.value = want;
        return;
      }
      this._animating = true;
    }
    if (!this._animating) return;
    const step = dt / FADE_TIME;
    const cur = this.cur, T = this.target;
    let moving = false;
    for (let i = 0; i < cur.length; i++) {
      const d = T[i] - cur[i];
      if (d === 0) continue;
      if (d > step) { cur[i] += step; moving = true; }
      else if (d < -step) { cur[i] -= step; moving = true; }
      else cur[i] = T[i];
    }
    this._upload();
    this._animating = moving;
  }

  dispose() {
    if (FOG_UNIFORMS.uFowTex.value === this.texture) FOG_UNIFORMS.uFowStrength.value = 0;
    this.texture.dispose();
  }
}

export default FogRenderer;
