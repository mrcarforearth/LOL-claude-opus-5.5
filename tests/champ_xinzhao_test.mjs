// 赵信技能测试：果决（第三下额外伤害+回血）、三重爪击（额外伤害/第三下击飞/减冷却）、风斩电刺（横扫+突刺减速）、无畏冲锋、新月护卫（击退除挑战目标/范围外免伤）
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { xinPassiveAd, xinQBonus, xinWSlash, xinWThrust, xinEDamage, xinRDamage } from '../js/champions/xinzhao.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;

function setup({ dist = 200, dummyHp = 5000, level = 1 } = {}) {
  const game = makeGame({ blue: ['xinzhao'], waves: false, open: true });
  const xin = game.champions[0];
  xin.setPosition(X, Y);
  xin.facing = 0;
  if (level > 1) xin.setLevel(level);
  const dummy = spawnDummy(game, { team: 1, x: X + dist, y: Y, hp: dummyHp });
  return { game, xin, dummy };
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

test('果决：每第 3 次普攻额外伤害并回复生命', () => {
  const { game, xin, dummy } = setup();
  xin.hp = 300;
  const p = collect(game, 'damage', (e) => e.spell === 'xinzhao_passive');
  const heals = collect(game, 'heal', (e) => e.target === xin);
  const hits = collect(game, 'attackHit', (e) => e.attacker === xin);
  xin.attackUnit(dummy);
  stepUntil(game, () => hits.length >= 2, 5);
  assert(p.length === 0, '前两下不触发');
  stepUntil(game, () => hits.length >= 3, 5);
  assert(p.length === 1, '第三下触发');
  approx(p[0].amount, xinPassiveAd(1) * xin.stats.ad, 1e-6, '15% AD');
  assert(heals.some((h) => h.amount > 0), '回复生命');
});

test('Q 三重爪击：3 次强化普攻，第 3 次击飞，每次减少 W/E 冷却 1 秒', () => {
  const { game, xin, dummy } = setup();
  learn(xin, 'Q', 1);
  const w = learn(xin, 'W', 1), e = learn(xin, 'E', 1);
  w.startCooldown(10); e.startCooldown(10);
  const q = collect(game, 'damage', (ev) => ev.spell === 'xinzhao_q');
  const hits = collect(game, 'attackHit', (ev) => ev.attacker === xin);
  assert(xin.castAbility('Q').ok, '施放');
  xin.attackUnit(dummy);
  stepUntil(game, () => hits.length >= 2, 5);
  assert(!dummy.hasCC('airborne'), '前两下不击飞');
  stepUntil(game, () => hits.length >= 3, 5);
  assert(q.length === 3, `3 次额外伤害（${q.length}）`);
  approx(q[0].amount, xinQBonus(xin, 1), 1e-6, '16 + 40% 额外 AD');
  assert(dummy.hasCC('airborne'), '第三下击飞');
  assert(!xin.hasBuff('xinzhao_q'), '用完结束');
  assert(w.cdRemaining < 10 - 3 + 0.01 - 1, `W 冷却减少（剩 ${w.cdRemaining.toFixed(2)}）`);
});

test('W 风斩电刺：扇形横扫 + 延迟直线突刺并减速', () => {
  const { game, xin, dummy } = setup({ dist: 300 });
  learn(xin, 'W', 1);
  const far = spawnDummy(game, { team: 1, x: X + 800, y: Y });
  const slash = collect(game, 'damage', (e) => e.spell === 'xinzhao_w_slash');
  const thrust = collect(game, 'damage', (e) => e.spell === 'xinzhao_w_thrust');
  assert(xin.castAbility('W', { x: X + 900, y: Y }).ok, '施放');
  run(game, 0.3);
  assert(slash.length === 1 && slash[0].target === dummy, '横扫只命中近处');
  approx(slash[0].amount, xinWSlash(xin, 1), 1e-6, '横扫伤害');
  run(game, 0.4);
  assert(thrust.length === 2, `突刺命中 2 个（${thrust.length}）`);
  approx(thrust[0].amount, xinWThrust(xin, 1), 1e-6, '突刺伤害');
  assert(far.hasCC('slow') && far.strongestSlow() >= 0.5 - 1e-9, '减速 50%');
});

test('E 无畏冲锋：冲向目标，范围魔法伤害、减速，获得攻速', () => {
  const { game, xin, dummy } = setup({ dist: 600 });
  learn(xin, 'E', 1);
  const side = spawnDummy(game, { team: 1, x: X + 600, y: Y + 150 });
  const dmg = collect(game, 'damage', (e) => e.spell === 'xinzhao_e');
  const as0 = xin.stats.attackSpeed;
  assert(xin.castAbility('E', { target: dummy }).ok, '施放');
  stepUntil(game, () => !xin.dashState, 1);
  assert(xin.distTo(dummy) < 150, '冲到目标身边');
  assert(dmg.length === 2 && dmg.some((e) => e.target === side), '范围伤害');
  approx(dmg[0].amount, xinEDamage(xin, 1), 1e-6, '50 魔法伤害');
  assert(dummy.hasCC('slow'), '减速');
  xin.recalcStats();
  approx(xin.stats.attackSpeed - as0, 0.645 * 0.4, 1e-6, '+40% 攻速');
});

test('R 新月护卫：当前生命百分比伤害、击退非挑战目标、免疫范围外伤害', () => {
  const { game, xin, dummy } = setup({ dist: 600, level: 6 });
  learn(xin, 'E', 1);
  learn(xin, 'R', 1);
  const other = spawnDummy(game, { team: 1, x: X + 600, y: Y + 200 });
  xin.castAbility('E', { target: dummy });
  stepUntil(game, () => !xin.dashState, 1);
  run(game, 0.2);
  const hp0 = dummy.hp;
  const dmg = collect(game, 'damage', (e) => e.spell === 'xinzhao_r');
  const ox = other.x, oy = other.y;
  assert(xin.castAbility('R').ok, '施放');
  run(game, 0.4);
  assert(dmg.length === 2, `命中 2 个（${dmg.length}）`);
  approx(dmg.find((e) => e.target === dummy).amount, 75 + 0.15 * hp0, 1e-6, '75 + 15% 当前生命');
  run(game, 0.6);
  assert(Math.hypot(other.x - ox, other.y - oy) > 300, '非挑战目标被击退');
  assert(xin.distTo(dummy) < 200, '挑战目标不被击退');
  approx(xinRDamage(xin, 1, { hp: 1000, type: 'champion' }), 75 + xin.stats.bonusAd + 150, 1e-6, '公式');
  // 范围外伤害免疫 / 范围内正常
  const farFoe = spawnDummy(game, { team: 1, x: X + 1600, y: Y });
  const hpX = xin.hp;
  assert(game.dealDamage(farFoe, xin, 100, 'true') === 0, '范围外免疫');
  assert(game.dealDamage(dummy, xin, 100, 'true') > 0, '范围内受伤');
  approx(xin.hp, hpX - 100, 1e-6, '');
  run(game, 3);
  assert(game.dealDamage(farFoe, xin, 50, 'true') > 0, '3 秒后结束');
});

runTests({ quiet }).then((ok) => process.exit(ok ? 0 : 1));
