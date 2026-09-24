// UI 主类：组装 HUD / 小地图 / 击杀信息与公告 / 商店 / 记分板 / Esc 菜单 / 结算 / 悬停提示 / 首次按键说明，
// 订阅 input 与 game.events，按屏幕尺寸缩放界面（CSS zoom），阵亡灰屏，设置持久化（localStorage，try/catch）
import { h, PortraitStore, loadJSON, saveJSON, guard, reportError, toggle } from './dom.js';
import { Tooltip } from './tooltip.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';
import { Feed } from './feed.js';
import { ShopPanel } from './shop.js';
import { Scoreboard } from './scoreboard.js';
import { Menu, KeyHelp } from './menu.js';
import { EndScreen } from './endscreen.js';

export const UI_SETTINGS_KEY = 'riftclash.ui.v1';   // 与 champselect.js 相同（画质在选人界面读取）
const DEFAULTS = {
  showFps: true, cameraLocked: true, quality: 'high', muted: false, keyHelpSeen: false,
  volumes: { master: 0.8, sfx: 0.8, voice: 0.8, ambient: 0.5 },
};

export class UI {
  constructor(game, renderer, input, opts = {}) {
    this.game = game;
    this.renderer = renderer;
    this.input = input;
    this.opts = opts;
    this.root = opts.root || document.getElementById('ui-root');
    this.screenRoot = opts.screenRoot || document.getElementById('screen-root');
    this.audio = opts.audio || null;
    this.champions = opts.champions || game.champions?.reduce?.((m, c) => { m[c.championId] = c.def; return m; }, {}) || {};
    this.summoners = opts.summoners || {};
    this.items = opts.items || {};
    this.shop = opts.shop || null;
    this.config = opts.config || {};
    this.onRestart = opts.onRestart || (() => { try { location.reload(); } catch { /* 忽略 */ } });
    this.me = game.player || game.champions[0];
    this.team = this.me?.team ?? 0;
    this.fps = 60;
    this.modals = {};
    this.unsubs = [];
    this.disposed = false;
    // 设置
    const saved = loadJSON(UI_SETTINGS_KEY, {});
    this.settings = { ...DEFAULTS, ...saved, volumes: { ...DEFAULTS.volumes, ...(saved.volumes || {}) } };
    // 头像（全部界面共享缓存）
    this.portraits = new PortraitStore(opts.renderPortrait, this.champions);
    for (const c of game.champions) this.portraits.load(c.championId);
    // 组装
    this.root.classList.add('ui-live');
    this.tooltip = new Tooltip(this.root);
    this.hud = new Hud(this);
    this.minimap = new Minimap(this);
    this.feed = new Feed(this);
    this.shopPanel = new ShopPanel(this);
    this.scoreboard = new Scoreboard(this);
    this.menu = new Menu(this);
    this.keyHelp = new KeyHelp(this);
    this.endscreen = new EndScreen(this);
    if (this.me?.controller) this.root.appendChild(h('div.spect-badge', h('i'), '观战模式 · AI 托管'));
    this.root.appendChild(this.tooltip.el);   // 提示层置顶
    // 初始状态
    this.applyAudio();
    const cam = renderer?.cameraCtl;
    if (cam && !this.me?.controller && this.settings.cameraLocked === false) cam.setLocked?.(false);
    this.bindEvents();
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.layout();
    if (!this.settings.keyHelpSeen && !game.over) this.keyHelp.show();
  }

  // —— 事件 ——
  bindEvents() {
    const inp = this.input;
    const on = (src, name, fn) => {
      if (!src?.on) return;
      const off = src.on(name, (e) => guard(`事件 ${name}`, () => fn(e || {})));
      this.unsubs.push(typeof off === 'function' ? off : () => src.off?.(name, fn));
    };
    on(inp, 'castFail', (e) => this.hud.castFail(e));
    on(inp, 'select', (e) => this.hud.setTarget(e.unit));
    on(inp, 'toggleShop', () => { if (!this.menu.open && !this.game.over) this.toggleShop(); });
    on(inp, 'scoreboard', (e) => { if (!this.menu.open) this.scoreboard.show(!!e.down); });
    on(inp, 'escape', () => this.onEscape());
    on(inp, 'cameraLock', (e) => this.feed.toast(e.locked ? '镜头已锁定' : '镜头已解锁'));
    on(inp, 'command', (e) => {
      if (e.type === 'cast' && e.ok && (e.kind === 'ability' || e.kind === 'summoner')) this.hud.flashSlot(e.kind, e.slot);
      if (e.type === 'recall' && e.ok === false) this.feed.toast('现在无法回城');
    });
    const ev = this.game.events;
    on(ev, 'championKill', (e) => this.feed.onKill(e));
    on(ev, 'structureDestroyed', (e) => this.feed.onStructure(e));
    on(ev, 'objectiveKilled', (e) => this.feed.onObjective(e));
    on(ev, 'announce', (e) => this.feed.announce(e));
    on(ev, 'ping', (e) => { if (e.team === this.team) this.minimap.addPing(e.x, e.y, e.kind); });
    on(ev, 'gameOver', (e) => this.onGameOver(e.winner));
    on(ev, 'respawn', (e) => { if (e.champion === this.me) this.feed.toast('你已复活', 1.4); });
    on(ev, 'levelUp', (e) => {
      if (e.unit !== this.me || this.me.controller) return;
      const pts = this.me.skillPoints || 0;
      if (pts > 0 && e.level > 1) this.feed.toast(`升到 ${e.level} 级 · 可以升级技能（Ctrl + Q/W/E/R）`, 2.2);
    });
  }

  onEscape() {
    if (this.game.over) return;
    if (this.keyHelp.open) { this.keyHelp.hide(true); return; }
    if (this.shopPanel.open) { this.shopPanel.hide(); return; }
    if (this.scoreboard.visible) this.scoreboard.show(false);
    this.menu.toggle();
  }
  toggleShop() {
    if (this.game.over) return;
    this.keyHelp.hide(true);
    this.shopPanel.toggle();
  }
  // 模态窗口：打开时禁用游戏输入（仍响应 P / Esc / Tab）
  setModal(name, on) {
    this.modals[name] = !!on;
    const any = Object.values(this.modals).some(Boolean);
    if (this.input) {
      if (any) this.input.cancel?.();
      this.input.enabled = !any && !this.game.over;
    }
    toggle(this.root, 'modal-open', any);
    this.tooltip.hide();
  }

  onGameOver(winner) {
    this.shopPanel.hide();
    this.menu.hide();
    this.keyHelp.hide(false);
    this.scoreboard.show(false);
    if (this.input) { this.input.cancel?.(); this.input.enabled = false; }
    document.body.classList.remove('me-dead');
    setTimeout(() => {
      if (this.disposed) return;
      toggle(this.root, 'game-over', true);
      guard('结算', () => this.endscreen.show(winner));
    }, 2600);
  }

  // —— 设置 ——
  saveSettings() {
    const prev = loadJSON(UI_SETTINGS_KEY, {});
    saveJSON(UI_SETTINGS_KEY, { ...prev, ...this.settings, volumes: { ...this.settings.volumes } });
  }
  applyAudio() {
    const a = this.audio;
    if (!a) return;
    try {
      a.setVolume?.({ ...this.settings.volumes });
      a.setMuted?.(!!(this.settings.muted || this.config.mute));
    } catch (err) { reportError('音量', err); }
  }
  sfx(name) { try { this.audio?.playUI?.(name); } catch { /* 忽略 */ } }

  // —— 缩放：以 1920×1080 为基准，按短边比例缩放 HUD（CSS zoom） ——
  layout() {
    const w = window.innerWidth || 1600, hgt = window.innerHeight || 900;
    const z = Math.max(0.62, Math.min(1.35, Math.min(w / 1920, hgt / 1080) * 1.06));
    this.root.style.setProperty('--ui-zoom', z.toFixed(3));
    toggle(this.root, 'compact', w < 1100 || hgt < 640);
  }

  update(dt) {
    if (this.disposed) return;
    const perf = typeof window !== 'undefined' ? window.__perf : null;
    if (perf?.fps) this.fps = perf.fps;
    else if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    guard('HUD', () => this.hud.update(dt));
    guard('小地图', () => this.minimap.update(dt));
    guard('击杀信息', () => this.feed.update(dt));
    if (this.shopPanel.open) guard('商店', () => this.shopPanel.update(dt));
    if (this.scoreboard.visible) guard('记分板', () => this.scoreboard.update(dt));
    guard('提示', () => this.tooltip.update(dt));
    const dead = !!this.me && !this.me.alive && !this.game.over;
    if (dead !== this._dead) { this._dead = dead; document.body.classList.toggle('me-dead', dead); }
  }

  dispose() {
    this.disposed = true;
    for (const f of this.unsubs) { try { f(); } catch { /* 忽略 */ } }
    this.unsubs = [];
    window.removeEventListener('resize', this.onResize);
    for (const m of [this.hud, this.minimap, this.feed, this.shopPanel, this.scoreboard, this.menu, this.keyHelp, this.endscreen, this.tooltip]) {
      try { m?.dispose?.(); } catch { /* 忽略 */ }
    }
    document.body.classList.remove('me-dead');
    this.root.classList.remove('ui-live', 'modal-open', 'game-over');
    this.root.querySelector('.spect-badge')?.remove();
  }
}

export default UI;
