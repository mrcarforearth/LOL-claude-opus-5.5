// AI 购物：出门装、按 BUILDS 顺序合成（组件优先）、鞋子时机、药水/控制守卫补给、满栏位出售起始装
import * as ITEMS_MOD from '../items/items.js';
import * as SHOP from '../items/shop.js';

const items = () => ITEMS_MOD.ITEMS || {};
const builds = () => ITEMS_MOD.BUILDS || {};

// 常见消耗品 id（装备代理可能改名，按标签兜底）
function findItemId(pred) {
  const all = items();
  for (const id in all) if (pred(all[id])) return id;
  return null;
}
function potionId() {
  const all = items();
  if (all.healthpotion) return 'healthpotion';
  return findItemId((d) => d.tier === 'consumable' && /potion|药水/.test(`${d.id}${d.name}`) && !/refill|可充值/.test(`${d.id}${d.name}`));
}
function controlWardId() {
  const all = items();
  if (all.controlward) return 'controlward';
  return findItemId((d) => /control|控制守卫/.test(`${d.id}${d.name}`));
}

function owned(champ, id) { return champ.items.some((it) => it && it.id === id); }
function countOwned(champ, id) { let n = 0; for (const it of champ.items) if (it && it.id === id) n += it.stacks || 1; return n; }

function cost(champ, id) {
  try { return SHOP.effectiveCost ? SHOP.effectiveCost(champ, id) : (items()[id]?.cost ?? Infinity); } catch { return Infinity; }
}
function canBuy(champ, id) {
  try { return SHOP.canBuy(champ, id); } catch { return { ok: false }; }
}
function doBuy(champ, id) {
  try { return SHOP.buy(champ, id); } catch { return { ok: false }; }
}

// 某装备是否已被（更高级装备）包含
function containedIn(parentId, id, depth = 0) {
  if (depth > 6) return false;
  const d = items()[parentId];
  if (!d || !d.from) return false;
  for (const f of d.from) if (f === id || containedIn(f, id, depth + 1)) return true;
  return false;
}
function ownedOrBuilt(champ, id) {
  for (const it of champ.items) {
    if (!it) continue;
    if (it.id === id || containedIn(it.id, id)) return true;
  }
  return false;
}

export class ShopPlanner {
  constructor(champ, role) {
    this.champ = champ;
    this.role = role;
    const b = builds()[champ.championId] || this._defaultBuild(champ, role);
    this.build = b;
    const all = items();
    const valid = (id) => id && all[id];
    const core = (b.core || []).filter(valid);
    const boots = valid(b.boots) ? b.boots : null;
    // 顺序：第一件核心 → 二级鞋 → 其余核心 → 备选
    this.order = [];
    if (core.length) this.order.push(core[0]);
    if (boots) this.order.push(boots);
    for (let i = 1; i < core.length; i++) this.order.push(core[i]);
    for (const id of b.situational || []) if (valid(id) && !this.order.includes(id)) this.order.push(id);
    this.start = (b.start || []).filter(valid);
    this.boughtStart = false;
  }

  _defaultBuild(champ, role) {
    const all = items();
    const pick = (...ids) => ids.find((id) => all[id]);
    const ap = (champ.def.tags || []).includes('法师');
    if (role === 'support') return { start: [pick('worldatlas', 'doransshield'), pick('healthpotion')].filter(Boolean), core: [pick('locket'), pick('sunfire')].filter(Boolean), boots: pick('mercs', 'boots') };
    if (role === 'jungle') return { start: [pick('huntersmachete'), pick('healthpotion')].filter(Boolean), core: [pick('blackcleaver'), pick('steraks')].filter(Boolean), boots: pick('plated', 'boots') };
    if (ap) return { start: [pick('doransring'), pick('healthpotion')].filter(Boolean), core: [pick('luden'), pick('rabadon'), pick('zhonya')].filter(Boolean), boots: pick('sorcshoes', 'boots') };
    return { start: [pick('doransblade'), pick('healthpotion')].filter(Boolean), core: [pick('infinityedge'), pick('bloodthirster')].filter(Boolean), boots: pick('berserkers', 'boots') };
  }

  // 下一件目标装备（未拥有的第一件）
  nextTarget() {
    const c = this.champ;
    for (const id of this.order) if (!owned(c, id)) return id;
    return null;
  }

  // 距离下一次「有意义」购买还差多少金币（回城判断用）
  nextPurchaseCost() {
    const c = this.champ;
    const target = this.nextTarget();
    if (!target) return Infinity;
    const full = cost(c, target);
    // 可以买到的最贵组件
    const comp = this._bestComponent(target, Infinity);
    const compCost = comp ? cost(c, comp) : full;
    return Math.min(full, Math.max(compCost, 300));
  }

  // 目标装备合成树里、当前金币买得起的最贵组件
  _bestComponent(id, budget, depth = 0) {
    const c = this.champ;
    const d = items()[id];
    if (!d || depth > 5) return null;
    let best = null, bestCost = -1;
    for (const f of d.from || []) {
      if (ownedOrBuilt(c, f) && countOwned(c, f) >= (d.from.filter((x) => x === f).length)) continue;
      const fc = cost(c, f);
      if (fc <= budget && fc > bestCost) { best = f; bestCost = fc; }
      // 更深层的组件
      const deeper = this._bestComponent(f, budget, depth + 1);
      if (deeper) {
        const dc = cost(c, deeper);
        if (dc <= budget && dc > bestCost && fc > budget) { best = deeper; bestCost = dc; }
      }
    }
    return best;
  }

  // 满栏位时出售一件（起始装/消耗品/低价组件）
  _makeRoom(forId) {
    const c = this.champ;
    if (c.items.some((it) => !it)) return true;
    const keepTags = new Set(['jungle']);
    let idx = -1, bestVal = Infinity;
    c.items.forEach((it, i) => {
      if (!it) return;
      const d = it.def || {};
      if ((d.tags || []).some((t) => keepTags.has(t)) && this.role === 'jungle') return;
      if (d.tier === 'legendary' || d.tier === 'boots') return;
      if (forId && containedIn(forId, it.id)) return;
      let val = d.cost || 0;
      if (d.tier === 'starter') val -= 5000;
      else if (d.tier === 'consumable') val -= 3000;
      if (val < bestVal) { bestVal = val; idx = i; }
    });
    if (idx < 0) return false;
    try { return SHOP.sell(c, idx).ok; } catch { return false; }
  }

  // 在泉水（或阵亡）时购物；返回本次购买的件数
  shop(gameTime) {
    const c = this.champ;
    if (!c.canShop) return 0;
    let bought = 0;
    if (!this.boughtStart) {
      this.boughtStart = true;
      for (const id of this.start) if (doBuy(c, id).ok) bought++;
      // 剩余金币补药水
      const pot = potionId();
      while (pot && c.gold >= cost(c, pot) && countOwned(c, pot) < 2 && canBuy(c, pot).ok && this.role !== 'jungle') { doBuy(c, pot); bought++; }
      return bought;
    }
    let guard = 0;
    while (guard++ < 10) {
      const target = this.nextTarget();
      if (!target) break;
      const chk = canBuy(c, target);
      if (chk.ok) { if (doBuy(c, target).ok) { bought++; continue; } break; }
      if (chk.reason === '栏位已满' || c.items.every((it) => it)) {
        if (this._makeRoom(target)) continue;
        break;
      }
      if (chk.reason === '唯一限制') {
        // 例如已有一双别的二级鞋：跳过该目标
        this.order = this.order.filter((x) => x !== target);
        continue;
      }
      // 买组件：优先最贵的可负担组件
      const comp = this._bestComponent(target, c.gold);
      if (comp) {
        const cc = canBuy(c, comp);
        if (cc.ok) { if (doBuy(c, comp).ok) { bought++; continue; } }
        else if (cc.reason === '栏位已满' && this._makeRoom(target)) continue;
      }
      // 早期先买一双基础鞋
      const bootsTarget = this.order.find((id) => (items()[id]?.tier === 'boots'));
      if (bootsTarget && !ownedOrBuilt(c, 'boots') && items().boots && c.gold >= cost(c, 'boots') && canBuy(c, 'boots').ok) {
        if (doBuy(c, 'boots').ok) { bought++; continue; }
      }
      break;
    }
    // 补给：药水（前期）、控制守卫（辅助/打野）
    const pot = potionId();
    if (pot && gameTime < 14 * 60 && c.items.filter((it) => !it).length >= 2 && countOwned(c, pot) < 2 && c.gold >= cost(c, pot) + 25) {
      if (canBuy(c, pot).ok) { doBuy(c, pot); bought++; }
    }
    const cw = controlWardId();
    if (cw && (this.role === 'support' || this.role === 'jungle' || gameTime > 20 * 60) && gameTime > 150 && !owned(c, cw) && c.items.some((it) => !it) && c.gold >= cost(c, cw)) {
      if (canBuy(c, cw).ok) { doBuy(c, cw); bought++; }
    }
    return bought;
  }
}

// 查找背包中的药水/控制守卫栏位
export function findPotionSlot(champ) {
  for (let i = 0; i < champ.items.length; i++) {
    const it = champ.items[i];
    if (!it || !it.def?.consumable) continue;
    const key = `${it.id}${it.def.name || ''}`;
    if (/potion|药水|biscuit|饼干/.test(key)) {
      if (it.def.consumable.keepWhenEmpty && it.charges != null && it.charges <= 0) continue;
      return i;
    }
  }
  return -1;
}
export function findControlWardSlot(champ) {
  for (let i = 0; i < champ.items.length; i++) {
    const it = champ.items[i];
    if (!it || !it.def?.consumable) continue;
    if (/control|控制守卫/.test(`${it.id}${it.def.name || ''}`)) return i;
  }
  return -1;
}
