// 记分板（按住 Tab）：两队 10 人（头像/等级/召唤师技能/KDA/补刀/装备），队伍总击杀、推塔、小龙（按元素）、男爵、先锋，对局时间
import { h, setText, toggle, fmtTime, DRAGON_META, ROLE_LABELS } from './dom.js';
import { iconURL, trinketIconURL } from './icons.js';

export class Scoreboard {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.team = ui.team;
    this.visible = false;
    this.acc = 1;
    this.rows = [];
    this.heads = [];
    this.timeEl = h('div.sb-time.num', '00:00');
    const teams = [this.team, 1 - this.team];
    const cols = teams.map((t) => this.buildTeam(t));
    this.el = h('div.scoreboard', { role: 'dialog', 'aria-label': '记分板' },
      h('i.hx-c.tl'), h('i.hx-c.tr'), h('i.hx-c.bl'), h('i.hx-c.br'),
      h('header.sb-top', h('div.panel-title', '记分板'), this.timeEl, h('div.sb-keyhint', '松开 Tab 关闭')),
      ...cols);
    this.wrap = h('div.sb-layer', this.el);
    ui.root.appendChild(this.wrap);
  }

  buildTeam(t) {
    const mine = t === this.team;
    const kills = h('span.num.sbh-kills', '0');
    const towers = h('span.num', '0');
    const inhibs = h('span.num', '0');
    const barons = h('span.num', '0');
    const heralds = h('span.num', '0');
    const dragons = h('div.sbh-dragons');
    const gold = h('span.num', '0');
    this.heads.push({ t, kills, towers, inhibs, barons, heralds, dragons, gold, dragonKey: '' });
    const head = h(`div.sb-head.${mine ? 'ally' : 'enemy'}`,
      h('div.sbh-name', h('span', mine ? '我方' : '敌方'), h('small', t === 0 ? '蓝色方' : '红色方')),
      h('div.sbh-stat', { title: '击杀' }, h('i.ico.kill'), kills),
      h('div.sbh-stat', { title: '摧毁防御塔' }, h('i.ico.tower'), towers),
      h('div.sbh-stat', { title: '摧毁召唤水晶' }, h('i.ico.inhib'), inhibs),
      h('div.sbh-stat', { title: '峡谷先锋' }, h('i.ico.herald'), heralds),
      h('div.sbh-stat', { title: '纳什男爵' }, h('i.ico.baron'), barons),
      dragons,
      h('div.sbh-stat.gold', { title: '队伍总金币' }, h('i.coin'), gold));
    const body = h('div.sb-rows');
    const list = this.game.champions.filter((c) => c.team === t).sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
    for (const c of list) {
      const img = h('img', { alt: '', draggable: 'false' });
      this.ui.portraits.apply(img, c.championId);
      const lvl = h('span.sbr-lvl.num');
      const dead = h('span.sbr-dead.num');
      const spells = h('div.sbr-spells');
      for (const k of ['D', 'F']) {
        const d = c.summoners?.[k]?.def;
        spells.appendChild(h('img', { alt: d?.name || '', src: iconURL(d?.icon, 32, { glyph: d?.name?.[0] || k }) }));
      }
      const items = h('div.sbr-items');
      const itemImgs = [];
      for (let i = 0; i < 6; i++) { const im = h('img', { alt: '' }); itemImgs.push(im); items.appendChild(h('div.sbr-item', im)); }
      items.appendChild(h('div.sbr-item.trinket', h('img', { alt: '', src: trinketIconURL(32) })));
      const kda = h('span.num.sbr-kda');
      const cs = h('span.num.sbr-cs');
      const name = h('div.sbr-name', h('b', c.def?.name || c.championId), h('small', `${c.summonerName || ''} · ${ROLE_LABELS[c.role] || ''}`));
      const row = h(`div.sb-row${c === this.ui.me ? '.me' : ''}`,
        h('div.sbr-portrait', img, lvl, dead), spells, name, items, kda, cs);
      row.addEventListener('click', () => {
        // 观战/解锁镜头时点击行跳转镜头
        const cam = this.ui.renderer?.cameraCtl;
        if (cam && c.alive && (!cam.locked || this.ui.me?.controller)) { cam.setLocked?.(false); cam.setTarget(c.x, c.y); }
      });
      this.rows.push({ c, row, lvl, dead, kda, cs, itemImgs });
      body.appendChild(row);
    }
    return h(`section.sb-team.${mine ? 'ally' : 'enemy'}`, head,
      h('div.sb-colhead', h('span', '英雄'), h('span', ''), h('span', ''), h('span', '装备'), h('span', 'KDA'), h('span', '补刀')), body);
  }

  show(on) {
    on = !!on && !this.game.over;
    if (on === this.visible) return;
    this.visible = on;
    toggle(this.wrap, 'on', on);
    if (on) { this.acc = 1; this.update(0); }
  }

  update(dt) {
    if (!this.visible) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const game = this.game;
    setText(this.timeEl, fmtTime(game.time));
    for (const hd of this.heads) {
      const ts = game.teams[hd.t] || {};
      setText(hd.kills, ts.kills || 0);
      setText(hd.towers, ts.turretsDestroyed || 0);
      setText(hd.inhibs, ts.inhibsDestroyed || 0);
      setText(hd.barons, ts.baronKills || 0);
      setText(hd.heralds, ts.heraldKills || 0);
      let g = 0;
      for (const c of game.champions) if (c.team === hd.t) g += c.totalGold || 0;
      setText(hd.gold, g >= 1000 ? `${(g / 1000).toFixed(1)}k` : Math.floor(g));
      const drs = ts.dragons || [];
      const key = drs.join(',');
      if (key !== hd.dragonKey) {
        hd.dragonKey = key;
        hd.dragons.replaceChildren(...drs.map((d) => {
          const el = h('i.sbh-dragon', { title: DRAGON_META[d]?.name || '亚龙' });
          el.style.setProperty('--dc', DRAGON_META[d]?.color || '#ff8a3a');
          return el;
        }));
      }
    }
    for (const r of this.rows) {
      const c = r.c;
      setText(r.lvl, c.level);
      setText(r.dead, c.alive ? '' : Math.ceil(c.respawnRemaining || 0));
      toggle(r.row, 'dead', !c.alive);
      setText(r.kda, `${c.kills} / ${c.deaths} / ${c.assists}`);
      setText(r.cs, c.cs);
      for (let i = 0; i < 6; i++) {
        const it = c.items?.[i];
        const im = r.itemImgs[i];
        const id = it?.id || '';
        if (im._id !== id) { im._id = id; if (it?.def) im.src = iconURL(it.def.icon, 40, { glyph: it.def.name?.[0] }); else im.removeAttribute('src'); }
      }
    }
  }

  dispose() { this.wrap.remove(); }
}
