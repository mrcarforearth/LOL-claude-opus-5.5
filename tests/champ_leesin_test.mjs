// 李青技能测试：疾风骤雨、天音波/回音击、金钟罩/铁布衫（含守卫与自身）、天雷破/摧筋断骨、猛龙摆尾（撞击/撞墙）、AI 提示
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { leeQ1Damage, leeQ2Damage, leeEDamage, leeRDamage } from '../js/champions/leesin.js';
import { DIFFICULTY, TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;

function setup({ level = 1, dist = 800, dummyHp = 3000, armor = 0, mr = 0, open = true, red = [] } = {}) {
  const game = makeGame({ blue: ['leesin'], red, waves: false, open });
  const lee = game.champions[0];
  lee.setPosition(X, Y);
  lee.facing = 0;
  if (level > 1) lee.setLevel(level);
  const dummy = spawnDummy(game, { team: 1, x: X + dist, y: Y, hp: dummyHp, armor, mr });
  return { game, lee, dummy };
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
function noRegen(c) { c.bonusStats.manaRegen = -c.baseStats.manaRegen; c.recalcStats(); }
function fakeAI(champ, game, target) {
  return {
    champ, game, role: 'jungle', params: { ...DIFFICULTY.hard, accuracy: 1, dodge: 1 }, mode: 'fighting', target,
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
test('疾风骤雨：施放技能后 2 次普攻 +40% 攻速并回复 20/10 能量', () => {
  const { game, lee, dummy } = setup({ dist: 150 });
  learn(lee, 'E', 1);
  noRegen(lee);
  const as0 = lee.stats.attackSpeed;
  assert(lee.castAbility('E').ok, '施放 E');
  run(game, 0.3);
  assert(lee.hasBuff('leesin_flurry'), '获得疾风骤雨');
  lee.recalcStats();
  approx(lee.stats.attackSpeed, as0 + 0.651 * 0.4, 1e-9, '+40% 攻速');
  const hits = collect(game, 'attackHit', (e) => e.attacker === lee);
  const e0 = lee.mana;
  lee.attackUnit(dummy);
  stepUntil(game, () => hits.length >= 1);
  approx(lee.mana - e0, 20, 1e-6, '第 1 次普攻回复 20');
  stepUntil(game, () => hits.length >= 2);
  approx(lee.mana - e0, 30, 1e-6, '第 2 次普攻回复 10');
  assert(!lee.hasBuff('leesin_flurry'), '2 次后结束');
  stepUntil(game, () => hits.length >= 3);
  approx(lee.mana - e0, 30, 1e-6, '第 3 次普攻不回复');
});

// —— Q ——
test('Q 天音波：直线命中造成 55+115% 额外 AD，标记 3 秒并进入回音击窗口', () => {
  const { game, lee, dummy } = setup({ dist: 800 });
  const ab = learn(lee, 'Q', 1);
  lee.bonusStats.ad = 40; lee.recalcStats();
  const e0 = lee.mana;
  const dmg = collect(game, 'damage', (e) => e.source === lee && e.target === dummy);
  assert(lee.castAbility('Q', { x: X + 1000, y: Y }).ok, '施放');
  approx(e0 - lee.mana, 50, 1e-9, '消耗 50 能量');
  run(game, 0.25 + 800 / 1800 + 0.1);
  assert(dmg.length === 1, '命中');
  approx(dmg[0].amount, 55 + 1.15 * 40, 1e-6, '伤害');
  approx(leeQ1Damage(lee, 5), 155 + 1.15 * 40, 1e-9, '5 级');
  assert(dummy.hasBuff('leesin_q_mark'), '标记');
  assert(ab.isRecastActive && ab.ready, '回音击可用');
  assert(ab.recastRemaining > 2.7 && ab.recastRemaining <= 3, `窗口 3 秒（剩余 ${ab.recastRemaining.toFixed(2)}）`);
});
test('Q 回音击：冲向标记目标，伤害按已损失生命提高，消耗 25，之后进入冷却', () => {
  const { game, lee, dummy } = setup({ dist: 800, dummyHp: 1000 });
  const ab = learn(lee, 'Q', 1);
  lee.castAbility('Q', { x: X + 1000, y: Y });
  run(game, 0.8);
  dummy.hp = 400; // 已损失 60%
  const q2 = collect(game, 'damage', (e) => e.spell === 'leesin_q2');
  const e0 = lee.mana;
  assert(lee.castAbility('Q').ok, '再次施放');
  approx(e0 - lee.mana, 25, 1e-9, '回音击消耗 25');
  assert(lee.dashState, '冲刺中');
  assert(!dummy.hasBuff('leesin_q_mark'), '消耗标记');
  approx(ab.cdRemaining, 10, 1e-6, '冷却 10 秒（回音击后开始）');
  let missAtHit = 0;
  for (let i = 0; i < 60 && q2.length === 0; i++) { missAtHit = 1 - dummy.hp / dummy.maxHp; game.step(TICK); }
  assert(q2.length === 1, '命中');
  approx(q2[0].amount, 55 * (1 + missAtHit), 1e-6, '55 ×（1 + 60%）');
  approx(leeQ2Damage(lee, { hp: 0, maxHp: 100 }, 1), 110, 1e-9, '最多提高 100%');
  assert(lee.distTo(dummy) < 150, `冲到目标身边（${lee.distTo(dummy).toFixed(0)}）`);
});
test('Q 天音波：未命中直接进入冷却；标记过期后冷却', () => {
  const { game, lee } = setup({ dist: 5000 });
  const ab = learn(lee, 'Q', 5);
  lee.castAbility('Q', { x: X, y: Y + 1000 });
  run(game, 1.2);
  assert(!ab.isRecastActive && !ab.ready, '未命中无窗口');
  approx(ab.cdRemaining, 6 - 0.95, 0.06, '5 级冷却 6 秒');
  const g2 = setup({ dist: 600 });
  const ab2 = learn(g2.lee, 'Q', 1);
  g2.lee.castAbility('Q', { x: X + 1000, y: Y });
  run(g2.game, 0.7);
  assert(ab2.isRecastActive, '命中');
  run(g2.game, 3.1);
  assert(!ab2.isRecastActive && !ab2.ready, '窗口结束');
  approx(ab2.cdRemaining, 10 - 0.4, 0.3, '窗口结束后开始冷却');
});

// —— W ——
test('W 金钟罩：冲向友方小兵并获得护盾，再次施放铁布衫 5% 吸血，冷却 12 秒', () => {
  const { game, lee } = setup({ dist: 5000 });
  const ab = learn(lee, 'W', 1);
  const minion = spawnDummy(game, { team: 0, type: 'minion', x: X + 600, y: Y, hp: 500 });
  const e0 = lee.mana;
  assert(lee.castAbility('W', { target: minion }).ok, '施放');
  approx(e0 - lee.mana, 50, 1e-9, '消耗 50');
  assert(lee.dashState, '冲刺');
  assert(!lee.castAbility('W').ok, '冲刺中不能铁布衫');
  run(game, 0.5);
  assert(lee.distTo(minion) < 120, `到达（${lee.distTo(minion).toFixed(0)}）`);
  approx(lee.totalShield, 55, 1e-6, '李青护盾 55');
  approx(minion.totalShield, 0, 1e-9, '小兵不获得护盾');
  assert(ab.isRecastActive, '铁布衫窗口');
  const e1 = lee.mana;
  assert(lee.castAbility('W').ok, '铁布衫');
  approx(e1 - lee.mana, 25, 1e-9, '消耗 25');
  lee.recalcStats();
  approx(lee.stats.lifeSteal, 0.05, 1e-9, '生命偷取 5%');
  approx(lee.stats.omnivamp, 0.05, 1e-9, '全能吸血 5%');
  approx(ab.cdRemaining, 12, 1e-6, '冷却 12');
  run(game, 2.1);
  approx(lee.totalShield, 0, 1e-9, '护盾 2 秒后消失');
  run(game, 2);
  assert(!lee.hasBuff('leesin_w2'), '铁布衫 4 秒');
});
test('W 金钟罩：友方英雄双方获得护盾；可对守卫和自己施放；窗口结束后冷却', () => {
  const { game, lee } = setup({ dist: 5000 });
  const ab = learn(lee, 'W', 3);
  lee.bonusStats.ap = 100; lee.recalcStats();
  const ally = spawnDummy(game, { team: 0, x: X, y: Y + 500, hp: 1000 });
  lee.castAbility('W', { target: ally });
  run(game, 0.5);
  approx(lee.totalShield, 125 + 80, 1e-6, '3 级 125 + 80% AP');
  approx(ally.totalShield, 125 + 80, 1e-6, '友方英雄获得相同护盾');
  run(game, 3);
  assert(!ab.isRecastActive && !ab.ready, '窗口结束');
  approx(ab.cdRemaining, 12 - 0.5, 0.1, '窗口结束开始冷却');
  // 守卫
  ab.resetCooldown();
  const ward = game.placeWard(lee, lee.x - 500, lee.y, 'stealth');
  assert(lee.castAbility('W', { target: ward }).ok, '对守卫施放');
  run(game, 0.5);
  assert(lee.distTo(ward) < 80, '冲到守卫');
  // 自己
  ab.endRecast(false); ab.resetCooldown();
  lee.shields.length = 0;
  const px = lee.x;
  assert(lee.castAbility('W', { target: lee }).ok, '对自己施放');
  assert(!lee.dashState && lee.x === px, '不位移');
  approx(lee.totalShield, 205, 1e-6, '自身护盾');
  // 敌人不可作为目标
  ab.endRecast(false); ab.resetCooldown();
  const foe = spawnDummy(game, { team: 1, x: lee.x + 300, y: lee.y });
  assert(!lee.castAbility('W', { target: foe }).ok, '不能对敌人施放');
});

// —— E ——
test('E 天雷破：450 码魔法伤害 35+100% AD；摧筋断骨减速 20% 并在 4 秒内衰减', () => {
  const { game, lee, dummy } = setup({ dist: 300 });
  const far = spawnDummy(game, { team: 1, x: X - 700, y: Y, hp: 3000 });
  const ab = learn(lee, 'E', 1);
  const dmg = collect(game, 'damage', (e) => e.spell === 'leesin_e');
  assert(lee.castAbility('E').ok, '施放');
  run(game, 0.3);
  assert(dmg.length === 1 && dmg[0].target === dummy, '只命中范围内敌人');
  approx(dmg[0].amount, 35 + lee.stats.ad, 1e-6, '35 + 100% AD');
  assert(dmg[0].type === 'magic', '魔法伤害');
  approx(leeEDamage(lee, 5), 175 + lee.stats.ad, 1e-9, '5 级 175');
  assert(dummy.hasBuff('leesin_e_mark') && !far.hasBuff('leesin_e_mark'), '显形标记');
  assert(ab.isRecastActive, '摧筋断骨窗口');
  const e0 = lee.mana;
  assert(lee.castAbility('E').ok, '摧筋断骨');
  approx(e0 - lee.mana, 30, 1e-9, '消耗 30');
  game.step(TICK);
  approx(dummy.strongestSlow(), 0.2, 0.01, '初始 20%');
  run(game, 2);
  approx(dummy.strongestSlow(), 0.1, 0.01, '2 秒后衰减到约 10%');
  approx(ab.cdRemaining, 8 - 2.03, 0.1, '冷却 8 秒（摧筋断骨后开始）');
  run(game, 2.1);
  approx(dummy.strongestSlow(), 0, 1e-9, '4 秒后结束');
  // 未命中直接冷却
  const g2 = setup({ dist: 3000 });
  const ab2 = learn(g2.lee, 'E', 1);
  g2.lee.castAbility('E');
  run(g2.game, 0.3);
  assert(!ab2.isRecastActive && !ab2.ready, '未命中无窗口');
});

// —— R ——
test('R 猛龙摆尾：踢飞 700 码，撞到的敌人受到伤害+额外生命 12% 并被击飞 1 秒', () => {
  const { game, lee, dummy } = setup({ dist: 200, dummyHp: 3000 });
  const ab = learn(lee, 'R', 1);
  dummy.bonusStats.hp = 1000; dummy.recalcStats();
  lee.bonusStats.ad = 30; lee.recalcStats();
  const behind = spawnDummy(game, { team: 1, x: X + 600, y: Y + 20, hp: 3000 });
  const minion = spawnDummy(game, { team: 1, type: 'minion', x: X + 750, y: Y - 30, hp: 3000 });
  const offLine = spawnDummy(game, { team: 1, x: X + 600, y: Y + 400, hp: 3000 });
  const dmg = collect(game, 'damage', (e) => e.source === lee);
  const x0 = dummy.x;
  assert(lee.castAbility('R', { target: dummy }).ok, '施放');
  run(game, 0.26);
  const kick = dmg.find((e) => e.spell === 'leesin_r');
  approx(kick.amount, 175 + 2 * 30, 1e-6, '175 + 200% 额外 AD');
  assert(dummy.hasCC('airborne'), '被踢飞');
  run(game, 0.9);
  approx(dummy.x - x0, 700, 5, '踢飞 700 码');
  const col = dmg.filter((e) => e.spell === 'leesin_r_collide');
  const expectCol = 235 + 0.12 * 1000;
  assert(col.length === 2, `撞到 2 个敌人（实际 ${col.length}）`);
  for (const e of col) approx(e.amount, expectCol, 1e-6, '撞击伤害');
  assert(!col.some((e) => e.target === offLine), '路径外不受影响');
  assert(behind.getCC('airborne') || behind.hp < 3000, '撞击击飞');
  approx(leeRDamage(lee, 3), 625 + 60, 1e-9, '3 级 625');
  approx(ab.cdRemaining, 110 - (1.16 - 0.25), 0.1, '冷却 110（前摇结束后开始）');
});
test('R 猛龙摆尾：撞墙停止；撞击目标击飞 1 秒', () => {
  const walls = [{ x0: X + 500, y0: Y - 600, x1: X + 700, y1: Y + 600 }];
  const { game, lee, dummy } = setup({ dist: 200, open: { walls } });
  learn(lee, 'R', 1);
  const hitter = spawnDummy(game, { team: 1, x: X + 380, y: Y, hp: 3000 });
  lee.castAbility('R', { target: dummy });
  run(game, 0.3);
  assert(hitter.hasCC('airborne'), '撞击击飞');
  approx(hitter.ccRemaining('airborne'), 1, 0.1, '约 1 秒');
  run(game, 1);
  assert(dummy.x < X + 500, `停在墙前（x=${(dummy.x - X).toFixed(0)}）`);
});

// —— AI ——
test('AI：Q1 命中后追 Q2、E 贴身、W 残血摸眼逃生、R 把敌人踢向队友', () => {
  const { game, lee, dummy } = setup({ dist: 700, dummyHp: 3000 });
  for (const s of ['Q', 'W', 'E', 'R']) learn(lee, s, 1);
  const ai = fakeAI(lee, game, dummy);
  const q = lee.def.abilities.Q.ai.custom;
  assert(q(lee, lee.abilities.Q, ai, game) === true, 'Q1');
  run(game, 0.8);
  assert(lee.abilities.Q.isRecastActive, 'Q1 命中');
  // 目标远离时追 Q2
  dummy.setPosition(X + 900, Y);
  assert(q(lee, lee.abilities.Q, ai, game) === true, 'Q2 追击');
  run(game, 1);
  assert(lee.distTo(dummy) < 200, '追上');
  const e = lee.def.abilities.E.ai.custom;
  assert(e(lee, lee.abilities.E, ai, game) === true, '贴身 E');
  run(game, 0.3);
  // W 逃生：残血、敌人贴脸、无友方单位 → 饰品守卫 + 金钟罩
  const w = lee.def.abilities.W.ai.custom;
  lee.hp = lee.maxHp * 0.2;
  lee.mana = 200;
  const wardsBefore = game.wards.length;
  assert(w(lee, lee.abilities.W, ai, game) === true, 'W 逃生');
  assert(game.wards.length === wardsBefore + 1, '放置了守卫');
  assert(lee.dashState, '金钟罩冲向守卫');
  const f = game.fountainOf(lee.team);
  run(game, 0.6);
  assert(Math.hypot(lee.x - f.x, lee.y - f.y) < Math.hypot(dummy.x - f.x, dummy.y - f.y), '朝泉水方向');
  // 无 AI 对象时不崩溃
  for (const s of ['Q', 'W', 'E', 'R']) lee.def.abilities[s].ai.custom(lee, lee.abilities[s], undefined, game);
  for (const s of ['Q', 'W', 'E', 'R']) lee.def.abilities[s].ai.custom(lee, lee.abilities[s], {}, game);
});
test('AI：猛龙摆尾只在能把敌人踢向队友/撞人/斩杀时施放，否则尝试绕后', () => {
  const { game, lee, dummy } = setup({ dist: 120, dummyHp: 3000 });
  learn(lee, 'R', 1);
  const r = lee.def.abilities.R.ai.custom;
  const ai = fakeAI(lee, game, dummy);
  // 队友在李青身后：踢飞方向远离队友 → 不施放，改为绕后移动
  const ally = spawnDummy(game, { team: 0, x: X - 600, y: Y, hp: 3000 });
  assert(r(lee, lee.abilities.R, ai, game) === true, '返回已行动');
  assert(lee.abilities.R.ready, '没有施放 R');
  assert(lee.command && lee.command.type === 'move', '绕后移动');
  // 李青在目标另一侧：踢向队友
  ally.setPosition(X + 900, Y);
  lee.stop();
  assert(r(lee, lee.abilities.R, ai, game) === true, '施放');
  run(game, 0.3);
  assert(!lee.abilities.R.ready, 'R 已施放');
  run(game, 0.8);
  assert(Math.abs(dummy.x - ally.x) < 400, '目标被踢向队友');
});
test('AI 集成：真实 AI 控制李青对战时会施放技能且不报错', () => {
  const game = makeGame({ blue: ['leesin'], red: ['garen'], ai: true, waves: false, open: true });
  const [lee, g] = game.champions;
  lee.setPosition(X, Y); g.setPosition(X + 500, Y);
  lee.setLevel(6); g.setLevel(6);
  g.hp = g.maxHp * 0.4;
  const casts = collect(game, 'abilityCast', (e) => e.caster === lee);
  run(game, 20);
  if (!quiet) console.log(`    李青施放 ${casts.length} 次技能：${[...new Set(casts.map((e) => e.slot + (e.isRecast ? '2' : '')))].join(',')}`);
  assert(Number.isFinite(lee.x) && Number.isFinite(lee.hp), '状态有效');
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
