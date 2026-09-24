// 英雄共享辅助函数：等级取值、文字格式、弹道/范围伤害封装、目标查询、延迟回调、临时英雄生成器
import { clamp, angleDiff as _angleDiff, norm } from '../core/math.js';

// —— 取值与格式 ——
// 取技能等级数值：rank 从 1 开始；rank<=0 按 1 级；也接受常量/函数
export function rv(arr, rank) {
  if (typeof arr === 'function') return arr(rank);
  if (!Array.isArray(arr)) return arr ?? 0;
  if (arr.length === 0) return 0;
  return arr[clamp((rank || 1) - 1, 0, arr.length - 1)];
}
// 数字格式化：整数去小数，其余保留 digits 位并去掉末尾 0
export function fmt(n, digits = 1) {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return String(Number(n.toFixed(digits)));
}
export function pct(n, digits = 1) { return `${fmt(n * 100, digits)}%`; }
// 等级数组文本：30/60/90/120/150
export function listText(arr, mult = 1, suffix = '') { return (Array.isArray(arr) ? arr : [arr]).map((v) => fmt(v * mult) + suffix).join('/'); }

export const STAT_NAMES = {
  ad: '攻击力', bonusAd: '额外攻击力', baseAd: '基础攻击力', ap: '法术强度', maxHp: '最大生命值', bonusHp: '额外生命值',
  armor: '护甲', bonusArmor: '额外护甲', mr: '魔法抗性', bonusMr: '额外魔法抗性', maxMana: '最大法力值', missingHp: '已损失生命值',
  targetMaxHp: '目标最大生命值', targetMissingHp: '目标已损失生命值', targetCurrentHp: '目标当前生命值', bonusAS: '额外攻击速度', level: '等级',
};
// 读取英雄某项属性（含派生项）
export function statOf(champ, stat) {
  if (!champ || !champ.stats) return 0;
  if (stat === 'missingHp') return champ.stats.maxHp - champ.hp;
  if (stat === 'level') return champ.level;
  return champ.stats[stat] ?? 0;
}
// 带加成的数值文本：scaleText(champ, 60, [[0.5, 'ad']]) → "94（60 +50% 攻击力）"
export function scaleText(champ, base, ratios = []) {
  let total = base;
  const parts = [];
  for (const [ratio, stat] of ratios) {
    total += ratio * statOf(champ, stat);
    parts.push(`+${pct(ratio, 1)} ${STAT_NAMES[stat] || stat}`);
  }
  if (parts.length === 0) return fmt(total);
  return `${fmt(total)}（${fmt(base)} ${parts.join(' ')}）`;
}
// 计算基础 + 比例加成
export function scaled(champ, base, ratios = []) {
  let total = base;
  for (const [ratio, stat] of ratios) total += ratio * statOf(champ, stat);
  return total;
}

// —— 判定 ——
export function isChampion(u) { return !!u && u.type === 'champion'; }
export function isMinion(u) { return !!u && u.type === 'minion'; }
export function isMonster(u) { return !!u && u.type === 'monster'; }
export function isEpic(u) { return !!u && u.type === 'monster' && !!u.epic; }
export function isLargeMonster(u) { return !!u && u.type === 'monster' && u.large !== false; }
export function isStructure(u) { return !!u && (u.type === 'turret' || u.type === 'inhibitor' || u.type === 'nexus'); }
export function angleDiff(a, b) { return _angleDiff(a, b); }
export function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
export function dirTo(a, b) { return norm(b.x - a.x, b.y - a.y, { x: Math.cos(a.facing || 0), y: Math.sin(a.facing || 0) }); }
// 施法者前方某距离的点
export function pointAhead(champ, dirX, dirY, dist) { return { x: champ.x + dirX * dist, y: champ.y + dirY * dist }; }

// —— 伤害封装 ——
export function damage(champ, target, amount, type = 'physical', spell = null, opts = {}) {
  return champ.game.dealDamage(champ, target, amount, type, { isAbility: true, spell, ...opts });
}
export function physical(champ, target, amount, spell, opts) { return damage(champ, target, amount, 'physical', spell, opts); }
export function magic(champ, target, amount, spell, opts) { return damage(champ, target, amount, 'magic', spell, opts); }
export function trueDamage(champ, target, amount, spell, opts) { return damage(champ, target, amount, 'true', spell, opts); }

// 直线弹道：自动按 ctx 方向发射，命中时结算 damage（数值或 (unit, proj) => 数值）
export function skillshot(champ, opts = {}) {
  const game = champ.game;
  const ctx = opts.ctx || {};
  let dirX = opts.dirX ?? ctx.dirX, dirY = opts.dirY ?? ctx.dirY;
  const sx = opts.fromX ?? champ.x, sy = opts.fromY ?? champ.y;
  if ((dirX == null || dirY == null) && opts.x != null) {
    const d = norm(opts.x - sx, opts.y - sy);
    dirX = d.x; dirY = d.y;
  }
  if (dirX == null || dirY == null) { dirX = Math.cos(champ.facing); dirY = Math.sin(champ.facing); }
  const type = opts.type || 'magic';
  return game.spawnProjectile({
    owner: champ, x: sx, y: sy, dirX, dirY,
    range: opts.range ?? 1000, speed: opts.speed ?? 1600, width: opts.width ?? 60,
    hits: opts.hits || 'first', canHit: opts.canHit, collideWalls: opts.collideWalls, returnToOwner: opts.returnToOwner,
    vfx: opts.vfx || { kind: 'orb', color: 0xffffff, size: 1, trail: true }, height: opts.height ?? 100, data: opts.data || {},
    onUpdate: opts.onUpdate,
    onHit: (u, p) => {
      const amt = typeof opts.damage === 'function' ? opts.damage(u, p) : opts.damage;
      if (amt > 0) game.dealDamage(champ, u, amt, type, { isAbility: true, spell: opts.spell || null, isAoE: opts.hits === 'pierce' });
      return opts.onHit ? opts.onHit(u, p) : undefined;
    },
    onEnd: opts.onEnd,
  });
}

// 圆形范围伤害：返回命中的单位列表
export function aoeDamage(champ, { x = champ.x, y = champ.y, radius = 300, damage: dmg = 0, type = 'magic', spell = null, types, filter, exclude, onHit, targetableOnly = false } = {}) {
  const game = champ.game;
  const hits = game.queryUnits({ x, y, radius, enemyOf: champ, types, filter, exclude, targetableBy: targetableOnly ? champ : null });
  const out = [];
  for (const u of hits) {
    if (u.untargetable) continue;
    const amt = typeof dmg === 'function' ? dmg(u) : dmg;
    if (amt > 0) game.dealDamage(champ, u, amt, type, { isAbility: true, isAoE: true, spell });
    if (onHit) onHit(u);
    out.push(u);
  }
  return out;
}
// 扇形范围伤害
export function coneDamage(champ, { x = champ.x, y = champ.y, dirX, dirY, angle = 60, range = 500, damage: dmg = 0, type = 'physical', spell = null, types, filter, onHit } = {}) {
  const game = champ.game;
  const hits = game.queryCone({ x, y, dirX: dirX ?? Math.cos(champ.facing), dirY: dirY ?? Math.sin(champ.facing), angle, range, enemyOf: champ, types, filter });
  const out = [];
  for (const u of hits) {
    if (u.untargetable) continue;
    const amt = typeof dmg === 'function' ? dmg(u) : dmg;
    if (amt > 0) game.dealDamage(champ, u, amt, type, { isAbility: true, isAoE: true, spell });
    if (onHit) onHit(u);
    out.push(u);
  }
  return out;
}
// 矩形（线段）范围伤害
export function lineDamage(champ, { x1 = champ.x, y1 = champ.y, x2, y2, width = 80, damage: dmg = 0, type = 'physical', spell = null, types, filter, onHit } = {}) {
  const game = champ.game;
  const hits = game.queryLine({ x1, y1, x2, y2, width, enemyOf: champ, types, filter });
  const out = [];
  for (const u of hits) {
    if (u.untargetable) continue;
    const amt = typeof dmg === 'function' ? dmg(u) : dmg;
    if (amt > 0) game.dealDamage(champ, u, amt, type, { isAbility: true, isAoE: true, spell });
    if (onHit) onHit(u);
    out.push(u);
  }
  return out;
}

// —— 查询 ——
export function enemiesAround(champ, radius, opts = {}) {
  return champ.game.queryUnits({ x: opts.x ?? champ.x, y: opts.y ?? champ.y, radius, enemyOf: champ, targetableBy: champ, ...opts });
}
export function enemyChampionsAround(champ, radius, opts = {}) {
  return enemiesAround(champ, radius, { ...opts, types: ['champion'] });
}
export function alliesAround(champ, radius, opts = {}) {
  return champ.game.queryUnits({ x: opts.x ?? champ.x, y: opts.y ?? champ.y, radius, allyOf: champ, ...opts });
}
export function lowestHpAlly(champ, radius, { includeSelf = true } = {}) {
  let best = null;
  for (const c of champ.game.champions) {
    if (!c.alive || c.team !== champ.team || (!includeSelf && c === champ)) continue;
    if (champ.distTo(c) > radius) continue;
    if (!best || c.hp / c.maxHp < best.hp / best.maxHp) best = c;
  }
  return best;
}
export function nearestEnemyChampion(champ, radius) {
  return champ.game.nearest({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
}

// 延迟执行（模拟时间）
export function delay(game, seconds, fn) {
  if (game.after) return game.after(seconds, fn);
  return game.spawnZone({ owner: null, team: 2, x: 0, y: 0, radius: 0, delay: seconds, duration: 0, vfx: null, onStart: () => fn(game) });
}

// 预测目标 t 秒后的位置（按当前路径方向与移速）
export function predictPosition(target, t) {
  if (!target || !target.moving || !target.path || target.path.length === 0) return { x: target.x, y: target.y };
  const p = target.path[0];
  const d = norm(p.x - target.x, p.y - target.y);
  const dist = Math.min(Math.hypot(p.x - target.x, p.y - target.y), target.stats.moveSpeed * t);
  return { x: target.x + d.x * dist, y: target.y + d.y * dist };
}

// 目标已损失生命百分比
export function missingHpPct(u) { return u.maxHp > 0 ? 1 - u.hp / u.maxHp : 0; }

// —— 临时英雄生成器（通用但可用的四个技能） ——
// opts: { id, name, title, roles, tags, ranged, damageType: 'physical'|'magic', baseStats, model, portrait, lore, difficulty, ai }
export function makeStubChampion(opts) {
  const ranged = !!opts.ranged;
  const magicDmg = opts.damageType === 'magic';
  const type = magicDmg ? 'magic' : 'physical';
  const res = opts.baseStats?.resource || 'mana';
  const costs = (arr) => (res === 'none' ? [0, 0, 0, 0, 0] : res === 'energy' ? arr.map(() => 50) : arr);
  const ratioQ = magicDmg ? [[0.7, 'ap']] : [[0.8, 'bonusAd'], [0.3, 'baseAd']];
  const ratioE = magicDmg ? [[0.4, 'ap']] : [[0.5, 'bonusAd']];
  const ratioR = magicDmg ? [[0.8, 'ap']] : [[1.0, 'bonusAd']];
  const qRange = opts.qRange ?? (ranged ? 1000 : 700);
  const rRange = opts.rRange ?? (ranged ? 750 : 475);
  const color = opts.model?.accent ?? 0xffffff;
  const Q_BASE = [60, 95, 130, 165, 200];
  const E_BASE = [50, 80, 110, 140, 170];
  const R_BASE = [200, 325, 450];
  const W_BASE = [60, 90, 120, 150, 180];
  const typeText = magicDmg ? '魔法' : '物理';
  const glyph = (opts.name || '?')[0];
  const icon = (g, c1, c2) => ({ glyph: g, bg: [c1, c2], fg: '#fff' });
  const pid = opts.id;
  return {
    id: pid, name: opts.name, title: opts.title || '', roles: opts.roles || ['mid'], tags: opts.tags || [],
    difficulty: opts.difficulty ?? 2, lore: opts.lore || `${opts.name}（临时技能组）`,
    stub: true,
    baseStats: {
      radius: 65, windup: ranged ? 0.25 : 0.3, missileSpeed: ranged ? 1800 : 0,
      attackVfx: ranged ? { kind: magicDmg ? 'orb' : 'arrow', color, size: 0.8 } : null,
      ...opts.baseStats,
    },
    model: opts.model || { primary: 0x777777, secondary: 0xcccccc, accent: color },
    portrait: opts.portrait || { bg: ['#444', '#111'], glyph },
    passive: {
      id: `${pid}_p`, name: '战斗本能', icon: icon('本', '#888', '#333'),
      desc: () => '击杀或助攻敌方英雄后，3 秒内获得 20% 移动速度。',
      init(champ) {
        champ.addHook('onTakedown', (victim) => {
          if (victim.type === 'champion') champ.addBuff({ id: `${pid}_p_ms`, name: '战斗本能', duration: 3, stats: { moveSpeedPct: 0.2 } });
        });
      },
    },
    abilities: {
      Q: {
        id: `${pid}_q`, name: '冲击弹', icon: icon('弹', '#6aa8ff', '#1a2a5a'), maxRank: 5,
        desc: (champ, rank) => `向指定方向发射一道能量，对命中的第一个敌人造成 ${scaleText(champ, rv(Q_BASE, rank), ratioQ)} 点${typeText}伤害。`,
        cooldown: [7, 6.5, 6, 5.5, 5], cost: costs([50, 55, 60, 65, 70]), range: qRange,
        targeting: 'direction', indicator: { type: 'line', width: 120, length: qRange }, castTime: 0.25, lockMovement: true, sfx: 'magic',
        cast(champ, ctx) {
          const dmg = scaled(champ, rv(Q_BASE, ctx.rank), ratioQ);
          skillshot(champ, {
            ctx, range: qRange, speed: 1700, width: 60, type, spell: `${pid}_q`, damage: dmg,
            vfx: { kind: magicDmg ? 'orb' : 'bolt', color, size: 1.1, trail: true },
            onHit: (u) => { champ.game.fx.impact({ x: u.x, y: u.y, color, size: 1 }); },
          });
        },
        ai: { kind: 'nuke', range: qRange, width: 60, speed: 1700, delay: 0.25, farm: false },
      },
      W: {
        id: `${pid}_w`, name: '护体', icon: icon('护', '#ffe07a', '#6a4a10'), maxRank: 5,
        desc: (champ, rank) => `获得 ${scaleText(champ, rv(W_BASE, rank), magicDmg ? [[0.4, 'ap']] : [[0.15, 'bonusHp']])} 点护盾和 15% 移动速度，持续 2.5 秒。`,
        cooldown: [18, 17, 16, 15, 14], cost: costs([60, 65, 70, 75, 80]), range: 0,
        targeting: 'self', indicator: { type: 'self', radius: 120 }, castTime: 0, lockMovement: false, sfx: 'shield',
        cast(champ, ctx) {
          const amt = scaled(champ, rv(W_BASE, ctx.rank), magicDmg ? [[0.4, 'ap']] : [[0.15, 'bonusHp']]);
          champ.addShield(amt, 2.5, { source: champ, id: `${pid}_w` });
          champ.addBuff({ id: `${pid}_w_ms`, name: '护体', duration: 2.5, stats: { moveSpeedPct: 0.15 } });
          champ.game.fx.shield({ unit: champ, color: 0xffe07a, duration: 2.5, radius: 110 });
        },
        ai: { kind: 'shield' },
      },
      E: {
        id: `${pid}_e`, name: '突进', icon: icon('突', '#8af07a', '#1a5a20'), maxRank: 5,
        desc: (champ, rank) => `向指定位置突进 400 码，落地时对周围敌人造成 ${scaleText(champ, rv(E_BASE, rank), ratioE)} 点${typeText}伤害。`,
        cooldown: [14, 13, 12, 11, 10], cost: costs([50, 50, 50, 50, 50]), range: 400,
        targeting: 'point', indicator: { type: 'circle', radius: 200 }, castTime: 0, lockMovement: false, sfx: 'dash',
        cast(champ, ctx) {
          const dmg = scaled(champ, rv(E_BASE, ctx.rank), ratioE);
          return champ.dash({
            x: ctx.x, y: ctx.y, speed: 1400,
            onEnd: () => {
              aoeDamage(champ, { radius: 200, damage: dmg, type, spell: `${pid}_e` });
              champ.game.fx.ring({ x: champ.x, y: champ.y, radius: 200, color, duration: 0.4, expand: true });
            },
          });
        },
        ai: { kind: ranged ? 'escape' : 'gapclose', range: 400, radius: 200 },
      },
      R: {
        id: `${pid}_r`, name: '终极一击', icon: icon('终', '#ff7a5a', '#6a1a10'), maxRank: 3,
        desc: (champ, rank) => `对目标敌方英雄造成 ${scaleText(champ, rv(R_BASE, rank), ratioR)} 点${typeText}伤害。`,
        cooldown: [100, 85, 70], cost: res === 'none' ? [0, 0, 0] : res === 'energy' ? [0, 0, 0] : [100, 100, 100], range: rRange,
        targeting: 'unit', targetFilter: 'enemyChampion', indicator: { type: 'unit' }, castTime: 0.25, lockMovement: true, sfx: 'explosion',
        cast(champ, ctx) {
          const t = ctx.target;
          const dmg = scaled(champ, rv(R_BASE, ctx.rank), ratioR);
          champ.game.fx.beam({ x1: champ.x, y1: champ.y, x2: t.x, y2: t.y, from: champ, to: t, width: 50, color, duration: 0.3 });
          champ.game.fx.impact({ x: t.x, y: t.y, color, size: 1.8 });
          damage(champ, t, dmg, type, `${pid}_r`);
        },
        ai: {
          kind: 'execute', range: rRange,
          when: (champ, target) => target && (target.hp + target.totalShield) <= scaled(champ, rv(R_BASE, champ.abilities.R.rank), ratioR) * 1.1,
        },
      },
    },
    ai: {
      skillOrder: ['Q', 'E', 'W'], style: ranged ? (magicDmg ? 'mage' : 'marksman') : 'bruiser',
      engageRange: ranged ? 650 : 450, kiteDistance: ranged ? 450 : 0, combo: ['Q', 'E', 'R'],
      ...(opts.ai || {}),
    },
  };
}
