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
      if (this._overspeed > 2) { this.add(-5, `Overspeed ${Math.round(kmh)}/${Math.round(limit)}`); this._overspeed = 0; }
    } else this._overspeed = 0;
    this._sample += dt;
    if (this._sample > 0.5) { this._sample = 0; this.trace.push({ km, kmh, limit }); if (this.trace.length > 20000) this.trace.shift(); }
  }

  onHalt(st, stopErr, delayMin) {
    const e = Math.abs(stopErr);
    if (e < 8) this.add(50, `Perfect stop at ${st.code} (${e.toFixed(1)} m)`);
    else if (e < 25) this.add(20, `Good stop at ${st.code} (${e.toFixed(0)} m)`);
    if (delayMin <= 1) this.add(100, `On time at ${st.code}`);
    else this.add(-Math.round(Math.min(150, delayMin * 8)), `Late ${Math.round(delayMin)} min at ${st.code}`);
  }

  onSpad() { this.add(-200, 'Signal passed at danger'); this.trace.push({ spad: true, km: this.trace.at(-1)?.km ?? 0 }); }
  onIncident(type) { this.add(-1000, type === 'derail' ? 'Derailment' : 'Collision'); }
  onWhistle(ok) { if (ok) { this.whistleOk++; this.add(10, 'Whistled at W/L board'); } else { this.whistleMissed++; this.add(-15, 'No whistle before level crossing'); } }

  total() { return Math.round(this.points + this.comfort * 3); }

  grade() {
    const t = this.total();
    return t > 900 ? 'A+ Loco Pilot (Mail/Express)' : t > 600 ? 'A Senior Loco Pilot' : t > 300 ? 'B Loco Pilot (Passenger)' : t > 0 ? 'C Assistant Loco Pilot' : 'D Needs re-training';
  }
}
