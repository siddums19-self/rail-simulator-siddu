import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { GeoAccum, meshFrom } from './geoAccum.js';
import { TRACK } from '../config.js';
import { Lane } from '../route/lane.js';

// Builds the twin Krishna bridges ~2 km before Vijayawada Jn for trains coming from Guntur/Krishna Canal:
//  * Two separate parallel bridges separated by a short gap (±4.8 m, ~9.6 m centres).
//  * Classic steel Warren/Pratt through-truss spans on concrete/masonry river piers.
export function buildKrishnaBridges(root, layout) {
  const k = layout.krishna;
  if (!k) return;
  const path = layout.path;
  const group = new THREE.Group();
  const bat = new Batcher();
  const deckGeo = new GeoAccum(false);

  const sBridge0 = k.sMid - k.riverWidth / 2 - 15;
  const sBridge1 = k.sMid + k.riverWidth / 2 + 15;
  const spanLen = 78;
  const nSpans = Math.max(10, Math.round((sBridge1 - sBridge0) / spanLen));
  const actualSpan = (sBridge1 - sBridge0) / nSpans;

  const leftLane = new Lane(-TRACK.MAIN_HALF)
    .add(k.s0, k.s0 + k.ramp, -TRACK.MAIN_HALF, -k.halfSep)
    .add(k.s0 + k.ramp, k.s1 - k.ramp, -k.halfSep, -k.halfSep)
    .add(k.s1 - k.ramp, k.s1, -k.halfSep, -TRACK.MAIN_HALF);

  const rightLane = new Lane(TRACK.MAIN_HALF)
    .add(k.s0, k.s0 + k.ramp, TRACK.MAIN_HALF, k.halfSep)
    .add(k.s0 + k.ramp, k.s1 - k.ramp, k.halfSep, k.halfSep)
    .add(k.s1 - k.ramp, k.s1, k.halfSep, TRACK.MAIN_HALF);

  const v = new THREE.Vector3();

  // Two separate decks (3.3 m half-width each -> ~3 m clear air gap between the twin bridges)
  for (const lane of [leftLane, rightLane]) {
    const frames = [];
    for (let s = k.s0; s <= k.s1 + 0.01; s += 8) {
      path.pointAt(s, lane.at(s), v);
      frames.push({ x: v.x, y: path.yAt(s), z: v.z, th: path.headingAt(s), s, gy: path.groundAt(s) });
    }
    const hw = 3.3;
    deckGeo.sweep(
      frames,
      [[-hw, -0.45], [-hw, -0.02], [hw, -0.02], [hw, -0.45], [hw - 0.7, -1.5], [-(hw - 0.7), -1.5], [-hw, -0.45]],
      { uScale: 0.25, vScale: 0.25 }
    );
    for (const side of [-1, 1]) {
      const o = side * (hw - 0.14);
      deckGeo.sweep(frames, [[o - 0.12, 0], [o - 0.12, 0.95], [o + 0.12, 0.95], [o + 0.12, 0]], { uScale: 0.25, vScale: 0.25 });
    }
  }

  const dm = meshFrom(deckGeo, M.viaduct(), { cast: true });
  if (dm) group.add(dm);

  const trussMat = M.galvanised();
  const darkSteel = M.steelDark();
  const pierMat = M.viaduct();

  // Separate river piers under each bridge
  for (let i = 0; i <= nSpans; i++) {
    const s = sBridge0 + i * actualSpan;
    const y = path.yAt(s), gy = path.groundAt(s) - 1.5;
    const th = path.headingAt(s);
    const topY = y - 1.5;
    const h = Math.max(4, topY - gy);
    for (const lat of [-k.halfSep, k.halfSep]) {
      path.pointAt(s, lat, v);
      bat.box(pierMat, v.x, gy + h / 2, v.z, 3.0, h, 3.6, -th);
      bat.box(pierMat, v.x, topY - 0.3, v.z, 5.6, 0.6, 4.2, -th);
    }
  }

  // Twin steel through-truss bridges (one for each track)
  const trussH = 9.2;
  const bays = 8;
  const bayLen = actualSpan / bays;
  for (const centerLat of [-k.halfSep, k.halfSep]) {
    for (let i = 0; i < nSpans; i++) {
      const sa = sBridge0 + i * actualSpan;
      for (const side of [-1, 1]) {
        const lat = centerLat + side * 2.95;
        const smid = sa + actualSpan / 2;
        const yMid = path.yAt(smid);
        const thMid = path.headingAt(smid);
        path.pointAt(smid, lat, v);
        bat.box(trussMat, v.x, yMid + trussH, v.z, 0.42, 0.46, actualSpan - 1.2, -thMid, true);
        bat.box(darkSteel, v.x, yMid + 0.22, v.z, 0.42, 0.4, actualSpan - 1.2, -thMid, false);
        for (let b = 0; b <= bays; b++) {
          const sk = sa + b * bayLen;
          const yk = path.yAt(sk);
          const th = path.headingAt(sk);
          path.pointAt(sk, lat, v);
          bat.box(trussMat, v.x, yk + trussH / 2, v.z, 0.28, trussH, 0.28, -th, true);
          if (b < bays) {
            const sNext = sk + bayLen / 2;
            const diagLen = Math.hypot(bayLen, trussH);
            const diagPitch = (b % 2 === 0 ? 1 : -1) * Math.atan2(trussH, bayLen);
            path.pointAt(sNext, lat, v);
            bat.box(trussMat, v.x, yk + trussH / 2, v.z, 0.22, 0.22, diagLen, -path.headingAt(sNext), true, diagPitch, 0);
          }
        }
      }
      for (let b = 0; b <= bays; b += 2) {
        const sk = sa + b * bayLen;
        path.pointAt(sk, centerLat, v);
        bat.box(trussMat, v.x, path.yAt(sk) + trussH, v.z, 6.0, 0.34, 0.34, -path.headingAt(sk), false);
      }
    }
  }

  group.add(bat.build());
  root.add(group);
}
