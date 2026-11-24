import * as THREE from 'three/webgpu';

// Arc-length parameterised route centre-line. Built by integrating curvature
// (so curves are true arcs with spiral transitions) plus an elevation profile.
// Convention: heading th = 0 points to -Z; forward = (sin th, 0, -cos th);
// right = (cos th, 0, sin th). Positive curvature turns right.

export class RoutePath {
  constructor(length, curvatureFn, trackYFn, groundYFn, step = 2) {
    this.step = step;
    const n = Math.ceil(length / step) + 2;
    this.n = n;
    this.length = (n - 1) * step;
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.th = new Float64Array(n);
    this.y = new Float32Array(n);
    this.gy = new Float32Array(n);
    this.k = new Float32Array(n);
    let x = 0, z = 0, th = 0;
    for (let i = 0; i < n; i++) {
      const s = i * step;
      this.x[i] = x; this.z[i] = z; this.th[i] = th;
      this.y[i] = trackYFn(s);
      this.gy[i] = groundYFn(s);
      this.k[i] = curvatureFn(s);
      // midpoint integration of heading for accuracy
      const kMid = curvatureFn(s + step * 0.5);
      const thMid = th + kMid * step * 0.5;
      x += Math.sin(thMid) * step;
      z -= Math.cos(thMid) * step;
      th += kMid * step;
    }
    this._buildHash();
  }

  _idx(s) {
    const f = Math.min(Math.max(s / this.step, 0), this.n - 1.0001);
    const i = Math.floor(f);
    return [i, f - i];
  }

  headingAt(s) {
    const [i, t] = this._idx(s);
    return this.th[i] + (this.th[i + 1] - this.th[i]) * t;
  }

  yAt(s) {
    const [i, t] = this._idx(s);
    return this.y[i] + (this.y[i + 1] - this.y[i]) * t;
  }

  groundAt(s) {
    const [i, t] = this._idx(s);
    return this.gy[i] + (this.gy[i + 1] - this.gy[i]) * t;
  }

  // Superelevation as a cross-slope (rise per metre of lateral offset).
  // Positive = right side higher (left-hand curve). Capped at 165 mm over 1750 mm.
  cantAt(s) {
    const [i, t] = this._idx(s);
    const k = this.k[i] + (this.k[i + 1] - this.k[i]) * t;
    return Math.max(-0.094, Math.min(0.094, -k * 90));
  }

  gradeAt(s) {
    return (this.yAt(s + 2) - this.yAt(s - 2)) / 4;
  }

  // World position of point at route distance s with lateral offset lat.
  pointAt(s, lat = 0, out = new THREE.Vector3(), yOffset = 0) {
    const [i, t] = this._idx(s);
    const x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    const z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    const th = this.th[i] + (this.th[i + 1] - this.th[i]) * t;
    const y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    out.set(x + Math.cos(th) * lat, y + yOffset, z + Math.sin(th) * lat);
    return out;
  }

  // Position on a lane plus its true heading (including lateral slope).
  laneFrame(s, lane, out) {
    const lat = lane.at(s);
    const th = this.headingAt(s);
    const slope = lane.slope(s);
    this.pointAt(s, lat, out.p);
    out.th = th + Math.atan(slope);
    out.lat = lat;
    return out;
  }

  // ---------------------------------------------------------- nearest query
  _buildHash() {
    this.cell = 160;
    this.hash = new Map();
    const stride = 4; // every 8 m
    for (let i = 0; i < this.n; i += stride) {
      const key = this._key(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      let arr = this.hash.get(key);
      if (!arr) { arr = []; this.hash.set(key, arr); }
      arr.push(i);
    }
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  // Candidate sample indices near an axis-aligned box (for terrain tiles).
  candidatesInBox(minX, minZ, maxX, maxZ, pad) {
    const out = [];
    const c0x = Math.floor((minX - pad) / this.cell), c1x = Math.floor((maxX + pad) / this.cell);
    const c0z = Math.floor((minZ - pad) / this.cell), c1z = Math.floor((maxZ + pad) / this.cell);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = this.hash.get(this._key(cx, cz));
        if (arr) for (const i of arr) out.push(i);
      }
    }
    return out;
  }

  // Nearest centre-line sample: returns {s, lat, dist}. Falls back to a ring
  // search when nothing is within the first box.
  nearest(x, z, candidates = null) {
    let cand = candidates;
    if (!cand || !cand.length) {
      for (let pad = 200; pad <= 3200; pad *= 2) {
        cand = this.candidatesInBox(x, z, x, z, pad);
        if (cand.length) break;
      }
    }
    if (!cand || !cand.length) return { s: 0, lat: 1e6, dist: 1e6 };
    let best = -1, bd = Infinity;
    for (const i of cand) {
      const dx = x - this.x[i], dz = z - this.z[i];
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    // refine among neighbours at full resolution
    let bi = best;
    for (let i = Math.max(0, best - 4); i <= Math.min(this.n - 1, best + 4); i++) {
      const dx = x - this.x[i], dz = z - this.z[i];
      const d = dx * dx + dz * dz;
      if (d <= bd) { bd = d; bi = i; }
    }
    const th = this.th[bi];
    const dx = x - this.x[bi], dz = z - this.z[bi];
    const lat = dx * Math.cos(th) + dz * Math.sin(th);
    const along = dx * Math.sin(th) - dz * Math.cos(th);
    return { s: bi * this.step + along, lat, dist: Math.sqrt(bd) };
  }
}

export const forwardOf = (th, out = new THREE.Vector3()) => out.set(Math.sin(th), 0, -Math.cos(th));
export const rightOf = (th, out = new THREE.Vector3()) => out.set(Math.cos(th), 0, Math.sin(th));
