// AI 躲避：检测朝自己飞来的敌方直线投射物、即将生效的敌方范围技能，按难度概率侧移
// 返回 { x, y, until } 或 null；每个威胁只判定一次（按 dodge 概率），并受反应时间限制

// 在 (x,y) 附近找可走的躲避点：沿 (dx,dy) 方向，失败则尝试旋转
function walkablePoint(nav, x, y, dx, dy, dist) {
  const tries = [0, 0.5, -0.5, 1.0, -1.0];
  for (const a of tries) {
    const c = Math.cos(a), s = Math.sin(a);
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    const px = x + rx * dist, py = y + ry * dist;
    if (nav.isWalkable(px, py) && nav.isWalkable(x + rx * dist * 0.5, y + ry * dist * 0.5)) return { x: px, y: py };
  }
  return null;
}

export class Dodger {
  constructor(ai) {
    this.ai = ai;
    this.decided = new Map();   // 威胁 id → { dodge: bool, at: 反应完成时间 }
    this.active = null;         // 当前执行的躲避 { x, y, until }
    this._gcAt = 0;
  }

  _decide(key, now) {
    let d = this.decided.get(key);
    if (!d) {
      const p = this.ai.params;
      const rng = this.ai.game.rng();
      const react = p.reaction * (0.45 + this.ai.game.rng() * 0.5);
      d = { dodge: rng < p.dodge, at: now + react };
      this.decided.set(key, d);
    }
    return d;
  }

  // 每 tick 调用：返回躲避目标点或 null
  scan() {
    const ai = this.ai;
    const c = ai.champ;
    const game = ai.game;
    const now = game.time;
    if (now >= this._gcAt) {
      this._gcAt = now + 3;
      if (this.decided.size > 64) this.decided.clear();
    }
    if (this.active && now < this.active.until) return this.active;
    this.active = null;
    if (!c.canMove()) return null;
    let best = null;
    // —— 直线投射物 ——
    const projs = game.projectiles;
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      if (p.dead || p.homing || p.returning || p.isBasicAttack || p.team === c.team || p.hits === 'none') continue;
      if (!(p.speed > 0)) continue;
      const rx = c.x - p.x, ry = c.y - p.y;
      const along = rx * p.dirX + ry * p.dirY;
      const hitR = (p.width || 0) + c.radius;
      if (along < -hitR) continue;
      const remain = (p.range === Infinity ? 3000 : p.range - p.traveled);
      if (along - hitR > remain) continue;
      const perp = -rx * p.dirY + ry * p.dirX;
      if (Math.abs(perp) > hitR + 25) continue;
      // 可见性：投射物来自视野外的敌人也能看到弹道，不做限制
      const tHit = Math.max(0, along - hitR) / p.speed;
      const dec = this._decide(`p${p.id}`, now);
      if (!dec.dodge || now < dec.at) continue;
      const need = hitR - Math.abs(perp) + 35;
      const ms = c.stats.moveSpeed;
      if (need / ms > tHit + 0.05) continue; // 来不及
      // 侧移方向：离弹道更远的一侧（perp 符号）
      let sx = -p.dirY, sy = p.dirX;
      if (perp < 0) { sx = -sx; sy = -sy; }
      if (Math.abs(perp) < 8) {
        // 正中间：选择远离施法者朝向己方泉水的一侧
        const f = game.fountainOf(c.team);
        if ((f.x - c.x) * sx + (f.y - c.y) * sy < 0) { sx = -sx; sy = -sy; }
      }
      const pt = walkablePoint(game.nav, c.x, c.y, sx, sy, need + 20);
      if (!pt) continue;
      if (!best || tHit < best.t) best = { x: pt.x, y: pt.y, t: tHit, until: now + Math.min(0.7, (need + 20) / ms + 0.08) };
    }
    // —— 延迟生效的敌方范围技能 ——
    const zones = game.zones;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.dead || z.started || z.team === c.team || !(z.delay > 0) || z.follow || !(z.radius > 0)) continue;
      if (z.filter === 'ally') continue;
      const dx = c.x - z.x, dy = c.y - z.y;
      const d = Math.hypot(dx, dy);
      const R = z.radius + c.radius;
      if (d > R + 10) continue;
      const tLeft = z.delay - z.age;
      if (tLeft <= 0) continue;
      const dec = this._decide(`z${z.id}`, now);
      if (!dec.dodge || now < dec.at) continue;
      const need = R - d + 40;
      const ms = c.stats.moveSpeed;
      if (need / ms > tLeft + 0.05) continue;
      const ux = d > 1 ? dx / d : 1, uy = d > 1 ? dy / d : 0;
      const pt = walkablePoint(game.nav, c.x, c.y, ux, uy, need + 20);
      if (!pt) continue;
      if (!best || tLeft < best.t) best = { x: pt.x, y: pt.y, t: tLeft, until: now + Math.min(0.9, (need + 20) / ms + 0.08) };
    }
    if (best) this.active = best;
    return best;
  }
}
