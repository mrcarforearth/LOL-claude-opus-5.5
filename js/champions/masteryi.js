// 英雄：易（无极剑圣）—— 双重打击、阿尔法突袭（不可选中连斩）、冥想（引导回复与减伤）、无极剑道、高原血统（参与击杀减冷却）
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { norm, clamp } from '../core/math.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本） ——
const DS_STACKS = 3;                 // 叠满 3 层后下一次普攻打出双重打击
const DS_DUR = 4;
const DS_RATIO = 0.5;                // 第二击 50% 攻击力
const DS_DELAY = 0.12;

const Q_BASE = [30, 60, 90, 120, 150];
const Q_AD = 0.5;
const Q_MINION = [80, 100, 120, 140, 160];  // 对小兵/野怪额外伤害
const Q_CRIT_AD = 0.6;               // 暴击时额外 60% 攻击力
const Q_REPEAT = 0.25;               // 重复命中同一目标时的伤害比例
const Q_RANGE = 600;
const Q_BOUNCE = 600;
const Q_STRIKES = 4;
const Q_INTERVAL = 0.19;
const Q_TOTAL = Q_INTERVAL * (Q_STRIKES - 1) + 0.18;
const Q_CD = [20, 18.75, 17.5, 16.25, 15];
const Q_COST = [50, 55, 60, 65, 70];
const Q_AA_CDR = 1;                  // 普攻命中减少 1 秒冷却

const W_HEAL = [30, 50, 70, 90, 110];   // 每秒回复
const W_AP = 0.3;
const W_DUR = 4;
const W_TICK = 0.5;
const W_DR_INIT = 0.9;               // 前 0.5 秒 90% 减伤
const W_DR = [0.4, 0.45, 0.5, 0.55, 0.6];
const W_CD = [28, 28, 28, 28, 28];
const W_COST = [50, 50, 50, 50, 50];

const E_TRUE = [30, 35, 40, 45, 50];
const E_BAD = 0.3;
const E_DUR = 5;
const E_CD = [14, 14, 14, 14, 14];

const R_MS = [0.25, 0.35, 0.45];
const R_AS = [0.25, 0.45, 0.65];
const R_DUR = 7;
const R_EXTEND = 7;
const R_CDR = 0.7;                   // 参与击杀：基础技能剩余冷却 -70%
const R_CD = [85, 85, 85];
const R_COST = [100, 100, 100];

const LIME = 0xc8ff5a;
const GOLDEN = 0xffd86a;
const VIOLET = 0xb07aff;

const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('双', '#d8f07a', '#4a5a10'),
  Q: icon('突', '#b8ff6a', '#2a4a0a'),
  W: icon('冥', '#ffe6a0', '#8a6a20'),
  E: icon('剑', '#f0ff8a', '#5a6a10'),
  R: icon('高', '#ffd05a', '#6a3a8a'),
};

// —— 公式 ——
export function yiQDamage(champ, target, rank, { repeat = false, crit = false } = {}) {
  let d = rv(Q_BASE, rank) + Q_AD * (champ?.stats?.ad || 0);
  if (target && (target.type === 'minion' || target.type === 'monster')) d += rv(Q_MINION, rank);
  if (crit) d += Q_CRIT_AD * (champ?.stats?.ad || 0);
  return repeat ? d * Q_REPEAT : d;
}
export function yiWHealPerSec(champ, rank) { return rv(W_HEAL, rank) + W_AP * (champ?.stats?.ap || 0); }
export function yiEDamage(champ, rank) { return rv(E_TRUE, rank) + E_BAD * (champ?.stats?.bonusAd || 0); }

// 双重打击叠层
function addDoubleStrikeStack(champ, n = 1) {
  champ.addBuff({
    id: 'masteryi_ds', name: '双重打击', desc: '叠满 3 层后，下一次普攻会攻击两次', icon: ICONS.P, source: champ,
    duration: DS_DUR, stacks: n, maxStacks: DS_STACKS, refresh: 'stack',
  });
}

// 双重打击的第二击（完整普攻结算：触发攻击特效，50% 伤害）
function secondStrike(champ, target) {
  const game = champ.game;
  if (!champ.alive || !target || !target.alive || target.removed || target.untargetable) return;
  const crit = champ.stats.crit;
  const isCrit = crit > 0 && (crit >= 1 || game.rng() < crit);
  const hit = { damage: 0, type: 'physical', isCrit, extra: [], miss: champ.hasCC('blind'), attacker: champ, masteryiDouble: true };
  game.fx.custom('masteryi_double', { unit: champ, target, x: target.x, y: target.y });
  champ.resolveAttackHit(target, hit);
}

// —— 阿尔法突袭 ——
function qCandidates(champ, center) {
  return champ.game.queryUnits({ x: center.x, y: center.y, radius: Q_BOUNCE, enemyOf: champ, targetableBy: champ })
    .filter((u) => !u.untargetable && !u.invulnerable);
}
function qValid(champ, u) {
  return !!u && u.alive && !u.removed && !u.untargetable && u.isTargetableBy(champ);
}
// 选择下一次闪击目标：优先未命中的英雄 → 未命中的其他单位 → 重复命中（主目标优先）
function qPickNext(champ, st) {
  if (st.count === 0) return qValid(champ, st.primary) ? st.primary : null;
  const center = qValid(champ, st.last) ? st.last : st.primary;
  const cands = qCandidates(champ, center || champ);
  const fresh = cands.filter((u) => !st.hit.has(u));
  const freshChamp = fresh.find((u) => u.type === 'champion');
  if (freshChamp) return freshChamp;
  if (fresh.length) return fresh[0];
  if (qValid(champ, st.primary) && champ.distTo(st.primary) < Q_BOUNCE + 300) return st.primary;
  return cands.find((u) => st.hit.has(u)) || null;
}
function qStrike(champ, st) {
  const game = champ.game;
  const t = qPickNext(champ, st);
  st.count++;
  if (!t) return false;
  const repeat = st.hit.has(t);
  st.hit.add(t);
  st.last = t;
  const fromX = champ.x, fromY = champ.y;
  // 闪到目标身侧（每一击换一个角度）
  const base = Math.atan2(st.oy - t.y, st.ox - t.x);
  const a = base + (st.count % 2 === 0 ? 1 : -1) * (0.9 + 0.5 * st.count);
  const off = t.radius + 45;
  champ.blink(t.x + Math.cos(a) * off, t.y + Math.sin(a) * off);
  champ.faceTowards(t.x, t.y);
  const c = champ.stats.crit;
  const crit = c > 0 && (c >= 1 || game.rng() < c);
  game.dealDamage(champ, t, yiQDamage(champ, t, st.rank, { repeat, crit }), 'physical', { isAbility: true, isCrit: crit, spell: 'masteryi_q' });
  game.fx.custom('masteryi_q_strike', { x: t.x, y: t.y, fromX, fromY, toX: champ.x, toY: champ.y, index: st.count, crit, target: t });
  return true;
}
function qFinish(champ, st) {
  if (st.finished) return;
  st.finished = true;
  champ.untargetable = false;
  champ.modelState.hidden = false;
  champ.removeBuff('masteryi_q');
  if (!champ.alive) return;
  const t = qValid(champ, st.last) ? st.last : null;
  if (t) {
    // 出现在最后一个目标身边（靠近起点一侧）
    const dir = norm(st.ox - t.x, st.oy - t.y, { x: Math.cos(champ.facing + Math.PI), y: Math.sin(champ.facing + Math.PI) });
    const off = t.radius + champ.radius + 10;
    champ.blink(t.x + dir.x * off, t.y + dir.y * off);
    champ.faceTowards(t.x, t.y);
  }
  champ.game.fx.custom('masteryi_q_end', { unit: champ, x: champ.x, y: champ.y });
  // 恢复施放前的普攻命令
  const prev = st.prevCmd;
  if (prev && prev.type === 'attack' && prev.target && prev.target.alive && !prev.target.untargetable && !champ.command) champ.attackUnit(prev.target);
}

// —— AI 辅助（可选链保护：AI 未实现对应接口时回退到自行查询） ——
function aiEnemies(ai, champ, radius) {
  const list = ai?.visibleEnemies?.(radius);
  if (Array.isArray(list)) return list.filter((e) => e && e.alive && e.type === 'champion' && champ.distTo(e) <= radius + (e.radius || 0));
  return champ.game.queryUnits({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
}
function aiAllies(ai, champ, radius) {
  const list = ai?.nearbyAllies?.(radius);
  if (Array.isArray(list)) return list.filter((a) => a && a.alive && a !== champ);
  return champ.game.queryUnits({ x: champ.x, y: champ.y, radius, allyOf: champ, types: ['champion'], exclude: champ });
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
function aiParam(ai, key, def) {
  const v = ai?.params?.[key];
  return typeof v === 'number' ? v : def;
}
function aiHp(ai, champ) {
  const v = ai?.hpPct?.();
  return typeof v === 'number' && Number.isFinite(v) ? v : champ.hp / champ.maxHp;
}
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
// AI 施法场景（fight/harass/farm/push/jungle/escape/peel/idle）；AI 未提供时返回 null（不限制）
function aiContext(ai) { return typeof ai?.castContext === 'string' ? ai.castContext : null; }
const FARM_CTX = new Set(['farm', 'push', 'jungle']);
function aiChampTarget(ai, champ, radius) {
  const t = ai?.target;
  if (t && t.alive && t.type === 'champion' && t.team !== champ.team && t.isTargetableBy(champ) && champ.distTo(t) <= radius + t.radius) return t;
  return aiEnemies(ai, champ, radius)[0] || null;
}
function currentMonster(champ) {
  const t = champ.attackTarget || champ.command?.target;
  return t && t.alive && t.type === 'monster' ? t : null;
}

// 检测即将命中易的敌方英雄技能（投射物 / 即将生效的区域），返回威胁对象或 null
export function incomingThreat(champ, game, horizon = 0.4) {
  for (const p of game.projectiles) {
    if (p.dead || p.isBasicAttack || p.team === champ.team || p.returning) continue;
    const owner = p.owner;
    if (!owner || (owner.type !== 'champion' && owner.owner?.type !== 'champion')) continue;
    if (p.homing) {
      if (p.target === champ && Math.hypot(p.x - champ.x, p.y - champ.y) / Math.max(1, p.speed) < horizon) return p;
      continue;
    }
    const rx = champ.x - p.x, ry = champ.y - p.y;
    const along = rx * p.dirX + ry * p.dirY;
    if (along < -champ.radius) continue;
    if (along > p.range - p.traveled + champ.radius) continue;
    const perp = Math.abs(rx * p.dirY - ry * p.dirX);
    if (perp > p.width + champ.radius + 25) continue;
    if (along / Math.max(1, p.speed) < horizon) return p;
  }
  for (const z of game.zones) {
    if (z.dead || z.team === champ.team || !z.owner || z.owner.type !== 'champion') continue;
    const left = z.delay - z.age;
    if (left <= 0 || left > horizon) continue;
    if (Math.hypot(z.x - champ.x, z.y - champ.y) <= z.radius + champ.radius) return z;
  }
  return null;
}

// 阿尔法突袭可选目标：优先英雄，其次最近的单位
function qTargetNear(champ, game, preferChamp = true) {
  const list = game.queryUnits({ x: champ.x, y: champ.y, radius: Q_RANGE, enemyOf: champ, targetableBy: champ })
    .filter((u) => !u.untargetable && !u.invulnerable);
  if (preferChamp) { const c = list.find((u) => u.type === 'champion'); if (c) return c; }
  return list[0] || null;
}

export default {
  id: 'masteryi',
  name: '易',
  title: '无极剑圣',
  roles: ['jungle'],
  tags: ['刺客', '战士'],
  difficulty: 1,
  lore: '无极剑道最后的传人，身形与剑意合一，快到敌人只能看见残影。',
  baseStats: {
    hp: 669, hpPerLevel: 105, hpRegen: 7.5, hpRegenPerLevel: 0.65,
    mana: 251, manaPerLevel: 42, manaRegen: 7.26, manaRegenPerLevel: 0.45, resource: 'mana',
    ad: 65, adPerLevel: 2.2, as: 0.679, asRatio: 0.679, asPerLevel: 2,
    armor: 33, armorPerLevel: 4.2, mr: 32, mrPerLevel: 2.05,
    ms: 355, range: 125, radius: 65, windup: 0.22, missileSpeed: 0, critMult: 1.75,
  },
  model: { primary: 0x7a8a2a, secondary: 0x2a3a1a, accent: 0xb8ff5a },
  portrait: { bg: ['#6a8a2a', '#141c08'], glyph: '易' },

  // —— 被动：双重打击 ——
  passive: {
    id: 'masteryi_passive',
    name: '双重打击',
    icon: ICONS.P,
    desc: (champ) => `每第 4 次连续普攻会攻击两次，第二击造成 ${fmt(DS_RATIO * (champ?.stats?.ad || 0))}（${pct(DS_RATIO)} 攻击力）点物理伤害，并触发攻击特效。`
      + `\n冥想期间每秒获得 1 层双重打击。`,
    init(champ) {
      // 第二击伤害减半（此钩子最先注册，先于其他攻击特效）
      champ.addHook('onHit', (target, hit) => { if (hit.masteryiDouble) hit.damage *= DS_RATIO; });
      champ.addHook('afterHit', (target, hit) => {
        if (hit.masteryiDouble) return;
        const b = champ.getBuff('masteryi_ds');
        if (b && b.stacks >= DS_STACKS) {
          champ.removeBuff(b);
          champ.game.after(DS_DELAY, () => secondStrike(champ, target));
        } else {
          addDoubleStrikeStack(champ, 1);
        }
      });
    },
  },

  abilities: {
    // —— Q：阿尔法突袭 ——
    Q: {
      id: 'masteryi_q',
      name: '阿尔法突袭',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `易化身残影，在目标附近 ${Q_BOUNCE} 码内依次闪击最多 ${Q_STRIKES} 个敌人（优先不同目标），`
          + `每次造成 ${scaleText(champ, rv(Q_BASE, r), [[Q_AD, 'ad']])} 点物理伤害，对小兵和野怪额外造成 ${rv(Q_MINION, r)} 点伤害。`
          + `闪击可以暴击，额外造成 ${pct(Q_CRIT_AD)} 攻击力的伤害；重复命中同一目标只造成 ${pct(Q_REPEAT)} 伤害。\n`
          + `突袭期间易无法被选取，结束后出现在最后一个目标身边。\n易的普攻每次命中会使阿尔法突袭的冷却时间减少 ${Q_AA_CDR} 秒。`;
      },
      cooldown: Q_CD,
      cost: Q_COST,
      range: Q_RANGE,
      targeting: 'unit',
      targetFilter: 'enemy',
      indicator: { type: 'unit' },
      castTime: 0,
      lockMovement: true,
      sfx: 'slash',
      onLearn(champ, ab) {
        champ.addHook('afterHit', (target, hit) => {
          if (ab.rank > 0 && !champ.hasBuff('masteryi_q')) ab.reduceCooldown(Q_AA_CDR);
        });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const t = ctx.target;
        if (!t || !t.alive) return false;
        const st = {
          rank: ctx.rank, primary: t, last: t, hit: new Set(), count: 0,
          ox: champ.x, oy: champ.y, prevCmd: champ.command, finished: false,
        };
        champ.attackState = null;
        champ.untargetable = true;
        champ.modelState.hidden = true;
        game.fx.custom('masteryi_q_start', { unit: champ, x: champ.x, y: champ.y, target: t });
        champ.addBuff({
          id: 'masteryi_q', name: '阿尔法突袭', desc: '无法被选取', icon: ICONS.Q, source: champ, hidden: true,
          duration: Q_TOTAL + 0.5, refresh: 'replace', disableAttack: true, ghosted: true,
          onRemove: (u) => { if (!st.finished) { u.untargetable = false; u.modelState.hidden = false; } },
        });
        champ.startChannel({
          id: 'masteryi_q', duration: Q_TOTAL, interruptOnMove: false, canMove: false, anim: 'dash', data: st,
          onTick: (u, ch) => {
            while (st.count < Q_STRIKES && ch.t >= st.count * Q_INTERVAL - 1e-9) qStrike(u, st);
          },
          onComplete: (u) => qFinish(u, st),
          onInterrupt: (u) => qFinish(u, st),
        });
        qStrike(champ, st);
      },
      ai: {
        kind: 'gapclose', range: Q_RANGE, farm: true,
        // 单体：首击全额 + 3 次 25%
        damage: (champ, target, rank) => {
          const raw = yiQDamage(champ, target, rank) * (1 + 3 * Q_REPEAT);
          return target ? mitigate(champ, target, raw, 'physical') : raw;
        },
        custom: (champ, ab, ai, game) => {
          if (champ.hasBuff('masteryi_q') || !ab.ready || !champ._canPay(ab.costType, ab.cost)) return false;
          const ctx = aiContext(ai);
          const st = ab.state;
          // —— 躲避来袭的敌方技能（任何场景） ——
          const threat = incomingThreat(champ, game, 0.4);
          if (threat) {
            st.rolled = st.rolled || new Set();
            const key = `${threat.constructor?.name}:${threat.id}`;
            if (!st.rolled.has(key)) {
              st.rolled.add(key);
              if (st.rolled.size > 50) st.rolled.clear();
              st.dodgeOk = game.rng() < 0.35 + aiParam(ai, 'dodge', 0.35);
            }
            if (st.dodgeOk) {
              const t = qTargetNear(champ, game, ctx !== 'escape');
              if (t && aiCast(ai, champ, 'Q', { target: t })) return true;
            }
          }
          if (ctx === 'idle') return false;
          // —— 逃跑：闪到朝泉水方向的敌方单位身上 ——
          if (ctx === 'escape') {
            if (aiHp(ai, champ) > 0.45 || aiEnemies(ai, champ, 700).length === 0) return false;
            const f = game.fountainOf(champ.team);
            const dir = norm(f.x - champ.x, f.y - champ.y);
            const cands = game.queryUnits({ x: champ.x, y: champ.y, radius: Q_RANGE, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'] });
            const t = cands.find((u) => ((u.x - champ.x) * dir.x + (u.y - champ.y) * dir.y) > 250);
            return t ? aiCast(ai, champ, 'Q', { target: t }) : false;
          }
          // —— 追击 / 收割 ——
          if (!FARM_CTX.has(ctx)) {
            const t = aiChampTarget(ai, champ, Q_RANGE);
            if (t) {
              const d = champ.distTo(t);
              const reach = champ.stats.attackRange + champ.radius + t.radius;
              const low = t.hp / t.maxHp < 0.35;
              const underT = aiUnderTurret(ai, champ, t.x, t.y) && !ai?.diving;
              if (ctx === 'harass' && !low) return false;
              if ((!underT || low) && (d > reach + 80 || low || aiEnemies(ai, champ, 800).length >= 3)) {
                return aiCast(ai, champ, 'Q', { target: t });
              }
              return false;
            }
            if (ctx) return false;
          }
          // —— 清野 ——
          const mon = currentMonster(champ);
          if (mon && champ.distTo(mon) < Q_RANGE && champ.mana / Math.max(1, champ.maxMana) > 0.35) {
            const pack = game.queryUnits({ x: mon.x, y: mon.y, radius: Q_BOUNCE, enemyOf: champ, targetableBy: champ, types: ['monster'] });
            if (pack.length >= 2 || mon.large !== false) return aiCast(ai, champ, 'Q', { target: mon });
          }
          return false;
        },
      },
    },

    // —— W：冥想 ——    // —— W：冥想 ——
    W: {
      id: 'masteryi_w',
      name: '冥想',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const per = yiWHealPerSec(champ, r);
        return `易引导冥想，最多 ${W_DUR} 秒，每秒回复 ${scaleText(champ, rv(W_HEAL, r), [[W_AP, 'ap']])} 点生命值（按已损失生命值最多提高 100%，最多共 ${fmt(per * W_DUR * 2)}）。\n`
          + `冥想期间受到的伤害降低 ${pct(W_DR_INIT)}（前 0.5 秒），之后降低 ${pct(rv(W_DR, r))}。`
          + `每引导 1 秒获得 1 层双重打击，并暂停无极剑道与高原血统的持续时间。该技能会重置普攻计时。移动会打断冥想。`;
      },
      cooldown: W_CD,
      cost: W_COST,
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: 120 },
      castTime: 0,
      lockMovement: false,
      sfx: 'heal',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        champ.resetAttack();
        champ.addBuff({
          id: 'masteryi_w', name: '冥想', desc: '受到的伤害大幅降低，持续回复生命值', icon: ICONS.W, source: champ,
          duration: W_DUR + 0.05, refresh: 'replace',
          statsFn: (u, b) => ({ damageReduction: b.elapsed < 0.5 ? W_DR_INIT : rv(W_DR, rank) }),
          onApply: (u) => { u.modelState.meditating = true; },
          onRemove: (u) => { u.modelState.meditating = false; },
        });
        game.fx.custom('masteryi_w_meditate', { unit: champ, duration: W_DUR });
        const data = { heals: 0, stacks: 0 };
        const end = (u) => u.removeBuff('masteryi_w');
        champ.startChannel({
          id: 'masteryi_w', duration: W_DUR, interruptOnMove: true, canMove: false, anim: 'channel', data,
          onTick: (u, ch, dt) => {
            // 每 0.5 秒回复（按已损失生命值提高）
            while (data.heals < Math.floor((ch.t + 1e-6) / W_TICK) && data.heals < W_DUR / W_TICK) {
              data.heals++;
              const miss = clamp(1 - u.hp / u.maxHp, 0, 1);
              game.heal(u, u, yiWHealPerSec(u, rank) * W_TICK * (1 + miss), { spell: 'masteryi_w' });
            }
            // 每秒 1 层双重打击
            while (data.stacks < Math.floor((ch.t + 1e-6) / 1)) { data.stacks++; addDoubleStrikeStack(u, 1); }
            // 暂停无极剑道与高原血统
            for (const id of ['masteryi_e', 'masteryi_r']) {
              const b = u.getBuff(id);
              if (b) { b.expiresAt += dt; b.duration += dt; }
            }
          },
          onComplete: end,
          onInterrupt: end,
        });
      },
      ai: {
        kind: 'heal',
        damage: () => 0,
        custom: (champ, ab, ai, game) => {
          if (champ.channel || champ.hasBuff('masteryi_q')) return false;
          const ctx = aiContext(ai);
          const hp = aiHp(ai, champ);
          if (hp > 0.4) return false;
          const threats = aiEnemies(ai, champ, 700);
          // 安全时回血
          if (threats.length === 0 && hp < 0.3 && game.time - champ.lastDamagedAt > 0.6) {
            const mon = currentMonster(champ);
            if (!mon || champ.distTo(mon) > 350) return aiCast(ai, champ, 'W');
          }
          // 交战中残血：对手更健康时用减伤硬吃伤害
          if (threats.length && hp < 0.25 && game.time - champ.lastDamagedAt < 0.5 && (ctx === null || ctx === 'fight')) {
            const t = threats[0];
            if (t.hp / t.maxHp > hp + 0.1 || threats.length >= 2) return aiCast(ai, champ, 'W');
          }
          // 打野续航
          const mon = currentMonster(champ);
          if (mon && threats.length === 0 && hp < 0.35 && mon.hp > champ.stats.ad * 3) return aiCast(ai, champ, 'W');
          return false;
        },
      },
    },

    // —— E：无极剑道 ——
    E: {
      id: 'masteryi_e',
      name: '无极剑道',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `易的剑刃灌注无极之力，在 ${E_DUR} 秒内普攻额外造成 ${scaleText(champ, rv(E_TRUE, r), [[E_BAD, 'bonusAd']])} 点真实伤害。`;
      },
      cooldown: E_CD,
      cost: [0, 0, 0, 0, 0],
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: 150 },
      castTime: 0,
      lockMovement: false,
      keepChannel: true,
      sfx: 'buff',
      onLearn(champ) {
        champ.addHook('onHit', (target, hit) => {
          const b = champ.getBuff('masteryi_e');
          if (!b || target.isStructure) return;
          hit.extra.push({ amount: yiEDamage(champ, b.data.rank), type: 'true', spell: 'masteryi_e' });
        });
      },
      cast(champ, ctx) {
        champ.addBuff({
          id: 'masteryi_e', name: '无极剑道', desc: '普攻额外造成真实伤害', icon: ICONS.E, source: champ,
          duration: E_DUR, refresh: 'replace', data: { rank: ctx.rank },
          onApply: (u) => { u.modelState.wuju = true; },
          onRemove: (u) => { u.modelState.wuju = false; },
        });
        champ.game.fx.custom('masteryi_e_wuju', { unit: champ, duration: E_DUR });
      },
      ai: {
        kind: 'selfbuff', range: 200, farm: true,
        // 按 5 秒内的普攻次数估算真实伤害
        damage: (champ, target, rank) => yiEDamage(champ, rank) * Math.max(1, Math.floor(Math.min(2.5, champ.stats.attackSpeed) * 3)),
        when: (champ, target) => !!target && target.alive && champ.inAttackRange(target, 80)
          && (target.type === 'champion' || (target.type === 'monster' && target.hp > champ.stats.ad * 2)),
      },
    },

    // —— R：高原血统 ——
    R: {
      id: 'masteryi_r',
      name: '高原血统',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `被动：参与击杀敌方英雄时，易的基础技能剩余冷却时间减少 ${pct(R_CDR)}。\n`
          + `主动：易获得 ${pct(rv(R_MS, r))} 移动速度和 ${pct(rv(R_AS, r))} 攻击速度，并免疫减速效果，持续 ${R_DUR} 秒。`
          + `持续期间参与击杀会使持续时间延长 ${R_EXTEND} 秒。`;
      },
      cooldown: R_CD,
      cost: R_COST,
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: 200 },
      castTime: 0,
      lockMovement: false,
      keepChannel: true,
      sfx: 'roar',
      onLearn(champ) {
        champ.addHook('onTakedown', (victim) => {
          if (!victim || victim.type !== 'champion') return;
          for (const s of ['Q', 'W', 'E']) {
            const ab = champ.abilities[s];
            if (ab.rank > 0) ab.reduceCooldownPct(R_CDR);
          }
          const b = champ.getBuff('masteryi_r');
          if (b) { b.expiresAt += R_EXTEND; b.duration += R_EXTEND; }
          champ.game.fx.custom('masteryi_r_takedown', { unit: champ });
        });
      },
      cast(champ, ctx) {
        const rank = ctx.rank;
        champ.removeCC('slow');
        champ.addBuff({
          id: 'masteryi_r', name: '高原血统', desc: '移动速度与攻击速度提升，免疫减速', icon: ICONS.R, source: champ,
          duration: R_DUR, refresh: 'replace',
          stats: { moveSpeedPct: rv(R_MS, rank), attackSpeed: rv(R_AS, rank), slowResist: 1 },
          onApply: (u) => { u.modelState.highlander = true; },
          onRemove: (u) => { u.modelState.highlander = false; },
        });
        champ.game.fx.custom('masteryi_r_highlander', { unit: champ, duration: R_DUR });
      },
      ai: {
        kind: 'selfbuff', range: 900,
        damage: () => 0,
        // 追击、被减速、目标残血或团战开团时使用
        when: (champ, target, game) => {
          if (!target || target.type !== 'champion' || !target.alive) return false;
          const d = champ.distTo(target);
          if (d > 1000) return false;
          const reach = champ.stats.attackRange + champ.radius + target.radius;
          return d > reach + 150 || target.hp / target.maxHp < 0.6 || champ.hasCC('slow')
            || game.queryUnits({ x: champ.x, y: champ.y, radius: 1200, enemyOf: champ, types: ['champion'] }).length >= 2;
        },
      },
    },
  },

  ai: { skillOrder: ['Q', 'E', 'W'], style: 'assassin', engageRange: 600, kiteDistance: 0, combo: ['Q', 'R', 'E', 'W'] },
};
