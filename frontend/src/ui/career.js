// Player account (email login / guest) and the career that is saved with it.
import { API_BASE } from '../config.js';

const TOKEN_KEY = 'railsim.token';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const RANKS = [
  { xp: 0, title: 'Assistant Loco Pilot', duty: 'DEMU / passenger' },
  { xp: 400, title: 'Loco Pilot (Goods)', duty: 'BOXN goods' },
  { xp: 1200, title: 'Loco Pilot (Passenger)', duty: 'ICF passenger' },
  { xp: 3000, title: 'Loco Pilot (Mail/Express)', duty: 'LHB Mail/Express' },
  { xp: 6000, title: 'Senior Loco Pilot', duty: 'Rajdhani / Duranto' },
  { xp: 10000, title: 'Senior Loco Pilot (Vande Bharat)', duty: 'Vande Bharat' },
  { xp: 16000, title: 'Loco Inspector', duty: 'All duties' }
];

export const newCareer = () => ({ v: 1, xp: 0, km: 0, runs: 0, completed: 0, onTime: 0, spads: 0, incidents: 0, bestScore: 0, history: [] });

export function rankOf(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const cur = RANKS[i], next = RANKS[i + 1] || null;
  return { index: i, ...cur, next, progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1 };
}

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } }
};

async function api(path, { method = 'GET', body, token, timeout = 6000, keepalive = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, keepalive });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.message || data.error || `Error ${r.status}`); e.status = r.status; throw e; }
    return data;
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) { const x = new Error('Server is offline — try again later or continue as guest'); x.offline = true; throw x; }
    throw e;
  } finally { clearTimeout(t); }
}

function parseCareer(json) {
  try { const c = JSON.parse(json); if (c && typeof c.xp === 'number') return { ...newCareer(), ...c }; } catch { /* corrupt */ }
  return newCareer();
}

export class Account {
  constructor() {
    this.token = ls.get(TOKEN_KEY);
    this.email = null;          // null => guest
    this.career = newCareer();
    this.onChange = () => {};
    this.dirty = false;
  }

  get guest() { return !this.email; }

  // Resume a saved session. Returns true when logged in.
  async resume() {
    if (!this.token) return false;
    try {
      const me = await api('/auth/me', { token: this.token });
      this._adopt(me.email, me.career);
      return true;
    } catch (e) {
      if (e.status === 401) { this.token = null; ls.set(TOKEN_KEY, null); }
      throw e;
    }
  }

  static validEmail(email) { return EMAIL_RE.test(String(email || '').trim()); }

  async login(email, password) { return this._session('/auth/login', email, password); }
  async signup(email, password) { return this._session('/auth/signup', email, password); }

  async _session(path, email, password) {
    if (!Account.validEmail(email)) throw new Error('Please enter a valid email address');
    if (!password) throw new Error('Password is required');
    const guestCareer = this.guest ? this.career : null;
    let r;
    try { r = await api(path, { method: 'POST', body: { email: email.trim(), password } }); }
    catch (e) {
      if (e.status === 401) throw new Error('Wrong email or password');
      if (e.status === 409) throw new Error('An account with this email already exists — log in instead');
      throw e;
    }
    this.token = r.token;
    ls.set(TOKEN_KEY, r.token);
    this._adopt(r.email, r.career);
    // progress made as a guest this session is carried into the account
    if (guestCareer && (guestCareer.km > 0 || guestCareer.runs > 0)) {
      const c = this.career;
      for (const k of ['xp', 'km', 'runs', 'completed', 'onTime', 'spads', 'incidents']) c[k] += guestCareer[k];
      c.bestScore = Math.max(c.bestScore, guestCareer.bestScore);
      c.history = [...guestCareer.history, ...c.history].slice(0, 12);
      this.dirty = true;
      await this.save();
    }
  }

  async logout() {
    await this.save();
    const t = this.token;
    this.token = null; this.email = null; this.career = newCareer();
    ls.set(TOKEN_KEY, null);
    this.onChange();
    if (t) api('/auth/logout', { method: 'POST', token: t }).catch(() => {});
  }

  continueAsGuest() { this.email = null; this.career = newCareer(); this.onChange(); }

  _adopt(email, careerJson) {
    this.email = email;
    this.career = careerJson ? parseCareer(careerJson) : newCareer();
    this.onChange();
  }

  // ---------------------------------------------------------------- career events
  addKm(km) {
    if (!(km > 0)) return;
    this.career.km += km;
    this.career.xp += km * 2;
    this.dirty = true;
  }

  // A run ends (completed at the destination, abandoned, or an incident).
  finishRun({ route, rake, km, score, late, spads, completed, incident }) {
    const c = this.career;
    const before = rankOf(c.xp).index;
    let xp = 0;
    if (completed) xp += 100 + (late <= 2 ? 100 : late <= 10 ? 40 : 0) + Math.max(0, Math.round(score / 10));
    xp -= 50 * (spads || 0) + (incident ? 150 : 0);
    c.xp = Math.max(0, c.xp + xp);
    c.runs++;
    if (completed) c.completed++;
    if (completed && late <= 2) c.onTime++;
    c.spads += spads || 0;
    if (incident) c.incidents++;
    if (completed) c.bestScore = Math.max(c.bestScore, score);
    c.history = [{ at: new Date().toISOString(), route, rake, km: Math.round(km * 10) / 10, score, late: Math.round(late || 0), completed: !!completed, incident: incident || null, xp }, ...c.history].slice(0, 12);
    this.dirty = true;
    this.save();
    return { xp, promoted: rankOf(c.xp).index > before ? rankOf(c.xp) : null };
  }

  async save(keepalive = false) {
    if (this.guest || !this.token || !this.dirty) return;
    this.dirty = false;
    const c = this.career;
    c.km = Math.round(c.km * 100) / 100;
    c.xp = Math.round(c.xp * 10) / 10;
    try { await api('/career', { method: 'PUT', body: c, token: this.token, keepalive }); }
    catch (e) { this.dirty = true; if (e.status === 401) { this.token = null; ls.set(TOKEN_KEY, null); } }
  }
}
