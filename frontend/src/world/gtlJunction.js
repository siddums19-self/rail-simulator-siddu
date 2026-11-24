import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { makeRng, pick, range, smoothstep } from '../core/rng.js';
import { TRACK } from '../config.js';
import { GTL_SPECIAL } from '../route/layout.js';
import { GTL_LADDER } from '../route/stationLayout.js';
import { TrackChunkBuilder, polylineFrames } from './trackBuilder.js';
import { GeoAccum, meshFrom } from './geoAccum.js';
import { PolylineIndex } from './terrain.js';
import { P } from './prototypes.js';
import { buildROB, buildFarSide } from './gtlStructures.js';

// Guntakal Jn east throat, built only when the route really uses GTL <-> DHNE.
//  * Dhone line (the player's route) = LEFT, curves left and climbs the ROR flyover.
//  * Four tracks leave the station side by side: Dhone (single), Gooty Down/Up
//    (straight on, at grade) and a goods line that merges into Gooty Up.
//  * The Bellary line turns off Gooty Down and passes UNDER the flyover; the
//    flyover is a retaining-wall embankment with a bridge only over Bellary.
//  * DRM office on the left after the flyover crest, as the line turns left.
//  * VV Nagar road crosses the Dhone line at grade at a manned level crossing.
//  * VV Nagar Colony sits on the right of the Dhone line when departing GTL.

const H = TRACK.MAIN_HALF;
const _box = new THREE.BoxGeometry(1, 1, 1);

function lineFromFn(P0, H0, len, latFn, step = 4) {
  const F = { x: Math.sin(H0), z: -Math.cos(H0) }, R = { x: Math.cos(H0), z: Math.sin(H0) };
  const pts = [];
  for (let a = 0; a <= len; a += step) {
    const b = latFn(a), db = (latFn(a + 0.5) - latFn(a - 0.5));
    pts.push({ x: P0.x + F.x * a + R.x * b, z: P0.z + F.z * a + R.z * b, th: H0 + Math.atan(db), y: 0, a });
  }
  return pts;
}

// Bellary centre-line: straight at lateral `lat0`, then a left curve of radius R.
function bellaryCentre(P0, H0, aCurve, R, turn, total, lat0, step = 4) {
  const F = { x: Math.sin(H0), z: -Math.cos(H0) }, Rt = { x: Math.cos(H0), z: Math.sin(H0) };
  const pts = [];
  let x = P0.x + Rt.x * lat0, z = P0.z + Rt.z * lat0, th = H0;
  let turned = 0;
  for (let a = 0; a <= total; a += step) {
    pts.push({ x, z, th, y: 0, a });
    let k = 0;
    if (a > aCurve && turned < turn) { k = -1 / R; turned += step / R; }
    const tm = th + k * step / 2;
    x += Math.sin(tm) * step; z -= Math.cos(tm) * step; th += k * step;
  }
  return pts;
}

function offsetLine(pts, latFn) {
  return pts.map((p) => {
    const l = latFn(p.a);
    return { x: p.x + Math.cos(p.th) * l, z: p.z + Math.sin(p.th) * l, th: p.th, y: 0, a: p.a };
  });
}

function segIntersect(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.z - p3.z) - (p2.z - p1.z) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.z - p3.z) - (p3.z - p1.z) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.z - p1.z) - (p3.z - p1.z) * (p2.x - p1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

export function buildGtlJunction(layout, { seedKey, terrainFlat }) {
  const gtl = layout.gtl;
  const path = layout.path;
  const P0 = path.pointAt(gtl.boundary, 0, new THREE.Vector3());
  const H0 = path.headingAt(gtl.boundary) + (gtl.dir > 0 ? 0 : Math.PI);
  const group = new THREE.Group();
  const index = new PolylineIndex(80);       // all side tracks (terrain + props)
  const bellaryIndex = new PolylineIndex(40); // for pier / mast avoidance

  // Dhone centre-line in world space, sampled by u
  const dhne = [];
  for (let u = 0; u <= GTL_SPECIAL.length; u += 8) {
    const p = path.pointAt(gtl.uToS(u), 0, new THREE.Vector3());
    dhne.push({ x: p.x, z: p.z, u });
  }

  // Throat: from the GTL exit four tracks run side by side —
  //   Dhone (single, the player's line, left), Gooty Down + Gooty Up (straight on),
  //   and a goods running line on the right that merges into the Gooty Up line.
  // The Bellary line leaves the Gooty Down line with a left-hand turnout and
  // passes under the Dhone flyover.
  const single = gtl.gap.line === 'S';
  const B = single ? 0 : H;
  const GD = B + 6.0, GU = B + 11.3, GX = B + 16.6;

  // No line passes under the Dhone line any more (it leaves at grade).
  const aCurve = 0, crossU = -1, best = null;
  const crossPt = new THREE.Vector3(1e9, 0, 1e9);
  const sm = (a, a0, a1) => smoothstep(a0, a1, a);
  const gootyBend = (a) => (a > 1500 ? ((a - 1500) ** 2) / (2 * 2600) : 0); // straight through the junction, easing right far beyond
  // the station's Gooty-side tracks run straight on into these lines (no funnel at the throat)
  const gooty = [
    lineFromFn(P0, H0, 4300, (a) => GD + gootyBend(a)),
    lineFromFn(P0, H0, 4300, (a) => GU + gootyBend(a))
  ];
  const goodsLine = lineFromFn(P0, H0, 640, (a) => GX - (GX - GU) * sm(a, 440, 630)); // goods line merges into Gooty Up
  const bell = [];
  // crossover ladder from the Gooty lines back to the Dhone line (lets every GTL platform reach Dhone)
  const connectors = GTL_LADDER.map(([a0, a1, l0, l1]) => {
    const pts = [];
    const F = { x: Math.sin(H0), z: -Math.cos(H0) }, Rv = { x: Math.cos(H0), z: Math.sin(H0) };
    for (let a = a0; a <= a1 + 0.01; a += 2) {
      const t = (a - a0) / (a1 - a0), k = t * t * (3 - 2 * t), dk = 6 * t * (1 - t) / (a1 - a0);
      const lat = l0 + (l1 - l0) * k;
      pts.push({ x: P0.x + F.x * a + Rv.x * lat, z: P0.z + F.z * a + Rv.z * lat, th: H0 + Math.atan((l1 - l0) * dk), y: 0, a });
    }
    return pts;
  });

  const allLines = [...gooty, goodsLine, ...connectors, ...bell];
  for (const l of allLines) index.add(l, 2);
  for (const l of bell) bellaryIndex.add(l, 1);

  // --- Road-over-Bridge 450 m past the GTL throat, spanning every line here.
  const ROB_A = 450;
  const R0v = { x: Math.cos(H0), z: Math.sin(H0) };
  const lats = single ? [0] : [-H, H];
  for (const line of allLines) {
    if (line[0].a > ROB_A - 20 || line[line.length - 1].a < ROB_A + 20) continue;
    let best = null;
    for (const p of line) { const along = (p.x - P0.x) * Math.sin(H0) - (p.z - P0.z) * Math.cos(H0); if (!best || Math.abs(along - ROB_A) < Math.abs(best.along - ROB_A)) best = { along, p }; }
    lats.push((best.p.x - P0.x) * R0v.x + (best.p.z - P0.z) * R0v.z);
  }
  lats.sort((p, q) => p - q);
  const piers = [];
  for (let i = 0; i + 1 < lats.length; i++) if (lats[i + 1] - lats[i] > 5.8) piers.push((lats[i] + lats[i + 1]) / 2);
  const rob = buildROB(group, P0, H0, ROB_A, { piers, abutL: lats[0] - 9.5, abutR: lats[lats.length - 1] + 6.5, seedKey });

  const bridgeA = -1e9, bridgeB = -1e9;

  // --- Render the side lines: rails, sleepers, ballast, OHE
  const tb = new TrackChunkBuilder();
  for (const l of allLines) tb.addTrack(polylineFrames(l));
  tb.build(group);
  buildSideOHE(group, [...gooty, goodsLine], crossPt, (x, z) => rob.nearMast(x, z) && rob.contains(x, z));

  // --- Foot over bridge on the curve: from the left of the Dhone line across the
  // Dhone and Gooty tracks to the right-hand side.
  buildJunctionFOB(group, path, gtl, gooty, index);

  // --- Boards at the divergence
  const bat = new Batcher();
  const F = { x: Math.sin(H0), z: -Math.cos(H0) }, Rt = { x: Math.cos(H0), z: Math.sin(H0) };
  const boardAt = (a, lat, text) => {
    const x = P0.x + F.x * a + Rt.x * lat, z = P0.z + F.z * a + Rt.z * lat;
    const mat = M.textBoard(text, { bg: '#f5c518', fg: '#111', w: 768, h: 192, font: 'bold 64px Arial' });
    bat.box(mat, x, 3.2, z, 5.2, 1.3, 0.12, -H0 + (gtl.dir > 0 ? 0 : Math.PI), true);
    for (const o of [-2.2, 2.2]) bat.box(M.steelDark(), x + Rt.x * o, 1.3, z + Rt.z * o, 0.12, 2.6, 0.12, 0, false);
  };
  boardAt(240, GX + 6, 'GOOTY / BENGALURU  ➜');
  boardAt(240, -8.5, '⬉  DHONE / KURNOOL');
  group.add(bat.build());

  // --- VV Nagar Colony
  const vv = buildVVNagar(layout, seedKey, bellaryIndex);
  group.add(vv.group);
  group.add(vv.far);
  if (terrainFlat) terrainFlat.push(...vv.flat);
  const drm = buildDRMOffice(layout, seedKey, index, bellaryIndex);
  if (drm) { group.add(drm.group); if (terrainFlat) terrainFlat.push(drm.flat); }

  const exclusion = (x, z) => index.distance(x, z, 60) < 16 || vv.inside(x, z) || rob.contains(x, z, 6) || (drm && drm.inside(x, z));
  const skipPier = () => false;
  const skipMast = (s, lat) => {
    const p = path.pointAt(s, lat, new THREE.Vector3());
    return bellaryIndex.distance(p.x, p.z, 40) < 7 || index.distance(p.x, p.z, 40) < 3.5 || (rob.nearMast(p.x, p.z) && rob.contains(p.x, p.z)) || Math.abs(s - vv.roadS) < 6;
  };

  const animate = (dt) => vv.animate(dt);
  return { group, index, exclusion, skipPier, skipMast, crossU, aCurve, bridgeA, bridgeB, lcS: vv.roadS, animate, drm: !!drm, vvSide: gtl.dir > 0 ? 'RIGHT' : 'LEFT', solved: !!best };
}

function buildSideOHE(group, lines, crossPt, skip = null) {
  const bat = new Batcher();
  const wires = new GeoAccum(false);
  const contactBase = TRACK.RAIL_TOP + TRACK.CONTACT_WIRE;
  const prof = (w) => [[-w, -w], [-w, w], [w, w], [w, -w], [-w, -w]];
  lines.forEach((line, li) => {
    const frames = polylineFrames(line);
    const lowered = (f) => {
      const d = Math.hypot(f.x - crossPt.x, f.z - crossPt.z);
      return 1 - smoothstep(14, 40, d); // 1 under the flyover
    };
    wires.sweep(frames.map((f) => ({ ...f, y: contactBase - 0.3 * lowered(f) })), prof(0.014), { lat: 0 });
    wires.sweep(frames.map((f) => {
      const ph = ((f.s % 54) + 54) % 54 / 54;
      const sag = 4 * ph * (1 - ph) * 0.7;
      const k = lowered(f);
      return { ...f, y: contactBase + (1.25 - sag) * (1 - k) + 0.12 * k };
    }), prof(0.012), { lat: 0 });
    // masts on the outer side of each track pair (every 54 m)
    const outer = li % 2 === 1 ? 3.3 : -3.3;
    for (let i = 0; i < frames.length; i += 13) {
      const f = frames[i];
      if (Math.hypot(f.x - crossPt.x, f.z - crossPt.z) < 16) continue;
      const cr = Math.cos(f.th), sr = Math.sin(f.th);
      const x = f.x + cr * outer, z = f.z + sr * outer;
      if (skip && skip(x, z)) continue;
      bat.box(M.galvanised(), x, 4.1, z, 0.3, 8.6, 0.22, -f.th);
      const ax = f.x + cr * outer / 2, az = f.z + sr * outer / 2;
      bat.box(M.galvanised(), ax, contactBase + 0.35, az, Math.abs(outer) + 0.6, 0.09, 0.09, -f.th, false);
    }
  });
  group.add(bat.build());
  const wm = meshFrom(wires, M.wire(), { cast: false, receive: false });
  if (wm) group.add(wm);
}

// ------------------------------------------------------------- VV Nagar
function buildVVNagar(layout, seedKey, bellaryIndex) {
  const gtl = layout.gtl;
  const path = layout.path;
  const rand = makeRng(seedKey, 'vvnagar');
  const sVV = gtl.uToS(GTL_SPECIAL.vvNagarU);
  const latSign = gtl.dir; // away-from-GTL right side
  const origin = path.pointAt(sVV, latSign * GTL_SPECIAL.vvNagarLat, new THREE.Vector3());
  origin.y = path.groundAt(sVV);
  const th = path.headingAt(sVV);
  const group = new THREE.Group();
  group.position.copy(origin);
  group.rotation.y = -th + (latSign < 0 ? Math.PI : 0);
  const bat = new Batcher();
  const walls = ['#f7f0dc', '#f4ead2', '#faf5e8', '#f1e7cf']; // railway-colony cream white
  const trees = [];
  // local frame: +X away from the railway, -Z along travel when departing GTL

  // streets
  const road = (x, z, w, d) => bat.box(M.asphalt(), x, 0.05, z, w, 0.1, d, 0, false);
  road(3, 0, 6, 230);          // service road beside the railway boundary
  road(46, 0, 6, 230);         // middle road
  road(88, 0, 6, 230);         // back road
  for (const z of [-75, 75]) road(45.5, z, 91, 6); // cross streets (z = 0 is the level-crossing road)

  // railway boundary wall (opening for the road that crosses under the railway)
  bat.box(M.brick(), -1.2, 1.1, -60, 0.35, 2.2, 110, 0, true);
  bat.box(M.brick(), -1.2, 1.1, 60, 0.35, 2.2, 110, 0, true);

  // the colony road continues under the flyover to the far side of the railway
  const trackLocalX = -GTL_SPECIAL.vvNagarLat;
  let roadEnd = trackLocalX - 12;
  group.updateMatrixWorld(true);
  for (let x = trackLocalX - 12; x > -112; x -= 4) {
    const w = new THREE.Vector3(x, 0, 0).applyMatrix4(group.matrixWorld);
    if (bellaryIndex && bellaryIndex.distance(w.x, w.z, 40) < 16) break;
    roadEnd = x;
  }
  for (let x = 0; x > roadEnd; x -= 22) { // streetlights along the level-crossing road
    if (Math.abs(x - trackLocalX) < 14) continue;
    bat.box(M.steelGreen(), x, 3.5, -4.6, 0.12, 7, 0.12, 0, false);
    bat.box(M.lampHead(), x, 6.85, -3.9, 0.3, 0.14, 1.4, 0, false);
  }

  // colony welcome arch over the road entrance, facing the railway
  const arch = M.textBoard('V.V. NAGAR RAILWAY COLONY\nGUNTAKAL', { bg: '#0b3d91', fg: '#ffffff', w: 1024, h: 256, font: 'bold 92px Arial' });
  bat.box(M.plaster(0xd9a066), 4, 3.5, -5.2, 0.8, 7, 0.8);
  bat.box(M.plaster(0xd9a066), 4, 3.5, 5.2, 0.8, 7, 0.8);
  bat.box(arch, 4, 6.6, 0, 0.25, 2.8, 11.2, 0, true);

  // houses on plots between the roads
  const rows = [{ x: 15, face: -1 }, { x: 33, face: 1 }, { x: 58, face: -1 }, { x: 76, face: 1 }];
  const plots = [];
  for (const row of rows) {
    for (let z = -105; z <= 105; z += 18) {
      if (Math.abs(z) < 4 || Math.abs(z - 75) < 6 || Math.abs(z + 75) < 6) continue;
      plots.push({ x: row.x, z, face: row.face });
    }
  }
  for (const pl of plots) {
    if (rand() < 0.08) { // empty plot / park
      for (let k = 0; k < 3; k++) trees.push([pl.x + range(rand, -5, 5), pl.z + range(rand, -6, 6), range(rand, 0.8, 1.2)]);
      continue;
    }
    const pw = 15, pd = 16.5;
    const wallH = 1.4;
    const fx = pl.x + pl.face * (pw / 2); // street-facing edge (toward the road)
    // compound wall with gate gap
    bat.box(M.plaster(0xe8e2d4), pl.x - pl.face * pw / 2, wallH / 2, pl.z, 0.25, wallH, pd);
    bat.box(M.plaster(0xe8e2d4), pl.x, wallH / 2, pl.z - pd / 2, pw, wallH, 0.25);
    bat.box(M.plaster(0xe8e2d4), pl.x, wallH / 2, pl.z + pd / 2, pw, wallH, 0.25);
    bat.box(M.plaster(0xe8e2d4), fx, wallH / 2, pl.z - pd / 4 - 1.3, 0.25, wallH, pd / 2 - 2.6);
    bat.box(M.plaster(0xe8e2d4), fx, wallH / 2, pl.z + pd / 4 + 1.3, 0.25, wallH, pd / 2 - 2.6);
    bat.box(M.steelDark(), fx, 0.8, pl.z, 0.08, 1.5, 2.6, 0, false); // gate
    // house
    const hw = 9.6, hd = 11; // standard railway quarter blocks
    const hx = pl.x - pl.face * 0.8, hz = pl.z + range(rand, -1, 1);
    const hex = pick(rand, walls);
    const mat = M.house(hex, Math.floor(rand() * 6), false);
    const floors = pl.x > 50 ? 2 : 1; // Type-II single storey in front, Type-III double storey behind
    const ry = pl.face > 0 ? 0 : Math.PI; // box +X face (door + windows) toward the street
    for (let f = 0; f < floors; f++) bat.box(mat, hx, 0.3 + 1.575 + f * 3.15, hz, hw, 3.15, hd, ry);
    bat.box(M.plaster(0x8c3a26), hx, 0.45, hz, hw + 0.06, 0.3, hd + 0.06, 0, false); // maroon dado band
    bat.box(M.concrete(), hx, 0.15, hz, hw + 1.2, 0.3, hd + 1.2, 0, false); // plinth
    const topY = 0.3 + floors * 3.15;
    // chajja sunshades over windows on the street face
    for (let f = 0; f < floors; f++) bat.box(M.plaster(0xd8d2c4), hx + pl.face * (hw / 2 + 0.35), 0.3 + f * 3.15 + 2.55, hz, 0.7, 0.1, hd - 1, 0, false);
    // porch columns + portico slab
    bat.box(M.plaster(0xf2efe8), hx + pl.face * (hw / 2 + 1.4), 1.8, hz - 2, 0.3, 3, 0.3);
    bat.box(M.plaster(0xf2efe8), hx + pl.face * (hw / 2 + 1.4), 1.8, hz + 2, 0.3, 3, 0.3);
    bat.box(M.plaster(0xd8d2c4), hx + pl.face * (hw / 2 + 0.8), 3.35, hz, 1.8, 0.18, 5, 0, true);
    if (floors === 2) {
      // balcony with railing on the first floor
      const bxp = hx + pl.face * (hw / 2 + 0.75);
      bat.box(M.plaster(0xd8d2c4), bxp, 3.45 + 0.02, hz + 2.5, 1.5, 0.16, 4, 0, true);
      bat.box(M.steelDark(), bxp + pl.face * 0.7, 4.45, hz + 2.5, 0.05, 0.05, 4);
      for (let k = -1.9; k <= 1.95; k += 0.35) bat.box(M.steelDark(), bxp + pl.face * 0.7, 3.95, hz + 2.5 + k, 0.03, 1.0, 0.03, 0, false);
    }
    // parapet roof + staircase headroom + Sintex tank + dish
    const par = M.plaster(0x8c3a26); // maroon parapet band, railway style
    bat.box(par, hx, topY + 0.45, hz - hd / 2 + 0.1, hw, 0.9, 0.2);
    bat.box(par, hx, topY + 0.45, hz + hd / 2 - 0.1, hw, 0.9, 0.2);
    bat.box(par, hx - hw / 2 + 0.1, topY + 0.45, hz, 0.2, 0.9, hd);
    bat.box(par, hx + hw / 2 - 0.1, topY + 0.45, hz, 0.2, 0.9, hd);
    bat.box(M.plaster(0x8f8a80), hx, topY + 0.06, hz, hw - 0.3, 0.12, hd - 0.3, 0, false);
    bat.box(mat, hx - pl.face * 2, topY + 1.3, hz + 2.5, 2.6, 2.6, 3.0);
    bat.cyl(M.tank(), hx - pl.face * 2, topY + 3.35, hz + 2.5, 0.75, 0.75, 1.5, 12);
    if (rand() < 0.4) bat.cyl(M.white(), hx + pl.face * 2.5, topY + 1.4, hz - 3, 0.45, 0.45, 0.06, 12, Math.PI / 2.6, 0, 0);
    // plot tree
    if (rand() < 0.6) trees.push([pl.x - pl.face * 5.5, pl.z + (rand() < 0.5 ? -6 : 6), range(rand, 0.7, 1.1)]);
  }
  // streetlights along roads
  for (const x of [6.5, 49.5, 91.5]) {
    for (let z = -110; z <= 110; z += 22) {
      bat.box(M.steelGreen(), x, 3.5, z, 0.12, 7, 0.12, 0, false);
      bat.box(M.steelGreen(), x - 0.8, 6.95, z, 1.6, 0.08, 0.08, 0, false);
      bat.box(M.lampHead(), x - 1.5, 6.85, z, 0.55, 0.14, 0.3, 0, false);
    }
  }
  // small temple & overhead tank at the colony centre
  for (let k = 0; k < 5; k++) bat.box(M.plaster(k % 2 ? 0xf6d7a7 : 0xe0a96d), 46, 0.9 + k * 1.6, 40, 5 - k * 0.8, 1.6, 5 - k * 0.8);
  for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) bat.box(M.concrete(), 66 + dx, 8, -40 + dz, 0.5, 16, 0.5);
  bat.cyl(M.concrete(), 66, 18, -40, 4.4, 3.6, 4.5, 16);
  bat.cyl(M.concrete(), 66, 20.6, -40, 0.4, 4.5, 0.8, 16);

  group.add(bat.build());
  // instanced neem / coconut trees
  if (trees.length) {
    const tr = new THREE.InstancedMesh(P.neemTrunk(), M.bark(), trees.length);
    const cn = new THREE.InstancedMesh(P.neemCanopy(), M.leaf(0x3e6b2c), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    trees.forEach(([x, z, sc], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7);
      m.compose(p.set(x, 0, z), q, s.set(sc, sc, sc));
      tr.setMatrixAt(i, m); cn.setMatrixAt(i, m);
    });
    tr.castShadow = cn.castShadow = true;
    tr.computeBoundingSphere(); cn.computeBoundingSphere();
    group.add(tr, cn);
  }

  // a few autos and motorbikes moving along the colony roads
  const movers = [];
  const autoBody = M.plaster(0x2e7d32), autoTop = M.plaster(0xf2c200), black = M.steelDark();
  const mk = (kind) => {
    const g = new THREE.Group();
    const add = (mat, x, y, z, w, h, d) => { const m = new THREE.Mesh(_box, mat); m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = true; g.add(m); };
    if (kind === 'auto') {
      add(autoBody, 0, 0.75, 0, 1.35, 0.9, 2.5);
      add(autoTop, 0, 1.55, 0.15, 1.4, 0.12, 2.2);
      add(black, 0, 1.2, -1.15, 1.2, 0.7, 0.05);
      for (const [x, z] of [[0, -1.1], [-0.6, 0.85], [0.6, 0.85]]) add(black, x, 0.28, z, 0.18, 0.56, 0.56);
    } else {
      add(black, 0, 0.6, 0, 0.3, 0.45, 1.6);
      add(black, 0, 0.33, -0.7, 0.12, 0.62, 0.62); add(black, 0, 0.33, 0.7, 0.12, 0.62, 0.62);
      add(M.plaster(pick(rand, [0x1f4e9b, 0xb03a2e, 0x5d6d7e, 0xffffff])), 0, 1.25, 0.15, 0.45, 0.75, 0.35); // rider
      add(M.plaster(0x2b2b2b), 0, 1.78, 0.15, 0.3, 0.3, 0.3); // helmet
    }
    group.add(g);
    return g;
  };
  const lanes = [46, 88, 3];
  for (let i = 0; i < 6; i++) {
    const kind = i < 2 ? 'auto' : 'bike';
    movers.push({ obj: mk(kind), x: lanes[i % 3], z: range(rand, -100, 100), dir: rand() < 0.5 ? 1 : -1, v: kind === 'auto' ? range(rand, 5, 7) : range(rand, 7, 10), pause: 0 });
  }
  const animate = (dt) => {
    for (const m of movers) {
      if (m.pause > 0) { m.pause -= dt; continue; }
      m.z += m.dir * m.v * dt;
      if (Math.abs(m.z) > 112) { m.dir = -Math.sign(m.z); m.z = Math.sign(m.z) * 112; m.pause = 2 + Math.random() * 6; }
      m.obj.position.set(m.x + m.dir * 1.5, 0.05, m.z);
      m.obj.rotation.y = m.dir > 0 ? Math.PI : 0;
    }
  };

  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const tmp = new THREE.Vector3();
  const inside = (x, z) => {
    tmp.set(x, 0, z).applyMatrix4(inv);
    if (tmp.x > -6 && tmp.x < 100 && Math.abs(tmp.z) < 122) return true;
    return tmp.x <= -6 && tmp.x > roadEnd - 15 && Math.abs(tmp.z) < 22; // road + far-side houses
  };
  // houses & shops along the road on the far side
  const farOrigin = new THREE.Vector3(trackLocalX - 14, 0, 0).applyMatrix4(group.matrixWorld);
  const far = new THREE.Group();
  buildFarSide(far, farOrigin, group.rotation.y + Math.PI, (trackLocalX - 14) - roadEnd, seedKey);
  const centre = new THREE.Vector3(46, 0, 0).applyMatrix4(group.matrixWorld);
  const farCentre = new THREE.Vector3((trackLocalX + roadEnd) / 2, 0, 0).applyMatrix4(group.matrixWorld);
  return { group, far, inside, animate, roadS: sVV, flat: [{ x: centre.x, z: centre.z, r: 150 }, { x: farCentre.x, z: farCentre.z, r: 80 }] };
}

// ------------------------------------------------------------- DRM office
// Divisional Railway Manager's office, Guntakal: on the left of the Dhone line,
// just before the foot over bridge on the curve.
function plantTrees(group, trees) {
  if (!trees.length) return;
  const tr = new THREE.InstancedMesh(P.neemTrunk(), M.bark(), trees.length);
  const cn = new THREE.InstancedMesh(P.neemCanopy(), M.leaf(0x3e6b2c), trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  trees.forEach(([x, z, sc], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7);
    m.compose(p.set(x, 0, z), q, s.set(sc, sc, sc));
    tr.setMatrixAt(i, m); cn.setMatrixAt(i, m);
  });
  tr.castShadow = cn.castShadow = true;
  tr.computeBoundingSphere(); cn.computeBoundingSphere();
  group.add(tr, cn);
}

function buildDRMOffice(layout, seedKey, index, bellaryIndex) {
  const gtl = layout.gtl, path = layout.path;
  const rand = makeRng(seedKey, 'drm');
  const s = gtl.uToS(GTL_SPECIAL.drmU);
  const side = -gtl.dir; // left of the train departing GTL
  const th = path.headingAt(s);
  // find the nearest clear site (away from the Bellary and Gooty lines)
  let lat = null;
  const c = new THREE.Vector3();
  for (let L = 30; L <= 260; L += 6) {
    let ok = true;
    for (const [da, dl] of [[0, 0], [-45, 0], [45, 0], [0, 70], [-45, 70], [45, 70], [0, 35], [60, 0], [60, 40]]) {
      path.pointAt(s + da, side * (L + dl), c);
      if (bellaryIndex.distance(c.x, c.z, 80) < 26 || index.distance(c.x, c.z, 80) < 22) { ok = false; break; }
    }
    if (ok) { lat = L; break; }
  }
  if (lat === null) return null;
  const origin = path.pointAt(s, side * lat, new THREE.Vector3());
  origin.y = path.groundAt(s);
  const group = new THREE.Group();
  group.position.copy(origin);
  group.rotation.y = -th + (side < 0 ? Math.PI : 0); // local +X points away from the railway
  const bat = new Batcher();
  const cream = M.house('#f4ead2', 2, false), maroon = M.plaster(0x8c3a26), trim = M.plaster(0xfaf5e8);
  const trees = [];
  // compound: 70 m deep, 96 m along the line
  const wall = M.plaster(0xe8e2d4);
  bat.box(wall, 0, 1.0, -26, 0.3, 2.0, 44); bat.box(wall, 0, 1.0, 26, 0.3, 2.0, 44); // front wall with the gate gap
  bat.box(wall, 70, 1.0, 0, 0.3, 2.0, 96);
  bat.box(wall, 35, 1.0, -48, 70, 2.0, 0.3); bat.box(wall, 35, 1.0, 48, 70, 2.0, 0.3);
  for (const z of [-4.2, 4.2]) bat.box(maroon, 0, 1.6, z, 0.9, 3.2, 0.9);
  bat.box(M.textBoard('DRM OFFICE • GUNTAKAL', { bg: '#7c2a1d', fg: '#fde68a', w: 768, h: 128, font: 'bold 60px Arial' }), 0, 3.6, 0, 0.2, 0.9, 9.4, 0, true);
  // lawn and drive
  bat.box(M.plaster(0x5d8a3a), 18, 0.05, 0, 34, 0.08, 92, 0, false);
  bat.box(M.asphalt(), 18, 0.08, 0, 34, 0.06, 7, 0, false);
  bat.box(M.asphalt(), 38, 0.08, 0, 6, 0.06, 80, 0, false);
  // main block: three floors, cream with maroon bands, central tower with clock
  const bx = 48, bd = 16, bl = 76, fh = 3.8;
  for (let f = 0; f < 3; f++) {
    bat.box(cream, bx, 0.4 + fh / 2 + f * fh, 0, bd, fh, bl);
    bat.box(maroon, bx, 0.4 + (f + 1) * fh - 0.1, 0, bd + 0.3, 0.25, bl + 0.3, 0, false);
    bat.box(trim, bx - bd / 2 - 0.4, 0.4 + f * fh + 2.9, 0, 0.8, 0.12, bl - 2, 0, false); // chajja
  }
  bat.box(M.concrete(), bx, 0.2, 0, bd + 2, 0.4, bl + 2, 0, false);
  bat.box(maroon, bx, 0.4 + 3 * fh + 0.5, 0, bd, 1.0, bl, 0, true); // parapet
  // end wings projecting toward the railway
  for (const z of [-bl / 2 + 6, bl / 2 - 6]) for (let f = 0; f < 3; f++) bat.box(cream, bx - bd / 2 - 3, 0.4 + fh / 2 + f * fh, z, 6, fh, 12);
  // portico + tower + dome
  for (const z of [-5, -1.7, 1.7, 5]) bat.box(trim, bx - bd / 2 - 5, 2.4, z, 0.7, 4.8, 0.7);
  bat.box(trim, bx - bd / 2 - 3.5, 5.0, 0, 7, 0.5, 12, 0, true);
  bat.box(cream, bx, 0.4 + 3 * fh + 3.5, 0, 10, 7, 10);
  bat.box(maroon, bx, 0.4 + 3 * fh + 7.2, 0, 10.6, 0.4, 10.6, 0, false);
  bat.cyl(M.plaster(0xf0e6cc), bx, 0.4 + 3 * fh + 8.6, 0, 2.2, 4.2, 2.6, 16);
  bat.cyl(M.white(), bx - 5.06, 0.4 + 3 * fh + 4.4, 0, 1.6, 1.6, 0.08, 24, 0, 0, Math.PI / 2); // clock face
  // big trilingual sign across the front
  bat.box(M.textBoard('मंडल रेल प्रबंधक कार्यालय  •  DIVISIONAL RAILWAY MANAGER\'S OFFICE\nGUNTAKAL DIVISION  •  SOUTH CENTRAL RAILWAY', { bg: '#0b3d91', fg: '#ffffff', w: 2048, h: 256, font: 'bold 64px Arial' }), bx - bd / 2 - 0.1, 0.4 + 3 * fh - 0.5, 0, 0.1, 2.2, 34, 0, false);
  // flag pole with the tricolour
  bat.box(M.steelDark(), 14, 6, 14, 0.14, 12, 0.14, 0, false);
  for (const [col, y] of [[0xff9933, 11.4], [0xffffff, 10.9], [0x138808, 10.4]]) bat.box(M.plaster(col), 14, y, 15.2, 0.03, 0.5, 2.2, 0, false);
  // parked staff cars and jeeps
  for (let k = 0; k < 7; k++) {
    const col = pick(rand, [0xffffff, 0xeeeeee, 0x9aa3ab, 0x1c2833]);
    const z = -36 + k * 5.5;
    bat.box(M.plaster(col), 30, 0.75, z, 4.3, 0.9, 1.8, 0, true);
    bat.box(M.glass ? M.glass() : M.steelDark(), 30.2, 1.45, z, 2.4, 0.55, 1.65, 0, false);
  }
  for (let z = -42; z <= 42; z += 10) trees.push([4, z, range(rand, 0.8, 1.1)], [66, z, range(rand, 0.8, 1.1)]);
  group.add(bat.build());
  plantTrees(group, trees);
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const tmp = new THREE.Vector3();
  const inside = (x, z) => { tmp.set(x, 0, z).applyMatrix4(inv); return tmp.x > -6 && tmp.x < 78 && Math.abs(tmp.z) < 54; };
  const centre = new THREE.Vector3(35, 0, 0).applyMatrix4(group.matrixWorld);
  return { group, inside, flat: { x: centre.x, z: centre.z, r: 75 } };
}

function buildJunctionFOB(group, path, gtl, gooty, index) {
  const sF = gtl.uToS(1150);
  const D = path.pointAt(sF, 0, new THREE.Vector3());
  let G = null, bd = Infinity;
  for (const p of gooty[1]) { const d = (p.x - D.x) ** 2 + (p.z - D.z) ** 2; if (d < bd) { bd = d; G = p; } }
  if (!G) return;
  const dx = G.x - D.x, dz = G.z - D.z, span = Math.hypot(dx, dz);
  const ux = dx / span, uz = dz / span;
  const ext = 7;
  const A = { x: D.x - ux * ext, z: D.z - uz * ext }, Bp = { x: G.x + ux * ext, z: G.z + uz * ext };
  const len = span + 2 * ext, cx = (A.x + Bp.x) / 2, cz = (A.z + Bp.z) / 2;
  const ry = Math.atan2(-uz, ux);
  const y0 = path.yAt(sF) - TRACK.RAIL_TOP, deckBot = y0 + TRACK.RAIL_TOP + 7.4, deckTop = deckBot + 0.45, roofY = deckTop + 3;
  const bat = new Batcher();
  const px = -uz, pz = ux; // across the walkway
  const green = M.steelGreen();
  bat.box(M.concrete(), cx, (deckBot + deckTop) / 2, cz, len, deckTop - deckBot, 3.6, ry);
  for (const side of [-1, 1]) {
    const ox = cx + px * side * 1.8, oz = cz + pz * side * 1.8;
    bat.box(green, ox, deckTop + 1.6, oz, len, 0.16, 0.16, ry, false);
    bat.box(green, ox, deckTop + 0.05, oz, len, 0.2, 0.2, ry, false);
    for (let t = -len / 2; t <= len / 2; t += 2.4) bat.box(green, ox + ux * t, deckTop + 0.8, oz + uz * t, 0.1, 1.6, 0.1, ry, false);
    for (let t = -len / 2; t <= len / 2; t += 6) bat.box(green, ox + ux * t, (deckTop + roofY) / 2, oz + uz * t, 0.12, roofY - deckTop, 0.12, ry, false);
  }
  bat.box(M.roofSheet(), cx, roofY, cz, len + 1, 0.06, 4.6, ry);
  // columns in the gaps between tracks
  for (let t = -len / 2 + 1; t <= len / 2 - 1; t += 1) {
    const x = cx + ux * t, z = cz + uz * t;
    const fromD = t + len / 2 - ext;               // distance from the Dhone track centre
    if (Math.abs(fromD) < 3.2 || index.distance(x, z, 20) < 3.2) continue;
    if (t > -len / 2 + 2 && t < len / 2 - 2 && (Math.round(t) % 9 !== 0)) continue;
    for (const side of [-1, 1]) bat.box(M.concrete(), x + px * side * 1.4, (y0 + deckBot) / 2, z + pz * side * 1.4, 0.55, deckBot - y0, 0.55, ry);
  }
  // stair flights down at both ends, continuing outward
  const rise = deckTop - y0, run = rise / 0.55, hyp = Math.hypot(rise, run), ang = Math.atan2(rise, run);
  for (const end of [-1, 1]) {
    const ex = cx + ux * end * (len / 2 + run / 2), ez = cz + uz * end * (len / 2 + run / 2);
    bat.box(M.concrete(), ex, y0 + rise / 2, ez, hyp, 0.3, 2.4, ry, true, 0, -end * ang);
    for (const side of [-1, 1]) bat.box(green, ex + px * side * 1.2, y0 + rise / 2 + 0.9, ez + pz * side * 1.2, hyp, 0.06, 0.06, ry, false, 0, -end * ang);
  }
  group.add(bat.build());
}
