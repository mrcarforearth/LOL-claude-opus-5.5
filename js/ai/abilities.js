// AI 技能施放（控制器混入）：按技能 ai 提示（kind/range/radius/speed/width/delay/minTargets/farm/when/custom）通用施放，
// 直线技能预判、小兵阻挡检测、大招价值判断、护盾/治疗队友、切换技能、逃生位移、再次施放
import { abilityHint, abilityRange, comboDamage, effectiveHp, damageTypeOf, abilityDamage } from './combat.js';

const SLOTS = ['Q', 'W', 'E', 'R'];
const OFFENSIVE = new Set(['nuke', 'cc', 'aoe', 'execute', 'gapclose']);

export const AbilityMixin = {
  // 施法顺序：英雄定义的 combo 优先，其余补齐
  _slotOrder() {
    if (this._order) return this._order;
    const combo = (this.champ.def.ai?.combo || []).filter((s) => SLOTS.includes(s));
    this._order = [...new Set([...combo, ...SLOTS])];
    return this._order;
  },

  // 安全调用英雄定义的 when
  _when(hint, target) {
    if (!hint.when) return true;
    try { return !!hint.when(this.champ, target, this.game, this); } catch (err) { this._reportCustomError('when', err); return false; }
  },

  // 主入口：ctx ∈ fight | harass | farm | push | jungle | escape | peel | idle；返回是否施放了技能
  _useAbilities(ctx, target = null) {
    const c = this.champ;
    if (c.castLock > 0 || !c.canCast() || !c.alive) return false;
    const now = this.game.time;
    this.castContext = ctx;
    for (const slot of this._slotOrder()) {
      const ab = c.abilities[slot];
      if (!ab || ab.rank <= 0) continue;
      const hint = abilityHint(ab);
      if (hint.custom) {
        if (!(ab.ready || ab.isRecastActive)) continue;
        if ((this._customOff.get(slot) || 0) > now) continue;
        let r = false;
        try { r = hint.custom(c, ab, this, this.game); } catch (err) { this._customOff.set(slot, now + 10); this._reportCustomError(`${slot}.custom`, err); }
        if (r) { this.lastCastAt = now; return true; }
        if (c.castLock > 0) return true;
        continue;
      }
      if (ab.isRecastActive) {
        if (this._genericRecast(ab, hint, ctx, target)) { this.lastCastAt = now; return true; }
        continue;
      }
      if (!ab.ready) continue;
      if (!c._canPay(ab.costType, ab.cost)) continue;
      let ok = false;
      try { ok = this._genericCast(ab, hint, ctx, target); } catch (err) { this._reportCustomError(`${slot}.cast`, err); ok = false; }
      if (ok) { this.lastCastAt = now; return true; }
    }
    return false;
  },

  _genericCast(ab, hint, ctx, target) {
    const kind = hint.kind;
    switch (kind) {
      case 'shield': case 'heal': return this._castSupportive(ab, hint, ctx, target);
      case 'escape': return ctx === 'escape' ? this._castEscape(ab, hint) : false;
      case 'toggle': return this._castToggle(ab, hint, ctx, target);
      case 'selfbuff': return this._castSelfBuff(ab, hint, ctx, target);
      case 'farm': return (ctx === 'farm' || ctx === 'push' || ctx === 'jungle') ? this._castFarm(ab, hint, ctx, target) : false;
      case 'global': return this._castGlobal(ab, hint, ctx, target);
      default: break;
    }
    if (!OFFENSIVE.has(kind)) return false;
    if (ctx === 'escape') {
      // 逃跑时：控制技能打追兵；位移技能（点目标）朝安全方向
      if (kind === 'cc' && target && target.type === 'champion') return this._castOffensive(ab, hint, target, { escape: true });
      if (kind === 'gapclose' && (hint.targeting === 'point' || hint.targeting === 'direction') && this.hpPct() < 0.3 && hint.raw.escape !== false) return this._castEscape(ab, hint);
      return false;
    }
    if (ctx === 'farm' || ctx === 'push' || ctx === 'jungle') {
      if (ab.slot === 'R') return false;
      if (hint.farm || (ctx === 'jungle' && kind !== 'gapclose' && kind !== 'execute') || (ctx === 'push' && kind === 'aoe')) return this._castFarm(ab, hint, ctx, target);
      return false;
    }
    if (ctx === 'idle') return false;
    if (!target || target.type !== 'champion' || !target.alive) return false;
    if (ctx === 'peel' && kind !== 'cc') return false;
    const isR = ab.slot === 'R';
    if (ctx === 'harass') {
      if (isR || kind === 'gapclose' || kind === 'execute') return false;
      if (this._usesMana() && this.manaPct() < this.harassMana) return false;
      if (kind === 'cc' && this.game.rng() > 0.35 + this.params.aggression * 0.3) return false;
    }
    if (isR && !this._worthUlt(ab, hint, target)) return false;
    if (kind === 'execute' && !hint.when && target.hp / target.maxHp > 0.3) return false;
    if (kind === 'gapclose') {
      const d = this.champ.distTo(target);
      const melee = this.champ.stats.attackRange + this.champ.radius + target.radius + 40;
      if (d <= melee && !hint.when && hint.targeting !== 'self') return false;
      if (this.isUnderEnemyTurret(target.x, target.y) && !this.diving) return false;
    }
    if (kind === 'cc' && target.isHardCCd?.() && target.ccRemaining?.('stun') > 0.5) return false; // 不叠控
    if (kind === 'aoe') return this._castAoe(ab, hint, ctx, target);
    return this._castOffensive(ab, hint, target);
  },

  // 对敌方英雄的指向/直线/自身范围技能
  _castOffensive(ab, hint, target, opts = {}) {
    const c = this.champ;
    if (!this._when(hint, target)) return false;
    const tg = hint.targeting;
    const range = abilityRange(ab, hint);
    const d = c.distTo(target);
    if (tg === 'unit') {
      if (hint.filter === 'ally' || hint.filter === 'allyChampion') return false;
      if (d > range + target.radius + 5) return false;
      return this.castOn(ab.slot, target).ok;
    }
    if (tg === 'self' || tg === 'none') {
      const r = hint.radius || range || c.stats.attackRange + 120;
      if (d > r + target.radius) return false;
      return this.castSelf(ab.slot).ok;
    }
    // 点/方向：预判
    const speed = hint.speed || 0;
    const delay = hint.delay ?? ab.castTime ?? 0.25;
    const p = this.predict(target, delay + (speed > 0 ? Math.max(0, d - target.radius) / speed : 0));
    const pd = Math.hypot(p.x - c.x, p.y - c.y);
    const reach = range + (hint.radius ? hint.radius * 0.5 : (hint.width || 30)) + target.radius * 0.5;
    if (pd > reach) return false;
    if (range > 0 && pd < 40 && tg === 'direction') { /* 贴脸：直接朝目标 */ }
    if (this._blocked(hint, p, target)) return false;
    return this.castAt(ab.slot, p.x, p.y).ok;
  },

  // 直线技能是否被敌方小兵挡住（仅对会碰撞的技能）
  _blocked(hint, p, target) {
    const collides = hint.collision === true || (hint.collision !== false && hint.kind === 'cc' && hint.targeting === 'direction');
    if (!collides) return false;
    const c = this.champ;
    const w = Math.max(30, hint.width || 60);
    const dist = Math.hypot(p.x - c.x, p.y - c.y) || 1;
    const hits = this.game.queryLine({ x1: c.x, y1: c.y, x2: p.x, y2: p.y, width: w, enemyOf: c, types: ['minion', 'monster', 'pet'], sort: false });
    for (const u of hits) {
      if (u === target || u.untargetable) continue;
      const t = u._qd ?? 0; // queryLine 写入的投影参数
      if (t * dist < Math.max(0, c.distTo(target) - target.radius - 20)) return true;
    }
    return false;
  },

  // 范围技能：统计命中人数
  _castAoe(ab, hint, ctx, target) {
    const c = this.champ;
    if (!this._when(hint, target)) return false;
    const tg = hint.targeting;
    const range = abilityRange(ab, hint);
    const radius = hint.radius || (tg === 'self' || tg === 'none' ? range : 250) || 250;
    let minT = hint.minTargets || 1;
    const isR = ab.slot === 'R';
    if (isR && minT < 2 && !(target.hp / target.maxHp < 0.5 || comboDamage(c, target) >= effectiveHp(target, damageTypeOf(c), c) * 0.9)) minT = 2;
    if (tg === 'unit') {
      if (c.distTo(target) > range + target.radius) return false;
      return this.castOn(ab.slot, target).ok;
    }
    if (tg === 'self' || tg === 'none') {
      const n = this._countEnemyChamps(c.x, c.y, radius);
      if (n < minT) return false;
      return this.castSelf(ab.slot).ok;
    }
    const speed = hint.speed || 0;
    const delay = hint.delay ?? ab.castTime ?? 0.25;
    const d = c.distTo(target);
    const p = this.predict(target, delay + (speed > 0 ? d / speed : 0));
    const pd = Math.hypot(p.x - c.x, p.y - c.y);
    if (pd > range + radius * 0.6) return false;
    // 线形技能（有宽度无半径）按直线统计
    let n;
    if (!hint.radius && hint.width) n = this._countEnemyChampsLine(c.x, c.y, p.x, p.y, hint.width);
    else n = this._countEnemyChamps(p.x, p.y, radius);
    if (n < minT) return false;
    return this.castAt(ab.slot, p.x, p.y).ok;
  },

  _countEnemyChamps(x, y, r) {
    let n = 0;
    for (const e of this.enemies) {
      const u = e.u;
      if (u.untargetable) continue;
      if ((u.x - x) ** 2 + (u.y - y) ** 2 <= (r + u.radius) ** 2) n++;
    }
    return n;
  },
  _countEnemyChampsLine(x1, y1, x2, y2, w) {
    const hits = this.game.queryLine({ x1, y1, x2, y2, width: w, enemyOf: this.champ, types: ['champion'], sort: false });
    let n = 0;
    for (const u of hits) if (u.visible[this.champ.team] && !u.untargetable) n++;
    return n;
  },

  // 大招是否值得交
  _worthUlt(ab, hint, target) {
    if (hint.when) return true;
    const c = this.champ;
    if (target.hp / target.maxHp < 0.55) return true;
    let near = 0;
    for (const e of this.enemies) if (e.d < 1200) near++;
    if (near >= 2) return true;
    if (comboDamage(c, target) >= effectiveHp(target, damageTypeOf(c), c) * 0.8) return true;
    if (this.hpPct() < 0.4 && this.mode === 'fighting') return true;
    return false;
  },

  // 护盾/治疗：自身或队友
  _castSupportive(ab, hint, ctx, target) {
    const c = this.champ;
    const tg = hint.targeting;
    const range = abilityRange(ab, hint) || 700;
    if (tg === 'self' || tg === 'none') {
      const ok = hint.when ? this._when(hint, target) : this._needsProtection(c, ctx);
      if (!ok) return false;
      // 纯自身护盾：只在需要时
      return this.castSelf(ab.slot).ok;
    }
    // 队友（含自己，若允许）
    const allowSelf = hint.filter !== 'allyChampion' || true;
    let best = null, bestScore = 0;
    const cands = [c, ...this.allies.filter((a) => a.d <= range + 100).map((a) => a.u)];
    for (const a of cands) {
      if (!a.alive || a.untargetable) continue;
      if (a === c && !allowSelf) continue;
      if (!this._needsProtection(a, ctx)) continue;
      const sc = (1 - a.hp / a.maxHp) + (a.role === 'adc' || a.role === 'mid' ? 0.2 : 0) + (a === c ? -0.05 : 0);
      if (sc > bestScore) { bestScore = sc; best = a; }
    }
    if (!best) return false;
    if (hint.when && !this._when(hint, best)) return false;
    if (tg === 'unit') {
      if (c.distTo(best) > range + best.radius) return false;
      return this.castOn(ab.slot, best).ok;
    }
    if (c.distTo(best) > range + 150) return false;
    return this.castAt(ab.slot, best.x, best.y).ok;
  },

  // 单位是否需要保护：近期受伤且血量不高、被硬控、或团战中
  _needsProtection(u, ctx) {
    const now = this.game.time;
    const hp = u.hp / u.maxHp;
    const recent = now - u.lastDamagedAt < 1.2;
    if (u.isHardCCd?.() && recent) return true;
    if (recent && hp < 0.6) return true;
    if (ctx === 'fight' && recent && hp < 0.85 && now - (u.lastChampionDamageAt ?? -99) < 1.5) return true;
    if (!recent && hp < 0.4 && ctx !== 'fight' && this.manaPct() > 0.6 && u === this.champ) return true;
    return false;
  },

  _castSelfBuff(ab, hint, ctx, target) {
    const c = this.champ;
    const tg = hint.targeting;
    if (ctx === 'fight' || (ctx === 'harass' && this.params.aggression > 0.5 && this.game.rng() < 0.3)) {
      if (!target) return false;
      const r = (hint.range && hint.range > 0 ? hint.range : c.stats.attackRange + 250);
      if (c.distTo(target) > r + target.radius) return false;
      if (!this._when(hint, target)) return false;
      if (tg === 'unit') return this.castOn(ab.slot, target).ok;
      if (tg === 'point' || tg === 'direction') return this.castAt(ab.slot, target.x, target.y).ok;
      return this.castSelf(ab.slot).ok;
    }
    if ((ctx === 'jungle' || ctx === 'push') && target && ab.slot !== 'R') {
      if (this._usesMana() && this.manaPct() < 0.35) return false;
      if (c.distTo(target) > c.stats.attackRange + c.radius + target.radius + 80) return false;
      if (!this._when(hint, target)) return false;
      if (tg === 'unit') return this.castOn(ab.slot, target).ok;
      if (tg === 'point' || tg === 'direction') return this.castAt(ab.slot, target.x, target.y).ok;
      return this.castSelf(ab.slot).ok;
    }
    if (ctx === 'escape' && hint.raw.escape) return this.castSelf(ab.slot).ok;
    return false;
  },

  _castToggle(ab, hint, ctx, target) {
    const c = this.champ;
    const now = this.game.time;
    if (!ab.toggled) {
      const want = (ctx === 'fight' && target && c.distTo(target) < (abilityRange(ab, hint) || c.stats.attackRange) + 300)
        || (ctx === 'jungle' && target && (!this._usesMana() || this.manaPct() > 0.3))
        || (ctx === 'push' && target && this.manaPct() > 0.6);
      if (!want || !this._when(hint, target)) return false;
      return this.castSelf(ab.slot).ok;
    }
    // 已开启：脱离战斗一段时间后关闭
    if ((ctx === 'idle' || ctx === 'harass' || ctx === 'farm') && now - this.lastFightAt > 2.5 && now - (this.lastJungleAt || -99) > 2.5) return this.castSelf(ab.slot).ok;
    return false;
  },

  // 清线/清野
  _castFarm(ab, hint, ctx, target) {
    const c = this.champ;
    if (ab.slot === 'R') return false;
    const manaReq = ctx === 'jungle' ? 0.22 : ctx === 'push' ? 0.45 : 0.7;
    if (this._usesMana() && this.manaPct() < manaReq) return false;
    const tg = hint.targeting;
    const range = abilityRange(ab, hint);
    const radius = hint.radius || (tg === 'self' || tg === 'none' ? range : 220) || 220;
    let aim = target;
    if (ctx === 'farm' || ctx === 'push') {
      // 找小兵最密集处
      const reach = (tg === 'self' || tg === 'none') ? radius : range + radius * 0.5;
      const mins = this.game.queryUnits({ x: c.x, y: c.y, radius: reach, enemyOf: c, types: ['minion'], targetableBy: c, sort: false });
      const need = ctx === 'push' ? 3 : 4;
      if (mins.length < need) return false;
      if (tg === 'self' || tg === 'none') {
        let n = 0;
        for (const m of mins) if (c.distTo(m) <= radius + m.radius) n++;
        if (n < need) return false;
        return this.castSelf(ab.slot).ok;
      }
      let best = null, bn = 0;
      for (const m of mins) {
        let n = 0;
        for (const o of mins) if ((o.x - m.x) ** 2 + (o.y - m.y) ** 2 <= radius * radius) n++;
        if (n > bn) { bn = n; best = m; }
      }
      if (!best || bn < need - 1) return false;
      aim = best;
      if (this.isUnderEnemyTurret(aim.x, aim.y) && !this._towerCovered(this._enemyTurretAt(aim.x, aim.y))) return false;
    }
    if (!aim || !aim.alive) return false;
    if (!this._when(hint, aim)) return false;
    const d = c.distTo(aim);
    if (tg === 'unit') {
      if (hint.filter === 'enemyChampion' || hint.filter === 'ally' || hint.filter === 'allyChampion') return false;
      if (d > range + aim.radius) return false;
      return this.castOn(ab.slot, aim).ok;
    }
    if (tg === 'self' || tg === 'none') {
      if (d > radius + aim.radius) return false;
      return this.castSelf(ab.slot).ok;
    }
    if (d > range + aim.radius) return false;
    return this.castAt(ab.slot, aim.x, aim.y).ok;
  },

  // 全图/超远程大招：收割视野内残血敌人
  _castGlobal(ab, hint, ctx, target) {
    const c = this.champ;
    const range = abilityRange(ab, hint) || 20000;
    if (ctx === 'farm' || ctx === 'push' || ctx === 'jungle' || ctx === 'escape') return false;
    const speed = hint.speed || 1600;
    const delay = hint.delay ?? ab.castTime ?? 0.25;
    let best = null;
    for (const e of this.enemies) {
      const u = e.u;
      if (u.untargetable || e.d > range) continue;
      if (!this.reactable(u)) continue;
      const dmg = abilityDamage(c, ab, u);
      const ok = hint.when ? this._when(hint, u) : (u.hp + (u.totalShield || 0) < dmg * 0.95 || (u === target && ctx === 'fight' && u.hp / u.maxHp < 0.45));
      if (!ok) continue;
      if (!best || u.hp < best.hp) best = u;
    }
    if (!best) return false;
    const d = c.distTo(best);
    const p = this.predict(best, delay + d / speed);
    if (hint.targeting === 'unit') return this.castOn(ab.slot, best).ok;
    if (hint.targeting === 'self' || hint.targeting === 'none') return this.castSelf(ab.slot).ok;
    return this.castAt(ab.slot, p.x, p.y).ok;
  },

  // 逃生：朝安全点方向
  _castEscape(ab, hint) {
    const c = this.champ;
    const safe = this._safeSpot();
    let dx = safe.x - c.x, dy = safe.y - c.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const range = abilityRange(ab, hint) || 400;
    const tg = hint.targeting;
    if (tg === 'self' || tg === 'none') return this.castSelf(ab.slot).ok;
    if (tg === 'unit') {
      // 找安全方向上的友方单位
      const cands = this.game.queryUnits({ x: c.x, y: c.y, radius: range, allyOf: c, types: ['champion', 'minion', 'ward'], exclude: c, sort: false });
      let best = null, bs = 0;
      for (const u of cands) {
        const proj = (u.x - c.x) * dx + (u.y - c.y) * dy;
        if (proj > bs) { bs = proj; best = u; }
      }
      if (!best || bs < 150) return false;
      return this.castOn(ab.slot, best).ok;
    }
    const nav = this.game.nav;
    for (const a of [0, 0.4, -0.4, 0.8, -0.8]) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
      const px = c.x + rx * range, py = c.y + ry * range;
      if (nav.isWalkable(px, py) && !this.isUnderEnemyTurret(px, py)) return this.castAt(ab.slot, px, py, { exact: true }).ok;
    }
    return false;
  },

  // 再次施放（无 custom 时的通用策略）
  _genericRecast(ab, hint, ctx, target) {
    if (!ab.def.recast) return false;
    const c = this.champ;
    const kind = hint.kind;
    if ((kind === 'gapclose' || kind === 'nuke' || kind === 'execute' || kind === 'cc') && ctx === 'fight' && target && target.alive) {
      const range = abilityRange(ab, hint) || 1100;
      if (c.distTo(target) > range + 200) return false;
      if (this.isUnderEnemyTurret(target.x, target.y) && !this.diving) return false;
      if (hint.targeting === 'unit') return c.castAbility(ab.slot, { target, x: target.x, y: target.y }).ok;
      const p = this.predict(target, 0.2);
      return c.castAbility(ab.slot, { x: p.x, y: p.y, target }).ok;
    }
    if (kind === 'escape' && ctx === 'escape') {
      const safe = this._safeSpot();
      return c.castAbility(ab.slot, { x: safe.x, y: safe.y }).ok;
    }
    return false;
  },
};
