// 结算界面：胜利/失败大字（海克斯纹章动画）+ 双方数据表（KDA、对英雄伤害、承受伤害、金币、补刀）+「再来一局」/「查看战场」
import { h, fmtTime, fmtK, ROLE_LABELS } from './dom.js';
import { iconURL } from './icons.js';

export class EndScreen {
  constructor(ui) {
    this.ui = ui;
    this.el = null;
    this.shown = false;
  }

  show(winner) {
    if (this.shown) return;
    this.shown = true;
    const ui = this.ui;
    const game = ui.game;
    const win = winner === ui.team;
    const me = ui.me;
    const all = game.champions.slice();
    const maxDmg = Math.max(1, ...all.map((c) => c.damageToChampions || 0));
    const maxTaken = Math.max(1, ...all.map((c) => c.damageTaken || 0));
    const table = h('div.end-table', { role: 'table' },
      h('div.et-row.et-headrow', { role: 'row' },
        h('span', '英雄'), h('span', '等级'), h('span', '击杀 / 阵亡 / 助攻'), h('span', '对英雄伤害'), h('span', '承受伤害'), h('span', '金币'), h('span', '补刀'), h('span', '装备')));
    for (const t of [ui.team, 1 - ui.team]) {
      const ts = game.teams[t] || {};
      const won = t === winner;
      table.appendChild(h(`div.et-team.${t === ui.team ? 'ally' : 'enemy'}`,
        h('b', `${t === ui.team ? '我方' : '敌方'} · ${t === 0 ? '蓝色方' : '红色方'}`),
        h('span', won ? '胜利' : '失败'),
        h('span.num', `击杀 ${ts.kills || 0} · 防御塔 ${ts.turretsDestroyed || 0} · 小龙 ${(ts.dragons || []).length} · 男爵 ${ts.baronKills || 0}`)));
      for (const c of all.filter((x) => x.team === t).sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0))) {
        const img = h('img', { alt: '', draggable: 'false' });
        ui.portraits.apply(img, c.championId);
        const items = h('div.et-items');
        for (let i = 0; i < 6; i++) {
          const it = c.items?.[i];
          items.appendChild(h('div.et-item', it?.def ? h('img', { alt: it.def.name, src: iconURL(it.def.icon, 32, { glyph: it.def.name?.[0] }) }) : null));
        }
        const bar = (v, max, cls) => h(`div.et-bar.${cls}`, h('span.num', fmtK(v)), h('i', { style: { width: `${Math.max(2, (v / max) * 100).toFixed(1)}%` } }));
        table.appendChild(h(`div.et-row${c === me ? '.me' : ''}`, { role: 'row' },
          h('div.et-champ', h('div.et-portrait', img), h('div.et-name', h('b', c.def?.name || c.championId), h('small', `${c.summonerName || ''} · ${ROLE_LABELS[c.role] || ''}`))),
          h('span.num', String(c.level)),
          h('span.num.et-kda', `${c.kills} / ${c.deaths} / ${c.assists}`),
          bar(c.damageToChampions || 0, maxDmg, 'dmg'),
          bar(c.damageTaken || 0, maxTaken, 'taken'),
          h('span.num.et-gold', fmtK(c.totalGold || 0)),
          h('span.num', String(c.cs || 0)),
          items));
      }
    }
    const again = h('button.hex-btn.primary.big', { type: 'button' }, h('span', '再来一局'));
    again.addEventListener('click', () => { again.disabled = true; ui.onRestart?.(); });
    const peek = h('button.hex-btn', { type: 'button' }, h('span', '查看战场'));
    const back = h('button.hex-btn.end-back', { type: 'button' }, h('span', '返回结算'));
    const el = h(`div.end.${win ? 'victory' : 'defeat'}`, { role: 'dialog', 'aria-label': win ? '胜利' : '失败' },
      h('div.end-bg'),
      h('div.end-crest',
        h('div.end-ring', h('i.r1'), h('i.r2'), h('i.r3')),
        h('div.end-title', win ? '胜利' : '失败'),
        h('div.end-latin', win ? 'VICTORY' : 'DEFEAT')),
      h('div.end-panel',
        h('div.end-summary', h('span', `对局时长 ${fmtTime(game.time)}`), h('span', me?.controller ? '观战模式' : `${me?.def?.name || ''} · ${me?.kills ?? 0} / ${me?.deaths ?? 0} / ${me?.assists ?? 0}`), h('span', `难度：${{ easy: '新手', normal: '一般', hard: '困难' }[game.difficulty] || '一般'}`)),
        table,
        h('div.end-actions', peek, again)),
      back);
    peek.addEventListener('click', () => el.classList.add('peek'));
    back.addEventListener('click', () => el.classList.remove('peek'));
    ui.screenRoot.appendChild(el);
    this.el = el;
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => again.focus({ preventScroll: true }), 2600);
  }

  dispose() { this.el?.remove(); }
}
