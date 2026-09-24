// 锤石技能测试：地狱诅咒（灵魂掉落/拾取/属性/AI 拾取）、死亡判决/死亡飞跃、魂引之灯（护盾/拉回/AI 队友）、厄运钟摆（被动/推拉/减速）、幽冥监牢（穿墙/减半/缺口）、AI 提示
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { threshQDamage, threshWShield, threshEDamage, threshEPassive, threshRDamage, threshSouls, spawnSoul, THRESH } from '../js/champions/thresh.js';
import { DIFFICULTY, TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;

function setup({ level = 1, dist = 800, dummyHp = 5000, red = [], blue = ['thresh'] } = {}) {
  const game = makeGame({ blue, red, waves: false, open: true });
  const th = game.champions[0];
  th.setPosition(X, Y);
  th.facing = 0;
  if (level > 1) th.setLevel(level);
  th.mana = th.maxMana;
  const dummy = dist != null ? spawnDummy(game, { team: 1, x: X + dist, y: Y, hp: dummyHp }) : null;
  return { game, th, dummy };
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
function setAP(c, ap) { c.bonusStats.ap = ap; c.recalcStats(); }
function fakeAI(champ, game, target, ctx = 'fight') {
  return {
    champ, game, role: 'support', params: { ...DIFFICULTY.hard, accuracy: 1, dodge: 1 }, mode: 'fighting', target, castContext: ctx,
    visibleEnemies: (r = 2000) => game.queryUnits({ x: champ.x, y: champ.y, radius: r, enemyOf: champ, types: ['champion'] }),
    nearbyAllies: (r = 1500) => game.queryUnits({ x: champ.x, y: champ.y, radius: r, allyOf: champ, types: ['champion'], exclude: champ }),
    hpPct: () => champ.hp / champ.maxHp,
    predict: (u) => ({ x: u.x, y: u.y }),
    castAt: (slot, x, y) => champ.castAbility(slot, { x, y }),
    castOn: (slot, u) => champ.castAbility(slot, { target: u }),
    castSelf: (slot) => champ.castAbility(slot, {}),
    isUnderEnemyTurret: () => false,
    isSafe: () => true,
  };
}
const soulZones = (game) => game.zones.filter((z) => z.data?.soul && !z.dead);

// —— 被动 ——
test('地狱诅咒：敌方英雄阵亡必掉灵魂，锤石靠近拾取后 +0.75 护甲/法强；护甲不随等级成长', () => {
  const { game, th, dummy } = setup({ dist: 600, dummyHp: 50 });
  const a0 = th.stats.armor, ap0 = th.stats.ap;
  th.setLevel(10); th.recalcStats();
  approx(th.stats.armor, a0, 1e-9, '护甲不随等级成长');
  game.dealDamage(th, dummy, 999, 'true', {});
  assert(!dummy.alive, '假人阵亡');
  assert(soulZones(game).length === 1, '掉落 1 个灵魂');
  th.moveTo(X + 600, Y);
  stepUntil(game, () => threshSouls(th) >= 1, 4);
  assert(threshSouls(th) === 1, '拾取灵魂');
  assert(soulZones(game).length === 0, '灵魂被移除');
  th.recalcStats();
  approx(th.stats.armor, a0 + THRESH.P_ARMOR, 1e-9, '+0.75 护甲');
  approx(th.stats.ap, ap0 + THRESH.P_AP, 1e-9, '+0.75 法强');
  assert(th.passive.def.desc(th).includes('已收集 1 个灵魂'), '描述显示灵魂数');
});

test('地狱诅咒：小兵约 1/3 几率掉落、超出 1900 码不掉、灵魂 15 秒后消失、灯笼可拾取', () => {
  const { game, th } = setup({ dist: null });
  let drops = 0;
  for (let i = 0; i < 60; i++) {
    const m = spawnDummy(game, { team: 1, type: 'minion', x: X + 900, y: Y + 400, hp: 10 });
    const before = soulZones(game).length;
    game.dealDamage(th, m, 999, 'true', {});
    if (soulZones(game).length > before) drops++;
    for (const z of soulZones(game)) z.remove();
  }
  assert(drops >= 10 && drops <= 32, `小兵掉落率约 1/3（${drops}/60）`);
  const far = spawnDummy(game, { team: 1, x: X + 2500, y: Y, hp: 10 });
  game.dealDamage(th, far, 999, 'true', {});
  assert(soulZones(game).length === 0, '超出范围不掉落');
  const s = spawnSoul(th, X + 800, Y);
  run(game, THRESH.P_LIFE + 0.2);
  assert(s.dead && threshSouls(th) === 0, '15 秒后消失且未被拾取');
  // 灯笼拾取
  learn(th, 'W', 1);
  spawnSoul(th, X + 700, Y + 60);
  assert(th.castAbility('W', { x: X + 700, y: Y }).ok, '投掷灯笼');
  stepUntil(game, () => threshSouls(th) >= 1, 2);
  assert(threshSouls(th) === 1, '灯笼收集灵魂');
});

test('地狱诅咒 AI：空闲时自动走去拾取附近灵魂', () => {
  const { game, th } = setup({ dist: null });
  th.controller = { mode: 'laning', update() {}, visibleEnemies: () => [], isUnderEnemyTurret: () => false };
  spawnSoul(th, X + 450, Y + 100);
  stepUntil(game, () => threshSouls(th) >= 1, 4);
  assert(threshSouls(th) === 1, 'AI 拾取灵魂');
  th.controller.mode = 'fighting';
  spawnSoul(th, X + 900, Y);
  run(game, 3);
  assert(threshSouls(th) === 1, '战斗中不去捡');
});

// —— Q ——
test('Q 死亡判决：0.5 秒蓄力，100+100% AP 魔法伤害，眩晕 1.5 秒并拉向锤石', () => {
  const { game, th, dummy } = setup({ dist: 900 });
  const ab = learn(th, 'Q', 1);
  setAP(th, 50);
  const dmg = collect(game, 'damage', (e) => e.source === th && e.target === dummy);
  const m0 = th.mana;
  assert(th.castAbility('Q', { x: X + 1000, y: Y }).ok, '施放');
  approx(m0 - th.mana, 70, 1e-6, '消耗 70 法力');
  run(game, 0.45);
  assert(game.projectiles.filter((p) => !p.dead).length === 0, '蓄力期间未出手');
  stepUntil(game, () => dmg.length > 0, 1.5);
  assert(dmg.length === 1, '命中');
  approx(dmg[0].amount, threshQDamage(th, 1), 1e-6, '伤害 = 150');
  approx(threshQDamage(th, 1), 150, 1e-9, '公式');
  approx(dummy.ccRemaining('stun'), THRESH.Q_STUN, 0.05, '眩晕 1.5 秒');
  assert(ab.isRecastActive && ab.state.hookTarget === dummy, '进入死亡飞跃窗口');
  const d0 = th.distTo(dummy);
  stepUntil(game, () => !ab.isRecastActive, 2);
  assert(!ab.isRecastActive, '窗口结束');
  // 命中后冷却 = 20 - 3（窗口结束后开始）
  approx(ab.cdRemaining, 17, 0.05, '命中后冷却缩短 3 秒');
  run(game, 0.2);
  const d1 = th.distTo(dummy);
  assert(d1 < d0 - 400, `目标被拉近（${d0.toFixed(0)} → ${d1.toFixed(0)}）`);
  approx(d1, THRESH.Q_PULL_STOP, 30, '拉至锤石身前');
});

test('Q 死亡飞跃：窗口内再次施放冲向目标，冷却按命中规则；未命中则完整冷却', () => {
  const { game, th, dummy } = setup({ dist: 1000 });
  const ab = learn(th, 'Q', 5);
  assert(th.castAbility('Q', { x: X + 1000, y: Y }).ok, '施放');
  stepUntil(game, () => ab.isRecastActive, 2);
  assert(ab.isRecastActive, '钩中');
  run(game, 0.2);
  const casts = collect(game, 'abilityCast', (e) => e.caster === th && e.isRecast);
  assert(th.castAbility('Q', {}).ok, '死亡飞跃');
  assert(casts.length === 1, '触发再次施放事件');
  assert(!!th.dashState, '冲刺中');
  approx(ab.cdRemaining, 12 - 3, 1e-6, '5 级冷却 12 - 3（飞跃时开始）');
  stepUntil(game, () => !th.dashState, 2);
  assert(th.distTo(dummy) < 60 + dummy.radius + 20, `到达目标身边（${th.distTo(dummy).toFixed(0)}）`);
  // 未命中
  const g2 = setup({ dist: 900 });
  const ab2 = learn(g2.th, 'Q', 1);
  assert(g2.th.castAbility('Q', { x: X, y: Y + 1000 }).ok, '向空地施放');
  run(g2.game, 1.5);
  assert(!ab2.isRecastActive, '未命中无窗口');
  approx(ab2.cdRemaining, 20 - 1.5 + 0.5, 0.05, '完整冷却（出手时开始）');
});

test('Q：锁链被第一个小兵阻挡', () => {
  const { game, th, dummy } = setup({ dist: 900 });
  learn(th, 'Q', 1);
  const minion = spawnDummy(game, { team: 1, type: 'minion', x: X + 400, y: Y, hp: 3000 });
  const dmg = collect(game, 'damage', (e) => e.source === th);
  th.castAbility('Q', { x: X + 1000, y: Y });
  run(game, 1.2);
  assert(dmg.length === 1 && dmg[0].target === minion, '命中小兵');
  assert(dummy.hp === dummy.maxHp, '英雄未受伤');
  assert(th.abilities.Q.state.hookTarget === minion, '钩住小兵');
});

// —— W ——
test('W 魂引之灯：锤石与首个友方获得 60+灵魂数 护盾 2 秒；友方靠近灯笼被拉回；灯笼 6 秒后收回', () => {
  const { game, th } = setup({ dist: null, blue: ['thresh', 'jinx'] });
  const ally = game.champions[1];
  ally.setPosition(X + 900, Y);
  const ab = learn(th, 'W', 1);
  th.passive.state && th.getBuff('thresh_souls').addStacks(4);
  approx(threshWShield(th, 1), 64, 1e-9, '护盾 = 60 + 4');
  assert(th.castAbility('W', { x: X + 1500, y: Y }).ok, '施放');
  run(game, 0.4);
  approx(th.totalShield, 64, 1e-6, '锤石护盾');
  assert(th.modelState.lanternOut === true, 'lanternOut');
  const L = ab.state.lantern;
  assert(L && L.x > X + 100, '灯笼飞行');
  stepUntil(game, () => L.landed, 1.5);
  assert(L.landed, '落地');
  approx(L.x, X + 950, 5, '射程截断到 950');
  approx(ally.totalShield, 64, 1e-6, '友方护盾');
  run(game, 0.2);
  assert(!!ally.dashState, '友方已靠近灯笼 → 被拉回');
  stepUntil(game, () => !ally.dashState, 1.5);
  assert(th.distTo(ally) < 200, `友方到达锤石身边（${th.distTo(ally).toFixed(0)}）`);
  assert(!ab.state.lantern && th.modelState.lanternOut === false, '灯笼使用后收回');
  run(game, 1.6);
  approx(th.totalShield, 0, 1e-6, '2 秒后护盾消失');
  // 无人使用：6 秒后收回
  ab.cooldownUntil = 0;
  assert(th.castAbility('W', { x: X - 600, y: Y }).ok, '再次施放');
  run(game, 1);
  assert(ab.state.lantern?.landed, '落地');
  run(game, 6);
  assert(!ab.state.lantern && !th.modelState.lanternOut, '6 秒后收回');
});

test('W：AI 队友危险时主动走向灯笼并被拉回；健康队友不受影响', () => {
  const { game, th } = setup({ dist: null, blue: ['thresh', 'jinx', 'lux'] });
  const hurt = game.champions[1];
  const fine = game.champions[2];
  hurt.setPosition(X + 1300, Y); fine.setPosition(X + 1200, Y + 700);
  hurt.controller = { mode: 'retreating', update() {} };
  fine.controller = { mode: 'laning', update() {} };
  hurt.hp = hurt.maxHp * 0.2; hurt.lastDamagedAt = game.time;
  learn(th, 'W', 1);
  assert(th.castAbility('W', { x: X + 900, y: Y + 250 }).ok, '施放');
  const fy = fine.y;
  stepUntil(game, () => !!hurt.dashState, 3);
  assert(!!hurt.dashState, '残血队友走到灯笼并被拉回');
  stepUntil(game, () => !hurt.dashState, 2);
  assert(th.distTo(hurt) < 200, '到达锤石身边');
  approx(fine.y, fy, 1, '健康队友未移动');
});

// —— E ——
test('E 厄运钟摆被动：普攻附带 灵魂数 + 0~80% AD（10 秒充满）', () => {
  const { game, th, dummy } = setup({ dist: 300 });
  learn(th, 'E', 1);
  th.getBuff('thresh_souls').addStacks(10);
  th.recalcStats();
  const extra = collect(game, 'damage', (e) => e.source === th && e.spell === 'thresh_e_passive');
  th.attackUnit(dummy);
  stepUntil(game, () => extra.length >= 1, 3);
  approx(extra[0].amount, 10 + 0.8 * th.stats.ad, 1e-6, '满充能');
  const t1 = game.time;
  stepUntil(game, () => extra.length >= 2, 3);
  const el = game.time - t1;
  approx(extra[1].amount, threshEPassive(th, 1, el), 2, '按间隔充能');
  assert(extra[1].amount < 10 + 0.3 * th.stats.ad, '刚普攻过伤害较低');
});

test('E 厄运钟摆：75+40% AP，减速 20% 1 秒；前方敌人被推远、向后施放把前方敌人拉近；后方敌人也被命中', () => {
  const { game, th, dummy } = setup({ dist: 400 });
  const ab = learn(th, 'E', 1);
  setAP(th, 100);
  const back = spawnDummy(game, { team: 1, x: X - 400, y: Y, hp: 5000 });
  const dmg = collect(game, 'damage', (e) => e.source === th && e.spell === 'thresh_e');
  assert(th.castAbility('E', { x: X + 500, y: Y }).ok, '向前施放（推）');
  run(game, 0.36);
  assert(dmg.length === 0, '前摇 0.389 秒');
  stepUntil(game, () => dmg.length >= 2, 0.5);
  assert(dmg.length === 2, '前后两侧都命中');
  approx(dmg[0].amount, threshEDamage(th, 1), 1e-6, '伤害 115');
  approx(threshEDamage(th, 1), 115, 1e-9, '公式');
  approx(dummy.getCC('slow')?.amount ?? 0, 0.2, 1e-9, '减速 20%');
  approx(dummy.ccRemaining('slow'), 1, 0.05, '减速 1 秒');
  run(game, 0.5);
  approx(dummy.x, X + 400 + THRESH.E_KNOCK, 5, '前方敌人被推远');
  assert(back.x > X - 400 + 100 && back.x < X - 40, `后方敌人被拉近（${(back.x - X).toFixed(0)}）`);
  // 拉：向身后施放
  ab.cooldownUntil = 0;
  const x0 = dummy.x;
  run(game, 1);
  assert(th.castAbility('E', { x: X - 500, y: Y }).ok, '向后施放（拉）');
  run(game, 1);
  assert(dummy.x < x0 - 150, `前方敌人被拉近（${(x0 - X).toFixed(0)} → ${(dummy.x - X).toFixed(0)}）`);
  assert(dummy.x > X, '不会越过锤石');
  approx(ab.cdRemaining, 13 - (1 - 0.389), 0.05, '冷却 13 秒（出手时开始）');
});

// —— R ——
test('R 幽冥监牢：0.75 秒后成墙；首次穿墙 250+100% AP 与 99% 减速 2 秒，墙碎裂；再穿墙减半；缺口通过无效', () => {
  const { game, th } = setup({ dist: null, level: 6 });
  const ab = learn(th, 'R', 1);
  setAP(th, 100);
  const e1 = spawnDummy(game, { team: 1, x: X + 200, y: Y, hp: 9000, ms: 400 });
  const e2 = spawnDummy(game, { team: 1, x: X + 150, y: Y + 50, hp: 9000, ms: 400 });
  const dmg = collect(game, 'damage', (e) => e.source === th && e.spell === 'thresh_r');
  assert(th.castAbility('R').ok, '施放');
  run(game, 0.7);
  assert(!ab.state.box, '蓄力中');
  run(game, 0.1);
  const box = ab.state.box;
  assert(!!box && box.verts.length === 5, '五边形监牢');
  // e1 向正前方走出（穿过前方的墙）
  e1.moveTo(X + 900, Y);
  stepUntil(game, () => dmg.length >= 1, 3);
  assert(dmg.length === 1 && dmg[0].target === e1, '穿墙受伤');
  approx(dmg[0].amount, threshRDamage(th, 1), 1e-6, '伤害 350');
  approx(e1.getCC('slow')?.amount ?? 0, 0.99, 1e-9, '减速 99%');
  approx(e1.ccRemaining('slow'), 2, 0.05, '2 秒');
  assert(box.broken.filter(Boolean).length === 1, '该墙碎裂');
  // e2 从同一缺口通过：无效
  e2.moveTo(X + 900, Y + 20);
  run(game, 2.5);
  assert(dmg.length === 1, '从缺口通过不触发');
  // e1 穿过另一面墙回到监牢内：伤害与减速时长减半
  e1.removeCC('slow');
  e1.setPosition(X + 300, Y + 600);
  run(game, 0.05);
  e1.moveTo(X, Y + 100);
  stepUntil(game, () => dmg.length >= 2, 3);
  assert(dmg.length === 2, '第二次穿墙');
  approx(dmg[1].amount, threshRDamage(th, 1) * 0.5, 1e-6, '伤害减半');
  approx(e1.ccRemaining('slow'), 1, 0.05, '减速时长减半');
  run(game, 5);
  assert(!ab.state.box, '5 秒后消失');
  approx(ab.cdRemaining, 140 - 5.75 - 0.05 - 2.5 - 3 + 3.8, 6, '冷却约 140 秒');
});

// —— AI ——
test('AI custom：Q 钩敌方英雄，钩中后死亡飞跃；E 拉回；W 救残血队友；R 团战开', () => {
  // Q
  const { game, th, dummy } = setup({ dist: 900, blue: ['thresh', 'ashe'], level: 6 });
  const ally = game.champions[1];
  ally.setPosition(X - 300, Y);
  dummy.role = 'adc';
  for (const s of ['Q', 'W', 'E']) learn(th, s, 1);
  learn(th, 'R', 1);
  const ai = fakeAI(th, game, dummy);
  const qc = th.abilities.Q.def.ai.custom;
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) ok = qc(th, th.abilities.Q, ai, game);
  assert(ok, 'AI 施放 Q');
  stepUntil(game, () => th.abilities.Q.isRecastActive, 2);
  assert(th.abilities.Q.isRecastActive, 'AI 钩中');
  run(game, 0.6);
  ok = qc(th, th.abilities.Q, ai, game);
  assert(ok && !!th.dashState, 'AI 死亡飞跃');
  stepUntil(game, () => !th.dashState, 2);
  // E
  run(game, 1.6);
  const ec = th.abilities.E.def.ai.custom;
  assert(ec(th, th.abilities.E, ai, game), 'AI 施放 E');
  // W 救人
  run(game, 0.5);
  ally.setPosition(X + 700, Y + 500);
  ally.hp = ally.maxHp * 0.2; ally.lastDamagedAt = game.time;
  const wc = th.abilities.W.def.ai.custom;
  assert(wc(th, th.abilities.W, ai, game), 'AI 施放 W');
  // R
  spawnDummy(game, { team: 1, x: th.x + 150, y: th.y + 100, hp: 5000 });
  dummy.setPosition(th.x - 150, th.y);
  const rc = th.abilities.R.def.ai.custom;
  run(game, 0.5);
  assert(rc(th, th.abilities.R, ai, game), 'AI 施放 R');
  // 无目标时不乱放
  const g2 = setup({ dist: null, level: 6 });
  for (const s of ['Q', 'W', 'E']) learn(g2.th, s, 1);
  learn(g2.th, 'R', 1);
  const ai2 = fakeAI(g2.th, g2.game, null);
  for (const s of ['Q', 'W', 'E', 'R']) assert(!g2.th.abilities[s].def.ai.custom(g2.th, g2.th.abilities[s], ai2, g2.game), `${s} 无目标不施放`);
  // 定义完整性
  const def = th.def;
  assert(!def.stub && def.ai.skillOrder.length === 3 && def.ai.combo.length > 0, 'ai 定义');
  for (const s of ['Q', 'W', 'E', 'R']) assert(def.abilities[s].desc(th, 1).length > 20 && def.abilities[s].icon.glyph, `${s} 描述与图标`);
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
