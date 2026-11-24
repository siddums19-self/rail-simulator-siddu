// Global constants for the v6 simulator. All distances are metres unless noted.

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:9010/api';
export const ASSETS_BASE = import.meta.env.VITE_ASSETS_BASE || '';

// Indian Broad Gauge (1676 mm) track geometry.
export const TRACK = {
  MAIN_HALF: 2.65,          // double line: track centres at ±2.65 m (5.3 m spacing)
  RAIL_HALF_GAUGE: 0.873,   // rail centre-line offset from track centre
  RAIL_TOP: 0.64,           // rail top above formation level
  SLEEPER_Y: 0.36,          // sleeper centre above formation
  SLEEPER_SPACING: 0.65,
  PLATFORM_ABOVE_RAIL: 0.76,
  PLATFORM_EDGE: 1.72,      // platform edge distance from track centre
  CONTACT_WIRE: 5.6,        // above rail top
  MAST_SPACING: 54
};

export const PLATFORM_TOP = TRACK.RAIL_TOP + TRACK.PLATFORM_ABOVE_RAIL;

// Hybrid distance scaling: station zones are 1:1, open sections compressed.
export const OPEN_SCALE = 1; // exact distances (1:1); the 'Compact 1:10' option compresses open line
export const MIN_OPEN_WORLD = 1500; // long enough for proper curves between stations

// Streaming windows (in route distance s).
export const STREAM = {
  CHUNK: 200,
  AHEAD: 3400,
  BEHIND: 700,
  STATION_AHEAD: 4200,
  STATION_BEHIND: 1200,
  TERRAIN_TILE: 400,
  TERRAIN_RADIUS: 2600
};

export const RAKES = {
  VANDE_BHARAT:   { label: 'Vande Bharat EMU',         vmax: 160, traction: 'electric', accel: 0.75 },
  LHB:            { label: 'WAP-7 + LHB Express',      vmax: 130, traction: 'electric', accel: 0.55 },
  ICF:            { label: 'WDP-4D + ICF Express',     vmax: 110, traction: 'diesel',   accel: 0.45 },
  RAJDHANI:       { label: 'WAP-7 + Rajdhani (LHB)',   vmax: 130, traction: 'electric', accel: 0.58 },
  DURANTO:        { label: 'WAP-7 + Duranto (LHB)',    vmax: 130, traction: 'electric', accel: 0.56 },
  DEMU_PASSENGER: { label: 'DEMU Local Passenger',     vmax: 90,  traction: 'diesel',   accel: 0.6 },
  BOXN_GOODS:     { label: 'WAG-12B + BOXN Goods',     vmax: 75,  traction: 'electric', accel: 0.32 }
};

export const AI_TRAIN_NAMES = {
  VANDE_BHARAT: ['20704 Vande Bharat Exp', '20701 SC-TPTY Vande Bharat', '20661 SBC-DWR Vande Bharat'],
  LHB: ['12793 Rayalaseema SF', '12627 Karnataka Exp', '12785 Kacheguda SF', '17604 Kacheguda Exp'],
  ICF: ['17225 Amaravati Exp', '16591 Hampi Exp', '17415 Haripriya Exp'],
  RAJDHANI: ['22691 KSR Bengaluru-Hazrat Nizamuddin Rajdhani', '12437 Secunderabad Rajdhani', '20503 Dibrugarh Rajdhani'],
  DURANTO: ['12245 Howrah-Yesvantpur Duranto', '12285 Secunderabad-Nizamuddin Duranto', '22203 Secunderabad-Visakhapatnam Duranto'],
  DEMU_PASSENGER: ['77414 GTL-KRNT DEMU', '77213 Passenger', '07595 MEMU Special'],
  BOXN_GOODS: ['BOXN Coal Rake', 'BCN Container Special', 'BTPN Tank Rake']
};

// Realistic mix for station arrivals/departures and passing traffic.
export const TRAFFIC_MIX = ['LHB', 'LHB', 'LHB', 'ICF', 'ICF', 'ICF', 'DEMU_PASSENGER', 'DEMU_PASSENGER', 'RAJDHANI', 'DURANTO', 'VANDE_BHARAT'];

export const QUALITY = {
  ultra:  { pixelRatio: 2,   shadow: 4096, post: true,  samples: 4, density: 1.0 },
  high:   { pixelRatio: 1.5, shadow: 2048, post: true,  samples: 4, density: 0.8 },
  medium: { pixelRatio: 1,   shadow: 1024, post: false, samples: 0, density: 0.5 }
};
