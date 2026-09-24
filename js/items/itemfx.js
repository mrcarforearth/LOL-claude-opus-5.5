// 装备效果工具：清理集合、隐藏计时器、凝滞、咒刃、衰减护盾、重伤、治疗加成、唯一被动登记、图标绘制
import { byLevel } from '../core/math.js';
import { creditChampion } from '../core/damage.js';

let UID = 0;
export const nextUid = () => ++UID;

// —— 判定 ——
export const isChamp = (u) => !!u && u.type === 'champion';
export const isMinion = (u) => !!u && u.type === 'minion';
export const isMonster = (u) => !!u && u.type === 'monster';
export const isStructureLike = (u) => !!u && (u.type === 'turret' || u.type === 'inhibitor' || u.type === 'nexus' || u.type === 'ward');
// 攻击特效是否对该目标生效（建筑与守卫不受攻击特效影响）
export const onHitOk = (u) => !!u && u.alive !== false && !isStructureLike(u);
// 远程英雄：有普攻弹道或射程 ≥ 300
export const isRanged = (u) => !!u && (((u.baseStats && u.baseStats.missileSpeed) || 0) > 0 || ((u.baseStats && u.baseStats.range) || 0) >= 300);
export const isEnemyOf = (champ, u) => !!u && u.team !== champ.team && u.alive !== false;
// 按英雄等级线性取值（1 级 a → 18 级 b）
export const lvl = (champ, a, b) => byLevel(champ.level || 1, a, b);
export { creditChampion };

// 冷却工具：写入 itemState 的 cooldownUntil / cdDuration（UI 转圈显示）
export function setCd(st, game, seconds) {
  st.cooldownUntil = game.time + seconds;
  st.cdDuration = seconds;
}
export const cdReady = (st, game) => !(st.cooldownUntil > game.time);

// —— 清理集合：被动 init 返回 bag.done() ——
export class Bag {
  constructor(champ) { this.champ = champ; this.fns = []; }
  add(fn) { if (typeof fn === 'function') this.fns.push(fn); return fn; }
  hook(name, fn) { return this.add(this.champ.addHook(name, fn)); }
  on(name, fn) { return this.add(this.champ.game.events.on(name, fn)); }
  done() {
    return () => {
      const list = this.fns.splice(0);
      for (let i = list.length - 1; i >= 0; i--) list[i]();
    };
  }
}

// —— 隐藏计时 Buff：每 tick（或每 interval 秒）回调；可附带动态属性 statsFn ——
export function ticker(champ, st, { onTick, interval = 0, statsFn, tag = 't' } = {}) {
  const def = {
    id: `item_${st.id}_${tag}_${st.uid}`, name: (st.def && st.def.name) || st.id, hidden: true, duration: Infinity,
    persistOnDeath: true, source: champ, data: {},
  };
  if (statsFn) def.statsFn = statsFn;
  if (onTick) {
    if (interval > 0) { def.tickInterval = interval; def.onInterval = () => onTick(interval); } else def.onTick = (u, b, dt) => onTick(dt);
  }
  const buff = champ.addBuff(def);
  return () => champ.removeBuff(buff);
}

// —— 同类唯一被动登记：返回「当前 st 是否为生效者」的判定函数与注销函数 ——
export function uniqueSlot(champ, key, st) {
  const reg = champ._itemUnique || (champ._itemUnique = {});
  const list = reg[key] || (reg[key] = []);
  list.push(st);
  return {
    primary: () => list[0] === st,
    release: () => { const i = list.indexOf(st); if (i >= 0) list.splice(i, 1); },
  };
}

// —— 治疗：若目标持有「受到治疗加成」（振奋盔甲），静默治疗时预先乘上加成（非静默治疗由事件监听补足） ——
export function healRecvMult(target) { return 1 + ((target && target._healRecvBonus) || 0); }
export function itemHeal(source, target, amount, opts = {}) {
  if (!target || !target.alive || !(amount > 0)) return 0;
  const amt = opts.silent ? amount * healRecvMult(target) : amount;
  return target.game.heal(source, target, amt, opts);
}

// —— 重伤 ——
export function applyGrievous(target, source, pct = 0.4, duration = 3, id = 'item_grievous') {
  if (!target || !target.alive || !target.addBuff || isStructureLike(target)) return null;
  return target.addBuff({
    id, name: '重伤', desc: `受到的治疗效果降低 ${Math.round(pct * 100)}%`, isDebuff: true, cleansable: false,
    source, duration, refresh: 'duration', stats: { grievous: pct },
    icon: { glyph: '伤', bg: ['#b8323a', '#3a0a10'], fg: '#fff' },
  });
}

// —— 衰减护盾：amount 在 duration 内线性衰减到 0 ——
export function decayShield(unit, amount, duration, { source = null, id = null, noPower = false, type = 'all' } = {}) {
  const s = unit.addShield(amount, duration, { source, id, noPower, type });
  if (!s) return null;
  const max = s.max;
  unit.addBuff({
    id: `decay_${s.id}`, hidden: true, duration, source, refresh: 'replace',
    onTick: (u, b) => {
      if (s.amount <= 0) { b.remove(); return; }
      const cap = max * Math.max(0, 1 - b.elapsed / duration);
      if (s.amount > cap) s.amount = cap;
    },
  });
  return s;
}

// —— 凝滞（中娅沙漏 / 守护天使）：无敌、不可选取、免疫控制、不能行动 ——
const STASIS_BLOCK = ['castAbility', 'castSummoner', 'useItem', 'useTrinket', 'startRecall'];
const blocked = () => ({ ok: false, reason: 'busy' });
export function inStasis(u) { return !!(u && u._stasis); }
export function enterStasis(champ, duration, { onEnd = null, color = 0xffd46a, kind = 'zhonya' } = {}) {
  if (!champ || !champ.alive || champ._stasis) return false;
  const game = champ.game;
  if (champ._interruptPendingCast) champ._interruptPendingCast('stasis');
  if (champ.dashState && champ._endDash) champ._endDash(true);
  if (champ.channel) champ.interruptChannel('stasis');
  champ.command = null;
  champ.path.length = 0;
  champ.attackState = null;
  const prev = { unstoppable: champ.unstoppable };
  const state = { kind, until: game.time + duration, ended: false };
  champ._stasis = state;
  champ.invulnerable = true;
  champ.untargetable = true;
  champ.unstoppable = true;
  champ.modelState.stasis = kind;
  for (const k of STASIS_BLOCK) champ[k] = blocked;
  const end = (interrupted) => {
    if (state.ended) return;
    state.ended = true;
    for (const k of STASIS_BLOCK) delete champ[k];
    champ.invulnerable = false;
    champ.untargetable = false;
    champ.unstoppable = prev.unstoppable;
    delete champ.modelState.stasis;
    if (champ._stasis === state) champ._stasis = null;
    if (onEnd) onEnd(interrupted);
  };
  state.end = end;
  champ.startChannel({
    id: 'stasis', duration, interruptOnMove: false, interruptOnDamage: false, canMove: false, canAttack: false, anim: 'stasis',
    onComplete: () => end(false),
    onInterrupt: () => end(true),
  });
  game.fx.shield({ unit: champ, color, duration, radius: 120 });
  game.fx.attach({ unit: champ, kind: 'sparkles', color, duration });
  return true;
}

// —— 咒刃（耀光 / 三相之力 / 巫妖之祸）：共享 1.5 秒冷却，多件时取伤害最高者 ——
export const SPELLBLADE_CD = 1.5;
export const SPELLBLADE_WINDOW = 10;
export function spellblade(champ, st, calc) {
  let sb = champ._spellblade;
  const game = champ.game;
  if (!sb) {
    sb = champ._spellblade = { sources: [], armedUntil: 0, cdUntil: 0, glow: null, unhook: [] };
    sb.unhook.push(champ.addHook('onAbilityCast', () => {
      const now = game.time;
      if (now < sb.cdUntil) return;
      sb.armedUntil = now + SPELLBLADE_WINDOW;
      if (sb.glow) sb.glow.remove();
      sb.glow = game.fx.attach({ unit: champ, kind: 'weaponGlow', color: 0x8fd8ff, duration: SPELLBLADE_WINDOW });
    }));
    sb.unhook.push(champ.addHook('onHit', (target, hit) => {
      const now = game.time;
      if (hit.phantom || hit.bolt || !(sb.armedUntil > now) || !target || target.type === 'ward') return;
      let best = null, bestVal = -1;
      for (const src of sb.sources) {
        const parts = src.calc(champ);
        let v = 0;
        for (const p of parts) v += p.amount;
        if (v > bestVal) { bestVal = v; best = { src, parts }; }
      }
      if (!best) return;
      for (const p of best.parts) hit.extra.push({ amount: p.amount, type: p.type, spell: p.spell || best.src.st.id });
      sb.armedUntil = 0;
      sb.cdUntil = now + SPELLBLADE_CD;
      for (const s of sb.sources) setCd(s.st, game, SPELLBLADE_CD);
      if (sb.glow) { sb.glow.remove(); sb.glow = null; }
      game.fx.impact({ x: target.x, y: target.y, color: 0x9fe0ff, size: 1.2 });
    }));
  }
  const entry = { st, calc };
  sb.sources.push(entry);
  return () => {
    const i = sb.sources.indexOf(entry);
    if (i >= 0) sb.sources.splice(i, 1);
    if (sb.sources.length === 0) {
      for (const f of sb.unhook) f();
      if (sb.glow) sb.glow.remove();
      if (champ._spellblade === sb) champ._spellblade = null;
    }
  };
}
// 咒刃是否处于蓄势状态（UI/测试用）
export function spellbladeArmed(champ) { const sb = champ._spellblade; return !!(sb && sb.armedUntil > champ.game.time); }

// —— 附近单位查询（按可选中过滤） ——
export function enemiesNear(champ, x, y, radius, types = ['champion', 'minion', 'monster', 'pet'], opts = {}) {
  return champ.game.queryUnits({ x, y, radius, enemyOf: champ, targetableBy: champ, types, ...opts }).filter((u) => !u.untargetable);
}
export function alliedChampsNear(champ, x, y, radius) {
  return champ.game.queryUnits({ x, y, radius, allyOf: champ, types: ['champion'] }).filter((u) => u.alive && !u.untargetable);
}

// —— 图标绘制（UI 调用，传入 2D 上下文；模拟层不访问 DOM） ——
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export function makeIconDraw(icon) {
  return function draw(ctx, size) {
    const s = size;
    const r = s * 0.12;
    ctx.save();
    roundRectPath(ctx, 0, 0, s, s, r);
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, icon.bg[0]);
    g.addColorStop(1, icon.bg[1]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // 纹样：按类别绘制细纹，提升辨识度
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, s * 0.02);
    const p = icon.pattern || 'none';
    if (p === 'slash') { for (let i = -s; i < s * 2; i += s * 0.18) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - s, s); ctx.stroke(); } }
    else if (p === 'rune') { for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.14 * k, 0, Math.PI * 2); ctx.stroke(); } }
    else if (p === 'scale') { for (let yy = 0; yy < s; yy += s * 0.2) for (let xx = (yy / (s * 0.2)) % 2 ? s * 0.1 : 0; xx < s; xx += s * 0.2) { ctx.beginPath(); ctx.arc(xx, yy, s * 0.1, 0, Math.PI); ctx.stroke(); } }
    else if (p === 'dots') { for (let yy = s * 0.1; yy < s; yy += s * 0.2) for (let xx = s * 0.1; xx < s; xx += s * 0.2) { ctx.beginPath(); ctx.arc(xx, yy, s * 0.02, 0, Math.PI * 2); ctx.stroke(); } }
    ctx.globalAlpha = 1;
    // 高光与暗角
    const hl = ctx.createRadialGradient(s * 0.3, s * 0.22, 0, s * 0.3, s * 0.22, s * 0.75);
    hl.addColorStop(0, 'rgba(255,255,255,0.30)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, s, s);
    const vg = ctx.createRadialGradient(s / 2, s / 2, s * 0.35, s / 2, s / 2, s * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, s, s);
    ctx.restore();
    // 边框：传说金、史诗银、其余古铜
    ctx.save();
    roundRectPath(ctx, s * 0.03, s * 0.03, s * 0.94, s * 0.94, r * 0.9);
    ctx.lineWidth = Math.max(1, s * (icon.tier === 'legendary' ? 0.07 : 0.05));
    ctx.strokeStyle = icon.frame || '#8c7a5a';
    ctx.stroke();
    if (icon.tier === 'legendary') {
      roundRectPath(ctx, s * 0.1, s * 0.1, s * 0.8, s * 0.8, r * 0.6);
      ctx.lineWidth = Math.max(1, s * 0.015);
      ctx.strokeStyle = 'rgba(255,236,170,0.55)';
      ctx.stroke();
    }
    // 字形
    ctx.font = `900 ${Math.round(s * 0.54)}px "Noto Serif SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = s * 0.08;
    ctx.shadowOffsetY = s * 0.03;
    ctx.fillStyle = icon.fg || '#fff';
    ctx.fillText(icon.glyph, s / 2, s * 0.54);
    ctx.restore();
  };
}
