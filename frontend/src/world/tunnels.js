import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';
import { GeoAccum, meshFrom } from './geoAccum.js';

// Horseshoe masonry tunnel portals + dark arched bore + overlying rock hill ridge.
export function buildTunnels(root, layout) {
  const list = layout.tunnels;
  if (!list || !list.length) return;
  const path = layout.path;
  const group = new THREE.Group();
  const bat = new Batcher();
  const boreGeo = new GeoAccum(false);
  const v = new THREE.Vector3();

  const boreMat = new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.95, side: THREE.DoubleSide });
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x3b4238, roughness: 0.94 });
  const portalMat = M.viaduct();

  for (const t of list) {
    const frames = [];
    const step = 12;
    for (let s = t.s0; s <= t.s1 + 0.01; s += step) {
      path.pointAt(s, 0, v);
      frames.push({ x: v.x, y: path.yAt(s), z: v.z, th: path.headingAt(s), s });
    }
    // Arched tunnel bore (wide enough for double track)
    const arch = [];
    const rx = 6.2, ry = 6.8;
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI;
      arch.push([Math.cos(a) * rx, 1.4 + Math.sin(a) * ry]);
    }
    arch.unshift([rx, -0.2]);
    arch.push([-rx, -0.2]);
    boreGeo.sweep(frames, arch, { uScale: 0.15, vScale: 0.15 });

    // Masonry tunnel portals at both ends + rock-hill mound covering the bore
    for (const endS of [t.s0, t.s1]) {
      path.pointAt(endS, 0, v);
      const y = path.yAt(endS), th = path.headingAt(endS);
      for (const side of [-1, 1]) {
        const px = v.x + Math.cos(th) * (side * 6.8);
        const pz = v.z - Math.sin(th) * (side * 6.8);
        bat.box(portalMat, px, y + 4.2, pz, 2.2, 8.8, 2.6, -th);
      }
      bat.box(portalMat, v.x, y + 8.6, v.z, 15.8, 2.2, 2.8, -th);
    }

    const midS = (t.s0 + t.s1) * 0.5;
    path.pointAt(midS, 0, v);
    const len = t.s1 - t.s0;
    const hill = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 22, len * 0.96, 10), hillMat);
    hill.rotation.x = Math.PI / 2;
    hill.rotation.z = -path.headingAt(midS);
    hill.scale.set(1.25, 1, 0.85);
    hill.position.set(v.x, path.yAt(midS) + 7.2, v.z);
    hill.castShadow = true; hill.receiveShadow = true;
    group.add(hill);
  }

  const bm = meshFrom(boreGeo, boreMat, { cast: false });
  if (bm) group.add(bm);
  group.add(bat.build());
  root.add(group);
}
