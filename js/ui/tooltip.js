// 悬停提示：单一浮层，绑定元素 + 内容提供函数（悬停期间约 4Hz 刷新实时数值）
import { h, reportError } from './dom.js';

export class Tooltip {
  constructor(root) {
    this.el = h('div.tip', { role: 'tooltip', 'aria-hidden': 'true' });
    root.appendChild(this.el);
    this.target = null;
    this.provider = null;
    this.place = 'top';
    this.acc = 0;
    this._last = '';
  }
  bind(el, provider, { place = 'top' } = {}) {
    if (!el) return;
    el._tip = provider;
    el._tipPlace = place;
    if (el._tipBound) return;
    el._tipBound = true;
    el.addEventListener('pointerenter', () => this.show(el));
    el.addEventListener('pointerleave', () => { if (this.target === el) this.hide(); });
    el.addEventListener('focus', () => this.show(el));
    el.addEventListener('blur', () => { if (this.target === el) this.hide(); });
  }
  show(el) {
    this.target = el;
    this.provider = el._tip;
    this.place = el._tipPlace || 'top';
    this._last = '';
    this.refresh();
  }
  hide() {
    this.target = null;
    this.provider = null;
    this.el.classList.remove('on');
  }
  refresh() {
    if (!this.target || !this.provider) return;
    let html = '';
    try { html = this.provider() || ''; } catch (err) { reportError('tooltip', err); }
    if (!html) { this.el.classList.remove('on'); return; }
    if (html !== this._last) { this._last = html; this.el.innerHTML = html; }
    this.el.classList.add('on');
    this.position();
  }
  position() {
    const t = this.target;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const tw = this.el.offsetWidth, th = this.el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x, y;
    if (this.place === 'right') { x = r.right + 10; y = r.top; }
    else if (this.place === 'left') { x = r.left - tw - 10; y = r.top; }
    else if (this.place === 'bottom') { x = r.left + r.width / 2 - tw / 2; y = r.bottom + 10; }
    else { x = r.left + r.width / 2 - tw / 2; y = r.top - th - 10; if (y < 8) y = r.bottom + 10; }
    x = Math.max(8, Math.min(vw - tw - 8, x));
    y = Math.max(8, Math.min(vh - th - 8, y));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  update(dt) {
    if (!this.target) return;
    if (!this.target.isConnected || this.target.offsetParent === null) { this.hide(); return; }
    this.acc += dt;
    if (this.acc >= 0.25) { this.acc = 0; this.refresh(); }
  }
  dispose() { this.el.remove(); }
}

// 通用提示卡片 HTML
export function tipCard({ title, key = '', sub = '', meta = [], body = '', foot = '', cls = '' }) {
  const metaHtml = meta.filter(Boolean).map((m) => `<span>${m}</span>`).join('');
  return `<div class="tip-card ${cls}">
    <div class="tip-head"><div class="tip-title">${title}</div>${key ? `<kbd>${key}</kbd>` : ''}</div>
    ${sub ? `<div class="tip-sub">${sub}</div>` : ''}
    ${metaHtml ? `<div class="tip-meta">${metaHtml}</div>` : ''}
    ${body ? `<div class="tip-body">${body}</div>` : ''}
    ${foot ? `<div class="tip-foot">${foot}</div>` : ''}
  </div>`;
}
