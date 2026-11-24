import * as THREE from 'three/webgpu';
import { coachLiveryTextures } from '../core/textures.js';
import { registerNightEmissive } from '../core/materials.js';

// Procedural Indian rolling stock. Vehicle local frame: origin at the centre,
// y = 0 at rail top, nose toward -Z. Bodies are swept along a real coach
// cross-section (tumblehome sides, rounded roof shoulders) instead of boxes.

const matCache = new Map();
const cm = (key, fn) => { if (!matCache.has(key)) matCache.set(key, fn()); return matCache.get(key); };
const std = (hex, metal = 0.3, rough = 0.5) => cm(`std${hex}${metal}${rough}`, () => new THREE.MeshStandardMaterial({ color: hex, metalness: metal, roughness: rough }));
const DARK = () => std(0x1d2024, 0.55, 0.5);
const STEEL = () => std(0x5c636b, 0.8, 0.35);
const WHEEL = () => std(0x6a6f75, 0.92, 0.28);
const RUBBER = () => std(0x141516, 0, 0.95);
const GLASS = () => cm('glass', () => new THREE.MeshStandardMaterial({ color: 0x0b1118, metalness: 0.9, roughness: 0.05 }));
const HEAD = () => cm('headlamp', () => registerNightEmissive(new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c8, emissiveIntensity: 3 }), 3, 9));
const TAIL = () => cm('taillamp', () => new THREE.MeshStandardMaterial({ color: 0xff1a1a, emissive: 0xff1010, emissiveIntensity: 4 }));

// ------------------------------------------------------------ profiles
function coachProfile(hw = 1.62, yb = 1.05, ys = 3.42, yr = 4.06, r = 0.42) {
  const pts = [];
  pts.push([-hw * 0.95, yb], [-hw, yb + 0.32], [-hw * 0.995, (yb + ys) / 2], [-hw, ys]);
  for (let i = 1; i <= 6; i++) {
    const a = Math.PI - (i / 6) * (Math.PI / 2);
    pts.push([-hw + r + Math.cos(a) * r, ys + Math.sin(a) * r]);
  }
  const x0 = -hw + r, y0 = ys + r;
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    const x = x0 * (1 - t), y = y0 + (yr - y0) * Math.sin((t * Math.PI) / 2);
    pts.push([x, y]);
  }
  const right = pts.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
  return pts.concat(right);
}

function perimeterV(profile) {
  const v = [0];
  for (let i = 1; i < profile.length; i++) v.push(v[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const total = v[v.length - 1];
  return v.map((x) => x / total);
}

// rings: [{ z, sx, yScale, yb }] (sorted by z). u = (z - zMin) / len
function sweepRings(profile, rings, zMin, len, smoothNormals = true) {
  const vv = perimeterV(profile);
  const n = profile.length;
  const pos = [], uv = [], idx = [];
  rings.forEach((r) => {
    profile.forEach(([x, y], j) => {
      const yy = r.yb + (y - r.yb) * r.yScale;
      pos.push(x * r.sx, yy, r.z);
      uv.push((r.z - zMin) / len, vv[j]);
    });
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function endCap(profile, z, facing, sx = 1, yScale = 1, yb = 1.05) {
  const shape = new THREE.Shape();
  profile.forEach(([x, y], i) => {
    const yy = yb + (y - yb) * yScale;
    if (i === 0) shape.moveTo(x * sx, yy); else shape.lineTo(x * sx, yy);
  });
  const g = new THREE.ShapeGeometry(shape, 6);
  if (facing < 0) g.rotateY(Math.PI); // ShapeGeometry faces +Z; front caps face -Z
  g.translate(0, 0, z);
  return g;
}

// ------------------------------------------------------------ liveries
function windowsRow(ctx, W, h, L, { y0, y1, pitch = 2.05, width = 1.25, startM = 3.2, endM = 3.2, frame = '#c9ced4', glass = true, emissive = false }) {
  const pxm = W / L;
  for (let m = startM; m + width <= L - endM; m += pitch) {
    const x = m * pxm, w = width * pxm;
    if (emissive) { ctx.fillStyle = '#ffd890'; ctx.fillRect(x, y0 * h, w, (y1 - y0) * h); continue; }
    if (glass) {
      const g = ctx.createLinearGradient(0, y0 * h, 0, y1 * h);
      g.addColorStop(0, '#2a3440'); g.addColorStop(0.45, '#4d5b69'); g.addColorStop(0.5, '#1c232b'); g.addColorStop(1, '#10151b');
      ctx.fillStyle = g;
    } else ctx.fillStyle = '#000';
    ctx.fillRect(x, y0 * h, w, (y1 - y0) * h);
    if (frame) { ctx.strokeStyle = frame; ctx.lineWidth = 4; ctx.strokeRect(x, y0 * h, w, (y1 - y0) * h); }
  }
}
function doors(ctx, W, h, L, col, positionsM, width = 0.95) {
  const pxm = W / L;
  for (const m of positionsM) {
    const x = m * pxm;
    ctx.fillStyle = col; ctx.fillRect(x, 0.12 * h, width * pxm, 0.84 * h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(x, 0.12 * h, width * pxm, 0.84 * h);
    ctx.fillStyle = '#20262c'; ctx.fillRect(x + 0.2 * pxm, 0.2 * h, 0.55 * pxm, 0.22 * h);
  }
}

const LIVERY = {
  LHB: { body: '#b3252b', roof: '#5b6168', L: 23.54 },
  ICF: { body: '#1f4f96', roof: '#4a5058', L: 21.34 },
  RAJ: { body: '#8e1b24', roof: '#5b6168', L: 23.54 },
  DUR: { body: '#f2c230', roof: '#5b6168', L: 23.54 },
  VB: { body: '#f2f4f5', roof: '#d7dbde', L: 23.0 },
  DEMU: { body: '#2a5d9f', roof: '#59606a', L: 21.34 },
  WAP7: { body: '#eef0ee', roof: '#4b5563', L: 20.6 },
  WAG12: { body: '#b42a22', roof: '#4b5563', L: 17.5 },
  WDP4D: { body: '#284c8a', roof: '#5b6168', L: 19.6 }
};

function liveryMaterial(kind, code, profile) {
  return cm(`liv${kind}${code}`, () => {
    const vv = perimeterV(profile);
    const half = Math.floor(profile.length / 2);
    const sideTopIdx = 3; // (-hw, ys)
    const vSide1 = vv[sideTopIdx];
    const vRoof1 = vv[profile.length - 1 - sideTopIdx];
    const lv = LIVERY[kind];
    const L = lv.L;
    let side, emissiveSide, roughSide;
    const rough = (fn) => (ctx, W, h) => { ctx.fillStyle = '#6e6e6e'; ctx.fillRect(0, 0, W, h); ctx.fillStyle = '#121212'; fn(ctx, W, h); };
    if (kind === 'LHB') {
      side = (ctx, W, h) => {
        ctx.fillStyle = lv.body; ctx.fillRect(0, 0, W, h);
        ctx.fillStyle = '#f1e7cf'; ctx.fillRect(0, 0.6 * h, W, 0.022 * h); ctx.fillRect(0, 0.65 * h, W, 0.022 * h);
        ctx.fillStyle = '#7a7f86'; ctx.fillRect(0, 0.86 * h, W, 0.14 * h);
        windowsRow(ctx, W, h, L, { y0: 0.2, y1: 0.5, pitch: 2.15, width: 1.3, startM: 3.4, endM: 3.4 });
        doors(ctx, W, h, L, '#9c1f24', [1.2, L - 2.15]);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center';
        ctx.fillText('INDIAN RAILWAYS', W / 2, 0.76 * h);
        ctx.font = 'bold 44px Arial'; ctx.fillText(code, W * 0.12, 0.76 * h); ctx.fillText(code, W * 0.88, 0.76 * h);
      };
      emissiveSide = (ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.2, y1: 0.5, pitch: 2.15, width: 1.3, startM: 3.4, endM: 3.4, emissive: true });
      roughSide = rough((ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.2, y1: 0.5, pitch: 2.15, width: 1.3, startM: 3.4, endM: 3.4, glass: false, frame: null }));
    } else if (kind === 'RAJ' || kind === 'DUR') {
      const raj = kind === 'RAJ';
      side = (ctx, W, h) => {
        ctx.fillStyle = lv.body; ctx.fillRect(0, 0, W, h);
        if (raj) { // Rajdhani: deep red with a cream window band and gold pinstripes
          ctx.fillStyle = '#efe3c2'; ctx.fillRect(0, 0.16 * h, W, 0.38 * h);
          ctx.fillStyle = '#d4a63a'; ctx.fillRect(0, 0.135 * h, W, 0.018 * h); ctx.fillRect(0, 0.555 * h, W, 0.018 * h); ctx.fillRect(0, 0.6 * h, W, 0.012 * h);
        } else { // Duranto: yellow with green waves along the bottom
          ctx.fillStyle = '#2e7d32';
          ctx.beginPath(); ctx.moveTo(0, 0.62 * h);
          for (let x = 0; x <= W; x += 8) ctx.lineTo(x, 0.62 * h + Math.sin(x / W * Math.PI * 6) * 0.05 * h);
          ctx.lineTo(W, 0.86 * h); ctx.lineTo(0, 0.86 * h); ctx.fill();
          ctx.fillStyle = '#1b5e20'; ctx.fillRect(0, 0.12 * h, W, 0.02 * h);
        }
        ctx.fillStyle = '#7a7f86'; ctx.fillRect(0, 0.86 * h, W, 0.14 * h);
        windowsRow(ctx, W, h, L, { y0: 0.2, y1: 0.5, pitch: 2.15, width: 1.3, startM: 3.4, endM: 3.4 });
        doors(ctx, W, h, L, raj ? '#7a1720' : '#e0ad20', [1.2, L - 2.15]);
        ctx.fillStyle = raj ? '#f6e7b8' : '#ffffff'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center';
        ctx.fillText(raj ? 'RAJDHANI EXPRESS' : 'DURANTO EXPRESS', W / 2, 0.76 * h);
        ctx.font = 'bold 44px Arial'; ctx.fillText(code, W * 0.12, 0.76 * h); ctx.fillText(code, W * 0.88, 0.76 * h);
      };
      emissiveSide = (ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.2, y1: 0.5, pitch: 2.15, width: 1.3, startM: 3.4, endM: 3.4, emissive: true });
      roughSide = rough((ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.2, y1: 0.5, pitch: 2.15, width: 1.3, startM: 3.4, endM: 3.4, glass: false, frame: null }));
    } else if (kind === 'ICF') {
      side = (ctx, W, h) => {
        ctx.fillStyle = lv.body; ctx.fillRect(0, 0, W, h);
        ctx.fillStyle = '#e8e2cc'; ctx.fillRect(0, 0.56 * h, W, 0.03 * h);
        windowsRow(ctx, W, h, L, { y0: 0.18, y1: 0.48, pitch: 1.62, width: 1.1, startM: 2.8, endM: 2.8, frame: '#b9bec4' });
        // window bars
        ctx.fillStyle = 'rgba(210,214,218,0.85)';
        for (let x = 0; x < W; x += 9) ctx.fillRect(x, 0.18 * h, 2, 0.3 * h);
        doors(ctx, W, h, L, '#1a4382', [0.9, L - 1.85]);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 28px Arial'; ctx.textAlign = 'center';
        ctx.fillText('INDIAN RAILWAYS', W / 2, 0.72 * h);
        ctx.font = 'bold 42px Arial'; ctx.fillText(code, W * 0.13, 0.72 * h);
      };
      emissiveSide = (ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.18, y1: 0.48, pitch: 1.62, width: 1.1, startM: 2.8, endM: 2.8, emissive: true });
      roughSide = rough((ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.18, y1: 0.48, pitch: 1.62, width: 1.1, startM: 2.8, endM: 2.8, glass: false, frame: null }));
    } else if (kind === 'VB') {
      side = (ctx, W, h) => {
        ctx.fillStyle = lv.body; ctx.fillRect(0, 0, W, h);
        ctx.fillStyle = '#1d3f8f'; ctx.fillRect(0, 0.17 * h, W, 0.36 * h);
        ctx.fillStyle = '#ff7a1a'; ctx.fillRect(0, 0.56 * h, W, 0.03 * h);
        ctx.fillStyle = '#1d3f8f'; ctx.fillRect(0, 0.62 * h, W, 0.018 * h);
        ctx.fillStyle = '#9aa2a8'; ctx.fillRect(0, 0.84 * h, W, 0.16 * h);
        windowsRow(ctx, W, h, L, { y0: 0.21, y1: 0.48, pitch: 2.25, width: 1.55, startM: 3.0, endM: 3.0, frame: null });
        doors(ctx, W, h, L, '#d9dde0', [1.0, L - 2.0]);
        ctx.fillStyle = '#1d3f8f'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center';
        ctx.fillText('VANDE BHARAT', W / 2, 0.75 * h);
      };
      emissiveSide = (ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.21, y1: 0.48, pitch: 2.25, width: 1.55, startM: 3.0, endM: 3.0, emissive: true });
      roughSide = rough((ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.17, y1: 0.53, pitch: 0.5, width: 0.5, startM: 0, endM: 0, glass: false, frame: null }));
    } else if (kind === 'DEMU') {
      side = (ctx, W, h) => {
        ctx.fillStyle = lv.body; ctx.fillRect(0, 0, W, h);
        ctx.fillStyle = '#f0e9d2'; ctx.fillRect(0, 0.12 * h, W, 0.44 * h);
        windowsRow(ctx, W, h, L, { y0: 0.2, y1: 0.48, pitch: 1.55, width: 1.0, startM: 3.6, endM: 3.6, frame: '#a0a8b0' });
        doors(ctx, W, h, L, '#24548f', [2.3, L / 2 - 0.65, L - 3.3], 1.3);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center';
        ctx.fillText('SOUTH CENTRAL RAILWAY  DEMU', W / 2, 0.74 * h);
      };
      emissiveSide = (ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.2, y1: 0.48, pitch: 1.55, width: 1.0, startM: 3.6, endM: 3.6, emissive: true });
      roughSide = rough((ctx, W, h) => windowsRow(ctx, W, h, L, { y0: 0.2, y1: 0.48, pitch: 1.55, width: 1.0, startM: 3.6, endM: 3.6, glass: false, frame: null }));
    } else {
      // locomotives: WAP7 / WAG12 / WDP4D
      side = (ctx, W, h) => {
        ctx.fillStyle = lv.body; ctx.fillRect(0, 0, W, h);
        const pxm = W / L;
        if (kind === 'WAP7') {
          ctx.fillStyle = '#c62828'; ctx.fillRect(0, 0.58 * h, W, 0.3 * h);
          ctx.fillStyle = '#1e3a8a'; ctx.fillRect(0, 0.55 * h, W, 0.03 * h);
        } else if (kind === 'WAG12') {
          ctx.fillStyle = '#d6d8da'; ctx.fillRect(0, 0, W, 0.5 * h);
          ctx.fillStyle = '#f5c518'; ctx.fillRect(0, 0.5 * h, W, 0.03 * h);
        } else {
          ctx.fillStyle = '#c9ccd0'; ctx.fillRect(0, 0, W, 0.45 * h);
          ctx.fillStyle = '#f1f1f1'; ctx.fillRect(0, 0.45 * h, W, 0.04 * h);
        }
        ctx.fillStyle = '#88919a'; ctx.fillRect(0, 0.88 * h, W, 0.12 * h);
        // cab side windows + doors at both ends
        for (const m of [0.55, L - 1.75]) {
          ctx.fillStyle = '#1b222a'; ctx.fillRect(m * pxm, 0.12 * h, 1.2 * pxm, 0.28 * h);
          ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.strokeRect((m + 1.45) * pxm, 0.1 * h, 0.8 * pxm, 0.75 * h);
        }
        // machine room louvres
        ctx.fillStyle = 'rgba(30,35,40,0.75)';
        for (let m = 3.6; m < L - 3.8; m += 1.6) {
          for (let k = 0; k < 7; k++) ctx.fillRect(m * pxm, (0.14 + k * 0.045) * h, 1.2 * pxm, 0.022 * h);
        }
        ctx.fillStyle = kind === 'WAP7' ? '#fff' : '#111'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center';
        ctx.fillText(code, W / 2, 0.75 * h);
      };
      emissiveSide = null;
      roughSide = null;
    }
    const tex = coachLiveryTextures(`${kind}${code}`, { body: lv.body, roof: lv.roof, vSide0: 0, vSide1, vRoof1, side, emissiveSide, roughSide });
    const m = new THREE.MeshPhysicalMaterial({
      map: tex.map, roughness: 0.55, metalness: 0.25, clearcoat: 0.55, clearcoatRoughness: 0.28,
      roughnessMap: roughSide ? tex.roughnessMap : null
    });
    if (emissiveSide) {
      m.emissiveMap = tex.emissiveMap; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0;
      registerNightEmissive(m, 0, 1.3);
    }
    return m;
  });
}

// ------------------------------------------------------------ bogies
function bogie({ axles = 2, wheelR = 0.46, wheelbase = 2.56, frameCol = 0x23272c, disc = true }) {
  const g = new THREE.Group();
  const frameMat = std(frameCol, 0.5, 0.55);
  const len = wheelbase * (axles - 1) + 1.6;
  for (const side of [-1, 1]) {
    const sf = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, len), frameMat);
    sf.position.set(side * 1.02, wheelR + 0.12, 0); g.add(sf);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, len * 0.6), frameMat);
    top.position.set(side * 1.02, wheelR + 0.38, 0); g.add(top);
  }
  const tr = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.32, 0.6), frameMat);
  tr.position.set(0, wheelR + 0.15, 0); g.add(tr);
  const wheelsets = [];
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.13, 20);
  const flangeGeo = new THREE.CylinderGeometry(wheelR + 0.03, wheelR + 0.03, 0.03, 20);
  const axleGeo = new THREE.CylinderGeometry(0.085, 0.085, 1.95, 8);
  const discGeo = new THREE.CylinderGeometry(wheelR * 0.75, wheelR * 0.75, 0.08, 16);
  const boxGeo = new THREE.BoxGeometry(0.28, 0.3, 0.36);
  const springGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.32, 8);
  for (let a = 0; a < axles; a++) {
    const z = (a - (axles - 1) / 2) * wheelbase;
    const ws = new THREE.Group();
    ws.position.set(0, wheelR, z);
    const axle = new THREE.Mesh(axleGeo, STEEL()); axle.rotation.z = Math.PI / 2; ws.add(axle);
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, WHEEL()); w.rotation.z = Math.PI / 2; w.position.x = side * 0.84; ws.add(w);
      const f = new THREE.Mesh(flangeGeo, WHEEL()); f.rotation.z = Math.PI / 2; f.position.x = side * 0.77; ws.add(f);
      if (disc) { const d = new THREE.Mesh(discGeo, std(0x3a3d40, 0.85, 0.4)); d.rotation.z = Math.PI / 2; d.position.x = side * 0.42; ws.add(d); }
      // spoke marker so rotation is visible
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.135, wheelR * 1.4, 0.07), std(0x8a9096, 0.8, 0.4));
      mark.position.x = side * 0.84; ws.add(mark);
    }
    g.add(ws);
    wheelsets.push(ws);
    for (const side of [-1, 1]) {
      const ab = new THREE.Mesh(boxGeo, DARK()); ab.position.set(side * 1.02, wheelR, z); g.add(ab);
      const sp = new THREE.Mesh(springGeo, std(0xb4261f, 0.4, 0.5)); sp.position.set(side * 1.02, wheelR + 0.28, z + 0.3); g.add(sp);
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, wheelsets, wheelR };
}

function coupler(z, facing) {
  const g = new THREE.Group();
  const shank = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.7), DARK());
  shank.position.set(0, 1.05, z + facing * 0.35); g.add(shank);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.36, 0.3), DARK());
  head.position.set(0, 1.05, z + facing * 0.72); g.add(head);
  return g;
}

function vehicleShell(kind) {
  return { group: new THREE.Group(), bogies: [], wheelsets: [], length: 0, bogieHalf: 0, kind, lights: [] };
}

// ------------------------------------------------------------ coaches
export function buildCoach(kind, code = 'B1', opts = {}) {
  const lv = LIVERY[kind];
  const L = lv.L;
  const v = vehicleShell(kind);
  v.length = L;
  const geo = kind === 'RAJ' || kind === 'DUR' ? 'LHB' : kind; // Rajdhani/Duranto are LHB coaches
  v.bogieHalf = geo === 'LHB' || geo === 'VB' ? 7.4 : 7.2;
  const profile = coachProfile(1.62, 1.05, kind === 'ICF' ? 3.35 : 3.42, 4.06, kind === 'VB' ? 0.55 : 0.42);
  const bodyMat = liveryMaterial(kind, code, profile);
  const endMat = std(new THREE.Color(lv.body).getHex(), 0.25, 0.55);
  const rings = [{ z: -L / 2, sx: 1, yScale: 1, yb: 1.05 }, { z: L / 2, sx: 1, yScale: 1, yb: 1.05 }];
  if (opts.noseFront) {
    // Vande Bharat aerodynamic nose: rings shrink toward the tip
    const nl = 6.2;
    rings.shift();
    const zs = [];
    for (let i = 0; i <= 10; i++) zs.push(i / 10);
    zs.reverse().forEach((t) => {
      rings.unshift({ z: -L / 2 + nl * (1 - t) - 0.0, sx: 1 - 0.42 * Math.pow(t, 1.7), yScale: 1 - 0.58 * Math.pow(t, 1.45), yb: 1.0 + 0.15 * t });
    });
    rings.sort((a, b) => a.z - b.z);
    rings[0].z = -L / 2;
  }
  const body = new THREE.Mesh(sweepRings(profile, rings, -L / 2, L), bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  v.group.add(body);
  const r0 = rings[0], r1 = rings[rings.length - 1];
  v.group.add(new THREE.Mesh(endCap(profile, r0.z, -1, r0.sx, r0.yScale, r0.yb), endMat));
  v.group.add(new THREE.Mesh(endCap(profile, r1.z, 1, r1.sx, r1.yScale, r1.yb), endMat));
  if (opts.noseFront) {
    // windscreen & lamps on the nose
    const ws = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI, 0, Math.PI / 2), GLASS());
    ws.scale.set(1.15, 0.55, 2.2); ws.rotation.y = Math.PI; ws.position.set(0, 2.55, -L / 2 + 2.6);
    v.group.add(ws);
    for (const x of [-0.62, 0.62]) {
      const hl = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), HEAD());
      hl.position.set(x, 1.62, -L / 2 + 0.55); hl.rotation.y = Math.PI; hl.rotation.x = -0.3; v.group.add(hl);
    }
    v.headPos = new THREE.Vector3(0, 2.0, -L / 2 - 0.2);
    v.cabEye = new THREE.Vector3(-0.55, 2.75, -L / 2 + 3.6);
  } else {
    const gw = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.15, 0.42), RUBBER());
    gw.position.set(0, 2.35, -L / 2 - 0.2); gw.userData.frontGangway = true; v.group.add(gw);
  }
  const gw2 = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.15, 0.42), RUBBER());
  gw2.position.set(0, 2.35, L / 2 + 0.2); gw2.userData.rearGangway = true; v.group.add(gw2);
  // underframe: skirt + equipment
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.42, L - 6.5), std(0x2b2f34, 0.5, 0.6));
  skirt.position.set(0, 0.86, 0); v.group.add(skirt);
  for (const z of [-3.2, 0.5, 3.6]) {
    const eq = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 1.6), DARK()); eq.position.set(0, 0.75, z); v.group.add(eq);
  }
  // roof: AC units (LHB/VB) or ventilators (ICF/DEMU)
  if (geo === 'LHB' || geo === 'VB') {
    for (const z of [-L / 2 + 2.4, L / 2 - 2.4]) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.32, 2.8), std(0x9aa0a6, 0.6, 0.4));
      ac.position.set(0, 4.1, z); v.group.add(ac);
    }
  } else {
    for (let z = -L / 2 + 2; z < L / 2 - 1; z += 1.8) {
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 8), std(0x50565c, 0.6, 0.5));
      vent.position.set(0, 4.08, z); v.group.add(vent);
    }
  }
  for (const side of [-1, 1]) {
    const b = bogie({ axles: 2, wheelR: kind === 'ICF' ? 0.457 : 0.46, wheelbase: 2.56, disc: kind !== 'ICF' });
    b.group.position.z = side * v.bogieHalf;
    v.group.add(b.group);
    v.bogies.push(b.group);
    v.wheelsets.push(...b.wheelsets);
    v.wheelR = b.wheelR;
  }
  if (!opts.noseFront) v.group.add(coupler(-L / 2, -1));
  v.group.add(coupler(L / 2, 1));
  v.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return v;
}

// ------------------------------------------------------------- locomotives
export function buildLoco(kind = 'WAP7', number = '30512', { cabBothEnds = true, rearGangway = false } = {}) {
  const lv = LIVERY[kind];
  const L = lv.L;
  const v = vehicleShell(kind);
  v.length = L;
  const isDiesel = kind === 'WDP4D';
  const axles = 3;
  v.bogieHalf = kind === 'WAG12' ? 4.6 : 5.3;
  const hw = 1.53;
  const profile = coachProfile(hw, 1.12, 3.55, 4.12, 0.36);
  const mat = liveryMaterial(kind, number, profile);
  // front cab taper: roof drops, sides chamfer
  const rings = [];
  const fr = [[0, 0.93, 0.86], [0.18, 0.97, 0.9], [0.55, 0.995, 0.96], [1.0, 1, 1]];
  for (const [d, sx, ys] of fr) rings.push({ z: -L / 2 + d, sx, yScale: ys, yb: 1.12 });
  if (cabBothEnds) for (const [d, sx, ys] of fr.slice().reverse()) rings.push({ z: L / 2 - d, sx, yScale: ys, yb: 1.12 });
  else rings.push({ z: L / 2, sx: 1, yScale: 1, yb: 1.12 });
  const body = new THREE.Mesh(sweepRings(profile, rings, -L / 2, L), mat);
  body.castShadow = true;
  v.group.add(body);
  const endMat = std(new THREE.Color(lv.body).getHex(), 0.3, 0.45);
  const r0 = rings[0], r1 = rings[rings.length - 1];
  v.group.add(new THREE.Mesh(endCap(profile, r0.z, -1, r0.sx, r0.yScale, r0.yb), endMat));
  v.group.add(new THREE.Mesh(endCap(profile, r1.z, 1, r1.sx, r1.yScale, r1.yb), endMat));

  const cabFront = (zEnd, facing) => {
    // twin windscreens with centre pillar, sun visors, headlights, marker lights, buffer beam, cattle guard
    for (const x of [-0.66, 0.66]) {
      const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.78), GLASS());
      ws.position.set(x, 3.02, zEnd + facing * 0.012);
      ws.rotation.y = facing < 0 ? Math.PI : 0;
      ws.rotation.x = facing * -0.12;
      v.group.add(ws);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.5, 0.06), std(kind === 'WAP7' ? 0xc62828 : 0xf5c518, 0.3, 0.5));
    band.position.set(0, 1.95, zEnd + facing * 0.03); v.group.add(band);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 14), HEAD());
    top.rotation.x = Math.PI / 2; top.position.set(0, 3.78, zEnd + facing * 0.05); v.group.add(top);
    for (const x of [-0.95, 0.95]) {
      const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 12), HEAD());
      hl.rotation.x = Math.PI / 2; hl.position.set(x, 2.3, zEnd + facing * 0.05); v.group.add(hl);
      const mk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), facing < 0 ? HEAD() : TAIL());
      mk.rotation.x = Math.PI / 2; mk.position.set(x * 1.1, 1.55, zEnd + facing * 0.05); v.group.add(mk);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.5, 0.35), std(0x8a1d1d, 0.4, 0.55));
    beam.position.set(0, 1.0, zEnd + facing * 0.1); v.group.add(beam);
    for (let k = 0; k < 7; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), DARK());
      bar.position.set(-1.2 + k * 0.4, 0.42, zEnd + facing * (0.3 + Math.abs(k - 3) * 0.08));
      bar.rotation.x = facing * 0.35; v.group.add(bar);
    }
    const plow = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.5), DARK());
    plow.position.set(0, 0.2, zEnd + facing * 0.55); v.group.add(plow);
    v.group.add(coupler(zEnd, facing));
  };
  cabFront(-L / 2, -1);
  if (cabBothEnds) cabFront(L / 2, 1); else v.group.add(coupler(L / 2, 1));
  v.headPos = new THREE.Vector3(0, 3.0, -L / 2 - 0.3);
  v.cabEye = new THREE.Vector3(-0.62, 3.05, -L / 2 + 1.5);

  // roof equipment
  if (!isDiesel) {
    for (const pz of [-L / 2 + 4.0, L / 2 - 4.0]) v.group.add(pantograph(pz, pz < 0 ? 1 : 0));
    const bus = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, L - 7, 6), std(0xb87333, 0.9, 0.3));
    bus.rotation.x = Math.PI / 2; bus.position.set(0.35, 4.55, 0); v.group.add(bus);
    for (const z of [-2.5, 0, 2.5]) {
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 10), std(0x6b3b23, 0.1, 0.35));
      ins.position.set(0.35, 4.32, z); v.group.add(ins);
    }
    const vcb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 1.6), std(0x6c737a, 0.6, 0.4));
    vcb.position.set(-0.4, 4.22, 1.5); v.group.add(vcb);
  } else {
    for (let z = 1; z < L / 2 - 2.5; z += 2.0) {
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 18), std(0x2b2f33, 0.6, 0.5));
      fan.position.set(0, 4.16, z); v.group.add(fan);
    }
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.9), DARK());
    stack.position.set(0, 4.25, -2.5); v.group.add(stack);
  }
  // underframe: transformer / fuel tank between bogies
  const tank = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.85, L - 2 * v.bogieHalf - 3.2), std(isDiesel ? 0x1f2a36 : 0x2a2e33, 0.5, 0.55));
  tank.position.set(0, 0.75, 0); v.group.add(tank);
  for (const side of [-1, 1]) {
    const b = bogie({ axles, wheelR: 0.545, wheelbase: 1.9, frameCol: 0x1b1e22, disc: false });
    b.group.position.z = side * v.bogieHalf;
    v.group.add(b.group);
    v.bogies.push(b.group);
    v.wheelsets.push(...b.wheelsets);
    v.wheelR = b.wheelR;
  }
  v.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return v;
}

function pantograph(z, raised) {
  const g = new THREE.Group();
  const m = std(0x9a3412, 0.7, 0.35);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.4), std(0x30343a, 0.6, 0.5));
  base.position.set(0, 4.2, z); g.add(base);
  for (const x of [-0.5, 0.5]) {
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10), std(0x6b3b23, 0.1, 0.35));
    ins.position.set(x, 4.08, z); g.add(ins);
  }
  const h = raised ? 1.45 : 0.25;
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 1.6), m);
  const ang = Math.asin(Math.min(0.95, (h * 0.55) / 0.8));
  lower.position.set(0, 4.3 + h * 0.27, z + 0.35); lower.rotation.x = ang; g.add(lower);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.7), m);
  upper.position.set(0, 4.3 + h * 0.75, z + 0.3); upper.rotation.x = -ang; g.add(upper);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.3), std(0x2b2f33, 0.6, 0.4));
  head.position.set(0, 4.32 + h, z); g.add(head);
  for (const x of [-1.0, 1.0]) {
    const horn = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.25), std(0x2b2f33, 0.6, 0.4));
    horn.position.set(x, 4.27 + h, z); horn.rotation.z = x > 0 ? -0.5 : 0.5; g.add(horn);
  }
  return g;
}

// ------------------------------------------------------------- wagons
export function buildBOXN(code = 'BOXNHL') {
  const v = vehicleShell('BOXN');
  const L = 10.71;
  v.length = L;
  v.bogieHalf = 3.2;
  const box = new THREE.Group();
  const wallMat = cm('boxnWall', () => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6b2f1e'; ctx.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(${130 + Math.random() * 60},${60 + Math.random() * 30},25,${Math.random() * 0.25})`; ctx.fillRect(Math.random() * 512, Math.random() * 128, 4 + Math.random() * 20, 2 + Math.random() * 8); }
    ctx.fillStyle = '#f1f1f1'; ctx.font = 'bold 20px monospace'; ctx.fillText('SCR ' + code, 170, 60); ctx.font = '14px monospace'; ctx.fillText('CC+8+2   RTD', 190, 84);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, metalness: 0.35, roughness: 0.72 });
  });
  const ribMat = std(0x55241a, 0.4, 0.7);
  const H = 2.0, y0 = 1.25;
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, L - 0.2), wallMat);
    w.position.set(side * 1.5, y0 + H / 2, 0); box.add(w);
    for (let z = -L / 2 + 0.6; z < L / 2 - 0.4; z += 1.15) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.1, H, 0.12), ribMat);
      rib.position.set(side * 1.55, y0 + H / 2, z); box.add(rib);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, L - 0.1), ribMat);
    top.position.set(side * 1.53, y0 + H, 0); box.add(top);
  }
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(3.0, H, 0.08), ribMat);
    e.position.set(0, y0 + H / 2, side * (L / 2 - 0.12)); box.add(e);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.2, L), DARK());
  floor.position.set(0, y0, 0); box.add(floor);
  // coal heap with lumpy top
  const coalGeo = new THREE.PlaneGeometry(2.9, L - 0.4, 10, 18);
  coalGeo.rotateX(-Math.PI / 2);
  const p = coalGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const edge = Math.min(1, (1.45 - Math.abs(x)) / 0.5, (L / 2 - 0.2 - Math.abs(z)) / 0.6);
    p.setY(i, 0.35 * Math.max(0, edge) + Math.sin(x * 7 + z * 3) * 0.05 + Math.cos(z * 5.3) * 0.04);
  }
  coalGeo.computeVertexNormals();
  const coal = new THREE.Mesh(coalGeo, cm('coalMat', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85, metalness: 0.1 })));
  coal.position.y = y0 + H - 0.45; box.add(coal);
  v.group.add(box);
  for (const side of [-1, 1]) {
    const b = bogie({ axles: 2, wheelR: 0.42, wheelbase: 2.0, frameCol: 0x2a1a14, disc: false });
    b.group.position.z = side * v.bogieHalf;
    v.group.add(b.group);
    v.bogies.push(b.group);
    v.wheelsets.push(...b.wheelsets);
    v.wheelR = b.wheelR;
  }
  v.group.add(coupler(-L / 2, -1), coupler(L / 2, 1));
  v.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return v;
}

export function addTailLamp(v) {
  const L = v.length;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 12), TAIL());
  lamp.rotation.x = Math.PI / 2; lamp.position.set(0.9, 1.6, L / 2 + 0.45);
  v.group.add(lamp);
  const lv = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.04), cm('lvBoard', () => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#f5c518'; ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(56, 56); ctx.moveTo(56, 8); ctx.lineTo(8, 56); ctx.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t });
  }));
  lv.position.set(-0.6, 1.7, L / 2 + 0.44);
  v.group.add(lv);
  v.tailLamp = lamp;
}
