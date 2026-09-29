// 莫甘娜精简测试：暗之禁锢（伤害/禁锢/被动回血）、痛苦腐蚀（持续伤害/低血增伤/减冷却）、黑暗之盾（魔法护盾/免控）、
// 灵魂镣铐（连接减速、3 秒后眩晕、断链）、定义完整性
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { MORGANA } from '../js/champions/morgana.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;
function setup({ level = 1, dist = 800, hp = 8000 } = {}) {
  const game = makeGame({ blue: ['morgana'], waves: false, open: true });
  const c = game.champions[0];
  c.setPosition(X, Y); c.facing = 0;
  if (level > 1) c.setLevel(level);
  c.mana = c.maxMana;
  const dummy = spawnDummy(game, { team: 1, x: X + dist, y: Y, hp });
  return { game, c, dummy };
}
function learn(c, slot, rank = 1) { const ab = c.abilities[slot]; while (ab.rank < rank) { ab.rank++; if (ab.rank === 1 && ab.def.onLearn) ab.def.onLearn(c, ab); } c.recalcStats(); return ab; }
function collect(game, name, filter = () => true) { const l = []; game.events.on(name, (e) => { if (filter(e)) l.push(e); }); return l; }
function stepUntil(game, cond, maxSec = 3) { const n = Math.round(maxSec / TICK); for (let i = 0; i < n && !cond(); i++) game.step(TICK); return cond(); }

test('Q 暗之禁锢：魔法伤害、禁锢，灵魂虹吸回复生命', () => {
  const { game, c, dummy } = setup();
  learn(c, 'Q');
  c.hp = c.maxHp * 0.5;
  const hp0 = c.hp;
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'morgana_q');
  assert(c.castAbility('Q', { x: dummy.x, y: dummy.y }).ok, '施放');
  assert(stepUntil(game, () => dmg.length > 0, 2), '命中');
  approx(dmg[0].amount, MORGANA.qDamage(c, 1), 1e-6, '伤害');
  assert(dummy.hasCC('root') && dummy.ccRemaining('root') > 1.9, '禁锢 2 秒');
  assert(c.hp - hp0 >= dmg[0].amount * 0.14 - 1, '灵魂虹吸');
});

test('W 痛苦腐蚀：每 0.5 秒伤害，低血量增伤，命中英雄减少冷却', () => {
  const { game, c, dummy } = setup({ dist: 600 });
  const w = learn(c, 'W');
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'morgana_w');
  assert(c.castAbility('W', { x: dummy.x, y: dummy.y }).ok, '施放');
  run(game, 0.3);
  const cd0 = w.cdRemaining;
  run(game, 1.3);
  assert(dmg.length >= 2, '持续伤害');
  approx(dmg[0].amount, MORGANA.wTick(c, 1, null), 0.5, '满血基础伤害');
  assert(cd0 - w.cdRemaining > 1.3 + 0.5 * 2 - 0.1, '冷却额外减少');
  dummy.hp = dummy.maxHp * 0.2;
  const n = dmg.length;
  run(game, 0.6);
  assert(dmg.length > n && dmg[dmg.length - 1].amount > MORGANA.wTick(c, 1, null) * 2, '低血量增伤');
  run(game, 4);
  const total = dmg.length;
  run(game, 1);
  assert(dmg.length === total && total <= 10, '5 秒后结束（10 跳）');
});

test('E 黑暗之盾：友方魔法护盾并免疫控制', () => {
  const { game, c, dummy } = setup();
  learn(c, 'E');
  const ally = spawnDummy(game, { team: 0, x: X + 300, y: Y, hp: 3000 });
  assert(c.castAbility('E', { target: ally }).ok, '施放');
  const s = ally.shields.find((x) => x.id === 'morgana_e');
  assert(s && s.type === 'magic', '魔法护盾');
  approx(s.amount, MORGANA.eShield(c, 1), 1e-6, '护盾数值');
  assert(!ally.applyCC('stun', 1, { source: dummy }), '免疫眩晕');
  assert(!ally.slow(0.5, 1, dummy), '免疫减速');
  game.dealDamage(dummy, ally, 200, 'magic', {});
  run(game, 0.05);
  assert(!ally.hasBuff(MORGANA.E_BUFF), '护盾破裂移除效果');
  assert(ally.applyCC('stun', 1, { source: dummy }), '恢复可被控制');
});

test('R 灵魂镣铐：连接减速，3 秒后眩晕；超出距离断链', () => {
  const { game, c, dummy } = setup({ level: 6, dist: 400 });
  learn(c, 'R');
  const far = spawnDummy(game, { team: 1, x: X - 500, y: Y, hp: 8000 });
  const dmg = collect(game, 'damage', (e) => e.source === c && e.spell === 'morgana_r');
  const stun = collect(game, 'damage', (e) => e.source === c && e.spell === 'morgana_r_stun');
  assert(c.castAbility('R', {}).ok, '施放');
  assert(stepUntil(game, () => dmg.length >= 2, 1), '连接两名英雄');
  approx(dmg[0].amount, MORGANA.rDamage(c, 1), 1e-6, '伤害');
  assert(dummy.hasCC('slow') && c.modelState.morganaChains, '减速与 modelState');
  far.setPosition(X - 1300, Y);
  run(game, 3.1);
  assert(stun.length === 1 && stun[0].target === dummy, '仅未断链者受到二段伤害');
  assert(dummy.hasCC('stun') && !far.hasCC('stun'), '眩晕');
  assert(!c.modelState.morganaChains, '结束复位');
});

test('R 灵魂镣铐：附近无敌方英雄时不施放', () => {
  const { c } = setup({ level: 6, dist: 2000 });
  const r = learn(c, 'R');
  assert(!c.castAbility('R', {}).ok || r.ready, '无目标不进入冷却');
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
