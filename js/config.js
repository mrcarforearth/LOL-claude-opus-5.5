// 全局常量（模拟层与表现层共享；与 ARCHITECTURE.md §3 一致，末尾为补充常量）
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

// —— 以下为补充常量 ——
// 小兵经验分享：n 名英雄在范围内时每人获得的比例
export const XP_SHARE_TABLE = [0, 1, 0.651, 0.434, 0.3255, 0.2604];
// 多杀判定窗口（秒）：普通 10 秒，四杀 → 五杀 30 秒
export const MULTIKILL_WINDOW = 10;
export const PENTAKILL_WINDOW = 30;
// 泉水回复：每秒回复最大生命/法力的比例（LoL：每 0.25 秒 2.1%）
export const FOUNTAIN_REGEN_PCT = 0.084;
// 硬控类型（会阻止行动）
export const HARD_CC = ['stun', 'airborne', 'charm', 'fear', 'taunt', 'suppress', 'sleep'];
// 韧性不生效的控制
export const NO_TENACITY_CC = ['airborne', 'suppress'];
// 净化无法移除的控制
export const UNCLEANSABLE_CC = ['airborne', 'suppress'];
// 默认技能施法前摇
export const DEFAULT_CAST_TIME = 0.25;
// 饰品守卫：放置距离与充能
export const TRINKET = { RANGE: 600, MAX_CHARGES: 2, RECHARGE_L1: 210, RECHARGE_L18: 120, DURATION_L1: 90, DURATION_L18: 120 };
// 守卫数量上限
export const WARD_LIMITS = { stealth: 3, control: 1 };
// 召唤师技能槽键
export const SUMMONER_KEYS = ['D', 'F'];
// 技能槽
export const ABILITY_SLOTS = ['Q', 'W', 'E', 'R'];
