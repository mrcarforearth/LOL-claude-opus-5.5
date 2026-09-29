// 分路分配（纯函数，无 DOM，Node 可用）：按真人玩家所选位置把 AI 填到其余位置，保证每队上/野/中/ADC/辅助各 1 人、10 人英雄不重复
// 单人模式（选人界面 / autostart）与局域网模式（server.mjs）共用
export const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
export const ROLE_NAMES = { top: '上单', jungle: '打野', mid: '中单', adc: 'ADC', support: '辅助' };
export const ROLE_SUMMONERS = {
  top: ['flash', 'teleport'], jungle: ['flash', 'smite'], mid: ['flash', 'ignite'], adc: ['flash', 'heal'], support: ['flash', 'exhaust'],
};
export const DIFF_NAMES = { easy: '新手', normal: '一般', hard: '困难' };

export const isRole = (r) => ROLES.includes(r);
// 英雄的主位置（def.roles[0]），无效时返回 fallback
export function defaultRole(def, fallback = 'mid') {
  const r = def?.roles?.[0];
  return isRole(r) ? r : fallback;
}
export function summonersForRole(role) {
  return (ROLE_SUMMONERS[role] || ROLE_SUMMONERS.mid).slice();
}
// 在该队已占用位置之外选一个位置：优先 want，其次英雄的各个位置，最后按顺序第一个空位
export function freeRole(taken, want, def) {
  if (isRole(want) && !taken.has(want)) return want;
  for (const r of def?.roles || []) if (isRole(r) && !taken.has(r)) return r;
  return ROLES.find((r) => !taken.has(r)) || null;
}

/**
 * 生成双方阵容。
 * @param {object} o
 * @param {object} o.champions  英雄定义表（id → def）
 * @param {Array}  o.humans     真人：[{ team, role, championId, summoners?, name?, humanId?, isPlayer? }]（每队最多 5 人）
 * @param {string} [o.difficulty]
 * @param {Function} [o.rng]    [0,1) 随机数；不传则按顺序取第一个合适英雄（确定性）
 * @param {Array}  [o.preferred] [[蓝方 5 个英雄 id（按 ROLES 顺序）], [红方 ...]]：AI 优先使用这些英雄
 * @param {Array|Function} [o.aiNames] AI 名字列表或 (team, role, i) => name；默认「电脑 · 一般」
 * @param {object} [o.summonerDefs] 召唤师技能定义（用于校验；可选）
 * @returns {{ blue: object[], red: object[] }} 每队 5 个条目，按 ROLES 顺序（上/野/中/ADC/辅助）
 */
export function assignLineup({ champions, humans = [], difficulty = 'normal', rng = null, preferred = null, aiNames = null, summonerDefs = null } = {}) {
  const CH = champions || {};
  const ids = Object.keys(CH);
  const teams = [new Array(5).fill(null), new Array(5).fill(null)];
  const used = new Set();
  const validSpells = (list) => Array.isArray(list) && list.length === 2 && list[0] !== list[1]
    && list.every((s) => typeof s === 'string' && (!summonerDefs || summonerDefs[s]));
  // 1) 真人：放到所选位置（冲突时换到空位）
  for (const hm of humans) {
    if (!hm || (hm.team !== 0 && hm.team !== 1)) continue;
    const list = teams[hm.team];
    const taken = new Set(ROLES.filter((r, i) => list[i]));
    let championId = CH[hm.championId] && !used.has(hm.championId) ? hm.championId : null;
    if (!championId) championId = ids.find((id) => !used.has(id) && (CH[id].roles || []).includes(hm.role)) || ids.find((id) => !used.has(id)) || null;
    if (!championId) continue;
    const role = freeRole(taken, hm.role, CH[championId]);
    if (!role) continue;
    used.add(championId);
    const e = {
      championId, role, isPlayer: hm.isPlayer ?? true,
      summoners: validSpells(hm.summoners) ? hm.summoners.slice() : summonersForRole(role),
      name: hm.name || '召唤师',
    };
    if (hm.humanId != null) e.humanId = hm.humanId;
    list[ROLES.indexOf(role)] = e;
  }
  // 2) AI：优先 preferred，其次主位置为该位置的英雄，再次 roles 包含该位置，最后任意未用英雄
  const pickFrom = (cand) => (cand.length ? cand[rng ? Math.floor(rng() * cand.length) % cand.length : 0] : null);
  const slots = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < 5; i++) if (!teams[t][i]) slots.push([t, i]);
  const chosen = new Map();
  if (preferred) {
    for (const [t, i] of slots) {
      const id = preferred?.[t]?.[i];
      if (id && CH[id] && !used.has(id)) { used.add(id); chosen.set(`${t}:${i}`, id); }
    }
  }
  const passes = [
    (id, role) => CH[id].roles?.[0] === role,
    (id, role) => (CH[id].roles || []).includes(role),
    () => true,
  ];
  for (const pass of passes) {
    for (const [t, i] of slots) {
      const key = `${t}:${i}`;
      if (chosen.has(key)) continue;
      const id = pickFrom(ids.filter((c) => !used.has(c) && pass(c, ROLES[i])));
      if (id) { used.add(id); chosen.set(key, id); }
    }
  }
  const nameOf = typeof aiNames === 'function' ? aiNames : (() => {
    const list = Array.isArray(aiNames) ? aiNames.slice() : null;
    return () => (list && list.length ? list.shift() : `电脑 · ${DIFF_NAMES[difficulty] || '一般'}`);
  })();
  for (const [t, i] of slots) {
    const role = ROLES[i];
    // 英雄不足 10 个时允许重复
    const id = chosen.get(`${t}:${i}`) || ids[(t * 5 + i) % Math.max(1, ids.length)];
    teams[t][i] = { championId: id, role, isPlayer: false, summoners: summonersForRole(role), name: nameOf(t, role, i) };
  }
  return { blue: teams[0], red: teams[1] };
}
