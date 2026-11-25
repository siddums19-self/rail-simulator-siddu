// Guntakal - Dhone single line (absolute block): one train per block section between stations,
// crossing loops at the wayside stations. Shared by two game modes:
//  * Section Controller: you see the whole section on a time-distance chart and give orders
//    (hold a train at a station, send it into the loop). The station masters are computer-run.
//  * Wayside Station Master: you are the station master at one small station. Neighbours ask you
//    for line clear, you set routes (main / loop), work the level-crossing gate, ask line clear
//    ahead and clear the starter. Everything else is computer-run.

export const SECTION = [
  { code: 'GTL', name: 'Guntakal Jn', km: 0, end: true },
  { code: 'MKR', name: 'Maddikera', km: 13, loops: [700, 700] },
  { code: 'TGL', name: 'Tuggali', km: 23, loops: [560] },          // short loop: a full goods rake doesn't fit
  { code: 'EDD', name: 'Edduladoddi', km: 32, loops: [700] },
  { code: 'PDL', name: 'Pendekallu', km: 42, loops: [700, 640] },
  { code: 'LMD', name: 'Linganenidoddi', km: 51, loops: [600] },
  { code: 'MYL', name: 'Malliyala', km: 60, loops: [700], gate: true }, // LC gate on the Guntakal-side approach
  { code: 'DHNE', name: 'Dhone Jn', km: 69, end: true }
];

const KIND = {
  vip: { v: 110, len: 480, pts: 150, w: 6, col: '#f59e0b' },
  exp: { v: 100, len: 600, pts: 100, w: 3, col: '#3b82f6' },
  pass: { v: 80, len: 170, pts: 70, w: 2, col: '#22c55e', stops: true },
  goods: { v: 60, len: 690, pts: 60, w: 1, col: '#b45309' }
};
const DOWN = [ // Guntakal -> Dhone
  ['17225', 'Amaravati Exp', 'exp'], ['18463', 'Prashanti Exp', 'exp'], ['77414', 'Guntakal–Kurnool DEMU', 'pass'],
  ['20707', 'Vande Bharat', 'vip'], ['BOXN', 'Coal rake', 'goods'], ['BCN', 'Container special', 'goods'], ['17415', 'Haripriya Exp', 'exp']
];
const UP = [ // Dhone -> Guntakal
  ['17226', 'Amaravati Exp', 'exp'], ['18464', 'Prashanti Exp', 'exp'], ['77413', 'Kurnool–Guntakal DEMU', 'pass'],
  ['20708', 'Vande Bharat', 'vip'], ['BTPN', 'Tank rake', 'goods'], ['BOXN', 'Empty coal rake', 'goods'], ['17416', 'Haripriya Exp', 'exp']
];
export const TIME_SCALE = 30;      // sim seconds per real second
const DWELL = 60, RESTART = 90, LOOP_PASS = 70, HOME_KM = 1.0;

export class SectionSim {
  // mode: 'controller' | 'wayside'; player: station index for wayside
  constructor(mode, player = 6, shiftRealSecs = 15 * 60) {
    this.mode = mode; this.player = mode === 'wayside' ? player : -1;
    this.st = SECTION.map((s) => ({ ...s, lines: s.end ? null : [null, ...(s.loops || []).map(() => null)] }));
    this.blocks = new Array(SECTION.length - 1).fill(null);
    Object.assign(this, { t: 0, real: 0, trains: [], done: [], score: 0, seq: 0, nextSpawn: 120, log: [], over: null, lastProgress: 0, shift: shiftRealSecs });
    this.requests = []; // wayside: line clear requests from the neighbours
    this.gate = 'open'; this.gateT = 0; this.gateClosedIdle = 0;
    // opening traffic so the first crossing comes quickly
    this._spawn(+1, DOWN[0]); this._spawn(-1, UP[4], 200);
  }

  // ------------------------------------------------------------ helpers
  km(i) { return SECTION[i].km; }
  lineFits(s, li, tr) { return li === 0 || s.loops[li - 1] >= KIND[tr.kind].len; }
  lineName(i, li) { return li === 0 ? 'Main' : SECTION[i].loops.length > 1 ? `Loop ${li}` : 'Loop'; }
  _log(m) { this.log = [m, ...this.log].slice(0, 8); }

  _spawn(dir, tpl, delay = 0) {
    const [no, name, kind] = tpl;
    const k = KIND[kind];
    const at = dir > 0 ? 0 : SECTION.length - 1;
    let ideal = 0;
    for (let i = 0; i < SECTION.length - 1; i++) ideal += ((this.km(i + 1) - this.km(i)) / k.v) * 3600;
    if (k.stops) ideal += DWELL * (SECTION.length - 2);
    const tr = { id: ++this.seq, no, name, kind, dir, at, from: at, to: null, pos: this.km(at), state: 'entry', spawnT: this.t + delay, ideal,
      line: null, wait: 0, pause: delay, hist: [], holdAt: null, loopAt: null, stopped: true };
    this.trains.push(tr);
    return tr;
  }

  _pickLine(i, tr) {
    const s = this.st[i];
    const free = s.lines.map((o, li) => (!o && this.lineFits(SECTION[i], li, tr) ? li : -1)).filter((li) => li >= 0);
    if (!free.length) return null;
    if (tr.loopAt === i) { const l = free.find((li) => li > 0); return l ?? null; }
    return free[0]; // main if free
  }

  // ------------------------------------------------------------ movement authority
  // Can tr leave station i (or the section end) now? Reserves the block (and line ahead) if so.
  _tryDepart(tr, i) {
    const next = i + tr.dir, b = Math.min(i, next);
    if (next < 0 || next >= SECTION.length) return false;
    if (tr.holdAt === i) return false;
    if (this.blocks[b] && this.blocks[b] !== tr) return false;
    let li = null;
    if (i === this.player) { // our own starter
      if (!tr.lcNext || !tr.starterCleared) return false;
      li = tr.nextLine;
    } else if (next === this.player) { // the neighbour needs line clear from us
      if (!tr.lcGranted) {
        if (!this.requests.includes(tr)) { this.requests.push(tr); this._log(`☎ ${SECTION[i].name} asks line clear for ${tr.no} ${tr.name}`); }
        return false;
      }
    } else if (!SECTION[next].end) {
      li = this._pickLine(next, tr);
      if (li === null) return false;
    }
    this.blocks[b] = tr;
    if (li !== null && !SECTION[next].end) this.st[next].lines[li] = tr;
    if (tr.line !== null && !SECTION[i].end) this.st[i].lines[tr.line] = null;
    tr.line = li; tr.from = i; tr.to = next; tr.state = 'run';
    if (tr.stopped) tr.pause += RESTART;
    tr.stopped = false;
    tr.lcGranted = false; tr.lcNext = false; tr.starterCleared = false; tr.nextLine = null; tr.asked = false;
    this.lastProgress = this.real;
    return true;
  }

  _arrive(tr) {
    const i = tr.to;
    this.blocks[Math.min(tr.from, i)] = null;
    tr.at = i; tr.pos = this.km(i);
    this.lastProgress = this.real;
    if (SECTION[i].end) { this._finish(tr); return; }
    if (i === this.player) tr.line = tr.routeLine;
    tr.routeLine = null;
    const k = KIND[tr.kind];
    tr.dwellLeft = k.stops ? DWELL : 0;
    tr.state = 'station';
    if (tr.holdAt === i || tr.dwellLeft > 0 || !this._tryDepart(tr, i)) {
      tr.stopped = true;
      if (!k.stops) this._log(`${tr.no} ${tr.name} stopped at ${SECTION[i].name} (${this.lineName(i, tr.line)})`);
    } else if (tr.line > 0) tr.pause += LOOP_PASS; // ran through the loop at 30 km/h
  }

  _finish(tr) {
    const k = KIND[tr.kind];
    const delayMin = Math.max(0, (this.t - tr.spawnT - tr.ideal) / 60);
    const pts = Math.round(Math.max(-100, k.pts - Math.max(0, delayMin - 2) * k.w));
    this.score += pts;
    tr.state = 'gone'; tr.delayMin = delayMin;
    this.done.push(tr);
    this._log(`${pts >= 0 ? '✓' : '✗'} ${tr.no} ${tr.name} cleared the section, ${Math.round(delayMin)} min late: ${pts >= 0 ? '+' : ''}${pts}`);
  }

  // ------------------------------------------------------------ player actions (wayside)
  grant(tr) {
    const p = this.player, b = Math.min(p, p - tr.dir);
    if (this.blocks[b] && this.blocks[b] !== tr) return `Block ${SECTION[b].name}–${SECTION[b + 1].name} is occupied`;
    // line clear may only be given when a line is free to receive the train (it fits there)
    if (!this.st[p].lines.some((o, li) => (!o || o === tr) && this.lineFits(SECTION[p], li, tr))) return `No line free at ${SECTION[p].name} that can take ${tr.no} (${KIND[tr.kind].len} m)`;
    this.blocks[b] = tr; tr.lcGranted = true;
    this.requests = this.requests.filter((x) => x !== tr);
    this._log(`Line clear given to ${SECTION[p - tr.dir].name} for ${tr.no}`);
    return null;
  }

  setRoute(tr, li) {
    const p = this.player, s = this.st[p];
    if (s.lines[li] && s.lines[li] !== tr) return `${this.lineName(p, li)} is occupied`;
    if (!this.lineFits(SECTION[p], li, tr)) return `${tr.no} is too long for the ${this.lineName(p, li).toLowerCase()}`;
    if (SECTION[p].gate && tr.dir > 0 && this.gate !== 'closed') return 'Close the level-crossing gate first';
    if (tr.routeLine !== null && tr.routeLine !== undefined && tr.routeLine !== li) s.lines[tr.routeLine] = null;
    s.lines[li] = tr; tr.routeLine = li;
    return null;
  }

  _ours(tr) { const p = this.player; return (tr.to === p && (tr.state === 'run' || tr.state === 'home')) || (tr.at === p && tr.state === 'station'); }

  askLineClear(tr) {
    if (!this._ours(tr)) return `${tr.no} is not at or approaching your station`;
    if (tr.asked || tr.lcNext) return 'Already asked';
    tr.asked = true;
    const next = this.player + tr.dir, b = Math.min(this.player, next);
    setTimeout(() => { // the station ahead answers after a moment
      if (tr.state === 'gone') return;
      tr.asked = false;
      if (this.blocks[b] && this.blocks[b] !== tr) { this._log(`✗ ${SECTION[next].name}: block occupied, line clear refused for ${tr.no}`); return; }
      let li = null;
      if (!SECTION[next].end) { li = this._pickLine(next, tr); if (li === null) { this._log(`✗ ${SECTION[next].name}: no line to receive ${tr.no}`); return; } }
      this.blocks[b] = tr;
      if (li !== null) this.st[next].lines[li] = tr;
      tr.lcNext = true; tr.nextLine = li;
      this._log(`✓ ${SECTION[next].name} gives line clear for ${tr.no}`);
    }, 1500 + Math.random() * 2500);
    return null;
  }

  clearStarter(tr) {
    if (!this._ours(tr)) return `${tr.no} is not at or approaching your station`;
    if (!tr.lcNext) return 'No line clear from the station ahead yet';
    tr.starterCleared = true;
    return null;
  }

  toggleGate() {
    if (this.gate === 'open') { this.gate = 'closing'; this.gateT = 4; }
    else if (this.gate === 'closed') {
      const p = this.player;
      if (this.trains.some((t) => t.dir > 0 && t.routeLine !== null && t.routeLine !== undefined && t.to === p)) return 'A route is set over the gate';
      this.gate = 'opening'; this.gateT = 3;
    }
    return null;
  }

  // ------------------------------------------------------------ controller orders
  hold(tr) {
    const i = tr.state === 'station' || tr.state === 'entry' ? tr.at : tr.to;
    if (i === null || SECTION[i].end && tr.state !== 'entry') return 'Nowhere to hold it';
    tr.holdAt = tr.holdAt === i ? null : i;
    return null;
  }
  loop(tr) {
    const i = tr.state === 'run' ? tr.to : tr.at + tr.dir;
    if (i < 1 || i > SECTION.length - 2) return 'No station ahead with a loop';
    if (tr.state === 'run' && tr.line !== null) return 'Its route into the next station is already set';
    tr.loopAt = tr.loopAt === i ? null : i;
    return null;
  }

  // ------------------------------------------------------------ tick
  update(dtReal) {
    if (this.over) return;
    this.real += dtReal;
    const dt = dtReal * TIME_SCALE;
    this.t += dt;
    // timetable: a train every ~10-24 min, either end
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1, pool = dir > 0 ? DOWN : UP;
      this._spawn(dir, pool[Math.floor(Math.random() * pool.length)]);
      this.nextSpawn = (600 + Math.random() * 840) * (1 - Math.min(0.35, this.real / 2400));
    }
    // LC gate
    if (this.gate === 'closing' || this.gate === 'opening') { this.gateT -= dtReal; if (this.gateT <= 0) this.gate = this.gate === 'closing' ? 'closed' : 'open'; }
    if (this.player >= 0 && SECTION[this.player].gate && this.gate === 'closed') {
      const near = this.trains.some((t) => t.dir > 0 && t.state !== 'gone' && t.pos > this.km(this.player) - 4 && t.pos < this.km(this.player) + 0.3);
      if (!near) { this.gateClosedIdle += dtReal; if (this.gateClosedIdle > 20) { this.score -= dtReal * 0.5; if (!this._gateWarned) { this._gateWarned = true; this._log('⚠ Road traffic is piling up at the closed LC gate'); } } }
      else this.gateClosedIdle = 0;
    } else { this.gateClosedIdle = 0; this._gateWarned = false; }

    for (const tr of this.trains) {
      if (tr.state === 'gone') continue;
      if (tr.pause > 0) { tr.pause -= dt; continue; }
      if (tr.state === 'entry' || tr.state === 'station') {
        if (tr.dwellLeft > 0) { tr.dwellLeft -= dt; continue; }
        if (!this._tryDepart(tr, tr.at)) tr.wait += dt;
        continue;
      }
      if (tr.state === 'home') { // standing at our home signal
        tr.wait += dt;
        if (tr.routeLine !== null && tr.routeLine !== undefined) { tr.state = 'run'; tr.pause += RESTART; }
        continue;
      }
      // running in a block
      const v = KIND[tr.kind].v / 3600, target = this.km(tr.to);
      let np = tr.pos + tr.dir * v * dt;
      if (tr.to === this.player && (tr.routeLine === null || tr.routeLine === undefined)) {
        const home = target - tr.dir * HOME_KM;
        if ((np - home) * tr.dir >= 0) { tr.pos = home; tr.state = 'home'; tr.stopped = true; this._log(`${tr.no} ${tr.name} stopped at your home signal`); continue; }
      }
      if ((np - target) * tr.dir >= 0) { tr.pos = target; this._arrive(tr); continue; }
      tr.pos = np;
    }
    for (const tr of this.trains) if (tr.state !== 'gone' && (!tr.hist.length || this.t - tr.hist[tr.hist.length - 1][0] > 30)) tr.hist.push([this.t, tr.pos]);
    this.trains = this.trains.filter((t) => t.state !== 'gone' || this.t - (t.hist.at(-1)?.[0] ?? 0) < 3600);
    // end of shift / section locked up
    if (this.real >= this.shift) this.over = `Shift over — ${this.done.length} trains through`;
    const waiting = this.trains.filter((t) => t.state !== 'gone' && t.state !== 'run');
    if (waiting.length >= 2 && this.real - this.lastProgress > 75 && !this.trains.some((t) => t.state === 'run')) this.over = 'Section locked up — no train can move';
    if (this.over) this._log(`■ ${this.over}. Score ${Math.round(this.score)}`);
  }

  active() { return this.trains.filter((t) => t.state !== 'gone'); }
  avgDelay() { return this.done.length ? this.done.reduce((a, t) => a + t.delayMin, 0) / this.done.length : 0; }
}

export const SECTION_KIND = KIND;
