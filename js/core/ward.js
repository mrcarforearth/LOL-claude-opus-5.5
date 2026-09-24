// 守卫：隐形守卫（3 次普攻、限时、隐形）与控制守卫（4 次普攻、永久、揭示隐形守卫）
import { Unit } from './unit.js';
import { RANGES, WARD_LIMITS, TRINKET } from '../config.js';
import { byLevel } from './math.js';

export class Ward extends Unit {
  constructor(game, owner, x, y, kind = 'stealth', { duration } = {}) {
    const isControl = kind === 'control';
    const hp = isControl ? 4 : 3;
    super(game, {
      type: 'ward', team: owner.team, x, y, name: isControl ? '控制守卫' : '隐形守卫', modelId: isControl ? 'controlWard' : 'stealthWard',
      baseStats: { hp, ms: 0, ad: 0, armor: 0, mr: 0, range: 0, radius: 30, resource: 'none' }, radius: 30,
    });
    this.owner = owner;
    this.kind = kind;
    this.sightRange = RANGES.SIGHT_WARD;
    this.stealthed = !isControl;
    this.trueSight = isControl;
    this.trueSightRange = 900;
    const dur = duration ?? (isControl ? Infinity : byLevel(owner.level || 1, TRINKET.DURATION_L1, TRINKET.DURATION_L18));
    this.duration = dur;
    this.expiresAt = game.time + dur;
    this.placedAt = game.time;
    this.goldValue = isControl ? 30 : 30;
    this.xpValue = isControl ? 30 : 15;
  }

  get remaining() { return Math.max(0, this.expiresAt - this.game.time); }

  update(dt) {
    if (!this.alive) return;
    if (this.game.time >= this.expiresAt) {
      this.expired = true;
      this.alive = false;
      this.game.remove(this);
      return;
    }
    // 守卫不移动、不回复，仅维护动画
    this._updateAnim(dt, false);
  }
}

// 放置守卫并维护每名玩家的数量上限（超出移除最旧）
export function placeWard(game, owner, x, y, kind = 'stealth', opts = {}) {
  const nav = game.nav;
  if (!nav.isWalkable(x, y)) { const p = nav.nearestWalkable(x, y, 400); x = p.x; y = p.y; }
  const ward = new Ward(game, owner, x, y, kind, opts);
  const limit = WARD_LIMITS[kind] ?? 3;
  const mine = game.wards.filter((w) => w.alive && !w.removed && w.owner === owner && w.kind === kind).sort((a, b) => a.placedAt - b.placedAt);
  while (mine.length >= limit) {
    const old = mine.shift();
    old.alive = false;
    game.remove(old);
  }
  game.add(ward);
  if (owner) owner.wardsPlaced = (owner.wardsPlaced || 0) + 1;
  return ward;
}
