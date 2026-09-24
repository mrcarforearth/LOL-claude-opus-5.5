// 队伍配色：秩序（蓝方）= 蓝白金，混沌（红方）= 紫红黑。按实际队伍着色（与玩家视角无关）
export const TEAM_PAL = [
  {
    // —— 小兵 ——
    a: 0x2f66c8, a2: 0x1c3b7c, p: 0xe6ebf2, m: 0xd8b25a, s: 0xb9c3cf, l: 0x5a4030, d: 0x1d2536,
    c: 0x2c5fb8, e: 0x8fe4ff, g: 0x6ad6ff, skin: 0xd9b596, wood: 0x6b4a2c,
    // —— 建筑 ——
    stone: 0xcfd4dc, stone2: 0x9aa3b0, stone3: 0x7a8392, trim: 0xd9b45e, accent: 0x3f8fe8,
    crystal: 0x4cc4ff, crystal2: 0x9fe6ff, dimCrystal: 0x24445e, aggro: 0xff2a2a,
  },
  {
    a: 0x9a2442, a2: 0x5a1834, p: 0x4e3a52, m: 0x9a5ac8, s: 0x5e5868, l: 0x2e1a1e, d: 0x120a12,
    c: 0x5a1f5e, e: 0xff5a7a, g: 0xff4a8a, skin: 0x8f6f8f, wood: 0x2e1e22,
    stone: 0x5b4c5c, stone2: 0x3a2e3c, stone3: 0x261d28, trim: 0x8e2c4c, accent: 0xd6285a,
    crystal: 0xff3a64, crystal2: 0xff9ab8, dimCrystal: 0x4a1424, aggro: 0xff2a2a,
  },
];
export const pal = (team) => TEAM_PAL[team === 1 ? 1 : 0];

// 元素亚龙配色（body 主体 / dark 暗部 / belly 腹部 / horn 角 / glow 发光 / wing 翼膜）
export const DRAGON_PAL = {
  infernal: { body: 0xb3301c, dark: 0x4a120a, belly: 0xf08a3a, horn: 0x2a1a14, glow: 0xffa030, wing: 0xd0502a, fx: 0xff7a2a },
  mountain: { body: 0x8a6c4a, dark: 0x4a3a2a, belly: 0xc8aa7a, horn: 0x3a3028, glow: 0xffc860, wing: 0x9a7a58, fx: 0xe0b070 },
  ocean: { body: 0x2a8aa4, dark: 0x14485c, belly: 0x9ae0d8, horn: 0xe0f0f0, glow: 0x60f0ff, wing: 0x3ab0c4, fx: 0x5ae0ff },
  cloud: { body: 0xc4d8ee, dark: 0x7896b8, belly: 0xffffff, horn: 0x5a7a9a, glow: 0xd8f4ff, wing: 0xe4f2ff, fx: 0xc8ecff },
  elder: { body: 0x3a3452, dark: 0x1a1628, belly: 0x6a5a8c, horn: 0xe4dcc4, glow: 0x9ad8ff, wing: 0x5a4a7c, fx: 0xa8e0ff },
  chemtech: { body: 0x4a6a3a, dark: 0x1e2a18, belly: 0x9ac85a, horn: 0x2a2a20, glow: 0xa8ff5a, wing: 0x6a8a4a, fx: 0x9aff5a },
  hextech: { body: 0x3a5a8a, dark: 0x1a2a44, belly: 0x8ac8e8, horn: 0xd8c890, glow: 0x7ae8ff, wing: 0x4a7ab0, fx: 0x7ae8ff },
};
