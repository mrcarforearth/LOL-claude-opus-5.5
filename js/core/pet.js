// 宠物/召唤物（如提伯斯）：默认 AI 攻击主人目标或附近敌人，否则跟随主人；击杀归属主人
import { Unit } from './unit.js';
import { RANGES } from '../config.js';

const PET_TARGET_TYPES = ['champion', 'minion', 'monster', 'pet'];

export class Pet extends Unit {
  constructor(game, { owner, x, y, modelId = 'pet', name, duration = Infinity, baseStats, level, radius = 80, think = null, team } = {}) {
    super(game, {
      type: 'pet', team: team ?? owner.team, x: x ?? owner.x, y: y ?? owner.y, name: name || modelId, modelId,
      baseStats: { resource: 'none', ...(baseStats || {}) }, level: level ?? owner.level, radius,
    });
    this.owner = owner;
    this.duration = duration;
    this.expiresAt = game.time + duration;
    this.think = think;
    this.softCollision = true;
    this.sightRange = RANGES.SIGHT_PET;
    this.leashRange = 1200;         // 离主人过远时回到身边
    this.aggroRange = 700;
    this.followRange = 300;
    this.manualUntil = 0;           // 主人手动指挥期间不执行默认 AI
    this._nextThink = 0;
  }

  get remaining() { return Math.max(0, this.expiresAt - this.game.time); }

  // 主人手动指挥（如安妮 R 再次施放）
  orderAttack(target, hold = 3) { this.manualUntil = this.game.time + hold; return this.attackUnit(target); }
  orderMove(x, y, hold = 2) { this.manualUntil = this.game.time + hold; return this.moveTo(x, y); }

  expire() {
    if (!this.alive) return;
    this.expired = true;
    this.die(null);
  }

  defaultThink() {
    const game = this.game;
    const owner = this.owner;
    if (!owner || !owner.alive) {
      // 主人阵亡：攻击最近敌人或原地
      const t = game.nearest({ x: this.x, y: this.y, radius: this.aggroRange, enemyOf: this, targetableBy: this, types: PET_TARGET_TYPES });
      if (t) this.attackUnit(t);
      return;
    }
    const d = this.distTo(owner);
    if (d > this.leashRange) { this.moveTo(owner.x, owner.y); return; }
    // 主人的普攻目标优先
    const ot = (owner.attackState && owner.attackState.target) || (owner.command && owner.command.target) || owner.attackTarget;
    if (ot && ot.alive && ot.team !== this.team && ot.isTargetableBy && ot.isTargetableBy(this) && this.distTo(ot) < this.aggroRange + 400 && !ot.isStructure) {
      this.attackUnit(ot);
      return;
    }
    const cur = this.command && this.command.type === 'attack' ? this.command.target : null;
    if (cur && cur.alive && this.distTo(cur) < this.aggroRange + 200) return;
    const t = game.nearest({ x: this.x, y: this.y, radius: this.aggroRange, enemyOf: this, targetableBy: this, types: PET_TARGET_TYPES });
    if (t) { this.attackUnit(t); return; }
    if (d > this.followRange) {
      const a = Math.atan2(this.y - owner.y, this.x - owner.x);
      this.moveTo(owner.x + Math.cos(a) * 150, owner.y + Math.sin(a) * 150);
    } else if (this.command && this.command.type === 'attack') {
      this.command = null;
    }
  }

  update(dt) {
    const game = this.game;
    if (this.alive && game.time >= this.expiresAt) { this.expire(); return; }
    if (this.alive && game.time >= this.manualUntil && game.time >= this._nextThink) {
      this._nextThink = game.time + 0.2;
      if (this.think) this.think(this, dt);
      else this.defaultThink();
    }
    super.update(dt);
  }
}
