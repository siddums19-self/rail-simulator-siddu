import * as THREE from 'three/webgpu';
import { loadStationManifest } from './world/stationModels.js';
import { animateCrew, animateWipers } from './trains/cabInterior.js';
import { pass, saturation, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { API_BASE, RAKES, QUALITY, TRACK } from './config.js';
import { setMaxAnisotropy } from './core/textures.js';
import { updateNightEmissives } from './core/materials.js';
import { buildRouteLayout } from './route/layout.js';
import { solveOffline, OFFLINE_HUBS, applyOverrides } from './route/offlineSolver.js';
import { World } from './world/world.js';
import { SkySystem } from './world/sky.js';
import { Consist, setupGltf, LOCOS, isMultipleUnit, defaultLoco } from './trains/consist.js';
import { Timetable, fmtClock, minDiff } from './timetable.js';
import { Incidents } from './incidents.js';
import { isRajdhaniRoute } from './route/trainNames.js';
import { StationMaster, SM_STATIONS } from './stationMaster.js';
import { SectionGame } from './sectionGame.js';
import { SMWorld, SM_ROUTES } from './smWorld.js';
import { SUBURBAN, suburbanPlan } from './route/suburban.js';
import { Boarding } from './boarding.js';
import { Multiplayer } from './multiplayer.js';
import { CabRealism } from './cab.js';
import { festivalToday, FESTIVAL_LABEL, Kites } from './world/festivals.js';
import { Cattle } from './world/cattle.js';
import { LATLON } from './route/trainNames.js';
import { ControlRoom } from './control.js';
import { WeatherOps } from './weather.js';
import { planRunRound, RunRound } from './shunting.js';
import { setPantograph } from './trains/rollingStock.js';
import { Scorer } from './score.js';
import { drawDashboard, drawRecorder } from './ui/dashboard.js';
import { StationAudio } from './audio/stationAudio.js';
import { spokenName } from './route/stationScripts.js';
import { AudioEngine } from './audio/audioEngine.js';
import { CameraRig, CAMERA_MODES } from './ui/cameraRig.js';
import { Operations, Traffic, LOOP_LIMIT } from './ops.js';
import { preloadPassengerGlb } from './world/people.js';
import { ACHIEVEMENTS } from './ui/career.js';
import { Account, rankOf } from './ui/career.js';

const $ = (id) => document.getElementById(id);
const loader = {
  set(msg, pct) { $('loader-msg').textContent = msg; if (pct !== undefined) $('loader-bar').style.width = `${pct}%`; },
  show() { const el = $('loader'); el.style.display = 'flex'; el.style.opacity = '1'; },
  hide() { const el = $('loader'); el.style.opacity = '0'; setTimeout(() => { el.style.display = 'none'; }, 500); }
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ======================================================================
// Renderer, scene, post-processing
// ======================================================================
const params = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// iPhone / iPad (any browser there is WebKit; iPadOS reports itself as a Mac with touch)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = () => isIOS || (isTouch && Math.min(innerWidth, innerHeight) < 900);
const syncDevice = () => {
  document.body.classList.toggle('mobile', isMobile() || innerWidth < 760);
  document.body.classList.toggle('touch', isTouch);
  document.body.classList.toggle('portrait', innerHeight > innerWidth);
};
syncDevice();
addEventListener('resize', syncDevice);
addEventListener('orientationchange', () => setTimeout(syncDevice, 200));
let qualityKey = params.get('q') || localStorageGet('railsim.quality') || (isMobile() ? 'medium' : 'high');
if (isIOS && qualityKey !== 'medium' && !params.get('q')) qualityKey = 'medium'; // iOS WebKit runs out of GPU memory above this
let Q = QUALITY[qualityKey] || QUALITY.high;

const renderer = new THREE.WebGPURenderer({ antialias: !Q.post, powerPreference: 'high-performance', forceWebGL: params.has('webgl') || (isIOS && !params.has('webgpu')) });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isIOS ? 1 : Q.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.touchAction = 'none';
renderer.toneMapping = THREE.NeutralToneMapping; // ACES crushed contrast and greyed the colours
renderer.toneMappingExposure = 0.65;
renderer.exposureScale = 1.18;                    // the sky drives exposure; neutral needs a little more
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
loader.set('Initialising WebGPU…', 5);
await renderer.init();
const isWebGPU = !!renderer.backend?.isWebGPUBackend;
setMaxAnisotropy(renderer.getMaxAnisotropy ? renderer.getMaxAnisotropy() : 8);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 7000);
const sky = new SkySystem(renderer, scene);
sky.setShadowSize(Q.shadow);

const ktx2 = new KTX2Loader();
ktx2.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/basis/');
try { ktx2.detectSupport(renderer); } catch { /* optional */ }
setupGltf(renderer, ktx2);

let pipeline = null, bloomNode = null;
function setupPost() {
  pipeline = null;
  if (!Q.post) return;
  try {
    pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: Q.samples });
    const color = scenePass.getTextureNode('output');
    bloomNode = bloom(color, 0.22, 0.4, 1.1);
    pipeline.outputNode = saturation(color.add(bloomNode), float(1.22)); // richer, Indian-summer colours
  } catch (e) {
    console.warn('Post-processing unavailable, rendering direct.', e);
    pipeline = null;
  }
}
setupPost();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Monsoon rain streaks (instanced quads around the camera)
const rain = (() => {
  const n = 3200;
  const geo = new THREE.PlaneGeometry(0.018, 0.75);
  const mat = new THREE.MeshBasicMaterial({ color: 0xc9d6e3, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m.makeRotationY(Math.random() * Math.PI);
    m.setPosition((Math.random() - 0.5) * 70, Math.random() * 40, (Math.random() - 0.5) * 70);
    mesh.setMatrixAt(i, m);
  }
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
})();

// ======================================================================
// State
// ======================================================================
const audio = new AudioEngine();
audio.onLightning = (dist) => { state.flash = 1 - dist * 0.6; };
const rig = new CameraRig(camera, renderer.domElement, (x, z) => (world ? world.terrain.heightAt(x, z) : 0));
const state = {
  hubs: [], rosters: [], plan: null,
  src: 'GTL', dst: 'SC', via: [], rakeType: 'LHB', allStops: false,
  sFront: 0, speed: 0, notch: 0, brake: 0, emergency: false,
  auto: false, simRate: 2, kavach: true, incident: null, busyStations: true,
  weather: 'CLEAR', gameMinutes: 7 * 60 + 15, lights: 'auto', wipers: 'auto', derailments: false, scale: Number(localStorageGet('railsim.scale') || 1),
  backendOnline: false, panto: true, brakeEff: 0, incidentsOn: true
};
let layout = null, world = null, consist = null, ops = null, traffic = null, timetable = null, scorer = null, incidents = null, weatherOps = null, control = null;
const stationAudio = new StationAudio(audio);
const boarding = new Boarding(scene);
const kites = new Kites(scene), cattle = new Cattle(scene);
state.festSel = 'AUTO';
const festivalNow = () => (state.festSel === 'AUTO' ? festivalToday() : state.festSel === 'NONE' ? null : state.festSel);
{ const _hs = audio.hornStart.bind(audio); audio.hornStart = (...a) => { state.lastHornS = state.sFront; return _hs(...a); }; }
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
// Live weather for the route (Open-Meteo, keyed only by the route's station coordinates), mapped to the sim's
// weather and the season: monsoon rain Jun-Oct, fog in winter mornings, summer haze when it is hot.
async function liveWeather() {
  const codes = layout?.stations.map((x) => x.code).filter((c) => LATLON[c]) || [];
  const c = codes[Math.floor(codes.length / 2)];
  if (!c) { toast('Live weather: no location for this route', 'warn', 2500); return; }
  try {
    const [la, lo] = LATLON[c];
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=weather_code,temperature_2m,visibility`);
    const j = (await r.json()).current, wc = j.weather_code, m = new Date().getMonth() + 1;
    const w = (wc === 45 || wc === 48 || j.visibility < 1000) ? 'FOG' : (wc >= 51) ? 'MONSOON' : (j.temperature_2m > 35 || (m >= 4 && m <= 6 && j.temperature_2m > 32)) ? 'HAZE' : 'CLEAR';
    state.weatherMode = null; state.weather = w;
    weatherOps?.setWeather(w, state.sFront);
    toast(`Live weather near ${layout.stations.find((x) => x.code === c)?.name || c}: ${Math.round(j.temperature_2m)}°C — ${{ FOG: 'fog', MONSOON: 'rain', HAZE: 'hot & hazy', CLEAR: 'clear' }[w]}`, 'ok', 4000);
  } catch { toast('Live weather unavailable (offline?) — keeping the current weather', 'warn', 3000); }
}
const cab = new CabRealism({ audio, toast, el: document.getElementById('btn-vcd'),
  onEmergency: (msg) => { state.emergency = true; state.notch = 0; state.auto = false; syncAuto(); toast(msg, 'warn', 5000); scorer?.add?.(-100, 'VCD not acknowledged'); } });
let busy = false;

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

let toastTimer = null;
function toast(msg, kind = '', ms = 3200) {
  const el = $('toast');
  el.textContent = msg;
  el.className = kind;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}

// ======================================================================
// API
// ======================================================================
async function fetchJson(url, opts = {}, timeout = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function loadHubs() {
  try {
    state.hubs = await fetchJson(`${API_BASE}/hubs`);
    state.backendOnline = true;
    // include hubs added by newer changesets even before the backend restarts
    for (const h of OFFLINE_HUBS) if (!state.hubs.some((x) => x.code === h.code)) state.hubs.push(h);
  } catch {
    state.hubs = OFFLINE_HUBS;
    state.backendOnline = false;
  }
  const NICE = { MAS: 'Chennai Central (MGR)', SBC: 'Bengaluru (KSR)', CSMT: 'Mumbai CSMT', DDR: 'Mumbai Dadar (Western)', HYB: 'Hyderabad (Nampally)', NDLS: 'New Delhi' };
  const nm = (h) => NICE[h.code] || h.name;
  const opts = state.hubs.slice().sort((a, b) => nm(a).localeCompare(nm(b)))
    .map((h) => `<option value="${h.code}">${nm(h)} (${h.code} · ${h.platforms} PF)</option>`).join('');
  $('sel-src').innerHTML = opts;
  $('sel-dst').innerHTML = opts;
  $('sel-src').value = 'GTL';
  const via = $('sel-via');
  for (const h of state.hubs) via.insertAdjacentHTML('beforeend', `<option value="${h.code}">${h.code} — ${h.name}</option>`);
  await refreshRosters();
}

async function refreshRosters() {
  const sel = $('sel-roster');
  sel.innerHTML = '<option value="">— Saved trains —</option>';
  try {
    state.rosters = await fetchJson(`${API_BASE}/rosters`);
    state.rosters.forEach((r, i) => sel.insertAdjacentHTML('beforeend', `<option value="${i}">${r.trainNumber} ${r.trainName} (${r.sourceCode}→${r.destCode})</option>`));
  } catch { state.rosters = []; }
}

async function solveRoute(src, dst, via, allStops) {
  if (state.backendOnline && !via.some((v) => v.startsWith('@'))) { // '@EDGE' line choices are solved locally
    try {
      return applyOverrides(await fetchJson(`${API_BASE}/routes/solve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: src, dest: dst, viaHubs: via, allStopsPassenger: allStops })
      }, 8000));
    } catch (e) {
      console.warn('API solve failed, using offline graph', e);
    }
  }
  return applyOverrides(solveOffline(src, dst, via, allStops));
}

// ======================================================================
// Route start
// ======================================================================
// cont: continue the same journey after reversing at `src` (same platform, same loco, score, clock,
// career run; the timetable carries on from the booked departure there).
async function startRoute({ src, dst, via = [], rakeType = 'LHB', allStops = false, minutes = null, stops = null, cont = null, trainNo = null, trainName = null, fixedPlan = null, sub = null, nightMail = null }) {
  if (nightMail !== null) state.nightMail = nightMail;
  if (state.nightMail && !cont && minutes === null) minutes = 23 * 60 + 30;
  if (busy) return;
  busy = true;
  loader.show();
  loader.set(`Solving ${src} → ${dst}…`, 10);
  await nextFrame();
  let plan;
  try {
    plan = fixedPlan ? structuredClone(fixedPlan) : await solveRoute(src, dst, via, allStops || rakeType === 'DEMU_PASSENGER');
  } catch (e) {
    loader.hide();
    toast(`Route error: ${e.message}`, 'warn', 5000);
    busy = false;
    return;
  }
  Object.assign(state, { src, dst, via, rakeType, allStops, stops, plan, speed: 0, notch: 0, brake: 0, emergency: false });
  boarding.stop(); boarding.st = null;
  cab.reset(); state.nightHorns = 0;
  if (!cont) { state.journey = { src, dst, via, rakeType, allStops, stops, trainNo, trainName, fixedPlan, sub }; state.prevLegs = []; }
  if (minutes !== null) state.gameMinutes = minutes;

  loader.set('Laying track, stations & terrain…', 25);
  await nextFrame();
  if (world) world.dispose();
  if (consist && !cont) consist.dispose();
  if (traffic) traffic.dispose();
  const seedKey = plan.route.legs.map((l) => l.edgeId).join('>') + '|' + src + dst;
  if (layout && !cont) finishCareerRun({ completed: false }); // leaving a run part-way
  const tm = [performance.now()];
  layout = buildRouteLayout(plan, { hubs: state.hubs, seedKey, scale: state.scale });
  if (stops) { // preset halt list: stop only at these stations (origin/destination always)
    for (const st of layout.stations) if (!st.isOrigin && !st.isDest && !st.reversal) st.halt = stops.includes(st.code);
  }
  if (RAKES[rakeType].moreStops) { // Garib Rath: halts at every station with three or more platforms as well
    for (const st of layout.stations) if (!st.isOrigin && !st.isDest && !st.reversal && st.platforms >= 3) st.halt = true;
  }
  if (RAKES[rakeType].suburban) for (const st of layout.stations) if (!st.isOrigin && !st.isDest) { st.halt = true; st.dwellMin = Math.min(st.dwellMin || 1, 0.5); }
  // Guntakal: an electric-hauled train going onto the Dhone line changes to a diesel (timed task, starter held)
  const CREW = new Set(['GTL', 'SC', 'BZA', 'KZJ', 'NGP', 'UBL', 'KYN', 'BPL', 'ET', 'VSKP', 'BBS', 'DHN', 'MAS', 'SBC']);
  layout.stations.forEach((st, i) => {
    if (st.isOrigin || st.isDest || st.reversal) return;
    if (st.code === 'GTL' && RAKES[rakeType].traction === 'electric' && !isMultipleUnit(rakeType) && layout.stations[i + 1]?.code === 'MKR') {
      st.tractionChange = 'WDP4D'; st.halt = true; st.dwellMin = Math.max(st.dwellMin || 0, 10);
    }
    if (CREW.has(st.code) && st.halt && !RAKES[rakeType].suburban) { st.crewChange = true; st.dwellMin = Math.max(st.dwellMin || 0, 3); }
  });
  const goods = !!RAKES[rakeType].goods;
  if (goods) { // goods trains run through: no passenger halts, only origin and destination yards
    for (const st of layout.stations) if (!st.isOrigin && !st.isDest && !st.reversal) st.halt = false;
  }
  ops = new Operations(layout, plan, rakeType, seedKey);
  if (state.journey?.trainNo) { ops.trainNo = state.journey.trainNo; ops.trainName = state.journey.trainName; }
  tm.push(performance.now());
  world = new World(scene, layout, { seedKey, density: Q.density });
  world.lampScale = state.nightMail ? 0.3 : 1; // night mail: dim platform lighting
  world.festival = festivalNow();
  cattle.reset(state.sFront || 0);
  if (state.liveTime && !cont && minutes === null) state.gameMinutes = nowMinutes();
  if (state.liveWeather && !cont) setTimeout(liveWeather, 500);
  if (world.festival && !cont) setTimeout(() => toast(`${FESTIVAL_LABEL[world.festival]} on the railway today!`, 'ok', 3500), 2500);
  ops.pointsMoving = (st) => world.pointsMovingAt(st);
  tm.push(performance.now());
  if (!cont) consist = new Consist(rakeType, { isPlayer: true, ...(goods ? { cars: RAKES[rakeType].wagons, loco: 'WAG9' } : {}) });
  if (cont) { // the train stands on the same platform it came in on
    const o = layout.stations[0];
    const t = o.layout.tracks.find((tr) => tr.pf && tr.pf === cont.pf);
    if (t && ops.usable(o, t)) { o.occupancy.delete(t.no); ops.choices.set(0, t.no); ops.lane = layout.buildLane(ops.choices); }
  }
  ops.trainLen = consist.length;
  world.behind = consist.length + 250;
  tm.push(performance.now());
  scene.add(consist.group);
  traffic = new Traffic(scene, layout, ops, (rake, cars) => new Consist(rake, { cars }), audio);
  world.setBlockSignals(ops.ibs);
  // caution orders for the weather are issued before the timetable is drawn up (engineering allowance)
  if (weatherOps) weatherOps.dispose();
  weatherOps = new WeatherOps({ layout, ops, world, audio, toast, seedKey, getClock: () => state.gameMinutes, getScorer: () => scorer });
  const cautions = weatherOps.setWeather(state.weather, origin0(layout));
  if (cont && timetable) state.prevLegs.push({ rows: timetable.rows, actual: timetable.actual });
  timetable = new Timetable(layout, ops, rakeType, cont ? cont.bookedDep - 2 : state.gameMinutes);
  ops.busyEnabled = state.busyStations;
  stationAudio.reset();
  traffic.onStationEvent = (type, t) => stationAudio.trainEvent(type, t, state.gameMinutes);
  traffic.onReroute = (st, prev, now, tr) => { pfShownFor = null; toast(`${st.name}: ${tr.name} is being received on ${prev} — control has rerouted us to ${now.name}`, 'warn', 6000); };
  traffic.onPlatformTaken = (st, track, tr) => { pfShownFor = null; toast(`${st.name}: ${tr.name} is arriving on ${track.name}`, 'ok', 3000); };
  traffic.onDrawUp = (st, tr) => toast(`SM ${st.name}: your rear is fouling the points — draw up to the starter so ${tr.name || 'the crossing train'} can be received on the loop`, 'warn', 7000);
  traffic.onPrecedence = (st, loop, tr) => { pfShownFor = null; toast(`Control: ${tr.name} is behind us — we will be looped at ${st.name} (${loop.name}) to let it pass.`, 'warn', 6500); };
  if (!cont) scorer = new Scorer();
  const keepInc = cont && incidents ? { history: incidents.history } : null;
  const keepCtl = cont && control ? { history: control.history, knockOnTotal: control.knockOnTotal } : null;
  if (incidents) incidents.dispose();
  incidents = new Incidents({ layout, ops, world, audio, scorer, toast, seedKey: seedKey + '|' + Date.now(), rakeType, goods });
  incidents.enabled = state.incidentsOn;
  incidents.onAutoHorn = () => audio.hornBlip(1.2);
  control = new ControlRoom({ layout, ops, toast, audio, seedKey, getScorer: () => scorer });
  if (keepInc) incidents.history = keepInc.history;
  if (keepCtl) Object.assign(control, keepCtl);
  $('ctl-panel').style.display = 'none';
  state.leg = { startDelay: 0, overspeeds: 0 };
  if (!cont) state.controlDelay = 0; // journey minutes lost to signals / incidents (not the driver's fault)
  state.originDepRecorded = false; state.dueShown = null; state.stallT = 0; state.brakeEff = 0;
  if (!cont) state.panto = true;
  $('btn-panto').style.display = RAKES[rakeType].traction === 'electric' || goods ? '' : 'none';
  $('btn-panto').classList.add('on'); $('btn-panto').textContent = 'Panto: up';
  state.engineChange = null; state.haltedAt = null; state.passed = new Set(); state.summaryShown = false;
  state.traction = consist.loco ? LOCOS[consist.loco].traction : RAKES[rakeType].traction;
  state.locoSpan = consist.vehicles.reduce((span, v) => (['WAP7', 'WAG12', 'WAG9', 'WDP4D'].includes(v.kind) ? v.offset + v.length : span), consist.vehicles[0].length);
  state.incident = null;
  ops.spads = cont ? cont.spads : 0;
  if (!cont) careerRun = { route: `${src} → ${dst}`, rake: rakeType, km: 0, lastKm: 0, done: false };
  else careerRun.lastKm = 0; // the odometer restarts with the new leg
  renderStopsPanel();

  const origin = layout.stations[0];
  state.sFront = origin.layout.pEnd - 14;
  consist.place(layout.path, ops.lane, state.sFront, 1);
  rig.reset();
  const lead = consist.lead.group.position;
  loader.set('Streaming scenery…', 45);
  await nextFrame();
  world.update(state.sFront, lead, { init: true });
  world.updateSwitches(state.sFront, ops.lane, 0, null);
  tm.push(performance.now());
  loader.set('Compiling shaders…', 85);
  await nextFrame();
  try { await renderer.compileAsync(scene, camera); } catch { /* optional */ }
  tm.push(performance.now());
  console.info('[railsim] load ms: layout', (tm[1] - tm[0]) | 0, 'world', (tm[2] - tm[1]) | 0, 'consist', (tm[3] - tm[2]) | 0, 'stream', (tm[4] - tm[3]) | 0, 'compile', (tm[5] - tm[4]) | 0);

  buildStripMap();
  updateRouteHeader();
  renderSolvedList();
  // a Rajdhani rake only makes sense between a state capital and New Delhi
  if (rakeType === 'RAJDHANI' && !isRajdhaniRoute(src, dst)) {
    state.special = true;
    $('route-title-text').textContent += ' Special';
    setTimeout(() => toast('Rajdhani trains run only between a state capital and New Delhi — this run is a Special with a Rajdhani rake', 'warn', 6000), 6000);
  } else state.special = false;
  loader.set('Ready', 100);
  loader.hide();
  busy = false;
  const t = ops.trackOf(origin);
  const bookedDep = fmtClock(timetable.rows[0].dep);
  if (cont) {
    updateRouteHeader();
    toast(`${origin.name} ${t.name}: train now facing ${layout.stations[1].name} — booked departure ${bookedDep}. Out over the same end you came in.`, 'ok', 6500);
    return;
  }
  if (cautions || state.weather === 'FOG') showCautionOrder();
  toast(goods
    ? `${rakeLabel()} (${Math.round(consist.length)} m) at ${origin.name} ${t.name}. Booked ${bookedDep}. Heavy train: brakes take seconds to bite — brake early, use dynamic brake (S below N0) on falling grades.`
    : `${rakeLabel()} at ${origin.name} ${t.name}. Booked departure ${bookedDep} — the starter clears at right time. W to notch up, A for auto. Edit halts under “Stops”.`, 'ok', 6500);
}

function rakeLabel() { return RAKES[state.rakeType].label; }

function updateRouteHeader() {
  const r = state.plan.route;
  const a = layout.stations[0], b = layout.stations[layout.stations.length - 1];
  $('route-title-text').textContent = `${ops.trainNo} ${ops.trainName ? ops.trainName + ' · ' : ''}${a.name} → ${b.name}`;
  let meta = `${r.totalRealKm} km · ${layout.stations.length} stations · ${rakeLabel()}`;
  if (layout.gtl) meta += layout.gtl.gooty ? ` · Guntakal east junction (Dhone line branches left)` : ` · Dhone diversion · VV Nagar ${world.gtl.vvSide}`;
  $('route-meta').textContent = meta;
  $('backend-badge').textContent = `${isWebGPU ? 'WebGPU' : 'WebGL2'} · ${state.backendOnline ? 'Online' : 'Offline mode'}`;
}

function renderSolvedList() {
  const legs = state.plan.route.legs;
  const html = legs.map((l) => `<div><b>${l.from}→${l.to}</b> <span class="muted">[${l.trackType}, ${l.biome}]</span>: ` +
    l.stations.map((s) => (s.defaultHalt ? `<b>${s.code}</b>` : `${s.code}*`)).join(' → ') + '</div>').join('');
  const cr = (state.plan.crossings || []).filter((c) => c.eventType === 'SINGLE_LINE_LOOP_WAIT').slice(0, 5)
    .map((c) => `<div style="color:#fbbf24;">Crossing @ ${c.stationCode}: wait for ${c.oncomingTrainName}</div>`).join('');
  $('solved').innerHTML = html + cr;
}

function buildStripMap() {
  const track = $('strip-track');
  track.querySelectorAll('.st').forEach((e) => e.remove());
  const total = layout.total;
  const n = layout.stations.length;
  layout.stations.forEach((st, i) => {
    const d = document.createElement('div');
    d.className = 'st' + (st.halt ? ' halt' : '');
    d.style.left = `${(st.layout.sCenter / total) * 100}%`;
    if (st.halt || i === 0 || i === n - 1 || n < 14) {
      const lb = document.createElement('label');
      lb.textContent = st.code;
      d.appendChild(lb);
    }
    d.title = `${st.name} (${st.platforms} PF)`;
    track.appendChild(d);
  });
}

// ======================================================================
// Platform selector
// ======================================================================
let pfShownFor = null, pfLockedShown = false;
// next station ahead with more than one line whose home signal we have not passed (for the T key / button)
function nextSelectable() {
  for (const st of layout.stations) if (!st.isOrigin && ops.homeS(st) + 20 > state.sFront && !ops.locked.has(st.index)) return st.layout.tracks.length > 1 ? st : null;
  return null;
}
function trackSwitch(cycle) {
  const st = nextSelectable();
  if (!st) { toast('No station ahead with a choice of lines (or the route is already locked)', 'warn', 2200); return; }
  if (!cycle || state.pfForce !== st.index) { state.pfForce = st.index; pfShownFor = null; toast(`${st.name}: choose a platform / loop — press T again to step through the free lines`, 'ok', 2600); return; }
  const lines = st.layout.tracks.filter((t) => !st.occupancy.get(t.no) && ops.usable(st, t));
  if (!lines.length) { toast(`All lines at ${st.name} are occupied`, 'warn'); return; }
  const cur = ops.choices.get(st.index), i = lines.findIndex((t) => t.no === cur);
  const t = lines[(i + 1) % lines.length];
  const res = ops.choose(st, t.no);
  if (res === 'ok') toast(`Points throwing — route set: ${st.name} ${t.name}${t.pf ? '' : ' (no platform)'}${t.isThrough ? '' : ` · loop ${LOOP_LIMIT} km/h`}`, st.halt && !t.pf ? 'warn' : 'ok', 2400);
  else if (res === 'forced') toast(`Precedence: control has set ${ops.trackOf(st).name} so ${st.precedence.train.name} can overtake`, 'warn', 3000);
  pfShownFor = null;
}
function updatePlatformPanel() {
  let st = ops.selectorStation(state.sFront, state.speed);
  if (!st && state.pfForce != null) { const f = nextSelectable(); if (f && f.index === state.pfForce) st = f; else state.pfForce = null; }
  const panel = $('pf-panel');
  if (!st) { panel.style.display = 'none'; pfShownFor = null; return; }
  panel.style.display = 'block';
  const locked = ops.locked.has(st.index);
  const chosen = ops.choices.get(st.index);
  const key = `${st.index}|${chosen}|${locked}|${[...st.occupancy].map(([k, o]) => k + ':' + o.name).join(',')}|${st.halt}|${st.precedence?.state}|${st.busy?.state}`;
  if (key === pfShownFor) return;
  pfShownFor = key;
  $('pf-title').textContent = `${st.name} — choose line`;
  const freePf = ops.freeTracks(st).filter((t) => t.pf).map((t) => t.pf);
  const note = st.precedence && st.precedence.state !== 'cleared' ? ` · PRECEDENCE for ${st.precedence.train.name}` : st.busy && st.busy.state !== 'cleared' && ops.busyEnabled ? ' · station busy' : '';
  $('pf-sub').textContent = `${st.layout.N} platforms · ${st.layout.tracks.length} lines · free PF: ${freePf.length ? freePf.join(', ') : 'none'} · ${st.halt ? `halt ${st.dwellMin} min` : 'run-through'}${note}`;
  const list = $('pf-list');
  list.innerHTML = '';
  for (const t of st.layout.tracks) {
    const occ = st.occupancy.get(t.no);
    const div = document.createElement('div');
    div.className = 'pf ' + (occ ? 'occ' : 'free') + (chosen === t.no ? ' sel' : '');
    const kind = t.pf ? (t.isThrough ? 'main line' : 'loop') : (t.isThrough ? 'no platform' : 'goods loop · no platform');
    const canVacate = occ && !locked && traffic?.canVacate(st, t.no);
    const status = occ ? (occ.kind === 'reserved' ? `Reserved: crossing ${occ.name}` : occ.vacating ? `Clearing: ${occ.name} is being moved out` : `Occupied: ${occ.name}${canVacate ? ' · tap to clear it for us' : ''}`) : (chosen === t.no ? 'Route set ✓' : `Free · ${kind}${t.isThrough ? '' : ` · ${LOOP_LIMIT} km/h`}`);
    div.innerHTML = `<b>${t.name}</b><small>${status}</small>`;
    if (!occ || canVacate) div.onclick = () => {
      if (occ) { // control moves the standing train out (it departs / is shunted away) and gives us this line
        if (!traffic.vacate(st, t.no)) { toast('That train cannot be moved right now', 'warn'); return; }
        toast(`${occ.name} ordered out of ${t.name} — home signal stays at danger until it is clear`, 'ok', 3200);
      }
      const r = ops.choose(st, t.no, !!occ);
      if (r === 'forced') { toast(`Precedence: control has set ${ops.trackOf(st).name} so ${st.precedence.train.name} can overtake`, 'warn', 3000); return; }
      if (r === 'ok') toast(`Points throwing — route set: ${st.name} ${t.name}${st.halt && !t.pf ? ' (no platform here!)' : ''}`, st.halt && !t.pf ? 'warn' : 'ok', 2400);
      else if (r === 'locked') toast('Route locked — train has passed the home signal', 'warn');
      pfShownFor = null;
    };
    list.appendChild(div);
  }
  $('pf-lock').textContent = locked ? 'Route locked (home signal passed).' : 'Pick any FREE line before the home signal · T steps through them.';
}

// ======================================================================
// Input
// ======================================================================
// Goods locos have a dynamic (regenerative) brake: notching below N0 gives DB1..DB4.
function notch(d) { cab.ack(); const lo = RAKES[state.rakeType].dynBrake ? -4 : 0; state.notch = Math.max(lo, Math.min(8, state.notch + d)); if (d > 0 && state.notch > 0) { state.brake = 0; state.emergency = false; } state.auto = false; syncAuto(); }
function brake(d) { cab.ack(); state.brake = Math.max(0, Math.min(100, state.brake + d)); if (d > 0 && state.notch > 0) state.notch = 0; state.auto = false; syncAuto(); }
function setPanto(up, quiet = false) {
  if (state.panto === up) return;
  state.panto = up;
  for (const v of consist.vehicles.slice(0, 2)) setPantograph(v, up);
  $('btn-panto').classList.toggle('on', up); $('btn-panto').textContent = `Panto: ${up ? 'up' : 'down'}`;
  if (!quiet) toast(up ? 'Pantograph raised — traction available' : 'Pantograph lowered — no traction', up ? 'ok' : 'warn', 2000);
}
function syncAuto() { $('btn-auto').classList.toggle('on', state.auto); }
async function unlockAudio() { try { await audio.init(); } catch (e) { console.warn(e); } }

$('btn-up').onclick = () => notch(1);
$('btn-dn').onclick = () => notch(-1);
$('btn-brk').onclick = () => brake(25);
$('btn-rel').onclick = () => { state.brake = 0; state.emergency = false; };
$('btn-emg').onclick = () => { state.emergency = true; state.notch = 0; state.brake = 100; state.auto = false; syncAuto(); };
const hornBtn = $('horn-btn');
hornBtn.addEventListener('pointerdown', async () => { await unlockAudio(); audio.hornStart(); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hornBtn.addEventListener(ev, () => audio.hornStop());
$('btn-auto').onclick = () => { state.auto = !state.auto; if (state.auto) { state.emergency = false; } syncAuto(); toast(state.auto ? 'Auto driver ON — obeys signals, limits and halts' : 'Auto driver OFF', 'ok', 1800); };
const cycle = (v) => (v === 'auto' ? 'on' : v === 'on' ? 'off' : 'auto');
const label = (v) => v.charAt(0).toUpperCase() + v.slice(1);
function toggleLights() { state.lights = cycle(state.lights); $('btn-lights').textContent = `Lights: ${label(state.lights)}`; $('btn-lights').classList.toggle('on', state.lights === 'on'); }
function toggleWipers() { state.wipers = cycle(state.wipers); $('btn-wipers').textContent = `Wipers: ${label(state.wipers)}`; $('btn-wipers').classList.toggle('on', state.wipers === 'on'); }
$('btn-lights').onclick = toggleLights;
$('btn-wipers').onclick = toggleWipers;
$('btn-derail').onclick = (e) => { state.derailments = !state.derailments; e.target.classList.toggle('on', state.derailments); e.target.textContent = `Derail: ${state.derailments ? 'on' : 'off'}`; toast(state.derailments ? 'Realistic derailment ON — gross overspeed over points/curves derails the train' : 'Derailment OFF — overspeed over points costs score and gives a heavy lurch', 'ok', 2600); };
$('btn-busy').onclick = (e) => { state.busyStations = !state.busyStations; if (ops) ops.busyEnabled = state.busyStations; e.target.classList.toggle('on', state.busyStations); toast(state.busyStations ? 'Busy stations ON — some home signals will be held' : 'Busy stations OFF', 'ok', 2000); };
$('btn-stops').onclick = () => { const m = $('stops-panel'); renderStopsPanel(); m.style.display = m.style.display === 'block' ? 'none' : 'block'; };
$('btn-panto').onclick = () => { if (state.traction === 'electric') setPanto(!state.panto); };
$('btn-incidents').onclick = (e) => { state.incidentsOn = !state.incidentsOn; if (incidents) incidents.enabled = state.incidentsOn; e.target.classList.toggle('on', state.incidentsOn); toast(state.incidentsOn ? 'Breakdowns & incidents ON — follow the procedure when one happens' : 'Breakdowns & incidents OFF (the current one still runs to the end)', 'ok', 2600); };
$('inc-panel').onclick = (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled && incidents) { incidents.act(b.dataset.act); } };
$('btn-kavach').onclick = (e) => { state.kavach = !state.kavach; e.target.classList.toggle('on', state.kavach); toast(state.kavach ? 'Kavach ATP ON — automatic braking for red signals & overspeed' : 'Kavach ATP OFF — you are responsible for signals; SPADs can cause collisions', state.kavach ? 'ok' : 'warn', 3500); };
$('btn-resume').onclick = () => resumeFromLastStation();
$('btn-restart').onclick = () => { $('incident').style.display = 'none'; startRoute({ ...state.journey }); };
$('btn-vcd').onclick = () => cab.ack();
$('btn-track').onclick = () => trackSwitch(true);
$('btn-vcdon').onclick = (e) => { cab.vcdOn = !cab.vcdOn; cab.ack(); e.currentTarget.classList.toggle('on', cab.vcdOn); };
$('btn-menu').onclick = () => document.body.classList.toggle('menu-open'); // phones: toolbar folds away
// Toolbar pop-ups (route planner, stops, timetable, caution, recorder): open just below the toolbar so they never
// cover its buttons, have a close button, and only one is open at a time.
const POPS = ['route-modal', 'stops-panel', 'tt-panel', 'co-panel', 'rec-panel'];
function placePop(id) {
  const el = $(id); if (!el || el.classList.contains('modal')) return;
  const bar = document.querySelector('#top > .panel'), b = bar.getBoundingClientRect();
  if (document.body.classList.contains('mobile')) { // phones / small tablets: a full-width sheet under the title bar
    Object.assign(el.style, { top: '54px', left: '6px', right: '6px', width: 'auto', maxWidth: 'none', maxHeight: `${innerHeight - 120}px` });
    document.body.classList.remove('menu-open');
    return;
  }
  const wide = innerWidth > 1100;
  el.style.top = `${wide ? 12 : Math.round(b.bottom + 8)}px`;
  el.style.left = `${wide ? Math.round(b.right + 10) : 12}px`;
  el.style.maxHeight = `${Math.max(200, innerHeight - (wide ? 12 : b.bottom + 8) - 150)}px`;
}
for (const id of POPS) {
  const el = $(id);
  if (!el) continue;
  const host = el.classList.contains('modal') ? el.querySelector('.panel') || el : el;
  const x = document.createElement('button'); x.className = 'xclose'; x.textContent = '✕'; x.title = 'Close';
  x.onclick = () => { el.style.display = 'none'; };
  host.prepend(x);
  new MutationObserver(() => {
    if (el.style.display && el.style.display !== 'none') { placePop(id); for (const o of POPS) if (o !== id && $(o)) $(o).style.display = 'none'; }
  }).observe(el, { attributes: true, attributeFilter: ['style'] });
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const id of POPS) if ($(id)) $(id).style.display = 'none'; });
$('btn-builder').onclick = () => { const m = $('route-modal'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; };
// choosing any other option minimises the route planner, so only one panel is open at a time

$('btn-reverse').onclick = () => {
  const j = state.journey;
  if (j.sub) { startSuburban(j.sub.city, j.sub.route, !j.sub.reverse); return; }
  startRoute({ src: j.dst, dst: j.src, via: j.via.slice().reverse(), rakeType: j.rakeType, allStops: j.allStops });
};
$('sel-weather').onchange = (e) => {
  if (e.target.value === 'LIVE') { state.liveWeather = true; liveWeather(); return; }
  state.liveWeather = false;
  if (e.target.value === 'DYNAMIC') { state.weatherMode = 'DYNAMIC'; dynWeather.next = state.gameMinutes + 8; toast('Dynamic weather: it will change as the journey goes on', 'ok', 3000); return; }
  state.weatherMode = null;
  state.weather = e.target.value;
  if (!weatherOps) return;
  const issued = weatherOps.setWeather(state.weather, state.sFront);
  if (issued || state.weather === 'FOG') { toast(state.weather === 'FOG' ? 'Control: dense fog — line speed restricted to 75 km/h, run on the Fog Safety Device' : 'Control: caution order issued by radio for the weather ahead', 'warn', 4500); showCautionOrder(); }
};
$('btn-caution').onclick = () => { if ($('co-panel').style.display === 'block') $('co-panel').style.display = 'none'; else showCautionOrder(true); };
function origin0(L) { return L.stations[0].layout.pEnd - 14; }
function showCautionOrder(always = false) {
  const html = weatherOps?.render();
  if (!html) { if (always) toast('No caution orders in force', 'ok', 2000); return; }
  $('co-panel').innerHTML = html;
  $('co-panel').style.display = 'block';
  $('co-ack').onclick = () => { $('co-panel').style.display = 'none'; };
}
$('sel-fest').onchange = (e) => {
  state.festSel = e.target.value; if (world) world.festival = festivalNow();
  const f = festivalNow(); toast(f ? `${FESTIVAL_LABEL[f]} — decorations appear at the stations ahead` : 'No festival decorations', 'ok', 3000);
};
$('sel-time').onchange = (e) => {
  if (e.target.value) {
    state.liveTime = e.target.value === 'LIVE';
    const to = state.liveTime ? nowMinutes() : Number(e.target.value);
    if (state.liveTime) { state.simRate = 1; if ($('sel-rate')) $('sel-rate').value = '1'; toast('Live time: the sim clock now runs with your real clock', 'ok', 3000); }
    const d = to - state.gameMinutes;
    state.gameMinutes = to;
    if (timetable) timetable.shift(d); // a time jump moves the whole timetable with it
  }
  e.target.value = '';
};
$('sel-rate').onchange = (e) => { state.simRate = Number(e.target.value); };
$('sel-scale').value = String(state.scale);
$('sel-scale').onchange = (e) => {
  state.scale = Number(e.target.value); localStorageSet('railsim.scale', String(state.scale));
  toast(state.scale === 1 ? 'Exact distances — restarting the route' : 'Compact 1:10 distances — restarting the route', 'ok', 2500);
  startRoute({ src: state.src, dst: state.dst, via: state.via, rakeType: state.rakeType, allStops: state.allStops, stops: state.stops, trainNo: state.journey?.trainNo, trainName: state.journey?.trainName });
};
$('sel-quality').value = qualityKey;
$('sel-quality').onchange = (e) => { localStorageSet('railsim.quality', e.target.value); location.search = `?q=${e.target.value}`; };
$('btn-sound').onclick = async (e) => { await unlockAudio(); audio.enabled = !audio.enabled; e.target.classList.toggle('on', audio.enabled); };
const setVoice = (mode) => {
  stationAudio.voiceMode = mode; stationAudio.cloudDownUntil = 0;
  $('btn-voice').textContent = mode === 'cloud' ? 'Voice: Cloud' : 'Voice: Browser';
  $('btn-voice').classList.toggle('on', mode === 'cloud');
  localStorageSet('railsim.voice', mode);
};
$('btn-voice').onclick = () => {
  const next = stationAudio.voiceMode === 'cloud' ? 'browser' : 'cloud';
  if (next === 'cloud' && !state.backendOnline) toast('Cloud voice needs an internet connection — using the browser voice for now', 'warn', 3500);
  setVoice(next);
  toast(next === 'cloud' ? 'Announcer: Google Cloud natural voice (station PA, distant)' : 'Announcer: browser voice (distant)', 'ok', 2200);
};
stationAudio.onCloudFail = (msg) => toast(`Cloud voice unavailable (${msg}) — using the browser voice for now`, 'warn', 3500);
$('btn-announce').onclick = (e) => { audio.announcements = !audio.announcements; e.target.classList.toggle('on', audio.announcements); };
$('btn-local').onclick = (e) => { stationAudio.localLang = !stationAudio.localLang; e.target.classList.toggle('on', stationAudio.localLang); };
const camSel = $('sel-cam');
camSel.innerHTML = CAMERA_MODES.map((m, i) => `<option value="${i}">${m.label}</option>`).join('');
camSel.value = String(rig.mode);
camSel.onchange = (e) => rig.setMode(Number(e.target.value));

// ======================================================================
// Game modes: Station Master (2D panel / 3D tower / drone), Section Controller, Wayside SM
// ======================================================================
const GAME_MODE_NAMES = { station: 'Station Master', controller: 'Section Controller', wayside: 'Wayside Station Master' };
function reportGame(g) {
  account.recordGame(g);
  achievements({ kind: g.mode, trains: g.trains });
  toast(`${GAME_MODE_NAMES[g.mode] || 'Game'} finished — ${Math.round(g.score)} points saved to ${account.guest ? `guest "${account.displayName}"` : 'your profile'}`, 'ok', 4500);
}
let smScene = null;
const smFps = { n: 0, t: 0 };           // Station Master on the real station (SMWorld); the driving sim pauses meanwhile
const stationMaster = new StationMaster($('sm'), {
  toast,
  announce: (text, local) => { if (audio.enabled && audio.announcements) stationAudio.say(text, true, local); },
  onGameOver: (g) => { reportGame(g); showSmOver(g); },
  onView: (v) => {
    document.body.classList.toggle('sm3d', !!v);
    document.querySelectorAll('#sm-views button').forEach((b) => b.classList.toggle('on', b.dataset.view === (v || 'panel')));
    if (!v) { // leaving the mode
      smScene?.dispose(); smScene = null;
      if (consist) consist.group.visible = true;
      smPerf(false); rain.visible = false; $('sm-over').classList.remove('show');
      camera.fov = 55; camera.far = 7000; camera.updateProjectionMatrix();
      return;
    }
    if (smScene && v !== 'panel') smScene.setView(v);
  }
});
stationMaster.external = true; // driven by the main render loop (one loop: game, trains and camera stay in step)
// Load the real route around the station (same World, station, sky and trains as the simulator), then play
const smStart = async (code, mode) => {
  $('sm-station').value = code; $('sm-mode').value = mode;
  hideHome(); $('route-modal').style.display = 'none';
  stationMaster.stop();
  const R = SM_ROUTES[code], prevScale = state.scale;
  state.scale = 10; // compact spacing between stations: only this station matters
  await startRoute({ src: R.src, dst: R.dst, via: R.via, rakeType: 'LHB', minutes: 9 * 60 });
  state.scale = prevScale;
  if (!layout || !world) { toast('Could not load the station', 'warn'); showHome(); return; }
  consist.group.visible = false;                                   // no player train in this mode
  if (traffic) { for (const t of traffic.trains) t.consist.dispose(); traffic.trains = []; }
  smScene = new SMWorld({ layout, world, scene, camera, makeConsist: (rake, cars) => new Consist(rake, { cars }), code, labelRoot: $('sm-labels'), audio });
  const SN = SM_STATIONS[code].sideNames;
  $('sm-v-end0').textContent = SM_STATIONS[code].terminal ? '◀ Throat' : `◀ ${SN[0][0]}${SN[0].slice(1).toLowerCase()}`;
  $('sm-v-end1').textContent = `${SN[1][0]}${SN[1].slice(1).toLowerCase()} ▶`;
  $('sm-v-end1').style.display = SM_STATIONS[code].terminal ? 'none' : '';
  if (stationMaster.view === 'panel') stationMaster.view = 'drone';
  $('sm-over').classList.remove('show');
  smPerf(true);
  if (document.body.classList.contains('mobile')) { $('sm').classList.add('min'); $('sm-min').textContent = '»'; }
  state.gameMinutes = Number($('sm-time').value); state.weather = $('sm-weather').value;
  stationMaster.roster = await smRoster(code);
  stationMaster.start(code, mode, { tracks: smScene.tracks(), physical: smScene });
  smScene.setView(stationMaster.view);
  smScene.setRoofs($('sm-roofs').classList.contains('on'));
  stationMaster.flow = Number($('sm-flow').value);
  world.update(smScene.sC, smScene.focus(), { init: true });
  document.querySelectorAll('#sm-speed button').forEach((x) => x.classList.toggle('on', Number(x.dataset.x) === stationMaster.speed));
};
// Real trains of the station from the database (rotated by the game in turn); built-in list when offline
async function smRoster(code) {
  if (!state.backendOnline) return null;
  try {
    const rows = await fetchJson(`${API_BASE}/sm/trains?station=${encodeURIComponent(code)}`, {}, 3000);
    return Array.isArray(rows) && rows.length ? rows.map((r) => ({ no: r.trainNo, name: r.trainName, kind: r.kind, from: r.fromLine, to: r.toLine, reverse: !!r.reverses })) : null;
  } catch { return null; }
}
// lighter rendering while in Station Master: steadier frame rate (no glow, capped pixel ratio, smaller shadow map)
function smPerf(on) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, on ? Math.min(1.25, Q.pixelRatio) : Q.pixelRatio));
  sky.setShadowSize(on ? Math.min(1024, Q.shadow) : Q.shadow);
}
function showSmOver(g) {
  const pct = g.trains ? Math.round((100 * g.onTime) / g.trains) : 100;
  $('sm-over-title').textContent = g.text || 'Shift over';
  $('sm-over-body').innerHTML = `<div><b>${Math.round(g.score)}</b>score</div><div><b>${g.trains}</b>trains handled</div><div><b>${pct}%</b>on time</div><div><b>${SM_STATIONS[g.venue]?.name || g.venue}</b>${g.modeLabel || ''}</div>`;
  $('sm-over').classList.add('show');
}
$('sm-again').onclick = () => { $('sm-over').classList.remove('show'); smStart(stationMaster.code, stationMaster.mode); };
$('sm-menu').onclick = () => { $('sm-over').classList.remove('show'); stationMaster.stop(); showHome(); };
$('sm-time').onchange = (e) => { state.gameMinutes = Number(e.target.value); };
$('sm-weather').onchange = (e) => { if (e.target.value === 'DYNAMIC') { state.weatherMode = 'DYNAMIC'; dynWeather.next = state.gameMinutes + 4; } else { state.weatherMode = null; state.weather = e.target.value; } };
// camera pad + keys (drone: slide along the station, rotate, zoom; other views: look around)
const smCam = (a) => { if (!smScene) return; if (a === 'left') smScene.pan(-1); else if (a === 'right') smScene.pan(1); else if (a === 'rotl') smScene.rotate(-1); else if (a === 'rotr') smScene.rotate(1); else if (a === 'in') smScene.zoom(-250); else if (a === 'out') smScene.zoom(250); };
document.querySelectorAll('#sm-cam [data-cam]').forEach((b) => { b.onclick = () => smCam(b.dataset.cam); });
addEventListener('keydown', (e) => {
  if (!smScene || !stationMaster.running || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const k = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', q: 'rotl', e: 'rotr', '+': 'in', '=': 'in', '-': 'out' }[e.key];
  if (k) { smCam(k); e.preventDefault(); }
});
// graphics toggles: roofs off (see trains under the canopies), glow effects, steady 60 fps
const smGfx = { fx: false, cap: false, lastFrame: 0 };
$('sm-roofs').onclick = (e) => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); smScene?.setRoofs(on); };
$('sm-fx').onclick = (e) => { smGfx.fx = !smGfx.fx; e.currentTarget.classList.toggle('on', smGfx.fx); };
$('sm-cap').onclick = (e) => { smGfx.cap = !smGfx.cap; e.currentTarget.classList.toggle('on', smGfx.cap); };
$('sm-flow').onchange = (e) => { stationMaster.flow = Number(e.target.value); };
document.querySelectorAll('#sm-speed button').forEach((b) => {
  b.onclick = () => { stationMaster.speed = Number(b.dataset.x); document.querySelectorAll('#sm-speed button').forEach((x) => x.classList.toggle('on', x === b)); };
});
$('sm-start').onclick = () => smStart($('sm-station').value, $('sm-mode').value);
const confirmLeave = (what) => confirm(`Leave ${what}? The current shift ends and its score is not saved.`);
$('sm-exit').onclick = () => {
  if (!stationMaster.over && stationMaster.moved > 0 && !confirmLeave('Station Master')) return;
  if (!stationMaster.over && stationMaster.moved === 0 && !confirm('Leave Station Master?')) return;
  stationMaster.stop(); showHome();
};
$('sm-min').onclick = () => { const m = $('sm').classList.toggle('min'); $('sm-min').textContent = m ? '»' : '«'; };
$('sm-labels').addEventListener('pointerdown', (e) => { // on press: labels redraw every frame
  if (e.target.closest('button[data-act]')) { stationMaster._dashClick(e); return; } // route menu above the train
  const el = e.target.closest('.sm-tag');
  if (el) stationMaster.clickTrain(stationMaster.trains.find((t) => t.id === Number(el.dataset.id)));
});
document.querySelectorAll('#sm-views button').forEach((b) => { b.onclick = () => stationMaster.setView(b.dataset.view); });
// tower / drone camera: drag to look or orbit, wheel / pinch to zoom
{
  const el = renderer.domElement;
  let drag = null;
  el.addEventListener('pointerdown', (e) => { if (smScene && stationMaster.view !== 'panel') drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }; });
  addEventListener('pointermove', (e) => { if (!drag || !smScene) return; smScene.drag(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; });
  addEventListener('pointerup', (e) => {
    // a tap (not a drag): pick a train or a platform line in the 3D station
    if (drag && smScene && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) {
      const r = el.getBoundingClientRect();
      const hit = smScene.pick(stationMaster, ((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (hit?.kind === 'train') stationMaster.clickTrain(hit.tr);
      else if (hit?.kind === 'track') stationMaster.clickTrack(hit.track);
    }
    drag = null;
  });
  el.addEventListener('wheel', (e) => { if (smScene) { smScene.zoom(e.deltaY); e.preventDefault(); } }, { passive: false });
}

// Guntakal - Dhone single line: Section Controller and Wayside Station Master
const sectionGame = new SectionGame($('sec'), { onGameOver: reportGame });
let secLast = { mode: 'controller', st: 6 };
const secStart = (mode, st) => { secLast = { mode, st }; hideHome(); $('route-modal').style.display = 'none'; sectionGame.start(mode, st, Number($('sec-shift').value)); };
$('sec-restart').onclick = () => secStart(secLast.mode, secLast.st);
$('sec-exit').onclick = () => {
  if (!sectionGame.sim?.over && !confirm('Leave this mode? The current shift ends and its score is not saved.')) return;
  sectionGame.stop(); showHome();
};

// ======================================================================
// Start screen (mode tiles) and statistics
// ======================================================================
// the start screen is silent: no rail ambience, crowd or announcements until a mode is chosen
let homeMuted = false;
function muteForHome(on) {
  if (on === homeMuted) return;
  homeMuted = on;
  if (on) { audio._wasEnabled = audio.enabled; audio.enabled = false; stationAudio.stopSpeech?.(); }
  else audio.enabled = audio._wasEnabled ?? true;
  if (audio.master && audio.ctx) audio.master.gain.setTargetAtTime(on ? 0 : 0.9, audio.ctx.currentTime, 0.15);
}
function showHome() {
  $('home').style.display = 'flex';
  $('home-hi').textContent = account.guest ? `Hi ${account.displayName}` : `Hi ${account.email}`;
  $('home-signout').textContent = account.guest ? 'Log in' : 'Sign out';
  muteForHome(true);
  $('home-who').textContent = account.guest ? 'Playing as a guest — choose a name for the leaderboards, or log in to keep your career.' : `Logged in as ${account.email}`;
  $('home-guest').style.display = account.guest ? 'flex' : 'none';
  $('guest-name').value = account.guestName;
}
function hideHome() { $('home').style.display = 'none'; muteForHome(false); }
$('guest-name').oninput = (e) => { account.guestName = e.target.value; };
$('home-login').onclick = () => { setAuthMode('login'); showAuth(); };
$('home-signout').onclick = async () => {
  if (account.guest) { setAuthMode('login'); showAuth(); return; }
  await account.logout(); toast('Signed out — playing as guest', 'ok', 2500); showHome();
};
$('tile-drive').onclick = () => { hideHome(); $('route-modal').style.display = 'none'; };
$('tile-station').onclick = (e) => { if (e.target.closest('select')) return; smStart($('home-sm-station').value, $('home-sm-mode').value); };
$('tile-ctl').onclick = () => secStart('controller', 6);

$('tile-stats').onclick = () => openStats();
$('tile-career').onclick = () => { $('career-modal').style.display = 'flex'; renderCareer(); };
$('btn-mainmenu').onclick = () => $('btn-home').onclick();
$('btn-home').onclick = () => { if (state.speed > 0.5 && !confirm('Go back to the start screen? Your train will be left where it is.')) return; showHome(); };

let statsPeriod = 'daily', statsMode = 'drive';
async function openStats() { $('stats-modal').style.display = 'flex'; await renderStats(); }
async function renderStats() {
  document.querySelectorAll('#stats-period button').forEach((b) => b.classList.toggle('on', b.dataset.p === statsPeriod));
  document.querySelectorAll('#stats-mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === statsMode));
  $('stats-rows').innerHTML = '<tr><td colspan="6" class="muted">Loading…</td></tr>';
  const { rows, online } = await account.leaderboard(statsMode, statsPeriod);
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const me = account.displayName;
  $('stats-src').textContent = online ? `Top 10 · all players · ${statsPeriod}` : `Offline — showing games played on this device (${statsPeriod})`;
  $('stats-rows').innerHTML = rows.length ? rows.map((r, i) => `<tr class="${r.playerName === me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.playerName)}${r.guest ? ' <span class="muted">(guest)</span>' : ''}</td><td>${esc(r.venue)}</td><td><b>${r.score}</b></td><td>${r.trains ?? ''}</td><td>${new Date(r.playedAt).toLocaleDateString()}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No games yet in this period — be the first!</td></tr>';
  const c = account.career, g = c.games || {};
  const cell = (k, v) => `<div><span class="muted">${k}</span><br><b>${v}</b></div>`;
  const gm = (m) => g[m] ? `${g[m].played} played · best ${g[m].best} · ${g[m].trains} trains` : 'not played yet';
  $('stats-mine').innerHTML = cell(`Train driving (${account.displayName})`, `${c.completed}/${c.runs} runs · ${c.km.toFixed(0)} km · best ${c.bestScore}`)
    + cell('Station Master', gm('station')) + cell('Section Controller', gm('controller')) + cell('Wayside Station Master', gm('wayside'));
}
document.querySelectorAll('#stats-period button').forEach((b) => { b.onclick = () => { statsPeriod = b.dataset.p; renderStats(); }; });
document.querySelectorAll('#stats-mode button').forEach((b) => { b.onclick = () => { statsMode = b.dataset.m; renderStats(); }; });
$('stats-close').onclick = () => { $('stats-modal').style.display = 'none'; };
$('btn-stats').onclick = () => openStats();

// ======================================================================
// Dynamic weather, photo mode, multiplayer rooms, daily challenge, Mumbai peak, achievements
// ======================================================================
// weather that changes by itself: sunny spells, summer haze, monsoon showers; fog only around dawn
const dynWeather = { next: 0 };
setInterval(() => {
  if (state.weatherMode !== 'DYNAMIC') return;
  if (state.gameMinutes < dynWeather.next) return;
  const h = (state.gameMinutes / 60) % 24, cur = state.weather;
  const options = h > 4.5 && h < 8 ? ['FOG', 'CLEAR', 'HAZE'] : cur === 'MONSOON' ? ['CLEAR', 'HAZE', 'MONSOON'] : cur === 'FOG' ? ['CLEAR', 'HAZE'] : ['CLEAR', 'HAZE', 'MONSOON', 'MONSOON'];
  const nw = options.filter((w) => w !== cur)[Math.floor(Math.random() * (options.length - 1))] || 'CLEAR';
  dynWeather.next = state.gameMinutes + 18 + Math.random() * 30;
  state.weather = nw;
  if (weatherOps && !stationMaster.running) weatherOps.setWeather(nw, state.sFront);
  toast({ CLEAR: '☀ The weather is clearing up', HAZE: '🌤 Summer haze building up', MONSOON: '🌧 Monsoon shower ahead — caution orders may follow', FOG: '🌫 Fog rolling in — run on the fog safety device' }[nw], 'ok', 3500);
}, 1000);

// photo mode: no HUD, free camera, pick the time of day, save a picture
$('btn-photo').onclick = () => { document.body.classList.add('photo'); $('photo-time').value = Math.round(state.gameMinutes % 1440); };
$('photo-exit').onclick = () => document.body.classList.remove('photo');
$('photo-time').oninput = (e) => { state.gameMinutes = Number(e.target.value); };
$('photo-save').onclick = () => {
  if (pipeline) pipeline.render(); else renderer.render(scene, camera);
  try {
    const a = document.createElement('a'); a.download = `indian-rail-sim-${Date.now()}.png`; a.href = renderer.domElement.toDataURL('image/png'); a.click();
    toast('Picture saved', 'ok', 2000);
  } catch { toast('Could not save the picture in this browser', 'warn'); }
};

// achievements: toast what was just unlocked
function achievements(x) { for (const a of account.checkAchievements(x)) toast(`${a.icon} Achievement unlocked: ${a.title}`, 'ok', 5000); }

// ---- multiplayer race rooms
const mp = new Multiplayer({ toast, onUpdate: (room) => renderMp(room) });
function renderMp(room) {
  const panel = $('mp-panel');
  if (!room) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const host = room.owner === mp.name;
  $('mp-title').textContent = `🏁 Room ${room.code}${room.started ? ' · racing' : ' · lobby'}`;
  const rt = room.route || {};
  $('mp-sub').textContent = room.started ? (rt.sub ? `${rt.sub.city} ${rt.sub.route}` : rt.preset || `${rt.src} → ${rt.dst} · ${RAKES[rt.rakeType]?.label || ''}`) : host ? 'Share the code with friends, then start the race' : `Waiting for ${room.owner} to start…`;
  $('mp-start').style.display = host && !room.started ? '' : 'none';
  const list = [...room.players].sort((a, b) => (b.done - a.done) || (b.km - a.km) || (b.score - a.score));
  $('mp-table').innerHTML = list.map((p, i) => `<tr class="${p.name === mp.name ? 'me' : ''}"><td>${i + 1}</td><td>${p.name.replace(/</g, '')}${p.name === room.owner ? ' 👑' : ''}</td><td>${p.done ? '🏁' : `${(p.km || 0).toFixed(1)} km`}</td><td>${Math.round(p.speed || 0)} km/h</td><td>${p.score || 0}</td></tr>`).join('');
  // other players on the progress strip
  const strip = $('strip-track');
  strip.querySelectorAll('.mp-dot').forEach((d) => d.remove());
  if (room.started) for (const [i, p] of list.entries()) if (p.name !== mp.name && p.totalKm) {
    const d = document.createElement('i'); d.className = 'mp-dot'; d.title = p.name;
    d.style.left = `${Math.min(100, (100 * p.km) / p.totalKm)}%`; d.style.background = ['#f97316', '#22c55e', '#a855f7', '#ef4444', '#06b6d4', '#eab308', '#ec4899'][i % 7];
    strip.appendChild(d);
  }
  if (room.started && !mp.racing) {
    mp.racing = true; hideHome();
    const r = room.route || {};
    if (r.sub) startSuburban(r.sub.city, r.sub.route, !!r.sub.reverse);
    else if (r.preset) startRoute({ ...PRESETS[r.preset], trainNo: null, trainName: null, minutes: 9 * 60 });
    else startRoute({ src: r.src, dst: r.dst, via: r.via || [], rakeType: r.rakeType || 'LHB', allStops: !!r.allStops, stops: r.stops || null, minutes: 9 * 60 });
  }
}
const mpName = () => account.displayName;
$('mp-create').onclick = async (e) => {
  e.stopPropagation();
  const code = $('mp-code').value.trim();
  if (!/^\d{4}$/.test(code)) { toast('Choose a 4-digit room code', 'warn'); return; }
  if ($('mp-route').value === 'custom') { // choose any route / train in Route & Roster; the room is created with it
    mp.pendingCode = code;
    hideHome(); $('route-modal').style.display = 'block';
    $('mp-pick').style.display = ''; $('mp-pick').textContent = `🏁 Room ${code}: choose the route and train below (your own From/To + train, a saved train or a suburban route). Everyone in the room will drive it.`;
    return;
  }
  try { await mp.create(code, mpName(), { preset: $('mp-route').value }); hideHome(); toast(`Room ${code} created — share the code`, 'ok', 3500); }
  catch (err) { toast(err.message, 'warn', 4000); }
};
// when a room is waiting for its route, the planner's start buttons create the room instead of starting
async function mpTakeRoute(route) {
  if (!mp.pendingCode) return false;
  const code = mp.pendingCode; mp.pendingCode = null;
  $('mp-pick').style.display = 'none'; $('route-modal').style.display = 'none';
  try { await mp.create(code, mpName(), route); toast(`Room ${code} created with your route — share the code, then Start race`, 'ok', 4000); }
  catch (err) { toast(err.message, 'warn', 4000); }
  return true;
}
$('mp-join').onclick = async (e) => {
  e.stopPropagation();
  try { await mp.join($('mp-code').value.trim(), mpName()); hideHome(); toast('Joined — waiting for the owner to start', 'ok', 3000); }
  catch (err) { toast(err.message, 'warn', 4000); }
};
$('tile-mp').onclick = (e) => { if (!e.target.closest('input,select,button')) $('mp-code').focus(); };
$('mp-start').onclick = () => mp.start().then(() => renderMp({ ...mp.room, players: [...mp.players.values()] }));
$('mp-leave').onclick = () => { mp.racing = false; mp.leave(); };
setInterval(() => { // our progress for the room
  if (!mp.room || !layout || !mp.racing) return;
  const total = layout.realKmAt(layout.total), km = Math.max(0, layout.realKmAt(state.sFront) - layout.realKmAt(layout.stations[0].layout.pEnd));
  mp.report({ km, totalKm: total, speed: state.speed * 3.6, score: scorer ? scorer.total() : 0, late: 0, done: !!state.summaryShown, status: state.summaryShown ? 'finished' : 'driving' });
  if (state.summaryShown && !mp.finished) { mp.finished = true; achievements({ kind: 'mp' }); }
}, 1000);

// ---- daily challenge: the same route, train, weather and start time for everyone today
const DAILY_POOL = [
  { route: { src: 'SC', dst: 'KZJ' }, rake: 'LHB' }, { route: { src: 'KZJ', dst: 'NZB', via: ['WL'] }, rake: 'LHB' },
  { route: { src: 'BZA', dst: 'VSKP' }, rake: 'VANDE_BHARAT' }, { route: { src: 'VSKP', dst: 'BBS' }, rake: 'ICF' },
  { route: { src: 'BBS', dst: 'HWH' }, rake: 'DURANTO' }, { route: { src: 'JP', dst: 'NDLS' }, rake: 'RAJDHANI' },
  { route: { src: 'KZJ', dst: 'NGP' }, rake: 'RAJDHANI' }, { route: { src: 'CSMT', dst: 'NGP' }, rake: 'DURANTO' },
  { preset: 'csmt-hwh', rake: 'DURANTO', marathon: true }, { preset: 'ndls-hwh', rake: 'RAJDHANI', marathon: true }, { preset: 'mas-ndls', rake: 'LHB', marathon: true },
  { preset: 'gtl-sc', rake: 'LHB' }, { preset: 'gtl-krnt', rake: 'ICF' }, { preset: 'sbc-gtl', rake: 'VANDE_BHARAT' }, { preset: 'mas-bza', rake: 'VANDE_BHARAT_ORANGE' },
  { preset: 'wadi-csmt', rake: 'LHB' }, { preset: 'hyb-ubl', rake: 'GARIB_RATH' }, { preset: 'krnt-gtl', rake: 'JAN_SHATABDI' }, { preset: 'tpty-krnt', rake: 'ICF_CREAM' }
];
function dailyToday() {
  const d = new Date(), key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  let h = 7; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pick = DAILY_POOL[h % DAILY_POOL.length];
  const weather = ['CLEAR', 'HAZE', 'MONSOON', 'FOG', 'CLEAR'][(h >> 4) % 5];
  const minutes = weather === 'FOG' ? 6 * 60 : [7 * 60, 11 * 60, 16 * 60 + 30, 19 * 60][(h >> 8) % 4];
  return { key, ...pick, weather, minutes };
}
{
  const t = dailyToday(), P0 = () => PRESETS[t.preset];
  const R0 = () => t.route || P0();
  setTimeout(() => { $('daily-desc').textContent = `${t.marathon ? 'Marathon day! ' : ''}Today: ${R0()?.src} → ${R0()?.dst} · ${RAKES[t.rake]?.label} · ${t.weather.toLowerCase()} · ${fmtClock ? fmtClock(t.minutes) : ''} — one shot at the daily top 10`; }, 0);
}
$('tile-daily').onclick = () => {
  const t = dailyToday(), p = t.route || PRESETS[t.preset];
  hideHome();
  state.daily = t;
  state.weather = t.weather; state.weatherMode = null; $('sel-weather').value = t.weather;
  startRoute({ src: p.src, dst: p.dst, via: p.via || [], rakeType: t.rake, stops: p.stops || null, minutes: t.minutes, trainNo: null, trainName: null });
  toast(`📅 Daily challenge ${t.key}: finish on time with no SPADs for the best score`, 'ok', 4500);
};
// ---- Mumbai evening rush at CSMT (Station Master, peak flow)
$('tile-peak').onclick = () => { $('sm-flow').value = '2'; $('sm-time').value = '1080'; smStart('CSMT', 'rush15'); };

const PRESETS = {
  'gtl-sc': { src: 'GTL', dst: 'SC', via: ['DHNE', 'KRNT', 'GWD'], rakeType: 'LHB', stops: ['DHNE', 'KRNT', 'GWD', 'MBNR', 'JCL', 'KCG', 'SC'] },
  'gtl-krnt': { src: 'GTL', dst: 'KRNT', via: [], rakeType: 'LHB' },
  'gtl-krnt-pass': { src: 'GTL', dst: 'KRNT', via: ['DHNE'], rakeType: 'DEMU_PASSENGER', allStops: true, minutes: 4 * 60 + 40 },
  'krnt-gtl': { src: 'KRNT', dst: 'GTL', via: [], rakeType: 'LHB' },
  'atp-krnt': { src: 'ATP', dst: 'KRNT', via: ['GTL'], rakeType: 'LHB' },
  'tpty-rc-wadi': { src: 'TPTY', dst: 'HYB', via: ['GTL', 'RC', 'WADI'], rakeType: 'LHB' },
  'tpty-krnt': { src: 'TPTY', dst: 'HYB', via: ['GTL', 'KRNT'], rakeType: 'LHB' },
  'sbc-gtl': { src: 'SBC', dst: 'GTL', via: [], rakeType: 'LHB' },
  'mas-bza': { src: 'MAS', dst: 'BZA', via: [], rakeType: 'VANDE_BHARAT' },
  // long-distance: main halts only
  'csmt-hwh': { src: 'CSMT', dst: 'HWH', via: ['NGP'], rakeType: 'DURANTO', trainNo: '12261', trainName: 'Mumbai CSMT–Howrah Duranto',
    stops: ['KYN', 'IGP', 'BSL', 'BD', 'NGP', 'DURG', 'R', 'BSP', 'JSG', 'TATA', 'KGP'] },
  'ndls-hwh': { src: 'NDLS', dst: 'HWH', via: [], rakeType: 'RAJDHANI', trainNo: '12302', trainName: 'Howrah Rajdhani',
    stops: ['CNB', 'PRYJ', 'DDU', 'GAYA', 'DHN', 'ASN', 'BWN'] },
  'mas-ndls': { src: 'MAS', dst: 'NDLS', via: ['BZA', 'KZJ'], rakeType: 'LHB', trainNo: '12615', trainName: 'Grand Trunk Express',
    stops: ['GDR', 'NLR', 'OGL', 'BZA', 'KMT', 'WL', 'KZJ', 'RDM', 'BPQ', 'NGP', 'ET', 'BPL', 'BINA', 'VGLJ', 'GWL', 'AGC', 'MTJ', 'NZM'] },
  'gtl-atp-direct': { src: 'GTL', dst: 'ATP', via: ['@ATP_TO_GTL_DIRECT'], rakeType: 'LHB' },
  // Hyderabad -> Hubballi via Raichur: comes in at Guntakal's west end from Adoni and leaves from the
  // same end for Ballari, so the train reverses at Guntakal (engine change / run round).
  'hyb-ubl': { src: 'HYB', dst: 'UBL', via: ['SC', 'WADI', 'RC', 'GTL'], rakeType: 'LHB' },
  // Named trains with their booked halts (the sim routes Gooty <-> Dhone through Guntakal, reversing there)
  prashanti: { src: 'SBC', dst: 'BBS', via: ['ATP', 'GTL', 'DHNE', 'BZA', 'VSKP'], rakeType: 'ICF', trainNo: '18463', trainName: 'Prashanti Express',
    stops: ['YNK', 'HUP', 'PKD', 'SSPN', 'DMM', 'ATP', 'GY', 'GTL', 'DHNE', 'NDL', 'GID', 'CBM', 'MRK', 'DKD', 'VKN', 'NRT', 'GNT', 'BZA', 'EE', 'TDD', 'NDD', 'RJY', 'SLO', 'ANV', 'TUNI', 'AKP', 'DVD', 'VSKP', 'VZM', 'CHE', 'PSA', 'SPT', 'IPM', 'BAM', 'CAP', 'KUR', 'BBS'] },
  amaravati: { src: 'VSG', dst: 'BZA', via: ['LD', 'UBL', 'HPT', 'BAY', 'GTL', 'DHNE'], rakeType: 'ICF', trainNo: '17225', trainName: 'Amaravati Express',
    stops: ['SVM', 'QLM', 'CLR', 'LD', 'LWR', 'DWR', 'UBL', 'GDG', 'KBL', 'HPT', 'TNGL', 'BAY', 'GTL', 'DHNE', 'BMH', 'NDL', 'GID', 'CBM', 'MRK', 'DKD', 'VKN', 'NRT', 'GNT', 'BZA'] },
  // Rayalaseema runs Guntakal - Raichur - Wadi - Secunderabad, then Kazipet - Warangal - Peddapalli - Karimnagar - Nizamabad
  rayalaseema: { src: 'TPTY', dst: 'NZB', via: ['GTL', 'RC', 'WADI', 'SC', 'KZJ'], rakeType: 'LHB', trainNo: '12793', trainName: 'Rayalaseema Express',
    stops: ['RU', 'KOU', 'RJP', 'HX', 'YA', 'MOO', 'TU', 'GY', 'GTL', 'AD', 'MALM', 'RC', 'YG', 'WADI', 'TDU', 'VKB', 'LPI', 'SC', 'JN', 'KZJ', 'WL', 'PDPL', 'KRMR', 'ARMR', 'NZB'] },
  'wadi-csmt': { src: 'WADI', dst: 'CSMT', via: [], rakeType: 'LHB' }
};
document.querySelectorAll('[data-preset]').forEach((b) => {
  b.onclick = async () => {
    if (await mpTakeRoute({ preset: b.dataset.preset })) return;
    const p = PRESETS[b.dataset.preset];
    $('sel-src').value = p.src; $('sel-dst').value = p.dst; $('sel-rake').value = p.rakeType;
    $('route-modal').style.display = 'none';
    startRoute({ trainNo: null, trainName: null, ...p, minutes: p.minutes ?? null });
  };
});
// ---- suburban simulator (Mumbai locals, Hyderabad MMTS): fixed all-stops routes
function startSuburban(city, route, reverse = false) {
  const p = suburbanPlan(city, route, reverse);
  $('route-modal').style.display = 'none';
  const no = String(SUBURBAN[city].numberBase + Math.floor(Math.random() * 300));
  startRoute({ src: p.src, dst: p.dst, via: [], rakeType: p.rake, allStops: true, fixedPlan: p.plan, sub: { city, route, reverse },
    trainNo: no, trainName: `${SUBURBAN[city].name.split(' (')[0]} local ${reverse ? '(reverse)' : ''}`.trim() });
}
const fillSubRoutes = () => {
  const C = SUBURBAN[$('sel-city').value];
  $('sel-subroute').innerHTML = Object.entries(C.routes).map(([k, r]) => `<option value="${k}">${r.name} · ${r.stations.length} stations · ${r.km} km</option>`).join('');
};
fillSubRoutes();
$('sel-city').onchange = fillSubRoutes;
$('sel-kind').onchange = (e) => {
  const sub = e.target.value === 'sub';
  $('sub-box').style.display = sub ? '' : 'none';
  for (const id of ['sel-src', 'sel-dst', 'sel-via', 'sel-rake', 'btn-solve', 'sel-roster']) { const row = $(id).closest('.row'); if (row) row.style.display = sub ? 'none' : ''; }
  $('solved').style.display = sub ? 'none' : '';
};
$('btn-sub-go').onclick = async () => { if (await mpTakeRoute({ sub: { city: $('sel-city').value, route: $('sel-subroute').value, reverse: $('sel-subdir').value === '1' } })) return; startSuburban($('sel-city').value, $('sel-subroute').value, $('sel-subdir').value === '1'); };
$('btn-solve').onclick = async () => {
  if (await mpTakeRoute({ src: $('sel-src').value, dst: $('sel-dst').value, via: $('sel-via').value ? $('sel-via').value.split(',').map((x) => x.trim()).filter(Boolean) : [], rakeType: $('sel-rake').value, allStops: $('sel-rake').value === 'DEMU_PASSENGER' })) return;
  const via = $('sel-via').value ? $('sel-via').value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  $('route-modal').style.display = 'none';
  startRoute({ src: $('sel-src').value, dst: $('sel-dst').value, via, rakeType: $('sel-rake').value, allStops: $('sel-rake').value === 'DEMU_PASSENGER', nightMail: $('chk-night').checked });
};
$('sel-roster').onchange = async (e) => {
  const r = state.rosters[Number(e.target.value)];
  if (!r) return;
  const via = r.viaCodesCsv ? r.viaCodesCsv.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (await mpTakeRoute({ src: r.sourceCode, dst: r.destCode, via, rakeType: r.coachType, allStops: r.coachType === 'DEMU_PASSENGER' })) return;
  $('route-modal').style.display = 'none';
  startRoute({ src: r.sourceCode, dst: r.destCode, via, rakeType: r.coachType, allStops: r.coachType === 'DEMU_PASSENGER' });
};
$('btn-save').onclick = async () => {
  const src = $('sel-src').value, dst = $('sel-dst').value, via = $('sel-via').value, rake = $('sel-rake').value;
  const pass = rake === 'DEMU_PASSENGER';
  try {
    await fetchJson(`${API_BASE}/rosters`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trainNumber: pass ? '77414' : '12799', trainName: pass ? 'Guntakal - Kurnool City Passenger (DEMU)' : `${src} - ${dst} Custom Express`,
        priorityTier: pass ? 'PASSENGER' : 'SUPERFAST', coachType: rake, locoClass: pass ? 'DEMU-1400HP' : 'WAP-7',
        sourceCode: src, destCode: dst, viaCodesCsv: via, haltsCsv: `${src},${via || ''},${dst}`.replace(/,,/g, ',')
      })
    });
    await refreshRosters();
    toast('Train saved to My trains', 'ok');
  } catch {
    toast('Could not save — you appear to be offline', 'warn');
  }
};

// Camera: on-screen pad (press and hold) + arrow keys / +/- (held)
document.querySelectorAll('#campad [data-cam]').forEach((btn) => {
  const act = btn.dataset.cam;
  const on = (e) => { e.preventDefault(); if (act === 'reset') rig.reset(); else rig.held.add(act); };
  const off = () => rig.held.delete(act);
  btn.addEventListener('pointerdown', on);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, off);
});
const CAM_KEYS = { ArrowLeft: ['left', 'panL'], ArrowRight: ['right', 'panR'], ArrowUp: ['up', 'panU'], ArrowDown: ['down', 'panD'], Equal: ['in', 'in'], NumpadAdd: ['in', 'in'], Minus: ['out', 'out'], NumpadSubtract: ['out', 'out'] };
window.addEventListener('keydown', (e) => {
  const k = CAM_KEYS[e.code];
  if (!k || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || $('auth').style.display === 'flex') return;
  e.preventDefault();
  rig.held.delete(k[0]); rig.held.delete(k[1]);
  rig.held.add(e.shiftKey ? k[1] : k[0]);
});
window.addEventListener('keyup', (e) => { const k = CAM_KEYS[e.code]; if (k) { rig.held.delete(k[0]); rig.held.delete(k[1]); } });
window.addEventListener('blur', () => rig.held.clear());

window.addEventListener('keydown', async (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || $('auth').style.display === 'flex') return;
  if (CAM_KEYS[e.code]) return;
  if (e.repeat && e.code !== 'KeyW' && e.code !== 'KeyS') { if (e.code === 'Space') e.preventDefault(); return; }
  await unlockAudio();
  switch (e.code) {
    case 'KeyW': notch(1); break;
    case 'KeyS': notch(-1); break;
    case 'Space': e.preventDefault(); brake(25); break;
    case 'KeyR': state.brake = 0; state.emergency = false; break;
    case 'KeyE': $('btn-emg').click(); break;
    case 'KeyH': audio.hornStart(); cab.ack(); if (state.nightMail && layout?.stationAt(state.sFront, 400)) state.nightHorns = (state.nightHorns || 0) + 1; break;
    case 'KeyB': cab.ack(); break;
    case 'KeyT': trackSwitch(true); break;
    case 'KeyA': $('btn-auto').click(); break;
    case 'KeyC': rig.setMode(rig.mode + 1); camSel.value = String(rig.mode); break;
    default:
      if (e.code === 'KeyL') toggleLights();
      if (e.code === 'KeyP') $('btn-panto').click();
      if (e.code === 'KeyX') toggleReverser();
      if (e.code === 'KeyI') toggleWipers();
      if (e.code === 'KeyV') { const id = CAMERA_MODES[rig.mode].id; rig.setMode(CAMERA_MODES.findIndex((m) => m.id === (id === 'cab' ? 'crew' : 'cab'))); camSel.value = String(rig.mode); }
      if (/^Digit[1-9]$/.test(e.code)) { rig.setMode(Number(e.code.slice(5)) - 1); camSel.value = String(rig.mode); }
  }
});
window.addEventListener('keyup', (e) => { if (e.code === 'KeyH') audio.hornStop(); });
window.addEventListener('pointerdown', unlockAudio, { once: true });

// ======================================================================
// Simulation loop
// ======================================================================
const tmpV = new THREE.Vector3();
let hudTimer = 0, lastSignalAspect = null, prevFront = 0, overspeedTimer = 0, gameDtLast = 0;

function physics(dt, fx = {}) {
  const R = RAKES[state.rakeType];
  const v = state.speed;
  const B = R.brake ?? 1.1;
  const limit = ops.limitAt(state.sFront, consist.length);
  if (state.incident) {
    // after a collision / derailment the train scrapes to a stop
    state.notch = 0; state.auto = false;
    state.speed = Math.max(0, v - 6 * dt);
    state.sFront += state.speed * dt * 0.6;
    return limit;
  }
  if (state.auto) {
    const { target: tk, stopDist } = ops.autoTarget(state.sFront, v, consist.length);
    const target = tk / 3.6;
    const err = target - v;
    const lagM = v * (R.brakeTau ?? 1.4) * 0.5;
    const need = Number.isFinite(stopDist) ? (v * v) / (2 * Math.max(0.5, stopDist - 2 - lagM)) : 0;
    if (state.notch < 0) state.notch = 0;
    if (need > 0.27 * B) { state.notch = 0; state.brake = Math.min(100, Math.round((need / B) * 125)); }
    else if (err > 1.5) { state.notch = Math.min(8, Math.max(state.notch, 1) + (err > 6 || R.goods ? 1 : 0)); state.brake = 0; }
    else if (err > 0.3) { state.brake = 0; }
    else if (err < -0.4) { state.notch = 0; state.brake = Math.min(100, Math.max(20, (-err) * 45)); }
    else { state.notch = Math.max(0, state.notch - 1); }
    if (target < 0.2 && v < 0.6) { state.notch = 0; state.brake = 60; }
    // never leave a halt before the booked departure time
    if (state.haltedAt && v < 0.3) {
      const dep = timetable.schedDep(state.haltedAt);
      if (dep != null && minDiff(state.gameMinutes, dep) < 0) { state.notch = 0; state.brake = 60; }
    }
  }
  // Kavach (Automatic Train Protection): brakes for red signals and overspeed
  let brakePct = state.brake;
  state.kavachActive = null;
  if (state.kavach && !state.auto) {
    const k = ops.kavach(state.sFront, v, consist.length);
    if (k.demand > 0) {
      state.kavachActive = k.reason;
      brakePct = Math.max(brakePct, k.demand);
      state.notch = Math.min(0, state.notch);
      if (!state._kavachToast) { toast(`KAVACH intervened: ${k.reason} — brakes applied`, 'warn', 3000); state._kavachToast = true; }
    } else state._kavachToast = false;
  }
  // Air brake: the brake pipe propagates the application down the train and the
  // cylinders take time to fill (seconds on a 58-wagon goods), and longer to release.
  const demand = state.emergency ? 1 : brakePct / 100;
  const tau = demand > state.brakeEff ? (state.emergency ? 0.55 : 1) * (R.brakeTau ?? 1.4) : (R.releaseTau ?? (R.brakeTau ?? 1.4) * 1.6);
  state.brakeEff += (demand - state.brakeEff) * Math.min(1, dt / Math.max(0.05, tau));
  const vmax = R.vmax / 3.6;
  const powerOn = !fx.tractionCut && !(state.traction === 'electric' && !state.panto);
  const throttle = powerOn ? Math.max(0, state.notch) / 8 : 0;
  const wetRail = state.weather === 'MONSOON' ? 0.82 : 1;
  let tract;
  if (R.goods) {
    // tractive-effort limited at low speed, power limited above (2 × WAG-9 on ~4,800 t)
    tract = throttle * Math.min(R.te * wetRail, R.power / Math.max(v, 0.5)) * Math.max(0, 1 - Math.pow(v / (vmax * 1.04), 8));
  } else {
    tract = throttle * R.accel * Math.min(1, Math.pow(9 / Math.max(v, 0.1), 0.55)) * Math.max(0, 1 - Math.pow(v / (vmax * 1.04), 6));
  }
  // gradient felt by the whole train (a long goods spans several grade changes)
  let gsum = 0, gn = 0;
  for (let k = 0; k <= consist.length; k += 40) { gsum += layout.path.gradeAt(state.sFront - k); gn++; }
  state.grade = gsum / gn;
  const grade = 9.81 * state.grade;
  if (fx.extraTE && throttle > 0) tract += Math.max(fx.extraTE, grade - R.te + 0.08) * throttle; // banker pushing at the rear
  const resist = v > 0.01 ? (R.goods ? 0.011 + 0.000014 * v * v : 0.008 + 0.0000085 * v * v) : 0;
  const wet = state.weather === 'MONSOON' ? 0.75 : 1;
  const brk = state.brakeEff * B * (state.emergency ? 1.32 : 1) * wet;
  const dyn = state.notch < 0 && powerOn ? (-state.notch / 4) * (R.dynBrake || 0) * Math.min(1, v / 4) : 0;
  let a = tract - resist - grade - (v > 0.01 ? brk + dyn : 0);
  if (v <= 0.01 && a < 0) a = 0;
  // stalled: full power, standing, and the bank is too steep to start
  if (R.goods && !state.auto && state.notch === 8 && powerOn && v < 0.15 && tract - grade < 0.004 && state.brakeEff < 0.1) {
    state.stallT += dt;
    if (state.stallT > 5 && !incidents.active) incidents.stalled({ sFront: state.sFront });
  } else state.stallT = 0;
  if (R.goods && state.auto && state.notch === 8 && v < 0.15 && tract - grade < 0.004 && !incidents.active) { state.stallT += dt; if (state.stallT > 5) incidents.stalled({ sFront: state.sFront }); }
  if (fx.forcedSpeed != null) a = Math.sign(fx.forcedSpeed - v) * Math.min(0.4, Math.abs(fx.forcedSpeed - v) / Math.max(dt, 1e-3));
  state.speed = Math.max(0, Math.min(vmax * 1.05, v + a * dt));
  if (state.speed < 0.05 && state.emergency) state.emergency = false;
  prevFront = state.sFront;
  const end = layout.trackMax < layout.total ? layout.trackMax - 4 : layout.total - 32; // buffer stops
  state.sFront = Math.min(end, state.sFront + state.speed * dt);
  const kmh = state.speed * 3.6;

  // Signal passed at danger. Policy: Kavach brakes before the signal; if it is
  // off (or the driver overruns anyway) the train-stop trips the emergency brake
  // as the signal is passed, the SPAD is logged, and any conflicting train ahead
  // becomes a real collision risk.
  for (const sig of ops.signalsAhead(prevFront - 0.01, 3)) {
    if (sig.kind === 'Distant') continue;
    if (sig.aspect === 'RED' && !sig.sig?.authority && prevFront < sig.s && state.sFront >= sig.s) {
      ops.spads++;
      scorer.onSpad();
      const where = `${sig.kind}${sig.label ? ' ' + sig.label : ''} at ${sig.st ? sig.st.name : 'block section'}`;
      if (state.kavach) { // train protection on: it trips the emergency brake
        state.emergency = true; state.notch = 0; state.auto = false; syncAuto();
        toast(`SPAD #${ops.spads}: ${where} passed at danger — Kavach applied the emergency brake`, 'warn', 6000);
      } else { // Kavach off: full manual control, nothing intervenes — the SPAD is only logged and penalised
        toast(`SPAD #${ops.spads}: ${where} passed at danger (Kavach off — no automatic braking; you are in manual control)`, 'warn', 6000);
      }
    }
  }
  // Derailment: far beyond what a turnout, loop or curve can take
  // only a sustained gross overspeed derails (a momentary spike does not)
  const derail = ops.derailCheck(state.sFront, consist.length, kmh);
  state.derailTimer = derail ? (state.derailTimer || 0) + dt : 0;
  if (state.derailments) {
    if (derail && state.derailTimer > 0.6) incident('derail', `DERAILED: ${derail}`);
    else if (derail && !state._derailWarned) { state._derailWarned = true; toast(`DANGER: ${derail} — brake now!`, 'warn', 2000); }
  } else if (derail && !state._derailWarned) {
    // derailment switched off: a violent lurch through the points, a big score penalty, no crash
    state._derailWarned = true;
    scorer.add(-150, `Overspeed over points/curve: ${derail}`);
    audio.pointThrow?.(); audio._clank?.(audio.ctx?.currentTime ?? 0, 0.5);
    state.lurch = 1;
    toast(`Heavy lurch! ${derail} — passengers thrown about (−150)`, 'warn', 3200);
  }
  if (!derail) state._derailWarned = false;
  // Collision with another train, or a buffer stop at the end of the line
  const hit = traffic.collision(state.sFront, consist.length, ops.lane);
  if (hit) incident('collision', `COLLISION with ${hit.train.name || hit.train.consist.rakeType.replace('_', ' ')} (${hit.headOn ? 'head-on' : 'rear-end'}) at ${Math.round(kmh)} km/h`, hit.train);
  if (state.sFront >= end - 0.5 && !state.incident) {
    if (kmh > 12) incident('collision', `Hit the buffer stop at ${Math.round(kmh)} km/h`);
    state.speed = 0;
  }
  if (kmh > limit + 4) {
    overspeedTimer += dt;
    if (overspeedTimer > 1.2) { // the alert and its message always come together
      overspeedTimer = 0; audio.beep();
      toast(kmh > limit + 12 ? `OVERSPEED ${Math.round(kmh)}/${Math.round(limit)} km/h — derailment risk on turnouts & curves` : `Over the speed limit: ${Math.round(kmh)} km/h in a ${Math.round(limit)} km/h section — ease off`, 'warn', 1800);
    }
  } else overspeedTimer = 0;
  return limit;
}

// A stop with a reason: a booked halt, a red signal or hold point ahead, an incident, the start
// or end of the journey. Anything else is an unscheduled stop that section control must hear about.
function stopExcused() {
  if (state.auto || state.incident || state.engineChange || incidents.active || state.haltedAt || !state.originDepRecorded) return true;
  const sig = ops.signalsAhead(state.sFront, 3).find((x) => x.kind !== 'Distant');
  if (sig && sig.aspect === 'RED' && !sig.sig?.authority && sig.s - state.sFront < 800) return true;
  if (ops.activeHolds(state.sFront, 800).length) return true;
  const nst = ops.nextStation(state.sFront);
  if (nst && state.sFront > nst.layout.zoneStart && (nst.isDest || nst.halt || ops.mustWaitAt(nst))) return true; // drawing up to a halt
  return false;
}

// The train stands on its brakes while its engine is being run round.
function holdForShunt() {
  state.speed = 0; state.emergency = false;
  prevFront = state.sFront;
  return ops.limitAt(state.sFront, consist.length);
}

// ---------------------------------------------------------- incidents
function incident(type, reason, aiTrain = null) {
  if (state.incident) return;
  state.incident = { type, reason, t: 0, ai: aiTrain, seed: Math.random() * 1000, k0: 0 };
  if (aiTrain) aiTrain.stopped = true;
  if (type === 'derail') {
    const idx = consist.vehicles.findIndex((v) => ops.lane.inTransition(state.sFront - v.offset - v.length / 2) || layout.curveAt(state.sFront - v.offset));
    state.incident.k0 = Math.max(0, idx);
  }
  audio.crash(type === 'derail' ? 0.8 : 1);
  scorer.onIncident(type);
  finishCareerRun({ completed: false, incident: type });
  state.auto = false; syncAuto();
  $('incident-title').textContent = type === 'derail' ? 'DERAILMENT' : 'COLLISION';
  $('incident-reason').textContent = reason;
  $('incident').style.display = 'flex';
}

function applyIncidentPose(dt) {
  const inc = state.incident;
  if (!inc) return;
  inc.t += dt;
  const amp = Math.min(1, inc.t / 1.3);
  const rnd = (i) => { const x = Math.sin((i + 1) * 12.9898 + inc.seed) * 43758.5453; return x - Math.floor(x); };
  consist.vehicles.forEach((v, i) => {
    const g = v.group;
    if (inc.type === 'derail') {
      if (i < inc.k0) return;
      const sgn = i % 2 ? 1 : -1, r = rnd(i), k = amp * Math.min(1, (i - inc.k0 + 1) / 3);
      g.rotation.y += sgn * (0.12 + 0.4 * r) * k;
      g.rotation.z += (r > 0.45 ? sgn * (0.25 + 0.9 * r) : 0.08 * sgn) * k;
      g.translateX(sgn * (0.6 + 2.6 * r) * k);
      g.position.y -= 0.35 * k;
    } else {
      if (i > 5) return;
      const sgn = i % 2 ? 1 : -1, k = amp * (1 - i / 6);
      if (i === 0) { g.rotation.x += 0.22 * k; g.rotation.z += 0.15 * k; g.position.y += 0.6 * k; }
      else { g.rotation.y += sgn * 0.14 * k; g.rotation.z += sgn * 0.08 * k; g.translateX(sgn * 0.5 * k); }
    }
  });
  if (inc.ai && inc.type === 'collision') {
    inc.ai.consist.vehicles.slice(0, 4).forEach((v, i) => {
      const k = amp * (1 - i / 4), sgn = i % 2 ? 1 : -1;
      v.group.rotation.y += sgn * 0.16 * k; v.group.rotation.z -= sgn * 0.1 * k;
      if (i === 0) { v.group.rotation.x -= 0.2 * k; v.group.position.y += 0.5 * k; }
    });
  }
}

function resumeFromLastStation() {
  const nxt = ops.nextStation(state.sFront);
  const idx = nxt ? Math.max(0, nxt.index - 1) : layout.stations.length - 2;
  const st = layout.stations[idx];
  if (st.isOrigin) ops.departedOrigin = true; else ops.dwell.set(st.index, st.dwellMin + 1);
  state.incident = null;
  state.speed = 0; state.notch = 0; state.brake = 0; state.emergency = false;
  state.sFront = st.layout.pEnd - 14;
  traffic.clearAll();
  $('incident').style.display = 'none';
  const p = layout.path.pointAt(state.sFront, 0);
  world.update(state.sFront, p, { init: true });
  rig.reset();
  toast(`Resumed at ${st.name} ${ops.trackOf(st).name}`, 'ok');
}

function applySignals() {
  for (const st of layout.stations) {
    const sigs = world.stationSignals(st);
    if (!sigs) continue;
    if (sigs.home) {
      const h = ops.homeAspect(st);
      sigs.home.set(h.aspect, h.featherDir);
      if (sigs.distant) sigs.distant.set(h.aspect === 'RED' ? 'YELLOW' : h.aspect === 'GREEN' ? 'GREEN' : 'DOUBLE_YELLOW');
    }
    const chosen = ops.choices.get(st.index);
    for (const [no, m] of sigs.starters) m.set(no === chosen ? ops.starterAspect(st) : 'RED');
  }
  for (const sg of ops.ibs) if (sg.mesh) sg.mesh.set(ops.aspectOf(sg).aspect);
}

const fmtMin = (m) => `${Math.floor(m)}:${String(Math.floor((m % 1) * 60)).padStart(2, '0')}`;

function handleEvents(events) {
  for (const ev of events) {
    const st = ev.st;
    if (ev.type === 'arriving' && st.halt) {
      const t = ops.trackOf(st);
      const where = t.pf ? `platform number ${t.pf}` : 'the loop line';
      stationAudio.say(`May I have your attention, please. Train number ${ops.trainNo.split('').join(' ')}, ${ops.trainName || `${spokenName(layout.stations[0].name)} to ${spokenName(layout.stations[layout.stations.length - 1].name)} Express`}, is arriving on ${where}.`,
        true, { kind: 'arriving', no: ops.trainNo, name: ops.trainName || `${spokenName(layout.stations[0].name)} - ${spokenName(layout.stations[layout.stations.length - 1].name)} Express`, pf: ops.trackOf(st).pf, code: st.code, stnName: st.name });
      toast(`Arriving ${st.name} — ${t.name}`, 'ok');
    }
    if (ev.type === 'halted') {
      const late = timetable.recordArrival(st, state.gameMinutes);
      scorer.onHalt(st, state.sFront - ops.stopPoint(st), late - state.controlDelay, state.leg, state.controlDelay);
      state.dueShown = null;
      state.haltedAt = st;
      const lateTxt = late > 1 ? ` · late ${Math.round(late)} min` : ' · on time';
      if (st.isDest) { toast(`Journey complete at ${st.name}${lateTxt}`, 'ok', 4000); setTimeout(showSummary, 2500); }
      else if (st.reversal) toast(`Reversal at ${st.name}: the train must change direction — change the engine (panel on the right) before departure.`, 'warn', 7000);
      else toast(`Halted at ${st.name} — scheduled stop ${st.dwellMin} min${lateTxt}`, 'ok', 4000);
    }
    if (ev.type === 'busy') {
      const bt = st.busy?.train, tk = st.busy?.track;
      toast(bt ? `${st.name}: ${tk?.pf ? 'platform ' + tk.pf : 'your line'} is occupied by ${bt.name} — home signal ON. Stop outside and wait, or pick another free line.` : `${st.name} is busy — home signal ON. Stop outside and wait for a platform.`, 'warn', 6000);
    }
    if (ev.type === 'busyClear') toast(`${st.name}: platform available, home signal cleared.`, 'ok');
    if (ev.type === 'precedenceClear') toast(`${st.name}: precedence over — starter will clear.`, 'ok');
    if (ev.type === 'ready') {
      const dep = timetable.schedDep(st);
      if (dep != null && minDiff(state.gameMinutes, dep) < -0.5) toast(`${st.name}: dwell complete, starter OFF — but booked departure is ${fmtClock(dep)}. Wait for right time (leaving early is penalised).`, 'warn', 6000);
      else { state.dueShown = st; toast(`${st.name}: right away! Starter signal cleared.`, 'ok'); audio.hornBlip(0.5); }
    }
  }
}

// ---------------------------------------------------------- stops editor
function renderStopsPanel() {
  const list = $('stops-list');
  if (!list || !layout) return;
  list.innerHTML = '';
  for (const st of layout.stations) {
    const row = document.createElement('div');
    row.className = 'stop-row';
    const passed = st.layout.pEnd < state.sFront || st.isOrigin;
    const fixed = st.isOrigin || st.isDest;
    row.innerHTML = `<label><input type="checkbox" ${st.halt ? 'checked' : ''} ${fixed || passed ? 'disabled' : ''}> <b>${st.code}</b> <span class="muted">${st.name} · ${st.platforms} PF</span></label>
      <select ${fixed || passed ? 'disabled' : ''}>${[1, 2, 3, 5, 10, 15, 20].map((m) => `<option value="${m}" ${m === st.dwellMin ? 'selected' : ''}>${m} min</option>`).join('')}</select>`;
    const cb = row.querySelector('input'), sel = row.querySelector('select');
    cb.onchange = () => { st.halt = cb.checked; ops.refreshDefaults(); timetable.rebuild(); buildStripMap(); pfShownFor = null; renderTimetable(); };
    sel.onchange = () => { st.dwellMin = Number(sel.value); timetable.rebuild(); pfShownFor = null; renderTimetable(); };
    list.appendChild(row);
  }
}

function updateHud(limit) {
  const kmh = state.speed * 3.6;
  $('speed').textContent = Math.round(kmh);
  $('limit').textContent = `${Math.round(limit)}`;
  const nl = ops.nextLimit(state.sFront, limit, 2500);
  const tsr = ops.tempLimitAt(state.sFront) || ops.tempLimitAt(state.sFront - consist.length);
  const board = incidents?.hudTarget(state.sFront);
  $('next-limit').textContent = [nl ? `next ${Math.round(nl.limit)} in ${Math.round(nl.dist)} m` : '', tsr ? `⚠ ${tsr.label}` : '', board && board.dist > -50 ? `${board.label} ${Math.max(0, Math.round(board.dist))} m` : ''].filter(Boolean).join(' · ');
  $('kavach-state').textContent = !state.kavach ? 'OFF' : state.kavachActive ? `BRAKING (${state.kavachActive})` : 'ON';
  $('kavach-state').style.color = !state.kavach ? '#fca5a5' : state.kavachActive ? '#fbbf24' : '#86efac';
  $('spads').textContent = String(ops.spads);
  const vmax = RAKES[state.rakeType].vmax;
  $('speedfill').style.width = `${Math.min(100, (kmh / vmax) * 100)}%`;
  $('speedlim').style.left = `${Math.min(100, (limit / vmax) * 100)}%`;
  $('notch').textContent = state.notch < 0 ? `DB${-state.notch}` : `N${state.notch}`;
  $('brake').textContent = state.emergency ? 'EMERGENCY' : `${state.brake}%${RAKES[state.rakeType].goods && Math.abs(state.brakeEff * 100 - state.brake) > 6 ? ` (${Math.round(state.brakeEff * 100)}% on)` : ''}`;
  const g = state.grade || 0;
  $('grade').textContent = Math.abs(g) < 0.0008 ? 'Level' : `1 in ${Math.round(1 / Math.abs(g))} ${g > 0 ? '▲ rising' : '▼ falling'}`;
  $('panto').textContent = state.traction !== 'electric' ? 'diesel' : state.panto ? 'UP' : 'DOWN';
  $('panto').style.color = state.traction === 'electric' && !state.panto ? '#fbbf24' : '';
  const odoKm = Math.max(0, layout.realKmAt(state.sFront) - layout.realKmAt(layout.stations[0].layout.pEnd - 14));
  $('odo').textContent = `${odoKm.toFixed(1)} km`;
  trackCareerKm(odoKm);
  const st = ops.currentStation(state.sFront);
  const line = layout.lineAt(state.sFront);
  let section = st ? `${st.name} yard` : (line === 'D' ? 'Double line' : 'Single line');
  if (layout.gtl && state.sFront > layout.gtl.s0 && state.sFront < layout.gtl.s1) section = layout.gtl.gooty ? `GTL junction · Dhone line ${layout.gtl.dir > 0 ? 'left' : 'right'}` : `Dhone diversion · VV Nagar ${world.gtl.vvSide}`;
  $('section').textContent = section;

  const halted = !!state.haltedAt && state.speed < 0.3;
  const d = timetable.delay(state.gameMinutes, state.sFront, halted);
  state.delay = d;
  $('delay').textContent = d > 1 ? `Late ${Math.round(d)} min` : d < -1 ? `Ahead ${Math.round(-d)} min` : 'On time';
  $('delay').style.color = d > 1 ? '#fca5a5' : '#86efac';
  $('score').textContent = `${scorer.total()} · comfort ${Math.round(scorer.comfort)}%`;
  const sigs = ops.signalsAhead(state.sFront, 1);
  const sig = sigs[0];
  for (const id of ['lamp-g', 'lamp-y1', 'lamp-y2', 'lamp-r']) $(id).className = 'lamp';
  // Signal sighting: fog (worse at night) hides the aspect until close; the Fog Safe Device still counts down
  const sighting = state.weather === 'FOG' ? (state.night > 0.5 ? 140 : 240) : state.weather === 'MONSOON' ? 450 : state.night > 0.5 ? 800 : Infinity;
  const hold = ops.activeHolds(state.sFront).find((h) => h.show);
  if (!sig && !hold) {
    $('sig-name').textContent = 'NO SIGNAL AHEAD';
    $('sig-aspect').textContent = layout.stations[layout.stations.length - 1].terminal ? 'END OF LINE' : '—';
    $('feather').textContent = '\u00a0';
    $('sig-dist').textContent = '';
  } else if (hold && (!sig || hold.s < sig.s)) {
    $('lamp-r').classList.add('red');
    $('sig-name').textContent = hold.short.toUpperCase();
    $('sig-aspect').textContent = 'ON';
    $('feather').textContent = hold.reason;
    $('sig-dist').textContent = `${Math.round(hold.s - state.sFront)} m`;
  } else if (sig && sig.s - state.sFront > sighting) {
    $('sig-name').textContent = `FOG SAFE DEVICE · ${sig.kind === 'IBS' ? 'IBS' : sig.kind.toUpperCase()}`;
    $('sig-aspect').textContent = 'NOT SIGHTED';
    $('feather').textContent = `Visibility ~${sighting} m`;
    $('sig-dist').textContent = `${Math.round(sig.s - state.sFront)} m`;
  } else if (sig) {
    const a = sig.aspect;
    if (a === 'RED') $('lamp-r').classList.add('red');
    if (a === 'YELLOW' || a === 'DOUBLE_YELLOW') $('lamp-y1').classList.add('yellow');
    if (a === 'DOUBLE_YELLOW') $('lamp-y2').classList.add('yellow');
    if (a === 'GREEN') $('lamp-g').classList.add('green');
    $('sig-name').textContent = sig.kind === 'IBS' ? sig.label : `${sig.kind.toUpperCase()} · ${sig.st.code}`;
    $('sig-aspect').textContent = a.replace('_', ' ') + (sig.sig?.failed ? (sig.sig.authority ? ' (defective · T/369(3b))' : ' (defective)') : '');
    $('feather').textContent = sig.featherDir ? `Route indicator ${sig.featherDir < 0 ? '◤ LEFT' : '◥ RIGHT'} → ${ops.trackOf(sig.st).name} (${LOOP_LIMIT} km/h)` : (sig.aspect === 'RED' && sig.reason ? sig.reason : '\u00a0');
    $('sig-dist').textContent = `${Math.round(sig.s - state.sFront)} m`;
    const key = sig.kind + (sig.st ? sig.st.index : sig.s) + a;
    if (lastSignalAspect && key !== lastSignalAspect && a !== 'RED') { /* aspect change */ }
    lastSignalAspect = key;
  }
  const nst = ops.nextStation(state.sFront);
  if (nst) {
    const realKm = layout.realKmAt(nst.layout.sCenter) - layout.realKmAt(state.sFront);
    const halted = nst.halt && (ops.dwell.get(nst.index) || 0) > 0 && !ops.dwellDone(nst);
    $('next-st').textContent = halted && nst.isDest
      ? `Arrived at ${nst.name}${nst.terminal ? ' (terminus)' : ''} — journey complete`
      : halted
      ? `Halted at ${nst.name} · ${ops.dwellLeft(nst) > 0 ? `dwell ${fmtMin(ops.dwellLeft(nst))} left` : 'dwell over'} · booked dep ${timetable.schedDep(nst) != null ? fmtClock(timetable.schedDep(nst)) : '—'}`
      : `${nst.halt ? `Next halt (${nst.dwellMin} min)` : 'Next'}: ${nst.name} · ${ops.trackOf(nst).name}`;
    const stopIn = ops.stopPoint(nst) - state.sFront;
    $('next-dist').textContent = halted ? '' : realKm > 1.2 ? `${realKm.toFixed(1)} km` : `${Math.max(0, Math.round(nst.halt ? stopIn : realKm * 1000))} m`;
  } else {
    $('next-st').textContent = 'Destination reached';
    $('next-dist').textContent = '';
  }
  const frac = state.sFront / layout.total;
  $('strip-me').style.left = `${frac * 100}%`;
  $('strip-done').style.width = `${frac * 100}%`;
  const hh = Math.floor(state.gameMinutes / 60), mm = Math.floor(state.gameMinutes % 60);
  $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

let last = performance.now();
let ttTimer = 0;
let fpsAcc = 0, fpsN = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frameMs = now - last;
  if (frameMs > 70 && layout && !busy) (window.__railsimFrames ||= []).push({ at: Math.round(state.sFront), ms: Math.round(frameMs), prev: world?.lastBuild || '' });
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (smScene && stationMaster.running && world && !busy) { // Station Master: the driving sim pauses meanwhile
    // steady 60 fps option: skip display refreshes that come too soon (keeps motion even on 90/120/144 Hz screens)
    if (smGfx.cap && now - smGfx.lastFrame < 1000 / 60 - 2) { last = now - rawDt * 1000; return; }
    const dtF = smGfx.cap && smGfx.lastFrame ? Math.min(0.05, (now - smGfx.lastFrame) / 1000) : rawDt;
    smGfx.lastFrame = now;
    stationMaster.tick(dtF);
    smScene.update(stationMaster, dtF);
    smFps.n++; smFps.t += frameMs;
    if (smFps.t > 500) { $('sm-fps').textContent = `${Math.round((1000 * smFps.n) / smFps.t)} fps`; smFps.n = 0; smFps.t = 0; }
    if (stationMaster.view !== 'panel') {
      const f = smScene.focus();
      world.update(smScene.sC, f, { budget: 1, terrainBudget: 1 }); // small budget: no frame hitches while streaming
      const { night } = sky.update(state.gameMinutes, state.weather, camera, f, dtF);
      rain.visible = state.weather === 'MONSOON'; if (rain.visible) rain.position.copy(camera.position).add(new THREE.Vector3(0, -12, 0));
      world.animate(dtF, night, f);
      if (pipeline && smGfx.fx) pipeline.render(); else renderer.render(scene, camera); // no bloom by default: lighter, smoother
    }
    return;
  }
  if (!layout || busy) {
    if (pipeline) pipeline.render(); else renderer.render(scene, camera);
    return;
  }
  const dt = rawDt * state.simRate;
  // Journey clock follows the distance compression while moving (real-km pace),
  // and runs 8x while standing so dwell times pass in seconds.
  const localScale = Math.max(1, (layout.realKmAt(state.sFront + 5) - layout.realKmAt(state.sFront - 5)) * 100);
  const gameDt = (dt * (state.speed > 0.3 ? localScale : 8)) / 60;
  state.gameMinutes = (state.gameMinutes + gameDt) % 1440;

  gameDtLast = gameDt;
  const shunting = state.engineChange?.kind === 'shunt';
  const limit = shunting ? holdForShunt() : physics(dt, state.fx || {});
  const events = ops.update(dt, { sFront: state.sFront, speed: state.speed, trainLen: consist.length, gameDt });
  handleEvents(events);
  state.fx = incidents.update(dt, {
    sFront: state.sFront, prevFront, speed: state.speed, trainLen: consist.length, locoSpan: state.locoSpan,
    traction: state.traction, hasPanto: state.traction === 'electric', panto: state.panto, setPanto: (up) => setPanto(up),
    auto: state.auto, hornHeld: audio.hornHeld, brake: state.brake, grade: state.grade, incident: state.incident
  });
  if (state.fx.lurch) state.lurch = Math.max(state.lurch || 0, state.fx.lurch);
  // stopped in section for no reason: section control wants to know why (real seconds, whatever the sim rate)
  control.update(rawDt, { sFront: state.sFront, speed: state.speed, gameDt, excused: stopExcused(), auto: state.auto });
  const nsig = ops.signalsAhead(state.sFront, 1)[0];
  weatherOps.update(dt, { sFront: state.sFront, prevFront, speed: state.speed, trainLen: consist.length, nextSignalDist: nsig ? nsig.s - state.sFront : null });
  consist.place(layout.path, ops.lane, state.sFront, 1);
  if (state.auto) cab.ack(); // the auto driver acknowledges the VCD
  {
    const sub = RAKES[state.rakeType].suburban;
    const rural = (sv) => !sub && !layout.stations.some((x) => sv > x.layout.zoneStart - 1500 && sv < x.layout.zoneEnd + 1500);
    cattle.update(dt, { sFront: state.sFront, layout, lane: ops.lane, rural, lastHornS: state.lastHornS ?? -1e9, speed: state.speed, enabled: true,
      onHit: (v) => { audio.crash(Math.min(0.5, 0.15 + v / 60)); toast(`🐄 Cattle run-over at ${Math.round(v * 3.6)} km/h — sound the horn early on rural sections`, 'warn', 4500); scorer?.add?.(-150, 'Cattle run-over'); } });
    const stNear = layout.stations.reduce((b, x) => (Math.abs(x.layout.sCenter - state.sFront) < Math.abs((b?.layout.sCenter ?? 1e12) - state.sFront) ? x : b), null);
    const kp = consist.vehicles[0].group.getWorldPosition(new THREE.Vector3());
    kites.update(dt, world.festival === 'SANKRANTI' && Kites.region(stNear), kp);
  }
  cab.update(rawDt, { speedKmh: state.speed * 3.6, sFront: state.sFront, prevFront, ops, layout, weather: state.weather, stopped: state.speed < 0.3 });
  // crew change at the big junctions: announced once when we stand there
  if (state.haltedAt?.crewChange && !state.haltedAt.crewAnnounced) { state.haltedAt.crewAnnounced = true; toast(`👥 Crew change at ${state.haltedAt.name}: loco pilot & assistant signing off, new crew booking on (${state.haltedAt.dwellMin} min)`, 'ok', 4500); }
  // doors open and passengers get off / board while standing at a halt; doors shut as we move off
  {
    const stH = layout.stationAt(state.sFront);
    const standing = state.speed < 0.15 && stH && stH.halt && !RAKES[state.rakeType].goods && state.sFront > stH.layout.pStart && state.sFront <= stH.layout.pEnd + 2;
    if (standing && !boarding.active && boarding.st !== stH) boarding.start({ consist, layout, lane: ops.lane, sFront: state.sFront, st: stH, track: ops.trackOf(stH) });
    else if (!standing && boarding.active && state.speed > 0.4) { boarding.stop(); }
    if (!standing && stH !== boarding.st && !boarding.active) boarding.st = null;
    boarding.update(dt);
  }
  stepEngineChange(dt);
  trackJourney(dt, limit);
  traffic.update(dt, state.sFront, state.speed, ops.lane, consist.length, state.gameMinutes);
  applyIncidentPose(dt);

  const lead = consist.lead;
  lead.group.getWorldPosition(tmpV);
  const tw0 = performance.now();
  world.update(state.sFront, camera.position.distanceTo(tmpV) > 400 ? camera.position : tmpV, { budget: 2, terrainBudget: 2 });
  const tw = performance.now() - tw0;
  if (tw > 25) (window.__railsimSpikes ||= []).push({ at: Math.round(state.sFront), ms: Math.round(tw), what: world.lastBuild });
  world.updateSwitches(state.sFront, ops.lane, dt, (T) => {
    const d = Math.abs(T.sToe - state.sFront);
    audio.pointThrow(Math.max(0, 1 - d / 900));
  });
  applySignals();

  const { night } = sky.update(state.gameMinutes, state.weather, camera, tmpV, rawDt);
  state.night = night;
  updateNightEmissives(night);
  if (state.flash > 0) { // lightning
    const f = state.flash * (0.6 + 0.4 * Math.sin(now * 0.09));
    sky.hemi.intensity += f * 5;
    renderer.toneMappingExposure += f * 0.7;
    state.flash = Math.max(0, state.flash - rawDt * 4);
  }
  const lightsOn = state.lights === 'on' || (state.lights === 'auto' && (night > 0.12 || state.weather === 'FOG' || state.weather === 'MONSOON'));
  if (consist.headlight) consist.headlight.intensity = lightsOn ? 80 + night * (state.weather === 'FOG' ? 900 : 1500) : 0; // bright but not blinding; fog scatters it into the beam instead
  if (consist.beam) {
    const fogK = state.weather === 'FOG' ? 1 : state.weather === 'MONSOON' ? 0.5 : 0;
    consist.beam.material.opacity = lightsOn ? Math.min(0.45, night * 0.16 + fogK * (0.06 + night * 0.22)) : 0;
    consist.beam.visible = consist.beam.material.opacity > 0.01 && !['cab', 'crew'].includes(CAMERA_MODES[rig.mode].id);
  }
  world.animate(dt, night, tmpV);
  if (bloomNode) {
    const fogGlow = state.weather === 'FOG' ? 0.22 : state.weather === 'MONSOON' ? 0.1 : 0;
    bloomNode.strength.value = 0.14 + night * 0.18 + fogGlow;
    bloomNode.threshold.value = 1.15 - night * 0.15 - fogGlow * 0.6;
    bloomNode.radius.value = 0.4 + fogGlow;
  }

  rain.visible = state.weather === 'MONSOON';
  if (rain.visible) {
    rain.position.set(camera.position.x, camera.position.y - 20 + ((-now * 0.028) % 20 + 20) % 20, camera.position.z);
  }

  const midIdx = Math.min(consist.vehicles.length - 1, Math.floor(consist.vehicles.length / 2));
  if (lead.crew) lead.crew.lp.visible = CAMERA_MODES[rig.mode].id !== 'cab'; // we sit in the driver's seat in the front view
  const wipersOn = state.wipers === 'on' || (state.wipers === 'auto' && state.weather === 'MONSOON');
  animateWipers(lead, rawDt, wipersOn);
  animateCrew(lead, consist.vehicles[consist.vehicles.length - 1], now / 1000, { throttle: Math.min(1, Math.max(0, state.notch) / 8), brake: state.emergency ? 1 : state.brake / 100, speed: state.speed });
  const rr = state.engineChange?.kind === 'shunt' ? state.engineChange.rr : null;
  rig.update(rawDt, {
    lead: rr && rr.phase !== 'uncouple' ? rr.loco : lead, mid: consist.vehicles[midIdx], window: consist.vehicles[Math.min(3, consist.vehicles.length - 1)], tail: consist.vehicles[consist.vehicles.length - 1],
    heading: Math.atan2(Math.sin(-lead.group.rotation.y), Math.cos(-lead.group.rotation.y)),
    sFront: state.sFront, path: layout.path, lane: ops.lane
  });

  if (state.lurch > 0) { // camera shake for a violent lurch over points
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.35).multiplyScalar(state.lurch));
    state.lurch = Math.max(0, state.lurch - rawDt * 1.2);
  }
  if (state.incident && state.incident.t < 0.7) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5).multiplyScalar(1 - state.incident.t / 0.7));
  // water ambience by what the line passes: rivers it crosses, village tanks / lakes, the sea at the coast
  {
    const W = world.water, sF = state.sFront;
    let river = 0, lake = 0, sea = 0;
    for (const r of W?.rivers || []) { const d = Math.abs(r.s - sF), R = r.big ? 650 : 220; if (d < R) river = Math.max(river, (1 - d / R) * (r.big ? 1 : 0.55)); }
    for (const l of W?.lakes || []) { const d = Math.hypot(l.x - tmpV.x, l.z - tmpV.z) - l.r; if (d < 450) lake = Math.max(lake, 1 - Math.max(0, d) / 450); }
    for (const c of W?.coasts || []) if (sF > c.s0 && sF < c.s1) sea = Math.max(sea, 1 - Math.min(1, Math.abs(sF - c.st.layout.sCenter) / 6000) * 0.6);
    audio.ambience({ river, lake, sea, interior: CAMERA_MODES[rig.mode].kind === 'look' });
  }
  audio.update(rawDt, {
    speedKmph: state.speed * 3.6, notch: state.traction === 'electric' && !state.panto ? 0 : Math.max(0, state.notch), brake: Math.round(state.brakeEff * 100),
    traction: state.traction, onTurnout: ops.lane.inTransition(state.sFront - 6),
    interior: CAMERA_MODES[rig.mode].kind === 'look', distanceStep: state.speed * dt, weather: state.weather, wipers: wipersOn,
    curveR: layout.curveAt(state.sFront - 10)?.R || 0,
    onBridge: layout.path.yAt(state.sFront) - layout.path.groundAt(state.sFront) > 3,
    passing: nearestPassing()
  });
  const nearSt = layout.stationAt(state.sFront, 300);
  stationAudio.update(rawDt, {
    st: nearSt, distToPlatform: nearSt ? Math.max(0, nearSt.layout.pStart - state.sFront, state.sFront - consist.length - nearSt.layout.pEnd) : 9999,
    interior: CAMERA_MODES[rig.mode].kind === 'look', speedKmph: state.speed * 3.6, ops, layout, now: state.gameMinutes,
    ownHalted: !!state.haltedAt && state.speed < 0.3, timetable, trains: ops.trains()
  });

  hudTimer += rawDt;
  if (hudTimer > 0.1) { hudTimer = 0; updateHud(limit); updatePlatformPanel(); updateEnginePanel(); updateDashboard(limit); updateIncidentPanel(); updateShuntPanel(); updateControlPanel(); }
  ttTimer += rawDt;
  if (ttTimer > 2) { ttTimer = 0; if ($('tt-panel').style.display === 'block') renderTimetable(); }

  if (pipeline) pipeline.render(); else renderer.render(scene, camera);

  fpsAcc += rawDt; fpsN++;
  if (fpsAcc > 2) { window.__railsimFps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
});

// ======================================================================
// Journey tracking, engine change, dashboard, timetable, recorder, summary
// ======================================================================
function trackJourney(dt, limit) {
  const kmh = state.speed * 3.6;
  const accel = (state.speed - (state._prevSpeed ?? state.speed)) / Math.max(dt, 1e-3);
  state._prevSpeed = state.speed;
  if (dt > 0) scorer.update(dt, { kmh, limit, accel, emergency: state.emergency, km: layout.realKmAt(state.sFront) });
  // departure is booked when the front passes the starter (creeping up to it doesn't count)
  if (state.haltedAt && state.speed > 0.3 && state.sFront > ops.starterS(state.haltedAt) - 2) {
    const st = state.haltedAt;
    const d = timetable.recordDeparture(st, state.gameMinutes);
    if (!st.isDest) { scorer.onDeparture(st, d); state.leg = { startDelay: Math.max(0, d - state.controlDelay), overspeeds: scorer.overspeeds }; }
    state.haltedAt = null;
  }
  if (!state.originDepRecorded && state.sFront > ops.starterS(layout.stations[0]) - 2) {
    const o = layout.stations[0];
    state.originDepRecorded = true;
    const d = timetable.recordDeparture(o, state.gameMinutes);
    scorer.onDeparture(o, d);
    state.leg = { startDelay: Math.max(0, d - state.controlDelay), overspeeds: scorer.overspeeds };
  }
  // control delay: standing at a red signal / hold point when we could otherwise go, or stopped by an incident
  if (state.speed < 0.3 && gameDtLast > 0) {
    const sig = ops.signalsAhead(state.sFront, 1)[0];
    const nearRed = (sig && sig.aspect === 'RED' && sig.s - state.sFront < 400) || ops.activeHolds(state.sFront, 400).length > 0;
    const hs = state.haltedAt || (state.originDepRecorded ? null : layout.stations[0]);
    const due = !hs || (ops.dwellDone(hs) && (timetable.schedDep(hs) == null || minDiff(state.gameMinutes, timetable.schedDep(hs)) >= 0));
    if ((nearRed && due) || incidents.active) state.controlDelay += gameDtLast;
  }
  // right time reached at a halt whose dwell is already over
  const hs = state.haltedAt;
  if (hs && state.speed < 0.3 && state.dueShown !== hs && !hs.isDest && ops.dwellDone(hs) && !ops.mustWaitAt(hs)) {
    const dep = timetable.schedDep(hs);
    if (dep != null && minDiff(state.gameMinutes, dep) >= 0) { state.dueShown = hs; toast(`${hs.name}: right time ${fmtClock(dep)} — guard shows the green flag. Right away!`, 'ok', 3500); audio.hornBlip(0.5); }
  }
  for (const st of layout.stations) {
    if (!st.halt && !state.passed.has(st.index) && state.sFront > st.layout.sCenter) { state.passed.add(st.index); timetable.recordPass(st, state.gameMinutes); }
  }
  // level crossings: gates, bell, whistle boards
  const bell = world.updateLevelCrossings(state.sFront, consist.length, dt);
  audio.bellTick(dt, bell ? Math.max(0, 1 - Math.abs(bell.s - state.sFront) / 900) : 0);
  for (const lc of world.lcs) {
    if (prevFront < lc.wlS && state.sFront >= lc.wlS) { lc.window = true; lc.horned = false; if (state.auto) { audio.hornBlip(1.4); lc.horned = true; } }
    if (lc.window && audio.hornHeld) lc.horned = true;
    if (lc.window && prevFront < lc.s && state.sFront >= lc.s) { lc.window = false; scorer.onWhistle(lc.horned); }
  }
}

function nearestPassing() {
  let best = null;
  for (const t of ops.trains()) {
    const lo = t.dir > 0 ? t.s - t.consist.length : t.s, hi = t.dir > 0 ? t.s : t.s + t.consist.length;
    const d = state.sFront < lo ? lo - state.sFront : state.sFront > hi ? state.sFront - hi : 0;
    if (!best || d < best.dist) best = { dist: d, speed: t.v + state.speed, side: Math.sign(t.lane.at(state.sFront) - ops.lane.at(state.sFront)) * 0.7 };
  }
  return best;
}

// ---- engine change / reversal
function updateEnginePanel() {
  const st = state.haltedAt;
  const show = st && state.speed < 0.3 && !state.engineChange && !state.reversing && !st.isDest && (st.reversal || st.tractionChange || st.category !== 'station') && !(st.engineChanged && !st.reversal);
  if (show && st.tractionChange && !st._tcShown) { st._tcShown = true; $('engine-select').value = st.tractionChange; toast(`⚙ Traction change at ${st.name}: cut off the electric loco and couple the ${st.tractionChange} for the Dhone line — the starter stays red until it is done`, 'warn', 6000); }
  const panel = $('engine-panel');
  panel.style.display = show ? 'block' : 'none';
  if (!show) return;
  const mu = isMultipleUnit(state.rakeType);
  $('engine-title').textContent = st.reversal ? `Reversal at ${st.name}` : `Loco change at ${st.name} (optional)`;
  $('engine-sub').textContent = mu ? 'Multiple unit: the loco pilot walks to the other driving cab.' : `Current engine: ${LOCOS[consist.loco || defaultLoco(state.rakeType)].label}`;
  $('engine-select').style.display = mu ? 'none' : '';
  $('btn-engine').textContent = mu ? 'Change ends' : 'Shunter changes engine';
  $('btn-runround').style.display = mu ? 'none' : '';
}

// Run round the train yourself with the relief loco (shunting mini-game).
function startRunRound() {
  const st = state.haltedAt;
  if (!st || state.engineChange || isMultipleUnit(state.rakeType)) return;
  const plan = planRunRound(st, ops, consist.length);
  if (!plan) { toast(`${st.name}: no free line to run round on — the shunter will change the engine`, 'warn', 3500); startEngineChange(); return; }
  const key = $('engine-select').value;
  state.engineChange = { kind: 'shunt', st, key, rr: new RunRound({ st, plan, consist, layout, ops, scene, audio, toast, scorer, locoKey: key, sFront: state.sFront }) };
  state.notch = 0; state.brake = 0; state.auto = false; syncAuto();
}

function startEngineChange() {
  const st = state.haltedAt;
  if (!st || state.engineChange) return;
  if (isMultipleUnit(state.rakeType)) { state.engineChange = { kind: 'cab', t: 0, st }; toast('Loco pilot changing ends…', 'ok'); return; }
  const key = $('engine-select').value;
  const old = consist.vehicles[0];
  const coachFront = state.sFront - old.length - 0.9;
  const newV = LOCOS[key].build();
  newV.group.visible = false;
  scene.add(newV.group);
  state.engineChange = { kind: 'loco', t: 0, st, old, newV, coachFront, key };
  audio.hornBlip(0.4);
  toast(`Uncoupling ${LOCOS[consist.loco || defaultLoco(state.rakeType)].label}…`, 'ok');
}

function stepEngineChange(dt) {
  const ec = state.engineChange;
  if (!ec) return;
  ec.t += dt;
  const sm = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  if (ec.kind === 'cab') { if (ec.t > 10) finishEngineChange(ec); return; }
  if (ec.kind === 'shunt') {
    const done = ec.rr.update(dt, { notch: state.notch, brake: state.brake, auto: state.auto });
    if (done) {
      const { newV, coachFront } = ec.rr.result;
      consist.replaceLead(newV);
      consist.loco = ec.key;
      state.traction = LOCOS[ec.key].traction;
      state.sFront = coachFront + 0.9 + newV.length;
      state.notch = 0; state.brake = 0;
      if (state.traction === 'electric') { state.panto = true; $('btn-panto').classList.add('on'); $('btn-panto').textContent = 'Panto: up'; }
      $('shunt-panel').style.display = 'none';
      finishEngineChange(ec);
    }
    return;
  }
  if (ec.t < 6) Consist.placeVehicle(ec.old, layout.path, ops.lane, ec.coachFront + 0.9 + ec.old.length / 2 + 140 * sm(ec.t / 6));
  else ec.old.group.visible = false;
  if (ec.t >= 6.5) {
    ec.newV.group.visible = true;
    Consist.placeVehicle(ec.newV, layout.path, ops.lane, ec.coachFront + 0.9 + ec.newV.length / 2 + 140 * (1 - sm((ec.t - 6.5) / 6)));
  }
  if (ec.t >= 12.5) {
    ec.newV.group.removeFromParent();
    consist.replaceLead(ec.newV);
    consist.loco = ec.key;
    state.traction = LOCOS[ec.key].traction;
    state.sFront = ec.coachFront + 0.9 + ec.newV.length;
    audio.crash(0.08); // coupling clank
    finishEngineChange(ec);
  }
}

function finishEngineChange(ec) {
  state.engineChange = null;
  toast(ec.kind === 'cab' ? 'Driving cab changed — brake continuity test OK' : `${LOCOS[consist.loco].label} coupled — brake continuity test OK`, 'ok', 3500);
  // at a reversal the starter here stays at danger: the train leaves on the new leg, out of the same end
  if (ec.st.reversal) { state.reversing = true; setTimeout(() => continueAfterReversal(ec.st), 1800); }
  else ec.st.engineChanged = true;
}

// After the engine / cab change at a reversal station the journey carries on out of the same end:
// the rest of the route is laid afresh with this station as its origin and the train on the same platform.
function continueAfterReversal(st) {
  if (busy) { setTimeout(() => continueAfterReversal(st), 500); return; }
  state.reversing = false;
  const legs = state.plan.route.legs;
  const k = legs.findIndex((l) => l.from === st.code);
  if (k < 0) return;
  const rest = legs.slice(k).map((l) => l.to);
  const dst = rest[rest.length - 1];
  const stops = layout.stations.filter((x) => x.index > st.index && x.halt).map((x) => x.code);
  const pf = ops.trackOf(st).pf;
  startRoute({ src: st.code, dst, via: rest.slice(0, -1), rakeType: state.rakeType, allStops: state.allStops, stops,
    cont: { pf, bookedDep: timetable.schedDep(st) ?? state.gameMinutes + 2, spads: ops.spads } });
}

// ---- section control (unscheduled stop) panel
function updateControlPanel() {
  if (!control.dirty) return;
  control.dirty = false;
  const html = control.render();
  $('ctl-panel').style.display = html ? 'block' : 'none';
  if (html) $('ctl-panel').innerHTML = html;
}
$('ctl-panel').onclick = (e) => { const b = e.target.closest('[data-ctl]'); if (b && !b.disabled && control) control.act(b.dataset.ctl); };

// ---- run-round (shunting) panel
function updateShuntPanel() {
  const rr = state.engineChange?.kind === 'shunt' ? state.engineChange.rr : null;
  const el = $('shunt-panel');
  el.style.display = rr ? 'block' : 'none';
  if (rr) el.innerHTML = rr.render();
}

// ---- breakdowns & incidents panel
function updateIncidentPanel() {
  const el = $('inc-panel');
  if (!incidents.dirty) return;
  incidents.dirty = false;
  const html = incidents.render();
  el.style.display = html ? 'block' : 'none';
  if (html) el.innerHTML = html;
}

// ---- cab dashboard (shown in the cab view)
function updateDashboard(limit) {
  const el = $('dash');
  const cab = CAMERA_MODES[rig.mode].id === 'cab'; // gauges overlay in the driver's-eye front view
  el.style.display = cab ? 'block' : 'none';
  if (!cab) return;
  const sig = ops.signalsAhead(state.sFront, 1)[0];
  const brakeEff = state.emergency ? 100 : Math.max(state.brake, state.kavachActive ? 60 : 0);
  drawDashboard(el, {
    kmh: state.speed * 3.6, vmax: RAKES[state.rakeType].vmax, limit,
    bp: state.emergency ? Math.max(0, 5 - state.brakeEff * 5) : 5 - state.brakeEff * 1.6, mr: 8.8 + Math.sin(performance.now() / 4000) * 0.5,
    amps: (state.notch / 8) * 1100 * (1 - Math.min(0.5, state.speed / 80)), traction: state.traction,
    notch: Math.max(0, state.notch), brake: brakeEff, emergency: state.emergency,
    kavach: state.kavach, kavachMsg: state.kavachActive, aspect: sig ? sig.aspect : 'UNKNOWN',
    sigLabel: sig ? (sig.kind === 'IBS' ? sig.label : `${sig.kind} ${sig.st.code}`) : '', sigDist: sig ? sig.s - state.sFront : null,
    target: ops.nextLimit(state.sFront, limit, 2500),
    delay: state.delay || 0, delayText: (state.delay || 0) > 1 ? `Late ${Math.round(state.delay)} min` : 'On time'
  });
}

// ---- timetable panel
function renderTimetable() {
  if (!timetable) return;
  const now = state.gameMinutes, halted = !!state.haltedAt && state.speed < 0.3;
  const rows = timetable.rows.map((r) => {
    const st = r.st, a = timetable.actual.get(st.index) || {};
    const passed = st.layout.pEnd + 20 < state.sFront;
    const eta = timetable.eta(r, now, state.sFront, halted);
    let status = '';
    if (st.isOrigin) status = a.dep !== undefined || ops.departedOrigin ? 'Departed' : 'Ready';
    else if (passed) status = a.arr !== undefined ? `Arr ${fmtClock(a.arr)}${a.arr - r.arr > 1 ? ` (+${Math.round(a.arr - r.arr)})` : ''}` : a.pass !== undefined ? `Passed ${fmtClock(a.pass)}` : 'Passed';
    else if (eta != null) status = `Exp ${fmtClock(eta)}`;
    const halt = st.isOrigin || st.isDest ? '' : st.halt ? `${st.dwellMin}m` : 'pass';
    return `<tr class="${passed ? 'done' : ''}"><td><b>${st.code}</b> ${st.name}</td><td>${r.arr == null ? '—' : fmtClock(r.arr)}</td><td>${r.dep == null ? '—' : st.halt || st.isOrigin ? fmtClock(r.dep) : '—'}</td><td>${halt}</td><td>${status}</td></tr>`;
  }).join('');
  $('tt-body').innerHTML = rows;
  const d = state.delay || 0;
  $('tt-sub').textContent = `${ops.trainNo} · ${d > 1 ? `running ${Math.round(d)} min late` : 'running on time'} · clock ${fmtClock(now)}`;
}

function showSummary() {
  if (state.summaryShown) return;
  state.summaryShown = true;
  const st = layout.stations[layout.stations.length - 1];
  const a = timetable.actual.get(st.index) || {};
  const late = a.arr !== undefined ? minDiff(a.arr, timetable.rows[st.index].arr) : 0;
  // every leg of the journey (a reversal starts a new leg at the same station: join its arrival and departure)
  const halts = [];
  for (const [k, seg] of [...(state.prevLegs || []), { rows: timetable.rows, actual: timetable.actual }].entries()) {
    for (const r of seg.rows) {
      const x = seg.actual.get(r.st.index) || {};
      const e = { st: r.st, arr: r.arr, dep: r.dep, aArr: x.arr, aDep: x.dep, first: k === 0 && r.st.isOrigin, last: r.st.isDest };
      if (k > 0 && r.st.isOrigin && halts.length) { Object.assign(halts[halts.length - 1], { dep: r.dep, aDep: x.dep, last: false }); continue; }
      if (r.st.isDest && k < (state.prevLegs || []).length) e.last = false;
      if (e.first || e.last || x.arr !== undefined || r.st.halt || r.st.reversal) halts.push(e);
    }
  }
  const arrOk = halts.filter((h) => !h.first && h.aArr !== undefined && minDiff(h.aArr, h.arr) <= 3).length;
  const arrN = halts.filter((h) => !h.first && h.aArr !== undefined).length;
  $('sum-stats').innerHTML = `
    <div><span class="muted">Score</span><b>${scorer.total()}</b></div>
    <div><span class="muted">Grade</span><b>${scorer.grade()}</b></div>
    <div><span class="muted">Arrival</span><b>${late > 1 ? `${Math.round(late)} min late` : 'On time'}</b></div>
    <div><span class="muted">Passenger comfort</span><b>${Math.round(scorer.comfort)}%</b></div>
    <div><span class="muted">SPADs</span><b>${ops.spads}</b></div>
    <div><span class="muted">Whistle boards</span><b>${scorer.whistleOk} ok / ${scorer.whistleMissed} missed</b></div>
    <div><span class="muted">Punctual halts (≤ 3 min)</span><b>${arrOk} / ${arrN}</b></div>
    <div><span class="muted">Overspeed events</span><b>${scorer.overspeeds}</b></div>
    <div><span class="muted">Delay caused to other trains</span><b>${control.history.length ? `${Math.round(control.knockOnTotal)} min (${control.history.length} unscheduled stop${control.history.length > 1 ? 's' : ''})` : 'none'}</b></div>
    <div><span class="muted">Incidents handled</span><b>${incidents.history.length ? `${incidents.history.filter((h) => h.ok).length} / ${incidents.history.length}` : 'none'}</b></div>`;
  // per-halt punctuality report
  const diff = (act, sch, isDep) => {
    if (act === undefined || sch == null) return '<td>—</td><td></td>';
    const d = minDiff(act, sch);
    const cls = d > 3 ? 'late' : d < -0.5 && isDep ? 'early' : 'ok'; // arriving early is slack; leaving early is not
    return `<td>${fmtClock(act)}</td><td class="${cls}">${Math.abs(d) < 0.5 ? '0' : `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d))}`}</td>`;
  };
  $('sum-tt').innerHTML = `<table><thead><tr><th>Station</th><th>Sch arr</th><th>Act arr</th><th>±</th><th>Sch dep</th><th>Act dep</th><th>±</th></tr></thead><tbody>${halts.map((h) => `<tr><td><b>${h.st.code}</b> ${h.st.name}${h.st.reversal || (h.dep != null && h.arr != null && !h.first && !h.last && (state.prevLegs || []).some((l) => l.rows.at(-1).st.code === h.st.code)) ? ' <span class="muted">(reversal)</span>' : ''}</td><td>${h.arr == null ? '—' : fmtClock(h.arr)}</td>${h.first ? '<td>—</td><td></td>' : diff(h.aArr, h.arr)}<td>${h.last || h.dep == null ? '—' : fmtClock(h.dep)}</td>${h.last ? '<td>—</td><td></td>' : diff(h.aDep, h.dep, true)}</tr>`).join('')}</tbody></table>${incidents.history.length ? `<div class="muted" style="margin-top:6px;">Incidents: ${incidents.history.map((h) => `${h.ok ? '✓' : '✗'} ${h.title}`).join(' · ')}</div>` : ''}`;
  $('sum-events').innerHTML = scorer.events.slice(-20).reverse().map((e) => `<div>${e.pts > 0 ? '+' : ''}${e.pts} · ${e.why}</div>`).join('');
  const comfort = scorer.comfort, punct = Math.max(0, 100 - Math.max(0, late - 1) * 6);
  const stars = Math.max(1, Math.min(5, Math.round(((comfort * 0.5 + punct * 0.5) / 100) * 5 - ops.spads)));
  if (state.nightMail) {
    const sleep = Math.max(1, 5 - (comfort < 95 ? 1 : 0) - (comfort < 85 ? 1 : 0) - Math.min(2, Math.floor((state.nightHorns || 0) / 3)) - (late > 5 ? 1 : 0) - ops.spads);
    $('sum-stats').insertAdjacentHTML('afterbegin', `<div><span class="muted">🌙 Sleeping passengers</span><b style="color:#a5b4fc;">${'★'.repeat(sleep)}${'☆'.repeat(5 - sleep)}</b></div>`);
  }
  $('sum-stats').insertAdjacentHTML('afterbegin', `<div><span class="muted">Passenger rating</span><b style="color:#facc15;">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</b></div>`);
  const cr = finishCareerRun({ completed: true, late });
  if (state.daily) { account.recordGame({ mode: 'daily', venue: state.daily.key, score: scorer.total(), trains: 1, avgDelay: late }); achievements({ kind: 'daily' }); state.daily = null; }
  achievements({ kind: 'run', completed: true, km: careerRun?.km || 0, spads: ops.spads, comfort, stars, suburban: !!RAKES[state.rakeType].suburban });
  if (cr) $('sum-stats').insertAdjacentHTML('beforeend', `<div><span class="muted">Career XP</span><b>${cr.xp >= 0 ? '+' : ''}${cr.xp}${account.guest ? ' (guest — not saved)' : ''}</b></div>${cr.promoted ? `<div><span class="muted">PROMOTED</span><b>${cr.promoted.title}</b></div>` : ''}`);
  $('summary').style.display = 'flex';
  drawRecorder($('sum-chart'), scorer.trace, { title: `Speed recorder · ${layout.stations[0].code} → ${st.code}` });
}

$('btn-engine').onclick = () => startEngineChange();
$('btn-runround').onclick = () => startRunRound();
$('shunt-panel').onclick = (e) => {
  const b = e.target.closest('[data-shunt]'); const ec = state.engineChange;
  if (!b || ec?.kind !== 'shunt') return;
  if (b.dataset.shunt === 'rev') toggleReverser();
  if (b.dataset.shunt === 'cancel') { ec.rr.cancel(); state.engineChange = null; $('shunt-panel').style.display = 'none'; startEngineChange(); }
};
function toggleReverser() {
  const rr = state.engineChange?.kind === 'shunt' ? state.engineChange.rr : null;
  if (!rr) return;
  if (Math.abs(rr.v) > 0.1) { toast('Stop the loco before moving the reverser', 'warn', 2000); return; }
  rr.reverser = rr.reverser === 'F' ? 'R' : 'F';
  toast(`Reverser ${rr.reverser === 'F' ? 'FORWARD' : 'REVERSE'}`, 'ok', 1500);
}
$('engine-select').innerHTML = Object.entries(LOCOS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('btn-timetable').onclick = () => { const m = $('tt-panel'); renderTimetable(); m.style.display = m.style.display === 'block' ? 'none' : 'block'; };
$('btn-recorder').onclick = () => { const m = $('rec-panel'); m.style.display = m.style.display === 'flex' ? 'none' : 'flex'; drawRecorder($('rec-chart'), scorer.trace); };
$('rec-close').onclick = () => { $('rec-panel').style.display = 'none'; };
$('sum-close').onclick = () => { $('summary').style.display = 'none'; };
$('sum-restart').onclick = () => { $('summary').style.display = 'none'; startRoute({ ...state.journey }); };

// ======================================================================
// Account (login / guest) & career
// ======================================================================
const account = new Account();
let careerRun = null;

function trackCareerKm(odoKm) {
  if (!careerRun || careerRun.done || state.incident) return;
  const d = odoKm - careerRun.lastKm;
  careerRun.lastKm = odoKm;
  if (d > 0 && d < 2) { careerRun.km += d; account.addKm(d); } // ignore jumps (route restarts / teleports)
}

function finishCareerRun({ completed, late = 0, incident = null }) {
  if (!careerRun || careerRun.done) return null;
  if (!completed && !incident && careerRun.km < 0.5) { careerRun.done = true; return null; } // never really started
  careerRun.done = true;
  const r = account.finishRun({ route: careerRun.route, rake: careerRun.rake, km: careerRun.km, score: scorer ? scorer.total() : 0, late, spads: ops ? ops.spads : 0, completed, incident });
  if (r.promoted) toast(`Promoted: ${r.promoted.title}!`, 'ok', 6000);
  if (completed && scorer) account.recordGame({ mode: 'drive', venue: careerRun.route, score: scorer.total(), trains: 1, avgDelay: late });
  renderCareer();
  return r;
}

function renderUserChip() {
  $('user-chip').textContent = account.guest ? `Hi ${account.displayName} · Log in` : `Hi ${account.email} · Sign out`;
  $('user-chip').title = account.guest ? 'Log in or sign up to save your career' : 'Log out';
}

function renderCareer() {
  if ($('career-modal').style.display !== 'flex') return;
  const got = account.career.ach || {};
  $('ach-list').innerHTML = ACHIEVEMENTS.map((a) => `<div class="${got[a.id] ? 'got' : ''}" title="${a.desc}">${a.icon} <b>${a.title}</b><br><span class="muted">${a.desc}</span></div>`).join('');
  const c = account.career, r = rankOf(c.xp);
  $('car-who').textContent = account.guest ? 'Playing as guest — progress is not saved. Log in to keep your career.' : `Saved to ${account.email}`;
  $('car-rank').textContent = r.title;
  $('car-duty').textContent = `· ${r.duty}`;
  $('car-bar').style.width = `${Math.round(r.progress * 100)}%`;
  $('car-next').textContent = r.next ? `${Math.floor(c.xp)} XP · ${Math.ceil(r.next.xp - c.xp)} XP to ${r.next.title}` : `${Math.floor(c.xp)} XP · top rank`;
  const cell = (k, v) => `<div><span class="muted">${k}</span><b>${v}</b></div>`;
  $('car-grid').innerHTML = cell('Distance', `${c.km.toFixed(1)} km`) + cell('Runs', `${c.completed}/${c.runs} done`) + cell('On time', c.onTime)
    + cell('Best score', c.bestScore) + cell('SPADs', c.spads) + cell('Incidents', c.incidents);
  $('car-hist').innerHTML = c.history.length ? c.history.map((h) => `<tr><td>${new Date(h.at).toLocaleDateString()}<br><span class="muted">${h.route}</span></td><td>${(RAKES[h.rake]?.label || h.rake).replace(/ \(.*\)/, '')}</td><td>${h.km}</td><td>${h.incident ? h.incident : h.completed ? (h.late > 2 ? `${h.late} min late` : 'On time') : 'Abandoned'}</td><td>${h.xp >= 0 ? '+' : ''}${h.xp}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No runs yet — finish a journey to log it.</td></tr>';
}

// ---- login screen
let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  $('auth-tab-login').classList.toggle('on', m === 'login');
  $('auth-tab-signup').classList.toggle('on', m === 'signup');
  $('auth-go').textContent = m === 'login' ? 'Log in' : 'Create account';
  $('auth-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('auth-err').textContent = '';
}
function showAuth(msg = '') { $('auth').style.display = 'flex'; $('auth-err').textContent = msg; setTimeout(() => $('auth-email').focus(), 50); }
function hideAuth() { $('auth').style.display = 'none'; }
$('auth-tab-login').onclick = () => setAuthMode('login');
$('auth-tab-signup').onclick = () => setAuthMode('signup');
$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('auth-email').value, pass = $('auth-pass').value;
  if (!Account.validEmail(email)) { $('auth-err').textContent = 'Please enter a valid email address'; return; }
  if (!pass) { $('auth-err').textContent = 'Password is required'; return; }
  $('auth-go').disabled = true;
  try {
    await (authMode === 'login' ? account.login(email, pass) : account.signup(email, pass));
    $('auth-pass').value = '';
    hideAuth();
    toast(authMode === 'login' ? `Welcome back — ${rankOf(account.career.xp).title}` : 'Account created — your career is saved from now on', 'ok', 3500);
  } catch (err) { $('auth-err').textContent = err.message; }
  finally { $('auth-go').disabled = false; }
};
$('auth-guest').onclick = () => { if (!account.guest) return hideAuth(); account.continueAsGuest(); hideAuth(); };
$('user-chip').onclick = async () => {
  if (account.guest) { setAuthMode('login'); showAuth(); return; }
  await account.logout();
  toast('Logged out — driving as guest', 'ok', 2500);
};
$('btn-career').onclick = () => { $('career-modal').style.display = 'flex'; renderCareer(); };
$('car-close').onclick = () => { $('career-modal').style.display = 'none'; };
account.onChange = () => { renderUserChip(); renderCareer(); };
renderUserChip();
setInterval(() => account.save(), 60000);
addEventListener('pagehide', () => account.save(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') account.save(true); });

// resume a saved login, else ask (the sim keeps loading behind the screen)
const authReady = account.resume().then((ok) => { if (!ok) showAuth(); })
  .catch((e) => showAuth(e.offline ? 'Server is offline — log in later, or continue as guest' : e.message));
if (params.get('guest') === '1') { account.continueAsGuest(); authReady.then(hideAuth); }

// ======================================================================
// Boot
// ======================================================================
loader.set('Loading stations…', 8);
await Promise.all([loadHubs(), preloadPassengerGlb(), loadStationManifest()]);
// announcer voice: remembered choice, else Google Cloud when the backend says TTS is ready
{
  let mode = localStorageGet('railsim.voice');
  if (!mode && state.backendOnline) {
    try { const st = await fetchJson(`${API_BASE}/tts/status`, {}, 3000); mode = st.ready ? 'cloud' : 'browser'; } catch { mode = 'browser'; }
  }
  setVoice(mode || 'browser');
}
$('sel-src').value = 'GTL';
$('sel-dst').value = 'SC';
const bootPreset = PRESETS[params.get('route')] || PRESETS['gtl-sc'];
await startRoute({ ...bootPreset, minutes: bootPreset.minutes ?? state.gameMinutes });
showHome();
window.__railsim = { state, account, sm: stationMaster, get smw() { return smScene; }, start: startRoute, get layout() { return layout; }, get ops() { return ops; }, get world() { return world; }, get traffic() { return traffic; }, get scorer() { return scorer; }, get incidents() { return incidents; }, get timetable() { return timetable; }, get consist() { return consist; }, rig, camera, renderer };
