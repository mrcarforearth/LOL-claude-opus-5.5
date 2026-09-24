// 野怪与史诗野怪：LoL 数值与成长、仇恨/脱战回家（无敌回满）、营地联动、特殊技能（小龙吐息/男爵酸液与击飞/先锋冲撞）、
// 击杀奖励与 BUFF（蓝/红 BUFF 与转移、元素亚龙/龙魂/远古巨龙、纳什男爵之手、迅捷蟹视野与神龛）、友方峡谷先锋
import { Unit } from '../core/unit.js';
import { creditChampion } from '../core/damage.js';
import { TEAM_NAMES } from '../config.js';

// 野怪基础属性（近似 LoL）；gold/xp 为击杀奖励，cs 为补刀数
export const MONSTER_STATS = {
  blue_sentinel:   { name: '蓝色哨兵', hp: 2300, ad: 67, as: 0.493, range: 150, armor: 10, mr: -15, ms: 180, radius: 110, gold: 90, xp: 95, cs: 4 },
  red_brambleback: { name: '红色树精', hp: 2300, ad: 67, as: 0.6, range: 150, armor: 10, mr: -15, ms: 180, radius: 110, gold: 90, xp: 95, cs: 4 },
  gromp:           { name: '魔沼蛙', hp: 2200, ad: 70, as: 0.425, range: 250, armor: 0, mr: -15, ms: 330, radius: 100, gold: 80, xp: 110, cs: 4, missileSpeed: 1300, vfx: { kind: 'orb', color: 0x9cd35a, size: 1.3 } },
  murkwolf:        { name: '暗影狼', hp: 1600, ad: 42, as: 0.625, range: 175, armor: 10, mr: 0, ms: 443, radius: 80, gold: 55, xp: 55, cs: 2 },
  murkwolf_small:  { name: '幼狼', hp: 420, ad: 16, as: 0.625, range: 175, armor: 0, mr: 0, ms: 443, radius: 55, gold: 14, xp: 13, cs: 1, large: false },
  raptor:          { name: '锋喙鸟', hp: 1200, ad: 20, as: 0.667, range: 300, armor: 30, mr: 30, ms: 350, radius: 75, gold: 35, xp: 30, cs: 2, missileSpeed: 1300, vfx: { kind: 'orb', color: 0xff8a3a, size: 0.9 } },
  raptor_small:    { name: '小锋喙鸟', hp: 350, ad: 13, as: 1.0, range: 175, armor: 0, mr: 0, ms: 350, radius: 45, gold: 7, xp: 10, cs: 1, large: false },
  krug_ancient:    { name: '远古魔像', hp: 1350, ad: 57, as: 0.613, range: 150, armor: 20, mr: -15, ms: 285, radius: 105, gold: 20, xp: 25, cs: 1, split: 'krug_split' },
  krug:            { name: '魔像', hp: 1200, ad: 25, as: 0.613, range: 150, armor: 10, mr: -15, ms: 285, radius: 80, gold: 20, xp: 20, cs: 1, split: 'krug_mini' },
  krug_split:      { name: '魔像', hp: 400, ad: 20, as: 0.613, range: 150, armor: 0, mr: 0, ms: 285, radius: 65, gold: 10, xp: 12, cs: 1, large: false, split: 'krug_mini' },
  krug_mini:       { name: '小魔像', hp: 150, ad: 10, as: 0.613, range: 150, armor: 0, mr: 0, ms: 300, radius: 45, gold: 8, xp: 6, cs: 1, large: false },
  scuttle:         { name: '迅捷蟹', hp: 1100, ad: 0, as: 0.1, range: 0, armor: 42, mr: 42, ms: 180, radius: 85, gold: 55, xp: 115, cs: 4, passive: true },
  dragon:          { name: '元素亚龙', hp: 3500, ad: 100, as: 0.5, range: 500, armor: 21, mr: 30, ms: 330, radius: 170, gold: 25, xp: 200, cs: 4, epic: true, missileSpeed: 1500 },
  elder_dragon:    { name: '远古巨龙', hp: 6400, ad: 150, as: 0.5, range: 500, armor: 90, mr: 70, ms: 330, radius: 200, gold: 25, xp: 300, cs: 4, epic: true, missileSpeed: 1600 },
  baron:           { name: '纳什男爵', hp: 9000, ad: 150, as: 0.75, range: 450, armor: 120, mr: 70, ms: 0, radius: 220, gold: 300, xp: 600, cs: 4, epic: true, missileSpeed: 1600, vfx: { kind: 'orb', color: 0xa050ff, size: 2 } },
  herald:          { name: '峡谷先锋', hp: 6000, ad: 95, as: 0.5, range: 200, armor: 60, mr: 50, ms: 350, radius: 150, gold: 100, xp: 200, cs: 4, epic: true },
};
// 营地种类 → 默认怪物种类
const CAMP_DEFAULT = { blue: 'blue_sentinel', red: 'red_brambleback', wolves: 'murkwolf', raptors: 'raptor', krugs: 'krug_ancient', scuttle_top: 'scuttle', scuttle_bot: 'scuttle' };

export const DRAGON_TYPES = ['infernal', 'mountain', 'ocean', 'cloud'];
// 元素亚龙：每层全队永久 Buff 与龙魂
export const DRAGON_INFO = {
  infernal: {
    name: '炼狱亚龙', buffName: '炼狱亚龙之力', desc: '+8% 攻击力与法术强度（每层）', color: 0xff6a2a,
    stats: { adPct: 0.08, apPct: 0.08 }, icon: { glyph: '炼', bg: ['#ff7a3a', '#5a1a08'], fg: '#fff' },
    soulName: '炼狱龙魂', soulDesc: '攻击或技能命中英雄时引发爆炸，对周围敌人造成魔法伤害（3 秒冷却）',
  },
  mountain: {
    name: '山脉亚龙', buffName: '山脉亚龙之力', desc: '+8% 护甲与魔法抗性（每层）', color: 0xc8a06a,
    stats: { armorPct: 0.08, mrPct: 0.08 }, icon: { glyph: '山', bg: ['#c9a36a', '#3e2c14'], fg: '#fff' },
    soulName: '山脉龙魂', soulDesc: '5 秒未受到伤害后获得一层护盾',
  },
  ocean: {
    name: '海洋亚龙', buffName: '海洋亚龙之力', desc: '每 5 秒回复 2.5% 已损失生命值（每层）', color: 0x3ac0c8,
    stats: null, icon: { glyph: '海', bg: ['#3ac8c8', '#0a3a44'], fg: '#fff' },
    soulName: '海洋龙魂', soulDesc: '对英雄造成伤害后在 3 秒内回复生命与法力（4 秒冷却）',
  },
  cloud: {
    name: '云端亚龙', buffName: '云端亚龙之力', desc: '+7% 移动速度（每层）', color: 0xb8e0ff,
    stats: { moveSpeedPct: 0.07 }, icon: { glyph: '云', bg: ['#b8dcff', '#28405a'], fg: '#123' },
    soulName: '云端龙魂', soulDesc: '+10% 移动速度；施放终极技能后 6 秒内移动速度大幅提升',
  },
  elder: {
    name: '远古巨龙', buffName: '远古巨龙之威', desc: '对英雄造成伤害会灼烧目标；生命低于 20% 的敌方英雄会被处决', color: 0xc0f0ff,
    stats: null, icon: { glyph: '长', bg: ['#e0f4ff', '#3a4a6a'], fg: '#123' },
  },
};
export const JUNGLE_BUFF_DURATION = 120;
export const BARON_BUFF_DURATION = 180;
export const ELDER_BUFF_DURATION = 150;
export const HERALD_ALLY_LIFETIME = 240;
export const SCUTTLE_VISION_DURATION = 90;
const DEAGGRO_TIME = 8;           // 8 秒未被当前目标伤害 → 脱战
const THINK = 0.1;
const TEAM_COLORS = [0x5ab0ff, 0xff5a7a];

// 场上英雄平均等级（野怪成长依据）
function averageChampionLevel(game) {
  const cs = game.champions;
  if (!cs || cs.length === 0) return 1;
  let s = 0;
  for (const c of cs) s += c.level || 1;
  return s / cs.length;
}

// 生成时的属性倍率：普通野怪按英雄平均等级，史诗野怪按时间
function scaledStats(game, key, s) {
  const min = game.time / 60;
  let hp = s.hp, ad = s.ad;
  if (key === 'dragon') { hp += 150 * Math.max(0, min - 5); ad += 4 * Math.max(0, min - 5); }
  else if (key === 'elder_dragon') { hp += 180 * Math.max(0, min - 20); ad += 5 * Math.max(0, min - 20); }
  else if (key === 'baron') { hp += 180 * Math.max(0, min - 20); ad += 8 * Math.max(0, min - 20); }
  else if (key === 'herald') { hp += 120 * Math.max(0, min - 8); ad += 3 * Math.max(0, min - 8); }
  else if (key !== 'scuttle') {
    const L = Math.max(1, Math.min(18, averageChampionLevel(game)));
    hp *= 1 + 0.05 * (L - 1);
    ad *= 1 + 0.06 * (L - 1);
  } else {
    const L = Math.max(1, Math.min(18, averageChampionLevel(game)));
    hp *= 1 + 0.04 * (L - 1);
  }
  return { hp: Math.round(hp), ad };
}

// —— 蓝/红 BUFF ——
function dropOnDeath(u, b, reason, kind) {
  if (reason !== 'death' || u.type !== 'champion') return;
  const remaining = Math.max(0, b.expiresAt - u.game.time);
  (u._droppedJungleBuffs || (u._droppedJungleBuffs = [])).push({ kind, remaining });
}

export function applyBlueBuff(champ, duration = JUNGLE_BUFF_DURATION) {
  return champ.addBuff({
    id: 'blue_buff', name: '洞悉烙印', desc: '+10 技能急速；每秒回复 1% 最大法力/能量',
    icon: { glyph: '蓝', bg: ['#4aa0ff', '#0b2a55'], fg: '#fff' },
    duration, stats: { abilityHaste: 10 }, tickInterval: 1,
    onInterval: (u) => { if (u.maxMana > 0) u.mana = Math.min(u.maxMana, u.mana + u.maxMana * 0.01); },
    onRemove: (u, b, reason) => dropOnDeath(u, b, reason, 'blue'),
    data: { jungleBuff: 'blue' },
  });
}

// 红 BUFF 灼烧：3 秒内造成真实伤害并减速
function redBurn(champ, target) {
  if (!target || !target.alive || target.isStructure || target.type === 'ward') return;
  const game = champ.game;
  target.addBuff({
    id: 'red_buff_burn', name: '余烬灼烧', desc: '持续受到真实伤害并被减速', isDebuff: true, source: champ,
    icon: { glyph: '灼', bg: ['#ff7a3a', '#5a1a08'], fg: '#fff' },
    duration: 3, tickInterval: 0.5,
    onInterval: (u, b) => {
      const src = b.source || champ;
      const total = 10 + 2.5 * (src.level || 1);
      game.dealDamage(src, u, total / 6, 'true', { isDot: true, spell: 'red_buff' });
    },
  });
  const ranged = (champ.baseStats.missileSpeed || 0) > 0;
  target.slow(ranged ? 0.05 : 0.1, 3, champ);
}

export function applyRedBuff(champ, duration = JUNGLE_BUFF_DURATION) {
  return champ.addBuff({
    id: 'red_buff', name: '余烬烙印', desc: '普攻灼烧目标（3 秒真实伤害）并减速；脱离战斗 5 秒后每秒回复 1% 最大生命值',
    icon: { glyph: '红', bg: ['#ff5a3a', '#5a1408'], fg: '#fff' },
    duration, tickInterval: 1,
    onApply: (u, b) => { b.data.unhook = u.addHook('afterHit', (target) => redBurn(u, target)); },
    onInterval: (u) => {
      if (u.alive && u.hp < u.maxHp && u.game.time - (u.lastCombatAt ?? -99) >= 5) u.game.heal(u, u, u.maxHp * 0.01, { silent: true, noPower: true, spell: 'red_buff' });
    },
    onRemove: (u, b, reason) => { if (b.data.unhook) b.data.unhook(); dropOnDeath(u, b, reason, 'red'); },
    data: { jungleBuff: 'red' },
  });
}

// 持有者被敌方英雄击杀：BUFF 以剩余时间转移给击杀者
export function transferJungleBuffs(game, victim, killerChampion) {
  const list = victim._droppedJungleBuffs;
  victim._droppedJungleBuffs = null;
  if (!list || !killerChampion || killerChampion.team === victim.team || killerChampion.type !== 'champion') return;
  for (const d of list) {
    if (d.remaining < 1) continue;
    if (d.kind === 'blue') applyBlueBuff(killerChampion, d.remaining);
    else if (d.kind === 'red') applyRedBuff(killerChampion, d.remaining);
  }
}

// —— 元素亚龙 / 龙魂 / 远古巨龙 ——
function addDragonStack(champ, type) {
  const info = DRAGON_INFO[type];
  const def = {
    id: `dragon_${type}`, name: info.buffName, desc: info.desc, icon: info.icon,
    duration: Infinity, persistOnDeath: true, refresh: 'stack', maxStacks: 9, stacks: 1, statsPerStack: true,
    stats: info.stats, data: { dragonType: type },
  };
  if (type === 'ocean') {
    def.tickInterval = 5;
    def.onInterval = (u, b) => {
      if (!u.alive || u.hp >= u.maxHp) return;
      u.game.heal(u, u, (u.maxHp - u.hp) * 0.025 * b.stacks, { silent: true, noPower: true, spell: 'dragon_ocean' });
    };
  }
  return champ.addBuff(def);
}

function installSoul(u, type, b) {
  const game = u.game;
  const off = [];
  if (type === 'infernal') {
    let ready = 0;
    off.push(u.addHook('afterDealDamage', (ctx) => {
      const t = ctx.target;
      if (!t || t.type !== 'champion' || ctx.isDot || (ctx.spell && ctx.spell.startsWith('dragon_')) || game.time < ready) return;
      ready = game.time + 3;
      const s = u.stats;
      const dmg = 80 + 0.225 * (s.bonusAd || 0) + 0.15 * (s.ap || 0) + 0.0275 * (s.bonusHp || 0);
      const hits = game.queryUnits({ x: t.x, y: t.y, radius: 250, enemyOf: u, types: ['champion', 'minion', 'monster', 'pet'] });
      for (const e of hits) game.dealDamage(u, e, dmg, 'magic', { spell: 'dragon_infernal_soul', isAoE: true });
      game.fx.burst({ x: t.x, y: t.y, color: 0xff6a20, count: 26, size: 28, speed: 420, duration: 0.6 });
    }));
  } else if (type === 'mountain') {
    b.onTick = (unit) => {
      if (!unit.alive || game.time - (unit.lastDamagedAt ?? -99) < 5) return;
      if (unit.shields.some((sh) => sh.id === 'dragon_mountain_soul')) return;
      const s = unit.stats;
      unit.addShield(180 + 0.18 * (s.bonusAd || 0) + 0.135 * (s.ap || 0) + 0.135 * (s.bonusHp || 0), Infinity, { id: 'dragon_mountain_soul', source: unit, noPower: true });
    };
  } else if (type === 'ocean') {
    let ready = 0;
    off.push(u.addHook('afterDealDamage', (ctx) => {
      const t = ctx.target;
      if (!t || t.type !== 'champion' || ctx.isDot || game.time < ready || !u.alive) return;
      ready = game.time + 4;
      const s = u.stats;
      const heal = 160 + 0.4 * (s.bonusAd || 0) + 0.3 * (s.ap || 0) + 0.1 * (s.bonusHp || 0);
      u.addBuff({
        id: 'dragon_ocean_soul_heal', name: '海洋龙魂', hidden: true, duration: 3, tickInterval: 0.5,
        onInterval: (unit) => {
          game.heal(unit, unit, heal / 6, { silent: true, noPower: true, spell: 'dragon_ocean_soul' });
          if (unit.maxMana > 0) unit.mana = Math.min(unit.maxMana, unit.mana + unit.maxMana * 0.01);
        },
      });
    }));
  } else if (type === 'cloud') {
    off.push(u.addHook('onAbilityCast', (slot) => {
      if (slot !== 'R') return;
      u.addBuff({
        id: 'dragon_cloud_soul_haste', name: '云端龙魂', desc: '移动速度大幅提升', duration: 6,
        icon: DRAGON_INFO.cloud.icon, statsFn: (unit, bb) => ({ moveSpeedPct: 0.6 * (1 - bb.progress * 0.5) }),
      });
    }));
  }
  b.data.off = off;
}

function addDragonSoul(champ, type) {
  const info = DRAGON_INFO[type];
  return champ.addBuff({
    id: 'dragon_soul', name: info.soulName, desc: info.soulDesc, icon: { ...info.icon, glyph: '魂' },
    duration: Infinity, persistOnDeath: true, refresh: 'none',
    stats: type === 'cloud' ? { moveSpeedPct: 0.1 } : null, data: { dragonType: type },
    onApply: (u, b) => installSoul(u, type, b),
    onRemove: (u, b) => { for (const f of b.data.off || []) f(); },
  });
}

// 击杀元素亚龙：全队永久叠加 Buff；第 4 条获得龙魂
export function grantDragon(game, team, type, soulType = null) {
  const ts = game.teams[team];
  ts.dragons.push(type);
  for (const c of game.champions) if (c.team === team) addDragonStack(c, type);
  let soul = null;
  if (ts.dragons.length >= 4 && !game.teams.some((t) => t.dragonSoul)) {
    soul = soulType || type;
    ts.dragonSoul = soul;
    for (const c of game.champions) if (c.team === team) addDragonSoul(c, soul);
  }
  return soul;
}

function addElderBuff(champ) {
  const game = champ.game;
  return champ.addBuff({
    id: 'elder_dragon', name: DRAGON_INFO.elder.buffName, desc: DRAGON_INFO.elder.desc, icon: DRAGON_INFO.elder.icon,
    duration: ELDER_BUFF_DURATION, removeOnDeath: true,
    onApply: (u, b) => {
      b.data.off = u.addHook('afterDealDamage', (ctx) => {
        const t = ctx.target;
        if (!t || t.type !== 'champion' || t.team === u.team || (ctx.spell && ctx.spell.startsWith('elder_'))) return;
        if (!t.alive) return;
        // 处决：生命低于 20%
        if (t.hp < t.maxHp * 0.2) {
          game.fx.burst({ x: t.x, y: t.y, h: 120, color: 0xc0f0ff, count: 30, size: 30, speed: 400, duration: 0.8 });
          game.dealDamage(u, t, t.hp + t.totalShield + 10, 'true', { spell: 'elder_execute' });
          return;
        }
        if (ctx.isDot) return;
        t.addBuff({
          id: 'elder_burn', name: '远古灼烧', isDebuff: true, source: u, duration: 3, tickInterval: 0.5,
          onInterval: (unit, bb) => {
            const min = game.time / 60;
            const total = 75 + 7.5 * Math.max(0, min - 25);
            game.dealDamage(bb.source || u, unit, total / 6, 'true', { isDot: true, spell: 'elder_burn' });
          },
        });
      });
    },
    onRemove: (u, b) => { if (b.data.off) b.data.off(); },
  });
}

export function grantElder(game, team) {
  const ts = game.teams[team];
  ts.elderKills = (ts.elderKills || 0) + 1;
  for (const c of game.champions) if (c.team === team && c.alive) addElderBuff(c);
}

// —— 纳什男爵之手 ——
export function baronBuffValues(time) {
  const min = time / 60;
  const ad = Math.round(Math.max(24, Math.min(48, 24 + 1.2 * (min - 20))));
  const ap = Math.round(ad * 5 / 3);
  return { ad, ap };
}
export function grantBaron(game, team) {
  const now = game.time;
  const ts = game.teams[team];
  ts.baronKills++;
  ts.baronUntil = now + BARON_BUFF_DURATION;
  const { ad, ap } = baronBuffValues(now);
  for (const c of game.champions) {
    if (c.team !== team || !c.alive) continue;
    c.addBuff({
      id: 'baron', name: '纳什男爵之手', desc: `+${ad} 攻击力、+${ap} 法术强度；回城只需 4 秒；强化附近的友方小兵`,
      icon: { glyph: '男', bg: ['#b070ff', '#2a0a4a'], fg: '#fff' },
      duration: BARON_BUFF_DURATION, removeOnDeath: true, stats: { ad, ap }, data: { recallTime: 4 },
    });
    game.fx.aura({ unit: c, color: 0xb070ff, radius: 120, duration: 2 });
  }
}

// —— 迅捷蟹：击杀方获得视野与移速神龛 ——
export function grantScuttle(game, team, x, y) {
  if (game.vision && game.vision.addRevealer) {
    game.vision.addRevealer({ team, x, y, radius: 1000, duration: SCUTTLE_VISION_DURATION });
  }
  game.spawnZone({
    owner: null, team, x, y, radius: 420, duration: SCUTTLE_VISION_DURATION, filter: 'ally', types: ['champion'], tickInterval: 0.25,
    vfx: { kind: 'ring', color: 0x7fe7ff, opacity: 0.3 }, data: { scuttleShrine: true },
    onEnter: (z, u) => {
      u.addBuff({
        id: 'scuttle_shrine', name: '迅捷神龛', desc: '移动速度提升（逐渐衰减）', duration: 4.5,
        icon: { glyph: '速', bg: ['#7fe7ff', '#0a3a4a'], fg: '#123' },
        statsFn: (unit, b) => ({ moveSpeedPct: 0.45 * (1 - b.progress) }),
      });
    },
  });
}

// —— 峡谷先锋：选择兵线并召唤 ——
const TIER_ORDER = ['outer', 'inner', 'inhib'];
function laneFrontTurret(game, enemyTeam, lane) {
  for (const tier of TIER_ORDER) {
    const t = game.structures.find((s) => s.type === 'turret' && s.team === enemyTeam && s.lane === lane && s.tier === tier);
    if (t && t.alive) return t;
  }
  return null;
}
export function pickHeraldLane(game, team, x, y) {
  let best = 'mid', bd = Infinity;
  for (const lane of ['top', 'mid', 'bot']) {
    const t = laneFrontTurret(game, 1 - team, lane);
    if (!t) continue;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < bd) { bd = d; best = lane; }
  }
  return best;
}
export function heraldChargeDamage(time) {
  return Math.min(2750, 2000 + 50 * Math.max(0, time / 60 - 8));
}
export function summonHerald(game, team, x, y) {
  const p = game.nav.isWalkable(x, y) ? { x, y } : game.nav.nearestWalkable(x, y);
  const h = new SummonedHerald(game, { team, x: p.x, y: p.y });
  h.setPosition(p.x, p.y);
  game.add(h);
  if (game.vision && game.vision.addRevealer) game.vision.addRevealer({ team, follow: h, radius: 900, duration: HERALD_ALLY_LIFETIME });
  game.fx.burst({ x: p.x, y: p.y, h: 120, color: TEAM_COLORS[team], count: 40, size: 34, speed: 420, duration: 1 });
  return h;
}

// ============================================================================
// 野怪
// ============================================================================
export class Monster extends Unit {
  constructor(game, { kind, camp = null, campKind = null, campState = null, x, y, leash = 900, facing = 0, dragonType = null, path = null } = {}) {
    const key = kind === 'dragon' && dragonType === 'elder' ? 'elder_dragon'
      : MONSTER_STATS[kind] ? kind : (CAMP_DEFAULT[kind] || 'gromp');
    const s = MONSTER_STATS[key];
    const sc = scaledStats(game, key, s);
    const dname = kind === 'dragon' && dragonType && DRAGON_INFO[dragonType] ? DRAGON_INFO[dragonType].name : s.name;
    const dcolor = kind === 'dragon' && dragonType && DRAGON_INFO[dragonType] ? DRAGON_INFO[dragonType].color : 0xff6a2a;
    super(game, {
      type: 'monster', team: 2, x, y, name: dname, modelId: `monster_${MONSTER_STATS[kind] ? kind : key}`,
      baseStats: {
        hp: sc.hp, ad: sc.ad, as: s.as, asRatio: s.as, range: s.range, armor: s.armor, mr: s.mr, ms: s.ms,
        radius: s.radius, resource: 'none', missileSpeed: s.missileSpeed || 0, windup: 0.3, hpRegen: 0,
        attackVfx: s.vfx || (kind === 'dragon' ? { kind: 'fireball', color: dcolor, size: 1.8 } : null),
        missileHeight: kind === 'dragon' ? 260 : kind === 'baron' ? 300 : 100,
      },
      radius: s.radius,
    });
    this.kind = MONSTER_STATS[kind] ? kind : key;
    this.statKey = key;
    this.campKind = campKind || kind;
    this.camp = camp;
    this.campState = campState;
    this.dragonType = kind === 'dragon' ? (dragonType || 'infernal') : null;
    this.homeX = x;
    this.homeY = y;
    this.homeFacing = facing;
    this.facing = facing;
    this.leash = leash;
    this.epic = !!s.epic;
    this.large = s.large !== false;
    this.passiveMonster = !!s.passive;
    this.stationary = (s.ms || 0) <= 0;
    this.goldValue = kind === 'scuttle' ? Math.round(Math.min(121, s.gold + 3 * game.time / 60)) : s.gold;
    this.xpValue = s.xp;
    this.csValue = s.cs ?? 1;
    this.customRewards = this.epic;
    this.softCollision = true;
    this.sightRange = 0;
    this.aggroTarget = null;
    this.aggroAt = 0;
    this.threat = new Map();          // 攻击者 → 最后一次造成伤害的时间
    this.resetting = false;
    this.patrolPath = path && path.length ? path : null;
    this._patrolIdx = 0;
    this._abilityCd = {};
    this._nextThink = game.time + (this.id % 5) * 0.02;
    this.addHook('afterTakeDamage', (ctx) => this._onDamaged(ctx.source));
    if (this.kind === 'herald') this._setupHeraldEye();
  }

  get inCombat() { return !!this.aggroTarget || this.resetting; }

  // 受到伤害：仇恨首个攻击者，并通知营地同伴
  _onDamaged(src) {
    if (!src || !this.alive || this.resetting) return;
    if (src.team === this.team || src.isStructure) return;
    const now = this.game.time;
    this.threat.set(src, now);
    if (this.passiveMonster) {
      // 迅捷蟹：受击后被减速
      this._lastAttacker = src;
      this.addBuff({ id: 'scuttle_exhausted', hidden: true, duration: 2, stats: { moveSpeedPct: -0.45 } });
      return;
    }
    if (!this.aggroTarget) {
      this.aggroTarget = src;
      this.aggroAt = now;
      this._abilityCd.first = now + 2.5;
    }
    // 营地共享仇恨：同伴一起攻击并刷新脱战计时
    const mates = this.campState && this.campState.units;
    if (mates) {
      for (const m of mates) {
        if (m === this || !m.alive || m.resetting || m.passiveMonster) continue;
        m.threat.set(src, now);
        if (!m.aggroTarget) { m.aggroTarget = src; m.aggroAt = now; }
      }
    }
  }

  _validAggro(t) {
    if (!t || !t.alive || t.removed || t.untargetable) return false;
    if (t.team === this.team) return false;
    if (Math.hypot(t.x - this.homeX, t.y - this.homeY) > this.leash + 250) return false;
    return t.isTargetableBy(this);
  }

  // 仇恨目标暂时无法被攻击时保持仇恨（不回满），返回是否处于等待
  _briefHold(t, sinceHit) {
    if (!t || !t.alive || t.removed || t.team === this.team || sinceHit > DEAGGRO_TIME) return false;
    if (Math.hypot(t.x - this.homeX, t.y - this.homeY) > this.leash + 250) return false;
    if (this.command && this.command.type === 'attack') this.command = null;
    this.attackState = null;
    this.attackTarget = null;
    this.path.length = 0;
    this.faceTowards(t.x, t.y);
    return true;
  }

  // 8 秒内伤害过自己、仍有效的其他攻击者（最近的一次优先）
  _nextThreat(exclude = null) {
    const now = this.game.time;
    let best = null, bt = -Infinity;
    for (const [u, t] of this.threat) {
      if (u === exclude || now - t > DEAGGRO_TIME || !this._validAggro(u)) continue;
      if (t > bt) { best = u; bt = t; }
    }
    return best;
  }

  startReset() {
    this.resetting = true;
    this.invulnerable = true;
    this.aggroTarget = null;
    this.threat.clear();
    this.attackState = null;
    this.attackTarget = null;
    this.command = null;
    this.path.length = 0;
    if (!this.stationary) this.moveTo(this.homeX, this.homeY);
  }

  _finishReset() {
    this.resetting = false;
    this.invulnerable = false;
    this.hp = this.maxHp;
    this.command = null;
    this.path.length = 0;
    this.facing = this.homeFacing;
    this.ccs.length = 0;
    for (const b of this.buffs.slice()) if (b.isDebuff) this.removeBuff(b);
  }

  // 固定不动的野怪（男爵）不追击
  _chase(dt, target) {
    if (this.stationary) return false;
    return super._chase(dt, target);
  }

  _engage(t) {
    if (this.stationary && !this.inAttackRange(t)) {
      if (this.command && this.command.type === 'attack') this.command = null;
      this.faceTowards(t.x, t.y);
      return;
    }
    this.attackUnit(t);
  }

  _think() {
    const game = this.game;
    const now = game.time;
    const homeD = Math.hypot(this.x - this.homeX, this.y - this.homeY);
    if (this.resetting) {
      if (homeD < 60 || this.stationary) this._finishReset();
      else if (!this.command || this.command.type !== 'move' || this.path.length === 0) this.moveTo(this.homeX, this.homeY);
      return;
    }
    if (this.passiveMonster) { this._thinkScuttle(now); return; }
    let t = this.aggroTarget;
    if (t) {
      if (homeD > this.leash) { this.startReset(); return; }
      const lastHit = this.threat.get(t) ?? this.aggroAt;
      if (!this._validAggro(t) || now - lastHit > DEAGGRO_TIME) {
        const cur = t;
        t = this._nextThreat(cur);
        // 目标只是暂时不可选取（阿尔法突袭、凝滞、隐身等）且仍在营地范围内：原地等待，8 秒未受伤才脱战
        if (!t && this._briefHold(cur, now - lastHit)) return;
      }
      if (!t) { this.startReset(); return; }
      if (t !== this.aggroTarget) { this.aggroTarget = t; this.aggroAt = now; }
      this._engage(t);
      return;
    }
    // 空闲：回到营地原位
    if (homeD > 80 && !this.stationary && (!this.command || this.command.type !== 'move' || this.path.length === 0)) this.moveTo(this.homeX, this.homeY);
    else if (homeD <= 80 && !this.moving) this.facing = this.homeFacing;
  }

  // 迅捷蟹：沿河道巡游，受击后逃跑但会被减速；10 秒未受伤回满生命
  _thinkScuttle(now) {
    const path = this.patrolPath;
    const hitRecently = now - (this.lastDamagedAt ?? -99) < 6;
    if (this.hp < this.maxHp && now - (this.lastDamagedAt ?? -99) > 10) { this.hp = this.maxHp; this.threat.clear(); }
    if (!path) return;
    if (hitRecently) {
      if (!this.hasBuff('scuttle_flee')) this.addBuff({ id: 'scuttle_flee', hidden: true, duration: 6, stats: { moveSpeedPct: 0.6 } });
      const a = this._lastAttacker;
      if (a && a.alive && (!this.command || this.path.length === 0 || now >= (this._fleeRepath || 0))) {
        this._fleeRepath = now + 1.2;
        let best = null, bd = -1;
        for (let i = 0; i < path.length; i++) {
          const d = Math.hypot(path[i][0] - a.x, path[i][1] - a.y) - 0.3 * Math.hypot(path[i][0] - this.x, path[i][1] - this.y);
          if (d > bd) { bd = d; best = i; }
        }
        if (best != null) { this._patrolIdx = best; this.moveTo(path[best][0], path[best][1]); }
      }
      return;
    }
    const p = path[this._patrolIdx % path.length];
    const d = Math.hypot(p[0] - this.x, p[1] - this.y);
    if (d < 80) {
      this._patrolIdx = (this._patrolIdx + 1) % path.length;
      const q = path[this._patrolIdx];
      this.moveTo(q[0], q[1]);
    } else if (!this.command || this.command.type !== 'move' || this.path.length === 0) {
      this.moveTo(p[0], p[1]);
    }
  }

  // —— 技能 ——
  _ready(key, cd) {
    const now = this.game.time;
    if (now < (this._abilityCd.first ?? 0)) return false;
    if (now < (this._abilityCd[key] ?? 0)) return false;
    this._abilityCd[key] = now + cd;
    return true;
  }

  _updateAbilities() {
    const t = this.aggroTarget;
    if (!t || !t.alive || this.resetting || !this.canCast() || this.attackState || this.dashState) return;
    const d = this.distTo(t);
    if (this.kind === 'dragon') {
      if (d <= 900 + t.radius && this._ready('breath', this.dragonType === 'elder' ? 6 : 7)) this._dragonBreath(t);
    } else if (this.kind === 'baron') {
      if (d <= 1150 && this._ready('acid', 9)) this._baronAcid(t);
      else if (d <= 900 && this._ready('slam', 14)) this._baronSlam(t);
    } else if (this.kind === 'herald') {
      if (d >= 250 && d <= 900 && this._ready('charge', 10)) this._heraldCharge(t);
    }
  }

  // 小龙吐息：对目标区域造成魔法伤害，附带元素效果
  _dragonBreath(t) {
    const game = this.game;
    const type = this.dragonType;
    const color = DRAGON_INFO[type] ? DRAGON_INFO[type].color : 0xff6a2a;
    this.faceTowards(t.x, t.y);
    this.playCastAnim('Q', 0.6);
    const dmg = this.stats.ad * (type === 'elder' ? 1.6 : 1.1);
    const radius = type === 'cloud' ? 330 : 260;
    game.spawnProjectile({
      owner: this, target: t, speed: 1300, width: 0, height: 260,
      vfx: { kind: 'fireball', color, size: type === 'elder' ? 2.6 : 2.1, trail: true },
      onHit: (u, proj) => {
        const cx = proj.x, cy = proj.y;
        game.fx.burst({ x: cx, y: cy, color, count: 30, size: 30, speed: 360, duration: 0.7 });
        game.fx.ring({ x: cx, y: cy, radius, color, duration: 0.5, expand: true });
        const hits = game.queryUnits({ x: cx, y: cy, radius, enemyOf: this, types: ['champion', 'minion', 'pet', 'monster'], filter: (x) => x.team !== 2 });
        for (const e of hits) {
          game.dealDamage(this, e, dmg, 'magic', { isAbility: true, isAoE: true, spell: 'dragon_breath' });
          if (!e.alive) continue;
          if (type === 'ocean') e.slow(0.3, 2, this);
          else if (type === 'mountain') e.applyCC('stun', 0.4, { source: this });
          else if (type === 'infernal' || type === 'elder') {
            e.addBuff({
              id: 'dragon_breath_burn', name: '龙焰灼烧', isDebuff: true, source: this, duration: 3, tickInterval: 1,
              onInterval: (unit, b) => game.dealDamage(b.source || this, unit, dmg * 0.1, 'magic', { isDot: true, spell: 'dragon_burn' }),
            });
          }
        }
        return true;
      },
    });
  }

  // 男爵酸液：直线 AOE 魔法伤害 + 腐蚀（降低双抗）+ 减速
  _baronAcid(t) {
    const game = this.game;
    this.faceTowards(t.x, t.y);
    this.playCastAnim('Q', 0.7);
    const dx = t.x - this.x, dy = t.y - this.y;
    const l = Math.hypot(dx, dy) || 1;
    const len = 1150;
    const x2 = this.x + (dx / l) * len, y2 = this.y + (dy / l) * len;
    game.fx.line({ x1: this.x, y1: this.y, x2, y2, width: 150, color: 0x9a4dff, duration: 0.8 });
    const hits = game.queryLine({ x1: this.x, y1: this.y, x2, y2, width: 130, enemyOf: this, types: ['champion', 'minion', 'pet', 'monster'], filter: (u) => u.team !== 2 });
    const dmg = 0.6 * this.stats.ad + 80;
    for (const e of hits) {
      game.dealDamage(this, e, dmg, 'magic', { isAbility: true, isAoE: true, spell: 'baron_acid' });
      if (!e.alive) continue;
      e.slow(0.5, 2, this);
      e.addBuff({ id: 'baron_corrosion', name: '腐蚀', desc: '护甲与魔法抗性降低', isDebuff: true, source: this, duration: 4.5, stats: { armorPct: -0.15, mrPct: -0.15 }, icon: { glyph: '蚀', bg: ['#9a4dff', '#200a3a'], fg: '#fff' } });
    }
  }

  // 男爵击飞：延迟后在目标区域击飞并造成物理伤害
  _baronSlam(t) {
    const game = this.game;
    this.playCastAnim('W', 0.8);
    const x = t.x, y = t.y;
    const dmg = this.stats.ad * 1.0;
    game.spawnZone({
      owner: this, team: this.team, x, y, radius: 280, delay: 1.1, duration: 0, filter: 'enemy',
      vfx: { kind: 'disc', color: 0x9a4dff, opacity: 0.35 },
      onStart: () => game.fx.burst({ x, y, color: 0x7a3dcf, count: 30, size: 30, speed: 420, duration: 0.6 }),
      onTick: (z, units) => {
        for (const e of units) {
          if (e.team === 2) continue;
          game.dealDamage(this, e, dmg, 'physical', { isAbility: true, isAoE: true, spell: 'baron_slam' });
          if (e.alive) e.knockup(1.0, this);
        }
      },
    });
    game.fx.telegraph({ x, y, radius: 280, color: 0x9a4dff, duration: 1.1 });
  }

  // 峡谷先锋冲撞：前摇后冲向目标，击退路径上的敌人
  _heraldCharge(t) {
    const game = this.game;
    this.faceTowards(t.x, t.y);
    this.playCastAnim('R', 0.7);
    this.command = null;
    this.path.length = 0;
    const tx = t.x, ty = t.y;
    const dmg = this.stats.ad * 1.5;
    game.fx.telegraph({ x: this.x, y: this.y, x2: tx, y2: ty, width: 150, color: 0xb07aff, duration: 0.6 });
    game.after(0.6, () => {
      if (!this.alive || this.resetting) return;
      this.dash({
        x: tx, y: ty, speed: 1100, hitRadius: 130,
        hitFilter: (u) => u.team !== 2,
        onHitUnit: (u) => {
          game.dealDamage(this, u, dmg, 'physical', { isAbility: true, spell: 'herald_ram' });
          if (u.alive) u.knockback({ fromX: this.x, fromY: this.y, distance: 220, duration: 0.35, source: this });
        },
      });
    });
  }

  // 峡谷先锋背后的眼睛：睁眼时从背后普攻造成额外真实伤害
  _setupHeraldEye() {
    this.modelState.eyeOpen = false;
    this._eyeAt = this.game.time + 5;
    this.addHook('afterTakeDamage', (ctx) => {
      if (!this.modelState.eyeOpen || !ctx.isBasicAttack || !ctx.source || !this.alive) return;
      const a = Math.atan2(ctx.source.y - this.y, ctx.source.x - this.x);
      let diff = Math.abs(a - this.facing) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < Math.PI * 0.6) return;
      this.modelState.eyeOpen = false;
      this._eyeAt = this.game.time + 7;
      this.game.fx.burst({ x: this.x, y: this.y, h: 180, color: 0xc07aff, count: 20, size: 24, speed: 300, duration: 0.5 });
      this.game.dealDamage(ctx.source, this, this.maxHp * 0.07, 'true', { spell: 'herald_eye' });
    });
  }

  _updateHeraldEye() {
    const now = this.game.time;
    if (!this.modelState.eyeOpen && this.aggroTarget && now >= this._eyeAt) {
      this.modelState.eyeOpen = true;
      this._eyeCloseAt = now + 3;
    } else if (this.modelState.eyeOpen && now >= (this._eyeCloseAt ?? 0)) {
      this.modelState.eyeOpen = false;
      this._eyeAt = now + 5;
    }
  }

  update(dt) {
    if (this.alive) {
      const now = this.game.time;
      if (now >= this._nextThink) { this._nextThink = now + THINK; this._think(); }
      if (this.resetting && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
      if (this.aggroTarget && !this.resetting) this._updateAbilities();
      if (this.kind === 'herald') this._updateHeraldEye();
    }
    super.update(dt);
  }

  // —— 死亡 ——
  die(killer) {
    if (!this.alive) return;
    const game = this.game;
    const credit = creditChampion(killer);
    const killTeam = credit ? credit.team : (killer && (killer.team === 0 || killer.team === 1) ? killer.team : null);
    super.die(killer);
    if (this.alive) return;
    this.killTeam = killTeam;
    if (this.customRewards) this._epicRewards(credit, killTeam);
    this._onKilled(credit, killTeam, killer);
    if (game.spawner && game.spawner.onMonsterDeath) game.spawner.onMonsterDeath(this, credit, killTeam);
  }

  // 史诗野怪奖励：金币给击杀者（男爵全队），经验给击杀方全队
  _epicRewards(credit, killTeam) {
    const game = this.game;
    if (credit) {
      credit.cs += this.csValue;
      credit.jungleCs = (credit.jungleCs || 0) + this.csValue;
    }
    if (killTeam == null) return;
    for (const c of game.champions) {
      if (c.team !== killTeam) continue;
      if (this.kind === 'baron') c.gainGold(this.goldValue, 'objective', this.x, this.y);
      c.gainXp(this.xpValue);
    }
    if (this.kind !== 'baron' && credit && this.goldValue > 0) credit.gainGold(this.goldValue, 'objective', this.x, this.y);
  }

  _onKilled(credit, killTeam, killer) {
    const game = this.game;
    switch (this.kind) {
      case 'blue_sentinel': if (credit) applyBlueBuff(credit); break;
      case 'red_brambleback': if (credit) applyRedBuff(credit); break;
      case 'dragon': {
        if (killTeam == null) break;
        if (this.dragonType === 'elder') {
          grantElder(game, killTeam);
          game.announce('dragonSlain', `${TEAM_NAMES[killTeam]}击杀了远古巨龙`, { team: killTeam, killer: credit, subject: this });
        } else {
          const soul = grantDragon(game, killTeam, this.dragonType, game.spawner ? game.spawner.soulType : null);
          const nm = DRAGON_INFO[this.dragonType].name;
          const text = soul ? `${TEAM_NAMES[killTeam]}击杀了${nm}，获得了${DRAGON_INFO[soul].soulName}` : `${TEAM_NAMES[killTeam]}击杀了${nm}`;
          game.announce('dragonSlain', text, { team: killTeam, killer: credit, subject: this });
        }
        break;
      }
      case 'baron':
        if (killTeam == null) break;
        grantBaron(game, killTeam);
        game.announce('baronSlain', `${TEAM_NAMES[killTeam]}击杀了纳什男爵`, { team: killTeam, killer: credit, subject: this });
        break;
      case 'herald':
        if (killTeam == null) break;
        game.teams[killTeam].heraldKills++;
        summonHerald(game, killTeam, this.homeX, this.homeY);
        game.announce('heraldSlain', `${TEAM_NAMES[killTeam]}击杀了峡谷先锋`, { team: killTeam, killer: credit, subject: this });
        break;
      case 'scuttle':
        if (killTeam != null) grantScuttle(game, killTeam, this.x, this.y);
        break;
      default: break;
    }
    // 魔像分裂
    const split = MONSTER_STATS[this.kind] && MONSTER_STATS[this.kind].split;
    if (split) this._split(split, killer);
  }

  _split(kind, killer) {
    const game = this.game;
    for (let i = 0; i < 2; i++) {
      const a = this.facing + (i === 0 ? Math.PI / 2 : -Math.PI / 2);
      const x = this.x + Math.cos(a) * 70, y = this.y + Math.sin(a) * 70;
      const m = new Monster(game, {
        kind, camp: this.camp, campKind: this.campKind, campState: this.campState,
        x, y, leash: this.leash, facing: this.facing,
      });
      m.setPosition(x, y);
      m.homeX = this.homeX + Math.cos(a) * 90;
      m.homeY = this.homeY + Math.sin(a) * 90;
      if (!game.nav.isWalkable(m.homeX, m.homeY)) { m.homeX = m.x; m.homeY = m.y; }
      game.add(m);
      if (this.campState) this.campState.units.push(m);
      if (killer && killer.alive && killer.team !== 2 && !killer.isStructure) {
        m.threat.set(killer, game.time);
        m.aggroTarget = killer;
        m.aggroAt = game.time;
      }
    }
  }
}

// ============================================================================
// 友方峡谷先锋：沿兵线冲向敌方防御塔，撞击造成大量伤害后消失
// ============================================================================
export class SummonedHerald extends Unit {
  constructor(game, { team, x, y, lane = null } = {}) {
    const min = game.time / 60;
    super(game, {
      type: 'monster', team, x, y, name: '峡谷先锋', modelId: 'monster_herald',
      baseStats: {
        hp: Math.round(3000 + 100 * Math.max(0, min - 8)), ad: 110 + 3 * Math.max(0, min - 8), as: 0.5, asRatio: 0.5, range: 200,
        armor: 60, mr: 50, ms: 350, radius: 150, resource: 'none', windup: 0.35, hpRegen: 0,
      },
      radius: 150,
    });
    this.kind = 'herald_ally';
    this.campKind = 'herald';
    this.camp = null;
    this.summoned = true;
    this.large = true;
    this.epic = false;
    this.customRewards = true;
    this.goldValue = 0;
    this.xpValue = 0;
    this.csValue = 0;
    this.softCollision = true;
    this.sightRange = 900;
    this.expiresAt = game.time + HERALD_ALLY_LIFETIME;
    this.lane = lane || pickHeraldLane(game, team, x, y);
    this.phase = 'march';            // march | windup | charge | done
    this.chargeTarget = null;
    this._nextThink = 0;
    this._repathAt = 0;
    this.modelState.eyeOpen = true;
  }

  get remaining() { return Math.max(0, this.expiresAt - this.game.time); }

  expire() {
    if (!this.alive) return;
    this.expired = true;
    this.die(null);
  }

  // 本路最前的可攻击敌方建筑；本路已推平则选最近的可攻击建筑
  _targetStructure() {
    const game = this.game;
    const enemy = 1 - this.team;
    const t = laneFrontTurret(game, enemy, this.lane);
    if (t && !t.invulnerable) return t;
    let best = null, bd = Infinity;
    for (const s of game.structures) {
      if (s.team !== enemy || !s.alive || s.invulnerable || s.kind === 'fountainTurret') continue;
      const d = Math.hypot(s.x - this.x, s.y - this.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  _think() {
    const game = this.game;
    const now = game.time;
    if (this.phase !== 'march') return;
    const s = this._targetStructure();
    if (s) {
      const d = this.distTo(s) - s.radius;
      if (d <= 900 && this.canDash() && this.canCast()) { this._startCharge(s); return; }
    }
    // 路上的敌人：近身时顺手攻击
    const blocker = game.nearest({
      x: this.x, y: this.y, radius: 260, enemyOf: this, targetableBy: this, types: ['minion', 'champion', 'pet', 'monster'],
      filter: (u) => u.team !== 2 && !u.untargetable,
    });
    if (blocker) { this.attackUnit(blocker); return; }
    if (!s) return;
    if (!this.command || this.command.type !== 'move' || this.path.length === 0 || now >= this._repathAt) {
      this._repathAt = now + 2.5;
      this.moveTo(s.x, s.y);
    }
  }

  _startCharge(s) {
    const game = this.game;
    this.phase = 'windup';
    this.chargeTarget = s;
    this.stop();
    this.faceTowards(s.x, s.y);
    this.playCastAnim('R', 1.0);
    this.modelState.charging = true;
    game.fx.telegraph({ x: this.x, y: this.y, x2: s.x, y2: s.y, width: 170, color: TEAM_COLORS[this.team], duration: 1.0 });
    game.after(1.0, () => {
      if (!this.alive) return;
      if (!s.alive) { this.phase = 'march'; this.modelState.charging = false; return; }
      this.phase = 'charge';
      const ok = this.dash({
        x: s.x, y: s.y, speed: 1200, unstoppable: true, hitRadius: 140,
        hitFilter: (u) => u.team !== 2 && !u.isStructure,
        onHitUnit: (u) => {
          game.dealDamage(this, u, 150 + this.stats.ad, 'physical', { isAbility: true, spell: 'herald_ram' });
          if (u.alive) u.knockback({ fromX: this.x, fromY: this.y, distance: 250, duration: 0.35, source: this });
        },
        onEnd: () => this._impact(s),
      });
      if (!ok) { this.phase = 'march'; this.modelState.charging = false; }
    });
  }

  _impact(s) {
    const game = this.game;
    if (!this.alive) return;
    this.phase = 'done';
    this.modelState.charging = false;
    const reach = s.radius + this.radius + 220;
    if (s.alive && this.distTo(s) <= reach) {
      game.dealDamage(this, s, heraldChargeDamage(game.time), 'true', { spell: 'herald_charge', isAbility: true });
    }
    const around = game.queryUnits({ x: this.x, y: this.y, radius: 350, enemyOf: this, types: ['champion', 'minion', 'pet'], filter: (u) => u.team !== 2 });
    for (const u of around) {
      game.dealDamage(this, u, 200, 'physical', { isAbility: true, isAoE: true, spell: 'herald_ram' });
      if (u.alive) u.knockback({ fromX: this.x, fromY: this.y, distance: 250, duration: 0.35, source: this });
    }
    game.fx.burst({ x: this.x, y: this.y, h: 120, color: TEAM_COLORS[this.team], count: 50, size: 40, speed: 600, duration: 1 });
    game.fx.ring({ x: this.x, y: this.y, radius: 400, color: 0xc07aff, duration: 0.6, expand: true });
    this.expire();
  }

  update(dt) {
    const game = this.game;
    if (this.alive && game.time >= this.expiresAt && this.phase !== 'charge') { this.expire(); return; }
    if (this.alive && game.time >= this._nextThink) { this._nextThink = game.time + 0.2; this._think(); }
    super.update(dt);
  }
}
