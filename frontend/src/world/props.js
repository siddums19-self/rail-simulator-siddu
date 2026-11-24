import * as THREE from 'three/webgpu';
import { M, registerNightEmissive } from '../core/materials.js';
import { Batcher, unitBox } from '../core/batcher.js';
import { makeRng, range, pick, mulberry32 } from '../core/rng.js';
import { blendBiome } from './biomes.js';
import { P } from './prototypes.js';
import { GeoAccum, meshFrom } from './geoAccum.js';

// Trackside scenery for one streamed chunk [a, b]. Everything is seeded by the
// chunk index, so a chunk always rebuilds identically.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _v = new THREE.Vector3();
let _boomGeo = null, _bandGeo = null;

const leafMats = {};
const leafMat = (hex, double = false) => {
  const k = hex + (double ? 'd' : '');
  if (!leafMats[k]) leafMats[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.78, side: double ? THREE.DoubleSide : THREE.FrontSide });
  return leafMats[k];
};

let kmAtlas = null;
function kmAtlasMaterial() {
  if (!kmAtlas) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f4f2ea'; ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#111'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let n = 0; n < 1024; n++) {
      const cx = (n % 32) * 32 + 16, cy = Math.floor(n / 32) * 32 + 16;
      ctx.fillText(String(n % 1000), cx, cy);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    kmAtlas = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
  }
  return kmAtlas;
}

function jitterColor(hex, rand, amt = 0.12) {
  const c = new THREE.Color(hex);
  const k = 1 + (rand() - 0.5) * 2 * amt;
  return c.multiplyScalar(k);
}

class InstanceList {
  constructor(geo, mat, cast = true) { this.geo = geo; this.mat = mat; this.items = []; this.cast = cast; this.colors = []; }
  push(x, y, z, ry, s, sy = s, color = null) { this.items.push([x, y, z, ry, s, sy]); this.colors.push(color); }
  build(group) {
    if (!this.items.length) return;
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
    const hasColor = this.colors.some(Boolean);
    this.items.forEach(([x, y, z, ry, s, sy], i) => {
      _e.set(0, ry, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(s, sy, s);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      if (hasColor) im.setColorAt(i, this.colors[i] || new THREE.Color(1, 1, 1));
    });
    im.castShadow = this.cast;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
}

export class PropBuilder {
  constructor(ctx) {
    this.ctx = ctx; // { layout, terrain, seedKey, density, exclusion(x,z,s,lat) -> bool, rotors }
  }

  build(group, idx, a, b) {
    const { layout, terrain, seedKey } = this.ctx;
    const density = this.ctx.density;
    const path = layout.path;
    const rand = makeRng(seedKey, 'props', idx);
    const sMid = (a + b) / 2;
    const biome = blendBiome(layout.biomeAt(sMid));
    const len = b - a;
    const station = layout.stationAt(sMid, 250);
    const lists = {};
    const L = (key, geo, mat, cast = true) => (lists[key] ||= new InstanceList(geo, mat, cast));
    const bat = new Batcher();

    const clearance = (s) => {
      const st = layout.stationAt(s, 120);
      let c = layout.lineAt(s) === 'S' ? 7.5 : 10;
      if (st) c = Math.max(Math.abs(st.layout.minLat), Math.abs(st.layout.maxLat)) + 26;
      const h = path.yAt(s) - path.groundAt(s);
      if (h > 0.3) c = Math.max(c, 9 + h * 1.8);
      return c;
    };
    const place = (minLat, maxLat, tries = 4) => {
      for (let t = 0; t < tries; t++) {
        const s = a + rand() * len;
        const side = rand() < 0.5 ? -1 : 1;
        const lo = Math.max(minLat, clearance(s));
        if (lo >= maxLat) continue;
        const lat = side * (lo + Math.pow(rand(), 1.4) * (maxLat - lo));
        path.pointAt(s, lat, _v);
        if (this.ctx.exclusion && this.ctx.exclusion(_v.x, _v.z, s, lat)) continue;
        const y = terrain.heightSL(s, lat, _v.x, _v.z);
        return { s, lat, x: _v.x, y, z: _v.z, side };
      }
      return null;
    };
    const count = (w) => {
      const n = w * density * (len / 200);
      return Math.floor(n) + (rand() < n % 1 ? 1 : 0);
    };

    // ---------------- trees
    const leafHex = { neem: 0x3e6b2c, acacia: 0x5a6e34, tall: 0x4f6e3a, banyan: 0x2f5a26, khejri: 0x6a7a3c, palm: 0x4d7a2a };
    const trunkGeo = { neem: P.neemTrunk, acacia: P.acaciaTrunk, tall: P.tallTrunk, banyan: P.banyanTrunk, khejri: P.khejriTrunk, palm: P.palmTrunk };
    const canopyGeo = { neem: P.neemCanopy, acacia: P.acaciaCanopy, tall: P.tallCanopy, banyan: P.banyanCanopy, khejri: P.khejriCanopy, palm: P.palmFronds };
    for (const [kind, w] of Object.entries(biome.trees)) {
      const n = count(w * 2.3);
      for (let i = 0; i < n; i++) {
        const near = rand() < 0.55;
        const pos = place(near ? 0 : 60, near ? 70 : 520);
        if (!pos) continue;
        const sc = range(rand, 0.75, 1.3);
        const ry = rand() * Math.PI * 2;
        L(kind + 't', trunkGeo[kind](), kind === 'tall' ? M.plaster(0xc8bfae) : M.bark()).push(pos.x, pos.y - 0.1, pos.z, ry, sc);
        L(kind + 'c', canopyGeo[kind](), leafMat(0xffffff, kind === 'palm')).push(pos.x, pos.y - 0.1, pos.z, ry, sc, sc, jitterColor(leafHex[kind], rand, 0.18));
      }
    }
    // palms line village ponds / coastal fields in clusters
    if (biome.trees.palm > 10) {
      const n = count(2);
      for (let i = 0; i < n; i++) {
        const c = place(30, 300);
        if (!c) continue;
        for (let k = 0; k < 6; k++) {
          const dx = (rand() - 0.5) * 30, dz = (rand() - 0.5) * 30;
          const y = terrain.heightAt(c.x + dx, c.z + dz);
          const sc = range(rand, 0.8, 1.2), ry = rand() * 6.28;
          L('palmt', P.palmTrunk(), M.bark()).push(c.x + dx, y - 0.1, c.z + dz, ry, sc);
          L('palmc', P.palmFronds(), leafMat(0xffffff, true)).push(c.x + dx, y - 0.1, c.z + dz, ry, sc, sc, jitterColor(leafHex.palm, rand));
        }
      }
    }

    // ---------------- grass tufts along the line (cheap, no shadows)
    const ng = count(biome.grassiness * 320 + 60);
    for (let i = 0; i < ng; i++) {
      const pos = place(0, 70, 2);
      if (!pos) continue;
      const sc = range(rand, 0.6, 1.5);
      const dry = rand();
      const tint = new THREE.Color().setRGB(biome.grass[0] * (1.1 + dry * 0.5), biome.grass[1] * (1.05 + dry * 0.25), biome.grass[2] * 0.95).multiplyScalar(0.75 + rand() * 0.35);
      L('grass', P.grassTuft(), M.grass(), false).push(pos.x, pos.y - 0.05, pos.z, rand() * 6.28, sc, sc * range(rand, 0.7, 1.3), tint);
    }

    // ---------------- bushes & boulders
    const nb = count(biome.bush);
    for (let i = 0; i < nb; i++) {
      const pos = place(0, 260);
      if (!pos) continue;
      const sc = range(rand, 0.6, 1.6);
      L('bush', P.bush(), leafMat(0xffffff)).push(pos.x, pos.y - 0.1, pos.z, rand() * 6, sc, sc * 0.8, jitterColor(0x56602f, rand, 0.25));
    }
    const ntor = count(biome.boulder);
    for (let i = 0; i < ntor; i++) {
      const c = place(25, 600);
      if (!c) continue;
      // Deccan granite tor: big rounded boulders stacked on each other
      const n = 3 + Math.floor(rand() * 6);
      let stackY = c.y - 0.6;
      for (let k = 0; k < n; k++) {
        const sc = range(rand, 1.6, 5.2) * (k === 0 ? 1.4 : 1);
        const dx = (rand() - 0.5) * 8, dz = (rand() - 0.5) * 8;
        const y = k < 3 ? terrain.heightAt(c.x + dx, c.z + dz) - sc * 0.3 : stackY;
        if (k >= 3) stackY += sc * 0.9;
        else stackY = Math.max(stackY, y + sc * 1.4);
        L('rock', P.boulder(), M.rock()).push(c.x + dx, y, c.z + dz, rand() * 6, sc, sc * range(rand, 0.7, 1.0), jitterColor(0x9a8a7a, rand, 0.15));
      }
    }

    // ---------------- fields (draped grids)
    if (biome.fields.length && !station) {
      const nf = count(biome.fieldCount);
      for (let i = 0; i < nf; i++) {
        const c = place(35, 380);
        if (!c) continue;
        const kind = pick(rand, biome.fields);
        this._field(group, c, range(rand, 40, 95), range(rand, 30, 70), path.headingAt(c.s) + (rand() - 0.5) * 0.3, kind);
      }
    }

    // ---------------- villages / urban blocks
    if (rand() < biome.village * density * (len / 200) * (biome.urban ? 3 : 1)) {
      const c = place(biome.urban ? 35 : 90, biome.urban ? 160 : 420);
      if (c) this._village(bat, c, path.headingAt(c.s), rand, !!biome.urban, terrain, L, leafMat);
    }

    // ---------------- wind turbines & solar farms (Deccan / Rajasthan)
    if (biome.turbine && rand() < biome.turbine * (len / 200) && !layout.stationAt(sMid, 3000)) { // no windmills near stations
      const c = place(300, 900);
      if (c) this._turbines(group, c, rand, terrain);
    }
    if (biome.solar && rand() < biome.solar * (len / 200)) {
      const c = place(70, 260);
      if (c) {
        const th = path.headingAt(c.s);
        for (let r = 0; r < 10; r++) for (let k = 0; k < 4; k++) {
          const lx = (k - 1.5) * 20, lz = r * 7;
          const x = c.x + Math.cos(th) * lx + Math.sin(th) * lz, z = c.z + Math.sin(th) * lx - Math.cos(th) * lz;
          L('solar', P.solarRow(), M.solarPanel()).push(x, terrain.heightAt(x, z), z, -th, 1);
        }
      }
    }

    // ---------------- linear trackside furniture
    // Old telegraph pole line on the left
    const lineSide = -1;
    for (let s = Math.ceil(a / 60) * 60; s < b; s += 60) {
      if (layout.stationAt(s, 50)) continue;
      const lat = lineSide * (clearance(s) + 4);
      path.pointAt(s, lat, _v);
      if (this.ctx.exclusion && this.ctx.exclusion(_v.x, _v.z, s, lat)) continue;
      L('pole', P.pole(), M.wood(), false).push(_v.x, terrain.heightSL(s, lat, _v.x, _v.z) - 0.2, _v.z, -path.headingAt(s), 1);
    }
    // Kilometre posts at every real km (every ~100 m in compressed sections => strong sense of speed)
    const kmA = Math.ceil(layout.realKmAt(a)), kmB = Math.floor(layout.realKmAt(b));
    const plates = new GeoAccum(false);
    for (let km = Math.max(0, kmA); km <= kmB; km++) {
      const s = layout.sAtRealKm(km);
      if (s < a || s >= b) continue;
      const lat = -(layout.lineAt(s) === 'S' ? 4.2 : 6.9);
      path.pointAt(s, lat, _v);
      const y = path.yAt(s);
      const th = path.headingAt(s);
      L('km', P.kmPost(), M.white(), false).push(_v.x, y - 0.1, _v.z, -th, 1);
      // number plate facing the driver
      const cell = km % 1000;
      const u0 = (cell % 32) / 32, v0 = 1 - (Math.floor(cell / 32) + 1) / 32;
      const fwd = new THREE.Vector3(Math.sin(th), 0, -Math.cos(th));
      const right = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
      const c0 = _v.clone().addScaledVector(fwd, -0.145);
      const w = 0.27, hgt = 0.27, yb = y + 0.62;
      const p0 = c0.clone().addScaledVector(right, -w / 2); p0.y = yb;
      const p1 = c0.clone().addScaledVector(right, w / 2); p1.y = yb;
      const p2 = p1.clone(); p2.y = yb + hgt;
      const p3 = p0.clone(); p3.y = yb + hgt;
      plates.quad(p0, p1, p2, p3, fwd.clone().negate(), [[u0, v0], [u0 + 1 / 32, v0], [u0 + 1 / 32, v0 + 1 / 32], [u0, v0 + 1 / 32]]);
    }
    const pm = meshFrom(plates, kmAtlasMaterial());
    if (pm) group.add(pm);

    // Speed restriction boards: limit at the start of each restricted curve, T/P (termination) at its end
    for (const c of layout.curves || []) {
      if (!c.vLimit) continue;
      const cap = layout.lineAt(c.s0) === 'S' ? 100 : 130;
      if (c.vLimit >= cap) continue;
      for (const [s, text] of [[c.s0 - 40, String(c.vLimit)], [c.s1 + 60, 'T/P']]) {
        if (s < a || s >= b) continue;
        const lat = -(layout.lineAt(s) === 'S' ? 3.9 : 6.6);
        path.pointAt(s, lat, _v);
        const th = path.headingAt(s);
        const y = path.yAt(s);
        bat.box(M.steelDark(), _v.x, y + 1.2, _v.z, 0.08, 2.4, 0.08, -th, false);
        const mat = M.textBoard(text, { bg: '#f5c518', fg: '#111', w: 128, h: 128, font: text === 'T/P' ? 'bold 46px Arial' : 'bold 62px Arial' });
        bat.box(mat, _v.x, y + 2.7, _v.z, 0.75, 0.75, 0.05, -th, false);
      }
    }

    // Level crossing occasionally in open country
    if (!station && rand() < 0.16 * (len / 200) && layout.gapAt(sMid) && Math.abs(path.yAt(sMid) - path.groundAt(sMid)) < 0.2) {
      this._levelCrossing(group, bat, sMid, rand);
    }

    // HT transmission line crossing
    if (rand() < 0.05 * (len / 200)) {
      const s = a + rand() * len;
      const th = path.headingAt(s) + 1.2 + rand() * 0.6;
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        const d = k * 140;
        path.pointAt(s, 0, _v);
        const x = _v.x + Math.sin(th) * d, z = _v.z - Math.cos(th) * d;
        const n = layout.path.nearest(x, z);
        if (n.dist < 30) continue;
        L('ht', P.htTower(), M.galvanised()).push(x, terrain.heightAt(x, z) - 0.3, z, -th, 1);
      }
    }

    for (const l of Object.values(lists)) l.build(group);
    group.add(bat.build());
  }

  _field(group, c, w, d, th, kind) {
    const { terrain } = this.ctx;
    const acc = new GeoAccum(false);
    const nx = 6, nz = 6;
    const cr = Math.cos(th), sr = Math.sin(th);
    const pts = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const lx = (i / nx - 0.5) * w, lz = (j / nz - 0.5) * d;
      const x = c.x + cr * lx + sr * lz, z = c.z + sr * lx - cr * lz;
      pts.push(new THREE.Vector3(x, terrain.heightAt(x, z) + 0.06, z));
    }
    const up = new THREE.Vector3(0, 1, 0);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a0 = pts[j * (nx + 1) + i], a1 = pts[j * (nx + 1) + i + 1], b0 = pts[(j + 1) * (nx + 1) + i], b1 = pts[(j + 1) * (nx + 1) + i + 1];
      const uv = [[i / nx * w / 12, j / nz * d / 12], [(i + 1) / nx * w / 12, j / nz * d / 12], [(i + 1) / nx * w / 12, (j + 1) / nz * d / 12], [i / nx * w / 12, (j + 1) / nz * d / 12]];
      acc.quad(a0, a1, b1, b0, up, uv); // CCW seen from above
    }
    const m = meshFrom(acc, M.field(kind));
    if (m) group.add(m);
    // bunds (earth borders) around the field
    const bat = new Batcher();
    for (const [lx, lz, bw, bd] of [[0, -d / 2, w, 0.5], [0, d / 2, w, 0.5], [-w / 2, 0, 0.5, d], [w / 2, 0, 0.5, d]]) {
      const x = c.x + cr * lx + sr * lz, z = c.z + sr * lx - cr * lz;
      bat.box(M.plaster(0x7a5a3e), x, terrain.heightAt(x, z) + 0.15, z, bw, 0.35, bd, -th, false);
    }
    group.add(bat.build());
  }

  _village(bat, c, th, rand, urban, terrain, L) {
    const walls = [0xe9dcc0, 0xd8e4ea, 0xf0d8c8, 0xe6e0a8, 0xc9dccb, 0xf2efe6, 0xe8c8a0];
    const n = urban ? 14 + Math.floor(rand() * 10) : 6 + Math.floor(rand() * 10);
    const cr = Math.cos(th), sr = Math.sin(th);
    for (let i = 0; i < n; i++) {
      const lx = (rand() - 0.5) * (urban ? 140 : 90), lz = (rand() - 0.5) * (urban ? 160 : 90);
      const x = c.x + cr * lx + sr * lz, z = c.z + sr * lx - cr * lz;
      const n2 = this.ctx.layout.path.nearest(x, z);
      if (n2.dist < 22 || (this.ctx.exclusion && this.ctx.exclusion(x, z, n2.s, n2.lat))) continue;
      const y = terrain.heightAt(x, z);
      const w = range(rand, 6, 11), d = range(rand, 6, 10);
      const floors = urban ? 2 + Math.floor(rand() * 4) : (rand() < 0.3 ? 2 : 1);
      const hex = pick(rand, walls);
      const seed = Math.floor(rand() * 6);
      const mat = M.house('#' + new THREE.Color(hex).getHexString(), seed, urban && rand() < 0.4);
      const ry = -th + (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.15;
      for (let f = 0; f < floors; f++) bat.box(mat, x, y + 1.6 + f * 3.2, z, w, 3.2, d, ry);
      const topY = y + floors * 3.2;
      if (!urban && rand() < 0.45) {
        // Mangalore-tiled sloping roof
        const roof = new THREE.CylinderGeometry(0.01, Math.max(w, d) * 0.72, 2.2, 4, 1);
        bat.add(roof, M.roofSheetRed(), x, topY + 1.1, z, 0, ry + Math.PI / 4, 0, 1, 1, Math.min(w, d) / Math.max(w, d));
      } else {
        bat.box(M.plaster(hex), x, topY + 0.45, z, w + 0.2, 0.9, d + 0.2, ry); // parapet
        bat.box(M.plaster(0x8a8578), x, topY + 0.1, z, w - 0.4, 0.2, d - 0.4, ry, false);
        if (rand() < 0.75) bat.cyl(M.tank(), x + 1.5, topY + 1.4, z + 1, 0.7, 0.7, 1.6, 10); // Sintex tank
      }
    }
    // village tank (pond) with mud banks
    if (!urban && rand() < 0.55) {
      const r = range(rand, 11, 22);
      const px = c.x - sr * 45, pz = c.z + cr * 45;
      const n3 = this.ctx.layout.path.nearest(px, pz);
      if (n3.dist > r + 25) {
        let y = Infinity;
        for (let k = 0; k < 8; k++) y = Math.min(y, terrain.heightAt(px + Math.cos(k) * r, pz + Math.sin(k) * r));
        bat.add(new THREE.CircleGeometry(r + 3, 28), M.mud(), px, y + 0.06, pz, -Math.PI / 2, 0, 0, 1, 1, 1, false);
        bat.add(new THREE.CircleGeometry(r, 28), M.water(), px, y + 0.12, pz, -Math.PI / 2, 0, 0, 1, 1, 1, false);
      }
    }
    // village temple & overhead water tank
    if (!urban && rand() < 0.6) {
      const x = c.x + cr * 20, z = c.z + sr * 20;
      const y = terrain.heightAt(x, z);
      const ry = -th;
      for (let k = 0; k < 5; k++) bat.box(M.plaster(k % 2 ? 0xf0c8a0 : 0xd9a066), x, y + 1 + k * 1.8, z, 6 - k, 1.8, 6 - k, ry);
      bat.box(M.plaster(0xc0392b), x, y + 10.2, z, 0.5, 1.2, 0.5, ry);
    }
    if (rand() < 0.55) {
      const x = c.x - cr * 30, z = c.z - sr * 30;
      const y = terrain.heightAt(x, z);
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) bat.box(M.concrete(), x + dx, y + 7, z + dz, 0.5, 14, 0.5);
      bat.cyl(M.concrete(), x, y + 16, z, 4.2, 3.4, 4.5, 14);
      bat.cyl(M.concrete(), x, y + 18.6, z, 0.4, 4.3, 0.8, 14);
    }
  }

  _turbines(group, c, rand, terrain) {
    const n = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const x = c.x + (rand() - 0.5) * 900, z = c.z + (rand() - 0.5) * 900;
      const y = terrain.heightAt(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 80, 12), M.white());
      tower.position.y = 40; tower.castShadow = true; tower.userData.disposable = true;
      const nac = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 9), M.white());
      nac.position.set(0, 81, 1.5); nac.userData.disposable = true;
      const rotor = new THREE.Group();
      rotor.position.set(0, 81, -3.2);
      for (let k = 0; k < 3; k++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(2.2, 42, 0.35), M.white());
        blade.position.y = 21; blade.userData.disposable = true;
        const arm = new THREE.Group(); arm.rotation.z = (k / 3) * Math.PI * 2; arm.add(blade);
        rotor.add(arm);
      }
      rotor.rotation.z = rand() * 6;
      g.rotation.y = 0.6;
      g.add(tower, nac, rotor);
      group.add(g);
      this.ctx.rotors.push({ obj: rotor, speed: 0.6 + rand() * 0.4, group });
    }
  }

  _levelCrossing(group, bat, s, rand, opt = {}) {
    const { layout, terrain } = this.ctx;
    const path = layout.path;
    const th = path.headingAt(s);
    const y = path.yAt(s);
    const acc = new GeoAccum(false);
    // road running perpendicular, draped on terrain
    const frames = [];
    const RL = opt.halfLen || 320;
    for (let l = -RL; l <= RL; l += 8) {
      path.pointAt(s, l, _v);
      const h = Math.abs(l) < 9 ? y + 0.66 : terrain.heightSL(s, l, _v.x, _v.z) + 0.08;
      frames.push({ x: _v.x, y: h, z: _v.z, th: th + Math.PI / 2, s: l, lat: 0 });
    }
    acc.sweep(frames, [[-3.6, 0], [3.6, 0]], { uScale: 1 / 7.2, uOff: 0.5, vScale: 1 / 7.2, latFn: () => 0 });
    const m = meshFrom(acc, M.asphalt());
    if (m) group.add(m);
    // gates (lifting booms), gate lodge, warning signs
    const boomMat = M.textBoard('', { bg: '#d42020', fg: '#ffffff', w: 64, h: 16 });
    const pivots = [];
    for (const side of [-1, 1]) {
      const lat = side * 9;
      path.pointAt(s - side * 4.5, lat, _v);
      bat.box(M.steelDark(), _v.x, y + 0.6, _v.z, 0.3, 1.2, 0.3, -th);
      // animated lifting boom: pivot at the post, boom extends along the track over the road
      const pivot = new THREE.Group();
      pivot.position.set(_v.x, y + 1.15, _v.z);
      pivot.rotation.set(side * 1.35, -th, 0, 'YXZ');
      const boom = new THREE.Mesh(_boomGeo ||= new THREE.BoxGeometry(0.13, 0.13, 9), M.white());
      boom.position.z = -side * 4.5;
      pivot.add(boom);
      for (let k = 0; k < 4; k++) {
        const band = new THREE.Mesh(_bandGeo ||= new THREE.BoxGeometry(0.14, 0.14, 0.9), boomMat);
        band.position.z = -side * (1.2 + k * 2.1);
        pivot.add(band);
      }
      group.add(pivot);
      pivots.push({ pivot, side, open: side * 1.35 });
    }
    // W/L whistle board 500 m before the crossing (left side, facing the driver)
    const wlS = s - 500;
    path.pointAt(wlS, -(layout.lineAt(wlS) === 'S' ? 4.2 : 6.9), _v);
    const wy = path.yAt(wlS);
    bat.box(M.steelDark(), _v.x, wy + 1.1, _v.z, 0.08, 2.2, 0.08, -path.headingAt(wlS), false);
    bat.box(M.textBoard('W/L', { bg: '#f5c518', fg: '#111', w: 128, h: 128, font: 'bold 60px Arial' }), _v.x, wy + 2.5, _v.z, 0.8, 0.8, 0.05, -path.headingAt(wlS), false);
    this.ctx.lcs.push({ s, wlS, pivots, group, closed: 0 });
    path.pointAt(s - 12, -14, _v);
    const gy = terrain.heightSL(s - 12, -14, _v.x, _v.z);
    bat.box(M.plaster(0xe8dcc0), _v.x, gy + 1.4, _v.z, 3, 2.8, 3, -th);
    bat.box(M.roofSheetRed(), _v.x, gy + 2.95, _v.z, 3.4, 0.15, 3.4, -th);
    if (opt.manned) { // gateman's cabin board, gate keeper and a few waiting vehicles
      bat.box(M.textBoard('MANNED L.C. GATE No. 3\nVV NAGAR', { bg: '#f5c518', fg: '#111', w: 512, h: 160, font: 'bold 44px Arial' }), _v.x, gy + 2.3, _v.z, 0.06, 0.9, 2.6, -th + Math.PI / 2, false);
      for (const side of [-1, 1]) {
        path.pointAt(s + side * 14, side * 1.9 * 0 - 18, _v);
        const wy = terrain.heightSL(s, -18, _v.x, _v.z);
        bat.box(M.textBoard('STOP\nLOOK  LISTEN', { bg: '#ffffff', fg: '#c0392b', w: 256, h: 160, font: 'bold 40px Arial' }), _v.x, wy + 2.4, _v.z, 1.2, 0.8, 0.05, -th + Math.PI / 2, false);
        bat.box(M.steelDark(), _v.x, wy + 1.1, _v.z, 0.08, 2.2, 0.08, 0, false);
      }
    }
    // a waiting truck and auto-rickshaw
    const colors = [0xf39c12, 0x2e86c1, 0x27ae60, 0xc0392b];
    for (const [lat, w, h, d] of [[16, 2.5, 3.0, 7], [24, 1.4, 1.6, 2.6]]) {
      path.pointAt(s + 2, lat, _v);
      const gy2 = terrain.heightSL(s + 2, lat, _v.x, _v.z);
      bat.box(M.plaster(pick(rand, colors)), _v.x, gy2 + h / 2 + 0.4, _v.z, d, h, w, -th);
      bat.box(M.black(), _v.x, gy2 + 0.4, _v.z, d * 0.9, 0.7, w * 1.02, -th);
    }
  }
}
