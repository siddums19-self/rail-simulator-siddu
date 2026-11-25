import * as THREE from 'three/webgpu';
import { registerNightEmissive } from '../core/materials.js';
import { createPerson } from './people.js';
import { localLang } from '../route/stationScripts.js';
import { makeRng } from '../core/rng.js';

// Festivals, picked from the real date (or chosen in the settings):
//   Diwali            - strings of coloured bulbs along the platforms and diyas on the platform edge (everywhere)
//   Ganesh Chaturthi  - extra crowds and a marigold-decked pandal on Mumbai-area platforms
//   Makar Sankranti   - kites over the line in Andhra Pradesh / Telangana
const DATES = { // [month(1-12), day, days] start of the festival window
  2025: { DIWALI: [10, 18, 6], GANESH: [8, 27, 11], SANKRANTI: [1, 12, 5] },
  2026: { DIWALI: [11, 5, 6], GANESH: [9, 14, 11], SANKRANTI: [1, 12, 5] },
  2027: { DIWALI: [10, 26, 6], GANESH: [9, 4, 11], SANKRANTI: [1, 12, 5] },
  2028: { DIWALI: [10, 14, 6], GANESH: [8, 23, 11], SANKRANTI: [1, 12, 5] }
};
export const FESTIVAL_LABEL = { DIWALI: '🪔 Diwali', GANESH: '🐘 Ganesh Chaturthi', SANKRANTI: '🪁 Makar Sankranti' };

export function festivalToday(d = new Date()) {
  const y = DATES[d.getFullYear()]; if (!y) return null;
  for (const [k, [m, day, n]] of Object.entries(y)) {
    const a = new Date(d.getFullYear(), m - 1, day), b = new Date(a.getTime() + n * 864e5);
    if (d >= a && d < b) return k;
  }
  return null;
}

const MUMBAI = /^(CSMT|MSD|SNRD|BY|CHG|CRD|PR|DR|MTN|SIN|CLA|VVH|GC|VK|KJRD|BND|NHU|MLND|TNA|KLVA|MBQ|DIVA|KOPR|DI|THK|KYN|DKRD|CTGN|SVE|VDLR|GTBN|CHF|TKNG|CMBR|GV|MNKD|VSH|SNCR|JNJ|NEU|BEPR|KHAG|MANR|KNDS|PNVL|CCG|MEL|CYR|GTR|MMCT|MX|PL|PBHD|DDR|MRU|MM|BA|KHAR|STC|VLP|ADH|JOS|RMAR|GMN|MDD|KILE|BVI|DIC|MIRA|BYR|NIG|BSR|NSP|VR|PUNE|LNL|KJT)$/;
const BULB = [0xff3b30, 0xffcc00, 0x34c759, 0x2f80ff, 0xff6ad5];
let mats = null;
const bulbMats = () => mats ||= BULB.map((c) => registerNightEmissive(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4 }), 0.4, 4));
let diyaMat = null, _sph = null, _diya = null;

// Decorate one station (called as each station is built)
export function decorateStation(fest, st, L, res) {
  if (!fest) return;
  const S = st.layout, path = L.path, v = new THREE.Vector3();
  const rand = makeRng('fest', fest, st.code);
  if (fest === 'DIWALI') {
    const M = bulbMats(); _sph ||= new THREE.SphereGeometry(0.07, 6, 4);
    const buckets = M.map(() => []);
    const pfLats = [...new Set(S.tracks.map((t) => +(t.o + (t.pfSide === 'left' ? -4.2 : 4.2)).toFixed(1)))];
    let k = 0;
    for (const lat of pfLats) for (let sv = S.pStart + 6; sv < S.pEnd - 6; sv += 0.9) {
      const ph = ((sv - S.pStart) % 9) / 9;               // sagging between canopy columns every 9 m
      path.pointAt(sv, lat, v); buckets[k++ % M.length].push([v.x, path.yAt(sv) + 4.6 - Math.sin(ph * Math.PI) * 0.45, v.z]);
    }
    M.forEach((m, i) => {
      const pts = buckets[i]; if (!pts.length) return;
      const im = new THREE.InstancedMesh(_sph, m, pts.length), o = new THREE.Object3D();
      pts.forEach((p, j) => { o.position.set(...p); o.updateMatrix(); im.setMatrixAt(j, o.matrix); });
      res.root.add(im);
    });
    // diyas along the platform edges
    diyaMat ||= registerNightEmissive(new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff8a1a, emissiveIntensity: 0.6 }), 0.6, 5);
    _diya ||= new THREE.CylinderGeometry(0.06, 0.04, 0.05, 6);
    const dp = [];
    for (const t of S.tracks) for (let sv = S.pStart + 4; sv < S.pEnd - 4; sv += 3) {
      path.pointAt(sv, t.o + (t.pfSide === 'left' ? -2.0 : 2.0), v); dp.push([v.x, path.yAt(sv) + 0.9, v.z]);
    }
    if (dp.length) {
      const im = new THREE.InstancedMesh(_diya, diyaMat, dp.length), o = new THREE.Object3D();
      dp.forEach((p, j) => { o.position.set(...p); o.updateMatrix(); im.setMatrixAt(j, o.matrix); });
      res.root.add(im);
    }
  }
  if (fest === 'GANESH' && MUMBAI.test(st.code)) {
    // festival crowds: many more people waiting on every platform, and a small pandal with marigold strings
    const marigold = new THREE.MeshStandardMaterial({ color: 0xff9800, emissive: 0xff6d00, emissiveIntensity: 0.3 });
    for (const t of S.tracks) {
      const lat = t.o + (t.pfSide === 'left' ? -3.6 : 3.6);
      for (let n = 0; n < 34; n++) {
        const sv = S.pStart + 10 + rand() * (S.pLen - 20);
        const mesh = createPerson(Math.floor(rand() * 1e6));
        path.pointAt(sv, lat + (rand() - 0.5) * 3, v);
        mesh.position.set(v.x, path.yAt(sv) + 0.9, v.z); mesh.rotation.y = rand() * 6.28;
        res.root.add(mesh); res.people?.push({ mesh, walker: false, phase: rand() * 6, t: 0 });
      }
    }
    const t0 = S.tracks[0], lat = t0.o + (t0.pfSide === 'left' ? -5.5 : 5.5), sv = S.sCenter;
    path.pointAt(sv, lat, v); const y = path.yAt(sv) + 0.9, th = path.headingAt(sv);
    const g = new THREE.Group(); g.position.set(v.x, y, v.z); g.rotation.y = -th;
    const red = new THREE.MeshStandardMaterial({ color: 0xc62828 });
    for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3, 0.12), red); p.position.set(x, 1.5, z); g.add(p); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.2, 4), new THREE.MeshStandardMaterial({ color: 0xffd54f })); roof.position.y = 3.6; roof.rotation.y = Math.PI / 4; g.add(roof);
    const idol = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshStandardMaterial({ color: 0xff7043 })); idol.position.y = 1.1; idol.scale.set(1, 1.3, 1); g.add(idol);
    for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), marigold); const a = (i / 12) * Math.PI * 2; b.position.set(Math.cos(a) * 1.3, 2.8 - Math.abs(Math.sin(a * 2)) * 0.3, Math.sin(a) * 1.3); g.add(b); }
    res.root.add(g);
  }
}

// Sankranti kites drifting over the line near the train (only where the station boards are in Telugu)
export class Kites {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.kites = []; this.on = false; }
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.6, 0, -0.45, 0, 0, 0, -0.75, 0, 0, 0.6, 0, 0, -0.75, 0, 0.45, 0, 0], 3));
    geo.computeVertexNormals();
    const cols = [0xff1744, 0xffea00, 0x00e676, 0x2979ff, 0xd500f9, 0xff9100];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
      m.scale.setScalar(1.6);
      this.group.add(m);
      this.kites.push({ m, a: Math.random() * 6.28, r: 60 + Math.random() * 260, h: 35 + Math.random() * 60, ph: Math.random() * 6 });
    }
  }
  update(dt, active, center) {
    if (active && !this.kites.length) this.build();
    this.group.visible = !!active;
    if (!active) return;
    // a kite-flying neighbourhood stays put; when the train has left it behind a new one appears ahead
    if (!this.anchor || Math.hypot(this.anchor.x - center.x, this.anchor.z - center.z) > 380) this.anchor = { x: center.x, y: center.y, z: center.z };
    const c = this.anchor;
    for (const k of this.kites) {
      k.ph += dt;
      k.m.position.set(c.x + Math.cos(k.a) * k.r + Math.sin(k.ph * 0.7) * 4, c.y + k.h + Math.sin(k.ph * 1.3) * 2.5, c.z + Math.sin(k.a) * k.r);
      k.m.rotation.set(Math.sin(k.ph * 1.1) * 0.35, k.a, Math.sin(k.ph * 0.9) * 0.4);
    }
  }
  static region(st) { return st && localLang(st.code) === 'te'; }
}
