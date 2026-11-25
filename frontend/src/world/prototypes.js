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

export const P = {
  neemTrunk: () => once('neemTrunk', () => {
    const t = new THREE.CylinderGeometry(0.22, 0.38, 3.4, 7); t.translate(0, 1.7, 0);
    const b1 = new THREE.CylinderGeometry(0.1, 0.18, 2.2, 5); b1.rotateZ(0.7); b1.translate(0.7, 3.6, 0);
    const b2 = new THREE.CylinderGeometry(0.1, 0.18, 2.0, 5); b2.rotateZ(-0.6); b2.translate(-0.6, 3.5, 0.2);
    return merge([t, b1, b2]);
  }),
  neemCanopy: () => once('neemCanopy', () => {
    const a = blob(2.6, 1, 1, 0.78); a.translate(0, 5.3, 0);
    const b = blob(1.9, 1, 2, 0.8); b.translate(1.7, 4.6, 0.6);
    const c = blob(2.0, 1, 3, 0.8); c.translate(-1.5, 4.7, -0.5);
    const d = blob(1.5, 1, 11, 0.85); d.translate(0.3, 4.4, -1.8);
    const e = blob(1.4, 1, 12, 0.85); e.translate(-0.6, 6.2, 1.4);
    return merge([a, b, c, d, e]);
  }),
  acaciaTrunk: () => once('acaciaTrunk', () => {
    const t = new THREE.CylinderGeometry(0.12, 0.22, 3.8, 6); t.rotateZ(0.12); t.translate(0.2, 1.9, 0);
    const b = new THREE.CylinderGeometry(0.07, 0.12, 2.2, 5); b.rotateZ(-0.8); b.translate(-0.6, 3.8, 0);
    return merge([t, b]);
  }),
  acaciaCanopy: () => once('acaciaCanopy', () => {
    const a = blob(3.4, 1, 4, 0.32, 0.22); a.translate(0.3, 4.6, 0);
    const b = blob(2.2, 1, 5, 0.35, 0.2); b.translate(-1.3, 4.3, 0.8);
    return merge([a, b]);
  }),
  tallTrunk: () => once('tallTrunk', () => { const t = new THREE.CylinderGeometry(0.14, 0.3, 11, 6); t.translate(0, 5.5, 0); return t; }),
  tallCanopy: () => once('tallCanopy', () => {
    const a = blob(1.8, 1, 6, 1.9, 0.3); a.translate(0, 11, 0);
    const b = blob(1.3, 1, 7, 1.6, 0.3); b.translate(0.7, 8.6, 0.3);
    return merge([a, b]);
  }),
  banyanTrunk: () => once('banyanTrunk', () => {
    const list = [];
    const t = new THREE.CylinderGeometry(0.8, 1.3, 4.5, 9); t.translate(0, 2.25, 0); list.push(t);
    for (let i = 0; i < 6; i++) { const r = new THREE.CylinderGeometry(0.05, 0.08, 5, 4); r.translate(Math.cos(i) * 4.5, 2.5, Math.sin(i) * 4.5); list.push(r); }
    return merge(list);
  }),
  banyanCanopy: () => once('banyanCanopy', () => {
    const list = [];
    const rand = mulberry32(9);
    for (let i = 0; i < 6; i++) { const b = blob(3.8 + rand() * 1.5, 1, 20 + i, 0.6); b.translate((rand() - 0.5) * 9, 6.2 + rand() * 1.5, (rand() - 0.5) * 9); list.push(b); }
    return merge(list);
  }),
  khejriTrunk: () => once('khejriTrunk', () => { const t = new THREE.CylinderGeometry(0.12, 0.25, 3.2, 6); t.translate(0, 1.6, 0); return t; }),
  khejriCanopy: () => once('khejriCanopy', () => {
    const a = blob(1.9, 1, 30, 0.55, 0.45); a.translate(0, 3.8, 0);
    const b = blob(1.2, 1, 31, 0.6, 0.45); b.translate(1.1, 3.3, 0.4);
    return merge([a, b]);
  }),
  palmTrunk: () => once('palmTrunk', () => {
    const list = [];
    for (let i = 0; i < 7; i++) {
      const seg = new THREE.CylinderGeometry(0.17, 0.2, 1.75, 6);
      seg.rotateZ(-0.05 * i);
      seg.translate(Math.pow(i / 6, 2) * 1.4, 0.87 + i * 1.72, 0);
      list.push(seg);
    }
    return merge(list);
  }),
  palmFronds: () => once('palmFronds', () => {
    const list = [];
    for (let i = 0; i < 10; i++) {
      const f = new THREE.PlaneGeometry(0.9, 4.2, 1, 6);
      const p = f.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k) + 2.1; // 0..4.2 along frond
        const droop = -Math.pow(y / 4.2, 2) * 2.0;
        const w = p.getX(k) * (1 - y / 5);
        p.setXYZ(k, w, droop, y);
      }
      f.computeVertexNormals();
      f.rotateY((i / 10) * Math.PI * 2);
      f.rotateX(-0.25);
      f.translate(1.4, 12.2, 0);
      list.push(f);
    }
    const nut = new THREE.SphereGeometry(0.45, 6, 5); nut.translate(1.4, 11.7, 0); list.push(nut);
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
  boulder: () => once('boulder', () => blob(1, 2, 50, 0.85, 0.3, false)), // full height: tors stack these on each other
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
