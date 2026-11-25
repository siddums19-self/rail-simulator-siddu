import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { makeRng, range } from '../core/rng.js';

// Built-up city along the railway: rows of buildings behind the boundary wall wherever the line runs
// through a city (suburban routes all the way; around big city stations for about 4 km each way).
// Merged into one mesh per ~1.5 km so it streams cheaply and is culled off-screen.
const CITY = new Set([
  // Hyderabad / Secunderabad (incl. MMTS)
  'SC', 'HYB', 'KCG', 'LPI', 'FM', 'HPG', 'YKA', 'DQR', 'MXT', 'VAR', 'JOO', 'ATC', 'STPD', 'JET', 'SJVP', 'BMT', 'NCHS', 'FTNR', 'SNF', 'BTNR', 'BRBD', 'HTCY', 'HFZ', 'CDNR', 'LKPL', 'KQD', 'NCKR', 'MLY', 'UR',
  // Mumbai
  'CSMT', 'MSD', 'SNRD', 'BY', 'CHG', 'CRD', 'PR', 'DR', 'MTN', 'SIN', 'CLA', 'VVH', 'GC', 'VK', 'KJRD', 'BND', 'NHU', 'MLND', 'TNA', 'KLVA', 'MBQ', 'DIVA', 'KOPR', 'DI', 'THK', 'KYN',
  'DKRD', 'RRD', 'CTGN', 'SVE', 'VDLR', 'GTBN', 'CHF', 'TKNG', 'CMBR', 'GV', 'MNKD', 'VSH', 'SNCR', 'JNJ', 'NEU', 'SWDV', 'BEPR', 'KHAG', 'MANR', 'KNDS', 'PNVL',
  'CCG', 'MEL', 'CYR', 'GTR', 'MMCT', 'MX', 'PL', 'PBHD', 'DDR', 'MRU', 'MM', 'BA', 'KHAR', 'STC', 'VLP', 'ADH', 'JOS', 'RMAR', 'GMN', 'MDD', 'KILE', 'BVI', 'DIC', 'MIRA', 'BYR', 'NIG', 'BSR', 'NSP', 'VR',
  // other big cities on the network
  'MAS', 'PER', 'SBC', 'YNK', 'BZA', 'VSKP', 'HWH', 'NDLS', 'NZM', 'ADI', 'PUNE', 'JP', 'CBE', 'NGP', 'BPL', 'UBL', 'GNT', 'NLR', 'TPTY', 'KRNT', 'GTL'
]);
const BIG = new Set(['SC', 'HYB', 'CSMT', 'MAS', 'SBC', 'HWH', 'NDLS', 'ADI', 'PUNE', 'DDR', 'MMCT', 'ADH', 'BZA', 'VSKP']);
const WALLS = ['#f3e6c4', '#d9e8f0', '#f6d6c8', '#e7efc9', '#fbf3e4', '#f0d8a8', '#e0e3e8', '#f2d0d6'];

export function buildCityRows(layout, terrain, exclusion, seedKey, root) {
  const path = layout.path, st = layout.stations;
  // s-ranges that are "in the city": between two city stations, or within ~4 km of a city station
  const ranges = [];
  st.forEach((s, i) => {
    if (!CITY.has(s.code)) return;
    const R = BIG.has(s.code) ? 5000 : 3000;
    ranges.push([s.layout.zoneStart - R, s.layout.zoneEnd + R, BIG.has(s.code)]);
    const n = st[i + 1];
    if (n && CITY.has(n.code)) ranges.push([s.layout.zoneEnd, n.layout.zoneStart, BIG.has(s.code) || BIG.has(n.code)]);
  });
  if (!ranges.length) return null;
  const inStation = (sv) => st.some((x) => sv > x.layout.zoneStart - 40 && sv < x.layout.zoneEnd + 40);
  const big = (sv) => ranges.some(([a, b, B]) => B && sv >= a && sv <= b);
  const covered = (sv) => ranges.some(([a, b]) => sv >= a && sv <= b);
  const group = new THREE.Group();
  const rand = makeRng(seedKey, 'city-rows');
  const v = new THREE.Vector3();
  const CH = 1500;
  let bat = null, chunkEnd = -Infinity;
  const flush = () => { if (bat) { const o = bat.build(); o.traverse((m) => { if (m.isMesh) m.frustumCulled = true; }); group.add(o); } bat = null; };
  for (let sv = Math.max(0, Math.min(...ranges.map((r) => r[0]))); sv < Math.min(layout.total, Math.max(...ranges.map((r) => r[1]))); sv += 26) {
    if (!covered(sv) || inStation(sv)) continue;
    if (sv > chunkEnd) { flush(); bat = new Batcher(); chunkEnd = sv + CH; }
    const th = path.headingAt(sv), tall = big(sv);
    for (const side of [-1, 1]) {
      let lat = layout.flatHalfWidth(sv) + range(rand, 14, 22);
      // boundary wall along the railway
      path.pointAt(sv, side * (lat - 4), v);
      const wy = terrain.heightAt(v.x, v.z);
      bat.box(M.brick(), v.x, wy + 1.1, v.z, 0.35, 2.2, 26.2, -th, false);
      for (let row = 0; row < 6; row++) {
        if (rand() < 0.18) { lat += 18; continue; }                         // a lane / open plot
        const w = range(rand, 9, 16), d = range(rand, 10, 22);
        path.pointAt(sv + range(rand, -3, 3), side * (lat + w / 2), v);
        if (exclusion(v.x, v.z)) { lat += w + 6; continue; }
        const n = path.nearest(v.x, v.z);
        if (n.dist < layout.flatHalfWidth(n.s) + 10) break;                  // a curve brought the line close
        const gy = terrain.heightAt(v.x, v.z);
        const floors = Math.max(1, Math.round(tall ? range(rand, 2, rand() < 0.25 ? 14 : 6) : range(rand, 1, 4)));
        const h = floors * 3.2;
        const mat = M.house(WALLS[Math.floor(rand() * WALLS.length)], Math.floor(rand() * 6), rand() < 0.3);
        bat.box(mat, v.x, gy + h / 2, v.z, w, h, d, -th, row < 2);
        bat.box(M.plaster(0x8f8a80), v.x, gy + h + 0.15, v.z, w + 0.3, 0.3, d + 0.3, -th, false);
        if (rand() < 0.4) bat.cyl(M.tank(), v.x, gy + h + 0.9, v.z, 0.7, 0.7, 1.3, 10);   // Sintex tank
        lat += w + range(rand, 3, 9);
        if (lat > 260) break;
      }
    }
  }
  flush();
  root.add(group);
  return group;
}
