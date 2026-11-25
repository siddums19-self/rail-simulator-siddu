// Cab realism:
//  * vigilance control device (VCD): acknowledge every 60 s while running (key B or the VCD button; any
//    throttle / brake / horn use also counts). 8 s after the warning without acknowledgement: emergency brake.
//  * fog-signal detonators: in fog, detonators on the rail 270 m before each home signal go off under the train

export class CabRealism {
  constructor({ audio, toast, onEmergency, el }) {
    Object.assign(this, { audio, toast, onEmergency, el });
    this.vcdOn = true;
    this.reset();
  }

  reset() { this.vcdT = 0; this.vcdWarn = false; this.fired = new Set(); this._show(false); }

  // any deliberate control input counts as an acknowledgement
  ack() { this.vcdT = 0; if (this.vcdWarn) { this.vcdWarn = false; this._show(false); } }

  _show(on) { if (this.el) this.el.classList.toggle('show', on); }

  update(dtReal, { speedKmh, sFront, prevFront, ops, layout, weather, stopped }) {
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
