import { spokenName } from './stationScripts.js';

// Route-aware train names: AI trains and our own train get numbers and
// end points that fit the route being driven (not always Guntakal trains).

const FAR = ['Bengaluru', 'Chennai', 'Mumbai', 'Howrah', 'New Delhi', 'Hyderabad', 'Secunderabad', 'Tirupati', 'Vijayawada',
  'Visakhapatnam', 'Pune', 'Ahmedabad', 'Thiruvananthapuram', 'Mysuru', 'Hubballi', 'Kacheguda', 'Puducherry',
  'Bhubaneswar', 'Patna', 'Jaipur', 'Nagpur', 'Kolhapur', 'Mangaluru', 'Madurai', 'Coimbatore', 'Guwahati', 'Varanasi'];
const GOODS = ['BOXN Coal Rake', 'BCN Container Special', 'BTPN Tank Rake', 'BOBRN Iron Ore Rake', 'NMG Car Carrier', 'BCNA Cement Rake'];

const hash = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function makeNamer(layout, seedKey) {
  const tidy = (n) => spokenName(n).replace(/\s+(City|Town|Road)$/i, (m) => m);
  const all = layout.stations.map((s) => tidy(s.name));
  const majors = layout.stations.filter((s) => s.category !== 'station' || s.isOrigin || s.isDest).map((s) => tidy(s.name));
  const used = new Set();
  const num = (base, span, rand) => {
    for (let k = 0; k < 20; k++) {
      const n = String(base + Math.floor(rand() * span));
      if (!used.has(n)) { used.add(n); return n; }
    }
    return String(base + Math.floor(rand() * span));
  };
  const pickFrom = (arr, rand, not) => {
    const c = arr.filter((x) => x !== not);
    return c[Math.floor(rand() * c.length)] || arr[0];
  };
  const ends = (rand, local = false) => {
    const pool = local ? all : majors.concat(FAR);
    const a = pickFrom(local ? all : majors.length ? majors : FAR, rand);
    let b = pickFrom(pool, rand, a);
    if (!local && rand() < 0.6) b = pickFrom(FAR, rand, a);
    return rand() < 0.5 ? [a, b] : [b, a];
  };
  return {
    name(rake, rand) {
      switch (rake) {
        case 'BOXN_GOODS': return GOODS[Math.floor(rand() * GOODS.length)];
        case 'VANDE_BHARAT': { const [a, b] = ends(rand); return `${num(20601, 380, rand)} ${a}-${b} Vande Bharat Exp`; }
        case 'RAJDHANI': { const [a] = ends(rand); return `${num(22401, 300, rand)} ${a}-${rand() < 0.5 ? 'New Delhi' : 'Hazrat Nizamuddin'} Rajdhani`; }
        case 'DURANTO': { const [a, b] = ends(rand); return `${num(12201, 90, rand)} ${a}-${b} Duranto`; }
        case 'ICF': { const [a, b] = ends(rand); return `${num(17201, 700, rand)} ${a}-${b} Exp`; }
        case 'DEMU_PASSENGER': { const [a, b] = ends(rand, true); return `${num(77201, 600, rand)} ${a}-${b} DEMU`; }
        case 'LHB':
        default: { const [a, b] = ends(rand); return `${num(12601, 900, rand)} ${a}-${b} ${rand() < 0.5 ? 'SF Exp' : 'Exp'}`; }
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
}
