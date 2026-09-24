// 非英雄单位视图工厂（契约 §10.2）：小兵、防御塔/泉水、召唤水晶、水晶枢纽、野怪/史诗怪、守卫
// 具体模型拆分在 ./unit/*.js；本文件只做分发与未知类型兜底
import { createMinionView } from './unit/minions.js';
import { createTurretView, createInhibitorView, createNexusView } from './unit/structures.js';
import { CAMP_SPECS, createCreatureView } from './unit/monsters.js';
import { createDragonView, createBaronView, createHeraldView } from './unit/epics.js';
import { createWardView } from './unit/wards.js';

function createMonsterView(e, renderer) {
  switch (e.kind) {
    case 'dragon': case 'elder_dragon': return createDragonView(e, renderer);
    case 'baron': return createBaronView(e, renderer);
    case 'herald': case 'herald_ally': return createHeraldView(e, renderer);
    default: {
      const spec = CAMP_SPECS[e.kind];
      if (spec) return createCreatureView(e, renderer, spec);
      return createGenericView(e, renderer);
    }
  }
}

// 未知种类：按碰撞半径缩放的岩石生物
function createGenericView(e, renderer) {
  const base = CAMP_SPECS.blob;
  const sc = Math.max(0.4, Math.min(1.6, (e.radius || 65) / 90));
  return createCreatureView(e, renderer, { ...base, scale: sc, h: Math.round(170 * sc) });
}

export function createUnitView(entity, renderer) {
  switch (entity.type) {
    case 'minion': return createMinionView(entity, renderer);
    case 'turret': return createTurretView(entity, renderer);
    case 'inhibitor': return createInhibitorView(entity, renderer);
    case 'nexus': return createNexusView(entity, renderer);
    case 'monster': return createMonsterView(entity, renderer);
    case 'ward': return createWardView(entity, renderer);
    default: return createGenericView(entity, renderer);
  }
}
