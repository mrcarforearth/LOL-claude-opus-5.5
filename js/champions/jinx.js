// 英雄：金克丝（暴走萝莉）—— 罪恶快感、枪炮交响曲、震荡电磁波、嚼火者手雷、超究极死神飞弹！
import { rv, fmt, pct, scaleText, predictPosition } from './_common.js';
import { clamp } from '../core/math.js';
import { mitigate } from '../core/damage.js';
import { MAP_SIZE } from '../config.js';

// —— 数值表（LoL 当前版本附近） ——
const P_MS = 1.75;                                   // 罪恶快感：+175% 移速（6 秒内递减）
const P_DUR = 6;
const P_AS = 0.25;
const P_WINDOW = 3;                                  // 3 秒内造成过伤害的击杀/推塔
const Q_CD = 0.9;
const Q_REV_TOTAL = [0.30, 0.50, 0.70, 0.90, 1.10];  // 砰砰：3 层共计攻速加成
const Q_REV_STACKS = 3;
const Q_REV_DUR = 2.5;
const Q_REV_DECAY = 0.75;                            // 之后每 0.75 秒失去一层
const Q_ROCKET_RANGE = [80, 100, 120, 140, 160];
const Q_ROCKET_COST = 20;
const Q_ROCKET_MULT = 1.1;
const Q_SPLASH = 250;
const Q_ROCKET_AS = 0.9;                             // 鱼骨头攻速 -10%
const MINIGUN_SPEED = 2750;
const ROCKET_SPEED = 2000;
const W_BASE = [10, 60, 110, 160, 210];
const W_AD = 1.6;
const W_SLOW = [0.30, 0.40, 0.50, 0.60, 0.70];
const W_SLOW_DUR = 2;
const W_RANGE = 1450;
const W_WIDTH = 60;
const W_SPEED = 3300;
const W_CAST_MAX = 0.6;
const W_CAST_MIN = 0.4;
const E_BASE = [70, 120, 170, 220, 270];
const E_AP = 1.0;
const E_ROOT = 1.5;
const E_RANGE = 900;
const E_SPACING = 165;                               // 三个手雷的间距（垂直于施法方向）
const E_TRIGGER = 70;
const E_BLAST = 150;
const E_ARM = 0.5;
const E_DUR = 5;
const R_BASE = [250, 400, 550];
const R_BONUS_AD = 1.5;
const R_MISSING = [0.25, 0.30, 0.35];
const R_MIN_PCT = 0.1;
const R_FULL_DIST = 1500;
const R_SPLASH = 225;
const R_SPLASH_PCT = 0.8;
const R_SPEED0 = 1700;
const R_SPEED1 = 2200;
const R_ACCEL_AT = 1350;
const R_WIDTH = 140;
const R_CAST = 0.6;

const PINK = 0xff5ab4;
const ZAP_COLOR = 0x7ad8ff;
const UNIT_TYPES = new Set(['champion', 'minion', 'monster', 'pet']);
const BULLET_VFX = { kind: 'jinx_bullet', fallback: 'bullet', color: 0xffd35a, size: 0.8, trail: true };
const ROCKET_VFX = { kind: 'jinx_rocket', fallback: 'rocket', color: 0xff6a9a, size: 1.2, trail: true };
const W_VFX = { kind: 'jinx_zap', fallback: 'bolt', color: ZAP_COLOR, size: 1.2, trail: true };
const R_VFX = { kind: 'jinx_r_rocket', fallback: 'rocket', color: 0xff4a7a, size: 2.4, trail: true };

const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('狂', '#ff9ad8', '#7a1a5a'),
  Q: icon('枪', '#8ab8ff', '#2a2a7a'),
  QR: icon('炮', '#ff8ab0', '#6a1a3a'),
  W: icon('电', '#9af0ff', '#1a4a8a'),
  E: icon('雷', '#ffb86a', '#8a2a10'),
  R: icon('弹', '#ff6a8a', '#5a0a2a'),
};

// —— 公式 ——
export function jinxRevPerStack(rank) { return rv(Q_REV_TOTAL, rank) / Q_REV_STACKS; }
export function jinxWCastTime(champ) { return Math.max(W_CAST_MIN, W_CAST_MAX - 0.2 * Math.max(0, champ?.stats?.bonusAS || 0)); }
export function jinxWDamage(champ, rank) { return rv(W_BASE, rank) + W_AD * champ.stats.ad; }
export function jinxEDamage(champ, rank) { return rv(E_BASE, rank) + E_AP * champ.stats.ap; }
// R 伤害：（基础 + 150% 额外 AD）×（10% + 90% × 飞行距离/1500）+ 目标已损失生命百分比
export function jinxRDamage(champ, target, rank, traveled) {
  const mult = R_MIN_PCT + (1 - R_MIN_PCT) * clamp(traveled / R_FULL_DIST, 0, 1);
  const missing = target ? Math.max(0, target.maxHp - target.hp) : 0;
  return (rv(R_BASE, rank) + R_BONUS_AD * champ.stats.bonusAd) * mult + rv(R_MISSING, rank) * missing;
}
// R 飞行时间（1350 码后加速）
export function jinxRFlightTime(d) {
  if (d <= R_ACCEL_AT) return d / R_SPEED0;
  return R_ACCEL_AT / R_SPEED0 + (d - R_ACCEL_AT) / R_SPEED1;
}
function edgeDistance(x, y, dx, dy) {
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (MAP_SIZE - x) / dx); else if (dx < -1e-6) t = Math.min(t, -x / dx);
  if (dy > 1e-6) t = Math.min(t, (MAP_SIZE - y) / dy); else if (dy < -1e-6) t = Math.min(t, -y / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}
function enemyUnit(champ, u) {
  return !!u && u.alive && !u.removed && !u.untargetable && !u.invulnerable && UNIT_TYPES.has(u.type) && u.team !== champ.team;
}

// —— 武器切换 ——
function setWeapon(champ, weapon) {
  const rocket = weapon === 'rocket';
  champ.modelState.weapon = rocket ? 'rocket' : 'minigun';
  champ.baseStats.attackVfx = rocket ? ROCKET_VFX : BULLET_VFX;
  champ.baseStats.missileSpeed = rocket ? ROCKET_SPEED : MINIGUN_SPEED;
  const ab = champ.abilities?.Q;
  if (ab) ab.toggled = rocket;
  if (rocket) {
    champ.addBuff({
      id: 'jinx_q_fishbones', name: '鱼骨头', desc: '火箭发射器：射程提升，普攻消耗法力并造成范围伤害', icon: ICONS.QR, source: champ,
      duration: Infinity, persistOnDeath: true,
      statsFn: (u) => ({ attackRange: rv(Q_ROCKET_RANGE, u.abilities.Q.rank) }),
    });
  } else {
    champ.removeBuff('jinx_q_fishbones');
  }
}

// 砰砰：叠加攻速
function addRevStack(champ) {
  const now = champ.game.time;
  const b = champ.getBuff('jinx_q_rev');
  if (b) { b.addStacks(1); b.data.decayAt = now + Q_REV_DUR; return b; }
  return champ.addBuff({
    id: 'jinx_q_rev', name: '砰砰：火力全开', desc: '攻击速度提升', icon: ICONS.Q, source: champ,
    duration: Infinity, removeOnDeath: true, stacks: 1, maxStacks: Q_REV_STACKS, data: { decayAt: now + Q_REV_DUR },
    statsFn: (u, bf) => (u.modelState.weapon === 'rocket' ? null : { attackSpeed: jinxRevPerStack(u.abilities.Q.rank) * bf.stacks }),
    // 层数逐层衰减
    onTick: (u, bf) => {
      if (u.game.time < bf.data.decayAt) return;
      bf.stacks--;
      bf.data.decayAt = u.game.time + Q_REV_DECAY;
      if (bf.stacks <= 0) u.removeBuff(bf);
    },
  });
}

// 罪恶快感
function getExcited(champ) {
  const game = champ.game;
  champ.addBuff({
    id: 'jinx_p_excited', name: '罪恶快感', desc: `移动速度大幅提升（${P_DUR} 秒内递减），攻击速度提升 ${pct(P_AS)}，可突破攻速上限`, icon: ICONS.P, source: champ,
    duration: P_DUR, refresh: 'replace',
    statsFn: (u, b) => ({ moveSpeedPct: P_MS * Math.max(0, 1 - b.elapsed / P_DUR), attackSpeed: P_AS }),
    onApply: (u) => { u.modelState.excited = true; },
    onRemove: (u) => { u.modelState.excited = false; },
  });
  game.fx.custom('jinx_excited', { unit: champ, duration: P_DUR });
  game.fx.attach({ unit: champ, kind: 'haste', color: PINK, duration: P_DUR });
}

// E：三个手雷一起爆炸
function detonateChompers(champ, zone, rank) {
  const game = champ.game;
  const d = zone.data;
  if (d.exploded) return;
  d.exploded = true;
  const dmg = jinxEDamage(champ, rank);
  const hit = new Set();
  for (const c of d.chompers) {
    c.exploded = true;
    const victims = game.queryUnits({ x: c.x, y: c.y, radius: E_BLAST, enemyOf: champ, types: ['champion'] });
    for (const u of victims) {
      if (hit.has(u) || u.untargetable) continue;
      hit.add(u);
      game.dealDamage(champ, u, dmg, 'magic', { isAbility: true, isAoE: true, spell: 'jinx_e' });
      if (u.alive) u.applyCC('root', E_ROOT, { source: champ });
    }
    game.fx.custom('jinx_chomper_blast', { x: c.x, y: c.y, radius: E_BLAST });
  }
  zone.remove();
}

// —— AI 辅助（ai 接口全部可选链保护） ——
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
  if (typeof ai?.castAt === 'function' && ai.castAt.length !== 5) return castOk(ai.castAt(slot, x, y));
  return castOk(champ.castAbility(slot, { x, y }));
}
function aiCastSelf(ai, champ, slot) {
  if (typeof ai?.castSelf === 'function') return castOk(ai.castSelf(slot));
  return castOk(champ.castAbility(slot, {}));
}
function canPay(champ, ab) { return ab.costType === 'none' || !(ab.cost > 0) || champ.mana >= ab.cost; }
function hardCCd(u) { return !!(u.hasCC?.('stun') || u.hasCC?.('root') || u.hasCC?.('airborne') || u.hasCC?.('suppress') || u.hasCC?.('sleep')); }
function focusChampion(champ, ai, radius) {
  const t = ai?.target;
  if (t && t.alive && t.type === 'champion' && t.team !== champ.team && t.isTargetableBy?.(champ) && champ.distTo(t) <= radius) return t;
  return visibleEnemyChamps(champ, ai, radius)[0] || null;
}

// Q：按局势选择武器（打线机枪、够不到/团战溅射切火箭、拆塔机枪）
function desiredWeapon(champ, ab, game, ai) {
  const baseRange = champ.baseStats.range;
  const bonus = rv(Q_ROCKET_RANGE, ab.rank);
  const lowMana = champ.mana < Q_ROCKET_COST * 2;
  const foe = focusChampion(champ, ai, baseRange + bonus + 450);
  if (foe) {
    if (lowMana) return 'minigun';
    const edge = champ.distTo(foe) - champ.radius - foe.radius;
    if (edge > baseRange + 15 && edge <= baseRange + bonus + 90) return 'rocket';
    const clump = game.queryUnits({ x: foe.x, y: foe.y, radius: Q_SPLASH, enemyOf: champ, types: ['champion'] }).length;
    if (clump >= 2 && edge <= baseRange + bonus) return 'rocket';
    if (edge <= baseRange - 40) return 'minigun';
    return null;
  }
  const at = champ.attackTarget;
  if (at && at.alive && at.isStructure) return 'minigun';
  const manaPct = champ.maxMana > 0 ? champ.mana / champ.maxMana : 0;
  if (manaPct > 0.6) {
    const minions = game.queryUnits({ x: champ.x, y: champ.y, radius: baseRange + bonus + 150, enemyOf: champ, targetableBy: champ, types: ['minion', 'monster'] });
    if (minions.length >= 4) {
      const c = minions[0];
      if (minions.filter((m) => m.distTo(c) <= Q_SPLASH).length >= 3) return 'rocket';
    }
  }
  return 'minigun';
}
function qAI(champ, ab, ai, game) {
  if (!ab.ready || ab.rank <= 0 || champ.castLock > 0) return false;
  if (game.time < (ab.state.aiSwapAt ?? 0)) return false;
  const want = desiredWeapon(champ, ab, game, ai);
  const cur = champ.modelState.weapon === 'rocket' ? 'rocket' : 'minigun';
  if (!want || want === cur) return false;
  ab.state.aiSwapAt = game.time + 1.6;
  return aiCastSelf(ai, champ, 'Q');
}

// W：路径无小兵阻挡时预判命中敌方英雄
function wAI(champ, ab, ai, game) {
  if (!ab.ready || ab.rank <= 0 || champ.castLock > 0 || !canPay(champ, ab)) return false;
  const target = focusChampion(champ, ai, W_RANGE - 60);
  if (!target) return false;
  const d = champ.distTo(target);
  const p = hardCCd(target) ? { x: target.x, y: target.y } : predictAt(ai, target, jinxWCastTime(champ) + d / W_SPEED);
  if (Math.hypot(p.x - champ.x, p.y - champ.y) > W_RANGE - 30) return false;
  const blockers = game.queryLine({
    x1: champ.x, y1: champ.y, x2: p.x, y2: p.y, width: W_WIDTH, enemyOf: champ, types: ['minion', 'monster', 'pet'],
    filter: (u) => !u.untargetable,
  });
  if (blockers.length) return false;
  // 保留大招法力
  const R = champ.abilities.R;
  if (R.rank > 0 && R.ready && champ.mana - ab.cost < R.cost && target.hp / target.maxHp > 0.4) return false;
  return aiCastPoint(ai, champ, 'W', p.x, p.y);
}

// E：被贴脸时自保、对被控/被减速的敌人连控
function eAI(champ, ab, ai, game) {
  if (!ab.ready || ab.rank <= 0 || champ.castLock > 0 || !canPay(champ, ab)) return false;
  const foes = visibleEnemyChamps(champ, ai, E_RANGE + 80);
  if (!foes.length) return false;
  const myHp = champ.hp / champ.maxHp;
  for (const e of foes) {
    const d = champ.distTo(e);
    if (d < 430 && (myHp < 0.75 || (e.stats.attackRange || 0) < 300)) {
      const k = 0.6;
      return aiCastPoint(ai, champ, 'E', champ.x + (e.x - champ.x) * k, champ.y + (e.y - champ.y) * k);
    }
    if (d <= E_RANGE && (hardCCd(e) || (e.strongestSlow?.() || 0) >= 0.3)) {
      const p = hardCCd(e) ? { x: e.x, y: e.y } : predictAt(ai, e, E_ARM + 0.1);
      if (Math.hypot(p.x - champ.x, p.y - champ.y) <= E_RANGE + 50) return aiCastPoint(ai, champ, 'E', p.x, p.y);
    }
  }
  return false;
}

// R：全图斩杀残血，或团战中命中聚集的敌人
function rAI(champ, ab, ai, game) {
  if (!ab.ready || ab.rank <= 0 || champ.castLock > 0 || !canPay(champ, ab)) return false;
  const enemies = visibleEnemyChamps(champ, ai, 20000);
  if (!enemies.length) return false;
  let best = null;
  for (const e of enemies) {
    if (!e.alive || e.untargetable) continue;
    const d = champ.distTo(e);
    if (d < 350) continue; // 近距离伤害太低
    const locked = hardCCd(e);
    const t = R_CAST + jinxRFlightTime(d);
    const p = locked ? { x: e.x, y: e.y } : predictAt(ai, e, t);
    const dd = Math.hypot(p.x - champ.x, p.y - champ.y);
    if (dd > 9000 && !locked) continue;
    const dmg = mitigate(champ, e, jinxRDamage(champ, e, ab.rank, dd), 'physical');
    const ehp = e.hp + (e.totalShield || 0) + (e.stats.hpRegen || 0) * t;
    const kill = dmg >= ehp * 1.03;
    const clump = game.queryUnits({ x: p.x, y: p.y, radius: R_SPLASH, enemyOf: champ, types: ['champion'] }).length;
    const teamfight = clump >= 3 && dd < 2600;
    if (!kill && !teamfight) continue;
    // 队友近身且目标几乎必死时不抢
    const alliesOn = game.champions.filter((a) => a.alive && a.team === champ.team && a !== champ && a.distTo(e) < 500).length;
    if (kill && !teamfight && alliesOn >= 2 && e.hp / e.maxHp < 0.1) continue;
    const block = game.queryLine({
      x1: champ.x, y1: champ.y, x2: p.x, y2: p.y, width: R_WIDTH, enemyOf: champ, types: ['champion'],
      filter: (u) => u !== e && !u.untargetable && Math.hypot(u.x - champ.x, u.y - champ.y) < dd,
    });
    if (block.length && !teamfight) continue;
    const score = (kill ? 2 : 0) + clump + (locked ? 0.5 : 0);
    if (!best || score > best.score) best = { score, p };
  }
  if (!best) return false;
  return aiCastPoint(ai, champ, 'R', best.p.x, best.p.y);
}

export default {
  id: 'jinx',
  name: '金克丝',
  title: '暴走萝莉',
  roles: ['adc'],
  tags: ['射手'],
  difficulty: 2,
  lore: '祖安的疯狂罪犯，热衷于制造混乱与爆炸，她的机枪「砰砰」和火箭筒「鱼骨头」让皮尔特沃夫头疼不已。',
  baseStats: {
    hp: 630, hpPerLevel: 105, hpRegen: 3.75, hpRegenPerLevel: 0.5,
    mana: 260, manaPerLevel: 50, manaRegen: 6.7, manaRegenPerLevel: 1, resource: 'mana',
    ad: 59, adPerLevel: 3.15, as: 0.625, asRatio: 0.625, asPerLevel: 1.4,
    armor: 26, armorPerLevel: 4.7, mr: 30, mrPerLevel: 1.3,
    ms: 325, range: 525, radius: 65, windup: 0.17, missileSpeed: MINIGUN_SPEED, critMult: 1.75,
    attackVfx: BULLET_VFX,
  },
  model: { primary: 0x3a6ad8, secondary: 0xe85aa8, accent: 0x5ad8ff },
  portrait: { bg: ['#4a7ae8', '#2a0a2a'], glyph: '金' },

  // —— 被动：罪恶快感 ——
  passive: {
    id: 'jinx_passive',
    name: '罪恶快感',
    icon: ICONS.P,
    desc: () => `金克丝在 ${P_WINDOW} 秒内对其造成过伤害的敌方英雄被击杀，或防御塔/召唤水晶/水晶枢纽被摧毁时，她会变得兴奋起来：\n`
      + `获得 ${pct(P_MS)} 移动速度（在 ${P_DUR} 秒内逐渐衰减）和 ${pct(P_AS)} 攻击速度，期间攻击速度可以突破上限。`,
    init(champ) {
      const st = champ.passive.state;
      const game = champ.game;
      st.hitLog = new Map();
      st.pruneAt = 0;
      champ.modelState.weapon = 'minigun';
      // 记录对敌方英雄/建筑造成伤害的时间
      champ.addHook('afterDealDamage', (ctx) => {
        const t = ctx.target;
        if (!t || t.team === champ.team || !(ctx.dealt > 0)) return;
        if (t.type === 'champion' || t.isStructure) st.hitLog.set(t, game.time);
      });
      const onDeath = (unit) => {
        if (!unit || unit === champ || unit.team === champ.team || !champ.alive) return;
        if (!(unit.type === 'champion' || unit.isStructure)) return;
        const at = st.hitLog.get(unit);
        if (at == null || game.time - at > P_WINDOW + 1e-6) return;
        st.hitLog.delete(unit);
        getExcited(champ);
      };
      game.events.on('death', (e) => onDeath(e?.unit));
      game.events.on('structureDestroyed', (e) => onDeath(e?.structure));
      // 鱼骨头攻速 -10%；罪恶快感期间攻速可突破上限
      champ.addHook('modifyStats', (s) => {
        if (champ.hasBuff('jinx_p_excited')) {
          const bs = champ.baseStats;
          s.attackSpeed = Math.max(0.2, bs.as + bs.asRatio * s.bonusAS);
        }
        if (champ.modelState.weapon === 'rocket') s.attackSpeed *= Q_ROCKET_AS;
      });
    },
    update(champ) {
      const st = champ.passive.state;
      const now = champ.game.time;
      if (now < st.pruneAt) return;
      st.pruneAt = now + 5;
      for (const [u, t] of st.hitLog) if (now - t > P_WINDOW || u.removed) st.hitLog.delete(u);
    },
  },

  abilities: {
    // —— Q：枪炮交响曲 ——
    Q: {
      id: 'jinx_q',
      name: '枪炮交响曲',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const cur = champ?.modelState?.weapon === 'rocket' ? '鱼骨头' : '砰砰';
        return `金克丝在两把武器之间切换（当前：${cur}）。\n`
          + `「砰砰」（轻机枪）：普攻提供 ${pct(jinxRevPerStack(r))} 攻击速度，持续 ${Q_REV_DUR} 秒，最多叠加 ${Q_REV_STACKS} 层（共 ${pct(rv(Q_REV_TOTAL, r))}），层数逐层衰减。\n`
          + `「鱼骨头」（火箭发射器）：普攻射程 +${rv(Q_ROCKET_RANGE, r)}，每次普攻消耗 ${Q_ROCKET_COST} 法力，造成 ${pct(Q_ROCKET_MULT)} 伤害，`
          + `并对目标周围 ${Q_SPLASH} 码内的敌人造成同等伤害；攻击速度降低 ${pct(1 - Q_ROCKET_AS)}。`;
      },
      cooldown: [Q_CD, Q_CD, Q_CD, Q_CD, Q_CD],
      cost: [0, 0, 0, 0, 0],
      costType: 'none',
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: 525 },
      castTime: 0,
      lockMovement: false,
      sfx: 'buff',
      onLearn(champ) {
        champ.addHook('onAttackLaunch', (target, hit) => {
          if (champ.modelState.weapon === 'rocket') {
            // 法力不足时火箭不会爆炸溅射
            if (champ.mana >= Q_ROCKET_COST) {
              champ.mana -= Q_ROCKET_COST;
              hit.jinxRocket = true;
            }
          } else {
            addRevStack(champ);
          }
        });
        champ.addHook('onHit', (target, hit) => {
          if (hit.jinxRocket) hit.damage *= Q_ROCKET_MULT;
        });
        champ.addHook('afterHit', (target, hit) => {
          if (!hit.jinxRocket) return;
          const game = champ.game;
          const splash = game.queryUnits({ x: target.x, y: target.y, radius: Q_SPLASH, enemyOf: champ, exclude: target }).filter((u) => !u.untargetable);
          for (const u of splash) {
            if (u.alive) game.dealDamage(champ, u, hit.damage, 'physical', { isAoE: true, spell: 'jinx_q_rocket' });
          }
          game.fx.custom('jinx_rocket_blast', { x: target.x, y: target.y, radius: Q_SPLASH });
        });
      },
      cast(champ) {
        const next = champ.modelState.weapon === 'rocket' ? 'minigun' : 'rocket';
        setWeapon(champ, next);
        champ.game.fx.custom('jinx_q_swap', { unit: champ, weapon: next });
      },
      ai: { kind: 'toggle', custom: qAI },
    },

    // —— W：震荡电磁波 ——
    W: {
      id: 'jinx_w',
      name: '震荡电磁波',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `金克丝使用电击枪蓄力 ${fmt(jinxWCastTime(champ), 2)} 秒（随额外攻击速度缩短，最低 ${W_CAST_MIN} 秒），然后射出一道电磁波，`
          + `对命中的第一个敌人造成 ${scaleText(champ, rv(W_BASE, r), [[W_AD, 'ad']])} 点物理伤害，减速 ${pct(rv(W_SLOW, r))}，持续 ${W_SLOW_DUR} 秒，并显形该目标。射程 ${W_RANGE}。`;
      },
      cooldown: [8, 7, 6, 5, 4],
      cost: [50, 55, 60, 65, 70],
      range: W_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: W_WIDTH * 2, length: W_RANGE },
      castTime: (champ) => jinxWCastTime(champ),
      lockMovement: true,
      sfx: 'electric',
      onCastStart(champ, ctx) {
        champ.game.fx.custom('jinx_w_charge', { unit: champ, duration: jinxWCastTime(champ), dirX: ctx.dirX, dirY: ctx.dirY });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const dmg = jinxWDamage(champ, rank);
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, range: W_RANGE, speed: W_SPEED, width: W_WIDTH,
          hits: 'first', height: 110, vfx: W_VFX,
          canHit: (u) => enemyUnit(champ, u),
          onHit: (u) => {
            game.dealDamage(champ, u, dmg, 'physical', { isAbility: true, spell: 'jinx_w' });
            if (u.alive) {
              u.slow(rv(W_SLOW, rank), W_SLOW_DUR, champ);
              u.revealedUntil = Math.max(u.revealedUntil || 0, game.time + W_SLOW_DUR);
              game.vision?.addRevealer?.({ team: champ.team, follow: u, radius: 120, duration: W_SLOW_DUR, trueSight: true, seeBrush: true });
              u.addBuff({ id: 'jinx_w_zap', name: '震荡电磁波', desc: '被减速并显形', icon: ICONS.W, source: champ, duration: W_SLOW_DUR, isDebuff: true });
            }
            game.fx.custom('jinx_zap_hit', { x: u.x, y: u.y, target: u, duration: W_SLOW_DUR });
            return true;
          },
        });
      },
      ai: {
        kind: 'nuke', range: W_RANGE - 60, width: W_WIDTH, speed: W_SPEED, delay: 0.55,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, jinxWDamage(champ, rank), 'physical') : jinxWDamage(champ, rank)),
        custom: wAI,
      },
    },

    // —— E：嚼火者手雷 ——
    E: {
      id: 'jinx_e',
      name: '嚼火者手雷',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `金克丝向目标地点扔出 3 个嚼火者手雷（垂直于施法方向排开），${E_ARM} 秒后激活，持续 ${E_DUR} 秒。\n`
          + `敌方英雄踩到手雷时，手雷全部爆炸，对附近的敌方英雄造成 ${scaleText(champ, rv(E_BASE, r), [[E_AP, 'ap']])} 点魔法伤害并禁锢 ${E_ROOT} 秒。`;
      },
      cooldown: [24, 21.5, 19, 16.5, 14],
      cost: [90, 90, 90, 90, 90],
      range: E_RANGE,
      targeting: 'point',
      indicator: { type: 'circle', radius: E_SPACING + E_TRIGGER },
      castTime: 0,
      lockMovement: false,
      sfx: 'whoosh',
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const px = -ctx.dirY, py = ctx.dirX;
        const chompers = [-1, 0, 1].map((k) => {
          let x = ctx.x + px * k * E_SPACING, y = ctx.y + py * k * E_SPACING;
          if (!game.nav.isWalkable(x, y)) { const p = game.nav.nearestWalkable(x, y, 300); x = p.x; y = p.y; }
          return { x, y, exploded: false };
        });
        const zone = game.spawnZone({
          owner: champ, x: ctx.x, y: ctx.y, radius: E_SPACING + E_TRIGGER + 20, duration: E_DUR, delay: E_ARM,
          tickInterval: 0, filter: 'enemy', types: ['champion'], vfx: null,
          data: { chompers, exploded: false, armed: false },
          onStart: (z) => { z.data.armed = true; },
          onTick: (z, units) => {
            if (z.data.exploded) return;
            for (const u of units) {
              for (const c of z.data.chompers) {
                if (Math.hypot(u.x - c.x, u.y - c.y) <= E_TRIGGER + u.radius) { detonateChompers(champ, z, rank); return; }
              }
            }
          },
        });
        game.fx.custom('jinx_chompers', {
          zone, chompers, x: ctx.x, y: ctx.y, fromX: champ.x, fromY: champ.y, armTime: E_ARM, duration: E_ARM + E_DUR, team: champ.team,
        });
      },
      ai: {
        kind: 'cc', range: E_RANGE, radius: E_SPACING + E_TRIGGER, delay: E_ARM,
        damage: (champ, target, rank) => (target ? mitigate(champ, target, jinxEDamage(champ, rank), 'magic') : jinxEDamage(champ, rank)),
        custom: eAI,
      },
    },

    // —— R：超究极死神飞弹！ ——
    R: {
      id: 'jinx_r',
      name: '超究极死神飞弹！',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `金克丝发射一枚全图飞行的超级火箭（${R_ACCEL_AT} 码后加速），命中第一个敌方英雄时爆炸，造成 ${scaleText(champ, rv(R_BASE, r), [[R_BONUS_AD, 'bonusAd']])} 点物理伤害`
          + `（在飞行的前 ${R_FULL_DIST} 码内从 ${pct(R_MIN_PCT)} 提升至 100%），外加目标已损失生命值 ${pct(rv(R_MISSING, r))} 的物理伤害。\n`
          + `目标周围 ${R_SPLASH} 码内的敌方英雄受到 ${pct(R_SPLASH_PCT)} 的伤害。`;
      },
      cooldown: [90, 75, 60],
      cost: [100, 100, 100],
      range: 25000,
      clampRange: false,
      targeting: 'direction',
      indicator: { type: 'line', width: R_WIDTH * 2, length: 3000 },
      castTime: R_CAST,
      lockMovement: true,
      sfx: 'explosion',
      onCastStart(champ, ctx) {
        champ.game.fx.custom('jinx_r_cast', { unit: champ, duration: R_CAST, dirX: ctx.dirX, dirY: ctx.dirY });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const rank = ctx.rank;
        const range = edgeDistance(champ.x, champ.y, ctx.dirX, ctx.dirY);
        if (range < 50) return false;
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, range, speed: R_SPEED0, width: R_WIDTH,
          hits: 'first', height: 150, maxAge: jinxRFlightTime(range) + 2, vfx: R_VFX, data: { accel: false },
          canHit: (u) => u.type === 'champion' && enemyUnit(champ, u),
          onUpdate: (p) => {
            if (!p.data.accel && p.traveled >= R_ACCEL_AT) { p.data.accel = true; p.speed = R_SPEED1; }
          },
          onHit: (u, p) => {
            const traveled = p.traveled;
            const splash = game.queryUnits({ x: u.x, y: u.y, radius: R_SPLASH, enemyOf: champ, types: ['champion'], exclude: u })
              .filter((o) => !o.untargetable)
              .map((o) => ({ o, dmg: jinxRDamage(champ, o, rank, traveled) * R_SPLASH_PCT }));
            const dmg = jinxRDamage(champ, u, rank, traveled);
            game.dealDamage(champ, u, dmg, 'physical', { isAbility: true, spell: 'jinx_r' });
            for (const s of splash) if (s.o.alive) game.dealDamage(champ, s.o, s.dmg, 'physical', { isAbility: true, isAoE: true, spell: 'jinx_r' });
            game.fx.custom('jinx_r_blast', { x: u.x, y: u.y, radius: R_SPLASH });
            return true;
          },
        });
      },
      ai: {
        kind: 'global', range: 9000, width: R_WIDTH, speed: R_SPEED0, delay: R_CAST,
        damage: (champ, target, rank) => {
          const d = target ? champ.distTo(target) : R_FULL_DIST;
          const raw = jinxRDamage(champ, target, rank, d);
          return target ? mitigate(champ, target, raw, 'physical') : raw;
        },
        custom: rAI,
      },
    },
  },

  ai: { skillOrder: ['Q', 'W', 'E'], style: 'marksman', engageRange: 650, kiteDistance: 500, combo: ['W', 'E', 'Q', 'R'] },
};
