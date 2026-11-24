import { spokenName } from '../route/stationScripts.js';
import { API_BASE } from '../config.js';

// Station ambience (crowd, vendors) and regular English PA announcements for
// the trains at and around the station the player is in.

const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const spell = (no) => String(no).split('').join(' ');
const sayTime = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const trainTitle = (nm) => nm.replace(/\bSF Exp\b/, 'Superfast Express').replace(/\bSF\b/, 'Superfast Express').replace(/\bExp\b/, 'Express').replace(/\bDEMU\b/, 'demu passenger').replace(/\bMEMU\b/, 'memu').replace(/-/g, ' to ');

export class StationAudio {
  constructor(audio) {
    this.audio = audio;
    this.nextAnnounce = 6;
    this.lastStation = null;
    this.voices = [];
    this._announcer = 0;
    this.welcomed = new Set();
    this.voiceMode = 'browser';
  }

  // Natural crowd: a soft murmur bed plus several distant "speakers" whose
  // formant-filtered noise is gated into irregular syllables and words, all
  // sent mostly through the reverb so it reads as a busy hall, not a hiss.
  _setupCrowd() {
    const a = this.audio;
    if (this.crowdGain || !a.ctx) return;
    const ctx = a.ctx;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    const dry = ctx.createGain(); dry.gain.value = 0.35;
    const wet = ctx.createGain(); wet.gain.value = 1.0;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200;
    this.crowdGain.connect(tone);
    tone.connect(dry).connect(a.master);
    tone.connect(wet).connect(a.reverb);
    this.crowdTone = tone;
    if (a.buffers.crowd) {
      const src = ctx.createBufferSource(); src.buffer = a.buffers.crowd; src.loop = true; src.connect(this.crowdGain); src.start();
      this.realCrowd = true;
      return;
    }
    // murmur bed
    const bed = ctx.createBufferSource(); bed.buffer = a.noiseBuf; bed.loop = true; bed.playbackRate.value = 0.9;
    const bl = ctx.createBiquadFilter(); bl.type = 'bandpass'; bl.frequency.value = 520; bl.Q.value = 0.9;
    const bg = ctx.createGain(); bg.gain.value = 0.25;
    bed.connect(bl).connect(bg).connect(this.crowdGain); bed.start();
    // babbling voices
    for (let i = 0; i < 10; i++) {
      const src = ctx.createBufferSource(); src.buffer = a.noiseBuf; src.loop = true; src.playbackRate.value = 1.6 + Math.random() * 0.8;
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5;
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 6;
      const g1 = ctx.createGain(), g2 = ctx.createGain(); g2.gain.value = 0.55;
      const env = ctx.createGain(); env.gain.value = 0;
      const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.8 - 0.9;
      src.connect(f1).connect(g1).connect(env); src.connect(f2).connect(g2).connect(env);
      env.connect(pan).connect(this.crowdGain);
      src.start(ctx.currentTime, Math.random() * 2);
      const female = Math.random() < 0.45;
      this.voices.push({ f1, f2, env, next: Math.random() * 2, base: female ? 1.25 : 1, loud: 0.5 + Math.random() * 0.8 });
    }
  }

  _scheduleCrowd() {
    const a = this.audio, ctx = a.ctx, t = ctx.currentTime;
    const VOWELS = [[730, 1090], [270, 2290], [300, 870], [530, 1840], [640, 1190], [440, 1020], [390, 1990]];
    for (const v of this.voices) {
      if (t < v.next) continue;
      // one "phrase": 2-7 syllables, then a pause
      let tt = t + 0.02;
      const n = 2 + Math.floor(Math.random() * 6);
      for (let k = 0; k < n; k++) {
        const [F1, F2] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
        v.f1.frequency.setValueAtTime(F1 * v.base, tt); v.f2.frequency.setValueAtTime(F2 * v.base, tt);
        const dur = 0.09 + Math.random() * 0.16, g = 0.05 * v.loud * (0.6 + Math.random() * 0.6);
        v.env.gain.setValueAtTime(0.0001, tt);
        v.env.gain.linearRampToValueAtTime(g, tt + dur * 0.3);
        v.env.gain.linearRampToValueAtTime(g * 0.6, tt + dur * 0.8);
        v.env.gain.linearRampToValueAtTime(0.0001, tt + dur);
        tt += dur + 0.02 + Math.random() * 0.08;
      }
      v.next = tt + 0.4 + Math.random() * 2.2;
    }
    // distant footsteps / trolley rumble
    if (Math.random() < 0.05) for (let k = 0; k < 4; k++) a._click(t + k * (0.45 + Math.random() * 0.1), 0.012, false);
  }

  _pickVoice(female) {
    const voices = speechSynthesis.getVoices();
    const FEMALE = /veena|heera|lekha|raveena|kajal|aditi|neerja|swara|female|samantha|karen|moira|tessa|zira|susan|serena|fiona|victoria|sonia|libby/i;
    const MALE = /rishi|ravi|prabhat|male|daniel|alex|fred|david|mark|ryan|thomas/i;
    const natural = (v) => /natural|neural|online|premium|enhanced/i.test(v.name);
    const gender = (v) => (female ? FEMALE : MALE).test(v.name);
    const enIN = voices.filter((v) => /en[-_]IN/i.test(v.lang));
    const en = voices.filter((v) => v.lang.startsWith('en'));
    const order = [
      enIN.find((v) => natural(v) && gender(v)), enIN.find((v) => gender(v)), enIN.find(natural),
      en.find((v) => natural(v) && gender(v)), en.find((v) => gender(v) && /GB|UK/i.test(v.lang + v.name)), en.find(gender), enIN[0], en[0]
    ];
    const voice = order.find(Boolean) || null;
    return { voice, exact: !!voice && gender(voice) };
  }

  _speak(text, { female = true, rate = 0.9, volume = this.paVolume ?? 0.4 } = {}) {
    if (!('speechSynthesis' in window) || !this.audio.enabled || !this.audio.announcements) return false;
    if (speechSynthesis.speaking || speechSynthesis.pending) return false;
    const u = new SpeechSynthesisUtterance(text);
    const { voice, exact } = this._pickVoice(female);
    u.voice = voice;
    u.lang = voice?.lang || 'en-IN'; u.rate = rate; u.volume = volume;
    u.pitch = exact ? 1 : female ? 1.1 : 0.92;
    speechSynthesis.speak(u);
    return true;
  }

  // Announcements tied to real train movements at this station, phrased the way
  // Indian Railways PA announcers speak (number digit by digit, then name, then platform).
  trainEvent(type, t, now) {
    const m = t.name.match(/^(\d{5})\s+(.*)$/);
    const id = m ? `train number ${spell(m[1])}, ${trainTitle(m[2])}` : (/goods|rake|special/i.test(t.name) ? 'a goods train' : t.name);
    const pf = t.track?.pf ? `platform number ${t.track.pf}` : 'the loop line';
    let text;
    if (type === 'expected') text = `May I have your attention, please. ${cap(id)}, is expected to arrive shortly on ${pf}, at ${sayTime(t.eta)}.`;
    else if (type === 'arrived') text = `${cap(id)}, has arrived on ${pf}. It is scheduled to leave at ${sayTime(t.departAt)}.`;
    else text = `${cap(id)}, is now leaving from ${pf}. We wish all passengers a happy journey.`;
    this.queue = this.queue || [];
    this.queue.push({ text, st: t.st, at: performance.now() });
  }

  // New route: drop everything queued or scheduled for the previous journey.
  reset() {
    this.queue = [];
    this.gen = (this.gen || 0) + 1;
    this.lastStation = null;
    this.nextAnnounce = 6;
    this._queueBusy = false;
    this.welcomed = new Set();
    this.stopSpeech();
  }

  // Public: chime, then announce (used for our own train's arrival too).
  say(text, female = true) {
    const gen = this.gen || 0;
    this.audio.stationChime(null);
    setTimeout(() => {
      if (gen !== (this.gen || 0)) return;
      if (this.voiceMode === 'cloud' && !(this.cloudDownUntil > performance.now())) { this._cloudSay(text, female, gen); return; }
      if (!this._speak(text, { female })) setTimeout(() => { if (gen === (this.gen || 0)) this._speak(text, { female }); }, 4000);
    }, 1700);
  }

  // Station PA loudspeakers heard from a distance: telephone-band speaker tone,
  // slap-back echo from other speakers down the platform, lots of hall reverb, low level.
  _paChain() {
    if (this.paIn) return this.paIn;
    const a = this.audio, ctx = a.ctx;
    this.paIn = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3300;
    const horn = ctx.createBiquadFilter(); horn.type = 'peaking'; horn.frequency.value = 1700; horn.Q.value = 1.2; horn.gain.value = 5;
    this.paOut = ctx.createGain(); this.paOut.gain.value = 0.3;
    this.paIn.connect(hp).connect(lp).connect(horn).connect(this.paOut);
    const dry = ctx.createGain(); dry.gain.value = 0.35;
    const wet = ctx.createGain(); wet.gain.value = 1.0;
    const echo = ctx.createDelay(1); echo.delayTime.value = 0.14;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const echoG = ctx.createGain(); echoG.gain.value = 0.45;
    this.paOut.connect(dry).connect(a.master);
    this.paOut.connect(wet).connect(a.reverb);
    this.paOut.connect(echo); echo.connect(fb).connect(echo); echo.connect(echoG).connect(a.master); echoG.connect(a.reverb);
    return this.paIn;
  }

  async _cloudSay(text, female, gen) {
    const a = this.audio;
    if (!a.ctx || !a.enabled || !a.announcements) return;
    const key = (female ? 'f|' : 'm|') + text;
    this.cloudCache ||= new Map();
    try {
      this.cloudBusy = true;
      let buf = this.cloudCache.get(key);
      if (!buf) {
        const r = await fetch(`${API_BASE}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, gender: female ? 'female' : 'male' }) });
        if (!r.ok) throw new Error(`TTS ${r.status}`);
        buf = await a.ctx.decodeAudioData(await r.arrayBuffer());
        this.cloudCache.set(key, buf);
      }
      if (gen !== (this.gen || 0)) { this.cloudBusy = false; return; }
      const src = a.ctx.createBufferSource(); src.buffer = buf;
      src.connect(this._paChain());
      this.paOut.gain.setValueAtTime(this.paLevel ?? 0.3, a.ctx.currentTime);
      src.onended = () => { this.cloudBusy = false; if (this.cloudSrc === src) this.cloudSrc = null; };
      this.cloudSrc = src;
      src.start();
    } catch (e) {
      // cloud voice unavailable: fall back to the browser voice for a while
      this.cloudBusy = false;
      this.cloudDownUntil = performance.now() + 120000;
      this.onCloudFail?.(e.message);
      this._speak(text, { female });
    }
  }

  stopSpeech() {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    try { this.cloudSrc?.stop(); } catch { /* ignore */ }
    this.cloudSrc = null; this.cloudBusy = false;
  }

  // Regular announcements: only real things (welcome, our train, trains really
  // standing at this station). No caution / safety messages.
  _announcement(ctx) {
    const { st, ops, layout, ownHalted, timetable } = ctx;
    const r = Math.random();
    const own = ops.trackOf(st);
    const where = (t) => (t.pf ? `platform number ${t.pf}` : 'the loop line');
    const from = spokenName(layout.stations[0].name), to = spokenName(layout.stations[layout.stations.length - 1].name);
    const here = spokenName(st.name);
    if (!this.welcomed.has(st) || r < 0.15) {
      this.welcomed.add(st);
      return `Welcome to ${here}${st.category === 'metro' ? ' railway station' : ''}. We wish you a pleasant journey.`;
    }
    if (ownHalted && r < 0.55) {
      const row = timetable?.rows[st.index];
      const dep = row?.dep != null ? ` It is scheduled to leave at ${sayTime(row.dep)}.` : '';
      return `Train number ${spell(ops.trainNo)}, ${from} to ${to} Express, is standing on ${where(own)}.${dep}`;
    }
    const others = [];
    for (const [no, occ] of st.occupancy) {
      const t = st.layout.tracks.find((x) => x.no === no);
      if (t && occ.name && t.pf && occ.kind === 'parked' && /^\d{5}/.test(occ.name)) others.push({ t, occ });
    }
    if (others.length) {
      const { t, occ } = others[Math.floor(Math.random() * others.length)];
      const m = occ.name.match(/^(\d{5})\s+(.*)$/);
      return `Train number ${spell(m[1])}, ${trainTitle(m[2])}, is standing on ${where(t)}.`;
    }
    return null;
  }

  update(dt, ctx) {
    const a = this.audio;
    if (!a.ctx) return;
    this._setupCrowd();
    const { st, distToPlatform, interior } = ctx;
    const size = !st ? 0 : st.category === 'metro' ? 1 : st.category === 'junction' ? 0.8 : st.halt ? 0.45 : 0.3;
    const prox = st ? Math.max(0, 1 - distToPlatform / 450) : 0;
    const target = a.enabled ? size * prox * (interior ? 0.25 : 1) * (1 - Math.min(0.7, ctx.speedKmph / 80)) * (this.realCrowd ? 0.6 : 0.9) : 0;
    this.crowdGain.gain.setTargetAtTime(target, a.ctx.currentTime, 0.8);
    this.crowdTone.frequency.setTargetAtTime(interior ? 900 : 3200, a.ctx.currentTime, 0.3);
    if (target > 0.01 && !this.realCrowd) this._scheduleCrowd();
    // the PA is a background voice: quiet outside, quieter still from inside the train
    this.paVolume = interior ? 0.22 : 0.38;
    this.paLevel = interior ? 0.16 : 0.3;
    if (this.paOut) this.paOut.gain.setTargetAtTime(this.cloudSrc ? this.paLevel : this.paOut.gain.value, a.ctx.currentTime, 0.4);
    // station announcements belong to that station: drop them once we are away from it
    if (this.queue) this.queue = this.queue.filter((q) => q.st === st && prox >= 0.3 && performance.now() - q.at < 90000);
    if (this.queue && this.queue.length && !(window.speechSynthesis?.speaking || window.speechSynthesis?.pending) && !this.cloudBusy && !this._queueBusy) {
      this._queueBusy = true;
      const text = this.queue.shift().text;
      this.say(text, true);
      setTimeout(() => { this._queueBusy = false; }, 2500);
      this.nextAnnounce = Math.max(this.nextAnnounce, 20);
    }
    if (!st || prox < 0.3) {
      // leaving the station: the PA fades out behind us
      if (this.lastStation) { this.gen = (this.gen || 0) + 1; this.stopSpeech(); }
      this.lastStation = null;
      return;
    }
    if (this.lastStation !== st) { this.lastStation = st; this.nextAnnounce = 4 + Math.random() * 4; }
    this.nextAnnounce -= dt;
    if (this.nextAnnounce <= 0 && !this.cloudBusy && (st.halt || st.category !== 'station')) {
      const text = this._announcement(ctx);
      const female = (this._announcer++ % 3) !== 2; // mostly the female announcer, sometimes male
      if (text) this.say(text, female);
      this.nextAnnounce = 30 + Math.random() * 25;
    }
  }
}
