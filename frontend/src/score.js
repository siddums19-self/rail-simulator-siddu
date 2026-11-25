// Driver scoring: punctuality, stopping accuracy, passenger comfort, speed
// discipline, whistle boards and signal discipline. Also records the
// speed/limit trace for the speed recorder chart.

export class Scorer {
  constructor() {
    this.points = 0;
    this.comfort = 100;
    this.events = [];
    this.trace = [];
    this._prevA = 0;
    this._overspeed = 0;
    this._sample = 0;
    this.whistleOk = 0;
    this.whistleMissed = 0;
    this.overspeeds = 0;      // overspeed events over the whole run
    this.halts = [];          // punctuality record per halt (see onHalt / onDeparture)
    this.incidentsOk = 0;
    this.incidentsBad = 0;
  }

  add(pts, why) {
    this.points += pts;
    this.events.push({ pts, why });
    if (this.events.length > 60) this.events.shift();
  }

  update(dt, { kmh, limit, accel, emergency, km }) {
    // comfort: penalise jerk (rate of change of acceleration) and emergency braking
    const jerk = Math.abs(accel - this._prevA) / Math.max(dt, 1e-3);
    this._prevA = accel;
    if (dt > 0) {
      if (jerk > 1.0) this.comfort -= Math.min(4, (jerk - 1.0) * dt * 6);
      if (emergency && kmh > 5) this.comfort -= 6 * dt;
      this.comfort = Math.min(100, Math.max(0, this.comfort + dt * 0.4));
    }
    // speed discipline: seconds above limit + 5 km/h
    if (kmh > limit + 5) {
      this._overspeed += dt;
      if (this._overspeed > 2) { this.overspeeds++; this.add(-5, `Overspeed ${Math.round(kmh)}/${Math.round(limit)}`); this._overspeed = 0; }
    } else this._overspeed = 0;
    this._sample += dt;
    if (this._sample > 0.5) { this._sample = 0; this.trace.push({ km, kmh, limit }); if (this.trace.length > 20000) this.trace.shift(); }
  }

  // Arrival at a halt. delayMin: + late / − early against the booked arrival.
  // leg: { startDelay, overspeeds } as it stood when we left the previous timing point.
  // delayMin here is the driver's own lateness (control delays already removed); ctrl is shown for information.
  onHalt(st, stopErr, delayMin, leg = null, ctrl = 0) {
    const e = Math.abs(stopErr);
    if (e < 8) this.add(50, `Perfect stop at ${st.code} (${e.toFixed(1)} m)`);
    else if (e < 25) this.add(20, `Good stop at ${st.code} (${e.toFixed(0)} m)`);
    const late = Math.round(delayMin);
    if (delayMin <= 1) this.add(100, delayMin < -1 ? `Arrived ${st.code} ${-late} min early (slack)` : `On time at ${st.code}`);
    else if (delayMin <= 3) this.add(40, `Right time at ${st.code} (+${late} min)`);
    else this.add(-Math.round(Math.min(200, delayMin * 8)), `Late ${late} min at ${st.code}`);
    if (ctrl >= 1) this.events.push({ pts: 0, why: `Signals / incidents have cost ${Math.round(ctrl)} min so far — not counted against you` });
    // making up lost time: only counts if the leg was run without overspeeding
    if (leg && leg.startDelay > 1) {
      const recovered = leg.startDelay - Math.max(0, delayMin);
      if (recovered >= 1) {
        const clean = this.overspeeds === leg.overspeeds;
        if (clean) this.add(Math.min(150, Math.round(recovered * 20)), `Recovered ${recovered.toFixed(1)} min to ${st.code} without overspeeding`);
        else this.events.push({ pts: 0, why: `Recovered ${recovered.toFixed(1)} min to ${st.code}, but overspeeding — no recovery bonus` });
      }
    }
    this.halts.push({ code: st.code, name: st.name, arrDelay: delayMin, depDelay: null });
  }

  // Departure from a halt (or the origin). delayMin: + late / − early against the booked departure.
  onDeparture(st, delayMin) {
    let h = this.halts.find((x) => x.code === st.code && x.depDelay === null);
    if (!h) { h = { code: st.code, name: st.name, arrDelay: null, depDelay: null }; this.halts.push(h); }
    h.depDelay = delayMin;
    if (delayMin < -0.5) this.add(-Math.round(Math.min(200, 40 + -delayMin * 25)), `Left ${st.code} ${Math.max(1, Math.round(-delayMin))} min before booked departure`);
    else if (delayMin <= 1) this.add(20, `Right-time departure from ${st.code}`);
  }

  onIncidentHandled(ok, pts, why) { if (ok) this.incidentsOk++; else this.incidentsBad++; this.add(pts, why); }

  onSpad() { this.add(-200, 'Signal passed at danger'); this.trace.push({ spad: true, km: this.trace.at(-1)?.km ?? 0 }); }
  onIncident(type) { this.add(-1000, type === 'derail' ? 'Derailment' : 'Collision'); }
  onWhistle(ok) { if (ok) { this.whistleOk++; this.add(10, 'Whistled at W/L board'); } else { this.whistleMissed++; this.add(-15, 'No whistle before level crossing'); } }

  total() { return Math.round(this.points + this.comfort * 3); }

  grade() {
    const t = this.total();
    return t > 900 ? 'A+ Loco Pilot (Mail/Express)' : t > 600 ? 'A Senior Loco Pilot' : t > 300 ? 'B Loco Pilot (Passenger)' : t > 0 ? 'C Assistant Loco Pilot' : 'D Needs re-training';
  }
}
