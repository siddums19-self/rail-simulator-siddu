import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080/api';
const ASSETS_BASE = import.meta.env.VITE_ASSETS_BASE || '';

// =========================================================================
// 1. HIGH-GRAPHICS WEBGPU RENDERER + ACES FILMIC TONE MAPPING + SHADOWS
// =========================================================================
const renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7db9e8);
scene.fog = new THREE.FogExp2(0x9ec5e5, 0.00038);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.25, 3800);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =========================================================================
// 2. GLTF + DRACO + KTX2 + MESHOPT + HDRI ENVIRONMENT PIPELINE
// =========================================================================
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/basis/');
ktx2Loader.detectSupport(renderer);

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setKTX2Loader(ktx2Loader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

// PBR Environment Map: Instant RoomEnvironment baseline + optional custom HDRI sky.hdr
const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = new RoomEnvironment();
const fallbackEnv = pmrem.fromScene(roomEnv, 0.04).texture;
scene.environment = fallbackEnv;
scene.environmentIntensity = 0.65;
roomEnv.dispose();
pmrem.dispose();

const hdrUrl = `${ASSETS_BASE}/env/sky.hdr`;
const hdrLoader = new HDRLoader();
hdrLoader.load(
  hdrUrl,
  (hdrTex) => {
    hdrTex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdrTex;
    scene.background = hdrTex;
    scene.environmentIntensity = 0.85;
  },
  undefined,
  () => { /* keep procedural 24-hour sky + RoomEnvironment PBR reflections */ }
);

// Dynamic Sun Light with crisp 2048x2048 shadow frustum tracking the train
const sunLight = new THREE.DirectionalLight(0xfff5e4, 2.8);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 5;
sunLight.shadow.camera.far = 420;
sunLight.shadow.camera.left = -120;
sunLight.shadow.camera.right = 120;
sunLight.shadow.camera.top = 120;
sunLight.shadow.camera.bottom = -120;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);
scene.add(sunLight.target);

const hemiLight = new THREE.HemisphereLight(0xbbe0ff, 0x6b533b, 0.8);
scene.add(hemiLight);

// =========================================================================
// 3. PROCEDURAL HIGH-RES PBR TEXTURE SYNTHESIS (ZERO-DOWNLOAD FALLBACKS)
// =========================================================================
function makeProceduralBallastTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a5550';
  ctx.fillRect(0, 0, 512, 512);
  // Crushed granite gravel stones
  for (let i = 0; i < 6500; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const s = 2 + Math.random() * 5;
    const shade = 65 + Math.floor(Math.random() * 65);
    ctx.fillStyle = `rgb(${shade},${shade - 3},${shade - 6})`;
    ctx.fillRect(x, y, s, s * 0.8);
  }
  // PSC Concrete Sleepers every 64px
  for (let y = 16; y < 512; y += 64) {
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(42, y, 428, 20);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(42, y + 17, 428, 4);
    // Pandrol rail clips
    ctx.fillStyle = '#374151';
    ctx.fillRect(145, y + 4, 24, 12);
    ctx.fillRect(343, y + 4, 24, 12);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makePlatformTileTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(0, 0, 512, 512);
  // Granite paving tiles
  for (let y = 0; y < 512; y += 32) {
    for (let x = 0; x < 512; x += 32) {
      const v = 138 + Math.floor(Math.random() * 24);
      ctx.fillStyle = `rgb(${v},${v + 4},${v + 8})`;
      ctx.fillRect(x + 1, y + 1, 30, 30);
    }
  }
  // Iconic Indian Railways yellow tactile safety strips on both platform edges
  ctx.fillStyle = '#eab308';
  ctx.fillRect(16, 0, 22, 512);
  ctx.fillRect(474, 0, 22, 512);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 14, 512);
  ctx.fillRect(498, 0, 14, 512);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 24);
  tex.anisotropy = 8;
  return tex;
}

function makeCorrugatedRoofTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 256; x += 8) {
    ctx.fillStyle = (x % 16 === 0) ? '#1e3a5f' : '#2b4f7c';
    ctx.fillRect(x, 0, 8, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 18);
  return tex;
}

function makeDeccanTerrainTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8b6848';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4500; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const r = 3 + Math.random() * 14;
    ctx.fillStyle = Math.random() > 0.35 ? 'rgba(118,86,54,0.35)' : 'rgba(92,115,62,0.32)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(140, 360);
  tex.anisotropy = 4;
  return tex;
}

function makeCoachSideTexture(bodyHex, stripeHex, isFreight = false) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, 1024, 256);

  if (isFreight) {
    // Ribbed BOXN steel panels
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 20; x < 1024; x += 64) ctx.fillRect(x, 12, 12, 230);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('SCR  BOXN-HL  58T', 340, 145);
  } else {
    // Livery stripe
    ctx.fillStyle = stripeHex;
    ctx.fillRect(0, 152, 1024, 28);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 224, 1024, 32); // Underframe skirt

    // Doors at both ends
    ctx.fillStyle = '#334155';
    ctx.fillRect(24, 42, 48, 178);
    ctx.fillRect(952, 42, 48, 178);

    // Tinted passenger windows with subtle glass reflection
    for (let x = 105; x < 900; x += 82) {
      const grad = ctx.createLinearGradient(x, 58, x, 132);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.45, '#334155');
      grad.addColorStop(1, '#1e293b');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 58, 62, 74);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, 58, 62, 74);
    }
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('INDIAN RAILWAYS', 415, 205);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeStationBoard(text, subText = 'SOUTH CENTRAL RAILWAY') {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 192;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#facc15'; ctx.fillRect(0, 0, 640, 192);
  ctx.strokeStyle = '#111827'; ctx.lineWidth = 12; ctx.strokeRect(8, 8, 624, 176);
  ctx.fillStyle = '#111827'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(text, 320, 96);
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(subText, 320, 146);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 });
}

function makeBuildingFacadeTexture(wallHex) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = wallHex; ctx.fillRect(0, 0, 256, 256);
  for (let y = 26; y < 220; y += 64) {
    for (let x = 24; x < 230; x += 56) {
      ctx.fillStyle = Math.random() > 0.3 ? '#1e293b' : '#fef08a';
      ctx.fillRect(x, y, 30, 36);
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 3;
      ctx.strokeRect(x, y, 30, 36);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ballastTex = makeProceduralBallastTexture();
const platformTileTex = makePlatformTileTexture();
const roofTex = makeCorrugatedRoofTexture();
const terrainTex = makeDeccanTerrainTexture();

// Textured Deccan Terrain
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(6000, 20000),
  new THREE.MeshStandardMaterial({ map: terrainTex, roughness: 0.96, metalness: 0.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.25, -7000);
ground.receiveShadow = true;
scene.add(ground);

// =========================================================================
// 4. WORLD STATE, GUNTAKAL ROR FLYOVER SPLINE & PASSENGER ANIMATION STATE
// =========================================================================
const worldGroup = new THREE.Group();
scene.add(worldGroup);

let signal3DLamps = { g: null, y2: null, y1: null, r: null, feather: null };
let platformNightLights = [];
let animatedPassengers = []; // Procedural articulated people on platforms
let glbPassengerMixers = []; // THREE.AnimationMixer instances if models/passenger.glb is uploaded
let passengerGlbTemplate = null;

// Pre-check for optional rigged passenger.glb (Mixamo / Renderpeople)
gltfLoader.load(`${ASSETS_BASE}/models/passenger.glb`, (gltf) => {
  passengerGlbTemplate = gltf;
}, undefined, () => {});

const GTL_KRNT_PASSENGER_STOPS = [
  { code: 'GTL',  name: 'GUNTAKAL JN (7 PF)',   pf: 7, distM: 0 },
  { code: 'MKR',  name: 'MADDIKERA (1 PF)',     pf: 1, distM: 2250 },
  { code: 'TGL',  name: 'TUGGALI (1 PF)',       pf: 1, distM: 2850 },
  { code: 'EDD',  name: 'EDDULADODDI (1 PF)',   pf: 1, distM: 3300 },
  { code: 'PDL',  name: 'PENDEKALLU (LOOP)',    pf: 2, distM: 3800 },
  { code: 'LMD',  name: 'LINGANENIDODDI',       pf: 1, distM: 4300 },
  { code: 'MYL',  name: 'MALLIYALA',            pf: 1, distM: 4850 },
  { code: 'DHNE', name: 'DHONE JN (4 PF)',      pf: 4, distM: 5500 },
  { code: 'BVO',  name: 'BOGOLU',               pf: 1, distM: 6150 },
  { code: 'VDI',  name: 'VELDURTI (LOOP)',      pf: 2, distM: 6800 },
  { code: 'UKD',  name: 'ULINDAKONDA',          pf: 1, distM: 7450 },
  { code: 'DUU',  name: 'DUPADU',               pf: 1, distM: 8100 },
  { code: 'KRNT', name: 'KURNOOL CITY (3 PF)',  pf: 3, distM: 8800 }
];

const state = {
  hubs: [],
  rosters: [],
  plan: null,
  reversedDirection: false, // false = GTL->DHNE (VV Nagar RIGHT), true = DHNE->GTL (VV Nagar LEFT)
  speedKmph: 0,
  notch: 0,
  brake: 0,
  trackZ: 40,
  maxTrackLength: 9200,
  onLoopTrack: false,
  camMode: 2, // Start in External Chase so train, 7 platforms, people & OHE are immediately clear
  weather: 'CLEAR',
  gameMinutes: 7 * 60 + 15, // Crisp golden-morning 07:15 sunlight
  rakeType: 'LHB',
  activeStations: GTL_KRNT_PASSENGER_STOPS,
  aiTrainZ: 2800
};

function getMainTrackTransform(distM, applyLoop = true) {
  let x = 0, y = 0, z = -distM, yaw = 0;
  if (distM > 1000 && distM <= 2200) {
    const t = (distM - 1000) / 1200;
    const curve = Math.sin(t * Math.PI * 0.5);
    x = curve * 140;
    y = Math.sin(t * Math.PI) * 8.5;
    yaw = -Math.atan2(140 * (Math.PI * 0.5) * Math.cos(t * Math.PI * 0.5), 1200);
  } else if (distM > 2200) {
    x = 140 + (distM - 2200) * 0.12;
    y = 0;
    yaw = -0.12;
  }
  if (applyLoop && state.onLoopTrack && distM > 3300 && distM < 4200) {
    const lt = Math.sin(((distM - 3300) / 900) * Math.PI);
    x += lt * 6.2;
  }
  return { x, y, z, yaw };
}

// =========================================================================
// 5. ANIMATED 3D PASSENGERS (ARTICULATED INDIAN PASSENGERS + PORTERS)
// =========================================================================
function createArticulatedPassenger(isPorter = false) {
  const person = new THREE.Group();
  const shirtColors = [0xe11d48, 0x2563eb, 0xf59e0b, 0x10b981, 0x7c3aed, 0xf97316, 0xe2e8f0];
  const pantColors  = [0x1e293b, 0x334155, 0x451a03, 0x1e3a8a, 0x0f172a];
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc68652, roughness: 0.7 });
  const topMat = new THREE.MeshStandardMaterial({
    color: isPorter ? 0xdc2626 : shirtColors[Math.floor(Math.random() * shirtColors.length)],
    roughness: 0.8
  });
  const bottomMat = new THREE.MeshStandardMaterial({
    color: isPorter ? 0x1e3a8a : pantColors[Math.floor(Math.random() * pantColors.length)],
    roughness: 0.85
  });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), skinMat);
  head.position.y = 1.56;
  head.castShadow = true;
  person.add(head);

  // Torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.38, 4, 8), topMat);
  torso.position.y = 1.12;
  torso.castShadow = true;
  person.add(torso);

  // Articulated Arms & Legs
  const limbGeo = new THREE.CapsuleGeometry(0.055, 0.42, 4, 6);
  const legGeo = new THREE.CapsuleGeometry(0.068, 0.52, 4, 6);

  const leftArm = new THREE.Mesh(limbGeo, topMat);
  leftArm.position.set(-0.22, 1.08, 0);
  const rightArm = new THREE.Mesh(limbGeo, topMat);
  rightArm.position.set(0.22, 1.08, 0);

  const leftLeg = new THREE.Mesh(legGeo, bottomMat);
  leftLeg.position.set(-0.09, 0.42, 0);
  leftLeg.castShadow = true;
  const rightLeg = new THREE.Mesh(legGeo, bottomMat);
  rightLeg.position.set(0.09, 0.42, 0);
  rightLeg.castShadow = true;

  person.add(leftArm, rightArm, leftLeg, rightLeg);

  // Luggage bag (trolley or porter head-trunk)
  const bagMat = new THREE.MeshStandardMaterial({ color: isPorter ? 0x92400e : 0x0f172a, roughness: 0.6 });
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.2), bagMat);
  if (isPorter) {
    bag.position.set(0, 1.88, 0);
  } else {
    bag.position.set(0.36, 0.24, 0.05);
  }
  person.add(bag);

  person.userData = { leftArm, rightArm, leftLeg, rightLeg };
  return person;
}

// =========================================================================
// 6. DETAILED MULTI-PLATFORM INDIAN STATIONS (CANOPIES, FOB, BENCHES, PEOPLE)
// =========================================================================
function buildStation(name, platforms, startDistM) {
  const grp = new THREE.Group();
  const pfMat = new THREE.MeshStandardMaterial({ map: platformTileTex, roughness: 0.78, metalness: 0.05 });
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, metalness: 0.45, roughness: 0.48 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.6, roughness: 0.4 });
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 });
  const fobMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5, roughness: 0.55 });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
  const boardMat = makeStationBoard(name);

  const anchor = getMainTrackTransform(startDistM, false);
  const visiblePfs = Math.min(platforms, 10);
  const length = platforms >= 4 ? 320 : 185;
  const centerIdx = Math.floor(visiblePfs / 2);

  for (let p = 0; p < visiblePfs; p++) {
    const offsetX = anchor.x + (p - centerIdx) * 8.8 + 4.4;
    const centerZ = anchor.z - length * 0.42;

    // Platform Deck with Yellow Safety Edge
    const slab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.15, length), pfMat);
    slab.position.set(offsetX, 0.575, centerZ);
    slab.receiveShadow = true;
    slab.castShadow = true;
    grp.add(slab);

    // Corrugated Blue-Grey Canopy Roof (sloped gable feel)
    const canopyLen = length * 0.68;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.22, canopyLen), roofMat);
    roof.position.set(offsetX, 5.4, centerZ);
    roof.castShadow = true;
    grp.add(roof);

    // Steel Canopy Pillars, Hanging Tube Lights & Concrete Benches
    for (let zOff = -canopyLen * 0.45; zOff <= canopyLen * 0.45; zOff += 24) {
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 4.3, 8), pillarMat);
      pil.position.set(offsetX, 3.25, centerZ + zOff);
      pil.castShadow = true;
      grp.add(pil);

      // Glowing platform tube light strip
      const lampBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 1.8), ledMat);
      lampBar.position.set(offsetX, 5.2, centerZ + zOff + 6);
      grp.add(lampBar);

      // Concrete waiting bench
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.5, 2.4), benchMat);
      bench.position.set(offsetX + 0.6, 1.4, centerZ + zOff + 10);
      bench.castShadow = true;
      grp.add(bench);
    }

    // Yellow Indian Railways Station Nameboard at both ends of platform
    if (p === centerIdx || p === centerIdx - 1) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.25, 0.18), boardMat);
      board.position.set(offsetX, 3.3, anchor.z - 22);
      grp.add(board);
    }

    // Spawn Animated Passengers & Red-Shirt Porters on nearby major platforms
    const peopleCount = (platforms >= 4) ? (p === centerIdx || p === centerIdx - 1 ? 10 : 4) : 4;
    for (let k = 0; k < peopleCount; k++) {
      const isWalker = k % 2 === 0;
      const isPorter = k === 0 && platforms >= 4;
      const pz = centerZ + (Math.random() - 0.5) * (canopyLen * 0.85);
      const px = offsetX + (Math.random() - 0.5) * 2.6;

      let personMesh;
      if (passengerGlbTemplate) {
        personMesh = passengerGlbTemplate.scene.clone();
        if (passengerGlbTemplate.animations?.length) {
          const mixer = new THREE.AnimationMixer(personMesh);
          mixer.clipAction(passengerGlbTemplate.animations[0]).play();
          glbPassengerMixers.push(mixer);
        }
      } else {
        personMesh = createArticulatedPassenger(isPorter);
      }

      personMesh.position.set(px, 1.15, pz);
      personMesh.rotation.y = isWalker ? (Math.random() > 0.5 ? 0 : Math.PI) : (Math.random() > 0.5 ? -Math.PI / 2 : Math.PI / 2);
      grp.add(personMesh);

      animatedPassengers.push({
        mesh: personMesh,
        stationDistM: startDistM,
        baseZ: pz,
        minZ: centerZ - canopyLen * 0.44,
        maxZ: centerZ + canopyLen * 0.44,
        isWalker,
        walkSpeed: isWalker ? (0.8 + Math.random() * 0.65) : 0,
        dir: personMesh.rotation.y === 0 ? 1 : -1,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  // Foot-Over Bridge (FOB) spanning across ALL platforms at multi-platform hubs
  if (visiblePfs >= 2) {
    const spanW = visiblePfs * 8.8 + 4;
    const fobDeck = new THREE.Mesh(new THREE.BoxGeometry(spanW, 0.45, 3.6), fobMat);
    fobDeck.position.set(anchor.x, 7.6, anchor.z - length * 0.48);
    fobDeck.castShadow = true;
    grp.add(fobDeck);

    const fobRoof = new THREE.Mesh(new THREE.BoxGeometry(spanW, 0.2, 4.0), roofMat);
    fobRoof.position.set(anchor.x, 10.4, anchor.z - length * 0.48);
    grp.add(fobRoof);
  }

  // Warm Night Floodlight per station hub
  const stLight = new THREE.PointLight(0xffe4b5, 0, 95, 1.6);
  stLight.position.set(anchor.x + 2, 11, anchor.z - 60);
  grp.add(stLight);
  platformNightLights.push(stLight);

  worldGroup.add(grp);
}

// =========================================================================
// 7. 3D HOODED 4-ASPECT MACL SIGNAL GANTRY
// =========================================================================
function build3DMACLSignal(distM) {
  const anchor = getMainTrackTransform(distM, false);
  const grp = new THREE.Group();
  grp.position.set(anchor.x - 2.9, anchor.y, anchor.z);

  const metalMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.75, roughness: 0.35 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 7.0, 10), metalMat);
  pole.position.y = 3.5;
  pole.castShadow = true;
  grp.add(pole);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 2.35, 0.48),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 })
  );
  head.position.y = 5.4;
  grp.add(head);

  const makeLamp = (yOffset, hex) => {
    const visor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.21, 0.21, 0.35, 10, 1, true, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x020617, side: THREE.DoubleSide })
    );
    visor.rotation.x = Math.PI / 2;
    visor.position.set(0, yOffset + 0.03, 0.36);
    grp.add(visor);

    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 12, 12),
      new THREE.MeshBasicMaterial({ color: hex })
    );
    m.position.set(0, yOffset, 0.26);
    grp.add(m);
    return m;
  };

  const feather = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.22, 0.25),
    new THREE.MeshBasicMaterial({ color: 0x334155 })
  );
  feather.position.set(0.72, 6.75, 0.22);
  feather.rotation.z = Math.PI / 6;
  grp.add(feather);

  signal3DLamps = {
    g: makeLamp(6.15, 0x22c55e),
    y2: makeLamp(5.65, 0x1e293b),
    y1: makeLamp(5.15, 0x1e293b),
    r: makeLamp(4.65, 0x1e293b),
    feather
  };
  worldGroup.add(grp);
}

// =========================================================================
// 8. INSTANCED TRACKS, 25KV OHE WIRES, DECCAN HILLS/TREES & VV NAGAR COLONY
// =========================================================================
function buildCorridorGeometry(isSingleLineAfterFlyover = true, stationList = state.activeStations) {
  worldGroup.clear();
  platformNightLights = [];
  animatedPassengers = [];
  glbPassengerMixers = [];

  state.activeStations = stationList;
  const maxDist = Math.max(6500, (stationList[stationList.length - 1]?.distM || 5800) + 500);
  state.maxTrackLength = maxDist;

  const railMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.92, roughness: 0.18 });
  const ballastSingleMat = new THREE.MeshStandardMaterial({ map: ballastTex, roughness: 0.95 });
  const oheMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.78, roughness: 0.32 });
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
  const viaductMat = new THREE.MeshStandardMaterial({ color: 0x8b8680, roughness: 0.88 });

  // 1. Straight Lower Double-Line continuing to GOOTY (GY) underneath the ROR Flyover
  for (let d = 0; d < 2800; d += 40) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.32, 40.5), ballastSingleMat);
    bed.position.set(-4.6, 0.04, -d);
    bed.receiveShadow = true;
    worldGroup.add(bed);
    for (const rOff of [-6.4, -4.72, -2.9, -1.22]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 40.5), railMat);
      rail.position.set(rOff, 0.26, -d);
      worldGroup.add(rail);
    }
  }

  // 2. Active Corridor Spline (Broad-Gauge Tracks, Viaduct Piers, 25 kV OHE Masts + Catenary Wires)
  const mastPositions = [];
  for (let d = 0; d < maxDist; d += 30) {
    const p1 = getMainTrackTransform(d, false);
    const p2 = getMainTrackTransform(d + 30, false);
    const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2, midZ = (p1.z + p2.z) / 2;
    const isSingle = isSingleLineAfterFlyover && d > 2400;

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(isSingle ? 4.5 : 9.4, p1.y > 0.5 ? 1.5 : 0.32, 31),
      p1.y > 0.5 ? viaductMat : ballastSingleMat
    );
    deck.position.set(midX, midY - (p1.y > 0.5 ? 0.7 : 0.04), midZ);
    deck.rotation.y = p1.yaw;
    deck.receiveShadow = true;
    worldGroup.add(deck);

    // Concrete Viaduct Parapet Walls & Pillars on Guntakal ROR Flyover
    if (p1.y > 0.8) {
      const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 31), viaductMat);
      wallL.position.set(midX - 4.5, midY + 0.5, midZ);
      wallL.rotation.y = p1.yaw;
      const wallR = wallL.clone();
      wallR.position.x = midX + 4.5;
      worldGroup.add(wallL, wallR);

      if (d % 90 === 0) {
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, p1.y, 12), viaductMat);
        pier.position.set(midX, p1.y / 2 - 0.8, midZ);
        pier.castShadow = true;
        worldGroup.add(pier);
      }
    }

    // Indian Broad Gauge (1676 mm) Steel Rails
    const railOffsets = isSingle ? [-0.84, 0.84] : [-0.84, 0.84, 4.2, 5.88];
    for (const ro of railOffsets) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 31), railMat);
      rail.position.set(midX + ro, midY + 0.24, midZ);
      rail.rotation.y = p1.yaw;
      worldGroup.add(rail);
    }

    // Overhead 25 kV AC Contact Wire
    const contactWire = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 31), wireMat);
    contactWire.position.set(midX, midY + 5.85, midZ);
    contactWire.rotation.y = p1.yaw;
    worldGroup.add(contactWire);

    if (d % 90 === 0) {
      mastPositions.push({ x: midX - 3.1, y: midY, z: midZ, isSingle });
    }
  }

  // Instanced 25 kV OHE Masts (1 draw call for entire route)
  const mastMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 7.3, 0.26), oheMat, mastPositions.length);
  const armMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 0.14, 0.14), oheMat, mastPositions.length);
  mastMesh.castShadow = true;
  const dummy = new THREE.Object3D();
  mastPositions.forEach((m, i) => {
    dummy.position.set(m.x, m.y + 3.65, m.z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mastMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(m.x + (m.isSingle ? 2.1 : 4.6), m.y + 6.3, m.z);
    dummy.scale.set(m.isSingle ? 1.0 : 2.2, 1, 1);
    dummy.updateMatrix();
    armMesh.setMatrixAt(i, dummy.matrix);
  });
  worldGroup.add(mastMesh, armMesh);

  // 3. Visible 3D Loop Line Siding at Pendekallu Loop (3300m..4200m)
  for (let d = 3300; d < 4200; d += 30) {
    const p1 = getMainTrackTransform(d, false);
    const lt = Math.sin(((d - 3300) / 900) * Math.PI);
    const lx = p1.x + lt * 6.2;
    const loopBed = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.32, 31), ballastSingleMat);
    loopBed.position.set(lx, p1.y - 0.04, p1.z);
    loopBed.rotation.y = p1.yaw;
    worldGroup.add(loopBed);
    for (const ro of [-0.84, 0.84]) {
      const lr = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 31), railMat);
      lr.position.set(lx + ro, p1.y + 0.24, p1.z);
      lr.rotation.y = p1.yaw;
      worldGroup.add(lr);
    }
  }

  // 4. Instanced Deccan Environment (Hills + Scrub Trees along corridor)
  const treeCount = 260;
  const trunkInst = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.34, 3.2, 7),
    new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.95 }),
    treeCount
  );
  const foliageInst = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(2.3, 1),
    new THREE.MeshStandardMaterial({ color: 0x3b6e38, roughness: 0.9 }),
    treeCount
  );
  foliageInst.castShadow = true;
  for (let i = 0; i < treeCount; i++) {
    const d = 150 + (i / treeCount) * (maxDist - 300);
    const tr = getMainTrackTransform(d, false);
    const side = (i % 2 === 0 ? 1 : -1) * (24 + (i * 19) % 110);
    const sc = 0.75 + ((i * 7) % 10) * 0.08;
    dummy.position.set(tr.x + side, 1.5 * sc, tr.z);
    dummy.scale.set(sc, sc, sc);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(tr.x + side, 3.9 * sc, tr.z);
    dummy.updateMatrix();
    foliageInst.setMatrixAt(i, dummy.matrix);
  }
  worldGroup.add(trunkInst, foliageInst);

  // Deccan Rocky Hills on Horizon
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x7c624b, roughness: 0.98 });
  for (let h = 0; h < 16; h++) {
    const d = 400 + h * 550;
    const tr = getMainTrackTransform(Math.min(d, maxDist - 100), false);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(140 + (h % 3) * 55, 55 + (h % 4) * 28, 7), hillMat);
    hill.position.set(tr.x + (h % 2 === 0 ? 320 : -340), 22, tr.z);
    worldGroup.add(hill);
  }

  // 5. Detailed VV NAGAR COLONY anchored at +45m RIGHT of GTL->DHNE ROR Flyover
  const vvAnchor = getMainTrackTransform(1650, false);
  const vvGroup = new THREE.Group();
  vvGroup.position.set(vvAnchor.x + 45, 0, vvAnchor.z);
  const facadeMats = ['#fef3c7', '#dbeafe', '#fce7f3', '#d1fae5', '#e2e8f0'].map(
    col => new THREE.MeshStandardMaterial({ map: makeBuildingFacadeTexture(col), roughness: 0.85 })
  );
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.5 });
  for (let i = 0; i < 21; i++) {
    const h = 5.5 + (i % 3) * 3.8;
    const bldg = new THREE.Mesh(new THREE.BoxGeometry(11, h, 13), facadeMats[i % facadeMats.length]);
    const bx = (i % 3) * 18, bz = -Math.floor(i / 3) * 20;
    bldg.position.set(bx, h / 2, bz);
    bldg.castShadow = true;
    bldg.receiveShadow = true;
    vvGroup.add(bldg);

    // Rooftop water tank (signature Indian residential silhouette)
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.5, 10), tankMat);
    tank.position.set(bx + 2.2, h + 0.75, bz);
    vvGroup.add(tank);
  }
  const vvBoard = new THREE.Mesh(new THREE.BoxGeometry(15, 3.6, 0.4), makeStationBoard('VV NAGAR COLONY', 'GUNTAKAL'));
  vvBoard.position.set(-7, 7.8, -22);
  vvBoard.rotation.y = -Math.PI / 2;
  vvGroup.add(vvBoard);
  worldGroup.add(vvGroup);

  // 6. Stations + 3D 4-Aspect MACL Signal Gantry
  stationList.forEach(s => buildStation(s.name, s.pf, s.distM));
  build3DMACLSignal(3220);
}

// =========================================================================
// 9. DETAILED MULTI-PART INDIAN TRAINS (WITH ROTATING BOGIES + GLB OVERRIDE)
// =========================================================================
function buildDetailedBogie(zPos) {
  const bogie = new THREE.Group();
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.35 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9, roughness: 0.25 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.42, 3.4), darkSteel);
  frame.position.set(0, 0.68, zPos);
  bogie.add(frame);

  for (const dz of [-1.15, 1.15]) {
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.0, 8), darkSteel);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.48, zPos + dz);
    bogie.add(axle);

    for (const wx of [-0.88, 0.88]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.16, 16), wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.48, zPos + dz);
      bogie.add(wheel);
    }
  }
  return bogie;
}

function buildTrainMesh(rakeType, isPlayer = true) {
  const train = new THREE.Group();
  const palette = {
    VANDE_BHARAT:   { loco: '#f8fafc', stripe: '#ea580c', coach: '#f1f5f9', aero: true,  freight: false, panto: true  },
    LHB:            { loco: '#f1f5f9', stripe: '#dc2626', coach: '#b91c1c', aero: false, freight: false, panto: true  },
    ICF:            { loco: '#1d4ed8', stripe: '#facc15', coach: '#1e40af', aero: false, freight: false, panto: false },
    DEMU_PASSENGER: { loco: '#cbd5e1', stripe: '#0284c7', coach: '#0369a1', aero: false, freight: false, panto: false },
    BOXN_GOODS:     { loco: '#15803d', stripe: '#facc15', coach: '#7c2d12', aero: false, freight: true,  panto: true  }
  }[rakeType] || { loco: '#f1f5f9', stripe: '#dc2626', coach: '#b91c1c', aero: false, freight: false, panto: true };

  // Automatic photorealistic .glb swap if placed in frontend/public/models/ or Cloud Storage models/
  gltfLoader.load(`${ASSETS_BASE}/models/${rakeType.toLowerCase()}.glb`, (gltf) => {
    train.clear();
    gltf.scene.traverse((obj) => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
    train.add(gltf.scene);
  }, undefined, () => { /* keep detailed multi-part procedural train below */ });

  const locoMat = new THREE.MeshStandardMaterial({ color: palette.loco, metalness: 0.35, roughness: 0.35 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: palette.stripe, metalness: 0.2, roughness: 0.4 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.55, roughness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9, roughness: 0.08 });
  const cowCatcherMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.7, roughness: 0.5 });

  // Sculpted Locomotive Body
  const locoBody = new THREE.Mesh(new THREE.BoxGeometry(3.12, 3.25, 19.6), locoMat);
  locoBody.position.set(0, 2.55, 0);
  locoBody.castShadow = true;
  train.add(locoBody);

  // Aerodynamic Nose (Vande Bharat) or Classic Sloped WAP-7/WAG-12 Front Cab
  const nose = new THREE.Mesh(
    palette.aero ? new THREE.ConeGeometry(1.75, 4.2, 4) : new THREE.BoxGeometry(3.08, 1.8, 1.4),
    locoMat
  );
  if (palette.aero) {
    nose.rotation.x = -Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.position.set(0, 2.0, -11.6);
  } else {
    nose.position.set(0, 1.9, -10.1);
  }
  train.add(nose);

  // Livery Stripe + Dark Underframe + Buffer Beam & Cowcatcher
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.16, 0.55, 19.8), stripeMat);
  stripe.position.set(0, 2.15, 0);
  train.add(stripe);

  const cowCatcher = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.55, 0.6), cowCatcherMat);
  cowCatcher.position.set(0, 0.72, -10.4);
  train.add(cowCatcher);

  // Cab Windshield Glass
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.95, 0.16), glassMat);
  windshield.position.set(0, 3.35, -9.85);
  windshield.rotation.x = -0.18;
  train.add(windshield);

  // Curved Locomotive Roof + AC Units
  const locoRoof = new THREE.Mesh(new THREE.CylinderGeometry(1.56, 1.56, 19.4, 12, 1, false, 0, Math.PI), roofMat);
  locoRoof.rotation.z = Math.PI / 2;
  locoRoof.rotation.y = Math.PI / 2;
  locoRoof.scale.set(1, 0.35, 1);
  locoRoof.position.set(0, 4.18, 0);
  train.add(locoRoof);

  // Dual Diamond Pantographs (Electric Locos / Vande Bharat)
  if (palette.panto) {
    const pantoMat = new THREE.MeshStandardMaterial({ color: 0xea580c, metalness: 0.7, roughness: 0.3 });
    for (const pz of [-5.2, 5.2]) {
      const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.35, 0.1), pantoMat);
      arm1.position.set(0, 4.95, pz);
      arm1.rotation.x = 0.45;
      const panHead = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 0.28), pantoMat);
      panHead.position.set(0, 5.6, pz + 0.35);
      train.add(arm1, panHead);
    }
  }

  // Twin Glowing Headlamps + Volumetric Beam
  const lampGlow = new THREE.MeshBasicMaterial({ color: 0xfffbeb });
  for (const lx of [-0.75, 0.75]) {
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12), lampGlow);
    hl.rotation.x = Math.PI / 2;
    hl.position.set(lx, 1.85, -10.55);
    train.add(hl);
  }
  if (isPlayer) {
    const headlight = new THREE.SpotLight(0xfff7d6, 1800, 360, Math.PI / 6.5, 0.45, 1.5);
    headlight.position.set(0, 2.7, -10.5);
    headlight.target.position.set(0, 0.5, -180);
    train.add(headlight, headlight.target);
  }

  // Locomotive Bogies
  train.add(buildDetailedBogie(-6.2), buildDetailedBogie(6.2));

  // Textured Passenger Coaches or BOXN Freight Wagons
  const coachSideTex = makeCoachSideTexture(palette.coach, palette.stripe, palette.freight);
  const coachSideMat = new THREE.MeshStandardMaterial({ map: coachSideTex, roughness: 0.38, metalness: 0.25 });
  const coachEndMat  = new THREE.MeshStandardMaterial({ color: palette.coach, roughness: 0.5 });
  const coachMats = [coachSideMat, coachSideMat, roofMat, cowCatcherMat, coachEndMat, coachEndMat];
  const vestibuleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });

  const count = palette.freight ? 14 : (rakeType === 'DEMU_PASSENGER' ? 6 : 8);
  const len = palette.freight ? 11.2 : 21.5;
  const h = palette.freight ? 2.4 : 3.3;

  for (let i = 1; i <= count; i++) {
    const cz = i * (len + 1.15);
    const coach = new THREE.Mesh(new THREE.BoxGeometry(3.08, h, len), coachMats);
    coach.position.set(0, h / 2 + 0.92, cz);
    coach.castShadow = true;
    coach.receiveShadow = true;
    train.add(coach);

    // Inter-coach rubber gangway / coupler
    const gangway = new THREE.Mesh(new THREE.BoxGeometry(palette.freight ? 0.6 : 1.75, palette.freight ? 0.4 : 2.4, 1.25), vestibuleMat);
    gangway.position.set(0, palette.freight ? 1.0 : 2.35, cz - len / 2 - 0.58);
    train.add(gangway);

    // Bogies per coach
    train.add(buildDetailedBogie(cz - len * 0.34), buildDetailedBogie(cz + len * 0.34));
  }
  return train;
}

let playerTrain = buildTrainMesh('LHB', true);
scene.add(playerTrain);
let aiTrain = buildTrainMesh('BOXN_GOODS', false);
scene.add(aiTrain);

// =========================================================================
// 10. MONSOON RAIN + WEB AUDIO DUAL-TONE HORN SFX
// =========================================================================
const rainCount = 1800;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(rainCount * 3);
for (let i = 0; i < rainCount; i++) {
  rainPos[i * 3] = (Math.random() - 0.5) * 90;
  rainPos[i * 3 + 1] = Math.random() * 45;
  rainPos[i * 3 + 2] = (Math.random() - 0.5) * 130;
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainPoints = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xe2e8f0, size: 0.24, transparent: true, opacity: 0.72 }));
rainPoints.visible = false;
scene.add(rainPoints);

let audioCtx = null;
function playDualHorn() {
  audioCtx = audioCtx || new AudioContext();
  [311, 392].forEach(freq => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.15);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 1.15);
  });
}

// =========================================================================
// 11. LIVE GCP CLOUD RUN / LOCAL SPRING BOOT API INTEGRATION
// =========================================================================
async function loadHubsAndRosters() {
  try {
    const res = await fetch(`${API_BASE}/hubs`);
    state.hubs = await res.json();
  } catch {
    state.hubs = [
      { code: 'GTL', name: 'Guntakal Jn', platforms: 7 }, { code: 'TPTY', name: 'Tirupati', platforms: 6 },
      { code: 'HYB', name: 'Hyderabad Deccan (Nampally)', platforms: 6 }, { code: 'SC', name: 'Secunderabad Jn', platforms: 10 },
      { code: 'RC', name: 'Raichur Jn', platforms: 3 }, { code: 'KRNT', name: 'Kurnool City', platforms: 3 },
      { code: 'GWD', name: 'Gadwal Jn', platforms: 3 }, { code: 'DHNE', name: 'Dhone Jn', platforms: 4 },
      { code: 'WADI', name: 'Wadi Jn', platforms: 4 }, { code: 'SBC', name: 'KSR Bengaluru', platforms: 10 },
      { code: 'MAS', name: 'MGR Chennai Central', platforms: 17 }, { code: 'CSMT', name: 'Mumbai CSMT', platforms: 18 },
      { code: 'NDLS', name: 'New Delhi', platforms: 16 }, { code: 'BZA', name: 'Vijayawada Jn', platforms: 10 },
      { code: 'VSKP', name: 'Visakhapatnam', platforms: 8 }, { code: 'HWH', name: 'Howrah Jn', platforms: 23 },
      { code: 'CBE', name: 'Coimbatore Jn', platforms: 6 }, { code: 'ADI', name: 'Ahmedabad Jn', platforms: 12 },
      { code: 'JP', name: 'Jaipur Jn', platforms: 7 }
    ];
  }
  const srcSel = document.getElementById('sel-src');
  const dstSel = document.getElementById('sel-dst');
  const viaSel = document.getElementById('sel-via');
  state.hubs.forEach(h => {
    const opt = `<option value="${h.code}">${h.name} (${h.code} - ${h.platforms} PF)</option>`;
    srcSel.insertAdjacentHTML('beforeend', opt);
    dstSel.insertAdjacentHTML('beforeend', opt);
    viaSel.insertAdjacentHTML('beforeend', opt);
  });
  srcSel.value = 'GTL'; dstSel.value = 'KRNT';
  await refreshSavedRosters();
}

async function refreshSavedRosters() {
  const rosterSel = document.getElementById('sel-saved-roster');
  rosterSel.innerHTML = '<option value="">-- Load from PostgreSQL --</option>';
  try {
    const res = await fetch(`${API_BASE}/rosters`);
    state.rosters = await res.json();
    state.rosters.forEach((r, idx) => {
      rosterSel.insertAdjacentHTML('beforeend', `<option value="${idx}">${r.trainNumber} ${r.trainName} (${r.sourceCode}->${r.destCode})</option>`);
    });
  } catch { /* offline fallback */ }
}

async function solveRouteFromApi(forceAllStops = false, customViaArray = null) {
  const source = document.getElementById('sel-src').value;
  const dest = document.getElementById('sel-dst').value;
  const viaRaw = document.getElementById('sel-via').value;
  const viaHubs = customViaArray ?? (viaRaw ? viaRaw.split(',').map(s => s.trim()).filter(Boolean) : []);
  state.rakeType = document.getElementById('sel-rake').value;
  const allStopsPassenger = forceAllStops || state.rakeType === 'DEMU_PASSENGER';

  scene.remove(playerTrain);
  playerTrain = buildTrainMesh(state.rakeType, true);
  scene.add(playerTrain);

  if (source === 'GTL' && dest === 'KRNT' && allStopsPassenger) {
    buildCorridorGeometry(true, GTL_KRNT_PASSENGER_STOPS);
    document.getElementById('route-title').textContent = '77414 Guntakal -> Kurnool City Passenger (123 km • All 13 Stops)';
    document.getElementById('route-meta').textContent = 'Dep 04:40 GTL -> ROR Flyover (VV Nagar RIGHT) -> Dhone -> Arr 07:30 KRNT';
  }

  try {
    const res = await fetch(`${API_BASE}/routes/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, dest, viaHubs, allStopsPassenger })
    });
    state.plan = await res.json();
    const legs = state.plan.route.legs;
    const viaLabel = viaHubs.length ? ` via ${viaHubs.join('->')}` : '';
    document.getElementById('route-title').textContent =
      `${source} -> ${dest}${viaLabel} (${state.plan.route.totalRealKm} km | ~${state.plan.route.compressedMinutes} min)`;
    const stHtml = legs.map(l =>
      `<div><strong>${l.from}->${l.to}</strong> [${l.trackType}]: ` +
      l.stations.map(s => s.defaultHalt ? `<b>${s.code}(${s.platforms}PF)</b>` : `${s.code}*`).join(' -> ') + `</div>`
    ).join('');
    const crHtml = state.plan.crossings.slice(0, 4).map(c =>
      `<div style="color:#fbbf24;">Crossing @ ${c.stationCode}: ${c.eventType} vs ${c.oncomingTrainName}</div>`
    ).join('');
    document.getElementById('solved-stations').innerHTML = stHtml + crHtml;

    if (!(source === 'GTL' && dest === 'KRNT' && allStopsPassenger) && legs.length > 0) {
      const firstLeg = legs[0];
      const st = firstLeg.stations;
      const midName = st.length > 2 ? `${st[1].code} (LOOP)` : 'CROSSING LOOP';
      buildCorridorGeometry(
        firstLeg.trackType.includes('SINGLE') || firstLeg.edgeId === 'GTL_TO_DHNE_FLYOVER',
        [
          { code: st[0].code, name: `${st[0].code} (${st[0].platforms} PF)`, pf: st[0].platforms, distM: 0 },
          { code: st[1]?.code || 'LOOP', name: midName, pf: 2, distM: 3550 },
          { code: st[st.length - 1].code, name: `${st[st.length - 1].code} (${st[st.length - 1].platforms} PF)`, pf: st[st.length - 1].platforms, distM: 5800 }
        ]
      );
    }
    state.trackZ = 40; state.speedKmph = 0; state.notch = 0;
  } catch {
    if (source === 'GTL' && dest === 'KRNT' && allStopsPassenger) {
      document.getElementById('solved-stations').innerHTML =
        '<div><strong>77414 GTL-KRNT DEMU (Offline Preview):</strong> GTL -> MKR -> TGL -> EDD -> PDL -> LMD -> MYL -> DHNE -> BVO -> VDI -> UKD -> DUU -> KRNT (123 km)</div>';
    } else {
      document.getElementById('solved-stations').textContent = 'Running offline fallback (start Spring Boot API to query PostgreSQL).';
    }
  }
}

// =========================================================================
// 12. UI EVENT WIRING
// =========================================================================
document.getElementById('btn-toggle-builder').onclick = () => {
  const m = document.getElementById('route-modal');
  m.style.display = m.style.display === 'block' ? 'none' : 'block';
};
document.getElementById('sel-saved-roster').onchange = (e) => {
  const r = state.rosters[Number(e.target.value)];
  if (!r) return;
  document.getElementById('sel-src').value = r.sourceCode;
  document.getElementById('sel-dst').value = r.destCode;
  document.getElementById('sel-rake').value = r.coachType;
  const viaArr = r.viaCodesCsv ? r.viaCodesCsv.split(',').map(s => s.trim()).filter(Boolean) : [];
  solveRouteFromApi(r.coachType === 'DEMU_PASSENGER', viaArr);
};
document.getElementById('preset-tpty-rc-wadi').onclick = () => {
  document.getElementById('sel-src').value = 'TPTY'; document.getElementById('sel-dst').value = 'HYB';
  document.getElementById('sel-via').value = 'GTL,RC,WADI'; document.getElementById('sel-rake').value = 'LHB';
  solveRouteFromApi(false, ['GTL', 'RC', 'WADI']);
};
document.getElementById('preset-tpty-rc-gwd').onclick = () => {
  document.getElementById('sel-src').value = 'TPTY'; document.getElementById('sel-dst').value = 'HYB';
  document.getElementById('sel-via').value = 'RC'; document.getElementById('sel-rake').value = 'LHB';
  solveRouteFromApi(false, ['GTL', 'RC', 'GWD']);
};
document.getElementById('preset-tpty-krnt').onclick = () => {
  document.getElementById('sel-src').value = 'TPTY'; document.getElementById('sel-dst').value = 'HYB';
  document.getElementById('sel-via').value = 'GTL,KRNT'; document.getElementById('sel-rake').value = 'LHB';
  solveRouteFromApi(false, ['GTL', 'KRNT']);
};
document.getElementById('preset-gtl-krnt-pass').onclick = () => {
  document.getElementById('sel-src').value = 'GTL'; document.getElementById('sel-dst').value = 'KRNT';
  document.getElementById('sel-via').value = 'DHNE'; document.getElementById('sel-rake').value = 'DEMU_PASSENGER';
  state.gameMinutes = 4 * 60 + 40;
  solveRouteFromApi(true, ['DHNE']);
};
document.getElementById('btn-solve-route').onclick = () => solveRouteFromApi(false);
document.getElementById('btn-save-roster').onclick = async () => {
  try {
    const src = document.getElementById('sel-src').value;
    const dst = document.getElementById('sel-dst').value;
    const via = document.getElementById('sel-via').value;
    const isPass = state.rakeType === 'DEMU_PASSENGER';
    const res = await fetch(`${API_BASE}/rosters`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trainNumber: isPass ? '77414' : '12799',
        trainName: isPass ? 'Guntakal - Kurnool City Passenger (DEMU)' : `${src} - ${dst} Custom Express`,
        priorityTier: isPass ? 'PASSENGER' : 'SUPERFAST',
        coachType: state.rakeType, locoClass: isPass ? 'DEMU-1400HP' : 'WAP-7',
        sourceCode: src, destCode: dst, viaCodesCsv: via,
        haltsCsv: isPass ? 'GTL,MKR,TGL,EDD,PDL,LMD,MYL,DHNE,BVO,VDI,UKD,DUU,KRNT' : `${src},${via || 'GTL'},${dst}`
      })
    });
    if (!res.ok) throw new Error('Save failed');
    await refreshSavedRosters();
    alert('Custom roster saved to PostgreSQL.');
  } catch {
    alert('Could not reach backend API. Verify Spring Boot is running on localhost:8080.');
  }
};
document.getElementById('btn-reverse-dir').onclick = () => {
  state.reversedDirection = !state.reversedDirection;
  state.trackZ = state.reversedDirection ? 2400 : 800;
  document.getElementById('route-meta').textContent = state.reversedDirection
    ? 'Inbound DHNE -> GTL • Descending ROR Flyover • VV Nagar Colony: LEFT'
    : 'Outbound GTL -> DHNE • Climbing ROR Flyover • VV Nagar Colony: RIGHT';
};
document.getElementById('btn-n-up').onclick = () => { state.notch = Math.min(8, state.notch + 1); state.brake = 0; };
document.getElementById('btn-n-dn').onclick = () => { state.notch = Math.max(0, state.notch - 1); };
document.getElementById('btn-brk').onclick = () => { state.brake = Math.min(100, state.brake + 25); state.notch = 0; };
document.getElementById('btn-horn').onclick = playDualHorn;
document.getElementById('btn-switch').onclick = () => { state.onLoopTrack = !state.onLoopTrack; };
document.getElementById('sel-cam').onchange = (e) => { state.camMode = Number(e.target.value); };
document.getElementById('sel-weather').onchange = (e) => { state.weather = e.target.value; };
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyW') document.getElementById('btn-n-up').click();
  if (e.code === 'KeyS') document.getElementById('btn-n-dn').click();
  if (e.code === 'Space') document.getElementById('btn-brk').click();
  if (e.code === 'KeyH') playDualHorn();
});

// =========================================================================
// 13. SHADER PRE-COMPILATION & 60 FPS SIMULATION LOOP
// =========================================================================
function updateSignalHUDAnd3D(aspect, featherText, featherLit) {
  ['lamp-g', 'lamp-y2', 'lamp-y1', 'lamp-r'].forEach(id => document.getElementById(id).className = 'lamp');
  if (aspect === 'RED') document.getElementById('lamp-r').classList.add('red');
  if (aspect === 'YELLOW') document.getElementById('lamp-y1').classList.add('yellow');
  if (aspect === 'DOUBLE_YELLOW') {
    document.getElementById('lamp-y1').classList.add('yellow');
    document.getElementById('lamp-y2').classList.add('yellow');
  }
  if (aspect === 'GREEN') document.getElementById('lamp-g').classList.add('green');
  document.getElementById('signal-label').textContent = aspect;
  document.getElementById('feather-label').textContent = featherText;

  if (signal3DLamps.r) {
    signal3DLamps.g.material.color.setHex(aspect === 'GREEN' ? 0x22c55e : 0x1e293b);
    signal3DLamps.y2.material.color.setHex(aspect === 'DOUBLE_YELLOW' ? 0xeab308 : 0x1e293b);
    signal3DLamps.y1.material.color.setHex((aspect === 'YELLOW' || aspect === 'DOUBLE_YELLOW') ? 0xeab308 : 0x1e293b);
    signal3DLamps.r.material.color.setHex(aspect === 'RED' ? 0xef4444 : 0x1e293b);
    signal3DLamps.feather.material.color.setHex(featherLit ? 0xf8fafc : 0x334155);
  }
}

buildCorridorGeometry(true, GTL_KRNT_PASSENGER_STOPS);
loadHubsAndRosters();

// Pre-compile WebGPU/WebGL2 shaders upfront to eliminate first-frame stutter
try {
  await renderer.compileAsync(scene, camera);
} catch { /* non-blocking if unsupported */ }

document.getElementById('backend-badge').textContent =
  renderer.backend?.isWebGPUBackend ? 'WebGPU PBR Active' : 'WebGL2 PBR Fallback';
const overlay = document.getElementById('loader-overlay');
overlay.style.opacity = '0';
setTimeout(() => overlay.remove(), 420);

let lastTimeMs = performance.now();
renderer.setAnimationLoop(() => {
  const nowMs = performance.now();
  const dt = Math.min((nowMs - lastTimeMs) / 1000, 0.05);
  lastTimeMs = nowMs;

  // Natural 24-hour cycle (1 real hr = 24 game hrs)
  state.gameMinutes = (state.gameMinutes + dt * 0.4) % 1440;
  const hrs = Math.floor(state.gameMinutes / 60), mins = Math.floor(state.gameMinutes % 60);
  document.getElementById('clock-txt').textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  const sunAngle = ((state.gameMinutes / 1440) * Math.PI * 2) - Math.PI / 2;
  const dayFactor = Math.max(0.06, Math.sin(sunAngle));
  sunLight.intensity = dayFactor * 2.8;
  const nightIntensity = Math.max(0, 1.0 - dayFactor * 2.2) * 1200;
  platformNightLights.forEach(l => { l.intensity = nightIntensity; });

  if (scene.background?.isColor) {
    scene.background.setRGB(0.06 + dayFactor * 0.44, 0.10 + dayFactor * 0.64, 0.19 + dayFactor * 0.74);
  }

  // Weather FX
  rainPoints.visible = state.weather === 'MONSOON';
  if (rainPoints.visible) {
    rainPoints.position.set(playerTrain.position.x, 0, playerTrain.position.z - 20);
  }
  scene.fog.density = state.weather === 'FOG' ? 0.0082 : (state.weather === 'MONSOON' ? 0.0020 : 0.00036);

  // Train Physics
  const maxSpd = { VANDE_BHARAT: 160, LHB: 130, ICF: 110, DEMU_PASSENGER: 90, BOXN_GOODS: 75 }[state.rakeType];
  const brakeGrip = state.weather === 'MONSOON' ? 0.65 : 1.0;
  const accel = (state.notch * 1.45) - (state.brake * 0.16 * brakeGrip) - 0.12;
  state.speedKmph = Math.max(0, Math.min(maxSpd, state.speedKmph + accel * dt * 4.5));

  const dirSign = state.reversedDirection ? -1 : 1;
  state.trackZ = Math.max(0, Math.min(state.maxTrackLength - 200, state.trackZ + dirSign * (state.speedKmph / 3.6) * dt));

  const tf = getMainTrackTransform(state.trackZ, true);
  playerTrain.position.set(tf.x, tf.y, tf.z);
  playerTrain.rotation.y = tf.yaw + (state.reversedDirection ? Math.PI : 0);

  // Keep Crisp Shadow Frustum Locked Around Player Train
  sunLight.position.set(tf.x + Math.cos(sunAngle) * 140, tf.y + Math.max(35, Math.sin(sunAngle) * 180), tf.z + 75);
  sunLight.target.position.set(tf.x, tf.y, tf.z - 25);

  // Animate Platform People ONLY within 450m of the player train (60 FPS budget)
  glbPassengerMixers.forEach(m => m.update(dt));
  for (let i = 0; i < animatedPassengers.length; i++) {
    const p = animatedPassengers[i];
    if (Math.abs(state.trackZ - p.stationDistM) > 450) continue;
    p.phase += dt * (p.isWalker ? 5.8 : 1.6);
    if (p.isWalker) {
      p.mesh.position.z += p.dir * p.walkSpeed * dt;
      if (p.mesh.position.z > p.maxZ || p.mesh.position.z < p.minZ) {
        p.dir *= -1;
        p.mesh.rotation.y = p.dir > 0 ? 0 : Math.PI;
      }
      const swing = Math.sin(p.phase) * 0.42;
      if (p.mesh.userData.leftLeg) {
        p.mesh.userData.leftLeg.rotation.x = swing;
        p.mesh.userData.rightLeg.rotation.x = -swing;
        p.mesh.userData.leftArm.rotation.x = -swing * 0.7;
        p.mesh.userData.rightArm.rotation.x = swing * 0.7;
      }
    } else if (p.mesh.userData.leftArm) {
      p.mesh.userData.leftArm.rotation.z = Math.sin(p.phase) * 0.06;
    }
  }

  // Single-Line Crossing Simulation at Pendekallu Loop
  const crossingBanner = document.getElementById('crossing-banner');
  if (!state.reversedDirection && state.trackZ > 3050 && state.trackZ < 4200) {
    state.onLoopTrack = true;
    state.aiTrainZ += 24 * dt;
    if (state.trackZ < 3350) {
      updateSignalHUDAnd3D('YELLOW', 'Route Feather ON — Enter Loop <= 30 km/h', true);
      crossingBanner.style.display = 'none';
    } else if (state.aiTrainZ < 4500) {
      updateSignalHUDAnd3D('RED', 'Loop Line (30 km/h) — Wait for Goods Crossing', true);
      crossingBanner.style.display = 'block';
    } else {
      updateSignalHUDAnd3D('GREEN', 'Crossing Complete — Clear to Proceed', false);
      crossingBanner.style.display = 'none';
    }
  } else {
    state.aiTrainZ = 2800;
    updateSignalHUDAnd3D('GREEN', `Mainline ${maxSpd} km/h`, false);
    crossingBanner.style.display = 'none';
  }
  const aiTf = getMainTrackTransform(Math.max(0, Math.min(state.maxTrackLength - 200, 7200 - state.aiTrainZ)), false);
  aiTrain.position.set(aiTf.x + (state.trackZ < 2400 ? 5.0 : 0), aiTf.y, aiTf.z);
  aiTrain.rotation.y = aiTf.yaw + Math.PI;

  // 6 Camera Perspectives
  const fwd = state.reversedDirection ? 1 : -1;
  if (state.camMode === 0) {
    camera.position.set(tf.x, tf.y + 3.35, tf.z + fwd * 9.8);
    camera.lookAt(tf.x, tf.y + 2.5, tf.z + fwd * 85);
  } else if (state.camMode === 1) {
    camera.position.set(tf.x + 2.15, tf.y + 3.2, tf.z + fwd * 8.2);
    camera.lookAt(tf.x + 2.5, tf.y + 2.0, tf.z + fwd * 90);
  } else if (state.camMode === 2) {
    camera.position.set(tf.x + 15, tf.y + 10.5, tf.z - fwd * 29);
    camera.lookAt(tf.x, tf.y + 2.6, tf.z + fwd * 20);
  } else if (state.camMode === 3) {
    camera.position.set(tf.x + 20, tf.y + 3.4, tf.z + fwd * 36);
    camera.lookAt(tf.x, tf.y + 2.5, tf.z);
  } else if (state.camMode === 4) {
    camera.position.set(tf.x + 1.85, tf.y + 2.7, tf.z - fwd * 32);
    camera.lookAt(tf.x + 42, tf.y + 2.3, tf.z - fwd * 32);
  } else {
    camera.position.set(tf.x + 48, tf.y + 68, tf.z + 48);
    camera.lookAt(tf.x, tf.y, tf.z + fwd * 30);
  }

  // HUD Updates
  document.getElementById('speed-txt').textContent = Math.round(state.speedKmph);
  document.getElementById('notch-txt').textContent = `N${state.notch}`;
  document.getElementById('brake-txt').textContent = `${state.brake}%`;
  document.getElementById('km-txt').textContent = (state.trackZ / 1000).toFixed(2);

  let statusTxt = 'Open Section';
  if (state.trackZ >= 1000 && state.trackZ <= 2100) {
    statusTxt = state.reversedDirection
      ? 'Guntakal ROR Flyover — VV Nagar Colony on LEFT'
      : 'Guntakal ROR Flyover — VV Nagar Colony on RIGHT';
  } else {
    const nearest = state.activeStations.find(s => Math.abs(state.trackZ - s.distM) < 260);
    if (nearest) statusTxt = `At ${nearest.name}`;
  }
  document.getElementById('next-st-txt').textContent = statusTxt;

  renderer.render(scene, camera);
});
