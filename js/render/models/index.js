// 视图工厂分发（core）：champion/pet → createChampionView；其余 → createUnitView；工厂抛错或返回无效时用占位模型兜底
import * as THREE from 'three';
import { createChampionView } from './champions.js';
import { createUnitView } from './units.js';

const warned = new Set();

export function createView(entity, renderer) {
  const isChamp = entity.type === 'champion' || entity.type === 'pet';
  const factory = isChamp ? createChampionView : createUnitView;
  try {
    const v = factory(entity, renderer);
    if (v && v.object3d) return v;
    throw new Error('视图工厂返回了无效视图（缺少 object3d）');
  } catch (err) {
    const key = `${entity.type}:${entity.modelId || ''}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[模型] 创建 ${key} 视图失败，使用占位模型：`, err);
    }
    return createPlaceholderView(entity, renderer);
  }
}

// 占位模型：队伍色圆柱 + 顶部小球（按类型给出合理高度）
export function createPlaceholderView(entity, renderer) {
  const playerTeam = renderer?.playerTeam ?? 0;
  const h = placeholderHeight(entity);
  const r = Math.max(20, Math.min(180, (entity.radius || 50) * 0.8));
  const color = entity.team === 2 ? 0xd9a441 : entity.team === playerTeam ? 0x3a8fe0 : 0xd84a4a;
  const group = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(r * 0.55, r * 0.75, h * 0.8, 12);
  bodyGeo.translate(0, h * 0.4, 0);
  const headGeo = new THREE.SphereGeometry(r * 0.45, 12, 8);
  headGeo.translate(0, h * 0.88, 0);
  const noseGeo = new THREE.ConeGeometry(r * 0.2, r * 0.6, 8);
  noseGeo.rotateZ(-Math.PI / 2);
  noseGeo.translate(r * 0.8, h * 0.6, 0);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  for (const g of [bodyGeo, headGeo, noseGeo]) {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    group.add(m);
  }
  let dead = false;
  let deadT = 0;
  return {
    object3d: group,
    height: h,
    update(dt, e) {
      if (dead) {
        deadT += dt;
        group.rotation.z = -Math.min(1, deadT * 3) * 1.3;
        group.position.y -= Math.min(1, deadT) * 20;
      } else {
        group.rotation.z = 0;
      }
      if (e.anim?.state === 'run') group.children[0].position.y = Math.abs(Math.sin((e.anim.t || 0) * 10)) * 6;
    },
    onDeath() { dead = true; deadT = 0; },
    onRespawn() { dead = false; group.rotation.z = 0; },
    setHighlight(c) { mat.emissive.setHex(c ?? 0x000000); mat.emissiveIntensity = c == null ? 0 : 0.35; },
    setOpacity(a) { mat.transparent = a < 1; mat.opacity = a; mat.depthWrite = a >= 1; },
    dispose() { bodyGeo.dispose(); headGeo.dispose(); noseGeo.dispose(); mat.dispose(); },
  };
}

function placeholderHeight(e) {
  switch (e.type) {
    case 'champion': return 220;
    case 'pet': return 260;
    case 'minion': return e.kind === 'siege' ? 150 : e.kind === 'super' ? 170 : 110;
    case 'turret': return e.tier === 'fountain' ? 300 : 520;
    case 'inhibitor': return 260;
    case 'nexus': return 480;
    case 'monster': return e.epic ? 360 : e.large ? 200 : 120;
    case 'ward': return 90;
    default: return 150;
  }
}
