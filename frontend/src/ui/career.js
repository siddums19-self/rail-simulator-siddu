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

export const newCareer = () => ({ v: 1, xp: 0, km: 0, runs: 0, completed: 0, onTime: 0, spads: 0, incidents: 0, bestScore: 0, history: [], games: {} });

// Game modes that post to the leaderboards
// Achievements (kept in the career; ctx = what just happened)
export const ACHIEVEMENTS = [
  { id: 'first-run', icon: '🚆', title: 'First departure', desc: 'Complete your first journey', test: (c) => c.completed >= 1 },
  { id: 'km100', icon: '🛤', title: 'Century', desc: 'Drive 100 km', test: (c) => c.km >= 100 },
  { id: 'km1000', icon: '🧭', title: 'Long hauler', desc: 'Drive 1,000 km', test: (c) => c.km >= 1000 },
  { id: 'ontime5', icon: '⏱', title: 'Like clockwork', desc: 'Arrive on time 5 times', test: (c) => c.onTime >= 5 },
  { id: 'clean50', icon: '🛡', title: 'Clean sheet', desc: 'Finish a run of 50 km+ with no SPAD', test: (c, x) => x.kind === 'run' && x.completed && x.km >= 50 && !x.spads },
  { id: 'smooth', icon: '☕', title: 'Not a drop spilled', desc: 'Finish a run with 95%+ passenger comfort', test: (c, x) => x.kind === 'run' && x.completed && x.comfort >= 95 },
  { id: 'five-star', icon: '⭐', title: 'Five-star service', desc: 'Get a 5-star passenger rating', test: (c, x) => x.kind === 'run' && x.stars >= 5 },
  { id: 'suburban', icon: '🚇', title: 'Local hero', desc: 'Complete a suburban run (Mumbai or MMTS)', test: (c, x) => x.kind === 'run' && x.completed && x.suburban },
  { id: 'sm50', icon: '🏛', title: 'Master of the yard', desc: 'Handle 50 trains in one Station Master shift', test: (c, x) => x.kind === 'station' && x.trains >= 50 },
  { id: 'ctl', icon: '📈', title: 'In control', desc: 'Finish a Section Controller shift', test: (c, x) => x.kind === 'controller' },
  { id: 'daily', icon: '📅', title: 'Daily commuter', desc: 'Complete a daily challenge', test: (c, x) => x.kind === 'daily' },
  { id: 'mp', icon: '🏁', title: 'Race day', desc: 'Finish a multiplayer race', test: (c, x) => x.kind === 'mp' }
];

export const GAME_MODES = { drive: 'Train driving', station: 'Station Master', controller: 'Section Controller', wayside: 'Wayside Station Master', daily: 'Daily challenge' };
const GUEST_KEY = 'railsim.guestName', SCORES_KEY = 'railsim.scores';
const PERIOD_MS = { daily: 864e5, weekly: 7 * 864e5, monthly: 30 * 864e5 };

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

  // returns the achievements unlocked by this event
  checkAchievements(x = {}) {
    const c = this.career; c.ach ||= {};
    const got = [];
    for (const a of ACHIEVEMENTS) if (!c.ach[a.id]) { try { if (a.test(c, x)) { c.ach[a.id] = new Date().toISOString(); got.push(a); } } catch { /* ignore */ } }
    if (got.length) { this.dirty = true; this.save(); }
    return got;
  }

  // Name shown on the leaderboards: the guest's chosen name, or the account's email name
  get guestName() { return (ls.get(GUEST_KEY) || '').trim(); }
  set guestName(v) { ls.set(GUEST_KEY, String(v || '').trim().slice(0, 30) || null); }
  get displayName() { return this.guest ? (this.guestName || 'Guest') : this.email.split('@')[0]; }

  // A finished game of any mode: kept in the career and posted to the leaderboards.
  async recordGame({ mode, venue = '', score = 0, trains = 0, avgDelay = null }) {
    const c = this.career;
    c.games ||= {};
    const g = (c.games[mode] ||= { played: 0, best: null, trains: 0, total: 0 });
    g.played++; g.trains += trains; g.total += score; g.best = g.best === null ? score : Math.max(g.best, score);
    if (mode !== 'drive') c.xp += Math.max(0, Math.round(score / 20));
    this.dirty = true;
    this.save();
    const entry = { playerName: this.displayName, mode, venue, score: Math.round(score), trains, avgDelay, playedAt: new Date().toISOString(), guest: this.guest };
    try { // local copy: offline leaderboard
      const all = JSON.parse(ls.get(SCORES_KEY) || '[]');
      all.push(entry);
      ls.set(SCORES_KEY, JSON.stringify(all.filter((e) => Date.now() - Date.parse(e.playedAt) < PERIOD_MS.monthly).slice(-400)));
    } catch { /* ignore */ }
    api('/scores', { method: 'POST', body: entry, token: this.token }).catch(() => {});
  }

  // Top 10 for a mode over the last day / week / month (server; this device's games when offline)
  async leaderboard(mode, period = 'daily') {
    try {
      const rows = await api(`/leaderboard?mode=${encodeURIComponent(mode)}&period=${period}`, { timeout: 4000 });
      return { rows, online: true };
    } catch {
      let all = [];
      try { all = JSON.parse(ls.get(SCORES_KEY) || '[]'); } catch { /* ignore */ }
      const rows = all.filter((e) => e.mode === mode && Date.now() - Date.parse(e.playedAt) < PERIOD_MS[period])
        .sort((a, b) => b.score - a.score).slice(0, 10);
      return { rows, online: false };
    }
  }

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
    if (guestCareer && (guestCareer.km > 0 || guestCareer.runs > 0 || Object.keys(guestCareer.games || {}).length)) {
      const c = this.career;
      for (const k of ['xp', 'km', 'runs', 'completed', 'onTime', 'spads', 'incidents']) c[k] += guestCareer[k];
      c.games ||= {};
      for (const [m, g] of Object.entries(guestCareer.games || {})) {
        const t = (c.games[m] ||= { played: 0, best: null, trains: 0, total: 0 });
        t.played += g.played; t.trains += g.trains; t.total += g.total; t.best = t.best === null ? g.best : Math.max(t.best, g.best ?? t.best);
      }
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
