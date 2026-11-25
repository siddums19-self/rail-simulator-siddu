import * as THREE from 'three/webgpu';

// Cattle on rural sections: herds grazing beside the line, and now and then a cow standing on the track.
// A horn (or a close approach) sends it off the line; if the train reaches it first -> a cattle run-over.
let _mats = null;
function cow(rand) {
  _mats ||= [0xf5f0e6, 0x2b2b2b, 0x8d6e63, 0xd7ccc8, 0x5d4037].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
  const m = _mats[Math.floor(rand() * _mats.length)], g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 1.7), m); body.position.y = 1.05; g.add(body);
  const hump = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.35), m); hump.position.set(0, 1.5, 0.55); g.add(hump); // zebu hump
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 0.55), m); head.position.set(0, 1.25, 1.1); g.add(head);
  const horn = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.35, 5), horn); h.position.set(sx * 0.14, 1.55, 1.05); h.rotation.z = -sx * 0.4; g.add(h);
    for (const sz of [-0.65, 0.65]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.14), m); l.position.set(sx * 0.25, 0.35, sz); g.add(l); }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Cattle {
  constructor(scene) { this.scene = scene; this.herds = []; this.nextS = 0; this.rand = Math.random; }
  reset(sFront) { for (const h of this.herds) h.group.removeFromParent(); this.herds = []; this.nextS = sFront + 1500; }

  // rural(s): true where the line runs through open country; lane: our track's lateral function
  update(dt, { sFront, layout, lane, rural, lastHornS, speed, onHit, enabled }) {
    const path = layout.path, v = new THREE.Vector3();
    if (enabled && sFront > this.nextS - 900 && this.nextS < layout.total - 500) {
      const s = this.nextS;
      this.nextS += 1800 + this.rand() * 4200;
      if (rural(s)) {
        const group = new THREE.Group(); this.scene.add(group);
        const side = this.rand() < 0.5 ? -1 : 1, n = 2 + Math.floor(this.rand() * 5), cows = [];
        for (let i = 0; i < n; i++) cows.push({ m: cow(this.rand), ds: (this.rand() - 0.5) * 40, lat: side * (9 + this.rand() * 18), yaw: this.rand() * 6.28, onLine: false, ph: this.rand() * 6 });
        if (this.rand() < 0.35) { const c = cows[0]; c.onLine = true; c.lat = lane.at(s) + (this.rand() - 0.5); c.ds = 0; c.away = side; c.yaw = Math.PI / 2; } // one strays onto our line
        for (const c of cows) group.add(c.m);
        this.herds.push({ s, group, cows, hit: false });
      }
    }
    for (let i = this.herds.length - 1; i >= 0; i--) {
      const h = this.herds[i];
      if (sFront - h.s > 600) { h.group.removeFromParent(); this.herds.splice(i, 1); continue; }
      for (const c of h.cows) {
        const sc = h.s + c.ds, gap = sc - sFront;
        if (c.onLine) {
          // scared off by the horn within ~500 m, or by the train itself when very close
          if (!c.leaving && gap > 0 && ((lastHornS > sFront - 30 && gap < 520) || gap < 70)) c.leaving = true;
          if (c.leaving) { c.lat += c.away * dt * 1.6; if (Math.abs(c.lat - lane.at(sc)) > 4) c.onLine = false; }
          if (gap <= 0 && Math.abs(c.lat - lane.at(sc)) < 2.2 && !h.hit) { h.hit = true; c.m.visible = false; c.onLine = false; onHit(speed); }
        } else c.ph += dt;
        path.pointAt(sc, c.lat, v);
        const y = Math.abs(c.lat - lane.at(sc)) < 4 ? path.yAt(sc) + 0.2 : path.groundAt(sc);
        c.m.position.set(v.x, y, v.z);
        c.m.rotation.y = -path.headingAt(sc) + c.yaw + (c.leaving ? 0 : Math.sin(c.ph * 0.3) * 0.2);
        c.m.children[2].position.y = c.onLine ? 1.25 : 1.25 - (Math.sin(c.ph * 0.5) > 0 ? 0.55 : 0); // grazing: head down
      }
    }
  }
}
