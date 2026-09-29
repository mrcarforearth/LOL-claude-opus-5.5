// 墨菲特精简测试：花岗岩护盾（生成/受伤后重置计时）、地震碎片（伤害/偷取移速）、雷霆拍击（被动护甲/强化普攻/余震）、
// 巨石冲击（范围伤害/降攻速）、势不可挡（不可阻挡冲锋/击飞）、定义完整性
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { MALPHITE } from '../js/champions/malphite.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;
function setup({ level = 1, dist = 500 } = {}) {
  const game = makeGame({ blue: ['malphite'], waves: false, open: true });
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
const granite = (c) => c.shields.find((s) => s.id === MALPHITE.P_SHIELD_ID);

test('被动 花岗岩护盾：10% 最大生命护盾，受伤后 10 秒重新生成', () => {
  const { game, c, dummy } = setup();
  run(game, 0.2);
  const s = granite(c);
  assert(s, '开局获得护盾');
  approx(s.amount, c.maxHp * 0.1, 1, '护盾数值');
  assert(c.modelState.malphiteShield === true, 'modelState');
  game.dealDamage(dummy, c, 5000, 'true', {});
  assert(!granite(c), '护盾被打破');
  run(game, 9);
  assert(!granite(c), '10 秒内不生成');
  run(game, 1.3);
  assert(granite(c), '10 秒后重新生成');
});

test('Q 地震碎片：魔法伤害并偷取移速', () => {
  const { game, c, dummy } = setup({ dist: 550 });
  learn(c, 'Q');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'malphite_q');
  const ms0 = c.stats.moveSpeed;
  assert(c.castAbility('Q', { target: dummy }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 2), '命中');
  approx(dmg[0].amount, MALPHITE.qDamage(c, 1), 1e-6, '伤害');
  assert(dummy.hasCC('slow'), '目标减速');
  run(game, 0.05);
  assert(c.stats.moveSpeed > ms0, '自身加速');
});

test('W 雷霆拍击：被动护甲、强化普攻与锥形余震', () => {
  const { game, c, dummy } = setup({ dist: 150 });
  const a0 = c.stats.armor;
  learn(c, 'W');
  run(game, 0.05);
  assert(c.stats.armor > a0 * 1.09, '被动护甲提升');
  const behind = spawnDummy(game, { team: 1, x: X + 300, y: Y + 30, type: 'minion', hp: 3000 });
  const first = collect(game, 'damage', (e) => e.source === c && e.spell === 'malphite_w');
  const shock = collect(game, 'damage', (e) => e.source === c && e.spell === 'malphite_w_shock');
  assert(c.castAbility('W', {}).ok, '施放');
  run(game, 0.05);
  assert(c.stats.armor > a0 * 1.19, '主动期间护甲翻倍');
  c.attackUnit(dummy);
  assert(stepUntil(game, () => first.length > 0, 2), '强化普攻');
  assert(shock.some((e) => e.target === behind), '余震命中身后单位');
  assert(!shock.some((e) => e.target === dummy), '余震不重复命中主目标');
});

test('E 巨石冲击：基于护甲的魔法伤害并降低攻速', () => {
  const { game, c, dummy } = setup({ dist: 300 });
  learn(c, 'E');
  const as0 = dummy.stats.attackSpeed;
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'malphite_e');
  const expect = MALPHITE.eDamage(c, 1);
  assert(c.castAbility('E', {}).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 1), '命中');
  approx(dmg[0].amount, expect, 1e-6, '伤害');
  run(game, 0.05);
  assert(dummy.stats.attackSpeed < as0 * 0.75, '攻速降低');
});

test('R 势不可挡：不可阻挡冲锋，落地伤害并击飞', () => {
  const { game, c, dummy } = setup({ level: 6, dist: 900 });
  learn(c, 'R');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'malphite_r');
  assert(c.castAbility('R', { x: dummy.x, y: dummy.y }).ok, '施放');
  run(game, 0.05);
  assert(c.unstoppable && c.modelState.malphiteCharging, '冲锋中不可阻挡');
  assert(!c.applyCC('stun', 1, { source: dummy }), '免疫控制');
  assert(stepUntil(game, () => dmg.length > 0, 2), '命中');
  approx(dmg[0].amount, MALPHITE.rDamage(c, 1), 1e-6, '伤害');
  assert(dummy.hasCC('airborne'), '击飞');
  run(game, 0.1);
  assert(!c.unstoppable && !c.modelState.malphiteCharging, '冲锋结束复位');
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
  assert(def.ai.skillOrder.length === 3, 'ai');
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
