import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';

// Hyderabad (Begumpet) airport beside the MMTS line, just past Fatehnagar towards Lingampalli, on the right
// when travelling towards Lingampalli (so on the left on the way back). Runway along the line, terminal,
// control tower, hangars and a few parked aircraft. Returns null when the route doesn't pass there.
export function planAirport(layout) {
  const st = layout.stations, i = st.findIndex((s) => s.code === 'FTNR');
  const j = st.findIndex((s) => s.code === 'LPI');
  if (i < 0 || j < 0) return null;
  const k = j > i ? i + 1 : i - 1;                      // the next station towards Lingampalli
  if (!st[k]) return null;
  const sA = j > i ? st[i].layout.pEnd : st[i].layout.pStart, sB = j > i ? st[k].layout.pStart : st[k].layout.pEnd;
  const s = (sA + sB) / 2, dirToLPI = j > i ? 1 : -1;
  const side = dirToLPI;                                  // right of travel towards LPI: +lat when running +s
  const lat = side * 330;
  const p = layout.path.pointAt(s, lat, new THREE.Vector3());
  return { s, lat, side, x: p.x, z: p.z, th: layout.path.headingAt(s) };
}

export function buildAirport(layout, plan, terrain) {
  const g = new THREE.Group(), bat = new Batcher();
  const path = layout.path, { s, lat, side } = plan;
  const y0 = terrain ? terrain.heightAt(plan.x, plan.z) : path.yAt(s);
  const P = (ds, dl, up = 0) => { const p = path.pointAt(s + ds, lat + dl * side, new THREE.Vector3()); p.y = y0 + up; return p; };
  const yaw = -path.headingAt(s);
  const asphalt = M.asphalt(), white = M.white(), concrete = M.concrete();
  const at = (mat, ds, dl, up, w, h, d, cast = true) => { const p = P(ds, dl, up); bat.box(mat, p.x, p.y, p.z, w, h, d, yaw, cast); };
  // runway with centre-line and threshold markings, taxiway, apron
  at(asphalt, 0, 0, 0.12, 46, 0.2, 1500, false);
  for (let d = -680; d <= 680; d += 60) at(white, d, 0, 0.24, 0.9, 0.04, 30, false);
  for (const e of [-1, 1]) for (let k = -4; k <= 4; k++) at(white, e * 720, k * 4.5, 0.24, 2, 0.04, 30, false);
  at(asphalt, 0, 120, 0.1, 24, 0.18, 1300, false);                    // parallel taxiway
  for (const d of [-400, 0, 400]) at(asphalt, d, 60, 0.1, 100, 0.18, 22, false);
  at(concrete, 60, 230, 0.1, 160, 0.18, 420, false);                  // apron
  // terminal: glass and steel, with a curved roof and the name
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a5d8f, metalness: 0.6, roughness: 0.12 });
  at(glass, 60, 330, 7, 40, 14, 300);
  at(M.plaster(0xd7dbe0), 60, 330, 15, 52, 1.4, 320);
  bat.box(M.textBoard('HYDERABAD AIRPORT • BEGUMPET', { bg: '#0b3d91', fg: '#ffffff', w: 1024, h: 128, font: 'bold 52px Arial' }), ...P(60, 309, 12).toArray(), 0.2, 3, 80, yaw, false);
  // control tower
  { const p = P(-260, 270); bat.cyl(concrete, p.x, y0 + 16, p.z, 3, 3.6, 32, 16); bat.cyl(glass, p.x, y0 + 35, p.z, 6, 5, 6, 16); bat.cyl(M.plaster(0xeeeeee), p.x, y0 + 38.5, p.z, 6.8, 6.8, 1, 16); }
  // hangars
  for (const d of [-520, -420]) { at(M.plaster(0xb8bec6), d, 300, 9, 60, 18, 70); at(M.plaster(0x8a929c), d, 300, 18.5, 62, 1, 72); }
  // parked aircraft on the apron and one on the runway
  const plane = (ds, dl, rot = 0) => {
    const c = P(ds, dl, 3.2), body = M.plaster(0xf4f6f8), tail = M.plaster(0x1f4fbf);
    const q = yaw + rot;
    bat.cyl(body, c.x, c.y, c.z, 2, 2, 34, 14, Math.PI / 2, q, 0);                      // fuselage
    bat.box(body, c.x, c.y - 0.6, c.z, 32, 0.5, 5, q, true);                            // wings
    const f = (o) => new THREE.Vector3(Math.sin(-q) * o, 0, -Math.cos(-q) * o);
    const tp = c.clone().add(f(-15));
    bat.box(tail, tp.x, tp.y + 3.5, tp.z, 0.5, 6, 4, q, true);                          // fin
    bat.box(body, tp.x, tp.y + 0.5, tp.z, 11, 0.4, 3, q, true);                         // tailplane
    const np = c.clone().add(f(17)); bat.cyl(M.plaster(0x22262b), np.x, np.y + 0.6, np.z, 1.3, 1.6, 2, 10, Math.PI / 2, q, 0); // cockpit
  };
  plane(-60, 225, Math.PI / 2); plane(20, 225, Math.PI / 2); plane(100, 225, Math.PI / 2); plane(180, 225, Math.PI / 2);
  plane(-500, 0, 0);
  // perimeter fence along the railway side
  for (let d = -760; d <= 760; d += 8) at(M.steelDark(), d, -70, 1.2, 0.08, 2.4, 0.08, false);
  at(M.steelDark(), 0, -70, 2.3, 0.05, 0.05, 1520, false);
  g.add(bat.build());
  return g;
}
