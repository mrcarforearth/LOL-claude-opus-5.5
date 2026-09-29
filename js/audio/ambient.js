// 环境音：风声（带阵风随机游走）+ 林间虫鸣鸟叫（随机调度的合成片段）+ 河道流水（按镜头到河道距离淡入）
//  所有音量用 setTargetAtTime 平滑变化；输出到 ambient 总线。

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);

export class Ambient {
  constructor(E) {
    this.E = E;
    const c = E.ctx, bus = E.buses.ambient;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.connect(bus);
    this.sources = [];
    // 风：棕噪声 → 带通（中心频率随机游走）+ 粉噪声高频「树叶沙沙」
    this.windG = c.createGain(); this.windG.gain.value = 0;
    this.windBp = c.createBiquadFilter(); this.windBp.type = 'bandpass'; this.windBp.frequency.value = 420; this.windBp.Q.value = 0.7;
    this._loop('brown').connect(this.windBp); this.windBp.connect(this.windG); this.windG.connect(this.out);
    this.leafG = c.createGain(); this.leafG.gain.value = 0;
    const leafHp = c.createBiquadFilter(); leafHp.type = 'highpass'; leafHp.frequency.value = 2500;
    this.leafLp = c.createBiquadFilter(); this.leafLp.type = 'lowpass'; this.leafLp.frequency.value = 6000;
    this._loop('pink').connect(leafHp); leafHp.connect(this.leafLp); this.leafLp.connect(this.leafG); this.leafG.connect(this.out);
    // 河流：白噪声低通主体 + 三个窄带「潺潺」共振（频率随机跳动）
    this.riverG = c.createGain(); this.riverG.gain.value = 0;
    const rLp = c.createBiquadFilter(); rLp.type = 'lowpass'; rLp.frequency.value = 1100; rLp.Q.value = 0.5;
    const pinkSrc = this._loop('pink');
    pinkSrc.connect(rLp); rLp.connect(this.riverG);
    this.babble = [];
    const white = this._loop('white');
    for (let i = 0; i < 3; i++) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 9; bp.frequency.value = rnd(500, 1800);
      const g = c.createGain(); g.gain.value = 0.35;
      white.connect(bp); bp.connect(g); g.connect(this.riverG);
      this.babble.push({ bp, g, next: 0 });
    }
    this.riverG.connect(this.out);
    // 状态
    this.wind = 0.5; this.windTarget = 0.5;
    this.nextBird = 2; this.nextCricket = 1; this.nextDrop = 0.5; this.nextGust = 3;
    this.levels = { wind: 0, river: 0, forest: 0 };
    this.t = 0;
    this.active = false;
  }
  _loop(kind) {
    const s = this.E.ctx.createBufferSource();
    s.buffer = this.E.noiseBufs[kind];
    s.loop = true;
    s.start(this.E.ctx.currentTime, Math.random() * 2);
    this.sources.push(s);
    return s;
  }
  _set(param, v, tau = 0.8) { try { param.setTargetAtTime(v, this.E.ctx.currentTime, tau); } catch { /* 忽略 */ } }

  /** 启停（静音 / 环境音量为 0 时停用以省 CPU 调度） */
  setActive(on) {
    if (this.active === !!on) return;
    this.active = !!on;
    this._set(this.out.gain, on ? 1 : 0, 0.4);
  }

  /**
   * 每帧更新
   * @param dt 真实秒
   * @param ctx { river: 0..1（河道接近度）, forest: 0..1（林间程度） }
   */
  update(dt, { river = 0, forest = 0.7 } = {}) {
    if (!this.active) return;
    this.t += dt;
    const E = this.E, now = E.ctx.currentTime;
    // 阵风：随机游走
    this.nextGust -= dt;
    if (this.nextGust <= 0) { this.nextGust = rnd(2.5, 7); this.windTarget = rnd(0.25, 1); }
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 0.4);
    this._set(this.windG.gain, 0.16 + this.wind * 0.22, 1.2);
    this._set(this.windBp.frequency, 280 + this.wind * 520, 1.5);
    this._set(this.leafG.gain, (0.02 + this.wind * 0.05) * (0.4 + forest * 0.6), 1.2);
    this._set(this.leafLp.frequency, 3500 + this.wind * 4000, 1.5);
    // 河流
    this._set(this.riverG.gain, 0.5 * river, 0.9);
    if (river > 0.02) {
      for (const b of this.babble) {
        if (this.t < b.next) continue;
        b.next = this.t + rnd(0.06, 0.25);
        this._set(b.bp.frequency, rnd(450, 2200), 0.05);
        this._set(b.g.gain, rnd(0.15, 0.6), 0.05);
      }
      this.nextDrop -= dt;
      if (this.nextDrop <= 0) {
        this.nextDrop = rnd(0.12, 0.6) / Math.max(0.3, river);
        this._drop(now, river);
      }
    }
    // 林间：鸟叫与虫鸣
    if (forest > 0.05) {
      this.nextBird -= dt;
      if (this.nextBird <= 0) { this.nextBird = rnd(2.5, 9) / Math.max(0.4, forest); this._bird(now + 0.02, forest); }
      this.nextCricket -= dt;
      if (this.nextCricket <= 0) { this.nextCricket = rnd(0.6, 2.5) / Math.max(0.4, forest); this._cricket(now + 0.02, forest); }
    }
  }

  _spot(pan, g) {
    const c = this.E.ctx, out = c.createGain();
    out.gain.value = g;
    let tail = out;
    if (this.E.hasPanner) { const p = c.createStereoPanner(); p.pan.value = pan; out.connect(p); tail = p; }
    tail.connect(this.out);
    // 片段结束后断开
    setTimeout(() => { try { tail.disconnect(); out.disconnect(); } catch { /* 忽略 */ } }, 3000);
    return out;
  }
  _bird(t, forest) {
    const E = this.E, o = this._spot(rnd(-0.8, 0.8), 0.05 * forest);
    const kind = Math.random();
    const base = rnd(2400, 3800);
    if (kind < 0.45) {
      // 啁啾：一串快速下滑短音
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) E.tone(o, t + i * rnd(0.08, 0.12), { type: 'sine', f: base * rnd(1, 1.15), f2: base * 0.72, ft: 0.06, a: 0.005, d: 0.06, g: 0.5 });
    } else if (kind < 0.8) {
      // 口哨：两个拖长音（上扬 + 下行）
      E.tone(o, t, { type: 'sine', f: base * 0.7, f2: base * 0.95, a: 0.03, d: 0.22, g: 0.45, vib: { rate: 22, depth: 0.02 } });
      E.tone(o, t + 0.3, { type: 'sine', f: base * 0.9, f2: base * 0.62, a: 0.03, d: 0.3, g: 0.4, vib: { rate: 20, depth: 0.02 } });
    } else {
      // 颤鸣：快速调频
      E.fm(o, t, { f: base, ratio: 0.012, idx: 18, idx2: 10, a: 0.02, hold: 0.25, d: 0.12, g: 0.35 });
    }
  }
  _cricket(t, forest) {
    // 蟋蟀：高频正弦被脉冲门控，2~3 组「唧唧」
    const E = this.E, c = E.ctx, o = this._spot(rnd(-0.9, 0.9), 0.022 * forest);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = 'sine'; osc.frequency.value = rnd(4200, 5200);
    g.gain.value = 0;
    osc.connect(g); g.connect(o);
    const groups = 2 + Math.floor(Math.random() * 2), pulses = 3 + Math.floor(Math.random() * 2);
    let tt = t;
    for (let k = 0; k < groups; k++) {
      for (let i = 0; i < pulses; i++) {
        g.gain.setValueAtTime(0, tt);
        g.gain.linearRampToValueAtTime(1, tt + 0.004);
        g.gain.linearRampToValueAtTime(0, tt + 0.014);
        tt += 0.022;
      }
      tt += rnd(0.12, 0.2);
    }
    osc.start(t); osc.stop(tt + 0.05);
  }
  _drop(t, river) {
    // 水滴「咕嘟」：快速上滑正弦
    const E = this.E, o = this._spot(rnd(-0.7, 0.7), 0.06 * river);
    const f = rnd(500, 1100);
    E.tone(o, t, { type: 'sine', f, f2: f * rnd(1.8, 2.6), ft: 0.04, a: 0.002, d: 0.05, g: 0.6 });
  }

  dispose() {
    for (const s of this.sources) { try { s.stop(); } catch { /* 忽略 */ } }
    try { this.out.disconnect(); } catch { /* 忽略 */ }
  }
}
