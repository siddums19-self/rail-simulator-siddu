import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Camera modes. Orbit modes use OrbitControls attached to the moving train:
// each frame the anchor's movement (and heading change) is applied to both
// camera and target, so left-drag orbits 360°, wheel zooms and right-drag pans
// while the train runs at full speed.

export const CAMERA_MODES = [
  { id: 'cab', label: '1. Front view (driver\'s eye)', kind: 'look' },
  { id: 'chase', label: '2. Chase (orbit 360°)', kind: 'orbit', offset: [9, 6.5, 30], target: 'lead', follow: true },
  { id: 'bogie', label: '3. Bogie close-up', kind: 'orbit', offset: [4.2, 1.1, -3], target: 'leadBogie', follow: true },
  { id: 'trackside', label: '4. Trackside railfan', kind: 'trackside' },
  { id: 'window', label: '5. Passenger window', kind: 'look' },
  { id: 'drone', label: '6. Drone / aerial', kind: 'orbit', offset: [70, 85, 90], target: 'mid', follow: true },
  { id: 'free', label: '7. Free orbit (world)', kind: 'orbit', offset: [40, 22, 40], target: 'mid', follow: false },
  { id: 'guard', label: '8. Guard (rear cabin)', kind: 'look' },
  { id: 'crew', label: '9. Cab interior (crew)', kind: 'look' }
];

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera, dom, heightAt) {
    this.camera = camera;
    this.dom = dom;
    this.heightAt = heightAt;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 900;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.zoomSpeed = 1.1;
    this.controls.rotateSpeed = 1.15; // a comfortable full 360° in one or two drags
    this.controls.screenSpacePanning = true;
    this.controls.enableZoom = false; // wheel handled below (mouse wheel, trackpad pinch/swipe)
    this.held = new Set();            // keyboard / on-screen pad actions being held
    this.mode = 1;
    this.anchor = new THREE.Vector3();
    this.lastAnchor = null;
    this.lastHeading = 0;
    this.panOffset = new THREE.Vector3();
    this.look = { yaw: 0, pitch: -0.04, dragging: false, fov: 62 };
    this.track = null;
    this.xrRig = null;
    this.xrActive = false;
    this._bindLook();
  }

  setXrRig(rig) { this.xrRig = rig; }

  _bindLook() {
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      if (CAMERA_MODES[this.mode].kind !== 'look') return;
      this.look.dragging = true; this.look.px = e.clientX; this.look.py = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.look.dragging) return;
      this.look.yaw -= (e.clientX - this.look.px) * 0.0065;
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - (e.clientY - this.look.py) * 0.0036, -1.2, 1.0);
      this.look.px = e.clientX; this.look.py = e.clientY;
    });
    const up = () => { this.look.dragging = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = CAMERA_MODES[this.mode].kind;
      // Trackpads send pixel deltas (often fractional / with deltaX); mouse wheels send large steps.
      const trackpad = e.deltaMode === 0 && (Math.abs(e.deltaX) > 0.5 || Math.abs(e.deltaY) < 40 || !Number.isInteger(e.deltaY));
      if (k === 'look' || k === 'trackside') {
        if (e.ctrlKey || !trackpad) this.look.fov = THREE.MathUtils.clamp(this.look.fov + e.deltaY * (e.ctrlKey ? 0.15 : 0.03), 18, 80);
        else { this.look.yaw -= e.deltaX * 0.004; this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - e.deltaY * 0.003, -1.2, 1.0); }
        return;
      }
      if (e.ctrlKey) this.zoom(Math.exp(e.deltaY * 0.01));            // pinch
      else if (e.shiftKey) this.pan(e.deltaX * 0.6, e.deltaY * 0.6);    // shift + swipe
      else if (trackpad) this.orbit(e.deltaX * 0.005, e.deltaY * 0.004); // two-finger swipe
      else this.zoom(Math.exp(e.deltaY * 0.0015));                      // mouse wheel
    }, { passive: false });
    el.addEventListener('dblclick', () => this.reset());
  }

  // ---- manual camera moves (trackpad, keyboard, on-screen pad) ----
  orbit(dTheta, dPhi) {
    const m = CAMERA_MODES[this.mode];
    if (m.kind === 'look') { this.look.yaw -= dTheta; this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - dPhi, -1.2, 1.0); return; }
    if (m.kind !== 'orbit') return;
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= dTheta;
    sph.phi = THREE.MathUtils.clamp(sph.phi + dPhi, 0.05, this.controls.maxPolarAngle);
    this.camera.position.copy(t).add(off.setFromSpherical(sph));
  }

  zoom(factor) {
    const m = CAMERA_MODES[this.mode];
    if (m.kind !== 'orbit') { this.look.fov = THREE.MathUtils.clamp(this.look.fov * factor, 18, 80); return; }
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t);
    const d = THREE.MathUtils.clamp(off.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(t).add(off.setLength(d));
  }

  pan(dx, dy) {
    if (CAMERA_MODES[this.mode].kind !== 'orbit') return;
    const t = this.controls.target;
    const dist = this.camera.position.distanceTo(t);
    const k = dist * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(-dx * k).add(up.multiplyScalar(dy * k));
    t.add(move);
    this.camera.position.add(move);
    this.panOffset.add(move);
  }

  _applyHeld(dt) {
    if (!this.held.size) return;
    const r = 1.6 * dt, p = 260 * dt;
    if (this.held.has('left')) this.orbit(-r, 0);
    if (this.held.has('right')) this.orbit(r, 0);
    if (this.held.has('up')) this.orbit(0, -r * 0.7);
    if (this.held.has('down')) this.orbit(0, r * 0.7);
    if (this.held.has('in')) this.zoom(Math.exp(-1.6 * dt));
    if (this.held.has('out')) this.zoom(Math.exp(1.6 * dt));
    if (this.held.has('panL')) this.pan(-p, 0);
    if (this.held.has('panR')) this.pan(p, 0);
    if (this.held.has('panU')) this.pan(0, p);
    if (this.held.has('panD')) this.pan(0, -p);
  }

  setMode(i) {
    this.mode = (i + CAMERA_MODES.length) % CAMERA_MODES.length;
    this.reset();
  }

  reset() {
    const m = CAMERA_MODES[this.mode];
    this.controls.enabled = m.kind === 'orbit';
    this.lastAnchor = null;
    this.panOffset.set(0, 0, 0);
    this.look.yaw = m.id === 'window' ? -Math.PI / 2 : m.id === 'guard' ? Math.PI : 0;
    this.look.pitch = m.id === 'window' ? -0.05 : -0.04;
    this.look.fov = m.id === 'window' ? 58 : 62;
    this.track = null;
    this._needsPlace = true;
  }

  // state: { lead (vehicle), mid (vehicle), heading, sFront, path, lane, window (vehicle) }
  update(dt, state) {
    const m = CAMERA_MODES[this.mode];
    this._applyHeld(dt);
    const cam = this.camera;
    const xr = this.xrActive && this.xrRig;
    const poseTarget = xr ? this.xrRig : cam;
    if (!xr && this.xrRig) { this.xrRig.position.set(0, 0, 0); this.xrRig.quaternion.identity(); }
    if (m.kind === 'look') {
      const veh = m.id === 'cab' || m.id === 'crew' ? state.lead : m.id === 'guard' ? (state.tail || state.window) : state.window;
      const local = m.id === 'cab' ? (veh.cabEyeDriver || veh.cabEye || new THREE.Vector3(-0.6, 3.0, -veh.length / 2 + 1.5))
        : m.id === 'crew' ? (veh.cabEye || new THREE.Vector3(0, 3.2, -veh.length / 2 + 2.4))
        : m.id === 'guard' ? (veh.guardEye || new THREE.Vector3(0, 2.7, veh.length / 2 - 2.4)) : new THREE.Vector3(1.05, 2.45, 0);
      veh.group.updateMatrixWorld();
      poseTarget.position.copy(local).applyMatrix4(veh.group.matrixWorld);
      if (xr) poseTarget.position.y -= 1.45; // compensate for standing/seated VR headset height
      veh.group.getWorldQuaternion(_q);
      if (xr) {
        poseTarget.quaternion.copy(_q);
      } else {
        _e.set(this.look.pitch, this.look.yaw, 0, 'YXZ');
        cam.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromEuler(_e));
        this._setFov(this.look.fov, cam);
        cam.near = 0.08;
        cam.updateProjectionMatrix();
      }
      return;
    }
    if (!xr) cam.near = 0.3;
    if (m.kind === 'trackside') {
      const ahead = state.sFront + 320;
      if (!this.track || state.sFront > this.track.s + 160 || state.sFront < this.track.s - 700) {
        const side = state.lane.at(ahead) > 0 ? 1 : -1;
        const lat = state.lane.at(ahead) + side * 14;
        const p = state.path.pointAt(ahead, lat, new THREE.Vector3());
        p.y = Math.max(p.y, this.heightAt(p.x, p.z)) + 1.7;
        this.track = { s: ahead, p };
      }
      poseTarget.position.copy(this.track.p);
      if (xr) poseTarget.position.y -= 1.45;
      state.mid.group.getWorldPosition(_v);
      state.lead.group.getWorldPosition(this.anchor);
      _v.lerp(this.anchor, 0.6);
      _v.y += 2.2;
      poseTarget.lookAt(_v);
      if (!xr) {
        this._setFov(this.look.fov * 0.8, cam);
        cam.updateProjectionMatrix();
      }
      return;
    }
    // orbit modes
    const tgtVeh = m.target === 'mid' ? state.mid : state.lead;
    tgtVeh.group.updateMatrixWorld();
    if (m.target === 'leadBogie') this.anchor.set(0, 1.0, -tgtVeh.bogieHalf).applyMatrix4(tgtVeh.group.matrixWorld);
    else this.anchor.set(0, 2.6, 0).applyMatrix4(tgtVeh.group.matrixWorld);
    const heading = state.heading;
    if (this._needsPlace || !this.lastAnchor) {
      _v.set(...m.offset);
      _v.applyAxisAngle(UP, -heading);
      poseTarget.position.copy(this.anchor).add(_v);
      this.controls.target.copy(this.anchor);
      this.lastAnchor = this.anchor.clone();
      this.lastHeading = heading;
      this._needsPlace = false;
    } else {
      // carry pan offset + camera with the moving anchor
      const target = _v.copy(this.anchor).add(this.panOffset);
      const delta = target.clone().sub(this.controls.target);
      poseTarget.position.add(delta);
      this.controls.target.copy(target);
      if (m.follow) {
        let dh = heading - this.lastHeading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        if (Math.abs(dh) > 1e-6) {
          const off = poseTarget.position.clone().sub(this.controls.target).applyAxisAngle(UP, -dh);
          poseTarget.position.copy(this.controls.target).add(off);
          this.panOffset.applyAxisAngle(UP, -dh);
        }
      }
      this.lastHeading = heading;
    }
    if (xr) {
      poseTarget.lookAt(this.controls.target);
      return;
    }
    this._setFov(55, cam);
    this.controls.update(dt);
    this.panOffset.copy(this.controls.target).sub(this.anchor);
    // keep the camera above ground
    const gh = this.heightAt(cam.position.x, cam.position.z) + 1.2;
    if (cam.position.y < gh) cam.position.y = gh;
    cam.updateProjectionMatrix();
  }

  _setFov(f, cam) {
    if (Math.abs(cam.fov - f) > 0.01) cam.fov += (f - cam.fov) * 0.25;
  }
}
