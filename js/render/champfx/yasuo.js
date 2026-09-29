// 亚索专属特效：斩钢闪突刺/龙卷风（旋转风柱）/环形斩、旋风就绪、风之障壁（前推的半透明风墙）、踏前斩风痕、剑意护盾、狂风绝息斩（滞空连斩）
import {
  NOOP, TAU, rnd, env, easeOut3, geo, mat, mesh, sprite, sectorGeo, sphereGeo, customTex,
  place, flat, stick, upos, unitH, alive, shown, seen, gh, launch, burst, decal, ring, shock, flash, pillar,
  unitTrail, ghost, projView, registrar, shake, low,
} from './_kit.js';

const WIND = 0x9fe8ff;
const WIND_HOT = 0xe8fbff;
const STEEL = 0xdfeeff;
const DEEP = 0x3a7ac8;
const R_BLUE = 0x6ab8ff;

// 竖向风纹纹理（风墙/龙卷风用）：横向条纹 + 上下渐隐
function windTex(ctx) {
  return customTex(ctx, 'yasuo_wind', 128, (g, s) => {
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const y = Math.random() * s, w = s * (0.3 + Math.random() * 0.6), x = Math.random() * (s - w);
      const a = 0.25 + Math.random() * 0.55;
      const gr = g.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x, y, w, 2 + Math.random() * 3);
    }
    const v = g.createLinearGradient(0, 0, 0, s);
    v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.2, 'rgba(0,0,0,0)'); v.addColorStop(0.8, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = v; g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'source-over';
  });
}
function windMat(ctx, color, opacity) {
  const m = mat(ctx, color, opacity, { map: windTex(ctx) });
  const tex = m.map.clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = ctx.THREE.RepeatWrapping;
  m.map = tex;
  m.userData.ownTex = tex;
  return m;
}
// 释放 windMat 克隆的纹理
function freeTex(root) {
  root?.traverse?.((o) => { const t = o.material?.userData?.ownTex; if (t) { t.dispose?.(); o.material.userData.ownTex = null; } });
}

// —— Q：突刺（钢芒直线 + 剑尖火花） ——
function qThrust(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const len = p.length || 450, a = Math.atan2(p.dirY || 0, p.dirX || 1);
  const team = u?.team;
  if (!seen(ctx, q.x, q.y, team) && !(u && shown(ctx, u))) return NOOP;
  const T = ctx.THREE;
  const root = new T.Group();
  const bladeG = geo(ctx, 'yasuo_thrust', (TT) => { const g = new TT.PlaneGeometry(1, 1); g.translate(0.5, 0, 0); return g; });
  const core = mesh(ctx, bladeG, mat(ctx, WIND_HOT, 0.95));
  const glow = mesh(ctx, bladeG, mat(ctx, p.tornado ? WIND : STEEL, 0.5));
  flat(core); flat(glow);
  root.add(glow, core);
  place(ctx, root, q.x, q.y, 70);
  root.rotation.y = a;
  const h = unitH(ctx, u, 0.4);
  root.position.y += h - 70;
  const tipX = q.x + (p.dirX || 1) * len, tipY = q.y + (p.dirY || 0) * len;
  burst(ctx, { x: tipX, y: tipY, h, count: 10, color: STEEL, color2: WIND, speed: 380, size: 18, life: 0.3, dir: a, arc: 0.8, up: 0.2, team });
  decal(ctx, { x: (q.x + tipX) / 2, y: (q.y + tipY) / 2, radius: len * 0.5, color: WIND, opacity: 0.35, duration: 0.3, angle: a, grow: [0.6, 1], team });
  if ((p.stack || 0) >= 1) ring(ctx, { x: q.x, y: q.y, radius: 120, color: WIND, duration: 0.35, team });
  return launch(ctx, root, {
    duration: 0.24, tag: 'yasuo_q_thrust',
    update: (t) => {
      const k = easeOut3(Math.min(1, t * 2.2));
      core.scale.set(len * k, 10 * (1 - t) + 2, 1);
      glow.scale.set(len * k, 46 * (1 - t * 0.7), 1);
      core.material.opacity = 0.95 * (1 - t);
      glow.material.opacity = 0.5 * (1 - t);
    },
  });
}

// —— Q3：龙卷风投射物（多层旋转风锥 + 卷起的尘土） ——
function tornadoProj(ctx, p) {
  const T = ctx.THREE;
  const size = p.vfx?.size || 1.2;
  const root = new T.Group();
  const coneG = geo(ctx, 'yasuo_tornado', (TT) => { const g = new TT.CylinderGeometry(1, 0.28, 1, 24, 4, true); g.translate(0, 0.5, 0); return g; });
  const layers = [];
  for (let i = 0; i < 3; i++) {
    const m = mesh(ctx, coneG, windMat(ctx, i === 1 ? WIND_HOT : WIND, i === 1 ? 0.5 : 0.7));
    const r = (95 - i * 20) * size, h = (300 - i * 40) * size;
    m.scale.set(r, h, r);
    m.position.y = -90 + i * 8;
    root.add(m);
    layers.push(m);
  }
  const base = sprite(ctx, WIND, 240 * size, 0.35);
  base.position.y = -70;
  root.add(base);
  let dust = 0;
  return projView(ctx, p, root, {
    tag: 'yasuo_q_tornado', face: false,
    trail: { color: WIND, color2: DEEP, width: 120 * size, seg: 26, max: 14, fade: 0.35, dh: -60, skipLow: true },
    update: (dt, proj, cur, age) => {
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        L.rotation.y += dt * (9 + i * 4) * (i % 2 ? -1 : 1);
        L.material.map.offset.x += dt * (1.6 + i * 0.7);
        L.material.map.offset.y -= dt * 0.8;
      }
      base.material.opacity = 0.3 + 0.1 * Math.sin(age * 20);
      dust -= dt;
      if (dust <= 0 && cur.vis && !low(ctx)) {
        dust = 0.06;
        burst(ctx, { x: cur.x, y: cur.y, h: 10, count: 4, color: 0xcfe8f0, color2: WIND, speed: 180, up: 1.6, radius: 60, size: 30, life: 0.45, vis: true });
      }
    },
    onDispose: (cur) => {
      freeTex(root);
      if (!cur?.vis) return;
      burst(ctx, { x: cur.x, y: cur.y, h: 80, count: 16, color: WIND, color2: WIND_HOT, speed: 320, up: 0.8, size: 26, life: 0.5, vis: true });
    },
  });
}

// —— EQ：环形斩（地面圆弧 + 风环；三段时风柱击飞） ——
function qCircle(ctx, p) {
  const u = p.unit;
  const q = u ? upos(ctx, u) : p;
  const R = p.radius || 215, team = u?.team;
  if (!seen(ctx, q.x, q.y, team)) return NOOP;
  const T = ctx.THREE;
  const arc = mesh(ctx, geo(ctx, 'yasuo_eq_arc', (TT) => sectorGeo(TT, 0.55, 1, Math.PI * 0.95, 48, { sweep: true })), mat(ctx, p.tornado ? WIND : STEEL, 0.9, { vc: true }));
  flat(arc);
  place(ctx, arc, q.x, q.y, 60);
  arc.scale.set(R, R, 1);
  shock(ctx, { x: q.x, y: q.y, radius: R, color: WIND, duration: 0.4, team });
  burst(ctx, { x: q.x, y: q.y, h: 70, count: 18, color: STEEL, color2: WIND, speed: 360, size: 20, life: 0.4, up: 0.3, radius: R * 0.4, team });
  if (p.tornado) {
    pillar(ctx, { x: q.x, y: q.y, radius: R * 0.8, height: 420, color: WIND, opacity: 0.55, duration: 0.6, spin: 8, team });
    shake(ctx, q.x, q.y, 10, 0.2);
  }
  return launch(ctx, arc, {
    duration: 0.3, tag: 'yasuo_q_circle',
    update: (t) => {
      arc.rotation.z = -t * TAU * 1.1;
      arc.material.opacity = 0.9 * (1 - t);
      const s = R * (0.8 + 0.25 * easeOut3(t));
      arc.scale.set(s, s, 1);
    },
  });
}

// —— 旋风就绪：围绕亚索旋转的风带（直到层数消失） ——
function qReady(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 6;
  const root = new T.Group();
  const band = mesh(ctx, geo(ctx, 'yasuo_band', (TT) => sectorGeo(TT, 0.8, 1, Math.PI * 0.6, 24, { sweep: true })), mat(ctx, WIND, 0.7, { vc: true }));
  const band2 = mesh(ctx, geo(ctx, 'yasuo_band', (TT) => sectorGeo(TT, 0.8, 1, Math.PI * 0.6, 24, { sweep: true })), mat(ctx, WIND_HOT, 0.5, { vc: true }));
  root.add(band, band2);
  const R = 85;
  band.scale.set(R, R, 1); band2.scale.set(R * 0.8, R * 0.8, 1);
  return launch(ctx, root, {
    duration: dur, tag: 'yasuo_q_ready',
    update: (t, dt, age) => {
      if (!alive(u) || (age > 0.1 && !u.modelState?.tornadoReady)) return false;
      stick(ctx, root, u, 0);
      const k = env(age, dur, 0.15, 0.3);
      band.position.y = unitH(ctx, u, 0.25) + 20 * Math.sin(age * 3);
      band2.position.y = unitH(ctx, u, 0.6);
      band.rotation.set(-Math.PI / 2 + 0.25, 0, age * 7);
      band2.rotation.set(-Math.PI / 2 - 0.2, 0, -age * 9);
      band.material.opacity = 0.7 * k; band2.material.opacity = 0.5 * k;
    },
  });
}

// —— W：风之障壁（竖直的弧形风墙，随墙体前推，风纹流动） ——
function wWall(ctx, p) {
  const w = p.wall;
  if (!w) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || w.duration || 4;
  const width = p.width || w.width || 400;
  const H = 300;
  const root = new T.Group();
  const wallG = geo(ctx, 'yasuo_wall', (TT) => {
    // 略微外弧的竖直面：局部 X = 墙法线（前方），Z = 墙宽
    const g = new TT.PlaneGeometry(1, 1, 16, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setXYZ(i, 0.06 * (1 - 4 * x * x), pos.getY(i) + 0.5, x);
    }
    g.computeVertexNormals();
    return g;
  });
  const layers = [];
  for (let i = 0; i < 3; i++) {
    const m = mesh(ctx, wallG, windMat(ctx, i === 0 ? WIND : i === 1 ? WIND_HOT : DEEP, i === 1 ? 0.35 : 0.55));
    m.scale.set(width * (1 + i * 0.04), H * (1 - i * 0.12), width * (1 - i * 0.05));
    m.position.x = -i * 12;
    root.add(m);
    layers.push(m);
  }
  const edgeG = geo(ctx, 'yasuo_wall_edge', (TT) => { const g = new TT.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; });
  const edge = mesh(ctx, edgeG, mat(ctx, WIND, 0.5));
  edge.scale.set(40, 1, width);
  root.add(edge);
  const yaw = Math.atan2(w.dirY, w.dirX);
  let gust = 0;
  return launch(ctx, root, {
    duration: dur + 0.6, tag: 'yasuo_w_wall',
    update: (t, dt, age) => {
      const k = env(age, dur + 0.6, 0.15, 0.6) * (w.alive === false && age < dur - 0.05 ? 0 : 1);
      root.position.set(w.x, gh(ctx, w.x, w.y), -w.y);
      root.rotation.y = yaw;
      root.visible = seen(ctx, w.x, w.y, w.team);
      const rise = Math.min(1, age / 0.25);
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        L.scale.y = H * (1 - i * 0.12) * easeOut3(rise);
        L.material.map.offset.x += dt * (0.5 + i * 0.35) * (i % 2 ? -1 : 1);
        L.material.map.offset.y += dt * 0.15;
        L.material.opacity = (i === 1 ? 0.35 : 0.55) * k * (0.85 + 0.15 * Math.sin(age * 6 + i));
      }
      edge.material.opacity = 0.45 * k;
      gust -= dt;
      if (gust <= 0 && root.visible && !low(ctx) && k > 0.3) {
        gust = 0.12;
        const s = (Math.random() - 0.5) * width;
        burst(ctx, { x: w.x - w.dirY * s, y: w.y + w.dirX * s, h: rnd(30, 220), count: 3, color: WIND_HOT, speed: 120, up: 0.6, size: 20, life: 0.5, vis: true });
      }
      if (k <= 0 && age > 0.3) return false;
      return undefined;
    },
    onEnd: () => freeTex(root),
  });
}
function wBlock(ctx, p) {
  const x = p.x, y = p.y, h = Math.max(40, (p.h || 100));
  if (!seen(ctx, x, y)) return NOOP;
  flash(ctx, { x, y, h, color: WIND_HOT, size: 160, duration: 0.25 });
  burst(ctx, { x, y, h, count: 12, color: WIND, color2: WIND_HOT, speed: 260, size: 18, life: 0.4, up: 0.5, dir: Math.atan2(-(p.dirY || 0), -(p.dirX || 1)), arc: 2.2 });
  return NOOP;
}

// —— E：踏前斩（风痕 + 残影） ——
function eDash(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const dur = p.duration || 0.6;
  unitTrail(ctx, u, { color: WIND, color2: DEEP, width: 80, seg: 22, max: 14, duration: dur, fade: 0.3, hf: 0.35 });
  unitTrail(ctx, u, { color: WIND_HOT, color2: WIND, width: 22, seg: 22, max: 12, duration: dur, fade: 0.2, hf: 0.6 });
  const T = ctx.THREE;
  let next = 0, n = 0;
  return launch(ctx, new T.Group(), {
    duration: dur, tag: 'yasuo_e_dash',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (age >= next && n < 3) { next = age + dur / 3.5; n++; ghost(ctx, u, { color: WIND, opacity: 0.35, duration: 0.3 }); }
      return undefined;
    },
  });
}

// —— 被动：剑意护盾（风罩 + 旋转风带） ——
function pShield(ctx, p) {
  const u = p.unit;
  if (!u) return NOOP;
  const T = ctx.THREE;
  const dur = p.duration || 1;
  const root = new T.Group();
  const shell = mesh(ctx, sphereGeo(ctx, 18), windMat(ctx, WIND, 0.45));
  const band = mesh(ctx, geo(ctx, 'yasuo_band', (TT) => sectorGeo(TT, 0.8, 1, Math.PI * 0.6, 24, { sweep: true })), mat(ctx, WIND_HOT, 0.8, { vc: true }));
  root.add(shell, band);
  const R = unitH(ctx, u, 0.5);
  const q = upos(ctx, u);
  burst(ctx, { x: q.x, y: q.y, h: R, count: 16, color: WIND, color2: WIND_HOT, speed: 260, size: 20, life: 0.4, team: u.team });
  return launch(ctx, root, {
    duration: dur + 0.2, tag: 'yasuo_p_shield',
    update: (t, dt, age) => {
      if (!alive(u)) return false;
      if (age > 0.1 && Array.isArray(u.shields) && !u.shields.some((s) => s.id === 'yasuo_passive' && s.amount > 0)) return false;
      stick(ctx, root, u, R);
      const pop = age < 0.15 ? easeOut3(age / 0.15) : 1;
      const k = env(age, dur + 0.2, 0.05, 0.25);
      shell.scale.setScalar(R * 1.1 * pop);
      shell.material.map.offset.x += dt * 1.5;
      shell.material.opacity = 0.45 * k;
      band.scale.set(R * 1.2, R * 1.2, 1);
      band.rotation.set(-Math.PI / 2 + 0.3, 0, age * 10);
      band.material.opacity = 0.8 * k;
    },
    onEnd: () => freeTex(root),
  });
}

// —— R：狂风绝息斩（夜蓝闪光、滞空期间交错剑光、落地风暴） ——
function rStrike(ctx, p) {
  const u = p.unit;
  const t0 = p.target;
  const targets = Array.isArray(p.targets) && p.targets.length ? p.targets : t0 ? [t0] : [];
  const dur = p.duration || 1;
  const q = t0 ? upos(ctx, t0) : p;
  const team = u?.team;
  flash(ctx, { x: q.x, y: q.y, h: 160, color: R_BLUE, size: 700, duration: 0.4, team });
  shock(ctx, { x: q.x, y: q.y, radius: 400, color: R_BLUE, duration: 0.6, team });
  shake(ctx, q.x, q.y, 18, 0.35);
  if (u) ghost(ctx, u, { color: R_BLUE, opacity: 0.6, duration: 0.5, grow: 0.3 });
  const T = ctx.THREE;
  const holder = new T.Group();
  const bladeG = geo(ctx, 'yasuo_r_blade', (TT) => { const g = new TT.PlaneGeometry(1, 1); return g; });
  const slashes = [];
  let next = 0, n = 0;
  return launch(ctx, holder, {
    duration: dur + 0.3, tag: 'yasuo_r_strike',
    update: (t, dt, age) => {
      // 每 0.15 秒在滞空目标身上划出一道交错剑光
      if (age >= next && n < 6 && age < dur) {
        next = age + 0.15; n++;
        for (const tg of targets) {
          if (!alive(tg) || !shown(ctx, tg)) continue;
          const tp = upos(ctx, tg);
          const m = mesh(ctx, bladeG, mat(ctx, n % 2 ? WIND_HOT : R_BLUE, 0.95));
          m.position.set(tp.x, gh(ctx, tp.x, tp.y) + (tp.z || 0) + unitH(ctx, tg, 0.55), -tp.y);
          m.rotation.set(rnd(-0.6, 0.6), rnd(0, TAU), rnd(-1.2, 1.2));
          m.scale.set(420, 16, 1);
          holder.add(m);
          slashes.push({ m, age: 0 });
          burst(ctx, { x: tp.x, y: tp.y, h: unitH(ctx, tg, 0.55) + (tp.z || 0), count: 8, color: WIND_HOT, color2: R_BLUE, speed: 380, size: 18, life: 0.3, vis: true });
        }
      }
      for (const s of slashes) {
        s.age += dt;
        const k = Math.max(0, 1 - s.age / 0.25);
        s.m.material.opacity = 0.95 * k;
        s.m.scale.y = 16 * k + 1;
      }
      if (age >= dur && n < 99) {
        n = 99;
        for (const tg of targets) {
          if (!alive(tg)) continue;
          const tp = upos(ctx, tg);
          shock(ctx, { x: tp.x, y: tp.y, radius: 260, color: WIND, duration: 0.45, team });
          burst(ctx, { x: tp.x, y: tp.y, h: 20, count: 20, color: 0xbfdcec, speed: 360, size: 50, life: 0.7, additive: false, opacity: 0.5, up: 0.3, team });
        }
      }
      return undefined;
    },
  });
}

export default function register(fx) {
  const r = registrar(fx, 'yasuo');
  r.proj('yasuo_q_tornado', tornadoProj);
  r.on('yasuo_q_thrust', qThrust);
  r.on('yasuo_q_circle', qCircle);
  r.on('yasuo_q_ready', qReady);
  r.on('yasuo_w_wall', wWall);
  r.on('yasuo_w_block', wBlock);
  r.on('yasuo_e_dash', eDash);
  r.on('yasuo_p_shield', pShield);
  r.on('yasuo_r_strike', rStrike);
}
