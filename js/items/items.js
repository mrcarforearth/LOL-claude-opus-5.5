// 装备数据库：起始/消耗品/基础/进阶/鞋子/传说装备（官方中文译名、价格、属性、合成路线、被动/主动实现）、推荐出装、属性汇总、AI 主动使用建议
import { mitigate } from '../core/damage.js';
import {
  Bag, ticker, setCd, cdReady, isChamp, isMinion, isMonster, isStructureLike, onHitOk, isRanged, isEnemyOf, lvl,
  creditChampion, itemHeal, applyGrievous, decayShield, enterStasis, inStasis, spellblade, uniqueSlot,
  enemiesNear, alliedChampsNear, makeIconDraw, nextUid,
} from './itemfx.js';

// —— 属性显示 ——
export const STAT_LABELS = {
  ad: ['攻击力', 'flat'], ap: ['法术强度', 'flat'], attackSpeed: ['攻击速度', 'pct'], crit: ['暴击几率', 'pct'], critDamage: ['暴击伤害', 'pct'],
  lethality: ['穿甲', 'flat'], armorPenPct: ['护甲穿透', 'pct'], magicPen: ['法术穿透', 'flat'], magicPenPct: ['法术穿透', 'pct'],
  lifeSteal: ['生命偷取', 'pct'], omnivamp: ['全能吸血', 'pct'], hp: ['生命值', 'flat'], mana: ['法力值', 'flat'], armor: ['护甲', 'flat'],
  mr: ['魔法抗性', 'flat'], abilityHaste: ['技能急速', 'flat'], healShieldPower: ['治疗和护盾强度', 'pct'], hpRegen: ['生命回复（每 5 秒）', 'flat'],
  hpRegenPct: ['基础生命回复', 'pct'], manaRegen: ['法力回复（每 5 秒）', 'flat'], manaRegenPct: ['基础法力回复', 'pct'], tenacity: ['韧性', 'pct'],
  slowResist: ['减速抗性', 'pct'], moveSpeed: ['移动速度', 'flat'], moveSpeedPct: ['移动速度', 'pct'], apPct: ['法术强度', 'pct'], adPct: ['攻击力', 'pct'],
  attackRange: ['攻击距离', 'flat'], hpPct: ['最大生命值', 'pct'], armorPct: ['护甲', 'pct'], mrPct: ['魔法抗性', 'pct'], damageReduction: ['伤害减免', 'pct'],
};
const STAT_ORDER = Object.keys(STAT_LABELS);
const fmtNum = (n) => (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : String(Number(n.toFixed(2))));
export function formatStat(key, v) {
  const L = STAT_LABELS[key];
  if (!L) return `${key} ${v}`;
  return L[1] === 'pct' ? `+${fmtNum(v * 100)}% ${L[0]}` : `+${fmtNum(v)} ${L[0]}`;
}
export function formatStats(stats = {}) {
  const out = [];
  for (const k of STAT_ORDER) if (stats[k]) out.push(formatStat(k, stats[k]));
  for (const k in stats) if (!STAT_LABELS[k] && stats[k]) out.push(formatStat(k, stats[k]));
  return out;
}

// —— 图标调色：攻击红橙、法术紫蓝、防御绿灰、辅助青、传说金色系 ——
const PAL = {
  ad: { basic: ['#e0663e', '#4a1208'], epic: ['#ee8a38', '#5c1c06'], pattern: 'slash',
    legendary: [['#f4c55a', '#7c1c0c'], ['#f7d27c', '#8a2a12'], ['#eab44c', '#6c1020'], ['#f6cf6a', '#7a3408'], ['#f1bf5e', '#5e1616'], ['#f8d98e', '#8c1a1a']] },
  ap: { basic: ['#8478ee', '#1a1648'], epic: ['#9c6cf0', '#241252'], pattern: 'rune',
    legendary: [['#f2d072', '#2e1a70'], ['#f4d88c', '#3a1060'], ['#eac066', '#1c1a66'], ['#f6d47e', '#46167a'], ['#efc870', '#281a58']] },
  tank: { basic: ['#7aa88a', '#17291e'], epic: ['#8db89c', '#1b3628'], pattern: 'scale',
    legendary: [['#ead47e', '#1e4436'], ['#efdb92', '#24403a'], ['#e3c872', '#173a2a'], ['#f0d68a', '#2a3a34'], ['#e8cf80', '#203a30']] },
  support: { basic: ['#5ccfc4', '#0e3a42'], epic: ['#6ad8cc', '#0f4048'], pattern: 'dots',
    legendary: [['#f1da94', '#0f4a54'], ['#ecd286', '#12404e']] },
  starter: { basic: ['#cdb07a', '#3a2c12'], pattern: 'none' },
  boots: { basic: ['#c29a66', '#3a2612'], pattern: 'none' },
  consumable: { basic: ['#e86a6a', '#4a0c16'], pattern: 'none' },
};
const FRAME = { legendary: '#e8c26a', epic: '#b8c4d0', basic: '#9a8458', boots: '#b08a58', consumable: '#8a7a66', starter: '#c09a5a' };
function mkIcon(glyph, cat, tier, variant = 0, custom = null) {
  const p = PAL[cat] || PAL.ad;
  let bg;
  if (custom) bg = custom;
  else if (tier === 'legendary' && p.legendary) bg = p.legendary[variant % p.legendary.length];
  else bg = (tier === 'epic' && p.epic) || p.basic;
  const icon = { glyph, bg: [bg[0], bg[1]], fg: '#fff9ec', frame: FRAME[tier] || FRAME.basic, tier, pattern: p.pattern };
  icon.draw = makeIconDraw(icon);
  return icon;
}
const iconOf = (id) => ITEMS[id] && ITEMS[id].icon;

// —— 定义工具 ——
export const ITEMS = {};
function item(spec) {
  const {
    id, name, cost, from = [], stats = {}, tags = [], tier = 'basic', glyph, cat = 'ad', variant = 0, bg = null,
    passives = null, init = null, active = null, consumable = null, text = null, unique = null, maxStack = 1,
    purchasable = true, minLevel = 0, instant = null, rangedOnly = false, sellValue = null,
  } = spec;
  const lines = formatStats(stats);
  let passive = null;
  if (passives || init) {
    const list = passives || [];
    passive = { name: list.map((p) => p[0]).join(' / '), desc: list.map((p) => `${p[0]}：${p[1]}`).join('\n'), init: init || null, list };
    for (const p of list) lines.push(`被动 — ${p[0]}：${p[1]}`);
  }
  if (active) lines.push(`主动 — ${active.name}：${active.desc}（冷却 ${active.cooldown} 秒）`);
  if (text) lines.push(text);
  if (rangedOnly) lines.push('仅限远程英雄购买。');
  if (minLevel) lines.push(`需要 ${minLevel} 级才能购买。`);
  const d = {
    id, name, cost, from, into: [], stats, tags, tier, desc: lines.join('\n'), icon: mkIcon(glyph || name[0], cat, tier, variant, bg),
    unique, maxStack, purchasable, minLevel, rangedOnly, sellValue,
    passive, active, consumable, instant,
  };
  ITEMS[id] = d;
  return d;
}

// —— 共享被动 ——
// 岩石之肤：受到英雄普攻的伤害降低 5 + 每 1000 最大生命值 3.5 点（最多降低该次伤害的 40%）
function rockSolid(bag, champ, st) {
  const u = uniqueSlot(champ, 'rocksolid', st);
  bag.add(u.release);
  bag.hook('beforeTakeDamage', (ctx) => {
    if (!u.primary() || !ctx.isBasicAttack || !isChamp(ctx.source) || !(ctx.amount > 0)) return;
    const red = Math.min(ctx.amount * 0.4, 5 + (3.5 * champ.stats.maxHp) / 1000);
    ctx.amount -= red;
  });
}
const ROCK_SOLID = ['岩石之肤', '受到英雄普攻的伤害降低 5 点 + 每 1000 最大生命值 3.5 点（最多 40%）。'];
// 荆棘：被普攻命中时反弹魔法伤害，若攻击者为英雄则施加重伤
const IMMOBILIZE = new Set(['stun', 'root', 'airborne', 'charm', 'fear', 'taunt', 'suppress', 'sleep']);
function thorns(bag, champ, st, base, armorRatio, immobilizeGrievous) {
  const game = champ.game;
  bag.hook('afterTakeDamage', (ctx) => {
    const s = ctx.source;
    if (!ctx.isBasicAttack || !s || s === champ || !s.alive || s.team === champ.team || isStructureLike(s)) return;
    game.dealDamage(champ, s, base + armorRatio * champ.stats.bonusArmor, 'magic', { spell: st.id, noLifesteal: true });
    if (isChamp(s)) applyGrievous(s, champ, 0.4, 3);
  });
  if (immobilizeGrievous) {
    bag.on('cc', (e) => {
      if (e.source === champ && isChamp(e.target) && e.target.team !== champ.team && IMMOBILIZE.has(e.type)) applyGrievous(e.target, champ, 0.4, 3);
    });
  }
}
// 重伤（死刑宣告 / 遗忘法球 / 莫雷洛秘典）：对英雄造成指定类型伤害时施加 40% 重伤
function grievousOnDamage(bag, champ, type) {
  bag.hook('afterDealDamage', (ctx) => {
    if (ctx.type !== type || !(ctx.dealt > 0) || !isChamp(ctx.target) || !isEnemyOf(champ, ctx.target) || !ctx.target.alive) return;
    applyGrievous(ctx.target, champ, 0.4, 3);
  });
}
// 专注：普攻对小兵额外 5 点物理伤害
function focus(bag) {
  bag.hook('onHit', (t, hit) => { if (isMinion(t) && !hit.phantom && !hit.bolt) hit.damage += 5; });
}
// 装备升级（世界地图集任务）
function upgradeItem(champ, st, newId) {
  const nd = ITEMS[newId];
  if (!nd) return;
  const from = st.id;
  st.id = newId;
  st.def = nd;
  recomputeItemStats(champ);
  const game = champ.game;
  game.fx.text({ x: champ.x, y: champ.y, h: 220, text: `任务完成：${nd.name}`, color: 0xffd34d, size: 20, duration: 2 });
  game.events.emit('itemUpgraded', { champion: champ, itemId: newId, fromId: from });
}
// 可见敌方英雄（不作弊：仅本队可见且可选中的）
function visibleEnemyChamps(champ, radius) {
  return champ.game.queryUnits({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
}
const inCombat = (u, window = 2) => u.game.time - (u.lastDamagedAt ?? -99) < window;
const hardCCd = (u) => u.isHardCCd && u.isHardCCd();

// ============================================================
// 起始装备
// ============================================================
item({ id: 'doransblade', name: '多兰之刃', cost: 450, stats: { ad: 10, hp: 80, lifeSteal: 0.035 }, tier: 'starter', cat: 'starter', glyph: '刀',
  bg: ['#e0a064', '#4a1a0a'], tags: ['starter', 'ad', 'lifesteal'], text: '适合物理输出英雄的起始装备。' });
item({ id: 'doransring', name: '多兰之戒', cost: 400, stats: { ap: 18, hp: 90, manaRegen: 6 }, tier: 'starter', cat: 'starter', glyph: '戒',
  bg: ['#b49ae6', '#2a1a4a'], tags: ['starter', 'ap', 'mana'],
  passives: [['专注', '普攻对小兵额外造成 5 点物理伤害。']],
  init(champ) { const b = new Bag(champ); focus(b); return b.done(); } });
item({ id: 'doransshield', name: '多兰之盾', cost: 450, stats: { hp: 110 }, tier: 'starter', cat: 'starter', glyph: '盾',
  bg: ['#9cc8a0', '#1a3a22'], tags: ['starter', 'tank', 'hp'],
  passives: [['专注', '普攻对小兵额外造成 5 点物理伤害。'], ['坚忍', '受到敌方英雄伤害后，在 8 秒内回复 40 生命值（远程英雄 20），已损失生命值越多回复越多（最多翻倍）。']],
  init(champ) {
    const b = new Bag(champ);
    focus(b);
    const base = isRanged(champ) ? 20 : 40;
    b.hook('afterTakeDamage', (ctx) => {
      const src = creditChampion(ctx.source);
      if (!src || src.team === champ.team || !(ctx.dealt > 0) || !champ.alive) return;
      champ.addBuff({
        id: 'item_doransshield_endure', name: '坚忍', desc: '持续回复生命值', icon: iconOf('doransshield'), source: champ,
        duration: 8, tickInterval: 0.5, refresh: 'duration',
        onInterval: (u) => itemHeal(u, u, (base / 16) * (1 + (1 - u.hp / u.maxHp)), { silent: true, noPower: true }),
      });
    });
    return b.done();
  } });
item({ id: 'huntersmachete', name: '猎人的砍刀', cost: 450, stats: {}, tier: 'starter', cat: 'starter', glyph: '猎',
  bg: ['#9ccf6a', '#1e3a10'], tags: ['starter', 'jungle'], unique: 'rolequest',
  passives: [['猎手', '对野怪造成的伤害提升 20%，并将对野怪造成伤害的 8% 转化为生命值（持续伤害除外）。'],
    ['野性', '受到野怪的伤害降低 20%。击杀大型野怪时回复 30 + 4% 最大生命值和 20 法力值。']],
  text: '打野专用。与辅助任务装备互斥。',
  init(champ) {
    const b = new Bag(champ);
    b.hook('beforeDealDamage', (ctx) => { if (isMonster(ctx.target) && ctx.spell !== 'smite') ctx.amount *= 1.2; });
    b.hook('beforeTakeDamage', (ctx) => { if (isMonster(ctx.source)) ctx.amount *= 0.8; });
    b.hook('afterDealDamage', (ctx) => {
      if (isMonster(ctx.target) && ctx.dealt > 0 && !ctx.isDot) itemHeal(champ, champ, ctx.dealt * 0.08, { silent: true, noPower: true });
    });
    b.hook('onKill', (v) => {
      if (!isMonster(v) || v.large === false) return;
      itemHeal(champ, champ, 30 + 0.04 * champ.maxHp, { noPower: true });
      if (champ.maxMana > 0 && champ.resourceType === 'mana') champ.mana = Math.min(champ.maxMana, champ.mana + 20);
    });
    return b.done();
  } });
// 世界地图集 → 符文罗盘（任务：通过本装备获得 400 金币）
const SPOILS_TEXT = ['战利品', '附近 1050 码内有友方英雄时，你的伤害若使敌方小兵生命值低于 50%（远程英雄为 30%），则直接将其处决；你获得击杀金币，最近的友方英雄获得等量金币。3 层充能，每 18 秒恢复 1 层。'];
function supportQuestInit(champ, st) {
  const b = new Bag(champ);
  const game = champ.game;
  st.data.quest = st.data.quest || 0;
  if (st.charges == null) st.charges = 3;
  st.data.nextCharge = st.data.nextCharge || 0;
  const addQuest = (g) => {
    st.data.quest += g;
    st.counter = Math.min(st.data.quest, 400);
    if (st.id === 'worldatlas' && st.data.quest >= 400) upgradeItem(champ, st, 'runiccompass');
  };
  b.add(ticker(champ, st, { tag: 'gold', interval: 10, onTick: () => { champ.gainGold(3, 'passive'); addQuest(3); } }));
  b.add(ticker(champ, st, { tag: 'charge', onTick: () => {
    if (st.charges < 3 && game.time >= st.data.nextCharge) {
      st.charges++;
      st.data.nextCharge = game.time + 18;
    }
  } }));
  b.hook('afterDealDamage', (ctx) => {
    const t = ctx.target;
    if (!isMinion(t) || !t.alive || t.hp <= 0 || !isEnemyOf(champ, t) || st.charges <= 0 || ctx.spell === 'worldatlas') return;
    const th = isRanged(champ) ? 0.3 : 0.5;
    if (t.hp / t.maxHp >= th) return;
    const allies = alliedChampsNear(champ, champ.x, champ.y, 1050).filter((c) => c !== champ);
    if (allies.length === 0) return;
    const gold = t.goldValue || 0;
    if (st.charges === 3) st.data.nextCharge = game.time + 18;
    st.charges--;
    game.dealDamage(champ, t, t.hp + 10, 'true', { spell: 'worldatlas', noLifesteal: true });
    if (!t.alive && gold > 0) {
      allies[0].gainGold(gold, 'minion', t.x, t.y);
      addQuest(gold);
      game.fx.text({ x: t.x, y: t.y, h: 180, text: `+${Math.round(gold)}`, color: 0xffd34d, size: 16, duration: 1 });
    }
  });
  return b.done();
}
item({ id: 'worldatlas', name: '世界地图集', cost: 400, stats: { hp: 30, hpRegenPct: 0.25, manaRegenPct: 0.25 }, tier: 'starter', cat: 'starter', glyph: '图',
  bg: ['#78d4e0', '#0e3444'], tags: ['starter', 'support', 'mana'], unique: 'rolequest',
  passives: [SPOILS_TEXT, ['任务', '每 10 秒获得 3 金币。通过本装备获得 400 金币后升级为「符文罗盘」。']],
  text: '辅助专用。与打野装备互斥。', init: supportQuestInit });
item({ id: 'runiccompass', name: '符文罗盘', cost: 400, stats: { hp: 75, hpRegenPct: 0.5, manaRegenPct: 0.5 }, tier: 'starter', cat: 'starter', glyph: '罗',
  bg: ['#8ae0ea', '#0c3a4e'], tags: ['starter', 'support', 'mana'], unique: 'rolequest', purchasable: false,
  passives: [SPOILS_TEXT, ['馈赠', '每 10 秒获得 3 金币。']], text: '由世界地图集完成任务后升级获得。', init: supportQuestInit });

// ============================================================
// 消耗品
// ============================================================
item({ id: 'healthpotion', name: '生命药水', cost: 50, tier: 'consumable', cat: 'consumable', glyph: '药', bg: ['#f06a6a', '#4a0c16'],
  tags: ['consumable'], maxStack: 5, text: '点击使用：在 15 秒内回复共 120 生命值。最多携带 5 瓶。',
  consumable: {
    charges: 1,
    use(champ) {
      if (champ.hasBuff('item_potion_hp') || champ.hp >= champ.maxHp - 0.5) return false;
      champ.addBuff({
        id: 'item_potion_hp', name: '生命药水', desc: '在 15 秒内回复共 120 生命值', icon: iconOf('healthpotion'), source: champ,
        duration: 15, tickInterval: 0.5, onInterval: (u) => itemHeal(u, u, 4, { silent: true, noPower: true }),
      });
      champ.game.fx.attach({ unit: champ, kind: 'heal', color: 0xff7a7a, duration: 1 });
      return true;
    },
    ai: { when: (c) => !c.inFountain && c.hp / c.maxHp < 0.55 && !c.hasBuff('item_potion_hp') && !c.hasBuff('item_refillable') },
  } });
item({ id: 'refillable', name: '可充值药水', cost: 150, tier: 'consumable', cat: 'consumable', glyph: '瓶', bg: ['#f4955a', '#4a1a0a'],
  tags: ['consumable'], unique: 'refillable',
  text: '点击使用：消耗 1 层充能，在 12 秒内回复共 100 生命值。拥有 3 层充能，回到泉水时补满。充能用完后仍保留在栏位中。',
  init(champ, st) {
    return ticker(champ, st, { tag: 'refill', onTick: () => { if (st.charges < 3 && champ.inFountain) st.charges = 3; } });
  },
  consumable: {
    charges: 3, keepWhenEmpty: true,
    use(champ) {
      if (champ.hasBuff('item_refillable') || champ.hp >= champ.maxHp - 0.5) return false;
      champ.addBuff({
        id: 'item_refillable', name: '可充值药水', desc: '在 12 秒内回复共 100 生命值', icon: iconOf('refillable'), source: champ,
        duration: 12, tickInterval: 0.5, onInterval: (u) => itemHeal(u, u, 100 / 24, { silent: true, noPower: true }),
      });
      champ.game.fx.attach({ unit: champ, kind: 'heal', color: 0xffa060, duration: 1 });
      return true;
    },
    ai: { when: (c, st) => st.charges > 0 && !c.inFountain && c.hp / c.maxHp < 0.6 && !c.hasBuff('item_refillable') && !c.hasBuff('item_potion_hp') },
  } });
item({ id: 'controlward', name: '控制守卫', cost: 75, tier: 'consumable', cat: 'consumable', glyph: '眼', bg: ['#ff78b8', '#4a0c30'],
  tags: ['consumable', 'support'], maxStack: 2,
  text: '点击使用：在 600 码内放置一个控制守卫，提供 900 码视野并揭示、使附近敌方隐形守卫失效。永久存在，每人同时只能放置 1 个。最多携带 2 个。',
  consumable: {
    charges: 1,
    use(champ, st, ctx = {}) {
      let x = ctx.x, y = ctx.y;
      if (x == null || y == null) { x = champ.x + Math.cos(champ.facing) * 150; y = champ.y + Math.sin(champ.facing) * 150; }
      const d = Math.hypot(x - champ.x, y - champ.y);
      if (d > 600) { x = champ.x + ((x - champ.x) / d) * 600; y = champ.y + ((y - champ.y) / d) * 600; }
      champ.game.placeWard(champ, x, y, 'control');
      return true;
    },
  } });
// 合剂：18 级前的后期消耗品，购买后立即饮用，持续 3 分钟，死亡不消失；同时只能生效一种
const ELIXIRS = ['elixir_iron', 'elixir_sorcery', 'elixir_wrath'];
function drinkElixir(champ, def) {
  for (const id of ELIXIRS) if (id !== def.id) champ.removeBuff(id);
  champ.removeBuff(def.id);
  const b = champ.addBuff({ source: champ, duration: 180, persistOnDeath: true, ...def });
  champ.game.fx.attach({ unit: champ, kind: 'sparkles', color: def.color || 0xffffff, duration: 1.5 });
  return b;
}
item({ id: 'elixiriron', name: '钢铁合剂', cost: 500, tier: 'consumable', cat: 'consumable', glyph: '铁', bg: ['#a8b8b0', '#1e2a28'],
  tags: ['consumable', 'tank'], minLevel: 9, text: '购买后立即饮用：3 分钟内 +300 生命值、+25% 韧性、+25% 减速抗性。同时只能生效一种合剂。',
  instant(champ) {
    return drinkElixir(champ, { id: 'elixir_iron', name: '钢铁合剂', desc: '+300 生命值、+25% 韧性、+25% 减速抗性', icon: iconOf('elixiriron'),
      stats: { hp: 300, tenacity: 0.25, slowResist: 0.25 }, color: 0xc8d8d0 });
  } });
item({ id: 'elixirsorcery', name: '巫术合剂', cost: 500, tier: 'consumable', cat: 'consumable', glyph: '巫', bg: ['#9a7cf4', '#1c1250'],
  tags: ['consumable', 'ap'], minLevel: 9, text: '购买后立即饮用：3 分钟内 +50 法术强度、+15% 基础法力回复；对英雄或防御塔造成伤害时额外造成 25 点真实伤害（5 秒冷却）。',
  instant(champ) {
    return drinkElixir(champ, { id: 'elixir_sorcery', name: '巫术合剂', desc: '+50 法术强度；伤害英雄/防御塔时额外 25 真实伤害', icon: iconOf('elixirsorcery'),
      stats: { ap: 50, manaRegenPct: 0.15 }, color: 0xa88cff, data: { cd: 0 },
      onApply(u, buff) {
        buff.data.unhook = u.addHook('afterDealDamage', (ctx) => {
          const t = ctx.target;
          if (ctx.spell === 'elixir_sorcery' || !(ctx.dealt > 0) || !t || t.team === u.team || !(isChamp(t) || t.type === 'turret')) return;
          if (u.game.time < buff.data.cd) return;
          buff.data.cd = u.game.time + 5;
          u.game.dealDamage(u, t, 25, 'true', { spell: 'elixir_sorcery', noLifesteal: true });
        });
      },
      onRemove(u, buff) { if (buff.data.unhook) buff.data.unhook(); } });
  } });
item({ id: 'elixirwrath', name: '愤怒合剂', cost: 500, tier: 'consumable', cat: 'consumable', glyph: '怒', bg: ['#f4704a', '#4a0c08'],
  tags: ['consumable', 'ad'], minLevel: 9, text: '购买后立即饮用：3 分钟内 +30 攻击力；对英雄造成的物理伤害的 12% 转化为生命值。',
  instant(champ) {
    return drinkElixir(champ, { id: 'elixir_wrath', name: '愤怒合剂', desc: '+30 攻击力；对英雄物理伤害 12% 吸血', icon: iconOf('elixirwrath'),
      stats: { ad: 30 }, color: 0xff7a4a, data: {},
      onApply(u, buff) {
        buff.data.unhook = u.addHook('afterDealDamage', (ctx) => {
          if (ctx.type !== 'physical' || !(ctx.dealt > 0) || !isChamp(ctx.target) || ctx.target.team === u.team) return;
          itemHeal(u, u, ctx.dealt * 0.12, { silent: true, noPower: true });
        });
      },
      onRemove(u, buff) { if (buff.data.unhook) buff.data.unhook(); } });
  } });

// ============================================================
// 基础装备
// ============================================================
item({ id: 'longsword', name: '长剑', cost: 350, stats: { ad: 10 }, cat: 'ad', glyph: '剑', tags: ['ad'] });
item({ id: 'dagger', name: '短剑', cost: 250, stats: { attackSpeed: 0.10 }, cat: 'ad', glyph: '匕', tags: ['as'] });
item({ id: 'pickaxe', name: '十字镐', cost: 875, stats: { ad: 25 }, cat: 'ad', glyph: '镐', tags: ['ad'] });
item({ id: 'bfsword', name: '暴风之剑', cost: 1300, stats: { ad: 40 }, cat: 'ad', glyph: '暴', tags: ['ad'] });
item({ id: 'cloakofagility', name: '敏捷斗篷', cost: 600, stats: { crit: 0.15 }, cat: 'ad', glyph: '捷', tags: ['crit'] });
item({ id: 'amptome', name: '增幅典籍', cost: 400, stats: { ap: 20 }, cat: 'ap', glyph: '典', tags: ['ap'] });
item({ id: 'blastingwand', name: '爆裂魔杖', cost: 850, stats: { ap: 45 }, cat: 'ap', glyph: '杖', tags: ['ap'] });
item({ id: 'largerod', name: '无用大棒', cost: 1200, stats: { ap: 60 }, cat: 'ap', glyph: '棒', tags: ['ap'] });
item({ id: 'sapphire', name: '蓝水晶', cost: 300, stats: { mana: 250 }, cat: 'ap', glyph: '蓝', tags: ['mana'] });
item({ id: 'faeriecharm', name: '仙灵坠', cost: 200, stats: { manaRegenPct: 0.5 }, cat: 'support', glyph: '坠', tags: ['mana', 'support'] });
item({ id: 'rubycrystal', name: '红水晶', cost: 400, stats: { hp: 150 }, cat: 'tank', glyph: '红', tags: ['hp', 'tank'] });
item({ id: 'clotharmor', name: '布甲', cost: 300, stats: { armor: 15 }, cat: 'tank', glyph: '甲', tags: ['armor', 'tank'] });
item({ id: 'nullmagic', name: '抗魔斗篷', cost: 450, stats: { mr: 25 }, cat: 'tank', glyph: '斗', tags: ['mr', 'tank'] });
item({ id: 'rejuvbead', name: '再生坠饰', cost: 300, stats: { hpRegenPct: 1.0 }, cat: 'tank', glyph: '珠', tags: ['hp', 'tank'] });
item({ id: 'boots', name: '鞋子', cost: 300, stats: { moveSpeed: 25 }, tier: 'boots', cat: 'boots', glyph: '鞋', tags: ['boots'], unique: 'boots',
  text: '可升级为二级鞋。只能拥有一双鞋。' });

// ============================================================
// 进阶装备
// ============================================================
const E = (spec) => item({ tier: 'epic', ...spec });
E({ id: 'sheen', name: '耀光', cost: 700, cat: 'ap', glyph: '耀', bg: ['#7ec4f0', '#12305a'], tags: ['ad', 'ap', 'haste'],
  passives: [['咒刃', '施放技能后，10 秒内的下一次普攻额外造成 100% 基础攻击力的物理伤害（1.5 秒冷却）。']],
  init(champ, st) { return spellblade(champ, st, (c) => [{ amount: 1.0 * c.stats.baseAd, type: 'physical', spell: 'sheen' }]); } });
E({ id: 'phage', name: '净蚀', cost: 1100, from: ['rubycrystal', 'longsword'], stats: { ad: 15, hp: 200 }, cat: 'ad', glyph: '蚀', tags: ['ad', 'hp'] });
E({ id: 'caulfield', name: '考尔菲德的战锤', cost: 1100, from: ['longsword', 'longsword'], stats: { ad: 25, abilityHaste: 10 }, cat: 'ad', glyph: '锤', tags: ['ad', 'haste'] });
E({ id: 'serrated', name: '锯齿短匕', cost: 1000, from: ['longsword', 'longsword'], stats: { ad: 20, lethality: 10 }, cat: 'ad', glyph: '齿', tags: ['ad', 'lethality'] });
E({ id: 'vampscepter', name: '吸血鬼节杖', cost: 900, from: ['longsword'], stats: { ad: 15, lifeSteal: 0.07 }, cat: 'ad', glyph: '吸', tags: ['ad', 'lifesteal'] });
E({ id: 'zeal', name: '狂热', cost: 1050, from: ['dagger', 'cloakofagility'], stats: { attackSpeed: 0.15, crit: 0.15, moveSpeedPct: 0.07 }, cat: 'ad', glyph: '狂', tags: ['as', 'crit'] });
E({ id: 'recurvebow', name: '反曲之弓', cost: 700, from: ['dagger', 'dagger'], stats: { attackSpeed: 0.15 }, cat: 'ad', glyph: '弓', tags: ['as', 'onhit'],
  passives: [['钢尖', '普攻额外造成 15 点物理伤害（攻击特效）。']],
  init(champ) {
    const b = new Bag(champ);
    b.hook('onHit', (t, hit) => { if (onHitOk(t)) hit.extra.push({ amount: 15, type: 'physical', spell: 'recurvebow' }); });
    return b.done();
  } });
E({ id: 'executioner', name: '死刑宣告', cost: 800, from: ['longsword'], stats: { ad: 15 }, cat: 'ad', glyph: '刑', tags: ['ad'],
  passives: [['裂伤', '对敌方英雄造成物理伤害时施加 40% 重伤效果，持续 3 秒。']],
  init(champ) { const b = new Bag(champ); grievousOnDamage(b, champ, 'physical'); return b.done(); } });
E({ id: 'lastwhisper', name: '最后的轻语', cost: 1450, from: ['longsword', 'longsword'], stats: { ad: 20, armorPenPct: 0.18 }, cat: 'ad', glyph: '语',
  tags: ['ad', 'lethality'], unique: 'lastwhisper' });
E({ id: 'fiendishcodex', name: '恶魔法典', cost: 900, from: ['amptome'], stats: { ap: 35, abilityHaste: 10 }, cat: 'ap', glyph: '魔', tags: ['ap', 'haste'] });
E({ id: 'aetherwisp', name: '以太精魂', cost: 900, from: ['amptome'], stats: { ap: 30, moveSpeedPct: 0.04 }, cat: 'ap', glyph: '精', tags: ['ap'] });
E({ id: 'lostchapter', name: '遗失的章节', cost: 1200, from: ['amptome', 'sapphire'], stats: { ap: 40, mana: 300, abilityHaste: 10 }, cat: 'ap', glyph: '章', tags: ['ap', 'mana', 'haste'] });
E({ id: 'hextechalternator', name: '海克斯科技发电机', cost: 1100, from: ['amptome', 'amptome'], stats: { ap: 45 }, cat: 'ap', glyph: '电', tags: ['ap'],
  passives: [['转动', '对敌方英雄造成伤害时，额外造成 65~125（随等级）魔法伤害（40 秒冷却）。']],
  init(champ, st) {
    const b = new Bag(champ);
    const game = champ.game;
    b.hook('afterDealDamage', (ctx) => {
      const t = ctx.target;
      if (ctx.spell === 'hextechalternator' || !(ctx.dealt > 0) || !isChamp(t) || !isEnemyOf(champ, t) || t.hp <= 0 || !cdReady(st, game)) return;
      setCd(st, game, 40);
      game.dealDamage(champ, t, lvl(champ, 65, 125), 'magic', { spell: 'hextechalternator' });
      game.fx.impact({ x: t.x, y: t.y, color: 0x7ac8ff, size: 1 });
    });
    return b.done();
  } });
E({ id: 'blightingjewel', name: '枯萎珠宝', cost: 1100, from: ['amptome'], stats: { ap: 25, magicPenPct: 0.13 }, cat: 'ap', glyph: '枯', tags: ['ap'], unique: 'blight' });
E({ id: 'oblivionorb', name: '遗忘法球', cost: 800, from: ['amptome'], stats: { ap: 25 }, cat: 'ap', glyph: '忘', tags: ['ap'],
  passives: [['诅咒', '对敌方英雄造成魔法伤害时施加 40% 重伤效果，持续 3 秒。']],
  init(champ) { const b = new Bag(champ); grievousOnDamage(b, champ, 'magic'); return b.done(); } });
E({ id: 'seekers', name: '探索者的护臂', cost: 1600, from: ['amptome', 'clotharmor', 'clotharmor'], stats: { ap: 45, armor: 25 }, cat: 'ap', glyph: '探', tags: ['ap', 'armor'] });
E({ id: 'kindlegem', name: '燃烧宝石', cost: 800, from: ['rubycrystal'], stats: { hp: 200, abilityHaste: 10 }, cat: 'tank', glyph: '燃', tags: ['hp', 'haste'] });
E({ id: 'giantsbelt', name: '巨人腰带', cost: 900, from: ['rubycrystal'], stats: { hp: 350 }, cat: 'tank', glyph: '腰', tags: ['hp', 'tank'] });
E({ id: 'chainvest', name: '锁子甲', cost: 800, from: ['clotharmor'], stats: { armor: 40 }, cat: 'tank', glyph: '锁', tags: ['armor', 'tank'] });
E({ id: 'negatron', name: '负极斗篷', cost: 900, from: ['nullmagic'], stats: { mr: 50 }, cat: 'tank', glyph: '负', tags: ['mr', 'tank'] });
E({ id: 'spectrecowl', name: '幽魂斗篷', cost: 1250, from: ['rubycrystal', 'nullmagic'], stats: { hp: 250, mr: 25 }, cat: 'tank', glyph: '幽', tags: ['hp', 'mr', 'tank'] });
E({ id: 'bramblevest', name: '棘刺背心', cost: 800, from: ['clotharmor', 'clotharmor'], stats: { armor: 30 }, cat: 'tank', glyph: '刺', tags: ['armor', 'tank'], unique: 'thorns',
  passives: [['荆棘', '被普攻命中时，对攻击者造成 3 点魔法伤害；若攻击者为英雄，施加 40% 重伤效果，持续 3 秒。']],
  init(champ, st) { const b = new Bag(champ); thorns(b, champ, st, 3, 0, false); return b.done(); } });
E({ id: 'wardensmail', name: '守望者铠甲', cost: 1000, from: ['clotharmor', 'clotharmor'], stats: { armor: 40 }, cat: 'tank', glyph: '守', tags: ['armor', 'tank'],
  passives: [ROCK_SOLID],
  init(champ, st) { const b = new Bag(champ); rockSolid(b, champ, st); return b.done(); } });
E({ id: 'quicksilver', name: '水银饰带', cost: 1300, from: ['nullmagic'], stats: { mr: 30 }, cat: 'tank', glyph: '银', bg: ['#a8c8e0', '#1a2c40'], tags: ['mr'], unique: 'quicksilver',
  active: {
    name: '水银', desc: '移除身上所有控制效果（击飞除外）。', cooldown: 90, targeting: 'self',
    cast(champ) {
      champ.cleanse();
      champ.removeCC('suppress');
      champ.game.fx.flash({ x: champ.x, y: champ.y, color: 0xdfe8ff });
      champ.game.fx.attach({ unit: champ, kind: 'sparkles', color: 0xdfe8ff, duration: 0.8 });
      return true;
    },
    ai: { kind: 'cleanse', when: (c) => (c.hasCC('stun') || c.hasCC('suppress') || c.hasCC('charm') || c.hasCC('fear') || c.hasCC('taunt') || c.hasCC('root') || c.hasCC('sleep'))
      && ['stun', 'suppress', 'charm', 'fear', 'taunt', 'root', 'sleep'].some((t) => c.ccRemaining(t) > 0.6) && visibleEnemyChamps(c, 1200).length > 0 },
  } });
E({ id: 'forbiddenidol', name: '禁忌雕像', cost: 800, from: ['faeriecharm', 'faeriecharm'], stats: { manaRegenPct: 0.5, healShieldPower: 0.08 }, cat: 'support', glyph: '像', tags: ['support', 'mana'] });

// ============================================================
// 二级鞋
// ============================================================
const B2 = (spec) => item({ tier: 'boots', cat: 'boots', unique: 'boots', ...spec, stats: { moveSpeed: 45, ...spec.stats }, from: ['boots', ...(spec.from || [])],
  tags: ['boots', ...(spec.tags || [])] });
B2({ id: 'berserkers', name: '狂战士胫甲', cost: 1100, from: ['dagger'], stats: { attackSpeed: 0.35 }, glyph: '胫', bg: ['#e0885a', '#3e140a'], tags: ['as'] });
B2({ id: 'sorcshoes', name: '法师之靴', cost: 1100, stats: { magicPen: 18 }, glyph: '法', bg: ['#a888e0', '#261440'], tags: ['ap'] });
B2({ id: 'plated', name: '铁板靴', cost: 1100, from: ['clotharmor'], stats: { armor: 20 }, glyph: '板', bg: ['#a4b0b8', '#20282e'], tags: ['armor', 'tank'],
  passives: [['铁板', '受到的普攻伤害降低 12%。']],
  init(champ) { const b = new Bag(champ); b.hook('beforeTakeDamage', (ctx) => { if (ctx.isBasicAttack) ctx.amount *= 0.88; }); return b.done(); } });
B2({ id: 'mercs', name: '水银之靴', cost: 1100, from: ['nullmagic'], stats: { mr: 25, tenacity: 0.3 }, glyph: '水', bg: ['#6fb4d8', '#0e2638'], tags: ['mr', 'tank'] });
B2({ id: 'ionian', name: '明朗之靴', cost: 900, stats: { abilityHaste: 15 }, glyph: '明', bg: ['#b8daf4', '#1c3252'], tags: ['haste'],
  passives: [['艾欧尼亚之识', '获得 10 召唤师技能急速（召唤师技能冷却缩短约 9%）。']],
  init(champ) {
    const b = new Bag(champ);
    const game = champ.game;
    b.on('summonerCast', (e) => {
      if (e.caster !== champ) return;
      const s = champ.summoners[e.key];
      if (!s || s.maxCharges) return;
      const remain = s.cooldownUntil - game.time;
      if (remain <= 0) return;
      const cd = (remain * 100) / 110;
      s.cooldownUntil = game.time + cd;
      s.cdDuration = cd;
    });
    return b.done();
  } });
B2({ id: 'swiftness', name: '轻灵之靴', cost: 1000, stats: { moveSpeed: 55, slowResist: 0.25 }, glyph: '轻', bg: ['#a4d88e', '#1c3a18'], tags: ['boots'] });

// ============================================================
// 传说装备 —— 攻击
// ============================================================
const L = (spec) => item({ tier: 'legendary', ...spec });
L({ id: 'infinityedge', name: '无尽之刃', cost: 3400, from: ['bfsword', 'pickaxe', 'cloakofagility'], stats: { ad: 70, crit: 0.25, critDamage: 0.4 },
  cat: 'ad', variant: 0, glyph: '刃', tags: ['ad', 'crit'], passives: [['完美', '暴击伤害提高 40%（175% → 215%）。']] });
L({ id: 'bloodthirster', name: '饮血剑', cost: 3400, from: ['bfsword', 'vampscepter'], stats: { ad: 80, lifeSteal: 0.15 }, cat: 'ad', variant: 5, glyph: '血',
  tags: ['ad', 'lifesteal'],
  passives: [['灵液护盾', '生命偷取溢出的治疗转化为护盾，最多 50~350（随等级）；脱离战斗 25 秒后护盾逐渐消散。']],
  init(champ, st) {
    const b = new Bag(champ);
    const game = champ.game;
    const SID = 'item_bt_ichor';
    b.hook('beforeDealDamage', (ctx) => { ctx._btHp = champ.hp; });
    b.hook('afterDealDamage', (ctx) => {
      if (!ctx.isBasicAttack || ctx.noLifesteal || ctx.isPet || !(ctx.dealt > 0) || isStructureLike(ctx.target) || !champ.alive) return;
      const s = champ.stats;
      const expected = ctx.dealt * ((s.lifeSteal || 0) + (s.omnivamp || 0)) * (1 - (s.grievous || 0));
      const gained = Math.max(0, champ.hp - (ctx._btHp ?? champ.hp));
      const over = expected - gained;
      if (over <= 0.5) return;
      const cap = lvl(champ, 50, 350);
      const cur = champ.shields.find((x) => x.id === SID);
      if (cur) { cur.amount = Math.min(cap, cur.amount + over); cur.max = Math.max(cur.max, cur.amount); }
      else champ.addShield(Math.min(cap, over), Infinity, { source: champ, id: SID, noPower: true });
    });
    b.add(ticker(champ, st, { tag: 'decay', onTick: (dt) => {
      const cur = champ.shields.find((x) => x.id === SID);
      if (!cur) return;
      if (game.time - champ.lastCombatAt > 25) {
        cur.amount -= Math.max(20, cur.max * 0.25) * dt;
        if (cur.amount <= 0) champ.removeShield(SID);
      }
    } }));
    b.add(() => champ.removeShield(SID));
    return b.done();
  } });
L({ id: 'bork', name: '破败王者之刃', cost: 3200, from: ['recurvebow', 'vampscepter', 'pickaxe'], stats: { ad: 40, attackSpeed: 0.25, lifeSteal: 0.08 },
  cat: 'ad', variant: 2, glyph: '破', tags: ['ad', 'as', 'onhit', 'lifesteal'],
  passives: [['雾之锋', '普攻额外造成目标当前生命值 12%（远程英雄 9%）的物理伤害（攻击特效，最少 15 点；对小兵和野怪最多 60 点）。']],
  init(champ) {
    const b = new Bag(champ);
    b.hook('onHit', (t, hit) => {
      if (!onHitOk(t)) return;
      let amt = t.hp * (isRanged(champ) ? 0.09 : 0.12);
      if (!isChamp(t)) amt = Math.min(60, amt);
      hit.extra.push({ amount: Math.max(15, amt), type: 'physical', spell: 'bork' });
    });
    return b.done();
  } });
L({ id: 'trinity', name: '三相之力', cost: 3333, from: ['sheen', 'phage', 'dagger'], stats: { ad: 36, attackSpeed: 0.30, hp: 333, abilityHaste: 20 },
  cat: 'ad', variant: 3, glyph: '三', tags: ['ad', 'as', 'hp', 'haste'], unique: 'spellblade',
  passives: [['咒刃', '施放技能后，10 秒内的下一次普攻额外造成 200% 基础攻击力的物理伤害（1.5 秒冷却）。'], ['迅捷', '普攻命中单位时获得 20 移动速度，持续 2 秒。']],
  init(champ, st) {
    const b = new Bag(champ);
    b.add(spellblade(champ, st, (c) => [{ amount: 2.0 * c.stats.baseAd, type: 'physical', spell: 'trinity' }]));
    b.hook('onAttackLaunch', (t) => {
      if (!t || t.type === 'ward') return;
      champ.addBuff({ id: 'item_trinity_quicken', name: '迅捷', desc: '+20 移动速度', icon: iconOf('trinity'), source: champ, duration: 2, stats: { moveSpeed: 20 } });
    });
    return b.done();
  } });
L({ id: 'blackcleaver', name: '黑色切割者', cost: 3000, from: ['phage', 'kindlegem'], stats: { ad: 40, hp: 400, abilityHaste: 20 },
  cat: 'ad', variant: 4, glyph: '切', tags: ['ad', 'hp', 'haste'],
  passives: [['切割', '对敌方英雄造成物理伤害时，使其护甲降低 5%，持续 6 秒，最多叠加 6 层（30%）。'], ['热诚', '对英雄造成物理伤害时获得 20 移动速度，持续 2 秒。']],
  init(champ) {
    const b = new Bag(champ);
    b.hook('afterDealDamage', (ctx) => {
      const t = ctx.target;
      if (ctx.type !== 'physical' || !(ctx.dealt > 0) || !isChamp(t) || !isEnemyOf(champ, t) || !t.alive) return;
      t.addBuff({ id: 'item_blackcleaver_carve', name: '切割', desc: '每层护甲降低 5%', icon: iconOf('blackcleaver'), source: champ, duration: 6,
        maxStacks: 6, refresh: 'stack', stats: { armorPct: -0.05 }, statsPerStack: true, isDebuff: true });
      champ.addBuff({ id: 'item_blackcleaver_fervor', name: '热诚', desc: '+20 移动速度', icon: iconOf('blackcleaver'), source: champ, duration: 2, stats: { moveSpeed: 20 } });
    });
    return b.done();
  } });
L({ id: 'steraks', name: '斯特拉克的挑战护手', cost: 3200, from: ['giantsbelt', 'pickaxe'], stats: { hp: 400 }, cat: 'ad', variant: 1, glyph: '拳',
  tags: ['ad', 'hp', 'tank'], unique: 'lifeline',
  passives: [['擒拿之爪', '获得相当于 50% 基础攻击力的额外攻击力。'], ['生命线', '受到将使生命值降至 30% 以下的伤害时，先获得相当于 60% 额外生命值的护盾，在 4.5 秒内衰减（90 秒冷却）。']],
  init(champ, st) {
    const b = new Bag(champ);
    const game = champ.game;
    b.hook('modifyStats', (s) => { const add = 0.5 * s.baseAd; s.ad += add; s.bonusAd += add; });
    b.hook('beforeTakeDamage', (ctx) => {
      if (ctx.cancel || !(ctx.amount > 0) || !champ.alive || !cdReady(st, game)) return;
      let est = mitigate(ctx.source, champ, ctx.amount, ctx.type) * (1 - (champ.stats.damageReduction || 0));
      est -= champ.totalShield;
      if (champ.hp - est >= 0.3 * champ.maxHp) return;
      setCd(st, game, 90);
      decayShield(champ, 0.6 * champ.stats.bonusHp, 4.5, { source: champ, id: 'item_steraks', noPower: true });
      game.fx.shield({ unit: champ, color: 0xffc070, duration: 4.5, radius: 130 });
    });
    return b.done();
  } });
L({ id: 'deathsdance', name: '死亡之舞', cost: 3300, from: ['caulfield', 'chainvest', 'pickaxe'], stats: { ad: 55, armor: 45, abilityHaste: 15 },
  cat: 'ad', variant: 0, glyph: '舞', tags: ['ad', 'armor', 'haste'],
  passives: [['无视痛苦', '受到伤害的 30%（远程英雄 10%）改为在 3 秒内以真实伤害流血的形式结算。'], ['蔑视', '参与击杀敌方英雄时，清除剩余的流血伤害，并在 2 秒内回复 15% 最大生命值。']],
  init(champ, st) {
    const b = new Bag(champ);
    const game = champ.game;
    const ratio = isRanged(champ) ? 0.1 : 0.3;
    st.data.pool = 0;
    st.data.rate = 0;
    b.hook('afterTakeDamage', (ctx) => {
      if (ctx.spell === 'deathsdance' || !(ctx.dealt > 0)) return;
      const hpLoss = ctx.dealt - (ctx.absorbed || 0);
      if (hpLoss <= 0) return;
      const deferred = hpLoss * ratio;
      champ.hp = Math.min(champ.maxHp, champ.hp + deferred);
      st.data.pool += deferred;
      st.data.rate = st.data.pool / 3;
      st.counter = Math.round(st.data.pool);
    });
    b.add(ticker(champ, st, { tag: 'bleed', interval: 0.25, onTick: () => {
      if (!(st.data.pool > 0)) return;
      const amt = Math.min(st.data.pool, Math.max(1, st.data.rate * 0.25));
      st.data.pool -= amt;
      st.counter = Math.round(st.data.pool);
      game.dealDamage(champ, champ, amt, 'true', { isDot: true, spell: 'deathsdance', noLifesteal: true });
    } }));
    b.hook('onTakedown', (v) => {
      if (!isChamp(v)) return;
      st.data.pool = 0;
      st.counter = 0;
      champ.addBuff({ id: 'item_deathsdance_defy', name: '蔑视', desc: '持续回复生命值', icon: iconOf('deathsdance'), source: champ, duration: 2, tickInterval: 0.25,
        onInterval: (u) => itemHeal(u, u, (0.15 * u.maxHp) / 8, { silent: true, noPower: true }) });
    });
    b.hook('onDeath', () => { st.data.pool = 0; st.counter = 0; });
    return b.done();
  } });
L({ id: 'guardianangel', name: '守护天使', cost: 3200, from: ['pickaxe', 'chainvest'], stats: { ad: 55, armor: 45 }, cat: 'ad', variant: 1, glyph: '翼',
  bg: ['#fbe6a0', '#6a5a2a'], tags: ['ad', 'armor'],
  passives: [['重生', '受到致命伤害时，进入 4 秒凝滞状态，随后复活并回复 50% 基础生命值和 30% 最大法力值（300 秒冷却）。']],
  init(champ, st) {
    const b = new Bag(champ);
    const game = champ.game;
    b.hook('beforeDeath', (ctx) => {
      if (ctx.cancel || !cdReady(st, game) || inStasis(champ)) return;
      ctx.cancel = true;
      champ.hp = 1;
      setCd(st, game, 300);
      champ.ccs.length = 0;
      enterStasis(champ, 4, {
        kind: 'guardianangel', color: 0xfff0b0,
        onEnd: () => {
          if (!champ.alive) return;
          champ.hp = Math.min(champ.maxHp, Math.max(champ.hp, 0.5 * champ.stats.baseHp));
          if (champ.maxMana > 0) champ.mana = Math.min(champ.maxMana, champ.mana + 0.3 * champ.maxMana);
          game.fx.ring({ x: champ.x, y: champ.y, radius: 220, color: 0xfff0b0, duration: 0.8, expand: true });
          game.fx.text({ x: champ.x, y: champ.y, h: 220, text: '重生', color: 0xfff0b0, size: 22, duration: 1.5 });
        },
      });
      game.events.emit('itemProc', { champion: champ, itemId: 'guardianangel' });
    });
    return b.done();
  } });
L({ id: 'youmuu', name: '幽梦之灵', cost: 2800, from: ['serrated', 'caulfield'], stats: { ad: 55, lethality: 18 }, cat: 'ad', variant: 2, glyph: '梦',
  bg: ['#c8a0f0', '#4a1030'], tags: ['ad', 'lethality'],
  passives: [['游魂', '脱离战斗时获得 20 移动速度（远程英雄 10）。']],
  init(champ, st) {
    const game = champ.game;
    const v = isRanged(champ) ? 10 : 20;
    return ticker(champ, st, { tag: 'haunt', statsFn: () => (game.time - champ.lastCombatAt > 5 ? { moveSpeed: v } : null) });
  },
  active: {
    name: '幽魂步', desc: '获得 20%（远程英雄 15%）移动速度并忽略单位碰撞，持续 6 秒。', cooldown: 45, targeting: 'self',
    cast(champ) {
      if (!champ.canUseSummoner()) return false;
      champ.addBuff({ id: 'item_youmuu_wraith', name: '幽魂步', desc: '移动速度提升并忽略单位碰撞', icon: iconOf('youmuu'), source: champ, duration: 6,
        stats: { moveSpeedPct: isRanged(champ) ? 0.15 : 0.2 }, ghosted: true });
      champ.game.fx.attach({ unit: champ, kind: 'haste', color: 0xc080ff, duration: 6 });
      return true;
    },
    ai: { kind: 'selfbuff', when: (c) => {
      const en = visibleEnemyChamps(c, 1300);
      if (en.length === 0) return false;
      const chasing = c.attackTarget && isChamp(c.attackTarget) && c.distTo(c.attackTarget) > c.stats.attackRange + 150;
      return chasing || (c.hp / c.maxHp < 0.3 && inCombat(c));
    } },
  } });
L({ id: 'kraken', name: '海妖杀手', cost: 3000, from: ['recurvebow', 'pickaxe', 'dagger'], stats: { ad: 40, attackSpeed: 0.35, moveSpeedPct: 0.04 },
  cat: 'ad', variant: 3, glyph: '海', bg: ['#f2c860', '#0e3a5a'], tags: ['ad', 'as', 'onhit'],
  passives: [['放倒它', '每第三次普攻额外造成 150~200（随等级）物理伤害，目标每损失 1% 生命值，该伤害提升 0.5%（最多 50%）。']],
  init(champ, st) {
    const b = new Bag(champ);
    st.data.n = 0;
    b.hook('onAttackLaunch', (t, hit) => {
      if (!onHitOk(t)) return;
      st.data.n++;
      if (st.data.n >= 3) { st.data.n = 0; hit.kraken = true; }
      st.counter = st.data.n;
    });
    b.hook('onHit', (t, hit) => {
      if (!hit.kraken || hit.phantom || hit.bolt || !onHitOk(t)) return;
      const missing = 1 - t.hp / Math.max(1, t.maxHp);
      hit.extra.push({ amount: lvl(champ, 150, 200) * (1 + 0.5 * missing), type: 'physical', spell: 'kraken' });
      champ.game.fx.impact({ x: t.x, y: t.y, color: 0x5ac8ff, size: 1.3 });
    });
    return b.done();
  } });
// 充能（疾射火炮）：移动与普攻积累能量，满 100 层时下一次普攻强化
function energized(bag, champ, st) {
  st.data.energy = st.data.energy || 0;
  st.data.lx = champ.x; st.data.ly = champ.y;
  bag.add(ticker(champ, st, { tag: 'energy', onTick: () => {
    const d = Math.hypot(champ.x - st.data.lx, champ.y - st.data.ly);
    st.data.lx = champ.x; st.data.ly = champ.y;
    if (d > 0.5 && d < 400) st.data.energy = Math.min(100, st.data.energy + d / 24);
    st.counter = Math.floor(st.data.energy);
  } }));
}
L({ id: 'rapidfire', name: '疾射火炮', cost: 2650, from: ['zeal', 'recurvebow'], stats: { attackSpeed: 0.35, crit: 0.25, moveSpeedPct: 0.04 },
  cat: 'ad', variant: 4, glyph: '炮', tags: ['as', 'crit'], unique: 'energized',
  passives: [['充能', '移动与普攻会积累能量（每次普攻 6 层，移动 24 码 1 层），满 100 层时下一次普攻获得强化。'],
    ['神射手', '强化普攻的攻击距离提高 35%（最多 +150 码），并额外造成 40 点魔法伤害。']],
  init(champ, st) {
    const b = new Bag(champ);
    energized(b, champ, st);
    b.hook('modifyStats', (s) => { if (st.data.energy >= 100) s.attackRange += Math.min(150, 0.35 * champ.baseStats.range); });
    b.hook('onAttackLaunch', (t, hit) => {
      if (st.data.energy >= 100) { st.data.energy = 0; hit.rapidfire = true; }
      else st.data.energy = Math.min(100, st.data.energy + 6);
      st.counter = Math.floor(st.data.energy);
    });
    b.hook('onHit', (t, hit) => {
      if (!hit.rapidfire || !t || t.type === 'ward') return;
      hit.extra.push({ amount: 40, type: 'magic', spell: 'rapidfire' });
      champ.game.fx.impact({ x: t.x, y: t.y, color: 0xffd060, size: 1 });
    });
    return b.done();
  } });
L({ id: 'runaans', name: '卢安娜的飓风', cost: 2650, from: ['zeal', 'recurvebow'], stats: { attackSpeed: 0.40, crit: 0.25, moveSpeedPct: 0.04 },
  cat: 'ad', variant: 1, glyph: '飓', bg: ['#f4d488', '#1a4a44'], tags: ['as', 'crit', 'onhit'], rangedOnly: true,
  passives: [['风怒', '普攻时向 550 码内至多 2 名其他敌人各射出一支弩箭，造成 55% 攻击力的物理伤害（可暴击，附带攻击特效）。']],
  init(champ) {
    const b = new Bag(champ);
    const game = champ.game;
    b.hook('onAttackLaunch', (t, hit) => {
      if (!isRanged(champ) || hit.bolt || !onHitOk(t)) return;
      const list = enemiesNear(champ, champ.x, champ.y, 550, ['champion', 'minion', 'monster', 'pet']).filter((u) => u !== t).slice(0, 2);
      for (const u of list) {
        const crit = champ.stats.crit;
        const bhit = { damage: 0, type: 'physical', isCrit: crit > 0 && (crit >= 1 || game.rng() < crit), extra: [], miss: champ.hasCC('blind'), attacker: champ, bolt: true };
        game.spawnProjectile({
          owner: champ, target: u, speed: champ.baseStats.missileSpeed || 2000, width: 0, height: champ.baseStats.missileHeight || 100,
          vfx: { kind: 'arrow', color: 0xa8e6ff, size: 0.7, trail: true },
          onHit: () => { champ.resolveAttackHit(u, bhit); return true; },
        });
      }
    });
    b.hook('onHit', (t, hit) => { if (hit.bolt) hit.damage *= 0.55; });
    return b.done();
  } });
L({ id: 'lorddominik', name: '多米尼克领主的致意', cost: 3000, from: ['lastwhisper', 'cloakofagility', 'longsword'], stats: { ad: 35, crit: 0.25, armorPenPct: 0.35 },
  cat: 'ad', variant: 5, glyph: '致', tags: ['ad', 'crit', 'lethality'], unique: 'lastwhisper' });
L({ id: 'guinsoo', name: '鬼索的狂暴之刃', cost: 3000, from: ['recurvebow', 'amptome', 'pickaxe'], stats: { ad: 30, ap: 30, attackSpeed: 0.25 },
  cat: 'ad', variant: 2, glyph: '鬼', bg: ['#f0b858', '#4a0a3a'], tags: ['ad', 'ap', 'as', 'onhit'],
  passives: [['怒火', '普攻额外造成 30 点魔法伤害（攻击特效）。'], ['沸腾打击', '每第三次普攻会额外触发一次攻击特效（幻影打击）。']],
  init(champ, st) {
    const b = new Bag(champ);
    const game = champ.game;
    st.data.n = 0;
    b.hook('onAttackLaunch', (t, hit) => {
      if (!onHitOk(t)) return;
      st.data.n++;
      if (st.data.n >= 3) { st.data.n = 0; hit.guinsoo = true; }
      st.counter = st.data.n;
    });
    b.hook('onHit', (t, hit) => { if (onHitOk(t)) hit.extra.push({ amount: 30, type: 'magic', spell: 'guinsoo' }); });
    b.hook('afterHit', (t, hit) => {
      if (!hit.guinsoo || hit.phantom || !t || !t.alive) return;
      const ph = { damage: 0, type: 'physical', isCrit: false, extra: [], miss: false, attacker: champ, phantom: true };
      champ.runHooks('onHit', t, ph);
      if (ph.damage > 0 && t.alive) game.dealDamage(champ, t, ph.damage, ph.type, { isOnHit: true, spell: 'guinsoo_phantom' });
      for (const e of ph.extra) { if (!t.alive) break; game.dealDamage(champ, t, e.amount, e.type || 'physical', { isOnHit: true, spell: e.spell || 'guinsoo_phantom' }); }
      game.fx.impact({ x: t.x, y: t.y, color: 0xff6ad0, size: 1 });
    });
    return b.done();
  } });
L({ id: 'witsend', name: '智慧末刃', cost: 2800, from: ['recurvebow', 'negatron', 'dagger'], stats: { attackSpeed: 0.50, mr: 45 },
  cat: 'ad', variant: 0, glyph: '智', bg: ['#f0cc6a', '#3a1a5a'], tags: ['as', 'mr', 'onhit'],
  passives: [['争斗', '普攻额外造成 15~80（随等级）魔法伤害（攻击特效）。']],
  init(champ) {
    const b = new Bag(champ);
    b.hook('onHit', (t, hit) => { if (onHitOk(t)) hit.extra.push({ amount: lvl(champ, 15, 80), type: 'magic', spell: 'witsend' }); });
    return b.done();
  } });
L({ id: 'stridebreaker', name: '挺进破坏者', cost: 3300, from: ['phage', 'caulfield', 'dagger'], stats: { ad: 45, attackSpeed: 0.20, hp: 400 },
  cat: 'ad', variant: 3, glyph: '挺', tags: ['ad', 'as', 'hp'],
  active: {
    name: '阻滞裂斩', desc: '对周围 450 码内的敌人造成 80% 攻击力的物理伤害并减速 40%，持续 2 秒；自身获得 20% 移动速度，持续 2 秒。', cooldown: 15, targeting: 'self',
    cast(champ) {
      if (!champ.canUseSummoner()) return false;
      const game = champ.game;
      const list = enemiesNear(champ, champ.x, champ.y, 450);
      for (const u of list) {
        game.dealDamage(champ, u, 0.8 * champ.stats.ad, 'physical', { isAoE: true, spell: 'stridebreaker' });
        if (u.alive) u.slow(0.4, 2, champ);
      }
      champ.addBuff({ id: 'item_stridebreaker_ms', name: '阻滞裂斩', icon: iconOf('stridebreaker'), source: champ, duration: 2, stats: { moveSpeedPct: 0.2 } });
      game.fx.spin({ unit: champ, radius: 450, color: 0xff9a4a, duration: 0.35 });
      game.fx.ring({ x: champ.x, y: champ.y, radius: 450, color: 0xff9a4a, duration: 0.4, expand: true });
      return true;
    },
    ai: { kind: 'aoe', radius: 450, when: (c) => visibleEnemyChamps(c, 380).length > 0 },
  } });
L({ id: 'deadmans', name: '亡者的板甲', cost: 2900, from: ['chainvest', 'giantsbelt'], stats: { hp: 350, armor: 45 }, cat: 'tank', variant: 3, glyph: '亡',
  tags: ['tank', 'armor', 'hp'],
  passives: [['破舰者', '移动时积累动能（最多 100 层），每层提供 0.4 移动速度（最多 +40）；受到定身类控制时清空，静止时逐渐衰减。'],
    ['碾压打击', '满层动能时，下一次普攻消耗全部动能，额外造成 40 + 100% 基础攻击力的物理伤害；近战英雄还会使目标减速 50%，持续 1 秒。']],
  init(champ, st) {
    const b = new Bag(champ);
    st.data.m = 0;
    st.data.lx = champ.x; st.data.ly = champ.y;
    b.add(ticker(champ, st, {
      tag: 'momentum',
      onTick: (dt) => {
        const d = Math.hypot(champ.x - st.data.lx, champ.y - st.data.ly);
        st.data.lx = champ.x; st.data.ly = champ.y;
        if (champ.hasCC('root') || hardCCd(champ)) st.data.m = 0;
        else if (d > 0.5 && d < 400 && !champ.dashState) st.data.m = Math.min(100, st.data.m + d / 14);
        else st.data.m = Math.max(0, st.data.m - 25 * dt);
        st.counter = Math.floor(st.data.m);
      },
      statsFn: () => (st.data.m > 0 ? { moveSpeed: 0.4 * st.data.m } : null),
    }));
    b.hook('onHit', (t, hit) => {
      if (st.data.m < 100 || hit.phantom || hit.bolt || !onHitOk(t)) return;
      st.data.m = 0;
      hit.extra.push({ amount: 40 + champ.stats.baseAd, type: 'physical', spell: 'deadmans' });
      if (!isRanged(champ)) t.slow(0.5, 1, champ);
      champ.game.fx.impact({ x: t.x, y: t.y, color: 0xc8a060, size: 1.4 });
    });
    return b.done();
  } });

// ============================================================
// 传说装备 —— 法术
// ============================================================
L({ id: 'rabadon', name: '灭世者的死亡之帽', cost: 3600, from: ['largerod', 'largerod'], stats: { ap: 130, apPct: 0.35 }, cat: 'ap', variant: 0, glyph: '帽',
  tags: ['ap'], passives: [['魔法乐章', '法术强度提高 35%。']] });
L({ id: 'voidstaff', name: '虚空之杖', cost: 3000, from: ['blightingjewel', 'blastingwand'], stats: { ap: 95, magicPenPct: 0.4 }, cat: 'ap', variant: 3, glyph: '虚',
  tags: ['ap'], unique: 'blight', passives: [['虚空腐蚀', '获得 40% 法术穿透。']] });
L({ id: 'zhonya', name: '中娅沙漏', cost: 3250, from: ['seekers', 'blastingwand'], stats: { ap: 105, armor: 50 }, cat: 'ap', variant: 1, glyph: '沙',
  bg: ['#f6d880', '#5a3a10'], tags: ['ap', 'armor'],
  active: {
    name: '凝滞', desc: '进入 2.5 秒凝滞状态：无敌且不可被选取，但期间无法移动、攻击、施放技能或使用召唤师技能。', cooldown: 120, targeting: 'self',
    cast(champ) {
      if (!champ.canUseSummoner() || inStasis(champ)) return false;
      return enterStasis(champ, 2.5, { kind: 'zhonya', color: 0xffd46a });
    },
    ai: { kind: 'defensive', when: (c) => c.hp / c.maxHp < 0.25 && inCombat(c, 1) && visibleEnemyChamps(c, 900).length > 0 },
  } });
L({ id: 'luden', name: '卢登的回声', cost: 2900, from: ['lostchapter', 'blastingwand'], stats: { ap: 90, mana: 600, abilityHaste: 20 }, cat: 'ap', variant: 2, glyph: '回',
  tags: ['ap', 'mana', 'haste'],
  passives: [['回声', '技能对敌方英雄造成伤害时，对其与附近至多 3 名敌人各额外造成 100 + 10% 法术强度的魔法伤害（10 秒冷却）。']],
  init(champ, st) {
    const b = new Bag(champ);
    const game = champ.game;
    b.hook('afterDealDamage', (ctx) => {
      const t = ctx.target;
      if (!ctx.isAbility || !(ctx.dealt > 0) || !isChamp(t) || !isEnemyOf(champ, t) || t.hp <= 0 || !cdReady(st, game)) return;
      setCd(st, game, 10);
      const dmg = 100 + 0.1 * champ.stats.ap;
      const others = enemiesNear(champ, t.x, t.y, 500).filter((u) => u !== t).slice(0, 3);
      for (const u of [t, ...others]) {
        if (!u.alive || u.hp <= 0) continue;
        game.dealDamage(champ, u, dmg, 'magic', { spell: 'luden', isAoE: u !== t });
        game.fx.beam({ x1: t.x, y1: t.y, x2: u.x, y2: u.y, from: t, to: u, color: 0xb88cff, width: 26, duration: 0.25 });
      }
      game.fx.burst({ x: t.x, y: t.y, color: 0xb88cff, count: 16, size: 18, speed: 260, duration: 0.5 });
    });
    return b.done();
  } });
L({ id: 'lichbane', name: '巫妖之祸', cost: 3100, from: ['sheen', 'aetherwisp', 'amptome'], stats: { ap: 100, abilityHaste: 10, moveSpeedPct: 0.04 },
  cat: 'ap', variant: 4, glyph: '妖', tags: ['ap', 'haste'], unique: 'spellblade',
  passives: [['咒刃', '施放技能后，10 秒内的下一次普攻额外造成 75% 基础攻击力 + 50% 法术强度的魔法伤害（1.5 秒冷却）。']],
  init(champ, st) { return spellblade(champ, st, (c) => [{ amount: 0.75 * c.stats.baseAd + 0.5 * c.stats.ap, type: 'magic', spell: 'lichbane' }]); } });
L({ id: 'shadowflame', name: '影焰', cost: 3200, from: ['hextechalternator', 'largerod'], stats: { ap: 110, magicPen: 15 }, cat: 'ap', variant: 3, glyph: '焰',
  bg: ['#f4c060', '#3a0c3a'], tags: ['ap'],
  passives: [['余烬绽放', '对生命值低于 35% 的敌方英雄造成的魔法伤害和真实伤害提高 20%。']],
  init(champ) {
    const b = new Bag(champ);
    b.hook('beforeDealDamage', (ctx) => {
      const t = ctx.target;
      if ((ctx.type === 'magic' || ctx.type === 'true') && isChamp(t) && isEnemyOf(champ, t) && t.hp / t.maxHp < 0.35) ctx.amount *= 1.2;
    });
    return b.done();
  } });
L({ id: 'morellonomicon', name: '莫雷洛秘典', cost: 2850, from: ['oblivionorb', 'kindlegem', 'amptome'], stats: { ap: 75, hp: 350, abilityHaste: 15 },
  cat: 'ap', variant: 1, glyph: '秘', tags: ['ap', 'hp', 'haste'],
  passives: [['痛苦诅咒', '对敌方英雄造成魔法伤害时施加 40% 重伤效果，持续 3 秒。']],
  init(champ) { const b = new Bag(champ); grievousOnDamage(b, champ, 'magic'); return b.done(); } });
L({ id: 'rylai', name: '瑞莱的冰晶节杖', cost: 2600, from: ['blastingwand', 'giantsbelt'], stats: { ap: 75, hp: 400 }, cat: 'ap', variant: 0, glyph: '冰',
  bg: ['#dff0ff', '#1a3a6a'], tags: ['ap', 'hp'],
  passives: [['凛霜', '技能伤害会使敌人减速 30%，持续 1 秒。']],
  init(champ) {
    const b = new Bag(champ);
    b.hook('afterDealDamage', (ctx) => {
      const t = ctx.target;
      if (!ctx.isAbility || !(ctx.dealt > 0) || !t || !t.alive || t.hp <= 0 || !isEnemyOf(champ, t) || isStructureLike(t)) return;
      t.slow(0.3, 1, champ);
    });
    return b.done();
  } });

// ============================================================
// 传说装备 —— 防御 / 辅助
// ============================================================
L({ id: 'sunfire', name: '日炎圣盾', cost: 2700, from: ['giantsbelt', 'chainvest'], stats: { hp: 450, armor: 40 }, cat: 'tank', variant: 0, glyph: '日',
  bg: ['#ffd070', '#6a2a08'], tags: ['tank', 'hp', 'armor'], unique: 'immolate',
  passives: [['献祭', '受到或造成伤害后的 3 秒内，每秒对 325 码内的敌人造成 20 + 1% 额外生命值的魔法伤害（对小兵 +25%，对野怪 +150%）。']],
  init(champ, st) {
    const b = new Bag(champ);
    const game = champ.game;
    st.data.activeUntil = -1;
    b.hook('afterDealDamage', (ctx) => {
      if (ctx.spell !== 'sunfire' && ctx.dealt > 0 && ctx.target !== champ && isEnemyOf(champ, ctx.target)) st.data.activeUntil = game.time + 3;
    });
    b.hook('afterTakeDamage', (ctx) => {
      if (ctx.dealt > 0 && ctx.source && ctx.source !== champ) st.data.activeUntil = game.time + 3;
    });
    b.add(ticker(champ, st, { tag: 'immolate', interval: 1, onTick: () => {
      if (!(st.data.activeUntil >= game.time)) return;
      const dmg = 20 + 0.01 * champ.stats.bonusHp;
      for (const u of enemiesNear(champ, champ.x, champ.y, 325)) {
        const mult = isMinion(u) ? 1.25 : isMonster(u) ? 2.5 : 1;
        game.dealDamage(champ, u, dmg * mult, 'magic', { isDot: true, isAoE: true, spell: 'sunfire' });
      }
      game.fx.aura({ unit: champ, color: 0xff8a2a, radius: 325, duration: 1 });
    } }));
    return b.done();
  } });
L({ id: 'thornmail', name: '荆棘之甲', cost: 2450, from: ['bramblevest', 'giantsbelt'], stats: { hp: 350, armor: 60 }, cat: 'tank', variant: 1, glyph: '棘',
  tags: ['tank', 'armor', 'hp'], unique: 'thorns',
  passives: [['荆棘', '被普攻命中时，对攻击者造成 20 + 10% 额外护甲的魔法伤害；若攻击者为英雄，施加 40% 重伤效果，持续 3 秒。定身敌方英雄时同样施加重伤。']],
  init(champ, st) { const b = new Bag(champ); thorns(b, champ, st, 20, 0.1, true); return b.done(); } });
L({ id: 'warmog', name: '狂徒铠甲', cost: 3100, from: ['giantsbelt', 'giantsbelt', 'rubycrystal'], stats: { hp: 1000, hpRegenPct: 1.0 }, cat: 'tank', variant: 2, glyph: '徒',
  tags: ['tank', 'hp'],
  passives: [['狂徒之心', '若拥有至少 1100 额外生命值，在 6 秒内未受到伤害时，每秒回复 3% 最大生命值。']],
  init(champ, st) {
    const game = champ.game;
    return ticker(champ, st, { tag: 'heart', interval: 0.5, onTick: () => {
      if (champ.stats.bonusHp < 1100 || game.time - champ.lastDamagedAt < 6 || champ.hp >= champ.maxHp || champ.inFountain) return;
      itemHeal(champ, champ, 0.03 * champ.maxHp * 0.5, { silent: true, noPower: true });
    } });
  } });
L({ id: 'spiritvisage', name: '振奋盔甲', cost: 2900, from: ['spectrecowl', 'kindlegem'], stats: { hp: 450, mr: 60, abilityHaste: 10, hpRegenPct: 1.0 },
  cat: 'tank', variant: 3, glyph: '振', tags: ['tank', 'mr', 'hp', 'haste'],
  passives: [['无尽活力', '受到的所有治疗与护盾效果提高 25%（包括生命回复与生命偷取）。']],
  init(champ) {
    const b = new Bag(champ);
    champ._healRecvBonus = (champ._healRecvBonus || 0) + 0.25;
    b.add(() => { champ._healRecvBonus = Math.max(0, (champ._healRecvBonus || 0) - 0.25); });
    b.on('heal', (e) => {
      if (e.target !== champ || !(e.amount > 0) || !champ.alive) return;
      champ.hp = Math.min(champ.maxHp, champ.hp + e.amount * 0.25);
    });
    b.on('shield', (e) => {
      if (e.target !== champ) return;
      const s = champ.shields[champ.shields.length - 1];
      if (s && !s._svBoost && Math.abs(s.max - e.amount) < 1e-6) { s.amount *= 1.25; s.max *= 1.25; s._svBoost = true; }
    });
    b.hook('modifyStats', (s) => { s.hpRegen *= 1.25; });
    b.hook('afterDealDamage', (ctx) => {
      if (ctx.noLifesteal || ctx.isPet || !(ctx.dealt > 0) || !champ.alive || isStructureLike(ctx.target)) return;
      const s = champ.stats;
      const raw = (ctx.isBasicAttack ? ctx.dealt * (s.lifeSteal || 0) : 0) + ctx.dealt * (s.omnivamp || 0);
      if (raw > 0) champ.hp = Math.min(champ.maxHp, champ.hp + raw * (1 - (s.grievous || 0)) * 0.25);
    });
    return b.done();
  } });
L({ id: 'randuin', name: '兰顿之兆', cost: 2700, from: ['wardensmail', 'giantsbelt'], stats: { hp: 350, armor: 70 }, cat: 'tank', variant: 4, glyph: '兆',
  tags: ['tank', 'armor', 'hp'],
  passives: [ROCK_SOLID, ['坚韧', '受到的暴击伤害降低 30%。']],
  init(champ, st) {
    const b = new Bag(champ);
    rockSolid(b, champ, st);
    b.hook('beforeTakeDamage', (ctx) => { if (ctx.isCrit) ctx.amount *= 0.7; });
    return b.done();
  },
  active: {
    name: '谦卑', desc: '使 500 码内的敌人减速 55%，持续 2 秒。', cooldown: 90, targeting: 'self',
    cast(champ) {
      if (!champ.canUseSummoner()) return false;
      const list = enemiesNear(champ, champ.x, champ.y, 500);
      for (const u of list) u.slow(0.55, 2, champ);
      champ.game.fx.ring({ x: champ.x, y: champ.y, radius: 500, color: 0x9ad8ff, duration: 0.6, expand: true });
      return true;
    },
    ai: { kind: 'cc', radius: 500, when: (c) => visibleEnemyChamps(c, 450).length > 0 && inCombat(c, 3) },
  } });
L({ id: 'frozenheart', name: '冰霜之心', cost: 2500, from: ['wardensmail', 'sapphire'], stats: { armor: 65, mana: 400, abilityHaste: 20 }, cat: 'tank', variant: 1, glyph: '霜',
  bg: ['#e8f0ff', '#1a3450'], tags: ['tank', 'armor', 'mana', 'haste'],
  passives: [ROCK_SOLID, ['冬之抚', '使 700 码内敌方英雄的攻击速度降低 20%。']],
  init(champ, st) {
    const b = new Bag(champ);
    rockSolid(b, champ, st);
    b.add(ticker(champ, st, { tag: 'aura', interval: 0.25, onTick: () => {
      for (const u of champ.game.queryUnits({ x: champ.x, y: champ.y, radius: 700, enemyOf: champ, types: ['champion'] })) {
        u.addBuff({ id: 'item_frozenheart_aura', name: '冬之抚', desc: '攻击速度降低 20%', icon: iconOf('frozenheart'), source: champ, duration: 0.5, isDebuff: true, data: {},
          onApply: (v, buff) => { buff.data.unhook = v.addHook('modifyStats', (s) => { s.attackSpeed = Math.max(0.2, s.attackSpeed * 0.8); }); },
          onRemove: (v, buff) => { if (buff.data.unhook) buff.data.unhook(); } });
      }
    } }));
    return b.done();
  } });
L({ id: 'locket', name: '钢铁烈阳之匣', cost: 2500, from: ['kindlegem', 'nullmagic', 'clotharmor'], stats: { hp: 200, armor: 25, mr: 25, abilityHaste: 10 },
  cat: 'support', variant: 0, glyph: '匣', tags: ['support', 'tank', 'armor', 'mr'],
  active: {
    name: '奉献', desc: '为 800 码内的友方英雄（包括自己）提供 200~360（随等级）的护盾，在 2.5 秒内衰减。', cooldown: 90, targeting: 'self',
    cast(champ) {
      if (!champ.canUseSummoner()) return false;
      const game = champ.game;
      const amt = lvl(champ, 200, 360);
      for (const a of alliedChampsNear(champ, champ.x, champ.y, 800)) {
        decayShield(a, amt, 2.5, { source: champ, id: 'item_locket' });
        game.fx.shield({ unit: a, color: 0xffe08a, duration: 2.5, radius: 110 });
      }
      game.fx.ring({ x: champ.x, y: champ.y, radius: 800, color: 0xffe08a, duration: 0.6, expand: true });
      return true;
    },
    ai: { kind: 'shield', radius: 800, when: (c) => {
      if (visibleEnemyChamps(c, 1200).length === 0) return false;
      const allies = alliedChampsNear(c, c.x, c.y, 750);
      const hurt = allies.filter((a) => inCombat(a, 1.5));
      return hurt.length >= 2 || hurt.some((a) => a.hp / a.maxHp < 0.4);
    } },
  } });
L({ id: 'redemption', name: '救赎', cost: 2300, from: ['forbiddenidol', 'rubycrystal'], stats: { hp: 200, abilityHaste: 15, manaRegenPct: 1.0, healShieldPower: 0.10 },
  cat: 'support', variant: 1, glyph: '救', tags: ['support', 'hp', 'mana', 'haste'],
  active: {
    name: '干预', desc: '指定 5500 码内的区域，2.5 秒后为其中 550 码内的友方英雄回复 200~400（随目标等级）生命值。', cooldown: 90, targeting: 'point', range: 5500,
    cast(champ, st, ctx = {}) {
      const game = champ.game;
      let x = ctx.x ?? champ.x, y = ctx.y ?? champ.y;
      const d = Math.hypot(x - champ.x, y - champ.y);
      if (d > 5500) { x = champ.x + ((x - champ.x) / d) * 5500; y = champ.y + ((y - champ.y) / d) * 5500; }
      game.fx.telegraph({ x, y, radius: 550, color: 0xffe9a0, duration: 2.5 });
      game.spawnZone({
        owner: champ, x, y, radius: 550, delay: 2.5, duration: 0, filter: 'ally', types: ['champion'], vfx: { kind: 'ring', color: 0xffe9a0 },
        onTick: (zone, units) => {
          for (const u of units) {
            itemHeal(champ, u, lvl(u, 200, 400), { spell: 'redemption' });
            game.fx.attach({ unit: u, kind: 'heal', color: 0xffe9a0, duration: 1 });
          }
          game.fx.burst({ x, y, color: 0xffe9a0, count: 30, size: 22, speed: 380, duration: 0.7 });
        },
      });
      return true;
    },
    ai: { kind: 'heal', range: 5500, when: (c) => {
      const cand = c.game.champions.filter((a) => a.alive && a.team === c.team && c.distTo(a) <= 5500 && a.hp / a.maxHp < 0.4 && inCombat(a, 2));
      if (cand.length === 0) return false;
      cand.sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp);
      return { x: cand[0].x, y: cand[0].y };
    } },
  } });

// —— 合成去向 into ——
for (const d of Object.values(ITEMS)) {
  for (const f of d.from) {
    const c = ITEMS[f];
    if (c && !c.into.includes(d.id)) c.into.push(d.id);
  }
}

// —— 商店分类与列表（UI 用） ——
export const SHOP_CATEGORIES = [
  { id: 'all', name: '全部', tags: null },
  { id: 'starter', name: '起始', tags: ['starter'] },
  { id: 'consumable', name: '消耗品', tags: ['consumable'] },
  { id: 'boots', name: '鞋子', tags: ['boots'] },
  { id: 'ad', name: '攻击', tags: ['ad', 'crit', 'as', 'lethality', 'onhit', 'lifesteal'] },
  { id: 'ap', name: '法术', tags: ['ap', 'mana'] },
  { id: 'tank', name: '防御', tags: ['tank', 'armor', 'mr', 'hp'] },
  { id: 'support', name: '辅助', tags: ['support', 'jungle'] },
];
const TIER_RANK = { starter: 0, consumable: 1, basic: 2, boots: 3, epic: 4, legendary: 5 };
export const ITEM_LIST = Object.values(ITEMS).filter((d) => d.purchasable).sort((a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (a.cost - b.cost));
export function itemsInCategory(catId) {
  const cat = SHOP_CATEGORIES.find((c) => c.id === catId);
  if (!cat || !cat.tags) return ITEM_LIST;
  return ITEM_LIST.filter((d) => d.tags.some((t) => cat.tags.includes(t)));
}
// 合成树：{ id, children: [...] }
export function itemTree(id) {
  const d = ITEMS[id];
  if (!d) return null;
  return { id, children: d.from.map((f) => itemTree(f)).filter(Boolean) };
}

// —— 推荐出装（符合当前版本主流思路；core 按购买顺序） ——
export const BUILDS = {
  garen:    { start: ['doransblade', 'healthpotion'], core: ['trinity', 'steraks', 'deadmans', 'deathsdance', 'randuin'], boots: 'plated', situational: ['spiritvisage', 'thornmail', 'guardianangel', 'stridebreaker'] },
  darius:   { start: ['doransblade', 'healthpotion'], core: ['stridebreaker', 'steraks', 'deadmans', 'deathsdance', 'spiritvisage'], boots: 'plated', situational: ['thornmail', 'randuin', 'guardianangel', 'sunfire'] },
  leesin:   { start: ['huntersmachete', 'healthpotion'], core: ['blackcleaver', 'steraks', 'deathsdance', 'guardianangel', 'youmuu'], boots: 'ionian', situational: ['randuin', 'spiritvisage', 'trinity'] },
  masteryi: { start: ['huntersmachete', 'healthpotion'], core: ['bork', 'guinsoo', 'witsend', 'steraks', 'deathsdance'], boots: 'berserkers', situational: ['guardianangel', 'kraken', 'quicksilver'] },
  ahri:     { start: ['doransring', 'healthpotion', 'healthpotion'], core: ['luden', 'shadowflame', 'rabadon', 'zhonya', 'voidstaff'], boots: 'sorcshoes', situational: ['rylai', 'morellonomicon', 'lichbane'] },
  lux:      { start: ['doransring', 'healthpotion', 'healthpotion'], core: ['luden', 'shadowflame', 'rabadon', 'voidstaff', 'zhonya'], boots: 'sorcshoes', situational: ['rylai', 'morellonomicon'] },
  annie:    { start: ['doransring', 'healthpotion', 'healthpotion'], core: ['luden', 'shadowflame', 'zhonya', 'rabadon', 'voidstaff'], boots: 'sorcshoes', situational: ['rylai', 'morellonomicon', 'lichbane'] },
  ashe:     { start: ['doransblade', 'healthpotion'], core: ['kraken', 'runaans', 'infinityedge', 'lorddominik', 'bloodthirster'], boots: 'berserkers', situational: ['bork', 'guardianangel', 'quicksilver', 'rapidfire'] },
  jinx:     { start: ['doransblade', 'healthpotion'], core: ['kraken', 'infinityedge', 'rapidfire', 'lorddominik', 'bloodthirster'], boots: 'berserkers', situational: ['runaans', 'guardianangel', 'quicksilver'] },
  thresh:   { start: ['worldatlas', 'healthpotion', 'healthpotion'], core: ['locket', 'redemption', 'frozenheart', 'randuin', 'spiritvisage'], boots: 'mercs', situational: ['thornmail', 'warmog', 'zhonya'] },
};
// 通用后备出装（按定位）
export const DEFAULT_BUILDS = {
  top: BUILDS.darius, jungle: BUILDS.leesin, mid: BUILDS.ahri, adc: BUILDS.jinx, support: BUILDS.thresh,
};

// —— 属性汇总：champ.items → champ.itemStats（韧性/穿透等按乘法叠加，重伤取最大） ——
const MULT_KEYS = new Set(['tenacity', 'damageReduction', 'armorPenPct', 'magicPenPct', 'damageDealtReduction', 'slowResist']);
const MAX_KEYS = new Set(['grievous']);
function addStats(out, src) {
  if (!src) return;
  for (const k in src) {
    const v = src[k];
    if (typeof v !== 'number' || v === 0) continue;
    if (MULT_KEYS.has(k)) out[k] = 1 - (1 - (out[k] || 0)) * (1 - v);
    else if (MAX_KEYS.has(k)) out[k] = Math.max(out[k] || 0, v);
    else out[k] = (out[k] || 0) + v;
  }
}
export function recomputeItemStats(champ) {
  const out = {};
  for (const it of champ.items || []) {
    if (!it || !it.def) continue;
    addStats(out, it.def.stats);
    if (it.extraStats) addStats(out, it.extraStats);
  }
  champ.itemStats = out;
  if (champ.recalcStats) champ.recalcStats();
  return out;
}
// 让 core 的 useItem（消耗品用完移除）也调用本汇总函数
export function installItemSystem(game) {
  if (game && game.recomputeItemStats !== recomputeItemStats) game.recomputeItemStats = recomputeItemStats;
  return game;
}

// —— 新建栏位状态 ——
export function createItemState(champ, id) {
  const def = ITEMS[id];
  return {
    id, def, uid: nextUid(), cooldownUntil: 0, cdDuration: 0,
    charges: def.consumable ? (def.consumable.charges ?? null) : null,
    stacks: def.maxStack > 1 ? 1 : null,
    data: {}, cleanup: null, counter: null, boughtAt: champ.game.time,
  };
}
// 初始化被动（返回清理函数保存在 st.cleanup）
export function initItemPassive(champ, st) {
  const p = st.def && st.def.passive;
  st.cleanup = null;
  if (p && typeof p.init === 'function') {
    const c = p.init(champ, st);
    if (typeof c === 'function') st.cleanup = c;
  }
  return st;
}
export function cleanupItem(st) {
  if (st && typeof st.cleanup === 'function') {
    const c = st.cleanup;
    st.cleanup = null;
    c();
  }
}

// —— AI：主动装备/消耗品使用建议（只使用可见信息） ——
// 返回 { slot, itemId, opts } 或 null；AI 调用 champ.useItem(slot, opts)
export function suggestItemUse(champ) {
  if (!champ || !champ.alive || inStasis(champ)) return null;
  const now = champ.game.time;
  for (let i = 0; i < champ.items.length; i++) {
    const it = champ.items[i];
    if (!it || !it.def) continue;
    const d = it.def;
    const hint = (d.active && d.active.ai) || (d.consumable && d.consumable.ai);
    if (!hint || !hint.when || it.cooldownUntil > now) continue;
    const r = hint.when(champ, it, champ.game);
    if (r) return { slot: i, itemId: it.id, opts: r === true ? {} : r };
  }
  return null;
}
