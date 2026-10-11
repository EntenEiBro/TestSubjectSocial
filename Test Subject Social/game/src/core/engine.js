/**
 * engine.js — renderer, main loop and camera effects.
 *
 * The game renders into a 16:9 buffer of a chosen height (`renderHeight`:
 * 360 / 540 / 720 / 1080 lines, default 1080p) which is shown inside the
 * letterboxed stage. Low settings give a crunchy retro look (upscaled with
 * nearest-neighbour filtering); HD settings add anti-aliasing and sharper
 * shadows. Letterbox bars, film grain and vignette are layered on top via
 * CSS (see css/style.css) so they cost nothing on the GPU.
 */
import * as THREE from 'three';

const SAFE_GFX_KEY = 'tss.safeGraphics';

/** Internal render heights offered in CALIBRATION (16:9). */
export const RESOLUTIONS = [
  { h: 360, label: 'RETRO 360p' },
  { h: 540, label: 'GRAINY 540p' },
  { h: 720, label: 'HD 720p' },
  { h: 1080, label: 'FULL HD 1080p' },
];

/**
 * Real-time shadows are off on phones/tablets (they crash some mobile GPU
 * drivers, e.g. the Pixel 10's, and cost a lot of fill rate), when ?shadows=0
 * is given, or after a previous GPU context loss on this device.
 */
function shadowsAllowed(q) {
  if (q.get('shadows') === '0') return false;
  if (q.get('shadows') === '1') return true;
  if (window.AndroidBridge || (window.matchMedia && matchMedia('(pointer: coarse)').matches)) return false;
  try { if (localStorage.getItem(SAFE_GFX_KEY) === '1') return false; } catch (_) { /* storage unavailable */ }
  return true;
}

export class Engine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{renderHeight?: number}} opts  internal render height in lines (16:9)
   */
  constructor(canvas, { renderHeight = 1080 } = {}) {
    this.canvas = canvas;
    this.renderHeight = renderHeight;
    // HD settings get MSAA; it is fixed when the context is created, so a
    // change between retro and HD takes effect on the next launch.
    this.hd = renderHeight >= 720;
    // Compatibility switches: ?shadows=0, ?gpu=default|low-power
    const q = new URLSearchParams(location.search);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.hd, powerPreference: q.get('gpu') || 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = shadowsAllowed(q);
    // If the GPU driver drops our context (some mobile GPUs choke on shadow
    // maps), remember it and restart once in safe mode instead of showing a
    // blank screen.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (!this.renderer.shadowMap.enabled) return; // already in safe mode
      try { localStorage.setItem(SAFE_GFX_KEY, '1'); } catch (_) { /* storage unavailable */ }
      location.reload();
    });
    // Hard-edged retro shadows at low resolutions, filtered ones in HD.
    this.renderer.shadowMap.type = this.hd ? THREE.PCFShadowMap : THREE.BasicShadowMap;
    this.renderer.setClearColor(0x050505);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.timeScale = 1;
    this._updaters = new Set();
    this._shake = 0;
    this._camBase = null;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Keep a fixed 16:9 frame inside the window (the rest is letterbox). */
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    let vw = w, vh = Math.round((w * 9) / 16);
    if (vh > h) { vh = h; vw = Math.round((h * 16) / 9); }
    this.viewW = vw; this.viewH = vh;
    this.canvas.style.width = `${vw}px`;
    this.canvas.style.height = `${vh}px`;
    // Render at the chosen height, but never above the screen's physical
    // pixels (that would cost GPU time without adding any detail).
    const physical = Math.round(vh * (window.devicePixelRatio || 1));
    const bufH = Math.max(90, Math.min(this.renderHeight, physical));
    this.bufferSize = { w: Math.round((bufH * 16) / 9), h: bufH };
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.bufferSize.w, this.bufferSize.h, false);
    // Crisp pixel upscaling only for the retro settings.
    this.canvas.style.imageRendering = this.hd ? 'auto' : 'pixelated';
    this.camera.aspect = 16 / 9;
    this.camera.updateProjectionMatrix();
    document.documentElement.style.setProperty('--view-w', `${vw}px`);
    document.documentElement.style.setProperty('--view-h', `${vh}px`);
  }

  /** Change the render height at runtime (anti-aliasing follows on next launch). */
  setRenderHeight(h) { this.renderHeight = h; this.resize(); }

  /** Swap the active scene + camera (each minigame owns its own). */
  setScene(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    // Sharper shadow maps in HD (scenes create 512px maps by default).
    if (this.hd && this.renderer.shadowMap.enabled) {
      scene.traverse((o) => {
        if (o.isLight && o.castShadow && o.shadow.mapSize.x < 1024) {
          o.shadow.mapSize.set(1024, 1024);
          if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
        }
      });
    }
    this.camera.aspect = 16 / 9;
    this.camera.updateProjectionMatrix();
    this._camBase = null;
  }

  /** Register a per-frame callback `fn(dt, time)`. Returns an unsubscribe fn. */
  onUpdate(fn) { this._updaters.add(fn); return () => this._updaters.delete(fn); }

  /** Add camera shake (decays automatically). */
  shake(amount = 0.3) { this._shake = Math.min(1.5, this._shake + amount); }

  /** Start the render loop. `frame(dt)` is called before rendering. */
  start(frame) {
    const loop = () => {
      requestAnimationFrame(loop);
      const raw = Math.min(this.clock.getDelta(), 1 / 20); // avoid huge steps after tab switches
      const dt = raw * this.timeScale;
      this.time += dt;
      frame(dt, raw);
      for (const fn of this._updaters) fn(dt, this.time);
      this._applyShake(raw);
      this.renderer.render(this.scene, this.camera);
      this._restoreShake();
    };
    requestAnimationFrame(loop);
  }

  _applyShake(dt) {
    if (this._shake <= 0.001) return;
    const c = this.camera;
    this._camBase = c.position.clone();
    const s = this._shake * 0.25;
    c.position.x += (Math.random() - 0.5) * s;
    c.position.y += (Math.random() - 0.5) * s;
    c.position.z += (Math.random() - 0.5) * s;
    this._shake = Math.max(0, this._shake - dt * 2.2);
  }

  _restoreShake() {
    if (this._camBase) { this.camera.position.copy(this._camBase); this._camBase = null; }
  }
}

/**
 * Build a fresh scene with the standard moody lighting rig: dim ambient,
 * a hemisphere fill and fog. Minigames add their own key lights.
 */
export function createMoodScene({ fog = 0x0b0b0b, fogNear = 12, fogFar = 60, ambient = 0x3a3a40, ambientIntensity = 0.9 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(fog);
  scene.fog = new THREE.Fog(fog, fogNear, fogFar);
  scene.add(new THREE.AmbientLight(ambient, ambientIntensity));
  const hemi = new THREE.HemisphereLight(0x9a9a8a, 0x201a14, 0.5);
  scene.add(hemi);
  return scene;
}

/** Convenience: a hanging industrial lamp (spot light + visible shade + bulb). */
export function hangingLamp(scene, x, y, z, { color = 0xffe2b0, intensity = 60, angle = 0.75, distance = 30, shadow = true, target = null } = {}) {
  const group = new THREE.Group();
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 0.45, 8, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x2b2e2a, side: THREE.DoubleSide }),
  );
  shade.position.y = 0.1;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color }));
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  cord.position.y = 2.3;
  group.add(shade, bulb, cord);
  group.position.set(x, y, z);
  const light = new THREE.SpotLight(color, intensity, distance, angle, 0.5, 1.4);
  light.position.set(0, 0, 0);
  light.castShadow = shadow;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.002;
  group.add(light);
  const tgt = new THREE.Object3D();
  if (target) tgt.position.set(target.x - x, target.y - y, target.z - z); else tgt.position.set(0, -10, 0);
  group.add(tgt);
  light.target = tgt;
  scene.add(group);
  return { group, light, bulb };
}
