import * as THREE from 'three/webgpu';
import { ASSETS_BASE } from '../config.js';
import { loadModel } from '../trains/consist.js';

// Real station-building models (drop-in). public/models/stations/manifest.json:
//   { "GTL": { "file": "guntakal.glb", "scale": 1, "rotY": 0, "offset": [0, 0, 0] }, ... }
// Model convention: metres, ground at y = 0, origin at the centre of the building,
// long axis along Z (parallel to the platform), the platform-facing side toward -X.
let manifest = {};

export async function loadStationManifest() {
  try {
    const r = await fetch(`${ASSETS_BASE}/models/stations/manifest.json`, { cache: 'no-cache' });
    if (r.ok) manifest = await r.json();
  } catch { manifest = {}; }
  return manifest;
}

export const stationModel = (code) => manifest[code] || null;

// Loads the model into the station's local frame (x = lateral, z = -along-track).
export function placeStationModel(entry, parent, { bx, bs, y }) {
  loadModel(`stations/${entry.file}`).then((g) => {
    if (!g) return;
    const m = g.scene.clone(true);
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const sc = entry.scale ?? 1;
    m.scale.setScalar(sc);
    const off = entry.offset || [0, 0, 0];
    m.position.set(bx + bs * off[0], y + off[1], -off[2]);
    m.rotation.y = (bs > 0 ? 0 : Math.PI) + THREE.MathUtils.degToRad(entry.rotY || 0);
    parent.add(m);
  });
}
