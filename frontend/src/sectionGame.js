import { SectionSim, SECTION, SECTION_KIND as KIND } from './sectionSim.js';

// Front end for the Guntakal - Dhone single-line modes (see sectionSim.js).
export class SectionGame {
  constructor(root, { onGameOver } = {}) {
    this.root = root; this.onGameOver = onGameOver || (() => {});
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.panel = root.querySelector('#sec-panel');
    this.canvas.addEventListener('pointerdown', (e) => this._click(e));
    this.panel.addEventListener('click', (e) => this._act(e));
    this.running = false;
  }

  start(mode, station = 6, shiftMin = 15) {
    this.sim = new SectionSim(mode, station, shiftMin * 60);
    this.mode = mode; this.sel = null; this.msg = '';
    this.root.style.display = 'flex';
    if (!this.running) { this.running = true; this._last = performance.now(); this._loop(); }
  }
  stop() { this.running = false; this.root.style.display = 'none'; }

  _loop() {
    if (!this.running) return;
    const now = performance.now(), dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    this.sim.update(dt);
    if (this.sim.over && !this.sim.reported) {
      this.sim.reported = true;
      const venue = this.mode === 'controller' ? 'Guntakal–Dhone' : SECTION[this.sim.player].name;
      this.onGameOver({ mode: this.mode, venue, score: Math.round(this.sim.score), trains: this.sim.done.length, avgDelay: Math.round(this.sim.avgDelay() * 10) / 10 });
    }
    if (this.mode === 'controller') this._drawChart(); else this._drawStation();
    if (!this._pt || now - this._pt > 250) { this._pt = now; this._panel(); }
    requestAnimationFrame(() => this._loop());
  }

  _size() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W, H };
  }

  // ------------------------------------------------------------ Section Controller: time-distance chart
  _drawChart() {
    const { W, H } = this._size(), g = this.ctx, sim = this.sim;
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
    const x0 = 150, x1 = W - 20, y0 = 50, y1 = H - 30;
    const span = 150 * 60, tNow = sim.t, tA = tNow - span * 0.8, tB = tNow + span * 0.2;
    const X = (t) => x0 + ((t - tA) / (tB - tA)) * (x1 - x0);
    const Y = (km) => y0 + (km / SECTION.at(-1).km) * (y1 - y0);
    g.font = 'bold 15px system-ui'; g.fillStyle = '#e2e8f0'; g.textBaseline = 'middle';
    g.fillText('Section Control · Guntakal – Dhone single line', 16, 20);
    // time grid every 10 sim min
    g.font = '10px system-ui';
    for (let m = Math.ceil(tA / 600) * 600; m < tB; m += 600) {
      const x = X(m);
      g.strokeStyle = m % 3600 === 0 ? '#334155' : '#1e293b'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      g.fillStyle = '#64748b'; g.fillText(clock(m), x - 14, y1 + 14);
    }
    // stations and their lines (main + loops)
    SECTION.forEach((s, i) => {
      const y = Y(s.km);
      g.strokeStyle = s.end ? '#64748b' : '#334155'; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.fillStyle = '#cbd5e1'; g.font = `${s.end ? 'bold ' : ''}12px system-ui`; g.fillText(s.name, 10, y - 6);
      if (!s.end) sim.st[i].lines.forEach((o, li) => {
        g.fillStyle = o ? KIND[o.kind].col : '#1e293b';
        g.fillRect(10 + li * 34, y + 2, 30, 9);
        g.fillStyle = '#94a3b8'; g.font = '8px system-ui'; g.fillText(li === 0 ? 'M' : `L${li}${s.loops[li - 1] < 650 ? ' short' : ''}`, 12 + li * 34, y + 17);
      });
    });
    // block occupancy bars at the "now" line
    sim.blocks.forEach((b, i) => {
      if (!b) return;
      g.fillStyle = KIND[b.kind].col; g.globalAlpha = 0.35;
      g.fillRect(X(tNow) - 4, Y(SECTION[i].km), 8, Y(SECTION[i + 1].km) - Y(SECTION[i].km)); g.globalAlpha = 1;
    });
    g.strokeStyle = '#fde047'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(tNow), y0 - 6); g.lineTo(X(tNow), y1); g.stroke(); g.setLineDash([]);
    // train paths
    this._hits = [];
    for (const tr of sim.trains) {
      const k = KIND[tr.kind];
      g.strokeStyle = k.col; g.lineWidth = this.sel === tr ? 3.5 : 2;
      g.beginPath();
      tr.hist.forEach(([t, p], j) => { if (j) g.lineTo(X(t), Y(p)); else g.moveTo(X(t), Y(p)); });
      if (tr.state !== 'gone') g.lineTo(X(tNow), Y(tr.pos));
      g.stroke();
      if (tr.state === 'gone') continue;
      const x = X(tNow), y = Y(tr.pos);
      g.fillStyle = this.sel === tr ? '#fde047' : k.col; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e2e8f0'; g.font = 'bold 10px system-ui';
      const flags = `${tr.holdAt !== null ? ' ⏸' : ''}${tr.loopAt !== null ? ' ↷loop' : ''}${tr.state === 'station' && tr.stopped ? ' ■' : ''}`;
      g.fillText(`${tr.no}${tr.dir > 0 ? '↓' : '↑'}${flags}`, x + 9, y);
      this._hits.push({ tr, x, y });
    }
    this._overlay(W, H);
  }

  // ------------------------------------------------------------ Wayside station master: station panel
  _drawStation() {
    const { W, H } = this._size(), g = this.ctx, sim = this.sim, p = sim.player, P = SECTION[p];
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
    g.font = 'bold 15px system-ui'; g.fillStyle = '#e2e8f0'; g.textBaseline = 'middle';
    g.fillText(`Station Master · ${P.name} · ${clock(sim.t)}`, 16, 20);
    const yMain = H * 0.55, xa = W * 0.06, xb = W * 0.94, xs0 = W * 0.38, xs1 = W * 0.62;
    const kmA = SECTION[p - 1].km, kmB = SECTION[p + 1].km;
    const X = (km) => (km <= P.km - 0.6 ? xa + ((km - kmA) / (P.km - 0.6 - kmA)) * (xs0 - xa)
      : km >= P.km + 0.6 ? xs1 + ((km - P.km - 0.6) / (kmB - P.km - 0.6)) * (xb - xs1) : xs0 + ((km - P.km + 0.6) / 1.2) * (xs1 - xs0));
    // single line both sides + main through the station
    g.strokeStyle = '#64748b'; g.lineWidth = 3; g.beginPath(); g.moveTo(xa, yMain); g.lineTo(xb, yMain); g.stroke();
    const loopY = (li) => yMain - li * 34;
    P.loops.forEach((len, k) => {
      const y = loopY(k + 1);
      g.beginPath(); g.moveTo(xs0 - 40, yMain); g.lineTo(xs0, y); g.lineTo(xs1, y); g.lineTo(xs1 + 40, yMain); g.stroke();
      g.fillStyle = '#94a3b8'; g.font = '11px system-ui'; g.fillText(`${sim.lineName(p, k + 1)} · ${len} m`, xs0, y - 10);
    });
    g.fillStyle = '#94a3b8'; g.fillText(`Main`, xs0, yMain + 14);
    g.fillStyle = '#334155'; g.fillRect(xs0, yMain + 22, xs1 - xs0, 10); // platform
    // neighbours
    for (const [i, x] of [[p - 1, xa], [p + 1, xb]]) {
      g.fillStyle = '#cbd5e1'; g.font = 'bold 12px system-ui'; g.textAlign = x < W / 2 ? 'left' : 'right';
      g.fillText(SECTION[i].name, x, yMain + 50); g.textAlign = 'left';
    }
    g.fillStyle = '#e2e8f0'; g.font = 'bold 13px system-ui'; g.textAlign = 'center'; g.fillText(P.name.toUpperCase(), W / 2, yMain + 50); g.textAlign = 'left';
    // block occupancy
    for (const [b, xA, xB] of [[p - 1, xa, xs0 - 40], [p, xs1 + 40, xb]]) {
      const o = sim.blocks[b];
      g.fillStyle = o ? '#ef4444' : '#22c55e'; g.fillRect(xA, yMain + 64, xB - xA, 4);
      g.fillStyle = '#94a3b8'; g.font = '10px system-ui'; g.fillText(o ? `Block occupied · ${o.no}` : 'Block clear', xA, yMain + 78);
    }
    // signals: home + starter each side
    const sig = (x, on, label) => { g.fillStyle = '#111'; g.fillRect(x - 6, yMain - 54, 12, 22); g.fillStyle = on ? '#22c55e' : '#ef4444'; g.beginPath(); g.arc(x, yMain - 43, 4.5, 0, 7); g.fill(); g.fillStyle = '#64748b'; g.font = '9px system-ui'; g.fillText(label, x - 14, yMain - 62); };
    const towards = (dir) => sim.trains.find((t) => t.state !== 'gone' && t.to === p && t.dir === dir && t.state !== 'station');
    const here = (dir) => sim.trains.find((t) => t.state === 'station' && t.at === p && t.dir === dir);
    const hd = towards(1), hu = towards(-1), sd = here(1), su = here(-1);
    sig(X(P.km - 1.0), hd && hd.routeLine != null, 'Home ▶');
    sig(X(P.km + 1.0), hu && hu.routeLine != null, '◀ Home');
    sig(xs1 + 10, sd && sd.starterCleared, 'Starter ▶');
    sig(xs0 - 10, su && su.starterCleared, '◀ Starter');
    // LC gate (Guntakal side)
    if (P.gate) {
      const gx = X(P.km - 2.2);
      g.strokeStyle = '#94a3b8'; g.lineWidth = 6; g.beginPath(); g.moveTo(gx, yMain - 80); g.lineTo(gx, yMain + 40); g.stroke();
      const col = sim.gate === 'closed' ? '#ef4444' : sim.gate === 'open' ? '#22c55e' : '#f59e0b';
      g.strokeStyle = col; g.lineWidth = 4; g.beginPath();
      if (sim.gate === 'closed') { g.moveTo(gx - 26, yMain - 10); g.lineTo(gx + 26, yMain - 10); } else { g.moveTo(gx, yMain - 10); g.lineTo(gx + 6, yMain - 48); }
      g.stroke(); g.fillStyle = col; g.font = '10px system-ui'; g.fillText(`LC gate ${sim.gate}`, gx - 28, yMain - 90);
    }
    // trains
    for (const tr of sim.active()) {
      if (tr.pos < kmA - 0.01 || tr.pos > kmB + 0.01) continue;
      const k = KIND[tr.kind];
      let y = yMain;
      const inSt = Math.abs(tr.pos - P.km) < 0.61;
      if (inSt && tr.at === p && tr.line > 0) y = loopY(tr.line);
      if (inSt && tr.to === p && tr.routeLine > 0) y = loopY(tr.routeLine);
      const len = Math.max(30, Math.min(140, k.len / 6)), x = X(tr.pos);
      const xL = tr.dir > 0 ? x - len : x;
      g.fillStyle = k.col; g.fillRect(xL, y - 7, len, 14);
      g.fillStyle = '#fff'; g.font = 'bold 10px system-ui'; g.fillText(`${tr.no} ${tr.dir > 0 ? '▶' : '◀'}`, xL + 3, y);
    }
    this._hits = [];
    this._overlay(W, H);
  }

  _overlay(W, H) {
    const sim = this.sim, g = this.ctx;
    if (!sim.over) return;
    g.fillStyle = 'rgba(2,6,23,.85)'; g.fillRect(W / 2 - 240, H / 2 - 60, 480, 120);
    g.textAlign = 'center'; g.fillStyle = '#fde047'; g.font = 'bold 19px system-ui'; g.fillText(sim.over, W / 2, H / 2 - 20);
    g.fillStyle = '#e2e8f0'; g.font = '14px system-ui';
    g.fillText(`Score ${Math.round(sim.score)} · ${sim.done.length} trains · average ${sim.avgDelay().toFixed(1)} min late`, W / 2, H / 2 + 14);
    g.textAlign = 'left';
  }

  _click(e) {
    if (this.mode !== 'controller') return;
    const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null;
    for (const h of this._hits || []) { const d = Math.hypot(h.x - x, h.y - y); if (d < 18 && (!best || d < best.d)) best = { d, tr: h.tr }; }
    this.sel = best ? best.tr : null;
    this._pt = 0;
  }

  // ------------------------------------------------------------ side panel
  _panel() {
    const sim = this.sim;
    const stat = `<div id="sec-stats"><div class="sm-stat"><b>${Math.round(sim.score)}</b><span>score</span></div><div class="sm-stat"><b>${sim.done.length}</b><span>trains through</span></div>`
      + `<div class="sm-stat"><b>${sim.avgDelay().toFixed(1)}</b><span>avg min late</span></div><div class="sm-stat"><b>${mmss(Math.max(0, sim.shift - sim.real))}</b><span>shift left</span></div></div>`;
    let body = '';
    const btn = (act, id, label, on = true) => `<button data-act="${act}" data-id="${id}" ${on ? '' : 'disabled'}>${label}</button>`;
    const where = (t) => t.state === 'entry' ? `waiting to enter at ${SECTION[t.at].name}` : t.state === 'station' ? `at ${SECTION[t.at].name} (${sim.lineName(t.at, t.line)})${t.stopped ? ', stopped' : ''}`
      : t.state === 'home' ? `at ${SECTION[t.to].name} home signal` : `running ${SECTION[t.from].name} → ${SECTION[t.to].name}`;
    if (this.mode === 'controller') {
      const s = this.sel && this.sel.state !== 'gone' ? this.sel : null;
      body += s ? `<div class="sec-card sel"><b>${s.no} ${s.name}</b> ${s.dir > 0 ? '↓ to Dhone' : '↑ to Guntakal'}<br><small>${where(s)} · ${KIND[s.kind].v} km/h · ${KIND[s.kind].len} m</small>
        <div class="row">${btn('hold', s.id, s.holdAt !== null ? `Release (held at ${SECTION[s.holdAt].name})` : 'Hold at next stop')}${btn('loop', s.id, s.loopAt !== null ? `Cancel loop at ${SECTION[s.loopAt].name}` : 'Loop at next station')}</div></div>`
        : '<div class="muted sec-help">Tap a train on the chart (or below) to give it orders.</div>';
      body += sim.active().map((t) => `<div class="sec-card" data-act="sel" data-id="${t.id}"><b style="color:${KIND[t.kind].col}">${t.no}</b> ${t.name} ${t.dir > 0 ? '↓' : '↑'}<br><small>${where(t)}${t.wait > 60 ? ` · waited ${Math.round(t.wait / 60)} min` : ''}</small></div>`).join('');
      body += '<div class="muted sec-help">Plan the crossings: send the slower train into the loop early so the faster one runs through on the main. A full goods rake doesn\'t fit the short loop at Tuggali. If both stations at the ends of a block fill up, the section locks.</div>';
    } else {
      const p = sim.player;
      if (SECTION[p].gate) body += `<div class="sec-card"><b>Level-crossing gate</b> (Guntakal side): ${sim.gate}<div class="row">${btn('gate', 0, sim.gate === 'open' ? 'Close gate' : sim.gate === 'closed' ? 'Open gate' : '…', sim.gate === 'open' || sim.gate === 'closed')}</div></div>`;
      for (const t of sim.requests) body += `<div class="sec-card req">☎ <b>${SECTION[p - t.dir].name}</b> asks line clear for <b>${t.no} ${t.name}</b> ${t.dir > 0 ? '▶' : '◀'}<div class="row">${btn('grant', t.id, 'Give line clear')}</div></div>`;
      for (const t of sim.active()) {
        const coming = t.to === p && t.state !== 'station' && (t.state === 'run' || t.state === 'home');
        const atUs = t.at === p && t.state === 'station';
        if (!coming && !atUs) continue;
        const k = KIND[t.kind];
        let html = `<div class="sec-card"><b style="color:${k.col}">${t.no}</b> ${t.name} ${t.dir > 0 ? '▶' : '◀'} · ${k.len} m${k.stops ? ' · stops here' : ' · runs through'}<br><small>${where(t)}</small>`;
        if (coming) {
          html += `<div class="row">${SECTION[p].loops.map((_, k2) => k2 + 1).concat([0]).map((li) => btn(`route${li}`, t.id, `${t.routeLine === li ? '✓ ' : ''}${sim.lineName(p, li)}`)).join('')}</div>`;
        }
        if (coming || atUs) {
          html += `<div class="row">${btn('lc', t.id, t.lcNext ? `✓ Line clear from ${SECTION[p + t.dir].name}` : t.asked ? 'Asking…' : `Ask line clear: ${SECTION[p + t.dir].name}`, !t.lcNext && !t.asked)}${btn('starter', t.id, t.starterCleared ? '✓ Starter off' : 'Clear starter', t.lcNext && !t.starterCleared)}</div>`;
        }
        body += html + '</div>';
      }
      body += '<div class="muted sec-help">Give line clear when the neighbour asks, then set the route (main or loop) before the train reaches your home signal. For a train running through, ask line clear from the next station and clear the starter early so it doesn\'t have to stop. Close the gate for trains from the Guntakal side, and open it again once they have passed.</div>';
    }
    const log = `<div class="sm-log">${sim.log.map((l) => `<div>${l}</div>`).join('')}</div>`;
    const html = stat + body + log;
    if (html !== this._lastHtml) { this.panel.querySelector('#sec-body').innerHTML = html; this._lastHtml = html; }
  }

  _act(e) {
    const el = e.target.closest('[data-act]');
    if (!el || !this.sim) return;
    const act = el.dataset.act, tr = this.sim.trains.find((t) => t.id === Number(el.dataset.id));
    const sim = this.sim;
    let err = null;
    if (act === 'sel') this.sel = tr;
    else if (act === 'gate') err = sim.toggleGate();
    else if (!tr) return;
    else if (act === 'hold') err = sim.hold(tr);
    else if (act === 'loop') err = sim.loop(tr);
    else if (act === 'grant') err = sim.grant(tr);
    else if (act.startsWith('route')) err = sim.setRoute(tr, Number(act.slice(5)));
    else if (act === 'lc') err = sim.askLineClear(tr);
    else if (act === 'starter') err = sim.clearStarter(tr);
    if (err) sim._log(`✗ ${err}`);
    this._pt = 0;
  }
}

function clock(simSecs) { const m = Math.floor(simSecs / 60) + 6 * 60; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function mmss(s) { s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
