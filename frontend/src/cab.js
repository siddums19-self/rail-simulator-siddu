// Cab realism:
//  * signal calling: the loco pilot calls each signal as it comes into sight and the assistant repeats it
//    ("Home signal, yellow!" ... "Yellow!") - as Indian Railways crews do
//  * vigilance control device (VCD): acknowledge every 60 s while running (key B or the VCD button; any
//    throttle / brake / horn use also counts). 8 s after the warning without acknowledgement: emergency brake.
//  * fog-signal detonators: in fog, detonators on the rail 270 m before each home signal go off under the train

const WORDS = {
  RED: ['danger', 'Danger!'], YELLOW: ['caution, yellow', 'Yellow!'], DOUBLE_YELLOW: ['attention, double yellow', 'Double yellow!'], GREEN: ['clear, green', 'Green!']
};

export class CabRealism {
  constructor({ audio, toast, onEmergency, el }) {
    Object.assign(this, { audio, toast, onEmergency, el });
    this.calls = true; this.vcdOn = true;
    this.reset();
  }

  reset() { this.vcdT = 0; this.vcdWarn = false; this.lastCall = null; this.fired = new Set(); this._show(false); }

  // any deliberate control input counts as an acknowledgement
  ack() { this.vcdT = 0; if (this.vcdWarn) { this.vcdWarn = false; this._show(false); } }

  _show(on) { if (this.el) this.el.classList.toggle('show', on); }

  _say(text, { pitch = 1, rate = 1.05, delay = 0, onend } = {}) {
    if (!this.calls || !this.audio.enabled || !('speechSynthesis' in window)) return;
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      const v = speechSynthesis.getVoices();
      const male = /rishi|ravi|prabhat|male|daniel|alex|fred|david|mark|ryan|thomas/i;
      u.voice = v.find((x) => /en[-_]IN/i.test(x.lang) && male.test(x.name)) || v.find((x) => /en[-_]IN/i.test(x.lang)) || v.find((x) => x.lang.startsWith('en')) || null;
      u.pitch = pitch; u.rate = rate; u.volume = 0.6;
      if (onend) u.onend = onend;
      speechSynthesis.speak(u);
    }, delay);
  }

  update(dtReal, { speedKmh, sFront, prevFront, ops, layout, weather, stopped }) {
    // --- signal calling (once per signal / aspect, when it comes into sight)
    const nx = ops.signalsAhead(sFront, 1)[0];
    if (nx && nx.s - sFront < (weather === 'FOG' ? 260 : 650) && nx.s - sFront > 20) {
      const key = `${Math.round(nx.s)}|${nx.aspect}`;
      if (key !== this.lastCall && WORDS[nx.aspect]) {
        this.lastCall = key;
        const [w, rep] = WORDS[nx.aspect];
        const kind = nx.kind === 'Distant' ? 'Distant' : nx.kind === 'Home' ? 'Home' : nx.kind === 'Starter' ? 'Starter' : 'Signal';
        this._say(`${kind} ${w}!`, { pitch: 0.85, onend: () => this._say(rep, { pitch: 1.25, rate: 1.15, delay: 150 }) });
      }
    }
    // --- vigilance control device
    if (this.vcdOn && speedKmh > 5 && !stopped) {
      this.vcdT += dtReal;
      if (this.vcdT > 52 && !this.vcdWarn) { this.vcdWarn = true; this._show(true); this.audio.beep(); this.toast('VCD — press B (or the VCD button) to acknowledge', 'warn', 3000); }
      if (this.vcdWarn && Math.floor(this.vcdT * 2) % 2 === 0 && this.vcdT % 1 < dtReal) this.audio.beep();
      if (this.vcdT > 60) { this.vcdT = 0; this.vcdWarn = false; this._show(false); this.onEmergency('VCD not acknowledged — emergency brake applied'); }
    } else if (speedKmh <= 5) { this.vcdT = 0; if (this.vcdWarn) { this.vcdWarn = false; this._show(false); } }
    // --- fog-signal detonators, 270 m before each home signal, only in fog
    if (weather === 'FOG' && prevFront !== undefined) {
      for (const st of layout.stations) {
        if (st.isOrigin) continue;
        const x = ops.homeS(st) - 270;
        if (prevFront < x && sFront >= x && !this.fired.has(st.index)) {
          this.fired.add(st.index);
          this.audio.detonator?.();
          this.toast(`💥 Fog signals! Home signal of ${st.name} ahead — 270 m`, 'warn', 3500);
        }
      }
    }
  }
}
