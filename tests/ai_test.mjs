#!/usr/bin/env node
// AI 测试：控制器接口兼容、确定性、对线补刀、难度差异、目标承诺（不来回切换）、无长时间卡住、无异常
import { Game } from '../js/core/game.js';
import { CHAMPIONS } from '../js/champions/index.js';
import { createAI, aiStats } from '../js/ai/championAI.js';
import { getBrain } from '../js/ai/brain.js';
import { TICK } from '../js/config.js';
import { teamConfig, test, runTests, assert, run } from './helpers.mjs';

const NEW_BLUE = ['yasuo', 'xinzhao', 'zed', 'ezreal', 'morgana'];
const NEW_RED = ['malphite', 'leesin', 'ahri', 'jinx', 'thresh'];

function newGame({ seed = 1, difficulty = 'normal', blue = NEW_BLUE, red = NEW_RED } = {}) {
  return new Game({ blue: teamConfig(blue), red: teamConfig(red), champions: CHAMPIONS, createAI, difficulty, seed, headless: true });
}
const laners = (g) => g.champions.filter((c) => c.role === 'top' || c.role === 'mid' || c.role === 'adc');
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

test('控制器实现 ARCHITECTURE §9 接口（英雄 ai.custom/ai.when 可调用）', () => {
  const g = newGame();
  run(g, 5);
  for (const c of g.champions) {
    const ai = c.controller;
    assert(ai && ai.champ === c && ai.game === g, '控制器 champ/game');
    assert(typeof ai.role === 'string' && ai.params && typeof ai.params.lastHit === 'number', 'role/params');
    assert(typeof ai.mode === 'string', 'mode');
    for (const fn of ['visibleEnemies', 'nearbyAllies', 'hpPct', 'predict', 'castAt', 'castOn', 'castSelf', 'isUnderEnemyTurret', 'isSafe']) {
      assert(typeof ai[fn] === 'function', `缺少接口 ${fn}`);
    }
    assert(Array.isArray(ai.visibleEnemies()) && Array.isArray(ai.nearbyAllies()), '列表接口返回数组');
    const p = ai.predict(c, 0.3);
    assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'predict 返回坐标');
    assert(ai.hpPct() > 0 && ai.hpPct() <= 1, 'hpPct');
  }
});

test('纯清线上下文屏蔽敌方英雄，结束后恢复集火目标', () => {
  const g = newGame();
  run(g, 3);
  const ai = g.champions[2].controller;
  const foe = g.champions.find((c) => c.team !== ai.champ.team);
  ai.target = foe;
  let seen = null;
  const orig = ai._useAbilitiesInner;
  ai._useAbilitiesInner = function () { seen = { enemies: this.visibleEnemies(99999).length, target: this.target }; return false; };
  ai._useAbilities('farm', null);
  ai._useAbilitiesInner = orig;
  assert(seen && seen.enemies === 0 && seen.target === null, '清线时不应看到敌方英雄');
  assert(ai.target === foe, '清线后恢复 target');
  assert(ai.visibleEnemies(99999).length >= 0 && !ai._maskEnemies, '屏蔽已解除');
});

test('确定性：同种子两局 4 分钟后状态完全一致（锁步前提）', () => {
  const a = newGame({ seed: 7 }), b = newGame({ seed: 7 });
  run(a, 240); run(b, 240);
  for (let i = 0; i < a.champions.length; i++) {
    const x = a.champions[i], y = b.champions[i];
    assert(x.x === y.x && x.y === y.y && x.hp === y.hp && x.cs === y.cs && x.gold === y.gold, `英雄 ${x.championId} 状态不一致`);
  }
  assert(a.minions.length === b.minions.length, '小兵数量一致');
});

test('团队目标承诺：新目标不会在承诺时间内顶替仍有效的旧目标', () => {
  const g = newGame();
  run(g, 2);
  const brain = getBrain(g, 0);
  const now = g.time;
  const prev = { kind: 'push', lane: 'mid', since: now, setAt: now };
  const next = { kind: 'push', lane: 'top', since: now };
  assert(brain._commit(next, prev, 0) === prev, '18 秒内保持原推进路线');
  prev.setAt = now - 30;
  assert(brain._commit(next, prev, 0) === next, '承诺期过后可以换线');
  const urgent = { kind: 'push', lane: 'top', since: now, end: true };
  prev.setAt = now;
  assert(brain._commit(urgent, prev, 0) === urgent, '残局推家立即生效');
});

const csCache = new Map();
function laneCs(seed, difficulty) {
  const key = `${seed}:${difficulty}`;
  if (!csCache.has(key)) {
    const g = newGame({ seed, difficulty });
    run(g, 600);
    csCache.set(key, { cs: avg(laners(g).map((c) => c.cs)), errors: aiStats(g).errors + aiStats(g).customErrors, game: g });
  }
  return csCache.get(key);
}

test('一般难度：10 分钟对线英雄平均补刀 ≥ 50，且无 AI 异常', () => {
  const r = laneCs(1, 'normal');
  assert(r.errors === 0, `AI 异常 ${r.errors}`);
  assert(r.cs >= 50, `平均补刀 ${r.cs.toFixed(1)}`);
});

test('难度差异：困难补刀明显多于新手', () => {
  const easy = laneCs(3, 'easy'), hard = laneCs(3, 'hard');
  assert(hard.cs >= easy.cs + 8, `困难 ${hard.cs.toFixed(1)} vs 新手 ${easy.cs.toFixed(1)}`);
});

test('14 分钟内无英雄长时间卡住（有远处移动目标却 6 秒以上不动）', () => {
  const g = newGame({ seed: 2, blue: ['garen', 'leesin', 'ahri', 'jinx', 'thresh'], red: ['darius', 'masteryi', 'lux', 'ashe', 'annie'] });
  const last = new Map(), stuck = new Map();
  const sps = Math.round(1 / TICK);
  let worst = 0, who = '';
  for (let i = 1; i <= 14 * 60 * sps && !g.over; i++) {
    g.step(TICK);
    if (i % sps !== 0) continue;
    for (const c of g.champions) {
      const p = last.get(c);
      last.set(c, { x: c.x, y: c.y });
      const cmd = c.command;
      const tgt = cmd && (cmd.target || (cmd.x != null ? cmd : null));
      const far = c.alive && tgt && Math.hypot(tgt.x - c.x, tgt.y - c.y) > 200 && !(cmd.target && c.inAttackRange(cmd.target, 30));
      const moved = p ? Math.hypot(c.x - p.x, c.y - p.y) : 999;
      const n = far && cmd.type === 'move' && !c.channel && c.canMove() && moved < 15 ? (stuck.get(c) || 0) + 1 : 0;
      stuck.set(c, n);
      if (n > worst) { worst = n; who = c.championId; }
    }
  }
  assert(worst < 6, `${who} 连续 ${worst} 秒卡住`);
  assert(aiStats(g).errors === 0, 'AI 异常');
});

test('团战集结：中后期多名队友交战时 brain 记录团战位置与集火目标', () => {
  const r = laneCs(1, 'normal');
  const g = r.game;
  let sawFight = false, sawFocus = false;
  const sps = Math.round(1 / TICK);
  for (let i = 1; i <= 10 * 60 * sps && !g.over; i++) {
    g.step(TICK);
    for (const t of [0, 1]) {
      const b = getBrain(g, t);
      if (b.fightSpot) sawFight = true;
      if (b.focus && b.focus.team !== t) sawFocus = true;
    }
    if (sawFight && sawFocus) break;
  }
  assert(sawFight, '应出现团战位置');
  assert(sawFocus, '应出现集火目标（敌方英雄）');
});

const ok = await runTests();
process.exit(ok ? 0 : 1);
