// 英雄：墨菲特（熔岩巨兽）—— 被动花岗岩护盾、Q 地震碎片（偷取移速）、W 雷霆拍击（护甲提升 + 锥形余震）、
// E 巨石冲击（基于护甲的范围伤害 + 降低攻速）、R 势不可挡（不可阻挡的冲锋 + 范围击飞）
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本附近） ——
const P_PCT = 0.10;                 // 护盾 = 最大生命值 10%
const P_DELAY = 10;                 // 10 秒未受伤害后重新生成
const P_SHIELD_ID = 'malphite_granite';

const Q_DMG = [70, 120, 170, 220, 270];      // （+60% AP）
const Q_AP = 0.60;
const Q_SLOW = [0.20, 0.25, 0.30, 0.35, 0.40];
const Q_SLOW_DUR = 4;
const Q_RANGE = 625;
const Q_SPEED = 1200;
const Q_COST = [70, 75, 80, 85, 90];
const Q_CD = [8, 8, 8, 8, 8];

const W_ARMOR = [0.10, 0.15, 0.20, 0.25, 0.30]; // 被动护甲提升（主动期间翻倍）
const W_FIRST = [30, 45, 60, 75, 90];          // 首次普攻额外物理伤害（+20% AP +15% 护甲）
const W_FIRST_AP = 0.20;
const W_FIRST_ARMOR = 0.15;
const W_SHOCK = [15, 25, 35, 45, 55];          // 余震（+20% AP +10% 护甲）
const W_SHOCK_AP = 0.20;
const W_SHOCK_ARMOR = 0.10;
const W_DURATION = 6;
const W_CONE_RANGE = 400;
const W_CONE_ANGLE = 70;
const W_COST = [25, 25, 25, 25, 25];
const W_CD = [12, 11.5, 11, 10.5, 10];

const E_DMG = [60, 95, 130, 165, 200];         // （+40% 护甲 +60% AP）
const E_ARMOR = 0.40;
const E_AP = 0.60;
const E_AS_DOWN = [0.30, 0.35, 0.40, 0.45, 0.50];
const E_AS_DUR = 3;
const E_RADIUS = 400;
const E_COST = [50, 55, 60, 65, 70];
const E_CD = [7, 7, 7, 7, 7];

const R_DMG = [200, 300, 400];                 // （+90% AP）
const R_AP = 0.90;
const R_KNOCKUP = 1.5;
const R_RANGE = 1000;
const R_RADIUS = 325;
const R_BASE_SPEED = 1835;
const R_CD = [130, 105, 80];

const ROCK = 0xc8905a;
const LAVA = 0xff7a2a;
const STONE = 0x8a7a6a;
const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('岩', '#b8a08a', '#4a3a2a'),
  Q: icon('碎', '#d8a070', '#5a3018'),
  W: icon('拍', '#e0b060', '#6a3a10'),
  E: icon('击', '#c89060', '#3a2a1a'),
  R: icon('挡', '#ff9a4a', '#5a1a08'),
};

// —— 伤害计算 ——
const S = (champ) => champ?.stats || {};
const qDamage = (champ, rank) => rv(Q_DMG, rank) + Q_AP * (S(champ).ap || 0);
const wFirst = (champ, rank) => rv(W_FIRST, rank) + W_FIRST_AP * (S(champ).ap || 0) + W_FIRST_ARMOR * (S(champ).armor || 0);
const wShock = (champ, rank) => rv(W_SHOCK, rank) + W_SHOCK_AP * (S(champ).ap || 0) + W_SHOCK_ARMOR * (S(champ).armor || 0);
const eDamage = (champ, rank) => rv(E_DMG, rank) + E_ARMOR * (S(champ).armor || 0) + E_AP * (S(champ).ap || 0);
const rDamage = (champ, rank) => rv(R_DMG, rank) + R_AP * (S(champ).ap || 0);
const shieldAmount = (champ) => P_PCT * (champ?.maxHp || 0);
export const MALPHITE = { qDamage, wFirst, wShock, eDamage, rDamage, shieldAmount, P_SHIELD_ID };

const hittable = (u) => u && u.alive && !u.removed && !u.untargetable && u.type !== 'ward' && !u.isStructure;
const hasGranite = (champ) => champ.shields.some((s) => s.id === P_SHIELD_ID && s.amount > 0);

// 降低攻速：按施加时目标的攻速换算为属性减益（避免属性重算时连锁叠加）
function slowAttackSpeed(champ, u, pctDown) {
  const ratio = u.baseStats?.asRatio || u.baseStats?.as || 0.625;
  const cur = u.stats?.attackSpeed || ratio;
  const down = (pctDown * cur) / ratio;
  u.addBuff({
    id: 'malphite_e_slow', name: '巨石冲击', desc: `攻击速度降低 ${pct(pctDown)}`, icon: ICONS.E, source: champ,
    duration: E_AS_DUR, isDebuff: true, cleansable: true, refresh: 'replace',
    stats: { attackSpeed: -down },
  });
}

// —— AI 辅助 ——
const aiOk = (r) => r === true || !!(r && r.ok);
function aiCastAt(champ, ai, slot, x, y) {
  return aiOk(typeof ai?.castAt === 'function' ? ai.castAt(slot, x, y) : champ.castAbility(slot, { x, y }));
}
function aiEnemies(champ, ai, radius) {
  const list = ai?.visibleEnemies?.(radius);
  const src = Array.isArray(list) ? list
    : champ.game.queryUnits({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
  return src.filter((u) => u && u.alive && u.type === 'champion' && !u.untargetable && champ.distTo(u) <= radius);
}
function aiAllies(champ, ai, radius) {
  const list = ai?.nearbyAllies?.(radius);
  const src = Array.isArray(list) ? list : champ.game.champions.filter((c) => c.team === champ.team && c.alive && champ.distTo(c) <= radius);
  return src.filter((u) => u && u.alive && u !== champ);
}
function aiPredict(ai, unit, t) {
  const p = ai?.predict?.(unit, t);
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : predictPosition(unit, t);
}

export default {
  id: 'malphite',
  name: '墨菲特',
  title: '熔岩巨兽',
  roles: ['top', 'support'],
  tags: ['坦克', '战士'],
  difficulty: 2,
  lore: '一块来自原始秩序之石的活体巨岩，以坚不可摧的身躯和势不可挡的冲锋守护世界的平衡。',
  baseStats: {
    hp: 665, hpPerLevel: 104, hpRegen: 7, hpRegenPerLevel: 0.55,
    mana: 280, manaPerLevel: 60, manaRegen: 7.3, manaRegenPerLevel: 0.55, resource: 'mana',
    ad: 62, adPerLevel: 4, as: 0.736, asRatio: 0.638, asPerLevel: 3.4,
    armor: 37, armorPerLevel: 4.95, mr: 28, mrPerLevel: 2.05,
    ms: 335, range: 125, radius: 75, windup: 0.3, missileSpeed: 0, critMult: 1.75,
  },
  model: { primary: 0x8a6a4a, secondary: 0x5a4a3a, accent: 0xff8a3a },
  portrait: { bg: ['#a07850', '#2a1a10'], glyph: '墨' },

  // —— 被动：花岗岩护盾 ——
  passive: {
    id: 'malphite_passive',
    name: '花岗岩护盾',
    icon: ICONS.P,
    desc: (champ) => `墨菲特获得一层可抵挡 ${pct(P_PCT)} 最大生命值${champ ? `（${fmt(shieldAmount(champ))} 点）` : ''}伤害的护盾。\n`
      + `护盾被击破后，若墨菲特 ${P_DELAY} 秒内未受到伤害，护盾会重新生成。`,
    init(champ) {
      const st = champ.passive.state;
      st.lastHit = -99;
      champ.addHook('afterTakeDamage', (ctx) => { if (ctx.dealt > 0) st.lastHit = champ.game.time; });
      champ.modelState.malphiteShield = false;
    },
    update(champ) {
      const st = champ.passive.state;
      const game = champ.game;
      if (!champ.alive) { champ.modelState.malphiteShield = false; return; }
      const has = hasGranite(champ);
      if (!has && game.time - st.lastHit >= P_DELAY) {
        champ.addShield(shieldAmount(champ), Infinity, { source: champ, id: P_SHIELD_ID, noPower: true });
        game.fx.custom('malphite_granite', { unit: champ });
      } else if (has && game.time - st.lastHit >= P_DELAY) {
        // 满额护盾随最大生命值成长
        const s = champ.shields.find((x) => x.id === P_SHIELD_ID);
        const want = shieldAmount(champ);
        if (s && s.amount >= s.max - 1e-6 && want > s.max) { s.amount = want; s.max = want; }
      }
      champ.modelState.malphiteShield = hasGranite(champ);
    },
  },

  abilities: {
    // —— Q：地震碎片 ——
    Q: {
      id: 'malphite_q',
      name: '地震碎片',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `墨菲特向目标敌人掷出一块大地碎片，造成 ${scaleText(champ, rv(Q_DMG, r), [[Q_AP, 'ap']])} 点魔法伤害，`
          + `并偷取目标 ${pct(rv(Q_SLOW, r))} 移动速度，持续 ${Q_SLOW_DUR} 秒（目标减速，墨菲特获得等量加速）。`;
      },
      cooldown: Q_CD,
      cost: Q_COST,
      range: Q_RANGE,
      targeting: 'unit',
      targetFilter: 'enemy',
      indicator: { type: 'unit' },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'impact',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const t = ctx.target;
        if (!t || !t.alive) return false;
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, target: t, speed: Q_SPEED, width: 0, height: 150,
          vfx: { kind: 'malphite_q_shard', fallback: 'orb', color: ROCK, size: 1.2, trail: true },
          onHit: (u) => {
            game.dealDamage(champ, u, qDamage(champ, rank), 'magic', { isAbility: true, spell: 'malphite_q' });
            const slow = rv(Q_SLOW, rank);
            if (u.alive) u.slow(slow, Q_SLOW_DUR, champ);
            champ.addBuff({
              id: 'malphite_q_haste', name: '地震碎片', desc: `移动速度提升 ${pct(slow)}`, icon: ICONS.Q, source: champ,
              duration: Q_SLOW_DUR, refresh: 'replace', stats: { moveSpeedPct: slow },
            });
            game.fx.custom('malphite_q_hit', { unit: u, x: u.x, y: u.y, caster: champ, duration: Q_SLOW_DUR });
            return true;
          },
        });
      },
      ai: {
        kind: 'nuke', range: Q_RANGE, speed: Q_SPEED, delay: 0.25,
        damage: (champ, target, rank) => mitigate(champ, target, qDamage(champ, rank), 'magic'),
      },
    },

    // —— W：雷霆拍击 ——
    W: {
      id: 'malphite_w',
      name: '雷霆拍击',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `被动：墨菲特的护甲提升 ${pct(rv(W_ARMOR, r))}。\n`
          + `主动：重置普攻，${W_DURATION} 秒内护甲提升效果翻倍（${pct(rv(W_ARMOR, r) * 2)}）。下一次普攻额外造成 ${scaleText(champ, rv(W_FIRST, r), [[W_FIRST_AP, 'ap'], [W_FIRST_ARMOR, 'armor']])} 点物理伤害；`
          + `期间每次普攻都会在目标身后的锥形区域产生余震，对其他敌人造成 ${scaleText(champ, rv(W_SHOCK, r), [[W_SHOCK_AP, 'ap'], [W_SHOCK_ARMOR, 'armor']])} 点物理伤害。`;
      },
      cooldown: W_CD,
      cost: W_COST,
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: W_CONE_RANGE },
      castTime: 0,
      lockMovement: false,
      sfx: 'buff',
      onLearn(champ, ab) {
        // 被动护甲：按当前等级动态计算
        champ.addBuff({
          id: 'malphite_w_passive', name: '雷霆拍击', desc: '护甲提升', icon: ICONS.W, hidden: true,
          duration: Infinity, persistOnDeath: true,
          statsFn: (u) => {
            const r = u.abilities?.W?.rank || 1;
            const active = u.hasBuff('malphite_w_active');
            return { armorPct: rv(W_ARMOR, r) * (active ? 2 : 1) };
          },
        });
        champ.addHook('onHit', (target, hit) => {
          const b = champ.getBuff('malphite_w_active');
          if (!b || hit.ezrealQ) return;
          hit.malphiteW = b.data.rank;
          if (b.data.first) {
            b.data.first = false;
            hit.extra.push({ amount: wFirst(champ, b.data.rank), type: 'physical', spell: 'malphite_w', isAbility: true });
          }
        });
        champ.addHook('afterHit', (target, hit) => {
          if (!hit.malphiteW || !target) return;
          const game = champ.game;
          const rank = hit.malphiteW;
          let dx = target.x - champ.x, dy = target.y - champ.y;
          const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
          const hits = game.queryCone({ x: champ.x, y: champ.y, dirX: dx, dirY: dy, angle: W_CONE_ANGLE, range: W_CONE_RANGE + (target.radius || 0), enemyOf: champ })
            .filter((u) => u !== target && hittable(u));
          for (const u of hits) game.dealDamage(champ, u, wShock(champ, rank), 'physical', { isAbility: true, isAoE: true, spell: 'malphite_w_shock' });
          game.fx.custom('malphite_w_shock', { unit: champ, x: champ.x, y: champ.y, dirX: dx, dirY: dy, range: W_CONE_RANGE, angle: W_CONE_ANGLE });
        });
        void ab;
      },
      cast(champ, ctx) {
        const game = champ.game;
        champ.addBuff({
          id: 'malphite_w_active', name: '雷霆拍击', desc: '护甲提升翻倍，普攻产生余震', icon: ICONS.W, source: champ,
          duration: W_DURATION, refresh: 'replace', data: { rank: ctx.rank, first: true },
          onApply: (u) => { u.modelState.malphiteThunder = true; },
          onRemove: (u) => { u.modelState.malphiteThunder = false; },
        });
        champ.resetAttack();
        champ.recalcStats();
        game.fx.custom('malphite_w_cast', { unit: champ, duration: W_DURATION });
      },
      ai: { kind: 'selfbuff', range: 300 },
    },

    // —— E：巨石冲击 ——
    E: {
      id: 'malphite_e',
      name: '巨石冲击',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `墨菲特猛击地面，对周围 ${E_RADIUS} 码内的敌人造成 ${scaleText(champ, rv(E_DMG, r), [[E_ARMOR, 'armor'], [E_AP, 'ap']])} 点魔法伤害，`
          + `并使其攻击速度降低 ${pct(rv(E_AS_DOWN, r))}，持续 ${E_AS_DUR} 秒。`;
      },
      cooldown: E_CD,
      cost: E_COST,
      range: E_RADIUS,
      targeting: 'self',
      indicator: { type: 'self', radius: E_RADIUS },
      castTime: 0.242,
      lockMovement: true,
      sfx: 'impact',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const hits = game.queryUnits({ x: champ.x, y: champ.y, radius: E_RADIUS, enemyOf: champ }).filter(hittable);
        for (const u of hits) {
          game.dealDamage(champ, u, eDamage(champ, rank), 'magic', { isAbility: true, isAoE: true, spell: 'malphite_e' });
          if (u.alive) slowAttackSpeed(champ, u, rv(E_AS_DOWN, rank));
        }
        game.fx.custom('malphite_e_slam', { unit: champ, x: champ.x, y: champ.y, radius: E_RADIUS });
      },
      ai: { kind: 'aoe', range: E_RADIUS - 60, radius: E_RADIUS - 60, minTargets: 1, farm: true, delay: 0.25 },
    },

    // —— R：势不可挡 ——
    R: {
      id: 'malphite_r',
      name: '势不可挡',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `墨菲特以不可阻挡之势冲向目标区域（${R_RANGE} 码），落地时对 ${R_RADIUS} 码内的敌人造成 ${scaleText(champ, rv(R_DMG, r), [[R_AP, 'ap']])} 点魔法伤害，并将其击飞 ${R_KNOCKUP} 秒。\n`
          + `冲锋途中与墨菲特相撞的敌方英雄同样受到伤害并被击飞。`;
      },
      cooldown: R_CD,
      cost: [100, 100, 100],
      range: R_RANGE,
      targeting: 'point',
      indicator: { type: 'circle', radius: R_RADIUS },
      castTime: 0,
      lockMovement: true,
      sfx: 'explosion',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        if (!champ.canDash()) return false;
        const done = new Set();
        const smash = (u) => {
          if (done.has(u) || !hittable(u)) return;
          done.add(u);
          game.dealDamage(champ, u, rDamage(champ, rank), 'magic', { isAbility: true, isAoE: true, spell: 'malphite_r' });
          if (u.alive) u.knockup(R_KNOCKUP, champ, 180);
        };
        const tx = ctx.x, ty = ctx.y;
        const ok = champ.dash({
          x: tx, y: ty, speed: R_BASE_SPEED + champ.stats.moveSpeed, unstoppable: true, ignoreWalls: true,
          hitRadius: 90, hitFilter: (u) => u.type === 'champion' && u.team !== champ.team, onHitUnit: (u) => smash(u),
          onEnd: () => {
            champ.modelState.malphiteCharging = false;
            const hits = game.queryUnits({ x: champ.x, y: champ.y, radius: R_RADIUS, enemyOf: champ }).filter(hittable);
            for (const u of hits) smash(u);
            game.fx.custom('malphite_r_impact', { unit: champ, x: champ.x, y: champ.y, radius: R_RADIUS });
          },
        });
        if (!ok) return false;
        champ.modelState.malphiteCharging = true;
        game.fx.custom('malphite_r_charge', { unit: champ, x1: champ.x, y1: champ.y, x2: tx, y2: ty, radius: R_RADIUS });
        return undefined;
      },
      ai: {
        kind: 'aoe', range: R_RANGE, radius: R_RADIUS, minTargets: 2,
        damage: (champ, target, rank) => mitigate(champ, target, rDamage(champ, rank), 'magic'),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0 || champ.mana < 100 || !champ.canDash()) return false;
          if (ai?.castContext !== 'fight' && ai?.mode !== 'fighting') return false;
          const foes = aiEnemies(champ, ai, R_RANGE + R_RADIUS);
          if (foes.length === 0) return false;
          const allies = aiAllies(champ, ai, 1400).length;
          const hp = typeof ai?.hpPct === 'function' ? ai.hpPct() : champ.hp / champ.maxHp;
          const delay = 0.1;
          let best = null, bestN = 0, bestScore = 0;
          for (const e of foes) {
            const d = champ.distTo(e);
            const p = aiPredict(ai, e, delay + d / (R_BASE_SPEED + champ.stats.moveSpeed));
            if (Math.hypot(p.x - champ.x, p.y - champ.y) > R_RANGE) continue;
            let n = 0, low = 0;
            for (const o of foes) {
              if (Math.hypot(o.x - p.x, o.y - p.y) <= R_RADIUS + o.radius * 0.5) {
                n++;
                if (o.hp / o.maxHp < 0.4) low++;
              }
            }
            const score = n * 2 + low;
            if (score > bestScore) { bestScore = score; bestN = n; best = p; }
          }
          if (!best) return false;
          const dive = !!ai?.isUnderEnemyTurret?.(best.x, best.y) && !ai?.diving;
          if (dive && bestN < 3) return false;
          // 多人命中；或单人且有队友跟进/目标残血
          const single = bestN === 1 && (allies >= 1 || bestScore >= 3) && hp > 0.3;
          if (bestN < 2 && !single) return false;
          if (bestN === 1 && game.rng() > 0.35) return false;
          return aiCastAt(champ, ai, 'R', best.x, best.y);
        },
      },
    },
  },

  ai: { skillOrder: ['Q', 'E', 'W'], style: 'tank', engageRange: 650, kiteDistance: 0, combo: ['R', 'E', 'W', 'Q'] },
};
