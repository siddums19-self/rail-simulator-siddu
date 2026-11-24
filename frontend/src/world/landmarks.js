import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { mulberry32 } from '../core/rng.js';

// Landmark station buildings, loosely modelled on the real ones so they are
// recognisable from a distance. Other metros/junctions get a procedural style
// seeded by the station code, so no two big stations look the same.
//
// Coordinates follow station.js: box(mat, ds, lat, y, wLat, h, dDs); the
// building's track face is at bx - bs*depth/2, its road face at bx + bs*depth/2.

const tinted = new Map();
const tint = (base, hex) => {
  const k = base.uuid + hex;
  if (!tinted.has(k)) { const m = base.clone(); m.color = new THREE.Color(hex); tinted.set(k, m); }
  return tinted.get(k);
};
const P = (hex) => M.plaster(hex);

const STYLES = {
  // Chhatrapati Shivaji Maharaj Terminus: Victorian Gothic, buff stone, giant ribbed central dome, gables and spires
  CSMT: { wall: 0xd9c49a, trim: 0x8a5a3c, accent: 0xb9a37a, dome: 0x6f7f72, h: 22, kind: 'gothic', name: 'CHHATRAPATI SHIVAJI MAHARAJ TERMINUS' },
  // Chennai Central: red Gothic Revival with a tall central clock tower and white trims
  MAS: { wall: 0xb5452e, trim: 0xf2ece0, accent: 0xf2ece0, dome: 0xb5452e, h: 18, kind: 'clocktower', name: 'PURATCHI THALAIVAR Dr. M.G. RAMACHANDRAN CHENNAI CENTRAL' },
  // Howrah: long red-brick Romanesque front with six square towers and hipped roofs
  HWH: { wall: 0xa8432e, trim: 0xefe6d4, accent: 0xefe6d4, dome: 0x5a3a2e, h: 17, kind: 'howrah', name: 'HOWRAH STATION' },
  // New Delhi: plain modern concrete block with red sandstone bands and glass entrances
  NDLS: { wall: 0xd8cdb6, trim: 0xa0452e, accent: 0x9a3b28, dome: 0xa0452e, h: 16, kind: 'modern', name: 'NEW DELHI' },
  // KSR Bengaluru: grey granite with a central Mysore-style dome tower
  SBC: { wall: 0xb8b2a6, trim: 0x8c7a5a, accent: 0xe2c77a, dome: 0xe2c77a, h: 15, kind: 'mysore', name: 'KRANTIVIRA SANGOLLI RAYANNA BENGALURU' },
  // Secunderabad: cream front with a large central dome and Kakatiya arch
  SC: { wall: 0xf1e3c4, trim: 0x9c5b2e, accent: 0xc98a4a, dome: 0xf6efe0, h: 16, kind: 'kakatiya', name: 'SECUNDERABAD JUNCTION' },
  // Hyderabad Deccan (Nampally): Nizam-era arches and twin minarets
  HYB: { wall: 0xf0d9a2, trim: 0x8a5a2e, accent: 0xffffff, dome: 0xf7efe0, h: 14, kind: 'nizam', name: 'HYDERABAD DECCAN' },
  // Guntakal: cream colonial divisional HQ station with maroon bands and a clock tower
  GTL: { wall: 0xf4ead2, trim: 0x8c3a26, accent: 0x8c3a26, dome: 0x8c3a26, h: 15, kind: 'colonial', name: 'GUNTAKAL JUNCTION' }
};

const RANDOM_KINDS = ['colonial', 'nizam', 'clocktower', 'mysore', 'modern', 'kakatiya', 'howrah'];
const RANDOM_WALLS = [0xeadbb6, 0xd9b98c, 0xb5452e, 0xe8e0cc, 0xc9b48a, 0xf1e3c4, 0xd8cdb6];
const RANDOM_TRIMS = [0x8c3a26, 0xa8432e, 0x6b4a2a, 0x7c2a1d, 0x9c5b2e];

export function landmarkStyle(st) {
  if (STYLES[st.code]) return { ...STYLES[st.code], code: st.code };
  const r = mulberry32([...st.code].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const wall = RANDOM_WALLS[Math.floor(r() * RANDOM_WALLS.length)];
  return {
    code: st.code, wall, trim: RANDOM_TRIMS[Math.floor(r() * RANDOM_TRIMS.length)], accent: r() < 0.5 ? 0xf2ece0 : 0x8c3a26,
    dome: r() < 0.5 ? 0xd8c9a4 : 0xe2c77a, h: st.category === 'metro' ? 17 + Math.floor(r() * 5) : 13 + Math.floor(r() * 4),
    kind: RANDOM_KINDS[Math.floor(r() * RANDOM_KINDS.length)], towers: 1 + Math.floor(r() * 3), seed: r()
  };
}

export function facadeMaterials(style, facade, plain) {
  return { facade: tint(facade, style.wall | 0), plain: tint(plain, style.wall | 0) };
}

export function buildLandmark(style, c) {
  const { box, bat, bx, bs, pfTop, bH, bLen, bDepth } = c;
  const wall = P(style.wall), trim = P(style.trim), acc = P(style.accent), domeM = P(style.dome);
  const front = bx + bs * (bDepth / 2), back = bx - bs * (bDepth / 2);
  const top = pfTop + bH;

  const dome = (ds, lat, y, r, sy = 1.2, mat = domeM) => bat.add(new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat, lat, y, -ds, 0, 0, 0, 1, sy, 1);
  const pyramid = (ds, lat, y, r, h, mat = trim) => bat.add(new THREE.ConeGeometry(r, h, 4), mat, lat, y + h / 2, -ds, 0, Math.PI / 4, 0);
  const spire = (ds, lat, y, r, h, mat = trim) => bat.add(new THREE.ConeGeometry(r, h, 8), mat, lat, y + h / 2, -ds);
  const finial = (ds, lat, y, h = 2) => bat.cyl(P(0xd4a63a), lat, y + h / 2, -ds, 0.06, 0.18, h, 6);
  const tower = (ds, w, h, mat = wall) => { box(mat, ds, bx, pfTop + h / 2, w, h, w); box(trim, ds, bx, pfTop + h + 0.3, w + 0.6, 0.6, w + 0.6); return pfTop + h + 0.6; };
  const clock = (ds, y, size) => {
    const face = M.textBoard('XII\n|\nVI', { bg: '#fdfdf5', fg: '#222', w: 128, h: 128, font: 'bold 26px serif' });
    for (const sx of [-1, 1]) bat.box(face, bx + sx * 0.5 * c.towerW, y, -ds, 0.05, size, size, 0, false);
  };
  const bands = (n = 2) => { for (let k = 1; k <= n; k++) box(trim, 0, bx, pfTop + (bH * k) / (n + 1), bDepth + 0.5, 0.45, bLen + 0.4, false); };
  const arcade = (y0, h, spacing = 4.2, mat = acc) => { // pilasters/arches on both long faces
    for (let z = -bLen / 2 + 3; z <= bLen / 2 - 3; z += spacing) for (const f of [front, back]) box(mat, z, f + Math.sign(f - bx) * 0.25, y0 + h / 2, 0.5, h, 0.6, false);
  };
  const parapet = (mat = trim, step = 3) => { for (let z = -bLen / 2 + 1; z <= bLen / 2 - 1; z += step) box(mat, z, bx, top + 0.6, bDepth + 0.3, 1.2, 1.1, false); };
  const sign = (text, y = top + 3.2, len = Math.min(bLen * 0.8, 78)) => {
    const m = M.facadeSign(text);
    for (const sx of [-1, 1]) bat.box(m, bx + sx * (bDepth / 2 + 0.3), y, 0, 0.1, 4.2, len, 0, false);
    box(M.steelDark(), 0, bx, y - 1.7, 0.3, 2.6, len, false);
  };
  const portico = (w = 26, h = 6.5, cols = 5, mat = acc) => {
    const pz = bx + bs * (bDepth / 2 + 6);
    box(trim, 0, pz, pfTop + h + 0.4, 12, 0.8, w);
    for (let k = 0; k < cols; k++) for (const o of [-5, 5]) box(mat, -w / 2 + 1.5 + k * ((w - 3) / (cols - 1)), pz + o, pfTop + h / 2, 0.9, h, 0.9);
  };
  c.towerW = 9;
  const name = style.name || c.defaultName;

  switch (style.kind) {
    case 'gothic': { // CSMT
      bands(3); arcade(pfTop, bH - 1, 3.6, acc);
      // central octagonal drum, ribbed dome, statue spire
      const tH = bH + 10;
      c.towerW = 16;
      bat.cyl(wall, bx, pfTop + tH / 2, 0, 8, 8.5, tH, 8);
      box(trim, 0, bx, pfTop + tH, 17.5, 0.8, 17.5);
      bat.cyl(acc, bx, pfTop + tH + 2.5, 0, 6.6, 7.2, 5, 8);
      dome(0, bx, pfTop + tH + 5, 7, 1.55);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; bat.box(trim, bx + Math.cos(a) * 6.2, pfTop + tH + 9.5, -Math.sin(a) * 6.2, 0.3, 8, 0.3, -a, false, 0, Math.cos(a) * 0.5); }
      bat.cyl(P(0x6f7f72), bx, pfTop + tH + 17, 0, 0.5, 0.9, 3.5, 8);
      bat.add(new THREE.SphereGeometry(0.9, 10, 8), P(0xa8a8a0), bx, pfTop + tH + 19.4, 0);
      // gables with pointed roofs and corner spires along the facade
      for (let z = -bLen / 2 + 8; z <= bLen / 2 - 8; z += 16) {
        if (Math.abs(z) < 14) continue;
        bat.add(new THREE.ConeGeometry(4.2, 6, 4), P(0x5d6b62), bx, top + 3, -z, 0, Math.PI / 4, 0, 1, 1, bDepth / 6);
        for (const f of [front, back]) spire(z, f, top, 0.6, 5, P(0x5d6b62));
      }
      for (const z of [-bLen / 2 + 3, bLen / 2 - 3]) { tower(z, 7, bH + 8, wall); spire(z, bx, pfTop + bH + 8.6, 4.2, 9, P(0x5d6b62)); finial(z, bx, pfTop + bH + 17.6); }
      sign(name, top + 3.2);
      portico(30, 7, 7, acc);
      break;
    }
    case 'clocktower': { // Chennai Central style
      bands(2); arcade(pfTop + 1, bH - 2, 3.4, acc); parapet(acc, 2.4);
      const tH = bH + 34;
      c.towerW = 10;
      const ty = tower(0, 10, tH, wall);
      for (const k of [0.33, 0.66]) box(acc, 0, bx, pfTop + tH * k, 10.5, 0.5, 10.5, false);
      clock(0, pfTop + tH - 5, 6);
      for (const cz of [-4.3, 4.3]) for (const cx of [-4.3, 4.3]) { bat.cyl(acc, bx + cx, ty + 2, -cz, 0.5, 0.6, 4, 8); spire(cz, bx + cx, ty + 4, 0.7, 3, wall); }
      pyramid(0, bx, ty, 6.2, 9, wall); finial(0, bx, ty + 9, 3);
      for (const z of [-bLen / 2 + 4, bLen / 2 - 4, -bLen / 4, bLen / 4]) { const y = tower(z, 6, bH + 8, wall); dome(z, bx, y, 2.6, 1.3, acc); finial(z, bx, y + 3.2); }
      sign(name, top + 3.2);
      portico(24, 6.5, 5, acc);
      break;
    }
    case 'howrah': {
      bands(2); arcade(pfTop + 1, bH - 2, 3.0, acc);
      const n = 6;
      for (let k = 0; k < n; k++) {
        const z = -bLen / 2 + 6 + (k * (bLen - 12)) / (n - 1);
        const y = tower(z, 8, bH + 12, wall);
        for (const kk of [0.4, 0.7]) box(acc, z, bx, pfTop + (bH + 12) * kk, 8.4, 0.45, 8.4, false);
        bat.add(new THREE.ConeGeometry(6.4, 6, 4), domeM, bx, y + 3, -z, 0, Math.PI / 4, 0);
        finial(z, bx, y + 6);
      }
      c.towerW = 10;
      const y = tower(0, 10, bH + 16, wall);
      clock(0, pfTop + bH + 11, 5);
      bat.add(new THREE.ConeGeometry(8, 7, 4), domeM, bx, y + 3.5, 0, 0, Math.PI / 4, 0);
      sign(name, top + 3.2);
      portico(30, 6, 6, wall);
      break;
    }
    case 'modern': { // New Delhi style
      box(trim, 0, bx, pfTop + 0.9, bDepth + 0.6, 1.8, bLen + 0.6, false);
      for (let k = 1; k <= 3; k++) box(acc, 0, bx, pfTop + (bH * k) / 4, bDepth + 0.4, 0.8, bLen + 0.3, false);
      // window strips
      for (const f of [front, back]) for (let k = 0; k < 3; k++) box(P(0x2a3a48), 0, f + Math.sign(f - bx) * 0.05, pfTop + 3 + k * (bH / 3.6), 0.1, 1.6, bLen - 6, false);
      // flanking blocks and a glass entrance hall
      for (const z of [-bLen / 2 - 10, bLen / 2 + 10]) box(wall, z, bx, pfTop + (bH - 3) / 2, bDepth - 2, bH - 3, 18);
      const pz = bx + bs * (bDepth / 2 + 5);
      box(new THREE.MeshPhysicalMaterial({ color: 0x8fb4c8, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.55 }), 0, pz, pfTop + 5, 10, 10, 30, false);
      box(trim, 0, pz, pfTop + 10.3, 11, 0.6, 31);
      sign(name, top + 3);
      break;
    }
    case 'mysore': { // KSR Bengaluru style
      bands(2); arcade(pfTop + 1, bH - 3, 4.4, acc); parapet(trim, 3.4);
      c.towerW = 12;
      const y = tower(0, 12, bH + 12, wall);
      box(acc, 0, bx, y + 1.5, 9, 3, 9);
      bat.add(new THREE.SphereGeometry(5, 20, 14), domeM, bx, y + 6.2, 0, 0, 0, 0, 1, 1.25, 1); // onion-ish dome
      spire(0, bx, y + 11.8, 1, 3.5, domeM); finial(0, bx, y + 15);
      for (const z of [-bLen / 2 + 5, bLen / 2 - 5]) { const yy = tower(z, 7, bH + 6, wall); box(acc, z, bx, yy + 1, 5, 2, 5); dome(z, bx, yy + 2, 3, 1.4); finial(z, bx, yy + 6); }
      for (const z of [-bLen / 4, bLen / 4]) for (const f of [front, back]) { bat.cyl(acc, f, top + 1.6, -z, 0.25, 0.25, 3.2, 8); dome(z, f, top + 3.2, 1.2, 1.3); }
      sign(name, top + 3.2);
      portico(28, 7, 6, acc);
      break;
    }
    case 'kakatiya': { // Secunderabad style
      bands(2); arcade(pfTop + 1, bH - 2, 3.8, acc);
      c.towerW = 18;
      box(wall, 0, bx, pfTop + (bH + 6) / 2, 18, bH + 6, 22);
      dome(0, bx, pfTop + bH + 6, 8.5, 1.1);
      finial(0, bx, pfTop + bH + 15.3, 3);
      // Kakatiya Thoranam-style arch on the road face
      const pz = bx + bs * (bDepth / 2 + 4);
      for (const o of [-7, 7]) box(acc, o, pz, pfTop + 6, 1.6, 12, 1.6);
      box(acc, 0, pz, pfTop + 12.6, 2, 1.4, 17);
      box(trim, 0, pz, pfTop + 13.8, 1.6, 1.0, 12);
      for (const z of [-bLen / 2 + 6, bLen / 2 - 6]) { const y = tower(z, 8, bH + 4, wall); dome(z, bx, y, 3.6, 1.1); finial(z, bx, y + 4); }
      sign(name, top + 3);
      break;
    }
    case 'nizam': { // Hyderabad (Nampally) style
      bands(1); arcade(pfTop, bH - 1, 3.2, acc); parapet(acc, 2);
      c.towerW = 12;
      box(wall, 0, bx, pfTop + (bH + 4) / 2, bDepth + 2, bH + 4, 24);
      for (let z = -9; z <= 9; z += 6) box(P(0x5a3a22), z, front + bs * 1.05, pfTop + 4, 0.2, 7, 3.6, false); // big arched doorways
      for (const z of [-13, 13]) { // twin minarets
        bat.cyl(wall, bx + bs * (bDepth / 2), pfTop + (bH + 14) / 2, -z, 1.4, 1.8, bH + 14, 12);
        for (const k of [0.45, 0.8]) bat.cyl(acc, bx + bs * (bDepth / 2), pfTop + (bH + 14) * k, -z, 2, 2, 0.5, 12);
        dome(z, bx + bs * (bDepth / 2), pfTop + bH + 14, 1.8, 1.5);
        finial(z, bx + bs * (bDepth / 2), pfTop + bH + 16.6);
      }
      dome(0, bx, pfTop + bH + 4, 5, 1.3);
      for (const z of [-bLen / 2 + 3, bLen / 2 - 3]) { bat.cyl(wall, bx, top + 2, -z, 1.4, 1.4, 4, 10); dome(z, bx, top + 4, 1.5, 1.4); }
      sign(name, top + 7.4, Math.min(bLen * 0.6, 50));
      break;
    }
    case 'colonial':
    default: { // Guntakal and generic colonial
      bands(2); arcade(pfTop, bH * 0.5, 3.6, P(0xfaf5e8));
      // long verandah with columns on the platform side and road side
      for (const f of [front, back]) {
        box(trim, 0, f + Math.sign(f - bx) * 2.4, pfTop + 4.4, 5, 0.4, bLen, false);
        for (let z = -bLen / 2 + 2; z <= bLen / 2 - 2; z += 4.5) box(P(0xfaf5e8), z, f + Math.sign(f - bx) * 4.4, pfTop + 2.2, 0.45, 4.4, 0.45);
      }
      const towers = style.towers || 1;
      const tH = bH + 14;
      c.towerW = 8;
      const y = tower(0, 8, tH, wall);
      clock(0, pfTop + tH - 4, 3.6);
      pyramid(0, bx, y, 5.6, 6, trim); finial(0, bx, y + 6);
      if (towers >= 2) for (const z of [-bLen / 2 + 4, bLen / 2 - 4]) { const yy = tower(z, 6, bH + 6, wall); pyramid(z, bx, yy, 4.2, 4, trim); }
      if (towers >= 3) for (const z of [-bLen / 4, bLen / 4]) for (const f of [front, back]) { bat.cyl(wall, f, top + 1.5, -z, 0.9, 0.9, 3, 8); dome(z, f, top + 3, 1, 1.3); }
      parapet(trim, 2.8);
      sign(name, top + 3.2);
      portico(22, 6, 5, P(0xfaf5e8));
    }
  }
}
