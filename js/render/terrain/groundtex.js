// 地表纹理：逐像素底色（草地/林地/河床/坑/基地/墙脚 AO）+ Canvas 矢量层（兵线土路与石板、野区小路、营地、草丛土、基地铺装与符文、浅滩）
import { fbm, valueNoise, tileNoise, mulberry32, smooth } from './noise.js';

const lerp = (a, b, t) => a + (b - a) * t;
function mix3(o, c, t) { o[0] = lerp(o[0], c[0], t); o[1] = lerp(o[1], c[1], t); o[2] = lerp(o[2], c[2], t); }

/** 可平铺细节噪声（R 细 / G 中 / B 岩石脊 / A 斑点） */
export function makeDetailTexture(THREE, size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      const r = 0.5 * tileNoise(u * 32, v * 32, 32, 1) + 0.3 * tileNoise(u * 64, v * 64, 64, 2) + 0.2 * tileNoise(u * 128, v * 128, 128, 3);
      const g = 0.55 * tileNoise(u * 8, v * 8, 8, 4) + 0.3 * tileNoise(u * 16, v * 16, 16, 5) + 0.15 * tileNoise(u * 32, v * 32, 32, 6);
      const b1 = 1 - Math.abs(2 * tileNoise(u * 12, v * 12, 12, 7) - 1), b2 = 1 - Math.abs(2 * tileNoise(u * 28, v * 28, 28, 8) - 1);
      const b = 0.6 * b1 * b1 + 0.4 * b2;
      const a = tileNoise(u * 96, v * 96, 96, 9);
      const o = (j * size + i) * 4;
      data[o] = r * 255; data[o + 1] = g * 255; data[o + 2] = b * 255; data[o + 3] = a * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** 径向渐变光斑纹理（地面发光贴花用） */
export function makeGlowTexture(THREE, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 符文圆环纹理（泉水 / 枢纽广场的发光符文，白色，着色由材质决定） */
export function makeRuneTexture(THREE, size = 1024, seed = 5) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const R = size / 2;
  const rnd = mulberry32(seed);
  g.translate(R, R);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.fillStyle = 'rgba(255,255,255,1)';
  g.lineCap = 'round';
  const ring = (r, w, a = 1) => { g.globalAlpha = a; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  ring(R * 0.96, R * 0.022, 0.9);
  ring(R * 0.9, R * 0.008, 0.7);
  ring(R * 0.7, R * 0.014, 0.85);
  ring(R * 0.64, R * 0.006, 0.6);
  ring(R * 0.34, R * 0.012, 0.8);
  // 外圈符文
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.translate(0, -R * 0.8);
    g.globalAlpha = 0.85;
    g.lineWidth = R * 0.012;
    const t = (rnd() * 4) | 0, s = R * 0.05;
    g.beginPath();
    if (t === 0) { g.moveTo(-s, s); g.lineTo(0, -s); g.lineTo(s, s); g.moveTo(-s * 0.5, 0); g.lineTo(s * 0.5, 0); }
    else if (t === 1) { g.moveTo(0, -s); g.lineTo(0, s); g.moveTo(-s, -s * 0.3); g.lineTo(s, s * 0.3); }
    else if (t === 2) { g.moveTo(-s, -s); g.lineTo(s, -s); g.lineTo(-s, s); g.lineTo(s, s); }
    else { g.arc(0, 0, s * 0.7, 0, Math.PI * 2); g.moveTo(0, -s); g.lineTo(0, s); }
    g.stroke();
    g.restore();
  }
  // 放射线与内部菱形
  g.globalAlpha = 0.55;
  g.lineWidth = R * 0.006;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * R * 0.36, Math.sin(a) * R * 0.36);
    g.lineTo(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62);
    g.stroke();
  }
  g.globalAlpha = 0.7;
  g.lineWidth = R * 0.01;
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2 + k * Math.PI / 6;
      const x = Math.cos(a) * R * 0.6, y = Math.sin(a) * R * 0.6;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * 绘制地表大纹理，返回 canvas（北在上）。S = 纹理边长。
 */
export async function paintGround(hf, md, S, yieldFn = async () => {}) {
  const { D0, DS } = hf;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');

  // ============ 1) 逐像素底色 ============
  const B = Math.min(S, 1024);
  const base = document.createElement('canvas');
  base.width = base.height = B;
  const bgc = base.getContext('2d');
  const img = bgc.createImageData(B, B);
  const d = img.data;
  const c = [0, 0, 0];
  const GR_D = [62, 110, 50], GR_M = [86, 140, 60], GR_L = [118, 166, 70];
  const YEL = [152, 162, 76], TEAL = [66, 138, 104];
  const FO_A = [34, 58, 34], FO_B = [56, 82, 42];
  const WET = [66, 94, 58], SAND = [118, 122, 90], BED = [72, 100, 88];
  const DRG = [132, 110, 70], BAR = [70, 58, 84];
  const STONE_B = [178, 174, 156], STONE_R = [98, 88, 96];
  const { sample } = hf;
  for (let py = 0; py < B; py++) {
    const y = D0 + (1 - (py + 0.5) / B) * DS;
    for (let px = 0; px < B; px++) {
      const x = D0 + ((px + 0.5) / B) * DS;
      const s = sample(hf.S, x, y), rr = sample(hf.RV, x, y), bv = sample(hf.BV, x, y), pv = sample(hf.PV, x, y);
      const n1 = fbm(x / 1300, y / 1300, 3, 31), n2 = valueNoise(x / 380, y / 380, 41), n3 = valueNoise(x / 110, y / 110, 43);
      // 草地
      if (n1 < 0.5) { const t = n1 / 0.5; c[0] = lerp(GR_D[0], GR_M[0], t); c[1] = lerp(GR_D[1], GR_M[1], t); c[2] = lerp(GR_D[2], GR_M[2], t); }
      else { const t = (n1 - 0.5) / 0.5; c[0] = lerp(GR_M[0], GR_L[0], t); c[1] = lerp(GR_M[1], GR_L[1], t); c[2] = lerp(GR_M[2], GR_L[2], t); }
      mix3(c, YEL, smooth(0.62, 0.88, n2) * 0.5);
      if (rr < 2.4) mix3(c, TEAL, (1 - smooth(1.0, 2.4, rr)) * 0.4);
      // 林地（墙顶）
      if (s > -10) {
        const f0 = lerp(FO_A[0], FO_B[0], n2), f1 = lerp(FO_A[1], FO_B[1], n2), f2 = lerp(FO_A[2], FO_B[2], n2);
        const t = smooth(-8, 70, s);
        c[0] = lerp(c[0], f0, t); c[1] = lerp(c[1], f1, t); c[2] = lerp(c[2], f2, t);
      }
      // 墙脚 AO
      if (s < 0 && s > -260) { const t = smooth(-260, 0, s); const ao = 1 - 0.36 * t * t; c[0] *= ao; c[1] *= ao; c[2] *= ao; }
      // 河床 / 岸边湿地
      if (rr < 1.3) {
        mix3(c, WET, (1 - smooth(0.92, 1.3, rr)) * 0.65);
        mix3(c, SAND, (1 - smooth(0.62, 0.95, rr)) * (0.75 + 0.2 * n3));
        mix3(c, BED, (1 - smooth(0.25, 0.62, rr)) * 0.8);
      }
      // 龙坑
      if (pv > 0.01) mix3(c, DRG, smooth(0.05, 0.8, pv) * (0.75 + 0.25 * n3));
      else if (pv < -0.01) mix3(c, BAR, smooth(0.05, 0.8, -pv) * (0.8 + 0.2 * n3));
      // 基地底色
      if (bv > 0.01) mix3(c, STONE_B, smooth(0.1, 0.7, bv));
      else if (bv < -0.01) mix3(c, STONE_R, smooth(0.1, 0.7, -bv));
      const sp = 0.92 + 0.16 * n3;
      const o = (py * B + px) * 4;
      d[o] = c[0] * sp; d[o + 1] = c[1] * sp; d[o + 2] = c[2] * sp; d[o + 3] = 255;
    }
    if ((py & 255) === 255) await yieldFn();
  }
  bgc.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(base, 0, 0, S, S);
  await yieldFn();

  // ============ 2) 矢量层（世界坐标变换） ============
  const k = S / DS;
  g.setTransform(k, 0, 0, -k, -D0 * k, (D0 + DS) * k);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const rnd = mulberry32(20240917);
  const inRiver = (x, y) => sample(hf.RV, x, y) < 1.04;
  const inBase = (x, y) => Math.abs(sample(hf.BV, x, y)) > 0.35;
  const wallAt = (x, y) => sample(hf.S, x, y) > -20;
  const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); };
  const stroke = (pts, w, style) => { g.strokeStyle = style; g.lineWidth = w; path(pts); g.stroke(); };
  const poly = (pts) => { path(pts); g.closePath(); };
  const walkAlong = (pts, step, fn) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1) continue;
      const tx = (bx - ax) / L, ty = (by - ay) / L;
      for (let t = 0; t < L; t += step) fn(ax + tx * t, ay + ty * t, tx, ty);
    }
  };
  const stone = (x, y, r, fill, edge, lw = 5) => {
    const n = 5 + ((rnd() * 3) | 0), rot = rnd() * 6.28;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2, rr = r * (0.72 + 0.28 * rnd());
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * (0.75 + 0.25 * rnd());
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
    g.fillStyle = fill; g.fill();
    if (edge) { g.strokeStyle = edge; g.lineWidth = lw; g.stroke(); }
  };

  // 2.1 草地斑块（手绘质感的明暗色块）
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 15000, y = rnd() * 15000;
    if (sample(hf.S, x, y) > -60 || inRiver(x, y) || inBase(x, y)) continue;
    const r = 60 + rnd() * 220;
    const light = rnd() < 0.5;
    g.fillStyle = light ? `rgba(140,184,84,${0.05 + rnd() * 0.07})` : `rgba(40,82,40,${0.05 + rnd() * 0.08})`;
    g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * 3.14, 0, Math.PI * 2); g.fill();
  }
  await yieldFn();

  // 2.2 草丛下的深色土壤
  for (const b of md.BRUSHES || []) {
    if (!b.poly || b.poly.length < 3) continue;
    g.strokeStyle = 'rgba(34,58,28,0.35)'; g.lineWidth = 90; poly(b.poly); g.stroke();
    g.fillStyle = 'rgba(36,60,28,0.85)'; poly(b.poly); g.fill();
  }

  // 2.3 野区小路
  const trails = md.DECOR?.jungleTrails || [];
  for (const t of trails) stroke(t.pts, t.w * 1.7, 'rgba(70,84,42,0.14)');
  for (const t of trails) stroke(t.pts, t.w * 1.2, 'rgba(106,92,58,0.26)');
  for (const t of trails) stroke(t.pts, t.w * 0.82, 'rgba(126,106,70,0.34)');
  for (const t of trails) stroke(t.pts, t.w * 0.38, 'rgba(138,118,80,0.22)');
  for (const t of trails) {
    walkAlong(t.pts, 90, (x, y, tx, ty) => {
      if (rnd() < 0.5) return;
      const o = (rnd() - 0.5) * t.w * 0.9;
      g.fillStyle = `rgba(${rnd() < 0.5 ? '120,100,66' : '74,108,50'},0.35)`;
      g.beginPath(); g.arc(x - ty * o, y + tx * o, 18 + rnd() * 40, 0, Math.PI * 2); g.fill();
    });
  }

  // 2.4 营地空地
  for (const ca of md.DECOR?.campAreas || []) {
    const gr = g.createRadialGradient(ca.x, ca.y, ca.r * 0.1, ca.x, ca.y, ca.r * 1.3);
    gr.addColorStop(0, 'rgba(124,102,66,0.82)');
    gr.addColorStop(0.55, 'rgba(118,98,62,0.55)');
    gr.addColorStop(1, 'rgba(110,94,60,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(ca.x, ca.y, ca.r * 1.3, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 14; i++) {
      const a = rnd() * 6.28, r = ca.r * (0.3 + rnd() * 0.8);
      stone(ca.x + Math.cos(a) * r, ca.y + Math.sin(a) * r, 12 + rnd() * 22, 'rgba(150,138,112,0.7)', 'rgba(70,60,44,0.5)', 4);
    }
  }
  await yieldFn();

  // 2.5 兵线：柔和边缘土路 + 车辙 + 不规则边缘 + 石板
  const lanes = md.DECOR?.lanePaths || [];
  for (const l of lanes) stroke(l.pts, l.w * 1.5, 'rgba(92,86,52,0.16)');
  for (const l of lanes) stroke(l.pts, l.w * 1.24, 'rgba(118,100,64,0.34)');
  for (const l of lanes) stroke(l.pts, l.w * 1.02, 'rgba(142,118,78,0.62)');
  for (const l of lanes) stroke(l.pts, l.w * 0.8, 'rgba(158,134,90,0.55)');
  for (const l of lanes) {
    walkAlong(l.pts, 70, (x, y, tx, ty) => {
      if (inRiver(x, y) || inBase(x, y)) return;
      for (const side of [-1, 1]) {
        const o = side * (l.w * 0.5 + (rnd() - 0.4) * 110);
        const px = x - ty * o, py = y + tx * o;
        if (wallAt(px, py)) continue;
        const grass = rnd() < 0.35;
        g.fillStyle = grass ? 'rgba(84,130,58,0.55)' : 'rgba(134,112,74,0.42)';
        g.beginPath(); g.ellipse(px, py, 30 + rnd() * 80, 20 + rnd() * 50, rnd() * 3.14, 0, Math.PI * 2); g.fill();
      }
    });
    for (const off of [-0.2, 0.2]) {
      const pts = [];
      for (let i = 0; i < l.pts.length; i++) {
        const a = l.pts[Math.max(0, i - 1)], b = l.pts[Math.min(l.pts.length - 1, i + 1)];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        pts.push([l.pts[i][0] - ((b[1] - a[1]) / L) * off * l.w, l.pts[i][1] + ((b[0] - a[0]) / L) * off * l.w]);
      }
      stroke(pts, 46, 'rgba(112,92,60,0.22)');
    }
  }
  await yieldFn();
  const STONES = ['rgba(160,146,118,0.55)', 'rgba(170,158,130,0.5)', 'rgba(146,134,110,0.55)', 'rgba(178,166,136,0.5)', 'rgba(136,128,108,0.55)'];
  for (const l of lanes) {
    walkAlong(l.pts, 64, (x, y, tx, ty) => {
      const cnt = rnd() < 0.75 ? 1 : 2;
      for (let q = 0; q < cnt; q++) {
        const o = ((rnd() + rnd() + rnd()) / 1.5 - 1) * l.w * 0.4;
        const px = x - ty * o + tx * (rnd() - 0.5) * 30, py = y + tx * o + ty * (rnd() - 0.5) * 30;
        if (inRiver(px, py) || inBase(px, py) || rnd() < 0.3) continue;
        stone(px, py, 14 + rnd() * 22, STONES[(rnd() * STONES.length) | 0], 'rgba(70,58,42,0.3)', 4);
      }
    });
  }
  await yieldFn();

  // 2.6 基地：石板铺装、主干道、枢纽广场与泉水符文、出口台阶
  for (const b of md.DECOR?.bases || []) {
    const blue = b.team === 0;
    const tile = blue ? [180, 176, 158] : [100, 90, 98];
    const joint = blue ? 'rgba(92,88,76,0.7)' : 'rgba(34,26,36,0.75)';
    const gold = blue ? 'rgba(214,190,128,0.95)' : 'rgba(170,52,78,0.95)';
    const glow = blue ? 'rgba(90,176,255,0.75)' : 'rgba(196,54,120,0.75)';
    g.save();
    poly(b.boundary);
    g.clip();
    // 石板（沿 45° 方向排列）
    const T = 150;
    g.save();
    g.translate(b.nexus.x, b.nexus.y);
    g.rotate(Math.PI / 4);
    for (let i = -34; i <= 34; i++) {
      for (let j = -34; j <= 34; j++) {
        const lx = i * T, ly = (j + (i & 1) * 0.5) * T;
        const wx = b.nexus.x + (lx - ly) * Math.SQRT1_2, wy = b.nexus.y + (lx + ly) * Math.SQRT1_2;
        if (wx < -300 || wy < -300 || wx > 15300 || wy > 15300) continue;
        const bv = sample(hf.BV, wx, wy);
        if (Math.abs(bv) < 0.3) continue;
        if (valueNoise(wx / 420, wy / 420, 77) > 0.74) continue;   // 草地透出
        const v = (rnd() - 0.5) * 22;
        g.fillStyle = `rgb(${tile[0] + v},${tile[1] + v},${tile[2] + v * 0.8})`;
        g.fillRect(lx + 5, ly + 5, T - 10, T - 10);
      }
    }
    g.restore();
    // 石缝中的草
    for (let i = 0; i < 260; i++) {
      const x = b.nexus.x + (rnd() - 0.5) * 9000, y = b.nexus.y + (rnd() - 0.5) * 9000;
      if (Math.abs(sample(hf.BV, x, y)) < 0.4) continue;
      g.fillStyle = `rgba(88,134,62,${0.3 + rnd() * 0.3})`;
      g.beginPath(); g.ellipse(x, y, 30 + rnd() * 90, 20 + rnd() * 50, rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    // 主干道（兵线在基地内的铺装）
    for (const l of lanes) stroke(l.pts, 560, blue ? 'rgba(204,198,176,0.9)' : 'rgba(118,106,114,0.9)');
    for (const l of lanes) stroke(l.pts, 470, blue ? 'rgba(188,182,160,1)' : 'rgba(104,94,102,1)');
    for (const l of lanes) {
      g.setLineDash([120, 30]);
      stroke(l.pts, 12, joint);
      g.setLineDash([]);
    }
    g.restore();
    // 枢纽广场：同心石环 + 符文
    const pl = b.plaza;
    g.fillStyle = blue ? 'rgb(196,190,170)' : 'rgb(112,100,110)';
    g.beginPath(); g.arc(pl.x, pl.y, pl.r * 0.95, 0, Math.PI * 2); g.fill();
    g.strokeStyle = joint; g.lineWidth = 9;
    for (let r = 140; r < pl.r * 0.95; r += 115) {
      g.beginPath(); g.arc(pl.x, pl.y, r, 0, Math.PI * 2); g.stroke();
      const n = Math.max(6, Math.round((r * Math.PI * 2) / 160));
      for (let i = 0; i < n; i++) {
        const a = (i + (r / 115) * 0.5) / n * Math.PI * 2;
        g.beginPath(); g.moveTo(pl.x + Math.cos(a) * r, pl.y + Math.sin(a) * r);
        g.lineTo(pl.x + Math.cos(a) * (r + 115), pl.y + Math.sin(a) * (r + 115)); g.stroke();
      }
    }
    g.strokeStyle = gold; g.lineWidth = 30;
    g.beginPath(); g.arc(pl.x, pl.y, pl.r * 0.68, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 12;
    g.beginPath(); g.arc(pl.x, pl.y, pl.r * 0.6, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(pl.x, pl.y, pl.r * 0.93, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, r = pl.r * 0.64;
      g.save(); g.translate(pl.x + Math.cos(a) * r, pl.y + Math.sin(a) * r); g.rotate(a);
      g.fillStyle = gold; g.fillRect(-10, -26, 20, 52);
      g.restore();
    }
    g.strokeStyle = glow; g.lineWidth = 16;
    g.beginPath(); g.arc(pl.x, pl.y, pl.r * 0.8, 0, Math.PI * 2); g.stroke();
    // 泉水石台
    const fo = b.fountain;
    g.fillStyle = blue ? 'rgb(150,146,130)' : 'rgb(76,66,76)';
    g.beginPath(); g.arc(fo.x, fo.y, fo.r, 0, Math.PI * 2); g.fill();
    g.fillStyle = blue ? 'rgb(200,196,178)' : 'rgb(114,102,112)';
    g.beginPath(); g.arc(fo.x, fo.y, fo.r - 70, 0, Math.PI * 2); g.fill();
    g.strokeStyle = joint; g.lineWidth = 9;
    for (let r = 160; r < fo.r - 70; r += 120) { g.beginPath(); g.arc(fo.x, fo.y, r, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      g.beginPath(); g.moveTo(fo.x + Math.cos(a) * 160, fo.y + Math.sin(a) * 160);
      g.lineTo(fo.x + Math.cos(a) * (fo.r - 70), fo.y + Math.sin(a) * (fo.r - 70)); g.stroke();
    }
    g.strokeStyle = gold; g.lineWidth = 34;
    g.beginPath(); g.arc(fo.x, fo.y, fo.r - 40, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 16;
    g.beginPath(); g.arc(fo.x, fo.y, fo.pool + 60, 0, Math.PI * 2); g.stroke();
    const pg = g.createRadialGradient(fo.x, fo.y, 0, fo.x, fo.y, fo.pool);
    pg.addColorStop(0, blue ? 'rgba(120,200,255,0.9)' : 'rgba(230,90,140,0.9)');
    pg.addColorStop(1, blue ? 'rgba(40,110,200,0.6)' : 'rgba(120,30,80,0.6)');
    g.fillStyle = pg;
    g.beginPath(); g.arc(fo.x, fo.y, fo.pool, 0, Math.PI * 2); g.fill();
    // 出口台阶
    for (const gt of b.gates || []) {
      const px = -gt.dirY, py = gt.dirX, hw = gt.width * 0.5;
      for (let t = -150; t <= 150; t += 50) {
        const cx = gt.x + gt.dirX * t, cy = gt.y + gt.dirY * t;
        stroke([[cx - px * hw, cy - py * hw], [cx + px * hw, cy + py * hw]], 10, 'rgba(60,54,44,0.55)');
        stroke([[cx - px * hw + gt.dirX * 14, cy - py * hw + gt.dirY * 14], [cx + px * hw + gt.dirX * 14, cy + py * hw + gt.dirY * 14]], 6, 'rgba(236,230,210,0.22)');
      }
    }
    await yieldFn();
  }

  // 2.7 龙坑细节
  const pits = md.DECOR?.pits || {};
  for (const [name, p] of Object.entries(pits)) {
    const baron = name === 'baron';
    if (baron) {
      const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      gr.addColorStop(0, 'rgba(96,52,130,0.55)');
      gr.addColorStop(1, 'rgba(60,40,80,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 34; i++) {
      let x = p.x + (rnd() - 0.5) * p.r * 1.3, y = p.y + (rnd() - 0.5) * p.r * 1.3;
      const pts = [[x, y]];
      let a = rnd() * 6.28;
      for (let s = 0; s < 5; s++) { a += (rnd() - 0.5) * 1.4; x += Math.cos(a) * 50; y += Math.sin(a) * 50; pts.push([x, y]); }
      stroke(pts, baron ? 12 : 9, baron ? 'rgba(178,96,240,0.35)' : 'rgba(84,64,40,0.5)');
    }
    for (let i = 0; i < 40; i++) {
      const a = rnd() * 6.28, r = p.r * (0.2 + rnd() * 0.65);
      stone(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 14 + rnd() * 26, baron ? 'rgba(92,80,108,0.8)' : 'rgba(156,134,94,0.8)', 'rgba(40,30,30,0.4)', 4);
    }
  }

  // 2.8 河床卵石与中路浅滩踏石
  for (let i = 0; i < 1400; i++) {
    const x = 1000 + rnd() * 13000, y = 1000 + rnd() * 13000;
    const rr = sample(hf.RV, x, y);
    if (rr > 1.0 || rr < 0.35) continue;
    const v = 100 + rnd() * 60;
    g.fillStyle = `rgba(${v},${v * 0.98},${v * 0.86},0.55)`;
    g.beginPath(); g.ellipse(x, y, 8 + rnd() * 22, 6 + rnd() * 14, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  const ford = md.DECOR?.riverFord;
  const mid = md.LANE_CENTERLINES?.mid;
  if (ford && mid) {
    walkAlong(mid, 70, (x, y, tx, ty) => {
      if (Math.hypot(x - ford.x, y - ford.y) > ford.r * 1.1) return;
      for (let q = 0; q < 2; q++) {
        const o = (rnd() - 0.5) * 600;
        stone(x - ty * o, y + tx * o, 16 + rnd() * 24, 'rgba(168,160,136,0.5)', 'rgba(60,64,56,0.3)', 4);
      }
    });
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}
