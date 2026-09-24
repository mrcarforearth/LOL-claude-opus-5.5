// HUD：底部主面板（头像/经验环/被动+QWER/召唤师技能/生命与资源条/属性/装备/金币/回城）、Buff 栏、右上比分、左侧队友、左上目标、阵亡与引导条
import {
  h, esc, richText, fmtTime, fmtCd, fmtNum, setText, setStyle, toggle, safeDesc, RESOURCE_LABEL, ROLE_LABELS,
} from './dom.js';
import { iconURL, trinketIconURL, STAT_SVG, RECALL_ICON } from './icons.js';
import { tipCard } from './tooltip.js';
import { TRINKET } from '../config.js';

const SLOTS = ['Q', 'W', 'E', 'R'];
const ITEM_KEYS = ['1', '2', '3', '5', '6', '7'];
const FAIL_TEXT = {
  cooldown: '技能尚未冷却完毕', cost: null, rank: '尚未学习该技能', range: '超出射程', target: '没有有效目标', cc: '受到控制，无法施放',
  dead: '你已阵亡', busy: '正在施法', empty: '该栏位没有可用物品', passive: '该装备没有主动效果', silence: '被沉默，无法施放技能',
};
const STAT_DEFS = [
  ['ad', '攻击力', (s) => fmtNum(s.ad)],
  ['ap', '法术强度', (s) => fmtNum(s.ap)],
  ['armor', '护甲', (s) => fmtNum(s.armor)],
  ['mr', '魔法抗性', (s) => fmtNum(s.mr)],
  ['as', '攻击速度', (s) => (s.attackSpeed || 0).toFixed(2)],
  ['crit', '暴击几率', (s) => `${Math.round((s.crit || 0) * 100)}%`],
  ['haste', '技能急速', (s) => fmtNum(s.abilityHaste || 0)],
  ['ms', '移动速度', (s) => fmtNum(s.moveSpeed)],
];
const TYPE_GLYPH = { minion: '兵', turret: '塔', inhibitor: '晶', nexus: '枢', monster: '怪', ward: '眼', pet: '宠' };

export class Hud {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.input = ui.input;
    this.tip = ui.tooltip;
    this.me = ui.me;
    this.root = h('div.hud');
    ui.root.appendChild(this.root);
    this.slowAcc = 1;
    this.hpTrail = 1;
    this.target = null;
    this.toastUntil = 0;
    this.buildMain();
    this.buildTopRight();
    this.buildTeamFrames();
    this.buildTarget();
    this.buildMisc();
  }

  // —— 底部主面板 ——
  buildMain() {
    const me = this.me;
    const tip = this.tip;
    const main = h('div.hud-main');
    this.main = main;
    // 属性面板
    const stats = h('div.hm-stats');
    this.statEls = {};
    for (const [k, label] of STAT_DEFS) {
      const v = h('span.num');
      const cell = h('div.hs', { html: STAT_SVG[k] || '' }, v);
      tip.bind(cell, () => this.statTip(k, label));
      this.statEls[k] = v;
      stats.appendChild(cell);
    }
    // 头像
    const pImg = h('img', { alt: '', draggable: 'false' });
    this.ui.portraits.apply(pImg, me.championId);
    this.xpArc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('xp-ring');
    const bgc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const c of [bgc, this.xpArc]) { c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', '46'); svg.appendChild(c); }
    bgc.classList.add('xp-bg');
    this.xpArc.classList.add('xp-fg');
    this.levelEl = h('div.hm-level.num', '1');
    this.deathTimer = h('div.hm-dead.num');
    const portrait = h('button.hm-portrait', { type: 'button', 'aria-label': '镜头居中到英雄' }, h('div.hm-pimg', pImg), svg, this.deathTimer, this.levelEl);
    portrait.addEventListener('click', () => { const cam = this.ui.renderer.cameraCtl; if (cam && me.alive) cam.setTarget(me.x, me.y); });
    tip.bind(portrait, () => tipCard({
      title: esc(me.def?.name || ''), sub: esc(me.def?.title || ''),
      meta: [`等级 ${me.level}`, me.level < 18 ? `经验 ${Math.floor(me.xp)} · 距升级 ${Math.ceil(me.xpToNext || 0)}` : '已满级'],
      body: `${esc(ROLE_LABELS[me.role] || '')} · 击杀 ${me.kills} / 阵亡 ${me.deaths} / 助攻 ${me.assists}`,
    }));
    // 技能
    const abil = h('div.hm-abilities');
    this.passiveEl = this.makeSlot('passive', me.passive?.def?.icon, me.passive?.def?.name, '');
    tip.bind(this.passiveEl.root, () => tipCard({ title: esc(me.passive?.def?.name || '被动'), key: '被动', body: richText(safeDesc(me.passive?.def?.desc, me)) }));
    abil.appendChild(this.passiveEl.root);
    this.abEls = {};
    for (const s of SLOTS) {
      const st = me.abilities?.[s];
      const e = this.makeSlot('ability', st?.def?.icon, st?.def?.name, s);
      const up = h('button.lvl-up', { type: 'button', 'aria-label': `升级 ${s}` }, '+');
      up.addEventListener('click', (ev) => { ev.stopPropagation(); this.input.levelUp?.(s); });
      const pips = h('div.pips');
      const max = st?.maxRank ?? (s === 'R' ? 3 : 5);
      for (let i = 0; i < max; i++) pips.appendChild(h('i'));
      e.root.append(up, pips);
      e.up = up; e.pips = pips;
      e.root.addEventListener('click', () => this.input.beginCast?.('ability', s));
      tip.bind(e.root, () => this.abilityTip(s));
      this.abEls[s] = e;
      abil.appendChild(e.root);
    }
    const spells = h('div.hm-spells');
    this.spEls = {};
    for (const k of ['D', 'F']) {
      const st = me.summoners?.[k];
      const e = this.makeSlot('spell', st?.def?.icon, st?.def?.name, k);
      e.root.addEventListener('click', () => this.input.beginCast?.('summoner', k));
      tip.bind(e.root, () => this.summonerTip(k));
      this.spEls[k] = e;
      spells.appendChild(e.root);
    }
    abil.appendChild(spells);
    // 生命/资源条
    const mkBar = (cls) => {
      const fill = h('i.fill'), trail = h('i.trail'), shield = h('i.shield'), text = h('span.bar-text.num'), regen = h('span.bar-regen.num');
      return { root: h(`div.bar.${cls}`, trail, fill, shield, h('i.ticks'), text, regen), fill, trail, shield, text, regen };
    };
    this.hpBar = mkBar('hp');
    this.mpBar = mkBar('mp');
    this.mpBar.root.classList.add(`res-${me.resourceType || 'mana'}`);
    tip.bind(this.hpBar.root, () => tipCard({ title: '生命值', body: `${Math.ceil(me.hp)} / ${Math.round(me.stats.maxHp)}<br>生命回复：每 5 秒 ${fmtNum((me.stats.hpRegen || 0) * 5, 1)}${me.totalShield > 0 ? `<br>护盾：${Math.round(me.totalShield)}` : ''}` }));
    tip.bind(this.mpBar.root, () => tipCard({ title: RESOURCE_LABEL[me.resourceType] || '资源', body: me.resourceType === 'none' ? '该英雄的技能没有资源消耗。' : `${Math.floor(me.mana)} / ${Math.round(me.stats.maxMana)}<br>回复：每 5 秒 ${fmtNum((me.stats.manaRegen || 0) * 5, 1)}` }));
    const center = h('div.hm-center', abil, h('div.hm-bars', this.hpBar.root, this.mpBar.root));
    // 装备
    const inv = h('div.inv-grid');
    this.itemEls = [];
    for (let i = 0; i < 6; i++) {
      const e = this.makeSlot('item', null, '', ITEM_KEYS[i]);
      e.root.addEventListener('click', () => { if (me.items[i]) this.input.beginCast?.('item', i); });
      e.root.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (this.ui.shopPanel?.open && me.items[i]) this.ui.shopPanel.sellSlot(i); });
      tip.bind(e.root, () => this.itemTip(i));
      this.itemEls.push(e);
      inv.appendChild(e.root);
    }
    this.trinketEl = this.makeSlot('trinket', null, '守卫', '4');
    this.trinketEl.img.src = trinketIconURL(64);
    this.trinketEl.root.addEventListener('click', () => this.input.beginCast?.('trinket', 0));
    tip.bind(this.trinketEl.root, () => this.trinketTip());
    const recall = h('button.recall-btn', { type: 'button', 'aria-label': '回城' }, h('img', { alt: '', src: iconURL(RECALL_ICON, 64) }), h('kbd', 'B'));
    recall.addEventListener('click', () => {
      if (!me.alive || me.controller) return;
      if (me.isRecalling) me.cancelRecall?.(); else me.startRecall?.();
    });
    tip.bind(recall, () => tipCard({ title: '回城', key: 'B', body: `引导 ${fmtNum(me.recallDuration?.() ?? 8, 1)} 秒后传送回泉水。移动、受到伤害或施放技能会打断回城。` }));
    this.goldEl = h('span.num', '0');
    const gold = h('button.gold-btn', { type: 'button', 'aria-label': '打开商店' }, h('i.coin'), this.goldEl, h('span.gold-shop', '商店'));
    gold.addEventListener('click', () => this.ui.toggleShop());
    tip.bind(gold, () => tipCard({ title: '金币', key: 'P', body: `当前金币 ${Math.floor(me.gold)}<br>累计获得 ${Math.floor(me.totalGold || 0)}<br>点击或按 P 打开商店${me.canShop ? '' : '（只能在泉水附近购买）'}` }));
    this.goldBtn = gold;
    const side = h('div.inv-side', this.trinketEl.root, recall);
    const invWrap = h('div.hm-inv', h('div.inv-row', inv, side), gold);
    // Buff 栏与施法提示
    this.buffBar = h('div.buff-bar');
    this.buffEls = new Map();
    this.toast = h('div.cast-toast');
    this.channelBar = h('div.channel-bar', h('span.cb-label'), h('div.cb-track', h('i')), h('span.cb-time.num'));
    main.append(stats, h('div.hm-core', portrait, center), invWrap);
    this.root.append(h('div.hud-bottom', this.channelBar, this.toast, this.buffBar, main));
  }

  makeSlot(kind, icon, name, key) {
    const img = h('img', { alt: '', draggable: 'false' });
    if (icon || name) img.src = iconURL(icon, 64, { glyph: name?.[0] });
    const mask = h('i.mask');
    const cd = h('span.cd.num');
    const cnt = h('span.cnt.num');
    const root = h(`div.slot.${kind}`, { tabindex: kind === 'passive' ? null : '0', role: kind === 'passive' ? null : 'button' }, img, mask, cd, cnt);
    if (key && kind !== 'passive') root.appendChild(h('kbd', key));
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); root.click(); } });
    return { root, img, mask, cd, cnt, iconRef: icon };
  }

  // —— 右上 ——
  buildTopRight() {
    this.scoreBlue = h('span.num.sb-b', '0');
    this.scoreRed = h('span.num.sb-r', '0');
    this.kdaEl = h('span.num', '0/0/0');
    this.csEl = h('span.num', '0');
    this.timeEl = h('span.num', '00:00');
    this.fpsEl = h('span.num', '60');
    this.fpsWrap = h('div.tr-cell.fps', h('span.tr-l', 'FPS'), this.fpsEl);
    const el = h('div.hud-top-right',
      h('div.tr-cell.score', h('i.sw'), this.scoreBlue, h('span.vs', 'vs'), this.scoreRed),
      h('div.tr-cell', h('span.tr-l', 'KDA'), this.kdaEl),
      h('div.tr-cell', h('span.tr-l', '补刀'), this.csEl),
      h('div.tr-cell.time', this.timeEl),
      this.fpsWrap);
    this.tip.bind(el, () => tipCard({ title: '对局信息', body: `蓝色方 ${this.game.teams[0].kills} 击杀 · 摧毁 ${this.game.teams[0].turretsDestroyed || 0} 座防御塔<br>红色方 ${this.game.teams[1].kills} 击杀 · 摧毁 ${this.game.teams[1].turretsDestroyed || 0} 座防御塔<br>按住 Tab 查看记分板` }), { place: 'bottom' });
    this.root.appendChild(el);
  }

  // —— 左侧队友 ——
  buildTeamFrames() {
    const wrap = h('div.team-frames');
    this.frames = [];
    const allies = this.game.champions.filter((c) => c.team === this.me.team && c !== this.me).sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
    for (const c of allies) {
      const img = h('img', { alt: '', draggable: 'false' });
      this.ui.portraits.apply(img, c.championId);
      const hp = h('i'), mp = h('i'), lvl = h('span.tf-lvl.num'), dead = h('span.tf-dead.num'), ult = h('i.tf-ult');
      const el = h('div.tf', { tabindex: '0', role: 'button', 'aria-label': c.def?.name },
        h('div.tf-img', img, dead), lvl, ult,
        h('div.tf-bars', h('div.tf-hp', hp), h('div.tf-mp', mp)));
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const cam = this.ui.renderer.cameraCtl;
        if (!cam || !c.alive) return;
        this.peekUnit = c;
        el.setPointerCapture?.(e.pointerId);
      });
      const end = () => { if (this.peekUnit === c) { this.peekUnit = null; this.ui.renderer.cameraCtl?.endPeek?.(); } };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      this.tip.bind(el, () => tipCard({
        title: esc(c.def?.name || ''), sub: esc(c.summonerName || ''),
        meta: [`等级 ${c.level}`, ROLE_LABELS[c.role] || ''],
        body: `${c.kills}/${c.deaths}/${c.assists} · 补刀 ${c.cs}<br>生命 ${Math.ceil(c.hp)} / ${Math.round(c.stats.maxHp)}${c.alive ? '' : `<br>复活倒计时 ${Math.ceil(c.respawnRemaining)} 秒`}`,
        foot: '按住头像可查看该队友',
      }), { place: 'right' });
      wrap.appendChild(el);
      this.frames.push({ c, el, hp, mp, lvl, dead, ult });
    }
    this.root.appendChild(wrap);
  }

  // —— 左上：选中目标 ——
  buildTarget() {
    this.tImg = h('img', { alt: '', draggable: 'false' });
    this.tGlyph = h('div.tg-glyph');
    this.tName = h('div.tg-name');
    this.tSub = h('div.tg-sub');
    this.tHp = h('i');
    this.tShield = h('i.sh');
    this.tHpText = h('span.num');
    this.tMp = h('i');
    this.tStats = h('div.tg-stats');
    this.tItems = h('div.tg-items');
    this.tStatCells = {};
    for (const [k, label] of [['ad', '攻击力'], ['ap', '法术强度'], ['armor', '护甲'], ['mr', '魔抗'], ['as', '攻速'], ['ms', '移速']]) {
      const v = h('span.num');
      this.tStats.appendChild(h('div.hs', { html: STAT_SVG[k] || '', title: label }, v));
      this.tStatCells[k] = v;
    }
    this.tItemImgs = [];
    for (let i = 0; i < 6; i++) { const im = h('img', { alt: '' }); this.tItemImgs.push(im); this.tItems.appendChild(h('div.tg-item', im)); }
    this.targetEl = h('div.target-frame',
      h('div.tg-portrait', this.tImg, this.tGlyph),
      h('div.tg-info', h('div.tg-top', this.tName, this.tSub),
        h('div.tg-hp', this.tHp, this.tShield, this.tHpText), h('div.tg-mp', this.tMp), this.tStats, this.tItems));
    this.root.appendChild(this.targetEl);
  }
  setTarget(u) {
    if (u && (u.type === 'ward' && u.team !== this.me.team && !u.visible?.[this.me.team])) u = null;
    this.target = u || null;
    this._tgId = null;
    this.slowAcc = 1;
  }

  buildMisc() {
    this.deathPanel = h('div.death-panel', h('div.dp-title', '你已阵亡'), h('div.dp-timer.num'), h('div.dp-sub', '复活倒计时'));
    this.root.appendChild(this.deathPanel);
  }

  // —— 提示内容 ——
  abilityTip(s) {
    const me = this.me;
    const st = me.abilities?.[s];
    if (!st?.def) return '';
    const def = st.def;
    const rank = st.rank;
    const r = Math.max(1, rank);
    const max = st.maxRank;
    const meta = [`等级 ${rank}/${max}`];
    const cd = st.cooldownFor?.(r) ?? 0;
    if (cd > 0) meta.push(`冷却 ${fmtNum(cd, 1)} 秒`);
    const cost = st.cost;
    const res = RESOURCE_LABEL[st.costType] || '';
    if (cost > 0 && res) meta.push(`消耗 ${fmtNum(cost)} ${res}`);
    const range = st.range;
    if (range > 0 && range < 20000) meta.push(`射程 ${Math.round(range)}`);
    let foot = '';
    if (rank === 0) foot = s === 'R' ? '6 级后可学习' : '尚未学习';
    if (me.skillPoints > 0 && me.canLevelAbility?.(s)) foot = `点击「+」或按 Ctrl+${s} 升级`;
    if (st.isRecastActive) foot = `可再次施放（剩余 ${fmtNum(st.recastRemaining, 1)} 秒）`;
    if (st.maxCharges) meta.push(`充能 ${st.charges}/${st.maxCharges}`);
    return tipCard({ title: esc(def.name), key: s, meta, body: richText(safeDesc(def.desc, me, r)), foot });
  }
  summonerTip(k) {
    const st = this.me.summoners?.[k];
    if (!st?.def) return '';
    const d = st.def;
    const meta = [`冷却 ${d.rechargeTime || d.cooldown} 秒`];
    if (d.range && d.range < 20000) meta.push(`射程 ${d.range}`);
    if (st.maxCharges) meta.push(`充能 ${st.charges}/${st.maxCharges}`);
    const rem = st.cdRemaining;
    return tipCard({ title: esc(d.name), key: k, meta, body: richText(safeDesc(d.desc, this.me)), foot: rem > 0 && !(st.maxCharges && st.charges > 0) ? `冷却中：${Math.ceil(rem)} 秒` : '' });
  }
  itemTip(i) {
    const it = this.me.items[i];
    if (!it?.def) return '';
    const d = it.def;
    const meta = [`价格 ${d.cost}`];
    const sv = this.ui.shop?.sellValue?.(it);
    if (sv != null) meta.push(`出售 ${sv}`);
    if (it.stacks > 1) meta.push(`数量 ${it.stacks}`);
    if (it.charges != null && d.consumable) meta.push(`剩余 ${it.charges} 次`);
    const rem = it.cooldownUntil ? it.cooldownUntil - this.game.time : 0;
    let foot = '';
    if (d.active) foot = rem > 0 ? `主动冷却中：${Math.ceil(rem)} 秒` : `按 ${ITEM_KEYS[i]} 使用主动效果`;
    else if (d.consumable) foot = `按 ${ITEM_KEYS[i]} 使用`;
    return tipCard({ title: esc(d.name), key: ITEM_KEYS[i], meta, body: richText(d.desc || ''), foot });
  }
  trinketTip() {
    const t = this.me.trinket;
    const rem = t && t.charges < t.maxCharges ? Math.max(0, t.rechargeAt - this.game.time) : 0;
    return tipCard({ title: '守卫饰品', key: '4', meta: [`充能 ${t?.charges ?? 0}/${t?.maxCharges ?? 2}`, `射程 ${TRINKET.RANGE}`],
      body: '在目标位置放置一个隐形守卫，提供 90~120 秒的视野（随等级提升）。最多同时存在 3 个。', foot: rem > 0 ? `下一次充能：${Math.ceil(rem)} 秒` : '' });
  }
  statTip(k, label) {
    const s = this.me.stats;
    const red = (v) => `${Math.round((v / (100 + Math.max(0, v))) * 100)}%`;
    const map = {
      ad: `攻击力 ${fmtNum(s.ad)}（基础 ${fmtNum(s.baseAd ?? s.ad)} + 额外 ${fmtNum(s.bonusAd || 0)}）<br>穿甲 ${fmtNum(s.lethality || 0)} · 护甲穿透 ${Math.round((s.armorPenPct || 0) * 100)}%<br>生命偷取 ${Math.round((s.lifeSteal || 0) * 100)}%`,
      ap: `法术强度 ${fmtNum(s.ap)}<br>法术穿透 ${fmtNum(s.magicPen || 0)} · ${Math.round((s.magicPenPct || 0) * 100)}%<br>全能吸血 ${Math.round((s.omnivamp || 0) * 100)}%`,
      armor: `护甲 ${fmtNum(s.armor)}<br>受到的物理伤害降低 ${red(s.armor)}`,
      mr: `魔法抗性 ${fmtNum(s.mr)}<br>受到的魔法伤害降低 ${red(s.mr)}`,
      as: `攻击速度 ${(s.attackSpeed || 0).toFixed(3)} 次/秒<br>额外攻速 ${Math.round((s.bonusAS || 0) * 100)}%<br>攻击距离 ${Math.round(s.attackRange || 0)}`,
      crit: `暴击几率 ${Math.round((s.crit || 0) * 100)}%<br>暴击伤害 ${Math.round((s.critMult || 1.75) * 100)}%`,
      haste: `技能急速 ${fmtNum(s.abilityHaste || 0)}<br>技能冷却缩短 ${Math.round((1 - 100 / (100 + (s.abilityHaste || 0))) * 100)}%<br>韧性 ${Math.round((s.tenacity || 0) * 100)}%`,
      ms: `移动速度 ${fmtNum(s.moveSpeed)}${s.slow ? `<br>受到减速 ${Math.round(s.slow * 100)}%` : ''}`,
    };
    return tipCard({ title: label, body: map[k] || '' });
  }

  // —— 事件 ——
  castFail(e) {
    const now = performance.now();
    if (now < this.toastUntil - 1800 && this._lastFail === e.reason) return;
    let text = FAIL_TEXT[e.reason] ?? '无法施放';
    if (e.reason === 'cost') text = `${RESOURCE_LABEL[this.me.resourceType] || '法力'}不足`;
    if (e.reason === 'cooldown' && e.kind === 'summoner') text = '召唤师技能尚未冷却完毕';
    if (e.reason === 'cooldown' && e.kind === 'item') text = '装备尚未冷却完毕';
    if (e.reason === 'cooldown' && e.kind === 'trinket') text = '守卫饰品没有充能';
    if (!text) return;
    this._lastFail = e.reason;
    this.toast.textContent = text;
    this.toast.classList.remove('on'); void this.toast.offsetWidth; this.toast.classList.add('on');
    this.toastUntil = now + 2000;
    const el = e.kind === 'ability' ? this.abEls[e.slot] : e.kind === 'summoner' ? this.spEls[e.slot] : e.kind === 'item' ? this.itemEls[e.slot] : e.kind === 'trinket' ? this.trinketEl : null;
    if (el) { el.root.classList.remove('shake'); void el.root.offsetWidth; el.root.classList.add('shake'); }
  }
  flashSlot(kind, slot) {
    const el = kind === 'ability' ? this.abEls[slot] : this.spEls[slot];
    if (!el) return;
    el.root.classList.remove('flash'); void el.root.offsetWidth; el.root.classList.add('flash');
  }

  // —— 每帧 ——
  update(dt) {
    const me = this.me;
    const game = this.game;
    const now = game.time;
    this.slowAcc += dt;
    const slow = this.slowAcc >= 0.1;
    if (slow) this.slowAcc = 0;
    // 冷却遮罩（每帧）与文本（10Hz）
    const pc = this.input?.pendingCast;
    const canCast = me.alive && (me.canCast?.() ?? true);
    for (const s of SLOTS) {
      const st = me.abilities?.[s];
      const e = this.abEls[s];
      if (!st) continue;
      let frac = 0;
      const rem = st.cdRemaining;
      const recast = st.isRecastActive;
      if (st.rank > 0 && rem > 0 && !recast && !(st.maxCharges && st.charges > 0)) frac = st.cdDuration > 0 ? Math.min(1, rem / st.cdDuration) : 0;
      setStyle(e.mask, '--p', frac.toFixed(3));
      if (slow) {
        setText(e.cd, frac > 0 ? fmtCd(rem) : '');
        const learned = st.rank > 0;
        toggle(e.root, 'unlearned', !learned);
        toggle(e.root, 'oncd', frac > 0);
        const res = st.costType;
        const noRes = learned && res !== 'none' && res !== 'hp' && st.cost > 0 && me.mana + 1e-6 < st.cost && !recast;
        toggle(e.root, 'nomana', noRes);
        toggle(e.root, 'recast', recast);
        toggle(e.root, 'toggled', !!st.toggled);
        toggle(e.root, 'locked', learned && !canCast);
        const canUp = me.skillPoints > 0 && !!me.canLevelAbility?.(s) && !me.controller;
        toggle(e.root, 'can-up', canUp);
        toggle(e.root, 'pending', !!(pc && pc.kind === 'ability' && pc.slot === s));
        const pips = e.pips.children;
        for (let i = 0; i < pips.length; i++) toggle(pips[i], 'on', i < st.rank);
        setText(e.cnt, st.maxCharges && learned ? String(st.charges) : '');
      }
    }
    for (const k of ['D', 'F']) {
      const st = me.summoners?.[k];
      const e = this.spEls[k];
      if (!st) continue;
      const rem = st.cdRemaining;
      const hasCharge = st.maxCharges && st.charges > 0;
      const frac = rem > 0 && !hasCharge && st.cdDuration > 0 ? Math.min(1, rem / st.cdDuration) : 0;
      setStyle(e.mask, '--p', frac.toFixed(3));
      if (slow) {
        setText(e.cd, frac > 0 ? fmtCd(rem) : '');
        toggle(e.root, 'oncd', frac > 0);
        setText(e.cnt, st.maxCharges ? String(st.charges) : '');
        toggle(e.root, 'pending', !!(pc && pc.kind === 'summoner' && pc.slot === k));
        if (st.def !== e.defRef) { e.defRef = st.def; e.img.src = iconURL(st.def?.icon, 64, { glyph: st.def?.name?.[0] }); }
      }
    }
    for (let i = 0; i < 6; i++) {
      const it = me.items[i];
      const e = this.itemEls[i];
      let frac = 0, rem = 0;
      if (it && it.cooldownUntil > now) {
        rem = it.cooldownUntil - now;
        const total = it.cdDuration || it.def?.active?.cooldown || it.def?.consumable?.cooldown || rem;
        frac = Math.min(1, rem / Math.max(0.01, total));
      }
      setStyle(e.mask, '--p', frac.toFixed(3));
      if (slow) {
        const id = it?.id || null;
        if (e.idRef !== id) {
          e.idRef = id;
          if (it?.def) e.img.src = iconURL(it.def.icon, 64, { glyph: it.def.name?.[0] });
          else e.img.removeAttribute('src');
          toggle(e.root, 'empty', !it);
          toggle(e.root, 'usable', !!(it?.def?.active || it?.def?.consumable));
        }
        setText(e.cd, frac > 0 ? fmtCd(rem) : '');
        const n = it ? (it.stacks > 1 ? it.stacks : (it.def?.consumable && it.charges != null && (it.def.consumable.charges || 0) > 1 ? it.charges : '')) : '';
        setText(e.cnt, n === '' ? '' : String(n));
      }
    }
    {
      const t = me.trinket;
      const e = this.trinketEl;
      let frac = 0, rem = 0;
      if (t && t.charges < t.maxCharges && t.rechargeAt > now) {
        rem = t.rechargeAt - now;
        const L = Math.max(1, Math.min(18, me.level));
        const total = TRINKET.RECHARGE_L1 + ((TRINKET.RECHARGE_L18 - TRINKET.RECHARGE_L1) * (L - 1)) / 17;
        frac = t.charges <= 0 ? Math.min(1, rem / total) : 0;
      }
      setStyle(e.mask, '--p', frac.toFixed(3));
      if (slow) { setText(e.cd, frac > 0 ? fmtCd(rem) : ''); setText(e.cnt, t ? String(t.charges) : ''); }
    }
    // 生命条（每帧，transform）
    const st = me.stats || {};
    const maxHp = Math.max(1, st.maxHp || 1);
    const shield = me.totalShield || 0;
    const total = Math.max(maxHp, me.hp + shield);
    const hpF = Math.max(0, me.hp) / total;
    const shF = shield / total;
    if (hpF > this.hpTrail) this.hpTrail = hpF;
    else this.hpTrail += (hpF - this.hpTrail) * Math.min(1, dt * 3);
    setStyle(this.hpBar.fill, 'transform', `scaleX(${hpF.toFixed(4)})`);
    setStyle(this.hpBar.trail, 'transform', `scaleX(${this.hpTrail.toFixed(4)})`);
    setStyle(this.hpBar.shield, 'transform', `translateX(${(hpF * 100).toFixed(2)}%) scaleX(${shF.toFixed(4)})`);
    const maxMp = Math.max(1, st.maxMana || 1);
    const noRes = me.resourceType === 'none';
    setStyle(this.mpBar.fill, 'transform', `scaleX(${noRes ? 1 : Math.max(0, Math.min(1, me.mana / maxMp)).toFixed(4)})`);
    // 引导条（回城/传送）
    const ch = me.channel;
    if (ch && ch.duration > 0.3 && me.alive) {
      toggle(this.channelBar, 'on', true);
      setStyle(this.channelBar.children[1].firstChild, 'transform', `scaleX(${(ch.progress ?? 0).toFixed(3)})`);
      if (slow) {
        setText(this.channelBar.children[0], ch.id === 'recall' ? '回城' : ch.id === 'teleport' ? '传送' : '引导中');
        setText(this.channelBar.children[2], fmtNum(ch.remaining ?? 0, 1));
      }
    } else toggle(this.channelBar, 'on', false);
    // 镜头预览队友
    if (this.peekUnit) {
      const c = this.peekUnit;
      if (c.alive) this.ui.renderer.cameraCtl?.peek?.(c.x, c.y); else { this.peekUnit = null; this.ui.renderer.cameraCtl?.endPeek?.(); }
    }
    if (!slow) return;
    this.slowUpdate();
  }

  slowUpdate() {
    const me = this.me;
    const game = this.game;
    const s = me.stats || {};
    // 属性
    for (const [k, , f] of STAT_DEFS) setText(this.statEls[k], f(s));
    // 头像
    setText(this.levelEl, me.level);
    const xpP = me.level >= 18 ? 1 : Math.max(0, Math.min(1, me.xpProgress || 0));
    setStyle(this.xpArc, 'stroke-dashoffset', (289 * (1 - xpP)).toFixed(1));
    const dead = !me.alive;
    toggle(this.main, 'dead', dead);
    setText(this.deathTimer, dead ? Math.ceil(me.respawnRemaining || 0) : '');
    // 数值
    const maxHp = Math.round(s.maxHp || 0);
    setText(this.hpBar.text, `${Math.ceil(Math.max(0, me.hp))} / ${maxHp}`);
    const regen = (s.hpRegen || 0) * 5;
    setText(this.hpBar.regen, me.hp < s.maxHp - 0.5 && regen > 0 ? `+${fmtNum(regen, 1)}` : '');
    if (me.resourceType === 'none') setText(this.mpBar.text, '');
    else setText(this.mpBar.text, `${Math.floor(Math.max(0, me.mana))} / ${Math.round(s.maxMana || 0)}`);
    const mregen = (s.manaRegen || 0) * 5;
    setText(this.mpBar.regen, me.resourceType !== 'none' && me.mana < s.maxMana - 0.5 && mregen > 0 ? `+${fmtNum(mregen, 1)}` : '');
    // 生命刻度：每 100 生命一格（通过背景重复尺寸）
    setStyle(this.hpBar.root, '--tick', `${Math.max(2, (100 / Math.max(maxHp, 1)) * 100).toFixed(3)}%`);
    // 金币
    setText(this.goldEl, Math.floor(me.gold));
    toggle(this.goldBtn, 'shoppable', me.canShop);
    // Buff
    this.updateBuffs();
    // 右上
    setText(this.scoreBlue, game.teams[this.me.team]?.kills ?? 0);
    setText(this.scoreRed, game.teams[1 - this.me.team]?.kills ?? 0);
    setText(this.kdaEl, `${me.kills}/${me.deaths}/${me.assists}`);
    setText(this.csEl, me.cs);
    setText(this.timeEl, fmtTime(game.time));
    const showFps = this.ui.settings.showFps;
    toggle(this.fpsWrap, 'hide', !showFps);
    if (showFps) setText(this.fpsEl, Math.round(window.__perf?.fps || this.ui.fps || 0));
    // 队友
    for (const f of this.frames) {
      const c = f.c;
      setStyle(f.hp, 'transform', `scaleX(${Math.max(0, Math.min(1, c.hp / Math.max(1, c.stats.maxHp))).toFixed(3)})`);
      setStyle(f.mp, 'transform', `scaleX(${c.resourceType === 'none' ? 0 : Math.max(0, Math.min(1, c.mana / Math.max(1, c.stats.maxMana))).toFixed(3)})`);
      setText(f.lvl, c.level);
      toggle(f.el, 'dead', !c.alive);
      setText(f.dead, c.alive ? '' : Math.ceil(c.respawnRemaining || 0));
      const r = c.abilities?.R;
      toggle(f.ult, 'ready', !!(r && r.rank > 0 && r.ready));
      toggle(f.ult, 'learned', !!(r && r.rank > 0));
      toggle(f.el, 'low', c.alive && c.hp / c.stats.maxHp < 0.3);
    }
    this.updateTarget();
    // 阵亡面板
    toggle(this.deathPanel, 'on', dead && !game.over);
    if (dead) setText(this.deathPanel.children[1], Math.ceil(me.respawnRemaining || 0));
  }

  updateBuffs() {
    const me = this.me;
    const seen = new Set();
    let n = 0;
    const list = me.buffs || [];
    for (const b of list) {
      if (!b || b.hidden || n >= 16) continue;
      n++;
      seen.add(b);
      let e = this.buffEls.get(b);
      if (!e) {
        const img = h('img', { alt: '', src: iconURL(b.icon, 48, { glyph: (b.name || '?')[0] }) });
        const time = h('span.bt.num'), stk = h('span.bs.num'), ring = h('i.bm');
        const root = h(`div.buff${b.isDebuff ? '.debuff' : ''}`, img, ring, time, stk);
        this.tip.bind(root, () => tipCard({
          title: esc(b.name || '效果'), sub: b.isDebuff ? '<span class="bad">减益效果</span>' : '<span class="good">增益效果</span>',
          meta: [Number.isFinite(b.remaining) ? `剩余 ${fmtNum(b.remaining, 1)} 秒` : '持续生效', b.stacks > 1 ? `${b.stacks} 层` : ''],
          body: richText(typeof b.desc === 'function' ? safeDesc(b.desc, me, b) : b.desc || ''),
        }));
        e = { root, time, stk, ring };
        this.buffEls.set(b, e);
        if (b.isDebuff) this.buffBar.appendChild(root); else this.buffBar.insertBefore(root, this.buffBar.querySelector('.debuff'));
      }
      const rem = b.remaining;
      const fin = Number.isFinite(rem) && Number.isFinite(b.duration) && b.duration > 0;
      setText(e.time, fin ? (rem >= 60 ? `${Math.ceil(rem / 60)}m` : fmtCd(rem)) : '');
      setStyle(e.ring, '--p', fin ? (1 - Math.max(0, Math.min(1, rem / b.duration))).toFixed(3) : '0');
      setText(e.stk, b.stacks > 1 ? String(b.stacks) : '');
      toggle(e.root, 'ending', fin && rem < 3);
    }
    for (const [b, e] of this.buffEls) if (!seen.has(b)) { e.root.remove(); this.buffEls.delete(b); }
  }

  updateTarget() {
    let u = this.target;
    const pt = this.me.team;
    if (u && (!u.alive || u.removed || (u.team !== pt && u.type !== 'turret' && u.type !== 'inhibitor' && u.type !== 'nexus' && !u.visible?.[pt] && !this.ui.renderer.revealAll))) {
      this.target = u = null;
    }
    toggle(this.targetEl, 'on', !!u);
    if (!u) return;
    if (this._tgId !== u.id) {
      this._tgId = u.id;
      const isChamp = u.type === 'champion';
      const champId = isChamp ? u.championId : (u.type === 'pet' && u.owner?.championId && u.modelId === u.owner.championId ? u.owner.championId : null);
      if (champId) { this.tImg.hidden = false; this.tGlyph.hidden = true; this.ui.portraits.apply(this.tImg, champId); }
      else {
        this.tImg.hidden = true; this.tGlyph.hidden = false;
        this.tGlyph.textContent = (u.type === 'monster' && u.name ? u.name[0] : TYPE_GLYPH[u.type]) || '?';
      }
      setText(this.tName, isChamp ? (u.def?.name || u.name) : (u.name || TYPE_GLYPH[u.type] || ''));
      const rel = u.team === pt ? 'ally' : u.team === 2 || u.type === 'monster' ? 'neutral' : 'enemy';
      this.targetEl.dataset.rel = u === this.me ? 'self' : rel;
      toggle(this.tItems, 'hide', !isChamp);
    }
    const s = u.stats || {};
    const maxHp = Math.max(1, s.maxHp || u.maxHp || 1);
    const sh = u.totalShield || 0;
    const tot = Math.max(maxHp, u.hp + sh);
    setStyle(this.tHp, 'transform', `scaleX(${(Math.max(0, u.hp) / tot).toFixed(3)})`);
    setStyle(this.tShield, 'transform', `translateX(${((Math.max(0, u.hp) / tot) * 100).toFixed(2)}%) scaleX(${(sh / tot).toFixed(3)})`);
    setText(this.tHpText, `${Math.ceil(Math.max(0, u.hp))} / ${Math.round(maxHp)}`);
    const hasMp = u.type === 'champion' && u.resourceType !== 'none';
    toggle(this.tMp.parentNode, 'hide', !hasMp);
    if (hasMp) setStyle(this.tMp, 'transform', `scaleX(${Math.max(0, Math.min(1, u.mana / Math.max(1, s.maxMana))).toFixed(3)})`);
    const lvl = u.level ? `等级 ${u.level}` : '';
    const extra = u.type === 'turret' ? ({ outer: '外塔', inner: '内塔', inhib: '高地塔', nexus: '枢纽塔' }[u.tier] || '防御塔') : u.type === 'minion' ? '小兵' : u.type === 'inhibitor' ? '召唤水晶' : u.type === 'nexus' ? '水晶枢纽' : u.type === 'monster' ? '野怪' : '';
    setText(this.tSub, [lvl, extra, u.invulnerable ? '无敌' : ''].filter(Boolean).join(' · '));
    setText(this.tStatCells.ad, fmtNum(s.ad || 0));
    setText(this.tStatCells.ap, fmtNum(s.ap || 0));
    setText(this.tStatCells.armor, fmtNum(s.armor || 0));
    setText(this.tStatCells.mr, fmtNum(s.mr || 0));
    setText(this.tStatCells.as, (s.attackSpeed || 0).toFixed(2));
    setText(this.tStatCells.ms, fmtNum(s.moveSpeed || 0));
    if (u.type === 'champion') {
      for (let i = 0; i < 6; i++) {
        const it = u.items?.[i];
        const im = this.tItemImgs[i];
        const id = it?.id || '';
        if (im._id !== id) { im._id = id; if (it?.def) im.src = iconURL(it.def.icon, 40, { glyph: it.def.name?.[0] }); else im.removeAttribute('src'); }
      }
    }
  }

  dispose() { this.root.remove(); }
}
