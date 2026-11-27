import { makeRng, range, pick } from './core/rng.js';

// Breakdowns & incidents: random events on the run, each with the real
// procedure a loco pilot follows. One incident is active at a time; it shows a
// checklist and action buttons in the incident panel. Incidents act on the
// railway through Operations hooks (temporary speed limits, hold points, a
// failed signal, an examination stop) so Kavach, the auto driver and the HUD
// all see them.
//
// update() returns effects for the physics: { tractionCut, forcedSpeed, extraTE, lurch }.

const TYPES = ['hotAxle', 'ohe', 'signal', 'gate', 'acp'];
const NAMES = { cattle: 'Cattle run-over', hotAxle: 'Hot axle', ohe: 'OHE fault: dead section', signal: 'Signal failure', gate: 'Level-crossing gate open', stall: 'Stalled on a rising gradient', acp: 'Alarm Chain Pulling (ACP)' };

export class Incidents {
  constructor({ layout, ops, world, audio, scorer, toast, seedKey, rakeType, goods }) {
    Object.assign(this, { layout, ops, world, audio, scorer, toast, rakeType, goods });
    this.rand = makeRng(seedKey, 'incidents');
    this.enabled = true;
    this.active = null;
    this.history = [];
    this.dirty = true;
    this.lastShown = null;
    const km0 = layout.realKmAt(layout.stations[0].layout.pEnd);
    this.nextKm = km0 + range(this.rand, 27, 54);
    this.onAutoHorn = null;   // set by main: sound the horn for the auto driver
  }

  dispose() { if (this.active) this._cleanup(this.active); this.active = null; }

  // ------------------------------------------------------------ helpers
  _vehicleName() {
    const r = this.rand;
    if (this.goods) return `wagon ${3 + Math.floor(r() * 50)} (BOXN)`;
    return `coach ${pick(r, ['S', 'B', 'A', 'GS', 'D', 'C'])}${1 + Math.floor(r() * 6)}`;
  }

  _begin(type, fields) {
    const inc = { type, title: NAMES[type], t: 0, phase: 'start', steps: [], log: [], penalties: 0, auto: 0, ...fields };
    this.active = inc;
    this.dirty = true;
    return inc;
  }

  _finish(inc, ok, pts, why) {
    this._cleanup(inc);
    this.scorer.onIncidentHandled(ok, pts, why);
    this.history.push({ type: inc.type, title: inc.title, ok, pts: pts - inc.penalties });
    this.toast(`${inc.title}: ${why}${pts ? ` (${pts > 0 ? '+' : ''}${pts})` : ''}`, ok ? 'ok' : 'warn', 4500);
    this.active = null;
    this.dirty = true;
  }

  _penalty(inc, pts, why) {
    inc.penalties += -pts;
    this.scorer.add(pts, why);
    this.toast(`${why} (${pts})`, 'warn', 4000);
  }

  _cleanup(inc) {
    const ops = this.ops;
    if (inc.hold) ops.holdPoints = ops.holdPoints.filter((h) => h !== inc.hold);
    if (inc.tsr) ops.tempLimits = ops.tempLimits.filter((t) => t !== inc.tsr);
    if (inc.sig) { inc.sig.failed = false; inc.sig.authority = false; }
    if (inc.lc) inc.lc.stuckOpen = false;
  }

  _step(inc, i, state) { if (inc.steps[i] && inc.steps[i].state !== state) { inc.steps[i].state = state; this.dirty = true; } }
  _setPhase(inc, p) { if (inc.phase !== p) { inc.phase = p; inc.pt = 0; inc.auto = 0; this.dirty = true; } }

  // ------------------------------------------------------------ main loop
  update(dt, sim) {
    const fx = { tractionCut: false, forcedSpeed: null, extraTE: 0, lurch: 0 };
    const inc = this.active;
    if (inc) {
      inc.t += dt; inc.pt = (inc.pt || 0) + dt;
      if (sim.auto) inc.auto += dt;
      this[`_${inc.type}`](inc, dt, sim, fx);
      return fx;
    }
    if (!this.enabled || sim.incident) return fx;
    const km = this.layout.realKmAt(sim.sFront);
    if (km < this.nextKm || sim.speed < 30 / 3.6) return fx;
    const order = TYPES.slice().sort(() => this.rand() - 0.5);
    for (const type of order) {
      if (this[`_start_${type}`](sim)) { this.nextKm = km + range(this.rand, 82, 155); this.audio.beep?.(); return fx; }
    }
    this.nextKm = km + 1.5; // nothing fits here: try again a little further on
    return fx;
  }

  // Goods trains that cannot move up a bank call for a banker.
  stalled(sim) {
    if (this.active) return;
    const inc = this._begin('stall', {
      text: 'The train has stalled on the rising gradient at full power. Secure it with the brakes and ask the station master for a banker to push from the rear.',
      steps: [{ label: 'Secure the train (brake ≥ 40 %)' }, { label: 'Request a banker loco' }, { label: 'Banker coupled at the rear' }, { label: 'Restart and climb the bank' }]
    });
    inc.s = sim.sFront;
    this._penalty(inc, -100, 'Stalled on the bank');
  }

  // ------------------------------------------------------------ Alarm Chain Pulling (ACP)
  _start_acp(sim) {
    if (this.goods || this.layout.stationAt(sim.sFront, 400) || sim.speed < 25 / 3.6) return false;
    const coach = this._vehicleName();
    const inc = this._begin('acp', {
      coach,
      text: `Guard radio: "Loco Pilot, Alarm Chain Pulled in ${coach}! Brake pipe pressure is dropping — bring the train to a halt so I can reset it."`,
      steps: [{ label: 'Bring train to a halt' }, { label: `Guard inspects & resets ACP in ${coach}` }, { label: 'Guard All-Right — resume' }]
    });
    this._setPhase(inc, 'stop');
    this.toast(`⚠ ACP in ${coach} — Guard says stop to reset!`, 'warn', 5000);
    return true;
  }

  _acp(inc, dt, sim, fx) {
    fx.tractionCut = true;
    if (inc.phase === 'stop') {
      fx.forcedSpeed = 0;
      if (sim.speed < 0.3) { this._step(inc, 0, 'done'); this._setPhase(inc, 'resetting'); }
    } else if (inc.phase === 'resetting') {
      fx.forcedSpeed = 0;
      if (inc.pt > 6) {
        this._step(inc, 1, 'done'); this._step(inc, 2, 'done');
        this.audio.hornBlip?.(0.5);
        this._finish(inc, true, 30, `ACP reset in ${inc.coach} — Guard All-Right!`);
      }
    }
  }

  // ------------------------------------------------------------ cattle run-over
  _start_cattle(sim) {
    const L = this.layout;
    if (L.stationAt(sim.sFront, 600) || L.stationAt(sim.sFront + 1200, 400) || sim.speed < 40 / 3.6) return false;
    const inc = this._begin('cattle', {
      text: 'THUD — the train has run over cattle. Stop, inspect the loco and leading vehicles (cattle guard, brake gear, hose pipes), report to control, then continue.',
      steps: [{ label: 'Stop the train' }, { label: 'Inspect the train' }, { label: 'Report to control' }, { label: 'Continue when clear' }]
    });
    inc.sHit = sim.sFront;
    const stopIn = (sim.speed * sim.speed) / (2 * 0.6 * this.ops.brakeMax) + sim.speed * this.ops.brakeLag + 40;
    inc.hold = { s: sim.sFront + stopIn, reason: 'Stop: cattle run-over', short: 'cattle stop', active: true, kavach: false };
    this.ops.holdPoints.push(inc.hold);
    this._setPhase(inc, 'stop');
    this.audio.crash?.(0.22);
    this.toast('THUD! Cattle run-over — stop the train and inspect', 'warn', 5000);
    return true;
  }

  _cattle(inc, dt, sim, fx) {
    if (inc.t < 0.3) fx.lurch = 0.6;
    const moving = sim.speed > 0.3;
    if (inc.phase === 'stop') {
      if (!moving) { this._step(inc, 0, 'done'); this._setPhase(inc, 'inspect'); }
      else if (sim.sFront - inc.sHit > 1800) return this._finish(inc, false, -150, 'Did not stop after running over cattle');
    } else if (inc.phase === 'inspect') {
      if (inc.auto > 2) this.act('inspect');
    } else if (inc.phase === 'inspecting') {
      if (moving) { this._penalty(inc, -60, 'Moved during the inspection'); this._setPhase(inc, 'inspect'); return; }
      if (inc.pt > 18) {
        inc.finding = pick(this.rand, ['Cattle guard dented; brake gear, hose pipes and sanders intact.', 'Carcass cleared from the track; MR and BP hoses undamaged.', 'Minor damage to the cattle guard; no air leak, fit to proceed.']);
        this._step(inc, 1, 'done'); this._setPhase(inc, 'report');
      }
    } else if (inc.phase === 'report') {
      if (moving) return this._finish(inc, false, -80, 'Moved off before reporting to control');
      if (inc.auto > 2) this.act('report');
    } else if (inc.phase === 'reporting') {
      if (inc.pt > 4) { this._step(inc, 2, 'done'); this._setPhase(inc, 'go'); inc.hold.active = false; this.toast('Control: noted, proceed with caution.', 'ok', 3500); }
    } else if (inc.phase === 'go') {
      if (moving) { this._step(inc, 3, 'done'); this._finish(inc, true, 60, 'Procedure followed'); }
    }
  }

  // ------------------------------------------------------------ hot axle
  _start_hotAxle(sim) {
    const ops = this.ops, L = this.layout;
    const prev = [...L.stations].reverse().find((s) => s.layout.pEnd < sim.sFront);
    const st = L.stations.find((s) => !s.isOrigin && !s.isDest && !s.reversal && ops.homeS(s) - sim.sFront > 2500);
    if (!prev || !st || ops.homeS(st) - sim.sFront > 30000) return false;
    st.exam = { state: 'pending' };
    const veh = this._vehicleName();
    this._begin('hotAxle', {
      st,
      text: `Station master ${prev.name}: smoke and sparks seen from an axle box on ${veh}. Stop at ${st.name} for examination by C&W staff. Do not run through.`,
      steps: [{ label: `Stop at ${st.name}` }, { label: 'C&W examination of the axle box' }, { label: 'Proceed on the fitness memo' }]
    });
    this._setPhase(this.active, 'run');
    this.toast(`Hot axle on ${veh} reported by ${prev.code} — stop at ${st.name} for examination`, 'warn', 6000);
    return true;
  }

  _hotAxle(inc, dt, sim) {
    const st = inc.st, ops = this.ops;
    if (inc.phase === 'run') {
      const inStation = sim.sFront > st.layout.pStart && sim.sFront <= ops.starterS(st) + 2;
      if (inStation && sim.speed < 0.3) { st.exam.state = 'examining'; this._step(inc, 0, 'done'); this._setPhase(inc, 'exam'); this.toast(`${st.name}: C&W staff examining the axle box…`, 'ok', 3000); }
      if (sim.sFront > ops.starterS(st) + 5) { st.exam.state = 'done'; return this._finish(inc, false, -250, `Ran past ${st.name} with a hot axle`); }
    } else if (inc.phase === 'exam') {
      if (inc.pt > 22) {
        this._step(inc, 1, 'done');
        const next = this.layout.stations[st.index + 1];
        if (this.rand() < 0.4 && next) {
          inc.tsr = { s0: st.layout.pStart - 50, s1: next.layout.pEnd, kmh: 50, label: `Hot axle: 50 km/h to ${next.code}`, kind: 'incident' };
          ops.tempLimits.push(inc.tsr);
          inc.result = `Bearing warm: fit to run at 50 km/h up to ${next.name}.`;
          inc.restrictUntil = next.layout.pEnd;
        } else inc.result = 'Axle box cooled, bearing OK: fit to run at normal speed.';
        st.exam.state = 'done';
        this._setPhase(inc, 'go');
        this.toast(`C&W ${st.code}: ${inc.result}`, 'ok', 5000);
      }
    } else if (inc.phase === 'go') {
      if (sim.speed > 0.5 && !inc.left) { inc.left = true; this._step(inc, 2, 'done'); }
      if (inc.left && (!inc.restrictUntil || sim.sFront > inc.restrictUntil)) {
        if (inc.tsr) { ops.tempLimits = ops.tempLimits.filter((t) => t !== inc.tsr); inc.tsr = null; }
        return this._finish(inc, true, 60, 'Stopped for examination as required');
      }
    }
  }

  // ------------------------------------------------------------ OHE dead section
  _start_ohe(sim) {
    const L = this.layout;
    if (sim.traction !== 'electric' || !sim.hasPanto) return false;
    const s0 = sim.sFront + Math.max(1700, sim.speed * sim.speed / (2 * 0.3 * this.ops.brakeMax));
    const s1 = s0 + 320;
    for (let s = s0 - 400; s < s1 + sim.trainLen + 300; s += 100) if (L.stationAt(s, 200)) return false;
    if (s1 + 2000 > L.total) return false;
    const k0 = L.realKmAt(s0), k1 = L.realKmAt(s1);
    this._begin('ohe', {
      s0, s1, boardDown: s0 - 250,
      text: `Control: OHE tripped between km ${k0.toFixed(1)} and ${k1.toFixed(1)} — that stretch is dead. Lower the pantograph at the "Panto Down" board, coast through on momentum, raise it after the "Panto Up" board once the locos are clear.`,
      steps: [{ label: 'Lower the pantograph before the board (P)' }, { label: 'Coast through the dead section' }, { label: 'Raise the pantograph after the locos are clear (P)' }]
    });
    this._setPhase(this.active, 'approach');
    this.toast('Control: OHE dead section ahead — lower the pantograph (P) and coast', 'warn', 6000);
    return true;
  }

  _ohe(inc, dt, sim, fx) {
    const locoRear = sim.sFront - sim.locoSpan;
    const underDead = sim.sFront > inc.s0 && locoRear < inc.s1;
    if (underDead) fx.tractionCut = true;
    if (sim.auto) { // the auto driver handles the pantograph itself
      if (sim.panto && inc.phase === 'approach' && sim.sFront > inc.boardDown) sim.setPanto(false);
      if (!sim.panto && locoRear > inc.s1 + 10) sim.setPanto(true);
    }
    if (inc.phase === 'approach') {
      if (!sim.panto && sim.sFront > inc.boardDown - 600) this._step(inc, 0, 'done');
      if (sim.sFront > inc.s0) {
        if (sim.panto) { this._step(inc, 0, 'fail'); this._penalty(inc, -150, 'Entered the dead section with the pantograph raised — OHE damaged'); inc.flashed = true; }
        else this._step(inc, 0, 'done');
        this._setPhase(inc, 'coast');
      }
    } else if (inc.phase === 'coast') {
      if (sim.panto && underDead && !inc.flashed && !inc.raisedEarly) { inc.raisedEarly = true; this._penalty(inc, -80, 'Pantograph raised under the dead section'); }
      if (sim.speed < 0.1 && underDead) {
        inc.stallT = (inc.stallT || 0) + dt;
        if (inc.stallT > 5 && !inc.stuck) { inc.stuck = true; this._penalty(inc, -100, 'Stalled in the dead section'); this.dirty = true; }
      }
      if (inc.towing) fx.forcedSpeed = 3;
      if (locoRear > inc.s1 + 2) { this._step(inc, 1, inc.stuck ? 'fail' : 'done'); this._setPhase(inc, 'raise'); }
    } else if (inc.phase === 'raise') {
      if (inc.towing && locoRear < inc.s1 + 30) fx.forcedSpeed = 3;
      if (sim.panto) {
        this._step(inc, 2, 'done');
        const clean = !inc.flashed && !inc.raisedEarly && !inc.stuck;
        return this._finish(inc, clean, clean ? 80 : 0, clean ? 'Dead section negotiated correctly' : 'Through the dead section');
      }
      if (locoRear > inc.s1 + 1500) return this._finish(inc, false, -40, 'Pantograph left down — ran on with no traction');
    }
  }

  // ------------------------------------------------------------ signal failure
  _start_signal(sim) {
    const ops = this.ops;
    const i = ops.sigs.findIndex((sg) => sg.kind === 'IBS' && sg.s - sim.sFront > 1800 && sg.s - sim.sFront < 6000 && ops.aspectOf(sg).aspect !== 'RED');
    if (i < 0 || !ops.sigs[i + 1]) return false;
    const sg = ops.sigs[i], next = ops.sigs[i + 1];
    sg.failed = true;
    this._begin('signal', {
      sig: sg, next,
      text: `Signal ${sg.no ? `IBS ${sg.no}` : ''} has failed and shows RED. Stop at it, contact the station master, and once the block is proved clear take written authority T/369(3b) to pass it at 15 km/h up to the next stop signal.`,
      steps: [{ label: 'Stop at the defective signal' }, { label: 'Contact the station master' }, { label: 'Receive T/369(3b) written authority' }, { label: 'Pass it at ≤ 15 km/h to the next signal' }]
    });
    this._setPhase(this.active, 'approach');
    this.toast(`Control: IBS ${sg.no} has failed — stop at it and obtain T/369(3b)`, 'warn', 6000);
    return true;
  }

  _signal(inc, dt, sim) {
    const sg = inc.sig, d = sg.s - sim.sFront;
    if (inc.phase === 'approach') {
      if (sim.speed < 0.3 && d < 160 && d > -2) { this._step(inc, 0, 'done'); this._setPhase(inc, 'call'); }
      if (d < 0 && !sg.authority) return this._finish(inc, false, -100, 'Passed the failed signal without written authority');
    } else if (inc.phase === 'call') {
      if (inc.auto > 2) this.act('call');
      if (d < 0) return this._finish(inc, false, -100, 'Passed the failed signal without written authority');
    } else if (inc.phase === 'waiting') {
      if (d < 0) return this._finish(inc, false, -100, 'Passed the failed signal without written authority');
      if (inc.pt > 15) {
        this._step(inc, 1, 'done'); this._step(inc, 2, 'done');
        sg.authority = true;
        inc.tsr = { s0: sg.s - 80, s1: inc.next.s, kmh: 15, label: 'T/369(3b): 15 km/h to the next signal', kind: 'authority' };
        this.ops.tempLimits.push(inc.tsr);
        this._setPhase(inc, 'proceed');
        this.toast(`SM: T/369(3b) issued — pass IBS ${sg.no} at 15 km/h, be prepared to stop`, 'ok', 5000);
      }
    } else if (inc.phase === 'proceed') {
      if (sim.speed * 3.6 > 21 && !inc.over) { inc.over = true; this._step(inc, 3, 'fail'); this._penalty(inc, -100, 'Exceeded 15 km/h on written authority'); }
      if (sim.sFront > inc.next.s) {
        if (!inc.over) this._step(inc, 3, 'done');
        return this._finish(inc, !inc.over, inc.over ? 0 : 80, inc.over ? 'Through the failed signal' : 'Failed signal passed correctly');
      }
    }
  }

  // ------------------------------------------------------------ LC gate left open
  _start_gate(sim) {
    const lc = (this.world.lcs || []).find((l) => l.group?.parent && l.s - sim.sFront > 1500 && l.s - sim.sFront < 3400);
    if (!lc || this.layout.stationAt(lc.s, 300)) return false;
    lc.stuckOpen = true;
    const inc = this._begin('gate', {
      lc,
      text: 'The gate signal protecting the level crossing ahead is ON: the gateman has not closed the gate. Stop at the gate signal, whistle to alert the gateman, and wait for the gate to be closed and the signal taken OFF.',
      steps: [{ label: 'Stop at the gate signal' }, { label: 'Whistle to alert the gateman (H)' }, { label: 'Wait for the gate to close' }, { label: 'Proceed on the gate signal OFF' }]
    });
    inc.hold = { s: lc.s - 160, reason: 'Gate signal ON — LC gate open', short: 'gate signal', active: true, show: true };
    this.ops.holdPoints.push(inc.hold);
    this._setPhase(inc, 'approach');
    this.toast('Gate signal ahead is ON — level crossing gate open', 'warn', 5000);
    return true;
  }

  _gate(inc, dt, sim) {
    const h = inc.hold, d = h.s - sim.sFront;
    if (h.active && sim.prevFront < h.s && sim.sFront >= h.s) {
      this.ops.spads++;
      inc.lc.stuckOpen = false;
      return this._finish(inc, false, -250, 'Passed the gate signal at danger with the gate open');
    }
    if (inc.phase === 'approach') {
      if (sim.speed < 0.3 && d < 200) { this._step(inc, 0, 'done'); this._setPhase(inc, 'whistle'); }
    } else if (inc.phase === 'whistle') {
      if (sim.auto && inc.auto > 1.5 && !inc.autoHorn) { inc.autoHorn = true; this.onAutoHorn?.(); inc.horned = true; }
      if (sim.hornHeld) inc.horned = true;
      if (inc.horned) { this._step(inc, 1, 'done'); this._setPhase(inc, 'closing'); inc.closeIn = 10 + this.rand() * 8; }
    } else if (inc.phase === 'closing') {
      if (inc.pt > inc.closeIn) inc.lc.stuckOpen = false;
      if (!inc.lc.stuckOpen && inc.lc.closed > 0.97) { h.active = false; this._step(inc, 2, 'done'); this._setPhase(inc, 'go'); this.toast('Gate closed — gate signal OFF', 'ok', 3000); }
    } else if (inc.phase === 'go') {
      if (sim.sFront > inc.lc.s) { this._step(inc, 3, 'done'); return this._finish(inc, true, 70, 'Gate signal procedure followed'); }
    }
  }

  // ------------------------------------------------------------ goods: stalled on a bank
  _stall(inc, dt, sim, fx) {
    if (inc.phase === 'start') this._setPhase(inc, 'secure');
    if (inc.phase === 'secure') {
      if (sim.brake >= 40 || sim.auto) { this._step(inc, 0, 'done'); this._setPhase(inc, 'request'); }
    } else if (inc.phase === 'request') {
      if (inc.auto > 2) this.act('banker');
    } else if (inc.phase === 'coming') {
      if (inc.pt > 25) { this._step(inc, 2, 'done'); this._setPhase(inc, 'push'); this.audio.crash?.(0.08); this.toast('Banker coupled at the rear — two short whistles and restart', 'ok', 4500); }
    } else if (inc.phase === 'push') {
      fx.extraTE = 0.14;
      if (sim.speed > 2) this._step(inc, 3, 'done');
      // banker drops off once the train is over the top of the bank
      if (sim.sFront - inc.s > 400 && sim.grade < 0.0008) return this._finish(inc, true, 0, 'Over the bank — banker detached');
      if (sim.sFront - inc.s > 8000) return this._finish(inc, true, 0, 'Banker detached');
    }
  }

  // ------------------------------------------------------------ actions (panel buttons)
  act(id) {
    const inc = this.active;
    if (!inc) return;
    if (id === 'inspect' && inc.phase === 'inspect') { this._setPhase(inc, 'inspecting'); this.toast('Loco pilot climbing down to inspect…', 'ok', 2500); }
    if (id === 'report' && inc.phase === 'report') this._setPhase(inc, 'reporting');
    if (id === 'call' && inc.phase === 'call') { this._setPhase(inc, 'waiting'); this.toast('Calling the station master on the walkie-talkie…', 'ok', 2500); }
    if (id === 'banker' && inc.phase === 'request') { this._step(inc, 1, 'done'); this._setPhase(inc, 'coming'); this.toast('SM: banker loco despatched from the rear station', 'ok', 3500); }
    if (id === 'tow' && inc.type === 'ohe' && inc.stuck && !inc.towing) { inc.towing = true; this.toast('Relief loco attached — towing clear of the dead section', 'ok', 3500); }
    this.dirty = true;
  }

  // HTML for the incident panel (null when nothing is active).
  render() {
    const inc = this.active;
    if (!inc) return null;
    const mark = { done: '✓', fail: '✗' };
    const steps = inc.steps.map((s) => `<li class="${s.state || ''}"><span>${mark[s.state] || '○'}</span>${s.label}</li>`).join('');
    const btn = (id, label, on) => `<button data-act="${id}" ${on ? 'class="primary"' : 'disabled'}>${label}</button>`;
    let actions = '';
    let status = '';
    switch (inc.type) {
      case 'cattle':
        actions = btn('inspect', 'Inspect train', inc.phase === 'inspect') + btn('report', 'Report to control', inc.phase === 'report');
        if (inc.phase === 'inspecting') status = 'Inspecting… keep the train stationary.';
        if (inc.finding && inc.phase !== 'inspecting') status = inc.finding;
        break;
      case 'hotAxle':
        status = inc.phase === 'exam' ? 'C&W staff examining the axle box…' : inc.result || '';
        break;
      case 'ohe':
        actions = inc.stuck ? btn('tow', 'Request relief loco', !inc.towing) : '';
        status = 'Pantograph: key P or the Panto button.';
        break;
      case 'signal':
        actions = btn('call', 'Call station master', inc.phase === 'call');
        if (inc.phase === 'waiting') status = 'SM checking the block section is clear…';
        if (inc.phase === 'proceed') status = 'Authority T/369(3b) in hand: 15 km/h, be prepared to stop.';
        break;
      case 'gate':
        status = inc.phase === 'closing' ? 'Gateman closing the gate…' : inc.phase === 'whistle' ? 'Hold H to whistle.' : '';
        break;
      case 'stall':
        actions = btn('banker', 'Request banker', inc.phase === 'request');
        if (inc.phase === 'coming') status = 'Banker on its way…';
        break;
      case 'acp':
        status = inc.phase === 'stop' ? 'Brake pipe dropping — bring the train to a halt.' : 'Guard walking back to reset the ACP valve…';
        break;
    }
    return `<div class="title">⚠ ${inc.title}</div><div class="inc-text">${inc.text}</div><ol class="inc-steps">${steps}</ol>${status ? `<div class="inc-status">${status}</div>` : ''}${actions ? `<div class="row">${actions}</div>` : ''}`;
  }

  // Distance to the next incident location the HUD should show, if any.
  hudTarget(sFront) {
    const inc = this.active;
    if (!inc) return null;
    if (inc.type === 'ohe' && inc.phase === 'approach') return { label: 'PANTO DOWN board', dist: inc.boardDown - sFront };
    if (inc.type === 'ohe' && inc.phase !== 'approach') return { label: 'PANTO UP board', dist: inc.s1 - sFront };
    return null;
  }
}
