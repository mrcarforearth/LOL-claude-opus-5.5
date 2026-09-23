# 峡谷对决（Rift Clash）— 架构与接口规范 v1

> 非官方同人作品：浏览器内的 5v5 MOBA，尽可能真实地还原英雄联盟「召唤师峡谷」。玩家对战 AI。
> **本文件是所有模块的唯一契约。** 所有代理必须严格按这里的文件归属、导出名、函数签名、字段名编码。
> 如果你认为契约需要改动：不要擅自修改别人的文件，在你的最终报告里写「INTEGRATION NOTES」说明。

---

## 0. 总则

- **无构建步骤**：原生 ES Modules，浏览器直接加载。Three.js 固定版本 `0.160.0`，通过 importmap：
  `"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"`,
  `"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"`。
  除此之外**不得**引入任何外部脚本/资源（图片、音频、模型全部程序化生成；字体只允许 Google Fonts）。
- **模拟层与表现层严格分离**：
  - 模拟层 = `js/config.js`、`js/core/`、`js/world/`、`js/entities/`、`js/champions/*.js`、`js/items/`、`js/ai/`。
    **绝不** import `three`，**绝不**访问 `window`/`document`/DOM/Canvas/Audio（例外：英雄/装备定义里的 `icon.draw(ctx,size)` 函数只会被 UI 调用）。必须能在 Node 24 下 `import` 并无头运行（`node tests/sim.mjs`）。
  - 表现层 = `js/render/`、`js/ui/`、`js/audio/`、`js/input/`、`js/main.js`。只读取模拟状态、订阅事件；只通过「命令」改变模拟（`champ.moveTo / attackUnit / castAbility / castSummoner / useItem / levelUpAbility / startRecall`、`shop.buy/sell`）。
  - 模拟代码需要视觉效果时，调用 `game.fx.xxx(...)`（见 §10.3）。无头模式下 `game.fx` 是 NullFX（所有方法都是空操作并返回假句柄），所以模拟逻辑不能依赖 fx 的返回值。
- **确定性**：模拟层随机数只用 `game.rng()`（种子化）。禁止在模拟层用 `Math.random()`/`Date.now()`。
- **语言**：所有面向玩家的文字使用简体中文；代码注释用简体中文（简洁）；标识符用英文。
- **代码风格**：ES2022，2 空格缩进，单引号，分号；类用 PascalCase，函数/字段 camelCase，常量 UPPER_SNAKE。每个文件顶部一行中文注释说明用途。
- **健壮性**：表现层每帧逻辑出错不能让整个游戏崩溃——系统 `update` 内部自行 try/catch 并 `console.error` 一次（节流）。模拟层不要吞异常（测试需要看到）。

## 1. 目录与文件归属

| 路径 | 负责人 | 说明 |
|---|---|---|
| `index.html` | core | 页面骨架、importmap、字体、DOM 容器 |
| `css/style.css` | ui | 全部样式（core 先写最小版本） |
| `js/main.js` | core | 启动流程、主循环、URL 参数 |
| `js/config.js` | core | 常量 |
| `js/core/*.js` | core | math, events, game, entity, unit, stats, damage, buffs, projectile, zone, pet, ward, rewards, champion, summoners, nullfx |
| `js/world/mapdata.js` `navgrid.js` `vision.js` | map | 地图数据、导航网格/A*、战争迷雾/视野 |
| `tools/mappreview.mjs` | map | 生成地图预览 PNG（自检用） |
| `js/entities/minion.js` `structures.js` `monsters.js` `spawner.js` | entities | 小兵、防御塔/水晶/枢纽/泉水、野怪/史诗怪、刷新调度 |
| `js/champions/index.js` `_common.js` `garen.js` | core | 英雄注册表、共享辅助函数、示例英雄盖伦 |
| `js/champions/darius.js` `leesin.js` `masteryi.js` | champs-fighters | 德莱厄斯、李青、易 |
| `js/champions/ahri.js` `lux.js` `annie.js` | champs-mages | 阿狸、拉克丝、安妮 |
| `js/champions/ashe.js` `jinx.js` `thresh.js` | champs-marksmen | 艾希、金克丝、锤石 |
| `js/render/champfx/index.js` | core | 英雄特效注册表 |
| `js/render/champfx/<id>.js` | 与该英雄相同的负责人 | 英雄专属视觉特效 |
| `js/items/items.js` `shop.js` | items | 装备数据库、被动/主动、购买/出售/合成、推荐出装 |
| `js/ai/championAI.js`（及 `js/ai/*.js`） | ai | 英雄 AI |
| `js/input/input.js` | core | 键鼠输入 → 命令 |
| `js/render/renderer.js` `camera.js` | core | Three 场景、相机、视图同步、拾取 |
| `js/render/terrain.js`（及 `js/render/terrain/*.js`）`fogrender.js` | terrain | 地形、河流、墙体、树木、草丛、基地装饰、光照氛围、战争迷雾渲染 |
| `js/render/models/index.js` | core | 视图工厂分发 |
| `js/render/models/champions.js`（及 `models/champ/*.js`） | models-champions | 10 个英雄 + 提伯斯的程序化模型、动画、头像渲染 |
| `js/render/models/units.js`（及 `models/unit/*.js`） | models-units | 小兵、防御塔、水晶、枢纽、泉水、野怪、史诗怪、守卫模型与动画 |
| `js/render/fx.js`（及 `js/render/fx/*.js`）`overlay.js` `indicators.js` | fx | 特效框架与通用图元、投射物外观、血条/伤害数字、技能指示器/点击标记/悬停高亮 |
| `js/ui/*.js` | ui | 选人、加载、HUD、小地图、商店、记分板、击杀播报、菜单、结算 |
| `js/audio/*.js` | audio | 程序化音效、中文语音播报、环境音 |
| `tests/helpers.mjs` `tests/sim.mjs` | core | 测试工具与无头整局模拟 |
| `tests/<area>_*.mjs` | 各模块负责人 | 自己模块的测试 |
| `tools/browsercheck.mjs` | （已存在） | 无头 Chrome 自检工具，见 §15 |

**规则**：只修改自己负责的文件。可以在自己的目录前缀下新建文件。需要别人改动 → INTEGRATION NOTES。

## 2. 坐标、单位、时间约定

- 游戏平面坐标 `(x, y)`，单位 = LoL 游戏单位。地图范围 `0..15000`（正方形）。**蓝色方基地在左下**（泉水约 `(420, 420)`），**红色方在右上**（约 `(14380, 14420)`）。
- Three 场景映射：`scene(X, Y, Z) = (x, h, -y)`，`h` 为高度（同单位）。屏幕上方 = 北 = +y。
- 朝向 `facing`：弧度，`atan2(dy, dx)`（游戏平面）。**模型本地正前方为 +X**，渲染器设置 `object3d.rotation.y = facing`（该映射下 +X 恰好转到游戏方向 `(cos, sin)`）。
- 距离：单位间「边缘距离」`edgeDist = centerDist - a.radius - b.radius`。普攻射程判定：`centerDist <= attackRange + a.radius + b.radius`。指向性技能施法距离判定：`centerDist <= range + target.radius`。技能碰撞：投射物圆（半径 `width`）与单位圆（`radius`）相交。
- 时间：秒。`game.time` 从 0 开始 = 游戏时钟 0:00。模拟固定步长 `TICK = 1/30`，`game.speed` 为倍速。
- 颜色：模拟层/渲染层用数字 `0xRRGGBB`；UI 用 CSS 字符串。
- 队伍：`TEAM.BLUE = 0`，`TEAM.RED = 1`，`TEAM.NEUTRAL = 2`（野怪）。中立单位对 0/1 都是敌对。

## 3. `js/config.js`（core）

```js
export const MAP_SIZE = 15000;
export const TEAM = { BLUE: 0, RED: 1, NEUTRAL: 2 };
export const TEAM_NAMES = ['蓝色方', '红色方', '中立'];
export const TICK = 1 / 30;
export const MAX_LEVEL = 18;
// XP_TABLE[L-1] = 达到等级 L 所需的累计经验
export const XP_TABLE = [0, 280, 660, 1140, 1720, 2400, 3180, 4060, 5040, 6120, 7300, 8580, 9960, 11440, 13020, 14700, 16480, 18360];
export const RESPAWN_BASE = [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5];
export const TIMINGS = {
  WELCOME: 1, MINIONS_30S: 35, FIRST_WAVE: 65, WAVE_INTERVAL: 30,
  JUNGLE_SPAWN: 90, SCUTTLE_SPAWN: 210, DRAGON_SPAWN: 300, DRAGON_RESPAWN: 300,
  HERALD_SPAWN: 480, HERALD_DESPAWN: 1185, BARON_SPAWN: 1200, BARON_RESPAWN: 360,
  INHIB_RESPAWN: 300, PASSIVE_GOLD_START: 110, PLATING_END: 840,
};
export const GOLD = { START: 500, PASSIVE_PER_SEC: 2.04, KILL_BASE: 300, FIRST_BLOOD_BONUS: 100, ASSIST_SHARE: 0.5 };
export const RANGES = {
  XP_SHARE: 1600, ASSIST_WINDOW: 10, FOUNTAIN: 1100, TURRET: 750,
  SIGHT_CHAMPION: 1350, SIGHT_MINION: 1100, SIGHT_TURRET: 1350, SIGHT_STRUCTURE: 1200, SIGHT_WARD: 900, SIGHT_PET: 800,
};
export const RECALL_TIME = 8;
export const BARON_RECALL_TIME = 4;
export const AS_CAP = 2.5;
export const CC_TYPES = ['stun', 'root', 'silence', 'slow', 'airborne', 'charm', 'fear', 'taunt', 'suppress', 'disarm', 'blind', 'ground', 'nearsight', 'sleep'];
export const DIFFICULTY = {
  easy:   { reaction: 0.55, accuracy: 0.45, aggression: 0.35, lastHit: 0.55, dodge: 0.10, thinkInterval: 0.30, label: '新手' },
  normal: { reaction: 0.30, accuracy: 0.70, aggression: 0.60, lastHit: 0.80, dodge: 0.35, thinkInterval: 0.20, label: '一般' },
  hard:   { reaction: 0.15, accuracy: 0.90, aggression: 0.85, lastHit: 0.95, dodge: 0.60, thinkInterval: 0.12, label: '困难' },
};
export const COLORS = {
  BLUE: 0x2f86d6, RED: 0xd03a3a, SELF_BAR: 0x46c21f, ALLY_BAR: 0x2f8fdc, ENEMY_BAR: 0xd23b2c, NEUTRAL_BAR: 0xe0a020,
  PHYSICAL: 0xff8a2a, MAGIC: 0x6aa8ff, TRUE: 0xffffff, HEAL: 0x5fe35f, GOLD: 0xffd34d,
};
```

## 4. 核心模拟层 API（core）

### 4.1 事件总线 `js/core/events.js`

```js
export class EventBus { on(name, fn) → unsubscribeFn; once(name, fn); off(name, fn); emit(name, payload); }
```
同步派发；监听器异常要 `console.error` 并继续派发其余监听器（不打断模拟）。

**事件表**（`game.events.emit(name, payload)`）：

| 事件 | payload |
|---|---|
| `gameStart` | `{}` |
| `spawn` / `remove` | `{ entity }` |
| `damage` | `{ source, target, amount, absorbed, type, isCrit, isBasicAttack, isAbility, isDot, isOnHit, spell, killed }` — amount 为减免后（含被护盾吸收部分），absorbed 为护盾吸收量 |
| `heal` | `{ source, target, amount }` |
| `shield` | `{ source, target, amount }` |
| `cc` | `{ source, target, type, duration }` |
| `basicAttack` | `{ attacker, target, isCrit }`（出手瞬间） |
| `attackHit` | `{ attacker, target, isCrit }` |
| `abilityCast` | `{ caster, slot, abilityId, rank, target, x, y, isRecast }` |
| `summonerCast` | `{ caster, key, spellId, target, x, y }` |
| `itemUsed` | `{ champion, itemId }` |
| `death` | `{ unit, killer, killerChampion }` |
| `championKill` | `{ victim, killer, killerChampion, assists, bounty, shutdown, firstBlood, multiKill, streak, executed, ace }` |
| `structureDestroyed` | `{ structure, kind, team, lane, tier, killerChampion }`（team = 被摧毁建筑所属队伍） |
| `inhibitorRespawn` | `{ structure, team }` |
| `objectiveKilled` | `{ kind, team, killerChampion, dragonType }`（team = 击杀方；kind ∈ dragon/baron/herald/scuttle/blue/red/gromp/wolves/raptors/krugs） |
| `minionWave` | `{ wave, hasSiege, hasSuper }` |
| `levelUp` | `{ unit, level }` |
| `xpGained` | `{ champion, amount }` |
| `goldGained` | `{ champion, amount, reason, x, y }`（reason ∈ minion/kill/assist/turret/plate/monster/passive/sell/objective） |
| `itemBought` / `itemSold` | `{ champion, itemId, refund? }` |
| `recallStart` / `recallCancel` / `recallEnd` | `{ champion }` |
| `respawn` | `{ champion }` |
| `announce` | `{ key, text, team, killer, victim, subject }`（team = 受益队伍，UI/音频自行换算为「我方/敌方」） |
| `ping` | `{ team, x, y, kind, source }` |
| `gameOver` | `{ winner }` |

`announce.key` 取值：`welcome, minions30, minionsSpawned, firstBlood, kill, doubleKill, tripleKill, quadraKill, pentaKill, killingSpree, rampage, unstoppable, godlike, legendary, shutdown, ace, executed, turretDestroyed, inhibitorDestroyed, inhibitorRespawning, inhibitorRespawned, dragonSlain, baronSlain, heraldSlain, baronSpawn, dragonSpawn, victory, defeat`。

### 4.2 `Game`（`js/core/game.js`）

```js
export class Game {
  constructor(opts) // 见下
  // 状态
  time; speed; paused; over; winner;          // winner: 0|1|null
  events;            // EventBus
  rng();             // [0,1) 种子随机
  map;               // world/mapdata.js 模块命名空间
  nav;               // NavGrid
  vision;            // Vision
  spawner;           // entities/spawner.js 的 Spawner
  fx;                // FX 或 NullFX
  difficulty;        // 'easy'|'normal'|'hard'
  champions; minions; structures; monsters; pets; wards; projectiles; zones;   // 数组
  entities;          // Map<id, entity>（不含投射物/区域）
  player;            // 玩家 Champion 或 null
  teams;             // [TeamState, TeamState]：{ kills, turretsDestroyed, inhibsDestroyed, dragons: [], baronKills, heraldKills }
  firstBloodDone; firstTurretDone;

  update(realDt)     // 累加 realDt*speed（单帧最多 0.25s 模拟时间），按 TICK 调用 step
  step(dt)           // 一个固定步：见下
  add(entity)        // 加入对应数组并 emit('spawn')；返回 entity
  remove(entity)     // 标记 entity.removed = true，本步结束时移出数组、emit('remove')
  get allUnits()     // 本步缓存：champions + minions + structures + monsters + pets（alive 的）
  queryUnits(opts); queryLine(opts); queryCone(opts); nearest(opts);   // §4.13
  dealDamage(source, target, amount, type, opts);                       // §4.5
  heal(source, target, amount, opts);
  spawnProjectile(opts); spawnZone(opts); spawnPet(opts); placeWard(owner, x, y, kind);
  onUnitDeath(unit, killer);    // 由 unit.die 调用：奖励、事件、播报
  announce(key, text, extra = {});
  fountainOf(team) → { x, y, radius };
  isVisible(team, entity) → bool;   // 代理到 vision.canSee
  getChampion(championId) → Champion|null;
  enemyTeam(team) → 1 - team;
  end(winner);                      // 设置 over/winner，emit('gameOver')
}
```

**构造参数**：
```js
new Game({
  blue: [{ championId, role, isPlayer = false, summoners = ['flash', 'ignite'], name }] ×5,
  red:  [...] ×5,
  champions,              // js/champions/index.js 的 CHAMPIONS（id → def）
  createAI,               // js/ai/championAI.js 的 createAI（可为 null）
  difficulty = 'normal', speed = 1, seed = 1,
  headless = false, fx = null,     // null → NullFX
  autopilot = false,      // true：玩家英雄也挂 AI
});
```
构造时：创建 nav/vision/spawner，调用 `spawner.init()`（建筑），在泉水生成 10 个英雄（每人 `GOLD.START` 金币，1 级，1 个技能点），为非玩家英雄（或 autopilot 时全部）挂 `champ.controller = createAI(champ, game, { role, difficulty })`，emit `gameStart`。

**step(dt) 顺序**：`time += dt` → `spawner.update(dt)` → 各英雄 `controller?.update(dt)` → 所有单位 `update(dt)`（英雄、宠物、小兵、野怪、建筑、守卫）→ 软碰撞分离（`softCollision` 单位）→ 投射物 `update` → 区域 `update` → `vision.update(dt)` → 被动金币（`time >= PASSIVE_GOLD_START`）→ 清理 removed。`paused || over` 时 `update` 不推进。

### 4.3 `Entity`（`js/core/entity.js`）与 `Unit`（`js/core/unit.js`）

```js
export class Entity {
  constructor(game, { type, team, x, y, radius = 35 })
  id;            // 自增整数
  game; type; team; x; y; z = 0;   // z = 离地高度偏移（击飞/位移弧线），渲染用
  radius; facing = 0;
  alive = true; removed = false;
  visible = [false, false];        // 对 0/1 队是否可见（由 Vision 设置；本队恒为 true）
  sightRange = 0;
  revealedUntil = 0;               // 在此之前对敌方「暴露」（草丛中攻击会暴露）
  update(dt) {}
}
```
`type` ∈ `champion | minion | turret | inhibitor | nexus | monster | pet | ward`。

```js
export class Unit extends Entity {
  constructor(game, { type, team, x, y, name, modelId, baseStats, level = 1, radius })
  name; modelId; level; baseStats;    // 规范化基础属性（§4.4）
  stats;                              // 计算后属性（每 tick 重算）
  hp; mana;                           // 当前生命、资源
  bonusStats = {};                    // 额外固定加成（装备系统写 champion.itemStats，其他来源可写这里）
  buffs = [];  shields = [];
  owner = null;                       // 宠物/召唤物的主人
  command = null;                     // { type: 'move'|'attack'|'attackMove'|'castMove'|'stop', ... }
  path = [];  attackTarget = null;
  attackCooldown = 0;                 // 距下次可普攻的剩余时间
  attackState = null;                 // { phase: 'windup', t, target, windup } 前摇中
  dashState = null; channel = null; castLock = 0;
  anim = { state: 'idle', t: 0, speed: 1, slot: null, windup: 0, attackIndex: 0 };
  modelState = {};                    // 英雄代码写入的外观状态（§10.2）
  invulnerable = false; untargetable = false; unstoppable = false; stealthed = false;
  softCollision = false;              // 小兵/野怪/宠物 = true
  lastDamagedAt = -99; lastCombatAt = -99;
  damageLog = new Map();              // championId → 最后造成伤害时间（助攻判定）
  xpValue = 0; goldValue = 0;         // 被击杀奖励（小兵/野怪用）

  // —— 属性 ——
  recalcStats();
  get maxHp(); get maxMana(); get ad(); get ap(); get armor(); get mr(); get attackSpeed(); get attackRange(); get moveSpeed();
  get totalShield();
  // —— 命令 ——
  moveTo(x, y); attackUnit(target); attackMove(x, y); stop();
  faceTowards(x, y);
  resetAttack();                      // 普攻重置：attackCooldown = 0
  // —— 状态查询 ——
  canMove(); canAttack(); canCast(); canUseSummoner(); isCCd(); hasCC(type);
  isEnemy(other); isAlly(other);      // 参数可为单位或队伍编号
  distTo(o); edgeDist(o);             // o 为单位或 {x,y}
  inAttackRange(target);
  isTargetableBy(unit);               // alive && !untargetable && (同队 || game.isVisible(unit.team, this))
  // —— 效果 ——
  applyCC(type, duration, { source, amount, x, y } = {}) → bool;
  slow(amount, duration, source);     // amount 0..1
  cleanse();
  addBuff(def) → Buff; removeBuff(id); getBuff(id); hasBuff(id);
  addShield(amount, duration, { type = 'all', source, id }) → shield;
  dash(opts) → bool; knockback(opts); knockup(duration, source); pullTo(opts); blink(x, y);
  startChannel(opts); interruptChannel(reason);
  // —— 钩子 ——
  addHook(name, fn) → removeFn; runHooks(name, ...args);
  // —— 生命周期 ——
  update(dt); die(killer);
}
```

**钩子名称与签名**（`unit.addHook(name, fn)`）：
- `modifyStats(stats)` — 每次重算属性末尾调用，可直接改 `stats`。
- `beforeDealDamage(ctx)` / `beforeTakeDamage(ctx)` — 可改 `ctx.amount`、`ctx.type`，设 `ctx.cancel = true` 取消。
- `afterDealDamage(ctx)` / `afterTakeDamage(ctx)` — `ctx.dealt` 为最终伤害。
- `onAttackLaunch(target, hit)` — 普攻出手（前摇结束）。
- `onHit(target, hit)` — 普攻命中、结算伤害前。`hit = { damage, type: 'physical', isCrit, extra: [] }`；可改 `hit.damage`，或 `hit.extra.push({ amount, type, spell })` 追加独立伤害。
- `afterHit(target, hit)` — 普攻伤害结算后（施加减速等）。
- `onAbilityCast(slot, ability, ctx)`；`onKill(victim)`；`onTakedown(victim)`（英雄击杀或助攻）；`onDeath(killer)`；`onLevelUp(level)`。

**普攻流程**（core 实现）：有攻击命令且目标在射程内、`attackCooldown <= 0`、`canAttack()` → 进入前摇（`windup = (1/AS) * baseStats.windup`，面向目标，`anim.state='attack'`）→ 前摇结束：`onAttackLaunch`，近战立即结算命中；远程发射追踪投射物（`isBasicAttack`，外观取 `baseStats.attackVfx`）→ 命中时：暴击判定 `game.rng() < stats.crit` → `onHit` → `dealDamage(isBasicAttack)` → extra 伤害 → `afterHit` → emit `attackHit`。`attackCooldown = 1/AS`（从前摇开始计）。前摇中移动 = 取消本次普攻（不进 CD）。前摇结束后可立即移动（走砍）。

**移动**：`moveTo` 调用 `game.nav.findPath`；目标不可走则取最近可走点。追击目标时每 0.25s 或目标移动 >100 时重寻路。每步按 `stats.moveSpeed` 沿路径前进，更新 `facing`。`attackMove`：沿途自动攻击射程+300 内最近的敌人（优先英雄以外的最近目标，符合 LoL 行为：最近的敌方单位）。

**动画状态**（core 每 tick 设置 `anim.state`，状态改变时 `anim.t = 0`，否则累加）：优先级 `death > airborne > stunned > dash > channel/recall > cast > attack > run > idle`。`anim.speed`：attack = `attackSpeed / baseStats.as`，run = `moveSpeed / baseStats.ms`。`anim.windup` = 当前普攻前摇秒数。`anim.slot` = 施法槽位。`anim.attackIndex` 每次普攻 +1。

### 4.4 属性 `js/core/stats.js`

**基础属性（英雄定义 `baseStats`）**，与 LoL 数据同名同义（回复为「每 5 秒」）：
```js
{ hp, hpPerLevel, hpRegen, hpRegenPerLevel,
  mana, manaPerLevel, manaRegen, manaRegenPerLevel, resource: 'mana'|'energy'|'none',
  ad, adPerLevel, as, asRatio /*默认=as*/, asPerLevel /*百分比数值, 如 3.65*/,
  armor, armorPerLevel, mr, mrPerLevel,
  ms, range, radius = 65, windup = 0.3 /*前摇占攻击间隔比例*/,
  missileSpeed = 0 /*0=近战*/, attackVfx /*远程普攻外观 {kind,color,size}*/, critMult = 1.75 }
```
成长公式：`stat(L) = base + perLevel * (L-1) * (0.7025 + 0.0175 * (L-1))`（攻速成长同理作用于 `asPerLevel/100`）。能量型：`maxMana = mana`（200），回复固定 `manaRegen`/5 每秒，不受成长影响。

**加成属性键**（装备 `stats`、Buff `stats`、`bonusStats` 通用）：
`hp, hpRegen(每5秒), hpRegenPct, mana, manaRegen(每5秒), manaRegenPct, ad, adPct, ap, apPct, armor, armorPct, mr, mrPct, attackSpeed(小数,0.25=+25%), crit(0..1), critDamage, moveSpeed(固定), moveSpeedPct(小数), lifeSteal, omnivamp, abilityHaste, lethality, armorPenPct, magicPen, magicPenPct, tenacity, healShieldPower, attackRange, damageReduction(0..1), grievous(0..1 受治疗降低)`

**计算后 `unit.stats` 字段**：
`maxHp, hpRegen(每秒), maxMana, manaRegen(每秒), ad, baseAd, bonusAd, ap, armor, bonusArmor, mr, bonusMr, attackSpeed(次/秒, ≤AS_CAP), bonusAS, attackRange, moveSpeed(含减速与软上限), crit, critMult, lifeSteal, omnivamp, abilityHaste, lethality, armorPenPct, magicPen, magicPenPct, tenacity, healShieldPower, damageReduction, grievous`
- `ad = (baseAd + Σad) * (1 + ΣadPct)`（adPct 只作用于总和中的 bonus 部分亦可，统一为总和）；`ap = Σap * (1 + ΣapPct)`。
- `attackSpeed = min(AS_CAP, as + asRatio * (levelBonusAS + ΣattackSpeed))`。
- `moveSpeed`：`raw = (ms + ΣmoveSpeed) * (1 + ΣmoveSpeedPct) * (1 - 最强减速)`；软上限：`>490: raw*0.5+230`；`>415: raw*0.8+83`；`<220: raw*0.5+110`。
- `tenacity = 1 - Π(1 - t_i)`。
- 最大生命变化时，当前生命按增量同步变化（LoL 行为）。

### 4.5 伤害与治疗 `js/core/damage.js`

```js
export function resistMultiplier(resist) // resist>=0: 100/(100+r)；否则 2 - 100/(100-r)
export function mitigate(source, target, amount, type) // physical: 护甲*(1-armorPenPct) - lethality；magic: 魔抗*(1-magicPenPct) - magicPen；true: 不减免
game.dealDamage(source, target, amount, type /* 'physical'|'magic'|'true' */, opts = {}) → 实际伤害
// opts: { isBasicAttack, isAbility, isCrit, isDot, isOnHit, isAoE, spell /* 如 'garen_q' */, noLifesteal, isTurret, isPet }
```
流程：目标无效/`invulnerable` → 0 → 构造 ctx → `source.beforeDealDamage` → `target.beforeTakeDamage` → `ctx.cancel` 则 0 → 减免 → `target.stats.damageReduction` → 护盾吸收（先类型专属，再 all；按到期先后）→ 扣血 → 生命偷取（仅普攻）/全能吸血 → 记录 `lastDamagedAt/lastCombatAt`、`damageLog`（来源是英雄或英雄的宠物时记主人）、来源若是在草丛中则 `revealedUntil = time + 1` → 统计（英雄 `damageToChampions`/`damageTaken`）→ emit `damage` → `after*` 钩子 → `hp <= 0` 时 `target.die(source)`。
`game.heal(source, target, amount, opts)`：乘 `(1 + source.healShieldPower)`（source 为英雄时）与 `(1 - target.grievous)`，不超过上限，emit `heal`，返回实际治疗量。

### 4.6 控制效果（CC）

| 类型 | 效果 | 韧性减免 |
|---|---|---|
| stun 眩晕 | 不能移动/普攻/施法/召唤师技能；打断引导与位移 | 是 |
| root 禁锢 | 不能移动/位移；可普攻、可施放非位移技能 | 是 |
| silence 沉默 | 不能施放技能（召唤师技能可用） | 是 |
| slow 减速 | `amount` 0..1，取最强 | 是（时长） |
| airborne 击飞 | 同眩晕；不可被净化 | 否 |
| charm 魅惑 | 朝来源走动（速度 ×0.65），不能行动 | 是 |
| fear 恐惧 | 远离来源随机走，不能行动 | 是 |
| taunt 嘲讽 | 强制普攻来源 | 是 |
| suppress 压制 | 同眩晕 | 否 |
| disarm 缴械 | 不能普攻 | 是 |
| blind 致盲 | 普攻落空 | 是 |
| ground 禁足 | 不能位移 | 是 |
| nearsight 致盲视野 | 视野降为 500 | 是 |
| sleep 睡眠 | 同眩晕，受伤害醒来 | 是 |

`unstoppable` 单位免疫全部 CC（`applyCC` 返回 false）。`applyCC` 成功时 emit `cc`，并打断 `channel`（stun/airborne/charm/fear/taunt/suppress/sleep；silence 只打断技能引导不打断回城）。

### 4.7 Buff 与护盾 `js/core/buffs.js`

```js
unit.addBuff({
  id,                   // 必填，同一单位同 id 再次添加 → 按 refresh 规则处理
  name, desc, icon,     // UI 显示（icon 同技能 icon 格式）；hidden: true 不显示
  source, duration,     // 秒，可为 Infinity
  stacks = 1, maxStacks = 1, refresh = 'duration' /* 'duration'|'stack'|'none'|'replace' */,
  stats,                // 加成属性对象；statsPerStack: true 时乘以层数
  statsPerStack = false,
  statsFn(unit, buff),  // 动态属性（返回对象）
  isDebuff = false, cleansable = false,
  tickInterval, onInterval(unit, buff),
  onApply(unit, buff), onTick(unit, buff, dt), onExpire(unit, buff), onRemove(unit, buff) /* 任何原因移除都会调用 */,
  data = {},
}) → Buff  // 实例额外字段：expiresAt, get remaining
```
护盾：`unit.addShield(amount, duration, { type, source, id })`，同 id 替换；emit `shield`；治疗/护盾强度只在英雄来源时生效。

### 4.8 位移

```js
unit.dash({ x, y, speed = 1200, duration /*与 speed 二选一*/, arcHeight = 0, ignoreWalls = false,
            unstoppable = false, hitRadius = 0, onHitUnit(unit) /*每个敌人只触发一次*/, hitFilter(unit),
            onEnd(interrupted), faceDir = true, followTarget /*追踪移动目标*/, stopDistance = 0 }) → bool
```
被 root/ground/stun/airborne 时返回 false。`!ignoreWalls` 时撞墙停止；`ignoreWalls` 时穿墙，终点吸附到最近可走点。位移期间 `dashState` 非空，不能移动/普攻。眩晕/击飞会打断（除非 unstoppable）。`z` 按抛物线 `arcHeight` 变化。
`knockback({ fromX, fromY, distance, duration = 0.4, source, height = 120 })` — 期间 airborne；撞墙停止。
`knockup(duration, source)` — 原地 airborne，`z` 抛物线。
`pullTo({ x, y, speed = 1500, source, stopDistance })` — airborne 状态被拉向点。
`blink(x, y)` — 瞬移；目标不可走时沿「起点→目标」反向找最近可走点。

**引导**：`startChannel({ id, duration, onComplete, onInterrupt, interruptOnMove = true, interruptOnDamage = false, canMove = false, anim = 'channel' })`。回城 = `id: 'recall'`，`interruptOnDamage: true`，`anim: 'recall'`。

### 4.9 投射物 `js/core/projectile.js`

```js
game.spawnProjectile({
  owner, x, y,                       // 起点默认 owner 位置
  target,                            // 追踪目标（必中；目标死亡/不可选中则消失）
  dirX, dirY, range, toX, toY,       // 直线技能：方向+射程，或终点
  speed = 1500, width = 60,          // width = 碰撞半径
  hits = 'first',                    // 'first' | 'pierce' | 'none'
  canHit(unit),                      // 默认：owner 的敌人、存活、可选中，类型 champion/minion/monster/pet
  collideWalls = false,
  returnToOwner = false,             // 到达终点后飞回 owner（回程命中集合重置）
  onHit(unit, proj) → true 停止,     // pierce 模式下返回 true 可提前终止
  onEnd(proj),                       // 到达终点/射程尽头/追踪命中后
  isBasicAttack = false,
  vfx = { kind: 'orb', color: 0xffffff, size: 1, trail: true },
  height = 100, data = {},
}) → Projectile { id, x, y, prevX, prevY, h, dirX, dirY, speed, vfx, owner, target, age, traveled, dead }
```
碰撞使用「上一帧→本帧」线段与单位圆的扫掠检测（防穿透）。生成时 core 自动调用 `game.fx.projectile(proj)`。

### 4.10 区域 `js/core/zone.js`

```js
game.spawnZone({ owner, team = owner.team, x, y, radius, duration, delay = 0 /*延迟生效*/, follow /*跟随单位*/,
  tickInterval = 0.25, filter = 'enemy' /*'enemy'|'ally'|'all'|fn*/, types /*默认 champion/minion/monster/pet*/,
  onStart(zone), onTick(zone, units), onEnter(zone, unit), onExit(zone, unit), onEnd(zone),
  vfx /*{ kind: 'disc'|'ring'|自定义名, color, ... } 或 null*/, data })
→ Zone { id, x, y, radius, age, dead, owner, remove() }
```
生成且有 vfx 时 core 调用 `game.fx.zone(zone)`。

### 4.11 宠物与守卫

```js
game.spawnPet({ owner, x, y, modelId /*如 'tibbers'*/, name, duration, baseStats, level = owner.level, radius = 80, think /*可选 (pet, dt) => void，自定义 AI*/ })
// → Pet extends Unit（type 'pet'，softCollision）。默认 AI：攻击主人当前普攻目标/最近 700 内敌人，否则跟随主人 300 内。击杀归属主人。
game.placeWard(owner, x, y, kind = 'stealth' /*'stealth'|'control'*/)
// → Ward（type 'ward'）：stealth：hp 3（每次普攻 -1），持续 90s，视野 900，隐形；control：hp 4，永久，视野 900，
//   揭示并使 900 内敌方隐形守卫可见（trueSight）。每人最多 3 个 stealth、1 个 control，超出移除最旧。
```

### 4.12 奖励 `js/core/rewards.js`

- **英雄击杀**：赏金 `300`，击杀者连杀 ≥3 起每多 1 次 +100（上限 1000，终结时播报 shutdown），被击杀者连死 ≥2 时每次 -15%（下限 100）。首杀 +100。助攻者平分 `bounty * 0.5`（10 秒内对受害者造成伤害/控制的敌方英雄）。经验：`(100 + 50*victimLevel) * (1 + 0.15*max(0, victimLevel - killerLevel))`，击杀者与 1600 内助攻者平分。
- **多杀**：同一英雄 10 秒内连续击杀计数（四杀→五杀窗口 30 秒），达到 2..5 播报；团灭（一方 5 人全部阵亡）播报 `ace`。
- **小兵**：金币只给最后一击的英雄（宠物归主人）；经验给 1600 内所有敌方英雄，每人份额：1 人 100%、2 人 65.1%、3 人 43.4%、4 人 32.55%、5 人 26.04%。补刀数 `cs++`。
- **野怪**：金币经验给击杀者（史诗怪经验给击杀方全部英雄）。
- **建筑**：见 §8。**被动金币**：`2.04/秒` 从 1:50 开始。
- **复活时间**：`RESPAWN_BASE[level-1]`，15 分钟后每分钟 +2%（上限 +50%）。被小兵/防御塔/野怪击杀且无英雄助攻 = `executed`。

### 4.13 查询

```js
game.queryUnits({ x, y, radius /*圆与单位圆相交*/, team, enemyOf /*单位或队伍*/, allyOf, types /*默认 ['champion','minion','monster','pet']*/,
                  targetableBy /*只返回该单位可选中的*/, includeDead = false, exclude /*单位或 Set*/, filter, sort = true /*按距离升序*/ })
game.queryLine({ x1, y1, x2, y2, width /*半宽*/, ...同上过滤 })
game.queryCone({ x, y, dirX, dirY, angle /*全角，度*/, range, ...同上过滤 })
game.nearest(opts) → 单位|null
```
`types` 可包含 `turret, inhibitor, nexus, ward`。

### 4.14 英雄 `Champion`（`js/core/champion.js`）

```js
export class Champion extends Unit {
  constructor(game, def, { team, role, isPlayer = false, summoners = ['flash', 'ignite'], name })
  def; championId; role; isPlayer; summonerName;
  controller = null;                   // AI
  xp = 0; level = 1; skillPoints = 1;
  abilities = { Q, W, E, R };          // AbilityState
  passive = { def, state: {} };
  summoners = { D, F };                // SummonerState { id, def, cooldownUntil, charges, state }
  items = [null ×6];                   // ItemState { id, def, cooldownUntil, charges, stacks, data, cleanup }
  trinket = { id: 'wardtotem', charges: 2, maxCharges: 2, rechargeAt: 0 };
  itemStats = {};                      // 由装备系统维护的加成属性和
  gold; totalGold; kills; deaths; assists; cs; killStreak; deathStreak;
  damageToChampions; damageTaken; healingDone; goldEarned; wardsPlaced;
  respawnAt = null; deathTime = null;
  get resourceType(); get xpToNext(); get xpProgress() /*0..1*/; get inFountain(); get canShop() /*inFountain || !alive*/;
  levelUpAbility(slot) → bool;         // R 需 6/11/16 级；普通技能 rank ≤ ceil(level/2)，上限 maxRank
  canLevelAbility(slot) → bool;
  castAbility(slot, { target, x, y } = {}) → { ok, reason? }   // reason: rank|cooldown|cost|cc|target|range|dead|busy
  castSummoner(key /*'D'|'F'*/, { target, x, y } = {}) → { ok, reason? }
  useItem(slotIndex, { target, x, y } = {}) → { ok, reason? }
  useTrinket(x, y) → { ok };
  startRecall(); cancelRecall();
  gainXp(amount); gainGold(amount, reason, x, y);
  respawn();
}
```
**castAbility 规则**：死亡/`castLock>0`/`!canCast()` 失败；处于 recast 窗口 → 调用 `def.recast`（不检查 CD 与消耗）；否则检查 rank、CD、消耗。`targeting`：
- `self`/`none`：直接施放。
- `unit`：`target` 必须满足 `targetFilter` 且可选中；超出 `range` → 设置 `command = { type: 'castMove', slot, target }`，走进射程后自动施放（返回 `{ ok: true, reason: 'queued' }`）。
- `point`/`direction`：`clampRange !== false` 时终点截断到 `range`；`dirX/dirY` 为施法者指向点的单位向量。
施放：支付消耗 → 面向目标 → 取消回城 → `castLock = castTime`（`lockMovement` 时停止移动）→ `castTime` 后调用 `def.cast(champ, ctx)`（返回 `false` = 失败，返还消耗、不进 CD）→ 进入冷却（除非 `manualCooldown`）→ emit `abilityCast`、钩子 `onAbilityCast`。
**冷却**：`cd * 100 / (100 + abilityHaste)`。

```js
AbilityState {
  slot; def; rank; cooldownUntil; cdDuration /*最近一次冷却总时长(UI 转圈)*/; recastUntil = 0; toggled = false; charges; state = {};
  get ready(); get cdRemaining(); get cost(); get isRecastActive();
  startCooldown(seconds /*可选，默认按 def.cooldown 与急速*/);
  reduceCooldown(seconds); resetCooldown();
  setRecast(window, { onExpire, cooldownOnExpire = true }); endRecast(startCd = true);
}
```

### 4.15 召唤师技能 `js/core/summoners.js`

```js
export const SUMMONERS = { flash, ignite, heal, barrier, exhaust, ghost, cleanse, smite, teleport };
// 每个：{ id, name, desc(champ), icon, cooldown, range, targeting, cast(champ, ctx) }
```
闪现 D（300s，400 距离，可穿墙）；引燃（180s，600，5 秒内 70+20×等级 真实伤害 + 40% 重伤）；治疗术（240s，自身与 850 内最残血队友回复 80+15×等级，+30% 移速 1s）；屏障（180s，护盾 105+15×等级 2.5s）；虚弱（210s，650，减速 30% 且伤害 -40% 3s）；幽灵疾步（210s，移速 +24%~48% 10s）；净化（210s，移除 CC + 65% 韧性 3s）；惩戒（90s 充能，2 层，500 距离，对野怪/小兵 600 真实伤害并回复）；传送（360s，引导 4s 传送到友方建筑/小兵/守卫旁）。

## 5. 英雄定义格式（`js/champions/<id>.js` 默认导出）

```js
export default {
  id: 'garen', name: '盖伦', title: '德玛西亚之力',
  roles: ['top'], tags: ['战士', '坦克'], difficulty: 1,   // 1..3
  lore: '一句话简介',
  baseStats: { ... §4.4 ... },
  model: { primary: 0x2a4f9e, secondary: 0xd8c28a, accent: 0xffffff },   // 模型配色提示
  portrait: { bg: ['#3a5da8', '#101a33'], glyph: '盖' },                  // 3D 头像不可用时的后备
  passive: { id, name, desc(champ), icon, init(champ), update?(champ, dt) },
  abilities: { Q, W, E, R },
  ai: { skillOrder: ['Q', 'E', 'W'], style: 'bruiser', engageRange: 450, kiteDistance: 0, combo: ['Q', 'E', 'R'] },
};
```
**AbilityDef**：
```js
{
  id: 'garen_q', name: '致命打击',
  desc(champ, rank) → string,            // 中文，含按当前属性计算的数值；rank 为 0 时按 1 级展示
  icon: { glyph: '击', bg: ['#f7d774', '#7a5a12'], fg: '#fff' },   // 或 { draw(ctx, size) }
  maxRank: 5,                            // R 为 3
  cooldown: [8, 8, 8, 8, 8],             // 或 (champ, rank) => 秒
  cost: [0, 0, 0, 0, 0],                 // 或函数；costType 默认英雄资源
  costType,                              // 'mana'|'energy'|'none'|'hp'
  range: 0,
  targeting: 'self' | 'unit' | 'point' | 'direction' | 'none',
  targetFilter: 'enemy' | 'ally' | 'any' | 'enemyChampion' | 'allyChampion',
  clampRange: true,
  indicator: { type: 'line', width, length } | { type: 'circle', radius } | { type: 'cone', angle, length } | { type: 'self', radius } | { type: 'unit' },
  castTime: 0.25, lockMovement: true,
  manualCooldown: false,
  sfx: 'slash',                          // slash|magic|fire|ice|light|shot|whoosh|impact|chain|electric|explosion|buff|dash|heal|shield|roar|spin
  cast(champ, ctx) → void | false,
  recast?(champ, ctx),
  update?(champ, ability, dt),           // 学会后每 tick 调用
  onLearn?(champ, ability),
  ai: {
    kind: 'nuke' | 'cc' | 'gapclose' | 'escape' | 'selfbuff' | 'shield' | 'heal' | 'aoe' | 'execute' | 'global' | 'toggle' | 'farm',
    range, radius, speed, width, delay,  // 技能射程/AOE 半径/弹道速度/宽度/延迟（用于预判）
    minTargets = 1, farm = false,
    when?(champ, target, game) → bool,   // 额外条件（如斩杀线）
    custom?(champ, ability, ai, game) → bool,   // 完全自定义：自己决定是否施放，已施放返回 true
  },
}
// ctx = { game, champ, ability, rank, slot, target, x, y, dirX, dirY, dist, isRecast }
```
`js/champions/_common.js`（core）提供：`rv(arr, rank)`（取等级数值）、`fmt(n)`、`scaleText(...)`、`skillshot(champ, opts)`（直线弹道便捷封装）、`aoeDamage(...)`、`isChampion(u)`、`angleDiff` 等。英雄作者可以用，也可以在自己文件里写私有辅助函数，但**不得修改** `_common.js`。

**参考实现：`js/champions/garen.js`** —— 所有英雄作者先读它再写自己的英雄。

## 6. 装备（items）

```js
// js/items/items.js
export const ITEMS = { [id]: ItemDef };
ItemDef = {
  id, name, cost /*总价*/, from: [ids], stats: {...§4.4 加成键},
  tags: ['ad'|'ap'|'tank'|'crit'|'as'|'onhit'|'lifesteal'|'mana'|'boots'|'consumable'|'starter'|'jungle'|'support'|'mr'|'armor'|'hp'|'haste'|'lethality'],
  tier: 'starter'|'basic'|'epic'|'legendary'|'boots'|'consumable',
  desc, icon: { glyph, bg: [c1, c2], fg } /*或 draw*/,
  unique /*同组唯一，如 'boots'*/, maxStack /*消耗品叠加*/, purchasable = true,
  passive?: { name, desc, init(champ, itemState) → cleanupFn },
  active?: { name, desc, cooldown, targeting, range, cast(champ, itemState, ctx) → bool },
  consumable?: { charges, use(champ, itemState) → bool },
};
export const BUILDS = { [championId]: { start: [ids], core: [ids], boots: id, situational: [ids] } };
export function recomputeItemStats(champ);   // 汇总 champ.items 的 stats → champ.itemStats
// js/items/shop.js
export function effectiveCost(champ, id) → number;   // 扣除已拥有合成材料
export function canBuy(champ, id) → { ok, reason };  // reason: 不在泉水/金币不足/栏位已满/唯一限制
export function buy(champ, id) → { ok, reason };     // 消耗合成材料、扣钱、放入栏位、初始化被动、emit itemBought
export function sell(champ, slot) → { ok, refund };  // 70% 返还
export function undo(champ) → bool;                 // 撤销最近一次购买（仍在泉水、未离开）
```
至少 45 件：起始（多兰之刃/戒/盾、猎人的砍刀、世界地图集）、消耗品（生命药水、可充值药水、控制守卫）、基础件（长剑、增幅典籍、红水晶、蓝水晶、布甲、抗魔斗篷、短剑、敏捷斗篷、爆裂魔杖、暴风之剑、无用大棒、鞋子…）、进阶件（十字镐、燃烧宝石、巨人腰带、锁子甲、负极斗篷、狂热、恶魔法典、耀光、吸血鬼节杖…）、二级鞋（狂战士胫甲、法师之靴、铁板靴、水银之靴、明朗之靴）、传说装备（无尽之刃、灭世者的死亡之帽、三相之力、破败王者之刃、日炎圣盾、荆棘之甲、守护天使、中娅沙漏、饮血剑、幽梦之灵、黑色切割者、斯特拉克的挑战护手、虚空之杖、巫妖之祸、卢登的回声、兰顿之兆、振奋盔甲、钢铁烈阳之匣、疾射火炮、飓风、救赎…）。

## 7. 地图、导航、视野（map）

### 7.1 `js/world/mapdata.js`
```js
export const MAP = { size: 15000 };
export const FOUNTAINS = [{ team: 0, x, y, radius, spawns: [{ x, y } ×5] }, { team: 1, ... }];
export const STRUCTURES = [
  { id: 'b_top_outer', team: 0, kind: 'turret', lane: 'top', tier: 'outer', x, y },   // tier: outer|inner|inhib|nexus
  { id: 'b_top_inhib', team: 0, kind: 'inhibitor', lane: 'top', x, y },
  { id: 'b_nexus', team: 0, kind: 'nexus', x, y },
  { id: 'b_fountain', team: 0, kind: 'fountainTurret', x, y }, ...
];
export const LANES = { top: [[x, y], ...], mid: [...], bot: [...] };   // 小兵路径点，蓝方枢纽 → 红方枢纽顺序
export const CAMPS = [
  { id: 'b_blue', kind: 'blue', side: 0, x, y, monsters: [{ kind: 'blue_sentinel', x, y }], firstSpawn: 90, respawn: 300, leash: 900 }, ...
];  // kind: blue, red, gromp, wolves, raptors, krugs, scuttle_top, scuttle_bot, dragon, baron, herald
export const BRUSHES = [{ id, poly: [[x, y], ...] }];           // 草丛多边形
export const RIVER = { path: [[x, y], ...], width };               // 河道中心线与半宽（渲染用）
export const PITS = { dragon: { x, y, r }, baron: { x, y, r } };
export const WALK = { corridors: [{ pts: [[x, y], ...], w }], clearings: [{ x, y, r }], blockers: [{ poly }] };  // 可行走区域「雕刻」原语
export const DECOR = { ... };   // 可选：给地形代理的装饰提示（基地广场、雕像、桥等）
export function laneOf(x, y) → 'top'|'mid'|'bot'|null;
export function isInBase(team, x, y) → bool;
```

**参考坐标（来自 LoL 数据，布局必须贴近）**
- 蓝方防御塔：上路 外(981,10441) 内(1512,6699) 高地(1169,4287)；中路 外(5846,6396) 内(5048,4812) 高地(3651,3696)；下路 外(10504,1029) 内(6919,1483) 高地(4281,1253)；枢纽塔 (1748,2270) (2177,1807)。
- 红方防御塔：上路 外(4318,13875) 内(7943,13411) 高地(10481,13650)；中路 外(8955,8510) 内(9767,10113) 高地(11134,11207)；下路 外(13866,4505) 内(13327,8226) 高地(13624,10572)；枢纽塔 (12611,13084) (13052,12612)。
- 召唤水晶（兵营）：蓝 上(1171,3571) 中(3203,3208) 下(3452,1236)；红 上(11261,13676) 中(11598,11667) 下(13604,11316)。
- 水晶枢纽：蓝 ≈(1550,1600)，红 ≈(13250,13280)。泉水：蓝 ≈(420,420)，红 ≈(14380,14420)。
- 野区（蓝方半场）：蓝 BUFF(3821,8101) 魔沼蛙(2090,8428) 暗影狼(3780,6440) 锋喙鸟(6943,5422) 红 BUFF(7765,4020) 石甲虫(8400,2700)；（红方半场）蓝 BUFF(10984,6960) 魔沼蛙(12703,6444) 暗影狼(11008,8387) 锋喙鸟(7852,9471) 红 BUFF(7101,10900) 石甲虫(6317,12146)。
- 小龙坑(9866,4414)，大龙坑(5007,10471)，河道迅捷蟹：上(4400,9600) 下(10500,5170)。
- 地图关于中心点 ≈(7420,7430) 中心对称。

### 7.2 `js/world/navgrid.js`
```js
export class NavGrid {
  constructor(mapdata)             // 由 WALK 雕刻：默认全是墙，走廊/空地/基地/河道/坑 = 可走；blockers 回填为墙
  cellSize = 50; cols = 300; rows = 300;
  walk;    // Uint8Array(cols*rows)，1 = 可走
  brush;   // Int16Array，-1 或草丛 id
  sdf;     // Float32Array，到可走边界的有符号距离（世界单位；墙内为正，可走区为负），地形渲染用
  isWalkable(x, y); cellIndex(x, y); cellCenter(i) → { x, y };
  findPath(sx, sy, tx, ty, { maxIter = 40000 } = {}) → [{ x, y }, ...] | null;   // 8 邻接 A* + 视线平滑；不含起点；终点不可走时走到最近可走点
  hasLineOfWalk(x0, y0, x1, y1) → bool;
  raycastWalk(x0, y0, x1, y1) → { x, y };        // 沿线段最后一个可走点
  nearestWalkable(x, y, maxRadius = 1500) → { x, y };
  brushAt(x, y) → -1 | id;
  blocksSight(x, y) → bool;                        // 墙体阻挡视线
}
```

### 7.3 `js/world/vision.js`
```js
export class Vision {
  constructor(game)
  cellSize = 100; cols = 150; rows = 150;
  grids = [Uint8Array, Uint8Array];     // 1 = 该队可见
  update(dt);                           // 内部节流（约每 0.12s 游戏时间）
  isVisible(team, x, y) → bool;
  canSee(team, entity) → bool;
}
```
视野源：各队存活单位与守卫的 `sightRange`（英雄 1350、小兵 1100、防御塔 1350、水晶/枢纽 1200、守卫 900、宠物 800；nearsight 降为 500）。墙体阻挡视线；**草丛规则**：视野源不在某草丛内时，看不到该草丛内部的格子（同一草丛内可以互看）。`revealedUntil > time` 的单位只要在敌方任一视野源半径内即可见。隐形守卫只对拥有 900 内控制守卫的敌方可见。建筑对双方恒可见。每次更新后写入所有单位/守卫的 `entity.visible[0/1]`。

## 8. 实体（entities）

- `js/entities/minion.js`：`export class Minion extends Unit`（type `minion`，`kind`: melee|caster|siege|super，`lane`，`waypoints`，`goldValue`，`xpValue`）。沿路径点前进，LoL 目标优先级（呼叫支援：敌方英雄攻击我方英雄 → 附近小兵转火攻击者），脱离后回到兵线。随时间成长（每 90s）。
- `js/entities/structures.js`：`Turret`（type `turret`，`tier`，`lane`；射程 750；锁定目标直到死亡/离开射程，除非敌方英雄在塔下攻击我方英雄；对英雄伤害每次连续命中 +40%（上限 +120%）；对小兵按最大生命百分比；外塔 14 分钟前有 5 层镀层，每层 160 金给附近英雄；无敌方小兵时承受伤害降低 66%（后门保护））、`Inhibitor`（type `inhibitor`，4000 生命，被摧毁 300s 后重生，期间该路敌方出超级兵）、`Nexus`（type `nexus`，5500 生命，被摧毁 → `game.end(对方)`）、`FountainTurret`（泉水激光：对泉水内敌人极高真实伤害，无敌）。
  依次解锁：外塔 → 内塔 → 高地塔 → 召唤水晶 → 任一水晶被破后两座枢纽塔可被攻击 → 两座枢纽塔都被破后枢纽可被攻击。未解锁时 `invulnerable = true`。
  建筑**不从 game 中移除**：被摧毁时 `alive = false`（水晶重生时恢复 `alive = true`）。
  建筑奖励：外塔 250（附近英雄平分）+ 全队每人 50；内塔 225；高地塔 225；水晶 50 全队；首塔额外 +300。
- `js/entities/monsters.js`：`Monster extends Unit`（type `monster`，`kind`，`camp`；被攻击后仇恨攻击者，离开营地 `leash` 距离后脱战回家并回满血）。击杀奖励与 BUFF：蓝 BUFF（洞悉烙印 120s：+10 技能急速、每秒回复 1% 最大法力/能量）、红 BUFF（余烬烙印 120s：普攻灼烧 + 减速、脱战回血）、元素亚龙（炼狱 +8% 攻击/法强；山脉 +8% 护甲/魔抗；海洋 每 5 秒回复 2.5% 已损失生命；云端 +7% 移速，全队永久叠加）、纳什男爵（纳什男爵之手 180s：攻击力/法强加成、回城 4s、附近小兵强化）、峡谷先锋（击杀后为击杀方在坑内召唤一只友方峡谷先锋，沿最近的兵线冲撞敌方防御塔）、迅捷蟹（击杀方在其位置获得 90s 视野）。
- `js/entities/spawner.js`：`export class Spawner { constructor(game); init(); update(dt); }` —— `init()` 按 `STRUCTURES` 创建建筑；`update()` 负责：播报（welcome/minions30/minionsSpawned）、1:05 起每 30s 出兵（近战 3 + 炮车（每 3 波，15 分钟后每 2 波，25 分钟后每波）+ 远程 3；对方水晶被破的路出超级兵）、野怪首次刷新与重生、小龙类型轮换、峡谷先锋/男爵时间、水晶重生。

## 9. AI（ai）

```js
// js/ai/championAI.js
export function createAI(champ, game, { role, difficulty }) → controller   // controller.update(dt)
```
- 只能使用玩家同等的命令接口，**不作弊**：敌方单位只在 `unit.visible[myTeam]` 为 true 时可感知（建筑、营地位置、计时可已知）。
- 行为：开局买出门装 → 按分路（top/jungle/mid/adc/support）就位 → 对线（补刀按 `lastHit` 能力、消耗、躲技能按 `dodge` 概率、塔下规则）→ 残血撤退/回城（B）→ 回泉水买装备（`BUILDS`）→ 打野（清野路线 + 惩戒 + 抓人）→ 中期抱团/控龙/推塔 → 后期逼团、推高地。
- 技能使用：通用逻辑读取每个技能的 `ai` 提示；英雄定义可给 `ai.custom` 完全接管。技能加点按 `def.ai.skillOrder`（R 能点就点）。
- 难度参数来自 `DIFFICULTY[difficulty]`。

## 10. 渲染层

### 10.1 `Renderer`（`js/render/renderer.js`，core）
```js
export class Renderer {
  constructor(game, container /*#game-root*/, { quality = 'high' } = {})
  THREE; scene; camera; webgl; sun /*DirectionalLight*/; hemi /*HemisphereLight*/;
  terrain = null; fx = null; cameraCtl; views /*Map<entityId, View>*/; systems = []; playerTeam; quality;
  toScene(x, y, h = 0) → THREE.Vector3;       // (x, h, -y)
  heightAt(x, y) → number;                     // terrain?.heightAt ?? 0
  screenToGround(clientX, clientY) → { x, y } | null;
  worldToScreen(x, y, h = 0) → { x, y, onScreen };   // 相对 container 的 CSS 像素
  pickUnit(clientX, clientY, { filter } = {}) → Unit | null;
  setTerrain(terrain); setViewFactory(fn); addSystem(sys); removeSystem(sys); getView(entity);
  resize(); render(realDt); dispose();
}
```
- 太阳光阴影相机跟随镜头目标（覆盖约 4000 单位范围），`quality` 决定阴影与像素比。
- 每帧：`cameraCtl.update` → 同步视图 → `systems[i].update(dt, renderer)` → 渲染。
- **视图同步**：为 `champions/minions/structures/monsters/pets/wards` 中每个实体创建视图（工厂）；位置 `toScene(e.x, e.y, heightAt(e.x,e.y) + e.z)`；`rotation.y` 平滑趋近 `e.facing`；调用 `view.update(dt, e, renderer)`；可见性：己方或 `e.visible[playerTeam]` 或建筑；`alive` 变 false 时调用 `view.onDeath?.(e)`；英雄阵亡 3 秒后隐藏、复活时 `view.onRespawn?.(e)`；小兵/野怪 `removed` 后保留 1.5s 播放死亡动画再 `dispose`；建筑被毁后保留（残骸）。

`CameraController`（`js/render/camera.js`，core）：`target {x,y}`、`locked`（默认 true，Y 切换）、`follow(unit)`、空格按住居中、屏幕边缘平移（未锁定时）、滚轮缩放（距离 1500~2700，默认 2250）、俯仰角 56°、FOV 38°、`setTarget(x, y)`、`panBy(dx, dy)`、`shake(intensity, duration)`、`getViewPolygon()`（屏幕四角投射到地面的 4 点，小地图用）。

### 10.2 模型与视图（models-*）
```js
// js/render/models/index.js（core）
export function createView(entity, renderer) → View;   // champion/pet → createChampionView；其余 → createUnitView
// js/render/models/champions.js
export function createChampionView(entity, renderer) → View;
export async function renderChampionPortrait(championId, size = 256) → string /*dataURL，缓存*/;
// js/render/models/units.js
export function createUnitView(entity, renderer) → View;
View = {
  object3d,            // 原点在脚底中心，正前方 +X
  height,              // 模型顶部高度（血条位置）
  update(dt, entity, renderer),
  onDeath?(entity), onRespawn?(entity), setHighlight?(colorOrNull), setOpacity?(a), dispose(),
}
```
- 体型参考：英雄 180~260 高；近战兵 ~110；炮车 ~150；超级兵 ~170；防御塔 ~520；召唤水晶 ~260；枢纽 ~480；男爵 ~450 长；小龙 ~320。
- 队伍配色：蓝方小兵/建筑 = 蓝白金，红方 = 紫红黑。英雄模型两队相同。
- 程序化动画依据 `entity.anim`（§4.3）：attack 在 `anim.windup` 秒时达到挥击/射击峰值；cast 用 `anim.slot` 区分动作。
- **`entity.modelState` 约定**（英雄代码写，模型读）：`garen.spinning`、`garen.swordGlow`；`darius.axeSpin`；`jinx.weapon: 'minigun'|'rocket'`；`annie.tibbersOut`；`thresh.lanternOut`；`masteryi.highlander`、`masteryi.meditating`、`masteryi.hidden`（Q 期间隐藏模型）；其他英雄可自行增加键并在 INTEGRATION NOTES 说明。
- 性能：共享材质与几何体；每个小兵 ≤ 3 个 draw call（合并几何体 + 顶点色）；大量重复物体用 InstancedMesh。

### 10.3 FX（fx；core 提供 NullFX 与初版桩）
```js
// js/render/fx.js
export class FX {
  constructor(renderer, game);
  update(dt);                           // main 会把 fx 加入 renderer.systems
  projectile(proj); zone(zone);         // core 自动调用
  ring({ x, y, radius, color, duration = 0.5, width = 14, expand = false, follow });
  disc({ x, y, radius, color, duration = 0.5, opacity = 0.35, follow, pulse = false });
  telegraph({ x, y, radius, x2, y2, width, color, duration });   // 预警区域（圆或矩形）
  line({ x1, y1, x2, y2, width, color, duration = 0.4 });        // 地面矩形
  cone({ x, y, dirX, dirY, angle, range, color, duration = 0.4 });
  burst({ x, y, h = 80, color, count = 20, size = 20, speed = 300, duration = 0.6, gravity = 0 });
  impact({ x, y, h = 80, color, size = 1 });
  beam({ x1, y1, x2, y2, h = 80, width = 40, color, duration = 0.3, from, to });   // from/to 可为单位（跟随）
  slash({ unit, angle, arc = 120, radius = 200, color, duration = 0.25 });
  spin({ unit, radius, color, duration });
  shield({ unit, color, duration, radius });
  aura({ unit, color, radius, duration });
  attach({ unit, kind /*weaponGlow|flames|sparkles|electric|frost|haste|heal|silence|stun*/, color, duration });
  text({ x, y, h = 150, text, color, size = 18, duration = 1 });
  flash({ x, y, color });  recall({ unit, duration });  levelUp({ unit });
  custom(name, params);
  registerCustom(name, fn /*(ctx, params) → Handle*/);
  registerProjectile(kind, fn /*(ctx, proj) → { object3d, update(dt, proj), dispose? }*/);
  ctx;   // FXContext
}
// 所有方法返回 Handle { remove(), alive, object3d? }；duration 到期自动移除。
```
内置投射物 `kind`：`orb, arrow, bolt, bullet, rocket, fireball, spear, hook, turretShot, casterMinion, siegeBall, basic, ice, light, chain`。

**FXContext**（英雄专属特效 `js/render/champfx/<id>.js` 使用）：
```js
ctx.THREE; ctx.scene; ctx.renderer; ctx.game;
ctx.toScene(x, y, h); ctx.heightAt(x, y);
ctx.add(object3d, { duration, update /*(t 0..1, dt, age) → false 提前结束*/, follow /*实体*/, followHeight, fadeOut, onEnd }) → Handle;
ctx.particles({ x, y, h, count, color, size, speed, spread, life, gravity, drag, additive = true, shape /*spark|smoke|soft*/ }) → Handle;
ctx.mat(color, { additive, opacity, emissive, doubleSide, depthWrite }) → Material;   // 缓存
ctx.textures;   // { glow, ring, spark, smoke, noise }
ctx.sprite(color, size, { additive, texture }) → THREE.Sprite;
ctx.unitHeight(entity); ctx.getView(entity);
```
`js/render/champfx/<id>.js`：`export default function register(fx) { fx.registerCustom('garen_r_sword', (ctx, p) => {...}); fx.registerProjectile('ashe_r_arrow', (ctx, proj) => {...}); }`。命名一律以英雄 id 为前缀。模拟代码：`game.fx.custom('garen_r_sword', { x, y, target })`。

### 10.4 覆盖层与指示器（fx）
- `js/render/overlay.js`：`export class Overlay { constructor(renderer, game, container); update(dt); }` —— 2D canvas（`#overlay-canvas`，覆盖在 WebGL 之上）绘制：LoL 风格血条（英雄：等级框、每 100 血刻度、护盾白条、资源条、名字；小兵/野怪/建筑小血条），浮动战斗文字（物理橙、魔法蓝紫、真实白、暴击放大、治疗绿、金币 `+21` 金色；只显示与玩家相关的），CC 状态文字（眩晕/沉默…），回城进度条。
- `js/render/indicators.js`：`export class Indicators { constructor(renderer, game, input); update(dt); }` —— 技能射程圈 + 形状（line/circle/cone）跟随鼠标（读 `input.pendingCast`），A 键普攻射程圈，移动/攻击点击标记（订阅 `input.on('command')`），悬停单位高亮（`view.setHighlight`），玩家脚下选择圈。

### 10.5 地形（terrain）
```js
// js/render/terrain.js
export class Terrain {
  constructor(renderer, game);
  async build(onProgress /*(p 0..1, label)*/);   // 生成地面/墙体/河流/树木/草丛/基地装饰/光照氛围
  heightAt(x, y) → number;                       // 可走区≈0（轻微起伏），墙体隆起
  update(dt, renderer);                          // 水面动画、草丛半透明（玩家在草里）等
}
// js/render/fogrender.js
export class FogRenderer { constructor(renderer, game, terrain); update(dt); }   // 把 vision.grids[playerTeam] 平滑成纹理并压暗地形与环境
```

## 11. 输入（`js/input/input.js`，core）
```js
export class Input {
  constructor(game, renderer, { root /*#game-root*/ })
  enabled = true;                  // 商店/菜单打开时 UI 可设 false（仍响应 P/Esc/Tab）
  mouse = { x, y, gx, gy, overUI };
  hoverUnit = null;
  pendingCast = null;              // { kind: 'ability'|'summoner'|'item'|'trinket', slot, def, key }
  attackMoveArmed = false;
  settings = { castMode: 'quickIndicator' /*|'quick'|'normal'*/, edgePan: true };
  on(event, fn) → unsubscribe;     // 'command' {type, x, y, target}、'toggleShop'、'scoreboard' {down}、'escape'、'ping' {x,y}
  update(dt);
}
```
键位（LoL 默认）：右键移动/攻击；A + 左键 攻击移动；S 停止；Q/W/E/R 技能；Ctrl+Q/W/E/R 升级技能；D/F 召唤师技能；1/2/3/5/6/7 装备；4 饰品守卫；B 回城；P 商店；Tab 记分板；空格 居中镜头；Y 锁定/解锁镜头；滚轮缩放；Esc 取消/菜单；Alt+左键 信号。施法模式默认「带指示器的快捷施法」：按下显示指示器，松开施放；自身技能按下即施放；指向技能松开时取悬停目标或鼠标 250 内最近的合法目标。

## 12. UI（ui）

DOM 结构（index.html）：
```html
<div id="app">
  <div id="game-root"></div>     <!-- WebGL canvas + #overlay-canvas -->
  <div id="ui-root"></div>       <!-- HUD（pointer-events: none，交互元素单独 auto） -->
  <div id="screen-root"></div>   <!-- 选人/加载/结算等全屏界面 -->
</div>
```
```js
// js/ui/champselect.js
export async function showChampSelect(root, { champions, summoners, renderPortrait }) → Config;
// Config = { championId, summoners, team, difficulty, speed, spectate, blue: [...5], red: [...5] }（AI 英雄按分路随机分配，10 人不重复）
export function showLoadingScreen(root, config, champions, renderPortrait) → { setProgress(p, label), close() };
// js/ui/ui.js
export class UI { constructor(game, renderer, input, { root, audio, champions, summoners, items, shop, renderPortrait }); update(dt); dispose(); }
```
HUD：底部主面板（头像/等级/经验、被动+QWER（冷却转圈与秒数、蓝不够变暗、升级按钮、等级点）、D/F、生命/资源条、属性面板、6 装备 + 饰品、金币/商店按钮、回城）、Buff 栏、右上比分/KDA/补刀/时间/FPS、左侧队友头像（等级/血量/大招/复活倒计时）、右下小地图、右侧击杀信息、屏幕中上公告、左上选中目标信息、Tab 记分板、P 商店（分类/推荐/合成树/购买/出售/撤销）、死亡灰屏 + 复活倒计时、胜利/失败结算、Esc 菜单（继续/设置/操作说明/投降）、技能与装备悬停提示、首次进入的按键提示。
小地图：静态底图（由 `nav.walk` + 河道 + 兵线 + 基地绘制）+ 迷雾 + 建筑/小兵/野怪/英雄图标 + 镜头视野框 + 信号；左键拖动移动镜头，右键移动英雄。

## 13. 音频（audio）
```js
// js/audio/audio.js
export class AudioSystem { constructor(game, renderer, { muted = false } = {}); unlock() /*用户手势中调用*/; update(dt); setVolume({ master, sfx, voice, ambient }); setMuted(bool); }
```
WebAudio 程序化合成：普攻（剑砍/箭矢/子弹/魔法）、技能（按 `def.sfx`）、命中、防御塔射击、小兵死亡、**补刀金币音**、升级、回城、购买、阵亡、建筑爆炸、UI 点击；环境音（风声/林间/河流）；距离衰减（相对镜头中心，>2500 静音）。中文语音播报用 `speechSynthesis`（zh-CN），按优先级排队：欢迎来到召唤师峡谷、敌军还有三十秒到达战场、全军出击、第一滴血、双杀/三杀/四杀/五杀、大杀特杀/主宰比赛/无人能挡/变态杀戮/超神、终结、团灭、我方/敌方防御塔已被摧毁、召唤水晶…、胜利/失败。

## 14. 启动流程与 URL 参数（`js/main.js`，core）

1. `showChampSelect` → Config（`autostart=1` 时跳过，用 URL 参数/默认配置）。
2. `showLoadingScreen`；创建 `Game`、`Renderer`、`FX`（`game.fx = fx`，`registerChampionFX(fx)`）、`Terrain`（`await build`）、`FogRenderer`、`Overlay`、`Indicators`、`Input`、`AudioSystem`、`UI`；`renderer.setViewFactory(createView)`。
3. 主循环 `requestAnimationFrame`：`dt = min(0.1, 真实间隔)` → `game.update(dt)` → `renderer.render(dt)` → `ui.update(dt)` → `audio.update(dt)`。

URL 参数：`autostart=1`、`champ=<id>`、`team=0|1`、`speed=<n>`、`difficulty=easy|normal|hard`、`autopilot=1`（玩家英雄由 AI 控制）、`spectate=1`（autopilot + 自由镜头）、`seed=<n>`、`quality=low|medium|high`、`time=<秒>`（开局无渲染快进到该时间，用于测试中后期）、`debug=1`、`mute=1`。
调试句柄：`window.__game`、`window.__renderer`、`window.__ui`、`window.__input`、`window.__fx`。

## 15. 测试与自检

- `node tests/sim.mjs --minutes 25 --seed 1 [--blue garen,leesin,ahri,jinx,thresh --red darius,masteryi,lux,ashe,annie] [--quiet]`：10 个 AI 无头整局；每分钟打印摘要（击杀、推塔、等级、金币、补刀）；异常或不变量违规（NaN 坐标、hp 越界、单位长期处于不可走格）→ 退出码 1。
- `tests/helpers.mjs`：`makeGame(opts)`、`spawnDummy(game, { team, x, y, hp, armor, mr })`、`run(game, seconds)`、`assert(cond, msg)`。
- 各模块自己的测试：`node tests/<area>_*.mjs`。
- 浏览器自检：`node tools/browsercheck.mjs --path "/index.html?autostart=1&autopilot=1&speed=3" --seconds 25 --screenshot shots/<name>.png --eval "<js 表达式>"`（自带静态服务器与独立 Chrome，可并发；支持 `--steps` 注入键鼠操作，详见文件头注释）。截图可用 Read 工具查看。**截图放在 `shots/` 目录。**

## 16. 视觉风格

- 场景：LoL 召唤师峡谷——明亮、饱和、手绘质感的低多边形。草地青绿（#4f7d3a ~ #6f9e4a），兵线土黄石板（#a58b5c / #8c7b5e），河道浅青绿半透明水面（#3aa6a0，岸边泡沫），丛林墙体为灰褐岩壁 + 茂密深绿树冠；蓝方基地白石 + 蓝色水晶 + 金饰（#3aa0ff / #d8c28a），红方基地暗石 + 紫红水晶（#c0304a / #7a2a8a）。暖色太阳从西南上方照向东北，柔和阴影；天空半球光淡蓝，地面反光暗绿。
- UI：海克斯科技风——底色 #010a13 / #0a1428，金色描边 #c8aa6e / #785a28，青色高亮 #0ac8b9，正文 #f0e6d2，次要 #a09b8c。字体：标题 `Noto Serif SC`（600/900）+ `Marcellus SC`（拉丁/数字标题）；正文 `Noto Sans SC`；数字 `Barlow Semi Condensed`（`font-variant-numeric: tabular-nums`）。均有系统后备字体。
- 血条：玩家自己绿色、队友蓝色、敌人红色、中立黄色。
- 页面：单一深色设计（游戏界面），`body` 明确背景色；桌面优先，窄屏（<900px）在选人界面提示「建议使用桌面端键鼠游玩」但仍可观战模式运行。
- 不使用任何 Riot 官方 Logo/美术素材；页面标注「非官方同人作品」。
