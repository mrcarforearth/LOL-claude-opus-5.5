// AI 共享地图知识（每局缓存一次）：兵线折线投影、建筑索引、营地与草丛、守卫点、安全点
const LANE_NAMES = ['top', 'mid', 'bot'];
const TIER_ORDER = { outer: 0, inner: 1, inhib: 2, nexus: 3 };
export const TURRET_RANGE = 750;

export function getWorld(game) {
  let w = game._aiWorld;
  if (!w) { w = new AIWorld(game); game._aiWorld = w; }
  return w;
}

function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  const n = poly.length || 1;
  return { x: x / n, y: y / n };
}

export class AIWorld {
  constructor(game) {
    this.game = game;
    const map = game.map || {};
    this.center = map.CENTER || { x: 7420, y: 7430 };
    this.lanes = {};
    for (const name of LANE_NAMES) {
      const raw = map.LANES?.[name] || [];
      const pts = raw.map((p) => ({ x: p[0], y: p[1] }));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      this.lanes[name] = { name, pts, cum, length: cum[cum.length - 1] || 1 };
    }
    this.camps = map.CAMPS || [];
    this.campById = new Map(this.camps.map((c) => [c.id, c]));
    this.brushes = (map.BRUSHES || []).map((b) => ({ id: b.id, kind: b.kind, side: b.side, name: b.name, ...centroid(b.poly || [[0, 0]]) }));
    this.pits = map.PITS || {};
    this.fountains = [game.fountainOf(0), game.fountainOf(1)];
    this._structCount = -1;
    this._sIndex = new Map();
    this._indexStructures();
  }

  // —— 建筑索引（建筑不会从数组移除，水晶会复活） ——
  _indexStructures() {
    const S = this.game.structures;
    if (S.length === this._structCount) return;
    this._structCount = S.length;
    this.turretsByTeam = [[], []];
    this.laneStructs = [{ top: [], mid: [], bot: [] }, { top: [], mid: [], bot: [] }];
    this.nexusTurrets = [[], []];
    this.nexus = [null, null];
    this.inhibitors = [[], []];
    for (const s of S) {
      const t = s.team;
      if (t !== 0 && t !== 1) continue;
      if (s.type === 'turret') {
        if (s.tier === 'fountain') continue;
        this.turretsByTeam[t].push(s);
        if (s.tier === 'nexus' || !s.lane) this.nexusTurrets[t].push(s);
        else if (this.laneStructs[t][s.lane]) this.laneStructs[t][s.lane].push(s);
      } else if (s.type === 'inhibitor') {
        this.inhibitors[t].push(s);
        if (s.lane && this.laneStructs[t][s.lane]) this.laneStructs[t][s.lane].push(s);
      } else if (s.type === 'nexus') {
        this.nexus[t] = s;
      }
    }
    // 每路建筑按「外塔 → 内塔 → 高地塔 → 水晶」排序
    const rank = (s) => (s.type === 'inhibitor' ? 4 : TIER_ORDER[s.tier] ?? 3);
    for (const t of [0, 1]) for (const l of LANE_NAMES) this.laneStructs[t][l].sort((a, b) => rank(a) - rank(b));
    this._sIndex.clear();
    for (const t of [0, 1]) {
      for (const l of LANE_NAMES) for (const s of this.laneStructs[t][l]) this._sIndex.set(s, this.project(l, s.x, s.y));
    }
  }
  refresh() { this._indexStructures(); }

  turrets(team) { this._indexStructures(); return this.turretsByTeam[team] || []; }
  // 某路最前面（最靠近河道）的存活建筑
  frontStructure(team, lane) {
    this._indexStructures();
    const list = this.laneStructs[team]?.[lane] || [];
    for (const s of list) if (s.alive) return s;
    return null;
  }
  // 敌方在该路下一个要推的目标（对 attackerTeam 而言）
  nextEnemyStructure(attackerTeam, lane) {
    const def = 1 - attackerTeam;
    const s = this.frontStructure(def, lane);
    if (s) return s;
    for (const t of this.nexusTurrets[def]) if (t.alive) return t;
    const n = this.nexus[def];
    return n && n.alive ? n : null;
  }
  structureS(s) { return this._sIndex.get(s); }

  // —— 兵线折线 ——
  // 返回投影弧长 s；this.lastProjDist 为到折线的距离
  project(lane, x, y) {
    const L = this.lanes[lane];
    if (!L || L.pts.length < 2) { this.lastProjDist = 0; return 0; }
    const P = L.pts;
    let best = 0, bd = Infinity;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = a.x + dx * t - x, py = a.y + dy * t - y;
      const d2 = px * px + py * py;
      if (d2 < bd) { bd = d2; best = L.cum[i] + t * (L.cum[i + 1] - L.cum[i]); }
    }
    this.lastProjDist = Math.sqrt(bd);
    return best;
  }
  pointAt(lane, s) {
    const L = this.lanes[lane];
    if (!L || L.pts.length === 0) return { x: this.center.x, y: this.center.y, dirX: 1, dirY: 0 };
    const P = L.pts, C = L.cum;
    if (s <= 0) return { x: P[0].x, y: P[0].y, ...this._dir(P[0], P[1]) };
    if (s >= L.length) { const n = P.length; return { x: P[n - 1].x, y: P[n - 1].y, ...this._dir(P[n - 2], P[n - 1]) }; }
    let i = 0;
    while (i < C.length - 2 && C[i + 1] < s) i++;
    const seg = C[i + 1] - C[i] || 1;
    const t = (s - C[i]) / seg;
    const a = P[i], b = P[i + 1];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ...this._dir(a, b) };
  }
  _dir(a, b) {
    if (!a || !b) return { dirX: 1, dirY: 0 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { dirX: dx / l, dirY: dy / l };
  }
  // 己方视角的推进坐标 f：0 = 己方枢纽，length = 敌方枢纽
  toF(team, lane, s) { return team === 0 ? s : this.lanes[lane].length - s; }
  fromF(team, lane, f) { return team === 0 ? f : this.lanes[lane].length - f; }
  // 己方视角推进坐标处的点（带朝向：dirX/dirY 指向敌方）
  pointAtF(team, lane, f) {
    const p = this.pointAt(lane, this.fromF(team, lane, f));
    if (team === 1) { p.dirX = -p.dirX; p.dirY = -p.dirY; }
    return p;
  }
  laneLength(lane) { return this.lanes[lane]?.length || 1; }

  // 最近的草丛（可限定半场 side 与种类）
  nearestBrush(x, y, filter) {
    let best = null, bd = Infinity;
    for (const b of this.brushes) {
      if (filter && !filter(b)) continue;
      const d = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  brushByName(name) { return this.brushes.find((b) => b.name === name) || null; }
  campsOf(side) { return this.camps.filter((c) => c.side === side); }
  campOfKind(kind, side) { return this.camps.find((c) => c.kind === kind && (side == null || c.side === side)) || null; }
}
