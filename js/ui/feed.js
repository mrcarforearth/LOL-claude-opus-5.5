// 击杀信息（右侧：击杀者 → 被击杀者、助攻、多杀、建筑与史诗野怪）、公告横幅（屏幕中上，按我方/敌方着色）、屏幕中央小提示
import { h, DRAGON_META } from './dom.js';

const MULTI = [null, null, '双杀', '三杀', '四杀', '五杀'];
const KILL_KEYS = new Set(['kill', 'firstBlood', 'doubleKill', 'tripleKill', 'quadraKill', 'pentaKill', 'killingSpree', 'rampage', 'unstoppable', 'godlike', 'legendary', 'shutdown', 'executed']);
const BIG_KEYS = new Set(['firstBlood', 'pentaKill', 'quadraKill', 'ace', 'legendary', 'godlike', 'baronSlain', 'inhibitorDestroyed']);
const GLYPH = { minion: '兵', turret: '塔', inhibitor: '晶', nexus: '枢', monster: '怪', pet: '宠', ward: '眼' };
const OBJ = { dragon: ['龙', '亚龙'], baron: ['男', '纳什男爵'], herald: ['先', '峡谷先锋'] };
const MAX_ENTRIES = 6;

export class Feed {
  constructor(ui) {
    this.ui = ui;
    this.team = ui.team;
    this.me = ui.me;
    this.list = h('div.killfeed', { 'aria-live': 'polite' });
    this.bannerWrap = h('div.banner-wrap', { 'aria-live': 'polite' });
    this.toastEl = h('div.ui-toast');
    ui.root.append(this.list, this.bannerWrap, this.toastEl);
    this.entries = [];
    this.queue = [];
    this.cur = null;
    this.curUntil = 0;
    this.now = 0;
    this.toastUntil = 0;
  }

  // —— 图标 ——
  champIcon(c, cls = '') {
    const img = h(`img.kf-p${cls}`, { alt: c?.def?.name || '', draggable: 'false' });
    img.classList.add(c?.team === this.team ? 'ally' : 'enemy');
    if (c === this.me) img.classList.add('me');
    this.ui.portraits.apply(img, c.championId);
    return img;
  }
  glyphIcon(glyph, rel, color = null) {
    const el = h(`div.kf-g.${rel}`, glyph);
    if (color) el.style.setProperty('--gc', color);
    return el;
  }
  unitIcon(u) {
    if (!u) return this.glyphIcon('?', 'neutral');
    if (u.type === 'champion') return this.champIcon(u);
    if (u.type === 'pet' && u.owner?.type === 'champion') return this.champIcon(u.owner);
    const rel = u.team === this.team ? 'ally' : u.team === 0 || u.team === 1 ? 'enemy' : 'neutral';
    return this.glyphIcon(u.type === 'monster' && u.name ? u.name[0] : GLYPH[u.type] || '?', rel);
  }

  push(el) {
    this.list.appendChild(el);
    const e = { el, until: this.now + 11 };
    this.entries.push(e);
    while (this.entries.length > MAX_ENTRIES) this.entries.shift().el.remove();
    requestAnimationFrame(() => el.classList.add('in'));
  }

  onKill(e) {
    const v = e.victim;
    if (!v) return;
    const kc = e.killerChampion;
    const rel = v.team === this.team ? 'enemy' : 'ally';
    const killer = e.executed || !kc ? this.unitIcon(e.killer && e.killer !== v ? e.killer : null) : this.champIcon(kc);
    if (e.executed && !e.killer) killer.textContent = '处';
    const assists = h('div.kf-assists');
    for (const a of (e.assists || []).slice(0, 4)) if (a && a !== kc) assists.appendChild(this.champIcon(a, '.sm'));
    const tag = e.multiKill >= 2 ? MULTI[Math.min(5, e.multiKill)] : e.shutdown ? '终结' : e.firstBlood ? '第一滴血' : '';
    const involvesMe = kc === this.me || v === this.me || (e.assists || []).includes(this.me);
    this.push(h(`div.kf-entry.${rel}${involvesMe ? '.mine' : ''}`,
      h('div.kf-side', killer, assists),
      h('div.kf-mid', h('i.kf-sword'), tag ? h('span.kf-tag', tag) : null),
      h('div.kf-side', this.champIcon(v))));
  }
  onStructure(e) {
    const rel = e.team === this.team ? 'enemy' : 'ally';
    const killer = e.killerChampion ? this.champIcon(e.killerChampion) : this.glyphIcon('兵', rel === 'ally' ? 'ally' : 'enemy');
    const g = e.kind === 'inhibitor' ? '晶' : e.kind === 'nexus' ? '枢' : '塔';
    this.push(h(`div.kf-entry.${rel}.obj`,
      h('div.kf-side', killer), h('div.kf-mid', h('i.kf-sword')),
      h('div.kf-side', this.glyphIcon(g, e.team === this.team ? 'ally' : 'enemy'))));
  }
  onObjective(e) {
    const o = OBJ[e.kind];
    if (!o) return;
    const rel = e.team === this.team ? 'ally' : 'enemy';
    const color = e.kind === 'dragon' ? DRAGON_META[e.dragonType]?.color || '#ff8a3a' : e.kind === 'baron' ? '#a35cff' : '#b07cff';
    const killer = e.killerChampion ? this.champIcon(e.killerChampion) : this.glyphIcon('兵', rel);
    const name = e.kind === 'dragon' ? DRAGON_META[e.dragonType]?.name || o[1] : o[1];
    this.push(h(`div.kf-entry.${rel}.obj`,
      h('div.kf-side', killer), h('div.kf-mid', h('i.kf-sword'), h('span.kf-tag', name)),
      h('div.kf-side', this.glyphIcon(o[0], 'neutral', color))));
  }

  // —— 公告横幅 ——
  announce(e) {
    const key = e?.key;
    if (!key || key === 'victory' || key === 'defeat') return;
    const t = this.team;
    const mine = e.team === t;
    const neutral = e.team == null;
    const rel = neutral ? 'neutral' : mine ? 'ally' : 'enemy';
    const persp = (s) => String(s || '').replace(/蓝色方/g, t === 0 ? '我方' : '敌方').replace(/红色方/g, t === 1 ? '我方' : '敌方');
    const b = { rel, title: persp(e.text), sub: '', killer: null, victim: null, dur: 2.8, big: BIG_KEYS.has(key), key };
    if (KILL_KEYS.has(key)) {
      const k = e.killer?.type === 'champion' ? e.killer : null;
      const v = e.victim?.type === 'champion' ? e.victim : null;
      b.killer = k; b.victim = v;
      b.rel = v ? (v.team === t ? 'enemy' : 'ally') : rel;
      if (key === 'kill') {
        b.title = k === this.me ? '你击杀了一名敌人' : v === this.me ? '你已阵亡' : b.rel === 'ally' ? '已击杀一名敌人' : '一名友军已被击杀';
        b.dur = 2.2;
      } else if (key === 'executed') {
        b.title = v === this.me ? '你已被处决' : `${v?.def?.name || ''}被处决`;
      } else {
        b.title = String(e.text || '').replace(/[！!]$/, '');
        if (key === 'firstBlood') b.sub = k ? `${k.def?.name || ''} 拿下了第一滴血` : '';
        else if (key === 'shutdown') b.sub = k ? `${k.def?.name || ''} 终结了 ${v?.def?.name || ''}` : '';
        else if (k) b.sub = k === this.me ? '你' : k.def?.name || '';
      }
    } else if (key === 'ace') {
      b.title = '团灭';
      b.sub = mine ? '敌方全军覆没' : '我方全军覆没';
    } else if (key === 'turretDestroyed') {
      const first = /第一座/.test(e.text || '');
      b.title = mine ? (first ? '我方摧毁了第一座防御塔' : '我方摧毁了一座防御塔') : (first ? '敌方摧毁了第一座防御塔' : '我方防御塔已被摧毁');
    } else if (key === 'inhibitorDestroyed') {
      b.title = mine ? '我方摧毁了一座召唤水晶' : '我方召唤水晶已被摧毁';
      b.sub = mine ? '超级兵将出现在该路' : '敌方超级兵即将到来';
    } else if (key === 'inhibitorRespawning') b.title = mine ? '我方召唤水晶即将重生' : '敌方召唤水晶即将重生';
    else if (key === 'inhibitorRespawned') b.title = mine ? '我方召唤水晶已重生' : '敌方召唤水晶已重生';
    else if (key === 'welcome' || key === 'minions30' || key === 'minionsSpawned') { b.dur = 3.2; b.big = key === 'welcome'; }
    else if (key === 'dragonSpawn' || key === 'baronSpawn') b.dur = 3;
    if (!b.title) return;
    // 队列：普通击杀公告可被丢弃，避免团战时堆积
    if (this.queue.length >= 3) {
      const idx = this.queue.findIndex((q) => q.key === 'kill');
      if (idx >= 0) this.queue.splice(idx, 1); else this.queue.shift();
    }
    this.queue.push(b);
  }
  showBanner(b) {
    const parts = [];
    if (b.killer || b.victim) {
      parts.push(h('div.bn-portraits',
        b.killer ? h('div.bn-pf', this.champIcon(b.killer, '.bn')) : null,
        b.killer && b.victim ? h('i.bn-x') : null,
        b.victim ? h('div.bn-pf.victim', this.champIcon(b.victim, '.bn')) : null));
    }
    const el = h(`div.banner.${b.rel}${b.big ? '.big' : ''}`, ...parts,
      h('div.bn-text', h('div.bn-title', b.title), b.sub ? h('div.bn-sub', b.sub) : null));
    this.bannerWrap.replaceChildren(el);
    requestAnimationFrame(() => el.classList.add('in'));
    this.cur = el;
    this.curUntil = this.now + b.dur;
  }

  toast(text, dur = 1.6) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('on');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('on');
    this.toastUntil = this.now + dur;
  }

  update(dt) {
    this.now += dt;
    const now = this.now;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (now > e.until) { e.el.remove(); this.entries.splice(i, 1); }
      else if (now > e.until - 0.6 && !e.out) { e.out = true; e.el.classList.add('out'); }
    }
    if (this.cur && now > this.curUntil) {
      const el = this.cur;
      this.cur = null;
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
      this.curUntil = now + 0.25;
    }
    if (!this.cur && this.queue.length && now >= this.curUntil) this.showBanner(this.queue.shift());
    if (this.toastUntil && now > this.toastUntil) { this.toastUntil = 0; this.toastEl.classList.remove('on'); }
  }

  dispose() { this.list.remove(); this.bannerWrap.remove(); this.toastEl.remove(); }
}
