/**
 * characters.js — the customizable "test subject" avatar.
 *
 * A low-poly box-built humanoid in a numbered jumpsuit. The rig is a small
 * hierarchy of pivots so limbs can be animated procedurally and, on death,
 * detached into individual physics debris (see fx.js).
 *
 *   root (feet on y=0, faces +Z)
 *    └ hips
 *       ├ legL / legR        (pivot at hip joint)
 *       └ torso
 *          ├ armL / armR     (pivot at shoulder)
 *          └ head
 *             ├ face accessory
 *             └ hat
 */
import * as THREE from 'three';
import { Tex, mat, textTexture } from './textures.js';
import { clamp, damp, lerp } from './util.js';

/** Jumpsuit colours offered in the lobby. */
export const SUIT_COLORS = [
  { name: 'Hazard Orange', hex: 0xc4561f },
  { name: 'Ward Teal', hex: 0x2f7d74 },
  { name: 'Mustard', hex: 0xb89a2c },
  { name: 'Oxblood', hex: 0x7c2323 },
  { name: 'Surplus Olive', hex: 0x5a6a2e },
  { name: 'Coolant Blue', hex: 0x2d4f8f },
  { name: 'Bleach White', hex: 0xc9c5b8 },
  { name: 'Bruise Purple', hex: 0x5b3a72 },
];

export const SKIN_TONES = [0xe2b896, 0xc68e66, 0x8d5a3b, 0x5b3a26, 0xb9b38f];

/** Headwear options. Names are what the lobby displays. */
export const HATS = ['None', 'Hard Hat', 'Beanie', 'Bucket', 'Paper Bag', 'Top Hat', 'Gas Mask', 'Welder', 'Headlamp', 'Party Hat'];
export const FACES = ['Plain', 'Goggles', 'Shades', 'Bandage', 'Monocle', 'Mustache'];

/** Signature colour per player slot (UI accents, markers). */
export const SLOT_COLORS = ['#e2582a', '#3fb6a8', '#d9c24a', '#b45ad6'];

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Build a mesh with shadows enabled. */
function part(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Build headwear geometry for a hat name. Returns a Group or null. */
function buildHat(name, color) {
  const g = new THREE.Group();
  const M = (c, map) => mat(c, map || Tex.fabric());
  switch (name) {
    case 'Hard Hat': {
      const dome = part(new THREE.SphereGeometry(0.27, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), M(0xd8b02a));
      const brim = part(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 10), M(0xc9a020));
      dome.position.y = 0.17; brim.position.y = 0.17; brim.position.z = 0.04;
      g.add(dome, brim); break;
    }
    case 'Beanie': {
      const b = part(new THREE.SphereGeometry(0.26, 8, 5, 0, Math.PI * 2, 0, Math.PI / 1.8), M(color));
      const fold = part(new THREE.CylinderGeometry(0.265, 0.265, 0.08, 10), M(new THREE.Color(color).multiplyScalar(0.7)));
      b.position.y = 0.12; fold.position.y = 0.13;
      const pom = part(new THREE.SphereGeometry(0.07, 6, 4), M(0xdddddd)); pom.position.y = 0.38;
      g.add(b, fold, pom); break;
    }
    case 'Bucket': {
      const bk = part(new THREE.CylinderGeometry(0.25, 0.3, 0.42, 10, 1, true), mat(0x7e8486, Tex.metal(), { side: THREE.DoubleSide }));
      bk.position.y = 0.12;
      const top = part(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 10), mat(0x6e7476, Tex.metal()));
      top.position.y = 0.33;
      g.add(bk, top); break;
    }
    case 'Paper Bag': {
      const bag = part(box(0.48, 0.58, 0.44), mat(0xa88a5c, Tex.fabric()));
      bag.position.y = 0.02;
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
      const e1 = part(box(0.07, 0.06, 0.01), eyeMat, -0.1, 0.06, 0.225);
      const e2 = part(box(0.07, 0.06, 0.01), eyeMat, 0.1, 0.06, 0.225);
      g.add(bag, e1, e2); break;
    }
    case 'Top Hat': {
      const t = part(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 10), M(0x1d1c1f));
      const br = part(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 12), M(0x1d1c1f));
      const band = part(new THREE.CylinderGeometry(0.205, 0.205, 0.06, 10), M(0x7a1f1f));
      t.position.y = 0.38; br.position.y = 0.19; band.position.y = 0.23;
      g.add(t, br, band); break;
    }
    case 'Gas Mask': {
      const m = part(box(0.36, 0.26, 0.12), mat(0x2f322c, Tex.fabric()), 0, -0.06, 0.2);
      const can = part(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 8), mat(0x4d5246, Tex.metal()), 0, -0.14, 0.3);
      can.rotation.x = Math.PI / 2;
      const glass = new THREE.MeshBasicMaterial({ color: 0x8fa38a });
      g.add(m, can, part(new THREE.CircleGeometry(0.06, 8), glass, -0.09, 0.05, 0.226), part(new THREE.CircleGeometry(0.06, 8), glass, 0.09, 0.05, 0.226));
      break;
    }
    case 'Welder': {
      const v = part(box(0.44, 0.42, 0.08), mat(0x2a2a26, Tex.metal()), 0, 0.02, 0.24);
      const win = part(box(0.26, 0.07, 0.01), new THREE.MeshBasicMaterial({ color: 0x1f3d1c }), 0, 0.06, 0.285);
      const strap = part(new THREE.TorusGeometry(0.25, 0.025, 4, 12), mat(0x222222), 0, 0.08, 0);
      strap.rotation.x = Math.PI / 2;
      g.add(v, win, strap); break;
    }
    case 'Headlamp': {
      const strap = part(new THREE.TorusGeometry(0.255, 0.03, 4, 14), mat(0x202020), 0, 0.07, 0);
      strap.rotation.x = Math.PI / 2;
      const lamp = part(box(0.12, 0.09, 0.06), mat(0x444444), 0, 0.08, 0.27);
      const lens = part(new THREE.CircleGeometry(0.04, 8), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }), 0, 0.08, 0.301);
      g.add(strap, lamp, lens); break;
    }
    case 'Party Hat': {
      const c = part(new THREE.ConeGeometry(0.17, 0.45, 8), M(color));
      c.position.y = 0.4; c.rotation.z = 0.15;
      const pom = part(new THREE.SphereGeometry(0.05, 6, 4), M(0xeeeeee)); pom.position.set(-0.035, 0.63, 0);
      g.add(c, pom); break;
    }
    default: return null;
  }
  return g;
}

/** Build a face accessory group. */
function buildFace(name) {
  const g = new THREE.Group();
  const black = new THREE.MeshBasicMaterial({ color: 0x0b0b0b });
  switch (name) {
    case 'Goggles': {
      const f = mat(0x3a2e22);
      g.add(part(new THREE.TorusGeometry(0.07, 0.025, 4, 8), f, -0.1, 0.05, 0.23), part(new THREE.TorusGeometry(0.07, 0.025, 4, 8), f, 0.1, 0.05, 0.23));
      const lens = new THREE.MeshBasicMaterial({ color: 0x6f8f6a });
      g.add(part(new THREE.CircleGeometry(0.06, 8), lens, -0.1, 0.05, 0.232), part(new THREE.CircleGeometry(0.06, 8), lens, 0.1, 0.05, 0.232));
      break;
    }
    case 'Shades':
      g.add(part(box(0.36, 0.08, 0.02), black, 0, 0.05, 0.23)); break;
    case 'Bandage': {
      const w = mat(0xd8d2c0, Tex.fabric());
      const b = part(box(0.46, 0.08, 0.46), w, 0, 0.08, 0); b.rotation.z = 0.25; g.add(b);
      g.add(part(box(0.06, 0.06, 0.01), black, 0.09, 0.0, 0.226)); break;
    }
    case 'Monocle':
      g.add(part(new THREE.TorusGeometry(0.06, 0.015, 4, 10), mat(0xc0a040), 0.1, 0.05, 0.232));
      g.add(part(box(0.05, 0.05, 0.01), black, -0.1, 0.05, 0.226), part(box(0.05, 0.05, 0.01), black, 0.1, 0.05, 0.226));
      break;
    case 'Mustache':
      g.add(part(box(0.22, 0.05, 0.03), mat(0x2a1a10), 0, -0.07, 0.23));
      g.add(part(box(0.05, 0.05, 0.01), black, -0.1, 0.05, 0.226), part(box(0.05, 0.05, 0.01), black, 0.1, 0.05, 0.226));
      break;
    default: // Plain: just two dot eyes and a mouth slit
      g.add(part(box(0.05, 0.05, 0.01), black, -0.1, 0.05, 0.226), part(box(0.05, 0.05, 0.01), black, 0.1, 0.05, 0.226));
      g.add(part(box(0.12, 0.02, 0.01), black, 0, -0.09, 0.226));
  }
  return g;
}

/**
 * A playable avatar. Construct with a `look` ({suit, skin, hat, face, number})
 * and add `subject.root` to a scene.
 */
export class Subject {
  constructor(look = {}) {
    this.look = {
      suit: SUIT_COLORS[0].hex, skin: SKIN_TONES[0], hat: 'None', face: 'Plain', number: '00', ...look,
    };
    this.root = new THREE.Group();
    this.walkPhase = 0;
    this.speed = 0;           // current locomotion speed used for the walk cycle
    this.pose = 'idle';       // 'idle' | 'carry' | 'aim' | 'armsUp' | 'sit' | 'cower' | 'push'
    this.poseBlend = 0;
    this.pushTimer = 0;
    this.parts = {};
    this._build();
  }

  _build() {
    const L = this.look;
    const suitTex = Tex.fabric();
    const suit = mat(L.suit, suitTex);
    const suitDark = mat(new THREE.Color(L.suit).multiplyScalar(0.65), suitTex);
    const skin = mat(L.skin, Tex.fabric());
    const boots = mat(0x231d18);

    const hips = new THREE.Group(); hips.position.y = 0.92; this.root.add(hips);
    const pelvis = part(box(0.46, 0.2, 0.26), suitDark, 0, 0, 0); hips.add(pelvis);

    const mkLeg = (side) => {
      const pivot = new THREE.Group(); pivot.position.set(0.12 * side, -0.05, 0);
      const thigh = part(box(0.18, 0.5, 0.2), suit, 0, -0.27, 0);
      const shin = part(box(0.16, 0.36, 0.18), suit, 0, -0.66, 0);
      const boot = part(box(0.19, 0.12, 0.3), boots, 0, -0.82, 0.05);
      pivot.add(thigh, shin, boot);
      hips.add(pivot);
      return pivot;
    };
    const legL = mkLeg(-1), legR = mkLeg(1);

    const torso = new THREE.Group(); torso.position.y = 0.08; hips.add(torso);
    const chest = part(box(0.52, 0.6, 0.3), suit, 0, 0.32, 0); torso.add(chest);
    // Chest number patch: identity at a glance in chaotic rounds.
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), new THREE.MeshBasicMaterial({
      map: textTexture(L.number, { w: 64, h: 48, size: 34, color: '#111', bg: '#d8d0b8', grimy: true }),
    }));
    patch.position.set(0, 0.42, 0.152); torso.add(patch);
    const collar = part(box(0.3, 0.06, 0.24), suitDark, 0, 0.64, 0); torso.add(collar);

    const mkArm = (side) => {
      const pivot = new THREE.Group(); pivot.position.set(0.33 * side, 0.56, 0);
      const upper = part(box(0.15, 0.4, 0.16), suit, 0, -0.18, 0);
      const fore = part(box(0.13, 0.34, 0.14), suit, 0, -0.52, 0);
      const hand = part(box(0.12, 0.13, 0.13), skin, 0, -0.74, 0);
      pivot.add(upper, fore, hand);
      pivot.userData.hand = hand;
      torso.add(pivot);
      return pivot;
    };
    const armL = mkArm(-1), armR = mkArm(1);
    const handL = armL.userData.hand, handR = armR.userData.hand;

    const head = new THREE.Group(); head.position.y = 0.88; torso.add(head);
    const neck = part(box(0.14, 0.12, 0.14), skin, 0, -0.16, 0); head.add(neck);
    const skull = part(box(0.42, 0.42, 0.42), skin, 0, 0.02, 0); head.add(skull);
    const face = buildFace(L.face); head.add(face);
    const hat = buildHat(L.hat, L.suit); if (hat) head.add(hat);

    // handL/handR are attachment points for held props (guns, forks, cigarettes...).
    this.parts = { hips, pelvis, legL, legR, torso, chest, armL, armR, handL, handR, head, skull, hat, face };
    // Hit-test meshes used for precision shooting (head vs body).
    skull.userData.hitZone = 'head';
    chest.userData.hitZone = 'body';
    pelvis.userData.hitZone = 'body';
  }

  /** Parts that fly off individually when the subject is torn apart. */
  get detachable() {
    const p = this.parts;
    return [p.head, p.armL, p.armR, p.legL, p.legR, p.torso];
  }

  /** Face a world-space direction angle (radians, 0 = +Z). Smoothly. */
  faceAngle(angle, dt, rate = 14) {
    const cur = this.root.rotation.y;
    let d = angle - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.root.rotation.y = cur + d * damp(rate, dt);
  }

  /** Trigger a short push animation. */
  push() { this.pushTimer = 0.25; }

  /**
   * Procedural animation. `speed` is the current ground speed in units/s.
   * Call every frame while the subject is alive.
   */
  animate(dt, speed = this.speed) {
    const p = this.parts;
    this.speed = speed;
    const moving = clamp(speed / 4, 0, 1.4);
    this.walkPhase += dt * (4 + speed * 2.2) * (moving > 0.05 ? 1 : 0);
    const s = Math.sin(this.walkPhase);
    const swing = 0.75 * moving;
    p.legL.rotation.x = s * swing;
    p.legR.rotation.x = -s * swing;
    const bob = Math.abs(Math.cos(this.walkPhase)) * 0.05 * moving;
    p.hips.position.y = 0.92 + bob;
    p.torso.rotation.z = Math.sin(this.walkPhase) * 0.04 * moving;

    // Arm pose targets
    let aL = -s * swing * 0.8, aR = s * swing * 0.8, zL = 0.05, zR = -0.05, lean = 0.08 * moving;
    switch (this.pose) {
      case 'carry': aL = aR = -1.25; zL = 0.25; zR = -0.25; break;
      case 'aim': aR = -1.55; aL = -1.35; zL = -0.35; zR = 0.05; break;
      case 'armsUp': aL = aR = -2.9; zL = 0.25; zR = -0.25; break;
      case 'cower': aL = aR = -2.2; zL = -0.6; zR = 0.6; lean = 0.45; break;
      case 'sit': aL = aR = -1.1; zL = 0.1; zR = -0.1; p.legL.rotation.x = p.legR.rotation.x = -1.5; lean = 0; break;
      case 'hold': aR = -1.2; zR = 0; break;
      default: break;
    }
    if (this.pushTimer > 0) { this.pushTimer -= dt; aL = aR = -1.6; zL = zR = 0; lean = 0.35; }
    const k = damp(16, dt);
    p.armL.rotation.x = lerp(p.armL.rotation.x, aL, k);
    p.armR.rotation.x = lerp(p.armR.rotation.x, aR, k);
    p.armL.rotation.z = lerp(p.armL.rotation.z, zL, k);
    p.armR.rotation.z = lerp(p.armR.rotation.z, zR, k);
    p.torso.rotation.x = lerp(p.torso.rotation.x, lean, k);
    p.head.rotation.x = lerp(p.head.rotation.x, -lean * 0.5, k);
  }

  /** Dispose GPU resources (geometries are tiny; materials are per-subject). */
  dispose() {
    this.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  }
}

/** Build a standalone Subject for a session player. */
export function subjectFor(player) {
  return new Subject({ ...player.look, number: String(player.slot + 1).padStart(2, '0') });
}
