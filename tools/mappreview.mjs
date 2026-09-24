#!/usr/bin/env node
// 地图预览：用 node 内置 zlib 手写 PNG 编码器，把导航网格/河道/草丛/兵线/建筑/营地/龙坑/泉水画成 PNG（自检用）
// 用法：node tools/mappreview.mjs [--out shots/map_preview.png] [--size 1000] [--region x0,y0,x1,y1] [--grid 1000] [--sdf] [--decor] [--vision x,y;x,y...]（蓝方视野源，画出迷雾）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as MD from '../js/world/mapdata.js';
import { NavGrid } from '../js/world/navgrid.js';
import { Vision } from '../js/world/vision.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = { out: 'shots/map_preview.png', size: 1000, region: null, grid: 1000, sdf: false, decor: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--sdf' || a === '--decor') { opt[a.slice(2)] = true; continue; }
  if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
}
const SIZE = Number(opt.size) || 1000;
const [X0, Y0, X1, Y1] = opt.region ? opt.region.split(',').map(Number) : [0, 0, MD.MAP.size, MD.MAP.size];
const GRID = Number(opt.grid) || 0;

// —— PNG 编码 ——
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // 过滤类型 None
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// —— 画布 ——
const img = Buffer.alloc(SIZE * SIZE * 3);
const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
function setPx(px, py, col, a = 1) {
  if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) return;
  const o = (py * SIZE + px) * 3;
  if (a >= 1) { img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; return; }
  img[o] = img[o] * (1 - a) + col[0] * a; img[o + 1] = img[o + 1] * (1 - a) + col[1] * a; img[o + 2] = img[o + 2] * (1 - a) + col[2] * a;
}
const sx = (x) => ((x - X0) / (X1 - X0)) * SIZE;
const sy = (y) => ((Y1 - y) / (Y1 - Y0)) * SIZE;
const scale = SIZE / (X1 - X0);
function disc(x, y, rPx, col, a = 1) {
  const cx = sx(x), cy = sy(y);
  for (let py = Math.floor(cy - rPx); py <= Math.ceil(cy + rPx); py++) {
    for (let px = Math.floor(cx - rPx); px <= Math.ceil(cx + rPx); px++) {
      if ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 <= rPx * rPx) setPx(px, py, col, a);
    }
  }
}
function ring(x, y, rPx, wPx, col, a = 1) {
  const cx = sx(x), cy = sy(y);
  const R = rPx + wPx;
  for (let py = Math.floor(cy - R); py <= Math.ceil(cy + R); py++) {
    for (let px = Math.floor(cx - R); px <= Math.ceil(cx + R); px++) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
      if (Math.abs(d - rPx) <= wPx / 2) setPx(px, py, col, a);
    }
  }
}
function rect(x, y, halfPx, col) {
  const cx = Math.round(sx(x)), cy = Math.round(sy(y));
  for (let py = cy - halfPx - 1; py <= cy + halfPx + 1; py++) {
    for (let px = cx - halfPx - 1; px <= cx + halfPx + 1; px++) {
      const edge = Math.abs(px - cx) === halfPx + 1 || Math.abs(py - cy) === halfPx + 1;
      setPx(px, py, edge ? [20, 20, 20] : col);
    }
  }
}
function line(x0, y0, x1, y1, wPx, col, a = 1) {
  const len = Math.hypot(sx(x1) - sx(x0), sy(y1) - sy(y0));
  const n = Math.max(1, Math.ceil(len / Math.max(0.5, wPx * 0.4)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, wPx / 2, col, a);
  }
}

// —— 绘制 ——
const t0 = performance.now();
const nav = new NavGrid(MD);
const tBuild = performance.now() - t0;
const WALL = hex(0x3b4a3f), WALL_DEEP = hex(0x2c3830), WALK = hex(0x98c46e), RIVER = hex(0x4ec3c9), BRUSH = hex(0x2f6b2a);
const BASE_B = hex(0xb9cfb0), BASE_R = hex(0xcfb9a8), PIT = hex(0x8d7fb5), FOOT = hex(0x555555);

for (let py = 0; py < SIZE; py++) {
  const wy = Y1 - ((py + 0.5) / SIZE) * (Y1 - Y0);
  for (let px = 0; px < SIZE; px++) {
    const wx = X0 + ((px + 0.5) / SIZE) * (X1 - X0);
    const i = nav.cellIndex(wx, wy);
    let col;
    if (!nav.terrain[i]) {
      if (opt.sdf) {
        const k = Math.min(1, nav.sdf[i] / 600);
        col = [WALL[0] * (1 - k) + WALL_DEEP[0] * k, WALL[1] * (1 - k) + WALL_DEEP[1] * k, WALL[2] * (1 - k) + WALL_DEEP[2] * k];
      } else col = WALL;
    } else if (!nav.walk[i]) {
      col = FOOT;
    } else {
      col = WALK;
      if (MD.isInBase(0, wx, wy)) col = BASE_B;
      else if (MD.isInBase(1, wx, wy)) col = BASE_R;
      else if (MD.isInRiver(wx, wy)) col = RIVER;
      for (const p of Object.values(MD.PITS)) if ((wx - p.x) ** 2 + (wy - p.y) ** 2 <= p.r * p.r) col = PIT;
      if (opt.sdf) {
        const k = Math.min(1, -nav.sdf[i] / 400);
        col = col.map((v) => v * (0.8 + 0.2 * k));
      }
      if (nav.brush[i] >= 0) {
        // 草丛：深绿斑点
        const spot = ((px * 7 + py * 13) % 5) < 3;
        col = spot ? BRUSH : [BRUSH[0] + 25, BRUSH[1] + 35, BRUSH[2] + 20];
      }
    }
    const o = (py * SIZE + px) * 3;
    img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
  }
}
// 网格线
if (GRID > 0) {
  for (let g = Math.ceil(X0 / GRID) * GRID; g <= X1; g += GRID) {
    const px = Math.round(sx(g));
    const strong = g % 5000 === 0;
    for (let py = 0; py < SIZE; py++) setPx(px, py, [255, 255, 255], strong ? 0.35 : 0.12);
  }
  for (let g = Math.ceil(Y0 / GRID) * GRID; g <= Y1; g += GRID) {
    const py = Math.round(sy(g));
    const strong = g % 5000 === 0;
    for (let px = 0; px < SIZE; px++) setPx(px, py, [255, 255, 255], strong ? 0.35 : 0.12);
  }
}
// 装饰提示（--decor）：兵线石板路、野区小路、基地围墙、河岸石块、道具
if (opt.decor) {
  const D = MD.DECOR;
  for (const t of D.jungleTrails) for (let i = 0; i < t.pts.length - 1; i++) line(t.pts[i][0], t.pts[i][1], t.pts[i + 1][0], t.pts[i + 1][1], t.w * scale, hex(0xb59b6a), 0.35);
  for (const lp of D.lanePaths) for (let i = 0; i < lp.pts.length - 1; i++) line(lp.pts[i][0], lp.pts[i][1], lp.pts[i + 1][0], lp.pts[i + 1][1], lp.w * scale, hex(0xa58b5c), 0.45);
  for (const b of D.bases) {
    for (const w of b.walls) for (let i = 0; i < w.length - 1; i++) line(w[i][0], w[i][1], w[i + 1][0], w[i + 1][1], 3, b.team === 0 ? hex(0xeeeeff) : hex(0x301020));
    for (const g of b.gates) line(g.a.x, g.a.y, g.b.x, g.b.y, 2, hex(0xffe08a));
    ring(b.plaza.x, b.plaza.y, b.plaza.r * scale, 2, hex(0xd8c28a), 0.7);
    ring(b.fountain.x, b.fountain.y, b.fountain.pool * scale, 2, hex(0x9fe8ff), 0.9);
  }
  for (const r of D.riverRocks) disc(r.x, r.y, Math.max(1.5, r.r * scale), hex(0x6d6d6d));
  const PC = { statue: 0xffffff, brazier: 0xff7a1a, crystalPillar: 0x9fe8ff, lantern: 0xffe066 };
  for (const pr of D.props) disc(pr.x, pr.y, Math.max(2, 45 * scale), hex(PC[pr.kind] ?? 0xff00ff));
}
// 视野预览（--vision）：蓝方英雄放在给定点，未见区域压暗，草丛内不可见格额外标记
if (opt.vision) {
  const champs = opt.vision.split(';').map((q) => q.split(',').map(Number)).map(([x, y]) => ({ type: 'champion', team: 0, x, y, alive: true, visible: [true, false], sightRange: 1350, revealedUntil: 0 }));
  const game = { time: 0, nav, map: MD, champions: champs, minions: [], monsters: [], pets: [], wards: [], structures: [] };
  const vis = new Vision(game);
  vis.update(1);
  for (let py = 0; py < SIZE; py++) {
    const wy = Y1 - ((py + 0.5) / SIZE) * (Y1 - Y0);
    for (let px = 0; px < SIZE; px++) {
      const wx = X0 + ((px + 0.5) / SIZE) * (X1 - X0);
      const ci = vis.cellIndex(wx, wy);
      if (!vis.grids[0][ci]) {
        const o = (py * SIZE + px) * 3;
        const k = vis.los[0][ci] ? 0.55 : 0.3; // 视线可达但被草丛规则隐藏的格子稍亮
        img[o] *= k; img[o + 1] *= k; img[o + 2] *= vis.los[0][ci] ? 0.9 : 0.3;
      }
    }
  }
  for (const c of champs) disc(c.x, c.y, Math.max(3, 60 * scale), [255, 255, 255]);
}
// 河道中心线
const RP = MD.RIVER.path;
for (let i = 0; i < RP.length - 1; i++) line(RP[i][0], RP[i][1], RP[i + 1][0], RP[i + 1][1], 1.5, hex(0x1f8a95), 0.8);
// 兵线路径
const LANE_COL = hex(0xd2a93c);
for (const lane of Object.keys(MD.LANES)) {
  const pts = MD.LANES[lane];
  for (let i = 0; i < pts.length - 1; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], Math.max(2, 3.5 * scale * 15), LANE_COL, 0.9);
  for (const [x, y] of pts) disc(x, y, Math.max(2, 3 * scale * 15), hex(0x8a6a1c));
}
// 龙坑
for (const p of Object.values(MD.PITS)) ring(p.x, p.y, p.r * scale, 3, hex(0xa050d0));
// 泉水
for (const f of MD.FOUNTAINS) {
  const c = f.team === 0 ? hex(0x2f86d6) : hex(0xd03a3a);
  ring(f.x, f.y, f.radius * scale, 2, c, 0.8);
  disc(f.x, f.y, Math.max(4, 110 * scale), c);
  for (const s of f.spawns) disc(s.x, s.y, Math.max(2, 40 * scale), [255, 255, 255]);
}
// 营地
for (const c of MD.CAMPS) {
  const big = ['blue', 'red', 'dragon', 'baron', 'herald'].includes(c.kind);
  ring(c.x, c.y, (big ? 170 : 120) * scale + 2, 2, hex(0xffd34d));
  for (const m of c.monsters) disc(m.x, m.y, Math.max(2, (big ? 90 : 55) * scale), hex(0xffd34d));
  // 朝向
  line(c.x, c.y, c.x + Math.cos(c.facing) * 300, c.y + Math.sin(c.facing) * 300, 1.5, hex(0xff9f1a));
}
// 建筑
const TIER_PX = { outer: 5, inner: 6, inhib: 7, nexus: 6 };
for (const s of MD.STRUCTURES) {
  const col = s.team === 0 ? hex(0x2f86d6) : hex(0xd03a3a);
  const k = scale * 15;
  if (s.kind === 'turret') rect(s.x, s.y, Math.round((TIER_PX[s.tier] ?? 5) * k), col);
  else if (s.kind === 'inhibitor') rect(s.x, s.y, Math.round(8 * k), s.team === 0 ? hex(0x7cc4ff) : hex(0xff7c9c));
  else if (s.kind === 'nexus') rect(s.x, s.y, Math.round(12 * k), s.team === 0 ? hex(0x9fdcff) : hex(0xffa0b4));
}
const file = path.resolve(ROOT, opt.out);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, encodePNG(SIZE, SIZE, img));
let walkCells = 0;
for (const v of nav.walk) walkCells += v;
console.log(`已写入 ${path.relative(ROOT, file)}（${SIZE}×${SIZE}，区域 ${X0},${Y0}-${X1},${Y1}）`);
console.log(`导航网格构建 ${tBuild.toFixed(1)}ms；可走格 ${walkCells}（${((walkCells / nav.walk.length) * 100).toFixed(1)}%）；连通分量 ${nav.componentCount}；草丛 ${MD.BRUSHES.length}；营地 ${MD.CAMPS.length}`);
