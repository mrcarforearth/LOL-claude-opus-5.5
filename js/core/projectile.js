// 投射物：追踪型（普攻/指向技能，必中）与直线型（技能弹道，扫掠碰撞防穿透）
import { clamp, pointSegT } from './math.js';
import { MAP_SIZE } from '../config.js';

const DEFAULT_HIT_TYPES = new Set(['champion', 'minion', 'monster', 'pet']);

export class Projectile {
  constructor(game, opts) {
    const owner = opts.owner || null;
    this.id = (game._nextProjId = (game._nextProjId || 0) + 1);
    this.game = game;
    this.owner = owner;
    this.team = opts.team ?? (owner ? owner.team : 2);
    this.x = opts.x ?? (owner ? owner.x : 0);
    this.y = opts.y ?? (owner ? owner.y : 0);
    this.prevX = this.x;
    this.prevY = this.y;
    this.startX = this.x;
    this.startY = this.y;
    this.h = opts.height ?? 100;
    this.target = opts.target || null;
    this.speed = opts.speed ?? 1500;
    this.width = opts.width ?? 60;
    this.hits = opts.hits || 'first';
    this.canHitFn = opts.canHit || null;
    this.collideWalls = !!opts.collideWalls;
    this.returnToOwner = !!opts.returnToOwner;
    this.onHit = opts.onHit || null;
    this.onEnd = opts.onEnd || null;
    this.onUpdate = opts.onUpdate || null;
    this.isBasicAttack = !!opts.isBasicAttack;
    this.vfx = opts.vfx || { kind: 'orb', color: 0xffffff, size: 1, trail: true };
    this.data = opts.data || {};
    this.age = 0;
    this.traveled = 0;
    this.dead = false;
    this.returning = false;
    this.hitSet = new Set();
    this.hitCount = 0;
    this.maxAge = opts.maxAge ?? 12;
    this.homing = !!this.target;
    // 直线：方向 + 射程，或终点
    if (!this.homing) {
      let dx = opts.dirX, dy = opts.dirY;
      let range = opts.range;
      if (opts.toX != null && opts.toY != null) {
        const tx = opts.toX - this.x, ty = opts.toY - this.y;
        const l = Math.hypot(tx, ty);
        if (dx == null || dy == null) { dx = l > 1e-6 ? tx / l : Math.cos(owner ? owner.facing : 0); dy = l > 1e-6 ? ty / l : Math.sin(owner ? owner.facing : 0); }
        if (range == null) range = l;
      }
      if (dx == null || dy == null) { dx = Math.cos(owner ? owner.facing : 0); dy = Math.sin(owner ? owner.facing : 0); }
      const l = Math.hypot(dx, dy) || 1;
      this.dirX = dx / l;
      this.dirY = dy / l;
      this.range = range ?? 1000;
    } else {
      const t = this.target;
      const l = Math.hypot(t.x - this.x, t.y - this.y) || 1;
      this.dirX = (t.x - this.x) / l;
      this.dirY = (t.y - this.y) / l;
      this.range = Infinity;
    }
  }

  get facing() { return Math.atan2(this.dirY, this.dirX); }

  canHit(u) {
    if (this.canHitFn) return this.canHitFn(u, this);
    if (!u.alive || u.removed || u.untargetable || u.invulnerable) return false;
    if (!DEFAULT_HIT_TYPES.has(u.type)) return false;
    return u.team !== this.team;
  }

  kill(reason = 'end') {
    if (this.dead) return;
    this.dead = true;
    this.endReason = reason;
    if (this.onEnd) this.onEnd(this);
  }

  update(dt) {
    if (this.dead) return;
    this.age += dt;
    if (this.age > this.maxAge) { this.kill('timeout'); return; }
    this.prevX = this.x;
    this.prevY = this.y;
    if (this.homing || this.returning) this._updateHoming(dt);
    else this._updateLinear(dt);
    if (!this.dead && this.onUpdate) this.onUpdate(this, dt);
  }

  _updateHoming(dt) {
    const t = this.returning ? this.owner : this.target;
    if (!t || !t.alive || t.removed || (!this.returning && t.untargetable)) {
      this.dead = true; this.endReason = 'lost';
      if (this.returning && this.onEnd) this.onEnd(this);
      return;
    }
    const dx = t.x - this.x, dy = t.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.speed * dt;
    const reach = this.returning ? (t.radius || 0) * 0.5 : 0;
    if (d > 1e-6) { this.dirX = dx / d; this.dirY = dy / d; }
    if (this.returning) this._sweepHits(this.x, this.y, this.x + this.dirX * Math.min(step, d), this.y + this.dirY * Math.min(step, d));
    if (this.dead) return;
    if (d - reach <= step) {
      this.x = t.x; this.y = t.y;
      this.traveled += d;
      if (this.returning) { this.kill('returned'); return; }
      this.dead = true;
      this.endReason = 'hit';
      if (this.onHit) this.onHit(t, this);
      if (this.onEnd) this.onEnd(this);
      return;
    }
    this.x += this.dirX * step;
    this.y += this.dirY * step;
    this.traveled += step;
  }

  _updateLinear(dt) {
    const game = this.game;
    let step = this.speed * dt;
    const left = this.range - this.traveled;
    let atEnd = false;
    if (step >= left) { step = Math.max(0, left); atEnd = true; }
    let nx = this.x + this.dirX * step, ny = this.y + this.dirY * step;
    if (this.collideWalls && !game.nav.isWalkable(nx, ny)) {
      const p = game.nav.raycastWalk(this.x, this.y, nx, ny);
      nx = p.x; ny = p.y;
      atEnd = true;
      this.hitWall = true;
    }
    nx = clamp(nx, 0, MAP_SIZE); ny = clamp(ny, 0, MAP_SIZE);
    const x0 = this.x, y0 = this.y;
    this.x = nx; this.y = ny;
    this.traveled += Math.hypot(nx - x0, ny - y0);
    if (this.hits !== 'none') this._sweepHits(x0, y0, nx, ny);
    if (this.dead) return;
    if (atEnd || this.traveled >= this.range - 1e-6) {
      if (this.returnToOwner && this.owner && this.owner.alive && !this.returning) {
        this.returning = true;
        this.hitSet = new Set(); // 回程命中集合重置
        return;
      }
      this.kill('range');
    }
  }

  // 本帧线段扫掠：按沿线段先后顺序依次命中
  _sweepHits(x0, y0, x1, y1) {
    const game = this.game;
    const cands = game.queryLine({ x1: x0, y1: y0, x2: x1, y2: y1, width: this.width, sort: false, types: this.canHitFn ? 'all' : undefined });
    if (cands.length === 0) return;
    if (cands.length > 1) {
      for (const u of cands) u._projT = pointSegT(u.x, u.y, x0, y0, x1, y1);
      cands.sort((a, b) => a._projT - b._projT);
    }
    for (const u of cands) {
      if (this.hitSet.has(u)) continue;
      if (!this.canHit(u)) continue;
      this.hitSet.add(u);
      this.hitCount++;
      let stop = false;
      if (this.onHit) stop = this.onHit(u, this) === true;
      if (this.hits === 'first' || stop) {
        // 停在命中点
        this.x = u.x; this.y = u.y;
        this.kill('hit');
        return;
      }
      if (this.dead) return;
    }
  }
}
