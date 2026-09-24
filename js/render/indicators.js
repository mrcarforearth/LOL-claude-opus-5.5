// 技能指示器（fx）：施法射程圈 + 形状（直线/圆形/扇形/自身范围），A 键普攻射程，右键点击标记，悬停高亮，玩家选择圈，防御塔射程警示
// 全部为贴地贴花（随地形高度），常驻网格复用，不用时隐藏；每帧只在位置/尺寸变化时重铺顶点
import { DECAL, makeDecalMaterial, makeGridGeometry, placeDecal } from './fx/materials.js';
import { makeTextures } from './fx/textures.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const alive = (u) => !!u && u.alive !== false && !u.removed;

const C = {
  cast: 0x62c8ff, castEdge: 0xd8f4ff, range: 0x9ad8ff, bad: 0xff6a5a,
  select: 0x49ff6a, aa: 0xe6f2ff, move: 0x49ff6a, attack: 0xff4436,
  turret: 0xffffff, turretHot: 0xff3322,
  hoverEnemy: 0xff4a3a, hoverAlly: 0x4aa8ff, hoverSelf: 0x6aff7a,
};

class Decal {
  constructor(THREE, noise, parent, n, additive = true) {
    this.mat = makeDecalMaterial(THREE, noise, { additive });
    this.mesh = new THREE.Mesh(makeGridGeometry(THREE, n), this.mat);
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.mesh.name = 'indicator';
    this.u = this.mat.uniforms;
    parent.add(this.mesh);
    this.key = '';
  }
  // 贴地：仅当参数变化时重铺
  place(heightAt, cx, cy, sx, sy, rot, ou = 0.5, flat = false, lift = 5) {
    const k = `${cx.toFixed(1)},${cy.toFixed(1)},${sx.toFixed(1)},${sy.toFixed(1)},${rot.toFixed(3)},${ou}`;
    if (k !== this.key) { placeDecal(this.mesh, heightAt, cx, cy, sx, sy, rot, lift, ou, 0.5, flat); this.key = k; }
    this.mesh.visible = true;
  }
  set(mode, color, color2, opacity, width, fill, extra) {
    const u = this.u;
    u.uMode.value = mode;
    u.uColor.value.setHex(color);
    u.uColor2.value.setHex(color2 ?? color);
    u.uOpacity.value = opacity;
    u.uWidth.value = width;
    u.uFill.value = fill;
    u.uArrow.value = extra?.arrow ?? 0;
    u.uAngle.value = extra?.angle ?? 0.5;
    u.uInner.value = extra?.inner ?? 0;
    u.uProgress.value = extra?.progress ?? 0;
  }
  hide() { this.mesh.visible = false; }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

export class Indicators {
  constructor(renderer, game, input) {
    this.renderer = renderer;
    this.game = game;
    this.input = input;
    const THREE = renderer.THREE;
    this.THREE = THREE;
    const noise = renderer.fx?.textures?.noise || makeTextures(THREE).noise;
    this.root = new THREE.Group();
    this.root.name = 'indicators';
    (renderer.groups?.fx || renderer.scene).add(this.root);
    const mk = (n, add = true) => new Decal(THREE, noise, this.root, n, add);
    this.sel = mk(5);
    this.range = mk(13);
    this.shape = mk(13);
    this.shape2 = mk(9);
    this.aa = mk(13);
    this.turret = mk(13);
    this.markers = [mk(5), mk(5), mk(5), mk(5)].map((d) => ({ d, age: 9, dur: 0.5, x: 0, y: 0, target: null, kind: 'move' }));
    this._mi = 0;
    this.hovered = null;
    this.time = 0;
    this._turretK = 0;
    this._hAt = (x, y) => renderer.heightAt(x, y);
    this._off = typeof input?.on === 'function' ? input.on('command', (c) => this._onCommand(c)) : null;
  }

  _onCommand(c) {
    if (!c || !Number.isFinite(c.x)) return;
    let kind;
    if (c.type === 'move') kind = 'move';
    else if (c.type === 'attack' || c.type === 'attackMove') kind = 'attack';
    else return;
    // 右键按住连续移动：刷新最近一个标记而不是新建
    const last = this.markers[(this._mi + this.markers.length - 1) % this.markers.length];
    if (last.age < 0.14 && last.kind === kind && !c.target && Math.hypot(last.x - c.x, last.y - c.y) < 60) {
      last.x = c.x; last.y = c.y;
      return;
    }
    const m = this.markers[this._mi];
    this._mi = (this._mi + 1) % this.markers.length;
    m.age = 0;
    m.dur = kind === 'move' ? 0.5 : 0.55;
    m.x = c.x; m.y = c.y;
    m.target = c.target && c.type === 'attack' ? c.target : null;
    m.kind = kind;
  }

  update(dt) {
    const d = Math.min(0.1, Number.isFinite(dt) ? dt : 0);
    this.time += d;
    const game = this.game, r = this.renderer, input = this.input, p = game.player;
    const hAt = this._hAt;
    this._updateHover(p);
    this._updateMarkers(d);
    if (!p || !alive(p)) {
      this.sel.hide(); this.range.hide(); this.shape.hide(); this.shape2.hide(); this.aa.hide(); this.turret.hide();
      return;
    }
    const pos = r.renderPos(p);
    const px = pos.x, py = pos.y;
    const shown = r.isShown(p);
    // 玩家脚下选择圈（淡绿）
    if (shown) {
      const R = (p.radius || 65) + 28;
      this.sel.set(DECAL.RING, C.select, 0xc8ffd0, 0.5, clamp(6 / R, 0.02, 0.3), 0.07);
      this.sel.u.uTime.value = this.time;
      this.sel.place(hAt, px, py, R * 2, R * 2, 0, 0.5, true);
    } else this.sel.hide();

    const pc = input?.enabled !== false ? input?.pendingCast : null;
    if (pc) this._cast(pc, p, px, py);
    else { this.range.hide(); this.shape.hide(); this.shape2.hide(); }

    // A 键：普攻射程
    if (input?.attackMoveArmed && !pc) {
      const R = (p.stats?.attackRange || p.attackRange || 125) + (p.radius || 65);
      this.aa.set(DECAL.RING, C.aa, 0xffffff, 0.75, clamp(6 / R, 0.003, 0.2), 0.05);
      this.aa.place(hAt, px, py, R * 2, R * 2, 0);
    } else this.aa.hide();

    this._turretRange(p, px, py, d);
  }

  _cast(pc, p, px, py) {
    const hAt = this._hAt, input = this.input;
    const ind = pc.indicator || {};
    const type = ind.type || (pc.targeting === 'direction' ? 'line' : pc.targeting === 'point' ? 'circle' : pc.targeting === 'unit' ? 'unit' : 'self');
    const range = Number(pc.range) || 0;
    const mx = Number.isFinite(input.mouse?.gx) ? input.mouse.gx : px + 1, my = Number.isFinite(input.mouse?.gy) ? input.mouse.gy : py;
    let dx = mx - px, dy = my - py;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) { dx = Math.cos(p.facing || 0); dy = Math.sin(p.facing || 0); } else { dx /= dist; dy /= dist; }
    const rot = Math.atan2(dy, dx);
    const pulse = 0.9 + 0.1 * Math.sin(this.time * 6);

    // 射程细圈
    if (range > 0 && range < 6000 && type !== 'self') {
      const R = range + (pc.targeting === 'unit' ? p.radius || 0 : 0);
      this.range.set(DECAL.RING, C.range, 0xeaf8ff, 0.55, clamp(4 / R, 0.002, 0.2), 0.03);
      this.range.u.uTime.value = this.time;
      this.range.place(hAt, px, py, R * 2, R * 2, 0);
    } else this.range.hide();
    this.shape2.hide();

    if (type === 'line') {
      const len = Number(ind.length) || range || 800, w = Number(ind.width) || 120, back = Number(ind.back) || 0;
      const total = len + back;
      const sx = px - dx * back, sy = py - dy * back;
      this.shape.set(DECAL.RECT, C.cast, C.castEdge, 0.85 * pulse, clamp(7 / (w / 2), 0.04, 0.4), 0.32, { arrow: clamp((w * 0.8) / total, 0.04, 0.3) });
      this.shape.place(hAt, sx, sy, total, w, rot, 0);
    } else if (type === 'circle') {
      const R = Number(ind.radius) || 150;
      let cx = mx, cy = my;
      const out = range > 0 && dist > range;
      if (out) { cx = px + dx * range; cy = py + dy * range; }
      this.shape.set(DECAL.RING, C.cast, C.castEdge, (out ? 0.7 : 0.9) * pulse, clamp(7 / R, 0.01, 0.3), 0.3);
      this.shape.place(hAt, cx, cy, R * 2, R * 2, 0, 0.5, R <= 120);
      // 截断时在鼠标处放一个小十字圈，提示超出射程
      if (out) {
        this.shape2.set(DECAL.RING, C.bad, 0xffd0c8, 0.55, 0.14, 0.0);
        this.shape2.place(hAt, mx, my, 70, 70, 0, 0.5, true);
      }
    } else if (type === 'cone') {
      const L = Number(ind.length) || range || 500;
      let a = Number(ind.angle) || 60;
      a = a > 6.3 ? (a * Math.PI) / 180 : a;
      this.shape.set(DECAL.CONE, C.cast, C.castEdge, 0.85 * pulse, clamp(7 / L, 0.004, 0.1), 0.32, { angle: clamp(a / 2, 0.02, Math.PI) });
      this.shape.place(hAt, px, py, L * 2, L * 2, rot);
    } else if (type === 'self') {
      const R = Number(ind.radius) || range || 300, inner = Number(ind.inner) || 0;
      this.shape.set(DECAL.RING, C.cast, C.castEdge, 0.85 * pulse, clamp(7 / R, 0.005, 0.3), 0.26, { inner: inner > 0 ? clamp(inner / R, 0, 0.98) : 0 });
      this.shape.place(hAt, px, py, R * 2, R * 2, 0);
      if (inner > 0) {
        this.shape2.set(DECAL.RING, C.cast, C.castEdge, 0.7, clamp(5 / inner, 0.005, 0.3), 0);
        this.shape2.place(hAt, px, py, inner * 2, inner * 2, 0);
      }
    } else {
      // 指向单位：在悬停的合法目标脚下放一个圈
      const h = this.input.hoverUnit;
      if (h && alive(h) && this.renderer.isShown(h)) {
        const hp = this.renderer.renderPos(h), R = (h.radius || 60) + 30;
        const inRange = range <= 0 || Math.hypot(hp.x - px, hp.y - py) <= range + (p.radius || 0) + (h.radius || 0);
        this.shape.set(DECAL.RING, inRange ? C.cast : C.bad, C.castEdge, 0.9 * pulse, clamp(8 / R, 0.02, 0.3), 0.2);
        this.shape.place(hAt, hp.x, hp.y, R * 2, R * 2, 0, 0.5, true);
      } else this.shape.hide();
    }
    this.shape.u.uTime.value = this.time;
  }

  // 靠近敌方防御塔：显示其射程；瞄准玩家时变红
  _turretRange(p, px, py, d) {
    let best = null, bd = Infinity;
    for (const t of this.game.structures) {
      if (!t.alive || t.type !== 'turret' || t.team === p.team || t.kind === 'fountainTurret') continue;
      const R = (t.stats?.attackRange || 750) + (t.radius || 90) + (p.radius || 65);
      const dd = Math.hypot(t.x - px, t.y - py) - R;
      if (dd < bd) { bd = dd; best = t; best._rr = R; }
    }
    const near = best && bd < 320;
    this._turretK = clamp01(this._turretK + (near ? d * 4 : -d * 4));
    if (!best || this._turretK <= 0.01) { this.turret.hide(); return; }
    const hot = best.attackTarget === p;
    const R = best._rr;
    const k = this._turretK * (hot ? 1 : clamp01(1 - bd / 320) * 0.6 + 0.2);
    this.turret.set(DECAL.RING, hot ? C.turretHot : C.turret, hot ? 0xffb0a0 : 0xffffff, (hot ? 0.95 : 0.4) * k, clamp(8 / R, 0.003, 0.2), hot ? 0.06 : 0.02);
    this.turret.u.uTime.value = this.time;
    this.turret.place(this._hAt, best.x, best.y, R * 2, R * 2, 0);
  }

  _updateMarkers(d) {
    const r = this.renderer;
    for (const m of this.markers) {
      if (m.age >= m.dur) { m.d.hide(); continue; }
      m.age += d;
      const t = clamp01(m.age / m.dur);
      let x = m.x, y = m.y;
      if (m.target) {
        if (!alive(m.target)) { m.d.hide(); m.age = m.dur; continue; }
        const tp = r.renderPos(m.target); x = tp.x; y = tp.y;
      }
      const R = m.kind === 'move' ? 62 : (m.target?.radius || 50) + 40;
      m.d.set(DECAL.MARKER, m.kind === 'move' ? C.move : C.attack, 0xffffff, 1.4, 0.1, 0, { progress: t, angle: m.kind === 'move' ? 0 : Math.PI / 4 });
      m.d.place(this._hAt, x, y, R * 2, R * 2, 0, 0.5, true);
    }
  }

  _updateHover(p) {
    const r = this.renderer;
    let h = this.input?.hoverUnit || null;
    if (h && (!alive(h) || !r.isShown(h))) h = null;
    if (h !== this.hovered) {
      if (this.hovered) r.setHighlight(this.hovered, null);
      this.hovered = h;
    }
    if (h) {
      const col = h === p ? C.hoverSelf : h.team === r.playerTeam ? C.hoverAlly : C.hoverEnemy;
      r.setHighlight(h, col);
    }
  }

  dispose() {
    this._off?.();
    if (this.hovered) this.renderer.setHighlight(this.hovered, null);
    for (const d of [this.sel, this.range, this.shape, this.shape2, this.aa, this.turret, ...this.markers.map((m) => m.d)]) d.dispose();
    this.root.parent?.remove(this.root);
  }
}

export default Indicators;
