// WebAudio 程序化合成引擎
//  信号链：各声部 → 声像(StereoPanner) → 总线(sfx / voice / ambient) → 主压缩器 → 主音量 → 输出
//           声部另有一路发送到共享混响（程序生成的脉冲响应卷积）
//  声部管理：并发上限（超限时按优先级抢占最老声部）、同名音效节流（最小间隔 + 同名并发上限）
//  合成原语：tone（振荡器 + 包络 + 滑音 + 颤音）、noise（噪声 + 滤波扫频包络）、fm（调频金属/钟声）
//  所有方法内部吞掉异常，不向调用方抛出。

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const EPS = 0.0001;

export class SynthEngine {
  constructor(ctx) {
    this.ctx = ctx;
    const c = ctx;
    // 主压缩器：统一响度、防止爆音
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.22;
    this.master = c.createGain();
    this.master.gain.value = 1;
    this.comp.connect(this.master);
    this.master.connect(c.destination);
    // 三条总线
    this.buses = {};
    for (const k of ['sfx', 'voice', 'ambient']) {
      const g = c.createGain();
      g.gain.value = 1;
      g.connect(this.comp);
      this.buses[k] = g;
    }
    // 共享混响
    this.reverbIn = c.createGain();
    this.reverbIn.gain.value = 1;
    try {
      this.reverb = c.createConvolver();
      this.reverb.buffer = this._makeImpulse(1.9, 2.6);
      const wet = c.createGain();
      wet.gain.value = 0.55;
      this.reverbIn.connect(this.reverb);
      this.reverb.connect(wet);
      wet.connect(this.buses.sfx);
    } catch { this.reverb = null; }
    // 噪声缓冲
    this.noiseBufs = this._makeNoise(2.5);
    this.hasPanner = typeof c.createStereoPanner === 'function';
    this.voices = [];
    this.maxVoices = 30;
    this._last = new Map();
    this._curves = new Map();
  }

  get now() { return this.ctx.currentTime; }

  // —— 缓冲生成 ——
  _makeNoise(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const white = c.createBuffer(1, n, c.sampleRate), pink = c.createBuffer(1, n, c.sampleRate), brown = c.createBuffer(1, n, c.sampleRate);
    const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      // Paul Kellet 粉红噪声近似
      b0 = 0.99886 * b0 + r * 0.0555179; b1 = 0.99332 * b1 + r * 0.0750759; b2 = 0.969 * b2 + r * 0.153852;
      b3 = 0.8665 * b3 + r * 0.3104856; b4 = 0.55 * b4 + r * 0.5329522; b5 = -0.7616 * b5 - r * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + r * 0.5362) * 0.11; b6 = r * 0.115926;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
    return { white, pink, brown };
  }
  _makeImpulse(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * t); // 越往后越暗
        d[i] = lp * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }
  /** 失真曲线（缓存） */
  shaper(amount = 20) {
    let curve = this._curves.get(amount);
    if (!curve) {
      const n = 1024;
      curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
      }
      this._curves.set(amount, curve);
    }
    const ws = this.ctx.createWaveShaper();
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  // —— 包络 ——
  env(param, t, { a = 0.005, g = 1, hold = 0, d = 0.2, from = 0 } = {}) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(from, t);
    param.linearRampToValueAtTime(g, t + Math.max(0.001, a));
    if (hold > 0) param.setValueAtTime(g, t + a + hold);
    param.exponentialRampToValueAtTime(EPS, t + a + hold + Math.max(0.005, d));
    param.setValueAtTime(0, t + a + hold + d + 0.005);
    return t + a + hold + d;
  }
  _filter(o, dest, t, end) {
    // o.filter: 'lowpass' | 'highpass' | 'bandpass' | ...；o.f / o.f2 / o.q
    const f = this.ctx.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(clamp(o.f, 20, 20000), t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(clamp(o.f2, 20, 20000), t + (o.ft ?? (end - t)));
    f.Q.value = o.q ?? 1;
    f.connect(dest);
    return f;
  }

  /** 振荡器音：{ type, f, f2, ft, a, hold, d, g, detune, vib:{rate,depth}, lp, lpQ, shape } → 结束时刻 */
  tone(dest, t, o = {}) {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    const f = Math.max(1, o.f ?? 440);
    const end = t + (o.a ?? 0.005) + (o.hold ?? 0) + (o.d ?? 0.2);
    osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.ft ?? (end - t)));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) {
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = o.vib.rate ?? 6;
      lg.gain.value = f * (o.vib.depth ?? 0.01);
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(t); lfo.stop(end + 0.05);
    }
    const g = c.createGain();
    let out = dest;
    if (o.lp) out = this._filter({ filter: 'lowpass', f: o.lp, f2: o.lp2, ft: o.lpt, q: o.lpQ ?? 0.8 }, dest, t, end);
    if (o.shape) { const ws = this.shaper(o.shape); ws.connect(out); out = ws; }
    osc.connect(g); g.connect(out);
    this.env(g.gain, t, { a: o.a ?? 0.005, g: o.g ?? 0.5, hold: o.hold ?? 0, d: o.d ?? 0.2 });
    osc.start(t); osc.stop(end + 0.05);
    return end;
  }

  /** 噪声：{ kind: white|pink|brown, filter, f, f2, ft, q, a, hold, d, g, hp, lp, shape } → 结束时刻 */
  noise(dest, t, o = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBufs[o.kind || 'white'];
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const end = t + (o.a ?? 0.005) + (o.hold ?? 0) + (o.d ?? 0.2);
    const g = c.createGain();
    let out = dest;
    if (o.shape) { const ws = this.shaper(o.shape); ws.connect(out); out = ws; }
    if (o.lp) out = this._filter({ filter: 'lowpass', f: o.lp, q: 0.7 }, out, t, end);
    if (o.hp) out = this._filter({ filter: 'highpass', f: o.hp, q: 0.7 }, out, t, end);
    if (o.filter) out = this._filter(o, out, t, end);
    src.connect(g); g.connect(out);
    this.env(g.gain, t, { a: o.a ?? 0.005, g: o.g ?? 0.5, hold: o.hold ?? 0, d: o.d ?? 0.2 });
    src.start(t, Math.random() * 2); src.stop(end + 0.05);
    return end;
  }

  /** 调频音（金属、钟、电流）：{ f, ratio, idx, idx2, type, modType, a, hold, d, g, lp } */
  fm(dest, t, o = {}) {
    const c = this.ctx;
    const f = Math.max(1, o.f ?? 440);
    const end = t + (o.a ?? 0.002) + (o.hold ?? 0) + (o.d ?? 0.4);
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.type = o.type || 'sine';
    mod.type = o.modType || 'sine';
    car.frequency.setValueAtTime(f, t);
    if (o.f2) car.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.ft ?? (end - t)));
    const mf = f * (o.ratio ?? 1.4);
    mod.frequency.setValueAtTime(mf, t);
    if (o.f2) mod.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2 * (o.ratio ?? 1.4)), t + (o.ft ?? (end - t)));
    mg.gain.setValueAtTime(mf * (o.idx ?? 2), t);
    mg.gain.exponentialRampToValueAtTime(Math.max(EPS, mf * (o.idx2 ?? 0.05)), end);
    mod.connect(mg); mg.connect(car.frequency);
    let out = dest;
    if (o.lp) out = this._filter({ filter: 'lowpass', f: o.lp, q: 0.7 }, dest, t, end);
    car.connect(g); g.connect(out);
    this.env(g.gain, t, { a: o.a ?? 0.002, g: o.g ?? 0.3, hold: o.hold ?? 0, d: o.d ?? 0.4 });
    car.start(t); mod.start(t); car.stop(end + 0.05); mod.stop(end + 0.05);
    return end;
  }

  // —— 声部管理 ——
  /** 同名节流：返回是否允许播放 */
  _allow(name, minGap, cap, now) {
    const last = this._last.get(name);
    if (last != null && now - last < minGap) return false;
    if (cap > 0) {
      let n = 0;
      for (const v of this.voices) if (v.name === name && v.end > now) n++;
      if (n >= cap) return false;
    }
    this._last.set(name, now);
    return true;
  }
  _stealFor(priority, now) {
    const live = this.voices.filter((v) => v.end > now && !v.loop);
    if (live.length + this.voices.filter((v) => v.loop).length < this.maxVoices) return true;
    let victim = null;
    for (const v of live) if (v.priority <= priority && (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start))) victim = v;
    if (!victim) return false;
    this._kill(victim, now);
    return true;
  }
  _kill(v, now) {
    try {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setValueAtTime(v.out.gain.value, now);
      v.out.gain.linearRampToValueAtTime(0, now + 0.04);
    } catch { /* 忽略 */ }
    v.end = Math.min(v.end, now + 0.05);
  }
  /** 创建声部输出节点 */
  _voice({ name, bus = 'sfx', gain = 1, pan = 0, rev = 0, priority = 1 }) {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = gain;
    let tail = out;
    let panner = null;
    if (this.hasPanner && pan) {
      panner = c.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      out.connect(panner);
      tail = panner;
    }
    tail.connect(this.buses[bus] || this.buses.sfx);
    let send = null;
    if (rev > 0 && this.reverb) {
      send = c.createGain();
      send.gain.value = rev;
      tail.connect(send);
      send.connect(this.reverbIn);
    }
    const v = { name, out, panner, send, priority, start: c.currentTime, end: c.currentTime + 0.1, loop: false };
    this.voices.push(v);
    return v;
  }

  /**
   * 播放一个预设
   * preset: { fn(E, out, t, v, opts) → 结束时刻, bus, rev, gap, cap }
   */
  play(name, preset, { gain = 1, pan = 0, priority = 1, delay = 0, opts = {} } = {}) {
    try {
      const now = this.ctx.currentTime;
      if (!this._allow(name, preset.gap ?? 0.03, preset.cap ?? 6, now)) return false;
      if (!this._stealFor(priority, now)) return false;
      const v = this._voice({ name, bus: preset.bus, gain: gain * (preset.gain ?? 1), pan, rev: (preset.rev ?? 0.12) * (opts.revMul ?? 1), priority });
      const t = now + 0.005 + delay;
      const vary = 1 + (Math.random() * 2 - 1) * (preset.vary ?? 0.04);
      const end = preset.fn(this, v.out, t, vary, opts);
      v.end = (typeof end === 'number' && isFinite(end) ? end : t + 1) + (preset.rev ? 0.3 : 0.05);
      return true;
    } catch (err) {
      if (!this._warned) { this._warned = true; console.warn('[音频] 预设播放失败：', name, err); }
      return false;
    }
  }

  /** 启动循环声（回城等）：preset.loop(E, out, t) → { sources[], stop?(t) }；返回 { stop() } */
  startLoop(name, preset, { gain = 1, pan = 0 } = {}) {
    try {
      const now = this.ctx.currentTime;
      const v = this._voice({ name, bus: preset.bus, gain: 0, pan, rev: preset.rev ?? 0.2, priority: 5 });
      v.loop = true;
      v.end = Infinity;
      const t = now + 0.005;
      const target = gain * (preset.gain ?? 1);
      v.out.gain.setValueAtTime(0, t);
      v.out.gain.linearRampToValueAtTime(target, t + 0.25);
      const h = preset.loop(this, v.out, t) || {};
      let stopped = false;
      return {
        stop: () => {
          if (stopped) return;
          stopped = true;
          try {
            const n = this.ctx.currentTime;
            v.out.gain.cancelScheduledValues(n);
            v.out.gain.setValueAtTime(v.out.gain.value, n);
            v.out.gain.linearRampToValueAtTime(0, n + 0.3);
            for (const s of h.sources || []) { try { s.stop(n + 0.35); } catch { /* 忽略 */ } }
            v.loop = false;
            v.end = n + 0.4;
          } catch { /* 忽略 */ }
        },
      };
    } catch (err) {
      console.warn('[音频] 循环声启动失败：', name, err);
      return { stop() {} };
    }
  }

  /** 回收已结束的声部（每帧调用） */
  sweep() {
    const now = this.ctx.currentTime;
    if (!this.voices.length) return;
    const keep = [];
    for (const v of this.voices) {
      if (v.loop || v.end > now - 0.05) { keep.push(v); continue; }
      try { v.out.disconnect(); } catch { /* 忽略 */ }
      try { v.panner?.disconnect(); } catch { /* 忽略 */ }
      try { v.send?.disconnect(); } catch { /* 忽略 */ }
    }
    this.voices = keep;
  }
  activeCount() { const n = this.ctx.currentTime; return this.voices.filter((v) => v.loop || v.end > n).length; }

  /** 平滑设置总线/主音量 */
  setGain(node, value, tau = 0.05) {
    try { node.gain.setTargetAtTime(value, this.ctx.currentTime, tau); } catch { try { node.gain.value = value; } catch { /* 忽略 */ } }
  }
}
