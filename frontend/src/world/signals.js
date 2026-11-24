import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';

// Indian Railways 4-aspect MACL colour-light signal with junction-type route
// indicator ("feather"). Lamps from top: Y2, G, Y1, R.

const lit = {};
const litMat = (hex) => {
  if (!lit[hex]) lit[hex] = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 3.5, roughness: 0.3 });
  return lit[hex];
};
const COLORS = { R: 0xff2a1a, Y: 0xffb300, G: 0x18ff6a, W: 0xfff8e8 };
let geoCache = null;

function geos() {
  if (geoCache) return geoCache;
  geoCache = {
    post: new THREE.CylinderGeometry(0.11, 0.14, 1, 10),
    head: new THREE.BoxGeometry(0.62, 2.15, 0.36),
    plate: new THREE.BoxGeometry(0.95, 2.55, 0.05),
    lamp: new THREE.CircleGeometry(0.15, 16),
    hood: new THREE.CylinderGeometry(0.2, 0.2, 0.34, 12, 1, true, -Math.PI / 2, Math.PI),
    rung: new THREE.BoxGeometry(0.42, 0.04, 0.04),
    rail: new THREE.BoxGeometry(0.04, 1, 0.04),
    feather: new THREE.CircleGeometry(0.075, 10),
    featherBox: new THREE.BoxGeometry(1.5, 0.3, 0.2),
    numPlate: new THREE.BoxGeometry(0.5, 0.3, 0.03)
  };
  return geoCache;
}

export class SignalMast {
  // kind: 'home' | 'starter' | 'distant'
  constructor({ kind = 'home', height = 6.2, featherSide = 0 } = {}) {
    const G = geos();
    this.kind = kind;
    this.group = new THREE.Group();
    const post = new THREE.Mesh(G.post, M.galvanised());
    post.scale.y = height; post.position.y = height / 2; post.castShadow = true;
    this.group.add(post);
    // ladder
    for (const x of [-0.18, 0.18]) {
      const r = new THREE.Mesh(G.rail, M.galvanised()); r.scale.y = height - 0.8; r.position.set(x, (height - 0.8) / 2 + 0.3, 0.2); this.group.add(r);
    }
    for (let y = 0.6; y < height - 0.5; y += 0.32) { const r = new THREE.Mesh(G.rung, M.galvanised()); r.position.set(0, y, 0.2); this.group.add(r); }
    const plate = new THREE.Mesh(G.plate, M.black()); plate.position.set(0, height + 0.95, -0.05); this.group.add(plate);
    const head = new THREE.Mesh(G.head, M.black()); head.position.set(0, height + 0.95, 0.12); head.castShadow = true; this.group.add(head);
    this.lamps = {};
    const order = kind === 'distant' ? ['Y2', 'G', 'Y1'] : ['Y2', 'G', 'Y1', 'R'];
    order.forEach((name, i) => {
      const y = height + 1.72 - i * 0.5;
      const hood = new THREE.Mesh(G.hood, M.black()); hood.rotation.x = Math.PI / 2; hood.position.set(0, y + 0.02, 0.45); this.group.add(hood);
      const lamp = new THREE.Mesh(G.lamp, M.signalOff()); lamp.position.set(0, y, 0.305); this.group.add(lamp);
      this.lamps[name] = lamp;
    });
    // junction route indicators: 5 white lamps at 45 degrees, left and/or right
    this.feathers = { '-1': [], '1': [] };
    const sides = featherSide === 'both' ? [-1, 1] : (featherSide ? [featherSide] : []);
    for (const fs of sides) {
      const fb = new THREE.Mesh(G.featherBox, M.black());
      fb.position.set(fs * 0.55, height + 2.65, 0.12);
      fb.rotation.z = fs * Math.PI / 4;
      this.group.add(fb);
      for (let k = 0; k < 5; k++) {
        const f = new THREE.Mesh(G.feather, M.signalOff());
        const d = 0.12 + k * 0.26;
        f.position.set(fs * (0.05 + d * 0.707), height + 2.25 + d * 0.707, 0.23);
        this.group.add(f);
        this.feathers[String(fs)].push(f);
      }
    }
    this.aspect = null;
    this.set('RED', 0);
  }

  // featherDir: 0 = none, -1 = diverging left, +1 = diverging right
  set(aspect, featherDir = 0) {
    const key = aspect + featherDir;
    if (key === this.aspect) return;
    this.aspect = key;
    const on = { Y2: aspect === 'DOUBLE_YELLOW', G: aspect === 'GREEN', Y1: aspect === 'YELLOW' || aspect === 'DOUBLE_YELLOW', R: aspect === 'RED' };
    for (const [name, mesh] of Object.entries(this.lamps)) {
      mesh.material = on[name] ? litMat(COLORS[name[0]]) : M.signalOff();
    }
    for (const [side, list] of Object.entries(this.feathers)) {
      const lit = aspect !== 'RED' && featherDir !== 0 && Number(side) === Math.sign(featherDir);
      for (const f of list) f.material = lit ? litMat(COLORS.W) : M.signalOff();
    }
  }

  // Place facing traffic coming from -s (head faces back toward approaching train).
  placeOnPath(path, s, lat) {
    const p = path.pointAt(s, lat, new THREE.Vector3());
    this.group.position.copy(p);
    this.group.rotation.y = -path.headingAt(s); // local +Z (lamp side) faces the approaching train
    this.s = s;
    return this;
  }
}
