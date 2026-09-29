// 图标生成：根据 icon 定义识别其所属（装备 / 技能 / 召唤师技能 / Buff），调用 iconart.js 的程序化插画绘制，叠加海克斯边框并缓存 dataURL
// 不再绘制 glyph 文字；glyph 仅作为识别线索与通用符文的配色种子
import { drawItemIcon, drawAbilityIcon, drawSummonerIcon, drawBuffIcon, drawUnitIcon } from './iconart.js';
import { ITEMS } from '../items/items.js';
import { CHAMPION_LIST } from '../champions/index.js';
import { SUMMONERS } from '../core/summoners.js';

const cache = new WeakMap();      // icon 对象 → Map(size → url)
const keyCache = new Map();       // 字符串键 → url

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 海克斯金边：外层渐变金、内层暗线、四角小菱形
export function drawHexFrame(g, s, { color = null, thick = 1, stops = null } = {}) {
  const lw = Math.max(1.5, s * 0.045) * thick;
  g.save();
  const gold = g.createLinearGradient(0, 0, 0, s);
  if (color) { gold.addColorStop(0, color); gold.addColorStop(1, color); }
  else if (stops) { gold.addColorStop(0, stops[0]); gold.addColorStop(0.45, stops[1]); gold.addColorStop(1, stops[2]); }
  else { gold.addColorStop(0, '#f0d9a0'); gold.addColorStop(0.45, '#c8aa6e'); gold.addColorStop(1, '#6e5124'); }
  g.strokeStyle = gold;
  g.lineWidth = lw;
  roundRect(g, lw / 2, lw / 2, s - lw, s - lw, s * 0.08);
  g.stroke();
  g.strokeStyle = 'rgba(1,10,19,0.85)';
  g.lineWidth = Math.max(1, s * 0.018);
  roundRect(g, lw + 0.5, lw + 0.5, s - lw * 2 - 1, s - lw * 2 - 1, s * 0.06);
  g.stroke();
  // 角饰
  g.fillStyle = color || (stops ? stops[0] : '#e8cf8e');
  const d = s * 0.07;
  for (const [cx, cy] of [[s / 2, lw / 2], [s / 2, s - lw / 2]]) {
    g.beginPath(); g.moveTo(cx - d, cy); g.lineTo(cx, cy - d * 0.7); g.lineTo(cx + d, cy); g.lineTo(cx, cy + d * 0.7); g.closePath(); g.fill();
  }
  g.restore();
}

// —— 图标身份登记：icon 对象 → { kind, id, champ, slot }（调用方只传 icon，这里反查它属于哪件装备 / 哪个技能） ——
let registry = null;
const glyphIndex = new Map();   // `${glyph}|${bg0}` → 身份（用于数据被浅拷贝的场合，如选人界面的召唤师技能占位）
const glyphOnly = new Map();    // glyph → 身份（仅召唤师技能与野怪 / 元素龙 Buff）
// 野怪、元素龙、男爵等 Buff 的 icon 定义在实体代码中（每次新建对象），按字形识别
const BUFF_GLYPH = {
  蓝: 'blue_buff', 红: 'red_buff', 灼: 'red_buff_burn', 炼: 'dragon_infernal', 山: 'dragon_mountain', 海: 'dragon_ocean', 云: 'dragon_cloud',
  长: 'elder_dragon', 男: 'baron', 速: 'scuttle_shrine', 蚀: 'baron_corrosion', 伤: 'item_grievous', 魂: 'dragon_soul',
};
function bg0(icon) { const b = icon?.bg; return Array.isArray(b) ? b[0] : b || ''; }
function reg(icon, info) {
  if (!icon || typeof icon !== 'object') return;
  if (!registry.has(icon)) registry.set(icon, info);
  if (icon.glyph) { const k = `${icon.glyph}|${bg0(icon)}`; if (!glyphIndex.has(k)) glyphIndex.set(k, info); }
}
function buildRegistry() {
  registry = new WeakMap();
  try { for (const id in ITEMS) reg(ITEMS[id].icon, { kind: 'item', id, def: ITEMS[id] }); } catch { /* 数据未就绪时忽略 */ }
  try {
    for (const c of CHAMPION_LIST) {
      if (c?.passive?.icon) reg(c.passive.icon, { kind: 'ability', champ: c.id, slot: 'P', def: c.passive });
      for (const s of ['Q', 'W', 'E', 'R']) {
        const a = c?.abilities?.[s];
        if (!a) continue;
        if (a.icon) reg(a.icon, { kind: 'ability', champ: c.id, slot: s, def: a });
        if (a.recastIcon) reg(a.recastIcon, { kind: 'ability', champ: c.id, slot: s + '2', def: a });
      }
    }
  } catch { /* 忽略 */ }
  try {
    for (const id in SUMMONERS) {
      const d = SUMMONERS[id];
      const info = { kind: 'summoner', id, def: d };
      reg(d.icon, info);
      if (d.icon?.glyph && !glyphOnly.has(d.icon.glyph)) glyphOnly.set(d.icon.glyph, info);
    }
  } catch { /* 忽略 */ }
  for (const g in BUFF_GLYPH) if (!glyphOnly.has(g)) glyphOnly.set(g, { kind: 'buff', id: BUFF_GLYPH[g] });
}
// 推断图标身份：显式参数 > 对象登记 > Buff id > 字形索引
function identify(icon, o) {
  if (o.kind) return { kind: o.kind, id: o.id, champ: o.champ, slot: o.slot };
  if (!registry) buildRegistry();
  if (icon && typeof icon === 'object') {
    const r = registry.get(icon);
    if (r) return r;
  }
  // Buff id 形如 garen_q_haste：drawBuffIcon 内部会复用对应英雄技能的插画
  if (o.buffId) return { kind: 'buff', id: o.buffId };
  const glyph = icon?.glyph;
  if (glyph) {
    const r = glyphIndex.get(`${glyph}|${bg0(icon)}`) || glyphOnly.get(glyph);
    if (r) return r;
  }
  return null;
}
// 由字形生成稳定的底色（无 icon 定义时的通用符文配色）
function seedColor(str) {
  let h = 0;
  for (const ch of String(str || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = (h % 360) / 360, s = 0.55, l = 0.55;
  const f = (n) => { const k = (n + hue * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
// 装备按品阶配边框色（传说用默认金色渐变）
const TIER_FRAME = {
  epic: ['#f4f8ff', '#b8c4d0', '#56606e'],
  basic: ['#e8c890', '#9a7a48', '#4a3418'],
  starter: ['#f0d49a', '#b08a50', '#553a16'],
  boots: ['#e8c890', '#a07a48', '#4a3418'],
  consumable: ['#d8c8b0', '#8a7a66', '#3a3026'],
};

// icon → dataURL（带缓存）；opts: { glyph, frame, kind, id, champ, slot, buffId }（后几项可选，用于显式指定图标身份）
export function iconURL(icon, size = 64, opts = {}) {
  const o = opts || {};
  const glyph = o.glyph ?? null, frame = o.frame ?? true;
  const px = Math.round(size);
  const extra = `${o.kind || ''}:${o.id || ''}:${o.champ || ''}:${o.slot || ''}:${o.buffId || ''}`;
  if (icon && typeof icon === 'object') {
    let m = cache.get(icon);
    if (!m) { m = new Map(); cache.set(icon, m); }
    const k = px + (frame ? 'f' : '') + (glyph || '') + extra;
    let url = m.get(k);
    if (!url) { url = paint(icon, px, glyph, frame, o); m.set(k, url); }
    return url;
  }
  const k = `g:${glyph}:${px}:${frame}:${extra}`;
  let url = keyCache.get(k);
  if (!url) { url = paint(null, px, glyph, frame, o); keyCache.set(k, url); }
  return url;
}

// 单位图标（击杀信息 / 目标框）：kind = minion | turret | inhibitor | nexus | monster | dragon | baron | herald | ward | pet | execute
export function unitIconURL(kind, size = 64, { color = null, frame = true } = {}) {
  const px = Math.round(size);
  const k = `u:${kind}:${px}:${color}:${frame}`;
  let url = keyCache.get(k);
  if (!url) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const g = cv.getContext('2d');
    try { drawUnitIcon(g, px, kind, color); } catch (e) { console.warn('[icons] unit', kind, e); }
    if (frame) drawHexFrame(g, px, { thick: 0.8 });
    url = cv.toDataURL('image/png');
    keyCache.set(k, url);
  }
  return url;
}

// 由游戏单位推断单位图标（小兵 / 防御塔按敌我着色，野怪按营地着色，元素龙按元素着色）
const MONSTER_COLOR = { blue_sentinel: '#4aa0ff', red_brambleback: '#ff5a3a', gromp: '#9cd35a', murkwolf: '#9aa8c0', raptor: '#ff8a3a', krug: '#c9a36a', scuttle: '#3ac8c8' };
const DRAGON_COLOR = { infernal: '#ff7a3a', mountain: '#c9a36a', ocean: '#3ac8c8', cloud: '#b8dcff', elder: '#c0f0ff' };
const UNIT_KINDS = new Set(['minion', 'turret', 'inhibitor', 'nexus', 'monster', 'dragon', 'baron', 'herald', 'ward', 'pet', 'execute']);
export function unitIconFor(u, rel = 'enemy', size = 64, { frame = true } = {}) {
  const t = u?.type;
  let kind = UNIT_KINDS.has(t) ? t : 'unknown', color = null;
  if (t === 'monster') {
    const k = u.kind || '';
    if (k === 'dragon' || k === 'elder_dragon') { kind = 'dragon'; color = DRAGON_COLOR[u.dragonType || 'elder'] || '#ff8a3a'; }
    else if (k === 'baron' || k === 'herald') kind = k;
    else { kind = 'monster'; const p = Object.keys(MONSTER_COLOR).find((x) => k.startsWith(x)); color = p ? MONSTER_COLOR[p] : '#e0b040'; }
  } else if (t === 'minion' || t === 'turret' || t === 'inhibitor' || t === 'nexus') {
    color = rel === 'ally' ? '#4a8ae0' : rel === 'neutral' ? '#c8aa6e' : '#e0503a';
  }
  return unitIconURL(kind, size, { color, frame });
}

function paint(icon, s, glyph, frame, opts) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const who = identify(icon, opts);
  const def = { icon: icon && icon.bg ? icon : { bg: [seedColor(glyph || icon?.glyph), '#101826'] } };
  let tier = null;
  g.save();
  try {
    if (who?.kind === 'item') { drawItemIcon(g, s, who.id, who.def || def); tier = who.def?.tier || icon?.tier || 'basic'; }
    else if (who?.kind === 'ability') drawAbilityIcon(g, s, who.champ, who.slot, def);
    else if (who?.kind === 'summoner') drawSummonerIcon(g, s, who.id, def);
    else if (who?.kind === 'buff') drawBuffIcon(g, s, who.id, def);
    else if (who?.kind === 'unit') drawUnitIcon(g, s, who.id, opts.color || null);
    else if (icon && typeof icon.draw === 'function' && !icon.glyph) icon.draw(g, s);   // 纯图形自绘图标（饰品、回城等）
    else drawBuffIcon(g, s, null, def);                                                 // 未知：按颜色的通用符文
  } catch (e) {
    console.warn('[icons] 绘制失败', who, e);
    g.restore(); g.save();
    g.clearRect(0, 0, s, s);
    try { drawBuffIcon(g, s, null, def); } catch { /* 忽略 */ }
  }
  g.restore();
  if (frame) {
    const tf = tier ? TIER_FRAME[tier] : null;
    drawHexFrame(g, s, tf ? { stops: tf } : { thick: tier === 'legendary' ? 1.25 : 1 });
  }
  return cv.toDataURL('image/png');
}

// 饰品（守卫）图标
export function trinketIconURL(size = 64) {
  return iconURL(TRINKET_ICON, size);
}
const TRINKET_ICON = {
  draw(g, s) {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, '#3a3212'); grd.addColorStop(1, '#0a0a06');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    const glow = g.createRadialGradient(s / 2, s * 0.45, 0, s / 2, s * 0.45, s * 0.45);
    glow.addColorStop(0, 'rgba(255,230,120,0.55)'); glow.addColorStop(1, 'rgba(255,230,120,0)');
    g.fillStyle = glow; g.fillRect(0, 0, s, s);
    // 图腾：菱形眼
    g.fillStyle = '#f4d35e';
    g.beginPath(); g.moveTo(s * 0.5, s * 0.16); g.lineTo(s * 0.7, s * 0.46); g.lineTo(s * 0.5, s * 0.84); g.lineTo(s * 0.3, s * 0.46); g.closePath(); g.fill();
    g.fillStyle = '#3a2a06';
    g.beginPath(); g.ellipse(s * 0.5, s * 0.46, s * 0.1, s * 0.06, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff6c8';
    g.beginPath(); g.arc(s * 0.5, s * 0.46, s * 0.035, 0, Math.PI * 2); g.fill();
  },
};

// 回城图标
export const RECALL_ICON = {
  draw(g, s) {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, '#0e3a5a'); grd.addColorStop(1, '#03101c');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#7fe6ff'; g.lineWidth = s * 0.07; g.lineCap = 'round';
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.26, Math.PI * 0.9, Math.PI * 2.6); g.stroke();
    g.fillStyle = '#7fe6ff';
    g.beginPath(); g.moveTo(s * 0.18, s * 0.34); g.lineTo(s * 0.36, s * 0.44); g.lineTo(s * 0.18, s * 0.56); g.closePath(); g.fill();
    g.fillStyle = '#e8fbff';
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.08, 0, Math.PI * 2); g.fill();
  },
};

// 属性面板的小图标（内联 SVG 字符串）
const SV = (p, c = 'currentColor') => `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="${c}" d="${p}"/></svg>`;
export const STAT_SVG = {
  ad: SV('M13.5 1.5 6 9l1 1 7.5-7.5V1.5zM5.2 9.6 3.8 11 2 10.4l-.6.6 1.8 1.8L1.5 14.5l.7.7 1.7-1.7 1.8 1.8.6-.6L5.7 13l1.4-1.4z', '#e0a050'),
  ap: SV('M8 1.2 9.6 6 14.8 6.2 10.7 9.3 12.2 14.3 8 11.4 3.8 14.3 5.3 9.3 1.2 6.2 6.4 6z', '#9d7bff'),
  armor: SV('M8 1 14 3.2V8c0 3.3-2.6 5.8-6 7-3.4-1.2-6-3.7-6-7V3.2z', '#e0b060'),
  mr: SV('M8 1 14 3.2V8c0 3.3-2.6 5.8-6 7-3.4-1.2-6-3.7-6-7V3.2zm0 3.2A3.3 3.3 0 1 0 8 11 3.3 3.3 0 0 0 8 4.2z', '#7ab0ff'),
  as: SV('M2 12 7 7 5 5l6-3-3 6-2-2-5 5zm8 2 4-4-1-1-4 4z', '#f0d070'),
  crit: SV('M8 .8 9.4 6.6 15.2 8 9.4 9.4 8 15.2 6.6 9.4.8 8 6.6 6.6z', '#ff7050'),
  ms: SV('M3 13c2-1 3-3 3-5l3 1 2 4h2l-2-5 1-3-4-2-3 2-2 2 1 1 2-2 1 .6C6 9 4 11 2 12z', '#e8e0c8'),
  haste: SV('M8 1.5A6.5 6.5 0 1 0 14.5 8 6.5 6.5 0 0 0 8 1.5zm0 1.8a4.7 4.7 0 0 1 4.7 4.7H8z', '#9fd8ff'),
};
