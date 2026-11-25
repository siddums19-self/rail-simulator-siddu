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

// brake: full-service deceleration (m/s²); brakeTau: brake-pipe propagation /
// cylinder fill time constant (s); te/power: goods-style traction model
// (starting tractive effort per unit mass m/s², power per unit mass W/kg).
export const RAKES = {
  VANDE_BHARAT:   { label: 'Vande Bharat EMU',         vmax: 160, traction: 'electric', accel: 0.75, brake: 1.1, brakeTau: 0.9 },
  LHB:            { label: 'WAP-7 + LHB Express',      vmax: 130, traction: 'electric', accel: 0.55, brake: 1.1, brakeTau: 1.4 },
  ICF:            { label: 'WDP-4D + ICF Express',     vmax: 110, traction: 'diesel',   accel: 0.45, brake: 1.0, brakeTau: 1.8 },
  RAJDHANI:       { label: 'WAP-7 + Rajdhani (LHB)',   vmax: 130, traction: 'electric', accel: 0.58, brake: 1.1, brakeTau: 1.4 },
  DURANTO:        { label: 'WAP-7 + Duranto (LHB)',    vmax: 130, traction: 'electric', accel: 0.56, brake: 1.1, brakeTau: 1.4 },
  DEMU_PASSENGER: { label: 'DEMU Local Passenger',     vmax: 90,  traction: 'diesel',   accel: 0.6,  brake: 1.0, brakeTau: 1.0 },
  VANDE_BHARAT_ORANGE: { label: 'Vande Bharat (saffron)', vmax: 160, traction: 'electric', accel: 0.75, brake: 1.1, brakeTau: 0.9 },
  GARIB_RATH:     { label: 'WAP-7 + Garib Rath (all AC 3-tier)', vmax: 130, traction: 'electric', accel: 0.52, brake: 1.1, brakeTau: 1.4, moreStops: true },
  JAN_SHATABDI:   { label: 'WDP-4D + Jan Shatabdi (parrot green)', vmax: 110, traction: 'diesel', accel: 0.47, brake: 1.0, brakeTau: 1.7 },
  ICF_CREAM:      { label: 'WDP-4D + cream ICF coaches', vmax: 110, traction: 'diesel', accel: 0.45, brake: 1.0, brakeTau: 1.8 },
  MUMBAI_LOCAL:   { label: 'Mumbai local EMU (12 car)', vmax: 100, traction: 'electric', accel: 0.9, brake: 1.15, brakeTau: 0.9, suburban: true },
  MMTS_LOCAL:     { label: 'Hyderabad MMTS EMU (9 car)', vmax: 100, traction: 'electric', accel: 0.85, brake: 1.15, brakeTau: 0.9, suburban: true },
  BOXN_GOODS:     { label: '2× WAG-9 + 58 BOXN Goods', vmax: 75,  traction: 'electric', accel: 0.2,  brake: 0.42, brakeTau: 6.5,
                    goods: true, te: 0.19, power: 1.85, wagons: 58, releaseTau: 14, dynBrake: 0.24 }
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
export const TRAFFIC_MIX = ['LHB', 'LHB', 'LHB', 'ICF', 'ICF', 'ICF', 'DEMU_PASSENGER', 'DEMU_PASSENGER', 'RAJDHANI', 'DURANTO', 'VANDE_BHARAT', 'VANDE_BHARAT_ORANGE', 'GARIB_RATH', 'JAN_SHATABDI', 'ICF_CREAM'];

export const QUALITY = {
  ultra:  { pixelRatio: 2,   shadow: 4096, post: true,  samples: 4, density: 1.0 },
  high:   { pixelRatio: 1.5, shadow: 2048, post: true,  samples: 4, density: 0.8 },
  medium: { pixelRatio: 1,   shadow: 1024, post: false, samples: 0, density: 0.5 },
  low:    { pixelRatio: 0.75, shadow: 0,   post: false, samples: 0, density: 0.3, lights: 1 }
};
