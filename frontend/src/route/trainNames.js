import { OFFLINE_HUBS, OFFLINE_EDGES } from './offlineGraph.data.js';
import { isTerminal } from './offlineSolver.js';
import { stationName } from './stationNames.js';

// Route-aware train names. A through train's end points are a pair of hubs whose
// shortest route (same graph and terminus rules as the route solver) really runs
// over this section, in the direction the train is travelling. Each train type
// follows its real pattern:
//   Rajdhani      state capital <-> New Delhi only
//   Duranto       big city <-> big city, long distance (500 km+)
//   Vande Bharat  day train between cities 150-800 km apart
//   Express/SF    city <-> city (at least one big city)
//   DEMU          local, between stations of this section

const CITY = {
  SBC: 'KSR Bengaluru', SC: 'Secunderabad', HYB: 'Hyderabad', MAS: 'Chennai Central', CSMT: 'Mumbai CSMT', HWH: 'Howrah',
  NDLS: 'New Delhi', ADI: 'Ahmedabad', JP: 'Jaipur', BZA: 'Vijayawada', VSKP: 'Visakhapatnam', CBE: 'Coimbatore',
  TPTY: 'Tirupati', DDR: 'Dadar', GTL: 'Guntakal', KRNT: 'Kurnool City', ATP: 'Anantapur', RC: 'Raichur',
  WADI: 'Wadi', DHNE: 'Dhone', GWD: 'Gadwal', KYN: 'Kalyan', BSR: 'Vasai Road',
  BAY: 'Ballari', HPT: 'Hosapete', UBL: 'Hubballi', LD: 'Londa', VSG: 'Vasco da Gama', BBS: 'Bhubaneswar', NZB: 'Nizamabad', KZJ: 'Kazipet', WL: 'Warangal', NGP: 'Nagpur'
};
const MAJOR = new Set(['SBC', 'SC', 'HYB', 'MAS', 'CSMT', 'HWH', 'NDLS', 'ADI', 'JP', 'BZA', 'VSKP', 'CBE', 'TPTY', 'DDR', 'UBL', 'VSG', 'BBS', 'NGP']);
const MEDIUM = new Set(['GTL', 'KRNT', 'ATP', 'RC', 'BAY', 'HPT', 'NZB']);
// state capitals with a Rajdhani to Delhi (Hyderabad's runs from Secunderabad)
const CAPITALS = new Set(['SBC', 'SC', 'MAS', 'CSMT', 'HWH', 'ADI']);
// Hub coordinates (as in the rail_hubs table): a pair only counts if the graph's route between
// them is not a big detour — the graph is sparse, and e.g. Howrah - New Delhi must not run via Kurnool.
const LATLON = { TPTY: [13.6288, 79.4192], HYB: [17.3924, 78.4678], RC: [16.2076, 77.3463], KRNT: [15.8281, 78.0373], GWD: [16.2336, 77.7985],
  GTL: [15.1674, 77.3769], SC: [17.4344, 78.5013], SBC: [12.9781, 77.5697], NDLS: [28.6429, 77.2191], CSMT: [18.9398, 72.8355],
  MAS: [13.0827, 80.2757], BZA: [16.5186, 80.6199], VSKP: [17.7215, 83.2896], HWH: [22.5839, 88.3426], CBE: [10.9968, 76.9669],
  ADI: [23.0268, 72.6012], JP: [26.9196, 75.7878], WADI: [17.0472, 76.9922], DHNE: [15.3948, 77.8712], ATP: [14.6819, 77.6006],
  KYN: [19.2437, 73.1355], BSR: [19.383, 72.832], DDR: [19.019, 72.843],
  BAY: [15.15, 76.93], HPT: [15.2694, 76.387], UBL: [15.35, 75.15], LD: [15.46, 74.51], VSG: [15.398, 73.815], BBS: [20.2665, 85.8431], NZB: [18.6725, 78.0941], KZJ: [17.9784, 79.53], WL: [17.9689, 79.5941], NGP: [21.1527, 79.0888] };
const MAX_DETOUR = 1.5; // rail km / straight-line km
const crowKm = (a, b) => {
  const p = LATLON[a], q = LATLON[b];
  if (!p || !q) return null;
  const r = Math.PI / 180, dLat = (q[0] - p[0]) * r, dLon = (q[1] - p[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * r) * Math.cos(q[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const plausible = (a, b, km) => { const c = crowKm(a, b); return !c || km <= c * MAX_DETOUR; };
const GOODS = ['BOXN Coal Rake', 'BCN Container Special', 'BTPN Tank Rake', 'BOBRN Iron Ore Rake', 'NMG Car Carrier', 'BCNA Cement Rake'];

const hash = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// ---- all-pairs routes over the graph: "edgeId|startHub" (direction of travel) -> [{ a, b, km }]
let ROUTES = null;
function routes() {
  if (ROUTES) return ROUTES;
  const hubs = Object.fromEntries(OFFLINE_HUBS.map((h) => [h.code, h]));
  const adj = {};
  for (const e of OFFLINE_EDGES) {
    (adj[e.fromHub] ||= []).push({ n: e.toHub, e, from: e.fromHub });
    (adj[e.toHub] ||= []).push({ n: e.fromHub, e, from: e.toHub });
  }
  ROUTES = new Map();
  for (const a of Object.keys(adj)) {
    const dist = { [a]: 0 }, prev = {}, open = new Set([a]);
    while (open.size) {
      let cur = null;
      for (const n of open) if (cur === null || dist[n] < dist[cur]) cur = n;
      open.delete(cur);
      if (cur !== a && isTerminal(cur, hubs[cur])) continue; // no way through a terminus
      for (const s of adj[cur] || []) {
        const nd = dist[cur] + s.e.distanceKm;
        if (nd < (dist[s.n] ?? Infinity)) { dist[s.n] = nd; prev[s.n] = s; open.add(s.n); }
      }
    }
    for (const b of Object.keys(dist)) {
      if (b === a || !plausible(a, b, dist[b])) continue;
      for (let c = b; prev[c]; c = prev[c].from) {
        const key = `${prev[c].e.edgeId}|${prev[c].from}`;
        if (!ROUTES.has(key)) ROUTES.set(key, []);
        ROUTES.get(key).push({ a, b, km: dist[b] });
      }
    }
  }
  return ROUTES;
}

const fits = {
  RAJDHANI: (p) => (CAPITALS.has(p.a) && p.b === 'NDLS') || (p.a === 'NDLS' && CAPITALS.has(p.b)),
  DURANTO: (p) => MAJOR.has(p.a) && MAJOR.has(p.b) && p.km >= 500,
  VANDE_BHARAT: (p) => (MAJOR.has(p.a) || MEDIUM.has(p.a)) && (MAJOR.has(p.b) || MEDIUM.has(p.b)) && p.km >= 150 && p.km <= 800,
  EXPRESS: (p) => (MAJOR.has(p.a) || MEDIUM.has(p.a)) && (MAJOR.has(p.b) || MEDIUM.has(p.b)) && (MAJOR.has(p.a) || MAJOR.has(p.b)) && p.km >= 150
};
const fitFor = (rake) => fits[rake] || (rake === 'LHB' || rake === 'ICF' ? fits.EXPRESS : null);

export const isRajdhaniRoute = (a, b) => fits.RAJDHANI({ a, b });

export function makeNamer(layout, seedKey) {
  const used = new Set();
  const num = (base, span, rand) => {
    for (let k = 0; k < 20; k++) {
      const n = String(base + Math.floor(rand() * span));
      if (!used.has(n)) { used.add(n); return n; }
    }
    return String(base + Math.floor(rand() * span));
  };

  // Origin-destination pairs that pass this place in this direction.
  // ctx: { s, dir } (a train on the line; dir +1 = the way we are going) or { st } (a train at a station).
  const pairsAt = (ctx = {}) => {
    const R = routes();
    const legs = [];
    if (ctx.st) {
      for (const g of [ctx.st.gapIn, ctx.st.gapOut]) if (g) for (const d of [1, -1]) legs.push([g.leg, d]);
    } else {
      const g = ctx.s !== undefined ? layout.gapAt(ctx.s) : null;
      if (g) legs.push([g.leg, ctx.dir ?? 1]);
      else for (const gg of layout.gaps) for (const d of [1, -1]) legs.push([gg.leg, d]);
    }
    const out = [];
    for (const [leg, d] of legs) out.push(...(R.get(`${leg.edgeId}|${d > 0 ? leg.from : leg.to}`) || []));
    return out;
  };
  const localStations = (ctx = {}) => {
    const g = ctx.st ? (ctx.st.gapOut || ctx.st.gapIn) : ctx.s !== undefined ? layout.gapAt(ctx.s) : null;
    const codes = g ? g.leg.stations.map((x) => x.code) : layout.stations.map((x) => x.code);
    return codes;
  };
  const city = (code) => CITY[code] || layout.stations.find((x) => x.code === code)?.name || code;

  const api = {
    // Can a train of this type plausibly be here?
    allowed(rake, ctx = {}) {
      const f = fitFor(rake);
      if (!f) return true; // goods, DEMU: always
      return pairsAt(ctx).some(f);
    },
    // Pick a rake from the list that fits this place (falls back to an express).
    pickRake(list, rand, ctx = {}) {
      const ok = list.filter((r) => api.allowed(r, ctx));
      if (!ok.length) return list.includes('BOXN_GOODS') ? 'BOXN_GOODS' : 'ICF';
      return ok[Math.floor(rand() * ok.length) % ok.length];
    },
    name(rake, rand, ctx = {}) {
      if (rake === 'BOXN_GOODS') return GOODS[Math.floor(rand() * GOODS.length)];
      if (rake === 'DEMU_PASSENGER') {
        const codes = localStations(ctx);
        let a = codes[Math.floor(rand() * codes.length)], b = codes[Math.floor(rand() * codes.length)];
        if (a === b) b = codes[(codes.indexOf(a) + 1 + Math.floor(rand() * (codes.length - 1))) % codes.length];
        const k = ctx.st ? codes.indexOf(ctx.st.code) : -1;
        if (k >= 0 && codes.length > 1) { // a local standing at a station must serve it: one end on either side of it
          const i = Math.floor(rand() * (k + 1)), j = k + Math.floor(rand() * (codes.length - k));
          [a, b] = i === j ? (k > 0 ? [codes[0], codes[k]] : [codes[k], codes[codes.length - 1]]) : [codes[i], codes[j]];
        }
        const [x, y] = ctx.dir < 0 ? [b, a] : [a, b];
        const nm = (c) => (layout.stations.find((s) => s.code === c)?.name || stationName(c) || city(c)).replace(/\s+JN$/i, '');
        return `${num(77201, 600, rand)} ${titleCase(nm(x))}-${titleCase(nm(y))} DEMU`;
      }
      const f = fitFor(rake) || fits.EXPRESS;
      let cands = pairsAt(ctx).filter(f);
      if (!cands.length) cands = pairsAt(ctx).filter(fits.EXPRESS);
      let a, b;
      if (cands.length) ({ a, b } = cands[Math.floor(rand() * cands.length)]);
      else { // no through pair: the section's own end points
        const codes = localStations(ctx);
        [a, b] = ctx.dir < 0 ? [codes[codes.length - 1], codes[0]] : [codes[0], codes[codes.length - 1]];
      }
      switch (rake) {
        case 'RAJDHANI': return `${num(22401, 300, rand)} ${city(a)}-${city(b)} Rajdhani`;
        case 'DURANTO': return `${num(12201, 90, rand)} ${city(a)}-${city(b)} Duranto`;
        case 'VANDE_BHARAT': return `${num(20601, 380, rand)} ${city(a)}-${city(b)} Vande Bharat`;
        case 'ICF': return `${num(17201, 700, rand)} ${city(a)}-${city(b)} Exp`;
        default: return `${num(12601, 900, rand)} ${city(a)}-${city(b)} ${rand() < 0.5 ? 'SF Exp' : 'Exp'}`;
      }
    },
    // our own train: a stable number per route and rake
    ownNumber(rake) {
      const h = hash(seedKey + rake);
      const base = { VANDE_BHARAT: 20701, RAJDHANI: 22691, DURANTO: 12211, ICF: 17201, DEMU_PASSENGER: 77201, BOXN_GOODS: 0 }[rake] ?? 12601;
      if (!base) return 'GOODS';
      const n = String(base + (h % (rake === 'RAJDHANI' ? 40 : rake === 'DURANTO' ? 60 : 380)));
      used.add(n);
      return n;
    }
  };
  return api;
}

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
