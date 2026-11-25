import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { makeRng, smoothstep } from '../core/rng.js';
import { TrackChunkBuilder, polylineFrames } from './trackBuilder.js';
import { PolylineIndex } from './terrain.js';
import { buildSideOHE, lineFromTo } from './gtlJunction.js';
import { GTL_WEST, gtlWestLadder } from '../route/layout.js';
import { buildLoco } from '../trains/rollingStock.js';

// Guntakal's west end: the Adoni (Raichur / Wadi) line and the Ballari (Hosapete / Hubballi / Goa)
// line leave side by side — facing west, Ballari on the left, Adoni on the right — and part
// company a few hundred metres out. Whichever of the two our route does not use is drawn here,
// with the crossover ladder that lets every platform reach either line, and the electric loco
// shed beside the yard.
export function buildGtlWest(layout, { seedKey }) {
  const W = layout.gtlWest;
  const path = layout.path;
  const P0 = path.pointAt(W.boundary, 0, new THREE.Vector3());
  const H0 = path.headingAt(W.boundary) + (W.dir > 0 ? 0 : Math.PI); // facing away from GTL, out of the west end
  const group = new THREE.Group();
  const index = new PolylineIndex(80);
  const sm = (a, a0, a1) => smoothstep(a0, a1, a);
  const side = W.otherSide;                          // -1: the other line is on the left (frame)
  const lat0 = side * GTL_WEST.lat;
  const S = GTL_WEST;
  const k0 = S.curveStart, turn = S.turn, R = S.radius, step = 2;

  // the other line: straight beside our route, then curving away to its side
  const pts = [];
  let x = 0, z = 0, th = H0, turned = 0;
  const F = { x: Math.sin(H0), z: -Math.cos(H0) }, Rt = { x: Math.cos(H0), z: Math.sin(H0) };
  const y0 = path.yAt(W.boundary);
  for (let a = 0; a <= S.length; a += step) {
    if (a <= k0) { x = P0.x + F.x * a + Rt.x * lat0; z = P0.z + F.z * a + Rt.z * lat0; th = H0; }
    else {
      let k = 0;
      if (turned < turn) { const ramp = Math.min(1, (a - k0) / 160); k = (side / R) * ramp; turned += Math.abs(k) * step; }
      const tm = th + (k * step) / 2;
      x += Math.sin(tm) * step; z -= Math.cos(tm) * step; th += k * step;
    }
    const n = path.nearest(x, z);
    const g = n.dist < 4000 ? path.groundAt(n.s) : y0;
    const kk = sm(a, 400, 900);
    pts.push({ x, z, th, y: y0 * (1 - kk) + g * kk, a });
  }
  // crossovers joining the other line to our running lines (frame offsets)
  const ladder = gtlWestLadder(side).map(([a0, a1, p, q]) => lineFromTo(P0, H0, a0, a1, (a) => p + (q - p) * sm(a, a0, a1), 2));
  for (const l of [pts, ...ladder]) index.add(l, 2);

  const tb = new TrackChunkBuilder();
  for (const l of [pts, ...ladder]) tb.addTrack(polylineFrames(l));
  tb.build(group);
  buildSideOHE(group, [pts], new THREE.Vector3(1e9, 0, 1e9));

  // junction boards
  const bat = new Batcher();
  const boardAt = (a, lat, text) => {
    const bx = P0.x + F.x * a + Rt.x * lat, bz = P0.z + F.z * a + Rt.z * lat;
    bat.box(M.textBoard(text, { bg: '#f5c518', fg: '#111', w: 768, h: 192, font: 'bold 60px Arial' }), bx, 3.2, bz, 5.2, 1.3, 0.12, -H0 + (W.dir > 0 ? 0 : Math.PI), true);
    for (const o of [-2.2, 2.2]) bat.box(M.steelDark(), bx + Rt.x * o, 1.3, bz + Rt.z * o, 0.12, 2.6, 0.12, 0, false);
  };
  const ours = W.route === 'BAY' ? 'BALLARI / HOSAPETE / HUBBALLI' : 'ADONI / RAICHUR / WADI';
  const other = W.route === 'BAY' ? 'ADONI / RAICHUR / WADI' : 'BALLARI / HOSAPETE / HUBBALLI';
  boardAt(150, lat0 + side * 7, side < 0 ? `⬉  ${other}` : `${other}  ➚`);
  boardAt(150, -side * (S.lat + 1), side < 0 ? `${ours}  ➜` : `⬅  ${ours}`);

  // Electric loco shed, Guntakal: on the far side of the other line
  const rand = makeRng(seedKey, 'gtl-els');
  const shedA = 260, shedLat = lat0 + side * 42, shedL = 130, shedW = 34;
  const cx = P0.x + F.x * (shedA + shedL / 2) + Rt.x * shedLat, cz = P0.z + F.z * (shedA + shedL / 2) + Rt.z * shedLat;
  const ry = -H0;
  const steel = M.steelDark(), roof = M.roofSheet ? M.roofSheet() : M.steelDark(), wall = M.plaster(0xd9cfb8);
  bat.box(M.concrete(), cx, y0 + 0.15, cz, shedW + 10, 0.3, shedL + 30, ry, false);
  for (const o of [-shedW / 2, shedW / 2]) bat.box(wall, cx + Rt.x * o, y0 + 4.5, cz + Rt.z * o, 0.4, 9, shedL, ry);
  bat.box(wall, cx - F.x * shedL / 2, y0 + 7.5, cz - F.z * shedL / 2, shedW, 3, 0.4, ry); // gable ends above the doors
  bat.box(wall, cx + F.x * shedL / 2, y0 + 7.5, cz + F.z * shedL / 2, shedW, 3, 0.4, ry);
  bat.box(roof, cx, y0 + 9.6, cz, shedW + 2, 0.2, shedL + 2, ry, true);
  bat.box(roof, cx, y0 + 10.6, cz, shedW * 0.35, 1.8, shedL, ry, true); // monitor roof for light and smoke
  for (let k = -2; k <= 2; k++) bat.box(steel, cx + F.x * k * 26, y0 + 4.5, cz + F.z * k * 26, 0.3, 9, 0.3, ry, false); // columns
  bat.box(M.textBoard('ELECTRIC LOCO SHED  •  GUNTAKAL  •  S.C. RLY', { bg: '#0b3d91', fg: '#ffffff', w: 1024, h: 128, font: 'bold 52px Arial' }),
    cx - F.x * (shedL / 2 + 0.3), y0 + 7.6, cz - F.z * (shedL / 2 + 0.3), shedW * 0.8, 1.6, 0.1, ry, false);
  group.add(bat.build());
  // shed roads and stabled locos
  const shedRoads = [-9, 0, 9].map((o) => lineFromTo(P0, H0, shedA - 120, shedA + shedL - 4, () => shedLat + o, 4));
  const tb2 = new TrackChunkBuilder();
  for (const l of shedRoads) tb2.addTrack(polylineFrames(l));
  tb2.build(group);
  for (const l of shedRoads) index.add(l, 4);
  const kinds = ['WAP7', 'WAG9', 'WAP7', 'WAG12', 'WAG9'];
  shedRoads.forEach((l, i) => {
    for (let k = 0; k < 2; k++) {
      if (rand() < 0.3) continue;
      const v = buildLoco(kinds[(i * 2 + k) % kinds.length], String(30200 + Math.floor(rand() * 700)), { cabBothEnds: true });
      const a = shedA - 90 + k * 60 + rand() * 20;
      v.group.position.set(P0.x + F.x * a + Rt.x * (shedLat + [-9, 0, 9][i]), y0 + 0.64, P0.z + F.z * a + Rt.z * (shedLat + [-9, 0, 9][i]));
      v.group.rotation.y = -H0;
      group.add(v.group);
    }
  });
  const exclusion = (ex, ez) => {
    if (index.distance(ex, ez, 60) < 14) return true;
    const dx = ex - cx, dz = ez - cz;
    return Math.abs(dx * Rt.x + dz * Rt.z) < shedW / 2 + 12 && Math.abs(dx * F.x + dz * F.z) < shedL / 2 + 40;
  };
  return { group, index, exclusion, lines: [pts, ...ladder, ...shedRoads] };
}
