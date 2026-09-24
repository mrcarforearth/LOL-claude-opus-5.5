// 英雄：盖伦（德玛西亚之力）—— 参考实现，其他英雄作者请照此结构编写
//
// 编写要点：
//  1. 数值按技能等级写成数组，用 rv(arr, rank) 取值；desc(champ, rank) 用当前属性算出实际数值。
//  2. 普攻强化用 addHook('onHit' / 'afterHit') 实现；技能状态用 Buff（带 onApply/onRemove 同步 modelState）。
//  3. 需要「再次施放」的技能：cast 里 ability.setRecast(...)，并写 recast()；冷却自己控制时设 manualCooldown: true。
//  4. 视觉只调用 game.fx.*（无头模式为空操作），模拟逻辑绝不依赖 fx 返回值。
//  5. ai 字段给通用 AI 提供施放提示（kind/range/radius/when）。
import { rv, fmt, pct, scaleText } from './_common.js';
import { byLevel } from '../core/math.js';

// —— 数值表（LoL 当前版本） ——
const Q_DMG = [30, 60, 90, 120, 150];          // Q 额外物理伤害（+50% AD）
const Q_MS_DUR = [1, 1.65, 2.3, 2.95, 3.6];     // Q 加速持续时间
const Q_SILENCE = 1.5;
const Q_WINDOW = 4.5;                            // 强化普攻有效时间
const W_SHIELD = [65, 85, 105, 125, 145];       // W 护盾（+18% 额外生命）
const W_DR_DUR = [2, 3, 4, 5, 6];               // W 伤害减免持续时间
const W_STACK = 0.25;                            // 每次击杀的护甲/魔抗
const W_MAX = 30;
const E_BASE = [4, 8, 12, 16, 20];              // E 每次旋转基础伤害
const E_AD = [0.32, 0.34, 0.36, 0.38, 0.40];    // E 每次旋转 AD 比例
const E_RADIUS = 325;
const E_DURATION = 3;
const R_BASE = [150, 300, 450];
const R_MISSING = [0.25, 0.30, 0.35];           // 已损失生命值比例（真实伤害）

const GOLD_COLOR = 0xffe27a;
const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('韧', '#9bb7e8', '#27406e'),
  Q: icon('击', '#f7d774', '#7a5a12'),
  W: icon('勇', '#8fc3ff', '#1d3f7a'),
  E: icon('审', '#ffd08a', '#8a4a10'),
  R: icon('裁', '#ffe9a8', '#b3861b'),
};

// 被动回复比例：1 级 1.5% → 18 级 10.1%（每 5 秒）
const passivePct = (level) => byLevel(level, 0.015, 0.101);

// E 每次旋转伤害（不含最近目标加成）
function eTickDamage(champ, rank) {
  return rv(E_BASE, rank) + byLevel(champ.level, 0, 8.2) + rv(E_AD, rank) * champ.stats.ad;
}
// E 总旋转次数：基础 7 次，每 25% 额外攻速 +1 次
function eTicks(champ) {
  return 7 + Math.max(0, Math.floor((champ.stats.bonusAS + 1e-6) / 0.25));
}
// R 对目标的伤害
export function garenRDamage(champ, target, rank) {
  if (!target || rank <= 0) return 0;
  return rv(R_BASE, rank) + rv(R_MISSING, rank) * Math.max(0, target.maxHp - target.hp);
}

// E 单次旋转结算
function spinTick(champ, buff) {
  const game = champ.game;
  const d = buff.data;
  const hits = game.queryUnits({ x: champ.x, y: champ.y, radius: E_RADIUS, enemyOf: champ }).filter((u) => !u.untargetable);
  if (hits.length === 0) return;
  const base = eTickDamage(champ, d.rank);
  const nearest = hits[0]; // 按距离升序
  for (const u of hits) {
    const dmg = u === nearest ? base * 1.25 : base;
    game.dealDamage(champ, u, dmg, 'physical', { isAbility: true, isAoE: true, spell: 'garen_e' });
    if (u.type === 'champion' && u.alive) {
      const n = (d.hitCounts.get(u) || 0) + 1;
      d.hitCounts.set(u, n);
      if (n === 6) {
        u.addBuff({
          id: 'garen_e_shred', name: '审判', desc: '护甲降低 25%', icon: ICONS.E, source: champ,
          duration: 6, isDebuff: true, stats: { armorPct: -0.25 },
        });
      }
    }
  }
}

export default {
  id: 'garen',
  name: '盖伦',
  title: '德玛西亚之力',
  roles: ['top'],
  tags: ['战士', '坦克'],
  difficulty: 1,
  lore: '德玛西亚无畏先锋的领袖，一位骄傲而高贵的战士，挥舞巨剑以正义之名审判敌人。',
  baseStats: {
    hp: 690, hpPerLevel: 98, hpRegen: 8, hpRegenPerLevel: 0.5,
    mana: 0, manaPerLevel: 0, manaRegen: 0, manaRegenPerLevel: 0, resource: 'none',
    ad: 69, adPerLevel: 4.5, as: 0.625, asRatio: 0.625, asPerLevel: 3.65,
    armor: 38, armorPerLevel: 4.2, mr: 32, mrPerLevel: 1.55,
    ms: 340, range: 175, radius: 65, windup: 0.3, missileSpeed: 0, critMult: 1.75,
  },
  model: { primary: 0x2a4f9e, secondary: 0xd8c28a, accent: 0xffffff },
  portrait: { bg: ['#3a5da8', '#101a33'], glyph: '盖' },

  // —— 被动：坚韧 ——
  passive: {
    id: 'garen_passive',
    name: '坚韧',
    icon: ICONS.P,
    desc: (champ) => {
      const p = passivePct(champ?.level || 1);
      const amt = champ ? p * champ.maxHp : 0;
      return `若 8 秒内未受到敌方英雄或野怪的伤害，每 5 秒回复 ${pct(p)} 最大生命值${champ ? `（${fmt(amt)} 点）` : ''}。`;
    },
    init(champ) {
      const st = champ.passive.state;
      st.lastHostileHit = -99;
      st.active = false;
      // 记录最后一次受到敌方英雄（含其召唤物）或野怪伤害的时间
      champ.addHook('afterTakeDamage', (ctx) => {
        const s = ctx.source;
        if (!s || ctx.dealt <= 0) return;
        const hostile = s.type === 'champion' || s.type === 'monster' || (s.type === 'pet' && s.owner && s.owner.type === 'champion');
        if (hostile && s.team !== champ.team) st.lastHostileHit = champ.game.time;
      });
    },
    update(champ, dt) {
      const st = champ.passive.state;
      const game = champ.game;
      st.active = game.time - st.lastHostileHit >= 8;
      if (!st.active || champ.hp >= champ.maxHp) return;
      // 每 5 秒回复 X% → 每秒平滑回复
      const perSec = (passivePct(champ.level) * champ.maxHp) / 5;
      game.heal(champ, champ, perSec * dt, { silent: true, noPower: true, spell: 'garen_passive' });
    },
  },

  abilities: {
    // —— Q：致命打击 ——
    Q: {
      id: 'garen_q',
      name: '致命打击',
      icon: ICONS.Q,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `盖伦移除身上所有减速效果，并获得 35% 移动速度，持续 ${fmt(rv(Q_MS_DUR, r))} 秒。\n`
          + `他的下一次普攻（${Q_WINDOW} 秒内）额外造成 ${scaleText(champ, rv(Q_DMG, r), [[0.5, 'ad']])} 点物理伤害，并沉默目标 ${Q_SILENCE} 秒。\n该技能会重置普攻计时。`;
      },
      cooldown: [8, 8, 8, 8, 8],
      cost: [0, 0, 0, 0, 0],
      costType: 'none',
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: 175 },
      castTime: 0,
      lockMovement: false,
      sfx: 'buff',
      // 学会时注册普攻钩子（只注册一次）
      onLearn(champ) {
        champ.addHook('onHit', (target, hit) => {
          const b = champ.getBuff('garen_q_empower');
          if (!b) return;
          // 额外伤害与本次普攻合并结算（不享受暴击加成）
          hit.damage += rv(Q_DMG, b.data.rank) + 0.5 * champ.stats.ad;
          hit.garenQ = true;
          champ.removeBuff(b);
        });
        champ.addHook('afterHit', (target, hit) => {
          if (!hit.garenQ) return;
          const game = champ.game;
          if (target.alive) target.applyCC('silence', Q_SILENCE, { source: champ });
          game.fx.impact({ x: target.x, y: target.y, h: 90, color: GOLD_COLOR, size: 1.4 });
          game.fx.text?.({ x: target.x, y: target.y, h: 200, text: '沉默', color: GOLD_COLOR, size: 18, duration: 0.8 });
        });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const dur = rv(Q_MS_DUR, ctx.rank);
        champ.removeCC('slow');
        champ.addBuff({
          id: 'garen_q_haste', name: '致命打击', desc: '移动速度提升 35%', icon: ICONS.Q,
          source: champ, duration: dur, stats: { moveSpeedPct: 0.35 },
        });
        champ.addBuff({
          id: 'garen_q_empower', name: '致命打击', desc: '下次普攻造成额外伤害并沉默目标', icon: ICONS.Q,
          source: champ, duration: Q_WINDOW, refresh: 'replace', data: { rank: ctx.rank },
          onApply: (u) => { u.modelState.swordGlow = true; },
          onRemove: (u) => { u.modelState.swordGlow = false; },
        });
        champ.resetAttack();
        game.fx.attach({ unit: champ, kind: 'weaponGlow', color: GOLD_COLOR, duration: Q_WINDOW });
        game.fx.attach({ unit: champ, kind: 'haste', color: GOLD_COLOR, duration: dur });
      },
      ai: {
        kind: 'gapclose', range: 600,
        // 追击或即将普攻英雄时使用
        when: (champ, target) => !!target && target.type === 'champion' && champ.distTo(target) < 650,
      },
    },

    // —— W：勇气 ——
    W: {
      id: 'garen_w',
      name: '勇气',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const stacks = champ?.getBuff?.('garen_w_courage')?.stacks || 0;
        return `被动：每击杀一个单位永久获得 ${W_STACK} 护甲和魔法抗性，最多 ${W_MAX} 点（当前 ${fmt(stacks * W_STACK, 2)}）。\n`
          + `主动：盖伦获得 ${scaleText(champ, rv(W_SHIELD, r), [[0.18, 'bonusHp']])} 点护盾和 60% 韧性，持续 0.75 秒；并在 ${fmt(rv(W_DR_DUR, r))} 秒内受到的伤害降低 30%。`;
      },
      cooldown: [23, 21, 19, 17, 15],
      cost: [0, 0, 0, 0, 0],
      costType: 'none',
      range: 0,
      targeting: 'self',
      indicator: { type: 'self', radius: 120 },
      castTime: 0,
      lockMovement: false,
      sfx: 'shield',
      onLearn(champ) {
        // 永久叠层 Buff：层数 × 0.25 护甲/魔抗（120 层 = 30 点上限）
        const courage = champ.addBuff({
          id: 'garen_w_courage', name: '勇气', desc: '击杀单位永久提升护甲与魔法抗性', icon: ICONS.W,
          duration: Infinity, persistOnDeath: true, stacks: 0, maxStacks: W_MAX / W_STACK,
          stats: { armor: W_STACK, mr: W_STACK }, statsPerStack: true,
        });
        champ.addHook('onKill', (victim) => {
          if (!victim || victim.type === 'ward' || victim.type === 'pet' || victim.isStructure) return;
          const b = champ.getBuff('garen_w_courage') || courage;
          b.addStacks(1);
        });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const amount = rv(W_SHIELD, ctx.rank) + 0.18 * champ.stats.bonusHp;
        champ.addShield(amount, 0.75, { source: champ, id: 'garen_w' });
        champ.addBuff({ id: 'garen_w_tenacity', name: '勇气', desc: '韧性 +60%', icon: ICONS.W, source: champ, duration: 0.75, stats: { tenacity: 0.6 } });
        champ.addBuff({
          id: 'garen_w_dr', name: '勇气', desc: '受到的伤害降低 30%', icon: ICONS.W, source: champ,
          duration: rv(W_DR_DUR, ctx.rank), stats: { damageReduction: 0.3 },
        });
        game.fx.shield({ unit: champ, color: 0x9fd0ff, duration: 0.75, radius: 120 });
        game.fx.aura({ unit: champ, color: 0x9fd0ff, radius: 100, duration: rv(W_DR_DUR, ctx.rank) });
      },
      ai: {
        kind: 'shield',
        // 最近受到伤害、被控或处于团战中时使用
        when: (champ, target, game) => {
          const now = game.time;
          if (champ.isCCd()) return true;
          if (now - champ.lastDamagedAt > 0.6) return false;
          const hpLow = champ.hp / champ.maxHp < 0.7;
          const enemies = game.queryUnits({ x: champ.x, y: champ.y, radius: 700, enemyOf: champ, types: ['champion'] }).length;
          return hpLow || enemies >= 2;
        },
      },
    },

    // —— E：审判 ——
    E: {
      id: 'garen_e',
      name: '审判',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const ticks = champ ? eTicks(champ) : 7;
        const per = champ ? eTickDamage(champ, r) : rv(E_BASE, r);
        return `盖伦快速旋转 ${E_DURATION} 秒，期间可以移动但不能普攻，共旋转 ${ticks} 次（每 25% 额外攻击速度 +1 次），`
          + `每次对周围敌人造成 ${fmt(per)}（${rv(E_BASE, r)} + ${fmt(byLevel(champ?.level || 1, 0, 8.2))} +${pct(rv(E_AD, r))} 攻击力）点物理伤害。\n`
          + `离盖伦最近的敌人额外受到 25% 伤害。被同一次审判命中 6 次的敌方英雄护甲降低 25%，持续 6 秒。\n再次施放可提前结束（至少旋转 0.5 秒）。冷却在旋转结束后开始。`;
      },
      cooldown: [9, 9, 9, 9, 9],
      cost: [0, 0, 0, 0, 0],
      costType: 'none',
      range: E_RADIUS,
      targeting: 'self',
      indicator: { type: 'self', radius: E_RADIUS },
      castTime: 0,
      lockMovement: false,
      manualCooldown: true,
      sfx: 'spin',
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const ticks = eTicks(champ);
        champ.modelState.spinning = true;
        game.fx.custom('garen_e_spin', { unit: champ, duration: E_DURATION, radius: E_RADIUS });
        champ.addBuff({
          id: 'garen_e_spin', name: '审判', desc: '旋转中：不能普攻，忽略单位碰撞', icon: ICONS.E, source: champ,
          duration: E_DURATION, refresh: 'replace', disableAttack: true, ghosted: true,
          data: { ticks, interval: E_DURATION / ticks, done: 0, rank: ctx.rank, hitCounts: new Map() },
          // 按固定间隔结算伤害（与 tick 步长无关）
          onTick: (u, b) => {
            const due = Math.min(b.data.ticks, Math.floor((b.elapsed + 1e-6) / b.data.interval));
            while (b.data.done < due && u.alive) { b.data.done++; spinTick(u, b); }
          },
          onExpire: (u, b) => {
            while (b.data.done < b.data.ticks && u.alive) { b.data.done++; spinTick(u, b); }
          },
          // 任何原因结束旋转（到期/提前结束/阵亡）都开始冷却
          onRemove: (u) => {
            u.modelState.spinning = false;
            ab.endRecast(true);
          },
        });
        ab.setRecast(E_DURATION + 0.1, { cooldownOnExpire: true });
      },
      recast(champ, ctx) {
        const b = champ.getBuff('garen_e_spin');
        if (!b) { ctx.ability.endRecast(true); return true; }
        if (b.elapsed < 0.5) return false; // 至少旋转 0.5 秒
        champ.removeBuff(b);
        return true;
      },
      ai: { kind: 'aoe', range: 250, radius: E_RADIUS, minTargets: 1, farm: true },
    },

    // —— R：德玛西亚正义 ——
    R: {
      id: 'garen_r',
      name: '德玛西亚正义',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `盖伦召唤德玛西亚之力斩杀一名敌方英雄，在 0.435 秒后造成 ${rv(R_BASE, r)} + 目标已损失生命值 ${pct(rv(R_MISSING, r))} 的真实伤害。`;
      },
      cooldown: [120, 100, 80],
      cost: [0, 0, 0],
      costType: 'none',
      range: 400,
      targeting: 'unit',
      targetFilter: 'enemyChampion',
      indicator: { type: 'unit' },
      castTime: 0.435,
      lockMovement: true,
      sfx: 'explosion',
      // 前摇开始：巨剑从天而降的特效
      onCastStart(champ, ctx) {
        const t = ctx.target;
        champ.game.fx.custom('garen_r_sword', { target: t, x: t.x, y: t.y });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const t = ctx.target;
        if (!t || !t.alive) return false;
        const dmg = garenRDamage(champ, t, ctx.rank);
        game.dealDamage(champ, t, dmg, 'true', { isAbility: true, spell: 'garen_r' });
        game.fx.impact({ x: t.x, y: t.y, h: 60, color: GOLD_COLOR, size: 2.2 });
        game.fx.ring({ x: t.x, y: t.y, radius: 220, color: GOLD_COLOR, duration: 0.5, expand: true });
      },
      ai: {
        kind: 'execute', range: 400,
        when: (champ, target) => !!target && target.type === 'champion'
          && target.hp + target.totalShield <= garenRDamage(champ, target, champ.abilities.R.rank),
      },
    },
  },

  ai: { skillOrder: ['Q', 'E', 'W'], style: 'bruiser', engageRange: 500, kiteDistance: 0, combo: ['Q', 'E', 'R'] },
};
