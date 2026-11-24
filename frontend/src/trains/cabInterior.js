import * as THREE from 'three/webgpu';

// Driving-cab interior (desk, gauges, seats, loco pilot + assistant) and the
// guard's compartment at the rear of the train (guard with a green flag).
// Both are attached to the player's consist only. Walls are solid boxes, so
// from inside you see the panels, and through the window openings the world.

const _box = new THREE.BoxGeometry(1, 1, 1);
const mats = {};
const mat = (hex, r = 0.7, m = 0.05, extra = {}) => (mats[hex + ':' + r + ':' + m] ||= new THREE.MeshStandardMaterial({ color: hex, roughness: r, metalness: m, ...extra }));

function box(parent, material, x, y, z, w, h, d, rx = 0, ry = 0) {
  const m = new THREE.Mesh(_box, material);
  m.position.set(x, y, z); m.scale.set(w, h, d); m.rotation.set(rx, ry, 0);
  parent.add(m);
  return m;
}

let _deskTex = null;
function deskTexture() {
  if (_deskTex) return _deskTex;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#2b3036'; x.fillRect(0, 0, 1024, 256);
  const dial = (cx, cy, r, label, max, val, col) => {
    x.fillStyle = '#f4f1e8'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#111'; x.lineWidth = 4; x.stroke();
    x.lineWidth = 2;
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); x.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92); x.stroke();
    }
    const a = Math.PI * 0.75 + (val / max) * Math.PI * 1.5;
    x.strokeStyle = col; x.lineWidth = 4;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75); x.stroke();
    x.fillStyle = '#111'; x.font = 'bold 16px Arial'; x.textAlign = 'center'; x.fillText(label, cx, cy + r * 0.5);
  };
  dial(110, 128, 90, 'km/h', 160, 0, '#c0392b');
  dial(300, 128, 70, 'BP kg/cm²', 10, 5, '#111');
  dial(460, 128, 70, 'BC kg/cm²', 5, 0.4, '#c0392b');
  dial(620, 128, 70, 'MR kg/cm²', 10, 8.5, '#111');
  dial(780, 128, 70, 'AMPS', 1000, 0, '#111');
  // indicator lamps and the DMI screen
  for (let k = 0; k < 6; k++) { x.fillStyle = ['#2ecc71', '#f1c40f', '#e74c3c', '#3498db', '#2ecc71', '#e67e22'][k]; x.beginPath(); x.arc(900 + (k % 3) * 34, 70 + Math.floor(k / 3) * 34, 11, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#0b1d2b'; x.fillRect(880, 140, 120, 90);
  x.fillStyle = '#3ad1ff'; x.font = 'bold 18px Arial'; x.fillText('KAVACH', 940, 180); x.fillText('DMI', 940, 205);
  _deskTex = new THREE.CanvasTexture(c);
  _deskTex.colorSpace = THREE.SRGBColorSpace;
  return _deskTex;
}

// Simple railway crew figure. pose: 'seated' | 'standing'
export function crewFigure({ shirt = 0xdfe8f2, pants = 0x1f2a3a, cap = null, pose = 'seated', flag = null, seed = 1 } = {}) {
  const g = new THREE.Group();
  const skin = mat([0x8d5524, 0xa0673a, 0x7a4a26][seed % 3], 0.75);
  const top = mat(shirt, 0.8), bottom = mat(pants, 0.8);
  const seated = pose === 'seated';
  const hipY = seated ? 0.48 : 0.92;
  box(g, bottom, 0, hipY, 0, 0.36, 0.2, 0.24);
  const torso = box(g, top, 0, hipY + 0.33, 0, 0.4, 0.5, 0.24);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin); head.position.set(0, hipY + 0.73, -0.01); g.add(head);
  box(g, mat(0x111111, 0.6), 0, hipY + 0.8, 0.02, 0.2, 0.08, 0.2); // hair
  if (cap) { box(g, mat(cap, 0.6), 0, hipY + 0.86, 0, 0.24, 0.07, 0.25); box(g, mat(cap, 0.6), 0, hipY + 0.83, -0.14, 0.22, 0.02, 0.1); }
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.24, hipY + 0.53, 0);
    box(arm, top, 0, -0.14, 0, 0.1, 0.3, 0.1);
    const fore = new THREE.Group(); fore.position.y = -0.28; arm.add(fore);
    box(fore, skin, 0, -0.12, 0, 0.085, 0.26, 0.085);
    arm.userData.fore = fore;
    g.add(arm); arms.push(arm);
  }
  if (seated) {
    for (const side of [-1, 1]) { // thighs forward, shins down
      box(g, bottom, side * 0.1, hipY - 0.02, -0.22, 0.14, 0.14, 0.46);
      box(g, bottom, side * 0.1, hipY - 0.26, -0.44, 0.13, 0.46, 0.13);
      box(g, mat(0x111111, 0.5), side * 0.1, 0.04, -0.5, 0.12, 0.08, 0.24);
    }
    for (const a of arms) { a.rotation.x = -0.9; a.userData.fore.rotation.x = -0.5; } // hands on the desk
  } else {
    for (const side of [-1, 1]) {
      box(g, bottom, side * 0.1, 0.46, 0, 0.14, 0.9, 0.14);
      box(g, mat(0x111111, 0.5), side * 0.1, 0.04, -0.05, 0.12, 0.08, 0.26);
    }
  }
  if (flag) { // hand flag (green/red) held out in the right hand
    const fa = arms[1];
    fa.rotation.x = -1.2; fa.rotation.z = -0.25;
    const stick = box(fa.userData.fore, mat(0x6b4a2a), 0, -0.3, 0, 0.025, 0.5, 0.025);
    const cloth = box(fa.userData.fore, mat(flag, 0.9, 0, { side: THREE.DoubleSide }), 0, -0.45, -0.18, 0.01, 0.26, 0.34);
    g.userData.flag = cloth; g.userData.stick = stick;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.arms = arms;
  g.userData.torso = torso;
  g.userData.head = head;
  return g;
}

// Driving cab at the front (-Z) end of the vehicle.
export function addCabInterior(v, { floorY = 1.85, inset = 0.2, halfW = 1.38 } = {}) {
  if (v.cabInterior) return v.cabInterior;
  const L = v.length;
  const z0 = -L / 2 + inset;      // inside face of the front wall
  const zb = z0 + 2.7;            // back wall of the cab
  const g = new THREE.Group();
  const panel = mat(0xc9ccc4, 0.8), dark = mat(0x3a4048, 0.6, 0.2), floorM = mat(0x4a4f55, 0.9), ceiling = mat(0xe6e6df, 0.85);
  const top = floorY + 2.05;
  box(g, floorM, 0, floorY, (z0 + zb) / 2, halfW * 2, 0.06, zb - z0);
  box(g, ceiling, 0, top, (z0 + zb) / 2, halfW * 2, 0.06, zb - z0);
  // front wall: lower panel, centre and outer pillars, header (windscreens are openings)
  box(g, panel, 0, floorY + 0.4, z0, halfW * 2, 0.8, 0.08);
  box(g, dark, 0, floorY + 1.18, z0, 0.18, 0.76, 0.1);
  for (const s of [-1, 1]) box(g, dark, s * (halfW - 0.08), floorY + 1.18, z0, 0.2, 0.76, 0.1);
  box(g, panel, 0, floorY + 1.8, z0, halfW * 2, 0.5, 0.08);
  box(g, mat(0x1b2127, 0.6), 0, floorY + 1.62, z0 + 0.22, halfW * 2 - 0.1, 0.05, 0.42); // sun visor
  // side walls with a window opening and a door
  for (const s of [-1, 1]) {
    box(g, panel, s * halfW, floorY + 0.5, (z0 + zb) / 2, 0.06, 1.0, zb - z0);
    box(g, panel, s * halfW, floorY + 1.8, (z0 + zb) / 2, 0.06, 0.5, zb - z0);
    box(g, panel, s * halfW, floorY + 1.25, z0 + 0.25, 0.06, 0.6, 0.5);
    box(g, panel, s * halfW, floorY + 1.25, zb - 0.45, 0.06, 0.6, 0.9);
  }
  // back wall with door to the machine room
  box(g, panel, -0.85, floorY + 1.0, zb, 1.06, 2.0, 0.08);
  box(g, panel, 0.85, floorY + 1.0, zb, 1.06, 2.0, 0.08);
  box(g, mat(0x5a6470, 0.5, 0.3), 0, floorY + 1.0, zb + 0.02, 0.64, 1.95, 0.05);
  // driver's desk: base + slanted gauge panel + control stand
  box(g, dark, 0, floorY + 0.38, z0 + 0.42, halfW * 2 - 0.1, 0.76, 0.66);
  const gp = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.42), new THREE.MeshStandardMaterial({ map: deskTexture(), roughness: 0.6 }));
  gp.position.set(-0.05, floorY + 0.9, z0 + 0.33); gp.rotation.x = -0.75; g.add(gp);
  box(g, dark, 0, floorY + 0.79, z0 + 0.62, halfW * 2 - 0.1, 0.05, 0.36);
  // master controller, reverser, automatic and independent brake handles
  const lever = (x, col, len = 0.22) => { const h = box(g, mat(col, 0.4, 0.4), x, floorY + 0.92, z0 + 0.66, 0.04, len, 0.04); h.rotation.x = 0.4; return h; };
  v.cabControls = { throttle: lever(-0.95, 0x1c1c1c), brakeA: lever(-0.35, 0xb03a2e), brakeI: lever(-0.22, 0xd4a017) };
  box(g, mat(0x111111, 0.3), -0.55, floorY + 0.85, z0 + 0.55, 0.14, 0.04, 0.08); // horn button panel
  // seats
  for (const s of [-1, 1]) {
    const sx = s * 0.69, sz = z0 + 1.23;
    box(g, mat(0x2c3e50, 0.8), sx, floorY + 0.5, sz, 0.48, 0.1, 0.46);
    box(g, mat(0x2c3e50, 0.8), sx, floorY + 0.85, sz + 0.24, 0.48, 0.6, 0.08);
    box(g, dark, sx, floorY + 0.24, sz, 0.08, 0.48, 0.08);
  }
  // crew: loco pilot on the left, assistant loco pilot on the right
  const lp = crewFigure({ shirt: 0xe8eef5, pants: 0x1f2a3a, pose: 'seated', seed: 1 });
  lp.position.set(-0.68, floorY + 0.06, z0 + 1.2);
  g.add(lp);
  const alp = crewFigure({ shirt: 0xb9cde3, pants: 0x283747, pose: 'seated', seed: 2 });
  alp.position.set(0.7, floorY + 0.06, z0 + 1.2);
  alp.rotation.y = 0.15;
  g.add(alp);
  // cab light (dim, warm)
  box(g, mat(0xfff3d0, 0.4, 0, { emissive: 0xfff0c0, emissiveIntensity: 0.6 }), 0, top - 0.05, (z0 + zb) / 2, 0.5, 0.03, 0.2);
  // windscreen wipers (pivot at the bottom of each screen, outside the glass)
  v.wipers = [];
  for (const x of [-0.66, 0.66]) {
    const pivot = new THREE.Group();
    pivot.position.set(x - 0.42, floorY + 0.84, z0 - 0.16);
    const arm = box(pivot, mat(0x111111, 0.5, 0.3), 0, 0.36, 0, 0.025, 0.72, 0.02);
    box(pivot, mat(0x1b1b1b, 0.7), 0, 0.42, -0.01, 0.05, 0.62, 0.03);
    arm.castShadow = false;
    pivot.rotation.z = -1.25;
    g.add(pivot);
    v.wipers.push(pivot);
  }
  v.group.add(g);
  v.cabInterior = g;
  v.crew = { lp, alp };
  // the cab camera sits just behind and between the two crew seats
  v.cabEye = new THREE.Vector3(0.02, floorY + 1.62, zb - 0.18);
  v.cabEyeDriver = new THREE.Vector3(-0.68, floorY + 1.3, z0 + 1.15);
  return g;
}

// Guard's compartment at the rear (+Z) end of the last vehicle.
export function addGuardCabin(v, { floorY = 1.32, halfW = 1.38 } = {}) {
  if (v.guardCabin) return v.guardCabin;
  const L = v.length;
  const ze = L / 2 - 0.15;      // rear wall (inside)
  const zp = ze - 3.0;          // partition to the passenger area
  const g = new THREE.Group();
  const panel = mat(0xd8d2c0, 0.85), dark = mat(0x4a4f55, 0.6, 0.2);
  const top = floorY + 2.2;
  box(g, mat(0x5b534a, 0.9), 0, floorY, (ze + zp) / 2, halfW * 2, 0.06, ze - zp);
  box(g, mat(0xe8e4d8, 0.85), 0, top, (ze + zp) / 2, halfW * 2, 0.06, ze - zp);
  // rear wall with the guard's look-out window
  box(g, panel, 0, floorY + 0.55, ze, halfW * 2, 1.1, 0.08);
  box(g, panel, 0, floorY + 1.95, ze, halfW * 2, 0.5, 0.08);
  for (const s of [-1, 1]) box(g, panel, s * (halfW - 0.35), floorY + 1.4, ze, 0.7, 0.6, 0.08);
  // side walls with windows
  for (const s of [-1, 1]) {
    box(g, panel, s * halfW, floorY + 0.55, (ze + zp) / 2, 0.06, 1.1, ze - zp);
    box(g, panel, s * halfW, floorY + 1.95, (ze + zp) / 2, 0.06, 0.5, ze - zp);
    box(g, panel, s * halfW, floorY + 1.4, zp + 0.5, 0.06, 0.6, 1.0);
  }
  box(g, panel, 0, floorY + 1.1, zp, halfW * 2, 2.2, 0.08); // partition
  // guard's desk, hand-brake wheel, emergency brake valve, lamp and log book
  box(g, dark, -0.95, floorY + 0.45, ze - 1.2, 0.5, 0.9, 1.1);
  box(g, mat(0x6b4a2a, 0.8), -0.95, floorY + 0.92, ze - 1.2, 0.56, 0.04, 1.16);
  box(g, mat(0xf2f2f2, 0.7), -0.95, floorY + 0.95, ze - 1.3, 0.22, 0.02, 0.3);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 24), mat(0xb03a2e, 0.4, 0.4));
  wheel.position.set(1.15, floorY + 1.1, ze - 0.8); wheel.rotation.y = Math.PI / 2; g.add(wheel);
  box(g, mat(0xd4a017, 0.4, 0.4), 1.2, floorY + 1.6, ze - 1.6, 0.08, 0.2, 0.08);
  const lamp = box(g, mat(0x2e7d32, 0.4, 0, { emissive: 0x33ff66, emissiveIntensity: 0.8 }), -0.95, floorY + 1.05, ze - 0.8, 0.14, 0.2, 0.14);
  box(g, mat(0x2c3e50, 0.8), -0.95, floorY + 0.5, ze - 2.2, 0.45, 0.08, 0.45); // stool
  box(g, mat(0xfff3d0, 0.4, 0, { emissive: 0xfff0c0, emissiveIntensity: 0.6 }), 0, top - 0.05, (ze + zp) / 2, 0.5, 0.03, 0.2);
  // the guard: white uniform, black cap, green flag, standing at the look-out window
  const guard = crewFigure({ shirt: 0xf4f4f0, pants: 0x1a1a1a, cap: 0x111111, pose: 'standing', flag: 0x1e9e3a, seed: 3 });
  guard.position.set(0.55, floorY + 0.03, ze - 0.75);
  guard.rotation.y = Math.PI; // facing backwards, looking out over the track behind
  g.add(guard);
  // the last coach's end door is closed: no gangway bellows behind the guard
  v.group.traverse((o) => { if (v.reversed ? o.userData.frontGangway : o.userData.rearGangway) o.visible = false; });
  v.group.add(g);
  v.guardCabin = g;
  v.guard = guard;
  v.guardLamp = lamp;
  v.guardEye = new THREE.Vector3(-0.2, floorY + 1.6, zp + 0.55);
  return g;
}

// Small idle motions so the crew look alive.
export function animateWipers(lead, dt, on) {
  if (!lead || !lead.wipers) return;
  lead._wipePh = on ? (lead._wipePh || 0) + dt * (Math.PI * 2 / 1.35) : 0;
  const k = on ? (1 - Math.cos(lead._wipePh)) / 2 : 0;   // park position when off
  for (const w of lead.wipers) w.rotation.z = -1.25 + k * 1.7;
}

export function animateCrew(lead, tail, t, { throttle = 0, brake = 0, speed = 0 } = {}) {
  if (lead && lead.crew) {
    const { lp, alp } = lead.crew;
    lp.userData.head.rotation.y = Math.sin(t * 0.4) * 0.12;
    lp.userData.arms[0].rotation.x = -0.9 - throttle * 0.25;
    lp.userData.arms[1].rotation.x = -0.9 - brake * 0.3;
    alp.userData.head.rotation.y = 0.25 + Math.sin(t * 0.27 + 1.3) * 0.35; // watching signals, then the track
    if (lead.cabControls) {
      lead.cabControls.throttle.rotation.x = 0.4 - throttle * 0.9;
      lead.cabControls.brakeA.rotation.x = 0.4 - brake * 0.9;
    }
  }
  if (tail && tail.guard) {
    const g = tail.guard;
    g.userData.head.rotation.y = Math.sin(t * 0.3) * 0.25;
    if (g.userData.flag) g.userData.flag.rotation.y = Math.sin(t * (2 + speed * 0.1)) * 0.25;
  }
}
