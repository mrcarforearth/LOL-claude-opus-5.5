// 英雄：亚索（疾风剑豪）—— 浪客之道（剑意护盾/暴击翻倍）、斩钢闪（三段/龙卷风/环形斩）、风之障壁（拦截投射物）、踏前斩（穿身位移叠伤）、狂风绝息斩
//
// 资源：剑意（resource 'flow'，存放在 champ.mana，上限 100，不自然回复；移动积攒，满后受到英雄/野怪伤害时转化为护盾）
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { norm, byLevel } from '../core/math.js';
import { effectiveResist, resistMultiplier, mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本） ——
const FLOW_MAX = 100;
const FLOW_UNITS = [59, 52, 46];              // 每 1 点剑意所需移动距离（1/7/13 级）
const P_SHIELD = [125, 600];                  // 剑意护盾 1→18 级
const P_SHIELD_DUR = 1;
const CRIT_MULT_FACTOR = 0.9;                 // 暴击伤害降低 10%
const CRIT_EXCESS_AD = 0.5;                   // 超过 100% 的暴击几率：每 1% 转化为 0.5 攻击力

const Q_BASE = [20, 45, 70, 95, 120];
const Q_AD = 1.05;
const Q_RANGE = 450;
const Q_WIDTH = 45;                           // 半宽
const Q_CD = 4;                               // 基础冷却（按额外攻速降低，最多 67%）
const Q_CAST = 0.35;
const Q_STACK_DUR = 6;
const Q3_RANGE = 1150;
const Q3_SPEED = 1500;
const Q3_WIDTH = 90;
const Q3_KNOCKUP = 1;
const EQ_RADIUS = 215;

const W_WIDTH = [320, 390, 460, 530, 600];
const W_DUR = 4;
const W_CD = [26, 24, 22, 20, 18];
const W_START = 150;                          // 风墙生成距离
const W_END = 350;                            // 风墙前推终点
const W_TRAVEL = 0.25;
const W_THICK = 45;

const E_BASE = [60, 70, 80, 90, 100];
const E_BAD = 0.2;
const E_AP = 0.6;
const E_RANGE = 475;
const E_DIST = 475;
const E_CD = [0.5, 0.4, 0.3, 0.2, 0.1];
const E_TARGET_CD = [10, 9, 8, 7, 6];
const E_STACK_PCT = 0.25;
const E_MAX_STACKS = 4;
const E_STACK_DUR = 5;

const R_BASE = [200, 350, 500];
const R_BAD = 1.5;
const R_RANGE = 1400;
const R_AOE = 400;
const R_SUSPEND = 1;
const R_CD = [80, 55, 30];
const R_PEN = 0.5;                            // 暴击无视 50% 额外护甲
const R_PEN_DUR = 15;
const R_LOCK = 0.75;

const WIND = 0x9fe8ff;
const STEEL = 0xe8f4ff;
const R_BLUE = 0x6ab8ff;

const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('道', '#8fd0ff', '#1c3a5e'),
  Q: icon('斩', '#dfeeff', '#34506e'),
  Q3: icon('旋', '#9fe8ff', '#1a4a6a'),
  W: icon('障', '#bfe8ff', '#2a5a7a'),
  E: icon('踏', '#a8d8ff', '#223e66'),
  R: icon('绝', '#7ab8ff', '#101e4a'),
};

// —— 公式 ——
export function yasuoFlowPerUnit(level) { return level >= 13 ? FLOW_UNITS[2] : level >= 7 ? FLOW_UNITS[1] : FLOW_UNITS[0]; }
export function yasuoShield(level) { return byLevel(level, P_SHIELD[0], P_SHIELD[1]); }
// 额外攻速带来的冷却/前摇缩减系数（每 1.67% 额外攻速 -1%，最多 -67%）
function asFactor(champ) { return 1 - Math.min(0.67, Math.max(0, champ?.stats?.bonusAS || 0) / 1.67); }
export function yasuoQCooldown(champ) { return Q_CD * asFactor(champ); }
export function yasuoQCastTime(champ) { return Math.max(0.175, Q_CAST * asFactor(champ)); }
export function yasuoQDamage(champ, rank) { return rv(Q_BASE, rank) + Q_AD * (champ?.stats?.ad || 0); }
export function yasuoEDamage(champ, rank, stacks = 0) {
  const base = rv(E_BASE, rank) + E_BAD * (champ?.stats?.bonusAd || 0) + E_AP * (champ?.stats?.ap || 0);
  return base * (1 + E_STACK_PCT * Math.min(E_MAX_STACKS, stacks));
}
export function yasuoRDamage(champ, rank) { return rv(R_BASE, rank) + R_BAD * (champ?.stats?.bonusAd || 0); }

const qStacks = (champ) => champ.getBuff('yasuo_q_stack')?.stacks || 0;
const tornadoReady = (champ) => qStacks(champ) >= 2;
const eMarkId = (champ) => `yasuo_e_mark_${champ.id}`;
const isAirborne = (u) => !!u && u.alive && u.hasCC?.('airborne');

function syncModel(champ) {
  const n = qStacks(champ);
  champ.modelState.qStacks = n;
  champ.modelState.tornadoReady = n >= 2;
}

// Q 叠层（命中任意敌人）
function gainQStack(champ) {
  const game = champ.game;
  const had = qStacks(champ);
  champ.addBuff({
    id: 'yasuo_q_stack', name: '斩钢闪', desc: '叠满 2 层后下一次斩钢闪变为龙卷风', icon: ICONS.Q, source: champ,
    duration: Q_STACK_DUR, maxStacks: 2, stacks: 1, refresh: 'stack',
    onRemove: (u) => syncModel(u),
  });
  syncModel(champ);
  if (had < 2 && qStacks(champ) >= 2) game.fx.custom('yasuo_q_ready', { unit: champ, duration: Q_STACK_DUR });
}
function clearQStacks(champ) {
  champ.removeBuff('yasuo_q_stack');
  syncModel(champ);
}

// 单次斩钢闪的命中结算（整次施放共用一次暴击判定）
function qStrike(champ, u, rank, isCrit, spell) {
  const dmg = yasuoQDamage(champ, rank) * (isCrit ? champ.stats.critMult : 1);
  champ.game.dealDamage(champ, u, dmg, 'physical', { isAbility: true, isAoE: true, isCrit, spell });
}
function rollCrit(champ) {
  const c = champ.stats.crit || 0;
  return c > 0 && (c >= 1 || champ.game.rng() < c);
}
const validHit = (u) => u && u.alive && !u.untargetable && u.type !== 'ward';

// 龙卷风：直线穿透，击飞
function castTornado(champ, dirX, dirY, rank, isCrit) {
  const game = champ.game;
  clearQStacks(champ);
  game.spawnProjectile({
    owner: champ, x: champ.x, y: champ.y, dirX, dirY, range: Q3_RANGE, speed: Q3_SPEED, width: Q3_WIDTH,
    hits: 'pierce', vfx: { kind: 'yasuo_q_tornado', color: WIND, size: 1.2, trail: true }, height: 60,
    onHit: (u) => {
      qStrike(champ, u, rank, isCrit, 'yasuo_q3');
      if (u.alive) u.knockup(Q3_KNOCKUP, champ, 220);
      game.fx.impact({ x: u.x, y: u.y, h: 90, color: WIND, size: 1.1 });
    },
  });
}

// 环形斩（踏前斩期间施放）：在位移终点结算
function eqCircle(champ, rank, tornado, isCrit) {
  const game = champ.game;
  const hits = game.queryUnits({ x: champ.x, y: champ.y, radius: EQ_RADIUS, enemyOf: champ }).filter(validHit);
  game.fx.custom('yasuo_q_circle', { x: champ.x, y: champ.y, unit: champ, radius: EQ_RADIUS, tornado });
  for (const u of hits) {
    qStrike(champ, u, rank, isCrit, tornado ? 'yasuo_eq3' : 'yasuo_eq');
    if (tornado && u.alive) u.knockup(Q3_KNOCKUP, champ, 220);
  }
  if (tornado) clearQStacks(champ);
  else if (hits.length) gainQStack(champ);
}

// 两条线段是否相交（含厚度）：投射物本帧轨迹 vs 风墙
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px, y = ay + dy * t - py;
  return x * x + y * y;
}
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}
export function yasuoWallBlocks(wall, p) {
  const hx = -wall.dirY * wall.half, hy = wall.dirX * wall.half;
  const ax = wall.x - hx, ay = wall.y - hy, bx = wall.x + hx, by = wall.y + hy;
  const px0 = Number.isFinite(p.prevX) ? p.prevX : p.x, py0 = Number.isFinite(p.prevY) ? p.prevY : p.y;
  if (segCross(ax, ay, bx, by, px0, py0, p.x, p.y)) return true;
  const r = W_THICK + Math.min(40, p.width || 0);
  return segDist2(p.x, p.y, ax, ay, bx, by) <= r * r;
}

// R 暴击穿甲：暴击时按「无视 50% 额外护甲」修正伤害
function rPenHook(champ) {
  champ.addHook('beforeDealDamage', (ctx) => {
    if (!ctx.isCrit || ctx.type !== 'physical' || !champ.hasBuff('yasuo_r_pen')) return;
    const t = ctx.target;
    if (!t?.stats) return;
    const s = champ.stats;
    const cur = effectiveResist(t.stats.armor, s.armorPenPct, s.lethality);
    const pen = effectiveResist(t.stats.armor - R_PEN * Math.max(0, t.stats.bonusArmor || 0), s.armorPenPct, s.lethality);
    const m0 = resistMultiplier(cur);
    if (m0 > 0) ctx.amount *= resistMultiplier(pen) / m0;
  });
}

// —— AI 辅助（可选链保护） ——
function aiEnemies(ai, champ, radius) {
  const list = ai?.visibleEnemies?.(radius);
  if (Array.isArray(list)) return list.filter((e) => e && e.alive && e.type === 'champion' && !e.untargetable && champ.distTo(e) <= radius + (e.radius || 0));
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
function aiHp(ai, champ) {
  const v = ai?.hpPct?.();
  return typeof v === 'number' && Number.isFinite(v) ? v : champ.hp / champ.maxHp;
}
function aiCtx(ai) { return typeof ai?.castContext === 'string' ? ai.castContext : null; }
const FARM_CTX = new Set(['farm', 'push', 'jungle']);
const combatOk = (c) => c === null || c === 'fight' || c === 'harass' || c === 'peel';
function aiTarget(ai, champ, radius) {
  const t = ai?.target;
  if (t && t.alive && t.type === 'champion' && t.team !== champ.team && t.isTargetableBy?.(champ) && champ.distTo(t) <= radius + t.radius) return t;
  return aiEnemies(ai, champ, radius)[0] || null;
}
function aiCastAt(ai, champ, slot, x, y) {
  let r;
  try { if (typeof ai?.castAt === 'function') r = ai.castAt(slot, x, y); } catch { r = undefined; }
  if (r == null) r = champ.castAbility(slot, { x, y });
  return r === true || !!r?.ok;
}
function aiCastOn(ai, champ, slot, target) {
  let r;
  try { if (typeof ai?.castOn === 'function') r = ai.castOn(slot, target); } catch { r = undefined; }
  if (r == null) r = champ.castAbility(slot, { target });
  return r === true || !!r?.ok;
}
function eTargetOk(champ, t) {
  if (!t || !t.alive || t.removed || t.team === champ.team || t.untargetable) return false;
  if (t.type !== 'champion' && t.type !== 'minion' && t.type !== 'monster' && t.type !== 'pet') return false;
  if (!t.isTargetableBy(champ)) return false;
  return !t.hasBuff(eMarkId(champ));
}
// E 终点
function eLanding(champ, t) {
  const d = norm(t.x - champ.x, t.y - champ.y, { x: Math.cos(champ.facing), y: Math.sin(champ.facing) });
  return { x: champ.x + d.x * E_DIST, y: champ.y + d.y * E_DIST, dx: d.x, dy: d.y };
}

export default {
  id: 'yasuo',
  name: '亚索',
  title: '疾风剑豪',
  roles: ['mid', 'top'],
  tags: ['战士', '刺客'],
  difficulty: 3,
  lore: '背负弑师污名的艾欧尼亚剑客，以御风剑术浪迹天涯，只为寻找真正的凶手。',
  baseStats: {
    hp: 590, hpPerLevel: 110, hpRegen: 6.5, hpRegenPerLevel: 0.9,
    mana: FLOW_MAX, manaPerLevel: 0, manaRegen: 0, manaRegenPerLevel: 0, resource: 'flow',
    ad: 60, adPerLevel: 3, as: 0.697, asRatio: 0.67, asPerLevel: 3.5,
    armor: 30, armorPerLevel: 4.6, mr: 32, mrPerLevel: 2.05,
    ms: 345, range: 175, radius: 65, windup: 0.22, missileSpeed: 0, critMult: 1.75,
  },
  model: { primary: 0x2f4a7a, secondary: 0x222222, accent: 0x9fe8ff },
  portrait: { bg: ['#3a6a9a', '#0e1a2c'], glyph: '亚' },

  // —— 被动：浪客之道 ——
  passive: {
    id: 'yasuo_passive',
    name: '浪客之道',
    icon: ICONS.P,
    desc: (champ) => {
      const lv = champ?.level || 1;
      return `剑意：亚索移动时积攒剑意（每 ${yasuoFlowPerUnit(lv)} 码 1 点，上限 ${FLOW_MAX}）。剑意满时受到敌方英雄或野怪的伤害，会消耗全部剑意获得 ${fmt(yasuoShield(lv))} 点护盾，持续 ${P_SHIELD_DUR} 秒。\n`
        + `浪客之道：暴击几率翻倍，但暴击伤害降低 10%；超过 100% 的暴击几率每 1% 转化为 ${CRIT_EXCESS_AD} 点攻击力。`;
    },
    init(champ) {
      const st = champ.passive.state;
      st.lx = champ.x; st.ly = champ.y;
      // 暴击翻倍、暴击伤害降低
      champ.addHook('modifyStats', (s) => {
        const raw = s.crit * 2;
        if (raw > 1) { const bonus = (raw - 1) * 100 * CRIT_EXCESS_AD; s.ad += bonus; s.bonusAd += bonus; }
        s.crit = Math.min(1, raw);
        s.critMult *= CRIT_MULT_FACTOR;
      });
      // 剑意满：受到英雄/野怪伤害前生成护盾（可吸收本次伤害）
      champ.addHook('beforeTakeDamage', (ctx) => {
        if (ctx.cancel || !(ctx.amount > 0) || champ.maxMana <= 0 || champ.mana < champ.maxMana - 1e-6) return;
        const s = ctx.source;
        if (!s || s.team === champ.team) return;
        const hostile = s.type === 'champion' || s.type === 'monster' || (s.type === 'pet' && s.owner?.type === 'champion');
        if (!hostile) return;
        champ.mana = 0;
        champ.addShield(yasuoShield(champ.level), P_SHIELD_DUR, { source: champ, id: 'yasuo_passive' });
        champ.modelState.flowFull = false;
        champ.game.fx.custom('yasuo_p_shield', { unit: champ, duration: P_SHIELD_DUR });
      });
      rPenHook(champ);
    },
    update(champ) {
      const st = champ.passive.state;
      const d = Math.hypot(champ.x - st.lx, champ.y - st.ly);
      st.lx = champ.x; st.ly = champ.y;
      if (!champ.alive || champ.maxMana <= 0) return;
      // 单步位移过大视为瞬移（闪现/复活/回城），不计剑意
      if (d > 0 && d < 250 && champ.mana < champ.maxMana) {
        champ.mana = Math.min(champ.maxMana, champ.mana + d / yasuoFlowPerUnit(champ.level));
      }
      champ.modelState.flowFull = champ.mana >= champ.maxMana - 1e-6;
    },
  },

  abilities: {
    // —— Q：斩钢闪 ——
    Q: {
      id: 'yasuo_q',
      name: '斩钢闪',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const n = champ ? qStacks(champ) : 0;
        return `亚索向前突刺 ${Q_RANGE} 码，造成 ${scaleText(champ, rv(Q_BASE, r), [[Q_AD, 'ad']])} 点物理伤害（可暴击）。命中敌人获得 1 层旋风（持续 ${Q_STACK_DUR} 秒），叠满 2 层后下一次斩钢闪变为龙卷风，`
          + `射程 ${Q3_RANGE} 码，穿透并击飞敌人 ${Q3_KNOCKUP} 秒（当前 ${n} 层）。\n`
          + `在踏前斩期间施放会变为环形斩，对周围 ${EQ_RADIUS} 码内敌人造成伤害。\n`
          + `冷却 ${fmt(champ ? yasuoQCooldown(champ) : Q_CD, 2)} 秒、施法时间 ${fmt(champ ? yasuoQCastTime(champ) : Q_CAST, 2)} 秒，均随额外攻击速度降低（不受技能急速影响）。`;
      },
      cooldown: [Q_CD, Q_CD, Q_CD, Q_CD, Q_CD],
      cost: [0, 0, 0, 0, 0],
      costType: 'none',
      range: (champ) => (champ && tornadoReady(champ) ? Q3_RANGE : Q_RANGE),
      targeting: 'direction',
      indicator: { type: 'line', width: Q_WIDTH * 2, length: Q_RANGE },
      // 踏前斩期间瞬发（环形斩）
      castTime: (champ) => (champ?.passive?.state?.eDash ? 0 : yasuoQCastTime(champ)),
      lockMovement: true,
      manualCooldown: true,
      sfx: 'slash',
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const rank = ctx.rank;
        const st = champ.passive.state;
        const isCrit = rollCrit(champ);
        ab.startCooldown(yasuoQCooldown(champ));
        // 环形斩：在踏前斩终点结算
        if (st.eDash) {
          st.eDash.eq = { rank, tornado: tornadoReady(champ), isCrit };
          return;
        }
        if (tornadoReady(champ)) {
          game.fx.custom('yasuo_q_thrust', { unit: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, length: 260, tornado: true });
          castTornado(champ, ctx.dirX, ctx.dirY, rank, isCrit);
          return;
        }
        const x2 = champ.x + ctx.dirX * Q_RANGE, y2 = champ.y + ctx.dirY * Q_RANGE;
        const hits = game.queryLine({ x1: champ.x, y1: champ.y, x2, y2, width: Q_WIDTH, enemyOf: champ }).filter(validHit);
        game.fx.custom('yasuo_q_thrust', { unit: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, length: Q_RANGE, stack: qStacks(champ) });
        for (const u of hits) qStrike(champ, u, rank, isCrit, 'yasuo_q');
        if (hits.length) gainQStack(champ);
      },
      ai: {
        kind: 'nuke', range: Q_RANGE, width: Q_WIDTH, delay: 0.3, farm: true,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, yasuoQDamage(champ, rank), 'physical') : yasuoQDamage(champ, rank)),
        custom: (champ, ab, ai, game) => {
          if (!ab.ready) return false;
          const c = aiCtx(ai);
          const st = champ.passive.state;
          // 踏前斩中：落点附近有敌方英雄（或打野/清线）就放环形斩
          if (st.eDash) {
            const d = champ.dashState;
            const lx = d ? d.tx : champ.x, ly = d ? d.ty : champ.y;
            const foes = game.queryUnits({ x: lx, y: ly, radius: EQ_RADIUS + 30, enemyOf: champ, targetableBy: champ });
            const champHit = foes.some((u) => u.type === 'champion');
            if (champHit || (FARM_CTX.has(c) && foes.length >= 2)) return !!champ.castAbility('Q', { x: lx + 1, y: ly }).ok;
            return false;
          }
          if (champ.dashState) return false;
          const reach = tornadoReady(champ) ? Q3_RANGE - 80 : Q_RANGE + 20;
          // 对线空闲（idle）时也会用 Q 消耗射程内的英雄
          if (combatOk(c) || c === 'idle' || c === 'push') {
            const t = aiTarget(ai, champ, reach);
            if (t && (c !== 'idle' && c !== 'push' || !aiUnderTurret(ai, champ, t.x, t.y))) {
              const delay = yasuoQCastTime(champ) + (tornadoReady(champ) ? champ.distTo(t) / Q3_SPEED : 0);
              const p = aiPredict(ai, t, delay);
              if (Math.hypot(p.x - champ.x, p.y - champ.y) <= reach + t.radius * 0.5) return aiCastAt(ai, champ, 'Q', p.x, p.y);
            }
          }
          if (c === 'escape' || c === 'peel' || c === 'fight') return false;
          // 清线/打野/对线补刀：直线上有目标就放（顺便叠层；龙卷风留给英雄）
          if (tornadoReady(champ) && c !== 'push' && c !== 'jungle') return false;
          const tgt = champ.attackTarget || champ.command?.target;
          if (tgt && tgt.alive && tgt.team !== champ.team && !tgt.isStructure && champ.distTo(tgt) < Q_RANGE) {
            if (aiUnderTurret(ai, champ, tgt.x, tgt.y) && c !== 'push') return false;
            return aiCastAt(ai, champ, 'Q', tgt.x, tgt.y);
          }
          // 对线：Q 能击杀的小兵（补刀 + 叠层）
          if (c === 'idle' || c === 'push' || c === 'harass') {
            const qd = yasuoQDamage(champ, ab.rank);
            const mins = game.queryUnits({ x: champ.x, y: champ.y, radius: Q_RANGE, enemyOf: champ, targetableBy: champ, types: ['minion'] });
            for (const m of mins) {
              if (aiUnderTurret(ai, champ, m.x, m.y)) continue;
              if (c === 'push' || mitigate(champ, m, qd, 'physical') >= m.hp) return aiCastAt(ai, champ, 'Q', m.x, m.y);
            }
          }
          return false;
        },
      },
    },

    // —— W：风之障壁 ——
    W: {
      id: 'yasuo_w',
      name: '风之障壁',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `亚索制造一道向前推进的气流之墙，宽 ${rv(W_WIDTH, r)} 码，持续 ${W_DUR} 秒，阻挡所有敌方投射物（普攻与技能弹道，防御塔攻击除外）。`;
      },
      cooldown: W_CD,
      cost: [0, 0, 0, 0, 0],
      costType: 'none',
      range: W_END,
      targeting: 'direction',
      indicator: { type: 'line', width: 320, length: W_END },
      castTime: 0.013,
      lockMovement: false,
      sfx: 'whoosh',
      cast(champ, ctx) {
        const game = champ.game;
        const wall = {
          x: champ.x + ctx.dirX * W_START, y: champ.y + ctx.dirY * W_START, dirX: ctx.dirX, dirY: ctx.dirY,
          half: rv(W_WIDTH, ctx.rank) / 2, width: rv(W_WIDTH, ctx.rank), duration: W_DUR, team: champ.team,
          sx: champ.x + ctx.dirX * W_START, sy: champ.y + ctx.dirY * W_START, blocked: 0, alive: true,
        };
        champ.passive.state.wall = wall;
        game.fx.custom('yasuo_w_wall', { wall, unit: champ, duration: W_DUR, width: wall.width });
        game.spawnZone({
          owner: champ, x: wall.x, y: wall.y, radius: wall.half, duration: W_DUR, tickInterval: 0, vfx: null, filter: () => false,
          onUpdate: (zone) => {
            // 前推
            const k = Math.min(1, zone.age / W_TRAVEL);
            wall.x = wall.sx + wall.dirX * (W_END - W_START) * k;
            wall.y = wall.sy + wall.dirY * (W_END - W_START) * k;
            zone.x = wall.x; zone.y = wall.y;
            // 拦截敌方投射物
            for (const p of game.projectiles) {
              if (p.dead || p.team === champ.team || p.team === 2) continue;
              if (p.owner && p.owner.isStructure) continue;
              if (p.hits === 'none' && !p.isBasicAttack) continue;
              if (!yasuoWallBlocks(wall, p)) continue;
              wall.blocked++;
              game.fx.custom('yasuo_w_block', { x: p.x, y: p.y, h: p.h, dirX: wall.dirX, dirY: wall.dirY });
              p.kill('windwall');
            }
          },
          onEnd: () => { wall.alive = false; if (champ.passive.state.wall === wall) champ.passive.state.wall = null; },
        });
      },
      ai: {
        kind: 'shield',
        custom: (champ, ab, ai, game) => {
          if (!ab.ready) return false;
          const c = aiCtx(ai);
          if (c === 'farm' || c === 'jungle' || c === 'idle') return false;
          // 找朝自己飞来的敌方英雄技能弹道（或残血时的远程普攻）
          const hp = aiHp(ai, champ);
          for (const p of game.projectiles) {
            if (p.dead || p.team === champ.team || p.team === 2 || !p.owner || p.owner.type !== 'champion') continue;
            if (p.isBasicAttack && (hp > 0.35 || p.target !== champ)) continue;
            if (p.hits === 'none' && !p.isBasicAttack) continue;
            const dx = champ.x - p.x, dy = champ.y - p.y;
            const d = Math.hypot(dx, dy);
            if (d > 700 || d < 120) continue;
            const along = (dx * p.dirX + dy * p.dirY);
            if (along <= 0) continue;
            const off = Math.abs(dx * p.dirY - dy * p.dirX);
            if (p.target !== champ && off > champ.radius + (p.width || 40) + 40) continue;
            return !!champ.castAbility('W', { x: p.x, y: p.y }).ok;
          }
          return false;
        },
      },
    },

    // —— E：踏前斩 ——
    E: {
      id: 'yasuo_e',
      name: '踏前斩',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const n = champ?.getBuff?.('yasuo_e_stack')?.stacks || 0;
        return `亚索冲向一名敌方单位，穿过其身后固定 ${E_DIST} 码，造成 ${scaleText(champ, rv(E_BASE, r), [[E_BAD, 'bonusAd'], [E_AP, 'ap']])} 点魔法伤害。\n`
          + `每次冲刺使下一次踏前斩伤害提高 ${pct(E_STACK_PCT)}（最多 ${pct(E_STACK_PCT * E_MAX_STACKS)}，当前 ${n} 层，持续 ${E_STACK_DUR} 秒）。\n`
          + `同一目标 ${rv(E_TARGET_CD, r)} 秒内不能再次被踏前斩。冲刺速度随额外移动速度提升。`;
      },
      cooldown: E_CD,
      cost: [0, 0, 0, 0, 0],
      costType: 'none',
      range: E_RANGE,
      targeting: 'unit',
      targetFilter: (champ, t) => eTargetOk(champ, t),
      indicator: { type: 'unit' },
      castTime: 0,
      lockMovement: false,
      sfx: 'dash',
      cast(champ, ctx) {
        const game = champ.game;
        const t = ctx.target;
        if (!eTargetOk(champ, t)) return false;
        const rank = ctx.rank;
        const st = champ.passive.state;
        const stacks = champ.getBuff('yasuo_e_stack')?.stacks || 0;
        const dmg = yasuoEDamage(champ, rank, stacks);
        const land = eLanding(champ, t);
        const bonusMs = Math.max(0, champ.stats.moveSpeed - champ.baseStats.ms);
        const speed = 750 + 0.6 * bonusMs;
        let hit = false;
        const strike = () => {
          if (hit || !t.alive) return;
          hit = true;
          game.dealDamage(champ, t, dmg, 'magic', { isAbility: true, spell: 'yasuo_e' });
          game.fx.impact({ x: t.x, y: t.y, h: 90, color: WIND, size: 0.9 });
        };
        const dash = {};
        const ok = champ.dash({
          x: land.x, y: land.y, speed, ignoreWalls: true, hitRadius: 70, hitFilter: (u) => u === t,
          onHitUnit: strike,
          onEnd: () => {
            if (!hit && t.alive && champ.distTo(t) < 300) strike();
            champ.modelState.dashing = false;
            if (st.eDash === dash) st.eDash = null;
            if (dash.eq && champ.alive) eqCircle(champ, dash.eq.rank, dash.eq.tornado, dash.eq.isCrit);
          },
        });
        if (!ok) return false;
        st.eDash = dash;
        champ.modelState.dashing = true;
        t.addBuff({ id: eMarkId(champ), name: '踏前斩', desc: '短时间内不能再次被亚索的踏前斩选中', icon: ICONS.E, source: champ, duration: rv(E_TARGET_CD, rank), isDebuff: true, hidden: true });
        champ.addBuff({
          id: 'yasuo_e_stack', name: '踏前斩', desc: '下一次踏前斩伤害提高', icon: ICONS.E, source: champ,
          duration: E_STACK_DUR, maxStacks: E_MAX_STACKS, stacks: 1, refresh: 'stack',
        });
        game.fx.custom('yasuo_e_dash', { unit: champ, target: t, duration: E_DIST / speed + 0.1 });
      },
      ai: {
        kind: 'gapclose', range: E_RANGE,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, yasuoEDamage(champ, rank, 1), 'magic') : yasuoEDamage(champ, rank, 1)),
        custom: (champ, ab, ai, game) => {
          if (!ab.ready || champ.dashState) return false;
          const c = aiCtx(ai);
          const hp = aiHp(ai, champ);
          // 逃跑：踏前斩到朝泉水方向的单位
          if (c === 'escape') {
            const f = game.fountainOf(champ.team);
            const dir = norm(f.x - champ.x, f.y - champ.y);
            const cands = game.queryUnits({ x: champ.x, y: champ.y, radius: E_RANGE, enemyOf: champ, targetableBy: champ, filter: (u) => eTargetOk(champ, u) });
            for (const u of cands) {
              const l = eLanding(champ, u);
              if (l.dx * dir.x + l.dy * dir.y > 0.5 && !aiUnderTurret(ai, champ, l.x, l.y)) return aiCastOn(ai, champ, 'E', u);
            }
            return false;
          }
          if (combatOk(c) && c !== 'harass') {
            const t = aiTarget(ai, champ, 1100);
            if (t) {
              const d = champ.distTo(t);
              const dive = !!ai?.diving;
              if (!dive && aiUnderTurret(ai, champ, t.x, t.y) && hp < 0.8) return false;
              // 直接 E 敌方英雄（身后落点）
              if (d <= E_RANGE + t.radius && eTargetOk(champ, t) && (d > champ.stats.attackRange + 120 || hp > 0.5)) return aiCastOn(ai, champ, 'E', t);
              // 借小兵/野怪接近
              if (d > champ.stats.attackRange + 200) {
                const cands = game.queryUnits({ x: champ.x, y: champ.y, radius: E_RANGE, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster', 'pet'], filter: (u) => eTargetOk(champ, u) });
                let best = null, bestD = d - 150;
                for (const u of cands) {
                  const l = eLanding(champ, u);
                  const nd = Math.hypot(t.x - l.x, t.y - l.y);
                  if (nd < bestD && (dive || !aiUnderTurret(ai, champ, l.x, l.y))) { bestD = nd; best = u; }
                }
                if (best) return aiCastOn(ai, champ, 'E', best);
              }
            }
          }
          // 补刀 / 清野：可击杀的小兵或正在攻击的野怪
          if (FARM_CTX.has(c) || c === 'idle') {
            const cands = game.queryUnits({ x: champ.x, y: champ.y, radius: E_RANGE, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'], filter: (u) => eTargetOk(champ, u) });
            const foes = aiEnemies(ai, champ, 1400);
            for (const u of cands) {
              const l = eLanding(champ, u);
              if (aiUnderTurret(ai, champ, l.x, l.y)) continue;
              // 对线补刀时不冲到敌方英雄脸上
              if (c === 'idle' && foes.some((e) => Math.hypot(e.x - l.x, e.y - l.y) < 550)) continue;
              const dmg = mitigate(champ, u, yasuoEDamage(champ, ab.rank, champ.getBuff('yasuo_e_stack')?.stacks || 0), 'magic');
              if (u.type === 'minion' && dmg >= u.hp) return aiCastOn(ai, champ, 'E', u);
              if (u.type === 'monster' && c === 'jungle' && (champ.attackTarget === u || champ.command?.target === u)) return aiCastOn(ai, champ, 'E', u);
            }
          }
          return false;
        },
      },
    },

    // —— R：狂风绝息斩 ——
    R: {
      id: 'yasuo_r',
      name: '狂风绝息斩',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `亚索闪现到 ${R_RANGE} 码内一名被击飞的敌方英雄身边，将其与附近 ${R_AOE} 码内所有被击飞的敌方英雄继续滞空 ${R_SUSPEND} 秒，`
          + `造成 ${scaleText(champ, rv(R_BASE, r), [[R_BAD, 'bonusAd']])} 点物理伤害。\n`
          + `施放后剑意充满、斩钢闪层数重置；之后 ${R_PEN_DUR} 秒内暴击无视目标 ${pct(R_PEN)} 额外护甲。`;
      },
      cooldown: R_CD,
      cost: [0, 0, 0],
      costType: 'none',
      range: R_RANGE,
      targeting: 'unit',
      targetFilter: (champ, t) => !!t && t.type === 'champion' && t.team !== champ.team && t.isTargetableBy(champ) && isAirborne(t),
      indicator: { type: 'unit' },
      castTime: 0,
      lockMovement: true,
      sfx: 'slash',
      cast(champ, ctx) {
        const game = champ.game;
        const t = ctx.target;
        if (!t || !t.alive || !isAirborne(t)) return false;
        const rank = ctx.rank;
        const targets = [t, ...game.queryUnits({ x: t.x, y: t.y, radius: R_AOE, enemyOf: champ, types: ['champion'], exclude: t }).filter((u) => isAirborne(u) && !u.untargetable)];
        // 闪到目标身侧（面朝目标）
        const dir = norm(t.x - champ.x, t.y - champ.y, { x: Math.cos(champ.facing), y: Math.sin(champ.facing) });
        const off = (t.radius || 65) + champ.radius * 0.6;
        champ.blink(t.x - dir.x * off, t.y - dir.y * off);
        champ.faceTowards(t.x, t.y);
        champ.stop?.();
        champ.castLock = Math.max(champ.castLock, R_LOCK);
        champ._castLockMove = true;
        champ.playCastAnim?.('R', R_LOCK);
        champ.modelState.lastBreath = true;
        game.after(R_LOCK, () => { champ.modelState.lastBreath = false; });
        const dmg = yasuoRDamage(champ, rank);
        for (const u of targets) {
          if (!u.dashState?.forced) u.knockup(R_SUSPEND, champ, 260);
          else u.applyCC('airborne', R_SUSPEND, { source: champ });
          game.dealDamage(champ, u, dmg, 'physical', { isAbility: true, spell: 'yasuo_r' });
        }
        game.fx.custom('yasuo_r_strike', { unit: champ, target: t, targets, x: t.x, y: t.y, duration: R_SUSPEND });
        // 剑意充满、Q 层数重置、暴击穿甲
        champ.mana = champ.maxMana;
        clearQStacks(champ);
        champ.addBuff({ id: 'yasuo_r_pen', name: '狂风绝息斩', desc: `暴击无视 ${pct(R_PEN)} 额外护甲`, icon: ICONS.R, source: champ, duration: R_PEN_DUR, refresh: 'replace' });
      },
      ai: {
        kind: 'execute', range: R_RANGE,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, yasuoRDamage(champ, rank), 'physical') : yasuoRDamage(champ, rank)),
        custom: (champ, ab, ai, game) => {
          if (!ab.ready) return false;
          const c = aiCtx(ai);
          if (c !== null && c !== 'fight' && c !== 'peel' && c !== 'harass') return false;
          const rDmg = yasuoRDamage(champ, ab.rank);
          const hp = aiHp(ai, champ);
          let best = null, bestScore = 0;
          for (const e of aiEnemies(ai, champ, R_RANGE)) {
            if (!isAirborne(e) || e.ccRemaining('airborne') < 0.1) continue;
            let score = 1;
            const n = game.queryUnits({ x: e.x, y: e.y, radius: R_AOE, enemyOf: champ, types: ['champion'] }).filter(isAirborne).length;
            score += (n - 1) * 1.5;
            if (mitigate(champ, e, rDmg, 'physical') >= e.hp + e.totalShield) score += 2;
            if (e.hp / e.maxHp < 0.6) score += 1;
            if (!ai?.diving && aiUnderTurret(ai, champ, e.x, e.y) && hp < 0.6) score -= 2;
            if (score > bestScore) { bestScore = score; best = e; }
          }
          if (best && bestScore >= 1.8) return aiCastOn(ai, champ, 'R', best);
          return false;
        },
      },
    },
  },

  ai: { skillOrder: ['Q', 'E', 'W'], style: 'bruiser', engageRange: 550, kiteDistance: 0, combo: ['E', 'Q', 'R', 'W'] },
};
