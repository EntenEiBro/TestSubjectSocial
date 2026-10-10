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
import { Tex, mat, textTexture, canvasTexture } from './textures.js';
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

/**
 * Small tileable textures for headwear (knit ribs, party stripes, bag
 * creases). Cached per colour by canvasTexture().
 */
function hatTexture(kind, color) {
  const hex = `#${new THREE.Color(color).getHexString()}`;
  return canvasTexture(`hat-${kind}-${hex}`, 64, (c, s) => {
    c.fillStyle = hex; c.fillRect(0, 0, s, s);
    if (kind === 'knit') {
      // vertical ribs + tiny stitch noise
      for (let x = 0; x < s; x += 8) { c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(x, 0, 3, s); c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x + 4, 0, 2, s); }
      for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; c.fillRect(Math.random() * s, Math.random() * s, 2, 1); }
    } else if (kind === 'stripes') {
      c.fillStyle = '#f2ead8';
      for (let y = -s; y < s * 2; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(s, y + s * 0.5); c.lineTo(s, y + s * 0.5 + 7); c.lineTo(0, y + 7); c.fill(); }
      for (let i = 0; i < 18; i++) { c.fillStyle = ['#ffd84a', '#4ad2ff', '#ff5ab0'][i % 3]; c.fillRect(Math.random() * s, Math.random() * s, 3, 3); }
    } else if (kind === 'paper') {
      for (let i = 0; i < 14; i++) { c.strokeStyle = `rgba(60,40,15,${0.1 + Math.random() * 0.15})`; c.beginPath(); c.moveTo(Math.random() * s, 0); c.lineTo(Math.random() * s, s); c.stroke(); }
      for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; c.fillRect(Math.random() * s, Math.random() * s, 1, 1); }
    }
  });
}

/**
 * Build headwear for a hat name, fitted to the blocky head: the skull is a
 * 0.42 cube centred at y=0.02, so its top is at y≈0.23 and its face at z≈0.21.
 * Returns a Group or null.
 */
function buildHat(name, color) {
  const g = new THREE.Group();
  const add = (geo, material, x = 0, y = 0, z = 0, rot = null) => {
    const m = part(geo, material, x, y, z);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    g.add(m);
    return m;
  };
  const cyl = (rt, rb, h, seg = 20, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const metal = (c) => mat(c, Tex.metal());
  const dark = (c, k = 0.7) => new THREE.Color(c).multiplyScalar(k);

  switch (name) {
    case 'Hard Hat': {
      // Rounded shell that hugs the cube head, a centre ridge, a front peak and a sticker.
      const yellow = mat(0xe0b52a, Tex.fabric());
      const shell = add(new THREE.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), yellow, 0, 0.17, 0);
      shell.scale.set(1, 0.72, 1.04);
      add(cyl(0.305, 0.305, 0.05, 28), yellow, 0, 0.19, 0);                       // band where shell meets head
      add(box(0.07, 0.07, 0.56), mat(0xd0a420, Tex.fabric()), 0, 0.37, 0);          // ridge
      add(box(0.46, 0.035, 0.16), mat(0xcfa21f, Tex.fabric()), 0, 0.185, 0.33, [0.12, 0, 0]); // front peak
      add(new THREE.PlaneGeometry(0.12, 0.08), mat(0xffffff, Tex.hazard()), 0, 0.27, 0.302, [-0.35, 0, 0]); // sticker
      break;
    }
    case 'Beanie': {
      // Knit body with ribbed texture, a thick folded cuff and a fluffy pompom.
      const knit = mat(0xffffff, hatTexture('knit', color));
      const body = add(new THREE.SphereGeometry(0.28, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), knit, 0, 0.2, 0);
      body.scale.set(1.0, 0.85, 1.0);
      add(cyl(0.285, 0.29, 0.11, 24), mat(0xffffff, hatTexture('knit', dark(color))), 0, 0.2, 0); // cuff
      const pom = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const blob = part(new THREE.IcosahedronGeometry(0.05, 1), mat(0xeeeae0, Tex.fabric()), Math.sin(i * 1.7) * 0.03, Math.cos(i * 2.3) * 0.02, Math.cos(i * 1.7) * 0.03);
        pom.add(blob);
      }
      pom.position.y = 0.46;
      g.add(pom);
      break;
    }
    case 'Bucket': {
      // Dented metal pail, upside down, with a rolled rim, ribs and a dangling handle.
      const pail = metal(0x8a9092);
      add(cyl(0.22, 0.27, 0.4, 20, true), mat(0x8a9092, Tex.metal(), { side: THREE.DoubleSide }), 0, 0.15, 0);
      add(cyl(0.22, 0.22, 0.02, 20), pail, 0, 0.35, 0);                             // bottom (now the top)
      add(new THREE.TorusGeometry(0.27, 0.018, 6, 24), metal(0x9aa0a2), 0, -0.05, 0, [Math.PI / 2, 0, 0]); // rolled rim
      for (const y of [0.06, 0.24]) add(new THREE.TorusGeometry(0.25 - (y - 0.06) * 0.14, 0.01, 4, 24), metal(0x737a7c), 0, y, 0, [Math.PI / 2, 0, 0]); // ribs
      add(new THREE.TorusGeometry(0.2, 0.012, 4, 16, Math.PI), metal(0x5d6365), 0, -0.02, 0, [0, 0, Math.PI]); // handle
      add(box(0.06, 0.06, 0.02), metal(0x5d6365), 0.27, 0.0, 0);                     // handle lugs
      add(box(0.06, 0.06, 0.02), metal(0x5d6365), -0.27, 0.0, 0);
      add(new THREE.SphereGeometry(0.05, 8, 6), metal(0x7c8284), 0.12, 0.27, 0.19).scale.set(1, 0.5, 0.3); // dent
      break;
    }
    case 'Paper Bag': {
      // Creased grocery bag with a jagged rolled top, cut-out eyes and a wonky mouth.
      const paper = mat(0xb08f5c, hatTexture('paper', 0xb08f5c));
      add(box(0.5, 0.56, 0.48), paper, 0, 0.04, 0);
      for (let i = 0; i < 9; i++) {                                                  // jagged crumpled top edge
        const tooth = add(box(0.07, 0.08, 0.49), mat(0xa8854f, hatTexture('paper', 0xa8854f)), -0.22 + i * 0.055, 0.33 + (i % 2) * 0.02, 0);
        tooth.rotation.z = (i % 2 ? 0.25 : -0.25);
      }
      const hole = new THREE.MeshBasicMaterial({ color: 0x080808 });
      add(new THREE.CircleGeometry(0.045, 12), hole, -0.1, 0.08, 0.242);
      add(new THREE.CircleGeometry(0.04, 12), hole, 0.1, 0.09, 0.242);
      add(box(0.14, 0.025, 0.005), hole, 0.01, -0.08, 0.242, [0, 0, 0.12]);
      add(box(0.004, 0.5, 0.004), mat(0x7a5d34), 0.12, 0.04, 0.242);                  // vertical crease
      break;
    }
    case 'Top Hat': {
      // Tall silk crown that flares slightly, curled brim and a band with a buckle.
      const silk = mat(0x1c1b20, Tex.fabric());
      add(cyl(0.205, 0.185, 0.44, 24), silk, 0, 0.43, 0);
      add(cyl(0.205, 0.205, 0.02, 24), mat(0x2a2930, Tex.fabric()), 0, 0.655, 0);   // crown top
      add(cyl(0.34, 0.34, 0.025, 28), silk, 0, 0.215, 0);                           // brim
      add(new THREE.TorusGeometry(0.335, 0.022, 6, 28), silk, 0, 0.23, 0, [Math.PI / 2, 0, 0]); // curled edge
      add(cyl(0.19, 0.19, 0.07, 24), mat(0x7a1f1f, Tex.fabric()), 0, 0.27, 0);       // band
      add(box(0.07, 0.06, 0.02), metal(0xc9a742), 0, 0.27, 0.19);                    // buckle
      break;
    }
    case 'Gas Mask': {
      // Rubber face piece with framed round lenses, a ribbed filter canister and head straps.
      const rubber = mat(0x2c3029, Tex.fabric());
      add(box(0.4, 0.3, 0.1), rubber, 0, -0.02, 0.25);
      add(cyl(0.11, 0.14, 0.12, 16), rubber, 0, -0.14, 0.31, [Math.PI / 2, 0, 0]);   // snout
      const can = new THREE.Group();
      can.add(part(cyl(0.085, 0.085, 0.16, 16), metal(0x55604c)));
      for (const y of [-0.05, 0, 0.05]) can.add(part(cyl(0.09, 0.09, 0.012, 16), metal(0x3e4637), 0, y, 0));
      can.position.set(0, -0.17, 0.43); can.rotation.x = Math.PI / 2 - 0.3;
      g.add(can);
      const glass = new THREE.MeshBasicMaterial({ color: 0x9fb89a });
      for (const x of [-0.1, 0.1]) {
        add(new THREE.CircleGeometry(0.065, 16), glass, x, 0.07, 0.302);
        add(new THREE.TorusGeometry(0.068, 0.014, 6, 16), metal(0x6b6f66), x, 0.07, 0.302);
      }
      for (const y of [0.05, 0.2]) add(box(0.44, 0.035, 0.44), rubber, 0, y, -0.01);  // straps round the head
      break;
    }
    case 'Welder': {
      // Flip-down welding helmet: curved shield, dark filter window, side hinges, head harness.
      const shellMat = mat(0x2d2d29, Tex.metal());
      add(box(0.48, 0.48, 0.06), shellMat, 0, 0.0, 0.27);
      add(box(0.06, 0.48, 0.24), shellMat, 0.24, 0.0, 0.17);
      add(box(0.06, 0.48, 0.24), shellMat, -0.24, 0.0, 0.17);
      add(box(0.48, 0.06, 0.24), shellMat, 0, 0.24, 0.17);
      add(box(0.3, 0.11, 0.02), metal(0x4a4a44), 0, 0.07, 0.305);                     // window frame
      add(box(0.26, 0.08, 0.005), new THREE.MeshBasicMaterial({ color: 0x173a20 }), 0, 0.07, 0.317); // filter glass
      for (const x of [-0.275, 0.275]) add(cyl(0.04, 0.04, 0.03, 12), metal(0x8b8b80), x, 0.1, 0.1, [0, 0, Math.PI / 2]); // hinges
      add(new THREE.TorusGeometry(0.235, 0.022, 6, 24), mat(0x222222), 0, 0.12, 0, [Math.PI / 2, 0, 0]); // harness
      add(box(0.5, 0.02, 0.06), mat(0x7a1f1f), 0, -0.2, 0.3);                          // red trim
      break;
    }
    case 'Headlamp': {
      // Elastic band (around and over the head), lamp housing with a glowing lens, battery pack.
      const band = mat(0x1d1f22, Tex.fabric());
      add(box(0.45, 0.06, 0.45), band, 0, 0.1, 0);                                     // around
      add(box(0.06, 0.03, 0.46), band, 0, 0.245, 0);                                    // over the top
      add(box(0.16, 0.11, 0.08), metal(0x3a3c40), 0, 0.11, 0.26);                       // housing
      add(cyl(0.05, 0.05, 0.03, 16), metal(0x9a9da2), 0, 0.11, 0.31, [Math.PI / 2, 0, 0]); // bezel
      add(new THREE.CircleGeometry(0.042, 16), new THREE.MeshBasicMaterial({ color: 0xfff4c0 }), 0, 0.11, 0.327);
      add(box(0.15, 0.09, 0.06), metal(0x2f3134), 0, 0.12, -0.25);                       // battery pack
      add(box(0.03, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: 0x47ff6a }), 0.04, 0.14, -0.281); // charge LED
      break;
    }
    case 'Party Hat': {
      // Striped cone with confetti dots, a fluffy pompom and an elastic chin string.
      add(new THREE.ConeGeometry(0.18, 0.46, 24, 1, true), mat(0xffffff, hatTexture('stripes', color), { side: THREE.DoubleSide }), -0.02, 0.45, 0, [0, 0, 0.14]);
      add(new THREE.TorusGeometry(0.18, 0.015, 6, 24), mat(0xf2ead8), -0.002, 0.225, 0, [Math.PI / 2, 0, 0.14]); // rim trim
      const pom = new THREE.Group();
      for (let i = 0; i < 6; i++) pom.add(part(new THREE.IcosahedronGeometry(0.035, 1), mat(0xf2ead8, Tex.fabric()), Math.sin(i * 2.1) * 0.02, Math.cos(i * 1.3) * 0.015, Math.cos(i * 2.1) * 0.02));
      pom.position.set(-0.055, 0.69, 0);
      g.add(pom);
      for (const x of [-0.2, 0.2]) add(box(0.006, 0.42, 0.006), mat(0xdddddd), x, 0.02, 0.05); // elastic
      break;
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
