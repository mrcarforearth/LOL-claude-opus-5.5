// 键鼠输入 → 命令（core）：LoL 默认键位、三种施法模式、智能目标选择、右键按住持续移动、A 攻击移动、镜头控制、设置持久化
//
// 【给 UI / 指示器代理】
//  事件（input.on(name, fn) → 取消订阅函数）：
//    'command'     { type: 'move'|'attack'|'attackMove'|'stop'|'recall'|'cast'|'levelUp', x, y, target, kind?, slot?, key?, ok?, reason? }
//    'castFail'    { kind, slot, key, reason }        reason 同 castAbility（rank/cooldown/cost/cc/target/range/dead/busy/empty/passive）
//    'castCancel'  { kind, slot }                     指示器被右键/Esc/失焦取消
//    'toggleShop'  {}        'scoreboard' { down }    'escape' {}（无待施法/攻击移动时才发）
//    'ping'        { x, y, kind, target }            （同时已向 game.events 发出 'ping'，UI 不要再转发）
//    'select'      { unit }  左键选中单位（UI 显示目标信息）    'cameraLock' { locked }
//  pendingCast = { kind: 'ability'|'summoner'|'item'|'trinket', slot, key, def, state, targeting, range, indicator, filter, mode }
//    def：技能/召唤师技能/装备定义；range/targeting/indicator 已归一化（装备主动、饰品也有），指示器直接读这三个字段即可。
//  UI 可调用：setSettings(patch)、beginCast(kind, slot)（HUD 点击技能图标 = 常规施法：随后左键施放）、cancel()、
//    commandMove(x, y) / commandAttackMove(x, y)（小地图右键）、levelUp(slot)、useSlot(kind, slot)。
//  enabled = false（商店/菜单打开）时只响应 P / Esc / Tab。玩家阵亡时只保留镜头键、UI 键与 Ctrl+QWER 加点。
import { TRINKET, MAP_SIZE } from '../config.js';

const SETTINGS_KEY = 'riftclash.input.v1';
export const CAST_MODES = ['quickIndicator', 'quick', 'normal'];
export const CAST_MODE_LABELS = { quickIndicator: '带指示器的快捷施法', quick: '快捷施法', normal: '常规施法' };
export const DEFAULT_INPUT_SETTINGS = Object.freeze({
  castMode: 'quickIndicator',   // 默认：按下显示指示器，松开施放
  edgePan: true,                // 屏幕边缘平移（镜头未锁定时）
  attackMoveOnCursor: false,    // true：按 A 立即向光标攻击移动
  smartTargetRadius: 250,       // 指向技能：鼠标附近多少码内自动选取最近合法目标
  holdRepeat: 0.12,             // 右键按住时重新下达移动命令的间隔（秒）
});

const ABILITY_KEYS = { KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R' };
const SUMMONER_KEYS = { KeyD: 'D', KeyF: 'F' };
const ITEM_KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit5: 3, Digit6: 4, Digit7: 5, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad5: 3, Numpad6: 4, Numpad7: 5 };
const ITEM_KEY_LABELS = ['1', '2', '3', '5', '6', '7'];
const TRINKET_CODES = new Set(['Digit4', 'Numpad4']);
const ATTACKABLE = new Set(['champion', 'minion', 'monster', 'pet', 'turret', 'inhibitor', 'nexus', 'ward']);
const UNIT_TYPES = new Set(['champion', 'minion', 'monster', 'pet']);
const PING_COOLDOWN_MS = 650;

// —— 光标（SVG 数据 URI；金色箭头 / 红色攻击 / 青色施法准星） ——
function svgCursor(svg, hx, hy, fallback) {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
}
const ARROW = (fill, stroke) => `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M3 2 L3 22 L8.5 17 L12.5 26 L16 24.4 L12 15.6 L19.5 15.6 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 6.5 L5 17.5 L8.8 14 Z" fill="rgba(255,255,255,0.35)"/></svg>`;
const CURSORS = {
  default: svgCursor(ARROW('#c8aa6e', '#1a1206'), 3, 2, 'default'),
  attack: svgCursor(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M3 2 L3 22 L8.5 17 L12.5 26 L16 24.4 L12 15.6 L19.5 15.6 Z" fill="#e0443a" stroke="#2a0503" stroke-width="1.6" stroke-linejoin="round"/><path d="M17 17 l8 8 M25 17 l-8 8" stroke="#ffd0c8" stroke-width="2.2" stroke-linecap="round"/></svg>`, 3, 2, 'crosshair'),
  cast: svgCursor(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="none" stroke="#0ac8b9" stroke-width="2"/><circle cx="16" cy="16" r="1.8" fill="#e8fffc"/><path d="M16 2 v7 M16 23 v7 M2 16 h7 M23 16 h7" stroke="#0ac8b9" stroke-width="2" stroke-linecap="round"/></svg>`, 16, 16, 'crosshair'),
};

function isTypingTarget(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = (el.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes(t);
  }
  return !!el.isContentEditable;
}

function loadSettings() {
  const s = { ...DEFAULT_INPUT_SETTINGS };
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        for (const k of Object.keys(DEFAULT_INPUT_SETTINGS)) {
          if (k in o && typeof o[k] === typeof DEFAULT_INPUT_SETTINGS[k]) s[k] = o[k];
        }
      }
    }
  } catch { /* 隐私模式/禁用存储：使用默认设置 */ }
  if (!CAST_MODES.includes(s.castMode)) s.castMode = DEFAULT_INPUT_SETTINGS.castMode;
  return s;
}

// 与 Champion._targetOk 相同的目标过滤规则（filter 可为函数 (champ, target) => bool）
function targetOk(champ, filter, t) {
  if (!champ || !t || !t.alive || t.removed) return false;
  if (typeof filter === 'function') { try { return !!filter(champ, t); } catch { return false; } }
  const enemy = t.team !== champ.team;
  const unit = UNIT_TYPES.has(t.type);
  const vis = () => (typeof t.isTargetableBy === 'function' ? t.isTargetableBy(champ) : !t.untargetable);
  switch (filter || 'enemy') {
    case 'enemy': return enemy && unit && vis();
    case 'enemyChampion': return enemy && t.type === 'champion' && vis();
    case 'ally': return !enemy && unit && !t.untargetable;
    case 'allyChampion': return !enemy && t.type === 'champion' && !t.untargetable;
    case 'any': return unit && (enemy ? vis() : !t.untargetable);
    default: return false;
  }
}

function defaultIndicator(targeting, range) {
  switch (targeting) {
    case 'unit': return { type: 'unit' };
    case 'point': return { type: 'circle', radius: 80 };
    case 'direction': return { type: 'line', width: 80, length: range || 600 };
    default: return { type: 'self', radius: 100 };
  }
}

export class Input {
  constructor(game, renderer, { root } = {}) {
    this.game = game;
    this.renderer = renderer;
    this.root = root || renderer?.container || document.body;
    this.enabled = true;
    const p = game?.player;
    this.mouse = { x: 0, y: 0, clientX: 0, clientY: 0, gx: p ? p.x : MAP_SIZE / 2, gy: p ? p.y : MAP_SIZE / 2, overUI: false, inside: false };
    this.hoverUnit = null;
    this.selectedUnit = null;
    this.pendingCast = null;
    this.attackMoveArmed = false;
    this.championsOnly = false;          // 按住 ` 键：只选取英雄
    this.settings = loadSettings();
    this.keys = new Set();
    this._listeners = new Map();
    this._dom = [];
    this._mouseSeen = false;
    this._rightHeld = false;
    this._rightMove = false;
    this._holdTimer = 0;
    this._lastMove = { x: 0, y: 0 };
    this._midDrag = null;
    this._lastPingAt = -1e9;
    this._cursor = '';
    this._errAt = new Map();
    this._disposed = false;
    this._bind();
    this._applySettings();
    this._setCursor('default');
  }

  get player() { return this.game ? this.game.player : null; }

  // —— 事件 ——
  on(name, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = this._listeners.get(name);
    if (!set) { set = new Set(); this._listeners.set(name, set); }
    set.add(fn);
    return () => set.delete(fn);
  }
  _emit(name, payload = {}) {
    const set = this._listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { this._report(`listener:${name}`, err); }
    }
  }
  _report(where, err) {
    const now = performance.now();
    if (now - (this._errAt.get(where) || -1e9) < 5000) return;
    this._errAt.set(where, now);
    console.error(`[输入] ${where} 出错：`, err);
  }
  _guard(where, fn) {
    return (e) => { if (this._disposed) return; try { fn(e); } catch (err) { this._report(where, err); } };
  }

  // —— 设置 ——
  setSettings(patch = {}) {
    for (const k of Object.keys(DEFAULT_INPUT_SETTINGS)) {
      if (k in patch && typeof patch[k] === typeof DEFAULT_INPUT_SETTINGS[k]) this.settings[k] = patch[k];
    }
    if (!CAST_MODES.includes(this.settings.castMode)) this.settings.castMode = DEFAULT_INPUT_SETTINGS.castMode;
    this._applySettings();
    this.saveSettings();
    return this.settings;
  }
  saveSettings() {
    try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* 忽略 */ }
  }
  resetSettings() { return this.setSettings({ ...DEFAULT_INPUT_SETTINGS }); }
  _applySettings() {
    const cam = this.renderer?.cameraCtl;
    if (cam) cam.edgePanEnabled = !!this.settings.edgePan && this.enabled;
  }

  // —— DOM 绑定 ——
  _listen(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    this._dom.push([target, type, fn, opts]);
  }
  _bind() {
    const root = this.root;
    this._listen(window, 'keydown', this._guard('keydown', (e) => this._onKeyDown(e)));
    this._listen(window, 'keyup', this._guard('keyup', (e) => this._onKeyUp(e)));
    this._listen(root, 'mousedown', this._guard('mousedown', (e) => this._onMouseDown(e)));
    this._listen(window, 'mouseup', this._guard('mouseup', (e) => this._onMouseUp(e)));
    this._listen(window, 'mousemove', this._guard('mousemove', (e) => this._onMouseMove(e)), { passive: true });
    this._listen(root, 'wheel', this._guard('wheel', (e) => this._onWheel(e)), { passive: false });
    this._listen(window, 'contextmenu', (e) => { if (!isTypingTarget(e.target)) e.preventDefault(); });
    this._listen(window, 'blur', this._guard('blur', () => this._releaseAll()));
    this._listen(document, 'visibilitychange', this._guard('visibility', () => { if (document.hidden) this._releaseAll(); }));
    this._listen(document.documentElement, 'mouseleave', () => { this.mouse.inside = false; this._syncCameraPointer(); });
    this._listen(document.documentElement, 'mouseenter', () => { this.mouse.inside = true; this._syncCameraPointer(); });
  }
  dispose() {
    this._disposed = true;
    for (const [t, type, fn, opts] of this._dom) t.removeEventListener(type, fn, opts);
    this._dom.length = 0;
    this._listeners.clear();
    if (this.root) this.root.style.cursor = '';
  }

  // —— 状态判断 ——
  _aiControlled() { const p = this.player; return !!(p && p.controller); }
  _canCommand() {
    const p = this.player;
    return !!p && p.alive && !this.game.over && !this.game.paused && !this._aiControlled();
  }

  // —— 鼠标 ——
  _setPointer(cx, cy, target) {
    const m = this.mouse;
    const rect = this.root.getBoundingClientRect();
    m.clientX = cx; m.clientY = cy;
    m.x = cx - rect.left; m.y = cy - rect.top;
    m.inside = m.x >= 0 && m.y >= 0 && m.x <= rect.width && m.y <= rect.height;
    if (target !== undefined) m.overUI = !!target && target !== this.root && !this.root.contains(target);
    this._mouseSeen = true;
    this._syncCameraPointer();
  }
  _syncCameraPointer() {
    const cam = this.renderer?.cameraCtl;
    if (cam && typeof cam.setPointer === 'function') cam.setPointer(this.mouse.x, this.mouse.y, this.mouse.inside && this._mouseSeen);
  }
  _groundAt(cx, cy) {
    const g = this.renderer?.screenToGround?.(cx, cy);
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return null;
    return { x: Math.max(0, Math.min(MAP_SIZE, g.x)), y: Math.max(0, Math.min(MAP_SIZE, g.y)) };
  }
  _onMouseMove(e) {
    this._setPointer(e.clientX, e.clientY, e.target);
    const d = this._midDrag;
    if (d) {
      const cam = this.renderer?.cameraCtl;
      const g = this._groundAt(e.clientX, e.clientY);
      if (cam && g && !cam.isFollowing) cam.panBy(d.x - g.x, d.y - g.y);
    }
  }
  _onMouseDown(e) {
    this._setPointer(e.clientX, e.clientY, e.target);
    // 点击地面时让 HUD 按钮失去焦点，保证按键进入游戏（空格不会触发按钮）
    const ae = document.activeElement;
    if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
    if (e.button === 1) {
      e.preventDefault();
      const g = this._groundAt(e.clientX, e.clientY);
      if (g) this._midDrag = g;
      return;
    }
    if (e.button === 2) { this._onRightDown(e); return; }
    if (e.button === 0) this._onLeftDown(e);
  }
  _onMouseUp(e) {
    if (e.button === 2) { this._rightHeld = false; this._rightMove = false; }
    if (e.button === 1) this._midDrag = null;
  }
  _onRightDown(e) {
    if (this.pendingCast) { this.cancel(); return; }   // LoL：右键取消指示器
    this.attackMoveArmed = false;
    if (!this.enabled || !this._canCommand()) return;
    this._rightHeld = true;
    this._holdTimer = this.settings.holdRepeat;
    this._smartCommand(e.clientX, e.clientY);
  }
  _onLeftDown(e) {
    if (e.altKey) { this._ping(e.clientX, e.clientY); return; }
    if (!this.enabled) return;
    if (this.pendingCast) {
      const pc = this.pendingCast;
      this.pendingCast = null;
      if (this._canCommand()) this._execute(pc, { clientX: e.clientX, clientY: e.clientY });
      return;
    }
    if (this.attackMoveArmed) {
      this.attackMoveArmed = false;
      if (this._canCommand()) this._attackMoveAt(e.clientX, e.clientY);
      return;
    }
    const u = this.renderer?.pickUnit?.(e.clientX, e.clientY) || null;
    this.selectedUnit = u;
    this._emit('select', { unit: u });
  }
  _onWheel(e) {
    e.preventDefault();
    const cam = this.renderer?.cameraCtl;
    if (!cam) return;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 40; else if (e.deltaMode === 2) dy *= 400;
    cam.zoomBy(Math.max(-300, Math.min(300, dy)));
  }

  // —— 右键智能命令：敌方单位 → 普攻；否则移动 ——
  _isAttackable(e) {
    const p = this.player;
    if (!p || !e || !e.alive || e.removed || e === p || !ATTACKABLE.has(e.type) || e.team === p.team || e.untargetable) return false;
    if (this.renderer?.isShown && !this.renderer.isShown(e)) return false;
    return typeof e.isTargetableBy === 'function' ? e.isTargetableBy(p) : true;
  }
  _pickEnemy(cx, cy) {
    const only = this.championsOnly;
    return this.renderer?.pickUnit?.(cx, cy, { filter: (u) => this._isAttackable(u) && (!only || u.type === 'champion') }) || null;
  }
  _smartCommand(cx, cy) {
    const p = this.player;
    const enemy = this._pickEnemy(cx, cy);
    if (enemy) {
      p.attackUnit(enemy);
      this._rightMove = false;
      this._emit('command', { type: 'attack', x: enemy.x, y: enemy.y, target: enemy });
      return;
    }
    const g = this._groundAt(cx, cy);
    if (!g) return;
    p.moveTo(g.x, g.y);
    this._rightMove = true;
    this._lastMove.x = g.x; this._lastMove.y = g.y;
    this._emit('command', { type: 'move', x: g.x, y: g.y, target: null });
  }
  _attackMoveAt(cx, cy) {
    const p = this.player;
    const enemy = this._pickEnemy(cx, cy);
    if (enemy) {
      p.attackUnit(enemy);
      this._emit('command', { type: 'attack', x: enemy.x, y: enemy.y, target: enemy });
      return;
    }
    const g = this._groundAt(cx, cy) || { x: this.mouse.gx, y: this.mouse.gy };
    p.attackMove(g.x, g.y);
    this._emit('command', { type: 'attackMove', x: g.x, y: g.y, target: null });
  }
  _ping(cx, cy) {
    const now = performance.now();
    if (now - this._lastPingAt < PING_COOLDOWN_MS) return;
    const g = this._groundAt(cx, cy);
    if (!g) return;
    this._lastPingAt = now;
    const p = this.player;
    const team = p ? p.team : (this.renderer?.playerTeam ?? 0);
    const target = this.renderer?.pickUnit?.(cx, cy) || null;
    const kind = target && target.team !== team ? 'attack' : 'generic';
    try { this.game.events.emit('ping', { team, x: g.x, y: g.y, kind, source: p, target }); } catch (err) { this._report('ping', err); }
    this._emit('ping', { x: g.x, y: g.y, kind, target });
  }

  // —— 键盘 ——
  _onKeyDown(e) {
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    if (e.metaKey) return;   // 系统/浏览器快捷键
    const code = e.code;
    this.keys.add(code);
    // UI 键：任何状态下都响应
    if (code === 'Tab') { e.preventDefault(); if (!e.repeat) this._emit('scoreboard', { down: true }); return; }
    if (code === 'KeyP') { if (!e.repeat) this._emit('toggleShop', {}); return; }
    if (code === 'Escape') { if (!e.repeat) this._escape(); return; }
    if (code === 'Backquote') { this.championsOnly = true; return; }
    if (!this.enabled) return;
    const cam = this.renderer?.cameraCtl;
    // 镜头键
    if (code === 'Space') { e.preventDefault(); if (cam) cam.centering = true; return; }
    if (code === 'KeyY') {
      if (!e.repeat && cam) { const locked = cam.toggleLock(); this._emit('cameraLock', { locked }); }
      return;
    }
    const p = this.player;
    if (!p) return;
    // Ctrl+QWER 升级技能（阵亡时也可加点）
    if (e.ctrlKey && ABILITY_KEYS[code]) {
      e.preventDefault();
      if (!e.repeat && !this._aiControlled()) this.levelUp(ABILITY_KEYS[code]);
      return;
    }
    const isGameKey = ABILITY_KEYS[code] || SUMMONER_KEYS[code] || code in ITEM_KEYS || TRINKET_CODES.has(code)
      || code === 'KeyA' || code === 'KeyS' || code === 'KeyH' || code === 'KeyB';
    if (!isGameKey) return;
    if (e.ctrlKey || e.altKey && !(ABILITY_KEYS[code] || SUMMONER_KEYS[code] || code in ITEM_KEYS)) return;
    if (e.repeat) return;
    if (!this._canCommand()) return;
    if (ABILITY_KEYS[code]) { this._press('ability', ABILITY_KEYS[code], code, e.altKey); return; }
    if (SUMMONER_KEYS[code]) { this._press('summoner', SUMMONER_KEYS[code], code, e.altKey); return; }
    if (code in ITEM_KEYS) { this._press('item', ITEM_KEYS[code], code, e.altKey); return; }
    if (TRINKET_CODES.has(code)) { this._press('trinket', 0, code, false); return; }
    switch (code) {
      case 'KeyA':
        this.pendingCast = null;
        if (this.settings.attackMoveOnCursor) this._attackMoveAt(this.mouse.clientX, this.mouse.clientY);
        else this.attackMoveArmed = true;
        break;
      case 'KeyS':
      case 'KeyH':
        this.pendingCast = null;
        this.attackMoveArmed = false;
        this._rightHeld = false;
        p.stop();
        this._emit('command', { type: 'stop', x: p.x, y: p.y, target: null });
        break;
      case 'KeyB': {
        this.pendingCast = null;
        this.attackMoveArmed = false;
        this._rightHeld = false;
        const ok = p.startRecall() !== false;
        this._emit('command', { type: 'recall', x: p.x, y: p.y, target: null, ok });
        break;
      }
      default: break;
    }
  }
  _onKeyUp(e) {
    const code = e.code;
    this.keys.delete(code);
    if (code === 'Tab') { e.preventDefault(); this._emit('scoreboard', { down: false }); return; }
    if (code === 'Backquote') { this.championsOnly = false; return; }
    if (code === 'Space') {
      e.preventDefault();
      const cam = this.renderer?.cameraCtl;
      if (cam) cam.centering = false;
      return;
    }
    const pc = this.pendingCast;
    if (pc && pc.code === code && pc.mode === 'quickIndicator') {
      this.pendingCast = null;
      if (this.enabled && this._canCommand()) this._execute(pc, { selfCast: e.altKey });
      else this._emit('castCancel', { kind: pc.kind, slot: pc.slot });
    }
  }
  _escape() {
    if (this.pendingCast) { this.cancel(); return; }
    if (this.attackMoveArmed) { this.attackMoveArmed = false; return; }
    this._emit('escape', {});
  }
  _releaseAll() {
    this.keys.clear();
    this._rightHeld = false;
    this._rightMove = false;
    this._midDrag = null;
    this.championsOnly = false;
    const cam = this.renderer?.cameraCtl;
    if (cam) cam.centering = false;
    if (this.pendingCast) this.cancel();
    this._emit('scoreboard', { down: false });
  }

  // —— 施法 ——
  // 生成施法信息（已归一化 targeting/range/indicator）；不可用时返回 { error }
  _castInfo(kind, slot) {
    const p = this.player;
    if (!p) return { error: 'dead' };
    const now = this.game.time;
    if (kind === 'ability') {
      const st = p.abilities?.[slot];
      if (!st || !st.def) return { error: 'rank' };
      if (st.rank <= 0) return { error: 'rank' };
      const def = st.def;
      const recast = !!(st.isRecastActive && def.recast);
      if (!recast && !st.ready) return { error: 'cooldown' };
      const targeting = (recast ? def.recastTargeting : null) || def.targeting || 'self';
      const range = Number(st.range) || 0;
      const indicator = (recast ? def.recastIndicator : null) || def.indicator || defaultIndicator(targeting, range);
      return { kind, slot, key: slot, def, state: st, targeting, range, indicator, filter: def.targetFilter || 'enemy', recast };
    }
    if (kind === 'summoner') {
      const st = p.summoners?.[slot];
      if (!st || !st.def) return { error: 'rank' };
      if (st.ready === false) return { error: 'cooldown' };
      const def = st.def;
      const targeting = def.targeting || 'self';
      const range = Number.isFinite(def.range) ? def.range : 0;
      return { kind, slot, key: slot, def, state: st, targeting, range, indicator: def.indicator || defaultIndicator(targeting, range), filter: def.targetFilter || 'enemy' };
    }
    if (kind === 'item') {
      const st = p.items?.[slot];
      if (!st || !st.def) return { error: 'empty' };
      const def = st.def;
      if (st.cooldownUntil && now < st.cooldownUntil) return { error: 'cooldown' };
      let targeting, range, filter = 'enemy', indicator;
      if (def.active) {
        targeting = def.active.targeting || 'self';
        range = Number(def.active.range) || 0;
        filter = def.active.targetFilter || 'enemy';
        indicator = def.active.indicator;
      } else if (def.consumable) {
        targeting = def.consumable.targeting || (def.id === 'controlward' ? 'point' : 'self');
        range = Number(def.consumable.range) || (targeting === 'point' ? TRINKET.RANGE : 0);
        indicator = def.consumable.indicator;
      } else return { error: 'passive' };
      return { kind, slot, key: ITEM_KEY_LABELS[slot], def, state: st, targeting, range, indicator: indicator || defaultIndicator(targeting, range), filter };
    }
    if (kind === 'trinket') {
      const t = p.trinket;
      if (!t) return { error: 'empty' };
      if (t.charges <= 0) return { error: 'cooldown' };
      return { kind, slot: 0, key: '4', def: t, state: t, targeting: 'point', range: TRINKET.RANGE, indicator: { type: 'circle', radius: 60 }, filter: 'any' };
    }
    return { error: 'empty' };
  }
  _press(kind, slot, code, altKey) {
    const info = this._castInfo(kind, slot);
    if (!info || info.error) {
      this._emit('castFail', { kind, slot, key: info?.key ?? slot, reason: info?.error || 'empty' });
      return;
    }
    this.attackMoveArmed = false;
    const mode = this.settings.castMode;
    // 自身/无目标技能：按下即施放
    if (info.targeting === 'self' || info.targeting === 'none') { this.pendingCast = null; this._execute(info, { selfCast: true }); return; }
    // Alt + 指向技能：对自己施放（仅限可对友方施放的技能）
    if (altKey && info.targeting === 'unit' && this._legal(info, this.player)) { this.pendingCast = null; this._execute(info, { selfCast: true }); return; }
    if (mode === 'quick') { this.pendingCast = null; this._execute(info, {}); return; }
    const cur = this.pendingCast;
    if (mode === 'normal' && cur && cur.kind === kind && cur.slot === slot) { this.cancel(); return; }   // 再按一次取消
    info.code = code;
    info.mode = mode;
    info.startedAt = performance.now();
    this.pendingCast = info;
  }
  _legal(info, u) {
    const p = this.player;
    if (!p || !u || !u.alive || u.removed) return false;
    if (info.kind === 'summoner' && typeof info.def.canTarget === 'function') {
      try {
        return !!info.def.canTarget(p, u) && u.team !== p.team && (typeof u.isTargetableBy !== 'function' || u.isTargetableBy(p));
      } catch { return false; }
    }
    return targetOk(p, info.filter, u);
  }
  // 指向技能目标：悬停的合法单位 → 鼠标 smartTargetRadius 内最近的合法单位
  _resolveTarget(info, cx, cy, g) {
    const r = this.renderer;
    const legal = (u) => this._legal(info, u) && (!this.championsOnly || u.type === 'champion');
    const hov = r?.pickUnit?.(cx, cy, { filter: legal, pad: 8 });
    if (hov) return hov;
    if (!g) return null;
    const R = this.settings.smartTargetRadius;
    let best = null, bd = Infinity;
    for (const u of this.game.allUnits) {
      if (!legal(u)) continue;
      if (r?.isShown && !r.isShown(u)) continue;
      const d = Math.hypot(u.x - g.x, u.y - g.y) - (u.radius || 0);
      if (d <= R && d < bd) { bd = d; best = u; }
    }
    return best;
  }
  _execute(info, { clientX = this.mouse.clientX, clientY = this.mouse.clientY, selfCast = false } = {}) {
    const p = this.player;
    if (!p) return null;
    let g = this._groundAt(clientX, clientY);
    if (!g) g = { x: this.mouse.gx, y: this.mouse.gy };
    let target = null;
    if (info.targeting === 'unit') {
      target = selfCast && this._legal(info, p) ? p : this._resolveTarget(info, clientX, clientY, g);
      if (!target) {
        this._emit('castFail', { kind: info.kind, slot: info.slot, key: info.key, reason: 'target' });
        return { ok: false, reason: 'target' };
      }
    }
    let r = null;
    const opts = { target, x: g.x, y: g.y };
    switch (info.kind) {
      case 'ability': r = p.castAbility(info.slot, opts); break;
      case 'summoner': r = p.castSummoner(info.slot, opts); break;
      case 'item': r = p.useItem(info.slot, opts); break;
      case 'trinket': r = p.useTrinket(g.x, g.y); break;
      default: break;
    }
    const ok = !!(r && r.ok);
    this._emit('command', { type: 'cast', kind: info.kind, slot: info.slot, key: info.key, x: g.x, y: g.y, target, ok, reason: r?.reason });
    if (!ok) this._emit('castFail', { kind: info.kind, slot: info.slot, key: info.key, reason: r?.reason || 'busy' });
    else this._rightHeld = false;
    return r;
  }

  // —— 公共命令（HUD / 小地图用） ——
  cancel() {
    const pc = this.pendingCast;
    this.pendingCast = null;
    this.attackMoveArmed = false;
    if (pc) this._emit('castCancel', { kind: pc.kind, slot: pc.slot });
  }
  // HUD 点击技能/装备图标：自身技能立即施放，其余进入「常规施法」等待左键
  beginCast(kind, slot) {
    if (!this.enabled || !this._canCommand()) return false;
    const info = this._castInfo(kind, slot);
    if (!info || info.error) { this._emit('castFail', { kind, slot, key: info?.key ?? slot, reason: info?.error || 'empty' }); return false; }
    if (info.targeting === 'self' || info.targeting === 'none') { this._execute(info, { selfCast: true }); return true; }
    info.code = null;
    info.mode = 'normal';
    info.startedAt = performance.now();
    this.pendingCast = info;
    return true;
  }
  // 以光标位置立即使用（不显示指示器）
  useSlot(kind, slot) {
    if (!this._canCommand()) return null;
    const info = this._castInfo(kind, slot);
    if (!info || info.error) { this._emit('castFail', { kind, slot, key: info?.key ?? slot, reason: info?.error || 'empty' }); return null; }
    return this._execute(info, {});
  }
  levelUp(slot) {
    const p = this.player;
    if (!p || typeof p.levelUpAbility !== 'function') return false;
    const ok = !!p.levelUpAbility(slot);
    this._emit('command', { type: 'levelUp', slot, ok, x: p.x, y: p.y, target: null });
    return ok;
  }
  commandMove(x, y) {
    if (!this._canCommand()) return false;
    this.player.moveTo(x, y);
    this._emit('command', { type: 'move', x, y, target: null });
    return true;
  }
  commandAttackMove(x, y) {
    if (!this._canCommand()) return false;
    this.player.attackMove(x, y);
    this._emit('command', { type: 'attackMove', x, y, target: null });
    return true;
  }

  // —— 光标 ——
  _setCursor(kind) {
    if (this._cursor === kind || !this.root) return;
    this._cursor = kind;
    this.root.style.cursor = CURSORS[kind] || CURSORS.default;
  }

  // —— 每帧（main 在 game.update 之前调用） ——
  update(dt) {
    if (this._disposed) return;
    const m = this.mouse;
    const r = this.renderer;
    this._applySettings();
    if (this._mouseSeen && r) {
      const g = this._groundAt(m.clientX, m.clientY);
      if (g) { m.gx = g.x; m.gy = g.y; }
      this.hoverUnit = (!m.overUI && m.inside && r.pickUnit)
        ? r.pickUnit(m.clientX, m.clientY, { filter: this.championsOnly ? (u) => u.type === 'champion' : null })
        : null;
    }
    const p = this.player;
    if (!this._canCommand() || !this.enabled) {
      if (this.pendingCast && (!p || !p.alive)) this.cancel();
      this.attackMoveArmed = this.attackMoveArmed && this._canCommand();
      this._rightHeld = this._rightHeld && this._canCommand();
    }
    // 右键按住：持续朝光标移动
    if (this._rightHeld && this._rightMove && this.enabled && this._canCommand() && !this.pendingCast) {
      this._holdTimer -= dt;
      if (this._holdTimer <= 0) {
        this._holdTimer = this.settings.holdRepeat;
        const dx = m.gx - this._lastMove.x, dy = m.gy - this._lastMove.y;
        if (dx * dx + dy * dy > 30 * 30) {
          p.moveTo(m.gx, m.gy);
          this._lastMove.x = m.gx; this._lastMove.y = m.gy;
        }
      }
    }
    // 光标样式
    if (this.pendingCast) this._setCursor('cast');
    else if (this.attackMoveArmed || (this.hoverUnit && p && this._isAttackable(this.hoverUnit))) this._setCursor('attack');
    else this._setCursor('default');
  }
}

export default Input;
