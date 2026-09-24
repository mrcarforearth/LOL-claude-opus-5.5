// 盖伦专属特效：审判（金色旋风 + 刀光跟随 + 火花扬尘）、德玛西亚正义（天降巨剑 + 光柱 + 符文圈 + 冲击波 + 裂地）
// 只依赖契约 FXContext（THREE / toScene / heightAt / add / particles / textures / renderer），全部防御式调用
const NOOP = Object.freeze({ remove() {}, alive: false, object3d: null });
const TAU = Math.PI * 2;

const GOLD = 0xffc94d;
const GOLD_HOT = 0xfff0b8;
const GOLD_DEEP = 0xd8a038;
const WHITE = 0xffffff;
const STEEL = 0xfff7e2;
const DEMACIA = 0x2d4c94;
const GEM = 0x9fd4ff;
const DUST = 0xc9b58c;
const R_HIT = 0.435;          // 与 js/champions/garen.js 中 R 的 castTime 一致：巨剑落地时刻
const R_TOTAL = R_HIT + 1.05;
const SWORD_LEN = 520;        // 剑身长度（剑尖在本地 -Y）
const SWORD_SINK = 110;       // 插入地面深度

// —— 纹理（程序生成，缓存） ——
const TEX = {};
function canvasTex(ctx, key, w, h, draw, repeatX = false) {
  if (TEX[key]) return TEX[key];
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const T = ctx.THREE;
  const t = new T.CanvasTexture(cv);
  if (repeatX) { t.wrapS = T.RepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; }
  TEX[key] = t;
  return t;
}
function glowTex(ctx) {
  if (ctx.textures?.glow) return ctx.textures.glow;
  return canvasTex(ctx, 'glow', 64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  });
}
// 旋风条纹：横向拉丝 + 上下渐隐（贴在圆台侧面，u 绕圈、v 沿高度）
function streakTex(ctx) {
  return canvasTex(ctx, 'streak', 256, 128, (g, w, h) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const y = rnd() * h, len = 40 + rnd() * 150, x = rnd() * w, th = 1 + rnd() * 3.5;
      const grd = g.createLinearGradient(x, 0, x + len, 0);
      const a = 0.35 + rnd() * 0.65;
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.8, `rgba(255,255,255,${a})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x, y, len, th);
      if (x + len > w) g.fillRect(x - w, y, len, th);   // 横向无缝
    }
    g.globalCompositeOperation = 'destination-in';
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.3, 'rgba(0,0,0,1)');
    v.addColorStop(0.75, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
  }, true);
}

// —— 几何体（单位尺寸，缓存共享） ——
const GEO = new Map();
function geo(ctx, key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(ctx.THREE); GEO.set(key, g); }
  return g;
}
// 平面弧带（本地 XY = 游戏平面）：顶点色从尾部（角度 0）暗到头部（角度 theta）亮
function arcBand(T, r0, r1, theta, segs = 64, power = 1.7) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs, a = k * theta, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r0, s * r0, 0, c * r1, s * r1, 0);
    const v = Math.pow(k, power);
    col.push(v * 0.5, v * 0.5, v * 0.5, v, v, v);
    if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
// 竖直弧面（世界 Y 向上；角度按游戏平面：x=cos，场景 z=-sin），沿角度渐亮
function ribbon(T, r, h0, h1, theta, segs = 48, power = 2) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs, a = k * theta, c = Math.cos(a) * r, s = -Math.sin(a) * r;
    pos.push(c, h0, s, c, h1, s);
    const v = Math.pow(k, power);
    col.push(v * 0.35, v * 0.35, v * 0.35, v, v, v);
    if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
// 光柱：底部亮、顶部透明（单位半径/高度）
function pillarGeo(T) {
  const g = new T.CylinderGeometry(0.7, 1, 1, 28, 6, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = Math.pow(1 - p.getY(i), 1.4);
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  return g;
}
// 竖直拖尾片：底部亮、向上渐隐
function trailGeo(T) {
  const g = new T.PlaneGeometry(1, 1, 1, 4);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = Math.pow(1 - p.getY(i), 2) * (1 - Math.abs(p.getX(i)) * 1.2);
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  return g;
}

// —— 材质（每个特效实例独立，结束时统一释放；toneMapped:false 让金光更亮） ——
function mat(ctx, color, opacity, { additive = true, vc = false, map = null, side = null } = {}) {
  const T = ctx.THREE;
  return new T.MeshBasicMaterial({
    color, opacity, transparent: true, depthWrite: false, vertexColors: vc, map,
    side: side ?? T.DoubleSide, blending: additive ? T.AdditiveBlending : T.NormalBlending, toneMapped: false,
  });
}
function spriteOf(ctx, color, size, opacity = 1) {
  const T = ctx.THREE;
  const s = new T.Sprite(new T.SpriteMaterial({
    map: glowTex(ctx), color, opacity, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
  }));
  s.scale.set(size, size, 1);
  return s;
}

// —— 工具 ——
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (k) => 1 - (1 - k) * (1 - k);
function groundH(ctx, x, y) {
  try { const h = ctx.heightAt?.(x, y); return Number.isFinite(h) ? h : 0; } catch { return 0; }
}
function posOf(ctx, u) {
  try {
    const p = ctx.renderer?.renderPos?.(u);
    if (p && Number.isFinite(p.x)) return p;
  } catch { /* 忽略 */ }
  return { x: u.x, y: u.y, z: u.z || 0 };
}
function shownOf(ctx, u) {
  try { return typeof ctx.renderer?.isShown === 'function' ? ctx.renderer.isShown(u) : true; } catch { return true; }
}
function place(ctx, obj, x, y, h) {
  const v = ctx.toScene(x, y, h);
  obj.position.set(v.x, v.y, v.z);
}
// 挂到场景；结束时释放本实例材质（几何体/纹理为共享缓存，不释放）
function launch(ctx, obj, opts) {
  const mats = new Set();
  obj.traverse((o) => { if (o.material) mats.add(o.material); });
  const onEnd = opts.onEnd;
  const h = ctx.add(obj, {
    ...opts,
    onEnd: () => {
      for (const m of mats) m.dispose?.();
      if (onEnd) onEnd();
    },
  });
  return h || NOOP;
}
// 统一透明度控制：记录每个材质的基础透明度，按系数缩放
function fader(root) {
  const list = [];
  root.traverse((o) => { if (o.material && !list.some((e) => e.m === o.material)) list.push({ m: o.material, base: o.material.opacity }); });
  return (k) => { for (const e of list) e.m.opacity = e.base * k; };
}
function particles(ctx, o) {
  try { ctx.particles?.(o); } catch { /* 粒子系统不可用时忽略 */ }
}
function setOrder(root, order) { root.traverse((o) => { if (o.isMesh || o.isSprite) o.renderOrder = order; }); }

// ——————————————————— E：审判（金色旋风） ———————————————————
function eSpin(ctx, p) {
  const T = ctx.THREE;
  const u = p.unit;
  if (!u) return NOOP;
  const R = Number(p.radius) > 0 ? Number(p.radius) : 325;
  const dur = Number(p.duration) > 0 ? Number(p.duration) : 3;
  // 每转一圈结算一次伤害：转速与伤害次数一致
  let ticks = 7;
  try { ticks = u.getBuff?.('garen_e_spin')?.data?.ticks || 7; } catch { /* 默认 7 */ }
  const omega = (TAU * ticks) / dur;

  const root = new T.Group();
  root.name = 'garen_e_spin';

  // 1) 地面旋涡：两条金色弧带 + 半径外圈 + 中心辉光
  const ground = new T.Group();
  ground.position.y = 5;
  const swirlGeo = geo(ctx, 'e_swirl', (TT) => arcBand(TT, 0.28, 0.97, Math.PI * 1.2, 72, 1.8));
  const swirlMat = mat(ctx, GOLD, 0.5, { vc: true });
  for (let k = 0; k < 2; k++) {
    const m = new T.Mesh(swirlGeo, swirlMat);
    m.rotation.z = k * Math.PI;
    m.scale.set(R, R, 1);
    ground.add(m);
  }
  const edge = new T.Mesh(geo(ctx, 'e_edge', (TT) => new TT.RingGeometry(0.955, 1, 96)), mat(ctx, GOLD_DEEP, 0.32));
  edge.scale.set(R, R, 1);
  ground.add(edge);
  const glow = new T.Mesh(geo(ctx, 'plane2', (TT) => new TT.PlaneGeometry(2, 2)), mat(ctx, GOLD, 0.28, { map: glowTex(ctx) }));
  glow.scale.set(R * 0.9, R * 0.9, 1);
  ground.add(glow);
  root.add(ground);

  // 2) 刀光：剑刃高度的水平弧光 + 白色刃口 + 竖直光幕（跟随剑的挥动）
  const blade = new T.Group();
  blade.position.y = 105;
  const bladeArc = new T.Mesh(geo(ctx, 'e_blade', (TT) => arcBand(TT, 70, 215, Math.PI * 0.95, 56, 1.5)), mat(ctx, GOLD_HOT, 0.85, { vc: true }));
  const bladeEdge = new T.Mesh(geo(ctx, 'e_bedge', (TT) => arcBand(TT, 198, 224, Math.PI * 0.8, 48, 2.2)), mat(ctx, WHITE, 0.95, { vc: true }));
  blade.add(bladeArc, bladeEdge);
  root.add(blade);
  const sheet = new T.Group();
  const sheetMesh = new T.Mesh(geo(ctx, 'e_sheet', (TT) => ribbon(TT, 212, 55, 150, Math.PI * 0.75, 40, 2.2)), mat(ctx, GOLD, 0.5, { vc: true }));
  sheet.add(sheetMesh);
  root.add(sheet);

  // 3) 旋风：内外两层拉丝圆台，转速不同
  const sTex = streakTex(ctx);
  const cone = geo(ctx, 'e_cone', (TT) => { const g = new TT.CylinderGeometry(1, 0.62, 1, 40, 1, true); g.translate(0, 0.5, 0); return g; });
  const innerMat = mat(ctx, GOLD_HOT, 0.3, { map: sTex });
  const outerMat = mat(ctx, GOLD, 0.2, { map: sTex });
  const inner = new T.Mesh(cone, innerMat);
  inner.scale.set(R * 0.62, 240, R * 0.62);
  const outer = new T.Mesh(cone, outerMat);
  outer.scale.set(R * 0.95, 150, R * 0.95);
  root.add(inner, outer);
  setOrder(root, 31);
  ground.traverse((o) => { if (o.isMesh) o.renderOrder = 30; });

  const setFade = fader(root);
  let ang = 0, last = 0, endAt = null, sparkT = 0, dustT = 0;
  const handle = launch(ctx, root, {
    duration: dur + 0.8,
    update: (t, dt, age) => {
      const a = Number.isFinite(age) ? age : t * (dur + 0.8);
      const d = Math.max(0, Math.min(0.1, Number.isFinite(dt) && dt > 0 ? dt : a - last));
      last = a;
      // 结束条件：到期 / 阵亡 / 提前再次施放（模型状态 spinning 被英雄代码清除）
      let spinning = true;
      try { spinning = !(a > 0.2 && (u.modelState?.spinning === false || (u.hasBuff && !u.hasBuff('garen_e_spin')))); } catch { /* 忽略 */ }
      if (endAt == null && (a >= dur || !u.alive || u.removed || !spinning)) endAt = a;
      const fin = clamp01(a / 0.12);
      const fout = endAt == null ? 1 : 1 - clamp01((a - endAt) / 0.28);
      if (fout <= 0) return false;
      const pos = posOf(ctx, u);
      place(ctx, root, pos.x, pos.y, groundH(ctx, pos.x, pos.y) + Math.max(0, pos.z || 0) * 0.6);
      root.visible = shownOf(ctx, u);
      ang += omega * d * (endAt == null ? 1 : 0.6);
      const flicker = 0.88 + 0.12 * Math.sin(a * 37);
      setFade(fin * fout * flicker);
      ground.rotation.set(-Math.PI / 2, 0, ang);
      blade.rotation.set(-Math.PI / 2, 0, ang + 0.35);
      sheet.rotation.y = ang + 0.35;
      inner.rotation.y = ang * 0.8;
      outer.rotation.y = -ang * 0.35 + 1.3;
      const breathe = 1 + 0.05 * Math.sin(a * 9);
      inner.scale.set(R * 0.62 * breathe, 240 * (0.85 + 0.15 * fin), R * 0.62 * breathe);
      // 火花（剑尖切线方向）与扬尘
      if (endAt == null && root.visible) {
        sparkT -= d; dustT -= d;
        if (sparkT <= 0) {
          sparkT = 0.07;
          const tip = ang + 0.35 + Math.PI * 0.95;
          particles(ctx, {
            x: pos.x + Math.cos(tip) * 205, y: pos.y + Math.sin(tip) * 205, h: 105, count: 3, color: GOLD_HOT,
            size: 20, speed: 360, spread: 0.9, life: 0.4, gravity: 420, drag: 1.4, additive: true, shape: 'spark',
          });
        }
        if (dustT <= 0) {
          dustT = 0.16;
          const da = ang + Math.random() * TAU;
          particles(ctx, {
            x: pos.x + Math.cos(da) * R * 0.75, y: pos.y + Math.sin(da) * R * 0.75, h: 12, count: 2, color: DUST,
            size: 80, speed: 110, spread: 1, life: 0.75, gravity: -30, drag: 2, additive: false, shape: 'smoke',
          });
        }
      }
      return true;
    },
  });
  return handle;
}

// ——————————————————— R：德玛西亚正义（天降巨剑） ———————————————————
function buildSword(ctx) {
  const T = ctx.THREE;
  const g = new T.Group();
  const blade = geo(ctx, 'r_blade', (TT) => {
    const s = new TT.Shape();
    s.moveTo(-36, 0); s.lineTo(36, 0); s.lineTo(30, -410); s.lineTo(0, -SWORD_LEN); s.lineTo(-30, -410); s.closePath();
    const e = new TT.ExtrudeGeometry(s, { depth: 10, bevelEnabled: true, bevelThickness: 5, bevelSize: 4, bevelSegments: 1 });
    e.translate(0, 0, -5);
    return e;
  });
  const fuller = geo(ctx, 'r_fuller', (TT) => {
    const s = new TT.Shape();
    s.moveTo(-7, -24); s.lineTo(7, -24); s.lineTo(4, -400); s.lineTo(0, -430); s.lineTo(-4, -400); s.closePath();
    return new TT.ShapeGeometry(s);
  });
  const bladeMesh = new T.Mesh(blade, mat(ctx, STEEL, 1, { additive: false }));
  const fullerF = new T.Mesh(fuller, mat(ctx, GOLD, 0.95));
  fullerF.position.z = 11;
  const fullerB = new T.Mesh(fuller, fullerF.material);
  fullerB.position.z = -11;
  fullerB.rotation.y = Math.PI;
  const guardMat = mat(ctx, GOLD_DEEP, 1, { additive: false });
  const guard = new T.Mesh(geo(ctx, 'r_guard', (TT) => new TT.BoxGeometry(236, 30, 36)), guardMat);
  guard.position.y = 15;
  const tipGeo = geo(ctx, 'r_gtip', (TT) => new TT.ConeGeometry(20, 50, 4));
  const tipL = new T.Mesh(tipGeo, guardMat);
  tipL.position.set(-138, 26, 0); tipL.rotation.z = Math.PI / 2 - 0.5;
  const tipR = new T.Mesh(tipGeo, guardMat);
  tipR.position.set(138, 26, 0); tipR.rotation.z = -Math.PI / 2 + 0.5;
  const gemGeo = geo(ctx, 'r_gem', (TT) => new TT.OctahedronGeometry(17));
  const gemMat = mat(ctx, GEM, 1);
  const gemF = new T.Mesh(gemGeo, gemMat);
  gemF.position.set(0, 15, 20);
  const gemB = new T.Mesh(gemGeo, gemMat);
  gemB.position.set(0, 15, -20);
  const grip = new T.Mesh(geo(ctx, 'r_grip', (TT) => new TT.CylinderGeometry(13, 15, 112, 10)), mat(ctx, DEMACIA, 1, { additive: false }));
  grip.position.y = 30 + 56;
  const pommel = new T.Mesh(geo(ctx, 'r_pommel', (TT) => new TT.SphereGeometry(25, 14, 10)), guardMat);
  pommel.position.y = 30 + 112 + 18;
  g.add(bladeMesh, fullerF, fullerB, guard, tipL, tipR, gemF, gemB, grip, pommel);
  // 剑身光晕
  const halos = [];
  for (let i = 0; i < 5; i++) {
    const s = spriteOf(ctx, i === 0 ? GOLD_HOT : GOLD, 300 - i * 30, 0.5);
    s.position.set(0, -40 - i * 105, 0);
    g.add(s);
    halos.push(s);
  }
  // 下落拖尾（竖直光幕，位于剑柄上方）
  const trail = new T.Mesh(geo(ctx, 'r_trail', trailGeo), mat(ctx, GOLD, 0.6, { vc: true }));
  trail.scale.set(95, 950, 1);
  trail.position.y = 150;
  g.add(trail);
  return { group: g, halos, trail };
}

function rSword(ctx, p) {
  const T = ctx.THREE;
  const tgt = p.target || null;
  let x = Number.isFinite(p.x) ? p.x : tgt?.x;
  let y = Number.isFinite(p.y) ? p.y : tgt?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NOOP;

  const root = new T.Group();
  root.name = 'garen_r_sword';

  // 天空光柱（外层金色 + 内核白光）
  const pGeo = geo(ctx, 'r_pillar', pillarGeo);
  const pillar = new T.Mesh(pGeo, mat(ctx, GOLD, 0.55, { vc: true }));
  const core = new T.Mesh(pGeo, mat(ctx, WHITE, 0.7, { vc: true }));
  pillar.renderOrder = 32; core.renderOrder = 33;
  root.add(pillar, core);

  // 地面符文圈（外环 + 12 段虚线环 + 辉光），落剑前收缩
  const rune = new T.Group();
  rune.position.y = 4;
  const ringMat = mat(ctx, GOLD, 0.8);
  const ring = new T.Mesh(geo(ctx, 'r_ring', (TT) => new TT.RingGeometry(0.93, 1, 96)), ringMat);
  rune.add(ring);
  const dashGeo = geo(ctx, 'r_dash', (TT) => new TT.RingGeometry(0.74, 0.83, 6, 1, 0, TAU / 26));
  const dashMat = mat(ctx, GOLD_HOT, 0.75);
  const dashes = new T.Group();
  for (let i = 0; i < 12; i++) {
    const m = new T.Mesh(dashGeo, dashMat);
    m.rotation.z = (i / 12) * TAU;
    dashes.add(m);
  }
  rune.add(dashes);
  const runeGlow = new T.Mesh(geo(ctx, 'plane2', (TT) => new TT.PlaneGeometry(2, 2)), mat(ctx, GOLD, 0.4, { map: glowTex(ctx) }));
  rune.add(runeGlow);
  rune.traverse((o) => { if (o.isMesh) o.renderOrder = 30; });
  root.add(rune);

  // 巨剑
  const sword = buildSword(ctx);
  sword.group.traverse((o) => { if (o.isMesh || o.isSprite) o.renderOrder = 34; });
  root.add(sword.group);

  // 命中后：冲击波（金 + 白）、裂地光纹、闪光
  const shock = new T.Group();
  shock.position.y = 6;
  shock.visible = false;
  const wave1 = new T.Mesh(geo(ctx, 'r_wave1', (TT) => new TT.RingGeometry(0.82, 1, 96)), mat(ctx, GOLD, 0.9));
  const wave2 = new T.Mesh(geo(ctx, 'r_wave2', (TT) => new TT.RingGeometry(0.9, 1, 96)), mat(ctx, WHITE, 0.9));
  shock.add(wave1, wave2);
  const cracks = new T.Group();
  const crackMat = mat(ctx, GOLD_HOT, 0.9);
  const crackGeo = geo(ctx, 'r_crack', (TT) => { const g = new TT.PlaneGeometry(1, 1); g.translate(0.5, 0, 0); return g; });
  for (let i = 0; i < 11; i++) {
    const m = new T.Mesh(crackGeo, crackMat);
    const len = 150 + Math.random() * 190;
    m.scale.set(len, 10 + Math.random() * 8, 1);
    m.rotation.z = (i / 11) * TAU + (Math.random() - 0.5) * 0.4;
    m.position.set(Math.cos(m.rotation.z) * 40, Math.sin(m.rotation.z) * 40, 0);
    cracks.add(m);
  }
  shock.add(cracks);
  shock.traverse((o) => { if (o.isMesh) o.renderOrder = 31; });
  root.add(shock);
  const flash = spriteOf(ctx, GOLD_HOT, 10, 1);
  flash.visible = false;
  flash.renderOrder = 40;
  root.add(flash);

  const H_END = SWORD_LEN - SWORD_SINK;   // 落地时剑格离地高度
  const H_START = H_END + 1500;
  const fadeSword = fader(sword.group);
  let hit = false, fx0 = x, fy0 = y;
  const handle = launch(ctx, root, {
    duration: R_TOTAL,
    update: (t, dt, age) => {
      const a = Number.isFinite(age) ? age : t * R_TOTAL;
      // 落剑前跟随目标
      if (!hit && tgt && tgt.alive !== false && !tgt.removed) {
        const pp = posOf(ctx, tgt);
        fx0 = pp.x; fy0 = pp.y;
      }
      const gh = groundH(ctx, fx0, fy0);
      place(ctx, root, fx0, fy0, gh);
      const k = clamp01(a / R_HIT);
      // 光柱：渐显 → 命中时闪亮 → 渐隐
      let pk;
      if (a < R_HIT) pk = 0.35 + 0.65 * k;
      else pk = 1.4 * (1 - clamp01((a - R_HIT) / 0.7));
      const pw = a < R_HIT ? 0.8 + 0.25 * k : 1.25 + 0.6 * clamp01((a - R_HIT) / 0.2);
      pillar.scale.set(82 * pw, 2000, 82 * pw);
      core.scale.set(22 * pw, 2000, 22 * pw);
      pillar.material.opacity = 0.26 * Math.max(0, pk);
      core.material.opacity = 0.32 * Math.max(0, pk);
      // 符文圈
      const rs = a < R_HIT ? 330 - 150 * easeOut(k) : 180 + 120 * clamp01((a - R_HIT) / 0.3);
      rune.scale.set(rs, rs, 1);
      rune.rotation.set(-Math.PI / 2, 0, a * 2.4);
      dashes.rotation.z = -a * 5;
      const ro = a < R_HIT ? clamp01(a / 0.1) : 1 - clamp01((a - R_HIT) / 0.3);
      ringMat.opacity = 0.8 * ro; dashMat.opacity = 0.75 * ro; runeGlow.material.opacity = 0.4 * ro;
      // 巨剑下落（加速）→ 插地停留 → 渐隐
      if (a < R_HIT) {
        const hk = Math.pow(k, 2.2);
        sword.group.position.y = H_START - (H_START - H_END) * hk;
        const sc = 0.72 + 0.28 * k;
        sword.group.scale.set(sc, sc, sc);
        sword.group.rotation.set(0, (1 - k) * (1 - k) * 2.2, 0);
        fadeSword(clamp01(a / 0.08));
        sword.trail.material.opacity = 0.6 * (0.4 + 0.6 * k) * clamp01(a / 0.08);
      } else {
        const after = a - R_HIT;
        sword.group.position.y = H_END - Math.min(18, after * 60);
        sword.group.scale.set(1, 1, 1);
        sword.group.rotation.set(0, 0, 0);
        const so = after < 0.5 ? 1 : 1 - clamp01((after - 0.5) / 0.4);
        fadeSword(so);
        sword.trail.material.opacity = 0.6 * (1 - clamp01(after / 0.12));
        for (const h of sword.halos) h.material.opacity = 0.5 * so * (1 + 0.8 * (1 - clamp01(after / 0.3)));
      }
      // 命中瞬间
      if (!hit && a >= R_HIT) {
        hit = true;
        shock.visible = true;
        flash.visible = true;
        particles(ctx, { x: fx0, y: fy0, h: 40, count: 48, color: GOLD_HOT, size: 26, speed: 850, spread: 1, life: 0.7, gravity: 950, drag: 1.2, additive: true, shape: 'spark' });
        particles(ctx, { x: fx0, y: fy0, h: 20, count: 16, color: DUST, size: 130, speed: 280, spread: 1, life: 1.0, gravity: -40, drag: 2.2, additive: false, shape: 'smoke' });
        particles(ctx, { x: fx0, y: fy0, h: 30, count: 22, color: GOLD, size: 18, speed: 140, spread: 0.5, life: 1.1, gravity: -260, drag: 0.8, additive: true, shape: 'soft' });
        try {
          const cam = ctx.renderer?.cameraCtl;
          if (cam && typeof cam.shake === 'function' && cam.target) {
            const dist = Math.hypot(cam.target.x - fx0, cam.target.y - fy0);
            if (dist < 2400) cam.shake(26 * (1 - dist / 2800), 0.4);
          }
        } catch { /* 忽略 */ }
      }
      if (hit) {
        const kk = clamp01((a - R_HIT) / 0.5);
        const s1 = 60 + 480 * easeOut(kk), s2 = 40 + 380 * easeOut(clamp01((a - R_HIT) / 0.35));
        wave1.scale.set(s1, s1, 1);
        wave2.scale.set(s2, s2, 1);
        wave1.material.opacity = 0.9 * (1 - kk);
        wave2.material.opacity = 0.9 * (1 - clamp01((a - R_HIT) / 0.35));
        shock.rotation.set(-Math.PI / 2, 0, 0);
        const ck = clamp01((a - R_HIT) / 0.95);
        crackMat.opacity = 0.9 * (1 - ck * ck);
        cracks.scale.setScalar(0.6 + 0.4 * easeOut(clamp01((a - R_HIT) / 0.15)));
        const fk = clamp01((a - R_HIT) / 0.3);
        const fs = 750 * (1 - fk * 0.4);
        flash.scale.set(fs, fs, 1);
        flash.position.y = 90;
        flash.material.opacity = 1 - fk;
      }
      return true;
    },
  });
  return handle;
}

let errShown = 0;
export default function register(fx) {
  const on = (name, fn) => fx.registerCustom(name, (ctx, p) => {
    try { return (ctx && ctx.THREE && typeof ctx.add === 'function' ? fn(ctx, p || {}) : NOOP) || NOOP; } catch (err) {
      if (errShown++ < 3) console.error(`[champfx:garen] ${name}`, err);
      return NOOP;
    }
  });
  on('garen_e_spin', eSpin);
  on('garen_r_sword', rSword);
}
