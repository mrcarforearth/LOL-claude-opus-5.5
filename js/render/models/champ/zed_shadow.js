// 劫的影分身（modelId 'zed_shadow'）：与劫同形（共用 buildZed），黑紫配色、半透明（meta.opacity）、紫黑色边缘光 + 身周暗紫光晕。
// 使用方式（特效/实体代码）：createChampionView({ type: 'pet', modelId: 'zed_shadow', anim, modelState, alive: true }, renderer)
//   或 createModelVariantView('zed_shadow', entityLike, renderer)；entityLike.anim 可直接引用劫本体的 anim 以同步动作。
// 接口：build(bp, def) 往蓝图 bp 上添加骨骼/部件并设置 bp.meta（见 js/render/models/champions.js 顶部框架说明）
import { buildZed } from './zed.js';
import { glowSprite } from './materials.js';

export function build(bp, def) {
  const { U, M } = buildZed(bp, def, true);
  bp.meta.opacity = 0.62;
  bp.meta.baseRim = 0x9a4aff;
  bp.meta.baseRimI = 0.75;
  bp.meta.rim = () => ({ rim: 0x9a4aff, rimI: 0.75, glowK: 1.4 });
  bp.overlays.push((v) => {
    v.mesh.castShadow = false;
    const a = glowSprite(0x5a1aa8, 150 * U, 0.35), b = glowSprite(0x2a0a4a, 110 * U, 0.5);
    a.position.set(0, M.chestY - M.hipY, 0);
    b.position.set(0, 0, 0);
    v.bones.spine.add(a);
    v.bones.hips.add(b);
    return {
      update(v2) {
        const on = v2.opacity > 0.3;
        a.visible = b.visible = on;
        if (on) a.scale.setScalar(150 * U * (1 + 0.08 * Math.sin(v2.time * 4)));
      },
    };
  });
}
