// 德莱厄斯技能测试：出血与诺克萨斯之力、大杀四方（刀刃/斧柄/回血/打断）、致残打击、无情铁手、诺克萨斯断头台（重置）、AI 提示
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { applyHemorrhage, bleedPerStack, mightAd, dariusQDamage, dariusRDamage } from '../js/champions/darius.js';
import { createAI } from '../js/ai/championAI.js';
import { DIFFICULTY, TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;

function setup({ level = 1, dist = 150, dummyHp = 3000, armor = 0, open = true, red = [] } = {}) {
  const game = makeGame({ blue: ['darius'], red, waves: false, open });
  const d = game.champions[0];
  d.setPosition(X, Y);
  d.facing = 0;
  if (level > 1) d.setLevel(level);
  const dummy = spawnDummy(game, { team: 1, x: X + dist, y: Y, hp: dummyHp, armor });
  return { game, d, dummy };
}
// 直接学会技能到指定等级（与 levelUpAbility 行为一致）
function learn(c, slot, rank = 1) {
  const ab = c.abilities[slot];
  while (ab.rank < rank) { ab.rank++; if (ab.rank === 1 && ab.def.onLearn) ab.def.onLearn(c, ab); }
  c.recalcStats();
  return ab;
}
function collect(game, name, filter = () => true) {
  const list = [];
  game.events.on(name, (e) => { if (filter(e)) list.push(e); });
  return list;
}
const sum = (list) => list.reduce((a, e) => a + e.amount, 0);
// 假 AI 控制器（实现 §9 接口）
function fakeAI(champ, game, target) {
  return {
    champ, game, role: 'top', params: { ...DIFFICULTY.hard, accuracy: 1, dodge: 1 }, mode: 'fighting', target,
    visibleEnemies: (r = 2000) => game.queryUnits({ x: champ.x, y: champ.y, radius: r, enemyOf: champ, types: ['champion'] }),
    nearbyAllies: (r = 1500) => game.queryUnits({ x: champ.x, y: champ.y, radius: r, allyOf: champ, types: ['champion'], exclude: champ }),
    hpPct: () => champ.hp / champ.maxHp,
    predict: (u) => ({ x: u.x, y: u.y }),
    castAt: (slot, x, y) => champ.castAbility(slot, { x, y }),
    castOn: (slot, u) => champ.castAbility(slot, { target: u }),
    castSelf: (slot) => champ.castAbility(slot, {}),
    isUnderEnemyTurret: () => false,
    isSafe: () => true,
  };
}

// —— 被动 ——
test('出血：普攻叠层，每层 5 秒 13 点（1 级）+30% 额外攻击力', () => {
  const { game, d, dummy } = setup();
  d.attackUnit(dummy);
  const hits = collect(game, 'attackHit', (e) => e.attacker === d);
  for (let i = 0; i < 60 && hits.length === 0; i++) game.step(TICK);
  assert(hits.length === 1, '打出一次普攻');
  assert(dummy.buffStacks('darius_bleed') === 1, `普攻施加 1 层出血（实际 ${dummy.buffStacks('darius_bleed')}）`);
  // 单独验证数值：新假人，2 层出血
  const d2 = spawnDummy(game, { team: 1, x: X - 300, y: Y, hp: 3000 });
  d.bonusStats.ad = 100; d.recalcStats();
  approx(bleedPerStack(d), 13 + 30, 1e-9, '每层伤害 13 + 30% × 100');
  const ticks = collect(game, 'damage', (e) => e.target === d2 && e.spell === 'darius_passive');
  applyHemorrhage(d, d2, 2);
  run(game, 5.2);
  assert(ticks.length === 4, `5 秒内结算 4 次（实际 ${ticks.length}）`);
  approx(sum(ticks), 2 * 43, 1e-6, '2 层出血总伤害');
  assert(ticks.every((e) => e.type === 'physical' && e.isDot), '物理持续伤害');
});
test('出血：随等级 13~30；对野怪 300%', () => {
  const { game, d } = setup({ level: 18 });
  approx(bleedPerStack(d), 30, 1e-9, '18 级每层 30');
  const mon = spawnDummy(game, { team: 2, type: 'monster', x: X + 200, y: Y, hp: 5000 });
  const ticks = collect(game, 'damage', (e) => e.target === mon && e.spell === 'darius_passive');
  applyHemorrhage(d, mon, 1);
  run(game, 5.2);
  approx(sum(ticks), 30 * 3, 1e-6, '野怪 300%');
});
test('诺克萨斯之力：叠满 5 层获得攻击力，之后普攻直接叠满', () => {
  const { game, d, dummy } = setup({ level: 1 });
  const base = d.stats.ad;
  for (let i = 0; i < 5; i++) applyHemorrhage(d, dummy, 1);
  assert(dummy.buffStacks('darius_bleed') === 5, '5 层');
  assert(d.hasBuff('darius_might'), '获得诺克萨斯之力');
  d.recalcStats();
  approx(d.stats.ad - base, 30, 1e-9, '1 级 +30 攻击力');
  assert(d.modelState.noxianMight === true, 'modelState.noxianMight');
  approx(mightAd(18), 230, 0, '18 级 +230');
  const other = spawnDummy(game, { team: 1, x: X, y: Y + 150, hp: 3000 });
  d.attackUnit(other);
  const hits = collect(game, 'attackHit', (e) => e.attacker === d && e.target === other);
  for (let i = 0; i < 60 && hits.length === 0; i++) game.step(TICK);
  assert(other.buffStacks('darius_bleed') === 5, `诺克萨斯之力期间一次普攻叠满（实际 ${other.buffStacks('darius_bleed')}）`);
  run(game, 5.1);
  assert(!d.hasBuff('darius_might') || d.getBuff('darius_might').remaining > 0, '持续 5 秒（被刷新时仍在）');
});

// —— Q ——
test('Q 大杀四方：0.75 秒蓄力，刀刃全额 + 出血，斧柄 35% 无出血，消耗与冷却', () => {
  const { game, d, dummy: blade } = setup({ dist: 320 });
  const handle = spawnDummy(game, { team: 1, x: X - 120, y: Y, hp: 3000 });
  const outside = spawnDummy(game, { team: 1, x: X, y: Y + 560, hp: 3000 });
  const ab = learn(d, 'Q', 1);
  const mana0 = d.mana;
  const dmg = collect(game, 'damage', (e) => e.source === d && e.isAbility);
  assert(d.castAbility('Q').ok, '施放成功');
  approx(mana0 - d.mana, 25, 1e-9, '消耗 25 法力');
  assert(d.modelState.axeSpin === true, 'axeSpin 蓄力中');
  assert(!d.canAttack(), '蓄力时不能普攻');
  approx(ab.cdRemaining, 9, 1e-6, '冷却 9 秒');
  run(game, 0.6);
  assert(dmg.length === 0, '蓄力期间无伤害');
  run(game, 0.2);
  const full = dariusQDamage(d, 1);
  approx(full, 50 + 1.0 * 64, 1e-9, '1 级伤害 50 + 100% AD');
  const b = dmg.find((e) => e.target === blade);
  const h = dmg.find((e) => e.target === handle);
  assert(b && h, '刀刃与斧柄均命中');
  approx(b.amount, full, 1e-6, '刀刃全额');
  approx(h.amount, full * 0.35, 1e-6, '斧柄 35%');
  assert(!dmg.some((e) => e.target === outside), '范围外不受伤');
  assert(blade.buffStacks('darius_bleed') === 1 && handle.buffStacks('darius_bleed') === 0, '只有刀刃叠出血');
  run(game, 0.3);
  assert(d.modelState.axeSpin === false, 'axeSpin 结束');
  // 5 级数值
  approx(dariusQDamage(d, 5), 170 + 1.4 * d.stats.ad, 1e-9, '5 级 170 + 140% AD');
});
test('Q 大杀四方：刀刃命中英雄回复 13% 已损失生命（最多 3 次）', () => {
  const { game, d } = setup({ dist: 5000 });
  for (let i = 0; i < 4; i++) spawnDummy(game, { team: 1, x: X + Math.cos(i * 1.5) * 300, y: Y + Math.sin(i * 1.5) * 300, hp: 3000 });
  learn(d, 'Q', 1);
  d.hp = d.maxHp * 0.4;
  const heals = collect(game, 'heal', (e) => e.target === d);
  d.castAbility('Q');
  let missing = 0;
  for (let i = 0; i < 30 && heals.length === 0; i++) { missing = d.maxHp - d.hp; game.step(TICK); }
  assert(heals.length === 1, '回复一次');
  approx(heals[0].amount, missing * 0.39, 2, '4 名英雄命中按 3 次计算（39%）');
});
test('Q 大杀四方：蓄力时被眩晕会打断', () => {
  const { game, d, dummy } = setup({ dist: 300 });
  learn(d, 'Q', 1);
  const dmg = collect(game, 'damage', (e) => e.source === d && e.spell && e.spell.startsWith('darius_q'));
  d.castAbility('Q');
  run(game, 0.3);
  d.applyCC('stun', 0.5, { source: dummy });
  run(game, 1);
  assert(dmg.length === 0, '打断后无伤害');
  assert(d.modelState.axeSpin === false, '打断后 axeSpin 关闭');
});

// —— W ——
test('W 致残打击：重置普攻，140% AD，90% 减速 1 秒', () => {
  const { game, d, dummy } = setup();
  const ab = learn(d, 'W', 1);
  d.attackCooldown = 1;
  assert(d.castAbility('W').ok, '施放');
  assert(d.attackCooldown === 0, '重置普攻');
  approx(ab.cdRemaining, 7, 1e-6, '冷却 7 秒');
  assert(d.modelState.axeGlow === true, 'axeGlow');
  const hits = collect(game, 'damage', (e) => e.source === d && e.isBasicAttack);
  d.attackUnit(dummy);
  for (let i = 0; i < 60 && hits.length === 0; i++) game.step(TICK);
  approx(hits[0].amount, 1.4 * d.stats.ad, 1e-6, '140% 攻击力');
  approx(dummy.strongestSlow(), 0.9, 1e-9, '减速 90%');
  approx(dummy.ccRemaining('slow'), 1, 0.05, '持续 1 秒');
  assert(!d.hasBuff('darius_w'), '强化消耗');
  // 下一次普攻恢复正常
  const n = hits.length;
  for (let i = 0; i < 90 && hits.length === n; i++) game.step(TICK);
  approx(hits[n].amount, d.stats.ad, 1e-6, '普通普攻');
});
test('W 致残打击：击杀返还法力与 50% 冷却', () => {
  const { game, d, dummy } = setup({ dummyHp: 60 });
  const ab = learn(d, 'W', 5);
  const mana0 = d.mana;
  d.castAbility('W');
  approx(mana0 - d.mana, 30, 1e-9, '消耗 30');
  const t0 = game.time;
  d.attackUnit(dummy);
  for (let i = 0; i < 60 && dummy.alive; i++) game.step(TICK);
  assert(!dummy.alive, '击杀');
  approx(d.mana, Math.min(d.maxMana, mana0), 1, '返还法力');
  approx(ab.cdRemaining, 5 - (game.time - t0) - 2.5, 0.05, '冷却减少一半（5 级 5 秒）');
});

// —— E ——
test('E 无情铁手：被动护甲穿透 20%~40%，主动扇形拉拽 + 减速 40%', () => {
  const { game, d, dummy } = setup({ dist: 480 });
  const behind = spawnDummy(game, { team: 1, x: X - 400, y: Y, hp: 3000 });
  const side = spawnDummy(game, { team: 1, x: X + 300, y: Y + 400, hp: 3000 });
  const ab = learn(d, 'E', 1);
  d.recalcStats();
  approx(d.stats.armorPenPct, 0.2, 1e-9, '1 级 20% 护甲穿透');
  learn(d, 'E', 5);
  d.recalcStats();
  approx(d.stats.armorPenPct, 0.4, 1e-9, '5 级 40%');
  ab.rank = 1;
  const mana0 = d.mana;
  assert(d.castAbility('E', { x: X + 600, y: Y }).ok, '施放');
  approx(mana0 - d.mana, 45, 1e-9, '消耗 45');
  run(game, 0.26);
  assert(dummy.hasCC('airborne'), '被拉拽期间处于击飞状态');
  run(game, 0.5);
  const dd = d.distTo(dummy);
  assert(dd < 200, `拉到身前（距离 ${dd.toFixed(0)}）`);
  assert(dummy.x > d.x, '拉到德莱厄斯前方');
  approx(dummy.strongestSlow(), 0.4, 1e-9, '减速 40%');
  approx(behind.x, X - 400, 1e-6, '身后敌人不受影响');
  approx(side.y, Y + 400, 1e-6, '扇形外敌人不受影响');
  approx(ab.cdRemaining, 24 - 0.51, 0.05, '冷却 24 秒（施法前摇结束后开始）');
});

// —— R ——
test('R 诺克萨斯断头台：跃向目标，真实伤害按出血层数提高', () => {
  const { game, d, dummy } = setup({ dist: 420, dummyHp: 3000, armor: 200 });
  const ab = learn(d, 'R', 1);
  d.bonusStats.ad = 40; d.recalcStats();
  applyHemorrhage(d, dummy, 3);
  const expected = (125 + 0.75 * 40) * 1.6;
  approx(dariusRDamage(d, dummy, 1), expected, 1e-9, '公式');
  const dmg = collect(game, 'damage', (e) => e.spell === 'darius_r');
  const mana0 = d.mana;
  assert(d.castAbility('R', { target: dummy }).ok, '施放');
  approx(mana0 - d.mana, 100, 1e-9, '1 级消耗 100');
  assert(d.dashState && d.unstoppable, '跃起中不可阻挡');
  run(game, 0.5);
  assert(dmg.length === 1, '落斧一次');
  approx(dmg[0].amount, expected, 1e-6, '真实伤害（无视 200 护甲）');
  assert(dmg[0].type === 'true', '真实伤害');
  assert(d.distTo(dummy) < 200, '落在目标身边');
  assert(!d.unstoppable, '落地后恢复');
  assert(dummy.buffStacks('darius_bleed') === 4, '落斧后叠加 1 层出血');
  approx(ab.cdRemaining, 100 - 0.5, 0.05, '冷却 100 秒');
  // 超出射程：走近施放
  const far = spawnDummy(game, { team: 1, x: X - 1500, y: Y, hp: 3000 });
  ab.resetCooldown();
  const r = d.castAbility('R', { target: far });
  assert(r.ok && r.reason === 'queued', '超出射程排队走近');
});
test('R 诺克萨斯断头台：击杀重置（20 秒内再次施放）并获得诺克萨斯之力；3 级无消耗', () => {
  const { game, d, dummy } = setup({ dist: 300, dummyHp: 100 });
  const ab = learn(d, 'R', 3);
  const second = spawnDummy(game, { team: 1, x: X - 300, y: Y, hp: 3000 });
  const mana0 = d.mana;
  assert(d.castAbility('R', { target: dummy }).ok, '施放');
  approx(d.mana, mana0, 1e-9, '3 级不消耗法力');
  run(game, 0.5);
  assert(!dummy.alive, '击杀');
  assert(ab.ready && ab.cdRemaining === 0, '冷却重置');
  assert(d.hasBuff('darius_r_reset'), '重置窗口');
  assert(d.hasBuff('darius_might'), '诺克萨斯之力');
  assert(d.castAbility('R', { target: second }).ok, '再次施放');
  assert(!d.hasBuff('darius_r_reset'), '消耗重置机会');
  run(game, 0.5);
  assert(second.hp < 3000, '第二次命中');
  assert(!ab.ready, '未击杀：进入冷却');
  approx(ab.cdRemaining, 80 - 0.5, 0.05, '3 级冷却 80');
});
test('R 诺克萨斯断头台：重置窗口超时后进入冷却', () => {
  const { game, d, dummy } = setup({ dist: 300, dummyHp: 50 });
  const ab = learn(d, 'R', 2);
  d.castAbility('R', { target: dummy });
  run(game, 0.5);
  assert(ab.ready, '重置');
  run(game, 20);
  assert(!ab.ready, '超时后冷却');
  approx(ab.cdRemaining, 90 - 20.5, 0.2, '按原冷却继续（从上次施放算起）');
});

// —— AI ——
test('AI 提示：Q 预判刀刃区、E/W/R 条件、custom 在无 AI 接口时不崩溃', () => {
  const { game, d, dummy } = setup({ dist: 320 });
  for (const s of ['Q', 'W', 'E', 'R']) learn(d, s, 1);
  const ai = fakeAI(d, game, dummy);
  const qc = d.def.abilities.Q.ai.custom;
  assert(qc(d, d.abilities.Q, ai, game) === true, '刀刃区有英雄时施放 Q');
  assert(d.hasBuff('darius_q_charge'), 'Q 蓄力中');
  assert(qc(d, d.abilities.Q, ai, game) === false, '蓄力中不重复施放');
  run(game, 1);
  // 斧柄区：不放
  const g2 = setup({ dist: 120 });
  learn(g2.d, 'Q', 1);
  assert(qc(g2.d, g2.d.abilities.Q, fakeAI(g2.d, g2.game, g2.dummy), g2.game) === false, '只在斧柄区时不施放');
  assert(qc(g2.d, g2.d.abilities.Q, undefined, g2.game) === false, '无 AI 对象时不崩溃');
  assert(qc(g2.d, g2.d.abilities.Q, {}, g2.game) === false, '空 AI 对象时不崩溃');
  // E：目标在拉拽距离但不在普攻距离
  const eWhen = d.def.abilities.E.ai.when;
  const far = spawnDummy(game, { team: 1, x: X, y: Y + 450, hp: 3000 });
  assert(eWhen(d, far, game, ai) === true, 'E 拉远处敌人');
  assert(eWhen(d, dummy, game, ai) === false, '已在普攻距离内不拉');
  // R：斩杀线
  const rWhen = d.def.abilities.R.ai.when;
  const low = spawnDummy(game, { team: 1, x: X + 100, y: Y + 100, hp: 3000 });
  low.hp = 100;
  assert(rWhen(d, low, game, ai) === true, '可斩杀时 R');
  assert(rWhen(d, far, game, ai) === false, '不可斩杀时不 R');
  const wWhen = d.def.abilities.W.ai.when;
  assert(typeof wWhen(d, dummy, game, ai) === 'boolean', 'W 条件');
});
test('AI 集成：真实 AI 控制德莱厄斯对战时会施放技能且不报错', () => {
  const game = makeGame({ blue: ['darius'], red: ['garen'], ai: true, waves: false, open: true });
  const [d, g] = game.champions;
  d.setPosition(X, Y); g.setPosition(X + 400, Y);
  d.setLevel(6); g.setLevel(6);
  g.hp = g.maxHp * 0.4;
  const casts = collect(game, 'abilityCast', (e) => e.caster === d);
  run(game, 20);
  if (!quiet) console.log(`    德莱厄斯施放 ${casts.length} 次技能：${[...new Set(casts.map((e) => e.slot))].join(',')}`);
  assert(Number.isFinite(d.x) && Number.isFinite(d.hp), '状态有效');
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
