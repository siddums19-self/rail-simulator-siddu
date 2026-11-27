import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { GeoAccum, meshFrom } from './geoAccum.js';

// Iconic Dudhsagar Waterfall & Arched Viaduct Bridge after DDS towards CLR/Hubballi.
// When travelling Vasco -> Hubballi (dir = 1), the dense multi-tier waterfall is on the RIGHT (+lat),
// with the train crossing the arched masonry viaduct over the river gorge below.
export function buildDudhsagarViaduct(root, layout) {
  const d = layout.dudhsagar;
  if (!d) return;
  const path = layout.path;
  const group = new THREE.Group();
  const bat = new Batcher();
  const deckGeo = new GeoAccum(false);
  const v = new THREE.Vector3();

  const s0 = d.sMid - d.riverWidth / 2 - 15;
  const s1 = d.sMid + d.riverWidth / 2 + 15;
  const nSpans = 9;
  const spanLen = (s1 - s0) / nSpans;
  const half = 5.6;

  // Viaduct deck + stone parapets
  const frames = [];
  for (let s = s0; s <= s1 + 0.01; s += 6) {
    path.pointAt(s, 0, v);
    frames.push({ x: v.x, y: path.yAt(s), z: v.z, th: path.headingAt(s), s });
  }
  deckGeo.sweep(frames, [[-half, -0.5], [-half, -0.02], [half, -0.02], [half, -0.5], [half - 0.8, -1.4], [-(half - 0.8), -1.4], [-half, -0.5]], { uScale: 0.25, vScale: 0.25 });
  for (const sgn of [-1, 1]) {
    const o = sgn * (half - 0.18);
    deckGeo.sweep(frames, [[o - 0.16, 0], [o - 0.16, 1.05], [o + 0.16, 1.05], [o + 0.16, 0]], { uScale: 0.25, vScale: 0.25 });
  }
  const dm = meshFrom(deckGeo, M.viaduct(), { cast: true });
  if (dm) group.add(dm);

  // Tall stone/concrete piers & masonry arches into the river gorge
  const pierMat = M.viaduct();
  const archMat = M.concrete();
  for (let i = 0; i <= nSpans; i++) {
    const s = s0 + i * spanLen;
    const y = path.yAt(s), gy = path.groundAt(s) - 2.0;
    const th = path.headingAt(s);
    const topY = y - 1.4;
    const h = Math.max(6, topY - gy);
    path.pointAt(s, 0, v);
    bat.box(pierMat, v.x, gy + h / 2, v.z, half * 1.85, h, 3.2, -th);
    if (i < nSpans) {
      // Curved masonry arch ring beneath each span
      const sm = s + spanLen / 2;
      const ym = path.yAt(sm);
      const thm = path.headingAt(sm);
      for (let k = 0; k < 6; k++) {
        const t = (k + 0.5) / 6;
        const sk = s + t * spanLen;
        const archY = ym - 1.4 - 6.5 * (1 - 4 * (t - 0.5) ** 2) - 4.0;
        const pitch = Math.atan2(-26 * (t - 0.5), spanLen);
        path.pointAt(sk, 0, v);
        bat.box(archMat, v.x, archY, v.z, half * 1.7, 1.1, spanLen / 5.2, -thm, true, pitch, 0);
      }
    }
  }

  // ---- Realistic Dudhsagar Gorge, Towering Craggy Rocks, Multi-Tier Waterfall & River Flow
  const side = d.dir; // +1 = right side when travelling Vasco -> Hubballi
  const pMid = path.pointAt(d.sMid, 0, new THREE.Vector3());
  const thMid = path.headingAt(d.sMid);
  const yMid = path.yAt(d.sMid);
  const yRiver = yMid - d.depth * 0.62;

  const wfGroup = new THREE.Group();
  wfGroup.position.copy(pMid);
  wfGroup.rotation.y = -thMid;

  // Deterministic pseudo-random helper for sculpted rock faces
  const rnd = (i) => {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const craggyRock = (rx, ry, rz, seed) => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const n = Math.sin(vx * 3.1 + seed) * Math.cos(vy * 4.3 - seed) * Math.sin(vz * 2.9 + seed * 0.7);
      const strata = Math.sin(vy * 8.5 + seed) * 0.08;
      const k = 1 + n * 0.28 + strata;
      p.setXYZ(i, vx * rx * k, vy * ry * k, vz * rz * k);
    }
    g.deleteAttribute('normal');
    const out = g.toNonIndexed();
    out.computeVertexNormals();
    return out;
  };

  // Procedural scrolling white-water cascade texture
  const makeWaterTex = (vertical = true) => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#dff2ff';
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 160; i++) {
      const a = 0.25 + rnd(i + 1) * 0.65;
      x.fillStyle = `rgba(255,255,255,${a})`;
      if (vertical) x.fillRect(rnd(i + 20) * 256, rnd(i + 40) * 256, 3 + rnd(i + 60) * 10, 28 + rnd(i + 80) * 70);
      else x.fillRect(rnd(i + 20) * 256, rnd(i + 40) * 256, 24 + rnd(i + 80) * 60, 4 + rnd(i + 60) * 10);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(vertical ? 2 : 3, vertical ? 3 : 2);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const fallTex = makeWaterTex(true);
  const riverTex = makeWaterTex(false);

  const wetBasalt = new THREE.MeshStandardMaterial({ color: 0x2f353d, roughness: 0.65, metalness: 0.08 });
  const dryCliff = new THREE.MeshStandardMaterial({ color: 0x4b4a46, roughness: 0.94 });
  const mossRock = new THREE.MeshStandardMaterial({ color: 0x2c4c27, roughness: 0.92 });
  const fallMat = new THREE.MeshStandardMaterial({
    map: fallTex, color: 0xf4fbff, emissive: 0xdbeafe, emissiveIntensity: 0.35,
    roughness: 0.18, transparent: true, opacity: 0.92, side: THREE.DoubleSide
  });
  const riverMat = new THREE.MeshStandardMaterial({
    map: riverTex, color: 0xcbe7f5, emissive: 0xbae6fd, emissiveIntensity: 0.22,
    roughness: 0.15, transparent: true, opacity: 0.9
  });
  const foamMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xe0f2fe, emissiveIntensity: 0.35,
    roughness: 0.85, transparent: true, opacity: 0.62
  });

  const cx = side * 56;
  const addRock = (rx, ry, rz, px, py, pz, mat, seed, rotY = 0) => {
    const m = new THREE.Mesh(craggyRock(rx, ry, rz, seed), mat);
    m.position.set(px, py, pz);
    m.rotation.y = rotY;
    m.castShadow = true; m.receiveShadow = true;
    wfGroup.add(m);
  };

  // High craggy Western Ghats cliff massif behind & flanking the waterfall
  addRock(32, 54, 42, cx + side * 24, yMid + 34, -48, dryCliff, 1.1, 0.3);
  addRock(30, 58, 38, cx + side * 26, yMid + 38, 44, dryCliff, 2.4, -0.4);
  addRock(26, 46, 36, cx + side * 32, yMid + 30, 0, wetBasalt, 3.7, 0.1);
  // Lush mossy upper ridges & shoulders framing the gorge
  addRock(24, 24, 34, cx + side * 22, yMid + 68, -36, mossRock, 4.2, 0.5);
  addRock(24, 26, 34, cx + side * 22, yMid + 70, 38, mossRock, 5.5, -0.2);
  addRock(20, 22, 28, cx + side * 14, yMid + 50, -68, mossRock, 6.1, 0.7);
  addRock(20, 22, 28, cx + side * 14, yMid + 48, 72, mossRock, 7.3, -0.6);
  // Stepped dark wet basalt rock shelves & splitting outcrops inside the waterfall path
  addRock(10, 12, 14, cx + side * 8, yMid + 38, -2, wetBasalt, 8.4, 0.2);
  addRock(9, 10, 12, cx + side * 2, yMid + 16, 10, wetBasalt, 9.2, -0.3);
  addRock(10, 11, 13, cx + side * 3, yMid + 14, -14, wetBasalt, 10.6, 0.4);
  addRock(12, 10, 16, cx - side * 4, yRiver + 4, -28, wetBasalt, 11.1, 0.1);
  addRock(12, 10, 16, cx - side * 4, yRiver + 4, 28, wetBasalt, 12.5, -0.2);
  // Opposite gorge wall rocks (on -side) so the bridge spans a true rocky canyon
  addRock(22, 32, 36, -side * 58, yMid + 6, -42, mossRock, 13.4, 0.4);
  addRock(24, 30, 38, -side * 60, yMid + 4, 42, dryCliff, 14.8, -0.3);

  // Multi-tiered cascading waterfall sheets sloping down over the rock shelves into the plunge pool
  const tiers = [
    // Upper crest spill (narrower, steep)
    { x0: cx + side * 16, y0: yMid + 76, x1: cx + side * 7, y1: yMid + 40, z: -2, wTop: 14, wBot: 22 },
    // Middle split cascades around the wet rock outcrops
    { x0: cx + side * 8, y0: yMid + 42, x1: cx - side * 1, y1: yMid + 12, z: -13, wTop: 13, wBot: 20 },
    { x0: cx + side * 8, y0: yMid + 42, x1: cx - side * 1, y1: yMid + 12, z: 10, wTop: 15, wBot: 24 },
    // Lower wide foaming curtain plunging into the gorge river pool
    { x0: cx - side * 0.5, y0: yMid + 14, x1: cx - side * 11, y1: yRiver + 0.5, z: -1, wTop: 40, wBot: 54 },
  ];
  const makeCascadeSheet = (t) => {
    const dx = t.x1 - t.x0, dy = t.y1 - t.y0;
    const len = Math.hypot(dx, dy);
    const g = new THREE.PlaneGeometry(1, len, 6, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i); // -0.5..0.5 across width
      const vNorm = 0.5 - p.getY(i) / len; // 0 at top, 1 at bottom
      const w = t.wTop + (t.wBot - t.wTop) * vNorm;
      const ripple = Math.sin(u * 12 + vNorm * 9) * 0.9;
      p.setXYZ(i, ripple, p.getY(i), u * w);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, fallMat);
    m.position.set((t.x0 + t.x1) * 0.5, (t.y0 + t.y1) * 0.5, t.z);
    m.rotation.z = Math.atan2(dx, -dy);
    return m;
  };
  for (const t of tiers) wfGroup.add(makeCascadeSheet(t));

  // Turbulent plunge pool & natural river flowing from the waterfall base toward and under the bridge
  const poolGeo = new THREE.CircleGeometry(28, 18);
  poolGeo.rotateX(-Math.PI / 2);
  const pool = new THREE.Mesh(poolGeo, riverMat);
  pool.position.set(cx - side * 14, yRiver + 0.35, 0);
  pool.scale.set(1.2, 1, 1.35);
  wfGroup.add(pool);

  const streamGeo = new THREE.PlaneGeometry(110, 34, 16, 4);
  streamGeo.rotateX(-Math.PI / 2);
  const sp = streamGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const sx = sp.getX(i);
    sp.setZ(i, sp.getZ(i) + Math.sin(sx * 0.06) * 5.5);
  }
  streamGeo.computeVertexNormals();
  const stream = new THREE.Mesh(streamGeo, riverMat);
  stream.position.set(side * 2, yRiver + 0.25, 0);
  wfGroup.add(stream);

  // Riverbank rocks guiding the water from the plunge pool toward the bridge piers
  for (let i = 0; i < 14; i++) {
    const rx = (cx - side * 18) - side * i * 7.5;
    const rzOff = Math.sin(rx * 0.06) * 5.5;
    for (const sgn of [-1, 1]) {
      addRock(3.8 + rnd(i * 3) * 3, 2.2 + rnd(i * 5) * 2, 4.2 + rnd(i * 7) * 3, rx, yRiver + 0.8, rzOff + sgn * (17 + rnd(i + sgn) * 4), wetBasalt, 20 + i + sgn * 0.5, rnd(i) * 3);
    }
  }

  // Rising mist & spray clouds at the plunge pool
  const mists = [];
  for (const [mz, mr] of [[-20, 10], [-4, 14], [12, 13], [26, 9]]) {
    const mist = new THREE.Mesh(new THREE.SphereGeometry(mr, 12, 10), foamMat);
    mist.scale.set(1.25, 0.58, 1.45);
    mist.position.set(cx - side * 12, yRiver + 2.8, mz);
    mist.userData.baseY = yRiver + 2.8;
    mist.userData.phase = mz * 0.2;
    wfGroup.add(mist);
    mists.push(mist);
  }

  group.add(bat.build());
  group.add(wfGroup);
  root.add(group);

  let animT = 0;
  return {
    animate(dt) {
      animT += dt;
      fallTex.offset.y += dt * 1.45;
      riverTex.offset.x -= side * dt * 0.55;
      for (const m of mists) {
        m.position.y = m.userData.baseY + Math.sin(animT * 1.1 + m.userData.phase) * 0.9;
      }
    }
  };
}
