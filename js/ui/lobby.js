// 局域网对战大厅（海克斯科技风）：昵称、双方 5 个槽位（空位由人机补齐）、阵营/英雄/位置/召唤师技能、准备、房主设置难度并开始对局
import { h, ROLE_LABELS, ROLE_ORDER, DIFF_LABELS, loadJSON, saveJSON, PortraitStore } from './dom.js';
import { iconURL } from './icons.js';
import { NetClient, lanWsUrl } from '../net/client.js';
import { probeLan } from './champselect.js';

const LAN_KEY = 'riftclash.lan.v1';
const SPELL_ORDER = ['flash', 'ignite', 'heal', 'barrier', 'exhaust', 'ghost', 'cleanse', 'smite', 'teleport'];
const roleText = (r) => (r === 'adc' ? 'ADC' : ROLE_LABELS[r] || r);

/**
 * 显示大厅；房主开始后 resolve { client, localId, config, seed, tickRate }（config 为服务器下发的 Config）。
 * 连接失败或被拒绝时在界面上提示，并提供「返回」（刷新页面）。
 */
export function showLobby(root, { champions, summoners, renderPortrait, initial = {} } = {}) {
  const CH = champions || {};
  const SP = summoners || {};
  const ids = Object.keys(CH);
  const spellIds = SPELL_ORDER.filter((s) => SP[s]).concat(Object.keys(SP).filter((s) => !SPELL_ORDER.includes(s)));
  const store = new PortraitStore(renderPortrait, CH);
  const saved = loadJSON(LAN_KEY, {});
  const st = { id: null, hostId: null, players: [], settings: { difficulty: 'normal' }, spellSlot: 1, joined: false, starting: false };
  const client = new NetClient(lanWsUrl());

  return new Promise((resolve) => {
    const el = h('div.lb', { role: 'dialog', 'aria-label': '局域网对战大厅' });
    const status = h('div.lb-status');
    const shareBox = h('div.lb-share', h('span.lb-share-label', '分享地址'), h('span.lb-share-url', '正在获取…'));
    el.append(
      h('div.lb-bg'),
      h('header.lb-top',
        h('div.cs-brand', h('div.cs-logo', '峡谷对决'), h('div.cs-logo-sub', 'LAN LOBBY · 局域网对战大厅')),
        shareBox),
    );
    const blueCol = h('section.lb-team.blue');
    const redCol = h('section.lb-team.red');
    const mid = h('section.lb-mid');
    el.appendChild(h('main.lb-main', blueCol, mid, redCol));
    const backBtn = h('button.hex-btn.sm', { type: 'button' }, h('span', '返回'));
    backBtn.addEventListener('click', () => { try { client.close(); } catch { /* 忽略 */ } location.reload(); });
    el.appendChild(h('footer.lb-foot', backBtn, status, h('span.lb-foot-note', '非官方同人作品 · 空位由人机补齐 · 局域网对战固定 1 倍速且不可暂停')));
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));

    // 分享地址
    probeLan().then((info) => {
      const urls = info?.urls?.length ? info.urls : [`${location.origin}/index.html`];
      const span = shareBox.querySelector('.lb-share-url');
      span.textContent = urls.join('　');
      span.title = '同一局域网的朋友在浏览器中打开此地址即可加入';
    });

    let statusTimer = 0;
    const say = (text, kind = '', seconds = 0) => {
      status.textContent = text;
      status.className = `lb-status ${kind}`;
      clearTimeout(statusTimer);
      if (seconds > 0) statusTimer = setTimeout(() => { status.textContent = ''; status.className = 'lb-status'; }, seconds * 1000);
    };

    // —— 加入前：昵称 ——
    const nameInput = h('input.lb-name', { type: 'text', maxlength: '16', placeholder: '输入昵称', value: saved.name || '' });
    const joinBtn = h('button.hex-btn.primary', { type: 'button' }, h('span', '加入大厅'));
    const joinPanel = h('div.lb-join',
      h('div.cs-sec-title', '你的昵称'), nameInput, joinBtn,
      h('div.cs-note', '加入后可以在左右两侧选择阵营与位置；空位在开局时由人机补齐。'));
    mid.appendChild(joinPanel);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); e.stopPropagation(); });
    joinBtn.addEventListener('click', () => join());
    setTimeout(() => nameInput.focus({ preventScroll: true }), 60);

    async function join() {
      if (st.joined) return;
      const name = nameInput.value.trim().slice(0, 16);
      if (!name) { say('请输入昵称', 'bad', 2); nameInput.focus(); return; }
      saveJSON(LAN_KEY, { ...saved, name });
      joinBtn.disabled = true;
      say('正在连接局域网服务…');
      try {
        await client.connect(5000);
      } catch (err) {
        joinBtn.disabled = false;
        say(`无法连接局域网服务：${err?.message || err}。请确认服务器（node server.mjs）仍在运行。`, 'bad');
        return;
      }
      st.joined = true;
      client.send({ type: 'hello', name, championId: initial.championId, role: initial.role, summoners: initial.summoners, team: initial.team });
      say('');
    }

    // —— 消息 ——
    client.on('welcome', (m) => { st.id = m.id; st.hostId = m.hostId; });
    client.on('lobby', (m) => { st.players = m.players || []; st.hostId = m.hostId; st.settings = m.settings || st.settings; render(); });
    client.on('error', (m) => say(m.msg || '操作失败', 'bad', 3));
    client.on('busy', (m) => fatal(m.msg || '对局进行中，请等待本局结束后再加入'));
    client.on('full', (m) => fatal(m.msg || '房间已满'));
    client.on('close', () => { if (!st.starting) fatal('与局域网服务器的连接已断开'); });
    client.on('start', (m) => {
      if (st.starting) return;
      st.starting = true;
      say('对局即将开始…', 'good');
      el.classList.add('leaving');
      setTimeout(() => {
        el.remove();
        resolve({ client, localId: st.id, config: m.config, seed: m.seed, tickRate: m.tickRate || 30 });
      }, 380);
    });
    function fatal(text) {
      say(text, 'bad');
      joinBtn.disabled = true;
      mid.innerHTML = '';
      const again = h('button.hex-btn.primary', { type: 'button' }, h('span', '返回选人界面'));
      again.addEventListener('click', () => location.reload());
      mid.appendChild(h('div.lb-join', h('div.lb-fatal', text), again));
    }

    // —— 渲染 ——
    const me = () => st.players.find((p) => p.id === st.id) || null;
    function slotEl(team, role) {
      const p = st.players.find((x) => x.team === team && x.role === role);
      if (!p) {
        const b = h('button.lb-slot.empty', { type: 'button', title: '点击加入此位置' },
          h('div.lb-slot-role', roleText(role)),
          h('div.lb-slot-ai', h('b', '人机'), h('small', `电脑 · ${DIFF_LABELS[st.settings.difficulty] || '一般'}`)),
          h('div.lb-slot-join', '加入'));
        b.addEventListener('click', () => { if (st.joined) client.send({ type: 'pick', team, role }); });
        return b;
      }
      const def = CH[p.championId] || {};
      const img = h('img', { alt: '', draggable: 'false' });
      store.apply(img, p.championId);
      const spells = h('div.lb-slot-spells', ...(p.summoners || []).map((sid) => h('img', { alt: SP[sid]?.name || sid, src: iconURL(SP[sid]?.icon, 32, { glyph: SP[sid]?.name?.[0] }) })));
      const tags = [];
      if (p.id === st.hostId) tags.push(h('span.lb-tag.host', '房主'));
      if (p.id === st.id) tags.push(h('span.lb-tag.me', '你'));
      return h(`div.lb-slot${p.id === st.id ? '.me' : ''}${p.ready || p.id === st.hostId ? '.ready' : ''}`,
        h('div.lb-slot-role', roleText(role)),
        h('div.lb-slot-img', img),
        h('div.lb-slot-info', h('b', p.name, ...tags), h('small', def.name || p.championId)),
        spells,
        h('div.lb-slot-state', p.id === st.hostId ? '房主' : p.ready ? '已准备' : '未准备'));
    }
    function teamCol(col, team) {
      col.innerHTML = '';
      const n = st.players.filter((p) => p.team === team).length;
      col.appendChild(h('div.lb-team-head', h('span', team === 0 ? '蓝色方' : '红色方'), h('small.num', `${n} / 5 名玩家`)));
      for (const r of ROLE_ORDER) col.appendChild(slotEl(team, r));
    }
    function render() {
      teamCol(blueCol, 0);
      teamCol(redCol, 1);
      const m = me();
      if (!m) return;
      mid.innerHTML = '';
      const isHost = st.id === st.hostId;
      // 英雄
      const grid = h('div.cs-grid.lb-grid');
      for (const id of ids) {
        const owner = st.players.find((p) => p.championId === id && p.id !== st.id);
        const img = h('img', { alt: '', draggable: 'false' });
        store.apply(img, id);
        const card = h(`button.cs-card${id === m.championId ? '.on' : ''}${owner ? '.taken' : ''}`, { type: 'button', disabled: owner ? true : null, title: owner ? `已被 ${owner.name} 选择` : (CH[id].roles || []).map(roleText).join(' / ') },
          h('div.cs-card-img', img), h('div.cs-card-name', CH[id].name));
        card.addEventListener('click', () => client.send({ type: 'pick', championId: id }));
        grid.appendChild(card);
      }
      // 位置
      const taken = new Set(st.players.filter((p) => p.team === m.team && p.id !== m.id).map((p) => p.role));
      const roles = h('div.cs-seg.sm', { role: 'radiogroup', 'aria-label': '位置' }, ...ROLE_ORDER.map((r) => {
        const b = h(`button.cs-seg-btn${r === m.role ? '.on' : ''}`, { type: 'button', text: roleText(r), disabled: taken.has(r) ? true : null, title: taken.has(r) ? '该位置已被队友选择' : '' });
        b.addEventListener('click', () => client.send({ type: 'pick', role: r }));
        return b;
      }));
      // 阵营
      const teams = h('div.cs-seg.sm', ...[[0, '蓝色方', 'blue'], [1, '红色方', 'red']].map(([t, text, cls]) => {
        const full = t !== m.team && st.players.filter((p) => p.team === t).length >= 5;
        const b = h(`button.cs-seg-btn.${cls}${t === m.team ? '.on' : ''}`, { type: 'button', text, disabled: full ? true : null });
        b.addEventListener('click', () => client.send({ type: 'pick', team: t }));
        return b;
      }));
      // 召唤师技能
      const cur = (m.summoners || []).slice();
      const slots = h('div.cs-spell-slots', ...['D', 'F'].map((k, i) => {
        const d = SP[cur[i]];
        const b = h(`button.cs-spell-slot${st.spellSlot === i ? '.on' : ''}`, { type: 'button' }, h('img', { alt: '', src: iconURL(d?.icon, 64, { glyph: d?.name?.[0] }) }), h('kbd', k), h('span.cs-spell-slot-name', d?.name || ''));
        b.addEventListener('click', () => { st.spellSlot = i; render(); });
        return b;
      }));
      const picker = h('div.cs-spell-picker', ...spellIds.map((sid) => {
        const d = SP[sid];
        const b = h(`button.cs-spell${cur.includes(sid) ? '.used' : ''}`, { type: 'button', title: d.name, 'aria-label': d.name }, h('img', { alt: '', src: iconURL(d.icon, 64, { glyph: d.name?.[0] }) }));
        b.addEventListener('click', () => {
          const next = cur.slice();
          const i = st.spellSlot, o = 1 - i;
          if (next[o] === sid) next[o] = next[i];
          next[i] = sid;
          client.send({ type: 'pick', summoners: next });
        });
        return b;
      }));
      // 准备 / 开始
      const others = st.players.filter((p) => p.id !== st.hostId);
      const allReady = others.every((p) => p.ready);
      let action;
      if (isHost) {
        const diff = h('div.cs-seg.sm', ...[['easy', '新手'], ['normal', '一般'], ['hard', '困难']].map(([v, text]) => {
          const b = h(`button.cs-seg-btn${st.settings.difficulty === v ? '.on' : ''}`, { type: 'button', text });
          b.addEventListener('click', () => client.send({ type: 'settings', difficulty: v }));
          return b;
        }));
        const startBtn = h('button.cs-start.hex-btn.primary', { type: 'button', disabled: allReady ? null : true }, h('span', '开始对局'));
        startBtn.addEventListener('click', () => client.send({ type: 'start' }));
        const humans = st.players.length;
        action = h('div.lb-actions',
          h('div.cs-sec-title', '人机难度（房主）'), diff,
          h('div.cs-note', allReady ? `真人 ${humans} 人，开局时人机补齐 ${10 - humans} 人。` : '等待所有玩家准备…'),
          startBtn);
      } else {
        const readyBtn = h(`button.cs-start.hex-btn${m.ready ? '' : '.primary'}`, { type: 'button' }, h('span', m.ready ? '取消准备' : '准备'));
        readyBtn.addEventListener('click', () => client.send({ type: 'ready', ready: !m.ready }));
        action = h('div.lb-actions',
          h('div.cs-note', `人机难度：${DIFF_LABELS[st.settings.difficulty] || '一般'}（由房主设置）。准备后等待房主开始对局。`),
          readyBtn);
      }
      mid.append(
        h('div.lb-row', h('div.cs-block', h('div.cs-sec-title', '阵营'), teams), h('div.cs-block', h('div.cs-sec-title', '位置'), roles)),
        h('div.cs-sec-title', '英雄'), grid,
        h('div.cs-sec-title', '召唤师技能'), slots, picker,
        action);
    }
    render();
    for (const id of ids) store.load(id);
  });
}
