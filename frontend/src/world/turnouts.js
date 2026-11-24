import * as THREE from 'three/webgpu';
import { TRACK } from '../config.js';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { GeoAccum, meshFrom } from './geoAccum.js';
import { Lane } from '../route/lane.js';

// Turnouts (points & crossings) wherever a track leaves a running line:
// platform-track fans at both station throats and every crossover. Each has
//  * two switch blades that physically move with the route that is set,
//  * a cast manganese crossing (frog) with check rails opposite,
//  * a point machine with drive + stretcher rods and a ground position light.

const HG = TRACK.RAIL_HALF_GAUGE;
const RAIL_BASE = TRACK.SLEEPER_Y + 0.105;
const BLADE = 11.5;   // switch blade length (m)
const THROW = 0.12;   // blade opening at the toe (m)
const THROW_TIME = 1.6;
const BLADE_PROFILE = [[0.03, 0], [-0.03, 0], [-0.03, 0.155], [0.03, 0.155], [0.03, 0]];
const CHECK_PROFILE = [[0.025, 0], [-0.025, 0], [-0.025, 0.13], [0.025, 0.13], [0.025, 0]];
const steelBright = (j, nx, ny) => (ny > 0.9 ? [0.95, 0.96, 0.98] : [0.45, 0.4, 0.36]);

let mats = null;
function tMats() {
  if (!mats) {
    mats = {
      frog: new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.85, roughness: 0.35 }),
      machine: new THREE.MeshStandardMaterial({ color: 0x3f5244, metalness: 0.4, roughness: 0.6 }),
      cover: new THREE.MeshStandardMaterial({ color: 0xc9b23a, metalness: 0.3, roughness: 0.5 }),
      lampOn: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 3 }),
      lampOff: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 })
    };
  }
  return mats;
}

export function computeTurnouts(layout) {
  const H = TRACK.MAIN_HALF;
  const list = [];
  const seen = new Set();
  const add = (lane, sToe, dir, parentOff, kind) => {
    const off = (d) => lane.at(sToe + dir * d) - parentOff;
    let side = 0, dF = null;
    for (let d = 0.5; d < 600; d += 0.5) {
      const o = off(d);
      if (!side && Math.abs(o) > 0.005) side = Math.sign(o);
      if (Math.abs(o) >= 2 * HG) { dF = d; break; }
    }
    if (!side || dF === null) return;
    const key = `${Math.round(sToe)}|${parentOff}|${side}|${dir}`;
    if (seen.has(key)) return;
    seen.add(key);
    const sFar = sToe + dir * (dF + 8);
    list.push({ lane, sToe, dir, parentOff, side, dF, off, kind, s0: Math.min(sToe, sFar) - 4, s1: Math.max(sToe, sFar) + 4, open: 0, target: 0, obj: null });
  };
  for (const st of layout.stations) {
    const L = st.layout;
    for (const t of L.tracks) {
      // ladder throats: each track's turnout is where it leaves / rejoins its neighbour
      if (t.fanEntry > 0) add(t.lane, L.pStart - t.joinEntry, 1, t.parentEntry, 'fan');
      if (t.fanExit > 0) add(t.lane, L.pEnd + t.joinExit, -1, t.parentExit, 'fan');
    }
    if (L.xoEntry) {
      const lane = new Lane(-H).add(L.xoEntry.s0, L.xoEntry.s1, -H, H);
      add(lane, L.xoEntry.s0, 1, -H, 'xo'); add(lane, L.xoEntry.s1, -1, H, 'xo');
    }
    if (L.xoExit) {
      const lane = new Lane(H).add(L.xoExit.s0, L.xoExit.s1, H, -H);
      add(lane, L.xoExit.s0, 1, H, 'xo'); add(lane, L.xoExit.s1, -1, -H, 'xo');
    }
  }
  return list;
}

// Frames along the route centre-line between distances d0..d1 from the toe,
// always ordered by increasing s so swept faces wind correctly.
function framesFor(path, T, d0, d1, step = 0.5) {
  const out = [];
  for (let d = d0; d <= d1 + 1e-6; d += step) {
    const s = T.sToe + T.dir * d;
    const p = path.pointAt(s, 0, _v);
    out.push({ x: p.x, y: path.yAt(s), z: p.z, th: path.headingAt(s), s, d });
  }
  return T.dir > 0 ? out : out.reverse();
}
const _v = new THREE.Vector3();

function bladeGeometry(path, T, open) {
  const acc = new GeoAccum(true);
  const frames = framesFor(path, T, 0, BLADE, 0.5);
  const { side, parentOff } = T;
  // straight blade: diverging side, lies against that stock rail when the straight route is set
  acc.sweep(frames, BLADE_PROFILE, {
    latFn: (f) => parentOff + side * (HG - 0.072) - side * open * THROW * (1 - f.d / BLADE),
    yOff: RAIL_BASE, color: steelBright
  });
  // curved blade: opposite side, follows the diverging route when it is set
  acc.sweep(frames, BLADE_PROFILE, {
    latFn: (f) => parentOff + T.off(f.d) - side * (HG - 0.072) + side * (1 - open) * THROW * (1 - f.d / BLADE),
    yOff: RAIL_BASE, color: steelBright
  });
  return acc.build();
}

export function buildTurnout(path, T) {
  const m = tMats();
  const g = new THREE.Group();
  const bat = new Batcher();
  const { side, parentOff, dF, dir } = T;
  const at = (d, lat) => { const s = T.sToe + dir * d; return { p: path.pointAt(s, lat, new THREE.Vector3()), th: path.headingAt(s), y: path.yAt(s) }; };

  // crossing (frog): cast nose where the diverging inner rail crosses the stock rail
  const angle = Math.atan2(Math.abs(T.off(dF + 1) - T.off(dF - 1)), 2);
  const f0 = at(dF + 0.8, parentOff + side * (HG - 0.05));
  bat.box(m.frog, f0.p.x, f0.y + RAIL_BASE + 0.015, f0.p.z, 0.46, 0.05, 3.6, -(f0.th + dir * side * angle / 2), false);
  // check rails opposite the crossing, on both routes
  const checks = new GeoAccum(true);
  const cf = framesFor(path, T, Math.max(0, dF - 3.5), dF + 3.5, 0.5);
  checks.sweep(cf, CHECK_PROFILE, { latFn: () => parentOff - side * (HG - 0.07), yOff: RAIL_BASE, color: steelBright });
  checks.sweep(cf, CHECK_PROFILE, { latFn: (f) => parentOff + T.off(f.d) + side * (HG - 0.07), yOff: RAIL_BASE, color: steelBright });
  const cm = meshFrom(checks, M.rail());
  if (cm) g.add(cm);

  // point machine beside the toe, drive rod + stretcher bars across the blades
  const pm = at(1.6, parentOff - side * (HG + 1.25));
  bat.box(m.machine, pm.p.x, pm.y + 0.42, pm.p.z, 0.6, 0.42, 1.25, -pm.th, true);
  bat.box(m.cover, pm.p.x, pm.y + 0.65, pm.p.z, 0.62, 0.05, 1.27, -pm.th, false);
  for (const [d, len, y] of [[0.45, 2 * HG + 1.5, 0.5], [0.45, 2 * HG - 0.1, 0.47], [2.7, 2 * HG - 0.1, 0.47]]) {
    const r = at(d, parentOff - side * (len - 2 * HG + 0.1) / 2);
    bat.box(M.steelDark(), r.p.x, r.y + y, r.p.z, len, 0.05, 0.07, -r.th, false);
  }
  // ground position-light signal at the toe showing the set route
  const gl = at(-6, parentOff - side * (HG + 1.4));
  bat.box(M.black(), gl.p.x, gl.y + 0.28, gl.p.z, 0.45, 0.7, 0.2, -gl.th, true);
  g.add(bat.build());
  const lamps = [];
  for (const [dx, dy] of [[-0.12, 0.5], [0.12, 0.5], [side * 0.12, 0.24]]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.055, 10), m.lampOff);
    const r = side * dx;
    const back = dir > 0 ? -0.105 : 0.105; // face of the box toward approaching trains
    lamp.position.set(gl.p.x + Math.cos(gl.th) * r + Math.sin(gl.th) * back, gl.y + dy, gl.p.z + Math.sin(gl.th) * r - Math.cos(gl.th) * back);
    lamp.rotation.y = -gl.th + (dir > 0 ? 0 : Math.PI);
    lamp.userData.disposable = true;
    g.add(lamp);
    lamps.push(lamp);
  }
  const blades = new THREE.Mesh(bladeGeometry(path, T, T.open), M.rail());
  blades.receiveShadow = true;
  blades.userData.disposable = true;
  g.add(blades);
  g.userData = { blades, lamps };
  setLamps(T, lamps);
  return g;
}

function setLamps(T, lamps) {
  const m = tMats();
  // two whites horizontal = straight; diagonal pair = diverging
  lamps[0].material = m.lampOn;
  lamps[1].material = T.target ? m.lampOff : m.lampOn;
  lamps[2].material = T.target ? m.lampOn : m.lampOff;
}

export class TurnoutManager {
  constructor(layout, root) {
    this.layout = layout;
    this.root = root;
    this.list = computeTurnouts(layout);
  }

  // Which way should each turnout lie for the player's route?
  _target(T, playerLane) {
    const d = Math.min(T.dF, 30);
    const s = T.sToe + T.dir * d;
    const onDiverging = Math.abs(playerLane.at(s) - T.lane.at(s)) < 0.25;
    const isOff = Math.abs(T.lane.at(s) - T.parentOff) > 0.2;
    return onDiverging && isOff ? 1 : 0;
  }

  update(sFocus, playerLane, dt, onThrow) {
    for (const T of this.list) {
      const near = T.s1 > sFocus - 700 && T.s0 < sFocus + 3400;
      if (near && !T.obj) {
        T.target = this._target(T, playerLane);
        T.open = T.target; // already lying correctly when it streams in
        T.obj = buildTurnout(this.layout.path, T);
        this.root.add(T.obj);
      } else if (!near && T.obj) {
        T.obj.traverse((o) => { if (o.userData?.disposable && o.geometry) o.geometry.dispose(); });
        T.obj.removeFromParent();
        T.obj = null;
        continue;
      }
      if (!T.obj) continue;
      const target = this._target(T, playerLane);
      if (target !== T.target) {
        T.target = target;
        setLamps(T, T.obj.userData.lamps);
        if (onThrow) onThrow(T);
      }
      if (T.open !== T.target) {
        const step = dt / THROW_TIME;
        T.open = T.target > T.open ? Math.min(T.target, T.open + step) : Math.max(T.target, T.open - step);
        const bl = T.obj.userData.blades;
        bl.geometry.dispose();
        bl.geometry = bladeGeometry(this.layout.path, T, T.open);
      }
    }
  }

  // Blades not yet fully thrown for the route the player is about to run over.
  pointsMoving(sFront, ahead = 400) {
    return this.list.some((T) => T.obj && T.open !== T.target && T.s0 < sFront + ahead && T.s1 > sFront);
  }

  dispose() {
    for (const T of this.list) if (T.obj) { T.obj.traverse((o) => { if (o.userData?.disposable && o.geometry) o.geometry.dispose(); }); T.obj.removeFromParent(); T.obj = null; }
  }
}
