import { Consist, LOCOS } from './trains/consist.js';

// Shunting mini-game: engine change by running a fresh loco round the train.
// The old loco is uncoupled and goes off to the shed. The relief loco stands
// on the adjacent line at the rear end of the platform; the loco pilot drives it
// past the train, out over the points beyond the clearance mark (ground shunt
// signal OFF), then — points reset, second shunt signal OFF — sets back onto
// the train and couples. Shunting limit 15 km/h; coupling must be under 5 km/h
// or the passengers get a jolt.

export const SHUNT_LIMIT = 15;   // km/h
const COUPLE_OK = 5, COUPLE_HARD = 10; // km/h

const fmt = (m) => `${Math.max(0, Math.round(m))} m`;

// Choose the run-round line and the points where it rejoins our line. null if the station can't do it.
export function planRunRound(st, ops, consistLen) {
  const L = st.layout, mine = ops.trackOf(st);
  const merges = (t) => {
    for (let s = L.pEnd; s < L.zoneEnd + 400; s += 4) {
      let ok = true;
      for (let k = 0; k <= 80; k += 10) if (Math.abs(t.lane.at(s + k) - ops.lane.at(s + k)) > 0.05) { ok = false; break; }
      if (ok) return s;
    }
    return null;
  };
  const cands = L.tracks.filter((t) => t !== mine && !st.occupancy.has(t.no) && t.lane)
    .map((t) => ({ t, m: merges(t) })).filter((c) => c.m !== null)
    .sort((a, b) => a.m - b.m || Math.abs(a.t.o - mine.o) - Math.abs(b.t.o - mine.o)); // shortest run-round first
  const c = cands[0];
  if (!c) return null;
  // the points' heel: last place the two lines are still clearly apart
  let heel = c.m;
  while (heel > L.pEnd - 200 && Math.abs(c.t.lane.at(heel) - ops.lane.at(heel)) < 2.6) heel -= 4;
  return { alt: c.t, merge: c.m, heel, clear: c.m + 25, limit: c.m + 420, start: Math.max(L.pStart + 15, L.pEnd - consistLen - 60) };
}

export class RunRound {
  constructor({ st, plan, consist, layout, ops, scene, audio, toast, scorer, locoKey, sFront }) {
    Object.assign(this, { st, plan, consist, layout, ops, scene, audio, toast, scorer, locoKey });
    this.phase = 'uncouple';
    this.t = 0;
    this.old = consist.vehicles[0];
    this.coachFront = sFront - this.old.length - 0.9;   // coupler face of the leading coach
    this.loco = LOCOS[locoKey].build();
    scene.add(this.loco.group);
    this.half = this.loco.length / 2;
    this.c = plan.start + this.half;                      // loco centre on the run-round line
    this.v = 0;                                           // m/s along +s (negative = setting back)
    this.reverser = 'F';
    this.lane = plan.alt.lane;
    this.penalties = 0;
    this.stoppedShort = false;
    this.overTimer = 0;
    this.dirty = true;
    ops.occupyShunt = plan.alt.no;
    st.occupancy.set(plan.alt.no, { kind: 'shunt', name: 'Relief loco (run-round)' });
    toast(`Run-round at ${st.name}: uncoupling — the relief ${LOCOS[locoKey].label} is on ${plan.alt.name}`, 'ok', 4500);
    audio.hornBlip?.(0.4);
  }

  get front() { return this.c + this.half; }
  get rear() { return this.c - this.half; }

  // Ground shunt signals: S1 at the end of the run-round line, S2 at the points for setting back.
  signals() {
    return {
      s1: this.phase === 'drive' ? 'OFF' : 'ON',
      s2: this.phase === 'setback' ? (this.t > 3 ? 'OFF' : 'ON') : 'ON'
    };
  }

  _pen(pts, why) { this.penalties -= pts; this.scorer.add(pts, why); this.toast(`${why} (${pts})`, 'warn', 3500); }

  // ctl: { notch, brake, auto }. Returns true when finished.
  update(dt, ctl) {
    this.t += dt;
    const p = this.plan;
    if (this.phase === 'uncouple') { // old loco runs off to the shed
      const k = Math.min(1, this.t / 6), sm = k * k * (3 - 2 * k);
      Consist.placeVehicle(this.old, this.layout.path, this.ops.lane, this.coachFront + 0.9 + this.old.length / 2 + 420 * sm);
      if (this.t > 6) { this.old.group.visible = false; this.phase = 'drive'; this.t = 0; this.dirty = true; this.toast('Shunt signal S1 OFF — drive the relief loco out past the clearance mark (15 km/h)', 'ok', 4500); }
    } else if (this.phase === 'points') {
      this.v = 0;
      if (this.t > 3) { this.phase = 'setback'; this.t = 0; this.lane = this.ops.lane; this.dirty = true; this.toast('Points set for the train — shunt signal S2 OFF. Reverser to R and set back onto the train; couple under 5 km/h.', 'ok', 5500); }
    }
    if (this.phase === 'drive' || this.phase === 'setback') this._drive(dt, ctl);
    if (this.phase === 'test') { this.v = 0; if (this.t > 4) return this._finish(); }
    Consist.placeVehicle(this.loco, this.layout.path, this.lane, this.c);
    return false;
  }

  _drive(dt, ctl) {
    const p = this.plan;
    const dirSign = this.reverser === 'F' ? 1 : -1;
    let notch = ctl.notch, brake = ctl.brake;
    if (ctl.auto) { // the auto driver does the run-round for you
      const target = this.phase === 'drive' ? (p.clear + 8 - this.rear) : (this.rear - (this.coachFront + 0.9));
      const want = this.phase === 'drive' ? Math.min(12, Math.max(2, target * 0.5)) : target > 60 ? 10 : target > 15 ? 5 : 2.5;
      if (this.phase === 'setback' && this.reverser !== 'R') this.reverser = 'R';
      if (this.phase === 'drive' && target < 0.5) { notch = 0; brake = 80; } else {
        const err = want / 3.6 - Math.abs(this.v);
        notch = err > 0.2 ? 3 : 0; brake = err < -0.3 ? 40 : 0;
      }
    }
    const tract = (Math.max(0, notch) / 8) * 0.55 * dirSign;
    const brk = (brake / 100) * 1.3;
    let a = tract - Math.sign(this.v) * (brk + 0.02);
    if (Math.abs(this.v) < 0.05 && Math.abs(tract) <= brk) { this.v = 0; a = 0; }
    this.v += a * dt;
    if (Math.sign(this.v) !== dirSign && Math.abs(tract) > 0 && Math.abs(this.v) < 0.05) this.v = 0;
    this.c += this.v * dt;
    const kmh = Math.abs(this.v) * 3.6;
    if (kmh > SHUNT_LIMIT + 2) { this.overTimer += dt; if (this.overTimer > 1.5) { this.overTimer = -8; this._pen(-20, `Shunting at ${Math.round(kmh)} km/h (limit ${SHUNT_LIMIT})`); } }
    else this.overTimer = Math.min(0, this.overTimer + dt);

    if (this.phase === 'drive') {
      if (this.front > p.limit) { this.v = 0; this._pen(-50, 'Ran past the shunt limit board'); this.c = p.limit - this.half - 1; }
      if (this.rear > p.clear && Math.abs(this.v) < 0.1) { this.phase = 'points'; this.t = 0; this.dirty = true; this.toast('Clear of the points — stop. Points being set for the train…', 'ok', 3500); this.audio.pointThrow?.(0.6); }
      if (this.reverser === 'R' && this.v < 0 && this.rear < p.start - 30) { this.v = 0; this.c = p.start - 30 + this.half; }
    } else if (this.phase === 'setback') {
      const gap = this.rear - (this.coachFront + 0.9);
      if (gap < 30 && gap > 4 && Math.abs(this.v) < 0.1) this.stoppedShort = true;
      if (this.front > p.limit) { this.v = 0; this.c = p.limit - this.half - 1; }
      if (gap <= 0) {
        this.c = this.coachFront + 0.9 + this.half;
        if (kmh > COUPLE_HARD) this._pen(-150, `Rough coupling at ${kmh.toFixed(1)} km/h — passengers thrown about`);
        else if (kmh > COUPLE_OK) this._pen(-50, `Coupling jolt at ${kmh.toFixed(1)} km/h (limit ${COUPLE_OK})`);
        else this.scorer.add(30, `Smooth coupling at ${kmh.toFixed(1)} km/h`);
        if (this.stoppedShort) this.scorer.add(20, 'Stopped short of the train before coupling');
        this.audio.crash?.(Math.min(0.5, 0.06 + kmh * 0.03));
        this.v = 0; this.phase = 'test'; this.t = 0; this.dirty = true;
        this.toast('Coupled — brake continuity test…', 'ok', 3000);
      }
    }
  }

  _finish() {
    this.loco.group.removeFromParent();
    this.old.group.removeFromParent();
    this.st.occupancy.delete(this.plan.alt.no);
    this.ops.occupyShunt = null;
    this.scorer.add(60, `Run-round at ${this.st.code} completed`);
    this.result = { newV: this.loco, coachFront: this.coachFront };
    this.phase = 'done';
    return true;
  }

  cancel() {
    this.loco.group.removeFromParent();
    this.old.group.visible = true;
    this.st.occupancy.delete(this.plan.alt.no);
    this.ops.occupyShunt = null;
  }

  render() {
    const p = this.plan, sg = this.signals();
    const kmh = Math.abs(this.v) * 3.6;
    const steps = [
      ['Uncouple the train loco', this.phase !== 'uncouple'],
      [`Drive out on ${p.alt.name} past the clearance mark`, ['points', 'setback', 'test', 'done'].includes(this.phase)],
      ['Points set — reverser to R, set back onto the train', ['test', 'done'].includes(this.phase)],
      [`Couple under ${COUPLE_OK} km/h, brake continuity test`, this.phase === 'done']
    ].map(([l, d]) => `<li class="${d ? 'done' : ''}"><span>${d ? '✓' : '○'}</span>${l}</li>`).join('');
    let target = '';
    if (this.phase === 'drive') target = `Clearance mark: ${fmt(p.clear - this.rear)} · shunt limit board: ${fmt(p.limit - this.front)}`;
    if (this.phase === 'setback') target = `Distance to the train: ${fmt(this.rear - (this.coachFront + 0.9))}`;
    const lamp = (v) => `<b style="color:${v === 'OFF' ? '#86efac' : '#fca5a5'}">${v}</b>`;
    return `<div class="title">🔧 Run-round · ${this.st.name}</div>
      <ol class="inc-steps">${steps}</ol>
      <div class="inc-status">Speed ${kmh.toFixed(1)} km/h (limit ${SHUNT_LIMIT}) · Reverser <b>${this.reverser}</b> · Shunt S1 ${lamp(sg.s1)} · S2 ${lamp(sg.s2)}</div>
      ${target ? `<div class="inc-status">${target}</div>` : ''}
      <div class="row"><button data-shunt="rev" class="primary">Reverser F/R (X)</button><button data-shunt="cancel">Let the shunter do it</button></div>`;
  }
}
