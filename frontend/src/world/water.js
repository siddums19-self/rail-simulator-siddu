import { carveCut } from './secunderabad.js';
import * as THREE from 'three/webgpu';
import { makeRng, range } from '../core/rng.js';
import { Batcher } from '../core/batcher.js';
import { M } from '../core/materials.js';

// Water in the landscape:
//  * rivers the lines really cross (km from the edge's first hub), plus small nallahs / streams,
//    each with a bridge — the river bed lowers the natural ground under the track, so the
//    formation builder puts the line on a bridge, and the water runs across the line;
//  * village tanks and ponds in the open country (Deccan tanks especially);
//  * the sea beside the coastal termini and ports.

// edgeId -> [km from the edge's fromHub, name, width m, depth m]
const RIVERS = {
  GTL_TO_RC: [[70, 'Tungabhadra', 420, 8]],
  RC_TO_WADI: [[22, 'Krishna', 520, 9], [70, 'Bhima', 300, 7]],
  KRNT_TO_GWD: [[6, 'Tungabhadra', 450, 8]],
  GWD_TO_SC: [[14, 'Krishna', 480, 9]],
  HPT_TO_UBL: [[9, 'Tungabhadra', 380, 8]],
  MAS_TO_BZA: [[176, 'Penna', 300, 7], [428, 'Krishna', 900, 10]],
  BZA_TO_VSKP: [[150, 'Godavari', 1200, 11]],
  VSKP_TO_HWH: [[440, 'Mahanadi', 1000, 10], [870, 'Rupnarayan', 450, 8]],
  WADI_TO_KYN: [[260, 'Bhima', 320, 7]],
  BSR_TO_ADI: [[2, 'Vasai Creek', 600, 7], [230, 'Tapi', 600, 9], [290, 'Narmada', 1100, 10], [370, 'Mahi', 500, 8]],
  KYN_TO_CSMT: [[18, 'Thane Creek', 220, 6]],
  DDR_TO_BSR: [[40, 'Vasai Creek', 600, 7]],
  SC_TO_NDLS: [[190, 'Godavari', 700, 10], [520, 'Wardha', 350, 8], [860, 'Narmada', 700, 10], [1150, 'Betwa', 300, 8], [1460, 'Chambal', 500, 9], [1580, 'Yamuna', 600, 9]],
  LD_TO_VSG: [[92, 'Zuari', 350, 7]],
  SBC_TO_ATP: [[130, 'Penna', 200, 6]],
  MAS_TO_GTL: [[300, 'Penna', 250, 6]],
  CBE_TO_SBC: [[70, 'Cauvery', 380, 8]],
  MAQ_TO_VSG: [[12, 'Netravati', 420, 8], [160, 'Sharavati', 520, 9], [310, 'Kali', 480, 9], [415, 'Zuari', 550, 9]]
};
// Coastal stations: the sea lies this far to one side of the line.
const SEA = { VSKP: 900, VSG: 700, CSMT: 800, MAS: 900, DDR: 700, BSR: 1400, MAQ: 850, UD: 950, KAWR: 750 };
const LAKE_DENSITY = {
  DECCAN_PLATEAU: 1.4, EASTERN_GHATS_DECCAN: 1.0, CENTRAL_NORTH_PLAINS: 0.9, EAST_COAST_DELTA: 1.6, EAST_COAST_BENGAL: 1.8,
  GODAVARI_COAST: 1.5, KONKAN_COAST: 1.2, NALLAMALA_COASTAL: 0.8, WEST_COAST_GUJARAT: 0.9, ARAVALLI_RAJASTHAN: 0.4, RAJASTHAN_NCR: 0.5,
  WESTERN_GHATS_URBAN: 0.5, WESTERN_GHATS_PLATEAU: 0.7, URBAN_SUBURBAN: 0.3
};

// ---- rivers along the route (route distance s), computed inside the layout before the path is built
export function planRivers({ gaps, stations, seedKey, realKmAt, sAtRealKm, godavari = null, krishna = null, dudhsagar = null }) {
  const rivers = [];
  if (godavari) {
    rivers.push({ s: godavari.sMid, width: godavari.riverWidth, depth: godavari.depth, name: 'Godavari', big: true, godavari: true });
  }
  if (krishna) {
    rivers.push({ s: krishna.sMid, width: krishna.riverWidth, depth: krishna.depth, name: 'Krishna', big: true, krishna: true });
  }
  if (dudhsagar) {
    rivers.push({ s: dudhsagar.sMid, width: dudhsagar.riverWidth, depth: dudhsagar.depth, name: 'Dudhsagar Falls', big: true, dudhsagar: true });
  }
  const nearStation = (s, pad) => stations.some((st) => s > st.layout.zoneStart - pad && s < st.layout.zoneEnd + pad);
  // legs -> route km where each leg starts
  const legStart = new Map();
  for (const g of gaps) if (!legStart.has(g.legIdx)) legStart.set(g.legIdx, { km: stations[g.index].realKm, g });
  for (const [, { km, g }] of legStart) {
    const list = RIVERS[g.leg.edgeId];
    if (!list) continue;
    for (const [rk, name, width, depth] of list) {
      if (godavari && name === 'Godavari' && ['BZA_TO_VSKP', 'BZA_TO_RJY', 'RJY_TO_VSKP'].includes(g.leg.edgeId)) continue;
      const along = g.leg.reversed ? g.leg.distanceKm - rk : rk;
      let s = sAtRealKm(km + along);
      if (gaps.some((x) => x.special && s > x.s0 - 300 && s < x.s0 + x.specialLen + 300)) continue;
      for (let k = 0; k < 20 && nearStation(s, width / 2 + 250); k++) s += 300; // keep bridges out of station yards
      if (!nearStation(s, width / 2 + 250)) rivers.push({ s, width, depth, name, big: true });
    }
  }
  // small streams (nallahs / vagus) every so often in open country
  gaps.forEach((g, i) => {
    const rand = makeRng(seedKey, 'streams', i);
    const len = g.s1 - g.s0;
    const n = Math.floor((g.realKm / 9) * (0.4 + rand()));
    for (let k = 0; k < n; k++) {
      const s = g.s0 + len * (0.1 + 0.8 * rand());
      const width = range(rand, 18, 45);
      if (nearStation(s, 300) || rivers.some((r) => Math.abs(r.s - s) < r.width / 2 + 600)) continue;
      if (g.special && s < g.s0 + g.specialLen + 300) continue;
      rivers.push({ s, width, depth: range(rand, 4.6, 5.6), name: null, big: false });
    }
  });
  rivers.sort((a, b) => a.s - b.s);
  return rivers;
}

const BANK = 30;
// Depth of the river bed below the natural ground at route distance s (0 outside any river).
export function riverCarve(rivers, s) {
  let best = 0;
  for (const r of rivers) {
    const d = Math.abs(s - r.s), hw = r.width / 2;
    if (d > hw + BANK) continue;
    const k = d < hw ? 0.8 + 0.2 * (1 - (d / hw) ** 2) : 0.8 * (1 - smooth((d - hw) / BANK));
    best = Math.max(best, r.depth * k);
  }
  return best;
}
export function riverMask(rivers, s) {
  let m = 0;
  for (const r of rivers) {
    const d = Math.abs(s - r.s) - r.width / 2;
    if (d < 140) m = Math.max(m, d < 0 ? 1 : 1 - smooth(d / 140));
  }
  return m;
}
const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

// ---- everything off the line: tanks / ponds and the sea, plus the meshes for all water
export class Water {
  constructor(layout, seedKey) {
    this.layout = layout;
    this.rivers = layout.rivers || [];
    this.lakes = [];
    this.coasts = [];
    this.seedKey = seedKey;
    this.group = new THREE.Group();
    this._riverRects = this.rivers.map((r) => {
      const p = layout.path.pointAt(r.s, 0, new THREE.Vector3());
      const th = layout.path.headingAt(r.s);
      return { r, x: p.x, z: p.z, F: { x: Math.sin(th), z: -Math.cos(th) }, R: { x: Math.cos(th), z: Math.sin(th) } };
    });
  }

  // Needs the terrain (for water levels), so it is planned after the terrain exists.
  plan(terrain) {
    const L = this.layout, path = L.path;
    // the sea beside coastal stations
    for (const st of L.stations) {
      const D = SEA[st.code];
      if (!D) continue;
      const rand = makeRng(this.seedKey, 'sea', st.code);
      const side = rand() < 0.5 ? -1 : 1;
      const halfW = Math.max(Math.abs(st.layout.minLat), Math.abs(st.layout.maxLat));
      this.coasts.push({ s0: st.layout.sCenter - 6000, s1: st.layout.sCenter + 6000, side, dist: Math.max(D, halfW + 450), level: path.groundAt(st.layout.sCenter) - 1.4, st });
    }
    this._hussainSagar(terrain);
    // Lake across both sides of the track 10 km before Gooty (GTL -> GY), spanning 300 m on both sides (embankment, not bridge)
    const v = new THREE.Vector3();
    for (let i = 0; i < L.stations.length - 1; i++) {
      const a = L.stations[i], b = L.stations[i + 1];
      if ((a.code === 'GTL' && b.code === 'GY') || (a.code === 'GY' && b.code === 'GTL')) {
        const g = L.gaps[i];
        const targetKm = b.code === 'GY' ? b.realKm - 10 : a.realKm + 10;
        let sLake = L.sAtRealKm(targetKm);
        sLake = Math.max(g.s0 + 350, Math.min(g.s1 - 350, sLake));
        if (!L.stationAt(sLake, 350) && !this.rivers.some((r) => Math.abs(r.s - sLake) < r.width / 2 + 350)) {
          path.pointAt(sLake, 0, v);
          this.lakes.push({ x: v.x, z: v.z, r: 300, level: path.yAt(sLake) - 1.8, depth: 4.0, bund: false, bothSides: true });
        }
        break;
      }
    }
    // village tanks and ponds (and occasional lakes across both sides of the track in open country)
    L.gaps.forEach((g, i) => {
      const rand = makeRng(this.seedKey, 'lakes', i);
      if (rand() < 0.28 && g.s1 - g.s0 > 1200) {
        const s = g.s0 + (g.s1 - g.s0) * (0.25 + 0.5 * rand());
        if (!L.stationAt(s, 450) && !this.rivers.some((r) => Math.abs(r.s - s) < r.width / 2 + 450)
          && !(g.special && s < g.s0 + g.specialLen + 400)
          && !this.lakes.some((l) => l.bothSides && Math.hypot(l.x - path.pointAt(s, 0, v).x, l.z - v.z) < 900)) {
          const r = range(rand, 180, 280);
          path.pointAt(s, 0, v);
          this.lakes.push({ x: v.x, z: v.z, r, level: path.yAt(s) - 1.8, depth: 3.8, bund: false, bothSides: true });
        }
      }
      const dens = LAKE_DENSITY[g.biome] ?? 0.8;
      const n = Math.round((g.realKm / 7) * dens * (0.5 + rand()));
      for (let k = 0; k < n; k++) {
        const s = g.s0 + (g.s1 - g.s0) * (0.05 + 0.9 * rand());
        if (L.stationAt(s, 700) || this.rivers.some((r) => Math.abs(r.s - s) < r.width / 2 + 500)) continue;
        if (g.special && s < g.s0 + g.specialLen + 400) continue;
        const r = range(rand, 30, rand() < 0.2 ? 220 : 110);
        const lat = (rand() < 0.5 ? -1 : 1) * (L.flatHalfWidth(s) + r + range(rand, 40, 520));
        path.pointAt(s, lat, v);
        if (this.lakes.some((l) => Math.hypot(l.x - v.x, l.z - v.z) < l.r + r + 60)) continue;
        if (this.coasts.some((c) => s > c.s0 && s < c.s1)) continue;
        const near = path.nearest(v.x, v.z);
        if (near.dist < L.flatHalfWidth(near.s) + r + 20) continue; // a curve brought the line close
        const level = terrain.heightAt(v.x, v.z) - 0.5;
        this.lakes.push({ x: v.x, z: v.z, r, level, depth: Math.min(4, 1.2 + r * 0.02), bund: rand() < 0.6 && r > 50 });
      }
    });
  }

  // Hussain Sagar beside Necklace Road (Hyderabad MMTS). On the left for trains coming from Hyderabad
  // (Nampally) towards Begumpet, so on the right the other way; it stretches ~1.8 km along the line.
  _hussainSagar(terrain) {
    const L = this.layout, path = L.path, st = L.stations;
    const i = st.findIndex((x) => x.code === 'NCKR');
    if (i < 0) return;
    const hyb = st.findIndex((x) => x.code === 'HYB'), bmt = st.findIndex((x) => x.code === 'BMT');
    // direction of travel away from Hyderabad: +s if HYB comes before NCKR (or BMT after it)
    const fromHyb = hyb >= 0 ? hyb < i : bmt >= 0 ? bmt > i : true;
    const side = fromHyb ? -1 : 1;                       // left of travel away from Hyderabad
    const s0 = st[i].layout.sCenter, v = new THREE.Vector3();
    const level = terrain.heightAt(...path.pointAt(s0, side * 500, v).toArray().filter((_, k) => k !== 1)) - 1.2;
    for (let k = -4; k <= 4; k++) {
      const r = 300 - Math.abs(k) * 22;                  // widest opposite the station, tapering at both ends
      path.pointAt(s0 + k * 220, side * (r + 70), v);
      this.lakes.push({ x: v.x, z: v.z, r, level, depth: 6, bund: false, big: true });
    }
    path.pointAt(s0, side * 330, v);
    this.statue = { x: v.x, z: v.z, y: level, name: 'Hussain Sagar' };
  }

  // Terrain hook: lower the ground under tanks and the sea.
  carve(x, z, near, h) {
    for (const c of this.cuts || []) h = carveCut(c, x, z, h);
    for (const l of this.lakes) {
      if (l.bothSides && Math.abs(near.lat) < 7.5) continue; // keep the track causeway/embankment above the lake
      const d = Math.hypot(x - l.x, z - l.z);
      if (d > l.r * 1.45) continue;
      const k = d / l.r;
      const bed = l.level - l.depth * Math.max(0, 1 - k * k);
      if (k < 1) {
        if (l.bothSides && Math.abs(near.lat) < 12) {
          const bankT = smooth((Math.abs(near.lat) - 7.5) / 4.5);
          h = h + (Math.min(h, bed) - h) * bankT;
        } else h = Math.min(h, bed);
      }
      else h = Math.min(h, l.level + 0.25 + (h - l.level - 0.25) * smooth((k - 1) / 0.45)); // gentle banks
      if (l.bund && k > 1.02 && k < 1.18) h = Math.max(h, l.level + 1.1 * (1 - Math.abs(k - 1.1) / 0.08)); // tank bund
    }
    for (const c of this.coasts) {
      if (near.s < c.s0 || near.s > c.s1) continue;
      const fade = Math.min(1, (near.s - c.s0) / 1500, (c.s1 - near.s) / 1500);
      const d = near.lat * c.side - c.dist; // > 0: out to sea
      if (d < -90) continue;
      const bed = c.level - 0.6 - Math.max(0, d) * 0.035;
      const beach = d < 0 ? c.level + 0.6 + (-d / 90) * 1.5 : bed;
      h = h + (Math.min(h, d < 0 ? beach : bed) - h) * fade;
    }
    return h;
  }

  riverMaskAt(s) { return riverMask(this.rivers, s); }

  // No trees, huts or villages in the water.
  contains(x, z) {
    for (const l of this.lakes) if ((x - l.x) ** 2 + (z - l.z) ** 2 < (l.r * 1.25) ** 2) return true;
    for (const q of this._riverRects) {
      const dx = x - q.x, dz = z - q.z;
      const maxSpan = (q.r.godavari || q.r.krishna) ? 8000 : 3000;
      if (Math.abs(dx * q.F.x + dz * q.F.z) < q.r.width / 2 + 20 && Math.abs(dx * q.R.x + dz * q.R.z) < maxSpan) return true;
    }
    return false;
  }

  build(scene) {
    const L = this.layout, path = L.path;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3d6f78, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.93 });
    const seaMat = new THREE.MeshStandardMaterial({ color: 0x2f6e86, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide });
    // rivers: a long sheet across the line at each crossing
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    if (this._riverRects.length) {
      const rm = new THREE.InstancedMesh(quad, mat, this._riverRects.length);
      const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
      this._riverRects.forEach((q, i) => {
        const r = q.r;
        const level = path.yAt(r.s) - r.depth * 0.62; // water some way below the bridge deck
        const th = path.headingAt(r.s);
        q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -th);
        pos.set(q.x, level, q.z);
        sc.set((r.godavari || r.krishna) ? 16000 : 6000, 1, r.width * 0.92);
        m4.compose(pos, q4, sc);
        rm.setMatrixAt(i, m4);
      });
      rm.receiveShadow = true;
      this.group.add(rm);
    }
    // tanks and ponds
    if (this.lakes.length) {
      const disc = new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2);
      const lm = new THREE.InstancedMesh(disc, mat, this.lakes.length);
      const m4 = new THREE.Matrix4();
      this.lakes.forEach((l, i) => lm.setMatrixAt(i, m4.makeScale(l.r * 1.03, 1, l.r * 1.03).setPosition(l.x, l.level, l.z)));
      lm.receiveShadow = true;
      this.group.add(lm);
    }
    // Hussain Sagar: the Gibraltar Rock island with the white Buddha statue
    if (this.statue) {
      const { x, z, y } = this.statue, stone = new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 0.95 });
      const white = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6 });
      const add = (geo, m, px, py, pz) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.castShadow = true; this.group.add(o); return o; };
      add(new THREE.CylinderGeometry(16, 22, 4, 18), stone, x, y + 1.2, z);          // rock island
      add(new THREE.CylinderGeometry(3.2, 3.8, 3, 12), white, x, y + 4.7, z);         // lotus pedestal
      add(new THREE.CylinderGeometry(1.9, 3.0, 12, 14), white, x, y + 12.2, z);       // robed figure
      add(new THREE.SphereGeometry(1.5, 16, 12), white, x, y + 19.3, z);              // head
      add(new THREE.ConeGeometry(0.55, 1.2, 10), white, x, y + 20.9, z);             // ushnisha
    }
    // the sea: a broad sheet beyond each coastline
    for (const c of this.coasts) {
      const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const n = 24, pts = [];
      const v = new THREE.Vector3();
      for (let k = 0; k <= n; k++) { const s = c.s0 + ((c.s1 - c.s0) * k) / n; path.pointAt(s, c.side * (c.dist - 40), v); pts.push(v.clone()); }
      const geo = new THREE.BufferGeometry();
      const verts = [], idx = [];
      pts.forEach((p, k) => {
        const s = c.s0 + ((c.s1 - c.s0) * k) / n, th = path.headingAt(s);
        const ox = Math.cos(th) * c.side * 9000, oz = Math.sin(th) * c.side * 9000;
        verts.push(p.x, c.level, p.z, p.x + ox, c.level, p.z + oz);
        if (k < n) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      g.dispose();
      const sea = new THREE.Mesh(geo, seaMat);
      sea.receiveShadow = true;
      this.group.add(sea);
    }
    // name boards at the big bridges
    const bat = new Batcher(), v = new THREE.Vector3();
    for (const r of this.rivers) {
      if (!r.name) continue;
      for (const [sb, side] of [[r.s - r.width / 2 - 45, -1], [r.s + r.width / 2 + 45, 1]]) {
        const lat = -(L.lineAt(sb) === 'S' ? 4.4 : 7.1);
        path.pointAt(sb, lat, v);
        const y = path.yAt(sb), th = -path.headingAt(sb) + (side > 0 ? Math.PI : 0);
        bat.box(M.steelDark(), v.x, y + 1.2, v.z, 0.1, 2.4, 0.1, th, false);
        bat.box(M.textBoard(`RIVER ${r.name.toUpperCase()}`, { bg: '#f5c518', fg: '#111', w: 512, h: 128, font: 'bold 46px Arial' }), v.x, y + 2.8, v.z, 3.0, 0.75, 0.06, th, false);
      }
    }
    this.group.add(bat.build());
    scene.add(this.group);
  }

  dispose() { this.group.removeFromParent(); }
}
