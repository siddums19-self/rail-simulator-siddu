import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { RoadTraffic } from './vehicles.js';
import { TrackChunkBuilder, polylineFrames } from './trackBuilder.js';
import { buildSideOHE } from './gtlJunction.js';

// Secunderabad, on the side towards Sitaphalmandi / Kacheguda (Jadcherla) / Kazipet (Warangal):
//  * Olifanta bridge: the railway crosses a road that dips under it in a cutting (plate girders over the road)
//  * the Hyderabad Metro on its viaduct, crossing high over the railway, with a train running on it
// planSecunderabad() runs before the terrain is built (the road cutting is carved into the ground).
const EAST = new Set(['STPD', 'KCG', 'JN', 'BG', 'KZJ', 'ATC', 'MLY', 'JOO', 'VAR', 'MXT', 'FM', 'WL']);

export function planSecunderabad(layout) {
  const st = layout.stations, i = st.findIndex((s) => s.code === 'SC');
  if (i < 0) return null;
  const next = st[i + 1]?.code, prev = st[i - 1]?.code;
  const d = next && EAST.has(next) ? 1 : prev && EAST.has(prev) ? -1 : 0;
  if (!d) return null;
  const L = st[i].layout, path = layout.path;
  // Olifanta: just beyond the platform ends on this side; the metro runs above its road;
  // a second metro crossing 50 m past the platform ends on the other side
  const sOl = (d > 0 ? L.pEnd : L.pStart) + d * 300, sMetro = sOl, sMetro2 = (d > 0 ? L.pStart : L.pEnd) - d * 50; // as far out as Guntakal's ROB
  // beyond the bridge the lines part: straight on for Kazipet, bending right for Sitaphalmandi / Kacheguda (Jadcherla).
  // The one our route does not take is drawn beside us.
  const nextCode = d > 0 ? next : prev;
  const oursKzj = new Set(['KZJ', 'JN', 'BG', 'MLY', 'WL']).has(nextCode);
  const s0 = sOl + d * 90, H = 2.65, right = d;            // right of travel in route laterals
  const P0 = path.pointAt(s0, 0, new THREE.Vector3()), H0 = path.headingAt(s0) + (d < 0 ? Math.PI : 0);
  const lat0 = oursKzj ? right * (H + 7) : -right * (H + 7);
  const turn = oursKzj ? (50 * Math.PI) / 180 : 0, R = 750, y0 = path.yAt(s0);
  const centre = [];
  let cx = P0.x + Math.cos(path.headingAt(s0)) * lat0, cz = P0.z + Math.sin(path.headingAt(s0)) * lat0, ch = H0, done = 0;
  for (let a = 0; a <= 2200; a += 4) {
    centre.push({ x: cx, z: cz, y: y0, th: ch });
    let k = 0;
    if (turn && a > 60 && done < turn) { k = Math.min(1, (a - 60) / 120) / R; done += k * 4; }   // eases into the curve (to the right)
    const tm = ch + (k * 4) / 2;
    cx += Math.sin(tm) * 4; cz -= Math.cos(tm) * 4; ch += k * 4;
  }
  const off = (pts, o) => pts.map((p) => ({ ...p, x: p.x + Math.cos(p.th) * o, z: p.z + Math.sin(p.th) * o }));
  const sideLines = [off(centre, -H), off(centre, H)];
  const sideName = oursKzj ? 'SITAPHALMANDI / KACHEGUDA' : 'KAZIPET / WARANGAL';
  const th = path.headingAt(sOl), p = path.pointAt(sOl, 0, new THREE.Vector3());
  return { d, sOl, sMetro, sMetro2, sideLines, sideName, oursKzj, cut: { x: p.x, z: p.z, F: { x: Math.sin(th), z: -Math.cos(th) }, R: { x: Math.cos(th), z: Math.sin(th) }, y: path.yAt(sOl), halfW: 6, len: 170, depth: 6.2 } };
}

// terrain hook: the road cutting under the railway (ramps down to 6 m below the track over ~110 m each side)
export function carveCut(cut, x, z, h) {
  const dx = x - cut.x, dz = z - cut.z;
  const along = dx * cut.F.x + dz * cut.F.z, across = dx * cut.R.x + dz * cut.R.z;
  if (Math.abs(along) > cut.halfW + 3 || Math.abs(across) > cut.len) return h;
  const ramp = Math.min(1, Math.max(0, (cut.len - Math.abs(across)) / 110));
  const floor = cut.y - cut.depth * ramp * ramp * (3 - 2 * ramp);
  const edge = Math.min(1, Math.max(0, (cut.halfW + 3 - Math.abs(along)) / 3));
  return Math.min(h, h + (floor - h) * edge);
}

class MetroTrain {
  constructor(group, a, b, y) {
    this.group = new THREE.Group(); group.add(this.group);
    this.a = a; this.b = b; this.y = y; this.t = Math.random(); this.dir = 1;
    const bat = new Batcher(), body = M.plaster(0xf4f5f7), stripe = M.plaster(0xd7263d), glass = new THREE.MeshStandardMaterial({ color: 0x1b2a38, metalness: 0.7, roughness: 0.1 });
    for (let k = 0; k < 3; k++) {
      const z = (k - 1) * 22;
      bat.box(body, 0, 2.0, z, 2.9, 3.2, 21.4, 0, true);
      bat.box(stripe, 0, 1.0, z, 2.95, 0.35, 21.4, 0, false);
      bat.box(glass, 0, 2.5, z, 2.95, 0.9, 19, 0, false);
    }
    this.mesh = bat.build(); this.group.add(this.mesh);
    this.center = a.clone().lerp(b, 0.5);
  }
  update(dt) {
    this.t += this.dir * dt * 16 / this.a.distanceTo(this.b);
    if (this.t > 1 || this.t < 0) { this.dir *= -1; this.t = Math.max(0, Math.min(1, this.t)); }
    const p = this.a.clone().lerp(this.b, this.t);
    this.mesh.position.set(p.x, this.y, p.z);
    this.mesh.rotation.y = Math.atan2(this.b.x - this.a.x, this.b.z - this.a.z);
  }
}

// an elevated metro line crossing the railway at route distance s (angle measured from the track),
// piers kept off the tracks (and to both sides of a road cutting), with a train running on it
function metro(path, sM, angle, height, bat, g, traffic, terrain, cut) {
  const thM = path.headingAt(sM) + angle, pM = path.pointAt(sM, 0, new THREE.Vector3());
  const dir = new THREE.Vector3(Math.sin(thM), 0, -Math.cos(thM)), side = new THREE.Vector3(Math.cos(thM), 0, Math.sin(thM));
  const deckY = path.yAt(sM) + height, half = 650;
  const deck = M.concrete(), pier = M.plaster(0xcfd3d8);
  for (let a = -half; a <= half; a += 30) {
    const x = pM.x + dir.x * a, z = pM.z + dir.z * a;
    const n = path.nearest(x, z);
    bat.box(deck, x, deckY, z, 9, 1.6, 30.4, -thM, true);                                                       // U-girder deck
    for (const o of [-4.2, 4.2]) bat.box(pier, x + side.x * o, deckY + 1.2, z + side.z * o, 0.3, 1.0, 30, -thM, false);  // parapets
    if (n.dist < 22) continue;                                                                                  // span over the tracks
    // over the road cutting: portal piers either side of the road instead of one in the middle
    const offs = cut && Math.abs(a) < cut.len + 10 ? [-(cut.halfW + 2.5), cut.halfW + 2.5] : [0];
    for (const o of offs) {
      const px = x + side.x * o, pz = z + side.z * o, gy = terrain ? terrain.heightAt(px, pz) : path.yAt(sM);
      bat.box(pier, px, (gy + deckY - 0.8) / 2, pz, 1.8, deckY - 0.8 - gy, 1.8, -thM, true);
    }
    bat.box(pier, x, deckY - 1.3, z, offs.length > 1 ? 2 * cut.halfW + 7 : 6.5, 1.0, 2.4, -thM + (offs.length > 1 ? Math.PI / 2 : 0), true);
  }
  for (const o of [-1.8, 1.8]) bat.box(M.steelDark(), pM.x + side.x * o, deckY + 0.9, pM.z + side.z * o, 0.12, 0.12, 2 * half, -thM, false); // running rails
  bat.box(M.textBoard('HYDERABAD METRO', { bg: '#d7263d', fg: '#ffffff', w: 512, h: 96, font: 'bold 52px Arial' }), pM.x, deckY - 0.2, pM.z, 9.2, 1.0, 6, -thM, false);
  const a = new THREE.Vector3(pM.x - dir.x * half, 0, pM.z - dir.z * half), b = new THREE.Vector3(pM.x + dir.x * half, 0, pM.z + dir.z * half);
  traffic?.push(new MetroTrain(g, a, b, deckY + 0.9));
}

export function buildSecunderabad(layout, plan, terrain, root, traffic) {
  const path = layout.path, g = new THREE.Group(), bat = new Batcher();
  // the other line beyond the junction (track, OHE) and the junction board
  const tb = new TrackChunkBuilder();
  for (const l of plan.sideLines) tb.addTrack(polylineFrames(l));
  tb.build(g);
  buildSideOHE(g, plan.sideLines, new THREE.Vector3(1e9, 0, 1e9));
  { const p = plan.sideLines[0][20], th = p.th;
    bat.box(M.textBoard(`${plan.oursKzj ? '' : '⬉ '}${plan.sideName}${plan.oursKzj ? ' ➚' : ''}`, { bg: '#f5c518', fg: '#111', w: 768, h: 160, font: 'bold 56px Arial' }), p.x, p.y + 3.2, p.z, 5.4, 1.2, 0.12, -th, true); }
  // --- Olifanta bridge
  const c = plan.cut, th = path.headingAt(plan.sOl), yT = c.y;
  for (const lat of [-6.2, -3.2, 3.2, 6.2]) { const p = path.pointAt(plan.sOl, lat, new THREE.Vector3()); bat.box(M.steelBlue(), p.x, yT - 1.0, p.z, 0.5, 1.6, 2 * c.halfW + 4, -th, true); } // plate girders
  for (const e of [-1, 1]) { // abutments / retaining walls along the cutting
    for (let a = -c.len; a <= c.len; a += 10) {
      const ramp = Math.min(1, Math.max(0, (c.len - Math.abs(a)) / 110)), depth = c.depth * ramp * ramp * (3 - 2 * ramp);
      if (depth < 0.4) continue;
      const x = c.x + c.F.x * e * (c.halfW + 0.4) + c.R.x * a, z = c.z + c.F.z * e * (c.halfW + 0.4) + c.R.z * a;
      bat.box(M.stonePitch ? M.stonePitch() : M.concrete(), x, yT - depth / 2, z, 0.7, depth, 10.2, -th + Math.PI / 2, false);
    }
  }
  const sideBoard = M.textBoard('OLIFANTA BRIDGE  •  SECUNDERABAD', { bg: '#f5c518', fg: '#111', w: 1024, h: 96, font: 'bold 46px Arial' });
  for (const e of [-1, 1]) { const p = path.pointAt(plan.sOl + e * (c.halfW + 0.2), 0, new THREE.Vector3()); bat.box(sideBoard, p.x, yT - 1.1, p.z, 9, 0.8, 0.08, -th, false); }
  // the road down the cutting (with traffic)
  const road = [];
  for (let a = -c.len - 40; a <= c.len + 40; a += 6) {
    const ramp = Math.min(1, Math.max(0, (c.len - Math.abs(a)) / 110)), depth = c.depth * ramp * ramp * (3 - 2 * ramp);
    const x = c.x + c.R.x * a, z = c.z + c.R.z * a;
    const y = Math.abs(a) > c.len ? (terrain ? terrain.heightAt(x, z) : yT) : yT - depth;
    road.push({ x, y: y + 0.06, z });
    bat.box(M.asphalt(), x, y - 0.02, z, 6, 0.12, 2 * c.halfW - 1, -th + Math.PI / 2, false);
  }
  traffic?.push(new RoadTraffic(g, road, { count: 8, laneOff: 2.2 }));
  // --- Hyderabad Metro: one viaduct along the Olifanta road (above the road, over the railway), one on the far side
  metro(path, plan.sMetro, Math.PI / 2, 15, bat, g, traffic, terrain, plan.cut);
  metro(path, plan.sMetro2, Math.PI / 2 - 0.35, 16.5, bat, g, traffic, terrain, null);
  g.add(bat.build());
  root.add(g);
  return g;
}
