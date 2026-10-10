/**
 * environment.js — reusable set-dressing builders for industrial rooms.
 *
 * Every minigame stage is assembled from these primitives so the whole game
 * shares one coherent look: stained concrete, rusted plate, hazard stripes,
 * hanging lamps, pipes, stencilled wall text and green CRT monitors.
 */
import * as THREE from 'three';
import { Tex, mat, glow, textTexture } from './textures.js';

/** Shadow-enabled mesh helper. */
export function mesh(geo, material, x = 0, y = 0, z = 0, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

/** Axis-aligned box placed by its centre. */
export function block(scene, x, y, z, w, h, d, material) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);
  scene.add(m);
  return m;
}

/** Floor plane of size w×d with a tiled texture. */
export function floor(scene, w, d, { tex = 'concrete', tile = 4, y = 0, color = 0xffffff, x = 0, z = 0 } = {}) {
  const m = mesh(new THREE.PlaneGeometry(w, d), mat(color, Tex[tex]([w / tile, d / tile])), x, y, z, { cast: false });
  m.rotation.x = -Math.PI / 2;
  scene.add(m);
  return m;
}

/**
 * Closed room: floor + 4 walls (+ optional ceiling). Walls facing the camera
 * (+Z side) can be omitted with `open` so fixed cameras see inside.
 */
export function room(scene, w, d, h, { wallTex = 'wall', floorTex = 'concrete', open = ['south'], ceiling = false, tile = 4 } = {}) {
  const group = new THREE.Group();
  floor(group, w, d, { tex: floorTex, tile });
  const wm = mat(0xffffff, Tex[wallTex]([w / tile, h / tile]));
  const wmSide = mat(0xffffff, Tex[wallTex]([d / tile, h / tile]));
  const walls = {
    north: [0, h / 2, -d / 2, w, h, 0.3, wm],
    south: [0, h / 2, d / 2, w, h, 0.3, wm],
    west: [-w / 2, h / 2, 0, 0.3, h, d, wmSide],
    east: [w / 2, h / 2, 0, 0.3, h, d, wmSide],
  };
  for (const [k, [x, y, z, ww, hh, dd, m]] of Object.entries(walls)) {
    if (open.includes(k)) continue;
    block(group, x, y, z, ww, hh, dd, m);
  }
  if (ceiling) {
    const c = mesh(new THREE.PlaneGeometry(w, d), mat(0x3a3a3a, Tex.concrete([w / tile, d / tile])), 0, h, 0, { cast: false });
    c.rotation.x = Math.PI / 2;
    group.add(c);
  }
  scene.add(group);
  return group;
}

/** Big worn stencil lettering painted on a wall plane. */
export function stencil(scene, text, x, y, z, { w = 6, h = 2.2, rotY = 0, color = '#cfc8b4', opacity = 0.75 } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({
    map: textTexture(text, { w: 512, h: 192, size: 150, color }), transparent: true, opacity, depthWrite: false,
  }));
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  scene.add(m);
  return m;
}

/** A pipe run between two points. */
export function pipe(scene, a, b, r = 0.12, color = 0x4d4a44) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = mesh(new THREE.CylinderGeometry(r, r, len, 6), mat(color, Tex.rust()));
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  scene.add(m);
  return m;
}

/** Wooden crate. */
export function crate(scene, x, y, z, s = 1, rot = 0) {
  const m = mesh(new THREE.BoxGeometry(s, s, s), mat(0xffffff, Tex.crate()), x, y + s / 2, z);
  m.rotation.y = rot;
  scene.add(m);
  return m;
}

/** Hazard-striped strip on the floor (edges of pits, danger zones). */
export function hazardStrip(scene, x, z, w, d, y = 0.01) {
  const m = mesh(new THREE.PlaneGeometry(w, d), mat(0xffffff, Tex.hazard([Math.max(1, w / 1.5), Math.max(1, d / 1.5)])), x, y, z, { cast: false });
  m.rotation.x = -Math.PI / 2;
  scene.add(m);
  return m;
}

/**
 * Green CRT monitor with a canvas screen you can redraw. Returns
 * { group, draw(fn) } where fn(ctx, w, h) paints the screen.
 */
export function monitor(scene, x, y, z, { w = 1.4, h = 1.05, rotY = 0, rotX = 0 } = {}) {
  const group = new THREE.Group();
  const caseM = mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.8), mat(0x3b3a33, Tex.plate()));
  caseM.position.z = -0.35;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 96;
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.z = 0.06;
  group.add(caseM, screen);
  group.position.set(x, y, z);
  group.rotation.set(rotX, rotY, 0);
  scene.add(group);
  const ctx = canvas.getContext('2d');
  const draw = (fn) => {
    ctx.fillStyle = '#041004'; ctx.fillRect(0, 0, 128, 96);
    fn(ctx, 128, 96);
    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let yy = 0; yy < 96; yy += 2) ctx.fillRect(0, yy, 128, 1);
    tex.needsUpdate = true;
  };
  draw(() => {});
  return { group, draw, screen };
}

/** Draw one of the floor/monitor symbols (X, O, square, triangle) on a canvas. */
export function drawSymbol(ctx, sym, cx, cy, r, color = '#39ff5a', lw = 8) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'square';
  ctx.beginPath();
  if (sym === 'X') { ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); }
  else if (sym === 'O') { ctx.arc(cx, cy, r, 0, Math.PI * 2); }
  else if (sym === 'S') { ctx.rect(cx - r, cy - r, r * 2, r * 2); }
  else if (sym === 'T') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r * 0.8); ctx.lineTo(cx - r, cy + r * 0.8); ctx.closePath(); }
  ctx.stroke();
}

/** Spinning extractor fan set into a wall. */
export function wallFan(scene, x, y, z, { r = 1.2, rotY = 0 } = {}) {
  const g = new THREE.Group();
  const ring = mesh(new THREE.TorusGeometry(r, 0.15, 6, 16), mat(0x3a3a36, Tex.metal()));
  const blades = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const b = mesh(new THREE.BoxGeometry(0.3, r * 0.95, 0.04), mat(0x5a5a52, Tex.metal()), 0, r * 0.45, 0);
    const pivot = new THREE.Group(); pivot.rotation.z = (i / 5) * Math.PI * 2; b.rotation.y = 0.4; pivot.add(b); blades.add(pivot);
  }
  const back = mesh(new THREE.CircleGeometry(r, 16), glow(0x050505), 0, 0, -0.1);
  g.add(back, ring, blades);
  g.position.set(x, y, z); g.rotation.y = rotY;
  scene.add(g);
  return { group: g, update: (dt) => { blades.rotation.z += dt * 3; } };
}

/** Thin floating ring marker under an avatar, tinted with the player colour. */
export function playerRing(color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  return m;
}
