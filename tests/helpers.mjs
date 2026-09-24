// 测试工具：创建无头对局、生成训练假人、推进时间、断言与简易测试运行器
import { Game } from '../js/core/game.js';
import { Champion } from '../js/core/champion.js';
import { Unit } from '../js/core/unit.js';
import { CHAMPIONS } from '../js/champions/index.js';
import { createAI } from '../js/ai/championAI.js';
import { TICK } from '../js/config.js';

export const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
export const DEFAULT_BLUE = ['garen', 'leesin', 'ahri', 'jinx', 'thresh'];
export const DEFAULT_RED = ['darius', 'masteryi', 'lux', 'ashe', 'annie'];
export const SUMMONERS_BY_ROLE = {
  top: ['flash', 'teleport'], jungle: ['flash', 'smite'], mid: ['flash', 'ignite'], adc: ['flash', 'heal'], support: ['flash', 'exhaust'],
};
// 地图中心（河道中央，远离防御塔，适合放置测试单位）
export const CENTER = { x: 7420, y: 7430 };

export function teamConfig(ids, roles = ROLES) {
  return ids.map((championId, i) => ({ championId, role: roles[i] || 'mid', summoners: SUMMONERS_BY_ROLE[roles[i]] || ['flash', 'ignite'] }));
}

// 开阔场地导航：全图可走，可选矩形墙体 walls 与草丛 brushes（[{ x0, y0, x1, y1, id }]），用于与地图无关的确定性测试
export class OpenNav {
  constructor({ walls = [], brushes = [] } = {}) {
    this.walls = walls;
    this.brushes = brushes;
    this.cellSize = 50; this.cols = 300; this.rows = 300;
  }
  _inRect(r, x, y) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }
  isWalkable(x, y) {
    if (!(x >= 0 && y >= 0 && x <= 15000 && y <= 15000)) return false;
    for (const w of this.walls) if (this._inRect(w, x, y)) return false;
    return true;
  }
  cellIndex(x, y) { return Math.floor(Math.max(0, Math.min(14999, y)) / 50) * 300 + Math.floor(Math.max(0, Math.min(14999, x)) / 50); }
  cellCenter(i) { return { x: (i % 300 + 0.5) * 50, y: (Math.floor(i / 300) + 0.5) * 50 }; }
  hasLineOfWalk(x0, y0, x1, y1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 20));
    for (let i = 0; i <= n; i++) if (!this.isWalkable(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n)) return false;
    return true;
  }
  raycastWalk(x0, y0, x1, y1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4));
    let lx = x0, ly = y0;
    for (let i = 1; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      if (!this.isWalkable(x, y)) break;
      lx = x; ly = y;
    }
    return { x: lx, y: ly };
  }
  nearestWalkable(x, y, maxRadius = 1500) {
    if (this.isWalkable(x, y)) return { x, y };
    for (let r = 10; r <= maxRadius; r += 10) {
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (this.isWalkable(px, py)) return { x: px, y: py };
      }
    }
    return { x: Math.max(1, Math.min(14999, x)), y: Math.max(1, Math.min(14999, y)) };
  }
  findPath(sx, sy, tx, ty) { return [this.nearestWalkable(tx, ty)]; }
  brushAt(x, y) { for (const b of this.brushes) if (this._inRect(b, x, y)) return b.id ?? 0; return -1; }
  blocksSight() { return false; }
}
// 全图可见的视野（测试用）
export class AllVision {
  constructor(game) { this.game = game; this.grids = [new Uint8Array(1).fill(1), new Uint8Array(1).fill(1)]; }
  update() {
    const g = this.game;
    for (const list of [g.champions, g.minions, g.structures, g.monsters, g.pets, g.wards]) for (const e of list) { e.visible[0] = true; e.visible[1] = true; }
  }
  isVisible() { return true; }
  canSee() { return true; }
}

// 创建对局；waves: false 时不刷兵/野怪（建筑仍在）；open: true（或 { walls, brushes }）时使用开阔场地导航与全图视野
export function makeGame(opts = {}) {
  const { blue = [], red = [], ai = false, waves = true, seed = 1, open = false, ...rest } = opts;
  const game = new Game({
    blue: blue.map((c) => (typeof c === 'string' ? { championId: c } : c)),
    red: red.map((c) => (typeof c === 'string' ? { championId: c } : c)),
    champions: CHAMPIONS, createAI: ai ? createAI : null, seed, headless: true, ...rest,
  });
  if (!waves) game.spawner.update = () => {};
  if (open) {
    game.nav = new OpenNav(typeof open === 'object' ? open : {});
    game.vision = new AllVision(game);
  }
  return game;
}

let dummySeq = 0;
// 生成训练假人：type 'champion'（默认，可被指向英雄技能选中）或 'minion'/'monster'
export function spawnDummy(game, { team = 1, x = CENTER.x, y = CENTER.y, hp = 2000, armor = 0, mr = 0, ms = 0, ad = 0, level = 1, type = 'champion', radius = 65, name = '训练假人', xpValue = 0, goldValue = 0 } = {}) {
  const baseStats = { hp, armor, mr, ms, ad, resource: 'none', range: 125, radius, hpRegen: 0 };
  let u;
  if (type === 'champion') {
    const def = { id: `dummy${++dummySeq}`, name, baseStats, abilities: {}, ai: {} };
    u = new Champion(game, def, { team, x, y, slot: 0 });
    u.gold = 0;
    if (level > 1) u.setLevel(level);
  } else {
    u = new Unit(game, { type, team, x, y, name, baseStats, radius });
    u.xpValue = xpValue;
    u.goldValue = goldValue;
    u.softCollision = type === 'minion' || type === 'monster';
    if (type === 'minion') u.kind = 'melee';
  }
  u.setPosition(x, y);
  game.add(u);
  return u;
}

export function run(game, seconds) {
  const n = Math.round(seconds / TICK);
  for (let i = 0; i < n && !game.over; i++) game.step(TICK);
}

export function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败：${msg}`);
}
export function approx(a, b, eps, msg) {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`断言失败：${msg}（实际 ${a}，期望 ${b} ± ${eps}）`);
}

// 简易测试运行器
const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }
export async function runTests({ quiet = false } = {}) {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      if (!quiet) console.log(`  ✓ ${t.name}`);
    } catch (err) {
      fail++;
      console.log(`  ✗ ${t.name}\n    ${err.stack || err}`);
    }
  }
  console.log(`\n通过 ${pass} / ${pass + fail}`);
  return fail === 0;
}
