// LoL 风格镜头：俯仰 56°、FOV 38°、锁定/解锁跟随、空格居中、屏幕边缘平移、滚轮缩放、震屏、视野多边形（小地图用）
import * as THREE from 'three';
import { MAP_SIZE } from '../config.js';

const DEG = Math.PI / 180;
const EDGE_PX = 14;               // 屏幕边缘平移触发宽度（像素）
const EDGE_SPEED = 2600;          // 默认距离下的边缘平移速度（单位/秒）
const SNAP_DIST = 2600;           // 跟随目标瞬移超过此距离时直接跳过去（复活/传送）

export class CameraController {
  constructor(renderer, { distance = 2250, pitch = 56, fov = 38, minDistance = 1500, maxDistance = 2700 } = {}) {
    this.renderer = renderer;
    this.camera = renderer.camera;
    this.target = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
    this.locked = true;                // Y 切换
    this.followUnit = null;
    this.centering = false;            // 空格按住：临时居中到跟随单位
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.distance = distance;
    this.targetDistance = distance;
    this.pitch = pitch;                // 度，镜头视线与地面的夹角
    this.fov = fov;
    this.edgePanEnabled = true;
    this.pointer = { x: 0, y: 0, inside: false };
    this.panSpeed = EDGE_SPEED;
    this.followSharpness = 14;         // 跟随平滑（越大越硬）
    this._peek = null;                 // 小地图按住时的临时目标
    this._groundH = 0;
    this._shakes = [];
    this._shakeOffset = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._v = new THREE.Vector3();
    this.camera.fov = fov;
    this.camera.near = 50;
    this.camera.far = 30000;
    this.camera.updateProjectionMatrix();
    this._apply(0);
  }

  // —— 控制接口 ——
  follow(unit) {
    this.followUnit = unit || null;
    if (unit) { this.target.x = unit.x; this.target.y = unit.y; }
  }
  setLocked(v) { this.locked = !!v; }
  toggleLock() { this.locked = !this.locked; return this.locked; }
  setTarget(x, y) {
    this.target.x = x; this.target.y = y;
    this._clampTarget();
  }
  // 锁定镜头时，小地图按住期间临时查看某处；松开调用 endPeek()
  peek(x, y) { this._peek = { x, y }; this.target.x = x; this.target.y = y; this._clampTarget(); }
  endPeek() {
    if (!this._peek) return;
    this._peek = null;
  }
  panBy(dx, dy) {
    this.target.x += dx; this.target.y += dy;
    this._clampTarget();
  }
  zoomBy(deltaY) {
    // 滚轮一格约 100 → 缩放 ~150 单位
    this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.targetDistance + deltaY * 1.5));
  }
  zoomTo(d) { this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, d)); }
  shake(intensity = 20, duration = 0.3) {
    if (!(intensity > 0) || !(duration > 0)) return;
    this._shakes.push({ intensity, duration, t: 0, seed: Math.random() * 1000 });
    if (this._shakes.length > 8) this._shakes.shift();
  }
  // 输入模块每次鼠标移动时调用（相对 #game-root 的像素坐标）
  setPointer(x, y, inside = true) { this.pointer.x = x; this.pointer.y = y; this.pointer.inside = inside; }

  get isFollowing() {
    const u = this.followUnit;
    return !!u && !this._peek && (this.locked || this.centering) && u.alive !== false;
  }

  // —— 每帧 ——
  update(dt) {
    const r = this.renderer;
    const u = this.followUnit;
    let goal = null;
    if (this._peek) goal = this._peek;
    else if (u && (this.centering || (this.locked && u.alive !== false))) goal = r.renderPos(u);
    if (goal) {
      const dx = goal.x - this.target.x, dy = goal.y - this.target.y;
      if (dx * dx + dy * dy > SNAP_DIST * SNAP_DIST || this._peek) { this.target.x = goal.x; this.target.y = goal.y; }
      else {
        const k = 1 - Math.exp(-dt * this.followSharpness);
        this.target.x += dx * k; this.target.y += dy * k;
      }
    } else if (this.edgePanEnabled && this.pointer.inside && r.width > 0) {
      const p = this.pointer;
      let ex = 0, ey = 0;
      if (p.x <= EDGE_PX) ex = -1; else if (p.x >= r.width - EDGE_PX) ex = 1;
      if (p.y <= EDGE_PX) ey = 1; else if (p.y >= r.height - EDGE_PX) ey = -1;
      if (ex || ey) {
        const s = this.panSpeed * (this.distance / 2250) * dt;
        const l = Math.hypot(ex, ey);
        this.panBy((ex / l) * s, (ey / l) * s);
      }
    }
    this._clampTarget();
    // 缩放平滑
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-dt * 10));
    // 地面高度低通（避免镜头随墙体起伏抖动）
    const gh = r.heightAt(this.target.x, this.target.y);
    const ghClamped = Math.max(-40, Math.min(80, gh));
    this._groundH += (ghClamped - this._groundH) * (1 - Math.exp(-dt * 4));
    this._updateShake(dt);
    this._apply(dt);
  }

  _updateShake(dt) {
    const o = this._shakeOffset.set(0, 0, 0);
    if (!this._shakes.length) return;
    for (const s of this._shakes) {
      s.t += dt;
      const k = Math.max(0, 1 - s.t / s.duration);
      const a = s.intensity * k * k;
      const ph = (s.t + s.seed) * 60;
      o.x += Math.sin(ph * 1.13) * a;
      o.y += Math.sin(ph * 1.71 + 1.3) * a * 0.6;
      o.z += Math.cos(ph * 1.37 + 0.7) * a;
    }
    this._shakes = this._shakes.filter((s) => s.t < s.duration);
  }

  _clampTarget() {
    const m = 200;
    this.target.x = Math.max(m, Math.min(MAP_SIZE - m, this.target.x));
    this.target.y = Math.max(m, Math.min(MAP_SIZE - m, this.target.y));
  }

  _apply() {
    const cam = this.camera;
    const p = this.pitch * DEG;
    const d = this.distance;
    const tx = this.target.x, ty = this.target.y, th = this._groundH;
    const s = this._shakeOffset;
    cam.position.set(tx + s.x, th + d * Math.sin(p) + s.y, -ty + d * Math.cos(p) + s.z);
    cam.lookAt(tx + s.x, th + s.y, -ty + s.z);
    if (cam.fov !== this.fov) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  // 屏幕四角投射到地面（高度 = 镜头目标地面高度）→ [{x,y}×4]（左上、右上、右下、左下），小地图视野框用
  getViewPolygon() {
    const r = this.renderer;
    const w = r.width || 1, h = r.height || 1;
    const out = [];
    const corners = [[0, 0], [w, 0], [w, h], [0, h]];
    const cam = this.camera;
    for (const [sx, sy] of corners) {
      this._ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
      this._ray.setFromCamera(this._ndc, cam);
      const o = this._ray.ray.origin, dir = this._ray.ray.direction;
      let t;
      if (dir.y < -1e-4) t = (this._groundH - o.y) / dir.y;
      else t = 20000;
      out.push({ x: o.x + dir.x * t, y: -(o.z + dir.z * t) });
    }
    return out;
  }
}
