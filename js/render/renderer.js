// 渲染器（core）：Three 场景/灯光/阴影、镜头、实体视图同步（插值、可见性淡入淡出、死亡/复活/移除时序、高亮）、屏幕↔地面换算与拾取、系统调度
//
// 【渲染约定 —— 给地形/模型/特效/UI 代理】
//  坐标：scene(X, Y, Z) = (x, h, -y)；toScene() 负责换算。模型本地正前方 +X，视图 object3d.rotation.y = facing（渲染器写入）。
//  RENDER_ORDER：地形 0、水面 1、迷雾 5、地面贴花 10、指示器 20、单位 0（不透明，正常深度）、特效 30、顶层特效 40。
//    透明的地面贴花/指示器/特效：transparent + depthWrite:false，贴花再加 polygonOffset（factor -1..-4）防 z-fighting。
//  阴影：renderer.sun（DirectionalLight，castShadow 仅在 quality medium/high）跟随镜头目标，覆盖约 4400×4400；
//    单位模型 castShadow = true；地形 receiveShadow = true；透明特效不投影。renderer.shadowsEnabled 表示是否开启。
//    renderer.sunDirection（指向太阳的单位向量，默认西南上方）/ sun.color / sun.intensity / hemi.* 可由地形代理调整氛围。
//  视图生命周期（每帧，按顺序）：插值位置 → cameraCtl.update → 视图同步（位置/朝向/可见性/死亡/移除 + view.update(dt, e, renderer)）
//    → terrain.update(dt, renderer) → systems[i].update(dt, renderer)（fog、fx、indicators、overlay…）→ WebGL 渲染。
//    view.update 只在可见（或淡出中）时调用；view.setOpacity(a) 在透明度变化时调用；死亡 onDeath、复活 onRespawn。
//    英雄阵亡 3 秒后淡出隐藏；小兵/野怪/宠物被移除后保留 1.5 秒（继续 update 播放死亡动画）再 dispose；守卫移除后 0.3 秒淡出；建筑永不移除（残骸）。
//  插值：模拟 30Hz，渲染按 game.alpha 在最近两个 tick 之间插值。renderPos(entity) → { x, y, z } 为当前帧显示位置（特效跟随请用它）。
//  可见性：isShown(entity) → 当前是否显示（己方 / e.visible[playerTeam] / 建筑）。revealAll = true 时全部显示（调试）。
import * as THREE from 'three';
import { CameraController } from './camera.js';
import { MAP_SIZE } from '../config.js';

export const RENDER_ORDER = { TERRAIN: 0, WATER: 1, FOG: 5, DECAL: 10, INDICATOR: 20, UNIT: 0, FX: 30, FX_TOP: 40 };

export const QUALITY_PRESETS = {
  low: { pixelRatio: 1, shadows: false, shadowMapSize: 0, antialias: false },
  medium: { pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, antialias: true },
  high: { pixelRatio: 2, shadows: true, shadowMapSize: 2048, antialias: true },
};

const VIEW_LISTS = ['champions', 'minions', 'structures', 'monsters', 'pets', 'wards'];
const STRUCTURE_TYPES = new Set(['turret', 'inhibitor', 'nexus']);
const FADE_TIME = 0.25;
const CHAMP_HIDE_AFTER = 3;
const CORPSE_TIME = 1.5;
const WARD_FADE = 0.3;
const SNAP_DIST2 = 350 * 350;
const SHADOW_HALF = 2200;

export class Renderer {
  constructor(game, container, { quality = 'high' } = {}) {
    this.THREE = THREE;
    this.game = game;
    this.container = container;
    this.quality = QUALITY_PRESETS[quality] ? quality : 'high';
    const q = QUALITY_PRESETS[this.quality];
    this.playerTeam = game.player ? game.player.team : 0;
    this.revealAll = false;
    this.terrain = null;
    this.fx = null;
    this.views = new Map();          // entityId → View
    this.systems = [];
    this.time = 0;                   // 渲染累计时间（秒，真实时间）
    this.frame = 0;
    this.width = Math.max(1, container.clientWidth || window.innerWidth);
    this.height = Math.max(1, container.clientHeight || window.innerHeight);
    this._records = new Map();       // entityId → 内部记录
    this._viewFactory = null;
    this._errThrottle = new Map();
    this._resizeListeners = [];
    this._disposed = false;
    this._rect = null;
    this._rectFrame = -1;

    // —— WebGL ——
    const webgl = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance', alpha: false, stencil: false });
    webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    webgl.setSize(this.width, this.height, false);
    webgl.outputColorSpace = THREE.SRGBColorSpace;
    webgl.toneMapping = THREE.ACESFilmicToneMapping;
    webgl.toneMappingExposure = 1.05;
    webgl.shadowMap.enabled = q.shadows;
    webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    webgl.domElement.className = 'webgl-canvas';
    webgl.domElement.style.width = '100%';
    webgl.domElement.style.height = '100%';
    webgl.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    container.prepend(webgl.domElement);
    this.webgl = webgl;
    this.shadowsEnabled = q.shadows;

    // —— 场景与灯光 ——
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1a14);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(38, this.width / this.height, 50, 30000);

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x2f3d22, 1.15);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(this.ambient);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.castShadow = q.shadows;
    if (q.shadows) {
      sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      const sc = sun.shadow.camera;
      sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
      sc.near = 100; sc.far = 9000;
      sc.updateProjectionMatrix();
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 2.5;
    }
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    // 指向太阳（西南上方 → 光线照向东北）；scene 中 西 = -X，南 = +Z
    this.sunDirection = new THREE.Vector3(-0.42, 0.82, 0.38).normalize();
    this.sunDistance = 4500;

    // 图层：各代理可把对象挂到这些分组下（也可直接 scene.add）
    this.groups = {
      world: new THREE.Group(),   // 地形/装饰
      units: new THREE.Group(),   // 实体视图
      fx: new THREE.Group(),      // 特效
    };
    this.groups.world.name = 'world';
    this.groups.units.name = 'units';
    this.groups.fx.name = 'fx';
    scene.add(this.groups.world, this.groups.units, this.groups.fx);

    this.cameraCtl = new CameraController(this);
    if (game.player) this.cameraCtl.follow(game.player);

    // 复用对象
    this._v3 = new THREE.Vector3();
    this._v3b = new THREE.Vector3();
    this._ndc = new THREE.Vector2();
    this._ray = new THREE.Raycaster();

    // 尺寸监听
    this._onWindowResize = () => this.resize();
    window.addEventListener('resize', this._onWindowResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(container);
    }
    this._fallbackGround = null;
  }

  // —— 坐标 ——
  toScene(x, y, h = 0) { return new THREE.Vector3(x, h, -y); }
  heightAt(x, y) {
    const t = this.terrain;
    if (t && typeof t.heightAt === 'function') {
      const h = t.heightAt(x, y);
      return Number.isFinite(h) ? h : 0;
    }
    return 0;
  }

  _containerRect() {
    if (this._rectFrame !== this.frame || !this._rect) {
      this._rect = this.container.getBoundingClientRect();
      this._rectFrame = this.frame;
    }
    return this._rect;
  }

  // 客户端坐标 → 地面游戏坐标（沿视线步进 + 二分，考虑地形高度）；不命中返回 null
  screenToGround(clientX, clientY) {
    const rect = this._containerRect();
    const w = rect.width || this.width, h = rect.height || this.height;
    const mx = clientX - rect.left, my = clientY - rect.top;
    this._ndc.set((mx / w) * 2 - 1, -(my / h) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    const o = this._ray.ray.origin, d = this._ray.ray.direction;
    if (d.y > -1e-5) return null;
    const hTop = 420, hBot = -80;
    let t0 = (hTop - o.y) / d.y, t1 = (hBot - o.y) / d.y;
    if (t0 < 0) t0 = 0;
    if (!this.terrain) {
      const t = (0 - o.y) / d.y;
      return { x: o.x + d.x * t, y: -(o.z + d.z * t) };
    }
    const f = (t) => {
      const px = o.x + d.x * t, pz = o.z + d.z * t;
      return (o.y + d.y * t) - this.heightAt(px, -pz);
    };
    const N = 28;
    let prevT = t0, prevF = f(t0);
    let hitT = null;
    if (prevF <= 0) hitT = t0;
    for (let i = 1; i <= N && hitT === null; i++) {
      const t = t0 + ((t1 - t0) * i) / N;
      const fv = f(t);
      if (fv <= 0) {
        let a = prevT, b = t;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) / 2;
          if (f(m) > 0) a = m; else b = m;
        }
        hitT = (a + b) / 2;
      }
      prevT = t; prevF = fv;
    }
    if (hitT === null) hitT = (0 - o.y) / d.y;
    return { x: o.x + d.x * hitT, y: -(o.z + d.z * hitT) };
  }

  // 游戏坐标 → 相对 container 的 CSS 像素
  worldToScreen(x, y, h = 0) {
    const v = this._v3.set(x, h, -y).project(this.camera);
    const sx = (v.x + 1) * 0.5 * this.width;
    const sy = (1 - v.y) * 0.5 * this.height;
    const onScreen = v.z > -1 && v.z < 1 && sx >= 0 && sx <= this.width && sy >= 0 && sy <= this.height;
    return { x: sx, y: sy, onScreen };
  }

  // 屏幕空间拾取：单位按「脚底 → 头顶」胶囊判定；多个重叠时取最接近光标者（英雄略优先）
  pickUnit(clientX, clientY, { filter = null, pad = 0 } = {}) {
    const list = this.pickUnits(clientX, clientY, { filter, pad, limit: 1 });
    return list.length ? list[0] : null;
  }

  pickUnits(clientX, clientY, { filter = null, pad = 0, limit = 8 } = {}) {
    const rect = this._containerRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    const hits = [];
    for (const rec of this._records.values()) {
      if (!rec.shownNow || rec.opacity < 0.4 || rec.removedAt != null) continue;
      const e = rec.entity;
      if (!e.alive || e.removed) continue;
      if (filter && !filter(e)) continue;
      const gh = this.heightAt(rec.rx, rec.ry) + rec.rz;
      const hgt = (rec.view && rec.view.height) || 150;
      const foot = this._project(rec.rx, rec.ry, gh);
      if (!foot) continue;
      const top = this._project(rec.rx, rec.ry, gh + hgt * 0.92);
      if (!top) continue;
      // 半径（像素）：取单位半径在屏幕上的投影
      const side = this._project(rec.rx + (e.radius || 50), rec.ry, gh + hgt * 0.5);
      const mid = this._project(rec.rx, rec.ry, gh + hgt * 0.5);
      let rpx = side && mid ? Math.hypot(side.x - mid.x, side.y - mid.y) : 20;
      rpx = Math.max(e.type === 'ward' ? 12 : 16, rpx * (e.type === 'champion' ? 1.05 : 0.95)) + pad;
      const d = distToSeg(mx, my, foot.x, foot.y, top.x, top.y);
      if (d > rpx) continue;
      let score = d / rpx;
      if (e.type === 'champion') score -= 0.25;
      else if (STRUCTURE_TYPES.has(e.type)) score += 0.3;
      hits.push({ e, score });
    }
    hits.sort((a, b) => a.score - b.score);
    const out = [];
    for (let i = 0; i < hits.length && out.length < limit; i++) out.push(hits[i].e);
    return out;
  }

  _project(x, y, h) {
    const v = this._v3b.set(x, h, -y).project(this.camera);
    if (v.z >= 1 || v.z <= -1) return null;
    return { x: (v.x + 1) * 0.5 * this.width, y: (1 - v.y) * 0.5 * this.height };
  }

  // —— 注册 ——
  setTerrain(terrain) {
    this.terrain = terrain || null;
    if (this.terrain && this._fallbackGround) {
      this.scene.remove(this._fallbackGround);
      this._fallbackGround.geometry.dispose();
      this._fallbackGround.material.dispose();
      this._fallbackGround = null;
    }
  }
  setViewFactory(fn) { this._viewFactory = fn; }
  addSystem(sys) { if (sys && !this.systems.includes(sys)) this.systems.push(sys); return sys; }
  removeSystem(sys) { const i = this.systems.indexOf(sys); if (i >= 0) this.systems.splice(i, 1); }
  getView(entity) { return entity ? this.views.get(entity.id) || null : null; }
  onResize(fn) { this._resizeListeners.push(fn); return () => { const i = this._resizeListeners.indexOf(fn); if (i >= 0) this._resizeListeners.splice(i, 1); }; }

  // 当前帧显示位置（插值后）；无视图的实体返回其模拟位置
  renderPos(entity) {
    const rec = entity ? this._records.get(entity.id) : null;
    if (rec && rec.entity === entity) return { x: rec.rx, y: rec.ry, z: rec.rz };
    return entity ? { x: entity.x, y: entity.y, z: entity.z || 0 } : { x: 0, y: 0, z: 0 };
  }
  isShown(entity) {
    const rec = entity ? this._records.get(entity.id) : null;
    return !!rec && rec.shownNow && rec.opacity > 0.05;
  }
  // 视图高度（血条位置）
  viewHeight(entity) {
    const v = this.getView(entity);
    if (v && v.height) return v.height;
    return defaultHeight(entity);
  }
  // 高亮（悬停/选中）：color 为 0xRRGGBB 或 null
  setHighlight(entity, color) {
    if (!entity) return;
    const rec = this._records.get(entity.id);
    if (!rec) return;
    const c = color ?? null;
    if (rec.highlight === c) return;
    rec.highlight = c;
    try { rec.view.setHighlight?.(c); } catch (err) { this._reportError('view.setHighlight', err); }
  }

  resize() {
    if (this._disposed) return;
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    if (w === this.width && h === this.height && this._sized) return;
    this._sized = true;
    this.width = w; this.height = h;
    this.webgl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._rect = null;
    for (const fn of this._resizeListeners) { try { fn(w, h); } catch (err) { this._reportError('onResize', err); } }
  }

  setQuality(quality) {
    if (!QUALITY_PRESETS[quality]) return;
    this.quality = quality;
    const q = QUALITY_PRESETS[quality];
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.webgl.setSize(this.width, this.height, false);
  }

  // —— 每帧 ——
  render(realDt) {
    if (this._disposed) return;
    const dt = Math.max(0, Math.min(0.1, realDt || 0));
    this.time += dt;
    this.frame++;
    this.dt = dt;
    if (!this._sized) this.resize();
    if (!this.terrain && !this._fallbackGround) this._makeFallbackGround();
    this._interpolate(dt);
    try { this.cameraCtl.update(dt); } catch (err) { this._reportError('camera', err); }
    this._syncViews(dt);
    if (this.terrain && typeof this.terrain.update === 'function') {
      try { this.terrain.update(dt, this); } catch (err) { this._reportError('terrain.update', err); }
    }
    for (let i = 0; i < this.systems.length; i++) {
      const s = this.systems[i];
      try { s.update(dt, this); } catch (err) { this._reportError(s.constructor?.name || `system${i}`, err); }
    }
    this._updateSun();
    this.webgl.render(this.scene, this.camera);
  }

  _updateSun() {
    const t = this.cameraCtl.target;
    const sun = this.sun;
    // 阴影中心稍偏北（画面上方可见范围更大），按阴影贴图像素对齐避免抖动
    let cx = t.x, cz = -(t.y + 250);
    if (this.shadowsEnabled && sun.shadow.mapSize.x > 0) {
      const texel = (SHADOW_HALF * 2) / sun.shadow.mapSize.x;
      cx = Math.round(cx / texel) * texel;
      cz = Math.round(cz / texel) * texel;
    }
    const d = this.sunDirection;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + d.x * this.sunDistance, d.y * this.sunDistance, cz + d.z * this.sunDistance);
    sun.target.updateMatrixWorld();
  }

  _makeFallbackGround() {
    const g = new THREE.PlaneGeometry(MAP_SIZE + 4000, MAP_SIZE + 4000);
    g.rotateX(-Math.PI / 2);
    g.translate(MAP_SIZE / 2, 0, -MAP_SIZE / 2);
    const m = new THREE.MeshLambertMaterial({ color: 0x4f7d3a });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this._fallbackGround = mesh;
  }

  // 位置插值：每个 tick 记录上一/当前模拟位置，按 game.alpha 插值
  _interpolate() {
    const game = this.game;
    const step = game.stepCount || 0;
    const alpha = Math.max(0, Math.min(1, game.alpha || 0));
    const seen = this._seenStamp = (this._seenStamp || 0) + 1;
    for (const key of VIEW_LISTS) {
      const list = game[key];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        let rec = this._records.get(e.id);
        if (!rec || rec.entity !== e) rec = this._createRecord(e);
        if (!rec) continue;
        rec.seen = seen;
        if (rec.lastStep !== step) {
          rec.p0x = rec.p1x; rec.p0y = rec.p1y; rec.p0z = rec.p1z;
          rec.p1x = e.x; rec.p1y = e.y; rec.p1z = e.z || 0;
          const dx = rec.p1x - rec.p0x, dy = rec.p1y - rec.p0y;
          if (dx * dx + dy * dy > SNAP_DIST2 || rec.lastStep < 0 || step - rec.lastStep > 6) { rec.p0x = rec.p1x; rec.p0y = rec.p1y; rec.p0z = rec.p1z; }
          rec.lastStep = step;
        }
        rec.rx = rec.p0x + (rec.p1x - rec.p0x) * alpha;
        rec.ry = rec.p0y + (rec.p1y - rec.p0y) * alpha;
        rec.rz = rec.p0z + (rec.p1z - rec.p0z) * alpha;
      }
    }
  }

  _createRecord(e) {
    let view = null;
    try {
      view = this._viewFactory ? this._viewFactory(e, this) : null;
    } catch (err) {
      this._reportError('viewFactory', err);
      view = null;
    }
    if (!view || !view.object3d) view = basicPlaceholder(e, this.playerTeam);
    const old = this._records.get(e.id);
    if (old) this._disposeRecord(old);
    const rec = {
      entity: e, view, seen: 0, lastStep: -1,
      p0x: e.x, p0y: e.y, p0z: e.z || 0, p1x: e.x, p1y: e.y, p1z: e.z || 0, rx: e.x, ry: e.y, rz: e.z || 0,
      rot: e.facing || 0, opacity: 0, shownNow: false, wasAlive: e.alive, deathAt: e.alive ? null : this.time, removedAt: null,
      highlight: null, lastOpacitySent: -1, lastVisible: null,
    };
    const o = view.object3d;
    o.position.set(e.x, this.heightAt(e.x, e.y) + (e.z || 0), -e.y);
    o.rotation.y = rec.rot;
    o.visible = false;
    o.userData.entityId = e.id;
    this.groups.units.add(o);
    this._records.set(e.id, rec);
    this.views.set(e.id, view);
    return rec;
  }

  _disposeRecord(rec) {
    const o = rec.view && rec.view.object3d;
    if (o && o.parent) o.parent.remove(o);
    try { rec.view.dispose?.(); } catch (err) { this._reportError('view.dispose', err); }
    if (this._records.get(rec.entity.id) === rec) {
      this._records.delete(rec.entity.id);
      this.views.delete(rec.entity.id);
    }
  }

  _wantShown(e, rec) {
    if (this.revealAll) return true;
    if (STRUCTURE_TYPES.has(e.type)) return true;
    const own = e.team === this.playerTeam;
    let vis = own || !!(e.visible && e.visible[this.playerTeam]);
    // 敌方死亡中的单位：保持死亡瞬间的可见性（播放死亡动画）
    if (!e.alive && rec.deathVisible != null) vis = rec.deathVisible;
    return vis;
  }

  _syncViews(dt) {
    const seen = this._seenStamp;
    const fadeStep = dt / FADE_TIME;
    const toDispose = [];
    for (const rec of this._records.values()) {
      const e = rec.entity;
      const view = rec.view;
      const o = view.object3d;
      const removed = rec.seen !== seen;
      // —— 生死过渡 ——
      if (rec.wasAlive && !e.alive) {
        rec.deathAt = this.time;
        rec.deathVisible = STRUCTURE_TYPES.has(e.type) || e.team === this.playerTeam || !!(e.visible && e.visible[this.playerTeam]) || rec.shownNow;
        try { view.onDeath?.(e); } catch (err) { this._reportError('view.onDeath', err); }
      } else if (!rec.wasAlive && e.alive) {
        rec.deathAt = null;
        rec.deathVisible = null;
        rec.p0x = rec.p1x = rec.rx = e.x; rec.p0y = rec.p1y = rec.ry = e.y; rec.p0z = rec.p1z = rec.rz = e.z || 0;
        rec.rot = e.facing || 0;
        try { view.onRespawn?.(e); } catch (err) { this._reportError('view.onRespawn', err); }
      }
      rec.wasAlive = e.alive;
      if (removed && rec.removedAt == null) rec.removedAt = this.time;

      // —— 目标可见性 ——
      let want = this._wantShown(e, rec);
      if (e.type === 'champion' && !e.alive && rec.deathAt != null && this.time - rec.deathAt > CHAMP_HIDE_AFTER) want = false;
      let keep = Infinity;
      if (rec.removedAt != null) {
        const died = !e.alive && !e.expired;
        keep = e.type === 'ward' ? WARD_FADE : died ? CORPSE_TIME : 0.3;
        const age = this.time - rec.removedAt;
        if (age >= keep) { toDispose.push(rec); continue; }
        if (keep - age < FADE_TIME + 0.15) want = false;
      }
      // —— 淡入淡出 ——
      const target = want ? 1 : 0;
      if (rec.opacity < target) rec.opacity = Math.min(target, rec.opacity + fadeStep);
      else if (rec.opacity > target) rec.opacity = Math.max(target, rec.opacity - fadeStep);
      if (rec.lastVisible === null) rec.opacity = target; // 首帧不淡入
      const visible = rec.opacity > 0.001;
      rec.shownNow = want;
      if (visible !== rec.lastVisible) { o.visible = visible; rec.lastVisible = visible; }
      if (view.setOpacity) {
        const q = Math.round(rec.opacity * 50) / 50;
        if (q !== rec.lastOpacitySent) {
          rec.lastOpacitySent = q;
          try { view.setOpacity(q); } catch (err) { this._reportError('view.setOpacity', err); }
        }
      } else if (visible && rec.opacity < 0.5 && !want) {
        o.visible = false;
      }
      if (!visible) continue;
      // —— 变换 ——
      const gh = this.heightAt(rec.rx, rec.ry);
      o.position.set(rec.rx, gh + rec.rz, -rec.ry);
      const f = e.facing || 0;
      let da = f - rec.rot;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      rec.rot += da * Math.min(1, dt * 20);
      o.rotation.y = rec.rot;
      try { view.update(dt, e, this); } catch (err) { this._reportError(`view.update(${e.type}:${e.modelId || ''})`, err); }
    }
    for (const rec of toDispose) this._disposeRecord(rec);
  }

  // 节流报错：同一来源每 5 秒最多一次
  _reportError(source, err) {
    const now = performance.now();
    const last = this._errThrottle.get(source) || -1e9;
    if (now - last < 5000) return;
    this._errThrottle.set(source, now);
    console.error(`[渲染] ${source} 出错：`, err);
  }
  reportError(source, err) { this._reportError(source, err); }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    window.removeEventListener('resize', this._onWindowResize);
    this._ro?.disconnect();
    for (const rec of [...this._records.values()]) this._disposeRecord(rec);
    for (const s of this.systems) { try { s.dispose?.(); } catch (err) { /* 忽略 */ } }
    this.systems.length = 0;
    this.webgl.dispose();
    this.webgl.domElement.remove();
  }
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

export function defaultHeight(e) {
  if (!e) return 150;
  switch (e.type) {
    case 'champion': return 220;
    case 'minion': return e.kind === 'siege' ? 150 : e.kind === 'super' ? 170 : 115;
    case 'turret': return e.tier === 'fountain' ? 300 : 520;
    case 'inhibitor': return 260;
    case 'nexus': return 480;
    case 'monster': return e.epic ? 360 : e.large ? 200 : 120;
    case 'pet': return 260;
    case 'ward': return 90;
    default: return 150;
  }
}

// 渲染器内置的极简占位（视图工厂缺失/返回无效时）
function basicPlaceholder(e, playerTeam) {
  const h = defaultHeight(e);
  const r = Math.max(20, Math.min(160, e.radius || 50));
  const color = e.team === 2 ? 0xd9a441 : e.team === playerTeam ? 0x3a8fe0 : 0xd84a4a;
  const g = new THREE.CylinderGeometry(r * 0.6, r * 0.75, h, 10);
  g.translate(0, h / 2, 0);
  const m = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return {
    object3d: mesh, height: h,
    update() {},
    dispose() { g.dispose(); m.dispose(); },
  };
}
