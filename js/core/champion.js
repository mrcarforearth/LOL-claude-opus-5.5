// 英雄：经验升级、技能加点、技能施放（走近施法/再次施放/前摇）、冷却急速、召唤师技能、装备主动、饰品、回城、泉水、复活
import { Unit } from './unit.js';
import { SummonerState } from './summoners.js';
import { respawnTime } from './rewards.js';
import { clamp, byLevel } from './math.js';
import {
  XP_TABLE, MAX_LEVEL, GOLD, RANGES, RECALL_TIME, BARON_RECALL_TIME, FOUNTAIN_REGEN_PCT, DEFAULT_CAST_TIME, TRINKET, ABILITY_SLOTS,
} from '../config.js';

// 解析「按等级数组 / 函数 / 常量」的数值
export function resolveValue(v, champ, rank) {
  if (typeof v === 'function') return v(champ, rank);
  if (Array.isArray(v)) return v.length ? v[clamp((rank || 1) - 1, 0, v.length - 1)] : 0;
  return v ?? 0;
}

const R_LEVELS = [6, 11, 16];
const fail = (reason) => ({ ok: false, reason });
const OK = Object.freeze({ ok: true });

// 技能状态
export class AbilityState {
  constructor(champ, slot, def) {
    this.champ = champ;
    this.slot = slot;
    this.def = def || { id: `${slot}_none`, name: '无', maxRank: slot === 'R' ? 3 : 5, cooldown: 0, cost: 0, targeting: 'self', cast: () => false };
    this.rank = 0;
    this.cooldownUntil = 0;
    this.cdDuration = 0;
    this.recastUntil = 0;
    this.recastStartedAt = 0;
    this.toggled = false;
    this.maxCharges = this.def.maxCharges || 0;
    this.charges = this.maxCharges || null;
    this.chargeReadyAt = 0;
    this.state = {};
    this._recastOnExpire = null;
    this._recastCd = true;
  }

  get game() { return this.champ.game; }
  get maxRank() { return this.def.maxRank ?? (this.slot === 'R' ? 3 : 5); }
  get isRecastActive() { return this.recastUntil > this.game.time; }
  get recastRemaining() { return Math.max(0, this.recastUntil - this.game.time); }
  get ready() {
    if (this.rank <= 0) return false;
    if (this.isRecastActive) return true;
    if (this.maxCharges) return this.charges > 0 && this.game.time >= this.cooldownUntil;
    return this.game.time >= this.cooldownUntil;
  }
  get cdRemaining() {
    if (this.maxCharges && this.charges <= 0) return Math.max(0, this.chargeReadyAt - this.game.time);
    return Math.max(0, this.cooldownUntil - this.game.time);
  }
  get cost() { return resolveValue(this.def.cost, this.champ, Math.max(1, this.rank)); }
  get costType() { return this.def.costType || this.champ.resourceType; }
  get range() { return resolveValue(this.def.range, this.champ, Math.max(1, this.rank)); }
  get castTime() { return resolveValue(this.def.castTime ?? DEFAULT_CAST_TIME, this.champ, Math.max(1, this.rank)); }
  // 基础冷却（未计急速）
  baseCooldown(rank = this.rank) { return resolveValue(this.def.cooldown, this.champ, Math.max(1, rank)); }
  // 计算急速后的冷却
  cooldownFor(rank = this.rank) {
    const haste = this.champ.stats.abilityHaste || 0;
    return (this.baseCooldown(rank) * 100) / (100 + haste);
  }

  startCooldown(seconds) {
    const cd = seconds ?? this.cooldownFor();
    const now = this.game.time;
    if (this.maxCharges) {
      if (this.charges === this.maxCharges) this.chargeReadyAt = now + cd;
      this.charges = Math.max(0, this.charges - 1);
      this.cdDuration = cd;
      this.cooldownUntil = now + Math.min(cd, this.def.chargeLockout ?? 0.5);
      return;
    }
    this.cdDuration = cd;
    this.cooldownUntil = now + cd;
  }
  reduceCooldown(seconds) {
    if (this.maxCharges && this.charges < this.maxCharges) this.chargeReadyAt -= seconds;
    this.cooldownUntil = Math.max(this.game.time, this.cooldownUntil - seconds);
  }
  // 按剩余冷却百分比减少
  reduceCooldownPct(pct) { this.reduceCooldown(this.cdRemaining * pct); }
  resetCooldown() {
    this.cooldownUntil = this.game.time;
    if (this.maxCharges) this.charges = this.maxCharges;
  }

  setRecast(window, { onExpire = null, cooldownOnExpire = true } = {}) {
    this.recastUntil = this.game.time + window;
    this.recastStartedAt = this.game.time;
    this._recastOnExpire = onExpire;
    this._recastCd = cooldownOnExpire;
  }
  endRecast(startCd = true) {
    const was = this.recastUntil > 0;
    this.recastUntil = 0;
    this._recastOnExpire = null;
    if (startCd && was) this.startCooldown();
  }

  // 立即结束再次施放窗口（触发 onExpire 与冷却）
  expireRecast() {
    if (this.recastUntil > 0) { this.recastUntil = this.game.time; this.update(); }
  }

  update() {
    const now = this.game.time;
    if (this.recastUntil > 0 && now >= this.recastUntil) {
      const fn = this._recastOnExpire;
      const cd = this._recastCd;
      this.recastUntil = 0;
      this._recastOnExpire = null;
      if (fn) fn(this.champ, this);
      if (cd) this.startCooldown();
    }
    if (this.maxCharges && this.charges < this.maxCharges && now >= this.chargeReadyAt) {
      this.charges++;
      if (this.charges < this.maxCharges) this.chargeReadyAt = now + this.cooldownFor();
    }
  }
}

export class Champion extends Unit {
  constructor(game, def, { team, role = 'mid', isPlayer = false, summoners = ['flash', 'ignite'], name, slot = 0, x, y } = {}) {
    super(game, { type: 'champion', team, x, y, name: def.name, modelId: def.id, baseStats: def.baseStats, level: 1, radius: def.baseStats?.radius ?? 65 });
    this.def = def;
    this.championId = def.id;
    this.displayName = def.name;
    this.role = role;
    this.isPlayer = isPlayer;
    this.summonerName = name || def.name;
    this.slotIndex = slot;
    this.controller = null;
    this.xp = 0;
    this.level = 1;
    this.skillPoints = 1;
    this.sightRange = RANGES.SIGHT_CHAMPION;
    this.abilities = {};
    for (const s of ABILITY_SLOTS) this.abilities[s] = new AbilityState(this, s, def.abilities?.[s]);
    this.passive = { def: def.passive || null, state: {} };
    const sm = summoners && summoners.length ? summoners : ['flash', 'ignite'];
    this.summoners = { D: new SummonerState(this, 'D', sm[0] || 'flash'), F: new SummonerState(this, 'F', sm[1] || 'ignite') };
    this.items = [null, null, null, null, null, null];
    this.trinket = { id: 'wardtotem', charges: TRINKET.MAX_CHARGES, maxCharges: TRINKET.MAX_CHARGES, rechargeAt: 0 };
    this.itemStats = {};
    this.gold = GOLD.START;
    this.totalGold = GOLD.START;
    this.goldEarned = 0;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.cs = 0; this.jungleCs = 0;
    this.killStreak = 0; this.deathStreak = 0; this.multiKillCount = 0; this.lastKillTime = -999; this.largestMultiKill = 0;
    this.damageToChampions = 0; this.damageTaken = 0; this.healingDone = 0; this.wardsPlaced = 0; this.wardsKilled = 0;
    this.respawnAt = null;
    this.deathTime = null;
    this.lastChampionDamageAt = -99;
    this.lastChampionDamager = null;
    this._pendingCast = null;
    this._passiveGoldAcc = 0;
    this.shopSession = 0;           // 每次离开泉水 +1（商店撤销判定）
    this._wasInShop = true;
    this.recalcStats();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
    if (this.passive.def && this.passive.def.init) this.passive.def.init(this);
  }

  // —— 查询 ——
  get resourceType() { return this.baseStats.resource || 'mana'; }
  get xpToNext() { return this.level >= MAX_LEVEL ? 0 : Math.max(0, XP_TABLE[this.level] - this.xp); }
  get xpProgress() {
    if (this.level >= MAX_LEVEL) return 1;
    const a = XP_TABLE[this.level - 1], b = XP_TABLE[this.level];
    return clamp((this.xp - a) / (b - a), 0, 1);
  }
  get inFountain() {
    const f = this.game.fountainOf(this.team);
    const dx = this.x - f.x, dy = this.y - f.y;
    return dx * dx + dy * dy <= f.radius * f.radius;
  }
  get canShop() { return this.inFountain || !this.alive; }
  get isRecalling() { return !!(this.channel && this.channel.id === 'recall'); }
  get respawnRemaining() { return this.alive || this.respawnAt == null ? 0 : Math.max(0, this.respawnAt - this.game.time); }

  // —— 技能加点 ——
  canLevelAbility(slot) {
    const ab = this.abilities[slot];
    if (!ab || this.skillPoints <= 0) return false;
    if (ab.rank >= ab.maxRank) return false;
    if (slot === 'R') return this.level >= (R_LEVELS[ab.rank] ?? 99);
    return ab.rank < Math.ceil(this.level / 2);
  }
  levelUpAbility(slot) {
    if (!this.canLevelAbility(slot)) return false;
    const ab = this.abilities[slot];
    ab.rank++;
    this.skillPoints--;
    if (ab.rank === 1 && ab.def.onLearn) ab.def.onLearn(this, ab);
    if (ab.def.onRankUp) ab.def.onRankUp(this, ab);
    if (ab.maxCharges && ab.rank === 1) ab.charges = ab.maxCharges;
    this.game.events.emit('abilityLevelUp', { champion: this, slot, rank: ab.rank });
    return true;
  }

  // —— 技能施放 ——
  _canPay(type, cost) {
    if (!(cost > 0) || type === 'none') return true;
    if (type === 'hp') return this.hp > cost;
    return this.mana >= cost - 1e-6;
  }
  _pay(type, cost) {
    if (!(cost > 0) || type === 'none') return;
    if (type === 'hp') this.hp = Math.max(1, this.hp - cost);
    else this.mana = Math.max(0, this.mana - cost);
  }
  _refund(type, cost) {
    if (!(cost > 0) || type === 'none') return;
    if (type === 'hp') this.hp = Math.min(this.maxHp, this.hp + cost);
    else this.mana = Math.min(this.maxMana, this.mana + cost);
  }

  // 技能目标过滤
  _targetOk(filter, target) {
    if (!target || !target.alive || target.removed) return false;
    if (typeof filter === 'function') return !!filter(this, target);
    const enemy = target.team !== this.team;
    const unitTypes = target.type === 'champion' || target.type === 'minion' || target.type === 'monster' || target.type === 'pet';
    switch (filter || 'enemy') {
      case 'enemy': return enemy && unitTypes && target.isTargetableBy(this);
      case 'enemyChampion': return enemy && target.type === 'champion' && target.isTargetableBy(this);
      case 'ally': return !enemy && unitTypes && !target.untargetable;
      case 'allyChampion': return !enemy && target.type === 'champion' && !target.untargetable;
      case 'any': return unitTypes && (enemy ? target.isTargetableBy(this) : !target.untargetable);
      default: return false;
    }
  }

  _makeCtx(ab, slot, target, x, y, isRecast) {
    const def = ab.def;
    const tg = def.targeting || 'self';
    let px = x, py = y;
    if ((px == null || py == null) && target) { px = target.x; py = target.y; }
    if (px == null || py == null) { px = this.x + Math.cos(this.facing) * 100; py = this.y + Math.sin(this.facing) * 100; }
    let dx = px - this.x, dy = py - this.y;
    let d = Math.hypot(dx, dy);
    let dirX, dirY;
    if (d > 1e-6) { dirX = dx / d; dirY = dy / d; } else { dirX = Math.cos(this.facing); dirY = Math.sin(this.facing); }
    const range = ab.range;
    if ((tg === 'point' || tg === 'direction') && def.clampRange !== false && range > 0 && d > range) {
      px = this.x + dirX * range; py = this.y + dirY * range; d = range;
    }
    return { game: this.game, champ: this, ability: ab, rank: ab.rank, slot, target: target || null, x: px, y: py, dirX, dirY, dist: d, isRecast, cursorX: x, cursorY: y };
  }

  castAbility(slot, { target = null, x, y } = {}) {
    const ab = this.abilities[slot];
    if (!this.alive) return fail('dead');
    if (!ab || ab.rank <= 0) return fail('rank');
    if (this.castLock > 0) return fail('busy');
    if (!this.canCast()) return fail('cc');
    const def = ab.def;
    const game = this.game;
    // 再次施放窗口
    if (ab.isRecastActive && def.recast) {
      const ctx = this._makeCtx(ab, slot, target, x, y, true);
      const r = def.recast(this, ctx);
      if (r === false) return fail('busy');
      this.cancelRecall();
      this.playCastAnim(slot, 0.3);
      game.events.emit('abilityCast', { caster: this, slot, abilityId: def.id, rank: ab.rank, target: ctx.target, x: ctx.x, y: ctx.y, isRecast: true });
      this.runHooks('onAbilityCast', slot, ab, ctx);
      return OK;
    }
    if (!ab.ready) return fail('cooldown');
    const cost = ab.cost, costType = ab.costType;
    if (!this._canPay(costType, cost)) return fail('cost');
    const tg = def.targeting || 'self';
    if (tg === 'unit') {
      if (!this._targetOk(def.targetFilter, target)) return fail('target');
      if (this.distTo(target) > ab.range + (target.radius || 0)) {
        // 超出射程：走近后自动施放
        this.cancelRecall();
        this.command = { type: 'castMove', slot, target };
        this._chaseTarget = null;
        this._repathAt = 0;
        return { ok: true, reason: 'queued' };
      }
    }
    return this._executeCast(ab, slot, target, x, y, cost, costType);
  }

  _executeCast(ab, slot, target, x, y, cost, costType) {
    const def = ab.def;
    const ctx = this._makeCtx(ab, slot, target, x, y, false);
    this._pay(costType, cost);
    if ((def.targeting || 'self') !== 'self' && def.targeting !== 'none') this.faceTowards(ctx.x, ctx.y);
    this.cancelRecall();
    if (this.channel && this.channel.interruptOnMove && !def.keepChannel) this.interruptChannel('cast');
    const castTime = ab.castTime;
    if (castTime > 0) {
      this.attackState = null; // 施法取消普攻前摇
      this.castLock = castTime;
      this._castLockMove = def.lockMovement !== false;
      if (this._castLockMove) this.path.length = 0;
      this._pendingCast = { ab, slot, ctx, cost, costType };
      this.playCastAnim(slot, castTime + 0.25);
      if (def.onCastStart) def.onCastStart(this, ctx);
      return OK;
    }
    return this._resolveCast(ab, slot, ctx, cost, costType, true);
  }

  _resolveCast(ab, slot, ctx, cost, costType, instant) {
    const def = ab.def;
    if ((def.targeting === 'unit') && ctx.target && (!ctx.target.alive || ctx.target.removed || (ctx.target.untargetable && ctx.target.team !== this.team))) {
      this._refund(costType, cost);
      return fail('target');
    }
    const r = def.cast(this, ctx);
    if (r === false) {
      this._refund(costType, cost);
      return fail('target');
    }
    if (!def.manualCooldown) ab.startCooldown();
    if (instant) this.playCastAnim(slot, 0.35);
    this.lastCastAt = this.game.time;
    this.game.events.emit('abilityCast', { caster: this, slot, abilityId: def.id, rank: ab.rank, target: ctx.target, x: ctx.x, y: ctx.y, isRecast: false });
    this.runHooks('onAbilityCast', slot, ab, ctx);
    return OK;
  }

  _finishPendingCast() {
    const p = this._pendingCast;
    this._pendingCast = null;
    this._castLockMove = false;
    if (!p || !this.alive) return;
    this._resolveCast(p.ab, p.slot, p.ctx, p.cost, p.costType, false);
    // 施法结束后继续之前的移动命令
    if (this.command && this.command.type === 'move' && this.path.length === 0) this._setPathTo(this.command.x, this.command.y);
  }

  _interruptPendingCast() {
    const p = this._pendingCast;
    if (!p) return;
    this._pendingCast = null;
    this.castLock = 0;
    this._castLockMove = false;
    this._refund(p.costType, p.cost);
  }

  // —— 召唤师技能 ——
  castSummoner(key, { target = null, x, y } = {}) {
    const st = this.summoners[key];
    if (!this.alive) return fail('dead');
    if (!st) return fail('rank');
    const def = st.def;
    const ccOk = this.canUseSummoner() || (def.usableWhileCC && !this.hasCC('suppress') && !this.hasCC('airborne'));
    if (!ccOk) return fail('cc');
    if (!st.ready) return fail('cooldown');
    const game = this.game;
    const tg = def.targeting || 'self';
    let px = x, py = y;
    if (tg === 'unit') {
      const okT = def.canTarget
        ? !!target && def.canTarget(this, target) && target.alive && target.team !== this.team && target.isTargetableBy(this)
        : this._targetOk(def.targetFilter || 'enemy', target);
      if (!okT) return fail('target');
      if (this.distTo(target) > def.range + (target.radius || 0)) {
        this.cancelRecall();
        this.command = { type: 'castMove', summonerKey: key, target };
        this._chaseTarget = null;
        this._repathAt = 0;
        return { ok: true, reason: 'queued' };
      }
      px = target.x; py = target.y;
    }
    if (px == null || py == null) { px = this.x + Math.cos(this.facing) * 100; py = this.y + Math.sin(this.facing) * 100; }
    if (tg === 'point' && def.clampRange !== false && def.range > 0) {
      const d = Math.hypot(px - this.x, py - this.y);
      if (d > def.range) { px = this.x + ((px - this.x) / d) * def.range; py = this.y + ((py - this.y) / d) * def.range; }
    }
    if (def.id !== 'teleport') this.cancelRecall();
    const ctx = { game, champ: this, target, x: px, y: py, key, summonerState: st };
    const r = def.cast(this, ctx);
    if (r === false) return fail('target');
    st.consume();
    game.events.emit('summonerCast', { caster: this, key, spellId: def.id, target, x: px, y: py });
    return OK;
  }

  // —— 装备主动 / 消耗品 ——
  useItem(slotIndex, ctx = {}) {
    if (!this.alive) return fail('dead');
    const item = this.items[slotIndex];
    if (!item) return fail('empty');
    const def = item.def || {};
    const game = this.game;
    const now = game.time;
    if (def.consumable) {
      if (item.cooldownUntil && now < item.cooldownUntil) return fail('cooldown');
      // keepWhenEmpty：可充值消耗品（如可充值药水）用完后保留在栏位，回泉水由装备系统补充
      if (def.consumable.keepWhenEmpty && item.charges != null && item.charges <= 0) return fail('cooldown');
      const r = def.consumable.use(this, item, ctx);
      if (r === false) return fail('busy');
      if (item.stacks != null && item.stacks > 1) item.stacks--;
      else if (item.charges != null && (item.charges > 1 || def.consumable.keepWhenEmpty)) item.charges--;
      else {
        if (item.cleanup) item.cleanup();
        this.items[slotIndex] = null;
        this._recomputeItemStats();
      }
      game.events.emit('itemUsed', { champion: this, itemId: item.id });
      return OK;
    }
    if (def.active) {
      if (item.cooldownUntil && now < item.cooldownUntil) return fail('cooldown');
      if (def.active.targeting === 'unit' && ctx.target && def.active.range && this.distTo(ctx.target) > def.active.range + ctx.target.radius) return fail('range');
      const r = def.active.cast(this, item, ctx);
      if (r === false) return fail('target');
      const cd = resolveValue(def.active.cooldown, this, 1);
      item.cooldownUntil = now + cd;
      item.cdDuration = cd;
      game.events.emit('itemUsed', { champion: this, itemId: item.id });
      return OK;
    }
    return fail('passive');
  }

  // 优先使用装备模块注册的汇总函数，否则简单求和
  _recomputeItemStats() {
    const fn = this.game.recomputeItemStats;
    if (typeof fn === 'function') { fn(this); return; }
    const out = {};
    for (const it of this.items) {
      if (!it || !it.def || !it.def.stats) continue;
      for (const k in it.def.stats) out[k] = (out[k] || 0) + it.def.stats[k];
    }
    this.itemStats = out;
  }

  trinketRechargeTime() { return byLevel(this.level, TRINKET.RECHARGE_L1, TRINKET.RECHARGE_L18); }

  useTrinket(x, y) {
    if (!this.alive) return fail('dead');
    const t = this.trinket;
    if (!t || t.charges <= 0) return fail('cooldown');
    if (x == null || y == null) { x = this.x; y = this.y; }
    const d = Math.hypot(x - this.x, y - this.y);
    if (d > TRINKET.RANGE + 5) {
      this.command = { type: 'castMove', trinket: true, x, y };
      this._setPathTo(x, y);
      return { ok: true, reason: 'queued' };
    }
    const game = this.game;
    if (t.charges === t.maxCharges) t.rechargeAt = game.time + this.trinketRechargeTime();
    t.charges--;
    game.placeWard(this, x, y, 'stealth');
    game.events.emit('itemUsed', { champion: this, itemId: t.id });
    return OK;
  }

  // 走近施法命令
  _updateCustomCommand(dt, cmd) {
    if (cmd.type !== 'castMove') { this.command = null; return false; }
    if (cmd.trinket || (cmd.target == null && cmd.x != null)) {
      const d = Math.hypot(cmd.x - this.x, cmd.y - this.y);
      if (d <= TRINKET.RANGE) {
        this.command = null;
        this.path.length = 0;
        if (cmd.trinket) this.useTrinket(cmd.x, cmd.y);
        return false;
      }
      if (this.path.length === 0) this._setPathTo(cmd.x, cmd.y);
      const moved = this._followPath(dt);
      if (!moved && this.path.length === 0 && this.canMove()) this.command = null;
      return moved;
    }
    const t = cmd.target;
    if (!t || !t.alive || t.removed || (t.team !== this.team && !t.isTargetableBy(this))) { this.command = null; this.path.length = 0; return false; }
    let range;
    if (cmd.summonerKey) range = this.summoners[cmd.summonerKey]?.def.range ?? 0;
    else range = this.abilities[cmd.slot]?.range ?? 0;
    if (this.distTo(t) <= range + (t.radius || 0)) {
      this.command = null;
      this.path.length = 0;
      if (cmd.summonerKey) this.castSummoner(cmd.summonerKey, { target: t });
      else this.castAbility(cmd.slot, { target: t });
      return false;
    }
    return this._chase(dt, t);
  }

  // —— 回城 ——
  recallDuration() {
    let d = RECALL_TIME;
    for (const b of this.buffs) if (b.data && b.data.recallTime) d = Math.min(d, b.data.recallTime);
    if (this.hasBuff('baron')) d = Math.min(d, BARON_RECALL_TIME);
    return d;
  }
  startRecall() {
    if (!this.alive || this.isRecalling || this.dashState) return false;
    if (!this.canUseSummoner()) return false;
    const game = this.game;
    const duration = this.recallDuration();
    this.command = null;
    this.path.length = 0;
    this.attackState = null;
    this.startChannel({
      id: 'recall', duration, interruptOnDamage: true, interruptOnMove: true, anim: 'recall',
      onComplete: () => {
        const f = game.map.FOUNTAINS?.[this.team];
        const sp = f?.spawns?.[this.slotIndex % (f.spawns.length || 1)] || f || game.fountainOf(this.team);
        this.setPosition(sp.x, sp.y);
        game.events.emit('recallEnd', { champion: this });
      },
      onInterrupt: () => { game.events.emit('recallCancel', { champion: this }); },
    });
    game.events.emit('recallStart', { champion: this });
    game.fx.recall({ unit: this, duration });
    return true;
  }
  cancelRecall() {
    if (this.isRecalling) this.interruptChannel('cancel');
  }

  // —— 经验与金币 ——
  gainXp(amount) {
    if (!(amount > 0)) return;
    const cap = XP_TABLE[MAX_LEVEL - 1];
    if (this.xp >= cap) return;
    this.xp = Math.min(cap, this.xp + amount);
    this.game.events.emit('xpGained', { champion: this, amount });
    while (this.level < MAX_LEVEL && this.xp >= XP_TABLE[this.level]) this._levelUp();
  }
  _levelUp() {
    this.level++;
    this.skillPoints++;
    this.recalcStats();
    this.game.events.emit('levelUp', { unit: this, level: this.level });
    this.runHooks('onLevelUp', this.level);
    this.game.fx.levelUp({ unit: this });
  }
  // 直接设置等级（测试/快进用）
  setLevel(level) {
    level = clamp(Math.floor(level), 1, MAX_LEVEL);
    while (this.level < level) {
      this.xp = Math.max(this.xp, XP_TABLE[this.level]);
      this._levelUp();
    }
  }
  gainGold(amount, reason = 'kill', x, y) {
    if (!(amount > 0)) return;
    this.gold += amount;
    if (reason !== 'sell') { this.goldEarned += amount; this.totalGold += amount; }
    this.game.events.emit('goldGained', { champion: this, amount, reason, x: x ?? this.x, y: y ?? this.y });
  }

  // —— 生死 ——
  die(killer) {
    if (!this.alive) return;
    this.respawnAt = this.game.time + respawnTime(this.level, this.game.time);
    this._pendingCast = null;
    super.die(killer);
    // 阵亡时结束所有再次施放窗口
    for (const s of ABILITY_SLOTS) this.abilities[s].expireRecast();
  }

  respawn() {
    const game = this.game;
    this.alive = true;
    this.removed = false;
    this.ccs.length = 0;
    this.recalcStats();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
    this.respawnAt = null;
    this.command = null;
    this.attackState = null;
    this.path.length = 0;
    const f = game.map.FOUNTAINS?.[this.team];
    const sp = f?.spawns?.[this.slotIndex % (f.spawns.length || 1)] || f || game.fountainOf(this.team);
    this.setPosition(sp.x, sp.y);
    this.anim.state = 'idle';
    this.anim.t = 0;
    if (game._aceActive) game._aceActive[this.team] = false;
    game.events.emit('respawn', { champion: this });
  }

  update(dt) {
    const game = this.game;
    if (!this.alive) {
      if (this.respawnAt != null && game.time >= this.respawnAt) this.respawn();
      else {
        for (const s of ABILITY_SLOTS) this.abilities[s].update();
        this._updateAnim(dt, false);
        return;
      }
    }
    super.update(dt);
    if (!this.alive) return;
    const pdef = this.passive.def;
    if (pdef && pdef.update) pdef.update(this, dt);
    for (const s of ABILITY_SLOTS) {
      const ab = this.abilities[s];
      ab.update();
      if (ab.rank > 0 && ab.def.update) ab.def.update(this, ab, dt);
    }
    this.summoners.D.update();
    this.summoners.F.update();
    const t = this.trinket;
    if (t.charges < t.maxCharges && game.time >= t.rechargeAt) {
      t.charges++;
      if (t.charges < t.maxCharges) t.rechargeAt = game.time + this.trinketRechargeTime();
    }
    // 泉水回复与商店会话
    const inF = this.inFountain;
    if (this._wasInShop && !inF) this.shopSession++;
    this._wasInShop = inF;
    if (inF) {
      const s = this.stats;
      this.hp = Math.min(s.maxHp, this.hp + s.maxHp * FOUNTAIN_REGEN_PCT * dt);
      if (s.maxMana > 0) this.mana = Math.min(s.maxMana, this.mana + s.maxMana * FOUNTAIN_REGEN_PCT * dt);
    }
  }
}
