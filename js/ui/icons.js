// 图标生成：根据 icon 定义（glyph + bg 渐变 + fg，或 draw(ctx,size)）绘制带海克斯边框的图标，缓存 dataURL
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
export function drawHexFrame(g, s, { color = null, thick = 1 } = {}) {
  const lw = Math.max(1.5, s * 0.045) * thick;
  g.save();
  const gold = g.createLinearGradient(0, 0, 0, s);
  if (color) { gold.addColorStop(0, color); gold.addColorStop(1, color); }
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
  g.fillStyle = color || '#e8cf8e';
  const d = s * 0.07;
  for (const [cx, cy] of [[s / 2, lw / 2], [s / 2, s - lw / 2]]) {
    g.beginPath(); g.moveTo(cx - d, cy); g.lineTo(cx, cy - d * 0.7); g.lineTo(cx + d, cy); g.lineTo(cx, cy + d * 0.7); g.closePath(); g.fill();
  }
  g.restore();
}

function drawGlyphIcon(g, s, icon, fallbackGlyph) {
  const bg = Array.isArray(icon?.bg) ? icon.bg : [icon?.bg || '#3a4a6a', '#0a1428'];
  roundRect(g, 0, 0, s, s, s * 0.08);
  g.save();
  g.clip();
  const grd = g.createLinearGradient(0, 0, s * 0.6, s);
  grd.addColorStop(0, bg[0]);
  grd.addColorStop(1, bg[1] || bg[0]);
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  // 纹理：放射光与斜纹
  const hl = g.createRadialGradient(s * 0.5, s * 0.42, 0, s * 0.5, s * 0.42, s * 0.62);
  hl.addColorStop(0, 'rgba(255,255,255,0.32)');
  hl.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl;
  g.fillRect(0, 0, s, s);
  g.globalAlpha = 0.08;
  g.strokeStyle = '#fff';
  g.lineWidth = Math.max(1, s * 0.015);
  for (let i = -s; i < s * 2; i += s * 0.14) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s * 0.6, s); g.stroke(); }
  g.globalAlpha = 1;
  // 字形
  const glyph = icon?.glyph || fallbackGlyph || '?';
  const fs = glyph.length > 1 ? s * 0.38 : s * 0.56;
  g.font = `900 ${Math.round(fs)}px 'Noto Serif SC', 'Songti SC', 'SimSun', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.75)';
  g.shadowBlur = s * 0.08;
  g.shadowOffsetY = s * 0.02;
  g.fillStyle = icon?.fg || '#fff8e8';
  g.fillText(glyph, s / 2, s * 0.54);
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  // 暗角
  const vg = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = vg;
  g.fillRect(0, 0, s, s);
  g.restore();
}

// icon → dataURL（带缓存）
export function iconURL(icon, size = 64, { glyph = null, frame = true } = {}) {
  const px = Math.round(size);
  if (icon && typeof icon === 'object') {
    let m = cache.get(icon);
    if (!m) { m = new Map(); cache.set(icon, m); }
    const k = px + (frame ? 'f' : '') + (glyph || '');
    let url = m.get(k);
    if (!url) { url = paint(icon, px, glyph, frame); m.set(k, url); }
    return url;
  }
  const k = `g:${glyph}:${px}:${frame}`;
  let url = keyCache.get(k);
  if (!url) { url = paint(null, px, glyph, frame); keyCache.set(k, url); }
  return url;
}

function paint(icon, s, glyph, frame) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  let ownFrame = false;
  if (icon && typeof icon.draw === 'function') {
    try {
      g.save(); icon.draw(g, s); g.restore();
      ownFrame = !!(icon.frame || icon.tier);
    } catch {
      g.clearRect(0, 0, s, s);
      drawGlyphIcon(g, s, icon, glyph);
    }
  } else {
    drawGlyphIcon(g, s, icon, glyph);
  }
  if (frame && !ownFrame) drawHexFrame(g, s);
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
