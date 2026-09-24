// 商店：合成价格（递归扣除已有材料）、购买条件（泉水/金币/栏位/唯一/叠放/等级）、购买/出售/撤销、AI 购买规划与出售建议
import {
  ITEMS, BUILDS, DEFAULT_BUILDS, recomputeItemStats, installItemSystem, createItemState, initItemPassive, cleanupItem, suggestItemUse,
} from './items.js';
import { isRanged } from './itemfx.js';

export { suggestItemUse, installItemSystem };

const SLOTS = 6;
const fail = (reason) => ({ ok: false, reason });

// —— 合成解析：递归查找背包中可用的合成材料（自顶向下优先匹配高级材料），返回实际花费与被消耗的栏位 ——
function resolvePurchase(champ, id) {
  const def = ITEMS[id];
  if (!def) return null;
  const inv = [];
  for (let i = 0; i < champ.items.length; i++) {
    const it = champ.items[i];
    if (it) inv.push({ id: it.id, slot: i, used: false });
  }
  const consumed = [];
  const costOf = (itemId, root) => {
    const d = ITEMS[itemId];
    if (!d) return 0;
    if (!root) {
      const owned = inv.find((e) => !e.used && e.id === itemId);
      if (owned) { owned.used = true; consumed.push(owned.slot); return 0; }
    }
    let c = d.cost;
    for (const f of d.from) c -= ITEMS[f] ? ITEMS[f].cost : 0;
    for (const f of d.from) c += costOf(f, false);
    return c;
  };
  const cost = costOf(id, true);
  return { def, cost: Math.max(0, cost), consumed };
}

// 扣除已拥有合成材料后的实际价格
export function effectiveCost(champ, id) {
  const r = resolvePurchase(champ, id);
  return r ? r.cost : Infinity;
}
// 购买会消耗的栏位（UI 高亮用）
export function componentsUsed(champ, id) {
  const r = resolvePurchase(champ, id);
  return r ? r.consumed.slice() : [];
}

export const hasItem = (champ, id) => champ.items.some((it) => it && it.id === id);
export function itemCount(champ, id) {
  let n = 0;
  for (const it of champ.items) if (it && it.id === id) n += it.stacks || 1;
  return n;
}
export const freeSlots = (champ) => champ.items.filter((it) => !it).length;

// 能否购买：{ ok, reason, cost }；reason ∈ 无法购买/不在泉水/等级不足/仅限远程英雄/唯一限制/已达上限/金币不足/栏位已满
export function canBuy(champ, id) {
  const def = ITEMS[id];
  if (!def || def.purchasable === false) return fail('无法购买');
  if (!champ || !champ.canShop) return fail('不在泉水');
  if (def.minLevel && (champ.level || 1) < def.minLevel) return fail('等级不足');
  if (def.rangedOnly && !isRanged(champ)) return fail('仅限远程英雄');
  const r = resolvePurchase(champ, id);
  // 唯一限制：同组唯一（鞋子/生命线/咒刃…），传说装备同名唯一（被合成消耗的材料不计）
  for (let i = 0; i < champ.items.length; i++) {
    const it = champ.items[i];
    if (!it || !it.def || r.consumed.includes(i)) continue;
    if (def.unique && it.def.unique === def.unique) return { ...fail('唯一限制'), cost: r.cost };
    if (it.id === id && (def.tier === 'legendary' || def.tier === 'boots' || def.tier === 'starter' && def.unique)) return { ...fail('唯一限制'), cost: r.cost };
  }
  // 消耗品叠放
  let stack = null;
  if (def.maxStack > 1) {
    stack = champ.items.find((it) => it && it.id === id) || null;
    if (stack && (stack.stacks || 1) >= def.maxStack) return { ...fail('已达上限'), cost: r.cost };
  }
  if (champ.gold + 1e-6 < r.cost) return { ...fail('金币不足'), cost: r.cost };
  if (!def.instant && !stack) {
    const free = freeSlots(champ) + r.consumed.length;
    if (free <= 0) return { ...fail('栏位已满'), cost: r.cost };
  }
  return { ok: true, reason: null, cost: r.cost, consumed: r.consumed, stack };
}

// —— 购买/出售历史（撤销用）；离开泉水（shopSession 变化）或使用了物品后失效 ——
function history(champ) {
  if (!champ._shopHistory) champ._shopHistory = [];
  const h = champ._shopHistory;
  if (h.length && h[h.length - 1].session !== (champ.shopSession ?? 0)) h.length = 0;
  return h;
}
function ensureGameHooks(game) {
  installItemSystem(game);
  if (game._shopHooked) return;
  game._shopHooked = true;
  game.events.on('itemUsed', (e) => { if (e && e.champion && e.champion._shopHistory) e.champion._shopHistory.length = 0; });
}

export function buy(champ, id) {
  const chk = canBuy(champ, id);
  if (!chk.ok) return chk;
  const game = champ.game;
  ensureGameHooks(game);
  const def = ITEMS[id];
  const removed = [];
  for (const slot of chk.consumed) {
    const it = champ.items[slot];
    cleanupItem(it);
    removed.push({ slot, item: it });
    champ.items[slot] = null;
  }
  champ.gold -= chk.cost;
  const entry = { type: 'buy', id, cost: chk.cost, removed, slot: -1, state: null, stack: false, instant: false, buffId: null, session: champ.shopSession ?? 0 };
  if (def.instant) {
    const buff = def.instant(champ);
    entry.instant = true;
    entry.buffId = buff ? buff.id : null;
  } else if (chk.stack) {
    chk.stack.stacks = (chk.stack.stacks || 1) + 1;
    entry.slot = champ.items.indexOf(chk.stack);
    entry.state = chk.stack;
    entry.stack = true;
  } else {
    const slot = champ.items.findIndex((it) => !it);
    const st = createItemState(champ, id);
    champ.items[slot] = st;
    initItemPassive(champ, st);
    entry.slot = slot;
    entry.state = st;
  }
  recomputeItemStats(champ);
  history(champ).push(entry);
  game.events.emit('itemBought', { champion: champ, itemId: id, slot: entry.slot, cost: chk.cost });
  return { ok: true, reason: null, slot: entry.slot, cost: chk.cost };
}

// 出售价格：70%；叠放消耗品按数量，充能消耗品按剩余充能
export function sellValue(it) {
  if (!it || !it.def) return 0;
  const def = it.def;
  // 整数运算避免浮点误差（350 × 0.7 = 244.999…）
  const base = def.sellValue ?? Math.floor((def.cost * 7) / 10);
  if (def.maxStack > 1) return base * (it.stacks || 1);
  const maxCh = def.consumable && def.consumable.charges;
  if (maxCh > 1 && it.charges != null) return Math.floor((def.cost * 7 * Math.max(0, it.charges)) / (10 * maxCh));
  return base;
}

export function sell(champ, slot) {
  const it = champ.items[slot];
  if (!it) return { ok: false, refund: 0, reason: '空栏位' };
  if (!champ.canShop) return { ok: false, refund: 0, reason: '不在泉水' };
  const game = champ.game;
  ensureGameHooks(game);
  const refund = sellValue(it);
  cleanupItem(it);
  champ.items[slot] = null;
  recomputeItemStats(champ);
  champ.gainGold(refund, 'sell');
  history(champ).push({ type: 'sell', id: it.id, slot, item: it, refund, session: champ.shopSession ?? 0 });
  game.events.emit('itemSold', { champion: champ, itemId: it.id, refund, slot });
  return { ok: true, refund };
}

// 能否撤销（UI 按钮状态）
export function canUndo(champ) {
  if (!champ || !champ.canShop) return false;
  return history(champ).length > 0;
}

// 撤销最近一次购买/出售（仍在泉水、本次商店会话内、之后未使用物品）
export function undo(champ) {
  if (!champ || !champ.canShop) return false;
  const h = history(champ);
  const last = h[h.length - 1];
  if (!last) return false;
  if (last.type === 'buy') {
    if (!last.instant && champ.items[last.slot] !== last.state) { h.length = 0; return false; }
    h.pop();
    if (last.instant) { if (last.buffId) champ.removeBuff(last.buffId); }
    else if (last.stack) last.state.stacks = Math.max(1, (last.state.stacks || 1) - 1);
    else { cleanupItem(last.state); champ.items[last.slot] = null; }
    for (const { slot, item } of last.removed) {
      champ.items[slot] = item;
      initItemPassive(champ, item);
    }
    champ.gold += last.cost;
  } else {
    let slot = last.slot;
    if (champ.items[slot]) slot = champ.items.findIndex((x) => !x);
    if (slot < 0) { h.length = 0; return false; }
    h.pop();
    champ.items[slot] = last.item;
    initItemPassive(champ, last.item);
    champ.gold -= last.refund;
  }
  recomputeItemStats(champ);
  champ.game.events.emit('itemUndo', { champion: champ, type: last.type, itemId: last.id });
  return true;
}

// ============================================================
// AI 购买规划
// ============================================================
export function buildFor(champ) {
  return BUILDS[champ.championId] || DEFAULT_BUILDS[champ.role] || DEFAULT_BUILDS.mid;
}
// 购买顺序：第一件核心 → 鞋 → 其余核心
export function purchaseOrder(build) {
  const out = [];
  const push = (id) => { if (id && ITEMS[id] && !out.includes(id)) out.push(id); };
  const core = (build && build.core) || [];
  push(core[0]);
  push(build && build.boots);
  for (const id of core.slice(1)) push(id);
  return out;
}
const hasBoots = (champ) => champ.items.some((it) => it && it.def && it.def.unique === 'boots');

// 目标装备缺失的合成材料中，当前买得起且最贵的一件
function bestComponent(champ, targetId) {
  const inv = champ.items.filter(Boolean).map((it) => it.id);
  const missing = [];
  const walk = (id, root) => {
    const d = ITEMS[id];
    if (!d) return;
    if (!root) {
      const k = inv.indexOf(id);
      if (k >= 0) { inv.splice(k, 1); return; }
      missing.push(id);
    }
    for (const f of d.from) walk(f, false);
  };
  walk(targetId, true);
  let best = null, bestCost = -1;
  for (const id of missing) {
    const c = ITEMS[id].cost;
    if (c > bestCost && canBuy(champ, id).ok) { best = id; bestCost = c; }
  }
  return best;
}

// 下一件应购买的装备（或其合成材料）id；金币不足时返回 null（等待攒钱）
export function nextPurchase(champ, build = null) {
  if (!champ || !champ.canShop) return null;
  build = build || buildFor(champ);
  if (!build) return null;
  const game = champ.game;
  // 开局出门装
  if (game.time < 90) {
    const want = {};
    for (const id of build.start || []) want[id] = (want[id] || 0) + 1;
    for (const id of Object.keys(want)) if (itemCount(champ, id) < want[id] && canBuy(champ, id).ok) return id;
  }
  for (const target of purchaseOrder(build)) {
    if (hasItem(champ, target)) continue;
    const chk = canBuy(champ, target);
    if (chk.ok) return target;
    if (chk.reason !== '金币不足' && chk.reason !== '栏位已满') continue;
    const comp = bestComponent(champ, target);
    if (comp) return comp;
    // 攒钱期间：没有鞋先买基础鞋；辅助/打野补一个控制守卫
    if (!hasBoots(champ) && target !== build.boots && canBuy(champ, 'boots').ok) return 'boots';
    if ((champ.role === 'support' || champ.role === 'jungle') && !hasItem(champ, 'controlward') && freeSlots(champ) >= 2
      && champ.gold >= 75 && canBuy(champ, 'controlward').ok) return 'controlward';
    return null;
  }
  // 出装完成：18 级前的合剂
  if ((champ.level || 1) >= 9) {
    const core0 = ITEMS[(build.core || [])[0]];
    const tags = core0 ? core0.tags : [];
    const elixir = tags.includes('ap') ? 'elixirsorcery' : (tags.includes('tank') || tags.includes('support')) ? 'elixiriron' : 'elixirwrath';
    const buffId = { elixirsorcery: 'elixir_sorcery', elixiriron: 'elixir_iron', elixirwrath: 'elixir_wrath' }[elixir];
    if (!champ.hasBuff(buffId) && canBuy(champ, elixir).ok) return elixir;
  }
  return null;
}

// 栏位满时建议出售的栏位（起始装备 → 药水 → 不在出装路线上的基础件）；-1 表示没有可卖的
export function sellCandidate(champ, build = null) {
  build = build || buildFor(champ);
  const needed = new Set();
  const addTree = (id) => { const d = ITEMS[id]; if (!d || needed.has(id)) return; needed.add(id); for (const f of d.from) addTree(f); };
  for (const id of purchaseOrder(build)) if (!hasItem(champ, id)) addTree(id);
  let best = -1, bestScore = 0;
  for (let i = 0; i < champ.items.length; i++) {
    const it = champ.items[i];
    if (!it || !it.def) continue;
    const d = it.def;
    let score = 0;
    if (d.tier === 'starter' && d.unique !== 'rolequest') score = 100;
    else if (d.id === 'healthpotion') score = 90;
    else if (d.id === 'refillable') score = 70;
    else if (d.id === 'controlward') score = 50;
    else if ((d.tier === 'basic' || d.tier === 'epic') && !needed.has(d.id)) score = 60 - d.cost / 100;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// AI 一次性完成购物：按规划循环购买，栏位满时出售建议栏位（返回购买的 id 列表）
export function autoShop(champ, build = null, { maxSteps = 12 } = {}) {
  const bought = [];
  if (!champ || !champ.canShop) return bought;
  build = build || buildFor(champ);
  for (let step = 0; step < maxSteps; step++) {
    const id = nextPurchase(champ, build);
    if (!id) {
      // 栏位已满而下一目标需要空位：出售起始装备后重试
      const target = purchaseOrder(build).find((t) => !hasItem(champ, t));
      if (!target || freeSlots(champ) > 0) break;
      const chk = canBuy(champ, target);
      const comp = chk.reason === '栏位已满' || (chk.reason === '金币不足' && freeSlots(champ) === 0);
      if (!comp) break;
      const slot = sellCandidate(champ, build);
      if (slot < 0) break;
      sell(champ, slot);
      continue;
    }
    const r = buy(champ, id);
    if (!r.ok) break;
    bought.push(id);
  }
  return bought;
}
