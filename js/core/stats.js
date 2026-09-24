// 属性系统：基础属性规范化、等级成长、加成汇总、最终属性计算（公式与 LoL 一致）
import { AS_CAP } from '../config.js';

// 加成属性键（装备 stats、Buff stats、bonusStats 通用）
export const BONUS_KEYS = [
  'hp', 'hpPct', 'hpRegen', 'hpRegenPct', 'mana', 'manaRegen', 'manaRegenPct',
  'ad', 'adPct', 'ap', 'apPct', 'armor', 'armorPct', 'mr', 'mrPct',
  'attackSpeed', 'crit', 'critDamage', 'moveSpeed', 'moveSpeedPct',
  'lifeSteal', 'omnivamp', 'abilityHaste', 'lethality', 'armorPenPct', 'magicPen', 'magicPenPct',
  'tenacity', 'healShieldPower', 'attackRange', 'damageReduction', 'grievous',
  'damageDealtReduction', 'slowResist',
];
// 乘法叠加（1 - Π(1 - v)）的键
const MULT_KEYS = new Set(['tenacity', 'damageReduction', 'armorPenPct', 'magicPenPct', 'damageDealtReduction', 'slowResist']);
// 取最大值的键
const MAX_KEYS = new Set(['grievous']);

const BASE_DEFAULTS = {
  hp: 500, hpPerLevel: 0, hpRegen: 0, hpRegenPerLevel: 0,
  mana: 0, manaPerLevel: 0, manaRegen: 0, manaRegenPerLevel: 0, resource: 'mana',
  ad: 50, adPerLevel: 0, as: 0.625, asRatio: undefined, asPerLevel: 0,
  armor: 0, armorPerLevel: 0, mr: 0, mrPerLevel: 0,
  ms: 325, range: 125, radius: 65, windup: 0.3,
  missileSpeed: 0, attackVfx: null, critMult: 1.75,
};

// 规范化基础属性（补全默认值）
export function normalizeBaseStats(bs = {}) {
  const out = { ...BASE_DEFAULTS, ...bs };
  if (out.asRatio == null) out.asRatio = out.as;
  if (out.resource === 'energy') {
    if (!bs.mana) out.mana = 200;
    if (!bs.manaRegen) out.manaRegen = 50;
    out.manaPerLevel = 0; out.manaRegenPerLevel = 0;
  }
  if (out.resource === 'none') { out.mana = 0; out.manaPerLevel = 0; out.manaRegen = 0; out.manaRegenPerLevel = 0; }
  return out;
}

// LoL 成长公式：base + perLevel * (L-1) * (0.7025 + 0.0175 * (L-1))
export function growthFactor(level) {
  const n = Math.max(0, level - 1);
  return n * (0.7025 + 0.0175 * n);
}
export function growth(base, perLevel, level) {
  return base + (perLevel || 0) * growthFactor(level);
}
// 等级带来的额外攻速（小数）
export function levelBonusAS(bs, level) {
  return ((bs.asPerLevel || 0) / 100) * growthFactor(level);
}

// 移速软上限（LoL）
export function softCapMoveSpeed(raw) {
  if (raw > 490) return raw * 0.5 + 230;
  if (raw > 415) return raw * 0.8 + 83;
  if (raw < 220) return Math.max(0, raw) * 0.5 + 110;
  return raw;
}

// —— 加成汇总 ——
function makeAcc() {
  const a = {};
  for (const k of BONUS_KEYS) a[k] = 0;
  a._multInv = {};
  return a;
}
function resetAcc(a) {
  for (const k of BONUS_KEYS) a[k] = 0;
  for (const k of MULT_KEYS) a._multInv[k] = 1;
}
function addInto(acc, src, mult = 1) {
  if (!src) return;
  for (const k in src) {
    const v = src[k];
    if (typeof v !== 'number' || v === 0) continue;
    if (MULT_KEYS.has(k)) {
      // 多个来源乘法叠加
      acc._multInv[k] *= 1 - Math.min(1, v * mult);
    } else if (MAX_KEYS.has(k)) {
      if (v > acc[k]) acc[k] = v;
    } else if (k in acc) {
      acc[k] += v * mult;
    }
  }
}

// 计算最终属性，写入 out（复用对象减少垃圾）
export function computeStats(unit, out = {}) {
  const bs = unit.baseStats;
  const L = unit.level || 1;
  const acc = unit._statAcc || (unit._statAcc = makeAcc());
  resetAcc(acc);
  addInto(acc, unit.bonusStats);
  if (unit.itemStats) addInto(acc, unit.itemStats);
  const buffs = unit.buffs;
  if (buffs) {
    for (let i = 0; i < buffs.length; i++) {
      const b = buffs[i];
      if (b.removed) continue;
      if (b.stats) addInto(acc, b.stats, b.statsPerStack ? b.stacks : 1);
      if (b.statsFn) addInto(acc, b.statsFn(unit, b));
    }
  }
  for (const k of MULT_KEYS) acc[k] = 1 - acc._multInv[k];

  // 生命
  const baseHp = growth(bs.hp, bs.hpPerLevel, L);
  out.maxHp = Math.max(1, (baseHp + acc.hp) * (1 + acc.hpPct));
  out.baseHp = baseHp;
  out.bonusHp = out.maxHp - baseHp;
  out.hpRegen = Math.max(0, (growth(bs.hpRegen, bs.hpRegenPerLevel, L) + acc.hpRegen) * (1 + acc.hpRegenPct) / 5);

  // 资源
  if (bs.resource === 'none') {
    out.maxMana = 0; out.manaRegen = 0;
  } else if (bs.resource === 'energy') {
    out.maxMana = bs.mana + acc.mana;
    out.manaRegen = (bs.manaRegen + acc.manaRegen) * (1 + acc.manaRegenPct) / 5;
  } else {
    out.maxMana = growth(bs.mana, bs.manaPerLevel, L) + acc.mana;
    out.manaRegen = Math.max(0, (growth(bs.manaRegen, bs.manaRegenPerLevel, L) + acc.manaRegen) * (1 + acc.manaRegenPct) / 5);
  }

  // 攻击力 / 法强
  const baseAd = growth(bs.ad, bs.adPerLevel, L);
  out.baseAd = baseAd;
  out.ad = Math.max(0, (baseAd + acc.ad) * (1 + acc.adPct));
  out.bonusAd = out.ad - baseAd;
  out.ap = Math.max(0, acc.ap * (1 + acc.apPct));

  // 护甲 / 魔抗
  const baseArmor = growth(bs.armor, bs.armorPerLevel, L);
  out.baseArmor = baseArmor;
  out.armor = (baseArmor + acc.armor) * (1 + acc.armorPct);
  out.bonusArmor = out.armor - baseArmor;
  const baseMr = growth(bs.mr, bs.mrPerLevel, L);
  out.baseMr = baseMr;
  out.mr = (baseMr + acc.mr) * (1 + acc.mrPct);
  out.bonusMr = out.mr - baseMr;

  // 攻速：as + asRatio * (等级攻速 + Σ攻速)
  out.bonusAS = levelBonusAS(bs, L) + acc.attackSpeed;
  out.attackSpeed = Math.max(0.2, Math.min(AS_CAP, bs.as + bs.asRatio * out.bonusAS));

  out.attackRange = Math.max(0, bs.range + acc.attackRange);

  // 移速（含减速与软上限）
  let slow = unit.strongestSlow ? unit.strongestSlow() : 0;
  if (acc.slowResist > 0) slow *= 1 - acc.slowResist;
  const raw = (bs.ms + acc.moveSpeed) * (1 + acc.moveSpeedPct) * (1 - Math.min(0.99, slow));
  out.moveSpeed = softCapMoveSpeed(raw);
  out.slow = slow;

  out.crit = Math.min(1, Math.max(0, acc.crit));
  out.critMult = (bs.critMult ?? 1.75) + acc.critDamage;
  out.lifeSteal = acc.lifeSteal;
  out.omnivamp = acc.omnivamp;
  out.abilityHaste = acc.abilityHaste;
  out.lethality = acc.lethality;
  out.armorPenPct = Math.min(1, acc.armorPenPct);
  out.magicPen = acc.magicPen;
  out.magicPenPct = Math.min(1, acc.magicPenPct);
  out.tenacity = Math.min(1, acc.tenacity);
  out.healShieldPower = acc.healShieldPower;
  out.damageReduction = Math.min(1, acc.damageReduction);
  out.damageDealtReduction = Math.min(1, acc.damageDealtReduction);
  out.grievous = Math.min(1, acc.grievous);

  // 钩子：英雄/装备可直接修改 stats
  if (unit.hooks && unit.hooks.modifyStats) unit.runHooks('modifyStats', out);
  return out;
}
