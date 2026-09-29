// 英雄：莫甘娜（堕落天使）—— 被动灵魂虹吸（技能伤害回复生命）、Q 暗之禁锢、W 痛苦腐蚀（地面持续伤害，低血量增伤）、
// E 黑暗之盾（魔法护盾 + 免疫控制）、R 灵魂镣铐（锁链减速，3 秒后眩晕）
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本附近） ——
const P_HEAL = (level) => ((level || 1) >= 11 ? 0.22 : (level || 1) >= 6 ? 0.18 : 0.14);

const Q_DMG = [80, 135, 190, 245, 300];      // （+90% AP）
const Q_AP = 0.90;
const Q_ROOT = [2, 2.25, 2.5, 2.75, 3];
const Q_RANGE = 1300;
const Q_WIDTH = 70;
const Q_SPEED = 1200;
const Q_COST = [50, 55, 60, 65, 70];
const Q_CD = [10, 10, 10, 10, 10];

const W_DPS = [12, 22, 32, 42, 52];          // 每秒（+14% AP），持续 5 秒
const W_AP = 0.14;
const W_LOW_BONUS = 1.7;                      // 按目标已损失生命值最多提高 170%
const W_RADIUS = 275;
const W_RANGE = 900;
const W_DURATION = 5;
const W_TICK = 0.5;
const W_CDR = 0.5;                            // 每跳命中英雄/大型野怪减少 W 冷却
const W_COST = [70, 85, 100, 115, 130];
const W_CD = [12, 12, 12, 12, 12];

const E_SHIELD = [80, 135, 190, 245, 300];   // （+70% AP）
const E_AP = 0.70;
const E_DURATION = 5;
const E_RANGE = 800;
const E_COST = [80, 80, 80, 80, 80];
const E_CD = [26, 24, 22, 20, 18];
const E_BUFF = 'morgana_e_shield';

const R_DMG = [150, 225, 300];               // （+70% AP），连接与爆发各一次
const R_AP = 0.70;
const R_RADIUS = 625;
const R_LEASH = 1050;
const R_SLOW = 0.20;
const R_DURATION = 3;
const R_STUN = 1.5;
const R_MS = [0.05, 0.225, 0.40];            // 朝被链接者移动时的移速
const R_CD = [120, 110, 100];

const VIOLET = 0x9a4aff;
const SHADOW = 0x3a1a6a;
const TOXIC = 0x7aff6a;
const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('虹', '#b07aff', '#2a0a4a'),
  Q: icon('禁', '#a060ff', '#1a0a3a'),
  W: icon('蚀', '#8ae060', '#2a1a4a'),
  E: icon('盾', '#c090ff', '#3a1a6a'),
  R: icon('镣', '#d060ff', '#1a0a2a'),
};

// —— 数值计算 ——
const ap = (champ) => champ?.stats?.ap || 0;
const qDamage = (champ, rank) => rv(Q_DMG, rank) + Q_AP * ap(champ);
const wTick = (champ, rank, target) => {
  const base = (rv(W_DPS, rank) + W_AP * ap(champ)) * W_TICK;
  const missing = target && target.maxHp > 0 ? Math.max(0, 1 - target.hp / target.maxHp) : 0;
  return base * (1 + W_LOW_BONUS * missing);
};
const eShield = (champ, rank) => rv(E_SHIELD, rank) + E_AP * ap(champ);
const rDamage = (champ, rank) => rv(R_DMG, rank) + R_AP * ap(champ);
export const MORGANA = { qDamage, wTick, eShield, rDamage, P_HEAL, E_BUFF };

const hittable = (u) => u && u.alive && !u.removed && !u.untargetable && u.type !== 'ward' && !u.isStructure;
// 灵魂虹吸生效目标：英雄、大型野怪、大型小兵（炮车/超级兵）
const siphonTarget = (u) => u && (u.type === 'champion' || (u.type === 'monster' && u.large !== false)
  || (u.type === 'minion' && (u.kind === 'siege' || u.kind === 'super')));

// 黑暗之盾：护盾存在期间免疫控制（通过 unstoppable 实现），护盾被打破或到期时移除
function blackShield(champ, u, rank) {
  const game = champ.game;
  const amt = eShield(champ, rank);
  u.removeBuff(E_BUFF);
  const shield = u.addShield(amt, E_DURATION, { type: 'magic', source: champ, id: 'morgana_e' });
  u.addBuff({
    id: E_BUFF, name: '黑暗之盾', desc: '吸收魔法伤害，免疫控制效果', icon: ICONS.E, source: champ,
    duration: E_DURATION, refresh: 'replace', data: { shield },
    onApply: (t) => { t.unstoppable = true; t.modelState.morganaShield = true; },
    onTick: (t, b) => {
      const s = t.shields.find((x) => x.id === 'morgana_e');
      if (!s || s.amount <= 0) { t.removeBuff(b); return; }
      t.unstoppable = true;
    },
    onRemove: (t) => {
      t.modelState.morganaShield = false;
      if (t.dashState && t.dashState.unstoppable) t.dashState.prevUnstoppable = false;
      else t.unstoppable = false;
      const s = t.shields.find((x) => x.id === 'morgana_e');
      if (s && !(t.alive)) s.remove?.();
    },
  });
  game.fx.custom('morgana_e_shield', { unit: u, duration: E_DURATION, shieldId: 'morgana_e' });
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
function lockedFor(u) {
  let m = 0;
  for (const t of ['root', 'stun', 'charm', 'airborne', 'suppress', 'taunt', 'sleep']) m = Math.max(m, u.ccRemaining(t));
  return m;
}

export default {
  id: 'morgana',
  name: '莫甘娜',
  title: '堕落天使',
  roles: ['support', 'mid'],
  tags: ['法师', '辅助'],
  difficulty: 1,
  lore: '一位折断羽翼的堕落天使，拒绝了神圣的本性，以暗影魔法束缚敌人、庇护凡人。',
  baseStats: {
    hp: 630, hpPerLevel: 104, hpRegen: 5.5, hpRegenPerLevel: 0.4,
    mana: 340, manaPerLevel: 60, manaRegen: 11, manaRegenPerLevel: 0.4, resource: 'mana',
    ad: 56, adPerLevel: 3.5, as: 0.625, asRatio: 0.625, asPerLevel: 1.53,
    armor: 25, armorPerLevel: 4.7, mr: 30, mrPerLevel: 1.3,
    ms: 335, range: 450, radius: 65, windup: 0.1579, critMult: 1.75,
    missileSpeed: 1600, attackVfx: { kind: 'morgana_aa', fallback: 'orb', color: VIOLET, size: 0.8, trail: true },
  },
  model: { primary: 0x3a1a5a, secondary: 0x8a4ac8, accent: 0xb07aff },
  portrait: { bg: ['#6a3aa8', '#12061f'], glyph: '莫' },

  // —— 被动：灵魂虹吸 ——
  passive: {
    id: 'morgana_passive',
    name: '灵魂虹吸',
    icon: ICONS.P,
    desc: (champ) => `莫甘娜的技能对敌方英雄、大型小兵和大型野怪造成伤害时，回复相当于伤害值 ${pct(P_HEAL(champ?.level))} 的生命值（1/6/11 级：14%/18%/22%）。`,
    init(champ) {
      champ.addHook('afterDealDamage', (ctx) => {
        if (!ctx.isAbility || !(ctx.dealt > 0) || !champ.alive) return;
        if (typeof ctx.spell !== 'string' || !ctx.spell.startsWith('morgana_')) return;
        if (!siphonTarget(ctx.target)) return;
        const amt = ctx.dealt * P_HEAL(champ.level);
        if (amt > 0 && champ.hp < champ.maxHp) champ.game.heal(champ, champ, amt, { spell: 'morgana_passive', silent: true });
      });
    },
  },

  abilities: {
    // —— Q：暗之禁锢 ——
    Q: {
      id: 'morgana_q',
      name: '暗之禁锢',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `莫甘娜释放一团暗影法球（${Q_RANGE} 码），禁锢命中的第一个敌人 ${fmt(rv(Q_ROOT, r))} 秒，`
          + `并造成 ${scaleText(champ, rv(Q_DMG, r), [[Q_AP, 'ap']])} 点魔法伤害。`;
      },
      cooldown: Q_CD,
      cost: Q_COST,
      range: Q_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: Q_WIDTH * 2, length: Q_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'chain',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY,
          range: Q_RANGE, speed: Q_SPEED, width: Q_WIDTH, hits: 'first', height: 100,
          vfx: { kind: 'morgana_q_orb', fallback: 'orb', color: VIOLET, size: 1.1, trail: true },
          onHit: (u) => {
            game.dealDamage(champ, u, qDamage(champ, rank), 'magic', { isAbility: true, spell: 'morgana_q' });
            if (u.alive && u.applyCC('root', rv(Q_ROOT, rank), { source: champ })) {
              game.fx.custom('morgana_q_bind', { unit: u, duration: u.ccRemaining('root') });
            }
            game.fx.impact({ x: u.x, y: u.y, h: 90, color: VIOLET, size: 1.1 });
            return true;
          },
        });
      },
      ai: {
        kind: 'cc', range: Q_RANGE, width: Q_WIDTH, speed: Q_SPEED, delay: 0.25, collision: true,
        damage: (champ, target, rank) => mitigate(champ, target, qDamage(champ, rank), 'magic'),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0 || champ.mana < ability.cost) return false;
          const t = aiPickTarget(champ, ai, Q_RANGE + 50);
          if (!t) return false;
          const d = champ.distTo(t);
          const lock = lockedFor(t);
          const flight = 0.25 + d / Q_SPEED;
          if (lock > flight + 0.3) return false; // 已被控制，不叠控
          const p = lock >= flight ? { x: t.x, y: t.y } : aiPredict(ai, t, flight);
          const pd = Math.hypot(p.x - champ.x, p.y - champ.y);
          if (pd > Q_RANGE - 30) return false;
          // 远距离命中率低：距离越远越挑剔（目标正在移动时）
          if (pd > 1000 && t.moving && game.rng() < 0.5) return false;
          // 暗之禁锢只命中第一个单位：路径上不能有其他敌人
          const block = game.queryLine({ x1: champ.x, y1: champ.y, x2: p.x, y2: p.y, width: Q_WIDTH, enemyOf: champ, filter: (u) => u !== t && hittable(u) }).length;
          if (block > 0) return false;
          return aiCastAt(champ, ai, 'Q', p.x, p.y);
        },
      },
    },

    // —— W：痛苦腐蚀 ——
    W: {
      id: 'morgana_w',
      name: '痛苦腐蚀',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `莫甘娜腐蚀一片地面（${W_RADIUS} 码半径），${W_DURATION} 秒内每秒对区域内的敌人造成 ${scaleText(champ, rv(W_DPS, r), [[W_AP, 'ap']])} 点魔法伤害，`
          + `伤害按目标已损失生命值最多提高 ${pct(W_LOW_BONUS)}。\n每次伤害命中敌方英雄或大型野怪时，痛苦腐蚀的冷却时间减少 ${W_CDR} 秒。`;
      },
      cooldown: W_CD,
      cost: W_COST,
      range: W_RANGE,
      targeting: 'point',
      indicator: { type: 'circle', radius: W_RADIUS },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'magic',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const ab = ctx.ability;
        game.spawnZone({
          owner: champ, x: ctx.x, y: ctx.y, radius: W_RADIUS, duration: W_DURATION, tickInterval: W_TICK, filter: 'enemy',
          vfx: { kind: 'morgana_w_zone', color: TOXIC, radius: W_RADIUS },
          onTick: (z, units) => {
            if (z.age < W_TICK * 0.5) return; // 生效瞬间不结算，之后每 0.5 秒一跳（共 10 跳）
            let big = false;
            for (const u of units) {
              if (!hittable(u)) continue;
              const dealt = game.dealDamage(champ, u, wTick(champ, rank, u), 'magic', { isAbility: true, isAoE: true, isDot: true, spell: 'morgana_w' });
              if (dealt > 0 && (u.type === 'champion' || (u.type === 'monster' && u.large !== false))) big = true;
            }
            if (big && ab && !ab.ready) ab.reduceCooldown(W_CDR);
          },
        });
      },
      ai: {
        kind: 'aoe', range: W_RANGE, radius: W_RADIUS, delay: 0.25, farm: true, minTargets: 1,
        damage: (champ, target, rank) => mitigate(champ, target, wTick(champ, rank, target) * (W_DURATION / W_TICK) * 0.6, 'magic'),
      },
    },

    // —— E：黑暗之盾 ——
    E: {
      id: 'morgana_e',
      name: '黑暗之盾',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `莫甘娜为一名友方英雄（${E_RANGE} 码，可对自己施放）套上黑暗之盾，吸收 ${scaleText(champ, rv(E_SHIELD, r), [[E_AP, 'ap']])} 点魔法伤害，持续 ${E_DURATION} 秒。\n`
          + `护盾存在期间，目标免疫一切控制效果。`;
      },
      cooldown: E_CD,
      cost: E_COST,
      range: E_RANGE,
      targeting: 'unit',
      targetFilter: 'allyChampion',
      indicator: { type: 'unit' },
      castTime: 0,
      lockMovement: false,
      sfx: 'shield',
      cast(champ, ctx) {
        const t = ctx.target || champ;
        if (!t.alive || t.team !== champ.team) return false;
        blackShield(champ, t, ctx.rank);
      },
      ai: {
        kind: 'shield', range: E_RANGE,
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0 || champ.mana < ability.cost) return false;
          const foes = aiEnemies(champ, ai, 1400);
          if (foes.length === 0) return false;
          const now = game.time;
          const cands = [champ, ...(ai?.nearbyAllies?.(E_RANGE + 50) || game.champions.filter((c) => c.team === champ.team && c.alive && c !== champ && champ.distTo(c) <= E_RANGE + 50))];
          let best = null, bestScore = 0;
          for (const a of cands) {
            if (!a || !a.alive || a.untargetable || a.hasBuff(E_BUFF)) continue;
            const recent = now - (a.lastDamagedAt ?? -99) < 1.2;
            const nearFoe = foes.some((f) => f.distTo(a) < 700);
            if (!recent && !nearFoe) continue;
            const hp = a.hp / a.maxHp;
            let s = (recent ? 1 : 0.3) + (1 - hp) + (a.role === 'adc' || a.role === 'mid' ? 0.4 : 0) + (a === champ ? -0.2 : 0);
            if (a.isCCd?.()) s -= 0.5; // 已被控制时护盾无法解控
            if (s > bestScore) { bestScore = s; best = a; }
          }
          if (!best || bestScore < 1.1) return false;
          const r = typeof ai?.castOn === 'function' ? ai.castOn('E', best) : champ.castAbility('E', { target: best });
          return aiOk(r);
        },
      },
    },

    // —— R：灵魂镣铐 ——
    R: {
      id: 'morgana_r',
      name: '灵魂镣铐',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `莫甘娜用锁链连接 ${R_RADIUS} 码内的所有敌方英雄，造成 ${scaleText(champ, rv(R_DMG, r), [[R_AP, 'ap']])} 点魔法伤害，并使其减速 ${pct(R_SLOW)}。\n`
          + `${R_DURATION} 秒后，仍在 ${R_LEASH} 码内的被链接者再次受到等量魔法伤害，并被眩晕 ${R_STUN} 秒。莫甘娜朝被链接者移动时获得 ${pct(rv(R_MS, r))} 移动速度。`;
      },
      cooldown: R_CD,
      cost: [100, 100, 100],
      range: R_RADIUS,
      targeting: 'self',
      indicator: { type: 'self', radius: R_RADIUS },
      castTime: 0.35,
      lockMovement: true,
      sfx: 'chain',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const foes = game.queryUnits({ x: champ.x, y: champ.y, radius: R_RADIUS, enemyOf: champ, targetableBy: champ, types: ['champion'] }).filter(hittable);
        if (foes.length === 0) return false;
        const tethers = [];
        for (const u of foes) {
          game.dealDamage(champ, u, rDamage(champ, rank), 'magic', { isAbility: true, isAoE: true, spell: 'morgana_r' });
          if (!u.alive) continue;
          u.slow(R_SLOW, R_DURATION, champ);
          u.revealedUntil = Math.max(u.revealedUntil || 0, game.time + R_DURATION);
          tethers.push({ unit: u, broken: false });
        }
        champ.modelState.morganaChains = true;
        game.fx.custom('morgana_r_chains', { unit: champ, tethers, duration: R_DURATION, radius: R_RADIUS });
        champ.addBuff({
          id: 'morgana_r', name: '灵魂镣铐', desc: '朝被链接的敌人移动时获得移动速度', icon: ICONS.R, source: champ,
          duration: R_DURATION, refresh: 'replace', data: { tethers, rank },
          statsFn: (u, b) => {
            if (!u.moving || !u.path || u.path.length === 0) return null;
            const p = u.path[0];
            const mx = p.x - u.x, my = p.y - u.y;
            const ml = Math.hypot(mx, my) || 1;
            for (const t of b.data.tethers) {
              if (t.broken || !t.unit.alive) continue;
              const tx = t.unit.x - u.x, ty = t.unit.y - u.y;
              const tl = Math.hypot(tx, ty) || 1;
              if ((mx * tx + my * ty) / (ml * tl) > 0.5) return { moveSpeedPct: rv(R_MS, b.data.rank) };
            }
            return null;
          },
          onTick: (u, b) => {
            for (const t of b.data.tethers) {
              if (t.broken) continue;
              const v = t.unit;
              if (!v.alive || v.removed || v.untargetable || u.distTo(v) > R_LEASH) {
                t.broken = true;
                game.fx.custom('morgana_r_break', { unit: v, x: v.x, y: v.y, caster: u });
              }
            }
            if (b.data.tethers.every((t) => t.broken)) u.removeBuff(b);
          },
          onExpire: (u, b) => {
            if (!u.alive) return;
            for (const t of b.data.tethers) {
              const v = t.unit;
              if (t.broken || !v.alive || v.untargetable || u.distTo(v) > R_LEASH) continue;
              game.dealDamage(u, v, rDamage(u, b.data.rank), 'magic', { isAbility: true, isAoE: true, spell: 'morgana_r_stun' });
              if (v.alive) v.applyCC('stun', R_STUN, { source: u });
              game.fx.custom('morgana_r_burst', { unit: v, x: v.x, y: v.y, duration: R_STUN });
            }
          },
          onRemove: (u) => { u.modelState.morganaChains = false; },
        });
      },
      ai: {
        kind: 'aoe', range: R_RADIUS - 75, radius: R_RADIUS - 75, minTargets: 2, delay: 0.35,
        damage: (champ, target, rank) => mitigate(champ, target, rDamage(champ, rank) * 2, 'magic'),
      },
    },
  },

  ai: { skillOrder: ['Q', 'W', 'E'], style: 'support', engageRange: 900, kiteDistance: 550, combo: ['Q', 'W', 'R', 'E'] },
};
