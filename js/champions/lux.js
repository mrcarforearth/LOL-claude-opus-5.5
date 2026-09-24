// 英雄：拉克丝（光辉女郎）—— 被动光芒四射（印记引爆）、Q 光之束缚、W 曲光屏障（往返护盾）、E 透光奇点（可再次施放引爆）、R 终极闪光
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本附近） ——
const P_BASE = (level) => 20 + 10 * (Math.max(1, Math.min(18, level || 1)) - 1);   // 20 → 190
const P_AP = 0.20;
const P_DURATION = 6;
const MARK_ID = 'lux_illumination';

const Q_DMG = [80, 130, 180, 230, 280];          // （+60% AP）
const Q_AP = 0.60;
const Q_ROOT = 2;
const Q_RANGE = 1175;
const Q_WIDTH = 70;
const Q_SPEED = 1200;
const Q_MAX_HITS = 2;
const Q_COST = [50, 55, 60, 65, 70];
const Q_CD = [11, 10, 9, 8, 7];

const W_SHIELD = [40, 60, 80, 100, 120];         // （+35% AP），往返各一次
const W_AP = 0.35;
const W_DURATION = 2.5;
const W_RANGE = 1075;
const W_WIDTH = 110;
const W_SPEED = 1400;
const W_COST = [60, 60, 60, 60, 60];
const W_CD = [14, 13, 12, 11, 10];

const E_DMG = [70, 120, 170, 220, 270];          // （+80% AP）
const E_AP = 0.80;
const E_SLOW = [0.25, 0.30, 0.35, 0.40, 0.45];
const E_RADIUS = 310;
const E_RANGE = 1100;
const E_SPEED = 1200;
const E_DURATION = 5;
const E_LINGER = 1;                              // 离开区域后减速残留
const E_COST = [70, 80, 90, 100, 110];
const E_CD = [10, 9, 8, 7, 6];

const R_DMG = [300, 400, 500];                   // （+120% AP）
const R_AP = 1.20;
const R_LENGTH = 3400;
const R_WIDTH = 100;                             // 半宽
const R_CAST = 1.0;
const R_CD = [60, 50, 40];

const GOLD = 0xfff0a0;
const LIGHT = 0xbfe4ff;
const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('芒', '#ffe98a', '#6a4a10'),
  Q: icon('缚', '#a8d8ff', '#1a3a7a'),
  W: icon('屏', '#ffc6ec', '#6a2a6a'),
  E: icon('奇', '#fff2a8', '#3a5a9a'),
  R: icon('闪', '#fffbe0', '#c09a2a'),
};

// —— 伤害 / 护盾计算 ——
const ap = (champ) => champ?.stats?.ap || 0;
const passiveDamage = (champ) => P_BASE(champ?.level) + P_AP * ap(champ);
const qDamage = (champ, rank) => rv(Q_DMG, rank) + Q_AP * ap(champ);
const wShield = (champ, rank) => rv(W_SHIELD, rank) + W_AP * ap(champ);
const eDamage = (champ, rank) => rv(E_DMG, rank) + E_AP * ap(champ);
const rDamage = (champ, rank) => rv(R_DMG, rank) + R_AP * ap(champ);
export const LUX = { passiveDamage, qDamage, wShield, eDamage, rDamage, MARK_ID };

const hittable = (u) => u && u.alive && !u.removed && !u.untargetable && !u.isStructure && u.type !== 'ward';

// 施加光芒印记（技能伤害后调用）
function illuminate(champ, u) {
  if (!hittable(u)) return;
  const had = u.getBuff(MARK_ID);
  const b = u.addBuff({
    id: MARK_ID, name: '光芒四射', desc: '被拉克丝的光芒标记：受到她的普攻或终极闪光时引爆，造成额外魔法伤害', icon: ICONS.P,
    source: champ, duration: P_DURATION, isDebuff: true, refresh: 'duration',
  });
  if (!had) champ.game.fx.custom('lux_mark', { unit: u, buff: b });
}
// 引爆光芒印记；返回造成的伤害
function detonate(champ, u) {
  const b = u.getBuff(MARK_ID);
  if (!b || b.source !== champ) return 0;
  u.removeBuff(b);
  const game = champ.game;
  game.fx.custom('lux_mark_pop', { x: u.x, y: u.y, unit: u });
  return game.dealDamage(champ, u, passiveDamage(champ), 'magic', { spell: 'lux_passive', isOnHit: true });
}

// 护盾（往返使用不同 id 以便叠加）
function prismShield(champ, u, amount, id) {
  if (!u || !u.alive) return;
  u.addShield(amount, W_DURATION, { source: champ, id });
  champ.game.fx.custom('lux_w_shield', { unit: u, shieldId: id, duration: W_DURATION, second: id === 'lux_w_back' });
}

// E 引爆（区域结束/再次施放）
function singularityBurst(champ, ab, x, y, rank) {
  const game = champ.game;
  const hits = game.queryUnits({ x, y, radius: E_RADIUS, enemyOf: champ }).filter(hittable);
  for (const u of hits) {
    game.dealDamage(champ, u, eDamage(champ, rank), 'magic', { isAbility: true, isAoE: true, spell: 'lux_e' });
    if (u.alive) illuminate(champ, u);
  }
  game.fx.custom('lux_e_burst', { x, y, radius: E_RADIUS });
  const st = ab.state;
  if (st.revealer) { st.revealer.remove?.(); st.revealer = null; }
  st.zone = null;
  st.proj = null;
  st.pendingDetonate = false;
  if (ab.isRecastActive) ab.endRecast(false);
  return hits.length;
}

// E 落地：生成减速区域
function singularityLand(champ, ab, x, y, rank) {
  const game = champ.game;
  const st = ab.state;
  st.proj = null;
  if (st.pendingDetonate) { singularityBurst(champ, ab, x, y, rank); return; }
  const slow = rv(E_SLOW, rank);
  st.revealer = game.vision?.addRevealer?.({ team: champ.team, x, y, radius: E_RADIUS, duration: E_DURATION }) || null;
  st.zone = game.spawnZone({
    owner: champ, x, y, radius: E_RADIUS, duration: E_DURATION, tickInterval: 0.1, filter: 'enemy', vfx: null,
    data: { rank },
    onTick: (z, units) => {
      const now = game.time;
      for (const u of units) {
        if (!hittable(u)) continue;
        // 区域内持续减速；离开后残留 1 秒（直接延长已有减速，避免刷屏 cc 事件）
        const c = u.ccs.find((cc) => cc.type === 'slow' && cc.source === champ);
        const linger = E_LINGER * (1 - (u.stats.tenacity || 0));
        if (c) { c.until = Math.max(c.until, now + linger); c.amount = Math.max(c.amount, slow); }
        else u.slow(slow, E_LINGER, champ);
      }
    },
    onEnd: (z) => { if (!z.data.burst) { z.data.burst = true; singularityBurst(champ, ab, z.x, z.y, rank); } },
  });
  game.fx.custom('lux_e_zone', { zone: st.zone, x, y, radius: E_RADIUS, duration: E_DURATION });
}

// —— AI 辅助 ——
function aiOk(r) { return r === true || !!(r && r.ok); }
function aiCastAt(champ, ai, slot, x, y) {
  return aiOk(typeof ai?.castAt === 'function' ? ai.castAt(slot, x, y) : champ.castAbility(slot, { x, y }));
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
function aiPredict(ai, unit, t) {
  const p = ai?.predict?.(unit, t);
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : predictPosition(unit, t);
}
function aiPickTarget(champ, ai, range) {
  const t = ai?.target;
  if (t && t.alive && t.type === 'champion' && t.team !== champ.team && t.isTargetableBy(champ) && champ.distTo(t) <= range) return t;
  const list = aiEnemies(champ, ai, range);
  if (list.length === 0) return null;
  return list.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a));
}
// 被硬控（位置固定）的剩余时间
function lockedFor(u) {
  let m = 0;
  for (const t of ['root', 'stun', 'charm', 'airborne', 'suppress', 'taunt', 'sleep']) m = Math.max(m, u.ccRemaining(t));
  return m;
}
function manaPct(champ) { return champ.maxMana > 0 ? champ.mana / champ.maxMana : 1; }
function farmMode(ai) { return ['laning', 'pushing', 'jungling', 'objective'].includes(ai?.mode); }
const magicTo = (champ, target, raw) => (target ? mitigate(champ, target, raw, 'magic') : raw);
// 若对目标方向施放 R：命中的英雄（按 1 秒后位置预判）与可击杀数
function sparkPlan(champ, ai, aimX, aimY) {
  const d = Math.hypot(aimX - champ.x, aimY - champ.y) || 1;
  const dx = (aimX - champ.x) / d, dy = (aimY - champ.y) / d;
  const rank = champ.abilities.R.rank;
  let hits = 0, kills = 0;
  for (const e of aiEnemies(champ, ai, R_LENGTH)) {
    const lock = lockedFor(e);
    const p = lock >= R_CAST ? { x: e.x, y: e.y } : aiPredict(ai, e, R_CAST);
    // 1 秒后的（预判）位置需在光束上：点到直线距离
    const px = p.x - champ.x, py = p.y - champ.y;
    const along = px * dx + py * dy;
    const perp = Math.abs(px * dy - py * dx);
    const onLine = along > -e.radius && along < R_LENGTH && perp <= R_WIDTH + e.radius * 0.6;
    if (!onLine) continue;
    hits++;
    const marked = e.getBuff(MARK_ID)?.source === champ ? passiveDamage(champ) : 0;
    if (e.hp + e.totalShield <= magicTo(champ, e, rDamage(champ, rank) + marked) * 0.95) kills++;
  }
  return { hits, kills };
}

export default {
  id: 'lux',
  name: '拉克丝',
  title: '光辉女郎',
  roles: ['mid', 'support'],
  tags: ['法师', '辅助'],
  difficulty: 1,
  lore: '来自德玛西亚冕卫家族的光明法师，能够随心所欲地弯曲和操纵光线。',
  baseStats: {
    hp: 580, hpPerLevel: 99, hpRegen: 5.5, hpRegenPerLevel: 0.55,
    mana: 480, manaPerLevel: 23.5, manaRegen: 8, manaRegenPerLevel: 0.8, resource: 'mana',
    ad: 54, adPerLevel: 3.3, as: 0.669, asRatio: 0.625, asPerLevel: 3,
    armor: 21, armorPerLevel: 5.2, mr: 30, mrPerLevel: 1.3,
    ms: 330, range: 550, radius: 65, windup: 0.15625, critMult: 1.75,
    missileSpeed: 1200, attackVfx: { kind: 'light', color: 0xfff2b0, size: 0.8, trail: true },
  },
  model: { primary: 0xf4f0e0, secondary: 0x3a6ad8, accent: 0xfff27a },
  portrait: { bg: ['#e8d05a', '#1a2a5a'], glyph: '光' },

  // —— 被动：光芒四射 ——
  passive: {
    id: 'lux_passive',
    name: '光芒四射',
    icon: ICONS.P,
    desc: (champ) => `拉克丝的伤害技能会为敌人附加光芒印记，持续 ${P_DURATION} 秒。\n`
      + `拉克丝的普攻或终极闪光会引爆印记，造成 ${fmt(passiveDamage(champ))}（${P_BASE(champ?.level)}，随等级提升 +${pct(P_AP)} 法术强度）点额外魔法伤害。`,
    init(champ) {
      const st = champ.passive.state;
      st.detonations = 0;
      // 普攻命中被标记的目标：引爆（作为额外伤害与普攻一同结算）
      champ.addHook('onHit', (target, hit) => {
        const b = target.getBuff(MARK_ID);
        if (!b || b.source !== champ) return;
        target.removeBuff(b);
        st.detonations++;
        hit.extra.push({ amount: passiveDamage(champ), type: 'magic', spell: 'lux_passive' });
        champ.game.fx.custom('lux_mark_pop', { x: target.x, y: target.y, unit: target });
      });
    },
  },

  abilities: {
    // —— Q：光之束缚 ——
    Q: {
      id: 'lux_q',
      name: '光之束缚',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `拉克丝释放一团光球（${Q_RANGE} 码），禁锢命中的前 ${Q_MAX_HITS} 个敌人 ${Q_ROOT} 秒，`
          + `并对它们造成 ${scaleText(champ, rv(Q_DMG, r), [[Q_AP, 'ap']])} 点魔法伤害。`;
      },
      cooldown: Q_CD,
      cost: Q_COST,
      range: Q_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: Q_WIDTH * 2, length: Q_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'light',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY,
          range: Q_RANGE, speed: Q_SPEED, width: Q_WIDTH, hits: 'pierce', height: 100,
          vfx: { kind: 'lux_q_orb', color: LIGHT, size: 1.1, trail: true, fallback: 'light' },
          data: { count: 0 },
          onHit: (u, p) => {
            p.data.count++;
            game.dealDamage(champ, u, qDamage(champ, rank), 'magic', { isAbility: true, spell: 'lux_q' });
            if (u.alive) {
              if (u.applyCC('root', Q_ROOT, { source: champ })) game.fx.custom('lux_q_bind', { unit: u, duration: u.ccRemaining('root') });
              illuminate(champ, u);
            }
            game.fx.impact({ x: u.x, y: u.y, h: 90, color: LIGHT, size: 1 });
            return p.data.count >= Q_MAX_HITS;
          },
        });
      },
      ai: {
        kind: 'cc', range: Q_RANGE, width: Q_WIDTH, speed: Q_SPEED, delay: 0.25,
        damage: (champ, target, rank) => magicTo(champ, target, qDamage(champ, rank) + passiveDamage(champ)),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const t = aiPickTarget(champ, ai, Q_RANGE + 100);
          if (!t) return false;
          const d = champ.distTo(t);
          const lock = lockedFor(t);
          const flight = 0.25 + d / Q_SPEED;
          if (t.hasCC('root') && lock > flight + 0.3) return false; // 已被禁锢，留给下一轮
          const p = lock >= flight ? { x: t.x, y: t.y } : aiPredict(ai, t, flight);
          if (Math.hypot(p.x - champ.x, p.y - champ.y) > Q_RANGE + t.radius * 0.5) return false;
          // 光之束缚能穿过第一个单位：最多允许 1 个阻挡
          const block = game.queryLine({ x1: champ.x, y1: champ.y, x2: p.x, y2: p.y, width: Q_WIDTH, enemyOf: champ, filter: (u) => u !== t && hittable(u) }).length;
          if (block > 1) return false;
          return aiCastAt(champ, ai, 'Q', p.x, p.y);
        },
      },
    },

    // —— W：曲光屏障 ——
    W: {
      id: 'lux_w',
      name: '曲光屏障',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `拉克丝向指定方向掷出魔杖（${W_RANGE} 码），魔杖随后飞回。拉克丝与魔杖经过的友方英雄获得 ${scaleText(champ, rv(W_SHIELD, r), [[W_AP, 'ap']])} 点护盾，持续 ${W_DURATION} 秒；`
          + `魔杖返回时再次提供等量护盾（可叠加）。`;
      },
      cooldown: W_CD,
      cost: W_COST,
      range: W_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: W_WIDTH * 2, length: W_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'shield',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        prismShield(champ, champ, wShield(champ, rank), 'lux_w_out');
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY,
          range: W_RANGE, speed: W_SPEED, width: W_WIDTH, hits: 'pierce', returnToOwner: true, height: 120,
          canHit: (u) => u.alive && !u.removed && u.type === 'champion' && u.team === champ.team && u !== champ,
          vfx: { kind: 'lux_w_wand', color: 0xffc6ec, size: 1, trail: true, fallback: 'light' },
          onHit: (u, p) => {
            prismShield(champ, u, wShield(champ, rank), p.returning ? 'lux_w_back' : 'lux_w_out');
            return false;
          },
          onEnd: (p) => {
            if (p.endReason === 'returned' && champ.alive) prismShield(champ, champ, wShield(champ, rank), 'lux_w_back');
          },
        });
      },
      ai: {
        kind: 'shield', range: W_RANGE, width: W_WIDTH,
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const now = game.time;
          const foes = aiEnemies(champ, ai, 1400);
          if (foes.length === 0 && now - champ.lastDamagedAt > 1) return false;
          // 优先：正在承受伤害、生命偏低的友方英雄
          let best = null, bestScore = 0;
          for (const a of aiAllies(champ, ai, W_RANGE - 50)) {
            const hurt = now - a.lastDamagedAt < 1.2;
            const hp = a.hp / a.maxHp;
            if (!hurt || hp > 0.8) continue;
            const s = (1 - hp) * 2 + (a.isCCd?.() ? 0.5 : 0);
            if (s > bestScore) { bestScore = s; best = a; }
          }
          const selfHurt = now - champ.lastDamagedAt < 1 && champ.hp / champ.maxHp < 0.75;
          if (best) return aiCastAt(champ, ai, 'W', best.x, best.y);
          if (selfHurt && foes.length > 0) {
            // 没有需要保护的队友：朝离自己最近的队友或敌人方向扔（回程也能护到自己）
            const allies = aiAllies(champ, ai, W_RANGE);
            const tgt = allies[0] || foes[0];
            return aiCastAt(champ, ai, 'W', tgt.x, tgt.y);
          }
          return false;
        },
      },
    },

    // —— E：透光奇点 ——
    E: {
      id: 'lux_e',
      name: '透光奇点',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `拉克丝向指定地点（${E_RANGE} 码）投掷一个光之奇点，落地后形成 ${E_RADIUS} 码的区域，提供视野并使区域内的敌人减速 ${pct(rv(E_SLOW, r))}（离开后残留 ${E_LINGER} 秒）。\n`
          + `${E_DURATION} 秒后或再次施放时，奇点引爆，对区域内的敌人造成 ${scaleText(champ, rv(E_DMG, r), [[E_AP, 'ap']])} 点魔法伤害。`;
      },
      cooldown: E_CD,
      cost: E_COST,
      range: E_RANGE,
      targeting: 'point',
      indicator: { type: 'circle', radius: E_RADIUS },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'light',
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const rank = ctx.rank;
        const st = ab.state;
        // 旧奇点（理论上已引爆）清理
        if (st.zone && !st.zone.dead) st.zone.remove();
        st.pendingDetonate = false;
        const tx = ctx.x, ty = ctx.y;
        const dist = Math.hypot(tx - champ.x, ty - champ.y);
        st.proj = game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, toX: tx, toY: ty, speed: E_SPEED, width: 0, hits: 'none', height: 110,
          vfx: { kind: 'lux_e_orb', color: GOLD, size: 1.1, trail: true, fallback: 'light', arc: 160 },
          data: { tx, ty, dist },
          onEnd: (p) => singularityLand(champ, ab, tx, ty, rank),
        });
        ab.setRecast(dist / E_SPEED + E_DURATION + 0.3, { cooldownOnExpire: false });
      },
      recast(champ, ctx) {
        const ab = ctx.ability;
        const st = ab.state;
        if (st.zone && !st.zone.dead) { st.zone.remove(); return true; }
        if (st.proj && !st.proj.dead) { st.pendingDetonate = true; return true; }
        ab.endRecast(false);
        return false;
      },
      ai: {
        kind: 'aoe', range: E_RANGE, radius: E_RADIUS, speed: E_SPEED, delay: 0.25, farm: true,
        damage: (champ, target, rank) => magicTo(champ, target, eDamage(champ, rank)),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const st = ability.state;
          if (ability.isRecastActive) {
            const z = st.zone;
            if (!z || z.dead) return false;
            const inside = game.queryUnits({ x: z.x, y: z.y, radius: E_RADIUS, enemyOf: champ }).filter(hittable);
            const champsIn = inside.filter((u) => u.type === 'champion');
            if (champsIn.length > 0) {
              // 敌方英雄即将走出区域时立即引爆
              const leaving = champsIn.some((u) => Math.hypot(u.x - z.x, u.y - z.y) > E_RADIUS * 0.6 || !u.moving);
              if (leaving || z.age > 0.6) return !!champ.castAbility('E', {}).ok;
              return false;
            }
            if (inside.length >= 3 && z.age > 0.4 && aiEnemies(champ, ai, 1600).length === 0) return !!champ.castAbility('E', {}).ok;
            return false;
          }
          const t = aiPickTarget(champ, ai, E_RANGE + E_RADIUS * 0.6);
          if (t) {
            const d = champ.distTo(t);
            const lock = lockedFor(t);
            const flight = 0.25 + d / E_SPEED;
            const p = lock >= flight ? { x: t.x, y: t.y } : aiPredict(ai, t, flight + 0.2);
            const pd = Math.hypot(p.x - champ.x, p.y - champ.y);
            if (pd > E_RANGE + E_RADIUS * 0.6) return false;
            return aiCastAt(champ, ai, 'E', p.x, p.y);
          }
          if (!farmMode(ai) || manaPct(champ) < 0.55) return false;
          const minions = game.queryUnits({ x: champ.x, y: champ.y, radius: E_RANGE, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'] });
          if (minions.length < 3 && !minions.some((m) => m.type === 'monster')) return false;
          // 小兵最密集处
          let best = null, bestN = 0;
          for (const m of minions) {
            const n = minions.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) <= E_RADIUS).length;
            if (n > bestN) { bestN = n; best = m; }
          }
          if (!best || (bestN < 3 && best.type !== 'monster')) return false;
          return aiCastAt(champ, ai, 'E', best.x, best.y);
        },
      },
    },

    // —— R：终极闪光 ——
    R: {
      id: 'lux_r',
      name: '终极闪光',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `拉克丝蓄力 ${R_CAST} 秒后发射一道 ${R_LENGTH} 码长的耀眼光束，对直线上的所有敌人造成 ${scaleText(champ, rv(R_DMG, r), [[R_AP, 'ap']])} 点魔法伤害，并照亮沿途区域。\n`
          + `终极闪光会先引爆目标身上的光芒印记，然后重新施加印记。`;
      },
      cooldown: R_CD,
      cost: [100, 100, 100],
      range: R_LENGTH,
      targeting: 'direction',
      indicator: { type: 'line', width: R_WIDTH * 2, length: R_LENGTH },
      castTime: R_CAST,
      lockMovement: true,
      sfx: 'light',
      onCastStart(champ, ctx) {
        const x2 = champ.x + ctx.dirX * R_LENGTH, y2 = champ.y + ctx.dirY * R_LENGTH;
        champ.modelState.finalSpark = true;
        champ.game.fx.custom('lux_r_charge', { unit: champ, x1: champ.x, y1: champ.y, x2, y2, dirX: ctx.dirX, dirY: ctx.dirY, width: R_WIDTH, duration: R_CAST });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        champ.modelState.finalSpark = false;
        const x1 = champ.x, y1 = champ.y;
        const x2 = x1 + ctx.dirX * R_LENGTH, y2 = y1 + ctx.dirY * R_LENGTH;
        const hits = game.queryLine({ x1, y1, x2, y2, width: R_WIDTH, enemyOf: champ }).filter(hittable);
        for (const u of hits) {
          detonate(champ, u);
          if (!u.alive) continue;
          game.dealDamage(champ, u, rDamage(champ, rank), 'magic', { isAbility: true, isAoE: true, spell: 'lux_r' });
          if (u.alive) {
            illuminate(champ, u);
            if (u.type === 'champion') u.revealedUntil = Math.max(u.revealedUntil, game.time + 1);
          }
        }
        // 光束照亮沿途区域 1 秒
        const vis = game.vision;
        if (vis && typeof vis.addRevealer === 'function') {
          for (let s = 0; s <= R_LENGTH; s += 500) vis.addRevealer({ team: champ.team, x: x1 + ctx.dirX * s, y: y1 + ctx.dirY * s, radius: 420, duration: 1, seeBrush: true });
        }
        game.fx.beam({ x1, y1, x2, y2, h: 100, width: R_WIDTH * 1.1, color: 0xfff8d8, duration: 0.45 });
        game.fx.custom('lux_r_beam', { unit: champ, x1, y1, x2, y2, width: R_WIDTH, duration: 0.9 });
        game.fx.shake?.(6, 0.3);
      },
      update(champ) {
        // 蓄力被打断时复位外观状态
        if (champ.modelState.finalSpark && champ.castLock <= 0) champ.modelState.finalSpark = false;
      },
      ai: {
        kind: 'execute', range: R_LENGTH, width: R_WIDTH, delay: R_CAST,
        damage: (champ, target, rank) => magicTo(champ, target, rDamage(champ, rank) + passiveDamage(champ)),
        custom(champ, ability, ai, game) {
          if (!ability.ready || champ.castLock > 0) return false;
          const cands = aiEnemies(champ, ai, R_LENGTH - 100);
          if (cands.length === 0) return false;
          let best = null, bestScore = 0;
          for (const e of cands) {
            const lock = lockedFor(e);
            const aim = lock >= R_CAST * 0.9 ? { x: e.x, y: e.y } : aiPredict(ai, e, R_CAST);
            const plan = sparkPlan(champ, ai, aim.x, aim.y);
            if (plan.hits === 0) continue;
            let score = plan.kills * 3 + (plan.hits >= 2 ? plan.hits : 0);
            // 被控制的目标 + 已经受伤：必中且收益高
            if (lock >= R_CAST * 0.9 && e.hp / e.maxHp < 0.7) score += 2;
            if (score > bestScore) { bestScore = score; best = aim; }
          }
          if (!best || bestScore < 2) return false;
          return aiCastAt(champ, ai, 'R', best.x, best.y);
        },
      },
    },
  },

  ai: { skillOrder: ['E', 'Q', 'W'], style: 'mage', engageRange: 900, kiteDistance: 600, combo: ['Q', 'E', 'R', 'W'] },
};
