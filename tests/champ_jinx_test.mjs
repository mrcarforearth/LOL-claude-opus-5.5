// 金克丝精简测试：罪恶快感被动、枪炮交响曲切换、震荡电磁波、嚼火者手雷（禁锢/伤害）、超究极死神飞弹、定义完整性
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { jinxWDamage, jinxEDamage, jinxRDamage } from '../js/champions/jinx.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;
function setup({ level = 1, dist = 800 } = {}) {
  const game = makeGame({ blue: ['jinx'], waves: false, open: true });
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

test('被动 罪恶快感：击杀近期伤害过的敌方英雄后获得加速', () => {
  const { game, c, dummy } = setup();
  game.dealDamage(c, dummy, 99999, 'true', { isAbility: true });
  assert(!dummy.alive, '击杀');
  run(game, 0.05);
  assert(c.hasBuff('jinx_p_excited'), '罪恶快感');
});

test('Q 枪炮交响曲：切换火箭发射器（射程提升），再切回', () => {
  const { game, c } = setup();
  const q = learn(c, 'Q');
  const r0 = c.stats.attackRange;
  assert(c.modelState.weapon === 'minigun', '初始为机枪');
  assert(c.castAbility('Q').ok, '切换');
  run(game, 0.1);
  assert(c.modelState.weapon === 'rocket', '火箭');
  assert(c.stats.attackRange > r0, '射程提升');
  q.cooldownUntil = 0;
  c.castAbility('Q');
  run(game, 0.1);
  assert(c.modelState.weapon === 'minigun', '切回机枪');
});

test('W 震荡电磁波：蓄力后直线命中造成物理伤害并减速', () => {
  const { game, c, dummy } = setup({ dist: 1000 });
  learn(c, 'W');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'jinx_w');
  assert(c.castAbility('W', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 2), '命中');
  approx(dmg[0].amount, jinxWDamage(c, 1), 1e-6, '伤害');
  assert(dummy.hasCC('slow'), '减速');
});

test('E 嚼火者手雷：敌方英雄踩中后禁锢并受到魔法伤害', () => {
  const { game, c, dummy } = setup({ dist: 600 });
  learn(c, 'E');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'jinx_e');
  assert(c.castAbility('E', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 3), '触发');
  approx(dmg[0].amount, jinxEDamage(c, 1), 1e-6, '伤害');
  assert(dummy.hasCC('root'), '禁锢');
});

test('R 超究极死神飞弹：全图飞弹命中造成物理伤害', () => {
  const { game, c, dummy } = setup({ level: 6, dist: 2500 });
  learn(c, 'R');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'jinx_r' && e.target === dummy);
  assert(c.castAbility('R', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 4), '命中');
  approx(dmg[0].amount, jinxRDamage(c, { hp: dummy.maxHp, maxHp: dummy.maxHp }, 1, 3000), 1e-6, '满距离伤害（目标满血）');
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
  assert(def.ai.skillOrder.length === 3 && def.baseStats.missileSpeed > 0, 'ai 与远程属性');
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
