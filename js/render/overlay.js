// 2D 覆盖层（fx）：LoL 风格血条（英雄/小兵/野怪/建筑）、浮动战斗文字、CC 状态、回城进度条、防御塔警示线
// 画在 #overlay-canvas（WebGL 之上，pointer-events: none）；高 DPI 适配；只绘制屏幕内且可见的单位
const PLATE_HP = 1000;   // 与 entities/structures.js 一致（外塔镀层每层生命）
const CC_LABEL = {
  suppress: '压制', airborne: '击飞', stun: '眩晕', charm: '魅惑', fear: '恐惧', taunt: '嘲讽', sleep: '睡眠',
  root: '禁锢', silence: '沉默', disarm: '缴械', blind: '致盲', ground: '禁足', nearsight: '视野受限',
};
const CC_ORDER = ['suppress', 'airborne', 'stun', 'charm', 'fear', 'taunt', 'sleep', 'root', 'silence', 'disarm', 'blind', 'ground', 'nearsight'];
const CC_COLOR = {
  suppress: '#ff5a8a', airborne: '#ffd257', stun: '#ffd257', charm: '#ff7ad9', fear: '#c07aff', taunt: '#ff7a3c', sleep: '#9ab8ff',
  root: '#7ad0ff', silence: '#c58cff', disarm: '#ffb07a', blind: '#b0b0b0', ground: '#8fd48f', nearsight: '#8a8aa0',
};
const DMG_COLOR = { physical: '#ff9a3c', magic: '#8f8aff', true: '#ffffff' };
const GOLD_REASONS = new Set(['minion', 'monster', 'kill', 'assist', 'turret', 'plate', 'objective']);
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC","Helvetica Neue",Arial,sans-serif';
const NUM_FONT = '"Arial Black","Helvetica Neue",Arial,sans-serif';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hexCss = (h) => (typeof h === 'string' ? h : `#${(h >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`);

// 血条配色：[顶部高光, 主色, 底部暗色]
const HP_COLORS = {
  self: ['#8fe36a', '#47b534', '#2a7a1c'],
  ally: ['#6cc0ff', '#2f8fe0', '#1a5c9e'],
  enemy: ['#ff7a6a', '#d4382c', '#8e1c14'],
  neutral: ['#ffb36a', '#d8702e', '#8e4418'],
};

export class Overlay {
  constructor(renderer, game, container) {
    this.renderer = renderer;
    this.game = game;
    this.container = container;
    let cv = container.querySelector?.('#overlay-canvas');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'overlay-canvas';
      cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
      container.appendChild(cv);
    }
    this.canvas = cv;
    this.g = cv.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this.floats = [];
    this.lag = new Map();          // 英雄/建筑受伤「掉血块」
    this._heal = new Map();        // 治疗合并
    this._m = new renderer.THREE.Matrix4();
    this._me = this._m.elements;
    this._p = { x: 0, y: 0 };
    this.time = 0;
    this.enabled = true;
    this._resize();
    this._offResize = renderer.onResize?.(() => this._resize()) || null;
    const ev = game.events;
    this._subs = [
      ev.on('damage', (e) => this._onDamage(e)),
      ev.on('heal', (e) => this._onHeal(e)),
      ev.on('goldGained', (e) => this._onGold(e)),
    ];
  }

  _resize() {
    const r = this.renderer;
    const w = Math.max(1, r.width || this.container.clientWidth || 1), h = Math.max(1, r.height || this.container.clientHeight || 1);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.s = clamp(h / 1000, 0.8, 1.35);   // 界面缩放
  }

  // —— 事件 → 浮动文字（只显示与玩家相关的） ——
  _isMine(src) {
    const p = this.game.player;
    return !!p && !!src && (src === p || src.owner === p);
  }
  _onDamage(e) {
    const p = this.game.player;
    if (!p || !e || !e.target || !(e.amount >= 0.5)) return;
    const t = e.target;
    if (t === p) {
      this._float(t, `${Math.round(e.amount)}`, '#ff3b3b', e.isDot ? 15 : 18, { kind: 'taken' });
    } else if (this._isMine(e.source)) {
      const col = DMG_COLOR[e.type] || DMG_COLOR.physical;
      if (e.isCrit) this._float(t, `${Math.round(e.amount)}!`, e.type === 'physical' ? '#ff7a2a' : col, 30, { crit: true });
      else this._float(t, `${Math.round(e.amount)}`, col, e.isDot ? 15 : e.isBasicAttack ? 19 : 21, {});
    }
  }
  _onHeal(e) {
    const p = this.game.player;
    if (!p || !e || e.target !== p || !(e.amount > 0)) return;
    const a = this._heal.get(p.id) || { amount: 0, t: 0, unit: p };
    a.amount += e.amount;
    this._heal.set(p.id, a);
  }
  _onGold(e) {
    const p = this.game.player;
    if (!p || !e || e.champion !== p || !(e.amount >= 1) || !GOLD_REASONS.has(e.reason)) return;
    const x = Number.isFinite(e.x) ? e.x : p.x, y = Number.isFinite(e.y) ? e.y : p.y;
    this._floatAt(x, y, this.renderer.heightAt(x, y) + 150, `+${Math.round(e.amount)}`, '#ffd34a', 19, { gold: true });
  }
  _float(u, text, color, size, o) {
    const pos = this.renderer.renderPos(u);
    const h = this.renderer.heightAt(pos.x, pos.y) + (pos.z || 0) + this.renderer.viewHeight(u) * 0.9;
    this._floatAt(pos.x, pos.y, h, text, color, size, o);
  }
  _floatAt(x, y, h, text, color, size, o = {}) {
    if (this.floats.length > 90) this.floats.shift();
    const side = Math.random() < 0.5 ? -1 : 1;
    this.floats.push({
      x, y, h, text, color, size, age: 0, life: o.crit ? 1.15 : o.gold ? 1.2 : 0.95,
      vx: o.gold ? 0 : side * (20 + Math.random() * 45), vy: o.gold ? -70 : o.taken ? -60 : -150 - Math.random() * 40,
      g: o.gold ? 0 : 300, crit: !!o.crit, gold: !!o.gold, taken: !!o.taken,
    });
  }

  // —— 投影（CSS 像素） ——
  _prep() {
    const cam = this.renderer.camera;
    cam.updateMatrixWorld();
    this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }
  _proj(x, y, h) {
    const m = this._me, Z = -y;
    const cx = m[0] * x + m[4] * h + m[8] * Z + m[12];
    const cy = m[1] * x + m[5] * h + m[9] * Z + m[13];
    const cw = m[3] * x + m[7] * h + m[11] * Z + m[15];
    if (cw <= 1e-3) return null;
    const p = this._p;
    p.x = (cx / cw + 1) * 0.5 * this.w;
    p.y = (1 - cy / cw) * 0.5 * this.h;
    return p;
  }
  _headPos(u, extra = 0) {
    const r = this.renderer, pos = r.renderPos(u);
    const top = r.heightAt(pos.x, pos.y) + (pos.z || 0) + r.viewHeight(u) + extra;
    const p = this._proj(pos.x, pos.y, top);
    if (!p) return null;
    const m = 140 * this.s;
    if (p.x < -m || p.x > this.w + m || p.y < -m || p.y > this.h + m) return null;
    return p;
  }
  _relation(u) {
    const p = this.game.player, pt = this.renderer.playerTeam;
    if (u === p) return 'self';
    if (u.team === pt) return 'ally';
    if (u.team === 2 || u.type === 'monster') return 'neutral';
    return 'enemy';
  }

  // —— 每帧 ——
  update(dt) {
    const g = this.g, game = this.game;
    const d = game.paused ? 0 : Math.min(0.25, (Number.isFinite(dt) ? dt : 0) * clamp(Number(game.speed) || 1, 0, 8));
    this.time += d;
    if (this.canvas.width !== Math.round(this.renderer.width * this.dpr)) this._resize();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.enabled || game.headless) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._prep();
    this._turretWarnings();
    this._smallBars(d);
    this._championBars(d);
    this._fxTexts();
    this._flushHeals(d);
    this._floatTexts(d);
    this._recallBar();
  }

  // —— 防御塔瞄准玩家：红色警示线 ——
  _turretWarnings() {
    const p = this.game.player, r = this.renderer;
    if (!p || !p.alive) return;
    const g = this.g;
    for (const t of this.game.structures) {
      if (!t.alive || t.type !== 'turret' || t.attackTarget !== p || t.team === p.team) continue;
      const tp = r.renderPos(t);
      const a = this._proj(tp.x, tp.y, r.heightAt(tp.x, tp.y) + r.viewHeight(t) * 0.88);
      if (!a) continue;
      const ax = a.x, ay = a.y;
      const pp = r.renderPos(p);
      const b = this._proj(pp.x, pp.y, r.heightAt(pp.x, pp.y) + (pp.z || 0) + r.viewHeight(p) * 0.55);
      if (!b) continue;
      const pulse = 0.65 + 0.35 * Math.sin(this.time * 12);
      g.save();
      g.lineCap = 'round';
      g.strokeStyle = `rgba(255,40,30,${0.25 * pulse})`;
      g.lineWidth = 9 * this.s;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = `rgba(255,90,70,${0.9 * pulse})`;
      g.lineWidth = 2.2 * this.s;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(b.x, b.y); g.stroke();
      g.fillStyle = `rgba(255,70,50,${0.9 * pulse})`;
      g.beginPath(); g.arc(b.x, b.y, 4 * this.s, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }

  // —— 小血条：小兵 / 野怪 / 宠物 / 建筑 ——
  _smallBars(d) {
    const r = this.renderer, g = this.game, s = this.s;
    const lists = [g.minions, g.monsters, g.pets, g.structures];
    for (let li = 0; li < lists.length; li++) {
      const list = lists[li];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        if (!u.alive || u.removed || !(u.maxHp > 0)) continue;
        const isStruct = u.type === 'turret' || u.type === 'inhibitor' || u.type === 'nexus';
        if (!isStruct && !r.isShown(u)) continue;
        if (u.hideHealthBar || u.kind === 'fountainTurret') continue;
        let W, H, extra = 14;
        if (isStruct) { W = u.type === 'nexus' ? 170 : 150; H = 11; extra = -20; }
        else if (u.type === 'monster') { W = u.epic ? 160 : u.large || u.maxHp > 1500 ? 82 : 58; H = u.epic ? 11 : 6; extra = u.epic ? 10 : 12; }
        else if (u.type === 'pet') { W = 86; H = 7; }
        else { W = u.kind === 'siege' || u.kind === 'super' ? 70 : 60; H = 5; }
        const p = this._headPos(u, extra);
        if (!p) continue;
        W *= s; H = Math.max(3, H * s);
        const rel = this._relation(u);
        const x = Math.round(p.x - W / 2), y = Math.round(p.y - H);
        this._barFrame(x, y, W, H, isStruct || u.epic);
        const shield = u.totalShield || 0;
        const total = Math.max(u.maxHp, u.hp + shield);
        const hpW = (W * clamp01(u.hp / total));
        // 掉血块（建筑与史诗野怪）
        if (isStruct || u.epic) {
          const lw = this._lag(u, d) / total * W;
          if (lw > hpW + 0.5) { this.g.fillStyle = 'rgba(255,236,190,0.85)'; this.g.fillRect(x + hpW, y, Math.min(W, lw) - hpW, H); }
        }
        this._fill(x, y, hpW, H, u.invulnerable && isStruct ? ['#b8b8b8', '#8a8a8a', '#5a5a5a'] : HP_COLORS[rel === 'self' ? 'ally' : rel]);
        if (shield > 0) { this.g.fillStyle = '#eef2f5'; this.g.fillRect(x + hpW, y, (shield / total) * W, H); }
        if (isStruct) this._structureTicks(u, x, y, W, H, total);
        if (u.epic && u.name) this._label(u.name, p.x, y - 4 * s, 12, '#f0e2c0');
      }
    }
  }
  _structureTicks(u, x, y, W, H, total) {
    const g = this.g;
    const plates = u.plates || 0;
    if (plates > 0) {
      // 镀层：金色分隔 + 顶部金边
      g.fillStyle = 'rgba(255,214,110,0.95)';
      for (let k = 1; k < plates; k++) {
        const px = x + (k * PLATE_HP / total) * W;
        g.fillRect(Math.round(px) - 1, y - 1, 2, H + 2);
      }
      g.fillRect(x, y - 2, (Math.min(u.hp, plates * PLATE_HP) / total) * W, 1.5);
    } else {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      const step = total > 6000 ? 1000 : 500;
      for (let v = step; v < total; v += step) g.fillRect(Math.round(x + (v / total) * W), y, 1, H * 0.6);
    }
  }

  // —— 英雄血条 ——
  _championBars(d) {
    const r = this.renderer, s = this.s, game = this.game, player = game.player;
    const list = game.champions;
    // 玩家最后绘制（位于最上层）
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        if ((u === player) !== (pass === 1)) continue;
        if (!u.alive || !r.isShown(u) || u.hideHealthBar) continue;
        const p = this._headPos(u, 26);
        if (!p) continue;
        this._championBar(u, p.x, p.y, d);
      }
    }
  }
  _championBar(u, cx, cy, d) {
    const g = this.g, s = this.s;
    const rel = this._relation(u);
    const res = u.baseStats?.resource || 'mana';
    const hasRes = res !== 'none' && (u.maxMana || 0) > 0;
    const W = Math.round(108 * s), HH = Math.round(12 * s), RH = hasRes ? Math.max(3, Math.round(4 * s)) : 0, gap = hasRes ? 1 : 0;
    const L = Math.round(HH + RH + gap + 6 * s);   // 等级方块边长
    const totalW = W + L + 2;
    const x0 = Math.round(cx - totalW / 2), y0 = Math.round(cy - (HH + RH + gap) - 2);
    const bx = x0 + L + 2, by = y0;
    // 外框
    g.fillStyle = 'rgba(4,7,10,0.88)';
    g.fillRect(x0 - 1, by - 3, totalW + 3, HH + RH + gap + 6);
    g.fillStyle = rel === 'self' ? 'rgba(200,170,110,0.7)' : 'rgba(90,96,104,0.6)';
    g.fillRect(x0 - 1, by - 3, totalW + 3, 1);
    // 等级方块
    const ly = by + (HH + RH + gap) / 2 - L / 2;
    g.fillStyle = '#0b1016';
    g.fillRect(x0, ly, L, L);
    g.strokeStyle = rel === 'self' ? '#c8aa6e' : rel === 'ally' ? '#5d8fb8' : '#b8544a';
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, ly + 0.5, L - 1, L - 1);
    g.font = `bold ${Math.round(11 * s)}px ${NUM_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f0e6d2';
    g.fillText(String(u.level || 1), x0 + L / 2, ly + L / 2 + 0.5);
    // 生命
    const shield = u.totalShield || 0;
    const total = Math.max(u.maxHp, u.hp + shield) || 1;
    const hpW = W * clamp01(u.hp / total);
    g.fillStyle = '#1b1f24';
    g.fillRect(bx, by, W, HH);
    const lw = (this._lag(u, d) / total) * W;
    if (lw > hpW + 0.5) { g.fillStyle = 'rgba(255,238,200,0.9)'; g.fillRect(bx + hpW, by, Math.min(W, lw) - hpW, HH); }
    this._fill(bx, by, hpW, HH, HP_COLORS[rel]);
    if (shield > 0) {
      g.fillStyle = '#f2f5f7';
      g.fillRect(bx + hpW, by, (shield / total) * W, HH);
    }
    // 每 100 生命刻度，每 1000 粗刻度
    g.fillStyle = 'rgba(0,0,0,0.6)';
    const n = Math.floor((total - 1) / 100);
    if (n < 200) {
      for (let k = 1; k <= n; k++) {
        const tx = Math.round(bx + (k * 100 / total) * W);
        if (k % 10 === 0) g.fillRect(tx - 1, by, 2, HH);
        else g.fillRect(tx, by, 1, Math.ceil(HH * 0.45));
      }
    }
    // 资源
    if (hasRes) {
      const ry = by + HH + gap;
      g.fillStyle = '#10151b';
      g.fillRect(bx, ry, W, RH);
      const k = clamp01((u.mana || 0) / (u.maxMana || 1));
      g.fillStyle = res === 'energy' ? '#e8c94a' : '#3b82e0';
      g.fillRect(bx, ry, W * k, RH);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(bx, ry, W * k, 1);
    }
    // 名字
    const name = u.displayName || u.name || '';
    if (name) this._label(name, bx + W / 2, by - 6 * s, 11, rel === 'self' ? '#f7e8b8' : '#eaeaea');
    // CC 状态
    const cc = this._topCC(u);
    if (cc) this._ccTag(cc, bx + W / 2, by - 22 * s);
  }
  _topCC(u) {
    const list = u.ccs;
    if (!list || !list.length) return null;
    const now = this.game.time;
    let best = null, bi = 99;
    for (const c of list) {
      if (!(c.until > now)) continue;
      const i = CC_ORDER.indexOf(c.type);
      if (i < 0) continue;
      if (i < bi || (i === bi && c.until > best.until)) { best = c; bi = i; }
    }
    return best;
  }
  _ccTag(c, cx, cy) {
    const g = this.g, s = this.s;
    const label = CC_LABEL[c.type] || c.type;
    const col = CC_COLOR[c.type] || '#ffffff';
    g.font = `bold ${Math.round(12 * s)}px ${FONT}`;
    const tw = g.measureText(label).width + 14 * s, th = 17 * s;
    const x = cx - tw / 2, y = cy - th;
    g.fillStyle = 'rgba(8,10,14,0.82)';
    g.fillRect(x, y, tw, th);
    const rem = clamp01((c.until - this.game.time) / Math.max(0.05, c.duration || (c.until - (c.start ?? c.until - 1))));
    g.fillStyle = col;
    g.fillRect(x, y + th - 2, tw * rem, 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = col;
    g.fillText(label, cx, y + th / 2 - 1);
  }

  // —— 通用绘制 ——
  _barFrame(x, y, W, H, heavy) {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillRect(x - 1, y - 1, W + 2, H + 2);
    if (heavy) { g.fillStyle = 'rgba(160,140,90,0.55)'; g.fillRect(x - 1, y - 2, W + 2, 1); }
    g.fillStyle = '#1a1d22';
    g.fillRect(x, y, W, H);
  }
  _fill(x, y, w, h, c) {
    if (w <= 0) return;
    const g = this.g;
    g.fillStyle = c[1];
    g.fillRect(x, y, w, h);
    if (h >= 5) {
      g.fillStyle = c[0];
      g.fillRect(x, y, w, Math.max(1, Math.round(h * 0.3)));
      g.fillStyle = c[2];
      g.fillRect(x, y + h - Math.max(1, Math.round(h * 0.2)), w, Math.max(1, Math.round(h * 0.2)));
    }
  }
  _label(text, x, y, size, color) {
    const g = this.g;
    g.font = `bold ${Math.round(size * this.s)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineJoin = 'round';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }
  // 掉血块：受伤后停留 0.35s 再快速回落
  _lag(u, d) {
    let L = this.lag.get(u.id);
    if (!L) { L = { v: u.hp, hold: 0, seen: 0 }; this.lag.set(u.id, L); }
    if (u.hp >= L.v) { L.v = u.hp; L.hold = 0.35; }
    else if ((L.hold -= d) <= 0) L.v = Math.max(u.hp, L.v - (L.v - u.hp) * Math.min(1, d * 7) - u.maxHp * 0.02 * d);
    L.seen = this.time;
    if (this.lag.size > 400) for (const [k, v] of this.lag) if (this.time - v.seen > 5) this.lag.delete(k);
    return L.v;
  }

  // —— 浮动文字 ——
  _flushHeals(d) {
    for (const [id, a] of this._heal) {
      a.t += d;
      if (a.t < 0.3) continue;
      if (a.amount >= 4 && a.unit.alive) this._float(a.unit, `+${Math.round(a.amount)}`, '#5cff6a', 19, { gold: false });
      this._heal.delete(id);
    }
  }
  _floatTexts(d) {
    const F = this.floats, g = this.g, s = this.s;
    let w = 0;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      f.age += d;
      if (f.age >= f.life) continue;
      F[w++] = f;
      const p = this._proj(f.x, f.y, f.h);
      if (!p || p.x < -80 || p.x > this.w + 80 || p.y < -80 || p.y > this.h + 80) continue;
      const t = f.age;
      const ox = f.vx * t, oy = f.vy * t + 0.5 * f.g * t * t;
      let sc = 1;
      if (f.crit) sc = t < 0.1 ? 1.9 - t * 7 : t < 0.2 ? 1.2 - (t - 0.1) * 2 : 1;
      else if (t < 0.08) sc = 1.35 - t * 4.4;
      const k = f.age / f.life;
      const a = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      const size = Math.round(f.size * s * sc);
      g.globalAlpha = a;
      g.font = `${f.crit ? '900' : 'bold'} ${size}px ${NUM_FONT}`;
      g.lineWidth = Math.max(2.5, size * 0.16);
      g.strokeStyle = f.crit ? 'rgba(60,10,0,0.95)' : 'rgba(0,0,0,0.9)';
      const x = p.x + ox, y = p.y + oy - (f.gold ? 10 * s : 0);
      if (f.gold) {
        const tw = g.measureText(f.text).width;
        const r = size * 0.36, ix = x - tw / 2 - r - 3;
        g.fillStyle = '#e8b33a';
        g.beginPath(); g.arc(ix, y, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(70,40,0,0.9)'; g.lineWidth = 1.5; g.stroke();
        g.fillStyle = '#fff2b0'; g.beginPath(); g.arc(ix - r * 0.25, y - r * 0.25, r * 0.35, 0, Math.PI * 2); g.fill();
        g.lineWidth = Math.max(2.5, size * 0.16); g.strokeStyle = 'rgba(0,0,0,0.9)';
      }
      g.strokeText(f.text, x, y);
      g.fillStyle = f.color;
      g.fillText(f.text, x, y);
    }
    F.length = w;
    g.globalAlpha = 1;
  }
  // FX.text 产生的世界文字（上浮淡出）
  _fxTexts() {
    const T = this.renderer.fx?.texts;
    if (!T || !T.length) return;
    const g = this.g, s = this.s;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const t of T) {
      const k = t.age / t.duration;
      const p = this._proj(t.x, t.y, this.renderer.heightAt(t.x, t.y) + t.h);
      if (!p) continue;
      const size = Math.round(t.size * s * (k < 0.1 ? 1.3 - k * 3 : 1));
      g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      g.font = `bold ${size}px ${FONT}`;
      g.lineWidth = Math.max(2.5, size * 0.15);
      g.strokeStyle = 'rgba(0,0,0,0.88)';
      const y = p.y - 40 * s * Math.min(1, k * 1.5);
      g.strokeText(t.text, p.x, y);
      g.fillStyle = hexCss(t.color);
      g.fillText(t.text, p.x, y);
    }
    g.globalAlpha = 1;
  }

  // —— 回城进度条（屏幕下方中央） ——
  _recallBar() {
    const p = this.game.player;
    if (!p || !p.alive || !p.isRecalling || !p.channel) return;
    const ch = p.channel;
    const prog = clamp01(Number.isFinite(ch.progress) ? ch.progress : ch.t / (ch.duration || 1));
    const g = this.g, s = this.s;
    const W = 280 * s, H = 12 * s, x = this.w / 2 - W / 2, y = this.h - 250 * s;
    g.fillStyle = 'rgba(4,8,14,0.85)';
    g.fillRect(x - 3, y - 3, W + 6, H + 6);
    g.strokeStyle = 'rgba(120,170,230,0.8)';
    g.lineWidth = 1;
    g.strokeRect(x - 2.5, y - 2.5, W + 5, H + 5);
    const grd = g.createLinearGradient(x, 0, x + W, 0);
    grd.addColorStop(0, '#1d5fb8');
    grd.addColorStop(1, '#6cc4ff');
    g.fillStyle = grd;
    g.fillRect(x, y, W * prog, H);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(x, y, W * prog, Math.max(1, H * 0.3));
    const rem = Math.max(0, (ch.duration || 0) - (ch.t || 0));
    this._label(`回城  ${rem.toFixed(1)}`, this.w / 2, y - 7 * s, 13, '#cfe6ff');
  }

  dispose() {
    for (const off of this._subs) { try { off?.(); } catch { /* 忽略 */ } }
    this._subs.length = 0;
    this._offResize?.();
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export default Overlay;
