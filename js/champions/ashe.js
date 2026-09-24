// 英雄：艾希（寒冰射手）—— 冰霜射击、射手的专注、万箭齐发、鹰击长空、魔法水晶箭
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { byLevel, clamp } from '../core/math.js';
import { mitigate } from '../core/damage.js';
import { MAP_SIZE } from '../config.js';

// —— 数值表（LoL 当前版本附近） ——
const FROST_SLOW_L1 = 0.20;                        // 冰霜减速：1 级 20% → 18 级 30%
const FROST_SLOW_L18 = 0.30;
const FROST_DUR = 2;
const FROST_BONUS = 0.10;                          // 对被减速目标的额外普攻伤害
const FROST_CRIT_RATIO = 0.75;                     // 每 100% 暴击几率额外 +75%
const Q_MAX_STACKS = 4;
const Q_STACK_DUR = 4;
const Q_DUR = 4;
const Q_AS = [0.25, 0.30, 0.35, 0.40, 0.45];       // Q 攻速加成
const Q_ARROW_AD = [0.21, 0.22, 0.23, 0.24, 0.25]; // 齐射每支箭 AD 比例（×5 = 105%~125%）
const Q_ARROWS = 5;
const W_BASE = [20, 35, 50, 65, 80];
const W_AD = 1.0;
const W_ARROWS = 9;
const W_ANGLE = 57.5;
const W_RANGE = 1200;
const W_SPEED = 2000;
const W_WIDTH = 20;
const E_SPEED = 1400;
const E_REVEAL_R = 1000;
const E_REVEAL_DUR = 5;
const E_FLIGHT_SIGHT = 500;
const E_RECHARGE = [90, 80, 70, 60, 50];
const R_BASE = [200, 400, 600];
const R_AP = 1.0;
const R_WIDTH = 130;
const R_SPEED = 1600;
const R_SPLASH = 250;
const R_SPLASH_PCT = 0.5;
const R_STUN_MIN = 1;
const R_STUN_MAX = 3.5;
const R_STUN_FULL = 1500;                          // 飞行 1500 码时眩晕达到最大值

const FROST_COLOR = 0x9ae8ff;
const UNIT_TYPES = new Set(['champion', 'minion', 'monster', 'pet']);
const ARROW_VFX = { kind: 'ashe_arrow', fallback: 'arrow', color: 0xc8f2ff, size: 1, trail: true };
const VOLLEY_VFX = { kind: 'ashe_volley', fallback: 'arrow', color: 0xa8ecff, size: 1.15, trail: true, arrows: Q_ARROWS };
const W_VFX = { kind: 'ashe_w_arrow', fallback: 'arrow', color: 0xbff0ff, size: 0.9, trail: true };
const E_VFX = { kind: 'ashe_hawk', fallback: 'orb', color: 0x8fe4ff, size: 1.4, trail: true };
const R_VFX = { kind: 'ashe_r_arrow', fallback: 'ice', color: 0x9ae8ff, size: 2.4, trail: true };

const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('霜', '#bfefff', '#2a5a8a'),
  Q: icon('专', '#9fd8ff', '#1d3f7a'),
  W: icon('齐', '#c8f4ff', '#2f6aa8'),
  E: icon('鹰', '#a8e6ff', '#264a78'),
  R: icon('晶', '#e0fbff', '#3a7ac8'),
};

// —— 公式 ——
export function asheFrostSlow(level) { return byLevel(level, FROST_SLOW_L1, FROST_SLOW_L18); }
// 对被减速目标的普攻伤害倍率（暴击几率转化为额外伤害，受暴击伤害加成影响）
export function asheFrostMult(champ) {
  const crit = champ.stats.crit || 0;
  const critScale = (champ.stats.critMult || 1.75) / 1.75;
  return 1 + FROST_BONUS + crit * FROST_CRIT_RATIO * critScale;
}
export function asheWDamage(champ, rank) { return rv(W_BASE, rank) + W_AD * champ.stats.ad; }
export function asheRDamage(champ, rank) { return rv(R_BASE, rank) + R_AP * champ.stats.ap; }
export function asheRStun(traveled) { return R_STUN_MIN + (R_STUN_MAX - R_STUN_MIN) * clamp(traveled / R_STUN_FULL, 0, 1); }
// 沿方向飞到地图边缘的距离
export function edgeDistance(x, y, dx, dy) {
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (MAP_SIZE - x) / dx); else if (dx < -1e-6) t = Math.min(t, -x / dx);
  if (dy > 1e-6) t = Math.min(t, (MAP_SIZE - y) / dy); else if (dy < -1e-6) t = Math.min(t, -y / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

// 可被艾希技能命中的敌方单位
function enemyUnit(champ, u) {
  return !!u && u.alive && !u.removed && !u.untargetable && !u.invulnerable && UNIT_TYPES.has(u.type) && u.team !== champ.team;
}
function canFrost(u) { return !!u && u.alive && !u.isStructure && u.type !== 'ward'; }

// 施加冰霜（减速 + 减益图标 + 节流的冰霜特效）
export function applyFrost(champ, u) {
  if (!canFrost(u) || u.team === champ.team) return;
  const game = champ.game;
  u.slow(asheFrostSlow(champ.level), FROST_DUR, champ);
  u.addBuff({
    id: 'ashe_frost', name: '冰霜射击', desc: '被寒冰之力减速', icon: ICONS.P, source: champ,
    duration: FROST_DUR, isDebuff: true, cleansable: true,
  });
  const st = champ.passive.state;
  if (!st.fxAt) st.fxAt = new WeakMap();
  const last = st.fxAt.get(u) ?? -99;
  if (game.time - last > 1.6) {
    st.fxAt.set(u, game.time);
    game.fx.attach({ unit: u, kind: 'frost', color: FROST_COLOR, duration: FROST_DUR });
  }
}

// —— AI 辅助（ai 接口全部可选链保护，缺失时退回直接施放） ——
function visibleEnemyChamps(champ, ai, radius) {
  let list = null;
  try { list = typeof ai?.visibleEnemies === 'function' ? ai.visibleEnemies(radius) : null; } catch { list = null; }
  if (Array.isArray(list)) return list.filter((e) => e && e.alive && e.type === 'champion' && champ.distTo(e) <= radius);
  return champ.game.queryUnits({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
}
function predictAt(ai, u, t) {
  try {
    const p = typeof ai?.predict === 'function' ? ai.predict(u, t) : null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch { /* 回退 */ }
  return predictPosition(u, t);
}
function castOk(r) { return r === true || !!(r && r.ok); }
function aiCastPoint(ai, champ, slot, x, y) {
  // 旧版桩 AI 的 castAt 签名不同（5 个参数），此时直接施放
  if (typeof ai?.castAt === 'function' && ai.castAt.length !== 5) return castOk(ai.castAt(slot, x, y));
  return castOk(champ.castAbility(slot, { x, y }));
}
function aiCastSelf(ai, champ, slot) {
  if (typeof ai?.castSelf === 'function') return castOk(ai.castSelf(slot));
  return castOk(champ.castAbility(slot, {}));
}
function canPay(champ, ab) { return ab.costType === 'none' || !(ab.cost > 0) || champ.mana >= ab.cost; }
function hardCCd(u) { return !!(u.hasCC?.('stun') || u.hasCC?.('root') || u.hasCC?.('airborne') || u.hasCC?.('suppress') || u.hasCC?.('sleep')); }

// Q：满层时在交战或攻击建筑/史诗野怪时开启
function qAI(champ, ab, ai, game) {
  if (!ab.ready || ab.rank <= 0 || champ.castLock > 0 || !canPay(champ, ab)) return false;
  if (champ.buffStacks('ashe_q_focus') < Q_MAX_STACKS || champ.hasBuff('ashe_q_active')) return false;
  const reach = champ.stats.attackRange + champ.radius + 150;
  const foe = visibleEnemyChamps(champ, ai, reach + 65)[0];
  const at = champ.attackTarget || ai?.target || null;
  const bigTarget = at && at.alive && (at.isStructure || at.epic || (at.type === 'monster' && at.large !== false)) && champ.distTo(at) <= reach + (at.radius || 0);
  if (!foe && !bigTarget) return false;
  return aiCastSelf(ai, champ, 'Q');
}

// W：消耗敌方英雄；蓝量充足时补射程外的刀或清线
function wAI(champ, ab, ai, game) {
  if (!ab.ready || ab.rank <= 0 || champ.castLock > 0 || !canPay(champ, ab)) return false;
  let target = ai?.target && ai.target.alive && ai.target.type === 'champion' && ai.target.team !== champ.team ? ai.target : null;
  if (!target || champ.distTo(target) > W_RANGE - 60) target = visibleEnemyChamps(champ, ai, W_RANGE - 60)[0] || null;
  if (target) {
    const d = champ.distTo(target);
    const p = predictAt(ai, target, 0.25 + d / W_SPEED);
    return aiCastPoint(ai, champ, 'W', p.x, p.y);
  }
  const manaPct = champ.maxMana > 0 ? champ.mana / champ.maxMana : 0;
  if (manaPct < 0.55) return false;
  const minions = game.queryUnits({ x: champ.x, y: champ.y, radius: 1000, enemyOf: champ, targetableBy: champ, types: ['minion'] });
  if (minions.length === 0) return false;
  const dmg = asheWDamage(champ, ab.rank);
  const reach = champ.stats.attackRange + champ.radius + 120;
  const lastHit = minions.find((m) => champ.distTo(m) > reach && mitigate(champ, m, dmg, 'physical') >= m.hp);
  if (lastHit) return aiCastPoint(ai, champ, 'W', lastHit.x, lastHit.y);
  if (minions.length >= 4 && manaPct > 0.75) {
    let cx = 0, cy = 0;
    for (const m of minions) { cx += m.x; cy += m.y; }
    return aiCastPoint(ai, champ, 'W', cx / minions.length, cy / minions.length);
  }
  return false;
}

// E：满充能且附近安全时侦查小龙/大龙坑或附近不可见的草丛
function eAI(champ, ab, ai, game) {
  if (!ab.ready || ab.rank <= 0 || champ.castLock > 0) return false;
  const st = ab.state;
  if (game.time < (st.nextScout ?? 0)) return false;
  if ((ab.charges ?? 0) < (ab.maxCharges || 1)) return false; // 保留一层备用
  if (visibleEnemyChamps(champ, ai, 1500).length > 0) return false;
  const team = champ.team;
  const seen = (x, y) => (typeof game.vision?.isVisible === 'function' ? game.vision.isVisible(team, x, y) : true);
  const cands = [];
  const pits = game.map?.PITS;
  const t = game.time;
  if (pits?.dragon && t > 240) cands.push({ x: pits.dragon.x, y: pits.dragon.y, w: t > 280 ? 2.2 : 1.2 });
  if (pits?.baron && t > 1140) cands.push({ x: pits.baron.x, y: pits.baron.y, w: 2 });
  for (const b of game.map?.BRUSHES || []) {
    if (!b.poly || !b.poly.length || (b.kind !== 'river' && b.kind !== 'tri' && b.kind !== 'lane')) continue;
    let bx = 0, by = 0;
    for (const p of b.poly) { bx += p[0]; by += p[1]; }
    bx /= b.poly.length; by /= b.poly.length;
    const d = Math.hypot(bx - champ.x, by - champ.y);
    if (d < 900 || d > 2600) continue;
    cands.push({ x: bx, y: by, w: 1 });
  }
  let best = null, bestScore = 0;
  for (const c of cands) {
    if (seen(c.x, c.y)) continue;
    const d = Math.hypot(c.x - champ.x, c.y - champ.y);
    const s = c.w / (1 + d / 4000);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  st.nextScout = game.time + 25 + game.rng() * 20;
  if (!best) return false;
  return aiCastPoint(ai, champ, 'E', best.x, best.y);
}

// R：远程斩杀、支援队友开团、近身自保、命中被控目标
function rAI(champ, ab, ai, game) {
  if (!ab.ready || ab.rank <= 0 || champ.castLock > 0 || !canPay(champ, ab)) return false;
  const enemies = visibleEnemyChamps(champ, ai, 3200);
  if (enemies.length === 0) return false;
  const myHp = champ.hp / champ.maxHp;
  const allies = game.champions.filter((c) => c.alive && c.team === champ.team && c !== champ);
  let best = null, bestScore = 0;
  for (const e of enemies) {
    if (!e.alive || e.untargetable) continue;
    const d = champ.distTo(e);
    const locked = hardCCd(e);
    if (d > (locked ? 3200 : 2300)) continue;
    const dmg = mitigate(champ, e, asheRDamage(champ, ab.rank), 'magic');
    const ehp = e.hp + (e.totalShield || 0);
    const alliesNear = allies.filter((a) => a.distTo(e) < 900).length;
    const foesNear = enemies.filter((o) => o.distTo(e) < 900).length;
    let score = 0;
    if (dmg >= ehp && d > 500) score += 3;
    if (alliesNear >= 1 && alliesNear + 1 >= foesNear && e.hp / e.maxHp > 0.12) score += 1.4 + alliesNear * 0.4;
    if (d < 550 && myHp < 0.45) score += 2.2;
    if (locked) score += 0.8;
    const clump = game.queryUnits({ x: e.x, y: e.y, radius: R_SPLASH, enemyOf: champ, types: ['champion'] }).length;
    score += Math.max(0, clump - 1) * 0.6;
    if (d > 1600 && !locked) score -= 0.8; // 远距离不确定性
    if (score > bestScore) { bestScore = score; best = { e, d }; }
  }
  if (!best || bestScore < 2) return false;
  const p = hardCCd(best.e) ? { x: best.e.x, y: best.e.y } : predictAt(ai, best.e, 0.25 + best.d / R_SPEED);
  return aiCastPoint(ai, champ, 'R', p.x, p.y);
}

export default {
  id: 'ashe',
  name: '艾希',
  title: '寒冰射手',
  roles: ['adc'],
  tags: ['射手', '辅助'],
  difficulty: 1,
  lore: '阿瓦罗萨部族的战母，手持寒冰长弓，以冰霜之箭统领弗雷尔卓德的子民走向统一。',
  baseStats: {
    hp: 610, hpPerLevel: 101, hpRegen: 3.5, hpRegenPerLevel: 0.55,
    mana: 280, manaPerLevel: 35, manaRegen: 7, manaRegenPerLevel: 0.65, resource: 'mana',
    ad: 59, adPerLevel: 2.95, as: 0.658, asRatio: 0.658, asPerLevel: 3.33,
    armor: 26, armorPerLevel: 4.6, mr: 30, mrPerLevel: 1.3,
    ms: 325, range: 600, radius: 65, windup: 0.22, missileSpeed: 2000, critMult: 1.75,
    attackVfx: ARROW_VFX,
  },
  model: { primary: 0x2c4f8f, secondary: 0xe8f0ff, accent: 0x9ae8ff },
  portrait: { bg: ['#6ab4ea', '#0b1c33'], glyph: '艾' },

  // —— 被动：冰霜射击 ——
  passive: {
    id: 'ashe_passive',
    name: '冰霜射击',
    icon: ICONS.P,
    desc: (champ) => {
      const lvl = champ?.level || 1;
      const mult = champ ? asheFrostMult(champ) - 1 : FROST_BONUS;
      return `艾希的普攻和伤害型技能会对敌人施加冰霜，使其移动速度降低 ${pct(asheFrostSlow(lvl))}（随等级提升，20%~30%），持续 ${FROST_DUR} 秒。\n`
        + `艾希的普攻不会暴击，改为对被减速的目标额外造成 ${pct(FROST_BONUS)} +（暴击几率 × ${pct(FROST_CRIT_RATIO)}）的伤害（当前 +${pct(mult)}）。`;
    },
    init(champ) {
      const st = champ.passive.state;
      st.fxAt = new WeakMap();
      // 普攻不会暴击（暴击几率转化为冰霜额外伤害）
      champ.addHook('onAttackLaunch', (target, hit) => { hit.isCrit = false; });
      champ.addHook('onHit', (target, hit) => {
        if (!canFrost(target) || target.team === champ.team) return;
        applyFrost(champ, target); // 先施加冰霜再结算：第一次普攻也享受加成
        hit.damage *= asheFrostMult(champ);
        hit.asheFrost = true;
      });
    },
  },

  abilities: {
    // —— Q：射手的专注 ——
    Q: {
      id: 'ashe_q',
      name: '射手的专注',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const stacks = champ?.buffStacks?.('ashe_q_focus') || 0;
        const ratio = Q_ARROWS * rv(Q_ARROW_AD, r);
        const total = champ ? ratio * champ.stats.ad : 0;
        return `被动：艾希的普攻会提供 1 层「专注」，持续 ${Q_STACK_DUR} 秒，最多叠加 ${Q_MAX_STACKS} 层（当前 ${stacks} 层）。\n`
          + `主动：需要 ${Q_MAX_STACKS} 层专注。消耗所有层数，在 ${Q_DUR} 秒内获得 ${pct(rv(Q_AS, r))} 攻击速度，`
          + `并且普攻变为一轮 ${Q_ARROWS} 支箭的齐射，每支造成 ${pct(rv(Q_ARROW_AD, r))} 攻击力的物理伤害（共 ${champ ? fmt(total) : ''}${champ ? '，' : ''}${pct(ratio)} 攻击力）。\n施放时重置普攻计时。`;
      },
      cooldown: [0, 0, 0, 0, 0],
      cost: [30, 30, 30, 30, 30],
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: 600 },
      castTime: 0,
      lockMovement: false,
      sfx: 'buff',
      // 扩展：满层时才可用（UI 可据此置灰）
      usable: (champ) => champ.buffStacks('ashe_q_focus') >= Q_MAX_STACKS && !champ.hasBuff('ashe_q_active'),
      onLearn(champ) {
        // 普攻叠加专注（齐射期间不叠加）
        champ.addHook('onAttackLaunch', () => {
          if (champ.hasBuff('ashe_q_active')) return;
          champ.addBuff({
            id: 'ashe_q_focus', name: '专注', desc: `叠满 ${Q_MAX_STACKS} 层后可施放射手的专注`, icon: ICONS.Q, source: champ,
            duration: Q_STACK_DUR, stacks: 1, maxStacks: Q_MAX_STACKS, refresh: 'stack',
          });
        });
        // 齐射：5 支箭的总伤害
        champ.addHook('onHit', (target, hit) => {
          const b = champ.getBuff('ashe_q_active');
          if (!b) return;
          hit.damage *= Q_ARROWS * rv(Q_ARROW_AD, b.data.rank);
          hit.asheVolley = true;
        });
        champ.addHook('afterHit', (target, hit) => {
          if (!hit.asheVolley) return;
          champ.game.fx.impact({ x: target.x, y: target.y, h: 90, color: FROST_COLOR, size: 1.1 });
        });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const f = champ.getBuff('ashe_q_focus');
        if (!f || f.stacks < Q_MAX_STACKS || champ.hasBuff('ashe_q_active')) return false;
        champ.removeBuff(f);
        champ.addBuff({
          id: 'ashe_q_active', name: '射手的专注', desc: `攻击速度提升 ${pct(rv(Q_AS, ctx.rank))}，普攻变为齐射`, icon: ICONS.Q, source: champ,
          duration: Q_DUR, refresh: 'replace', stats: { attackSpeed: rv(Q_AS, ctx.rank) }, data: { rank: ctx.rank },
          onApply: (u) => { u.modelState.focus = true; u.baseStats.attackVfx = VOLLEY_VFX; },
          onRemove: (u) => { u.modelState.focus = false; u.baseStats.attackVfx = ARROW_VFX; },
        });
        champ.resetAttack();
        game.fx.custom('ashe_q_focus', { unit: champ, duration: Q_DUR });
        game.fx.attach({ unit: champ, kind: 'weaponGlow', color: FROST_COLOR, duration: Q_DUR });
      },
      ai: { kind: 'selfbuff', range: 650, custom: qAI },
    },

    // —— W：万箭齐发 ——
    W: {
      id: 'ashe_w',
      name: '万箭齐发',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `艾希朝指定方向以 ${W_ANGLE}° 扇形射出 ${W_ARROWS} 支箭，每支箭对命中的第一个敌人造成 ${scaleText(champ, rv(W_BASE, r), [[W_AD, 'ad']])} 点物理伤害，并施加冰霜。\n`
          + `每个敌人只会受到一支箭的伤害。射程 ${W_RANGE}。`;
      },
      cooldown: [18, 14.5, 11, 7.5, 4],
      cost: [75, 70, 65, 60, 55],
      range: W_RANGE,
      targeting: 'direction',
      indicator: { type: 'cone', angle: W_ANGLE, length: W_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'shot',
      cast(champ, ctx) {
        const game = champ.game;
        const base = Math.atan2(ctx.dirY, ctx.dirX);
        const step = (W_ANGLE * Math.PI / 180) / (W_ARROWS - 1);
        const hitSet = new Set();
        const dmg = asheWDamage(champ, ctx.rank);
        for (let i = 0; i < W_ARROWS; i++) {
          const a = base + (i - (W_ARROWS - 1) / 2) * step;
          game.spawnProjectile({
            owner: champ, x: champ.x, y: champ.y, dirX: Math.cos(a), dirY: Math.sin(a),
            range: W_RANGE, speed: W_SPEED, width: W_WIDTH, hits: 'first', height: 105,
            canHit: (u) => enemyUnit(champ, u),
            // 已被本轮命中的敌人：箭矢被阻挡但不再造成伤害
            onHit: (u) => {
              if (hitSet.has(u)) return true;
              hitSet.add(u);
              game.dealDamage(champ, u, dmg, 'physical', { isAbility: true, isAoE: true, spell: 'ashe_w' });
              applyFrost(champ, u);
              game.fx.impact({ x: u.x, y: u.y, h: 90, color: FROST_COLOR, size: 0.8 });
              return true;
            },
            vfx: W_VFX, data: { index: i },
          });
        }
        game.fx.custom('ashe_w_cast', { unit: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, angle: W_ANGLE });
      },
      ai: {
        kind: 'nuke', range: W_RANGE - 60, width: W_WIDTH, speed: W_SPEED, delay: 0.25, farm: true,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, asheWDamage(champ, rank), 'physical') : asheWDamage(champ, rank)),
        custom: wAI,
      },
    },

    // —— E：鹰击长空 ——
    E: {
      id: 'ashe_e',
      name: '鹰击长空',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const ch = champ?.abilities?.E?.charges;
        return `艾希派出一只鹰灵飞向任意指定地点，沿途提供视野，并在抵达后揭示半径 ${E_REVEAL_R} 的区域（包括草丛），持续 ${E_REVEAL_DUR} 秒。\n`
          + `可储存 2 层充能（每 ${fmt(rv(E_RECHARGE, r))} 秒充能一层${ch != null && rank > 0 ? `，当前 ${ch} 层` : ''}）。`;
      },
      cooldown: E_RECHARGE,
      maxCharges: 2,
      chargeLockout: 0.5,
      cost: [0, 0, 0, 0, 0],
      costType: 'none',
      range: 25000,
      clampRange: false,
      targeting: 'point',
      indicator: { type: 'circle', radius: E_REVEAL_R },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'whoosh',
      cast(champ, ctx) {
        const game = champ.game;
        const team = champ.team;
        const tx = clamp(ctx.x, 50, MAP_SIZE - 50), ty = clamp(ctx.y, 50, MAP_SIZE - 50);
        const dist = Math.hypot(tx - champ.x, ty - champ.y);
        const flight = dist / E_SPEED;
        const proj = game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, toX: tx, toY: ty, speed: E_SPEED, width: 0, hits: 'none',
          height: 260, maxAge: flight + 3, vfx: E_VFX,
          onEnd: (p) => {
            game.vision?.addRevealer?.({ team, x: p.x, y: p.y, radius: E_REVEAL_R, duration: E_REVEAL_DUR, seeBrush: true });
            game.fx.custom('ashe_e_reveal', { x: p.x, y: p.y, radius: E_REVEAL_R, duration: E_REVEAL_DUR, team });
          },
        });
        // 飞行途中的视野
        game.vision?.addRevealer?.({ team, follow: proj, radius: E_FLIGHT_SIGHT, duration: flight + 0.15 });
      },
      ai: { kind: 'farm', range: 3000, custom: eAI },
    },

    // —— R：魔法水晶箭 ——
    R: {
      id: 'ashe_r',
      name: '魔法水晶箭',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `艾希射出一支巨大的寒冰水晶箭，沿直线飞行直到地图边缘，命中第一个敌方英雄时造成 ${scaleText(champ, rv(R_BASE, r), [[R_AP, 'ap']])} 点魔法伤害，`
          + `并使其眩晕 ${R_STUN_MIN}~${R_STUN_MAX} 秒（按飞行距离提升，${R_STUN_FULL} 码时最长）。\n`
          + `目标周围 ${R_SPLASH} 码内的其他敌人受到 ${pct(R_SPLASH_PCT)} 伤害，并被施加冰霜。水晶箭飞行时提供视野。`;
      },
      cooldown: [100, 80, 60],
      cost: [100, 100, 100],
      range: 25000,
      clampRange: false,
      targeting: 'direction',
      indicator: { type: 'line', width: R_WIDTH * 2, length: 3000 },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'ice',
      cast(champ, ctx) {
        const game = champ.game;
        const team = champ.team;
        const rank = ctx.rank;
        const range = edgeDistance(champ.x, champ.y, ctx.dirX, ctx.dirY);
        if (range < 50) return false;
        const proj = game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, range, speed: R_SPEED, width: R_WIDTH,
          hits: 'first', height: 140, maxAge: range / R_SPEED + 2, vfx: R_VFX,
          canHit: (u) => u.type === 'champion' && enemyUnit(champ, u),
          onHit: (u, p) => {
            const dmg = asheRDamage(champ, rank);
            const stun = asheRStun(p.traveled);
            const splash = game.queryUnits({ x: u.x, y: u.y, radius: R_SPLASH, enemyOf: champ, exclude: u }).filter((o) => !o.untargetable);
            game.dealDamage(champ, u, dmg, 'magic', { isAbility: true, spell: 'ashe_r' });
            if (u.alive) {
              u.applyCC('stun', stun, { source: champ });
              applyFrost(champ, u);
            }
            for (const o of splash) {
              if (!o.alive) continue;
              game.dealDamage(champ, o, dmg * R_SPLASH_PCT, 'magic', { isAbility: true, isAoE: true, spell: 'ashe_r' });
              applyFrost(champ, o);
            }
            game.fx.custom('ashe_r_impact', { x: u.x, y: u.y, radius: R_SPLASH, target: u, stun });
            return true;
          },
        });
        game.vision?.addRevealer?.({ team, follow: proj, radius: 600, duration: range / R_SPEED + 0.1 });
        game.fx.custom('ashe_r_cast', { unit: champ, dirX: ctx.dirX, dirY: ctx.dirY });
      },
      ai: {
        kind: 'global', range: 2300, width: R_WIDTH, speed: R_SPEED, delay: 0.25,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, asheRDamage(champ, rank), 'magic') : asheRDamage(champ, rank)),
        custom: rAI,
      },
    },
  },

  ai: { skillOrder: ['W', 'Q', 'E'], style: 'marksman', engageRange: 620, kiteDistance: 520, combo: ['W', 'Q', 'R'] },
};
