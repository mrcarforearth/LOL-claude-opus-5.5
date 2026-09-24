// 英雄：德莱厄斯（诺克萨斯之手）—— 出血叠层与诺克萨斯之力、大杀四方（刀刃/斧柄）、致残打击、无情铁手、诺克萨斯断头台（击杀重置）
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { clamp, norm } from '../core/math.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本） ——
const BLEED_DUR = 5;                 // 出血持续时间
const BLEED_TICK = 1.25;             // 出血结算间隔（5 秒内 4 次）
const BLEED_MAX = 5;                 // 最大层数
const BLEED_BAD = 0.3;               // 每层 +30% 额外攻击力
const BLEED_MONSTER = 3;             // 出血对野怪造成 300% 伤害
const MIGHT_DUR = 5;                 // 诺克萨斯之力持续时间
const MIGHT_AD = [30, 35, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 230]; // 按英雄等级

const Q_BASE = [50, 80, 110, 140, 170];
const Q_AD = [1.0, 1.1, 1.2, 1.3, 1.4];
const Q_COST = [25, 30, 35, 40, 45];
const Q_CD = [9, 8, 7, 6, 5];
const Q_DELAY = 0.75;                // 蓄力时间
const Q_INNER = 205;                 // 斧柄半径
const Q_OUTER = 425;                 // 刀刃外沿半径
const Q_HANDLE = 0.35;               // 斧柄伤害比例
const Q_HEAL = 0.13;                 // 每命中一名英雄/大型野怪回复 13% 已损失生命
const Q_HEAL_MAX = 3;

const W_BONUS = [0.4, 0.45, 0.5, 0.55, 0.6]; // 额外攻击力比例（总计 140%~160%）
const W_CD = [7, 6.5, 6, 5.5, 5];
const W_COST = 30;
const W_SLOW = 0.9;
const W_SLOW_DUR = 1;
const W_WINDOW = 4;

const E_PEN = [0.2, 0.25, 0.3, 0.35, 0.4];   // 被动护甲穿透
const E_CD = [24, 22, 20, 18, 16];
const E_COST = 45;
const E_RANGE = 535;
const E_ANGLE = 50;
const E_SLOW = 0.4;
const E_SLOW_DUR = 1;
const E_PULL_TIME = 0.25;

const R_BASE = [125, 250, 375];
const R_BAD = 0.75;
const R_PER_STACK = 0.2;             // 每层出血 +20%（最多 +100%）
const R_RANGE = 460;
const R_CD = [100, 90, 80];
const R_COST = [100, 100, 0];
const R_RESET = 20;                  // 击杀后可再次施放的时间
const R_LEAP = 0.35;                 // 跃起到落斧的时间

const RED = 0xd8342a;
const BLOOD = 0xa3120e;
const EMBER = 0xff6a3a;

const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('血', '#c23a2c', '#2a0505'),
  Q: icon('杀', '#e8653e', '#4a0c08'),
  W: icon('残', '#c4582e', '#3a0e06'),
  E: icon('铁', '#9a8e96', '#2a1414'),
  R: icon('斩', '#ff5a3a', '#5a0000'),
  M: icon('力', '#ff7a4a', '#6a0a0a'),
};

// —— 公式 ——
export function mightAd(level) { return MIGHT_AD[clamp(Math.floor(level || 1), 1, 18) - 1]; }
// 每层出血在 5 秒内造成的物理伤害
export function bleedPerStack(champ) {
  const level = champ?.level || 1;
  return 13 + (clamp(level, 1, 18) - 1) + BLEED_BAD * (champ?.stats?.bonusAd || 0);
}
export function dariusQDamage(champ, rank) { return rv(Q_BASE, rank) + rv(Q_AD, rank) * (champ?.stats?.ad || 0); }
export function dariusRDamage(champ, target, rank) {
  if (!champ || rank <= 0) return 0;
  const stacks = target ? Math.min(BLEED_MAX, target.buffStacks?.('darius_bleed') || 0) : 0;
  return (rv(R_BASE, rank) + R_BAD * champ.stats.bonusAd) * (1 + R_PER_STACK * stacks);
}

function bleedable(u) {
  return !!u && u.alive && !u.removed && (u.type === 'champion' || u.type === 'minion' || u.type === 'monster' || u.type === 'pet');
}

// 出血结算一次
function bleedTick(champ, u, buff) {
  const perTick = (bleedPerStack(champ) * buff.stacks) / (BLEED_DUR / BLEED_TICK);
  const mult = u.type === 'monster' ? BLEED_MONSTER : 1;
  champ.game.dealDamage(champ, u, perTick * mult, 'physical', { isDot: true, spell: 'darius_passive' });
}

// 诺克萨斯之力：5 秒 +攻击力，攻击与技能直接叠满出血
function triggerMight(champ) {
  const game = champ.game;
  const fresh = !champ.hasBuff('darius_might');
  champ.addBuff({
    id: 'darius_might', name: '诺克萨斯之力', desc: '攻击力大幅提升，普攻与技能直接叠满出血', icon: ICONS.M, source: champ,
    duration: MIGHT_DUR, statsFn: (u) => ({ ad: mightAd(u.level) }),
    onApply: (u) => { u.modelState.noxianMight = true; },
    onRemove: (u) => { u.modelState.noxianMight = false; },
  });
  game.fx.custom('darius_might', { unit: champ, duration: MIGHT_DUR, fresh });
}

// 施加出血（返回当前层数）；诺克萨斯之力期间直接叠满；对英雄叠满 5 层时触发诺克萨斯之力
export function applyHemorrhage(champ, target, stacks = 1) {
  if (!bleedable(target) || target.team === champ.team) return 0;
  const might = champ.hasBuff('darius_might');
  const b = target.addBuff({
    id: 'darius_bleed', name: '出血', desc: '每 1.25 秒受到物理伤害（可叠加 5 层）', icon: ICONS.P, source: champ,
    duration: BLEED_DUR, stacks: might ? BLEED_MAX : stacks, maxStacks: BLEED_MAX, refresh: 'stack', isDebuff: true,
    tickInterval: BLEED_TICK,
    onInterval: (u, buff) => bleedTick(champ, u, buff),
  });
  champ.game.fx.custom('darius_bleed', { unit: target, stacks: b.stacks, duration: BLEED_DUR });
  if (b.stacks >= BLEED_MAX && target.type === 'champion') triggerMight(champ);
  return b.stacks;
}

// Q 挥斧结算
function decimate(champ, rank) {
  const game = champ.game;
  const full = dariusQDamage(champ, rank);
  const hits = game.queryUnits({ x: champ.x, y: champ.y, radius: Q_OUTER, enemyOf: champ }).filter((u) => !u.untargetable);
  let healHits = 0;
  let bladeHits = 0;
  for (const u of hits) {
    const blade = Math.hypot(u.x - champ.x, u.y - champ.y) > Q_INNER;
    game.dealDamage(champ, u, blade ? full : full * Q_HANDLE, 'physical', { isAbility: true, isAoE: true, spell: blade ? 'darius_q' : 'darius_q_handle' });
    if (!blade) continue;
    bladeHits++;
    if (u.type === 'champion' || (u.type === 'monster' && u.large !== false)) healHits++;
    if (u.alive) applyHemorrhage(champ, u, 1);
  }
  if (healHits > 0 && champ.alive) {
    const missing = Math.max(0, champ.maxHp - champ.hp);
    game.heal(champ, champ, missing * Q_HEAL * Math.min(Q_HEAL_MAX, healHits), { spell: 'darius_q' });
  }
  game.fx.custom('darius_q_swing', { unit: champ, x: champ.x, y: champ.y, inner: Q_INNER, outer: Q_OUTER, bladeHits, heal: healHits > 0 });
  game.after(0.25, () => { if (!champ.hasBuff('darius_q_charge')) champ.modelState.axeSpin = false; });
}

// R 落斧结算
function guillotine(champ, t, rank, ab) {
  const game = champ.game;
  if (!champ.alive || !t || !t.alive || t.removed || t.untargetable) return;
  const stacks = Math.min(BLEED_MAX, t.buffStacks('darius_bleed'));
  const dmg = dariusRDamage(champ, t, rank);
  game.dealDamage(champ, t, dmg, 'true', { isAbility: true, spell: 'darius_r' });
  const killed = !t.alive;
  game.fx.custom('darius_r_impact', { x: t.x, y: t.y, target: t, stacks, killed });
  if (killed) {
    if (t.type === 'champion') {
      triggerMight(champ);
      // 击杀重置：20 秒内可再次施放，超时则按原冷却继续
      ab.resetCooldown();
      champ.addBuff({
        id: 'darius_r_reset', name: '诺克萨斯断头台', desc: '击杀重置：可再次施放诺克萨斯断头台', icon: ICONS.R, source: champ,
        duration: R_RESET, persistOnDeath: true,
        onExpire: () => {
          const used = game.time - (ab.state.lastCastAt ?? game.time);
          ab.startCooldown(Math.max(0.5, ab.cooldownFor() - used));
        },
      });
    }
  } else {
    applyHemorrhage(champ, t, 1);
  }
}

// —— AI 辅助（可选链保护：AI 未实现对应接口时回退到自行查询） ——
function aiEnemies(ai, champ, radius) {
  const list = ai?.visibleEnemies?.(radius);
  if (Array.isArray(list)) return list.filter((e) => e && e.alive && e.type === 'champion' && champ.distTo(e) <= radius + (e.radius || 0));
  return champ.game.queryUnits({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
}
function aiPredict(ai, unit, delay) {
  const p = ai?.predict?.(unit, delay);
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : predictPosition(unit, delay);
}
function aiUnderTurret(ai, champ, x, y) {
  const r = ai?.isUnderEnemyTurret?.(x, y);
  if (typeof r === 'boolean') return r;
  return champ.game.structures.some((s) => s.type === 'turret' && s.alive && s.team !== champ.team && Math.hypot(s.x - x, s.y - y) < 800);
}
// AI 施法场景（fight/harass/farm/push/jungle/escape/peel/idle）；AI 未提供时返回 null（不限制）
function aiContext(ai) { return typeof ai?.castContext === 'string' ? ai.castContext : null; }
const FARM_CTX = new Set(['farm', 'push', 'jungle']);
function aiCast(ai, champ, slot, { target = null, x, y } = {}) {
  const ab = champ.abilities[slot];
  const tg = ab?.def?.targeting || 'self';
  let r;
  try {
    if (tg === 'unit' && target && typeof ai?.castOn === 'function') r = ai.castOn(slot, target);
    else if ((tg === 'self' || tg === 'none') && typeof ai?.castSelf === 'function') r = ai.castSelf(slot);
    else if (x != null && typeof ai?.castAt === 'function' && ai.castAt.length <= 4) r = ai.castAt(slot, x, y);
  } catch (err) {
    r = undefined;
  }
  if (r === undefined || r === null) r = champ.castAbility(slot, { target, x, y });
  return r === true || !!r?.ok;
}

export default {
  id: 'darius',
  name: '德莱厄斯',
  title: '诺克萨斯之手',
  roles: ['top'],
  tags: ['战士', '坦克'],
  difficulty: 2,
  lore: '诺克萨斯最令人畏惧的将军，以一柄巨斧斩断一切敢于挑战帝国意志的敌人。',
  baseStats: {
    hp: 652, hpPerLevel: 114, hpRegen: 10, hpRegenPerLevel: 0.95,
    mana: 263, manaPerLevel: 58, manaRegen: 6.6, manaRegenPerLevel: 0.35, resource: 'mana',
    ad: 64, adPerLevel: 5, as: 0.625, asRatio: 0.625, asPerLevel: 1,
    armor: 39, armorPerLevel: 5.2, mr: 32, mrPerLevel: 2.05,
    ms: 340, range: 175, radius: 65, windup: 0.3, missileSpeed: 0, critMult: 1.75,
  },
  model: { primary: 0x5a1a1a, secondary: 0x2a2a2e, accent: 0xd8342a },
  portrait: { bg: ['#8a2a22', '#1a0808'], glyph: '德' },

  // —— 被动：出血 ——
  passive: {
    id: 'darius_passive',
    name: '出血',
    icon: ICONS.P,
    desc: (champ) => {
      const per = bleedPerStack(champ);
      return `德莱厄斯的普攻和伤害技能会使敌人出血，在 ${BLEED_DUR} 秒内造成 ${fmt(per)}（${fmt(per - BLEED_BAD * (champ?.stats?.bonusAd || 0))} +30% 额外攻击力）点物理伤害，最多叠加 ${BLEED_MAX} 层。出血对野怪造成 300% 伤害。\n`
        + `当一名敌方英雄的出血叠满 ${BLEED_MAX} 层，或诺克萨斯断头台击杀敌方英雄时，德莱厄斯获得「诺克萨斯之力」，持续 ${MIGHT_DUR} 秒：`
        + `获得 ${mightAd(champ?.level || 1)} 点攻击力（30~230，随等级提升），并且普攻与技能会直接叠满出血。`;
    },
    init(champ) {
      champ.addHook('afterHit', (target) => {
        if (bleedable(target) && target.team !== champ.team) applyHemorrhage(champ, target, 1);
      });
    },
  },

  abilities: {
    // —— Q：大杀四方 ——
    Q: {
      id: 'darius_q',
      name: '大杀四方',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const full = dariusQDamage(champ, r);
        return `德莱厄斯蓄力 ${Q_DELAY} 秒后抡起巨斧横扫一圈（蓄力时可以移动但不能普攻）。\n`
          + `被斧刃（外圈 ${Q_INNER}~${Q_OUTER} 码）命中的敌人受到 ${fmt(full)}（${rv(Q_BASE, r)} +${pct(rv(Q_AD, r))} 攻击力）点物理伤害并叠加出血；`
          + `被斧柄（内圈）命中的敌人只受到 ${fmt(full * Q_HANDLE)}（${pct(Q_HANDLE)}）点伤害，不叠加出血。\n`
          + `每用斧刃命中一名敌方英雄或大型野怪，德莱厄斯回复 ${pct(Q_HEAL)} 已损失生命值（最多 ${pct(Q_HEAL * Q_HEAL_MAX)}）。\n受到定身类控制会打断蓄力。`;
      },
      cooldown: Q_CD,
      cost: Q_COST,
      range: Q_OUTER,
      targeting: 'self',
      indicator: { type: 'self', radius: Q_OUTER, inner: Q_INNER },
      castTime: 0,
      lockMovement: false,
      sfx: 'spin',
      cast(champ, ctx) {
        const game = champ.game;
        champ.modelState.axeSpin = true;
        champ.attackState = null;
        game.fx.custom('darius_q_windup', { unit: champ, duration: Q_DELAY, inner: Q_INNER, outer: Q_OUTER });
        champ.addBuff({
          id: 'darius_q_charge', name: '大杀四方', desc: '蓄力中：不能普攻', icon: ICONS.Q, source: champ, hidden: true,
          duration: Q_DELAY, refresh: 'replace', disableAttack: true, data: { rank: ctx.rank, done: false },
          // 被眩晕/击飞等打断蓄力
          onTick: (u, b) => { if (u.isHardCCd()) u.removeBuff(b); },
          onExpire: (u, b) => { b.data.done = true; decimate(u, b.data.rank); },
          onRemove: (u, b) => { if (!b.data.done) u.modelState.axeSpin = false; },
        });
      },
      ai: {
        kind: 'aoe', range: Q_OUTER, radius: Q_OUTER, delay: Q_DELAY, farm: true, minTargets: 1,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, dariusQDamage(champ, rank), 'physical') : dariusQDamage(champ, rank)),
        // 预判 0.75 秒后敌方英雄是否位于斧刃区；清线/打野时斧刃区内 ≥3 个小兵或有大型野怪
        custom: (champ, ab, ai, game) => {
          if (champ.hasBuff('darius_q_charge') || !ab.ready || !champ._canPay(ab.costType, ab.cost)) return false;
          const ctx = aiContext(ai);
          if (ctx === 'idle') return false;
          if (!FARM_CTX.has(ctx)) {
            let blade = 0, handle = 0;
            for (const e of aiEnemies(ai, champ, Q_OUTER + 350)) {
              const p = aiPredict(ai, e, Q_DELAY * 0.8);
              const d = Math.hypot(p.x - champ.x, p.y - champ.y);
              if (d > Q_INNER + 25 && d < Q_OUTER + e.radius * 0.4) blade++;
              else if (d <= Q_INNER + 25) handle++;
            }
            if (blade > 0 && (blade >= handle || champ.hp / champ.maxHp < 0.5)) return aiCast(ai, champ, 'Q');
            if (blade + handle > 0 || ctx) return false;
          }
          // 清线 / 打野
          const manaOk = champ.mana / Math.max(1, champ.maxMana) > (ctx === 'jungle' ? 0.3 : 0.5);
          if (!manaOk || aiUnderTurret(ai, champ, champ.x, champ.y)) return false;
          const units = game.queryUnits({ x: champ.x, y: champ.y, radius: Q_OUTER, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'] });
          const inBlade = units.filter((u) => Math.hypot(u.x - champ.x, u.y - champ.y) > Q_INNER + 20).length;
          const bigMonster = units.some((u) => u.type === 'monster' && u.large !== false && Math.hypot(u.x - champ.x, u.y - champ.y) > Q_INNER + 20);
          if (inBlade >= 3 || bigMonster) return aiCast(ai, champ, 'Q');
          return false;
        },
      },
    },

    // —— W：致残打击 ——
    W: {
      id: 'darius_w',
      name: '致残打击',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const total = (1 + rv(W_BONUS, r)) * (champ?.stats?.ad || 0);
        return `德莱厄斯的下一次普攻（${W_WINDOW} 秒内）造成 ${fmt(total)}（${pct(1 + rv(W_BONUS, r))} 攻击力）点物理伤害，并使目标减速 ${pct(W_SLOW)}，持续 ${W_SLOW_DUR} 秒。\n`
          + `该技能会重置普攻计时。如果这次普攻击杀了目标，返还法力消耗和 50% 冷却时间。`;
      },
      cooldown: W_CD,
      cost: [W_COST, W_COST, W_COST, W_COST, W_COST],
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: 175 },
      castTime: 0,
      lockMovement: false,
      sfx: 'buff',
      onLearn(champ, ab) {
        champ.addHook('onHit', (target, hit) => {
          const b = champ.getBuff('darius_w');
          if (!b) return;
          hit.damage += rv(W_BONUS, b.data.rank) * champ.stats.ad;
          hit.dariusW = b.data.rank;
          champ.removeBuff(b);
        });
        champ.addHook('afterHit', (target, hit) => {
          if (!hit.dariusW) return;
          const game = champ.game;
          if (target.alive) target.slow(W_SLOW, W_SLOW_DUR, champ);
          game.fx.custom('darius_w_strike', { unit: champ, target, x: target.x, y: target.y, killed: !target.alive });
          // 击杀：返还法力与 50% 冷却
          if (!target.alive) {
            champ.mana = Math.min(champ.maxMana, champ.mana + W_COST);
            ab.reduceCooldown(ab.cdDuration * 0.5);
          }
        });
      },
      cast(champ, ctx) {
        champ.addBuff({
          id: 'darius_w', name: '致残打击', desc: '下次普攻造成额外伤害并使目标大幅减速', icon: ICONS.W, source: champ,
          duration: W_WINDOW, refresh: 'replace', data: { rank: ctx.rank },
          onApply: (u) => { u.modelState.axeGlow = true; },
          onRemove: (u) => { u.modelState.axeGlow = false; },
        });
        champ.resetAttack();
        champ.game.fx.attach({ unit: champ, kind: 'weaponGlow', color: EMBER, duration: W_WINDOW });
      },
      ai: {
        kind: 'selfbuff', range: 250, farm: false,
        damage: (champ, target, rank) => {
          const raw = rv(W_BONUS, rank) * champ.stats.ad;
          return target ? mitigate(champ, target, raw, 'physical') : raw;
        },
        // 在普攻距离内、刚打出一次普攻后使用（重置普攻）
        when: (champ, target) => !!target && target.alive && champ.inAttackRange(target, 40) && !champ.hasBuff('darius_q_charge')
          && (target.type === 'champion' || target.hp < champ.stats.ad * (1 + rv(W_BONUS, champ.abilities.W.rank)) * 0.9),
      },
    },

    // —— E：无情铁手 ——
    E: {
      id: 'darius_e',
      name: '无情铁手',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `被动：德莱厄斯获得 ${pct(rv(E_PEN, r))} 护甲穿透。\n`
          + `主动：德莱厄斯挥动斧钩，将前方 ${E_RANGE} 码、${E_ANGLE}° 扇形范围内的所有敌人拉到身前，并使其减速 ${pct(E_SLOW)}，持续 ${E_SLOW_DUR} 秒。`;
      },
      cooldown: E_CD,
      cost: [E_COST, E_COST, E_COST, E_COST, E_COST],
      range: E_RANGE,
      targeting: 'direction',
      indicator: { type: 'cone', angle: E_ANGLE, length: E_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'chain',
      onLearn(champ) {
        champ.addBuff({
          id: 'darius_e_pen', name: '无情铁手', hidden: true, duration: Infinity, persistOnDeath: true,
          statsFn: (u) => ({ armorPenPct: rv(E_PEN, u.abilities.E.rank) }),
        });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const hits = game.queryCone({ x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, angle: E_ANGLE, range: E_RANGE, enemyOf: champ })
          .filter((u) => !u.untargetable);
        const pulled = [];
        for (const u of hits) {
          const d = champ.distTo(u);
          const stop = champ.radius + u.radius + 20;
          let extra = 0;
          if (d > stop + 5) {
            const dir = norm(u.x - champ.x, u.y - champ.y, { x: ctx.dirX, y: ctx.dirY });
            const speed = Math.max(900, (d - stop) / E_PULL_TIME);
            if (u.pullTo({ x: champ.x + dir.x * stop, y: champ.y + dir.y * stop, speed, source: champ, height: 45 })) {
              extra = (d - stop) / speed;
              pulled.push(u);
            }
          }
          u.slow(E_SLOW, E_SLOW_DUR + extra, champ);
        }
        game.fx.custom('darius_e_grab', { unit: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, range: E_RANGE, angle: E_ANGLE, targets: pulled });
      },
      ai: {
        kind: 'cc', range: E_RANGE - 20, width: 150, delay: 0.25, collision: false,
        damage: () => 0,
        // 目标在拉拽距离内但不在普攻距离内时使用；蓄力大杀四方时不用（会把人拉进斧柄）
        when: (champ, target) => !!target && target.type === 'champion' && !champ.hasBuff('darius_q_charge')
          && champ.distTo(target) > champ.stats.attackRange + champ.radius + target.radius + 40 && champ.distTo(target) < E_RANGE,
      },
    },

    // —— R：诺克萨斯断头台 ——
    R: {
      id: 'darius_r',
      name: '诺克萨斯断头台',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `德莱厄斯跃向一名敌方英雄并落下致命一斧，造成 ${scaleText(champ, rv(R_BASE, r), [[R_BAD, 'bonusAd']])} 点真实伤害。`
          + `目标身上每有一层出血，伤害提高 ${pct(R_PER_STACK)}（最多 ${pct(R_PER_STACK * BLEED_MAX)}）。\n`
          + `如果诺克萨斯断头台击杀了目标，德莱厄斯获得诺克萨斯之力，并可在 ${R_RESET} 秒内再次施放。3 级时不消耗法力。跃起过程中无法被控制。`;
      },
      cooldown: R_CD,
      cost: R_COST,
      range: R_RANGE,
      targeting: 'unit',
      targetFilter: 'enemyChampion',
      indicator: { type: 'unit' },
      castTime: 0,
      lockMovement: true,
      sfx: 'impact',
      cast(champ, ctx) {
        const game = champ.game;
        const t = ctx.target;
        const ab = ctx.ability;
        if (!t || !t.alive) return false;
        const rank = ctx.rank;
        const ok = champ.dash({
          followTarget: t, duration: R_LEAP, arcHeight: 230, unstoppable: true, ignoreWalls: true, stopDistance: 15,
          onEnd: () => guillotine(champ, t, rank, ab),
        });
        if (!ok) return false;
        champ.removeBuff('darius_r_reset');
        ab.state.lastCastAt = game.time;
        game.fx.custom('darius_r_leap', { unit: champ, target: t, duration: R_LEAP });
      },
      ai: {
        kind: 'execute', range: R_RANGE,
        damage: (champ, target, rank) => dariusRDamage(champ, target, rank),
        // 真实伤害足以斩杀（护盾也会吸收）时使用
        when: (champ, target) => !!target && target.type === 'champion' && target.alive
          && target.hp + target.totalShield <= dariusRDamage(champ, target, champ.abilities.R.rank) * 0.98,
      },
    },
  },

  ai: { skillOrder: ['Q', 'E', 'W'], style: 'bruiser', engageRange: 500, kiteDistance: 0, combo: ['E', 'W', 'Q', 'R'] },
};
