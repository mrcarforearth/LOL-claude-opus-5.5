// 英雄：伊泽瑞尔（探险家）—— 被动咒能高涨（技能命中叠攻速）、Q 秘术射击（附带攻击特效、减少冷却）、
// W 精华跃动（标记后被普攻/技能引爆并返还法力）、E 奥术跃迁（闪烁 + 追踪弹）、R 精准弹幕（1 秒蓄力的全图弹幕）
import { rv, fmt, pct, scaleText, predictPosition, isChampion, isEpic } from './_common.js';
import { mitigate } from '../core/damage.js';
import { MAP_SIZE } from '../config.js';

// —— 数值表（LoL 当前版本附近） ——
const P_AS = 0.10;                 // 每层攻速
const P_MAX = 5;
const P_DURATION = 6;
const P_ID = 'ezreal_rising';

const Q_DMG = [20, 45, 70, 95, 120];   // （+130% AD +15% AP）
const Q_AD = 1.30;
const Q_AP = 0.15;
const Q_CDR = 1.5;
const Q_RANGE = 1200;
const Q_WIDTH = 60;
const Q_SPEED = 2000;
const Q_COST = [28, 31, 34, 37, 40];
const Q_CD = [5.5, 5.25, 5, 4.75, 4.5];

const W_DMG = [80, 135, 190, 245, 300];     // （+60% 额外 AD + 70~90% AP）
const W_BONUS_AD = 0.60;
const W_AP = [0.70, 0.75, 0.80, 0.85, 0.90];
const W_MANA_BACK = 60;                      // 另返还 W 的法力消耗
const W_COST = 50;
const W_MARK = 4;
const W_RANGE = 1200;
const W_WIDTH = 80;
const W_SPEED = 1700;
const W_CD = [12, 12, 12, 12, 12];
const MARK_ID = 'ezreal_w_mark';

const E_DMG = [80, 130, 180, 230, 280];     // （+50% 额外 AD +75% AP）
const E_BONUS_AD = 0.50;
const E_AP = 0.75;
const E_RANGE = 475;
const E_SEEK = 750;
const E_BOLT_SPEED = 2000;
const E_COST = [90, 90, 90, 90, 90];
const E_CD = [26, 23, 20, 17, 14];

const R_DMG = [350, 550, 750];              // （+100% 额外 AD +90% AP）
const R_BONUS_AD = 1.0;
const R_AP = 0.90;
const R_MINION_MULT = 0.5;
const R_WIDTH = 160;                        // 碰撞半径
const R_SPEED = 2000;
const R_CAST = 1.0;
const R_CD = [120, 105, 90];

const GOLD = 0xffd65a;
const ARCANE = 0x6fd8ff;
const ESSENCE = 0xffb03a;
const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('涌', '#ffe07a', '#6a4a10'),
  Q: icon('射', '#ffd65a', '#2a3a6a'),
  W: icon('跃', '#ffb85a', '#6a2a8a'),
  E: icon('迁', '#8ae4ff', '#1a3a6a'),
  R: icon('幕', '#fff0a0', '#8a5a10'),
};

// —— 伤害计算 ——
const S = (champ) => champ?.stats || {};
const qDamage = (champ, rank) => rv(Q_DMG, rank) + Q_AD * (S(champ).ad || 0) + Q_AP * (S(champ).ap || 0);
const wDamage = (champ, rank) => rv(W_DMG, rank) + W_BONUS_AD * (S(champ).bonusAd || 0) + rv(W_AP, rank) * (S(champ).ap || 0);
const eDamage = (champ, rank) => rv(E_DMG, rank) + E_BONUS_AD * (S(champ).bonusAd || 0) + E_AP * (S(champ).ap || 0);
const rDamage = (champ, rank) => rv(R_DMG, rank) + R_BONUS_AD * (S(champ).bonusAd || 0) + R_AP * (S(champ).ap || 0);
export const EZREAL = { qDamage, wDamage, eDamage, rDamage, MARK_ID, P_ID };

const hittable = (u) => u && u.alive && !u.removed && !u.untargetable && u.type !== 'ward';
// W 可标记：英雄、大型/史诗野怪、建筑（穿过小兵）
const wMarkable = (champ) => (u) => u && u.alive && !u.removed && !u.untargetable && !u.invulnerable && u.team !== champ.team
  && (u.type === 'champion' || (u.type === 'monster' && (u.epic || u.large !== false)) || u.isStructure);

// 被动：技能命中叠层
function gainStack(champ) {
  const had = champ.buffStacks(P_ID);
  champ.addBuff({
    id: P_ID, name: '咒能高涨', desc: `每层 +${pct(P_AS)} 攻击速度`, icon: ICONS.P, source: champ,
    duration: P_DURATION, maxStacks: P_MAX, refresh: 'stack', stats: { attackSpeed: P_AS }, statsPerStack: true,
    onRemove: (u) => { u.modelState.ezrealStacks = 0; },
  });
  const n = champ.buffStacks(P_ID);
  champ.modelState.ezrealStacks = n;
  if (n === P_MAX && had < P_MAX) champ.game.fx.custom('ezreal_passive_max', { unit: champ, duration: P_DURATION });
}

// 引爆精华跃动标记
function detonate(champ, u) {
  const b = u.getBuff(MARK_ID);
  if (!b || b.source !== champ) return 0;
  const rank = b.data.rank || 1;
  u.removeBuff(b);
  const game = champ.game;
  game.fx.custom('ezreal_w_pop', { unit: u, x: u.x, y: u.y });
  const dealt = game.dealDamage(champ, u, wDamage(champ, rank), 'magic', { isAbility: true, spell: 'ezreal_w_burst' });
  // 返还法力：60 + W 的法力消耗
  if (champ.alive && champ.resourceType === 'mana') champ.mana = Math.min(champ.maxMana, champ.mana + W_MANA_BACK + W_COST);
  return dealt;
}

// Q 命中：技能伤害 + 攻击特效（按普攻钩子结算附加伤害），命中任意单位后所有技能冷却减少 1.5 秒
function mysticHit(champ, u, rank) {
  const game = champ.game;
  const hit = { damage: qDamage(champ, rank), type: 'physical', isCrit: false, extra: [], miss: false, attacker: champ, ezrealQ: true };
  champ.runHooks('onHit', u, hit);
  game.dealDamage(champ, u, hit.damage, 'physical', { isAbility: true, spell: 'ezreal_q' });
  for (const e of hit.extra) {
    if (!u.alive) break;
    game.dealDamage(champ, u, e.amount, e.type || 'physical', { isOnHit: true, spell: e.spell || 'ezreal_q_onhit', isAbility: !!e.isAbility });
  }
  champ.runHooks('afterHit', u, hit);
  for (const s of ['Q', 'W', 'E', 'R']) {
    const ab = champ.abilities[s];
    if (ab && ab.rank > 0) ab.reduceCooldown(Q_CDR);
  }
}

// 到地图边缘的距离（全图弹幕射程）
function rangeToEdge(x, y, dx, dy) {
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (MAP_SIZE - x) / dx); else if (dx < -1e-6) t = Math.min(t, -x / dx);
  if (dy > 1e-6) t = Math.min(t, (MAP_SIZE - y) / dy); else if (dy < -1e-6) t = Math.min(t, -y / dy);
  return Number.isFinite(t) ? Math.max(500, Math.min(t, 22000)) : 15000;
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
function aiPredict(ai, unit, t) {
  const p = ai?.predict?.(unit, t);
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : predictPosition(unit, t);
}
function aiPickTarget(champ, ai, range) {
  const t = ai?.target;
  if (t && t.alive && t.type === 'champion' && t.team !== champ.team && !t.untargetable && champ.distTo(t) <= range) return t;
  const list = aiEnemies(champ, ai, range);
  if (list.length === 0) return null;
  return list.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a));
}
const manaPct = (champ) => (champ.maxMana > 0 ? champ.mana / champ.maxMana : 1);
const farmMode = (ai) => ['laning', 'pushing', 'jungling', 'objective'].includes(ai?.mode);
const underTurret = (ai, x, y) => !!ai?.isUnderEnemyTurret?.(x, y);
// 直线上（到 p 之前）是否有阻挡的单位
function lineBlocked(champ, p, target, width) {
  const dist = Math.hypot(p.x - champ.x, p.y - champ.y) || 1;
  const hits = champ.game.queryLine({ x1: champ.x, y1: champ.y, x2: p.x, y2: p.y, width, enemyOf: champ, types: ['minion', 'monster', 'pet', 'champion'], sort: false });
  for (const u of hits) {
    if (u === target || u.untargetable) continue;
    const t = u._qd ?? (((u.x - champ.x) * (p.x - champ.x) + (u.y - champ.y) * (p.y - champ.y)) / (dist * dist));
    if (t * dist < Math.max(0, champ.distTo(target) - target.radius - 10)) return true;
  }
  return false;
}
// 直线弹道预判施放（返回是否已施放）
function aimLine(champ, ai, slot, target, { range, speed, delay, width, collide = true }) {
  const d = champ.distTo(target);
  const p = aiPredict(ai, target, delay + d / speed);
  if (Math.hypot(p.x - champ.x, p.y - champ.y) > range + target.radius * 0.5) return false;
  if (collide && lineBlocked(champ, p, target, width)) return false;
  return aiCastAt(champ, ai, slot, p.x, p.y);
}

export default {
  id: 'ezreal',
  name: '伊泽瑞尔',
  title: '探险家',
  roles: ['adc'],
  tags: ['射手', '法师'],
  difficulty: 3,
  lore: '皮尔特沃夫的冒险家，戴着一只神秘的远古护手，能用奥术能量射击并在短距离内瞬移。',
  baseStats: {
    hp: 600, hpPerLevel: 102, hpRegen: 4, hpRegenPerLevel: 0.65,
    mana: 375, manaPerLevel: 70, manaRegen: 8.5, manaRegenPerLevel: 0.65, resource: 'mana',
    ad: 62, adPerLevel: 2.5, as: 0.625, asRatio: 0.625, asPerLevel: 2.5,
    armor: 24, armorPerLevel: 4.7, mr: 30, mrPerLevel: 1.3,
    ms: 325, range: 550, radius: 65, windup: 0.1884, critMult: 1.75,
    missileSpeed: 2000, attackVfx: { kind: 'ezreal_aa', fallback: 'bolt', color: GOLD, size: 0.8, trail: true },
  },
  model: { primary: 0x3a5a9a, secondary: 0xe8c070, accent: 0x6fd8ff },
  portrait: { bg: ['#e8c060', '#1a2a5a'], glyph: '伊' },

  // —— 被动：咒能高涨 ——
  passive: {
    id: 'ezreal_passive',
    name: '咒能高涨',
    icon: ICONS.P,
    desc: (champ) => {
      const n = champ?.buffStacks?.(P_ID) || 0;
      return `伊泽瑞尔的技能命中目标时获得 ${pct(P_AS)} 攻击速度，持续 ${P_DURATION} 秒，最多叠加 ${P_MAX} 层（${pct(P_AS * P_MAX)}）。\n当前 ${n} 层。`;
    },
    init(champ) {
      champ.modelState.ezrealStacks = 0;
      // 精华跃动标记：被伊泽瑞尔的普攻或其他技能命中时引爆
      champ.addHook('afterDealDamage', (ctx) => {
        const t = ctx.target;
        if (!t || !t.alive || t.hp <= 0 || !(ctx.dealt > 0)) return;
        const byAbility = ctx.isAbility && typeof ctx.spell === 'string' && ctx.spell.startsWith('ezreal_') && ctx.spell !== 'ezreal_w' && ctx.spell !== 'ezreal_w_burst';
        if (!ctx.isBasicAttack && !byAbility) return;
        const b = t.getBuff(MARK_ID);
        if (b && b.source === champ) detonate(champ, t);
      });
    },
  },

  abilities: {
    // —— Q：秘术射击 ——
    Q: {
      id: 'ezreal_q',
      name: '秘术射击',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `伊泽瑞尔射出一道能量弹（${Q_RANGE} 码），对命中的第一个敌人造成 ${scaleText(champ, rv(Q_DMG, r), [[Q_AD, 'ad'], [Q_AP, 'ap']])} 点物理伤害，并附带攻击特效。\n`
          + `命中单位时，伊泽瑞尔所有技能的冷却时间减少 ${Q_CDR} 秒。`;
      },
      cooldown: Q_CD,
      cost: Q_COST,
      range: Q_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: Q_WIDTH * 2, length: Q_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'shot',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY,
          range: Q_RANGE, speed: Q_SPEED, width: Q_WIDTH, hits: 'first', height: 110,
          vfx: { kind: 'ezreal_q_bolt', fallback: 'bolt', color: GOLD, size: 1.1, trail: true },
          onHit: (u) => {
            gainStack(champ);
            mysticHit(champ, u, rank);
            game.fx.custom('ezreal_q_hit', { unit: u, x: u.x, y: u.y });
            return true;
          },
        });
      },
      ai: {
        kind: 'nuke', range: Q_RANGE, width: Q_WIDTH, speed: Q_SPEED, delay: 0.25, collision: true, farm: true,
        damage: (champ, target, rank) => mitigate(champ, target, qDamage(champ, rank), 'physical'),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          if (champ.mana < ability.cost) return false;
          const t = aiPickTarget(champ, ai, Q_RANGE + 150);
          if (t) return aimLine(champ, ai, 'Q', t, { range: Q_RANGE, speed: Q_SPEED, delay: 0.25, width: Q_WIDTH });
          // 对线/推线：用 Q 补刀（远端即将被击杀的小兵）或清野
          if (!farmMode(ai) || manaPct(champ) < (ai?.mode === 'jungling' ? 0.3 : 0.55)) return false;
          const dmg = qDamage(champ, ability.rank);
          const mins = game.queryUnits({ x: champ.x, y: champ.y, radius: Q_RANGE - 50, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'] });
          for (const m of mins) {
            const killable = m.hp <= mitigate(champ, m, dmg, 'physical') * 0.95;
            const far = champ.distTo(m) > champ.stats.attackRange + 150 || m.type === 'monster';
            if (!(killable || (m.type === 'monster' && m.large !== false)) || !far) continue;
            if (underTurret(ai, m.x, m.y)) continue;
            if (lineBlocked(champ, m, m, Q_WIDTH)) continue;
            return aiCastAt(champ, ai, 'Q', m.x, m.y);
          }
          return false;
        },
      },
    },

    // —— W：精华跃动 ——
    W: {
      id: 'ezreal_w',
      name: '精华跃动',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `伊泽瑞尔射出一颗法球（${W_RANGE} 码，穿过小兵），附着在命中的第一个敌方英雄、大型野怪或建筑上，持续 ${W_MARK} 秒。\n`
          + `伊泽瑞尔的普攻或其他技能命中被标记的目标时引爆法球，造成 ${scaleText(champ, rv(W_DMG, r), [[W_BONUS_AD, 'bonusAd'], [rv(W_AP, r), 'ap']])} 点魔法伤害，并返还 ${W_MANA_BACK + W_COST} 点法力值（${W_MANA_BACK} + 技能消耗）。`;
      },
      cooldown: W_CD,
      cost: [W_COST, W_COST, W_COST, W_COST, W_COST],
      range: W_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: W_WIDTH * 2, length: W_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'magic',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const can = wMarkable(champ);
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY,
          range: W_RANGE, speed: W_SPEED, width: W_WIDTH, hits: 'first', height: 110,
          canHit: (u) => can(u),
          vfx: { kind: 'ezreal_w_orb', fallback: 'orb', color: ESSENCE, size: 1.2, trail: true },
          onHit: (u) => {
            gainStack(champ);
            const b = u.addBuff({
              id: MARK_ID, name: '精华跃动', desc: '被伊泽瑞尔标记：受到他的普攻或技能时引爆', icon: ICONS.W,
              source: champ, duration: W_MARK, isDebuff: true, refresh: 'replace', data: { rank },
            });
            game.fx.custom('ezreal_w_mark', { unit: u, buff: b, duration: W_MARK });
            return true;
          },
        });
      },
      ai: {
        kind: 'nuke', range: W_RANGE, width: W_WIDTH, speed: W_SPEED, delay: 0.25,
        damage: (champ, target, rank) => mitigate(champ, target, wDamage(champ, rank), 'magic'),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0 || champ.mana < W_COST) return false;
          const t = aiPickTarget(champ, ai, W_RANGE + 100);
          if (t) {
            // 需要后续能引爆：Q 即将就绪或目标在普攻距离附近
            const q = champ.abilities.Q;
            const canPop = (q.rank > 0 && q.cdRemaining < 1.2) || champ.distTo(t) < champ.stats.attackRange + 200;
            if (!canPop) return false;
            return aimLine(champ, ai, 'W', t, { range: W_RANGE, speed: W_SPEED, delay: 0.25, width: W_WIDTH, collide: false });
          }
          // 推塔：标记防御塔后普攻引爆
          if (ai?.mode === 'pushing' && manaPct(champ) > 0.5) {
            const tw = champ.attackTarget;
            if (tw && tw.isStructure && tw.alive && tw.team !== champ.team && champ.distTo(tw) < champ.stats.attackRange + tw.radius + 50) {
              return aiCastAt(champ, ai, 'W', tw.x, tw.y);
            }
          }
          return false;
        },
      },
    },

    // —— E：奥术跃迁 ——
    E: {
      id: 'ezreal_e',
      name: '奥术跃迁',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `伊泽瑞尔闪烁到目标位置（${E_RANGE} 码），然后向 ${E_SEEK} 码内最近的敌人发射一枚追踪弹（优先精华跃动标记的目标），`
          + `造成 ${scaleText(champ, rv(E_DMG, r), [[E_BONUS_AD, 'bonusAd'], [E_AP, 'ap']])} 点魔法伤害。`;
      },
      cooldown: E_CD,
      cost: E_COST,
      range: E_RANGE,
      targeting: 'point',
      indicator: { type: 'circle', radius: 80 },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'whoosh',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        if (champ.hasCC('root') || !champ.canDash()) return false;
        const ox = champ.x, oy = champ.y;
        champ.blink(ctx.x, ctx.y);
        game.fx.custom('ezreal_e_blink', { unit: champ, x1: ox, y1: oy, x2: champ.x, y2: champ.y });
        // 寻找目标：优先带 W 标记者，其次最近的敌人
        const cands = game.queryUnits({ x: champ.x, y: champ.y, radius: E_SEEK, enemyOf: champ, targetableBy: champ, types: ['champion', 'minion', 'monster', 'pet'] })
          .filter(hittable);
        const marked = cands.find((u) => u.getBuff(MARK_ID)?.source === champ);
        const t = marked || cands[0];
        if (!t) return;
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, target: t, speed: E_BOLT_SPEED, width: 0, height: 110,
          vfx: { kind: 'ezreal_e_bolt', fallback: 'bolt', color: ARCANE, size: 1, trail: true },
          onHit: (u) => {
            gainStack(champ);
            game.dealDamage(champ, u, eDamage(champ, rank), 'magic', { isAbility: true, spell: 'ezreal_e' });
            game.fx.impact({ x: u.x, y: u.y, h: 90, color: ARCANE, size: 1 });
            return true;
          },
        });
      },
      ai: {
        kind: 'escape', range: E_RANGE,
        damage: (champ, target, rank) => mitigate(champ, target, eDamage(champ, rank), 'magic'),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0 || champ.mana < ability.cost) return false;
          if (!champ.canDash()) return false;
          const foes = aiEnemies(champ, ai, 900);
          const hp = typeof ai?.hpPct === 'function' ? ai.hpPct() : champ.hp / champ.maxHp;
          const escape = ai?.castContext === 'escape' || ai?.mode === 'retreating';
          const near = foes.find((f) => champ.distTo(f) < 450);
          // 逃生：远离最近的敌人（尝试多个角度，避开墙与敌方防御塔）
          if ((escape && foes.length > 0 && hp < 0.5) || (near && hp < 0.35)) {
            const f = near || foes[0];
            let dx = champ.x - f.x, dy = champ.y - f.y;
            const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
            for (const a of [0, 0.5, -0.5, 1, -1]) {
              const ca = Math.cos(a), sa = Math.sin(a);
              const px = champ.x + (dx * ca - dy * sa) * E_RANGE, py = champ.y + (dx * sa + dy * ca) * E_RANGE;
              if (game.nav.isWalkable(px, py) && !underTurret(ai, px, py)) return aiCastAt(champ, ai, 'E', px, py);
            }
            return false;
          }
          // 进攻收割：闪到保持距离的位置补上追踪弹
          if (ai?.castContext !== 'fight' || hp < 0.45) return false;
          const t = aiPickTarget(champ, ai, E_RANGE + E_SEEK - 100);
          if (!t) return false;
          const burst = mitigate(champ, t, eDamage(champ, ability.rank), 'magic') + (t.getBuff(MARK_ID)?.source === champ ? mitigate(champ, t, wDamage(champ, champ.abilities.W.rank), 'magic') : 0);
          if (t.hp + t.totalShield > burst * 0.95) return false;
          if (aiEnemies(champ, ai, 1200).length > 1) return false;
          const d = champ.distTo(t);
          const step = Math.min(E_RANGE, Math.max(0, d - 450));
          const px = champ.x + ((t.x - champ.x) / (d || 1)) * step, py = champ.y + ((t.y - champ.y) / (d || 1)) * step;
          if (underTurret(ai, px, py)) return false;
          return aiCastAt(champ, ai, 'E', px, py);
        },
      },
    },

    // —— R：精准弹幕 ——
    R: {
      id: 'ezreal_r',
      name: '精准弹幕',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `伊泽瑞尔蓄力 ${R_CAST} 秒后发射一道横跨全图的巨型能量弹幕，对沿途所有敌人造成 ${scaleText(champ, rv(R_DMG, r), [[R_BONUS_AD, 'bonusAd'], [R_AP, 'ap']])} 点魔法伤害。\n`
          + `对小兵和非史诗级野怪只造成 ${pct(R_MINION_MULT)} 伤害。`;
      },
      cooldown: R_CD,
      cost: [100, 100, 100],
      range: 20000,
      clampRange: false,
      targeting: 'direction',
      indicator: { type: 'line', width: R_WIDTH * 2, length: 4000 },
      castTime: R_CAST,
      lockMovement: true,
      sfx: 'explosion',
      onCastStart(champ, ctx) {
        champ.modelState.ezrealRCharge = true;
        champ.game.fx.custom('ezreal_r_charge', { unit: champ, dirX: ctx.dirX, dirY: ctx.dirY, duration: R_CAST });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        champ.modelState.ezrealRCharge = false;
        const range = rangeToEdge(champ.x, champ.y, ctx.dirX, ctx.dirY);
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY,
          range, speed: R_SPEED, width: R_WIDTH, hits: 'pierce', height: 130, maxAge: range / R_SPEED + 1,
          vfx: { kind: 'ezreal_r_wave', fallback: 'light', color: GOLD, size: 2.2, trail: true },
          data: { stacked: false },
          onHit: (u, p) => {
            if (!p.data.stacked) { p.data.stacked = true; gainStack(champ); }
            const full = u.type === 'champion' || isEpic(u);
            const amt = rDamage(champ, rank) * (full ? 1 : R_MINION_MULT);
            game.dealDamage(champ, u, amt, 'magic', { isAbility: true, isAoE: true, spell: 'ezreal_r' });
            if (isChampion(u)) {
              u.revealedUntil = Math.max(u.revealedUntil || 0, game.time + 1);
              game.fx.impact({ x: u.x, y: u.y, h: 110, color: GOLD, size: 1.8 });
            }
            return false;
          },
        });
        game.fx.shake?.(8, 0.3);
      },
      update(champ) {
        if (champ.modelState.ezrealRCharge && champ.castLock <= 0) champ.modelState.ezrealRCharge = false;
      },
      ai: {
        kind: 'global', range: 20000, width: R_WIDTH, speed: R_SPEED, delay: R_CAST,
        damage: (champ, target, rank) => mitigate(champ, target, rDamage(champ, rank), 'magic'),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0 || champ.mana < 100) return false;
          const foes = aiEnemies(champ, ai, 12000);
          if (foes.length === 0) return false;
          if (ai?.castContext === 'escape' && foes.every((f) => champ.distTo(f) < 700)) return false;
          const rank = ability.rank;
          let best = null, bestScore = 0;
          for (const e of foes) {
            const d = champ.distTo(e);
            const flight = R_CAST + d / R_SPEED;
            if (flight > 4) continue;
            const aim = aiPredict(ai, e, flight);
            const dx = aim.x - champ.x, dy = aim.y - champ.y;
            const l = Math.hypot(dx, dy) || 1;
            let hits = 0, kills = 0;
            for (const o of foes) {
              const od = champ.distTo(o);
              const op = aiPredict(ai, o, R_CAST + od / R_SPEED);
              const px = op.x - champ.x, py = op.y - champ.y;
              const along = (px * dx + py * dy) / l;
              const perp = Math.abs(px * dy - py * dx) / l;
              if (along < 0 || perp > R_WIDTH + o.radius * 0.5) continue;
              hits++;
              if (o.hp + o.totalShield < mitigate(champ, o, rDamage(champ, rank), 'magic') * 0.92) kills++;
            }
            const fightLow = ai?.castContext === 'fight' && e === ai?.target && e.hp / e.maxHp < 0.4 && d < 1400;
            const score = kills * 3 + (hits >= 3 ? hits : hits >= 2 && d < 2500 ? 1.5 : 0) + (fightLow ? 2 : 0);
            if (score > bestScore) { bestScore = score; best = aim; }
          }
          if (!best || bestScore < 2) return false;
          return aiCastAt(champ, ai, 'R', best.x, best.y);
        },
      },
    },
  },

  ai: { skillOrder: ['Q', 'E', 'W'], style: 'marksman', engageRange: 750, kiteDistance: 520, combo: ['W', 'Q', 'R', 'E'] },
};
