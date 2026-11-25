import * as THREE from 'three/webgpu';
import { addCabInterior, addGuardCabin } from './cabInterior.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ASSETS_BASE, TRACK } from '../config.js';
import { buildCoach, buildLoco, buildBOXN, addTailLamp } from './rollingStock.js';
import { Batcher } from '../core/batcher.js';

const GAP = 0.9;
const COACH_CODES = {
  LHB: ['B1', 'B2', 'A1'],
  ICF: ['S1', 'S2', 'GS'],
  VB: ['C1', 'C2', 'E1'],
  DEMU: ['D1', 'D2', 'D3']
};

let gltfLoader = null;
export function setupGltf(renderer, ktx2Loader) {
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);
  if (ktx2Loader) gltfLoader.setKTX2Loader(ktx2Loader);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  return gltfLoader;
}
const glbCache = new Map();
export const loadModel = (name) => loadGlb(name);
function loadGlb(name) {
  if (!gltfLoader) return Promise.resolve(null);
  if (!glbCache.has(name)) {
    glbCache.set(name, new Promise((res) => gltfLoader.load(`${ASSETS_BASE}/models/${name}`, (g) => res(g), undefined, () => res(null))));
  }
  return glbCache.get(name);
}

function wrapReversed(v) {
  const outer = new THREE.Group();
  v.group.rotation.y = Math.PI;
  outer.add(v.group);
  return { ...v, group: outer, reversed: true };
}

function addCabFace(v, face = null) {
  const L = v.length;
  // a driving cab has no gangway connector at its front
  for (const o of v.group.children.filter((c) => c.userData.frontGangway)) o.removeFromParent();
  if (face) { // painted cab front (Mumbai local: yellow; MMTS: white with a blue frame)
    const fm = new THREE.MeshStandardMaterial({ color: face.color, roughness: 0.5 });
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.3, 0.08), fm); p.position.set(0, 2.55, -L / 2 - 0.03); v.group.add(p);
    if (face.frame) { const f = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.15, 0.06), new THREE.MeshStandardMaterial({ color: face.frame, roughness: 0.5 })); f.position.set(0, 3.0, -L / 2 - 0.06); v.group.add(f); }
  }
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1118, metalness: 0.9, roughness: 0.05 });
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), glass);
  ws.position.set(0, 3.0, -L / 2 - (face ? 0.1 : 0.01)); ws.rotation.y = Math.PI; v.group.add(ws);
  const head = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c8, emissiveIntensity: 4 });
  for (const x of [-0.9, 0.9]) {
    const hl = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), head);
    hl.position.set(x, 1.85, -L / 2 - (face ? 0.1 : 0.01)); hl.rotation.y = Math.PI; v.group.add(hl);
  }
  v.headPos = new THREE.Vector3(0, 2.4, -L / 2 - 0.2);
  v.cabEye = new THREE.Vector3(-0.6, 2.95, -L / 2 + 1.2);
}

export const LOCOS = {
  WAP7: { label: 'WAP-7 (electric, 25 kV)', traction: 'electric', build: () => buildLoco('WAP7', '30512', { cabBothEnds: true }) },
  WDP4D: { label: 'WDP-4D (diesel)', traction: 'diesel', build: () => buildLoco('WDP4D', '40125', { cabBothEnds: true }) },
  WAG12: { label: 'WAG-12B (electric, heavy freight)', traction: 'electric', build: () => buildLoco('WAG12', '70012', { cabBothEnds: true }) },
  WAG9: { label: 'WAG-9 ×2 (electric, multiple unit)', traction: 'electric', build: () => buildLoco('WAG9', '31248', { cabBothEnds: true }) }
};
export const isMultipleUnit = (rakeType) => /VANDE_BHARAT|DEMU_PASSENGER|MUMBAI_LOCAL|MMTS_LOCAL/.test(rakeType);
export const defaultLoco = (rakeType) => ({ ICF: 'WDP4D', BOXN_GOODS: 'WAG12' }[rakeType] || 'WAP7');

// A real express rake: general (GS) at both ends, sleepers (non-AC) and AC 3-tier / 2-tier / first AC in between.
function mixedCodes(n) {
  if (n <= 3) return ['GS', 'S1', 'B1'].slice(0, n);
  const inner = n - 2, ac = Math.max(1, Math.round(inner * 0.45)), sl = inner - ac;
  const codes = ['GS'];
  for (let i = 1; i <= sl; i++) codes.push(`S${i}`);
  const acList = [];
  for (let i = 1; acList.length < ac; i++) { acList.push(`B${i}`); if (acList.length < ac && i % 3 === 0) acList.push(`A${i / 3}`); }
  if (ac >= 5) acList[acList.length - 1] = 'H1';
  codes.push(...acList, 'GS');
  return codes;
}

export function makeVehicles(rakeType, cars, loco = null) {
  const list = [];
  switch (rakeType) {
    case 'VANDE_BHARAT':
    case 'VANDE_BHARAT_ORANGE': {
      const n = Math.max(4, cars ?? 8);
      const kind = rakeType === 'VANDE_BHARAT_ORANGE' ? 'VBO' : 'VB';
      for (let i = 0; i < n; i++) {
        const ends = i === 0 || i === n - 1;
        let v = buildCoach(kind, COACH_CODES.VB[i % 3], { noseFront: ends });
        if (i === n - 1) v = wrapReversed(v);
        list.push(v);
      }
      break;
    }
    case 'ICF': {
      list.push(loco ? LOCOS[loco].build() : buildLoco('WDP4D', '40125', { cabBothEnds: true }));
      const n = cars ?? 10;
      const codes = mixedCodes(n);
      for (let i = 0; i < n; i++) list.push(buildCoach('ICF', codes[i]));
      break;
    }
    case 'ICF_CREAM':
    case 'JAN_SHATABDI': {
      list.push(loco ? LOCOS[loco].build() : buildLoco('WDP4D', '40211', { cabBothEnds: true }));
      const n = cars ?? 10;
      const kind = rakeType === 'ICF_CREAM' ? 'ICFC' : 'ICFG';
      const codes = rakeType === 'JAN_SHATABDI' ? Array.from({ length: n }, (_, i) => (i === 1 || i === 2 ? `C${i}` : `D${i + 1}`)) : mixedCodes(n);
      for (let i = 0; i < n; i++) list.push(buildCoach(kind, codes[i]));
      break;
    }
    case 'GARIB_RATH': { // all AC 3-tier, green and yellow
      list.push(loco ? LOCOS[loco].build() : buildLoco('WAP7', '30461', { cabBothEnds: true }));
      const n = cars ?? 12;
      for (let i = 0; i < n; i++) list.push(buildCoach('GR', `G${i + 1}`));
      break;
    }
    case 'DEMU_PASSENGER':
    case 'MUMBAI_LOCAL':
    case 'MMTS_LOCAL': {
      const n = Math.max(3, cars ?? (rakeType === 'MUMBAI_LOCAL' ? 12 : rakeType === 'MMTS_LOCAL' ? 9 : 6));
      const kind = rakeType === 'MUMBAI_LOCAL' ? 'EMU' : rakeType === 'MMTS_LOCAL' ? 'MMTS' : 'DEMU';
      for (let i = 0; i < n; i++) {
        let v = buildCoach(kind, COACH_CODES.DEMU[i % 3]);
        const face = kind === 'EMU' ? { color: 0xf2c418 } : kind === 'MMTS' ? { color: 0xf4f4f0, frame: 0x2c73b5 } : null;
        if (i === 0) addCabFace(v, face);
        if (i === n - 1) { addCabFace(v, face); v = wrapReversed(v); }
        list.push(v);
      }
      break;
    }
    case 'BOXN_GOODS': {
      if (loco === 'WAG9') { // two WAG-9s in multiple, coupled back to back
        list.push(buildLoco('WAG9', '31248', { cabBothEnds: false }));
        list.push(wrapReversed(buildLoco('WAG9', '31252', { cabBothEnds: false })));
      } else if (loco && loco !== 'WAG12') list.push(LOCOS[loco].build());
      else { list.push(buildLoco('WAG12', '70012', { cabBothEnds: false })); list.push(wrapReversed(buildLoco('WAG12', '70012', { cabBothEnds: false }))); }
      const n = cars ?? 26;
      for (let i = 0; i < n; i++) list.push(buildBOXN());
      break;
    }
    case 'RAJDHANI':
    case 'DURANTO': {
      list.push(loco ? LOCOS[loco].build() : buildLoco('WAP7', rakeType === 'RAJDHANI' ? '30245' : '30381', { cabBothEnds: true }));
      const n = cars ?? 12;
      const codes = rakeType === 'RAJDHANI' ? ['A1', 'B3', 'H1'] : ['B1', 'A2', 'S4'];
      for (let i = 0; i < n; i++) list.push(buildCoach(rakeType === 'RAJDHANI' ? 'RAJ' : 'DUR', codes[i % 3]));
      break;
    }
    case 'LHB':
    default: {
      list.push(loco ? LOCOS[loco].build() : buildLoco('WAP7', '30512', { cabBothEnds: true }));
      const n = cars ?? 10;
      const codes = mixedCodes(n);
      for (let i = 0; i < n; i++) list.push(buildCoach('LHB', codes[i]));
    }
  }
  return list;
}

const LOCO_KINDS = new Set(['WAP7', 'WAG12', 'WAG9', 'WDP4D']);
const cabOpts = (v) => (LOCO_KINDS.has(v.kind) ? { floorY: 1.85, inset: 0.2, halfW: 1.38 } : { floorY: 1.5, inset: v.kind === 'VB' || v.kind === 'VBO' ? 1.3 : 0.25, halfW: 1.42 });

const _pf = new THREE.Vector3(), _pr = new THREE.Vector3();

export class Consist {
  constructor(rakeType, { cars, isPlayer = false, loco = null } = {}) {
    this.rakeType = rakeType;
    this.loco = loco || (isMultipleUnit(rakeType) ? null : defaultLoco(rakeType));
    this.group = new THREE.Group();
    this.vehicles = makeVehicles(rakeType, cars, loco);
    let off = 0;
    for (const v of this.vehicles) {
      v.offset = off;
      off += v.length + GAP;
      this.group.add(v.group);
    }
    this.length = off - GAP;
    // outer group is never rotated, so +Z local is always the rear of the train
    addTailLamp(this.vehicles[this.vehicles.length - 1]);
    this.lead = this.vehicles[0];
    this.isPlayer = isPlayer;
    if (isPlayer) {
      addCabInterior(this.lead, cabOpts(this.lead));
      addGuardCabin(this.vehicles[this.vehicles.length - 1]);
    }
    this.distance = 0;
    if (isPlayer) this._attachHeadlight();
    this._tryGlb();
  }

  _attachHeadlight() {
    const lead = this.lead;
    const pos = lead.headPos || new THREE.Vector3(0, 3, -lead.length / 2);
    const spot = new THREE.SpotLight(0xfff3d6, 0, 420, Math.PI / 7.5, 0.5, 1.4);
    spot.position.copy(pos);
    spot.target.position.set(pos.x, 0.6, pos.z - 140);
    lead.group.add(spot, spot.target);
    this.headlight = spot;
    // volumetric beam: open cone, bright at the lamp, fading out (additive, shows in fog/darkness)
    const len = 110;
    const cone = new THREE.ConeGeometry(14, len, 24, 8, true);
    cone.translate(0, -len / 2, 0);
    cone.rotateX(Math.PI / 2); // apex at the lamp, opening forward (-Z)
    const p = cone.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) { const k = Math.max(0, 1 + p.getZ(i) / len); const c = 0.55 * Math.pow(k, 2.4); col.push(c, c * 0.96, c * 0.85); }
    cone.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(cone, beamMat);
    beam.position.copy(pos);
    beam.rotation.x = -0.035;
    beam.renderOrder = 2;
    lead.group.add(beam);
    this.beam = beam;
  }

  async _tryGlb() {
    const key = this.rakeType.toLowerCase();
    const [locoG, coachG, legacy] = await Promise.all([loadGlb(`${key}_loco.glb`), loadGlb(`${key}_coach.glb`), loadGlb(`${key}.glb`)]);
    const swap = (v, gltf) => {
      const inner = v.reversed ? v.group.children[0] : v.group;
      const keep = new Set(v.bogies);
      for (const c of [...inner.children]) if (!keep.has(c) && !c.isLight) inner.remove(c);
      const model = gltf.scene.clone(true);
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      inner.add(model);
    };
    const head = locoG || legacy;
    if (head) swap(this.vehicles[0], head);
    if (coachG) this.vehicles.slice(1).forEach((v) => swap(v, coachG));
  }

  // Replace the leading locomotive (engine change / reversal) and re-pack offsets.
  replaceLead(newLead) {
    const old = this.vehicles[0];
    old.group.removeFromParent();
    this.vehicles[0] = newLead;
    this.group.add(newLead.group);
    let off = 0;
    for (const v of this.vehicles) { v.offset = off; off += v.length + GAP; }
    this.length = off - GAP;
    this.lead = newLead;
    if (this.isPlayer) addCabInterior(newLead, cabOpts(newLead));
    if (this.headlight) { this.headlight.removeFromParent(); this.headlight.target.removeFromParent(); if (this.beam) this.beam.removeFromParent(); this._attachHeadlight(); }
  }

  // Place a single vehicle with its centre at route distance c.
  static placeVehicle(v, path, lane, c, dir = 1) {
    const sF = c + dir * v.bogieHalf, sR = c - dir * v.bogieHalf;
    path.pointAt(sF, lane.at(sF), _pf);
    path.pointAt(sR, lane.at(sR), _pr);
    const th = Math.atan2(_pf.x - _pr.x, -(_pf.z - _pr.z));
    v.group.position.set((_pf.x + _pr.x) / 2, (_pf.y + _pr.y) / 2 + TRACK.RAIL_TOP, (_pf.z + _pr.z) / 2);
    v.group.rotation.set(0, -th, 0, 'YXZ');
  }

  // Position every vehicle along `lane`. dir = +1 runs toward +s, -1 toward -s.
  place(path, lane, sFront, dir = 1) {
    const prev = this._lastFront;
    if (prev !== undefined) this.distance += Math.abs(sFront - prev);
    this._lastFront = sFront;
    for (const v of this.vehicles) {
      const c = sFront - dir * (v.offset + v.length / 2);
      const sF = c + dir * v.bogieHalf, sR = c - dir * v.bogieHalf;
      path.pointAt(sF, lane.at(sF), _pf);
      path.pointAt(sR, lane.at(sR), _pr);
      const dx = _pf.x - _pr.x, dz = _pf.z - _pr.z;
      const horiz = Math.hypot(dx, dz) || 1;
      const th = Math.atan2(dx, -dz);
      const pitch = Math.atan2(_pf.y - _pr.y, horiz);
      v.group.position.set((_pf.x + _pr.x) / 2, (_pf.y + _pr.y) / 2 + TRACK.RAIL_TOP, (_pf.z + _pr.z) / 2);
      // lean into canted curves (cant is defined relative to +s, so flip for reversed running)
      const cant = path.cantAt(c) * (lane.inTransition(c) ? 0 : 1);
      v.group.rotation.set(pitch, -th, dir * Math.atan(cant), 'YXZ');
      // bogies steer with the local track heading (visible on turnouts)
      const inner = v.reversed ? -1 : 1;
      v.bogies.forEach((b) => {
        const bz = b.position.z * inner;
        const sb = c - dir * bz;
        const thp = path.headingAt(sb) + Math.atan(lane.slope(sb)) + (dir < 0 ? Math.PI : 0);
        let rel = thp - th;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        b.rotation.y = -rel;
      });
      const spin = (this.distance / (v.wheelR || 0.46)) * (v.reversed ? 1 : -1);
      for (const ws of v.wheelsets) ws.rotation.x = spin;
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}

// Merged static rake for trains parked at platforms (very few draw calls).
const staticCache = new Map();
export function buildStaticRake(rakeType, cars) {
  const key = `${rakeType}|${cars}`;
  if (!staticCache.has(key)) {
    const c = new Consist(rakeType, { cars });
    let z = 0;
    for (const v of c.vehicles) {
      v.group.position.set(0, TRACK.RAIL_TOP, z + v.length / 2);
      v.group.rotation.set(0, 0, 0);
      z += v.length + GAP;
    }
    c.group.updateMatrixWorld(true);
    const bat = new Batcher();
    bat.addObject(c.group);
    const merged = bat.build();
    merged.traverse((o) => { if (o.isMesh) o.userData.disposable = false; });
    staticCache.set(key, { group: merged, length: c.length });
  }
  const tpl = staticCache.get(key);
  return { group: tpl.group.clone(), length: tpl.length };
}
