import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { makeRng, pick, range, smoothstep } from '../core/rng.js';
import { GeoAccum, meshFrom } from './geoAccum.js';

// Civil structures around Guntakal: the through-truss span of the ROR flyover,
// the Road-over-Bridge east of the station, and the VV Nagar road underpass.

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
let _unit = null;

// Steel member between two points.
export function beam(bat, mat, a, b, w = 0.35, h = 0.35) {
  _d.subVectors(b, a);
  const len = _d.length();
  if (len < 1e-3) return;
  _unit ||= new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), _d.clone().normalize());
  m.compose(_a.addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(w, h, len));
  bat.addMatrix(_unit, mat, m, true);
}

const bridgeSteel = () => M.galvanised();

// Pratt through truss carrying the double-line deck over the Bellary line.
export function buildTruss(group, path, sA, sB, half = 7.0, height = 7.4) {
  const bat = new Batcher();
  const mat = bridgeSteel();
  const n = Math.max(6, Math.round((sB - sA) / 6));
  const panel = (sB - sA) / n;
  for (const side of [-1, 1]) {
    const B = [], T = [];
    for (let i = 0; i <= n; i++) {
      const s = sA + i * panel;
      const p = path.pointAt(s, side * half, new THREE.Vector3());
      p.y -= 0.25;
      B.push(p);
      T.push(p.clone().add(new THREE.Vector3(0, height, 0)));
    }
    for (let i = 0; i < n; i++) beam(bat, mat, B[i], B[i + 1], 0.55, 0.8);           // bottom chord
    for (let i = 1; i < n - 1; i++) beam(bat, mat, T[i], T[i + 1], 0.6, 0.6);        // top chord
    beam(bat, mat, B[0], T[1], 0.55, 0.55); beam(bat, mat, B[n], T[n - 1], 0.55, 0.55); // inclined end posts
    for (let i = 1; i < n; i++) beam(bat, mat, B[i], T[i], 0.3, 0.3);                // verticals
    for (let i = 1; i < n - 1; i++) {                                                 // diagonals (Pratt)
      if (i < n / 2) beam(bat, mat, T[i], B[i + 1], 0.26, 0.26); else beam(bat, mat, B[i], T[i + 1], 0.26, 0.26);
    }
    group.userData[side < 0 ? 'L' : 'R'] = T;
  }
  // top lateral bracing + portals
  const L = group.userData.L, R = group.userData.R;
  for (let i = 1; i < n; i++) beam(bat, mat, L[i], R[i], 0.25, 0.4);
  for (let i = 1; i < n - 1; i++) { beam(bat, mat, L[i], R[i + 1], 0.12, 0.12); beam(bat, mat, R[i], L[i + 1], 0.12, 0.12); }
  // name plate on the portal
  const plateMat = M.textBoard('ROR  BRIDGE  No. 412', { bg: '#1f2937', fg: '#fde68a', w: 512, h: 96, font: 'bold 44px Arial' });
  const mid = L[1].clone().lerp(R[1], 0.5); mid.y -= 0.6;
  bat.box(plateMat, mid.x, mid.y, mid.z, 5, 0.9, 0.08, -path.headingAt(sA + panel), false);
  group.add(bat.build());
}

// Road-over-Bridge: a road deck crossing all the lines at `a` metres past the
// GTL throat, with piers in the gaps between the lines and long approach ramps.
export function buildROB(group, P0, H0, a, { piers, abutL, abutR, rampLen = 160, deckTop = 9.4, seedKey }) {
  const bat = new Batcher();
  const rand = makeRng(seedKey, 'rob');
  const F = new THREE.Vector3(Math.sin(H0), 0, -Math.cos(H0));
  const R = new THREE.Vector3(Math.cos(H0), 0, Math.sin(H0));
  const at = (l, y = 0, f = 0) => new THREE.Vector3(P0.x + F.x * (a + f) + R.x * l, y, P0.z + F.z * (a + f) + R.z * l);
  const yaw = -(H0 + Math.PI / 2); // boxes' local Z along the road (+R)
  const W = 11.5; // road + footpaths
  const lEnd0 = abutL - rampLen, lEnd1 = abutR + rampLen;
  const heightAt = (l) => {
    if (l >= abutL && l <= abutR) return deckTop;
    if (l < abutL) return deckTop * smoothstep(lEnd0, abutL, l);
    return deckTop * (1 - smoothstep(abutR, lEnd1, l));
  };
  // deck slab + steel/PSC girders over the span
  const span = abutR - abutL;
  const c = at((abutL + abutR) / 2, deckTop - 0.45);
  bat.box(M.concrete(), c.x, c.y, c.z, W, 0.9, span, yaw);
  for (const f of [-4.2, -1.4, 1.4, 4.2]) {
    const g = at((abutL + abutR) / 2, deckTop - 1.45, f);
    bat.box(M.darkConcrete(), g.x, g.y, g.z, 0.6, 1.2, span, yaw);
  }
  // fascia with ROB name facing the railway (both sides)
  for (const f of [-W / 2 - 0.05, W / 2 + 0.05]) {
    const fp = at((abutL + abutR) / 2, deckTop - 0.9, f);
    bat.box(M.textBoard('ROAD OVER BRIDGE  •  GUNTAKAL', { bg: '#e9e2cf', fg: '#7c2a1d', w: 1024, h: 96, font: 'bold 52px Arial' }), fp.x, fp.y, fp.z, 0.06, 1.1, Math.min(span, 26), yaw, false);
  }
  // piers: cap beam + twin columns
  for (const l of piers) {
    const cap = at(l, deckTop - 2.4);
    bat.box(M.viaduct(), cap.x, cap.y, cap.z, W + 0.4, 0.9, 1.4, yaw);
    for (const f of [-3.3, 3.3]) {
      const col = at(l, (deckTop - 2.85) / 2, f);
      bat.box(M.viaduct(), col.x, col.y, col.z, 1.0, deckTop - 2.85, 1.0, yaw);
    }
  }
  // abutments
  for (const l of [abutL, abutR]) {
    const ab = at(l, deckTop / 2 - 0.5);
    bat.box(M.stonePitch(), ab.x, ab.y, ab.z, W + 1.4, deckTop - 0.2, 2.4, yaw);
  }
  // approach ramps: retained earth fill stepping down, smooth asphalt on top
  const road = new GeoAccum(false);
  const frames = [];
  for (let l = lEnd0 - 260; l <= lEnd1 + 260; l += 3) {
    const p = at(l);
    frames.push({ x: p.x, y: heightAt(l) + 0.05, z: p.z, th: H0 + Math.PI / 2, s: l });
  }
  road.sweep(frames, [[-W / 2 + 1.2, 0], [W / 2 - 1.2, 0]], { uScale: 1 / 9, uOff: 0.5, vScale: 1 / 9 });
  for (const side of [-1, 1]) road.sweep(frames, [[side > 0 ? W / 2 - 1.2 : -W / 2, 0.15], [side > 0 ? W / 2 : -W / 2 + 1.2, 0.15]], { uScale: 0.3, vScale: 0.3 });
  const rm = meshFrom(road, M.asphalt(), { cast: false });
  if (rm) group.add(rm);
  for (let l = lEnd0; l < lEnd1; l += 4) {
    if (l + 4 > abutL && l < abutR) continue;
    const h = Math.min(heightAt(l), heightAt(l + 4));
    if (h < 0.2) continue;
    const p = at(l + 2, h / 2 - 0.1);
    bat.box(M.stonePitch(), p.x, p.y, p.z, W, h, 4.05, yaw, true);
  }
  // crash barriers + railings + lamps along the elevated part
  for (let l = lEnd0 + 30; l < lEnd1 - 30; l += 3) {
    const h = heightAt(l);
    if (h < 1.0) continue;
    for (const f of [-W / 2 + 0.2, W / 2 - 0.2]) {
      const p = at(l + 1.5, h + 0.55, f);
      bat.box(M.concrete(), p.x, p.y, p.z, 0.35, 0.9, 3.05, yaw, false);
      const r = at(l + 1.5, h + 1.25, f);
      bat.box(M.steelDark(), r.x, r.y, r.z, 0.06, 0.06, 3.05, yaw, false);
    }
  }
  for (let l = abutL - 60; l <= abutR + 60; l += 18) {
    const h = heightAt(l);
    const p = at(l, h + 4.5, -W / 2 + 0.4);
    bat.box(M.steelGreen(), p.x, p.y, p.z, 0.16, 9, 0.16, yaw, false);
    const lp = at(l, h + 8.9, -W / 2 + 1.4);
    bat.box(M.lampHead(), lp.x, lp.y, lp.z, 1.6, 0.16, 0.4, yaw + Math.PI / 2, false);
  }
  // traffic on the bridge
  const vehicles = [[2.5, 3.1, 9, 0xd35400], [1.6, 1.7, 4.3, 0xffffff], [1.4, 1.6, 2.7, 0x2e7d32], [2.5, 3.2, 10, 0x1565c0], [1.8, 1.5, 4.5, 0x37474f]];
  for (let i = 0; i < 7; i++) {
    const v = pick(rand, vehicles);
    const l = range(rand, lEnd0 + 40, lEnd1 - 40);
    const lane = rand() < 0.5 ? -2 : 2;
    const h = heightAt(l);
    const p = at(l, h + v[1] / 2 + 0.35, lane);
    bat.box(M.plaster(v[3]), p.x, p.y, p.z, v[0], v[1], v[2], yaw);
    const w = at(l, h + 0.35, lane);
    bat.box(M.black(), w.x, w.y, w.z, v[0] * 0.95, 0.6, v[2] * 0.85, yaw, false);
  }
  group.add(bat.build());
  // corridor for prop exclusion / OHE mast avoidance
  return {
    contains: (x, z, pad = 0) => {
      const dx = x - (P0.x + F.x * a), dz = z - (P0.z + F.z * a);
      const along = dx * F.x + dz * F.z, lat = dx * R.x + dz * R.z;
      return Math.abs(along) < W / 2 + 4 + pad && lat > lEnd0 - 260 && lat < lEnd1 + 260;
    },
    nearMast: (x, z) => {
      const dx = x - (P0.x + F.x * a), dz = z - (P0.z + F.z * a);
      return Math.abs(dx * F.x + dz * F.z) < 9;
    }
  };
}

// Steel plate girders + plaque where the VV Nagar road passes under the viaduct.
export function buildRoadSpan(group, path, s, halfDeck = 6.5) {
  const bat = new Batcher();
  const y = path.yAt(s);
  const th = path.headingAt(s);
  for (const lat of [-halfDeck + 0.8, -2.2, 2.2, halfDeck - 0.8]) {
    const p = path.pointAt(s, lat, new THREE.Vector3());
    bat.box(M.steelBlue(), p.x, y - 1.6, p.z, 0.45, 1.6, 18, -th, true);
  }
  for (const side of [-1, 1]) {
    const p = path.pointAt(s, side * (halfDeck + 0.05), new THREE.Vector3());
    bat.box(M.textBoard('VV NAGAR RUB  •  HEIGHT 4.5 m', { bg: '#f5c518', fg: '#111', w: 768, h: 96, font: 'bold 46px Arial' }), p.x, y - 1.2, p.z, 0.06, 0.8, 9, -th, false);
  }
  group.add(bat.build());
}

// Houses and shops along the road on the far side of the railway.
export function buildFarSide(group, origin, yaw, roadLen, seedKey) {
  const bat = new Batcher();
  const rand = makeRng(seedKey, 'farside');
  const walls = ['#f3e6c4', '#d9e8f0', '#f6d6c8', '#e7efc9', '#fbf3e4', '#f0d8a8'];
  const tf = new THREE.Matrix4().makeRotationY(yaw).setPosition(origin);
  const put = (mat, x, y, z, w, h, d, ry = 0) => {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(tf);
    bat.box(mat, p.x, p.y, p.z, w, h, d, yaw + ry);
  };
  const extent = roadLen - 8;
  for (let x = 12; x < extent; x += 15) {
    for (const side of [-1, 1]) {
      if (rand() < 0.15) continue;
      const shop = rand() < 0.45;
      const hex = pick(rand, walls);
      const mat = M.house(hex, Math.floor(rand() * 6), shop);
      const floors = shop ? 1 + (rand() < 0.4 ? 1 : 0) : 1 + (rand() < 0.5 ? 1 : 0);
      const w = range(rand, 8, 11), d = range(rand, 8, 10);
      const z = side * (6.5 + d / 2);
      for (let f = 0; f < floors; f++) put(mat, x, 1.6 + f * 3.2, z, w, 3.2, d, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      put(M.plaster(new THREE.Color(hex).getHex()), x, floors * 3.2 + 0.45, z, w + 0.2, 0.9, d + 0.2);
      if (shop) put(M.plaster(pick(rand, [0xc0392b, 0x2471a3, 0x1e8449, 0xb9770e])), x, 2.7, side * 6.9, w, 0.15, 1.6);
    }
    if ((x / 15) % 2 < 1) { // streetlights
      put(M.steelGreen(), x, 3.5, -5.2, 0.12, 7, 0.12);
      put(M.lampHead(), x, 6.9, -4.4, 0.3, 0.14, 1.6);
    }
  }
  group.add(bat.build());
}
