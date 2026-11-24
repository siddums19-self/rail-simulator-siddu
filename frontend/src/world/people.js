import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mulberry32 } from '../core/rng.js';
import { loadModel } from '../trains/consist.js';

// Optional rigged models/passenger.glb (Mixamo / Renderpeople) replaces the procedural people.
let passengerGlb = null;
export function preloadPassengerGlb() { return loadModel('passenger.glb').then((g) => { passengerGlb = g; }); }

// Articulated low-poly Indian passengers (saree, kurta, shirt) and red-shirt
// porters. Limbs are pivoted at shoulders/hips so walking looks natural.

const geos = {};
const mats = new Map();
const mat = (hex, rough = 0.8) => {
  if (!mats.has(hex)) mats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: rough }));
  return mats.get(hex);
};

function g() {
  if (geos.head) return geos;
  geos.head = new THREE.SphereGeometry(0.115, 12, 10);
  geos.hair = new THREE.SphereGeometry(0.12, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  geos.torso = new THREE.CapsuleGeometry(0.15, 0.36, 4, 10);
  geos.hips = new THREE.CapsuleGeometry(0.14, 0.12, 4, 10);
  geos.arm = new THREE.CapsuleGeometry(0.045, 0.5, 3, 6); geos.arm.translate(0, -0.27, 0);
  geos.leg = new THREE.CapsuleGeometry(0.06, 0.72, 3, 6); geos.leg.translate(0, -0.4, 0);
  geos.saree = new THREE.CylinderGeometry(0.16, 0.3, 0.92, 12, 1, true); geos.saree.translate(0, -0.46, 0);
  geos.bag = new THREE.BoxGeometry(0.34, 0.42, 0.22);
  geos.trunk = new THREE.BoxGeometry(0.6, 0.32, 0.4);
  return geos;
}

const SKIN = [0x8d5524, 0xa86d3e, 0xc68642, 0x7a4a26, 0xb57a4a];
const SHIRT = [0xe2e8f0, 0x2563eb, 0x16a34a, 0xf59e0b, 0x7c3aed, 0x0ea5e9, 0x111827, 0xbe185d];
const SAREE = [0xdb2777, 0xf97316, 0x7c3aed, 0x059669, 0xdc2626, 0xeab308, 0x2563eb];
const PANTS = [0x1e293b, 0x334155, 0x3f2a1d, 0x1e3a8a, 0xd6d3d1];

export function createPerson(seed, kind = 'auto') {
  if (passengerGlb) {
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
  const root = new THREE.Group();
  const skin = mat(SKIN[Math.floor(rand() * SKIN.length)], 0.7);
  const isPorter = type === 'porter';
  const top = mat(isPorter ? 0xc81e1e : type === 'woman' ? SAREE[Math.floor(rand() * SAREE.length)] : SHIRT[Math.floor(rand() * SHIRT.length)]);
  const bottom = mat(type === 'woman' ? top.color.getHex() : PANTS[Math.floor(rand() * PANTS.length)]);
  const scale = type === 'woman' ? 0.93 : 1 + (rand() - 0.5) * 0.08;

  const hipY = 0.92;
  const hips = new THREE.Mesh(G.hips, bottom); hips.position.y = hipY; root.add(hips);
  const torso = new THREE.Mesh(G.torso, top); torso.position.y = hipY + 0.36; root.add(torso);
  const head = new THREE.Mesh(G.head, skin); head.position.y = hipY + 0.78; root.add(head);
  const hair = new THREE.Mesh(G.hair, mat(0x111111, 0.6)); hair.position.y = hipY + 0.8; root.add(hair);
  const limbs = {};
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.2, hipY + 0.55, 0);
    arm.add(new THREE.Mesh(G.arm, side < 0 && type === 'woman' ? top : skin));
    root.add(arm);
    const leg = new THREE.Group(); leg.position.set(side * 0.085, hipY, 0);
    leg.add(new THREE.Mesh(G.leg, type === 'woman' ? skin : bottom));
    root.add(leg);
    limbs[side < 0 ? 'lArm' : 'rArm'] = arm;
    limbs[side < 0 ? 'lLeg' : 'rLeg'] = leg;
  }
  if (type === 'woman') {
    const skirt = new THREE.Mesh(G.saree, top); skirt.position.y = hipY + 0.05; root.add(skirt);
  }
  if (isPorter) {
    const t = new THREE.Mesh(G.trunk, mat(0x6b3a1e)); t.position.y = hipY + 1.05; root.add(t);
  } else if (rand() < 0.5) {
    const b = new THREE.Mesh(G.bag, mat(rand() < 0.5 ? 0x1f2937 : 0x7f1d1d)); b.position.set(0.3, 0.3, 0.05); root.add(b);
  }
  root.scale.setScalar(scale);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  root.userData.limbs = limbs;
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
  if (p.walker) {
    p.phase += dt * 5.2 * p.speed;
    p.t += p.dir * p.speed * dt;
    if (p.t > p.max || p.t < p.min) { p.dir *= -1; p.t = Math.max(p.min, Math.min(p.max, p.t)); }
    p.mesh.position.z = p.t;
    p.mesh.rotation.y = p.dir > 0 ? Math.PI : 0;
    const sw = Math.sin(p.phase) * 0.5;
    L.lLeg.rotation.x = sw; L.rLeg.rotation.x = -sw;
    L.lArm.rotation.x = -sw * 0.7; L.rArm.rotation.x = sw * 0.7;
  } else {
    p.phase += dt;
    L.rArm.rotation.x = Math.sin(p.phase * 0.7) * 0.08;
    p.mesh.rotation.y = p.baseRot + Math.sin(p.phase * 0.2) * 0.3;
  }
}
