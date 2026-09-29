// 英雄：劫（影流之主）—— 影忍法·灭魂劫、影奥义！诸刃（手里剑）、影奥义！分身（影分身/换位）、影奥义！鬼斩、禁奥义！瞬狱影杀阵（死亡印记）
//
// 影分身实现：纯模拟对象（不进入 game 实体列表、不可选取、不参与战斗），保存在 champ.passive.state.shadows；
// 渲染通过 fx.custom('zed_shadow', { shadow, owner })，特效每帧读取 shadow.x/y/alive/facing（跟随换位与消失）。
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { norm } from '../core/math.js';
import { mitigate } from '../core/damage.js';

// —— 数值表（LoL 当前版本） ——
const P_PCT = [0.06, 0.08, 0.1];         // 1/7/17 级：目标最大生命值百分比魔法伤害
const P_HP_TH = 0.5;
const P_TARGET_CD = 10;
const P_MONSTER_CAP = 300;

const Q_BASE = [80, 115, 150, 185, 220];
const Q_BAD = 1.0;
const Q_REDUCED = 0.6;                   // 穿透后续目标 / 同一目标被多枚手里剑命中
const Q_RANGE = 900;
const Q_SPEED = 1700;
const Q_WIDTH = 50;
const Q_COST = [75, 70, 65, 60, 55];
const Q_CD = [6, 6, 6, 6, 6];

const W_RANGE = 650;
const W_SPEED = 2500;
const W_DUR = 5.25;
const W_COST = [40, 35, 30, 25, 20];
const W_CD = [20, 18.5, 17, 15.5, 14];
const W_E_REDUCE = 2;                    // E 每命中一名敌方英雄，W 冷却 -2 秒

const E_BASE = [65, 90, 115, 140, 165];
const E_BAD = 0.65;
const E_RADIUS = 290;
const E_SLOW = [0.2, 0.25, 0.3, 0.35, 0.4];
const E_SLOW_DUR = 1.5;
const E_COST = [50, 50, 50, 50, 50];
const E_CD = [5, 4.5, 4, 3.5, 3];

const R_RANGE = 625;
const R_MARK = 3;
const R_PCT = [0.25, 0.4, 0.55];
const R_AD = 1.0;
const R_SHADOW_DUR = 6;
const R_UNTARGETABLE = 0.75;
const R_DASH = 0.45;
const R_CD = [120, 90, 60];

const RED = 0xff2a3a;
const SHADOW = 0x6a2a9a;
const STEEL = 0xd8dce8;

const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('灭', '#c03040', '#2a0a10'),
  Q: icon('刃', '#d8d8e8', '#3a2a4a'),
  W: icon('影', '#9a5ad0', '#1a0a2a'),
  W2: icon('换', '#b07ae0', '#200a34'),
  E: icon('斩', '#e04050', '#300a14'),
  R: icon('狱', '#ff3040', '#12040a'),
  R2: icon('归', '#ff6070', '#1a060c'),
};

// —— 公式 ——
export function zedPassivePct(level) { return level >= 17 ? P_PCT[2] : level >= 7 ? P_PCT[1] : P_PCT[0]; }
export function zedQDamage(champ, rank) { return rv(Q_BASE, rank) + Q_BAD * (champ?.stats?.bonusAd || 0); }
export function zedEDamage(champ, rank) { return rv(E_BASE, rank) + E_BAD * (champ?.stats?.bonusAd || 0); }
export function zedRPop(champ, rank, stored) { return R_AD * (champ?.stats?.ad || 0) + rv(R_PCT, rank) * Math.max(0, stored || 0); }

// —— 影分身 ——
let shadowSeq = 0;
function shadowsOf(champ) {
  const st = champ.passive.state;
  if (!st.shadows) st.shadows = [];
  return st.shadows;
}
export function zedShadows(champ, { arrivedOnly = true } = {}) {
  return shadowsOf(champ).filter((s) => s.alive && (!arrivedOnly || s.arrived));
}
function spawnShadow(champ, kind, x, y, tx, ty, duration) {
  const game = champ.game;
  const p = game.nav.isWalkable(tx, ty) ? { x: tx, y: ty } : game.nav.nearestWalkable(tx, ty);
  const s = {
    id: ++shadowSeq, kind, owner: champ, team: champ.team, x, y, tx: p.x, ty: p.y, facing: champ.facing,
    alive: true, arrived: Math.hypot(p.x - x, p.y - y) < 1, expiresAt: game.time + duration, queue: [], action: null, actionAt: -99,
  };
  if (s.arrived) { s.x = p.x; s.y = p.y; }
  shadowsOf(champ).push(s);
  champ.modelState.shadowCount = zedShadows(champ, { arrivedOnly: false }).length;
  game.fx.custom('zed_shadow', { shadow: s, owner: champ, unit: champ, kind, duration: duration + 0.5 });
  return s;
}
function killShadow(champ, s) {
  if (!s || !s.alive) return;
  s.alive = false;
  s.queue.length = 0;
  champ.game.fx.custom('zed_shadow_fade', { x: s.x, y: s.y, team: s.team });
  champ.modelState.shadowCount = zedShadows(champ, { arrivedOnly: false }).length;
}
// 分身执行（或排队到抵达后执行）
function shadowDo(champ, s, fn) {
  if (!s.alive) return;
  if (s.arrived) fn(s);
  else s.queue.push(fn);
}
function updateShadows(champ, dt) {
  const game = champ.game;
  const list = shadowsOf(champ);
  for (const s of list) {
    if (!s.alive) continue;
    if (game.time >= s.expiresAt || !champ.alive) { killShadow(champ, s); continue; }
    if (!s.arrived) {
      const dx = s.tx - s.x, dy = s.ty - s.y;
      const d = Math.hypot(dx, dy);
      const step = W_SPEED * dt;
      if (d <= step) {
        s.x = s.tx; s.y = s.ty; s.arrived = true;
        const q = s.queue.splice(0);
        for (const fn of q) fn(s);
      } else { s.x += (dx / d) * step; s.y += (dy / d) * step; s.facing = Math.atan2(dy, dx); }
    }
  }
  if (list.length > 6 || list.some((s) => !s.alive)) {
    const keep = list.filter((s) => s.alive);
    list.length = 0;
    list.push(...keep);
  }
}
// 与分身换位
function swapWith(champ, s) {
  const game = champ.game;
  if (!s || !s.alive || !s.arrived || !champ.canDash()) return false;
  const ox = champ.x, oy = champ.y, of = champ.facing;
  champ.blink(s.x, s.y);
  champ.facing = s.facing;
  s.x = ox; s.y = oy; s.tx = ox; s.ty = oy; s.facing = of;
  game.fx.custom('zed_swap', { unit: champ, x1: ox, y1: oy, x2: champ.x, y2: champ.y, shadow: s });
  return true;
}

// —— 技能结算（劫本体与分身共用） ——
function throwShurikens(champ, rank, tx, ty) {
  const game = champ.game;
  const dmg = zedQDamage(champ, rank);
  const hitBy = new Set();   // 本次施放中已被命中的单位
  const throwFrom = (sx, sy, src) => {
    const d = norm(tx - sx, ty - sy, { x: Math.cos(champ.facing), y: Math.sin(champ.facing) });
    if (src) { src.facing = Math.atan2(d.y, d.x); src.action = 'Q'; src.actionAt = game.time; }
    let first = true;
    game.spawnProjectile({
      owner: champ, x: sx, y: sy, dirX: d.x, dirY: d.y, range: Q_RANGE, speed: Q_SPEED, width: Q_WIDTH, hits: 'pierce',
      vfx: { kind: 'zed_q_shuriken', color: src ? SHADOW : STEEL, size: 1, trail: true, shadow: !!src }, height: 90,
      onHit: (u) => {
        const full = first && !hitBy.has(u);
        first = false;
        hitBy.add(u);
        game.dealDamage(champ, u, dmg * (full ? 1 : Q_REDUCED), 'physical', { isAbility: true, isAoE: true, spell: 'zed_q' });
        game.fx.impact({ x: u.x, y: u.y, h: 90, color: full ? RED : SHADOW, size: 0.8 });
      },
    });
  };
  throwFrom(champ.x, champ.y, null);
  for (const s of shadowsOf(champ)) if (s.alive) shadowDo(champ, s, (sh) => throwFrom(sh.x, sh.y, sh));
}

function shadowSlash(champ, rank) {
  const game = champ.game;
  const dmg = zedEDamage(champ, rank);
  const slow = rv(E_SLOW, rank);
  const hitSet = new Set();
  let champHits = 0;
  const slashAt = (x, y, src) => {
    if (src) { src.action = 'E'; src.actionAt = game.time; }
    game.fx.custom('zed_e_slash', { x, y, radius: E_RADIUS, unit: src ? null : champ, shadow: src, team: champ.team });
    const hits = game.queryUnits({ x, y, radius: E_RADIUS, enemyOf: champ }).filter((u) => !u.untargetable);
    for (const u of hits) {
      if (hitSet.has(u)) { if (u.alive) u.slow(Math.min(0.99, slow * 1.25), E_SLOW_DUR, champ); continue; }
      hitSet.add(u);
      game.dealDamage(champ, u, dmg, 'physical', { isAbility: true, isAoE: true, spell: 'zed_e' });
      if (u.alive) u.slow(slow, E_SLOW_DUR, champ);
      if (u.type === 'champion') {
        champHits++;
        champ.abilities.W.reduceCooldown(W_E_REDUCE);
      }
    }
  };
  slashAt(champ.x, champ.y, null);
  for (const s of shadowsOf(champ)) if (s.alive) shadowDo(champ, s, (sh) => slashAt(sh.x, sh.y, sh));
  return champHits;
}

// —— AI 辅助 ——
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
  try { if (typeof ai?.castAt === 'function' && !champ.abilities[slot].isRecastActive) r = ai.castAt(slot, x, y); } catch { r = undefined; }
  if (r == null) r = champ.castAbility(slot, { x, y });
  return r === true || !!r?.ok;
}
function aiCastOn(ai, champ, slot, target) {
  let r;
  try { if (typeof ai?.castOn === 'function') r = ai.castOn(slot, target); } catch { r = undefined; }
  if (r == null) r = champ.castAbility(slot, { target });
  return r === true || !!r?.ok;
}
const minDistToEnemies = (game, champ, x, y) => {
  let m = Infinity;
  for (const e of game.champions) if (e.alive && e.team !== champ.team && e.visible?.[champ.team] !== false) m = Math.min(m, Math.hypot(e.x - x, e.y - y));
  return m;
};
// 劫的一套连招预估（用于 R 判断）
function comboEstimate(champ, t) {
  const Q = champ.abilities.Q, E = champ.abilities.E, R = champ.abilities.R;
  let raw = 0;
  if (Q.rank && Q.cdRemaining < 1.5) raw += zedQDamage(champ, Q.rank) * 1.4;
  if (E.rank) raw += zedEDamage(champ, E.rank);
  raw += champ.stats.ad * 2.5;
  const phys = mitigate(champ, t, raw, 'physical');
  const pop = R.rank ? mitigate(champ, t, zedRPop(champ, R.rank, phys), 'physical') : 0;
  const p = t.hp / t.maxHp < P_HP_TH + 0.2 ? mitigate(champ, t, zedPassivePct(champ.level) * t.maxHp, 'magic') : 0;
  return phys + pop + p;
}

export default {
  id: 'zed',
  name: '劫',
  title: '影流之主',
  roles: ['mid'],
  tags: ['刺客'],
  difficulty: 3,
  lore: '影流教派的首领，掌握禁忌的影之奥义，以影分身与手里剑无声地收割敌人。',
  baseStats: {
    hp: 654, hpPerLevel: 99, hpRegen: 7, hpRegenPerLevel: 0.65,
    mana: 200, manaPerLevel: 0, manaRegen: 50, manaRegenPerLevel: 0, resource: 'energy',
    ad: 63, adPerLevel: 3.4, as: 0.651, asRatio: 0.651, asPerLevel: 3.3,
    armor: 32, armorPerLevel: 4.7, mr: 32, mrPerLevel: 2.05,
    ms: 345, range: 125, radius: 65, windup: 0.25, missileSpeed: 0, critMult: 1.75,
  },
  model: { primary: 0x2a2a34, secondary: 0xb02030, accent: 0xff2a3a },
  portrait: { bg: ['#8a1a24', '#0c0408'], glyph: '劫' },

  // —— 被动：影忍法·灭魂劫 ——
  passive: {
    id: 'zed_passive',
    name: '影忍法·灭魂劫',
    icon: ICONS.P,
    desc: (champ) => {
      const p = zedPassivePct(champ?.level || 1);
      return `劫对生命值低于 ${pct(P_HP_TH)} 的敌人普攻时，额外造成目标最大生命值 ${pct(p)}（1/7/17 级：6%/8%/10%）的魔法伤害。同一目标每 ${P_TARGET_CD} 秒只能触发一次（对野怪最多 ${P_MONSTER_CAP}）。`;
    },
    init(champ) {
      const st = champ.passive.state;
      st.shadows = [];
      champ.addHook('onHit', (target, hit) => {
        if (!target || target.isStructure || target.type === 'ward' || !target.maxHp) return;
        if (target.hp / target.maxHp >= P_HP_TH) return;
        const cdId = `zed_p_cd_${champ.id}`;
        if (target.hasBuff(cdId)) return;
        let amt = zedPassivePct(champ.level) * target.maxHp;
        if (target.type === 'monster') amt = Math.min(P_MONSTER_CAP, amt);
        hit.extra.push({ amount: amt, type: 'magic', spell: 'zed_passive' });
        target.addBuff({ id: cdId, name: '灭魂劫', desc: '近期已受到劫的灭魂劫', icon: ICONS.P, source: champ, duration: P_TARGET_CD, isDebuff: true, hidden: true });
        champ.game.fx.custom('zed_p_hit', { unit: target, x: target.x, y: target.y });
      });
      // 死亡印记：累计印记期间劫对目标造成的伤害
      champ.addHook('afterDealDamage', (ctx) => {
        const t = ctx.target;
        if (!t || ctx.spell === 'zed_r_pop' || !(ctx.dealt > 0)) return;
        const b = t.getBuff?.('zed_r_mark');
        if (b && b.source === champ) b.data.stored += ctx.dealt;
      });
    },
    update(champ, dt) { updateShadows(champ, dt); },
  },

  abilities: {
    // —— Q：影奥义！诸刃 ——
    Q: {
      id: 'zed_q',
      name: '影奥义！诸刃',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `劫和他的影分身同时向目标位置掷出手里剑，每枚手里剑穿透命中的敌人，对第一个目标造成 ${scaleText(champ, rv(Q_BASE, r), [[Q_BAD, 'bonusAd']])} 点物理伤害，`
          + `对后续目标造成 ${pct(Q_REDUCED)} 伤害。同一目标被多枚手里剑命中时，额外的手里剑只造成 ${pct(Q_REDUCED)} 伤害。`;
      },
      cooldown: Q_CD,
      cost: Q_COST,
      range: Q_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: Q_WIDTH * 2, length: Q_RANGE },
      castTime: 0.25,
      lockMovement: true,
      sfx: 'whoosh',
      cast(champ, ctx) {
        const tx = champ.x + ctx.dirX * Q_RANGE, ty = champ.y + ctx.dirY * Q_RANGE;
        // 分身朝劫的指向点（光标位置）投掷
        const cx = ctx.cursorX ?? ctx.x, cy = ctx.cursorY ?? ctx.y;
        const far = Math.hypot(cx - champ.x, cy - champ.y) > 50;
        throwShurikens(champ, ctx.rank, far ? cx : tx, far ? cy : ty);
      },
      ai: {
        kind: 'nuke', range: Q_RANGE - 50, width: Q_WIDTH, speed: Q_SPEED, delay: 0.25, farm: true,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, zedQDamage(champ, rank), 'physical') : zedQDamage(champ, rank)),
        custom: (champ, ab, ai, game) => {
          if (!ab.ready || champ.mana < ab.cost) return false;
          const c = aiCtx(ai);
          if (combatOk(c) || c === 'idle') {
            // 从劫或任一分身出发，射程内的敌方英雄
            const sources = [champ, ...zedShadows(champ)];
            const t = aiTarget(ai, champ, Q_RANGE + W_RANGE);
            if (t && !((c === 'harass' || c === 'idle') && (champ.mana < ab.cost + 40 || aiUnderTurret(ai, champ, t.x, t.y)))) {
              const src = sources.reduce((a, b) => (Math.hypot(b.x - t.x, b.y - t.y) < Math.hypot(a.x - t.x, a.y - t.y) ? b : a));
              const d = Math.hypot(src.x - t.x, src.y - t.y);
              if (d <= Q_RANGE - 40) {
                const p = aiPredict(ai, t, 0.25 + d / Q_SPEED);
                return aiCastAt(ai, champ, 'Q', p.x, p.y);
              }
            }
          }
          if (FARM_CTX.has(c) && champ.mana > (c === 'jungle' ? ab.cost + 20 : 150)) {
            const tgt = champ.attackTarget || champ.command?.target;
            if (tgt && tgt.alive && tgt.team !== champ.team && !tgt.isStructure && champ.distTo(tgt) < Q_RANGE - 100) {
              if (c !== 'jungle') {
                const n = game.queryLine({ x1: champ.x, y1: champ.y, x2: tgt.x, y2: tgt.y, width: Q_WIDTH + 30, enemyOf: champ, types: ['minion'] }).length;
                if (n < 2) return false;
              }
              return aiCastAt(ai, champ, 'Q', tgt.x, tgt.y);
            }
          }
          return false;
        },
      },
    },

    // —— W：影奥义！分身 ——
    W: {
      id: 'zed_w',
      name: '影奥义！分身',
      recastName: '影奥义！分身（换位）',
      icon: ICONS.W,
      recastIcon: ICONS.W2,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `劫的影分身向前冲出 ${W_RANGE} 码，停留 ${W_DUR} 秒。影分身会模仿劫施放的影奥义！诸刃与影奥义！鬼斩。\n`
          + `再次施放：劫与影分身交换位置。\n影奥义！鬼斩每命中一名敌方英雄，该技能冷却缩短 ${W_E_REDUCE} 秒。消耗 ${rv(W_COST, r)} 能量。`;
      },
      cooldown: W_CD,
      cost: W_COST,
      range: W_RANGE,
      targeting: 'point',
      indicator: { type: 'line', width: 100, length: W_RANGE },
      castTime: 0,
      lockMovement: false,
      sfx: 'whoosh',
      cast(champ, ctx) {
        const ab = ctx.ability;
        const d = Math.max(150, ctx.dist);
        const tx = champ.x + ctx.dirX * Math.min(W_RANGE, d), ty = champ.y + ctx.dirY * Math.min(W_RANGE, d);
        // 旧的 W 分身消失
        const old = ab.state.shadow;
        if (old && old.alive) killShadow(champ, old);
        const s = spawnShadow(champ, 'w', champ.x, champ.y, tx, ty, W_DUR);
        s.facing = Math.atan2(ctx.dirY, ctx.dirX);
        ab.state.shadow = s;
        champ.game.fx.custom('zed_w_cast', { unit: champ, shadow: s, x: tx, y: ty });
        ab.setRecast(W_DUR, { cooldownOnExpire: false, onExpire: () => { ab.state.shadow = null; } });
      },
      recast(champ, ctx) {
        const ab = ctx.ability;
        const s = ab.state.shadow;
        if (!s || !s.alive) { ab.endRecast(false); return false; }
        if (!s.arrived) return false;
        if (!swapWith(champ, s)) return false;
        ab.endRecast(false);
        return true;
      },
      update(champ, ab) {
        if (ab.isRecastActive && (!ab.state.shadow || !ab.state.shadow.alive)) ab.endRecast(false);
      },
      ai: {
        kind: 'gapclose', range: W_RANGE,
        damage: () => 0,
        custom: (champ, ab, ai, game) => {
          const c = aiCtx(ai);
          const hp = aiHp(ai, champ);
          // —— 换位 ——
          if (ab.isRecastActive) {
            const s = ab.state.shadow;
            if (!s || !s.alive || !s.arrived || champ.dashState) return false;
            if (c === 'escape' || hp < 0.3) {
              const here = minDistToEnemies(game, champ, champ.x, champ.y);
              const there = minDistToEnemies(game, champ, s.x, s.y);
              if (there > here + 150 && !aiUnderTurret(ai, champ, s.x, s.y)) return !!champ.castAbility('W').ok;
              return false;
            }
            if (c === 'fight') {
              const t = aiTarget(ai, champ, 1400);
              if (!t) return false;
              const dz = champ.distTo(t), ds = Math.hypot(s.x - t.x, s.y - t.y);
              const dive = !!ai?.diving;
              if (ds + 200 < dz && ds < 400 && hp > 0.35 && (dive || !aiUnderTurret(ai, champ, s.x, s.y)) && (t.hp / t.maxHp < 0.6 || hp > 0.6)) {
                return !!champ.castAbility('W').ok;
              }
            }
            return false;
          }
          if (!ab.ready || champ.mana < ab.cost) return false;
          // 逃跑：朝泉水放分身，随后换位
          if (c === 'escape') {
            if (champ.mana < ab.cost) return false;
            const f = game.fountainOf(champ.team);
            const d = norm(f.x - champ.x, f.y - champ.y);
            return aiCastAt(ai, champ, 'W', champ.x + d.x * W_RANGE, champ.y + d.y * W_RANGE);
          }
          if (!combatOk(c)) return false;
          const t = aiTarget(ai, champ, W_RANGE + Q_RANGE - 100);
          if (!t) return false;
          const Q = champ.abilities.Q, E = champ.abilities.E;
          const follow = (Q.rank && Q.ready) || (E.rank && E.ready);
          const need = ab.cost + (Q.ready ? Q.cost : 0);
          if (!follow || champ.mana < need) return false;
          if (c === 'harass' && (champ.mana < need + 30 || aiUnderTurret(ai, champ, t.x, t.y))) return false;
          const d = champ.distTo(t);
          // 分身放在目标附近（手里剑三角 / 鬼斩覆盖）
          const p = aiPredict(ai, t, 0.3);
          const dd = Math.hypot(p.x - champ.x, p.y - champ.y) || 1;
          const reach = Math.min(W_RANGE, Math.max(200, dd - (c === 'harass' ? 250 : 80)));
          if (d > W_RANGE + Q_RANGE - 150) return false;
          return aiCastAt(ai, champ, 'W', champ.x + ((p.x - champ.x) / dd) * reach, champ.y + ((p.y - champ.y) / dd) * reach);
        },
      },
    },

    // —— E：影奥义！鬼斩 ——
    E: {
      id: 'zed_e',
      name: '影奥义！鬼斩',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `劫与他的影分身挥舞刀刃，对周围 ${E_RADIUS} 码内的敌人造成 ${scaleText(champ, rv(E_BASE, r), [[E_BAD, 'bonusAd']])} 点物理伤害，并减速 ${pct(rv(E_SLOW, r))}，持续 ${E_SLOW_DUR} 秒。\n`
          + `同时被劫和分身命中的敌人只受到一次伤害，但减速效果更强。每命中一名敌方英雄，影奥义！分身的冷却缩短 ${W_E_REDUCE} 秒。`;
      },
      cooldown: E_CD,
      cost: E_COST,
      range: E_RADIUS,
      targeting: 'self',
      indicator: { type: 'self', radius: E_RADIUS },
      castTime: 0,
      lockMovement: false,
      sfx: 'slash',
      cast(champ, ctx) {
        champ.modelState.eSpin = true;
        champ.game.after(0.3, () => { champ.modelState.eSpin = false; });
        shadowSlash(champ, ctx.rank);
      },
      ai: {
        kind: 'aoe', range: E_RADIUS, radius: E_RADIUS, farm: true,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, zedEDamage(champ, rank), 'physical') : zedEDamage(champ, rank)),
        custom: (champ, ab, ai, game) => {
          if (!ab.ready || champ.mana < ab.cost) return false;
          const c = aiCtx(ai);
          const srcs = [champ, ...zedShadows(champ)];
          if (c !== 'jungle' && c !== 'farm') {
            for (const e of aiEnemies(ai, champ, E_RADIUS + W_RANGE + 200)) {
              const p = aiPredict(ai, e, 0.05);
              if (srcs.some((s) => Math.hypot(p.x - s.x, p.y - s.y) < E_RADIUS + e.radius * 0.4)) {
                if ((c === 'harass' || c === 'idle' || c === 'push') && champ.mana < ab.cost + 60) return false;
                return !!champ.castAbility('E').ok;
              }
            }
          }
          if (FARM_CTX.has(c)) {
            const mons = game.queryUnits({ x: champ.x, y: champ.y, radius: E_RADIUS - 20, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'] });
            const need = c === 'jungle' ? 1 : c === 'push' ? 3 : 4;
            const energy = c === 'jungle' ? ab.cost + 20 : 120;
            if (mons.length >= need && champ.mana >= energy && !aiUnderTurret(ai, champ, champ.x, champ.y)) return !!champ.castAbility('E').ok;
          }
          return false;
        },
      },
    },

    // —— R：禁奥义！瞬狱影杀阵 ——
    R: {
      id: 'zed_r',
      name: '禁奥义！瞬狱影杀阵',
      recastName: '禁奥义！瞬狱影杀阵（换位）',
      icon: ICONS.R,
      recastIcon: ICONS.R2,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `劫变为不可选取，突进到一名敌方英雄身后，在原地留下一个影分身（持续 ${R_SHADOW_DUR} 秒），并在目标身上施加死亡印记。\n`
          + `${R_MARK} 秒后印记引爆，造成 ${scaleText(champ, 0, [[R_AD, 'ad']])} 点物理伤害，外加印记期间劫对目标造成伤害的 ${pct(rv(R_PCT, r))}。\n`
          + `再次施放：劫与禁奥义的影分身交换位置。`;
      },
      cooldown: R_CD,
      cost: [0, 0, 0],
      range: R_RANGE,
      targeting: 'unit',
      targetFilter: 'enemyChampion',
      indicator: { type: 'unit' },
      castTime: 0,
      lockMovement: true,
      sfx: 'dash',
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const t = ctx.target;
        if (!t || !t.alive) return false;
        if (!champ.canDash()) return false;
        const rank = ctx.rank;
        // 原地留下 R 分身
        const old = ab.state.shadow;
        if (old && old.alive) killShadow(champ, old);
        const s = spawnShadow(champ, 'r', champ.x, champ.y, champ.x, champ.y, R_SHADOW_DUR);
        ab.state.shadow = s;
        // 不可选取
        champ.addBuff({
          id: 'zed_r_untargetable', name: '瞬狱影杀阵', desc: '不可选取', icon: ICONS.R, source: champ, duration: R_UNTARGETABLE, refresh: 'replace', hidden: true,
          onApply: (u) => { u.untargetable = true; u.modelState.deathMark = true; },
          onRemove: (u) => { u.untargetable = false; u.modelState.deathMark = false; },
        });
        const dir = norm(t.x - champ.x, t.y - champ.y, { x: Math.cos(champ.facing), y: Math.sin(champ.facing) });
        const behind = (t.radius || 65) + champ.radius + 20;
        const mark = () => {
          if (!t.alive) return;
          t.addBuff({
            id: 'zed_r_mark', name: '死亡印记', desc: '印记结束时受到劫在期间造成伤害的一部分', icon: ICONS.R, source: champ,
            duration: R_MARK, isDebuff: true, refresh: 'replace', data: { stored: 0, rank },
            onExpire: (u, b) => {
              if (!u.alive) return;
              const dmg = zedRPop(champ, b.data.rank, b.data.stored);
              game.dealDamage(champ, u, dmg, 'physical', { isAbility: true, spell: 'zed_r_pop' });
              game.fx.custom('zed_r_pop', { unit: u, x: u.x, y: u.y, amount: dmg });
            },
          });
          game.fx.custom('zed_r_mark', { unit: t, duration: R_MARK });
        };
        const ok = champ.dash({
          followTarget: t, duration: R_DASH, ignoreWalls: true, unstoppable: true, stopDistance: 0,
          onEnd: () => {
            if (!champ.alive) return;
            if (t.alive) {
              champ.blink(t.x + dir.x * behind, t.y + dir.y * behind);
              champ.faceTowards(t.x, t.y);
            }
            mark();
          },
        });
        if (!ok) { champ.removeBuff('zed_r_untargetable'); killShadow(champ, s); return false; }
        game.fx.custom('zed_r_dash', { unit: champ, target: t, duration: R_DASH, x: s.x, y: s.y });
        ab.setRecast(R_SHADOW_DUR, { cooldownOnExpire: false, onExpire: () => { ab.state.shadow = null; } });
      },
      recast(champ, ctx) {
        const ab = ctx.ability;
        const s = ab.state.shadow;
        if (champ.dashState) return false;
        if (!s || !s.alive) { ab.endRecast(false); return false; }
        if (!swapWith(champ, s)) return false;
        ab.endRecast(false);
        return true;
      },
      update(champ, ab) {
        if (ab.isRecastActive && (!ab.state.shadow || !ab.state.shadow.alive)) ab.endRecast(false);
      },
      ai: {
        kind: 'execute', range: R_RANGE,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, zedRPop(champ, rank, 300), 'physical') : zedRPop(champ, rank, 300)),
        custom: (champ, ab, ai, game) => {
          const c = aiCtx(ai);
          const hp = aiHp(ai, champ);
          // —— 换位回 R 分身：残血脱身 ——
          if (ab.isRecastActive) {
            const s = ab.state.shadow;
            if (!s || !s.alive || champ.dashState || champ.untargetable) return false;
            const here = minDistToEnemies(game, champ, champ.x, champ.y);
            const there = minDistToEnemies(game, champ, s.x, s.y);
            if ((hp < 0.3 || c === 'escape') && there > here + 200 && !aiUnderTurret(ai, champ, s.x, s.y)) return !!champ.castAbility('R').ok;
            return false;
          }
          if (!ab.ready) return false;
          if (c !== null && c !== 'fight') return false;
          if (hp < 0.3) return false;
          const t = aiTarget(ai, champ, R_RANGE);
          if (!t || champ.distTo(t) > R_RANGE + t.radius) return false;
          if (!ai?.diving && aiUnderTurret(ai, champ, t.x, t.y) && hp < 0.75) return false;
          const est = comboEstimate(champ, t);
          const foes = aiEnemies(ai, champ, 1200).length;
          if (est >= (t.hp + t.totalShield) * 0.85 || (t.hp / t.maxHp < 0.55 && foes <= 2)) return aiCastOn(ai, champ, 'R', t);
          return false;
        },
      },
    },
  },

  ai: { skillOrder: ['Q', 'E', 'W'], style: 'assassin', engageRange: 650, kiteDistance: 0, combo: ['R', 'W', 'E', 'Q'] },
};

