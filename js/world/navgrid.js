// 导航网格（临时桩：全部可走、直线寻路；map 代理会整体重写此文件）
export class NavGrid {
  constructor(mapdata) {
    this.map = mapdata;
    this.cellSize = 50; this.cols = 300; this.rows = 300;
    this.walk = new Uint8Array(this.cols * this.rows).fill(1);
    this.brush = new Int16Array(this.cols * this.rows).fill(-1);
    this.sdf = new Float32Array(this.cols * this.rows).fill(-500);
  }
  cellIndex(x, y) {
    const c = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));
    const r = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));
    return r * this.cols + c;
  }
  cellCenter(i) { return { x: (i % this.cols + 0.5) * this.cellSize, y: (Math.floor(i / this.cols) + 0.5) * this.cellSize }; }
  isWalkable(x, y) { return x >= 50 && y >= 50 && x <= 14950 && y <= 14950; }
  findPath(sx, sy, tx, ty) { const p = this.nearestWalkable(tx, ty); return [p]; }
  hasLineOfWalk() { return true; }
  raycastWalk(x0, y0, x1, y1) { return this.nearestWalkable(x1, y1); }
  nearestWalkable(x, y) { return { x: Math.max(50, Math.min(14950, x)), y: Math.max(50, Math.min(14950, y)) }; }
  brushAt() { return -1; }
  blocksSight() { return false; }
}
