// A Lane is a lateral offset function l(s) relative to the route centre-line,
// composed of smooth S-curve transitions. It describes turnouts, crossovers and
// platform-track fans exactly, so the rendered rails and the train always agree.

const smooth = (t) => t * t * (3 - 2 * t);

export class Lane {
  constructor(base = 0) {
    this.base = base;
    this.tr = []; // sorted, non-overlapping {s0, s1, from, to}
  }

  add(s0, s1, from, to) {
    if (Math.abs(to - from) < 1e-4 || s1 <= s0) return this;
    this.tr.push({ s0, s1, from, to });
    this.tr.sort((a, b) => a.s0 - b.s0);
    return this;
  }

  _find(s) {
    const tr = this.tr;
    let lo = 0, hi = tr.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tr[mid].s0 <= s) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx;
  }

  at(s) {
    const i = this._find(s);
    if (i < 0) return this.tr.length ? this.tr[0].from : this.base;
    const t = this.tr[i];
    if (s >= t.s1) return t.to;
    return t.from + (t.to - t.from) * smooth((s - t.s0) / (t.s1 - t.s0));
  }

  // dl/ds
  slope(s) {
    const i = this._find(s);
    if (i < 0) return 0;
    const t = this.tr[i];
    if (s >= t.s1) return 0;
    const u = (s - t.s0) / (t.s1 - t.s0);
    return (t.to - t.from) * 6 * u * (1 - u) / (t.s1 - t.s0);
  }

  // True when the lane is mid-transition (used for turnout speed limits & clatter).
  inTransition(s) {
    const i = this._find(s);
    return i >= 0 && s < this.tr[i].s1;
  }

  transitionsIn(a, b) {
    return this.tr.filter((t) => t.s1 > a && t.s0 < b);
  }
}
