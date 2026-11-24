import { ASSETS_BASE } from '../config.js';

// Web Audio engine. Uses real recordings from public/audio/ when present
// (horn.mp3, engine.mp3, clatter.mp3, chime.mp3) and otherwise synthesises:
//  * a dual-tone reed air horn (sustains while H is held)
//  * electric traction-motor whine / diesel rumble following notch & speed
//  * rolling noise + rail-joint "ta-dak" clatter timed to wheel position
//  * brake hiss, station chime + spoken announcement

const moving0 = (v) => v > 0.25;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.enabled = true;
    this.announcements = true;
    this.hornHeld = false;
    this._jointAcc = 0;
  }

  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.2, 2.5);
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.reverb.connect(wet).connect(this.master);

    this.noiseBuf = this._noise(3);
    this._setupRolling();
    this._setupTraction();
    await Promise.all(['horn', 'engine', 'clatter', 'chime', 'rain', 'crowd'].map((n) => this._load(n)));
    this._setupRain();
    if (this.buffers.engine) this._setupEngineFile();
    if (this.buffers.clatter) this._setupClatterFile();
  }

  async _load(name) {
    for (const ext of ['mp3', 'wav', 'ogg']) {
      try {
        const r = await fetch(`${ASSETS_BASE}/audio/${name}.${ext}`);
        if (!r.ok) continue;
        const type = r.headers.get('content-type') || '';
        if (type.includes('text/html')) continue; // dev server SPA fallback
        this.buffers[name] = await this.ctx.decodeAudioData(await r.arrayBuffer());
        return;
      } catch { /* try next */ }
    }
  }

  get hasRealHorn() { return !!this.buffers.horn; }

  _noise(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown-ish
    return b;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 2000 ? i / 2000 : 1);
    }
    return b;
  }

  _setupRolling() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    this.rollFilter = ctx.createBiquadFilter(); this.rollFilter.type = 'lowpass'; this.rollFilter.frequency.value = 300;
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
    src.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
    src.start();
    const w = ctx.createBufferSource(); w.buffer = this.noiseBuf; w.loop = true; w.playbackRate.value = 1.7;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 900; this.windFilter.Q.value = 0.4;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    w.connect(this.windFilter).connect(this.windGain).connect(this.master);
    w.start();
    // brake hiss
    const bh = ctx.createBufferSource(); bh.buffer = this.noiseBuf; bh.loop = true; bh.playbackRate.value = 3;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    this.brakeGain = ctx.createGain(); this.brakeGain.gain.value = 0;
    bh.connect(hp).connect(this.brakeGain).connect(this.master);
    bh.start();
  }

  _setupTraction() {
    const ctx = this.ctx;
    this.tracGain = ctx.createGain(); this.tracGain.gain.value = 0;
    this.tracFilter = ctx.createBiquadFilter(); this.tracFilter.type = 'lowpass'; this.tracFilter.frequency.value = 1400;
    this.tracGain.connect(this.tracFilter).connect(this.master);
    this.osc = [];
    for (const [type, mul, g] of [['sawtooth', 1, 0.25], ['triangle', 2.02, 0.18], ['sine', 0.5, 0.4]]) {
      const o = ctx.createOscillator(); o.type = type;
      const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg).connect(this.tracGain);
      o.start();
      this.osc.push({ o, mul });
    }
  }

  _setupEngineFile() {
    const s = this.ctx.createBufferSource(); s.buffer = this.buffers.engine; s.loop = true;
    this.engFileGain = this.ctx.createGain(); this.engFileGain.gain.value = 0;
    s.connect(this.engFileGain).connect(this.master); s.start();
    this.engFile = s;
  }

  _setupClatterFile() {
    const s = this.ctx.createBufferSource(); s.buffer = this.buffers.clatter; s.loop = true;
    this.clatFileGain = this.ctx.createGain(); this.clatFileGain.gain.value = 0;
    s.connect(this.clatFileGain).connect(this.master); s.start();
    this.clatFile = s;
  }

  // --------------------------------------------------------------- horn
  hornStart() {
    if (!this.ctx || !this.enabled || this.hornHeld) return;
    this.hornHeld = true;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.85, t + 0.07);
    out.connect(this.master);
    out.connect(this.reverb);
    this.hornOut = out;
    this.hornNodes = [];
    if (this.buffers.horn) {
      const b = this.buffers.horn;
      const src = ctx.createBufferSource();
      src.buffer = b;
      if (b.duration > 1.2) { src.loop = true; src.loopStart = Math.min(0.5, b.duration * 0.25); src.loopEnd = b.duration - Math.min(0.4, b.duration * 0.2); }
      src.connect(out); src.start();
      this.hornNodes.push(src);
      return;
    }
    // Synthesised Indian loco air horn. Each trumpet = a vibrating reed (bright pulse
    // wave) exciting a flared bell (formant peaks); two trumpets a minor third apart,
    // each slightly detuned against itself for the thick "chorus" of a real twin horn.
    // Electric locos (WAP-7) sound higher than diesels (WDP-4D).
    const diesel = this.traction === 'diesel';
    const tones = diesel ? [277.2, 329.6] : [370, 440];
    const pre = ctx.createGain(); pre.gain.value = 1;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; curve[i] = Math.tanh(x * 1.8) * 0.9 + 0.1 * Math.tanh(x * 6); }
    shaper.curve = curve; shaper.oversample = '4x';
    const bell1 = ctx.createBiquadFilter(); bell1.type = 'peaking'; bell1.frequency.value = diesel ? 700 : 950; bell1.Q.value = 1.1; bell1.gain.value = 8;
    const bell2 = ctx.createBiquadFilter(); bell2.type = 'peaking'; bell2.frequency.value = diesel ? 1600 : 2100; bell2.Q.value = 1.6; bell2.gain.value = 5;
    const body = ctx.createBiquadFilter(); body.type = 'highpass'; body.frequency.value = 160;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5;
    pre.connect(shaper).connect(body).connect(bell1).connect(bell2).connect(lp).connect(out);
    // reed: narrow pulse (rich odd+even harmonics, rolling off)
    const N = 32, real = new Float32Array(N), imag = new Float32Array(N), duty = 0.32;
    for (let n = 1; n < N; n++) imag[n] = (Math.sin(Math.PI * n * duty) / n) * Math.exp(-n / 18);
    const wave = ctx.createPeriodicWave(real, imag);
    // slow pressure wobble + faint flutter
    const vib = ctx.createOscillator(); vib.frequency.value = 4.6;
    const vibG = ctx.createGain(); vibG.gain.value = 1.4;
    vib.connect(vibG); vib.start();
    this.hornNodes.push(vib);
    for (const [k, base] of tones.entries()) {
      for (const cents of [-6, 5]) {
        const f = base * Math.pow(2, cents / 1200);
        const o = ctx.createOscillator();
        o.setPeriodicWave(wave);
        // air pressure builds: the reed speaks flat and a little rough, then locks in
        o.frequency.setValueAtTime(f * 0.9, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.008, t + 0.09);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.2);
        vibG.connect(o.frequency);
        const g = ctx.createGain();
        const lvl = (k === 0 ? 0.26 : 0.22) * 0.5;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(lvl * 1.15, t + 0.05 + k * 0.025); // the higher trumpet speaks a hair later
        g.gain.linearRampToValueAtTime(lvl, t + 0.25);
        o.connect(g).connect(pre);
        o.start(t);
        this.hornNodes.push(o);
      }
    }
    // valve "chiff" + air rush
    const hiss = ctx.createBufferSource(); hiss.buffer = this.noiseBuf; hiss.loop = true; hiss.playbackRate.value = 3;
    const hb = ctx.createBiquadFilter(); hb.type = 'bandpass'; hb.frequency.value = 2600; hb.Q.value = 0.7;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.14, t); hg.gain.exponentialRampToValueAtTime(0.025, t + 0.18);
    hiss.connect(hb).connect(hg).connect(out); hiss.start();
    this.hornNodes.push(hiss);
  }

  hornStop() {
    if (!this.ctx || !this.hornHeld) return;
    this.hornHeld = false;
    const t = this.ctx.currentTime;
    const out = this.hornOut;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    for (const n of this.hornNodes) { try { n.stop(t + 0.3); } catch { /* already stopped */ } }
    if (!this.buffers.horn) {
      // pitch sags as the air pressure drops
      for (const n of this.hornNodes) if (n.frequency && n.frequency.value > 100) n.frequency.exponentialRampToValueAtTime(n.frequency.value * 0.93, t + 0.25);
    }
  }

  hornBlip(duration = 0.6) {
    this.hornStart();
    setTimeout(() => this.hornStop(), duration * 1000);
  }

  // Distant horn of a passing AI train (quieter, filtered, panned).
  distantHorn(gain = 0.35, pan = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(gain, t + 0.1);
    out.gain.setValueAtTime(gain, t + 1.2);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    out.connect(lp).connect(p).connect(this.master);
    const bell = ctx.createBiquadFilter(); bell.type = 'peaking'; bell.frequency.value = 900; bell.Q.value = 1; bell.gain.value = 6;
    bell.connect(out);
    const pair = Math.random() < 0.5 ? [370, 440] : [277.2, 329.6];
    for (const f of pair) for (const c of [-5, 6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * Math.pow(2, c / 1200);
      const g = ctx.createGain(); g.gain.value = 0.09;
      o.connect(g).connect(bell); o.start(t); o.stop(t + 1.7);
    }
  }

  // ------------------------------------------------------- station chime
  stationChime(text) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    if (this.buffers.chime) {
      // heard from the platform PA speakers: quieter, band-limited, mostly reverberant
      const s = ctx.createBufferSource(); s.buffer = this.buffers.chime;
      const pa = ctx.createBiquadFilter(); pa.type = 'bandpass'; pa.frequency.value = 1400; pa.Q.value = 0.6;
      const pg = ctx.createGain(); pg.gain.value = 0.35;
      s.connect(pa).connect(pg); pg.connect(this.master); pg.connect(this.reverb); s.start();
    } else {
      const notes = [659.3, 830.6, 987.8, 1318.5];
      notes.forEach((f, i) => {
        const t = ctx.currentTime + i * 0.32;
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.01;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4); // distant PA chime
        const g2 = ctx.createGain(); g2.gain.value = 0.25;
        o.connect(g); o2.connect(g2).connect(g); g.connect(this.master); g.connect(this.reverb);
        o.start(t); o2.start(t); o.stop(t + 1.5); o2.stop(t + 1.5);
      });
    }
    if (this.announcements && text && 'speechSynthesis' in window) {
      setTimeout(() => {
        const u = new SpeechSynthesisUtterance(text);
        const voices = speechSynthesis.getVoices();
        const fem = /veena|heera|lekha|raveena|kajal|aditi|neerja|female|samantha|karen|moira|tessa|zira|susan|serena|fiona|victoria|swara/i;
        u.voice = voices.find((v) => v.lang === 'en-IN' && fem.test(v.name)) || voices.find((v) => v.lang === 'en-IN') || voices.find((v) => v.lang.startsWith('en')) || null;
        u.rate = 0.92; u.volume = 0.9;
        u.pitch = u.voice && !fem.test(u.voice.name) ? 1.3 : 1.05;
        speechSynthesis.speak(u);
      }, 1500);
    }
  }

  // ---------------------------------------------------------------- rain
  _setupRain() {
    const ctx = this.ctx;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    this.rainTone = ctx.createBiquadFilter(); this.rainTone.type = 'lowpass'; this.rainTone.frequency.value = 9000;
    this.rainTone.connect(this.rainGain).connect(this.master);
    if (this.buffers.rain) {
      const s = ctx.createBufferSource(); s.buffer = this.buffers.rain; s.loop = true; s.connect(this.rainTone); s.start();
    } else {
      // broadband "sheet" of rain: white noise shaped into a hiss + rumble
      const len = ctx.sampleRate * 4;
      const b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
      const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 3200; pk.gain.value = -6; pk.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0.16;
      src.connect(hp).connect(pk).connect(g).connect(this.rainTone); src.start();
      // low "roar" of distant rain on fields
      const r = ctx.createBufferSource(); r.buffer = this.noiseBuf; r.loop = true;
      const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 500;
      const rg = ctx.createGain(); rg.gain.value = 0.35;
      r.connect(rl).connect(rg).connect(this.rainTone); r.start();
    }
    this._dropAt = 0;
    this._thunderIn = 12 + Math.random() * 20;
    this._wiperAt = 0;
  }

  _drop(t, gain, interior) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = interior ? 500 + Math.random() * 900 : 1800 + Math.random() * 4200; bp.Q.value = 3 + Math.random() * 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (interior ? 0.05 : 0.018));
    const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8;
    s.connect(bp).connect(g).connect(p).connect(this.master);
    s.start(t, Math.random() * 2.5, 0.06);
  }

  thunder(distance = 0.5) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900 - distance * 600, t); lp.frequency.exponentialRampToValueAtTime(90, t + 5);
    const g = ctx.createGain();
    const peak = 0.9 - distance * 0.55;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.08 + distance * 0.5);
    g.gain.exponentialRampToValueAtTime(peak * 0.4, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 1.4 - 0.7;
    s.connect(lp).connect(g).connect(p).connect(this.master); g.connect(this.reverb);
    s.start(t, Math.random() * 2, 6.5);
  }

  _wiper(t) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 2;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(900, t); bp.frequency.linearRampToValueAtTime(1600, t + 0.45);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.15); g.gain.linearRampToValueAtTime(0.0001, t + 0.55);
    s.connect(bp).connect(g).connect(this.master); s.start(t, Math.random(), 0.6);
    this._click(t + 0.6, 0.12, false);
  }

  // Crash / derailment: impact boom, metal shriek, debris.
  crash(gain = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2500, t); lp.frequency.exponentialRampToValueAtTime(120, t + 2.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    s.connect(lp).connect(g).connect(this.master); g.connect(this.reverb); s.start(t, 0, 3.2);
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = 300 + Math.random() * 900;
      o.frequency.setValueAtTime(f, t + i * 0.25); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + i * 0.25 + 1.2);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t + i * 0.25); og.gain.exponentialRampToValueAtTime(0.06 * gain, t + i * 0.25 + 0.05); og.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 1.3);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 8;
      o.connect(bp).connect(og).connect(this.master); o.start(t + i * 0.25); o.stop(t + i * 0.25 + 1.4);
    }
    for (let i = 0; i < 14; i++) this._click(t + 0.2 + Math.random() * 2, 0.4 * gain * Math.random(), Math.random() > 0.5);
  }

  // Level-crossing bell (ding-ding) while the gates are closing near us.
  bellTick(dt, gain) {
    if (!this.ctx || !this.enabled || gain <= 0.02) { this._bellT = 0; return; }
    this._bellT = (this._bellT || 0) - dt;
    if (this._bellT > 0) return;
    this._bellT = 0.42;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of [1480, 2960]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06 * gain * (f > 2000 ? 0.4 : 1), t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.4);
    }
  }

  // Point machine: motor whirr, then the blades clunk home.
  pointThrow(gain = 0.4) {
    if (!this.ctx || !this.enabled || gain < 0.02) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(190, t + 1.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * gain, t + 0.1);
    g.gain.setValueAtTime(0.05 * gain, t + 1.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(lp).connect(g).connect(this.master); o.start(t); o.stop(t + 1.5);
    this._click(t + 1.45, 0.6 * gain, false);
    this._click(t + 1.5, 0.35 * gain, true);
  }

  beep() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1250;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.setValueAtTime(0, t + 0.15);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
  }

  _click(t, gain, bright) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = bright ? 1900 : 700; bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(bp).connect(g).connect(this.master);
    s.start(t, Math.random() * 2, 0.09);
  }

  // ---------------------------------------------------------------- update
  _setupNatural() {
    const ctx = this.ctx;
    // flange squeal on tight curves
    this.squealOsc = ctx.createOscillator(); this.squealOsc.type = 'sawtooth'; this.squealOsc.frequency.value = 3400;
    const sqBp = ctx.createBiquadFilter(); sqBp.type = 'bandpass'; sqBp.frequency.value = 3600; sqBp.Q.value = 12;
    this.squealGain = ctx.createGain(); this.squealGain.gain.value = 0;
    const vib = ctx.createOscillator(); vib.frequency.value = 7; const vg = ctx.createGain(); vg.gain.value = 120;
    vib.connect(vg).connect(this.squealOsc.frequency); vib.start();
    this.squealOsc.connect(sqBp).connect(this.squealGain).connect(this.master); this.squealOsc.start();
    // hollow bridge rumble
    const br = ctx.createBufferSource(); br.buffer = this.noiseBuf; br.loop = true; br.playbackRate.value = 0.6;
    const brl = ctx.createBiquadFilter(); brl.type = 'lowpass'; brl.frequency.value = 140;
    const brp = ctx.createBiquadFilter(); brp.type = 'peaking'; brp.frequency.value = 85; brp.gain.value = 9; brp.Q.value = 2;
    this.bridgeGain = ctx.createGain(); this.bridgeGain.gain.value = 0;
    br.connect(brl).connect(brp).connect(this.bridgeGain).connect(this.master); br.start();
    // passing train roar
    const pr = ctx.createBufferSource(); pr.buffer = this.noiseBuf; pr.loop = true; pr.playbackRate.value = 1.4;
    const prl = ctx.createBiquadFilter(); prl.type = 'lowpass'; prl.frequency.value = 1200;
    this.passGain = ctx.createGain(); this.passGain.gain.value = 0;
    this.passPan = ctx.createStereoPanner();
    pr.connect(prl).connect(this.passGain).connect(this.passPan).connect(this.master); pr.start();
    // brake blocks grinding on the wheel treads
    const gr = ctx.createBufferSource(); gr.buffer = this.noiseBuf; gr.loop = true; gr.playbackRate.value = 2.2;
    const grb = ctx.createBiquadFilter(); grb.type = 'bandpass'; grb.frequency.value = 1150; grb.Q.value = 1.6;
    const grp = ctx.createBiquadFilter(); grp.type = 'peaking'; grp.frequency.value = 2400; grp.gain.value = 6;
    this.grindGain = ctx.createGain(); this.grindGain.gain.value = 0;
    // shoe-on-tread scrape pulses once per wheel revolution
    this.grindAM = ctx.createGain(); this.grindAM.gain.value = 1;
    this.grindLfo = ctx.createOscillator(); this.grindLfo.frequency.value = 1;
    this.grindLfoG = ctx.createGain(); this.grindLfoG.gain.value = 0.35;
    this.grindLfo.connect(this.grindLfoG).connect(this.grindAM.gain); this.grindLfo.start();
    gr.connect(grb).connect(grp).connect(this.grindGain).connect(this.grindAM).connect(this.master); gr.start();
    // low rumble of cast-iron blocks
    const gl = ctx.createBufferSource(); gl.buffer = this.noiseBuf; gl.loop = true; gl.playbackRate.value = 0.8;
    const glb = ctx.createBiquadFilter(); glb.type = 'bandpass'; glb.frequency.value = 380; glb.Q.value = 1.3;
    this.grindLow = ctx.createGain(); this.grindLow.gain.value = 0;
    gl.connect(glb).connect(this.grindLow).connect(this.grindAM); gl.start();
    this._sqFl = 1; this._sqFlT = 1; this._sqFlTimer = 0;
    // vintage brake squeal: inharmonic metallic partials with wobble
    this.brakeSq = ctx.createGain(); this.brakeSq.gain.value = 0;
    const sqWob = ctx.createOscillator(); sqWob.frequency.value = 4.3; const sqWobG = ctx.createGain(); sqWobG.gain.value = 35; sqWob.connect(sqWobG); sqWob.start();
    this.brakeSqOsc = [];
    for (const [f, g] of [[2710, 0.6], [4090, 0.35], [5530, 0.15]]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      sqWobG.connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og).connect(this.brakeSq); o.start();
      this.brakeSqOsc.push({ o, f });
    }
    const sqF = ctx.createBiquadFilter(); sqF.type = 'highpass'; sqF.frequency.value = 1800;
    this.brakeSq.connect(sqF).connect(this.master);
    this.brakeSq.connect(this.reverb);
    this._compT = 6; this._dieselPh = 0; this._prevBrake = 0; this._prevMoving = false;
  }

  _hiss(t, dur, gain, freq = 3000) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 3;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(hp).connect(g).connect(this.master); s.start(t, Math.random(), dur + 0.1);
  }

  _clank(t, gain) {
    for (let k = 0; k < 5; k++) this._click(t + k * (0.18 + Math.random() * 0.12), gain * (1 - k * 0.12), false);
  }

  update(dt, { speedKmph, notch, brake, traction, onTurnout, interior, distanceStep, weather, curveR = 0, onBridge = false, passing = null, wipers = false }) {
    this.traction = traction;
    // windscreen wipers (heard from inside the cab), synced with the visible blades
    if (wipers && interior && this.enabled && this.ctx) {
      this._wiperAt -= dt;
      if (this._wiperAt < 0) { this._wiper(this.ctx.currentTime); this._wiperAt = 1.35; }
    }
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.squealOsc) this._setupNatural();
    {
      const on = this.enabled ? 1 : 0;
      const v = speedKmph / 3.6;
      // flange squeal: tight curve, moderate speed
      const sq = curveR > 0 && curveR < 900 && v > 3 ? Math.min(1, (900 - curveR) / 500) * Math.min(1, v / 12) * (v < 25 ? 1 : 0.4) : 0;
      this.squealGain.gain.setTargetAtTime(on * sq * (interior ? 0.006 : 0.012) * (0.6 + 0.4 * Math.sin(t * 1.7)), t, 0.25);
      this.bridgeGain.gain.setTargetAtTime(on * (onBridge ? Math.min(0.5, v * 0.02) : 0), t, 0.3);
      // passing train
      if (passing && passing.dist < 250) {
        const k = 1 - passing.dist / 250;
        this.passGain.gain.setTargetAtTime(on * k * k * Math.min(0.5, passing.speed * 0.012 + 0.08), t, 0.15);
        this.passPan.pan.setTargetAtTime(passing.side, t, 0.2);
      } else this.passGain.gain.setTargetAtTime(0, t, 0.3);
      // wheel/brake friction synced to braking: grind ~ force x speed, squeal grows as we slow
      const bk = Math.min(1, brake / 100);
      const grind = moving0(v) ? bk * Math.min(1, v / 18) * (0.4 + 0.6 * Math.min(1, v / 6)) : 0;
      this.grindGain.gain.setTargetAtTime(on * grind * (interior ? 0.05 : 0.09), t, 0.12);
      this.grindLow.gain.setTargetAtTime(on * grind * (interior ? 0.09 : 0.12), t, 0.12);
      this.grindLfo.frequency.setTargetAtTime(Math.max(0.3, v / 2.88), t, 0.2); // wheel revolutions per second
      // squeal comes and goes in irregular bursts, loudest in the last metres before the stop
      this._sqFlTimer -= dt;
      if (this._sqFlTimer <= 0) { this._sqFlT = 0.25 + Math.random() * 1.1; this._sqFlTimer = 0.12 + Math.random() * 0.5; }
      this._sqFl += (this._sqFlT - this._sqFl) * Math.min(1, dt * 9);
      const sqk = bk > 0.12 && v > 0.12 && v < 13 ? bk * Math.pow(1 - v / 13, 1.4) * (v < 2.5 ? 1.4 : 1) * this._sqFl : 0;
      this.brakeSq.gain.setTargetAtTime(on * sqk * (interior ? 0.012 : 0.022), t, sqk > 0 ? 0.06 : 0.04);
      // driver's brake valve exhausting brake-pipe air on each application
      if (brake - this._prevBrake > 6 && on) this._hiss(t, 0.5 + (brake - this._prevBrake) / 60, 0.045, 1700);
      for (const { o, f } of this.brakeSqOsc) o.frequency.setTargetAtTime(f * (1 + (1 - v / 13) * 0.04), t, 0.2);
      // brake release hiss & slack clanks
      if (this._prevBrake > 10 && brake < 3) this._hiss(t, 1.4, 0.05 * on, 2200);
      this._prevBrake = brake;
      const moving = v > 0.4;
      if (moving !== this._prevMoving && on) { this._clank(t, moving ? 0.22 : 0.14); if (!moving) this._click(t, 0.35, false); }
      this._prevMoving = moving;
      // compressor cycling at standstill
      if (!moving && on) {
        this._compT -= dt;
        if (this._compT < 0) { for (let k = 0; k < 10; k++) this._click(t + k * 0.11, 0.05, false); this._hiss(t + 1.2, 0.5, 0.03, 4000); this._compT = 9 + Math.random() * 7; }
      }
      // diesel exhaust beat
      if (traction === 'diesel' && on) {
        this._dieselPh += dt * (3 + (notch / 8) * 9);
        if (this._dieselPh > 1) { this._dieselPh = 0; this._click(t, (0.02 + (notch / 8) * 0.05) * (interior ? 1.2 : 1), false); }
      }
    }
    // monsoon soundscape
    const raining = weather === 'MONSOON' && this.enabled && this.rainGain;
    if (this.rainGain) {
      const speedBoost = 1 + Math.min(0.8, speedKmph / 160);
      this.rainGain.gain.setTargetAtTime(raining ? (interior ? 0.32 : 0.55) * speedBoost : 0, t, 0.8);
      this.rainTone.frequency.setTargetAtTime(interior ? 1400 : 9000, t, 0.3); // muffled inside the cab
    }
    if (raining && !this.buffers.rain) {
      const rate = (interior ? 35 : 70) * (1 + speedKmph / 120);
      this._dropAt -= dt;
      while (this._dropAt < 0) {
        this._dropAt += (1 / rate) * (0.4 + Math.random() * 1.2);
        this._drop(t + Math.random() * 0.03, (interior ? 0.09 : 0.05) * (0.3 + Math.random()), interior);
      }
    }
    if (raining) {
      this._thunderIn -= dt;
      if (this._thunderIn < 0) {
        const dist = Math.random();
        if (this.onLightning) this.onLightning(dist);
        setTimeout(() => this.thunder(dist), 300 + dist * 3500); // light before sound
        this._thunderIn = 18 + Math.random() * 35;
      }
    }
    const on = this.enabled ? 1 : 0;
    const v = speedKmph / 3.6;
    const vol = interior ? 0.75 : 1;
    this.rollGain.gain.setTargetAtTime(on * Math.min(0.32, v * 0.012) * vol, t, 0.2);
    this.rollFilter.frequency.setTargetAtTime(160 + v * 18, t, 0.3);
    this.windGain.gain.setTargetAtTime(on * Math.min(0.18, v * v * 0.00012) * (interior ? 0.3 : 1), t, 0.3);
    this.brakeGain.gain.setTargetAtTime(on * (brake > 0 && v > 0.5 ? 0.02 + brake * 0.0007 : 0), t, 0.15);
    const load = notch / 8;
    if (traction === 'electric') {
      const f = 38 + v * 9.5;
      for (const { o, mul } of this.osc) o.frequency.setTargetAtTime(f * mul, t, 0.15);
      this.tracFilter.frequency.setTargetAtTime(700 + v * 40 + load * 900, t, 0.2);
      this.tracGain.gain.setTargetAtTime(on * (0.012 + load * 0.05) * Math.min(1, 0.2 + v * 0.05), t, 0.25);
    } else {
      const rpm = 28 + load * 42 + Math.min(v, 25) * 0.4;
      for (const { o, mul } of this.osc) o.frequency.setTargetAtTime(rpm * mul, t, 0.4);
      this.tracFilter.frequency.setTargetAtTime(260 + load * 500, t, 0.3);
      this.tracGain.gain.setTargetAtTime(on * (0.05 + load * 0.09), t, 0.3);
    }
    if (this.engFile) {
      this.engFile.playbackRate.setTargetAtTime(0.7 + load * 0.5 + v * 0.008, t, 0.3);
      this.engFileGain.gain.setTargetAtTime(on * (0.25 + load * 0.5), t, 0.3);
      this.tracGain.gain.setTargetAtTime(0, t, 0.1);
    }
    if (this.clatFile) {
      this.clatFile.playbackRate.setTargetAtTime(Math.max(0.3, v / 25), t, 0.3);
      this.clatFileGain.gain.setTargetAtTime(on * Math.min(0.6, v * 0.03), t, 0.3);
    } else if (on && v > 0.8) {
      // rail joints every 13 m (+ turnout frogs): two bogies => "ta-dak ... ta-dak"
      this._jointAcc += distanceStep;
      const spacing = onTurnout ? 4.5 : 26;
      while (this._jointAcc > spacing) {
        this._jointAcc -= spacing;
        const g = Math.min(0.5, 0.08 + v * 0.01) * (onTurnout ? 1.6 : 1) * vol;
        const gapA = 2.56 / Math.max(v, 1);  // axle spacing / speed
        const gapB = 14.8 / Math.max(v, 1);  // bogie centres / speed
        this._click(t + 0.01, g, onTurnout);
        this._click(t + 0.01 + gapA, g * 0.85, onTurnout);
        if (gapB < 1.6) { this._click(t + 0.01 + gapB, g * 0.7, onTurnout); this._click(t + 0.01 + gapB + gapA, g * 0.6, onTurnout); }
      }
    }
  }
}
