import { makeRng, range, pick } from './core/rng.js';

// Section control: what happens when the train stops where it has no reason to
// (green signal ahead, no halt, no incident). Five seconds after the stop the
// walkie-talkie panel offers "Inform control" with a reason. Control answers,
// the reason has its own short procedure, and the loco pilot must get control's
// permission before moving off again. A long stop needs the train protected
// (flasher on, detonators placed). Meanwhile the trains around us pay for it:
//  * double line: a train timed a few minutes behind us is held at the signal
//    behind (knock-on delay once its headway is used up; after a long stop
//    control may send it past on the other line);
//  * single line: the opposing train for the next crossing is held at its
//    station until we clear the section (knock-on delay from the first minute).

const REASONS = [
  { id: 'loco', label: 'Loco / traction trouble', reply: 'Control: noted. Attend to the loco and report when ready, or ask for an assisting loco.', work: 18, workText: 'Trouble-shooting the loco…' },
  { id: 'acp', label: 'Alarm chain pulled (ACP)', reply: 'Control: guard to reset the alarm chain and report. Keep the train secured.', work: 20, workText: 'Guard walking to the coach to reset the ACP…' },
  { id: 'obstruction', label: 'Obstruction / animal on the track', reply: 'Control: clear the obstruction, examine the track and report.', work: 15, workText: 'Clearing the line ahead…' },
  { id: 'brakes', label: 'Brake binding / train examination', reply: 'Control: examine the train and report. Do not move until the brakes are released.', work: 22, workText: 'Walking the train, checking brake blocks…' },
  { id: 'crew', label: 'Crew unwell', reply: 'Control: relief crew arranged at the next station. Proceed when fit, with caution.', work: 12, workText: 'Assistant loco pilot taking over…' }
];
const INFORM_AFTER = 5;     // real seconds after stopping
const CALL_AFTER = 60;      // control calls you if you haven't reported
const PROTECT_AFTER = 10;   // journey minutes stopped before the train must be protected

export class ControlRoom {
  constructor({ layout, ops, toast, audio, seedKey, getScorer }) {
    Object.assign(this, { layout, ops, toast, audio, getScorer });
    this.rand = makeRng(seedKey, 'control');
    this.stop = null;          // the current unscheduled stop
    this.history = [];         // finished stops: { km, minutes, reason, knockOn }
    this.knockOnTotal = 0;
    this.dirty = false;
  }

  get active() { return this.stop && this.stop.t >= INFORM_AFTER; }

  // sim: { sFront, speed, gameDt, excused, auto }
  update(dt, sim) {
    const st = this.stop;
    if (!st) {
      if (sim.speed < 0.3 && !sim.excused && this.wasMoving) this._begin(sim);
      if (sim.speed > 2) this.wasMoving = true;
      return;
    }
    if (sim.speed > 0.5) return this._end(sim);
    if (sim.excused && !st.reason) { this.stop = null; this.dirty = true; return; } // the stop turned out to be for a signal etc.
    st.t += dt;
    st.gameMin += sim.gameDt;
    if (st.t >= INFORM_AFTER && !st.opened) { st.opened = true; this.dirty = true; this.audio.beep?.(); this.toast('Walkie-talkie: inform section control why the train has stopped', 'warn', 4000); }
    if (sim.auto && st.opened && !st.reason) this.act('loco');                 // the auto driver reports for you
    if (sim.auto && st.workDone && !st.ready) this.act('ready');
    if (sim.auto && st.needProtect && !st.protected) this.act('protect');
    if (st.t >= CALL_AFTER && !st.reason && !st.called) {
      st.called = true; this.dirty = true;
      this.getScorer().add(-30, 'Did not inform control within a minute of stopping');
      this.toast(`Control: ${this.ops.trainNo}, why are you standing at km ${st.km.toFixed(1)}? Report at once.`, 'warn', 5000);
    }
    if (st.reason && !st.workDone && st.t - st.reasonAt >= st.reason.work) { st.workDone = true; this.dirty = true; this.toast(`${st.reason.label}: done — ask control for permission to proceed`, 'ok', 3500); }
    if (st.gameMin >= PROTECT_AFTER && !st.needProtect) { st.needProtect = true; this.dirty = true; this.toast('Long stop: protect the train — flasher light ON, detonators placed', 'warn', 4500); }
    if (st.needProtect && !st.protected && st.gameMin >= PROTECT_AFTER + 5 && !st.protectPenalty) { st.protectPenalty = true; this.getScorer().add(-30, 'Train not protected during a long stop'); }
    // knock-on delay to the trains around us
    for (const v of st.victims) {
      if (v.passed) continue;
      const over = st.gameMin - v.grace;
      if (over > 0) v.min = over;
      if (v.kind === 'behind' && st.gameMin > 15 && !v.passed && v.min > 0) { v.passed = true; this.toast(`Control: ${v.name} is being sent past you on the other line (wrong-line working)`, 'ok', 4500); this.dirty = true; }
    }
    if (Math.floor(st.t * 2) !== Math.floor((st.t - dt) * 2)) this.dirty = true; // refresh the live minutes
  }

  _begin(sim) {
    const L = this.layout, s = sim.sFront;
    const single = L.lineAt(s) === 'S';
    const victims = [];
    const namer = this.ops.namer;
    const behindReal = this.ops.trains().find((t) => (t.kind === 'behind' || t.kind === 'ahead') && t.dir > 0 && s - t.s > 0 && s - t.s < 5000);
    if (behindReal) victims.push({ kind: 'behind', name: behindReal.name, grace: 0, min: 0 });
    else if (!single) {
      const ctx = { s, dir: 1 };
      const rake = namer.pickRake(['LHB', 'ICF', 'LHB', 'DURANTO', 'VANDE_BHARAT'], this.rand, ctx);
      victims.push({ kind: 'behind', name: namer.name(rake, this.rand, ctx), grace: range(this.rand, 5, 11), min: 0 });
    }
    if (single) {
      const nx = this.ops.nextStation(s);
      const ctx = { s, dir: -1 };
      const rake = namer.pickRake(['LHB', 'ICF', 'DEMU_PASSENGER', 'BOXN_GOODS'], this.rand, ctx);
      victims.push({ kind: 'opposing', name: namer.name(rake, this.rand, ctx), at: nx ? nx.name : 'the next station', grace: 0, min: 0 });
    }
    this.stop = { s, km: L.realKmAt(s), t: 0, gameMin: 0, reason: null, victims, single };
    this.dirty = true;
  }

  _end(sim) {
    const st = this.stop;
    this.stop = null;
    this.dirty = true;
    if (!st.opened) return; // a momentary stop
    const sc = this.getScorer();
    if (st.reason && !st.ready) sc.add(-40, 'Moved off without control\'s permission');
    if (!st.reason) sc.add(-40, 'Stopped in section and moved off without informing control');
    const knock = st.victims.reduce((a, v) => a + v.min, 0);
    if (knock > 0.5) {
      const rate = st.reason && st.reportedIn <= 30 ? 2 : 4; // prompt reporting lets control re-plan
      sc.add(-Math.round(Math.min(300, knock * rate)), `Knock-on delay to other trains: ${st.victims.filter((v) => v.min > 0.5).map((v) => `${v.name} +${Math.round(v.min)} min`).join(', ')}`);
    }
    this.knockOnTotal += knock;
    this.history.push({ km: st.km, minutes: st.gameMin, reason: st.reason?.label || 'not reported', knockOn: knock });
  }

  act(id) {
    const st = this.stop;
    if (!st || !st.opened) return;
    const r = REASONS.find((x) => x.id === id);
    if (r && !st.reason) {
      st.reason = r; st.reasonAt = st.t; st.reportedIn = st.t;
      if (st.t <= 30) this.getScorer().add(10, 'Informed control promptly');
      const held = st.victims.map((v) => (v.kind === 'opposing' ? `${v.name} will be held at ${v.at}` : `${v.name} behind you is being regulated`)).join('; ');
      this.toast(`${r.reply}${held ? ` ${held}.` : ''}`, 'ok', 6500);
    }
    if (id === 'ready' && st.workDone && !st.ready) {
      st.ready = true;
      if (st.needProtect && !st.protected) { st.ready = false; this.toast('Control: protect the train first (flasher / detonators)', 'warn', 3000); }
      else { this.getScorer().add(10, 'Obtained permission to proceed'); this.toast(`Control: ${this.ops.trainNo} proceed, observe signals${st.reason.id === 'loco' ? ', report at the next station' : ''}.`, 'ok', 4000); if (st.protected) this.toast('Detonators picked up, flasher off', 'ok', 2500); }
    }
    if (id === 'assist' && st.reason?.id === 'loco' && !st.assist) { st.assist = true; st.reason = { ...st.reason, work: st.t - st.reasonAt + 40, workText: 'Assisting loco on its way…' }; st.workDone = false; this.toast('Control: assisting loco ordered from the last station', 'ok', 3500); }
    if (id === 'protect' && !st.protected) { st.protected = true; this.toast('Flasher light ON, detonators placed 600 m and 1200 m in rear', 'ok', 3500); }
    this.dirty = true;
  }

  render() {
    const st = this.stop;
    if (!st || !st.opened) return null;
    const mins = (m) => `${Math.round(m)} min`;
    const victims = st.victims.map((v) => `<li class="${v.min > 0.5 ? 'fail' : ''}"><span>${v.kind === 'opposing' ? '⇄' : '⇢'}</span>${v.name}${v.kind === 'opposing' ? ` held at ${v.at}` : v.passed ? ' — passing on the other line' : ' — behind you'}${v.min > 0.5 ? ` · +${mins(v.min)}` : ''}</li>`).join('');
    let body;
    if (!st.reason) {
      body = `<div class="inc-text">Stopped in section at km ${st.km.toFixed(1)} with no signal or halt. Tell control why.</div>
        <div class="row ctl-reasons">${REASONS.map((r) => `<button data-ctl="${r.id}">${r.label}</button>`).join('')}</div>`;
    } else {
      const work = st.workDone ? '✓ ' + st.reason.label + ' — attended' : st.reason.workText;
      body = `<div class="inc-text">Reported: <b>${st.reason.label}</b></div><div class="inc-status">${work}</div>
        <div class="row">
          <button data-ctl="ready" ${st.workDone && !st.ready ? 'class="primary"' : 'disabled'}>Request permission to proceed</button>
          ${st.reason.id === 'loco' && !st.assist && !st.workDone ? '<button data-ctl="assist">Ask for an assisting loco</button>' : ''}
          ${st.needProtect ? `<button data-ctl="protect" ${st.protected ? 'disabled' : 'class="primary"'}>${st.protected ? 'Train protected ✓' : 'Protect train (flasher + detonators)'}</button>` : ''}
        </div>${st.ready ? '<div class="inc-status">Permission granted — release brakes and proceed.</div>' : ''}`;
    }
    return `<div class="title">📻 Section control · stopped ${mins(st.gameMin)}</div>${body}${victims ? `<ol class="inc-steps">${victims}</ol>` : ''}`;
  }
}
