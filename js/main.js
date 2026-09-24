// 启动流程与主循环（core）：URL 参数 → 选人 → 加载各模块（可选模块缺失/报错时使用内置后备）→ requestAnimationFrame 主循环 → 结算后再来一局
//
// 【给渲染 / UI / 音频代理：main.js 如何接入你的模块】（导出名与构造参数严格按 ARCHITECTURE.md §10.3~§14，写完即可接入，无需改本文件）
//  加载：全部 await import() 并行加载；单个模块失败只影响它自己（文件不存在 → console.warn + 后备；语法/导出错误 → console.error + 后备）。
//  顺序：showChampSelect(screenRoot, { champions, summoners, renderPortrait, defaults }) → Config
//    → showLoadingScreen(screenRoot, config, champions, renderPortrait) → { setProgress(p, label), close() }
//    → new Game({...})；game.recomputeItemStats = recomputeItemStats；（time=N：无渲染快进，期间玩家英雄临时由 AI 控制）
//    → new Renderer(game, #game-root, { quality })；renderer.setViewFactory(createView)
//    → new FX(renderer, game)；game.fx = renderer.fx = fx；registerChampionFX(fx)
//    → new Terrain(renderer, game)；await terrain.build(onProgress)；renderer.setTerrain(terrain)（terrain.update 由 renderer 每帧调用）
//    → new FogRenderer(renderer, game, terrain) → new Input(game, renderer, { root: #game-root })
//    → new Overlay(renderer, game, #game-root) → new Indicators(renderer, game, input)
//    → renderer.addSystem：fog → fx → indicators → overlay（按此顺序每帧 update(dt, renderer)）
//    → new AudioSystem(game, renderer, { muted }) → new UI(game, renderer, input, { root: #ui-root, audio, champions, summoners,
//        items: ITEMS, shop: shop.js 模块命名空间, renderPortrait, screenRoot, config, onRestart })
//    → renderer.render(0) 预热 → loading.close() → 主循环。
//  每帧：dt = min(0.1, 真实间隔) → input.update(dt) → game.update(dt) → renderer.render(dt) → ui.update(dt) → audio.update(dt)。
//  首次用户手势（pointerdown / keydown）调用 audio.unlock()。gameOver 后由 UI 显示结算，「再来一局」调用 opts.onRestart()。
//  URL：autostart=1 champ=<id> team=0|1 speed=<n> difficulty=easy|normal|hard autopilot=1 spectate=1 seed=<n>
//       quality=low|medium|high time=<秒> debug=1 mute=1（另：reveal=1 显示全图单位，调试用）
//  调试：window.__game / __renderer / __ui / __input / __fx / __audio / __perf（滚动平均 frameMs/simMs/renderMs/uiMs/fps）/ __config / __modules
import { TICK, MAP_SIZE, DIFFICULTY } from './config.js';

// main.js 已开始执行：关闭 index.html 的 8 秒超时提示；之后的启动错误由本文件显示
window.__booted = true;

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
const ROLE_SUMMONERS = {
  top: ['flash', 'teleport'], jungle: ['flash', 'smite'], mid: ['flash', 'ignite'], adc: ['flash', 'heal'], support: ['flash', 'exhaust'],
};
const DEFAULT_LINEUP = [
  ['garen', 'leesin', 'ahri', 'jinx', 'thresh'],
  ['darius', 'masteryi', 'lux', 'ashe', 'annie'],
];
const PLAYER_NAME = '召唤师';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const $ = (id) => document.getElementById(id);
const yieldTask = () => new Promise((r) => setTimeout(r, 0));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
function fmtTime(t) {
  const s = Math.max(0, Math.floor(t || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// —— URL 参数 ——
export function parseParams(search = location.search) {
  const q = new URLSearchParams(search);
  const flag = (k) => { if (!q.has(k)) return false; const v = (q.get(k) || '').toLowerCase(); return v !== '0' && v !== 'false' && v !== 'no'; };
  const num = (k, d, lo, hi) => { const v = Number(q.get(k)); return q.has(k) && q.get(k) !== '' && Number.isFinite(v) ? clamp(v, lo, hi) : d; };
  const oneOf = (k, list) => { const v = (q.get(k) || '').toLowerCase(); return list.includes(v) ? v : null; };
  const team = q.get('team');
  return {
    autostart: flag('autostart'),
    champ: (q.get('champ') || '').trim().toLowerCase() || null,
    team: team === '1' || team === 'red' ? 1 : team === '0' || team === 'blue' ? 0 : null,
    speed: num('speed', 1, 0.1, 16),
    difficulty: oneOf('difficulty', ['easy', 'normal', 'hard']),
    autopilot: flag('autopilot'),
    spectate: flag('spectate'),
    seed: q.has('seed') ? Math.floor(num('seed', 1, 0, 2147483646)) : null,
    quality: oneOf('quality', ['low', 'medium', 'high']),
    time: num('time', 0, 0, 7200),
    debug: flag('debug'),
    mute: flag('mute'),
    reveal: flag('reveal'),
  };
}

// —— 错误处理 ——
class BootError extends Error {
  constructor(title, cause) {
    super(title);
    this.title = title;
    this.cause = cause;
  }
}
const errState = new Map();
function reportError(where, err) {
  const now = performance.now();
  const s = errState.get(where) || { last: -1e9, count: 0 };
  s.count++;
  if (now - s.last > 5000) {
    s.last = now;
    console.error(`[主循环] ${where} 出错（累计 ${s.count} 次）：`, err);
  }
  errState.set(where, s);
}
function guard(where, fn) {
  try { fn(); } catch (err) { reportError(where, err); }
}
function showFatal(title, err) {
  console.error(`[启动] ${title}`, err);
  window.__bootFailed = true;
  const cause = err instanceof BootError ? err.cause : err;
  const detail = String(cause?.stack || cause?.message || cause || '').slice(0, 2000);
  if (typeof window.__showBootError === 'function') window.__showBootError(title, detail);
  else {
    const root = $('screen-root') || document.body;
    const box = document.createElement('div');
    box.className = 'boot-error';
    box.textContent = `${title}\n${detail}`;
    root.appendChild(box);
  }
}

// —— 模块加载 ——
const moduleStatus = {};
async function load(path) {
  try { return { mod: await import(path), err: null }; } catch (err) { return { mod: null, err }; }
}
function must(r, label) {
  if (r.mod) { moduleStatus[label] = 'ok'; return r.mod; }
  moduleStatus[label] = 'failed';
  throw new BootError(`无法加载${label}`, r.err);
}
function optional(r, label, path) {
  if (r.mod) { moduleStatus[label] = 'ok'; return r.mod; }
  const syntax = r.err instanceof SyntaxError;
  moduleStatus[label] = syntax ? 'error' : 'missing';
  (syntax ? console.error : console.warn)(`[启动] ${label}（${path}）不可用，使用内置后备：`, r.err?.message || r.err);
  return null;
}
function construct(label, fn) {
  try { return fn(); } catch (err) {
    moduleStatus[label] = 'error';
    console.error(`[启动] ${label}初始化失败，使用内置后备：`, err);
    return null;
  }
}

// —— 阵容与配置 ——
function validSummoners(list, SUMMONERS) {
  if (!Array.isArray(list) || list.length !== 2 || list[0] === list[1]) return null;
  return list.every((id) => SUMMONERS[id]) ? list.slice() : null;
}
// 默认阵容：玩家英雄放到其所在默认分路（与对面同路英雄互换），其余位置按分路补齐
export function buildTeams(CHAMPIONS, championId, team = 0) {
  const ids = Object.keys(CHAMPIONS);
  const teams = DEFAULT_LINEUP.map((l) => l.slice());
  const used = new Set();
  for (const t of teams) for (let i = 0; i < 5; i++) {
    if (!CHAMPIONS[t[i]] || used.has(t[i])) t[i] = null; else used.add(t[i]);
  }
  for (const t of teams) for (let i = 0; i < 5; i++) {
    if (t[i]) continue;
    const role = ROLES[i];
    const id = ids.find((c) => !used.has(c) && (CHAMPIONS[c].roles || []).includes(role)) || ids.find((c) => !used.has(c)) || ids[i % ids.length];
    t[i] = id; used.add(id);
  }
  let pi = -1;
  if (championId && CHAMPIONS[championId]) {
    pi = teams[team].indexOf(championId);
    if (pi < 0) {
      const oi = teams[1 - team].indexOf(championId);
      if (oi >= 0) { teams[1 - team][oi] = teams[team][oi]; teams[team][oi] = championId; pi = oi; }
      else {
        pi = Math.max(0, ROLES.indexOf((CHAMPIONS[championId].roles || [])[0]));
        teams[team][pi] = championId;
      }
    }
  }
  return teams.map((list, t) => list.map((id, i) => ({
    championId: id, role: ROLES[i], isPlayer: t === team && i === pi, summoners: ROLE_SUMMONERS[ROLES[i]].slice(),
    name: t === team && i === pi ? PLAYER_NAME : undefined,
  })));
}
export function buildConfig(raw, params, CHAMPIONS, SUMMONERS = {}) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const ids = Object.keys(CHAMPIONS);
  const valid = (id) => (id && CHAMPIONS[id] ? id : null);
  let team = cfg.team === 0 || cfg.team === 1 ? cfg.team : params.team ?? 0;
  let championId = valid(cfg.championId) || valid(params.champ) || (CHAMPIONS.garen ? 'garen' : ids[0]);
  const difficulty = DIFFICULTY[cfg.difficulty] ? cfg.difficulty : params.difficulty || 'normal';
  const speed = Number.isFinite(cfg.speed) && cfg.speed > 0 ? clamp(cfg.speed, 0.1, 16) : params.speed;
  const spectate = !!(cfg.spectate || params.spectate);
  const summoners = validSummoners(cfg.summoners, SUMMONERS);
  const normTeam = (list) => (Array.isArray(list) && list.length === 5 ? list.map((e, i) => {
    const o = typeof e === 'string' ? { championId: e } : { ...(e || {}) };
    if (!valid(o.championId)) return null;
    o.role = ROLES.includes(o.role) ? o.role : ROLES[i];
    o.summoners = validSummoners(o.summoners, SUMMONERS) || ROLE_SUMMONERS[o.role].slice();
    o.isPlayer = !!o.isPlayer;
    return o;
  }) : null);
  let blue = normTeam(cfg.blue), red = normTeam(cfg.red);
  if (!blue || !red || blue.includes(null) || red.includes(null)) {
    [blue, red] = buildTeams(CHAMPIONS, championId, team);
  } else {
    // 恰好一名玩家：优先按 championId + team 匹配
    const all = [...blue.map((e) => [0, e]), ...red.map((e) => [1, e])];
    let marked = all.filter(([, e]) => e.isPlayer);
    if (marked.length !== 1) {
      for (const [, e] of all) e.isPlayer = false;
      const hit = all.find(([t, e]) => t === team && e.championId === championId) || all.find(([, e]) => e.championId === championId) || [team, (team ? red : blue)[2]];
      hit[1].isPlayer = true;
      marked = [hit];
    }
    team = marked[0][0];
    championId = marked[0][1].championId;
    if (marked[0][1].name == null) marked[0][1].name = PLAYER_NAME;
  }
  const player = [...blue, ...red].find((e) => e.isPlayer);
  if (player && summoners) player.summoners = summoners;
  return {
    championId, team, difficulty, speed, spectate,
    autopilot: !!(params.autopilot || cfg.autopilot || spectate),
    summoners: player ? player.summoners.slice() : ROLE_SUMMONERS.mid.slice(),
    blue, red,
    seed: Number.isFinite(cfg.seed) ? cfg.seed : params.seed ?? (Math.floor(Math.random() * 2147483000) + 1),
    quality: params.quality || cfg.quality || 'high',
    time: params.time || 0,
    debug: params.debug, mute: !!(params.mute || cfg.mute), reveal: params.reveal,
  };
}

// —— 头像：优先 3D 渲染，失败时用定义里的 portrait（渐变 + 字形） ——
function makePortraitRenderer(CHAMPIONS, real) {
  const cache = new Map();
  let warned = false;
  const fallback = (id, size) => {
    const key = `${id}:${size}`;
    if (cache.has(key)) return cache.get(key);
    const def = CHAMPIONS[id] || {};
    const pt = def.portrait || {};
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const bg = Array.isArray(pt.bg) ? pt.bg : ['#3a5da8', '#101a33'];
    const grd = g.createLinearGradient(0, 0, size, size);
    grd.addColorStop(0, bg[0]);
    grd.addColorStop(1, bg[1] || bg[0]);
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.arc(size * 0.5, size * 0.42, size * 0.36, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f0e6d2';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.round(size * 0.5)}px 'Noto Serif SC', 'Songti SC', serif`;
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = size * 0.05;
    g.fillText(pt.glyph || (def.name || '?').slice(0, 1), size / 2, size * 0.52);
    g.shadowBlur = 0;
    g.strokeStyle = '#c8aa6e'; g.lineWidth = Math.max(2, size * 0.03);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, size - g.lineWidth, size - g.lineWidth);
    const url = cv.toDataURL('image/png');
    cache.set(key, url);
    return url;
  };
  return async (id, size = 256) => {
    if (typeof real === 'function') {
      try {
        const url = await real(id, size);
        if (url) return url;
      } catch (err) {
        if (!warned) { warned = true; console.warn('[启动] 3D 头像渲染失败，使用字形头像：', err); }
      }
    }
    return fallback(id, size);
  };
}

// —— 后备：加载画面（沿用 index.html 的启动画面） ——
function fallbackLoading(screenRoot) {
  let el = $('boot-splash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-splash';
    el.className = 'boot-splash';
    el.innerHTML = '<div class="boot-title">峡谷对决</div><div class="boot-sub"></div><div class="boot-bar"><i></i></div>';
    screenRoot.appendChild(el);
  }
  const sub = el.querySelector('.boot-sub');
  return {
    setProgress(p, label) { if (sub) sub.textContent = `${label || '加载中'}… ${Math.round(clamp01(p) * 100)}%`; },
    close() { el.remove(); },
  };
}
async function makeLoading(csMod, screenRoot, config, CHAMPIONS, renderPortrait) {
  if (typeof csMod?.showLoadingScreen === 'function') {
    try {
      let real = csMod.showLoadingScreen(screenRoot, config, CHAMPIONS, renderPortrait);
      if (real && typeof real.then === 'function') real = await real;
      if (real && typeof real.setProgress === 'function') {
        $('boot-splash')?.remove();
        return {
          setProgress(p, label) { try { real.setProgress(clamp01(p), label); } catch (err) { reportError('loading.setProgress', err); } },
          close() { try { real.close?.(); } catch (err) { reportError('loading.close', err); } },
        };
      }
    } catch (err) {
      console.error('[启动] 加载界面出错，使用简易加载画面：', err);
    }
  }
  return fallbackLoading(screenRoot);
}

// —— 后备：地形（按 nav.terrain 着色的平面，heightAt = 0） ——
function buildFallbackTerrain(renderer, game) {
  const THREE = renderer.THREE;
  const nav = game.nav, map = game.map || {};
  const cols = nav.cols || 300, rows = nav.rows || 300, cs = nav.cellSize || 50;
  const walk = nav.terrain || nav.walk;
  const small = document.createElement('canvas');
  small.width = cols; small.height = rows;
  const sg = small.getContext('2d');
  const img = sg.createImageData(cols, rows);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = (c + 0.5) * cs, y = (r + 0.5) * cs;
      let col;
      if (!walk || !walk[i]) col = [46, 60, 36];
      else if (map.isInRiver?.(x, y)) col = [58, 150, 146];
      else if (map.isInBase?.(0, x, y)) col = [150, 148, 128];
      else if (map.isInBase?.(1, x, y)) col = [112, 98, 110];
      else col = [79, 125, 58];
      const n = (rnd() - 0.5) * 10;
      const o = ((rows - 1 - r) * cols + c) * 4;   // 北（+y）在图像上方
      img.data[o] = clamp(col[0] + n, 0, 255);
      img.data[o + 1] = clamp(col[1] + n, 0, 255);
      img.data[o + 2] = clamp(col[2] + n, 0, 255);
      img.data[o + 3] = 255;
    }
  }
  sg.putImageData(img, 0, 0);
  const S = 2048;
  const big = document.createElement('canvas');
  big.width = big.height = S;
  const g = big.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(small, 0, 0, S, S);
  const k = S / MAP_SIZE;
  const px = (x) => x * k, py = (y) => (MAP_SIZE - y) * k;
  // 兵线石板路
  const lanes = map.DECOR?.lanePaths || Object.entries(map.LANE_CENTERLINES || {}).map(([lane, pts]) => ({ lane, pts, w: 620 }));
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pass of [[1, 'rgba(120,100,70,0.55)'], [0.82, 'rgba(165,139,92,0.9)']]) {
    for (const l of lanes) {
      if (!l.pts || l.pts.length < 2) continue;
      g.strokeStyle = pass[1];
      g.lineWidth = (l.w || 620) * k * pass[0];
      g.beginPath();
      l.pts.forEach(([x, y], i) => (i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y))));
      g.stroke();
    }
  }
  // 草丛
  g.fillStyle = 'rgba(30,72,30,0.9)';
  for (const b of map.BRUSHES || []) {
    if (!b.poly || b.poly.length < 3) continue;
    g.beginPath();
    b.poly.forEach(([x, y], i) => (i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y))));
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(big);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.webgl.capabilities.getMaxAnisotropy?.() || 1);
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
  geo.rotateX(-Math.PI / 2);
  geo.translate(MAP_SIZE / 2, 0, -MAP_SIZE / 2);
  const matl = new THREE.MeshLambertMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, matl);
  mesh.receiveShadow = true;
  mesh.name = 'fallback-terrain';
  const outerGeo = new THREE.PlaneGeometry(MAP_SIZE + 12000, MAP_SIZE + 12000);
  outerGeo.rotateX(-Math.PI / 2);
  outerGeo.translate(MAP_SIZE / 2, -3, -MAP_SIZE / 2);
  const outerMat = new THREE.MeshLambertMaterial({ color: 0x1d2a17 });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  const parent = renderer.groups?.world || renderer.scene;
  parent.add(outer, mesh);
  return {
    isFallback: true,
    mesh,
    heightAt() { return 0; },
    update() {},
    dispose() {
      parent.remove(mesh, outer);
      geo.dispose(); matl.dispose(); tex.dispose(); outerGeo.dispose(); outerMat.dispose();
    },
  };
}

// —— 后备：视图工厂（模型模块整体不可用时） ——
function fallbackViewFactory(THREE) {
  return (e, renderer) => {
    const playerTeam = renderer?.playerTeam ?? 0;
    const h = { champion: 220, pet: 260, turret: 520, inhibitor: 260, nexus: 480, ward: 90 }[e.type] || (e.epic ? 360 : 120);
    const r = clamp((e.radius || 50) * 0.8, 20, 180);
    const color = e.team === 2 ? 0xd9a441 : e.team === playerTeam ? 0x3a8fe0 : 0xd84a4a;
    const geo = new THREE.CylinderGeometry(r * 0.6, r * 0.8, h, 10);
    geo.translate(0, h / 2, 0);
    const matl = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geo, matl);
    mesh.castShadow = true;
    return {
      object3d: mesh, height: h,
      update() {},
      setOpacity(a) { matl.transparent = a < 1; matl.opacity = a; },
      dispose() { geo.dispose(); matl.dispose(); },
    };
  };
}

// —— 后备：空输入 / 空音频 ——
function makeNullInput(game) {
  return {
    isNull: true, enabled: true, hoverUnit: null, selectedUnit: null, pendingCast: null, attackMoveArmed: false,
    mouse: { x: 0, y: 0, clientX: 0, clientY: 0, gx: game.player?.x ?? 0, gy: game.player?.y ?? 0, overUI: false, inside: false },
    settings: { castMode: 'quickIndicator', edgePan: true },
    on() { return () => {}; }, update() {}, setSettings() {}, beginCast() { return false; }, cancel() {}, dispose() {},
  };
}
const NULL_AUDIO = Object.freeze({ isNull: true, unlock() {}, update() {}, setVolume() {}, setMuted() {}, dispose() {} });

// —— 后备：极简中文 HUD（UI 模块不可用时） ——
const FB_CSS = `
.fb-root{position:absolute;inset:0;pointer-events:none;font-family:var(--font-body);color:#f0e6d2}
.fb-hud{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));padding:10px 14px 8px;background:rgba(1,10,19,.9);border:1px solid #785a28;box-shadow:0 0 0 1px #000,0 8px 30px rgba(0,0,0,.5);display:grid;grid-template-columns:auto 1fr auto;gap:6px 14px;align-items:center;pointer-events:auto}
.fb-name{font:900 15px var(--font-title);color:#c8aa6e}
.fb-lv{display:inline-block;min-width:24px;margin-left:6px;padding:0 4px;border:1px solid #c8aa6e;text-align:center;font:600 13px var(--font-num)}
.fb-bars{display:flex;flex-direction:column;gap:3px}
.fb-bar{position:relative;height:14px;background:#10151a;border:1px solid #2d3238;overflow:hidden}
.fb-bar>i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(#5fd13b,#2f8a1c)}
.fb-bar.mana>i{background:linear-gradient(#4b9bff,#1d5fbf)}.fb-bar.energy>i{background:linear-gradient(#ffe066,#c9a21a)}
.fb-bar.xp{height:4px;border:0}.fb-bar.xp>i{background:#a45ee6}
.fb-bar>span{position:absolute;inset:0;text-align:center;font:600 11px/14px var(--font-num);text-shadow:0 1px 1px #000}
.fb-gold{font:700 17px var(--font-num);color:#ffd34d;text-align:right;white-space:nowrap}
.fb-skills{grid-column:1/-1;display:flex;gap:6px;justify-content:center}
.fb-sk{position:relative;width:46px;height:46px;border:1px solid #785a28;background:linear-gradient(#1a2a44,#0a1428);display:flex;align-items:center;justify-content:center;font:700 16px var(--font-title);cursor:pointer}
.fb-sk.gap{margin-left:10px}.fb-sk.off{filter:grayscale(1) brightness(.45)}
.fb-sk[data-cd]:not([data-cd=""])::after{content:attr(data-cd);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.62);font:700 15px var(--font-num);color:#fff}
.fb-sk b{position:absolute;left:3px;top:1px;font:600 10px var(--font-num);color:#a09b8c}
.fb-sk em{position:absolute;right:3px;bottom:1px;font:600 10px var(--font-num);font-style:normal;color:#0ac8b9}
.fb-tip{grid-column:1/-1;font-size:11px;color:#a09b8c;text-align:center;line-height:1.5}
.fb-top{position:absolute;top:8px;right:12px;padding:5px 12px;background:rgba(1,10,19,.82);border:1px solid #785a28;font:600 14px var(--font-num);white-space:nowrap}
.fb-top .b{color:#4fa8ff}.fb-top .r{color:#ff5a5a}
.fb-banner{position:absolute;top:15%;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);font:900 28px var(--font-title);letter-spacing:.08em;text-align:center;text-shadow:0 0 12px rgba(0,0,0,.95),0 0 28px rgba(200,170,110,.45);opacity:0;transition:opacity .3s}
.fb-banner.on{opacity:1}
.fb-dead{position:absolute;inset:0;display:none;justify-content:center;padding-top:22vh;background:rgba(30,30,30,.35);font:900 26px var(--font-title);color:#e8e2d0;text-shadow:0 0 10px #000}
.fb-end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(ellipse at 50% 45%,rgba(10,20,40,.82),rgba(1,10,19,.96));pointer-events:auto}
.fb-end-title{font:900 76px var(--font-title);letter-spacing:.3em;color:#c8aa6e;text-shadow:0 0 30px rgba(200,170,110,.5)}
.fb-end.lose .fb-end-title{color:#b0413e;text-shadow:0 0 30px rgba(176,65,62,.5)}
.fb-end-sub{color:#a09b8c;font-size:15px}
.fb-end button{font:600 16px var(--font-body);color:#f0e6d2;background:#1e2328;border:1px solid #c8aa6e;padding:10px 36px;cursor:pointer}
.fb-end button:hover{background:#2a2f36}
@media (max-width:640px){.fb-hud{grid-template-columns:1fr auto}.fb-who{grid-column:1/-1}.fb-sk{width:40px;height:40px}.fb-tip{display:none}}
`;
class FallbackUI {
  constructor(game, renderer, input, { root, screenRoot, shop, items, onRestart }) {
    this.game = game; this.renderer = renderer; this.input = input;
    this.shop = shop; this.items = items || {}; this.onRestart = onRestart; this.screenRoot = screenRoot;
    this.isFallback = true;
    if (!$('fb-style')) {
      const st = document.createElement('style');
      st.id = 'fb-style';
      st.textContent = FB_CSS;
      document.head.appendChild(st);
    }
    const el = this.el = document.createElement('div');
    el.className = 'fb-root';
    el.innerHTML = `<div class="fb-top"></div><div class="fb-banner"></div><div class="fb-dead"></div>
      <div class="fb-hud"><div class="fb-who"><span class="fb-name"></span><span class="fb-lv"></span></div>
      <div class="fb-bars"><div class="fb-bar hp"><i></i><span></span></div><div class="fb-bar mana"><i></i><span></span></div><div class="fb-bar xp"><i></i></div></div>
      <div class="fb-gold"></div><div class="fb-skills"></div>
      <div class="fb-tip">简易界面（完整 HUD 未加载）· 右键移动/攻击 · QWER 施法 · Ctrl+QWER 升级 · D/F 召唤师技能 · B 回城 · P 在泉水自动购买推荐装备 · Y 锁定镜头 · Esc 暂停</div></div>`;
    root.appendChild(el);
    const q = (s) => el.querySelector(s);
    this.$ = { top: q('.fb-top'), banner: q('.fb-banner'), dead: q('.fb-dead'), hud: q('.fb-hud'), name: q('.fb-name'), lv: q('.fb-lv'),
      hp: q('.fb-bar.hp'), mana: q('.fb-bar.mana'), xp: q('.fb-bar.xp'), gold: q('.fb-gold'), skills: q('.fb-skills') };
    this.slots = [];
    for (const [kind, slot] of [['ability', 'Q'], ['ability', 'W'], ['ability', 'E'], ['ability', 'R'], ['summoner', 'D'], ['summoner', 'F']]) {
      const b = document.createElement('div');
      b.className = 'fb-sk' + (slot === 'D' ? ' gap' : '');
      b.innerHTML = `<b>${slot}</b><span></span><em></em>`;
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.ctrlKey && kind === 'ability') input.levelUp?.(slot); else input.beginCast?.(kind, slot);
      });
      this.$.skills.appendChild(b);
      this.slots.push({ kind, slot, el: b, glyph: b.querySelector('span'), rank: b.querySelector('em') });
    }
    this._acc = 1;
    this._bannerUntil = 0;
    this._paused = false;
    this._unsubs = [
      game.events.on('announce', (e) => this._announce(e)),
      game.events.on('gameOver', (e) => this._gameOver(e?.winner)),
      input.on('toggleShop', () => this._quickShop()),
      input.on('escape', () => this._togglePause()),
    ];
  }
  _banner(text, seconds = 3) {
    this.$.banner.textContent = text;
    this.$.banner.classList.add('on');
    this._bannerUntil = seconds === Infinity ? Infinity : performance.now() + seconds * 1000;
  }
  _announce(e) {
    if (!e) return;
    const team = this.game.player?.team ?? 0;
    let text = e.text;
    if (e.key === 'victory' || e.key === 'defeat') text = (e.key === 'victory' ? e.team === team : e.team !== team) ? '胜利' : '失败';
    if (text) this._banner(text, 3);
  }
  _quickShop() {
    const p = this.game.player;
    if (!p) return;
    if (!p.canShop) { this._banner('只能在泉水或阵亡时购买装备', 2); return; }
    if (typeof this.shop?.autoShop !== 'function') { this._banner('商店模块不可用', 2); return; }
    const bought = this.shop.autoShop(p) || [];
    this._banner(bought.length ? `已购买：${bought.map((id) => this.items[id]?.name || id).join('、')}` : '金币不足或没有可购买的推荐装备', 2.5);
  }
  _togglePause() {
    if (this.game.over) return;
    this.game.paused = !this.game.paused;
    if (this.game.paused) this._banner('已暂停 · 按 Esc 继续', Infinity);
    else { this._bannerUntil = 0; this.$.banner.classList.remove('on'); }
  }
  _gameOver(winner) {
    const g = this.game;
    const team = g.player?.team ?? 0;
    const win = winner === team;
    setTimeout(() => {
      const d = document.createElement('div');
      d.className = `fb-end ${win ? 'win' : 'lose'}`;
      d.innerHTML = `<div class="fb-end-title">${win ? '胜利' : '失败'}</div>
        <div class="fb-end-sub">比赛用时 ${fmtTime(g.time)} · 击杀 ${g.teams[team].kills} : ${g.teams[1 - team].kills}</div>
        <button type="button">再来一局</button>`;
      d.querySelector('button').addEventListener('click', () => this.onRestart?.());
      this.screenRoot.appendChild(d);
    }, 2500);
  }
  update(dt) {
    if (this._bannerUntil !== Infinity && this._bannerUntil && performance.now() > this._bannerUntil) {
      this._bannerUntil = 0;
      this.$.banner.classList.remove('on');
    }
    this._acc += dt;
    if (this._acc < 0.1) return;
    this._acc = 0;
    const g = this.game, p = g.player;
    const $$ = this.$;
    let top = `<span class="b">${g.teams[0].kills}</span> : <span class="r">${g.teams[1].kills}</span> &nbsp; ${fmtTime(g.time)}`;
    if (p) top += ` &nbsp; ${p.kills}/${p.deaths}/${p.assists} &nbsp; 补刀 ${p.cs}`;
    if (g.speed !== 1) top += ` &nbsp; ×${g.speed}`;
    $$.top.innerHTML = top;
    if (!p) { $$.hud.style.display = 'none'; return; }
    $$.name.textContent = p.def?.name || p.displayName || p.name || '';
    $$.lv.textContent = p.level;
    const hpK = p.maxHp > 0 ? clamp01(p.hp / p.maxHp) : 0;
    $$.hp.firstElementChild.style.width = `${hpK * 100}%`;
    $$.hp.lastElementChild.textContent = `${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}`;
    const res = p.resourceType;
    $$.mana.style.display = res === 'none' ? 'none' : '';
    $$.mana.className = `fb-bar ${res === 'energy' ? 'energy' : 'mana'}`;
    if (res !== 'none') {
      $$.mana.firstElementChild.style.width = `${(p.maxMana > 0 ? clamp01(p.mana / p.maxMana) : 0) * 100}%`;
      $$.mana.lastElementChild.textContent = `${Math.floor(p.mana)} / ${Math.floor(p.maxMana)}`;
    }
    $$.xp.firstElementChild.style.width = `${clamp01(p.xpProgress || 0) * 100}%`;
    $$.gold.textContent = `${Math.floor(p.gold)} 金`;
    for (const s of this.slots) {
      let cd = 0, off = false, rank = '', glyph = '';
      if (s.kind === 'ability') {
        const st = p.abilities?.[s.slot];
        if (st) {
          off = st.rank <= 0;
          cd = st.isRecastActive ? 0 : st.cdRemaining || 0;
          rank = st.rank > 0 ? String(st.rank) : (p.canLevelAbility?.(s.slot) ? '+' : '');
          glyph = st.def?.icon?.glyph || (st.def?.name || '').slice(0, 1);
        }
      } else {
        const st = p.summoners?.[s.slot];
        if (st) {
          cd = Math.max(0, (st.cooldownUntil || 0) - g.time);
          if (st.charges > 0) cd = 0;
          glyph = st.def?.icon?.glyph || (st.def?.name || '').slice(0, 1);
        }
      }
      s.el.classList.toggle('off', off);
      s.el.dataset.cd = cd > 0.05 ? (cd < 1 ? cd.toFixed(1) : String(Math.ceil(cd))) : '';
      if (s.glyph.textContent !== glyph) s.glyph.textContent = glyph;
      s.rank.textContent = rank;
    }
    if (!p.alive) {
      $$.dead.style.display = 'flex';
      $$.dead.textContent = `阵亡 · ${Math.ceil(p.respawnRemaining || 0)} 秒后复活`;
    } else $$.dead.style.display = 'none';
  }
  dispose() {
    for (const u of this._unsubs) { try { u?.(); } catch { /* 忽略 */ } }
    this.el.remove();
  }
}

// —— 调试面板（debug=1） ——
function makeDebug(app, ctx) {
  const el = document.createElement('div');
  el.className = 'debug-panel';
  el.style.whiteSpace = 'pre';
  app.appendChild(el);
  let acc = 1;
  window.addEventListener('keydown', (e) => {
    const g = ctx.game;
    if (e.code === 'Equal' || e.code === 'NumpadAdd') g.speed = Math.min(16, g.speed * 2);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') g.speed = Math.max(0.125, g.speed / 2);
    else if (e.code === 'F9') { e.preventDefault(); ctx.renderer.revealAll = !ctx.renderer.revealAll; }
    else if (e.code === 'F8') { e.preventDefault(); g.paused = !g.paused; }
  });
  return (dt) => {
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;
    const g = ctx.game, pf = ctx.perf, info = ctx.renderer.webgl?.info?.render || {};
    const miss = Object.entries(moduleStatus).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}:${v}`).join(' ') || '全部正常';
    el.textContent = `FPS ${pf.fps.toFixed(0)}  帧 ${pf.frameMs.toFixed(1)}ms  模拟 ${pf.simMs.toFixed(1)}  渲染 ${pf.renderMs.toFixed(1)}  UI ${pf.uiMs.toFixed(1)}\n`
      + `时间 ${fmtTime(g.time)}  倍速 ×${g.speed}${g.paused ? '（暂停）' : ''}  种子 ${g.seed}\n`
      + `英雄 ${g.champions.length}  小兵 ${g.minions.length}  野怪 ${g.monsters.length}  投射物 ${g.projectiles.length}  区域 ${g.zones.length}\n`
      + `Draw ${info.calls ?? '-'}  三角形 ${info.triangles ?? '-'}  视图 ${ctx.renderer.views?.size ?? '-'}\n`
      + `模块：${miss}\n+/- 调整倍速 · F8 暂停 · F9 全图显示`;
  };
}

// —— 无渲染快进（time=N） ——
async function fastForward(game, target, createAI, onProgress) {
  const p = game.player;
  let tempAI = false;
  if (p && !p.controller && typeof createAI === 'function') {
    try { p.controller = createAI(p, game, { role: p.role, difficulty: game.difficulty }); tempAI = true; } catch (err) { console.warn('[启动] 快进期间无法为玩家挂载 AI：', err); }
  }
  const start = game.time, total = Math.max(1e-3, target - start);
  while (game.time < target && !game.over) {
    const t0 = performance.now();
    while (game.time < target && !game.over && performance.now() - t0 < 40) game.step(TICK);
    onProgress(clamp01((game.time - start) / total), game.time);
    await yieldTask();
  }
  if (tempAI) { p.controller = null; p.stop?.(); }
}

// —— 启动 ——
async function boot() {
  const params = parseParams();
  const screenRoot = $('screen-root'), gameRoot = $('game-root'), uiRoot = $('ui-root'), app = $('app') || document.body;
  let loading = fallbackLoading(screenRoot);
  loading.setProgress(0.02, '正在加载游戏模块');

  // 首次用户手势解锁音频（音频对象可能稍后才创建）
  let audioRef = null, audioUnlocked = false, gestured = false;
  const tryUnlock = () => {
    if (audioUnlocked || !audioRef) return;
    try { audioRef.unlock(); audioUnlocked = true; } catch (err) { console.warn('[音频] 解锁失败：', err); }
  };
  const onGesture = () => {
    gestured = true;
    tryUnlock();
    if (audioUnlocked) for (const t of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(t, onGesture, true);
  };
  for (const t of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(t, onGesture, true);

  // 并行加载全部模块
  const L = {
    game: load('./core/game.js'), champions: load('./champions/index.js'), summoners: load('./core/summoners.js'),
    renderer: load('./render/renderer.js'), models: load('./render/models/index.js'), champModels: load('./render/models/champions.js'),
    ai: load('./ai/championAI.js'), items: load('./items/items.js'), shop: load('./items/shop.js'),
    champfx: load('./render/champfx/index.js'), input: load('./input/input.js'),
    terrain: load('./render/terrain.js'), fog: load('./render/fogrender.js'), fx: load('./render/fx.js'),
    overlay: load('./render/overlay.js'), indicators: load('./render/indicators.js'),
    champselect: load('./ui/champselect.js'), ui: load('./ui/ui.js'), audio: load('./audio/audio.js'),
  };
  const { Game } = must(await L.game, '模拟核心（js/core/game.js）');
  const { CHAMPIONS } = must(await L.champions, '英雄数据（js/champions/index.js）');
  const SUMMONERS = optional(await L.summoners, '召唤师技能', 'js/core/summoners.js')?.SUMMONERS || {};
  loading.setProgress(0.06, '正在加载渲染器');
  const rendererMod = must(await L.renderer, '渲染器（js/render/renderer.js，需要连接 cdn.jsdelivr.net 下载 Three.js）');
  const champModels = optional(await L.champModels, '英雄模型', 'js/render/models/champions.js');
  const renderPortrait = makePortraitRenderer(CHAMPIONS, champModels?.renderChampionPortrait);

  // 1) 选人（autostart=1 或选人界面不可用时直接用 URL 参数/默认配置）
  const csMod = optional(await L.champselect, '选人界面', 'js/ui/champselect.js');
  let picked = null;
  if (!params.autostart && typeof csMod?.showChampSelect === 'function') {
    loading.close();
    try {
      picked = await csMod.showChampSelect(screenRoot, {
        champions: CHAMPIONS, summoners: SUMMONERS, renderPortrait,
        defaults: { championId: params.champ, team: params.team ?? 0, difficulty: params.difficulty || 'normal', speed: params.speed, spectate: params.spectate },
      });
    } catch (err) {
      console.error('[启动] 选人界面出错，使用默认配置开局：', err);
    }
  }
  const config = buildConfig(picked, params, CHAMPIONS, SUMMONERS);
  window.__config = config;

  // 2) 加载画面
  loading = await makeLoading(csMod, screenRoot, config, CHAMPIONS, renderPortrait);
  loading.setProgress(0.08, '正在生成召唤师峡谷');
  await nextFrame();

  const aiMod = optional(await L.ai, 'AI', 'js/ai/championAI.js');
  const itemsMod = optional(await L.items, '装备', 'js/items/items.js');
  const shopMod = optional(await L.shop, '商店', 'js/items/shop.js');
  const createAI = typeof aiMod?.createAI === 'function' ? aiMod.createAI : null;

  const game = new Game({
    blue: config.blue, red: config.red, champions: CHAMPIONS, createAI,
    difficulty: config.difficulty, speed: 1, seed: config.seed, headless: false, fx: null, autopilot: config.autopilot,
  });
  if (typeof itemsMod?.recomputeItemStats === 'function') game.recomputeItemStats = itemsMod.recomputeItemStats;
  window.__game = game;

  if (config.time > 0) {
    await fastForward(game, config.time, createAI, (p, t) => loading.setProgress(0.1 + 0.2 * p, `正在快进到 ${fmtTime(config.time)}（${fmtTime(t)}）`));
  }
  game.speed = config.speed;

  // 3) 渲染器与视图
  loading.setProgress(0.3, '正在初始化 3D 渲染');
  let renderer;
  try {
    renderer = new rendererMod.Renderer(game, gameRoot, { quality: config.quality });
  } catch (err) {
    throw new BootError('无法初始化 3D 渲染（WebGL）：请确认浏览器支持 WebGL 并已开启硬件加速', err);
  }
  window.__renderer = renderer;
  const THREE = renderer.THREE;
  const modelsMod = optional(await L.models, '模型', 'js/render/models/index.js');
  renderer.setViewFactory(typeof modelsMod?.createView === 'function' ? modelsMod.createView : fallbackViewFactory(THREE));
  if (config.spectate) renderer.cameraCtl.setLocked(false);
  if (config.reveal) renderer.revealAll = true;

  // 4) 特效
  const fxMod = optional(await L.fx, '特效', 'js/render/fx.js');
  let fx = typeof fxMod?.FX === 'function' ? construct('特效', () => new fxMod.FX(renderer, game)) : null;
  if (fx) {
    game.fx = fx;
    renderer.fx = fx;
    const cfx = optional(await L.champfx, '英雄特效', 'js/render/champfx/index.js');
    if (typeof cfx?.registerChampionFX === 'function') construct('英雄特效', () => cfx.registerChampionFX(fx));
  } else {
    fx = game.fx;   // core 的 NullFX
  }
  window.__fx = fx;

  // 5) 地形
  loading.setProgress(0.34, '正在构建地形');
  const terrainMod = optional(await L.terrain, '地形', 'js/render/terrain.js');
  let terrain = null;
  if (typeof terrainMod?.Terrain === 'function') {
    try {
      terrain = new terrainMod.Terrain(renderer, game);
      await terrain.build((p, label) => loading.setProgress(0.34 + 0.46 * clamp01(Number(p) || 0), label || '正在构建地形'));
      moduleStatus['地形'] = 'ok';
    } catch (err) {
      moduleStatus['地形'] = 'error';
      console.error('[启动] 地形构建失败，使用简易地形：', err);
      terrain = null;
    }
  }
  if (!terrain) terrain = buildFallbackTerrain(renderer, game);
  renderer.setTerrain(terrain);
  window.__terrain = terrain;

  // 6) 迷雾 / 输入 / 覆盖层 / 指示器
  loading.setProgress(0.82, '正在准备战争迷雾与界面');
  await nextFrame();
  const fogMod = optional(await L.fog, '战争迷雾', 'js/render/fogrender.js');
  const fog = typeof fogMod?.FogRenderer === 'function' ? construct('战争迷雾', () => new fogMod.FogRenderer(renderer, game, terrain)) : null;
  const inputMod = optional(await L.input, '输入', 'js/input/input.js');
  const input = (typeof inputMod?.Input === 'function' && construct('输入', () => new inputMod.Input(game, renderer, { root: gameRoot }))) || makeNullInput(game);
  window.__input = input;
  const overlayMod = optional(await L.overlay, '血条覆盖层', 'js/render/overlay.js');
  const overlay = typeof overlayMod?.Overlay === 'function' ? construct('血条覆盖层', () => new overlayMod.Overlay(renderer, game, gameRoot)) : null;
  const indMod = optional(await L.indicators, '技能指示器', 'js/render/indicators.js');
  const indicators = typeof indMod?.Indicators === 'function' ? construct('技能指示器', () => new indMod.Indicators(renderer, game, input)) : null;
  for (const sys of [fog, fx && !fx.isNull ? fx : null, indicators, overlay]) {
    if (sys && typeof sys.update === 'function') renderer.addSystem(sys);
  }
  window.__overlay = overlay;
  window.__indicators = indicators;
  window.__fog = fog;

  // 7) 音频
  const audioMod = optional(await L.audio, '音频', 'js/audio/audio.js');
  const audio = (typeof audioMod?.AudioSystem === 'function' && construct('音频', () => new audioMod.AudioSystem(game, renderer, { muted: config.mute }))) || NULL_AUDIO;
  audioRef = audio;
  window.__audio = audio;
  if (gestured || navigator.userActivation?.hasBeenActive) tryUnlock();

  // 8) UI
  const restart = () => { try { location.reload(); } catch { location.href = String(location.href); } };
  window.__restart = restart;
  loading.setProgress(0.9, '正在加载界面');
  const uiMod = optional(await L.ui, '界面', 'js/ui/ui.js');
  let ui = typeof uiMod?.UI === 'function' ? construct('界面', () => new uiMod.UI(game, renderer, input, {
    root: uiRoot, audio, champions: CHAMPIONS, summoners: SUMMONERS, items: itemsMod?.ITEMS || {}, shop: shopMod,
    renderPortrait, screenRoot, config, onRestart: restart,
  })) : null;
  if (!ui) ui = new FallbackUI(game, renderer, input, { root: uiRoot, screenRoot, shop: shopMod, items: itemsMod?.ITEMS, onRestart: restart });
  window.__ui = ui;

  // 9) 预热一帧（编译着色器）后进入游戏
  loading.setProgress(0.97, '即将进入召唤师峡谷');
  await nextFrame();
  guard('warmup', () => renderer.render(0));
  loading.setProgress(1, '欢迎来到召唤师峡谷');
  await nextFrame();
  loading.close();
  $('boot-splash')?.remove();
  document.body.classList.add('in-game');
  window.__modules = moduleStatus;

  // 10) 主循环
  const perf = { frameMs: 0, simMs: 0, renderMs: 0, uiMs: 0, fps: 60, dtMs: 16.7, frames: 0 };
  window.__perf = perf;
  const dbg = config.debug ? makeDebug(app, { game, renderer, perf }) : null;
  const EMA = 0.08;
  const ema = (a, b) => a + (b - a) * EMA;
  let last = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const realDt = last ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 1 / 60;
    last = now;
    const t0 = performance.now();
    guard('input', () => input.update(realDt));
    guard('game', () => game.update(realDt));
    const t1 = performance.now();
    guard('render', () => renderer.render(realDt));
    const t2 = performance.now();
    guard('ui', () => ui.update(realDt));
    guard('audio', () => audio.update(realDt));
    const t3 = performance.now();
    perf.simMs = ema(perf.simMs, t1 - t0);
    perf.renderMs = ema(perf.renderMs, t2 - t1);
    perf.uiMs = ema(perf.uiMs, t3 - t2);
    perf.frameMs = ema(perf.frameMs, t3 - t0);
    if (realDt > 0) perf.dtMs = ema(perf.dtMs, realDt * 1000);
    perf.fps = perf.dtMs > 0 ? 1000 / perf.dtMs : 0;
    perf.frames++;
    if (dbg) guard('debug', () => dbg(realDt));
  };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  const title = err instanceof BootError ? err.title : '游戏启动失败';
  showFatal(title, err);
});
