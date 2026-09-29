// 音效预设：每个预设 = { fn(E, out, t, v, opts) → 结束时刻, bus?, rev?(混响发送), gap?(同名最小间隔秒), cap?(同名并发上限), gain?, vary?(随机音高幅度) }
//  E 为 SynthEngine，out 为该声部的输出节点，t 为起始时刻，v 为随机音高系数（≈1），opts.crit 暴击加强。
//  设计原则：瞬态（噪声/点击）+ 主体（振荡器/调频）+ 尾音（滤波噪声/混响）三层叠加。

const N = (semi) => 440 * Math.pow(2, (semi - 69) / 12); // MIDI 音符 → 频率
const rnd = (a, b) => a + Math.random() * (b - a);

// —— 可复用的小片段 ——
function swish(E, out, t, { f = 1500, f2 = 4000, d = 0.14, g = 0.4, q = 1.4, a = 0.03 } = {}) {
  return E.noise(out, t, { kind: 'white', filter: 'bandpass', f, f2, q, a, d, g });
}
function thud(E, out, t, { f = 150, f2 = 50, d = 0.14, g = 0.8 } = {}) {
  return E.tone(out, t, { type: 'sine', f, f2, ft: d * 0.7, a: 0.002, d, g });
}
function sparkle(E, out, t, { d = 0.35, g = 0.08, hp = 6000 } = {}) {
  return E.noise(out, t, { kind: 'white', hp, a: 0.02, d, g });
}
function bell(E, out, t, f, { d = 0.5, g = 0.2, ratio = 3.5, idx = 1.2 } = {}) {
  E.tone(out, t, { type: 'sine', f, a: 0.002, d, g: g * 0.8 });
  return E.fm(out, t, { f, ratio, idx, idx2: 0.02, a: 0.002, d: d * 0.7, g: g * 0.5 });
}
function brass(E, out, t, f, dur, g = 0.25) {
  // 铜管：两支失谐锯齿波 + 随包络开合的低通
  const c = E.ctx, lp = c.createBiquadFilter(), vg = c.createGain();
  lp.type = 'lowpass'; lp.Q.value = 1.5;
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.linearRampToValueAtTime(Math.min(8000, f * 6), t + 0.06);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 2), t + dur);
  lp.connect(vg); vg.connect(out);
  E.env(vg.gain, t, { a: 0.03, g, hold: dur * 0.5, d: dur * 0.6 });
  for (const det of [-8, 7]) {
    const o = c.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    o.connect(lp); o.start(t); o.stop(t + dur * 1.2 + 0.1);
  }
  return t + dur * 1.1;
}
function boom(E, out, t, { d = 1.0, g = 1, lp = 2600, sub = 70 } = {}) {
  E.noise(out, t, { kind: 'white', hp: 900, a: 0.001, d: 0.05, g: 0.6 * g });
  E.noise(out, t, { kind: 'brown', filter: 'lowpass', f: lp, f2: 180, ft: d, q: 0.7, a: 0.004, d, g: 0.9 * g, shape: 6 });
  return Math.max(E.tone(out, t, { type: 'sine', f: sub, f2: sub * 0.4, ft: d * 0.6, a: 0.003, d: d * 0.75, g: g }), t + d);
}
function crackle(E, out, t, { n = 8, span = 0.35, g = 0.2, hp = 2500 } = {}) {
  let end = t;
  for (let i = 0; i < n; i++) end = Math.max(end, E.noise(out, t + Math.random() * span, { kind: 'white', hp, a: 0.001, d: rnd(0.006, 0.02), g: g * rnd(0.5, 1) }));
  return end;
}

// —— 技能 ——
const SKILL = {
  slash: { rev: 0.15, fn(E, o, t, v) {
    swish(E, o, t, { f: 1800 * v, f2: 6500 * v, d: 0.16, g: 0.55, q: 1.1, a: 0.02 });
    E.fm(o, t + 0.04, { f: 2300 * v, ratio: 1.41, idx: 2.5, a: 0.002, d: 0.32, g: 0.09 });
    E.noise(o, t, { kind: 'pink', lp: 900, a: 0.01, d: 0.12, g: 0.25 });
    return t + 0.4;
  } },
  magic: { rev: 0.3, fn(E, o, t, v) {
    [0, 7, 12, 16].forEach((s, i) => E.tone(o, t + i * 0.035, { type: i % 2 ? 'triangle' : 'sine', f: N(76 + s) * v, a: 0.01, d: 0.38, g: 0.12, vib: { rate: 7, depth: 0.012 } }));
    E.tone(o, t, { type: 'sine', f: 220 * v, f2: 520 * v, a: 0.02, d: 0.3, g: 0.22 });
    sparkle(E, o, t + 0.03, { d: 0.35, g: 0.07 });
    return t + 0.55;
  } },
  fire: { rev: 0.2, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'pink', filter: 'bandpass', f: 280 * v, f2: 1400 * v, ft: 0.12, q: 0.9, a: 0.04, d: 0.45, g: 0.7 });
    E.noise(o, t, { kind: 'brown', lp: 600, a: 0.02, d: 0.5, g: 0.5 });
    E.tone(o, t, { type: 'sine', f: 110 * v, f2: 45, a: 0.01, d: 0.35, g: 0.45 });
    crackle(E, o, t + 0.05, { n: 10, span: 0.45, g: 0.18, hp: 3000 });
    return t + 0.6;
  } },
  ice: { rev: 0.35, fn(E, o, t, v) {
    E.fm(o, t, { f: 1760 * v, ratio: 3.51, idx: 3, idx2: 0.1, a: 0.002, d: 0.55, g: 0.14 });
    E.tone(o, t + 0.02, { type: 'sine', f: 2637 * v, a: 0.002, d: 0.35, g: 0.08 });
    E.tone(o, t + 0.06, { type: 'sine', f: 3136 * v, a: 0.002, d: 0.3, g: 0.06 });
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 5000, f2: 8000, q: 3, a: 0.005, d: 0.45, g: 0.2 });
    crackle(E, o, t, { n: 6, span: 0.2, g: 0.15, hp: 5000 });
    E.noise(o, t, { kind: 'pink', lp: 1200, a: 0.02, d: 0.2, g: 0.2 });
    return t + 0.65;
  } },
  light: { rev: 0.4, fn(E, o, t, v) {
    for (const [s, dt] of [[0, 0], [7, 0.02], [12, 0.04], [19, 0.06]]) E.tone(o, t + dt, { type: 'sine', f: N(81 + s) * v, a: 0.03, d: 0.6, g: 0.1 });
    E.tone(o, t, { type: 'triangle', f: 400 * v, f2: 1800 * v, ft: 0.25, a: 0.02, d: 0.3, g: 0.12 });
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 3000, f2: 9000, q: 0.8, a: 0.06, d: 0.35, g: 0.12 });
    return t + 0.75;
  } },
  shot: { rev: 0.25, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'white', hp: 1500, a: 0.001, d: 0.06, g: 0.7 });
    E.tone(o, t, { type: 'square', f: 200 * v, f2: 55, ft: 0.08, a: 0.001, d: 0.09, g: 0.18, lp: 1800 });
    thud(E, o, t, { f: 120 * v, f2: 40, d: 0.14, g: 0.6 });
    E.noise(o, t + 0.02, { kind: 'pink', filter: 'bandpass', f: 900, q: 0.8, a: 0.01, d: 0.25, g: 0.18 });
    return t + 0.3;
  } },
  whoosh: { rev: 0.12, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'pink', filter: 'bandpass', f: 350 * v, f2: 2400 * v, ft: 0.22, q: 1.8, a: 0.1, d: 0.25, g: 0.7 });
    E.noise(o, t + 0.05, { kind: 'white', filter: 'bandpass', f: 1500 * v, f2: 5000 * v, q: 3, a: 0.08, d: 0.15, g: 0.12 });
    return t + 0.4;
  } },
  impact: { rev: 0.2, fn(E, o, t, v) {
    thud(E, o, t, { f: 130 * v, f2: 38, d: 0.3, g: 1 });
    E.noise(o, t, { kind: 'white', filter: 'lowpass', f: 2500, f2: 300, q: 0.7, a: 0.001, d: 0.16, g: 0.6, shape: 8 });
    E.noise(o, t, { kind: 'brown', lp: 500, a: 0.003, d: 0.3, g: 0.5 });
    crackle(E, o, t + 0.02, { n: 4, span: 0.12, g: 0.12, hp: 2000 });
    return t + 0.4;
  } },
  chain: { rev: 0.2, fn(E, o, t, v) {
    [0, 0.045, 0.1, 0.14, 0.2].forEach((dt, i) => E.fm(o, t + dt, { f: rnd(900, 1500) * v, ratio: 2.76, idx: 4, idx2: 0.1, a: 0.001, d: 0.12, g: 0.1 - i * 0.012 }));
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 3200, q: 4, a: 0.01, d: 0.3, g: 0.2 });
    swish(E, o, t, { f: 600, f2: 1800, d: 0.2, g: 0.25 });
    return t + 0.4;
  } },
  electric: { rev: 0.15, fn(E, o, t, v) {
    const c = E.ctx, buzz = c.createOscillator(), am = c.createOscillator(), amg = c.createGain(), vca = c.createGain(), g = c.createGain(), bp = c.createBiquadFilter();
    buzz.type = 'sawtooth'; buzz.frequency.value = 95 * v;
    // 方波调幅（0.1..0.9）制造电流「滋滋」断续感
    am.type = 'square'; am.frequency.value = 31; amg.gain.value = 0.4; vca.gain.value = 0.5;
    bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.35);
    am.connect(amg); amg.connect(vca.gain);
    buzz.connect(bp); bp.connect(vca); vca.connect(g); g.connect(o);
    E.env(g.gain, t, { a: 0.005, g: 0.35, hold: 0.1, d: 0.3 });
    buzz.start(t); am.start(t); buzz.stop(t + 0.5); am.stop(t + 0.5);
    E.tone(o, t, { type: 'sine', f: 2400 * v, f2: 180, ft: 0.14, a: 0.001, d: 0.16, g: 0.2 });
    crackle(E, o, t, { n: 14, span: 0.4, g: 0.22, hp: 2500 });
    return t + 0.55;
  } },
  explosion: { rev: 0.35, fn(E, o, t, v) {
    boom(E, o, t, { d: 0.9, g: 1, lp: 3200 * v, sub: 75 * v });
    crackle(E, o, t + 0.05, { n: 12, span: 0.6, g: 0.15, hp: 1800 });
    return t + 1.0;
  } },
  buff: { rev: 0.3, fn(E, o, t, v) {
    E.tone(o, t, { type: 'triangle', f: 300 * v, f2: 620 * v, a: 0.02, d: 0.42, g: 0.22 });
    E.tone(o, t + 0.03, { type: 'triangle', f: 450 * v, f2: 930 * v, a: 0.02, d: 0.4, g: 0.16 });
    E.tone(o, t, { type: 'sine', f: 150 * v, f2: 300 * v, a: 0.03, d: 0.35, g: 0.25 });
    sparkle(E, o, t + 0.12, { d: 0.4, g: 0.07 });
    return t + 0.6;
  } },
  dash: { rev: 0.1, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 700 * v, f2: 3500 * v, ft: 0.16, q: 1.5, a: 0.03, d: 0.18, g: 0.5 });
    E.noise(o, t, { kind: 'pink', lp: 700, a: 0.02, d: 0.15, g: 0.3 });
    thud(E, o, t + 0.16, { f: 140 * v, f2: 60, d: 0.1, g: 0.35 });
    return t + 0.3;
  } },
  heal: { rev: 0.45, fn(E, o, t, v) {
    [72, 76, 79, 84].forEach((m, i) => E.tone(o, t + i * 0.06, { type: 'sine', f: N(m) * v, a: 0.01, d: 0.8, g: 0.12 }));
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 2500, f2: 5000, q: 1.2, a: 0.2, d: 0.4, g: 0.08 });
    E.tone(o, t, { type: 'triangle', f: 262 * v, a: 0.08, d: 0.5, g: 0.1 });
    return t + 1.0;
  } },
  shield: { rev: 0.3, fn(E, o, t, v) {
    E.fm(o, t, { f: 620 * v, ratio: 1.5, idx: 5, idx2: 0.1, a: 0.002, d: 0.6, g: 0.16 });
    E.tone(o, t + 0.01, { type: 'sine', f: 1240 * v, a: 0.002, d: 0.5, g: 0.08 });
    E.tone(o, t, { type: 'triangle', f: 150 * v, a: 0.05, d: 0.45, g: 0.2, vib: { rate: 5, depth: 0.02 } });
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 4000, f2: 1500, q: 2, a: 0.005, d: 0.25, g: 0.15 });
    return t + 0.7;
  } },
  roar: { rev: 0.3, fn(E, o, t, v) {
    E.tone(o, t, { type: 'sawtooth', f: 115 * v, f2: 68 * v, a: 0.08, hold: 0.25, d: 0.6, g: 0.45, lp: 1100, lp2: 500, lpQ: 2, vib: { rate: 7, depth: 0.04 }, shape: 4 });
    E.tone(o, t, { type: 'sawtooth', f: 172 * v, f2: 101 * v, a: 0.1, hold: 0.2, d: 0.55, g: 0.2, lp: 1400, vib: { rate: 9, depth: 0.05 } });
    E.noise(o, t, { kind: 'brown', filter: 'bandpass', f: 420, q: 1.2, a: 0.08, hold: 0.25, d: 0.6, g: 0.55 });
    return t + 1.0;
  } },
  spin: { rev: 0.12, fn(E, o, t, v) {
    for (let i = 0; i < 3; i++) swish(E, o, t + i * 0.12, { f: 700 * v, f2: 3200 * v, d: 0.14, g: 0.45 - i * 0.08, a: 0.04 });
    E.tone(o, t, { type: 'triangle', f: 220 * v, f2: 440 * v, a: 0.05, d: 0.35, g: 0.08, vib: { rate: 16, depth: 0.08 } });
    return t + 0.5;
  } },
};

// —— 召唤师技能 ——
const SUMMONER = {
  flash: { rev: 0.25, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'white', filter: 'highpass', f: 1500, f2: 8000, ft: 0.12, q: 0.8, a: 0.005, d: 0.18, g: 0.45 });
    E.tone(o, t, { type: 'sine', f: 600 * v, f2: 2600 * v, ft: 0.1, a: 0.003, d: 0.14, g: 0.2 });
    E.tone(o, t + 0.04, { type: 'sine', f: N(96) * v, a: 0.002, d: 0.25, g: 0.07 });
    return t + 0.35;
  } },
  exhaust: { rev: 0.25, fn(E, o, t, v) {
    E.tone(o, t, { type: 'triangle', f: 420 * v, f2: 130 * v, a: 0.02, d: 0.55, g: 0.22 });
    E.noise(o, t, { kind: 'pink', filter: 'lowpass', f: 1800, f2: 300, a: 0.05, d: 0.5, g: 0.35 });
    return t + 0.65;
  } },
  teleport: { rev: 0.4, fn(E, o, t, v) {
    E.tone(o, t, { type: 'sine', f: 180 * v, f2: 720 * v, a: 0.15, d: 0.9, g: 0.2, vib: { rate: 6, depth: 0.03 } });
    E.tone(o, t, { type: 'triangle', f: 270 * v, f2: 1080 * v, a: 0.15, d: 0.9, g: 0.1 });
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 800, f2: 6000, q: 2, a: 0.3, d: 0.6, g: 0.18 });
    return t + 1.2;
  } },
};

// —— 普攻与命中 ——
const ATTACK = {
  atk_sword: { gap: 0.03, cap: 5, rev: 0.05, fn(E, o, t, v, p) {
    swish(E, o, t, { f: 1400 * v, f2: 4200 * v, d: 0.12, g: 0.42, a: 0.025 });
    if (p.crit) E.fm(o, t + 0.03, { f: 2600 * v, ratio: 1.41, idx: 2, d: 0.25, g: 0.07 });
    return t + 0.2;
  } },
  atk_axe: { gap: 0.03, cap: 5, rev: 0.05, fn(E, o, t, v) {
    swish(E, o, t, { f: 500 * v, f2: 1800 * v, d: 0.2, g: 0.55, a: 0.05, q: 1 });
    E.noise(o, t, { kind: 'brown', lp: 500, a: 0.04, d: 0.18, g: 0.3 });
    return t + 0.28;
  } },
  atk_fist: { gap: 0.03, cap: 5, rev: 0.03, fn(E, o, t, v) {
    swish(E, o, t, { f: 900 * v, f2: 2200 * v, d: 0.08, g: 0.3, a: 0.02, q: 1.2 });
    return t + 0.12;
  } },
  atk_arrow: { gap: 0.03, cap: 5, rev: 0.08, fn(E, o, t, v) {
    E.tone(o, t, { type: 'triangle', f: 240 * v, f2: 190 * v, a: 0.001, d: 0.16, g: 0.28, vib: { rate: 28, depth: 0.02 } });
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 2200, q: 2, a: 0.001, d: 0.03, g: 0.3 });
    E.noise(o, t + 0.02, { kind: 'white', filter: 'bandpass', f: 3500 * v, f2: 2000 * v, q: 6, a: 0.03, d: 0.2, g: 0.1 });
    return t + 0.25;
  } },
  atk_bullet: { gap: 0.025, cap: 6, rev: 0.12, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'white', hp: 1800, a: 0.001, d: 0.04, g: 0.5 });
    E.tone(o, t, { type: 'square', f: 420 * v, f2: 90, ft: 0.04, a: 0.001, d: 0.05, g: 0.1, lp: 2500 });
    thud(E, o, t, { f: 180 * v, f2: 70, d: 0.06, g: 0.3 });
    return t + 0.1;
  } },
  atk_rocket: { gap: 0.05, cap: 4, rev: 0.2, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'pink', filter: 'bandpass', f: 500 * v, f2: 2200 * v, q: 1, a: 0.02, d: 0.35, g: 0.5 });
    thud(E, o, t, { f: 200 * v, f2: 80, d: 0.18, g: 0.45 });
    crackle(E, o, t + 0.05, { n: 5, span: 0.25, g: 0.1, hp: 3500 });
    return t + 0.4;
  } },
  atk_orb: { gap: 0.03, cap: 5, rev: 0.18, fn(E, o, t, v) {
    E.tone(o, t, { type: 'sine', f: 950 * v, f2: 480 * v, a: 0.004, d: 0.16, g: 0.2 });
    E.tone(o, t, { type: 'triangle', f: 1420 * v, f2: 720 * v, a: 0.004, d: 0.12, g: 0.08 });
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 2500 * v, q: 3, a: 0.01, d: 0.12, g: 0.08 });
    return t + 0.2;
  } },
  atk_fire: { gap: 0.03, cap: 5, rev: 0.15, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'pink', filter: 'bandpass', f: 400 * v, f2: 1500 * v, q: 1, a: 0.02, d: 0.2, g: 0.4 });
    E.tone(o, t, { type: 'sine', f: 520 * v, f2: 300 * v, a: 0.004, d: 0.14, g: 0.12 });
    return t + 0.25;
  } },
  hit_sword: { gap: 0.03, cap: 5, rev: 0.08, fn(E, o, t, v, p) {
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 2800 * v, q: 1, a: 0.001, d: 0.06, g: 0.45 });
    thud(E, o, t, { f: 190 * v, f2: 85, d: 0.09, g: 0.5 });
    E.fm(o, t, { f: 3100 * v, ratio: 1.41, idx: 1.5, a: 0.001, d: p.crit ? 0.3 : 0.1, g: p.crit ? 0.1 : 0.05 });
    return t + (p.crit ? 0.35 : 0.14);
  } },
  hit_axe: { gap: 0.03, cap: 5, rev: 0.1, fn(E, o, t, v) {
    thud(E, o, t, { f: 120 * v, f2: 48, d: 0.18, g: 0.85 });
    E.noise(o, t, { kind: 'white', lp: 2200, a: 0.001, d: 0.1, g: 0.55, shape: 5 });
    return t + 0.22;
  } },
  hit_fist: { gap: 0.03, cap: 5, rev: 0.06, fn(E, o, t, v) {
    thud(E, o, t, { f: 160 * v, f2: 55, d: 0.11, g: 0.9 });
    E.noise(o, t, { kind: 'pink', lp: 1600, a: 0.001, d: 0.06, g: 0.6 });
    return t + 0.14;
  } },
  hit_arrow: { gap: 0.03, cap: 5, rev: 0.06, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 1300 * v, q: 1.5, a: 0.001, d: 0.05, g: 0.45 });
    thud(E, o, t, { f: 260 * v, f2: 110, d: 0.07, g: 0.4 });
    return t + 0.1;
  } },
  hit_bullet: { gap: 0.025, cap: 6, rev: 0.05, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'white', hp: 2500, a: 0.001, d: 0.03, g: 0.35 });
    thud(E, o, t, { f: 420 * v, f2: 180, d: 0.04, g: 0.25 });
    return t + 0.06;
  } },
  hit_rocket: { gap: 0.05, cap: 4, rev: 0.25, fn(E, o, t, v) {
    return boom(E, o, t, { d: 0.45, g: 0.6, lp: 2800 * v, sub: 95 * v });
  } },
  hit_orb: { gap: 0.03, cap: 5, rev: 0.15, fn(E, o, t, v) {
    E.tone(o, t, { type: 'sine', f: 380 * v, f2: 920 * v, ft: 0.06, a: 0.002, d: 0.1, g: 0.25 });
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 4000, q: 1.5, a: 0.002, d: 0.1, g: 0.12 });
    thud(E, o, t, { f: 200 * v, f2: 90, d: 0.06, g: 0.25 });
    return t + 0.14;
  } },
  crit: { gap: 0.05, cap: 3, rev: 0.2, fn(E, o, t, v) {
    E.fm(o, t, { f: 1900 * v, ratio: 2.1, idx: 3, idx2: 0.05, a: 0.001, d: 0.35, g: 0.12 });
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 5000, f2: 2000, q: 2, a: 0.001, d: 0.12, g: 0.3 });
    thud(E, o, t, { f: 110, f2: 45, d: 0.2, g: 0.5 });
    return t + 0.4;
  } },
  // 防御塔：厚重的充能电流 + 放电
  turretShot: { gap: 0.1, cap: 3, rev: 0.3, fn(E, o, t, v) {
    const c = E.ctx, buzz = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    buzz.type = 'sawtooth'; buzz.frequency.setValueAtTime(55 * v, t); buzz.frequency.linearRampToValueAtTime(82 * v, t + 0.22);
    lp.type = 'lowpass'; lp.Q.value = 4; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2400, t + 0.22); lp.frequency.exponentialRampToValueAtTime(400, t + 0.55);
    buzz.connect(lp); lp.connect(g); g.connect(o);
    E.env(g.gain, t, { a: 0.18, g: 0.45, hold: 0.04, d: 0.35 });
    buzz.start(t); buzz.stop(t + 0.65);
    E.tone(o, t, { type: 'sine', f: 180 * v, f2: 1300 * v, ft: 0.22, a: 0.15, d: 0.1, g: 0.12 });
    E.tone(o, t + 0.2, { type: 'sine', f: 2200 * v, f2: 160, ft: 0.15, a: 0.001, d: 0.2, g: 0.25 });
    thud(E, o, t + 0.2, { f: 90, f2: 40, d: 0.3, g: 0.6 });
    crackle(E, o, t + 0.18, { n: 10, span: 0.3, g: 0.2, hp: 2200 });
    return t + 0.7;
  } },
  turretHit: { gap: 0.1, cap: 3, rev: 0.25, fn(E, o, t, v) {
    E.noise(o, t, { kind: 'white', hp: 1500, a: 0.001, d: 0.15, g: 0.45, shape: 10 });
    thud(E, o, t, { f: 130 * v, f2: 38, d: 0.3, g: 0.8 });
    E.fm(o, t, { f: 700 * v, ratio: 3.3, idx: 6, idx2: 0.2, modType: 'square', a: 0.001, d: 0.22, g: 0.12 });
    crackle(E, o, t + 0.02, { n: 8, span: 0.25, g: 0.18, hp: 3000 });
    return t + 0.4;
  } },
  minionAtk: { gap: 0.06, cap: 3, gain: 0.8, rev: 0, fn(E, o, t, v) {
    return swish(E, o, t, { f: 1800 * v, f2: 3200 * v, d: 0.06, g: 0.2, a: 0.015 });
  } },
  minionShot: { gap: 0.06, cap: 3, gain: 0.8, rev: 0.05, fn(E, o, t, v) {
    return E.tone(o, t, { type: 'sine', f: 1300 * v, f2: 700 * v, a: 0.002, d: 0.08, g: 0.12 });
  } },
  minionHit: { gap: 0.06, cap: 3, gain: 0.8, rev: 0, fn(E, o, t, v) {
    thud(E, o, t, { f: 230 * v, f2: 110, d: 0.05, g: 0.25 });
    return E.noise(o, t, { kind: 'pink', lp: 1800, a: 0.001, d: 0.03, g: 0.2 });
  } },
  minionDeath: { gap: 0.08, cap: 3, rev: 0.08, fn(E, o, t, v) {
    E.tone(o, t, { type: 'triangle', f: 520 * v, f2: 190 * v, a: 0.005, d: 0.16, g: 0.14 });
    E.noise(o, t, { kind: 'pink', lp: 900, a: 0.005, d: 0.22, g: 0.3 });
    thud(E, o, t + 0.1, { f: 140, f2: 60, d: 0.1, g: 0.3 });
    return t + 0.3;
  } },
  monsterAtk: { gap: 0.06, cap: 3, rev: 0.1, fn(E, o, t, v) {
    swish(E, o, t, { f: 400 * v, f2: 1400 * v, d: 0.18, g: 0.45, a: 0.05, q: 1 });
    E.tone(o, t, { type: 'sawtooth', f: 90 * v, f2: 70 * v, a: 0.03, d: 0.2, g: 0.12, lp: 600 });
    return t + 0.25;
  } },
  champDeath: { gap: 0.1, cap: 3, rev: 0.3, fn(E, o, t, v) {
    thud(E, o, t, { f: 95 * v, f2: 38, d: 0.45, g: 0.8 });
    E.noise(o, t, { kind: 'pink', filter: 'bandpass', f: 600, f2: 200, q: 1, a: 0.01, d: 0.4, g: 0.3 });
    E.tone(o, t, { type: 'triangle', f: 330 * v, f2: 150 * v, a: 0.01, d: 0.5, g: 0.1 });
    return t + 0.6;
  } },
  monsterDeath: { gap: 0.1, cap: 2, rev: 0.3, fn(E, o, t, v) {
    E.tone(o, t, { type: 'sawtooth', f: 140 * v, f2: 50 * v, a: 0.03, d: 0.8, g: 0.35, lp: 900, lp2: 200, vib: { rate: 8, depth: 0.05 } });
    thud(E, o, t + 0.3, { f: 90, f2: 35, d: 0.4, g: 0.7 });
    return t + 0.9;
  } },
};

// —— 反馈、系统、音乐 ——
const SYSTEM = {
  // 补刀金币「叮」：两音高亮金属叮当
  coin: { gap: 0.05, cap: 3, rev: 0.2, vary: 0.01, fn(E, o, t) {
    E.noise(o, t, { kind: 'white', hp: 7000, a: 0.001, d: 0.015, g: 0.2 });
    bell(E, o, t, N(95), { d: 0.12, g: 0.22, ratio: 2.0, idx: 0.8 });
    bell(E, o, t + 0.065, N(100), { d: 0.45, g: 0.26, ratio: 2.0, idx: 0.9 });
    return t + 0.55;
  } },
  coinBig: { gap: 0.1, cap: 2, rev: 0.25, vary: 0.01, fn(E, o, t) {
    [88, 92, 95, 100].forEach((m, i) => bell(E, o, t + i * 0.055, N(m), { d: 0.4, g: 0.18, ratio: 2.0, idx: 0.9 }));
    sparkle(E, o, t + 0.1, { d: 0.4, g: 0.05 });
    return t + 0.7;
  } },
  buy: { gap: 0.12, cap: 2, rev: 0.2, vary: 0.02, fn(E, o, t) {
    for (let i = 0; i < 5; i++) bell(E, o, t + i * 0.04 + Math.random() * 0.02, rnd(2400, 3800), { d: 0.14, g: 0.09, ratio: 2.4, idx: 1.5 });
    bell(E, o, t + 0.22, N(91), { d: 0.45, g: 0.2, ratio: 2.0 });
    bell(E, o, t + 0.22, N(96), { d: 0.45, g: 0.12, ratio: 2.0 });
    return t + 0.75;
  } },
  levelUp: { gap: 0.3, cap: 1, rev: 0.4, bus: 'sfx', vary: 0, fn(E, o, t) {
    [72, 76, 79, 84, 88].forEach((m, i) => {
      E.tone(o, t + i * 0.07, { type: 'triangle', f: N(m), a: 0.005, d: 0.5, g: 0.14 });
      E.tone(o, t + i * 0.07, { type: 'sine', f: N(m + 12), a: 0.005, d: 0.3, g: 0.05 });
    });
    E.noise(o, t, { kind: 'pink', filter: 'bandpass', f: 400, f2: 4000, q: 1.5, a: 0.3, d: 0.25, g: 0.2 });
    sparkle(E, o, t + 0.3, { d: 0.6, g: 0.08 });
    return t + 1.0;
  } },
  skillUp: { gap: 0.08, cap: 2, rev: 0.15, vary: 0, fn(E, o, t) {
    E.tone(o, t, { type: 'triangle', f: N(79), a: 0.003, d: 0.1, g: 0.14 });
    E.tone(o, t + 0.06, { type: 'triangle', f: N(86), a: 0.003, d: 0.2, g: 0.14 });
    return t + 0.3;
  } },
  recallEnd: { gap: 0.2, cap: 2, rev: 0.4, fn(E, o, t, v) {
    E.tone(o, t, { type: 'sine', f: 300 * v, f2: 1500 * v, a: 0.02, d: 0.45, g: 0.18 });
    E.noise(o, t, { kind: 'white', filter: 'bandpass', f: 1000, f2: 7000, q: 1.5, a: 0.05, d: 0.4, g: 0.25 });
    bell(E, o, t + 0.25, N(88), { d: 0.8, g: 0.12 });
    return t + 1.1;
  } },
  respawn: { gap: 0.3, cap: 1, rev: 0.4, fn(E, o, t) {
    [60, 67, 72, 79].forEach((m, i) => E.tone(o, t + i * 0.05, { type: 'sine', f: N(m), a: 0.05, d: 0.7, g: 0.09 }));
    E.noise(o, t, { kind: 'pink', filter: 'bandpass', f: 300, f2: 3000, q: 1, a: 0.4, d: 0.3, g: 0.2 });
    return t + 1.0;
  } },
  playerDeath: { gap: 0.5, cap: 1, rev: 0.5, vary: 0, fn(E, o, t) {
    E.tone(o, t, { type: 'sawtooth', f: 220, f2: 55, ft: 1.4, a: 0.02, hold: 0.2, d: 1.4, g: 0.22, lp: 1500, lp2: 200 });
    E.tone(o, t, { type: 'sawtooth', f: 330, f2: 82, ft: 1.4, a: 0.02, hold: 0.2, d: 1.4, g: 0.12, lp: 1200, detune: 8 });
    bell(E, o, t + 0.05, 110, { d: 2.0, g: 0.3, ratio: 1.41, idx: 2.5 });
    thud(E, o, t, { f: 70, f2: 30, d: 0.8, g: 0.8 });
    return t + 2.2;
  } },
  structureExplosion: { gap: 0.3, cap: 2, rev: 0.6, vary: 0.03, fn(E, o, t, v) {
    boom(E, o, t, { d: 2.2, g: 1, lp: 2400 * v, sub: 55 * v });
    boom(E, o, t + 0.25, { d: 1.4, g: 0.6, lp: 1600, sub: 45 });
    crackle(E, o, t + 0.1, { n: 26, span: 1.6, g: 0.16, hp: 1500 });
    E.noise(o, t + 0.3, { kind: 'brown', lp: 300, a: 0.4, hold: 0.5, d: 1.5, g: 0.6 });
    return t + 2.8;
  } },
  victory: { gap: 1, cap: 1, rev: 0.5, bus: 'voice', vary: 0, fn(E, o, t) {
    brass(E, o, t, N(67), 0.18); brass(E, o, t + 0.2, N(72), 0.18); brass(E, o, t + 0.4, N(76), 0.18);
    for (const m of [60, 64, 67, 72, 79]) brass(E, o, t + 0.6, N(m), 1.6, 0.14);
    thud(E, o, t + 0.6, { f: 95, f2: 55, d: 0.6, g: 0.8 });
    sparkle(E, o, t + 0.6, { d: 1.4, g: 0.06 });
    return t + 2.6;
  } },
  defeat: { gap: 1, cap: 1, rev: 0.5, bus: 'voice', vary: 0, fn(E, o, t) {
    brass(E, o, t, N(62), 0.45, 0.2); brass(E, o, t + 0.5, N(60), 0.45, 0.2); brass(E, o, t + 1.0, N(57), 0.5, 0.2);
    for (const m of [38, 50, 53, 57]) brass(E, o, t + 1.5, N(m), 1.8, 0.13);
    thud(E, o, t + 1.5, { f: 70, f2: 35, d: 1.0, g: 0.7 });
    return t + 3.4;
  } },
  ping: { gap: 0.15, cap: 2, rev: 0.2, vary: 0, fn(E, o, t) {
    E.tone(o, t, { type: 'sine', f: N(88), a: 0.003, d: 0.12, g: 0.18 });
    E.tone(o, t + 0.09, { type: 'sine', f: N(83), a: 0.003, d: 0.25, g: 0.18 });
    return t + 0.4;
  } },
  click: { gap: 0.03, cap: 2, rev: 0, vary: 0.02, fn(E, o, t, v) {
    E.tone(o, t, { type: 'sine', f: 1900 * v, f2: 1200 * v, a: 0.001, d: 0.035, g: 0.16 });
    return E.noise(o, t, { kind: 'white', hp: 4000, a: 0.001, d: 0.012, g: 0.1 });
  } },
  hover: { gap: 0.04, cap: 1, rev: 0, vary: 0.02, fn(E, o, t, v) {
    return E.tone(o, t, { type: 'sine', f: 2600 * v, a: 0.001, d: 0.02, g: 0.05 });
  } },
  error: { gap: 0.15, cap: 1, rev: 0, vary: 0, fn(E, o, t) {
    E.tone(o, t, { type: 'square', f: 190, a: 0.002, d: 0.08, g: 0.08, lp: 1500 });
    return E.tone(o, t + 0.1, { type: 'square', f: 150, a: 0.002, d: 0.12, g: 0.08, lp: 1500 });
  } },
  open: { gap: 0.06, cap: 1, rev: 0.1, vary: 0, fn(E, o, t) {
    E.tone(o, t, { type: 'triangle', f: N(79), a: 0.002, d: 0.08, g: 0.1 });
    return E.tone(o, t + 0.05, { type: 'triangle', f: N(84), a: 0.002, d: 0.12, g: 0.1 });
  } },
  close: { gap: 0.06, cap: 1, rev: 0.1, vary: 0, fn(E, o, t) {
    E.tone(o, t, { type: 'triangle', f: N(84), a: 0.002, d: 0.08, g: 0.1 });
    return E.tone(o, t + 0.05, { type: 'triangle', f: N(77), a: 0.002, d: 0.12, g: 0.1 });
  } },
  announce: { gap: 0.4, cap: 1, rev: 0.4, bus: 'voice', vary: 0, fn(E, o, t) {
    bell(E, o, t, N(76), { d: 0.8, g: 0.12 });
    return bell(E, o, t + 0.08, N(83), { d: 0.9, g: 0.1 }) + 0.2;
  } },
};

/** 所有一次性预设 */
export const PRESETS = { ...SKILL, ...SUMMONER, ...ATTACK, ...SYSTEM };
// 召唤师技能别名
PRESETS.ignite = SKILL.fire; PRESETS.barrier = SKILL.shield; PRESETS.cleanse = SKILL.light;
PRESETS.ghost = SKILL.buff; PRESETS.smite = SKILL.electric;

/** 分组（给试听页用） */
export const PRESET_GROUPS = {
  技能: Object.keys(SKILL),
  召唤师技能: ['flash', 'ignite', 'heal', 'barrier', 'exhaust', 'ghost', 'cleanse', 'smite', 'teleport'],
  普攻与命中: Object.keys(ATTACK),
  反馈与系统: Object.keys(SYSTEM),
};
export const SKILL_TAGS = Object.keys(SKILL);

/** 循环声预设 */
export const LOOPS = {
  // 回城：缓慢上升的和声嗡鸣 + 震音 + 旋转的滤波噪声
  recall: { rev: 0.4, gain: 1, loop(E, out, t) {
    const c = E.ctx, sources = [];
    const pad = c.createGain(); pad.gain.value = 1; pad.connect(out);
    const trem = c.createOscillator(), tg = c.createGain();
    trem.frequency.value = 3.2; tg.gain.value = 0.35; trem.connect(tg); tg.connect(pad.gain);
    trem.start(t); sources.push(trem);
    [[196, 0.16, 'sine'], [294, 0.1, 'sine'], [392, 0.06, 'triangle'], [588, 0.03, 'sine']].forEach(([f, g, type], i) => {
      const o = c.createOscillator(), og = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 1.26, t + 8);
      o.detune.value = i % 2 ? 6 : -6;
      og.gain.value = g;
      o.connect(og); og.connect(pad);
      o.start(t); sources.push(o);
    });
    const n = c.createBufferSource(); n.buffer = E.noiseBufs.pink; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5; bp.frequency.value = 1800;
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 0.6; lg.gain.value = 900; lfo.connect(lg); lg.connect(bp.frequency);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.02, t); ng.gain.linearRampToValueAtTime(0.12, t + 8);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    n.start(t); lfo.start(t); sources.push(n, lfo);
    return { sources };
  } },
};
