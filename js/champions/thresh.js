// 英雄：锤石（魂锁典狱长）—— 辅助 · 法力
//
// 被动 地狱诅咒：附近阵亡的敌人掉落灵魂，锤石/灯笼靠近即可收集，每个灵魂永久 +0.75 护甲与法术强度（护甲不随等级成长）
// Q 死亡判决 / 死亡飞跃：0.5 秒蓄力后抛出锁链，钩中眩晕并拉拽 1.5 秒；再次施放飞向目标。命中后冷却 -3 秒
// W 魂引之灯：投掷灯笼（停留 6 秒），为锤石与首个靠近的友方英雄提供护盾；友方靠近灯笼被拉回锤石身边
// E 厄运钟摆：被动普攻附带随时间增长的魔法伤害；主动沿直线横扫前后两侧，按指向方向击退/拉回并减速
// R 幽冥监牢：0.75 秒后召唤五面幽魂墙，敌方英雄穿墙时墙碎裂并受到伤害与 99% 减速（之后的墙减半）
import { rv, fmt, pct, scaleText, isLargeMonster, predictPosition } from './_common.js';
import { clamp } from '../core/math.js';

// —— 数值表（LoL 当前版本附近） ——
// 被动
const P_RANGE = 1900;            // 敌人死亡时掉落灵魂的范围
const P_LIFE = 15;               // 灵魂存在时间
const P_PICKUP = 150;            // 收集半径（锤石/灯笼）
const P_CHANCE = 1 / 3;          // 小兵、大型野怪掉落几率
const P_ARMOR = 0.75;            // 每个灵魂的护甲
const P_AP = 0.75;               // 每个灵魂的法术强度
const P_SEEK_RANGE = 650;        // AI 主动拾取灵魂的距离
// Q
const Q_BASE = [100, 150, 200, 250, 300];
const Q_AP = 1.0;
const Q_CD = [20, 18, 16, 14, 12];
const Q_COST = [70, 70, 70, 70, 70];
const Q_RANGE = 1100;
const Q_WIDTH = 70;              // 锁链碰撞半径
const Q_SPEED = 1900;
const Q_CAST = 0.5;
const Q_STUN = 1.5;
const Q_WINDOW = 1.5;            // 死亡飞跃窗口
const Q_HIT_CDR = 3;             // 命中后冷却缩短
const Q_PULL_STOP = 175;         // 拉拽结束时离锤石的距离
const Q2_SPEED = 1400;
// W
const W_RANGE = 950;
const W_SHIELD = [60, 85, 110, 135, 160];
const W_SOUL = 1;                // 每个灵魂额外护盾
const W_SHIELD_DUR = 2;
const W_DUR = 6;                 // 灯笼停留时间
const W_CD = [22, 20.5, 19, 17.5, 16];
const W_COST = [50, 55, 60, 65, 70];
const W_SPEED = 1500;            // 灯笼飞行速度
const W_CLICK = 120;             // 友方靠近多少码时被拉回
const W_SHIELD_RADIUS = 220;     // 友方获得护盾的范围
const W_PULL_MIN = 350;          // 离锤石已足够近的友方不拉
const W_SEEK_RANGE = 800;        // AI 队友危险时主动走向灯笼的距离
// E
const E_BASE = [75, 120, 165, 210, 255];
const E_AP = 0.4;
const E_SLOW = [0.2, 0.25, 0.3, 0.35, 0.4];
const E_SLOW_DUR = 1;
const E_CD = [13, 12, 11, 10, 9];
const E_COST = [60, 65, 70, 75, 80];
const E_HALF = 537;              // 前后各延伸长度
const E_WIDTH = 110;             // 横扫宽度（全宽）
const E_CAST = 0.389;
const E_KNOCK = 220;             // 击退/拉回距离
const E_KNOCK_DUR = 0.35;
const E_BEHIND_STOP = 60;        // 拉回时停在锤石身侧，不会越过锤石
const E_PAS = [0.8, 1.1, 1.4, 1.7, 2.0]; // 被动：满充能时的 AD 比例
const E_CHARGE = 10;             // 被动充满所需时间（距上次普攻）
// R
const R_BASE = [250, 400, 550];
const R_AP = 1.0;
const R_SLOW = 0.99;
const R_SLOW_DUR = 2;
const R_RADIUS = 450;
const R_DUR = 5;
const R_CAST = 0.75;
const R_WALLS = 5;
const R_CD = [140, 120, 100];
const R_COST = [100, 100, 100];

const SOUL = 0x5affb8;           // 幽绿
const SOUL_DARK = 0x1c8a64;
const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });
const ICONS = {
  P: icon('魂', '#7affc8', '#0a2a20'),
  Q: icon('钩', '#5affb8', '#0b3a2a'),
  Q2: icon('跃', '#9dffd6', '#0f4a36'),
  W: icon('灯', '#c2ffe6', '#115c44'),
  E: icon('摆', '#8fe8c4', '#163c2e'),
  R: icon('牢', '#6affb0', '#05241a'),
};

// —— 数值计算（导出供测试） ——
export function threshSouls(champ) { return champ?.getBuff?.('thresh_souls')?.stacks || 0; }
export function threshQDamage(champ, rank) { return rv(Q_BASE, rank) + Q_AP * (champ?.stats?.ap || 0); }
export function threshWShield(champ, rank) { return rv(W_SHIELD, rank) + W_SOUL * threshSouls(champ); }
export function threshEDamage(champ, rank) { return rv(E_BASE, rank) + E_AP * (champ?.stats?.ap || 0); }
// 厄运钟摆被动：灵魂数 + 充能比例 × AD 比例 × AD
export function threshEPassive(champ, rank, elapsed) {
  const charge = clamp((elapsed || 0) / E_CHARGE, 0, 1);
  return threshSouls(champ) + charge * rv(E_PAS, rank) * (champ?.stats?.ad || 0);
}
export function threshRDamage(champ, rank) { return rv(R_BASE, rank) + R_AP * (champ?.stats?.ap || 0); }
export const THRESH = {
  P_RANGE, P_LIFE, P_PICKUP, P_CHANCE, P_ARMOR, P_AP, Q_RANGE, Q_WIDTH, Q_SPEED, Q_CAST, Q_STUN, Q_WINDOW, Q_HIT_CDR, Q_PULL_STOP,
  W_RANGE, W_SHIELD_DUR, W_DUR, W_CLICK, W_SHIELD_RADIUS, W_PULL_MIN, E_HALF, E_WIDTH, E_KNOCK, E_CHARGE, E_SLOW_DUR,
  R_RADIUS, R_DUR, R_CAST, R_SLOW, R_SLOW_DUR,
};

// ———————————————— 被动：灵魂 ————————————————
// 敌方单位阵亡：按类型决定是否掉落灵魂
function soulChance(u) {
  if (!u) return 0;
  if (u.type === 'champion') return 1;
  if (u.type === 'minion') return P_CHANCE;
  if (u.type === 'monster') return u.epic ? 1 : (isLargeMonster(u) ? P_CHANCE : 0);
  return 0;
}

function onUnitDeath(champ, u) {
  if (!u || u === champ || !champ.alive || u.team === champ.team) return;
  const chance = soulChance(u);
  if (chance <= 0) return;
  if (Math.hypot(u.x - champ.x, u.y - champ.y) > P_RANGE) return;
  if (chance < 1 && champ.game.rng() >= chance) return;
  spawnSoul(champ, u.x, u.y);
}

// 生成灵魂（区域 + 自定义特效 'thresh_soul'），每 tick 检查锤石/灯笼是否靠近
export function spawnSoul(champ, x, y) {
  const game = champ.game;
  const st = champ.passive.state;
  const zone = game.spawnZone({
    owner: champ, team: champ.team, x, y, radius: P_PICKUP, duration: P_LIFE, tickInterval: 1e9,
    filter: 'ally', types: ['champion'],
    vfx: { kind: 'thresh_soul', fallback: 'disc', color: SOUL, radius: 40, teamOnly: champ.team, duration: P_LIFE },
    data: { soul: true, ignoreUntil: 0 },
    onUpdate: (z) => trySoulPickup(champ, z),
    onEnd: (z) => { st.souls = (st.souls || []).filter((s) => s !== z); },
  });
  (st.souls || (st.souls = [])).push(zone);
  return zone;
}

function trySoulPickup(champ, z) {
  if (z.dead || !champ.alive) return;
  let from = null;
  if (Math.hypot(z.x - champ.x, z.y - champ.y) <= P_PICKUP + champ.radius) from = champ;
  else {
    const L = champ.abilities?.W?.state?.lantern;
    if (L && L.landed && L.zone && !L.zone.dead && Math.hypot(z.x - L.x, z.y - L.y) <= P_PICKUP) from = L;
  }
  if (!from) return;
  const game = champ.game;
  const b = champ.getBuff('thresh_souls');
  if (b) b.addStacks(1);
  champ.recalcStats();
  z.data.collected = true;
  z.remove();
  game.fx.custom('thresh_soul_collect', { x: z.x, y: z.y, unit: champ, viaLantern: from !== champ, lx: from.x, ly: from.y, color: SOUL });
  game.fx.text?.({ x: champ.x, y: champ.y, h: 230, text: `灵魂 ${threshSouls(champ)}`, color: SOUL, size: 15, duration: 0.8 });
}

// AI：空闲时主动走过去收集附近灵魂
const SEEK_BLOCK_MODES = new Set(['fighting', 'retreating', 'recalling', 'shopping', 'dead']);
function pickSoulToSeek(champ, st) {
  const ctl = champ.controller;
  const game = champ.game;
  if (!ctl || !champ.alive || !st.souls || st.souls.length === 0) return null;
  if (SEEK_BLOCK_MODES.has(ctl.mode) || champ.channel || champ.isRecalling) return null;
  const now = game.time;
  if (now - champ.lastDamagedAt < 3) return null;
  const foes = ctl.visibleEnemies?.(900);
  if (Array.isArray(foes) && foes.length > 0) return null;
  let best = null, bd = P_SEEK_RANGE;
  for (const z of st.souls) {
    if (z.dead || z.data.ignoreUntil > now) continue;
    const d = Math.hypot(z.x - champ.x, z.y - champ.y);
    if (d >= bd) continue;
    if (ctl.isUnderEnemyTurret?.(z.x, z.y) === true) continue;
    best = z; bd = d;
  }
  if (best && best !== st.seek) st.seekSince = now;
  // 超时仍未拾取：放弃这个灵魂
  if (best && now - (st.seekSince ?? now) > 4) { best.data.ignoreUntil = now + 60; return null; }
  return best;
}

// ———————————————— Q ————————————————
function startHitCooldown(ab) {
  ab.startCooldown(Math.max(0, ab.cooldownFor() - Q_HIT_CDR));
}

function hookHit(champ, ab, u, rank) {
  const game = champ.game;
  game.dealDamage(champ, u, threshQDamage(champ, rank), 'magic', { isAbility: true, spell: 'thresh_q' });
  game.fx.impact({ x: u.x, y: u.y, h: 90, color: SOUL, size: 1.3 });
  if (!u.alive) { startHitCooldown(ab); return; }
  const epic = u.type === 'monster' && u.epic;
  if (!epic) {
    u.applyCC('stun', Q_STUN, { source: champ });
    // 在眩晕期间把目标拉向锤石（位移不受韧性影响）
    const d = champ.distTo(u);
    const pull = d - Q_PULL_STOP;
    if (pull > 20) u.pullTo({ x: champ.x, y: champ.y, speed: Math.max(60, pull / Q_STUN), source: champ, stopDistance: Q_PULL_STOP, height: 25 });
  }
  u.addBuff({
    id: 'thresh_q_hooked', name: '死亡判决', desc: '被锤石的锁链钩住', icon: ICONS.Q, source: champ,
    duration: Q_WINDOW, isDebuff: true,
  });
  u.revealedUntil = Math.max(u.revealedUntil || 0, game.time + Q_WINDOW);
  game.vision?.addRevealer?.({ team: champ.team, follow: u, x: u.x, y: u.y, radius: 150, duration: Q_WINDOW, trueSight: true, seeBrush: true });
  game.fx.custom('thresh_q_chain', { from: champ, to: u, unit: champ, target: u, duration: Q_WINDOW, color: SOUL });
  game.fx.text?.({ x: u.x, y: u.y, h: 200, text: '死亡判决', color: SOUL, size: 18, duration: 0.9 });
  ab.state.hookTarget = u;
  ab.state.hookAt = game.time;
  ab.setRecast(Q_WINDOW, {
    cooldownOnExpire: false,
    onExpire: () => { ab.state.hookTarget = null; startHitCooldown(ab); },
  });
}

// ———————————————— W：灯笼 ————————————————
function removeLantern(champ) {
  const ws = champ.abilities.W.state;
  const L = ws.lantern;
  if (!L) return;
  ws.lantern = null;
  if (L.proj && !L.proj.dead) L.proj.kill('replaced');
  if (L.zone && !L.zone.dead) L.zone.remove();
  champ.modelState.lanternOut = false;
}

// 首个靠近灯笼的友方英雄获得护盾
function lanternShieldCheck(champ, L) {
  if (L.shielded) return;
  const game = champ.game;
  for (const a of game.champions) {
    if (a === champ || a.team !== champ.team || !a.alive || a.removed) continue;
    if (Math.hypot(a.x - L.x, a.y - L.y) > W_SHIELD_RADIUS + a.radius) continue;
    L.shielded = true;
    a.addShield(L.amount, W_SHIELD_DUR, { source: champ, id: 'thresh_w' });
    game.fx.shield({ unit: a, color: SOUL, duration: W_SHIELD_DUR, radius: 110 });
    return;
  }
}

function landLantern(champ, L, x, y) {
  const game = champ.game;
  const ws = champ.abilities.W.state;
  if (ws.lantern !== L) return;
  if (!game.nav.isWalkable(x, y)) { const p = game.nav.nearestWalkable(x, y); x = p.x; y = p.y; }
  L.landed = true; L.proj = null; L.x = x; L.y = y;
  L.zone = game.spawnZone({
    owner: champ, team: champ.team, x, y, radius: W_CLICK, duration: W_DUR, tickInterval: 1e9, filter: 'ally', types: ['champion'],
    vfx: { kind: 'thresh_lantern', fallback: 'ring', color: SOUL, radius: W_CLICK, duration: W_DUR },
    data: { lantern: L },
    onUpdate: (z) => lanternUpdate(champ, L, z),
    onEnd: () => {
      if (ws.lantern === L) { ws.lantern = null; champ.modelState.lanternOut = false; }
      game.fx.custom('thresh_lantern_return', { x: L.x, y: L.y, unit: champ, used: !!L.used, color: SOUL });
    },
  });
  game.fx.custom('thresh_lantern_land', { x, y, unit: champ, duration: W_DUR, color: SOUL });
  lanternShieldCheck(champ, L);
}

// AI 队友是否想使用灯笼：危险时，或锤石开团后身体健康的队友
function allyWantsLantern(a, L) {
  const ctl = a.controller;
  if (!ctl) return false;
  const now = a.game.time;
  const hp = a.hp / Math.max(1, a.maxHp);
  const mode = ctl.mode;
  if (mode === 'dead' || mode === 'shopping' || mode === 'recalling') return false;
  const danger = hp < 0.4 && (now - a.lastDamagedAt < 2.5 || mode === 'retreating');
  const engage = !!L.engage && hp > 0.5 && mode !== 'retreating';
  return danger || engage;
}

// 被标记的 AI 队友每 tick（在移动结算前）走向灯笼
function lanternSeekTick(u, b) {
  const L = b.data.L;
  if (!L || !L.zone || L.zone.dead) { b.remove(); return; }
  if (u.dashState || u.channel || u.castLock > 0 || u.attackState || !u.canMove()) return;
  const c = u.command;
  if (c && c.type === 'move' && Math.abs(c.x - L.x) < 4 && Math.abs(c.y - L.y) < 4) return;
  u.moveTo(L.x, L.y);
}

function pullAlly(champ, L, a) {
  const game = champ.game;
  const d = champ.distTo(a);
  const dur = clamp(d / 1700, 0.3, 0.75);
  const ok = a.dash({
    followTarget: champ, duration: dur, ignoreWalls: true, stopDistance: 70, arcHeight: 70,
    onEnd: () => { game.fx.burst?.({ x: a.x, y: a.y, h: 60, color: SOUL, count: 14, size: 14, speed: 220, duration: 0.45 }); },
  });
  if (!ok) return false;
  L.used = true;
  a.removeBuff('thresh_w_seek');
  game.fx.custom('thresh_lantern_pull', { unit: a, target: champ, from: champ, to: a, x: L.x, y: L.y, duration: dur, color: SOUL });
  return true;
}

function lanternUpdate(champ, L, z) {
  const game = champ.game;
  if (!champ.alive) { z.remove(); return; }
  lanternShieldCheck(champ, L);
  for (const a of game.champions) {
    if (a === champ || a.team !== champ.team || !a.alive || a.removed) continue;
    const d = Math.hypot(a.x - L.x, a.y - L.y);
    const nearThresh = champ.distTo(a) < W_PULL_MIN;
    if (d <= W_CLICK + a.radius) {
      if (nearThresh || a.dashState || !a.canDash()) continue;
      if (pullAlly(champ, L, a)) { z.remove(); return; }
      continue;
    }
    if (a.controller && !nearThresh && d <= W_SEEK_RANGE && allyWantsLantern(a, L)) {
      const b = a.addBuff({ id: 'thresh_w_seek', name: '魂引之灯', hidden: true, duration: 0.35, data: { L }, onTick: lanternSeekTick });
      b.data.L = L;
    }
  }
}

// ———————————————— E ————————————————
// 横扫后目标的新投影位置（沿施法方向）：前方推远，后方拉近但不越过锤石
function flayShift(s) {
  if (s >= 0) return E_KNOCK;
  return Math.max(0, Math.min(s + E_KNOCK, -E_BEHIND_STOP) - s);
}

// ———————————————— R ————————————————
function segCross(px, py, qx, qy, ax, ay, bx, by) {
  const rx = qx - px, ry = qy - py, sx = bx - ax, sy = by - ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((ax - px) * sy - (ay - py) * sx) / den;
  const w = ((ax - px) * ry - (ay - py) * rx) / den;
  return t >= 0 && t <= 1 && w >= 0 && w <= 1 ? t : -1;
}

function boxUpdate(champ, box, z) {
  const game = champ.game;
  for (const e of game.champions) {
    if (e.team === champ.team) continue;
    if (!e.alive || e.removed) { box.prev.delete(e); continue; }
    const p = box.prev.get(e);
    box.prev.set(e, { x: e.x, y: e.y });
    if (!p || (p.x === e.x && p.y === e.y) || e.untargetable) continue;
    if (Math.hypot(e.x - p.x, e.y - p.y) > 450) continue; // 回城/传送等瞬间转移不算穿墙（闪现 400 算）
    // 路径上首先穿过的墙
    let best = -1, bt = 2;
    for (let i = 0; i < R_WALLS; i++) {
      const a = box.verts[i], b = box.verts[(i + 1) % R_WALLS];
      const t = segCross(p.x, p.y, e.x, e.y, a.x, a.y, b.x, b.y);
      if (t >= 0 && t < bt) { bt = t; best = i; }
    }
    if (best < 0 || box.broken[best]) continue; // 从碎裂的缺口通过
    hitWall(champ, box, e, best);
  }
}

function hitWall(champ, box, e, i) {
  const game = champ.game;
  box.broken[i] = true;
  const n = box.count.get(e) || 0;
  box.count.set(e, n + 1);
  const mult = n === 0 ? 1 : 0.5;
  game.dealDamage(champ, e, threshRDamage(champ, box.rank) * mult, 'magic', { isAbility: true, spell: 'thresh_r' });
  if (e.alive) e.slow(R_SLOW, R_SLOW_DUR * mult, champ);
  const a = box.verts[i], b = box.verts[(i + 1) % R_WALLS];
  game.fx.custom('thresh_r_wall_break', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, x1: a.x, y1: a.y, x2: b.x, y2: b.y, index: i, unit: e, boxId: box.id, color: SOUL });
  game.fx.impact({ x: e.x, y: e.y, h: 90, color: SOUL, size: 1.5 });
}

// ———————————————— AI 辅助（可选链保护） ————————————————
function aiEnemies(ai, champ, radius) {
  const list = ai?.visibleEnemies?.(radius);
  if (Array.isArray(list)) return list.filter((e) => e && e.alive && e.type === 'champion' && !e.untargetable && champ.distTo(e) <= radius + (e.radius || 0));
  return champ.game.queryUnits({ x: champ.x, y: champ.y, radius, enemyOf: champ, targetableBy: champ, types: ['champion'] });
}
function aiAllies(ai, champ, radius) {
  const list = ai?.nearbyAllies?.(radius);
  if (Array.isArray(list)) return list.filter((a) => a && a.alive && a !== champ);
  return champ.game.queryUnits({ x: champ.x, y: champ.y, radius, allyOf: champ, types: ['champion'], exclude: champ });
}
function aiPredict(ai, unit, delay) {
  const p = ai?.predict?.(unit, delay);
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : predictPosition(unit, delay);
}
function aiUnderTurret(ai, champ, x, y) {
  const r = ai?.isUnderEnemyTurret?.(x, y);
  if (typeof r === 'boolean') return r;
  return champ.game.structures.some((s) => s.type === 'turret' && s.alive && s.team !== champ.team && Math.hypot(s.x - x, s.y - y) < 800);
}
function aiHp(ai, champ) {
  const v = ai?.hpPct?.();
  return typeof v === 'number' && Number.isFinite(v) ? v : champ.hp / champ.maxHp;
}
function aiParam(ai, key, def) {
  const v = ai?.params?.[key];
  return typeof v === 'number' ? v : def;
}
function aiContext(ai) { return typeof ai?.castContext === 'string' ? ai.castContext : null; }
const COMBAT_CTX = new Set(['fight', 'harass', 'peel']);
const combatOk = (ctx) => ctx === null || COMBAT_CTX.has(ctx);
function aiCastAt(ai, champ, slot, x, y) {
  let r = null;
  if (typeof ai?.castAt === 'function') r = ai.castAt(slot, x, y);
  else r = champ.castAbility(slot, { x, y });
  return !!r?.ok;
}
function aiCastSelf(ai, champ, slot) {
  let r = null;
  if (typeof ai?.castSelf === 'function') r = ai.castSelf(slot);
  else r = champ.castAbility(slot, {});
  return !!r?.ok;
}
// 钩子目标评分：优先射手/中单与残血
function hookScore(champ, e) {
  const role = e.role;
  const carry = role === 'adc' ? 1.6 : role === 'mid' ? 1.3 : 1;
  return carry * (1.6 - e.hp / Math.max(1, e.maxHp)) - champ.distTo(e) / 2500;
}
// 选择厄运钟摆方向：away 给出时让目标尽量远离该点，否则拉向锤石
function flayDirFor(champ, t, away = null) {
  const d = Math.max(1, champ.distTo(t));
  const vx = (t.x - champ.x) / d, vy = (t.y - champ.y) / d;
  if (!away) return { x: -vx, y: -vy };
  const push = { x: t.x + vx * E_KNOCK, y: t.y + vy * E_KNOCK };
  const pullS = -d;
  const pullShift = flayShift(pullS);
  const pull = { x: t.x - vx * pullShift, y: t.y - vy * pullShift };
  const dp = Math.hypot(push.x - away.x, push.y - away.y);
  const dl = Math.hypot(pull.x - away.x, pull.y - away.y);
  return dp >= dl ? { x: vx, y: vy } : { x: -vx, y: -vy };
}

// Q：预判钩敌方射手/残血；钩中后按局势决定是否死亡飞跃
function qAI(champ, ab, ai, game) {
  const ctx = aiContext(ai);
  if (ab.isRecastActive) {
    const t = ab.state.hookTarget;
    if (!t || !t.alive || t.removed || champ.dashState || ctx === 'escape') return false;
    const d = champ.distTo(t);
    if (t.type !== 'champion') {
      // 钩中小兵/野怪：旁边有残血敌方英雄才飞过去
      const prey = aiEnemies(ai, champ, 2000).find((e) => e.distTo(t) < 350 && e.hp / e.maxHp < 0.35);
      if (!prey || aiUnderTurret(ai, champ, t.x, t.y) || aiHp(ai, champ) < 0.5) return false;
      return !!champ.castAbility('Q', { target: t }).ok;
    }
    if (d < 420) return false; // 已被拉到身边，留给厄运钟摆
    const foes = aiEnemies(ai, champ, 2200).filter((e) => e.distTo(t) < 900).length;
    const friends = aiAllies(ai, champ, 1400).length + 1;
    const dive = !!ai?.diving;
    const safe = (dive || !aiUnderTurret(ai, champ, t.x, t.y)) && aiHp(ai, champ) > 0.35 && foes <= friends + 1;
    if (!safe) return false;
    // 等拉拽一段后再飞，给队友跟进时间
    if (ab.recastRemaining > 1.0 && friends < 2) return false;
    return !!champ.castAbility('Q', { target: t }).ok;
  }
  if (!combatOk(ctx)) return false;
  if (champ.mana < ab.cost) return false;
  const harass = ctx === 'harass';
  if (harass && (champ.mana < ab.cost + 120 || aiUnderTurret(ai, champ, champ.x, champ.y))) return false;
  const foes = aiEnemies(ai, champ, Q_RANGE + 100);
  if (foes.length === 0) return false;
  const pref = ai?.target && foes.includes(ai.target) ? ai.target : null;
  const ordered = foes.slice().sort((a, b) => hookScore(champ, b) + (b === pref ? 0.4 : 0) - hookScore(champ, a) - (a === pref ? 0.4 : 0));
  for (const t of ordered) {
    if (t.hasCC?.('airborne') && t.dashState?.forced) continue;
    if (harass && aiUnderTurret(ai, champ, t.x, t.y)) continue;
    const d0 = champ.distTo(t);
    const p = aiPredict(ai, t, Q_CAST + d0 / Q_SPEED);
    const pd = Math.hypot(p.x - champ.x, p.y - champ.y);
    if (pd > Q_RANGE - 40 || pd < 150) continue;
    // 小兵/野怪阻挡时不放
    const block = game.queryLine({
      x1: champ.x, y1: champ.y, x2: p.x, y2: p.y, width: Q_WIDTH, enemyOf: champ, types: ['minion', 'monster', 'pet'],
      filter: (u) => !u.untargetable && champ.distTo(u) < pd - 20,
    });
    if (block.length > 0) continue;
    if (game.rng() > 0.3 + aiParam(ai, 'accuracy', 0.7) * 0.6) return false;
    return aiCastAt(ai, champ, 'Q', p.x, p.y);
  }
  return false;
}

// W：灯笼救残血队友 / 开团后接队友 / 团战护盾
function wAI(champ, ab, ai, game) {
  if (champ.mana < ab.cost) return false;
  const now = game.time;
  const allies = aiAllies(ai, champ, W_RANGE + 400);
  // 1) 救人：残血且正被攻击的队友
  for (const a of allies) {
    const hp = a.hp / Math.max(1, a.maxHp);
    if (hp > 0.35 || now - a.lastDamagedAt > 1.5) continue;
    const d = champ.distTo(a);
    const foes = aiEnemies(ai, champ, 2200).filter((e) => e.distTo(a) < 800).length;
    if (foes === 0) continue;
    const p = d < W_PULL_MIN + 50 ? { x: a.x, y: a.y } : aiPredict(ai, a, 0.15 + Math.min(d, W_RANGE) / W_SPEED);
    return aiCastAt(ai, champ, 'W', p.x, p.y);
  }
  // 2) 死亡飞跃开团后，把灯笼丢给身后的健康队友
  const leapAt = champ.abilities.Q.state.leapAt ?? -99;
  if (now - leapAt < 1.5) {
    const mate = allies.find((a) => a.hp / a.maxHp > 0.5 && champ.distTo(a) > 600 && champ.distTo(a) < W_RANGE + 400);
    if (mate) {
      const d = champ.distTo(mate);
      const k = Math.min(1, (W_RANGE - 50) / d);
      ab.state.nextEngage = true;
      const ok = aiCastAt(ai, champ, 'W', champ.x + (mate.x - champ.x) * k, champ.y + (mate.y - champ.y) * k);
      if (!ok) ab.state.nextEngage = false;
      return ok;
    }
  }
  // 3) 团战护盾：自己或身边队友正在挨打
  const foesNear = aiEnemies(ai, champ, 900).length;
  if (foesNear === 0) return false;
  const hurt = [champ, ...allies.filter((a) => champ.distTo(a) < W_SHIELD_RADIUS + 200)]
    .find((a) => now - a.lastDamagedAt < 0.8 && a.hp / a.maxHp < 0.6);
  if (!hurt) return false;
  const mate = allies.find((a) => champ.distTo(a) < W_RANGE && now - a.lastDamagedAt < 1.2) || hurt;
  const p = mate === champ ? { x: champ.x + Math.cos(champ.facing) * 60, y: champ.y + Math.sin(champ.facing) * 60 } : { x: mate.x, y: mate.y };
  return aiCastAt(ai, champ, 'W', p.x, p.y);
}

// E：钩中后拉回 / 保护射手时推开 / 残血时推开追兵
function eAI(champ, ab, ai, game) {
  if (champ.mana < ab.cost) return false;
  const ctx = aiContext(ai);
  if (ctx !== null && !COMBAT_CTX.has(ctx) && ctx !== 'escape') return false;
  const foes = aiEnemies(ai, champ, E_HALF + 150);
  if (foes.length === 0) return false;
  const hooked = champ.abilities.Q.state.hookTarget;
  let t = hooked && foes.includes(hooked) ? hooked : (ai?.target && foes.includes(ai.target) ? ai.target : foes[0]);
  if (t.dashState && t.dashState.forced) return false; // 正在被拉拽，等拉完再用
  const p = aiPredict(ai, t, E_CAST);
  const d = Math.hypot(p.x - champ.x, p.y - champ.y);
  if (d > E_HALF - 20 + (t.radius || 0)) return false;
  let away = null;
  if (ctx === 'escape' || aiHp(ai, champ) < 0.3) away = { x: champ.x, y: champ.y };
  else if (ctx === 'peel') {
    const carry = aiAllies(ai, champ, 1200).find((a) => a.role === 'adc') || aiAllies(ai, champ, 1200)[0];
    const threat = carry ? foes.filter((e) => e.distTo(carry) < 550).sort((a, b) => a.distTo(carry) - b.distTo(carry))[0] : null;
    if (threat) { t = threat; away = { x: carry.x, y: carry.y }; }
  }
  if (ctx === 'harass' && !away && (champ.mana < ab.cost + 150 || aiUnderTurret(ai, champ, t.x, t.y))) return false;
  const dir = flayDirFor(champ, { x: p.x, y: p.y }, away);
  return aiCastAt(ai, champ, 'E', champ.x + dir.x * 420, champ.y + dir.y * 420);
}

// R：团战中心开（预判 0.75 秒后监牢内的敌方英雄数）
function rAI(champ, ab, ai, game) {
  if (champ.mana < ab.cost) return false;
  const ctx = aiContext(ai);
  if (ctx !== null && !COMBAT_CTX.has(ctx) && ctx !== 'escape') return false;
  const foes = aiEnemies(ai, champ, 1400);
  if (foes.length === 0) return false;
  const inside = foes.filter((e) => { const p = aiPredict(ai, e, R_CAST); return Math.hypot(p.x - champ.x, p.y - champ.y) <= R_RADIUS - 50; });
  if (inside.length >= 2) return aiCastSelf(ai, champ, 'R');
  if (inside.length === 0) return false;
  const e = inside[0];
  const friends = aiAllies(ai, champ, 1200).length;
  const hooked = champ.abilities.Q.state.hookTarget === e;
  const low = e.hp / Math.max(1, e.maxHp) < 0.45;
  const peel = (ctx === 'escape' || aiHp(ai, champ) < 0.35) && champ.distTo(e) < 350;
  if ((hooked && friends >= 1) || (low && friends >= 1 && ctx !== 'harass') || peel) return aiCastSelf(ai, champ, 'R');
  return false;
}

export default {
  id: 'thresh',
  name: '锤石',
  title: '魂锁典狱长',
  roles: ['support'],
  tags: ['辅助', '坦克'],
  difficulty: 3,
  lore: '暗影岛上扭曲而狡诈的典狱长，以锁链与灯笼折磨生者，把收集来的灵魂永远囚禁在他的魂灯之中。',
  baseStats: {
    hp: 620, hpPerLevel: 120, hpRegen: 7, hpRegenPerLevel: 0.55,
    mana: 274, manaPerLevel: 44, manaRegen: 6, manaRegenPerLevel: 0.8, resource: 'mana',
    ad: 56, adPerLevel: 2.2, as: 0.625, asRatio: 0.625, asPerLevel: 3.5,
    armor: 33, armorPerLevel: 0, mr: 30, mrPerLevel: 1.55,
    ms: 330, range: 450, radius: 65, windup: 0.3, critMult: 1.75,
    missileSpeed: 1000, attackVfx: { kind: 'thresh_aa', fallback: 'chain', color: SOUL, size: 0.8, trail: true },
  },
  model: { primary: 0x2a5a4a, secondary: 0x1a1a1a, accent: SOUL },
  portrait: { bg: ['#2a8a6a', '#081a14'], glyph: '锤' },

  // —— 被动：地狱诅咒 ——
  passive: {
    id: 'thresh_passive',
    name: '地狱诅咒',
    icon: ICONS.P,
    desc: (champ) => {
      const n = threshSouls(champ);
      return `锤石附近（${P_RANGE} 码）阵亡的敌人有几率掉落灵魂：敌方英雄与史诗野怪必定掉落，小兵与大型野怪有 1/3 几率掉落。灵魂存在 ${P_LIFE} 秒，锤石或魂引之灯靠近即可收集。\n`
        + `每个灵魂永久提供 ${P_ARMOR} 护甲和 ${P_AP} 法术强度。锤石的护甲不随等级成长。\n`
        + `已收集 ${n} 个灵魂（+${fmt(n * P_ARMOR, 2)} 护甲，+${fmt(n * P_AP, 2)} 法术强度）。`;
    },
    init(champ) {
      const st = champ.passive.state;
      const game = champ.game;
      st.souls = [];
      st.seek = null;
      st.seekCheck = 0;
      champ.addBuff({
        id: 'thresh_souls', name: '地狱诅咒', desc: `每个灵魂提供 ${P_ARMOR} 护甲和 ${P_AP} 法术强度`, icon: ICONS.P,
        duration: Infinity, persistOnDeath: true, stacks: 0, maxStacks: 9999,
        stats: { armor: P_ARMOR, ap: P_AP }, statsPerStack: true,
      });
      // AI 拾取灵魂：在移动结算前覆盖移动命令
      champ.addBuff({
        id: 'thresh_soul_seek', name: '地狱诅咒', hidden: true, duration: Infinity, persistOnDeath: true,
        onTick: (u) => {
          const s = u.passive.state.seek;
          if (!s || s.dead || !u.controller) return;
          if (u.attackState || u.channel || u.castLock > 0 || u.dashState || !u.canMove()) return;
          const c = u.command;
          if (c && c.type === 'move' && Math.abs(c.x - s.x) < 4 && Math.abs(c.y - s.y) < 4) return;
          u.moveTo(s.x, s.y);
        },
      });
      game.events.on('death', (e) => onUnitDeath(champ, e?.unit));
    },
    update(champ, dt) {
      const st = champ.passive.state;
      st.seekCheck -= dt;
      if (st.seekCheck > 0) return;
      st.seekCheck = 0.25;
      st.seek = pickSoulToSeek(champ, st);
    },
  },

  abilities: {
    // —— Q：死亡判决 / 死亡飞跃 ——
    Q: {
      id: 'thresh_q',
      name: '死亡判决',
      recastName: '死亡飞跃',
      icon: ICONS.Q,
      recastIcon: ICONS.Q2,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `死亡判决：锤石蓄力 ${Q_CAST} 秒后向指定方向抛出锁链（${Q_RANGE} 码），命中第一个敌人，造成 ${scaleText(champ, rv(Q_BASE, r), [[Q_AP, 'ap']])} 点魔法伤害，`
          + `眩晕目标 ${Q_STUN} 秒并在此期间将其拉向锤石。\n`
          + `死亡飞跃：钩中后 ${Q_WINDOW} 秒内再次施放，锤石沿锁链飞向被钩住的目标。\n`
          + `命中时冷却缩短 ${Q_HIT_CDR} 秒（冷却在锁链结束后开始）。`;
      },
      cooldown: Q_CD,
      cost: Q_COST,
      range: Q_RANGE,
      targeting: 'direction',
      indicator: { type: 'line', width: Q_WIDTH * 2, length: Q_RANGE },
      castTime: Q_CAST,
      lockMovement: true,
      manualCooldown: true,
      sfx: 'chain',
      onCastStart(champ, ctx) {
        champ.game.fx.custom('thresh_q_windup', { unit: champ, dirX: ctx.dirX, dirY: ctx.dirY, duration: Q_CAST, color: SOUL });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const rank = ctx.rank;
        // 未命中按完整冷却；命中后进入死亡飞跃窗口，窗口结束后按缩短的冷却重新计时
        ab.startCooldown();
        ab.state.hookTarget = null;
        game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, dirX: ctx.dirX, dirY: ctx.dirY, range: Q_RANGE, speed: Q_SPEED, width: Q_WIDTH,
          hits: 'first', height: 90,
          vfx: { kind: 'thresh_hook', fallback: 'hook', color: SOUL, size: 1.1, trail: false, chain: true, owner: champ },
          onHit: (u) => { hookHit(champ, ab, u, rank); return true; },
          onEnd: (p) => {
            if (p.endReason !== 'hit') game.fx.custom('thresh_q_miss', { x: p.x, y: p.y, unit: champ, dirX: ctx.dirX, dirY: ctx.dirY, color: SOUL });
          },
        });
      },
      recast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const t = ab.state.hookTarget;
        if (champ.dashState) return false;
        if (!t || !t.alive || t.removed || !t.hasBuff('thresh_q_hooked')) {
          ab.state.hookTarget = null;
          ab.endRecast(false);
          startHitCooldown(ab);
          return false;
        }
        const ok = champ.dash({
          followTarget: t, speed: Q2_SPEED, ignoreWalls: true, stopDistance: 60,
          onEnd: (interrupted) => {
            champ.modelState.leaping = false;
            if (!interrupted) game.fx.custom('thresh_q_leap_land', { x: champ.x, y: champ.y, unit: champ, color: SOUL });
          },
        });
        if (!ok) return false;
        champ.modelState.leaping = true;
        game.fx.custom('thresh_q_leap', { unit: champ, target: t, from: champ, to: t, duration: Math.max(0.15, champ.distTo(t) / Q2_SPEED), color: SOUL });
        ab.state.hookTarget = null;
        ab.state.leapAt = game.time;
        ab.endRecast(false);
        startHitCooldown(ab);
        return true;
      },
      // 被钩目标死亡：提前结束窗口
      update(champ, ab) {
        if (!ab.isRecastActive) return;
        const t = ab.state.hookTarget;
        if (!t || !t.alive || t.removed) {
          ab.state.hookTarget = null;
          ab.endRecast(false);
          startHitCooldown(ab);
        }
      },
      ai: {
        kind: 'cc', range: Q_RANGE - 50, width: Q_WIDTH, speed: Q_SPEED, delay: Q_CAST, collision: true,
        custom: qAI,
      },
    },

    // —— W：魂引之灯 ——
    W: {
      id: 'thresh_w',
      name: '魂引之灯',
      icon: ICONS.W,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const souls = threshSouls(champ);
        return `锤石向目标地点（${W_RANGE} 码）投掷灯笼，灯笼停留 ${W_DUR} 秒。锤石与灯笼附近的第一名友方英雄获得 ${fmt(rv(W_SHIELD, r) + W_SOUL * souls)}`
          + `（${rv(W_SHIELD, r)} + 灵魂数 ${souls}）点护盾，持续 ${W_SHIELD_DUR} 秒。\n`
          + `友方英雄靠近灯笼（${W_CLICK} 码内）时会被锁链拉回锤石身边，随后灯笼收回。灯笼也能收集附近的灵魂。`;
      },
      cooldown: W_CD,
      cost: W_COST,
      range: W_RANGE,
      targeting: 'point',
      indicator: { type: 'circle', radius: W_CLICK },
      castTime: 0.25,
      lockMovement: false,
      sfx: 'shield',
      cast(champ, ctx) {
        const game = champ.game;
        const ab = ctx.ability;
        const ws = ab.state;
        removeLantern(champ);
        const amount = threshWShield(champ, ctx.rank);
        champ.addShield(amount, W_SHIELD_DUR, { source: champ, id: 'thresh_w' });
        game.fx.shield({ unit: champ, color: SOUL, duration: W_SHIELD_DUR, radius: 115 });
        const L = { x: champ.x, y: champ.y, landed: false, zone: null, proj: null, shielded: false, used: false, amount, engage: !!ws.nextEngage };
        ws.nextEngage = false;
        ws.lantern = L;
        champ.modelState.lanternOut = true;
        const tx = ctx.x, ty = ctx.y;
        const d = Math.hypot(tx - champ.x, ty - champ.y);
        if (d < 40) { landLantern(champ, L, tx, ty); return; }
        L.proj = game.spawnProjectile({
          owner: champ, x: champ.x, y: champ.y, toX: tx, toY: ty, speed: W_SPEED, width: 0, hits: 'none', height: 130,
          vfx: { kind: 'thresh_lantern_throw', fallback: 'orb', color: SOUL, size: 1.1, trail: true },
          onUpdate: (p) => { L.x = p.x; L.y = p.y; lanternShieldCheck(champ, L); },
          onEnd: (p) => { if (p.endReason !== 'replaced') landLantern(champ, L, p.x, p.y); },
        });
      },
      ai: { kind: 'shield', range: W_RANGE, custom: wAI },
    },

    // —— E：厄运钟摆 ——
    E: {
      id: 'thresh_e',
      name: '厄运钟摆',
      icon: ICONS.E,
      maxRank: 5,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        const souls = threshSouls(champ);
        const maxAmt = threshEPassive(champ, r, E_CHARGE);
        return `被动：锤石的普攻额外造成魔法伤害，数值为灵魂数（${souls}）+ 0~${pct(rv(E_PAS, r))} 攻击力，随距上次普攻的时间在 ${E_CHARGE} 秒内逐渐增长（当前最多 ${fmt(maxAmt)}）。\n`
          + `主动：锤石挥动锁链横扫指向方向的前后两侧（各 ${E_HALF} 码），造成 ${scaleText(champ, rv(E_BASE, r), [[E_AP, 'ap']])} 点魔法伤害，`
          + `把敌人朝指向方向击退（向身后施放可把前方的敌人拉向自己），并减速 ${pct(rv(E_SLOW, r))}，持续 ${E_SLOW_DUR} 秒。可打断位移。`;
      },
      cooldown: E_CD,
      cost: E_COST,
      range: E_HALF,
      targeting: 'direction',
      indicator: { type: 'line', width: E_WIDTH, length: E_HALF, back: E_HALF },
      castTime: E_CAST,
      lockMovement: true,
      sfx: 'whoosh',
      onLearn(champ) {
        const game = champ.game;
        const st = champ.abilities.E.state;
        st.lastAttackAt = -99;
        champ.addHook('onHit', (target, hit) => {
          const ab = champ.abilities.E;
          if (ab.rank <= 0) return;
          const elapsed = game.time - (st.lastAttackAt ?? -99);
          st.lastAttackAt = game.time;
          const amt = threshEPassive(champ, ab.rank, elapsed);
          if (amt > 0) hit.extra.push({ amount: amt, type: 'magic', spell: 'thresh_e_passive' });
          if (elapsed >= E_CHARGE) game.fx.impact({ x: target.x, y: target.y, h: 90, color: SOUL, size: 1.1 });
        });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const dirX = ctx.dirX, dirY = ctx.dirY;
        const x1 = champ.x - dirX * E_HALF, y1 = champ.y - dirY * E_HALF;
        const x2 = champ.x + dirX * E_HALF, y2 = champ.y + dirY * E_HALF;
        const hits = game.queryLine({ x1, y1, x2, y2, width: E_WIDTH / 2, enemyOf: champ, filter: (u) => !u.untargetable });
        const dmg = threshEDamage(champ, ctx.rank);
        const slow = rv(E_SLOW, ctx.rank);
        game.fx.custom('thresh_e_flay', { unit: champ, x: champ.x, y: champ.y, dirX, dirY, halfLength: E_HALF, width: E_WIDTH, duration: 0.45, color: SOUL });
        for (const u of hits) {
          game.dealDamage(champ, u, dmg, 'magic', { isAbility: true, isAoE: true, spell: 'thresh_e' });
          if (!u.alive) continue;
          if (!(u.type === 'monster' && u.epic)) {
            const s = (u.x - champ.x) * dirX + (u.y - champ.y) * dirY;
            const shift = flayShift(s);
            if (shift > 5) u.knockback({ fromX: u.x - dirX * 100, fromY: u.y - dirY * 100, distance: shift, duration: E_KNOCK_DUR, source: champ, height: 70 });
          }
          u.slow(slow, E_SLOW_DUR, champ);
        }
      },
      ai: { kind: 'cc', range: E_HALF - 40, width: E_WIDTH / 2, delay: E_CAST, custom: eAI },
    },

    // —— R：幽冥监牢 ——
    R: {
      id: 'thresh_r',
      name: '幽冥监牢',
      icon: ICONS.R,
      maxRank: 3,
      desc: (champ, rank) => {
        const r = Math.max(1, rank);
        return `锤石蓄力 ${R_CAST} 秒后，在身边召唤由 ${R_WALLS} 面幽魂之墙组成的五边形监牢（半径 ${R_RADIUS}），持续 ${R_DUR} 秒。\n`
          + `敌方英雄穿过墙壁时会使其碎裂，受到 ${scaleText(champ, rv(R_BASE, r), [[R_AP, 'ap']])} 点魔法伤害并被减速 ${pct(R_SLOW)}，持续 ${R_SLOW_DUR} 秒；`
          + `同一英雄之后再穿过其他墙壁时，伤害与减速时长减半。`;
      },
      cooldown: R_CD,
      cost: R_COST,
      range: R_RADIUS,
      targeting: 'self',
      indicator: { type: 'self', radius: R_RADIUS },
      castTime: R_CAST,
      lockMovement: true,
      sfx: 'magic',
      onCastStart(champ) {
        const game = champ.game;
        game.fx.custom('thresh_r_cast', { unit: champ, x: champ.x, y: champ.y, radius: R_RADIUS, duration: R_CAST, color: SOUL });
        game.fx.telegraph?.({ x: champ.x, y: champ.y, radius: R_RADIUS, color: SOUL_DARK, duration: R_CAST });
      },
      cast(champ, ctx) {
        const game = champ.game;
        const cx = champ.x, cy = champ.y;
        // 正前方为一面墙的中点
        const a0 = champ.facing + Math.PI / R_WALLS;
        const verts = [];
        for (let k = 0; k < R_WALLS; k++) {
          const a = a0 + (k * Math.PI * 2) / R_WALLS;
          verts.push({ x: cx + Math.cos(a) * R_RADIUS, y: cy + Math.sin(a) * R_RADIUS });
        }
        const box = {
          id: (champ.abilities.R.state.boxSeq = (champ.abilities.R.state.boxSeq || 0) + 1),
          x: cx, y: cy, radius: R_RADIUS, angle: a0, verts, rank: ctx.rank,
          broken: new Array(R_WALLS).fill(false), count: new Map(), prev: new Map(),
        };
        for (const e of game.champions) if (e.team !== champ.team && e.alive) box.prev.set(e, { x: e.x, y: e.y });
        champ.abilities.R.state.box = box;
        game.spawnZone({
          owner: champ, team: champ.team, x: cx, y: cy, radius: R_RADIUS, duration: R_DUR, tickInterval: 1e9,
          filter: 'enemy', types: ['champion'], vfx: null, data: box,
          onUpdate: (z) => boxUpdate(champ, box, z),
          onEnd: () => {
            if (champ.abilities.R.state.box === box) champ.abilities.R.state.box = null;
            game.fx.custom('thresh_r_end', { x: cx, y: cy, radius: R_RADIUS, boxId: box.id, broken: box.broken, color: SOUL });
          },
        });
        game.fx.custom('thresh_r_box', {
          x: cx, y: cy, radius: R_RADIUS, duration: R_DUR, angle: a0, walls: R_WALLS, verts, broken: box.broken, boxId: box.id, unit: champ, color: SOUL,
        });
        game.fx.ring({ x: cx, y: cy, radius: R_RADIUS, color: SOUL, duration: 0.5, expand: true });
      },
      ai: { kind: 'aoe', range: 0, radius: R_RADIUS - 50, delay: R_CAST, minTargets: 2, custom: rAI },
    },
  },

  ai: { skillOrder: ['Q', 'E', 'W'], style: 'support', engageRange: 1050, kiteDistance: 300, combo: ['Q', 'E', 'R', 'W'] },
};
