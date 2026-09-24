// 装备系统测试：数据完整性、合成价格、购买/出售/撤销、关键被动与主动（无尽/破败/三相/中娅/守护天使）
// 运行：node tests/items_test.mjs
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { ITEMS, BUILDS, recomputeItemStats } from '../js/items/items.js';
import { effectiveCost, canBuy, buy, sell, undo, canUndo, nextPurchase, autoShop } from '../js/items/shop.js';
import { spellbladeArmed, inStasis } from '../js/items/itemfx.js';
import { FOUNTAINS } from '../js/world/mapdata.js';
import { CHAMPIONS } from '../js/champions/index.js';

const quiet = process.argv.includes('--quiet');
const F0 = FOUNTAINS.find((f) => f.team === 0);

function newGame() {
  const game = makeGame({ open: true, waves: false });
  game.recomputeItemStats = recomputeItemStats;
  return game;
}
// 在泉水生成一个有钱的蓝方英雄假人
function shopper(game, gold = 10000, opts = {}) {
  const c = spawnDummy(game, { team: 0, x: F0.x + 100, y: F0.y + 100, hp: 3000, ad: 100, ...opts });
  c.gold = gold;
  return c;
}
// 在泉水买装备后传送到战场
function equip(game, c, ids) {
  const px = c.x, py = c.y;
  c.setPosition(F0.x + 100, F0.y + 100);
  for (const id of ids) {
    c.gold = Math.max(c.gold, 20000);
    const r = buy(c, id);
    assert(r.ok, `购买 ${id}（${r.reason}）`);
  }
  c.setPosition(px, py);
}
const ids = (c) => c.items.filter(Boolean).map((it) => it.id);
const plainHit = (attacker) => ({ damage: 0, type: 'physical', isCrit: false, extra: [], miss: false, attacker });

// ============================================================================
// 数据
// ============================================================================
test('装备数据：≥50 件、合成材料存在且总价不低于材料和、每件有名称/描述/图标；10 个英雄都有出装', () => {
  const list = Object.values(ITEMS);
  assert(list.length >= 50, `装备数量 ${list.length}`);
  for (const d of list) {
    assert(d.name && d.desc && d.icon, `${d.id} 名称/描述/图标`);
    assert(Number.isFinite(d.cost) && d.cost >= 0, `${d.id} 价格`);
    let sum = 0;
    for (const f of d.from) { assert(ITEMS[f], `${d.id} 的材料 ${f} 存在`); sum += ITEMS[f].cost; }
    assert(d.cost >= sum, `${d.id} 总价 ${d.cost} ≥ 材料 ${sum}`);
  }
  const legend = list.filter((d) => d.tier === 'legendary');
  assert(legend.length >= 25, `传说装备 ${legend.length}`);
  assert(list.filter((d) => d.passive).length >= 30 && list.filter((d) => d.active).length >= 4, '被动/主动数量');
  for (const id of Object.keys(CHAMPIONS)) {
    const b = BUILDS[id];
    assert(b && b.start.length && b.core.length >= 3 && ITEMS[b.boots], `${id} 出装`);
    for (const x of [...b.start, ...b.core, ...(b.situational || [])]) assert(ITEMS[x], `${id} 出装中的 ${x}`);
  }
  // 几个关键 LoL 数值
  approx(ITEMS.infinityedge.cost, 3400, 0, '无尽之刃 3400');
  approx(ITEMS.longsword.cost, 350, 0, '长剑 350');
  approx(ITEMS.bfsword.cost, 1300, 0, '暴风之剑 1300');
  approx(ITEMS.guardianangel.cost, 3200, 0, '守护天使 3200');
});

// ============================================================================
// 商店
// ============================================================================
test('合成价格：递归扣除已拥有的材料（含材料的材料）', () => {
  const game = newGame();
  const c = shopper(game);
  approx(effectiveCost(c, 'infinityedge'), 3400, 0, '无材料全价');
  buy(c, 'bfsword');
  approx(effectiveCost(c, 'infinityedge'), 2100, 0, '已有暴风之剑');
  buy(c, 'pickaxe');
  approx(effectiveCost(c, 'infinityedge'), 1225, 0, '已有暴风之剑 + 十字镐');
  const c2 = shopper(game);
  buy(c2, 'longsword');
  approx(effectiveCost(c2, 'bork'), 2850, 0, '长剑作为吸血鬼节杖的材料被扣除');
  buy(c2, 'rubycrystal');
  approx(effectiveCost(c2, 'trinity'), 3333 - 350 - 400, 0, '红水晶 + 长剑 → 净蚀 → 三相之力');
  const before = c2.gold;
  const r = buy(c2, 'phage');
  assert(r.ok && ids(c2).join() === 'phage', `合成消耗材料 ${ids(c2)}`);
  approx(before - c2.gold, 1100 - 750, 0, '净蚀合成费 350');
});

test('购买条件：不在泉水 / 金币不足 / 唯一限制 / 栏位已满 / 消耗品叠放', () => {
  const game = newGame();
  const c = shopper(game, 5000);
  c.setPosition(CENTER.x, CENTER.y);
  assert(canBuy(c, 'longsword').reason === '不在泉水', '不在泉水');
  c.setPosition(F0.x + 100, F0.y + 100);
  c.gold = 100;
  assert(canBuy(c, 'longsword').reason === '金币不足', '金币不足');
  c.gold = 20000;
  assert(buy(c, 'boots').ok, '买鞋');
  assert(canBuy(c, 'boots').reason === '唯一限制', '鞋子唯一');
  assert(buy(c, 'berserkers').ok && ids(c).join() === 'berserkers', '鞋子升级为狂战士胫甲');
  assert(canBuy(c, 'plated').reason === '唯一限制', '二级鞋互斥');
  assert(buy(c, 'infinityedge').ok && canBuy(c, 'infinityedge').reason === '唯一限制', '传说装备唯一');
  for (let i = 0; i < 5; i++) assert(buy(c, 'healthpotion').ok, `药水 ${i + 1}`);
  const pot = c.items.find((it) => it && it.id === 'healthpotion');
  assert(pot.stacks === 5 && c.items.filter((it) => it && it.id === 'healthpotion').length === 1, '药水叠放在同一栏位');
  assert(canBuy(c, 'healthpotion').reason === '已达上限', '药水上限 5');
  buy(c, 'longsword'); buy(c, 'longsword'); buy(c, 'dagger');
  assert(c.items.every(Boolean), '六格已满');
  assert(canBuy(c, 'rubycrystal').reason === '栏位已满', '栏位已满');
  assert(canBuy(c, 'caulfield').ok, '满栏时仍可用栏位里的材料合成');
});

test('出售 70% 返还；撤销购买/出售恢复金币与材料；离开泉水后不可撤销', () => {
  const game = newGame();
  const c = shopper(game, 5000);
  buy(c, 'longsword'); buy(c, 'longsword');
  approx(c.gold, 4300, 0, '两把长剑');
  buy(c, 'caulfield');
  approx(c.gold, 3900, 0, '考尔菲德的战锤合成费 400');
  assert(ids(c).join() === 'caulfield', '材料被消耗');
  recomputeItemStats(c);
  approx(c.itemStats.ad, 25, 0, '装备属性汇总');
  assert(canUndo(c) && undo(c), '撤销合成');
  assert(ids(c).join() === 'longsword,longsword', `材料回到栏位 ${ids(c)}`);
  approx(c.gold, 4300, 0, '撤销返还全额');
  approx(c.itemStats.ad, 20, 0, '撤销后属性回退');
  const earned = c.totalGold;
  const r = sell(c, 0);
  assert(r.ok && r.refund === 245, `出售长剑返还 245（${r.refund}）`);
  approx(c.gold, 4545, 0, '出售金币');
  assert(c.totalGold === earned, '出售不计入总收入');
  assert(undo(c) && ids(c).length === 2, '撤销出售');
  approx(c.gold, 4300, 0, '撤销出售扣回金币');
  assert(undo(c) && undo(c) && ids(c).length === 0, '连续撤销两次购买');
  approx(c.gold, 5000, 0, '全部撤销后金币复原');
  assert(!undo(c), '没有可撤销的记录');
  buy(c, 'longsword');
  c.setPosition(CENTER.x, CENTER.y); run(game, 0.1);
  c.setPosition(F0.x + 100, F0.y + 100); run(game, 0.1);
  assert(!canUndo(c) && !undo(c) && ids(c).length === 1, '离开泉水后不能撤销');
});

test('AI 购买规划：开局出门装、之后按出装路线买材料', () => {
  const game = newGame();
  const def = CHAMPIONS.garen;
  const c = shopper(game, 500);
  c.championId = 'garen';
  const b = BUILDS.garen;
  const first = nextPurchase(c, b);
  assert(b.start.includes(first), `开局买出门装（${first}）`);
  const bought = autoShop(c, b);
  assert(bought.length >= 1 && bought.every((x) => b.start.includes(x)), `出门装 ${bought}`);
  assert(c.gold >= 0 && c.gold < 500, '花掉起始金币');
  game.time = 600;
  c.gold = 1400;
  const got = autoShop(c, b);
  assert(got.length >= 1, `之后购买核心装材料 ${got}`);
  assert(def != null, '英雄存在');
});

// ============================================================================
// 被动 / 主动
// ============================================================================
test('无尽之刃：+25% 暴击率，暴击伤害 175% → 215%', () => {
  const game = newGame();
  const c = shopper(game);
  approx(c.stats.critMult, 1.75, 1e-9, '基础暴击倍率');
  equip(game, c, ['infinityedge']);
  approx(c.stats.crit, 0.25, 1e-9, '暴击率');
  approx(c.stats.critMult, 2.15, 1e-9, '暴击倍率');
  approx(c.stats.ad, 170, 1e-9, '攻击力');
  const t = spawnDummy(game, { team: 1, x: CENTER.x + 100, y: CENTER.y, hp: 5000 });
  c.setPosition(CENTER.x, CENTER.y);
  const hp0 = t.hp;
  c.resolveAttackHit(t, { ...plainHit(c), isCrit: true });
  approx(hp0 - t.hp, 170 * 2.15, 0.01, '暴击伤害');
});

test('破败王者之刃：普攻附加目标当前生命 12%（远程 9%），对小兵最多 60', () => {
  const game = newGame();
  const c = shopper(game);
  equip(game, c, ['bork']);
  c.setPosition(CENTER.x, CENTER.y);
  const ad = c.stats.ad;
  approx(ad, 140, 1e-9, '攻击力');
  const t = spawnDummy(game, { team: 1, x: CENTER.x + 100, y: CENTER.y, hp: 3000 });
  c.resolveAttackHit(t, plainHit(c));
  approx(3000 - t.hp, ad + 360, 0.01, '对英雄：12% 当前生命');
  const hp1 = t.hp;
  c.resolveAttackHit(t, plainHit(c));
  approx(hp1 - t.hp, ad + hp1 * 0.12, 0.01, '按当前生命计算');
  const m = spawnDummy(game, { team: 1, type: 'minion', x: CENTER.x - 100, y: CENTER.y, hp: 3000 });
  c.resolveAttackHit(m, plainHit(c));
  approx(3000 - m.hp, ad + 60, 0.01, '对小兵上限 60');
  // 远程英雄 9%
  const r = shopper(game, 10000, { ad: 100 });
  r.baseStats.range = 550; r.baseStats.missileSpeed = 2000;
  equip(game, r, ['bork']);
  const t2 = spawnDummy(game, { team: 1, x: CENTER.x, y: CENTER.y + 300, hp: 3000 });
  r.setPosition(CENTER.x, CENTER.y + 700);
  r.resolveAttackHit(t2, plainHit(r));
  approx(3000 - t2.hp, r.stats.ad + 270, 0.01, '远程 9%');
  assert(c.stats.lifeSteal >= 0.08, '生命偷取');
});

test('三相之力：施放技能后下一次普攻 +200% 基础攻击力（1.5 秒冷却）；普攻获得迅捷', () => {
  const game = newGame();
  const c = shopper(game, 10000, { ms: 325 });
  equip(game, c, ['trinity']);
  c.setPosition(CENTER.x, CENTER.y);
  const t = spawnDummy(game, { team: 1, x: CENTER.x + 100, y: CENTER.y, hp: 9000 });
  assert(!spellbladeArmed(c), '初始未蓄势');
  c.runHooks('onAbilityCast', 'Q', {}, {});
  assert(spellbladeArmed(c), '施放技能后蓄势');
  let hp = t.hp;
  c.resolveAttackHit(t, plainHit(c));
  approx(hp - t.hp, c.stats.ad + 2 * c.stats.baseAd, 0.01, '咒刃伤害 = 攻击力 + 200% 基础攻击力');
  assert(!spellbladeArmed(c), '命中后消耗');
  c.runHooks('onAbilityCast', 'W', {}, {});
  assert(!spellbladeArmed(c), '1.5 秒冷却内不再蓄势');
  hp = t.hp;
  c.resolveAttackHit(t, plainHit(c));
  approx(hp - t.hp, c.stats.ad, 0.01, '冷却中只有普攻伤害');
  run(game, 1.6);
  c.runHooks('onAbilityCast', 'E', {}, {});
  assert(spellbladeArmed(c), '冷却结束后再次蓄势');
  run(game, 10.2);
  assert(!spellbladeArmed(c), '10 秒内未普攻则失效');
  const ms0 = c.stats.moveSpeed;
  c.runHooks('onAttackLaunch', t, plainHit(c));
  c.recalcStats();
  assert(c.hasBuff('item_trinity_quicken') && c.stats.moveSpeed > ms0, '迅捷：普攻后加速');
  approx(c.stats.maxHp, 3333, 1e-6, '三相之力 +333 生命');
});

test('中娅沙漏：2.5 秒凝滞（无敌、不可选取、不能行动），120 秒冷却', () => {
  const game = newGame();
  const c = shopper(game);
  equip(game, c, ['zhonya']);
  c.setPosition(CENTER.x, CENTER.y);
  const e = spawnDummy(game, { team: 1, x: CENTER.x + 200, y: CENTER.y, hp: 3000, ad: 100 });
  const slot = c.items.findIndex((it) => it && it.id === 'zhonya');
  const r = c.useItem(slot);
  assert(r.ok, `使用中娅（${r.reason}）`);
  assert(inStasis(c) && c.invulnerable && c.untargetable, '凝滞：无敌且不可选取');
  const hp = c.hp;
  game.dealDamage(e, c, 2000, 'true');
  approx(c.hp, hp, 1e-9, '凝滞期间不受伤害');
  assert(c.castAbility('Q').ok === false, '凝滞期间无法施法');
  run(game, 2.6);
  assert(!inStasis(c) && !c.invulnerable && !c.untargetable, '2.5 秒后结束');
  const r2 = c.useItem(slot);
  assert(!r2.ok && r2.reason === 'cooldown', '进入冷却');
  approx(c.items[slot].cooldownUntil - game.time, 120 - 2.6, 0.1, '120 秒冷却');
  game.dealDamage(e, c, 100, 'true');
  assert(c.hp < hp, '结束后正常受伤');
});

test('守护天使：致命伤害时凝滞 4 秒后以 50% 基础生命复活（300 秒冷却）', () => {
  const game = newGame();
  const c = shopper(game);
  equip(game, c, ['guardianangel']);
  c.setPosition(CENTER.x, CENTER.y);
  const e = spawnDummy(game, { team: 1, x: CENTER.x + 200, y: CENTER.y, hp: 3000 });
  const deaths = [];
  game.events.on('death', (ev) => deaths.push(ev));
  game.dealDamage(e, c, 1e6, 'true');
  assert(c.alive && inStasis(c) && c.invulnerable, '免于死亡并进入凝滞');
  assert(!deaths.some((d) => d.unit === c || d.victim === c), '不触发死亡');
  run(game, 3.9);
  assert(inStasis(c), '凝滞持续 4 秒');
  run(game, 0.2);
  assert(!inStasis(c) && c.alive, '复活');
  approx(c.hp, 0.5 * c.stats.baseHp, 1, '回复 50% 基础生命');
  const st = c.items.find((it) => it && it.id === 'guardianangel');
  approx(st.cooldownUntil - game.time, 296, 0.2, '300 秒冷却');
  game.dealDamage(e, c, 1e6, 'true');
  assert(!c.alive, '冷却中再次受到致命伤害则死亡');
});

test('出售装备会清理被动（钩子不再生效）', () => {
  const game = newGame();
  const c = shopper(game);
  buy(c, 'bork');
  const slot = c.items.findIndex((it) => it && it.id === 'bork');
  assert(sell(c, slot).ok, '出售破败');
  c.setPosition(CENTER.x, CENTER.y);
  const t = spawnDummy(game, { team: 1, x: CENTER.x + 100, y: CENTER.y, hp: 3000 });
  c.resolveAttackHit(t, plainHit(c));
  approx(3000 - t.hp, 100, 0.01, '卖掉后没有附加伤害');
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
