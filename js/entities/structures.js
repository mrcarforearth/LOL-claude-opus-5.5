// 建筑：防御塔（锁定目标/呼叫支援转火/连续命中升温/镀层/防御工事/后门保护）、召唤水晶（重生）、水晶枢纽、泉水激光；解锁规则与摧毁奖励
import { Unit } from '../core/unit.js';
import { creditChampion } from '../core/damage.js';
import { RANGES, TIMINGS, TEAM_NAMES } from '../config.js';

// 防御塔属性：攻击力从 1:30 起每分钟 +9，直到上限
export const TURRET_STATS = {
  outer: { hp: 5000, ad: 152, adMax: 278, armor: 40, mr: 40, title: '外塔' },
  inner: { hp: 3600, ad: 170, adMax: 305, armor: 55, mr: 55, title: '内塔' },
  inhib: { hp: 3300, ad: 170, adMax: 305, armor: 65, mr: 65, title: '高地塔' },
  nexus: { hp: 2700, ad: 150, adMax: 285, armor: 65, mr: 65, title: '枢纽塔' },
};
// 防御塔对小兵：按最大生命百分比造成真实伤害
export const TURRET_VS_MINION = { melee: 0.45, caster: 0.7, siege: 0.14, super: 0.07 };
export const TURRET_AS = 0.833;
export const TURRET_RADIUS = 88;
export const TURRET_MISSILE_SPEED = 1200;
export const HEAT_PER_SHOT = 0.4;          // 对同一英雄连续命中每次 +40%
export const HEAT_MAX = 1.2;               // 上限 +120%
export const PLATE_COUNT = 5;
export const PLATE_HP = 1000;
export const PLATE_GOLD = 160;
export const FORTIFY_END = 300;            // 防御工事：5 分钟前承受伤害 -50%
export const FORTIFY_REDUCTION = 0.5;
export const BACKDOOR_RANGE = 1000;        // 后门保护：附近无敌方小兵时承受伤害 -66%
export const BACKDOOR_REDUCTION = 0.66;
export const LOCAL_GOLD_RANGE = 1600;
export const INHIBITOR_HP = 4000;
export const NEXUS_HP = 5500;
export const FOUNTAIN_DAMAGE = 800;        // 泉水激光：每 0.25 秒真实伤害
export const FOUNTAIN_INTERVAL = 0.25;
// 摧毁奖励：local = 附近英雄平分，global = 全队每人
export const STRUCTURE_REWARDS = {
  outer: { local: 250, global: 50 },
  inner: { local: 225, global: 50 },
  inhib: { local: 225, global: 50 },
  nexus: { local: 0, global: 50 },
  inhibitor: { local: 0, global: 50 },
  firstTurret: 300,
};
const LANE_NAMES = { top: '上路', mid: '中路', bot: '下路' };
const TEAM_COLORS = [0x7ac8ff, 0xff6a8a];
const TURRET_TARGET_TYPES = new Set(['champion', 'minion', 'pet', 'monster']);

export function turretAdAt(tier, time) {
  const s = TURRET_STATS[tier] || TURRET_STATS.outer;
  return Math.min(s.adMax, s.ad + 9 * Math.max(0, Math.floor((time - 90) / 60)));
}

// 附近某队英雄平分金币；返回获得金币的英雄
function splitGold(game, team, x, y, amount, reason, extra = null) {
  if (!(amount > 0)) return [];
  const r2 = LOCAL_GOLD_RANGE * LOCAL_GOLD_RANGE;
  const champs = game.champions.filter((c) => c.team === team && c.alive && (c.x - x) ** 2 + (c.y - y) ** 2 <= r2);
  if (extra && extra.team === team && !champs.includes(extra)) champs.push(extra);
  if (champs.length === 0) return [];
  const each = amount / champs.length;
  for (const c of champs) c.gainGold(each, reason, x, y);
  return champs;
}
function globalGold(game, team, amount, reason, x, y) {
  if (!(amount > 0)) return;
  for (const c of game.champions) if (c.team === team) c.gainGold(amount, reason, x, y);
}

// 建筑击杀归属：英雄/宠物主人；否则 10 秒内最后一个造成伤害的敌方英雄
export function resolveStructureKiller(game, structure, killer) {
  const c = creditChampion(killer);
  if (c && c.team !== structure.team) return c;
  let best = null, bestT = -Infinity;
  const since = game.time - RANGES.ASSIST_WINDOW;
  for (const ch of game.champions) {
    if (ch.team === structure.team) continue;
    const t = structure.damageLog.get(ch.championId);
    if (t != null && t >= since && t > bestT) { best = ch; bestT = t; }
  }
  return best;
}

class Structure extends Unit {
  constructor(game, def, type, baseStats, radius, name) {
    super(game, {
      type, team: def.team, x: def.x, y: def.y, name, modelId: def.kind || type,
      baseStats: { resource: 'none', ms: 0, hpRegen: 0, ...baseStats }, radius,
    });
    this.structureId = def.id;
    this.kind = def.kind || type;
    this.lane = def.lane ?? null;
    this.tier = def.tier ?? null;
    this.blocksUnits = true;
    this.sightRange = RANGES.SIGHT_STRUCTURE;
    this.visible = [true, true];
    this.destroyedAt = null;
    this.target = null;
  }
  canMove() { return false; }
  // 后门保护：附近没有敌方小兵（或召唤出的峡谷先锋）时承受伤害降低
  _enemyWaveNear() {
    const g = this.game;
    return !!g.nearest({
      x: this.x, y: this.y, radius: BACKDOOR_RANGE, enemyOf: this, types: ['minion', 'monster'],
      filter: (u) => u.team !== 2 && (u.type === 'minion' || u.summoned),
    });
  }
  _installBackdoor() {
    this.hasBackdoor = true;
    this.addHook('beforeTakeDamage', (ctx) => {
      if (ctx.spell === 'herald_charge') return;
      if (!this._enemyWaveNear()) ctx.amount *= 1 - BACKDOOR_REDUCTION;
    });
  }
  // 被摧毁：不从游戏中移除（残骸）
  die(killer) {
    if (!this.alive) return;
    super.die(killer);
    if (this.alive) return;
    this.target = null;
    this.attackTarget = null;
    this.destroyedAt = this.game.time;
    this.onDestroyed(killer);
    updateStructureLocks(this.game);
  }
  onDestroyed() {}
}

export class Turret extends Structure {
  constructor(game, def) {
    const s = TURRET_STATS[def.tier] || TURRET_STATS.outer;
    super(game, def, 'turret', {
      hp: s.hp, ad: s.ad, armor: s.armor, mr: s.mr, as: TURRET_AS, asRatio: TURRET_AS,
      range: RANGES.TURRET - TURRET_RADIUS, windup: 0.15, missileSpeed: TURRET_MISSILE_SPEED,
      attackVfx: { kind: 'turretShot', color: TEAM_COLORS[def.team] ?? 0xffffff, size: 1.2 },
      missileHeight: 420,
    }, TURRET_RADIUS, '防御塔');
    this.title = `${LANE_NAMES[def.lane] || ''}${s.title}`;
    this.sightRange = RANGES.SIGHT_TURRET;
    this.plates = def.tier === 'outer' ? PLATE_COUNT : 0;
    this.heatTarget = null;
    this.heatStacks = 0;
    this.heat = 0;                   // 当前升温层数（渲染可读）
    this._nextScan = 0;
    this._cfhSince = game.time;
    if (def.tier !== 'outer') this._installBackdoor();
    // 攻击力随时间成长
    this.addHook('modifyStats', (st) => {
      const ad = turretAdAt(this.tier, this.game.time);
      st.ad = ad; st.baseAd = ad; st.bonusAd = 0;
    });
    // 防御工事：开局 5 分钟内承受伤害降低
    this.addHook('beforeTakeDamage', (ctx) => {
      if (ctx.spell === 'herald_charge') return;
      if (this.game.time < FORTIFY_END) ctx.amount *= 1 - FORTIFY_REDUCTION;
    });
    // 出手时结算升温（对同一英雄连续命中）
    this.addHook('onAttackLaunch', (target, hit) => {
      if (target.type === 'champion') {
        if (this.heatTarget !== target) { this.heatTarget = target; this.heatStacks = 0; }
        hit.turretMult = 1 + Math.min(HEAT_MAX, HEAT_PER_SHOT * this.heatStacks);
        this.heatStacks++;
      } else {
        this.heatTarget = null;
        this.heatStacks = 0;
      }
      this.heat = this.heatStacks;
    });
    // 命中：小兵按最大生命百分比真实伤害；英雄按升温倍率
    this.addHook('onHit', (target, hit) => {
      if (target.type === 'minion') {
        hit.damage = target.maxHp * (TURRET_VS_MINION[target.kind] ?? 0.45);
        hit.type = 'true';
      } else if (target.type === 'champion') {
        hit.damage *= hit.turretMult ?? 1;
      }
    });
    // 镀层：14 分钟前每损失 1000 生命掉落一层，160 金币分给附近敌方英雄
    this.addHook('afterTakeDamage', (ctx) => this._checkPlates(ctx));
  }

  _checkPlates(ctx) {
    const game = this.game;
    if (this.plates <= 0 || game.time >= TIMINGS.PLATING_END) return;
    const enemy = 1 - this.team;
    const credit = creditChampion(ctx.source);
    while (this.plates > 0 && this.hp > 0 && this.hp <= (this.plates - 1) * PLATE_HP) {
      this.plates--;
      const got = splitGold(game, enemy, this.x, this.y, PLATE_GOLD, 'plate', credit && credit.alive ? credit : null);
      game.events.emit('plateDestroyed', { turret: this, team: this.team, platesLeft: this.plates, gold: PLATE_GOLD, champions: got });
      game.fx.burst({ x: this.x, y: this.y, h: 260, color: 0xffd34d, count: 18, size: 22, speed: 320, duration: 0.7, gravity: 600 });
    }
  }

  _validTarget(t) {
    if (!t || !t.alive || t.removed || t.untargetable) return false;
    if (t.team === this.team || (t.team !== 0 && t.team !== 1)) return false;
    if (!TURRET_TARGET_TYPES.has(t.type)) return false;
    if (!t.isTargetableBy(this)) return false;
    return this.inAttackRange(t);
  }

  // 敌方英雄是否正在攻击我方英雄（2 秒内）
  _isAggressor(e, now) {
    for (const c of this.game.champions) {
      if (c.team === this.team && c.lastChampionDamager === e && now - (c.lastChampionDamageAt ?? -99) < 2) return true;
    }
    return false;
  }

  // 呼叫支援：敌方英雄在塔射程内伤害了塔下的我方英雄 → 立即转火
  _callForHelp(now) {
    const cur = this.target;
    if (cur && cur.type === 'champion' && this._isAggressor(cur, now)) return null;
    let best = null, bestT = -Infinity;
    for (const c of this.game.champions) {
      if (c.team !== this.team || !c.alive) continue;
      const t = c.lastChampionDamageAt ?? -99;
      if (t < this._cfhSince) continue;
      const e = c.lastChampionDamager;
      if (!e || e === cur || !this._validTarget(e)) continue;
      if (this.distTo(c) > RANGES.TURRET + (c.radius || 0) + 150) continue;
      if (t > bestT) { best = e; bestT = t; }
    }
    return best;
  }

  // 选择新目标：最近的小兵/宠物/先锋优先，其次最近的英雄
  _acquire() {
    const g = this.game;
    const base = { x: this.x, y: this.y, radius: RANGES.TURRET, enemyOf: this, targetableBy: this, filter: (u) => u.team !== 2 && !u.untargetable };
    const m = g.nearest({ ...base, types: ['minion', 'pet', 'monster'] });
    if (m && this._validTarget(m)) return m;
    const c = g.nearest({ ...base, types: ['champion'] });
    if (c && this._validTarget(c)) return c;
    return null;
  }

  _setTarget(t) {
    this.target = t;
    this.attackTarget = t;
    if (this.attackState && this.attackState.target !== t) this.attackState = null;
    this.heatTarget = null;
    this.heatStacks = 0;
    this.heat = 0;
  }

  update(dt) {
    if (!this.alive) { super.update(dt); return; }
    const game = this.game;
    const now = game.time;
    if (this.plates > 0 && now >= TIMINGS.PLATING_END) this.plates = 0;
    let t = this.target;
    if (t && !this._validTarget(t)) t = null;
    const help = this._callForHelp(now);
    this._cfhSince = now;
    if (help) t = help;
    if (!t && now >= this._nextScan) {
      this._nextScan = now + 0.1;
      t = this._acquire();
    }
    if (t !== this.target) this._setTarget(t);
    this.attackTarget = this.target;
    if (this.target && !this.attackState && this.attackCooldown <= 0 && this.canAttack()) this._startAttack(this.target);
    super.update(dt);
  }

  onDestroyed(killer) {
    const game = this.game;
    const enemy = 1 - this.team;
    const kc = resolveStructureKiller(game, this, killer);
    game.teams[enemy].turretsDestroyed++;
    const rw = STRUCTURE_REWARDS[this.tier] || STRUCTURE_REWARDS.outer;
    const first = !game.firstTurretDone;
    if (first) game.firstTurretDone = true;
    const local = rw.local + (first ? STRUCTURE_REWARDS.firstTurret : 0);
    splitGold(game, enemy, this.x, this.y, local, 'turret', kc && kc.alive ? kc : null);
    globalGold(game, enemy, rw.global, 'turret', this.x, this.y);
    this.plates = 0;
    game.fx.burst({ x: this.x, y: this.y, h: 200, color: 0xffb060, count: 40, size: 40, speed: 500, duration: 1.2, gravity: 400 });
    game.events.emit('structureDestroyed', { structure: this, kind: 'turret', team: this.team, lane: this.lane, tier: this.tier, killerChampion: kc, firstTurret: first });
    game.announce('turretDestroyed', first ? `${TEAM_NAMES[enemy]}摧毁了第一座防御塔` : `${TEAM_NAMES[enemy]}摧毁了一座防御塔`, { team: enemy, killer: kc, subject: this });
  }
}

export class Inhibitor extends Structure {
  constructor(game, def) {
    super(game, def, 'inhibitor', { hp: INHIBITOR_HP, ad: 0, armor: 20, mr: 20, range: 0 }, 160, '召唤水晶');
    this.title = `${LANE_NAMES[def.lane] || ''}召唤水晶`;
    this.respawnAt = null;
    this._warned = false;
    this._installBackdoor();
  }
  get respawnRemaining() { return this.alive || this.respawnAt == null ? 0 : Math.max(0, this.respawnAt - this.game.time); }

  onDestroyed(killer) {
    const game = this.game;
    const enemy = 1 - this.team;
    const kc = resolveStructureKiller(game, this, killer);
    game.teams[enemy].inhibsDestroyed++;
    globalGold(game, enemy, STRUCTURE_REWARDS.inhibitor.global, 'turret', this.x, this.y);
    this.respawnAt = game.time + TIMINGS.INHIB_RESPAWN;
    this._warned = false;
    game.fx.burst({ x: this.x, y: this.y, h: 150, color: this.team === 0 ? 0x6ac0ff : 0xff5a8a, count: 40, size: 36, speed: 450, duration: 1.2 });
    game.events.emit('structureDestroyed', { structure: this, kind: 'inhibitor', team: this.team, lane: this.lane, tier: null, killerChampion: kc });
    game.announce('inhibitorDestroyed', `${TEAM_NAMES[enemy]}摧毁了一座召唤水晶`, { team: enemy, killer: kc, subject: this });
  }

  respawn() {
    const game = this.game;
    this.alive = true;
    this.respawnAt = null;
    this.destroyedAt = null;
    this.deathTime = null;
    this._warned = false;
    this.damageLog.clear();
    this.recalcStats();
    this.hp = this.maxHp;
    this.anim.state = 'idle';
    this.anim.t = 0;
    game.markMoved();
    game.events.emit('inhibitorRespawn', { structure: this, team: this.team });
    game.announce('inhibitorRespawned', `${TEAM_NAMES[this.team]}的召唤水晶已重生`, { team: this.team, subject: this });
    updateStructureLocks(game);
  }

  update(dt) {
    const game = this.game;
    if (!this.alive) {
      if (this.respawnAt != null) {
        if (!this._warned && game.time >= this.respawnAt - 15) {
          this._warned = true;
          game.announce('inhibitorRespawning', `${TEAM_NAMES[this.team]}的召唤水晶即将重生`, { team: this.team, subject: this });
        }
        if (game.time >= this.respawnAt) { this.respawn(); return; }
      }
      super.update(dt);
      return;
    }
    super.update(dt);
  }
}

export class Nexus extends Structure {
  constructor(game, def) {
    super(game, def, 'nexus', { hp: NEXUS_HP, hpRegen: 25, ad: 0, armor: 0, mr: 0, range: 0 }, 240, '水晶枢纽');
    this.title = '水晶枢纽';
    this._installBackdoor();
  }
  onDestroyed(killer) {
    const game = this.game;
    const kc = resolveStructureKiller(game, this, killer);
    game.fx.burst({ x: this.x, y: this.y, h: 250, color: this.team === 0 ? 0x6ac0ff : 0xff5a8a, count: 80, size: 60, speed: 700, duration: 2 });
    game.events.emit('structureDestroyed', { structure: this, kind: 'nexus', team: this.team, lane: null, tier: null, killerChampion: kc });
    game.end(1 - this.team);
  }
}

// 泉水激光：对泉水范围内的敌人每 0.25 秒造成巨额真实伤害；无敌且不可选中
export class FountainTurret extends Structure {
  constructor(game, def) {
    super(game, def, 'turret', { hp: 9999, ad: 0, armor: 999, mr: 999, range: 0 }, 60, '泉水');
    this.kind = 'fountainTurret';
    this.tier = 'fountain';
    this.title = '泉水';
    this.invulnerable = true;
    this.untargetable = true;
    this.blocksUnits = false;
    this._nextShot = 0;
  }
  die() {}
  update(dt) {
    const game = this.game;
    this._updateAnim(dt, false);
    if (game.time < this._nextShot) return;
    this._nextShot = game.time + FOUNTAIN_INTERVAL;
    const f = game.fountainOf(this.team);
    const enemies = game.queryUnits({
      x: f.x, y: f.y, radius: f.radius, enemyOf: this, types: ['champion', 'minion', 'pet', 'monster'],
      filter: (u) => u.team !== 2,
    });
    this.attackTarget = enemies[0] || null;
    for (const e of enemies) {
      this.lastAttackAt = game.time;
      game.fx.beam({ x1: this.x, y1: this.y, x2: e.x, y2: e.y, h: 320, from: this, to: e, width: 34, color: TEAM_COLORS[this.team] ?? 0xffffff, duration: 0.22 });
      game.dealDamage(this, e, FOUNTAIN_DAMAGE, 'true', { isTurret: true, spell: 'fountain' });
    }
  }
}

// 解锁规则：外塔 → 内塔 → 高地塔 → 召唤水晶 → 任一水晶被破后两座枢纽塔 → 两座枢纽塔都被破后枢纽
export function updateStructureLocks(game) {
  const S = game.structures;
  for (const team of [0, 1]) {
    const mine = S.filter((s) => s.team === team && s.kind !== 'fountainTurret');
    const turret = (lane, tier) => mine.find((s) => s.type === 'turret' && s.lane === lane && s.tier === tier);
    const inhibs = mine.filter((s) => s.type === 'inhibitor');
    const anyInhibDown = inhibs.some((s) => !s.alive);
    const nexusTurrets = mine.filter((s) => s.type === 'turret' && s.tier === 'nexus');
    for (const s of mine) {
      let unlocked = true;
      if (s.type === 'turret') {
        if (s.tier === 'inner') unlocked = !turret(s.lane, 'outer')?.alive;
        else if (s.tier === 'inhib') unlocked = !turret(s.lane, 'inner')?.alive;
        else if (s.tier === 'nexus') unlocked = anyInhibDown;
      } else if (s.type === 'inhibitor') {
        unlocked = !turret(s.lane, 'inhib')?.alive;
      } else if (s.type === 'nexus') {
        unlocked = nexusTurrets.every((t) => !t.alive);
      }
      s.invulnerable = !unlocked;
    }
  }
}

export function createStructure(game, def) {
  switch (def.kind) {
    case 'turret': return new Turret(game, def);
    case 'inhibitor': return new Inhibitor(game, def);
    case 'nexus': return new Nexus(game, def);
    case 'fountainTurret': return new FountainTurret(game, def);
    default: return null;
  }
}
