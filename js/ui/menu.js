// Esc 菜单（继续 / 设置 / 操作说明 / 投降，页内确认）与首次进入的按键说明卡片
import { h, toggle } from './dom.js';

const CAST_MODES = [['quickIndicator', '指示器快捷施法'], ['quick', '快捷施法'], ['normal', '常规施法']];
const CAST_DESC = {
  quickIndicator: '按住技能键显示指示器，松开时施放（默认）。',
  quick: '按下技能键立即向鼠标位置施放。',
  normal: '按下技能键显示指示器，再点击左键施放。',
};
export const KEY_HELP = [
  ['右键', '移动 / 攻击目标'], ['A + 左键', '攻击移动'], ['S', '停止'], ['Q W E R', '施放技能'],
  ['Ctrl + Q/W/E/R', '升级技能'], ['D  F', '召唤师技能'], ['1 2 3 5 6 7', '使用装备'], ['4', '放置守卫'],
  ['B', '回城'], ['P', '打开商店'], ['Tab（按住）', '记分板'], ['空格（按住）', '镜头居中'],
  ['Y', '锁定 / 解锁镜头'], ['滚轮', '缩放镜头'], ['Alt + 左键', '发送信号'], ['Esc', '取消施法 / 菜单'],
];
function keysEl(k) {
  const m = /^(.*?)(（.*）)?$/.exec(k);
  const out = m[1].trim().split(/\s+/).map((p) => (p === '+' ? h('span.kh-plus', '+') : h('kbd', p)));
  if (m[2]) out.push(h('small', m[2]));
  return h('span.kh-keys', ...out);
}
export function keyHelpGrid() {
  return h('div.kh-grid', ...KEY_HELP.map(([k, v]) => h('div.kh-row', keysEl(k), h('span.kh-desc', v))));
}

export class Menu {
  constructor(ui) {
    this.ui = ui;
    this.open = false;
    this.page = 'settings';
    this.pausedByMenu = false;
    this.navBtns = {};
    const nav = h('nav.menu-nav');
    const resume = h('button.menu-nav-btn.resume', { type: 'button' }, '继续游戏');
    resume.addEventListener('click', () => this.hide());
    nav.appendChild(resume);
    for (const [id, name] of [['settings', '设置'], ['help', '操作说明'], ['surrender', ui.me?.controller ? '结束观战' : '投降']]) {
      const b = h(`button.menu-nav-btn.${id}`, { type: 'button' }, name);
      b.addEventListener('click', () => this.setPage(id));
      this.navBtns[id] = b;
      nav.appendChild(b);
    }
    this.pages = { settings: this.buildSettings(), help: this.buildHelp(), surrender: this.buildSurrender() };
    const body = h('div.menu-body', ...Object.values(this.pages));
    this.el = h('div.menu-win', { role: 'dialog', 'aria-label': '游戏菜单', 'aria-modal': 'true' },
      h('i.hx-c.tl'), h('i.hx-c.tr'), h('i.hx-c.bl'), h('i.hx-c.br'),
      h('header.menu-head', h('div.panel-title', '游戏菜单'), h('div.menu-paused', '游戏已暂停')),
      h('div.menu-main', nav, body));
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.wrap = h('div.menu-layer', this.el);
    this.wrap.addEventListener('pointerdown', (e) => { if (e.target === this.wrap) this.hide(); });
    ui.root.appendChild(this.wrap);
    this.setPage('settings');
  }

  // —— 设置页 ——
  row(label, control, note = '') {
    return h('div.set-row', h('div.set-label', label, note ? h('small', note) : null), h('div.set-ctl', control));
  }
  switchCtl(get, set) {
    const box = h('input', { type: 'checkbox' });
    box.checked = !!get();
    box.addEventListener('change', () => { set(box.checked); this.ui.saveSettings(); });
    this.syncs.push(() => { box.checked = !!get(); });
    return h('label.cs-switch', box, h('span.cs-switch-ui'));
  }
  segCtl(options, get, set) {
    const wrap = h('div.cs-seg.sm', { role: 'radiogroup' });
    const btns = options.map(([v, text]) => {
      const b = h('button.cs-seg-btn', { type: 'button', role: 'radio' }, text);
      b.addEventListener('click', () => { set(v); this.ui.saveSettings(); sync(); });
      wrap.appendChild(b);
      return [v, b];
    });
    const sync = () => { for (const [v, b] of btns) { toggle(b, 'on', get() === v); b.setAttribute('aria-checked', String(get() === v)); } };
    this.syncs.push(sync);
    sync();
    return wrap;
  }
  sliderCtl(key) {
    const s = this.ui.settings;
    const val = h('span.num.set-val');
    const r = h('input.set-range', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': key });
    const sync = () => { const v = Math.round((s.volumes[key] ?? 0.8) * 100); r.value = String(v); val.textContent = String(v); r.style.setProperty('--v', `${v}%`); };
    r.addEventListener('input', () => { s.volumes[key] = Number(r.value) / 100; sync(); this.ui.applyAudio(); });
    r.addEventListener('change', () => this.ui.saveSettings());
    this.syncs.push(sync);
    sync();
    return h('div.set-slider', r, val);
  }
  buildSettings() {
    const ui = this.ui;
    const s = ui.settings;
    this.syncs = [];
    const inp = ui.input;
    const castNote = h('div.set-note');
    const castSeg = this.segCtl(CAST_MODES, () => inp?.settings?.castMode || 'quickIndicator', (v) => {
      inp?.setSettings?.({ castMode: v }); inp?.saveSettings?.();
    });
    this.syncs.push(() => { castNote.textContent = CAST_DESC[inp?.settings?.castMode] || ''; });
    const page = h('section.menu-page.settings',
      h('div.set-group', h('div.set-title', '声音'),
        this.row('主音量', this.sliderCtl('master')),
        this.row('音效', this.sliderCtl('sfx')),
        this.row('语音播报', this.sliderCtl('voice')),
        this.row('环境音', this.sliderCtl('ambient')),
        this.row('静音', this.switchCtl(() => s.muted, (v) => { s.muted = v; ui.applyAudio(); }))),
      h('div.set-group', h('div.set-title', '操作'),
        this.row('施法模式', castSeg), castNote,
        this.row('屏幕边缘移动镜头', this.switchCtl(() => inp?.settings?.edgePan !== false, (v) => { inp?.setSettings?.({ edgePan: v }); inp?.saveSettings?.(); }), '镜头解锁时生效'),
        this.row('默认锁定镜头', this.switchCtl(() => s.cameraLocked !== false, (v) => {
          s.cameraLocked = v;
          if (!ui.me?.controller) ui.renderer?.cameraCtl?.setLocked?.(v);
        }), 'Y 键可随时切换')),
      h('div.set-group', h('div.set-title', '画面'),
        this.row('画质', this.segCtl([['low', '低'], ['medium', '中'], ['high', '高']], () => s.quality || 'high', (v) => { s.quality = v; }), '重新开局后生效'),
        this.row('显示帧率（FPS）', this.switchCtl(() => s.showFps !== false, (v) => { s.showFps = v; }))));
    return page;
  }
  buildHelp() {
    return h('section.menu-page.help',
      h('div.set-title', '键位（英雄联盟默认）'), keyHelpGrid(),
      h('div.set-title', '玩法提示'),
      h('ul.help-list',
        h('li', '击杀小兵的最后一下（补刀）才能获得金币；靠近防御塔时注意塔会优先攻击攻击英雄的敌人。'),
        h('li', '回到泉水（或阵亡时）可以打开商店购买装备，推荐页会按英雄给出出装顺序。'),
        h('li', '推掉敌方一路的召唤水晶后，该路会出现超级兵；摧毁敌方水晶枢纽即可获胜。'),
        h('li', '击杀小龙、峡谷先锋与纳什男爵能获得强大的团队增益。')));
  }
  buildSurrender() {
    const spect = !!this.ui.me?.controller;
    const ok = h('button.hex-btn.danger', { type: 'button' }, h('span', spect ? '结束本局' : '确认投降'));
    ok.addEventListener('click', () => {
      const g = this.ui.game;
      this.hide();
      if (!g.over) g.end?.(1 - this.ui.team);
    });
    const cancel = h('button.hex-btn', { type: 'button' }, h('span', '取消'));
    cancel.addEventListener('click', () => this.setPage('settings'));
    return h('section.menu-page.surrender',
      h('div.sur-icon'),
      h('div.sur-title', spect ? '结束观战？' : '确定要投降吗？'),
      h('div.sur-desc', spect ? '本局将立即结束，并按你所在队伍失败结算。' : '投降后本局立即结束，你的队伍将被判定为失败。'),
      h('div.sur-actions', cancel, ok));
  }
  setPage(id) {
    this.page = id;
    for (const k in this.pages) toggle(this.pages[k], 'on', k === id);
    for (const k in this.navBtns) toggle(this.navBtns[k], 'on', k === id);
  }

  toggle() { if (this.open) this.hide(); else this.show(); }
  show(page = 'settings') {
    if (this.open || this.ui.game.over) return;
    this.open = true;
    for (const f of this.syncs) f();
    this.setPage(page);
    toggle(this.wrap, 'on', true);
    const g = this.ui.game;
    this.pausedByMenu = !g.paused;
    g.paused = true;
    this.ui.setModal('menu', true);
    requestAnimationFrame(() => this.el.querySelector('.menu-nav-btn.resume')?.focus({ preventScroll: true }));
  }
  hide() {
    if (!this.open) return;
    this.open = false;
    toggle(this.wrap, 'on', false);
    if (this.pausedByMenu) this.ui.game.paused = false;
    this.pausedByMenu = false;
    this.ui.setModal('menu', false);
    document.activeElement?.blur?.();
  }
  dispose() { this.wrap.remove(); }
}

// —— 首次进入的按键说明（可关闭，localStorage 记住） ——
export class KeyHelp {
  constructor(ui) {
    this.ui = ui;
    this.open = false;
    const ok = h('button.hex-btn.primary', { type: 'button' }, h('span', '开始对局'));
    ok.addEventListener('click', () => this.hide(true));
    const x = h('button.x-btn', { type: 'button', 'aria-label': '关闭' }, '×');
    x.addEventListener('click', () => this.hide(true));
    const spect = !!ui.me?.controller;
    this.el = h('div.keyhelp', { role: 'dialog', 'aria-label': '操作说明' },
      h('i.hx-c.tl'), h('i.hx-c.tr'), h('i.hx-c.bl'), h('i.hx-c.br'),
      h('header.kh-head', h('div.panel-title', spect ? '观战模式' : '操作说明'), x),
      spect ? h('div.kh-lead', '你的英雄由 AI 控制。拖动小地图或把鼠标移到屏幕边缘移动镜头，按住 Tab 查看记分板，点击记分板上的英雄可跳转镜头。') : h('div.kh-lead', '操作方式与英雄联盟默认键位一致。随时按 Esc 可在菜单中再次查看。'),
      keyHelpGrid(),
      h('div.kh-foot', ok));
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.wrap = h('div.kh-layer', this.el);
    ui.root.appendChild(this.wrap);
  }
  show() { this.open = true; toggle(this.wrap, 'on', true); }
  hide(remember) {
    if (!this.open) return;
    this.open = false;
    toggle(this.wrap, 'on', false);
    if (remember) { this.ui.settings.keyHelpSeen = true; this.ui.saveSettings(); }
    document.activeElement?.blur?.();
  }
  dispose() { this.wrap.remove(); }
}
