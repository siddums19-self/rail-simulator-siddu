import * as THREE from 'three/webgpu';
import { Batcher } from './core/batcher.js';
import { M } from './core/materials.js';
import { makeRng, range, pick } from './core/rng.js';

// Weather & season operations.
//  * Monsoon: washouts and soaked banks -> temporary speed restrictions (TSRs),
//    notified to the driver before departure as a caution order (form T.409);
//    a breach may need a "stop dead, then proceed" restriction.
//  * Fog: reduced line speed (75 km/h) and the Fog Safety Device, which beeps as
//    each signal approaches and shows the distance to it.
//  * Summer: hot-weather restrictions on long-welded-rail stretches, in force
//    only in the heat of the day (12:00-17:00).
// Restrictions are Operations temp limits / hold points, so Kavach, the auto
// driver, the timetable and the HUD all see them. Lineside boards mark them:
// caution indicator ~800 m before, speed board at the start, T/P board at the end.

export const FOG_CAP = 75;
const HEAT = [12 * 60, 17 * 60];

const MONSOON_WHY = [
  { kmh: 30, why: 'Bank soaked after heavy rain' },
  { kmh: 20, why: 'Ballast washed out — track being packed' },
  { kmh: 45, why: 'Cutting slope slip, patrolman on duty' },
  { kmh: 50, why: 'Bridge waterway in spate' }
];

export class WeatherOps {
  constructor({ layout, ops, world, audio, toast, seedKey, getClock, getScorer }) {
    Object.assign(this, { layout, ops, world, audio, toast, seedKey, getClock, getScorer });
    this.orders = [];
    this.weather = null;
    this.n = 0;
    this.group = new THREE.Group();
    world.root.add(this.group);
    this.fsdKey = null;
  }

  dispose() { this._clear(); this.group.removeFromParent(); }

  heatActive() { const t = ((this.getClock() % 1440) + 1440) % 1440; return t >= HEAT[0] && t < HEAT[1]; }

  // Issue caution orders for the new weather over the route still ahead. Returns true if any were issued.
  setWeather(w, sFront) {
    if (w === this.weather) return false;
    this.weather = w;
    this._clear();
    this.ops.weatherCap = w === 'FOG' ? FOG_CAP : Infinity;
    if (w === 'MONSOON') this._issue(sFront, 'monsoon');
    if (w === 'HAZE') this._issue(sFront, 'summer');
    return this.orders.length > 0;
  }

  _clear() {
    const ops = this.ops;
    ops.tempLimits = ops.tempLimits.filter((t) => t.kind !== 'caution');
    ops.holdPoints = ops.holdPoints.filter((h) => h.kind !== 'caution');
    for (const c of [...this.group.children]) c.removeFromParent();
    this.orders = [];
  }

  _issue(sFront, kind) {
    const L = this.layout, rand = makeRng(this.seedKey, 'caution', kind, this.n++);
    const count = kind === 'monsoon' ? 3 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 2);
    const a = sFront + 2500, b = L.total - 3000;
    if (b - a < 3000) return;
    const spots = Array.from({ length: count }, (_, i) => a + ((b - a) * (i + 0.15 + rand() * 0.7)) / count);
    let stopDead = kind === 'monsoon' && rand() < 0.6;
    for (const s0 of spots) {
      const lenKm = range(rand, 0.4, 1.2);
      const s1 = L.sAtRealKm(L.realKmAt(s0) + lenKm);
      let clear = true;
      for (let s = s0 - 900; s < s1 + 300; s += 100) if (L.stationAt(s, 300)) { clear = false; break; }
      if (!clear) continue;
      let o;
      if (kind === 'monsoon') {
        const r = stopDead ? { kmh: 10, why: 'Breach repaired after washout — STOP DEAD, then 10 km/h' } : pick(rand, MONSOON_WHY);
        o = { kmh: r.kmh, why: r.why, stop: stopDead };
        stopDead = false;
      } else {
        o = { kmh: pick(rand, [60, 75]), why: 'Hot weather: LWR stress — in force 12:00 to 17:00', summer: true };
      }
      Object.assign(o, { s0, s1, km0: L.realKmAt(s0), km1: L.realKmAt(s1), max: 0, entered: false, done: false });
      o.tsr = { s0, s1, kmh: o.kmh, label: `Caution order ${o.kmh} km/h${o.summer ? ' (12–17 h)' : ''}`, kind: 'caution', active: o.summer ? () => this.heatActive() : null };
      this.ops.tempLimits.push(o.tsr);
      if (o.stop) {
        o.hold = { s: s0 - 25, reason: 'Caution order: stop dead before the breach', short: 'stop dead', active: true, show: true, kind: 'caution' };
        this.ops.holdPoints.push(o.hold);
      }
      this._boards(o);
      this.orders.push(o);
    }
  }

  _boards(o) {
    const L = this.layout, path = L.path, bat = new Batcher(), v = new THREE.Vector3();
    const board = (s, text, bg, fg) => {
      const lat = -(L.lineAt(s) === 'S' ? 4.2 : 6.9);
      path.pointAt(s, lat, v);
      const y = path.yAt(s), th = -path.headingAt(s);
      bat.box(M.steelDark(), v.x, y + 1.3, v.z, 0.09, 2.6, 0.09, th, false);
      bat.box(M.textBoard(text, { bg, fg, w: 192, h: 192, font: 'bold 72px Arial' }), v.x, y + 2.95, v.z, 0.95, 0.95, 0.05, th, false);
    };
    board(o.s0 - 800, 'C', '#f5c518', '#111');               // caution indicator
    board(o.s0 - 5, String(o.kmh), '#f5c518', '#111');       // speed indication
    board(o.s1 + 10, 'T/P', '#ffffff', '#111');              // termination (passenger)
    if (o.stop) board(o.s0 - 40, 'STOP', '#c0392b', '#fff');
    this.group.add(bat.build());
  }

  update(dt, { sFront, prevFront, speed, trainLen, nextSignalDist }) {
    // Fog Safety Device: beeps at 500 / 250 / 100 m from each signal
    if (this.weather === 'FOG' && nextSignalDist != null) {
      const band = nextSignalDist < 100 ? 3 : nextSignalDist < 250 ? 2 : nextSignalDist < 500 ? 1 : 0;
      if (band > (this.fsdBand ?? 0)) { for (let i = 0; i < band; i++) setTimeout(() => this.audio.beep?.(), i * 180); }
      this.fsdBand = band;
    }
    const scorer = this.getScorer();
    const kmh = speed * 3.6, rear = sFront - trainLen;
    for (const o of this.orders) {
      if (o.done) continue;
      if (o.hold && o.hold.active) {
        if (speed < 0.3 && o.hold.s - sFront < 90 && o.hold.s - sFront > -5) { o.hold.active = false; this.toast('Stopped dead at the breach — proceed at 10 km/h, be prepared to stop', 'ok', 4000); }
        else if (prevFront < o.hold.s && sFront >= o.hold.s) { o.hold.active = false; scorer.add(-100, `Did not stop dead at the breach (km ${o.km0.toFixed(1)})`); }
      }
      const inForce = !o.summer || this.heatActive();
      if (sFront > o.s0 && rear < o.s1) { if (inForce) { o.entered = true; o.max = Math.max(o.max, kmh); } }
      if (rear > o.s1) {
        o.done = true;
        if (!o.entered) continue;
        if (o.max <= o.kmh + 5) scorer.add(15, `Observed caution order ${o.kmh} km/h at km ${o.km0.toFixed(1)}`);
        else scorer.add(-40, `Caution order violated: ${Math.round(o.max)} km/h in a ${o.kmh} km/h restriction (km ${o.km0.toFixed(1)})`);
      }
    }
  }

  // Caution order (T.409) as handed to the loco pilot.
  render() {
    const rows = this.orders.filter((o) => !o.done).map((o) => `<tr><td>${o.km0.toFixed(1)} – ${o.km1.toFixed(1)}</td><td><b>${o.kmh}</b>${o.stop ? ' <span class="warn">stop dead</span>' : ''}</td><td>${o.why}</td></tr>`).join('');
    const fog = this.weather === 'FOG' ? `<div class="inc-status">Dense fog: maximum ${FOG_CAP} km/h. The Fog Safety Device beeps at 500, 250 and 100 m from every signal — be prepared to stop.</div>` : '';
    if (!rows && !fog) return null;
    return `<div class="title">CAUTION ORDER · T.409</div><div class="muted" style="margin-top:2px;">Issued to the loco pilot before departure. Observe these restrictions until the whole train has passed the T/P board.</div>${rows ? `<table class="co"><thead><tr><th>km</th><th>km/h</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>` : ''}${fog}<div class="row" style="justify-content:flex-end;"><button class="primary" id="co-ack">Acknowledge</button></div>`;
  }
}
