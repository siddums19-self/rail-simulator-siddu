import { OFFLINE_HUBS, OFFLINE_EDGES } from './offlineGraph.data.js';

// JS mirror of RoutePathfinderService (Dijkstra over the bidirectional graph),
// returning the same SimulationPlan shape as POST /api/routes/solve.

export { OFFLINE_HUBS };

// Terminus stations (buffer stops): fallback until the backend has run changeset 008-terminal-hubs.
export const TERMINALS = new Set(['HWH', 'HYB', 'MAS', 'CSMT', 'DDR', 'VSG']);
export const isTerminal = (code, hub) => !!(hub?.terminal || TERMINALS.has(code));

// Corrections applied to API results until the backend has run the matching Liquibase changesets.
export const TRACK_TYPE_OVERRIDES = { GTL_TO_DHNE_FLYOVER: 'SINGLE_LINE_WITH_LOOPS' };

export function applyOverrides(plan) {
  let changed = false;
  for (const leg of plan.route.legs) {
    // only the Guntakal -> Dhone diversion is single line; every other section is double
    const t = TRACK_TYPE_OVERRIDES[leg.edgeId] || (/SINGLE|MIXED/.test(leg.trackType) ? 'DOUBLE_LINE' : null);
    if (t && leg.trackType !== t) { leg.trackType = t; changed = true; }
  }
  if (changed) plan.crossings = offlineCrossings(plan.route.legs);
  return plan;
}

export function solveOffline(source, dest, viaHubs = [], allStopsPassenger = false) {
  const hubMap = Object.fromEntries(OFFLINE_HUBS.map((h) => [h.code, h]));
  const graph = {};
  for (const e of OFFLINE_EDGES) {
    (graph[e.fromHub] ||= []).push({ n: e.toHub, e, rev: false });
    (graph[e.toHub] ||= []).push({ n: e.fromHub, e, rev: true });
  }
  // "@EDGE_ID" entries are not waypoints: they ask for that line where there is a choice
  // (e.g. "@ATP_TO_GTL_DIRECT" = Guntakal - Anantapur direct line instead of via Gooty)
  const tokens = viaHubs.flatMap((v) => v.split(',')).map((v) => v.trim().toUpperCase()).filter(Boolean);
  const prefer = new Set(tokens.filter((v) => v.startsWith('@')).map((v) => v.slice(1)));
  const way = [source, ...tokens.filter((v) => !v.startsWith('@')), dest];
  const legs = [];
  let total = 0;
  for (let i = 0; i < way.length - 1; i++) {
    const a = way[i], b = way[i + 1];
    if (a === b) continue;
    const path = dijkstra(graph, a, b, (code) => isTerminal(code, hubMap[code]), prefer);
    if (!path.length) throw new Error(`No connected railway path between ${a} and ${b}`);
    for (const step of path) {
      const raw = step.e.stationsCsv.split(',');
      if (step.rev) raw.reverse();
      const stations = raw.map((s) => {
        const skip = s.endsWith('*');
        const code = skip ? s.slice(0, -1) : s;
        const hub = hubMap[code];
        return {
          code,
          platforms: hub ? hub.platforms : (skip ? 2 : 3),
          defaultHalt: allStopsPassenger || !skip,
          mandatoryReversal: !!((hub?.mandatoryReversal || isTerminal(code, hub)) && code !== source && code !== dest)
        };
      });
      legs.push({
        edgeId: step.e.edgeId,
        from: step.rev ? step.e.toHub : step.e.fromHub,
        to: step.rev ? step.e.fromHub : step.e.toHub,
        reversed: step.rev,
        distanceKm: step.e.distanceKm,
        trackType: step.e.trackType,
        biome: step.e.biome,
        stations,
        specialGeometryJson: null
      });
      total += step.e.distanceKm;
    }
  }
  const pace = allStopsPassenger ? 17 : 12;
  return {
    route: { totalRealKm: total, compressedMinutes: Math.round((total / 200) * pace * 10) / 10, legs },
    crossings: offlineCrossings(legs)
  };
}

function dijkstra(graph, start, end, terminal = () => false, prefer = new Set()) {
  const dist = { [start]: 0 }, prev = {}, prevNode = {};
  const open = new Set([start]);
  while (open.size) {
    let cur = null;
    for (const n of open) if (cur === null || dist[n] < dist[cur]) cur = n;
    open.delete(cur);
    if (cur === end) break;
    if (cur !== start && terminal(cur)) continue; // buffer stops: no way through a terminus
    for (const adj of graph[cur] || []) {
      const nd = dist[cur] + adj.e.distanceKm * (prefer.has(adj.e.edgeId) ? 0.5 : 1);
      if (nd < (dist[adj.n] ?? Infinity)) { dist[adj.n] = nd; prev[adj.n] = adj; prevNode[adj.n] = cur; open.add(adj.n); }
    }
  }
  const path = [];
  let c = end;
  while (prev[c]) { path.push(prev[c]); c = prevNode[c]; }
  return path.reverse();
}

export function offlineCrossings(legs) {
  const pool = [
    ['20704 Vande Bharat Express', 'VANDE_BHARAT'], ['12793 Rayalaseema SF Express', 'LHB'],
    ['BOXN 58-Wagon Coal Freight', 'BOXN_GOODS'], ['BCN Container Freight Special', 'BOXN_GOODS'],
    ['12798 Venkatadri Express', 'LHB'], ['77414 GTL-KRNT DEMU Passenger', 'DEMU_PASSENGER'],
    ['22691 Bengaluru Rajdhani Express', 'RAJDHANI'], ['17225 Amaravati Express', 'ICF'], ['12245 Yesvantpur Duranto Express', 'DURANTO']
  ];
  const out = [];
  let idx = 0;
  for (const leg of legs) {
    const single = leg.trackType.includes('SINGLE');
    for (let i = 1; i < leg.stations.length - 1; i++) {
      const ai = pool[idx++ % pool.length];
      if (single && i % 2 === 1) {
        out.push({ legEdgeId: leg.edgeId, stationCode: leg.stations[i].code, eventType: 'SINGLE_LINE_LOOP_WAIT', oncomingTrainName: ai[0], oncomingRake: ai[1] });
      }
    }
  }
  return out;
}
