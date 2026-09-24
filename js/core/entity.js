// 实体基类：所有场上对象（单位、守卫）的公共字段
let fallbackId = 1;

export class Entity {
  constructor(game, { type, team, x, y, radius = 35 } = {}) {
    // 每局独立自增 id（保证确定性）
    this.id = game ? (game._nextEntityId = (game._nextEntityId || 0) + 1) : fallbackId++;
    this.game = game;
    this.type = type;
    this.team = team;
    this.x = x ?? 0;
    this.y = y ?? 0;
    this.z = 0;             // 离地高度偏移（击飞/位移弧线）
    this.radius = radius;
    this.facing = 0;
    this.alive = true;
    this.removed = false;
    this.visible = [team === 0, team === 1]; // 本队恒可见，敌方由 Vision 设置
    this.sightRange = 0;
    this.revealedUntil = 0;
    this.spawnTime = game ? game.time : 0;
  }

  update(dt) {} // eslint-disable-line no-unused-vars
}
