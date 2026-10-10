/**
 * textures.js — procedural "grungy industrial" textures and materials.
 *
 * All surfaces are painted at runtime onto small canvases (64–128px) and
 * sampled with nearest-neighbour filtering. Combined with the low render
 * resolution this gives the crunchy, dirty late-90s look of the reference.
 */
import * as THREE from 'three';
import { rand } from './util.js';

const cache = new Map();

/** Create a canvas texture painted by `paint(ctx, size)`. Results are cached by key. */
export function canvasTexture(key, size, paint, { repeat = [1, 1] } = {}) {
  const cacheKey = `${key}|${repeat.join('x')}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  paint(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true; // cached across rounds — never dispose
  cache.set(cacheKey, tex);
  return tex;
}

/** Sprinkle per-pixel noise and blotchy stains over a base colour. */
function grime(ctx, s, base, { noise = 30, stains = 14, stainColor = 'rgba(20,15,10,0.18)', streaks = 0 } = {}) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * noise;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < stains; i++) {
    const r = rand(s * 0.05, s * 0.25);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, stainColor);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(rand(0, s), rand(0, s));
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  for (let i = 0; i < streaks; i++) {
    ctx.fillStyle = `rgba(10,8,5,${rand(0.05, 0.15)})`;
    ctx.fillRect(rand(0, s), rand(0, s * 0.5), rand(1, 3), rand(s * 0.2, s * 0.8));
  }
}

/** Library of named textures. `repeat` controls tiling. */
export const Tex = {
  concrete: (repeat) => canvasTexture('concrete', 128, (c, s) => {
    grime(c, s, '#6d6a63', { noise: 34, stains: 22, streaks: 10 });
    c.strokeStyle = 'rgba(30,28,25,0.35)'; c.lineWidth = 1;
    for (let i = 0; i < 4; i++) { c.beginPath(); let x = rand(0, s), y = rand(0, s); c.moveTo(x, y); for (let k = 0; k < 5; k++) { x += rand(-12, 12); y += rand(-12, 12); c.lineTo(x, y); } c.stroke(); }
  }, { repeat }),

  wall: (repeat) => canvasTexture('wall', 128, (c, s) => {
    grime(c, s, '#7a776d', { noise: 30, stains: 18, streaks: 26 });
    c.fillStyle = 'rgba(40,35,30,0.25)';
    c.fillRect(0, s * 0.82, s, s * 0.18);
  }, { repeat }),

  tiles: (repeat) => canvasTexture('tiles', 64, (c, s) => {
    grime(c, s, '#4b4f4a', { noise: 24, stains: 8 });
    c.strokeStyle = '#25261f'; c.lineWidth = 2;
    c.strokeRect(1, 1, s - 2, s - 2);
    c.beginPath(); c.moveTo(s / 2, 0); c.lineTo(s / 2, s); c.moveTo(0, s / 2); c.lineTo(s, s / 2); c.stroke();
  }, { repeat }),

  metal: (repeat) => canvasTexture('metal', 64, (c, s) => {
    grime(c, s, '#5c605f', { noise: 20, stains: 10, stainColor: 'rgba(90,50,20,0.25)' });
    c.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 0; y < s; y += 4) c.fillRect(0, y, s, 1);
  }, { repeat }),

  plate: (repeat) => canvasTexture('plate', 64, (c, s) => {
    grime(c, s, '#575b58', { noise: 18, stains: 8, stainColor: 'rgba(110,60,20,0.25)' });
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.strokeRect(0.5, 0.5, s - 1, s - 1);
    c.fillStyle = '#2b2d2b';
    for (const [x, y] of [[5, 5], [s - 6, 5], [5, s - 6], [s - 6, s - 6]]) { c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < s; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 8, 8); c.stroke(); }
  }, { repeat }),

  rust: (repeat) => canvasTexture('rust', 64, (c, s) => grime(c, s, '#6e3f22', { noise: 40, stains: 16, stainColor: 'rgba(30,15,5,0.35)' }), { repeat }),

  wood: (repeat) => canvasTexture('wood', 64, (c, s) => {
    grime(c, s, '#6b4a2f', { noise: 22, stains: 6 });
    c.strokeStyle = 'rgba(40,25,10,0.45)';
    for (let y = 0; y < s; y += rand(3, 7)) { c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(s / 3, y + rand(-3, 3), (2 * s) / 3, y + rand(-3, 3), s, y); c.stroke(); }
  }, { repeat }),

  crate: (repeat) => canvasTexture('crate', 64, (c, s) => {
    grime(c, s, '#7b5d38', { noise: 26, stains: 6 });
    c.strokeStyle = '#3d2b16'; c.lineWidth = 5; c.strokeRect(2.5, 2.5, s - 5, s - 5);
    c.lineWidth = 4; c.beginPath(); c.moveTo(4, 4); c.lineTo(s - 4, s - 4); c.stroke();
  }, { repeat }),

  hazard: (repeat) => canvasTexture('hazard', 64, (c, s) => {
    c.fillStyle = '#c9a227'; c.fillRect(0, 0, s, s);
    c.fillStyle = '#1b1a17';
    for (let i = -s; i < s * 2; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 8, 0); c.lineTo(i + 8 - s, s); c.lineTo(i - s, s); c.fill(); }
    const img = c.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 40; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    c.putImageData(img, 0, 0);
  }, { repeat }),

  fabric: (repeat) => canvasTexture('fabric', 32, (c, s) => grime(c, s, '#ffffff', { noise: 40, stains: 4, stainColor: 'rgba(0,0,0,0.12)' }), { repeat }),

  dirt: (repeat) => canvasTexture('dirt', 128, (c, s) => {
    grime(c, s, '#4a4434', { noise: 46, stains: 26, stainColor: 'rgba(20,18,10,0.3)' });
    c.fillStyle = 'rgba(70,90,40,0.25)';
    for (let i = 0; i < 60; i++) c.fillRect(rand(0, s), rand(0, s), rand(1, 3), rand(2, 5));
  }, { repeat }),

  blood: () => canvasTexture('blood', 64, (c, s) => {
    c.clearRect(0, 0, s, s);
    for (let i = 0; i < 9; i++) {
      c.fillStyle = `rgba(${90 + Math.random() * 40},0,0,${0.7 + Math.random() * 0.3})`;
      c.beginPath(); c.arc(s / 2 + rand(-14, 14), s / 2 + rand(-14, 14), rand(5, 16), 0, Math.PI * 2); c.fill();
    }
    for (let i = 0; i < 14; i++) { c.beginPath(); c.arc(rand(4, s - 4), rand(4, s - 4), rand(1, 3), 0, 7); c.fill(); }
  }),
};

// ------------------------------------------------------------------ materials

/** Lambert material (cheap, flat, retro) with an optional texture. */
export function mat(color = 0xffffff, map = null, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, map, ...extra });
}

/** Unlit glowing material for monitors, symbols, lamps. */
export function glow(color) {
  return new THREE.MeshBasicMaterial({ color });
}

/**
 * Paint text or a glyph onto a canvas and return a texture. Used for wall
 * stencils ("HIDE"), monitors, scoreboards and symbols.
 */
export function textTexture(text, {
  w = 256, h = 128, font = 'Black Ops One', size = 80, color = '#d8d2c0', bg = null, grimy = true,
} = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = color;
  ctx.font = `${size}px "${font}", Impact, sans-serif`;
  // Shrink the font until the text fits the canvas width with a small margin.
  const fit = (w * 0.92) / Math.max(1, ctx.measureText(text).width);
  if (fit < 1) { size = Math.floor(size * fit); ctx.font = `${size}px "${font}", Impact, sans-serif`; }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + size * 0.05);
  if (grimy) {
    // Knock holes into the paint for a worn stencil look.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.6})`; ctx.fillRect(rand(0, w), rand(0, h), rand(1, 4), rand(1, 4)); }
    ctx.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
