import * as THREE from 'three/webgpu';
import { loadStationManifest } from './world/stationModels.js';
import { animateCrew, animateWipers } from './trains/cabInterior.js';
import { pass } from 'three/tsl';
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
import { Timetable, fmtClock } from './timetable.js';
import { Scorer } from './score.js';
import { drawDashboard, drawRecorder } from './ui/dashboard.js';
import { StationAudio } from './audio/stationAudio.js';
import { spokenName } from './route/stationScripts.js';
import { AudioEngine } from './audio/audioEngine.js';
import { CameraRig, CAMERA_MODES } from './ui/cameraRig.js';
import { Operations, Traffic, LOOP_LIMIT } from './ops.js';
import { preloadPassengerGlb } from './world/people.js';
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
let qualityKey = params.get('q') || localStorageGet('railsim.quality') || 'high';
let Q = QUALITY[qualityKey] || QUALITY.high;

const renderer = new THREE.WebGPURenderer({ antialias: !Q.post, powerPreference: 'high-performance', forceWebGL: params.has('webgl') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.65;
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
    pipeline.outputNode = color.add(bloomNode);
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
  auto: false, simRate: 1, kavach: true, incident: null, busyStations: true,
  weather: 'CLEAR', gameMinutes: 7 * 60 + 15, lights: 'auto', wipers: 'auto', derailments: false, scale: Number(localStorageGet('railsim.scale') || 1),
  backendOnline: false
};
let layout = null, world = null, consist = null, ops = null, traffic = null, timetable = null, scorer = null;
const stationAudio = new StationAudio(audio);
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
  const opts = state.hubs.slice().sort((a, b) => a.code.localeCompare(b.code))
    .map((h) => `<option value="${h.code}">${h.name} (${h.code} · ${h.platforms} PF)</option>`).join('');
  $('sel-src').innerHTML = opts;
  $('sel-dst').innerHTML = opts;
  const via = $('sel-via');
  for (const h of state.hubs) via.insertAdjacentHTML('beforeend', `<option value="${h.code}">${h.code} — ${h.name}</option>`);
  await refreshRosters();
}

async function refreshRosters() {
  const sel = $('sel-roster');
  sel.innerHTML = '<option value="">— Load from PostgreSQL —</option>';
  try {
    state.rosters = await fetchJson(`${API_BASE}/rosters`);
    state.rosters.forEach((r, i) => sel.insertAdjacentHTML('beforeend', `<option value="${i}">${r.trainNumber} ${r.trainName} (${r.sourceCode}→${r.destCode})</option>`));
  } catch { state.rosters = []; }
}

async function solveRoute(src, dst, via, allStops) {
  if (state.backendOnline) {
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
async function startRoute({ src, dst, via = [], rakeType = 'LHB', allStops = false, minutes = null, stops = null }) {
  if (busy) return;
  busy = true;
  loader.show();
  loader.set(`Solving ${src} → ${dst}…`, 10);
  await nextFrame();
  let plan;
  try {
    plan = await solveRoute(src, dst, via, allStops || rakeType === 'DEMU_PASSENGER');
  } catch (e) {
    loader.hide();
    toast(`Route error: ${e.message}`, 'warn', 5000);
    busy = false;
    return;
  }
  Object.assign(state, { src, dst, via, rakeType, allStops, stops, plan, speed: 0, notch: 0, brake: 0, emergency: false });
  if (minutes !== null) state.gameMinutes = minutes;

  loader.set('Laying track, stations & terrain…', 25);
  await nextFrame();
  if (world) world.dispose();
  if (consist) consist.dispose();
  if (traffic) traffic.dispose();
  const seedKey = plan.route.legs.map((l) => l.edgeId).join('>') + '|' + src + dst;
  if (layout) finishCareerRun({ completed: false }); // leaving a run part-way
  const tm = [performance.now()];
  layout = buildRouteLayout(plan, { hubs: state.hubs, seedKey, scale: state.scale });
  if (stops) { // preset halt list: stop only at these stations (origin/destination always)
    for (const st of layout.stations) if (!st.isOrigin && !st.isDest && !st.reversal) st.halt = stops.includes(st.code);
  }
  ops = new Operations(layout, plan, rakeType, seedKey);
  tm.push(performance.now());
  world = new World(scene, layout, { seedKey, density: Q.density });
  ops.pointsMoving = (st) => world.pointsMovingAt(st);
  tm.push(performance.now());
  consist = new Consist(rakeType, { isPlayer: true });
  tm.push(performance.now());
  scene.add(consist.group);
  traffic = new Traffic(scene, layout, ops, (rake, cars) => new Consist(rake, { cars }), audio);
  world.setBlockSignals(ops.ibs);
  timetable = new Timetable(layout, ops, rakeType, state.gameMinutes);
  ops.busyEnabled = state.busyStations;
  stationAudio.reset();
  traffic.onStationEvent = (type, t) => stationAudio.trainEvent(type, t, state.gameMinutes);
  traffic.onReroute = (st, prev, now, tr) => { pfShownFor = null; toast(`${st.name}: ${tr.name} is being received on ${prev} — control has rerouted us to ${now.name}`, 'warn', 6000); };
  traffic.onPlatformTaken = (st, track, tr) => { pfShownFor = null; toast(`${st.name}: ${tr.name} is arriving on ${track.name}`, 'ok', 3000); };
  traffic.onPrecedence = (st, loop, tr) => { pfShownFor = null; toast(`Control: ${tr.name} is behind us — we will be looped at ${st.name} (${loop.name}) to let it pass.`, 'warn', 6500); };
  scorer = new Scorer();
  state.engineChange = null; state.haltedAt = null; state.passed = new Set(); state.summaryShown = false;
  state.traction = consist.loco ? LOCOS[consist.loco].traction : RAKES[rakeType].traction;
  state.incident = null;
  ops.spads = 0;
  careerRun = { route: `${src} → ${dst}`, rake: rakeType, km: 0, lastKm: 0, done: false };
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
  loader.set('Ready', 100);
  loader.hide();
  busy = false;
  const t = ops.trackOf(origin);
  toast(`${rakeLabel()} at ${origin.name} ${t.name}. Starter clears in a few seconds — W to notch up, A for auto. Edit halts under “Stops”.`, 'ok', 5500);
}

function rakeLabel() { return RAKES[state.rakeType].label; }

function updateRouteHeader() {
  const r = state.plan.route;
  const a = layout.stations[0], b = layout.stations[layout.stations.length - 1];
  $('route-title').textContent = `${ops.trainNo} ${a.name} → ${b.name}`;
  let meta = `${r.totalRealKm} km · ${layout.stations.length} stations · ${rakeLabel()}`;
  if (layout.gtl) meta += ` · Dhone diversion · VV Nagar ${world.gtl.vvSide}`;
  $('route-meta').textContent = meta;
  $('backend-badge').textContent = `${isWebGPU ? 'WebGPU' : 'WebGL2'} · ${state.backendOnline ? 'API live' : 'offline graph'}`;
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
function updatePlatformPanel() {
  const st = ops.selectorStation(state.sFront, state.speed);
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
    const status = occ ? (occ.kind === 'reserved' ? `Reserved: crossing ${occ.name}` : `Occupied: ${occ.name}`) : (chosen === t.no ? 'Route set ✓' : `Free · ${kind}${t.isThrough ? '' : ` · ${LOOP_LIMIT} km/h`}`);
    div.innerHTML = `<b>${t.name}</b><small>${status}</small>`;
    if (!occ) div.onclick = () => {
      const r = ops.choose(st, t.no);
      if (r === 'forced') { toast(`Precedence: control has set ${ops.trackOf(st).name} so ${st.precedence.train.name} can overtake`, 'warn', 3000); return; }
      if (r === 'ok') toast(`Points throwing — route set: ${st.name} ${t.name}${st.halt && !t.pf ? ' (no platform here!)' : ''}`, st.halt && !t.pf ? 'warn' : 'ok', 2400);
      else if (r === 'locked') toast('Route locked — train has passed the home signal', 'warn');
      pfShownFor = null;
    };
    list.appendChild(div);
  }
  $('pf-lock').textContent = locked ? 'Route locked (home signal passed).' : 'Pick any FREE line before the home signal.';
}

// ======================================================================
// Input
// ======================================================================
function notch(d) { state.notch = Math.max(0, Math.min(8, state.notch + d)); if (d > 0) { state.brake = 0; state.emergency = false; } state.auto = false; syncAuto(); }
function brake(d) { state.brake = Math.max(0, Math.min(100, state.brake + d)); if (d > 0) state.notch = 0; state.auto = false; syncAuto(); }
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
$('btn-kavach').onclick = (e) => { state.kavach = !state.kavach; e.target.classList.toggle('on', state.kavach); toast(state.kavach ? 'Kavach ATP ON — automatic braking for red signals & overspeed' : 'Kavach ATP OFF — you are responsible for signals; SPADs can cause collisions', state.kavach ? 'ok' : 'warn', 3500); };
$('btn-resume').onclick = () => resumeFromLastStation();
$('btn-restart').onclick = () => { $('incident').style.display = 'none'; startRoute({ src: state.src, dst: state.dst, via: state.via, rakeType: state.rakeType, allStops: state.allStops }); };
$('btn-builder').onclick = () => { const m = $('route-modal'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; };
$('btn-reverse').onclick = () => startRoute({ src: state.dst, dst: state.src, via: state.via.slice().reverse(), rakeType: state.rakeType, allStops: state.allStops });
$('sel-weather').onchange = (e) => { state.weather = e.target.value; };
$('sel-time').onchange = (e) => {
  if (e.target.value) {
    const d = Number(e.target.value) - state.gameMinutes;
    state.gameMinutes = Number(e.target.value);
    if (timetable) timetable.shift(d); // a time jump moves the whole timetable with it
  }
  e.target.value = '';
};
$('sel-rate').onchange = (e) => { state.simRate = Number(e.target.value); };
$('sel-scale').value = String(state.scale);
$('sel-scale').onchange = (e) => {
  state.scale = Number(e.target.value); localStorageSet('railsim.scale', String(state.scale));
  toast(state.scale === 1 ? 'Exact distances — restarting the route' : 'Compact 1:10 distances — restarting the route', 'ok', 2500);
  startRoute({ src: state.src, dst: state.dst, via: state.via, rakeType: state.rakeType, allStops: state.allStops, stops: state.stops });
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
  if (next === 'cloud' && !state.backendOnline) toast('Cloud voice needs the backend (API live) — using the browser voice until it is reachable', 'warn', 3500);
  setVoice(next);
  toast(next === 'cloud' ? 'Announcer: Google Cloud natural voice (station PA, distant)' : 'Announcer: browser voice (distant)', 'ok', 2200);
};
stationAudio.onCloudFail = (msg) => toast(`Cloud voice unavailable (${msg}) — using the browser voice for now`, 'warn', 3500);
$('btn-announce').onclick = (e) => { audio.announcements = !audio.announcements; e.target.classList.toggle('on', audio.announcements); };
const camSel = $('sel-cam');
camSel.innerHTML = CAMERA_MODES.map((m, i) => `<option value="${i}">${m.label}</option>`).join('');
camSel.value = String(rig.mode);
camSel.onchange = (e) => rig.setMode(Number(e.target.value));

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
  'wadi-csmt': { src: 'WADI', dst: 'CSMT', via: [], rakeType: 'LHB' }
};
document.querySelectorAll('[data-preset]').forEach((b) => {
  b.onclick = () => {
    const p = PRESETS[b.dataset.preset];
    $('sel-src').value = p.src; $('sel-dst').value = p.dst; $('sel-rake').value = p.rakeType;
    $('route-modal').style.display = 'none';
    startRoute({ ...p, minutes: p.minutes ?? null });
  };
});
$('btn-solve').onclick = () => {
  const via = $('sel-via').value ? $('sel-via').value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  $('route-modal').style.display = 'none';
  startRoute({ src: $('sel-src').value, dst: $('sel-dst').value, via, rakeType: $('sel-rake').value, allStops: $('sel-rake').value === 'DEMU_PASSENGER' });
};
$('sel-roster').onchange = (e) => {
  const r = state.rosters[Number(e.target.value)];
  if (!r) return;
  const via = r.viaCodesCsv ? r.viaCodesCsv.split(',').map((s) => s.trim()).filter(Boolean) : [];
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
    toast('Roster saved to PostgreSQL', 'ok');
  } catch {
    toast(`Could not reach the API at ${API_BASE}`, 'warn');
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
    case 'KeyH': audio.hornStart(); break;
    case 'KeyA': $('btn-auto').click(); break;
    case 'KeyC': rig.setMode(rig.mode + 1); camSel.value = String(rig.mode); break;
    default:
      if (e.code === 'KeyL') toggleLights();
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
let hudTimer = 0, lastSignalAspect = null, prevFront = 0, overspeedTimer = 0;

function physics(dt) {
  const R = RAKES[state.rakeType];
  const v = state.speed;
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
    const need = Number.isFinite(stopDist) ? (v * v) / (2 * Math.max(0.5, stopDist - 2)) : 0;
    if (need > 0.3) { state.notch = 0; state.brake = Math.min(100, Math.round((need / 1.1) * 125)); }
    else if (err > 1.5) { state.notch = Math.min(8, Math.max(state.notch, 1) + (err > 6 ? 1 : 0)); state.brake = 0; }
    else if (err > 0.3) { state.brake = 0; }
    else if (err < -0.4) { state.notch = 0; state.brake = Math.min(100, Math.max(20, (-err) * 45)); }
    else { state.notch = Math.max(0, state.notch - 1); }
    if (target < 0.2 && v < 0.6) { state.notch = 0; state.brake = 60; }
  }
  // Kavach (Automatic Train Protection): brakes for red signals and overspeed
  let brakePct = state.brake;
  state.kavachActive = null;
  if (state.kavach && !state.auto) {
    const k = ops.kavach(state.sFront, v, consist.length);
    if (k.demand > 0) {
      state.kavachActive = k.reason;
      brakePct = Math.max(brakePct, k.demand);
      state.notch = 0;
      if (!state._kavachToast) { toast(`KAVACH intervened: ${k.reason} — brakes applied`, 'warn', 3000); state._kavachToast = true; }
    } else state._kavachToast = false;
  }
  const vmax = R.vmax / 3.6;
  const tract = (state.notch / 8) * R.accel * Math.min(1, Math.pow(9 / Math.max(v, 0.1), 0.55)) * Math.max(0, 1 - Math.pow(v / (vmax * 1.04), 6));
  const resist = v > 0.01 ? 0.008 + 0.0000085 * v * v : 0;
  const grade = 9.81 * layout.path.gradeAt(state.sFront - consist.length / 2);
  const wet = state.weather === 'MONSOON' ? 0.75 : 1;
  const brk = state.emergency ? 1.45 * wet : (brakePct / 100) * 1.1 * wet;
  let a = tract - resist - grade - (v > 0.01 ? brk : 0);
  if (v <= 0.01 && a < 0) a = 0;
  state.speed = Math.max(0, Math.min(vmax * 1.05, v + a * dt));
  if (state.speed < 0.05 && state.emergency) state.emergency = false;
  prevFront = state.sFront;
  const end = layout.total - 32;
  state.sFront = Math.min(end, state.sFront + state.speed * dt);
  const kmh = state.speed * 3.6;

  // Signal passed at danger. Policy: Kavach brakes before the signal; if it is
  // off (or the driver overruns anyway) the train-stop trips the emergency brake
  // as the signal is passed, the SPAD is logged, and any conflicting train ahead
  // becomes a real collision risk.
  for (const sig of ops.signalsAhead(prevFront - 0.01, 3)) {
    if (sig.kind === 'Distant') continue;
    if (sig.aspect === 'RED' && prevFront < sig.s && state.sFront >= sig.s) {
      ops.spads++;
      scorer.onSpad();
      state.emergency = true; state.notch = 0; state.auto = false; syncAuto();
      toast(`SPAD #${ops.spads}: ${sig.kind}${sig.label ? ' ' + sig.label : ''} at ${sig.st ? sig.st.name : 'block section'} passed at danger — train-stop applied emergency brake`, 'warn', 6000);
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
    if (overspeedTimer > 1.2) { overspeedTimer = 0; audio.beep(); if (kmh > limit + 12) toast(`OVERSPEED ${Math.round(kmh)}/${Math.round(limit)} km/h — derailment risk on turnouts & curves`, 'warn', 1800); }
  } else overspeedTimer = 0;
  return limit;
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
      stationAudio.say(`May I have your attention, please. Train number ${ops.trainNo.split('').join(' ')}, ${spokenName(layout.stations[0].name)} to ${spokenName(layout.stations[layout.stations.length - 1].name)} Express, is arriving on ${where}.`);
      toast(`Arriving ${st.name} — ${t.name}`, 'ok');
    }
    if (ev.type === 'halted') {
      const late = timetable.recordArrival(st, state.gameMinutes);
      scorer.onHalt(st, state.sFront - ops.stopPoint(st), late);
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
    if (ev.type === 'ready') { toast(`${st.name}: right away! Starter signal cleared.`, 'ok'); audio.hornBlip(0.5); }
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
  $('next-limit').textContent = nl ? `next ${Math.round(nl.limit)} in ${Math.round(nl.dist)} m` : '';
  $('kavach-state').textContent = !state.kavach ? 'OFF' : state.kavachActive ? `BRAKING (${state.kavachActive})` : 'ON';
  $('kavach-state').style.color = !state.kavach ? '#fca5a5' : state.kavachActive ? '#fbbf24' : '#86efac';
  $('spads').textContent = String(ops.spads);
  const vmax = RAKES[state.rakeType].vmax;
  $('speedfill').style.width = `${Math.min(100, (kmh / vmax) * 100)}%`;
  $('speedlim').style.left = `${Math.min(100, (limit / vmax) * 100)}%`;
  $('notch').textContent = `N${state.notch}`;
  $('brake').textContent = state.emergency ? 'EMERGENCY' : `${state.brake}%`;
  const odoKm = Math.max(0, layout.realKmAt(state.sFront) - layout.realKmAt(layout.stations[0].layout.pEnd - 14));
  $('odo').textContent = `${odoKm.toFixed(1)} km`;
  trackCareerKm(odoKm);
  const st = ops.currentStation(state.sFront);
  const line = layout.lineAt(state.sFront);
  let section = st ? `${st.name} yard` : (line === 'D' ? 'Double line' : 'Single line');
  if (layout.gtl && state.sFront > layout.gtl.s0 && state.sFront < layout.gtl.s1) section = `Dhone diversion · VV Nagar ${world.gtl.vvSide}`;
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
  if (sig && sig.s - state.sFront > sighting) {
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
    $('sig-aspect').textContent = a.replace('_', ' ');
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
    $('next-st').textContent = halted
      ? `Halted at ${nst.name} · departs in ${fmtMin(ops.dwellLeft(nst))} (scheduled ${nst.dwellMin} min)`
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

  const limit = physics(dt);
  const events = ops.update(dt, { sFront: state.sFront, speed: state.speed, trainLen: consist.length, gameDt });
  handleEvents(events);
  consist.place(layout.path, ops.lane, state.sFront, 1);
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
  rig.update(rawDt, {
    lead, mid: consist.vehicles[midIdx], window: consist.vehicles[Math.min(3, consist.vehicles.length - 1)], tail: consist.vehicles[consist.vehicles.length - 1],
    heading: Math.atan2(Math.sin(-lead.group.rotation.y), Math.cos(-lead.group.rotation.y)),
    sFront: state.sFront, path: layout.path, lane: ops.lane
  });

  if (state.lurch > 0) { // camera shake for a violent lurch over points
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.35).multiplyScalar(state.lurch));
    state.lurch = Math.max(0, state.lurch - rawDt * 1.2);
  }
  if (state.incident && state.incident.t < 0.7) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5).multiplyScalar(1 - state.incident.t / 0.7));
  audio.update(rawDt, {
    speedKmph: state.speed * 3.6, notch: state.notch, brake: state.emergency ? 100 : state.brake,
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
  if (hudTimer > 0.1) { hudTimer = 0; updateHud(limit); updatePlatformPanel(); updateEnginePanel(); updateDashboard(limit); }
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
  if (state.haltedAt && state.speed > 0.5) { timetable.recordDeparture(state.haltedAt, state.gameMinutes); state.haltedAt = null; }
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
  const show = st && state.speed < 0.3 && !state.engineChange && !st.isDest && (st.reversal || st.category !== 'station') && !(st.engineChanged && !st.reversal);
  const panel = $('engine-panel');
  panel.style.display = show ? 'block' : 'none';
  if (!show) return;
  const mu = isMultipleUnit(state.rakeType);
  $('engine-title').textContent = st.reversal ? `Reversal at ${st.name}` : `Loco change at ${st.name} (optional)`;
  $('engine-sub').textContent = mu ? 'Multiple unit: the loco pilot walks to the other driving cab.' : `Current engine: ${LOCOS[consist.loco || defaultLoco(state.rakeType)].label}`;
  $('engine-select').style.display = mu ? 'none' : '';
  $('btn-engine').textContent = mu ? 'Change ends' : 'Detach & attach engine';
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
  ec.st.engineChanged = true;
  state.engineChange = null;
  toast(ec.kind === 'cab' ? 'Driving cab changed — brake continuity test OK' : `${LOCOS[consist.loco].label} coupled — brake continuity test OK`, 'ok', 3500);
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
    bp: state.emergency ? 0 : 5 - brakeEff * 0.016, mr: 8.8 + Math.sin(performance.now() / 4000) * 0.5,
    amps: (state.notch / 8) * 1100 * (1 - Math.min(0.5, state.speed / 80)), traction: state.traction,
    notch: state.notch, brake: brakeEff, emergency: state.emergency,
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
  const late = a.arr !== undefined ? a.arr - timetable.rows[st.index].arr : 0;
  $('sum-stats').innerHTML = `
    <div><span class="muted">Score</span><b>${scorer.total()}</b></div>
    <div><span class="muted">Grade</span><b>${scorer.grade()}</b></div>
    <div><span class="muted">Arrival</span><b>${late > 1 ? `${Math.round(late)} min late` : 'On time'}</b></div>
    <div><span class="muted">Passenger comfort</span><b>${Math.round(scorer.comfort)}%</b></div>
    <div><span class="muted">SPADs</span><b>${ops.spads}</b></div>
    <div><span class="muted">Whistle boards</span><b>${scorer.whistleOk} ok / ${scorer.whistleMissed} missed</b></div>`;
  $('sum-events').innerHTML = scorer.events.slice(-12).reverse().map((e) => `<div>${e.pts > 0 ? '+' : ''}${e.pts} · ${e.why}</div>`).join('');
  const cr = finishCareerRun({ completed: true, late });
  if (cr) $('sum-stats').insertAdjacentHTML('beforeend', `<div><span class="muted">Career XP</span><b>${cr.xp >= 0 ? '+' : ''}${cr.xp}${account.guest ? ' (guest — not saved)' : ''}</b></div>${cr.promoted ? `<div><span class="muted">PROMOTED</span><b>${cr.promoted.title}</b></div>` : ''}`);
  $('summary').style.display = 'flex';
  drawRecorder($('sum-chart'), scorer.trace, { title: `Speed recorder · ${layout.stations[0].code} → ${st.code}` });
}

$('btn-engine').onclick = () => startEngineChange();
$('engine-select').innerHTML = Object.entries(LOCOS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('btn-timetable').onclick = () => { const m = $('tt-panel'); renderTimetable(); m.style.display = m.style.display === 'block' ? 'none' : 'block'; };
$('btn-recorder').onclick = () => { const m = $('rec-panel'); m.style.display = m.style.display === 'flex' ? 'none' : 'flex'; drawRecorder($('rec-chart'), scorer.trace); };
$('rec-close').onclick = () => { $('rec-panel').style.display = 'none'; };
$('sum-close').onclick = () => { $('summary').style.display = 'none'; };
$('sum-restart').onclick = () => { $('summary').style.display = 'none'; startRoute({ src: state.src, dst: state.dst, via: state.via, rakeType: state.rakeType, allStops: state.allStops }); };

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
  renderCareer();
  return r;
}

function renderUserChip() {
  $('user-chip').textContent = account.guest ? 'Guest · Log in' : `${account.email} · Log out`;
  $('user-chip').title = account.guest ? 'Log in or sign up to save your career' : 'Log out';
}

function renderCareer() {
  if ($('career-modal').style.display !== 'flex') return;
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
loader.set('Loading hubs from PostgreSQL…', 8);
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
window.__railsim = { state, account, start: startRoute, get layout() { return layout; }, get ops() { return ops; }, get world() { return world; }, get traffic() { return traffic; }, rig, camera, renderer };
