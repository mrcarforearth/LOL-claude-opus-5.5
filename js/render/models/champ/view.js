// 英雄视图装配：蓝图缓存（每个模型只构建一次，几何体在所有实例间共享）→ SkinnedMesh 实例 + Animator + 叠加物（overlays）
// View 契约见 ARCHITECTURE §10.2：object3d 原点在脚底中心、正前方 +X；渲染器每帧写 object3d 的位置与 rotation.y，
// 本视图只改内部的 mover（整体位移/旋转：死亡倒地、旋转斩、击飞翻滚）与骨骼。
import * as THREE from 'three';
import { Blueprint, instantiate } from './kit.js';
import { champMat, outlineMat, SHARED } from './materials.js';
import { Animator } from './anim.js';

const MODELS = new Map();   // key → { key, bp, geometry }
const EMPTY = Object.freeze({});
const DEFAULT_RIM = 0xa8c8ff, DEFAULT_RIM_I = 0.2;

// 取（或构建）模型：build(bp, def, ctx) 由英雄文件提供；同 key 只构建一次
export function getModel(key, build, def = null, ctx = {}) {
  let m = MODELS.get(key);
  if (m) return m;
  const bp = new Blueprint(key);
  build(bp, def, ctx);
  if (!bp.meta.height) bp.meta.height = bp.meta.M ? Math.round(bp.meta.M.H * 1.04) : 220;
  const geometry = bp.build();
  m = { key, bp, geometry, tris: geometry.index.count / 3 };
  MODELS.set(key, m);
  return m;
}
export function modelStats() {
  return [...MODELS.values()].map((m) => ({ key: m.key, tris: m.tris, bones: m.bp.bones.length, verts: m.geometry.attributes.position.count }));
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
let seedN = 0;

// 创建视图。opts: { seed, portrait }（portrait = 头像渲染用，关闭阴影等）
export function createModelView(model, entity, renderer, opts = {}) {
  const bp = model.bp;
  const meta = bp.meta;
  const root = new THREE.Group();
  root.name = `champ:${model.key}`;
  const mover = new THREE.Group();
  root.add(mover);
  const baseMat = champMat({});
  const inst = instantiate(bp, model.geometry, baseMat);
  const mesh = inst.mesh;
  mover.add(mesh);
  if (opts.portrait) mesh.castShadow = false;

  const v = {
    root, mover, mesh, bones: inst.byName, boneList: inst.bones, meta,
    time: 0, dead: !!(entity && entity.alive === false), deadT: 10, opacity: 1, drawString: 0, highlight: null,
    _mwStamp: -1,
    // 骨骼在 mover 局部坐标中的当前位置（叠加物跟随手部等用）
    boneWorldInMover(name, out) {
      const b = inst.byName[name];
      if (!b) return out.set(0, 0, 0);
      if (v._mwStamp !== v.time) { mover.updateMatrixWorld(true); v._mwStamp = v.time; }
      out.setFromMatrixPosition(b.matrixWorld);
      return mover.worldToLocal(out);
    },
  };
  const anim = new Animator(bp, inst, opts.seed ?? ((seedN++ * 0.618) % 1));
  const overlays = bp.overlays.map((fn) => fn(v)).filter(Boolean);

  // 隐藏骨骼（缩放为 0 使其蒙皮顶点塌缩）：meta.hideBones = { modelState 键: 骨骼名 | [骨骼名] }，键以 '!' 开头表示取反
  const hide = Object.entries(meta.hideBones || {}).map(([k, names]) => ({
    key: k.replace(/^!/, ''), neg: k.startsWith('!'), bones: [].concat(names).map((n) => inst.byName[n]).filter(Boolean), on: false,
  }));
  // 下垂骨骼（灯笼等）：世界朝向保持与 mover 一致
  const hang = (meta.hang || []).map((n) => inst.byName[n]).filter(Boolean);

  // 描边壳（悬停时显示）
  let outline = null;
  function ensureOutline(color) {
    if (!outline) {
      outline = new THREE.SkinnedMesh(model.geometry, outlineMat(color, meta.outline ?? Math.max(2.2, (meta.height || 220) * 0.014)));
      outline.bind(mesh.skeleton, mesh.bindMatrix);
      outline.boundingSphere = mesh.boundingSphere;
      outline.castShadow = false;
      outline.renderOrder = -1;
      mover.add(outline);
    } else outline.material = outlineMat(color, meta.outline ?? Math.max(2.2, (meta.height || 220) * 0.014));
  }

  let hidden = false;
  const view = {
    object3d: root,
    height: meta.height,
    championModel: model.key,
    update(dt, e) {
      dt = Math.min(0.1, Math.max(0, dt || 0));
      v.time += dt;
      if (v.dead) v.deadT += dt;
      SHARED.time.value = (performance.now() / 1000) % 3600;
      const ms = e.modelState || EMPTY;
      const hid = !!ms.hidden;
      if (hid !== hidden) { hidden = hid; mover.visible = !hid; }
      anim.update(dt, e, v);
      for (const h of hide) {
        const on = !!ms[h.key] !== h.neg;
        if (on !== h.on) { h.on = on; for (const b of h.bones) b.scale.setScalar(on ? 1e-4 : 1); }
      }
      for (const b of hang) {
        // 父链（到 mover）累计旋转的逆 → 骨骼世界朝向与 mover 相同，再加一点摆动
        _q.identity();
        for (let p = b.parent; p && p !== mesh; p = p.parent) _q.premultiply(p.quaternion);
        _q2.setFromAxisAngle(AX_Z, Math.sin(v.time * 2.2) * 0.12);
        b.quaternion.copy(_q.invert()).multiply(_q2);
      }
      // 材质变体：状态边缘光（meta.rim(ms)）→ 高亮覆盖 → 透明度
      const r = (meta.rim && meta.rim(ms, e)) || EMPTY;
      const hl = v.highlight;
      const mat = champMat({
        rim: hl != null ? hl : (r.rim ?? meta.baseRim ?? DEFAULT_RIM),
        rimI: hl != null ? Math.max(0.55, r.rimI || 0) : (r.rimI ?? meta.baseRimI ?? DEFAULT_RIM_I),
        glowK: r.glowK ?? 1, tint: r.tint ?? 0xffffff, tintK: r.tintK ?? 0, opacity: v.opacity * (meta.opacity ?? 1), // meta.opacity：模型固有透明度（影分身等），缺省 1
      });
      if (mesh.material !== mat) mesh.material = mat;
      if (outline) outline.visible = hl != null && v.opacity > 0.6 && !v.dead;
      for (const o of overlays) o.update && o.update(v, e, dt);
    },
    onDeath() { v.dead = true; v.deadT = 0; },
    onRespawn() { v.dead = false; v.deadT = 10; anim.reset(); },
    setHighlight(color) {
      v.highlight = color == null ? null : color;
      if (color != null) ensureOutline(color);
      else if (outline) outline.visible = false;
    },
    setOpacity(a) { v.opacity = a; },
    dispose() {
      for (const o of overlays) { try { o.dispose && o.dispose(); } catch (_) { /* 忽略 */ } }
      mesh.skeleton.dispose();
      root.removeFromParent();
    },
    // 调试/头像用
    _v: v, _anim: anim,
  };
  return view;
}
const AX_Z = new THREE.Vector3(0, 0, 1);
