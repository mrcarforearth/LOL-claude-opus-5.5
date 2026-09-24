// 数学工具：向量、角度、几何碰撞、种子随机数
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function invLerp(a, b, v) { return a === b ? 0 : (v - a) / (b - a); }
export function smoothstep(a, b, v) { const t = clamp(invLerp(a, b, v), 0, 1); return t * t * (3 - 2 * t); }

export function dist(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
export function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
export function len(x, y) { return Math.sqrt(x * x + y * y); }
// 两个对象（含 x,y）之间的中心距离
export function distObj(a, b) { return dist(a.x, a.y, b.x, b.y); }

// 单位向量；零向量返回 fallback
export function norm(x, y, fallback = { x: 1, y: 0 }) {
  const l = Math.sqrt(x * x + y * y);
  if (l < 1e-9) return { x: fallback.x, y: fallback.y };
  return { x: x / l, y: y / l };
}
export function dirTo(ax, ay, bx, by, fallback) { return norm(bx - ax, by - ay, fallback); }
export function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
// 归一化到 (-PI, PI]
export function wrapAngle(a) {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}
// 两角差的绝对值（0..PI）
export function angleDiff(a, b) { return Math.abs(wrapAngle(a - b)); }
// 从 a 向 b 旋转最多 maxStep 弧度
export function rotateTowards(a, b, maxStep) {
  const d = wrapAngle(b - a);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}
export function rotate(x, y, ang) { const c = Math.cos(ang), s = Math.sin(ang); return { x: x * c - y * s, y: x * s + y * c }; }
export function fromAngle(a, l = 1) { return { x: Math.cos(a) * l, y: Math.sin(a) * l }; }

// 点到线段最短距离的平方；同时返回投影参数 t（0..1）
export function pointSegDist2(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = 0;
  if (l2 > 1e-9) t = clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
  const cx = x1 + dx * t, cy = y1 + dy * t;
  const ex = px - cx, ey = py - cy;
  return ex * ex + ey * ey;
}
export function pointSegT(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 <= 1e-9) return 0;
  return clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
}

// 线段-圆扫掠：半径 r1 的圆从 (x1,y1) 移到 (x2,y2)，与圆心 (cx,cy) 半径 r2 的圆首次接触的参数 t（0..1），无接触返回 -1
export function sweepCircle(x1, y1, x2, y2, r1, cx, cy, r2) {
  const R = r1 + r2;
  const fx = x1 - cx, fy = y1 - cy;
  const c = fx * fx + fy * fy - R * R;
  if (c <= 0) return 0; // 起点已重叠
  const dx = x2 - x1, dy = y2 - y1;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
// 线段（带半宽）与圆是否相交
export function segCircleHit(x1, y1, x2, y2, halfWidth, cx, cy, r) {
  const R = halfWidth + r;
  return pointSegDist2(cx, cy, x1, y1, x2, y2) <= R * R;
}

// 点是否在多边形内（[[x,y],...]）
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

// 种子随机数（mulberry32），返回 () => [0,1)
export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randRange(rng, lo, hi) { return lo + (hi - lo) * rng(); }
export function randInt(rng, lo, hi) { return Math.floor(lo + (hi - lo + 1) * rng()); }
export function pick(rng, arr) { return arr.length ? arr[Math.floor(rng() * arr.length)] : undefined; }
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr;
}

// 数值是否有限
export function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
// 按等级线性插值（1 级 → a，18 级 → b）
export function byLevel(level, a, b, maxLevel = 18) { return a + (b - a) * clamp((level - 1) / (maxLevel - 1), 0, 1); }
