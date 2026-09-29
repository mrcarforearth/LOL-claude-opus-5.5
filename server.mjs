#!/usr/bin/env node
// 局域网对战服务器（纯 Node 24，无第三方依赖）：静态文件服务 + 自实现 RFC6455 WebSocket（/ws）+ 大厅 + 30Hz 锁步命令广播
// 用法：node server.mjs [--port 8765] [--host 0.0.0.0] [--quiet]（--tickrate <n> 仅供测试加速，默认 30）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { CHAMPIONS } from './js/champions/index.js';
import { SUMMONERS } from './js/core/summoners.js';
import { assignLineup, ROLES, freeRole, isRole, defaultRole, summonersForRole, DIFF_NAMES } from './js/net/roles.js';
import { ALL_COMMANDS } from './js/net/lockstep.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = { port: 8765, host: '0.0.0.0', quiet: false, tickrate: 30 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--quiet') opt.quiet = true;
  else if (a === '--port') opt.port = Number(argv[++i]);
  else if (a === '--host') opt.host = argv[++i];
  else if (a === '--tickrate') opt.tickrate = Number(argv[++i]);
}
if (!Number.isInteger(opt.port) || opt.port < 0 || opt.port > 65535) opt.port = 8765;
const log = (...a) => { if (!opt.quiet) console.log('[服务器]', ...a); };

const TICK_RATE = Number.isFinite(opt.tickrate) && opt.tickrate >= 1 && opt.tickrate <= 2000 ? opt.tickrate : 30;
const MAX_FRAME = 64 * 1024;       // 单帧/单条消息上限
const MAX_PLAYERS = 10;
const LOAD_TIMEOUT_MS = 90000;     // 等待所有玩家加载完成的上限
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DIFFS = ['easy', 'normal', 'hard'];

// —— 局域网地址 ——
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
  }
  return out;
}

// —— 静态文件 ——
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.map': 'application/json; charset=utf-8',
};
function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
  res.end(text);
}
function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { sendText(res, 405, '405 方法不允许'); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { sendText(res, 400, '400 错误请求'); return; }
  if (pathname.includes('\0') || pathname.includes('\\')) { sendText(res, 400, '400 错误请求'); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(ROOT, '.' + path.posix.normalize(pathname));
  const rel = path.relative(ROOT, file);
  // 禁止目录穿越与隐藏文件（.git 等）
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some((p) => p.startsWith('.'))) { sendText(res, 403, '403 禁止访问'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { sendText(res, 404, '404 未找到'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      'X-Rift-Lan': '1',   // 页面据此判断由 server.mjs 提供（避免在普通静态服务器上请求 /api/lan 产生 404）
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

// —— WebSocket（RFC6455）连接 ——
class WsConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = null;
    this.fragOp = 0;
    this.fragLen = 0;
    this.closed = false;
    this.closeSent = false;
    this.lastSeen = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
    socket.on('end', () => this._finish());
  }
  _onData(d) {
    if (this.closed) return;
    this.lastSeen = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (!this.closed && this._parse());
  }
  // 解析一帧；返回 true 表示继续解析
  _parse() {
    const b = this.buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0, rsv = b[0] & 0x70, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (rsv) return this._fail(1002, '不支持扩展');
    if (len === 126) {
      if (b.length < 4) return false;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return false;
      if (b.readUInt32BE(2) !== 0) return this._fail(1009, '帧过大');
      len = b.readUInt32BE(6); off = 10;
    }
    if (!masked) return this._fail(1002, '客户端帧必须掩码');
    if (len > MAX_FRAME) return this._fail(1009, '帧过大');
    if (b.length < off + 4 + len) return false;
    const mask = b.subarray(off, off + 4);
    off += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
    this.buf = b.subarray(off + len);
    if (op >= 0x8) {
      // 控制帧：不可分片，≤125 字节
      if (!fin || len > 125) return this._fail(1002, '非法控制帧');
      if (op === 0x8) {
        const code = len >= 2 ? payload.readUInt16BE(0) : 1000;
        this.close(code === 1005 || code < 1000 ? 1000 : code);
        return false;
      }
      if (op === 0x9) { this._frame(0xA, payload); return true; }
      if (op === 0xA) return true;
      return this._fail(1002, '未知操作码');
    }
    if (op === 0x0) {
      if (!this.frags) return this._fail(1002, '意外的延续帧');
      this.frags.push(payload);
      this.fragLen += len;
      if (this.fragLen > MAX_FRAME) return this._fail(1009, '消息过大');
      if (!fin) return true;
      const data = Buffer.concat(this.frags);
      const fop = this.fragOp;
      this.frags = null;
      return this._deliver(fop, data);
    }
    if (op === 0x1 || op === 0x2) {
      if (this.frags) return this._fail(1002, '分片未结束');
      if (!fin) { this.frags = [payload]; this.fragOp = op; this.fragLen = len; return true; }
      return this._deliver(op, payload);
    }
    return this._fail(1002, '未知操作码');
  }
  _deliver(op, data) {
    if (op === 0x2) return this._fail(1003, '不支持二进制消息');
    this.emit('message', data.toString('utf8'));
    return !this.closed;
  }
  _frame(op, payload) {
    if (this.closed || (this.closeSent && op !== 0x8) || this.socket.destroyed) return;
    const len = payload.length;
    let hdr;
    if (len < 126) { hdr = Buffer.alloc(2); hdr[1] = len; }
    else if (len < 65536) { hdr = Buffer.alloc(4); hdr[1] = 126; hdr.writeUInt16BE(len, 2); }
    else { hdr = Buffer.alloc(10); hdr[1] = 127; hdr.writeUInt32BE(0, 2); hdr.writeUInt32BE(len, 6); }
    hdr[0] = 0x80 | op;
    this.socket.write(Buffer.concat([hdr, payload]));
  }
  send(text) { this._frame(0x1, Buffer.from(text, 'utf8')); }
  ping() { this._frame(0x9, Buffer.alloc(0)); }
  close(code = 1000, reason = '') {
    if (this.closed || this.closeSent) return;
    const r = Buffer.from(String(reason).slice(0, 40), 'utf8').subarray(0, 120);
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this._frame(0x8, p);
    this.closeSent = true;
    try { this.socket.end(); } catch { /* 忽略 */ }
    setTimeout(() => { try { this.socket.destroy(); } catch { /* 忽略 */ } this._finish(); }, 1500).unref?.();
  }
  _fail(code, reason) {
    this.buf = Buffer.alloc(0);
    this.close(code, reason);
    return false;
  }
  _finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

// —— 大厅与对局状态 ——
const state = {
  phase: 'lobby',             // lobby | loading | playing
  hostId: null,
  settings: { difficulty: 'normal' },
  players: new Map(),         // id → { id, name, team, championId, role, summoners, ready }
  nextId: 1,
  conns: new Set(),
  active: new Set(),          // 对局中仍在线的真人
  loaded: new Set(),
  pending: [],
  tick: 0,
  timer: null,
  loadTimer: null,
  endTimer: null,
  hashes: new Map(),          // n → Map(pid → hash)
  desyncs: 0,
};
const ALLOWED = new Set(ALL_COMMANDS);

function send(conn, msg) { try { conn.ws.send(JSON.stringify(msg)); } catch { /* 忽略 */ } }
function broadcast(msg, filter = null) {
  const text = JSON.stringify(msg);
  for (const c of state.conns) if (c.id != null && (!filter || filter(c))) { try { c.ws.send(text); } catch { /* 忽略 */ } }
}
const teamPlayers = (team, exceptId = null) => [...state.players.values()].filter((p) => p.team === team && p.id !== exceptId);
function lobbyMsg() {
  return {
    type: 'lobby', hostId: state.hostId, settings: { ...state.settings }, phase: state.phase,
    players: [...state.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, championId: p.championId, role: p.role, summoners: p.summoners.slice(), ready: p.ready })),
  };
}
const broadcastLobby = () => broadcast(lobbyMsg());
function pickHost() {
  if (state.hostId != null && state.players.has(state.hostId)) return;
  const ids = [...state.players.keys()].sort((a, b) => a - b);
  state.hostId = ids.length ? ids[0] : null;
}
const validSpells = (s) => Array.isArray(s) && s.length === 2 && s[0] !== s[1] && s.every((x) => typeof x === 'string' && SUMMONERS[x]);
const champTaken = (id, exceptId) => [...state.players.values()].some((p) => p.id !== exceptId && p.championId === id);
function cleanName(s, id) {
  const n = String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return n || `玩家${id}`;
}

function onHello(conn, msg) {
  if (conn.id != null) return;
  if (state.phase !== 'lobby') { send(conn, { type: 'busy', msg: '对局进行中，请等待本局结束后再加入' }); conn.ws.close(1000, 'busy'); return; }
  if (state.players.size >= MAX_PLAYERS) { send(conn, { type: 'full', msg: '房间已满（最多 10 人）' }); conn.ws.close(1000, 'full'); return; }
  const id = state.nextId++;
  const c0 = teamPlayers(0).length, c1 = teamPlayers(1).length;
  let team = msg.team === 0 || msg.team === 1 ? msg.team : c0 <= c1 ? 0 : 1;
  if (teamPlayers(team).length >= 5) team = 1 - team;
  let championId = CHAMPIONS[msg.championId] && !champTaken(msg.championId) ? msg.championId : null;
  const taken = new Set(teamPlayers(team).map((p) => p.role));
  let role = freeRole(taken, isRole(msg.role) ? msg.role : championId ? defaultRole(CHAMPIONS[championId]) : null, championId ? CHAMPIONS[championId] : null);
  if (!championId) championId = Object.keys(CHAMPIONS).find((cid) => !champTaken(cid) && (CHAMPIONS[cid].roles || []).includes(role))
    || Object.keys(CHAMPIONS).find((cid) => !champTaken(cid)) || Object.keys(CHAMPIONS)[0];
  const p = { id, name: cleanName(msg.name, id), team, championId, role, summoners: validSpells(msg.summoners) ? msg.summoners.slice() : summonersForRole(role), ready: false };
  state.players.set(id, p);
  conn.id = id;
  pickHost();
  send(conn, { type: 'welcome', id, hostId: state.hostId });
  log(`玩家加入：${p.name}（#${id}）`);
  broadcastLobby();
}

function onPick(conn, p, msg) {
  if (state.phase !== 'lobby') return;
  const err = (text) => send(conn, { type: 'error', msg: text });
  const team = msg.team === 0 || msg.team === 1 ? msg.team : p.team;
  if (team !== p.team && teamPlayers(team, p.id).length >= 5) return err('该阵营已满（最多 5 人）');
  const championId = msg.championId != null ? msg.championId : p.championId;
  if (!CHAMPIONS[championId]) return err('未知英雄');
  if (championId !== p.championId && champTaken(championId, p.id)) return err('该英雄已被其他玩家选择');
  const taken = new Set(teamPlayers(team, p.id).map((x) => x.role));
  let role;
  if (msg.role != null) {
    if (!isRole(msg.role)) return err('未知位置');
    if (taken.has(msg.role)) return err('该位置已被队友选择');
    role = msg.role;
  } else role = freeRole(taken, p.role, CHAMPIONS[championId]);
  if (!role) return err('该阵营没有空余位置');
  let summoners = p.summoners;
  if (msg.summoners != null) {
    if (!validSpells(msg.summoners)) return err('召唤师技能无效');
    summoners = msg.summoners.slice();
  } else if (role !== p.role) summoners = summonersForRole(role);
  const changed = team !== p.team || championId !== p.championId || role !== p.role || summoners.join() !== p.summoners.join();
  Object.assign(p, { team, championId, role, summoners });
  if (changed) p.ready = false;
  broadcastLobby();
}

function startGame() {
  const humans = [...state.players.values()].sort((a, b) => a.id - b.id).map((p) => ({
    team: p.team, role: p.role, championId: p.championId, summoners: p.summoners, name: p.name, humanId: p.id, isPlayer: true,
  }));
  const difficulty = state.settings.difficulty;
  const lineup = assignLineup({ champions: CHAMPIONS, humans, difficulty, rng: Math.random, summonerDefs: SUMMONERS });
  const seed = crypto.randomInt(1, 2147483000);
  const config = { lan: true, difficulty, seed, blue: lineup.blue, red: lineup.red };
  state.phase = 'loading';
  state.active = new Set(state.players.keys());
  state.loaded.clear();
  state.pending = [];
  state.tick = 0;
  state.hashes.clear();
  state.desyncs = 0;
  broadcast({ type: 'start', config, seed, tickRate: TICK_RATE });
  log(`对局开始：真人 ${humans.length} 人，AI 补齐 ${10 - humans.length} 人（${DIFF_NAMES[difficulty]}），种子 ${seed}`);
  state.loadTimer = setTimeout(beginTicks, LOAD_TIMEOUT_MS);
}
function maybeBeginTicks() {
  if (state.phase !== 'loading') return;
  for (const id of state.active) if (!state.loaded.has(id)) return;
  beginTicks();
}
function beginTicks() {
  if (state.phase !== 'loading') return;
  clearTimeout(state.loadTimer);
  state.phase = 'playing';
  log('所有玩家加载完成，开始同步');
  const t0 = performance.now();
  const step = 1000 / TICK_RATE;
  const loop = () => {
    if (state.phase !== 'playing') return;
    const due = Math.floor((performance.now() - t0) / step);
    while (state.tick < due) {
      state.tick++;
      const cmds = state.pending;
      state.pending = [];
      broadcast({ type: 'tick', n: state.tick, cmds });
    }
    state.timer = setTimeout(loop, Math.max(1, t0 + (state.tick + 1) * step - performance.now()));
  };
  loop();
}
function resetToLobby(reason) {
  clearTimeout(state.timer);
  clearTimeout(state.loadTimer);
  clearTimeout(state.endTimer);
  state.timer = state.loadTimer = state.endTimer = null;
  state.phase = 'lobby';
  state.players.clear();
  state.active.clear();
  state.loaded.clear();
  state.pending = [];
  state.hostId = null;
  for (const c of state.conns) { c.id = null; c.ws.close(1000, reason || 'reset'); }
  log(`对局结束（${reason || '重置'}），大厅已重置`);
}

function onHash(p, msg) {
  if (state.phase !== 'playing' || typeof msg.n !== 'number' || typeof msg.h !== 'string') return;
  let m = state.hashes.get(msg.n);
  if (!m) { m = new Map(); state.hashes.set(msg.n, m); }
  m.set(p.id, msg.h.slice(0, 32));
  let all = true;
  for (const id of state.active) if (!m.has(id)) { all = false; break; }
  if (all || m.size >= state.active.size) {
    const vals = new Set(m.values());
    if (vals.size > 1) {
      state.desyncs++;
      log(`警告：第 ${msg.n} 帧状态不一致`, Object.fromEntries(m));
      broadcast({ type: 'desync', n: msg.n, hashes: Object.fromEntries(m) });
    }
    state.hashes.delete(msg.n);
  }
  for (const n of state.hashes.keys()) if (n < msg.n - 1500) state.hashes.delete(n);
}

function onMessage(conn, text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  if (msg.type === 'hello') { onHello(conn, msg); return; }
  if (msg.type === 'ping') { send(conn, { type: 'pong', t: msg.t }); return; }
  const p = conn.id != null ? state.players.get(conn.id) : null;
  if (!p) return;
  switch (msg.type) {
    case 'pick': onPick(conn, p, msg); break;
    case 'ready':
      if (state.phase !== 'lobby') return;
      p.ready = msg.ready === undefined ? !p.ready : !!msg.ready;
      broadcastLobby();
      break;
    case 'settings':
      if (state.phase !== 'lobby' || p.id !== state.hostId) return;
      if (DIFFS.includes(msg.difficulty)) state.settings.difficulty = msg.difficulty;
      broadcastLobby();
      break;
    case 'start': {
      if (state.phase !== 'lobby') return;
      if (p.id !== state.hostId) { send(conn, { type: 'error', msg: '只有房主可以开始对局' }); return; }
      const notReady = [...state.players.values()].filter((x) => x.id !== state.hostId && !x.ready);
      if (notReady.length) { send(conn, { type: 'error', msg: `还有玩家未准备：${notReady.map((x) => x.name).join('、')}` }); return; }
      startGame();
      break;
    }
    case 'loaded':
      if (state.phase === 'loading') { state.loaded.add(p.id); maybeBeginTicks(); }
      break;
    case 'cmd': {
      if ((state.phase !== 'playing' && state.phase !== 'loading') || !state.active.has(p.id)) return;
      const c = msg.c;
      if (!Array.isArray(c) || !ALLOWED.has(c[0]) || c.length > 8 || text.length > 4096) return;
      // pid 由服务器按连接填写：每个玩家只能控制自己的英雄
      state.pending.push({ pid: p.id, c });
      break;
    }
    case 'hash': onHash(p, msg); break;
    case 'over':
      if (state.phase === 'playing' && !state.endTimer) state.endTimer = setTimeout(() => resetToLobby('对局结束'), 5000);
      break;
    default: break;
  }
}

function onClose(conn) {
  state.conns.delete(conn);
  const id = conn.id;
  conn.id = null;
  if (id == null || !state.players.has(id)) return;
  const p = state.players.get(id);
  state.players.delete(id);
  log(`玩家离开：${p.name}（#${id}）`);
  if (state.phase === 'lobby') {
    if (state.hostId === id) state.hostId = null;
    pickHost();
    broadcastLobby();
    return;
  }
  // 对局中断线：下一个 tick 插入 leave，所有客户端在同一 tick 为该英雄挂上 AI
  if (state.active.delete(id)) state.pending.push({ pid: id, c: ['leave'] });
  if (state.hostId === id) { state.hostId = null; pickHost(); }
  if (state.active.size === 0) { resetToLobby('所有玩家已离开'); return; }
  maybeBeginTicks();
}

// —— HTTP 服务 ——
const server = http.createServer((req, res) => {
  const u = (() => { try { return new URL(req.url, 'http://x'); } catch { return null; } })();
  if (u && u.pathname === '/api/lan') {
    const port = server.address()?.port;
    const body = JSON.stringify({
      lan: true, port, phase: state.phase, players: state.players.size,
      addresses: lanAddresses(), urls: lanAddresses().map((ip) => `http://${ip}:${port}/index.html`),
    });
    sendText(res, 200, body, 'application/json; charset=utf-8');
    return;
  }
  serveStatic(req, res);
});
server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch { /* 忽略 */ }
  const key = req.headers['sec-websocket-key'];
  if (pathname !== '/ws' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = new WsConn(socket);
  const conn = { ws, id: null };
  state.conns.add(conn);
  ws.on('message', (text) => { try { onMessage(conn, text); } catch (err) { console.error('[服务器] 处理消息出错：', err); } });
  ws.on('close', () => onClose(conn));
  if (head && head.length) ws._onData(head);
});
server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* 忽略 */ } });

// 心跳：每 10 秒 ping，40 秒无数据视为断线
setInterval(() => {
  const now = Date.now();
  for (const c of state.conns) {
    if (now - c.ws.lastSeen > 40000) { try { c.ws.socket.destroy(); } catch { /* 忽略 */ } c.ws._finish(); } else c.ws.ping();
  }
}, 10000).unref();

server.listen(opt.port, opt.host, () => {
  const port = server.address().port;
  console.log(`[服务器] 峡谷对决局域网服务已启动，监听端口 ${port}`);
  if (!opt.quiet) {
    console.log(`  本机访问：http://localhost:${port}/index.html`);
    const ips = lanAddresses();
    if (ips.length) for (const ip of ips) console.log(`  局域网访问：http://${ip}:${port}/index.html`);
    else console.log('  未检测到局域网 IPv4 地址（仅本机可访问）');
    console.log('  在选人界面点击「局域网对战」进入大厅；按 Ctrl+C 停止服务。');
  }
});
const shutdown = () => { for (const c of state.conns) c.ws.close(1001, '服务器关闭'); server.close(); setTimeout(() => process.exit(0), 200).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
