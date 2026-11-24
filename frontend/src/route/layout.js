import { RoutePath } from './path.js';
import { Lane } from './lane.js';
import { makeStationLayout, anchorLayout, appendStationTransitions, playerMain } from './stationLayout.js';
import { OPEN_SCALE, MIN_OPEN_WORLD } from '../config.js';
import { makeRng, range, smoothstep } from '../core/rng.js';
import { stationName } from './stationNames.js';

// Guntakal ROR flyover geometry, expressed in u = metres travelled away from
// the GTL station boundary toward Dhone. Departing GTL -> DHNE the line runs
// straight beside the Gooty double line (which stays on the RIGHT), then
// curves LEFT and climbs over the Bellary line on a viaduct.
export const GTL_SPECIAL = {
  // Long left-hand curve: starts on the flyover approach and keeps bending
  // through ~70° after the crest before straightening toward Dhone.
  curve0: 1000, curve1: 2380, radius: 950, ramp: 220,
  rise0: 380, rise1: 1150, fall0: 1450, fall1: 2000,
  peak: 8.5, crossU: 1355, length: 2800,
  vvNagarU: 2080, vvNagarLat: 24, drmU: 1040 // DRM office just before the foot over bridge (u 1150)
};

const BIOME_RELIEF = {
  DECCAN_PLATEAU: 4, EASTERN_GHATS_DECCAN: 7, WESTERN_GHATS_URBAN: 22, WESTERN_GHATS_PLATEAU: 12,
  CENTRAL_NORTH_PLAINS: 2, EAST_COAST_DELTA: 1.2, EAST_COAST_BENGAL: 1.2, GODAVARI_COAST: 1.2,
  NALLAMALA_COASTAL: 10, WEST_COAST_GUJARAT: 1.5, ARAVALLI_RAJASTHAN: 7, RAJASTHAN_NCR: 2.5, URBAN_SUBURBAN: 1
};
const GHAT_BIOMES = new Set(['WESTERN_GHATS_URBAN', 'WESTERN_GHATS_PLATEAU', 'NALLAMALA_COASTAL']);

const smootherstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function lineOf(trackType, rand) {
  if (trackType.startsWith('SINGLE')) return 'S';
  if (trackType.startsWith('MIXED')) return rand() < 0.5 ? 'S' : 'D';
  return 'D';
}

function parseSpecial(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

export function buildRouteLayout(plan, { hubs, seedKey, scale = OPEN_SCALE }) {
  const openScale = Math.max(1, scale);
  const legs = plan.route.legs;
  const stations = [];
  const gaps = [];

  legs.forEach((leg, li) => {
    const st = leg.stations;
    const n = st.length;
    const rand = makeRng(seedKey, leg.edgeId, 'km');
    const w = [];
    for (let i = 0; i < n - 1; i++) w.push(0.75 + rand() * 0.5);
    const wSum = w.reduce((a, b) => a + b, 0);
    const lineRand = makeRng(seedKey, leg.edgeId, 'line');
    for (let i = 0; i < n; i++) {
      // junction station (i === 0 of later legs) was already pushed by the previous leg
      if (!(li > 0 && i === 0)) {
        stations.push({
          code: st[i].code,
          name: stationName(st[i].code, hubs),
          platforms: st[i].platforms,
          halt: st[i].defaultHalt,
          minor: !st[i].defaultHalt, // a wayside halt (village), not a town station
          mandatoryReversal: st[i].mandatoryReversal
        });
      }
      if (i < n - 1) {
        gaps.push({
          leg, legIdx: li,
          realKm: (leg.distanceKm * w[i]) / wSum,
          biome: leg.biome,
          line: lineOf(leg.trackType, lineRand),
          trackType: leg.trackType
        });
      }
    }
  });

  const last = stations.length - 1;
  const METRO = new Set(['NDLS', 'CSMT', 'MAS', 'HWH', 'SBC', 'SC', 'HYB', 'ADI', 'PUNE', 'BBS', 'NZM', 'KYN', 'DR', 'TNA']);
  stations.forEach((s, i) => {
    s.index = i;
    // scheduled dwell (in-game minutes): metros 10, big junctions like Guntakal 5, others 1
    s.category = METRO.has(s.code) ? 'metro' : (s.code === 'GTL' || s.platforms >= 6) ? 'junction' : 'station';
    s.dwellMin = s.category === 'metro' ? 10 : s.category === 'junction' ? 5 : 1;
    s.isOrigin = i === 0;
    s.isDest = i === last;
    if (s.isOrigin || s.isDest) s.halt = true;
    // villages: minor wayside stations get a hamlet of 1-2 houses, not a town (Dhone and Jadcherla are real towns)
    s.village = !!s.minor && s.category === 'station' && !s.isOrigin && !s.isDest && !['DHNE', 'JCL'].includes(s.code) && !s.mandatoryReversal;
    s.gapIn = gaps[i - 1] || null;
    s.gapOut = gaps[i] || null;
    s.biome = (s.gapOut || s.gapIn).biome;
  });

  // Reversal stations: the train must change engine / ends and head back out the
  // same side. Backend mandatory reversals (e.g. VSKP), and Guntakal when a journey
  // arrives from Gooty and continues to Dhone (or vice versa): both leave GTL's east end.
  stations.forEach((s, i) => {
    if (s.isOrigin || s.isDest) return;
    const prev = stations[i - 1], next = stations[i + 1];
    const inDhne = s.gapIn?.leg.edgeId === 'GTL_TO_DHNE_FLYOVER';
    const outDhne = s.gapOut?.leg.edgeId === 'GTL_TO_DHNE_FLYOVER';
    const gtlReversal = s.code === 'GTL' && ((prev.code === 'GY' && outDhne) || (inDhne && next.code === 'GY'));
    if (s.mandatoryReversal || gtlReversal) {
      s.reversal = true;
      s.halt = true;
      s.dwellMin = Math.max(s.dwellMin, 10);
    }
  });

  // Guntakal ROR flyover detection (only when the route really uses GTL<->DHNE).
  let gtl = null;
  gaps.forEach((g, i) => {
    if (g.leg.edgeId !== 'GTL_TO_DHNE_FLYOVER') return;
    const meta = parseSpecial(g.leg.specialGeometryJson) || {};
    if (!g.leg.reversed && stations[i].code === 'GTL') g.special = { atStart: true, meta };
    if (g.leg.reversed && stations[i + 1].code === 'GTL') g.special = { atStart: false, meta };
    // the GTL-DHNE line type comes from the database (single line with crossing loops)
  });

  stations.forEach((s) => {
    const entryLine = s.gapIn ? s.gapIn.line : s.gapOut.line;
    const exitLine = s.gapOut ? s.gapOut.line : entryLine;
    // Guntakal: facing the Gooty side, PF7 is the leftmost and PF1 the rightmost platform
    let mirror = false;
    if (s.code === 'GTL') {
      const prevC = stations[s.index - 1]?.code, nextC = stations[s.index + 1]?.code;
      const outDhne = s.gapOut && s.gapOut.leg.edgeId === 'GTL_TO_DHNE_FLYOVER' && !s.gapOut.leg.reversed;
      const inDhne = s.gapIn && s.gapIn.leg.edgeId === 'GTL_TO_DHNE_FLYOVER' && s.gapIn.leg.reversed;
      const gootyBehind = prevC === 'GY' || inDhne;
      const gootyAhead = nextC === 'GY' || outDhne;
      mirror = gootyAhead && !gootyBehind;
    }
    // variety: wayside halts get just the two mains, small stops sometimes one loop,
    // big stations get goods loops for stabled goods trains
    let variant = null, goodsLoops = 0;
    const h = [...s.code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 17) / 9973;
    if (s.platforms <= 2 && !s.isOrigin && !s.isDest) variant = !s.halt ? 'two' : h < 0.55 ? 'loop1' : h < 0.8 ? 'two' : null;
    if (s.category === 'metro') goodsLoops = 3; else if (s.category === 'junction') goodsLoops = 2; else if (s.platforms >= 3) goodsLoops = h < 0.5 ? 1 : 0;
    // Guntakal: the Gooty-side tracks continue straight into Gooty Down / Up and the goods line
    const GOOTY = { targets: [6.0, 11.3, 16.6] };
    const exitBranches = s.code === 'GTL' && s.gapOut?.special?.atStart ? { ...GOOTY, sign: 1 } : null;
    const entryBranches = s.code === 'GTL' && s.gapIn?.special && !s.gapIn.special.atStart ? { ...GOOTY, sign: -1 } : null;
    s.layout = makeStationLayout({ platforms: s.platforms, entryLine, exitLine, mirror, variant, goodsLoops, entryBranches, exitBranches });
    s.layout.mirror = mirror;
  });

  // ---- Assign route distance s (1:1 inside station zones, compressed between).
  let s = 650;
  stations.forEach((st, i) => {
    const L = st.layout;
    anchorLayout(L, s + L.throatEntry + L.pLen / 2);
    s = L.zoneEnd;
    const g = gaps[i];
    if (g) {
      const next = stations[i + 1].layout;
      const realGapM = g.realKm * 1000 - (L.zoneEnd - L.sCenter) - (next.throatEntry + next.pLen / 2);
      const specialLen = g.special ? GTL_SPECIAL.length : 0;
      const openReal = Math.max(0, realGapM - specialLen);
      g.specialLen = specialLen;
      g.s0 = s;
      g.s1 = s + specialLen + Math.max(openScale > 1 ? MIN_OPEN_WORLD : 0, openReal / openScale) + (specialLen ? 400 : 0);
      g.index = i;
      s = g.s1;
    }
  });
  const total = s + 900;

  // ---- Real-km odometer mapping.
  const knots = [];
  let R = 0;
  stations.forEach((st, i) => {
    const L = st.layout;
    const pushKnot = (sv, km) => {
      const prev = knots[knots.length - 1];
      if (prev && km < prev.km + (sv - prev.s) / 1000) km = prev.km + (sv - prev.s) / 1000;
      knots.push({ s: sv, km });
    };
    if (i === 0) knots.push({ s: 0, km: -(L.sCenter) / 1000 });
    pushKnot(L.zoneStart, R - (L.sCenter - L.zoneStart) / 1000);
    st.realKm = Math.max(R, knots[knots.length - 1].km + (L.sCenter - L.zoneStart) / 1000);
    R = st.realKm;
    pushKnot(L.zoneEnd, R + (L.zoneEnd - L.sCenter) / 1000);
    const g = gaps[i];
    if (g) {
      if (g.special && g.special.atStart) pushKnot(g.s0 + g.specialLen, knots[knots.length - 1].km + g.specialLen / 1000);
      const nextR = R + g.realKm;
      if (g.special && !g.special.atStart) {
        const nl = stations[i + 1].layout;
        pushKnot(g.s1 - g.specialLen, nextR - (nl.sCenter - nl.zoneStart) / 1000 - g.specialLen / 1000);
      }
      R = nextR;
    }
  });
  knots.push({ s: total, km: knots[knots.length - 1].km + (total - knots[knots.length - 1].s) / 1000 });

  const realKmAt = (sv) => {
    if (sv <= knots[0].s) return knots[0].km;
    for (let i = 1; i < knots.length; i++) {
      if (sv <= knots[i].s) {
        const a = knots[i - 1], b = knots[i];
        return a.km + (b.km - a.km) * ((sv - a.s) / Math.max(1e-6, b.s - a.s));
      }
    }
    return knots[knots.length - 1].km;
  };
  const sAtRealKm = (km) => {
    for (let i = 1; i < knots.length; i++) {
      if (km <= knots[i].km) {
        const a = knots[i - 1], b = knots[i];
        return a.s + (b.s - a.s) * ((km - a.km) / Math.max(1e-9, b.km - a.km));
      }
    }
    return total;
  };

  // ---- GTL special frame.
  gaps.forEach((g) => {
    if (!g.special) return;
    const atStart = g.special.atStart;
    const boundary = atStart ? g.s0 : g.s1;
    const dir = atStart ? 1 : -1;
    const meta = g.special.meta || {};
    const peak = 0; // the Dhone line leaves Guntakal at grade (no flyover, nothing passes under it)
    gtl = {
      gap: g, boundary, dir, peak,
      uToS: (u) => boundary + dir * u,
      sToU: (sv) => dir * (sv - boundary),
      s0: Math.min(boundary, boundary + dir * GTL_SPECIAL.length),
      s1: Math.max(boundary, boundary + dir * GTL_SPECIAL.length),
      station: atStart ? stations[g.index] : stations[g.index + 1]
    };
  });

  // ---- Curvature plan.
  const curves = [];
  gaps.forEach((g, i) => {
    let a = g.s0 + 150, b = g.s1 - 150;
    if (g.special) {
      if (g.special.atStart) a = g.s0 + g.specialLen + 250; else b = g.s1 - g.specialLen - 250;
    }
    const rand = makeRng(seedKey, 'curve', i, g.leg.edgeId);
    const ghat = GHAT_BIOMES.has(g.biome);
    const rMin = ghat ? 420 : 650;
    const maxTurn = (ghat ? 70 : 50) * Math.PI / 180;
    let pos = a, cum = 0, lastSign = 0;
    for (let guard = 0; guard < 400; guard++) {
      pos += range(rand, 25, ghat ? 120 : 220);
      const room = b - pos;
      if (room < 220) break;
      let Lc = Math.min(room, range(rand, 380, ghat ? 1000 : 1500));
      const Rr = range(rand, rMin, rMin * 2.2);
      if (Lc / Rr > maxTurn) Lc = maxTurn * Rr;
      // alternate left/right most of the time (reverse curves), and never let
      // the alignment spiral away in one direction
      let sign = lastSign ? (rand() < 0.7 ? -lastSign : lastSign) : (rand() < 0.5 ? -1 : 1);
      if (Math.abs(cum) > 1.0) sign = -Math.sign(cum);
      cum += sign * Lc / Rr;
      lastSign = sign;
      curves.push({ s0: pos, s1: pos + Lc, k: sign / Rr, ramp: Math.min(180, Lc * 0.32) });
      pos += Lc;
    }
  });
  if (gtl) {
    const S = GTL_SPECIAL;
    const sa = gtl.uToS(S.curve0), sb = gtl.uToS(S.curve1);
    curves.push({ s0: Math.min(sa, sb), s1: Math.max(sa, sb), k: gtl.dir * (-1 / S.radius), ramp: S.ramp });
  }
  curves.sort((p, q) => p.s0 - q.s0);

  // Permissible speed on each curve, Indian BG formula V = 0.27 * sqrt((Ca + Cd) * R),
  // with actual cant Ca (mm, max 165) and cant deficiency Cd = 140 mm (relaxed for gameplay).
  for (const c of curves) {
    const R = 1 / Math.abs(c.k);
    const Ca = Math.min(165, (90 / R) * 1750);
    c.R = R;
    c.vLimit = Math.floor((0.27 * Math.sqrt((Ca + 140) * R)) / 5) * 5; // generous cant deficiency for modern LHB/EMU stock
  }
  const curveAt = (sv) => {
    let lo = 0, hi = curves.length - 1, idx = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (curves[m].s0 <= sv) { idx = m; lo = m + 1; } else hi = m - 1; }
    return idx >= 0 && sv <= curves[idx].s1 ? curves[idx] : null;
  };

  const curvatureAt = (sv) => {
    let lo = 0, hi = curves.length - 1, idx = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (curves[m].s0 <= sv) { idx = m; lo = m + 1; } else hi = m - 1; }
    if (idx < 0) return 0;
    const c = curves[idx];
    if (sv > c.s1) return 0;
    const t = Math.min(1, (sv - c.s0) / c.ramp, (c.s1 - sv) / c.ramp);
    return c.k * Math.max(0, t);
  };

  // ---- Elevation: gentle undulation in open sections, flat stations, flyover.
  gaps.forEach((g, i) => {
    const rand = makeRng(seedKey, 'elev', i);
    let a = g.s0 + 150, b = g.s1 - 150;
    if (g.special) { if (g.special.atStart) a += g.specialLen; else b -= g.specialLen; }
    let A = BIOME_RELIEF[g.biome] ?? 3;
    const ramp = Math.max(500, A * 70);
    const usable = b - a;
    if (usable < 2 * ramp + 200) A *= Math.max(0, (usable - 200) / (2 * ramp + 200));
    g.elev = { a, b, A, ramp, l1: range(rand, 3500, 7000), l2: range(rand, 1400, 2600), p1: rand() * 6.28, p2: rand() * 6.28 };
  });
  const gapAt = (sv) => {
    let lo = 0, hi = gaps.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (sv < gaps[m].s0) hi = m - 1; else if (sv > gaps[m].s1) lo = m + 1; else return gaps[m];
    }
    return null;
  };
  const undulation = (sv) => {
    const g = gapAt(sv);
    if (!g || !g.elev.A) return 0;
    const e = g.elev;
    const w = smoothstep(e.a, e.a + e.ramp, sv) * (1 - smoothstep(e.b - e.ramp, e.b, sv));
    if (w <= 0) return 0;
    return e.A * w * (0.62 * Math.sin((sv / e.l1) * 6.2832 + e.p1) + 0.38 * Math.sin((sv / e.l2) * 6.2832 + e.p2));
  };
  const flyover = (sv) => {
    if (!gtl || sv < gtl.s0 - 10 || sv > gtl.s1 + 10) return 0;
    const u = gtl.sToU(sv);
    const S = GTL_SPECIAL;
    return gtl.peak * (smootherstep(S.rise0, S.rise1, u) - smootherstep(S.fall0, S.fall1, u));
  };

  const path = new RoutePath(total, curvatureAt, (sv) => undulation(sv) + flyover(sv), undulation);

  // ---- Biome lookup with smooth blends at junction stations.
  const biomeTransitions = [];
  stations.forEach((st) => {
    if (st.gapIn && st.gapOut && st.gapIn.biome !== st.gapOut.biome) {
      biomeTransitions.push({ s: st.layout.sCenter, from: st.gapIn.biome, to: st.gapOut.biome });
    }
  });
  const biomeAt = (sv) => {
    const g = gapAt(sv);
    let base = g ? g.biome : null;
    if (!base) {
      const st = stationAt(sv) || stations[0];
      base = st.biome;
    }
    for (const t of biomeTransitions) {
      if (Math.abs(sv - t.s) < 1500) {
        return { a: t.from, b: t.to, t: smoothstep(t.s - 1500, t.s + 1500, sv) };
      }
    }
    return { a: base, b: base, t: 0 };
  };

  const stationAt = (sv, pad = 0) => {
    for (const st of stations) if (sv >= st.layout.zoneStart - pad && sv <= st.layout.zoneEnd + pad) return st;
    return null;
  };

  const lineAt = (sv) => {
    const g = gapAt(sv);
    if (g) return g.line;
    const st = stationAt(sv);
    if (!st) return (sv < stations[0].layout.zoneStart ? stations[0].layout.entryLine : stations[last].layout.exitLine);
    return sv < st.layout.sCenter ? st.layout.entryLine : st.layout.exitLine;
  };

  // Half-width of terrain that must stay flat around the formation.
  const flatHalfWidth = (sv) => {
    let w = 42;
    const st = stationAt(sv, 450);
    if (st) w = Math.max(Math.abs(st.layout.minLat), Math.abs(st.layout.maxLat)) + (st.category === 'metro' ? 330 : st.category === 'junction' ? 280 : 210);
    if (gtl && sv > gtl.s0 - 600 && sv < gtl.s1 + 1800) w = Math.max(w, 640);
    return w;
  };

  // ---- Player lane construction from chosen platform tracks.
  const buildLane = (choice) => {
    const origin = stations[0];
    const t0 = origin.layout.tracks.find((t) => t.no === choice.get(0)) || origin.layout.tracks[0];
    const lane = new Lane(t0.o);
    appendStationTransitions(lane, origin.layout, t0, { entry: false, exit: true });
    for (let i = 1; i < stations.length; i++) {
      const st = stations[i];
      const tr = st.layout.tracks.find((t) => t.no === choice.get(i)) || st.layout.tracks[0];
      appendStationTransitions(lane, st.layout, tr, { entry: true, exit: !st.isDest });
    }
    return lane;
  };

  return {
    stations, gaps, path, total, gtl, curves, curveAt,
    realKmAt, sAtRealKm, biomeAt, stationAt, lineAt, gapAt, flatHalfWidth, buildLane,
    playerMainAt: (sv) => playerMain(lineAt(sv)),
    totalRealKm: plan.route.totalRealKm
  };
}
