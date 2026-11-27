import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mulberry32 } from '../core/rng.js';
import { loadModel } from '../trains/consist.js';

// Optional rigged models/passenger.glb (Mixamo / Renderpeople) replaces the procedural people.
let passengerGlb = null;
export function preloadPassengerGlb() { return loadModel('passenger.glb').then((g) => { passengerGlb = g; }); }

// Articulated anatomical Indian passengers (saree, kurta, shirt), red-shirt
// porters, and Station Masters with red/green hand-signal flags.
// Limbs are 2-segment (shoulder->elbow->hand, hip->knee->shoe) with sculpted
// head/neck/chest/waist/hips so every figure reads clearly as a human.

const geos = {};
const mats = new Map();
const mat = (hex, rough = 0.8, extra = {}) => {
  const k = hex + ':' + rough + ':' + (extra.side || 0);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: rough, ...extra }));
  return mats.get(k);
};

function g() {
  if (geos.head) return geos;
  geos.head = new THREE.SphereGeometry(0.11, 14, 12);
  geos.jaw = new THREE.CylinderGeometry(0.082, 0.056, 0.08, 10);
  geos.neck = new THREE.CylinderGeometry(0.048, 0.056, 0.1, 10);
  geos.ear = new THREE.SphereGeometry(0.022, 6, 5);
  geos.nose = new THREE.ConeGeometry(0.018, 0.045, 5); geos.nose.rotateX(Math.PI * 0.45);
  geos.eye = new THREE.SphereGeometry(0.013, 6, 5);
  geos.hair = new THREE.SphereGeometry(0.116, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
  geos.bun = new THREE.SphereGeometry(0.052, 8, 6);
  geos.capCrown = new THREE.CylinderGeometry(0.125, 0.115, 0.065, 14);
  geos.capBand = new THREE.CylinderGeometry(0.118, 0.118, 0.022, 14);
  geos.capVisor = new THREE.CylinderGeometry(0.12, 0.12, 0.012, 12, 1, false, -0.9, 1.8);
  // Anatomical torso: broad shoulders tapering to waist + pelvis
  geos.chest = new THREE.CylinderGeometry(0.165, 0.132, 0.28, 12);
  geos.waist = new THREE.CylinderGeometry(0.132, 0.138, 0.18, 12);
  geos.hips = new THREE.CylinderGeometry(0.14, 0.135, 0.15, 12);
  geos.collar = new THREE.TorusGeometry(0.068, 0.016, 6, 12); geos.collar.rotateX(Math.PI * 0.5);
  geos.belt = new THREE.CylinderGeometry(0.142, 0.142, 0.04, 12);
  geos.epaulette = new THREE.BoxGeometry(0.085, 0.018, 0.04);
  // 2-segment arms + hands
  geos.upperArm = new THREE.CylinderGeometry(0.044, 0.038, 0.26, 8); geos.upperArm.translate(0, -0.13, 0);
  geos.foreArm = new THREE.CylinderGeometry(0.036, 0.028, 0.24, 8); geos.foreArm.translate(0, -0.12, 0);
  geos.hand = new THREE.SphereGeometry(0.036, 7, 6); geos.hand.scale(0.8, 1.2, 0.6); geos.hand.translate(0, -0.26, 0);
  // 2-segment legs + shoes
  geos.thigh = new THREE.CylinderGeometry(0.068, 0.054, 0.4, 8); geos.thigh.translate(0, -0.2, 0);
  geos.shin = new THREE.CylinderGeometry(0.052, 0.038, 0.39, 8); geos.shin.translate(0, -0.195, 0);
  geos.shoe = new THREE.BoxGeometry(0.088, 0.065, 0.21); geos.shoe.translate(0, -0.41, 0.045);
  // Clothing & props
  geos.saree = new THREE.CylinderGeometry(0.15, 0.26, 0.86, 12, 1, true); geos.saree.translate(0, -0.43, 0);
  geos.pallu = new THREE.BoxGeometry(0.14, 0.48, 0.03);
  geos.bag = new THREE.BoxGeometry(0.32, 0.4, 0.2);
  geos.trunk = new THREE.BoxGeometry(0.58, 0.3, 0.38);
  geos.stick = new THREE.CylinderGeometry(0.012, 0.014, 0.54, 6); geos.stick.translate(0, 0.22, 0);
  geos.flagCloth = new THREE.PlaneGeometry(0.36, 0.26); geos.flagCloth.translate(0.18, 0.36, 0);
  return geos;
}

const SKIN = [0x8d5524, 0xa86d3e, 0xc68642, 0x7a4a26, 0xb57a4a];
const SHIRT = [0xe2e8f0, 0x2563eb, 0x16a34a, 0xf59e0b, 0x7c3aed, 0x0ea5e9, 0x111827, 0xbe185d];
const SAREE = [0xdb2777, 0xf97316, 0x7c3aed, 0x059669, 0xdc2626, 0xeab308, 0x2563eb];
const PANTS = [0x1e293b, 0x334155, 0x3f2a1d, 0x1e3a8a, 0xd6d3d1];

export function createPerson(seed, kind = 'auto') {
  if (passengerGlb && kind !== 'station_master') {
    const root = cloneSkinned(passengerGlb.scene);
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    if (passengerGlb.animations?.length) {
      const mixer = new THREE.AnimationMixer(root);
      const action = mixer.clipAction(passengerGlb.animations[0]);
      action.time = mulberry32(seed)() * action.getClip().duration;
      action.play();
      root.userData.mixer = mixer;
    }
    return root;
  }
  const G = g();
  const rand = mulberry32(seed);
  const type = kind === 'auto' ? (rand() < 0.38 ? 'woman' : 'man') : kind;
  const isSM = type === 'station_master';
  const isPorter = type === 'porter';
  const root = new THREE.Group();
  const skin = mat(SKIN[Math.floor(rand() * SKIN.length)], 0.72);
  const darkHair = mat(0x141414, 0.65);
  const eyeMat = mat(0x111111, 0.3);
  const shoeMat = mat(0x1a1a1a, 0.5);
  const top = mat(isSM ? 0xf8fafc : isPorter ? 0xc81e1e : type === 'woman' ? SAREE[Math.floor(rand() * SAREE.length)] : SHIRT[Math.floor(rand() * SHIRT.length)]);
  const bottom = mat(isSM ? 0xf1f5f9 : type === 'woman' ? top.color.getHex() : PANTS[Math.floor(rand() * PANTS.length)]);
  const scale = type === 'woman' ? 0.94 : isSM ? 1.03 : 1 + (rand() - 0.5) * 0.08;

  const hipY = 0.88;
  // Torso (hips, waist, chest, collar, belt)
  const hips = new THREE.Mesh(G.hips, bottom); hips.position.y = hipY + 0.04; hips.scale.set(1.08, 1, 0.74); root.add(hips);
  const waist = new THREE.Mesh(G.waist, top); waist.position.y = hipY + 0.19; waist.scale.set(1.06, 1, 0.7); root.add(waist);
  const chest = new THREE.Mesh(G.chest, top); chest.position.y = hipY + 0.41; chest.scale.set(1.16, 1, 0.72); root.add(chest);
  const collar = new THREE.Mesh(G.collar, top); collar.position.set(0, hipY + 0.56, 0); root.add(collar);
  if (type !== 'woman') {
    const belt = new THREE.Mesh(G.belt, mat(0x1e1b18, 0.45)); belt.position.y = hipY + 0.11; belt.scale.set(1.08, 1, 0.74); root.add(belt);
  }
  if (isSM) {
    const epMat = mat(0x1e3a8a, 0.5);
    for (const s of [-1, 1]) {
      const ep = new THREE.Mesh(G.epaulette, epMat); ep.position.set(s * 0.15, hipY + 0.555, 0); root.add(ep);
    }
  }

  // Neck + sculpted Head & Face (+Z is forward)
  const neck = new THREE.Mesh(G.neck, skin); neck.position.set(0, hipY + 0.6, 0); root.add(neck);
  const headGrp = new THREE.Group(); headGrp.position.set(0, hipY + 0.73, 0);
  const cranium = new THREE.Mesh(G.head, skin); cranium.scale.set(0.92, 1.05, 0.98); headGrp.add(cranium);
  const jaw = new THREE.Mesh(G.jaw, skin); jaw.position.set(0, -0.055, 0.015); headGrp.add(jaw);
  const nose = new THREE.Mesh(G.nose, skin); nose.position.set(0, -0.005, 0.108); headGrp.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(G.ear, skin); ear.position.set(s * 0.1, -0.01, 0); headGrp.add(ear);
    const eye = new THREE.Mesh(G.eye, eyeMat); eye.position.set(s * 0.036, 0.018, 0.092); headGrp.add(eye);
  }
  if (isSM) {
    const crown = new THREE.Mesh(G.capCrown, mat(0xf8fafc, 0.6)); crown.position.set(0, 0.085, -0.005); headGrp.add(crown);
    const band = new THREE.Mesh(G.capBand, mat(0xd4af37, 0.4)); band.position.set(0, 0.052, -0.005); headGrp.add(band);
    const visor = new THREE.Mesh(G.capVisor, mat(0x111827, 0.35)); visor.position.set(0, 0.042, 0.03); headGrp.add(visor);
  } else {
    const hair = new THREE.Mesh(G.hair, darkHair); hair.position.set(0, 0.015, -0.005); headGrp.add(hair);
    if (type === 'woman') {
      const bun = new THREE.Mesh(G.bun, darkHair); bun.position.set(0, -0.01, -0.115); headGrp.add(bun);
    }
  }
  root.add(headGrp);

  // Articulated 2-segment Arms (shoulder -> elbow -> forearm -> hand) & Legs (hip -> knee -> shin -> shoe)
  const limbs = {};
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.21, hipY + 0.52, 0);
    const sleeveMat = isSM || type === 'man' || (side < 0 && type === 'woman') ? top : skin;
    arm.add(new THREE.Mesh(G.upperArm, sleeveMat));
    const elbow = new THREE.Group(); elbow.position.y = -0.26;
    elbow.add(new THREE.Mesh(G.foreArm, isSM ? top : skin));
    elbow.add(new THREE.Mesh(G.hand, skin));
    arm.add(elbow);
    root.add(arm);

    const leg = new THREE.Group(); leg.position.set(side * 0.085, hipY, 0);
    leg.add(new THREE.Mesh(G.thigh, type === 'woman' ? skin : bottom));
    const knee = new THREE.Group(); knee.position.y = -0.4;
    knee.add(new THREE.Mesh(G.shin, type === 'woman' ? skin : bottom));
    knee.add(new THREE.Mesh(G.shoe, shoeMat));
    leg.add(knee);
    root.add(leg);

    limbs[side < 0 ? 'lArm' : 'rArm'] = arm;
    limbs[side < 0 ? 'lElbow' : 'rElbow'] = elbow;
    limbs[side < 0 ? 'lLeg' : 'rLeg'] = leg;
    limbs[side < 0 ? 'lKnee' : 'rKnee'] = knee;
  }

  if (type === 'woman') {
    const skirt = new THREE.Mesh(G.saree, top); skirt.position.y = hipY + 0.04; root.add(skirt);
    const pallu = new THREE.Mesh(G.pallu, top); pallu.position.set(-0.08, hipY + 0.34, 0.09); pallu.rotation.z = 0.35; root.add(pallu);
  }
  if (isSM) {
    // Hand-signal flags in right hand (red & green, toggled by starter aspect)
    const handPivot = new THREE.Group();
    handPivot.position.set(0, -0.25, 0.02);
    handPivot.rotation.x = Math.PI * 0.35;
    handPivot.add(new THREE.Mesh(G.stick, mat(0x6b4a2a, 0.7)));
    const redFlag = new THREE.Mesh(G.flagCloth, mat(0xdc2626, 0.85, { side: THREE.DoubleSide }));
    const greenFlag = new THREE.Mesh(G.flagCloth, mat(0x16a34a, 0.85, { side: THREE.DoubleSide }));
    greenFlag.visible = false;
    handPivot.add(redFlag);
    handPivot.add(greenFlag);
    limbs.rElbow.add(handPivot);
    limbs.rArm.rotation.x = -0.45;
    limbs.rElbow.rotation.x = -0.55;
    root.userData.redFlag = redFlag;
    root.userData.greenFlag = greenFlag;
    root.userData.flagPivot = handPivot;
  } else if (isPorter) {
    const t = new THREE.Mesh(G.trunk, mat(0x6b3a1e)); t.position.y = hipY + 1.02; root.add(t);
  } else if (rand() < 0.5) {
    const b = new THREE.Mesh(G.bag, mat(rand() < 0.5 ? 0x1f2937 : 0x7f1d1d)); b.position.set(0.28, 0.3, 0.04); root.add(b);
  }
  root.scale.setScalar(scale);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  root.userData.limbs = limbs;
  root.userData.head = headGrp;
  return root;
}

export function animatePerson(p, dt) {
  const mixer = p.mesh.userData.mixer;
  if (mixer) mixer.update(dt);
  const L = p.mesh.userData.limbs;
  if (!L) {
    if (p.walker) {
      p.t += p.dir * p.speed * dt;
      if (p.t > p.max || p.t < p.min) p.dir *= -1;
      p.mesh.position.z = p.t;
      p.mesh.rotation.y = p.dir > 0 ? 0 : Math.PI;
    }
    return;
  }
  if (p.role === 'sm') {
    p.phase += dt;
    const green = !!p.green;
    if (p.mesh.userData.redFlag) p.mesh.userData.redFlag.visible = !green;
    if (p.mesh.userData.greenFlag) p.mesh.userData.greenFlag.visible = green;
    if (green) {
      // Raise right arm and wave the green All-Right flag!
      L.rArm.rotation.x = -1.35 + Math.sin(p.phase * 5.2) * 0.22;
      L.rArm.rotation.z = -0.35 + Math.cos(p.phase * 4.5) * 0.2;
      L.rElbow.rotation.x = -0.45 + Math.sin(p.phase * 5.2) * 0.25;
    } else {
      // Hold red flag steady at attention
      L.rArm.rotation.x = -0.55;
      L.rArm.rotation.z = -0.1;
      L.rElbow.rotation.x = -0.6;
    }
    if (p.mesh.userData.head) p.mesh.userData.head.rotation.y = Math.sin(p.phase * 0.6) * 0.2;
    p.mesh.rotation.y = p.baseRot;
    return;
  }
  if (p.walker) {
    p.phase += dt * 5.2 * p.speed;
    p.t += p.dir * p.speed * dt;
    if (p.t > p.max || p.t < p.min) { p.dir *= -1; p.t = Math.max(p.min, Math.min(p.max, p.t)); }
    p.mesh.position.z = p.t;
    p.mesh.rotation.y = p.dir > 0 ? 0 : Math.PI;
    const sw = Math.sin(p.phase) * 0.5;
    L.lLeg.rotation.x = sw; L.rLeg.rotation.x = -sw;
    if (L.lKnee) L.lKnee.rotation.x = Math.max(0, -sw) * 0.65;
    if (L.rKnee) L.rKnee.rotation.x = Math.max(0, sw) * 0.65;
    L.lArm.rotation.x = -sw * 0.7; L.rArm.rotation.x = sw * 0.7;
    if (L.lElbow) L.lElbow.rotation.x = -0.25 - Math.max(0, sw) * 0.45;
    if (L.rElbow) L.rElbow.rotation.x = -0.25 - Math.max(0, -sw) * 0.45;
  } else {
    p.phase += dt;
    L.rArm.rotation.x = Math.sin(p.phase * 0.7) * 0.08;
    if (L.rElbow) L.rElbow.rotation.x = -0.25;
    p.mesh.rotation.y = p.baseRot + Math.sin(p.phase * 0.2) * 0.3;
  }
}
