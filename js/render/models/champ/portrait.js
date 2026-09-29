// 英雄头像：共享一个离屏 WebGLRenderer 渲染半身像（略侧身、三点布光 + 彩色轮廓光），
// 再用 2D 画布合成 def.portrait.bg 径向渐变背景、暗角与底部压暗，输出 dataURL 并缓存。
// 不依赖 Game/Renderer，选人界面即可调用；任何失败返回 null（调用方自行回落到字形头像）。
import * as THREE from 'three';
import { createModelView } from './view.js';

let GL = null;          // 共享离屏渲染器
let SCENE = null, KEY = null, FILL = null, RIM = null, HEMI = null;
let queue = Promise.resolve();
const CACHE = new Map(); // `${id}@${size}` → Promise<dataURL|null>

function ensureGL() {
  if (GL) return GL;
  const canvas = document.createElement('canvas');
  GL = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  GL.setPixelRatio(1);
  GL.outputColorSpace = THREE.SRGBColorSpace;
  GL.toneMapping = THREE.ACESFilmicToneMapping;
  GL.toneMappingExposure = 1.1;
  GL.setClearColor(0x000000, 0);
  SCENE = new THREE.Scene();
  HEMI = new THREE.HemisphereLight(0xe8f0ff, 0x3a3028, 1.25);
  KEY = new THREE.DirectionalLight(0xfff2e0, 2.6);
  FILL = new THREE.DirectionalLight(0xb8ccff, 0.7);
  RIM = new THREE.DirectionalLight(0xffffff, 3.2);
  SCENE.add(HEMI, KEY, FILL, RIM, KEY.target, FILL.target, RIM.target);
  return GL;
}

function hexToInt(hex, fb) {
  if (typeof hex !== 'string') return fb;
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return fb;
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return parseInt(s, 16);
}

// getModel: () => model（见 view.js getModel）
export function renderPortrait(id, def, getModelFn, size = 256) {
  size = Math.max(32, Math.min(1024, Math.round(size || 256)));
  const key = `${id}@${size}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const p = (queue = queue.then(() => new Promise((res) => setTimeout(res, 0))).then(() => {
    try { return renderNow(id, def, getModelFn, size); } catch (err) {
      console.warn(`[头像] ${id} 渲染失败：`, err);
      return null;
    }
  }));
  CACHE.set(key, p);
  return p;
}

function renderNow(id, def, getModelFn, size) {
  if (typeof document === 'undefined') return null;
  const gl = ensureGL();
  const model = getModelFn();
  const ent = { id: -1, type: 'champion', alive: true, x: 0, y: 0, z: 0, facing: 0, anim: { state: 'idle', t: 0, speed: 1, windup: 0.3, attackIndex: 0, slot: null }, modelState: {} };
  const view = createModelView(model, ent, null, { seed: 0.25, portrait: true });
  for (let i = 0; i < 24; i++) { ent.anim.t += 1 / 30; view.update(1 / 30, ent, null); }
  const root = view.object3d;
  root.rotation.y = -0.5;          // 正前方 +X 转向镜头右前方，略侧身
  SCENE.add(root);
  root.updateMatrixWorld(true);

  // 构图：以头部为中心的半身像（头顶 → 胸下）
  const M = model.bp.meta.M;
  const H = model.bp.meta.height || 220;
  const headW = new THREE.Vector3();
  const hb = view._v.bones.head;
  hb.getWorldPosition(headW);
  const hr = M ? M.headR : H * 0.09;
  if (M) headW.y += M.headC[1];
  const tall = model.bp.meta.portraitSpan ?? (hr * 5.2);   // 画面竖向覆盖范围
  const cy = headW.y - hr * 0.95 + (model.bp.meta.portraitLift || 0);
  const fov = 28;
  const dist = (tall / 2) / Math.tan((fov / 2) * Math.PI / 180);
  const cam = new THREE.PerspectiveCamera(fov, 1, 1, dist * 4);
  const dir = new THREE.Vector3(0.93, 0.12, 0.34).normalize();
  const tgt = new THREE.Vector3(headW.x * 0.6, cy, headW.z * 0.6);
  cam.position.copy(tgt).addScaledVector(dir, dist);
  cam.lookAt(tgt);

  // 布光：主光右上前、补光左前、轮廓光在背后（取背景主色提亮）
  const bg = Array.isArray(def?.portrait?.bg) ? def.portrait.bg : ['#4a5a7a', '#10141c'];
  const rimC = new THREE.Color(hexToInt(bg[0], 0x88aaff)).lerp(new THREE.Color(0xffffff), 0.45);
  KEY.position.copy(tgt).add(new THREE.Vector3(260, 300, 260)); KEY.target.position.copy(tgt);
  FILL.position.copy(tgt).add(new THREE.Vector3(200, 60, -320)); FILL.target.position.copy(tgt);
  RIM.color.copy(rimC);
  RIM.position.copy(tgt).add(new THREE.Vector3(-320, 180, -120)); RIM.target.position.copy(tgt);

  gl.setSize(size, size, false);
  gl.render(SCENE, cam);

  // 2D 合成
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size * 0.5, size * 0.38, size * 0.04, size * 0.5, size * 0.55, size * 0.78);
  grd.addColorStop(0, bg[0]);
  grd.addColorStop(1, bg[1] || bg[0]);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  // 背后光晕
  const halo = g.createRadialGradient(size * 0.5, size * 0.4, 0, size * 0.5, size * 0.4, size * 0.45);
  halo.addColorStop(0, 'rgba(255,255,255,0.22)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);
  g.drawImage(gl.domElement, 0, 0, size, size);
  // 暗角 + 底部压暗
  const vig = g.createRadialGradient(size * 0.5, size * 0.45, size * 0.35, size * 0.5, size * 0.5, size * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = vig;
  g.fillRect(0, 0, size, size);
  const bot = g.createLinearGradient(0, size * 0.72, 0, size);
  bot.addColorStop(0, 'rgba(0,0,0,0)');
  bot.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = bot;
  g.fillRect(0, 0, size, size);
  const url = c.toDataURL('image/png');

  SCENE.remove(root);
  view.dispose();
  return url;
}
