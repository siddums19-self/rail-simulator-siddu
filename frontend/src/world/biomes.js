// Biome look-and-feel: terrain colours, relief and what grows/stands trackside.
// Keys match corridor_edges.biome in PostgreSQL.

const base = {
  soil: [0.52, 0.36, 0.24], grass: [0.50, 0.50, 0.28], rock: [0.52, 0.48, 0.44], cess: [0.36, 0.31, 0.27],
  hill: 40, hillScale: 1 / 650, hillType: 'ridged', grassiness: 0.4,
  trees: { neem: 8, acacia: 10, palm: 1, tall: 2, banyan: 0.4, khejri: 0 },
  bush: 40, boulder: 2, village: 0.22, fields: ['dry', 'plough', 'sunflower'], fieldCount: 2,
  turbine: 0, solar: 0, sky: { turbidity: 7, rayleigh: 1.4 }, horizon: [0.45, 0.40, 0.38]
};

export const BIOMES = {
  DECCAN_PLATEAU: {
    ...base, soil: [0.50, 0.26, 0.15], grass: [0.40, 0.44, 0.19], rock: [0.55, 0.50, 0.45], cess: [0.33, 0.27, 0.22], grassiness: 0.48,
    hill: 48, hillScale: 1 / 520, hillType: 'ridged', boulder: 7, bush: 80,
    trees: { neem: 6, acacia: 16, palm: 1.5, tall: 1, banyan: 0.4, khejri: 0 },
    turbine: 0.22, solar: 0.08, fields: ['dry', 'sunflower', 'plough', 'cotton'], blackSoil: [0.22, 0.19, 0.17]
  },
  EASTERN_GHATS_DECCAN: {
    ...base, soil: [0.50, 0.33, 0.22], grass: [0.40, 0.48, 0.24], rock: [0.48, 0.45, 0.40],
    hill: 110, hillScale: 1 / 900, hillType: 'fbm', boulder: 3, bush: 50, grassiness: 0.6,
    trees: { neem: 12, acacia: 8, palm: 2, tall: 6, banyan: 0.8, khejri: 0 }, fields: ['paddy', 'plough', 'dry']
  },
  WESTERN_GHATS_URBAN: {
    ...base, soil: [0.45, 0.30, 0.20], grass: [0.27, 0.45, 0.18], rock: [0.38, 0.36, 0.33],
    hill: 240, hillScale: 1 / 1300, hillType: 'fbm', boulder: 1, bush: 70, grassiness: 0.85,
    trees: { neem: 14, acacia: 2, palm: 6, tall: 10, banyan: 1.2, khejri: 0 }, village: 0.45, fields: ['paddy'], fieldCount: 2
  },
  WESTERN_GHATS_PLATEAU: {
    ...base, soil: [0.48, 0.32, 0.22], grass: [0.32, 0.47, 0.20], rock: [0.42, 0.40, 0.36],
    hill: 140, hillScale: 1 / 1100, hillType: 'fbm', grassiness: 0.75,
    trees: { neem: 12, acacia: 4, palm: 8, tall: 8, banyan: 1, khejri: 0 }, fields: ['paddy', 'plough']
  },
  CENTRAL_NORTH_PLAINS: {
    ...base, soil: [0.55, 0.45, 0.32], grass: [0.45, 0.52, 0.25], rock: [0.5, 0.47, 0.42],
    hill: 6, hillScale: 1 / 900, hillType: 'fbm', boulder: 0, bush: 30, grassiness: 0.7,
    trees: { neem: 10, acacia: 3, palm: 0.5, tall: 6, banyan: 1.0, khejri: 0 }, village: 0.4,
    fields: ['wheat', 'mustard', 'plough', 'wheat'], fieldCount: 5
  },
  EAST_COAST_DELTA: {
    ...base, soil: [0.42, 0.36, 0.25], grass: [0.32, 0.55, 0.22], rock: [0.45, 0.43, 0.40],
    hill: 3, hillType: 'fbm', boulder: 0, bush: 35, grassiness: 0.9,
    trees: { neem: 4, acacia: 1, palm: 22, tall: 3, banyan: 0.6, khejri: 0 }, village: 0.45, fields: ['paddy', 'paddy', 'paddy'], fieldCount: 6
  },
  EAST_COAST_BENGAL: {
    ...base, soil: [0.40, 0.35, 0.24], grass: [0.30, 0.55, 0.22], hill: 2, hillType: 'fbm', boulder: 0, grassiness: 0.95,
    trees: { neem: 6, acacia: 1, palm: 18, tall: 4, banyan: 1.2, khejri: 0 }, village: 0.5, fields: ['paddy', 'paddy', 'mustard'], fieldCount: 6
  },
  GODAVARI_COAST: {
    ...base, soil: [0.42, 0.35, 0.24], grass: [0.33, 0.56, 0.22], hill: 4, hillType: 'fbm', boulder: 0, grassiness: 0.9,
    trees: { neem: 5, acacia: 1, palm: 26, tall: 2, banyan: 0.8, khejri: 0 }, village: 0.45, fields: ['paddy', 'paddy'], fieldCount: 6
  },
  KONKAN_COAST: {
    ...base, soil: [0.56, 0.24, 0.14], grass: [0.18, 0.46, 0.15], rock: [0.38, 0.28, 0.22], cess: [0.36, 0.22, 0.16],
    hill: 190, hillScale: 1 / 1100, hillType: 'fbm', boulder: 2, bush: 90, grassiness: 0.92,
    trees: { neem: 16, acacia: 1, palm: 24, tall: 14, banyan: 1.5, khejri: 0 }, village: 0.35, fields: ['paddy', 'paddy'], fieldCount: 4
  },
  NALLAMALA_COASTAL: {
    ...base, soil: [0.45, 0.32, 0.22], grass: [0.30, 0.44, 0.20], rock: [0.45, 0.42, 0.38],
    hill: 170, hillScale: 1 / 1000, hillType: 'fbm', boulder: 2, bush: 80, grassiness: 0.8,
    trees: { neem: 16, acacia: 6, palm: 3, tall: 12, banyan: 1, khejri: 0 }, village: 0.15, fields: ['plough'], fieldCount: 1
  },
  WEST_COAST_GUJARAT: {
    ...base, soil: [0.52, 0.44, 0.32], grass: [0.48, 0.50, 0.28], hill: 5, hillType: 'fbm', boulder: 0, grassiness: 0.55,
    trees: { neem: 8, acacia: 6, palm: 4, tall: 3, banyan: 0.8, khejri: 1 }, village: 0.4, fields: ['cotton', 'wheat', 'plough'], fieldCount: 5
  },
  ARAVALLI_RAJASTHAN: {
    ...base, soil: [0.70, 0.56, 0.38], grass: [0.60, 0.55, 0.36], rock: [0.58, 0.48, 0.40],
    hill: 90, hillScale: 1 / 700, hillType: 'ridged', boulder: 3, bush: 45, grassiness: 0.25,
    trees: { neem: 2, acacia: 8, palm: 0, tall: 0, banyan: 0.2, khejri: 10 }, village: 0.2, fields: ['mustard', 'dry'], fieldCount: 2,
    turbine: 0.12, solar: 0.12, horizon: [0.62, 0.52, 0.42]
  },
  RAJASTHAN_NCR: {
    ...base, soil: [0.66, 0.55, 0.40], grass: [0.55, 0.53, 0.33], hill: 14, hillType: 'fbm', boulder: 0, grassiness: 0.35,
    trees: { neem: 6, acacia: 6, palm: 0, tall: 4, banyan: 0.5, khejri: 6 }, village: 0.45, fields: ['mustard', 'wheat'], fieldCount: 4
  },
  URBAN_SUBURBAN: {
    ...base, soil: [0.48, 0.43, 0.38], grass: [0.42, 0.46, 0.30], hill: 4, hillType: 'fbm', boulder: 0, bush: 20, grassiness: 0.4,
    trees: { neem: 8, acacia: 1, palm: 3, tall: 3, banyan: 0.8, khejri: 0 }, village: 1.0, urban: true, fields: [], fieldCount: 0
  }
};

// suburban railway through a city: buildings right up to the line, few fields
BIOMES.METRO_SUBURBAN = { ...BIOMES.URBAN_SUBURBAN, village: 3.2, bush: 8, grassiness: 0.25, trees: { neem: 5, acacia: 0.5, palm: 2, tall: 2, banyan: 0.5, khejri: 0 }, dense: true };

export const biomeOf = (key) => BIOMES[key] || BIOMES.DECCAN_PLATEAU;

export function blendBiome(b) {
  const A = biomeOf(b.a), B = biomeOf(b.b), t = b.t;
  if (t <= 0.001 || b.a === b.b) return A;
  const mix3 = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  return {
    ...(t < 0.5 ? A : B),
    soil: mix3(A.soil, B.soil), grass: mix3(A.grass, B.grass), rock: mix3(A.rock, B.rock),
    hill: A.hill + (B.hill - A.hill) * t,
    _A: A, _B: B, _t: t
  };
}
