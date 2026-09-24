// 守卫模型：隐形守卫（黄色发光眼图腾）、控制守卫（红粉色水晶）、蓝色守卫（兜底）
import * as THREE from 'three';
import { Rig, UnitView, cachedGeo, crystalMat, ease, clamp01, PI } from './kit.js';

const WARD = {
  stealth: { eye: 0xffd84a, glow: 0xffe27a, h: 82 },
  control: { eye: 0xff3a6a, glow: 0xff5a8a, h: 96 },
  farsight: { eye: 0x5ab8ff, glow: 0x8ad0ff, h: 82 },
};

function buildTotem(kind, detail) {
  const r = new Rig(detail); const W = WARD[kind];
  if (kind === 'control') {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      r.seg([Math.cos(a) * 22, 0, Math.sin(a) * 22], [0, 44, 0], 3, 2.2, 0x2a1a22, {}, 5);
    }
    r.cyl(6, 9, 10, 0x3a2430, { p: [0, 42, 0] }, 8);
    r.tor(12, 2, 0xc8a050, { p: [0, 47, 0], r: [PI / 2, 0, 0] }, 4, 12);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2;
      r.seg([Math.cos(a) * 10, 46, Math.sin(a) * 10], [Math.cos(a) * 16, 72, Math.sin(a) * 16], 2, 0.8, 0x3a2430, {}, 4);
    }
  } else {
    r.hemi(14, 0x3a2e1e, { p: [0, 0, 0], s: [1, 0.4, 1] }, 8, 3);
    r.seg([0, 0, 0], [0, 50, 0], 4, 3, 0x5a4020, {}, 6);
    r.box(26, 3, 3, 0x5a4020, { p: [0, 38, 0] });
    for (const z of [1, -1]) r.cone(4, 10, kind === 'farsight' ? 0x5a8ac0 : 0x6a8a3a, { p: [0, 46, 7 * z], r: [0.8 * z, 0, 0] }, 4);
    r.tor(10, 1.6, 0xc8a050, { p: [0, 58, 0], r: [0, PI / 2, 0] }, 4, 12);
  }
  return r.build();
}
function buildEye(kind, detail) {
  const r = new Rig(detail);
  if (kind === 'control') r.oct(13, 0xffffff, { s: [1, 1.5, 1] });
  else { r.sph(8, 0xffffff, {}, 10, 8); r.oct(5, 0xffffff, { p: [7, 0, 0], s: [0.6, 1, 1] }); }
  return r.build();
}

export function createWardView(e, renderer) {
  const kind = WARD[e.kind] ? e.kind : 'stealth';
  const W = WARD[kind];
  const v = new UnitView(e, renderer, W.h);
  v.mesh(cachedGeo(`ward|${kind}|${v.detail}`, () => buildTotem(kind, v.detail)));
  const eg = new THREE.Group(); eg.position.y = kind === 'control' ? 64 : 58; v.body.add(eg);
  const eyeMat = (vv) => cachedWardMat(W.eye, vv.op);
  v.mesh(cachedGeo(`wardEye|${kind}|${v.detail}`, () => buildEye(kind, v.detail)), eg, eyeMat, { shadow: false });
  const glow = v.sprite(W.glow, kind === 'control' ? 80 : 64, [0, 0, 0], eg, 0.8);
  v.spawnT = 0;
  v.animate = (dt, en) => {
    v.spawnT += dt;
    const grow = ease(clamp01(v.spawnT / 0.3));
    const b = v.body;
    if (v.dead) {
      const k = ease(v.deadT / 0.4);
      b.scale.setScalar(Math.max(0.01, 1 - k));
      b.rotation.z = k * 0.6;
    } else {
      b.scale.setScalar(Math.max(0.01, grow * (0.7 + 0.3 * grow)));
      b.rotation.z = 0;
    }
    eg.position.y = (kind === 'control' ? 64 : 58) + Math.sin(v.t * 2.2) * 3;
    eg.rotation.y += dt * (kind === 'control' ? 1.4 : 0.6);
    const stealthDim = en.stealthed && en.team === renderer?.playerTeam ? 0.75 : 1;
    const s = (kind === 'control' ? 80 : 64) * stealthDim * (1 + Math.sin(v.t * 3.4) * 0.12);
    glow.scale.set(s, s, 1);
  };
  return v;
}

function cachedWardMat(color, op) { return crystalMat(color, { ei: 2.2, op }); }
