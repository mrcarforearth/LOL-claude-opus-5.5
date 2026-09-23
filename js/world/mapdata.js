// 地图数据（临时桩：map 代理会整体重写此文件）
export const MAP = { size: 15000 };
export const FOUNTAINS = [
  { team: 0, x: 420, y: 420, radius: 1100, spawns: [[520, 300], [650, 420], [520, 560], [350, 650], [300, 500]].map(([x, y]) => ({ x, y })) },
  { team: 1, x: 14380, y: 14420, radius: 1100, spawns: [[14280, 14540], [14150, 14420], [14280, 14280], [14450, 14170], [14500, 14320]].map(([x, y]) => ({ x, y })) },
];
const T = (id, team, lane, tier, x, y) => ({ id, team, kind: 'turret', lane, tier, x, y });
export const STRUCTURES = [
  T('b_top_outer', 0, 'top', 'outer', 981, 10441), T('b_top_inner', 0, 'top', 'inner', 1512, 6699), T('b_top_inhib', 0, 'top', 'inhib', 1169, 4287),
  T('b_mid_outer', 0, 'mid', 'outer', 5846, 6396), T('b_mid_inner', 0, 'mid', 'inner', 5048, 4812), T('b_mid_inhib', 0, 'mid', 'inhib', 3651, 3696),
  T('b_bot_outer', 0, 'bot', 'outer', 10504, 1029), T('b_bot_inner', 0, 'bot', 'inner', 6919, 1483), T('b_bot_inhib', 0, 'bot', 'inhib', 4281, 1253),
  T('b_nexus_t1', 0, null, 'nexus', 1748, 2270), T('b_nexus_t2', 0, null, 'nexus', 2177, 1807),
  T('r_top_outer', 1, 'top', 'outer', 4318, 13875), T('r_top_inner', 1, 'top', 'inner', 7943, 13411), T('r_top_inhib', 1, 'top', 'inhib', 10481, 13650),
  T('r_mid_outer', 1, 'mid', 'outer', 8955, 8510), T('r_mid_inner', 1, 'mid', 'inner', 9767, 10113), T('r_mid_inhib', 1, 'mid', 'inhib', 11134, 11207),
  T('r_bot_outer', 1, 'bot', 'outer', 13866, 4505), T('r_bot_inner', 1, 'bot', 'inner', 13327, 8226), T('r_bot_inhib', 1, 'bot', 'inhib', 13624, 10572),
  T('r_nexus_t1', 1, null, 'nexus', 12611, 13084), T('r_nexus_t2', 1, null, 'nexus', 13052, 12612),
  { id: 'b_top_inhibitor', team: 0, kind: 'inhibitor', lane: 'top', x: 1171, y: 3571 },
  { id: 'b_mid_inhibitor', team: 0, kind: 'inhibitor', lane: 'mid', x: 3203, y: 3208 },
  { id: 'b_bot_inhibitor', team: 0, kind: 'inhibitor', lane: 'bot', x: 3452, y: 1236 },
  { id: 'r_top_inhibitor', team: 1, kind: 'inhibitor', lane: 'top', x: 11261, y: 13676 },
  { id: 'r_mid_inhibitor', team: 1, kind: 'inhibitor', lane: 'mid', x: 11598, y: 11667 },
  { id: 'r_bot_inhibitor', team: 1, kind: 'inhibitor', lane: 'bot', x: 13604, y: 11316 },
  { id: 'b_nexus', team: 0, kind: 'nexus', x: 1550, y: 1600 },
  { id: 'r_nexus', team: 1, kind: 'nexus', x: 13250, y: 13280 },
  { id: 'b_fountain', team: 0, kind: 'fountainTurret', x: 420, y: 420 },
  { id: 'r_fountain', team: 1, kind: 'fountainTurret', x: 14380, y: 14420 },
];
export const LANES = {
  top: [[1550, 1600], [1171, 3571], [1169, 4287], [1512, 6699], [981, 10441], [1500, 13300], [4318, 13875], [7943, 13411], [10481, 13650], [11261, 13676], [13250, 13280]],
  mid: [[1550, 1600], [3203, 3208], [3651, 3696], [5048, 4812], [7420, 7430], [9767, 10113], [11134, 11207], [11598, 11667], [13250, 13280]],
  bot: [[1550, 1600], [3452, 1236], [4281, 1253], [6919, 1483], [10504, 1029], [13300, 1500], [13866, 4505], [13327, 8226], [13624, 10572], [13604, 11316], [13250, 13280]],
};
const C = (id, kind, side, x, y, firstSpawn = 90, respawn = 135) => ({ id, kind, side, x, y, monsters: [{ kind, x, y }], firstSpawn, respawn, leash: 900 });
export const CAMPS = [
  C('b_blue', 'blue', 0, 3821, 8101, 90, 300), C('b_gromp', 'gromp', 0, 2090, 8428), C('b_wolves', 'wolves', 0, 3780, 6440),
  C('b_raptors', 'raptors', 0, 6943, 5422), C('b_red', 'red', 0, 7765, 4020, 90, 300), C('b_krugs', 'krugs', 0, 8400, 2700),
  C('r_blue', 'blue', 1, 10984, 6960, 90, 300), C('r_gromp', 'gromp', 1, 12703, 6444), C('r_wolves', 'wolves', 1, 11008, 8387),
  C('r_raptors', 'raptors', 1, 7852, 9471), C('r_red', 'red', 1, 7101, 10900, 90, 300), C('r_krugs', 'krugs', 1, 6317, 12146),
  C('dragon', 'dragon', 2, 9866, 4414, 300, 300), C('baron', 'baron', 2, 5007, 10471, 1200, 360), C('herald', 'herald', 2, 5007, 10471, 480, 99999),
  C('scuttle_top', 'scuttle_top', 2, 4400, 9600, 210, 150), C('scuttle_bot', 'scuttle_bot', 2, 10500, 5170, 210, 150),
];
export const BRUSHES = [];
export const RIVER = { path: [[2200, 12600], [5000, 10100], [7420, 7430], [9900, 4800], [12600, 2200]], width: 600 };
export const PITS = { dragon: { x: 9866, y: 4414, r: 700 }, baron: { x: 5007, y: 10471, r: 700 } };
export const WALK = { corridors: [], clearings: [{ x: 7500, y: 7500, r: 20000 }], blockers: [] };
export const DECOR = {};
export function laneOf(x, y) {
  if (Math.abs(x - y) < 1500) return 'mid';
  return x < y ? 'top' : 'bot';
}
export function isInBase(team, x, y) {
  return team === 0 ? x + y < 7000 && x < 5000 && y < 5000 : x + y > 22800 && x > 9800 && y > 9800;
}
