// 建筑模型：防御塔（外塔/内塔/高地塔/门牙塔）、泉水方尖碑、召唤水晶（兵营水晶）、水晶枢纽
// 石质塔身为 1 个合并网格；悬浮水晶独立网格（旋转/变色）；被毁后切换为残骸网格
import * as THREE from 'three';
import { Rig, UnitView, cachedGeo, crystalMat, trackAttack, approach, ease, clamp01, prng, tryFx, PI, TAU } from './kit.js';
import { pal } from './palette.js';

// 绕 Y 轴旋转的径向坐标：径向距离 rr、高度 y、切向偏移 tz，角度 a（与 r:[0,a,0] 一致）
const ry = (a, rr, y, tz = 0) => [rr * Math.cos(a) + tz * Math.sin(a), y, -rr * Math.sin(a) + tz * Math.cos(a)];
// 八棱柱第 k 个侧面的朝向角（CylinderGeometry 顶点从 +Z 开始）
const faceA = (k, n = 8) => (PI / n + (k * TAU) / n) - PI / 2;

// ———————————————— 防御塔 ————————————————
const TIER_CFG = {
  outer: { prongs: 4, plates: false, gems: false, crown: false, cs: 1, extra: 0 },
  inner: { prongs: 4, plates: true, gems: false, crown: false, cs: 1.05, extra: 8 },
  inhib: { prongs: 6, plates: true, gems: true, crown: false, cs: 1.1, extra: 14 },
  nexus: { prongs: 6, plates: true, gems: true, crown: true, cs: 1.18, extra: 20 },
};
const TURRET_CY = 440;

function buildTurret(t, tier, detail) {
  const S = pal(t); const chaos = t === 1; const C = TIER_CFG[tier]; const r = new Rig(detail);
  const fw = tier === 'inhib' || tier === 'nexus' ? 1.08 : 1;
  // 基座
  r.cylx(118 * fw, 136 * fw, 26, S.stone2, { p: [0, 13, 0] });
  r.cylx(100 * fw, 116 * fw, 24, S.stone, { p: [0, 38, 0] });
  r.cylx(104 * fw, 104 * fw, 6, S.trim, { p: [0, 52, 0] });
  if (chaos) {
    for (let k = 0; k < 8; k++) {
      const a = faceA(k);
      r.cone(12, 46, S.stone3, { p: ry(a, 128 * fw, 30), r: [0, a, -PI / 2 + 0.75] }, 5);
    }
  } else {
    for (let k = 0; k < 8; k++) r.box(10, 22, 30, S.trim, { p: ry(faceA(k), 110 * fw, 38), r: [0, faceA(k), 0.15] });
  }
  // 下段塔身 + 扶壁
  r.cylx(72, 92, 110, S.stone, { p: [0, 109, 0] });
  for (let k = 0; k < 4; k++) {
    const a = PI / 4 + (k * PI) / 2;
    r.box(36, 118, 26, S.stone2, { p: ry(a, 88, 104), r: [0, a, 0.2] });
    if (chaos) r.cone(9, 40, S.stone3, { p: ry(a, 112, 150), r: [0, a, -0.5] }, 5);
    else r.box(8, 70, 12, S.trim, { p: ry(a, 106, 110), r: [0, a, 0.2] });
  }
  r.cylx(78, 78, 12, S.trim, { p: [0, 168, 0] });
  // 上段塔身 + 符文
  r.cylx(58, 72, 150, S.stone, { p: [0, 248, 0] });
  for (let k = 0; k < 8; k += 2) {
    const a = faceA(k);
    r.box(4, 104, 15, S.accent, { p: ry(a, 61, 246), r: [0, a, 0.093], glow: chaos ? 1.3 : 0.9 });
    r.oct(9, S.accent, { p: ry(a, 64, 312), s: [0.5, 1.3, 1], r: [0, a, 0], glow: 1.4 });
  }
  if (C.plates) {
    for (let k = 1; k < 8; k += 2) {
      const a = faceA(k);
      r.box(10, 70, 34, chaos ? S.stone3 : S.stone2, { p: ry(a, 67, 230), r: [0, a, 0.093] });
      r.box(11, 8, 36, S.trim, { p: ry(a, 67.5, 262), r: [0, a, 0.093] });
    }
    r.cylx(70, 70, 8, S.trim, { p: [0, 205, 0] });
  }
  // 顶部承台
  r.cylx(88, 60, 36, S.stone2, { p: [0, 340, 0] });
  r.cylx(92, 92, 8, S.trim, { p: [0, 361, 0] });
  r.cylx(74, 88, 16, S.stone, { p: [0, 373, 0] });
  if (chaos) {
    for (let k = 0; k < 8; k++) {
      const a = faceA(k);
      r.cone(9, 44, S.stone3, { p: ry(a, 96, 340), r: [0, a, -PI / 2 - 0.45] }, 5);
    }
  }
  if (C.gems) {
    for (let k = 1; k < 8; k += 2) r.oct(10, S.crystal, { p: ry(faceA(k), 80, 168), s: [0.6, 1.4, 1], glow: 2 });
  }
  // 托举水晶的爪
  const N = C.prongs;
  for (let i = 0; i < N; i++) {
    const a = PI / N + (i * TAU) / N;
    if (chaos) {
      const p0 = ry(a, 66, 378); const p1 = ry(a, 104, 446); const p2 = ry(a, 82, 526 + C.extra);
      r.seg(p0, p1, 13, 9, S.stone3, {}, 6);
      r.seg(p1, p2, 9, 1.2, S.stone3, {}, 6);
      r.seg(ry(a, 100, 440), ry(a, 128, 470), 5, 0.8, S.stone3, {}, 5);
      r.oct(6, S.accent, { p: p1, glow: 1.6 });
    } else {
      const p0 = ry(a, 70, 378); const p1 = ry(a, 88, 436); const p2 = ry(a, 60, 508 + C.extra);
      r.seg(p0, p1, 13, 9.5, S.trim, {}, 7);
      r.seg(p1, p2, 9.5, 2.2, S.trim, {}, 7);
      r.sph(10, S.stone, { p: ry(a, 72, 382) }, 8, 6);
      r.sph(4.5, S.accent, { p: p2, glow: 1.5 }, 6, 4);
      r.box(4, 30, 10, S.accent, { p: ry(a, 84, 420), r: [0, a, -0.25], glow: 0.9 });
    }
  }
  if (C.crown) {
    for (let i = 0; i < 3; i++) {
      const a = (i * TAU) / 3;
      r.seg(ry(a, 50, 380), ry(a, 44, 410), 8, 3, chaos ? S.stone3 : S.trim, {}, 6);
    }
  }
  return r.build();
}

function buildTurretCrystal(tier, detail) {
  const r = new Rig(detail); const sc = TIER_CFG[tier].cs;
  r.oct(38 * sc, 0xffffff, { s: [1, 1.75, 1] });
  r.oct(30 * sc, 0xffffff, { s: [1, 1.45, 1], r: [0, PI / 4, 0] });
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3;
    r.oct(8 * sc, 0xffffff, { p: [Math.cos(a) * 66 * sc, (i - 1) * 16, Math.sin(a) * 66 * sc], s: [1, 1.8, 1] });
  }
  return r.build();
}

function buildRubble(t, detail, { base = 118, seed = 3, spread = 190, height = 60 } = {}) {
  const S = pal(t); const r = new Rig(detail); const rnd = prng(seed + t * 17);
  r.cylx(base, base * 1.14, 26, S.stone2, { p: [0, 13, 0], r: [0.02, 0, 0.03] });
  r.cylx(base * 0.85, base * 0.97, 22, S.stone3, { p: [0, 35, 0], r: [0.04, 0.2, -0.03] });
  r.cylx(base * 0.6, base * 0.78, height, S.stone, { p: [0, 40 + height / 2, 0], r: [0.05, 0.1, 0.07] });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + rnd() * 0.4;
    r.dod(14 + rnd() * 12, S.stone, { p: [Math.cos(a) * base * 0.45, 40 + height + rnd() * 10, Math.sin(a) * base * 0.45], r: [rnd() * 3, rnd() * 3, rnd() * 3] });
  }
  const cols = [S.stone, S.stone2, S.stone3];
  for (let i = 0; i < 16; i++) {
    const a = rnd() * TAU; const d = base * 0.7 + rnd() * (spread - base * 0.5); const s = 10 + rnd() * 24;
    r.dod(s, cols[i % 3], { p: [Math.cos(a) * d, s * 0.45, Math.sin(a) * d], r: [rnd() * 3, rnd() * 3, rnd() * 3], s: [1, 0.7, 1] });
  }
  r.seg([base * 0.5, 22, base * 0.35], [base * 1.5, 14, base * 0.8], 11, 3, S.trim, {}, 6);
  r.cylx(46, 52, 80, S.stone, { p: [-base * 1.1, 26, -base * 0.5], r: [PI / 2, 0.7, 0] });
  for (let i = 0; i < 7; i++) {
    const a = rnd() * TAU; const d = base * 0.5 + rnd() * spread * 0.6;
    r.oct(7 + rnd() * 9, S.dimCrystal, { p: [Math.cos(a) * d, 6, Math.sin(a) * d], r: [rnd() * 3, rnd() * 3, rnd()], s: [1, 1.6, 1], glow: 0.25 });
  }
  return r.build();
}

// 视图共用：发光水晶网格（队伍色 / 仇恨红）
function crystalFn(color, ei) { return (v) => crystalMat(v.aggro ? pal(v.team).aggro : color, { ei: v.aggro ? 3.2 : ei, op: v.op }); }
function brightFn(color, ei) { return (v) => crystalMat(color, { ei, op: v.op }); }

export function createTurretView(e, renderer) {
  if (e.kind === 'fountainTurret' || e.tier === 'fountain') return createFountainView(e, renderer);
  const tier = TIER_CFG[e.tier] ? e.tier : 'outer';
  const t = e.team === 1 ? 1 : 0; const S = pal(t);
  const v = new UnitView(e, renderer, 520);
  v.aggro = false;
  const body = v.mesh(cachedGeo(`turret|${tier}|${t}|${v.detail}`, () => buildTurret(t, tier, v.detail)));
  const rubble = v.mesh(cachedGeo(`rubble|turret|${t}|${v.detail}`, () => buildRubble(t, v.detail)), v.object3d);
  const cg = new THREE.Group(); cg.position.y = TURRET_CY; v.body.add(cg);
  const crystal = v.mesh(cachedGeo(`turretCrystal|${tier}|${v.detail}`, () => buildTurretCrystal(tier, v.detail)), cg, crystalFn(S.crystal, 1.7), { shadow: false });
  const glow = v.sprite(S.crystal, 230, [0, 0, 0], cg, 0.7);
  const halo = v.sprite(S.crystal2, 90, [0, 0, 0], cg, 0.9);
  void body; void crystal;
  const setDead = (d) => { v.body.visible = !d || v.deadT < 1.2; rubble.visible = d && v.deadT > 0.45; };
  setDead(v.dead);
  v.onDie = (en) => {
    v.deathX = en.x; v.deathY = en.y;
    tryFx(renderer, 'burst', { x: en.x, y: en.y, h: 380, color: S.crystal, count: 40, size: 26, speed: 520, duration: 1, gravity: 700, shape: 'shard', always: true });
    tryFx(renderer, 'burst', { x: en.x, y: en.y, h: 60, color: 0x9a8f80, count: 36, size: 60, speed: 260, duration: 1.4, gravity: 40, shape: 'smoke', always: true });
    tryFx(renderer, 'shockwave', { x: en.x, y: en.y, radius: 420, color: S.crystal, duration: 0.7, always: true });
  };
  v.onRevive = () => { v.aggro = false; v.refresh(); cg.scale.setScalar(1); };
  v.animate = (dt, en) => {
    if (v.dead) {
      const k = clamp01(v.deadT / 1.2);
      const b = v.body;
      b.position.set(Math.sin(v.t * 47) * 7 * (1 - k), -ease(k) * 230, Math.cos(v.t * 41) * 6 * (1 - k));
      b.rotation.z = ease(k) * 0.16; b.rotation.x = ease(k) * 0.08;
      cg.position.y = TURRET_CY - ease(clamp01(v.deadT / 0.7)) * 330;
      cg.scale.setScalar(Math.max(0.01, 1 - k));
      setDead(true);
      if (rubble.visible) { const s = 0.7 + 0.3 * ease(clamp01((v.deadT - 0.45) / 0.35)); rubble.scale.set(1, s, 1); }
      if (v.aggro) { v.aggro = false; v.refresh(); }
      return;
    }
    setDead(false);
    const tg = en.attackTarget;
    const ag = !!(tg && tg.type === 'champion' && tg.alive !== false);
    if (ag !== v.aggro) {
      v.aggro = ag;
      v.setSprite(glow, ag ? S.aggro : S.crystal, ag ? 0.95 : 0.7);
      v.setSprite(halo, ag ? 0xffb0a0 : S.crystal2, 0.9);
      v.refresh();
    }
    trackAttack(v, en.anim || {}, dt);
    v.spin = approach(v.spin || 0.6, ag ? 2.2 : 0.6, dt * 3);
    cg.rotation.y += dt * v.spin;
    cg.position.y = TURRET_CY + Math.sin(v.t * 1.3) * 7;
    const pulse = 1 + Math.sin(v.t * 2.4) * 0.025 + v.raise * 0.1 + v.strike * 0.06 + (ag ? 0.05 : 0);
    cg.scale.setScalar(pulse);
    const gs = (ag ? 290 : 230) * (1 + v.raise * 0.35 + Math.sin(v.t * 3) * 0.04);
    glow.scale.set(gs, gs, 1);
    const hs = 90 + v.raise * 50 + v.strike * 30;
    halo.scale.set(hs, hs, 1);
  };
  return v;
}

// ———————————————— 泉水方尖碑 ————————————————
function buildObelisk(t, detail) {
  const S = pal(t); const chaos = t === 1; const r = new Rig(detail);
  r.cylx(84, 100, 26, S.stone2, { p: [0, 13, 0] });
  r.cylx(66, 80, 22, S.stone, { p: [0, 37, 0] });
  r.cylx(70, 70, 6, S.trim, { p: [0, 50, 0] });
  r.cylx(26, 44, 300, S.stone, { p: [0, 203, 0] }, 4);
  for (let k = 0; k < 4; k++) {
    const a = faceA(k, 4);
    r.box(3, 250, 9, S.accent, { p: ry(a, 25, 200), r: [0, a, 0.06], glow: 1.8 });
    r.box(14, 60, 22, S.stone2, { p: ry(a, 36, 80), r: [0, a, 0.06] });
    if (chaos) r.cone(8, 40, S.stone3, { p: ry(a, 50, 110), r: [0, a, -0.4] }, 4);
  }
  r.cylx(32, 26, 16, S.trim, { p: [0, 360, 0] }, 4);
  r.cone(24, 46, S.stone2, { p: [0, 391, 0] }, 4);
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2;
    r.seg(ry(a, 30, 360), ry(a, 44, 430), 6, 1.5, S.trim, {}, 5);
  }
  return r.build();
}
function createFountainView(e, renderer) {
  const t = e.team === 1 ? 1 : 0; const S = pal(t);
  const v = new UnitView(e, renderer, 470);
  v.aggro = false;
  v.mesh(cachedGeo(`obelisk|${t}|${v.detail}`, () => buildObelisk(t, v.detail)));
  const cg = new THREE.Group(); cg.position.y = 450; v.body.add(cg);
  const cgeo = cachedGeo(`obeliskCrystal|${v.detail}`, () => { const r = new Rig(v.detail); r.oct(22, 0xffffff, { s: [1, 1.7, 1] }); return r.build(); });
  v.mesh(cgeo, cg, crystalFn(S.crystal, 2), { shadow: false });
  const glow = v.sprite(S.crystal, 170, [0, 0, 0], cg, 0.75);
  v.animate = (dt, en) => {
    const ag = !!en.attackTarget;
    if (ag !== v.aggro) { v.aggro = ag; v.setSprite(glow, ag ? 0xffffff : S.crystal, ag ? 1 : 0.75); v.refresh(); }
    cg.rotation.y += dt * (ag ? 3 : 0.8);
    cg.position.y = 450 + Math.sin(v.t * 1.6) * 6;
    const s = (ag ? 230 : 170) * (1 + Math.sin(v.t * 8) * (ag ? 0.12 : 0.03));
    glow.scale.set(s, s, 1);
  };
  return v;
}

// ———————————————— 召唤水晶 ————————————————
const INHIB_CY = 175;
function buildInhibBase(t, detail) {
  const S = pal(t); const chaos = t === 1; const r = new Rig(detail);
  r.cylx(152, 168, 22, S.stone2, { p: [0, 11, 0] }, 12);
  r.cylx(132, 146, 18, S.stone, { p: [0, 31, 0] }, 12);
  r.tor(139, 5, S.trim, { p: [0, 41, 0], r: [PI / 2, 0, 0] }, 5, 28);
  r.cylx(82, 98, 26, S.stone, { p: [0, 53, 0] }, 8);
  r.cylx(86, 86, 5, S.trim, { p: [0, 67, 0] }, 8);
  r.tor(66, 3.2, S.accent, { p: [0, 70, 0], r: [PI / 2, 0, 0], glow: 1.4 }, 4, 24);
  for (let k = 0; k < 8; k++) {
    const a = faceA(k);
    r.box(6, 14, 28, S.accent, { p: ry(a, 92, 53), r: [0, a, 0.15], glow: 0.7 });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6;
    if (chaos) {
      r.seg(ry(a, 128, 38), ry(a, 150, 120), 17, 12, S.stone3, {}, 6);
      r.seg(ry(a, 150, 120), ry(a, 118, 200), 12, 1.5, S.stone3, {}, 6);
      r.seg(ry(a, 145, 100), ry(a, 180, 130), 6, 0.8, S.stone3, {}, 5);
      r.oct(7, S.accent, { p: ry(a, 148, 118), glow: 1.6 });
    } else {
      r.seg(ry(a, 128, 38), ry(a, 142, 120), 15, 11, S.stone, {}, 7);
      r.seg(ry(a, 142, 120), ry(a, 116, 190), 11, 3, S.trim, {}, 7);
      r.sph(13, S.stone2, { p: ry(a, 136, 60) }, 8, 6);
      r.sph(5, S.accent, { p: ry(a, 116, 192), glow: 1.6 }, 6, 4);
    }
  }
  return r.build();
}
function buildInhibCrystal(detail) {
  const r = new Rig(detail);
  r.oct(52, 0xffffff, { s: [1, 1.55, 1] });
  r.oct(40, 0xffffff, { s: [1, 1.3, 1], r: [0, PI / 4, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i * TAU) / 4 + 0.4;
    r.oct(10, 0xffffff, { p: [Math.cos(a) * 84, (i % 2 ? 22 : -18), Math.sin(a) * 84], s: [1, 1.8, 1] });
  }
  return r.build();
}
function buildRing(rad, tube, detail) {
  const r = new Rig(detail);
  r.tor(rad, tube, 0xffffff, { r: [PI / 2, 0, 0] }, 4, 40);
  for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6; r.oct(tube * 2.4, 0xffffff, { p: [Math.cos(a) * rad, 0, Math.sin(a) * rad] }); }
  return r.build();
}
function buildShards(t, detail, { n = 9, rad = 70, y = 72, size = 16, seed = 5 } = {}) {
  const S = pal(t); const r = new Rig(detail); const rnd = prng(seed + t * 31);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU; const d = rnd() * rad; const s = size * (0.5 + rnd() * 0.8);
    r.oct(s, i % 3 === 0 ? S.crystal : S.dimCrystal, { p: [Math.cos(a) * d, y + s * 0.4, Math.sin(a) * d], r: [rnd() * 2, rnd() * 3, 0.6 + rnd()], s: [1, 1.7, 1], glow: i % 3 === 0 ? 0.6 : 0.2 });
  }
  return r.build();
}

export function createInhibitorView(e, renderer) {
  const t = e.team === 1 ? 1 : 0; const S = pal(t);
  const v = new UnitView(e, renderer, 270);
  v.mesh(cachedGeo(`inhib|${t}|${v.detail}`, () => buildInhibBase(t, v.detail)));
  const shards = v.mesh(cachedGeo(`inhibShards|${t}|${v.detail}`, () => buildShards(t, v.detail)), v.object3d);
  const cg = new THREE.Group(); cg.position.y = INHIB_CY; v.body.add(cg);
  v.mesh(cachedGeo(`inhibCrystal|${v.detail}`, () => buildInhibCrystal(v.detail)), cg, brightFn(S.crystal, 1.6), { shadow: false });
  const ring = v.mesh(cachedGeo(`ring|110|${v.detail}`, () => buildRing(110, 3.2, v.detail)), cg, brightFn(S.crystal2, 1.4), { shadow: false });
  ring.rotation.x = 0.35;
  const ring2 = v.mesh(cachedGeo(`ring|130|${v.detail}`, () => buildRing(130, 2.2, v.detail)), v.body, brightFn(S.crystal, 1.2), { shadow: false });
  ring2.position.y = INHIB_CY - 40; ring2.rotation.x = -0.12;
  const glow = v.sprite(S.crystal, 300, [0, 0, 0], cg, 0.7);
  const setDim = (d) => { if (v.dimmed !== d) { v.dimmed = d; v.refresh(); } };
  const setState = (dead) => {
    cg.visible = !dead || v.deadT < 0.5; ring2.visible = !dead; shards.visible = dead && v.deadT > 0.2;
    setDim(dead && v.deadT > 0.2);
  };
  setState(v.dead);
  v.reviveT = 9;
  v.onDie = (en) => {
    tryFx(renderer, 'burst', { x: en.x, y: en.y, h: INHIB_CY, color: S.crystal, count: 46, size: 24, speed: 560, duration: 1, gravity: 600, shape: 'shard', always: true });
    tryFx(renderer, 'impact', { x: en.x, y: en.y, h: INHIB_CY, color: S.crystal, size: 3, always: true });
    tryFx(renderer, 'shockwave', { x: en.x, y: en.y, radius: 380, color: S.crystal, duration: 0.6, always: true });
  };
  v.onRevive = (en) => {
    v.reviveT = 0; setState(false);
    if (en) tryFx(renderer, 'burst', { x: en.x, y: en.y, h: INHIB_CY, color: S.crystal2, count: 30, size: 22, speed: 260, duration: 0.8, always: true });
  };
  v.animate = (dt) => {
    setState(v.dead);
    if (v.dead) {
      const k = clamp01(v.deadT / 0.5);
      cg.scale.setScalar(Math.max(0.01, (1 + k * 0.4) * (1 - ease(k))));
      const gs = 300 * (1 + k * 1.5) * (1 - k);
      glow.scale.set(gs, gs, 1);
      return;
    }
    v.reviveT += dt;
    const grow = ease(clamp01(v.reviveT / 1.2));
    cg.rotation.y += dt * 0.5;
    ring.rotation.z += dt * 0.9;
    ring2.rotation.y -= dt * 0.35;
    cg.position.y = INHIB_CY + Math.sin(v.t * 1.2) * 8;
    cg.scale.setScalar(Math.max(0.01, grow * (1 + Math.sin(v.t * 2) * 0.02)));
    const gs = 300 * grow * (1 + Math.sin(v.t * 2.2) * 0.06);
    glow.scale.set(gs, gs, 1);
  };
  return v;
}

// ———————————————— 水晶枢纽 ————————————————
const NEXUS_CY = 300;
function buildNexusBase(t, detail) {
  const S = pal(t); const chaos = t === 1; const r = new Rig(detail);
  r.cylx(300, 332, 30, S.stone2, { p: [0, 15, 0] }, 12);
  r.cylx(262, 288, 30, S.stone, { p: [0, 45, 0] }, 12);
  r.cylx(268, 268, 8, S.trim, { p: [0, 62, 0] }, 12);
  r.cylx(172, 212, 40, S.stone, { p: [0, 86, 0] }, 8);
  r.cylx(176, 176, 6, S.trim, { p: [0, 107, 0] }, 8);
  r.tor(152, 5, S.accent, { p: [0, 111, 0], r: [PI / 2, 0, 0], glow: 1.6 }, 4, 32);
  r.cylx(112, 142, 22, S.stone2, { p: [0, 121, 0] }, 8);
  r.tor(96, 3.5, S.accent, { p: [0, 133, 0], r: [PI / 2, 0, 0], glow: 1.8 }, 4, 24);
  // 台阶
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2 + PI / 4;
    r.box(80, 18, 120, S.stone2, { p: ry(a, 300, 9), r: [0, a, 0] });
    r.box(60, 14, 110, S.stone, { p: ry(a, 262, 72), r: [0, a, 0] });
  }
  // 四座拱爪
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2;
    if (chaos) {
      const p0 = ry(a, 236, 60); const p1 = ry(a, 280, 210); const p2 = ry(a, 232, 360); const p3 = ry(a, 150, 470);
      r.seg(p0, p1, 36, 28, S.stone3, {}, 7); r.seg(p1, p2, 28, 18, S.stone3, {}, 7); r.seg(p2, p3, 18, 2, S.stone3, {}, 7);
      r.seg(ry(a, 276, 200), ry(a, 350, 260), 12, 1, S.stone3, {}, 5);
      r.seg(ry(a, 250, 330), ry(a, 320, 380), 9, 1, S.stone3, {}, 5);
      r.oct(12, S.accent, { p: p1, glow: 1.8 }); r.oct(9, S.accent, { p: p2, glow: 1.8 });
    } else {
      const p0 = ry(a, 236, 60); const p1 = ry(a, 262, 210); const p2 = ry(a, 222, 350); const p3 = ry(a, 158, 446);
      r.seg(p0, p1, 34, 26, S.stone, {}, 8); r.seg(p1, p2, 26, 18, S.stone, {}, 8); r.seg(p2, p3, 18, 5, S.trim, {}, 8);
      r.tor(28, 5, S.trim, { p: p1, r: [PI / 2, 0, 0] }, 4, 14);
      r.sph(12, S.accent, { p: p3, glow: 1.8 }, 8, 6);
      r.box(6, 110, 22, S.accent, { p: ry(a, 262, 150), r: [0, a, -0.1], glow: 1.0 });
    }
  }
  // 四座小晶柱
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2 + PI / 4;
    r.cylx(20, 30, 100, chaos ? S.stone3 : S.stone, { p: ry(a, 212, 110) }, 6);
    r.cylx(26, 26, 6, S.trim, { p: ry(a, 212, 160) }, 6);
    r.oct(18, S.crystal, { p: ry(a, 212, 190), s: [1, 1.7, 1], glow: 2.4 });
  }
  if (chaos) for (let k = 0; k < 12; k++) {
    const a = (k * TAU) / 12;
    r.cone(14, 60, S.stone3, { p: ry(a, 316, 40), r: [0, a, -PI / 2 + 0.7] }, 5);
  }
  return r.build();
}
function buildNexusCrystal(detail) {
  const r = new Rig(detail);
  r.oct(92, 0xffffff, { s: [1, 1.6, 1] });
  r.oct(74, 0xffffff, { s: [1, 1.35, 1], r: [0, PI / 4, 0] });
  r.oct(60, 0xffffff, { s: [1, 1.9, 1], r: [0, PI / 8, 0] });
  for (let i = 0; i < 5; i++) {
    const a = (i * TAU) / 5;
    r.oct(18, 0xffffff, { p: [Math.cos(a) * 158, Math.sin(i * 2.1) * 40, Math.sin(a) * 158], s: [1, 1.9, 1] });
  }
  return r.build();
}

export function createNexusView(e, renderer) {
  const t = e.team === 1 ? 1 : 0; const S = pal(t);
  const v = new UnitView(e, renderer, 480);
  v.mesh(cachedGeo(`nexus|${t}|${v.detail}`, () => buildNexusBase(t, v.detail)));
  const shards = v.mesh(cachedGeo(`nexusShards|${t}|${v.detail}`, () => buildShards(t, v.detail, { n: 22, rad: 300, y: 60, size: 30, seed: 11 })), v.object3d);
  const cg = new THREE.Group(); cg.position.y = NEXUS_CY; v.body.add(cg);
  v.mesh(cachedGeo(`nexusCrystal|${v.detail}`, () => buildNexusCrystal(v.detail)), cg, brightFn(S.crystal, 1.5), { shadow: false });
  const rings = [
    v.mesh(cachedGeo(`ring|210|${v.detail}`, () => buildRing(210, 4, v.detail)), v.body, brightFn(S.crystal2, 1.3), { shadow: false }),
    v.mesh(cachedGeo(`ring|175|${v.detail}`, () => buildRing(175, 3, v.detail)), v.body, brightFn(S.crystal, 1.5), { shadow: false }),
  ];
  rings[0].position.y = NEXUS_CY - 30; rings[0].rotation.x = 0.28;
  rings[1].position.y = NEXUS_CY + 20; rings[1].rotation.x = -0.4;
  const glow = v.sprite(S.crystal, 620, [0, 0, 0], cg, 0.62);
  const core = v.sprite(S.crystal2, 220, [0, 0, 0], cg, 0.8);
  const setState = (dead) => {
    const exploded = dead && v.deadT > 1.3;
    cg.visible = !exploded; for (const rg of rings) rg.visible = !dead || v.deadT < 1.3;
    shards.visible = exploded;
    const dim = exploded; if (v.dimmed !== dim) { v.dimmed = dim; v.refresh(); }
  };
  setState(v.dead);
  if (v.dead) v.deadT = 99;
  v.onDie = () => { v.boomed = false; };
  v.onRevive = () => { v.boomed = false; setState(false); };
  v.animate = (dt, en) => {
    setState(v.dead);
    if (v.dead) {
      const T = v.deadT;
      if (T < 1.3) {
        const k = T / 1.3;
        cg.position.set(Math.sin(v.t * 53) * 10 * k, NEXUS_CY + ease(k) * 60, Math.cos(v.t * 47) * 10 * k);
        cg.scale.setScalar(1 + ease(k) * 0.4);
        cg.rotation.y += dt * (1 + k * 10);
        const gs = 620 * (1 + k * 1.6); glow.scale.set(gs, gs, 1);
        const cs = 220 * (1 + k * 3); core.scale.set(cs, cs, 1);
        if (k > 0.5 && core.userData.color !== 0xffffff) v.setSprite(core, 0xffffff, 1);
        for (const rg of rings) rg.rotation.y += dt * (2 + k * 12);
      } else if (!v.boomed && T < 3) {
        v.boomed = true;
        const x = en.x; const y = en.y;
        tryFx(renderer, 'burst', { x, y, h: NEXUS_CY, color: S.crystal, count: 90, size: 40, speed: 900, duration: 1.6, gravity: 500, shape: 'shard', always: true });
        tryFx(renderer, 'burst', { x, y, h: NEXUS_CY, color: 0xffffff, count: 40, size: 70, speed: 500, duration: 0.9, always: true });
        tryFx(renderer, 'impact', { x, y, h: NEXUS_CY, color: S.crystal, size: 6, always: true });
        tryFx(renderer, 'shockwave', { x, y, radius: 900, color: S.crystal, duration: 1.1, always: true });
        tryFx(renderer, 'burst', { x, y, h: 60, color: 0x8a8070, count: 50, size: 90, speed: 300, duration: 2.2, gravity: 30, shape: 'smoke', always: true });
        try { renderer?.cameraCtl?.shake?.(30, 0.8); } catch { /* 忽略 */ }
      }
      if (shards.visible) {
        const u = ease(clamp01((T - 1.3) / 0.7));
        shards.scale.setScalar(0.2 + 0.8 * u);
        shards.position.y = (1 - u) * NEXUS_CY;
      }
      return;
    }
    cg.position.set(0, NEXUS_CY + Math.sin(v.t * 0.9) * 10, 0);
    cg.rotation.y += dt * 0.32;
    const p = 1 + Math.sin(v.t * 1.8) * 0.035;
    cg.scale.setScalar(p);
    rings[0].rotation.y += dt * 0.45; rings[1].rotation.y -= dt * 0.7;
    const gs = 620 * (1 + Math.sin(v.t * 1.8) * 0.09); glow.scale.set(gs, gs, 1);
    const cs = 220 * (1 + Math.sin(v.t * 3.1) * 0.08); core.scale.set(cs, cs, 1);
    if (core.userData.color !== S.crystal2) v.setSprite(core, S.crystal2, 0.8);
  };
  return v;
}
