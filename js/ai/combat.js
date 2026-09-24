// AI 战斗估算：普攻/技能伤害预估、有效生命、连招击杀判断、团战战力（兰彻斯特）与目标评分
import { mitigate } from '../core/damage.js';

const ROLE_PRIORITY = { adc: 1.35, mid: 1.25, jungle: 1.0, top: 0.95, support: 0.85 };
const HINT_CACHE = new WeakMap();

// 技能提示（缺失时按 targeting 推断）
export function abilityHint(ab) {
  const def = ab.def || {};
  const h = def.ai || {};
  const cached = HINT_CACHE.get(ab);
  if (cached && cached.src === h && cached.def === def) return cached.hint;
  const tg = def.targeting || 'self';
  const filt = def.targetFilter || 'enemy';
  let kind = h.kind;
  if (!kind) {
    if (tg === 'unit') kind = filt === 'ally' || filt === 'allyChampion' ? 'shield' : 'nuke';
    else if (tg === 'point' || tg === 'direction') kind = 'nuke';
    else kind = 'selfbuff';
  }
  const ind = def.indicator || {};
  const out = {
    kind,
    targeting: tg,
    filter: filt,
    range: h.range ?? null,
    radius: h.radius ?? ind.radius ?? null,
    speed: h.speed ?? 0,
    width: h.width ?? (ind.type === 'line' ? (ind.width || 120) / 2 : 0),
    delay: h.delay ?? null,
    minTargets: h.minTargets ?? 1,
    farm: !!h.farm || kind === 'farm',
    collision: h.collision,
    when: typeof h.when === 'function' ? h.when : null,
    custom: typeof h.custom === 'function' ? h.custom : null,
    damage: typeof h.damage === 'function' ? h.damage : null,
    raw: h,
    indicatorLength: ind.length || 0,
  };
  HINT_CACHE.set(ab, { src: h, def, hint: out });
  return out;
}

// 技能实际射程（提示 > 定义 > 指示器）
export function abilityRange(ab, hint) {
  let r = hint.range;
  if (r == null || !(r > 0)) r = ab.range;
  if (!(r > 0)) r = hint.indicatorLength || 0;
  return r || 0;
}

// 英雄主要伤害类型
export function damageTypeOf(champ) {
  const s = champ.stats;
  if (!s) return 'physical';
  if (s.ap > (s.bonusAd || 0) * 0.9 + 10) return 'magic';
  const tags = champ.def?.tags || [];
  if (s.ap <= 10 && (s.bonusAd || 0) <= 10 && tags.some((t) => t === '法师' || t === '辅助')) return 'magic';
  return 'physical';
}

// 单次普攻期望伤害（含暴击期望）
export function autoDamage(src, tgt) {
  const s = src.stats;
  if (!s) return 0;
  const crit = Math.min(1, s.crit || 0);
  const raw = s.ad * (1 + crit * ((s.critMult || 1.75) - 1));
  return mitigate(src, tgt, raw, 'physical');
}

// 普攻秒伤
export function autoDps(src, tgt) {
  return autoDamage(src, tgt) * Math.min(2.5, src.stats.attackSpeed || 0.625);
}

// 单个技能对目标的预估伤害（减免后）
export function abilityDamage(champ, ab, target) {
  if (!ab || ab.rank <= 0) return 0;
  const hint = abilityHint(ab);
  if (hint.damage) {
    try { const v = hint.damage(champ, target, ab.rank); if (Number.isFinite(v)) return Math.max(0, v); } catch { /* 忽略提示错误 */ }
  }
  const s = champ.stats;
  const r = ab.rank;
  const isR = ab.slot === 'R';
  let base = isR ? [0, 175, 275, 375][Math.min(3, r)] : 35 + 35 * r;
  let ratio = isR ? s.ap * 0.85 + (s.bonusAd || 0) * 0.9 : s.ap * 0.6 + (s.bonusAd || 0) * 0.7;
  const mult = { nuke: 1, cc: 0.65, execute: 1.1, aoe: 0.9, gapclose: 0.6, selfbuff: 0.45, toggle: 0.5, global: 1, farm: 0.6, shield: 0, heal: 0, escape: 0.15 }[hint.kind] ?? 0.6;
  if (hint.kind === 'selfbuff' || hint.kind === 'toggle') { base *= 0.8; ratio += s.ad * 0.25; }
  const raw = (base + ratio) * mult;
  return target ? mitigate(champ, target, raw, damageTypeOf(champ)) : raw;
}

// 引燃等真实伤害
function igniteDamage(champ) {
  for (const k of ['D', 'F']) {
    const st = champ.summoners?.[k];
    if (st && st.id === 'ignite' && st.ready) return 70 + 20 * champ.level;
  }
  return 0;
}

// 有效生命（对某类型伤害）
export function effectiveHp(target, type = 'physical', src = null) {
  const hp = target.hp + (target.totalShield || 0);
  if (type === 'true') return hp;
  const m = mitigate(src, target, 100, type) / 100;
  return m > 0 ? hp / m : hp * 10;
}

// 短时间窗口内（秒）对目标的连招伤害；opts.ready: 只算就绪技能
export function comboDamage(champ, target, { window = 3, includeR = true, autos = null } = {}) {
  let total = 0;
  let executeKill = false;
  for (const slot of ['Q', 'W', 'E', 'R']) {
    const ab = champ.abilities?.[slot];
    if (!ab || ab.rank <= 0) continue;
    if (slot === 'R' && !includeR) continue;
    if (!ab.ready && !(ab.cdRemaining < window * 0.5)) continue;
    if (!champ._canPay?.(ab.costType, ab.cost)) continue;
    const hint = abilityHint(ab);
    if (hint.kind === 'execute' && hint.when && target) {
      try { if (hint.when(champ, target, champ.game, champ.controller)) executeKill = true; } catch { /* 忽略 */ }
    }
    total += abilityDamage(champ, ab, target);
  }
  const as = Math.min(2.5, champ.stats.attackSpeed || 0.625);
  const nAutos = autos ?? Math.max(1, Math.floor(window * as));
  total += autoDamage(champ, target) * nAutos;
  total += igniteDamage(champ) * 0.85;
  if (executeKill) total = Math.max(total, (target.hp + (target.totalShield || 0)) * 1.2);
  return total;
}

// 敌人对我的威胁（按其可见属性估算的爆发）；cd 为已知冷却估计 Map(slot → readyAt)
export function threatDamage(enemy, me, { window = 3, cd = null, now = 0 } = {}) {
  let total = 0;
  for (const slot of ['Q', 'W', 'E', 'R']) {
    const ab = enemy.abilities?.[slot];
    if (!ab || ab.rank <= 0) continue;
    if (cd && cd[slot] && cd[slot] > now + window * 0.5) continue;
    total += abilityDamage(enemy, ab, me);
  }
  const as = Math.min(2.5, enemy.stats.attackSpeed || 0.625);
  total += autoDamage(enemy, me) * Math.max(1, Math.floor(window * as));
  return total;
}

// 单位战力：有效生命 × 输出
function unitDps(u, vs) {
  let dps = u.stats ? autoDps(u, vs || u) : 0;
  if (u.type === 'champion') {
    // 技能折算为持续输出
    let burst = 0;
    for (const slot of ['Q', 'W', 'E', 'R']) {
      const ab = u.abilities?.[slot];
      if (ab && ab.rank > 0 && (ab.ready || ab.cdRemaining < 2)) burst += abilityDamage(u, ab, vs);
    }
    dps += burst / 4;
  }
  return dps;
}
function unitEhp(u) {
  const s = u.stats;
  const hp = u.hp + (u.totalShield || 0);
  return hp * (1 + ((s.armor || 0) + (s.mr || 0)) / 220);
}

// 群体战力（Σ有效生命 × Σ输出）；vs 为参照敌人（用于减免计算）
export function groupStrength(units, vs) {
  let ehp = 0, dps = 0;
  for (const u of units) {
    if (!u.alive) continue;
    ehp += unitEhp(u);
    dps += unitDps(u, vs);
  }
  return { ehp, dps, power: ehp * dps };
}

// 目标评分：越低有效生命、越重要、越近越好
export function targetScore(me, e, { current = null, range = 0 } = {}) {
  const type = damageTypeOf(me);
  const ehp = Math.max(50, effectiveHp(e, type, me));
  const d = me.distTo(e);
  const pri = ROLE_PRIORITY[e.role] ?? 1;
  let s = (1000 / ehp) * pri;
  if (d <= me.stats.attackRange + me.radius + e.radius + 30) s *= 1.45;
  else if (range > 0 && d > range) s *= Math.max(0.25, 1 - (d - range) / 1200);
  if (e.isCCd?.()) s *= 1.25;
  if (e === current) s *= 1.3;
  s *= Math.max(0.3, 1 - d / 3000);
  return s;
}
