#!/usr/bin/env node
// 无头浏览器自检工具:自带静态服务器 + 独立 Chrome 实例(可多个代理并发使用)
// 用法示例:
//   node tools/browsercheck.mjs --path "/index.html?autostart=1&autopilot=1&speed=3" --seconds 20 \
//        --screenshot shots/a.png --eval "JSON.stringify({t: window.__game?.time})"
//   node tools/browsercheck.mjs --path "/" --steps '[{"wait":2},{"click":[800,450]},{"key":"KeyQ"},{"screenshot":"shots/b.png"}]'
// 参数:
//   --path <url路径>        默认 "/index.html"
//   --seconds <n>           页面加载后等待秒数(默认 8),在 steps 之前
//   --width/--height        视口大小(默认 1600x900)
//   --screenshot <file>     结束时截图(PNG)
//   --eval <js表达式>        结束时在页面求值并打印(支持 await / Promise)
//   --steps <json>          动作序列:{wait:s} {click:[x,y],button:'left'|'right'} {move:[x,y]}
//                           {key:'KeyQ'} {keydown:'KeyQ'} {keyup:'KeyQ'} {eval:'expr'} {screenshot:'f.png'}
//   --headful               显示浏览器窗口(调试用)
//   --quiet                 只打印错误和 eval 结果
// 退出码:页面出现未捕获异常或 console.error 时为 1,否则 0。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = { path: '/index.html', seconds: 8, width: 1600, height: 900 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  if (k === 'headful' || k === 'quiet') { opt[k] = true; continue; }
  opt[k] = argv[++i];
}
opt.seconds = Number(opt.seconds);
opt.width = Number(opt.width);
opt.height = Number(opt.height);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const httpPort = server.address().port;

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rift-bc-'));
const chromeArgs = [
  `--user-data-dir=${userDir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  `--window-size=${opt.width},${opt.height}`, '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank',
];
if (!opt.headful) chromeArgs.unshift('--headless=new');
const chrome = spawn(CHROME, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.on('data', () => {});

let exitCode = 0;
const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch {}
  try { server.close(); } catch {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);
const hardTimeout = setTimeout(() => { console.error('[browsercheck] 超时退出'); cleanup(); process.exit(2); },
  (opt.seconds + 120) * 1000);

// 等待 DevToolsActivePort
let dbgPort = null;
for (let i = 0; i < 200 && !dbgPort; i++) {
  try {
    const txt = fs.readFileSync(path.join(userDir, 'DevToolsActivePort'), 'utf8');
    dbgPort = Number(txt.split('\n')[0]);
  } catch { await sleep(50); }
}
if (!dbgPort) { console.error('[browsercheck] 无法启动 Chrome'); process.exit(2); }

const targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
const logs = [];
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type)).join(' ');
    const entry = `[console.${m.params.type}] ${text}`;
    logs.push(entry);
    if (m.params.type === 'error' || m.params.type === 'assert') errors.push(entry);
    if (!opt.quiet || m.params.type === 'error') console.log(entry);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const text = `[exception] ${d.exception?.description || d.text} @ ${d.url || ''}:${d.lineNumber}:${d.columnNumber}`;
    errors.push(text); console.log(text);
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    const text = `[log.${e.level}] ${e.text} ${e.url || ''}`;
    if (e.url && e.url.endsWith('/favicon.ico')) return;
    if (e.level === 'error') { errors.push(text); console.log(text); } else if (!opt.quiet) console.log(text);
  }
};
function send(method, params = {}) {
  return new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) return `EVAL ERROR: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`;
  const v = r.result.value;
  return typeof v === 'string' ? v : JSON.stringify(v);
}
async function screenshot(file) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const fp = path.resolve(ROOT, file);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, Buffer.from(r.data, 'base64'));
  console.log(`[screenshot] ${fp}`);
}
const KEYMAP = (code) => {
  if (code.startsWith('Key')) return { key: code.slice(3).toLowerCase(), code, vk: code.charCodeAt(3) };
  if (code.startsWith('Digit')) return { key: code.slice(5), code, vk: code.charCodeAt(5) };
  const special = { Space: [' ', 32], Tab: ['Tab', 9], Escape: ['Escape', 27], Enter: ['Enter', 13], ShiftLeft: ['Shift', 16], ControlLeft: ['Control', 17] };
  const s = special[code] || [code, 0];
  return { key: s[0], code, vk: s[1] };
};
async function key(type, code) {
  const k = KEYMAP(code);
  await send('Input.dispatchKeyEvent', { type, key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, text: type === 'keyDown' && k.key.length === 1 ? k.key : undefined });
}
async function mouse(type, x, y, button = 'none', clickCount = 0) {
  await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 0 });
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: opt.width, height: opt.height, deviceScaleFactor: 1, mobile: false });
const url = `http://127.0.0.1:${httpPort}${opt.path.startsWith('/') ? '' : '/'}${opt.path}`;
if (!opt.quiet) console.log(`[browsercheck] 打开 ${url}`);
await send('Page.navigate', { url });
await sleep(opt.seconds * 1000);

if (opt.steps) {
  const steps = JSON.parse(opt.steps);
  for (const s of steps) {
    if (s.wait !== undefined) await sleep(s.wait * 1000);
    else if (s.move) await mouse('mouseMoved', s.move[0], s.move[1]);
    else if (s.click) {
      const b = s.button || 'left';
      await mouse('mouseMoved', s.click[0], s.click[1]);
      await mouse('mousePressed', s.click[0], s.click[1], b, 1);
      await mouse('mouseReleased', s.click[0], s.click[1], b, 1);
    } else if (s.key) { await key('keyDown', s.key); await sleep(40); await key('keyUp', s.key); }
    else if (s.keydown) await key('keyDown', s.keydown);
    else if (s.keyup) await key('keyUp', s.keyup);
    else if (s.eval) console.log(`[eval] ${await evaluate(s.eval)}`);
    else if (s.screenshot) await screenshot(s.screenshot);
  }
}
if (opt.eval) console.log(`[eval] ${await evaluate(opt.eval)}`);
if (opt.screenshot) await screenshot(opt.screenshot);

console.log(`[browsercheck] 完成:${errors.length} 个错误,${logs.length} 条日志`);
if (errors.length) { exitCode = 1; console.log('--- 错误汇总 ---'); for (const e of errors.slice(0, 40)) console.log(e); }
clearTimeout(hardTimeout);
ws.close();
cleanup();
process.exit(exitCode);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
