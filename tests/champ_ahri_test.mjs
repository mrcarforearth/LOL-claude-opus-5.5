// 阿狸技能测试：Q 去程魔法/回程真实、W 狐火目标优先级与递减伤害、E 魅惑、R 三段突进与飞弹、被动回复、AI 冒烟
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { AHRI } from '../js/champions/ahri.js';
import { mitigate } from '../js/core/damage.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;

function setup({ level = 1, ap = 0, ranks = {} } = {}) {
  const game = makeGame({ blue: ['ahri'], waves: false, open: true });
  const ahri = game.champions[0];
  ahri.setPosition(X, Y);
  ahri.facing = 0;
  if (level > 1) ahri.setLevel(level);
  if (ap) { ahri.bonusStats.ap = ap; ahri.recalcStats(); }
  ahri.skillPoints = 20;
  for (const [s, r] of Object.entries(ranks)) for (let i = 0; i < r; i++) { ahri.abilities[s].rank++; if (ahri.abilities[s].rank === 1) ahri.abilities[s].def.onLearn?.(ahri, ahri.abilities[s]); }
  ahri.mana = ahri.maxMana;
  return { game, ahri };
}
function collect(game, name, filter = () => true) {
  const list = [];
  game.events.on(name, (e) => { if (filter(e)) list.push(e); });
  return list;
}
// 与 AI 控制器接口一致的测试替身
function mockAI(champ, game, extra = {}) {
  return {
    champ, game, role: 'mid', mode: 'fighting', target: null, params: { accuracy: 1, reaction: 0 },
    visibleEnemies: (r = 2000) => game.queryUnits({ x: champ.x, y: champ.y, radius: r, enemyOf: champ, targetableBy: champ, types: ['champion'] }),
    nearbyAllies: (r = 1500) => game.champions.filter((c) => c.team === champ.team && c !== champ && c.alive && champ.distTo(c) <= r),
    hpPct: () => champ.hp / champ.maxHp,
    predict: (u) => ({ x: u.x, y: u.y }),
    castAt: (slot, x, y) => champ.castAbility(slot, { x, y }),
    castOn: (slot, u) => champ.castAbility(slot, { target: u, x: u.x, y: u.y }),
    castSelf: (slot) => champ.castAbility(slot, {}),
    isUnderEnemyTurret: () => false,
    isSafe: () => true,
    ...extra,
  };
}

// —— Q：欺诈宝珠 ——
test('Q：去程魔法伤害、回程等额真实伤害，穿透且每个目标去回各一次', () => {
  const { game, ahri } = setup({ ap: 100, ranks: { Q: 3 } });
  const d1 = spawnDummy(game, { team: 1, x: X + 400, y: Y, hp: 5000, mr: 50 });
  const d2 = spawnDummy(game, { team: 1, x: X + 650, y: Y, hp: 5000, mr: 0 });
  const dmg = collect(game, 'damage', (e) => e.spell === 'ahri_q' || e.spell === 'ahri_q_return');
  const mana0 = ahri.mana;
  const r = ahri.castAbility('Q', { x: X + 1000, y: Y });
  assert(r.ok, `Q 施放成功 ${r.reason}`);
  approx(ahri.mana, mana0 - 65, 1e-6, 'Q 3 级消耗 65');
  run(game, 3);
  const raw = 90 + 0.45 * 100;
  approx(raw, AHRI.qDamage(ahri, 3), 1e-9, 'qDamage 公式');
  const out = dmg.filter((e) => e.spell === 'ahri_q');
  const back = dmg.filter((e) => e.spell === 'ahri_q_return');
  assert(out.length === 2 && back.length === 2, `去回各命中 2 次（去 ${out.length} 回 ${back.length}）`);
  const o1 = out.find((e) => e.target === d1), b1 = back.find((e) => e.target === d1);
  approx(o1.amount, raw * 100 / 150, 1e-6, '去程魔法伤害（50 魔抗）');
  assert(o1.type === 'magic' && b1.type === 'true', '伤害类型');
  approx(b1.amount, raw, 1e-6, '回程真实伤害不受魔抗影响');
  approx(out.find((e) => e.target === d2).amount, raw, 1e-6, '穿透命中第二个目标');
  assert(game.projectiles.length === 0, '宝珠已回到阿狸身边');
  approx(ahri.abilities.Q.cdDuration, 7, 1e-9, 'Q 冷却 7 秒');
});

test('Q：回程从 60 开始加速到 2600', () => {
  const { game, ahri } = setup({ ranks: { Q: 1 } });
  ahri.castAbility('Q', { x: X - 1000, y: Y });
  run(game, 0.3);
  const p = game.projectiles[0];
  assert(p && p.vfx.kind === 'ahri_q_orb', '宝珠投射物');
  approx(p.speed, 1550, 1e-9, '去程速度 1550');
  let sawReturn = false, maxSpeed = 0;
  for (let i = 0; i < 90 && !p.dead; i++) {
    run(game, 1 / 30);
    if (p.returning) { if (!sawReturn) { sawReturn = true; assert(p.speed <= 200, `回程初速很慢 ${p.speed}`); } maxSpeed = Math.max(maxSpeed, p.speed); }
  }
  assert(sawReturn && maxSpeed > 1500 && maxSpeed <= 2600, `回程加速 ${maxSpeed}`);
});

// —— W：妖异狐火 ——
test('W：单目标承受 3 团狐火（100% + 30% + 30%），移速递减', () => {
  const { game, ahri } = setup({ ap: 50, ranks: { W: 2 } });
  const d = spawnDummy(game, { team: 1, x: X + 350, y: Y, hp: 5000 });
  const dmg = collect(game, 'damage', (e) => e.spell === 'ahri_w');
  const baseMs = ahri.stats.moveSpeed;
  assert(ahri.castAbility('W').ok, 'W 施放');
  run(game, 1 / 30);
  const boosted = ahri.stats.moveSpeed;
  assert(boosted > baseMs * 1.3, `初始移速大幅提升 ${baseMs} → ${boosted}`);
  run(game, 1.0);
  assert(ahri.stats.moveSpeed < boosted && ahri.stats.moveSpeed > baseMs, '移速递减');
  run(game, 1.6);
  approx(ahri.stats.moveSpeed, baseMs, 1e-6, '2 秒后移速恢复');
  const per = 75 + 0.3 * 50;
  assert(dmg.length === 3, `三团狐火命中（${dmg.length}）`);
  const total = dmg.reduce((s, e) => s + e.amount, 0);
  approx(total, per * 1.6, 1e-6, '总伤害 = 100% + 30% + 30%');
  approx(dmg[0].amount, per, 1e-6, '第一团全额');
  assert(d.hp < 5000, '假人受伤');
  approx(ahri.abilities.W.cdDuration, 8, 1e-9, 'W 2 级冷却 8 秒');
});

test('W：狐火优先被魅惑的英雄，其次英雄，最后小兵；范围 550', () => {
  const { game, ahri } = setup({ ranks: { W: 1, E: 1 } });
  const minion = spawnDummy(game, { team: 1, x: X + 150, y: Y, hp: 3000, type: 'minion' });
  const c1 = spawnDummy(game, { team: 1, x: X + 300, y: Y + 50, hp: 3000 });
  const c2 = spawnDummy(game, { team: 1, x: X - 450, y: Y, hp: 3000 });
  const far = spawnDummy(game, { team: 1, x: X, y: Y + 800, hp: 3000 });
  // 先魅惑较远的 c2
  ahri.abilities.E.state.charmed = { unit: c2, until: game.time + 5 };
  const dmg = collect(game, 'damage', (e) => e.spell === 'ahri_w');
  ahri.castAbility('W');
  run(game, 2);
  assert(dmg.length === 3 && dmg.every((e) => e.target === c2), `全部追击被魅惑的英雄 ${dmg.map((e) => e.target.name)}`);
  // 无魅惑：追击最近的英雄而不是更近的小兵
  ahri.abilities.E.state.charmed = null;
  ahri.abilities.W.cooldownUntil = 0;
  const dmg2 = collect(game, 'damage', (e) => e.spell === 'ahri_w');
  ahri.castAbility('W');
  run(game, 2);
  assert(dmg2.length === 3 && dmg2.every((e) => e.target === c1), '优先英雄');
  assert(!dmg.concat(dmg2).some((e) => e.target === minion || e.target === far), '不打小兵/范围外');
  // 只有小兵
  c1.hp = 0; c1.die(null); c2.die(null);
  ahri.abilities.W.cooldownUntil = 0;
  const dmg3 = collect(game, 'damage', (e) => e.spell === 'ahri_w');
  ahri.castAbility('W');
  run(game, 2);
  assert(dmg3.length === 3 && dmg3.every((e) => e.target === minion), '没有英雄时攻击小兵');
});

test('W：范围内没有敌人时狐火环绕，2.5 秒后消失', () => {
  const { game, ahri } = setup({ ranks: { W: 1 } });
  ahri.castAbility('W');
  run(game, 0.5);
  assert(ahri.modelState.foxFire === 3 && ahri.hasBuff('ahri_w'), '狐火环绕中');
  const d = spawnDummy(game, { team: 1, x: X + 400, y: Y, hp: 3000 });
  run(game, 1.2);
  assert(d.hp < 3000 && ahri.modelState.foxFire === 0, '敌人进入范围后狐火发射');
  run(game, 1.5);
  assert(!ahri.hasBuff('ahri_w'), '持续 2.5 秒');
});

// —— E：魅惑妖术 ——
test('E：命中首个敌人，造成伤害并魅惑（走向阿狸）', () => {
  const { game, ahri } = setup({ ap: 100, ranks: { E: 5 } });
  const d = spawnDummy(game, { team: 1, x: X + 700, y: Y, hp: 5000, mr: 30, ms: 330 });
  const behind = spawnDummy(game, { team: 1, x: X + 850, y: Y, hp: 5000 });
  const ccs = collect(game, 'cc', (e) => e.type === 'charm');
  const dmg = collect(game, 'damage', (e) => e.spell === 'ahri_e');
  assert(ahri.castAbility('E', { x: X + 900, y: Y }).ok, 'E 施放');
  run(game, 0.25 + 700 / 1550);
  assert(dmg.length === 1 && dmg[0].target === d, '只命中第一个敌人');
  approx(dmg[0].amount, mitigate(ahri, d, 240 + 0.85 * 100, 'magic'), 1e-6, 'E 5 级伤害');
  assert(ccs.length === 1 && ccs[0].target === d, '魅惑');
  approx(ccs[0].duration, 2.2, 1e-9, '5 级魅惑 2.2 秒');
  assert(behind.hp === 5000, '后方目标未受影响');
  const x0 = d.x;
  run(game, 1);
  assert(d.x < x0 - 150, `被魅惑者走向阿狸 ${x0} → ${d.x}`);
  assert(!d.canAttack() && !d.canCast(), '魅惑期间无法行动');
  run(game, 1.5);
  assert(!d.hasCC('charm'), '魅惑结束');
  approx(ahri.abilities.E.cdDuration, 12, 1e-9, 'E 冷却 12 秒');
});

test('E：韧性缩短魅惑；超出 975 码不命中', () => {
  const { game, ahri } = setup({ ranks: { E: 1 } });
  const d = spawnDummy(game, { team: 1, x: X + 500, y: Y, hp: 5000 });
  d.bonusStats.tenacity = 0.5; d.recalcStats();
  const ccs = collect(game, 'cc', (e) => e.type === 'charm');
  ahri.castAbility('E', { x: X + 500, y: Y });
  run(game, 1);
  approx(ccs[0].duration, 0.7, 1e-9, '1 级 1.4 秒 × (1 - 50%)');
  const g2 = setup({ ranks: { E: 1 } });
  const far = spawnDummy(g2.game, { team: 1, x: X + 975 + 65 + 70, y: Y, hp: 5000 });
  g2.ahri.castAbility('E', { x: X + 2000, y: Y });
  run(g2.game, 1.5);
  assert(far.hp === 5000, '射程外');
});

// —— R：灵魄突袭 ——
test('R：突进 450 码后向 600 内最多 3 个敌人（优先英雄）发射飞弹', () => {
  const { game, ahri } = setup({ level: 6, ap: 100, ranks: { R: 1 } });
  const champ1 = spawnDummy(game, { team: 1, x: X + 800, y: Y, hp: 5000 });
  const m1 = spawnDummy(game, { team: 1, x: X + 500, y: Y + 60, hp: 5000, type: 'minion' });
  const m2 = spawnDummy(game, { team: 1, x: X + 520, y: Y - 60, hp: 5000, type: 'minion' });
  const m3 = spawnDummy(game, { team: 1, x: X + 560, y: Y + 150, hp: 5000, type: 'minion' });
  const dmg = collect(game, 'damage', (e) => e.spell === 'ahri_r');
  const mana0 = ahri.mana;
  const r = ahri.castAbility('R', { x: X + 2000, y: Y });
  assert(r.ok, `R 施放 ${r.reason}`);
  approx(ahri.mana, mana0 - 100, 1e-6, 'R 消耗 100');
  assert(ahri.dashState, '正在突进');
  run(game, 0.5);
  approx(ahri.x, X + 450, 2, '突进终点 x');
  approx(ahri.y, Y, 2, '突进终点 y');
  run(game, 1);
  const per = 60 + 0.35 * 100;
  assert(dmg.length === 3, `3 道飞弹 ${dmg.length}`);
  assert(dmg.some((e) => e.target === champ1), '英雄优先被选中');
  assert(dmg.every((e) => Math.abs(e.amount - per) < 1e-6), '每道 60 + 35% AP');
  const hitMinions = dmg.filter((e) => e.target.type === 'minion').length;
  assert(hitMinions === 2, '其余两道打小兵');
  assert(ahri.abilities.R.isRecastActive && ahri.abilities.R.state.remaining === 2, '可再次施放 2 次');
  assert(ahri.abilities.R.cooldownUntil <= game.time, '冷却尚未开始');
  void m1; void m2; void m3;
});

test('R：再次施放间隔 ≥1 秒，用尽后进入冷却；10 秒窗口到期也进入冷却', () => {
  const { game, ahri } = setup({ level: 6, ranks: { R: 1 } });
  const R = ahri.abilities.R;
  const casts = collect(game, 'abilityCast', (e) => e.slot === 'R');
  ahri.castAbility('R', { x: X + 450, y: Y });
  run(game, 0.5);
  assert(!ahri.castAbility('R', { x: X, y: Y + 450 }).ok, '1 秒内不能再次施放');
  run(game, 0.6);
  const p0 = { x: ahri.x, y: ahri.y };
  assert(ahri.castAbility('R', { x: p0.x, y: p0.y + 1000 }).ok, '第二段');
  run(game, 0.5);
  approx(ahri.y, p0.y + 450, 3, '第二段突进 450 码');
  assert(R.isRecastActive && R.state.remaining === 1, '剩余 1 次');
  run(game, 0.6);
  assert(ahri.castAbility('R', { x: ahri.x - 300, y: ahri.y }).ok, '第三段（短距离）');
  run(game, 0.5);
  assert(!R.isRecastActive, '三段用尽');
  approx(R.cdRemaining, 130 - 0.5, 0.05, '用尽后冷却 130 秒');
  assert(casts.length === 3 && casts.filter((e) => e.isRecast).length === 2, 'abilityCast 事件');
  assert(ahri.modelState.spiritRush === false, '外观状态复位');
  // 只施放一次：10 秒后冷却
  const g2 = setup({ level: 16, ranks: { R: 3 } });
  g2.ahri.castAbility('R', { x: X + 300, y: Y });
  run(g2.game, 5);
  assert(g2.ahri.abilities.R.isRecastActive, '5 秒时仍可再次施放');
  run(g2.game, 5.1);
  assert(!g2.ahri.abilities.R.isRecastActive, '10 秒后窗口结束');
  approx(g2.ahri.abilities.R.cdRemaining, 80, 0.2, '3 级冷却 80 秒');
});

test('R：被禁锢时不能突进；突进期间参与击杀英雄获得额外一次', () => {
  const { game, ahri } = setup({ level: 6, ranks: { R: 1 } });
  const R = ahri.abilities.R;
  ahri.applyCC('root', 1, { source: null });
  const mana0 = ahri.mana;
  assert(!ahri.castAbility('R', { x: X + 400, y: Y }).ok, '禁锢时施放失败');
  approx(ahri.mana, mana0, 1e-9, '失败返还法力');
  run(game, 1.1);
  const victim = spawnDummy(game, { team: 1, x: X + 700, y: Y, hp: 100 });
  ahri.castAbility('R', { x: X + 450, y: Y });
  run(game, 0.3);
  assert(R.state.remaining === 2, '剩余 2 次');
  game.dealDamage(ahri, victim, 1000, 'true');
  assert(!victim.alive, '击杀');
  assert(R.state.remaining === 3, `击杀后 +1（${R.state.remaining}）`);
  approx(R.recastRemaining, 10, 0.05, '持续时间刷新');
});

// —— 被动：摄魂夺魄 ——
test('被动：每击杀 9 个小兵回复生命；参与击杀英雄回复更多', () => {
  const { game, ahri } = setup({ level: 1, ap: 100 });
  ahri.hp = 200;
  const heals = collect(game, 'heal', (e) => e.target === ahri);
  for (let i = 0; i < 8; i++) {
    const m = spawnDummy(game, { team: 1, x: X + 200, y: Y + i * 10, hp: 10, type: 'minion' });
    game.dealDamage(ahri, m, 50, 'true');
  }
  assert(heals.length === 0 && ahri.passive.state.stacks === 8 && ahri.getBuff('ahri_essence').stacks === 8, '8 层');
  const m9 = spawnDummy(game, { team: 1, x: X + 200, y: Y, hp: 10, type: 'monster' });
  game.dealDamage(ahri, m9, 50, 'true');
  assert(heals.length === 1, '第 9 个触发回复');
  approx(heals[0].amount, 35 + 0.1 * 100, 1e-6, '1 级 35 + 10% AP');
  assert(ahri.passive.state.stacks === 0, '层数清零');
  const enemy = spawnDummy(game, { team: 1, x: X + 300, y: Y, hp: 100 });
  game.dealDamage(ahri, enemy, 500, 'true');
  assert(heals.length === 2, '击杀英雄回复');
  approx(heals[1].amount, 75 + 0.35 * 100, 1e-6, '1 级 75 + 35% AP');
  // 18 级数值
  const g2 = setup({ level: 18 });
  approx(AHRI.minionHeal(g2.ahri), 95, 1e-9, '18 级小兵回复 95');
  approx(AHRI.champHeal(g2.ahri), 165, 1e-9, '18 级英雄回复 165');
});

// —— 描述与 AI ——
test('技能描述含实时数值；desc(null, 0) 可用', () => {
  const { ahri } = setup({ ap: 100 });
  const def = ahri.def;
  for (const s of ['Q', 'W', 'E', 'R']) {
    assert(typeof def.abilities[s].desc(null, 0) === 'string', `${s} desc(null)`);
    assert(!def.abilities[s].stub && def.abilities[s].icon.glyph, `${s} 图标`);
  }
  assert(def.abilities.Q.desc(ahri, 1).includes('85'), 'Q 1 级 40 + 45 = 85');
  assert(def.passive.desc(ahri).includes('/9'), '被动显示层数');
  assert(!def.stub, '不是临时桩');
});

test('AI：E 命中后接 Q/W；R 追击残血；残血时 R 朝泉水躲避', () => {
  const { game, ahri } = setup({ level: 11, ranks: { Q: 5, W: 3, E: 2, R: 2 } });
  const foe = spawnDummy(game, { team: 1, x: X + 500, y: Y, hp: 3000, mr: 0 });
  const ai = mockAI(ahri, game, { target: foe });
  const A = ahri.abilities;
  assert(A.E.def.ai.custom(ahri, A.E, ai, game) === true, 'AI 施放 E');
  run(game, 0.8);
  assert(foe.hasCC('charm'), 'E 命中魅惑');
  assert(A.Q.def.ai.custom(ahri, A.Q, ai, game) === true, '魅惑后接 Q');
  run(game, 0.3);
  assert(A.W.def.ai.custom(ahri, A.W, ai, game) === true, '接 W');
  run(game, 1.5);
  // R 追击：目标残血
  foe.hp = foe.maxHp * 0.3;
  foe.setPosition(X + 900, Y);
  assert(A.R.def.ai.custom(ahri, A.R, ai, game) === true, '残血目标：R 追击');
  run(game, 0.4);
  assert(ahri.distTo(foe) < 900, '拉近距离');
  // 躲避
  const g2 = setup({ level: 6, ranks: { R: 1 } });
  const f2 = spawnDummy(g2.game, { team: 1, x: X + 300, y: Y + 300, hp: 3000 });
  g2.ahri.hp = g2.ahri.maxHp * 0.2;
  const ai2 = mockAI(g2.ahri, g2.game, { target: f2, mode: 'retreating' });
  const fountain = g2.game.fountainOf(0);
  const d0 = Math.hypot(g2.ahri.x - fountain.x, g2.ahri.y - fountain.y);
  assert(g2.ahri.abilities.R.def.ai.custom(g2.ahri, g2.ahri.abilities.R, ai2, g2.game) === true, '残血 R 躲避');
  run(g2.game, 0.4);
  const d1 = Math.hypot(g2.ahri.x - fountain.x, g2.ahri.y - fountain.y);
  assert(d1 < d0 - 300, `朝泉水方向突进 ${d0.toFixed(0)} → ${d1.toFixed(0)}`);
  // 无目标时不施放
  const g3 = setup({ ranks: { Q: 1, W: 1, E: 1 } });
  const ai3 = mockAI(g3.ahri, g3.game);
  for (const s of ['Q', 'W', 'E']) assert(g3.ahri.abilities[s].def.ai.custom(g3.ahri, g3.ahri.abilities[s], ai3, g3.game) === false, `${s} 无目标不施放`);
  // 控制器接口缺失（ai 为空对象）时不崩溃
  const g4 = setup({ ranks: { Q: 1, E: 1 } });
  spawnDummy(g4.game, { team: 1, x: X + 400, y: Y, hp: 3000 });
  g4.ahri.abilities.E.def.ai.custom(g4.ahri, g4.ahri.abilities.E, {}, g4.game);
  g4.ahri.abilities.Q.def.ai.custom(g4.ahri, g4.ahri.abilities.Q, null, g4.game);
});

test('AI：Q 清线（直线穿过 ≥3 个小兵）', () => {
  const { game, ahri } = setup({ ranks: { Q: 1 } });
  for (let i = 0; i < 3; i++) spawnDummy(game, { team: 1, x: X + 300 + i * 120, y: Y + 10, hp: 500, type: 'minion' });
  const ai = mockAI(ahri, game, { mode: 'laning' });
  assert(ahri.abilities.Q.def.ai.custom(ahri, ahri.abilities.Q, ai, game) === true, '清线施放 Q');
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
