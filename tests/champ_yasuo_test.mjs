// 亚索技能测试：浪客之道（暴击/剑意护盾）、斩钢闪（叠层/龙卷风/环形斩/攻速冷却）、风之障壁（拦截投射物）、踏前斩（固定距离/叠伤/同目标冷却）、狂风绝息斩
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { yasuoQDamage, yasuoEDamage, yasuoRDamage, yasuoQCooldown, yasuoShield } from '../js/champions/yasuo.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;

function setup({ dist = 300, dummyHp = 5000, level = 1 } = {}) {
  const game = makeGame({ blue: ['yasuo'], waves: false, open: true });
  const ya = game.champions[0];
  ya.setPosition(X, Y);
  ya.facing = 0;
  if (level > 1) ya.setLevel(level);
  const dummy = spawnDummy(game, { team: 1, x: X + dist, y: Y, hp: dummyHp });
  return { game, ya, dummy };
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

test('浪客之道：暴击几率翻倍、暴击伤害 ×0.9，溢出暴击转攻击力', () => {
  const { ya } = setup();
  ya.bonusStats.crit = 0.3; ya.recalcStats();
  approx(ya.stats.crit, 0.6, 1e-9, '30% → 60%');
  approx(ya.stats.critMult, 1.75 * 0.9, 1e-9, '暴击伤害降低 10%');
  const ad0 = ya.stats.ad;
  ya.bonusStats.crit = 0.6; ya.recalcStats();
  approx(ya.stats.crit, 1, 1e-9, '上限 100%');
  approx(ya.stats.ad - ad0, 10, 1e-6, '溢出 20% → +10 攻击力');
});

test('剑意：移动积攒，满后受到英雄伤害生成护盾并清空', () => {
  const { game, ya, dummy } = setup({ dist: 3000 });
  ya.mana = 0;
  ya.moveTo(X, Y + 2000);
  run(game, 2);
  assert(ya.mana > 10 && ya.mana < 100, `移动积攒剑意（${ya.mana.toFixed(1)}）`);
  ya.stop(); ya.mana = ya.maxMana;
  approx(ya.maxMana, 100, 1e-9, '上限 100');
  const hp0 = ya.hp;
  game.dealDamage(dummy, ya, 100, 'true');
  approx(ya.mana, 0, 1e-9, '剑意清空');
  approx(ya.hp, hp0, 1e-6, '护盾吸收本次伤害');
  approx(ya.totalShield, yasuoShield(1) - 100, 1e-6, `护盾 ${yasuoShield(1)}`);
  // 小兵伤害不触发
  ya.mana = ya.maxMana;
  const m = spawnDummy(game, { team: 1, type: 'minion', x: X + 100, y: Y });
  game.dealDamage(m, ya, 50, 'true');
  approx(ya.mana, 100, 1e-9, '小兵伤害不触发');
});

test('Q 斩钢闪：直线伤害、叠层，冷却随额外攻速降低', () => {
  const { game, ya, dummy } = setup({ dist: 300 });
  const ab = learn(ya, 'Q', 1);
  ya.bonusStats.ad = 40; ya.recalcStats();
  const dmg = collect(game, 'damage', (e) => e.target === dummy && e.spell === 'yasuo_q');
  assert(ya.castAbility('Q', { x: X + 400, y: Y }).ok, '施放');
  run(game, 0.5);
  assert(dmg.length === 1, '命中');
  approx(dmg[0].amount, 20 + 1.05 * ya.stats.ad, 1e-6, '20 + 105% AD');
  assert(ya.getBuff('yasuo_q_stack')?.stacks === 1, '1 层');
  approx(ab.cdDuration, yasuoQCooldown(ya), 1e-9, '冷却');
  approx(yasuoQCooldown(ya), 4 * (1 - ya.stats.bonusAS / 1.67), 1e-9, '1 级按等级攻速');
  ya.bonusStats.attackSpeed = 2; ya.recalcStats();
  approx(yasuoQCooldown(ya), 4 * 0.33, 1e-9, '最多降低 67%');
});

test('Q 龙卷风：2 层后直线穿透击飞并清空层数', () => {
  const { game, ya, dummy } = setup({ dist: 900 });
  const ab = learn(ya, 'Q', 1);
  const d2 = spawnDummy(game, { team: 1, x: X + 600, y: Y + 20 });
  ya.addBuff({ id: 'yasuo_q_stack', stacks: 2, maxStacks: 2, duration: 6 });
  const hits = collect(game, 'damage', (e) => e.spell === 'yasuo_q3');
  assert(ya.castAbility('Q', { x: X + 1000, y: Y }).ok, '施放');
  run(game, 0.45 + 900 / 1500);
  assert(hits.length === 2, `穿透命中 2 个（${hits.length}）`);
  assert(dummy.hasCC('airborne') || d2.hasCC('airborne'), '击飞');
  assert(!ya.hasBuff('yasuo_q_stack'), '层数清空');
  ab.resetCooldown();
});

test('E 踏前斩：穿过目标固定距离，叠伤 25%，同一目标冷却', () => {
  const { game, ya, dummy } = setup({ dist: 200 });
  const ab = learn(ya, 'E', 1);
  const dmg = collect(game, 'damage', (e) => e.spell === 'yasuo_e');
  assert(ya.castAbility('E', { target: dummy }).ok, '施放');
  assert(ya.dashState, '冲刺中');
  stepUntil(game, () => !ya.dashState, 2);
  approx(ya.x - X, 475, 5, '固定 475 码');
  assert(dmg.length === 1, '造成伤害');
  approx(dmg[0].amount, yasuoEDamage(ya, 1, 0), 1e-6, '60 基础');
  assert(ya.getBuff('yasuo_e_stack')?.stacks === 1, '叠 1 层');
  approx(yasuoEDamage(ya, 1, 1), yasuoEDamage(ya, 1, 0) * 1.25, 1e-9, '+25%');
  approx(yasuoEDamage(ya, 1, 9), yasuoEDamage(ya, 1, 0) * 2, 1e-9, '最多 +100%');
  run(game, 0.6);
  assert(ab.ready, '技能冷却 0.5 秒');
  const r = ya.castAbility('E', { target: dummy });
  assert(!r.ok && r.reason === 'target', '同一目标不能再次踏前斩');
  const other = spawnDummy(game, { team: 1, x: ya.x + 200, y: ya.y });
  assert(ya.castAbility('E', { target: other }).ok, '其他目标可以');
  stepUntil(game, () => !ya.dashState, 2);
  approx(dmg[1].amount, yasuoEDamage(ya, 1, 1), 1e-6, '第二次 +25%');
});

test('EQ 环形斩：踏前斩中施放 Q，在终点对周围造成伤害', () => {
  const { game, ya, dummy } = setup({ dist: 200 });
  learn(ya, 'E', 1); learn(ya, 'Q', 1);
  const near = spawnDummy(game, { team: 1, x: X + 520, y: Y + 60 });
  const eq = collect(game, 'damage', (e) => e.spell === 'yasuo_eq');
  ya.castAbility('E', { target: dummy });
  game.step(TICK);
  assert(ya.castAbility('Q', { x: X + 800, y: Y }).ok, '冲刺中施放 Q');
  assert(ya.castLock === 0, '瞬发');
  stepUntil(game, () => !ya.dashState, 2);
  assert(eq.some((e) => e.target === near), '终点环形斩命中');
  assert(ya.getBuff('yasuo_q_stack')?.stacks === 1, '环形斩叠层');
});

test('W 风之障壁：拦截敌方投射物，持续 4 秒', () => {
  const { game, ya, dummy } = setup({ dist: 800 });
  learn(ya, 'W', 1);
  assert(ya.castAbility('W', { x: X + 500, y: Y }).ok, '施放');
  run(game, 0.4);
  let hit = false;
  const p = game.spawnProjectile({ owner: dummy, x: dummy.x, y: dummy.y, dirX: -1, dirY: 0, range: 1200, speed: 1200, width: 40, onHit: () => { hit = true; } });
  const homing = game.spawnProjectile({ owner: dummy, target: ya, speed: 1000, isBasicAttack: true, onHit: () => { hit = true; } });
  run(game, 1.2);
  assert(p.dead && p.endReason === 'windwall', `技能弹道被拦截（${p.endReason}）`);
  assert(homing.dead && homing.endReason === 'windwall', '普攻被拦截');
  assert(!hit, '亚索未被命中');
  run(game, 3);
  let hit2 = false;
  game.spawnProjectile({ owner: dummy, target: ya, speed: 2000, isBasicAttack: true, onHit: () => { hit2 = true; } });
  run(game, 1);
  assert(hit2, '风墙消失后可命中');
});

test('R 狂风绝息斩：只能对击飞目标，闪现、延长击飞、伤害、剑意充满与穿甲', () => {
  const { game, ya, dummy } = setup({ dist: 1200, level: 6 });
  const ab = learn(ya, 'R', 1);
  ya.bonusStats.ad = 50; ya.recalcStats();
  let r = ya.castAbility('R', { target: dummy });
  assert(!r.ok && r.reason === 'target', '未击飞不能施放');
  dummy.knockup(1, null);
  run(game, 0.2);
  ya.mana = 0;
  const dmg = collect(game, 'damage', (e) => e.spell === 'yasuo_r');
  r = ya.castAbility('R', { target: dummy });
  assert(r.ok, '施放');
  assert(ya.distTo(dummy) < 200, `闪现到目标身边（${ya.distTo(dummy).toFixed(0)}）`);
  approx(dmg[0].amount, yasuoRDamage(ya, 1), 1e-6, '200 + 150% 额外 AD');
  assert(dummy.ccRemaining('airborne') > 0.9, '延长击飞 1 秒');
  approx(ya.mana, 100, 1e-9, '剑意充满');
  assert(ya.hasBuff('yasuo_r_pen'), '穿甲 Buff');
  assert(!ab.ready, '进入冷却');
});

runTests({ quiet }).then((ok) => process.exit(ok ? 0 : 1));
