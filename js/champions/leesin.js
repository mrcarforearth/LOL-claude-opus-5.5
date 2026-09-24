// 英雄：李青（盲僧）—— 疾风骤雨、天音波/回音击、金钟罩/铁布衫（摸眼）、天雷破/摧筋断骨、猛龙摆尾（踢飞撞击）
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { norm, clamp } from '../core/math.js';
import { TRINKET } from '../config.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本） ——
const FLURRY_AS = 0.4;              // 疾风骤雨攻速加成
const FLURRY_DUR = 3;
const FLURRY_ENERGY = [20, 10];     // 第 1/2 次普攻回复能量

const Q_BASE = [55, 80, 105, 130, 155];
const Q_BAD = 1.15;
const Q_RANGE = 1200;
const Q_WIDTH = 60;
const Q_SPEED = 1800;
const Q_COST = 50;
const Q2_COST = 25;
const Q_CD = [10, 9, 8, 7, 6];
const Q_WINDOW = 3;                 // 回音击再次施放窗口 / 标记持续时间
const Q2_SPEED = 1500;

const W_RANGE = 700;
const W_SHIELD = [55, 90, 125, 160, 195];
const W_AP = 0.8;
const W_SHIELD_DUR = 2;
const W2_VAMP = [0.05, 0.1, 0.15, 0.2, 0.25];   // 铁布衫生命偷取与全能吸血
const W2_DUR = 4;
const W_CD = [12, 12, 12, 12, 12];
const W_COST = 50;
const W2_COST = 25;
const W_WINDOW = 3;
const W_DASH_SPEED = 1700;
const W_TYPES = new Set(['champion', 'minion', 'pet', 'ward']);

const E_RADIUS = 450;
const E_BASE = [35, 70, 105, 140, 175];
const E_AD = 1.0;
const E_REVEAL = 4;
const E2_SLOW = [0.2, 0.35, 0.5, 0.65, 0.8];
const E2_DUR = 4;
const E_CD = [8, 8, 8, 8, 8];
const E_COST = 50;
const E2_COST = 30;
const E_WINDOW = 3;

const R_RANGE = 375;
const R_BASE = [175, 400, 625];
const R_BAD = 2.0;
const R_BONUS_HP = [0.12, 0.15, 0.18];  // 撞击伤害：被踢目标额外生命值比例
const R_KICK = 700;
const R_KICK_DUR = 0.7;
const R_KNOCKUP = 1;
const R_CD = [110, 85, 60];

const GOLD = 0xffc860;
const SKY = 0x7ac8ff;
const FLAME = 0xff7a2a;

const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('疾', '#ffd27a', '#7a4a10'),
  Q: icon('音', '#7ac8ff', '#16305a'),
  Q2: icon('回', '#9ad8ff', '#1a3a6a'),
  W: icon('罩', '#ffe08a', '#8a6010'),
  W2: icon('铁', '#f0c070', '#6a4010'),
  E: icon('雷', '#a0d8ff', '#1c4a7a'),
  E2: icon('筋', '#8ab8e8', '#1a3050'),
  R: icon('龙', '#ff8a3a', '#7a1a00'),
};

// —— 公式 ——
export function leeQ1Damage(champ, rank) { return rv(Q_BASE, rank) + Q_BAD * (champ?.stats?.bonusAd || 0); }
// 回音击：按目标已损失生命值提高 0~100%
export function leeQ2Damage(champ, target, rank) {
  const miss = target && target.maxHp > 0 ? clamp(1 - target.hp / target.maxHp, 0, 1) : 0;
  return leeQ1Damage(champ, rank) * (1 + miss);
}
export function leeWShield(champ, rank) { return rv(W_SHIELD, rank) + W_AP * (champ?.stats?.ap || 0); }
export function leeEDamage(champ, rank) { return rv(E_BASE, rank) + E_AD * (champ?.stats?.ad || 0); }
export function leeRDamage(champ, rank) { return rv(R_BASE, rank) + R_BAD * (champ?.stats?.bonusAd || 0); }

// 回复能量
function restoreEnergy(champ, amount) {
  if (champ.maxMana > 0) champ.mana = Math.min(champ.maxMana, champ.mana + amount);
}
// 手动支付再次施放的能量
function payEnergy(champ, amount) {
  if (champ.mana < amount - 1e-6) return false;
  champ.mana -= amount;
  return true;
}

// 找到施法者在某单位上施加的某类控制
function ccFrom(unit, type, source) {
  for (const c of unit.ccs) if (c.type === type && c.source === source) return c;
  return null;
}

// W1 目标：友方英雄/小兵/召唤物/守卫（含自己）
function wTargetOk(champ, t) {
  return !!t && t.alive && !t.removed && t.team === champ.team && !t.untargetable && W_TYPES.has(t.type);
}

// 金钟罩：给自己与友方英雄护盾
function safeguardShield(champ, target, rank) {
  const game = champ.game;
  const amount = leeWShield(champ, rank);
  champ.addShield(amount, W_SHIELD_DUR, { source: champ, id: 'leesin_w' });
  game.fx.custom('leesin_w_shield', { unit: champ, duration: W_SHIELD_DUR });
  if (target && target !== champ && target.type === 'champion' && target.alive) {
    target.addShield(amount, W_SHIELD_DUR, { source: champ, id: 'leesin_w' });
    game.fx.custom('leesin_w_shield', { unit: target, duration: W_SHIELD_DUR });
  }
}

// 被踢目标的落点（撞墙停止）
function kickLanding(game, t, dir) {
  const ex = t.x + dir.x * R_KICK, ey = t.y + dir.y * R_KICK;
  const p = game.nav.raycastWalk ? game.nav.raycastWalk(t.x, t.y, ex, ey) : { x: ex, y: ey };
  return p || { x: ex, y: ey };
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
  if (!ab?.isRecastActive) {
    try {
      if (tg === 'unit' && target && typeof ai?.castOn === 'function') r = ai.castOn(slot, target);
      else if ((tg === 'self' || tg === 'none') && typeof ai?.castSelf === 'function') r = ai.castSelf(slot);
      else if (x != null && typeof ai?.castAt === 'function' && ai.castAt.length <= 4) r = ai.castAt(slot, x, y);
    } catch (err) {
      r = undefined;
    }
  }
  if (r === undefined || r === null) r = champ.castAbility(slot, { target, x, y });
  return r === true || !!r?.ok;
}
// AI 施法场景（fight/harass/farm/push/jungle/escape/peel/idle）；AI 未提供时返回 null（不限制）
function aiContext(ai) { return typeof ai?.castContext === 'string' ? ai.castContext : null; }
const FARM_CTX = new Set(['farm', 'push', 'jungle']);
const COMBAT_CTX = new Set(['fight', 'harass', 'peel']);
const combatOk = (ctx) => ctx === null || COMBAT_CTX.has(ctx);
const farmOk = (ctx) => ctx === null || FARM_CTX.has(ctx);
// 当前可攻击的英雄目标：优先 AI 集火目标
function aiChampTarget(ai, champ, radius) {
  const t = ai?.target;
  if (t && t.alive && t.type === 'champion' && t.team !== champ.team && t.isTargetableBy(champ) && champ.distTo(t) <= radius + t.radius) return t;
  return aiEnemies(ai, champ, radius)[0] || null;
}
// 正在攻击的野怪
function currentMonster(champ) {
  const t = champ.attackTarget || champ.command?.target;
  return t && t.alive && t.type === 'monster' ? t : null;
}

// 摸眼：向 (x, y) 放置饰品守卫并金钟罩过去
function wardJump(champ, x, y) {
  const game = champ.game;
  const w = champ.abilities.W;
  if (!w.ready || w.isRecastActive || champ.mana < W_COST) return false;
  if (!champ.trinket || champ.trinket.charges <= 0) return false;
  const d = Math.hypot(x - champ.x, y - champ.y);
  if (d > TRINKET.RANGE - 5) {
    const k = (TRINKET.RANGE - 10) / d;
    x = champ.x + (x - champ.x) * k; y = champ.y + (y - champ.y) * k;
  }
  if (!champ.useTrinket(x, y).ok) return false;
  let ward = null;
  for (const wd of game.wards) if (wd.owner === champ && wd.alive && !wd.removed && (!ward || wd.placedAt >= ward.placedAt)) ward = wd;
  if (!ward) return false;
  return !!champ.castAbility('W', { target: ward }).ok;
}

// 逃生：朝泉水方向金钟罩到友方单位，没有就摸眼
function escapeHop(champ, game) {
  const f = game.fountainOf(champ.team);
  const dir = norm(f.x - champ.x, f.y - champ.y);
  const cands = game.queryUnits({
    x: champ.x, y: champ.y, radius: W_RANGE, allyOf: champ, types: ['champion', 'minion', 'pet', 'ward'],
    filter: (u) => u !== champ && !u.untargetable,
  });
  let best = null, bestProj = 250;
  for (const u of cands) {
    const dx = u.x - champ.x, dy = u.y - champ.y;
    const d = Math.hypot(dx, dy) || 1;
    const proj = dx * dir.x + dy * dir.y;
    if (proj / d < 0.5) continue;
    if (proj > bestProj) { bestProj = proj; best = u; }
  }
  if (best && champ.castAbility('W', { target: best }).ok) return true;
  return wardJump(champ, champ.x + dir.x * (TRINKET.RANGE - 20), champ.y + dir.y * (TRINKET.RANGE - 20));
}

export default {
  id: 'leesin',
  name: '李青',
  title: '盲僧',
  roles: ['jungle'],
  tags: ['战士', '刺客'],
  difficulty: 3,
  lore: '精通艾欧尼亚古老武艺的盲眼武僧，以声波感知世界，以一记猛龙摆尾改变战局。',
  baseStats: {
    hp: 645, hpPerLevel: 108, hpRegen: 7.5, hpRegenPerLevel: 0.7,
    mana: 200, manaPerLevel: 0, manaRegen: 50, manaRegenPerLevel: 0, resource: 'energy',
    ad: 69, adPerLevel: 3.7, as: 0.651, asRatio: 0.651, asPerLevel: 3,
    armor: 36, armorPerLevel: 4.9, mr: 32, mrPerLevel: 2.05,
    ms: 345, range: 125, radius: 65, windup: 0.25, missileSpeed: 0, critMult: 1.75,
  },
  model: { primary: 0xc8702a, secondary: 0x3a2a1a, accent: 0xffc860 },
  portrait: { bg: ['#b8742a', '#2a1808'], glyph: '李' },

  // —— 被动：疾风骤雨 ——
  passive: {
    id: 'leesin_passive',
    name: '疾风骤雨',
    icon: ICONS.P,
    desc: () => `李青施放技能后，接下来 ${FLURRY_DUR} 秒内的 2 次普攻获得 ${pct(FLURRY_AS)} 攻击速度，`
      + `并分别回复 ${FLURRY_ENERGY[0]} / ${FLURRY_ENERGY[1]} 点能量。`,
    init(champ) {
      champ.addHook('onAbilityCast', () => {
        champ.addBuff({
          id: 'leesin_flurry', name: '疾风骤雨', desc: '接下来的普攻获得攻击速度并回复能量', icon: ICONS.P, source: champ,
          duration: FLURRY_DUR, stacks: 2, maxStacks: 2, refresh: 'duration', stats: { attackSpeed: FLURRY_AS },
          onApply: (u) => { u.modelState.flurry = true; },
          onRemove: (u) => { u.modelState.flurry = false; },
        });
      });
      champ.addHook('afterHit', () => {
        const b = champ.getBuff('leesin_flurry');
        if (!b) return;
        restoreEnergy(champ, b.stacks >= 2 ? FLURRY_ENERGY[0] : FLURRY_ENERGY[1]);
        if (b.stacks <= 1) champ.removeBuff(b);
        else b.stacks--;
      });
    },
  },

  abilities: {
    // —— Q：天音波 / 回音击 ——
    Q: {
      id: 'leesin_q',
      name: '天音波',
      recastName: '回音击',
      icon: ICONS.Q,
      recastIcon: ICONS.Q2,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const base = leeQ1Damage(champ, r);
        return `天音波：李青发出一道 ${Q_RANGE} 码的音波，对命中的第一个敌人造成 ${scaleText(champ, rv(Q_BASE, r), [[Q_BAD, 'bonusAd']])} 点物理伤害，`
          + `并标记和显形目标 ${Q_WINDOW} 秒。\n`
          + `回音击：${Q_WINDOW} 秒内再次施放可冲向被标记的目标，造成 ${fmt(base)}~${fmt(base * 2)} 点物理伤害（按目标已损失生命值最多提高 100%）。\n`
          + `消耗：天音波 ${Q_COST} 能量，回音击 ${Q2_COST} 能量。冷却在回音击施放或标记结束后开始。`;
      },
      cooldown: Q_CD,
      cost: [Q_COST, Q_COST, Q_COST, Q_COST, Q_COST],
      range: Q_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: Q_WIDTH * 2, length: Q_RANGE },
      castTime: 0.25,
      lockMovement: true,
      manualCooldown: true,
      sfx: 'whoosh',
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const rank = ctx.rank;
        // 未命中时按正常冷却；命中后进入回音击窗口（窗口结束再重新计算冷却）
        ab.startCooldown();
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, range: Q_RANGE, speed: Q_SPEED, width: Q_WIDTH,
          hits: 'first', vfx: { kind: 'leesin_q_wave', color: SKY, size: 1.2, trail: true }, height: 90,
          onHit: (u) => {
            game.dealDamage(champ, u, leeQ1Damage(champ, rank), 'physical', { isAbility: true, spell: 'leesin_q' });
            game.fx.impact({ x: u.x, y: u.y, h: 90, color: SKY, size: 1.2 });
            if (!u.alive) return true;
            u.addBuff({
              id: 'leesin_q_mark', name: '天音波', desc: '被标记：李青可以冲向你', icon: ICONS.Q, source: champ,
              duration: Q_WINDOW, isDebuff: true,
            });
            u.revealedUntil = Math.max(u.revealedUntil, game.time + Q_WINDOW);
            game.vision?.addRevealer?.({ team: champ.team, follow: u, x: u.x, y: u.y, radius: 150, duration: Q_WINDOW, trueSight: true, seeBrush: true });
            game.fx.custom('leesin_q_mark', { unit: u, duration: Q_WINDOW });
            ab.state.markTarget = u;
            ab.setRecast(Q_WINDOW, { cooldownOnExpire: true, onExpire: () => { ab.state.markTarget = null; } });
            return true;
          },
        });
      },
      recast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const t = ab.state.markTarget;
        if (champ.dashState) return false;
        if (!t || !t.alive || t.removed || !t.hasBuff('leesin_q_mark')) { ab.state.markTarget = null; ab.endRecast(true); return false; }
        if (!payEnergy(champ, Q2_COST)) return false;
        const rank = ab.rank;
        const ok = champ.dash({
          followTarget: t, speed: Q2_SPEED, ignoreWalls: true, stopDistance: 10,
          onEnd: (interrupted) => {
            if (interrupted || !champ.alive || !t.alive || t.untargetable) return;
            game.dealDamage(champ, t, leeQ2Damage(champ, t, rank), 'physical', { isAbility: true, spell: 'leesin_q2' });
            game.fx.custom('leesin_q2_hit', { x: t.x, y: t.y, unit: t });
          },
        });
        if (!ok) { restoreEnergy(champ, Q2_COST); return false; }
        game.fx.custom('leesin_q2_dash', { unit: champ, target: t });
        t.removeBuff('leesin_q_mark');
        ab.state.markTarget = null;
        ab.endRecast(true);
        return true;
      },
      // 标记目标死亡：提前结束回音击窗口
      update(champ, ab) {
        if (!ab.isRecastActive) return;
        const t = ab.state.markTarget;
        if (!t || !t.alive || t.removed) { ab.state.markTarget = null; ab.endRecast(true); }
      },
      ai: {
        kind: 'nuke', range: Q_RANGE - 50, width: Q_WIDTH, speed: Q_SPEED, delay: 0.25, farm: true, collision: true,
        damage: (champ, target, rank) => {
          const raw = leeQ1Damage(champ, rank) * (target ? 2 + Math.min(1, 1 - target.hp / target.maxHp) : 2.5);
          return target ? mitigate(champ, target, raw, 'physical') : raw;
        },
        custom: (champ, ab, ai, game) => {
          const ctx = aiContext(ai);
          // —— 回音击 ——
          if (ab.isRecastActive) {
            const m = ab.state.markTarget;
            if (!m || !m.alive || champ.dashState || champ.mana < Q2_COST) return false;
            const d = champ.distTo(m);
            const reach = champ.stats.attackRange + champ.radius + m.radius;
            const late = ab.recastRemaining < 0.7;
            if (m.type === 'champion') {
              if (!combatOk(ctx) && ctx !== 'idle') return false;
              const killable = mitigate(champ, m, leeQ2Damage(champ, m, ab.rank), 'physical') >= m.hp + m.totalShield;
              const foes = aiEnemies(ai, champ, 2000).filter((e) => e.distTo(m) < 900).length;
              const friends = aiAllies(ai, champ, 1500).length + 1;
              const dive = !!ai?.diving;
              const safe = (dive || !aiUnderTurret(ai, champ, m.x, m.y)) && (aiHp(ai, champ) > 0.35 || killable) && foes <= friends + 1;
              if (!safe && !killable) return false;
              // 目标还在身边时等到窗口末尾（已损失生命越多伤害越高）
              if (!killable && d <= reach + 60 && !late) return false;
              return !!champ.castAbility('Q', { target: m }).ok;
            }
            // 野怪/小兵：打野时追过去，或借它贴近附近的敌方英雄
            if (ctx === 'escape') return false;
            const chase = combatOk(ctx) && aiEnemies(ai, champ, 1600).some((e) => e.distTo(m) < 450);
            const farm = farmOk(ctx) && m.type === 'monster' && (d > reach + 40 || late);
            if ((farm || chase) && !aiUnderTurret(ai, champ, m.x, m.y)) return !!champ.castAbility('Q', { target: m }).ok;
            return false;
          }
          // —— 天音波 ——
          if (champ.mana < Q_COST) return false;
          if (combatOk(ctx)) {
            const t = aiChampTarget(ai, champ, Q_RANGE - 60);
            const harass = ctx === 'harass';
            if (t && (!harass || (champ.mana > 130 && !aiUnderTurret(ai, champ, t.x, t.y)))) {
              const d = champ.distTo(t);
              const p = aiPredict(ai, t, 0.25 + d / Q_SPEED);
              const pd = Math.hypot(p.x - champ.x, p.y - champ.y);
              if (pd <= Q_RANGE - 30) {
                // 小兵/野怪阻挡时不放
                const block = game.queryLine({
                  x1: champ.x, y1: champ.y, x2: p.x, y2: p.y, width: Q_WIDTH, enemyOf: champ, types: ['minion', 'monster', 'pet'],
                  filter: (u) => !u.untargetable && champ.distTo(u) < pd - 20,
                });
                if (block.length === 0 && game.rng() < 0.35 + aiParam(ai, 'accuracy', 0.7) * 0.65) {
                  return aiCast(ai, champ, 'Q', { x: p.x, y: p.y, target: t });
                }
              }
            }
          }
          // 打野
          if (farmOk(ctx)) {
            const mon = currentMonster(champ);
            if (mon && champ.distTo(mon) < Q_RANGE - 100 && champ.mana >= Q_COST + 30) {
              return aiCast(ai, champ, 'Q', { x: mon.x, y: mon.y, target: mon });
            }
          }
          return false;
        },
      },
    },

    // —— W：金钟罩 / 铁布衫 ——    // —— W：金钟罩 / 铁布衫 ——
    W: {
      id: 'leesin_w',
      name: '金钟罩',
      recastName: '铁布衫',
      icon: ICONS.W,
      recastIcon: ICONS.W2,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `金钟罩：李青冲向一名友方英雄、小兵或守卫（也可以对自己施放），为自己和友方英雄提供 ${scaleText(champ, rv(W_SHIELD, r), [[W_AP, 'ap']])} 点护盾，持续 ${W_SHIELD_DUR} 秒。\n`
          + `铁布衫：${W_WINDOW} 秒内再次施放，获得 ${pct(rv(W2_VAMP, r))} 生命偷取和全能吸血，持续 ${W2_DUR} 秒。\n`
          + `消耗：金钟罩 ${W_COST} 能量，铁布衫 ${W2_COST} 能量。`;
      },
      cooldown: W_CD,
      cost: [W_COST, W_COST, W_COST, W_COST, W_COST],
      range: W_RANGE,
      targeting: 'unit',
      targetFilter: (champ, t) => wTargetOk(champ, t),
      indicator: { type: 'unit' },
      castTime: 0,
      lockMovement: false,
      manualCooldown: true,
      sfx: 'shield',
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const rank = ctx.rank;
        const t = ctx.target && wTargetOk(champ, ctx.target) ? ctx.target : champ;
        if (t === champ) {
          safeguardShield(champ, null, rank);
        } else {
          const ok = champ.dash({
            followTarget: t, speed: W_DASH_SPEED, ignoreWalls: true, stopDistance: 0,
            onEnd: (interrupted) => {
              ab.state.dashing = false;
              if (!interrupted && champ.alive) safeguardShield(champ, t, rank);
            },
          });
          if (!ok) return false;
          ab.state.dashing = true;
          game.fx.custom('leesin_w_dash', { unit: champ, target: t });
        }
        ab.setRecast(W_WINDOW, { cooldownOnExpire: true });
      },
      recast(champ, ctx) {
        const ab = ctx.ability;
        if (ab.state.dashing && champ.dashState) return false;
        if (!payEnergy(champ, W2_COST)) return false;
        const v = rv(W2_VAMP, ab.rank);
        champ.addBuff({
          id: 'leesin_w2', name: '铁布衫', desc: '获得生命偷取和全能吸血', icon: ICONS.W2, source: champ,
          duration: W2_DUR, refresh: 'replace', stats: { lifeSteal: v, omnivamp: v },
          onApply: (u) => { u.modelState.ironWill = true; },
          onRemove: (u) => { u.modelState.ironWill = false; },
        });
        champ.game.fx.custom('leesin_w2', { unit: champ, duration: W2_DUR });
        ab.endRecast(true);
        return true;
      },
      ai: {
        kind: 'shield', range: W_RANGE,
        damage: () => 0,
        custom: (champ, ab, ai, game) => {
          const ctx = aiContext(ai);
          const hp = aiHp(ai, champ);
          // —— 铁布衫：战斗中生命不满时 ——
          if (ab.isRecastActive) {
            if (champ.dashState || champ.mana < W2_COST || ctx === 'idle') return false;
            const inCombat = game.time - champ.lastDamagedAt < 1.5 || game.time - champ.lastAttackAt < 1;
            if (inCombat && (hp < 0.85 || ab.recastRemaining < 0.5)) return !!champ.castAbility('W').ok;
            return false;
          }
          if (champ.mana < W_COST) return false;
          const enemies = aiEnemies(ai, champ, 1100);
          const close = enemies.filter((e) => champ.distTo(e) < 700);
          // 逃生：被追 → 朝泉水方向金钟罩 / 摸眼
          if (close.length > 0 && (hp < 0.3 || (ctx === 'escape' && hp < 0.55))) {
            if (escapeHop(champ, game)) return true;
          }
          if (FARM_CTX.has(ctx) && ctx !== 'jungle') return false;
          // 保护正在挨打的残血队友
          if (ctx !== 'jungle') {
            for (const a of aiAllies(ai, champ, W_RANGE + 60)) {
              if (a.type !== 'champion' || !a.alive) continue;
              if (a.hp / a.maxHp < 0.35 && game.time - a.lastDamagedAt < 1 && champ.distTo(a) <= W_RANGE + a.radius) {
                return !!champ.castAbility('W', { target: a }).ok;
              }
            }
            // 自保：交战中受到伤害
            if (enemies.length && hp < 0.65 && game.time - champ.lastDamagedAt < 0.8) return !!champ.castAbility('W', { target: champ }).ok;
          }
          // 打野续航：护盾 + 吸血
          if (farmOk(ctx)) {
            const mon = currentMonster(champ);
            if (mon && hp < 0.7 && champ.inAttackRange(mon, 60) && champ.mana > 120) return !!champ.castAbility('W', { target: champ }).ok;
          }
          return false;
        },
      },
    },

    // —— E：天雷破 / 摧筋断骨 ——    // —— E：天雷破 / 摧筋断骨 ——
    E: {
      id: 'leesin_e',
      name: '天雷破',
      recastName: '摧筋断骨',
      icon: ICONS.E,
      recastIcon: ICONS.E2,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `天雷破：李青猛击地面，对周围 ${E_RADIUS} 码内的敌人造成 ${scaleText(champ, rv(E_BASE, r), [[E_AD, 'ad']])} 点魔法伤害，并显形被命中的敌人 ${E_REVEAL} 秒。\n`
          + `摧筋断骨：${E_WINDOW} 秒内再次施放，使被天雷破命中的敌人减速 ${pct(rv(E2_SLOW, r))}，在 ${E2_DUR} 秒内逐渐衰减。\n`
          + `消耗：天雷破 ${E_COST} 能量，摧筋断骨 ${E2_COST} 能量。`;
      },
      cooldown: E_CD,
      cost: [E_COST, E_COST, E_COST, E_COST, E_COST],
      range: E_RADIUS,
      targeting: 'self',
      indicator: { type: 'self', radius: E_RADIUS },
      castTime: 0.25,
      lockMovement: false,
      manualCooldown: true,
      sfx: 'impact',
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const dmg = leeEDamage(champ, ctx.rank);
        const hits = game.queryUnits({ x: champ.x, y: champ.y, radius: E_RADIUS, enemyOf: champ }).filter((u) => !u.untargetable);
        for (const u of hits) {
          game.dealDamage(champ, u, dmg, 'magic', { isAbility: true, isAoE: true, spell: 'leesin_e' });
          if (!u.alive) continue;
          u.addBuff({ id: 'leesin_e_mark', name: '天雷破', desc: '被显形：可被摧筋断骨减速', icon: ICONS.E, source: champ, duration: E_REVEAL, isDebuff: true });
          u.revealedUntil = Math.max(u.revealedUntil, game.time + E_REVEAL);
        }
        game.fx.custom('leesin_e_tempest', { x: champ.x, y: champ.y, unit: champ, radius: E_RADIUS, hits: hits.length });
        const alive = hits.filter((u) => u.alive);
        if (alive.length) {
          ab.state.eTargets = alive;
          ab.setRecast(E_WINDOW, { cooldownOnExpire: true, onExpire: () => { ab.state.eTargets = null; } });
        } else {
          ab.startCooldown();
        }
      },
      recast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        if (!payEnergy(champ, E2_COST)) return false;
        const slow = rv(E2_SLOW, ab.rank);
        const targets = (ab.state.eTargets || []).filter((u) => u.alive && !u.removed && u.hasBuff('leesin_e_mark'));
        for (const u of targets) {
          if (!u.slow(slow, E2_DUR, champ)) continue;
          // 减速随时间线性衰减
          u.addBuff({
            id: 'leesin_e2', name: '摧筋断骨', desc: '移动速度降低（逐渐衰减）', icon: ICONS.E2, source: champ,
            duration: E2_DUR, isDebuff: true, refresh: 'replace', data: { slow },
            onTick: (unit, b) => {
              const cc = ccFrom(unit, 'slow', champ);
              if (cc) cc.amount = b.data.slow * Math.max(0, 1 - b.elapsed / E2_DUR);
            },
          });
          game.fx.custom('leesin_e2_cripple', { unit: u, duration: E2_DUR });
        }
        ab.state.eTargets = null;
        ab.endRecast(true);
        return true;
      },
      ai: {
        kind: 'aoe', range: E_RADIUS, radius: E_RADIUS, delay: 0.25, farm: true,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, leeEDamage(champ, rank), 'magic') : leeEDamage(champ, rank)),
        custom: (champ, ab, ai, game) => {
          const ctx = aiContext(ai);
          // —— 摧筋断骨：追击、逃跑减速追兵或窗口即将结束 ——
          if (ab.isRecastActive) {
            if (champ.mana < E2_COST || ctx === 'idle') return false;
            const marked = (ab.state.eTargets || []).filter((u) => u.alive && u.hasBuff('leesin_e_mark'));
            const champs = marked.filter((u) => u.type === 'champion');
            if (champs.length === 0) return false;
            const running = champs.some((u) => champ.distTo(u) > champ.stats.attackRange + champ.radius + u.radius + 30);
            if (running || ctx === 'escape' || ab.recastRemaining < 0.6) return !!champ.castAbility('E').ok;
            return false;
          }
          if (champ.mana < E_COST || ctx === 'idle') return false;
          // —— 天雷破：预判 0.25 秒后敌方英雄在范围内 ——
          if (!FARM_CTX.has(ctx)) {
            for (const e of aiEnemies(ai, champ, E_RADIUS + 250)) {
              const p = aiPredict(ai, e, 0.25);
              if (Math.hypot(p.x - champ.x, p.y - champ.y) < E_RADIUS + e.radius * 0.3) return aiCast(ai, champ, 'E');
            }
          }
          if (!farmOk(ctx)) return false;
          // 打野 / 清线
          const mon = currentMonster(champ);
          if (mon && champ.distTo(mon) < E_RADIUS && champ.mana >= E_COST + 20) return aiCast(ai, champ, 'E');
          const minions = game.queryUnits({ x: champ.x, y: champ.y, radius: E_RADIUS - 30, enemyOf: champ, targetableBy: champ, types: ['minion'] });
          if (minions.length >= (ctx === 'push' ? 3 : 4) && champ.mana > 150 && !aiUnderTurret(ai, champ, champ.x, champ.y)) return aiCast(ai, champ, 'E');
          return false;
        },
      },
    },

    // —— R：猛龙摆尾 ——    // —— R：猛龙摆尾 ——
    R: {
      id: 'leesin_r',
      name: '猛龙摆尾',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `李青回旋踢出一记猛龙摆尾，将目标敌方英雄踢飞 ${R_KICK} 码，造成 ${scaleText(champ, rv(R_BASE, r), [[R_BAD, 'bonusAd']])} 点物理伤害（撞墙会停下）。\n`
          + `被踢飞的目标撞到的敌人会被击飞 ${R_KNOCKUP} 秒，并受到相同伤害外加被踢目标 ${pct(rv(R_BONUS_HP, r))} 额外生命值的物理伤害。`;
      },
      cooldown: R_CD,
      cost: [0, 0, 0],
      range: R_RANGE,
      targeting: 'unit',
      targetFilter: 'enemyChampion',
      indicator: { type: 'unit' },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'impact',
      cast(champ, ctx) {
        const game = champ.game;
        const t = ctx.target;
        if (!t || !t.alive) return false;
        const rank = ctx.rank;
        const dmg = leeRDamage(champ, rank);
        const collide = dmg + rv(R_BONUS_HP, rank) * Math.max(0, t.stats.bonusHp || 0);
        const dir = norm(t.x - champ.x, t.y - champ.y, { x: Math.cos(champ.facing), y: Math.sin(champ.facing) });
        game.fx.custom('leesin_r_kick', { unit: champ, target: t, x: t.x, y: t.y, dirX: dir.x, dirY: dir.y, distance: R_KICK, duration: R_KICK_DUR });
        game.dealDamage(champ, t, dmg, 'physical', { isAbility: true, spell: 'leesin_r' });
        if (!t.alive) return;
        if (!t.knockback({ fromX: champ.x, fromY: champ.y, distance: R_KICK, duration: R_KICK_DUR, source: champ, height: 70 })) return;
        const hitSet = new Set([t]);
        // 跟随被踢目标的碰撞区域：撞到的敌人受到伤害并被击飞
        game.spawnZone({
          owner: champ, x: t.x, y: t.y, radius: t.radius + 25, duration: R_KICK_DUR, follow: t, tickInterval: 0, vfx: null,
          filter: (u) => u !== t && u.team !== champ.team && !u.untargetable,
          onUpdate: (zone) => { if (zone.age > 0.05 && !t.dashState) zone.remove(); },
          onTick: (zone, units) => {
            for (const u of units) {
              if (hitSet.has(u)) continue;
              hitSet.add(u);
              game.dealDamage(champ, u, collide, 'physical', { isAbility: true, isAoE: true, spell: 'leesin_r_collide' });
              if (u.alive) u.knockup(R_KNOCKUP, champ);
              game.fx.custom('leesin_r_collide', { x: u.x, y: u.y, unit: u });
            }
          },
        });
      },
      ai: {
        kind: 'cc', range: R_RANGE,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, leeRDamage(champ, rank), 'physical') : leeRDamage(champ, rank)),
        custom: (champ, ab, ai, game) => {
          const ctx = aiContext(ai);
          if (ctx !== null && ctx !== 'fight' && ctx !== 'peel' && ctx !== 'escape') return false;
          const enemies = aiEnemies(ai, champ, 1300);
          if (enemies.length === 0) return false;
          const allies = aiAllies(ai, champ, 1800).filter((a) => a.type === 'champion');
          const myTurrets = game.structures.filter((s) => s.type === 'turret' && s.alive && s.team === champ.team && champ.distTo(s) < 2200);
          const hp = aiHp(ai, champ);
          const rDmg = leeRDamage(champ, ab.rank);
          // 评估每个射程内目标的踢飞收益
          for (const t of enemies) {
            if (champ.distTo(t) > R_RANGE + t.radius) continue;
            const dir = norm(t.x - champ.x, t.y - champ.y);
            const land = kickLanding(game, t, dir);
            let score = 0;
            if (mitigate(champ, t, rDmg, 'physical') >= t.hp + t.totalShield) score += 3;
            for (const o of enemies) {
              if (o === t) continue;
              const vx = o.x - t.x, vy = o.y - t.y;
              const along = vx * dir.x + vy * dir.y;
              const len = Math.hypot(land.x - t.x, land.y - t.y);
              if (along < 0 || along > len + 50) continue;
              if (Math.abs(vx * dir.y - vy * dir.x) < t.radius + o.radius + 20) score += 2;
            }
            if (allies.some((a) => Math.hypot(a.x - land.x, a.y - land.y) < 650)) score += 1.5;
            if (myTurrets.some((s) => Math.hypot(s.x - land.x, s.y - land.y) < 700)) score += 1.5;
            if (hp < 0.35 && champ.distTo(t) < 300) score += 1.5;
            if (score >= 1.5) return aiCast(ai, champ, 'R', { target: t });
          }
          // —— 站位：绕到目标身后，把他踢回我方（仅主动交战时） ——
          if (ctx !== null && ctx !== 'fight') return false;
          const t = aiChampTarget(ai, champ, 700);
          if (!t || hp < 0.3) return false;
          let ax = 0, ay = 0, n = 0;
          for (const a of allies) { ax += a.x; ay += a.y; n++; }
          for (const s of myTurrets) { ax += s.x; ay += s.y; n++; }
          if (n === 0) return false;
          ax /= n; ay /= n;
          const away = norm(t.x - ax, t.y - ay);
          const off = t.radius + champ.radius + 45;
          const px = t.x + away.x * off, py = t.y + away.y * off;
          if (!game.nav.isWalkable(px, py) || aiUnderTurret(ai, champ, px, py)) return false;
          const dP = Math.hypot(px - champ.x, py - champ.y);
          const st = ab.state;
          const now = game.time;
          // 步行绕后（每 6 秒最多尝试 1.2 秒）
          if (dP <= 320) {
            if (st.walkStart == null || now - st.walkStart > 6) st.walkStart = now;
            if (now - st.walkStart < 1.2) { champ.moveTo(px, py); return true; }
            return false;
          }
          // 摸眼回旋踢
          if (dP <= TRINKET.RANGE - 30 && (st.insecAt == null || now - st.insecAt > 8) && t.hp / t.maxHp < 0.75) {
            if (wardJump(champ, px, py)) { st.insecAt = now; return true; }
          }
          return false;
        },
      },
    },
  },

  ai: { skillOrder: ['Q', 'E', 'W'], style: 'bruiser', engageRange: 600, kiteDistance: 0, combo: ['Q', 'E', 'R', 'W'] },
};
