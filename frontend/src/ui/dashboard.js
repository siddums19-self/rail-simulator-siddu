// Cab desk instruments drawn on a 2D canvas (shown in the cab view) and the
// speed-recorder chart (speed & limit vs. km, SPAD markers).

function gauge(ctx, cx, cy, r, value, max, label, unit, { redFrom = null, marker = null, ticks = 10, fmt = (v) => Math.round(v) } = {}) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  const ang = (v) => a0 + (a1 - a0) * Math.min(1, Math.max(0, v / max));
  ctx.save();
  ctx.fillStyle = '#0b0f14'; ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 2; ctx.stroke();
  if (redFrom !== null) { ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, r - 4, ang(redFrom), a1); ctx.stroke(); }
  ctx.strokeStyle = '#cbd5e1'; ctx.fillStyle = '#cbd5e1'; ctx.lineWidth = 1.5;
  ctx.font = `${Math.round(r * 0.18)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, a = ang(v);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10)); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
    if (i % 2 === 0) ctx.fillText(fmt(v), cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22));
  }
  if (marker !== null) {
    const a = ang(marker);
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12)); ctx.lineTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4)); ctx.stroke();
  }
  const a = ang(value);
  ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); ctx.stroke();
  ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#94a3b8'; ctx.font = `bold ${Math.round(r * 0.16)}px Arial`;
  ctx.fillText(label, cx, cy + r * 0.42);
  ctx.fillStyle = '#e2e8f0'; ctx.font = `bold ${Math.round(r * 0.24)}px Arial`;
  ctx.fillText(`${fmt(value)} ${unit}`, cx, cy + r * 0.68);
  ctx.restore();
}

export function drawDashboard(canvas, d) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(30,34,40,0.92)'); grd.addColorStop(1, 'rgba(12,14,18,0.96)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 14); ctx.fill();
  const r = H * 0.36;
  gauge(ctx, 105, H / 2, r, d.kmh, d.vmax + 20, 'SPEED', 'km/h', { marker: d.limit, ticks: 10, redFrom: d.vmax });
  gauge(ctx, 270, H / 2, r * 0.82, d.bp, 6, 'BRAKE PIPE', 'kg/cm²', { ticks: 6, fmt: (v) => v.toFixed(1), marker: 5 });
  gauge(ctx, 410, H / 2, r * 0.82, d.mr, 12, 'MAIN RES.', 'kg/cm²', { ticks: 6, fmt: (v) => v.toFixed(1) });
  gauge(ctx, 550, H / 2, r * 0.82, d.amps, 1200, d.traction === 'diesel' ? 'LOAD' : 'TRACTION', 'A', { ticks: 6, redFrom: 1000 });
  // notch / brake column
  ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText('NOTCH', 655, 24);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i < d.notch ? '#22c55e' : '#1f2937';
    ctx.fillRect(640, H - 26 - i * 16, 30, 12);
  }
  ctx.fillStyle = '#94a3b8'; ctx.fillText('BRAKE', 700, 24);
  ctx.fillStyle = '#1f2937'; ctx.fillRect(688, 34, 24, H - 60);
  ctx.fillStyle = d.emergency ? '#dc2626' : '#f59e0b';
  const bh = (H - 60) * Math.min(1, d.brake / 100);
  ctx.fillRect(688, 34 + (H - 60) - bh, 24, bh);
  // Kavach DMI
  const x0 = 740, w = W - x0 - 14;
  ctx.fillStyle = '#05080c'; ctx.beginPath(); ctx.roundRect(x0, 14, w, H - 28, 8); ctx.fill();
  ctx.strokeStyle = d.kavach ? '#22c55e' : '#7f1d1d'; ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = d.kavach ? '#86efac' : '#fca5a5'; ctx.font = 'bold 12px Arial';
  ctx.fillText(d.kavach ? 'KAVACH · FS MODE' : 'KAVACH ISOLATED', x0 + 10, 32);
  const aspectCol = { RED: '#ef4444', YELLOW: '#fbbf24', DOUBLE_YELLOW: '#fbbf24', GREEN: '#22c55e', UNKNOWN: '#64748b' }[d.aspect] || '#64748b';
  ctx.fillStyle = aspectCol; ctx.beginPath(); ctx.arc(x0 + 26, 62, 13, 0, Math.PI * 2); ctx.fill();
  if (d.aspect === 'DOUBLE_YELLOW') { ctx.beginPath(); ctx.arc(x0 + 54, 62, 13, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px Arial';
  ctx.fillText(d.sigLabel || '—', x0 + 76, 58);
  ctx.fillStyle = '#94a3b8'; ctx.font = '12px Arial';
  ctx.fillText(d.sigDist != null ? `${Math.round(d.sigDist)} m` : '', x0 + 76, 74);
  ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 12px Arial';
  ctx.fillText(`Permitted ${Math.round(d.limit)} km/h`, x0 + 10, 100);
  ctx.fillText(d.target ? `Target ${Math.round(d.target.limit)} in ${Math.round(d.target.dist)} m` : 'Target —', x0 + 10, 118);
  if (d.kavachMsg) { ctx.fillStyle = '#fbbf24'; ctx.fillText(`BRAKE: ${d.kavachMsg}`, x0 + 10, 136); }
  ctx.fillStyle = d.delay > 1 ? '#fca5a5' : '#86efac';
  ctx.fillText(d.delayText || '', x0 + 10, H - 22);
}

export function drawRecorder(canvas, trace, { title = 'Speed recorder' } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H);
  const pts = trace.filter((p) => !p.spad);
  if (pts.length < 2) { ctx.fillStyle = '#94a3b8'; ctx.font = '14px Arial'; ctx.fillText('No data recorded yet.', 20, 30); return; }
  const k0 = pts[0].km, k1 = Math.max(k0 + 0.5, pts[pts.length - 1].km);
  const vmax = Math.max(60, ...pts.map((p) => Math.max(p.kmh, Math.min(p.limit, 200)))) * 1.1;
  const L = 48, R = 12, T = 28, B = 32;
  const X = (km) => L + ((km - k0) / (k1 - k0)) * (W - L - R);
  const Y = (v) => H - B - (v / vmax) * (H - T - B);
  ctx.strokeStyle = '#1f2a3d'; ctx.lineWidth = 1; ctx.fillStyle = '#64748b'; ctx.font = '11px Arial';
  for (let v = 0; v <= vmax; v += 20) { ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.fillText(String(v), 10, Y(v) + 4); }
  const step = Math.max(1, Math.round((k1 - k0) / 10));
  for (let k = Math.ceil(k0); k <= k1; k += step) { ctx.fillText(`${k}`, X(k) - 6, H - 12); }
  ctx.fillText('km/h', 8, 16); ctx.fillText('km', W - 30, H - 12);
  // limit (stepped, dashed)
  ctx.strokeStyle = '#ef4444'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.beginPath();
  pts.forEach((p, i) => { const y = Y(Math.min(p.limit, vmax)); if (i === 0) ctx.moveTo(X(p.km), y); else ctx.lineTo(X(p.km), y); });
  ctx.stroke(); ctx.setLineDash([]);
  // speed
  ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.km), Y(p.kmh)); else ctx.lineTo(X(p.km), Y(p.kmh)); });
  ctx.stroke();
  // overspeed shading
  ctx.fillStyle = 'rgba(239,68,68,0.25)';
  for (let i = 1; i < pts.length; i++) if (pts[i].kmh > pts[i].limit + 5) ctx.fillRect(X(pts[i - 1].km), T, Math.max(1, X(pts[i].km) - X(pts[i - 1].km)), H - T - B);
  for (const p of trace) if (p.spad) { ctx.fillStyle = '#f87171'; ctx.fillText('SPAD', X(p.km) - 14, T + 12); ctx.fillRect(X(p.km), T, 2, H - T - B); }
  ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px Arial'; ctx.fillText(title, L, 18);
  ctx.fillStyle = '#38bdf8'; ctx.fillText('— speed', W - 170, 18); ctx.fillStyle = '#ef4444'; ctx.fillText('- - limit', W - 90, 18);
}
