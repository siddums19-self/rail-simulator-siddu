import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { smoothstep } from '../core/rng.js';
import { TRACK } from '../config.js';
import { TrackChunkBuilder, polylineFrames } from './trackBuilder.js';
import { buildSideOHE } from './gtlJunction.js';

// Diverging split tracks and route direction boards for junction stations
// (e.g. Gooty Jn towards Anantapur vs Kadapa, Dhone Jn towards Kurnool/Hyderabad vs Nandyal/Vijayawada).
const JUNCTION_ROUTES = {
  GY: [
    { label: 'ANANTAPUR / BENGALURU', match: ['ATP', 'DMM', 'SBC', 'KLU'], end: 'back', side: -1 },
    { label: 'KADAPA / TIRUPATI', match: ['TU', 'HX', 'YA', 'RU', 'TPTY', 'MAS'], end: 'back', side: 1 }
  ],
  DHNE: [
    { label: 'KURNOOL / HYDERABAD', match: ['BVO', 'VDI', 'KRNT', 'GWD', 'SC', 'HYB'], end: 'ahead', side: -1 },
    { label: 'NANDYAL / VIJAYAWADA', match: ['BMH', 'NDL', 'GID', 'GNT', 'BZA'], end: 'ahead', side: 1 },
    { label: 'GUNTAKAL JN', match: ['MYL', 'LMD', 'MKR', 'GTL'], end: 'back', side: -1 }
  ],
  WADI: [
    { label: 'SECUNDERABAD / HYDERABAD', match: ['SEM', 'VKB', 'SC', 'HYB'], end: 'ahead', side: 1 },
    { label: 'SOLAPUR / PUNE / MUMBAI', match: ['KLBG', 'SUR', 'PUNE', 'KYN', 'CSMT'], end: 'ahead', side: -1 },
    { label: 'RAICHUR / GUNTAKAL', match: ['YG', 'RC', 'GTL'], end: 'back', side: 1 }
  ],
  KZJ: [
    { label: 'WARANGAL / VIJAYAWADA', match: ['WL', 'KMT', 'BZA'], end: 'ahead', side: 1 },
    { label: 'NAGPUR / NEW DELHI', match: ['RDM', 'BPQ', 'NGP', 'NDLS'], end: 'ahead', side: -1 },
    { label: 'SECUNDERABAD JN', match: ['JN', 'BG', 'SC'], end: 'back', side: -1 }
  ],
  BZA: [
    { label: 'VISAKHAPATNAM / HOWRAH', match: ['EE', 'RJY', 'VSKP', 'BBS', 'HWH'], end: 'ahead', side: -1 },
    { label: 'WARANGAL / SECUNDERABAD', match: ['MDR', 'KMT', 'WL', 'KZJ', 'SC'], end: 'ahead', side: 1 },
    { label: 'GUNTUR / DHONE', match: ['KCC', 'GNT', 'NDL', 'DHNE'], end: 'back', side: -1 },
    { label: 'CHENNAI CENTRAL', match: ['TEL', 'OGL', 'GDR', 'MAS'], end: 'back', side: 1 }
  ],
  BAY: [
    { label: 'HOSAPETE / HUBBALLI', match: ['KDT', 'TNGL', 'HPT', 'UBL'], end: 'ahead', side: -1 },
    { label: 'RAYADURG / DHARMAVARAM', match: ['RDG', 'DMM'], end: 'ahead', side: 1 }
  ],
  HPT: [
    { label: 'HUBBALLI / GOA', match: ['MRB', 'GDG', 'UBL', 'LD', 'VSG'], end: 'ahead', side: -1 },
    { label: 'KOTTURU / HARIHAR', match: ['KBL', 'HRR'], end: 'ahead', side: 1 }
  ],
  UBL: [
    { label: 'LONDA / VASCO DA GAMA', match: ['DWR', 'LWR', 'LD', 'VSG'], end: 'ahead', side: -1 },
    { label: 'DAVANGERE / BENGALURU', match: ['DVG', 'SBC'], end: 'ahead', side: 1 }
  ],
  KYN: [
    { label: 'IGATPURI / NAGPUR', match: ['KSRA', 'IGP', 'NK', 'NGP'], end: 'ahead', side: -1 },
    { label: 'KARJAT / PUNE / WADI', match: ['KJT', 'LNL', 'PUNE', 'WADI'], end: 'ahead', side: 1 },
    { label: 'VASAI ROAD / AHMEDABAD', match: ['BIRD', 'BSR', 'ADI'], end: 'back', side: -1 }
  ],
  NGP: [
    { label: 'NEW DELHI / BHOPAL', match: ['BZU', 'ET', 'BPL', 'NDLS'], end: 'ahead', side: -1 },
    { label: 'RAIPUR / HOWRAH', match: ['G', 'DURG', 'R', 'BSP', 'HWH'], end: 'ahead', side: 1 },
    { label: 'BALHARSHAH / KAZIPET', match: ['SEGM', 'BPQ', 'KZJ'], end: 'back', side: 1 }
  ],
  RC: [
    { label: 'WADI / MUMBAI', match: ['KSN', 'YG', 'WADI', 'KYN'], end: 'ahead', side: -1 },
    { label: 'GADWAL / KURNOOL', match: ['CDBH', 'GWD', 'KRNT'], end: 'ahead', side: 1 }
  ],
  GWD: [
    { label: 'KURNOOL / DHONE', match: ['SBBJ', 'KRNT', 'DHNE'], end: 'ahead', side: 1 },
    { label: 'RAICHUR JN', match: ['PJPR', 'CDBH', 'RC'], end: 'back', side: -1 }
  ],
  DMM: [
    { label: 'BENGALURU CITY', match: ['SSPN', 'HUP', 'YNK', 'SBC'], end: 'ahead', side: -1 },
    { label: 'PAKALA / TIRUPATI', match: ['PAK', 'TPTY'], end: 'ahead', side: 1 }
  ],
  RU: [
    { label: 'TIRUPATI', match: ['TPTY'], end: 'ahead', side: -1 },
    { label: 'CHENNAI CENTRAL', match: ['AJJ', 'PER', 'MAS'], end: 'ahead', side: 1 },
    { label: 'KADAPA / GUNTAKAL', match: ['KOU', 'HX', 'GY', 'GTL'], end: 'back', side: -1 }
  ],
  AJJ: [
    { label: 'RENIGUNTA / GUNTAKAL', match: ['RU', 'TPTY', 'GTL'], end: 'ahead', side: -1 },
    { label: 'KATPADI / BENGALURU', match: ['KPD', 'SBC'], end: 'ahead', side: 1 }
  ],
  GNT: [
    { label: 'VIJAYAWADA JN', match: ['KCC', 'BZA'], end: 'ahead', side: -1 },
    { label: 'TENALI / CHENNAI', match: ['TEL', 'OGL', 'MAS'], end: 'ahead', side: 1 }
  ],
  NZB: [
    { label: 'SECUNDERABAD JN', match: ['KMC', 'MED', 'SC'], end: 'ahead', side: -1 },
    { label: 'KARIMNAGAR / WARANGAL', match: ['ARMR', 'KRMR', 'WL'], end: 'ahead', side: 1 }
  ],
  LD: [
    { label: 'VASCO DA GAMA (GOA)', match: ['CLR', 'QLM', 'VSG'], end: 'ahead', side: -1 },
    { label: 'BELAGAVI / PUNE', match: ['BGM', 'PUNE'], end: 'ahead', side: 1 }
  ],
  ED: [
    { label: 'KARUR / TIRUCHIRAPPALLI', match: ['KRR', 'TPJ'], end: 'ahead', side: 1 },
    { label: 'COIMBATORE / PALAKKAD', match: ['TUP', 'CBE'], end: 'ahead', side: -1 },
    { label: 'SALEM / JOLARPETTAI', match: ['SA', 'JTJ', 'MAS'], end: 'back', side: -1 }
  ],
  SA: [
    { label: 'BENGALURU / HOSUR', match: ['DPJ', 'HSRA', 'SBC'], end: 'ahead', side: -1 },
    { label: 'VRIDDHACHALAM / CHENNAI', match: ['VRI', 'MS'], end: 'ahead', side: 1 },
    { label: 'ERODE / COIMBATORE', match: ['ED', 'TUP', 'CBE'], end: 'back', side: 1 }
  ],
  GDR: [
    { label: 'RENIGUNTA / TIRUPATI', match: ['RU', 'TPTY'], end: 'ahead', side: -1 },
    { label: 'VIJAYAWADA / HOWRAH', match: ['NLR', 'OGL', 'BZA'], end: 'ahead', side: 1 },
    { label: 'CHENNAI CENTRAL', match: ['SPE', 'MAS'], end: 'back', side: -1 }
  ],
  SC: [
    { label: 'KAZIPET / VIJAYAWADA', match: ['BG', 'JN', 'KZJ', 'BZA'], end: 'ahead', side: 1 },
    { label: 'NIZAMABAD / MANMAD', match: ['BMO', 'MED', 'KMC', 'NZB'], end: 'ahead', side: -1 },
    { label: 'WADI / MUMBAI', match: ['LPI', 'VKB', 'WADI'], end: 'back', side: -1 },
    { label: 'KACHEGUDA / KURNOOL', match: ['KCG', 'MBNR', 'GWD', 'KRNT'], end: 'back', side: 1 }
  ],
  PUNE: [
    { label: 'MUMBAI CSMT', match: ['LNL', 'KJT', 'KYN', 'CSMT'], end: 'ahead', side: -1 },
    { label: 'MIRAJ / KOLHAPUR', match: ['MRJ', 'KOP'], end: 'ahead', side: 1 },
    { label: 'DAUND / SOLAPUR', match: ['DD', 'KWV', 'SUR', 'WADI'], end: 'back', side: 1 }
  ],
  DD: [
    { label: 'MANMAD / BHUSAVAL', match: ['ANG', 'MMR', 'BSL'], end: 'ahead', side: -1 },
    { label: 'BARAMATI / SOLAPUR', match: ['KWV', 'SUR'], end: 'back', side: 1 }
  ],
  MMR: [
    { label: 'DAUND / PUNE', match: ['DD', 'PUNE'], end: 'back', side: 1 },
    { label: 'CHALISGAON / DHULE', match: ['CSN', 'DHI'], end: 'ahead', side: -1 },
    { label: 'AURANGABAD / NIZAMABAD', match: ['AWB', 'NED', 'NZB'], end: 'ahead', side: 1 }
  ],
  BSL: [
    { label: 'SURAT / AHMEDABAD', match: ['JL', 'NDB', 'ST', 'ADI'], end: 'ahead', side: -1 },
    { label: 'ITARSI / NEW DELHI', match: ['KNW', 'ET', 'BPL', 'NDLS'], end: 'ahead', side: -1 },
    { label: 'AKOLA / NAGPUR', match: ['AK', 'BD', 'WR', 'NGP'], end: 'ahead', side: 1 }
  ],
  ET: [
    { label: 'JABALPUR / PRAYAGRAJ', match: ['PPI', 'JBP', 'PRYJ'], end: 'ahead', side: 1 },
    { label: 'BHOPAL / NEW DELHI', match: ['BPL', 'BINA', 'VGLJ', 'NDLS'], end: 'ahead', side: -1 },
    { label: 'KHANDWA / BHUSAVAL', match: ['KNW', 'BSL'], end: 'back', side: -1 }
  ],
  BPL: [
    { label: 'UJJAIN / RATLAM', match: ['UJN', 'RTM'], end: 'ahead', side: -1 },
    { label: 'BINA / JHANSI / DELHI', match: ['BINA', 'LAR', 'VGLJ', 'NDLS'], end: 'ahead', side: 1 }
  ],
  BINA: [
    { label: 'KOTA / SAWAI MADHOPUR', match: ['GUNA', 'KOTA'], end: 'ahead', side: -1 },
    { label: 'KATNI / BILASPUR', match: ['SGO', 'KMZ', 'BSP'], end: 'ahead', side: 1 }
  ],
  VGLJ: [
    { label: 'MANIKPUR / PRAYAGRAJ', match: ['MKP', 'PRYJ'], end: 'ahead', side: 1 },
    { label: 'KANPUR CENTRAL', match: ['ORAI', 'CNB'], end: 'ahead', side: 1 },
    { label: 'GWALIOR / AGRA / DELHI', match: ['GWL', 'AGC', 'MTJ', 'NDLS'], end: 'ahead', side: -1 }
  ],
  CNB: [
    { label: 'LUCKNOW / GORAKHPUR', match: ['LKO', 'GKP'], end: 'ahead', side: -1 },
    { label: 'JHANSI / MUMBAI', match: ['VGLJ', 'ET', 'CSMT'], end: 'back', side: 1 }
  ],
  PRYJ: [
    { label: 'VARANASI / PATNA', match: ['BSB', 'PNBE'], end: 'ahead', side: -1 },
    { label: 'SATNA / JABALPUR', match: ['STA', 'JBP'], end: 'back', side: 1 }
  ],
  DDU: [
    { label: 'VARANASI / LUCKNOW', match: ['BSB', 'LKO'], end: 'ahead', side: -1 },
    { label: 'PATNA / HOWRAH', match: ['BXR', 'PNBE', 'HWH'], end: 'ahead', side: 1 }
  ],
  GAYA: [
    { label: 'PATNA JN', match: ['PNBE'], end: 'ahead', side: -1 },
    { label: 'KIUL / BHAGALPUR', match: ['KIUL', 'BGP'], end: 'ahead', side: 1 }
  ],
  ASN: [
    { label: 'ADRA / KHARAGPUR', match: ['ADRA', 'KGP'], end: 'ahead', side: 1 },
    { label: 'JASIDIH / PATNA', match: ['JSME', 'PNBE'], end: 'ahead', side: -1 }
  ],
  KGP: [
    { label: 'TATANAGAR / NAGPUR', match: ['TATA', 'CKP', 'ROU', 'NGP'], end: 'ahead', side: -1 },
    { label: 'BHADRAK / VISAKHAPATNAM', match: ['BLS', 'BHC', 'BBS', 'VSKP'], end: 'ahead', side: 1 },
    { label: 'ADRA / ASANSOL', match: ['ADRA', 'ASN'], end: 'back', side: -1 }
  ],
  BSP: [
    { label: 'KATNI / BINA', match: ['USL', 'KMZ', 'BINA'], end: 'ahead', side: -1 },
    { label: 'JHARSUGUDA / HOWRAH', match: ['JSG', 'ROU', 'TATA', 'HWH'], end: 'ahead', side: 1 }
  ],
  R: [
    { label: 'TITLAGARH / VISAKHAPATNAM', match: ['TIG', 'VZM', 'VSKP'], end: 'ahead', side: 1 },
    { label: 'NAGPUR / MUMBAI', match: ['DURG', 'G', 'NGP'], end: 'back', side: -1 }
  ],
  VSKP: [
    { label: 'VIZIANAGARAM / HOWRAH', match: ['VZM', 'CHE', 'PSA', 'BBS', 'HWH'], end: 'ahead', side: -1 },
    { label: 'ARAKU / KIRANDUL', match: ['ARK', 'KRDL'], end: 'ahead', side: 1 }
  ],
  VZM: [
    { label: 'RAYAGADA / RAIPUR', match: ['RGDA', 'TIG', 'R'], end: 'ahead', side: -1 },
    { label: 'PALASA / BHUBANESWAR', match: ['CHE', 'PSA', 'BBS'], end: 'ahead', side: 1 }
  ],
  KUR: [
    { label: 'PURI', match: ['PURI'], end: 'ahead', side: 1 },
    { label: 'BHUBANESWAR / HOWRAH', match: ['BBS', 'CTC', 'HWH'], end: 'ahead', side: -1 }
  ],
  TEL: [
    { label: 'GUNTUR / DHONE', match: ['GNT', 'NDL', 'DHNE'], end: 'ahead', side: -1 },
    { label: 'REPALLE', match: ['RAL'], end: 'ahead', side: 1 }
  ],
  NDL: [
    { label: 'YERRAGUNTLA / KADAPA', match: ['YA', 'HX'], end: 'ahead', side: 1 },
    { label: 'GUNTUR / VIJAYAWADA', match: ['GID', 'GNT', 'BZA'], end: 'ahead', side: -1 }
  ],
  SLO: [
    { label: 'KAKINADA PORT', match: ['COA', 'CCT'], end: 'ahead', side: 1 },
    { label: 'VISAKHAPATNAM', match: ['ANV', 'TUNI', 'VSKP'], end: 'ahead', side: -1 }
  ],
  NDD: [
    { label: 'BHIMAVARAM / VIJAYAWADA', match: ['BVRM', 'BZA'], end: 'ahead', side: 1 },
    { label: 'RAJAHMUNDRY / VISAKHAPATNAM', match: ['RJY', 'SLO', 'VSKP'], end: 'ahead', side: -1 }
  ],
  DKJ: [
    { label: 'BHADRACHALAM ROAD', match: ['BDCR'], end: 'ahead', side: -1 },
    { label: 'VIJAYAWADA JN', match: ['KMT', 'MDR', 'BZA'], end: 'ahead', side: 1 }
  ],
  PDPL: [
    { label: 'KAZIPET / SECUNDERABAD', match: ['KZJ', 'SC'], end: 'back', side: -1 },
    { label: 'RAMAGUNDAM / NAGPUR', match: ['RDM', 'BPQ', 'NGP'], end: 'ahead', side: 1 }
  ],
  YA: [
    { label: 'NANDYAL / PRODDATUR', match: ['PRDT', 'NDL'], end: 'ahead', side: -1 },
    { label: 'GOOTY / GUNTAKAL', match: ['MOO', 'TU', 'GY', 'GTL'], end: 'ahead', side: 1 }
  ],
  BRC: [
    { label: 'RATLAM / NEW DELHI', match: ['GDA', 'RTM', 'NDLS'], end: 'ahead', side: 1 },
    { label: 'AHMEDABAD JN', match: ['ANND', 'ADI'], end: 'ahead', side: -1 }
  ],
  ADI: [
    { label: 'RAJKOT / OKHA', match: ['VG', 'RJT'], end: 'ahead', side: -1 },
    { label: 'JAIPUR / NEW DELHI', match: ['MSH', 'PNU', 'ABR', 'JP', 'NDLS'], end: 'ahead', side: 1 }
  ],
  JP: [
    { label: 'SAWAI MADHOPUR / KOTA', match: ['SWM', 'KOTA'], end: 'ahead', side: 1 },
    { label: 'ALWAR / NEW DELHI', match: ['DO', 'BKI', 'AWR', 'RE', 'NDLS'], end: 'ahead', side: -1 }
  ],
  AII: [
    { label: 'CHITTORGARH / UDAIPUR', match: ['COR', 'UDZ'], end: 'ahead', side: 1 },
    { label: 'JAIPUR / DELHI', match: ['FL', 'JP', 'NDLS'], end: 'ahead', side: -1 }
  ]
};

export function isJunctionStation(st) {
  return st.category === 'junction' || /\bJN\b/i.test(st.name) || Boolean(JUNCTION_ROUTES[st.code]);
}

function buildBranchTrack(layout, st, { dir, side, label }, group, terrainExtra) {
  const S = st.layout;
  const path = layout.path;
  const line = dir > 0 ? S.exitLine : S.entryLine;
  const main = line === 'D' ? TRACK.MAIN_HALF : 0;
  const lat0 = side * (main + 5.3);
  const sStart = dir > 0 ? S.pEnd + 18 : S.pStart - 18;
  const P0 = path.pointAt(sStart, 0, new THREE.Vector3());
  const H0 = path.headingAt(sStart) + (dir > 0 ? 0 : Math.PI);
  const y0 = path.yAt(sStart);
  const F = { x: Math.sin(H0), z: -Math.cos(H0) };
  const Rt = { x: Math.cos(H0), z: Math.sin(H0) };

  const step = 4;
  const curveStart = 180;
  const totalLen = 1350;
  const radius = 920;
  const maxTurn = (38 * Math.PI) / 180;
  const sm = (a, a0, a1) => smoothstep(a0, a1, a);

  // Diverging branch line: runs parallel briefly, then curves smoothly away
  const pts = [];
  let x = P0.x + Rt.x * lat0, z = P0.z + Rt.z * lat0, th = H0, turned = 0;
  for (let a = 0; a <= totalLen; a += step) {
    if (a <= curveStart) {
      x = P0.x + F.x * a + Rt.x * lat0;
      z = P0.z + F.z * a + Rt.z * lat0;
      th = H0;
    } else {
      let k = 0;
      if (turned < maxTurn) {
        const ramp = Math.min(1, (a - curveStart) / 140);
        k = (side / radius) * ramp;
        turned += Math.abs(k) * step;
      }
      const tm = th + (k * step) / 2;
      x += Math.sin(tm) * step;
      z -= Math.cos(tm) * step;
      th += k * step;
    }
    const n = path.nearest(x, z);
    const g = n.dist < 4000 ? path.groundAt(n.s) : y0;
    const kk = sm(a, 240, 620);
    pts.push({ x, z, th, y: y0 * (1 - kk) + g * kk, a });
  }

  // Turnout connector from our main line onto the branch
  const conn = [];
  for (let a = 15; a <= 115; a += 2) {
    const k = sm(a, 15, 115);
    const lat = side * main + (lat0 - side * main) * k;
    conn.push({
      x: P0.x + F.x * a + Rt.x * lat,
      z: P0.z + F.z * a + Rt.z * lat,
      th: H0 + Math.atan(((lat0 - side * main) * 0.015)),
      y: y0,
      a
    });
  }

  if (terrainExtra) {
    terrainExtra.add(pts, 2);
    terrainExtra.add(conn, 2);
  }

  const tb = new TrackChunkBuilder();
  tb.addTrack(polylineFrames(pts));
  tb.addTrack(polylineFrames(conn));
  tb.build(group);

  buildSideOHE(group, [pts], new THREE.Vector3(1e9, 0, 1e9));

  // Junction direction board beside the split
  const bat = new Batcher();
  const boardA = 140;
  const boardLat = lat0 + side * 4.5;
  const bx = P0.x + F.x * boardA + Rt.x * boardLat;
  const bz = P0.z + F.z * boardA + Rt.z * boardLat;
  const arrowText = side < 0 ? `⬉  ${label}` : `${label}  ➚`;
  bat.box(
    M.textBoard(arrowText, { bg: '#f5c518', fg: '#111', w: 768, h: 192, font: 'bold 54px Arial' }),
    bx, y0 + 3.1, bz, 5.0, 1.25, 0.12, -H0 + (dir > 0 ? 0 : Math.PI), true
  );
  for (const o of [-2.0, 2.0]) {
    bat.box(M.steelDark(), bx + Rt.x * o, y0 + 1.3, bz + Rt.z * o, 0.12, 2.6, 0.12, 0, false);
  }
  group.add(bat.build());
}

export function buildJunctionSplits(st, layout, root, terrainExtra) {
  if (!isJunctionStation(st)) return;
  if (st.code === 'GTL' && (layout.gtl || layout.gtlWest)) return; // Guntakal has dedicated junction builders

  const prev = layout.stations[st.index - 1]?.code;
  const next = layout.stations[st.index + 1]?.code;
  const routes = JUNCTION_ROUTES[st.code];
  const group = new THREE.Group();

  if (routes) {
    // Build split tracks for every connected route that the player is NOT currently travelling on
    let built = 0;
    for (const r of routes) {
      const used = (prev && r.match.includes(prev)) || (next && r.match.includes(next));
      if (used) continue;
      // Pick which end of the station faces away from the player's arrival or towards the departure
      let dir = r.end === 'back' ? -1 : 1;
      if (st.isOrigin) dir = 1;
      if (st.isDest) dir = -1;
      buildBranchTrack(layout, st, { dir, side: r.side, label: r.label }, group, terrainExtra);
      built++;
    }
    // Fallback if all matched (unlikely) or none built
    if (!built) {
      const dir = st.isDest ? -1 : 1;
      buildBranchTrack(layout, st, { dir, side: 1, label: `${st.name} BRANCH LINE` }, group, terrainExtra);
    }
  } else {
    const dir = st.isDest ? -1 : 1;
    buildBranchTrack(layout, st, { dir, side: 1, label: `${st.name.replace(/ JN$/i, '')} BRANCH` }, group, terrainExtra);
  }

  root.add(group);
}
