// 安妮精简测试：碎裂之火、焚烧、熔岩护盾、提伯斯之怒（伤害+召唤）、嗜火被动眩晕、定义完整性
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { ANNIE } from '../js/champions/annie.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;
function setup({ level = 1, dist = 450 } = {}) {
  const game = makeGame({ blue: ['annie'], waves: false, open: true });
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

test('Q 碎裂之火：指向目标造成魔法伤害', () => {
  const { game, c, dummy } = setup();
  learn(c, 'Q');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'annie_q');
  assert(c.castAbility('Q', { target: dummy }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 2), '命中');
  approx(dmg[0].amount, ANNIE.qDamage(c, 1), 1e-6, '伤害');
});

test('W 焚烧：扇形范围魔法伤害', () => {
  const { game, c, dummy } = setup({ dist: 400 });
  learn(c, 'W');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'annie_w');
  assert(c.castAbility('W', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 1), '命中');
  approx(dmg[0].amount, ANNIE.wDamage(c, 1), 1e-6, '伤害');
});

test('E 熔岩护盾：自身获得护盾', () => {
  const { game, c } = setup();
  learn(c, 'E');
  assert(c.castAbility('E', { target: c }).ok, '施放');
  run(game, 0.1);
  approx(c.totalShield, ANNIE.eShield(c, 1), 1e-6, '护盾值');
});

test('R 提伯斯之怒：落地范围伤害并召唤提伯斯', () => {
  const { game, c, dummy } = setup({ level: 6, dist: 400 });
  learn(c, 'R');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'annie_r');
  assert(c.castAbility('R', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 1), '命中');
  approx(dmg[0].amount, ANNIE.rDamage(c, 1), 1e-6, '伤害');
  assert(game.pets.some((p) => p.owner === c && p.alive), '提伯斯存在');
  assert(c.modelState.tibbersOut === true, 'tibbersOut');
  run(game, 3);
  assert(dummy.hp < dummy.maxHp - dmg[0].amount, '提伯斯持续造成伤害');
});

test('被动 嗜火：施放 4 次技能后，下一个伤害技能眩晕目标', () => {
  const { game, c, dummy } = setup();
  const q = learn(c, 'Q');
  const stuns = collect(game, 'cc', (e) => e.source === c && e.type === 'stun');
  let casts = 0;
  for (let i = 0; i < 5; i++) {
    q.cooldownUntil = 0; c.mana = c.maxMana;
    assert(c.castAbility('Q', { target: dummy }).ok, `第 ${i + 1} 次施放`);
    casts++;
    run(game, 1);
    if (i < 3) assert(stuns.length === 0, '前 4 次之前不眩晕');
  }
  assert(stuns.length === 1, `第 5 次眩晕（${stuns.length}）`);
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
