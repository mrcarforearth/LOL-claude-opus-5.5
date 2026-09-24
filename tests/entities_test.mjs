#!/usr/bin/env node
// 实体测试：兵线节奏与组成、小兵目标优先级、防御塔规则（打兵次数/转火/升温/镀层/工事/后门/解锁/奖励）、水晶重生与超级兵、
// 枢纽结束游戏、野怪刷新/仇恨/脱战/分裂、BUFF 与转移、小龙轮换/龙魂/远古巨龙、男爵、先锋冲塔、迅捷蟹视野、泉水
import { makeGame, spawnDummy, run, assert, approx, test, runTests, CENTER } from './helpers.mjs';
import { Minion, laneProjection, minionMoveSpeed } from '../js/entities/minion.js';
import { TURRET_VS_MINION, turretAdAt } from '../js/entities/structures.js';
import { DRAGON_TYPES, heraldChargeDamage } from '../js/entities/monsters.js';
import { TICK } from '../js/config.js';

const quiet = process.argv.includes('--quiet');

function turretOf(game, team, lane, tier) {
  return game.structures.find((s) => s.type === 'turret' && s.team === team && s.lane === lane && s.tier === tier);
}
function inhibOf(game, team, lane) { return game.structures.find((s) => s.type === 'inhibitor' && s.team === team && s.lane === lane); }
function nexusOf(game, team) { return game.structures.find((s) => s.type === 'nexus' && s.team === team); }
function kill(game, src, target) { game.dealDamage(src, target, 1e8, 'true'); }
// 时间快进（关闭兵线，避免补刷大量小兵）
function jumpTo(game, t) { game.spawner.nextWaveAt = Infinity; game.time = t; }
function campUnits(game, id) { const c = game.spawner.camp(id); return c ? c.units.filter((u) => u.alive) : []; }
function far(game, x, y) { return game.nav.nearestWalkable(x, y); }
function collect(game, name) { const out = []; game.events.on(name, (e) => out.push({ ...e, t: game.time })); return out; }
// 摧毁某队某路直到召唤水晶
function breakLane(game, killer, team, lane, { inhibitor = true } = {}) {
  for (const tier of ['outer', 'inner', 'inhib']) kill(game, killer, turretOf(game, team, lane, tier));
  if (inhibitor) kill(game, killer, inhibOf(game, team, lane));
}

// ============================================================================
// 兵线
// ============================================================================
test('出兵时间、播报与每波组成（炮车每 3 波）', () => {
  const game = makeGame({});
  const ann = collect(game, 'announce');
  const waves = collect(game, 'minionWave');
  run(game, 64.9);
  assert(game.minions.length === 0, '1:05 前没有小兵');
  const keys = ann.map((a) => a.key);
  assert(keys.includes('welcome') && keys.includes('minions30') && !keys.includes('minionsSpawned'), `开局播报 ${keys}`);
  const m30 = ann.find((a) => a.key === 'minions30');
  approx(m30.t, 35, 0.1, '三十秒播报时间');
  run(game, 0.2);
  assert(ann.some((a) => a.key === 'minionsSpawned' && a.text.includes('全军出击')), '全军出击');
  assert(waves.length === 1 && waves[0].wave === 1 && !waves[0].hasSiege, '第 1 波无炮车');
  run(game, 6);
  for (const team of [0, 1]) {
    for (const lane of ['top', 'mid', 'bot']) {
      const ms = game.minions.filter((m) => m.team === team && m.lane === lane);
      const melee = ms.filter((m) => m.kind === 'melee').length, caster = ms.filter((m) => m.kind === 'caster').length;
      assert(melee === 3 && caster === 3 && ms.length === 6, `${team} ${lane} 第一波 3 近战 + 3 远程（${melee}/${caster}/${ms.length}）`);
    }
  }
  const m = game.minions.find((u) => u.kind === 'melee');
  approx(m.maxHp, 477, 0.01, '近战小兵生命');
  approx(m.ad, 12, 0.01, '近战小兵攻击');
  const c = game.minions.find((u) => u.kind === 'caster');
  approx(c.maxHp, 296, 0.01, '远程小兵生命');
  assert(c.baseStats.attackVfx.kind === 'casterMinion' && c.attackRange === 550, '远程小兵投射物与射程');
  // 第 2、3 波
  run(game, 60);
  assert(waves.length === 3, `2:05 时共 3 波（${waves.length}）`);
  assert(!waves[1].hasSiege && waves[2].hasSiege, '第 3 波有炮车');
  run(game, 5);
  const sieges = game.minions.filter((u) => u.kind === 'siege');
  assert(sieges.length === 6, `每路每队一个炮车（${sieges.length}）`);
  assert(sieges[0].baseStats.attackVfx.kind === 'siegeBall' && sieges[0].goldValue === 60, '炮车外观与金币');
  approx(waves[1].t - waves[0].t, 30, 0.05, '出兵间隔 30 秒');
});

test('炮车节奏：15 分钟后每 2 波、25 分钟后每波；成长与移速', () => {
  const game = makeGame({ waves: false });
  const sp = game.spawner;
  assert(sp.hasSiege(3, 200) && !sp.hasSiege(4, 200) && !sp.hasSiege(5, 200) && sp.hasSiege(6, 200), '15 分钟前每 3 波');
  assert(sp.hasSiege(30, 920) && !sp.hasSiege(31, 920), '15 分钟后每 2 波');
  assert(sp.hasSiege(51, 1510) && sp.hasSiege(52, 1510), '25 分钟后每波');
  game.time = 900;
  const m = sp.spawnMinion(0, 'mid', 'melee');
  const s = sp.spawnMinion(0, 'mid', 'siege');
  approx(m.maxHp, 477 + 22 * 10, 0.01, '15 分钟近战小兵生命成长');
  approx(s.goldValue, 87, 0.01, '炮车金币每 90 秒 +3');
  // LoL：10:00/15:00/20:00/25:00 各 +25 → 15:00 时 375
  approx(minionMoveSpeed(599), 325, 0.01, '10 分钟前小兵移速');
  approx(minionMoveSpeed(600), 350, 0.01, '10 分钟小兵移速');
  approx(minionMoveSpeed(900), 375, 0.01, '15 分钟小兵移速');
  approx(minionMoveSpeed(1600), 425, 0.01, '移速上限 425');
  approx(m.baseStats.ms, 375, 0.01, '小兵实际移速');
  game.time = 3000;
  approx(sp.spawnMinion(1, 'top', 'siege').goldValue, 90, 0.01, '炮车金币上限 90');
});

test('两路小兵约 1:25~1:40 交汇；无英雄时兵线不会迅速推掉外塔', () => {
  const game = makeGame({});
  const meet = {};
  const destroyed = collect(game, 'structureDestroyed');
  while (game.time < 105) {
    game.step(TICK);
    for (const lane of ['top', 'mid', 'bot']) {
      if (meet[lane]) continue;
      const b = game.minions.filter((m) => m.lane === lane && m.team === 0);
      const r = game.minions.filter((m) => m.lane === lane && m.team === 1);
      for (const x of b) for (const y of r) if (Math.hypot(x.x - y.x, x.y - y.y) <= 700) meet[lane] = { t: game.time, x: (x.x + y.x) / 2, y: (x.y + y.y) / 2 };
    }
  }
  for (const lane of ['top', 'mid', 'bot']) {
    const mt = meet[lane];
    assert(mt && mt.t >= 85 && mt.t <= 100, `${lane} 交汇时间 ${mt && mt.t.toFixed(1)}`);
    // 交汇点位于两座外塔之间，远离防御塔
    for (const team of [0, 1]) {
      const t = turretOf(game, team, lane, 'outer');
      assert(Math.hypot(mt.x - t.x, mt.y - t.y) > 1500, `${lane} 交汇点远离 ${team} 方外塔`);
    }
    if (!quiet) console.log(`      ${lane} 交汇 ${mt.t.toFixed(1)}s @(${mt.x.toFixed(0)},${mt.y.toFixed(0)})`);
  }
  approx(meet.mid.x, CENTER.x, 700, '中路在河道交汇');
  run(game, 480 - game.time);
  assert(destroyed.length === 0, '8 分钟内无英雄兵线不推掉防御塔');
  for (const s of game.structures) if (s.type === 'turret' && s.tier === 'outer') assert(s.hp > 2500, `${s.structureId} 生命 ${s.hp.toFixed(0)}`);
});

// ============================================================================
// 小兵目标优先级与追击
// ============================================================================
function laneMinion(game, team, kind, x, y) {
  const m = new Minion(game, { team, kind, lane: 'mid', waypoints: game.spawner.lanePaths[team].mid, x, y });
  m.setPosition(x, y);
  game.add(m);
  return m;
}

test('小兵优先级：小兵优先于英雄；呼叫支援立即转火', () => {
  const game = makeGame({ open: true, waves: false });
  const bm = laneMinion(game, 0, 'caster', 7000, 7000);
  const rm = laneMinion(game, 1, 'melee', 7350, 7350);
  const rc = spawnDummy(game, { team: 1, x: 7150, y: 7150, hp: 5000 });
  const bc = spawnDummy(game, { team: 0, x: 6900, y: 6950, hp: 5000 });
  rm.waypoints = [[7350, 7350]];
  run(game, 0.5);
  assert(bm.command && bm.command.target === rm, `优先攻击最近的敌方小兵而非更近的英雄（${bm.command && bm.command.target && bm.command.target.name}）`);
  // 敌方英雄攻击我方英雄 → 呼叫支援
  game.dealDamage(rc, bc, 10, 'physical');
  run(game, 0.3);
  assert(bm.command && bm.command.target === rc, '呼叫支援：转火攻击我方英雄的敌方英雄');
  assert(bm.targetPriority === 1, '优先级 1');
});

test('小兵优先级：攻击我方小兵的敌方英雄 > 最近的敌方小兵；追击不超过兵线 800', () => {
  const game = makeGame({ open: true, waves: false });
  const victim = laneMinion(game, 0, 'melee', 7100, 7100);
  victim.waypoints = [[7100, 7100]];
  const rc = spawnDummy(game, { team: 1, x: 7180, y: 7180, hp: 5000, ad: 1 });
  rc.attackUnit(victim);
  run(game, 0.6);
  assert(rc.lastAttackAt > 0, '敌方英雄正在攻击我方小兵');
  const rm = laneMinion(game, 1, 'melee', 7000, 6700);
  rm.waypoints = [[7000, 6700]];
  const bm = laneMinion(game, 0, 'caster', 6800, 6800);
  run(game, 0.35);
  assert(bm.command && bm.command.target === rc, `优先攻击正在攻击我方小兵的敌方英雄（${bm.command?.target?.name}）`);
  // 目标跑离兵线 → 放弃并回到兵线
  const lane = game.spawner.lanePaths[0].mid;
  rc.stop();
  rc.setPosition(6200, 7800);
  const d = laneProjection(lane, rc.x, rc.y).dist;
  assert(d > 800, `目标离兵线 ${d.toFixed(0)}`);
  run(game, 1);
  assert(!(bm.command && bm.command.target === rc), '追击不超过离兵线 800');
  run(game, 3);
  assert(laneProjection(lane, bm.x, bm.y).dist < 400, '回到兵线');
});

// ============================================================================
// 防御塔
// ============================================================================
test('防御塔击杀小兵所需次数（近战 3 / 远程 2 / 炮车 8 / 超级兵 15）', () => {
  const expect = { melee: 3, caster: 2, siege: 8, super: 15 };
  for (const kind of Object.keys(expect)) {
    const game = makeGame({ waves: false });
    const t = turretOf(game, 0, 'mid', 'outer');
    const x = t.x + 420, y = t.y + 380;
    const m = new Minion(game, { team: 1, kind, lane: 'mid', waypoints: [[x, y]], x, y });
    m.setPosition(x, y);
    game.add(m);
    let shots = 0;
    game.events.on('attackHit', (e) => { if (e.attacker === t && e.target === m) shots++; });
    for (let i = 0; i < 30 * 40 && m.alive; i++) game.step(TICK);
    assert(!m.alive, `${kind} 被防御塔击杀`);
    assert(shots === expect[kind], `${kind} 需要 ${expect[kind]} 次（实际 ${shots}）`);
    approx(TURRET_VS_MINION[kind] * shots >= 1, true, 0, `${kind} 百分比`);
  }
});

test('防御塔：锁定目标、塔下呼叫支援立即转火、连续命中升温 +40%（上限 +120%）', () => {
  const game = makeGame({ waves: false });
  const t = turretOf(game, 0, 'mid', 'outer');
  const ally = spawnDummy(game, { team: 0, x: t.x + 150, y: t.y - 250, hp: 9000 });
  const m1 = new Minion(game, { team: 1, kind: 'melee', lane: 'mid', waypoints: [[t.x + 500, t.y + 300]], x: t.x + 500, y: t.y + 300 });
  m1.setPosition(m1.x, m1.y); game.add(m1);
  const foe = spawnDummy(game, { team: 1, x: t.x + 300, y: t.y + 200, hp: 20000 });
  run(game, 0.5);
  assert(t.target === m1 && t.attackTarget === m1, '优先攻击小兵（即使英雄更近）');
  // 更近的小兵进入：保持锁定
  const m2 = new Minion(game, { team: 1, kind: 'melee', lane: 'mid', waypoints: [[t.x + 250, t.y + 250]], x: t.x + 250, y: t.y + 250 });
  m2.setPosition(m2.x, m2.y); game.add(m2);
  run(game, 0.3);
  assert(t.target === m1, '锁定当前目标直到死亡或离开射程');
  // 敌方英雄攻击塔下我方英雄 → 立即转火
  const dmg = [];
  game.events.on('damage', (e) => { if (e.source === t && e.target === foe) dmg.push(e.amount); });
  game.dealDamage(foe, ally, 5, 'physical');
  game.step(TICK);
  assert(t.target === foe, '呼叫支援：立即转火敌方英雄');
  run(game, 7.5);
  assert(t.target === foe, '转火后锁定英雄（即使小兵在射程内）');
  assert(dmg.length >= 5, `命中次数 ${dmg.length}`);
  const base = dmg[0];
  approx(dmg[1] / base, 1.4, 0.01, '第二发 +40%');
  approx(dmg[2] / base, 1.8, 0.01, '第三发 +80%');
  approx(dmg[3] / base, 2.2, 0.01, '第四发 +120%');
  approx(dmg[4] / base, 2.2, 0.01, '上限 +120%');
  approx(base, turretAdAt('outer', 0), 0.5, '外塔初始攻击力');
  // 离开射程 → 换目标
  foe.setPosition(t.x + 1500, t.y + 1500);
  run(game, 0.3);
  assert(t.target && t.target.type === 'minion', '目标离开射程后攻击小兵');
});

test('镀层：14 分钟前每 1000 生命一层，160 金币平分给附近英雄；14:00 镀层消失', () => {
  const game = makeGame({ waves: false });
  const t = turretOf(game, 1, 'mid', 'outer');
  const a = spawnDummy(game, { team: 0, x: t.x - 1000, y: t.y - 900, hp: 9000 });
  const b = spawnDummy(game, { team: 0, x: t.x - 1100, y: t.y - 700, hp: 9000 });
  const faraway = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 9000 });
  const plates = collect(game, 'plateDestroyed');
  game.time = 400;
  assert(t.plates === 5, '外塔 5 层镀层');
  game.dealDamage(a, t, 999, 'true');
  assert(t.plates === 5 && a.gold === 0, '不足 1000 不掉镀层');
  game.dealDamage(a, t, 1, 'true');
  assert(t.plates === 4, '掉落一层');
  approx(a.gold, 80, 0.01, '镀层金币平分（a）');
  approx(b.gold, 80, 0.01, '镀层金币平分（b）');
  assert(faraway.gold === 0, '远处英雄不分镀层金币');
  game.dealDamage(a, t, 2000, 'true');
  assert(t.plates === 2 && plates.length === 3, '一次大伤害掉落多层');
  approx(a.gold, 240, 0.01, '累计镀层金币');
  game.time = 840;
  game.step(TICK);
  assert(t.plates === 0, '14:00 镀层消失');
  const g0 = a.gold;
  game.dealDamage(a, t, 1000, 'true');
  assert(a.gold === g0, '14:00 后不再有镀层金币');
});

test('防御工事（5 分钟前 -50%）与后门保护（无敌方小兵 -66%）', () => {
  const game = makeGame({ waves: false });
  const a = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 9000 });
  const outer = turretOf(game, 1, 'mid', 'outer');
  game.time = 100;
  approx(game.dealDamage(a, outer, 1000, 'true'), 500, 0.01, '防御工事');
  game.time = 400;
  approx(game.dealDamage(a, outer, 1000, 'true'), 1000, 0.01, '5 分钟后无减免（外塔无后门保护）');
  kill(game, a, outer);
  const inner = turretOf(game, 1, 'mid', 'inner');
  approx(game.dealDamage(a, inner, 1000, 'true'), 340, 0.01, '后门保护 -66%');
  const m = new Minion(game, { team: 0, kind: 'melee', lane: 'mid', waypoints: [[inner.x - 500, inner.y - 400]], x: inner.x - 500, y: inner.y - 400 });
  m.setPosition(m.x, m.y); game.add(m);
  approx(game.dealDamage(a, inner, 1000, 'true'), 1000, 0.01, '有我方小兵在附近时无后门保护');
});

test('解锁顺序：外塔 → 内塔 → 高地塔 → 召唤水晶 → 枢纽塔 → 枢纽', () => {
  const game = makeGame({ waves: false });
  const a = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 9000 });
  const T = (lane, tier) => turretOf(game, 1, lane, tier);
  const nts = game.structures.filter((s) => s.team === 1 && s.type === 'turret' && s.tier === 'nexus');
  assert(!T('mid', 'outer').invulnerable && T('mid', 'inner').invulnerable && T('mid', 'inhib').invulnerable, '初始只有外塔可被攻击');
  assert(inhibOf(game, 1, 'mid').invulnerable && nts.every((s) => s.invulnerable) && nexusOf(game, 1).invulnerable, '初始水晶/枢纽塔/枢纽无敌');
  kill(game, a, T('mid', 'inner'));
  assert(T('mid', 'inner').alive, '未解锁的内塔无法被摧毁');
  kill(game, a, T('mid', 'outer'));
  assert(!T('mid', 'inner').invulnerable && T('mid', 'inhib').invulnerable && T('top', 'inner').invulnerable, '外塔被破 → 同路内塔解锁');
  kill(game, a, T('mid', 'inner'));
  assert(!T('mid', 'inhib').invulnerable && inhibOf(game, 1, 'mid').invulnerable, '内塔被破 → 高地塔解锁');
  kill(game, a, T('mid', 'inhib'));
  assert(!inhibOf(game, 1, 'mid').invulnerable && nts.every((s) => s.invulnerable), '高地塔被破 → 召唤水晶解锁');
  kill(game, a, inhibOf(game, 1, 'mid'));
  assert(nts.every((s) => !s.invulnerable) && nexusOf(game, 1).invulnerable, '水晶被破 → 两座枢纽塔解锁');
  kill(game, a, nts[0]);
  assert(nexusOf(game, 1).invulnerable, '只破一座枢纽塔时枢纽仍无敌');
  kill(game, a, nts[1]);
  assert(!nexusOf(game, 1).invulnerable, '两座枢纽塔被破 → 枢纽解锁');
  assert(game.structures.includes(T('mid', 'outer')) && !T('mid', 'outer').alive, '建筑残骸保留在 game 中');
});

test('建筑奖励：外塔 250 本地 + 全队 50、首塔 +300、内塔 225；事件与中文播报', () => {
  const game = makeGame({ waves: false });
  const t = turretOf(game, 1, 'bot', 'outer');
  const a = spawnDummy(game, { team: 0, x: t.x - 1200, y: t.y - 400, hp: 9000 });
  const b = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 9000 });
  const ev = collect(game, 'structureDestroyed');
  const ann = collect(game, 'announce');
  game.time = 400;
  kill(game, a, t);
  approx(a.gold, 250 + 300 + 50, 0.01, '击杀者：本地 250 + 首塔 300 + 全队 50');
  approx(b.gold, 50, 0.01, '远处队友：全队 50');
  assert(game.firstTurretDone && game.teams[0].turretsDestroyed === 1, '首塔与计数');
  assert(ev.length === 1 && ev[0].kind === 'turret' && ev[0].team === 1 && ev[0].tier === 'outer' && ev[0].lane === 'bot' && ev[0].killerChampion === a, 'structureDestroyed 事件');
  const an = ann.find((x) => x.key === 'turretDestroyed');
  assert(an && an.team === 0 && an.text.includes('蓝色方') && an.text.includes('防御塔'), `播报：${an && an.text}`);
  const inner = turretOf(game, 1, 'bot', 'inner');
  a.setPosition(inner.x - 1200, inner.y - 300);
  const g0 = a.gold;
  kill(game, a, inner);
  approx(a.gold - g0, 225 + 50, 0.01, '内塔 225 本地 + 全队 50');
  // 小兵击杀：最近造成伤害的英雄获得归属
  const inhibT = turretOf(game, 1, 'bot', 'inhib');
  game.dealDamage(a, inhibT, 100, 'true');
  const m = new Minion(game, { team: 0, kind: 'melee', lane: 'bot', waypoints: [[inhibT.x, inhibT.y - 300]], x: inhibT.x, y: inhibT.y - 300 });
  m.setPosition(m.x, m.y); game.add(m);
  kill(game, m, inhibT);
  assert(ev[ev.length - 1].killerChampion === a, '10 秒内造成伤害的英雄获得击杀归属');
  kill(game, a, inhibOf(game, 1, 'bot'));
  const ia = ann.find((x) => x.key === 'inhibitorDestroyed');
  assert(ia && ia.team === 0 && ia.text.includes('召唤水晶'), '召唤水晶播报');
  assert(game.teams[0].inhibsDestroyed === 1, '水晶计数');
});

test('召唤水晶：300 秒重生（15 秒前预告）；被破期间对方出超级兵（三路全破每路 2 个）', () => {
  const game = makeGame({ waves: false });
  const a = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 9000 });
  const ann = collect(game, 'announce');
  const resp = collect(game, 'inhibitorRespawn');
  const sp = game.spawner;
  assert(!sp.waveKinds(0, 'mid').includes('super'), '初始无超级兵');
  breakLane(game, a, 1, 'mid');
  const tDown = game.time;
  const inh = inhibOf(game, 1, 'mid');
  assert(!inh.alive && inh.respawnAt != null, '水晶被摧毁');
  const k = sp.waveKinds(0, 'mid', 3, 300);
  assert(k[0] === 'super' && k.filter((x) => x === 'super').length === 1 && !k.includes('siege'), `中路超级兵取代炮车 ${k}`);
  assert(!sp.waveKinds(0, 'top').includes('super') && !sp.waveKinds(1, 'mid').includes('super'), '其他路/对方不出超级兵');
  sp.spawnWave();
  run(game, 6);
  const supers = game.minions.filter((m) => m.kind === 'super');
  assert(supers.length === 1 && supers[0].team === 0 && supers[0].lane === 'mid', '实际刷出 1 个超级兵');
  approx(supers[0].maxHp, 1600, 0.01, '超级兵生命');
  assert(supers[0].armor === 30 && supers[0].mr === -30 && supers[0].ad === 230, '超级兵属性');
  for (const m of game.minions.slice()) { m.alive = false; game.remove(m); }
  const at = inh.respawnAt;
  approx(at - tDown, 300, 0.01, '300 秒后重生');
  run(game, at - 15.5 - game.time);
  assert(!ann.some((x) => x.key === 'inhibitorRespawning'), '重生前 15 秒以前不预告');
  run(game, 1);
  const pre = ann.find((x) => x.key === 'inhibitorRespawning');
  assert(pre && pre.team === 1, '重生前 15 秒预告');
  run(game, at - game.time + 0.1);
  assert(inh.alive && inh.hp === inh.maxHp && resp.length === 1, '300 秒后重生并回满');
  assert(ann.some((x) => x.key === 'inhibitorRespawned' && x.team === 1), '重生播报');
  assert(!sp.waveKinds(0, 'mid').includes('super'), '重生后不再出超级兵');
  assert(!inh.invulnerable, '高地塔已破，重生的水晶仍可被攻击');
  for (const lane of ['top', 'mid', 'bot']) breakLane(game, a, 1, lane);
  for (const lane of ['top', 'mid', 'bot']) assert(sp.waveKinds(0, lane).filter((x) => x === 'super').length === 2, `三路水晶全破：${lane} 每波 2 个超级兵`);
});

test('枢纽被摧毁 → 游戏结束，对方获胜', () => {
  const game = makeGame({ waves: false });
  const a = spawnDummy(game, { team: 1, x: 13000, y: 13000, hp: 9000 });
  const over = collect(game, 'gameOver');
  const ev = collect(game, 'structureDestroyed');
  breakLane(game, a, 0, 'top');
  for (const s of game.structures.filter((x) => x.team === 0 && x.type === 'turret' && x.tier === 'nexus')) kill(game, a, s);
  kill(game, a, nexusOf(game, 0));
  assert(game.over && game.winner === 1 && over.length === 1 && over[0].winner === 1, '红色方获胜');
  assert(ev.some((e) => e.kind === 'nexus' && e.team === 0), '枢纽摧毁事件');
});

test('泉水激光：对泉水内敌人每 0.25 秒造成巨额真实伤害；自身无敌不可选中', () => {
  const game = makeGame({ waves: false });
  const f = game.structures.find((s) => s.kind === 'fountainTurret' && s.team === 0);
  assert(f && f.invulnerable && f.untargetable, '泉水无敌');
  const e = spawnDummy(game, { team: 1, x: 600, y: 600, hp: 3000, armor: 500 });
  run(game, 0.6);
  assert(!e.alive || e.hp < 1000, `敌人在泉水中迅速阵亡（${e.hp}）`);
});

// ============================================================================
// 野怪
// ============================================================================
test('野怪首刷 1:30、迅捷蟹 3:30、小龙 5:00、先锋 8:00；清营后按营地计时重生', () => {
  const game = makeGame({});
  game.spawner.nextWaveAt = Infinity;
  const obj = collect(game, 'objectiveKilled');
  run(game, 89.9);
  assert(game.monsters.length === 0, '1:30 前没有野怪');
  run(game, 0.2);
  const expectFirst = game.map.CAMPS.filter((c) => c.firstSpawn === 90).reduce((s, c) => s + c.monsters.length, 0);
  assert(game.monsters.length === expectFirst && expectFirst === 28, `1:30 刷新 12 个营地（${game.monsters.length}）`);
  const blue = campUnits(game, 'b_blue')[0];
  assert(blue.name === '蓝色哨兵' && blue.maxHp === 2300 && blue.large && !blue.epic, '蓝色哨兵');
  const wolves = campUnits(game, 'b_wolves');
  assert(wolves.length === 3 && wolves.filter((w) => w.kind === 'murkwolf_small').length === 2 && wolves.find((w) => w.kind === 'murkwolf').maxHp === 1600, '大狼 + 2 小狼');
  assert(campUnits(game, 'r_raptors').length === 6, '大鸟 + 5 小鸟');
  assert(campUnits(game, 'b_gromp')[0].maxHp === 2200, '魔沼蛙 2200');
  // 清空魔沼蛙营地 → 135 秒后重生
  const a = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 9000 });
  kill(game, a, campUnits(game, 'b_gromp')[0]);
  assert(obj.length === 1 && obj[0].kind === 'gromp' && obj[0].team === 0 && obj[0].killerChampion === a, 'objectiveKilled 事件');
  assert(a.gold === 80 && a.cs === 4, `魔沼蛙金币/补刀（${a.gold}/${a.cs}）`);
  approx(game.spawner.campTimer('b_gromp'), 135, 0.1, '重生计时');
  jumpTo(game, 209.9);
  run(game, 0.2);
  assert(campUnits(game, 'scuttle_top').length === 1 && campUnits(game, 'scuttle_bot').length === 1, '3:30 迅捷蟹');
  assert(campUnits(game, 'b_gromp').length === 0, '魔沼蛙尚未重生');
  jumpTo(game, 226);
  run(game, 0.2);
  assert(campUnits(game, 'b_gromp').length === 1, '魔沼蛙 135 秒后重生');
  jumpTo(game, 299.9);
  run(game, 0.2);
  const drake = campUnits(game, 'dragon')[0];
  assert(drake && drake.epic && drake.dragonType === game.spawner.dragonPlan[0] && DRAGON_TYPES.includes(drake.dragonType), '5:00 元素亚龙');
  assert(game.monsters.every((m) => game.nav.isWalkable(m.x, m.y)), '野怪都在可走区域');
  jumpTo(game, 479.9);
  run(game, 0.2);
  const herald = campUnits(game, 'herald')[0];
  assert(herald && herald.kind === 'herald' && herald.maxHp === 6000, '8:00 峡谷先锋（6000 生命）');
  // 先锋 19:45 离开，男爵 20:00 刷新
  jumpTo(game, 1184);
  run(game, 0.5);
  assert(campUnits(game, 'herald').length === 1, '19:44 先锋仍在');
  run(game, 1.2);
  assert(campUnits(game, 'herald').length === 0 && herald.removed, '19:45 先锋离开');
  const ann = collect(game, 'announce');
  jumpTo(game, 1199.9);
  run(game, 0.2);
  const baron = campUnits(game, 'baron')[0];
  assert(baron && baron.maxHp === 9000 && baron.epic, '20:00 纳什男爵（9000 生命）');
  assert(ann.some((x) => x.key === 'baronSpawn'), '男爵刷新播报');
});

function jungleGame(open = false) {
  const game = makeGame({ open });
  jumpTo(game, 89.9);
  run(game, 0.3);
  return game;
}

test('野怪仇恨：攻击首个伤害者；超出 leash 脱战回家（期间无敌）并回满生命', () => {
  const game = jungleGame();
  const blue = campUnits(game, 'b_blue')[0];
  const p = far(game, blue.homeX + 250, blue.homeY - 250);
  const a = spawnDummy(game, { team: 0, x: p.x, y: p.y, hp: 20000 });
  const b = spawnDummy(game, { team: 0, x: p.x + 60, y: p.y, hp: 20000 });
  game.dealDamage(a, blue, 800, 'true');
  game.dealDamage(b, blue, 10, 'true');
  run(game, 1.5);
  assert(blue.aggroTarget === a && blue.command && blue.command.target === a, '仇恨首个伤害者');
  assert(a.hp < 20000, '野怪攻击仇恨目标');
  // 目标远离营地
  const q = far(game, blue.homeX - 1800, blue.homeY - 900);
  a.setPosition(q.x, q.y);
  b.setPosition(q.x + 50, q.y);
  let sawReset = false, sawInvuln = false;
  for (let i = 0; i < 30 * 12; i++) {
    game.step(TICK);
    if (blue.resetting) sawReset = true;
    if (blue.resetting && blue.invulnerable) sawInvuln = true;
  }
  assert(sawReset && sawInvuln, '脱战回家，期间无敌');
  assert(!blue.resetting && !blue.invulnerable && blue.hp === blue.maxHp, `回满生命（${blue.hp}/${blue.maxHp}）`);
  assert(Math.hypot(blue.x - blue.homeX, blue.y - blue.homeY) < 120, '回到营地');
  assert(game.dealDamage(a, blue, 10, 'true') > 0, '回家后可再次被攻击');
});

test('野怪：目标短暂不可选取（阿尔法突袭/凝滞）时保持仇恨不回满，8 秒后才脱战', () => {
  const game = jungleGame();
  const blue = campUnits(game, 'b_blue')[0] || campUnits(game, 'blue')[0] || game.monsters.find((m) => m.kind === 'blue_sentinel');
  const p = far(game, blue.homeX + 150, blue.homeY);
  const a = spawnDummy(game, { team: 0, x: p.x, y: p.y, hp: 50000 });
  game.dealDamage(a, blue, 500, 'true');
  run(game, 1);
  assert(blue.aggroTarget === a, '仇恨攻击者');
  a.untargetable = true;
  run(game, 1);
  assert(!blue.resetting && blue.hp < blue.maxHp && blue.aggroTarget === a, '短暂不可选取：不脱战、不回满');
  a.untargetable = false;
  run(game, 1);
  assert(blue.command && blue.command.target === a, '目标恢复后继续攻击');
  a.untargetable = true;
  run(game, 8);
  assert(blue.resetting || (blue.hp === blue.maxHp && !blue.aggroTarget), '长时间无法攻击且未受伤 → 脱战');
});

test('野怪 8 秒未被目标伤害则脱战；营地同伴共享仇恨；魔像分裂', () => {
  const game = jungleGame();
  const wolves = campUnits(game, 'r_wolves');
  const big = wolves.find((w) => w.kind === 'murkwolf');
  const p = far(game, big.homeX + 200, big.homeY + 200);
  const a = spawnDummy(game, { team: 0, x: p.x, y: p.y, hp: 50000 });
  game.dealDamage(a, big, 300, 'true');
  run(game, 1);
  assert(wolves.every((w) => w.aggroTarget === a), '小狼一起仇恨攻击者');
  run(game, 5);
  game.dealDamage(a, big, 50, 'true');
  run(game, 5);
  assert(wolves.every((w) => !w.resetting), '持续被伤害（任一同伴）时不脱战');
  run(game, 5);
  assert(wolves.every((w) => w.resetting || (w.hp === w.maxHp && !w.aggroTarget)), '8 秒未受伤害 → 脱战');
  run(game, 6);
  assert(big.hp === big.maxHp && !big.aggroTarget, '脱战后回满');
  // 魔像分裂
  const obj = collect(game, 'objectiveKilled');
  const krugs = campUnits(game, 'b_krugs');
  const ancient = krugs.find((k) => k.kind === 'krug_ancient');
  assert(ancient.maxHp === 1350 && krugs.find((k) => k.kind === 'krug').maxHp === 1200, '远古魔像 1350 + 魔像 1200');
  const kp = far(game, ancient.homeX + 200, ancient.homeY);
  a.setPosition(kp.x, kp.y);
  kill(game, a, ancient);
  const splits = campUnits(game, 'b_krugs').filter((k) => k.kind === 'krug_split');
  assert(splits.length === 2 && splits.every((s) => s.aggroTarget === a), '远古魔像分裂为 2 个魔像并仇恨击杀者');
  let guard = 0;
  while (campUnits(game, 'b_krugs').length && guard++ < 20) for (const k of campUnits(game, 'b_krugs')) kill(game, a, k);
  assert(obj.length === 1 && obj[0].kind === 'krugs', '整营清空才算清营');
  assert(a.cs === 1 + 1 + 2 + 6 && a.gold > 80, `魔像营地补刀 ${a.cs}`);
});

test('蓝/红 BUFF：效果与被敌方英雄击杀时转移给击杀者', () => {
  const game = jungleGame();
  const a = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 3000 });
  const enemy = spawnDummy(game, { team: 1, x: 2100, y: 2000, hp: 3000 });
  kill(game, a, campUnits(game, 'b_blue')[0]);
  kill(game, a, campUnits(game, 'b_red')[0]);
  const bb = a.getBuff('blue_buff'), rb = a.getBuff('red_buff');
  assert(bb && rb, '击杀者获得蓝/红 BUFF');
  approx(bb.remaining, 120, 0.1, '持续 120 秒');
  a.recalcStats();
  assert(a.stats.abilityHaste === 10, '蓝 BUFF +10 技能急速');
  run(game, 30);
  kill(game, enemy, a);
  const tb = enemy.getBuff('blue_buff'), tr = enemy.getBuff('red_buff');
  assert(tb && tr, 'BUFF 转移给击杀者');
  approx(tb.remaining, 90, 0.5, '转移后保留剩余时间');
  assert(!a.hasBuff('blue_buff'), '死亡失去 BUFF');
  // 被防御塔处决（无英雄）→ 不转移
  const c = spawnDummy(game, { team: 1, x: 2000, y: 2100, hp: 3000 });
  const t = turretOf(game, 0, 'mid', 'outer');
  game.dealDamage(t, enemy, 1e8, 'true');
  assert(!c.hasBuff('blue_buff') && !enemy.hasBuff('blue_buff'), '无英雄击杀时 BUFF 消失');
});

test('红 BUFF：普攻灼烧（真实伤害）并减速', () => {
  const game = jungleGame(true);
  const a = spawnDummy(game, { team: 0, x: 7000, y: 7000, hp: 3000, ad: 40 });
  const t = spawnDummy(game, { team: 1, x: 7120, y: 7000, hp: 3000, ms: 300 });
  kill(game, a, campUnits(game, 'b_red')[0]);
  a.attackUnit(t);
  const trueDmg = [];
  game.events.on('damage', (e) => { if (e.source === a && e.type === 'true' && e.isDot) trueDmg.push(e.amount); });
  run(game, 1.5);
  assert(t.hasBuff('red_buff_burn'), '灼烧 debuff');
  assert(t.hasCC('slow'), '减速');
  assert(trueDmg.length > 0, '灼烧造成真实伤害');
});

test('元素亚龙：类型轮换、全队永久叠加 Buff、第 4 条龙魂、之后刷远古巨龙', () => {
  const game = makeGame({});
  const a = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 5000 });
  const a2 = spawnDummy(game, { team: 0, x: 2100, y: 2000, hp: 5000 });
  const r = spawnDummy(game, { team: 1, x: 13000, y: 13000, hp: 5000 });
  const obj = collect(game, 'objectiveKilled');
  const ann = collect(game, 'announce');
  const sp = game.spawner;
  const [d1, d2] = sp.dragonPlan;
  assert(d1 !== d2 && d1 !== sp.soulType && d2 !== sp.soulType, `类型不重复：${d1}/${d2}/${sp.soulType}`);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    jumpTo(game, (i === 0 ? 300 : sp.camp('dragon').nextSpawn) - 0.1);
    run(game, 0.2);
    const drake = campUnits(game, 'dragon')[0];
    assert(drake, `第 ${i + 1} 条小龙刷新`);
    seen.push(drake.dragonType);
    if (i === 0) approx(drake.maxHp, 3500, 1, '初始 3500 生命');
    kill(game, a, drake);
  }
  assert(seen[0] === d1 && seen[1] === d2 && seen[2] === sp.soulType && seen[3] === sp.soulType, `轮换顺序 ${seen}`);
  assert(game.teams[0].dragons.length === 4 && game.teams[0].dragonSoul === sp.soulType, '4 条龙与龙魂');
  for (const type of new Set(seen)) {
    const n = seen.filter((x) => x === type).length;
    assert(a.buffStacks(`dragon_${type}`) === n && a2.buffStacks(`dragon_${type}`) === n, `${type} 全队叠加 ${n} 层`);
  }
  assert(a.hasBuff('dragon_soul') && a2.hasBuff('dragon_soul') && !r.hasBuff('dragon_soul'), '龙魂');
  assert(obj.filter((o) => o.kind === 'dragon').length === 4 && obj[0].dragonType === d1 && obj[0].team === 0, 'objectiveKilled 带 dragonType');
  assert(ann.filter((x) => x.key === 'dragonSlain').length === 4 && ann.some((x) => x.key === 'dragonSlain' && x.text.includes('龙魂')), '击杀播报');
  // 属性：炼狱/山脉/云端体现在属性上
  a.recalcStats();
  if (seen.includes('mountain')) assert(a.buffStacks('dragon_mountain') > 0, '山脉层数');
  // 死亡保留
  kill(game, r, a2);
  assert(a2.hasBuff('dragon_soul') && a2.buffs.some((b) => b.id.startsWith('dragon_') && b.id !== 'dragon_soul'), '龙 Buff 死亡保留');
  // 远古巨龙
  assert(sp.nextDragonType === 'elder', '龙魂后刷远古巨龙');
  approx(sp.campTimer('dragon'), 360, 0.2, '远古巨龙 6 分钟后刷新');
  jumpTo(game, sp.camp('dragon').nextSpawn + 0.05);
  run(game, 0.1);
  const elder = campUnits(game, 'dragon')[0];
  assert(elder && elder.dragonType === 'elder', '远古巨龙刷新');
  kill(game, r, elder);
  assert(r.hasBuff('elder_dragon') && !a.hasBuff('elder_dragon'), '远古巨龙之威给击杀方存活英雄');
  // 处决：远古 Buff 下伤害让生命低于 20% 的英雄被处决
  a.hp = a.maxHp * 0.15;
  game.dealDamage(r, a, 1, 'physical');
  assert(!a.alive, '远古巨龙处决');
});

test('纳什男爵：全队存活英雄获得 180 秒纳什男爵之手（回城 4 秒、强化小兵），死亡失去', () => {
  const game = makeGame({});
  const a = spawnDummy(game, { team: 0, x: 5000, y: 9500, hp: 5000 });
  const a2 = spawnDummy(game, { team: 0, x: 7000, y: 7000, hp: 5000 });
  const dead = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 5000 });
  const r = spawnDummy(game, { team: 1, x: 13000, y: 13000, hp: 5000 });
  const ann = collect(game, 'announce');
  jumpTo(game, 1199.9);
  run(game, 0.2);
  kill(game, r, dead); // 时间快进后再击杀，避免其提前复活
  const baron = campUnits(game, 'baron')[0];
  const g0 = a.gold;
  kill(game, a, baron);
  const bb = a.getBuff('baron');
  assert(bb && a2.hasBuff('baron') && !dead.hasBuff('baron') && !r.hasBuff('baron'), '存活队友获得 Buff');
  approx(bb.remaining, 180, 0.1, '持续 180 秒');
  assert(bb.data.recallTime === 4 && a.recallDuration() === 4, '回城 4 秒');
  a.recalcStats();
  assert(a.stats.ad >= 24 && a.stats.ap >= 40, '攻击力/法强加成');
  approx(a.gold - g0, 300, 0.01, '男爵金币');
  assert(game.teams[0].baronKills === 1, '男爵计数');
  assert(ann.some((x) => x.key === 'baronSlain' && x.team === 0 && x.text.includes('纳什男爵')), '男爵播报');
  // 强化附近小兵
  const near = new Minion(game, { team: 0, kind: 'melee', lane: 'mid', waypoints: [[7100, 7000]], x: 7100, y: 7000 });
  near.setPosition(7100, 7000); game.add(near);
  const farM = new Minion(game, { team: 0, kind: 'melee', lane: 'mid', waypoints: [[4000, 4300]], x: 4000, y: 4300 });
  farM.setPosition(4000, 4300); game.add(farM);
  run(game, 0.5);
  assert(near.empowered && !farM.empowered, '附近友方小兵强化');
  assert(near.ad > 12 * 1.4 && near.stats.damageReduction > 0, '强化：更大伤害与减伤');
  kill(game, r, a2);
  run(game, 0.5);
  assert(!a2.hasBuff('baron') && !near.empowered, '死亡失去 Buff，小兵强化消失');
});

test('峡谷先锋：击杀后在坑内召唤友方先锋，沿兵线冲撞敌方防御塔后消失', () => {
  const game = makeGame({});
  const a = spawnDummy(game, { team: 0, x: 4600, y: 9900, hp: 5000 });
  const ann = collect(game, 'announce');
  jumpTo(game, 479.9);
  run(game, 0.2);
  const herald = campUnits(game, 'herald')[0];
  kill(game, a, herald);
  assert(ann.some((x) => x.key === 'heraldSlain' && x.team === 0), '先锋播报');
  assert(game.teams[0].heraldKills === 1, '先锋计数');
  const ally = game.monsters.find((m) => m.kind === 'herald_ally');
  assert(ally && ally.team === 0 && ally.type === 'monster' && ally.summoned, '召唤友方峡谷先锋');
  assert(Math.hypot(ally.x - herald.homeX, ally.y - herald.homeY) < 400, '在坑内召唤');
  const target = turretOf(game, 1, ally.lane, 'outer');
  assert(ally.lane === 'top', `选择最近的兵线（${ally.lane}）`);
  const hp0 = target.hp;
  const dmg = [];
  game.events.on('damage', (e) => { if (e.source === ally && e.target === target) dmg.push(e.amount); });
  let t = 0;
  while (!ally.removed && t < 90) { run(game, 0.5); t += 0.5; }
  assert(ally.removed, `先锋撞击后消失（用时 ${t}s）`);
  assert(dmg.length === 1, '撞击造成一次大量伤害');
  approx(dmg[0], heraldChargeDamage(game.time), 60, '撞击伤害');
  assert(target.hp <= hp0 - 1900, `外塔生命 ${hp0} → ${target.hp.toFixed(0)}`);
  assert(target.plates <= 3, '撞掉镀层');
  if (!quiet) console.log(`      先锋冲塔用时 ${t}s，伤害 ${dmg[0].toFixed(0)}`);
});

test('迅捷蟹：沿河道巡游、受击后逃跑且被减速；击杀方获得 90 秒视野与神龛', () => {
  const game = makeGame({});
  const a = spawnDummy(game, { team: 0, x: 2000, y: 2000, hp: 5000 });
  jumpTo(game, 209.9);
  run(game, 0.2);
  const crab = campUnits(game, 'scuttle_bot')[0];
  assert(crab && crab.maxHp === 1100 && crab.passiveMonster, '迅捷蟹 1100 生命');
  const x0 = crab.x, y0 = crab.y;
  run(game, 3);
  assert(Math.hypot(crab.x - x0, crab.y - y0) > 100, '沿路径巡游');
  game.dealDamage(a, crab, 100, 'true');
  run(game, 0.2);
  assert(crab.hasBuff('scuttle_exhausted'), '受击后减速');
  assert(!crab.command || crab.command.type !== 'attack', '迅捷蟹不攻击');
  const sx = crab.x, sy = crab.y;
  run(game, 0.5);
  assert(!game.vision.isVisible(0, sx, sy), '击杀前蓝方看不到河道');
  const zones0 = game.zones.length;
  kill(game, a, campUnits(game, 'scuttle_bot')[0]);
  const kx = crab.x, ky = crab.y;
  run(game, 0.5);
  assert(game.vision.isVisible(0, kx, ky) && !game.vision.isVisible(1, kx, ky), '击杀方获得视野');
  assert(game.zones.length > zones0 && game.zones.some((z) => z.data.scuttleShrine), '移速神龛');
  run(game, 90);
  assert(!game.vision.isVisible(0, kx, ky), '90 秒后视野消失');
  approx(game.spawner.campTimer('scuttle_bot'), 150 - 90.5, 0.5, '迅捷蟹 150 秒重生');
});

const ok = await runTests({ quiet });
process.exit(ok ? 0 : 1);
