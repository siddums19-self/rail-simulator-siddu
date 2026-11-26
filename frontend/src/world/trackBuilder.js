import * as THREE from 'three/webgpu';
import { TRACK } from '../config.js';
import { M } from '../core/materials.js';
import { Batcher, unitBox } from '../core/batcher.js';
import { GeoAccum, meshFrom } from './geoAccum.js';

// Flat-bottom 52/60 kg rail, ordered clockwise (outward normal = (-dy, dx)).
const RAIL_PROFILE = [
  [0.068, 0.0], [-0.068, 0.0], [-0.068, 0.012], [-0.013, 0.03], [-0.010, 0.128],
  [-0.036, 0.140], [-0.036, 0.172], [0.036, 0.172], [0.036, 0.140], [0.010, 0.128],
  [0.013, 0.03], [0.068, 0.012], [0.068, 0.0]
];
const RAIL_BASE = TRACK.SLEEPER_Y + 0.105;
const BALLAST_PROFILE = [[-2.6, -0.02], [-1.85, 0.32], [1.85, 0.32], [2.6, -0.02]];

const railColor = (j, nx, ny) => {
  if (ny > 0.9) return [0.95, 0.96, 0.98];        // polished running surface
  if (ny < -0.5) return [0.22, 0.2, 0.19];
  return [0.42, 0.33, 0.27];                        // rusty web/foot
};

// --------------------------------------------------------------- frames
export function laneFrames(path, lane, a, b) {
  const frames = [];
  let s = a;
  while (true) {
    const lat = lane.at(s);
    const th = path.headingAt(s) + Math.atan(lane.slope(s));
    const p = path.pointAt(s, lat, _v);
    frames.push({ x: p.x, y: path.yAt(s), z: p.z, th, s, lat, cant: path.cantAt(s) });
    if (s >= b) break;
    const step = lane.inTransition(s) ? 1.5 : 4;
    s = Math.min(b, s + step);
  }
  return frames;
}
const _v = new THREE.Vector3();

// Frames for a free-standing world polyline [{x,z,th,y}] (junction side lines).
export function polylineFrames(points, a = 0, b = points.length - 1) {
  const out = [];
  let acc = 0;
  for (let i = a; i <= b; i++) {
    const p = points[i];
    if (i > a) acc += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    out.push({ x: p.x, y: p.y || 0, z: p.z, th: p.th, s: acc + (p.s0 || 0), lat: 0 });
  }
  return out;
}

// ------------------------------------------------------------ sleepers
let sleeperGeo = null, clipGeo = null;
function sleeperGeometries() {
  if (!sleeperGeo) {
    sleeperGeo = new THREE.BoxGeometry(2.75, 0.21, 0.26);
    const clips = [];
    for (const side of [-1, 1]) {
      for (const d of [-0.11, 0.11]) {
        const g = new THREE.BoxGeometry(0.07, 0.06, 0.09);
        g.translate(side * TRACK.RAIL_HALF_GAUGE + d, 0.12, 0);
        clips.push(g);
      }
      const pad = new THREE.BoxGeometry(0.18, 0.012, 0.2);
      pad.translate(side * TRACK.RAIL_HALF_GAUGE, 0.11, 0);
      clips.push(pad);
    }
    clipGeo = mergeSimple(clips);
  }
  return { sleeperGeo, clipGeo };
}

function mergeSimple(geos) {
  const pos = [], nor = [], uv = [], idx = [];
  let off = 0;
  for (const g of geos) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < n.length; i++) nor.push(n[i]);
    for (let i = 0; i < u.length; i++) uv.push(u[i]);
    for (const i of g.index.array) idx.push(i + off);
    off += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s1 = new THREE.Vector3(1, 1, 1);

function sleeperTransforms(frames, list) {
  // walk the frames at fixed arc spacing
  let carry = 0.3;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    let t = carry;
    while (t < seg) {
      const k = t / seg;
      list.push(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k, a.th + (b.th - a.th) * k, (a.cant || 0) + ((b.cant || 0) - (a.cant || 0)) * k);
      t += TRACK.SLEEPER_SPACING;
    }
    carry = t - seg;
  }
}

// ------------------------------------------------------------- tracks
export class TrackChunkBuilder {
  constructor() {
    this.rails = new GeoAccum(true);
    this.ballast = new GeoAccum(false);
    this.sleepers = [];
    this.segCount = 0;
  }

  addTrack(frames) {
    if (frames.length < 2) return;
    // Slightly different ballast heights avoid z-fighting where fans overlap.
    const yOff = (this.segCount++ % 5) * 0.004;
    this.ballast.sweep(frames, BALLAST_PROFILE, { lat: 0, yOff, uScale: 0.42, vScale: 0.42, cant: true });
    for (const side of [-1, 1]) {
      this.rails.sweep(frames, RAIL_PROFILE, {
        lat: side * TRACK.RAIL_HALF_GAUGE,
        yOff: RAIL_BASE, color: railColor, cant: true
      });
    }
    sleeperTransforms(frames, this.sleepers);
  }

  build(group) {
    const r = meshFrom(this.rails, M.rail(), { cast: false });
    const b = meshFrom(this.ballast, M.ballast());
    if (r) group.add(r);
    if (b) group.add(b);
    // Merge sleepers whose footprints overlap (turnouts, fans, crossovers) into
    // single long timbers, exactly as real points & crossings are laid.
    const src = this.sleepers;
    const total = src.length / 5;
    const kept = [];
    const clips = [];
    const hash = new Map();
    const CELL = 4;
    const keyOf = (cx, cz) => cx * 73856093 ^ cz * 19349663;
    for (let i = 0; i < total; i++) {
      const x = src[i * 5], y = src[i * 5 + 1], z = src[i * 5 + 2], th = src[i * 5 + 3], c = src[i * 5 + 4];
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      let host = null, hostLat = 0;
      for (let ix = -1; ix <= 1 && !host; ix++) for (let iz = -1; iz <= 1 && !host; iz++) {
        const arr = hash.get(keyOf(cx + ix, cz + iz));
        if (!arr) continue;
        for (const k of arr) {
          if (Math.abs(k.th - th) > 0.2) continue;
          const dx = x - k.x, dz = z - k.z;
          const along = dx * Math.sin(k.th) - dz * Math.cos(k.th);
          const lat = dx * Math.cos(k.th) + dz * Math.sin(k.th);
          if (Math.abs(along) < 0.62 && lat > k.minL - 2.6 && lat < k.maxL + 2.6) { host = k; hostLat = lat; break; }
        }
      }
      if (host) {
        host.minL = Math.min(host.minL, hostLat);
        host.maxL = Math.max(host.maxL, hostLat);
        clips.push({ k: host, lat: hostLat });
        continue;
      }
      const k = { x, y, z, th, c, minL: 0, maxL: 0 };
      kept.push(k);
      clips.push({ k, lat: 0 });
      const key = keyOf(cx, cz);
      if (!hash.has(key)) hash.set(key, []);
      hash.get(key).push(k);
    }
    const n = kept.length;
    if (n > 0) {
      const { sleeperGeo: sg, clipGeo: cg } = sleeperGeometries();
      const sl = new THREE.InstancedMesh(sg, M.sleeper(), n);
      const cl = new THREE.InstancedMesh(cg, M.clip(), clips.length);
      const _sc = new THREE.Vector3();
      kept.forEach((k, i) => {
        const mid = (k.minL + k.maxL) / 2;
        const len = (k.maxL - k.minL) + 2.75;
        _e.set(0, -k.th, Math.atan(k.c), 'YXZ');
        _q.setFromEuler(_e);
        _p.set(k.x + Math.cos(k.th) * mid, k.y + TRACK.SLEEPER_Y + mid * k.c, k.z + Math.sin(k.th) * mid);
        _m.compose(_p, _q, _sc.set(len / 2.75, 1, 1));
        sl.setMatrixAt(i, _m);
      });
      clips.forEach(({ k, lat }, i) => {
        _e.set(0, -k.th, Math.atan(k.c), 'YXZ');
        _q.setFromEuler(_e);
        _p.set(k.x + Math.cos(k.th) * lat, k.y + TRACK.SLEEPER_Y + lat * k.c, k.z + Math.sin(k.th) * lat);
        _m.compose(_p, _q, _s1);
        cl.setMatrixAt(i, _m);
      });
      sl.receiveShadow = true; cl.receiveShadow = true;
      sl.computeBoundingSphere(); cl.computeBoundingSphere();
      group.add(sl, cl);
    }
  }
}

// ----------------------------------------------------------------- OHE
// Builds 25 kV AC overhead equipment for a set of lanes over [a, b].
export function buildOHE(group, path, layout, a, b, laneSegs, opts = {}) {
  const bat = new Batcher();
  const wires = new GeoAccum(false);
  const mastMat = M.galvanised();
  const insul = M.insulator();
  const spacing = TRACK.MAST_SPACING;
  const contactH = TRACK.RAIL_TOP + TRACK.CONTACT_WIRE;
  const v = new THREE.Vector3();

  // Masts on the global grid so neighbouring chunks line up.
  for (let s = Math.ceil(a / spacing) * spacing; s < b; s += spacing) {
    const th = path.headingAt(s);
    const y = path.yAt(s);
    const st = layout.stationAt(s);
    const lanesHere = laneSegs.filter((ls) => s >= ls.s0 && s <= ls.s1).map((ls) => ls.lane.at(s));
    if (!lanesHere.length) continue;
    const minL = Math.min(...lanesHere), maxL = Math.max(...lanesHere);
    if (st && s > st.layout.pStart - 60 && s < st.layout.pEnd + 60) {
      // Portal (head-span) across the whole station
      const l0 = Math.min(st.layout.minLat, minL) - 2.8, l1 = Math.max(st.layout.maxLat, maxL) + 2.8;
      for (const L of [l0, l1]) {
        path.pointAt(s, L, v);
        bat.box(mastMat, v.x, y + 4.6, v.z, 0.42, 9.2, 0.42, -th);
      }
      const mid = (l0 + l1) / 2;
      path.pointAt(s, mid, v);
      bat.box(mastMat, v.x, y + 9.0, v.z, l1 - l0, 0.35, 0.5, -th);
      bat.box(mastMat, v.x, y + 8.3, v.z, l1 - l0, 0.2, 0.3, -th);
      for (const L of lanesHere) {
        path.pointAt(s, L, v);
        bat.box(mastMat, v.x, y + (8.3 + contactH + 1.2) / 2, v.z, 0.07, 8.3 - contactH - 1.2, 0.07, -th);
        bat.cyl(insul, v.x, y + contactH + 1.6, v.z, 0.08, 0.08, 0.5, 8);
      }
      continue;
    }
    // Cantilever masts outside each running line (or on bridge deck when over a river / widened)
    const onRiver = layout.rivers?.some((r) => Math.abs(s - r.s) < r.width / 2 + 25);
    const sides = [];
    if (maxL - minL < 0.5) sides.push({ mastL: minL - (onRiver ? 2.8 : 3.4), trackL: minL });
    else if (maxL - minL > 15 || (onRiver && maxL - minL > 6)) {
      for (const l of lanesHere) sides.push({ mastL: l + (l < 0 ? -2.9 : 2.9), trackL: l });
    } else {
      sides.push({ mastL: minL - (onRiver ? 2.8 : 3.4), trackL: minL });
      sides.push({ mastL: maxL + (onRiver ? 2.8 : 3.4), trackL: maxL });
    }
    const elevated = onRiver || y - path.groundAt(s) > 3.5;
    for (const sd of sides) {
      if (opts.skipMast && opts.skipMast(s, sd.mastL)) continue;
      path.pointAt(s, sd.mastL, v);
      const baseY = elevated ? y : Math.min(y, path.groundAt(s)) - 0.3;
      const h = y + 8.4 - baseY;
      bat.box(mastMat, v.x, baseY + h / 2, v.z, 0.32, h, 0.22, -th);
      bat.box(M.concrete(), v.x, baseY + 0.25, v.z, 0.9, 0.6, 0.9, -th, false);
      // cantilever tube + stay
      const dir = Math.sign(sd.trackL - sd.mastL);
      const armLen = Math.abs(sd.trackL - sd.mastL) + 0.6;
      path.pointAt(s, sd.mastL + dir * armLen / 2, v);
      bat.box(mastMat, v.x, y + contactH + 0.35, v.z, armLen, 0.09, 0.09, -th, false);
      bat.box(mastMat, v.x, y + contactH + 1.25, v.z, armLen, 0.08, 0.08, -th, false, 0, dir * 0.22);
      path.pointAt(s, sd.mastL + dir * 0.45, v);
      bat.cyl(insul, v.x, y + contactH + 0.35, v.z, 0.07, 0.07, 0.55, 8, 0, 0, Math.PI / 2);
      bat.cyl(insul, v.x, y + contactH + 1.25, v.z, 0.07, 0.07, 0.55, 8, 0, 0, Math.PI / 2);
    }
  }

  // Contact + messenger wires with sag and droppers, following every lane.
  const wireProfile = (w) => [[-w, -w], [-w, w], [w, w], [w, -w], [-w, -w]];
  for (const ls of laneSegs) {
    const frames = ls.frames;
    if (!frames || frames.length < 2) continue;
    const stagger = (f) => 0.2 * Math.sin((f.s / spacing) * Math.PI);
    wires.sweep(frames, wireProfile(0.014), { latFn: stagger, yOff: contactH });
    const sagFrames = frames.map((f) => {
      const ph = (((f.s % spacing) + spacing) % spacing) / spacing;
      const sag = 4 * ph * (1 - ph);
      let y = f.y + contactH + 1.25 - sag * 0.7;
      if (opts.wireCeiling) y = Math.min(y, opts.wireCeiling(f) ?? y);
      return { ...f, y };
    });
    wires.sweep(sagFrames, wireProfile(0.012), { lat: 0, yOff: 0 });
    for (let k = 0; k < sagFrames.length; k += 2) {
      const f = sagFrames[k];
      const top = f.y, bot = frames[k].y + contactH;
      if (top - bot < 0.15) continue;
      bat.add(unitBox(), M.wire(), f.x, (top + bot) / 2, f.z, 0, -f.th, 0, 0.02, top - bot, 0.02, false);
    }
  }

  const g = bat.build();
  group.add(g);
  const wm = meshFrom(wires, M.wire(), { cast: false, receive: false });
  if (wm) group.add(wm);
}

// ------------------------------------------------- embankment & viaduct
export function buildFormation(group, path, layout, a, b, opts = {}) {
  const emb = new GeoAccum(false);
  const deck = new GeoAccum(false);
  const bat = new Batcher();
  const runs = { emb: [], deck: [] };
  let cur = { emb: null, deck: null };
  for (let s = a; s <= b + 0.01; s += 4) {
    const y = path.yAt(s), gy = path.groundAt(s), h = y - gy;
    const p = path.pointAt(s, 0, _v);
    const f = { x: p.x, y, z: p.z, th: path.headingAt(s), s, gy, h, half: layout.lineAt(s) === 'S' ? 3.9 : 6.5 };
    const deckMin = opts.deckMinH ? opts.deckMinH(s) : 3.6;
    const embMax = opts.embMax ? opts.embMax(s) : opts.deckMinH ? Math.min(5.2, deckMin + 0.3) : 5.2;
    f.embMax = embMax;
    for (const kind of ['emb', 'deck']) {
      const on = kind === 'emb' ? (h > 0.25 && h <= embMax) : h >= deckMin;
      if (on) { if (!cur[kind]) { cur[kind] = []; runs[kind].push(cur[kind]); } cur[kind].push(f); } else cur[kind] = null;
    }
  }
  // Earth embankment with stone pitching
  for (const run of runs.emb) {
    if (run.length < 2) continue;
    const L = run.map((f) => ({ ...f }));
    // left slope, right slope (built per frame because width varies)
    for (const side of [-1, 1]) {
      for (let i = 0; i < L.length - 1; i++) {
        const f0 = L[i], f1 = L[i + 1];
        const pts = [f0, f1].map((f) => {
          const hh = Math.min(f.h, f.embMax);
          const walled = opts.walled && opts.walled(f.s);
          const top = side * f.half, bot = side * (f.half + (walled ? 0.35 : 1.6 * hh + 0.4));
          const cr = Math.cos(f.th), sr = Math.sin(f.th);
          return {
            t: new THREE.Vector3(f.x + cr * top, f.y - 0.02, f.z + sr * top),
            b: new THREE.Vector3(f.x + cr * bot, f.gy - 0.4, f.z + sr * bot)
          };
        });
        const n = new THREE.Vector3(Math.cos(f0.th) * side, 0.6, Math.sin(f0.th) * side).normalize();
        const uvs = [[0, f0.s / 4], [1.6, f0.s / 4], [1.6, f1.s / 4], [0, f1.s / 4]];
        if (side < 0) emb.quad(pts[0].t, pts[1].t, pts[1].b, pts[0].b, n, [uvs[0], uvs[3], uvs[2], uvs[1]]);
        else emb.quad(pts[0].t, pts[0].b, pts[1].b, pts[1].t, n, uvs);
      }
    }
    for (const f of L) {
      // flat formation top so the ballast never floats over the slope edge
      bat.box(M.darkConcrete(), f.x, f.y - 0.06, f.z, f.half * 2, 0.08, 4.1, -f.th, false);
    }
  }
  // Viaduct: box girder deck, parapets, hammer-head piers
  for (const run of runs.deck) {
    if (run.length < 2) continue;
    const half = run[0].half;
    const g = half > 5 ? 4.2 : 2.6;
    deck.sweep(run, [[-half, -0.45], [-half, -0.02], [half, -0.02], [half, -0.45], [g, -0.7], [g - 0.6, -2.1], [-(g - 0.6), -2.1], [-g, -0.7], [-half, -0.45]],
      { uScale: 0.25, vScale: 0.25 });
    for (const side of [-1, 1]) {
      const o = side * (half - 0.15);
      deck.sweep(run, [[o - 0.15, 0], [o - 0.15, 1.15], [o + 0.15, 1.15], [o + 0.15, 0]], { uScale: 0.25, vScale: 0.25 });
    }
    // steel handrail on the parapets (posts every 2 m) makes the deck read as a bridge
    for (const side of [-1, 1]) {
      const o = side * (half - 0.15);
      deck.sweep(run, [[o - 0.03, 1.55], [o - 0.03, 1.6], [o + 0.03, 1.6], [o + 0.03, 1.55]], { uScale: 0.25, vScale: 0.25 });
    }
    for (let i = 0; i < run.length; i++) {
      const f = run[i];
      for (const side of [-1, 1]) {
        const o = side * (half - 0.15);
        bat.box(M.steelDark(), f.x + Math.cos(f.th) * o, f.y + 1.37, f.z + Math.sin(f.th) * o, 0.05, 0.45, 0.05, -f.th, false);
      }
    }
    const spacing = opts.pierSpacing ? opts.pierSpacing(run[0].s) : 30;
    for (const f of run) {
      const s = f.s;
      if (Math.abs(((s % spacing) + spacing) % spacing) > 2.01) continue;
      if (f.h < (opts.deckMinH ? Math.max(1.6, opts.deckMinH(s) + 0.4) : 4.2)) continue;
      if (opts.skipPier && opts.skipPier(f.x, f.z, f.s)) continue;
      const topY = f.y - 2.1, botY = f.gy - 0.8;
      bat.box(M.viaduct(), f.x, (topY - 0.7 + botY) / 2, f.z, half > 5 ? 2.6 : 1.8, topY - 0.7 - botY, 1.8, -f.th);
      bat.box(M.viaduct(), f.x, topY - 0.35, f.z, half > 5 ? 8.4 : 5.2, 0.7, 2.4, -f.th);
      bat.box(M.darkConcrete(), f.x, f.gy - 0.2, f.z, 4.2, 0.6, 3.4, -f.th, false);
    }
  }
  const em = meshFrom(emb, M.stonePitch(), { cast: true });
  const dm = meshFrom(deck, M.viaduct(), { cast: true });
  if (em) group.add(em);
  if (dm) group.add(dm);
  group.add(bat.build());
}

// Buffer stop at the end of a line.
export function buildBufferStop(bat, path, s, lat, facing = 1) {
  const p = path.pointAt(s, lat, new THREE.Vector3());
  const th = path.headingAt(s);
  const y = path.yAt(s);
  bat.box(M.maroon(), p.x, y + 0.9, p.z, 3.0, 1.2, 0.6, -th);
  const q = path.pointAt(s - facing * 0.5, lat, new THREE.Vector3());
  bat.box(M.steelDark(), q.x, y + 1.05, q.z, 2.2, 0.3, 0.4, -th);
  bat.box(M.white(), p.x, y + 1.6, p.z, 0.6, 0.6, 0.62, -th);
}
