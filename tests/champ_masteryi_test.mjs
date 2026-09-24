// 易技能测试：双重打击、阿尔法突袭（单体重复/多目标/不可选中/普攻减冷却/躲技能）、冥想、无极剑道、高原血统、AI 提示
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { yiQDamage, yiWHealPerSec, yiEDamage, incomingThreat } from '../js/champions/masteryi.js';
import { DIFFICULTY, TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;

function setup({ level = 1, dist = 150, dummyHp = 3000, armor = 0, open = true, red = [] } = {}) {
  const game = makeGame({ blue: ['masteryi'], red, waves: false, open });
  const yi = game.champions[0];
  yi.setPosition(X, Y);
  yi.facing = 0;
  if (level > 1) yi.setLevel(level);
  const dummy = spawnDummy(game, { team: 1, x: X + dist, y: Y, hp: dummyHp, armor });
  return { game, yi, dummy };
}
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
function stepUntil(game, cond, maxSec = 3) {
  const n = Math.round(maxSec / TICK);
  for (let i = 0; i < n && !cond(); i++) game.step(TICK);
  return cond();
}
function fakeAI(champ, game, target, dodge = 1) {
  return {
    champ, game, role: 'jungle', params: { ...DIFFICULTY.hard, accuracy: 1, dodge }, mode: 'fighting', target,
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
test('双重打击：第 4 次普攻额外打出 50% AD 的第二击', () => {
  const { game, yi, dummy } = setup();
  const hits = collect(game, 'damage', (e) => e.source === yi && e.isBasicAttack);
  yi.attackUnit(dummy);
  stepUntil(game, () => hits.length >= 3, 6);
  assert(yi.buffStacks('masteryi_ds') === 3, `3 层（实际 ${yi.buffStacks('masteryi_ds')}）`);
  stepUntil(game, () => hits.length >= 5, 4);
  assert(hits.length >= 5, '第 4 次普攻出现第二击');
  approx(hits[3].amount, yi.stats.ad, 1e-6, '第 4 次普攻全额');
  approx(hits[4].amount, 0.5 * yi.stats.ad, 1e-6, '第二击 50%');
  assert(yi.buffStacks('masteryi_ds') === 0, '触发后清空层数');
  // 下一次普攻重新叠层
  const n = hits.length;
  stepUntil(game, () => hits.length > n, 3);
  assert(yi.buffStacks('masteryi_ds') === 1, '重新叠层');
});

// —— Q ——
test('Q 阿尔法突袭：单体时重复命中（后 3 次 25%），期间不可选中并隐藏模型', () => {
  const { game, yi, dummy } = setup({ dist: 450 });
  const ab = learn(yi, 'Q', 1);
  const dmg = collect(game, 'damage', (e) => e.spell === 'masteryi_q');
  const mana0 = yi.mana;
  assert(yi.castAbility('Q', { target: dummy }).ok, '施放');
  approx(mana0 - yi.mana, 50, 1e-9, '消耗 50');
  assert(yi.untargetable && yi.modelState.hidden === true, '不可选中 + 隐藏');
  assert(!yi.canMove() && !yi.canAttack(), '突袭中不能移动/普攻');
  approx(ab.cdRemaining, 20, 1e-6, '冷却 20');
  run(game, 0.9);
  assert(dmg.length === 4, `4 次闪击（实际 ${dmg.length}）`);
  const full = 30 + 0.5 * yi.stats.ad;
  approx(dmg[0].amount, full, 1e-6, '首击全额');
  for (let i = 1; i < 4; i++) approx(dmg[i].amount, full * 0.25, 1e-6, `第 ${i + 1} 击 25%`);
  assert(!yi.untargetable && yi.modelState.hidden === false, '结束后恢复');
  assert(yi.distTo(dummy) < 220, `出现在目标身边（${yi.distTo(dummy).toFixed(0)}）`);
  approx(yiQDamage(yi, dummy, 5), 150 + 0.5 * yi.stats.ad, 1e-9, '5 级 150');
});
test('Q 阿尔法突袭：多目标各命中一次，小兵/野怪额外伤害，可暴击', () => {
  const { game, yi, dummy } = setup({ dist: 400 });
  learn(yi, 'Q', 2);
  const m1 = spawnDummy(game, { team: 1, type: 'minion', x: X + 600, y: Y + 200, hp: 3000 });
  const m2 = spawnDummy(game, { team: 1, type: 'minion', x: X + 700, y: Y - 200, hp: 3000 });
  const mon = spawnDummy(game, { team: 2, type: 'monster', x: X + 800, y: Y, hp: 3000 });
  const dmg = collect(game, 'damage', (e) => e.spell === 'masteryi_q');
  yi.castAbility('Q', { target: dummy });
  run(game, 0.9);
  const targets = new Set(dmg.map((e) => e.target));
  assert(dmg.length === 4 && targets.size === 4, `4 个不同目标（${dmg.length}/${targets.size}）`);
  const base = 60 + 0.5 * yi.stats.ad;
  approx(dmg.find((e) => e.target === dummy).amount, base, 1e-6, '英雄');
  approx(dmg.find((e) => e.target === m1).amount, base + 100, 1e-6, '小兵 +100（2 级）');
  approx(dmg.find((e) => e.target === mon).amount, base + 100, 1e-6, '野怪 +100');
  // 暴击
  yi.bonusStats.crit = 1; yi.recalcStats();
  approx(yiQDamage(yi, dummy, 1, { crit: true }), 30 + 0.5 * yi.stats.ad + 0.6 * yi.stats.ad, 1e-9, '暴击 +60% AD');
  const g2 = setup({ dist: 300 });
  learn(g2.yi, 'Q', 1);
  g2.yi.bonusStats.crit = 1; g2.yi.recalcStats();
  const d2 = collect(g2.game, 'damage', (e) => e.spell === 'masteryi_q');
  g2.yi.castAbility('Q', { target: g2.dummy });
  run(g2.game, 0.9);
  assert(d2[0].isCrit, '暴击标记');
  approx(d2[0].amount, 30 + 1.1 * g2.yi.stats.ad, 1e-6, '暴击伤害');
});
test('Q 阿尔法突袭：普攻命中减少 1 秒冷却；突袭期间投射物无法命中', () => {
  const { game, yi, dummy } = setup({ dist: 300 });
  const ab = learn(yi, 'Q', 1);
  const shooter = spawnDummy(game, { team: 1, x: X - 700, y: Y, hp: 3000 });
  yi.castAbility('Q', { target: dummy });
  let hitYi = 0;
  game.spawnProjectile({ owner: shooter, dirX: 1, dirY: 0, range: 1500, speed: 3000, width: 80, onHit: (u) => { if (u === yi) hitYi++; } });
  run(game, 0.8);
  assert(hitYi === 0, '不可选中时躲开技能');
  const cd0 = ab.cdRemaining;
  const hits = collect(game, 'attackHit', (e) => e.attacker === yi);
  yi.attackUnit(dummy);
  stepUntil(game, () => hits.length >= 1);
  assert(cd0 - ab.cdRemaining > 0.99, `普攻减少 1 秒（${(cd0 - ab.cdRemaining).toFixed(2)}）`);
});

// —— W ——
test('W 冥想：每 0.5 秒回复（按已损失生命提高），前 0.5 秒减伤 90% 之后 40%，叠双重打击，移动打断', () => {
  const { game, yi, dummy } = setup({ dist: 300 });
  const ab = learn(yi, 'W', 1);
  yi.hp = yi.maxHp * 0.5;
  const heals = collect(game, 'heal', (e) => e.target === yi);
  yi.attackCooldown = 1;
  assert(yi.castAbility('W').ok, '施放');
  assert(yi.attackCooldown === 0, '重置普攻');
  assert(yi.channel && yi.modelState.meditating === true, '引导中');
  approx(ab.cdRemaining, 28, 1e-6, '冷却 28');
  // 减伤
  yi.recalcStats();
  const armorMult = 100 / (100 + yi.stats.armor);
  const d1 = game.dealDamage(dummy, yi, 100, 'physical');
  approx(d1, 100 * armorMult * 0.1, 1e-6, '前 0.5 秒减伤 90%');
  let missBefore = 0;
  for (let i = 0; i < 30 && heals.length === 0; i++) { missBefore = 1 - yi.hp / yi.maxHp; game.step(TICK); }
  approx(heals[0].amount, 15 * (1 + missBefore), 0.05, '首次回复 15 ×（1 + 已损失%）');
  run(game, 0.6);
  yi.recalcStats();
  const d2 = game.dealDamage(dummy, yi, 100, 'physical');
  approx(d2, 100 * armorMult * 0.6, 1e-6, '之后减伤 40%');
  run(game, 2.2);
  assert(yi.buffStacks('masteryi_ds') === 3, `引导 3 秒获得 3 层双重打击（实际 ${yi.buffStacks('masteryi_ds')}）`);
  yi.moveTo(X - 500, Y);
  assert(!yi.channel && yi.modelState.meditating === false, '移动打断');
  approx(yiWHealPerSec(yi, 5), 110, 1e-9, '5 级每秒 110');
});
test('W 冥想：完整引导 8 次回复；暂停无极剑道与高原血统的持续时间', () => {
  const { game, yi } = setup({ dist: 3000 });
  learn(yi, 'W', 1); learn(yi, 'E', 1); learn(yi, 'R', 1);
  yi.hp = yi.maxHp * 0.3;
  yi.castAbility('E');
  yi.castAbility('R');
  const eRem = yi.getBuff('masteryi_e').remaining;
  const heals = collect(game, 'heal', (e) => e.target === yi);
  yi.castAbility('W');
  assert(yi.hasBuff('masteryi_e') && yi.hasBuff('masteryi_r'), 'E/R 保持');
  run(game, 4.1);
  assert(heals.length === 8, `8 次回复（实际 ${heals.length}）`);
  assert(!yi.channel, '引导结束');
  approx(yi.getBuff('masteryi_e').remaining, eRem - 0.1, 0.1, '无极剑道暂停');
  // E 与 R 可在冥想中施放而不打断
  yi.abilities.W.resetCooldown();
  yi.abilities.E.resetCooldown();
  yi.castAbility('W');
  yi.castAbility('E');
  assert(yi.channel && yi.channel.id === 'masteryi_w', '施放 E 不打断冥想');
});

// —— E ——
test('E 无极剑道：5 秒内普攻附带 30+30% 额外 AD 真实伤害', () => {
  const { game, yi, dummy } = setup({ armor: 100 });
  const ab = learn(yi, 'E', 1);
  yi.bonusStats.ad = 50; yi.recalcStats();
  assert(yi.castAbility('E').ok, '施放');
  assert(yi.modelState.wuju === true, 'modelState.wuju');
  approx(ab.cdRemaining, 14, 1e-6, '冷却 14');
  const tru = collect(game, 'damage', (e) => e.spell === 'masteryi_e');
  yi.attackUnit(dummy);
  stepUntil(game, () => tru.length >= 1);
  approx(tru[0].amount, 30 + 0.3 * 50, 1e-6, '真实伤害无视护甲');
  assert(tru[0].type === 'true', '真实伤害');
  approx(yiEDamage(yi, 5), 50 + 15, 1e-9, '5 级 50');
  run(game, 5.1);
  assert(!yi.hasBuff('masteryi_e'), '5 秒结束');
});

// —— R ——
test('R 高原血统：移速/攻速加成，免疫减速；参与击杀减少基础技能冷却 70% 并延长 7 秒', () => {
  const { game, yi, dummy } = setup({ dist: 150, dummyHp: 50 });
  learn(yi, 'Q', 1); learn(yi, 'W', 1);
  const ab = learn(yi, 'R', 1);
  yi.slow(0.5, 3, dummy);
  yi.recalcStats();
  const ms0 = yi.stats.moveSpeed;
  const as0 = yi.stats.attackSpeed;
  assert(yi.castAbility('R').ok, '施放');
  assert(yi.modelState.highlander === true, 'highlander');
  approx(ab.cdRemaining, 85, 1e-6, '冷却 85');
  yi.recalcStats();
  const raw = 355 * 1.25;
  approx(yi.stats.moveSpeed, raw > 415 ? raw * 0.8 + 83 : raw, 1e-6, '+25% 移速（含软上限）');
  approx(yi.stats.attackSpeed, as0 + 0.679 * 0.25, 1e-9, '+25% 攻速');
  yi.slow(0.8, 2, dummy);
  yi.recalcStats();
  approx(yi.stats.moveSpeed, raw * 0.8 + 83, 1e-6, '免疫减速');
  assert(ms0 < 355, '施放前被减速');
  assert(!yi.hasCC('slow') || yi.stats.slow === 0, '施放时移除减速');
  // 参与击杀
  yi.abilities.Q.startCooldown();
  yi.abilities.W.startCooldown();
  const q0 = yi.abilities.Q.cdRemaining, w0 = yi.abilities.W.cdRemaining;
  const r0 = yi.getBuff('masteryi_r').remaining;
  game.dealDamage(yi, dummy, 1000, 'true');
  assert(!dummy.alive, '击杀');
  approx(yi.abilities.Q.cdRemaining, q0 * 0.3, 1e-6, 'Q 冷却 -70%');
  approx(yi.abilities.W.cdRemaining, w0 * 0.3, 1e-6, 'W 冷却 -70%');
  approx(yi.getBuff('masteryi_r').remaining, r0 + 7, 1e-6, '持续时间 +7 秒');
});

// —— AI ——
test('AI：检测来袭技能并用阿尔法突袭躲避；残血安全时冥想', () => {
  const { game, yi, dummy } = setup({ dist: 500 });
  for (const s of ['Q', 'W', 'E', 'R']) learn(yi, s, 1);
  const ai = fakeAI(yi, game, dummy, 1);
  const q = yi.def.abilities.Q.ai.custom;
  // 来袭的直线技能
  game.spawnProjectile({ owner: dummy, x: X + 500, y: Y, dirX: -1, dirY: 0, range: 1200, speed: 1200, width: 70, onHit: () => {} });
  game.step(TICK);
  assert(incomingThreat(yi, game, 0.5), '检测到威胁');
  assert(q(yi, yi.abilities.Q, ai, game) === true, 'Q 躲避');
  assert(yi.untargetable, '进入不可选中');
  run(game, 1);
  // 没有威胁、目标在普攻范围内：不 Q
  const g2 = setup({ dist: 150 });
  learn(g2.yi, 'Q', 1);
  assert(q(g2.yi, g2.yi.abilities.Q, fakeAI(g2.yi, g2.game, g2.dummy), g2.game) === false, '贴身且无威胁时保留 Q');
  // 目标在远处：Q 追击
  g2.dummy.setPosition(X + 550, Y);
  assert(q(g2.yi, g2.yi.abilities.Q, fakeAI(g2.yi, g2.game, g2.dummy), g2.game) === true, '远处目标用 Q 追击');
  // W：残血且安全
  const g3 = setup({ dist: 3000 });
  learn(g3.yi, 'W', 1);
  g3.yi.hp = g3.yi.maxHp * 0.2;
  g3.yi.lastDamagedAt = -99;
  const w = g3.yi.def.abilities.W.ai.custom;
  assert(w(g3.yi, g3.yi.abilities.W, fakeAI(g3.yi, g3.game, null), g3.game) === true, '残血冥想');
  assert(g3.yi.channel, '引导');
  // 无 AI 对象不崩溃
  for (const s of ['Q', 'W']) g3.yi.def.abilities[s].ai.custom(g3.yi, g3.yi.abilities[s], undefined, g3.game);
  const eW = yi.def.abilities.E.ai.when, rW = yi.def.abilities.R.ai.when;
  assert(typeof eW(yi, dummy, game, ai) === 'boolean' && typeof rW(yi, dummy, game, ai) === 'boolean', 'E/R 条件');
});
test('AI 集成：真实 AI 控制易对战时会施放技能且不报错', () => {
  const game = makeGame({ blue: ['masteryi'], red: ['garen'], ai: true, waves: false, open: true });
  const [yi, g] = game.champions;
  yi.setPosition(X, Y); g.setPosition(X + 500, Y);
  yi.setLevel(6); g.setLevel(6);
  g.hp = g.maxHp * 0.4;
  const casts = collect(game, 'abilityCast', (e) => e.caster === yi);
  run(game, 20);
  if (!quiet) console.log(`    易施放 ${casts.length} 次技能：${[...new Set(casts.map((e) => e.slot))].join(',')}`);
  assert(Number.isFinite(yi.x) && Number.isFinite(yi.hp) && !yi.untargetable, '状态有效');
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
