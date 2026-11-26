import { RoadTraffic } from './vehicles.js';
import * as THREE from 'three/webgpu';
import { stationModel, placeStationModel } from './stationModels.js';
import { landmarkStyle, facadeMaterials, buildLandmark } from './landmarks.js';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { makeRng, pick, range } from '../core/rng.js';
import { PLATFORM_TOP, TRACK } from '../config.js';
import { createPerson } from './people.js';
import { buildStaticRake } from '../trains/consist.js';
import { isJunctionStation } from './junctionSplits.js';

// Builds one station in its local frame: X = lateral (right of travel),
// -Z = direction of travel, origin at the platform centre, y = formation.

const COACH_SEQ = ['ENG', 'SLR', 'GEN', 'S1', 'S2', 'S3', 'S4', 'S5', 'B1', 'B2', 'B3', 'A1', 'H1', 'PC', 'GEN', 'SLR'];

export function buildStation(st, layout, { seedKey, density = 1, people = [] }) {
  const L = st.layout;
  const path = layout.path;
  const rand = makeRng(seedKey, 'station', st.code, st.index);
  const root = new THREE.Group();
  const local = new THREE.Group();
  const p0 = path.pointAt(L.sCenter, 0, new THREE.Vector3());
  local.position.copy(p0);
  local.rotation.y = -path.headingAt(L.sCenter);
  root.add(local);
  // canopies go in their own batch so Station Master can hide them (to see the trains under them)
  const baseBat = new Batcher(), roofBat = new Batcher();
  let bat = baseBat;
  const pfTop = PLATFORM_TOP;
  const pLen = L.pLen;
  const big = L.N >= 4;
  const anim = [], traffic = [];

  // local helpers: ds along travel (+ahead), lat right
  const box = (mat, ds, lat, y, w, h, d, cast = true, rz = 0, rx = 0) => bat.box(mat, lat, y, -ds, w, h, d, 0, cast, rx, rz);

  // ---------------------------------------------------------- yard bed
  const tMin = Math.min(...L.tracks.map((t) => t.o)), tMax = Math.max(...L.tracks.map((t) => t.o));
  // full width only along the platforms; through the fans it tapers with the tracks
  // (a full-width rectangle left a grey slab on the ground beyond the station)
  const yMid = (tMin + tMax) / 2, yW = tMax - tMin + 7;
  box(M.ballast(), (L.pStart + L.pEnd) / 2 - L.sCenter, yMid, 0.08, yW, 0.16, L.pEnd - L.pStart + 8, false);
  const NSEG = 6;
  for (const [s0, len, sgn] of [[L.pStart, L.maxFanEntry, -1], [L.pEnd, L.maxFanExit, 1]]) {
    for (let k = 0; k < NSEG; k++) {
      const f = (k + 0.5) / NSEG;
      const w = yW + (6 - yW) * Math.min(1, f * 1.15);
      if (w < 6.5) break;
      box(M.ballast(), s0 + sgn * (k + 0.5) * (len / NSEG) - L.sCenter, yMid * (1 - f), 0.07, w, 0.14, len / NSEG + 0.5, false);
    }
  }

  // ---------------------------------------------------------- platforms
  const canopies = [];
  for (const P of L.platforms) {
    const w = P.l1 - P.l0, cx = (P.l0 + P.l1) / 2;
    // body + walls
    box(M.platformWall(), 0, cx, (pfTop - 0.3) / 2 + 0.15, w, pfTop - 0.3 + 0.3, pLen, true);
    // tiled deck
    box(M.platformTop(), 0, cx, pfTop - 0.03, w - 0.5, 0.08, pLen - 0.4, false);
    // white coping + yellow tactile strip on track-facing edges
    const faces = [];
    if (P.type === 'island') faces.push(-1, 1); else faces.push((P.l0 + P.l1) / 2 < 0 ? 1 : -1);
    for (const side of faces) {
      const edge = side > 0 ? P.l1 : P.l0;
      box(M.whiteEdge(), 0, edge - side * 0.25, pfTop - 0.01, 0.5, 0.06, pLen, false);
      box(M.tactile(), 0, edge - side * 0.9, pfTop - 0.005, 0.6, 0.04, pLen, false);
    }
    // sloped ramps at both ends
    for (const end of [-1, 1]) {
      const ramp = new THREE.BoxGeometry(w, 0.2, 9);
      bat.add(ramp, M.platformWall(), cx, pfTop * 0.5, -(end * (pLen / 2 + 4.3)), -Math.atan2(pfTop, 9) * end, 0, 0, 1, 1, 1, false);
    }
    canopies.push({ P, w, cx, len: P.type === 'island' ? pLen * 0.66 : pLen * 0.55, offset: P.type === 'island' ? 0 : -pLen * 0.06 });
  }

  // ---------------------------------------------------------- canopies (gable roof on steel trusses)
  for (const C of canopies) {
    bat = roofBat;
    const { P, w, cx, len, offset } = C;
    const half = w / 2 + 0.9;
    const ridge = pfTop + 6.3, eave = pfTop + 5.25;
    const ang = Math.atan2(ridge - eave, half);
    const slopeLen = half / Math.cos(ang);
    for (const side of [-1, 1]) {
      // corrugated sheets
      bat.box(M.roofSheet(), cx + side * half / 2, (ridge + eave) / 2 + 0.05, -offset, slopeLen + 0.1, 0.06, len, 0, true, 0, -side * ang);
      // fascia + gutter
      box(M.fascia(), offset, cx + side * (half + 0.02), eave - 0.12, 0.08, 0.42, len, false);
      box(M.steelDark(), offset, cx + side * (half - 0.1), eave - 0.25, 0.22, 0.14, len, false);
      // purlins
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        box(M.steel(), offset, cx + side * half * t, ridge - (ridge - eave) * t - 0.12, 0.08, 0.14, len, false);
      }
    }
    box(M.steelDark(), offset, cx, ridge + 0.06, 0.4, 0.1, len + 0.2, false); // ridge cap
    // columns + rafters every 9 m
    for (let z = -len / 2 + 3; z <= len / 2 - 2; z += 9) {
      const ds = offset + z;
      box(M.steelBlue(), ds, cx, pfTop + (ridge - 0.35 - pfTop) / 2, 0.34, ridge - 0.35 - pfTop, 0.26);
      box(M.concrete(), ds, cx, pfTop + 0.2, 0.6, 0.4, 0.6, false);
      for (const side of [-1, 1]) {
        bat.box(M.steelBlue(), cx + side * half / 2, (ridge + eave) / 2 - 0.22, -ds, slopeLen, 0.24, 0.18, 0, true, 0, -side * ang);
        // knee brace
        bat.box(M.steelBlue(), cx + side * 0.9, ridge - 1.2, -ds, 0.12, 2.0, 0.12, 0, false, 0, side * 0.7);
        // tube light
        bat.box(M.tubeLight(), cx + side * half * 0.55, eave + 0.25, -(ds + 4.5), 0.08, 0.06, 1.25, 0, false);
      }
      // coach position indicator board hanging over each face
      const label = COACH_SEQ[Math.floor((z + len / 2) / 9) % COACH_SEQ.length];
      const faces = P.type === 'island' ? [-1, 1] : [(P.l0 + P.l1) / 2 < 0 ? 1 : -1];
      for (const side of faces) {
        const lat = cx + side * (w / 2 - 0.6);
        const brd = M.led(label);
        box(M.black(), ds, lat, eave - 0.85, 0.08, 0.5, 1.15, false);
        bat.box(brd, lat + side * 0.045, eave - 0.85, -ds, 0.01, 0.42, 1.05, 0, false, 0, 0);
        box(M.steelDark(), ds, lat, eave - 0.4, 0.04, 0.5, 0.04, false);
      }
      // benches under the roof
      bat = baseBat;
      if (rand() < 0.7 * density) {
        const bl = cx + (rand() - 0.5) * (w - 3);
        box(M.bench(), ds + 4, bl, pfTop + 0.45, 0.5, 0.08, 2.2);
        box(M.bench(), ds + 4, bl - 0.22, pfTop + 0.75, 0.06, 0.5, 2.2, false);
        box(M.steelDark(), ds + 3.2, bl, pfTop + 0.22, 0.4, 0.44, 0.08, false);
        box(M.steelDark(), ds + 4.8, bl, pfTop + 0.22, 0.4, 0.44, 0.08, false);
      }
      bat = roofBat;
    }
    bat = baseBat;
    // platform number boards at both canopy ends
    const txt = P.faces.join('   ');
    const nb = M.textBoard(txt, { bg: '#0b3d91', fg: '#ffffff', w: 256, h: 128, font: 'bold 84px Arial' });
    for (const end of [-1, 1]) {
      const ds = offset + end * (len / 2 - 1);
      bat.box(nb, cx, eave - 0.7, -ds, 1.8, 0.9, 0.06, 0, false);
    }
    // uncovered platform: lamp posts
    for (let z = -pLen / 2 + 8; z <= pLen / 2 - 8; z += 24) {
      if (Math.abs(z - offset) < len / 2 + 4) continue;
      box(M.steelGreen(), z, cx, pfTop + 3.2, 0.14, 6.4, 0.14);
      box(M.lampHead(), z, cx, pfTop + 6.35, 1.1, 0.14, 0.32, false);
    }
    // water booth & tea stall
    const tz = offset + range(rand, -len / 3, len / 3);
    box(M.steelBlue(), tz, cx, pfTop + 0.6, 1.0, 1.2, 1.8);
    box(M.galvanised(), tz, cx, pfTop + 1.35, 1.1, 0.3, 1.9, false);
    const sz = offset - len / 4;
    const stallCol = pick(rand, [0xc0392b, 0x16a085, 0xd35400, 0x2471a3]);
    box(M.plaster(0xe8dcc0), sz, cx, pfTop + 1.25, 2.2, 2.5, 2.6);
    box(M.plaster(stallCol), sz, cx, pfTop + 2.65, 2.8, 0.25, 3.2, false);
    box(M.textBoard('IRCTC  TEA • SNACKS', { bg: '#7b241c', fg: '#fff', w: 512, h: 96, font: 'bold 46px Arial' }), sz, cx, pfTop + 2.3, 2.25, 0.4, 2.62, false);
  }

  // ---------------------------------------------------------- station building (behind PF1)
  const pf1 = L.platforms.find((P) => P.faces.includes(1)) || L.platforms[0];
  const bs = (pf1.l0 + pf1.l1) / 2 < 0 ? -1 : 1;      // side of the station building
  const outer = bs < 0 ? pf1.l0 : pf1.l1;              // PF1's outer edge
  const away = (d) => outer + bs * d;                  // lateral position d metres behind PF1
  const grand = st.category === 'metro' || st.category === 'junction';
  const bLen = grand ? pLen * 0.55 : big ? pLen * 0.42 : Math.min(60, pLen * 0.3);
  const bDepth = grand ? 20 : big ? 15 : 9;
  const style = grand ? landmarkStyle(st) : null;
  const bH = grand ? style.h : big ? 10 : 5.5;
  const bx = away(bDepth / 2);
  let facade = M.facade(`${st.name.replace(/ JN$/, '')}${st.layout.N > 1 ? ' JUNCTION' : ''}`);
  let plain = M.plaster(0xe5d3ad);
  if (style) ({ facade, plain } = facadeMaterials(style, facade, plain));
  const bMesh = new THREE.Mesh(new THREE.BoxGeometry(bDepth, bH, bLen), bs < 0 ? [facade, plain, M.plaster(0x9a8c78), plain, plain, plain] : [plain, facade, M.plaster(0x9a8c78), plain, plain, plain]);
  bMesh.position.set(bx, pfTop + bH / 2 - 0.2, 0);
  bMesh.castShadow = true;
  local.updateMatrixWorld(true);
  const custom = stationModel(st.code);
  if (custom) placeStationModel(custom, local, { bx, bs, y: 0 }); // real building model replaces the procedural one
  else bat.addObject(bMesh, null);
  if (custom) { /* skip procedural landmark */ } else if (grand) {
    // landmark building modelled on the real station (or a procedural style per station)
    buildLandmark(style, { box, bat, bx, bs, pfTop, bH, bLen, bDepth, local, traffic, rand, defaultName: st.name.replace(/ JN$/, '') + (st.layout.N > 1 ? ' JUNCTION' : '') });
  } else if (big) {
    box(M.plaster(0xe5d3ad), 0, bx, pfTop + bH + 3.5, 5, 7, 5);
    box(M.maroon(), 0, bx, pfTop + bH + 7.4, 6, 0.8, 6);
    const clock = M.textBoard('XII\nVI', { bg: '#fdfdf5', fg: '#222', w: 128, h: 128, font: 'bold 30px serif' });
    bat.box(clock, bx - bs * 2.52, pfTop + bH + 4.8, 0, 0.05, 2.2, 2.2, 0, false);
  }
  if (!grand && !custom) {
    box(M.maroon(), 0, away(bDepth + 2.5), pfTop + 3.4, 5, 0.4, bLen * 0.4);
    for (const z of [-bLen * 0.18, bLen * 0.18]) box(M.plaster(0xf0e6cc), z, away(bDepth + 4.6), pfTop + 1.7, 0.5, 3.4, 0.5);
  }

  // ---------------------------------------------------------- name boards
  const board = M.board(st.name, st.code);
  for (const P of L.platforms) {
    const cx = (P.l0 + P.l1) / 2;
    for (const ds of [-pLen / 2 + 14, pLen / 2 - 14]) {
      bat.box(board, cx, pfTop + 3.5, -ds, 0.14, 2.6, 5.2, 0, true);
      for (const o of [-2.3, 2.3]) box(M.steelDark(), ds + o, cx, pfTop + 1.4, 0.12, 2.8, 0.12, false);
    }
  }

  // ---------------------------------------------------------- foot-over bridge(s)
  if (L.platforms.length >= 2) {
    const fobPositions = [-pLen * 0.2];
    if (L.N >= 6) fobPositions.push(pLen * 0.27);
    const deckBot = TRACK.RAIL_TOP + 7.4, deckTop = deckBot + 0.45, roofY = deckTop + 3.0;
    const lat0 = Math.min(...L.platforms.map((P) => P.l0)) + 1.5, lat1 = Math.max(...L.platforms.map((P) => P.l1)) - 1.5;
    const span = lat1 - lat0, mid = (lat0 + lat1) / 2;
    for (const fz of fobPositions) {
      box(M.concrete(), fz, mid, (deckBot + deckTop) / 2, span, deckTop - deckBot, 3.6);
      // lattice trusses on both sides
      for (const side of [-1, 1]) {
        const zz = fz + side * 1.8;
        box(M.steelGreen(), zz, mid, deckTop + 1.6, span, 0.16, 0.16, false);
        box(M.steelGreen(), zz, mid, deckTop + 0.05, span, 0.2, 0.2, false);
        for (let l = lat0; l <= lat1; l += 2.4) {
          box(M.steelGreen(), zz, l, deckTop + 0.8, 0.1, 1.6, 0.1, false);
          bat.box(M.steelGreen(), l + 1.2, deckTop + 0.8, -zz, 0.07, 1.95, 0.07, 0, false, 0, 0.98);
        }
      }
      // roof
      bat.box(M.roofSheet(), mid, roofY, -fz, span + 1, 0.06, 4.6, 0, true, 0, 0);
      for (let l = lat0; l <= lat1; l += 6) {
        for (const side of [-1, 1]) box(M.steelGreen(), fz + side * 1.85, l, (deckTop + roofY) / 2, 0.12, roofY - deckTop, 0.12, false);
      }
      // stairs + columns on every platform
      const rise = deckTop - pfTop;
      const nSteps = Math.round(rise / 0.17);
      const stepH = rise / nSteps;
      for (const P of L.platforms) {
        const cx = (P.l0 + P.l1) / 2;
        for (const o of [-1.4, 1.4]) box(M.concrete(), fz, cx + o * (P.type === 'island' ? 1.4 : 0.9), (pfTop + deckBot) / 2, 0.55, deckBot - pfTop, 0.55);
        // two flights with a landing, descending toward +ds
        const flight = Math.floor(nSteps / 2);
        let y = deckTop, ds = fz + 1.8;
        for (let k = 0; k < nSteps; k++) {
          y -= stepH;
          ds += 0.29;
          if (k === flight) ds += 1.6;
          box(M.concrete(), ds, cx, y + stepH / 2 - 0.08, 2.3, 0.16 + stepH, 0.3, false);
        }
        const run = nSteps * 0.29 + 1.6;
        const sAng = Math.atan2(rise, run);
        const runLen = Math.hypot(rise, run);
        for (const side of [-1, 1]) {
          bat.box(M.steelGreen(), cx + side * 1.2, pfTop + rise / 2 + 0.9, -(fz + 1.8 + run / 2), 0.06, 0.06, runLen, 0, false, -sAng, 0);
          bat.box(M.concrete(), cx + side * 1.2, pfTop + rise / 2, -(fz + 1.8 + run / 2), 0.15, 0.5, runLen, 0, false, -sAng, 0);
        }
        bat.box(M.roofSheet(), cx, pfTop + rise / 2 + 3.0, -(fz + 1.8 + run / 2), 2.9, 0.05, runLen + 0.5, 0, true, -sAng, 0);
        box(M.concrete(), fz + 1.8 + run + 0.4, cx, pfTop + 0.05, 2.6, 0.1, 1.2, false);
      }
    }
  }

  // ---------------------------------------------------------- boundary walls & town
  const farLat = bs < 0 ? L.maxLat + 6 : L.minLat - 6; // opposite side to the building
  // Keep boundary wall along the platforms only so it never cuts across diverging junction tracks at the throats
  box(M.brick(), 0, farLat, 1.0, 0.3, 2.0, pLen + 10, true);
  // Town around the station: density and height grow with the station's importance.
  const cat = st.category === 'metro' ? 3 : st.category === 'junction' ? 2 : st.halt ? 1 : 0;
  const rowsN = [2, 3, 5, 7][cat], maxFloors = [2, 2, 4, 8][cat], fill = [0.45, 0.6, 0.8, 0.92][cat];
  // keep the town clear of Guntakal's school (left facing Gooty) and reservation complex (right)
  const avoid = [];
  if (isJunctionStation(st)) {
    // Keep town buildings clear of diverging junction split tracks beyond the platform ends
    avoid.push((ds) => Math.abs(ds) > pLen / 2 - 20);
  }
  let gtlAtpSide = 0;
  if (st.code === 'GTL') {
    const pv = layout.stations[st.index - 1];
    const gd = (layout.gtl && layout.gtl.dir < 0) || (pv && pv.code === 'GY') ? -1 : 1;
    const sSide = -gd, sLat = sSide * ((sSide < 0 ? Math.abs(L.minLat) : L.maxLat) + 42), sDs = gd * (pLen / 2 - 50);
    avoid.push((ds, lat) => Math.abs(ds - sDs) < 48 && Math.sign(lat) === sSide && Math.abs(lat) > Math.abs(sLat) - 40 && Math.abs(lat) < Math.abs(sLat) + 90);
    const rz = gd * (bLen / 2 + 24), rx = away(9);
    avoid.push((ds, lat) => Math.abs(ds - rz) < 26 && Math.abs(lat - rx) < 20);
    // the Anantapur direct line bends away right from PF 1 / 2 just past the Gooty-end platform ends
    avoid.push((ds, lat) => gd * ds > pLen / 2 - 40 && Math.sign(lat) === gd);
    gtlAtpSide = gd;
    // the forecourt in front of the station building (lawns, plaza, flag, I ♥ GUNTAKAL) stays open
    avoid.push((ds, lat) => Math.sign(lat) === Math.sign(bs) && Math.abs(lat) < Math.abs(outer) + bDepth + 85 && Math.abs(ds) < 75);
  }
  const town = (latFrom, side) => {
    for (let row = 0; row < rowsN; row++) {
      const lat0 = latFrom + row * 26;
      // street between rows
      if (row === 0 && cat >= 1 && !(st.code === 'GTL' && side === gtlAtpSide)) { // moving traffic on the street nearest the station
        const pts = [];
        for (let ds = -pLen * 0.85; ds <= pLen * 0.85; ds += 20) pts.push({ x: side * (lat0 - 6), y: 0.12, z: -ds });
        traffic.push(new RoadTraffic(local, pts, { count: 4 + cat * 2, rand, laneOff: 1.5 }));
      }
      if (st.code === 'GTL' && side === gtlAtpSide) { // streets stop short of the Anantapur direct line
        const a0 = -gtlAtpSide * pLen * 0.85, a1 = gtlAtpSide * (pLen / 2 - 50);
        box(M.asphalt(), (a0 + a1) / 2, side * (lat0 - 6), 0.05, 6, 0.1, Math.abs(a1 - a0), false);
      } else box(M.asphalt(), 0, side * (lat0 - 6), 0.05, 6, 0.1, pLen * 1.7, false);
      for (let ds = -pLen * 0.85; ds < pLen * 0.85; ds += range(rand, 11, 16)) {
        if (rand() > fill * density + 0.1) continue;
        const lat = side * (lat0 + range(rand, 4, 10));
        const w = range(rand, 8, 12), d = range(rand, 9, 13);
        if (avoid.some((f) => f(ds, lat))) continue;
        const floors = 1 + Math.floor(rand() * maxFloors * (1 - row / (rowsN + 2)));
        const hex = pick(rand, ['#efe3c8', '#d6e2e8', '#f0d9c4', '#e8e1a8', '#cfe0cf', '#f5f0e6', '#e3c9b0']);
        const mat = M.house(hex, Math.floor(rand() * 6), row === 0 && rand() < 0.6);
        for (let f = 0; f < floors; f++) box(mat, ds, lat, 1.6 + f * 3.2, w, 3.2, d);
        box(M.plaster(new THREE.Color(hex).getHex()), ds, lat, floors * 3.2 + 0.45, w + 0.2, 0.9, d + 0.2, false);
        if (rand() < 0.7) bat.cyl(M.tank(), lat + 1.5, floors * 3.2 + 1.2, -ds, 0.7, 0.7, 1.5, 10);
      }
    }
  };
  if (st.village) {
    // a hamlet: one or two tiled-roof houses and a tea stall near the station approach
    const n = 1 + (rand() < 0.55 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const side = k === 0 ? bs : (rand() < 0.5 ? bs : -bs);
      const lat = side * ((side === bs ? Math.abs(outer) + bDepth + 22 : Math.abs(farLat) + 16) + range(rand, 0, 14));
      const ds = (k === 0 ? 1 : -1) * range(rand, 18, Math.max(24, pLen * 0.35));
      const hex = pick(rand, ['#efe3c8', '#f0d9c4', '#e8e1a8', '#d6e2e8', '#f5f0e6']);
      const w = range(rand, 7, 9), d = range(rand, 6, 8);
      box(M.house(hex, Math.floor(rand() * 6), false), ds, lat, 1.5, w, 3.0, d);
      box(M.plaster(0x9a4a2c), ds, lat, 3.25, w + 0.8, 0.5, d + 0.8, false); // tiled roof slab
      box(M.plaster(0x9a4a2c), ds, lat, 3.7, w * 0.6, 0.4, d + 0.4, false);
      box(M.plaster(0xd8cdb8), ds, lat + side * (d / 2 + 3), 0.45, w + 4, 0.9, 0.2, false); // compound wall
    }
    // tea stall by the approach road
    const tl = bs * (Math.abs(outer) + bDepth + 9);
    box(M.plaster(0x2f6d4f), bLen / 2 + 8, tl, 1.1, 2.4, 2.2, 3.2);
    box(M.roofSheet(), bLen / 2 + 8, tl, 2.35, 3.4, 0.08, 4.2, false);
  } else {
  town(Math.abs(outer) + bDepth + (grand ? 40 : 26), bs);
  town(Math.abs(farLat) + 14, -bs);

  // ---------------------------------------------------------- a temple in town (South Indian gopuram + mandapam)
  if (cat >= 2 || rand() < 0.55) {
    const side = rand() < 0.5 ? -bs : bs;
    const lat = side * ((side === bs ? Math.abs(outer) + bDepth + (grand ? 40 : 26) : Math.abs(farLat) + 14) + rowsN * 26 + 34);
    const ds = (rand() - 0.5) * pLen * 0.7, f = -Math.sign(lat);  // f: towards the railway
    const paint = [0xf3e3c3, 0xe9b872, 0xd98c5f, 0xf1d18a, 0xc96f4a];
    // compound wall
    for (const o of [-17, 17]) box(M.plaster(0xf2e6cf), ds + o, lat - f * 14, 1.2, 0.5, 2.4, 0.5, false);
    box(M.plaster(0xc95b3a), ds, lat + f * 2, 1.2, 0.5, 2.4, 34, false);            // red-and-white striped wall facing the line
    box(M.plaster(0xf2e6cf), ds, lat - f * 30, 1.2, 0.5, 2.4, 34, false);
    for (const o of [-17, 17]) box(M.plaster(0xf2e6cf), ds + o, lat - f * 14, 1.2, 32, 2.4, 0.5, false);
    // gopuram over the gate: a stepped, tapering tower, painted, with a barrel-vault crown and kalasams
    let y = 0;
    box(M.plaster(0xe8dcc0), ds, lat + f * 2, 2.5, 8, 5, 12);
    y = 5;
    for (let k = 0; k < 6; k++) {
      const w = 7.6 - k * 1.05, l = 11.6 - k * 1.45, h = 2.3;
      box(M.plaster(paint[k % paint.length]), ds, lat + f * 2, y + h / 2, w, h, l);
      box(M.plaster(0x7a5a3a), ds, lat + f * 2, y + h - 0.1, w + 0.3, 0.2, l + 0.3, false); // cornice
      y += h;
    }
    bat.cyl(M.plaster(0xe9b872), lat + f * 2, y + 0.9, -ds, 1.3, 1.3, 4.6, 12, Math.PI / 2, 0, 0); // barrel vault (shala)
    for (const o of [-1.6, 0, 1.6]) bat.cyl(M.plaster(0xd4a63a), lat + f * 2, y + 2.6, -(ds + o), 0.12, 0.35, 1.1, 8); // kalasams
    // mandapam with pillars and the sanctum's small vimana behind
    box(M.plaster(0xf2e6cf), ds, lat - f * 12, 0.4, 14, 0.8, 16, false);
    for (const a of [-5, 0, 5]) for (const b of [-6, 6]) box(M.plaster(0xe8dcc0), ds + a, lat - f * (12 + b * 0.6), 2.4, 0.6, 3.2, 0.6, false);
    box(M.plaster(0xd9b98a), ds, lat - f * 12, 4.2, 14.5, 0.5, 16.5);
    box(M.plaster(0xf3e3c3), ds, lat - f * 23, 3, 7, 6, 7);
    for (let k = 0; k < 3; k++) box(M.plaster(paint[(k + 1) % paint.length]), ds, lat - f * 23, 6.6 + k * 1.3, 6 - k * 1.6, 1.3, 6 - k * 1.6);
    bat.cyl(M.plaster(0xd4a63a), lat - f * 23, 10.9, -ds, 0.2, 0.7, 1.4, 8);
    // flag mast (dhwaja stambham) and a sacred tree
    bat.cyl(M.plaster(0xd4a63a), lat - f * 5, 4.5, -ds, 0.15, 0.3, 9, 8);
    box(M.plaster(0x3f7d2c), ds + 11, lat - f * 7, 4.5, 6, 5, 6, false);
  }

  // Railway colony: rows of identical quarters behind the far-side town
  {
    const side = -bs;
    const start = Math.abs(farLat) + 14 + rowsN * 26 + 8;
    const cols = [3, 5, 8, 10][cat], rows = [1, 2, 3, 4][cat];
    const qMat = M.house('#efe4c6', 2, false), par = M.plaster(0x8c2f22);
    for (let r = 0; r < rows; r++) {
      const lat = side * (start + r * 22);
      box(M.asphalt(), 0, lat - side * 7, 0.05, 5, 0.1, cols * 16 + 10, false);
      for (let c = 0; c < cols; c++) {
        const ds = (c - (cols - 1) / 2) * 16;
        box(qMat, ds, lat, 1.6, 8, 3.2, 10);
        box(par, ds, lat, 3.55, 8.2, 0.5, 10.2, false);
        box(M.plaster(0xe8e2d4), ds, lat + side * 6.5, 0.6, 8, 1.2, 0.2, false); // compound wall
        box(M.plaster(0xe8e2d4), ds - 7.8, lat, 0.6, 0.2, 1.2, 12, false);
        if (rand() < 0.5) bat.cyl(M.tank(), lat + side * 2, 4.3, -ds, 0.6, 0.6, 1.3, 10);
      }
    }
    const archLat = side * (start - 9);
    box(M.plaster(0xd9a066), -6, archLat, 3, 0.7, 6, 0.7);
    box(M.plaster(0xd9a066), 6, archLat, 3, 0.7, 6, 0.7);
    bat.box(M.textBoard('RAILWAY COLONY', { bg: '#0b3d91', fg: '#ffffff', w: 768, h: 128, font: 'bold 72px Arial' }), archLat, 5.6, 0, 0.2, 1.6, 12.5, 0, false);
    if (cat >= 1) {
      const tl = side * (start + rows * 22 + 6);
      for (const [dx, dz] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) box(M.concrete(), cols * 8 + dz, tl + dx, 8, 0.5, 16, 0.5);
      bat.cyl(M.concrete(), tl, 18.5, -(cols * 8), 4.8, 4, 5, 16);
      bat.box(M.textBoard('S.C. RLY', { bg: '#e9e2cf', fg: '#7c2a1d', w: 256, h: 64, font: 'bold 40px Arial' }), tl - side * 4.9, 18.5, -(cols * 8), 0.05, 1.2, 4, 0, false);
      const inst = side * (start + rows * 11);
      box(M.house('#f0d8a8', 4, true), -(cols * 8 + 16), inst, 2.5, 12, 5, 18);
      bat.box(M.textBoard('RAILWAY INSTITUTE', { bg: '#7c2a1d', fg: '#fde68a', w: 512, h: 96, font: 'bold 52px Arial' }), inst - side * 6.05, 4.2, (cols * 8 + 16), 0.06, 1, 9, 0, false);
    }
  }

  }

  // Passenger Reservation System / booking office near major stations
  if ((cat >= 2 || L.N >= 3) && st.code !== 'GTL' && !st.village) {
    const rx = away(bDepth + 22), rz = bLen / 2 + 18;
    box(M.plaster(0xe8d9b8), rz, rx, 2.2, 10, 4.4, 18);
    box(M.maroon(), rz, rx, 4.6, 10.6, 0.4, 18.6, false);
    box(M.plaster(0x8c2f22), rz, rx - bs * 5.6, 2.9, 1.2, 0.15, 16, false); // awning
    bat.box(M.textBoard('PASSENGER RESERVATION SYSTEM\nआरक्षण कार्यालय  •  BOOKING OFFICE', { bg: '#0b3d91', fg: '#ffffff', w: 1024, h: 192, font: 'bold 52px Arial' }), rx - bs * 5.06, 3.75, -rz, 0.08, 1.2, 14, 0, false);
    for (let k = 0; k < 7; k++) { // queue at the counter
      const m = createPerson(Math.floor(rand() * 1e9), 'auto');
      m.position.set(rx - bs * 6.4, pfTop - 1.4, -(rz - 6 + k * 1.0));
      m.rotation.y = Math.PI / 2 + Math.PI;
      local.add(m);
    }
  }

  // Guntakal reservation complex: on the PF1 (right) side, at the Gooty end of the main building
  if (st.code === 'GTL') {
    const prev = layout.stations[st.index - 1];
    const dir = (layout.gtl && layout.gtl.dir < 0) || (prev && prev.code === 'GY') ? -1 : 1;
    const rz = dir * (bLen / 2 + 24), rx = away(9);
    const rc = M.house('#efe2c2', 2, false);
    box(rc, rz, rx, 4.4, 14, 8.8, 30);
    box(M.maroon(), rz, rx, 9.0, 14.8, 0.6, 30.8, false);
    box(M.maroon(), rz, rx, 4.5, 14.6, 0.3, 30.6, false);
    box(M.plaster(0x8c2f22), rz, rx - bs * 7.6, 3.1, 1.6, 0.18, 28, false); // awning toward the platform
    bat.box(M.textBoard('RESERVATION COMPLEX\nआरक्षण केंद्र  •  రిజర్వేషన్ కేంద్రం\nPRS  •  UTS  •  ENQUIRY', { bg: '#0b3d91', fg: '#ffffff', w: 1024, h: 288, font: 'bold 54px Arial' }), rx - bs * 7.06, 6.4, -rz, 0.1, 2.8, 20, 0, false);
    bat.box(M.textBoard('RESERVATION COMPLEX', { bg: '#7c1d12', fg: '#ffe9a8', w: 1024, h: 140, font: 'bold 84px Arial' }), rx, 10.9, -rz, 0.12, 2.0, 24, 0, false);
    box(M.steelDark(), rz, rx, 9.9, 0.2, 1.0, 22, false);
    for (let k = 0; k < 9; k++) { // queue at the counters
      const m = createPerson(Math.floor(rand() * 1e9), 'auto');
      m.position.set(rx - bs * 8.6, pfTop - 1.4, -(rz - 8 + k * 1.0));
      m.rotation.y = bs > 0 ? Math.PI / 2 : -Math.PI / 2;
      local.add(m);
    }
  }

  // South Central Railway High School, Guntakal: on the left when facing the Gooty way
  if (st.code === 'GTL') {
    const prev = layout.stations[st.index - 1], next = layout.stations[st.index + 1];
    const gootyBehind = (layout.gtl && layout.gtl.dir < 0) || (prev && prev.code === 'GY');
    const dir = gootyBehind ? -1 : 1;             // which end of the station faces Gooty
    const sx = dir * (pLen / 2 - 50);             // along-track position (ds), by the Gooty end of the platforms
    const side = -dir;                            // left when facing that end
    const lat = side * ((side < 0 ? Math.abs(L.minLat) : L.maxLat) + 42);
    const sch = M.house('#f2e3bd', 3, false);
    box(sch, sx, lat, 4.8, 14, 9.6, 60);                     // main block (3 floors)
    box(sch, sx - 26, lat + side * 18, 3.2, 12, 6.4, 10);    // wings
    box(sch, sx + 26, lat + side * 18, 3.2, 12, 6.4, 10);
    box(M.maroon(), sx, lat, 3.3, 14.6, 0.35, 60.6, false);
    box(M.maroon(), sx, lat, 9.9, 14.6, 0.5, 60.6, false);
    bat.box(M.textBoard('SOUTH CENTRAL RAILWAY HIGH SCHOOL\nGUNTAKAL', { bg: '#7c2a1d', fg: '#fde68a', w: 1024, h: 192, font: 'bold 58px Arial' }), lat - side * 7.06, 7.6, -sx, 0.08, 2.2, 30, 0, false);
    bat.box(M.textBoard('S.C. RLY HIGH SCHOOL', { bg: '#0b3d91', fg: '#ffffff', w: 1024, h: 160, font: 'bold 80px Arial' }), lat - side * 2, 11.8, -sx, 0.12, 2.6, 26, 0, false);
    box(M.steelDark(), sx, lat - side * 2, 10.6, 0.2, 0.9, 24, false);
    box(M.field('plough'), sx, lat + side * 45, 0.07, 50, 0.08, 70, false); // playground
    for (const z of [-35, 35]) box(M.plaster(0xe8e2d4), sx + z, lat + side * 30, 0.7, 0.25, 1.4, 90, false);
    box(M.plaster(0xe8e2d4), sx, lat + side * 75, 0.7, 70, 1.4, 0.25, false);
    box(M.steelDark(), sx - 40, lat - side * 9, 4.5, 0.12, 9, 0.12, false); // flag pole
    box(M.white(), sx - 40, lat - side * 9 + 0.9 * side, 8.4, 0.03, 0.4, 1.8, false);
    box(M.plaster(0xff9933), sx - 40, lat - side * 9 + 0.9 * side, 8.8, 0.03, 0.4, 1.8, false);
    box(M.plaster(0x138808), sx - 40, lat - side * 9 + 0.9 * side, 8.0, 0.03, 0.4, 1.8, false);
  }
  // approach road + autos at the station front
  box(M.asphalt(), 0, away(bDepth + (grand ? 16 : 9)), 0.06, 9, 0.1, pLen * 0.9, false);
  for (let i = 0; i < 6; i++) {
    const z = range(rand, -bLen / 2, bLen / 2);
    const al = away(bDepth + (grand ? 14 : 7) + rand() * 3);
    box(M.plaster(0x2e7d32), z, al, 0.9, 1.4, 1.4, 2.6);
    box(M.plaster(0xf9d71c), z, al, 1.7, 1.42, 0.25, 2.62, false);
  }

  const staticGroup = baseBat.build();
  local.add(staticGroup);
  const roof = roofBat.build();
  local.add(roof);

  // ---------------------------------------------------------- passengers
  const busy = st.category === 'metro' ? 2.4 : st.category === 'junction' ? 1.9 : 1;
  const nPer = Math.round((big ? 14 : 5) * busy * density * (st.halt ? 1 : 0.5));
  for (const P of L.platforms) {
    const cx = (P.l0 + P.l1) / 2;
    const w = P.l1 - P.l0;
    for (let k = 0; k < nPer; k++) {
      const kind = k === 0 && big ? 'porter' : 'auto';
      const m = createPerson(Math.floor(rand() * 1e9), kind);
      const z = range(rand, -pLen * 0.32, pLen * 0.32);
      const lat = cx + range(rand, -w / 2 + 1.6, w / 2 - 1.6);
      m.position.set(lat, pfTop, z);
      local.add(m);
      const walker = rand() < 0.6;
      anim.push({ mesh: m, walker, speed: range(rand, 0.8, 1.4), dir: rand() < 0.5 ? 1 : -1, t: z, min: -pLen * 0.33, max: pLen * 0.33, phase: rand() * 6, baseRot: rand() * 6.28 });
    }
  }
  people.push(...anim);

  // ---------------------------------------------------------- selling points on the platforms (busier stations get more)
  if (big || st.halt) {
    const stallBat = new Batcher();
    const kinds = [
      ['TEA • COFFEE • SNACKS', '#b91c1c', 0xf5e6c8], ['A.H. WHEELER BOOK STALL', '#1d4ed8', 0xe6eef9], ['IRCTC FOOD PLAZA', '#7c2d12', 0xf7e7cf],
      ['FRUITS & JUICE', '#15803d', 0xe9f5e1], ['MILK • CURD • BISCUITS', '#0e7490', 0xe3f4f7], ['CHAI', '#b45309', 0xfbe7c6]
    ];
    const per = big ? Math.round(2 + busy) : 1;
    for (const P of L.platforms) {
      const cx = (P.l0 + P.l1) / 2, w = P.l1 - P.l0;
      if (w < 5) continue;
      for (let k = 0; k < per; k++) {
        const [label, bg, wall] = kinds[Math.floor(rand() * kinds.length)];
        const z = -pLen * 0.28 + (k + 0.5) * (pLen * 0.56 / per) + range(rand, -6, 6);
        const lx = cx + range(rand, -0.8, 0.8);
        stallBat.box(M.plaster(wall), lx, pfTop + 1.1, z, 2.2, 2.2, 3.2, 0, true);                  // kiosk
        stallBat.box(M.plaster(0x6b4f2a), lx, pfTop + 0.55, z, 2.4, 1.1, 3.4, 0, true);             // counter
        stallBat.box(M.textBoard(label, { bg, fg: '#ffffff', w: 512, h: 96, font: 'bold 40px Arial' }), lx, pfTop + 2.55, z, 2.3, 0.55, 3.4, 0, false);
        stallBat.box(M.steelDark(), lx, pfTop + 2.25, z, 2.6, 0.08, 3.6, 0, false);
        // the vendor and a couple of customers
        for (let c = 0; c < 3; c++) {
          const m = createPerson(Math.floor(rand() * 1e9), 'auto');
          m.position.set(lx + (c === 0 ? 0 : (c === 1 ? -1.8 : 1.8)), pfTop, z + (c === 0 ? 0 : range(rand, -1.2, 1.2)));
          m.rotation.y = c === 0 ? 0 : Math.PI / 2 * (c === 1 ? 1 : -1);
          local.add(m);
        }
      }
    }
    local.add(stallBat.build());
  }

  // ---------------------------------------------------------- parked trains
  const parked = [];
  for (const t of L.tracks) {
    const occ = st.occupancy?.get(t.no);
    if (!occ || occ.kind !== 'parked') continue;
    const cars = occ.rake === 'BOXN_GOODS' ? 18 : (occ.rake === 'DEMU_PASSENGER' ? 6 : 9);
    const r = buildStaticRake(occ.rake, cars);
    // straight in the platform; rake local +Z runs from the front coupler backwards
    if (occ.facing > 0) { r.group.position.set(t.o, 0, -pLen / 2 + 8); r.group.rotation.y = 0; }
    else { r.group.position.set(t.o, 0, pLen / 2 - 8); r.group.rotation.y = Math.PI; }
    local.add(r.group);
    parked.push(r.group);
    occ.group = r.group; // so control can shunt it away (Traffic.vacate)
  }

  return { root, people: anim, parked, roof, traffic };
}
