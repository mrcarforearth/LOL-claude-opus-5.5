// 中文语音播报：speechSynthesis（优先 zh-CN 语音，语速 1.1）
//  优先级队列 + 同句去重 + 播报间隔节流 + 过期丢弃 + 卡死看门狗；不可用时静默降级。

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** 各播报 key 的优先级（越大越重要） */
export const VOICE_PRIORITY = {
  victory: 100, defeat: 100, pentaKill: 95, ace: 85, quadraKill: 80, legendary: 78, shutdown: 75,
  tripleKill: 72, firstBlood: 70, godlike: 70, youDied: 68, unstoppable: 65, doubleKill: 64, rampage: 62,
  killingSpree: 60, baronSlain: 58, inhibitorDestroyed: 56, dragonSlain: 55, heraldSlain: 50, turretDestroyed: 50,
  welcome: 45, minions30: 45, minionsSpawned: 45, youKilled: 44, executed: 40, kill: 35,
  inhibitorRespawning: 35, inhibitorRespawned: 35, baronSpawn: 30, dragonSpawn: 30,
};

/** 所有支持的播报 key（试听页用） */
export const VOICE_KEYS = [
  'welcome', 'minions30', 'minionsSpawned', 'firstBlood', 'kill', 'doubleKill', 'tripleKill', 'quadraKill', 'pentaKill',
  'killingSpree', 'rampage', 'unstoppable', 'godlike', 'legendary', 'shutdown', 'ace', 'executed',
  'turretDestroyed', 'inhibitorDestroyed', 'inhibitorRespawning', 'inhibitorRespawned',
  'dragonSlain', 'baronSlain', 'heraldSlain', 'dragonSpawn', 'baronSpawn', 'victory', 'defeat',
];

const STATIC = {
  welcome: '欢迎来到召唤师峡谷', minions30: '敌军还有三十秒到达战场', minionsSpawned: '全军出击',
  firstBlood: '第一滴血', doubleKill: '双杀', tripleKill: '三杀', quadraKill: '四杀', pentaKill: '五杀',
  killingSpree: '大杀特杀', rampage: '主宰比赛', unstoppable: '无人能挡', godlike: '变态杀戮', legendary: '超神',
  shutdown: '终结', ace: '团灭', inhibitorRespawning: '召唤水晶正在重生',
  dragonSpawn: '巨龙已刷新', baronSpawn: '纳什男爵已刷新',
};

/**
 * announce 事件 → { text, priority }；未知 key 返回 null
 * p：announce payload（team = 受益队伍）；me：{ team, player }
 */
export function lineFor(key, p = {}, me = {}) {
  const myTeam = me.team ?? 0, player = me.player || null;
  const mine = p.team != null && p.team === myTeam;
  const pr = (k) => VOICE_PRIORITY[k] ?? 30;
  const isMe = (u) => !!u && !!player && u === player;
  switch (key) {
    case 'kill':
      if (isMe(p.victim)) return { text: '你已被击杀', priority: pr('youDied') };
      if (isMe(p.killer)) return { text: '你击杀了一名敌人', priority: pr('youKilled') };
      return { text: mine ? '一名敌军已被击杀' : '一名友军已被击杀', priority: pr('kill') };
    case 'executed':
      if (isMe(p.victim)) return { text: '你已被击杀', priority: pr('youDied') };
      return { text: p.victim && p.victim.team === myTeam ? '一名友军被处决' : '一名敌军被处决', priority: pr('executed') };
    case 'turretDestroyed':
      return { text: mine ? '摧毁了一座敌方防御塔' : '我方防御塔已被摧毁', priority: pr(key) };
    case 'inhibitorDestroyed':
      return { text: mine ? '敌方召唤水晶已被摧毁' : '我方召唤水晶已被摧毁', priority: pr(key) };
    case 'inhibitorRespawned':
      return { text: mine ? '我方召唤水晶已重生' : '敌方召唤水晶已重生', priority: pr(key) };
    case 'dragonSlain':
      return { text: mine ? '我方击败了巨龙' : '敌方击败了巨龙', priority: pr(key) };
    case 'baronSlain':
      return { text: mine ? '我方击败了纳什男爵' : '敌方击败了纳什男爵', priority: pr(key) };
    case 'heraldSlain':
      return { text: mine ? '我方击败了峡谷先锋' : '敌方击败了峡谷先锋', priority: pr(key) };
    case 'victory': // team = 获胜方
      return { text: p.team == null || mine ? '胜利' : '失败', priority: pr(key) };
    case 'defeat': // team = 失败方（core 目前不发，按字面兜底）
      return { text: p.team != null && !mine ? '胜利' : '失败', priority: pr(key) };
    default:
      if (STATIC[key]) return { text: STATIC[key], priority: pr(key) };
      return null;
  }
}

export class Announcer {
  constructor() {
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    this.synth = g.speechSynthesis || null;
    this.Utter = g.SpeechSynthesisUtterance || null;
    this.ok = !!(this.synth && this.Utter && typeof this.synth.speak === 'function');
    this.enabled = false;       // 用户手势解锁后才开始播报（浏览器自动播放策略）
    this.muted = false;
    this.volume = 1;
    this.rate = 1.1;
    this.queue = [];
    this.current = null;        // { text, priority, startedAt, maxMs }
    this.nextAt = 0;            // 节流：下一句最早开始时间
    this.recent = new Map();    // 文本 → 最近一次入队时间（去重）
    this.voice = null;
    if (this.ok) {
      try {
        this._pickVoice();
        this.synth.addEventListener?.('voiceschanged', () => this._pickVoice());
      } catch { /* 忽略 */ }
    }
  }
  _pickVoice() {
    try {
      const list = this.synth.getVoices?.() || [];
      const norm = (v) => String(v.lang || '').toLowerCase().replace('_', '-');
      this.voice = list.find((v) => norm(v) === 'zh-cn' && /xiaoxiao|tingting|yaoyao|huihui|google/i.test(v.name))
        || list.find((v) => norm(v) === 'zh-cn') || list.find((v) => norm(v).startsWith('zh-hans'))
        || list.find((v) => norm(v).startsWith('zh')) || null;
    } catch { this.voice = null; }
  }
  unlock() { this.enabled = true; if (this.ok && !this.voice) this._pickVoice(); }
  setMuted(m) { this.muted = !!m; if (this.muted) this.cancel(); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, Number(v) || 0)); }
  cancel() {
    this.queue.length = 0;
    this.current = null;
    try { if (this.ok) this.synth.cancel(); } catch { /* 忽略 */ }
  }

  /** 入队一句播报 */
  say(text, priority = 30) {
    if (!this.ok || !this.enabled || this.muted || this.volume <= 0 || !text) return false;
    const now = nowMs();
    const last = this.recent.get(text);
    if (last != null && now - last < 2500) return false; // 去重
    this.recent.set(text, now);
    if (this.recent.size > 40) for (const [k, t] of this.recent) if (now - t > 5000) this.recent.delete(k);
    this.queue.push({ text, priority, at: now });
    this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
    if (this.queue.length > 4) this.queue.length = 4; // 丢弃最不重要的
    // 高优先级打断低优先级
    if (this.current && priority >= 90 && this.current.priority < 70) {
      try { this.synth.cancel(); } catch { /* 忽略 */ }
      this.current = null;
    }
    this._pump();
    return true;
  }

  _pump() {
    if (!this.ok || this.current || !this.queue.length) return;
    const now = nowMs();
    if (now < this.nextAt) return;
    // 丢弃过期播报（普通 6 秒，高优先级 12 秒）
    while (this.queue.length && now - this.queue[0].at > (this.queue[0].priority >= 90 ? 12000 : 6000)) this.queue.shift();
    const item = this.queue.shift();
    if (!item) return;
    try {
      const u = new this.Utter(item.text);
      u.lang = 'zh-CN';
      if (this.voice) u.voice = this.voice;
      u.rate = this.rate;
      u.pitch = 1;
      u.volume = this.volume;
      const cur = { ...item, startedAt: now, maxMs: 2500 + item.text.length * 450 };
      const done = () => { if (this.current === cur) { this.current = null; this.nextAt = nowMs() + 220; } };
      u.onend = done;
      u.onerror = done;
      this.current = cur;
      this.synth.speak(u);
    } catch {
      this.current = null;
      this.nextAt = now + 500;
    }
  }

  update() {
    if (!this.ok) return;
    if (this.current && nowMs() - this.current.startedAt > this.current.maxMs) {
      // 看门狗：部分浏览器不触发 onend
      this.current = null;
      this.nextAt = nowMs() + 200;
      try { if (this.synth.speaking) this.synth.cancel(); } catch { /* 忽略 */ }
    }
    this._pump();
  }
}
