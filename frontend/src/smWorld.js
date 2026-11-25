import * as THREE from 'three/webgpu';
import { Lane } from './route/lane.js';
import { addTrackEntry, addTrackExit, playerMain } from './route/stationLayout.js';
import { TRACK } from './config.js';
import { SignalMast } from './world/signals.js';

// Station Master on the real railway: the station is the one the train simulator builds (same
// World, platforms, buildings, signals, sky) and the trains are the simulator's own consists,
// running on the station's real lanes (fans, crossovers) under the station master's routes.
//   side 0 = the end the route enters by (trains run towards increasing s, dir +1)
//   side 1 = the far end (dir -1). Termini have only side 0.

const H = TRACK.MAIN_HALF;
const RAKE = (tr) => tr.kind === 'goods' ? ['BOXN_GOODS', 30] : tr.kind === 'local' ? ['DEMU_PASSENGER', 8]
  : tr.kind === 'pass' ? ['DEMU_PASSENGER', 6] : /vande/i.test(tr.name) ? ['VANDE_BHARAT', 8] : tr.kind === 'vip' ? ['RAJDHANI', 14]
  : /duronto|duranto/i.test(tr.name) ? ['DURANTO', 14] : [Number(tr.no) < 17000 ? 'LHB' : 'ICF', 14];
const COL = { local: '#22c55e', pass: '#a3a3a3', exp: '#3b82f6', vip: '#f59e0b', goods: '#b45309' };
const V_IN = 40 / 3.6, V_OUT = 75 / 3.6, ACC = 0.55, BRK = 0.6;

// Which hubs to load so the station sits in the middle of a real route (entry side = SM left lines)
export const SM_ROUTES = {
  GTL: { src: 'RC', dst: 'ATP', via: ['GTL'] },
  SC: { src: 'WADI', dst: 'KZJ', via: ['SC'] },
  BZA: { src: 'VSKP', dst: 'MAS', via: ['BZA'] },
  SBC: { src: 'CBE', dst: 'ATP', via: ['SBC'] },
  MAS: { src: 'BZA', dst: 'MAS', via: [] },
  ATP: { src: 'SBC', dst: 'GTL', via: ['ATP'] },
  KZJ: { src: 'SC', dst: 'NZB', via: ['KZJ'] },
  CSMT: { src: 'KYN', dst: 'CSMT', via: [] }
};

export class SMWorld {
  constructor({ layout, world, scene, camera, makeConsist, code, labelRoot, audio = null }) {
    Object.assign(this, { layout, world, scene, camera, makeConsist, labelRoot, audio });
    this.path = layout.path;
    this.st = layout.stations.find((s) => s.code === code && !s.isOrigin) || layout.stations.find((s) => s.code === code);
    const st = this.st, L = st.layout;
    this.L = L;
    this.terminal = !!st.isDest;
    // clear the platforms: no stabled rakes from the simulator, the station master owns every line
    for (const occ of st.occupancy?.values() || []) occ.group?.removeFromParent();
    st.occupancy?.clear();
    this.sC = (L.pStart + L.pEnd) / 2;
    // the station's own lateral axis (t.o) can be mirrored against the route's: work in route laterals
    const lats = L.tracks.map((t) => t.lane.at(this.sC));
    this.latLo = Math.min(...lats); this.latHi = Math.max(...lats); this.latMid = (this.latLo + this.latHi) / 2;
    const byO = L.tracks.slice().sort((a, b) => a.o - b.o);
    this.mir = byO.length > 1 && byO.at(-1).lane.at(this.sC) < byO[0].lane.at(this.sC) ? -1 : 1;
    const pf1 = L.tracks.find((t) => t.pf === 1) || byO[0];
    this.bldgSide = Math.sign(pf1.lane.at(this.sC) - this.latMid) || 1; // PF 1 / station building side
    this.yC = this.path.groundAt ? this.path.groundAt(this.sC) : this.path.pointAt(this.sC, 0, new THREE.Vector3()).y;
    // main lines at each end: arrivals and departures (double line: one each way)
    const dbl = (line) => line === 'D';
    this.mainIn = [playerMain(L.entryLine), dbl(L.exitLine) ? H : 0];
    this.mainOut = [dbl(L.entryLine) ? H : 0, playerMain(L.exitLine)];
    // the station's own crossovers between the two mains, just outside each fan
    this.xoA = L.xoEntry ? [L.xoEntry.s0, L.xoEntry.s1] : [L.pStart - L.maxFanEntry - 120, L.pStart - L.maxFanEntry - 30];
    this.xoB = L.xoExit ? [L.xoExit.s0, L.xoExit.s1] : [L.pEnd + L.maxFanExit + 30, L.pEnd + L.maxFanExit + 120];
    // home signals where the simulator puts them; trains stand just short of them
    this.home = [(L.xoEntry ? L.xoEntry.s0 : L.pStart - L.maxFanEntry) - 90 - 12, (L.xoExit ? L.xoExit.s1 : L.pEnd + L.maxFanExit) + 90 + 12];
    this.rt = new Map();     // train id -> { consist, s, dir, v, lane, len }
    this.labels = new Map();
    // signals: the simulator's own home (side 0) and starters (towards side 1); we add the other direction's
    this.sig = world.stationSignals(st) || { starters: new Map() };
    this.extra = [];
    const mk = (kind, s, lat) => { const m = new SignalMast({ kind, height: kind === 'starter' ? 4.2 : undefined }).placeOnPath(this.path, s, lat); scene.add(m.group); this.extra.push(m); return m; };
    if (!this.sig.home) this.sig.home = mk('home', this.home[0] + 12, this.mainIn[0] - 3);
    if (!this.terminal) {
      this.home1 = mk('home', this.home[1] - 12, this.mainIn[1] + 3);
      this.home1.group.rotation.y += Math.PI;
      this.starters0 = new Map();
      for (const t of L.tracks) {
        const m = mk('starter', L.pStart - 12, t.lane.at(L.pStart) + this.mir * (t.pfSide === 'left' ? 2.35 : -2.35));
        m.group.rotation.y += Math.PI;
        this.starters0.set(t.no, m);
      }
    }
    this.view = 'tower'; this.yaw = 0; this.pitch = 0.25; this.dist = 520; this.fov = 52;
    this.target = this.path.pointAt(this.sC, this.latMid, new THREE.Vector3());
  }

  // tracks for the Station Master game: every line of the real station
  tracks() {
    const out = this.L.tracks.slice().sort((a, b) => a.o - b.o).map((t) => ({ pf: t.pf || null, label: t.pf ? `PF ${t.pf}` : t.name, occ: null, lt: t }));
    const n = {}, seen = {};
    for (const t of out) n[t.label] = (n[t.label] || 0) + 1;
    for (const t of out) if (n[t.label] > 1) { seen[t.label] = (seen[t.label] || 0) + 1; t.label = `${t.label} ${seen[t.label]}`; } // Goods Loop 1, 2, 3
    return out;
  }

  side(sm, lineId) { return this.terminal ? 0 : sm.lines[lineId].side; }
  trackLat(t) { return t.lane.at(this.sC); }

  _inLane(side, t) {
    const L = this.L, lane = new Lane(this.trackLat(t));
    if (side === 0) { addTrackEntry(lane, L, t); lane.add(this.xoA[0], this.xoA[1], this.mainIn[0], t.mEntry ?? this.mainIn[0]); }
    else { addTrackExit(lane, L, t); lane.add(this.xoB[0], this.xoB[1], t.mExit ?? this.mainIn[1], this.mainIn[1]); }
    return lane;
  }
  _outLane(side, t) {
    const L = this.L, lane = new Lane(this.trackLat(t));
    if (side === 1) { addTrackExit(lane, L, t); lane.add(this.xoB[0], this.xoB[1], t.mExit ?? this.mainOut[1], this.mainOut[1]); }
    else { addTrackEntry(lane, L, t); lane.add(this.xoA[0], this.xoA[1], this.mainOut[0], t.mEntry ?? this.mainOut[0]); }
    return lane;
  }

  _rt(sm, tr) {
    let r = this.rt.get(tr.id);
    if (!r) {
      const [rake, cars] = RAKE(tr);
      const c = this.makeConsist(rake, cars);
      this.scene.add(c.group);
      const side = this.side(sm, tr.from);
      r = { consist: c, len: c.length, dir: side === 0 ? 1 : -1, side, v: 0, lane: new Lane(this.mainIn[side]), s: this.home[side] };
      this.rt.set(tr.id, r);
      if (tr.track && (tr.state === 'dwell' || tr.state === 'ready')) { // already standing at its platform at the start
        const L = this.L, long = r.len > L.pLen - 30;
        r.lane = this._inLane(side, tr.track.lt);
        r.s = r.dir > 0 ? (this.terminal ? L.pEnd - 8 : long ? L.pEnd + 2 : L.pEnd - 14) : (long ? L.pStart - 2 : L.pStart + 14);
      }
    }
    return r;
  }

  // ------------------------------------------------------------ physics for the game's moves
  // Called by StationMaster each tick for every active move; returns progress 0..1 (1 = done).
  progress(sm, m, dt) {
    const tr = m.tr, r = this._rt(sm, tr), L = this.L;
    if (!m.init) {
      m.init = true;
      this._sound(m.dir === 'in' ? 'in' : 'out', r);
      if (m.dir === 'in') {
        r.lane = this._inLane(r.side, tr.track.lt);
        const long = r.len > L.pLen - 30;
        r.stop = r.dir > 0 ? (this.terminal ? L.pEnd - 8 : long ? L.pEnd + 2 : L.pEnd - 14) : (long ? L.pStart - 2 : L.pStart + 14);
        m.d0 = Math.abs(r.stop - r.s);
      } else {
        const outSide = this.side(sm, tr.to);
        if ((outSide === 0 ? -1 : 1) !== r.dir) { r.s -= r.dir * r.len; r.dir = -r.dir; } // reverses: the rear leads out
        r.lane = this._outLane(outSide, tr.track.lt);
        m.s0 = r.s;
      }
    }
    if (m.dir === 'in') {
      const left = (r.stop - r.s) * r.dir;
      const through = tr.through;
      const target = through ? V_IN : Math.min(V_IN, Math.sqrt(2 * BRK * Math.max(0, left)));
      r.v += Math.sign(target - r.v) * Math.min(Math.abs(target - r.v), (target > r.v ? ACC : BRK * 1.5) * dt);
      r.s += r.dir * Math.min(Math.max(0, left), r.v * dt);
      if (left <= 0.4 && (through || r.v < 0.3)) { if (!through) r.v = 0; return 1; }
      return Math.min(0.999, 1 - left / Math.max(1, m.d0));
    }
    r.v = Math.min(V_OUT, r.v + ACC * dt);
    r.s += r.dir * r.v * dt;
    const gone = Math.abs(r.s - m.s0) - r.len;
    return Math.min(1, Math.max(0, gone) / 900);
  }

  // ------------------------------------------------------------ per frame
  update(sm, dt = 0.016) {
    this._dt = dt;
    const live = new Set();
    // queues at the home signals (and trains still approaching, closing in)
    const q = [[], []];
    for (const tr of sm.trains) if (tr.state === 'home' || tr.state === 'approach') q[this.side(sm, tr.from)].push(tr);
    for (const side of [0, 1]) {
      const dir = side === 0 ? 1 : -1;
      q[side].sort((a, b) => (a.state === 'home' ? 0 : 1) - (b.state === 'home' ? 0 : 1) || b.wait - a.wait || a.eta - b.eta);
      let s = this.home[side];
      for (const tr of q[side]) {
        const r = this._rt(sm, tr); live.add(tr.id);
        r.lane = new Lane(this.mainIn[side]); r.dir = dir;
        r.s = tr.state === 'approach' ? s - dir * tr.eta * 22 : s;
        r.v = tr.state === 'approach' ? 22 : 0;
        s = r.s - dir * (r.len + 60);
      }
    }
    for (const tr of sm.trains) if (tr.track && tr.state !== 'home' && tr.state !== 'approach') { this._rt(sm, tr); live.add(tr.id); }
    for (const [id, r] of this.rt) {
      if (!live.has(id)) { r.consist.dispose(); this.rt.delete(id); continue; }
      r.consist.place(this.path, r.lane, r.s, r.dir);
    }
    // signals follow the routes the station master sets
    const inFrom = (side) => sm.moves.some((m) => m.dir === 'in' && this.side(sm, m.tr.from) === side && m.p < 1);
    this.sig.home?.set(inFrom(0) ? 'YELLOW' : 'RED');
    this.home1?.set(inFrom(1) ? 'YELLOW' : 'RED');
    for (const t of sm.tracks) {
      const out = sm.moves.find((m) => m.dir === 'out' && m.tr.track === t && m.p < 0.4);
      const side = out ? this.side(sm, out.tr.to) : -1;
      this.sig.starters?.get(t.lt.no)?.set(side === 1 ? 'GREEN' : 'RED');
      this.starters0?.get(t.lt.no)?.set(side === 0 ? 'GREEN' : 'RED');
    }
    this._routes(sm);
    this._camera(sm);
    this._labels(sm);
    this._rolling(dt);
  }

  _labels(sm) {
    if (!this.labelRoot) return;
    const W = this.labelRoot.clientWidth, H2 = this.labelRoot.clientHeight, v = new THREE.Vector3(), seen = new Set();
    this.camera.updateMatrixWorld();
    for (const tr of sm.trains) {
      const r = this.rt.get(tr.id);
      if (!r) continue;
      const sMid = r.s - r.dir * Math.min(70, r.len * 0.3);
      this.path.pointAt(sMid, r.lane.at(sMid), v); v.y += 7;
      v.project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      seen.add(tr.id);
      let el = this.labels.get(tr.id);
      if (!el) { el = document.createElement('div'); el.className = 'sm-tag'; el.dataset.id = tr.id; this.labelRoot.appendChild(el); this.labels.set(tr.id, el); }
      const st = tr.state === 'home' ? `waiting ${Math.round(tr.wait)}s` : tr.state === 'approach' ? `arrives in ${Math.floor(tr.eta / 60)}:${String(Math.round(tr.eta % 60)).padStart(2, '0')}` : tr.state === 'dwell' ? `${Math.ceil(tr.dwell)}s` : tr.state === 'ready' ? 'READY ▶ tap' : tr.state === 'in' ? 'entering' : 'leaving';
      const menu = sm.sel === tr && (tr.state === 'home' || tr.state === 'approach' || tr.state === 'in') ? `<div class="tag-menu">${sm.chooserHtml(tr)}${sm.statusHtml(tr)}</div>` : '';
      const html = `<b>${tr.no}</b> ${tr.name}<br><i>${st}${tr.track ? ` · ${tr.track.label}` : tr.pending ? ` → ${tr.pending.track.label}` : ''}</i>${menu}`;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
      el.style.borderColor = COL[tr.kind];
      el.classList.toggle('sel', sm.sel === tr);
      el.style.zIndex = sm.sel === tr ? 5 : 1;
      el.classList.toggle('ready', tr.state === 'ready');
      el.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H2}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }

  pick(sm, ndcX, ndcY) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = new THREE.Vector3();
    if (!rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.yC + 1.5)), hit)) return null;
    const n = this.path.nearest(hit.x, hit.z);
    let best = null;
    for (const tr of sm.trains) {
      const r = this.rt.get(tr.id);
      if (!r) continue;
      const lo = Math.min(r.s, r.s - r.dir * r.len), hi = Math.max(r.s, r.s - r.dir * r.len);
      if (n.s < lo - 5 || n.s > hi + 5) continue;
      const d = Math.abs(n.lat - r.lane.at(n.s));
      if (d < 3.2 && (!best || d < best.d)) best = { d, tr };
    }
    if (best) return { kind: 'train', tr: best.tr };
    if (n.s > this.L.pStart - 20 && n.s < this.L.pEnd + 20) {
      let bt = null;
      for (const t of sm.tracks) { const d = Math.abs(n.lat - t.lt.lane.at(n.s)); if (d < 2.6 && (!bt || d < bt.d)) bt = { d, t }; }
      if (bt) return { kind: 'track', track: bt.t };
    }
    return null;
  }

  // ------------------------------------------------------------ cameras
  _frame(s, lat, up = 0) { const p = this.path.pointAt(s, lat, new THREE.Vector3()); p.y = (this.path.groundAt ? this.path.groundAt(s) : p.y) + up; return p; }

  // Views. Tower / ends / follow / platform: drag looks around up to 135 deg either way (270 deg in all);
  // drone orbits freely. The camera eases towards its target every frame, so moves stay smooth.
  setView(v) {
    const L = this.L, mid = this.latMid, far = -this.bldgSide; // cameras stand on the open side, away from the building
    const edge = (side, off) => (side > 0 ? this.latHi + off : this.latLo - off);
    this.view = v;
    this.fov = 55;
    if (v === 'tower') {        // signal cabin beside the station, close and high enough to see every line
      this.anchor = { s: L.pStart + L.pLen * 0.05, lat: edge(far, 24), up: 19 };
      this.aim = { s: this.sC, lat: mid, up: 0 };
    } else if (v === 'end0' || v === 'end1') { // each throat: the points, home signal and approach
      const e = v === 'end0';
      this.anchor = { s: e ? L.pStart - L.maxFanEntry - 60 : L.pEnd + L.maxFanExit + 60, lat: edge(far, 18), up: 12 };
      this.aim = { s: e ? L.pStart - L.maxFanEntry * 0.35 : L.pEnd + L.maxFanExit * 0.35, lat: mid, up: 0 };
    } else if (v === 'platform') {
      const t = L.tracks.find((x) => x.pf === 1) || L.tracks.find((x) => x.pf) || L.tracks[0];
      const lat = t.lane.at(this.sC) + this.mir * (t.pfSide === 'left' ? -4.6 : 4.6);
      this.anchor = { s: L.pStart + L.pLen * 0.15, lat, up: 2.9 }; this.aim = { s: L.pEnd + 80, lat, up: 1.6 }; this.fov = 62;
    } else if (v === 'drone') { this.dist = Math.max(260, L.pLen * 0.75); this.orbit = 0.9; this.elev = 0.62; this.fov = 50; this.panS = 0; this.target = this.path.pointAt(this.sC, this.latMid, new THREE.Vector3()); }
    this.lookYaw = 0; this.lookPitch = 0; this.snap = true;
    this.camera.near = 0.4; this.camera.far = 7000; this.camera.updateProjectionMatrix();
  }

  drag(dx, dy) {
    if (this.view === 'drone') { this.orbit -= dx * 0.005; this.elev = Math.max(0.06, Math.min(1.45, this.elev + dy * 0.004)); return; }
    const lim = (135 * Math.PI) / 180;
    this.lookYaw = Math.max(-lim, Math.min(lim, this.lookYaw - dx * 0.004));
    this.lookPitch = Math.max(-0.5, Math.min(0.9, this.lookPitch - dy * 0.003));
  }
  // drone: slide along the station (left/right on screen), rotate, zoom
  pan(dx) {
    if (this.view !== 'drone') { this.lookYaw = Math.max(-2.36, Math.min(2.36, this.lookYaw - dx * 0.15)); return; }
    const L = this.L, lim = L.pLen / 2 + Math.max(L.maxFanEntry, L.maxFanExit) + 500;
    const th = this.path.headingAt(this.sC), right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const side = Math.sign(right.x * Math.sin(th) - right.z * Math.cos(th)) || 1; // screen-right along the track
    this.panS = Math.max(-lim, Math.min(lim, (this.panS || 0) + dx * 60 * side));
    this.target = this.path.pointAt(this.sC + this.panS, this.latMid, new THREE.Vector3());
  }
  rotate(d) { if (this.view === 'drone') this.orbit += d * 0.25; else this.lookYaw = Math.max(-2.36, Math.min(2.36, this.lookYaw + d * 0.25)); }
  zoom(d) {
    if (this.view === 'drone') this.dist = Math.max(60, Math.min(1300, this.dist * (1 + d * 0.001)));
    else this.fov = Math.max(14, Math.min(75, this.fov * (1 + d * 0.001)));
  }

  focus() { return this.view === 'drone' ? this.target : this.camera.position; } // scenery streams around what you look at

  // the train the follow camera tracks: the selected one, else whatever is moving, else the newest
  _followTarget(sm) {
    const pick = (t) => t && this.rt.get(t.id);
    return pick(sm.sel) || pick(sm.moves.at(-1)?.tr) || pick(sm.trains.find((t) => t.state === 'home')) || null;
  }

  _camera(sm) {
    const c = this.camera, L = this.L;
    let eye, look;
    if (this.view === 'drone') {
      const t = this.target, e = this.elev;
      eye = new THREE.Vector3(t.x + Math.cos(this.orbit) * Math.cos(e) * this.dist, t.y + Math.sin(e) * this.dist, t.z + Math.sin(this.orbit) * Math.cos(e) * this.dist);
      look = t.clone();
    } else {
      let a = this.anchor, b = this.aim;
      const far = -this.bldgSide, edge = (side, off) => (side > 0 ? this.latHi + off : this.latLo - off);
      if (this.view === 'follow') {
        const r = this._followTarget(sm);
        if (r) {
          const sMid = r.s - r.dir * r.len * 0.5, lat = r.lane.at(sMid);
          a = { s: sMid - r.dir * (r.len * 0.5 + 70), lat: edge(far, 20), up: 13 };
          b = { s: sMid + r.dir * 30, lat, up: 2 };
        } else { a = { s: L.pStart - 120, lat: edge(-this.bldgSide, 20), up: 14 }; b = { s: this.sC, lat: this.latMid, up: 0 }; }
      }
      eye = this._frame(a.s, a.lat, a.up);
      look = this._frame(b.s, b.lat, b.up);
      // look-around: rotate the view direction about the eye (yaw) and tilt it (pitch)
      const d = look.clone().sub(eye), len = d.length();
      d.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw);
      const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      d.applyAxisAngle(right, -this.lookPitch);
      look = eye.clone().add(d.setLength(len));
    }
    // ease (frame-rate independent) so the follow camera and view switches glide instead of jumping
    const k = this.snap ? 1 : 1 - Math.exp(-(this._dt || 0.016) * (this.view === 'follow' ? 3.5 : 9));
    this.snap = false;
    this._eye = this._eye ? this._eye.lerp(eye, k) : eye.clone();
    this._look = this._look ? this._look.lerp(look, k) : look.clone();
    c.position.copy(this._eye);
    c.lookAt(this._look);
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov += (this.fov - c.fov) * Math.min(1, k * 2); c.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------ roofs and route strips
  setRoofs(on) { const o = this.world.stationObjs?.get(this.st.index); if (o?.roof) o.roof.visible = on; this.roofs = on; }

  _strip(lane, a, b, color) {
    const s0 = Math.min(a, b), s1 = Math.max(a, b), n = Math.max(2, Math.ceil((s1 - s0) / 3) + 1);
    const pos = new Float32Array(n * 6), idx = [], p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const sx = s0 + ((s1 - s0) * i) / (n - 1), lat = lane.at(sx);
      for (const [k, o] of [[0, -1.9], [1, 1.9]]) { // a bit wider than the track: readable from the tower and the drone
        this.path.pointAt(sx, lat + o, p);
        pos.set([p.x, p.y + TRACK.RAIL_TOP + 0.12, p.z], i * 6 + k * 3);
      }
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.renderOrder = 5; m.frustumCulled = false;
    this.scene.add(m);
    return m;
  }

  _routes(sm) {
    this.strips ||= new Map();
    const want = new Map(), L = this.L, pulse = 0.35 + 0.3 * Math.sin(performance.now() / 180);
    const stopOf = (side) => (side === 0 ? L.pEnd - 14 : L.pStart + 14);
    for (const tr of sm.trains) {
      const p = tr.pending;
      if (p && (tr.state === 'home' || tr.state === 'approach')) {
        const side = this.side(sm, tr.from);
        want.set(`p${tr.id}:${p.track.lt.no}:${p.locked}`, { lane: () => this._inLane(side, p.track.lt), a: this.home[side], b: stopOf(side), color: p.locked ? 0xf97316 : 0xfacc15, op: p.locked ? 0.75 : 0.35 + pulse });
      }
    }
    for (const m of sm.moves) {
      const r = this.rt.get(m.tr.id);
      if (!r || !m.init) continue;
      if (m.dir === 'in') want.set(`i${m.tr.id}`, { lane: () => r.lane, a: this.home[r.side] - r.dir * 10, b: r.stop, color: 0x22c55e, op: 0.7 });
      else if (m.p < 0.6) want.set(`o${m.tr.id}`, { lane: () => r.lane, a: m.s0, b: m.s0 + r.dir * 700, color: 0x22c55e, op: 0.7 });
    }
    const sel = sm.sel;
    if (sel && !sel.pending && (sel.state === 'home' || sel.state === 'approach')) {
      for (const t of sm.tracks) if (!sm._allowed(sel, t)) want.set(`s${sel.id}:${t.lt.no}:${sel.through}`, { lane: () => t.lt.lane, a: L.pStart + 6, b: L.pEnd - 6, color: 0x22d3ee, op: 0.4 + pulse * 0.35 });
    }
    for (const [k, m] of this.strips) if (!want.has(k)) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); this.strips.delete(k); }
    for (const [k, w] of want) {
      let m = this.strips.get(k);
      if (!m) { m = this._strip(w.lane(), w.a, w.b, w.color); this.strips.set(k, m); }
      m.material.opacity = w.op;
    }
  }

  // ------------------------------------------------------------ sound
  _sound(what, r) {
    const a = this.audio;
    if (!a || !a.enabled) return;
    const p = this.path.pointAt(r.s, r.lane.at(r.s), new THREE.Vector3());
    const d = p.distanceTo(this.camera.position), g = Math.max(0.08, Math.min(0.5, 220 / (d + 60)));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const pan = Math.max(-0.9, Math.min(0.9, p.clone().sub(this.camera.position).normalize().dot(right)));
    if (what === 'in') { a.pointThrow?.(Math.min(0.4, g)); setTimeout(() => a.distantHorn(g, pan), 900); }
    else a.distantHorn(g * 0.9, pan);
  }

  // rolling / passing-train roar of the nearest moving train, heard where the camera is
  _rolling(dt) {
    const a = this.audio;
    if (!a || !a.ctx) return;
    const cam = this.camera.position, p = new THREE.Vector3(), right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    let best = null;
    for (const r of this.rt.values()) {
      if (r.v < 1) continue;
      for (const f of [0, 0.5, 1]) {
        const sx = r.s - r.dir * r.len * f;
        this.path.pointAt(sx, r.lane.at(sx), p);
        const d = p.distanceTo(cam);
        if (!best || d < best.dist) best = { dist: d, speed: r.v, side: Math.max(-1, Math.min(1, p.clone().sub(cam).normalize().dot(right))) };
      }
    }
    a.update(dt, { speedKmph: 0, notch: 0, brake: 0, traction: 'electric', onTurnout: false, interior: false, distanceStep: 0, weather: 'CLEAR', passing: best });
  }

  dispose() {
    for (const m of this.strips?.values() || []) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
    this.setRoofs(true);
    for (const r of this.rt.values()) r.consist.dispose();
    this.rt.clear();
    for (const m of this.extra) m.group.removeFromParent();
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
  }
}
