// 商店窗口（P 或点击金币）：左侧分类 + 搜索、推荐页按出装分组、装备格（价格/买不起变暗/已拥有）、
// 右侧详情（属性、被动/主动、合成树 from/into，点击节点切换）、购买（右键/双击/按钮）/出售/撤销、背包栏
import { h, esc, setText, toggle } from './dom.js';
import { iconURL } from './icons.js';
import { tipCard } from './tooltip.js';

const has = (d, ...tags) => (d.tags || []).some((t) => tags.includes(t));
const st = (d, ...keys) => keys.some((k) => d.stats && d.stats[k]);
const CATS = [
  ['rec', '推荐', null],
  ['all', '全部', () => true],
  ['ad', '攻击', (d) => has(d, 'ad', 'lethality', 'lifesteal') || st(d, 'ad', 'lethality', 'armorPenPct')],
  ['ap', '法术', (d) => has(d, 'ap', 'mana') || st(d, 'ap', 'magicPen', 'magicPenPct')],
  ['def', '防御', (d) => has(d, 'tank', 'armor', 'mr', 'hp') || st(d, 'armor', 'mr', 'hp')],
  ['as', '攻速暴击', (d) => has(d, 'as', 'crit', 'onhit') || st(d, 'attackSpeed', 'crit')],
  ['ms', '移速', (d) => has(d, 'boots') || d.tier === 'boots' || st(d, 'moveSpeed', 'moveSpeedPct')],
  ['cons', '消耗品', (d) => d.tier === 'consumable' || has(d, 'consumable')],
  ['js', '打野辅助', (d) => has(d, 'jungle', 'support')],
];
const TIER_ORDER = ['starter', 'consumable', 'basic', 'boots', 'epic', 'legendary'];
const TIER_NAME = { starter: '起始装备', consumable: '消耗品', basic: '基础装备', boots: '鞋子', epic: '进阶装备', legendary: '传说装备' };
const REASON = {
  不在泉水: '只能在泉水附近购买', 金币不足: '金币不足', 栏位已满: '装备栏已满', 唯一限制: '同类唯一装备只能拥有一件',
  已达上限: '已达到携带上限', 等级不足: '等级不足', 仅限远程英雄: '仅限远程英雄', 无法购买: '无法购买',
};

// 描述文本 → HTML：属性行、主动/被动名称高亮
function itemDescHTML(def) {
  const lines = String(def?.desc || '').split('\n').filter((l) => l.trim());
  return lines.map((l) => {
    const s = esc(l);
    if (/^[+＋]/.test(l)) return `<div class="it-stat">${s.replace(/^([+＋][\d.]+%?)/, '<b class="n">$1</b>')}</div>`;
    const m = /^((?:唯一)?(?:主动|被动)|消耗品|饰品)\s*[—-]+\s*([^：:]+)[：:](.*)$/.exec(l);
    if (m) return `<div class="it-ab"><b class="it-ab-k">${esc(m[1])}</b> <b class="it-ab-n">${esc(m[2])}</b>：${esc(m[3]).replace(/(\d+(?:\.\d+)?%?)/g, '<b class="n">$1</b>')}</div>`;
    return `<div class="it-line">${s.replace(/(\d+(?:\.\d+)?%?)/g, '<b class="n">$1</b>')}</div>`;
  }).join('');
}

export class ShopPanel {
  constructor(ui) {
    this.ui = ui;
    this.me = ui.me;
    this.items = ui.items || {};
    this.api = ui.shop || null;
    this.open = false;
    this.cat = 'rec';
    this.query = '';
    this.sel = null;
    this.selSlot = -1;
    this.acc = 1;
    this.msgUntil = 0;
    this.list = Object.values(this.items).filter((d) => d && d.purchasable !== false)
      .sort((a, b) => (TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)) || (a.cost - b.cost));
    this.cells = new Map();   // id → [{ el, cost }]（同一件可能出现在多个分组）
    this.build();
  }

  build() {
    const tip = this.ui.tooltip;
    this.goldEl = h('span.num', '0');
    this.search = h('input.shop-search', { type: 'search', placeholder: '搜索装备', 'aria-label': '搜索装备', spellcheck: 'false', autocomplete: 'off' });
    this.search.addEventListener('input', () => { this.query = this.search.value.trim(); this.renderList(); });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); if (this.search.value) { this.search.value = ''; this.query = ''; this.renderList(); } else this.hide(); }
      e.stopPropagation();
    });
    const close = h('button.x-btn', { type: 'button', 'aria-label': '关闭商店' }, '×');
    close.addEventListener('click', () => this.hide());
    const nav = h('nav.shop-cats', { role: 'tablist' });
    this.catBtns = {};
    for (const [id, name] of CATS) {
      const b = h('button.shop-cat', { type: 'button', role: 'tab' }, name);
      b.addEventListener('click', () => { this.cat = id; this.query = ''; this.search.value = ''; this.renderList(); });
      this.catBtns[id] = b;
      nav.appendChild(b);
    }
    this.listEl = h('div.shop-list');
    // 详情
    this.dImg = h('img', { alt: '' });
    this.dName = h('div.sd-name');
    this.dCost = h('div.sd-cost.num');
    this.dTree = h('div.sd-tree');
    this.dDesc = h('div.sd-desc');
    this.dInto = h('div.sd-into');
    this.buyBtn = h('button.hex-btn.primary.sd-buy', { type: 'button' }, h('span', '购买'));
    this.buyBtn.addEventListener('click', () => this.sel && this.buy(this.sel));
    this.detail = h('section.shop-detail',
      h('div.sd-head', h('div.sd-icon', this.dImg), h('div.sd-title', this.dName, this.dCost)),
      h('div.sd-sec', '合成路线'), this.dTree,
      h('div.sd-scroll', this.dDesc, h('div.sd-sec', '可合成'), this.dInto),
      this.buyBtn);
    // 背包栏 + 出售/撤销
    this.invEls = [];
    const inv = h('div.shop-inv');
    for (let i = 0; i < 6; i++) {
      const img = h('img', { alt: '' });
      const cnt = h('span.cnt.num');
      const b = h('button.shop-inv-slot', { type: 'button', 'aria-label': `装备栏 ${i + 1}` }, img, cnt);
      b.addEventListener('click', () => { this.selSlot = this.selSlot === i ? -1 : i; const it = this.me.items[i]; if (it) this.select(it.id); this.refresh(); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.sellSlot(i); });
      tip.bind(b, () => {
        const it = this.me.items[i];
        if (!it?.def) return '';
        return tipCard({ title: esc(it.def.name), meta: [`出售价格 ${this.sellValue(it)}`], body: itemDescHTML(it.def), foot: '右键出售' });
      });
      this.invEls.push({ b, img, cnt, id: null });
      inv.appendChild(b);
    }
    this.sellBtn = h('button.hex-btn.sm', { type: 'button' }, h('span', '出售'));
    this.sellBtn.addEventListener('click', () => { if (this.selSlot >= 0) this.sellSlot(this.selSlot); });
    this.undoBtn = h('button.hex-btn.sm', { type: 'button' }, h('span', '撤销'));
    this.undoBtn.addEventListener('click', () => this.undo());
    this.msg = h('div.shop-msg');
    this.el = h('div.shop-win', { role: 'dialog', 'aria-label': '商店', 'aria-modal': 'false' },
      h('i.hx-c.tl'), h('i.hx-c.tr'), h('i.hx-c.bl'), h('i.hx-c.br'),
      h('header.shop-head', h('div.panel-title', '商店'), this.search, h('div.shop-gold', h('i.coin'), this.goldEl), close),
      h('div.shop-body', nav, this.listEl, this.detail),
      h('footer.shop-foot', h('div.shop-inv-label', '背包'), inv, this.sellBtn, this.undoBtn, this.msg,
        h('div.shop-keys', '右键 / 双击 购买 · 右键背包出售 · P / Esc 关闭')));
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.wrap = h('div.shop-layer', this.el);
    this.ui.root.appendChild(this.wrap);
    this.renderList();
  }

  // —— 列表 ——
  makeCell(def) {
    const img = h('img', { alt: '', loading: 'lazy', src: iconURL(def.icon, 64, { glyph: def.name?.[0] }) });
    const cost = h('span.si-cost.num', String(def.cost));
    const el = h('button.shop-item', { type: 'button', 'aria-label': def.name, dataset: { id: def.id } }, h('div.si-img', img, h('i.si-own')), cost);
    el.addEventListener('click', () => this.select(def.id));
    el.addEventListener('dblclick', () => this.buy(def.id));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.select(def.id); this.buy(def.id); });
    this.ui.tooltip.bind(el, () => tipCard({ title: esc(def.name), meta: [`价格 ${this.costOf(def.id)}`, TIER_NAME[def.tier] || ''], body: itemDescHTML(def), foot: '右键购买' }), { place: 'right' });
    let arr = this.cells.get(def.id);
    if (!arr) { arr = []; this.cells.set(def.id, arr); }
    arr.push({ el, cost });
    return el;
  }
  group(title, defs) {
    const g = h('div.shop-group', h('div.sg-title', title));
    const grid = h('div.sg-grid');
    for (const d of defs) if (d) grid.appendChild(this.makeCell(d));
    g.appendChild(grid);
    return defs.some(Boolean) ? g : null;
  }
  renderList() {
    this.cells.clear();
    this.listEl.replaceChildren();
    for (const id in this.catBtns) toggle(this.catBtns[id], 'on', !this.query && this.cat === id);
    const q = this.query;
    let groups = [];
    if (q) {
      const hits = this.list.filter((d) => d.name.includes(q) || d.id.includes(q.toLowerCase()));
      groups.push(this.group(`搜索结果（${hits.length}）`, hits));
    } else if (this.cat === 'rec') {
      const b = this.api?.buildFor?.(this.me) || null;
      const I = (id) => this.items[id] || null;
      const uniq = (arr) => [...new Set(arr || [])];
      if (b) {
        groups.push(this.group('出门装', uniq(b.start).map(I)));
        groups.push(this.group('核心装备', uniq(b.core).map(I)));
        groups.push(this.group('鞋子', uniq([b.boots, 'boots']).map(I)));
        groups.push(this.group('可选装备', uniq(b.situational).map(I)));
      }
      groups.push(this.group('消耗品', this.list.filter((d) => d.tier === 'consumable')));
      const next = this.api?.nextPurchase?.(this.me, b);
      this.nextId = typeof next === 'string' ? next : next?.id || null;
    } else {
      const f = CATS.find((c) => c[0] === this.cat)?.[2] || (() => true);
      const defs = this.list.filter(f);
      for (const t of TIER_ORDER) groups.push(this.group(TIER_NAME[t], defs.filter((d) => d.tier === t)));
    }
    groups = groups.filter(Boolean);
    if (!groups.length) this.listEl.appendChild(h('div.shop-empty', '没有符合条件的装备'));
    else this.listEl.append(...groups);
    if (!this.sel || !this.items[this.sel]) {
      const first = this.listEl.querySelector('.shop-item');
      if (first) this.select(first.dataset.id);
    }
    this.acc = 1;
  }

  // —— 详情 ——
  treeNode(id, depth = 0) {
    const d = this.items[id];
    if (!d) return null;
    const btn = h('button.tn-item', { type: 'button', 'aria-label': d.name, dataset: { id } },
      h('img', { alt: '', src: iconURL(d.icon, 48, { glyph: d.name?.[0] }) }), h('span.num', String(d.cost)));
    btn.addEventListener('click', () => this.select(id));
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); this.buy(id); });
    this.ui.tooltip.bind(btn, () => tipCard({ title: esc(d.name), meta: [`价格 ${this.costOf(id)}`], body: itemDescHTML(d) }), { place: 'left' });
    const node = h(`div.tn${depth === 0 ? '.root' : ''}`, btn);
    if (d.from?.length && depth < 3) {
      const kids = h('div.tn-kids');
      for (const f of d.from) { const c = this.treeNode(f, depth + 1); if (c) kids.appendChild(c); }
      node.appendChild(kids);
    }
    return node;
  }
  select(id) {
    const d = this.items[id];
    if (!d) return;
    this.sel = id;
    this.dImg.src = iconURL(d.icon, 64, { glyph: d.name?.[0] });
    setText(this.dName, d.name);
    this.dTree.replaceChildren(this.treeNode(id));
    this.dDesc.innerHTML = itemDescHTML(d);
    this.dInto.replaceChildren();
    const into = (d.into || []).map((x) => this.items[x]).filter((x) => x && x.purchasable !== false);
    if (!into.length) this.dInto.appendChild(h('span.sd-none', '无'));
    for (const x of into) {
      const b = h('button.tn-item.sm', { type: 'button', 'aria-label': x.name }, h('img', { alt: '', src: iconURL(x.icon, 48, { glyph: x.name?.[0] }) }));
      b.addEventListener('click', () => this.select(x.id));
      this.ui.tooltip.bind(b, () => tipCard({ title: esc(x.name), meta: [`价格 ${this.costOf(x.id)}`], body: itemDescHTML(x) }), { place: 'left' });
      this.dInto.appendChild(b);
    }
    for (const [cid, arr] of this.cells) for (const c of arr) toggle(c.el, 'sel', cid === id);
    this.acc = 1;
  }

  // —— 规则（委托 js/items/shop.js） ——
  costOf(id) {
    try { return Math.round(this.api?.effectiveCost?.(this.me, id) ?? this.items[id]?.cost ?? 0); } catch { return this.items[id]?.cost ?? 0; }
  }
  sellValue(it) {
    try { return Math.floor(this.api?.sellValue?.(it) ?? (it.def.cost * 0.7)); } catch { return 0; }
  }
  flash(text, bad = true) {
    setText(this.msg, text);
    toggle(this.msg, 'bad', bad);
    toggle(this.msg, 'good', !bad);
    this.msgUntil = performance.now() + 2200;
  }
  buy(id) {
    const me = this.me;
    if (me.controller) { this.flash('观战模式下由 AI 自动购买'); return; }
    if (!this.api?.buy) return;
    const r = this.api.buy(me, id);
    if (r?.ok) { this.flash(`已购买 ${this.items[id]?.name || ''}`, false); this.ui.sfx?.('buy'); this.renderListSoon(); }
    else this.flash(REASON[r?.reason] || r?.reason || '无法购买');
    this.acc = 1;
  }
  sellSlot(i) {
    const me = this.me;
    const it = me.items[i];
    if (!it || !this.api?.sell) return;
    if (me.controller) { this.flash('观战模式下由 AI 自动购买'); return; }
    const r = this.api.sell(me, i);
    if (r?.ok) { this.flash(`已出售 ${it.def?.name || ''}，获得 ${r.refund} 金币`, false); this.selSlot = -1; this.renderListSoon(); }
    else this.flash(REASON[r?.reason] || r?.reason || '无法出售');
    this.acc = 1;
  }
  undo() {
    if (this.me.controller) return;
    if (this.api?.undo?.(this.me)) { this.flash('已撤销', false); this.renderListSoon(); } else this.flash('没有可以撤销的操作');
    this.acc = 1;
  }
  renderListSoon() { if (this.cat === 'rec' && !this.query) this._rerender = true; }

  // —— 显示 ——
  toggle() { if (this.open) this.hide(); else this.show(); }
  show() {
    if (this.open) return;
    this.open = true;
    this.ui.setModal('shop', true);
    toggle(this.wrap, 'on', true);
    this.renderList();
    this.refresh();
  }
  hide() {
    if (!this.open) return;
    this.open = false;
    this.selSlot = -1;
    toggle(this.wrap, 'on', false);
    this.search.blur();
    this.ui.setModal('shop', false);
  }

  update(dt) {
    if (!this.open) return;
    this.acc += dt;
    if (this.acc < 0.2) return;
    this.acc = 0;
    if (this._rerender) { this._rerender = false; const s = this.sel; this.renderList(); if (s) this.select(s); }
    this.refresh();
  }
  refresh() {
    const me = this.me;
    const api = this.api;
    setText(this.goldEl, Math.floor(me.gold));
    const canShop = !!me.canShop;
    const spect = !!me.controller;
    const owned = new Set(me.items.filter(Boolean).map((it) => it.id));
    for (const [id, arr] of this.cells) {
      const cost = this.costOf(id);
      let ok = true;
      try { ok = api?.canBuy ? !!api.canBuy(me, id).ok : me.gold >= cost; } catch { ok = false; }
      const poor = me.gold + 1e-6 < cost;
      for (const c of arr) {
        setText(c.cost, cost);
        toggle(c.el, 'poor', poor);
        toggle(c.el, 'blocked', !ok && !poor);
        toggle(c.el, 'owned', owned.has(id));
        toggle(c.el, 'next', id === this.nextId);
      }
    }
    // 详情购买按钮
    if (this.sel) {
      const cost = this.costOf(this.sel);
      const full = this.items[this.sel]?.cost ?? cost;
      this.dCost.innerHTML = cost !== full ? `<i class="coin"></i>${cost} <s>${full}</s>` : `<i class="coin"></i>${cost}`;
      let r = { ok: false, reason: '无法购买' };
      try { r = api?.canBuy ? api.canBuy(me, this.sel) : r; } catch { /* 忽略 */ }
      this.buyBtn.disabled = spect || !r.ok;
      this.buyBtn.firstChild.textContent = spect ? '观战中' : r.ok ? `购买 · ${cost}` : REASON[r.reason] || '无法购买';
    }
    // 背包
    for (let i = 0; i < 6; i++) {
      const e = this.invEls[i];
      const it = me.items[i];
      const id = it?.id || null;
      if (e.id !== id) {
        e.id = id;
        if (it?.def) e.img.src = iconURL(it.def.icon, 48, { glyph: it.def.name?.[0] }); else e.img.removeAttribute('src');
        toggle(e.b, 'empty', !it);
      }
      setText(e.cnt, it && it.stacks > 1 ? it.stacks : '');
      toggle(e.b, 'sel', this.selSlot === i && !!it);
    }
    if (this.selSlot >= 0 && !me.items[this.selSlot]) this.selSlot = -1;
    const selIt = this.selSlot >= 0 ? me.items[this.selSlot] : null;
    this.sellBtn.disabled = spect || !canShop || !selIt;
    this.sellBtn.firstChild.textContent = selIt ? `出售 · ${this.sellValue(selIt)}` : '出售';
    let canUndo = false;
    try { canUndo = !!api?.canUndo?.(me); } catch { /* 忽略 */ }
    this.undoBtn.disabled = spect || !canUndo;
    if (performance.now() > this.msgUntil) {
      const text = spect ? '观战模式：AI 自动购买装备' : canShop ? '' : '只能在泉水附近购买';
      setText(this.msg, text);
      toggle(this.msg, 'bad', !canShop && !spect);
      toggle(this.msg, 'good', false);
    }
    toggle(this.el, 'away', !canShop);
  }

  dispose() { this.wrap.remove(); }
}
