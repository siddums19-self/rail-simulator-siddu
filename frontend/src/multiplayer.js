import { API_BASE } from './config.js';

// Multiplayer race rooms. The owner creates a room with a 4-digit code and the route; friends join with
// the code and everyone drives the same route; progress is shared about once a second. Uses the backend
// (/api/rooms); if it can't be reached, rooms work between tabs/windows on this device (BroadcastChannel).
export class Multiplayer {
  constructor({ onUpdate, toast } = {}) {
    this.onUpdate = onUpdate || (() => {}); this.toast = toast || (() => {});
    this.room = null; this.name = null; this.local = false; this.timer = null; this.players = new Map();
  }

  async _api(path, method = 'GET', body) {
    const r = await fetch(`${API_BASE}/rooms${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.message || data.error || `Error ${r.status}`); e.status = r.status; throw e; }
    return data;
  }

  _channel(code) {
    this.bc?.close();
    this.bc = new BroadcastChannel(`railsim-room-${code}`);
    this.bc.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'state') this.players.set(m.p.name, m.p);
      if (m.type === 'hello' && this.room && this.name === this.room.owner) this.bc.postMessage({ type: 'room', room: this._localRoom() });
      if (m.type === 'room' && !this.room?.route?.src) this.room = m.room;
      if (m.type === 'start') this.room.started = true;
      if (m.type === 'leave') this.players.delete(m.name);
      this._emit();
    };
  }
  _localRoom() { return { ...this.room, players: [...this.players.values()] }; }
  _emit() { this.onUpdate(this.room ? { ...this.room, players: [...this.players.values()] } : null); }

  async create(code, owner, route) {
    if (!/^\d{4}$/.test(code)) throw new Error('Choose a 4-digit room code');
    this.name = owner;
    try { this.room = await this._api('', 'POST', { code, owner, mode: 'race', route }); this.local = false; }
    catch (e) {
      if (e.status) throw e;            // the server answered (code in use, ...)
      this.local = true; this.room = { code, owner, mode: 'race', route, started: false, players: [] };
      this.toast('Server offline — room works between tabs on this device only', 'warn', 4000);
    }
    this.players = new Map((this.room.players || []).map((p) => [p.name, p]));
    this.players.set(owner, { name: owner, km: 0, totalKm: 0, speed: 0, score: 0, late: 0, done: false, status: 'owner' });
    this._channel(code); this._loop(); this._emit();
    return this.room;
  }

  async join(code, name) {
    if (!/^\d{4}$/.test(code)) throw new Error('Enter the 4-digit room code');
    this.name = name;
    try { this.room = await this._api(`/${code}/join`, 'POST', { name }); this.local = false; }
    catch (e) {
      if (e.status === 404) {          // maybe a same-device room
        this.local = true; this.room = { code, owner: '?', route: null, started: false };
        this._channel(code); this.bc.postMessage({ type: 'hello' });
        await new Promise((r) => setTimeout(r, 600));
        if (!this.room.route) { this.room = null; throw new Error(`No room with code ${code}`); }
      } else throw e;
    }
    this.players = new Map((this.room.players || []).map((p) => [p.name, p]));
    if (!this.bc) this._channel(code);
    this._loop(); this._emit();
    return this.room;
  }

  async start() {
    if (!this.room) return;
    this.room.started = true;
    if (!this.local) await this._api(`/${this.room.code}/start`, 'POST').catch(() => {});
    this.bc?.postMessage({ type: 'start' });
  }

  // our progress (called every frame; sent ~1/s)
  report(p) { this.me = { ...p, name: this.name }; }

  _loop() {
    clearInterval(this.timer);
    this.timer = setInterval(async () => {
      if (!this.room) return;
      const me = this.me || { name: this.name, km: 0, totalKm: 0, speed: 0, score: 0, late: 0, done: false, status: 'waiting' };
      this.players.set(this.name, me);
      this.bc?.postMessage({ type: 'state', p: me });
      if (!this.local) {
        try {
          const room = await this._api(`/${this.room.code}/state`, 'POST', me);
          const wasStarted = this.room.started;
          this.room = { ...this.room, ...room };
          this.players = new Map(room.players.map((p) => [p.name, p]));
          if (!wasStarted && room.started) this.room.justStarted = true;
        } catch { /* keep the last known state */ }
      }
      this._emit();
    }, 1000);
  }

  async leave() {
    clearInterval(this.timer);
    if (this.room && !this.local) this._api(`/${this.room.code}/leave`, 'POST', { name: this.name }).catch(() => {});
    this.bc?.postMessage({ type: 'leave', name: this.name });
    this.bc?.close(); this.bc = null;
    this.room = null; this.players.clear(); this._emit();
  }
}
