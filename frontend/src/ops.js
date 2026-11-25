import { RAKES, TRACK, TRAFFIC_MIX } from './config.js';
import { makeNamer } from './route/trainNames.js';
import { makeRng, pick } from './core/rng.js';
import { Lane } from './route/lane.js';
import { playerMain, isDiverging, addTrackEntry, addTrackExit, gtlLadder } from './route/stationLayout.js';

// Railway operations: platform/loop occupancy, the player's route through each
// station, the full signal list (home / starter / intermediate block signals),
// aspects from block occupancy, speed limits, dwell, derailment, Kavach (ATP).

const RAKE_KEYS = TRAFFIC_MIX;
export const PRIORITY = { VANDE_BHARAT: 5, VANDE_BHARAT_ORANGE: 5, RAJDHANI: 5, DURANTO: 5, GARIB_RATH: 4, LHB: 4, JAN_SHATABDI: 3, ICF: 3, ICF_CREAM: 3, MUMBAI_LOCAL: 2, MMTS_LOCAL: 2, DEMU_PASSENGER: 2, BOXN_GOODS: 1 };
const TRAIN_NO = { VANDE_BHARAT: '20703', VANDE_BHARAT_ORANGE: '20707', RAJDHANI: '22691', DURANTO: '12245', GARIB_RATH: '12735', JAN_SHATABDI: '12069', ICF_CREAM: '17603', LHB: '12797', ICF: '17225', DEMU_PASSENGER: '77414', MUMBAI_LOCAL: '95101', MMTS_LOCAL: '47151', BOXN_GOODS: 'GOODS' };
const playerMainOf = (line) => playerMain(line);
const RANK = { RED: 0, YELLOW: 1, DOUBLE_YELLOW: 2, GREEN: 3 };
const ASPECTS = ['RED', 'YELLOW', 'DOUBLE_YELLOW', 'GREEN'];
const minAspect = (a, b) => (RANK[a] <= RANK[b] ? a : b);
const derive = (next) => (next === 'RED' ? 'YELLOW' : next === 'YELLOW' ? 'DOUBLE_YELLOW' : 'GREEN');

export const LOOP_LIMIT = 90;       // km/h on turnouts and loop lines (high-speed 1-in-20 turnouts)
export const DERAIL_TURNOUT = 140;  // km/h through a 90 km/h turnout (sustained) => derailment
export const DERAIL_LOOP = 150;     // km/h on a 90 km/h loop line
export const DERAIL_CURVE_FACTOR = 1.6;

export class Operations {
  constructor(layout, plan, rakeType, seedKey) {
    this.layout = layout;
    this.rakeType = rakeType;
    this.seedKey = seedKey;
    this.namer = makeNamer(layout, seedKey);
    this.trainNo = this.namer.ownNumber(rakeType) || TRAIN_NO[rakeType] || '12797';
    this.choices = new Map();
    this.locked = new Set();
    this.userPicked = new Set(); // stations where the driver chose the line
    this.dwell = new Map();     // stationIdx -> in-game minutes halted
    this.arrived = new Set();
    this.departedOrigin = false;
    this.originTimer = 0;
    this.crossings = new Map();
    this.trains = () => [];     // AI trains (set by Traffic)
    this.spads = 0;
    this.trainLen = 0;          // player's consist length (set once the consist is built)
    // Temporary speed restrictions [{ s0, s1, kmh, label, kind }] (caution orders,
    // written authority past a failed signal, restricted running after an incident).
    this.tempLimits = [];
    // Extra stop points [{ s, reason, active, kavach }] (LC gate signals, incident stops);
    // Kavach and the auto driver treat an active one like a red signal.
    this.holdPoints = [];
    const R = RAKES[rakeType];
    this.brakeMax = R.brake ?? 1.1;
    this.brakeLag = R.brakeTau ?? 1.4;
    const crossingByCode = new Map();
    for (const c of plan.crossings || []) if (c.eventType === 'SINGLE_LINE_LOOP_WAIT') crossingByCode.set(c.stationCode, c);

    for (const st of layout.stations) {
      const L = st.layout;
      const rand = makeRng(seedKey, 'occ', st.code, st.index);
      st.occupancy = new Map();
      const single = L.entryLine === 'S' && L.exitLine === 'S';
      const cr = crossingByCode.get(st.code);
      const sideLoops = L.tracks.filter((t) => !t.isThrough && Math.abs(t.mEntry - playerMain(L.entryLine)) < 0.01);
      if (cr && single && L.tracks.length >= 2 && !st.isOrigin && !st.isDest) {
        // reserve a loop for the oncoming train
        const loop = L.tracks.find((t) => !t.isThrough && t.pf) || L.tracks.find((t) => !t.isThrough) || L.tracks[0];
        const crCtx = { s: st.layout.zoneEnd + 50, dir: -1 };
        let crRake = cr.oncomingRake || 'BOXN_GOODS';
        if (!this.namer.allowed(crRake, crCtx)) crRake = this.namer.pickRake(['LHB', 'ICF', 'DEMU_PASSENGER', 'BOXN_GOODS'], rand, crCtx);
        const crName = this.namer.name(crRake, rand, crCtx);
        st.occupancy.set(loop.no, { kind: 'reserved', rake: crRake, name: crName });
        this.crossings.set(st.index, { track: loop, rake: crRake, name: crName, state: 'pending' });
      }
      if (L.tracks.length >= 3) {
        const p = L.N >= 6 ? 0.5 : 0.35;
        for (const t of L.tracks) {
          if (st.occupancy.has(t.no) || t.isThrough) continue; // running lines stay clear
          if (sideLoops.length === 1 && sideLoops[0] === t && !st.isOrigin) continue; // keep one loop for overtaking
          if (rand() < (t.role === 'goods' ? Math.min(0.85, p * (st.category === 'station' ? 1.3 : 1.9)) : p)) {
            const rake = t.role === 'goods' ? 'BOXN_GOODS' : this.namer.pickRake(RAKE_KEYS, rand, { st });
            st.occupancy.set(t.no, { kind: 'parked', rake, name: this.namer.name(rake, rand, { st }), facing: rand() < 0.5 ? 1 : -1 });
          }
        }
        if (!this.freeTracks(st).some((t) => t.pf)) {
          const t = L.tracks.find((tt) => tt.pf && st.occupancy.get(tt.no)?.kind === 'parked');
          if (t) st.occupancy.delete(t.no);
        }
      }
      this.choices.set(st.index, this.defaultTrack(st).no);
      // some stations are congested: the home signal is held and we wait outside
      if (!st.isOrigin && !st.isDest && (st.halt || st.category !== 'station') && rand() < 0.4) {
        st.busy = { hold: 35 + rand() * 55, t: 0, state: 'pending' };
      }
    }
    this.busyEnabled = true;
    this.lane = layout.buildLane(this.choices);
    this._buildSignals();
  }

  // ------------------------------------------------------------ tracks
  // tracks that lead off onto another line (Guntakal's Gooty side) can't take us onto our route
  // Guntakal on the Gooty route: a platform is usable if the crossover ladder joins it to our line
  usable(st, t) {
    const L = st.layout;
    if (L.gtlLadderExit && !st.isDest && !gtlLadder(null, L, t, 'exit')) return false;
    if (L.gtlLadderEntry && !st.isOrigin && !gtlLadder(null, L, t, 'entry')) return false;
    // Guntakal - Anantapur direct line: only PF 1 and 2 are connected to it
    if (st.code === 'GTL' && this._onAtpDirect(st) && !(t.pf && t.pf <= 2)) return false;
    return true;
  }

  _onAtpDirect(st) {
    const S = this.layout.stations;
    return S[st.index + 1]?.code === 'KLU' || S[st.index - 1]?.code === 'KLU';
  }

  freeTracks(st) {
    return st.layout.tracks.filter((t) => !st.occupancy.has(t.no) && this.usable(st, t));
  }

  defaultTrack(st) {
    const free = this.freeTracks(st);
    const L = st.layout;
    if (st.isOrigin) return free.filter((t) => t.pf).sort((a, b) => a.pf - b.pf)[0] || free[0] || L.tracks[0];
    const pm = playerMain(L.entryLine);
    const byDist = free.slice().sort((a, b) => Math.abs(a.o - pm) - Math.abs(b.o - pm));
    if (!st.halt) return byDist.find((t) => t.isThrough) || byDist[0] || L.tracks[0];
    // small stations: prefer a line whose platform is on the LEFT of the train (our direction of travel)
    if ((L.N || 0) <= 3) {
      const byO = L.tracks.slice().sort((a, b) => a.o - b.o);
      const mir = byO.length > 1 && byO.at(-1).lane.at(L.sCenter) < byO[0].lane.at(L.sCenter) ? -1 : 1; // station axis vs route axis
      const left = byDist.find((t) => t.pf && (t.pfSide === 'left' ? -1 : 1) * mir < 0);
      if (left) return left;
    }
    // halting: nearest track that has a platform
    return byDist.find((t) => t.pf) || byDist[0] || L.tracks[0];
  }

  trackOf(st) {
    const no = this.choices.get(st.index);
    return st.layout.tracks.find((t) => t.no === no) || st.layout.tracks[0];
  }

  homeS(st) {
    const L = st.layout;
    return (L.xoEntry ? L.xoEntry.s0 : L.pStart - L.maxFanEntry) - 90;
  }

  starterS(st) { return st.layout.pEnd + 12; }

  // force: the track's occupant has been ordered out (Traffic.vacate); the home signal
  // stays at danger until it has actually cleared our route.
  choose(st, trackNo, force = false) {
    if (this.locked.has(st.index)) return 'locked';
    if (st.forcedTrack && st.forcedTrack !== trackNo) return 'forced';
    const occ = st.occupancy.get(trackNo);
    if (occ && !(force && occ.vacating)) return 'occupied';
    const tr = st.layout.tracks.find((t) => t.no === trackNo);
    if (tr && !this.usable(st, tr)) return 'locked';
    this.choices.set(st.index, trackNo);
    this.userPicked.add(st.index);
    this.lane = this.layout.buildLane(this.choices);
    return 'ok';
  }

  // Re-pick defaults after the stop list changed (only for unlocked stations).
  refreshDefaults() {
    for (const st of this.layout.stations) {
      if (this.locked.has(st.index) || st.isOrigin) continue;
      const cur = this.trackOf(st);
      if (st.halt && !cur.pf) this.choices.set(st.index, this.defaultTrack(st).no);
    }
    this.lane = this.layout.buildLane(this.choices);
  }

  nextStation(sFront) {
    for (const st of this.layout.stations) if (st.layout.pEnd + 5 > sFront && !st.isOrigin) return st;
    return null;
  }

  currentStation(sFront) { return this.layout.stationAt(sFront); }

  // Station the selector panel should show: the next one with >1 line, from
  // 40 s (at current speed) or 10 real km before its home signal, whichever comes first.
  selectorStation(sFront, speedMs = 0) {
    for (const st of this.layout.stations) {
      if (st.isOrigin) continue;
      const home = this.homeS(st);
      if (home + 20 < sFront) continue;
      if (st.layout.tracks.length < 2) return null;
      // offered 10 km (real) or 40 s before the home signal, whichever comes first,
      // and only once the train is on the move (not while standing at the previous station)
      if (speedMs < 1) {
        const at = this.layout.stationAt(sFront);
        if (at && at !== st) return null;
      }
      const km = this.layout.realKmAt(home) - this.layout.realKmAt(sFront);
      const secs = (home - sFront) / Math.max(0.1, speedMs);
      return km <= 10 || secs <= 40 ? st : null;
    }
    return null;
  }

  // Precedence: loop our train at `st` so a higher-priority train can overtake.
  forcePrecedence(st, loop, train) {
    this.choices.set(st.index, loop.no);
    st.forcedTrack = loop.no;
    st.precedence = { train, state: 'pending' };
    this.lane = this.layout.buildLane(this.choices);
  }

  // Long trains (a 58-wagon goods) draw right up to the starter so the rear clears the points.
  stopPoint(st) { return this.isLong(st) ? this.starterS(st) - 10 : st.layout.pEnd - 14; }
  isLong(st) { return this.trainLen > st.layout.pLen - 30; }

  // ------------------------------------------------------------ signals
  _buildSignals() {
    const L = this.layout;
    const sigs = [];
    for (const st of L.stations) {
      if (!st.isOrigin) sigs.push({ kind: 'Home', s: this.homeS(st), st, lat: playerMain(st.layout.entryLine) - 3.0 });
      if (!st.isDest) sigs.push({ kind: 'Starter', s: this.starterS(st), st });
    }
    // Intermediate block signals (automatic) on double-line sections: they split
    // long sections into blocks so a train ahead is protected and can be followed.
    const ibs = [];
    L.gaps.forEach((g, i) => {
      if (g.line !== 'D') return;
      const prev = L.stations[i], next = L.stations[i + 1];
      const a = this.starterS(prev) + 700, b = this.homeS(next) - 1150;
      if (b - a < 300) return;
      const n = Math.max(1, Math.round((b - a) / 850));
      for (let k = 0; k < n; k++) {
        let s = n === 1 ? (a + b) / 2 : a + ((b - a) * k) / (n - 1);
        if (this.avoidSignal) s = this.avoidSignal(s);
        const sig = { kind: 'IBS', s, gap: g, lat: playerMain('D') - 3.0, no: `${prev.code}-${next.code} ${k + 1}` };
        ibs.push(sig); sigs.push(sig);
      }
    });
    sigs.sort((p, q) => p.s - q.s);
    sigs.forEach((sg, i) => { sg.index = i; });
    this.sigs = sigs;
    this.ibs = ibs;
    this.aspects = new Map();
  }

  // Is the block [s0, s1) on our route occupied by any AI train?
  blockOccupied(s0, s1, exclude = null) {
    for (const t of this.trains()) {
      if (t === exclude || t.parked) continue;
      const lo = t.dir > 0 ? t.s - t.consist.length : t.s;
      const hi = t.dir > 0 ? t.s : t.s + t.consist.length;
      const a = Math.max(lo, s0), b = Math.min(hi, s1);
      if (b <= a) continue;
      for (const x of [a, (a + b) / 2, b]) {
        if (Math.abs(t.lane.at(x) - this.lane.at(x)) < 1.6) return t;
      }
    }
    return null;
  }

  // Does train t occupy, or is it about to run over, our route between the
  // home signal and the platform at station st?
  _conflictsAt(st, t) {
    if (t.parked || t.s < -1e8) return false;
    const L = st.layout;
    let lo = t.dir > 0 ? t.s - t.consist.length : t.s;
    let hi = t.dir > 0 ? t.s : t.s + t.consist.length;
    if (t.kind === 'station' && t.st === st && t.state === 'arriving') lo = Math.min(lo, L.pStart + 10);
    if (t.kind === 'crossing' && t.st === st && t.cr?.state !== 'cleared') lo = Math.min(lo, L.pStart);
    const a = Math.max(lo, L.zoneStart - 60), b = Math.min(hi, L.pEnd);
    for (let x = a; x <= b; x += 8) if (Math.abs(t.lane.at(x) - this.lane.at(x)) < 2.4) return true;
    return false;
  }

  stationOwn(sg) {
    const st = sg.st;
    if (sg.kind === 'Home') {
      const tr = this.trackOf(st);
      if (this.pointsMoving && this.pointsMoving(st)) return { aspect: 'RED', featherDir: 0 };
      const div = isDiverging(st.layout, tr);
      if (this.busyEnabled && st.busy && st.busy.state !== 'cleared') return { aspect: 'RED', featherDir: 0, reason: 'Station busy — waiting for a platform' };
      // route interlocking: no proceed aspect while another train is on (or about to cross) our route through the throat
      const occ = st.occupancy.get(tr.no);
      if (occ && occ.vacating) return { aspect: 'RED', featherDir: 0, reason: `Waiting for ${occ.name} to clear ${tr.name}` };
      const clash = this.trains().find((t) => this._conflictsAt(st, t));
      if (clash) return { aspect: 'RED', featherDir: 0, reason: `Conflicting movement: ${clash.name || 'train'} crossing our route` };
      const halting = st.halt || st.isDest || this.mustWaitAt(st);
      return { aspect: halting || div ? 'YELLOW' : 'GREEN', featherDir: div ? Math.sign(tr.o - playerMain(st.layout.entryLine)) : 0 };
    }
    if (sg.kind === 'Starter') {
      if (st.isDest) return { aspect: 'RED' };
      if (this.pointsMoving && this.pointsMoving(st)) return { aspect: 'RED' };
      const cr = this.crossings.get(st.index);
      if (cr && cr.state !== 'cleared') return { aspect: 'RED' };
      if (this.trains().some((t) => t.blocksStarter === st)) return { aspect: 'RED' }; // a train is arriving across our path
      if (st.precedence && st.precedence.state !== 'cleared') return { aspect: 'RED', reason: `Precedence: ${st.precedence.train.name} to pass` };
      if (!this.dwellDone(st)) return { aspect: 'RED' };
      if (st.exam && st.exam.state !== 'done') return { aspect: 'RED', reason: 'Hot axle — stop for examination' };
      if (st.shunt && st.shunt.state !== 'done') return { aspect: 'RED', reason: 'Shunting in progress' };
      if (st.reversal && !st.engineChanged) return { aspect: 'RED' }; // engine must be changed first
      if (st.tractionChange && !st.engineChanged) return { aspect: 'RED', reason: `Traction change: couple the ${st.tractionChange} first` };
      return { aspect: 'GREEN' };
    }
    return { aspect: 'GREEN' };
  }

  // Aspects for the signals around the train, chained from far to near.
  // A signal returns to danger the moment our engine passes it, and stays red
  // while any part of our train is still in the block it protects.
  computeAspects(sFront, trainLen = 0) {
    const sigs = this.sigs;
    const rear = sFront - trainLen;
    let i0 = sigs.findIndex((sg) => sg.s > rear - 3500);
    if (i0 < 0) i0 = sigs.length;
    const i1 = Math.min(sigs.length - 1, i0 + 9);
    let nextAspect = 'GREEN';
    for (let i = i1; i >= i0; i--) {
      const sg = sigs[i];
      const own = this.stationOwn(sg);
      const blockEnd = i + 1 < sigs.length ? sigs[i + 1].s : this.layout.total;
      let aspect = sg.failed ? 'RED' : own.aspect;
      const mine = sg.s <= sFront && blockEnd > rear; // our own train is in this block
      const occ = mine ? null : this.blockOccupied(sg.s, blockEnd);
      if (occ || mine) aspect = 'RED';
      if (aspect !== 'RED' && i < i1) aspect = minAspect(aspect, derive(nextAspect));
      this.aspects.set(sg, { aspect, featherDir: mine ? 0 : own.featherDir || 0, occupiedBy: occ, reason: sg.failed ? 'Signal defective' : mine ? 'Our train in block' : own.aspect === 'RED' && own.reason ? own.reason : occ ? 'Block ahead occupied' : own.reason || null });
      nextAspect = aspect;
    }
  }

  aspectOf(sg) { return this.aspects.get(sg) || { aspect: 'RED', featherDir: 0 }; }

  homeAspect(st) {
    const sg = this.sigs.find((x) => x.kind === 'Home' && x.st === st);
    return sg ? this.aspectOf(sg) : { aspect: 'GREEN', featherDir: 0 };
  }

  starterAspect(st) {
    const sg = this.sigs.find((x) => x.kind === 'Starter' && x.st === st);
    return sg ? this.aspectOf(sg).aspect : 'RED';
  }

  // Signals ahead (incl. distant repeaters) in order: [{ s, kind, st, aspect, featherDir }]
  signalsAhead(sFront, maxCount = 3) {
    const out = [];
    for (const sg of this.sigs) {
      if (sg.kind === 'Home') {
        const sd = sg.s - 1000;
        const prev = this.layout.stations[sg.st.index - 1];
        if (sd > sFront && (!prev || sd > prev.layout.zoneEnd + 60)) {
          const h = this.aspectOf(sg).aspect;
          out.push({ s: sd, kind: 'Distant', st: sg.st, aspect: h === 'RED' ? 'YELLOW' : h === 'GREEN' ? 'GREEN' : 'DOUBLE_YELLOW', featherDir: 0 });
        }
      }
      if (sg.s > sFront) {
        const a = this.aspectOf(sg);
        out.push({ s: sg.s, kind: sg.kind, st: sg.st, sig: sg, aspect: a.aspect, featherDir: a.featherDir, reason: a.reason, label: sg.kind === 'IBS' ? `IBS ${sg.no}` : null });
      }
      if (out.length >= maxCount + 2 && sg.s > sFront) break;
    }
    return out.sort((a, b) => a.s - b.s).slice(0, maxCount);
  }

  // ------------------------------------------------------------ dwell & halts
  mustWaitAt(st) {
    return (st.tractionChange && !st.engineChanged) || (st.exam && st.exam.state !== 'done') || (st.halt && !this.dwellDone(st)) || (st.reversal && !st.engineChanged) || (st.precedence && st.precedence.state !== 'cleared') || (this.crossings.get(st.index) && this.crossings.get(st.index).state !== 'cleared');
  }

  dwellLeft(st) {
    if (st.isOrigin || !st.halt) return 0;
    return Math.max(0, st.dwellMin - (this.dwell.get(st.index) || 0));
  }

  dwellDone(st) {
    if (st.isOrigin) return this.departedOrigin;
    if (!st.halt) return true;
    return (this.dwell.get(st.index) || 0) >= st.dwellMin;
  }

  update(dt, sim) {
    const { sFront, speed, trainLen } = sim;
    const L = this.layout;
    const events = [];
    if (!this.departedOrigin) {
      this.originTimer += sim.gameDt ?? dt * 0.4; // journey-clock minutes
      if (this.originTimer >= (this.originDwell ?? 2)) this.departedOrigin = true;
    }
    for (const st of L.stations) {
      if (st.busy && this.busyEnabled && st.busy.state !== 'cleared' && sFront > this.homeS(st) - 700) {
        if (st.busy.state === 'pending') { st.busy.state = 'holding'; events.push({ type: 'busy', st }); }
        const b = st.busy;
        b.t += dt;
        let clear;
        if (b.train) {
          // a real train is standing on our platform: clear once it has left it,
          // or straight away if we were given another platform instead
          const tr = b.train;
          clear = !this.trains().includes(tr) || tr.s - tr.consist.length > st.layout.pEnd + (b.track.fanExit || 0) + 30 || this.trackOf(st) !== b.track;
        } else clear = b.t > b.hold;
        if (clear) { b.state = 'cleared'; events.push({ type: 'busyClear', st }); }
      }
      if (st.precedence && st.precedence.state === 'pending') {
        const t = st.precedence.train;
        if (!t || t.s - t.consist.length > st.layout.zoneEnd + 30 || !this.trains().includes(t)) { st.precedence.state = 'cleared'; events.push({ type: 'precedenceClear', st }); }
      }
      if (!st.isOrigin && sFront > this.homeS(st) && !this.locked.has(st.index)) {
        this.locked.add(st.index);
        events.push({ type: 'locked', st });
      }
      if (!st.isOrigin && !this.arrived.has(st.index) && sFront > st.layout.zoneStart && sFront < st.layout.pEnd) {
        this.arrived.add(st.index);
        events.push({ type: 'arriving', st });
      }
      if (st.halt && !st.isOrigin) {
        const inPf = this.isLong(st)
          ? sFront <= this.starterS(st) - 2 && sFront > st.layout.pEnd - 160
          : sFront <= st.layout.pEnd + 2 && sFront - trainLen >= st.layout.pStart - 25 && sFront > st.layout.pStart;
        if (inPf && speed < 0.3) {
          const before = this.dwell.get(st.index) || 0;
          const add = sim.gameDt ?? dt * 0.4; // journey-clock minutes
          this.dwell.set(st.index, before + add);
          if (before === 0) events.push({ type: 'halted', st });
          if (before < st.dwellMin && before + add >= st.dwellMin) events.push({ type: 'ready', st });
        }
      }
    }
    this.computeAspects(sFront, trainLen);
    return events;
  }

  // ------------------------------------------------------------ speed limits
  // Section speed independent of the rake.
  sectionCap(s) {
    const g = this.layout.gapAt(s);
    if (!g) return 160;
    if (g.trackType.includes('GHAT')) return 100;
    if (g.trackType.includes('HIGH_SPEED')) return 160;
    if (g.trackType.startsWith('SINGLE')) return 120;
    return 140;
  }

  lineSpeedCap(s) {
    const g = this.layout.gapAt(s);
    const vmax = RAKES[this.rakeType].vmax;
    if (!g) return vmax;
    return Math.min(vmax, this.sectionCap(s), this.weatherCap ?? Infinity);
  }

  // Limit at a single point of the player's route.
  pointLimit(s) {
    let lim = this.lineSpeedCap(s);
    const c = this.layout.curveAt(s);
    if (c) lim = Math.min(lim, c.vLimit);
    if (this.lane.inTransition(s)) lim = Math.min(lim, LOOP_LIMIT);
    const st = this.layout.stationAt(s);
    if (st) {
      const tr = this.trackOf(st);
      if (!tr.isThrough && s > st.layout.pStart - tr.fanEntry && s < st.layout.pEnd + tr.fanExit) lim = Math.min(lim, LOOP_LIMIT);
    }
    for (const t of this.tempLimits) if (s >= t.s0 && s <= t.s1 && (!t.active || t.active())) lim = Math.min(lim, t.kmh);
    return lim;
  }

  tempLimitAt(s) {
    let best = null;
    for (const t of this.tempLimits) if (s >= t.s0 && s <= t.s1 && (!t.active || t.active()) && (!best || t.kmh < best.kmh)) best = t;
    return best;
  }

  activeHolds(sFront, range = 4000) {
    return this.holdPoints.filter((h) => h.active && h.s > sFront - 2 && h.s - sFront < range).sort((a, b) => a.s - b.s);
  }

  limitAt(sFront, trainLen) {
    let lim = Infinity;
    for (let k = 0; k <= trainLen; k += 15) lim = Math.min(lim, this.pointLimit(sFront - k));
    return lim;
  }

  // Next lower limit ahead of the front: { limit, dist }
  nextLimit(sFront, current, range = 2500) {
    for (let d = 20; d < range; d += 20) {
      const l = this.pointLimit(sFront + d);
      if (l < current - 0.5) return { limit: l, dist: d };
    }
    return null;
  }

  // Overspeed beyond what the track can physically take => derailment reason.
  derailCheck(sFront, trainLen, kmh) {
    for (let k = 0; k <= trainLen; k += 10) {
      const s = sFront - k;
      const st = this.layout.stationAt(s);
      const onTurnout = this.lane.inTransition(s);
      if (onTurnout && kmh > DERAIL_TURNOUT) return `${Math.round(kmh)} km/h through a ${LOOP_LIMIT} km/h turnout`;
      if (st) {
        const tr = this.trackOf(st);
        if (!tr.isThrough && kmh > DERAIL_LOOP && s > st.layout.pStart - tr.fanEntry && s < st.layout.pEnd + tr.fanExit) return `${Math.round(kmh)} km/h on a ${LOOP_LIMIT} km/h loop line`;
      }
      const c = this.layout.curveAt(s);
      if (c && kmh > c.vLimit * DERAIL_CURVE_FACTOR) return `${Math.round(kmh)} km/h on a ${c.vLimit} km/h curve (R ${Math.round(c.R)} m)`;
    }
    return null;
  }

  // Kavach (ATP) supervision: returns a brake demand 0..100 or 0.
  kavach(sFront, speedMs, trainLen) {
    const kmh = speedMs * 3.6;
    const B = this.brakeMax, lagM = speedMs * this.brakeLag * 0.6; // distance run while the brakes build up
    let demand = 0, reason = null;
    const lim = this.limitAt(sFront, trainLen);
    if (kmh > lim + 6) { demand = 60; reason = `overspeed ${Math.round(kmh)}/${Math.round(lim)}`; }
    // braking curve with margin against the MOST restrictive limit ahead (e.g. a 30 km/h loop
    // turnout behind a milder curve limit), so the train really makes it
    let worst = null;
    const look = Math.max(1800, (speedMs * speedMs) / (2 * B * 0.5) + lagM + 300);
    for (let d = 20; d < look; d += 20) {
      const l = this.pointLimit(sFront + d);
      if (l >= lim - 0.5) continue;
      const need = (speedMs * speedMs - (l / 3.6) ** 2) / (2 * Math.max(5, d - 40 - lagM));
      if (!worst || need > worst.need) worst = { need, l };
    }
    if (worst && worst.need > 0.41 * B) { demand = Math.max(demand, Math.min(100, 45 + (worst.need / (0.82 * B)) * 55)); reason = `limit ${worst.l} ahead`; }
    const stopFor = (d, why) => {
      const need = (speedMs * speedMs) / (2 * Math.max(1, d - lagM));
      if (need > 0.65 * B) { demand = Math.max(demand, Math.min(100, (need / B) * 130)); reason = why(d); }
    };
    for (const sg of this.signalsAhead(sFront, 4)) {
      if (sg.kind === 'Distant' || sg.aspect !== 'RED' || sg.sig?.authority) continue;
      stopFor(sg.s - 8 - sFront, (d) => `red signal ${Math.round(d)} m`);
      break;
    }
    for (const h of this.activeHolds(sFront)) { if (h.kavach === false) continue; stopFor(h.s - 8 - sFront, (d) => `${h.short || 'stop'} ${Math.round(d)} m`); break; }
    return { demand, reason };
  }

  autoTarget(sFront, speedMs, trainLen) {
    const decel = 0.38 * this.brakeMax;
    let vAllow = this.limitAt(sFront, trainLen) / 3.6;
    let stopDist = Infinity;
    const lagM = speedMs * this.brakeLag * 0.5;
    const consider = (dist, vEnd) => {
      if (dist < -2) return;
      vAllow = Math.min(vAllow, Math.sqrt(vEnd * vEnd + 2 * decel * Math.max(0, dist - lagM)));
      if (vEnd === 0) stopDist = Math.min(stopDist, Math.max(0, dist));
    };
    for (const sig of this.signalsAhead(sFront, 5)) {
      if (sig.kind === 'Distant') continue;
      if (sig.sig?.authority) continue; // written authority to pass a failed signal
      if (sig.aspect === 'RED') { consider(sig.s - 20 - sFront, 0); break; }
    }
    for (const h of this.activeHolds(sFront)) { consider(h.s - 15 - sFront, 0); break; }
    const nst = this.nextStation(sFront);
    if (nst && this.mustWaitAt(nst)) consider(this.stopPoint(nst) - sFront, 0);
    for (let d = 20; d < Math.max(2600, 600 + (speedMs * speedMs) / decel); d += 25) {
      const l = this.pointLimit(sFront + d) / 3.6;
      consider(d - 10 - speedMs * 1.5, l); // arrive at the lower limit with a little margin
    }
    return { target: vAllow * 3.6, stopDist };
  }
}

// ======================================================================
// AI traffic: oncoming trains (double line), single-line crossings, and
// same-direction trains ahead that are looped at stations so we can overtake.
// ======================================================================
export class Traffic {
  // Another train sounds its horn (leaving a station, approaching us...): loudness / tone from its distance to our
  // train, panned to the side it is on. Silent beyond ~2.5 km.
  _horn(t, kind = 'depart') {
    if (!this.audio) return;
    const sF = this._front ?? t.s, d = Math.abs(t.s - sF);
    if (d > 2500) return;
    const lat = t.lane.at(t.s) - (this._lane ? this._lane.at(sF) : 0);
    const gain = Math.min(0.55, 260 / (d + 60)) * (kind === 'near' ? 1 : 0.85);
    const pan = Math.max(-0.85, Math.min(0.85, lat / 10 + (t.s > sF ? 0.1 : -0.1)));
    this.audio.distantHorn(gain, pan, kind === 'near' ? 1.8 : 1.4);
  }

  // Control orders a standing train out of a platform line so we can be received there.
  _occupant(st, no) {
    const occ = st.occupancy.get(no);
    if (!occ) return null;
    if (occ.kind === 'parked') return { occ, kind: 'parked' };
    if (occ.kind !== 'ai') return null; // reserved for a crossing: cannot be given away
    const t = this.trains.find((x) => (x.kind === 'station' && x.st === st && x.track?.no === no && x.state === 'dwell')
      || (x.kind === 'ahead' && x.busySt === st && x.busySt.busy?.track?.no === no && x.state === 'platform'));
    return t ? { occ, kind: t.kind, t } : null;
  }

  canVacate(st, no) { return !!this._occupant(st, no); }

  vacate(st, no) {
    const o = this._occupant(st, no);
    if (!o) return false;
    if (o.kind === 'parked') { // stabled rake: shunted away to the yard
      o.occ.group?.removeFromParent();
      st.occupancy.delete(no);
      return true;
    }
    o.occ.vacating = true;
    if (o.kind === 'station') { o.t.waitLeft = 0; o.t.terminates = false; }
    else st.busy.hold = 0; // busy-station train: leaves ahead of us now
    return true;
  }

  // Distance from t's front to the nearest train on the same track ahead of it
  // (same direction: to its rear; opposite direction: head to head).
  _gapAhead(t) {
    let best = Infinity;
    for (const u of this.trains) {
      if (u === t || u.s < -1e8) continue;
      const ahead = (u.s - t.s) * t.dir;
      if (u.dir === t.dir) {
        const tail = u.s - u.dir * u.consist.length;
        const gap = (tail - t.s) * t.dir;
        if (ahead <= 0 || gap > 600) continue;
        if (Math.abs(t.lane.at(tail) - u.lane.at(tail)) > 1.5) continue;
        best = Math.min(best, Math.max(0, gap));
      } else {
        if (ahead <= 0 || ahead > 800) continue;
        const mid = (t.s + u.s) / 2;
        if (Math.abs(t.lane.at(mid) - u.lane.at(mid)) > 1.5) continue;
        best = Math.min(best, ahead);
      }
    }
    return best;
  }

  constructor(scene, layout, ops, makeConsist, audio) {
    this.scene = scene;
    this.layout = layout;
    this.ops = ops;
    this.makeConsist = makeConsist;
    this.audio = audio;
    this.trains = [];
    this.cooldown = 25;
    this.aheadCooldown = 20;
    this.rand = makeRng(layout.stations[0].code, 'traffic');
    ops.trains = () => this.trains;
  }

  dispose() { for (const t of this.trains) t.consist.dispose(); this.trains = []; }

  clearAll() { this.dispose(); }

  _spawnAhead(sFront) {
    const L = this.layout;
    const s0 = sFront + 1900 + this.rand() * 900;
    if (s0 > L.trackMax - 3000 || L.lineAt(s0) !== 'D' || L.stationAt(s0, 300)) return;
    // need at least one more double-line station with a loop ahead
    const goods = this.rand() < 0.6;
    const ctx = { s: s0, dir: 1 };
    const rake = goods ? 'BOXN_GOODS' : this.ops.namer.pickRake(['DEMU_PASSENGER', 'ICF'], this.rand, ctx);
    const vmax = (goods ? 55 + this.rand() * 10 : 75) / 3.6;
    if (vmax * 3.6 >= RAKES[this.ops.rakeType].vmax - 10) return; // nothing to overtake
    const consist = this.makeConsist(rake, goods ? 20 : 7);
    this.scene.add(consist.group);
    const name = this.ops.namer.name(rake, this.rand, ctx);
    this.trains.push({ kind: 'ahead', consist, s: s0, v: vmax, vmax, lane: new Lane(playerMain('D')), dir: 1, name, state: 'running', horned: false });
  }

  // Send the train ahead into a free loop at the next station so we can overtake.
  _planLoop(t, sFront) {
    const ops = this.ops;
    for (const st of this.layout.stations) {
      if (st.layout.pStart < t.s + 200) continue;
      const L = st.layout;
      if (L.entryLine !== 'D' || L.exitLine !== 'D' || st.isDest) return;
      const pm = playerMain('D');
      const chosen = ops.choices.get(st.index);
      const loop = L.tracks.find((tr) => !tr.isThrough && tr.no !== chosen && !st.occupancy.has(tr.no)
        && Math.abs(tr.mEntry - pm) < 0.01 && Math.abs(tr.mExit - pm) < 0.01);
      if (!loop) continue;
      st.occupancy.set(loop.no, { kind: 'ai', rake: t.consist.rakeType, name: `${t.name} (being overtaken)` });
      t.lane = addTrackExit(addTrackEntry(new Lane(pm), L, loop), L, loop);
      t.loop = { st, track: loop };
      t.state = 'toLoop';
      return;
    }
  }

  // Station activity: other trains arrive on free platforms at major stations
  // while we are halted there, dwell, and depart toward where we came from.
  _stationActivity(dt, sFront, playerSpeed) {
    const ops = this.ops;
    const st = this.layout.stationAt(sFront);
    if (!st || (st.category === 'station' && !st.reversal) || playerSpeed > 0.3) { this.actTimer = 8 + this.rand() * 8; return; }
    if (this.trains.some((t) => t.kind === 'station' && t.st === st && t.state !== 'leaving')) return;
    this.actTimer = (this.actTimer ?? 10) - dt;
    if (this.actTimer > 0) return;
    this.actTimer = 25 + this.rand() * 30;
    const cands = this._arrivalTracks(st, false);
    if (!cands.length) return;
    this._arrive(st, cands[Math.floor(this.rand() * cands.length)]);
  }

  // Platforms a train coming in from the far end can take without running
  // head-on down our own line (on a single line any loop will do).
  _arrivalTracks(st, includeMine) {
    const L = st.layout, mine = this.ops.trackOf(st);
    const px = playerMainOf(L.exitLine);
    // not the lines that lead off to another route (Guntakal's branches): they don't continue along ours
    const offRoute = (t) => t.branchExit || (L.gtlLadderExit && Math.abs(Math.abs(t.mExit) - 2.65) > 0.1);
    return L.tracks.filter((t) => (includeMine || t !== mine) && !st.occupancy.has(t.no) && t.pf && !offRoute(t) && (L.exitLine === 'S' || Math.abs(t.mExit - px) > 0.01));
  }

  // A train arrives from the far end onto `track`, dwells and leaves again.
  _arrive(st, track) {
    const L = st.layout;
    if (st.terminal && st.isDest) return false; // the far end is the buffer stops
    // it comes in from the far end, travelling against our direction
    const ctx = st.gapOut ? { s: L.zoneEnd + 100, dir: -1 } : { st };
    const rake = this.ops.namer.pickRake(TRAFFIC_MIX, this.rand, ctx);
    const carLen = rake === 'ICF' || rake === 'DEMU_PASSENGER' ? 22 : 24;
    const cars = Math.max(4, Math.min(rake === 'DEMU_PASSENGER' ? 8 : 14, Math.floor((L.pLen - 55) / carLen)));
    const consist = this.makeConsist(rake, cars);
    if (consist.length > L.pLen - 20) { consist.dispose(); return false; }
    this.scene.add(consist.group);
    const name = this.ops.namer.name(rake, this.rand, ctx);
    st.occupancy.set(track.no, { kind: 'ai', rake, name: `${name} (arriving)` });
    const s0 = Math.min(L.zoneEnd + 900, this.layout.total - 260);
    if (this.trains.some((u) => u.s > -1e8 && Math.abs(u.s - s0) < 900 && Math.abs(u.lane.at(s0) - track.lane.at(s0)) < 1.5)) {
      st.occupancy.delete(track.no); consist.dispose(); return false; // approach line not clear yet
    }
    const tr = { kind: 'station', consist, s: s0, v: 55 / 3.6, vmax: 55 / 3.6, lane: track.lane, dir: -1, st, track, name, state: 'arriving', blocksStarter: st, atStation: st, atTrack: track, horned: false, dwellMin: 2 + Math.floor(this.rand() * 4), terminates: !!st.terminal };
    this.trains.push(tr);
    // expected arrival: approach distance at ~10 m/s; the clock runs 8x while we stand
    const secs = (s0 - (L.pStart + 14)) / 10 + 8;
    tr.eta = this.now + (secs * 8) / 60;
    this.onStationEvent?.('expected', tr);
    this._horn(tr, 'arrive');
    return tr;
  }

  // While the line-selection panel is up for the station ahead, other trains
  // keep arriving there: platforms fill up live, and if one takes the line we
  // were (by default) booked for, control reroutes us to another free line.
  _approachActivity(dt, sFront, playerSpeed) {
    const ops = this.ops;
    const st = ops.selectorStation(sFront, playerSpeed);
    if (!st || ops.locked.has(st.index) || st.isOrigin || st.layout.tracks.filter((t) => t.pf).length < 2) { this.apTimer = 6 + this.rand() * 8; return; }
    if (this.trains.some((t) => t.kind === 'station' && t.st === st && t.state === 'arriving')) return;
    this.apTimer = (this.apTimer ?? 8) - dt;
    if (this.apTimer > 0) return;
    this.apTimer = 25 + this.rand() * 35;
    if (this.rand() < 0.35) return;
    const mine = ops.trackOf(st);
    const mayTakeMine = !ops.userPicked.has(st.index) && !st.forcedTrack && !(st.busy && st.busy.train) && this.rand() < 0.35;
    // with bidirectional platform signalling a train can also be received on our
    // side via the far-end crossovers; it is held there until we have gone
    const L = st.layout, px = playerMainOf(L.exitLine);
    const all = mayTakeMine ? L.tracks.filter((t) => t.pf && !st.occupancy.has(t.no)) : this._arrivalTracks(st, false);
    if (!all.length) return;
    const track = mayTakeMine && all.includes(mine) ? mine : all.filter((t) => t !== mine)[Math.floor(this.rand() * Math.max(1, all.length - 1))] || all[0];
    if (track === mine && ops.freeTracks(st).filter((t) => t !== mine && (!st.halt || t.pf)).length === 0) return; // nowhere to put us
    const tr = this._arrive(st, track);
    if (!tr) return;
    if (L.exitLine !== 'S' && Math.abs(track.mExit - px) < 0.01) { tr.terminates = true; tr.name += ' (held for path)'; }
    if (track === mine) {
      const prev = mine.name;
      ops.choices.set(st.index, ops.defaultTrack(st).no);
      ops.lane = this.layout.buildLane(ops.choices);
      this.onReroute?.(st, prev, ops.trackOf(st), tr);
    } else this.onPlatformTaken?.(st, track, tr);
  }

  // Busy station: a real train is standing on the platform we are booked for.
  // We are held at the home signal outside until it departs ahead of us.
  _busyBlockers(sFront) {
    const ops = this.ops;
    if (!ops.busyEnabled) return;
    for (const st of this.layout.stations) {
      const b = st.busy;
      if (!b || b.state === 'cleared' || b.spawned) continue;
      const h = ops.homeS(st);
      if (sFront < h - 3500 || sFront > h - 200) continue;
      b.spawned = true;
      const L = st.layout, track = ops.trackOf(st);
      if (st.occupancy.has(track.no)) continue; // something is already there: plain timed hold
      const goods = !track.pf;
      const bctx = { s: L.zoneEnd + 100, dir: 1 }; // it leaves ahead of us
      const rake = goods ? 'BOXN_GOODS' : ops.namer.pickRake(['LHB', 'ICF', 'ICF', 'DEMU_PASSENGER', 'LHB'], this.rand, bctx);
      const carLen = goods ? 10.7 : rake === 'ICF' || rake === 'DEMU_PASSENGER' ? 22 : 24;
      const cars = Math.max(4, Math.min(goods ? 40 : rake === 'DEMU_PASSENGER' ? 8 : 16, Math.floor((L.pLen - 60) / carLen)));
      const consist = this.makeConsist(rake, cars);
      if (consist.length > L.pLen - 20) { consist.dispose(); continue; }
      this.scene.add(consist.group);
      const name = ops.namer.name(rake, this.rand, bctx);
      const vmax = Math.min(RAKES[rake].vmax, goods ? 65 : 110) / 3.6;
      // it runs out over our own booked route, so it leaves on our line ahead of us
      const tr = { kind: 'ahead', state: 'platform', busySt: st, consist, s: L.pEnd - 14, v: 0, vmax, lane: ops.lane, dir: 1, name, horned: true };
      this.trains.push(tr);
      st.occupancy.set(track.no, { kind: 'ai', rake, name: `${name} (on platform)` });
      b.train = tr; b.track = track;
    }
  }

  // Clear standing room on a loop: from where it is clear of the main line to our stop point.
  _clearStanding(st, track, pm) {
    const L = st.layout;
    const lane = addTrackEntry(new Lane(pm), L, track);
    const stop = this.ops.isLong(st) ? this.ops.starterS(st) - 10 : L.pEnd - 14;
    let s = L.pEnd;
    while (s > L.zoneStart - 400 && Math.abs(lane.at(s) - pm) > 4.0) s -= 5;
    return stop - s;
  }

  // A higher-priority train comes up behind us; we get looped at the next
  // suitable station so it can overtake (precedence).
  _spawnBehind(sFront, trainLen) {
    const ops = this.ops, L = this.layout;
    const myP = PRIORITY[ops.rakeType] ?? 3;
    if (myP >= 5) return;
    const st = L.stations.find((x) => !x.isOrigin && !x.isDest && !ops.locked.has(x.index) && !x.precedence && !x.reversal
      && ops.homeS(x) - sFront > 3000 && ops.homeS(x) - sFront < 9000);
    if (!st) return;
    if (st.layout.entryLine !== 'D' || st.layout.exitLine !== 'D') return; // overtaking needs a double line
    const pmE = playerMain(st.layout.entryLine), pmX = playerMain(st.layout.exitLine);
    const loop = st.layout.tracks.find((t) => !t.isThrough && !st.occupancy.has(t.no) && Math.abs(t.mEntry - pmE) < 0.01 && Math.abs(t.mExit - pmX) < 0.01
      && this._clearStanding(st, t, pmE) >= trainLen + 15);
    if (!loop) return;
    const s0 = sFront - trainLen - 2300;
    if (s0 < L.stations[0].layout.zoneEnd + 200) return;
    for (let x = s0; x < ops.homeS(st); x += 200) if (L.lineAt(x) !== 'D') return;
    const ctx = { s: s0, dir: 1 };
    const list = (myP < 4 ? ['LHB', 'LHB', 'RAJDHANI', 'DURANTO', 'VANDE_BHARAT'] : ['RAJDHANI', 'DURANTO', 'VANDE_BHARAT']).filter((r) => (PRIORITY[r] ?? 0) > myP && this.ops.namer.allowed(r, ctx));
    if (!list.length) return;
    const rake = pick(this.rand, list);
    // the overtaking train runs on the running lines through every station
    const mainChoices = new Map();
    for (const x of L.stations) {
      const pm = playerMain(x.layout.entryLine);
      const t = x.layout.tracks.filter((tr) => tr.isThrough).sort((a, b) => Math.abs(a.o - pm) - Math.abs(b.o - pm))[0] || x.layout.tracks[0];
      mainChoices.set(x.index, t.no);
    }
    const consist = this.makeConsist(rake, rake === 'VANDE_BHARAT' ? 8 : 12);
    this.scene.add(consist.group);
    const name = this.ops.namer.name(rake, this.rand, ctx);
    const vmax = Math.min(RAKES[rake].vmax, 130) / 3.6;
    const tr = { kind: 'behind', consist, s: s0, v: vmax * 0.8, vmax, lane: L.buildLane(mainChoices), dir: 1, name, horned: false };
    this.trains.push(tr);
    ops.forcePrecedence(st, loop, tr);
    this.onPrecedence?.(st, loop, tr);
    return true;
  }

  update(dt, sFront, playerSpeed, playerLane, trainLen, now = 0) {
    this._front = sFront; this._lane = playerLane;
    const gdt = this.now === undefined ? 0 : ((now - this.now) + 1440) % 1440;
    this.gdt = gdt < 60 ? gdt : 0;
    this.now = now;
    const L = this.layout;
    this._stationActivity(dt, sFront, playerSpeed);
    this._busyBlockers(sFront);
    this._approachActivity(dt, sFront, playerSpeed);
    this.behindCooldown = (this.behindCooldown ?? 60) - dt;
    if (this.behindCooldown <= 0 && !this.trains.some((t) => t.kind === 'behind')) {
      this.behindCooldown = this._spawnBehind(sFront, trainLen) ? 150 + this.rand() * 150 : 15;
    }
    this.cooldown -= dt;
    this.aheadCooldown -= dt;
    if (this.cooldown <= 0 && !this.trains.some((t) => t.kind === 'oncoming')) {
      const s0 = sFront + 2600 + this.rand() * 800;
      const lastSt = L.stations[L.stations.length - 1];
      const room = lastSt.terminal ? lastSt.layout.zoneStart - 200 : L.total - 400; // trains leaving a terminus start in its platforms, not beyond them
      if (s0 < room && L.lineAt(s0) === 'D' && L.lineAt(sFront + 300) === 'D') {
        const ctx = { s: s0, dir: -1 };
        const rake = this.rand() < 0.2 ? 'BOXN_GOODS' : this.ops.namer.pickRake(TRAFFIC_MIX, this.rand, ctx);
        const consist = this.makeConsist(rake, rake === 'BOXN_GOODS' ? 22 : 9);
        this.scene.add(consist.group);
        this.trains.push({ kind: 'oncoming', consist, s: s0, v: (rake === 'BOXN_GOODS' ? 65 : 105) / 3.6, lane: new Lane(TRACK.MAIN_HALF), dir: -1, horned: false, name: this.ops.namer.name(rake, this.rand, ctx) });
      }
      this.cooldown = 70 + this.rand() * 60;
    }
    if (this.aheadCooldown <= 0 && !this.trains.some((t) => t.kind === 'ahead')) {
      this._spawnAhead(sFront);
      this.aheadCooldown = 70 + this.rand() * 70;
    }
    for (const [idx, cr] of this.ops.crossings) {
      const st = L.stations[idx];
      if (cr.state === 'pending' && sFront > st.layout.zoneStart - 2500 && sFront < st.layout.pEnd) {
        const consist = this.makeConsist(cr.rake, cr.rake === 'BOXN_GOODS' ? 22 : 8);
        this.scene.add(consist.group);
        const lane = new Lane(0);
        addTrackEntry(lane, st.layout, cr.track);
        addTrackExit(lane, st.layout, cr.track);
        const tr = { kind: 'crossing', consist, s: st.layout.zoneEnd + 1600, v: 0, vmax: 60 / 3.6, lane, dir: -1, cr, st, horned: false };
        this.trains.push(tr);
        cr.state = 'approaching';
        cr.train = tr;
      }
    }
    const rear = sFront - trainLen;
    for (const t of this.trains) {
      if (t.stopped) { t.consist.place(this.layout.path, t.lane, t.s, t.dir); continue; }
      if (t.kind === 'crossing') {
        const S = t.st.layout;
        const holdAt = S.zoneEnd + 120;
        const playerIn = sFront > S.pStart && playerSpeed < 0.5 && sFront <= S.pEnd + 30;
        // we have stopped at (or just outside) the station for a while: control lets it in anyway, so a
        // crossing can never lock up waiting for a move we can't make
        const nearStill = playerSpeed < 0.5 && sFront > this.ops.homeS(t.st) - 400 && sFront <= S.pEnd + 60;
        t.stillFor = nearStill ? (t.stillFor || 0) + dt : 0;
        const mayGo = playerIn || t.s < holdAt - 5 || t.stillFor > 30;
        const outside = (at) => (t.s - at > 0 ? Math.min(t.vmax, Math.sqrt(2 * 0.5 * Math.max(0, t.s - at))) : 0);
        let target = mayGo ? t.vmax : outside(holdAt);
        // Our rear must be clear of the fouling mark where its loop joins our line behind us,
        // or its route can't be set.
        if (t.foulS === undefined) { // fouling mark: track centres closer than 4 m
          let x = S.pStart;
          while (x > S.zoneStart - 600 && Math.abs(t.lane.at(x) - playerLane.at(x)) > 4.0) x -= 5;
          t.foulS = x;
        }
        const rearClear = sFront - trainLen > t.foulS + 25;
        const fits = trainLen + 20 <= this.ops.starterS(t.st) - 10 - t.foulS; // could we stand clear at the starter?
        if (mayGo && !rearClear) {
          t.drawWait = (t.drawWait || 0) + dt;
          // a train longer than the station (58-wagon goods), or we haven't drawn up in time: see below
          if (!fits || t.drawWait > 25) t.longHold = true;
          else if (t.s >= holdAt - 5) { // still outside: keep it there and tell us to draw up to the starter
            target = outside(holdAt);
            if (playerIn && !t.drawUpAsked) { t.drawUpAsked = true; this.onDrawUp?.(t.st, t); }
          } else { // already coming in: it stops in its loop, short of the fouling mark, until we clear it
            const stop = S.pStart + 14;
            target = Math.min(t.vmax, Math.sqrt(2 * 0.5 * Math.max(0, t.s - stop)));
          }
        }
        // A train longer than the station still fouls the entry throat even at the starter: the
        // crossing train draws into its loop and waits there; that clears the crossing (our starter),
        // and it leaves once our rear is clear of the throat.
        if (t.longHold) {
          if (rearClear) t.longHold = false;
          else {
            const stop = S.pStart + 14;
            target = Math.min(t.vmax, Math.sqrt(2 * 0.5 * Math.max(0, t.s - stop)));
            if (t.s < stop + 4 && t.v < 0.3 && t.cr.state !== 'cleared') t.cr.state = 'cleared';
          }
        }
        t.v += Math.sign(target - t.v) * Math.min(Math.abs(target - t.v), 0.6 * dt);
        if (t.s + t.consist.length < S.pStart - 60 && t.cr.state !== 'cleared') t.cr.state = 'cleared';
        // a crossing train that stood in its loop sounds its horn as it moves off
        if (t.v < 0.2) t.stood = true;
        else if (t.stood && t.v > 0.8) { t.stood = false; this._horn(t); }
      }
      if (t.kind === 'oncoming') {
        let conflictTop = -Infinity;
        for (let s = sFront - 400; s < t.s; s += 15) if (Math.abs(playerLane.at(s) - TRACK.MAIN_HALF) < 1.2) conflictTop = s;
        if (conflictTop > -Infinity) {
          const holdAt = conflictTop + 120;
          const dist = t.s - holdAt;
          if (dist < 0 && t.s - sFront > 700) { t.s = -1e9; continue; }
          const target = dist > 0 ? Math.min(t.v0 ?? t.v, Math.sqrt(2 * 0.6 * dist)) : 0;
          t.v0 ??= t.v;
          t.v = Math.max(0, Math.min(target, t.v + 0.6 * dt));
        } else if (t.v0) t.v = Math.min(t.v0, t.v + 0.5 * dt);
      }
      if (t.kind === 'behind') {
        // keep clear of our train while it still occupies the running line ahead
        const rearS = sFront - trainLen;
        let target = t.vmax;
        if (t.s < rearS + 5) {
          let blocked = false;
          for (let x = rearS; x <= sFront; x += 20) if (Math.abs(playerLane.at(x) - t.lane.at(x)) < 1.6) { blocked = true; break; }
          if (blocked) {
            const gap = rearS - t.s;
            target = gap > 1100 ? t.vmax : gap > 650 ? Math.min(t.vmax, Math.max(playerSpeed, 4)) : 0;
          }
        }
        target = Math.min(target, this.ops.sectionCap(t.s) / 3.6, t.vmax);
        const acc = target > t.v ? 0.45 : 0.9;
        t.v = Math.max(0, t.v + Math.sign(target - t.v) * Math.min(Math.abs(target - t.v), acc * dt));
        if (!t.horned && t.s > rearS - 300) { t.horned = true; this._horn(t, 'near'); }
      }
      if (t.kind === 'station') {
        const S = t.st.layout;
        const stop = S.pStart + 14;
        let target = t.vmax;
        if (t.state === 'arriving') {
          target = Math.min(t.vmax, t.s < S.pEnd + t.track.fanExit + 20 ? 30 / 3.6 : t.vmax, Math.sqrt(2 * 0.45 * Math.max(0, t.s - stop)));
          if (t.s - t.consist.length < S.pEnd) t.blocksStarter = null;
          if (t.s < stop + 2 && t.v < 0.4) {
            t.state = 'dwell'; t.dwell = 0; t.blocksStarter = null;
            t.departAt = this.now + t.dwellMin;
            t.waitLeft = t.dwellMin;
            this.onStationEvent?.('arrived', t);
            t.st.occupancy.set(t.track.no, { kind: 'ai', rake: t.consist.rakeType, name: t.name });
          }
        } else if (t.state === 'dwell') {
          target = 0; t.dwell += dt;
          t.waitLeft -= this.gdt;
          // on a single line it leaves back down our line: wait until our whole train is clear of the entry throat
          let pathClear = S.entryLine !== 'S';
          if (!pathClear) {
            if (t.foulS === undefined) { let x = S.pStart; while (x > S.zoneStart - 600 && Math.abs(t.lane.at(x) - playerLane.at(x)) > 4.0) x -= 5; t.foulS = x; }
            pathClear = sFront - trainLen > t.foulS + 25;
          }
          if (t.waitLeft <= 0 && !t.terminates && pathClear) { t.state = 'leaving'; this._horn(t); this.onStationEvent?.('departing', t); }
        } else {
          target = t.s < S.pStart - t.track.fanEntry ? 70 / 3.6 : 30 / 3.6;
          if (t.s + t.consist.length < S.pStart - t.track.fanEntry) { t.st.occupancy.delete(t.track.no); t.atStation = null; }
        }
        const acc = target > t.v ? 0.4 : 0.7;
        t.v = Math.max(0, t.v + Math.sign(target - t.v) * Math.min(Math.abs(target - t.v), acc * dt));
      }
      if (t.kind === 'ahead') {
        let target = t.vmax;
        if (t.state === 'platform') {
          const st = t.busySt, b = st.busy;
          target = 0;
          if (b.t > b.hold || b.state === 'cleared') { t.state = 'departing'; this._horn(t); }
        }
        if (t.state === 'departing') {
          const S = t.busySt.layout, tk = t.busySt.busy.track;
          target = t.s < S.pEnd + (tk.fanExit || 0) + t.consist.length ? LOOP_LIMIT / 3.6 * 0.6 : t.vmax;
          if (t.s - t.consist.length > S.pEnd + (tk.fanExit || 0) + 20) {
            if (t.busySt.occupancy.get(tk.no)?.kind === 'ai') t.busySt.occupancy.delete(tk.no);
            t.state = 'running';
          }
        }
        if (t.state === 'running' && t.s - rear < 3200 && playerSpeed * 3.6 > t.vmax * 3.6 + 5) this._planLoop(t, sFront);
        if (t.state === 'toLoop' || t.state === 'waiting') {
          const S = t.loop.st.layout;
          const stop = S.pEnd - 14;
          if (t.s < S.pStart - t.loop.track.fanEntry - 50) target = t.vmax;
          else target = Math.min(LOOP_LIMIT / 3.6, Math.sqrt(2 * 0.45 * Math.max(0, stop - t.s)));
          if (t.s > stop - 3 && t.v < 0.5) t.state = 'waiting';
          if (t.state === 'waiting') {
            target = 0;
            if (rear > S.zoneEnd + 150) { t.state = 'following'; this._horn(t); } // we have overtaken it: it pulls out, horn
          }
        }
        if (t.state === 'following') {
          const gap = rear - t.s;
          target = gap > 900 ? t.vmax : gap > 500 ? Math.min(t.vmax, playerSpeed * 0.8) : 0;
          if (t.loop && t.s > t.loop.st.layout.pEnd + t.loop.track.fanExit + 20) {
            t.loop.st.occupancy.delete(t.loop.track.no);
            t.loop = null;
          }
        }
        // never run into the back of anything ahead of it
        const blocker = this.ops.blockOccupied(t.s, t.s + 700, t);
        if (blocker && blocker.kind !== 'oncoming') target = 0;
        const acc = target > t.v ? 0.35 : 0.8;
        t.v += Math.sign(target - t.v) * Math.min(Math.abs(target - t.v), acc * dt);
        t.v = Math.max(0, t.v);
      }
      // AI trains never run through each other: brake for anything ahead on the same track
      const sep = this._gapAhead(t);
      if (sep < 280) t.v = Math.min(t.v, sep < 80 ? 0 : t.v * ((sep - 80) / 200));
      t.s += t.dir * t.v * dt;
      t.consist.place(this.layout.path, t.lane, t.s, t.dir);
      const gap = Math.abs(t.s - sFront);
      if (!t.horned && gap < 480 && t.kind !== 'ahead' && t.s > sFront) { t.horned = true; this._horn(t, 'near'); }
    }
    const keep = [];
    for (const t of this.trains) {
      const lo = t.dir > 0 ? t.s - t.consist.length : t.s;
      const hi = t.dir > 0 ? t.s : t.s + t.consist.length;
      const gone = (hi < sFront - 1600 && t.kind !== 'behind') || t.s < -1e8 || ((t.kind === 'ahead' || t.kind === 'behind') && lo > sFront + 6000) || t.s > L.total - 200;
      if (gone) {
        if (t.loop) t.loop.st.occupancy.delete(t.loop.track.no);
        if (t.busySt && t.state !== 'running' && t.busySt.occupancy.get(t.busySt.busy.track.no)?.kind === 'ai') t.busySt.occupancy.delete(t.busySt.busy.track.no);
        if (t.kind === 'station' && t.st.occupancy.get(t.track.no)?.kind === 'ai') t.st.occupancy.delete(t.track.no);
        t.consist.dispose();
        continue;
      }
      keep.push(t);
    }
    this.trains = keep;
  }

  // Overlap between the player's train and any AI train on the same track.
  collision(sFront, trainLen, playerLane) {
    const p0 = sFront - trainLen, p1 = sFront;
    for (const t of this.trains) {
      const lo = t.dir > 0 ? t.s - t.consist.length : t.s;
      const hi = t.dir > 0 ? t.s : t.s + t.consist.length;
      const a = Math.max(lo, p0), b = Math.min(hi, p1);
      if (b <= a) continue;
      for (const x of [a, (a + b) / 2, b]) {
        if (Math.abs(t.lane.at(x) - playerLane.at(x)) < 2.2) return { train: t, at: x, headOn: t.dir < 0 };
      }
    }
    return null;
  }
}
