// 伤害与治疗：抗性公式、穿透、护盾吸收、吸血、击杀判定
// 抗性伤害系数：r>=0 → 100/(100+r)；r<0 → 2 - 100/(100-r)
export function resistMultiplier(resist) {
  if (resist >= 0) return 100 / (100 + resist);
  return 2 - 100 / (100 - resist);
}

// 有效抗性（LoL 顺序：百分比穿透 → 固定穿透；抗性为负时穿透不生效）
export function effectiveResist(resist, pctPen = 0, flatPen = 0) {
  if (resist <= 0) return resist;
  const r = resist * (1 - pctPen) - flatPen;
  return Math.max(0, r);
}

// 计算减免后伤害（不含护盾/伤害减免）
export function mitigate(source, target, amount, type) {
  if (type === 'true' || !target || !target.stats) return amount;
  const ss = source && source.stats;
  if (type === 'physical') {
    const r = effectiveResist(target.stats.armor, ss ? ss.armorPenPct : 0, ss ? ss.lethality : 0);
    return amount * resistMultiplier(r);
  }
  if (type === 'magic') {
    const r = effectiveResist(target.stats.mr, ss ? ss.magicPenPct : 0, ss ? ss.magicPen : 0);
    return amount * resistMultiplier(r);
  }
  return amount;
}

// 伤害归属的英雄（英雄本身或宠物主人）
export function creditChampion(source) {
  if (!source) return null;
  if (source.type === 'champion') return source;
  if (source.owner && source.owner.type === 'champion') return source.owner;
  return null;
}

// 护盾吸收：先类型专属，再通用；同类按到期先后
export function absorbWithShields(target, amount, type) {
  const shields = target.shields;
  if (!shields || shields.length === 0 || amount <= 0) return 0;
  let remaining = amount;
  let absorbed = 0;
  const order = shields
    .filter((s) => s.amount > 0 && (s.type === type || s.type === 'all'))
    .sort((a, b) => {
      const ta = a.type === 'all' ? 1 : 0, tb = b.type === 'all' ? 1 : 0;
      if (ta !== tb) return ta - tb;
      return a.expiresAt - b.expiresAt;
    });
  for (const s of order) {
    if (remaining <= 0) break;
    const take = Math.min(s.amount, remaining);
    s.amount -= take;
    remaining -= take;
    absorbed += take;
    if (s.amount <= 1e-6) {
      s.amount = 0;
      s.broken = true;
    }
  }
  if (absorbed > 0) {
    // 移除已破碎的护盾
    for (let i = shields.length - 1; i >= 0; i--) {
      const s = shields[i];
      if (s.broken) {
        shields.splice(i, 1);
        if (s.onBreak) s.onBreak(target, s);
      }
    }
  }
  return absorbed;
}

// 伤害主流程（由 game.dealDamage 调用）
export function applyDamage(game, source, target, amount, type = 'physical', opts = {}) {
  if (!target || !target.alive || target.removed) return 0;
  if (!(amount > 0)) return 0; // 过滤 0/负数/NaN
  if (target.invulnerable) return 0;

  // 守卫：每次普攻/防御塔攻击固定 1 点，技能无效
  if (target.type === 'ward') {
    if (!(opts.isBasicAttack || opts.isTurret)) return 0;
    amount = 1; type = 'true';
    target.hp -= 1;
    target.lastDamagedAt = game.time;
    const killed = target.hp <= 0;
    game.events.emit('damage', { source, target, amount: 1, absorbed: 0, type, isCrit: false, isBasicAttack: !!opts.isBasicAttack, isAbility: false, isDot: false, isOnHit: false, spell: opts.spell || null, killed });
    if (killed) target.die(source);
    return 1;
  }

  const ctx = {
    source, target, amount, type, raw: amount,
    isBasicAttack: !!opts.isBasicAttack, isAbility: !!opts.isAbility, isCrit: !!opts.isCrit,
    isDot: !!opts.isDot, isOnHit: !!opts.isOnHit, isAoE: !!opts.isAoE, spell: opts.spell || null,
    noLifesteal: !!opts.noLifesteal, isTurret: !!opts.isTurret, isPet: !!opts.isPet,
    cancel: false, dealt: 0, absorbed: 0,
  };
  if (source && source.runHooks) source.runHooks('beforeDealDamage', ctx);
  target.runHooks('beforeTakeDamage', ctx);
  if (ctx.cancel || !(ctx.amount > 0) || !target.alive) return 0;

  // 来源的「造成伤害降低」（如虚弱）
  let dmg = ctx.amount;
  const ss = source && source.stats;
  if (ss && ss.damageDealtReduction > 0) dmg *= 1 - ss.damageDealtReduction;
  dmg = mitigate(source, target, dmg, ctx.type);
  const dr = target.stats ? target.stats.damageReduction : 0;
  if (dr > 0) dmg *= 1 - dr;
  if (!(dmg > 0)) return 0;

  const absorbed = absorbWithShields(target, dmg, ctx.type);
  const hpLoss = dmg - absorbed;
  target.hp -= hpLoss;
  ctx.dealt = dmg;
  ctx.absorbed = absorbed;

  const now = game.time;
  target.lastDamagedAt = now;
  target.lastCombatAt = now;
  if (source) source.lastCombatAt = now;

  // 吸血：生命偷取只对普攻；全能吸血对所有伤害（宠物伤害除外）
  if (source && source.alive && ss && !ctx.noLifesteal && !ctx.isPet && source.type !== 'pet') {
    let heal = 0;
    if (ctx.isBasicAttack && ss.lifeSteal > 0) heal += dmg * ss.lifeSteal;
    if (ss.omnivamp > 0) heal += dmg * ss.omnivamp;
    if (heal > 0 && target.type !== 'ward' && target.type !== 'turret' && target.type !== 'inhibitor' && target.type !== 'nexus') {
      game.heal(source, source, heal, { lifesteal: true, silent: true, noPower: true });
    }
  }

  // 助攻记录与统计
  const credit = creditChampion(source);
  if (credit && credit.team !== target.team) {
    if (target.damageLog) target.damageLog.set(credit.championId, now);
    if (target.type === 'champion') {
      credit.damageToChampions = (credit.damageToChampions || 0) + dmg;
      target.lastChampionDamageAt = now;
      target.lastChampionDamager = credit;
    }
  }
  if (target.type === 'champion') target.damageTaken = (target.damageTaken || 0) + dmg;

  // 在草丛中攻击会短暂暴露
  if (source && (source.type === 'champion' || source.type === 'pet') && game.nav && game.nav.brushAt) {
    if (game.nav.brushAt(source.x, source.y) >= 0) source.revealedUntil = Math.max(source.revealedUntil, now + 1);
  }

  // 睡眠：受到伤害醒来
  if (target.ccs && target.ccs.length) {
    for (let i = target.ccs.length - 1; i >= 0; i--) if (target.ccs[i].type === 'sleep') target.ccs.splice(i, 1);
  }
  // 回城等引导：受伤打断
  if (target.channel && target.channel.interruptOnDamage) target.interruptChannel('damage');

  const killed = target.hp <= 0;
  game.events.emit('damage', {
    source, target, amount: dmg, absorbed, type: ctx.type, isCrit: ctx.isCrit, isBasicAttack: ctx.isBasicAttack,
    isAbility: ctx.isAbility, isDot: ctx.isDot, isOnHit: ctx.isOnHit, spell: ctx.spell, killed,
  });
  if (source && source.runHooks) source.runHooks('afterDealDamage', ctx);
  target.runHooks('afterTakeDamage', ctx);

  if (target.alive && target.hp <= 0) {
    target.hp = 0;
    target.die(source);
  }
  return dmg;
}

// 治疗：英雄来源乘治疗强度；受重伤影响；不超过上限
export function applyHeal(game, source, target, amount, opts = {}) {
  if (!target || !target.alive || !(amount > 0)) return 0;
  let amt = amount;
  if (source && source.type === 'champion' && source.stats && !opts.noPower) amt *= 1 + (source.stats.healShieldPower || 0);
  if (target.stats && target.stats.grievous > 0) amt *= 1 - target.stats.grievous;
  const max = target.stats ? target.stats.maxHp : target.hp;
  const actual = Math.max(0, Math.min(amt, max - target.hp));
  if (actual <= 0) return 0;
  target.hp += actual;
  const credit = creditChampion(source);
  if (credit) credit.healingDone = (credit.healingDone || 0) + actual;
  if (!opts.silent) game.events.emit('heal', { source, target, amount: actual });
  return actual;
}

