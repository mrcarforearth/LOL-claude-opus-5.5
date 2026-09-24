// 英雄：阿狸（九尾妖狐）—— 被动摄魂夺魄、Q 欺诈宝珠（去程魔法/回程真实）、W 妖异狐火、E 魅惑妖术、R 灵魄突袭（三段突进）
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { byLevel } from '../core/math.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本附近） ——
const P_STACKS = 9;                              // 每击杀 9 个小兵/野怪触发一次回复
const P_MINION_HEAL = [35, 95];                  // 1 级 → 18 级（+10% AP）
const P_MINION_AP = 0.10;
const P_CHAMP_HEAL = [75, 165];                  // 英雄参与击杀（+35% AP）
const P_CHAMP_AP = 0.35;

const Q_DMG = [40, 65, 90, 115, 140];            // 去程魔法 / 回程真实（+45% AP）
const Q_AP = 0.45;
const Q_COST = [55, 60, 65, 70, 75];
const Q_RANGE = 880;
const Q_WIDTH = 100;                             // 碰撞半径
const Q_SPEED = 1550;
const Q_RETURN_START = 60;                       // 回程从 60 加速到 2600
const Q_RETURN_ACCEL = 1900;
const Q_RETURN_MAX = 2600;

const W_DMG = [50, 75, 100, 125, 150];           // 每团狐火（+30% AP）
const W_AP = 0.30;
const W_REPEAT = 0.30;                           // 同一目标后续狐火 30% 伤害
const W_COUNT = 3;
const W_RANGE = 550;
const W_DURATION = 2.5;
const W_DELAY = 0.25;                            // 施放后多久开始追击
const W_STAGGER = 0.12;                          // 狐火之间的发射间隔
const W_SPEED = 1400;
const W_MS = 0.40;                               // 递减移速
const W_MS_DUR = 2.0;
const W_ORBIT_R = 110;
const W_ORBIT_SPEED = 5.5;                       // 弧度/秒（与特效一致）
const W_COST = [30, 30, 30, 30, 30];
const W_CD = [9, 8, 7, 6, 5];

const E_DMG = [80, 120, 160, 200, 240];          // （+85% AP）
const E_AP = 0.85;
const E_CHARM = [1.4, 1.6, 1.8, 2.0, 2.2];
const E_RANGE = 975;
const E_WIDTH = 60;
const E_SPEED = 1550;
const E_COST = [50, 50, 50, 50, 50];

const R_DMG = [60, 90, 120];                     // 每道灵魄飞弹（+35% AP）
const R_AP = 0.35;
const R_DASH = 450;
const R_BOLT_RANGE = 600;
const R_TARGETS = 3;
const R_WINDOW = 10;
const R_RECASTS = 2;                             // 首次施放后还可以再施放 2 次
const R_GAP = 1;                                 // 两次突进最小间隔
const R_MAX_STORED = 3;                          // 参与击杀额外获得的突进次数上限
const R_BOLT_SPEED = 1400;
const R_CD = [130, 105, 80];

const PINK = 0xff6ac1;
const BLUE = 0x8fb8ff;
const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('魂', '#f08ad0', '#4a1446'),
  Q: icon('珠', '#9ac4ff', '#2a2a7a'),
  W: icon('狐', '#8f9dff', '#3a1a6a'),
  E: icon('魅', '#ff8ac8', '#7a1446'),
  R: icon('灵', '#ffb8f0', '#5a1a8a'),
};

// —— 伤害计算 ——
const qDamage = (champ, rank) => rv(Q_DMG, rank) + Q_AP * (champ?.stats?.ap || 0);
const wDamage = (champ, rank) => rv(W_DMG, rank) + W_AP * (champ?.stats?.ap || 0);
const eDamage = (champ, rank) => rv(E_DMG, rank) + E_AP * (champ?.stats?.ap || 0);
const rDamage = (champ, rank) => rv(R_DMG, rank) + R_AP * (champ?.stats?.ap || 0);
const minionHeal = (champ) => byLevel(champ?.level || 1, P_MINION_HEAL[0], P_MINION_HEAL[1]) + P_MINION_AP * (champ?.stats?.ap || 0);
const champHeal = (champ) => byLevel(champ?.level || 1, P_CHAMP_HEAL[0], P_CHAMP_HEAL[1]) + P_CHAMP_AP * (champ?.stats?.ap || 0);
export const AHRI = { qDamage, wDamage, eDamage, rDamage, minionHeal, champHeal };

// 阵营可伤害单位
const hittable = (u) => u && u.alive && !u.removed && !u.untargetable && !u.isStructure && u.type !== 'ward';

// 同步被动层数 Buff（UI 图标）
function syncEssence(champ) {
  const st = champ.passive.state;
  const b = champ.getBuff('ahri_essence');
  if (b) b.stacks = st.stacks;
}

// 狐火目标：被阿狸魅惑的英雄 → 英雄 → 其他单位（均按距离）
function foxFireTarget(champ) {
  const game = champ.game;
  const list = game.queryUnits({ x: champ.x, y: champ.y, radius: W_RANGE, enemyOf: champ, targetableBy: champ }).filter(hittable);
  if (list.length === 0) return null;
  const charm = champ.abilities.E?.state?.charmed;
  if (charm && charm.until > game.time && list.includes(charm.unit)) return charm.unit;
  return list.find((u) => u.type === 'champion') || list[0];
}

// 灵魄飞弹目标：600 内最多 3 个，优先英雄
function spiritBoltTargets(champ) {
  const game = champ.game;
  const list = game.queryUnits({ x: champ.x, y: champ.y, radius: R_BOLT_RANGE, enemyOf: champ, targetableBy: champ }).filter(hittable);
  const champs = list.filter((u) => u.type === 'champion');
  const others = list.filter((u) => u.type !== 'champion');
  return [...champs, ...others].slice(0, R_TARGETS);
}

// R 单次突进 + 发射飞弹；返回是否成功
function spiritRush(champ, ctx) {
  const game = champ.game;
  if (!champ.canDash()) return false;
  let tx = ctx.x, ty = ctx.y;
  let d = Math.hypot(tx - champ.x, ty - champ.y);
  if (d < 1) { tx = champ.x + Math.cos(champ.facing) * R_DASH; ty = champ.y + Math.sin(champ.facing) * R_DASH; d = R_DASH; }
  if (d > R_DASH) { tx = champ.x + ((tx - champ.x) / d) * R_DASH; ty = champ.y + ((ty - champ.y) / d) * R_DASH; }
  const rank = ctx.rank;
  const fromX = champ.x, fromY = champ.y;
  const ok = champ.dash({
    x: tx, y: ty, speed: 1200 + champ.stats.moveSpeed, ignoreWalls: true,
    onEnd: (interrupted) => {
      if (!champ.alive || interrupted) return;
      const targets = spiritBoltTargets(champ);
      targets.forEach((t, i) => {
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, target: t, speed: R_BOLT_SPEED + i * 60, width: 0, height: 120,
          vfx: { kind: 'ahri_r_bolt', color: 0xb58aff, size: 1, trail: true, fallback: 'orb', index: i },
          onHit: (u) => {
            game.dealDamage(champ, u, rDamage(champ, rank), 'magic', { isAbility: true, spell: 'ahri_r' });
            game.fx.impact({ x: u.x, y: u.y, h: 100, color: 0xc9a2ff, size: 0.9 });
          },
        });
      });
    },
  });
  if (!ok) return false;
  game.fx.custom('ahri_r_dash', { unit: champ, x1: fromX, y1: fromY, x2: tx, y2: ty, duration: 0.6 });
  return true;
}

// —— AI 辅助（只使用 ARCHITECTURE §9 的控制器接口，全部可选链保护） ——
function aiOk(r) { return r === true || !!(r && r.ok); }
function aiCastAt(champ, ai, slot, x, y) {
  return aiOk(typeof ai?.castAt === 'function' ? ai.castAt(slot, x, y) : champ.castAbility(slot, { x, y }));
}
function aiCastSelf(champ, ai, slot) {
  return aiOk(typeof ai?.castSelf === 'function' ? ai.castSelf(slot) : champ.castAbility(slot, {}));
}
function aiEnemies(champ, ai, radius) {
  const list = ai?.visibleEnemies?.(radius);
  const src = Array.isArray(list) ? list
    : champ.game.queryUnits({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
  return src.filter((u) => u && u.alive && u.type === 'champion' && u.isTargetableBy(champ) && champ.distTo(u) <= radius);
}
function aiPredict(ai, unit, t) {
  const p = ai?.predict?.(unit, t);
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : predictPosition(unit, t);
}
// 首选目标：AI 当前集火目标（若在范围内），否则范围内生命比例最低者
function aiPickTarget(champ, ai, range) {
  const t = ai?.target;
  if (t && t.alive && t.type === 'champion' && t.team !== champ.team && t.isTargetableBy(champ) && champ.distTo(t) <= range) return t;
  const list = aiEnemies(champ, ai, range);
  if (list.length === 0) return null;
  return list.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a));
}
const isLocked = (u) => u.hasCC('charm') || u.hasCC('stun') || u.hasCC('root') || u.hasCC('airborne') || u.hasCC('suppress') || u.hasCC('taunt');
// 直线上挡在目标前的单位数
function blockers(champ, tx, ty, width, target) {
  return champ.game.queryLine({ x1: champ.x, y1: champ.y, x2: tx, y2: ty, width, enemyOf: champ, filter: (u) => u !== target && !u.untargetable }).length;
}
function manaPct(champ) { return champ.maxMana > 0 ? champ.mana / champ.maxMana : 1; }
function farmMode(ai) { return ['laning', 'pushing', 'jungling', 'objective'].includes(ai?.mode); }
// 直线（半宽 w、长 L）从英雄指向各候选时的最大命中数
function bestLine(champ, cands, L, w) {
  let best = null, bestN = 0;
  for (const c of cands) {
    const d = champ.distTo(c) || 1;
    const x2 = champ.x + ((c.x - champ.x) / d) * L, y2 = champ.y + ((c.y - champ.y) / d) * L;
    const n = champ.game.queryLine({ x1: champ.x, y1: champ.y, x2, y2, width: w, enemyOf: champ, filter: hittable }).length;
    if (n > bestN) { bestN = n; best = c; }
  }
  return { target: best, count: bestN };
}
const magicTo = (champ, target, raw) => (target ? mitigate(champ, target, raw, 'magic') : raw);

export default {
  id: 'ahri',
  name: '阿狸',
  title: '九尾妖狐',
  roles: ['mid'],
  tags: ['法师', '刺客'],
  difficulty: 2,
  lore: '与灵界魔法有着天生联系的瓦斯塔亚狐狸，通过吞噬他人的精魄来追寻自己遗失的记忆。',
  baseStats: {
    hp: 590, hpPerLevel: 104, hpRegen: 2.5, hpRegenPerLevel: 0.6,
    mana: 418, manaPerLevel: 25, manaRegen: 8, manaRegenPerLevel: 0.8, resource: 'mana',
    ad: 53, adPerLevel: 3, as: 0.668, asRatio: 0.625, asPerLevel: 2.2,
    armor: 21, armorPerLevel: 4.2, mr: 30, mrPerLevel: 1.3,
    ms: 330, range: 550, radius: 65, windup: 0.2005, critMult: 1.75,
    missileSpeed: 1750, attackVfx: { kind: 'orb', color: 0xc98aff, size: 0.75, trail: true },
  },
  model: { primary: 0xf3e9f7, secondary: 0x8a2a6a, accent: 0xff7ad8 },
  portrait: { bg: ['#c84a9a', '#2a0a22'], glyph: '狸' },

  // —— 被动：摄魂夺魄 ——
  passive: {
    id: 'ahri_passive',
    name: '摄魂夺魄',
    icon: ICONS.P,
    desc: (champ) => {
      const n = champ?.passive?.state?.stacks ?? 0;
      return `阿狸每击杀 ${P_STACKS} 个小兵或野怪，回复 ${fmt(minionHeal(champ))}（${fmt(byLevel(champ?.level || 1, P_MINION_HEAL[0], P_MINION_HEAL[1]))} +${pct(P_MINION_AP)} 法术强度）生命值（当前 ${n}/${P_STACKS}）。\n`
        + `参与击杀敌方英雄时，回复 ${fmt(champHeal(champ))}（${fmt(byLevel(champ?.level || 1, P_CHAMP_HEAL[0], P_CHAMP_HEAL[1]))} +${pct(P_CHAMP_AP)} 法术强度）生命值。`;
    },
    init(champ) {
      const st = champ.passive.state;
      st.stacks = 0;
      st.heals = 0;
      champ.addBuff({
        id: 'ahri_essence', name: '摄魂夺魄', desc: `击杀小兵或野怪积攒精魄，满 ${P_STACKS} 层时回复生命值`, icon: ICONS.P,
        duration: Infinity, persistOnDeath: true, stacks: 0, maxStacks: P_STACKS,
      });
      const game = champ.game;
      champ.addHook('onKill', (victim) => {
        if (!victim || (victim.type !== 'minion' && victim.type !== 'monster')) return;
        st.stacks++;
        if (st.stacks >= P_STACKS) {
          st.stacks = 0;
          st.heals++;
          game.heal(champ, champ, minionHeal(champ), { spell: 'ahri_passive' });
          game.fx.custom('ahri_passive_heal', { unit: champ, big: false });
        }
        syncEssence(champ);
      });
      champ.addHook('onTakedown', (victim) => {
        if (!victim || victim.type !== 'champion' || !champ.alive) return;
        st.heals++;
        game.heal(champ, champ, champHeal(champ), { spell: 'ahri_passive' });
        game.fx.custom('ahri_passive_heal', { unit: champ, big: true });
        // 灵魄突袭期间参与击杀：额外一次突进并刷新持续时间（最多储存 3 次）
        const r = champ.abilities.R;
        if (r && r.isRecastActive && r.state.onExpire) {
          r.state.remaining = Math.min(R_MAX_STORED, (r.state.remaining || 0) + 1);
          r.setRecast(R_WINDOW, { cooldownOnExpire: true, onExpire: r.state.onExpire });
        }
      });
    },
  },

  abilities: {
    // —— Q：欺诈宝珠 ——
    Q: {
      id: 'ahri_q',
      name: '欺诈宝珠',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `阿狸向前方掷出宝珠（${Q_RANGE} 码），再将其收回。宝珠去程对路径上的敌人造成 ${scaleText(champ, rv(Q_DMG, r), [[Q_AP, 'ap']])} 点魔法伤害，`
          + `回程造成等量的真实伤害。\n每个敌人去程与回程各只会受到一次伤害。宝珠回程时不断加速。`;
      },
      cooldown: [7, 7, 7, 7, 7],
      cost: Q_COST,
      range: Q_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: Q_WIDTH * 2, length: Q_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'magic',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY,
          range: Q_RANGE, speed: Q_SPEED, width: Q_WIDTH, hits: 'pierce', returnToOwner: true, height: 110,
          vfx: { kind: 'ahri_q_orb', color: BLUE, size: 1.2, trail: true, fallback: 'orb' },
          data: { rank, back: false },
          onUpdate: (p, dt) => {
            if (!p.returning) return;
            if (!p.data.back) { p.data.back = true; p.speed = Q_RETURN_START; }
            else p.speed = Math.min(Q_RETURN_MAX, p.speed + Q_RETURN_ACCEL * dt);
          },
          onHit: (u, p) => {
            const back = p.returning;
            game.dealDamage(champ, u, qDamage(champ, rank), back ? 'true' : 'magic', { isAbility: true, isAoE: true, spell: back ? 'ahri_q_return' : 'ahri_q' });
            game.fx.impact({ x: u.x, y: u.y, h: 100, color: back ? 0xffffff : BLUE, size: 0.8 });
            return false;
          },
        });
      },
      ai: {
        kind: 'nuke', range: Q_RANGE, width: Q_WIDTH, speed: Q_SPEED, delay: 0.25, farm: true,
        damage: (champ, target, rank) => magicTo(champ, target, qDamage(champ, rank)) + qDamage(champ, rank) * 0.6,
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const t = aiPickTarget(champ, ai, Q_RANGE + 150);
          if (t) {
            const d = champ.distTo(t);
            const p = isLocked(t) ? { x: t.x, y: t.y } : aiPredict(ai, t, 0.25 + d / Q_SPEED);
            if (Math.hypot(p.x - champ.x, p.y - champ.y) > Q_RANGE + t.radius) return false;
            return aiCastAt(champ, ai, 'Q', p.x, p.y);
          }
          // 清线/清野：一条直线至少穿过 3 个小兵或任意野怪
          if (!farmMode(ai) || manaPct(champ) < 0.45) return false;
          const cands = game.queryUnits({ x: champ.x, y: champ.y, radius: Q_RANGE, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'] });
          if (cands.length === 0) return false;
          const { target, count } = bestLine(champ, cands, Q_RANGE, Q_WIDTH);
          const needed = cands.some((u) => u.type === 'monster') ? 1 : 3;
          if (!target || count < needed) return false;
          return aiCastAt(champ, ai, 'Q', target.x, target.y);
        },
      },
    },

    // —— W：妖异狐火 ——
    W: {
      id: 'ahri_w',
      name: '妖异狐火',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `阿狸召唤 ${W_COUNT} 团狐火环绕自身，并获得 ${pct(W_MS)} 移动速度（在 ${W_MS_DUR} 秒内递减）。\n`
          + `短暂延迟后，狐火会追击 ${W_RANGE} 码内的敌人（优先被魅惑的英雄，其次是英雄），每团造成 ${scaleText(champ, rv(W_DMG, r), [[W_AP, 'ap']])} 点魔法伤害；`
          + `同一目标受到的后续狐火伤害降低为 ${pct(W_REPEAT)}。狐火持续 ${W_DURATION} 秒。`;
      },
      cooldown: W_CD,
      cost: W_COST,
      range: W_RANGE,
      targeting: 'self',
      indicator: { type: 'self', radius: W_RANGE },
      castTime: 0,
      lockMovement: false,
      sfx: 'fire',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const start = game.time;
        const buff = champ.addBuff({
          id: 'ahri_w', name: '妖异狐火', desc: '狐火环绕并追击附近敌人；移动速度提升（递减）', icon: ICONS.W, source: champ,
          duration: W_DURATION, refresh: 'replace',
          statsFn: (u, b) => {
            const s = b.data.s || (b.data.s = { moveSpeedPct: 0 });
            s.moveSpeedPct = W_MS * Math.max(0, 1 - b.elapsed / W_MS_DUR);
            return s;
          },
          data: { left: W_COUNT, nextAt: start + W_DELAY, rank, start, hitCounts: new Map(), fired: 0 },
          onApply: (u) => { u.modelState.foxFire = W_COUNT; },
          onTick: (u, b) => {
            const d = b.data;
            while (d.left > 0 && game.time >= d.nextAt - 1e-9 && u.alive) {
              const t = foxFireTarget(u);
              if (!t) break;
              const i = d.fired++;
              d.left--;
              d.nextAt = game.time + W_STAGGER;
              u.modelState.foxFire = d.left;
              // 从环绕位置发射
              const a = (game.time - d.start) * W_ORBIT_SPEED + (i * Math.PI * 2) / W_COUNT;
              const sx = u.x + Math.cos(a) * W_ORBIT_R, sy = u.y + Math.sin(a) * W_ORBIT_R;
              game.spawnProjectile({
                owner: u, x: sx, y: sy, target: t, speed: W_SPEED, width: 0, height: 110,
                vfx: { kind: 'ahri_w_fire', color: 0x7f8bff, size: 1, trail: true, fallback: 'orb' },
                onHit: (tt) => {
                  const n = d.hitCounts.get(tt) || 0;
                  d.hitCounts.set(tt, n + 1);
                  const dmg = wDamage(u, d.rank) * (n === 0 ? 1 : W_REPEAT);
                  game.dealDamage(u, tt, dmg, 'magic', { isAbility: true, spell: 'ahri_w' });
                  game.fx.impact({ x: tt.x, y: tt.y, h: 100, color: 0x8f7bff, size: 0.7 });
                },
              });
            }
          },
          onRemove: (u) => { u.modelState.foxFire = 0; },
        });
        game.fx.custom('ahri_w_orbit', { unit: champ, buff, count: W_COUNT, radius: W_ORBIT_R, orbitSpeed: W_ORBIT_SPEED, start, duration: W_DURATION });
        game.fx.attach({ unit: champ, kind: 'haste', color: 0x9f8bff, duration: W_MS_DUR });
      },
      ai: {
        kind: 'aoe', range: W_RANGE, radius: W_RANGE, farm: true,
        damage: (champ, target, rank) => magicTo(champ, target, wDamage(champ, rank) * (1 + 2 * W_REPEAT)),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          // 有敌方英雄进入狐火范围（或刚被魅惑）时立即施放
          const foes = aiEnemies(champ, ai, W_RANGE - 30);
          if (foes.length > 0) return aiCastSelf(champ, ai, 'W');
          // 撤退时用来加速
          if (ai?.mode === 'retreating' && aiEnemies(champ, ai, 900).length > 0) return aiCastSelf(champ, ai, 'W');
          if (!farmMode(ai) || manaPct(champ) < 0.5) return false;
          const monsters = game.queryUnits({ x: champ.x, y: champ.y, radius: W_RANGE - 50, enemyOf: champ, targetableBy: champ, types: ['monster'] });
          if (monsters.length > 0 && ai?.mode === 'jungling') return aiCastSelf(champ, ai, 'W');
          return false;
        },
      },
    },

    // —— E：魅惑妖术 ——
    E: {
      id: 'ahri_e',
      name: '魅惑妖术',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `阿狸献出一个飞吻（${E_RANGE} 码），对命中的第一个敌人造成 ${scaleText(champ, rv(E_DMG, r), [[E_AP, 'ap']])} 点魔法伤害，`
          + `并将其魅惑 ${fmt(rv(E_CHARM, r), 2)} 秒：被魅惑的敌人会无害地走向阿狸，且无法行动。`;
      },
      cooldown: [12, 12, 12, 12, 12],
      cost: E_COST,
      range: E_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: E_WIDTH * 2, length: E_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'magic',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const ab = ctx.ability;
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY,
          range: E_RANGE, speed: E_SPEED, width: E_WIDTH, hits: 'first', height: 100,
          vfx: { kind: 'ahri_e_heart', color: PINK, size: 1, trail: true, fallback: 'orb' },
          onHit: (u) => {
            game.dealDamage(champ, u, eDamage(champ, rank), 'magic', { isAbility: true, spell: 'ahri_e' });
            if (!u.alive) return true;
            const dur = rv(E_CHARM, rank);
            if (u.applyCC('charm', dur, { source: champ, x: champ.x, y: champ.y })) {
              const real = u.ccRemaining('charm');
              ab.state.charmed = { unit: u, until: game.time + real + 1 };
              game.fx.custom('ahri_charm', { unit: u, duration: real });
            }
            game.fx.impact({ x: u.x, y: u.y, h: 100, color: PINK, size: 1 });
            return true;
          },
        });
      },
      ai: {
        kind: 'cc', range: E_RANGE, width: E_WIDTH, speed: E_SPEED, delay: 0.25, collision: true,
        damage: (champ, target, rank) => magicTo(champ, target, eDamage(champ, rank)),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const t = aiPickTarget(champ, ai, E_RANGE + 100);
          if (!t) return false;
          const d = champ.distTo(t);
          const p = isLocked(t) ? { x: t.x, y: t.y } : aiPredict(ai, t, 0.25 + d / E_SPEED);
          const pd = Math.hypot(p.x - champ.x, p.y - champ.y);
          if (pd > E_RANGE + t.radius * 0.5) return false;
          if (blockers(champ, p.x, p.y, E_WIDTH, t) > 0) return false; // 被小兵挡住
          return aiCastAt(champ, ai, 'E', p.x, p.y);
        },
      },
    },

    // —— R：灵魄突袭 ——
    R: {
      id: 'ahri_r',
      name: '灵魄突袭',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `阿狸向指定方向突进（${R_DASH} 码，可越过地形），然后向附近 ${R_BOLT_RANGE} 码内最多 ${R_TARGETS} 个敌人（优先英雄）发射灵魄飞弹，`
          + `每道造成 ${scaleText(champ, rv(R_DMG, r), [[R_AP, 'ap']])} 点魔法伤害。\n`
          + `${R_WINDOW} 秒内可以再施放 ${R_RECASTS} 次（每次间隔至少 ${R_GAP} 秒）。期间参与击杀敌方英雄会额外获得一次突进并刷新持续时间（最多储存 ${R_MAX_STORED} 次）。冷却在突进用尽或持续时间结束后开始。`;
      },
      cooldown: R_CD,
      cost: [100, 100, 100],
      range: R_DASH,
      targeting: 'point',
      indicator: { type: 'circle', radius: R_BOLT_RANGE },
      castTime: 0,
      lockMovement: false,
      manualCooldown: true,
      sfx: 'dash',
      cast(champ, ctx) {
        const ab = ctx.ability;
        if (!spiritRush(champ, ctx)) return false;
        const st = ab.state;
        st.remaining = R_RECASTS;
        st.lastDashAt = champ.game.time;
        st.onExpire = (c) => { c.modelState.spiritRush = false; st.remaining = 0; };
        champ.modelState.spiritRush = true;
        ab.setRecast(R_WINDOW, { cooldownOnExpire: true, onExpire: st.onExpire });
      },
      recast(champ, ctx) {
        const ab = ctx.ability;
        const st = ab.state;
        if (champ.game.time - (st.lastDashAt ?? -99) < R_GAP - 1e-6) return false;
        if (!spiritRush(champ, ctx)) return false;
        st.lastDashAt = champ.game.time;
        st.remaining = (st.remaining || 0) - 1;
        if (st.remaining <= 0) {
          champ.modelState.spiritRush = false;
          ab.endRecast(true);
        }
        return true;
      },
      ai: {
        kind: 'gapclose', range: R_DASH + R_BOLT_RANGE, radius: R_BOLT_RANGE,
        damage: (champ, target, rank) => magicTo(champ, target, rDamage(champ, rank) * 3),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const st = ability.state;
          const recast = ability.isRecastActive;
          if (recast && game.time - (st.lastDashAt ?? -99) < R_GAP) return false;
          const hp = champ.hp / champ.maxHp;
          const near = aiEnemies(champ, ai, 900);
          const f = game.fountainOf(champ.team);
          // 躲避：残血且敌人逼近 → 朝泉水方向突进
          if ((hp < 0.3 || ai?.mode === 'retreating') && near.some((e) => champ.distTo(e) < 650)) {
            const a = Math.atan2(f.y - champ.y, f.x - champ.x);
            return aiCastAt(champ, ai, 'R', champ.x + Math.cos(a) * R_DASH, champ.y + Math.sin(a) * R_DASH);
          }
          const t = aiPickTarget(champ, ai, R_DASH + R_BOLT_RANGE);
          if (!t) {
            // 突进快结束时把剩余次数用来拉开距离
            return false;
          }
          const underTurret = ai?.isUnderEnemyTurret?.(t.x, t.y) ?? false;
          if (underTurret && t.hp / t.maxHp > 0.25) return false;
          const d = champ.distTo(t);
          const tHp = t.hp / t.maxHp;
          if (!recast) {
            // 追击：目标残血、被控或我方占优时开 R
            const allies = (ai?.nearbyAllies?.(1200) || []).length;
            const kill = t.hp + t.totalShield <= magicTo(champ, t, rDamage(champ, ability.rank) * 3 + qDamage(champ, champ.abilities.Q.rank) * 1.5);
            if (!(kill || tHp < 0.45 || isLocked(t) || (allies >= 2 && tHp < 0.7))) return false;
            if (hp < 0.25 && !kill) return false;
          }
          // 突进到目标附近（保持约 350 码的输出距离）
          let x, y;
          if (d > 350) {
            const k = Math.min(R_DASH, d - 300) / d;
            x = champ.x + (t.x - champ.x) * k; y = champ.y + (t.y - champ.y) * k;
          } else {
            // 已经很近：侧向拉扯，避免贴脸
            const a = Math.atan2(champ.y - t.y, champ.x - t.x) + 0.9;
            x = t.x + Math.cos(a) * 420; y = t.y + Math.sin(a) * 420;
          }
          if (recast && ability.recastRemaining > 2 && d < R_BOLT_RANGE && tHp > 0.35 && !isLocked(t)) {
            // 还有时间：等待更好的时机，但目标要跑出飞弹范围时就追
            if (d < R_BOLT_RANGE - 150) return false;
          }
          return aiCastAt(champ, ai, 'R', x, y);
        },
      },
    },
  },

  ai: { skillOrder: ['Q', 'W', 'E'], style: 'mage', engageRange: 750, kiteDistance: 500, combo: ['E', 'Q', 'W', 'R'] },
};
