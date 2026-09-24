// 英雄：安妮（黑暗之女）—— 被动嗜火（4 层眩晕）、Q 碎裂之火（击杀返还）、W 焚烧、E 熔岩护盾（反伤）、R 提伯斯之怒（召唤并可指挥提伯斯）
import { rv, fmt, pct, scaleText } from './_common.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本附近） ——
const P_STACKS = 4;
const P_STUN = (level) => (level >= 11 ? 1.75 : level >= 6 ? 1.5 : 1.25);

const Q_DMG = [80, 115, 150, 185, 220];          // （+80% AP）
const Q_AP = 0.80;
const Q_RANGE = 625;
const Q_SPEED = 1400;
const Q_COST = [60, 65, 70, 75, 80];
const Q_REFUND_CD = 0.5;                         // 击杀返还 50% 冷却

const W_DMG = [70, 115, 160, 205, 250];          // （+85% AP）
const W_AP = 0.85;
const W_RANGE = 600;
const W_ANGLE = 50;
const W_COST = [70, 80, 90, 100, 110];

const E_SHIELD = [60, 95, 130, 165, 200];        // （+40% AP）
const E_AP = 0.40;
const E_DURATION = 3;
const E_REFLECT = [20, 30, 40, 50, 60];          // （+20% AP）
const E_REFLECT_AP = 0.20;
const E_MS = [0.20, 0.25, 0.30, 0.35, 0.40];     // 递减移速
const E_MS_DUR = 1.5;
const E_RANGE = 800;
const E_COST = [40, 40, 40, 40, 40];
const E_CD = [14, 13, 12, 11, 10];

const R_DMG = [150, 275, 400];                   // （+75% AP）
const R_AP = 0.75;
const R_RADIUS = 290;
const R_RANGE = 600;
const R_CD = [120, 100, 80];
const T_DURATION = 45;
const T_HP = [1300, 2100, 2900];                 // （+40% AP）
const T_HP_AP = 0.40;
const T_AD = [50, 75, 100];                      // （+15% AP）
const T_AD_AP = 0.15;
const T_RESIST = [30, 50, 70];
const T_AURA = [20, 30, 40];                     // 每秒（+12% AP）
const T_AURA_AP = 0.12;
const T_AURA_RADIUS = 350;
const T_FRENZY_AS = 2.75;                        // 召唤/安妮阵亡时的狂暴：攻速、移速递减
const T_FRENZY_MS = 1.0;
const T_FRENZY_DUR = 3;

const FIRE = 0xff7a1a;
const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('嗜', '#ff9a4a', '#5a1208'),
  PR: icon('嗜', '#ffe07a', '#b8260a'),
  Q: icon('碎', '#ffb04a', '#8a1a08'),
  W: icon('焚', '#ff7a3a', '#6a0a0a'),
  E: icon('熔', '#ffcf6a', '#8a2a0a'),
  R: icon('熊', '#c07aff', '#3a0a2a'),
};

// —— 数值计算 ——
const ap = (champ) => champ?.stats?.ap || 0;
const qDamage = (champ, rank) => rv(Q_DMG, rank) + Q_AP * ap(champ);
const wDamage = (champ, rank) => rv(W_DMG, rank) + W_AP * ap(champ);
const eShield = (champ, rank) => rv(E_SHIELD, rank) + E_AP * ap(champ);
const eReflect = (champ, rank) => rv(E_REFLECT, rank) + E_REFLECT_AP * ap(champ);
const rDamage = (champ, rank) => rv(R_DMG, rank) + R_AP * ap(champ);
const auraDamage = (champ, rank) => rv(T_AURA, rank) + T_AURA_AP * ap(champ);
const tibbersHp = (champ, rank) => rv(T_HP, rank) + T_HP_AP * ap(champ);
const tibbersAd = (champ, rank) => rv(T_AD, rank) + T_AD_AP * ap(champ);
export const ANNIE = { qDamage, wDamage, eShield, eReflect, rDamage, auraDamage, tibbersHp, tibbersAd, stunDuration: P_STUN };

const hittable = (u) => u && u.alive && !u.removed && !u.untargetable && !u.isStructure && u.type !== 'ward';

// —— 被动：嗜火 ——
function syncPyro(champ) {
  const st = champ.passive.state;
  const b = champ.getBuff('annie_pyromania');
  champ.modelState.pyroReady = !!st.ready;
  if (!b) return;
  b.stacks = st.ready ? P_STACKS : st.stacks;
  b.icon = st.ready ? ICONS.PR : ICONS.P;
  b.name = st.ready ? '嗜火：准备就绪' : '嗜火';
  b.desc = st.ready ? `下一个伤害技能将眩晕目标 ${fmt(P_STUN(champ.level), 2)} 秒` : `每施放 ${P_STACKS} 次技能，下一个伤害技能会眩晕目标（${st.stacks}/${P_STACKS}）`;
}
// 施放伤害技能时调用：若已就绪则消耗并返回眩晕时长
function consumePyro(champ) {
  const st = champ.passive.state;
  if (!st.ready) return 0;
  st.ready = false;
  st.stacks = 0;
  st.consumed = true;
  syncPyro(champ);
  return P_STUN(champ.level);
}
function stunTarget(champ, u, dur) {
  if (!(dur > 0) || !u.alive) return;
  u.applyCC('stun', dur, { source: champ });
  champ.game.fx.custom('annie_stun_burst', { unit: u });
}
// 记录安妮最近的攻击目标（提伯斯跟随攻击）
function setFocus(champ, u) {
  if (!u || u.team === champ.team || u.isStructure) return;
  const st = champ.passive.state;
  st.focus = u;
  st.focusAt = champ.game.time;
}

// —— 熔岩护盾 ——
function moltenShield(champ, u, rank) {
  const game = champ.game;
  if (!u || !u.alive) return;
  u.addShield(eShield(champ, rank), E_DURATION, { source: champ, id: 'annie_e' });
  const msMax = rv(E_MS, rank);
  const buff = u.addBuff({
    id: 'annie_e', name: '熔岩护盾', desc: '获得护盾；普攻你的敌人会受到魔法伤害；移动速度提升（递减）', icon: ICONS.E,
    source: champ, duration: E_DURATION, refresh: 'replace',
    statsFn: (unit, b) => {
      const s = b.data.s || (b.data.s = { moveSpeedPct: 0 });
      s.moveSpeedPct = msMax * Math.max(0, 1 - b.elapsed / E_MS_DUR);
      return s;
    },
    data: { rank },
    onApply: (unit, b) => {
      // 反伤：受到敌方普攻时对攻击者造成魔法伤害
      b.data.off = unit.addHook('afterTakeDamage', (dctx) => {
        const src = dctx.source;
        if (!dctx.isBasicAttack || !src || !src.alive || src.team === unit.team || src.isStructure || !src.stats) return;
        game.dealDamage(champ, src, eReflect(champ, b.data.rank), 'magic', { isAbility: true, spell: 'annie_e' });
        game.fx.impact({ x: src.x, y: src.y, h: 90, color: FIRE, size: 0.6 });
      });
    },
    onRemove: (unit, b) => { if (b.data.off) b.data.off(); },
  });
  game.fx.custom('annie_e_shield', { unit: u, buff, duration: E_DURATION });
}

// —— 提伯斯 ——
function frenzy(tib) {
  tib.addBuff({
    id: 'tibbers_frenzy', name: '狂暴', desc: '攻击速度与移动速度大幅提升（递减）', icon: ICONS.R, duration: T_FRENZY_DUR, refresh: 'replace',
    statsFn: (u, b) => {
      const s = b.data.s || (b.data.s = { attackSpeed: 0, moveSpeedPct: 0 });
      const k = Math.max(0, 1 - b.elapsed / T_FRENZY_DUR);
      s.attackSpeed = T_FRENZY_AS * k;
      s.moveSpeedPct = T_FRENZY_MS * k;
      return s;
    },
  });
}
// 提伯斯 AI：优先攻击安妮最近攻击的目标，否则默认宠物逻辑
function tibbersThink(champ, pet) {
  const game = champ.game;
  const st = champ.passive.state;
  const f = st.focus;
  if (f && f.alive && !f.removed && game.time - (st.focusAt ?? -99) < 4 && f.isTargetableBy(pet) && pet.distTo(f) < 1200) {
    if (!pet.command || pet.command.target !== f) pet.attackUnit(f);
    return;
  }
  pet.defaultThink();
}
function summonTibbers(champ, ab, x, y, rank) {
  const game = champ.game;
  const old = ab.state.tibbers;
  if (old && old.alive) old.expire();
  const tib = game.spawnPet({
    owner: champ, x, y, modelId: 'tibbers', name: '提伯斯', duration: T_DURATION, radius: 80,
    baseStats: {
      hp: tibbersHp(champ, rank), hpRegen: 0, ad: tibbersAd(champ, rank), armor: rv(T_RESIST, rank), mr: rv(T_RESIST, rank),
      as: 0.625, asRatio: 0.625, ms: 350, range: 125, radius: 80, windup: 0.3,
    },
    think: (pet) => tibbersThink(champ, pet),
  });
  tib.facing = champ.facing;
  frenzy(tib);
  ab.state.tibbers = tib;
  champ.modelState.tibbersOut = true;
  // 灼烧光环：每秒对周围敌人造成魔法伤害
  game.spawnZone({
    owner: champ, team: champ.team, x: tib.x, y: tib.y, follow: tib, radius: T_AURA_RADIUS, duration: T_DURATION + 1,
    tickInterval: 1, delay: 1, filter: 'enemy', vfx: null,
    onTick: (z, units) => {
      if (!tib.alive) return;
      for (const u of units) {
        if (!hittable(u)) continue;
        game.dealDamage(tib, u, auraDamage(champ, rank), 'magic', { isAbility: true, isAoE: true, isDot: true, isPet: true, spell: 'annie_r_aura' });
      }
    },
  });
  game.fx.custom('annie_tibbers_aura', { unit: tib, radius: T_AURA_RADIUS });
  tib.addHook('onDeath', () => {
    if (ab.state.tibbers === tib) {
      ab.state.tibbers = null;
      champ.modelState.tibbersOut = false;
      if (ab.isRecastActive) ab.endRecast(false);
    }
    game.fx.custom('annie_tibbers_poof', { x: tib.x, y: tib.y, expired: !!tib.expired });
  });
  return tib;
}

// —— AI 辅助 ——
function aiOk(r) { return r === true || !!(r && r.ok); }
function aiCastAt(champ, ai, slot, x, y) {
  return aiOk(typeof ai?.castAt === 'function' ? ai.castAt(slot, x, y) : champ.castAbility(slot, { x, y }));
}
function aiCastOn(champ, ai, slot, unit) {
  return aiOk(typeof ai?.castOn === 'function' ? ai.castOn(slot, unit) : champ.castAbility(slot, { target: unit }));
}
function aiEnemies(champ, ai, radius) {
  const list = ai?.visibleEnemies?.(radius);
  const src = Array.isArray(list) ? list
    : champ.game.queryUnits({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
  return src.filter((u) => u && u.alive && u.type === 'champion' && u.isTargetableBy(champ) && champ.distTo(u) <= radius);
}
function aiAllies(champ, ai, radius) {
  const list = ai?.nearbyAllies?.(radius);
  const src = Array.isArray(list) ? list : champ.game.champions.filter((c) => c.team === champ.team && c.alive && champ.distTo(c) <= radius);
  return src.filter((u) => u && u.alive && u !== champ);
}
function aiPickTarget(champ, ai, range) {
  const t = ai?.target;
  if (t && t.alive && t.type === 'champion' && t.team !== champ.team && t.isTargetableBy(champ) && champ.distTo(t) <= range) return t;
  const list = aiEnemies(champ, ai, range);
  if (list.length === 0) return null;
  return list.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a));
}
function manaPct(champ) { return champ.maxMana > 0 ? champ.mana / champ.maxMana : 1; }
function farmMode(ai) { return ['laning', 'pushing', 'jungling', 'objective'].includes(ai?.mode); }
const magicTo = (champ, target, raw) => (target ? mitigate(champ, target, raw, 'magic') : raw);
// 已就绪的眩晕是否应该留给英雄
function saveStun(champ, ai) { return champ.passive.state.ready && aiEnemies(champ, ai, 1100).length > 0; }
// 快速估算一套连招（Q+W+R）对目标的伤害
function burst(champ, t) {
  let raw = 0;
  const A = champ.abilities;
  if (A.Q.rank > 0 && (A.Q.ready || A.Q.cdRemaining < 1)) raw += qDamage(champ, A.Q.rank);
  if (A.W.rank > 0 && (A.W.ready || A.W.cdRemaining < 1)) raw += wDamage(champ, A.W.rank);
  if (A.R.rank > 0 && A.R.ready && !A.R.isRecastActive) raw += rDamage(champ, A.R.rank) + auraDamage(champ, A.R.rank) * 2;
  return magicTo(champ, t, raw);
}

export default {
  id: 'annie',
  name: '安妮',
  title: '黑暗之女',
  roles: ['mid'],
  tags: ['法师'],
  difficulty: 1,
  lore: '拥有可怕纵火天赋的小女孩，总是抱着她最心爱的泰迪熊——提伯斯。',
  baseStats: {
    hp: 560, hpPerLevel: 96, hpRegen: 5.5, hpRegenPerLevel: 0.55,
    mana: 418, manaPerLevel: 25, manaRegen: 8, manaRegenPerLevel: 0.8, resource: 'mana',
    ad: 50, adPerLevel: 2.65, as: 0.61, asRatio: 0.625, asPerLevel: 1.36,
    armor: 23, armorPerLevel: 4, mr: 30, mrPerLevel: 1.3,
    ms: 335, range: 625, radius: 65, windup: 0.1958, critMult: 1.75,
    missileSpeed: 1200, attackVfx: { kind: 'fireball', color: 0xff8a2a, size: 0.6, trail: true },
  },
  model: { primary: 0xd8342a, secondary: 0x2a1a2a, accent: 0xff9a2a },
  portrait: { bg: ['#d8442a', '#2a0a08'], glyph: '安' },

  // —— 被动：嗜火 ——
  passive: {
    id: 'annie_passive',
    name: '嗜火',
    icon: ICONS.P,
    desc: (champ) => {
      const st = champ?.passive?.state;
      const now = st ? (st.ready ? '（已就绪）' : `（当前 ${st.stacks}/${P_STACKS}）`) : '';
      return `安妮每施放 ${P_STACKS} 次技能，她的下一个伤害技能会眩晕目标 ${fmt(P_STUN(champ?.level || 1), 2)} 秒（1/6/11 级：1.25/1.5/1.75 秒）${now}。\n`
        + '召唤提伯斯时的伤害同样会触发眩晕。';
    },
    init(champ) {
      const st = champ.passive.state;
      st.stacks = 0;
      st.ready = false;
      st.max = P_STACKS;
      st.consumed = false;
      st.focus = null;
      st.focusAt = -99;
      champ.addBuff({
        id: 'annie_pyromania', name: '嗜火', desc: `每施放 ${P_STACKS} 次技能，下一个伤害技能会眩晕目标`, icon: ICONS.P,
        duration: Infinity, persistOnDeath: true, stacks: 0, maxStacks: P_STACKS,
      });
      champ.addHook('onAbilityCast', (slot, ab, ctx) => {
        if (ctx && ctx.isRecast) return; // 指挥提伯斯不计层数
        if (st.consumed) { st.consumed = false; syncPyro(champ); return; }
        if (st.ready) return;
        st.stacks = Math.min(P_STACKS, st.stacks + 1);
        if (st.stacks >= P_STACKS) {
          st.ready = true;
          champ.game.fx.custom('annie_pyro_ready', { unit: champ });
        }
        syncPyro(champ);
      });
      // 普攻目标作为提伯斯的集火目标
      champ.addHook('onAttackLaunch', (target) => setFocus(champ, target));
      // 安妮阵亡时提伯斯狂暴
      champ.addHook('onDeath', () => {
        const tib = champ.abilities.R?.state?.tibbers;
        if (tib && tib.alive) frenzy(tib);
      });
    },
  },

  abilities: {
    // —— Q：碎裂之火 ——
    Q: {
      id: 'annie_q',
      name: '碎裂之火',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `安妮向目标敌人投掷一枚火球，造成 ${scaleText(champ, rv(Q_DMG, r), [[Q_AP, 'ap']])} 点魔法伤害。\n`
          + `如果目标因此阵亡，安妮会返还该技能的法力消耗，并返还 ${pct(Q_REFUND_CD)} 冷却时间。`;
      },
      cooldown: [4, 4, 4, 4, 4],
      cost: Q_COST,
      range: Q_RANGE,
      targeting: 'unit',
      targetFilter: 'enemy',
      indicator: { type: 'unit' },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'fire',
      cast(champ, ctx) {
        const game = champ.game;
        const t = ctx.target;
        if (!t || !t.alive) return false;
        const ab = ctx.ability;
        const rank = ctx.rank;
        const cost = ab.cost;
        const stun = consumePyro(champ);
        setFocus(champ, t);
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, target: t, speed: Q_SPEED, width: 0, height: 110,
          vfx: { kind: 'annie_q_fireball', color: FIRE, size: 1.1, trail: true, fallback: 'fireball', stun: stun > 0 },
          onHit: (u) => {
            game.dealDamage(champ, u, qDamage(champ, rank), 'magic', { isAbility: true, spell: 'annie_q' });
            game.fx.impact({ x: u.x, y: u.y, h: 100, color: FIRE, size: 1.1 });
            if (!u.alive) {
              champ.mana = Math.min(champ.maxMana, champ.mana + cost);
              ab.reduceCooldown(ab.cdDuration * Q_REFUND_CD);
              game.fx.text({ x: champ.x, y: champ.y, h: 230, text: `+${Math.round(cost)}`, color: 0x6ab8ff, size: 16, duration: 0.8 });
            } else stunTarget(champ, u, stun);
          },
        });
      },
      ai: {
        kind: 'nuke', range: Q_RANGE, speed: Q_SPEED, delay: 0.25, farm: true,
        damage: (champ, target, rank) => magicTo(champ, target, qDamage(champ, rank)),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const t = aiPickTarget(champ, ai, Q_RANGE + 60);
          if (t) {
            // 眩晕就绪时优先用 R/W 开团（多人），单人时直接 Q 控
            return aiCastOn(champ, ai, 'Q', t);
          }
          // 补刀：Q 能击杀的小兵（眩晕就绪且附近有敌方英雄时保留）
          if (!farmMode(ai) || saveStun(champ, ai)) return false;
          if (manaPct(champ) < 0.3 && ai?.mode !== 'jungling') return false;
          const dmg = qDamage(champ, ability.rank);
          const cands = game.queryUnits({ x: champ.x, y: champ.y, radius: Q_RANGE, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'] });
          const kill = cands.find((m) => m.hp <= mitigate(champ, m, dmg, 'magic') * 0.95 && m.hp > champ.stats.ad * 0.8);
          if (kill) return aiCastOn(champ, ai, 'Q', kill);
          if (ai?.mode === 'jungling' && cands.some((m) => m.type === 'monster')) return aiCastOn(champ, ai, 'Q', cands.find((m) => m.type === 'monster'));
          return false;
        },
      },
    },

    // —— W：焚烧 ——
    W: {
      id: 'annie_w',
      name: '焚烧',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `安妮向前方 ${W_ANGLE}° 扇形区域（${W_RANGE} 码）喷出火焰，对区域内的所有敌人造成 ${scaleText(champ, rv(W_DMG, r), [[W_AP, 'ap']])} 点魔法伤害。`;
      },
      cooldown: [8, 8, 8, 8, 8],
      cost: W_COST,
      range: W_RANGE,
      targeting: 'direction',
      indicator: { type: 'cone', angle: W_ANGLE, length: W_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'fire',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const stun = consumePyro(champ);
        const hits = game.queryCone({ x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, angle: W_ANGLE, range: W_RANGE, enemyOf: champ }).filter(hittable);
        for (const u of hits) {
          game.dealDamage(champ, u, wDamage(champ, rank), 'magic', { isAbility: true, isAoE: true, spell: 'annie_w' });
          if (u.alive) stunTarget(champ, u, stun);
        }
        const champHit = hits.find((u) => u.type === 'champion');
        if (champHit) setFocus(champ, champHit);
        game.fx.custom('annie_w_cone', { unit: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, angle: W_ANGLE, range: W_RANGE, stun: stun > 0 });
      },
      ai: {
        kind: 'aoe', range: W_RANGE, radius: W_RANGE, delay: 0.25, farm: true,
        damage: (champ, target, rank) => magicTo(champ, target, wDamage(champ, rank)),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const t = aiPickTarget(champ, ai, W_RANGE + 30);
          if (t) {
            // 眩晕就绪时：尽量让扇形覆盖更多英雄
            const foes = aiEnemies(champ, ai, W_RANGE + 30);
            let aim = t;
            if (champ.passive.state.ready && foes.length > 1) {
              let bestN = 0;
              for (const f of foes) {
                const n = game.queryCone({ x: champ.x, y: champ.y, dirX: f.x - champ.x, dirY: f.y - champ.y, angle: W_ANGLE, range: W_RANGE, enemyOf: champ, types: ['champion'] }).length;
                if (n > bestN) { bestN = n; aim = f; }
              }
            }
            return aiCastAt(champ, ai, 'W', aim.x, aim.y);
          }
          if (!farmMode(ai) || saveStun(champ, ai) || manaPct(champ) < 0.5) return false;
          const cands = game.queryUnits({ x: champ.x, y: champ.y, radius: W_RANGE, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'] });
          if (cands.length === 0) return false;
          let best = null, bestN = 0;
          for (const m of cands) {
            const n = game.queryCone({ x: champ.x, y: champ.y, dirX: m.x - champ.x, dirY: m.y - champ.y, angle: W_ANGLE, range: W_RANGE, enemyOf: champ, types: ['minion', 'monster'] }).length;
            if (n > bestN) { bestN = n; best = m; }
          }
          const needed = cands.some((m) => m.type === 'monster') ? 1 : 3;
          if (!best || bestN < needed) return false;
          return aiCastAt(champ, ai, 'W', best.x, best.y);
        },
      },
    },

    // —— E：熔岩护盾 ——
    E: {
      id: 'annie_e',
      name: '熔岩护盾',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `为安妮或一名友方英雄提供 ${scaleText(champ, rv(E_SHIELD, r), [[E_AP, 'ap']])} 点护盾，持续 ${E_DURATION} 秒，并提供 ${pct(rv(E_MS, r))} 移动速度（在 ${E_MS_DUR} 秒内递减）。\n`
          + `护盾期间，用普攻攻击该目标的敌人会受到 ${scaleText(champ, rv(E_REFLECT, r), [[E_REFLECT_AP, 'ap']])} 点魔法伤害。提伯斯在场时也会获得护盾。`;
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
        const t = ctx.target && ctx.target.alive && ctx.target.team === champ.team ? ctx.target : champ;
        moltenShield(champ, t, ctx.rank);
        const tib = champ.abilities.R?.state?.tibbers;
        if (tib && tib.alive && tib !== t) moltenShield(champ, tib, ctx.rank);
      },
      ai: {
        kind: 'shield', range: E_RANGE,
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const now = game.time;
          const st = champ.passive.state;
          const foes = aiEnemies(champ, ai, 1200);
          // 挡伤害：自己正在被英雄/防御塔攻击
          const hurt = now - champ.lastDamagedAt < 0.8 && champ.hp / champ.maxHp < 0.85;
          if (hurt && (foes.length > 0 || champ.hp / champ.maxHp < 0.5)) return aiCastOn(champ, ai, 'E', champ);
          // 保护受到攻击的队友
          for (const a of aiAllies(champ, ai, E_RANGE)) {
            if (now - a.lastDamagedAt < 0.8 && a.hp / a.maxHp < 0.55 && foes.length > 0) return aiCastOn(champ, ai, 'E', a);
          }
          // 攒被动：差 1 层且敌方英雄靠近时，用 E 让眩晕就绪
          if (!st.ready && st.stacks === P_STACKS - 1 && foes.some((f) => champ.distTo(f) < 1000)) return aiCastOn(champ, ai, 'E', champ);
          // 对线期空闲叠层（法力充足、附近没有敌方英雄）
          if (!st.ready && foes.length === 0 && manaPct(champ) > 0.75 && ai?.mode !== 'shopping' && !champ.inFountain) return aiCastOn(champ, ai, 'E', champ);
          return false;
        },
      },
    },

    // —— R：提伯斯之怒 ——
    R: {
      id: 'annie_r',
      name: '提伯斯之怒',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `安妮在目标地点（${R_RANGE} 码）召唤她的熊宝宝提伯斯，对 ${R_RADIUS} 码范围内的敌人造成 ${scaleText(champ, rv(R_DMG, r), [[R_AP, 'ap']])} 点魔法伤害。\n`
          + `提伯斯持续 ${T_DURATION} 秒，拥有 ${fmt(tibbersHp(champ, r))} 点生命值与 ${fmt(tibbersAd(champ, r))} 点攻击力，身上的灼烧光环每秒对 ${T_AURA_RADIUS} 码内的敌人造成 ${scaleText(champ, rv(T_AURA, r), [[T_AURA_AP, 'ap']])} 点魔法伤害，`
          + `并会攻击安妮最近攻击的目标。召唤时（以及安妮阵亡时）提伯斯会狂暴，获得大幅递减的攻击速度与移动速度。\n提伯斯存在时，再次施放可指挥他攻击目标或移动。`;
      },
      cooldown: R_CD,
      cost: [100, 100, 100],
      range: R_RANGE,
      targeting: 'point',
      indicator: { type: 'circle', radius: R_RADIUS },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'explosion',
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const rank = ctx.rank;
        const x = ctx.x, y = ctx.y;
        const stun = consumePyro(champ);
        const hits = game.queryUnits({ x, y, radius: R_RADIUS, enemyOf: champ }).filter(hittable);
        for (const u of hits) {
          game.dealDamage(champ, u, rDamage(champ, rank), 'magic', { isAbility: true, isAoE: true, spell: 'annie_r' });
          if (u.alive) stunTarget(champ, u, stun);
        }
        const champHit = hits.find((u) => u.type === 'champion');
        if (champHit) setFocus(champ, champHit);
        game.fx.custom('annie_r_summon', { x, y, radius: R_RADIUS, stun: stun > 0 });
        summonTibbers(champ, ab, x, y, rank);
        ab.setRecast(T_DURATION, { cooldownOnExpire: false });
      },
      recast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const tib = ab.state.tibbers;
        if (!tib || !tib.alive) { ab.endRecast(false); return false; }
        const cx = ctx.cursorX ?? ctx.x, cy = ctx.cursorY ?? ctx.y;
        let t = ctx.target;
        if (!(t && t.alive && t.team !== champ.team && t.isTargetableBy(champ) && !t.isStructure)) {
          t = game.nearest({ x: cx, y: cy, radius: 200, enemyOf: champ, targetableBy: champ });
        }
        if (t) {
          tib.orderAttack(t, 4);
          setFocus(champ, t);
          game.fx.ring({ x: t.x, y: t.y, radius: 110, color: 0xff5a2a, duration: 0.5 });
        } else {
          tib.orderMove(cx, cy, 2);
          game.fx.ring({ x: cx, y: cy, radius: 80, color: 0xffb04a, duration: 0.4 });
        }
        return true;
      },
      ai: {
        kind: 'aoe', range: R_RANGE, radius: R_RADIUS, delay: 0.25,
        damage: (champ, target, rank) => magicTo(champ, target, rDamage(champ, rank) + auraDamage(champ, rank) * 3),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const st = ability.state;
          if (ability.isRecastActive) {
            // 指挥提伯斯攻击当前目标（节流）
            const tib = st.tibbers;
            if (!tib || !tib.alive || game.time - (st.lastOrderAt ?? -99) < 1.5) return false;
            const t = aiPickTarget(champ, ai, 1400);
            if (!t || tib.distTo(t) > 1100 || (tib.command && tib.command.target === t)) return false;
            st.lastOrderAt = game.time;
            return aiOk(champ.castAbility('R', { target: t, x: t.x, y: t.y }));
          }
          const foes = aiEnemies(champ, ai, R_RANGE + R_RADIUS);
          if (foes.length === 0) return false;
          // 选择命中英雄最多的落点（以每个英雄为候选中心）
          let best = null, bestN = 0;
          for (const f of foes) {
            const d = champ.distTo(f);
            let x = f.x, y = f.y;
            if (d > R_RANGE) { x = champ.x + ((f.x - champ.x) / d) * R_RANGE; y = champ.y + ((f.y - champ.y) / d) * R_RANGE; }
            const n = foes.filter((o) => Math.hypot(o.x - x, o.y - y) <= R_RADIUS + o.radius * 0.5).length;
            if (n > bestN) { bestN = n; best = { x, y, f }; }
          }
          if (!best) return false;
          const t = best.f;
          const ready = champ.passive.state.ready;
          const kill = t.hp + t.totalShield <= burst(champ, t);
          const allies = aiAllies(champ, ai, 1200).length;
          // 眩晕就绪：开团（多人或配合队友）；否则只在能击杀或多人时使用
          const go = (ready && (bestN >= 2 || allies >= 1 || t.hp / t.maxHp < 0.7 || kill)) || kill || bestN >= 3;
          if (!go) return false;
          if (ai?.isUnderEnemyTurret?.(t.x, t.y) && t.hp / t.maxHp > 0.3 && !kill) return false;
          return aiCastAt(champ, ai, 'R', best.x, best.y);
        },
      },
    },
  },

  ai: { skillOrder: ['Q', 'W', 'E'], style: 'mage', engageRange: 650, kiteDistance: 450, combo: ['R', 'W', 'Q', 'E'] },
};
