// 劫技能测试：灭魂劫、诸刃（穿透衰减/分身同时投掷）、分身（前冲/换位）、鬼斩（分身范围/减 W 冷却）、瞬狱影杀阵（不可选取/身后/引爆/换位）
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { zedQDamage, zedEDamage, zedRPop, zedShadows, zedPassivePct } from '../js/champions/zed.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;

function setup({ dist = 600, dummyHp = 5000, level = 1 } = {}) {
  const game = makeGame({ blue: ['zed'], waves: false, open: true });
  const zed = game.champions[0];
  zed.setPosition(X, Y);
  zed.facing = 0;
  if (level > 1) zed.setLevel(level);
  const dummy = spawnDummy(game, { team: 1, x: X + dist, y: Y, hp: dummyHp });
  return { game, zed, dummy };
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

test('被动 灭魂劫：对 50% 以下目标普攻附加最大生命 6% 魔法伤害，同目标 10 秒冷却', () => {
  const { game, zed, dummy } = setup({ dist: 150, dummyHp: 2000 });
  dummy.hp = 900;
  const p = collect(game, 'damage', (e) => e.spell === 'zed_passive');
  const hits = collect(game, 'attackHit', (e) => e.attacker === zed);
  zed.attackUnit(dummy);
  stepUntil(game, () => hits.length >= 2, 5);
  assert(p.length === 1, `只触发一次（${p.length}）`);
  approx(p[0].amount, 0.06 * 2000, 1e-6, '6% 最大生命');
  approx(zedPassivePct(7), 0.08, 1e-9, '7 级 8%');
  approx(zedPassivePct(17), 0.1, 1e-9, '17 级 10%');
});

test('Q 诸刃：穿透，第一个目标全额，后续 60%；消耗能量', () => {
  const { game, zed, dummy } = setup({ dist: 700 });
  learn(zed, 'Q', 1);
  zed.bonusStats.ad = 30; zed.recalcStats();
  const first = spawnDummy(game, { team: 1, x: X + 300, y: Y });
  const dmg = collect(game, 'damage', (e) => e.spell === 'zed_q');
  const e0 = zed.mana;
  assert(zed.castAbility('Q', { x: X + 900, y: Y }).ok, '施放');
  approx(e0 - zed.mana, 75, 1e-9, '75 能量');
  run(game, 0.25 + 700 / 1700 + 0.15);
  assert(dmg.length === 2, `命中 2 个（${dmg.length}）`);
  approx(dmg.find((e) => e.target === first).amount, zedQDamage(zed, 1), 1e-6, '第一个目标 80 + 100% 额外 AD');
  approx(dmg.find((e) => e.target === dummy).amount, zedQDamage(zed, 1) * 0.6, 1e-6, '后续 60%');
});

test('W 分身：前冲 650 码，Q 由分身同时投掷；再次施放换位', () => {
  const { game, zed, dummy } = setup({ dist: 900 });
  const w = learn(zed, 'W', 1);
  learn(zed, 'Q', 1);
  assert(zed.castAbility('W', { x: X + 650, y: Y + 650 }).ok, '施放 W');
  run(game, 0.5);
  const [s] = zedShadows(zed);
  assert(s && s.arrived, '分身抵达');
  approx(Math.hypot(s.x - X, s.y - Y), 650, 2, '650 码');
  assert(w.isRecastActive && w.ready, '可换位');
  // 劫与分身同时投掷：同一目标被两枚命中，第二枚 60%
  const dmg = collect(game, 'damage', (e) => e.spell === 'zed_q' && e.target === dummy);
  zed.castAbility('Q', { x: dummy.x, y: dummy.y });
  run(game, 1.2);
  assert(dmg.length === 2, `两枚手里剑命中（${dmg.length}）`);
  approx(dmg[0].amount + dmg[1].amount, zedQDamage(zed, 1) * 1.6, 1e-6, '100% + 60%');
  // 换位
  const sx = s.x, sy = s.y;
  assert(zed.castAbility('W').ok, '换位');
  approx(zed.x, sx, 1, '劫到分身位置'); approx(zed.y, sy, 1, '');
  approx(s.x, X, 1, '分身到劫原位置');
  assert(!w.isRecastActive, '换位后窗口结束');
  assert(w.cdRemaining > 15, 'W 冷却中');
  run(game, 5);
  assert(zedShadows(zed).length === 0, '分身 5.25 秒后消失');
});

test('E 鬼斩：劫与分身范围伤害（同一目标只一次）、减速，命中英雄减少 W 冷却 2 秒', () => {
  const { game, zed, dummy } = setup({ dist: 200 });
  const w = learn(zed, 'W', 1);
  learn(zed, 'E', 1);
  const far = spawnDummy(game, { team: 1, x: X, y: Y + 700 });
  zed.castAbility('W', { x: X, y: Y + 600 });
  run(game, 0.5);
  const cd0 = w.cdRemaining;
  const dmg = collect(game, 'damage', (e) => e.spell === 'zed_e');
  assert(zed.castAbility('E').ok, '施放 E');
  assert(dmg.length === 2, `劫与分身各命中一个（${dmg.length}）`);
  approx(dmg[0].amount, zedEDamage(zed, 1), 1e-6, '伤害');
  assert(dummy.hasCC('slow') && far.hasCC('slow'), '减速');
  approx(cd0 - w.cdRemaining, 4, 1e-6, '命中 2 名英雄，W 冷却 -4 秒');
});

test('R 瞬狱影杀阵：不可选取突进到身后、留下分身、3 秒后引爆（AD + 25% 期间伤害）、换位', () => {
  const { game, zed, dummy } = setup({ dist: 500, level: 6 });
  const r = learn(zed, 'R', 1);
  assert(zed.castAbility('R', { target: dummy }).ok, '施放');
  assert(zed.untargetable, '不可选取');
  const rs = r.state.shadow;
  assert(rs && rs.alive, '留下分身');
  approx(rs.x, X, 1, '分身在原地');
  stepUntil(game, () => !zed.dashState, 1);
  assert(zed.x > dummy.x, `到达目标身后（${(zed.x - dummy.x).toFixed(0)}）`);
  assert(dummy.hasBuff('zed_r_mark'), '死亡印记');
  // 印记期间造成 400 伤害
  game.dealDamage(zed, dummy, 400, 'true', { isAbility: true });
  const pop = collect(game, 'damage', (e) => e.spell === 'zed_r_pop');
  run(game, 3.1);
  assert(pop.length === 1, '引爆');
  approx(pop[0].amount, zedRPop(zed, 1, 400), 1e-6, 'AD + 25% × 400');
  assert(!zed.untargetable, '恢复可选取');
  // 换位回 R 分身
  assert(r.isRecastActive, '可换位');
  assert(zed.castAbility('R').ok, '换位');
  approx(zed.x, X, 1, '回到原位');
  assert(!r.isRecastActive && !r.ready, '进入冷却');
});

runTests({ quiet }).then((ok) => process.exit(ok ? 0 : 1));
