// 小地图：静态底图（nav.terrain 墙体/可走区 + 河道 + 兵线 + 基地 + 草丛 + 龙坑，只在尺寸变化时重建）
// 每帧动态层：迷雾（vision.version 变化才重传）+ 野怪营地 + 建筑 + 守卫 + 小兵 + 英雄头像 + 镜头视野框 + 信号
// 交互：左键点击/拖动移动镜头（锁定镜头时为按住预览），右键命令英雄移动，Alt+左键 发信号
import { h, clamp } from './dom.js';
import { MAP_SIZE } from '../config.js';

const ALLY = '#3aa0ff', ENEMY = '#ff4655', SELF = '#ffd65a', DEAD = '#6b6b70';
const CAMP_STYLE = {
  blue: { r: 0.018, fill: '#2f7fe0', glyph: '' }, red: { r: 0.018, fill: '#e0503a', glyph: '' },
  gromp: { r: 0.012, fill: '#d8b25a' }, wolves: { r: 0.012, fill: '#d8b25a' }, raptors: { r: 0.012, fill: '#d8b25a' }, krugs: { r: 0.012, fill: '#d8b25a' },
  scuttle_top: { r: 0.011, fill: '#5fe0d0' }, scuttle_bot: { r: 0.011, fill: '#5fe0d0' },
  dragon: { r: 0.026, fill: '#ff8a3a', glyph: '龙' }, baron: { r: 0.03, fill: '#a35cff', glyph: '男' }, herald: { r: 0.026, fill: '#b07cff', glyph: '先' },
};
const DRAGON_COL = { infernal: '#ff6a3a', mountain: '#c79a5a', ocean: '#3ad0c0', cloud: '#b8d8ff', elder: '#e8e0ff' };

export class Minimap {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.team = ui.team;
    this.canvas = h('canvas.mm-canvas', { width: 256, height: 256 });
    this.ctx = this.canvas.getContext('2d');
    this.el = h('div.minimap', { 'aria-label': '小地图' },
      h('div.mm-frame', this.canvas, h('i.mm-c.tl'), h('i.mm-c.tr'), h('i.mm-c.bl'), h('i.mm-c.br')),
      h('div.mm-hint', '左键移动镜头 · 右键移动 · Alt+左键 信号'));
    ui.root.appendChild(this.el);
    this.size = 0;
    this.base = null;
    this.fogCv = null;
    this.fogVersion = -1;
    this.pings = [];
    this.t = 0;
    this.sizeAcc = 1;
    this.drag = null;
    this.bind();
  }

  // —— 坐标 ——
  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    const u = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    const v = clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1);
    return { x: u * MAP_SIZE, y: (1 - v) * MAP_SIZE };
  }

  bind() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = this.toWorld(e);
      if (e.button === 0) {
        if (e.altKey) { this.sendPing(p); return; }
        this.drag = e.pointerId;
        cv.setPointerCapture?.(e.pointerId);
        this.look(p);
      } else if (e.button === 2) {
        const me = this.ui.me;
        if (!me || me.controller || !me.alive || this.game.over) return;
        if (this.ui.input?.commandMove?.(p.x, p.y)) this.addPing(p.x, p.y, 'move', true);
      }
    });
    cv.addEventListener('pointermove', (e) => { if (this.drag === e.pointerId) this.look(this.toWorld(e)); });
    const end = (e) => {
      if (this.drag !== e.pointerId) return;
      this.drag = null;
      const cam = this.ui.renderer?.cameraCtl;
      if (cam?.locked) cam.endPeek?.();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('lostpointercapture', end);
  }
  look(p) {
    const cam = this.ui.renderer?.cameraCtl;
    if (!cam) return;
    if (cam.locked && cam.peek) cam.peek(p.x, p.y);
    else cam.setTarget?.(p.x, p.y);
  }
  sendPing(p) {
    const me = this.ui.me;
    try { this.game.events.emit('ping', { team: this.team, x: p.x, y: p.y, kind: 'generic', source: me, target: null }); } catch { /* 忽略 */ }
  }
  // 信号动画（game.events 'ping' 或本地移动标记）
  addPing(x, y, kind = 'generic', local = false) {
    this.pings.push({ x, y, kind, t0: this.t, dur: local ? 0.7 : 2.4 });
    if (this.pings.length > 12) this.pings.shift();
  }

  // —— 尺寸：CSS 尺寸 × DPR（上限 2） ——
  checkSize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = Math.max(64, Math.round(Math.max(r.width, 1) * dpr));
    if (s === this.size || r.width < 8) return;
    this.size = s;
    this.canvas.width = this.canvas.height = s;
    this.buildBase();
  }

  // —— 静态底图 ——
  buildBase() {
    const S = this.size;
    const game = this.game;
    const nav = game.nav;
    const M = game.map || {};
    const base = document.createElement('canvas');
    base.width = base.height = S;
    const g = base.getContext('2d');
    g.fillStyle = '#0d1a14';
    g.fillRect(0, 0, S, S);
    const terr = nav?.terrain || nav?.walk;
    const C = nav?.cols || 300, R = nav?.rows || 300, cs = nav?.cellSize || 50;
    let walkMask = null;
    if (terr) {
      // 逐格着色：墙体（深绿树冠，靠近可走区的一圈较亮）、地面、河道、基地、龙坑
      const img = new ImageData(C, R);
      const mask = new ImageData(C, R);
      const d = img.data, md = mask.data;
      const inRiver = typeof M.isInRiver === 'function' ? M.isInRiver : () => false;
      const pip = typeof M.pointInPoly === 'function' ? M.pointInPoly : null;
      const bases = M.BASE_BOUNDARY || [];
      const pits = M.PITS ? Object.values(M.PITS) : [];
      const at = (c, r) => (c < 0 || r < 0 || c >= C || r >= R ? 0 : terr[r * C + c]);
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const i = r * C + c;
          const o = ((R - 1 - r) * C + c) * 4;
          const x = (c + 0.5) * cs, y = (r + 0.5) * cs;
          const n = ((c * 73856093) ^ (r * 19349663)) & 15;   // 伪随机噪声
          let rgb;
          if (!terr[i]) {
            const edge = at(c - 1, r) || at(c + 1, r) || at(c, r - 1) || at(c, r + 1);
            rgb = edge ? [52, 78, 50] : [24 + n, 46 + n, 32 + (n >> 1)];
          } else {
            md[o + 3] = 255;
            const edge = !at(c - 1, r) || !at(c + 1, r) || !at(c, r - 1) || !at(c, r + 1);
            if (inRiver(x, y)) rgb = edge ? [48, 110, 118] : [42 + (n >> 1), 122 + n, 132 + n];
            else {
              let team = -1;
              if (pip) for (let t = 0; t < bases.length; t++) if (bases[t] && pip(x, y, bases[t])) { team = t; break; }
              if (team === 0) rgb = [70 + n, 92 + n, 118 + n];
              else if (team === 1) rgb = [104 + n, 72 + n, 86 + n];
              else rgb = [74 + n, 104 + n, 58 + (n >> 1)];
              for (const p of pits) if (p && Math.hypot(x - p.x, y - p.y) < (p.r || 600)) { rgb = [rgb[0] - 16, rgb[1] - 14, rgb[2] - 6]; break; }
              if (edge) rgb = [rgb[0] - 18, rgb[1] - 20, rgb[2] - 16];
            }
          }
          d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = C; tmp.height = R;
      tmp.getContext('2d').putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(tmp, 0, 0, S, S);
      walkMask = document.createElement('canvas');
      walkMask.width = C; walkMask.height = R;
      walkMask.getContext('2d').putImageData(mask, 0, 0);
    }
    const P = (x, y) => [(x / MAP_SIZE) * S, (1 - y / MAP_SIZE) * S];
    const k = S / MAP_SIZE;
    // 叠加层（兵线/草丛）裁剪到可走区
    const layer = document.createElement('canvas');
    layer.width = layer.height = S;
    const lg = layer.getContext('2d');
    lg.lineCap = 'round'; lg.lineJoin = 'round';
    const lanes = M.LANE_CENTERLINES || M.LANES || {};
    for (const key of Object.keys(lanes)) {
      const pts = lanes[key];
      if (!Array.isArray(pts) || pts.length < 2) continue;
      lg.beginPath();
      pts.forEach((p, i) => { const [x, y] = P(p[0] ?? p.x, p[1] ?? p.y); if (i) lg.lineTo(x, y); else lg.moveTo(x, y); });
      lg.strokeStyle = 'rgba(176,150,100,0.62)';
      lg.lineWidth = 560 * k;
      lg.stroke();
      lg.strokeStyle = 'rgba(206,182,128,0.35)';
      lg.lineWidth = 260 * k;
      lg.stroke();
    }
    for (const b of M.BRUSHES || []) {
      const poly = b?.poly;
      if (!poly || poly.length < 3) continue;
      lg.beginPath();
      poly.forEach((p, i) => { const [x, y] = P(p[0], p[1]); if (i) lg.lineTo(x, y); else lg.moveTo(x, y); });
      lg.closePath();
      lg.fillStyle = 'rgba(22,70,34,0.85)';
      lg.fill();
    }
    if (walkMask) {
      lg.globalCompositeOperation = 'destination-in';
      lg.imageSmoothingEnabled = true;
      lg.drawImage(walkMask, 0, 0, S, S);
      lg.globalCompositeOperation = 'source-over';
    }
    g.drawImage(layer, 0, 0);
    // 龙坑外圈
    for (const p of M.PITS ? Object.values(M.PITS) : []) {
      if (!p) continue;
      const [x, y] = P(p.x, p.y);
      g.strokeStyle = 'rgba(10,20,14,0.55)';
      g.lineWidth = Math.max(1, S * 0.004);
      g.beginPath(); g.arc(x, y, (p.r || 600) * k, 0, Math.PI * 2); g.stroke();
    }
    // 暗角
    const vg = g.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = vg;
    g.fillRect(0, 0, S, S);
    this.base = base;
    this.fogVersion = -1;
  }

  // —— 迷雾：150×150 可见格 → 小画布（alpha），绘制时平滑放大 ——
  updateFog() {
    const v = this.game.vision;
    const grid = v?.grids?.[this.team];
    if (!grid) return false;
    const C = v.cols || 150, R = v.rows || 150;
    if (!this.fogCv) {
      this.fogCv = document.createElement('canvas');
      this.fogCv.width = C; this.fogCv.height = R;
      this.fogCtx = this.fogCv.getContext('2d');
      this.fogImg = this.fogCtx.createImageData(C, R);
      const d = this.fogImg.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = 3; d[i + 1] = 9; d[i + 2] = 20; }
    }
    const ver = v.version ?? Math.floor(this.t * 8);
    if (ver !== this.fogVersion) {
      this.fogVersion = ver;
      const d = this.fogImg.data;
      for (let r = 0; r < R; r++) {
        const row = (R - 1 - r) * C;
        for (let c = 0; c < C; c++) d[(row + c) * 4 + 3] = grid[r * C + c] ? 0 : 150;
      }
      this.fogCtx.putImageData(this.fogImg, 0, 0);
    }
    return true;
  }

  update(dt) {
    this.t += dt;
    this.sizeAcc += dt;
    if (this.sizeAcc > 0.5 || !this.size) { this.sizeAcc = 0; this.checkSize(); }
    if (!this.base) return;
    const S = this.size;
    const g = this.ctx;
    const game = this.game;
    const team = this.team;
    const reveal = !!this.ui.renderer?.revealAll;
    const k = S / MAP_SIZE;
    const PX = (x) => x * k, PY = (y) => (MAP_SIZE - y) * k;
    g.globalAlpha = 1;
    g.drawImage(this.base, 0, 0);
    if (!reveal && this.updateFog()) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.fogCv, 0, 0, S, S);
    }
    const u = S / 256;   // 基准缩放（256px 小地图 = 1）
    // 野怪营地
    const camps = game.spawner?.camps || [];
    for (const c of camps) {
      if (!c.alive) continue;
      const st = CAMP_STYLE[c.kind] || CAMP_STYLE.gromp;
      const x = PX(c.def?.x ?? 0), y = PY(c.def?.y ?? 0), r = st.r * S;
      const fill = c.kind === 'dragon' ? DRAGON_COL[c.dragonType] || st.fill : st.fill;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = 'rgba(8,10,14,0.85)'; g.fill();
      g.lineWidth = Math.max(1, 1.2 * u); g.strokeStyle = fill; g.stroke();
      g.beginPath(); g.arc(x, y, r * 0.5, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
      if (st.glyph) {
        g.fillStyle = '#10141c';
        g.font = `700 ${Math.round(r * 1.05)}px 'Noto Sans SC', sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.beginPath(); g.arc(x, y, r * 0.78, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
        g.fillStyle = '#10141c';
        g.fillText(st.glyph, x, y + r * 0.06);
      }
    }
    // 建筑
    for (const s of game.structures || []) {
      if (s.removed || s.kind === 'fountainTurret') continue;
      const x = PX(s.x), y = PY(s.y);
      const col = !s.alive ? DEAD : s.team === team ? ALLY : ENEMY;
      g.lineWidth = Math.max(1, 1.1 * u);
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.fillStyle = col;
      if (s.type === 'nexus') {
        const r = 7.5 * u;
        g.beginPath();
        for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.beginPath(); g.arc(x, y, r * 0.35, 0, Math.PI * 2); g.fill();
      } else if (s.type === 'inhibitor') {
        const r = 5.2 * u;
        g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath();
        g.fill(); g.stroke();
        if (!s.alive && s.respawnRemaining > 0) {
          const f = 1 - s.respawnRemaining / 300;
          g.strokeStyle = s.team === team ? ALLY : ENEMY;
          g.lineWidth = 1.4 * u;
          g.beginPath(); g.arc(x, y, r + 2 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(f, 0, 1)); g.stroke();
        }
      } else {
        // 防御塔：按 tier 大小，塔身 + 顶部
        const sc = s.tier === 'nexus' ? 0.85 : s.tier === 'inhib' ? 1 : s.tier === 'inner' ? 1.05 : 1.1;
        const w = 4.2 * u * sc, hh = 6 * u * sc;
        if (!s.alive) {
          g.fillStyle = 'rgba(90,90,96,0.8)';
          g.fillRect(x - w * 0.6, y - w * 0.3, w * 1.2, w * 0.6);
          continue;
        }
        g.beginPath();
        g.moveTo(x - w, y + hh * 0.55); g.lineTo(x - w * 0.62, y - hh * 0.45); g.lineTo(x - w, y - hh * 0.45);
        g.lineTo(x - w, y - hh * 0.8); g.lineTo(x + w, y - hh * 0.8); g.lineTo(x + w, y - hh * 0.45);
        g.lineTo(x + w * 0.62, y - hh * 0.45); g.lineTo(x + w, y + hh * 0.55); g.closePath();
        g.fill(); g.stroke();
        const mh = Math.max(1, s.stats?.maxHp || s.maxHp || 1);
        if (s.hp < mh * 0.999) {
          const f = clamp(s.hp / mh, 0, 1);
          g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x - w, y + hh * 0.7, w * 2, 1.6 * u);
          g.fillStyle = col; g.fillRect(x - w, y + hh * 0.7, w * 2 * f, 1.6 * u);
        }
      }
    }
    // 守卫
    for (const w of game.wards || []) {
      if (!w.alive || w.removed) continue;
      const own = w.team === team;
      if (!own && !reveal && !w.visible?.[team]) continue;
      const x = PX(w.x), y = PY(w.y);
      g.beginPath(); g.arc(x, y, 2.4 * u, 0, Math.PI * 2);
      g.fillStyle = own ? (w.kind === 'control' ? '#ff6ad5' : '#ffd65a') : '#ff4655';
      g.fill();
      g.lineWidth = Math.max(1, 0.8 * u); g.strokeStyle = 'rgba(0,0,0,0.8)'; g.stroke();
    }
    // 小兵与宠物（按阵营批量绘制）
    const mr = Math.max(1.2, 1.7 * u);
    for (const pass of [0, 1]) {
      g.beginPath();
      for (const m of game.minions || []) {
        if (!m.alive || m.removed) continue;
        const own = m.team === team;
        if ((pass === 0) !== own) continue;
        if (!own && !reveal && !m.visible?.[team]) continue;
        g.rect(PX(m.x) - mr, PY(m.y) - mr, mr * 2, mr * 2);
      }
      for (const p of game.pets || []) {
        if (!p.alive || p.removed || p.untargetable) continue;
        const own = p.team === team;
        if ((pass === 0) !== own) continue;
        if (!own && !reveal && !p.visible?.[team]) continue;
        g.rect(PX(p.x) - mr * 1.2, PY(p.y) - mr * 1.2, mr * 2.4, mr * 2.4);
      }
      g.fillStyle = pass === 0 ? '#7cc4ff' : '#ff7a84';
      g.fill();
    }
    // 英雄头像（敌方 → 队友 → 自己）
    const me = this.ui.me;
    const list = game.champions || [];
    const pr = this.ui.portraits;
    for (const pass of [0, 1, 2]) {
      for (const c of list) {
        const isMe = c === me;
        const own = c.team === team;
        if (pass === 0 ? own : pass === 1 ? !own || isMe : !isMe) continue;
        if (!c.alive) continue;
        if (!own && !reveal && !c.visible?.[team]) continue;
        const x = PX(c.x), y = PY(c.y);
        const ring = isMe ? SELF : own ? ALLY : ENEMY;
        const d = Math.round((isMe ? 23 : 20) * u);
        const img = pr?.circle(c.championId, ring, 64);
        if (c.isRecalling && own) {
          const a = 0.5 + 0.5 * Math.sin(this.t * 6);
          g.strokeStyle = `rgba(120,220,255,${0.4 + a * 0.5})`;
          g.lineWidth = 2 * u;
          g.beginPath(); g.arc(x, y, d * 0.62, 0, Math.PI * 2); g.stroke();
        }
        if (img) g.drawImage(img, x - d / 2, y - d / 2, d, d);
        else {
          g.beginPath(); g.arc(x, y, d / 2, 0, Math.PI * 2);
          g.fillStyle = '#10161f'; g.fill();
          g.lineWidth = 2 * u; g.strokeStyle = ring; g.stroke();
        }
      }
    }
    // 信号
    if (this.pings.length) {
      const keep = [];
      for (const p of this.pings) {
        const f = (this.t - p.t0) / p.dur;
        if (f >= 1) continue;
        keep.push(p);
        const x = PX(p.x), y = PY(p.y);
        const col = p.kind === 'move' ? '120,255,150' : p.kind === 'attack' || p.kind === 'danger' ? '255,90,90' : '255,214,90';
        if (p.kind === 'move') {
          g.strokeStyle = `rgba(${col},${1 - f})`;
          g.lineWidth = 1.4 * u;
          g.beginPath(); g.arc(x, y, (2 + f * 6) * u, 0, Math.PI * 2); g.stroke();
          continue;
        }
        for (let i = 0; i < 2; i++) {
          const ff = (f * 2.4 + i * 0.5) % 1;
          g.strokeStyle = `rgba(${col},${(1 - ff) * (1 - f * 0.6)})`;
          g.lineWidth = 1.6 * u;
          g.beginPath(); g.arc(x, y, (3 + ff * 16) * u, 0, Math.PI * 2); g.stroke();
        }
        g.fillStyle = `rgba(${col},${1 - f * 0.5})`;
        g.beginPath(); g.arc(x, y, 3 * u, 0, Math.PI * 2); g.fill();
      }
      this.pings = keep;
    }
    // 镜头视野框
    const cam = this.ui.renderer?.cameraCtl;
    const poly = cam?.getViewPolygon?.();
    if (poly && poly.length >= 4) {
      g.beginPath();
      poly.forEach((p, i) => { const x = clamp(PX(p.x), -S, 2 * S), y = clamp(PY(p.y), -S, 2 * S); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
      g.lineWidth = Math.max(1, 1.2 * u);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.stroke();
    }
  }

  dispose() { this.el.remove(); }
}
