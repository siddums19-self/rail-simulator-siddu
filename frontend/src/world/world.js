import * as THREE from 'three/webgpu';
import { STREAM, TRACK } from '../config.js';
import { Lane } from '../route/lane.js';
import { playerMain } from '../route/stationLayout.js';
import { Batcher, disposeObject } from '../core/batcher.js';
import { TrackChunkBuilder, laneFrames, buildOHE, buildFormation, buildBufferStop, polylineFrames } from './trackBuilder.js';
import { makeRng, smoothstep } from '../core/rng.js';
import { Terrain } from './terrain.js';
import { PropBuilder } from './props.js';
import { buildStation } from './station.js';
import { buildGtlJunction } from './gtlJunction.js';
import { SignalMast } from './signals.js';
import { animatePerson } from './people.js';
import { TurnoutManager } from './turnouts.js';
import { M } from '../core/materials.js';

const constLanes = new Map();
const constLane = (v) => { if (!constLanes.has(v)) constLanes.set(v, new Lane(v)); return constLanes.get(v); };

export class World {
  constructor(scene, layout, { seedKey, density = 0.8 }) {
    this.scene = scene;
    this.layout = layout;
    this.seedKey = seedKey;
    this.density = density;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.chunks = new Map();
    this.stationObjs = new Map();
    this.people = [];
    this.rotors = [];
    this.stationLights = [];

    const flat = [];
    this.gtl = layout.gtl ? buildGtlJunction(layout, { seedKey, terrainFlat: flat }) : null;
    if (this.gtl) this.root.add(this.gtl.group);
    this.terrain = new Terrain(this.root, layout, this.gtl ? this.gtl.index : null, flat);
    this.props = new PropBuilder({
      layout, terrain: this.terrain, seedKey, density,
      exclusion: this.gtl ? this.gtl.exclusion : null,
      rotors: this.rotors,
      lcs: []
    });
    this.lcs = this.props.ctx.lcs;
    if (this.gtl && this.gtl.lcS) { // manned level crossing on the VV Nagar road
      const bat = new Batcher();
      this.props._frameNotes ||= [];
      this.props._levelCrossing(this.gtl.group, bat, this.gtl.lcS, () => 0.5, { manned: true, halfLen: 140 });
      this.gtl.group.add(bat.build());
    }
    this._buildRouteEnds();
    this.turnouts = new TurnoutManager(layout, this.root);
    this.lightPool = [];
    // warm sodium-vapour yard lights
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffc27a, 0, 140, 1.4); this.scene.add(l); this.lightPool.push(l); }
  }

  // Intermediate block signals stream in/out like turnouts.
  setBlockSignals(list) { this.ibs = list; }

  _streamIbs(sFocus) {
    for (const sg of this.ibs || []) {
      const near = sg.s > sFocus - 900 && sg.s < sFocus + 4200;
      if (near && !sg.mesh) {
        sg.mesh = new SignalMast({ kind: 'home', height: 5.6 }).placeOnPath(this.layout.path, sg.s, sg.lat);
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), M.textBoard('A', { bg: '#f8f8f0', fg: '#111', w: 64, h: 64, font: 'bold 44px Arial' }));
        plate.position.set(0, 3.2, 0.13);
        plate.userData.disposable = true;
        sg.mesh.group.add(plate);
        this.root.add(sg.mesh.group);
      } else if (!near && sg.mesh) {
        sg.mesh.group.removeFromParent();
        sg.mesh = null;
      }
    }
  }

  // Points (switch blades) follow the player's route; returns nothing.
  updateSwitches(sFront, playerLane, dt, onThrow) {
    this.turnouts.update(sFront, playerLane, dt, onThrow);
  }

  pointsMovingAt(st) {
    const S = st.layout;
    return this.turnouts.list.some((T) => T.obj && T.open !== T.target && T.s1 > S.zoneStart - 250 && T.s0 < S.zoneEnd + 250);
  }

  _buildRouteEnds() {
    const L = this.layout;
    const bat = new Batcher();
    const first = L.stations[0].layout, last = L.stations[L.stations.length - 1].layout;
    for (const t of first.tracks) if (t.fanEntry === 0) buildBufferStop(bat, L.path, first.zoneStart - 380, t.o, -1);
    const lines = first.entryLine === 'D' ? [-TRACK.MAIN_HALF, TRACK.MAIN_HALF] : [0];
    for (const o of lines) buildBufferStop(bat, L.path, 30, o, -1);
    const endLines = last.exitLine === 'D' ? [-TRACK.MAIN_HALF, TRACK.MAIN_HALF] : [0];
    for (const o of endLines) buildBufferStop(bat, L.path, L.total - 30, o, 1);
    this.root.add(bat.build());
  }

  // ------------------------------------------------------------ lane segments
  laneSegments(a, b) {
    const L = this.layout;
    const segs = [];
    const push = (lane, s0, s1) => {
      const x0 = Math.max(a, s0), x1 = Math.min(b, s1);
      if (x1 - x0 > 0.5) segs.push({ lane, s0: x0, s1: x1 });
    };
    const mains = (line) => (line === 'D' ? [-TRACK.MAIN_HALF, TRACK.MAIN_HALF] : [0]);
    for (const g of L.gaps) {
      if (g.s1 < a || g.s0 > b) continue;
      for (const o of mains(g.line)) push(constLane(o), g.s0, g.s1);
    }
    const first = L.stations[0].layout, last = L.stations[L.stations.length - 1].layout;
    for (const o of mains(first.entryLine)) push(constLane(o), 30, first.zoneStart);
    for (const o of mains(last.exitLine)) push(constLane(o), last.zoneEnd, L.total - 30);
    for (const st of L.stations) {
      const S = st.layout;
      if (S.zoneEnd < a || S.zoneStart > b) continue;
      for (const t of S.tracks) push(t.lane, t.spanStart, t.spanEnd);
      // main-line stubs where no platform track sits exactly on a running line
      for (const [line, from, to, key] of [[S.entryLine, S.zoneStart, null, 'mEntry'], [S.exitLine, null, S.zoneEnd, 'mExit']]) {
        for (const m of mains(line)) {
          if (S.tracks.some((t) => Math.abs(t.o - m) < 0.01)) continue;
          const feeders = S.tracks.filter((t) => Math.abs(t[key] - m) < 0.01);
          if (!feeders.length) continue;
          if (key === 'mEntry') push(constLane(m), from, Math.max(...feeders.map((t) => S.pStart - t.fanEntry)) + 1);
          else push(constLane(m), Math.min(...feeders.map((t) => S.pEnd + t.fanExit)) - 1, to);
        }
      }
      if (S.xoEntry) push(new Lane(-TRACK.MAIN_HALF).add(S.xoEntry.s0, S.xoEntry.s1, -TRACK.MAIN_HALF, TRACK.MAIN_HALF), S.xoEntry.s0 - 1, S.xoEntry.s1 + 1);
      if (S.xoExit) push(new Lane(TRACK.MAIN_HALF).add(S.xoExit.s0, S.xoExit.s1, TRACK.MAIN_HALF, -TRACK.MAIN_HALF), S.xoExit.s0 - 1, S.xoExit.s1 + 1);
    }
    return segs;
  }

  _buildChunk(idx) {
    const a = idx * STREAM.CHUNK, b = Math.min(this.layout.total, a + STREAM.CHUNK);
    const group = new THREE.Group();
    const segs = this.laneSegments(a, b);
    const tb = new TrackChunkBuilder();
    for (const sg of segs) {
      sg.frames = laneFrames(this.layout.path, sg.lane, sg.s0, sg.s1);
      tb.addTrack(sg.frames);
    }
    tb.build(group);
    const gtl = this.gtl;
    const inGtl = (s) => this.layout.gtl && s > this.layout.gtl.s0 - 50 && s < this.layout.gtl.s1 + 50;
    buildOHE(group, this.layout.path, this.layout, a, b, segs, { skipMast: gtl ? gtl.skipMast : null });
    buildFormation(group, this.layout.path, this.layout, a, b, {
      skipPier: gtl ? gtl.skipPier : null, walled: inGtl,
      // Guntakal flyover: a walled (retaining-wall) embankment, with a bridge only over the Bellary line
      deckMinH: (s) => (inGtl(s) ? (gtl && s > gtl.bridgeA && s < gtl.bridgeB ? 1.0 : 99) : 3.6),
      embMax: (s) => (inGtl(s) ? (gtl && s > gtl.bridgeA && s < gtl.bridgeB ? 0.9 : 30) : 5.2),
      pierSpacing: (s) => (inGtl(s) ? 24 : 30)
    });
    this.props.build(group, idx, a, b);
    this.root.add(group);
    return group;
  }

  // ------------------------------------------------------------ stations
  // Extra running lines and sidings beyond the station throats so every station
  // is different: quadrupled lines out of metros, an extra running line at
  // junctions, dead-end sidings / engine necks at smaller stations.
  _decorTracks(st, root) {
    const L = this.layout, S = st.layout, path = L.path;
    if (st.code === 'GTL' && L.gtl) return;
    const rand = makeRng(this.seedKey, 'decor', st.code);
    const tb = new TrackChunkBuilder();
    const bat = new Batcher();
    const sm = (x, a, b) => smoothstep(a, b, x);
    const prev = L.stations[st.index - 1], next = L.stations[st.index + 1];
    const ends = [
      { s0: S.pEnd + S.maxFanExit, dir: 1, line: S.exitLine, limit: next ? next.layout.zoneStart - 80 : L.total - 60 },
      { s0: S.pStart - S.maxFanEntry, dir: -1, line: S.entryLine, limit: prev ? prev.layout.zoneEnd + 80 : 60 }
    ];
    const add = (e, side, base, len, kind) => {
      const pts = [];
      for (let d = 0; d <= len; d += 4) {
        const sv = e.s0 + e.dir * d;
        if ((e.dir > 0 && sv > e.limit) || (e.dir < 0 && sv < e.limit)) break;
        if (Math.abs(path.yAt(sv) - path.groundAt(sv)) > 0.5) break; // stay on the flat formation
        let lat;
        if (kind === 'siding') lat = side * (base - 5.3 + 5.3 * sm(d, 0, 90));
        else lat = side * (base - 5.3 * sm(d, len - 240, len));
        const p = path.pointAt(sv, lat, new THREE.Vector3());
        const th = path.headingAt(sv) + (e.dir > 0 ? 0 : Math.PI);
        pts.push({ x: p.x, y: path.yAt(sv), z: p.z, th, s: sv, lat });
      }
      if (pts.length < 20) return;
      tb.addTrack(polylineFrames(pts));
      if (kind === 'siding') { const q = pts[pts.length - 1]; buildBufferStop(bat, path, q.s, q.lat, e.dir); }
    };
    for (const e of ends) {
      const main = e.line === 'D' ? TRACK.MAIN_HALF : 0;
      const base = main + 5.3;
      const side = rand() < 0.5 ? -1 : 1;
      if (st.category === 'metro') { // quadrupled section
        add(e, -1, base, 900 + rand() * 900, 'run');
        add(e, 1, base, 900 + rand() * 900, 'run');
        if (rand() < 0.6) add(e, side, base + 5.3, 260 + rand() * 200, 'siding');
      } else if (st.category === 'junction') {
        add(e, side, base, 500 + rand() * 700, 'run');
        if (rand() < 0.5) add(e, -side, base, 220 + rand() * 180, 'siding');
      } else if (S.N >= 2 && rand() < 0.45) {
        add(e, side, base, 180 + rand() * 220, 'siding');
      }
    }
    tb.build(root);
    root.add(bat.build());
  }

  _buildStationObj(st) {
    const L = this.layout;
    const res = buildStation(st, L, { seedKey: this.seedKey, density: this.density, people: [] });
    const S = st.layout;
    const path = L.path;
    // signals
    const signals = { starters: new Map() };
    if (!st.isOrigin) {
      const sHome = (S.xoEntry ? S.xoEntry.s0 : S.pStart - S.maxFanEntry) - 90;
      const latHome = playerMain(S.entryLine) - 3.0;
      signals.home = new SignalMast({ kind: 'home', featherSide: 'both' }).placeOnPath(path, sHome, latHome);
      res.root.add(signals.home.group);
      const prev = L.stations[st.index - 1];
      const sDist = sHome - 1000;
      if (!prev || sDist > prev.layout.zoneEnd + 60) {
        signals.distant = new SignalMast({ kind: 'distant' }).placeOnPath(path, sDist, latHome);
        res.root.add(signals.distant.group);
      }
    }
    if (!st.isDest) {
      for (const t of S.tracks) {
        const lat = t.o + (t.pfSide === 'left' ? -2.35 : 2.35);
        const m = new SignalMast({ kind: 'starter', height: 4.2 }).placeOnPath(path, S.pEnd + 12, lat);
        res.root.add(m.group);
        signals.starters.set(t.no, m);
      }
    }
    // floodlight anchor points; the actual lights come from a fixed pool (see _lightPool)
    const lights = [];
    for (const ds of [-S.pLen * 0.2, S.pLen * 0.2]) {
      const p = path.pointAt(S.sCenter + ds, (S.minLat + S.maxLat) / 2, new THREE.Vector3());
      lights.push(new THREE.Vector3(p.x, p.y + 14, p.z));
    }
    this._decorTracks(st, res.root);
    this.root.add(res.root);
    return { ...res, signals, lights };
  }

  stationSignals(st) {
    return this.stationObjs.get(st.index)?.signals || null;
  }

  // ------------------------------------------------------------ streaming
  update(sFocus, focusPos, { budget = 2, terrainBudget = 2, init = false } = {}) {
    this._frame = (this._frame || 0) + 1;
    this.lastBuild = '';
    const L = this.layout;
    const C = STREAM.CHUNK;
    const i0 = Math.max(0, Math.floor((sFocus - STREAM.BEHIND) / C));
    const i1 = Math.min(Math.floor(L.total / C), Math.floor((sFocus + STREAM.AHEAD) / C));
    const want = new Set();
    for (let i = i0; i <= i1; i++) want.add(i);
    const order = [...want].sort((p, q) => Math.abs(p * C - sFocus) - Math.abs(q * C - sFocus));
    let built = 0;
    for (const i of order) {
      if (this.chunks.has(i)) continue;
      if (!init && built >= budget) break;
      const t0 = performance.now();
      this.chunks.set(i, this._buildChunk(i));
      this._note(`chunk ${i}`, t0);
      built++;
    }
    for (const [i, g] of this.chunks) {
      if (!want.has(i)) { disposeObject(g); this.chunks.delete(i); this.rotors = this.rotors.filter((r) => r.group.parent && r.group.parent !== g); }
    }
    this.props.ctx.rotors = this.rotors;
    this.props.ctx.lcs = this.lcs = this.lcs.filter((l) => l.group.parent);

    for (const st of L.stations) {
      const S = st.layout;
      const near = sFocus > S.zoneStart - STREAM.STATION_AHEAD && sFocus < S.zoneEnd + STREAM.STATION_BEHIND;
      const have = this.stationObjs.get(st.index);
      if (near && !have && (init || built < budget + 1)) {
        const t0 = performance.now();
        this.stationObjs.set(st.index, this._buildStationObj(st));
        this._note(`station ${st.code}`, t0);
        built++;
      } else if (!near && have) {
        disposeObject(have.root);
        this.stationObjs.delete(st.index);
      }
    }
    this.people = [];
    for (const o of this.stationObjs.values()) this.people.push(...o.people);
    this.stationLights = [];
    for (const o of this.stationObjs.values()) this.stationLights.push(...o.lights);
    this._focus = focusPos;

    this._streamIbs(sFocus);
    const tt = performance.now();
    const nt = this.terrain.update(focusPos, init ? 400 : terrainBudget);
    if (nt) this._note(`terrain x${nt}`, tt);
    return built;
  }

  _note(what, t0) {
    const ms = performance.now() - t0;
    if (!this._frameNotes || this._frameNotesAt !== this._frame) { this._frameNotes = []; this._frameNotesAt = this._frame; }
    this._frameNotes.push(`${what}:${ms | 0}`);
    this.lastBuild = this._frameNotes.join(' ');
  }

  // Level-crossing gates close while our train approaches/occupies the crossing.
  updateLevelCrossings(sFront, trainLen, dt) {
    let bell = null;
    for (const lc of this.lcs) {
      const closing = sFront > lc.s - 900 && sFront - trainLen < lc.s + 25;
      const target = closing ? 1 : 0;
      lc.closed += Math.sign(target - lc.closed) * Math.min(Math.abs(target - lc.closed), dt / 5);
      for (const p of lc.pivots) p.pivot.rotation.x = p.open * (1 - lc.closed);
      if (closing && lc.closed < 1 && Math.abs(lc.s - sFront) < 900) bell = lc;
    }
    return bell;
  }

  animate(dt, night, focusPos) {
    if (this.gtl && this.gtl.animate) this.gtl.animate(dt, night);
    for (const p of this.people) {
      if (p.mesh.parent && p.mesh.getWorldPosition(_tmp).distanceToSquared(focusPos) < 450 * 450) animatePerson(p, dt);
    }
    for (const r of this.rotors) r.obj.rotation.z += dt * r.speed;
    // Fixed light pool: adding/removing lights recompiles every shader in WebGPU,
    // so a constant number of lights is moved to the nearest station floodlights.
    const pts = this.stationLights.slice().sort((a, b) => a.distanceToSquared(focusPos) - b.distanceToSquared(focusPos));
    this.lightPool.forEach((l, i) => {
      if (pts[i]) { l.position.copy(pts[i]); l.intensity = night * 260; } else l.intensity = 0;
    });
  }

  dispose() {
    if (this.lightPool) for (const l of this.lightPool) l.removeFromParent();
    this.turnouts.dispose();
    for (const g of this.chunks.values()) disposeObject(g);
    for (const o of this.stationObjs.values()) disposeObject(o.root);
    this.chunks.clear();
    this.stationObjs.clear();
    this.terrain.dispose();
    disposeObject(this.root);
  }
}
const _tmp = new THREE.Vector3();
