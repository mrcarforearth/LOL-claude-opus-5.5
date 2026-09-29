// 英雄与宠物（提伯斯）的程序化 3D 模型：按 championId / modelId 分发到 js/render/models/champ/<id>.js，未制作的英雄用通用人形后备。
//
// ════════════════════════════════ 英雄模型框架说明（新增英雄前必读） ════════════════════════════════
//
// 【整体结构】每个模型 = 一份「蓝图」Blueprint（骨骼 + 部件列表）。蓝图只构建一次，所有部件按顶点色 + 顶点特效属性
//   合并进一个蒙皮几何体（一个 SkinnedMesh = 1 次 draw call，阴影再 +1），所有英雄共用一个卡通着色器程序。
//   每个实体实例 = 共享几何体 + 独立骨架（Skeleton）+ Animator（程序化动画）+ 若干叠加物（overlays：发光精灵、弓弦等）。
//
// 【文件】js/render/models/champ/
//   kit.js        数学（PI TAU clamp clamp01 smooth mix）、几何 geo.*、Blueprint、instantiate
//   materials.js  champMat（共享卡通材质变体）、addMat（加色发光）、glowSprite/spriteMat（径向发光精灵）、outlineMat（描边）、cachedGeo
//   rig.js        humanoid（标准人形骨架 + 身体）、face、hairCap、hairSheet、cape、tail、linePts、cylX/cylZ/ringY
//   anim.js       Animator（状态机 + 平滑混合 + 次级摆动）、STYLES（武器风格）、registerStyle、EX（整体位移通道）
//   view.js       getModel（蓝图缓存）、createModelView（View 契约实现：高亮描边/透明度/死亡/复活/隐藏骨骼）
//   portrait.js   renderPortrait（共享离屏渲染器的半身像）
//   generic.js    通用人形后备（按 def.model 配色，近战长剑 / 远程法杖）
//   <id>.js       各英雄：garen darius leesin masteryi ahri lux annie tibbers；ashe jinx thresh（已精修）；
//                 yasuo ezreal malphite zed morgana xinzhao（第二批）；zed_shadow（劫的影分身变体模型，共用 zed.js 的 buildZed）
//
// 【新增一个英雄】（以 yasuo 为例）
//   1. 新建 champ/yasuo.js：`export function build(bp, def) { ... }`（def = js/champions/yasuo.js 的定义，可能为 null）
//   2. 在下方 MODELS 中 import 并登记：`import * as yasuo from './champ/yasuo.js';` → `const MODELS = { ..., yasuo }`
//   3. 在 tools/model_gallery.html 的 IDS 中加上 id 自检。
//   build 内典型写法（坐标：原点脚底中心，+X 正前方，+Y 上，+Z 右侧；单位 = 游戏单位，英雄高 180~260）：
//     const H = 220, U = H / 220;                                  // U = 比例单位，按 220 高设计的尺寸乘 U
//     const M = humanoid(bp, { H, bulk: 1.1, skin: 0xe0b090, c: { chest: 蓝, ua: 钢, ... } }); // 建骨架 + 基础身体，返回尺寸 M
//     bp.add('chest', geo.box(w, h, d), 0xRRGGBB, { p: [x, y, z], r: [rx, ry, rz], s: 缩放, glow: 自发光, shine: 金属高光, c2: 竖向渐变色 });
//     bp.pair('ua', geo.sphPart(...), 色, { p: [...] });           // 左右对称（以右侧 +Z 为准，自动镜像到 L）
//     hairCap(bp, M, 发色, { vol, back, fringe });                 // 头发；M.headR 头半径，M.headC 头心（相对 head 骨）
//     const cp = cape(bp, 'chest', linePts(起点, 终点, 3), 外色, 内色, { wTop, wBot, len, bulge }); // 披风（链式骨骼）
//     const tl = tail(bp, 'tailA', 'hips', 曲线点[], (t) => 半径, 色, { n: 3 });          // 尾巴/发辫/飘带/锁链（管道 + 链骨）
//     bp.bone('gun', 'wpR', x, y, z);                              // 自定义骨骼（可单独旋转/隐藏）
//     bp.meta.style = 'katana';                                    // 动画风格：内置名或自定义对象（见 anim.js 顶部）
//     bp.meta.height = 230;                                        // view.height（血条高度，≈ 模型顶部）
//     bp.meta.chains = [{ names: cp, kind: 'cape' }, { names: tl, kind: 'tail', phase: 0.7, amp: 1 }];
//        kind ∈ cape | hair | braid | tail | ribbon | skirtF | skirtB | chain（次级摆动方式，随跑动/前倾/抬腿联动）
//     bp.meta.rim = (ms, e) => (ms.someBuff ? { rim: 0xffd060, rimI: 0.5, tint, tintK, glowK } : null); // 状态边缘光/染色
//     bp.meta.hideBones = { tibbersOut: 'bear', '!hasSword': ['sword'] };  // modelState 键为真时隐藏骨骼（'!' 取反）
//     bp.meta.hang = ['lantern'];                                  // 这些骨骼始终保持竖直下垂（灯笼、吊坠）
//     bp.overlays.push((v) => { const s = glowSprite(色, 尺寸); v.bones.wpR.add(s); return { update(v, e, dt) {...}, dispose() {} }; });
//        v = { root, mover, mesh, bones(按名), time, opacity, dead, deadT, drawString, highlight, boneWorldInMover(name, outVec3) }
//        叠加物材质请用 addMat / spriteMat / cachedGeo（共享缓存），v.opacity < 0.5 时自行隐藏。
//
// 【武器挂点】wpR / wpL 位于拳心；武器沿骨骼局部 +X 延伸（手臂自然下垂时指向正前方），刃宽沿 ±Y。
//   握柄 cylX(r, r, len) 以原点为握点；护手放 x≈+10U；刃从 x≈+12U 开始。左手武器（弓）挂 wpL。
//   内置风格对应武器：greatsword（双手巨剑，扛肩）、axe（长柄巨斧）、fists（拳脚）、katana（反握太刀）、orb（手上悬浮宝珠）、
//   wand（法杖/魔杖）、annie（左手抱物 + 右手施法）、bow（左手弓 + 拉弦，写 v.drawString）、gun（持枪/扛炮，ms.weapon==='rocket'）、
//   lantern（锤石：左手灯笼、右手镰刀）、brute（巨兽双爪）。自定义风格可用 A.arm(sd, 前摆, 外展, 扫动, 屈肘) / A.leg(sd, 前摆, 外展, 屈膝) /
//   A.R(骨骼, x, y, z) 写目标角，attack/cast 中用 A.phases(p) + A.armQ/A.RQ/A.q 做「静止→蓄力→峰值(p=1=anim.windup)→随势→恢复」关键帧。
//
// 【动画（依据 entity.anim）】idle 呼吸；run 步频随 anim.speed、手臂反向摆动、前倾；attack 在 anim.windup 秒达到峰值；
//   cast 按 anim.slot（Q/W/E/R）区分；channel/recall 单膝跪地（style.channel 可改为站立吟唱）；dash 前冲；
//   airborne 后仰翻滚；stunned 摇晃；death 倒地（onDeath 起计时，onRespawn 复位）。
// 【modelState（英雄模拟代码写、模型读）】每帧 e.modelState 直接读取：通用键 hidden（整体隐藏）；
//   其余键在英雄文件的 meta.rim / meta.hideBones / overlays / 风格函数里自行读取；Animator 内置 spinning（盖伦 E 旋转）、
//   axeSpin（德莱厄斯 Q 回旋）、meditating（易 W 盘坐）、finalSpark（拉克丝 R 姿势，需风格提供 spark）。
// 【变体模型】VARIANTS 中的 modelId（如 'zed_shadow'）无论实体类型都按 modelId 取模型；也可直接调用
//   createModelVariantView('zed_shadow', entityLike, renderer)（entityLike 至少含 anim / modelState / alive，可直接引用本体的 anim 同步动作）。
//   meta.opacity 为模型固有透明度（与 setOpacity 相乘），影分身用 0.62。
// 【性能】每英雄 ≈ 2 次 draw call（本体 + 阴影）+ 叠加物 0~6 个；材质/几何全部共享；悬停描边只在高亮时额外 +1。
//   部件尽量少用高分段（geo.sph 默认 14×10）；三角面预算每英雄 ≤ 1.5 万。
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
import { CHAMPIONS } from '../../champions/index.js';
import { getModel, createModelView, modelStats } from './champ/view.js';
import { renderPortrait } from './champ/portrait.js';
import * as generic from './champ/generic.js';
import * as garen from './champ/garen.js';
import * as darius from './champ/darius.js';
import * as leesin from './champ/leesin.js';
import * as masteryi from './champ/masteryi.js';
import * as ahri from './champ/ahri.js';
import * as lux from './champ/lux.js';
import * as annie from './champ/annie.js';
import * as tibbers from './champ/tibbers.js';
import * as ashe from './champ/ashe.js';
import * as jinx from './champ/jinx.js';
import * as thresh from './champ/thresh.js';
import * as yasuo from './champ/yasuo.js';
import * as ezreal from './champ/ezreal.js';
import * as malphite from './champ/malphite.js';
import * as zed from './champ/zed.js';
import * as zed_shadow from './champ/zed_shadow.js';
import * as morgana from './champ/morgana.js';
import * as xinzhao from './champ/xinzhao.js';

// 专属模型登记表：id → 模块（需导出 build(bp, def, ctx)）
export const MODELS = { garen, darius, leesin, masteryi, ahri, lux, annie, tibbers, ashe, jinx, thresh, yasuo, ezreal, malphite, zed, zed_shadow, morgana, xinzhao };
// 变体模型：实体带这些 modelId 时优先按 modelId 取模型（不看 championId）
const VARIANTS = new Set(['zed_shadow']);

const warned = new Set();

// 取模型（带缓存）；专属模型构建失败时回落到通用后备
export function getChampionModel(id, { pet = false } = {}) {
  const def = CHAMPIONS[id] || null;
  const mod = MODELS[id];
  if (mod && typeof mod.build === 'function') {
    try { return getModel(id, mod.build, def, { id, pet }); } catch (err) {
      if (!warned.has(id)) { warned.add(id); console.warn(`[英雄模型] ${id} 构建失败，使用通用模型：`, err); }
    }
  }
  const key = `generic:${pet ? 'pet:' : ''}${id}`;
  return getModel(key, generic.build, def, { id, pet });
}

function resolveId(entity) {
  if (entity.modelId && VARIANTS.has(entity.modelId)) return entity.modelId;
  if (entity.type === 'pet') return entity.modelId || 'pet';
  return entity.championId || entity.def?.id || entity.modelId || 'unknown';
}

export function createChampionView(entity, renderer) {
  const id = resolveId(entity);
  const model = getChampionModel(id, { pet: entity.type === 'pet' });
  return createModelView(model, entity, renderer);
}

// 变体模型视图（影分身等）：entity 为任意带 anim / modelState 的对象
export function createModelVariantView(modelId, entity, renderer, opts) {
  const model = getChampionModel(modelId, { pet: true });
  return createModelView(model, entity || {}, renderer, opts);
}

// 半身像头像（dataURL，缓存）；失败返回 null
export async function renderChampionPortrait(championId, size = 256) {
  try {
    return await renderPortrait(championId, CHAMPIONS[championId] || null, () => getChampionModel(championId), size);
  } catch (err) {
    console.warn('[头像] 渲染失败：', err);
    return null;
  }
}

export { modelStats };
