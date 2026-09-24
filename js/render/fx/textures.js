// 特效程序化纹理：辉光/光环/火花/烟雾/噪声等单张纹理 + 4×4 图集（实例化精灵与 GPU 粒子共用）
export const ATLAS_N = 4;
export const TILE = {
  glow: 0, soft: 1, spark: 2, streak: 3,
  ring: 4, star: 5, smoke: 6, flare: 7,
  flake: 8, plus: 9, rune: 10, chevron: 11,
  bolt: 12, dot: 13, swirl: 14, shard: 15,
};

const TAU = Math.PI * 2;

// —— 绘制函数：在 (0,0,s,s) 区域内绘制白色蒙版（alpha 为形状） ——
function radial(g, s, stops) {
  const c = s / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  for (const [o, a] of stops) gr.addColorStop(o, `rgba(255,255,255,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
}
const DRAW = {
  glow(g, s) { radial(g, s, [[0, 1], [0.12, 0.85], [0.3, 0.42], [0.55, 0.14], [0.8, 0.03], [0.97, 0]]); },
  soft(g, s) { radial(g, s, [[0, 1], [0.45, 0.8], [0.75, 0.3], [0.96, 0]]); },
  spark(g, s) {
    radial(g, s, [[0, 1], [0.08, 1], [0.2, 0.55], [0.45, 0.12], [0.95, 0]]);
    g.globalCompositeOperation = 'lighter';
    const c = s / 2;
    for (const vert of [false, true]) {
      g.save(); g.translate(c, c); if (vert) g.rotate(Math.PI / 2); g.scale(1, 0.07);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, c * 0.95);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, c * 0.95, 0, TAU); g.fill(); g.restore();
    }
    g.globalCompositeOperation = 'source-over';
  },
  streak(g, s) {
    const c = s / 2;
    g.save(); g.translate(c, c); g.scale(1, 0.2);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, c * 0.96);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, c * 0.96, 0, TAU); g.fill(); g.restore();
  },
  ring(g, s) { radial(g, s, [[0, 0], [0.55, 0], [0.7, 0.35], [0.8, 1], [0.87, 0.35], [0.96, 0]]); },
  star(g, s) {
    radial(g, s, [[0, 1], [0.1, 0.7], [0.3, 0.1], [0.6, 0]]);
    g.globalCompositeOperation = 'lighter';
    const c = s / 2;
    for (let i = 0; i < 4; i++) {
      g.save(); g.translate(c, c); g.rotate(i * Math.PI / 4); g.scale(1, i % 2 ? 0.035 : 0.06);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, c * (i % 2 ? 0.6 : 0.96));
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, c, 0, TAU); g.fill(); g.restore();
    }
    g.globalCompositeOperation = 'source-over';
  },
  smoke(g, s) {
    const c = s / 2;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, r = Math.random() * c * 0.38;
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r, rr = c * (0.28 + Math.random() * 0.28);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(255,255,255,${0.22 + Math.random() * 0.2})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }
  },
  flare(g, s) {
    radial(g, s, [[0, 1], [0.06, 0.9], [0.18, 0.3], [0.5, 0.05], [0.9, 0]]);
    g.globalCompositeOperation = 'lighter';
    const c = s / 2;
    for (let i = 0; i < 6; i++) {
      g.save(); g.translate(c, c); g.rotate(i * Math.PI / 3 + 0.2); g.scale(1, 0.025);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, c * 0.9);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, c, 0, TAU); g.fill(); g.restore();
    }
    g.globalCompositeOperation = 'source-over';
  },
  flake(g, s) {
    const c = s / 2;
    radial(g, s, [[0, 0.6], [0.2, 0.2], [0.5, 0]]);
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineCap = 'round'; g.lineWidth = s * 0.045;
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = s * 0.05;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, ex = c + Math.cos(a) * c * 0.78, ey = c + Math.sin(a) * c * 0.78;
      g.beginPath(); g.moveTo(c, c); g.lineTo(ex, ey); g.stroke();
      for (const k of [0.45, 0.65]) {
        const bx = c + Math.cos(a) * c * 0.78 * k, by = c + Math.sin(a) * c * 0.78 * k;
        for (const sgn of [-1, 1]) {
          g.beginPath(); g.moveTo(bx, by);
          g.lineTo(bx + Math.cos(a + sgn * 0.8) * c * 0.18, by + Math.sin(a + sgn * 0.8) * c * 0.18); g.stroke();
        }
      }
    }
    g.shadowBlur = 0;
  },
  plus(g, s) {
    const c = s / 2;
    radial(g, s, [[0, 0.5], [0.4, 0.15], [0.8, 0]]);
    g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = s * 0.08;
    g.fillStyle = 'rgba(255,255,255,1)';
    const w = s * 0.16, l = s * 0.56;
    g.fillRect(c - w / 2, c - l / 2, w, l); g.fillRect(c - l / 2, c - w / 2, l, w);
    g.shadowBlur = 0;
  },
  rune(g, s) {
    const c = s / 2;
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = s * 0.035;
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = s * 0.04;
    g.beginPath(); g.arc(c, c, c * 0.8, 0, TAU); g.stroke();
    g.beginPath(); g.arc(c, c, c * 0.62, 0, TAU); g.stroke();
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * TAU / 3;
      const x = c + Math.cos(a) * c * 0.6, y = c + Math.sin(a) * c * 0.6;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12;
      g.beginPath(); g.moveTo(c + Math.cos(a) * c * 0.64, c + Math.sin(a) * c * 0.64);
      g.lineTo(c + Math.cos(a) * c * (i % 3 ? 0.72 : 0.78), c + Math.sin(a) * c * (i % 3 ? 0.72 : 0.78)); g.stroke();
    }
    g.shadowBlur = 0;
  },
  chevron(g, s) {
    const c = s / 2;
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = s * 0.12; g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = s * 0.08;
    g.beginPath(); g.moveTo(c - s * 0.18, c - s * 0.26); g.lineTo(c + s * 0.14, c); g.lineTo(c - s * 0.18, c + s * 0.26); g.stroke();
    g.shadowBlur = 0;
  },
  bolt(g, s) {
    const c = s / 2;
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = s * 0.06;
    const pts = [[0.06, 0.5], [0.24, 0.36], [0.38, 0.6], [0.55, 0.3], [0.7, 0.62], [0.82, 0.42], [0.95, 0.52]];
    for (const [lw, al] of [[0.06, 0.35], [0.025, 1]]) {
      g.lineWidth = s * lw; g.globalAlpha = al; g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
      g.stroke();
    }
    g.globalAlpha = 1; g.lineWidth = s * 0.018;
    g.beginPath(); g.moveTo(0.38 * s, 0.6 * s); g.lineTo(0.45 * s, 0.82 * s); g.stroke();
    g.beginPath(); g.moveTo(0.55 * s, 0.3 * s); g.lineTo(0.62 * s, 0.14 * s); g.stroke();
    g.shadowBlur = 0; void c;
  },
  dot(g, s) { radial(g, s, [[0, 1], [0.5, 1], [0.62, 0.5], [0.7, 0]]); },
  swirl(g, s) {
    const c = s / 2;
    g.lineCap = 'round';
    g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = s * 0.05;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, a = k * TAU / 3 + t * Math.PI * 1.4, r = c * (0.12 + t * 0.72);
        const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = s * 0.05; g.stroke();
    }
    g.shadowBlur = 0;
  },
  shard(g, s) {
    const c = s / 2;
    g.save(); g.translate(c, c);
    const gr = g.createLinearGradient(-c, 0, c, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.9, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.4)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(-c * 0.9, 0); g.lineTo(c * 0.35, -c * 0.2); g.lineTo(c * 0.92, 0); g.lineTo(c * 0.35, c * 0.2); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = s * 0.012;
    g.beginPath(); g.moveTo(-c * 0.5, 0); g.lineTo(c * 0.92, 0); g.stroke();
    g.restore();
  },
};

function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

function toTexture(THREE, cv, { repeat = false } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

// 可平铺值噪声（多倍频）
function drawNoise(g, s) {
  const img = g.createImageData(s, s);
  const layers = [[8, 0.5], [16, 0.28], [32, 0.14], [64, 0.08]];
  const vals = layers.map(([n]) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; });
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let v = 0;
      layers.forEach(([n, w], li) => {
        const fx = (x / s) * n, fy = (y / s) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
        const A = vals[li], i00 = A[(y0 % n) * n + (x0 % n)], i10 = A[(y0 % n) * n + ((x0 + 1) % n)];
        const i01 = A[((y0 + 1) % n) * n + (x0 % n)], i11 = A[((y0 + 1) % n) * n + ((x0 + 1) % n)];
        v += w * ((i00 * (1 - tx) + i10 * tx) * (1 - ty) + (i01 * (1 - tx) + i11 * tx) * ty);
      });
      const o = (y * s + x) * 4, c = Math.max(0, Math.min(255, v * 255));
      img.data[o] = img.data[o + 1] = img.data[o + 2] = c; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// 生成全部纹理：{ glow, ring, spark, smoke, noise, soft, star, streak, flare, atlas }
export function makeTextures(THREE) {
  const out = {};
  const single = (name, size = 128) => {
    const cv = canvas(size, size);
    DRAW[name](cv.getContext('2d'), size);
    out[name] = toTexture(THREE, cv);
  };
  for (const n of ['glow', 'ring', 'spark', 'smoke', 'soft', 'star', 'streak', 'flare']) single(n);
  const ncv = canvas(128, 128);
  drawNoise(ncv.getContext('2d'), 128);
  out.noise = toTexture(THREE, ncv, { repeat: true });
  // 图集：每格 128，四周留白避免 mip 串色
  const T = 128, cv = canvas(T * ATLAS_N, T * ATLAS_N), g = cv.getContext('2d');
  for (const [name, idx] of Object.entries(TILE)) {
    const col = idx % ATLAS_N, row = Math.floor(idx / ATLAS_N);
    g.save(); g.translate(col * T + 4, row * T + 4);
    g.beginPath(); g.rect(0, 0, T - 8, T - 8); g.clip();
    DRAW[name](g, T - 8);
    g.restore();
  }
  out.atlas = toTexture(THREE, cv);
  return out;
}
