import * as THREE from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';

// Shared low-poly prototype geometries for instanced vegetation and props.

const protos = new Map();
const once = (k, fn) => { if (!protos.has(k)) protos.set(k, fn()); return protos.get(k); };

// Organic lump: an icosphere pushed in and out by smooth, seeded low-frequency noise (no
// per-vertex spikes), so canopies and rocks read as soft natural forms rather than faceted boxes.
function blob(radius, detail, seed, squashY = 1, jitter = 0.28, flatten = true) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const rand = mulberry32(seed);
  const waves = [];
  for (let i = 0; i < 6; i++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(rand() * 2 - 1);
    waves.push({ d: [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)], f: 1.5 + i * 1.1 + rand(), o: rand() * 6.28, w: 1 / (1 + i * 0.7) });
  }
  const wsum = waves.reduce((a, w) => a + w.w, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1;
    const nx = x / l, ny = y / l, nz = z / l;
    let n = 0;
    for (const w of waves) n += Math.sin((nx * w.d[0] + ny * w.d[1] + nz * w.d[2]) * w.f + w.o) * w.w;
    const k = 1 + (n / wsum) * jitter * 1.6;
    p.setXYZ(i, x * k, y * k * squashY, z * k);
  }
  // flatten the underside a little (canopies hang, boulders sit)
  if (flatten) for (let i = 0; i < p.count; i++) if (p.getY(i) < -radius * 0.35 * squashY) p.setY(i, -radius * 0.35 * squashY + (p.getY(i) + radius * 0.35 * squashY) * 0.45);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const w = mergeVertices(g, 1e-3);
  w.computeVertexNormals();
  return w;
}

function clean(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(n)) out.deleteAttribute(n);
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}
const merge = (list) => mergeGeometries(list.map(clean), false);

// Botanical 3D tree builders: tapered branching limbs + root flares, and layered
// 3D leaf-sprig / pinnate-frond clusters (instead of solid icosphere blobs).
function limb(x0, y0, z0, x1, y1, z1, r0, r1, segs = 5) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz) || 0.01;
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, false);
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5),
    q,
    new THREE.Vector3(1, 1, 1)
  );
  g.applyMatrix4(m);
  return g;
}

// A 3D leaf-sprig cluster: 3 crossed, tilted diamond-shaped leaf blades so
// foliage reads with crisp silhouette and depth from any camera angle.
function leafCluster(cx, cy, cz, radius, rand, flat = 0.65) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const w = radius * (0.85 + rand() * 0.35);
    const h = radius * flat * (0.85 + rand() * 0.35);
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array([
      0, h, 0,
      -w, 0, 0,
      0, -h * 0.6, w * 0.25,
      0, h, 0,
      0, -h * 0.6, w * 0.25,
      w, 0, 0,
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.computeVertexNormals();
    g.rotateY((i / 3) * Math.PI + rand() * 0.6);
    g.rotateX((rand() - 0.5) * 0.7);
    g.rotateZ((rand() - 0.5) * 0.5);
    g.translate(cx, cy, cz);
    parts.push(g);
  }
  return parts;
}

function branchTree({ trunkH, rBase, rTop, lean = 0, boughs = 4, spread = 2.2, reach = 2.4, forks = 2, seed = 1, roots = 4, flat = 0.65, leafR = 0.95 }) {
  const rand = mulberry32(seed);
  const trunkParts = [];
  const canopyParts = [];
  const midX = lean * 0.4, midZ = (rand() - 0.5) * lean * 0.4;
  trunkParts.push(limb(0, 0, 0, midX, trunkH * 0.55, midZ, rBase, (rBase + rTop) * 0.55, 7));
  trunkParts.push(limb(midX, trunkH * 0.55, midZ, lean, trunkH, 0, (rBase + rTop) * 0.55, rTop, 6));
  for (let r = 0; r < roots; r++) {
    const a = (r / roots) * Math.PI * 2 + rand() * 0.4;
    trunkParts.push(limb(Math.cos(a) * rBase * 1.65, 0, Math.sin(a) * rBase * 1.65, Math.cos(a) * rBase * 0.4, trunkH * 0.22, Math.sin(a) * rBase * 0.4, rBase * 0.42, rBase * 0.16, 4));
  }
  for (let b = 0; b < boughs; b++) {
    const a = (b / boughs) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const by0 = trunkH * (0.72 + rand() * 0.25);
    const bx0 = lean * (by0 / trunkH);
    const bx1 = bx0 + Math.cos(a) * spread * (0.8 + rand() * 0.4);
    const bz1 = Math.sin(a) * spread * (0.8 + rand() * 0.4);
    const by1 = trunkH + reach * (0.55 + rand() * 0.45);
    trunkParts.push(limb(bx0, by0, 0, bx1, by1, bz1, rTop * 0.72, rTop * 0.34, 5));
    for (let f = 0; f < forks; f++) {
      const fa = a + (f - (forks - 1) / 2) * 0.85 + (rand() - 0.5) * 0.3;
      const fx = bx1 + Math.cos(fa) * spread * (0.55 + rand() * 0.4);
      const fz = bz1 + Math.sin(fa) * spread * (0.55 + rand() * 0.4);
      const fy = by1 + reach * (0.2 + rand() * 0.45);
      trunkParts.push(limb(bx1, by1, bz1, fx, fy, fz, rTop * 0.32, rTop * 0.12, 4));
      for (let c = 0; c < 3; c++) {
        const ox = (rand() - 0.5) * leafR * 1.4;
        const oy = (rand() - 0.3) * leafR * 0.9;
        const oz = (rand() - 0.5) * leafR * 1.4;
        canopyParts.push(...leafCluster(fx + ox, fy + oy, fz + oz, leafR * (0.8 + rand() * 0.45), rand, flat));
      }
    }
    canopyParts.push(...leafCluster(bx1, by1 + leafR * 0.3, bz1, leafR * 0.9, rand, flat));
  }
  return { trunk: () => merge(trunkParts), canopy: () => merge(canopyParts) };
}

const NEEM_TREE = () => branchTree({ trunkH: 3.1, rBase: 0.42, rTop: 0.22, lean: 0.15, boughs: 5, spread: 2.0, reach: 2.3, forks: 3, seed: 101, roots: 4, flat: 0.75, leafR: 1.05 });
const ACACIA_TREE = () => branchTree({ trunkH: 3.3, rBase: 0.26, rTop: 0.13, lean: 0.45, boughs: 5, spread: 2.8, reach: 1.15, forks: 3, seed: 202, roots: 3, flat: 0.36, leafR: 1.05 });
const KHEJRI_TREE = () => branchTree({ trunkH: 2.7, rBase: 0.25, rTop: 0.12, lean: 0.3, boughs: 4, spread: 1.5, reach: 1.3, forks: 2, seed: 303, roots: 3, flat: 0.55, leafR: 0.72 });

export const P = {
  neemTrunk: () => once('neemTrunk', () => NEEM_TREE().trunk()),
  neemCanopy: () => once('neemCanopy', () => NEEM_TREE().canopy()),
  acaciaTrunk: () => once('acaciaTrunk', () => ACACIA_TREE().trunk()),
  acaciaCanopy: () => once('acaciaCanopy', () => ACACIA_TREE().canopy()),
  tallTrunk: () => once('tallTrunk', () => {
    const rand = mulberry32(404);
    const parts = [limb(0, 0, 0, 0.1, 11.2, 0, 0.34, 0.1, 7)];
    for (let r = 0; r < 4; r++) {
      const a = (r / 4) * Math.PI * 2;
      parts.push(limb(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55, Math.cos(a) * 0.15, 0.7, Math.sin(a) * 0.15, 0.14, 0.06, 4));
    }
    for (let i = 0; i < 8; i++) {
      const y0 = 5.2 + i * 0.72;
      const a = i * 2.3 + rand() * 0.4;
      const r = 1.4 - (i / 8) * 0.6;
      parts.push(limb(0.05, y0, 0, Math.cos(a) * r, y0 + 1.1, Math.sin(a) * r, 0.09, 0.03, 4));
    }
    return merge(parts);
  }),
  tallCanopy: () => once('tallCanopy', () => {
    const rand = mulberry32(404);
    const parts = [];
    for (let i = 0; i < 8; i++) {
      const y0 = 5.2 + i * 0.72;
      const a = i * 2.3 + rand() * 0.4;
      const r = 1.4 - (i / 8) * 0.6;
      const bx = Math.cos(a) * r, by = y0 + 1.1, bz = Math.sin(a) * r;
      parts.push(...leafCluster(bx, by, bz, 0.95, rand, 1.15));
      parts.push(...leafCluster(bx * 0.65, by + 0.45, bz * 0.65, 0.85, rand, 1.15));
    }
    parts.push(...leafCluster(0.1, 11.6, 0, 1.0, rand, 1.25));
    return merge(parts);
  }),
  banyanTrunk: () => once('banyanTrunk', () => {
    const rand = mulberry32(505);
    const list = [limb(0, 0, 0, 0, 4.3, 0, 1.25, 0.78, 9)];
    for (let r = 0; r < 6; r++) {
      const a = (r / 6) * Math.PI * 2 + rand() * 0.3;
      list.push(limb(Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9, Math.cos(a) * 0.7, 1.4, Math.sin(a) * 0.7, 0.42, 0.2, 5));
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (rand() - 0.5) * 0.25;
      const bx1 = Math.cos(a) * 4.4, bz1 = Math.sin(a) * 4.4, by1 = 5.4 + rand() * 0.8;
      list.push(limb(Math.cos(a) * 0.4, 3.8, Math.sin(a) * 0.4, bx1, by1, bz1, 0.42, 0.18, 6));
      // hanging aerial prop roots reaching the ground
      for (let p = 0; p < 2; p++) {
        const t = 0.55 + p * 0.35;
        const rx = bx1 * t + (rand() - 0.5) * 0.4, rz = bz1 * t + (rand() - 0.5) * 0.4;
        const ry = 3.8 + (by1 - 3.8) * t;
        list.push(limb(rx, ry, rz, rx + (rand() - 0.5) * 0.25, 0, rz + (rand() - 0.5) * 0.25, 0.06, 0.09, 4));
      }
      for (let f = 0; f < 2; f++) {
        const fa = a + (f === 0 ? -0.55 : 0.55);
        list.push(limb(bx1, by1, bz1, bx1 + Math.cos(fa) * 2.1, by1 + 1.1, bz1 + Math.sin(fa) * 2.1, 0.16, 0.07, 4));
      }
    }
    return merge(list);
  }),
  banyanCanopy: () => once('banyanCanopy', () => {
    const rand = mulberry32(506);
    const list = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bx1 = Math.cos(a) * 4.4, bz1 = Math.sin(a) * 4.4, by1 = 5.8;
      for (let k = 0; k < 5; k++) {
        const ox = (rand() - 0.5) * 3.2, oy = (rand() - 0.2) * 1.4, oz = (rand() - 0.5) * 3.2;
        list.push(...leafCluster(bx1 + ox, by1 + oy, bz1 + oz, 1.55 + rand() * 0.45, rand, 0.62));
      }
    }
    for (let k = 0; k < 8; k++) {
      list.push(...leafCluster((rand() - 0.5) * 3.8, 6.8 + rand() * 1.2, (rand() - 0.5) * 3.8, 1.6, rand, 0.62));
    }
    return merge(list);
  }),
  khejriTrunk: () => once('khejriTrunk', () => KHEJRI_TREE().trunk()),
  khejriCanopy: () => once('khejriCanopy', () => KHEJRI_TREE().canopy()),
  palmTrunk: () => once('palmTrunk', () => {
    const list = [];
    const segs = 12;
    let px = 0, py = 0;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const nx = Math.pow(t1, 1.8) * 1.55;
      const ny = t1 * 12.0;
      const r0 = 0.25 - t0 * 0.09, r1 = 0.23 - t1 * 0.09;
      list.push(limb(px, py, 0, nx, ny, 0, r0, r1, 7));
      px = nx; py = ny;
    }
    return merge(list);
  }),
  palmFronds: () => once('palmFronds', () => {
    const list = [];
    const topX = 1.55, topY = 12.0;
    for (let i = 0; i < 12; i++) {
      const yaw = (i / 12) * Math.PI * 2 + (i % 2) * 0.15;
      const arch = i % 2 === 0 ? 0.35 : 0.72;
      const len = 4.0;
      let rx = 0, ry = 0;
      for (let s = 0; s < 5; s++) {
        const t = (s + 1) / 5;
        const nrx = t * len;
        const nry = Math.sin(t * Math.PI * 0.65) * 1.15 * arch - Math.pow(t, 2.2) * 2.1;
        const rib = limb(rx, ry, 0, nrx, nry, 0, 0.045 * (1 - t * 0.7), 0.03 * (1 - t * 0.7), 4);
        rib.rotateY(yaw); rib.translate(topX, topY, 0); list.push(rib);
        // pairs of V-angled pinnate leaflets along the rachis
        for (let k = 0; k < 3; k++) {
          const lt = (s + (k + 0.5) / 3) / 5;
          const lx = lt * len;
          const ly = Math.sin(lt * Math.PI * 0.65) * 1.15 * arch - Math.pow(lt, 2.2) * 2.1;
          const lw = 0.85 * Math.sin(Math.min(1, lt * 1.1) * Math.PI * 0.85);
          for (const side of [-1, 1]) {
            const lf = new THREE.BufferGeometry();
            lf.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
              0, 0, 0,
              0.12, -0.14, side * lw * 0.55,
              0.04, -0.35, side * lw,
            ]), 3));
            lf.computeVertexNormals();
            lf.translate(lx, ly, 0);
            lf.rotateY(yaw);
            lf.translate(topX, topY, 0);
            list.push(lf);
          }
        }
        rx = nrx; ry = nry;
      }
    }
    for (let c = 0; c < 5; c++) {
      const a = (c / 5) * Math.PI * 2;
      const nut = new THREE.SphereGeometry(0.18, 6, 5);
      nut.translate(topX + Math.cos(a) * 0.25, topY - 0.35, Math.sin(a) * 0.25);
      list.push(nut);
    }
    return merge(list);
  }),
  grassTuft: () => once('grassTuft', () => {
    const a = new THREE.PlaneGeometry(0.9, 0.7); a.translate(0, 0.35, 0);
    const b = a.clone(); b.rotateY(Math.PI / 2);
    const c = a.clone(); c.rotateY(Math.PI / 4);
    return merge([a, b, c]);
  }),
  bush: () => once('bush', () => {
    const a = blob(0.8, 1, 40, 0.7, 0.4); a.translate(0, 0.45, 0);
    const b = blob(0.55, 1, 41, 0.75, 0.4); b.translate(0.6, 0.35, 0.3);
    const c = blob(0.5, 1, 42, 0.75, 0.4); c.translate(-0.5, 0.32, -0.35);
    return merge([a, b, c]);
  }),
  boulder: () => once('boulder', () => {
    // Craggy cleaved rock boulder: planar fracture cuts + stratified ledges (not a soft sphere)
    const g = new THREE.IcosahedronGeometry(1.0, 2);
    const rand = mulberry32(50);
    const planes = [];
    for (let i = 0; i < 9; i++) {
      const th = rand() * Math.PI * 2, ph = Math.acos(rand() * 1.6 - 0.6);
      planes.push({ nx: Math.sin(ph) * Math.cos(th), ny: Math.cos(ph), nz: Math.sin(ph) * Math.sin(th), d: 0.62 + rand() * 0.28 });
    }
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i) * 0.82, z = p.getZ(i);
      for (const pl of planes) {
        const dot = x * pl.nx + y * pl.ny + z * pl.nz;
        if (dot > pl.d) {
          const ex = dot - pl.d;
          x -= pl.nx * ex * 0.85;
          y -= pl.ny * ex * 0.85;
          z -= pl.nz * ex * 0.85;
        }
      }
      // subtle horizontal basalt/granite strata ledge
      const strata = Math.sin(y * 9.5) * 0.045;
      p.setXYZ(i, x * (1 + strata), y, z * (1 + strata));
    }
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    const out = g.toNonIndexed();
    out.computeVertexNormals(); // crisp faceted rock cleavage planes
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
    return out;
  }),
  pole: () => once('pole', () => {
    const p = new THREE.CylinderGeometry(0.07, 0.1, 7, 5); p.translate(0, 3.5, 0);
    const a = new THREE.BoxGeometry(1.4, 0.08, 0.08); a.translate(0, 6.6, 0);
    return merge([p, a]);
  }),
  kmPost: () => once('kmPost', () => { const g = new THREE.BoxGeometry(0.28, 1.0, 0.28); g.translate(0, 0.5, 0); return g; }),
  solarRow: () => once('solarRow', () => {
    const g = new THREE.BoxGeometry(18, 0.06, 2.2); g.rotateX(-0.26); g.translate(0, 1.4, 0);
    const legs = [];
    for (let x = -8; x <= 8; x += 4) { const l = new THREE.BoxGeometry(0.08, 1.4, 0.08); l.translate(x, 0.7, 0); legs.push(l); }
    return merge([g, ...legs]);
  }),
  htTower: () => once('htTower', () => {
    const list = [];
    const H = 34;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.1, 0.16, H, 4);
      const top = new THREE.Vector3(sx * 0.9, H, sz * 0.9), bot = new THREE.Vector3(sx * 3.4, 0, sz * 3.4);
      const mid = top.clone().add(bot).multiplyScalar(0.5);
      const dir = top.clone().sub(bot).normalize();
      leg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      leg.translate(mid.x, mid.y, mid.z);
      list.push(leg);
    }
    for (let y = 6; y < H; y += 6) {
      const w = 3.4 - (y / H) * 2.5;
      for (const [rx, rz, len] of [[0, w, w * 2], [0, -w, w * 2]]) { const b = new THREE.BoxGeometry(len, 0.12, 0.12); b.translate(rx, y, rz); list.push(b); }
      for (const rx of [w, -w]) { const b = new THREE.BoxGeometry(0.12, 0.12, w * 2); b.translate(rx, y, 0); list.push(b); }
    }
    for (const y of [24, 29, 34]) { const arm = new THREE.BoxGeometry(14 - (y - 24) * 0.6, 0.3, 0.6); arm.translate(0, y, 0); list.push(arm); }
    return merge(list);
  })
};
