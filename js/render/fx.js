// 特效系统（fx）：契约 §10.3 全部图元、15 种内置投射物、区域视觉、英雄自定义特效注册与 FXContext
// 性能：辉光精灵为实例化批（2 次 draw call），粒子为 GPU 积分环形缓冲（2 次 draw call）；
//       贴花/光束/拖尾/刀光/护盾/光柱均对象池复用，材质按 key 缓存，运行期几乎零分配
import { makeTextures, TILE } from './fx/textures.js';
import { QuadBatch, ParticleSystem } from './fx/gpu.js';
import {
  DECAL, BEAM, makeDecalMaterial, makeGridGeometry, placeDecal, makeBeamMaterial, makeStripGeometry,
  makeArcGeometry, makeSlashMaterial, makeShieldMaterial, makePillarMaterial,
} from './fx/materials.js';
import { Ribbon, writeStrip, spawnBuiltinProjectile, PROJECTILE_STYLES, BUILTIN_PROJECTILES } from './fx/projectiles.js';

export { BUILTIN_PROJECTILES, DECAL, BEAM };
export const ATTACH_KINDS = ['weaponGlow', 'flames', 'sparkles', 'electric', 'frost', 'haste', 'heal', 'silence', 'stun'];
export const IMPACT_STYLES = ['small', 'phys', 'spark', 'magic', 'fire', 'explosion', 'explosionSmall', 'big', 'frost', 'light'];

const NOOP = Object.freeze({ remove() {}, alive: false, object3d: null });
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeOut3 = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const num = (v, d) => (Number.isFinite(v) ? v : d);
const rnd = (a, b) => a + Math.random() * (b - a);   // 仅表现层
const alive = (u) => !!u && u.alive !== false && !u.removed;
// 淡入淡出包络
const env = (age, dur, fin, fout) => {
  const a = fin > 0 ? age / fin : 1, b = fout > 0 ? (dur - age) / fout : 1;
  return clamp01(a < b ? a : b);
};
// 角度：|a| > 2π 视为角度制
const rad = (a) => (Math.abs(a) > 6.6 ? (a * Math.PI) / 180 : a);

// 粒子形状 → 图集格 + 结束尺寸倍率 + 默认混合
const SHAPES = {
  spark: { tile: TILE.spark, s1: 0.2 },
  soft: { tile: TILE.soft, s1: 1.6 },
  smoke: { tile: TILE.smoke, s1: 2.4, normal: true },
  glow: { tile: TILE.glow, s1: 1.3 },
  star: { tile: TILE.star, s1: 0.35 },
  flake: { tile: TILE.flake, s1: 0.6 },
  plus: { tile: TILE.plus, s1: 0.7 },
  streak: { tile: TILE.streak, s1: 0.3 },
  dot: { tile: TILE.dot, s1: 0.3 },
  ember: { tile: TILE.dot, s1: 0.15 },
  shard: { tile: TILE.shard, s1: 0.4 },
  swirl: { tile: TILE.swirl, s1: 1.4 },
  rune: { tile: TILE.rune, s1: 1.1 },
  ring: { tile: TILE.ring, s1: 2.2 },
  chevron: { tile: TILE.chevron, s1: 0.8 },
  bolt: { tile: TILE.bolt, s1: 1 },
  flare: { tile: TILE.flare, s1: 0.5 },
};

// 命中样式：flash 辉光直径、flare 星芒、ring 光环、sparks 火花数、soft 柔光粒子数、smoke 烟、shock 地面冲击波半径
const IMPACT = {
  small: { flash: 80, ring: 70, sparks: 5, spd: 200, spk: 12, dur: 0.2 },
  phys: { flash: 100, flare: 120, sparks: 9, spd: 340, spk: 13, white: 0.7, dur: 0.22 },
  spark: { flash: 64, sparks: 8, spd: 420, spk: 11, white: 0.8, dur: 0.16 },
  magic: { flash: 140, flare: 150, ring: 160, sparks: 8, spd: 240, spk: 14, soft: 8, softSize: 36, dur: 0.32 },
  fire: { flash: 180, sparks: 10, spd: 300, spk: 12, soft: 14, softSize: 62, rise: 320, smoke: 4, c2: 0xff2200, dur: 0.36 },
  explosion: { flash: 270, flare: 260, sparks: 22, spd: 560, spk: 18, soft: 26, softSize: 96, rise: 200, smoke: 10, shock: 230, c2: 0xff3300, dur: 0.48 },
  explosionSmall: { flash: 200, sparks: 12, spd: 400, spk: 14, soft: 12, softSize: 64, rise: 160, smoke: 6, shock: 140, c2: 0xff4a10, dur: 0.36 },
  big: { flash: 260, flare: 300, ring: 240, sparks: 16, spd: 460, spk: 16, bolts: 2, soft: 6, softSize: 50, dur: 0.38 },
  frost: { flash: 150, ring: 170, flakes: 12, shards: 5, sparks: 4, spd: 200, spk: 12, dur: 0.36 },
  light: { flash: 190, flare: 280, ring: 190, stars: 12, sparks: 4, spd: 260, spk: 14, dur: 0.42 },
};

// 附着特效默认色
const ATTACH_COLOR = {
  weaponGlow: 0xffd36a, flames: 0xff7a1a, sparkles: 0xfff0a0, electric: 0x9fdcff, frost: 0x9fe4ff,
  haste: 0x9ae8ff, heal: 0x7cff7a, silence: 0xb46cff, stun: 0xffe45a,
};

class Effect {
  constructor(duration, tick, cleanup) {
    this.age = 0;
    this.duration = duration;
    this.tick = tick;
    this.cleanup = cleanup;
    this.alive = true;
    this.killed = false;
    this.object3d = null;
  }
  remove() { this.killed = true; }
}

// 粒子句柄：remove 立即清掉本批粒子
class ParticleHandle {
  constructor(sys, from, count, birth, life) { this.sys = sys; this.from = from; this.count = count; this.birth = birth; this.life = life; this.object3d = null; }
  get alive() { return this.count > 0 && this.sys.material.uniforms.uTime.value < this.birth + this.life; }
  remove() { if (this.count > 0) { this.sys.kill(this.from, this.count, this.birth); this.count = 0; } }
}

export class FX {
  constructor(renderer, game) {
    const THREE = renderer.THREE;
    this.THREE = THREE;
    this.renderer = renderer;
    this.game = game;
    this.isNull = false;
    this.quality = renderer.quality || 'high';
    this.low = this.quality === 'low';
    this.qScale = this.low ? 0.4 : this.quality === 'medium' ? 0.7 : 1;
    this.root = renderer.groups?.fx || renderer.scene;
    this.time = 0;
    this.dt = 0;
    this.WHITE = new THREE.Color(1, 1, 1);
    this.textures = makeTextures(THREE);
    const atlas = this.textures.atlas;
    this.quads = new QuadBatch(THREE, { texture: atlas, capacity: this.low ? 1536 : 4096, additive: true, renderOrder: 30 });
    this.quadsN = new QuadBatch(THREE, { texture: atlas, capacity: this.low ? 256 : 768, additive: false, renderOrder: 26 });
    this.parts = new ParticleSystem(THREE, { texture: atlas, capacity: this.low ? 3072 : 12288, additive: true, renderOrder: 31 });
    this.partsN = new ParticleSystem(THREE, { texture: atlas, capacity: this.low ? 768 : 3072, additive: false, renderOrder: 27 });
    this.root.add(this.quadsN.mesh, this.partsN.points, this.quads.mesh, this.parts.points);
    this.maxPoint = 256;
    try {
      const gl = renderer.webgl.getContext();
      const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      if (r && r[1] > 0) this.maxPoint = Math.min(1024, r[1]);
    } catch { /* 默认 256 */ }

    this.effects = [];
    this.customs = new Map();
    this.projKinds = new Map();
    this.texts = [];                 // 浮动文字（overlay 绘制）
    this._colors = new Map();
    this._mats = new Map();
    this._decalPool = new Map();
    this._beamPool = [];
    this._ribbonPool = [];
    this._slashPool = [];
    this._shieldPool = [];
    this._pillarPool = [];
    this._arcGeos = new Map();
    this._sphereGeo = new THREE.IcosahedronGeometry(1, this.low ? 2 : 3);
    this._pillarGeo = new THREE.CylinderGeometry(0.82, 1, 1, this.low ? 16 : 28, 1, true);
    this._pillarGeo.translate(0, 0.5, 0);
    this._dummyQuad = {};
    this._hAt = (x, y) => this.renderer.heightAt(x, y);
    this._errs = 0;
    this._warned = new Set();
    this._tmpC = new THREE.Color();
    this._tmpC2 = new THREE.Color();
    this.ctx = this._makeCtx();
  }

  // ———————————————————— 通用工具 ————————————————————
  heightAt(x, y) { return this.renderer.heightAt(x, y); }
  unitHeight(u) {
    if (!u) return 150;
    try { const h = this.renderer.viewHeight(u); return h > 0 ? h : 150; } catch { return 150; }
  }
  // 某点对玩家是否可见
  seen(x, y) {
    const r = this.renderer;
    if (r.revealAll) return true;
    const v = this.game.vision;
    if (!v || typeof v.isVisible !== 'function') return true;
    try { return !!v.isVisible(r.playerTeam, x, y); } catch { return true; }
  }
  // 单位当前是否显示（跟随类特效用）
  unitShown(u) {
    if (!u) return false;
    const r = this.renderer;
    if (r.getView(u)) return r.isShown(u);
    if (r.revealAll || u.team === r.playerTeam) return true;
    return this.seen(u.x, u.y);
  }
  _c(hex) {
    let c = this._colors.get(hex);
    if (!c) {
      if (this._colors.size > 600) this._colors.clear();
      c = new this.THREE.Color(Number.isFinite(hex) || typeof hex === 'string' ? hex : 0xffffff);
      this._colors.set(hex, c);
    }
    return c;
  }
  _err(tag, err) { if (this._errs++ < 12) console.warn(`[fx:${tag}]`, err); }
  _spawn(duration, tick, cleanup) {
    const e = new Effect(duration > 0 ? duration : 0.5, tick, cleanup);
    this.effects.push(e);
    return e;
  }
  get busy() { return this.effects.length > 900; }

  // —— 精灵 ——
  _quad(tileName, additive = true) {
    const b = additive ? this.quads : this.quadsN;
    const q = b.alloc();
    if (!q) return this._dummyQuad;
    q.batch = b;
    q.tile = TILE[tileName] ?? 0;
    return q;
  }
  _freeQuad(q) { if (q && q.batch) q.batch.release(q); }
  setQ(q, color, a = 1, mul = 1) { q.r = color.r * mul; q.g = color.g * mul; q.b = color.b * mul; q.a = a; }

  // —— 粒子（场景坐标；dirX/dirY 为游戏平面方向，速度附加） ——
  _emitScene(x, y, z, floor, shape, color, color2, size, speed, life, gravity, drag, dirX = 0, dirY = 0, alpha = 1) {
    const S = SHAPES[shape] || SHAPES.soft;
    const sys = S.normal ? this.partsN : this.parts;
    const u = Math.random() * TAU, ct = Math.random() * 2 - 1, st = Math.sqrt(1 - ct * ct);
    const sp = speed * (0.3 + 0.7 * Math.random());
    const c2 = color2 || color;
    const s0 = size * (0.7 + 0.6 * Math.random());
    return sys.write(this.time, x, y, z,
      st * Math.cos(u) * sp + dirX * speed, ct * sp * 0.7, st * Math.sin(u) * sp - dirY * speed,
      life * (0.7 + 0.6 * Math.random()), s0, s0 * S.s1,
      color.r, color.g, color.b, alpha, c2.r, c2.g, c2.b, gravity, drag, S.tile, floor + 2);
  }
  // 公开粒子接口（FXContext.particles 同）
  particles(o = {}) {
    const x = num(o.x, 0), y = num(o.y, 0);
    if (o.team !== this.renderer.playerTeam && !o.force && !this.seen(x, y)) return NOOP;
    const S = SHAPES[o.shape] || SHAPES.spark;
    const additive = o.additive ?? !S.normal;
    const sys = additive ? this.parts : this.partsN;
    const count = Math.max(1, Math.round(num(o.count, 12) * this.qScale));
    const col = this._c(o.color ?? 0xffffff), col2 = o.color2 != null ? this._c(o.color2) : col;
    const size = num(o.size, 20), sEnd = num(o.sizeEnd, size * S.s1);
    const speed = num(o.speed, 200), spread = clamp(num(o.spread, 1), 0, 1);
    const life = Math.max(0.05, num(o.life, 0.6)), grav = num(o.gravity, 0), drag = Math.max(0, num(o.drag, 1));
    const g = this.heightAt(x, y), sy = g + num(o.h, 80);
    const R = num(o.radius, 0), alpha = num(o.opacity, 1);
    const dx = num(o.dirX, 0), dy = num(o.dirY, 0), dz = num(o.dirZ, 0);
    const from = sys.cursor, birth = this.time;
    for (let i = 0; i < count; i++) {
      // spread=0 → 竖直向上；spread=1 → 以上半球为主的全向
      const u = Math.random() * TAU;
      const ct = 1 - Math.random() * spread * 1.3;
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const sp = speed * (0.35 + 0.65 * Math.random());
      const ox = R > 0 ? Math.cos(u) * R * Math.random() : 0, oz = R > 0 ? Math.sin(u) * R * Math.random() : 0;
      const s0 = size * (0.7 + 0.6 * Math.random());
      sys.write(birth, x + ox, sy, -(y) + oz,
        st * Math.cos(u) * sp + dx * speed, ct * sp + dz * speed, st * Math.sin(u) * sp - dy * speed,
        life * (0.75 + 0.5 * Math.random()), s0, sEnd * (s0 / size),
        col.r, col.g, col.b, alpha, col2.r, col2.g, col2.b, grav, drag, S.tile, g + 2);
    }
    return new ParticleHandle(sys, from, count, birth, life * 1.25);
  }

  // —— 贴花池 ——
  _decal(additive, n) {
    const key = n * 2 + (additive ? 1 : 0);
    let pool = this._decalPool.get(key);
    if (!pool) { pool = []; this._decalPool.set(key, pool); }
    let rec = pool.pop();
    if (!rec) {
      const mat = makeDecalMaterial(this.THREE, this.textures.noise, { additive });
      const mesh = new this.THREE.Mesh(makeGridGeometry(this.THREE, n), mat);
      mesh.renderOrder = 3;
      mesh.name = 'fxDecal';
      this.root.add(mesh);
      rec = { mesh, mat, u: mat.uniforms, key };
    }
    const u = rec.u;
    u.uMode.value = 0; u.uOpacity.value = 1; u.uWidth.value = 0.1; u.uFill.value = 0; u.uTime.value = this.time;
    u.uProgress.value = 0; u.uAngle.value = 0.5; u.uArrow.value = 0; u.uInner.value = 0; u.uLen.value = 1;
    rec.mesh.visible = false;
    return rec;
  }
  _freeDecal(rec) {
    rec.mesh.visible = false;
    const pool = this._decalPool.get(rec.key);
    if (pool && pool.length < 96) pool.push(rec);
    else { rec.mesh.parent?.remove(rec.mesh); rec.mesh.geometry.dispose(); rec.mat.dispose(); }
  }
  // 地面贴花特效（ring/disc/telegraph/line/cone/shock/rune…共用）
  // o: mode x y follow pos() rot sx sy ou radius n additive color color2 opacity width fill angle arrow inner progress
  //    duration fin fout anim(u,t,age,dt)→缩放|false  opMul(age,dt)→系数|false  until()  always  pulse lift flat
  _ground(o) {
    const dur = o.duration > 0 ? o.duration : 0.5;
    const R = Math.max(1, o.radius || Math.max(o.sx || 0, o.sy || 0) / 2 || 100);
    const n = o.n || (R <= 180 ? 5 : R <= 520 ? 9 : 13);
    const rec = this._decal(o.additive !== false, n);
    const u = rec.u;
    u.uMode.value = o.mode;
    u.uColor.value.copy(this._c(o.color ?? 0xffffff));
    if (o.color2 != null) u.uColor2.value.copy(this._c(o.color2));
    else u.uColor2.value.copy(u.uColor.value).lerp(this.WHITE, 0.5);
    u.uWidth.value = o.width ?? 0.08;
    u.uFill.value = o.fill ?? 0;
    u.uAngle.value = o.angle ?? 0.5;
    u.uArrow.value = o.arrow ?? 0;
    u.uInner.value = o.inner ?? 0;
    u.uProgress.value = o.progress ?? 0;
    const baseOp = o.opacity ?? 1;
    const sx = o.sx || R * 2, sy = o.sy || R * 2, ou = o.ou ?? 0.5, rot = o.rot || 0;
    const lift = o.lift ?? (R > 600 ? 7 : 4);
    const flat = o.flat ?? (R <= 90);
    const fin = o.fin ?? Math.min(0.08, dur * 0.2), fout = o.fout ?? Math.min(0.3, dur * 0.4);
    const follow = o.follow && typeof o.follow === 'object' ? o.follow : null;
    let lx = NaN, ly = NaN, ls = NaN;
    const tick = (dt, e) => {
      let x = o.x, y = o.y, vis;
      if (follow) {
        if (!alive(follow)) return false;
        const p = this.renderer.renderPos(follow);
        x = p.x; y = p.y;
        vis = this.unitShown(follow);
      } else if (o.pos) {
        const p = o.pos();
        if (!p) return false;
        x = p.x; y = p.y;
        vis = o.always || this.seen(x, y);
      } else vis = o.always || this.seen(x, y);
      if (o.until && o.until()) return false;
      const t = clamp01(e.age / dur);
      let s = 1;
      if (o.anim) {
        const r = o.anim(u, t, e.age, dt);
        if (r === false) return false;
        if (typeof r === 'number') s = r;
      }
      let op = baseOp * env(e.age, dur, fin, fout);
      if (o.opMul) {
        const m = o.opMul(e.age, dt);
        if (m === false) return false;
        op *= m;
      }
      if (o.pulse) op *= 0.72 + 0.28 * Math.sin(e.age * 5.5);
      u.uOpacity.value = op;
      u.uTime.value = this.time;
      rec.mesh.visible = vis && op > 0.002 && s > 0.001;
      if (rec.mesh.visible && (x !== lx || y !== ly || s !== ls)) {
        placeDecal(rec.mesh, this._hAt, x, y, sx * s, sy * s, rot, lift, ou, 0.5, flat);
        lx = x; ly = y; ls = s;
      }
      return true;
    };
    const e = this._spawn(dur, tick, () => this._freeDecal(rec));
    e.object3d = rec.mesh;
    return e;
  }

  // —— 光束 / 拖尾 / 刀光 / 护盾 / 光柱 池 ——
  _beam(mode = BEAM.ENERGY) {
    let rec = this._beamPool.pop();
    if (!rec) {
      const geo = makeStripGeometry(this.THREE, 1);
      const mat = makeBeamMaterial(this.THREE, this.textures.noise);
      const mesh = new this.THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 29;
      mesh.name = 'fxBeam';
      this.root.add(mesh);
      rec = { geo, mat, mesh, u: mat.uniforms };
    }
    rec.u.uMode.value = mode;
    rec.u.uOpacity.value = 1;
    rec.mesh.visible = false;
    return rec;
  }
  _freeBeam(rec) { rec.mesh.visible = false; this._beamPool.push(rec); }
  _ribbon() {
    let r = this._ribbonPool.pop();
    if (!r) { r = new Ribbon(this.THREE, this.low ? 10 : 16); this.root.add(r.mesh); }
    r.mesh.visible = false;
    r.hidden = false;
    return r;
  }
  _freeRibbon(r) { r.mesh.visible = false; r.count = 0; this._ribbonPool.push(r); }
  _arcGeo(deg) {
    const k = Math.round(clamp(deg, 10, 360) / 5) * 5;
    let g = this._arcGeos.get(k);
    if (!g) { g = makeArcGeometry(this.THREE, (k * Math.PI) / 180, Math.max(12, Math.round(k / 5)), 0.42); this._arcGeos.set(k, g); }
    return g;
  }
  _slash(deg) {
    let rec = this._slashPool.pop();
    if (!rec) {
      const mat = makeSlashMaterial(this.THREE);
      const mesh = new this.THREE.Mesh(this._arcGeo(deg), mat);
      mesh.renderOrder = 28;
      mesh.rotation.order = 'YXZ';
      mesh.name = 'fxSlash';
      this.root.add(mesh);
      rec = { mesh, mat, u: mat.uniforms };
    }
    rec.mesh.geometry = this._arcGeo(deg);
    rec.mesh.visible = false;
    rec.u.uOpacity.value = 1;
    rec.u.uProgress.value = 0;
    rec.u.uTrail.value = 0.65;
    return rec;
  }
  _freeSlash(rec) { rec.mesh.visible = false; this._slashPool.push(rec); }
  _shieldMesh() {
    let rec = this._shieldPool.pop();
    if (!rec) {
      const mat = makeShieldMaterial(this.THREE, this.textures.noise);
      const mesh = new this.THREE.Mesh(this._sphereGeo, mat);
      mesh.renderOrder = 25;
      mesh.name = 'fxShield';
      this.root.add(mesh);
      rec = { mesh, mat, u: mat.uniforms };
    }
    rec.mesh.visible = false;
    rec.u.uHit.value = 0;
    return rec;
  }
  _freeShield(rec) { rec.mesh.visible = false; this._shieldPool.push(rec); }
  _pillar() {
    let rec = this._pillarPool.pop();
    if (!rec) {
      const mat = makePillarMaterial(this.THREE, this.textures.noise);
      const mesh = new this.THREE.Mesh(this._pillarGeo, mat);
      mesh.renderOrder = 24;
      mesh.name = 'fxPillar';
      this.root.add(mesh);
      rec = { mesh, mat, u: mat.uniforms };
    }
    rec.mesh.visible = false;
    return rec;
  }
  _freePillar(rec) { rec.mesh.visible = false; this._pillarPool.push(rec); }

  // 一组「弹出」精灵：尺寸 s0→s1、透明度 a0→0（可旋转），用于命中/闪光
  _pops(items, dur) {
    const tick = (dt, e) => {
      for (let i = 0; i < items.length; i++) {
        const it = items[i], k = clamp01(e.age / it.dur);
        const q = it.q;
        const s = it.s0 + (it.s1 - it.s0) * easeOut3(k);
        q.w = s * (it.sx || 1); q.h = s * (it.sy || 1);
        q.a = it.a0 * (1 - k) * (1 - k * 0.5);
        if (it.spin) q.rot = it.rot0 + it.spin * e.age;
        q.visible = k < 1;
      }
    };
    return this._spawn(dur, tick, () => { for (const it of items) this._freeQuad(it.q); });
  }
  _pop(items, tile, x, y, z, color, s0, s1, a0, dur, o = {}) {
    const q = this._quad(tile, o.additive !== false);
    q.x = x; q.y = y; q.z = z; q.w = q.h = s0;
    this.setQ(q, color, a0);
    q.rot = o.rot ?? Math.random() * TAU;
    items.push({ q, s0, s1, a0, dur, spin: o.spin || 0, rot0: q.rot, sx: o.sx, sy: o.sy });
    return q;
  }

  // ———————————————————— 契约图元 ————————————————————
  ring(o = {}) {
    const R = Math.max(5, num(o.radius, 150)), dur = num(o.duration, 0.5), wpx = num(o.width, 14);
    const expand = !!o.expand;
    return this._ground({
      mode: DECAL.RING, x: num(o.x, 0), y: num(o.y, 0), follow: o.follow, radius: R, color: o.color ?? 0xffffff, color2: o.color2,
      opacity: num(o.opacity, 1), width: clamp(wpx / R, 0.004, 0.9), fill: num(o.fill, expand ? 0.05 : 0.08), duration: dur,
      fin: expand ? 0.02 : undefined, fout: expand ? dur * 0.75 : undefined, always: o.always, pulse: o.pulse,
      anim: expand ? (u, t) => { const s = 0.18 + 0.82 * easeOut3(t); u.uWidth.value = clamp(wpx / (R * s), 0.004, 0.9); return s; } : null,
    });
  }
  disc(o = {}) {
    const R = Math.max(5, num(o.radius, 150));
    const c = this._tmpC.copy(this._c(o.color ?? 0x66aaff)).multiplyScalar(0.55);
    return this._ground({
      mode: DECAL.DISC, x: num(o.x, 0), y: num(o.y, 0), follow: o.follow, radius: R, color: o.color ?? 0x66aaff, color2: c.getHex(),
      opacity: num(o.opacity, 0.35) * 1.6, width: clamp(12 / R, 0.01, 0.25), fill: 1, duration: num(o.duration, 0.5), pulse: !!o.pulse, always: o.always,
    });
  }
  telegraph(o = {}) {
    const col = o.color ?? 0xff4a2a, dur = num(o.duration, 1);
    if (Number.isFinite(o.x2) && Number.isFinite(o.y2)) {
      const dx = o.x2 - o.x, dy = o.y2 - o.y, len = Math.hypot(dx, dy) || 1, w = Math.max(10, num(o.width, 120));
      return this._ground({
        mode: DECAL.RECT, x: o.x, y: o.y, sx: len, sy: w, ou: 0, rot: Math.atan2(dy, dx), radius: Math.max(len, w) / 2, n: len > 800 ? 13 : 9,
        color: col, width: clamp(8 / (w / 2), 0.04, 0.4), fill: 0.2, duration: dur, fin: 0.06, fout: 0.1, always: o.always,
        anim: (u, t) => { u.uProgress.value = Math.max(0.001, t); },
      });
    }
    const R = Math.max(10, num(o.radius, 200));
    return this._ground({
      mode: DECAL.TELEGRAPH, x: num(o.x, 0), y: num(o.y, 0), follow: o.follow, radius: R, color: col, width: clamp(9 / R, 0.008, 0.2),
      fill: 0.07, duration: dur, fin: 0.06, fout: 0.1, always: o.always,
      anim: (u, t) => { u.uProgress.value = t; },
    });
  }
  line(o = {}) {
    const x1 = num(o.x1, 0), y1 = num(o.y1, 0), x2 = num(o.x2, x1 + 1), y2 = num(o.y2, y1);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, w = Math.max(6, num(o.width, 80)), dur = num(o.duration, 0.4);
    return this._ground({
      mode: DECAL.RECT, x: x1, y: y1, sx: len, sy: w, ou: 0, rot: Math.atan2(dy, dx), radius: Math.max(len, w) / 2, n: len > 800 ? 13 : 9,
      color: o.color ?? 0xffffff, width: clamp(8 / (w / 2), 0.04, 0.5), fill: num(o.fill, 0.55), arrow: num(o.arrow, 0),
      duration: dur, fin: 0.03, fout: dur * 0.6, always: o.always,
    });
  }
  cone(o = {}) {
    const range = Math.max(20, num(o.range, 400)), a = num(o.angle, 60);
    const full = a > 6.3 ? (a * Math.PI) / 180 : a;
    return this._ground({
      mode: DECAL.CONE, x: num(o.x, 0), y: num(o.y, 0), radius: range, rot: Math.atan2(num(o.dirY, 0), num(o.dirX, 1)),
      color: o.color ?? 0xffffff, angle: clamp(full / 2, 0.02, Math.PI), width: clamp(9 / range, 0.004, 0.1), fill: 0.45,
      duration: num(o.duration, 0.4), always: o.always,
      anim: (u, t) => { u.uProgress.value = Math.max(0.001, easeOut(Math.min(1, t * 1.8))); },
    });
  }
  // 地面冲击波（扩散）
  shockwave(o = {}) {
    const R = Math.max(20, num(o.radius, 200)), dur = num(o.duration, 0.45);
    return this._ground({
      mode: DECAL.SHOCK, x: num(o.x, 0), y: num(o.y, 0), radius: R, color: o.color ?? 0xffc080, opacity: num(o.opacity, 1),
      duration: dur, fin: 0.01, fout: dur * 0.5, always: o.always,
      anim: (u, t) => { u.uProgress.value = 0.08 + 0.9 * easeOut(t); },
    });
  }

  burst(o = {}) {
    const x = num(o.x, 0), y = num(o.y, 0);
    if (!o.always && !this.seen(x, y)) return NOOP;
    const h = num(o.h, 80), col = this._c(o.color ?? 0xffffff), size = num(o.size, 20), speed = num(o.speed, 300);
    const dur = num(o.duration, 0.6);
    const hp = this.particles({
      x, y, h, count: num(o.count, 20), color: o.color ?? 0xffffff, size, speed, spread: 1, life: dur,
      gravity: num(o.gravity, 0), drag: 2.2, shape: o.shape || 'spark', force: true,
    });
    if (!this.busy) {
      const items = [], gz = this.heightAt(x, y) + h;
      this._pop(items, 'glow', x, gz, -y, col, size * 3, size * 7, 0.8, Math.min(0.3, dur * 0.6));
      this._pops(items, 0.3);
    }
    return hp;
  }

  impact(o = {}) {
    const x = num(o.x, 0), y = num(o.y, 0);
    if ((!o.always && !this.seen(x, y)) || this.effects.length > 1200) return NOOP;
    const S = IMPACT[o.style] || IMPACT.magic;
    const size = clamp(num(o.size, 1), 0.2, 6), qs = this.qScale;
    const col = this._c(o.color ?? 0xffffff);
    const hot = this._tmpC2.copy(col).lerp(this.WHITE, S.white ?? 0.55);
    const hotC = this._c(hot.getHex());
    const g = this.heightAt(x, y), sy = g + num(o.h, 80), sz = -y;
    const items = [];
    this._pop(items, 'glow', x, sy, sz, hotC, S.flash * size * 0.4, S.flash * size * 0.9, 0.85, S.dur * 0.75);
    this._pop(items, 'glow', x, sy, sz, col, S.flash * size * 0.8, S.flash * size * 1.5, 0.38, S.dur);
    if (S.flare && !this.low) this._pop(items, 'star', x, sy, sz, hotC, S.flare * size * 0.6, S.flare * size * 1.2, 0.9, S.dur * 0.9, { spin: rnd(-3, 3) });
    if (S.ring) this._pop(items, 'ring', x, sy, sz, col, S.ring * size * 0.3, S.ring * size * 1.3, 0.8, S.dur * 1.1);
    if (S.bolts && !this.low) for (let i = 0; i < S.bolts; i++) this._pop(items, 'bolt', x, sy, sz, hotC, 120 * size, 200 * size, 0.9, S.dur * 0.6);
    if (S.shards) for (let i = 0; i < S.shards; i++) this._pop(items, 'shard', x + rnd(-30, 30) * size, sy + rnd(-20, 30) * size, sz + rnd(-30, 30) * size, hotC, 30 * size, 60 * size, 0.9, S.dur);
    this._pops(items, S.dur * 1.2);
    const n = (k) => Math.max(1, Math.round(k * qs));
    if (S.sparks) for (let i = 0, c = n(S.sparks); i < c; i++) this._emitScene(x, sy, sz, g, 'spark', hotC, col, S.spk * size, S.spd * size, 0.32, 520, 3);
    if (S.soft) {
      const c2 = S.c2 != null ? this._c(S.c2) : col;
      for (let i = 0, c = n(S.soft); i < c; i++) this._emitScene(x, sy, sz, g, 'soft', hotC, c2, S.softSize * size, 160 * size, 0.45, -(S.rise || 60), 3.2);
    }
    if (S.smoke && !this.low) {
      const sc = this._c(0x3a3430);
      for (let i = 0, c = n(S.smoke); i < c; i++) this._emitScene(x, sy - 10, sz, g, 'smoke', sc, null, 70 * size, 90 * size, 1.1, -70, 2, 0, 0, 0.5);
    }
    if (S.flakes) for (let i = 0, c = n(S.flakes); i < c; i++) this._emitScene(x, sy, sz, g, 'flake', hotC, col, 22 * size, 220 * size, 0.6, 240, 2.5);
    if (S.stars) for (let i = 0, c = n(S.stars); i < c; i++) this._emitScene(x, sy, sz, g, 'star', hotC, col, 24 * size, S.spd * size, 0.55, 60, 2.5);
    if (S.shock) this.shockwave({ x, y, radius: S.shock * size, color: S.c2 ?? col.getHex(), duration: 0.45, always: true });
    return NOOP;
  }

  beam(o = {}) {
    const from = o.from && typeof o.from === 'object' ? o.from : null, to = o.to && typeof o.to === 'object' ? o.to : null;
    const dur = num(o.duration, 0.3), w0 = num(o.width, 40), h = num(o.h, 80);
    const mode = o.style === 'lightning' ? BEAM.LIGHTNING : o.style === 'chain' ? BEAM.CHAIN : BEAM.ENERGY;
    const rec = this._beam(mode);
    const col = this._c(o.color ?? 0x9fdcff);
    rec.u.uColor.value.copy(col);
    rec.u.uCore.value.copy(col).lerp(this.WHITE, 0.75);
    const hot = this._c(rec.u.uCore.value.getHex());
    const qa = this._quad('glow'), qb = this._quad('glow'), qf = this.low ? null : this._quad('star');
    this.setQ(qa, col, 0.8); this.setQ(qb, hot, 1); if (qf) this.setQ(qf, hot, 0.8);
    const cam = this.renderer.camera.position;
    const endPos = (u, fx, fy, fh, out) => {
      if (u && alive(u)) {
        const p = this.renderer.renderPos(u);
        out.x = p.x; out.z = -p.y; out.y = this.heightAt(p.x, p.y) + (p.z || 0) + this.unitHeight(u) * 0.5; out.gx = p.x; out.gy = p.y;
      } else { out.x = fx; out.z = -fy; out.y = this.heightAt(fx, fy) + fh; out.gx = fx; out.gy = fy; }
      return out;
    };
    const A = {}, B = {};
    const x1 = num(o.x1, from?.x ?? 0), y1 = num(o.y1, from?.y ?? 0), x2 = num(o.x2, to?.x ?? x1), y2 = num(o.y2, to?.y ?? y1);
    const tick = (dt, e) => {
      endPos(from, x1, y1, h, A);
      endPos(to, x2, y2, to ? h : h, B);
      const k = env(e.age, dur, 0.04, dur * 0.55);
      const vis = o.always || this.seen(A.gx, A.gy) || this.seen(B.gx, B.gy);
      const w = w0 * (0.35 + 0.65 * k) * (1 + Math.sin(e.age * 40) * 0.06);
      const len = writeStrip(rec.geo, A.x, A.y, A.z, B.x, B.y, B.z, w, cam);
      rec.u.uLen.value = Math.max(1, len);
      rec.u.uTime.value = this.time;
      rec.u.uOpacity.value = k;
      rec.mesh.visible = vis && len > 1;
      qa.x = A.x; qa.y = A.y; qa.z = A.z; qa.w = qa.h = w0 * 2.6; qa.a = 0.7 * k; qa.visible = vis;
      qb.x = B.x; qb.y = B.y; qb.z = B.z; qb.w = qb.h = w0 * 3.4 * (0.9 + Math.random() * 0.2); qb.a = k; qb.visible = vis;
      if (qf) { qf.x = B.x; qf.y = B.y; qf.z = B.z; qf.w = qf.h = w0 * 5; qf.rot = this.time * 3; qf.a = 0.7 * k; qf.visible = vis; }
    };
    const e = this._spawn(dur, tick, () => { this._freeBeam(rec); this._freeQuad(qa); this._freeQuad(qb); if (qf) this._freeQuad(qf); });
    e.object3d = rec.mesh;
    if (!o.noSparks && (o.always || this.seen(x2, y2))) {
      endPos(to, x2, y2, h, B);
      const g = this.heightAt(B.gx, B.gy);
      for (let i = 0, c = Math.round(8 * this.qScale); i < c; i++) this._emitScene(B.x, B.y, B.z, g, 'spark', hot, col, 14, 300, 0.35, 400, 3);
    }
    return e;
  }

  slash(o = {}) {
    const u = o.unit && typeof o.unit === 'object' ? o.unit : null;
    const arc = clamp(num(o.arc, 120), 10, 360), R = Math.max(20, num(o.radius, 200)), dur = Math.max(0.05, num(o.duration, 0.25));
    const ang = rad(num(o.angle, u ? u.facing || 0 : 0));
    const rec = this._slash(arc);
    const col = this._c(o.color ?? 0xffffff);
    rec.u.uColor.value.copy(col);
    rec.u.uCore.value.copy(col).lerp(this.WHITE, 0.8);
    const tilt = num(o.tilt, rnd(-0.18, 0.18));
    const x0 = num(o.x, u?.x ?? 0), y0 = num(o.y, u?.y ?? 0);
    let sparked = false;
    const tick = (dt, e) => {
      let x = x0, y = y0, z = 0, vis;
      if (u && alive(u)) { const p = this.renderer.renderPos(u); x = p.x; y = p.y; z = p.z || 0; vis = this.unitShown(u); } else vis = this.seen(x, y);
      const hh = num(o.h, u ? this.unitHeight(u) * 0.42 : 90);
      const t = clamp01(e.age / dur);
      rec.u.uProgress.value = easeOut(t);
      rec.u.uOpacity.value = 1 - clamp01((t - 0.55) / 0.45);
      const m = rec.mesh;
      m.visible = vis;
      m.position.set(x, this.heightAt(x, y) + z + hh, -y);
      m.rotation.set(tilt, ang, 0);
      m.scale.setScalar(R * (0.92 + 0.08 * t));
      if (!sparked && t > 0.45 && vis) {
        sparked = true;
        const a = ang + rad(arc) * 0.5 * 0.9, g = this.heightAt(x, y);
        const ex = x + Math.cos(a) * R, ey = y + Math.sin(a) * R;
        for (let i = 0, c = Math.round(6 * this.qScale); i < c; i++) this._emitScene(ex, g + z + hh, -ey, g, 'spark', rec.u.uCore.value, col, 12, 260, 0.3, 300, 3);
      }
    };
    const e = this._spawn(dur, tick, () => this._freeSlash(rec));
    e.object3d = rec.mesh;
    return e;
  }

  spin(o = {}) {
    const u = o.unit && typeof o.unit === 'object' ? o.unit : null;
    if (!u) return NOOP;
    const R = Math.max(40, num(o.radius, 200)), dur = Math.max(0.1, num(o.duration, 1));
    const col = this._c(o.color ?? 0xffe9a0);
    const blades = [this._slash(200), this._slash(200)];
    for (const b of blades) {
      b.u.uColor.value.copy(col);
      b.u.uCore.value.copy(col).lerp(this.WHITE, 0.75);
      b.u.uTrail.value = 0.9;
      b.u.uProgress.value = 1 / 1.9;   // 刀锋在弧末端，尾迹铺满
    }
    const ringH = this.ring({ follow: u, radius: R, color: o.color ?? 0xffe9a0, width: 10, duration: dur, fill: 0.12, opacity: 0.8 });
    let dust = 0;
    const tick = (dt, e) => {
      if (!alive(u)) return false;
      const p = this.renderer.renderPos(u);
      const vis = this.unitShown(u);
      const g = this.heightAt(p.x, p.y) + (p.z || 0), H = this.unitHeight(u);
      const k = env(e.age, dur, 0.08, 0.2);
      blades.forEach((b, i) => {
        const m = b.mesh;
        m.visible = vis;
        m.position.set(p.x, g + H * (i ? 0.3 : 0.48), -p.y);
        m.rotation.set(i ? 0.1 : -0.08, -(e.age * 15 + i * Math.PI), 0);
        m.scale.setScalar(R * (i ? 0.92 : 1));
        b.u.uOpacity.value = k * (i ? 0.7 : 1);
      });
      if (vis && !this.low && (dust -= dt) <= 0) {
        dust = 0.07;
        const a = Math.random() * TAU;
        this._emitScene(p.x + Math.cos(a) * R * 0.8, g + 10, -(p.y + Math.sin(a) * R * 0.8), g, 'smoke', this._c(0x8a7a60), null, 60, 60, 0.6, -40, 2, 0, 0, 0.35);
      }
    };
    return this._spawn(dur, tick, () => { for (const b of blades) this._freeSlash(b); ringH.remove(); });
  }

  shield(o = {}) {
    const u = o.unit && typeof o.unit === 'object' ? o.unit : null;
    if (!u) return NOOP;
    const dur = Math.max(0.1, num(o.duration, 2)), col = this._c(o.color ?? 0xffe07a);
    const rec = this._shieldMesh();
    rec.u.uColor.value.copy(col);
    const R0 = o.radius > 0 ? o.radius : Math.max(80, (u.radius || 50) * 1.7);
    let lastHit = u.lastDamagedAt, hadShield = false, broke = false;
    const tick = (dt, e) => {
      if (!alive(u)) return false;
      const p = this.renderer.renderPos(u);
      const vis = this.unitShown(u);
      const H = this.unitHeight(u);
      const vr = Math.max(R0, H * 0.62);
      const pop = e.age < 0.18 ? easeOut3(e.age / 0.18) * 1.12 : 1.12 - Math.min(0.12, (e.age - 0.18) * 0.8);
      const m = rec.mesh;
      m.visible = vis;
      m.position.set(p.x, this.heightAt(p.x, p.y) + (p.z || 0) + vr * 0.72, -p.y);
      m.scale.set(R0 * pop, vr * pop, R0 * pop);
      m.rotation.y = e.age * 0.4;
      if (u.lastDamagedAt !== lastHit) { lastHit = u.lastDamagedAt; rec.u.uHit.value = 1; }
      rec.u.uHit.value = Math.max(0, rec.u.uHit.value - dt * 5);
      rec.u.uTime.value = this.time;
      rec.u.uOpacity.value = env(e.age, dur, 0.1, 0.35) * 0.85;
      // 护盾被打破：提前结束并碎裂
      const ts = Number(u.totalShield) || 0;
      if (e.age < 0.2 && ts > 0) hadShield = true;
      if (hadShield && e.age > 0.25 && ts <= 0) { broke = true; return false; }
    };
    const e = this._spawn(dur, tick, () => {
      this._freeShield(rec);
      if (broke && this.unitShown(u)) {
        const p = this.renderer.renderPos(u), H = this.unitHeight(u);
        this.burst({ x: p.x, y: p.y, h: H * 0.5, color: col.getHex(), count: 22, size: 18, speed: 420, duration: 0.5, gravity: 500, shape: 'shard', always: true });
      }
    });
    e.object3d = rec.mesh;
    return e;
  }

  aura(o = {}) {
    const u = o.unit && typeof o.unit === 'object' ? o.unit : null;
    if (!u) return NOOP;
    const R = Math.max(30, num(o.radius, 150)), dur = Math.max(0.1, num(o.duration, 1)), colHex = o.color ?? 0x9ae8ff;
    const col = this._c(colHex);
    const d = this._ground({ mode: DECAL.AURA, follow: u, radius: R, color: colHex, opacity: 0.8, width: clamp(8 / R, 0.01, 0.1), fill: 0.7, duration: dur });
    let acc = 0;
    const tick = (dt, e) => {
      if (!alive(u)) return false;
      if (!this.unitShown(u)) return;
      acc += dt * 14 * this.qScale;
      if (acc > 6) acc = 6;
      while (acc >= 1) {
        acc -= 1;
        const p = this.renderer.renderPos(u), g = this.heightAt(p.x, p.y), a = Math.random() * TAU, r = R * (0.3 + 0.7 * Math.random());
        this._emitScene(p.x + Math.cos(a) * r, g + 8, -(p.y + Math.sin(a) * r), g, 'soft', col, col, 22, 20, 0.9, -110, 1);
      }
    };
    return this._spawn(dur, tick, () => d.remove());
  }

  // —— 附着特效 ——
  // 通用骨架：跟随单位的若干精灵 + 连续粒子发射 + 可选子特效（结束时一并移除）
  _unitFx(u, dur, o) {
    const qs = (o.tiles || []).map((t) => this._quad(t, true));
    const P = { x: 0, y: 0, z: 0, gx: 0, gy: 0, g: 0, H: 180, f: 0, r: 50 };
    let acc = 0;
    const subs = o.subs || [];
    const tick = (dt, e) => {
      if (!alive(u)) return false;
      if (o.until && e.age > 0.12 && o.until()) return false;
      const p = this.renderer.renderPos(u);
      P.gx = p.x; P.gy = p.y; P.x = p.x; P.z = -p.y;
      P.g = this.heightAt(p.x, p.y); P.y = P.g + (p.z || 0);
      P.H = this.unitHeight(u); P.f = u.facing || 0; P.r = u.radius || 50;
      const vis = this.unitShown(u);
      const k = env(e.age, dur, 0.1, Math.min(0.3, dur * 0.3));
      for (const q of qs) q.visible = vis;
      if (o.frame) o.frame(qs, P, e.age, dt, k);
      if (vis && o.rate && o.emit) {
        acc += dt * o.rate * this.qScale;
        if (acc > 12) acc = 12;
        while (acc >= 1) { acc -= 1; o.emit(P, k); }
      } else acc = 0;
    };
    return this._spawn(dur, tick, () => { for (const q of qs) this._freeQuad(q); for (const s of subs) s?.remove?.(); });
  }

  attach(o = {}) {
    const u = o.unit && typeof o.unit === 'object' ? o.unit : null;
    if (!u || !alive(u)) return NOOP;
    const kind = ATTACH_KINDS.includes(o.kind) ? o.kind : 'sparkles';
    const dur = Math.max(0.1, num(o.duration, 1));
    const colHex = o.color ?? ATTACH_COLOR[kind];
    const col = this._c(colHex), hot = this._c(this._tmpC.copy(col).lerp(this.WHITE, 0.6).getHex());
    const E = (P, x, y, z, shape, c, c2, size, speed, life, grav, drag = 2) => this._emitScene(x, y, z, P.g, shape, c, c2, size, speed, life, grav, drag);
    switch (kind) {
      case 'weaponGlow':
        return this._unitFx(u, dur, {
          tiles: this.low ? ['glow'] : ['glow', 'star'],
          frame: (qs, P, age, dt, k) => {
            const wx = P.x + Math.cos(P.f) * P.r * 0.9, wz = P.z - Math.sin(P.f) * P.r * 0.9, wy = P.y + P.H * 0.5;
            const pl = 0.85 + 0.15 * Math.sin(age * 14);
            qs[0].x = wx; qs[0].y = wy; qs[0].z = wz; qs[0].w = qs[0].h = 120 * pl; this.setQ(qs[0], col, 0.75 * k);
            if (qs[1]) { qs[1].x = wx; qs[1].y = wy; qs[1].z = wz; qs[1].w = qs[1].h = 150 * pl; qs[1].rot = age * 2; this.setQ(qs[1], hot, 0.5 * k); }
            P.wx = wx; P.wy = wy; P.wz = wz;
          },
          rate: 26,
          emit: (P) => E(P, P.wx + rnd(-30, 30), P.wy + rnd(-40, 40), P.wz + rnd(-30, 30), 'spark', hot, col, 14, 50, 0.45, -120),
        });
      case 'flames': {
        const red = this._c(0xc01800), ember = this._c(0xffc060);
        let n = 0;
        return this._unitFx(u, dur, {
          tiles: ['glow'],
          frame: (qs, P, age, dt, k) => { const q = qs[0]; q.x = P.x; q.y = P.y + P.H * 0.45; q.z = P.z; q.w = q.h = P.H * 1.3 * (0.9 + Math.random() * 0.2); this.setQ(q, col, 0.3 * k); },
          rate: 46,
          emit: (P) => {
            const a = Math.random() * TAU, r = P.r * 0.6 * Math.random();
            const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r, y = P.y + P.H * (0.12 + 0.6 * Math.random());
            if (++n % 4 === 0) E(P, x, y, z, 'ember', ember, red, 10, 90, 0.8, -200, 1.5);
            else E(P, x, y, z, 'soft', col, red, 40, 30, 0.5, -330, 1.6);
          },
        });
      }
      case 'sparkles':
        return this._unitFx(u, dur, {
          rate: 22,
          emit: (P) => { const a = Math.random() * TAU, r = P.r * (0.6 + Math.random() * 0.8); E(P, P.x + Math.cos(a) * r, P.y + Math.random() * P.H, P.z + Math.sin(a) * r, 'star', hot, col, 20, 25, 0.8, -40, 1); },
        });
      case 'electric': {
        let jt = 0;
        return this._unitFx(u, dur, {
          tiles: this.low ? ['bolt', 'glow'] : ['bolt', 'bolt', 'glow'],
          frame: (qs, P, age, dt, k) => {
            const gq = qs[qs.length - 1];
            gq.x = P.x; gq.y = P.y + P.H * 0.5; gq.z = P.z; gq.w = gq.h = P.H * 1.2; this.setQ(gq, col, 0.25 * k);
            if ((jt -= dt) <= 0) {
              jt = 0.055;
              for (let i = 0; i < qs.length - 1; i++) {
                const q = qs[i], a = Math.random() * TAU;
                q.x = P.x + Math.cos(a) * P.r * 0.5; q.z = P.z + Math.sin(a) * P.r * 0.5; q.y = P.y + P.H * (0.2 + 0.6 * Math.random());
                q.w = q.h = rnd(70, 130); q.rot = Math.random() * TAU; this.setQ(q, hot, rnd(0.4, 1) * k);
              }
            }
          },
          rate: 12,
          emit: (P) => E(P, P.x + rnd(-30, 30), P.y + P.H * Math.random(), P.z + rnd(-30, 30), 'spark', hot, col, 12, 260, 0.25, 200, 3),
        });
      }
      case 'frost':
        return this._unitFx(u, dur, {
          tiles: ['glow'],
          subs: [this.disc({ follow: u, radius: (u.radius || 50) * 2.4, color: colHex, opacity: 0.22, duration: dur })],
          frame: (qs, P, age, dt, k) => { const q = qs[0]; q.x = P.x; q.y = P.y + P.H * 0.5; q.z = P.z; q.w = q.h = P.H * 1.25; this.setQ(q, col, 0.22 * k); },
          rate: 18,
          emit: (P) => { const a = Math.random() * TAU, r = P.r * 1.2 * Math.random(); E(P, P.x + Math.cos(a) * r, P.y + P.H * (0.6 + Math.random() * 0.5), P.z + Math.sin(a) * r, 'flake', hot, col, 22, 30, 1, 70, 1); },
        });
      case 'haste':
        return this._unitFx(u, dur, {
          subs: [this._ground({ mode: DECAL.AURA, follow: u, radius: (u.radius || 50) * 2.2, color: colHex, opacity: 0.55, width: 0.05, fill: 0.6, duration: dur })],
          rate: 30,
          emit: (P) => {
            const bx = -Math.cos(P.f) * P.r, bz = Math.sin(P.f) * P.r;
            E(P, P.x + bx + rnd(-25, 25), P.y + 10 + Math.random() * P.H * 0.4, P.z + bz + rnd(-25, 25), 'streak', hot, col, 34, 30, 0.4, -20, 2);
          },
        });
      case 'heal':
        return this._unitFx(u, dur, {
          subs: [this.ring({ follow: u, radius: (u.radius || 50) * 2.4, color: colHex, width: 16, expand: true, duration: Math.min(0.7, dur) })],
          rate: 30,
          emit: (P) => { const a = Math.random() * TAU, r = P.r * 1.1 * Math.random(); E(P, P.x + Math.cos(a) * r, P.y + P.H * Math.random() * 0.6, P.z + Math.sin(a) * r, 'plus', hot, col, 26, 20, 0.9, -170, 1.2); },
        });
      case 'silence':
        return this._unitFx(u, dur, {
          tiles: ['ring', 'swirl', 'glow'],
          until: () => typeof u.hasCC === 'function' && !u.hasCC('silence'),
          frame: (qs, P, age, dt, k) => {
            const y = P.y + P.H + 42;
            for (const q of qs) { q.x = P.x; q.y = y; q.z = P.z; }
            qs[0].w = 86; qs[0].h = 34; qs[0].rot = 0; this.setQ(qs[0], col, 0.9 * k);
            qs[1].w = qs[1].h = 46; qs[1].rot = age * 3; this.setQ(qs[1], hot, 0.9 * k);
            qs[2].w = qs[2].h = 110; this.setQ(qs[2], col, 0.35 * k);
          },
        });
      case 'stun':
      default:
        return this._unitFx(u, dur, {
          tiles: ['star', 'star', 'star', 'ring'],
          until: () => typeof u.hasCC === 'function' && !u.hasCC('stun') && !u.hasCC('suppress') && !u.hasCC('airborne'),
          frame: (qs, P, age, dt, k) => {
            const y = P.y + P.H + 20, R = Math.max(30, P.r * 0.8);
            for (let i = 0; i < 3; i++) {
              const q = qs[i], a = age * 5.2 + (i * TAU) / 3;
              q.x = P.x + Math.cos(a) * R; q.z = P.z - Math.sin(a) * R; q.y = y + Math.sin(a) * 5;
              q.w = q.h = 34 * (0.8 + 0.2 * Math.sin(a * 2)); q.rot = age * 4; this.setQ(q, hot, k);
            }
            const r = qs[3]; r.x = P.x; r.y = y; r.z = P.z; r.w = R * 2.6; r.h = R * 0.9; r.rot = 0; this.setQ(r, col, 0.5 * k);
          },
        });
    }
  }

  text(o = {}) {
    const x = num(o.x, 0), y = num(o.y, 0);
    if (!o.always && !this.seen(x, y)) return NOOP;
    if (this.texts.length > 120) this.texts.shift();
    const t = { x, y, h: num(o.h, 150), text: String(o.text ?? ''), color: o.color ?? 0xffffff, size: num(o.size, 18), duration: Math.max(0.1, num(o.duration, 1)), age: 0 };
    this.texts.push(t);
    return { object3d: null, get alive() { return t.age < t.duration; }, remove() { t.age = t.duration; } };
  }

  flash(o = {}) {
    const x = num(o.x, 0), y = num(o.y, 0);
    if (!o.always && !this.seen(x, y)) return NOOP;
    const col = this._c(o.color ?? 0xfff4a0), hot = this._c(this._tmpC.copy(col).lerp(this.WHITE, 0.7).getHex());
    const g = this.heightAt(x, y), sy = g + 90, sz = -y;
    const items = [];
    this._pop(items, 'glow', x, sy, sz, hot, 140, 320, 1, 0.3);
    this._pop(items, 'glow', x, sy, sz, col, 260, 420, 0.5, 0.4);
    if (!this.low) this._pop(items, 'flare', x, sy, sz, hot, 200, 420, 0.9, 0.35, { spin: 2 });
    this._pops(items, 0.42);
    for (let i = 0, c = Math.round(18 * this.qScale); i < c; i++) this._emitScene(x, sy, sz, g, 'spark', hot, col, 16, 420, 0.4, 200, 3);
    for (let i = 0, c = Math.round(8 * this.qScale); i < c; i++) this._emitScene(x, g + 40 + Math.random() * 120, sz, g, 'star', hot, col, 22, 120, 0.6, -60, 2);
    return this.ring({ x, y, radius: 130, color: o.color ?? 0xfff4a0, width: 14, expand: true, duration: 0.4, always: true });
  }

  recall(o = {}) {
    const u = o.unit && typeof o.unit === 'object' ? o.unit : null;
    if (!u) return NOOP;
    const dur = Math.max(0.5, num(o.duration, 8));
    const blue = this._c(0x3f9dff), pale = this._c(0xbfe6ff);
    const p0 = this.renderer.renderPos(u), x0 = p0.x, y0 = p0.y;
    let done = false, lastVis = this.unitShown(u);
    const rune = this._ground({
      mode: DECAL.RUNE, x: x0, y: y0, radius: 190, color: 0x4aa8ff, color2: 0xc8ecff, fill: 0.35, opacity: 1, duration: dur + 1, fout: 0.3,
      opMul: () => (done ? false : lastVis ? 1 : 0), always: true,
      anim: (uu, t, age) => { uu.uProgress.value = clamp01(age / 1.2); },
    });
    const pil = this._pillar();
    pil.u.uColor.value.copy(blue);
    pil.u.uCore.value.copy(pale);
    const glow = this._quad('glow');
    let acc = 0;
    const tick = (dt, e) => {
      if (!alive(u) || (e.age > 0.15 && !u.isRecalling)) {
        const moved = Math.hypot(u.x - x0, u.y - y0) > 500;
        if (moved) { if (lastVis) this.flash({ x: x0, y: y0, color: 0x6ab8ff, always: true }); this.flash({ x: u.x, y: u.y, color: 0x6ab8ff }); }
        done = true;
        return false;
      }
      const vis = lastVis = this.unitShown(u);
      const g = this.heightAt(x0, y0), k = clamp01(e.age / (dur * 0.45));
      const m = pil.mesh;
      m.visible = vis;
      m.position.set(x0, g, -y0);
      m.scale.set(85 + 30 * k, 80 + 520 * easeOut(k), 85 + 30 * k);
      pil.u.uTime.value = this.time;
      pil.u.uOpacity.value = 0.25 + 0.6 * k;
      glow.x = x0; glow.y = g + 110; glow.z = -y0; glow.w = glow.h = 260 + 80 * k; this.setQ(glow, blue, (0.25 + 0.35 * k) * (0.9 + 0.1 * Math.sin(e.age * 8))); glow.visible = vis;
      if (vis) {
        acc += dt * (18 + 30 * k) * this.qScale;
        if (acc > 8) acc = 8;
        while (acc >= 1) {
          acc -= 1;
          const a = Math.random() * TAU, r = 60 + Math.random() * 120;
          this._emitScene(x0 + Math.cos(a) * r, g + 6, -(y0 + Math.sin(a) * r), g, 'soft', pale, blue, 20, 20, 1.1, -260, 1);
        }
      }
    };
    return this._spawn(dur + 0.5, tick, () => { this._freePillar(pil); this._freeQuad(glow); done = true; rune.remove(); });
  }

  levelUp(o = {}) {
    const u = o.unit && typeof o.unit === 'object' ? o.unit : null;
    if (!u || !this.unitShown(u)) return NOOP;
    const dur = 1.2, gold = this._c(0xffc94a), pale = this._c(0xfff2c0);
    const pil = this._pillar();
    pil.u.uColor.value.copy(gold);
    pil.u.uCore.value.copy(pale);
    this.ring({ follow: u, radius: 170, color: 0xffd060, width: 16, expand: true, duration: 0.7 });
    this._ground({ mode: DECAL.RUNE, follow: u, radius: 150, color: 0xffc94a, color2: 0xfff2c0, fill: 0.25, duration: dur, fout: 0.5, anim: (uu, t) => { uu.uProgress.value = t * 3; } });
    let acc = 0;
    const tick = (dt, e) => {
      if (!alive(u)) return false;
      const p = this.renderer.renderPos(u), g = this.heightAt(p.x, p.y) + (p.z || 0);
      const vis = this.unitShown(u), t = e.age / dur;
      const m = pil.mesh;
      m.visible = vis;
      m.position.set(p.x, g, -p.y);
      m.scale.set(75 * (1 - 0.3 * t), 150 + 330 * easeOut3(Math.min(1, t * 2.5)), 75 * (1 - 0.3 * t));
      pil.u.uTime.value = this.time;
      pil.u.uOpacity.value = env(e.age, dur, 0.08, 0.6);
      if (vis && e.age < 0.7) {
        acc += dt * 40 * this.qScale;
        while (acc >= 1) {
          acc -= 1;
          const a = Math.random() * TAU, r = 30 + Math.random() * 70;
          this._emitScene(p.x + Math.cos(a) * r, g + 20 + Math.random() * 100, -(p.y + Math.sin(a) * r), g, 'star', pale, gold, 22, 30, 0.9, -220, 1);
        }
      }
    };
    return this._spawn(dur, tick, () => this._freePillar(pil));
  }

  // ———————————————————— 自定义 / 投射物 / 区域 ————————————————————
  registerCustom(name, fn) { if (typeof name === 'string' && typeof fn === 'function') this.customs.set(name, fn); }
  registerProjectile(kind, fn) { if (typeof kind === 'string' && typeof fn === 'function') this.projKinds.set(kind, fn); }
  hasCustom(name) { return this.customs.has(name); }

  custom(name, params = {}) {
    const fn = this.customs.get(name);
    if (!fn) {
      if (!this._warned.has(name)) { this._warned.add(name); console.warn(`[fx] 未注册的自定义特效：${name}`); }
      return NOOP;
    }
    try {
      const h = fn(this.ctx, params || {});
      return h && typeof h.remove === 'function' ? h : NOOP;
    } catch (err) {
      this._err(`custom:${name}`, err);
      return NOOP;
    }
  }

  projectile(proj) {
    if (!proj) return NOOP;
    const vfx = proj.vfx || {};
    let kind = vfx.kind || 'orb';
    let fn = this.projKinds.get(kind);
    if (!fn && !PROJECTILE_STYLES[kind]) {
      const fb = vfx.fallback;
      fn = fb ? this.projKinds.get(fb) : null;
      kind = fb && PROJECTILE_STYLES[fb] ? fb : 'orb';
    }
    try {
      if (fn) {
        const h = this._customProjectile(fn, proj);
        if (h) return h;
      }
      return spawnBuiltinProjectile(this, proj, kind);
    } catch (err) {
      this._err(`projectile:${kind}`, err);
      return NOOP;
    }
  }
  _customProjectile(fn, proj) {
    let v = null;
    try { v = fn(this.ctx, proj); } catch (err) { this._err(`proj:${proj.vfx?.kind}`, err); }
    if (!v || !v.object3d) return null;
    const obj = v.object3d;
    if (!obj.parent) this.root.add(obj);
    const tick = (dt) => {
      if (proj.dead || proj.age > (proj.maxAge || 12) + 2) return false;
      try { v.update?.(dt, proj); } catch (err) { this._err(`proj:${proj.vfx?.kind}`, err); return false; }
    };
    const e = this._spawn(Infinity, tick, () => {
      obj.parent?.remove(obj);
      try { v.dispose?.(); } catch (err) { this._err('proj.dispose', err); }
    });
    e.object3d = obj;
    return e;
  }

  zone(z) {
    if (!z || !z.vfx) return NOOP;
    const v = z.vfx;
    let kind = v.kind || 'disc';
    const params = { ...v, zone: z, x: z.x, y: z.y, radius: num(v.radius, z.radius), follow: z.follow || null, team: z.team, owner: z.owner, duration: (z.delay || 0) + (z.duration || 0) };
    if (this.customs.has(kind)) return this.custom(kind, params);
    if (kind !== 'disc' && kind !== 'ring') {
      if (v.fallback && this.customs.has(v.fallback)) return this.custom(v.fallback, params);
      kind = v.fallback === 'ring' ? 'ring' : 'disc';
    }
    if (v.teamOnly != null && v.teamOnly !== this.renderer.playerTeam && !this.renderer.revealAll) return NOOP;
    const R = Math.max(10, num(v.radius, z.radius || 200));
    const colHex = v.color ?? (z.team === this.renderer.playerTeam ? 0x5ab4ff : 0xff5a4a);
    const pos = { x: z.x, y: z.y };
    const getPos = () => {
      if (z.follow && alive(z.follow)) { const p = this.renderer.renderPos(z.follow); pos.x = p.x; pos.y = p.y; } else { pos.x = z.x; pos.y = z.y; }
      return pos;
    };
    let fade = 1;
    const opMul = (age, dt) => {
      if (z.dead) { fade -= dt * 4; if (fade <= 0) return false; }
      return fade * (z.started || !(z.delay > 0) ? 1 : 0.55);
    };
    const total = Number.isFinite(z.duration) ? (z.delay || 0) + z.duration + 2 : 1e9;
    const ring = kind === 'ring';
    const c2 = this._tmpC.copy(this._c(colHex)).multiplyScalar(ring ? 1 : 0.55).getHex();
    return this._ground({
      mode: ring ? DECAL.RING : DECAL.DISC, pos: getPos, radius: R, color: colHex, color2: ring ? undefined : c2,
      opacity: ring ? num(v.opacity, 0.9) : num(v.opacity, 0.3) * 1.6, width: clamp((ring ? 14 : 12) / R, 0.01, 0.25), fill: ring ? 0.1 : 1,
      duration: total, fin: 0.12, fout: 0.01, opMul, pulse: !!v.pulse,
      anim: z.delay > 0 ? (u) => { u.uProgress.value = z.started ? 0 : clamp01(z.age / z.delay); u.uMode.value = z.started ? (ring ? DECAL.RING : DECAL.DISC) : DECAL.TELEGRAPH; } : null,
    });
  }

  // ———————————————————— FXContext ————————————————————
  mat(color, o = {}) {
    const additive = o.additive !== false, opacity = num(o.opacity, 1), ds = !!o.doubleSide, dw = !!o.depthWrite;
    const key = `${typeof color === 'number' ? color : String(color)}|${additive}|${opacity}|${ds}|${dw}|${o.emissive ?? ''}`;
    let m = this._mats.get(key);
    if (!m) {
      const THREE = this.THREE;
      m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(o.emissive ?? color ?? 0xffffff), transparent: true, opacity, depthWrite: dw,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: ds ? THREE.DoubleSide : THREE.FrontSide, fog: false,
      });
      m.userData.shared = true;
      this._mats.set(key, m);
    }
    return m;
  }
  sprite(color, size = 100, o = {}) {
    const THREE = this.THREE;
    const m = new THREE.SpriteMaterial({
      map: o.texture || this.textures.glow, color: new THREE.Color(color ?? 0xffffff), transparent: true, depthWrite: false,
      opacity: num(o.opacity, 1), blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false,
    });
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    s.renderOrder = 30;
    return s;
  }
  // ctx.add：挂到特效层；update(t, dt, age) 返回 false 提前结束；follow 时每帧贴到单位（插值位置 + 击飞高度 + followHeight）
  _addObject(obj, o = {}) {
    if (!obj || !obj.isObject3D) return NOOP;
    const dur = o.duration > 0 ? o.duration : 1;
    const follow = o.follow && typeof o.follow === 'object' ? o.follow : null;
    const fh = num(o.followHeight, 0);
    if (!obj.parent) this.root.add(obj);
    let fades = null;
    const fo = o.fadeOut === true ? 0.25 : num(o.fadeOut, 0);
    if (fo > 0) {
      fades = [];
      obj.traverse((c) => {
        const ms = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
        for (const m of ms) if (!fades.some((f) => f.m === m)) { m.transparent = true; fades.push({ m, base: m.opacity }); }
      });
    }
    const up = typeof o.update === 'function' ? o.update : null;
    const tick = (dt, e) => {
      if (follow) {
        if (!alive(follow)) return false;
        const p = this.renderer.renderPos(follow);
        obj.position.set(p.x, this.heightAt(p.x, p.y) + (p.z || 0) + fh, -p.y);
        obj.visible = this.unitShown(follow);
      }
      if (up && up(clamp01(e.age / dur), dt, e.age) === false) return false;
      if (fades) {
        const k = clamp01((dur - e.age) / fo);
        for (const f of fades) f.m.opacity = f.base * k;
      }
    };
    const e = this._spawn(dur, tick, () => {
      obj.parent?.remove(obj);
      if (typeof o.onEnd === 'function') { try { o.onEnd(); } catch (err) { this._err('ctx.onEnd', err); } }
      else obj.traverse((c) => {
        const ms = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
        for (const m of ms) if (!m.userData?.shared) m.dispose?.();
      });
    });
    e.object3d = obj;
    return e;
  }
  _makeCtx() {
    const fx = this, r = this.renderer, THREE = this.THREE;
    return {
      THREE, scene: r.scene, renderer: r, game: fx.game, fx,
      textures: fx.textures,
      get time() { return fx.time; },
      get quality() { return fx.quality; },
      toScene: (x, y, h = 0) => new THREE.Vector3(x, h, -y),
      heightAt: (x, y) => fx.heightAt(x, y),
      add: (obj, o) => fx._addObject(obj, o),
      particles: (o) => fx.particles(o),
      mat: (color, o) => fx.mat(color, o),
      sprite: (color, size, o) => fx.sprite(color, size, o),
      unitHeight: (e) => fx.unitHeight(e),
      getView: (e) => r.getView(e),
      renderPos: (e) => r.renderPos(e),
      seen: (x, y) => fx.seen(x, y),
      unitShown: (e) => fx.unitShown(e),
    };
  }

  // ———————————————————— 每帧 ————————————————————
  update(dt) {
    const g = this.game;
    let d = Number.isFinite(dt) ? dt : 0;
    d = g.paused ? 0 : Math.min(0.25, d * clamp(num(g.speed, 1), 0, 8));
    this.dt = d;
    this.time += d;
    const L = this.effects;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const e = L[i];
      let keep = !e.killed;
      if (keep) {
        e.age += d;
        try { keep = e.tick(d, e) !== false && e.age < e.duration; } catch (err) { this._err('effect', err); keep = false; }
      }
      if (keep) L[w++] = e;
      else {
        e.alive = false;
        try { e.cleanup?.(); } catch (err) { this._err('cleanup', err); }
      }
    }
    L.length = w;
    const T = this.texts;
    if (T.length) {
      let k = 0;
      for (let i = 0; i < T.length; i++) { const t = T[i]; t.age += d; if (t.age < t.duration) T[k++] = t; }
      T.length = k;
    }
    this.quads.flush();
    this.quadsN.flush();
    const r = this.renderer, cam = r.camera;
    const bufH = r.webgl.domElement.height || r.height || 900;
    const scale = bufH / (2 * Math.tan(((cam.fov || 38) * Math.PI) / 360));
    this.parts.update(this.time, scale, this.maxPoint);
    this.partsN.update(this.time, scale, this.maxPoint);
  }

  stats() {
    let decals = 0;
    for (const e of this.effects) if (e.object3d?.name === 'fxDecal') decals++;
    return { effects: this.effects.length, quads: this.quads.count || 0, quadsN: this.quadsN.count || 0, decals, texts: this.texts.length, customs: this.customs.size, projKinds: this.projKinds.size };
  }

  clear() {
    for (const e of this.effects) e.killed = true;
    this.texts.length = 0;
  }

  dispose() {
    for (const e of this.effects) { try { e.cleanup?.(); } catch { /* 忽略 */ } }
    this.effects.length = 0;
    this.quads.dispose(); this.quadsN.dispose(); this.parts.dispose(); this.partsN.dispose();
    this.root.remove(this.quads.mesh, this.quadsN.mesh, this.parts.points, this.partsN.points);
    for (const m of this._mats.values()) m.dispose();
    for (const g of this._arcGeos.values()) g.dispose();
    this._sphereGeo.dispose(); this._pillarGeo.dispose();
    for (const t of Object.values(this.textures)) t?.dispose?.();
  }
}

export default FX;
