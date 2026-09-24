// 英雄与提伯斯的程序化模型（可用桩，models-champions 代理会整体替换）：简易人形 + 标志性武器/装饰、程序化动画、半身像头像渲染
//
// 视图约定（与 ARCHITECTURE §10.2 一致）：object3d 原点在脚底中心、正前方 +X；渲染器每帧重置 object3d 的位置与 rotation.y，
// 动画只改子节点（body/四肢）。实体被移除后 anim.t 不再推进，死亡动画用视图自身计时。
import * as THREE from 'three';
import { CHAMPIONS } from '../../champions/index.js';

// —— 每个英雄的体型与装备 ——
const SPEC = {
  garen: { H: 235, bulk: 1.25, skin: 0xe2b590, hair: 0x4a3322, weapon: 'greatsword', cape: 0x1d3a7a, pauldrons: true },
  darius: { H: 240, bulk: 1.32, skin: 0xc9a07a, hair: 0x1a1a1a, weapon: 'axe', cape: 0x3a0e0e, pauldrons: true, spikes: true },
  leesin: { H: 215, bulk: 1.0, skin: 0xd9a47a, hair: 0x1a1210, weapon: 'fists', bare: true, headband: 0xc8302a },
  masteryi: { H: 215, bulk: 0.95, skin: 0xd9a47a, hair: 0x222222, weapon: 'katana', helmet: true },
  ahri: { H: 205, bulk: 0.82, skin: 0xf1d0bc, hair: 0x22141c, weapon: 'orb', female: true, ears: true, tails: 9 },
  lux: { H: 200, bulk: 0.82, skin: 0xf3d4bf, hair: 0xf2d77a, weapon: 'staff', female: true, ponytail: true },
  annie: { H: 150, bulk: 0.95, skin: 0xf3d0bb, hair: 0xd8596d, weapon: 'bear', child: true },
  ashe: { H: 212, bulk: 0.84, skin: 0xefd2c0, hair: 0xeef0f6, weapon: 'bow', female: true, hood: true },
  jinx: { H: 205, bulk: 0.78, skin: 0xf0d6ca, hair: 0x2f6fd8, weapon: 'gun', female: true, braids: true },
  thresh: { H: 255, bulk: 1.1, skin: 0x7affc8, hair: 0x0a1a14, weapon: 'lantern', ghost: true },
};
const DEFAULT_SPEC = { H: 215, bulk: 1, skin: 0xd9a47a, hair: 0x333333, weapon: 'sword' };

// —— 几何工具（低多边形 + 平直着色） ——
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
function cyl(rt, rb, h, seg = 8) { return new THREE.CylinderGeometry(rt, rb, h, seg); }
function sph(r, ws = 10, hs = 8, ...rest) { return new THREE.SphereGeometry(r, ws, hs, ...rest); }
function cone(r, h, seg = 8) { return new THREE.ConeGeometry(r, h, seg); }

class MatSet {
  constructor() { this.list = []; }
  make(color, { metal = 0.15, rough = 0.62, emissive = 0x000000, emissiveIntensity = 0, flat = true, opacity = 1, side } = {}) {
    const m = new THREE.MeshStandardMaterial({
      color, metalness: metal, roughness: rough, emissive, emissiveIntensity, flatShading: flat,
      transparent: opacity < 1, opacity, side: side ?? THREE.FrontSide,
    });
    m.userData.baseEmissive = emissive;
    m.userData.baseEmissiveIntensity = emissiveIntensity;
    m.userData.baseOpacity = opacity;
    this.list.push(m);
    return m;
  }
}

function mesh(geo, mat, parent, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = false;
  if (parent) parent.add(m);
  return m;
}

// 肢体：关节 pivot，网格向下悬挂
function limb(parent, x, y, z, len, r0, r1, mat) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  parent.add(pivot);
  const g = cyl(r0, r1, len, 7);
  g.translate(0, -len / 2, 0);
  mesh(g, mat, pivot);
  const end = new THREE.Group();
  end.position.set(0, -len, 0);
  pivot.add(end);
  return { pivot, end };
}

// —— 构建人形 ——
function buildHumanoid(id, def, spec) {
  const model = def?.model || {};
  const prim = model.primary ?? 0x777777;
  const sec = model.secondary ?? 0xcccccc;
  const acc = model.accent ?? 0xffffff;
  const mats = new MatSet();
  const H = spec.H;
  const k = spec.bulk;
  const mPrim = mats.make(prim, { metal: spec.bare ? 0.05 : 0.35, rough: 0.55 });
  const mSec = mats.make(sec, { metal: 0.55, rough: 0.4 });
  const mAcc = mats.make(acc, { metal: 0.2, rough: 0.4, emissive: acc, emissiveIntensity: 0.25 });
  const mSkin = mats.make(spec.ghost ? 0x2a6a58 : spec.skin, { metal: 0, rough: 0.8, emissive: spec.ghost ? 0x3aff9a : 0, emissiveIntensity: spec.ghost ? 0.25 : 0 });
  const mHair = mats.make(spec.hair, { metal: 0, rough: 0.85 });
  const mDark = mats.make(0x1c1c22, { metal: 0.2, rough: 0.7 });

  const root = new THREE.Group();
  const body = new THREE.Group();   // 死亡/旋转等整体动画
  root.add(body);
  const legLen = H * (spec.child ? 0.36 : 0.44);
  const torsoH = H * 0.3;
  const hipW = H * 0.075 * k;
  const hips = new THREE.Group();
  hips.position.y = legLen;
  body.add(hips);
  // 骨盆
  mesh(box(H * 0.12 * k, H * 0.08, H * 0.2 * k), spec.bare ? mDark : mPrim, hips, 0, 0, 0);
  // 腿
  const legR0 = H * 0.045 * k, legR1 = H * 0.035 * k;
  const legL = limb(hips, 0, -H * 0.02, -hipW, legLen - H * 0.02, legR0, legR1, spec.bare ? mDark : (spec.female ? mDark : mPrim));
  const legR = limb(hips, 0, -H * 0.02, hipW, legLen - H * 0.02, legR0, legR1, spec.bare ? mDark : (spec.female ? mDark : mPrim));
  for (const lg of [legL, legR]) {
    mesh(box(H * 0.1, H * 0.04, H * 0.06 * k), mSec, lg.end, H * 0.02, H * 0.01, 0);
  }
  // 躯干
  const chest = new THREE.Group();
  chest.position.y = H * 0.02;
  hips.add(chest);
  const torsoGeo = cyl(H * 0.1 * k * (spec.female ? 0.85 : 1.05), H * 0.075 * k, torsoH, 8);
  torsoGeo.translate(0, torsoH / 2, 0);
  torsoGeo.scale(0.75, 1, 1.15);
  mesh(torsoGeo, spec.bare ? mSkin : mPrim, chest);
  // 腰带
  mesh(cyl(H * 0.082 * k, H * 0.082 * k, H * 0.035, 8), spec.bare ? mAcc : mSec, chest, 0, H * 0.02, 0);
  if (spec.female && !spec.child) {
    // 裙摆
    const skirt = cone(H * 0.13 * k, H * 0.16, 9);
    skirt.rotateX(Math.PI);
    mesh(skirt, mPrim, hips, 0, -H * 0.04, 0);
  }
  if (spec.child) {
    const dress = cone(H * 0.17, H * 0.26, 10);
    mesh(dress, mPrim, hips, 0, H * 0.05, 0);
  }
  // 肩甲
  const shoulderY = torsoH * 0.92;
  const shoulderZ = H * 0.12 * k;
  if (spec.pauldrons) {
    for (const s of [-1, 1]) {
      const p = sph(H * 0.065 * k, 8, 6);
      p.scale(1, 0.75, 1);
      mesh(p, mSec, chest, 0, shoulderY, s * shoulderZ);
      if (spec.spikes) {
        const sp = cone(H * 0.02, H * 0.07, 5);
        mesh(sp, mDark, chest, 0, shoulderY + H * 0.05, s * shoulderZ);
      }
    }
  }
  // 披风
  if (spec.cape) {
    const capeMat = mats.make(spec.cape, { metal: 0, rough: 0.9, side: THREE.DoubleSide });
    const cg = new THREE.PlaneGeometry(H * 0.22 * k, H * 0.42);
    cg.translate(0, -H * 0.21, 0);
    cg.rotateY(Math.PI / 2);
    const cape = mesh(cg, capeMat, chest, -H * 0.07 * k, shoulderY, 0);
    cape.rotation.z = -0.12;
  }
  // 头
  const neck = new THREE.Group();
  neck.position.y = torsoH;
  chest.add(neck);
  const headR = H * (spec.child ? 0.1 : 0.068);
  const head = new THREE.Group();
  head.position.y = headR * 1.15;
  neck.add(head);
  mesh(sph(headR, 10, 8), mSkin, head);
  // 头发/头饰
  if (spec.helmet) {
    const hg = sph(headR * 1.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
    mesh(hg, mSec, head, 0, headR * 0.1, 0);
    // 护目镜（三镜片）
    for (const [dz, dy] of [[-0.35, 0.15], [0.35, 0.15], [0, -0.15]]) {
      mesh(sph(headR * 0.26, 8, 6), mAcc, head, headR * 0.92, headR * dy, headR * dz, false);
    }
    const plume = cone(headR * 0.25, headR * 1.6, 5);
    plume.rotateZ(0.9);
    mesh(plume, mAcc, head, -headR * 0.6, headR * 1.1, 0);
  } else if (spec.hood) {
    const hg = sph(headR * 1.25, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62);
    mesh(hg, mPrim, head, -headR * 0.12, headR * 0.05, 0);
    mesh(sph(headR * 0.95, 8, 6), mHair, head, -headR * 0.35, -headR * 0.3, 0);
  } else if (spec.ghost) {
    const hood = cone(headR * 1.35, headR * 3, 8);
    mesh(hood, mPrim, head, -headR * 0.15, headR * 0.6, 0);
    for (const s of [-1, 1]) mesh(sph(headR * 0.16, 6, 4), mAcc, head, headR * 0.85, headR * 0.1, s * headR * 0.35, false);
  } else {
    const hg = sph(headR * 1.06, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55);
    mesh(hg, mHair, head, -headR * 0.08, headR * 0.08, 0);
  }
  if (spec.headband) {
    const hb = cyl(headR * 1.04, headR * 1.04, headR * 0.3, 10);
    mesh(hb, mats.make(spec.headband, { metal: 0, rough: 0.8 }), head, 0, headR * 0.1, 0);
    // 蒙眼布
    mesh(box(headR * 0.25, headR * 0.28, headR * 1.5), mats.make(spec.headband, { metal: 0, rough: 0.8 }), head, headR * 0.9, headR * 0.1, 0);
  }
  if (spec.ears) {
    for (const s of [-1, 1]) {
      const e = cone(headR * 0.35, headR * 0.9, 4);
      mesh(e, mHair, head, -headR * 0.1, headR * 1.05, s * headR * 0.55).rotation.x = s * 0.35;
    }
  }
  if (spec.ponytail) {
    const pt = cone(headR * 0.45, headR * 2.6, 6);
    pt.rotateZ(-2.6);
    mesh(pt, mHair, head, -headR * 1.3, -headR * 0.4, 0);
  }
  if (spec.braids) {
    for (const s of [-1, 1]) {
      const b = cyl(headR * 0.2, headR * 0.12, H * 0.5, 5);
      b.translate(0, -H * 0.25, 0);
      const br = mesh(b, mHair, head, -headR * 0.5, 0, s * headR * 0.8);
      br.rotation.x = s * 0.25;
      br.rotation.z = -0.25;
    }
  }
  if (spec.child) {
    // 小辫
    for (const s of [-1, 1]) mesh(sph(headR * 0.4, 6, 5), mHair, head, -headR * 0.2, headR * 0.5, s * headR * 1.0);
  }
  // 手臂
  const armLen = H * (spec.child ? 0.26 : 0.3);
  const armR0 = H * 0.035 * k, armR1 = H * 0.028 * k;
  const armMat = spec.bare ? mSkin : (spec.female ? mSkin : mPrim);
  const armL = limb(chest, 0, shoulderY, -shoulderZ * 1.02, armLen, armR0, armR1, armMat);
  const armR = limb(chest, 0, shoulderY, shoulderZ * 1.02, armLen, armR0, armR1, armMat);
  for (const a of [armL, armR]) mesh(sph(H * 0.032 * k, 6, 5), spec.bare ? mAcc : mSkin, a.end, 0, 0, 0);
  // 尾巴（阿狸）
  const tails = [];
  if (spec.tails) {
    const tailMat = mats.make(0xf6eef4, { metal: 0, rough: 0.9, emissive: acc, emissiveIntensity: 0.08 });
    for (let i = 0; i < spec.tails; i++) {
      const piv = new THREE.Group();
      piv.position.set(-H * 0.06, 0, 0);
      hips.add(piv);
      const tg = cone(H * 0.045, H * 0.42, 6);
      tg.translate(0, H * 0.21, 0);
      mesh(tg, tailMat, piv);
      const a = (i / (spec.tails - 1) - 0.5) * 2.2;
      piv.rotation.set(a, 0, 0.9);
      piv.userData.baseX = a;
      tails.push(piv);
    }
  }
  // 武器
  const weapon = buildWeapon(spec.weapon, H, mats, { prim, sec, acc, mDark, mSec, mAcc });
  const holder = spec.weapon === 'bow' || spec.weapon === 'lantern' || spec.weapon === 'bear' ? armL.end : armR.end;
  if (weapon.main) holder.add(weapon.main);
  if (weapon.off) (holder === armL.end ? armR.end : armL.end).add(weapon.off);
  return {
    root, body, hips, chest, neck, head, legL, legR, armL, armR, tails, weapon, mats, H, spec,
  };
}

function buildWeapon(kind, H, mats, c) {
  const out = { main: null, off: null, glow: [], kind };
  const g = new THREE.Group();
  switch (kind) {
    case 'greatsword': {
      const bladeMat = mats.make(0xd8dde6, { metal: 0.85, rough: 0.25, emissive: 0xffd76a, emissiveIntensity: 0 });
      mesh(box(H * 0.035, H * 0.62, H * 0.1), bladeMat, g, 0, -H * 0.38, 0);
      mesh(box(H * 0.05, H * 0.03, H * 0.24), c.mSec, g, 0, -H * 0.06, 0);
      mesh(cyl(H * 0.018, H * 0.018, H * 0.12, 6), c.mDark, g, 0, 0, 0);
      g.rotation.z = 1.9; // 剑身朝前上方（刀身沿 -Y 建模，绕 Z 旋转后指向 +X）
      out.glow.push(bladeMat);
      break;
    }
    case 'axe': {
      const shaft = cyl(H * 0.018, H * 0.018, H * 0.7, 6);
      mesh(shaft, c.mDark, g, 0, -H * 0.2, 0);
      const bladeMat = mats.make(0x9a9aa2, { metal: 0.8, rough: 0.3, emissive: 0xff4a2a, emissiveIntensity: 0 });
      const blade = new THREE.CylinderGeometry(H * 0.2, H * 0.2, H * 0.025, 10, 1, false, 0, Math.PI * 0.9);
      blade.rotateX(Math.PI / 2);
      mesh(blade, bladeMat, g, H * 0.02, -H * 0.5, 0).rotation.z = -Math.PI * 0.45;
      g.rotation.z = 1.9;
      out.glow.push(bladeMat);
      break;
    }
    case 'katana': {
      const bladeMat = mats.make(0xe6f0e0, { metal: 0.9, rough: 0.2, emissive: c.acc, emissiveIntensity: 0.05 });
      mesh(box(H * 0.018, H * 0.5, H * 0.04), bladeMat, g, 0, -H * 0.3, 0);
      mesh(box(H * 0.05, H * 0.02, H * 0.08), c.mSec, g, 0, -H * 0.05, 0);
      g.rotation.z = 1.8;
      out.glow.push(bladeMat);
      break;
    }
    case 'fists': {
      const wrap = mats.make(0xf0e6d0, { metal: 0, rough: 0.9 });
      const a = new THREE.Group(); mesh(sph(H * 0.04, 6, 5), wrap, a);
      const b = new THREE.Group(); mesh(sph(H * 0.04, 6, 5), wrap, b);
      out.main = a; out.off = b;
      return out;
    }
    case 'orb': {
      const orbMat = mats.make(0x7ab8ff, { metal: 0, rough: 0.2, emissive: 0x8ac8ff, emissiveIntensity: 1.2, flat: false });
      mesh(sph(H * 0.055, 12, 10), orbMat, g, H * 0.05, -H * 0.03, 0, false);
      out.glow.push(orbMat);
      break;
    }
    case 'staff': {
      mesh(cyl(H * 0.014, H * 0.014, H * 0.75, 6), c.mSec, g, 0, 0, 0);
      const gem = mats.make(0xfff4b0, { metal: 0, rough: 0.2, emissive: 0xfff08a, emissiveIntensity: 1.1, flat: false });
      mesh(sph(H * 0.045, 10, 8), gem, g, 0, H * 0.4, 0, false);
      mesh(new THREE.TorusGeometry(H * 0.06, H * 0.01, 5, 12), c.mSec, g, 0, H * 0.4, 0);
      g.rotation.z = 0.15;
      out.glow.push(gem);
      break;
    }
    case 'bear': {
      const fur = mats.make(0x6a4a3a, { metal: 0, rough: 0.95 });
      mesh(sph(H * 0.08, 8, 6), fur, g, 0, -H * 0.1, 0);
      mesh(sph(H * 0.06, 8, 6), fur, g, 0, -H * 0.01, 0);
      for (const s of [-1, 1]) mesh(sph(H * 0.025, 6, 4), fur, g, 0, H * 0.04, s * H * 0.04);
      mesh(sph(H * 0.015, 5, 4), mats.make(0x5ad8ff, { emissive: 0x5ad8ff, emissiveIntensity: 1 }), g, H * 0.05, 0, H * 0.02, false);
      break;
    }
    case 'bow': {
      const bowMat = mats.make(c.acc, { metal: 0.2, rough: 0.3, emissive: c.acc, emissiveIntensity: 0.5 });
      const arc = new THREE.TorusGeometry(H * 0.3, H * 0.014, 5, 16, Math.PI * 0.95);
      arc.rotateZ(Math.PI / 2 - Math.PI * 0.475);
      mesh(arc, bowMat, g, -H * 0.12, 0, 0);
      mesh(cyl(H * 0.003, H * 0.003, H * 0.58, 3), mats.make(0xeeeeee, { metal: 0, rough: 0.5 }), g, -H * 0.15, 0, 0, false);
      g.rotation.y = Math.PI / 2;
      g.position.x = H * 0.03;
      out.glow.push(bowMat);
      break;
    }
    case 'gun': {
      const gunMat = mats.make(c.sec, { metal: 0.5, rough: 0.4 });
      const mg = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const barrel = cyl(H * 0.012, H * 0.012, H * 0.42, 5);
        barrel.rotateZ(Math.PI / 2);
        mesh(barrel, c.mDark, mg, H * 0.2, Math.cos(a) * H * 0.025, Math.sin(a) * H * 0.025);
      }
      mesh(box(H * 0.14, H * 0.1, H * 0.1), gunMat, mg, 0, 0, 0);
      mg.position.y = -H * 0.03;
      g.add(mg);
      const rk = new THREE.Group();
      const tube = cyl(H * 0.06, H * 0.07, H * 0.5, 8);
      tube.rotateZ(Math.PI / 2);
      mesh(tube, mats.make(0x3ab85a, { metal: 0.3, rough: 0.5 }), rk, H * 0.12, 0, 0);
      const jaw = cone(H * 0.08, H * 0.1, 8);
      jaw.rotateZ(-Math.PI / 2);
      mesh(jaw, gunMat, rk, H * 0.4, 0, 0);
      rk.position.y = -H * 0.03;
      rk.visible = false;
      g.add(rk);
      out.minigun = mg;
      out.rocket = rk;
      break;
    }
    case 'lantern': {
      const lanternMat = mats.make(0x5affb8, { metal: 0, rough: 0.2, emissive: 0x5affb8, emissiveIntensity: 1.4, flat: false });
      mesh(cyl(H * 0.004, H * 0.004, H * 0.12, 3), c.mDark, g, 0, -H * 0.06, 0, false);
      mesh(sph(H * 0.05, 8, 6), lanternMat, g, 0, -H * 0.14, 0, false);
      mesh(cone(H * 0.055, H * 0.05, 6), c.mDark, g, 0, -H * 0.09, 0);
      out.glow.push(lanternMat);
      // 另一只手：锁链镰刀
      const sc = new THREE.Group();
      mesh(cyl(H * 0.012, H * 0.012, H * 0.3, 5), c.mDark, sc, 0, -H * 0.12, 0);
      const hook = new THREE.TorusGeometry(H * 0.07, H * 0.012, 4, 10, Math.PI);
      mesh(hook, mats.make(0x9aa0a8, { metal: 0.8, rough: 0.3 }), sc, H * 0.06, -H * 0.27, 0);
      out.off = sc;
      out.lantern = g;
      break;
    }
    default: {
      const bladeMat = mats.make(0xcfd6e0, { metal: 0.85, rough: 0.25 });
      mesh(box(H * 0.025, H * 0.4, H * 0.06), bladeMat, g, 0, -H * 0.25, 0);
      g.rotation.z = 1.8;
      out.glow.push(bladeMat);
    }
  }
  out.main = g;
  return out;
}

// —— 提伯斯 ——
function buildTibbers() {
  const mats = new MatSet();
  const H = 280;
  const fur = mats.make(0x2a1a14, { metal: 0, rough: 0.95 });
  const ember = mats.make(0xff7a2a, { metal: 0, rough: 0.5, emissive: 0xff5a1a, emissiveIntensity: 1.2 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = H * 0.3;
  body.add(hips);
  const legL = limb(hips, 0, 0, -H * 0.12, H * 0.3, H * 0.07, H * 0.065, fur);
  const legR = limb(hips, 0, 0, H * 0.12, H * 0.3, H * 0.07, H * 0.065, fur);
  const chest = new THREE.Group();
  hips.add(chest);
  const tg = sph(H * 0.22, 10, 8);
  tg.scale(0.9, 1.15, 1);
  tg.translate(0, H * 0.22, 0);
  mesh(tg, fur, chest);
  mesh(sph(H * 0.12, 8, 6), ember, chest, H * 0.12, H * 0.2, 0, false).scale.set(0.5, 1, 1);
  const neck = new THREE.Group();
  neck.position.y = H * 0.45;
  chest.add(neck);
  const head = new THREE.Group();
  head.position.set(H * 0.04, H * 0.08, 0);
  neck.add(head);
  mesh(sph(H * 0.13, 10, 8), fur, head);
  mesh(sph(H * 0.06, 8, 6), fur, head, H * 0.11, -H * 0.02, 0);
  for (const s of [-1, 1]) {
    mesh(sph(H * 0.045, 6, 5), fur, head, -H * 0.02, H * 0.11, s * H * 0.09);
    mesh(sph(H * 0.018, 5, 4), ember, head, H * 0.11, H * 0.03, s * H * 0.05, false);
  }
  const armL = limb(chest, 0, H * 0.36, -H * 0.22, H * 0.3, H * 0.07, H * 0.06, fur);
  const armR = limb(chest, 0, H * 0.36, H * 0.22, H * 0.3, H * 0.07, H * 0.06, fur);
  for (const a of [armL, armR]) {
    for (let i = 0; i < 3; i++) {
      const cl = cone(H * 0.012, H * 0.06, 4);
      cl.rotateZ(-Math.PI / 2 - 0.4);
      mesh(cl, ember, a.end, H * 0.05, -H * 0.02, (i - 1) * H * 0.025, false);
    }
  }
  return { root, body, hips, chest, neck, head, legL, legR, armL, armR, tails: [], weapon: { glow: [ember], kind: 'claws' }, mats, H, spec: { H, bulk: 1.6, tibbers: true } };
}

// —— 动画 ——
function animate(rig, dt, e, st) {
  const a = e.anim || { state: 'idle', t: 0, speed: 1 };
  const ms = e.modelState || {};
  const H = rig.H;
  const t = a.t || 0;
  st.time += dt;
  const time = st.time;
  // 复位
  let legLz = 0, legRz = 0, armLz = 0, armRz = 0, armLx = 0, armRx = 0, bodyY = 0, lean = 0, headZ = 0, bodyRotY = 0, chestY = 0;
  let bodyTilt = 0;
  const state = st.dead ? 'death' : a.state;
  switch (state) {
    case 'run': {
      const ph = time * 9.5 * Math.max(0.6, Math.min(1.6, a.speed || 1));
      const s = Math.sin(ph);
      legLz = s * 0.75; legRz = -s * 0.75;
      armLz = -s * 0.55; armRz = s * 0.55;
      bodyY = Math.abs(Math.cos(ph)) * H * 0.025;
      lean = -0.12;
      break;
    }
    case 'attack': {
      const w = Math.max(0.08, a.windup || 0.25);
      const ranged = rig.spec.weapon === 'bow' || rig.spec.weapon === 'gun' || rig.spec.weapon === 'orb' || rig.spec.weapon === 'staff' || rig.spec.weapon === 'lantern';
      if (ranged) {
        const k = Math.min(1, t / w);
        armRz = 1.3 * k; armLz = 1.1 * k;
        if (t > w) { const r = Math.max(0, 1 - (t - w) / 0.25); armRz = 1.3 * r + 0.2; armLz = 1.1 * r; lean = 0.05 * r; }
      } else {
        const alt = (a.attackIndex || 0) % 2 === 0;
        if (t < w) { const k = t / w; armRz = -1.9 * k * k; lean = 0.08 * k; chestY = alt ? -0.35 * k : 0.35 * k; }
        else { const k = Math.min(1, (t - w) / 0.12); const r = Math.max(0, 1 - (t - w - 0.12) / 0.3); armRz = (-1.9 + 3.2 * k) * r; lean = -0.15 * r; chestY = (alt ? 0.45 : -0.45) * k * r; }
        armLz = -armRz * 0.3;
      }
      break;
    }
    case 'cast': {
      const k = Math.min(1, t / 0.15);
      const slot = a.slot;
      if (slot === 'R') { armLz = 2.6 * k; armRz = 2.6 * k; armLx = -0.4 * k; armRx = 0.4 * k; lean = -0.1 * k; }
      else if (slot === 'W') { armLz = 0.8 * k; armRz = 0.8 * k; armLx = -0.9 * k; armRx = 0.9 * k; }
      else if (slot === 'E') { armRz = 1.8 * k; armLz = 0.4 * k; chestY = 0.5 * k; }
      else { armRz = 1.5 * k; armLz = 0.9 * k; lean = 0.1 * k; }
      break;
    }
    case 'channel':
    case 'recall': {
      armLz = 1.0; armRz = 1.0; armLx = -0.6; armRx = 0.6;
      bodyY = Math.sin(time * 3) * H * 0.01;
      headZ = -0.2;
      break;
    }
    case 'dash': {
      lean = -0.45; legLz = 0.9; legRz = -0.6; armLz = -1.0; armRz = -1.2;
      break;
    }
    case 'airborne': {
      lean = Math.sin(time * 9) * 0.25; legLz = 0.5; legRz = -0.4; armLz = 2.2; armRz = 2.0; armLx = -0.6; armRx = 0.6;
      break;
    }
    case 'stunned': {
      headZ = 0.3 + Math.sin(time * 6) * 0.15; armLz = 0.2; armRz = 0.2; lean = 0.15;
      break;
    }
    case 'death': {
      break;
    }
    default: {
      const b = Math.sin(time * 2.2);
      bodyY = b * H * 0.006;
      armLz = 0.05 + b * 0.04; armRz = 0.05 - b * 0.04;
      armLx = -0.12; armRx = 0.12;
    }
  }
  // modelState 覆盖
  if (ms.spinning || ms.axeSpin) {
    st.spin = (st.spin || 0) + dt * (ms.spinning ? 16 : 11);
    bodyRotY = st.spin;
    armRz = 1.57; armRx = 0.2; armLz = 1.3; armLx = -0.3;
  } else st.spin = 0;
  if (ms.meditating) { legLz = 1.4; legRz = 1.4; bodyY = -H * 0.28; armLz = 0.6; armRz = 0.6; armLx = -0.9; armRx = 0.9; lean = 0; }
  // 应用
  rig.legL.pivot.rotation.z = legLz;
  rig.legR.pivot.rotation.z = legRz;
  rig.armL.pivot.rotation.set(armLx, 0, armLz);
  rig.armR.pivot.rotation.set(armRx, 0, armRz);
  rig.hips.position.y = rig.hips.userData.baseY + bodyY;
  rig.chest.rotation.set(0, chestY, lean);
  rig.head.rotation.z = headZ;
  rig.body.rotation.y = bodyRotY;
  // 呼吸
  rig.chest.scale.y = 1 + Math.sin(time * 2.2) * 0.012;
  // 尾巴摆动
  for (let i = 0; i < rig.tails.length; i++) {
    const p = rig.tails[i];
    p.rotation.x = p.userData.baseX + Math.sin(time * 2 + i) * 0.12;
    p.rotation.z = 0.9 + Math.sin(time * 1.6 + i * 0.7) * 0.1 + (state === 'run' ? 0.35 : 0);
  }
  // 死亡：向后倒下并下沉
  if (st.dead) {
    st.deadT += dt;
    const k = Math.min(1, st.deadT / 0.55);
    bodyTilt = (1 - (1 - k) * (1 - k)) * 1.45;
    rig.body.rotation.z = bodyTilt;
    rig.body.position.y = -Math.max(0, st.deadT - 1.2) * 30;
  } else {
    rig.body.rotation.z = 0;
    rig.body.position.y = 0;
  }
  // 武器发光
  const glowOn = !!(ms.swordGlow || ms.axeGlow || ms.noxianMight || ms.highlander || ms.wuju || ms.flurry || ms.foxFire || ms.spiritRush);
  for (const m of rig.weapon.glow || []) {
    const base = m.userData.baseEmissiveIntensity || 0;
    const target = glowOn ? Math.max(base, 1.4) : base;
    m.emissiveIntensity += (target - m.emissiveIntensity) * Math.min(1, dt * 8);
  }
  // 金克丝换枪
  if (rig.weapon.minigun) {
    const rocket = ms.weapon === 'rocket';
    rig.weapon.minigun.visible = !rocket;
    rig.weapon.rocket.visible = rocket;
  }
  // 锤石灯笼 / 安妮熊
  if (rig.weapon.lantern) rig.weapon.lantern.visible = !ms.lanternOut;
  if (rig.spec.weapon === 'bear' && rig.weapon.main) rig.weapon.main.visible = !ms.tibbersOut;
}

// —— 视图 ——
export function createChampionView(entity, renderer) {
  const isPet = entity.type === 'pet';
  const id = isPet ? entity.modelId : (entity.championId || entity.modelId);
  let rig;
  if (isPet && (id === 'tibbers' || /tibbers/.test(id || ''))) rig = buildTibbers();
  else if (isPet) rig = buildHumanoid(id, { model: { primary: 0x555566, secondary: 0x333333, accent: 0x99ccff } }, { ...DEFAULT_SPEC, H: 160 });
  else rig = buildHumanoid(id, CHAMPIONS[id] || entity.def, SPEC[id] || DEFAULT_SPEC);
  rig.hips.userData.baseY = rig.hips.position.y;
  const st = { time: Math.random() * 10, dead: !entity.alive, deadT: entity.alive ? 0 : 10, spin: 0, opacity: 1, highlight: null };
  const mats = rig.mats.list;
  let hidden = false;
  return {
    object3d: rig.root,
    height: rig.H,
    update(dt, e) {
      const hide = !!e.modelState?.hidden;
      if (hide !== hidden) { hidden = hide; rig.body.visible = !hide; }
      animate(rig, dt, e, st);
    },
    onDeath() { st.dead = true; st.deadT = 0; },
    onRespawn() { st.dead = false; st.deadT = 0; },
    setHighlight(color) {
      st.highlight = color;
      for (const m of mats) {
        if (color == null) { m.emissive.setHex(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseEmissiveIntensity; }
        else { m.emissive.setHex(color); m.emissiveIntensity = Math.max(0.28, m.userData.baseEmissiveIntensity); }
      }
    },
    setOpacity(a) {
      st.opacity = a;
      for (const m of mats) {
        const o = a * (m.userData.baseOpacity ?? 1);
        m.transparent = o < 1;
        m.opacity = o;
      }
    },
    dispose() {
      rig.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of mats) m.dispose();
    },
  };
}

// —— 头像（离屏渲染半身像，缓存 dataURL） ——
const portraitCache = new Map();
let portraitRenderer = null;

function fallbackPortrait(championId, size) {
  const def = CHAMPIONS[championId];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const bg = def?.portrait?.bg || ['#444', '#111'];
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `900 ${Math.round(size * 0.55)}px 'Noto Serif SC', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def?.portrait?.glyph || def?.name?.[0] || '?', size / 2, size * 0.54);
  return c.toDataURL('image/png');
}

export async function renderChampionPortrait(championId, size = 256) {
  const key = `${championId}@${size}`;
  if (portraitCache.has(key)) return portraitCache.get(key);
  const p = (async () => {
    try {
      const def = CHAMPIONS[championId];
      if (!def) return fallbackPortrait(championId, size);
      if (!portraitRenderer) {
        portraitRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        portraitRenderer.outputColorSpace = THREE.SRGBColorSpace;
        portraitRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        portraitRenderer.setPixelRatio(1);
      }
      const r = portraitRenderer;
      r.setSize(size, size, false);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdde8ff, 0x302820, 1.4));
      const key1 = new THREE.DirectionalLight(0xfff0dc, 2.6);
      key1.position.set(300, 300, 250);
      scene.add(key1);
      const rim = new THREE.DirectionalLight(0x9ac8ff, 1.6);
      rim.position.set(-300, 200, -300);
      scene.add(rim);
      const rig = buildHumanoid(championId, def, SPEC[championId] || DEFAULT_SPEC);
      rig.hips.userData.baseY = rig.hips.position.y;
      animate(rig, 0.016, { anim: { state: 'idle', t: 0 }, modelState: {} }, { time: 0.4, dead: false, deadT: 0 });
      rig.root.rotation.y = -0.45; // 略侧身朝向镜头
      scene.add(rig.root);
      const H = rig.H;
      const cam = new THREE.PerspectiveCamera(30, 1, 10, 5000);
      const headY = H * 0.86;
      cam.position.set(H * 1.25, headY + H * 0.02, H * 0.25);
      cam.lookAt(0, headY - H * 0.08, 0);
      r.setClearColor(0x000000, 0);
      r.render(scene, cam);
      const shot = r.domElement;
      // 合成背景渐变
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const bg = def.portrait?.bg || ['#444', '#111'];
      const g = ctx.createRadialGradient(size * 0.5, size * 0.35, size * 0.05, size * 0.5, size * 0.5, size * 0.75);
      g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(shot, 0, 0, size, size);
      const url = c.toDataURL('image/png');
      rig.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of rig.mats.list) m.dispose();
      return url;
    } catch (err) {
      console.warn('[头像] 渲染失败，使用后备头像：', err);
      return fallbackPortrait(championId, size);
    }
  })();
  portraitCache.set(key, p);
  return p;
}
