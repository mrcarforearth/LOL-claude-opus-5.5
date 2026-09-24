// 选人界面（英雄网格/分路筛选/技能介绍/召唤师技能/阵营/难度/倍速/观战/画质）与加载界面（10 张英雄卡片 + 进度 + 小贴士）
import {
  h, esc, richText, ROLE_LABELS, ROLE_ORDER, DIFF_LABELS, loadJSON, saveJSON, PortraitStore, previewChampion, safeDesc, resolveVal, RESOURCE_LABEL,
} from './dom.js';
import { iconURL } from './icons.js';
import { Tooltip, tipCard } from './tooltip.js';
import { SUMMONERS as CORE_SUMMONERS } from '../core/summoners.js';

const SELECT_KEY = 'riftclash.select.v1';
export const UI_SETTINGS_KEY = 'riftclash.ui.v1';
const SPEEDS = [1, 1.5, 2, 3];
const QUALITIES = [['low', '低'], ['medium', '中'], ['high', '高']];
const ROLE_SUMMONERS = { top: ['flash', 'teleport'], jungle: ['flash', 'smite'], mid: ['flash', 'ignite'], adc: ['flash', 'heal'], support: ['flash', 'exhaust'] };
const SPELL_ORDER = ['flash', 'ignite', 'heal', 'barrier', 'exhaust', 'ghost', 'cleanse', 'smite', 'teleport'];
const PLAYER_NAME = '召唤师';
const AI_NAMES = [
  '峡谷之巅', '德玛西亚万岁', '野区霸主', '补刀大师', '闪现撞墙', '河道蟹', '稳住别浪', '一级团战', '塔下刺客', '反野专家',
  '五杀预定', '真眼守护者', '龙坑守望', '大龙逼团', '中路快乐风', '下路双人组', '控图大师', '逆风翻盘', '推塔狂魔', '别追了',
];
export const LOADING_TIPS = [
  '补刀（最后一击）小兵才能获得金币，注意在小兵残血时再出手。',
  '按住 Tab 可以查看记分板，了解双方装备与战绩。',
  '按 P 打开商店，只有在泉水附近才能购买装备。',
  '草丛可以隐藏身形：敌人看不到草丛里的你，除非他也在草丛中。',
  '防御塔会优先攻击在它射程内攻击我方英雄的敌方英雄——不要轻易越塔。',
  '回城（B）需要持续 8 秒，受到伤害或移动都会打断。',
  '击杀纳什男爵后全队获得强化，是推进高地的最好时机。',
  '元素亚龙为全队提供永久增益，拿下四条即可获得龙魂。',
  'Ctrl + Q/W/E/R 可以快速升级技能，6/11/16 级时记得升级终极技能。',
  '按 Y 锁定/解锁镜头，按住空格可以让镜头回到你的英雄身上。',
  '按 A 再左键可以攻击移动：自动攻击沿途最近的敌人。',
  '召唤水晶被摧毁后，该路会出现超级小兵，给对方带来巨大压力。',
  '饰品守卫（数字键 4）可以提供视野，放在河道草丛能有效防止被抓。',
  '惩戒可以对野怪造成大量真实伤害，打野英雄用它争夺史诗级野怪。',
  '闪现可以穿过墙体，是保命与开团的关键召唤师技能。',
  '暴击、攻速与穿甲是物理输出英雄的核心属性；法术强度与法术穿透则属于法师。',
  '团灭敌方后是推塔的最佳时机，注意查看敌方英雄的复活时间。',
  '外塔在 14 分钟前有镀层，每击落一层都会为附近的英雄提供金币。',
];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// —— 阵容：玩家在所选阵营的主分路，其余 9 人按分路随机分配（10 人不重复） ——
export function buildLineup(champions, playerId, team, playerSummoners, difficulty) {
  const ids = Object.keys(champions);
  const used = new Set([playerId]);
  const pRole = ROLE_ORDER.includes(champions[playerId]?.roles?.[0]) ? champions[playerId].roles[0] : 'mid';
  const teams = [new Array(5).fill(null), new Array(5).fill(null)];
  const pIdx = ROLE_ORDER.indexOf(pRole);
  teams[team][pIdx] = { championId: playerId, role: pRole, isPlayer: true, summoners: playerSummoners.slice(), name: PLAYER_NAME };
  const slots = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < 5; i++) if (!teams[t][i]) slots.push([t, i]);
  shuffle(slots);
  const names = shuffle(AI_NAMES.slice());
  const passes = [
    (id, role) => champions[id].roles?.[0] === role,
    (id, role) => (champions[id].roles || []).includes(role),
    () => true,
  ];
  for (const pass of passes) {
    for (const [t, i] of slots) {
      if (teams[t][i]) continue;
      const role = ROLE_ORDER[i];
      let cand = ids.filter((id) => !used.has(id) && pass(id, role));
      if (!cand.length && pass === passes[2]) cand = ids.slice();   // 英雄不足 10 个时允许重复
      if (!cand.length) continue;
      const id = cand[Math.floor(Math.random() * cand.length)];
      used.add(id);
      teams[t][i] = { championId: id, role, isPlayer: false, summoners: ROLE_SUMMONERS[role].slice(), name: names.pop() || `电脑 · ${DIFF_LABELS[difficulty] || '一般'}` };
    }
  }
  return { blue: teams[0], red: teams[1] };
}

// —— 选人界面 ——
export async function showChampSelect(root, { champions, summoners, renderPortrait, defaults = {} } = {}) {
  const CH = champions || {};
  const ids = Object.keys(CH);
  if (!ids.length) return null;
  const SP = summoners || {};
  const spellIds = SPELL_ORDER.filter((s) => SP[s]).concat(Object.keys(SP).filter((s) => !SPELL_ORDER.includes(s)));
  const saved = loadJSON(SELECT_KEY, {});
  const uiSaved = loadJSON(UI_SETTINGS_KEY, {});
  const pick = (v, ok, d) => (ok(v) ? v : d);
  const st = {
    championId: pick(defaults.championId, (v) => CH[v], null) || pick(saved.championId, (v) => CH[v], null) || (CH.garen ? 'garen' : ids[0]),
    team: pick(defaults.team, (v) => v === 0 || v === 1, null) ?? pick(saved.team, (v) => v === 0 || v === 1, 0),
    difficulty: pick(saved.difficulty, (v) => DIFF_LABELS[v], null) || pick(defaults.difficulty, (v) => DIFF_LABELS[v], 'normal'),
    speed: pick(Number(defaults.speed), (v) => SPEEDS.includes(v), null) ?? pick(saved.speed, (v) => SPEEDS.includes(v), 1),
    spectate: !!(defaults.spectate || saved.spectate),
    quality: pick(uiSaved.quality, (v) => QUALITIES.some((q) => q[0] === v), 'high'),
    summoners: null, role: 'all', skill: 'P', spellSlot: null,
  };
  if (defaults.difficulty && DIFF_LABELS[defaults.difficulty] && defaults.difficulty !== 'normal') st.difficulty = defaults.difficulty;
  const defaultSpells = (id) => (ROLE_SUMMONERS[CH[id]?.roles?.[0]] || ['flash', 'ignite']).filter((s) => SP[s]);
  st.summoners = Array.isArray(saved.summoners) && saved.summoners.length === 2 && saved.summoners.every((s) => SP[s]) && saved.summoners[0] !== saved.summoners[1]
    ? saved.summoners.slice() : defaultSpells(st.championId);
  if (st.summoners.length < 2) st.summoners = spellIds.slice(0, 2);

  const store = new PortraitStore(renderPortrait, CH);
  try { await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1200))]); } catch { /* 忽略 */ }

  return new Promise((resolve) => {
    const el = h('div.cs', { role: 'dialog', 'aria-label': '选择英雄' });
    const tip = new Tooltip(el);
    // 头部
    el.append(
      h('div.cs-bg'),
      h('header.cs-top',
        h('div.cs-brand', h('div.cs-logo', '峡谷对决'), h('div.cs-logo-sub', 'RIFT CLASH · 召唤师峡谷 5v5 人机对战')),
        h('div.cs-step', h('span.cs-step-n', '选择你的英雄'), h('span.cs-step-d', '挑选英雄、召唤师技能与对局设置，然后开始游戏'))),
      h('div.cs-narrow', '建议使用桌面端键鼠游玩；小屏设备仍可开启「观战模式」观看 AI 对战。'),
    );
    const main = h('main.cs-main');
    el.appendChild(main);

    // 左：分路筛选 + 英雄网格
    const roleBar = h('div.cs-roles', { role: 'tablist', 'aria-label': '分路筛选' });
    const grid = h('div.cs-grid');
    const roleBtns = {};
    for (const r of ['all', ...ROLE_ORDER]) {
      const b = h('button.cs-role', { type: 'button', role: 'tab', text: r === 'all' ? '全部' : ROLE_LABELS[r] });
      b.addEventListener('click', () => { st.role = r; refreshGrid(); });
      roleBtns[r] = b;
      roleBar.appendChild(b);
    }
    const cards = {};
    for (const id of ids) {
      const def = CH[id];
      const img = h('img', { alt: '', draggable: 'false' });
      store.apply(img, id);
      const card = h('button.cs-card', { type: 'button', 'aria-label': `${def.name} ${def.title || ''}` },
        h('div.cs-card-img', img), h('div.cs-card-name', def.name));
      card.addEventListener('click', () => selectChamp(id, true));
      card.addEventListener('dblclick', () => { selectChamp(id, true); start(); });
      cards[id] = card;
      grid.appendChild(card);
    }
    main.appendChild(h('section.cs-left', h('div.cs-sec-title', '英雄'), roleBar, grid));

    // 中：英雄展示
    const splash = h('img.cs-splash-img', { alt: '', draggable: 'false' });
    const nameEl = h('div.cs-name'), titleEl = h('div.cs-title'), tagsEl = h('div.cs-tags'), loreEl = h('div.cs-lore');
    const skillsEl = h('div.cs-skills'), skillDetail = h('div.cs-skill-detail');
    main.appendChild(h('section.cs-center',
      h('div.cs-splash', splash, h('div.cs-splash-shade'), h('div.cs-splash-info', titleEl, nameEl, tagsEl)),
      loreEl, h('div.cs-sec-title', '技能'), skillsEl, skillDetail));

    // 右：设置
    const right = h('section.cs-right');
    main.appendChild(right);
    const spellSlots = h('div.cs-spell-slots');
    const spellPicker = h('div.cs-spell-picker');
    const slotBtns = ['D', 'F'].map((k, i) => {
      const img = h('img', { alt: '' });
      const b = h('button.cs-spell-slot', { type: 'button' }, img, h('kbd', k), h('span.cs-spell-slot-name'));
      b.addEventListener('click', () => { st.spellSlot = st.spellSlot === i ? null : i; refreshSpells(); });
      tip.bind(b, () => spellTip(st.summoners[i], k), { place: 'left' });
      spellSlots.appendChild(b);
      return b;
    });
    const pickerBtns = {};
    for (const sid of spellIds) {
      const def = SP[sid];
      const b = h('button.cs-spell', { type: 'button', 'aria-label': def.name }, h('img', { alt: '', src: iconURL(def.icon, 64, { glyph: def.name?.[0] }) }));
      b.addEventListener('click', () => chooseSpell(sid));
      tip.bind(b, () => spellTip(sid), { place: 'left' });
      pickerBtns[sid] = b;
      spellPicker.appendChild(b);
    }
    const seg = (label, options, get, set) => {
      const wrap = h('div.cs-seg', { role: 'radiogroup', 'aria-label': label });
      const btns = options.map(([v, text, cls]) => {
        const b = h(`button.cs-seg-btn${cls ? '.' + cls : ''}`, { type: 'button', role: 'radio', text });
        b.addEventListener('click', () => { set(v); refreshSettings(); });
        wrap.appendChild(b);
        return [v, b];
      });
      segs.push(() => { for (const [v, b] of btns) { const on = get() === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } });
      return h('div.cs-block', h('div.cs-sec-title', label), wrap);
    };
    const segs = [];
    const spectBox = h('input', { type: 'checkbox', id: 'cs-spectate' });
    spectBox.addEventListener('change', () => { st.spectate = spectBox.checked; refreshSettings(); });
    const startBtn = h('button.cs-start.hex-btn.primary', { type: 'button' }, h('span', '开始游戏'));
    startBtn.addEventListener('click', () => start());
    const spectNote = h('div.cs-note');
    right.append(
      h('div.cs-block', h('div.cs-sec-title', '召唤师技能'), spellSlots, spellPicker, h('div.cs-note', '点击 D / F 栏位后，从下方选择要替换的召唤师技能。')),
      seg('阵营', [[0, '蓝色方', 'blue'], [1, '红色方', 'red']], () => st.team, (v) => { st.team = v; }),
      seg('难度', [['easy', '新手'], ['normal', '一般'], ['hard', '困难']], () => st.difficulty, (v) => { st.difficulty = v; }),
      seg('游戏倍速', SPEEDS.map((s) => [s, `${s}x`]), () => st.speed, (v) => { st.speed = v; }),
      seg('画质', QUALITIES.map(([v, t]) => [v, t]), () => st.quality, (v) => { st.quality = v; }),
      h('div.cs-block', h('label.cs-switch', { for: 'cs-spectate' }, spectBox, h('span.cs-switch-ui'), h('span', '观战模式')), spectNote),
      h('div.cs-grow'),
      startBtn,
    );
    el.appendChild(h('footer.cs-foot', '非官方同人作品 · 所有画面、模型与音效均为程序生成 · 与 Riot Games 无关'));

    // —— 逻辑 ——
    function spellTip(sid, key = '') {
      const d = SP[sid];
      if (!d) return '';
      const preview = previewChampion(CH[st.championId], 1);
      return tipCard({ title: esc(d.name), key, meta: [`冷却 ${d.cooldown} 秒`, d.range ? `射程 ${d.range}` : ''], body: richText(safeDesc(d.desc, preview)) });
    }
    function chooseSpell(sid) {
      const slot = st.spellSlot ?? (st.summoners.includes(sid) ? null : 1);
      if (slot == null) { refreshSpells(); return; }
      const other = 1 - slot;
      if (st.summoners[other] === sid) st.summoners[other] = st.summoners[slot];
      st.summoners[slot] = sid;
      st.spellSlot = null;
      refreshSpells();
    }
    function refreshSpells() {
      slotBtns.forEach((b, i) => {
        const d = SP[st.summoners[i]];
        b.querySelector('img').src = iconURL(d?.icon, 64, { glyph: d?.name?.[0] });
        b.querySelector('.cs-spell-slot-name').textContent = d?.name || '';
        b.classList.toggle('on', st.spellSlot === i);
      });
      for (const sid in pickerBtns) {
        pickerBtns[sid].classList.toggle('used', st.summoners.includes(sid));
        pickerBtns[sid].classList.toggle('armed', st.spellSlot != null);
      }
    }
    function refreshSettings() {
      for (const f of segs) f();
      spectBox.checked = st.spectate;
      spectNote.textContent = st.spectate ? '你的英雄将由 AI 控制，镜头自由移动（适合手机或平板观看）。' : '关闭时由你亲自操控所选英雄。';
      startBtn.querySelector('span').textContent = st.spectate ? '开始观战' : '开始游戏';
      el.classList.toggle('team-red', st.team === 1);
    }
    function refreshGrid() {
      for (const r in roleBtns) { roleBtns[r].classList.toggle('on', st.role === r); roleBtns[r].setAttribute('aria-selected', String(st.role === r)); }
      for (const id of ids) {
        const show = st.role === 'all' || (CH[id].roles || []).includes(st.role);
        cards[id].hidden = !show;
        cards[id].classList.toggle('on', id === st.championId);
      }
    }
    function selectChamp(id, userAction) {
      const changed = id !== st.championId;
      st.championId = id;
      const def = CH[id];
      store.apply(splash, id);
      nameEl.textContent = def.name;
      titleEl.textContent = def.title || '';
      tagsEl.innerHTML = '';
      for (const r of def.roles || []) tagsEl.appendChild(h('span.cs-tag.role', ROLE_LABELS[r] || r));
      for (const t of def.tags || []) tagsEl.appendChild(h('span.cs-tag', t));
      const diff = Math.max(1, Math.min(3, def.difficulty || 1));
      tagsEl.appendChild(h('span.cs-diff', { title: `操作难度 ${diff}/3` }, '难度 ', ...[1, 2, 3].map((i) => h(`i${i <= diff ? '.on' : ''}`))));
      loreEl.textContent = def.lore || '';
      skillsEl.innerHTML = '';
      const entries = [['P', def.passive], ...['Q', 'W', 'E', 'R'].map((k) => [k, def.abilities?.[k]])];
      for (const [k, a] of entries) {
        if (!a) continue;
        const b = h('button.cs-skill', { type: 'button', 'aria-label': `${k} ${a.name}` },
          h('img', { alt: '', src: iconURL(a.icon, 64, { glyph: a.name?.[0] }) }), h('kbd', k === 'P' ? '被动' : k));
        b.addEventListener('click', () => { st.skill = k; showSkill(); });
        b.addEventListener('pointerenter', () => { st.skill = k; showSkill(); });
        b.dataset.k = k;
        skillsEl.appendChild(b);
      }
      if (changed && userAction) {
        st.summoners = defaultSpells(id).length === 2 ? defaultSpells(id) : st.summoners;
        refreshSpells();
        el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
      }
      st.skill = 'P';
      showSkill();
      refreshGrid();
    }
    function showSkill() {
      const def = CH[st.championId];
      const k = st.skill;
      const a = k === 'P' ? def.passive : def.abilities?.[k];
      for (const b of skillsEl.children) b.classList.toggle('on', b.dataset.k === k);
      if (!a) { skillDetail.innerHTML = ''; return; }
      const preview = previewChampion(def, k === 'R' ? 6 : 1);
      const meta = [];
      if (k !== 'P') {
        const max = a.maxRank ?? (k === 'R' ? 3 : 5);
        const list = (v) => Array.from({ length: max }, (_, i) => +Number(resolveVal(v, preview, i + 1)).toFixed(1));
        const uniq = (arr) => (arr.every((x) => x === arr[0]) ? String(arr[0]) : arr.join('/'));
        const cds = list(a.cooldown);
        if (cds.some((x) => x > 0)) meta.push(`冷却：${uniq(cds)} 秒`);
        const costs = list(a.cost);
        const res = RESOURCE_LABEL[a.costType || def.baseStats?.resource || 'mana'];
        if (costs.some((x) => x > 0) && res) meta.push(`消耗：${uniq(costs)} ${res}`);
        const rg = resolveVal(a.range, preview, 1);
        if (rg > 0 && rg < 20000) meta.push(`射程：${Math.round(rg)}`);
      }
      const desc = k === 'P' ? safeDesc(a.desc, preview) : safeDesc(a.desc, preview, 1);
      skillDetail.innerHTML = `<div class="cs-sd-head"><span class="cs-sd-key">${k === 'P' ? '被动' : k}</span><span class="cs-sd-name">${esc(a.name)}</span></div>
        ${meta.length ? `<div class="cs-sd-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
        <div class="cs-sd-desc">${richText(desc)}</div>`;
    }
    const onKey = (e) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); start(); }
    };
    window.addEventListener('keydown', onKey);
    let done = false;
    function start() {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey);
      saveJSON(SELECT_KEY, { championId: st.championId, summoners: st.summoners, team: st.team, difficulty: st.difficulty, speed: st.speed, spectate: st.spectate });
      const ui = loadJSON(UI_SETTINGS_KEY, {});
      saveJSON(UI_SETTINGS_KEY, { ...ui, quality: st.quality });
      const lineup = buildLineup(CH, st.championId, st.team, st.summoners, st.difficulty);
      const config = {
        championId: st.championId, summoners: st.summoners.slice(), team: st.team, difficulty: st.difficulty, speed: st.speed,
        spectate: st.spectate, autopilot: st.spectate, quality: st.quality, blue: lineup.blue, red: lineup.red,
      };
      el.classList.add('leaving');
      startBtn.disabled = true;
      setTimeout(() => { tip.dispose(); el.remove(); resolve(config); }, 380);
    }

    root.appendChild(el);
    refreshSpells();
    refreshSettings();
    selectChamp(st.championId, false);
    for (const id of ids) store.load(id);
    requestAnimationFrame(() => { el.classList.add('in'); (cards[st.championId] || startBtn).focus({ preventScroll: true }); });
  });
}

// —— 加载界面 ——
export function showLoadingScreen(root, config, champions, renderPortrait) {
  const CH = champions || {};
  const store = new PortraitStore(renderPortrait, CH);
  const SP = CORE_SUMMONERS || null;
  const el = h('div.ld', { role: 'status', 'aria-live': 'polite' });
  const diffText = DIFF_LABELS[config?.difficulty] || '一般';
  el.append(h('div.ld-bg'), h('div.ld-head',
    h('div.ld-map', '召唤师峡谷'),
    h('div.ld-mode', `5v5 · 人机对战 · 难度：${diffText}${config?.spectate ? ' · 观战模式' : ''}`)));
  const offsets = [];
  const pcts = [];
  const rowFor = (list, team) => {
    const row = h(`div.ld-team.${team ? 'red' : 'blue'}`);
    (list || []).forEach((e) => {
      if (!e) return;
      const def = CH[e.championId] || {};
      const img = h('img', { alt: '', draggable: 'false' });
      store.apply(img, e.championId);
      const spells = h('div.ld-spells');
      for (const sid of e.summoners || []) spells.appendChild(h('img', { alt: '', src: iconURL(SP?.[sid]?.icon || spellIconHint(sid), 48, { glyph: SPELL_GLYPH[sid] || '?' }) }));
      const pct = h('div.ld-pct.num', '0%');
      pcts.push(pct);
      offsets.push(Math.random() * 0.18);
      row.appendChild(h(`div.ld-card${e.isPlayer ? '.me' : ''}`,
        h('div.ld-card-img', img),
        h('div.ld-card-plate',
          h('div.ld-card-champ', def.name || e.championId),
          h('div.ld-card-name', e.isPlayer ? (e.name || PLAYER_NAME) : `${e.name || '电脑'}`),
          h('div.ld-card-sub', e.isPlayer ? (config?.spectate ? 'AI 托管' : '玩家') : `电脑 · ${diffText}`),
          spells),
        pct));
    });
    return row;
  };
  el.append(rowFor(config?.blue, 0), h('div.ld-vs', h('span', 'VS')), rowFor(config?.red, 1));
  const bar = h('i');
  const label = h('span.ld-label', '正在加载');
  const pctAll = h('span.ld-total.num', '0%');
  const tipEl = h('div.ld-tip');
  let tipIdx = Math.floor(Math.random() * LOADING_TIPS.length);
  const setTip = () => { tipEl.innerHTML = `<b>小贴士</b>${esc(LOADING_TIPS[tipIdx % LOADING_TIPS.length])}`; tipIdx++; };
  setTip();
  const tipTimer = setInterval(setTip, 5200);
  el.append(h('div.ld-foot', tipEl, h('div.ld-progress', h('div.ld-bar', bar), h('div.ld-status', label, pctAll))));
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  let closed = false;
  return {
    setProgress(p, text) {
      if (closed) return;
      p = Math.max(0, Math.min(1, Number(p) || 0));
      bar.style.transform = `scaleX(${p})`;
      pctAll.textContent = `${Math.round(p * 100)}%`;
      if (text) label.textContent = text;
      pcts.forEach((e, i) => { e.textContent = `${Math.round(Math.max(0, Math.min(1, p * (1 + offsets[i]) - offsets[i] * 0.4)) * 100)}%`; });
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(tipTimer);
      pcts.forEach((e) => { e.textContent = '100%'; });
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 500);
    },
  };
}
// 加载界面没有 summoners 定义时的后备字形
const SPELL_GLYPH = { flash: '闪', ignite: '燃', heal: '治', barrier: '盾', exhaust: '虚', ghost: '疾', cleanse: '净', smite: '惩', teleport: '传' };
const SPELL_BG = { flash: ['#ffe98a', '#b8860b'], ignite: ['#ff8a3a', '#7a1a00'], heal: ['#8af0a0', '#146a2a'], barrier: ['#ffe6a0', '#8a6a1a'], exhaust: ['#c0a060', '#4a3010'], ghost: ['#9ae6ff', '#1a4a6a'], cleanse: ['#a0f0ff', '#1a5a7a'], smite: ['#ffd070', '#7a4a00'], teleport: ['#d09aff', '#3a1a6a'] };
const hintCache = {};
function spellIconHint(sid) {
  if (!hintCache[sid]) hintCache[sid] = { glyph: SPELL_GLYPH[sid] || '?', bg: SPELL_BG[sid] || ['#556', '#112'], fg: '#fff' };
  return hintCache[sid];
}
