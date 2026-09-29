// 伊泽瑞尔精简测试：秘术射击（伤害/攻击特效/减冷却/被动叠层）、精华跃动（标记/普攻引爆/返还法力）、奥术跃迁（闪烁+追踪弹优先标记）、
// 精准弹幕（蓄力、穿透、对小兵减半）、定义完整性
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { EZREAL } from '../js/champions/ezreal.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;
function setup({ level = 1, dist = 800 } = {}) {
  const game = makeGame({ blue: ['ezreal'], waves: false, open: true });
  const c = game.champions[0];
  c.setPosition(X, Y); c.facing = 0;
  if (level > 1) c.setLevel(level);
  c.mana = c.maxMana;
  const dummy = spawnDummy(game, { team: 1, x: X + dist, y: Y, hp: 8000 });
  return { game, c, dummy };
}
function learn(c, slot, rank = 1) { const ab = c.abilities[slot]; while (ab.rank < rank) { ab.rank++; if (ab.rank === 1 && ab.def.onLearn) ab.def.onLearn(c, ab); } c.recalcStats(); return ab; }
function collect(game, name, filter = () => true) { const l = []; game.events.on(name, (e) => { if (filter(e)) l.push(e); }); return l; }
function stepUntil(game, cond, maxSec = 3) { const n = Math.round(maxSec / TICK); for (let i = 0; i < n && !cond(); i++) game.step(TICK); return cond(); }

test('Q 秘术射击：物理伤害、攻击特效钩子、减少冷却、被动叠层', () => {
  const { game, c, dummy } = setup();
  learn(c, 'Q'); const w = learn(c, 'W');
  w.startCooldown(10);
  let onHitCalls = 0;
  c.addHook('onHit', () => { onHitCalls++; });
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'ezreal_q');
  const before = w.cdRemaining;
  assert(c.castAbility('Q', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 2), '命中');
  approx(dmg[0].amount, EZREAL.qDamage(c, 1), 1e-6, '伤害');
  assert(onHitCalls === 1, '触发攻击特效');
  assert(before - w.cdRemaining > 1.5 - 0.05 && before - w.cdRemaining < 3, 'W 冷却减少 1.5 秒');
  assert(c.buffStacks(EZREAL.P_ID) === 1, '咒能高涨 1 层');
});

test('W 精华跃动：标记英雄，普攻引爆造成魔法伤害并返还法力', () => {
  const { game, c, dummy } = setup({ dist: 500 });
  learn(c, 'W');
  const pop = collect(game, 'damage', (e) => e.source === c && e.spell === 'ezreal_w_burst');
  assert(c.castAbility('W', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dummy.hasBuff(EZREAL.MARK_ID), 2), '标记');
  c.mana = 100;
  c.attackUnit(dummy);
  assert(stepUntil(game, () => pop.length > 0, 3), '引爆');
  approx(pop[0].amount, EZREAL.wDamage(c, 1), 1e-6, '引爆伤害');
  assert(!dummy.hasBuff(EZREAL.MARK_ID), '标记消耗');
  assert(c.mana >= 100 + 110 - 1, '返还法力');
});

test('W 精华跃动：穿过小兵', () => {
  const { game, c, dummy } = setup({ dist: 800 });
  learn(c, 'W');
  const minion = spawnDummy(game, { team: 1, x: X + 300, y: Y, type: 'minion', hp: 500 });
  c.castAbility('W', { x: dummy.x, y: dummy.y });
  assert(stepUntil(game, () => dummy.hasBuff(EZREAL.MARK_ID), 2), '穿过小兵标记英雄');
  assert(!minion.hasBuff(EZREAL.MARK_ID), '小兵不被标记');
});

test('E 奥术跃迁：闪烁并向标记目标发射追踪弹', () => {
  const { game, c, dummy } = setup({ dist: 900 });
  learn(c, 'E'); learn(c, 'W');
  const near = spawnDummy(game, { team: 1, x: X + 500, y: Y + 300, type: 'minion', hp: 3000 });
  c.castAbility('W', { x: dummy.x, y: dummy.y });
  stepUntil(game, () => dummy.hasBuff(EZREAL.MARK_ID), 2);
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'ezreal_e');
  const x0 = c.x;
  assert(c.castAbility('E', { x: X + 475, y: Y }).ok, '施放');
  run(game, 0.3);
  assert(c.x - x0 > 400, '闪烁');
  assert(stepUntil(game, () => dmg.length > 0, 2), '追踪弹命中');
  assert(dmg[0].target === dummy && near.hp === near.maxHp, '优先标记目标');
});

test('R 精准弹幕：1 秒蓄力，穿透全部，对小兵减半', () => {
  const { game, c, dummy } = setup({ level: 6, dist: 3000 });
  learn(c, 'R');
  const minion = spawnDummy(game, { team: 1, x: X + 1500, y: Y, type: 'minion', hp: 5000 });
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'ezreal_r');
  assert(c.castAbility('R', { x: X + 500, y: Y }).ok, '施放');
  run(game, 0.9);
  assert(dmg.length === 0, '蓄力中');
  assert(c.modelState.ezrealRCharge === true, 'modelState 蓄力');
  assert(stepUntil(game, () => dmg.length >= 2, 3), '命中两个目标');
  const toM = dmg.find((e) => e.target === minion), toC = dmg.find((e) => e.target === dummy);
  approx(toC.amount, EZREAL.rDamage(c, 1), 1e-6, '英雄全额');
  approx(toM.amount, EZREAL.rDamage(c, 1) * 0.5, 1e-6, '小兵减半');
});

test('定义完整：无 stub、描述/图标/AI 提示齐全', () => {
  const { c } = setup();
  const def = c.def;
  assert(!def.stub, '非临时桩');
  assert(def.passive.desc(c).length > 10, '被动描述');
  for (const s of ['Q', 'W', 'E', 'R']) {
    const a = def.abilities[s];
    assert(a.desc(c, 1).length > 20 && a.icon && a.ai && a.ai.kind, `${s} 完整`);
  }
  assert(def.ai.skillOrder.length === 3 && def.baseStats.missileSpeed > 0 && def.baseStats.attackVfx, 'ai 与远程属性');
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
