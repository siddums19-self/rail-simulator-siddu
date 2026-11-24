import * as THREE from 'three/webgpu';

// Accumulates swept-profile strips into one indexed BufferGeometry.
// Frames: { x, y, z, th, s }  (y = formation level, th = heading)
// right = (cos th, 0, sin th), forward = (sin th, 0, -cos th)

export class GeoAccum {
  constructor(withColor = false) {
    this.pos = []; this.nor = []; this.uv = []; this.idx = [];
    this.col = withColor ? [] : null;
  }

  get vertexCount() { return this.pos.length / 3; }

  // profile: [[px, py], ...] ordered left->right over the top (outward normal = (-dy, dx)).
  sweep(frames, profile, { lat = 0, yOff = 0, uScale = 1, vScale = 1, uOff = 0, color = null, latFn = null, cant = false } = {}) {
    if (frames.length < 2) return;
    for (let j = 0; j < profile.length - 1; j++) {
      const [ax, ay] = profile[j];
      const [bx, by] = profile[j + 1];
      let dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const base = this.vertexCount;
      const c = color ? (typeof color === 'function' ? color(j, nx, ny) : color) : null;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const cr = Math.cos(f.th), sr = Math.sin(f.th);
        const l = (latFn ? latFn(f) : lat);
        const c = cant ? (f.cant || 0) : 0;
        for (const [px, py] of [[ax, ay], [bx, by]]) {
          const L = l + px;
          this.pos.push(f.x + cr * L, f.y + yOff + py + L * c, f.z + sr * L);
          this.nor.push(cr * nx, ny, sr * nx);
          this.uv.push(L * uScale + uOff, f.s * vScale);
          if (this.col) this.col.push(c ? c[0] : 1, c ? c[1] : 1, c ? c[2] : 1);
        }
      }
      for (let i = 0; i < frames.length - 1; i++) {
        const a0 = base + i * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
        this.idx.push(a0, b0, a1, b0, b1, a1);
      }
    }
  }

  // Generic quad (4 points CCW from outside) with explicit normal.
  quad(p0, p1, p2, p3, n, uv = [[0, 0], [1, 0], [1, 1], [0, 1]], color = null) {
    const base = this.vertexCount;
    for (const [p, t] of [[p0, uv[0]], [p1, uv[1]], [p2, uv[2]], [p3, uv[3]]]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(t[0], t[1]);
      if (this.col) this.col.push(color ? color[0] : 1, color ? color[1] : 1, color ? color[2] : 1);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export function meshFrom(acc, material, { cast = false, receive = true } = {}) {
  const g = acc.build();
  if (!g) return null;
  const m = new THREE.Mesh(g, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.userData.disposable = true;
  return m;
}
