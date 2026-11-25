import { TRACK } from '../config.js';
import { Lane } from './lane.js';

// Builds the cross-section of a station: every platform face gets its own
// track; tracks fan out from the running lines through proper turnouts in the
// throat (never through a platform), and double-line stations carry
// crossovers so a train on the Up main can reach any platform.
//
// Pattern (left -> right): PF1 | T1 T2 | PF2·PF3 | T3 T4 | PF4·PF5 | ...
// Odd tracks have their platform on the left, even tracks on the right.

const SIDE_W = 7.5;
const ISLAND_W = 9.5;
const PAIR = TRACK.MAIN_HALF * 2;
const EDGE = TRACK.PLATFORM_EDGE;
export const XO_LEN = 95;

export function fanLength(delta) {
  const d = Math.abs(delta);
  if (d < 0.01) return 0;
  return Math.min(440, Math.max(95, 60 + 11.5 * d));
}

export function platformLength(n) {
  if (n >= 6) return 560;
  if (n >= 3) return 440;
  return 320;
}

// variant (small double-line stations): 'two' = just the Up/Down mains serving the two
// platforms; 'loop1' = mains + one platform loop; default = loops both sides + goods loop.
// goodsLoops: extra goods loops beyond the last platform at big stations (stabled goods trains).
// entryBranches / exitBranches: { sign, targets } — at a junction station the tracks on
// one side run straight on into separate lines (e.g. Guntakal: Gooty Down/Up + goods line)
// instead of all funnelling into the single running line.
// maxLen: compact throat (Guntakal's east end) — the whole ladder is squeezed into maxLen metres.
function buildLadder(tracks, key, maxLen = null) {
  const segKey = key === 'Exit' ? 'exitSegs' : 'entrySegs';
  const groups = new Map();
  for (const t of tracks) {
    const m = t['m' + key], d = t.o - m;
    if (Math.abs(d) < 0.01) { t[segKey] = []; t['fan' + key] = 0; continue; }
    const k = `${m}|${Math.sign(d)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  for (const [k, g] of groups) {
    const m = Number(k.split('|')[0]);
    g.sort((a, b) => Math.abs(a.o - m) - Math.abs(b.o - m));
    const own = [];
    let cur = 0;
    for (let i = g.length - 1; i >= 0; i--) {
      const parent = i > 0 ? g[i - 1].o : m;
      const L = fanLength(g[i].o - parent);
      own[i] = [cur, cur + L, g[i].o, parent];
      cur += L + 6;
    }
    if (maxLen && cur - 6 > maxLen) { // steeper turnouts, closer together
      const k = maxLen / (cur - 6);
      for (const o of own) { o[0] *= k; o[1] *= k; }
    }
    g.forEach((t, i) => {
      const chain = [];
      for (let j = i; j >= 0; j--) chain.push(own[j]);
      t[segKey] = chain;                         // distances from the platform end, increasing
      t['fan' + key] = own[0][1];                // where the chain reaches the running line
      t['join' + key] = own[i][1];               // where this track meets its neighbour
      t['parent' + key] = own[i][3];
      t['root' + key] = i === 0;
    });
  }
}

// Lane transitions for a train using track t through this station.
export function addTrackEntry(lane, layout, t) {
  for (const [d0, d1, a, b] of t.entrySegs || []) lane.add(layout.pStart - d1, layout.pStart - d0, b, a);
  return lane;
}
export function addTrackExit(lane, layout, t) {
  for (const [d0, d1, a, b] of t.exitSegs || []) lane.add(layout.pEnd + d0, layout.pEnd + d1, a, b);
  return lane;
}

// Guntakal: from the Gooty-side lines back across to the Dhone line (a ladder of
// crossovers just beyond the throat), so every platform can reach Dhone.
// (distances past the station boundary; finished before the Dhone line starts to curve away)
export const GTL_LADDER = [[20, 95, 16.6, 11.3], [100, 170, 11.3, 6.0], [175, 240, 6.0, 0]];
export function addBranchConnectors(lane, layout, t, { entry = true, exit = true } = {}) {
  if (exit && t.branchExit) {
    const sg = Math.sign(t.mExit), lat = Math.abs(t.mExit);
    for (const [a0, a1, l0, l1] of GTL_LADDER) if (l0 <= lat + 0.01) lane.add(layout.zoneEnd + a0, layout.zoneEnd + a1, sg * l0, sg * l1);
  }
  if (entry && t.branchEntry) {
    const sg = Math.sign(t.mEntry), lat = Math.abs(t.mEntry);
    for (const [a0, a1, l0, l1] of GTL_LADDER) if (l0 <= lat + 0.01) lane.add(layout.zoneStart - a1, layout.zoneStart - a0, sg * l1, sg * l0);
  }
  return lane;
}

// frameOffset / entryBase / exitBase: Guntakal on the Gooty route is built exactly as on the Dhone
// route (the Dhone line as the station's running line) and then moved sideways so that the Gooty
// line sits under our path; base is where the Dhone line ends up on that side.
export function makeStationLayout({ platforms, entryLine, exitLine, mirror = false, variant = null, goodsLoops = 0, entryBranches = null, exitBranches = null, compactEntry = null, compactExit = null, frameOffset = 0, entryBase = 0, exitBase = 0, noXoEntry = false, noXoExit = false }) {
  const doubleAny = entryLine === 'D' || exitLine === 'D';
  let N = Math.max(1, platforms | 0);
  if (doubleAny && N < 2) N = 2;
  const visibleN = Math.min(N, 12); // render cap for huge termini (e.g. HWH 23)

  // 1. Lay out structures left to right.
  const elements = [];
  const tracks = [];
  let x = 0;
  let prev = 'P';
  const addPlatform = (type, faces, w) => {
    elements.push({ kind: 'P', type, faces, l0: x + (prev === 'T' ? EDGE : 0), l1: x + (prev === 'T' ? EDGE : 0) + w });
    x = elements[elements.length - 1].l1;
    prev = 'P';
  };
  const addTrack = (pf, pfSide, role) => {
    const o = prev === 'P' ? x + EDGE : x + PAIR;
    tracks.push({ no: tracks.length + 1, pf, o, pfSide, role });
    x = o; prev = 'T';
  };
  const small = N <= 2;
  if (small && doubleAny && variant === 'two') {
    // Wayside halt: the two running lines serve the two platforms directly.
    addPlatform('side', [1], SIDE_W);
    addTrack(1, 'left', 'main');
    addTrack(2, 'right', 'main');
    addPlatform('side', [2], SIDE_W);
  } else if (small && doubleAny && variant === 'loop1') {
    // Small station: Up/Down mains plus one platform loop.
    addPlatform('side', [1], SIDE_W);
    addTrack(1, 'left', 'loop');
    addTrack(null, null, 'main');
    addTrack(2, 'right', 'main');
    addPlatform('side', [2], SIDE_W);
  } else if (small && doubleAny) {
    // Small double-line station: platform loops on both sides, a goods loop,
    // and the Up/Down main lines running straight through without platforms.
    addPlatform('side', [1], SIDE_W);
    addTrack(1, 'left', 'loop');
    addTrack(null, null, 'goods');
    addTrack(null, null, 'main');
    addTrack(null, null, 'main');
    addTrack(2, 'right', 'loop');
    addPlatform('side', [2], SIDE_W);
  } else if (small && N === 2) {
    // Small single-line crossing station: two platform loops either side of the main + a goods loop.
    addPlatform('side', [1], SIDE_W);
    addTrack(1, 'left', 'loop');
    addTrack(null, null, 'main');
    addTrack(null, null, 'goods');
    addTrack(2, 'right', 'loop');
    addPlatform('side', [2], SIDE_W);
  } else {
    addPlatform('side', [1], SIDE_W);
    for (let k = 1; k <= visibleN; k++) {
      addTrack(k, k % 2 === 1 ? 'left' : 'right', 'platform');
      if (k % 2 === 0) {
        if (k === visibleN) addPlatform('side', [k], SIDE_W);
        else addPlatform('island', [k, k + 1], ISLAND_W);
      }
    }
    // an odd last track has open ground on its right: add a goods loop there
    if (visibleN % 2 === 1 && visibleN >= 3) addTrack(null, null, 'goods');
    // goods loops for stabled / stalled goods trains beyond the last platform
    if (goodsLoops > 0) {
      x += 3; prev = 'T';
      for (let k = 0; k < goodsLoops; k++) addTrack(null, null, 'goods');
    }
  }

  // 2. Choose through tracks and shift so they sit on the running lines.
  let shift;
  let throughNos;
  const mains = tracks.filter((t) => t.role === 'main');
  if (mains.length === 2) {
    shift = -(mains[0].o + mains[1].o) / 2;
    throughNos = [mains[0].no, mains[1].no];
  } else if (mains.length === 1) {
    shift = -mains[0].o;
    throughNos = [mains[0].no];
  } else if (doubleAny) {
    const totalCentre = x / 2;
    let best = null;
    for (let i = 0; i + 1 < tracks.length; i++) {
      if (Math.abs(tracks[i + 1].o - tracks[i].o - PAIR) > 0.01) continue; // adjacent pair, no platform between
      if (tracks[i].role === 'goods' || tracks[i + 1].role === 'goods') continue;
      const c = (tracks[i].o + tracks[i + 1].o) / 2;
      if (!best || Math.abs(c - totalCentre) < Math.abs(best.c - totalCentre)) best = { i, c };
    }
    shift = -best.c;
    throughNos = [tracks[best.i].no, tracks[best.i + 1].no];
  } else {
    const centre = x / 2;
    let best = tracks[0];
    for (const t of tracks) if (t.role !== 'goods' && Math.abs(t.o - centre) < Math.abs(best.o - centre) - 0.01) best = t;
    shift = -best.o;
    throughNos = [best.no];
  }
  for (const t of tracks) t.o += shift;
  for (const e of elements) { e.l0 += shift; e.l1 += shift; }
  // mirrored stations number platforms from the right (e.g. Guntakal facing Gooty: PF7 left, PF1 right)
  if (mirror) {
    for (const t of tracks) { t.o = -t.o; t.pfSide = t.pfSide === 'left' ? 'right' : t.pfSide === 'right' ? 'left' : null; }
    for (const e of elements) { const a = -e.l1, b = -e.l0; e.l0 = a; e.l1 = b; }
  }
  // sideways move of the whole station (after mirroring, so it is in our route's frame)
  if (frameOffset) {
    for (const t of tracks) t.o += frameOffset;
    for (const e of elements) { e.l0 += frameOffset; e.l1 += frameOffset; }
  }

  // 3. Fan targets for each throat side.
  const mainFor = (o, line, base = 0) => {
    if (line === 'S') return base;
    return o < 0 ? -TRACK.MAIN_HALF : TRACK.MAIN_HALF;
  };
  let maxFanEntry = 0, maxFanExit = 0;
  const branchTargets = (br, key) => {
    if (!br) return new Map();
    const base = br.base || 0;
    const side = tracks.filter((t) => (t.o - base) * br.sign > 3).sort((a, c) => (a.o - c.o) * br.sign);
    const m = new Map();
    side.forEach((t, i) => m.set(t.no, base + br.sign * br.targets[Math.min(i, br.targets.length - 1)]));
    return m;
  };
  const bEntry = branchTargets(entryBranches), bExit = branchTargets(exitBranches);
  for (const t of tracks) {
    t.mEntry = bEntry.has(t.no) ? bEntry.get(t.no) : mainFor(t.o, entryLine, entryBase);
    t.mExit = bExit.has(t.no) ? bExit.get(t.no) : mainFor(t.o, exitLine, exitBase);
    t.branchEntry = bEntry.has(t.no); t.branchExit = bExit.has(t.no);
    t.fanEntry = fanLength(t.o - t.mEntry);
    t.fanExit = fanLength(t.o - t.mExit);
    t.isThrough = throughNos.includes(t.no);
    if (t.isThrough && t.role !== 'platform' && t.pf === null) t.role = 'main';
    t.name = t.pf ? `PF ${t.pf}` : t.isThrough ? (doubleAny ? (t.o < 0 ? 'Up Main' : 'Down Main') : 'Main Line') : 'Goods Loop';
    if (t.pf && !t.isThrough && t.role === 'loop') t.name = `PF ${t.pf} (loop)`;
  }
  // Ladder throats: instead of every track curving into the running line at one
  // point, the outermost track joins its neighbour first, that one joins the next,
  // and so on — staggered turnouts, the way real station yards are laid.
  buildLadder(tracks, 'Exit', compactExit);
  buildLadder(tracks, 'Entry', compactEntry);
  for (const t of tracks) {
    maxFanEntry = Math.max(maxFanEntry, t.fanEntry);
    maxFanExit = Math.max(maxFanExit, t.fanExit);
  }

  const throatEntry = maxFanEntry + (entryLine === 'D' && !noXoEntry ? XO_LEN + 40 : 0) + 80;
  const throatExit = maxFanExit + (exitLine === 'D' && !noXoExit ? XO_LEN + 40 : 0) + 80;
  const pLen = platformLength(N);

  const minLat = Math.min(...elements.map((e) => e.l0), ...tracks.map((t) => t.o - 3));
  const maxLat = Math.max(...elements.map((e) => e.l1), ...tracks.map((t) => t.o + 3));

  return {
    N, visibleN, entryLine, exitLine, tracks,
    platforms: elements,
    throughNos,
    pLen, throatEntry, throatExit,
    maxFanEntry, maxFanExit,
    minLat, maxLat
  };
}

// Places the layout at absolute route distances once sCenter is known.
export function anchorLayout(layout, sCenter) {
  layout.sCenter = sCenter;
  layout.pStart = sCenter - layout.pLen / 2;
  layout.pEnd = sCenter + layout.pLen / 2;
  layout.zoneStart = layout.pStart - layout.throatEntry;
  layout.zoneEnd = layout.pEnd + layout.throatExit;
  if (layout.entryLine === 'D' && !layout.noXoEntry) {
    layout.xoEntry = { s1: layout.pStart - layout.maxFanEntry - 30 };
    layout.xoEntry.s0 = layout.xoEntry.s1 - XO_LEN;
  }
  if (layout.exitLine === 'D' && !layout.noXoExit) {
    layout.xoExit = { s0: layout.pEnd + layout.maxFanExit + 30 };
    layout.xoExit.s1 = layout.xoExit.s0 + XO_LEN;
  }
  for (const t of layout.tracks) {
    const lane = new Lane(t.mEntry);
    addTrackEntry(lane, layout, t);
    addTrackExit(lane, layout, t);
    t.lane = lane;
    // rendered from where it leaves its neighbour to where it rejoins one; the inner
    // branch tracks at Guntakal run on to the zone edge into the Gooty lines
    t.spanStart = t.fanEntry > 0 ? (t.branchEntry && t.rootEntry ? layout.zoneStart : layout.pStart - t.joinEntry) : layout.zoneStart;
    t.spanEnd = t.fanExit > 0 ? (t.branchExit && t.rootExit ? layout.zoneEnd : layout.pEnd + t.joinExit) : layout.zoneEnd;
  }
  return layout;
}

// Player main offset for a line type (Indian Railways run on the left).
export const playerMain = (line) => (line === 'D' ? -TRACK.MAIN_HALF : 0);
export const opposingMain = (line) => (line === 'D' ? TRACK.MAIN_HALF : 0);

// Guntakal on the Gooty route: the four lines beyond the east throat (Dhone, Gooty Down, Gooty Up,
// goods) are joined by a fixed ladder of crossovers [a0, a1, latA, latB] (metres beyond the throat,
// lateral offsets on our route). A train follows it outward from its platform line, hop by hop,
// toward our running line. Returns true if it gets there (the platform can be used).
export function gtlLadder(lane, layout, t, side) {
  const segs = side === 'exit' ? layout.gtlLadderExit : layout.gtlLadderEntry;
  if (!segs) return true;
  const target = playerMain(side === 'exit' ? layout.exitLine : layout.entryLine);
  let cur = side === 'exit' ? t.mExit : t.mEntry;
  for (const [a0, a1, p, q] of segs.slice().sort((x, y) => x[0] - y[0])) {
    const from = Math.abs(cur - p) < 0.01 ? p : Math.abs(cur - q) < 0.01 ? q : null;
    if (from === null) continue;
    const to = from === p ? q : p;
    if (Math.abs(to - target) >= Math.abs(cur - target)) continue;
    if (lane) {
      if (side === 'exit') lane.add(layout.zoneEnd + a0, layout.zoneEnd + a1, cur, to);
      else lane.add(layout.zoneStart - a1, layout.zoneStart - a0, to, cur);
    }
    cur = to;
  }
  return Math.abs(cur - target) < 0.01;
}

// Transitions a train must follow to use `track` at this station, travelling +s.
export function appendStationTransitions(lane, layout, track, { entry = true, exit = true } = {}) {
  const pm = playerMain(layout.entryLine);
  const px = playerMain(layout.exitLine);
  if (entry) {
    if (layout.xoEntry && Math.abs(track.mEntry - pm) > 0.01) {
      lane.add(layout.xoEntry.s0, layout.xoEntry.s1, pm, track.mEntry);
    }
    if (layout.gtlLadderEntry) gtlLadder(lane, layout, track, 'entry');
    else if (track.branchEntry) addBranchConnectors(lane, layout, track, { exit: false });
    addTrackEntry(lane, layout, track);
  }
  if (exit) {
    addTrackExit(lane, layout, track);
    if (layout.gtlLadderExit) gtlLadder(lane, layout, track, 'exit');
    else if (track.branchExit) addBranchConnectors(lane, layout, track, { entry: false });
    if (layout.xoExit && Math.abs(track.mExit - px) > 0.01) {
      lane.add(layout.xoExit.s0, layout.xoExit.s1, track.mExit, px);
    }
  }
}

// True if using this track needs a diverging (turnout) route from the main.
export function isDiverging(layout, track) {
  return Math.abs(track.o - playerMain(layout.entryLine)) > 0.05;
}
