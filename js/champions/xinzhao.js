// 英雄：赵信（德邦总管）—— 果决（三连击回血）、三重爪击（第三下击飞）、风斩电刺（横扫 + 突刺减速）、无畏冲锋（冲锋减速+攻速）、新月护卫（击退 + 远程免伤）
import { rv, fmt, pct, scaleText } from './_common.js';
import { byLevel } from '../core/math.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本） ——
const P_AD = [0.15, 0.28, 0.4, 0.55];          // 1/6/11/16 级：第三次普攻额外物理伤害（总攻击力比例）
const P_HEAL = [7, 92];                         // 1→18 级基础回复
const P_HEAL_AD = 0.07;
const P_HEAL_AP = 0.55;

const Q_BASE = [16, 29, 42, 55, 68];
const Q_BAD = 0.4;
const Q_DUR = 4;
const Q_KNOCKUP = 0.75;
const Q_CDR = 1;                                // 每次强化普攻：其他基础技能冷却 -1 秒
const Q_COST = [30, 30, 30, 30, 30];
const Q_CD = [7, 6.5, 6, 5.5, 5];

const W_SLASH_BASE = [30, 40, 50, 60, 70];
const W_SLASH_AD = 0.3;
const W_SLASH_RANGE = 450;
const W_SLASH_ANGLE = 120;
const W_THRUST_BASE = [50, 85, 120, 155, 190];
const W_THRUST_AD = 0.8;
const W_RANGE = 900;
const W_WIDTH = 50;                             // 半宽
const W_THRUST_DELAY = 0.3;
const W_SLOW = 0.5;
const W_SLOW_DUR = 1.5;
const W_COST = [45, 50, 55, 60, 65];
const W_CD = [12, 11, 10, 9, 8];

const E_BASE = [50, 75, 100, 125, 150];
const E_AP = 0.6;
const E_RANGE = 650;
const E_RADIUS = 225;
const E_SPEED = 2500;
const E_SLOW = 0.3;
const E_SLOW_DUR = 0.5;
const E_AS = [0.4, 0.45, 0.5, 0.55, 0.6];
const E_AS_DUR = 5;
const E_COST = [50, 50, 50, 50, 50];
const E_CD = [12, 12, 12, 12, 12];

const R_BASE = [75, 175, 275];
const R_BAD = 1.0;
const R_AP = 1.1;
const R_CUR_HP = 0.15;
const R_RADIUS = 450;
const R_KNOCK = 500;
const R_GUARD = 3;
const R_MONSTER_CAP = 600;
const R_COST = [100, 100, 100];
const R_CD = [120, 110, 100];

const CHALLENGE_DUR = 3;

const GOLD = 0xffcf5a;
const CRIMSON = 0xd83a2a;
const SPARK = 0xfff2b0;

const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('决', '#e8b050', '#5a2a10'),
  Q: icon('爪', '#ffd070', '#7a3a10'),
  W: icon('刺', '#ffe090', '#6a4a14'),
  E: icon('锋', '#ff9a5a', '#6a1a10'),
  R: icon('卫', '#ffd880', '#8a2a14'),
};

// —— 公式 ——
export function xinPassiveAd(level) { return level >= 16 ? P_AD[3] : level >= 11 ? P_AD[2] : level >= 6 ? P_AD[1] : P_AD[0]; }
export function xinPassiveHeal(champ) { return byLevel(champ.level, P_HEAL[0], P_HEAL[1]) + P_HEAL_AD * champ.stats.ad + P_HEAL_AP * champ.stats.ap; }
export function xinQBonus(champ, rank) { return rv(Q_BASE, rank) + Q_BAD * (champ?.stats?.bonusAd || 0); }
export function xinWSlash(champ, rank) { return rv(W_SLASH_BASE, rank) + W_SLASH_AD * (champ?.stats?.ad || 0); }
export function xinWThrust(champ, rank) { return rv(W_THRUST_BASE, rank) + W_THRUST_AD * (champ?.stats?.ad || 0); }
export function xinEDamage(champ, rank) { return rv(E_BASE, rank) + E_AP * (champ?.stats?.ap || 0); }
export function xinRDamage(champ, rank, target) {
  let d = rv(R_BASE, rank) + R_BAD * (champ?.stats?.bonusAd || 0) + R_AP * (champ?.stats?.ap || 0);
  if (target) {
    let cur = R_CUR_HP * Math.max(0, target.hp);
    if (target.type === 'monster') cur = Math.min(R_MONSTER_CAP, cur);
    d += cur;
  }
  return d;
}

// 挑战：最近一次被赵信普攻 / 无畏冲锋 / 风斩电刺命中的敌方英雄
function challenge(champ, u) {
  if (!u || u.type !== 'champion' || u.team === champ.team) return;
  champ.passive.state.challenged = { unit: u, until: champ.game.time + CHALLENGE_DUR };
}
export function xinChallenged(champ) {
  const c = champ.passive?.state?.challenged;
  if (!c || !c.unit?.alive || champ.game.time > c.until) return null;
  return c.unit;
}

// —— AI 辅助 ——
function aiEnemies(ai, champ, radius) {
  const list = ai?.visibleEnemies?.(radius);
  if (Array.isArray(list)) return list.filter((e) => e && e.alive && e.type === 'champion' && !e.untargetable && champ.distTo(e) <= radius + (e.radius || 0));
  return champ.game.queryUnits({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
}
function aiHp(ai, champ) {
  const v = ai?.hpPct?.();
  return typeof v === 'number' && Number.isFinite(v) ? v : champ.hp / champ.maxHp;
}
function aiCtx(ai) { return typeof ai?.castContext === 'string' ? ai.castContext : null; }

export default {
  id: 'xinzhao',
  name: '赵信',
  title: '德邦总管',
  roles: ['jungle'],
  tags: ['战士', '刺客'],
  difficulty: 2,
  lore: '光盾王朝的忠诚护卫，一杆长枪百战不殆，为德玛西亚冲锋陷阵。',
  baseStats: {
    hp: 640, hpPerLevel: 106, hpRegen: 7, hpRegenPerLevel: 0.7,
    mana: 274, manaPerLevel: 55, manaRegen: 7.25, manaRegenPerLevel: 0.45, resource: 'mana',
    ad: 63, adPerLevel: 3, as: 0.645, asRatio: 0.645, asPerLevel: 3.5,
    armor: 35, armorPerLevel: 4.4, mr: 32, mrPerLevel: 2.05,
    ms: 345, range: 175, radius: 65, windup: 0.3, missileSpeed: 0, critMult: 1.75,
  },
  model: { primary: 0xc8a040, secondary: 0x8a1a14, accent: 0xffcf5a },
  portrait: { bg: ['#b8862a', '#3a0c08'], glyph: '赵' },

  // —— 被动：果决 ——
  passive: {
    id: 'xinzhao_passive',
    name: '果决',
    icon: ICONS.P,
    desc: (champ) => {
      const lv = champ?.level || 1;
      const p = xinPassiveAd(lv);
      return `赵信每第 3 次普攻额外造成 ${pct(p)} 攻击力${champ ? `（${fmt(p * champ.stats.ad)}）` : ''} 的物理伤害（1/6/11/16 级：15%/28%/40%/55%），`
        + `并回复 ${champ ? fmt(xinPassiveHeal(champ)) : P_HEAL[0]} 点生命值（${P_HEAL[0]}~${P_HEAL[1]} +${pct(P_HEAL_AD)} 攻击力 +${pct(P_HEAL_AP)} 法术强度）。`;
    },
    init(champ) {
      const st = champ.passive.state;
      st.count = 0;
      st.challenged = null;
      champ.addHook('onHit', (target, hit) => {
        if (!target || target.type === 'ward') return;
        st.count++;
        champ.modelState.determination = st.count % 3;
        if (target.type === 'champion') challenge(champ, target);
        if (st.count < 3) return;
        st.count = 0;
        champ.modelState.determination = 0;
        hit.extra.push({ amount: xinPassiveAd(champ.level) * champ.stats.ad, type: 'physical', spell: 'xinzhao_passive' });
        hit.xinPassive = true;
      });
      champ.addHook('afterHit', (target, hit) => {
        if (!hit.xinPassive) return;
        champ.game.heal(champ, champ, xinPassiveHeal(champ), { spell: 'xinzhao_passive' });
        champ.game.fx.custom('xinzhao_p_hit', { unit: target, owner: champ, x: target.x, y: target.y });
      });
    },
  },

  abilities: {
    // —— Q：三重爪击 ——
    Q: {
      id: 'xinzhao_q',
      name: '三重爪击',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `赵信接下来的 3 次普攻（${Q_DUR} 秒内）额外造成 ${scaleText(champ, rv(Q_BASE, r), [[Q_BAD, 'bonusAd']])} 点物理伤害，第 3 次攻击击飞目标 ${Q_KNOCKUP} 秒。\n`
          + `每次强化普攻使他其他基础技能的冷却缩短 ${Q_CDR} 秒。该技能会重置普攻计时。`;
      },
      cooldown: Q_CD,
      cost: Q_COST,
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: 175 },
      castTime: 0,
      lockMovement: false,
      sfx: 'buff',
      onLearn(champ) {
        champ.addHook('onHit', (target, hit) => {
          const b = champ.getBuff('xinzhao_q');
          if (!b || !target || target.type === 'ward') return;
          const n = 4 - b.stacks;   // 第几次（1..3）
          hit.extra.push({ amount: xinQBonus(champ, b.data.rank), type: 'physical', spell: 'xinzhao_q' });
          hit.xinQ = n;
          for (const s of ['W', 'E']) champ.abilities[s]?.reduceCooldown?.(Q_CDR);
          if (b.stacks <= 1) champ.removeBuff(b);
          else b.stacks--;
        });
        champ.addHook('afterHit', (target, hit) => {
          if (!hit.xinQ) return;
          const third = hit.xinQ >= 3;
          if (third && target.alive && !target.isStructure) target.knockup(Q_KNOCKUP, champ, 180);
          champ.game.fx.custom('xinzhao_q_hit', { unit: target, owner: champ, x: target.x, y: target.y, third, index: hit.xinQ });
        });
      },
      cast(champ, ctx) {
        champ.addBuff({
          id: 'xinzhao_q', name: '三重爪击', desc: '接下来的普攻造成额外伤害，第三次击飞', icon: ICONS.Q, source: champ,
          duration: Q_DUR, stacks: 3, maxStacks: 3, refresh: 'replace', data: { rank: ctx.rank },
          onApply: (u) => { u.modelState.threeTalon = true; },
          onRemove: (u) => { u.modelState.threeTalon = false; },
        });
        champ.resetAttack();
        champ.game.fx.custom('xinzhao_q_empower', { unit: champ, duration: Q_DUR });
      },
      ai: {
        kind: 'selfbuff', range: 300,
        when: (champ, target) => !!target && target.alive && !target.isStructure && champ.distTo(target) < champ.stats.attackRange + champ.radius + target.radius + 200,
      },
    },

    // —— W：风斩电刺 ——
    W: {
      id: 'xinzhao_w',
      name: '风斩电刺',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `赵信先向前方扇形横扫，造成 ${scaleText(champ, rv(W_SLASH_BASE, r), [[W_SLASH_AD, 'ad']])} 点物理伤害；随后长枪突刺 ${W_RANGE} 码，`
          + `造成 ${scaleText(champ, rv(W_THRUST_BASE, r), [[W_THRUST_AD, 'ad']])} 点物理伤害，并使被突刺命中的敌人减速 ${pct(W_SLOW)}，持续 ${W_SLOW_DUR} 秒。\n被突刺命中的敌方英雄会受到挑战。`;
      },
      cooldown: W_CD,
      cost: W_COST,
      range: W_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: W_WIDTH * 2, length: W_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'slash',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const dx = ctx.dirX, dy = ctx.dirY;
        // 横扫
        const slash = game.queryCone({ x: champ.x, y: champ.y, dirX: dx, dirY: dy, angle: W_SLASH_ANGLE, range: W_SLASH_RANGE, enemyOf: champ }).filter((u) => !u.untargetable);
        const sd = xinWSlash(champ, rank);
        for (const u of slash) game.dealDamage(champ, u, sd, 'physical', { isAbility: true, isAoE: true, spell: 'xinzhao_w_slash' });
        game.fx.custom('xinzhao_w_slash', { unit: champ, x: champ.x, y: champ.y, dirX: dx, dirY: dy, range: W_SLASH_RANGE, angle: W_SLASH_ANGLE });
        // 突刺（短暂定身施法）
        champ.castLock = Math.max(champ.castLock, W_THRUST_DELAY);
        champ._castLockMove = true;
        champ.playCastAnim?.('W', W_THRUST_DELAY + 0.2);
        game.after(W_THRUST_DELAY, () => {
          if (!champ.alive) return;
          const x2 = champ.x + dx * W_RANGE, y2 = champ.y + dy * W_RANGE;
          const hits = game.queryLine({ x1: champ.x, y1: champ.y, x2, y2, width: W_WIDTH, enemyOf: champ }).filter((u) => !u.untargetable);
          const td = xinWThrust(champ, rank);
          game.fx.custom('xinzhao_w_thrust', { unit: champ, x: champ.x, y: champ.y, dirX: dx, dirY: dy, length: W_RANGE, width: W_WIDTH });
          for (const u of hits) {
            game.dealDamage(champ, u, td, 'physical', { isAbility: true, isAoE: true, spell: 'xinzhao_w_thrust' });
            if (!u.alive) continue;
            u.slow(W_SLOW, W_SLOW_DUR, champ);
            challenge(champ, u);
          }
        });
      },
      ai: {
        kind: 'nuke', range: W_RANGE - 60, width: W_WIDTH, delay: 0.25 + W_THRUST_DELAY, farm: true,
        damage: (champ, target, rank) => {
          const raw = xinWThrust(champ, rank) + (target && champ.distTo(target) < W_SLASH_RANGE ? xinWSlash(champ, rank) : 0);
          return target ? mitigate(champ, target, raw, 'physical') : raw;
        },
      },
    },

    // —— E：无畏冲锋 ——
    E: {
      id: 'xinzhao_e',
      name: '无畏冲锋',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `赵信冲向一名敌人，对目标及周围 ${E_RADIUS} 码内的敌人造成 ${scaleText(champ, rv(E_BASE, r), [[E_AP, 'ap']])} 点魔法伤害，并减速 ${pct(E_SLOW)}，持续 ${E_SLOW_DUR} 秒。\n`
          + `之后获得 ${pct(rv(E_AS, r))} 攻击速度，持续 ${E_AS_DUR} 秒。被冲锋的敌方英雄会受到挑战（不会被新月护卫击退）。`;
      },
      cooldown: E_CD,
      cost: E_COST,
      range: E_RANGE,
      targeting: 'unit',
      targetFilter: 'enemy',
      indicator: { type: 'unit' },
      castTime: 0,
      lockMovement: false,
      sfx: 'dash',
      cast(champ, ctx) {
        const game = champ.game;
        const t = ctx.target;
        const rank = ctx.rank;
        if (!t || !t.alive) return false;
        const ok = champ.dash({
          followTarget: t, speed: E_SPEED, stopDistance: champ.radius * 0.5, ignoreWalls: false,
          onEnd: (interrupted) => {
            champ.modelState.charging = false;
            if (interrupted || !champ.alive) return;
            const x = t.alive ? t.x : champ.x, y = t.alive ? t.y : champ.y;
            const dmg = xinEDamage(champ, rank);
            const hits = game.queryUnits({ x, y, radius: E_RADIUS, enemyOf: champ }).filter((u) => !u.untargetable);
            for (const u of hits) {
              game.dealDamage(champ, u, dmg, 'magic', { isAbility: true, isAoE: true, spell: 'xinzhao_e' });
              if (u.alive) u.slow(E_SLOW, E_SLOW_DUR, champ);
            }
            champ.addBuff({
              id: 'xinzhao_e_as', name: '无畏冲锋', desc: '攻击速度提升', icon: ICONS.E, source: champ,
              duration: E_AS_DUR, refresh: 'replace', stats: { attackSpeed: rv(E_AS, rank) },
            });
            if (t.alive) champ.attackUnit?.(t);
            game.fx.custom('xinzhao_e_impact', { x, y, radius: E_RADIUS, unit: champ });
          },
        });
        if (!ok) return false;
        champ.modelState.charging = true;
        challenge(champ, t);
        champ.passive.state.lastCharged = t;
        game.fx.custom('xinzhao_e_charge', { unit: champ, target: t, duration: Math.max(0.1, champ.distTo(t) / E_SPEED + 0.1) });
      },
      ai: {
        kind: 'gapclose', range: E_RANGE, farm: true,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, xinEDamage(champ, rank), 'magic') : xinEDamage(champ, rank)),
      },
    },

    // —— R：新月护卫 ——
    R: {
      id: 'xinzhao_r',
      name: '新月护卫',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `赵信横扫长枪，对周围 ${R_RADIUS} 码内的敌人造成 ${scaleText(champ, rv(R_BASE, r), [[R_BAD, 'bonusAd'], [R_AP, 'ap']])} + 目标当前生命值 ${pct(R_CUR_HP)} 的物理伤害（对野怪最多 ${R_MONSTER_CAP}），`
          + `并将除受挑战目标外的敌人击退 ${R_KNOCK} 码。\n之后 ${R_GUARD} 秒内，赵信免疫来自 ${R_RADIUS} 码以外敌人的伤害。`;
      },
      cooldown: R_CD,
      cost: R_COST,
      range: R_RADIUS,
      targeting: 'self',
      indicator: { type: 'self', radius: R_RADIUS },
      castTime: 0.35,
      lockMovement: true,
      sfx: 'spin',
      onLearn(champ) {
        // 新月护卫：来源在范围外的伤害无效
        champ.addHook('beforeTakeDamage', (ctx) => {
          if (!champ.hasBuff('xinzhao_r_guard')) return;
          const s = ctx.source;
          if (!s || s.team === champ.team || !Number.isFinite(s.x)) return;
          if (Math.hypot(s.x - champ.x, s.y - champ.y) > R_RADIUS + (s.radius || 0)) {
            ctx.cancel = true;
            champ.game.fx.custom('xinzhao_r_block', { unit: champ, x: s.x, y: s.y });
          }
        });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const chall = xinChallenged(champ);
        const hits = game.queryUnits({ x: champ.x, y: champ.y, radius: R_RADIUS, enemyOf: champ }).filter((u) => !u.untargetable);
        for (const u of hits) {
          game.dealDamage(champ, u, xinRDamage(champ, rank, u), 'physical', { isAbility: true, isAoE: true, spell: 'xinzhao_r' });
          if (!u.alive || u === chall) continue;
          u.knockback({ fromX: champ.x, fromY: champ.y, distance: R_KNOCK, duration: 0.5, source: champ, height: 90 });
        }
        champ.addBuff({
          id: 'xinzhao_r_guard', name: '新月护卫', desc: `免疫来自 ${R_RADIUS} 码以外的伤害`, icon: ICONS.R, source: champ, duration: R_GUARD, refresh: 'replace',
          onApply: (u) => { u.modelState.crescentGuard = true; },
          onRemove: (u) => { u.modelState.crescentGuard = false; },
        });
        game.fx.custom('xinzhao_r_sweep', { unit: champ, x: champ.x, y: champ.y, radius: R_RADIUS });
        game.fx.custom('xinzhao_r_guard', { unit: champ, radius: R_RADIUS, duration: R_GUARD });
      },
      ai: {
        kind: 'aoe', radius: R_RADIUS, range: R_RADIUS,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, xinRDamage(champ, rank, target), 'physical') : xinRDamage(champ, rank)),
        custom: (champ, ab, ai, game) => {
          if (!ab.ready || champ.mana < ab.cost) return false;
          const c = aiCtx(ai);
          if (c !== null && c !== 'fight' && c !== 'peel' && c !== 'escape') return false;
          const near = aiEnemies(ai, champ, R_RADIUS - 40);
          if (near.length === 0) return false;
          const far = aiEnemies(ai, champ, 1300).filter((e) => champ.distTo(e) > R_RADIUS);
          const hp = aiHp(ai, champ);
          const kill = near.some((e) => mitigate(champ, e, xinRDamage(champ, ab.rank, e), 'physical') >= e.hp + e.totalShield);
          if (kill || near.length >= 2 || (hp < 0.4) || (far.length >= 2 && hp < 0.7) || c === 'escape') return !!champ.castAbility('R').ok;
          return false;
        },
      },
    },
  },

  ai: { skillOrder: ['Q', 'W', 'E'], style: 'bruiser', engageRange: 650, kiteDistance: 0, combo: ['E', 'Q', 'W', 'R'] },
};

