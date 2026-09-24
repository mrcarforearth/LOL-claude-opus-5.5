// UI 公共工具：DOM 构造、格式化、本地存储（try/catch）、节流报错、头像缓存
export const ROLE_LABELS = { top: '上单', jungle: '打野', mid: '中单', adc: '下路', support: '辅助' };
export const ROLE_ORDER = ['top', 'jungle', 'mid', 'adc', 'support'];
export const DIFF_LABELS = { easy: '新手', normal: '一般', hard: '困难' };
export const DRAGON_META = {
  infernal: { name: '炼狱亚龙', short: '炼狱', color: '#ff6a3a' },
  mountain: { name: '山脉亚龙', short: '山脉', color: '#c79a5a' },
  ocean: { name: '海洋亚龙', short: '海洋', color: '#3ad0c0' },
  cloud: { name: '云端亚龙', short: '云端', color: '#b8d8ff' },
  elder: { name: '远古巨龙', short: '远古', color: '#e8e0ff' },
};

// h('div.cls1.cls2', { attrs }, children...)
export function h(sel, attrs, ...children) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  if (m[2]) for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  } else if (attrs != null) children.unshift(attrs);
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
// 多行描述文本 → HTML（换行转 <br>，数字高亮）
export function richText(s) {
  return esc(s).replace(/\n/g, '<br>').replace(/(\d+(?:\.\d+)?%?)/g, '<b class="n">$1</b>');
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}
export function fmtNum(n, d = 0) {
  if (!Number.isFinite(n)) return '0';
  if (d === 0) return String(Math.round(n));
  const v = Number(n.toFixed(d));
  return String(v);
}
export function fmtK(n) {
  n = Math.round(n || 0);
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
export function fmtCd(s) {
  if (s <= 0) return '';
  if (s < 1) return s.toFixed(1);
  return String(Math.ceil(s));
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// —— localStorage（全部 try/catch） ——
export function loadJSON(key, def) {
  try {
    const raw = window.localStorage?.getItem(key);
    if (!raw) return def;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? { ...def, ...v } : def;
  } catch { return def; }
}
export function saveJSON(key, v) {
  try { window.localStorage?.setItem(key, JSON.stringify(v)); } catch { /* 忽略 */ }
}

// —— 节流报错：同一标签 5 秒内只打印一次 ——
const errAt = new Map();
export function reportError(tag, err) {
  const now = performance.now();
  if (now - (errAt.get(tag) || -1e9) < 5000) return;
  errAt.set(tag, now);
  console.error(`[界面] ${tag} 出错：`, err);
}
export function guard(tag, fn) {
  try { return fn(); } catch (err) { reportError(tag, err); return undefined; }
}

// 只在值变化时写 DOM
export function setText(el, v) {
  const s = String(v);
  if (el._t !== s) { el._t = s; el.textContent = s; }
}
export function setStyle(el, prop, v) {
  const k = '_s_' + prop;
  if (el[k] !== v) { el[k] = v; el.style.setProperty(prop, v); }
}
export function toggle(el, cls, on) {
  on = !!on;
  const k = '_c_' + cls;
  if (el[k] !== on) { el[k] = on; el.classList.toggle(cls, on); }
}

// —— 头像缓存：renderPortrait(id, 256) 只调用一次，所有界面共享 ——
export class PortraitStore {
  constructor(renderPortrait, champions) {
    this.render = renderPortrait;
    this.champions = champions || {};
    this.urls = new Map();
    this.promises = new Map();
    this.images = new Map();
    this.circles = new Map();
  }
  get(id) { return this.urls.get(id) || null; }
  load(id) {
    if (!id) return Promise.resolve(null);
    let p = this.promises.get(id);
    if (p) return p;
    p = Promise.resolve()
      .then(() => (typeof this.render === 'function' ? this.render(id, 256) : null))
      .catch(() => null)
      .then((url) => url || fallbackPortrait(this.champions[id], 256))
      .then((url) => { this.urls.set(id, url); return url; });
    this.promises.set(id, p);
    return p;
  }
  // 给 <img> 设置头像
  apply(img, id) {
    if (!img) return;
    const url = this.get(id);
    if (url) { if (img.getAttribute('src') !== url) img.src = url; return; }
    img.dataset.pid = id;
    this.load(id).then((u) => { if (img.dataset.pid === id && u) img.src = u; });
  }
  // 小地图圆形头像（带描边）；未加载时返回 null
  circle(id, ring, size = 48) {
    const key = `${id}|${ring}|${size}`;
    const c = this.circles.get(key);
    if (c) return c;
    const img = this.images.get(id);
    if (!img) {
      if (!this.images.has(id)) {
        this.images.set(id, null);
        this.load(id).then((url) => {
          const im = new Image();
          im.onload = () => this.images.set(id, im);
          im.src = url;
        });
      }
      return null;
    }
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const r = size / 2;
    g.save();
    g.beginPath(); g.arc(r, r, r - 2.5, 0, Math.PI * 2); g.clip();
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const crop = Math.min(iw, ih) * 0.78;
    g.drawImage(img, (iw - crop) / 2, (ih - crop) * 0.32, crop, crop, 0, 0, size, size);
    g.restore();
    g.lineWidth = 3;
    g.strokeStyle = ring;
    g.beginPath(); g.arc(r, r, r - 1.6, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.beginPath(); g.arc(r, r, r - 3.4, 0, Math.PI * 2); g.stroke();
    this.circles.set(key, cv);
    return cv;
  }
}

// 头像后备：定义里的 portrait（渐变 + 字形）
export function fallbackPortrait(def, size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const pt = def?.portrait || {};
  const bg = Array.isArray(pt.bg) ? pt.bg : ['#3a5da8', '#101a33'];
  const grd = g.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, bg[0]); grd.addColorStop(1, bg[1] || bg[0]);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  g.fillStyle = '#f0e6d2';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${Math.round(size * 0.5)}px 'Noto Serif SC', 'Songti SC', serif`;
  g.fillText(pt.glyph || (def?.name || '?').slice(0, 1), size / 2, size * 0.54);
  return cv.toDataURL('image/png');
}

// 英雄属性预览（选人界面用；desc(champ, rank) 需要 champ.stats）
export function previewChampion(def, level = 1) {
  const bs = def?.baseStats || {};
  const L = level;
  const gr = (b, p) => (b || 0) + (p || 0) * (L - 1) * (0.7025 + 0.0175 * (L - 1));
  const stats = {
    maxHp: gr(bs.hp, bs.hpPerLevel), maxMana: bs.resource === 'energy' ? bs.mana || 200 : gr(bs.mana, bs.manaPerLevel),
    ad: gr(bs.ad, bs.adPerLevel), baseAd: gr(bs.ad, bs.adPerLevel), bonusAd: 0, ap: 0,
    armor: gr(bs.armor, bs.armorPerLevel), baseArmor: gr(bs.armor, bs.armorPerLevel), bonusArmor: 0,
    mr: gr(bs.mr, bs.mrPerLevel), baseMr: gr(bs.mr, bs.mrPerLevel), bonusMr: 0,
    baseHp: gr(bs.hp, bs.hpPerLevel), bonusHp: 0,
    attackSpeed: bs.as || 0.625, bonusAS: 0, attackRange: bs.range || 125, moveSpeed: bs.ms || 340,
    crit: 0, critMult: bs.critMult || 1.75, abilityHaste: 0, lethality: 0, magicPen: 0, lifeSteal: 0, omnivamp: 0,
    hpRegen: gr(bs.hpRegen, bs.hpRegenPerLevel) / 5, manaRegen: gr(bs.manaRegen, bs.manaRegenPerLevel) / 5, tenacity: 0, healShieldPower: 0,
  };
  const abil = {};
  for (const s of ['Q', 'W', 'E', 'R']) abil[s] = { slot: s, rank: 0, def: def?.abilities?.[s], state: {}, charges: 0 };
  return {
    def, championId: def?.id, level: L, stats, hp: stats.maxHp, mana: stats.maxMana, baseStats: bs, xp: 0,
    abilities: abil, passive: { def: def?.passive, state: {} }, buffs: [], items: [], itemStats: {}, bonusStats: {},
    getBuff: () => null, hasBuff: () => false, buffStacks: () => 0, modelState: {}, team: 0, alive: true,
    get ad() { return stats.ad; }, get ap() { return 0; }, get maxHp() { return stats.maxHp; }, get armor() { return stats.armor; },
    get mr() { return stats.mr; }, get attackSpeed() { return stats.attackSpeed; }, get moveSpeed() { return stats.moveSpeed; },
    get resourceType() { return bs.resource || 'mana'; },
  };
}

// 安全调用 desc
export function safeDesc(fn, ...args) {
  if (typeof fn === 'string') return fn;
  if (typeof fn !== 'function') return '';
  try { return String(fn(...args) ?? ''); } catch { return ''; }
}
export function resolveVal(v, champ, rank) {
  try {
    if (typeof v === 'function') return v(champ, rank);
    if (Array.isArray(v)) return v.length ? v[Math.max(0, Math.min(v.length - 1, (rank || 1) - 1))] : 0;
    return v ?? 0;
  } catch { return 0; }
}
export const RESOURCE_LABEL = { mana: '法力', energy: '能量', none: '', hp: '生命值', fury: '怒气' };
