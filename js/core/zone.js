// 区域效果：延迟生效、跟随单位、周期结算、进出回调
// 生命周期：age < delay 为预警期；之后 onStart → 立即结算一次 → 每 tickInterval 结算 → 生效 duration 秒后 onEnd
// （duration = 0 表示只在生效瞬间结算一次；duration = Infinity 表示直到 remove()）
const DEFAULT_TYPES = ['champion', 'minion', 'monster', 'pet'];

export class Zone {
  constructor(game, opts) {
    const owner = opts.owner || null;
    this.id = (game._nextZoneId = (game._nextZoneId || 0) + 1);
    this.game = game;
    this.owner = owner;
    this.team = opts.team ?? (owner ? owner.team : 2);
    this.x = opts.x ?? (owner ? owner.x : 0);
    this.y = opts.y ?? (owner ? owner.y : 0);
    this.radius = opts.radius ?? 200;
    this.duration = opts.duration ?? 1;
    this.delay = opts.delay ?? 0;
    this.follow = opts.follow || null;
    this.tickInterval = opts.tickInterval ?? 0.25;
    this.filter = opts.filter ?? 'enemy';
    this.types = opts.types || DEFAULT_TYPES;
    this.onStart = opts.onStart || null;
    this.onTick = opts.onTick || null;
    this.onEnter = opts.onEnter || null;
    this.onExit = opts.onExit || null;
    this.onEnd = opts.onEnd || null;
    this.onUpdate = opts.onUpdate || null;
    this.vfx = opts.vfx ?? null;
    this.data = opts.data || {};
    this.age = 0;
    this.dead = false;
    this.started = false;
    this.nextTick = 0;
    this.inside = new Set();
  }

  get active() { return this.started && !this.dead; }
  get remaining() { return Math.max(0, this.delay + this.duration - this.age); }

  remove() {
    if (this.dead) return;
    this.dead = true;
    if (this.onExit) for (const u of this.inside) this.onExit(this, u);
    this.inside.clear();
    if (this.onEnd) this.onEnd(this);
  }

  // 当前区域内满足过滤条件的单位
  unitsInside() {
    const game = this.game;
    const q = { x: this.x, y: this.y, radius: this.radius, types: this.types, sort: false };
    const f = this.filter;
    if (f === 'enemy') q.enemyOf = this.team;
    else if (f === 'ally') q.allyOf = this.team;
    else if (typeof f === 'function') q.filter = (u) => f(u, this);
    const list = game.queryUnits(q);
    return list.filter((u) => !u.untargetable);
  }

  update(dt) {
    if (this.dead) return;
    this.age += dt;
    if (this.follow) {
      if (this.follow.alive && !this.follow.removed) { this.x = this.follow.x; this.y = this.follow.y; }
      else if (this.data.endWithFollow !== false && this.follow.type !== 'champion') { this.remove(); return; }
    }
    if (this.onUpdate) this.onUpdate(this, dt);
    if (this.dead) return;
    if (this.age < this.delay) return;
    if (!this.started) {
      this.started = true;
      if (this.onStart) this.onStart(this);
      if (this.dead) return;
      this._tick();
      this.nextTick = this.age + this.tickInterval;
    } else if (this.tickInterval > 0 && this.age >= this.nextTick - 1e-9) {
      this.nextTick += this.tickInterval;
      this._tick();
    } else if (this.tickInterval <= 0) {
      this._tick();
    }
    if (this.dead) return;
    if (this.age >= this.delay + this.duration - 1e-9) this.remove();
  }

  _tick() {
    const units = this.unitsInside();
    if (this.onEnter || this.onExit) {
      const now = new Set(units);
      if (this.onEnter) for (const u of units) if (!this.inside.has(u)) this.onEnter(this, u);
      if (this.onExit) for (const u of this.inside) if (!now.has(u)) this.onExit(this, u);
      this.inside = now;
    }
    if (this.onTick) this.onTick(this, units);
  }
}
