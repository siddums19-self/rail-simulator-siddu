import * as THREE from 'three/webgpu';
import { Batcher } from '../core/batcher.js';

// Road vehicles seen on Indian roads (car, SUV, APSRTC bus, lorry, auto-rickshaw, motorbike), built from
// a few shaped parts with glass, tyres, lights and bumpers, and RoadTraffic that drives them along a road:
// two lanes (keep left), following distance, and a stop line (e.g. a closed level-crossing gate).
// Model axes: length along +Z (the front / headlights at +Z), width along X, wheels on y = 0.

const mats = new Map();
const mat = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
const paint = (hex) => mat('p' + hex, () => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.45, roughness: 0.38 }));
const flat = (hex, rough = 0.8) => mat('f' + hex + rough, () => new THREE.MeshStandardMaterial({ color: hex, roughness: rough }));
const glass = () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x1c2833, metalness: 0.7, roughness: 0.08 }));
const tyre = () => mat('tyre', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }));
const chrome = () => mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.25 }));
const head = () => mat('head', () => new THREE.MeshStandardMaterial({ color: 0xfff6d5, emissive: 0xfff2c0, emissiveIntensity: 0.6 }));
const tail = () => mat('tail', () => new THREE.MeshStandardMaterial({ color: 0xb01010, emissive: 0x900000, emissiveIntensity: 0.5 }));

const wheels = (b, w, zs, r = 0.33, t = 0.24) => { for (const z of zs) for (const x of [-w / 2, w / 2]) b.cyl(tyre(), x, r, z, r, r, t, 14, 0, 0, Math.PI / 2); };
const lights = (b, w, y, zf, zr) => {
  for (const x of [-w / 2 + 0.25, w / 2 - 0.25]) { b.box(head(), x, y, zf, 0.32, 0.16, 0.05, 0, false); b.box(tail(), x, y, zr, 0.3, 0.14, 0.05, 0, false); }
};

const BUILD = {
  car(c) { // hatchback / sedan
    const b = new Batcher(), L = 4.1, W = 1.7;
    b.box(paint(c), 0, 0.62, 0, W, 0.62, L, 0, true);                       // body
    b.box(paint(c), 0, 1.12, -0.25, W - 0.12, 0.42, 2.1, 0, true);           // cabin
    b.box(glass(), 0, 1.13, -0.25, W - 0.08, 0.34, 2.14, 0, false);          // windows all round
    b.box(glass(), 0, 1.06, 0.86, W - 0.2, 0.36, 0.06, 0, false, -0.6, 0);   // raked windscreen
    b.box(chrome(), 0, 0.42, L / 2, W, 0.16, 0.08, 0, false); b.box(chrome(), 0, 0.42, -L / 2, W, 0.16, 0.08, 0, false);
    wheels(b, W - 0.1, [1.3, -1.25]); lights(b, W, 0.72, L / 2 + 0.01, -L / 2 - 0.01);
    return b.build();
  },
  suv(c) {
    const b = new Batcher(), L = 4.5, W = 1.85;
    b.box(paint(c), 0, 0.82, 0, W, 0.86, L, 0, true);
    b.box(paint(c), 0, 1.5, -0.35, W - 0.08, 0.55, 2.9, 0, true);
    b.box(glass(), 0, 1.5, -0.35, W - 0.04, 0.45, 2.94, 0, false);
    b.box(flat(0x222222), 0, 1.82, -0.35, W - 0.3, 0.06, 2.6, 0, false);   // roof rails
    b.box(flat(0x2a2a2a), 0, 0.5, L / 2, W + 0.02, 0.3, 0.12, 0, false);
    wheels(b, W - 0.06, [1.45, -1.4], 0.38, 0.28); lights(b, W, 0.98, L / 2 + 0.01, -L / 2 - 0.01);
    return b.build();
  },
  bus(c) { // state transport bus: two-tone with a window band
    const b = new Batcher(), L = 10.5, W = 2.5;
    b.box(paint(c), 0, 1.15, 0, W, 1.3, L, 0, true);
    b.box(paint(0xf1f1ea), 0, 2.35, 0, W, 1.1, L, 0, true);
    b.box(glass(), 0, 2.35, 0, W + 0.02, 0.8, L - 1.2, 0, false);
    b.box(glass(), 0, 2.2, L / 2 + 0.01, W - 0.3, 1.2, 0.05, 0, false);
    b.box(paint(0xf1f1ea), 0, 3.0, 0, W - 0.1, 0.2, L - 0.2, 0, true);    // roof
    b.box(flat(0x1a1a1a), 0, 0.55, L / 2 + 0.02, W, 0.35, 0.06, 0, false);
    wheels(b, W - 0.2, [3.4, -3.3], 0.5, 0.32); lights(b, W, 0.9, L / 2 + 0.02, -L / 2 - 0.02);
    return b.build();
  },
  lorry(c) { // Tata-style truck: coloured cab, wooden / tarp body
    const b = new Batcher(), L = 8, W = 2.4;
    b.box(paint(c), 0, 1.55, 3.2, W, 1.7, 1.7, 0, true);
    b.box(glass(), 0, 1.95, 4.06, W - 0.3, 0.8, 0.05, 0, false);
    b.box(paint(c), 0, 2.55, 3.15, W, 0.3, 1.9, 0, true);                   // cab roof visor
    b.box(flat(0x8b5a2b), 0, 1.5, -0.9, W, 1.5, 5.6, 0, true);              // wooden body
    b.box(flat(0x2e6b3a, 0.95), 0, 2.55, -0.9, W - 0.05, 0.6, 5.5, 0, true); // tarpaulin
    b.box(flat(0x2a2a2a), 0, 0.62, 0, W - 0.2, 0.3, L - 0.6, 0, false);     // chassis
    wheels(b, W - 0.1, [3.0, -2.2, -3.3], 0.48, 0.32); lights(b, W, 1.0, 4.08, -3.71);
    return b.build();
  },
  auto(c) { // auto-rickshaw: yellow-green body, black canvas hood, one front wheel
    const b = new Batcher(), W = 1.35;
    b.box(paint(c), 0, 0.62, 0.1, W, 0.55, 2.4, 0, true);
    b.box(paint(c), 0, 0.95, 1.1, W * 0.75, 0.6, 0.5, 0, true);             // nose / front panel
    b.box(glass(), 0, 1.35, 0.95, W * 0.8, 0.5, 0.05, 0, false);            // windscreen
    b.box(flat(0x111111, 0.95), 0, 1.75, -0.15, W + 0.05, 0.12, 2.0, 0, true); // canvas hood top
    for (const x of [-W / 2, W / 2]) b.box(flat(0x111111, 0.95), x, 1.3, -0.65, 0.05, 0.8, 1.0, 0, false); // hood sides
    b.cyl(tyre(), 0, 0.28, 1.2, 0.28, 0.28, 0.16, 12, 0, 0, Math.PI / 2);
    for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) b.cyl(tyre(), x, 0.28, -0.75, 0.28, 0.28, 0.18, 12, 0, 0, Math.PI / 2);
    b.box(head(), 0, 0.98, 1.36, 0.22, 0.14, 0.05, 0, false);
    return b.build();
  },
  bike(c) { // motorbike with rider
    const b = new Batcher();
    b.cyl(tyre(), 0, 0.32, 0.65, 0.32, 0.32, 0.1, 12, 0, 0, Math.PI / 2);
    b.cyl(tyre(), 0, 0.32, -0.65, 0.32, 0.32, 0.1, 12, 0, 0, Math.PI / 2);
    b.box(paint(c), 0, 0.68, 0.05, 0.32, 0.3, 1.2, 0, true);                 // tank + frame
    b.box(flat(0x222222), 0, 0.8, -0.35, 0.3, 0.1, 0.6, 0, false);           // seat
    b.box(flat(pickShirt(c)), 0, 1.25, -0.25, 0.42, 0.65, 0.3, 0, true);     // rider
    b.box(flat(0x2b2b2b), 0, 1.72, -0.2, 0.26, 0.26, 0.28, 0, true);         // helmet
    b.box(chrome(), 0, 1.0, 0.55, 0.6, 0.04, 0.04, 0, false);                // handlebar
    b.box(head(), 0, 0.85, 0.78, 0.14, 0.12, 0.05, 0, false);
    return b.build();
  }
};
function pickShirt(c) { return [0x1e88e5, 0xf5f5f5, 0xd84315, 0x43a047][c % 4]; }

const PALETTE = {
  car: [0xf2f2f2, 0xb0b5bb, 0x1f4e8c, 0xa31515, 0x222222, 0xd9d2c3],
  suv: [0xf2f2f2, 0x2b2b2b, 0x6b6f75, 0x7a1f1f],
  bus: [0x2e7d32, 0xc62828, 0x1565c0],           // APSRTC / KSRTC liveries
  lorry: [0xef6c00, 0x1565c0, 0xfdd835, 0xc62828],
  auto: [0xf9d71c, 0x2e7d32],
  bike: [0x111111, 0xc62828, 0x1565c0, 0x9e9e9e]
};
const SPEED = { car: 11, suv: 11, bus: 8.5, lorry: 7.5, auto: 7, bike: 10 };
const LEN = { car: 4.1, suv: 4.5, bus: 10.5, lorry: 8, auto: 2.6, bike: 1.8 };
const MIX = ['car', 'car', 'car', 'suv', 'bike', 'bike', 'auto', 'auto', 'bus', 'lorry'];

const cache = new Map();
export function buildVehicle(kind, color) {
  const key = kind + color;
  if (!cache.has(key)) { const o = BUILD[kind](color); o.traverse((m) => { if (m.isMesh) m.userData.disposable = false; }); cache.set(key, o); }
  return cache.get(key).clone();
}

// pts: road centre-line [{x, y, z}] in the parent's space; laneOff: distance of each lane from the centre
// stops: [{ d, closed: () => bool }] stop lines (distance along the road); vehicles queue before them.
export class RoadTraffic {
  constructor(parent, pts, { count = 8, rand = Math.random, laneOff = 1.9, stops = [], mix = MIX } = {}) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    this.len = this.cum.at(-1);
    this.laneOff = laneOff; this.stops = stops;
    this.cars = [];
    const hasCrossing = stops.length === 2;
    const cMin = hasCrossing ? Math.min(stops[0].d, stops[1].d) - 4 : -1;
    const cMax = hasCrossing ? Math.max(stops[0].d, stops[1].d) + 4 : -1;
    for (let i = 0; i < count; i++) {
      const kind = mix[Math.floor(rand() * mix.length)];
      const pal = PALETTE[kind], color = pal[Math.floor(rand() * pal.length)];
      const obj = buildVehicle(kind, color);
      this.group.add(obj);
      const dir = i % 2 ? 1 : -1;
      let d = rand() * this.len;
      if (hasCrossing && d >= cMin && d <= cMax) d = dir > 0 ? cMin - 6 - rand() * 20 : cMax + 6 + rand() * 20;
      this.cars.push({ obj, kind, dir, d: Math.max(0, Math.min(this.len, d)), v: SPEED[kind] * (0.8 + rand() * 0.3), vmax: SPEED[kind] * (0.85 + rand() * 0.3), len: LEN[kind] });
    }
    this.center = pts[Math.floor(pts.length / 2)];
  }

  _at(d, off, out) {
    d = Math.max(0, Math.min(this.len - 0.01, d));
    let i = 1; while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i], t = (d - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    out.x = a.x + dx * t + (dz / l) * off; out.z = a.z + dz * t - (dx / l) * off; out.y = a.y + (b.y - a.y) * t;
    out.h = Math.atan2(dx, dz);
    return out;
  }

  update(dt) {
    const p = { x: 0, y: 0, z: 0, h: 0 };
    const hasCrossing = this.stops.length === 2;
    const crossingClosed = hasCrossing && this.stops.some((s) => s.closed());
    const cMin = hasCrossing ? Math.min(this.stops[0].d, this.stops[1].d) : 0;
    const cMax = hasCrossing ? Math.max(this.stops[0].d, this.stops[1].d) : 0;
    for (const c of this.cars) {
      // If a level-crossing gate is closed, never leave any vehicle on the track
      if (crossingClosed && c.d + c.len * 0.5 > cMin && c.d - c.len * 0.5 < cMax) {
        c.d = c.dir > 0 ? cMax + c.len * 0.5 + 3 : cMin - c.len * 0.5 - 3;
      }
      // nearest thing ahead in the same lane: another vehicle or a closed stop line
      let gap = Infinity;
      for (const o of this.cars) if (o !== c && o.dir === c.dir) { const g = (o.d - c.d) * c.dir - o.len - 3; if (g > -1 && g < gap) gap = g; }
      for (const s of this.stops) if (s.closed()) { const g = (s.d - c.d) * c.dir - c.len * 0.5 - 2.5; if (g > -2 && g < gap) gap = g; }
      const target = gap < 0.5 ? 0 : Math.min(c.vmax, Math.sqrt(2 * 2.5 * Math.max(0, gap)));
      c.v += Math.sign(target - c.v) * Math.min(Math.abs(target - c.v), (target > c.v ? 1.6 : 5) * dt);
      c.d += c.dir * c.v * dt;
      if (c.d > this.len + 5) c.d = -5; else if (c.d < -5) c.d = this.len + 5; // round again from the far end
      this._at(c.d, c.dir * this.laneOff, p);           // keep left (India): (dz,-dx) is the left of travel
      c.obj.position.set(p.x, p.y, p.z);
      c.obj.rotation.y = p.h + (c.dir < 0 ? Math.PI : 0);
      c.obj.visible = c.d > 0 && c.d < this.len;
    }
  }
}
