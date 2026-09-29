#!/usr/bin/env node
// 局域网对战测试：启动 server.mjs（随机端口、加速 tick），3 个 WebSocket 客户端完成大厅 → 开局，
// 2 份无头 Game 按收到的 tick 锁步运行约 90 秒：断言状态哈希一致、AI 补齐 10 人、断线英雄挂上 AI、开局后新连接收到「对局进行中」、AI 分路正确
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../js/core/game.js';
import { CHAMPIONS } from '../js/champions/index.js';
import { createAI } from '../js/ai/championAI.js';
import * as shopMod from '../js/items/shop.js';
import { recomputeItemStats } from '../js/items/items.js';
import { LANE_CENTERLINES, CAMPS } from '../js/world/mapdata.js';
import { NetClient } from '../js/net/client.js';
import { Lockstep, lanTeams, mapHumans, stateHash } from '../js/net/lockstep.js';
import { ROLES, assignLineup } from '../js/net/roles.js';
import { TICK } from '../js/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { failures++; console.error(`  ✗ ${msg}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000, label = '条件') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(10); }
  throw new Error(`等待超时：${label}`);
}

// —— 0) 纯函数：分路分配 ——
console.log('分路分配（js/net/roles.js）');
{
  let rs = 7;
  const rng = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  for (const role of ROLES) {
    const { blue, red } = assignLineup({ champions: CHAMPIONS, rng, humans: [{ team: 0, role, championId: 'ahri', name: '玩家' }] });
    const all = [...blue, ...red];
    const good = [blue, red].every((l) => l.map((e) => e.role).join() === ROLES.join())
      && new Set(all.map((e) => e.championId)).size === 10 && blue[ROLES.indexOf(role)].championId === 'ahri' && blue[ROLES.indexOf(role)].isPlayer
      && all.filter((e) => e.role === 'jungle').every((e) => e.summoners.includes('smite'));
    ok(good, `玩家选择 ${role}：双方各 5 个位置齐全、英雄不重复、打野带惩戒`);
  }
}

// —— 0b) 离线锁步：投降投票（同队真人全部同意才结束）、leave 挂 AI ——
console.log('离线锁步（投降投票）');
{
  const humans = [
    { team: 0, role: 'mid', championId: 'ahri', name: '甲', humanId: 1 },
    { team: 0, role: 'top', championId: 'garen', name: '乙', humanId: 2 },
    { team: 1, role: 'adc', championId: 'jinx', name: '丙', humanId: 3 },
  ];
  const cfg = assignLineup({ champions: CHAMPIONS, humans });
  const teams = lanTeams(cfg);
  const game = new Game({ blue: teams.blue, red: teams.red, champions: CHAMPIONS, createAI, seed: 5, headless: true });
  const hm = mapHumans(game, cfg);
  const sent = [];
  const ls = new Lockstep(game, { localId: 1, humans: hm, createAI, shop: shopMod, send: (m) => sent.push(m) });
  ls.wrapChampion(hm.get(1));
  ls.pushTick({ n: 1, cmds: [{ pid: 1, c: ['surrender'] }] }); ls.drain();
  ok(!game.over, '一名队友投降时对局继续');
  ls.pushTick({ n: 2, cmds: [{ pid: 3, c: ['moveTo', 5000, 5000] }, { pid: 2, c: ['leave'] }] }); ls.drain();
  ok(!!hm.get(2).controller && hm.get(3).command?.type === 'move', 'leave 挂 AI；其他真人的命令按 pid 执行');
  ok(!game.over, '断线后剩余真人未全部同意前不结束');
  ls.pushTick({ n: 3, cmds: [{ pid: 1, c: ['surrender'] }] }); ls.drain();
  ok(game.over && game.winner === 1, '同队剩余真人全部同意 → 蓝方投降，红方获胜');
  hm.get(1).stop();
  ok(sent.some((m) => m.type === 'cmd' && m.c[0] === 'stop'), '本地命令发往服务器');
}

// —— 1) 启动服务器 ——
const srv = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), '--port', '0', '--quiet', '--tickrate', '600'], { stdio: ['ignore', 'pipe', 'pipe'] });
let srvOut = '';
srv.stdout.on('data', (d) => { srvOut += d; });
srv.stderr.on('data', (d) => { srvOut += d; process.stderr.write(d); });
const cleanup = () => { try { srv.kill(); } catch { /* 忽略 */ } };
process.on('exit', cleanup);
const hard = setTimeout(() => { console.error('测试超时'); cleanup(); process.exit(1); }, 120000);

try {
  const port = Number((await waitFor(() => /监听端口 (\d+)/.exec(srvOut), 8000, '服务器启动'))[1]);
  const base = `http://127.0.0.1:${port}`;
  console.log(`服务器（端口 ${port}）`);
  const info = await (await fetch(`${base}/api/lan`)).json();
  ok(info.lan === true && info.port === port, '/api/lan 返回服务信息');
  const idx = await fetch(`${base}/index.html`);
  ok(idx.status === 200 && /text\/html/.test(idx.headers.get('content-type')), '静态文件 index.html（text/html）');
  const js = await fetch(`${base}/js/main.js`);
  ok(js.status === 200 && /javascript/.test(js.headers.get('content-type')), '静态文件 main.js（text/javascript）');
  ok((await fetch(`${base}/.git/config`)).status === 403, '隐藏目录 403');
  ok([403, 404].includes((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status), '目录穿越被拒绝');

  // —— 2) 大厅 ——
  console.log('大厅');
  const url = `ws://127.0.0.1:${port}/ws`;
  const mk = async (name) => {
    const c = new NetClient(url);
    c.inbox = [];
    c.on('*', (m) => c.inbox.push(m));
    await c.connect(3000);
    return c;
  };
  const A = await mk('甲'), B = await mk('乙'), C = await mk('丙');
  A.send({ type: 'hello', name: '甲', team: 0, role: 'mid', championId: 'ahri' });
  const wA = await waitFor(() => A.inbox.find((m) => m.type === 'welcome'), 3000, 'A welcome');
  B.send({ type: 'hello', name: '乙', team: 1, role: 'adc', championId: 'jinx' });
  const wB = await waitFor(() => B.inbox.find((m) => m.type === 'welcome'), 3000, 'B welcome');
  C.send({ type: 'hello', name: '丙', team: 0, role: 'top', championId: 'garen' });
  const wC = await waitFor(() => C.inbox.find((m) => m.type === 'welcome'), 3000, 'C welcome');
  ok(wA.hostId === wA.id, '第一个加入的玩家成为房主');
  const lastLobby = (c) => [...c.inbox].reverse().find((m) => m.type === 'lobby');
  await waitFor(() => lastLobby(A)?.players?.length === 3, 3000, '大厅 3 人');
  B.send({ type: 'pick', championId: 'ahri' });
  ok((await waitFor(() => B.inbox.find((m) => m.type === 'error'), 3000, '冲突提示')).msg.includes('英雄'), '英雄全局不重复（选择他人英雄被拒绝）');
  C.send({ type: 'pick', role: 'mid' });
  ok((await waitFor(() => C.inbox.find((m) => m.type === 'error'), 3000, '位置冲突提示')).msg.includes('位置'), '同队位置不冲突（选择队友位置被拒绝）');
  B.send({ type: 'start' });
  ok((await waitFor(() => B.inbox.filter((m) => m.type === 'error').length >= 2, 3000, '非房主开始')), '非房主不能开始对局');
  A.send({ type: 'settings', difficulty: 'easy' });
  B.send({ type: 'ready', ready: true });
  C.send({ type: 'ready', ready: true });
  await waitFor(() => lastLobby(A)?.players?.every((p) => p.id === wA.id || p.ready) && lastLobby(A)?.settings?.difficulty === 'easy', 3000, '全部准备');
  A.send({ type: 'start' });
  const [sA, sB] = await Promise.all([A, B].map((c) => waitFor(() => c.inbox.find((m) => m.type === 'start'), 3000, 'start')));
  await waitFor(() => C.inbox.find((m) => m.type === 'start'), 3000, 'C start');
  const cfg = sA.config;
  const all = [...cfg.blue, ...cfg.red];
  ok(JSON.stringify(sA.config) === JSON.stringify(sB.config) && sA.seed === sB.seed, '所有客户端收到相同的 config 与种子');
  ok(cfg.blue.length === 5 && cfg.red.length === 5 && new Set(all.map((e) => e.championId)).size === 10, 'AI 补齐为 10 人且英雄不重复');
  ok([cfg.blue, cfg.red].every((l) => l.map((e) => e.role).join() === ROLES.join()), '每队上/野/中/ADC/辅助各 1 人');
  ok(all.filter((e) => e.humanId != null).length === 3 && cfg.blue[2].humanId === wA.id && cfg.red[3].humanId === wB.id && cfg.blue[0].humanId === wC.id, '真人位于所选阵营与位置（带 humanId）');
  ok(all.filter((e) => e.humanId == null).every((e) => /电脑/.test(e.name)), 'AI 名为「电脑 · 难度」');
  ok(sA.tickRate > 0, 'start 带 tickRate');

  // —— 3) 两份 Game 锁步 ——
  console.log('锁步模拟');
  const hashLog = [new Map(), new Map()];
  const makeSide = (client, localId, k) => {
    const teams = lanTeams(cfg);
    const game = new Game({ blue: teams.blue, red: teams.red, champions: CHAMPIONS, createAI, difficulty: cfg.difficulty, seed: sA.seed, headless: true });
    game.recomputeItemStats = recomputeItemStats;
    const humans = mapHumans(game, cfg);
    game.player = humans.get(localId);
    const ls = new Lockstep(game, {
      localId, humans, createAI, shop: shopMod, difficulty: cfg.difficulty,
      send: (m) => { if (m.type === 'hash') hashLog[k].set(m.n, m.h); client.send(m); },
    });
    ls.wrapChampion(game.player);
    client.on('tick', (m) => ls.pushTick(m));
    return { game, ls, me: game.player, shop: ls.shopProxy(shopMod), humans };
  };
  const SA = makeSide(A, wA.id, 0), SB = makeSide(B, wB.id, 1);
  ok(SA.game.champions.filter((c) => c.controller).length === 7, '真人英雄不挂 AI（7 个 AI）');
  // 本地调用被拦截：返回 queued，状态不立即改变
  const r1 = SA.me.moveTo(SA.me.x + 500, SA.me.y + 500);
  ok(r1?.reason === 'queued' && !SA.me.command, '本地命令被拦截并返回 { ok: true, reason: queued }');
  const r2 = SA.shop.buy(SA.me, 'healthpotion');
  ok(r2?.reason === 'queued' && SA.me.items.every((it) => !it || it.id !== 'healthpotion'), '商店代理：购买作为命令发送');
  SB.shop.buy(SB.me, 'healthpotion');
  A.send({ type: 'loaded' }); B.send({ type: 'loaded' }); C.send({ type: 'loaded' });

  const late = new NetClient(url);
  let leaveTick = 0, cAI = [false, false], lateMsg = null;
  const cChampId = cfg.blue[0].championId;
  const TARGET = 90 * 30;
  const TARGET2 = 125 * 30;
  const midPt = LANE_CENTERLINES.mid[Math.floor(LANE_CENTERLINES.mid.length / 2) - 3];
  while (SA.ls.tick < TARGET || SB.ls.tick < TARGET) {
    await sleep(2);
    for (const S of [SA, SB]) {
      while (S.ls.queue.length && S.ls.tick < TARGET) {
        S.ls.runTick(S.ls.queue.shift());
        const t = S.ls.tick;
        // 各种命令（经服务器同步）
        if (S === SA) {
          if (t === 20) SA.me.moveTo(midPt[0], midPt[1]);
          if (t === 60) SA.me.levelUpAbility('Q');
          if (t === 700) SA.me.castAbility('Q', { x: SA.me.x + 300, y: SA.me.y + 300, target: null });
          if (t === 900) SA.me.attackMove(midPt[0] + 200, midPt[1] + 200);
        } else {
          if (t === 30) SB.me.attackMove(12000, 13000);
          if (t === 60) SB.me.levelUpAbility('W');
          if (t === 400) {
            const enemy = SB.game.minions.find((m) => m.team !== SB.me.team);
            if (enemy) SB.me.attackUnit(enemy);
          }
          if (t === 1500) SB.me.startRecall();
        }
        if (S === SA && t === 600 && !C.closed) C.close();      // 丙在 20 秒时断线
      }
    }
    for (const [k, S] of [SA, SB].entries()) {
      const cc = S.game.champions.find((c) => c.championId === cChampId);
      if (!cAI[k] && cc.controller) { cAI[k] = true; if (k === 0) leaveTick = S.ls.tick; }
    }
    if (SA.ls.tick > 300 && !late.open && !late.closed && !lateMsg) {
      lateMsg = 'pending';
      late.connect(3000).then(() => { late.on('busy', (m) => { lateMsg = m.msg; }); late.send({ type: 'hello', name: '迟到' }); }).catch(() => { lateMsg = 'fail'; });
    }
  }
  ok(SA.ls.tick === TARGET && SB.ls.tick === TARGET, `两边各推进 ${TARGET} tick（${(TARGET * TICK).toFixed(0)} 秒）`);
  const ns = [...hashLog[0].keys()].filter((n) => hashLog[1].has(n));
  const same = ns.every((n) => hashLog[0].get(n) === hashLog[1].get(n));
  ok(ns.length >= 17 && same, `状态哈希一致（比较 ${ns.length} 个检查点）`);
  ok(stateHash(SA.game, SA.ls.rngCalls) === stateHash(SB.game, SB.ls.rngCalls), '结束时状态哈希一致');
  ok(!A.inbox.some((m) => m.type === 'desync') && !B.inbox.some((m) => m.type === 'desync'), '服务器未报告不同步');
  ok(cAI[0] && cAI[1] && leaveTick > 600, `断线玩家的英雄在两边都挂上 AI（第 ${leaveTick} tick）`);
  ok(SA.me.items.some((it) => it?.id === 'healthpotion') && SB.game.champions.find((c) => c.championId === SA.me.championId).items.some((it) => it?.id === 'healthpotion'), '购买命令在两边都已执行');
  ok(SA.me.abilities.Q.rank === 1 && SB.game.champions.find((c) => c.championId === SA.me.championId).abilities.Q.rank === 1, '升级技能命令在两边都已执行');
  await waitFor(() => lateMsg && lateMsg !== 'pending', 3000, '迟到连接');
  ok(/对局进行中/.test(lateMsg || ''), '开局后新连接只收到「对局进行中」提示');

  // —— 4) AI 分路（需求 A）：90 秒时在对应路线（或按 AI 设计在 60~110 秒帮本方打野「拉野」），125 秒时全部在线上 ——
  const segDist = (px, py, pts) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const dx = x1 - x0, dy = y1 - y0;
      const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t)));
    }
    return best;
  };
  const LANE = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot' };
  const humanSet = new Set(SA.humans.values());
  const checkLanes = (label, allowLeash) => {
    console.log(`  ${label}`);
    let laneOk = true;
    for (const c of SA.game.champions) {
      if (humanSet.has(c) || !c.alive) continue;
      const d = Object.fromEntries(Object.entries(LANE_CENTERLINES).map(([k, pts]) => [k, segDist(c.x, c.y, pts)]));
      const nearest = Object.entries(d).sort((x, y) => x[1] - y[1])[0];
      const jg = SA.game.champions.find((o) => o.team === c.team && o.role === 'jungle');
      let good, note = '';
      if (c.role === 'jungle') {
        const camp = Math.min(...CAMPS.map((k) => Math.hypot(k.x - c.x, k.y - c.y)));
        good = camp < 1500 || nearest[1] > 600;
      } else {
        good = nearest[0] === LANE[c.role] && nearest[1] < 1300;
        if (!good && allowLeash && jg && c.role !== 'top' && Math.hypot(jg.x - c.x, jg.y - c.y) < 1200) { good = true; note = '（帮打野拉野）'; }
      }
      if (c.championId === cChampId) { good = true; note = '（断线后接管的 AI，不计入）'; }
      if (!good) laneOk = false;
      console.log(`    ${c.team ? '红' : '蓝'} ${c.role.padEnd(7)} ${c.championId.padEnd(9)} (${Math.round(c.x)}, ${Math.round(c.y)}) 最近兵线 ${nearest[0]} ${Math.round(nearest[1])}${note}${good ? '' : '  ← 不符'}`);
    }
    return laneOk;
  };
  console.log('AI 分路');
  ok(checkLanes('第 90 秒', true), '90 秒：AI 按 champ.role 分路（上/中在对应兵线，ADC+辅助去下路或在帮打野拉野，打野在野区）');
  while (SA.ls.tick < TARGET2) { await sleep(2); while (SA.ls.queue.length && SA.ls.tick < TARGET2) SA.ls.runTick(SA.ls.queue.shift()); }
  ok(checkLanes('第 125 秒', false), '125 秒：上/中/下路 AI 均在对应兵线，打野在野区');

  A.close(); B.close(); late.close();
} catch (err) {
  failures++;
  console.error('测试异常：', err);
}
clearTimeout(hard);
cleanup();
console.log(failures ? `\n失败 ${failures} 项` : '\n全部通过');
process.exit(failures ? 1 : 0);
