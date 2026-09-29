// 程序化图标插画：纯 Canvas 2D 矢量绘制（渐变 / 高光 / 描边 / 阴影），在 100×100 的逻辑坐标系中作画
// 导出：drawItemIcon / drawAbilityIcon / drawSummonerIcon / drawBuffIcon / drawUnitIcon
// 约定：只画底图与主体，不画外框（外框由 icons.js 统一绘制）；任何图标都不绘制文字
const TAU = Math.PI * 2;
const OUT = 'rgba(12,7,3,0.92)';
let K = 1; // 当前像素 / 逻辑单位（shadowBlur 与 shadowOffset 不受变换影响，需要手动换算）

// ============================================================
// 颜色工具
// ============================================================
function parse(c) {
  if (typeof c !== 'string') return [128, 128, 128];
  let s = c.trim();
  if (s[0] === '#') {
    s = s.slice(1);
    if (s.length === 3) s = s.split('').map((x) => x + x).join('');
    const n = parseInt(s.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/[\d.]+/g);
  return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
// t>0 提亮，t<0 压暗
export function shade(c, t) {
  const [r, g, b] = parse(c);
  if (t >= 0) return hex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
  return hex(r * (1 + t), g * (1 + t), b * (1 + t));
}
function alpha(c, a) { const [r, g, b] = parse(c); return `rgba(${r},${g},${b},${a})`; }
function mix(a, b, t) { const x = parse(a), y = parse(b); return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); }
// 由一个主色生成材质四色 [高光, 亮, 中, 暗]
function tone(c) { return [shade(c, 0.75), shade(c, 0.2), shade(c, -0.3), shade(c, -0.72)]; }

// 材质：[高光, 亮, 中, 暗]
const M = {
  steel: ['#ffffff', '#d6dfea', '#7c899b', '#2a323d'],
  silver: ['#ffffff', '#e8eef5', '#9aa6b6', '#3a4450'],
  gold: ['#fff8d2', '#f6d270', '#b98a2c', '#553608'],
  bronze: ['#ffe4bc', '#d49a5e', '#86522a', '#3a1f0a'],
  dark: ['#a0a6b2', '#50566a', '#23262f', '#0a0b10'],
  black: ['#7a7f8e', '#353946', '#16181f', '#050608'],
  leather: ['#eec08e', '#a8703c', '#6a3e1a', '#2c1606'],
  wood: ['#e6b882', '#9c6a36', '#5e3816', '#24140a'],
  red: ['#ffd6cc', '#ff5a48', '#b3141e', '#460308'],
  blood: ['#ff9a9a', '#e0202e', '#86060e', '#300004'],
  orange: ['#fff0c8', '#ffa040', '#c04a0c', '#4a1404'],
  fire: ['#fffbe0', '#ffd23a', '#ff6a1a', '#8a1400'],
  blue: ['#eaf7ff', '#6cc4ff', '#1c62c8', '#081e48'],
  ice: ['#ffffff', '#c8f2ff', '#5ab4e8', '#12406e'],
  cyan: ['#eafffc', '#6ef0e0', '#149c9a', '#063838'],
  purple: ['#f4e6ff', '#b884ff', '#5a24b0', '#1c0846'],
  violet: ['#ffe6ff', '#e27cff', '#8a1fb0', '#2e0640'],
  pink: ['#fff0f8', '#ff8ccf', '#c0287a', '#4a0428'],
  green: ['#e8ffe4', '#72e27c', '#1e8a3a', '#07301a'],
  lime: ['#f8ffe0', '#c8f05a', '#6a9a14', '#223a04'],
  teal: ['#e4fff4', '#5affb8', '#0f8a5c', '#033a26'],
  cloth: ['#fff4dc', '#dcc49a', '#8e7450', '#3a2c18'],
  stone: ['#eceae4', '#a8a498', '#625e54', '#26241e'],
};

// ============================================================
// 绘图工具
// ============================================================
function stops(gr, list) {
  list.forEach((c, i) => { if (Array.isArray(c)) gr.addColorStop(c[0], c[1]); else gr.addColorStop(list.length > 1 ? i / (list.length - 1) : 0, c); });
  return gr;
}
function lg(g, x0, y0, x1, y1, ...list) { return stops(g.createLinearGradient(x0, y0, x1, y1), list); }
function rg(g, x, y, r, ...list) { return stops(g.createRadialGradient(x, y, 0, x, y, Math.max(0.01, r)), list); }
// 金属质感横向渐变（带一道高光）
function metal(g, x0, y0, x1, y1, m) { return lg(g, x0, y0, x1, y1, [0, m[2]], [0.28, m[0]], [0.5, m[1]], [0.78, m[2]], [1, m[3]]); }
// 竖直材质渐变（上亮下暗）
function vmat(g, y0, y1, m) { return lg(g, 0, y0, 0, y1, [0, m[0]], [0.3, m[1]], [0.75, m[2]], [1, m[3]]); }

function shadow(g, blur = 5, oy = 2, c = 'rgba(0,0,0,0.7)') { g.shadowColor = c; g.shadowBlur = blur * K; g.shadowOffsetX = 0; g.shadowOffsetY = oy * K; }
function noShadow(g) { g.shadowColor = 'rgba(0,0,0,0)'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0; }
function fs(g, fill, lw = 2, stroke = OUT) {
  g.fillStyle = fill; g.fill();
  if (lw) { noShadow(g); g.lineWidth = lw; g.strokeStyle = stroke; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
}
// 带投影的填充 + 描边
function body(g, fill, lw = 2, stroke = OUT, blur = 5) { g.save(); shadow(g, blur, 2); g.fillStyle = fill; g.fill(); g.restore(); if (lw) { g.lineWidth = lw; g.strokeStyle = stroke; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); } }
function poly(g, pts) { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); }
function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.01, r), 0, TAU); }
function ell(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); }
function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function line(g, x0, y0, x1, y1, c, lw = 2) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'round'; g.stroke(); }
function T(g, x, y, rot, sc, fn) { g.save(); g.translate(x, y); if (rot) g.rotate(rot); if (sc && sc !== 1) g.scale(sc, sc); fn(); g.restore(); }
// 以 (cx,cy) 为中心、角度 a 摆放一个沿 -y 方向延伸的长条物件（局部 y 范围 [y0,y1]）
function place(g, cx, cy, a, y0, y1, fn, sc = 1) { g.save(); g.translate(cx, cy); g.rotate(a); g.scale(sc, sc); g.translate(0, -(y0 + y1) / 2); fn(); g.restore(); }
// 发光（加色混合）
function glow(g, x, y, r, c, a = 0.8) {
  g.save(); g.globalCompositeOperation = 'lighter';
  g.fillStyle = rg(g, x, y, r, [0, alpha(c, a)], [0.4, alpha(c, a * 0.35)], [1, alpha(c, 0)]);
  g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
}
function starPath(g, x, y, n, ro, ri, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? ri : ro, a = rot + (i * Math.PI) / n; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
  g.closePath();
}
// 四角星闪光
function sparkle(g, x, y, r, c = '#ffffff', a = 1) {
  g.save(); g.globalAlpha *= a; glow(g, x, y, r * 1.6, c, 0.6);
  starPath(g, x, y, 4, r, r * 0.22); g.fillStyle = '#ffffff'; g.fill(); g.restore();
}
function rays(g, x, y, r0, r1, n, c, lw = 2, rot = 0, a = 0.8) {
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const t = rot + (i / n) * TAU;
    g.strokeStyle = lg(g, x + Math.cos(t) * r0, y + Math.sin(t) * r0, x + Math.cos(t) * r1, y + Math.sin(t) * r1, alpha(c, a), alpha(c, 0));
    g.lineWidth = lw; g.beginPath(); g.moveTo(x + Math.cos(t) * r0, y + Math.sin(t) * r0); g.lineTo(x + Math.cos(t) * r1, y + Math.sin(t) * r1); g.stroke();
  }
  g.restore();
}
function ring(g, x, y, r, c, lw = 3, a0 = 0, a1 = TAU) { g.beginPath(); g.arc(x, y, r, a0, a1); g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'round'; g.stroke(); }
// 发光弧线（运动轨迹）
function streak(g, x0, y0, x1, y1, c, lw = 4, a = 0.9) {
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  g.strokeStyle = lg(g, x0, y0, x1, y1, alpha(c, 0), alpha(c, a)); g.lineWidth = lw;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore();
}
function swirl(g, x, y, r0, r1, turns, c, lw = 3, a = 0.9, rot = 0) {
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  const N = 48;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const p = (t) => { const ang = rot + t * turns * TAU, r = r0 + (r1 - r0) * t; return [x + Math.cos(ang) * r, y + Math.sin(ang) * r]; };
    const [ax, ay] = p(t0), [bx, by] = p(t1);
    g.strokeStyle = alpha(c, a * t1); g.lineWidth = lw * (0.3 + 0.7 * t1);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  }
  g.restore();
}
// 火焰轮廓：底部中心 (x,y)，宽 w，高 h，lean 为火尖水平偏移
function flamePath(g, x, y, w, h, lean = 0) {
  const tx = x + lean;
  g.beginPath();
  g.moveTo(tx, y - h);
  g.bezierCurveTo(tx + w * 0.12, y - h * 0.62, x + w * 0.58, y - h * 0.5, x + w * 0.5, y - h * 0.16);
  g.bezierCurveTo(x + w * 0.45, y + h * 0.04, x + w * 0.22, y + h * 0.1, x, y + h * 0.1);
  g.bezierCurveTo(x - w * 0.22, y + h * 0.1, x - w * 0.45, y + h * 0.04, x - w * 0.5, y - h * 0.16);
  g.bezierCurveTo(x - w * 0.58, y - h * 0.5, tx - w * 0.12, y - h * 0.62, tx, y - h);
  g.closePath();
}
function flame(g, x, y, w, h, m = M.fire, lean = 0, outline = true) {
  glow(g, x, y - h * 0.4, Math.max(w, h) * 0.8, m[2], 0.55);
  flamePath(g, x, y, w, h, lean);
  g.fillStyle = lg(g, 0, y - h, 0, y + h * 0.1, [0, m[1]], [0.55, m[2]], [1, m[3]]);
  g.fill();
  if (outline) { g.lineWidth = 1.4; g.strokeStyle = alpha(m[3], 0.9); g.stroke(); }
  flamePath(g, x, y, w * 0.55, h * 0.62, lean * 0.6);
  g.fillStyle = lg(g, 0, y - h * 0.62, 0, y, [0, m[0]], [1, m[1]]); g.fill();
}
function drop(g, x, y, r, m = M.blood) {
  g.beginPath(); g.moveTo(x, y - r * 2.1);
  g.bezierCurveTo(x + r * 0.4, y - r * 1.2, x + r, y - r * 0.5, x + r, y);
  g.arc(x, y, r, 0, Math.PI); g.bezierCurveTo(x - r, y - r * 0.5, x - r * 0.4, y - r * 1.2, x, y - r * 2.1); g.closePath();
  body(g, rg(g, x - r * 0.3, y - r * 0.4, r * 1.6, m[0], m[1], m[2], m[3]), 1.4, OUT, 3);
  ell(g, x - r * 0.35, y - r * 0.3, r * 0.22, r * 0.4, -0.4); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
}
function heartPath(g, x, y, s) {
  g.beginPath(); g.moveTo(x, y + s * 0.85);
  g.bezierCurveTo(x - s * 1.15, y + s * 0.05, x - s * 0.75, y - s * 1.0, x, y - s * 0.42);
  g.bezierCurveTo(x + s * 0.75, y - s * 1.0, x + s * 1.15, y + s * 0.05, x, y + s * 0.85);
  g.closePath();
}
// 宝石（圆形刻面）
function gem(g, x, y, r, m = M.red, lw = 1.4) {
  circ(g, x, y, r); body(g, rg(g, x - r * 0.35, y - r * 0.35, r * 1.5, m[0], m[1], m[2], m[3]), lw, OUT, 3);
  ell(g, x - r * 0.32, y - r * 0.38, r * 0.34, r * 0.2, -0.6); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
}
// 刻面水晶（竖直八边形）
function crystal(g, x, y, w, h, m) {
  const pts = [x, y - h / 2, x + w * 0.5, y - h * 0.2, x + w * 0.5, y + h * 0.2, x, y + h / 2, x - w * 0.5, y + h * 0.2, x - w * 0.5, y - h * 0.2];
  glow(g, x, y, Math.max(w, h) * 0.75, m[1], 0.45);
  poly(g, pts); body(g, lg(g, x - w / 2, y - h / 2, x + w / 2, y + h / 2, m[0], m[1], m[2], m[3]), 2);
  // 刻面
  g.save(); poly(g, pts); g.clip();
  poly(g, [x, y - h / 2, x + w * 0.5, y - h * 0.2, x, y, x - w * 0.5, y - h * 0.2]); g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
  poly(g, [x, y, x + w * 0.5, y - h * 0.2, x + w * 0.5, y + h * 0.2, x, y + h / 2]); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fill();
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x - w * 0.5, y - h * 0.2); g.lineTo(x, y); g.lineTo(x + w * 0.5, y - h * 0.2); g.moveTo(x, y); g.lineTo(x, y + h / 2); g.stroke();
  sparkle(g, x - w * 0.18, y - h * 0.26, Math.min(w, h) * 0.14);
}
// 箭：尾部 (0,0) 指向 +x，长度 len
function arrow(g, len, shaft = M.wood, head = M.steel, fl = '#e8f6ff', lw = 2.6) {
  line(g, 0, 0, len - 7, 0, OUT, lw + 1.6); line(g, 0, 0, len - 7, 0, shaft[1], lw);
  poly(g, [len, 0, len - 10, -5, len - 8, 0, len - 10, 5]); fs(g, metal(g, len - 10, -5, len - 10, 5, head), 1.3);
  poly(g, [0, 0, 6, 0, 1, -5, -4, -5]); fs(g, fl, 1); poly(g, [0, 0, 6, 0, 1, 5, -4, 5]); fs(g, shade(fl, -0.2), 1);
}
// 闪电折线
function bolt(g, pts, c = '#bff4ff', lw = 3) {
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineJoin = 'round'; g.lineCap = 'round';
  for (const [w, a] of [[lw * 3.2, 0.25], [lw * 1.8, 0.5], [lw, 1]]) {
    g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.strokeStyle = a === 1 ? '#ffffff' : alpha(c, a); g.lineWidth = w; g.stroke();
  }
  g.restore();
}
function chainLinks(g, x0, y0, x1, y1, n, m = M.steel, sz = 4) {
  const dx = x1 - x0, dy = y1 - y0, a = Math.atan2(dy, dx);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    T(g, x0 + dx * t, y0 + dy * t, a, 1, () => {
      ell(g, 0, 0, sz * 1.1, sz * (i % 2 ? 0.45 : 0.75));
      g.lineWidth = sz * 0.9; g.strokeStyle = OUT; g.stroke(); g.lineWidth = sz * 0.5; g.strokeStyle = i % 2 ? m[2] : m[1]; g.stroke();
    });
  }
}

// ============================================================
// 背景
// ============================================================
function bgColors(def, fb) {
  const b = def?.icon?.bg;
  if (Array.isArray(b) && b.length) return [b[0], b[1] || shade(b[0], -0.6)];
  if (typeof b === 'string') return [b, shade(b, -0.6)];
  return fb;
}
// 装备底：暗色基底 + 主色中心光晕 + 细纹 + 暗角
function paintItemBg(g, c1, c2) {
  g.fillStyle = lg(g, 0, 0, 60, 100, mix(c2, '#000', 0.25), mix(c2, '#000', 0.6)); g.fillRect(0, 0, 100, 100);
  g.fillStyle = rg(g, 50, 46, 58, [0, alpha(mix(c1, c2, 0.35), 0.8)], [0.55, alpha(c2, 0.35)], [1, 'rgba(0,0,0,0)']); g.fillRect(0, 0, 100, 100);
  g.save(); g.globalAlpha = 0.07; g.strokeStyle = '#fff'; g.lineWidth = 1;
  for (let i = -100; i < 200; i += 9) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 60, 100); g.stroke(); }
  g.restore();
}
// 技能底：更强烈的中心光与放射纹
function paintAbilityBg(g, c1, c2) {
  g.fillStyle = lg(g, 0, 0, 100, 100, mix(c2, '#000', 0.1), mix(c2, '#000', 0.55)); g.fillRect(0, 0, 100, 100);
  g.fillStyle = rg(g, 50, 50, 64, [0, alpha(c1, 0.55)], [0.5, alpha(mix(c1, c2, 0.5), 0.25)], [1, 'rgba(0,0,0,0)']); g.fillRect(0, 0, 100, 100);
  rays(g, 50, 50, 10, 75, 16, c1, 5, 0.1, 0.08);
}
function vignette(g, a = 0.55) {
  g.fillStyle = rg(g, 50, 50, 72, [0, 'rgba(0,0,0,0)'], [0.62, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${a})`]); g.fillRect(0, 0, 100, 100);
  g.fillStyle = lg(g, 0, 0, 0, 100, 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0)', [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.25)']); g.fillRect(0, 0, 100, 100);
}

// ============================================================
// 物件：武器
// ============================================================
// 剑：护手中心在原点，刃沿 -y；返回占用的 y 范围
function sword(g, o = {}) {
  const len = o.len ?? 58, w = o.w ?? 10, gl = o.grip ?? 14, gw = o.guardW ?? 26;
  const B = o.blade || M.steel, G = o.guard || M.gold, H = o.hilt || M.leather;
  const style = o.style || 'straight';
  if (o.glow) glow(g, 0, -len * 0.5, len * 0.62, o.glow, o.glowA ?? 0.55);
  g.beginPath();
  if (style === 'broad') { g.moveTo(-w / 2, 0); g.lineTo(-w * 0.62, -len * 0.62); g.lineTo(-w * 0.52, -len + w * 0.8); g.lineTo(0, -len); g.lineTo(w * 0.52, -len + w * 0.8); g.lineTo(w * 0.62, -len * 0.62); g.lineTo(w / 2, 0); }
  else if (style === 'curved') { g.moveTo(-w / 2, 0); g.quadraticCurveTo(-w * 0.9, -len * 0.62, w * 0.75, -len); g.quadraticCurveTo(w * 0.8, -len * 0.45, w / 2, 0); }
  else if (style === 'jagged') {
    g.moveTo(-w / 2, 0); g.lineTo(-w / 2, -len + w); g.lineTo(0, -len); g.lineTo(w / 2, -len + w);
    const n = 6; for (let i = 1; i <= n; i++) { const y = -len + w + ((len - w) * i) / n; g.lineTo(w / 2 + (i % 2 ? w * 0.42 : 0), y - (len - w) / n / 2); g.lineTo(w / 2, y); }
  }
  else if (style === 'cleaver') { g.moveTo(-w / 2, 0); g.lineTo(-w / 2, -len + 3); g.quadraticCurveTo(-w / 2, -len, 0, -len); g.lineTo(w * 0.85, -len + w * 0.6); g.lineTo(w / 2, 0); }
  else if (style === 'wave') {
    g.moveTo(-w / 2, 0); const n = 4;
    for (let i = 1; i <= n; i++) { const y = -((len - w) * i) / n; g.quadraticCurveTo(-w * 0.85, y + (len - w) / n / 2, -w / 2, y); }
    g.lineTo(0, -len);
    for (let i = n; i >= 1; i--) { const y = -((len - w) * (i - 1)) / n; g.quadraticCurveTo(w * 0.85, y - (len - w) / n / 2, w / 2, y); }
  }
  else { g.moveTo(-w / 2, 0); g.lineTo(-w / 2, -len + w * 1.1); g.lineTo(0, -len); g.lineTo(w / 2, -len + w * 1.1); g.lineTo(w / 2, 0); }
  g.closePath();
  body(g, lg(g, -w * 0.7, 0, w * 0.7, 0, [0, B[2]], [0.3, B[0]], [0.55, B[1]], [1, B[3]]), 2);
  // 中脊 / 血槽
  if (o.fuller) { rr(g, -w * 0.16, -len * 0.8, w * 0.32, len * 0.72, w * 0.16); g.fillStyle = o.fuller; g.fill(); }
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(-w * 0.18, -4); g.lineTo(-w * 0.18, -len + w * 1.6); g.stroke();
  // 护手
  if (o.guardStyle === 'bar') { rr(g, -gw / 2, -3, gw, 6, 3); body(g, metal(g, 0, -3, 0, 3, G), 1.8, OUT, 3); }
  else {
    g.beginPath(); g.moveTo(0, -3.5);
    g.quadraticCurveTo(-gw * 0.3, -2.5, -gw / 2, -9); g.quadraticCurveTo(-gw * 0.42, 3.5, -3, 4.5); g.lineTo(3, 4.5);
    g.quadraticCurveTo(gw * 0.42, 3.5, gw / 2, -9); g.quadraticCurveTo(gw * 0.3, -2.5, 0, -3.5); g.closePath();
    body(g, lg(g, 0, -9, 0, 5, G[0], G[1], G[2], G[3]), 1.8, OUT, 3);
  }
  // 握柄
  rr(g, -2.8, 4, 5.6, gl, 1.8); fs(g, metal(g, -2.8, 0, 2.8, 0, H), 1.6);
  g.strokeStyle = alpha(H[3], 0.8); g.lineWidth = 0.9;
  for (let y = 6; y < 4 + gl; y += 3) { g.beginPath(); g.moveTo(-2.8, y); g.lineTo(2.8, y + 2); g.stroke(); }
  circ(g, 0, 4 + gl + 3.4, 3.8); fs(g, rg(g, -1, 3 + gl + 2.4, 5, G[0], G[1], G[2]), 1.6);
  if (o.gem) gem(g, 0, 0.6, o.gemR ?? 3.4, o.gem, 1.2);
  if (o.pommelGem) gem(g, 0, 4 + gl + 3.4, 2.2, o.pommelGem, 1);
  return [-len, 4 + gl + 7.5];
}
function placeSword(g, o, a = Math.PI / 4, cx = 50, cy = 50, sc = 1.1) {
  const len = o.len ?? 58, gl = o.grip ?? 14;
  place(g, cx, cy, a, -len, 4 + gl + 7.5, () => sword(g, o), sc);
}
// 斧：柄沿 y，头在上方右侧
function axe(g, o = {}) {
  const len = o.len ?? 70, t = -len / 2, Hd = o.head || M.dark, Hn = o.handle || M.wood, edge = o.edge || null;
  rr(g, -3, t - 2, 6, len + 2, 3); body(g, metal(g, -3, 0, 3, 0, Hn), 1.8);
  const head = (sx) => {
    g.save(); g.scale(sx, 1);
    g.beginPath(); g.moveTo(2, t + 2); g.lineTo(9, t);
    g.quadraticCurveTo(20, t - 5, 27, t - 14); g.quadraticCurveTo(36, t + 8, 29, t + 30);
    g.quadraticCurveTo(20, t + 20, 9, t + 20); g.lineTo(2, t + 18); g.closePath();
    body(g, lg(g, 2, t - 10, 30, t + 30, Hd[0], Hd[1], Hd[2], Hd[3]), 2);
    if (edge) { g.beginPath(); g.moveTo(27, t - 14); g.quadraticCurveTo(36, t + 8, 29, t + 30); g.quadraticCurveTo(29, t + 8, 24, t - 8); g.closePath(); g.fillStyle = edge; g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(11, t + 3); g.quadraticCurveTo(20, t + 2, 25, t - 6); g.stroke();
    g.restore();
  };
  head(1); if (o.double) head(-1);
  rr(g, -4.5, t + 1, 9, 18, 2); fs(g, metal(g, -4.5, 0, 4.5, 0, o.collar || M.bronze), 1.6);
  if (o.spike) { poly(g, [-3, t - 1, 0, t - 12, 3, t - 1]); fs(g, metal(g, -3, 0, 3, 0, Hd), 1.5); }
  circ(g, 0, len / 2 + 2, 3.5); fs(g, o.collar ? o.collar[1] : M.bronze[1], 1.5);
}
function hammer(g, o = {}) {
  const len = o.len ?? 66, t = -len / 2, Hd = o.head || M.steel, Hn = o.handle || M.wood, hw = o.hw ?? 38, hh = o.hh ?? 20;
  rr(g, -3, t, 6, len, 3); body(g, metal(g, -3, 0, 3, 0, Hn), 1.8);
  rr(g, -hw / 2, t - hh / 2, hw, hh, 3.5); body(g, lg(g, 0, t - hh / 2, 0, t + hh / 2, Hd[0], Hd[1], Hd[2], Hd[3]), 2);
  if (o.claw) { poly(g, [hw / 2, t - hh / 2 + 2, hw / 2 + 9, t - hh / 2 - 6, hw / 2 + 5, t + 2, hw / 2, t + hh / 2 - 2]); fs(g, metal(g, hw / 2, 0, hw / 2 + 9, 0, Hd), 1.6); }
  rr(g, -5, t - hh / 2 - 1, 10, hh + 2, 2); fs(g, metal(g, -5, 0, 5, 0, o.band || M.gold), 1.5);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-hw / 2 + 3, t - hh / 2 + 2.5, hw - 6, 2.5);
  if (o.gem) gem(g, 0, t, 3.4, o.gem, 1.1);
  circ(g, 0, len / 2 + 2, 3.5); fs(g, (o.band || M.gold)[1], 1.5);
}
function pickaxe(g, o = {}) {
  const len = o.len ?? 68, t = -len / 2, Hd = o.head || M.steel;
  rr(g, -3, t, 6, len, 3); body(g, metal(g, -3, 0, 3, 0, o.handle || M.wood), 1.8);
  g.beginPath(); g.moveTo(-34, t + 12); g.quadraticCurveTo(-16, t - 8, 0, t - 7); g.quadraticCurveTo(16, t - 8, 34, t + 12);
  g.quadraticCurveTo(16, t + 1, 0, t + 3); g.quadraticCurveTo(-16, t + 1, -34, t + 12); g.closePath();
  body(g, lg(g, 0, t - 8, 0, t + 8, Hd[0], Hd[1], Hd[2], Hd[3]), 2);
  rr(g, -5, t - 7, 10, 12, 2); fs(g, metal(g, -5, 0, 5, 0, M.bronze), 1.5);
}
function dagger(g, o = {}) { return sword(g, { len: 34, w: 9, grip: 11, guardW: 18, guardStyle: 'bar', ...o }); }
// 弓：弓身为竖直弧线，箭向右
function bow(g, o = {}) {
  const r = o.r ?? 34, m = o.m || M.wood, str = o.string || '#f0e6d2';
  g.save();
  g.beginPath(); g.moveTo(-6, -r); g.lineTo(-6, r); g.strokeStyle = str; g.lineWidth = 1.3; g.stroke();
  g.beginPath(); g.moveTo(-6, -r); g.bezierCurveTo(-1, -r - 4, 18, -r * 0.55, 16, 0); g.bezierCurveTo(18, r * 0.55, -1, r + 4, -6, r);
  g.lineWidth = 8; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 5.2; g.strokeStyle = lg(g, 0, -r, 0, r, m[0], m[1], m[2], m[1], m[3]); g.stroke();
  rr(g, 12, -6, 7, 12, 2); fs(g, metal(g, 12, 0, 19, 0, o.grip || M.leather), 1.4);
  if (o.tips) { for (const sy of [-1, 1]) { poly(g, [-6, sy * r, -12, sy * (r + 6), -3, sy * (r - 2)]); fs(g, o.tips[1], 1.2); } }
  g.restore();
}
function crossbowShape(g, o = {}) {
  const m = o.m || M.dark, lim = o.limb || M.steel;
  rr(g, -32, -4, 58, 8, 3); body(g, metal(g, 0, -4, 0, 4, m), 1.8);
  g.beginPath(); g.moveTo(16, -30); g.quadraticCurveTo(6, 0, 16, 30); g.lineWidth = 7; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 4.4; g.strokeStyle = metal(g, 0, -30, 0, 30, lim); g.stroke();
  line(g, 16, -30, -4, 0, '#e8e0d0', 1.1); line(g, 16, 30, -4, 0, '#e8e0d0', 1.1);
  poly(g, [26, -4, 38, 0, 26, 4]); fs(g, metal(g, 26, -4, 26, 4, lim), 1.4);
  rr(g, -34, -3, 10, 14, 2); fs(g, metal(g, -34, 0, -24, 0, M.wood), 1.4);
}
// 法杖：杖身沿 y，顶端宝珠
function staff(g, o = {}) {
  const len = o.len ?? 70, t = -len / 2, S = o.shaft || M.wood, O = o.orb || M.purple, R = o.orbR ?? 10;
  rr(g, -2.8, t + R * 0.6, 5.6, len - R * 0.6, 2.8); body(g, metal(g, -2.8, 0, 2.8, 0, S), 1.7);
  for (const y of [t + len * 0.45, t + len * 0.78]) { rr(g, -4, y, 8, 3.5, 1.5); fs(g, metal(g, -4, 0, 4, 0, o.band || M.gold), 1.2); }
  glow(g, 0, t, R * 2.6, O[1], 0.75);
  if (o.head === 'claw') {
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, t + R * 0.9); g.quadraticCurveTo(s * R * 1.6, t + R * 0.4, s * R * 1.05, t - R * 1.2); g.quadraticCurveTo(s * R * 0.9, t + R * 0.2, 0, t + R * 1.5); g.closePath(); body(g, metal(g, -R, 0, R, 0, o.band || M.gold), 1.5, OUT, 3); }
  } else if (o.head === 'crescent') {
    g.beginPath(); g.arc(0, t, R * 1.45, Math.PI * 0.15, Math.PI * 0.85, false); g.arc(0, t - R * 0.25, R * 1.15, Math.PI * 0.8, Math.PI * 0.2, true); g.closePath();
    body(g, metal(g, -R, 0, R, 0, o.band || M.gold), 1.5, OUT, 3);
  } else if (o.head === 'ring') {
    ring(g, 0, t, R * 1.35, OUT, 5); ring(g, 0, t, R * 1.35, (o.band || M.gold)[1], 3);
  }
  gem(g, 0, t, R, O, 1.6);
}
// 书：正面封面（略带透视），emblem 在封面中心绘制
function book(g, o = {}) {
  const C = o.cover || M.blue, P = o.pages || '#efe4c8';
  // 书页厚度
  poly(g, [-22, -26, 20, -30, 26, -24, 26, 30, -16, 34, -22, 30]); body(g, lg(g, 0, -30, 0, 34, shade(P, 0.2), P, shade(P, -0.35)), 1.8);
  g.strokeStyle = alpha(shade(P, -0.5), 0.6); g.lineWidth = 0.8;
  for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(20 + i * 1.1, -28 + i * 1.1); g.lineTo(20 + i * 1.1, 32 - i * 0.5); g.stroke(); }
  // 封面
  poly(g, [-24, -28, 19, -32, 21, 28, -22, 32]); body(g, lg(g, -24, -32, 21, 32, C[0], C[1], C[2], C[3]), 2);
  // 书脊
  poly(g, [-24, -28, -17, -29, -15, 31, -22, 32]); fs(g, lg(g, -24, 0, -15, 0, C[3], C[2]), 1.4);
  // 金角
  const cg = o.trim || M.gold;
  for (const [x, y, dx, dy] of [[19, -32, -1, 1], [21, 28, -1, -1]]) { poly(g, [x, y, x + dx * 9, y + dy * 0.5, x + dx * 0.5, y + dy * 9]); fs(g, cg[1], 1.2); }
  rr(g, -12, -22, 28, 44, 3); g.strokeStyle = alpha(cg[1], 0.9); g.lineWidth = 1.6; g.stroke();
  if (o.emblem) T(g, 2, 0, 0, 1, () => o.emblem(g));
}
function openBook(g, o = {}) {
  const C = o.cover || M.blue, P = o.pages || '#f4ead0';
  poly(g, [-40, 10, 0, 20, 40, 10, 40, 16, 0, 27, -40, 16]); body(g, lg(g, 0, 10, 0, 27, C[1], C[3]), 1.8);
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(0, 18); g.quadraticCurveTo(s * 18, 8, s * 38, 12); g.lineTo(s * 36, -22); g.quadraticCurveTo(s * 18, -26, 0, -16); g.closePath();
    body(g, lg(g, s * 38, 0, 0, 0, shade(P, -0.15), P, shade(P, -0.3)), 1.6);
    g.strokeStyle = 'rgba(80,60,30,0.45)'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const y = -12 + i * 7; g.beginPath(); g.moveTo(s * 7, y + 1); g.quadraticCurveTo(s * 18, y - 3, s * 30, y); g.stroke(); }
  }
  if (o.emblem) o.emblem(g);
}
function hourglass(g, o = {}) {
  const F = o.frame || M.gold, S = o.sand || M.gold;
  for (const y of [-34, 28]) { rr(g, -24, y, 48, 7, 3); body(g, metal(g, 0, y, 0, y + 7, F), 1.8, OUT, 3); }
  for (const x of [-20, 17]) { rr(g, x, -28, 3.5, 56, 1.5); fs(g, metal(g, x, 0, x + 3.5, 0, F), 1.3); }
  g.beginPath(); g.moveTo(-15, -27); g.lineTo(15, -27); g.bezierCurveTo(15, -8, 3, -6, 3, 0); g.bezierCurveTo(3, 6, 15, 8, 15, 27); g.lineTo(-15, 27); g.bezierCurveTo(-15, 8, -3, 6, -3, 0); g.bezierCurveTo(-3, -6, -15, -8, -15, -27); g.closePath();
  g.fillStyle = 'rgba(200,235,255,0.22)'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = 'rgba(230,248,255,0.8)'; g.stroke();
  // 沙
  g.beginPath(); g.moveTo(-10, -14); g.lineTo(10, -14); g.bezierCurveTo(8, -6, 2, -4, 1, 0); g.lineTo(-1, 0); g.bezierCurveTo(-2, -4, -8, -6, -10, -14); g.closePath(); g.fillStyle = lg(g, 0, -14, 0, 0, S[1], S[2]); g.fill();
  g.beginPath(); g.moveTo(-14, 26); g.quadraticCurveTo(0, 8, 14, 26); g.closePath(); g.fillStyle = lg(g, 0, 10, 0, 26, S[0], S[2]); g.fill();
  line(g, 0, 0, 0, 16, S[1], 1.2);
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-12, -24, 2.5, 14);
}
// 药瓶
function flask(g, o = {}) {
  const L = o.liquid || M.red, shape = o.shape || 'round';
  const path = () => {
    g.beginPath();
    if (shape === 'round') { g.moveTo(-6, -30); g.lineTo(-6, -14); g.arc(0, 8, 23, -Math.PI / 2 - 0.26, Math.PI * 1.5 + 0.26, true); g.lineTo(6, -14); g.lineTo(6, -30); }
    else if (shape === 'cone') { g.moveTo(-6, -32); g.lineTo(-6, -12); g.lineTo(-24, 26); g.quadraticCurveTo(-25, 32, -18, 32); g.lineTo(18, 32); g.quadraticCurveTo(25, 32, 24, 26); g.lineTo(6, -12); g.lineTo(6, -32); }
    else { g.moveTo(-7, -32); g.lineTo(-7, -20); g.quadraticCurveTo(-18, -16, -18, -4); g.lineTo(-18, 26); g.quadraticCurveTo(-18, 32, -12, 32); g.lineTo(12, 32); g.quadraticCurveTo(18, 32, 18, 26); g.lineTo(18, -4); g.quadraticCurveTo(18, -16, 7, -20); g.lineTo(7, -32); }
    g.closePath();
  };
  path(); g.save(); shadow(g, 6, 2); g.fillStyle = 'rgba(210,235,255,0.25)'; g.fill(); g.restore();
  // 液体（裁剪到瓶内下部）
  g.save(); path(); g.clip();
  const top = o.level ?? -6;
  g.fillStyle = lg(g, 0, top, 0, 34, L[0], [0.15, L[1]], [0.7, L[2]], [1, L[3]]); g.fillRect(-30, top, 60, 70);
  ell(g, 0, top, 30, 3); g.fillStyle = alpha(L[0], 0.7); g.fill();
  if (o.bubbles !== false) for (const [x, y, r] of [[-6, 14, 2.4], [5, 6, 1.6], [2, 20, 1.2], [8, 18, 2]]) { circ(g, x, y, r); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill(); }
  g.restore();
  path(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
  g.lineWidth = 1; g.strokeStyle = 'rgba(235,250,255,0.7)'; g.stroke();
  // 高光
  g.beginPath(); g.moveTo(-12, -2); g.quadraticCurveTo(-16, 10, -11, 20); g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2.4; g.lineCap = 'round'; g.stroke();
  // 瓶塞
  rr(g, -8.5, -38, 17, 9, 2.5); fs(g, metal(g, -8.5, 0, 8.5, 0, o.cork || M.wood), 1.6);
  rr(g, -8, -31, 16, 3.2, 1.2); fs(g, (o.band || M.gold)[1], 1.1);
}
// 胸甲
function chest(g, o = {}) {
  const A = o.m || M.steel;
  g.beginPath();
  g.moveTo(-12, -30); g.quadraticCurveTo(0, -24, 12, -30);
  g.lineTo(26, -26); g.quadraticCurveTo(34, -20, 32, -8); g.lineTo(24, -6);
  g.lineTo(22, 18); g.quadraticCurveTo(12, 32, 0, 34); g.quadraticCurveTo(-12, 32, -22, 18);
  g.lineTo(-24, -6); g.lineTo(-32, -8); g.quadraticCurveTo(-34, -20, -26, -26); g.closePath();
  body(g, metal(g, -32, 0, 32, 0, A), 2.2);
  g.save(); g.clip();
  if (o.chain) {
    g.strokeStyle = alpha(A[3], 0.55); g.lineWidth = 0.9;
    for (let y = -24; y < 36; y += 4) for (let x = -34 + ((y / 4) % 2 ? 2 : 0); x < 34; x += 4) { g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI); g.stroke(); }
  }
  if (o.cloth) { g.strokeStyle = alpha(A[3], 0.5); g.lineWidth = 1; for (let x = -18; x <= 18; x += 6) { g.beginPath(); g.moveTo(x, -26); g.quadraticCurveTo(x * 1.1, 4, x * 0.8, 34); g.stroke(); } }
  // 胸肌分割 / 高光
  g.strokeStyle = alpha(A[3], 0.7); g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, -24); g.lineTo(0, 30); g.stroke();
  g.beginPath(); g.moveTo(-20, 4); g.quadraticCurveTo(0, 12, 20, 4); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.22)'; ell(g, -10, -12, 7, 10, 0.2); g.fill();
  g.restore();
  // 领口
  g.beginPath(); g.moveTo(-12, -30); g.quadraticCurveTo(0, -18, 12, -30); g.lineWidth = 3.4; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 2; g.strokeStyle = (o.trim || M.gold)[1]; g.stroke();
  // 肩甲
  if (o.pauldrons) for (const s of [-1, 1]) { ell(g, s * 27, -20, 11, 8, s * 0.4); body(g, metal(g, s * 16, 0, s * 38, 0, o.pauldrons), 1.8, OUT, 3); }
  if (o.spikes) {
    const S = o.spikes;
    const list = [[-27, -27, -0.9], [27, -27, 0.9], [-33, -13, -1.4], [33, -13, 1.4], [-24, 10, -1.6], [24, 10, 1.6], [-12, 24, -2.2], [12, 24, 2.2], [0, -8, 0], [-10, 8, -0.4], [10, 8, 0.4]];
    for (const [x, y, a] of list) T(g, x, y, a, 1, () => { poly(g, [-3.2, 2, 0, -9, 3.2, 2]); fs(g, lg(g, -3, 0, 3, 0, S[0], S[2]), 1.2); });
  }
  if (o.emblem) o.emblem(g);
}
function shieldPath(g, kind = 'heater', s = 1) {
  g.beginPath();
  if (kind === 'round') { g.arc(0, 0, 32 * s, 0, TAU); }
  else if (kind === 'kite') { g.moveTo(0, -34 * s); g.quadraticCurveTo(26 * s, -30 * s, 28 * s, -14 * s); g.quadraticCurveTo(24 * s, 18 * s, 0, 36 * s); g.quadraticCurveTo(-24 * s, 18 * s, -28 * s, -14 * s); g.quadraticCurveTo(-26 * s, -30 * s, 0, -34 * s); }
  else { g.moveTo(-28 * s, -30 * s); g.quadraticCurveTo(0, -36 * s, 28 * s, -30 * s); g.lineTo(28 * s, -4 * s); g.quadraticCurveTo(26 * s, 22 * s, 0, 36 * s); g.quadraticCurveTo(-26 * s, 22 * s, -28 * s, -4 * s); }
  g.closePath();
}
function shield(g, o = {}) {
  const kind = o.kind || 'heater', F = o.face || M.blue, R = o.rim || M.gold;
  shieldPath(g, kind); body(g, metal(g, -32, 0, 32, 0, R), 2.2, OUT, 6);
  shieldPath(g, kind, 0.8); fs(g, rg(g, -8, -10, 40, F[0], F[1], F[2], F[3]), 1.4);
  if (o.boss) { gem(g, 0, 0, 7, o.boss, 1.4); }
  if (o.emblem) o.emblem(g);
  shieldPath(g, kind, 0.8); g.save(); g.clip(); g.fillStyle = 'rgba(255,255,255,0.14)'; poly(g, [-40, -40, 10, -40, -40, 30]); g.fill(); g.restore();
}
// 斗篷：领口扣 + 下摆飘动
function cloak(g, o = {}) {
  const C = o.m || M.blue, clasp = o.clasp || M.gold;
  g.beginPath(); g.moveTo(-10, -28); g.quadraticCurveTo(0, -24, 10, -28);
  g.bezierCurveTo(22, -18, 26, 6, 34, 28); g.quadraticCurveTo(24, 22, 18, 32); g.quadraticCurveTo(8, 24, 0, 34); g.quadraticCurveTo(-8, 24, -18, 32); g.quadraticCurveTo(-24, 22, -34, 28);
  g.bezierCurveTo(-26, 6, -22, -18, -10, -28); g.closePath();
  body(g, lg(g, -34, 0, 34, 0, C[2], C[1], C[0], C[1], C[3]), 2);
  g.save(); g.clip(); g.strokeStyle = alpha(C[3], 0.6); g.lineWidth = 1.6;
  for (const x of [-14, -4, 6, 16]) { g.beginPath(); g.moveTo(x * 0.4, -22); g.quadraticCurveTo(x * 0.9, 4, x * 1.4, 34); g.stroke(); }
  g.restore();
  if (o.hood) { g.beginPath(); g.moveTo(-14, -20); g.bezierCurveTo(-18, -44, 18, -44, 14, -20); g.quadraticCurveTo(0, -12, -14, -20); g.closePath(); body(g, lg(g, 0, -40, 0, -14, C[1], C[3]), 2, OUT, 3); ell(g, 0, -24, 8, 7); g.fillStyle = rg(g, 0, -24, 9, '#000', '#050308'); g.fill(); if (o.eyes) { for (const x of [-3.2, 3.2]) { glow(g, x, -25, 4, o.eyes, 0.9); circ(g, x, -25, 1.2); g.fillStyle = '#fff'; g.fill(); } } }
  else { g.beginPath(); g.moveTo(-12, -28); g.quadraticCurveTo(0, -20, 12, -28); g.lineWidth = 4; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 2.4; g.strokeStyle = C[0]; g.stroke(); }
  if (o.gem) gem(g, 0, o.hood ? -14 : -24, 5.5, o.gem, 1.4);
  else { circ(g, 0, o.hood ? -14 : -24, 5); fs(g, rg(g, -1, -26, 6, clasp[0], clasp[1], clasp[2]), 1.4); }
}
function boot(g, o = {}) {
  const B = o.m || M.leather, C = o.cuff || M.bronze, v = o.variant || 'plain';
  g.beginPath();
  g.moveTo(-14, -32); g.lineTo(8, -32); g.lineTo(8, 4);
  if (v === 'sorc') { g.quadraticCurveTo(22, 6, 30, 12); g.quadraticCurveTo(40, 8, 38, 0); g.quadraticCurveTo(44, 2, 42, 12); g.quadraticCurveTo(38, 24, 26, 24); }
  else if (v === 'plated') { g.lineTo(28, 8); g.quadraticCurveTo(36, 12, 34, 24); }
  else { g.quadraticCurveTo(26, 6, 32, 14); g.quadraticCurveTo(36, 24, 26, 24); }
  g.lineTo(-16, 24); g.quadraticCurveTo(-20, 18, -16, 8); g.closePath();
  body(g, lg(g, -16, -32, 34, 24, B[0], B[1], B[2], B[3]), 2.2, OUT, 6);
  // 鞋底
  rr(g, -18, 22, v === 'sorc' ? 46 : 54, 6, 2.5); fs(g, metal(g, 0, 22, 0, 28, o.sole || M.dark), 1.6);
  // 鞋口 / 翻边
  rr(g, -17, -36, 28, 9, 3); fs(g, metal(g, -17, 0, 11, 0, C), 1.7);
  if (v === 'plated') {
    for (const [y, w] of [[-22, 23], [-12, 23], [-2, 26]]) { rr(g, -15, y, w, 7, 1.5); fs(g, metal(g, -15, 0, w - 15, 0, M.steel), 1.2); }
    poly(g, [8, 6, 30, 10, 34, 22, 8, 22]); fs(g, metal(g, 8, 0, 34, 0, M.steel), 1.2);
    for (const [x, y] of [[-11, -19], [3, -19], [-11, -9], [3, -9], [20, 16]]) { circ(g, x, y, 1.3); g.fillStyle = '#2a2a2a'; g.fill(); }
  }
  if (v === 'berserk') {
    rr(g, -15, -20, 22, 14, 2); fs(g, metal(g, -15, 0, 7, 0, M.steel), 1.3);
    for (const y of [-28, -14, 0]) { poly(g, [-16, y, -26, y + 3, -16, y + 7]); fs(g, M.steel[1], 1.1); }
    poly(g, [20, 6, 30, -2, 27, 10]); fs(g, M.steel[1], 1.1);
  }
  if (v === 'mercs') { for (const s of [0, 1]) { g.beginPath(); g.moveTo(-15, -20 + s * 8); g.quadraticCurveTo(-30, -30 + s * 8, -36, -18 + s * 10); g.quadraticCurveTo(-26, -18 + s * 8, -15, -12 + s * 8); g.closePath(); fs(g, lg(g, -36, 0, -15, 0, '#ffffff', '#a8d4f0'), 1.2); } }
  if (v === 'ionian') { poly(g, [-4, -26, 2, -16, -4, -6, -10, -16]); fs(g, rg(g, -4, -16, 8, '#ffffff', '#8ad0ff', '#2a6ab0'), 1.2); g.beginPath(); g.moveTo(8, -10); g.quadraticCurveTo(24, -24, 34, -30); g.lineWidth = 2.2; g.strokeStyle = M.gold[1]; g.stroke(); }
  if (v === 'swift') { for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-15, -24 + i * 7); g.quadraticCurveTo(-32, -34 + i * 9, -40, -22 + i * 11); g.quadraticCurveTo(-28, -20 + i * 8, -15, -18 + i * 7); g.closePath(); fs(g, lg(g, -40, 0, -15, 0, '#f4fff0', '#8ee07a'), 1.1); } }
  if (v === 'sorc') { gem(g, -3, -16, 5, M.purple, 1.3); }
  if (v === 'plain' || v === 'berserk') { g.strokeStyle = alpha(B[3], 0.8); g.lineWidth = 1.2; for (let y = -24; y <= 0; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(8, y + 3); g.stroke(); } }
  g.fillStyle = 'rgba(255,255,255,0.22)'; rr(g, -12, -26, 4, 42, 2); g.fill();
}
function belt(g, o = {}) {
  const B = o.m || M.leather, K2 = o.buckle || M.gold;
  g.beginPath(); g.ellipse(0, 0, 38, 16, 0, Math.PI * 0.05, Math.PI * 0.95); g.lineWidth = 16; g.strokeStyle = OUT; g.stroke();
  g.lineWidth = 12; g.strokeStyle = lg(g, 0, 4, 0, 28, B[1], B[3]); g.stroke();
  g.beginPath(); g.ellipse(0, 0, 38, 16, 0, Math.PI, TAU); g.lineWidth = 16; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 12; g.strokeStyle = lg(g, 0, -28, 0, 0, B[2], B[3]); g.stroke();
  for (const x of [-26, -12, 12, 26]) { circ(g, x, 12 + Math.abs(x) * -0.2, 1.8); g.fillStyle = K2[1]; g.fill(); }
  rr(g, -14, 4, 28, 22, 4); body(g, metal(g, -14, 0, 14, 0, K2), 2, OUT, 4);
  rr(g, -8, 9, 16, 12, 2); g.fillStyle = shade(K2[3], 0.1); g.fill();
  if (o.gem) gem(g, 0, 15, 4.5, o.gem, 1.2);
}
function pendant(g, o = {}) {
  const Gm = o.gem || M.cyan, F = o.frame || M.gold, r = o.r ?? 14;
  g.beginPath(); g.moveTo(-26, -34); g.quadraticCurveTo(0, -4, 26, -34); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 1.6; g.strokeStyle = F[1]; g.stroke();
  if (o.glowC) glow(g, 0, 8, r * 3, o.glowC, 0.8);
  if (o.shape === 'drop') {
    g.beginPath(); g.moveTo(0, -12); g.bezierCurveTo(r, 0, r, 16, 0, 22); g.bezierCurveTo(-r, 16, -r, 0, 0, -12); g.closePath(); body(g, metal(g, -r, 0, r, 0, F), 2);
    g.beginPath(); g.moveTo(0, -6); g.bezierCurveTo(r * 0.65, 2, r * 0.65, 13, 0, 17); g.bezierCurveTo(-r * 0.65, 13, -r * 0.65, 2, 0, -6); g.closePath(); fs(g, rg(g, -3, 4, 14, Gm[0], Gm[1], Gm[2], Gm[3]), 1);
  } else {
    circ(g, 0, 8, r); body(g, metal(g, -r, 0, r, 0, F), 2);
    gem(g, 0, 8, r * 0.62, Gm, 1.2);
  }
  circ(g, 0, -12, 3); g.lineWidth = 2; g.strokeStyle = F[1]; g.stroke();
}
function ringItem(g, o = {}) {
  const F = o.band || M.gold;
  ell(g, 0, 10, 24, 20); g.lineWidth = 11; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 7.5; g.strokeStyle = metal(g, -24, 0, 24, 0, F); g.stroke();
  poly(g, [-11, -8, 11, -8, 8, -16, -8, -16]); fs(g, metal(g, -11, 0, 11, 0, F), 1.6);
  gem(g, 0, -18, 10, o.gem || M.blue, 1.8);
}
function orb(g, x, y, r, m, o = {}) {
  glow(g, x, y, r * 2.2, m[1], 0.7);
  circ(g, x, y, r); body(g, rg(g, x - r * 0.35, y - r * 0.4, r * 1.5, m[0], m[1], m[2], m[3]), 2);
  if (o.swirl) { g.save(); circ(g, x, y, r); g.clip(); swirl(g, x, y, r * 0.1, r * 0.9, 1.3, o.swirl, r * 0.16, 0.7); g.restore(); }
  ell(g, x - r * 0.35, y - r * 0.42, r * 0.34, r * 0.2, -0.6); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
}
function helmet(g, o = {}) {
  const H = o.m || M.silver;
  g.beginPath(); g.moveTo(-20, 22); g.lineTo(-22, 0); g.bezierCurveTo(-22, -28, 22, -28, 22, 0); g.lineTo(20, 22); g.lineTo(8, 26); g.lineTo(6, 6); g.lineTo(-6, 6); g.lineTo(-8, 26); g.closePath();
  body(g, metal(g, -22, 0, 22, 0, H), 2.2);
  rr(g, -3, -22, 6, 30, 2); fs(g, (o.trim || M.gold)[1], 1.2);
  rr(g, -20, 2, 40, 4, 2); g.fillStyle = OUT; g.fill();
}
function wings(g, o = {}) {
  const W = o.m || ['#ffffff', '#f4f0e0', '#c8b890', '#6a5a30'];
  for (const s of [-1, 1]) {
    g.save(); g.scale(s, 1);
    for (let i = 0; i < 4; i++) {
      g.beginPath(); g.moveTo(8, -2 + i * 5); g.quadraticCurveTo(24 + i * 2, -26 + i * 8, 44 - i * 4, -30 + i * 12); g.quadraticCurveTo(28 + i * 2, -10 + i * 8, 10, 6 + i * 5); g.closePath();
      body(g, lg(g, 8, 0, 44, 0, W[0], W[1], W[2]), 1.3, alpha(W[3], 0.9), 3);
    }
    g.restore();
  }
}
function gauntlet(g, o = {}) {
  const A = o.m || M.steel;
  // 手腕护甲
  rr(g, -16, 8, 32, 26, 4); body(g, metal(g, -16, 0, 16, 0, o.cuff || M.gold), 2);
  // 拳
  rr(g, -20, -22, 40, 32, 9); body(g, metal(g, -20, 0, 20, 0, A), 2.2);
  for (let i = 0; i < 4; i++) { rr(g, -18 + i * 9.5, -26, 8.6, 15, 3.5); fs(g, metal(g, -18 + i * 9.5, 0, -9 + i * 9.5, 0, A), 1.5); }
  g.beginPath(); g.moveTo(-20, -4); g.quadraticCurveTo(-28, -12, -22, -20); g.lineWidth = 7; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 4.6; g.strokeStyle = A[1]; g.stroke();
  for (let i = 0; i < 4; i++) { poly(g, [-15 + i * 9.5, -26, -13.7 + i * 9.5, -33, -12 + i * 9.5, -26]); fs(g, M.steel[0], 1); }
  if (o.gem) gem(g, 0, 21, 5, o.gem, 1.2);
}
function lantern(g, o = {}) {
  const F = o.frame || M.dark, L = o.light || M.teal;
  g.beginPath(); g.arc(0, -30, 7, Math.PI, 0); g.lineWidth = 3.6; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 2; g.strokeStyle = F[1]; g.stroke();
  glow(g, 0, 2, 38, L[1], 0.8);
  poly(g, [-12, -24, 12, -24, 17, -14, 17, 20, 10, 28, -10, 28, -17, 20, -17, -14]); g.fillStyle = rg(g, 0, 2, 26, L[0], L[1], L[2], alpha(L[3], 0.9)); g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
  flame(g, 0, 14, 14, 24, L, 0, false);
  for (const x of [-11, 0, 11]) line(g, x, -18, x * 1.1, 24, F[1], 2.2);
  rr(g, -19, -26, 38, 6, 2); fs(g, metal(g, -19, 0, 19, 0, F), 1.6);
  rr(g, -14, 26, 28, 6, 2); fs(g, metal(g, -14, 0, 14, 0, F), 1.6);
}
function wardTotem(g, o = {}) {
  const C = o.m || M.pink;
  rr(g, -3, 4, 6, 30, 2); body(g, metal(g, -3, 0, 3, 0, M.dark), 1.6);
  poly(g, [-14, 34, 14, 34, 8, 28, -8, 28]); fs(g, metal(g, -14, 0, 14, 0, M.dark), 1.4);
  glow(g, 0, -10, 34, C[1], 0.8);
  poly(g, [0, -36, 20, -10, 0, 16, -20, -10]); body(g, lg(g, -20, -36, 20, 16, C[0], C[1], C[2], C[3]), 2);
  ell(g, 0, -10, 11, 6.5); fs(g, '#fff4f8', 1.4);
  circ(g, 0, -10, 4.5); g.fillStyle = C[3]; g.fill(); circ(g, -1.2, -11.3, 1.4); g.fillStyle = '#fff'; g.fill();
}
function scroll(g, o = {}) {
  const P = o.paper || '#ecdcae';
  rr(g, -26, -22, 52, 44, 2); body(g, lg(g, 0, -22, 0, 22, shade(P, 0.2), P, shade(P, -0.25)), 1.8);
  // 地图纹
  g.save(); rr(g, -24, -20, 48, 40, 2); g.clip();
  g.fillStyle = 'rgba(80,140,90,0.5)'; g.beginPath(); g.moveTo(-24, -6); g.bezierCurveTo(-14, -18, -4, -2, 4, -12); g.bezierCurveTo(12, -20, 20, -8, 24, -14); g.lineTo(24, -20); g.lineTo(-24, -20); g.fill();
  g.fillStyle = 'rgba(70,120,190,0.5)'; g.beginPath(); g.moveTo(-24, 12); g.bezierCurveTo(-10, 4, 0, 20, 10, 10); g.bezierCurveTo(16, 4, 20, 14, 24, 8); g.lineTo(24, 22); g.lineTo(-24, 22); g.fill();
  g.setLineDash([2.5, 2.5]); g.strokeStyle = '#8a2a14'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-16, 8); g.bezierCurveTo(-8, -4, 4, 10, 12, -4); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#8a2a14'; g.lineWidth = 2.2; line(g, 9, -7, 15, -1, '#a0200c', 2.4); line(g, 15, -7, 9, -1, '#a0200c', 2.4);
  g.restore();
  for (const x of [-28, 28]) { rr(g, x - 4, -26, 8, 52, 4); fs(g, metal(g, x - 4, 0, x + 4, 0, M.wood), 1.6); for (const y of [-28, 26]) { circ(g, x, y, 3.2); fs(g, M.gold[1], 1.2); } }
}
function compass(g) {
  circ(g, 0, 0, 30); body(g, metal(g, -30, 0, 30, 0, M.gold), 2.2, OUT, 6);
  circ(g, 0, 0, 24); fs(g, rg(g, -6, -6, 30, '#fff6dc', '#e0cc9c', '#8a7446'), 1.4);
  g.strokeStyle = 'rgba(80,60,30,0.7)'; g.lineWidth = 1;
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; const r0 = i % 4 ? 20 : 16; line(g, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * 23, Math.sin(a) * 23, 'rgba(80,60,30,0.7)', i % 4 ? 0.8 : 1.6); }
  T(g, 0, 0, 0.6, 1, () => { poly(g, [0, -20, 5, 0, -5, 0]); fs(g, '#d8302a', 1.2); poly(g, [0, 20, 5, 0, -5, 0]); fs(g, '#e8f0f8', 1.2); });
  gem(g, 0, 0, 3.2, M.blue, 1);
  circ(g, 0, -33, 4); g.lineWidth = 2.2; g.strokeStyle = M.gold[1]; g.stroke();
}
function hat(g, o = {}) {
  const H = o.m || M.purple, B = o.band || M.gold;
  ell(g, 0, 22, 40, 11); body(g, lg(g, 0, 12, 0, 34, H[1], H[3]), 2.2, OUT, 6);
  g.beginPath(); g.moveTo(-22, 20); g.bezierCurveTo(-18, 0, -8, -14, 4, -26); g.quadraticCurveTo(14, -36, 30, -34); g.quadraticCurveTo(18, -28, 14, -18); g.bezierCurveTo(16, -4, 20, 8, 22, 20); g.quadraticCurveTo(0, 26, -22, 20); g.closePath();
  body(g, lg(g, -22, 0, 22, 0, H[2], H[1], H[0], H[2], H[3]), 2.2);
  g.beginPath(); g.moveTo(-21, 14); g.quadraticCurveTo(0, 20, 21, 14); g.lineTo(22, 20); g.quadraticCurveTo(0, 26, -22, 20); g.closePath(); fs(g, metal(g, 0, 12, 0, 22, B), 1.5);
  gem(g, 0, 17, 4.5, o.gem || M.blue, 1.2);
  sparkle(g, 26, -30, 5, '#ffe6ff');
}
function wand(g, o = {}) {
  // 短魔杖：斜放，顶端爆裂星芒
  rr(g, -3, -20, 6, 50, 3); body(g, metal(g, -3, 0, 3, 0, o.shaft || M.wood), 1.8);
  rr(g, -4.5, 20, 9, 6, 2); fs(g, (o.band || M.gold)[1], 1.2);
  glow(g, 0, -26, 26, o.spark || '#ff9a3a', 0.9);
  starPath(g, 0, -26, 8, 15, 6); fs(g, rg(g, 0, -26, 15, '#ffffff', (o.sparkM || M.fire)[1], (o.sparkM || M.fire)[2]), 1.4);
  gem(g, 0, -24, 5, o.gem || M.purple, 1.2);
}
function club(g, o = {}) {
  const W = o.m || M.wood;
  g.beginPath(); g.moveTo(-3.5, 34); g.lineTo(-5, 0); g.quadraticCurveTo(-13, -10, -12, -26); g.quadraticCurveTo(0, -40, 12, -26); g.quadraticCurveTo(13, -10, 5, 0); g.lineTo(3.5, 34); g.closePath();
  body(g, metal(g, -13, 0, 13, 0, W), 2.2);
  for (const y of [-22, -12]) { rr(g, -12.5, y, 25, 4, 1.5); fs(g, metal(g, -12, 0, 12, 0, o.band || M.gold), 1.2); }
  if (o.gem) gem(g, 0, -30, 5, o.gem, 1.2);
  for (const [x, y] of [[-8, -4], [8, -16], [-9, -30]]) { poly(g, [x, y - 2, x + Math.sign(x) * 6, y, x, y + 2]); fs(g, M.steel[1], 1); }
}
function katar(g, o = {}) {
  const B = o.blade || M.gold;
  g.beginPath(); g.moveTo(-12, 10); g.lineTo(-8, -26); g.lineTo(0, -40); g.lineTo(8, -26); g.lineTo(12, 10); g.closePath();
  body(g, lg(g, -12, 0, 12, 0, B[2], B[0], B[1], B[3]), 2);
  line(g, 0, -34, 0, 6, 'rgba(255,255,255,0.6)', 1.2);
  rr(g, -18, 8, 36, 8, 3); fs(g, metal(g, 0, 8, 0, 16, o.guard || M.bronze), 1.6);
  for (const x of [-14, 10]) { rr(g, x, 16, 4, 18, 2); fs(g, metal(g, x, 0, x + 4, 0, M.bronze), 1.3); }
  rr(g, -14, 26, 28, 5, 2); fs(g, M.leather[1], 1.2);
}
function cannon(g, o = {}) {
  const Bm = o.m || M.bronze;
  // 炮管
  g.beginPath(); g.moveTo(-30, -10); g.lineTo(22, -14); g.lineTo(22, 14); g.lineTo(-30, 10); g.closePath(); body(g, metal(g, 0, -14, 0, 14, Bm), 2.2);
  rr(g, 18, -17, 12, 34, 4); fs(g, metal(g, 0, -17, 0, 17, M.gold), 1.8);
  ell(g, 30, 0, 3.5, 12); g.fillStyle = '#120a04'; g.fill();
  for (const x of [-18, -4, 10]) { rr(g, x, -13, 4, 26, 1.5); fs(g, metal(g, 0, -13, 0, 13, M.gold), 1.1); }
  // 握把与弹鼓
  poly(g, [-26, 8, -16, 8, -12, 30, -22, 30]); fs(g, metal(g, -26, 0, -12, 0, M.wood), 1.6);
  circ(g, -6, 16, 8); fs(g, rg(g, -8, 14, 10, M.steel[0], M.steel[2], M.steel[3]), 1.6);
  glow(g, 36, 0, 16, '#ffd060', 0.9); sparkle(g, 38, 0, 6, '#fff2a0');
}
function gear(g, x, y, r, n, m) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const a0 = (i / (n * 2)) * TAU, a1 = ((i + 1) / (n * 2)) * TAU, rr0 = i % 2 ? r * 0.8 : r; g.arc(x, y, rr0, a0, a1); }
  g.closePath(); body(g, metal(g, x - r, y, x + r, y, m), 1.8);
}
function trident(g, o = {}) {
  const S = o.m || M.cyan;
  rr(g, -2.8, -12, 5.6, 48, 2.8); body(g, metal(g, -2.8, 0, 2.8, 0, M.bronze), 1.6);
  g.beginPath(); g.moveTo(-16, -30); g.lineTo(-16, -12); g.quadraticCurveTo(0, -2, 16, -12); g.lineTo(16, -30); g.lineWidth = 6.4; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 3.6; g.strokeStyle = S[1]; g.stroke();
  for (const x of [-16, 0, 16]) { poly(g, [x - 5, x ? -28 : -34, x, x ? -40 : -46, x + 5, x ? -28 : -34]); fs(g, metal(g, x - 5, 0, x + 5, 0, S), 1.4); }
  line(g, 0, -34, 0, -8, OUT, 6); line(g, 0, -34, 0, -8, S[1], 3.6);
}
function bracer(g, o = {}) {
  const A = o.m || M.bronze;
  g.beginPath(); g.moveTo(-22, -26); g.quadraticCurveTo(0, -32, 22, -26); g.lineTo(18, 28); g.quadraticCurveTo(0, 34, -18, 28); g.closePath();
  body(g, metal(g, -22, 0, 22, 0, A), 2.2);
  for (const y of [-18, 20]) { g.beginPath(); g.moveTo(-21, y); g.quadraticCurveTo(0, y - 5, 21, y); g.lineWidth = 3.2; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 2; g.strokeStyle = M.gold[1]; g.stroke(); }
  gem(g, 0, 0, 9, o.gem || M.purple, 1.6);
}
function idol(g) {
  poly(g, [-18, 34, 18, 34, 14, 26, -14, 26]); body(g, metal(g, -18, 0, 18, 0, M.stone), 1.6);
  g.beginPath(); g.moveTo(-12, 26); g.quadraticCurveTo(-16, 6, -8, -4); g.lineTo(8, -4); g.quadraticCurveTo(16, 6, 12, 26); g.closePath(); body(g, metal(g, -16, 0, 16, 0, M.stone), 1.8);
  ell(g, 0, -16, 12, 14); body(g, metal(g, -12, 0, 12, 0, M.stone), 1.8);
  poly(g, [-14, -24, -4, -38, 0, -26, 4, -38, 14, -24, 0, -28]); fs(g, metal(g, -14, 0, 14, 0, M.gold), 1.4);
  for (const x of [-5, 5]) { glow(g, x, -16, 7, '#6affe0', 0.9); ell(g, x, -16, 2.6, 1.3); g.fillStyle = '#e6fffa'; g.fill(); }
  g.fillStyle = 'rgba(0,0,0,0.3)'; rr(g, -8, 4, 16, 3, 1); g.fill();
}
function machete(g) {
  g.beginPath(); g.moveTo(-5, 10); g.lineTo(-7, -28); g.quadraticCurveTo(-4, -42, 10, -44); g.quadraticCurveTo(16, -24, 7, 10); g.closePath();
  body(g, lg(g, -8, 0, 16, 0, M.steel[2], M.steel[0], M.steel[1], M.steel[3]), 2);
  line(g, -3, 4, -4, -30, 'rgba(255,255,255,0.6)', 1.2);
  rr(g, -9, 8, 18, 5, 2); fs(g, metal(g, 0, 8, 0, 13, M.bronze), 1.5);
  rr(g, -4, 13, 8, 22, 3); fs(g, metal(g, -4, 0, 4, 0, ['#c8f0a0', '#6aa040', '#3a6a1e', '#14300a']), 1.6);
  for (const y of [18, 24, 30]) line(g, -4, y, 4, y + 2, 'rgba(0,0,0,0.4)', 1);
}
function locketBox(g) {
  g.beginPath(); g.moveTo(-26, -34); g.quadraticCurveTo(0, -10, 26, -34); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 1.8; g.strokeStyle = M.gold[1]; g.stroke();
  glow(g, 0, 8, 36, '#ffe08a', 0.55);
  poly(g, [0, -20, 22, -8, 22, 18, 0, 32, -22, 18, -22, -8]); body(g, metal(g, -22, 0, 22, 0, M.gold), 2.2, OUT, 6);
  poly(g, [0, -12, 14, -4, 14, 14, 0, 23, -14, 14, -14, -4]); fs(g, rg(g, -3, 0, 22, '#fff6cc', '#e8b848', '#8a5a14'), 1.4);
  starPath(g, 0, 5.5, 8, 9, 4, -Math.PI / 2); fs(g, rg(g, 0, 5, 9, '#ffffff', '#ffe070', '#c88a20'), 1);
  circ(g, 0, -22, 3.2); g.lineWidth = 2; g.strokeStyle = M.gold[1]; g.stroke();
}
function heartGem(g, x, y, s, m) {
  glow(g, x, y, s * 2.4, m[1], 0.8);
  heartPath(g, x, y, s); body(g, lg(g, x - s, y - s, x + s, y + s, m[0], m[1], m[2], m[3]), 2);
  g.save(); heartPath(g, x, y, s); g.clip();
  poly(g, [x, y - s * 0.42, x, y + s * 0.85, x + s * 1.2, y]); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fill();
  g.restore();
  sparkle(g, x - s * 0.45, y - s * 0.35, s * 0.28);
}
function skull(g, x, y, s, c = '#ece6d4') {
  g.beginPath(); g.arc(x, y - s * 0.15, s, Math.PI * 0.85, Math.PI * 2.15); g.lineTo(x + s * 0.55, y + s * 0.85); g.lineTo(x - s * 0.55, y + s * 0.85); g.closePath();
  body(g, rg(g, x - s * 0.3, y - s * 0.5, s * 1.6, '#ffffff', c, shade(c, -0.5)), 1.6, OUT, 3);
  for (const sx of [-1, 1]) { ell(g, x + sx * s * 0.4, y - s * 0.05, s * 0.26, s * 0.3); g.fillStyle = '#1a0e0a'; g.fill(); }
  poly(g, [x, y + s * 0.25, x - s * 0.12, y + s * 0.45, x + s * 0.12, y + s * 0.45]); g.fillStyle = '#1a0e0a'; g.fill();
}

// ============================================================
// 装备
// ============================================================
const Q = Math.PI / 4;
const ITEM_ART = {
  // —— 起始 ——
  doransblade: (g) => placeSword(g, { len: 46, w: 11, grip: 12, guardW: 24, guard: M.bronze, gem: M.red, style: 'broad' }, Q, 50, 52, 1.1),
  doransring: (g) => { glow(g, 50, 36, 30, '#7ab8ff', 0.5); T(g, 50, 56, 0, 1, () => ringItem(g, { gem: M.blue, band: M.bronze })); },
  doransshield: (g) => T(g, 50, 50, 0, 1.08, () => shield(g, { kind: 'kite', face: ['#ffe6c8', '#c8783a', '#7a3a14', '#2a1004'], rim: M.bronze, boss: M.red })),
  huntersmachete: (g) => { T(g, 50, 52, 0.55, 1.1, () => machete(g)); },
  worldatlas: (g) => T(g, 50, 50, -0.12, 1.1, () => scroll(g)),
  runiccompass: (g) => T(g, 50, 52, 0, 1.1, () => compass(g)),
  // —— 消耗品 ——
  healthpotion: (g) => { glow(g, 50, 58, 34, '#ff4a4a', 0.4); T(g, 50, 54, 0, 1.05, () => flask(g, { liquid: M.red, shape: 'round' })); },
  refillable: (g) => { glow(g, 50, 58, 34, '#ff9a3a', 0.4); T(g, 50, 54, 0, 1.05, () => { flask(g, { liquid: M.orange, shape: 'tall', level: -8, band: M.gold }); for (const y of [0, 16]) { rr(g, -19, y, 38, 4, 2); fs(g, metal(g, -19, 0, 19, 0, M.gold), 1.2); } }); },
  controlward: (g) => T(g, 50, 52, 0, 1.1, () => wardTotem(g, { m: M.pink })),
  elixiriron: (g) => { glow(g, 50, 60, 32, '#c0d8d0', 0.4); T(g, 50, 54, 0, 1.05, () => flask(g, { liquid: M.silver, shape: 'cone', level: 2 })); T(g, 50, 70, 0, 0.32, () => shield(g, { face: M.steel, rim: M.dark })); },
  elixirsorcery: (g) => { glow(g, 50, 60, 32, '#a07aff', 0.5); T(g, 50, 54, 0, 1.05, () => flask(g, { liquid: M.purple, shape: 'cone', level: 2 })); sparkle(g, 58, 70, 5, '#e6d8ff'); sparkle(g, 44, 62, 3.4, '#e6d8ff'); },
  elixirwrath: (g) => { glow(g, 50, 60, 32, '#ff5a2a', 0.5); T(g, 50, 54, 0, 1.05, () => flask(g, { liquid: M.fire, shape: 'cone', level: 2 })); flame(g, 50, 78, 13, 17, M.fire); },
  // —— 基础 ——
  longsword: (g) => placeSword(g, { len: 62, w: 8.5, grip: 14, guardW: 22, guard: M.steel, hilt: M.leather, guardStyle: 'bar' }),
  dagger: (g) => { T(g, 50, 50, Q, 1.25, () => { g.translate(0, 8); dagger(g, { blade: M.steel, guard: M.bronze, style: 'curved' }); }); },
  pickaxe: (g) => T(g, 50, 52, -Q, 1.05, () => pickaxe(g)),
  bfsword: (g) => placeSword(g, { len: 64, w: 15, grip: 14, guardW: 32, style: 'broad', guard: M.gold, gem: M.blue, gemR: 4.2, fuller: 'rgba(90,150,230,0.55)' }),
  cloakofagility: (g) => { T(g, 50, 54, 0, 1.08, () => cloak(g, { m: ['#fff6d0', '#f0c850', '#b07a18', '#4a2a04'], clasp: M.steel })); sparkle(g, 72, 30, 6, '#fff4a0'); },
  amptome: (g) => T(g, 50, 52, 0, 1.05, () => book(g, { cover: M.blue, emblem: (g) => { starPath(g, 0, 0, 4, 11, 3.5); fs(g, rg(g, 0, 0, 11, '#ffffff', '#9ad0ff', '#3a70c0'), 1.2); } })),
  blastingwand: (g) => T(g, 50, 52, Q, 1.1, () => wand(g, { spark: '#ff8a4a', gem: M.purple })),
  largerod: (g) => T(g, 50, 52, Q, 1.12, () => club(g, { m: ['#d8c0ff', '#8a64c8', '#4a2a88', '#1a0a3a'], gem: M.blue })),
  sapphire: (g) => crystal(g, 50, 50, 44, 64, M.blue),
  faeriecharm: (g) => T(g, 50, 46, 0, 1.2, () => pendant(g, { shape: 'drop', gem: M.cyan, frame: M.silver, glowC: '#6ef0e0' })),
  rubycrystal: (g) => crystal(g, 50, 50, 44, 64, M.red),
  clotharmor: (g) => T(g, 50, 52, 0, 1.08, () => chest(g, { m: M.cloth, cloth: true, trim: M.bronze })),
  nullmagic: (g) => T(g, 50, 54, 0, 1.08, () => cloak(g, { m: ['#e6f0ff', '#6a8ae8', '#2a3a9a', '#0c1440'], gem: M.cyan })),
  rejuvbead: (g) => { g.beginPath(); g.ellipse(50, 44, 26, 22, 0, 0, TAU); g.lineWidth = 2; g.strokeStyle = 'rgba(200,180,120,0.8)'; g.stroke(); for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU - Math.PI / 2; gem(g, 50 + Math.cos(a) * 26, 44 + Math.sin(a) * 22, 6, M.green, 1.2); } gem(g, 50, 76, 9, M.green, 1.6); glow(g, 50, 76, 20, '#6ef07a', 0.6); },
  boots: (g) => T(g, 48, 52, 0, 1.08, () => boot(g, { m: M.leather, cuff: M.bronze })),
  // —— 进阶 ——
  sheen: (g) => { glow(g, 50, 40, 40, '#7ec4ff', 0.7); T(g, 50, 54, Q, 1.1, () => staff(g, { len: 64, shaft: M.silver, orb: M.ice, orbR: 9, head: 'claw', band: M.silver })); sparkle(g, 36, 28, 7, '#dff4ff'); },
  phage: (g) => T(g, 50, 52, Q, 1.05, () => hammer(g, { head: M.red, band: M.dark, hw: 34, hh: 22 })),
  caulfield: (g) => T(g, 50, 52, Q, 1.05, () => hammer(g, { head: M.steel, band: M.gold, hw: 30, hh: 18, gem: M.orange })),
  serrated: (g) => T(g, 50, 50, Q, 1.3, () => { g.translate(0, 6); dagger(g, { style: 'jagged', blade: M.steel, guard: M.dark, w: 10 }); }),
  vampscepter: (g) => { T(g, 50, 52, Q, 1.1, () => staff(g, { len: 62, shaft: M.dark, orb: M.blood, orbR: 8, head: 'crescent', band: M.silver })); drop(g, 70, 74, 4.5); },
  zeal: (g) => { glow(g, 50, 44, 36, '#ffd84a', 0.55); T(g, 50, 52, 0.25, 1.08, () => katar(g, { blade: M.gold })); streak(g, 18, 70, 34, 56, '#fff0a0', 4); streak(g, 20, 84, 38, 68, '#fff0a0', 3); },
  recurvebow: (g) => T(g, 44, 50, 0, 1.2, () => bow(g, { m: M.wood, tips: M.steel })),
  executioner: (g) => T(g, 50, 50, -0.5, 0.98, () => crossbowShape(g, { m: M.dark, limb: M.blood })),
  lastwhisper: (g) => placeSword(g, { len: 64, w: 9, grip: 14, guardW: 20, style: 'curved', blade: M.silver, guard: M.dark, hilt: M.dark }),
  fiendishcodex: (g) => T(g, 50, 52, 0, 1.05, () => book(g, { cover: ['#ffb0a0', '#b02a2a', '#5a0a14', '#200208'], trim: M.bronze, emblem: (g) => { for (const s of [-1, 1]) { poly(g, [s * 6, -8, s * 14, -18, s * 10, -4]); fs(g, '#e8dcc0', 1); } ell(g, 0, 2, 9, 6); fs(g, '#ffe070', 1.3); ell(g, 0, 2, 2.2, 5.5); g.fillStyle = '#300'; g.fill(); } })),
  aetherwisp: (g) => { orb(g, 50, 52, 18, M.ice, { swirl: '#ffffff' }); flame(g, 50, 40, 22, 30, M.ice, 3, false); sparkle(g, 70, 32, 5); },
  lostchapter: (g) => T(g, 50, 56, 0, 1.08, () => openBook(g, { cover: M.blue, emblem: (g) => { glow(g, 0, -8, 24, '#8ad0ff', 0.8); sparkle(g, 0, -12, 8, '#cfeaff'); } })),
  hextechalternator: (g) => { gear(g, 50, 52, 30, 10, M.bronze); circ(g, 50, 52, 20); fs(g, metal(g, 30, 0, 70, 0, M.gold), 1.6); orb(g, 50, 52, 12, M.cyan); bolt(g, [22, 28, 32, 38, 28, 42, 38, 48], '#8af8ff', 1.6); bolt(g, [78, 76, 68, 66, 72, 62, 62, 56], '#8af8ff', 1.6); },
  blightingjewel: (g) => { glow(g, 50, 50, 40, '#b060ff', 0.5); for (let i = 0; i < 6; i++) T(g, 50, 50, (i / 6) * TAU, 1, () => { poly(g, [-4, -18, 0, -36, 4, -18]); fs(g, metal(g, -4, 0, 4, 0, M.black), 1.2); }); T(g, 50, 50, 0, 1, () => { poly(g, [0, -22, 18, -8, 12, 18, -12, 18, -18, -8]); body(g, lg(g, -18, -22, 18, 18, M.violet[0], M.violet[1], M.violet[2], M.violet[3]), 2); poly(g, [0, -22, 6, -4, 0, 18, -6, -4]); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fill(); }); sparkle(g, 44, 40, 5); },
  oblivionorb: (g) => { orb(g, 50, 52, 26, ['#ffb0c8', '#b02a6a', '#4a0a3a', '#12020e'], { swirl: '#ff7ab0' }); ring(g, 50, 52, 31, 'rgba(255,120,180,0.5)', 1.6, 0.4, 2.6); },
  seekers: (g) => T(g, 50, 52, 0, 1.08, () => bracer(g, { m: M.bronze, gem: M.purple })),
  kindlegem: (g) => { flame(g, 50, 70, 40, 56, M.fire); crystal(g, 50, 56, 26, 34, M.red); },
  giantsbelt: (g) => T(g, 50, 50, 0, 1.1, () => belt(g, { m: M.leather, buckle: M.gold, gem: M.red })),
  chainvest: (g) => T(g, 50, 52, 0, 1.08, () => chest(g, { m: M.steel, chain: true, trim: M.steel })),
  negatron: (g) => T(g, 50, 54, 0, 1.08, () => cloak(g, { m: ['#c8b0ff', '#4a3a9a', '#1e1650', '#08061a'], gem: M.purple, hood: false })),
  spectrecowl: (g) => T(g, 50, 58, 0, 1.0, () => cloak(g, { m: ['#ffd0c8', '#a03a4a', '#4a1020', '#1a0408'], hood: true, eyes: '#ff6a5a' })),
  bramblevest: (g) => T(g, 50, 52, 0, 1.0, () => chest(g, { m: M.leather, spikes: ['#f0f0e0', '#c8c0a0', '#6a6450'], trim: M.bronze })),
  wardensmail: (g) => T(g, 50, 52, 0, 1.02, () => chest(g, { m: ['#e8f0ff', '#8aa0c0', '#4a5a78', '#1a2230'], pauldrons: M.steel, trim: M.gold, emblem: (g) => { T(g, 0, 8, 0, 0.3, () => shield(g, { face: M.blue, rim: M.gold })); } })),
  quicksilver: (g) => { g.beginPath(); g.moveTo(18, 22); g.bezierCurveTo(40, 36, 60, 30, 82, 20); g.lineTo(84, 30); g.bezierCurveTo(60, 42, 40, 46, 18, 32); g.closePath(); body(g, lg(g, 0, 20, 0, 46, '#e8f4ff', '#6a8ab0', '#2a3a58'), 1.8); for (const s of [-1, 1]) { g.beginPath(); g.moveTo(50, 50); g.quadraticCurveTo(50 + s * 10, 70, 50 + s * 16, 86); g.lineTo(50 + s * 6, 82); g.quadraticCurveTo(50 + s * 4, 68, 50, 56); g.closePath(); fs(g, lg(g, 50, 50, 50, 86, '#b8d4f0', '#3a5a88'), 1.6); } circ(g, 50, 46, 14); body(g, metal(g, 36, 0, 64, 0, M.silver), 2); circ(g, 50, 46, 8); fs(g, rg(g, 47, 43, 10, '#ffffff', '#c8e8ff', '#5a8ab8'), 1.2); },
  forbiddenidol: (g) => T(g, 50, 52, 0, 1.08, () => idol(g)),
  // —— 鞋 ——
  berserkers: (g) => T(g, 50, 52, 0, 1.05, () => boot(g, { m: ['#ffd0a8', '#d8703a', '#8a3414', '#3a1204'], cuff: M.steel, variant: 'berserk' })),
  sorcshoes: (g) => { glow(g, 50, 50, 38, '#b080ff', 0.45); T(g, 48, 52, 0, 1.05, () => boot(g, { m: ['#f0e0ff', '#8a5ad0', '#4a2488', '#1a0a3a'], cuff: M.gold, variant: 'sorc' })); sparkle(g, 80, 34, 5, '#e8d8ff'); },
  plated: (g) => T(g, 48, 52, 0, 1.05, () => boot(g, { m: M.dark, cuff: M.steel, sole: M.black, variant: 'plated' })),
  mercs: (g) => T(g, 54, 52, 0, 1.05, () => boot(g, { m: ['#d8f0ff', '#4a8ac0', '#1e4a78', '#0a1a30'], cuff: M.silver, variant: 'mercs' })),
  ionian: (g) => T(g, 48, 52, 0, 1.05, () => boot(g, { m: ['#ffffff', '#dfe8f4', '#8a9ab8', '#3a4460'], cuff: M.gold, variant: 'ionian' })),
  swiftness: (g) => T(g, 54, 52, 0, 1.05, () => boot(g, { m: ['#f0ffe0', '#8ac870', '#3a7a30', '#123a10'], cuff: M.bronze, variant: 'swift' })),
  // —— 传说：攻击 ——
  infinityedge: (g) => placeSword(g, { len: 66, w: 16, grip: 13, guardW: 36, style: 'broad', blade: M.gold, guard: M.gold, hilt: M.blood, gem: M.red, gemR: 4.6, glow: '#ffd060', fuller: 'rgba(160,90,10,0.35)' }),
  bloodthirster: (g) => { placeSword(g, { len: 64, w: 12, grip: 13, guardW: 30, blade: M.blood, guard: M.gold, hilt: M.dark, gem: M.red, glow: '#ff2030', glowA: 0.4 }); drop(g, 24, 74, 4.5); drop(g, 34, 84, 3.2); },
  bork: (g) => { glow(g, 50, 50, 44, '#3aff8a', 0.35); placeSword(g, { len: 62, w: 12, grip: 13, guardW: 28, style: 'curved', blade: ['#c8ffd8', '#3a6a4a', '#1a2a20', '#040a06'], guard: M.dark, hilt: M.dark, gem: M.green, fuller: 'rgba(80,255,150,0.55)' }); },
  trinity: (g) => { placeSword(g, { len: 56, w: 11, grip: 13, guardW: 34, blade: M.silver, guard: M.gold, hilt: M.leather, glow: '#ffe8a0', glowA: 0.35 }); T(g, 50, 50, Q, 1, () => { g.translate(0, 25); for (const [x, y, m] of [[-11, -6, M.red], [11, -6, M.blue], [0, 4, M.gold]]) gem(g, x, y, 4.6, m, 1.2); }); },
  blackcleaver: (g) => T(g, 50, 52, Q * 0.6, 1.05, () => axe(g, { head: M.black, handle: M.dark, edge: 'rgba(230,40,40,0.75)', double: true, collar: M.dark, spike: true })),
  steraks: (g) => { glow(g, 50, 44, 40, '#ffb060', 0.35); T(g, 50, 52, 0, 1.08, () => gauntlet(g, { m: M.steel, cuff: M.gold, gem: M.orange })); },
  deathsdance: (g) => { T(g, 50, 50, 0.3, 1, () => { for (const s of [-1, 1]) { g.save(); g.scale(s, 1); g.beginPath(); g.moveTo(4, 30); g.quadraticCurveTo(10, -6, 36, -30); g.quadraticCurveTo(30, -2, 12, 32); g.closePath(); body(g, lg(g, 4, 30, 36, -30, M.blood[2], M.silver[0], M.blood[1], M.blood[3]), 1.8); g.restore(); } rr(g, -5, -4, 10, 40, 3); fs(g, metal(g, -5, 0, 5, 0, M.dark), 1.6); gem(g, 0, -6, 5, M.red, 1.3); }); },
  guardianangel: (g) => { glow(g, 50, 44, 44, '#fff0b0', 0.55); T(g, 50, 52, 0, 1, () => { wings(g); helmet(g, { m: M.gold, trim: M.silver }); }); },
  youmuu: (g) => { glow(g, 50, 50, 42, '#8a4aff', 0.4); for (let i = 2; i >= 0; i--) { g.save(); g.globalAlpha = i ? 0.3 : 1; placeSword(g, { len: 56, w: 11, grip: 12, guardW: 22, style: 'curved', blade: i ? M.purple : ['#e0d0ff', '#4a3a6a', '#1a1428', '#050308'], guard: M.dark, hilt: M.dark, gem: M.purple }, Q, 50 - i * 7, 50 + i * 3); g.restore(); } },
  kraken: (g) => { glow(g, 50, 40, 36, '#4af0e0', 0.45); T(g, 50, 52, Q * 0.8, 1.1, () => trident(g, { m: M.cyan })); },
  rapidfire: (g) => T(g, 48, 52, -0.35, 1.0, () => cannon(g, { m: M.bronze })),
  runaans: (g) => { swirl(g, 50, 50, 6, 38, 1.4, '#c8fff0', 3, 0.7); T(g, 44, 50, 0, 1.15, () => bow(g, { m: M.cyan, tips: M.gold, grip: M.gold })); T(g, 30, 50, 0, 1, () => { arrow(g, 44, M.wood, M.steel); }); },
  lorddominik: (g) => placeSword(g, { len: 66, w: 18, grip: 13, guardW: 30, style: 'cleaver', blade: ['#ffffff', '#b8c4d4', '#5a6474', '#1a2028'], guard: M.dark, hilt: M.blood, gem: M.blue }),
  guinsoo: (g) => { glow(g, 34, 34, 30, '#ff8a2a', 0.5); glow(g, 66, 66, 30, '#a060ff', 0.5); placeSword(g, { len: 62, w: 13, grip: 13, guardW: 28, style: 'wave', blade: ['#ffe6c0', '#ff8a3a', '#7a3ab0', '#200a40'], guard: M.dark, hilt: M.dark, gem: M.orange }); },
  witsend: (g) => { glow(g, 50, 50, 40, '#40e0d0', 0.4); placeSword(g, { len: 60, w: 11, grip: 13, guardW: 26, style: 'curved', blade: ['#e0fffa', '#5ad0c8', '#1a6a70', '#062428'], guard: M.silver, hilt: M.dark, gem: M.purple, fuller: 'rgba(180,120,255,0.55)' }); },
  stridebreaker: (g) => T(g, 50, 52, Q, 1.02, () => hammer(g, { head: ['#ffe8b0', '#e0a03a', '#8a4a10', '#301404'], band: M.red, hw: 40, hh: 22, claw: true, gem: M.red })),
  // —— 传说：防御 ——
  deadmans: (g) => T(g, 50, 52, 0, 1.02, () => chest(g, { m: M.dark, pauldrons: M.black, trim: M.bronze, emblem: (g) => skull(g, 0, 6, 9) })),
  sunfire: (g) => { flame(g, 30, 80, 20, 36, M.fire, -4); flame(g, 70, 80, 20, 36, M.fire, 4); flame(g, 50, 30, 26, 22, M.fire); T(g, 50, 54, 0, 0.95, () => shield(g, { kind: 'heater', face: ['#fff2c0', '#ff9a2a', '#b83a0a', '#4a0e02'], rim: M.gold, emblem: (g) => { starPath(g, 0, 0, 12, 13, 7); fs(g, rg(g, 0, 0, 13, '#ffffff', '#ffd23a', '#e06010'), 1.2); } })); },
  thornmail: (g) => T(g, 50, 52, 0, 1.02, () => chest(g, { m: ['#d8ecd0', '#6a8a64', '#34482e', '#101a0c'], spikes: ['#fff4e0', '#d0b890', '#6a5030'], trim: M.bronze })),
  warmog: (g) => T(g, 50, 52, 0, 1.02, () => chest(g, { m: ['#d8ffe0', '#4a9a5a', '#1e5a2e', '#08240f'], pauldrons: M.gold, trim: M.gold, emblem: (g) => heartGem(g, 0, 4, 9, M.green) })),
  spiritvisage: (g) => { glow(g, 50, 46, 42, '#5affc8', 0.45); T(g, 50, 52, 0, 1.1, () => { helmet(g, { m: ['#e8fff4', '#6ac8a8', '#2a6a5a', '#0a241e'], trim: M.gold }); for (const x of [-9, 9]) { glow(g, x, 4, 9, '#8affe0', 0.9); ell(g, x, 4, 5, 2.2); g.fillStyle = '#e8fff8'; g.fill(); } }); },
  randuin: (g) => T(g, 50, 50, 0, 1.08, () => shield(g, { kind: 'round', face: ['#f4f8ff', '#9aa8c0', '#4a5670', '#1a2030'], rim: M.gold, boss: M.gold, emblem: (g) => { for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; circ(g, Math.cos(a) * 19, Math.sin(a) * 19, 2); g.fillStyle = M.gold[1]; g.fill(); } } })),
  frozenheart: (g) => { rays(g, 50, 52, 14, 44, 10, '#c8f4ff', 3, 0.3, 0.5); heartGem(g, 50, 52, 24, M.ice); },
  locket: (g) => T(g, 50, 50, 0, 1.08, () => locketBox(g)),
  redemption: (g) => { rays(g, 50, 58, 12, 46, 14, '#fff6c8', 3, 0, 0.6); T(g, 50, 48, 0, 1.25, () => pendant(g, { shape: 'drop', gem: ['#ffffff', '#fff2b0', '#f0b840', '#8a5a10'], frame: M.gold, glowC: '#fff2b0' })); },
  // —— 传说：法术 ——
  rabadon: (g) => T(g, 50, 52, 0, 1.05, () => hat(g, { m: M.purple, band: M.gold, gem: M.blue })),
  voidstaff: (g) => { T(g, 50, 52, Q, 1.1, () => staff(g, { len: 70, shaft: M.dark, orb: M.violet, orbR: 12, head: 'claw', band: M.purple })); },
  zhonya: (g) => { glow(g, 50, 50, 46, '#ffe08a', 0.45); T(g, 50, 52, 0, 1.12, () => hourglass(g, { frame: M.gold, sand: M.gold })); },
  luden: (g) => { for (let i = 0; i < 3; i++) ring(g, 50, 52, 20 + i * 8, alpha('#8ad8ff', 0.7 - i * 0.2), 2.6 - i * 0.6, -0.9 + i * 0.3, 1.6 + i * 0.4); orb(g, 50, 52, 18, M.blue, { swirl: '#dff4ff' }); sparkle(g, 72, 32, 5, '#cfeaff'); },
  lichbane: (g) => { glow(g, 50, 40, 40, '#c060ff', 0.45); T(g, 50, 52, Q, 1.1, () => staff(g, { len: 66, shaft: M.dark, orb: M.violet, orbR: 9, head: 'crescent', band: M.purple })); T(g, 30, 30, 0, 1, () => skull(g, 0, 0, 7, '#e8d8ff')); },
  shadowflame: (g) => { T(g, 50, 66, 0, 1, () => { poly(g, [-18, -6, 18, -6, 10, 10, 4, 26, -4, 26, -10, 10]); body(g, metal(g, -18, 0, 18, 0, M.black), 2); }); flame(g, 50, 62, 36, 50, ['#ffe0ff', '#c050ff', '#5a108a', '#14021e']); flame(g, 50, 60, 18, 26, ['#ffffff', '#ffb0ff', '#ff50c0', '#6a0a4a'], 0, false); },
  morellonomicon: (g) => T(g, 50, 52, 0, 1.05, () => book(g, { cover: ['#d0ffb0', '#3a7a2a', '#16341a', '#060e04'], trim: M.bronze, emblem: (g) => { glow(g, 0, 0, 16, '#8aff4a', 0.6); skull(g, 0, 0, 9, '#e0f0c0'); } })),
  rylai: (g) => { T(g, 50, 52, Q, 1.1, () => staff(g, { len: 68, shaft: M.silver, orb: M.ice, orbR: 11, head: 'claw', band: M.ice })); for (const [x, y, r] of [[30, 70, 4], [70, 30, 5], [24, 40, 3]]) sparkle(g, x, y, r, '#dff8ff'); },
};

// 无专属绘制时：按标签/层级/名称挑选物件并用 bg 调色
function genericItem(g, def) {
  const tags = def?.tags || [];
  const name = def?.name || '';
  const c = bgColors(def, ['#c8aa6e', '#3a2a10'])[0];
  const m = tone(c);
  if (tags.includes('boots') || def?.tier === 'boots' || /靴|鞋/.test(name)) return T(g, 48, 52, 0, 1.05, () => boot(g, { m, cuff: M.gold }));
  if (def?.tier === 'consumable' || /药|合剂/.test(name)) return T(g, 50, 54, 0, 1.05, () => flask(g, { liquid: m, shape: 'cone' }));
  if (/书|典|章/.test(name)) return T(g, 50, 52, 0, 1.05, () => book(g, { cover: m }));
  if (/杖|权/.test(name)) return T(g, 50, 52, Q, 1.1, () => staff(g, { orb: m, head: 'claw' }));
  if (/盾/.test(name)) return T(g, 50, 50, 0, 1.05, () => shield(g, { face: m }));
  if (/甲|铠/.test(name) || tags.includes('armor')) return T(g, 50, 52, 0, 1.05, () => chest(g, { m }));
  if (/斗篷|披/.test(name) || tags.includes('mr')) return T(g, 50, 54, 0, 1.05, () => cloak(g, { m }));
  if (/弓/.test(name) || tags.includes('as')) return T(g, 44, 50, 0, 1.2, () => bow(g, { m }));
  if (/斧/.test(name)) return T(g, 50, 52, Q * 0.6, 1.05, () => axe(g, { head: m }));
  if (/锤/.test(name)) return T(g, 50, 52, Q, 1.05, () => hammer(g, { head: m }));
  if (tags.includes('ap') || tags.includes('mana')) return orb(g, 50, 52, 22, m, { swirl: '#ffffff' });
  if (tags.includes('hp') || tags.includes('tank')) return crystal(g, 50, 50, 42, 60, m);
  if (tags.includes('support')) return T(g, 50, 46, 0, 1.2, () => pendant(g, { gem: m }));
  return placeSword(g, { len: 60, w: 11, blade: m, guard: M.gold });
}

// ============================================================
// 技能
// ============================================================
// 通用：发光刃冲刺 / 盾 / 旋风 等组合
const A = {
  // —— 盖伦 ——
  garen: {
    P: (g) => { T(g, 50, 52, 0, 1.0, () => chest(g, { m: ['#e8f0ff', '#8aa8d8', '#3a5a8a', '#101e38'], pauldrons: M.gold, trim: M.gold })); glow(g, 50, 52, 26, '#6aff7a', 0.8); T(g, 50, 52, 0, 1, () => { poly(g, [-4, -12, 4, -12, 4, -4, 12, -4, 12, 4, 4, 4, 4, 12, -4, 12, -4, 4, -12, 4, -12, -4, -4, -4]); fs(g, lg(g, 0, -12, 0, 12, '#e8ffe0', '#3ad04a'), 1.8); }); },
    Q: (g) => { for (let i = 0; i < 4; i++) streak(g, 8, 30 + i * 12, 40, 30 + i * 12, '#fff0a0', 3); placeSword(g, { len: 60, w: 11, grip: 12, guardW: 28, style: 'broad', blade: M.silver, guard: M.gold, hilt: M.blue, gem: M.blue, glow: '#ffe060', glowA: 0.8 }, Math.PI / 2, 50, 50); sparkle(g, 88, 50, 9, '#fff6c0'); },
    W: (g) => { glow(g, 50, 50, 46, '#ffe070', 0.6); T(g, 50, 52, 0, 1.05, () => shield(g, { kind: 'heater', face: ['#e8f4ff', '#4a8ae0', '#1a3a8a', '#081436'], rim: M.gold, emblem: (g) => { poly(g, [0, -18, 6, -4, 0, 20, -6, -4]); fs(g, metal(g, -6, 0, 6, 0, M.gold), 1.2); poly(g, [-14, -6, 14, -6, 12, -2, -12, -2]); fs(g, M.gold[1], 1); } })); },
    E: (g) => { swirl(g, 50, 50, 4, 42, 1.6, '#ffd890', 5, 0.9); swirl(g, 50, 50, 4, 38, 1.6, '#ffffff', 2, 0.6, Math.PI); for (let i = 0; i < 3; i++) T(g, 50, 50, (i / 3) * TAU + 0.3, 1, () => { g.translate(0, -8); g.scale(0.62, 0.62); sword(g, { len: 44, w: 10, grip: 8, guardW: 18, blade: M.silver, guard: M.gold, hilt: M.blue }); }); glow(g, 50, 50, 14, '#fff', 0.6); },
    R: (g) => { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = lg(g, 0, 0, 0, 100, 'rgba(255,240,160,0)', 'rgba(255,230,120,0.55)'); poly(g, [36, 0, 64, 0, 58, 92, 42, 92]); g.fill(); g.restore(); T(g, 50, 44, Math.PI, 1, () => sword(g, { len: 56, w: 16, grip: 12, guardW: 36, style: 'broad', blade: M.gold, guard: M.gold, hilt: M.blue, gem: M.blue, glow: '#ffe080', glowA: 0.7 })); glow(g, 50, 92, 30, '#fff0a0', 0.9); rays(g, 50, 92, 6, 30, 10, '#ffffff', 2.5, Math.PI, 0.9); },
  },
  // —— 德莱厄斯 ——
  darius: {
    P: (g) => { for (const [x0, y0, x1, y1] of [[24, 22, 70, 72], [36, 18, 80, 64], [18, 36, 60, 80]]) { line(g, x0, y0, x1, y1, OUT, 7); line(g, x0, y0, x1, y1, '#ff4a3a', 4); } drop(g, 34, 78, 6); drop(g, 60, 36, 5); drop(g, 76, 80, 4); },
    Q: (g) => { ring(g, 50, 50, 36, 'rgba(255,60,40,0.5)', 10); swirl(g, 50, 50, 30, 38, 0.9, '#ff7a4a', 5, 1, -Math.PI * 0.2); T(g, 50, 52, Q * 0.5, 0.9, () => axe(g, { head: M.dark, handle: M.blood, edge: 'rgba(255,60,40,0.8)', double: true, collar: M.red, spike: true })); },
    W: (g) => { T(g, 44, 50, -Q * 1.2, 0.95, () => axe(g, { head: M.dark, handle: M.blood, edge: 'rgba(255,90,40,0.85)', collar: M.red })); glow(g, 70, 74, 24, '#ff5a2a', 0.8); rays(g, 70, 74, 4, 22, 9, '#ffb080', 2.4); for (let i = 0; i < 3; i++) { poly(g, [82, 40 + i * 12, 94, 40 + i * 12, 88, 48 + i * 12]); fs(g, '#8ad0ff', 1.2); } },
    E: (g) => { T(g, 36, 52, -0.2, 0.85, () => axe(g, { head: M.dark, handle: M.blood, edge: 'rgba(255,90,40,0.6)', collar: M.red })); for (let i = 0; i < 3; i++) T(g, 72, 30 + i * 20, 0, 1, () => { poly(g, [10, -6, 0, 0, 10, 6, 8, 0]); fs(g, '#ffb080', 1.4); line(g, 10, 0, 22, 0, '#ffb080', 3); }); chainLinks(g, 44, 34, 66, 50, 4, M.steel, 3); },
    R: (g) => { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = lg(g, 0, 0, 0, 100, 'rgba(255,40,30,0.0)', 'rgba(255,40,30,0.55)'); poly(g, [30, 0, 70, 0, 62, 100, 38, 100]); g.fill(); g.restore(); T(g, 50, 50, Math.PI, 1.02, () => axe(g, { len: 76, head: M.black, handle: M.blood, edge: 'rgba(255,40,30,0.9)', double: true, collar: M.gold, spike: true })); glow(g, 50, 88, 24, '#ff3020', 0.9); },
    M: (g) => { glow(g, 50, 50, 44, '#ff4a2a', 0.8); rays(g, 50, 50, 10, 46, 12, '#ffb080', 3); T(g, 50, 52, 0, 0.9, () => gauntlet(g, { m: M.dark, cuff: M.red, gem: M.red })); },
  },
  // —— 李青 ——
  leesin: {
    P: (g) => { for (let i = 0; i < 3; i++) streak(g, 10, 36 + i * 14, 44, 36 + i * 14, '#ffe08a', 3.4); T(g, 60, 50, Math.PI / 2, 0.85, () => fist(g, M.bronze)); T(g, 44, 70, Math.PI / 2, 0.55, () => fist(g, M.bronze)); },
    Q: (g) => { for (let i = 0; i < 4; i++) { g.save(); g.globalCompositeOperation = 'lighter'; ring(g, 20 + i * 12, 50, 14 + i * 7, alpha('#8ad8ff', 0.95 - i * 0.18), 5 - i * 0.6, -0.9, 0.9); g.restore(); } orb(g, 86, 50, 7, M.ice); },
    Q2: (g) => { for (let i = 0; i < 4; i++) streak(g, 6, 34 + i * 10, 44, 42 + i * 4, '#8ad8ff', 3); T(g, 62, 50, Math.PI / 2, 0.9, () => fist(g, M.bronze)); ring(g, 84, 50, 10, 'rgba(160,220,255,0.9)', 3); },
    W: (g) => { glow(g, 50, 50, 46, '#ffe070', 0.7); bell(g); },
    W2: (g) => { glow(g, 50, 50, 44, '#ffc060', 0.6); T(g, 50, 52, 0, 1, () => fist(g, M.gold)); drop(g, 26, 76, 5); drop(g, 76, 30, 4.2); drop(g, 78, 78, 3.6); },
    E: (g) => { groundSlam(g, '#8ad0ff'); },
    E2: (g) => { groundSlam(g, '#6aa0e0'); for (let i = 0; i < 3; i++) T(g, 30 + i * 20, 26, 0, 1, () => { poly(g, [-6, -4, 6, -4, 0, 6]); fs(g, '#bfe6ff', 1.3); line(g, 0, -4, 0, -14, '#bfe6ff', 3); }); },
    R: (g) => { swirl(g, 50, 50, 8, 40, 1.1, '#ff8a3a', 8, 0.9, Math.PI * 0.4); flame(g, 26, 60, 18, 26, M.fire, -6); T(g, 54, 46, -0.5, 1, () => kick(g)); },
  },
  // —— 易 ——
  masteryi: {
    P: (g) => { for (const [a, c] of [[Q, '#e8ff9a'], [-Q, '#ffffff']]) T(g, 50, 50, a, 1, () => { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = lg(g, -40, 0, 40, 0, alpha(c, 0), alpha(c, 0.95), alpha(c, 0)); g.beginPath(); g.moveTo(-40, 0); g.quadraticCurveTo(0, -8, 40, 0); g.quadraticCurveTo(0, 3, -40, 0); g.fill(); g.restore(); }); sparkle(g, 50, 50, 8, '#f4ffc0'); },
    Q: (g) => { for (let i = 3; i >= 0; i--) { g.save(); g.globalAlpha = i ? 0.28 : 1; placeSword(g, { len: 54, w: 8, grip: 12, guardW: 18, blade: i ? M.lime : M.silver, guard: M.gold, hilt: M.green, glow: i ? null : '#b8ff6a' }, Q, 64 - i * 10, 44 + i * 6, 0.9); g.restore(); } },
    W: (g) => { glow(g, 50, 52, 44, '#ffe6a0', 0.75); ring(g, 50, 52, 36, 'rgba(255,230,160,0.55)', 2); meditator(g); },
    E: (g) => { flame(g, 50, 92, 44, 84, ['#ffffff', '#f0ff8a', '#b0d020', '#3a4a04'], 0, false); placeSword(g, { len: 60, w: 9, grip: 12, guardW: 20, blade: M.silver, guard: M.gold, hilt: M.green, glow: '#ffff9a' }, 0, 50, 50); },
    R: (g) => { rays(g, 50, 50, 10, 48, 16, '#ffd05a', 4, 0, 0.9); glow(g, 50, 50, 34, '#fff0a0', 0.9); for (let i = 0; i < 3; i++) T(g, 50, 70 - i * 18, 0, 1, () => { g.beginPath(); g.moveTo(-18, 8); g.lineTo(0, -6); g.lineTo(18, 8); g.lineWidth = 8; g.strokeStyle = OUT; g.lineJoin = 'round'; g.stroke(); g.lineWidth = 5; g.strokeStyle = i === 2 ? '#ffffff' : '#ffd84a'; g.stroke(); }); },
  },
  // —— 阿狸 ——
  ahri: {
    P: (g) => { for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; const x = 50 + Math.cos(a) * 30, y = 50 + Math.sin(a) * 30; streak(g, x, y, 50 + Math.cos(a) * 12, 50 + Math.sin(a) * 12, '#ffb0e8', 3); orb(g, x, y, 5, M.pink); } heartGem(g, 50, 52, 10, M.pink); },
    Q: (g) => { swirl(g, 50, 50, 6, 40, 1.2, '#b8d4ff', 5, 0.8, 0.5); orb(g, 50, 50, 20, ['#ffffff', '#b0ccff', '#4a5ae0', '#101a5a'], { swirl: '#ffffff' }); sparkle(g, 74, 28, 6); },
    W: (g) => { for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU - Math.PI / 2; const x = 50 + Math.cos(a) * 24, y = 54 + Math.sin(a) * 24; swirl(g, 50, 54, 22, 26, 0.18, '#c8b8ff', 4, 0.7, a - 1.1); flame(g, x, y + 12, 18, 30, ['#ffffff', '#a8b0ff', '#5a3ae0', '#1a0a5a'], 0, false); } },
    E: (g) => { for (let i = 0; i < 3; i++) streak(g, 10 + i * 4, 76 - i * 12, 36, 60 - i * 6, '#ff8ac8', 4); heartGem(g, 56, 50, 24, M.pink); sparkle(g, 78, 26, 6, '#ffe0f0'); sparkle(g, 30, 30, 4, '#ffe0f0'); },
    R: (g) => { for (let i = 0; i < 4; i++) { g.save(); g.globalAlpha = 0.18 + i * 0.12; fox(g, 26 + i * 9, 56 - i * 4, 0.6 + i * 0.08); g.restore(); } fox(g, 62, 44, 0.95); },
  },
  // —— 拉克丝 ——
  lux: {
    P: (g) => { glow(g, 50, 50, 44, '#ffe98a', 0.6); ring(g, 50, 50, 30, 'rgba(255,240,160,0.8)', 3); T(g, 50, 50, 0, 1, () => { starPath(g, 0, 0, 4, 30, 6); body(g, rg(g, 0, 0, 30, '#ffffff', '#ffe98a', '#d8a020'), 1.6); starPath(g, 0, 0, 4, 18, 4, -Math.PI / 4); fs(g, 'rgba(255,255,255,0.9)', 0); }); },
    Q: (g) => { g.save(); g.globalCompositeOperation = 'lighter'; for (const [x, y] of [[40, 50], [60, 50]]) { ring(g, x, y, 20, 'rgba(120,200,255,0.35)', 9); ring(g, x, y, 20, '#dff4ff', 3); } g.restore(); orb(g, 50, 50, 8, M.ice); streak(g, 6, 70, 30, 56, '#bfe6ff', 4); sparkle(g, 76, 32, 5); },
    W: (g) => { g.save(); g.globalCompositeOperation = 'lighter'; const cs = ['#ff7ac8', '#ffd07a', '#8affb0', '#7ac8ff', '#c07aff']; cs.forEach((c, i) => { g.beginPath(); g.arc(50, 78, 50 - i * 5, Math.PI * 1.1, Math.PI * 1.9); g.strokeStyle = alpha(c, 0.75); g.lineWidth = 4.5; g.stroke(); }); g.restore(); T(g, 50, 56, 0, 0.75, () => shield(g, { kind: 'kite', face: ['#ffffff', '#ffd0f0', '#c070c0', '#4a1a5a'], rim: M.gold, boss: M.pink })); },
    E: (g) => { glow(g, 50, 50, 46, '#fff2a8', 0.55); ring(g, 50, 50, 34, 'rgba(255,245,190,0.6)', 2); ring(g, 50, 50, 26, 'rgba(160,210,255,0.55)', 2); orb(g, 50, 50, 16, ['#ffffff', '#fff6c0', '#e0b040', '#6a4a10']); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; sparkle(g, 50 + Math.cos(a) * 30, 50 + Math.sin(a) * 30, 3.4); } },
    R: (g) => { g.save(); g.translate(50, 50); g.rotate(-Q); g.globalCompositeOperation = 'lighter'; for (const [w, a] of [[34, 0.25], [20, 0.5], [10, 0.9], [4, 1]]) { g.fillStyle = lg(g, 0, -w / 2, 0, w / 2, 'rgba(255,240,150,0)', `rgba(255,${a === 1 ? 255 : 230},${a === 1 ? 255 : 120},${a})`, 'rgba(255,240,150,0)'); g.fillRect(-80, -w / 2, 160, w); } g.restore(); glow(g, 22, 78, 22, '#ffffff', 0.9); sparkle(g, 22, 78, 12); },
  },
  // —— 安妮 ——
  annie: {
    P: (g) => { flame(g, 50, 78, 44, 60, M.fire); for (let i = 0; i < 4; i++) { const a = -Math.PI * 0.9 + i * Math.PI * 0.6 / 3 - 0.2; circ(g, 50 + Math.cos(a) * 36, 58 + Math.sin(a) * 36, 4.2); g.fillStyle = i < 3 ? '#ffd04a' : 'rgba(255,255,255,0.3)'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = OUT; g.stroke(); } },
    PR: (g) => { glow(g, 50, 50, 48, '#ffe07a', 0.7); flame(g, 50, 80, 50, 66, ['#ffffff', '#ffe07a', '#ff7a1a', '#8a1400']); for (let i = 0; i < 3; i++) sparkle(g, 26 + i * 24, 22 + (i % 2) * 8, 5, '#fff8c0'); },
    Q: (g) => { for (let i = 0; i < 4; i++) streak(g, 10, 80 - i * 6, 46, 56 - i * 3, '#ffb04a', 6 - i); glow(g, 60, 42, 34, '#ff7a1a', 0.8); orb(g, 60, 42, 17, M.fire); flame(g, 60, 44, 30, 36, M.fire, 6, false); },
    W: (g) => { g.save(); g.translate(18, 72); g.rotate(-Q); g.globalCompositeOperation = 'lighter'; g.fillStyle = rg(g, 0, 0, 76, 'rgba(255,240,180,0.9)', 'rgba(255,140,30,0.7)', 'rgba(200,40,0,0)'); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 76, -0.55, 0.55); g.closePath(); g.fill(); g.restore(); for (const [x, y, s] of [[56, 40, 22], [70, 62, 20], [42, 60, 18], [62, 26, 14]]) flame(g, x, y + s * 0.6, s, s * 1.4, M.fire, 3, false); },
    E: (g) => { glow(g, 50, 50, 46, '#ff8a2a', 0.6); ring(g, 50, 50, 34, OUT, 10); ring(g, 50, 50, 34, '#ff7a1a', 7); ring(g, 50, 50, 34, '#ffe07a', 2.4); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; flame(g, 50 + Math.cos(a) * 34, 50 + Math.sin(a) * 34 + 4, 10, 14, M.fire, 0, false); } T(g, 50, 52, 0, 0.5, () => shield(g, { kind: 'round', face: M.fire, rim: M.bronze })); },
    R: (g) => { flame(g, 22, 90, 26, 50, M.fire, -4); flame(g, 78, 90, 26, 50, M.fire, 4); tibbers(g); },
  },
  // —— 艾希 ——
  ashe: {
    P: (g) => { glow(g, 50, 50, 44, '#bfefff', 0.5); snowflake(g, 50, 50, 30, '#e8fbff'); T(g, 18, 82, -Q, 1, () => arrow(g, 60, M.silver, M.ice, '#e8fbff')); },
    Q: (g) => { T(g, 40, 50, 0, 1.1, () => { bow(g, { m: M.ice, string: '#e8fbff', tips: M.silver }); for (const a of [-0.25, 0, 0.25]) T(g, -6, 0, a, 1, () => arrow(g, 46, M.silver, M.ice, '#dff6ff', 2)); }); glow(g, 86, 50, 16, '#bfefff', 0.8); },
    W: (g) => { for (let i = -3; i <= 3; i++) T(g, 16, 50, i * 0.2, 1, () => { g.globalAlpha = 1 - Math.abs(i) * 0.12; arrow(g, 64 - Math.abs(i) * 4, M.silver, M.ice, '#dff6ff', 2.2); }); glow(g, 16, 50, 16, '#bfefff', 0.8); },
    E: (g) => { glow(g, 50, 50, 44, '#a8e6ff', 0.6); hawk(g); },
    R: (g) => { for (let i = 0; i < 4; i++) streak(g, 4, 76 - i * 8, 30, 62 - i * 4, '#bfefff', 4); T(g, 18, 70, -0.45, 1.25, () => { line(g, 0, 0, 40, 0, OUT, 7); line(g, 0, 0, 40, 0, '#bfefff', 4.4); crystalArrowHead(g, 40); }); sparkle(g, 76, 38, 7); },
  },
  // —— 金克丝 ——
  jinx: {
    P: (g) => { glow(g, 50, 50, 46, '#ff6ac8', 0.6); starPath(g, 50, 50, 10, 32, 16, 0.2); body(g, rg(g, 50, 50, 32, '#ffffff', '#ff9ad8', '#c02a8a', '#4a0a3a'), 2); for (const [x, y, c] of [[20, 24, '#6ae0ff'], [80, 26, '#ffe04a'], [78, 80, '#8aff6a'], [22, 78, '#ffffff']]) { T(g, x, y, x * 0.1, 1, () => { poly(g, [0, -5, 5, 4, -5, 4]); fs(g, c, 1); }); } bolt(g, [44, 34, 54, 46, 46, 50, 58, 66], '#ffe0f4', 2.4); },
    Q: (g) => T(g, 50, 52, -0.35, 1, () => minigun(g)),
    QR: (g) => T(g, 50, 52, -0.35, 1, () => rocket(g, 1.0, '#ff6a8a')),
    W: (g) => { g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 3; i++) { g.beginPath(); for (let x = 8; x <= 92; x += 2) { const y = 50 + Math.sin(x * 0.22 + i * 2) * (12 - i * 3); if (x === 8) g.moveTo(x, y); else g.lineTo(x, y); } g.strokeStyle = alpha(i ? '#9af0ff' : '#ffffff', 0.9 - i * 0.2); g.lineWidth = 4 - i; g.stroke(); } g.restore(); bolt(g, [10, 50, 30, 38, 40, 58, 60, 40, 72, 60, 92, 50], '#9af0ff', 2.6); glow(g, 12, 50, 16, '#9af0ff', 0.9); },
    E: (g) => { chomper(g, 30, 64, 0.62); chomper(g, 70, 64, 0.62); chomper(g, 50, 36, 0.8); },
    R: (g) => { for (let i = 0; i < 4; i++) streak(g, 4, 86 - i * 6, 30, 68 - i * 4, '#ffb04a', 5); flame(g, 22, 78, 16, 22, M.fire, -8, false); T(g, 56, 46, -Q, 1.3, () => rocket(g, 1.0, '#ff4a6a')); },
  },
  // —— 锤石 ——
  thresh: {
    P: (g) => { for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; const x = 50 + Math.cos(a) * 26, y = 52 + Math.sin(a) * 26; flame(g, x, y + 8, 12, 20, M.teal, 0, false); } glow(g, 50, 52, 20, '#5affb8', 0.9); skull(g, 50, 52, 10, '#d8fff0'); },
    Q: (g) => { chainLinks(g, 12, 86, 56, 44, 7, ['#e0fff0', '#8ad8b8', '#3a6a5a', '#0a2018'], 3.4); T(g, 64, 36, -Q, 1, () => { scythe(g); }); glow(g, 64, 36, 26, '#5affb8', 0.5); },
    Q2: (g) => { chainLinks(g, 30, 70, 80, 30, 6, ['#e0fff0', '#8ad8b8', '#3a6a5a', '#0a2018'], 3); for (let i = 0; i < 3; i++) T(g, 30 + i * 16, 70 - i * 13, -0.68, 1, () => { poly(g, [8, 0, -4, -7, -1, 0, -4, 7]); fs(g, '#9dffd6', 1.2); }); glow(g, 82, 28, 14, '#9dffd6', 0.9); },
    W: (g) => T(g, 50, 54, 0, 1.08, () => lantern(g, { frame: M.dark, light: M.teal })),
    E: (g) => { g.save(); g.globalCompositeOperation = 'lighter'; g.beginPath(); g.arc(50, 20, 62, Math.PI * 0.25, Math.PI * 0.75); g.strokeStyle = 'rgba(90,255,184,0.4)'; g.lineWidth = 16; g.stroke(); g.restore(); for (let i = 0; i < 9; i++) { const a = Math.PI * 0.25 + (i / 8) * Math.PI * 0.5; const x = 50 + Math.cos(a) * 62, y = 20 + Math.sin(a) * 62; T(g, x, y, a + Math.PI / 2, 1, () => { ell(g, 0, 0, 4.4, i % 2 ? 1.8 : 3); g.lineWidth = 3.4; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 2; g.strokeStyle = '#a8f0d0'; g.stroke(); }); } for (const s of [-1, 1]) T(g, 50 + s * 34, 40, 0, 1, () => { poly(g, [s * 10, 0, 0, -7, 0, 7]); fs(g, '#8fe8c4', 1.3); }); },
    R: (g) => { glow(g, 50, 52, 44, '#5affb0', 0.5); const pts = []; for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i / 5) * TAU; pts.push(50 + Math.cos(a) * 36, 52 + Math.sin(a) * 36); } g.save(); poly(g, pts); g.fillStyle = 'rgba(40,255,170,0.12)'; g.fill(); g.lineWidth = 8; g.strokeStyle = 'rgba(40,255,170,0.35)'; g.stroke(); g.lineWidth = 3; g.strokeStyle = '#d8fff0'; g.stroke(); g.restore(); for (let i = 0; i < 5; i++) { crystal(g, pts[i * 2], pts[i * 2 + 1], 9, 18, M.teal); } skull(g, 50, 52, 9, '#d8fff0'); },
  },
};
// —— 后续加入的英雄（亚索 / 伊泽瑞尔 / 墨菲特 / 莫甘娜 / 劫 / 赵信） ——
Object.assign(A, {
  yasuo: {
    P: (g) => { swirl(g, 50, 52, 10, 40, 1.3, '#bfe8ff', 5, 0.85); T(g, 50, 52, 0, 0.7, () => shieldPath(g, 'kite')); g.lineWidth = 3; g.strokeStyle = 'rgba(220,244,255,0.9)'; g.stroke(); g.fillStyle = 'rgba(140,200,255,0.25)'; g.fill(); },
    Q: (g) => { for (let i = 0; i < 3; i++) streak(g, 6, 40 + i * 10, 52, 44 + i * 4, '#dfeeff', 3.4); placeSword(g, { len: 64, w: 7, grip: 13, guardW: 12, guardStyle: 'bar', style: 'curved', blade: M.silver, guard: M.gold, hilt: M.blue }, Math.PI / 2, 50, 50, 1.05); sparkle(g, 90, 48, 8); },
    Q3: (g) => { for (let i = 0; i < 7; i++) { const y = 84 - i * 10, w = 8 + i * 5; ell(g, 50 + Math.sin(i) * 3, y, w, 3 + i * 0.4); g.lineWidth = 3.4; g.strokeStyle = alpha('#dff6ff', 0.95 - i * 0.07); g.stroke(); } glow(g, 50, 60, 38, '#9fe8ff', 0.6); },
    W: (g) => { g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 5; i++) { g.beginPath(); for (let y = 10; y <= 90; y += 2) { const x = 34 + i * 8 + Math.sin(y * 0.12 + i) * 4; if (y === 10) g.moveTo(x, y); else g.lineTo(x, y); } g.strokeStyle = alpha(i % 2 ? '#bfe8ff' : '#ffffff', 0.8); g.lineWidth = 3.4 - i * 0.3; g.stroke(); } g.restore(); glow(g, 50, 50, 30, '#bfe8ff', 0.5); },
    E: (g) => { for (let i = 0; i < 3; i++) { g.save(); g.globalAlpha = 0.25 + i * 0.3; T(g, 26 + i * 18, 60 - i * 8, -0.5, 0.7 + i * 0.1, () => { poly(g, [16, 0, -10, -12, -4, 0, -10, 12]); body(g, lg(g, -10, -12, 16, 12, '#ffffff', '#a8d8ff', '#2a5aa0'), 2); }); g.restore(); } g.save(); g.globalCompositeOperation = 'lighter'; g.beginPath(); g.arc(60, 70, 34, -2.2, -0.5); g.strokeStyle = 'rgba(230,246,255,0.9)'; g.lineWidth = 4; g.stroke(); g.restore(); },
    R: (g) => { for (const [a, x] of [[-0.9, 40], [0.9, 60], [0, 50]]) T(g, x, 50, a, 1, () => { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = lg(g, 0, -40, 0, 40, 'rgba(160,210,255,0)', 'rgba(230,246,255,0.95)', 'rgba(160,210,255,0)'); g.beginPath(); g.moveTo(0, -40); g.quadraticCurveTo(5, 0, 0, 40); g.quadraticCurveTo(-2, 0, 0, -40); g.fill(); g.restore(); }); for (let i = 0; i < 3; i++) T(g, 50, 84 - i * 14, 0, 1, () => { poly(g, [-6, 4, 0, -4, 6, 4]); fs(g, '#dff4ff', 1.2); }); sparkle(g, 50, 44, 9); },
  },
  ezreal: {
    P: (g) => { glow(g, 50, 50, 44, '#ffe07a', 0.55); for (let i = 0; i < 3; i++) T(g, 50, 72 - i * 18, 0, 1, () => { g.beginPath(); g.moveTo(-18, 8); g.lineTo(0, -6); g.lineTo(18, 8); g.lineWidth = 8; g.strokeStyle = OUT; g.lineJoin = 'round'; g.stroke(); g.lineWidth = 5; g.strokeStyle = i === 2 ? '#ffffff' : '#ffd65a'; g.stroke(); }); sparkle(g, 76, 24, 6); },
    Q: (g) => { for (let i = 0; i < 4; i++) streak(g, 8, 74 - i * 5, 56, 46 - i * 2, '#ffd65a', 6 - i); glow(g, 64, 40, 28, '#ffe07a', 0.9); T(g, 64, 40, -0.55, 1, () => { poly(g, [22, 0, -6, -9, -1, 0, -6, 9]); body(g, lg(g, -6, -9, 22, 9, '#ffffff', '#ffe07a', '#c88a10'), 1.8); }); },
    W: (g) => { glow(g, 50, 50, 44, '#ff9a4a', 0.6); ring(g, 50, 50, 30, 'rgba(255,190,110,0.8)', 3); orb(g, 50, 50, 18, ['#fff0e0', '#ffb85a', '#a03a8a', '#2a0a3a'], { swirl: '#ffe0f0' }); for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Q; sparkle(g, 50 + Math.cos(a) * 30, 50 + Math.sin(a) * 30, 3.4, '#ffe0b0'); } },
    E: (g) => { g.save(); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(20, 76); g.quadraticCurveTo(40, 20, 76, 30); g.strokeStyle = 'rgba(160,230,255,0.9)'; g.lineWidth = 3; g.stroke(); g.restore(); glow(g, 20, 76, 18, '#8ae4ff', 0.9); ring(g, 20, 76, 10, '#c8f4ff', 2.4); glow(g, 76, 30, 26, '#8ae4ff', 0.9); starPath(g, 76, 30, 4, 16, 4); fs(g, rg(g, 76, 30, 16, '#ffffff', '#bff0ff', '#3aa0e0'), 1.4); },
    R: (g) => { g.save(); g.globalCompositeOperation = 'lighter'; for (const [r, a, lw] of [[40, 0.35, 18], [40, 0.7, 8], [40, 1, 3]]) { g.beginPath(); g.arc(20, 50, r, -1.1, 1.1); g.strokeStyle = `rgba(255,${a === 1 ? 250 : 220},${a === 1 ? 220 : 110},${a})`; g.lineWidth = lw; g.stroke(); } g.restore(); for (let i = 0; i < 5; i++) streak(g, 6, 22 + i * 14, 50, 22 + i * 14, '#fff0a0', 2.4, 0.6); sparkle(g, 60, 50, 8); },
  },
  malphite: {
    P: (g) => { glow(g, 50, 50, 42, '#e8d0b0', 0.4); for (let i = 0; i < 8; i++) T(g, 50, 50, (i / 8) * TAU, 1, () => { poly(g, [-9, -34, 9, -34, 11, -20, -11, -20]); body(g, metal(g, -11, 0, 11, 0, M.stone), 1.6, OUT, 3); }); circ(g, 50, 50, 16); body(g, rg(g, 46, 46, 18, '#f0e0cc', '#b8a08a', '#4a3a2a'), 2); },
    Q: (g) => { for (let i = 0; i < 4; i++) streak(g, 8, 70 - i * 6, 44, 56 - i * 3, '#e0b080', 5 - i * 0.8); T(g, 62, 42, 0.4, 1, () => { poly(g, [-18, -6, -4, -20, 16, -14, 22, 4, 8, 18, -14, 12]); body(g, lg(g, -18, -20, 22, 18, '#ffe8c8', '#d8a070', '#7a4a20', '#2a1606'), 2); poly(g, [-4, -20, 2, -2, 22, 4, 16, -14]); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fill(); }); },
    W: (g) => { glow(g, 64, 44, 30, '#ffc060', 0.8); rays(g, 70, 40, 8, 30, 9, '#fff0c0', 2.4); T(g, 44, 58, Q, 1, () => { rr(g, -18, -18, 36, 34, 9); body(g, metal(g, -18, 0, 18, 0, M.stone), 2.2); for (let i = 0; i < 4; i++) { rr(g, -17 + i * 8.6, -24, 8, 12, 3); fs(g, metal(g, -17 + i * 8.6, 0, -9 + i * 8.6, 0, M.stone), 1.4); } g.strokeStyle = 'rgba(40,30,20,0.6)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-10, -4); g.lineTo(0, 6); g.lineTo(8, -2); g.stroke(); }); },
    E: (g) => groundSlam(g, '#e0b060'),
    R: (g) => { for (let i = 0; i < 5; i++) streak(g, 4, 30 + i * 10, 40, 38 + i * 6, '#ffb060', 4); glow(g, 62, 56, 34, '#ff9a4a', 0.7); T(g, 62, 56, 0, 1, () => { poly(g, [-20, -14, -6, -24, 14, -20, 24, -4, 18, 16, -2, 24, -20, 12, -24, -2]); body(g, lg(g, -24, -24, 24, 24, '#fff0dc', '#c89060', '#6a4020', '#1e1006'), 2.2); poly(g, [-6, -24, 0, -6, 24, -4, 14, -20]); g.fillStyle = 'rgba(255,255,255,0.2)'; g.fill(); }); rays(g, 84, 60, 4, 16, 7, '#ffe0b0', 2.4, 0, 0.9); },
  },
  morgana: {
    P: (g) => { for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2; streak(g, 50 + Math.cos(a) * 38, 50 + Math.sin(a) * 38, 50 + Math.cos(a) * 14, 50 + Math.sin(a) * 14, '#c08aff', 3.4); } heartGem(g, 50, 52, 14, M.purple); },
    Q: (g) => { for (let i = 0; i < 3; i++) streak(g, 6, 70 - i * 8, 40, 58 - i * 4, '#a060ff', 4); orb(g, 58, 46, 18, ['#f0e0ff', '#9a5aff', '#3a1080', '#0e0428'], { swirl: '#e0c8ff' }); chainLinks(g, 36, 30, 80, 62, 6, M.dark, 3); },
    W: (g) => { ell(g, 50, 64, 40, 18); g.fillStyle = rg(g, 50, 64, 40, 'rgba(160,240,110,0.85)', 'rgba(90,40,160,0.7)', 'rgba(30,10,60,0.2)'); g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(200,255,160,0.8)'; g.stroke(); for (const [x, y, r] of [[36, 60, 4], [58, 56, 5], [66, 70, 3.4], [44, 72, 3]]) { circ(g, x, y, r); fs(g, rg(g, x - 1, y - 1, r, '#e8ffd0', '#8ae060', '#2a6a10'), 1); } for (let i = 0; i < 3; i++) flame(g, 34 + i * 16, 54, 10, 20 + i * 4, ['#f0ffe0', '#8ae060', '#4a2a8a', '#1a0a3a'], 0, false); },
    E: (g) => { glow(g, 50, 50, 46, '#c090ff', 0.6); circ(g, 50, 50, 32); body(g, rg(g, 40, 38, 40, 'rgba(240,220,255,0.55)', 'rgba(140,80,230,0.45)', 'rgba(40,10,80,0.8)'), 2.4); ring(g, 50, 50, 32, '#e8d8ff', 2.4, -2.6, -0.8); T(g, 50, 52, 0, 0.5, () => shield(g, { kind: 'kite', face: M.purple, rim: M.dark })); },
    R: (g) => { glow(g, 50, 50, 26, '#d060ff', 0.9); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2; chainLinks(g, 50, 50, 50 + Math.cos(a) * 40, 50 + Math.sin(a) * 40, 5, ['#f4e0ff', '#c070ff', '#5a1a8a', '#1a0428'], 2.8); orb(g, 50 + Math.cos(a) * 40, 50 + Math.sin(a) * 40, 4.5, M.violet); } orb(g, 50, 50, 11, M.violet); },
  },
  zed: {
    P: (g) => { for (const [x0, y0, x1, y1] of [[20, 22, 80, 78], [80, 22, 20, 78]]) { line(g, x0, y0, x1, y1, OUT, 8); line(g, x0, y0, x1, y1, '#ff3a3a', 4.4); } skull(g, 50, 50, 12, '#e8e0e0'); },
    Q: (g) => { for (let i = 0; i < 3; i++) streak(g, 8, 76 - i * 8, 40, 60 - i * 5, '#ff5a5a', 3); T(g, 60, 44, 0.3, 1, () => shuriken(g, 26)); },
    W: (g) => { for (let i = 0; i < 2; i++) { g.save(); g.globalAlpha = i ? 1 : 0.4; ninja(g, 36 + i * 26, 54 - i * 4, 0.8 + i * 0.12, i ? '#1a1224' : '#4a2a70'); g.restore(); } },
    E: (g) => { swirl(g, 50, 50, 6, 40, 1.4, '#ff5a5a', 5, 0.85); for (let i = 0; i < 4; i++) T(g, 50, 50, (i / 4) * TAU + 0.4, 1, () => { g.translate(0, -26); g.rotate(1.2); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(14, -4, 20, -14); g.quadraticCurveTo(12, 2, 0, 6); g.closePath(); body(g, lg(g, 0, -14, 20, 6, '#ffffff', '#b8c4d4', '#3a4450'), 1.6, OUT, 3); }); ninja(g, 50, 54, 0.55, '#1a1224'); },
    R: (g) => { glow(g, 50, 50, 44, '#ff2a2a', 0.5); T(g, 50, 50, 0, 1, () => { starPath(g, 0, 0, 3, 34, 12, -Math.PI / 2); body(g, rg(g, 0, 0, 34, '#ff9a9a', '#c01a1a', '#3a0404'), 2.2); circ(g, 0, 2, 9); fs(g, '#12060a', 1.4); }); glow(g, 50, 52, 10, '#ff4a4a', 0.9); },
  },
  xinzhao: {
    P: (g) => { T(g, 50, 50, Q, 1.05, () => spear(g)); for (let i = 0; i < 3; i++) sparkle(g, 26 + i * 8, 26 + i * 8, 4 + i, '#ffe0b0'); },
    Q: (g) => { for (let i = 0; i < 3; i++) T(g, 36 + i * 14, 50, 0.35, 1, () => { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = lg(g, 0, -36, 0, 36, 'rgba(255,220,160,0)', 'rgba(255,240,210,0.95)', 'rgba(255,220,160,0)'); g.beginPath(); g.moveTo(0, -36); g.quadraticCurveTo(5, 0, 0, 36); g.quadraticCurveTo(-1, 0, 0, -36); g.fill(); g.restore(); }); glow(g, 64, 50, 20, '#ffd08a', 0.6); },
    W: (g) => { T(g, 50, 50, Math.PI / 2, 1.05, () => spear(g)); bolt(g, [14, 30, 34, 40, 30, 48, 56, 44, 52, 52, 86, 50], '#c8e0ff', 2.4); g.save(); g.globalCompositeOperation = 'lighter'; g.beginPath(); g.arc(50, 90, 52, -2.4, -0.7); g.strokeStyle = 'rgba(255,230,180,0.7)'; g.lineWidth = 4; g.stroke(); g.restore(); },
    E: (g) => { for (let i = 0; i < 5; i++) streak(g, 4, 30 + i * 10, 48, 36 + i * 7, '#ffd08a', 3.4); T(g, 58, 50, Math.PI / 2 - 0.3, 1, () => spear(g)); glow(g, 86, 38, 16, '#ffe0a0', 0.9); },
    R: (g) => { g.save(); g.globalCompositeOperation = 'lighter'; ring(g, 50, 50, 34, 'rgba(255,210,140,0.4)', 12, 0, TAU); ring(g, 50, 50, 34, '#fff0c8', 3, -2.8, 1.2); g.restore(); T(g, 50, 50, -Q, 0.92, () => spear(g)); glow(g, 50, 50, 16, '#fff0c8', 0.6); },
  },
});
function shuriken(g, r) {
  glow(g, 0, 0, r * 1.5, '#ff4a4a', 0.4);
  starPath(g, 0, 0, 4, r, r * 0.26, 0.3); body(g, metal(g, -r, 0, r, 0, M.steel), 2);
  circ(g, 0, 0, r * 0.2); g.fillStyle = '#1a0a0a'; g.fill();
  line(g, 0, 0, Math.cos(0.3) * r * 0.9, Math.sin(0.3) * r * 0.9, 'rgba(255,255,255,0.6)', 1.2);
}
function ninja(g, x, y, sc, c) {
  T(g, x, y, 0, sc, () => {
    glow(g, 0, 0, 36, '#8a3aff', 0.35);
    g.beginPath(); g.moveTo(0, -34); g.bezierCurveTo(12, -34, 14, -18, 8, -12); g.lineTo(20, -6); g.lineTo(24, 14); g.lineTo(14, 12); g.lineTo(12, 34); g.lineTo(2, 34); g.lineTo(0, 16); g.lineTo(-2, 34); g.lineTo(-12, 34); g.lineTo(-14, 12); g.lineTo(-24, 14); g.lineTo(-20, -6); g.lineTo(-8, -12); g.bezierCurveTo(-14, -18, -12, -34, 0, -34); g.closePath();
    body(g, lg(g, 0, -34, 0, 34, shade(c, 0.3), c, shade(c, -0.5)), 2, '#b070ff', 5);
    for (const s of [-1, 1]) { poly(g, [s * 2, -24, s * 9, -26, s * 7, -21]); g.fillStyle = '#ff3a3a'; g.fill(); }
  });
}
function spear(g) {
  // 长枪：沿 y，枪头在 -y
  rr(g, -2.6, -22, 5.2, 60, 2.6); body(g, metal(g, -2.6, 0, 2.6, 0, M.wood), 1.6);
  g.beginPath(); g.moveTo(0, -48); g.quadraticCurveTo(9, -34, 5, -22); g.lineTo(-5, -22); g.quadraticCurveTo(-9, -34, 0, -48); g.closePath(); body(g, metal(g, -8, 0, 8, 0, M.silver), 1.8, OUT, 3);
  rr(g, -6, -24, 12, 5, 2); fs(g, metal(g, -6, 0, 6, 0, M.gold), 1.3);
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 5, -20); g.quadraticCurveTo(s * 12, -14, s * 8, -6); g.lineWidth = 3; g.strokeStyle = '#d02a2a'; g.stroke(); }
}

// 拳头（指节朝 -y）
function fist(g, m = M.bronze) {
  rr(g, -16, -14, 32, 28, 8); body(g, metal(g, -16, 0, 16, 0, ['#ffe8c8', '#e0a878', '#9a6038', '#3a1e0a']), 2);
  for (let i = 0; i < 4; i++) { rr(g, -15 + i * 7.6, -20, 7, 12, 3); fs(g, metal(g, -15 + i * 7.6, 0, -8 + i * 7.6, 0, ['#ffe8c8', '#e0a878', '#9a6038', '#3a1e0a']), 1.4); }
  rr(g, -17, 10, 34, 12, 3); fs(g, metal(g, -17, 0, 17, 0, m), 1.6);
  line(g, -16, 15, 16, 17, 'rgba(0,0,0,0.35)', 1.2);
}
function bell(g) {
  T(g, 50, 52, 0, 1, () => {
    g.beginPath(); g.moveTo(-8, -32); g.quadraticCurveTo(-24, -30, -24, -8); g.lineTo(-30, 22); g.quadraticCurveTo(0, 30, 30, 22); g.lineTo(24, -8); g.quadraticCurveTo(24, -30, 8, -32); g.closePath();
    body(g, metal(g, -30, 0, 30, 0, M.gold), 2.2, OUT, 6);
    for (const y of [-14, 12]) { g.beginPath(); g.moveTo(-26, y); g.quadraticCurveTo(0, y + 5, 26, y); g.lineWidth = 2; g.strokeStyle = alpha(M.gold[3], 0.8); g.stroke(); }
    starPath(g, 0, -1, 4, 9, 3); fs(g, '#fffbe0', 1);
    rr(g, -6, -38, 12, 8, 3); fs(g, M.gold[2], 1.4);
    ell(g, 0, 26, 7, 4); fs(g, M.gold[2], 1.4);
  });
}
function groundSlam(g, c) {
  ell(g, 50, 66, 42, 16); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fill();
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) { ell(g, 50, 66, 16 + i * 13, 6 + i * 5); g.strokeStyle = alpha(c, 0.9 - i * 0.25); g.lineWidth = 4 - i; g.stroke(); }
  g.restore();
  for (const [x1, y1] of [[20, 74], [82, 72], [34, 84], [68, 86], [50, 88]]) { g.beginPath(); g.moveTo(50, 66); g.lineTo((50 + x1) / 2 + 3, (66 + y1) / 2 - 2); g.lineTo(x1, y1); g.lineWidth = 2.4; g.strokeStyle = '#1a1208'; g.stroke(); }
  T(g, 50, 36, Math.PI, 0.9, () => fist(g, M.bronze));
  rays(g, 50, 60, 6, 36, 10, '#ffffff', 2, Math.PI, 0.5);
}
function kick(g) {
  // 小腿 + 脚（绷带），方向朝右上
  g.beginPath(); g.moveTo(-30, 14); g.lineTo(6, 2); g.quadraticCurveTo(24, -2, 32, -10); g.quadraticCurveTo(38, -6, 34, 2); g.quadraticCurveTo(24, 12, 6, 14); g.lineTo(-28, 26); g.closePath();
  body(g, lg(g, 0, -10, 0, 26, '#ffe0c0', '#d09060', '#7a4a24'), 2.2);
  for (let i = 0; i < 4; i++) { line(g, -22 + i * 7, 12 - i * 1.2, -18 + i * 7, 24 - i * 1.6, 'rgba(255,250,240,0.9)', 2.4); }
  glow(g, 34, -4, 18, '#ffb04a', 0.9); sparkle(g, 38, -6, 7, '#fff0c0');
}
function meditator(g) {
  T(g, 50, 54, 0, 1, () => {
    const skin = lg(g, 0, -30, 0, 30, '#fff0c0', '#e0b050', '#8a5a14');
    ell(g, 0, 22, 30, 9); body(g, lg(g, 0, 14, 0, 30, '#8ad04a', '#2a5a10'), 2);
    g.beginPath(); g.moveTo(-14, 16); g.quadraticCurveTo(-16, -6, 0, -10); g.quadraticCurveTo(16, -6, 14, 16); g.closePath(); body(g, skin, 2);
    circ(g, 0, -20, 8.5); body(g, skin, 2);
    rr(g, -9, -22, 18, 3.5, 1.5); g.fillStyle = '#2a4a10'; g.fill();
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 12, -4); g.quadraticCurveTo(s * 20, 6, s * 6, 12); g.lineWidth = 5.2; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 3.2; g.strokeStyle = '#e0b050'; g.stroke(); }
    circ(g, 0, 12, 3.6); fs(g, '#fff8c0', 1);
  });
}
function fox(g, x, y, sc) {
  T(g, x, y, 0, sc, () => {
    // 尾焰
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-10, 8); g.quadraticCurveTo(-30, 6 + i * 8, -46, -4 + i * 12); g.quadraticCurveTo(-30, 16 + i * 6, -8, 16); g.closePath(); g.fillStyle = lg(g, -46, 0, -8, 0, 'rgba(255,200,240,0)', 'rgba(255,170,230,0.85)'); g.fill(); }
    glow(g, 0, 0, 34, '#ffb8f0', 0.6);
    poly(g, [-20, -30, -9, -12, 9, -12, 20, -30, 22, -6, 14, 8, 0, 22, -14, 8, -22, -6]);
    body(g, lg(g, 0, -30, 0, 22, '#ffffff', '#ffc8f0', '#c05aa8', '#4a0a3a'), 2);
    poly(g, [-17, -24, -10, -12, -19, -10]); g.fillStyle = '#ff7ac8'; g.fill(); poly(g, [17, -24, 10, -12, 19, -10]); g.fill();
    poly(g, [-14, 6, 0, 22, 14, 6, 0, 10]); g.fillStyle = '#fff'; g.fill();
    for (const s of [-1, 1]) { poly(g, [s * 3, -4, s * 14, -8, s * 12, -2]); g.fillStyle = '#ffe0ff'; g.fill(); glow(g, s * 9, -5, 6, '#ff8ae0', 0.8); }
    circ(g, 0, 16, 2.2); g.fillStyle = '#2a0a20'; g.fill();
  });
}
function tibbers(g) {
  T(g, 50, 56, 0, 1, () => {
    const fur = rg(g, -8, -10, 40, '#d8a0ff', '#8a4ac8', '#3a1a5a', '#140620');
    for (const s of [-1, 1]) { circ(g, s * 20, -22, 10); body(g, fur, 2); circ(g, s * 20, -22, 5); g.fillStyle = '#e0a0c0'; g.fill(); }
    ell(g, 0, 0, 30, 27); body(g, fur, 2.2, OUT, 6);
    ell(g, 0, 10, 14, 10); fs(g, lg(g, 0, 0, 0, 20, '#f0d8c0', '#b08a70'), 1.6);
    ell(g, 0, 5, 5, 3.5); g.fillStyle = '#1a0a10'; g.fill();
    // 纽扣眼 + 缝线眼
    circ(g, -12, -6, 6); fs(g, rg(g, -13, -7, 6, '#ff9a6a', '#c03a1a', '#5a0a04'), 1.6); for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { circ(g, -12 + dx, -6 + dy, 0.9); g.fillStyle = '#300'; g.fill(); }
    line(g, 8, -10, 16, -2, '#1a0a10', 2.4); line(g, 16, -10, 8, -2, '#1a0a10', 2.4);
    glow(g, 12, -6, 10, '#ff5a1a', 0.8);
    g.setLineDash([2, 2]); g.beginPath(); g.moveTo(-4, 18); g.quadraticCurveTo(0, 22, 4, 18); g.strokeStyle = '#1a0a10'; g.lineWidth = 1.6; g.stroke(); g.setLineDash([]);
    for (const [x0, y0, x1, y1] of [[2, -26, -3, -14], [22, 8, 28, 16]]) { g.setLineDash([2, 2]); line(g, x0, y0, x1, y1, '#e0c0ff', 1.4); g.setLineDash([]); }
  });
}
function snowflake(g, x, y, r, c) {
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) T(g, x, y, (i / 6) * TAU, 1, () => {
    line(g, 0, 0, 0, -r, alpha(c, 0.9), 3.4);
    for (const t of [0.45, 0.72]) { line(g, 0, -r * t, r * 0.2, -r * (t + 0.16), alpha(c, 0.9), 2.4); line(g, 0, -r * t, -r * 0.2, -r * (t + 0.16), alpha(c, 0.9), 2.4); }
  });
  g.restore();
  circ(g, x, y, r * 0.16); fs(g, '#ffffff', 1.2);
}
function hawk(g) {
  T(g, 50, 52, 0, 1, () => {
    const f = lg(g, 0, -30, 0, 30, '#ffffff', '#a8e6ff', '#3a7ac8', '#0e2a5a');
    g.beginPath(); g.moveTo(0, -10);
    g.bezierCurveTo(-12, -20, -30, -30, -44, -22); g.lineTo(-36, -16); g.lineTo(-42, -10); g.lineTo(-32, -6); g.lineTo(-36, 0); g.lineTo(-22, 0);
    g.quadraticCurveTo(-10, 2, -6, 12); g.lineTo(-10, 30); g.lineTo(0, 24); g.lineTo(10, 30); g.lineTo(6, 12);
    g.quadraticCurveTo(10, 2, 22, 0); g.lineTo(36, 0); g.lineTo(32, -6); g.lineTo(42, -10); g.lineTo(36, -16); g.lineTo(44, -22);
    g.bezierCurveTo(30, -30, 12, -20, 0, -10); g.closePath();
    body(g, f, 2, OUT, 6);
    circ(g, 0, -14, 6); body(g, f, 1.8);
    poly(g, [0, -10, 3, -6, -3, -6]); fs(g, M.gold[1], 1);
    circ(g, -2.4, -15, 1.2); g.fillStyle = '#082040'; g.fill(); circ(g, 2.4, -15, 1.2); g.fill();
  });
}
function crystalArrowHead(g, x) {
  glow(g, x + 14, 0, 26, '#bfefff', 0.8);
  poly(g, [x - 4, 0, x + 6, -13, x + 34, 0, x + 6, 13]); body(g, lg(g, x, -13, x + 34, 13, '#ffffff', '#c8f2ff', '#5ab4e8', '#12406e'), 2);
  poly(g, [x - 4, 0, x + 6, -13, x + 34, 0]); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill();
  for (const s of [-1, 1]) { poly(g, [x - 8, 0, x - 2, s * 10, x + 8, s * 3]); fs(g, '#dff8ff', 1.2); }
}
function minigun(g) {
  for (let i = 0; i < 3; i++) { rr(g, -10, -9 + i * 6, 44, 4.6, 2); fs(g, metal(g, 0, -9 + i * 6, 0, -4.4 + i * 6, M.steel), 1.2); }
  rr(g, 24, -12, 6, 22, 2); fs(g, metal(g, 24, 0, 30, 0, M.pink), 1.4);
  rr(g, -30, -14, 24, 26, 6); body(g, metal(g, 0, -14, 0, 12, ['#ffe0f4', '#ff7ac8', '#a02a7a', '#3a0a2a']), 2);
  circ(g, -18, -1, 7); fs(g, rg(g, -20, -3, 8, '#ffffff', '#6ad0ff', '#1a4a8a'), 1.4);
  poly(g, [-24, 12, -14, 12, -10, 30, -20, 30]); fs(g, metal(g, -24, 0, -10, 0, M.dark), 1.4);
  glow(g, 40, -1, 14, '#ffe060', 0.9); starPath(g, 40, -1, 6, 9, 3); fs(g, '#fff6c0', 0);
}
function rocket(g, sc, c) {
  T(g, 0, 0, 0, sc, () => {
    // 朝 +x；鲨鱼头火箭
    for (const s of [-1, 1]) { poly(g, [-26, 0, -34, s * 14, -20, s * 6]); fs(g, metal(g, -34, 0, -20, 0, M.dark), 1.4); }
    g.beginPath(); g.moveTo(-28, -8); g.lineTo(10, -10); g.quadraticCurveTo(30, -10, 34, 0); g.quadraticCurveTo(30, 10, 10, 10); g.lineTo(-28, 8); g.closePath();
    body(g, lg(g, 0, -10, 0, 10, shade(c, 0.6), c, shade(c, -0.5)), 2);
    poly(g, [-4, -9, 6, -20, 10, -10]); fs(g, shade(c, -0.2), 1.4);
    g.beginPath(); g.moveTo(14, 3); g.quadraticCurveTo(26, 8, 33, 2); g.lineTo(14, 3); g.fillStyle = '#300'; g.fill();
    for (let i = 0; i < 4; i++) { poly(g, [16 + i * 4, 3, 18 + i * 4, 6, 20 + i * 4, 3]); g.fillStyle = '#fff'; g.fill(); }
    circ(g, 20, -3, 2.4); g.fillStyle = '#fff'; g.fill(); circ(g, 20.5, -3, 1.2); g.fillStyle = '#000'; g.fill();
    flame(g, -34, 0, 10, 18, M.fire, 0, false);
  });
}
function chomper(g, x, y, sc) {
  T(g, x, y, 0, sc, () => {
    glow(g, 0, 0, 30, '#ff8a2a', 0.5);
    ell(g, 0, 8, 24, 8); body(g, metal(g, -24, 0, 24, 0, M.dark), 1.8);
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(-22, 4); g.quadraticCurveTo(0, s > 0 ? -24 : 20, 22, 4); g.closePath(); fs(g, metal(g, -22, 0, 22, 0, ['#ffe8c8', '#ff9a3a', '#b04a10', '#3a1004']), 1.8);
    }
    for (let i = 0; i < 6; i++) { poly(g, [-18 + i * 7, -2, -15 + i * 7, 6, -12 + i * 7, -2]); fs(g, '#f4f4f4', 0.8); }
    circ(g, 0, -12, 3); fs(g, '#ff4a2a', 1.1); glow(g, 0, -12, 8, '#ff4a2a', 0.9);
  });
}
function scythe(g) {
  // 镰刀钩：柄 + 弯刃（朝右上）
  rr(g, -2.6, -4, 5.2, 34, 2.6); body(g, metal(g, -2.6, 0, 2.6, 0, M.dark), 1.6);
  g.beginPath(); g.moveTo(-2, -4); g.quadraticCurveTo(-6, -30, 24, -34); g.quadraticCurveTo(4, -24, 4, -4); g.closePath();
  body(g, lg(g, -6, -34, 24, -4, '#e8fff4', '#8ad8b8', '#2a6a5a', '#08201a'), 2);
  glow(g, 18, -30, 10, '#5affb8', 0.9);
  circ(g, 0, 32, 3.6); fs(g, M.teal[1], 1.2);
}

// 通用技能：未知英雄 / 槽位时用颜色符文
function genericAbility(g, slot, c1) {
  const m = tone(c1);
  if (slot === 'R') { rays(g, 50, 50, 8, 46, 12, c1, 4, 0, 0.9); starPath(g, 50, 50, 8, 26, 12); body(g, rg(g, 50, 50, 26, m[0], m[1], m[2], m[3]), 2); return; }
  if (slot === 'W') { T(g, 50, 52, 0, 0.9, () => shield(g, { face: m, rim: M.gold })); return; }
  if (slot === 'E') { for (let i = 0; i < 3; i++) streak(g, 12, 36 + i * 14, 50, 36 + i * 14, c1, 4); T(g, 64, 50, 0, 1, () => { poly(g, [16, 0, -8, -16, -2, 0, -8, 16]); body(g, lg(g, -8, -16, 16, 16, m[0], m[1], m[2]), 2); }); return; }
  if (slot === 'P') { rune(g, c1); return; }
  orb(g, 50, 50, 20, m, { swirl: '#ffffff' }); for (let i = 0; i < 3; i++) streak(g, 8, 62 + i * 6, 32, 54 + i * 2, c1, 4);
}
function rune(g, c) {
  const m = tone(c);
  glow(g, 50, 50, 44, c, 0.55);
  ring(g, 50, 50, 32, OUT, 7); ring(g, 50, 50, 32, m[1], 4);
  T(g, 50, 50, 0, 1, () => { poly(g, [0, -24, 20, 0, 0, 24, -20, 0]); body(g, lg(g, -20, -24, 20, 24, m[0], m[1], m[2], m[3]), 2); poly(g, [0, -12, 10, 0, 0, 12, -10, 0]); fs(g, 'rgba(255,255,255,0.5)', 0); });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Q; circ(g, 50 + Math.cos(a) * 32, 50 + Math.sin(a) * 32, 3.2); fs(g, m[0], 1.2); }
}

// ============================================================
// 召唤师技能
// ============================================================
const SUMMONER_ART = {
  flash: (g) => { for (let i = 0; i < 3; i++) streak(g, 12, 70 - i * 10, 44, 56 - i * 5, '#ffe98a', 4); glow(g, 58, 44, 40, '#ffe070', 0.9); starPath(g, 58, 44, 4, 34, 7, -Math.PI / 2); fs(g, rg(g, 58, 44, 34, '#ffffff', '#fff2a0', '#e0a020'), 1.6); starPath(g, 58, 44, 4, 20, 4, -Math.PI / 4); fs(g, 'rgba(255,255,255,0.9)', 0); },
  ignite: (g) => { flame(g, 50, 84, 52, 70, M.fire); flame(g, 30, 84, 20, 30, M.fire, -4, false); flame(g, 72, 84, 20, 32, M.fire, 4, false); },
  heal: (g) => { glow(g, 50, 50, 46, '#6aff7a', 0.8); T(g, 50, 50, 0, 1, () => { poly(g, [-9, -28, 9, -28, 9, -9, 28, -9, 28, 9, 9, 9, 9, 28, -9, 28, -9, 9, -28, 9, -28, -9, -9, -9]); body(g, lg(g, 0, -28, 0, 28, '#f0ffe8', '#8af07a', '#2a9a3a', '#0a3a14'), 2.2); poly(g, [-9, -28, 9, -28, 9, -9, -9, -9]); fs(g, 'rgba(255,255,255,0.35)', 0); }); for (const [x, y] of [[22, 24], [80, 30], [76, 78]]) sparkle(g, x, y, 4, '#dfffd8'); },
  barrier: (g) => { glow(g, 50, 50, 46, '#ffe28a', 0.7); const hexa = (r) => { const p = []; for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i / 6) * TAU; p.push(50 + Math.cos(a) * r, 50 + Math.sin(a) * r); } return p; }; poly(g, hexa(34)); body(g, rg(g, 44, 40, 40, 'rgba(255,250,220,0.7)', 'rgba(255,220,120,0.45)', 'rgba(200,140,20,0.6)'), 2.2); poly(g, hexa(34)); g.lineWidth = 3; g.strokeStyle = '#fff4c0'; g.stroke(); poly(g, hexa(20)); g.lineWidth = 2; g.strokeStyle = 'rgba(255,240,180,0.8)'; g.stroke(); sparkle(g, 38, 36, 6); },
  exhaust: (g) => { swirl(g, 50, 50, 4, 38, 1.8, '#c07aff', 6, 0.9); glow(g, 50, 50, 18, '#6a2ab0', 0.8); for (let i = 0; i < 3; i++) T(g, 28 + i * 22, 30 + (i % 2) * 36, 0, 1, () => { poly(g, [-6, -2, 6, -2, 0, 8]); fs(g, '#e6c8ff', 1.3); line(g, 0, -2, 0, -12, '#e6c8ff', 3); }); },
  ghost: (g) => { for (let i = 0; i < 4; i++) streak(g, 8, 36 + i * 10, 38, 36 + i * 10, '#7ae0ff', 3.4); T(g, 58, 54, 0, 1, () => { g.beginPath(); g.moveTo(-16, 28); g.lineTo(-16, -6); g.bezierCurveTo(-16, -30, 16, -30, 16, -6); g.lineTo(16, 28); for (let i = 0; i < 4; i++) g.quadraticCurveTo(12 - i * 8, 20, 8 - i * 8, 28); g.closePath(); glow(g, 0, 0, 34, '#7ae0ff', 0.7); body(g, lg(g, 0, -28, 0, 28, 'rgba(240,252,255,0.95)', 'rgba(140,220,255,0.8)', 'rgba(40,120,180,0.4)'), 2); for (const x of [-6, 6]) { ell(g, x, -8, 3, 4.4); g.fillStyle = '#062030'; g.fill(); } }); },
  cleanse: (g) => { glow(g, 50, 50, 46, '#aef0ff', 0.8); for (let i = 0; i < 3; i++) ring(g, 50, 50, 14 + i * 10, alpha('#e8fcff', 0.9 - i * 0.2), 3.4 - i * 0.6, i * 1.2, i * 1.2 + 4.4); starPath(g, 50, 50, 8, 14, 6); fs(g, rg(g, 50, 50, 14, '#ffffff', '#c8f4ff', '#4ab0e0'), 1.4); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; sparkle(g, 50 + Math.cos(a) * 38, 50 + Math.sin(a) * 38, 3.4); } },
  smite: (g) => { glow(g, 50, 70, 30, '#ffcf5a', 0.9); bolt(g, [58, 4, 44, 30, 58, 36, 40, 64, 52, 66, 46, 86], '#ffd870', 4); rays(g, 46, 86, 4, 24, 9, '#fff0b0', 2.4, Math.PI, 0.9); ell(g, 46, 88, 18, 5); g.fillStyle = 'rgba(255,220,120,0.5)'; g.fill(); },
  teleport: (g) => { glow(g, 50, 50, 46, '#c79aff', 0.6); ell(g, 50, 52, 30, 36); body(g, rg(g, 50, 52, 36, '#ffffff', '#d8b0ff', '#6a2ac8', '#1a0848'), 2.2); swirl(g, 50, 52, 2, 28, 2.2, '#ffffff', 3, 0.8); ell(g, 50, 52, 30, 36); g.lineWidth = 3; g.strokeStyle = '#efe0ff'; g.stroke(); for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; sparkle(g, 50 + Math.cos(a) * 38, 52 + Math.sin(a) * 42, 3.2, '#f0e0ff'); } },
};

// ============================================================
// Buff
// ============================================================
function dragonElement(g, type, soul = false) {
  if (soul) { glow(g, 50, 50, 48, '#ffffff', 0.35); ring(g, 50, 50, 38, 'rgba(255,255,255,0.7)', 2); }
  if (type === 'infernal') { flame(g, 50, 84, 50, 66, M.fire); return; }
  if (type === 'mountain') { poly(g, [10, 80, 38, 26, 50, 44, 62, 20, 90, 80]); body(g, lg(g, 0, 20, 0, 80, '#fff0d0', '#c9a36a', '#6a4a20', '#2a1a08'), 2.2); poly(g, [38, 26, 30, 40, 42, 38, 50, 44]); fs(g, '#ffffff', 0); poly(g, [62, 20, 54, 34, 66, 32, 72, 36]); fs(g, '#ffffff', 0); return; }
  if (type === 'ocean') { for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(10, 44 + i * 14); for (let x = 10; x <= 90; x += 20) g.quadraticCurveTo(x + 10, 34 + i * 14, x + 20, 44 + i * 14); g.lineWidth = 7; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 4.4; g.strokeStyle = ['#e0fffc', '#6ae0e0', '#2a9ab0'][i]; g.stroke(); } drop(g, 50, 30, 8, M.cyan); return; }
  if (type === 'cloud') { for (const [x, y, r] of [[34, 56, 16], [52, 46, 20], [70, 56, 15], [50, 62, 16]]) { circ(g, x, y, r); body(g, rg(g, x - 4, y - 6, r * 1.5, '#ffffff', '#d8ecff', '#7aa0c8'), 2); } for (let i = 0; i < 3; i++) streak(g, 12, 76 + i * 5, 48, 76 + i * 5, '#e8f4ff', 2.6); return; }
  if (type === 'elder') { glow(g, 50, 50, 46, '#c0f0ff', 0.7); swirl(g, 50, 50, 4, 36, 1.6, '#e0f8ff', 5, 0.9); dragonHead(g, 50, 52, 0.7, M.ice); return; }
  rune(g, '#c8aa6e');
}
function dragonHead(g, x, y, sc, m) {
  T(g, x, y, 0, sc, () => {
    for (const s of [-1, 1]) { poly(g, [s * 10, -18, s * 30, -40, s * 20, -12]); fs(g, metal(g, -20, 0, 20, 0, m), 1.6); }
    g.beginPath(); g.moveTo(-22, -12); g.quadraticCurveTo(0, -30, 22, -12); g.lineTo(16, 16); g.lineTo(8, 32); g.lineTo(-8, 32); g.lineTo(-16, 16); g.closePath();
    body(g, lg(g, 0, -24, 0, 32, m[0], m[1], m[2], m[3]), 2.2);
    for (const s of [-1, 1]) { poly(g, [s * 6, -6, s * 18, -10, s * 14, -2]); g.fillStyle = '#fff6a0'; g.fill(); glow(g, s * 12, -6, 7, '#ffe070', 0.8); }
    for (const s of [-1, 1]) { circ(g, s * 4, 26, 1.6); g.fillStyle = '#200'; g.fill(); }
  });
}
function baronArt(g) {
  glow(g, 50, 50, 46, '#b070ff', 0.7);
  for (let i = 0; i < 5; i++) T(g, 50, 60, -Math.PI / 2 + (i - 2) * 0.42, 1, () => { g.beginPath(); g.moveTo(-5, 0); g.quadraticCurveTo(-8, -26, 0, -40); g.quadraticCurveTo(8, -26, 5, 0); g.closePath(); body(g, lg(g, 0, -40, 0, 0, '#f0e0ff', '#9a4dff', '#3a0a6a'), 1.6, OUT, 3); });
  ell(g, 50, 62, 22, 14); body(g, rg(g, 50, 58, 24, '#e0c0ff', '#7a2ac8', '#2a0a4a'), 2);
  ell(g, 50, 62, 10, 7); fs(g, rg(g, 50, 62, 10, '#fffbe0', '#ffd23a', '#c05a0a'), 1.4);
  ell(g, 50, 62, 2.4, 6); g.fillStyle = '#1a0420'; g.fill();
}
const BUFF_ART = {
  blue_buff: (g) => { glow(g, 50, 50, 46, '#4aa0ff', 0.7); flame(g, 50, 82, 44, 62, M.blue); crest(g, M.blue); },
  red_buff: (g) => { glow(g, 50, 50, 46, '#ff5a3a', 0.7); flame(g, 50, 82, 44, 62, M.fire); crest(g, M.red); },
  red_buff_burn: (g) => { flame(g, 50, 84, 50, 66, M.fire); for (let i = 0; i < 3; i++) T(g, 30 + i * 20, 22, 0, 1, () => { poly(g, [-6, -4, 6, -4, 0, 6]); fs(g, '#ffd0b0', 1.3); }); },
  dragon_infernal: (g) => dragonElement(g, 'infernal'),
  dragon_mountain: (g) => dragonElement(g, 'mountain'),
  dragon_ocean: (g) => dragonElement(g, 'ocean'),
  dragon_cloud: (g) => dragonElement(g, 'cloud'),
  elder_dragon: (g) => dragonElement(g, 'elder'),
  baron: (g) => baronArt(g),
  baron_corrosion: (g) => { glow(g, 50, 50, 44, '#9a4dff', 0.55); drop(g, 50, 60, 16, M.violet); for (const [x, y] of [[26, 76], [74, 72]]) drop(g, x, y, 6, M.violet); },
  scuttle_shrine: (g) => { for (let i = 0; i < 4; i++) streak(g, 10, 34 + i * 10, 44, 34 + i * 10, '#7fe7ff', 3.4); T(g, 60, 50, 0, 0.8, () => boot(g, { m: M.cyan, cuff: M.silver, variant: 'swift' })); },
  item_grievous: (g) => { heartGem(g, 50, 52, 26, M.blood); g.beginPath(); g.moveTo(52, 26); g.lineTo(43, 44); g.lineTo(57, 56); g.lineTo(48, 76); g.lineWidth = 5; g.strokeStyle = '#1a0004'; g.stroke(); g.lineWidth = 1.4; g.strokeStyle = '#ff9a9a'; g.stroke(); },
};
function crest(g, m) {
  T(g, 50, 58, 0, 1, () => {
    g.beginPath(); g.moveTo(0, -20); g.quadraticCurveTo(20, -22, 22, -6); g.quadraticCurveTo(20, 14, 0, 24); g.quadraticCurveTo(-20, 14, -22, -6); g.quadraticCurveTo(-20, -22, 0, -20); g.closePath();
    body(g, metal(g, -22, 0, 22, 0, M.stone), 2);
    gem(g, 0, 0, 9, m, 1.6);
  });
}

// ============================================================
// 单位（击杀信息 / 目标框）
// ============================================================
const UNIT_ART = {
  minion: (g, c) => { T(g, 50, 54, 0, 1.2, () => helmet(g, { m: tone(c || '#6a9ae0'), trim: M.gold })); },
  turret: (g, c) => { const m = tone(c || '#8aa0c0'); poly(g, [30, 88, 70, 88, 62, 40, 38, 40]); body(g, metal(g, 30, 0, 70, 0, M.stone), 2.2); rr(g, 30, 30, 40, 12, 3); fs(g, metal(g, 30, 0, 70, 0, M.stone), 1.8); for (const x of [30, 44, 58]) { rr(g, x, 22, 10, 10, 2); fs(g, metal(g, x, 0, x + 10, 0, M.stone), 1.6); } orb(g, 50, 16, 9, m); },
  inhibitor: (g, c) => { const m = tone(c || '#b07aff'); ell(g, 50, 80, 30, 9); body(g, metal(g, 20, 0, 80, 0, M.stone), 2); crystal(g, 50, 48, 36, 56, m); },
  nexus: (g, c) => { const m = tone(c || '#6ac8ff'); ell(g, 50, 82, 36, 10); body(g, metal(g, 14, 0, 86, 0, M.gold), 2); crystal(g, 50, 46, 44, 64, m); for (const s of [-1, 1]) crystal(g, 50 + s * 26, 62, 14, 24, m); },
  monster: (g, c) => { const m = tone(c || '#e0b040'); for (let i = 0; i < 3; i++) T(g, 34 + i * 16, 50, 0.3, 1, () => { g.beginPath(); g.moveTo(-4, 30); g.quadraticCurveTo(-8, -6, 8, -30); g.quadraticCurveTo(2, -4, 5, 30); g.closePath(); body(g, lg(g, 0, -30, 0, 30, '#ffffff', m[1], m[2]), 1.8); }); },
  dragon: (g, c) => { const m = tone(c || '#ff8a3a'); glow(g, 50, 50, 44, m[1], 0.5); dragonHead(g, 50, 50, 1.1, m); },
  baron: (g) => baronArt(g),
  herald: (g, c) => { const m = tone(c || '#b07cff'); glow(g, 50, 50, 44, m[1], 0.6); ell(g, 50, 50, 34, 22); body(g, lg(g, 0, 28, 0, 72, m[0], m[1], m[2], m[3]), 2.2); ell(g, 50, 50, 16, 16); fs(g, rg(g, 46, 46, 18, '#ffffff', '#ffe0ff', '#b050e0'), 1.6); ell(g, 50, 50, 4, 12); g.fillStyle = '#1a0420'; g.fill(); },
  ward: (g) => T(g, 50, 52, 0, 1.1, () => wardTotem(g, { m: ['#fffbe0', '#f4d35e', '#b08a1a', '#3a2a06'] })),
  pet: (g, c) => { const m = tone(c || '#e0a060'); circ(g, 50, 60, 16); body(g, rg(g, 46, 56, 20, m[0], m[1], m[2]), 2); for (const [x, y] of [[30, 38], [44, 28], [58, 28], [72, 38]]) { ell(g, x, y, 7, 9); body(g, rg(g, x - 2, y - 2, 10, m[0], m[1], m[2]), 1.8, OUT, 3); } },
  execute: (g) => { glow(g, 50, 50, 40, '#ff4a3a', 0.4); skull(g, 50, 50, 22); },
  unknown: (g, c) => rune(g, c || '#c8aa6e'),
};

// ============================================================
// 导出
// ============================================================
function begin(g, size) { g.save(); K = size / 100; g.scale(K, K); g.lineJoin = 'round'; g.lineCap = 'round'; }
function end(g) { noShadow(g); g.restore(); }
function run(g, fn) { g.save(); try { fn(); } finally { g.restore(); } }

export function drawItemIcon(g, size, id, def) {
  begin(g, size);
  const [c1, c2] = bgColors(def, ['#c8aa6e', '#2a1c08']);
  paintItemBg(g, c1, c2);
  const fn = ITEM_ART[id];
  run(g, () => (fn ? fn(g, def) : genericItem(g, def)));
  vignette(g, 0.5);
  end(g);
  return !!fn;
}
export function hasItemArt(id) { return !!ITEM_ART[id]; }

export function drawAbilityIcon(g, size, championId, slot, def) {
  begin(g, size);
  const [c1, c2] = bgColors(def, ['#8aa0d0', '#141c34']);
  paintAbilityBg(g, c1, c2);
  // 二段技能（Q2 / W2 / R2 / Q3…）没有专属插画时沿用一段的插画
  const fn = A[championId]?.[slot] || A[championId]?.[String(slot || '')[0]];
  run(g, () => (fn ? fn(g, def) : genericAbility(g, String(slot || 'Q')[0], c1)));
  vignette(g, 0.55);
  end(g);
  return !!fn;
}
export function hasAbilityArt(championId, slot) { return !!(A[championId]?.[slot] || A[championId]?.[String(slot || '')[0]]); }

export function drawSummonerIcon(g, size, id, def) {
  begin(g, size);
  const [c1, c2] = bgColors(def, ['#8aa0d0', '#141c34']);
  paintAbilityBg(g, c1, c2);
  const fn = SUMMONER_ART[id];
  run(g, () => (fn ? fn(g, def) : rune(g, c1)));
  vignette(g, 0.55);
  end(g);
  return !!fn;
}
export function hasSummonerArt(id) { return !!SUMMONER_ART[id]; }

export function drawBuffIcon(g, size, id, def) {
  begin(g, size);
  const [c1, c2] = bgColors(def, ['#8aa0d0', '#141c34']);
  paintAbilityBg(g, c1, c2);
  let fn = BUFF_ART[id];
  if (!fn && typeof id === 'string') {
    if (id.startsWith('dragon_soul')) { const type = def?.soulType || def?.dragonType || guessDragonType(c1); fn = (gg) => dragonElement(gg, type, true); }
    else if (id.startsWith('dragon_')) { const type = id.slice(7); fn = (gg) => dragonElement(gg, type); }
    else {
      // 英雄技能衍生 Buff：<英雄>_<槽位>… → 复用技能插画
      const m = id.match(/^([a-z]+)_([a-z0-9]+)/);
      const ALIAS = { darius_might: ['darius', 'M'], jinx_q_fishbones: ['jinx', 'QR'], annie_pyromania: ['annie', 'P'], annie_e: ['annie', 'E'], tibbers_frenzy: ['annie', 'R'], ashe_frost: ['ashe', 'P'], darius_bleed: ['darius', 'P'], leesin_flurry: ['leesin', 'P'], masteryi_ds: ['masteryi', 'P'], ahri_essence: ['ahri', 'P'], thresh_souls: ['thresh', 'P'] };
      let pair = ALIAS[id] || null;
      if (!pair && m && A[m[1]]) { const s = m[2].toUpperCase(); pair = [m[1], A[m[1]][s] ? s : s[0]]; }
      if (pair && A[pair[0]]?.[pair[1]]) fn = A[pair[0]][pair[1]];
    }
  }
  run(g, () => (fn ? fn(g, def) : rune(g, c1)));
  vignette(g, 0.55);
  end(g);
  return !!fn;
}
function guessDragonType(c) {
  const [r, gg, b] = parse(c);
  if (r > 200 && gg < 160) return 'infernal';
  if (b > 200 && r > 150) return 'cloud';
  if (b > 150 && gg > 150) return 'ocean';
  return 'mountain';
}
export function hasBuffArt(id) { return !!BUFF_ART[id]; }

// 单位图标（击杀信息、目标框）：kind = minion | turret | inhibitor | nexus | monster | dragon | baron | herald | ward | pet | execute
export function drawUnitIcon(g, size, kind, color = null) {
  begin(g, size);
  const base = color || '#3a4a6a';
  paintItemBg(g, base, mix(base, '#000', 0.7));
  const fn = UNIT_ART[kind] || UNIT_ART.unknown;
  run(g, () => fn(g, color));
  vignette(g, 0.45);
  end(g);
}

// 供图鉴页 / 调试使用的清单
export const ART_KEYS = {
  items: Object.keys(ITEM_ART),
  abilities: Object.fromEntries(Object.entries(A).map(([k, v]) => [k, Object.keys(v)])),
  summoners: Object.keys(SUMMONER_ART),
  buffs: Object.keys(BUFF_ART),
  units: Object.keys(UNIT_ART),
};
