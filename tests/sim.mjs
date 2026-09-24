#!/usr/bin/env node
// 无头整局模拟：10 个 AI 对战，每分钟打印摘要；异常或不变量违规时退出码 1；结束时打印性能
// 用法：node tests/sim.mjs --minutes 25 --seed 1 [--blue garen,leesin,ahri,jinx,thresh --red darius,masteryi,lux,ashe,annie] [--quiet] [--difficulty normal]
import { Game } from '../js/core/game.js';
import { CHAMPIONS } from '../js/champions/index.js';
import { createAI } from '../js/ai/championAI.js';
import { TICK, MAP_SIZE } from '../js/config.js';
import { DEFAULT_BLUE, DEFAULT_RED, teamConfig } from './helpers.mjs';

const argv = process.argv.slice(2);
const opt = { minutes: 25, seed: 1, quiet: false, difficulty: 'normal' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  if (k === 'quiet') { opt.quiet = true; continue; }
  opt[k] = argv[++i];
}
const minutes = Number(opt.minutes) || 25;
const seed = Number(opt.seed) || 1;
const blueIds = opt.blue ? String(opt.blue).split(',') : DEFAULT_BLUE;
const redIds = opt.red ? String(opt.red).split(',') : DEFAULT_RED;
for (const id of [...blueIds, ...redIds]) if (!CHAMPIONS[id]) { console.error(`未知英雄：${id}`); process.exit(1); }

const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const violations = [];
const counters = { kills: 0, structures: 0, announces: {}, casts: 0, summoners: 0, errors: 0 };

let game;
const wallStart = performance.now();
try {
  game = new Game({ blue: teamConfig(blueIds), red: teamConfig(redIds), champions: CHAMPIONS, createAI, difficulty: opt.difficulty, seed, headless: true });
} catch (err) {
  console.error('创建对局失败：', err);
  process.exit(1);
}
const origError = console.error;
console.error = (...args) => { counters.errors++; origError(...args); };
game.events.on('championKill', () => counters.kills++);
game.events.on('structureDestroyed', (e) => { counters.structures++; if (!opt.quiet) console.log(`  [${fmtTime(game.time)}] ${e.team === 0 ? '蓝' : '红'}方 ${e.kind}${e.lane ? `(${e.lane}/${e.tier ?? ''})` : ''} 被摧毁`); });
game.events.on('announce', (e) => { counters.announces[e.key] = (counters.announces[e.key] || 0) + 1; });
game.events.on('abilityCast', () => counters.casts++);
game.events.on('summonerCast', () => counters.summoners++);

// 不变量检查
const stuck = new Map();
function checkInvariants() {
  const g = game;
  const lists = [g.champions, g.minions, g.monsters, g.pets, g.structures, g.wards];
  for (const list of lists) {
    for (const u of list) {
      const tag = `${u.type}#${u.id}(${u.name})`;
      if (!Number.isFinite(u.x) || !Number.isFinite(u.y)) violations.push(`${tag} 坐标 NaN`);
      else if (u.x < 0 || u.y < 0 || u.x > MAP_SIZE || u.y > MAP_SIZE) violations.push(`${tag} 越界 (${u.x.toFixed(0)},${u.y.toFixed(0)})`);
      if (!Number.isFinite(u.hp)) violations.push(`${tag} 生命 NaN`);
      else if (u.hp < -1e-6 || u.hp > u.maxHp + 1) violations.push(`${tag} 生命越界 ${u.hp}/${u.maxHp}`);
      if (u.maxMana > 0 && (!Number.isFinite(u.mana) || u.mana < -1e-6 || u.mana > u.maxMana + 1)) violations.push(`${tag} 资源越界 ${u.mana}/${u.maxMana}`);
      if (u.alive && !u.isStructure && u.type !== 'ward' && !u.dashState) {
        if (!g.nav.isWalkable(u.x, u.y)) {
          const n = (stuck.get(u) || 0) + 1;
          stuck.set(u, n);
          if (n > 3) violations.push(`${tag} 长期处于不可走格 (${u.x.toFixed(0)},${u.y.toFixed(0)})`);
        } else stuck.delete(u);
      }
    }
  }
}

function summary() {
  const g = game;
  const t = g.teams;
  const line = `[${fmtTime(g.time)}] 击杀 蓝${t[0].kills}:${t[1].kills}红 | 推塔 蓝${t[0].turretsDestroyed}:${t[1].turretsDestroyed}红 | 小兵 ${g.minions.length} 野怪 ${g.monsters.length} 投射物 ${g.projectiles.length}`;
  console.log(line);
  if (opt.quiet) return;
  for (const team of [0, 1]) {
    const cs = g.champions.filter((c) => c.team === team).map((c) => `${c.displayName}${c.alive ? '' : '†'} Lv${c.level} ${c.kills}/${c.deaths}/${c.assists} 补${c.cs} 金${Math.floor(c.gold)} 装${c.items.filter(Boolean).length}`);
    console.log(`   ${team === 0 ? '蓝' : '红'}：${cs.join(' | ')}`);
  }
}

const totalSteps = Math.round((minutes * 60) / TICK);
const stepsPerSec = Math.round(1 / TICK);
let simWall = 0;
let exitCode = 0;
try {
  for (let i = 1; i <= totalSteps && !game.over; i++) {
    const t0 = performance.now();
    game.step(TICK);
    simWall += performance.now() - t0;
    if (i % stepsPerSec === 0) {
      checkInvariants();
      if (violations.length) break;
    }
    if (i % (stepsPerSec * 60) === 0) summary();
  }
} catch (err) {
  console.log(`\n模拟异常（${fmtTime(game.time)}）：\n${err.stack || err}`);
  exitCode = 1;
}
if (violations.length) {
  console.log(`\n不变量违规（${fmtTime(game.time)}）：`);
  for (const v of [...new Set(violations)].slice(0, 20)) console.log(`  - ${v}`);
  exitCode = 1;
}
if (game.over) console.log(`\n对局结束：${game.winner === 0 ? '蓝色方' : '红色方'}获胜（${fmtTime(game.time)}）`);
summary();
const simSeconds = game.time;
console.log(`\n统计：英雄击杀 ${counters.kills}，建筑摧毁 ${counters.structures}，技能施放 ${counters.casts}，召唤师技能 ${counters.summoners}，console.error ${counters.errors}`);
console.log(`播报：${Object.entries(counters.announces).map(([k, v]) => `${k}×${v}`).join(' ')}`);
console.log(`性能：模拟 ${simSeconds.toFixed(0)} 秒，耗时 ${(simWall / 1000).toFixed(2)} 秒，每模拟秒 ${(simWall / Math.max(1, simSeconds)).toFixed(2)} 毫秒（总墙钟 ${((performance.now() - wallStart) / 1000).toFixed(2)} 秒）`);
if (counters.errors > 0 && exitCode === 0) { console.log('存在 console.error 输出'); exitCode = 1; }
process.exit(exitCode);
