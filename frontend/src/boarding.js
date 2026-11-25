import * as THREE from 'three/webgpu';
import { createPerson } from './world/people.js';
import { PLATFORM_TOP } from './config.js';

// Doors open on the platform side when the train stands at a halt; passengers get off first, then the
// waiting ones board. Doors close as the train moves off. Positions come straight from the route geometry
// (route distance + lane), so they line up with the coaches whichever way the train is running.

const LOCO = new Set(['WAP7', 'WAG9', 'WAG12', 'WDP4D', 'BOXN']);
const doorMat = new THREE.MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.9 });
const stepMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
const doorGeo = new THREE.PlaneGeometry(0.95, 1.95), stepGeo = new THREE.BoxGeometry(0.9, 0.06, 0.35);

export class Boarding {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); scene.add(this.group); this.people = []; this.active = false; this.st = null; }

  // which side of our track the platform is on, in route laterals (+ = right of +s)
  _side(layout, st, track) {
    const L = st.layout;
    let best = null;
    for (const P of L.platforms || []) {
      const dl = track.o - P.l1, dr = P.l0 - track.o;
      if (dl > -0.5 && dl < 4 && (!best || dl < best.d)) best = { d: dl, s: -1 };
      if (dr > -0.5 && dr < 4 && (!best || dr < best.d)) best = { d: dr, s: 1 };
    }
    if (!best) return 0;
    const byO = L.tracks.slice().sort((a, b) => a.o - b.o), sc = L.sCenter;
    const mir = byO.length > 1 && byO.at(-1).lane.at(sc) < byO[0].lane.at(sc) ? -1 : 1;
    return best.s * mir;
  }

  start({ consist, layout, lane, sFront, st, track, rand = Math.random }) {
    this.stop();
    const side = this._side(layout, st, track);
    if (!side) return;
    this.active = true; this.st = st;
    const path = layout.path, p = new THREE.Vector3(), q = new THREE.Vector3(), out = new THREE.Vector3();
    const busy = st.category === 'metro' ? 3 : st.category === 'junction' ? 2 : 1;
    for (const v of consist.vehicles) {
      if (LOCO.has(v.kind)) continue;
      const c = sFront - (v.offset + v.length / 2);
      const L = v.length, multi = /DEMU|EMU|MMTS/.test(v.kind);
      const doors = multi ? [-L / 2 + 3.0, 0, L / 2 - 3.3] : [-L / 2 + 1.7, L / 2 - 1.7];
      for (const dz of doors) {
        const s = c + dz, lat = lane.at(s);
        const th = path.headingAt(s);
        path.pointAt(s, lat + side * 1.64, p);
        const y = path.yAt(s);
        // open doorway + folding step
        const d = new THREE.Mesh(doorGeo, doorMat);
        d.position.set(p.x, y + PLATFORM_TOP + 1.25, p.z);
        d.rotation.y = -th + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.group.add(d);
        const stp = new THREE.Mesh(stepGeo, stepMat);
        path.pointAt(s, lat + side * 1.8, q);
        stp.position.set(q.x, y + PLATFORM_TOP + 0.05, q.z); stp.rotation.y = -th;
        this.group.add(stp);
        // passengers: some get off (walk out and away), then waiting ones board (walk in, disappear)
        path.pointAt(s, lat + side * 2.1, q);
        const off = Math.floor(rand() * (1 + busy)), on = 1 + Math.floor(rand() * (1 + busy));
        for (let k = 0; k < off + on; k++) {
          const boarding = k >= off;
          const m = createPerson(Math.floor(rand() * 1e9), 'auto');
          const away = 3 + rand() * 6, along = (rand() - 0.5) * 6;
          path.pointAt(s + along, lat + side * (2.1 + away), out);
          const a = boarding ? out.clone() : q.clone(), b = boarding ? q.clone() : out.clone();
          a.y = b.y = y + PLATFORM_TOP;
          m.position.copy(a);
          this.scene.add(m);
          const delay = (boarding ? 3.5 + (k - off) * 1.4 : k * 1.2) + rand() * 0.8; // alight first, then board
          this.people.push({ mesh: m, a, b, t: -delay, dur: a.distanceTo(b) / 1.2, boarding, walker: true, speed: 1.2, phase: rand() * 6 });
        }
      }
    }
  }

  update(dt) {
    for (const p of this.people) {
      p.t += dt;
      if (p.t < 0) { p.mesh.visible = !p.boarding ? false : true; continue; }
      const k = Math.min(1, p.t / p.dur);
      p.mesh.visible = !(p.boarding && k >= 1) && !(!p.boarding && p.t < 0);
      p.mesh.position.lerpVectors(p.a, p.b, k);
      p.mesh.rotation.y = Math.atan2(p.b.x - p.a.x, p.b.z - p.a.z);
      if (k < 1) { // walking: swing legs and arms (or play the model's own clip)
        p.mesh.userData.mixer?.update(dt);
        const L = p.mesh.userData.limbs;
        if (L) { p.phase += dt * 6.2; const sw = Math.sin(p.phase) * 0.5; L.lLeg.rotation.x = sw; L.rLeg.rotation.x = -sw; L.lArm.rotation.x = -sw * 0.7; L.rArm.rotation.x = sw * 0.7; }
      }
    }
  }

  stop() {
    for (const p of this.people) p.mesh.removeFromParent();
    this.people = [];
    this.group.clear();
    this.active = false;
  }
}
