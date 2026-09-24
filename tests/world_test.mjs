// 地图/导航/视野模块测试：可走性、连通性、兵线路径、草丛视野规则、性能
import * as MD from '../js/world/mapdata.js';
import { NavGrid } from '../js/world/navgrid.js';
import { Vision } from '../js/world/vision.js';

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push([name, e]);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const P = ([x, y]) => ({ x, y });

const tBuild0 = performance.now();
const nav = new NavGrid(MD);
const buildMs = performance.now() - tBuild0;
const blueSpawn = MD.FOUNTAINS[0].spawns[0], redSpawn = MD.FOUNTAINS[1].spawns[0];

// 路径终点是否抵达目标附近
function reaches(from, to, tol = 80) {
  const path = nav.findPath(from.x, from.y, to.x, to.y);
  if (!path || !path.length) return { ok: false, path, len: Infinity };
  const end = path[path.length - 1];
  return { ok: dist(end, to) <= tol && nav.lastStats.found !== false, path, len: NavGrid.pathLength(from.x, from.y, path) };
}
// 路径每一段都必须可走
function pathValid(from, path) {
  let prev = from;
  for (const p of path) {
    if (!nav.hasLineOfWalk(prev.x, prev.y, p.x, p.y)) return false;
    prev = p;
  }
  return true;
}

console.log('\n[mapdata]');
test('导出结构完整', () => {
  for (const k of ['MAP', 'FOUNTAINS', 'STRUCTURES', 'LANES', 'CAMPS', 'BRUSHES', 'RIVER', 'PITS', 'WALK', 'DECOR', 'laneOf', 'isInBase']) assert(k in MD, `缺少导出 ${k}`);
  assert(MD.MAP.size === 15000, 'MAP.size');
  assert(MD.FOUNTAINS.length === 2 && MD.FOUNTAINS.every((f) => f.spawns.length === 5), '泉水与 5 个出生点');
});
test('建筑坐标与 LoL 参考一致', () => {
  const ref = {
    b_top_outer: [981, 10441], b_top_inner: [1512, 6699], b_top_inhib: [1169, 4287], b_mid_outer: [5846, 6396], b_mid_inner: [5048, 4812],
    b_mid_inhib: [3651, 3696], b_bot_outer: [10504, 1029], b_bot_inner: [6919, 1483], b_bot_inhib: [4281, 1253], b_nexus_t1: [1748, 2270], b_nexus_t2: [2177, 1807],
    r_top_outer: [4318, 13875], r_top_inner: [7943, 13411], r_top_inhib: [10481, 13650], r_mid_outer: [8955, 8510], r_mid_inner: [9767, 10113],
    r_mid_inhib: [11134, 11207], r_bot_outer: [13866, 4505], r_bot_inner: [13327, 8226], r_bot_inhib: [13624, 10572], r_nexus_t1: [12611, 13084], r_nexus_t2: [13052, 12612],
    b_top_inhibitor: [1171, 3571], b_mid_inhibitor: [3203, 3208], b_bot_inhibitor: [3452, 1236], r_top_inhibitor: [11261, 13676], r_mid_inhibitor: [11598, 11667], r_bot_inhibitor: [13604, 11316],
  };
  for (const [id, [x, y]] of Object.entries(ref)) {
    const s = MD.STRUCTURES.find((q) => q.id === id);
    assert(s && s.x === x && s.y === y, `建筑 ${id} 坐标不符`);
  }
  const turrets = MD.STRUCTURES.filter((s) => s.kind === 'turret');
  assert(turrets.length === 22, `防御塔数量 ${turrets.length}`);
  assert(MD.STRUCTURES.filter((s) => s.kind === 'inhibitor').length === 6, '召唤水晶 6 个');
  assert(MD.STRUCTURES.filter((s) => s.kind === 'nexus').length === 2, '枢纽 2 个');
});
test('营地种类、野怪 kind 与数量', () => {
  const kinds = MD.CAMPS.map((c) => c.kind).sort().join(',');
  assert(MD.CAMPS.length === 17, `营地数 ${MD.CAMPS.length}`);
  for (const k of ['blue', 'red', 'gromp', 'wolves', 'raptors', 'krugs']) assert(MD.CAMPS.filter((c) => c.kind === k).length === 2, `${k} 应有 2 个：${kinds}`);
  const want = {
    wolves: { murkwolf: 1, murkwolf_small: 2 }, raptors: { raptor: 1, raptor_small: 5 }, krugs: { krug_ancient: 1, krug: 1 },
    blue: { blue_sentinel: 1 }, red: { red_brambleback: 1 }, gromp: { gromp: 1 }, scuttle_top: { scuttle: 1 }, scuttle_bot: { scuttle: 1 },
    dragon: { dragon: 1 }, baron: { baron: 1 }, herald: { herald: 1 },
  };
  for (const c of MD.CAMPS) {
    const cnt = {};
    for (const m of c.monsters) cnt[m.kind] = (cnt[m.kind] ?? 0) + 1;
    assert(JSON.stringify(cnt) === JSON.stringify(want[c.kind]), `${c.id} 野怪组成 ${JSON.stringify(cnt)}`);
    assert(Number.isFinite(c.facing) && c.monsters.every((m) => Number.isFinite(m.facing)), `${c.id} facing`);
    assert(c.firstSpawn > 0 && c.respawn > 0 && c.leash > 0, `${c.id} 计时字段`);
  }
  // 参考坐标
  const ref = { b_blue: [3821, 8101], b_gromp: [2090, 8428], b_wolves: [3780, 6440], b_raptors: [6943, 5422], b_red: [7765, 4020], b_krugs: [8400, 2700],
    r_blue: [10984, 6960], r_gromp: [12703, 6444], r_wolves: [11008, 8387], r_raptors: [7852, 9471], r_red: [7101, 10900], r_krugs: [6317, 12146],
    dragon: [9866, 4414], baron: [5007, 10471], scuttle_top: [4400, 9600], scuttle_bot: [10500, 5170] };
  for (const [id, [x, y]] of Object.entries(ref)) {
    const c = MD.CAMPS.find((q) => q.id === id);
    assert(c && c.x === x && c.y === y, `营地 ${id} 坐标不符`);
  }
});
test('草丛 ≥ 40 个且 id 连续', () => {
  assert(MD.BRUSHES.length >= 40, `草丛数 ${MD.BRUSHES.length}`);
  MD.BRUSHES.forEach((b, i) => assert(b.id === i && b.poly.length >= 3, `草丛 ${i}`));
  // 每个草丛至少覆盖若干可走格
  const counts = new Map();
  for (let i = 0; i < nav.brush.length; i++) if (nav.brush[i] >= 0) counts.set(nav.brush[i], (counts.get(nav.brush[i]) ?? 0) + 1);
  for (const b of MD.BRUSHES) assert((counts.get(b.id) ?? 0) >= 6, `草丛 ${b.id}(${b.name}) 可走格太少：${counts.get(b.id) ?? 0}`);
});
test('laneOf / isInBase', () => {
  assert(MD.laneOf(1100, 9000) === 'top', 'top');
  assert(MD.laneOf(13800, 6000) === 'bot', 'bot');
  assert(MD.laneOf(7420, 7430) === 'mid', 'mid');
  assert(MD.laneOf(3821, 8101) === null, '蓝 BUFF 应不在兵线');
  assert(MD.isInBase(0, 1550, 1600) && MD.isInBase(0, 420, 420) && !MD.isInBase(0, 7420, 7430), '蓝方基地');
  assert(MD.isInBase(1, 13250, 13280) && MD.isInBase(1, 14380, 14420) && !MD.isInBase(1, 1550, 1600), '红方基地');
  for (const s of MD.STRUCTURES) assert(s.kind === 'turret' && s.tier !== 'inhib' && s.tier !== 'nexus' ? !MD.isInBase(s.team, s.x, s.y) : MD.isInBase(s.team, s.x, s.y), `${s.id} 基地归属`);
});

test('DECOR 提示：基地/兵线路/道具位置合理', () => {
  const D = MD.DECOR;
  assert(D.bases.length === 2 && D.bases.every((b) => b.gates.length === 3 && b.walls.length === 2 && b.boundary.length > 8), 'bases');
  assert(D.lanePaths.length === 3 && D.jungleTrails.length > 20 && D.riverRocks.length > 10 && D.campAreas.length === 12, '路径/石块/营地泥地');
  const navTmp = new NavGrid(MD);
  for (const lp of D.lanePaths) for (const [x, y] of lp.pts) assert(navTmp.isTerrainWalkable(x, y), `${lp.lane} 石板路点 (${x},${y}) 应在可走区`);
  for (const pr of D.props.filter((q) => q.kind === 'lantern')) {
    const nw = navTmp.nearestWalkable(pr.x, pr.y, 400);
    assert(Math.hypot(nw.x - pr.x, nw.y - pr.y) < 150, `路灯 (${pr.x},${pr.y}) 离兵线太远`);
  }
  for (const b of D.bases) for (const g of b.gates) {
    assert(navTmp.isWalkable(g.x, g.y), `基地出口 ${g.team}/${g.lane} 中点应可走`);
    assert(MD.laneOf(g.x, g.y) === g.lane, `出口 ${g.team}/${g.lane} 对应兵线`);
  }
});

console.log('\n[navgrid]');
test(`构建耗时 ${buildMs.toFixed(1)}ms，单一连通分量`, () => {
  assert(nav.cols === 300 && nav.rows === 300 && nav.cellSize === 50, '网格尺寸');
  assert(nav.componentCount === 1, `连通分量 ${nav.componentCount}：${nav.componentSizes}`);
  let w = 0;
  for (const v of nav.walk) w += v;
  assert(w > 30000 && w < 60000, `可走格 ${w}`);
});
test('地图边缘一圈为墙', () => {
  for (let c = 0; c < nav.cols; c++) assert(!nav.walk[c] && !nav.walk[(nav.rows - 1) * nav.cols + c], '上下边');
  for (let r = 0; r < nav.rows; r++) assert(!nav.walk[r * nav.cols] && !nav.walk[r * nav.cols + nav.cols - 1], '左右边');
  assert(!nav.isWalkable(-10, 500) && !nav.isWalkable(500, 15010), '越界不可走');
});
test('地图关于中心点对称（≥ 97%）', () => {
  let same = 0, tot = 0;
  for (let i = 0; i < nav.terrain.length; i++) {
    const p = nav.cellCenter(i);
    const m = MD.mirrorPoint(p.x, p.y);
    if (m.x < 0 || m.y < 0 || m.x >= 15000 || m.y >= 15000) continue;
    tot++;
    if (nav.terrain[i] === (nav.isTerrainWalkable(m.x, m.y) ? 1 : 0)) same++;
  }
  assert(same / tot >= 0.97, `对称率 ${(same / tot * 100).toFixed(2)}%`);
});
test('建筑占地不可走、周围可走且可达', () => {
  for (const s of MD.STRUCTURES) {
    const fp = MD.STRUCTURE_FOOTPRINT[s.kind] ?? 0;
    if (fp > 0) assert(!nav.isWalkable(s.x, s.y), `${s.id} 中心应不可走`);
    let ok = 0;
    for (let a = 0; a < 16; a++) {
      const x = s.x + Math.cos((a / 16) * Math.PI * 2) * (fp + 140), y = s.y + Math.sin((a / 16) * Math.PI * 2) * (fp + 140);
      if (nav.isWalkable(x, y) && nav.componentAt(x, y) === nav.componentAt(blueSpawn.x, blueSpawn.y)) ok++;
    }
    assert(ok >= 6, `${s.id} 周围可走点太少：${ok}/16`);
  }
});
test('出生点可走，泉水互通', () => {
  for (const f of MD.FOUNTAINS) for (const s of f.spawns) assert(nav.isWalkable(s.x, s.y), `出生点 (${s.x},${s.y})`);
  const r = reaches(blueSpawn, redSpawn);
  assert(r.ok && pathValid(blueSpawn, r.path), '蓝泉 → 红泉');
  assert(r.len < 23000, `泉水间路径过长 ${r.len.toFixed(0)}`);
});
test('LANES 路径点可走、避开建筑占地、首尾在枢纽附近', () => {
  const nex = [MD.STRUCTURES.find((s) => s.id === 'b_nexus'), MD.STRUCTURES.find((s) => s.id === 'r_nexus')];
  for (const [lane, pts] of Object.entries(MD.LANES)) {
    assert(pts.length >= 8, `${lane} 路径点太少`);
    assert(dist(P(pts[0]), nex[0]) < 800, `${lane} 起点应靠近蓝方枢纽`);
    assert(dist(P(pts[pts.length - 1]), nex[1]) < 800, `${lane} 终点应靠近红方枢纽`);
    for (const p of pts) {
      assert(nav.isWalkable(p[0], p[1]), `${lane} 路径点 ${p} 不可走`);
      for (const s of MD.STRUCTURES) {
        const fp = MD.STRUCTURE_FOOTPRINT[s.kind] ?? 0;
        if (fp) assert(dist(P(p), s) > fp + 60, `${lane} 路径点 ${p} 离 ${s.id} 过近`);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [P(pts[i]), P(pts[i + 1])];
      assert(nav.hasLineOfWalk(a.x, a.y, b.x, b.y), `${lane} 路径段 ${i} 直线不可走`);
      // 线段不穿过建筑占地（留 40 余量）
      for (const s of MD.STRUCTURES) {
        const fp = MD.STRUCTURE_FOOTPRINT[s.kind] ?? 0;
        if (!fp) continue;
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((s.x - a.x) * dx + (s.y - a.y) * dy) / l2));
        const d = Math.hypot(a.x + dx * t - s.x, a.y + dy * t - s.y);
        assert(d > fp + 40, `${lane} 路径段 ${i} 穿过 ${s.id}（距离 ${d.toFixed(0)}）`);
      }
      const r = reaches(a, b, 30);
      assert(r.ok, `${lane} 段 ${i} 不可达`);
      assert(r.len <= dist(a, b) * 1.2 + 60, `${lane} 段 ${i} 路径绕远：${r.len.toFixed(0)} vs ${dist(a, b).toFixed(0)}`);
    }
  }
});
test('蓝方泉水沿三路分别到达红方泉水', () => {
  for (const [lane, pts] of Object.entries(MD.LANES)) {
    let cur = blueSpawn, total = 0;
    for (const p of [...pts.map(P), redSpawn]) {
      const r = reaches(cur, p, 40);
      assert(r.ok && pathValid(cur, r.path), `${lane}：${cur.x},${cur.y} → ${p.x},${p.y} 失败`);
      total += r.len;
      cur = p;
    }
    // 与「出生点 → 各路径点 → 出生点」折线长度相比不应明显绕远
    const poly = [blueSpawn, ...pts.map(P), redSpawn];
    let ref = 0;
    for (let i = 0; i < poly.length - 1; i++) ref += dist(poly[i], poly[i + 1]);
    assert(total <= ref * 1.06, `${lane} 全程 ${total.toFixed(0)} 相比折线 ${ref.toFixed(0)} 绕远`);
    console.log(`      ${lane} 全程路径长 ${total.toFixed(0)}（折线 ${ref.toFixed(0)}）`);
  }
});
test('营地（所有野怪位置）可走，且两方基地都能到达', () => {
  for (const c of MD.CAMPS) {
    for (const m of c.monsters) assert(nav.isWalkable(m.x, m.y), `${c.id} 野怪 ${m.kind} (${m.x},${m.y}) 不可走`);
    for (const from of [blueSpawn, redSpawn]) {
      const r = reaches(from, c, 60);
      assert(r.ok && pathValid(from, r.path), `${c.id} 从 (${from.x},${from.y}) 不可达`);
      assert(r.len < 17000, `${c.id} 路径过长 ${r.len.toFixed(0)}`);
    }
  }
});
test('龙坑坑口朝向河道、坑内可走', () => {
  for (const [k, p] of Object.entries(MD.PITS)) {
    assert(nav.isWalkable(p.x, p.y), `${k} 坑中心`);
    assert(MD.isInRiver(p.mouth.x, p.mouth.y), `${k} 坑口应在河道内`);
    assert(nav.hasLineOfWalk(p.x, p.y, p.mouth.x, p.mouth.y), `${k} 坑口直通`);
    // 坑背面（坑口反方向）为墙
    const dx = p.x - p.mouth.x, dy = p.y - p.mouth.y, l = Math.hypot(dx, dy);
    assert(!nav.isWalkable(p.x + (dx / l) * (p.r + 250), p.y + (dy / l) * (p.r + 250)), `${k} 坑背面应为墙`);
  }
});
test('草丛互不重叠；迅捷蟹巡游点在河道内', () => {
  const owner = new Int16Array(nav.brush.length).fill(-1);
  let overlap = 0;
  for (const b of MD.BRUSHES) {
    const tmp = new Int16Array(nav.brush.length).fill(-1);
    nav._poly(tmp, b.poly, b.id);
    for (let i = 0; i < tmp.length; i++) if (tmp[i] >= 0) { if (owner[i] >= 0) overlap++; owner[i] = b.id; }
  }
  assert(overlap === 0, `草丛重叠格 ${overlap}`);
  for (const c of MD.CAMPS.filter((q) => q.path)) {
    for (const [x, y] of c.path) assert(nav.isWalkable(x, y) && MD.isInRiver(x, y), `${c.id} 巡游点 (${x},${y})`);
  }
  assert(MD.isInRiver(4400, 9600) && MD.isInRiver(10500, 5170), '迅捷蟹在河道中');
});
test('findPath：终点在墙内时走到最近可走点；路径不含起点', () => {
  const wallPt = { x: 3000, y: 9800 }; // 蓝方上半野区墙体内
  assert(!nav.isWalkable(wallPt.x, wallPt.y), '测试点应在墙内');
  const path = nav.findPath(blueSpawn.x, blueSpawn.y, wallPt.x, wallPt.y);
  const end = path[path.length - 1];
  assert(nav.isWalkable(end.x, end.y) && dist(end, wallPt) < 500, `终点 ${JSON.stringify(end)}`);
  assert(dist(path[0], blueSpawn) > 1, '不应包含起点');
  const straight = nav.findPath(1100, 9000, 1100, 9400);
  assert(straight.length === 1 && straight[0].x === 1100 && straight[0].y === 9400, '直线可达应只返回终点');
});
test('hasLineOfWalk / raycastWalk / nearestWalkable', () => {
  assert(nav.hasLineOfWalk(1100, 8000, 1100, 9500), '上路直线');
  assert(!nav.hasLineOfWalk(1100, 9000, 3821, 8101), '上路直穿墙到蓝 BUFF 应被阻挡');
  const hit = nav.raycastWalk(1100, 9000, 3821, 8101);
  assert(nav.isWalkable(hit.x, hit.y) && hit.x > 1100 && hit.x < 2200, `raycastWalk ${JSON.stringify(hit)}`);
  const full = nav.raycastWalk(1100, 8000, 1100, 9500);
  assert(full.x === 1100 && full.y === 9500, '全程可走返回终点');
  const nw = nav.nearestWalkable(3000, 9800);
  assert(nav.isWalkable(nw.x, nw.y), 'nearestWalkable 结果可走');
  const same = nav.nearestWalkable(1100, 9000);
  assert(same.x === 1100 && same.y === 9000, '可走点原样返回');
  // 螺旋结果应是真正最近
  let best = Infinity;
  for (let i = 0; i < nav.walk.length; i++) if (nav.walk[i]) { const c = nav.cellCenter(i); best = Math.min(best, Math.hypot(c.x - 3000, c.y - 9800)); }
  assert(Math.hypot(nw.x - 3000, nw.y - 9800) <= best + 1, 'nearestWalkable 不是最近');
});
test('SDF 符号与草丛栅格 / 视线', () => {
  assert(nav.sdfAt(1100, 9000) < -200, '兵线中心 SDF 应为负');
  assert(nav.sdfAt(3000, 9800) > 0, '墙内 SDF 应为正');
  assert(!nav.blocksSight(1100, 9000) && nav.blocksSight(3000, 9800), 'blocksSight');
  const tb = MD.BRUSHES.find((b) => b.name.includes('上路三角草'));
  const cx = tb.poly.reduce((a, p) => a + p[0], 0) / tb.poly.length, cy = tb.poly.reduce((a, p) => a + p[1], 0) / tb.poly.length;
  assert(nav.brushAt(cx, cy) === tb.id, '三角草栅格');
  assert(nav.brushAt(7420, 7430) === -1, '中心无草');
  // 建筑占地不挡视线
  const t = MD.STRUCTURES[0];
  assert(!nav.walk[nav.cellIndex(t.x, t.y)] && !nav.blocksSight(t.x, t.y), '防御塔不挡视线');
});

console.log('\n[vision]');
// 构造最小假 game
function mkUnit(type, team, x, y, extra = {}) {
  return { type, team, x, y, alive: true, removed: false, visible: [team === 0, team === 1], sightRange: 0, revealedUntil: 0, ...extra };
}
function mkGame(units = {}) {
  return { time: 10, nav, map: MD, champions: [], minions: [], monsters: [], pets: [], wards: [], structures: [], ...units };
}
function brushCenter(name) {
  const b = MD.BRUSHES.find((q) => q.name.includes(name));
  // 取草丛内一个可走格中心
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < nav.brush.length; i++) if (nav.brush[i] === b.id && nav.walk[i]) { const c = nav.cellCenter(i); sx += c.x; sy += c.y; n++; }
  const p = { x: sx / n, y: sy / n };
  return nav.brushAt(p.x, p.y) === b.id ? { ...p, id: b.id } : (() => {
    for (let i = 0; i < nav.brush.length; i++) if (nav.brush[i] === b.id && nav.walk[i]) return { ...nav.cellCenter(i), id: b.id };
    return null;
  })();
}
test('基础：视野范围与墙体遮挡', () => {
  const a = mkUnit('champion', 0, 1100, 8000);
  const near = mkUnit('champion', 1, 1100, 8900);            // 同一兵线 900 远
  const far = mkUnit('champion', 1, 1100, 9700);             // 1700 远，超出视野
  const behindWall = mkUnit('champion', 1, 2280, 8480);      // 魔沼蛙营地，隔着墙（约 1250）
  const g = mkGame({ champions: [a, near, far, behindWall] });
  const v = new Vision(g);
  v.update(0.2);
  assert(near.visible[0] === true, '近处敌人应可见');
  assert(far.visible[0] === false, '视野外敌人不可见');
  assert(!nav.hasLineOfWalk(a.x, a.y, behindWall.x, behindWall.y), '前提：隔墙');
  assert(behindWall.visible[0] === false, '墙后敌人不可见');
  assert(a.visible[0] === true && near.visible[1] === true, '本队恒可见');
  assert(a.visible[1] === true, '红方英雄也能看到蓝方英雄（互相在视野内）');
  assert(v.isVisible(0, 1100, 8500) && !v.isVisible(0, 1100, 11000), 'isVisible 栅格');
  assert(v.canSee(0, near) && !v.canSee(0, far), 'canSee');
});
test('草丛规则：草外看不到草内，同草可互看，暴露后可见', () => {
  const bc = brushCenter('上路三角草');
  assert(bc, '找到三角草格');
  const inBrush = mkUnit('champion', 1, bc.x, bc.y);
  const outside = mkUnit('champion', 0, 1150, 11150);  // 三角草与上路交界附近（草外）
  assert(nav.brushAt(outside.x, outside.y) === -1, '前提：观察者在草外');
  assert(Math.hypot(outside.x - bc.x, outside.y - bc.y) < 1300, '前提：在视野半径内');
  const g = mkGame({ champions: [inBrush, outside] });
  const v = new Vision(g);
  v.update(1);
  assert(inBrush.visible[0] === false, '草外看不到草内敌人');
  assert(outside.visible[1] === true, '草内能看到草外');
  // 蓝方单位进入同一草丛
  outside.x = bc.x + 60; outside.y = bc.y;
  if (nav.brushAt(outside.x, outside.y) !== bc.id) { outside.x = bc.x; outside.y = bc.y + 1; }
  v.invalidate(); v.update(0);
  assert(inBrush.visible[0] === true, '同一草丛内可互看');
  // 暴露：草内攻击后 revealedUntil > time
  outside.x = 1150; outside.y = 11150;
  inBrush.revealedUntil = g.time + 1;
  v.invalidate(); v.update(0);
  assert(inBrush.visible[0] === true, '暴露后在视野半径内可见');
  g.time += 2;
  v.invalidate(); v.update(0);
  assert(inBrush.visible[0] === false, '暴露结束后再次隐藏');
  // 草丛栅格：草外单位看不到草格，显示栅格为 0，但视线栅格为 1
  const ci = v.cellIndex(bc.x, bc.y);
  if (v.brushCells[ci] === bc.id) assert(v.grids[0][ci] === 0 && v.los[0][ci] === 1, '显示栅格应隐藏草丛');
});
test('守卫：草内守卫提供草丛视野；隐形守卫需控制守卫真视', () => {
  const bc = brushCenter('上路三角草');
  const enemy = mkUnit('champion', 1, bc.x, bc.y);
  const ward = mkUnit('ward', 0, bc.x + 40, bc.y, { kind: 'stealth' });
  if (nav.brushAt(ward.x, ward.y) !== bc.id) { ward.x = bc.x; ward.y = bc.y; }
  const g = mkGame({ champions: [enemy], wards: [ward] });
  const v = new Vision(g);
  v.update(1);
  assert(enemy.visible[0] === true, '草内守卫让草内敌人可见');
  assert(ward.visible[1] === false, '隐形守卫对敌方不可见');
  const ctrl = mkUnit('ward', 1, bc.x + 300, bc.y - 300, { kind: 'control' });
  g.wards.push(ctrl);
  v.invalidate(); v.update(0);
  assert(ward.visible[1] === true, '控制守卫 900 内揭示隐形守卫');
  assert(ctrl.visible[0] === true, '控制守卫本身可见（在蓝方守卫视野内）');
});
test('建筑恒可见、致盲视野、野怪、临时视野源', () => {
  const turret = mkUnit('turret', 1, 13866, 4505);
  const champ = mkUnit('champion', 0, 1100, 8000, { hasCC: (t) => t === 'nearsight' });
  const e1 = mkUnit('champion', 1, 1100, 8800);   // 800 远
  const monster = mkUnit('monster', 2, 3821, 8101);
  const g = mkGame({ champions: [champ, e1], structures: [turret], monsters: [monster] });
  const v = new Vision(g);
  v.update(1);
  assert(turret.visible[0] === true && turret.visible[1] === true, '建筑对双方可见');
  assert(e1.visible[0] === false, '致盲视野（500）下 800 远的敌人不可见');
  assert(monster.visible[0] === false && monster.visible[1] === false, '无人看到的野怪不可见');
  const rv = v.addRevealer({ team: 0, x: 3821, y: 8101, radius: 600, duration: 5 });
  v.update(0);
  assert(monster.visible[0] === true && monster.visible[1] === false, '临时视野源揭示野怪');
  rv.remove(); v.update(0);
  assert(monster.visible[0] === false, '移除临时视野源');
});
test('节流：0.12s 内不重复计算', () => {
  const g = mkGame({ champions: [mkUnit('champion', 0, 1100, 8000)] });
  const v = new Vision(g);
  v.update(0.01);
  const ver = v.version;
  v.update(0.05); v.update(0.05);
  assert(v.version === ver, '节流期间不应重算');
  v.update(0.05);
  assert(v.version === ver + 1, '超过间隔后重算');
});

console.log('\n[性能]');
test('跨半张地图寻路 < 5ms（平均）', () => {
  const pairs = [
    [blueSpawn, { x: 7420, y: 7430 }], [blueSpawn, { x: 10984, y: 6960 }], [{ x: 1100, y: 9000 }, { x: 7765, y: 4020 }],
    [{ x: 3821, y: 8101 }, { x: 8400, y: 2700 }], [{ x: 2090, y: 8428 }, { x: 9866, y: 4414 }], [{ x: 5007, y: 10471 }, { x: 1550, y: 2100 }],
    [{ x: 13800, y: 6000 }, { x: 7101, y: 10900 }], [redSpawn, { x: 7420, y: 7430 }], [{ x: 6943, y: 5422 }, { x: 4318, y: 13600 }],
    [{ x: 11008, y: 8387 }, { x: 6000, y: 13650 }],
  ];
  for (const [a, b] of pairs) nav.findPath(a.x, a.y, b.x, b.y); // 预热
  const N = 20;
  let worst = 0, total = 0, iters = 0;
  for (let k = 0; k < N; k++) {
    for (const [a, b] of pairs) {
      const t = performance.now();
      const p = nav.findPath(a.x, a.y, b.x, b.y);
      const dt = performance.now() - t;
      iters = Math.max(iters, nav.lastStats.iterations);
      total += dt; worst = Math.max(worst, dt);
      assert(p && p.length, '应找到路径');
    }
  }
  const avg = total / (N * pairs.length);
  console.log(`      平均 ${avg.toFixed(2)}ms，最慢 ${worst.toFixed(2)}ms，最大扩展 ${iters}`);
  assert(avg < 5, `平均 ${avg.toFixed(2)}ms`);
});
test('两队视野更新 < 3ms（约 60 个视野源）', () => {
  // 60 个视野源：10 英雄、36 小兵、14 守卫；另有野怪和建筑
  const champions = [], minions = [], wards = [], structures = [], monsters = [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const randWalk = () => {
    for (;;) { const x = 500 + rnd() * 14000, y = 500 + rnd() * 14000; if (nav.isWalkable(x, y)) return { x, y }; }
  };
  for (let i = 0; i < 10; i++) { const p = randWalk(); champions.push(mkUnit('champion', i % 2, p.x, p.y)); }
  for (let i = 0; i < 36; i++) { const lane = MD.LANES[['top', 'mid', 'bot'][i % 3]]; const q = lane[(i * 7) % lane.length]; minions.push(mkUnit('minion', i % 2, q[0] + 30, q[1] + 30)); }
  for (let i = 0; i < 14; i++) { const p = randWalk(); wards.push(mkUnit('ward', i % 2, p.x, p.y, { kind: i % 5 === 0 ? 'control' : 'stealth' })); }
  for (const s of MD.STRUCTURES) structures.push(mkUnit(s.kind === 'fountainTurret' ? 'turret' : s.kind, s.team, s.x, s.y));
  for (const c of MD.CAMPS) for (const m of c.monsters) monsters.push(mkUnit('monster', 2, m.x, m.y));
  const g = mkGame({ champions, minions, wards, structures, monsters });
  const v = new Vision(g);
  for (let i = 0; i < 10; i++) v.recompute(); // 预热
  const N = 60;
  const t = performance.now();
  for (let i = 0; i < N; i++) {
    for (const u of champions) { u.x += 3; } // 轻微移动
    v.recompute();
  }
  const avg = (performance.now() - t) / N;
  const nSrc = v.sources[0].length + v.sources[1].length;
  console.log(`      视野源 ${nSrc} 个（含 ${structures.length} 个建筑），平均每次 ${avg.toFixed(3)}ms`);
  assert(avg < 3, `平均 ${avg.toFixed(3)}ms`);
});

console.log(`\n共 ${passed + failed} 项：通过 ${passed}，失败 ${failed}`);
if (failed) {
  for (const [n, e] of failures) console.log(`失败：${n}\n${e.stack}`);
  process.exit(1);
}
