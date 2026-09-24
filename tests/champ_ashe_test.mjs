// 艾希精简测试：冰霜射击被动减速、射手的专注（叠层/激活）、万箭齐发、鹰击长空、魔法水晶箭（伤害/眩晕）、定义完整性
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { asheWDamage, asheRDamage } from '../js/champions/ashe.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;
function setup({ level = 1, dist = 500 } = {}) {
  const game = makeGame({ blue: ['ashe'], waves: false, open: true });
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

test('被动 冰霜射击：普攻减速目标', () => {
  const { game, c, dummy } = setup();
  const hits = collect(game, 'attackHit', (e) => e.attacker === c);
  c.attackUnit(dummy);
  assert(stepUntil(game, () => hits.length > 0, 3), '普攻命中');
  assert(dummy.hasCC('slow'), '减速');
});

test('Q 射手的专注：普攻叠满 4 层后可激活', () => {
  const { game, c, dummy } = setup();
  const q = learn(c, 'Q');
  assert(!c.castAbility('Q').ok, '未叠满不可施放');
  c.attackUnit(dummy);
  assert(stepUntil(game, () => c.buffStacks('ashe_q_focus') >= 4, 10), '叠满专注');
  q.cooldownUntil = 0;
  assert(c.castAbility('Q').ok, '激活');
  assert(c.hasBuff('ashe_q_active'), '获得射手的专注');
});

test('W 万箭齐发：扇形箭雨造成物理伤害并减速', () => {
  const { game, c, dummy } = setup({ dist: 700 });
  learn(c, 'W');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'ashe_w');
  assert(c.castAbility('W', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 2), '命中');
  assert(dmg.length === 1, '同一目标只受一支箭伤害');
  approx(dmg[0].amount, asheWDamage(c, 1), asheWDamage(c, 1) * 0.3, '伤害');
  assert(dummy.hasCC('slow'), '减速');
});

test('E 鹰击长空：鹰灵飞向目标地点', () => {
  const { game, c } = setup();
  learn(c, 'E');
  assert(c.castAbility('E', { x: X + 3000, y: Y }).ok, '施放');
  run(game, 0.3);
  assert(game.projectiles.some((p) => p.owner === c && !p.dead), '鹰灵飞行');
  run(game, 4);
  assert(!game.projectiles.some((p) => p.owner === c && !p.dead), '到达后结束');
});

test('R 魔法水晶箭：命中英雄造成魔法伤害并眩晕', () => {
  const { game, c, dummy } = setup({ level: 6, dist: 1200 });
  learn(c, 'R');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'ashe_r' && e.target === dummy);
  assert(c.castAbility('R', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 3), '命中');
  approx(dmg[0].amount, asheRDamage(c, 1), 1e-6, '伤害');
  assert(dummy.hasCC('stun'), '眩晕');
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
