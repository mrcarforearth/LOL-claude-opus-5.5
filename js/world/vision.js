// 视野（临时桩：全图可见；map 代理会整体重写此文件）
export class Vision {
  constructor(game) {
    this.game = game; this.cellSize = 100; this.cols = 150; this.rows = 150;
    this.grids = [new Uint8Array(150 * 150).fill(1), new Uint8Array(150 * 150).fill(1)];
  }
  update() {
    const g = this.game;
    for (const list of [g.champions, g.minions, g.structures, g.monsters, g.pets, g.wards]) {
      if (!list) continue;
      for (const e of list) { e.visible[0] = true; e.visible[1] = true; }
    }
  }
  isVisible() { return true; }
  canSee() { return true; }
}
