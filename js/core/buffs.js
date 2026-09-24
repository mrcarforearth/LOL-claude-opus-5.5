// Buff 与护盾：添加/刷新/叠层规则、周期触发、到期与移除回调
//
// 刷新规则 refresh：
//   'duration'（默认）：刷新持续时间；层数取 max(现有, 新 stacks)
//   'stack'          ：层数 += 新 stacks（上限 maxStacks），并刷新持续时间
//   'none'           ：已存在则忽略，返回已存在的 Buff
//   'replace'        ：移除旧 Buff（触发 onRemove）后添加新的
// 额外可选字段（core 扩展）：
//   disableAttack: true   —— 持有期间不能普攻（如盖伦 E 旋转）
//   ghosted: true         —— 忽略单位碰撞
//   persistOnDeath: true  —— 死亡时保留（Infinity 时长的 Buff 默认保留，removeOnDeath: true 可强制移除）
//   onRefresh(unit, buff) —— 再次添加（刷新/叠层）时调用
export class Buff {
  constructor(unit, def) {
    const game = unit.game;
    this.unit = unit;
    this.id = def.id;
    this.name = def.name || def.id;
    this.desc = def.desc || '';
    this.icon = def.icon || null;
    this.hidden = !!def.hidden;
    this.source = def.source || null;
    this.duration = def.duration ?? Infinity;
    this.startedAt = game.time;
    this.expiresAt = game.time + this.duration;
    this.maxStacks = def.maxStacks ?? 1;
    this.stacks = Math.min(this.maxStacks, def.stacks ?? 1);
    this.refresh = def.refresh || 'duration';
    this.stats = def.stats || null;
    this.statsPerStack = !!def.statsPerStack;
    this.statsFn = def.statsFn || null;
    this.isDebuff = !!def.isDebuff;
    this.cleansable = !!def.cleansable;
    this.tickInterval = def.tickInterval || 0;
    this.nextTickAt = this.tickInterval > 0 ? game.time + this.tickInterval : Infinity;
    this.onInterval = def.onInterval || null;
    this.onApply = def.onApply || null;
    this.onTick = def.onTick || null;
    this.onExpire = def.onExpire || null;
    this.onRemove = def.onRemove || null;
    this.onRefresh = def.onRefresh || null;
    this.disableAttack = !!def.disableAttack;
    this.ghosted = !!def.ghosted;
    this.persistOnDeath = def.persistOnDeath ?? (this.duration === Infinity && !def.removeOnDeath);
    this.data = def.data || {};
    this.removed = false;
    this.def = def;
  }

  get remaining() { return Math.max(0, this.expiresAt - this.unit.game.time); }
  get elapsed() { return this.unit.game.time - this.startedAt; }
  // 进度 0..1（无限时长恒为 0）
  get progress() { return this.duration === Infinity ? 0 : Math.min(1, this.elapsed / Math.max(1e-6, this.duration)); }

  remove() { this.unit.removeBuff(this); }
  setDuration(sec) { this.duration = sec; this.expiresAt = this.unit.game.time + sec; }
  addStacks(n = 1) { this.stacks = Math.max(0, Math.min(this.maxStacks, this.stacks + n)); return this.stacks; }
}

// 向单位添加 Buff（按刷新规则）
export function addBuffTo(unit, def) {
  if (!def || !def.id) throw new Error('addBuff 需要 id');
  const game = unit.game;
  const existing = unit.buffs.find((b) => b.id === def.id && !b.removed);
  if (existing) {
    const mode = def.refresh || existing.refresh;
    if (mode === 'none') return existing;
    if (mode === 'replace') {
      removeBuffFrom(unit, existing, 'replace');
    } else {
      if (mode === 'stack') existing.stacks = Math.min(existing.maxStacks, existing.stacks + (def.stacks ?? 1));
      else existing.stacks = Math.min(existing.maxStacks, Math.max(existing.stacks, def.stacks ?? 1));
      if (def.maxStacks != null) existing.maxStacks = def.maxStacks;
      const dur = def.duration ?? existing.duration;
      existing.duration = dur;
      existing.startedAt = game.time;
      existing.expiresAt = game.time + dur;
      if (def.source) existing.source = def.source;
      if (def.stats) existing.stats = def.stats;
      if (def.statsFn) existing.statsFn = def.statsFn;
      if (def.tickInterval && existing.nextTickAt === Infinity) existing.nextTickAt = game.time + def.tickInterval;
      if (existing.onRefresh) existing.onRefresh(unit, existing);
      return existing;
    }
  }
  const buff = new Buff(unit, def);
  unit.buffs.push(buff);
  if (buff.onApply) buff.onApply(unit, buff);
  return buff;
}

// 移除 Buff（任何原因都会调用 onRemove）
export function removeBuffFrom(unit, buffOrId, reason = 'removed') {
  const buff = typeof buffOrId === 'string' ? unit.buffs.find((b) => b.id === buffOrId && !b.removed) : buffOrId;
  if (!buff || buff.removed) return false;
  buff.removed = true;
  const i = unit.buffs.indexOf(buff);
  if (i >= 0) unit.buffs.splice(i, 1);
  if (buff.onRemove) buff.onRemove(unit, buff, reason);
  return true;
}

// 每 tick 更新：onTick、周期触发、到期
export function updateBuffs(unit, dt) {
  const list = unit.buffs;
  if (list.length === 0) return;
  const now = unit.game.time;
  // 拷贝迭代：回调中可能增删 Buff
  const snap = list.slice();
  for (let i = 0; i < snap.length; i++) {
    const b = snap[i];
    if (b.removed) continue;
    if (b.onTick) b.onTick(unit, b, dt);
    if (b.removed) continue;
    if (b.tickInterval > 0 && b.onInterval) {
      let guard = 0;
      while (now >= b.nextTickAt - 1e-9 && !b.removed && guard++ < 20) {
        b.nextTickAt += b.tickInterval;
        b.onInterval(unit, b);
      }
    }
    if (b.removed) continue;
    if (now >= b.expiresAt - 1e-9) {
      if (b.onExpire) b.onExpire(unit, b);
      removeBuffFrom(unit, b, 'expire');
    }
  }
}

// —— 护盾 ——
let shieldSeq = 1;
export function addShieldTo(unit, amount, duration, { type = 'all', source = null, id = null, onBreak = null, onExpire = null, noPower = false } = {}) {
  const game = unit.game;
  if (!(amount > 0)) return null;
  let amt = amount;
  // 治疗/护盾强度只在英雄来源时生效
  if (source && source.type === 'champion' && source.stats && !noPower) amt *= 1 + (source.stats.healShieldPower || 0);
  if (id) {
    const old = unit.shields.findIndex((s) => s.id === id);
    if (old >= 0) unit.shields.splice(old, 1);
  }
  const shield = {
    id: id || `shield_${shieldSeq++}`,
    amount: amt, max: amt, type, source,
    startedAt: game.time,
    expiresAt: game.time + (duration ?? Infinity),
    onBreak, onExpire,
    remove() {
      const i = unit.shields.indexOf(shield);
      if (i >= 0) unit.shields.splice(i, 1);
    },
  };
  unit.shields.push(shield);
  game.events.emit('shield', { source, target: unit, amount: amt });
  return shield;
}

export function updateShields(unit) {
  const list = unit.shields;
  if (list.length === 0) return;
  const now = unit.game.time;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (now >= s.expiresAt || s.amount <= 0) {
      list.splice(i, 1);
      if (s.onExpire) s.onExpire(unit, s);
    }
  }
}
