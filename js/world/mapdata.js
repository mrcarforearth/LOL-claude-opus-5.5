// 召唤师峡谷地图数据：建筑、兵线、野怪营地、草丛、河道、龙坑、可行走区域雕刻原语与地形装饰提示
// 坐标为 LoL 游戏单位（0..15000，蓝方在左下）。地图关于中心点 CENTER 中心对称：
// 大部分几何只定义「半张图」（蓝方基地、蓝方两片野区、上路全程、蓝方半条中路、上半河道 + 大龙坑），
// 再用点对称 mirrorPoint 生成另一半；建筑与营地使用 LoL 实际坐标（红方数据并非严格对称）。
//
// 导出一览：
//   MAP { size }、CENTER { x, y }、mirrorPoint(x, y)
//   FOUNTAINS [{ team, x, y, radius, platformRadius, spawns: [{x,y}×5] }]
//   STRUCTURES [{ id, team, kind: turret|inhibitor|nexus|fountainTurret, lane, tier?, x, y }]、STRUCTURE_FOOTPRINT { kind: 半径 }
//   LANES { top|mid|bot: [[x,y], ...] }（蓝方枢纽 → 红方枢纽）、LANE_CENTERLINES（兵线走廊中心线，视觉用）
//   CAMPS [{ id, kind, side, name, x, y, facing, monsters: [{ kind, x, y, facing }], firstSpawn, respawn, leash, pit?, path?, despawnAt? }]
//   BRUSHES [{ id, kind, side, name, poly }]、RIVER { path, width(典型半宽), halfWidths }、PITS { dragon|baron: { x, y, r, mouth } }
//   BASE_BOUNDARY [蓝方平台多边形, 红方平台多边形]
//   WALK { corridors: [{ pts, w(全宽), tag }], clearings: [{ x, y, r, tag }], areas: [{ poly, team }], blockers: [{ poly }], edgeNoise, keepWalkable }
//   DECOR { center, bases, lanePaths, jungleTrails, riverFord, riverRocks, campAreas, pits, props }
//   laneOf(x, y)、isInBase(team, x, y)、isInRiver(x, y)、riverDistance(x, y)、pointInPoly(x, y, poly)

export const MAP = { size: 15000 };
const CX = 7420;
const CY = 7430;
export const CENTER = { x: CX, y: CY };

/** 关于地图中心的点对称 */
export function mirrorPoint(x, y) { return { x: 2 * CX - x, y: 2 * CY - y }; }
const mp = ([x, y]) => [2 * CX - x, 2 * CY - y];
const mpts = (pts) => pts.map(mp);
const R = Math.round;

// —— 形状辅助（确定性，不使用随机数）——
/** 不规则椭圆多边形（草丛/装饰），rot 为角度 */
function blob(cx, cy, rx, ry, rot = 0, n = 11, jitter = 0.14, seed = 1) {
  const pts = [];
  const a0 = (rot * Math.PI) / 180;
  const ca = Math.cos(a0), sa = Math.sin(a0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // 伪随机抖动：由 seed 与序号决定
    const j = 1 + Math.sin(seed * 12.9898 + i * 78.233) * jitter;
    const x = Math.cos(a) * rx * j, y = Math.sin(a) * ry * j;
    pts.push([R(cx + x * ca - y * sa), R(cy + x * sa + y * ca)]);
  }
  return pts;
}
/** 沿线段的胶囊形多边形（兵线草丛等长条草），w 为全宽 */
function strip(x1, y1, x2, y2, w, seed = 1) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const h = w / 2;
  const pts = [];
  const cap = 5;
  // 终点半圆（-90°..90°）与起点半圆（90°..270°），相对线段方向 u
  for (const [px, py, a0, s] of [[x2, y2, -Math.PI / 2, 3.1], [x1, y1, Math.PI / 2, 5.3]]) {
    for (let i = 0; i <= cap; i++) {
      const a = a0 + (i / cap) * Math.PI;
      const j = 1 + Math.sin(seed * s + i * 1.7) * 0.08;
      const c = Math.cos(a), sn = Math.sin(a);
      pts.push([R(px + (ux * c + nx * sn) * h * j), R(py + (uy * c + ny * sn) * h * j)]);
    }
  }
  return pts;
}

// ============================================================================
// 泉水与出生点
// ============================================================================
function fountainSpawns(fx, fy, dir) {
  // 5 个出生点沿泉水前方弧线排列（dir = 1 朝东北，-1 朝西南）
  const out = [];
  for (let i = 0; i < 5; i++) {
    const a = ((9 + i * 18) * Math.PI) / 180;
    out.push({ x: R(fx + dir * Math.cos(a) * 360), y: R(fy + dir * Math.sin(a) * 360) });
  }
  return out;
}
export const FOUNTAINS = [
  { team: 0, x: 420, y: 420, radius: 1100, platformRadius: 900, spawns: fountainSpawns(420, 420, 1) },
  { team: 1, x: 14380, y: 14420, radius: 1100, platformRadius: 900, spawns: fountainSpawns(14380, 14420, -1) },
];

// ============================================================================
// 建筑（LoL 实际坐标）
// ============================================================================
const T = (id, team, lane, tier, x, y) => ({ id, team, kind: 'turret', lane, tier, x, y });
export const STRUCTURES = [
  // 蓝方防御塔
  T('b_top_outer', 0, 'top', 'outer', 981, 10441), T('b_top_inner', 0, 'top', 'inner', 1512, 6699), T('b_top_inhib', 0, 'top', 'inhib', 1169, 4287),
  T('b_mid_outer', 0, 'mid', 'outer', 5846, 6396), T('b_mid_inner', 0, 'mid', 'inner', 5048, 4812), T('b_mid_inhib', 0, 'mid', 'inhib', 3651, 3696),
  T('b_bot_outer', 0, 'bot', 'outer', 10504, 1029), T('b_bot_inner', 0, 'bot', 'inner', 6919, 1483), T('b_bot_inhib', 0, 'bot', 'inhib', 4281, 1253),
  T('b_nexus_t1', 0, null, 'nexus', 1748, 2270), T('b_nexus_t2', 0, null, 'nexus', 2177, 1807),
  // 红方防御塔
  T('r_top_outer', 1, 'top', 'outer', 4318, 13875), T('r_top_inner', 1, 'top', 'inner', 7943, 13411), T('r_top_inhib', 1, 'top', 'inhib', 10481, 13650),
  T('r_mid_outer', 1, 'mid', 'outer', 8955, 8510), T('r_mid_inner', 1, 'mid', 'inner', 9767, 10113), T('r_mid_inhib', 1, 'mid', 'inhib', 11134, 11207),
  T('r_bot_outer', 1, 'bot', 'outer', 13866, 4505), T('r_bot_inner', 1, 'bot', 'inner', 13327, 8226), T('r_bot_inhib', 1, 'bot', 'inhib', 13624, 10572),
  T('r_nexus_t1', 1, null, 'nexus', 12611, 13084), T('r_nexus_t2', 1, null, 'nexus', 13052, 12612),
  // 召唤水晶
  { id: 'b_top_inhibitor', team: 0, kind: 'inhibitor', lane: 'top', x: 1171, y: 3571 },
  { id: 'b_mid_inhibitor', team: 0, kind: 'inhibitor', lane: 'mid', x: 3203, y: 3208 },
  { id: 'b_bot_inhibitor', team: 0, kind: 'inhibitor', lane: 'bot', x: 3452, y: 1236 },
  { id: 'r_top_inhibitor', team: 1, kind: 'inhibitor', lane: 'top', x: 11261, y: 13676 },
  { id: 'r_mid_inhibitor', team: 1, kind: 'inhibitor', lane: 'mid', x: 11598, y: 11667 },
  { id: 'r_bot_inhibitor', team: 1, kind: 'inhibitor', lane: 'bot', x: 13604, y: 11316 },
  // 水晶枢纽
  { id: 'b_nexus', team: 0, kind: 'nexus', lane: null, x: 1550, y: 1600 },
  { id: 'r_nexus', team: 1, kind: 'nexus', lane: null, x: 13250, y: 13280 },
  // 泉水（激光塔）
  { id: 'b_fountain', team: 0, kind: 'fountainTurret', lane: null, x: 420, y: 420 },
  { id: 'r_fountain', team: 1, kind: 'fountainTurret', lane: null, x: 14380, y: 14420 },
];
/** 建筑不可走占地半径（导航用） */
export const STRUCTURE_FOOTPRINT = { turret: 90, inhibitor: 150, nexus: 230, fountainTurret: 110 };

// ============================================================================
// 兵线路径点（蓝方枢纽 → 红方枢纽）。路径点绕开建筑占地约 270~300 单位，相邻点之间直线可走。
// ============================================================================
export const LANES = {
  top: [
    [1300, 2050], [1180, 3000], [1440, 3571], [1440, 4290], [1150, 5400], [1230, 6700], [1150, 8400],
    [1250, 10441], [1050, 11700], [1250, 12800], [1700, 13450], [2600, 13800], [4318, 13600], [6000, 13650],
    [7943, 13700], [9300, 13560], [10481, 13380], [11261, 13400], [12050, 13480], [12850, 13500],
  ],
  mid: [
    [1960, 2040], [2600, 2700], [2990, 3420], [3440, 3910], [4200, 4250], [4830, 5030], [5500, 5700],
    [6060, 6185], [6700, 6800], [7420, 7430], [8150, 8050], [8745, 8720], [9400, 9350], [9980, 9900],
    [10600, 10650], [10920, 11420], [11386, 11880], [12050, 12300], [12830, 12850],
  ],
  bot: [
    [2050, 1300], [3000, 1180], [3452, 1500], [4281, 1520], [5400, 1200], [6919, 1200], [8400, 1300],
    [10504, 1300], [11700, 1100], [12800, 1250], [13450, 1700], [13800, 2600], [13600, 4505], [13650, 6200],
    [13600, 8226], [13700, 9460], [13340, 10572], [13330, 11316], [13350, 12050], [13540, 12810],
  ],
};

// ============================================================================
// 野怪营地
// ============================================================================
function unitDir(fromX, fromY, toX, toY) {
  const dx = toX - fromX, dy = toY - fromY;
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}
/** 生成营地内多只野怪的位置：offsets 为 [前进, 侧向, kind] 相对 facing 的偏移 */
function campMonsters(x, y, facing, list) {
  const fx = Math.cos(facing), fy = Math.sin(facing);
  const lx = -fy, ly = fx;
  return list.map(([f, l, kind]) => ({ kind, x: R(x + fx * f + lx * l), y: R(y + fy * f + ly * l), facing: +facing.toFixed(4) }));
}
const MONSTER_LAYOUT = {
  blue: [[0, 0, 'blue_sentinel']],
  red: [[0, 0, 'red_brambleback']],
  gromp: [[0, 0, 'gromp']],
  wolves: [[0, 0, 'murkwolf'], [150, 170, 'murkwolf_small'], [150, -170, 'murkwolf_small']],
  raptors: [[0, 0, 'raptor'], [190, 0, 'raptor_small'], [150, 150, 'raptor_small'], [150, -150, 'raptor_small'], [40, 220, 'raptor_small'], [40, -220, 'raptor_small']],
  krugs: [[0, 0, 'krug_ancient'], [60, 210, 'krug']],
  scuttle_top: [[0, 0, 'scuttle']],
  scuttle_bot: [[0, 0, 'scuttle']],
  dragon: [[0, 0, 'dragon']],
  baron: [[0, 0, 'baron']],
  herald: [[0, 0, 'herald']],
};
const CAMP_TIMING = {
  blue: [90, 300, 1000], red: [90, 300, 1000], gromp: [90, 135, 800], wolves: [90, 135, 800], raptors: [90, 135, 800], krugs: [90, 135, 800],
  scuttle_top: [210, 150, 1400], scuttle_bot: [210, 150, 1400], dragon: [300, 300, 1300], baron: [1200, 360, 1300], herald: [480, 99999, 1300],
};
const CAMP_NAMES = {
  blue: '蓝色魔像', red: '红色树精', gromp: '魔沼蛙', wolves: '暗影狼', raptors: '锋喙鸟', krugs: '石甲虫',
  scuttle_top: '迅捷蟹', scuttle_bot: '迅捷蟹', dragon: '元素亚龙', baron: '纳什男爵', herald: '峡谷先锋',
};
// 蓝方半场营地：[id, kind, x, y, 朝向目标点（营地入口）]
const BLUE_CAMPS = [
  ['b_blue', 'blue', 3821, 8101, [3150, 7250]],
  ['b_gromp', 'gromp', 2090, 8428, [3000, 8300]],
  ['b_wolves', 'wolves', 3780, 6440, [4550, 6250]],
  ['b_raptors', 'raptors', 6943, 5422, [6700, 6100]],
  ['b_red', 'red', 7765, 4020, [6300, 3550]],
  ['b_krugs', 'krugs', 8400, 2700, [8050, 3350]],
];
// 红方半场营地（LoL 实际坐标），朝向目标点为蓝方对应入口的镜像
const RED_CAMPS = [
  ['r_blue', 'blue', 10984, 6960], ['r_gromp', 'gromp', 12703, 6444], ['r_wolves', 'wolves', 11008, 8387],
  ['r_raptors', 'raptors', 7852, 9471], ['r_red', 'red', 7101, 10900], ['r_krugs', 'krugs', 6317, 12146],
];
function makeCamp(id, kind, side, x, y, face, extra = {}) {
  const facing = Math.atan2(face[1] - y, face[0] - x);
  const [firstSpawn, respawn, leash] = CAMP_TIMING[kind];
  return {
    id, kind, side, name: CAMP_NAMES[kind], x, y, facing: +facing.toFixed(4),
    monsters: campMonsters(x, y, facing, MONSTER_LAYOUT[kind]),
    firstSpawn, respawn, leash, ...extra,
  };
}
const _camps = [];
for (const [id, kind, x, y, face] of BLUE_CAMPS) _camps.push(makeCamp(id, kind, 0, x, y, face));
for (let i = 0; i < RED_CAMPS.length; i++) {
  const [id, kind, x, y] = RED_CAMPS[i];
  const bf = BLUE_CAMPS[i];
  // 以蓝方入口相对营地的方向镜像（点对称 = 方向取反）
  const [dx, dy] = unitDir(bf[2], bf[3], bf[4][0], bf[4][1]);
  _camps.push(makeCamp(id, kind, 1, x, y, [x - dx * 500, y - dy * 500]));
}
// 史诗野怪与迅捷蟹（中立）
_camps.push(makeCamp('dragon', 'dragon', 2, 9866, 4414, [10290, 4910], { pit: 'dragon' }));
_camps.push(makeCamp('baron', 'baron', 2, 5007, 10471, [4550, 9950], { pit: 'baron' }));
_camps.push(makeCamp('herald', 'herald', 2, 5007, 10471, [4550, 9950], { pit: 'baron', despawnAt: 1185 }));
_camps.push(makeCamp('scuttle_top', 'scuttle_top', 2, 4400, 9600, [5300, 9150], {
  // 迅捷蟹在河道内巡游的路线点
  path: [[4400, 9600], [3300, 11300], [4400, 9600], [5700, 8800]],
}));
_camps.push(makeCamp('scuttle_bot', 'scuttle_bot', 2, 10500, 5170, [9540, 5710], {
  path: [[10500, 5170], [11540, 3560], [10500, 5170], [9140, 6060]],
}));
export const CAMPS = _camps;

// ============================================================================
// 河道：中心线 + 各顶点半宽（上半河道定义后镜像得到下半河道）
// ============================================================================
const RIVER_TOP = [
  // [x, y, 半宽]：上路河口较窄，大龙坑/迅捷蟹一带最宽，靠近中路收窄
  [1300, 13500, 430], [1850, 12950, 480], [2450, 12450, 540], [3100, 11800, 600], [3600, 11050, 640],
  [4100, 10250, 700], [4650, 9650, 690], [5300, 9200, 620], [5950, 8750, 550], [6550, 8250, 500],
  [7050, 7800, 490], [7420, 7430, 560],
];
const _riverPts = RIVER_TOP.map(([x, y]) => [x, y]).concat(RIVER_TOP.slice(0, -1).reverse().map(([x, y]) => mp([x, y])));
const _riverHw = RIVER_TOP.map((p) => p[2]).concat(RIVER_TOP.slice(0, -1).reverse().map((p) => p[2]));
/** path：河道中心线（上路河口 → 地图中心 → 下路河口）；width：典型半宽；halfWidths：各顶点半宽 */
export const RIVER = { path: _riverPts, width: 600, halfWidths: _riverHw };

// ============================================================================
// 龙坑
// ============================================================================
export const PITS = {
  dragon: { x: 9866, y: 4414, r: 640, mouth: { x: 10290, y: 4910 } },
  baron: { x: 5007, y: 10471, r: 640, mouth: { x: 4550, y: 9950 } },
};

// ============================================================================
// 可行走区域雕刻原语。默认整张图都是墙：
//   corridors：折线走廊，w = 全宽（到折线距离 ≤ w/2 的格子可走）
//   clearings：圆形空地；areas：可走多边形（基地平台）
//   blockers：回填为墙的多边形（在以上雕刻之后执行）
// 河道（RIVER，按半宽）与龙坑（PITS）同样由 NavGrid 雕刻为可走。
// ============================================================================

// 蓝方基地平台边界（逆时针），红方为其镜像
const BLUE_BASE = [
  [4600, 450], [4600, 1650], [4450, 1950], [4280, 2450], [4180, 2950], [4200, 3500],
  [3500, 4200], [2950, 4180], [2450, 4280], [1950, 4450], [1650, 4600], [500, 4600],
  [330, 3600], [200, 2400], [150, 1200], [150, 150], [1200, 150], [2400, 200], [3600, 330],
];
export const BASE_BOUNDARY = [BLUE_BASE, mpts(BLUE_BASE)];

// —— 半张图的走廊 ——
const HALF_CORRIDORS = [
  // 上路全程（蓝方高地门 → 左上角转角 → 红方高地门）；镜像即为下路全程
  { pts: [[1150, 4300], [1180, 5000], [1250, 5800], [1300, 6700], [1230, 7500], [1130, 8400], [1100, 9300], [1060, 10300],
    [1000, 11200], [1020, 11900], [1120, 12600], [1400, 13200], [1850, 13600], [2500, 13830], [3300, 13900], [4300, 13860],
    [5200, 13780], [6000, 13700], [7000, 13560], [7900, 13480], [8600, 13500], [9300, 13570], [10000, 13620], [10500, 13650],
    [10900, 13680]], w: 900, tag: 'lane' },
  // 蓝方半条中路（高地门 → 地图中心）；镜像为红方半条
  { pts: [[3450, 3450], [4200, 4150], [4700, 4600], [5050, 4950], [5450, 5550], [5800, 6050], [6150, 6450], [6700, 6900], [7420, 7430]], w: 860, tag: 'lane' },

  // —— 蓝方上半野区（蓝 BUFF / 魔沼蛙 / 暗影狼）——
  { pts: [[1100, 11150], [1600, 10950], [2150, 10650]], w: 480, tag: 'jungle' },                    // 上路 → 三角草
  { pts: [[2150, 10650], [2500, 11000], [2850, 11350]], w: 500, tag: 'jungle' },                    // 三角草 → 河道
  { pts: [[2150, 10650], [2400, 10000], [2400, 9300], [2300, 8750]], w: 460, tag: 'jungle' },      // 三角草 → 魔沼蛙
  { pts: [[2300, 8500], [2750, 8350], [3200, 8250], [3750, 8100]], w: 480, tag: 'jungle' },        // 魔沼蛙 → 蓝 BUFF
  { pts: [[3800, 8100], [4150, 8500], [4450, 8950], [4700, 9350]], w: 520, tag: 'jungle' },        // 蓝 BUFF → 河道
  { pts: [[3800, 8050], [3450, 7600], [3150, 7250]], w: 480, tag: 'jungle' },                      // 蓝 BUFF → 南侧路口
  { pts: [[1300, 7550], [1800, 7500], [2400, 7400], [3150, 7250]], w: 450, tag: 'jungle' },        // 上路二塔旁入口 → 路口
  { pts: [[3150, 7250], [3450, 6850], [3800, 6450]], w: 460, tag: 'jungle' },                      // 路口 → 暗影狼
  { pts: [[3800, 6450], [4300, 6300], [4850, 6150], [5450, 5800]], w: 460, tag: 'jungle' },        // 暗影狼 → 中路
  { pts: [[3800, 6450], [3550, 5900], [3200, 5350]], w: 460, tag: 'jungle' },                      // 暗影狼 → 基地外环路
  { pts: [[1150, 5250], [1700, 5350], [2300, 5400], [2800, 5350], [3200, 5300], [3600, 5050], [3830, 4760], [4300, 4240]], w: 470, tag: 'jungle' }, // 上路 → 基地外环 → 中路
  { pts: [[3850, 8050], [4400, 7800], [5000, 7550], [5600, 7250], [6200, 6850]], w: 460, tag: 'jungle' }, // 蓝 BUFF → 中路一塔旁

  // —— 蓝方下半野区（锋喙鸟 / 红 BUFF / 石甲虫）——
  { pts: [[5250, 1150], [5350, 1700], [5400, 2300], [5350, 2800], [5300, 3200], [5150, 3700], [5070, 4000], [4600, 4500]], w: 470, tag: 'jungle' }, // 下路 → 基地外环 → 中路
  { pts: [[5300, 3200], [5900, 3400], [6500, 3600], [7100, 3850], [7700, 4000]], w: 480, tag: 'jungle' }, // 外环 → 红 BUFF
  { pts: [[7700, 4000], [7500, 4500], [7250, 5000], [6950, 5450]], w: 460, tag: 'jungle' },        // 红 BUFF → 锋喙鸟
  { pts: [[6950, 5450], [6800, 5900], [6550, 6450]], w: 460, tag: 'jungle' },                      // 锋喙鸟 → 中路
  { pts: [[6950, 5450], [7350, 5800], [7700, 6150], [8000, 6500]], w: 480, tag: 'jungle' },        // 锋喙鸟 → 河道
  { pts: [[7700, 4000], [8150, 4450], [8550, 4950], [8850, 5500], [9050, 5900]], w: 480, tag: 'jungle' }, // 红 BUFF → 河道（小龙坑西侧）
  { pts: [[7700, 4000], [7950, 3500], [8200, 3050], [8350, 2700]], w: 460, tag: 'jungle' },        // 红 BUFF → 石甲虫
  { pts: [[8350, 2700], [8150, 2200], [7950, 1750], [7800, 1400]], w: 450, tag: 'jungle' },        // 石甲虫 → 下路二塔旁
  { pts: [[8350, 2700], [9000, 2600], [9700, 2400], [10500, 2250]], w: 450, tag: 'jungle' },       // 石甲虫 → 下路三角草
  { pts: [[10500, 2250], [10900, 1700], [11200, 1050]], w: 480, tag: 'jungle' },                   // 三角草 → 下路
  { pts: [[10500, 2250], [10900, 2700], [11300, 3150]], w: 500, tag: 'jungle' },                   // 三角草 → 河道

  // —— 大龙坑坑口（朝西南开向河道）——
  { pts: [[5007, 10471], [4550, 9950]], w: 880, tag: 'pit' },
];

// —— 半张图的空地（营地用两个圆叠成不规则凹地）——
const HALF_CLEARINGS = [
  { x: 420, y: 420, r: 950, tag: 'fountain' },          // 泉水平台
  { x: 1650, y: 1700, r: 900, tag: 'plaza' },           // 枢纽广场
  { x: 1400, y: 13300, r: 620, tag: 'lane' },           // 上路转角
  // 营地空地
  { x: 3800, y: 8080, r: 520, tag: 'camp' }, { x: 3500, y: 8230, r: 360, tag: 'camp' },     // 蓝 BUFF
  { x: 2280, y: 8480, r: 440, tag: 'camp' }, { x: 2150, y: 8300, r: 320, tag: 'camp' },     // 魔沼蛙
  { x: 3800, y: 6450, r: 460, tag: 'camp' }, { x: 4000, y: 6300, r: 300, tag: 'camp' },     // 暗影狼
  { x: 6950, y: 5450, r: 480, tag: 'camp' }, { x: 7150, y: 5300, r: 320, tag: 'camp' },     // 锋喙鸟
  { x: 7700, y: 4000, r: 520, tag: 'camp' }, { x: 7400, y: 3850, r: 350, tag: 'camp' },     // 红 BUFF
  { x: 8350, y: 2680, r: 470, tag: 'camp' }, { x: 8600, y: 2600, r: 320, tag: 'camp' },     // 石甲虫
  // 路口
  { x: 2150, y: 10650, r: 330, tag: 'junction' },       // 上路三角草
  { x: 3150, y: 7250, r: 320, tag: 'junction' },
  { x: 3200, y: 5320, r: 300, tag: 'junction' },
  { x: 5300, y: 3200, r: 300, tag: 'junction' },
  { x: 10500, y: 2250, r: 330, tag: 'junction' },       // 下路三角草
];

const HALF_BLOCKERS = [];

// 红方营地实际坐标处补充空地（与镜像空地重叠，保证连通）
const RED_CAMP_CLEARINGS = RED_CAMPS.map(([, kind, x, y]) => ({ x, y, r: kind === 'blue' || kind === 'red' ? 500 : 420, tag: 'camp' }));

// 野区走廊折点处补一个略大的圆，让转角圆润、像被踩出来的小空地
const JOINTS = [];
for (const c of HALF_CORRIDORS) {
  if (c.tag !== 'jungle') continue;
  for (let i = 1; i < c.pts.length - 1; i++) JOINTS.push({ x: c.pts[i][0], y: c.pts[i][1], r: R(c.w * (0.56 + ((i * 37 + c.w) % 7) * 0.02)), tag: 'joint' });
}
const HALF_ALL_CLEARINGS = HALF_CLEARINGS.concat(JOINTS);
// 必须保持可走的关键点（出生点、建筑旁的兵线点等），在墙体扰动后强制恢复
const KEEP = [];
for (const f of FOUNTAINS) for (const s of f.spawns) KEEP.push({ x: s.x, y: s.y, r: 120 });
for (const lane of Object.values(LANES)) for (const [x, y] of lane) KEEP.push({ x, y, r: 160 });

export const WALK = {
  corridors: HALF_CORRIDORS.concat(HALF_CORRIDORS.map((c) => ({ ...c, pts: mpts(c.pts) }))),
  clearings: HALF_ALL_CLEARINGS.concat(HALF_ALL_CLEARINGS.map((c) => {
    const [x, y] = mp([c.x, c.y]);
    return { ...c, x, y };
  })).concat(RED_CAMP_CLEARINGS),
  // 墙体边缘噪声（NavGrid 用它让墙体轮廓不规则；对称）
  edgeNoise: { amp: 70, scale: 520, seed: 11 },
  keepWalkable: KEEP,
  areas: BASE_BOUNDARY.map((poly, team) => ({ poly, team, tag: 'base' })),
  blockers: HALF_BLOCKERS.concat(HALF_BLOCKERS.map((b) => ({ ...b, poly: mpts(b.poly) }))),
};

// ============================================================================
// 草丛（多边形）。kind：lane 兵线草 / tri 三角草 / river 河道草 / pixel 像素草 / jungle 野区草 / mid 中路草 / base 基地外草
// ============================================================================
const HALF_BRUSHES = [
  // 上路（全程，镜像为下路）
  { kind: 'lane', name: '上路河道草（蓝侧）', poly: strip(1300, 11700, 1350, 12350, 260, 1) },
  { kind: 'lane', name: '上路河道草（红侧）', poly: strip(2300, 13450, 3100, 13520, 260, 2) },
  { kind: 'tri', name: '上路三角草', poly: [[1850, 10450], [2500, 10550], [2150, 11000]] },
  { kind: 'lane', name: '上路二塔入口草', poly: strip(1750, 7520, 2200, 7450, 250, 4) },
  { kind: 'base', name: '上路外环草', poly: strip(1700, 5350, 2300, 5400, 260, 5) },
  // 蓝方上半野区
  { kind: 'jungle', name: '魔沼蛙草', poly: blob(2400, 9500, 200, 170, 85, 10, 0.12, 6) },
  { kind: 'jungle', name: '蓝 BUFF 草', poly: blob(4200, 8600, 230, 170, 50, 11, 0.12, 7) },
  { kind: 'jungle', name: '蓝 BUFF 后草', poly: blob(3250, 8260, 190, 150, 0, 10, 0.12, 8) },
  { kind: 'jungle', name: '路口草', poly: strip(2600, 7380, 2950, 7300, 250, 9) },
  { kind: 'jungle', name: '暗影狼草', poly: blob(4400, 6280, 220, 160, -10, 10, 0.12, 10) },
  { kind: 'mid', name: '中路狼口草', poly: blob(5100, 6000, 210, 150, 25, 10, 0.12, 11) },
  { kind: 'mid', name: '中路蓝 BUFF 口草', poly: blob(5700, 7200, 230, 160, 30, 11, 0.12, 12) },
  { kind: 'base', name: '暗影狼外环草', poly: blob(3450, 5750, 190, 150, 60, 10, 0.12, 13) },
  // 蓝方下半野区
  { kind: 'mid', name: '锋喙鸟中路草', poly: blob(6720, 6050, 210, 160, 110, 10, 0.12, 14) },
  { kind: 'river', name: '锋喙鸟河道草', poly: blob(7600, 6050, 220, 160, 45, 11, 0.12, 15) },
  { kind: 'jungle', name: '红 BUFF 草', poly: blob(6950, 3800, 230, 160, 20, 11, 0.12, 16) },
  { kind: 'jungle', name: '红 BUFF 河道口草', poly: blob(8500, 4900, 210, 160, 55, 10, 0.12, 17) },
  { kind: 'jungle', name: '石甲虫草', poly: blob(8050, 2000, 190, 160, 70, 10, 0.12, 18) },
  { kind: 'tri', name: '下路三角草', poly: [[10200, 2050], [10850, 2150], [10450, 2600]] },
  { kind: 'base', name: '下路外环草', poly: strip(5350, 1700, 5400, 2300, 260, 19) },
  { kind: 'jungle', name: '石甲虫小路草', poly: blob(9400, 2480, 200, 150, -10, 10, 0.12, 20) },
  // 上半河道
  { kind: 'pixel', name: '上河道像素草', poly: blob(3500, 11100, 170, 120, -50, 9, 0.1, 21) },
  { kind: 'river', name: '大龙坑口草（西）', poly: blob(4150, 10500, 200, 150, -55, 10, 0.12, 22) },
  { kind: 'river', name: '大龙坑口草（东）', poly: blob(5350, 9750, 200, 150, -40, 10, 0.12, 23) },
  { kind: 'river', name: '上河道中路草', poly: blob(6100, 8300, 220, 150, -40, 10, 0.12, 24) },
];
/** 镜像草丛名称：上路↔下路、蓝侧↔红侧、大龙↔小龙、上河道↔下河道 */
function mirrorName(n) {
  const SW = { '上路': '下路', '下路': '上路', '蓝侧': '红侧', '红侧': '蓝侧', '大龙': '小龙', '上河道': '下河道' };
  return n.replace(/上路|下路|蓝侧|红侧|大龙|上河道/g, (m) => SW[m]);
}
// side：0 = 蓝方半场野区草，1 = 红方半场野区草，2 = 兵线/河道公共草
const SIDED = new Set(['jungle', 'mid', 'base', 'tri']);
export const BRUSHES = [];
for (const b of HALF_BRUSHES) {
  const sided = SIDED.has(b.kind);
  BRUSHES.push({ id: BRUSHES.length, kind: b.kind, side: sided ? 0 : 2, name: (sided ? '蓝方' : '') + b.name, poly: b.poly });
}
for (const b of HALF_BRUSHES) {
  const sided = SIDED.has(b.kind);
  BRUSHES.push({ id: BRUSHES.length, kind: b.kind, side: sided ? 1 : 2, name: (sided ? '红方' : '') + mirrorName(b.name), poly: mpts(b.poly) });
}

// ============================================================================
// 地形装饰提示（给地形渲染代理）
// ============================================================================
function riverRocks() {
  const out = [];
  const P = RIVER.path, H = RIVER.halfWidths;
  for (let i = 0; i < P.length - 1; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1];
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
    const nx = -dy / l, ny = dx / l;
    const steps = Math.max(1, Math.floor(l / 450));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const hw = H[i] + (H[i + 1] - H[i]) * t;
      const side = (i + s) % 2 === 0 ? 1 : -1;
      out.push({ x: R(x0 + dx * t + nx * side * (hw - 70)), y: R(y0 + dy * t + ny * side * (hw - 70)), r: 50 + ((i * 7 + s * 13) % 5) * 12 });
    }
  }
  return out;
}
function gateOf(team, lane, ax, ay, bx, by, dx, dy) {
  return { team, lane, a: { x: ax, y: ay }, b: { x: bx, y: by }, x: R((ax + bx) / 2), y: R((ay + by) / 2), dirX: dx, dirY: dy, width: R(Math.hypot(bx - ax, by - ay)) };
}
const _blueGates = [
  gateOf(0, 'top', 500, 4600, 1650, 4600, 0, 1),
  gateOf(0, 'mid', 4200, 3500, 3500, 4200, 0.7071, 0.7071),
  gateOf(0, 'bot', 4600, 450, 4600, 1650, 1, 0),
];
const _mirrorGate = (g) => {
  const a = mirrorPoint(g.a.x, g.a.y), b = mirrorPoint(g.b.x, g.b.y);
  // 点对称会把上路与下路互换
  const lane = g.lane === 'top' ? 'bot' : g.lane === 'bot' ? 'top' : 'mid';
  return gateOf(1, lane, a.x, a.y, b.x, b.y, -g.dirX, -g.dirY);
};
const _blueBaseWalls = [
  // 基地围墙（平台边缘，不含三个出口与地图边界）：上-中之间、中-下之间
  [[1650, 4600], [1950, 4450], [2450, 4280], [2950, 4180], [3500, 4200]],
  [[4200, 3500], [4180, 2950], [4280, 2450], [4450, 1950], [4600, 1650]],
];
const _props = [];
function addProp(kind, x, y, facing = 0, team = 2, scale = 1) { _props.push({ kind, x: R(x), y: R(y), facing: +facing.toFixed(3), team, scale }); }
// 基地门口雕像（每个出口两侧各一座）
for (const g of _blueGates) {
  for (const t of [0, 1]) {
    const src = t === 0 ? g : _mirrorGate(g);
    const f = Math.atan2(src.dirY, src.dirX);
    addProp('statue', src.a.x + (src.b.x - src.a.x) * 0.02, src.a.y + (src.b.y - src.a.y) * 0.02, f, t, 1.2);
    addProp('statue', src.b.x + (src.a.x - src.b.x) * 0.02, src.b.y + (src.a.y - src.b.y) * 0.02, f, t, 1.2);
  }
}
// 枢纽广场火盆 / 泉水平台水晶柱
for (const t of [0, 1]) {
  const nx = t === 0 ? 1550 : 13250, ny = t === 0 ? 1600 : 13280;
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + Math.PI / 4;
    addProp('brazier', nx + Math.cos(a) * 520, ny + Math.sin(a) * 520, a, t, 1);
  }
  const fx = t === 0 ? 420 : 14380, fy = t === 0 ? 420 : 14420;
  for (let i = 0; i < 3; i++) {
    const a = ((15 + i * 30) * Math.PI) / 180;
    const d = t === 0 ? 1 : -1;
    addProp('crystalPillar', fx + d * Math.cos(a) * 820, fy + d * Math.sin(a) * 820, a, t, 1);
  }
}
// 兵线中心线（视觉石板路用；LANES 路径点会为绕塔而偏移，这里取走廊中心）
const _topLine = HALF_CORRIDORS[0].pts;
const _midHalf = HALF_CORRIDORS[1].pts;
export const LANE_CENTERLINES = {
  top: [[1300, 2050], [1180, 3000]].concat(_topLine, [[12050, 13480], [12850, 13500]]),
  mid: [[1960, 2040], [2700, 2700]].concat(_midHalf, mpts(_midHalf).reverse().slice(1), [[12140, 12160], [12830, 12850]]),
  bot: mpts([[1300, 2050], [1180, 3000]].concat(_topLine, [[12050, 13480], [12850, 13500]])).reverse(),
};
// 兵线路灯（沿三路中心线每隔约 1700 交替放在两侧路边）
for (const lane of ['top', 'mid', 'bot']) {
  const pts = LANE_CENTERLINES[lane];
  let acc = 0, side = 1;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const l = Math.hypot(x1 - x0, y1 - y0);
    acc += l;
    if (acc > 1700) {
      acc = 0;
      side = -side;
      const nx = -(y1 - y0) / l, ny = (x1 - x0) / l;
      if (!isInBaseRaw(x1, y1)) addProp('lantern', x1 + nx * 360 * side, y1 + ny * 360 * side, Math.atan2(y1 - y0, x1 - x0), 2, 1);
    }
  }
}
function isInBaseRaw(x, y) { return pointInPoly(x, y, BASE_BOUNDARY[0]) || pointInPoly(x, y, BASE_BOUNDARY[1]); }
// 野区小路（视觉泥土路，两半张图）
const JUNGLE_TRAILS = HALF_CORRIDORS.filter((c) => c.tag === 'jungle').flatMap((c) => [
  { pts: c.pts, w: R(c.w * 0.55) }, { pts: mpts(c.pts), w: R(c.w * 0.55) },
]);

export const DECOR = {
  center: { x: CX, y: CY },
  // 基地：boundary = 抬高的平台边界；plaza = 枢纽广场；fountain = 泉水平台；gates = 三个出口；walls = 平台围墙折线
  bases: [
    {
      team: 0, theme: 'blue', boundary: BASE_BOUNDARY[0], platformHeight: 45,
      plaza: { x: 1650, y: 1700, r: 900 }, nexus: { x: 1550, y: 1600 },
      fountain: { x: 420, y: 420, r: 950, pool: 380 }, gates: _blueGates, walls: _blueBaseWalls,
    },
    {
      team: 1, theme: 'red', boundary: BASE_BOUNDARY[1], platformHeight: 45,
      plaza: { x: 13190, y: 13160, r: 900 }, nexus: { x: 13250, y: 13280 },
      fountain: { x: 14380, y: 14420, r: 950, pool: 380 }, gates: _blueGates.map(_mirrorGate), walls: _blueBaseWalls.map(mpts),
    },
  ],
  // 兵线石板路（视觉用，比可走走廊窄）
  lanePaths: ['top', 'mid', 'bot'].map((lane) => ({ lane, pts: LANE_CENTERLINES[lane], w: 620 })),
  // 野区泥土小路（沿野区走廊中心）
  jungleTrails: JUNGLE_TRAILS,
  // 河道：中路与河道交汇处的浅滩，以及岸边石块
  riverFord: { x: CX, y: CY, r: 700 },
  riverRocks: riverRocks(),
  // 营地泥地
  campAreas: CAMPS.filter((c) => !c.pit && !c.kind.startsWith('scuttle')).map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, r: c.kind === 'blue' || c.kind === 'red' ? 420 : 340 })),
  // 龙坑：坑口方向与坑沿
  pits: {
    dragon: { ...PITS.dragon, depth: 40, rim: 120 },
    baron: { ...PITS.baron, depth: 40, rim: 120 },
  },
  props: _props,
};

// ============================================================================
// 工具函数
// ============================================================================
function distToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x, ey = ay + dy * t - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
/** 点是否在多边形内（射线法） */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** 点所属兵线：到三条兵线路径的最近距离 ≤ 1100 时返回该路，否则 null（野区/河道） */
export function laneOf(x, y) {
  let best = null, bd = 1100;
  for (const lane of ['mid', 'top', 'bot']) {
    const d = distToPolyline(x, y, LANES[lane]);
    if (d < bd) { bd = d; best = lane; }
  }
  return best;
}
/** 点是否在某队基地（抬高平台或泉水平台）内 */
export function isInBase(team, x, y) {
  if (team !== 0 && team !== 1) return false;
  const f = FOUNTAINS[team];
  if ((x - f.x) ** 2 + (y - f.y) ** 2 <= f.platformRadius ** 2) return true;
  return pointInPoly(x, y, BASE_BOUNDARY[team]);
}
/** 点到河道中心线的距离（河道内返回 ≤ 半宽） */
export function riverDistance(x, y) { return distToPolyline(x, y, RIVER.path); }
/** 点是否在河道内 */
export function isInRiver(x, y) {
  const P = RIVER.path, H = RIVER.halfWidths;
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const hw = H[i] + (H[i + 1] - H[i]) * t;
    if ((ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2 <= hw * hw) return true;
  }
  return false;
}
