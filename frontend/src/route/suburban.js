import { STATION_NAMES } from './stationNames.js';

// Suburban simulator: fixed all-stops routes on Mumbai's locals and Hyderabad's MMTS, with every real halt.
// They don't go through the main-line route solver; each route becomes a one-leg plan of the same shape.
const S = (code, name, pf = 2) => ({ code, name, pf });
// stations with loop lines on the MMTS (everything else: just the two running lines with platforms)
const MMTS_LOOPS = new Set(['FM', 'KCG', 'LPI', 'HTCY', 'SNF', 'HYB', 'SC']);

const HYD_FM_SC = [S('FM', 'FALAKNUMA', 3), S('HPG', 'HUPPUGUDA'), S('YKA', 'YAKUTPURA'), S('DQR', 'DABIRPURA'), S('MXT', 'MALAKPET'),
  S('KCG', 'KACHEGUDA', 6), S('VAR', 'VIDYANAGAR'), S('JOO', 'JAMAI OSMANIA'), S('ATC', 'ARTS COLLEGE'), S('STPD', 'SITAPHALMANDI'), S('SC', 'SECUNDERABAD JN', 10)];
const HYD_SC_LPI = [S('SC', 'SECUNDERABAD JN', 10), S('JET', 'JAMES STREET'), S('SJVP', 'SANJEEVAIAH PARK'), S('BMT', 'BEGUMPET', 3), S('NCHS', 'NATURE CURE HOSPITAL'),
  S('FTNR', 'FATEHNAGAR'), S('SNF', 'SANATHNAGAR', 3), S('BTNR', 'BHARATNAGAR'), S('BRBD', 'BORABANDA'), S('HTCY', 'HITEC CITY'), S('HFZ', 'HAFEEZPET'), S('CDNR', 'CHANDANAGAR'), S('LPI', 'LINGAMPALLI', 4)];
const HYD_HYB_BMT = [S('HYB', 'HYDERABAD DECCAN', 6), S('LKPL', 'LAKDIKAPUL'), S('KQD', 'KHAIRATABAD'), S('NCKR', 'NECKLACE ROAD'), S('BMT', 'BEGUMPET', 3)];

const MUM_CENTRAL = [S('CSMT', 'MUMBAI CSMT', 18), S('MSD', 'MASJID'), S('SNRD', 'SANDHURST ROAD'), S('BY', 'BYCULLA', 4), S('CHG', 'CHINCHPOKLI'), S('CRD', 'CURREY ROAD'),
  S('PR', 'PAREL'), S('DR', 'DADAR', 6), S('MTN', 'MATUNGA'), S('SIN', 'SION'), S('CLA', 'KURLA', 6), S('VVH', 'VIDYAVIHAR'), S('GC', 'GHATKOPAR', 4), S('VK', 'VIKHROLI'),
  S('KJRD', 'KANJUR MARG'), S('BND', 'BHANDUP'), S('NHU', 'NAHUR'), S('MLND', 'MULUND'), S('TNA', 'THANE', 8), S('KLVA', 'KALWA'), S('MBQ', 'MUMBRA'), S('DIVA', 'DIVA JN', 4),
  S('KOPR', 'KOPAR'), S('DI', 'DOMBIVLI', 4), S('THK', 'THAKURLI'), S('KYN', 'KALYAN JN', 8)];
const MUM_HARBOUR = [S('CSMT', 'MUMBAI CSMT', 18), S('MSD', 'MASJID'), S('SNRD', 'SANDHURST ROAD'), S('DKRD', 'DOCKYARD ROAD'), S('RRD', 'REAY ROAD'), S('CTGN', 'COTTON GREEN'),
  S('SVE', 'SEWRI'), S('VDLR', 'VADALA ROAD', 4), S('GTBN', 'GURU TEG BAHADUR NAGAR'), S('CHF', 'CHUNABHATTI'), S('CLA', 'KURLA', 6), S('TKNG', 'TILAK NAGAR'), S('CMBR', 'CHEMBUR'),
  S('GV', 'GOVANDI'), S('MNKD', 'MANKHURD'), S('VSH', 'VASHI', 4), S('SNCR', 'SANPADA'), S('JNJ', 'JUINAGAR'), S('NEU', 'NERUL', 4), S('SWDV', 'SEAWOODS DARAVE'),
  S('BEPR', 'BELAPUR CBD', 4), S('KHAG', 'KHARGHAR'), S('MANR', 'MANASAROVAR'), S('KNDS', 'KHANDESHWAR'), S('PNVL', 'PANVEL', 6)];
const MUM_WESTERN = [S('CCG', 'CHURCHGATE', 4), S('MEL', 'MARINE LINES'), S('CYR', 'CHARNI ROAD'), S('GTR', 'GRANT ROAD'), S('MMCT', 'MUMBAI CENTRAL', 5), S('MX', 'MAHALAXMI'),
  S('PL', 'LOWER PAREL'), S('PBHD', 'PRABHADEVI'), S('DDR', 'DADAR', 6), S('MRU', 'MATUNGA ROAD'), S('MM', 'MAHIM JN'), S('BA', 'BANDRA', 6), S('KHAR', 'KHAR ROAD'), S('STC', 'SANTACRUZ'),
  S('VLP', 'VILE PARLE'), S('ADH', 'ANDHERI', 8), S('JOS', 'JOGESHWARI'), S('RMAR', 'RAM MANDIR'), S('GMN', 'GOREGAON', 4), S('MDD', 'MALAD'), S('KILE', 'KANDIVLI'),
  S('BVI', 'BORIVALI', 8), S('DIC', 'DAHISAR'), S('MIRA', 'MIRA ROAD'), S('BYR', 'BHAYANDAR'), S('NIG', 'NAIGAON'), S('BSR', 'VASAI ROAD', 6), S('NSP', 'NALLASOPARA'), S('VR', 'VIRAR', 6)];

export const SUBURBAN = {
  HYD: {
    name: 'Hyderabad (MMTS)', rake: 'MMTS_LOCAL', numberBase: 47150,
    routes: {
      'FM-LPI': { name: 'Falaknuma → Lingampalli (via Secunderabad, Begumpet)', km: 42, stations: [...HYD_FM_SC, ...HYD_SC_LPI.slice(1)] },
      // Secunderabad -> Begumpet -> Necklace Road -> Khairatabad -> Lakdikapul -> Hyderabad (Nampally)
      'FM-HYB': { name: 'Falaknuma → Hyderabad (via Secunderabad, Begumpet, Necklace Road)', km: 27, stations: [...HYD_FM_SC, ...HYD_SC_LPI.slice(1, 4), ...HYD_HYB_BMT.slice(0, 4).reverse()] },
      'HYB-LPI': { name: 'Hyderabad → Lingampalli (via Khairatabad, Begumpet)', km: 27, stations: [...HYD_HYB_BMT, ...HYD_SC_LPI.slice(4)] }
    }
  },
  MUM: {
    name: 'Mumbai (suburban locals)', rake: 'MUMBAI_LOCAL', numberBase: 95101,
    routes: {
      'CSMT-KYN': { name: 'Central line: CSMT → Kalyan (slow)', km: 54, stations: MUM_CENTRAL },
      'CSMT-PNVL': { name: 'Harbour line: CSMT → Panvel', km: 49, stations: MUM_HARBOUR },
      'CCG-VR': { name: 'Western line: Churchgate → Virar (slow)', km: 60, stations: MUM_WESTERN }
    }
  }
};

// names for the station boards / announcements
for (const city of Object.values(SUBURBAN)) for (const r of Object.values(city.routes)) for (const st of r.stations) STATION_NAMES[st.code] ||= st.name;

// One-leg plan (same shape as the route solver's), every station a halt, double line all through.
export function suburbanPlan(cityKey, routeKey, reverse = false) {
  const C = SUBURBAN[cityKey], R = C.routes[routeKey];
  const list = reverse ? R.stations.slice().reverse() : R.stations;
  const simple = (s) => (cityKey === 'HYD' ? !MMTS_LOOPS.has(s.code) : s.pf <= 2);
  const stations = list.map((s) => ({ code: s.code, platforms: simple(s) ? 2 : Math.max(3, s.pf), defaultHalt: true, mandatoryReversal: false, simple: simple(s) }));
  const leg = {
    edgeId: `SUB_${cityKey}_${routeKey}`, from: list[0].code, to: list.at(-1).code, reversed: false, distanceKm: R.km,
    trackType: 'DOUBLE_LINE', biome: 'METRO_SUBURBAN', stations, specialGeometryJson: null
  };
  return { plan: { route: { totalRealKm: R.km, compressedMinutes: Math.round(R.km * 2), legs: [leg] }, crossings: [] }, src: list[0].code, dst: list.at(-1).code, rake: C.rake, name: R.name };
}
