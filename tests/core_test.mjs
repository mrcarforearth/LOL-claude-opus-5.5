// 核心模拟层测试：属性、公式、护盾、Buff、控制、位移、投射物、区域、盖伦技能、加点、冷却、回城、复活、奖励、召唤师技能等
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER, OpenNav, AllVision } from './helpers.mjs';
import { resistMultiplier, mitigate } from '../js/core/damage.js';
import { growth, softCapMoveSpeed } from '../js/core/stats.js';
import { respawnTime, killBounty } from '../js/core/rewards.js';
import { mulberry32, sweepCircle } from '../js/core/math.js';
import { EventBus } from '../js/core/events.js';
import { NullFX } from '../js/core/nullfx.js';
import { TICK } from '../js/config.js';
import { CHAMPIONS, CHAMPION_LIST } from '../js/champions/index.js';
import { garenRDamage } from '../js/champions/garen.js';

const quiet = process.argv.includes('--quiet');
const X = CENTER.x, Y = CENTER.y;

// 开阔场地上的盖伦 + 敌方假人
function garenSetup({ dummyHp = 3000, dummyArmor = 0, dummyMr = 0, dist = 150, walls, brushes, level = 1, extraBlue = [], red = [] } = {}) {
  const game = makeGame({ blue: ['garen', ...extraBlue], red, waves: false, open: walls || brushes ? { walls: walls || [], brushes: brushes || [] } : true });
  const garen = game.champions[0];
  garen.setPosition(X, Y);
  if (level > 1) garen.setLevel(level);
  const dummy = spawnDummy(game, { team: 1, x: X + dist, y: Y, hp: dummyHp, armor: dummyArmor, mr: dummyMr });
  return { game, garen, dummy };
}
function collect(game, name) {
  const list = [];
  game.events.on(name, (e) => list.push(e));
  return list;
}

// —— 基础工具 ——
test('种子随机数可复现且分布于 [0,1)', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 100; i++) { const v = a(); assert(v === b() && v >= 0 && v < 1, '随机序列一致'); }
});
test('事件总线：监听器异常不打断其余监听器', () => {
  const bus = new EventBus();
  let hit = 0;
  const origErr = console.error; console.error = () => {};
  bus.on('x', () => { throw new Error('boom'); });
  bus.on('x', () => hit++);
  const off = bus.on('x', () => hit++);
  bus.emit('x', {});
  off();
  bus.emit('x', {});
  console.error = origErr;
  assert(hit === 3, `应调用 3 次，实际 ${hit}`);
  let once = 0; bus.once('y', () => once++); bus.emit('y'); bus.emit('y');
  assert(once === 1, 'once 只触发一次');
});
test('NullFX 所有方法返回假句柄', () => {
  const fx = new NullFX();
  const h = fx.custom('whatever', {});
  assert(h && typeof h.remove === 'function' && h.alive === false, '假句柄');
  assert(fx.ring({}).alive === false && fx.anything().alive === false, '任意方法');
});
test('线段-圆扫掠检测', () => {
  assert(sweepCircle(0, 0, 1000, 0, 10, 500, 0, 30) > 0.45 && sweepCircle(0, 0, 1000, 0, 10, 500, 0, 30) < 0.5, '穿过圆心');
  assert(sweepCircle(0, 0, 1000, 0, 10, 500, 100, 30) === -1, '未接触');
});

// —— 属性 ——
test('属性成长公式（盖伦 1/2/18 级）', () => {
  const game = makeGame({ blue: ['garen'], waves: false, open: true });
  const g = game.champions[0];
  approx(g.maxHp, 690, 1e-9, '1 级生命');
  approx(growth(690, 98, 2), 690 + 98 * 0.72, 1e-9, '2 级成长系数 0.72');
  g.setLevel(18);
  approx(g.maxHp, 690 + 98 * 17, 1e-6, '18 级生命');
  approx(g.hp, g.maxHp, 1e-6, '升级时当前生命同步增加');
  approx(g.stats.armor, 38 + 4.2 * 17, 1e-6, '18 级护甲');
  approx(g.stats.mr, 32 + 1.55 * 17, 1e-6, '18 级魔抗');
  approx(g.stats.ad, 69 + 4.5 * 17, 1e-6, '18 级攻击力');
  approx(g.stats.bonusAS, 0.0365 * 17, 1e-9, '18 级额外攻速');
  approx(g.stats.attackSpeed, 0.625 + 0.625 * 0.0365 * 17, 1e-9, '18 级攻速');
  g.bonusStats.attackSpeed = 5;
  g.recalcStats();
  approx(g.stats.attackSpeed, 2.5, 1e-9, '攻速上限 2.5');
});
test('移速软上限与减速', () => {
  approx(softCapMoveSpeed(540), 500, 1e-9, '>490');
  approx(softCapMoveSpeed(450), 443, 1e-9, '>415');
  approx(softCapMoveSpeed(400), 400, 1e-9, '区间内');
  approx(softCapMoveSpeed(200), 210, 1e-9, '<220');
  const game = makeGame({ blue: ['garen'], waves: false, open: true });
  const g = game.champions[0];
  g.bonusStats.moveSpeed = 200;
  g.recalcStats();
  approx(g.stats.moveSpeed, 540 * 0.5 + 230, 1e-9, '装备移速后软上限');
});
test('韧性乘法叠加', () => {
  const { garen } = garenSetup();
  garen.bonusStats.tenacity = 0.3;
  garen.addBuff({ id: 't', duration: 5, stats: { tenacity: 0.6 } });
  garen.recalcStats();
  approx(garen.stats.tenacity, 1 - 0.7 * 0.4, 1e-9, '1-(1-0.3)(1-0.6)');
});

// —— 伤害公式 ——
test('护甲/魔抗/穿透公式', () => {
  approx(resistMultiplier(100), 0.5, 1e-12, '100 护甲');
  approx(resistMultiplier(0), 1, 1e-12, '0 护甲');
  approx(resistMultiplier(-50), 2 - 100 / 150, 1e-12, '负护甲');
  approx(mitigate({ stats: { armorPenPct: 0.3, lethality: 10 } }, { stats: { armor: 100 } }, 100, 'physical'), 100 * 100 / 160, 1e-9, '百分比+固定穿甲');
  approx(mitigate({ stats: { magicPenPct: 0.4, magicPen: 15 } }, { stats: { mr: 50 } }, 100, 'magic'), 100 * 100 / 115, 1e-9, '法术穿透');
  approx(mitigate({ stats: { lethality: 30 } }, { stats: { armor: 10 } }, 100, 'physical'), 100, 1e-9, '穿透不低于 0');
  approx(mitigate({ stats: { lethality: 10 } }, { stats: { armor: -20 } }, 100, 'physical'), 100 * (2 - 100 / 120), 1e-9, '负护甲时穿透不生效');
  approx(mitigate(null, { stats: { armor: 300 } }, 100, 'true'), 100, 1e-12, '真实伤害');
  const { game, garen, dummy } = garenSetup({ dummyArmor: 100 });
  const dealt = game.dealDamage(garen, dummy, 200, 'physical');
  approx(dealt, 100, 1e-9, 'dealDamage 应用护甲');
  approx(dummy.hp, 2900, 1e-9, '扣血');
});
test('伤害统计与助攻记录、击杀事件', () => {
  const { game, garen, dummy } = garenSetup({ dummyHp: 500 });
  const dmgEvents = collect(game, 'damage');
  game.dealDamage(garen, dummy, 100, 'true', { isAbility: true, spell: 'x' });
  assert(dmgEvents.length === 1 && dmgEvents[0].isAbility && dmgEvents[0].spell === 'x', 'damage 事件');
  assert(garen.damageToChampions === 100, '对英雄伤害统计');
  assert(dummy.damageLog.get('garen') === game.time, '助攻记录');
  game.dealDamage(garen, dummy, 1000, 'true');
  assert(!dummy.alive && dmgEvents[1].killed, '击杀');
});

// —— 护盾 ——
test('护盾吸收：先类型专属再通用、到期移除', () => {
  const { game, dummy } = garenSetup({ dummyHp: 1000 });
  const evs = collect(game, 'damage');
  dummy.addShield(100, 5, { id: 'a' });
  approx(dummy.totalShield, 100, 1e-9, '护盾值');
  game.dealDamage(null, dummy, 150, 'true');
  approx(dummy.hp, 950, 1e-9, '护盾吸收 100');
  approx(evs[0].amount, 150, 1e-9, 'amount 含吸收');
  approx(evs[0].absorbed, 100, 1e-9, 'absorbed');
  assert(dummy.shields.length === 0, '护盾破碎移除');
  dummy.addShield(50, 5, { type: 'magic' });
  dummy.addShield(100, 5, { type: 'all' });
  game.dealDamage(null, dummy, 120, 'magic');
  approx(dummy.hp, 950, 1e-9, '魔法伤害全被吸收');
  approx(dummy.totalShield, 30, 1e-9, '先消耗魔法护盾');
  game.dealDamage(null, dummy, 40, 'physical');
  approx(dummy.hp, 940, 1e-9, '物理伤害只被通用护盾吸收');
  dummy.addShield(100, 1, { id: 'b' });
  run(game, 1.1);
  approx(dummy.totalShield, 0, 1e-9, '护盾到期');
});
test('治疗：治疗强度、重伤、上限', () => {
  const { game, garen, dummy } = garenSetup();
  garen.hp = 100;
  garen.bonusStats.healShieldPower = 0.5;
  garen.recalcStats();
  const h = game.heal(garen, garen, 100);
  approx(h, 150, 1e-9, '治疗强度');
  garen.addBuff({ id: 'gw', duration: 3, stats: { grievous: 0.4 } });
  garen.recalcStats();
  approx(game.heal(dummy, garen, 100), 60, 1e-9, '重伤 40%（非英雄来源不享受治疗强度）');
  garen.hp = garen.maxHp - 10;
  approx(game.heal(garen, garen, 1000), 10, 1e-9, '不超过上限');
});

// —— Buff ——
test('Buff：属性、到期、刷新、叠层、none/replace、周期触发', () => {
  const { game, dummy } = garenSetup();
  let expired = 0, removed = 0;
  dummy.addBuff({ id: 'a', duration: 2, stats: { armor: 10 }, onExpire: () => expired++, onRemove: () => removed++ });
  dummy.recalcStats();
  approx(dummy.stats.armor, 10, 1e-9, 'Buff 属性生效');
  run(game, 1);
  dummy.addBuff({ id: 'a', duration: 2, stats: { armor: 10 } });
  run(game, 1.5);
  assert(dummy.hasBuff('a'), '刷新持续时间');
  run(game, 0.6);
  assert(!dummy.hasBuff('a') && expired === 1 && removed === 1, '到期回调');
  dummy.recalcStats();
  approx(dummy.stats.armor, 0, 1e-9, '属性移除');
  for (let i = 0; i < 4; i++) dummy.addBuff({ id: 's', refresh: 'stack', maxStacks: 3, duration: 5, stats: { armor: 5 }, statsPerStack: true });
  dummy.recalcStats();
  assert(dummy.getBuff('s').stacks === 3, '叠层上限');
  approx(dummy.stats.armor, 15, 1e-9, '按层数计算属性');
  const b1 = dummy.addBuff({ id: 'n', refresh: 'none', duration: 5, data: { v: 1 } });
  const b2 = dummy.addBuff({ id: 'n', refresh: 'none', duration: 5, data: { v: 2 } });
  assert(b1 === b2 && b1.data.v === 1, "'none' 不替换");
  let rem = 0;
  dummy.addBuff({ id: 'r', refresh: 'replace', duration: 5, onRemove: () => rem++ });
  const r2 = dummy.addBuff({ id: 'r', refresh: 'replace', duration: 5 });
  assert(rem === 1 && dummy.getBuff('r') === r2, "'replace' 触发旧 Buff onRemove");
  let ticks = 0;
  dummy.addBuff({ id: 'tick', duration: 2, tickInterval: 0.5, onInterval: () => ticks++ });
  run(game, 2.1);
  assert(ticks === 4, `周期触发 4 次，实际 ${ticks}`);
});

// —— 控制 ——
test('控制：韧性、击飞无视韧性、不可阻挡、行动限制', () => {
  const { game, garen, dummy } = garenSetup();
  const ccEvents = collect(game, 'cc');
  garen.bonusStats.tenacity = 0.5;
  garen.recalcStats();
  assert(garen.applyCC('stun', 2, { source: dummy }), '眩晕成功');
  approx(garen.ccRemaining('stun'), 1, 1e-9, '韧性减半');
  assert(!garen.canMove() && !garen.canAttack() && !garen.canCast() && !garen.canUseSummoner(), '眩晕禁止一切行动');
  assert(ccEvents.length === 1 && ccEvents[0].duration === 1, 'cc 事件');
  assert(garen.damageLog.get(dummy.championId) === game.time, '敌方控制计入助攻记录');
  run(game, 1.05);
  assert(garen.canMove() && garen.canCast(), '眩晕结束');
  garen.knockup(1, dummy);
  approx(garen.ccRemaining('airborne'), 1, 1e-9, '击飞不受韧性影响');
  run(game, 1.05);
  garen.unstoppable = true;
  assert(!garen.applyCC('stun', 1) && !garen.knockback({ fromX: X - 100, fromY: Y, distance: 300 }), '不可阻挡免疫');
  garen.unstoppable = false;
  garen.bonusStats.tenacity = 0;
  garen.recalcStats();
  garen.applyCC('silence', 1);
  assert(!garen.canCast() && garen.canUseSummoner() && garen.canMove() && garen.canAttack(), '沉默只禁技能');
  run(game, 1.05);
  garen.applyCC('root', 1);
  assert(!garen.canMove() && garen.canAttack() && garen.canCast() && !garen.dash({ x: X + 300, y: Y }), '禁锢：不能移动/位移');
  run(game, 1.05);
  garen.applyCC('disarm', 1);
  assert(!garen.canAttack() && garen.canMove(), '缴械');
  garen.applyCC('stun', 3);
  garen.knockup(0.5);
  garen.cleanse();
  assert(!garen.hasCC('stun') && garen.hasCC('airborne'), '净化不移除击飞');
  // 敌方控制计入助攻
  dummy.applyCC('stun', 1, { source: garen });
  assert(dummy.damageLog.get('garen') === game.time, '控制计入助攻记录');
});
test('减速取最强、移速计算', () => {
  const { game, garen, dummy } = garenSetup();
  garen.slow(0.3, 2, dummy);
  garen.slow(0.5, 1, null);
  garen.recalcStats();
  approx(garen.stats.moveSpeed, softCapMoveSpeed(340 * 0.5), 1e-9, '取最强减速 50%');
  run(game, 1.05);
  approx(garen.stats.moveSpeed, 340 * 0.7, 1e-9, '剩余 30% 减速');
});
test('眩晕打断回城，沉默不打断回城', () => {
  const { game, garen } = garenSetup();
  const cancels = collect(game, 'recallCancel');
  assert(garen.startRecall() && garen.isRecalling, '开始回城');
  garen.applyCC('silence', 0.5);
  assert(garen.isRecalling, '沉默不打断回城');
  garen.applyCC('stun', 0.5);
  assert(!garen.isRecalling && cancels.length === 1, '眩晕打断回城');
});

test('魅惑/恐惧/嘲讽的强制行为', () => {
  const { game, garen, dummy } = garenSetup({ dist: 600 });
  dummy.baseStats.ms = 330;
  garen.applyCC('charm', 1, { source: dummy });
  const d0 = garen.distTo(dummy);
  run(game, 0.5);
  assert(garen.distTo(dummy) < d0 - 50 && !garen.canCast(), '魅惑：走向来源');
  run(game, 0.6);
  garen.setPosition(X, Y);
  garen.applyCC('fear', 1, { source: dummy });
  run(game, 0.5);
  assert(garen.x < X - 50, '恐惧：远离来源');
  run(game, 0.6);
  garen.setPosition(X, Y);
  garen.applyCC('fear', 1, { source: dummy });
  garen.applyCC('stun', 1);
  run(game, 0.5);
  approx(garen.x, X, 1e-6, '同时眩晕时不移动');
  run(game, 0.6);
  garen.setPosition(X, Y);
  dummy.setPosition(X + 150, Y);
  garen.applyCC('taunt', 1.5, { source: dummy });
  run(game, 1.4);
  assert(dummy.hp < 3000, '嘲讽：强制攻击来源');
});

// —— 位移 ——
test('位移：冲刺撞墙、穿墙冲刺吸附、击退撞墙、闪现穿墙', () => {
  const wall = { x0: 8000, y0: 0, x1: 8200, y1: 15000 };
  const game = makeGame({ blue: ['garen'], waves: false, open: { walls: [wall] } });
  const g = game.champions[0];
  g.setPosition(7500, 7400);
  let ended = null;
  assert(g.dash({ x: 8700, y: 7400, speed: 1500, onEnd: (i) => { ended = i; } }), '开始冲刺');
  run(game, 1.2);
  assert(!g.dashState && ended === false, '冲刺结束');
  assert(g.x < 8000 && g.x > 7950, `撞墙停止，x=${g.x}`);
  g.setPosition(7500, 7400);
  g.dash({ x: 8100, y: 7400, speed: 2000, ignoreWalls: true });
  run(game, 0.6);
  assert(game.nav.isWalkable(g.x, g.y) && !g.dashState, '穿墙冲刺终点吸附到可走点');
  g.setPosition(7500, 7400);
  g.dash({ x: 8700, y: 7400, speed: 2000, ignoreWalls: true });
  run(game, 0.8);
  approx(g.x, 8700, 1, '穿墙冲刺越过墙体');
  g.setPosition(7700, 7400);
  assert(g.knockback({ fromX: 7500, fromY: 7400, distance: 800, duration: 0.4 }), '击退');
  assert(g.hasCC('airborne'), '击退期间处于击飞');
  run(game, 0.5);
  assert(g.x < 8000 && g.x > 7900, `击退撞墙，x=${g.x}`);
  g.setPosition(7900, 7400);
  g.blink(8100, 7400);
  assert(g.x <= 8000 && game.nav.isWalkable(g.x, g.y), '闪现进墙：沿反方向找可走点');
  g.setPosition(7900, 7400);
  g.blink(8300, 7400);
  approx(g.x, 8300, 1e-9, '闪现穿墙');
  g.setPosition(7000, 7400);
  g.pullTo({ x: 7600, y: 7400, speed: 1500, stopDistance: 100 });
  run(game, 0.6);
  approx(g.x, 7500, 2, '拉拽到目标前 stopDistance');
});
test('位移路径碰撞：每个敌人只触发一次；眩晕打断冲刺', () => {
  const { game, garen, dummy } = garenSetup({ dist: 300 });
  const hits = [];
  garen.dash({ x: X + 600, y: Y, speed: 1200, hitRadius: 60, onHitUnit: (u) => hits.push(u) });
  run(game, 0.7);
  assert(hits.length === 1 && hits[0] === dummy, '路径命中一次');
  let interrupted = null;
  garen.dash({ x: X, y: Y, speed: 300, onEnd: (i) => { interrupted = i; } });
  run(game, 0.2);
  garen.applyCC('stun', 0.5);
  assert(interrupted === true && !garen.dashState, '眩晕打断位移');
});

// —— 普攻 ——
test('普攻：前摇、取消不进冷却、走砍、动画状态', () => {
  const { game, garen, dummy } = garenSetup({ dist: 200 });
  const launches = collect(game, 'basicAttack');
  garen.attackUnit(dummy);
  game.step(TICK);
  assert(garen.attackState && garen.anim.state === 'attack' && garen.anim.attackIndex === 1, '进入前摇');
  approx(garen.anim.windup, (1 / 0.625) * 0.3, 1e-9, '前摇时长');
  garen.moveTo(X - 300, Y);
  assert(!garen.attackState, '移动取消前摇');
  run(game, 0.2);
  assert(dummy.hp === 3000 && launches.length === 0 && garen.attackCooldown <= 0, '取消不造成伤害、不进冷却');
  garen.setPosition(X, Y);
  garen.attackUnit(dummy);
  run(game, 0.55);
  approx(dummy.hp, 3000 - 69, 1e-9, '近战命中');
  approx(garen.attackCooldown, 1.6 - 0.48 - (0.55 - 0.48), 0.05, '攻击间隔从前摇开始计算');
  garen.moveTo(X - 400, Y);
  const x0 = garen.x;
  run(game, 0.2);
  assert(garen.x < x0 - 30 && garen.anim.state === 'run', '走砍：出手后可立即移动');
  garen.stop();
  run(game, 0.1);
  assert(garen.anim.state === 'idle', '空闲');
});
test('暴击、生命偷取、致盲', () => {
  const { game, garen, dummy } = garenSetup({ dist: 200 });
  garen.bonusStats.crit = 1;
  garen.bonusStats.lifeSteal = 0.5;
  garen.recalcStats();
  garen.hp = 500;
  garen.attackUnit(dummy);
  run(game, 0.55);
  approx(dummy.hp, 3000 - 69 * 1.75, 1e-6, '暴击 175%');
  approx(garen.hp, 500 + 69 * 1.75 * 0.5 + 0.55 * (1.6 + (0.015 * 690) / 5), 0.2, '生命偷取（含基础回复与被动回复）');
  garen.stop();
  garen.resetAttack();
  garen.applyCC('blind', 2);
  const hp0 = dummy.hp;
  garen.attackUnit(dummy);
  run(game, 0.6);
  assert(dummy.hp === hp0, '致盲普攻落空');
});
test('远程普攻：追踪投射物命中', () => {
  const game = makeGame({ blue: ['ahri'], waves: false, open: true });
  const ahri = game.champions[0];
  ahri.setPosition(X, Y);
  const dummy = spawnDummy(game, { team: 1, x: X + 500, y: Y, hp: 1000 });
  ahri.attackUnit(dummy);
  const windup = (1 / ahri.stats.attackSpeed) * ahri.baseStats.windup;
  run(game, windup + TICK);
  assert(game.projectiles.length === 1 && game.projectiles[0].isBasicAttack, '发射普攻投射物');
  assert(dummy.hp === 1000, '飞行中未命中');
  run(game, 0.4);
  approx(dummy.hp, 1000 - ahri.stats.ad, 1e-6, '命中造成伤害');
});
test('攻击移动：自动攻击最近敌人', () => {
  const { game, garen, dummy } = garenSetup({ dist: 350 });
  garen.attackMove(X + 1000, Y);
  run(game, 1.5);
  assert(dummy.hp < 3000, '攻击移动命中路过的敌人');
});

// —— 投射物 ——
test('直线投射物扫掠：高速不穿透、first/pierce/回旋', () => {
  const { game, garen, dummy } = garenSetup({ dist: 600 });
  dummy.radius = 30;
  const hits = [];
  game.spawnProjectile({ owner: garen, dirX: 1, dirY: 0, range: 2000, speed: 30000, width: 10, onHit: (u) => hits.push(u) });
  run(game, 0.2);
  assert(hits.length === 1, '每帧 1000 码也能命中');
  const d2 = spawnDummy(game, { team: 1, x: X + 900, y: Y, hp: 1000 });
  const order = [];
  game.spawnProjectile({ owner: garen, dirX: 1, dirY: 0, range: 1500, speed: 2000, width: 40, hits: 'pierce', onHit: (u) => order.push(u) });
  run(game, 1);
  assert(order.length === 2 && order[0] === dummy && order[1] === d2, '穿透按先后顺序命中');
  const first = [];
  game.spawnProjectile({ owner: garen, dirX: 1, dirY: 0, range: 1500, speed: 2000, width: 40, onHit: (u) => first.push(u) });
  run(game, 1);
  assert(first.length === 1 && first[0] === dummy, 'first 模式只命中第一个');
  const back = [];
  game.spawnProjectile({ owner: garen, dirX: 1, dirY: 0, range: 700, speed: 2000, width: 40, hits: 'pierce', returnToOwner: true, onHit: (u) => back.push(u) });
  run(game, 1.5);
  assert(back.length === 2 && back[0] === dummy && back[1] === dummy, '回旋：去程与回程各命中一次');
  assert(game.projectiles.length === 0, '投射物清理');
});
test('追踪投射物：目标阵亡则消失', () => {
  const { game, garen, dummy } = garenSetup({ dist: 1000 });
  let hit = 0;
  game.spawnProjectile({ owner: garen, target: dummy, speed: 1000, onHit: () => hit++ });
  run(game, 0.3);
  game.dealDamage(null, dummy, 99999, 'true');
  run(game, 1);
  assert(hit === 0 && game.projectiles.length === 0, '目标死亡后投射物消失');
});
test('投射物撞墙', () => {
  const game = makeGame({ blue: ['garen'], waves: false, open: { walls: [{ x0: 8000, y0: 0, x1: 8200, y1: 15000 }] } });
  const g = game.champions[0];
  g.setPosition(7500, 7400);
  const d = spawnDummy(game, { team: 1, x: 8500, y: 7400 });
  let hit = 0, endX = 0;
  game.spawnProjectile({ owner: g, dirX: 1, dirY: 0, range: 1500, speed: 2000, collideWalls: true, onHit: () => hit++, onEnd: (p) => { endX = p.x; } });
  run(game, 1);
  assert(hit === 0 && endX < 8000 && d.hp === 2000, '撞墙停止');
});

// —— 区域 ——
test('区域：延迟生效、周期结算、进出回调、到期', () => {
  const { game, garen, dummy } = garenSetup({ dist: 100 });
  const log = { start: 0, ticks: 0, enter: 0, exit: 0, end: 0, units: 0 };
  const z = game.spawnZone({
    owner: garen, x: dummy.x, y: dummy.y, radius: 200, delay: 0.5, duration: 1, tickInterval: 0.25,
    onStart: () => log.start++, onTick: (zz, us) => { log.ticks++; log.units = Math.max(log.units, us.length); },
    onEnter: () => log.enter++, onExit: () => log.exit++, onEnd: () => log.end++,
  });
  run(game, 0.4);
  assert(log.start === 0 && log.ticks === 0, '延迟期不生效');
  run(game, 1.3);
  assert(log.start === 1 && log.end === 1 && z.dead, '开始/结束各一次');
  assert(log.ticks >= 4 && log.ticks <= 5, `周期结算 4~5 次，实际 ${log.ticks}`);
  assert(log.enter === 1 && log.units === 1, '只包含敌人（不含施法者）');
  assert(!game.zones.includes(z), '区域清理');
  const ally = [];
  game.spawnZone({ owner: garen, x: garen.x, y: garen.y, radius: 300, duration: 0, filter: 'ally', onTick: (zz, us) => ally.push(...us) });
  run(game, 0.1);
  assert(ally.length === 1 && ally[0] === garen, "filter 'ally'");
  const fz = game.spawnZone({ owner: garen, radius: 100, duration: 5, follow: garen });
  garen.setPosition(X + 1000, Y);
  run(game, 0.1);
  approx(fz.x, garen.x, 1e-9, '跟随单位');
});

// —— 盖伦 ——
test('盖伦 Q：解除减速、加速、强化普攻伤害与沉默、普攻重置', () => {
  const { game, garen, dummy } = garenSetup({ dist: 200 });
  assert(garen.levelUpAbility('Q'), '学习 Q');
  garen.slow(0.5, 3, dummy);
  garen.attackCooldown = 1;
  const r = garen.castAbility('Q');
  assert(r.ok, `施放 Q：${r.reason}`);
  assert(!garen.hasCC('slow') && garen.attackCooldown === 0, '解除减速 + 普攻重置');
  assert(garen.modelState.swordGlow === true, '剑发光');
  game.step(TICK);
  approx(garen.stats.moveSpeed, softCapMoveSpeed(340 * 1.35), 1e-9, '+35% 移速');
  approx(garen.abilities.Q.cdRemaining, 8 - TICK, 1e-6, '冷却 8 秒');
  garen.attackUnit(dummy);
  run(game, 0.55);
  approx(dummy.hp, 3000 - (69 + 30 + 0.5 * 69), 1e-6, '强化普攻伤害');
  assert(dummy.hasCC('silence') && Math.abs(dummy.ccRemaining('silence') - 1.5) < 0.1, '沉默 1.5 秒');
  assert(!garen.hasBuff('garen_q_empower') && garen.modelState.swordGlow === false, '强化消耗');
  run(game, 1.2);
  assert(!garen.hasBuff('garen_q_haste'), '1 级加速 1 秒后结束');
  // 4.5 秒内未普攻则强化消失
  garen.abilities.Q.resetCooldown();
  garen.stop();
  garen.castAbility('Q');
  run(game, 4.6);
  assert(!garen.hasBuff('garen_q_empower'), '强化 4.5 秒后消失');
});
test('盖伦 W：护盾、韧性、伤害减免；被动击杀叠护甲魔抗', () => {
  const { game, garen, dummy } = garenSetup({ level: 3 });
  garen.levelUpAbility('W');
  const kill = spawnDummy(game, { team: 1, type: 'minion', x: X + 100, y: Y, hp: 10 });
  game.dealDamage(garen, kill, 50, 'true');
  garen.recalcStats();
  approx(garen.stats.armor, 38 + 4.2 * growthFactor3() + 0.25, 1e-6, '击杀 +0.25 护甲');
  assert(garen.getBuff('garen_w_courage').stacks === 1, '勇气层数');
  const r = garen.castAbility('W');
  assert(r.ok, 'W 施放');
  garen.recalcStats();
  approx(garen.totalShield, 65, 1e-9, '护盾 65（无额外生命）');
  approx(garen.stats.tenacity, 0.6, 1e-9, '60% 韧性');
  approx(garen.stats.damageReduction, 0.3, 1e-9, '30% 伤害减免');
  const hp0 = garen.hp;
  game.dealDamage(dummy, garen, 100, 'true');
  approx(hp0 - garen.hp, 70 - 65, 1e-6, '减免后被护盾吸收');
  run(game, 0.8);
  garen.recalcStats();
  approx(garen.stats.tenacity, 0, 1e-9, '韧性 0.75 秒后结束');
  run(game, 1.3);
  garen.recalcStats();
  approx(garen.stats.damageReduction, 0, 1e-9, '1 级减伤持续 2 秒');
  // 击杀上限 30
  garen.getBuff('garen_w_courage').stacks = 119;
  const k2 = spawnDummy(game, { team: 1, type: 'minion', x: X + 100, y: Y, hp: 1 });
  const k3 = spawnDummy(game, { team: 1, type: 'minion', x: X + 100, y: Y, hp: 1 });
  game.dealDamage(garen, k2, 5, 'true');
  game.dealDamage(garen, k3, 5, 'true');
  assert(garen.getBuff('garen_w_courage').stacks === 120, '上限 120 层 = 30 点');
});
function growthFactor3() { return 2 * (0.7025 + 0.0175 * 2); }
test('盖伦 E：7 次旋转伤害、最近目标加成、6 次破甲、不能普攻、冷却在结束后开始', () => {
  const { game, garen, dummy } = garenSetup({ dist: 150, dummyArmor: 40 });
  garen.levelUpAbility('E');
  const r = garen.castAbility('E');
  assert(r.ok, 'E 施放');
  assert(garen.modelState.spinning && !garen.canAttack(), '旋转中不能普攻');
  assert(garen.abilities.E.cdRemaining === 0 && garen.abilities.E.isRecastActive, '旋转期间未进冷却，处于再次施放窗口');
  run(game, 3.1);
  const per = (4 + 0 + 0.32 * 69) * 1.25;
  const expectedArmor = 40; // 前 6 次伤害使用 40 护甲；第 7 次护甲已降低
  const dmg6 = 6 * per * (100 / (100 + expectedArmor));
  const dmg7 = per * (100 / (100 + 30));
  approx(3000 - dummy.hp, dmg6 + dmg7, 0.01, '7 次旋转总伤害（第 6 次后护甲 -25%）');
  assert(dummy.hasBuff('garen_e_shred'), '破甲');
  assert(!garen.modelState.spinning && garen.canAttack(), '旋转结束');
  assert(Math.abs(garen.abilities.E.cdRemaining - 9) < 0.2, `结束后开始 9 秒冷却，实际 ${garen.abilities.E.cdRemaining}`);
});
test('盖伦 E：额外攻速增加旋转次数；再次施放提前结束（至少 0.5 秒）', () => {
  const { game, garen, dummy } = garenSetup({ dist: 150 });
  garen.levelUpAbility('E');
  garen.bonusStats.attackSpeed = 0.5;
  garen.recalcStats();
  garen.castAbility('E');
  assert(garen.getBuff('garen_e_spin').data.ticks === 9, '+50% 额外攻速 = 9 次');
  run(game, 0.2);
  assert(!garen.castAbility('E').ok, '0.5 秒内不能提前结束');
  run(game, 0.5);
  const hp0 = dummy.hp;
  assert(garen.castAbility('E').ok, '再次施放提前结束');
  assert(!garen.hasBuff('garen_e_spin') && !garen.modelState.spinning, '旋转结束');
  assert(Math.abs(garen.abilities.E.cdRemaining - 9) < 0.05, '提前结束后开始冷却');
  run(game, 1);
  assert(dummy.hp === hp0, '结束后不再造成伤害');
});
test('盖伦 R：前摇 0.435 秒后造成已损失生命真实伤害；超出射程走近施放', () => {
  const { game, garen, dummy } = garenSetup({ dist: 300, level: 6 });
  garen.levelUpAbility('R');
  dummy.hp = 1000;
  approx(garenRDamage(garen, dummy, 1), 150 + 0.25 * 2000, 1e-9, 'R 伤害公式');
  const r = garen.castAbility('R', { target: dummy });
  assert(r.ok && !r.reason, 'R 施放');
  run(game, 0.3);
  assert(dummy.hp === 1000 && garen.castLock > 0, '前摇中未造成伤害');
  run(game, 0.2);
  approx(dummy.hp, 1000 - 650, 1e-6, '真实伤害');
  assert(Math.abs(garen.abilities.R.cdRemaining - (120 - 0.065)) < 0.1, 'R 冷却 120');
  garen.abilities.R.resetCooldown();
  dummy.setPosition(X + 1200, Y);
  const q = garen.castAbility('R', { target: dummy });
  assert(q.ok && q.reason === 'queued' && garen.command.type === 'castMove', '超出射程：走近施法');
  run(game, 3);
  assert(dummy.hp < 350, '走近后施放');
  const other = spawnDummy(game, { team: 1, type: 'minion', x: X + 100, y: Y });
  garen.abilities.R.resetCooldown();
  assert(garen.castAbility('R', { target: other }).reason === 'target', 'R 只能指向敌方英雄');
});
test('盖伦被动：8 秒内未受英雄伤害才回复', () => {
  const { game, garen, dummy } = garenSetup();
  garen.hp = 300;
  game.dealDamage(dummy, garen, 1, 'true');
  const h0 = garen.hp;
  run(game, 5);
  const regenBase = (8 / 5) * 5;
  approx(garen.hp - h0, regenBase, 0.2, '前 5 秒只有基础回复');
  run(game, 4);
  const h1 = garen.hp;
  run(game, 5);
  approx(garen.hp - h1, regenBase + ((0.015 * 690) / 5) * 5, 0.2, '被动激活后额外回复 1.5%/5 秒');
});

// —— 加点 / 冷却 ——
test('技能加点规则：R 需 6/11/16 级，普通技能 ≤ ceil(等级/2)', () => {
  const game = makeGame({ blue: ['garen'], waves: false, open: true });
  const g = game.champions[0];
  assert(!g.canLevelAbility('R') && g.canLevelAbility('Q'), '1 级不能点 R');
  assert(g.levelUpAbility('Q') && g.skillPoints === 0 && !g.canLevelAbility('W'), '没有技能点');
  g.setLevel(2);
  assert(!g.canLevelAbility('Q') && g.canLevelAbility('W'), '2 级 Q 不能升到 2');
  g.setLevel(3);
  assert(g.canLevelAbility('Q'), '3 级 Q 可升 2');
  g.levelUpAbility('Q'); g.levelUpAbility('W');
  g.setLevel(5);
  assert(!g.canLevelAbility('R'), '5 级不能点 R');
  g.setLevel(6);
  assert(g.levelUpAbility('R') && !g.canLevelAbility('R'), '6 级 R1，R2 需要 11 级');
  g.setLevel(11);
  assert(g.canLevelAbility('R'), '11 级 R2');
  g.levelUpAbility('R');
  g.setLevel(15);
  assert(!g.canLevelAbility('R'), '15 级不能 R3');
  g.setLevel(16);
  assert(g.levelUpAbility('R') && g.abilities.R.rank === 3 && !g.canLevelAbility('R'), 'R 最高 3 级');
  while (g.abilities.Q.rank < 5 && g.levelUpAbility('Q'));
  assert(g.abilities.Q.rank === 5 && !g.canLevelAbility('Q'), 'Q 最高 5 级');
});
test('冷却与技能急速、施法失败原因', () => {
  const { game, garen, dummy } = garenSetup({ level: 3 });
  assert(garen.castAbility('Q').reason === 'rank', '未学习');
  garen.levelUpAbility('Q');
  garen.castAbility('Q');
  approx(garen.abilities.Q.cdRemaining, 8, 1e-9, '8 秒冷却');
  assert(garen.castAbility('Q').reason === 'cooldown', '冷却中');
  garen.bonusStats.abilityHaste = 100;
  garen.recalcStats();
  garen.abilities.Q.resetCooldown();
  garen.castAbility('Q');
  approx(garen.abilities.Q.cdRemaining, 4, 1e-9, '100 急速 → 冷却减半');
  garen.levelUpAbility('W');
  approx(garen.abilities.W.cooldownFor(2) * 2, 21, 1e-9, 'W 2 级冷却 21');
  garen.abilities.Q.resetCooldown();
  garen.applyCC('silence', 1);
  assert(garen.castAbility('Q').reason === 'cc', '沉默');
  game.dealDamage(dummy, garen, 99999, 'true');
  assert(garen.castAbility('Q').reason === 'dead', '阵亡');
  // 法力消耗
  const g2 = makeGame({ blue: ['ahri'], waves: false, open: true });
  const ahri = g2.champions[0];
  ahri.levelUpAbility('Q');
  ahri.mana = 10;
  assert(ahri.castAbility('Q', { x: ahri.x + 500, y: ahri.y }).reason === 'cost', '法力不足');
  ahri.mana = ahri.maxMana;
  const m0 = ahri.mana;
  assert(ahri.castAbility('Q', { x: ahri.x + 500, y: ahri.y }).ok, '施放');
  assert(ahri.mana < m0 && ahri.castLock > 0, '支付消耗并进入前摇');
});

// —— 回城 / 复活 ——
test('回城：8 秒引导，受伤打断，完成后回到泉水', () => {
  const { game, garen, dummy } = garenSetup();
  const ev = { start: collect(game, 'recallStart'), cancel: collect(game, 'recallCancel'), end: collect(game, 'recallEnd') };
  garen.startRecall();
  assert(garen.anim.state !== 'recall' || true, '');
  run(game, 4);
  assert(garen.isRecalling && garen.anim.state === 'recall', '回城动画');
  game.dealDamage(dummy, garen, 10, 'magic');
  assert(!garen.isRecalling && ev.cancel.length === 1, '受到伤害打断');
  garen.startRecall();
  garen.moveTo(X + 100, Y);
  assert(!garen.isRecalling && ev.cancel.length === 2, '移动打断');
  garen.startRecall();
  run(game, 8.1);
  assert(ev.end.length === 1 && garen.inFountain && garen.canShop, '回到泉水');
});
test('复活计时与复活', () => {
  approx(respawnTime(1, 0), 10, 1e-9, '1 级 10 秒');
  approx(respawnTime(6, 300), 16, 1e-9, '6 级 16 秒');
  approx(respawnTime(18, 20 * 60), 52.5 * 1.1, 1e-9, '20 分钟 +10%');
  approx(respawnTime(18, 60 * 60), 52.5 * 1.5, 1e-9, '上限 +50%');
  const { game, garen, dummy } = garenSetup();
  const resp = collect(game, 'respawn');
  game.dealDamage(dummy, garen, 99999, 'true');
  assert(!garen.alive && garen.anim.state === 'death', '阵亡');
  approx(garen.respawnAt - game.time, 10, 1e-9, '复活时间');
  assert(garen.canShop, '阵亡时可购物');
  run(game, 9.9);
  assert(!garen.alive, '未到时间');
  run(game, 0.2);
  assert(garen.alive && garen.hp === garen.maxHp && garen.inFountain && resp.length === 1, '在泉水满血复活');
});
test('泉水回复', () => {
  const { game, garen } = garenSetup();
  const f = game.fountainOf(0);
  garen.setPosition(f.x + 200, f.y + 200);
  garen.hp = 100;
  run(game, 1);
  assert(garen.hp > 100 + 0.08 * garen.maxHp, '泉水每秒回复约 8.4% 最大生命');
});

// —— 奖励 ——
test('击杀奖励：首杀、助攻、经验平分、赏金变化、终结、处决、多杀、团灭', () => {
  const game = makeGame({ blue: ['garen', 'ahri'], red: ['darius', 'lux'], waves: false, open: true });
  const [garen, ahri, darius, lux] = game.champions;
  for (const c of game.champions) { c.setPosition(X, Y); c.gold = 0; }
  const kills = collect(game, 'championKill');
  const ann = collect(game, 'announce');
  game.dealDamage(ahri, darius, 100, 'magic');
  game.dealDamage(garen, darius, 99999, 'true');
  const k = kills[0];
  assert(k.firstBlood && k.killerChampion === garen && k.assists.length === 1 && k.assists[0] === ahri, '首杀与助攻');
  approx(garen.gold, 400, 1e-9, '击杀 300 + 首杀 100');
  approx(ahri.gold, 150, 1e-9, '助攻 50% 平分');
  approx(garen.xp, 75, 1e-9, '经验平分');
  approx(ahri.xp, 75, 1e-9, '助攻者经验');
  assert(garen.kills === 1 && ahri.assists === 1 && darius.deaths === 1, 'KDA');
  assert(ann.some((a) => a.key === 'firstBlood' && a.text === '第一滴血！' && a.team === 0), '首杀播报');
  // 连死赏金下降
  assert(killBounty({ killStreak: 0, deathStreak: 1 }) === 255, '连死 -15%');
  assert(killBounty({ killStreak: 0, deathStreak: 10 }) === 100, '下限 100');
  assert(killBounty({ killStreak: 5, deathStreak: 0 }) === 600, '连杀赏金');
  assert(killBounty({ killStreak: 20, deathStreak: 0 }) === 1000, '上限 1000');
  // 终结（德莱厄斯已复活，不构成团灭）
  run(game, 11);
  assert(darius.alive, '德莱厄斯已复活');
  lux.killStreak = 4;
  garen.gold = 0;
  game.dealDamage(garen, lux, 99999, 'true');
  approx(garen.gold, 500, 1e-9, '终结赏金 500');
  assert(kills[1].shutdown && !kills[1].ace && ann.some((a) => a.key === 'shutdown' && a.text === '终结！'), '终结播报');
  game.dealDamage(garen, darius, 99999, 'true');
  assert(kills[2].ace && ann.some((a) => a.key === 'ace' && a.text === '团灭！' && a.team === 0), '团灭');
  assert(kills[2].multiKill === 2 && ann.some((a) => a.key === 'doubleKill'), '双杀');
  approx(kills[2].bounty, 255, 1e-9, '连死赏金');
});
test('多杀与处决', () => {
  const game = makeGame({ blue: ['garen'], red: ['darius', 'lux', 'ahri'], waves: false, open: true });
  const [garen, darius, lux, ahri] = game.champions;
  for (const c of game.champions) c.setPosition(X, Y);
  const ann = collect(game, 'announce');
  game.dealDamage(garen, darius, 99999, 'true');
  run(game, 3);
  game.dealDamage(garen, lux, 99999, 'true');
  assert(ann.some((a) => a.key === 'doubleKill' && a.text === '双杀！'), '双杀');
  run(game, 5);
  game.dealDamage(garen, ahri, 99999, 'true');
  assert(ann.some((a) => a.key === 'tripleKill'), '三杀');
  assert(garen.killStreak === 3, '连杀数');
  // 处决：被小兵击杀且 10 秒内无英雄伤害
  const game2 = makeGame({ blue: ['garen'], red: ['darius'], waves: false, open: true });
  const [g2, d2] = game2.champions;
  d2.setPosition(X, Y); g2.setPosition(X + 3000, Y);
  const minion = spawnDummy(game2, { team: 0, type: 'minion', x: X + 100, y: Y });
  const ann2 = collect(game2, 'announce');
  const kills2 = collect(game2, 'championKill');
  game2.dealDamage(minion, d2, 99999, 'physical');
  assert(kills2[0].executed && !kills2[0].firstBlood && ann2.some((a) => a.key === 'executed' && a.text.includes('被处决')), '处决');
  // 被防御塔补掉但 10 秒内受过英雄伤害 → 算该英雄击杀
  run(game2, 11);
  game2.dealDamage(g2, d2, 10, 'true');
  game2.dealDamage(minion, d2, 99999, 'physical');
  assert(kills2[1].killerChampion === g2 && !kills2[1].executed, '最后伤害的英雄获得击杀');
});
test('小兵经验分享与补刀金币', () => {
  const game = makeGame({ blue: ['garen', 'ahri'], waves: false, open: true });
  const [garen, ahri] = game.champions;
  garen.setPosition(X, Y); ahri.setPosition(X + 300, Y);
  const m = spawnDummy(game, { team: 1, type: 'minion', x: X + 150, y: Y, hp: 10, xpValue: 60, goldValue: 21 });
  const g0 = garen.gold, a0 = ahri.gold;
  game.dealDamage(garen, m, 50, 'true');
  approx(garen.gold - g0, 21, 1e-9, '最后一击金币');
  assert(ahri.gold === a0 && garen.cs === 1 && ahri.cs === 0, '补刀计数');
  approx(garen.xp, 60 * 0.651, 1e-9, '2 人各 65.1%');
  approx(ahri.xp, 60 * 0.651, 1e-9, '2 人各 65.1%');
  ahri.setPosition(X + 3000, Y);
  const m2 = spawnDummy(game, { team: 1, type: 'minion', x: X + 150, y: Y, hp: 10, xpValue: 60 });
  const x0 = garen.xp;
  game.dealDamage(m2, m2, 50, 'true');
  approx(garen.xp - x0, 60, 1e-9, '非英雄击杀也分享经验（1 人 100%）');
  // 宠物击杀归属主人
  const pet = game.spawnPet({ owner: garen, x: X, y: Y, baseStats: { hp: 500, ad: 10, range: 125, ms: 300 }, duration: 10 });
  const m3 = spawnDummy(game, { team: 1, type: 'minion', x: X + 150, y: Y, hp: 10, goldValue: 21 });
  const g1 = garen.gold;
  game.dealDamage(pet, m3, 50, 'true');
  approx(garen.gold - g1, 21, 1e-9, '宠物击杀金币归主人');
});
test('升级事件与经验表', () => {
  const game = makeGame({ blue: ['garen'], waves: false, open: true });
  const g = game.champions[0];
  const lv = collect(game, 'levelUp');
  g.gainXp(280);
  assert(g.level === 2 && lv.length === 1 && g.skillPoints === 2, '280 经验升 2 级');
  g.gainXp(100000);
  assert(g.level === 18 && g.xpProgress === 1 && g.xpToNext === 0, '满级');
});
test('被动金币：1:50 后每秒 2.04', () => {
  const { game, garen } = garenSetup();
  garen.gold = 0;
  run(game, 110);
  assert(garen.gold < 1, '1:50 前无被动金币');
  run(game, 10);
  approx(garen.gold, 20.4, 2.1, '10 秒约 20.4 金币');
});

// —— 召唤师技能 ——
test('闪现：400 码、穿墙、冷却 300 秒', () => {
  const game = makeGame({ blue: ['garen'], waves: false, open: { walls: [{ x0: 7950, y0: 0, x1: 8100, y1: 15000 }] } });
  const g = game.champions[0];
  g.setPosition(7000, 7400);
  const ev = collect(game, 'summonerCast');
  assert(g.castSummoner('D', { x: 9000, y: 7400 }).ok, '闪现');
  approx(g.x, 7400, 1e-6, '最多 400 码');
  assert(ev.length === 1 && ev[0].spellId === 'flash', '事件');
  approx(g.summoners.D.cdRemaining, 300, 1e-9, '冷却 300');
  assert(g.castSummoner('D', { x: 9000, y: 7400 }).reason === 'cooldown', '冷却中');
  g.setPosition(7800, 7400);
  g.summoners.D.cooldownUntil = 0;
  g.castSummoner('D', { x: 8250, y: 7400 });
  approx(g.x, 8200, 1e-6, '穿过墙体');
});
test('引燃：5 秒 70+20×等级 真实伤害 + 40% 重伤', () => {
  const { game, garen, dummy } = garenSetup({ dist: 400 });
  const r = garen.castSummoner('F', { target: dummy });
  assert(r.ok, `引燃 ${r.reason}`);
  game.step(TICK);
  approx(dummy.stats.grievous, 0.4, 1e-9, '重伤');
  run(game, 5.1);
  approx(3000 - dummy.hp, 90, 1e-6, '1 级共 90 真实伤害');
  assert(!dummy.hasBuff('ignite'), '结束');
  const far = spawnDummy(game, { team: 1, x: X + 2000, y: Y });
  garen.summoners.F.cooldownUntil = 0;
  const q = garen.castSummoner('F', { target: far });
  assert(q.ok && q.reason === 'queued', '超出射程走近施放');
});
test('治疗术/屏障/虚弱/幽灵疾步/净化/惩戒/传送', () => {
  const game = makeGame({ blue: [{ championId: 'garen', summoners: ['heal', 'barrier'] }, { championId: 'ahri', summoners: ['exhaust', 'ghost'] }, { championId: 'lux', summoners: ['cleanse', 'smite'] }, { championId: 'jinx', summoners: ['teleport', 'flash'] }], waves: false, open: true });
  const [garen, ahri, lux, jinx] = game.champions;
  for (const c of game.champions) c.setPosition(X, Y);
  const dummy = spawnDummy(game, { team: 1, x: X + 200, y: Y, ad: 100 });
  garen.hp = 300; ahri.hp = 200;
  garen.castSummoner('D');
  approx(garen.hp, 300 + 95, 1e-6, '治疗术自身');
  approx(ahri.hp, 200 + 95, 1e-6, '治疗术最残血队友');
  garen.castSummoner('F');
  approx(garen.totalShield, 120, 1e-9, '屏障');
  ahri.castSummoner('D', { target: dummy });
  game.step(TICK);
  approx(dummy.stats.damageDealtReduction, 0.4, 1e-9, '虚弱降低伤害');
  const h0 = lux.hp;
  game.dealDamage(dummy, lux, 100, 'true');
  approx(h0 - lux.hp, 60, 1e-6, '虚弱：造成伤害 -40%');
  run(game, 1.1);
  const ms0 = ahri.stats.moveSpeed;
  ahri.castSummoner('F');
  game.step(TICK);
  assert(ahri.stats.moveSpeed > ms0 * 1.2 && ahri.ghosted, '幽灵疾步');
  lux.applyCC('stun', 3);
  lux.castSummoner('D');
  assert(!lux.hasCC('stun'), '净化');
  const mon = spawnDummy(game, { team: 2, type: 'monster', x: X + 300, y: Y, hp: 1000 });
  assert(lux.castSummoner('F', { target: mon }).ok, '惩戒');
  approx(mon.hp, 400, 1e-9, '惩戒 600 真实伤害');
  assert(lux.summoners.F.charges === 1, '充能 -1');
  run(game, 0.3);
  assert(lux.castSummoner('F', { target: dummy }).reason === 'target', '惩戒不能对英雄');
  const turret = game.structures.find((s) => s.team === 0 && s.type === 'turret' && s.tier === 'outer' && s.lane === 'mid');
  assert(jinx.castSummoner('D', { x: turret.x, y: turret.y }).ok && jinx.channel && jinx.channel.id === 'teleport', '传送引导');
  run(game, 4.1);
  assert(Math.hypot(jinx.x - turret.x, jinx.y - turret.y) < 300, '传送到友方防御塔旁');
});

// —— 查询 / 软碰撞 / 草丛 / 宠物 / 守卫 / 动画 ——
test('空间查询：圆/线/扇形/最近/排除', () => {
  const { game, garen } = garenSetup({ dist: 300 });
  const d2 = spawnDummy(game, { team: 1, x: X, y: Y + 400 });
  const d3 = spawnDummy(game, { team: 1, x: X - 600, y: Y });
  const a = game.queryUnits({ x: X, y: Y, radius: 500, enemyOf: garen });
  assert(a.length === 2 && a[0].x === X + 300, '圆形查询按距离排序');
  const line = game.queryLine({ x1: X, y1: Y, x2: X + 1000, y2: Y, width: 50, enemyOf: garen });
  assert(line.length === 1 && line[0].x === X + 300, '线形查询');
  const cone = game.queryCone({ x: X, y: Y, dirX: 0, dirY: 1, angle: 60, range: 800, enemyOf: garen });
  assert(cone.length === 1 && cone[0] === d2, '扇形查询');
  assert(game.nearest({ x: X - 500, y: Y, enemyOf: garen, radius: 2000 }) === d3, '最近');
  assert(game.queryUnits({ x: X, y: Y, radius: 2000, enemyOf: garen, exclude: new Set([d2, d3]) }).length === 1, '排除');
  assert(game.queryUnits({ x: X, y: Y, radius: 100, allyOf: 0 })[0] === garen, 'allyOf 队伍编号');
});
test('软碰撞：小兵互相推开并保持可走', () => {
  const { game } = garenSetup({ dist: 3000 });
  const a = spawnDummy(game, { team: 1, type: 'minion', x: X, y: Y, radius: 48 });
  const b = spawnDummy(game, { team: 1, type: 'minion', x: X, y: Y, radius: 48 });
  run(game, 1);
  assert(Math.hypot(a.x - b.x, a.y - b.y) > 60, '分离');
});
test('草丛中攻击会暴露', () => {
  const { game, garen, dummy } = garenSetup({ dist: 200, brushes: [{ x0: X - 100, y0: Y - 100, x1: X + 100, y1: Y + 100, id: 3 }] });
  garen.attackUnit(dummy);
  run(game, 0.55);
  assert(garen.revealedUntil > game.time, '暴露');
});
test('宠物默认 AI 攻击附近敌人；守卫数量上限与普攻次数', () => {
  const { game, garen, dummy } = garenSetup({ dist: 300 });
  const pet = game.spawnPet({ owner: garen, x: X + 150, y: Y, modelId: 'tibbers', baseStats: { hp: 1000, ad: 50, range: 125, ms: 350, as: 1 }, duration: 3 });
  run(game, 1.5);
  assert(dummy.hp < 3000, '宠物攻击敌人');
  run(game, 2);
  assert(!pet.alive && !game.pets.includes(pet), '宠物到期移除');
  const wards = [];
  for (let i = 0; i < 4; i++) { wards.push(game.placeWard(garen, X + i * 100, Y + 500, 'stealth')); run(game, 0.1); }
  const alive = game.wards.filter((w) => w.owner === garen && w.kind === 'stealth');
  assert(alive.length === 3 && !alive.includes(wards[0]), '隐形守卫最多 3 个，移除最旧');
  assert(wards[1].stealthed && wards[1].sightRange === 900, '隐形与视野');
  game.placeWard(garen, X, Y + 800, 'control');
  game.placeWard(garen, X, Y + 900, 'control');
  run(game, 0.1);
  assert(game.wards.filter((w) => w.kind === 'control').length === 1, '控制守卫最多 1 个');
  const enemyWard = game.placeWard(dummy, X + 200, Y, 'stealth');
  assert(game.dealDamage(garen, enemyWard, 500, 'physical', { isAbility: true }) === 0, '技能对守卫无效');
  garen.attackUnit(enemyWard);
  run(game, 4);
  assert(!enemyWard.alive, '3 次普攻摧毁隐形守卫');
});
test('饰品守卫：充能与放置距离', () => {
  const { game, garen } = garenSetup();
  assert(garen.useTrinket(X + 300, Y).ok && garen.trinket.charges === 1, '放置');
  assert(game.wards.length === 1, '守卫生成');
  const r = garen.useTrinket(X + 2000, Y);
  assert(r.reason === 'queued', '超出距离走过去');
  run(game, 5);
  assert(garen.trinket.charges === 0 && game.wards.length === 2, '走到后放置');
});
test('动画状态：位移/击飞/眩晕/阵亡', () => {
  const { game, garen, dummy } = garenSetup();
  garen.dash({ x: X - 500, y: Y, speed: 1000 });
  game.step(TICK);
  assert(garen.anim.state === 'dash', 'dash');
  run(game, 0.6);
  garen.knockup(0.5);
  game.step(TICK);
  assert(garen.anim.state === 'airborne' && garen.z > 0, 'airborne 且有高度');
  run(game, 0.6);
  assert(garen.z === 0, '落地');
  garen.applyCC('stun', 0.5);
  game.step(TICK);
  assert(garen.anim.state === 'stunned', 'stunned');
  game.dealDamage(dummy, garen, 99999, 'true');
  game.step(TICK);
  assert(garen.anim.state === 'death', 'death');
});
test('施法动画与 abilityCast 事件', () => {
  const { game, garen, dummy } = garenSetup({ level: 6 });
  const casts = collect(game, 'abilityCast');
  garen.levelUpAbility('R');
  garen.castAbility('R', { target: dummy });
  game.step(TICK);
  assert(garen.anim.state === 'cast' && garen.anim.slot === 'R', '施法动画');
  run(game, 0.5);
  assert(casts.length === 1 && casts[0].abilityId === 'garen_r' && casts[0].target === dummy, 'abilityCast 事件');
});

// —— 对局 ——
test('Game.update 按固定步长推进并限制单帧', () => {
  const game = makeGame({ blue: ['garen'], waves: false, open: true });
  game.update(0.1);
  approx(game.time, 3 * TICK, 1e-9, '0.1 秒 = 3 步');
  game.update(10);
  assert(game.time < 0.5, '单帧最多 0.25 秒');
  game.paused = true;
  const t = game.time;
  game.update(0.1);
  assert(game.time === t, '暂停');
});
test('英雄注册表与定义完整性', () => {
  assert(CHAMPION_LIST.length === 10, '10 个英雄');
  for (const def of CHAMPION_LIST) {
    assert(def.id && def.name && def.baseStats && def.passive && def.ai, `${def.id} 基本字段`);
    for (const s of ['Q', 'W', 'E', 'R']) {
      const a = def.abilities[s];
      assert(a && a.id && a.name && typeof a.cast === 'function' && typeof a.desc === 'function', `${def.id} ${s}`);
      assert(typeof a.desc(null, 0) === 'string', `${def.id} ${s} desc(null, 0)`);
    }
  }
  assert(CHAMPIONS.garen.name === '盖伦' && CHAMPIONS.garen.title === '德玛西亚之力', '盖伦');
});
test('所有英雄技能可施放（冒烟）', () => {
  for (const def of CHAMPION_LIST) {
    const game = makeGame({ blue: [def.id], waves: false, open: true });
    const c = game.champions[0];
    c.setPosition(X, Y);
    c.setLevel(18);
    const dummy = spawnDummy(game, { team: 1, x: X + 300, y: Y, hp: 50000 });
    for (const s of ['Q', 'W', 'E', 'R']) while (c.levelUpAbility(s));
    for (const s of ['Q', 'W', 'E', 'R']) {
      c.mana = c.maxMana;
      c.castLock = 0;
      c.castAbility(s, { target: dummy, x: dummy.x, y: dummy.y });
      run(game, 1.2);
      if (c.abilities[s].isRecastActive) { c.castAbility(s, { target: dummy, x: dummy.x, y: dummy.y }); run(game, 0.5); }
    }
    run(game, 3);
    assert(dummy.hp < 50000, `${def.id} 技能造成伤害`);
  }
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
