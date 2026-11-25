import { RAKES } from './config.js';

// Dynamic working timetable. Running times are derived from the actual route
// (section limits, curve limits, turnouts) and the chosen halts, so the schedule
// is achievable; it is rebuilt when halts change and tracks live delay/ETAs.
// All times are journey-clock minutes: the clock follows the distance compression,
// so running times are real-world-equivalent (real km / real speed).

export const fmtClock = (m) => {
  const t = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// Signed difference a − b in minutes on a 24 h clock (−720..720).
export const minDiff = (a, b) => ((((a - b) % 1440) + 2160) % 1440) - 720;

export class Timetable {
  constructor(layout, ops, rakeType, startMinutes) {
    this.layout = layout;
    this.ops = ops;
    this.vmax = RAKES[rakeType].vmax;
    this.depart0 = startMinutes + 2;
    this.actual = new Map(); // idx -> { arr, dep, passed }
    this.rebuild();
  }

  stopS(st) { return st.isOrigin ? st.layout.pEnd - 14 : this.ops.stopPoint(st); }

  // Real-world-equivalent seconds between two route distances at timing speed.
  _runSeconds(s0, s1) {
    let t = 0;
    for (let s = s0; s < s1; s += 50) {
      const lim = Math.min(this.vmax, this.ops.pointLimit(s));
      const realM = (this.layout.realKmAt(s + 50) - this.layout.realKmAt(s)) * 1000;
      t += realM / Math.max(5, (lim * 0.86) / 3.6);
    }
    return t;
  }

  rebuild() {
    const st = this.layout.stations;
    const rows = [];
    let clock = this.depart0;
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (i === 0) { rows.push({ st: s, arr: null, dep: clock, s: this.stopS(s) }); continue; }
      const prev = rows[i - 1];
      let sec = this._runSeconds(prev.s, this.stopS(s));
      if (prev.st.halt || prev.st.isOrigin) sec += 60;   // acceleration allowance
      if (s.halt || s.isDest) sec += 60;                 // braking allowance
      clock = prev.dep + sec / 60;
      const arr = clock;
      const dep = s.isDest ? null : (s.halt ? arr + s.dwellMin : arr);
      rows.push({ st: s, arr, dep, s: this.stopS(s) });
      if (dep !== null) clock = dep;
    }
    this.rows = rows;
  }

  shift(d) {
    this.depart0 += d;
    for (const r of this.rows) { if (r.arr != null) r.arr += d; if (r.dep != null) r.dep += d; }
    for (const a of this.actual.values()) for (const k of Object.keys(a)) a[k] += d;
  }

  // Scheduled time at route distance s (interpolated between timing points).
  scheduledAt(s) {
    const r = this.rows;
    if (s <= r[0].s) return r[0].dep;
    for (let i = 1; i < r.length; i++) {
      if (s <= r[i].s) {
        const a = r[i - 1].dep, b = r[i].arr;
        return a + (b - a) * ((s - r[i - 1].s) / Math.max(1, r[i].s - r[i - 1].s));
      }
    }
    return r[r.length - 1].arr;
  }

  // Positive = late (in game minutes).
  delay(now, sFront, halted) {
    const nx = this.ops.nextStation(sFront);
    if (halted && nx) {
      const row = this.rows[nx.index];
      return Math.max(0, minDiff(now, row.dep ?? row.arr));
    }
    return minDiff(now, this.scheduledAt(sFront));
  }

  eta(row, now, sFront, halted) {
    if (this.actual.get(row.st.index)?.arr !== undefined && row.st.layout.pEnd < sFront) return this.actual.get(row.st.index).arr;
    return row.arr === null ? null : row.arr + Math.max(-2, this.delay(now, sFront, halted));
  }

  // Booked departure of a station (journey-clock minutes), null for the destination.
  schedDep(st) { return this.rows[st.index]?.dep ?? null; }

  recordArrival(st, now) { const a = this.actual.get(st.index) || {}; a.arr = now; this.actual.set(st.index, a); return minDiff(now, this.rows[st.index].arr ?? now); }
  // Returns + late / − early against the booked departure.
  recordDeparture(st, now) { const a = this.actual.get(st.index) || {}; a.dep = now; this.actual.set(st.index, a); const d = this.rows[st.index].dep; return d == null ? 0 : minDiff(now, d); }
  recordPass(st, now) { const a = this.actual.get(st.index) || {}; if (a.pass === undefined) a.pass = now; this.actual.set(st.index, a); }
}
