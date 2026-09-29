// 音频系统（ARCHITECTURE.md §13）
//  new AudioSystem(game, renderer, { muted }) → unlock()（用户手势中调用）/ update(dt) / setVolume({ master, sfx, voice, ambient }) / setMuted(bool)
//  另：playUI(name)（UI 点击等）、play(name, opts)（通用）、say(text, priority)、dispose()
//  - AudioContext 在 unlock() 时才创建（遵守自动播放策略）；无 WebAudio 时全部空操作
//  - 订阅 game.events，只对镜头附近（距镜头中心 ≤ 2500）且对玩家可见、或与玩家相关的事件发声
//  - 空间化：距离衰减 + 左右声像（相对 renderer.cameraCtl.target）
//  - 语音播报见 voice.js，环境音见 ambient.js，合成引擎见 engine.js，预设见 presets.js

import { SynthEngine } from './engine.js';
import { PRESETS, PRESET_GROUPS, SKILL_TAGS, LOOPS } from './presets.js';
import { Announcer, lineFor, VOICE_KEYS } from './voice.js';
import { Ambient } from './ambient.js';

export { PRESETS, PRESET_GROUPS, SKILL_TAGS, VOICE_KEYS, lineFor };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const HEAR_FULL = 650;   // 此距离内不衰减
const HEAR_MAX = 2500;   // 超过即静音

// 近战英雄的武器类型（普攻挥砍/命中音色）
const MELEE_WEAPON = { garen: 'sword', darius: 'axe', masteryi: 'sword', yasuo: 'sword', zed: 'sword', xinzhao: 'axe', leesin: 'fist', malphite: 'fist' };
// 召唤师技能 → 预设
const SUMMONER_SFX = { flash: 'flash', ignite: 'ignite', heal: 'heal', barrier: 'barrier', exhaust: 'exhaust', ghost: 'ghost', cleanse: 'cleanse', smite: 'smite', teleport: 'teleport' };

function safeParamsMuted() {
  try { return new URLSearchParams(globalThis.location?.search || '').get('mute') === '1'; } catch { return false; }
}

export class AudioSystem {
  constructor(game, renderer, { muted = false } = {}) {
    this.game = game || null;
    this.renderer = renderer || null;
    this.muted = !!muted || safeParamsMuted();
    this.volumes = { master: 0.8, sfx: 1, voice: 1, ambient: 0.6 };
    this.AC = (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext)) || null;
    this.available = !!this.AC;
    this.ctx = null;
    this.engine = null;
    this.ambient = null;
    this.unlocked = false;
    this.recalls = new Map();   // champion → { handle, until }
    this._unsubs = [];
    this._errCount = 0;
    this.announcer = new Announcer();
    this.announcer.setMuted(this.muted);
    this._subscribe();
  }

  // —— 公共 API ——
  unlock() {
    try {
      if (!this.available) { this.announcer.unlock(); return false; }
      if (!this.ctx) {
        this.ctx = new this.AC({ latencyHint: 'interactive' });
        this.engine = new SynthEngine(this.ctx);
        try { this.ambient = new Ambient(this.engine); } catch (err) { console.warn('[音频] 环境音初始化失败：', err); this.ambient = null; }
        this._applyVolumes(true);
      }
      if (this.ctx.state === 'suspended') { const p = this.ctx.resume(); p?.catch?.(() => {}); }
      this.announcer.unlock();
      this.unlocked = true;
      return true;
    } catch (err) {
      console.warn('[音频] 初始化失败，音频禁用：', err);
      this.available = false;
      this.ctx = null; this.engine = null; this.ambient = null;
      return false;
    }
  }

  setVolume(v = {}) {
    try {
      for (const k of ['master', 'sfx', 'voice', 'ambient']) {
        const x = Number(v?.[k]);
        if (v && v[k] != null && isFinite(x)) this.volumes[k] = clamp(x, 0, 1);
      }
      this._applyVolumes();
    } catch { /* 忽略 */ }
  }

  setMuted(m) {
    try {
      this.muted = !!m;
      this.announcer.setMuted(this.muted);
      if (this.muted) this._stopAllRecalls();
      this._applyVolumes();
    } catch { /* 忽略 */ }
  }

  update(dt) {
    const E = this.engine;
    if (!E) { try { this.announcer.update(); } catch { /* 忽略 */ } return; }
    try {
      E.sweep();
      this.announcer.update();
      // 回城循环兜底：超时自动停止
      if (this.recalls.size) {
        const t = this._simTime();
        for (const [ch, r] of this.recalls) if (t > r.until || !ch.alive || ch.removed) { r.handle.stop(); this.recalls.delete(ch); }
      }
      if (this.ambient) {
        const on = !this.muted && this.volumes.ambient > 0 && this.volumes.master > 0 && this.ctx.state === 'running';
        this.ambient.setActive(on);
        if (on) this.ambient.update(Math.min(0.1, Math.max(0, Number(dt) || 0)), this._ambientCtx());
      }
    } catch (err) { this._err('update', err); }
  }

  /** UI 音效（非空间化） */
  playUI(name = 'click') {
    const n = PRESETS[name] ? name : 'click';
    return this.play(n, { priority: 3 });
  }

  /**
   * 播放预设
   * opts: { x, y（游戏坐标，给出则空间化）, gain, priority, always（与玩家相关：保底音量）, crit, delay }
   */
  play(name, opts = {}) {
    const E = this.engine;
    if (!E || this.muted || !this.unlocked) return false;
    const preset = PRESETS[name];
    if (!preset) return false;
    try {
      let gain = opts.gain ?? 1, pan = 0;
      if (opts.x != null && opts.y != null) {
        const s = this._spatial(opts.x, opts.y);
        gain *= opts.always ? Math.max(s.gain, opts.minGain ?? 0.65) : Math.max(s.gain, opts.minGain ?? 0);
        pan = s.pan;
      }
      if (gain <= 0.01) return false;
      return E.play(name, preset, { gain, pan, priority: opts.priority ?? 1, delay: opts.delay ?? 0, opts: { crit: !!opts.crit } });
    } catch (err) { this._err('play', err); return false; }
  }

  /** 直接播报一句中文 */
  say(text, priority = 30) { try { return this.announcer.say(text, priority); } catch { return false; } }

  dispose() {
    for (const u of this._unsubs) { try { u(); } catch { /* 忽略 */ } }
    this._unsubs = [];
    this._stopAllRecalls();
    try { this.announcer.cancel(); } catch { /* 忽略 */ }
    try { this.ambient?.dispose(); } catch { /* 忽略 */ }
    try { this.ctx?.close?.(); } catch { /* 忽略 */ }
    this.ctx = null; this.engine = null; this.ambient = null;
  }

  // —— 内部：音量 ——
  _applyVolumes(immediate = false) {
    const E = this.engine;
    this.announcer.setVolume(this.volumes.master * this.volumes.voice);
    if (!E) return;
    const tau = immediate ? 0.001 : 0.05;
    E.setGain(E.master, this.muted ? 0 : this.volumes.master, tau);
    E.setGain(E.buses.sfx, this.volumes.sfx, tau);
    E.setGain(E.buses.voice, this.volumes.voice, tau);
    E.setGain(E.buses.ambient, this.volumes.ambient * 0.9, tau);
  }

  // —— 内部：空间化 ——
  _listener() {
    const t = this.renderer?.cameraCtl?.target;
    if (t && isFinite(t.x) && isFinite(t.y)) return t;
    const p = this.game?.player;
    if (p && isFinite(p.x)) return p;
    return { x: 7500, y: 7500 };
  }
  _spatial(x, y) {
    const L = this._listener();
    const dx = x - L.x, dy = y - L.y;
    const d = Math.hypot(dx, dy);
    let gain = 1;
    if (d > HEAR_FULL) { const k = clamp((d - HEAR_FULL) / (HEAR_MAX - HEAR_FULL), 0, 1); gain = (1 - k) * (1 - k); }
    if (d >= HEAR_MAX) gain = 0;
    return { gain, pan: clamp(dx / 1500, -1, 1) * 0.75, dist: d };
  }
  _ambientCtx() {
    const L = this._listener();
    let river = 0;
    try {
      const rd = this.game?.map?.riverDistance;
      if (typeof rd === 'function') {
        const d = rd(L.x, L.y);
        if (isFinite(d)) river = Math.pow(clamp(1 - (d - 350) / 1500, 0, 1), 1.5);
      }
    } catch { river = 0; }
    // 林间程度：远离河道更浓；两侧基地（左下/右上角）稀疏
    const baseDist = Math.min(Math.hypot(L.x - 700, L.y - 700), Math.hypot(L.x - 14300, L.y - 14300));
    const inBase = clamp(1 - (baseDist - 3200) / 1500, 0, 1);
    const forest = clamp((1 - river * 0.6) * (1 - inBase * 0.75), 0, 1);
    return { river, forest };
  }

  // —— 内部：事件 ——
  get _me() { return this.game?.player || null; }
  get _myTeam() { return this.game?.player?.team ?? 0; }
  _simTime() { return this.game?.time ?? 0; }
  _visible(e) {
    if (!e) return false;
    if (e.team === this._myTeam) return true;
    if (Array.isArray(e.visible)) return e.visible[this._myTeam] !== false;
    return true;
  }
  _related(...units) { const me = this._me; return !!me && units.some((u) => u && (u === me || u.owner === me)); }
  _err(where, err) {
    if (this._errCount++ < 5) console.warn(`[音频] ${where} 出错：`, err);
  }
  _on(name, fn) {
    const ev = this.game?.events;
    if (!ev || typeof ev.on !== 'function') return;
    try {
      const wrapped = (p) => { try { fn(p || {}); } catch (err) { this._err(name, err); } };
      const un = ev.on(name, wrapped);
      this._unsubs.push(typeof un === 'function' ? un : () => { try { ev.off?.(name, wrapped); } catch { /* 忽略 */ } });
    } catch { /* 忽略 */ }
  }
  /** 事件是否需要发声（引擎已就绪、未静音） */
  get _live() { return !!this.engine && !this.muted && this.unlocked; }

  _weaponOf(c) {
    const def = c.def || {};
    const vfx = c.baseStats?.attackVfx;
    const ranged = def.ranged ?? !!vfx;
    if (!ranged) return MELEE_WEAPON[def.id || c.modelId] || 'sword';
    const k = `${vfx?.kind || ''} ${vfx?.fallback || ''}`.toLowerCase();
    if (/rocket|missile/.test(k)) return 'rocket';
    if (/bullet|gun|zap|shot/.test(k)) return 'bullet';
    if (/arrow|volley|bolt/.test(k)) return 'arrow';
    if (/fire/.test(k)) return 'fire';
    return 'orb';
  }

  _subscribe() {
    const on = (n, f) => this._on(n, f);

    on('basicAttack', ({ attacker: a, target }) => {
      if (!this._live || !a || !this._visible(a)) return;
      const rel = this._related(a, target);
      const pos = { x: a.x, y: a.y, always: rel, priority: rel ? 3 : 1 };
      switch (a.type) {
        case 'champion': {
          const w = this._weaponOf(a);
          this.play(`atk_${w === 'fire' ? 'fire' : w}`, { ...pos, gain: 0.7 });
          break;
        }
        case 'turret': this.play('turretShot', { ...pos, gain: 0.85, priority: 2 }); break;
        case 'minion': this.play(a.baseStats?.attackVfx ? 'minionShot' : 'minionAtk', { ...pos, gain: 0.35, priority: rel ? 2 : 0 }); break;
        case 'monster': this.play('monsterAtk', { ...pos, gain: 0.55 }); break;
        case 'pet': this.play('minionAtk', { ...pos, gain: 0.3, priority: 0 }); break;
        default: break;
      }
    });

    on('attackHit', ({ attacker: a, target: t, isCrit, miss }) => {
      if (!this._live || !a || !t || miss) return;
      if (!this._visible(t) && !this._visible(a)) return;
      const rel = this._related(a, t);
      const pos = { x: t.x, y: t.y, always: rel, priority: rel ? 3 : 1 };
      switch (a.type) {
        case 'champion': {
          const w = this._weaponOf(a);
          const name = { sword: 'hit_sword', axe: 'hit_axe', fist: 'hit_fist', arrow: 'hit_arrow', bullet: 'hit_bullet', rocket: 'hit_rocket', fire: 'hit_orb', orb: 'hit_orb' }[w] || 'hit_sword';
          this.play(name, { ...pos, gain: 0.75, crit: isCrit });
          if (isCrit) this.play('crit', { ...pos, gain: 0.7 });
          break;
        }
        case 'turret': this.play('turretHit', { ...pos, gain: 0.85, priority: 2 }); break;
        case 'minion': this.play('minionHit', { ...pos, gain: 0.35, priority: rel ? 2 : 0 }); break;
        case 'monster': this.play('hit_axe', { ...pos, gain: 0.5 }); break;
        default: this.play('minionHit', { ...pos, gain: 0.3, priority: 0 }); break;
      }
    });

    on('abilityCast', ({ caster: c, slot, x, y }) => {
      if (!this._live || !c || !this._visible(c)) return;
      const def = c.def?.abilities?.[slot] || c.abilities?.[slot]?.def || {};
      let tag = def.sfx;
      if (Array.isArray(tag)) tag = tag[0];
      if (!tag || !PRESETS[tag]) tag = (def.damageType || c.def?.damageType) === 'magic' ? 'magic' : 'whoosh';
      const rel = this._related(c);
      const px = isFinite(x) && slot !== 'R' ? (c.x + x) / 2 : c.x, py = isFinite(y) && slot !== 'R' ? (c.y + y) / 2 : c.y;
      this.play(tag, { x: px, y: py, always: rel, priority: rel ? 4 : 2, gain: slot === 'R' ? 1 : 0.85 });
    });

    on('summonerCast', ({ caster: c, spellId, key }) => {
      if (!this._live || !c || !this._visible(c)) return;
      const tag = SUMMONER_SFX[spellId] || SUMMONER_SFX[key] || 'magic';
      const rel = this._related(c);
      this.play(tag, { x: c.x, y: c.y, always: rel, priority: rel ? 4 : 2, gain: 0.85 });
    });

    on('damage', ({ source, target: t, isAbility, isDot, isBasicAttack, amount }) => {
      // 技能命中英雄的附加受击声（普攻命中由 attackHit 负责）
      if (!this._live || !t || !isAbility || isDot || isBasicAttack || t.type !== 'champion' || !(amount > 0)) return;
      if (!this._visible(t)) return;
      const rel = this._related(source, t);
      this.play('hit_orb', { x: t.x, y: t.y, always: rel, gain: 0.45, priority: rel ? 2 : 1 });
    });

    on('death', ({ unit: u }) => {
      if (!this._live || !u) return;
      if (u === this._me) { this.play('playerDeath', { priority: 6, gain: 0.9 }); return; }
      if (!this._visible(u)) return;
      const pos = { x: u.x, y: u.y };
      if (u.type === 'minion') this.play('minionDeath', { ...pos, gain: 0.45, priority: 0 });
      else if (u.type === 'champion') this.play('champDeath', { ...pos, gain: 0.9, priority: 3 });
      else if (u.type === 'monster') this.play(u.epic ? 'monsterDeath' : 'minionDeath', { ...pos, gain: u.epic ? 1 : 0.6, minGain: u.epic ? 0.3 : 0 });
    });

    on('structureDestroyed', ({ structure: s }) => {
      if (!this._live) return;
      const x = s?.x, y = s?.y;
      // 建筑爆炸全图可闻（远处保底 0.3）
      if (isFinite(x)) this.play('structureExplosion', { x, y, minGain: 0.3, priority: 5 });
      else this.play('structureExplosion', { gain: 0.5, priority: 5 });
    });

    on('goldGained', ({ champion: c, reason, amount }) => {
      if (!this._live || !c || c !== this._me || !(amount > 0)) return;
      if (reason === 'minion' || reason === 'monster') this.play('coin', { priority: 4, gain: 0.8 });
      else if (reason === 'kill' || reason === 'assist' || reason === 'objective' || reason === 'turret') this.play('coinBig', { priority: 4, gain: 0.8 });
    });

    on('levelUp', ({ unit: u }) => { if (this._live && u && u === this._me) this.play('levelUp', { priority: 5, gain: 0.8 }); });
    on('abilityLevelUp', ({ champion: c }) => { if (this._live && c && c === this._me) this.play('skillUp', { priority: 3, gain: 0.7 }); });
    on('respawn', ({ champion: c }) => { if (this._live && c && c === this._me) this.play('respawn', { priority: 4, gain: 0.7 }); });
    on('itemBought', ({ champion: c }) => { if (this._live && c && c === this._me) this.play('buy', { priority: 4, gain: 0.8 }); });
    on('ping', ({ team, x, y }) => { if (this._live && team === this._myTeam) this.play('ping', { x, y, minGain: 0.5, priority: 3, gain: 0.7 }); });

    on('recallStart', ({ champion: c }) => {
      if (!this._live || !c) return;
      const rel = c === this._me;
      if (!rel && !this._visible(c)) return;
      const s = this._spatial(c.x, c.y);
      const gain = rel ? 0.8 : s.gain * 0.5;
      if (gain < 0.02) return;
      this._stopRecall(c);
      const dur = (typeof c.recallDuration === 'function' ? Number(c.recallDuration()) : 8) || 8;
      const handle = this.engine.startLoop('recall', LOOPS.recall, { gain, pan: rel ? 0 : s.pan });
      this.recalls.set(c, { handle, until: this._simTime() + dur + 1 });
    });
    on('recallCancel', ({ champion: c }) => this._stopRecall(c));
    on('recallEnd', ({ champion: c }) => {
      const had = this.recalls.has(c);
      this._stopRecall(c);
      if (!this._live || !c) return;
      if (c === this._me) this.play('recallEnd', { priority: 4, gain: 0.8 });
      else if (had) this.play('recallEnd', { x: c.x, y: c.y, gain: 0.5 });
    });

    on('gameOver', ({ winner }) => {
      if (!this._live) return;
      this._stopAllRecalls();
      this.play(winner === this._myTeam ? 'victory' : 'defeat', { priority: 9, gain: 0.9 });
    });

    on('announce', (p) => {
      const line = lineFor(p.key, p, { team: this._myTeam, player: this._me });
      if (line) this.say(line.text, line.priority);
    });
  }

  _stopRecall(c) {
    const r = c && this.recalls.get(c);
    if (r) { try { r.handle.stop(); } catch { /* 忽略 */ } this.recalls.delete(c); }
  }
  _stopAllRecalls() {
    for (const r of this.recalls.values()) { try { r.handle.stop(); } catch { /* 忽略 */ } }
    this.recalls.clear();
  }
}

export default AudioSystem;
