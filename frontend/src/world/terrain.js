import * as THREE from 'three/webgpu';
import { STREAM } from '../config.js';
import { fbm2, ridged2, smoothstep, valueNoise2 } from '../core/rng.js';
import { terrainDetailTexture } from '../core/textures.js';
import { blendBiome } from './biomes.js';

// Spatial index over extra world polylines (e.g. GTL Gooty/Bellary lines) so
// terrain stays flat under them too.
export class PolylineIndex {
  constructor(cell = 120) { this.cell = cell; this.map = new Map(); this.count = 0; }
  _k(cx, cz) { return cx * 92837111 ^ cz * 689287499; }
  add(points, step = 3) {
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      const k = this._k(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
      let a = this.map.get(k);
      if (!a) { a = []; this.map.set(k, a); }
      a.push(p);
      this.count++;
    }
  }
  distance(x, z, maxR = 600) {
    if (!this.count) return Infinity;
    let best = Infinity;
    const r = Math.ceil(maxR / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const a = this.map.get(this._k(cx + i, cz + j));
      if (!a) continue;
      for (const p of a) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) best = d; }
    }
    return Math.sqrt(best);
  }
}

function hillShape(B, x, z) {
  // Domain-warped coordinates so mountain ranges curve naturally instead of forming regular blobs
  const wx = x + (fbm2(x * 0.0009, z * 0.0009, 2, 13) - 0.5) * 240;
  const wz = z + (fbm2(x * 0.0009 + 19.3, z * 0.0009 - 7.1, 2, 17) - 0.5) * 240;
  if (B.hillType === 'ridged') {
    const rMain = ridged2(wx * B.hillScale, wz * B.hillScale, 5, 7);
    const rSpur = ridged2(wx * B.hillScale * 2.35, wz * B.hillScale * 2.35, 3, 29);
    const base = Math.pow(Math.max(0, rMain - 0.3) / 0.7, 1.45);
    // Subtle Deccan/Western Ghats basalt cliff-terrace steps on steep ridges
    const terrace = Math.sin(base * 14) * 0.022 * smoothstep(0.25, 0.75, base);
    return Math.max(0, base * (0.82 + 0.32 * rSpur) + terrace);
  }
  const f = fbm2(wx * B.hillScale, wz * B.hillScale, 5, 3);
  const detail = ridged2(wx * B.hillScale * 2.1, wz * B.hillScale * 2.1, 3, 19);
  const h = Math.pow(Math.max(0, f - 0.3) / 0.7, 1.25);
  return h * (0.85 + 0.22 * detail);
}

export class Terrain {
  constructor(scene, layout, extraLines = null, flatZones = []) {
    this.flatZones = flatZones;
    this.scene = scene;
    this.layout = layout;
    this.path = layout.path;
    this.extra = extraLines || new PolylineIndex();
    this.tiles = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
    const det = terrainDetailTexture();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, map: det.map, normalMap: det.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.97, metalness: 0
    });
  }

  dispose() {
    for (const t of this.tiles.values()) t.mesh.geometry.dispose();
    this.tiles.clear();
    this.group.removeFromParent();
  }

  // Full height query (any world point).
  heightAt(x, z) {
    const n = this.path.nearest(x, z);
    return this._height(x, z, n).h;
  }

  // Fast query when (s, lat) of the point is already known.
  heightSL(s, lat, x, z) {
    return this._height(x, z, { s, lat, dist: Math.abs(lat) }).h;
  }

  _height(x, z, near) {
    const L = this.layout;
    const s = Math.min(Math.max(near.s, 0), this.path.length);
    const gy = this.path.groundAt(s);
    const flatW = L.flatHalfWidth(s);
    let d = near.dist;
    const de = this.extra.count ? this.extra.distance(x, z, 420) : Infinity;
    const dFlat = Math.min(d, de + 30);
    const biome = blendBiome(L.biomeAt(s));
    const t = smoothstep(flatW, flatW + 280, dFlat) * (this.water ? 1 - this.water.riverMaskAt(s) : 1); // flat river valleys
    let hills = 0;
    if (t > 0) {
      if (biome._A) {
        hills = biome._A.hill * hillShape(biome._A, x, z) * (1 - biome._t) + biome._B.hill * hillShape(biome._B, x, z) * biome._t;
      } else hills = biome.hill * hillShape(biome, x, z);
    }
    let micro = (fbm2(x / 45, z / 45, 3, 11) - 0.5) * 1.6 * smoothstep(9, 45, Math.min(d, de)) * smoothstep(flatW - 30, flatW + 60, dFlat);
    for (const fz of this.flatZones) {
      const dz = Math.hypot(x - fz.x, z - fz.z);
      if (dz < fz.r + 60) micro *= smoothstep(fz.r, fz.r + 60, dz);
    }
    let h = gy - 0.07 + hills * t + micro * (0.35 + 0.65 * t);
    if (this.water) h = this.water.carve(x, z, near, h);
    return { h, biome, d: Math.min(d, de), t };
  }

  _colorAt(x, z, info, slope, out) {
    const B = info.biome;
    const n1 = fbm2(x / 90, z / 90, 3, 5);
    // soft mid-scale variation (a fine per-vertex noise read as a chequer of squares)
    const n2 = valueNoise2(x / 37, z / 37, 9) * 0.65 + fbm2(x / 160, z / 160, 2, 41) * 0.35;
    const g = Math.min(1, Math.max(0, (n1 - 0.5) * 2.2 + B.grassiness - 0.15 + (n2 - 0.5) * 0.3));
    let r = B.soil[0] + (B.grass[0] - B.soil[0]) * g;
    let gg = B.soil[1] + (B.grass[1] - B.soil[1]) * g;
    let b = B.soil[2] + (B.grass[2] - B.soil[2]) * g;
    const rock = smoothstep(0.26, 0.68, slope) + smoothstep(0.45, 0.95, info.t) * 0.35 * (B.hillType === 'ridged' ? 1 : 0.45);
    const scree = (fbm2(x / 18, z / 18, 2, 31) - 0.5) * 0.12 * Math.min(1, rock);
    r += (B.rock[0] - r) * Math.min(1, rock) + scree;
    gg += (B.rock[1] - gg) * Math.min(1, rock) + scree;
    b += (B.rock[2] - b) * Math.min(1, rock) + scree;
    // patches of black cotton soil (Deccan) / darker earth elsewhere
    const patch = smoothstep(0.63, 0.74, fbm2(x / 260, z / 260, 3, 23)) * 0.55;
    const ps = B.blackSoil || [B.soil[0] * 0.7, B.soil[1] * 0.7, B.soil[2] * 0.7];
    r += (ps[0] - r) * patch * 0.8; gg += (ps[1] - gg) * patch * 0.8; b += (ps[2] - b) * patch * 0.8;
    // railway cess: trodden earth near the formation
    // (kept narrow and warm: a wide grey band read as dirty grey ground beside the line)
    const cess = (1 - smoothstep(3, 9, info.d)) * 0.55;
    const cr = (B.cess[0] + B.soil[0]) * 0.5, cg = (B.cess[1] + B.soil[1]) * 0.5, cb = (B.cess[2] + B.soil[2]) * 0.5;
    r += (cr - r) * cess; gg += (cg - gg) * cess; b += (cb - b) * cess;
    const v = 0.84 + n2 * 0.24;
    out[0] = r * v; out[1] = gg * v; out[2] = b * v;
  }

  _buildTile(ix, iz, res) {
    const T = STREAM.TERRAIN_TILE;
    const x0 = ix * T, z0 = iz * T;
    const cand = this.path.candidatesInBox(x0, z0, x0 + T, z0 + T, 700);
    const N = res + 1;
    const ext = N + 2;
    const H = new Float32Array(ext * ext);
    const infos = new Array(ext * ext);
    const step = T / res;
    const farNear = cand.length ? null : this.path.nearest(x0 + T / 2, z0 + T / 2);
    for (let j = 0; j < ext; j++) {
      for (let i = 0; i < ext; i++) {
        const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
        // far from the line: keep which side of it we are on (the sea lies on one side)
        const near = cand.length ? this.path.nearest(x, z, cand) : { s: farNear.s, lat: (farNear.lat < 0 ? -1 : 1) * Math.max(900, Math.abs(farNear.lat)), dist: Math.max(900, farNear.dist) };
        const info = this._height(x, z, near);
        H[j * ext + i] = info.h;
        infos[j * ext + i] = info;
      }
    }
    const vcount = N * N + 4 * N;
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), col = new Float32Array(vcount * 3), uv = new Float32Array(vcount * 2);
    const c = [0, 0, 0];
    let v = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const e = (j + 1) * ext + (i + 1);
        const x = x0 + i * step, z = z0 + j * step;
        const hx = (H[e + 1] - H[e - 1]) / (2 * step);
        const hz = (H[e + ext] - H[e - ext]) / (2 * step);
        const nl = Math.hypot(hx, 1, hz);
        pos[v * 3] = x; pos[v * 3 + 1] = H[e]; pos[v * 3 + 2] = z;
        nor[v * 3] = -hx / nl; nor[v * 3 + 1] = 1 / nl; nor[v * 3 + 2] = -hz / nl;
        this._colorAt(x, z, infos[e], Math.hypot(hx, hz), c);
        col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
        uv[v * 2] = x / 9; uv[v * 2 + 1] = z / 9;
        v++;
      }
    }
    const idx = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const a = j * N + i, b = a + 1, cc = a + N, d = cc + 1;
      // alternate the quad diagonal so the grid doesn't show up as rows of squares
      if (((i * 73856093) ^ (j * 19349663) ^ (ix * 83492791) ^ iz) & 1) idx.push(a, cc, b, b, cc, d);
      else idx.push(a, cc, d, a, d, b);
    }
    // skirts hide cracks between LOD levels
    const edges = [
      Array.from({ length: N }, (_, i) => i),
      Array.from({ length: N }, (_, i) => (N - 1) * N + i),
      Array.from({ length: N }, (_, j) => j * N),
      Array.from({ length: N }, (_, j) => j * N + N - 1)
    ];
    for (const edge of edges) {
      const start = v;
      for (const k of edge) {
        pos[v * 3] = pos[k * 3]; pos[v * 3 + 1] = pos[k * 3 + 1] - 8; pos[v * 3 + 2] = pos[k * 3 + 2];
        nor[v * 3] = nor[k * 3]; nor[v * 3 + 1] = nor[k * 3 + 1]; nor[v * 3 + 2] = nor[k * 3 + 2];
        col[v * 3] = col[k * 3]; col[v * 3 + 1] = col[k * 3 + 1]; col[v * 3 + 2] = col[k * 3 + 2];
        uv[v * 2] = uv[k * 2]; uv[v * 2 + 1] = uv[k * 2 + 1];
        v++;
      }
      for (let i = 0; i < N - 1; i++) {
        const a = edge[i], b = edge[i + 1], a2 = start + i, b2 = start + i + 1;
        idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2); // both windings: skirts are seen from either side
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    return mesh;
  }

  // Streams tiles around a focus point; `budget` tiles per call.
  update(focus, budget = 3) {
    const T = STREAM.TERRAIN_TILE, R = STREAM.TERRAIN_RADIUS;
    const cx = Math.floor(focus.x / T), cz = Math.floor(focus.z / T);
    const r = Math.ceil(R / T);
    const want = [];
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const tx = (cx + i + 0.5) * T, tz = (cz + j + 0.5) * T;
      const d = Math.hypot(tx - focus.x, tz - focus.z);
      if (d > R + T * 0.7) continue;
      const res = d < 700 ? 64 : d < 1400 ? 32 : 16;
      want.push({ ix: cx + i, iz: cz + j, d, res });
    }
    want.sort((a, b) => a.d - b.d);
    const keep = new Set();
    let built = 0;
    for (const w of want) {
      const key = `${w.ix},${w.iz}`;
      keep.add(key);
      const t = this.tiles.get(key);
      if (t && (t.res === w.res || (t.res > w.res && w.d < 1250))) continue;
      if (built >= budget) continue;
      const mesh = this._buildTile(w.ix, w.iz, w.res);
      if (t) { t.mesh.geometry.dispose(); t.mesh.removeFromParent(); }
      this.group.add(mesh);
      this.tiles.set(key, { mesh, res: w.res });
      built++;
    }
    for (const [key, t] of this.tiles) {
      if (!keep.has(key)) { t.mesh.geometry.dispose(); t.mesh.removeFromParent(); this.tiles.delete(key); }
    }
    return built;
  }
}
