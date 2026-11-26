import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { GeoAccum, meshFrom } from './geoAccum.js';
import { TRACK } from '../config.js';
import { Lane } from '../route/lane.js';

// Builds the twin Godavari bridges after Rajahmundry towards Visakhapatnam:
//  * The two tracks widen to 70 m apart (-35 m left, +35 m right).
//  * Left bridge (-35 m): Godavari Bowstring Arch Bridge (13 x 100 m concrete/steel arches).
//  * Right bridge (+35 m): Godavari Steel Through-Truss Bridge (13 x 100 m Warren truss spans).
export function buildGodavariBridges(root, layout) {
  const g = layout.godavari;
  if (!g) return;
  const path = layout.path;
  const group = new THREE.Group();
  const bat = new Batcher();
  const deckGeo = new GeoAccum(false);

  const sBridge0 = g.sMid - g.riverWidth / 2 - 20;
  const sBridge1 = g.sMid + g.riverWidth / 2 + 20;
  const spanLen = 100;
  const nSpans = Math.max(12, Math.round((sBridge1 - sBridge0) / spanLen));
  const actualSpan = (sBridge1 - sBridge0) / nSpans;

  const leftLane = new Lane(-TRACK.MAIN_HALF)
    .add(g.s0, g.s0 + g.ramp, -TRACK.MAIN_HALF, -g.halfSep)
    .add(g.s0 + g.ramp, g.s1 - g.ramp, -g.halfSep, -g.halfSep)
    .add(g.s1 - g.ramp, g.s1, -g.halfSep, -TRACK.MAIN_HALF);

  const rightLane = new Lane(TRACK.MAIN_HALF)
    .add(g.s0, g.s0 + g.ramp, TRACK.MAIN_HALF, g.halfSep)
    .add(g.s0 + g.ramp, g.s1 - g.ramp, g.halfSep, g.halfSep)
    .add(g.s1 - g.ramp, g.s1, g.halfSep, TRACK.MAIN_HALF);

  const v = new THREE.Vector3();

  // Separate concrete decks + parapets + river piers for both tracks across the full widened zone [s0, s1]
  for (const [lane, halfW] of [[leftLane, 3.8], [rightLane, 4.0]]) {
    const frames = [];
    for (let s = g.s0; s <= g.s1 + 0.01; s += 8) {
      const lat = lane.at(s);
      path.pointAt(s, lat, v);
      frames.push({ x: v.x, y: path.yAt(s), z: v.z, th: path.headingAt(s), s, gy: path.groundAt(s) });
    }
    deckGeo.sweep(
      frames,
      [[-halfW, -0.5], [-halfW, -0.02], [halfW, -0.02], [halfW, -0.5], [halfW - 0.9, -1.7], [-(halfW - 0.9), -1.7], [-halfW, -0.5]],
      { uScale: 0.25, vScale: 0.25 }
    );
    for (const side of [-1, 1]) {
      const o = side * (halfW - 0.16);
      deckGeo.sweep(frames, [[o - 0.14, 0], [o - 0.14, 1.05], [o + 0.14, 1.05], [o + 0.14, 0]], { uScale: 0.25, vScale: 0.25 });
    }
    // Approach piers on the ramps outside the main river spans
    for (let s = g.s0 + 80; s < sBridge0 - 15; s += 32) {
      const lat = lane.at(s), y = path.yAt(s), gy = path.groundAt(s);
      if (y - gy < 1.2) continue;
      path.pointAt(s, lat, v);
      const th = path.headingAt(s);
      const topY = y - 1.7, botY = gy - 0.8;
      bat.box(M.viaduct(), v.x, (topY + botY) / 2, v.z, 2.4, topY - botY, 2.2, -th);
    }
    for (let s = sBridge1 + 32; s < g.s1 - 60; s += 32) {
      const lat = lane.at(s), y = path.yAt(s), gy = path.groundAt(s);
      if (y - gy < 1.2) continue;
      path.pointAt(s, lat, v);
      const th = path.headingAt(s);
      const topY = y - 1.7, botY = gy - 0.8;
      bat.box(M.viaduct(), v.x, (topY + botY) / 2, v.z, 2.4, topY - botY, 2.2, -th);
    }
  }

  const dm = meshFrom(deckGeo, M.viaduct(), { cast: true });
  if (dm) group.add(dm);

  const archMat = M.concrete();
  const trussMat = M.galvanised();
  const darkSteel = M.steelDark();
  const pierMat = M.viaduct();

  // River piers at every span boundary for both bridges
  for (let i = 0; i <= nSpans; i++) {
    const s = sBridge0 + i * actualSpan;
    const y = path.yAt(s), gy = path.groundAt(s) - 1.5;
    const th = path.headingAt(s);
    const topY = y - 1.7;
    const h = Math.max(4, topY - gy);
    for (const lat of [-g.halfSep, g.halfSep]) {
      path.pointAt(s, lat, v);
      bat.box(pierMat, v.x, gy + h / 2, v.z, 3.6, h, 4.2, -th);
      bat.box(pierMat, v.x, topY - 0.35, v.z, 6.8, 0.7, 4.8, -th);
    }
  }

  // ---- 1. LEFT BRIDGE (-35 m): Godavari Bowstring Arch Bridge
  const archH = 14.5;
  const archSegs = 12;
  for (let i = 0; i < nSpans; i++) {
    const sa = sBridge0 + i * actualSpan;
    for (const side of [-1, 1]) {
      const lat = -g.halfSep + side * 3.15;
      // Parabolic arch rib segments
      for (let k = 0; k < archSegs; k++) {
        const t0 = k / archSegs, t1 = (k + 1) / archSegs;
        const tm = (t0 + t1) / 2;
        const sm = sa + tm * actualSpan;
        const y0 = path.yAt(sa + t0 * actualSpan) + archH * 4 * t0 * (1 - t0);
        const y1 = path.yAt(sa + t1 * actualSpan) + archH * 4 * t1 * (1 - t1);
        const ds = actualSpan / archSegs;
        const dy = y1 - y0;
        const segLen = Math.hypot(ds, dy) + 0.15;
        const pitch = Math.atan2(dy, ds);
        const th = path.headingAt(sm);
        path.pointAt(sm, lat, v);
        bat.box(archMat, v.x, (y0 + y1) / 2 + 0.5, v.z, 0.75, 0.95, segLen, -th, true, pitch, 0);
      }
      // Vertical suspender hangers
      for (let k = 1; k < archSegs; k++) {
        const t = k / archSegs;
        const sk = sa + t * actualSpan;
        const yDeck = path.yAt(sk);
        const hArch = archH * 4 * t * (1 - t);
        if (hArch < 1.0) continue;
        path.pointAt(sk, lat, v);
        bat.box(darkSteel, v.x, yDeck + hArch / 2 + 0.3, v.z, 0.14, hArch, 0.14, -path.headingAt(sk), false);
      }
    }
    // Overhead cross-bracing between left & right arch ribs
    for (let k = 3; k <= archSegs - 3; k += 2) {
      const t = k / archSegs;
      const sk = sa + t * actualSpan;
      const yTop = path.yAt(sk) + archH * 4 * t * (1 - t) + 0.5;
      path.pointAt(sk, -g.halfSep, v);
      bat.box(archMat, v.x, yTop, v.z, 6.4, 0.45, 0.45, -path.headingAt(sk), false);
    }
  }

  // ---- 2. RIGHT BRIDGE (+35 m): Godavari Steel Through-Truss Bridge
  const trussH = 10.5;
  const bays = 10;
  const bayLen = actualSpan / bays;
  for (let i = 0; i < nSpans; i++) {
    const sa = sBridge0 + i * actualSpan;
    for (const side of [-1, 1]) {
      const lat = g.halfSep + side * 3.45;
      // Top & bottom chords
      const smid = sa + actualSpan / 2;
      const yMid = path.yAt(smid);
      const thMid = path.headingAt(smid);
      path.pointAt(smid, lat, v);
      bat.box(trussMat, v.x, yMid + trussH, v.z, 0.48, 0.52, actualSpan - 1.5, -thMid, true);
      bat.box(darkSteel, v.x, yMid + 0.25, v.z, 0.48, 0.45, actualSpan - 1.5, -thMid, false);
      // Vertical posts & Warren diagonal members
      for (let k = 0; k <= bays; k++) {
        const sk = sa + k * bayLen;
        const yk = path.yAt(sk);
        const th = path.headingAt(sk);
        path.pointAt(sk, lat, v);
        bat.box(trussMat, v.x, yk + trussH / 2, v.z, 0.32, trussH, 0.32, -th, true);
        if (k < bays) {
          const sNext = sk + bayLen / 2;
          const diagLen = Math.hypot(bayLen, trussH);
          const diagPitch = (k % 2 === 0 ? 1 : -1) * Math.atan2(trussH, bayLen);
          path.pointAt(sNext, lat, v);
          bat.box(trussMat, v.x, yk + trussH / 2, v.z, 0.24, 0.24, diagLen, -path.headingAt(sNext), true, diagPitch, 0);
        }
      }
    }
    // Overhead portal & sway cross-bracing
    for (let k = 0; k <= bays; k += 2) {
      const sk = sa + k * bayLen;
      const yk = path.yAt(sk);
      path.pointAt(sk, g.halfSep, v);
      bat.box(trussMat, v.x, yk + trussH, v.z, 7.0, 0.38, 0.38, -path.headingAt(sk), false);
    }
  }

  group.add(bat.build());
  root.add(group);
}
