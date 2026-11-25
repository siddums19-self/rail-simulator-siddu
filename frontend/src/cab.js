// Cab realism:
//  * fog-signal detonators: in fog, detonators on the rail 270 m before each home signal go off under the train

export class CabRealism {
  constructor({ audio, toast }) {
    Object.assign(this, { audio, toast });
    this.reset();
  }

  reset() { this.fired = new Set(); }

  update(dtReal, { sFront, prevFront, ops, layout, weather }) {
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
