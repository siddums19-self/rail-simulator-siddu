import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collects many small static meshes and merges them per material, cutting
// draw calls from thousands to a handful per streamed chunk.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function normaliseGeometry(geo, needsColor) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(needsColor && name === 'color')) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  if (needsColor && !g.attributes.color) {
    const c = new Float32Array(g.attributes.position.count * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  g.clearGroups();
  return g;
}

export class Batcher {
  constructor() {
    this.buckets = new Map(); // material -> geometry[]
    this.castShadow = new Map();
  }

  // Add geometry with an explicit matrix.
  addMatrix(geometry, material, matrix, castShadow = true) {
    const g = normaliseGeometry(geometry, !!material.vertexColors);
    g.applyMatrix4(matrix);
    if (!this.buckets.has(material)) this.buckets.set(material, []);
    this.buckets.get(material).push(g);
    if (castShadow) this.castShadow.set(material, true);
  }

  // Convenience: position / euler rotation / scale.
  add(geometry, material, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, castShadow = true) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    this.addMatrix(geometry, material, _m, castShadow);
  }

  // Box helper: centre (x,y,z), size (w,h,d), yaw.
  box(material, x, y, z, w, h, d, ry = 0, castShadow = true, rx = 0, rz = 0) {
    this.add(unitBox(), material, x, y, z, rx, ry, rz, w, h, d, castShadow);
  }

  cyl(material, x, y, z, rTop, rBot, h, seg = 10, rx = 0, ry = 0, rz = 0, castShadow = true) {
    this.add(cylGeo(rTop, rBot, seg), material, x, y, z, rx, ry, rz, 1, h, 1, castShadow);
  }

  // Merge a whole Object3D hierarchy (meshes only) into the batch.
  addObject(obj, parentMatrix = null) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const m = o.matrixWorld.clone();
      if (parentMatrix) m.premultiply(parentMatrix);
      if (mats.length === 1) {
        this.addMatrix(o.geometry, mats[0], m, o.castShadow);
      } else if (o.geometry.groups.length) {
        for (const grp of o.geometry.groups) {
          const sub = subGeometry(o.geometry, grp);
          this.addMatrix(sub, mats[grp.materialIndex], m, o.castShadow);
        }
      }
    });
  }

  build(receiveShadow = true) {
    const group = new THREE.Group();
    for (const [mat, geos] of this.buckets) {
      if (!geos.length) continue;
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !!this.castShadow.get(mat);
      mesh.receiveShadow = receiveShadow;
      mesh.userData.disposable = true;
      group.add(mesh);
      for (const g of geos) if (g !== merged) g.dispose();
    }
    this.buckets.clear();
    return group;
  }
}

function subGeometry(geo, grp) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const size = attr.itemSize;
    const arr = attr.array.slice(grp.start * size, (grp.start + grp.count) * size);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

let _unitBox = null;
export function unitBox() {
  if (!_unitBox) _unitBox = new THREE.BoxGeometry(1, 1, 1);
  return _unitBox;
}

const cylCache = new Map();
export function cylGeo(rTop, rBot, seg = 10) {
  const k = `${rTop}|${rBot}|${seg}`;
  if (!cylCache.has(k)) cylCache.set(k, new THREE.CylinderGeometry(rTop, rBot, 1, seg));
  return cylCache.get(k);
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.userData && o.userData.disposable && o.geometry) o.geometry.dispose();
  });
  obj.removeFromParent();
}
