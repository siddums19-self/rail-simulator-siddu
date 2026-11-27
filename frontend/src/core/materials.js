import * as THREE from 'three/webgpu';
import * as TX from './textures.js';

// Shared material library. Materials are created once and never disposed by
// streamed chunks (only their geometries are).

const lib = new Map();
const nightEmissive = []; // materials whose emissive intensity follows night factor

function get(key, fn) {
  if (!lib.has(key)) lib.set(key, fn());
  return lib.get(key);
}

export function registerNightEmissive(mat, dayIntensity = 0, nightIntensity = 1.6) {
  nightEmissive.push({ mat, dayIntensity, nightIntensity });
  return mat;
}

export function updateNightEmissives(night) {
  for (const e of nightEmissive) e.mat.emissiveIntensity = e.dayIntensity + (e.nightIntensity - e.dayIntensity) * night;
}

export const M = {
  rail: () => get('rail', () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.88, roughness: 0.32 })),
  ballast: () => get('ballast', () => {
    const t = TX.ballastTextures();
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.96, color: 0xffffff });
  }),
  sleeper: () => get('sleeper', () => {
    const t = TX.concreteTextures('#a29e95', 'sleeper');
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.85 });
  }),
  clip: () => get('clip', () => new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.5 })),
  concrete: () => get('concrete', () => {
    const t = TX.concreteTextures('#a8a39a');
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.9 });
  }),
  darkConcrete: () => get('darkConcrete', () => {
    const t = TX.concreteTextures('#7d7870', 'dark');
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.92 });
  }),
  viaduct: () => get('viaduct', () => {
    const t = TX.concreteTextures('#b3ada2', 'via');
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.88 });
  }),
  stonePitch: () => get('stonePitch', () => {
    const t = TX.stonePitchingTexture();
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.95 });
  }),
  steel: () => get('steel', () => new THREE.MeshStandardMaterial({ color: 0x8e979e, metalness: 0.75, roughness: 0.38 })),
  steelDark: () => get('steelDark', () => new THREE.MeshStandardMaterial({ color: 0x3c4248, metalness: 0.7, roughness: 0.45 })),
  galvanised: () => get('galv', () => new THREE.MeshStandardMaterial({ color: 0xa5adb3, metalness: 0.8, roughness: 0.42 })),
  wire: () => get('wire', () => new THREE.MeshStandardMaterial({ color: 0x2e2620, metalness: 0.4, roughness: 0.7 })),
  insulator: () => get('insul', () => new THREE.MeshStandardMaterial({ color: 0x6b3b23, roughness: 0.35, metalness: 0.1 })),
  platformTop: () => get('pfTop', () => {
    const t = TX.platformTileTextures();
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.72 });
  }),
  platformWall: () => get('pfWall', () => {
    const t = TX.concreteTextures('#8f8a80', 'pfwall');
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.92 });
  }),
  tactile: () => get('tactile', () => new THREE.MeshStandardMaterial({ map: TX.tactileTexture(), roughness: 0.6 })),
  whiteEdge: () => get('whiteEdge', () => new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.6 })),
  roofSheet: () => get('roofSheet', () => {
    const t = TX.corrugatedTextures('#8fa3b4');
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide });
  }),
  roofSheetRed: () => get('roofSheetRed', () => {
    const t = TX.corrugatedTextures('#8a3a2a');
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, metalness: 0.45, roughness: 0.5, side: THREE.DoubleSide });
  }),
  fascia: () => get('fascia', () => new THREE.MeshStandardMaterial({ color: 0xe6d6a8, roughness: 0.6 })),
  maroon: () => get('maroon', () => new THREE.MeshStandardMaterial({ color: 0x7c2a1d, roughness: 0.6 })),
  steelGreen: () => get('steelGreen', () => new THREE.MeshStandardMaterial({ color: 0x2f5d50, metalness: 0.5, roughness: 0.5 })),
  steelBlue: () => get('steelBlue', () => new THREE.MeshStandardMaterial({ color: 0x2b4e72, metalness: 0.55, roughness: 0.45 })),
  tubeLight: () => get('tube', () => registerNightEmissive(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 0.2 }), 0.2, 2.0)),
  lampHead: () => get('lampHead', () => registerNightEmissive(new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd28a, emissiveIntensity: 0.1 }), 0.05, 3.2)),
  bench: () => get('bench', () => new THREE.MeshStandardMaterial({ color: 0x6f7c85, metalness: 0.4, roughness: 0.55 })),
  wood: () => get('wood', () => new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.8 })),
  glassDark: () => get('glassDark', () => new THREE.MeshStandardMaterial({ color: 0x111820, metalness: 0.9, roughness: 0.06 })),
  black: () => get('black', () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 })),
  rubber: () => get('rubber', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.95 })),
  asphalt: () => get('asphalt', () => new THREE.MeshStandardMaterial({ map: TX.asphaltTexture(), roughness: 0.92 })),
  plaster: (hex) => get('plaster' + hex, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.88 })),
  brick: () => get('brick', () => new THREE.MeshStandardMaterial({ map: TX.brickWallTexture(), roughness: 0.9 })),
  tank: () => get('tankBlack', () => new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.55 })),
  board: (name, code) => get('board' + name, () => new THREE.MeshStandardMaterial({ map: TX.stationBoardTexture(name, code), roughness: 0.5 })),
  textBoard: (text, opts) => get('tb' + text + JSON.stringify(opts || {}), () => new THREE.MeshStandardMaterial({ map: TX.genericBoardTexture(text, opts), roughness: 0.5 })),
  led: (label) => get('led' + label, () => registerNightEmissive(new THREE.MeshStandardMaterial({ map: TX.ledIndicatorTexture(label), emissiveMap: TX.ledIndicatorTexture(label), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 }), 0.9, 2.2)),
  facade: (name) => get('facade' + name, () => new THREE.MeshStandardMaterial({ map: TX.stationFacadeTexture(name), roughness: 0.85 })),
  facadeSign: (name) => get('fsign' + name, () => registerNightEmissive(new THREE.MeshStandardMaterial({ map: TX.genericBoardTexture(name, { bg: '#7c1d12', fg: '#ffe9a8', w: 2048, h: 160, font: 'bold 110px "Arial Black", Arial' }), emissiveMap: TX.genericBoardTexture(name, { bg: '#000000', fg: '#ffd27a', w: 2048, h: 160, font: 'bold 110px "Arial Black", Arial' }), emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.5 }), 0.15, 2.5)),
  house: (wall, seed, shop) => get(`house${wall}${seed}${shop}`, () => registerNightEmissive(new THREE.MeshStandardMaterial({
    map: TX.houseFacadeTexture(wall, seed, shop),
    emissiveMap: TX.windowGlowTexture(seed),
    emissive: 0xffffff, emissiveIntensity: 0,
    roughness: 0.88
  }), 0, 1.4)),
  field: (kind) => get('field' + kind, () => new THREE.MeshStandardMaterial({ map: TX.fieldTexture(kind), roughness: 0.95 })),
  coal: () => get('coal', () => { const t = TX.coalTexture(); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.9 }); }),
  boxnSide: () => get('boxnSide', () => new THREE.MeshStandardMaterial({ map: TX.boxnSideTexture(), metalness: 0.35, roughness: 0.7 })),
  rust: () => get('rust', () => new THREE.MeshStandardMaterial({ color: 0x5e2c1c, metalness: 0.3, roughness: 0.8 })),
  signalOff: () => get('sigOff', () => new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.3, metalness: 0.2 })),
  leaf: (hex) => get('leaf' + hex, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, side: THREE.DoubleSide })),
  bark: () => get('bark', () => new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.95 })),
  rock: () => get('rock', () => new THREE.MeshStandardMaterial({ color: 0x8a7d70, roughness: 0.95 })),
  vertexColor: () => get('vcol', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })),
  solarPanel: () => get('solar', () => new THREE.MeshStandardMaterial({ color: 0x1a2a4a, metalness: 0.6, roughness: 0.15 })),
  white: () => get('white', () => new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.5 })),
  grass: () => get('grass', () => new THREE.MeshStandardMaterial({ map: TX.grassTuftTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9 })),
  water: () => get('water', () => new THREE.MeshStandardMaterial({ color: 0x2b4650, roughness: 0.04, metalness: 0.15 })),
  mud: () => get('mud', () => new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }))
};
