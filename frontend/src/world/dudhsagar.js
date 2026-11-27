import * as THREE from 'three/webgpu';
import { M } from '../core/materials.js';
import { Batcher } from '../core/batcher.js';

// Iconic Dudhsagar Waterfall cascading down the Western Ghats rock face beside DDS station.
export function buildDudhsagar(st, layout, root) {
  if (st.code !== 'DDS') return;
  const L = st.layout;
  const path = layout.path;
  const side = -1; // left side of the ghat cliff
  const p = path.pointAt(L.sCenter, 0, new THREE.Vector3());
  const th = path.headingAt(L.sCenter);
  const y0 = path.yAt(L.sCenter);

  const group = new THREE.Group();
  group.position.copy(p);
  group.rotation.y = -th;

  const bat = new Batcher();
  const rock = M.plaster(0x4b5563);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0xe0f2fe,
    emissive: 0xbae6fd,
    emissiveIntensity: 0.35,
    roughness: 0.15,
    transparent: true,
    opacity: 0.88
  });
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, transparent: true, opacity: 0.85 });

  // Cliff face & stepped rock ledges
  const cliffX = side * 38;
  bat.box(rock, cliffX - side * 12, y0 + 26, 0, 24, 56, 70);
  bat.box(rock, cliffX - side * 4, y0 + 14, -8, 12, 32, 38);

  // Cascading white-water tiers ("Sea of Milk")
  bat.box(waterMat, cliffX + side * 1.5, y0 + 28, 0, 3.2, 46, 16, 0, false, 0, side * 0.14);
  bat.box(waterMat, cliffX + side * 4.5, y0 + 12, 3, 4.2, 24, 22, 0, false, 0, side * 0.18);
  bat.box(poolMat, cliffX + side * 10, y0 - 1.5, 2, 18, 0.8, 32, 0, false);

  // Mist cloud at base
  const mist = new THREE.Mesh(
    new THREE.SphereGeometry(10, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.35, roughness: 1 })
  );
  mist.scale.set(1.2, 0.55, 1.8);
  mist.position.set(cliffX + side * 9, y0 + 2.5, 2);
  group.add(mist);

  group.add(bat.build());
  root.add(group);
}
