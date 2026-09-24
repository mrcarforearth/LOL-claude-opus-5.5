// 拉克丝精简测试：光之束缚（伤害/禁锢/标记）、光芒四射被动引爆、曲光屏障护盾、透光奇点（减速/引爆）、终极闪光、定义完整性
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { LUX } from '../js/champions/lux.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;
function setup({ level = 1, dist = 800 } = {}) {
  const game = makeGame({ blue: ['lux'], waves: false, open: true });
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

test('Q 光之束缚：命中造成魔法伤害、禁锢并标记', () => {
  const { game, c, dummy } = setup();
  learn(c, 'Q');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'lux_q');
  assert(c.castAbility('Q', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 2), '命中');
  approx(dmg[0].amount, LUX.qDamage(c, 1), 1e-6, '伤害');
  assert(dummy.hasCC('root'), '禁锢');
  assert(dummy.hasBuff(LUX.MARK_ID), '光芒四射标记');
});

test('被动 光芒四射：普攻引爆标记造成额外魔法伤害', () => {
  const { game, c, dummy } = setup({ dist: 450 });
  learn(c, 'Q');
  const pd = collect(game, 'damage', (e) => e.source === c && e.spell === 'lux_passive');
  c.castAbility('Q', { x: dummy.x, y: dummy.y });
  stepUntil(game, () => dummy.hasBuff(LUX.MARK_ID), 2);
  c.attackUnit(dummy);
  assert(stepUntil(game, () => pd.length > 0, 3), '引爆');
  approx(pd[0].amount, LUX.passiveDamage(c), 1e-6, '被动伤害');
  assert(!dummy.hasBuff(LUX.MARK_ID), '标记被消耗');
});

test('W 曲光屏障：自身获得护盾', () => {
  const { game, c } = setup();
  learn(c, 'W');
  assert(c.castAbility('W', { x: X + 500, y: Y }).ok, '施放');
  assert(stepUntil(game, () => c.totalShield > 0, 3), '获得护盾');
  assert(c.totalShield <= LUX.wShield(c, 1) * 2 + 1e-6, '护盾数值合理');
});

test('E 透光奇点：区域减速，再次施放引爆造成伤害', () => {
  const { game, c, dummy } = setup({ dist: 700 });
  learn(c, 'E');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'lux_e');
  assert(c.castAbility('E', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dummy.hasCC('slow'), 2), '落地减速');
  c.castAbility('E', {});
  assert(stepUntil(game, () => dmg.length > 0, 6), '引爆');
  approx(dmg[0].amount, LUX.eDamage(c, 1), 1e-6, '伤害');
});

test('R 终极闪光：1 秒后直线造成魔法伤害', () => {
  const { game, c, dummy } = setup({ level: 6, dist: 2000 });
  learn(c, 'R');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'lux_r');
  assert(c.castAbility('R', { x: dummy.x, y: dummy.y }).ok, '施放');
  run(game, 0.9);
  assert(dmg.length === 0, '蓄力中');
  assert(stepUntil(game, () => dmg.length > 0, 1), '命中');
  approx(dmg[0].amount, LUX.rDamage(c, 1), 1e-6, '伤害');
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
