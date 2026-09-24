// 内置投射物外观（15 种 kind）+ 拖尾 Ribbon + 摄像机朝向条带；由 FX.projectile 调用，全部复用 FX 的精灵批/粒子/材质缓存
import { makeStripGeometry, makeRibbonMaterial, BEAM } from './materials.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ———————————————————— 拖尾 ————————————————————
// 点列最新在前；按年龄淡出，宽度随年龄收窄；顶点在 CPU 端做摄像机朝向展开
export class Ribbon {
  constructor(THREE, segs = 16) {
    this.THREE = THREE;
    this.segs = segs;
    this.n = segs + 1;
    this.geo = makeStripGeometry(THREE, segs);
    this.mat = makeRibbonMaterial(THREE);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 28;
    this.mesh.name = 'fxRibbon';
    this.px = new Float32Array(this.n); this.py = new Float32Array(this.n); this.pz = new Float32Array(this.n); this.pt = new Float32Array(this.n);
    this.count = 0;
  }
  reset(color, core, width, life, opacity = 1) {
    this.mat.uniforms.uColor.value.copy(color);
    this.mat.uniforms.uCore.value.copy(core);
    this.mat.uniforms.uOpacity.value = opacity;
    this.width = width; this.life = Math.max(0.03, life);
    this.count = 0;
    this.mesh.visible = true;
  }
  // 推入头部位置（场景坐标）
  push(x, y, z, time) {
    const P = this;
    if (P.count > 0) {
      const dx = x - P.px[0], dy = y - P.py[0], dz = z - P.pz[0];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (P.count > 1 && d2 < 64) { P.px[0] = x; P.py[0] = y; P.pz[0] = z; P.pt[0] = time; return; }
      if (d2 > 1e6) P.count = 0;   // 瞬移：断开拖尾
    }
    const m = Math.min(P.count, P.n - 1);
    for (let i = m; i > 0; i--) { P.px[i] = P.px[i - 1]; P.py[i] = P.py[i - 1]; P.pz[i] = P.pz[i - 1]; P.pt[i] = P.pt[i - 1]; }
    P.px[0] = x; P.py[0] = y; P.pz[0] = z; P.pt[0] = time;
    P.count = m + 1;
  }
  // 重建顶点；返回是否仍有可见段
  update(time, cam) {
    const P = this, n = P.n;
    while (P.count > 0 && time - P.pt[P.count - 1] > P.life) P.count--;
    const pos = P.geo.attributes.position.array, fade = P.geo.attributes.aFade.array;
    const c = P.count;
    if (c < 2) { P.mesh.visible = false; return c > 0; }
    P.mesh.visible = true;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    for (let i = 0; i < n; i++) {
      const k = i < c ? i : c - 1;
      const x = P.px[k], y = P.py[k], z = P.pz[k];
      // 切线：相邻点差
      const k2 = k < c - 1 ? k + 1 : k - 1;
      let tx = P.px[k2] - x, ty = P.py[k2] - y, tz = P.pz[k2] - z;
      if (k2 < k) { tx = -tx; ty = -ty; tz = -tz; }
      const vx = cx - x, vy = cy - y, vz = cz - z;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const f = i < c ? clamp01(1 - (time - P.pt[k]) / P.life) : 0;
      const w = P.width * 0.5 * (0.25 + 0.75 * f) * (i === 0 ? 0.8 : 1);
      sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
      const o = i * 6;
      pos[o] = x - sx; pos[o + 1] = y - sy; pos[o + 2] = z - sz;
      pos[o + 3] = x + sx; pos[o + 4] = y + sy; pos[o + 5] = z + sz;
      fade[i * 2] = fade[i * 2 + 1] = f;
    }
    P.geo.attributes.position.needsUpdate = true;
    P.geo.attributes.aFade.needsUpdate = true;
    return true;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

// 摄像机朝向的直条带（光束/锁链）：A→B，宽 w
export function writeStrip(geo, ax, ay, az, bx, by, bz, w, cam) {
  const pos = geo.attributes.position.array;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
  const vx = cam.x - mx, vy = cam.y - my, vz = cam.z - mz;
  let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
  const sl = Math.hypot(sx, sy, sz) || 1;
  const h = w * 0.5 / sl;
  sx *= h; sy *= h; sz *= h;
  pos[0] = ax - sx; pos[1] = ay - sy; pos[2] = az - sz;
  pos[3] = ax + sx; pos[4] = ay + sy; pos[5] = az + sz;
  pos[6] = bx - sx; pos[7] = by - sy; pos[8] = bz - sz;
  pos[9] = bx + sx; pos[10] = by + sy; pos[11] = bz + sz;
  geo.attributes.position.needsUpdate = true;
  return Math.hypot(dx, dy, dz);
}

// ———————————————————— 实体投射物网格（共享几何体，顶点色） ————————————————————
let GEO = null;
function paint(THREE, g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function merge(THREE, parts) {
  const list = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
// 沿 +X 的圆柱/圆锥：长度 len，从 x0 开始
function alongX(THREE, g, x0, len) { g.rotateZ(-Math.PI / 2); g.translate(x0 + len / 2, 0, 0); return g; }
function buildGeos(THREE) {
  const cyl = (r0, r1, len, x0, hex, seg = 6) => paint(THREE, alongX(THREE, new THREE.CylinderGeometry(r1, r0, len, seg, 1), x0, len), hex);
  const box = (w, h, d, x, y, z, hex, rz = 0, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); if (rx) g.rotateX(rx); g.translate(x, y, z); return paint(THREE, g, hex); };
  const arrow = merge(THREE, [
    cyl(2.2, 2.2, 104, -70, 0x8a5a32),
    cyl(7.5, 0.3, 24, 34, 0xdfe6ee, 4),
    box(22, 0.8, 9, -62, 0, 4, 0xf2efe6, 0, 0),
    box(22, 0.8, 9, -62, 0, -4, 0xf2efe6, 0, 0),
    box(22, 9, 0.8, -62, 4, 0, 0xf2efe6),
  ]);
  const spear = merge(THREE, [
    cyl(3.2, 3.2, 170, -120, 0x6b4a2e),
    cyl(10, 0.4, 44, 50, 0xe8eef5, 4),
    cyl(5, 5, 8, 44, 0xc8aa6e, 6),
  ]);
  const hookG = [cyl(3, 3, 60, -40, 0x6f7780), cyl(9, 0.4, 26, 20, 0xb9c3cc, 4)];
  for (const s of [1, -1]) {
    const t = new THREE.TorusGeometry(20, 3.2, 4, 10, Math.PI * 0.9);
    t.rotateX(Math.PI / 2); t.rotateY(s > 0 ? 0 : Math.PI); t.scale(1, 1, s); t.translate(8, 0, 0);
    hookG.push(paint(THREE, t, 0xaab4bd));
  }
  const hook = merge(THREE, hookG);
  const rocket = merge(THREE, [
    cyl(11, 11, 64, -40, 0x5d6670, 8),
    cyl(11.5, 0.5, 26, 24, 0xd8413a, 8),
    cyl(12, 12, 6, -2, 0xe8d24a, 8),
    box(18, 0.8, 30, -34, 0, 0, 0xd8413a),
    box(18, 30, 0.8, -34, 0, 0, 0xd8413a),
  ]);
  return { arrow, spear, hook, rocket };
}
function meshFor(fx, name) {
  const THREE = fx.THREE;
  if (!GEO) GEO = buildGeos(THREE);
  if (!fx._projMeshMat) fx._projMeshMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x222222 });
  const m = new THREE.Mesh(GEO[name], fx._projMeshMat);
  m.renderOrder = 5;
  return m;
}

// ———————————————————— 样式表 ————————————————————
// core/halo：辉光核心与外晕直径；streak：[长, 宽] 沿速度方向拉伸；emit：沿途粒子；ribbon：拖尾；impact：命中样式
export const PROJECTILE_STYLES = {
  orb: { core: 64, halo: 170, haloA: 0.5, flare: 110, ribbon: { w: 48, life: 0.17 }, emit: { rate: 45, shape: 'soft', size: 24, life: 0.35, speed: 40, gravity: -60 }, impact: 'magic' },
  basic: { core: 40, halo: 96, haloA: 0.45, streak: [70, 16], ribbon: { w: 20, life: 0.1, lowSkip: true }, impact: 'small' },
  bolt: { core: 56, halo: 130, haloA: 0.45, streak: [200, 40], ribbon: { w: 36, life: 0.13 }, emit: { rate: 36, shape: 'spark', size: 16, life: 0.25, speed: 140 }, impact: 'magic' },
  bullet: { core: 26, halo: 64, haloA: 0.55, streak: [130, 13], impact: 'spark', hot: true },
  arrow: { mesh: 'arrow', core: 22, halo: 54, haloA: 0.35, streak: [90, 9], ribbon: { w: 12, life: 0.12, white: true }, impact: 'phys' },
  spear: { mesh: 'spear', core: 30, halo: 80, haloA: 0.35, ribbon: { w: 22, life: 0.18 }, emit: { rate: 18, shape: 'spark', size: 14, life: 0.3, speed: 80 }, impact: 'phys' },
  hook: { mesh: 'hook', core: 30, halo: 90, haloA: 0.4, chain: true, impact: 'phys' },
  chain: { core: 46, halo: 120, haloA: 0.5, chain: true, ribbon: { w: 26, life: 0.12 }, impact: 'magic' },
  rocket: { mesh: 'rocket', core: 34, halo: 90, haloA: 0.6, backGlow: true, ribbon: { w: 30, life: 0.16 }, smoke: 38, emit: { rate: 40, shape: 'spark', size: 18, life: 0.25, speed: 120, back: true }, impact: 'explosion', hot: true },
  fireball: { core: 70, halo: 200, haloA: 0.6, ribbon: { w: 64, life: 0.2 }, emit: { rate: 80, shape: 'soft', size: 46, life: 0.42, speed: 70, gravity: -220, color2: 0xff2a00 }, smoke: 10, impact: 'fire', hot: true },
  turretShot: { core: 104, halo: 250, haloA: 0.55, flare: 190, electric: true, ribbon: { w: 70, life: 0.2 }, emit: { rate: 50, shape: 'spark', size: 22, life: 0.3, speed: 160 }, impact: 'big' },
  casterMinion: { core: 44, halo: 104, haloA: 0.45, ribbon: { w: 24, life: 0.12, lowSkip: true }, emit: { rate: 14, shape: 'soft', size: 14, life: 0.25, speed: 30 }, impact: 'small' },
  siegeBall: { dark: 60, core: 30, halo: 110, haloA: 0.5, arc: 200, smoke: 28, impact: 'explosionSmall' },
  ice: { core: 60, halo: 150, haloA: 0.45, shard: 84, ribbon: { w: 40, life: 0.22 }, emit: { rate: 36, shape: 'flake', size: 22, life: 0.6, speed: 60, gravity: 140 }, impact: 'frost' },
  light: { core: 70, halo: 190, haloA: 0.55, flare: 170, ribbon: { w: 52, life: 0.22 }, emit: { rate: 44, shape: 'star', size: 20, life: 0.5, speed: 60, gravity: -30 }, impact: 'light' },
};
export const BUILTIN_PROJECTILES = Object.keys(PROJECTILE_STYLES);

// ———————————————————— 投射物视觉 ————————————————————
export function spawnBuiltinProjectile(fx, proj, kind) {
  const THREE = fx.THREE, st = PROJECTILE_STYLES[kind] || PROJECTILE_STYLES.orb;
  const vfx = proj.vfx || {};
  const size = clamp(Number(vfx.size) || 1, 0.2, 5);
  const color = new THREE.Color(vfx.color ?? 0xffffff);
  const white = color.clone().lerp(fx.WHITE, st.hot ? 0.75 : 0.6);
  const low = fx.low, qs = fx.qScale;
  const cam = fx.renderer.camera.position;
  const quads = [];
  const quad = (tile, additive = true) => { const q = fx._quad(tile, additive); quads.push(q); return q; };

  const core = st.core ? quad('glow') : null;
  if (core) { core.w = core.h = st.core * size; fx.setQ(core, white, 1); }
  const halo = st.halo ? quad('glow') : null;
  if (halo) { halo.w = halo.h = st.halo * size; fx.setQ(halo, color, st.haloA ?? 0.45); }
  const streak = st.streak ? quad('streak') : null;
  if (streak) { streak.w = st.streak[0] * size; streak.h = st.streak[1] * size; fx.setQ(streak, white, 0.9); }
  const flare = st.flare && !low ? quad('star') : null;
  if (flare) { flare.w = flare.h = st.flare * size; fx.setQ(flare, color, 0.55); }
  const shard = st.shard ? quad('shard') : null;
  if (shard) { shard.w = shard.h = st.shard * size; fx.setQ(shard, white, 1); }
  const dark = st.dark ? quad('soft', false) : null;
  if (dark) { dark.w = dark.h = st.dark * size; dark.r = 0.05; dark.g = 0.045; dark.b = 0.06; dark.a = 0.95; }
  const back = st.backGlow ? quad('glow') : null;
  if (back) { back.w = back.h = 70 * size; fx.setQ(back, fx._c(0xffa040), 0.9); }
  const elec = st.electric && !low ? [quad('bolt'), quad('bolt')] : null;
  if (elec) for (const q of elec) { q.w = q.h = 120 * size; fx.setQ(q, white, 0.7); }

  const mesh = st.mesh ? meshFor(fx, st.mesh) : null;
  if (mesh) { mesh.scale.setScalar(size); fx.root.add(mesh); }

  let ribbon = null;
  if (st.ribbon && vfx.trail !== false && !(low && st.ribbon.lowSkip)) {
    ribbon = fx._ribbon();
    ribbon.reset(st.ribbon.white ? fx.WHITE : color, white, st.ribbon.w * size, st.ribbon.life, st.ribbon.white ? 0.55 : 0.9);
  }
  let chain = null;
  if (st.chain) {
    chain = fx._beam(BEAM.CHAIN);
    chain.u.uColor.value.set(0x8e98a4).lerp(color, 0.25);
    chain.u.uCore.value.set(0xe6ecf2);
    chain.u.uOpacity.value = 1;
  }

  // 追踪：记录初始距离，用于高度插值（从出手高度过渡到目标胸口）
  const tgt = proj.target;
  const h0 = Number.isFinite(proj.h) ? proj.h : 100;
  let d0 = 0, tH = h0;
  if (tgt && proj.homing !== false) {
    d0 = Math.hypot(tgt.x - proj.x, tgt.y - proj.y) || 1;
    tH = clamp(fx.unitHeight(tgt) * 0.5, 50, 260);
  }
  const arc = Number(vfx.arc) || st.arc || 0;
  let lx = NaN, ly = NaN, lz = NaN, dirX = proj.dirX || 1, dirY = proj.dirY || 0;
  let emitAcc = 0, smokeAcc = 0, dying = false, spin = Math.random() * 6.28, elecT = 0;
  const team = proj.team ?? proj.owner?.team;
  const spd = Math.max(300, Number(proj.speed) || 1500);

  const pos = { x: 0, y: 0, h: 0, g: 0 };
  const compute = () => {
    const a = clamp01(Number.isFinite(fx.game.alpha) ? fx.game.alpha : 1);
    const px = Number.isFinite(proj.prevX) ? proj.prevX : proj.x, py = Number.isFinite(proj.prevY) ? proj.prevY : proj.y;
    const x = px + (proj.x - px) * a, y = py + (proj.y - py) * a;
    let h = Number.isFinite(proj.h) ? proj.h : h0;
    let k = 0;
    if (tgt && d0 > 0 && !proj.returning) {
      const tp = fx.renderer.renderPos(tgt);
      k = clamp01(1 - Math.hypot(tp.x - x, tp.y - y) / d0);
      h = h0 + (tH + (tp.z || 0) - h0) * k;
    } else if (Number.isFinite(proj.range) && proj.range > 0 && proj.range < 1e6) k = clamp01((proj.traveled || 0) / proj.range);
    if (arc > 0) h += arc * 4 * k * (1 - k) * size;
    pos.g = fx.heightAt(x, y);
    pos.x = x; pos.y = y; pos.h = pos.g + h;
  };

  const tick = (dt) => {
    const now = fx.time;
    if (!proj.dead) {
      compute();
      const sx = pos.x, sy = pos.h, sz = -pos.y;
      if (Number.isFinite(lx)) {
        const mx = sx - lx, mz = sz - lz;
        const ml = Math.hypot(mx, mz);
        if (ml > 0.5) { dirX = mx / ml; dirY = -mz / ml; }
      }
      const vis = team === fx.renderer.playerTeam || fx.seen(pos.x, pos.y);
      const flick = 1 + Math.sin(now * 38 + spin) * 0.07;
      for (const q of quads) { q.x = sx; q.y = sy; q.z = sz; q.visible = vis; }
      if (core) core.w = core.h = st.core * size * flick;
      if (halo) halo.w = halo.h = st.halo * size * (2 - flick);
      if (streak) { streak.ax = dirX; streak.ay = 0; streak.az = -dirY; streak.x = sx - dirX * streak.w * 0.3; streak.z = sz + dirY * streak.w * 0.3; }
      if (flare) flare.rot = now * 2.4 + spin;
      if (shard) { shard.rot = now * 7 + spin; }
      if (back) { back.x = sx - dirX * 50 * size; back.z = sz + dirY * 50 * size; back.w = back.h = (60 + Math.random() * 30) * size; }
      if (elec && (elecT -= dt) <= 0) {
        elecT = 0.05;
        for (const q of elec) { q.rot = Math.random() * 6.28; q.w = q.h = (90 + Math.random() * 70) * size; q.a = 0.4 + Math.random() * 0.5; }
      }
      if (mesh) {
        mesh.visible = vis;
        mesh.position.set(sx, sy, sz);
        mesh.rotation.y = Math.atan2(dirY, dirX);
        if (st.mesh === 'rocket') mesh.rotation.x = now * 8;
      }
      if (ribbon) { ribbon.push(sx, sy, sz, now); ribbon.hidden = !vis; }
      // 沿途粒子：按路径插值发射，避免高速时断续
      if (vis && st.emit && Number.isFinite(lx)) {
        emitAcc += dt * st.emit.rate * qs;
        const e = st.emit;
        while (emitAcc >= 1) {
          emitAcc -= 1;
          const f = Math.random();
          const ex = lx + (sx - lx) * f, ey = ly + (sy - ly) * f, ez = lz + (sz - lz) * f;
          fx._emitScene(ex - (e.back ? dirX * 40 * size : 0), ey, ez + (e.back ? dirY * 40 * size : 0), pos.g, e.shape, color, e.color2 != null ? fx._c(e.color2) : null,
            e.size * size, e.speed, e.life, e.gravity || 0, 2.5, e.back ? -dirX : 0, e.back ? -dirY : 0);
        }
      }
      if (vis && st.smoke && Number.isFinite(lx)) {
        smokeAcc += dt * st.smoke * qs;
        while (smokeAcc >= 1) {
          smokeAcc -= 1;
          fx._emitScene(sx - dirX * 30, sy, sz + dirY * 30, pos.g, 'smoke', fx._c(st.hot ? 0x4a4038 : 0x6a6660), null, 46 * size, 40, 0.7, -90, 1.5, 0, 0, 0.45);
        }
      }
      if (chain) {
        const o = proj.owner;
        let ax = sx, ay = sy, az = sz;
        if (o && o.alive !== false) {
          const op = fx.renderer.renderPos(o);
          ax = op.x; az = -op.y; ay = fx.heightAt(op.x, op.y) + (op.z || 0) + fx.unitHeight(o) * 0.5;
        }
        const len = writeStrip(chain.geo, ax, ay, az, sx, sy, sz, 24 * size, cam);
        chain.u.uLen.value = Math.max(1, len);
        chain.mesh.visible = vis && len > 10;
      }
      lx = sx; ly = sy; lz = sz;
    } else if (!dying) {
      dying = true;
      for (const q of quads) q.visible = false;
      if (mesh) mesh.visible = false;
      if (chain) chain.mesh.visible = false;
      const r = proj.endReason;
      if (Number.isFinite(lx) && (r === 'hit' || (proj.hitCount > 0 && r !== 'returned' && r !== 'lost'))) {
        const ix = r === 'hit' ? proj.x : pos.x, iy = r === 'hit' ? proj.y : pos.y;
        fx.impact({ x: ix, y: iy, h: Math.max(20, lz === lz ? ly - fx.heightAt(ix, iy) : 80), color: color.getHex(), size: size * (st.impactScale || 1), style: st.impact });
      }
    }
    let alive = !dying;
    if (ribbon) { alive = ribbon.update(now, cam) || alive; if (ribbon.hidden) ribbon.mesh.visible = false; }
    // 超时保护
    if (proj.age > (proj.maxAge || 12) + 2) return false;
    return alive;
  };
  const cleanup = () => {
    for (const q of quads) fx._freeQuad(q);
    if (mesh) mesh.parent?.remove(mesh);
    if (ribbon) fx._freeRibbon(ribbon);
    if (chain) fx._freeBeam(chain);
  };
  const e = fx._spawn(Infinity, tick, cleanup);
  e.object3d = mesh;
  e.kind = kind;
  return e;
}
