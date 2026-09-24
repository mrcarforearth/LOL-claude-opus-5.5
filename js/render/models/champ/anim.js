// 程序化动画：依据 entity.anim（状态/时间/速度/前摇/槽位）与 modelState 生成目标姿态并平滑混合，外加披风/尾巴/发辫等次级运动
// 角度约定（骨骼局部，XYZ 欧拉）：手臂/腿 z>0 向前摆；脊柱 z<0 前倾；右臂 x<0 外展（左臂镜像）；手臂 y 为水平扫动（arm() 中 twist>0 = 向内）。
import * as THREE from 'three';
import { PI, TAU, clamp, clamp01, smooth, mix } from './kit.js';

const EX_MPOS = 0, EX_MROT = 3, EX_HIPS = 6; // 附加通道：mover 位置/旋转、骨盆位移

export class Animator {
  constructor(bp, inst, seed = 0) {
    this.meta = bp.meta;
    this.M = bp.meta.M;
    this.H = this.M ? this.M.H : 200;
    this.inst = inst;
    this.bones = inst.bones;
    const n = inst.bones.length;
    this.tgt = new Float32Array(n * 3);
    this.cur = new Float32Array(n * 3);
    this.ex = new Float32Array(9);
    this.exCur = new Float32Array(9);
    this.idx = Object.create(null);
    bp.bones.forEach((b, i) => { this.idx[b.name] = i; });
    this.basePos = bp.bones.map((b) => b.pos);
    this.chainSet = new Uint8Array(n);
    this.chains = (bp.meta.chains || []).map((c) => ({ ...c, ids: c.names.map((nm) => this.idx[nm]).filter((i) => i !== undefined) }));
    for (const c of this.chains) for (const i of c.ids) this.chainSet[i] = 1;
    this.phase = seed * 3.1;
    this.time = seed * 7.3;
    this.st = null; this.t = 0; this.rawT = -1;
    this.moveK = 0;
    this.spinT = 0; this.spinAng = 0;
    this.K = 0; this.S = 0; this.F = 0; this.Rr = 0;
    this.drawString = 0;
    this.first = true;
  }

  // —— 写姿态 ——
  R(name, x, y, z) { const i = this.idx[name]; if (i === undefined) return; const t = this.tgt; t[i * 3] = x; t[i * 3 + 1] = y; t[i * 3 + 2] = z; }
  A(name, x, y, z) { const i = this.idx[name]; if (i === undefined) return; const t = this.tgt; t[i * 3] += x; t[i * 3 + 1] += y; t[i * 3 + 2] += z; }
  get(name, k) { const i = this.idx[name]; return i === undefined ? 0 : this.tgt[i * 3 + k]; }
  arm(sd, flex, abd, twist, elbow) {
    const s = sd === 'R' ? 1 : -1;
    this.R('ua' + sd, -s * abd, s * twist, flex);
    this.R('fa' + sd, 0, 0, elbow);
  }
  leg(sd, flex, abd, knee, foot = 0) {
    const s = sd === 'R' ? 1 : -1;
    this.R('th' + sd, -s * abd, 0, flex);
    this.R('sn' + sd, 0, 0, -knee);
    this.R('ft' + sd, 0, 0, knee - flex + foot);
  }
  // 关键帧插值：rest → A（蓄力）→ B（命中峰值）→ C（随势）→ rest（恢复）
  q(r, a, b, c = b) { return mix(mix(mix(mix(r, a, this.K), b, this.S), c, this.F), r, this.Rr); }
  phases(p) {
    this.K = smooth(p / 0.6);
    this.S = smooth((p - 0.6) / 0.4);
    this.F = smooth((p - 1) / 0.45);
    this.Rr = smooth((p - 1.7) / 0.9);
  }
  armQ(sd, r, a, b, c) {
    this.arm(sd, this.q(r[0], a[0], b[0], c && c[0]), this.q(r[1], a[1], b[1], c && c[1]), this.q(r[2], a[2], b[2], c && c[2]), this.q(r[3], a[3], b[3], c && c[3]));
  }
  RQ(name, r, a, b, c) { this.R(name, this.q(r[0], a[0], b[0], c && c[0]), this.q(r[1], a[1], b[1], c && c[1]), this.q(r[2], a[2], b[2], c && c[2])); }
  // 脚落地：按腿姿态降低骨盆
  plant(k = 1) {
    const M = this.M;
    if (!M) return;
    let best = -Infinity;
    for (const sd of ['L', 'R']) {
      const th = this.get('th' + sd, 2), sn = this.get('sn' + sd, 2), ab = this.get('th' + sd, 0);
      const vert = (M.Lt * Math.cos(th) + M.Ls * Math.cos(th + sn)) * Math.cos(ab);
      if (vert > best) best = vert;
    }
    this.ex[EX_HIPS + 1] += (best - (M.Lt + M.Ls)) * k;
  }

  update(dt, e, v) {
    this.time += dt;
    const a = e.anim || {};
    const ms = e.modelState || {};
    const state = v.dead ? 'death' : (a.state || 'idle');
    if (state !== this.st) { this.st = state; this.t = a.t || 0; this.rawT = a.t; }
    else if (a.t !== this.rawT) { this.rawT = a.t; this.t = Math.max(a.t || 0, this.t - 0.03); }
    else this.t += dt;
    const t = this.t;
    this.tgt.fill(0);
    this.ex.fill(0);
    this.drawString = 0;
    const style = STYLES[this.meta.style] || STYLES.base;
    let rate = 13;
    const moving = state === 'run' || state === 'dash';
    this.moveK += ((moving ? 1 : 0) - this.moveK) * Math.min(1, dt * 5);

    switch (state) {
      case 'death': this.death(v.deadT); rate = 9; break;
      case 'run': this.run(dt, a, style, ms); break;
      case 'attack': {
        const w = Math.max(0.08, a.windup || 0.3);
        this.idle(style, ms);
        this.phases(t / w);
        style.attack(this, a.attackIndex || 0, ms, t / w);
        this.plant();
        rate = 30;
        break;
      }
      case 'cast': {
        this.idle(style, ms);
        this.phases(t / 0.22);
        style.cast(this, a.slot, ms, t);
        this.plant();
        rate = 26;
        break;
      }
      case 'recall': this.kneel(style, ms, t); rate = 8; break;
      case 'channel': this.idle(style, ms); this.phases(t / 0.25); (style.channel || chantPose)(this, ms, t); this.plant(); break;
      case 'dash': this.dash(e, style, ms); rate = 18; break;
      case 'airborne': this.airborne(t); rate = 16; break;
      case 'stunned': this.stunned(style, ms); break;
      default: this.idle(style, ms); this.plant(); break;
    }
    // —— modelState 覆盖 ——
    if (state !== 'death') this.overrides(dt, ms, state, style);
    else { this.spinT = 0; }
    this.secondary(dt, state);
    this.blend(dt, rate);
    this.apply(v);
  }

  // —— 基础姿态 ——
  idle(style, ms) {
    const b = Math.sin(this.time * 2.1);
    this.R('spine', 0, 0, -0.03 + 0.012 * b);
    this.R('chest', 0, 0, 0.014 * b);
    this.R('head', 0, 0, 0.04 - 0.015 * b);
    this.arm('R', 0.08, 0.14 + 0.02 * b, 0, 0.25);
    this.arm('L', 0.08, 0.14 + 0.02 * b, 0, 0.25);
    this.leg('R', 0.04, 0.07, 0.1);
    this.leg('L', -0.03, 0.07, 0.07);
    style.idle(this, ms, b);
  }
  run(dt, a, style, ms) {
    const sp = clamp(a.speed || 1, 0.5, 2.2);
    const freq = style.runFreq || 1.45;
    this.phase += dt * TAU * freq * Math.pow(sp, 0.6);
    const p = this.phase, s = Math.sin(p), c = Math.cos(p);
    const amp = (style.runAmp || 0.72) * (0.85 + 0.15 * sp);
    this.leg('L', amp * s, 0.05, 0.28 + 1.1 * Math.max(0, c), 0.1 * Math.max(0, -c));
    this.leg('R', -amp * s, 0.05, 0.28 + 1.1 * Math.max(0, -c), 0.1 * Math.max(0, c));
    this.plant(0.45);
    this.ex[EX_HIPS + 1] += (Math.abs(c) - 0.5) * 0.022 * this.H;
    this.R('hips', 0, -0.13 * s, 0);
    this.R('spine', 0, 0.08 * s, -(style.runLean ?? 0.12) - 0.05 * sp);
    this.R('chest', 0, 0.14 * s, -0.04);
    this.R('head', 0, -0.2 * s, 0.14);
    this.arm('L', -0.62 * s, 0.14, 0, 0.95 + 0.3 * s);
    this.arm('R', 0.62 * s, 0.14, 0, 0.95 - 0.3 * s);
    style.run(this, ms, s, c);
  }
  kneel(style, ms, t) {
    const M = this.M;
    const k = smooth(t / 0.45);
    const br = Math.sin(this.time * 1.6) * 0.02;
    this.leg('L', mix(0, 1.5, k), 0.12, mix(0.05, 1.55, k));
    this.leg('R', mix(0, -0.05, k), 0.1, mix(0.05, 1.5, k), 0.6 * k);
    this.ex[EX_HIPS + 1] = -k * (M ? M.Ls + M.ankle - M.H * 0.03 : 50);
    this.R('spine', 0, 0, -0.18 * k + br);
    this.R('chest', 0, 0, -0.1 * k);
    this.R('head', 0, 0, -0.35 * k);
    this.arm('L', 0.9 * k, 0.12, 0.2, 0.8 * k);
    this.arm('R', 0.35 * k, 0.2, 0, 0.3);
    (style.kneel || noop)(this, ms, k);
  }
  dash(e, style, ms) {
    this.R('spine', 0, 0, -0.45);
    this.R('chest', 0, 0, -0.1);
    this.R('head', 0, 0, 0.35);
    this.arm('R', -0.9, 0.3, 0, 0.4);
    this.arm('L', -0.9, 0.3, 0, 0.4);
    if ((e.z || 0) > 8) { this.leg('L', 1.2, 0.1, 1.9); this.leg('R', 0.9, 0.1, 1.7); }
    else { this.leg('L', 0.85, 0.08, 1.2); this.leg('R', -0.55, 0.08, 0.5); this.plant(0.6); }
    (style.dash || noop)(this, ms);
  }
  airborne(t) {
    const w = Math.sin(this.time * 9);
    this.ex[EX_MROT + 2] = 0.35 + 0.12 * Math.sin(t * 5);
    this.R('head', 0, 0, 0.3);
    this.R('spine', 0.1 * w, 0, 0.1);
    this.arm('R', 0.5 + 0.2 * w, 1.0 + 0.3 * w, 0, 0.5);
    this.arm('L', 0.5 - 0.2 * w, 1.0 - 0.3 * w, 0, 0.5);
    this.leg('L', 0.6, 0.15, 0.9);
    this.leg('R', 0.2, 0.15, 1.2);
  }
  stunned(style, ms) {
    const T = this.time;
    this.R('spine', 0.08 * Math.sin(T * 3.1), 0, -0.15);
    this.R('head', 0.25 * Math.sin(T * 3.1), 0.15 * Math.sin(T * 2.3), -0.35 + 0.1 * Math.sin(T * 5));
    this.arm('R', 0.05, 0.1, 0, 0.15);
    this.arm('L', 0.05, 0.1, 0, 0.15);
    this.leg('L', 0.15, 0.08, 0.35);
    this.leg('R', 0.05, 0.08, 0.3);
    (style.stunned || noop)(this, ms);
    this.plant();
  }
  death(d) {
    const f = smooth(d / 0.65);
    const buckle = smooth(d / 0.25) * (1 - f * 0.6);
    this.leg('L', 0.35 * buckle + 0.15 * f, 0.1 + 0.1 * f, 0.9 * buckle + 0.2 * f);
    this.leg('R', 0.2 * buckle + 0.05 * f, 0.1 + 0.15 * f, 0.7 * buckle + 0.1 * f);
    this.arm('R', 0.3 + 0.3 * f, 0.4 + 0.8 * f, 0, 0.4);
    this.arm('L', 0.3 + 0.2 * f, 0.4 + 0.7 * f, 0, 0.5);
    this.R('head', 0, 0.5 * f, 0.2 * f);
    this.R('spine', 0, 0, 0.1 * f);
    this.ex[EX_MROT + 2] = 1.48 * f;
    this.ex[EX_MPOS + 1] = this.H * (0.06 * f - 0.12 * buckle * (1 - f));
    this.ex[EX_MPOS + 0] = -this.H * 0.05 * f;
  }

  overrides(dt, ms, state, style) {
    // 盖伦 E：旋转
    if (ms.spinning) {
      this.spinAng += dt * 15;
      this.ex[EX_MROT + 1] = this.spinAng;
      this.arm('R', 0.3, 1.35, 0, 0.1);
      this.R('wpR', 0, 0.2, -1.5);
      this.arm('L', 0.3, 1.1, 0, 0.3);
      this.R('spine', 0, 0, -0.05);
      this.R('chest', 0, 0, 0);
    } else if (ms.axeSpin) {
      // 德莱厄斯 Q：蓄力后一记大回旋
      this.spinT += dt;
      const k = this.spinT;
      if (k < 0.45) {
        const w = smooth(k / 0.3);
        this.arm('R', mix(0.3, 1.1, w), mix(0.25, 1.2, w), mix(0.1, -1.0, w), 0.3);
        this.R('wpR', 0, 0, -1.4);
        this.arm('L', 0.9, 0.3, 0.8, 1.0);
        this.R('chest', 0, -0.9 * w, 0);
        this.R('spine', 0, -0.3 * w, -0.1);
      } else {
        const w = smooth((k - 0.45) / 0.35);
        this.ex[EX_MROT + 1] = -w * TAU;
        this.arm('R', 0.35, 1.35, 0, 0.1);
        this.R('wpR', 0, 0, -1.5);
        this.arm('L', 0.35, 1.2, 0, 0.2);
      }
      this.leg('L', 0.25, 0.25, 0.5);
      this.leg('R', -0.2, 0.25, 0.45);
      this.plant();
    } else {
      this.spinT = 0;
      this.spinAng = 0;
    }
    if (ms.meditating) meditate(this);
    if (ms.finalSpark && style.spark) style.spark(this);
  }

  // —— 次级运动（写入链骨骼目标，混合时用较慢速率） ——
  secondary(dt, state) {
    const T = this.time, mv = this.moveK;
    const lean = this.get('spine', 2) + this.get('chest', 2);
    const thMax = Math.max(this.get('thL', 2), this.get('thR', 2), 0);
    const thMin = Math.min(this.get('thL', 2), this.get('thR', 2), 0);
    for (const c of this.chains) {
      const n = c.ids.length, ph = c.phase || 0, amp = c.amp || 1;
      for (let j = 0; j < n; j++) {
        const i = c.ids[j];
        const t = this.tgt;
        let x = 0, y = 0, z = 0;
        switch (c.kind) {
          case 'cape':
            z = -(0.1 + 0.5 * mv) * (j === 0 ? 0.7 : 0.35) + Math.sin(T * 6 + j * 1.2 + ph) * 0.04 * (0.4 + mv);
            if (j === 0) z -= lean * 0.9 - thMin * 0.3;
            x = Math.sin(T * 2.3 + j) * 0.03;
            break;
          case 'hair':
            z = -(0.06 + 0.35 * mv) * (j + 1) / n * amp + Math.sin(T * 2.4 + j + ph) * 0.05 * amp;
            if (j === 0) z -= lean * 0.7;
            x = Math.sin(T * 1.7 + j * 0.8 + ph) * 0.05 * amp;
            break;
          case 'braid':
            z = -mv * (0.2 + 0.12 * j) + Math.sin(T * 2 + j * 0.9 + ph) * 0.05;
            if (j === 0) z -= lean * 0.8;
            x = Math.sin(T * 1.5 + j + ph) * 0.07;
            break;
          case 'tail':
            y = Math.sin(T * 1.9 + ph - j * 0.8) * 0.17 * (1 + j * 0.35);
            z = 0.1 * Math.sin(T * 1.4 + ph + j) + mv * 0.25 * (j === 0 ? 1 : 0.4);
            x = Math.sin(T * 1.2 + ph * 1.3 + j) * 0.09;
            break;
          case 'ribbon':
            y = Math.sin(T * 9 + j * 1.3 + ph) * 0.22 * (0.4 + mv);
            z = 0.45 * (1 - mv) - 0.1 * mv + Math.sin(T * 7 + ph) * 0.06;
            break;
          case 'skirtF':
            z = j === 0 ? thMax * 0.85 : -thMax * 0.25;
            if (j === 0) z -= lean * 0.5;
            break;
          case 'skirtB':
            z = j === 0 ? thMin * 0.8 - mv * 0.12 : thMin * 0.2;
            if (j === 0) z -= lean * 0.5;
            break;
          case 'chain':
            z = Math.sin(T * 2.3 + j) * 0.12;
            x = Math.sin(T * 1.7 + j * 1.4) * 0.1;
            break;
          default: break;
        }
        t[i * 3] += x; t[i * 3 + 1] += y; t[i * 3 + 2] += z;
      }
    }
    void state;
  }

  blend(dt, rate) {
    const k = this.first ? 1 : 1 - Math.exp(-rate * dt);
    const kc = this.first ? 1 : 1 - Math.exp(-7 * dt);
    const cur = this.cur, tgt = this.tgt, cs = this.chainSet;
    for (let i = 0; i < cs.length; i++) {
      const kk = cs[i] ? kc : k;
      const o = i * 3;
      cur[o] += (tgt[o] - cur[o]) * kk;
      cur[o + 1] += (tgt[o + 1] - cur[o + 1]) * kk;
      cur[o + 2] += (tgt[o + 2] - cur[o + 2]) * kk;
    }
    for (let i = 0; i < 9; i++) {
      // 旋转（整圈）不做插值，避免回卷
      if (i === EX_MROT + 1) this.exCur[i] = this.ex[i];
      else this.exCur[i] += (this.ex[i] - this.exCur[i]) * k;
    }
    this.first = false;
  }

  apply(v) {
    const cur = this.cur, bones = this.bones;
    for (let i = 0; i < bones.length; i++) {
      bones[i].rotation.set(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]);
    }
    const hi = this.idx.hips;
    if (hi !== undefined) {
      const bp = this.basePos[hi];
      bones[hi].position.set(bp[0] + this.exCur[EX_HIPS], bp[1] + this.exCur[EX_HIPS + 1], bp[2] + this.exCur[EX_HIPS + 2]);
    }
    const m = v.mover;
    m.position.set(this.exCur[EX_MPOS], this.exCur[EX_MPOS + 1], this.exCur[EX_MPOS + 2]);
    m.rotation.set(this.exCur[EX_MROT], this.exCur[EX_MROT + 1], this.exCur[EX_MROT + 2]);
    v.drawString = this.drawString;
  }
  reset() { this.first = true; this.st = null; this.spinT = 0; this.spinAng = 0; }
}

function noop() {}

// 通用吟唱（channel）：双手前伸
function chantPose(A, ms, t) {
  const w = Math.sin(t * 4) * 0.05;
  A.arm('R', 1.1 + w, 0.35, 0.3, 0.6);
  A.arm('L', 1.1 - w, 0.35, 0.3, 0.6);
  A.R('head', 0, 0, -0.1);
}

// 易 W：盘坐冥想（悬浮）
function meditate(A) {
  const M = A.M;
  const hov = Math.sin(A.time * 2) * 0.012 * A.H;
  A.ex[EX_HIPS + 1] = -(M.Lt + M.Ls + M.ankle) + M.H * 0.07 + hov;
  A.ex[EX_MROT + 2] = 0;
  A.leg('L', 1.45, 0.75, 2.45, -0.3);
  A.leg('R', 1.45, 0.75, 2.45, -0.3);
  A.R('snL', 0, -0.6, -2.45);
  A.R('snR', 0, 0.6, -2.45);
  A.R('spine', 0, 0, 0.02);
  A.R('chest', 0, 0, 0);
  A.R('head', 0, 0, -0.2);
  A.arm('R', 0.55, 0.05, 0.55, 1.45);
  A.arm('L', 0.55, 0.05, 0.55, 1.45);
  A.R('wpR', 0, 0.9, -0.2);
}

// ———————————————— 各武器风格 ————————————————
const STYLES = {};

STYLES.base = {
  idle() {},
  run() {},
  attack(A) {
    A.armQ('R', [0.08, 0.14, 0, 0.25], [0.5, 0.4, -0.3, 1.5], [1.4, 0.15, 0.2, 0.15]);
  },
  cast(A) { A.armQ('R', [0.08, 0.14, 0, 0.25], [0.6, 0.4, -0.2, 1.2], [1.4, 0.2, 0.2, 0.2]); },
};

// 盖伦：巨剑
STYLES.greatsword = {
  idle(A) {
    A.arm('R', 0.35, 0.24, 0.1, 0.55);
    A.R('wpR', 0.15, -0.25, -1.25);
    A.arm('L', 0.12, 0.22, 0, 0.3);
  },
  run(A, ms, s) {
    A.arm('R', -0.35 + 0.15 * s, 0.3, 0, 0.35);
    A.R('wpR', 0, -2.8, -0.5);
  },
  attack(A, idx) {
    const rR = [0.35, 0.24, 0.1, 0.55], rW = [0.15, -0.25, -1.25];
    if (idx % 2 === 0) {
      A.armQ('R', rR, [0.95, 0.95, -0.7, 0.55], [1.25, 0.35, 0.95, 0.15], [1.0, 0.25, 1.25, 0.25]);
      A.RQ('wpR', rW, [0, 0, -1.3], [0, 0.1, -1.45], [0, 0.2, -1.3]);
      A.RQ('chest', [0, 0, 0], [0, -0.55, 0], [0, 0.6, -0.05], [0, 0.75, -0.05]);
      A.RQ('spine', [0, 0, -0.03], [0, -0.2, -0.03], [0, 0.25, -0.1], [0, 0.3, -0.1]);
      A.armQ('L', [0.12, 0.22, 0, 0.3], [0.4, 0.45, 0, 0.5], [-0.3, 0.35, 0, 0.3]);
    } else {
      A.armQ('R', rR, [2.7, 0.3, 0.1, 0.6], [0.75, 0.2, 0.35, 0.1], [0.45, 0.2, 0.35, 0.15]);
      A.RQ('wpR', rW, [0, 0, 0.1], [0, 0, -1.25], [0, 0, -1.35]);
      A.RQ('chest', [0, 0, 0], [0, -0.25, 0.18], [0, 0.25, -0.28], [0, 0.3, -0.3]);
      A.RQ('spine', [0, 0, -0.03], [0, 0, 0.05], [0, 0, -0.12], [0, 0, -0.15]);
      A.armQ('L', [0.12, 0.22, 0, 0.3], [1.2, 0.3, 0.3, 1.0], [0.2, 0.4, 0, 0.3]);
      A.leg('L', A.q(-0.03, 0, 0.35), 0.1, A.q(0.07, 0.1, 0.45));
    }
  },
  cast(A, slot, ms, t) {
    if (slot === 'Q') {
      A.armQ('R', [0.35, 0.24, 0.1, 0.55], [2.9, 0.15, 0, 0.2], [2.9, 0.15, 0, 0.2]);
      A.RQ('wpR', [0.15, -0.25, -1.25], [0, 0, -1.5], [0, 0, -1.5]);
      A.R('chest', 0, 0, 0.15 * A.K);
      A.R('head', 0, 0, 0.25 * A.K);
    } else if (slot === 'W') {
      A.arm('R', 1.1 * A.K, 0.2, 0.7 * A.K, 1.3 * A.K + 0.3);
      A.arm('L', 1.1 * A.K, 0.2, 0.7 * A.K, 1.4 * A.K + 0.3);
      A.R('spine', 0, 0, -0.12 * A.K);
      A.leg('L', 0.25, 0.25, 0.5);
      A.leg('R', -0.15, 0.25, 0.45);
    } else if (slot === 'R') {
      A.phases(t / 0.4);
      A.armQ('R', [0.35, 0.24, 0.1, 0.55], [3.0, 0.1, 0.3, 0.3], [0.9, 0.15, 0.3, 0.1], [0.8, 0.15, 0.3, 0.1]);
      A.armQ('L', [0.12, 0.22, 0, 0.3], [3.0, 0.1, 0.4, 0.4], [1.0, 0.1, 0.5, 0.3], [0.9, 0.1, 0.5, 0.3]);
      A.RQ('wpR', [0.15, -0.25, -1.25], [0, 0, -1.6], [0, 0, -1.3], [0, 0, -1.4]);
      A.RQ('chest', [0, 0, 0], [0, 0, 0.2], [0, 0, -0.4], [0, 0, -0.4]);
      A.R('spine', 0, 0, A.q(-0.03, 0.05, -0.2));
      A.leg('L', A.q(0, 0, 0.5), 0.15, A.q(0.1, 0.1, 0.8));
      A.leg('R', A.q(0, 0, -0.3), 0.15, A.q(0.1, 0.1, 0.5));
    } else {
      A.armQ('R', [0.35, 0.24, 0.1, 0.55], [0.8, 0.5, 0, 0.6], [1.3, 0.3, 0.3, 0.2]);
    }
  },
  kneel(A, ms, k) {
    A.arm('R', 0.55 * k, 0.15, 0.1, 0.4);
    A.R('wpR', 0, 0, -1.9 * k - 0.5);
  },
  dash(A) { A.R('wpR', 0, -2.8, -0.5); },
};

// 德莱厄斯：双刃巨斧
STYLES.axe = {
  idle(A) {
    A.arm('R', 0.3, 0.25, 0.1, 0.95);
    A.R('wpR', 0.2, 0, -1.67);
    A.arm('L', 0.55, 0.05, 0.45, 0.9);
    A.R('chest', 0, 0.05, 0.02);
  },
  run(A, ms, s) {
    A.arm('R', 0.15 + 0.1 * s, 0.3, 0.2, 1.0);
    A.R('wpR', 0.6, 0.5, -0.6);
    A.arm('L', 0.5 - 0.2 * s, 0.12, 0.5, 1.1);
  },
  attack(A, idx) {
    const rR = [0.3, 0.25, 0.1, 0.95], rL = [0.55, 0.05, 0.45, 0.9], rW = [0.2, 0, -1.67];
    if (idx % 2 === 0) {
      A.armQ('R', rR, [2.6, 0.2, 0.15, 0.9], [0.7, 0.15, 0.3, 0.2], [0.5, 0.15, 0.3, 0.2]);
      A.armQ('L', rL, [2.4, -0.1, 0.5, 0.9], [0.75, 0, 0.55, 0.3], [0.6, 0, 0.55, 0.3]);
      A.RQ('wpR', rW, [0, 0, -0.5], [0, 0, -1.3], [0, 0, -1.5]);
      A.RQ('chest', [0, 0.05, 0.02], [0, -0.3, 0.2], [0, 0.2, -0.35], [0, 0.2, -0.4]);
      A.R('spine', 0, 0, A.q(-0.03, 0, -0.15));
      A.leg('L', A.q(-0.03, 0, 0.4), 0.12, A.q(0.07, 0.1, 0.5));
      A.leg('R', A.q(0.04, 0, -0.25), 0.12, A.q(0.1, 0.1, 0.35));
    } else {
      A.armQ('R', rR, [1.0, 0.9, -0.8, 0.4], [1.25, 0.3, 1.0, 0.1], [1.1, 0.25, 1.3, 0.15]);
      A.armQ('L', rL, [0.9, 0.1, 0.9, 1.0], [1.1, 0.1, 0.3, 0.5], [1.0, 0.1, 0.2, 0.5]);
      A.RQ('wpR', rW, [0, 0, -1.35], [0, 0, -1.4], [0, 0, -1.3]);
      A.RQ('chest', [0, 0.05, 0.02], [0, -0.7, 0], [0, 0.7, -0.05], [0, 0.9, -0.05]);
      A.leg('L', 0.2, 0.2, 0.4);
      A.leg('R', -0.15, 0.2, 0.35);
    }
  },
  cast(A, slot, ms, t) {
    if (slot === 'W') { A.phases(t / 0.2); STYLES.axe.attack(A, 0); return; }
    if (slot === 'E') {
      A.phases(t / 0.25);
      A.armQ('R', [0.3, 0.25, 0.1, 0.95], [1.5, 0.2, 0.3, 0.05], [0.3, 0.3, 0.2, 1.3], [0.3, 0.3, 0.2, 1.3]);
      A.RQ('wpR', [0.2, 0, -1.67], [0, 0, -1.5], [0, 0, -1.4]);
      A.RQ('chest', [0, 0, 0], [0, 0.3, -0.2], [0, -0.4, 0.2]);
      return;
    }
    if (slot === 'R') {
      A.phases(t / 0.35);
      A.armQ('R', [0.3, 0.25, 0.1, 0.95], [3.0, 0.15, 0.2, 0.5], [0.8, 0.15, 0.3, 0.1], [0.7, 0.15, 0.3, 0.1]);
      A.armQ('L', [0.55, 0.05, 0.45, 0.9], [3.0, 0, 0.5, 0.6], [0.85, 0, 0.55, 0.3]);
      A.RQ('wpR', [0.2, 0, -1.67], [0, 0, -1.0], [0, 0, -1.3], [0, 0, -1.5]);
      A.R('chest', 0, 0, A.q(0, 0.25, -0.45));
      A.leg('L', A.q(0, 0, 0.5), 0.15, A.q(0.1, 0.1, 0.9));
      A.leg('R', A.q(0, 0, -0.3), 0.15, A.q(0.1, 0.1, 0.6));
      return;
    }
    A.armQ('R', [0.3, 0.25, 0.1, 0.95], [1.4, 0.4, 0, 0.8], [1.5, 0.4, 0, 0.8]);
  },
  kneel(A, ms, k) { A.arm('R', 0.5 * k, 0.2, 0.2, 0.6); A.R('wpR', 0, 0, -1.4 - 0.6 * k); },
};

// 李青：拳脚
STYLES.fists = {
  runLean: 0.2,
  idle(A) {
    const bob = Math.sin(A.time * 4);
    A.leg('L', 0.32, 0.17, 0.5);
    A.leg('R', -0.25, 0.17, 0.38);
    A.R('hips', 0, 0.35, 0);
    A.R('spine', 0, 0, -0.08 + 0.01 * bob);
    A.R('chest', 0, -0.25, 0);
    A.R('head', 0, -0.12, 0.05);
    A.arm('L', 0.95, 0.12, 0.35, 1.9 + 0.05 * bob);
    A.arm('R', 0.6, 0.15, 0.45, 2.1 - 0.05 * bob);
    A.R('hdL', 0, 0, 0.3); A.R('hdR', 0, 0, 0.3);
    A.ex[EX_HIPS + 1] += bob * 0.004 * A.H;
  },
  run(A, ms, s) {
    A.arm('L', -0.7 * s, 0.14, 0.1, 1.5);
    A.arm('R', 0.7 * s, 0.14, 0.1, 1.5);
  },
  attack(A, idx) {
    A.R('hips', 0, 0.2, 0);
    if (idx % 3 === 2) {
      A.leg('R', A.q(-0.25, 1.2, 1.5, 1.35), 0.12, A.q(0.38, 1.9, 0.1, 0.3));
      A.leg('L', 0.1, 0.15, 0.35);
      A.R('chest', 0, 0, A.q(0, 0.05, 0.25));
      A.R('spine', 0, 0, A.q(-0.08, 0, 0.12));
      return;
    }
    const sd = idx % 2 ? 'L' : 'R', s = sd === 'R' ? 1 : -1;
    const rest = sd === 'R' ? [0.6, 0.15, 0.45, 2.1] : [0.95, 0.12, 0.35, 1.9];
    A.armQ(sd, rest, [0.35, 0.25, 0.2, 2.3], [1.5, 0.05, 0.3, 0.05], [1.4, 0.05, 0.3, 0.2]);
    A.R('chest', 0, A.q(-0.25, -0.35 * s, 0.45 * s), A.q(0, 0, -0.08));
    A.R('spine', 0, A.q(0, -0.1 * s, 0.15 * s), -0.08);
  },
  cast(A, slot, ms, t) {
    if (slot === 'E') {
      A.phases(t / 0.2);
      A.armQ('R', [0.6, 0.15, 0.45, 2.1], [2.7, 0.3, 0.2, 0.8], [0.4, 0.5, 0, 0.2]);
      A.armQ('L', [0.95, 0.12, 0.35, 1.9], [2.7, 0.3, 0.2, 0.8], [0.4, 0.5, 0, 0.2]);
      A.leg('L', A.q(0.32, 0.1, 0.7), 0.3, A.q(0.5, 0.2, 1.3));
      A.leg('R', A.q(-0.25, 0.1, 0.7), 0.3, A.q(0.38, 0.2, 1.3));
      A.R('spine', 0, 0, A.q(-0.08, 0.1, -0.35));
    } else if (slot === 'R') {
      A.phases(t / 0.3);
      A.leg('R', A.q(-0.25, 1.3, 0.4, 0.4), A.q(0.17, 0.4, 1.45, 1.35), A.q(0.38, 2.0, 0.1, 0.15));
      A.leg('L', 0.1, 0.1, 0.3);
      A.R('spine', A.q(0, 0, -0.4), 0, -0.05);
      A.R('chest', 0, A.q(-0.25, 0.2, 0.5), 0);
      A.ex[EX_MROT + 1] = -smooth(t / 0.3) * 0.9;
    } else if (slot === 'W') {
      A.arm('R', 1.1, 0.2, 0.6, 1.6);
      A.arm('L', 1.1, 0.2, 0.6, 1.6);
    } else {
      A.armQ('R', [0.6, 0.15, 0.45, 2.1], [0.3, 0.3, 0, 2.2], [1.55, 0.05, 0.2, 0.02]);
      A.R('chest', 0, A.q(-0.25, -0.4, 0.45), 0);
    }
  },
};

// 易：太刀
STYLES.katana = {
  runLean: 0.3,
  idle(A) {
    A.arm('R', -0.05, 0.32, 0, 0.35);
    A.R('wpR', 0, -2.6, -0.45);
    A.arm('L', 0.12, 0.2, 0, 0.4);
    A.leg('L', 0.1, 0.1, 0.22);
    A.leg('R', -0.05, 0.1, 0.18);
    A.R('spine', 0, 0.1, -0.08);
  },
  run(A, ms, s) {
    A.arm('R', -0.75, 0.28, 0, 0.3);
    A.R('wpR', 0, -2.9, -0.2);
    A.arm('L', -0.7 * s, 0.15, 0, 1.0);
  },
  attack(A, idx) {
    const rR = [-0.05, 0.32, 0, 0.35], rW = [0, -2.6, -0.45];
    if (idx % 2 === 0) {
      A.armQ('R', rR, [2.2, 0.8, -0.3, 0.7], [0.55, 0.1, 0.95, 0.1], [0.3, 0.1, 1.2, 0.1]);
      A.RQ('wpR', rW, [0.3, 0, -0.9], [0.6, 0, -0.9], [0.6, 0, -1.0]);
      A.RQ('chest', [0, 0, 0], [0, -0.45, 0.05], [0, 0.5, -0.1], [0, 0.6, -0.1]);
    } else {
      A.armQ('R', rR, [0.2, 0.1, 1.0, 0.3], [2.0, 0.9, -0.4, 0.15], [2.3, 1.0, -0.5, 0.15]);
      A.RQ('wpR', rW, [0.5, 0, -0.6], [-0.4, 0, -1.2], [-0.4, 0, -1.2]);
      A.RQ('chest', [0, 0, 0], [0, 0.4, -0.1], [0, -0.4, 0.05], [0, -0.5, 0.05]);
    }
    A.leg('L', A.q(0.1, 0.1, 0.4), 0.14, A.q(0.22, 0.3, 0.5));
    A.leg('R', A.q(-0.05, 0, -0.3), 0.14, A.q(0.18, 0.2, 0.3));
  },
  cast(A, slot) {
    if (slot === 'E') {
      A.arm('R', 1.2 * A.K, 0.2, 0.3 * A.K, 1.0 * A.K);
      A.R('wpR', 0, 0, -0.6 * A.K);
      A.arm('L', 1.1 * A.K, 0.2, 0.6 * A.K, 1.3 * A.K);
    } else if (slot === 'R') {
      A.arm('R', -0.5, 0.5, 0, 0.3);
      A.arm('L', -0.5, 0.5, 0, 0.3);
      A.R('chest', 0, 0, 0.2 * A.K);
      A.R('head', 0, 0, 0.3 * A.K);
      A.R('wpR', 0, -2.6, -0.45);
    } else {
      A.armQ('R', [-0.05, 0.32, 0, 0.35], [2.0, 0.8, -0.3, 0.7], [0.55, 0.1, 0.95, 0.1]);
      A.RQ('wpR', [0, -2.6, -0.45], [0.3, 0, -0.9], [0.6, 0, -0.9]);
    }
  },
  dash(A) { A.R('wpR', 0, -2.9, -0.2); A.arm('R', -1.0, 0.3, 0, 0.3); },
};

// 阿狸：宝珠
STYLES.orb = {
  idle(A, ms, b) {
    A.arm('R', 0.55, 0.35, 0, 1.25 + 0.04 * b);
    A.R('hdR', -0.5, 0, -0.5);
    A.arm('L', -0.15, 0.48, -0.25, 1.4);
    A.R('hips', 0.06, 0.1, 0);
    A.R('spine', -0.05, 0, -0.02);
    A.R('head', 0.1, -0.1, 0.05);
    A.leg('R', 0.12, 0.05, 0.12);
    A.leg('L', -0.05, 0.1, 0.05);
  },
  run(A, ms, s) {
    A.arm('R', 0.5 + 0.15 * s, 0.35, 0, 1.3);
    A.R('hdR', -0.5, 0, -0.5);
  },
  attack(A) {
    A.armQ('R', [0.55, 0.35, 0, 1.25], [0.4, 0.55, -0.4, 1.7], [1.35, 0.2, 0.25, 0.15], [1.3, 0.2, 0.25, 0.2]);
    A.armQ('L', [-0.15, 0.48, -0.25, 1.4], [0.3, 0.4, 0, 0.6], [-0.3, 0.5, 0, 0.4]);
    A.RQ('chest', [0, 0, 0], [0, -0.3, 0], [0, 0.25, -0.05]);
  },
  cast(A, slot, ms, t) {
    if (slot === 'W') {
      A.arm('R', 0.4, 1.2 * A.K, 0, 0.3);
      A.arm('L', 0.4, 1.2 * A.K, 0, 0.3);
      A.ex[EX_MROT + 1] = -smooth(t / 0.45) * TAU;
      A.R('head', 0, 0, 0.2);
    } else if (slot === 'E') {
      A.phases(t / 0.25);
      A.armQ('R', [0.55, 0.35, 0, 1.25], [1.6, 0.1, 0.9, 2.3], [1.4, 0.15, 0.2, 0.2]);
      A.R('head', 0.15 * A.K, 0, 0);
    } else {
      A.armQ('R', [0.55, 0.35, 0, 1.25], [0.4, 0.55, -0.4, 1.7], [1.4, 0.2, 0.2, 0.1]);
      A.armQ('L', [-0.15, 0.48, -0.25, 1.4], [0.4, 0.4, -0.4, 1.6], [1.3, 0.2, 0.3, 0.2]);
      A.RQ('chest', [0, 0, 0], [0, -0.3, 0.05], [0, 0.2, -0.1]);
    }
  },
  dash(A) { A.arm('R', -1.0, 0.45, 0, 0.5); A.arm('L', -1.0, 0.45, 0, 0.5); },
};

// 拉克丝：魔杖
STYLES.wand = {
  idle(A, ms, b) {
    A.arm('R', 0.18, 0.22, 0, 1.3 + 0.03 * b);
    A.R('wpR', 0.05, 0, 0);
    A.arm('L', -0.15, 0.48, -0.25, 1.4);
    A.R('hips', -0.05, -0.1, 0);
    A.R('head', -0.06, 0.1, 0.05);
    A.leg('L', 0.1, 0.05, 0.12);
  },
  run(A, ms, s) {
    A.arm('R', 0.25 + 0.15 * s, 0.25, 0, 1.2);
    A.R('wpR', 0, 0, -0.3);
  },
  attack(A) {
    A.armQ('R', [0.18, 0.22, 0, 1.3], [1.1, 0.3, 0, 1.7], [1.35, 0.1, 0.15, 0.05], [1.3, 0.1, 0.15, 0.1]);
    A.RQ('wpR', [0.05, 0, 0], [0, 0, 0], [0, 0, -1.35], [0, 0, -1.3]);
    A.RQ('chest', [0, 0, 0], [0, -0.3, 0.05], [0, 0.25, -0.05]);
  },
  cast(A, slot, ms, t) {
    if (slot === 'R') { STYLES.wand.spark(A); return; }
    if (slot === 'W') {
      A.armQ('R', [0.18, 0.22, 0, 1.3], [-0.3, 0.3, 0, 0.3], [1.5, 0.1, 0.1, 0]);
      A.RQ('wpR', [0.05, 0, 0], [0, 0, -0.8], [0, 0, -1.4]);
    } else if (slot === 'E') {
      A.armQ('R', [0.18, 0.22, 0, 1.3], [-0.2, 0.3, 0, 0.2], [2.2, 0.2, 0.1, 0.3]);
      A.RQ('wpR', [0.05, 0, 0], [0, 0, -0.5], [0, 0, -1.2]);
    } else {
      A.armQ('R', [0.18, 0.22, 0, 1.3], [1.0, 0.3, 0, 1.6], [1.45, 0.05, 0.15, 0.02]);
      A.armQ('L', [-0.15, 0.48, -0.25, 1.4], [0.5, 0.3, 0, 1.0], [1.2, 0.2, 0.4, 0.3]);
      A.RQ('wpR', [0.05, 0, 0], [0, 0, 0], [0, 0, -1.4]);
    }
    A.RQ('chest', [0, 0, 0], [0, -0.3, 0.05], [0, 0.25, -0.05]);
  },
  spark(A) {
    A.arm('R', 1.4, 0.05, 0.25, 0.1);
    A.R('wpR', 0, 0, -1.45);
    A.arm('L', 1.35, 0.05, 0.45, 0.25);
    A.leg('L', 0.35, 0.12, 0.3);
    A.leg('R', -0.3, 0.12, 0.2);
    A.R('spine', 0, 0, 0.08);
    A.R('chest', 0, 0, 0);
    A.R('head', 0, 0, -0.05);
    A.plant();
  },
};

// 安妮：抱熊 + 火球
STYLES.annie = {
  runFreq: 1.75,
  runLean: 0.08,
  idle(A, ms, b) {
    const sw = Math.sin(A.time * 1.5);
    if (!ms.tibbersOut) A.arm('L', 0.35, 0.02, 0.6, 1.55);
    else A.arm('L', 0.1 + 0.08 * sw, 0.25, 0, 0.4);
    A.arm('R', 0.1 + 0.12 * sw, 0.28, 0, 0.35);
    A.R('head', 0.12, 0.1 * sw, 0.05);
    A.R('hips', 0.04 * sw, 0, 0);
    A.ex[EX_HIPS + 1] += Math.abs(Math.sin(A.time * 2.2)) * 0.012 * A.H;
    A.leg('R', 0.08, 0.04, 0.1);
    A.leg('L', -0.02, 0.04, 0.05, 0.2);
  },
  run(A, ms, s) {
    if (!ms.tibbersOut) A.arm('L', 0.35, 0.02, 0.6, 1.55);
    A.arm('R', 0.8 * s, 0.25, 0, 0.8);
  },
  attack(A, idx, ms) {
    A.armQ('R', [0.1, 0.28, 0, 0.35], [0.3, 0.4, -0.4, 1.8], [1.35, 0.15, 0.2, 0.2], [1.3, 0.15, 0.2, 0.3]);
    A.RQ('chest', [0, 0, 0], [0, -0.25, 0], [0, 0.2, -0.05]);
    if (!ms.tibbersOut) A.arm('L', 0.35, 0.02, 0.6, 1.55);
  },
  cast(A, slot, ms, t) {
    const bear = !ms.tibbersOut;
    if (slot === 'R') {
      A.phases(t / 0.3);
      A.armQ('L', [0.35, 0.02, 0.6, 1.55], [-0.6, 0.2, 0, 0.4], [1.8, 0.1, 0.1, 0.1]);
      A.RQ('chest', [0, 0, 0], [0, 0.4, 0.1], [0, -0.3, -0.1]);
      return;
    }
    if (slot === 'E') { A.arm('R', 2.2 * A.K, 0.6, 0, 0.6); if (!bear) A.arm('L', 2.2 * A.K, 0.6, 0, 0.6); return; }
    if (slot === 'W') { A.armQ('R', [0.1, 0.28, 0, 0.35], [0.4, 0.8, -0.3, 1.2], [1.3, 0.4, 0, 0.1]); }
    else A.armQ('R', [0.1, 0.28, 0, 0.35], [0.3, 0.4, -0.4, 1.8], [1.4, 0.15, 0.2, 0.15]);
    A.RQ('chest', [0, 0, 0], [0, -0.25, 0], [0, 0.2, -0.08]);
    if (bear) A.arm('L', 0.35, 0.02, 0.6, 1.55);
  },
  kneel(A, ms) { if (!ms.tibbersOut) A.arm('L', 0.45, 0.02, 0.6, 1.55); },
  dash(A, ms) { if (!ms.tibbersOut) A.arm('L', 0.35, 0.02, 0.6, 1.55); },
  stunned(A, ms) { if (!ms.tibbersOut) A.arm('L', 0.3, 0.02, 0.6, 1.4); },
};

// 艾希：冰晶长弓
STYLES.bow = {
  idle(A) {
    A.arm('L', 0.1, 0.2, 0, 0.35);
    A.R('wpL', 0, 0, 1.3);
    A.arm('R', 0.08, 0.16, 0, 0.3);
  },
  run(A) { A.R('wpL', 0, 0, 1.2); },
  attack(A, idx, ms, p) { bowDraw(A, p, 0); },
  cast(A, slot, ms, t) {
    if (slot === 'E') { A.arm('R', 2.8 * A.K, 0.3, 0, 0.2); A.R('head', 0, 0, 0.25 * A.K); return; }
    if (slot === 'Q') { A.arm('L', 1.5 * A.K, 0.05, -0.2, 0.05); A.R('wpL', 0, 0, 1.3 * (1 - A.K)); return; }
    A.phases(t / 0.3);
    bowDraw(A, t / 0.3, slot === 'W' ? 1.3 : 0, slot === 'R');
  },
  dash(A) { A.R('wpL', 0, 0, 1.2); },
};
function bowDraw(A, p, roll, big = false) {
  A.armQ('L', [0.1, 0.2, 0, 0.35], [1.5, 0.05, -0.55, 0.05], [1.5, 0.05, -0.55, 0.05], [1.45, 0.05, -0.55, 0.1]);
  A.RQ('wpL', [0, 0, 1.3], [roll, 0, 0], [roll, 0, 0], [roll, 0, 0]);
  A.armQ('R', [0.08, 0.16, 0, 0.3], [1.45, 0, 1.1, 0.4], [1.35, big ? 0.25 : 0.05, 0.9, 2.3], [1.1, 0.5, 0.4, 1.6]);
  A.RQ('chest', [0, 0, 0], [0, -0.6, 0], [0, -0.65, big ? 0.12 : 0], [0, -0.55, 0]);
  A.R('head', 0, A.q(0, 0.5, 0.55, 0.45), 0);
  A.leg('L', A.q(-0.03, 0.25, 0.3), 0.14, A.q(0.07, 0.2, 0.25));
  A.leg('R', A.q(0.04, -0.2, -0.25), 0.14, A.q(0.1, 0.15, 0.2));
  A.drawString = p < 0.45 ? 0 : p <= 1 ? 0.25 + 0.75 * smooth((p - 0.45) / 0.55) : 0;
}

// 金克丝：砰砰 / 鱼骨头
STYLES.gun = {
  runFreq: 1.6,
  idle(A, ms) {
    if (rocketOut(A, ms)) {
      A.arm('R', 1.05, 0.5, 0.15, 1.9);
      A.arm('L', 1.2, 0.05, 0.55, 1.1);
      A.R('head', 0, 0.15, 0);
    } else {
      A.arm('R', 0.3, 0.2, 0.05, 1.3);
      A.R('wpR', 0, 0, -1.55);
      A.arm('L', 0.65, 0.05, 0.6, 0.95);
      A.R('spine', 0, 0, 0.05);
      A.R('hips', 0.06, 0, 0);
    }
  },
  run(A, ms) { STYLES.gun.idle(A, ms); A.R('spine', 0, 0, -0.1); },
  attack(A, idx, ms, p) {
    if (rocketOut(A, ms)) {
      A.RQ('chest', [0, 0, 0], [0, 0, -0.05], [0, 0, 0.28], [0, 0, 0.1]);
      A.R('spine', 0, 0, A.q(0, 0, 0.12, 0.05));
      A.R('shR', 0, 0, A.q(0, 0, 0.3, 0.1));
    } else {
      const f = p > 0.8 && p < 2 ? 1 : 0;
      A.R('chest', 0, 0, 0.05 * f + 0.03 * f * Math.sin(A.time * 55));
      A.A('uaR', 0, 0, -0.06 * f);
    }
  },
  cast(A, slot, ms, t) {
    if (slot === 'W') { A.arm('R', 1.5 * A.K + 0.3 * (1 - A.K), 0.05, 0.1, 0.05); A.R('wpR', 0, 0, -1.5); A.R('chest', 0, -0.3, 0); return; }
    if (slot === 'E') { A.armQ('L', [0.65, 0.05, 0.6, 0.95], [-0.6, 0.2, 0, 0.3], [1.1, 0.2, 0.1, 0.3]); return; }
    if (slot === 'R') {
      A.phases(t / 0.45);
      A.arm('R', 1.05, 0.5, 0.15, 1.9);
      A.arm('L', 1.2, 0.05, 0.55, 1.1);
      A.RQ('chest', [0, 0, 0], [0, 0, -0.08], [0, 0, 0.35], [0, 0, 0.15]);
      A.R('shR', 0, 0, A.q(0, 0, 0.35, 0.1));
      return;
    }
    A.arm('R', 2.0 * A.K, 0.4, 0, 1.0);
    A.arm('L', 2.0 * A.K, 0.4, 0, 1.0);
  },
  dash(A, ms) { STYLES.gun.idle(A, ms); },
};
function rocketOut(A, ms) { return ms.weapon === 'rocket' || A.forceRocket; }

// 锤石：灯笼 + 镰刀锁链
STYLES.lantern = {
  runFreq: 1.25,
  runAmp: 0.5,
  runLean: 0.22,
  idle(A, ms, b) {
    A.R('spine', 0, 0, -0.22 + 0.01 * b);
    A.R('chest', 0, 0, -0.1);
    A.R('head', 0, 0, 0.22);
    A.arm('L', 0.55, 0.3, 0, 0.55);
    A.arm('R', 0.25, 0.35, 0, 0.8);
    A.R('wpR', 0.2, 0, -0.9);
    A.leg('L', 0.08, 0.1, 0.22);
    A.leg('R', -0.06, 0.1, 0.2);
  },
  run(A) {
    A.arm('L', 0.6, 0.3, 0, 0.55);
    A.R('wpR', 0.2, 0, -0.9);
  },
  attack(A) {
    A.armQ('R', [0.25, 0.35, 0, 0.8], [2.3, 0.55, -0.2, 1.0], [1.2, 0.15, 0.4, 0.05], [0.6, 0.15, 0.4, 0.2]);
    A.RQ('wpR', [0.2, 0, -0.9], [0, 0, -0.3], [0, 0, -1.2], [0, 0, -1.0]);
    A.RQ('chest', [0, 0, -0.1], [0, -0.35, -0.05], [0, 0.35, -0.15]);
  },
  cast(A, slot, ms, t) {
    if (slot === 'W') {
      A.armQ('L', [0.55, 0.3, 0, 0.55], [-0.4, 0.3, 0, 0.4], [1.5, 0.1, 0.1, 0.05]);
    } else if (slot === 'E') {
      A.armQ('R', [0.25, 0.35, 0, 0.8], [-0.9, 0.4, -0.3, 0.3], [1.9, 0.3, 0.6, 0.2]);
      A.RQ('chest', [0, 0, -0.1], [0, -0.5, 0], [0, 0.5, -0.1]);
    } else if (slot === 'R') {
      A.arm('R', 0.6, 1.3 * A.K, 0, 0.5);
      A.arm('L', 0.6, 1.3 * A.K, 0, 0.5);
      A.R('head', 0, 0, 0.35 * A.K);
      A.R('spine', 0, 0, 0.1 * A.K - 0.1);
    } else {
      A.armQ('R', [0.25, 0.35, 0, 0.8], [-0.4, 0.3, 0, 0.4], [1.55, 0.05, 0.15, 0.02]);
      A.RQ('wpR', [0.2, 0, -0.9], [0, 0, -0.6], [0, 0, -1.5]);
      A.RQ('chest', [0, 0, -0.1], [0, -0.3, 0], [0, 0.3, -0.1]);
    }
  },
};

// 提伯斯：熊掌
STYLES.brute = {
  runFreq: 1.05,
  runAmp: 0.6,
  runLean: 0.22,
  idle(A, ms, b) {
    const sw = Math.sin(A.time * 1.4);
    A.R('hips', 0.05 * sw, 0, 0);
    A.R('spine', -0.04 * sw, 0, -0.18 + 0.03 * b);
    A.R('chest', 0, 0, -0.1 + 0.03 * b);
    A.R('head', 0, 0.1 * sw, 0.15);
    A.arm('R', 0.25, 0.28, 0.1, 0.45);
    A.arm('L', 0.25, 0.28, 0.1, 0.45);
    A.leg('L', 0.1, 0.12, 0.28);
    A.leg('R', -0.05, 0.12, 0.25);
  },
  run(A, ms, s) {
    A.arm('L', -0.8 * s + 0.2, 0.25, 0, 0.6);
    A.arm('R', 0.8 * s + 0.2, 0.25, 0, 0.6);
  },
  attack(A, idx) {
    const sd = idx % 2 ? 'L' : 'R', s = sd === 'R' ? 1 : -1;
    A.armQ(sd, [0.25, 0.28, 0.1, 0.45], [2.3, 0.8, -0.3, 0.8], [0.6, 0.2, 0.8, 0.2], [0.4, 0.2, 0.9, 0.3]);
    A.RQ('chest', [0, 0, -0.1], [0, -0.4 * s, 0.1], [0, 0.4 * s, -0.25]);
  },
  cast(A) {
    A.arm('R', 1.4 * A.K, 0.9, 0, 0.6);
    A.arm('L', 1.4 * A.K, 0.9, 0, 0.6);
    A.R('head', 0, 0, 0.4 * A.K);
    A.R('chest', 0, 0, 0.15 * A.K);
  },
};

export const _test = { STYLES };
