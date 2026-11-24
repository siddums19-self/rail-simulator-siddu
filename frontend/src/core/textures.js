import * as THREE from 'three/webgpu';
import { mulberry32 } from './rng.js';
import { boardNames, SCRIPT_FONT } from '../route/stationScripts.js';

// Procedural PBR texture synthesis. Everything is generated once and cached so
// the client needs zero downloads; real PBR sets can still override via assets.

const cache = new Map();
let maxAniso = 8;
export function setMaxAnisotropy(v) { maxAniso = Math.max(1, Math.min(16, v || 8)); }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { srgb = true, repeat = null, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Convert a grayscale height canvas into a tangent-space normal map.
function heightToNormal(src, strength = 2.0) {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d');
  const data = sctx.getImageData(0, 0, w, h).data;
  const [c, ctx] = canvas(w, h);
  const out = ctx.createImageData(w, h);
  const H = (x, y) => data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nz = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      out.data[i] = (-dx * nz * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy * nz * 0.5 + 0.5) * 255;
      out.data[i + 2] = nz * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return toTexture(c, { srgb: false });
}

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// ---------------------------------------------------------------- Track bed
export function ballastTextures() {
  return cached('ballast', () => {
    const rand = mulberry32(11);
    const S = 512;
    const [c, ctx] = canvas(S, S);
    const [hc, hctx] = canvas(S, S);
    ctx.fillStyle = '#4d4a46'; ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#202020'; hctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      const x = rand() * S, y = rand() * S, r = 2 + rand() * 6;
      const shade = 70 + Math.floor(rand() * 90);
      const warm = Math.floor(rand() * 10);
      ctx.fillStyle = `rgb(${shade + warm},${shade},${shade - 4})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      const g = hctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.5 + rand() * 0.5})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      hctx.fillStyle = g;
      hctx.beginPath(); hctx.arc(x, y, r, 0, Math.PI * 2); hctx.fill();
    }
    // rust dust stain toward the centre (brake dust)
    const grad = ctx.createLinearGradient(0, 0, S, 0);
    grad.addColorStop(0, 'rgba(90,60,40,0)');
    grad.addColorStop(0.5, 'rgba(90,60,40,0.1)');
    grad.addColorStop(1, 'rgba(90,60,40,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);
    return { map: toTexture(c), normalMap: heightToNormal(hc, 3.0) };
  });
}

export function concreteTextures(base = '#9a968e', key = 'concrete') {
  return cached(key + base, () => {
    const rand = mulberry32(base.length * 31 + 7);
    const S = 256;
    const [c, ctx] = canvas(S, S);
    const [hc, hctx] = canvas(S, S);
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const x = rand() * S, y = rand() * S, r = 0.5 + rand() * 2.5;
      const v = rand() > 0.5 ? 255 : 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rand() * 0.06})`;
      ctx.fillRect(x, y, r, r);
      hctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
      hctx.fillRect(x, y, r, r);
    }
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(40,35,30,${0.04 + rand() * 0.05})`;
      ctx.fillRect(rand() * S, 0, 4 + rand() * 20, S);
    }
    return { map: toTexture(c), normalMap: heightToNormal(hc, 1.2) };
  });
}

export function platformTileTextures() {
  return cached('pftile', () => {
    const rand = mulberry32(5);
    const S = 512;
    const [c, ctx] = canvas(S, S);
    const [hc, hctx] = canvas(S, S);
    ctx.fillStyle = '#6b6862'; ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#000'; hctx.fillRect(0, 0, S, S);
    const T = 64;
    for (let y = 0; y < S; y += T) {
      for (let x = 0; x < S; x += T) {
        const v = 150 + Math.floor(rand() * 26);
        const tint = rand() > 0.5 ? 6 : -4;
        ctx.fillStyle = `rgb(${v + tint},${v},${v - 6})`;
        ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
        for (let k = 0; k < 40; k++) {
          ctx.fillStyle = `rgba(0,0,0,${rand() * 0.08})`;
          ctx.fillRect(x + 2 + rand() * (T - 6), y + 2 + rand() * (T - 6), 2, 2);
        }
        hctx.fillStyle = '#fff'; hctx.fillRect(x + 2, y + 2, T - 4, T - 4);
      }
    }
    return { map: toTexture(c), normalMap: heightToNormal(hc, 1.5) };
  });
}

export function tactileTexture() {
  return cached('tactile', () => {
    const S = 128;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#e8b416'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#c99a0c';
    for (let y = 8; y < S; y += 16) for (let x = 8; x < S; x += 16) {
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    return toTexture(c);
  });
}

export function corrugatedTextures(color = '#4a6f8f') {
  return cached('corr' + color, () => {
    const W = 256, H = 64;
    const [c, ctx] = canvas(W, H);
    const [hc, hctx] = canvas(W, H);
    for (let x = 0; x < W; x++) {
      const k = Math.sin((x / W) * Math.PI * 2 * 16);
      const v = Math.floor(128 + k * 127);
      hctx.fillStyle = `rgb(${v},${v},${v})`; hctx.fillRect(x, 0, 1, H);
      const shade = 0.85 + k * 0.12;
      const base = new THREE.Color(color);
      ctx.fillStyle = `rgb(${Math.floor(base.r * 255 * shade)},${Math.floor(base.g * 255 * shade)},${Math.floor(base.b * 255 * shade)})`;
      ctx.fillRect(x, 0, 1, H);
    }
    const rand = mulberry32(3);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(120,80,40,${rand() * 0.12})`;
      ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 6, 1 + rand() * 4);
    }
    return { map: toTexture(c), normalMap: heightToNormal(hc, 1.6) };
  });
}

// --------------------------------------------------------------- Terrain
export function terrainDetailTexture() {
  return cached('terrainDetail', () => {
    const rand = mulberry32(21);
    const S = 512;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 14000; i++) {
      const v = 140 + Math.floor(rand() * 115);
      ctx.fillStyle = `rgba(${v},${v},${v},0.55)`;
      const x = rand() * S, y = rand() * S;
      if (rand() > 0.55) {
        ctx.fillRect(x, y, 1, 3 + rand() * 5); // grass blades
      } else {
        ctx.beginPath(); ctx.arc(x, y, 0.8 + rand() * 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    const [hc, hctx] = canvas(S, S);
    hctx.drawImage(c, 0, 0);
    return { map: toTexture(c, { srgb: true }), normalMap: heightToNormal(hc, 1.0) };
  });
}

export function fieldTexture(kind) {
  return cached('field' + kind, () => {
    const rand = mulberry32(kind.length * 13);
    const S = 256;
    const [c, ctx] = canvas(S, S);
    const palettes = {
      paddy:   ['#5f9a3c', '#4f8a32', '#6aa848'],
      wheat:   ['#c9a650', '#b8963f', '#d6b866'],
      mustard: ['#d8c23a', '#c4ad2a', '#e3d052'],
      cotton:  ['#6f8a3e', '#5e7a34', '#86a050'],
      plough:  ['#7a5238', '#6a452e', '#8a6044'],
      dry:     ['#9a7a4a', '#87683c', '#a8885a'],
      sunflower: ['#e0b020', '#5a7a2a', '#d09a10']
    };
    const pal = palettes[kind] || palettes.dry;
    ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 8) {
      ctx.fillStyle = pal[1]; ctx.fillRect(x, 0, 3, S);
    }
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = pal[2] + '88';
      ctx.fillRect(rand() * S, rand() * S, 2, 2);
    }
    if (kind === 'cotton') {
      for (let i = 0; i < 260; i++) { ctx.fillStyle = '#eceadf'; ctx.fillRect(rand() * S, rand() * S, 1.5, 1.5); }
    }
    return toTexture(c);
  });
}

export function asphaltTexture() {
  return cached('asphalt', () => {
    const rand = mulberry32(8);
    const S = 256;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#3a3a3c'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 6000; i++) {
      const v = 40 + Math.floor(rand() * 50);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rand() * S, rand() * S, 1.5, 1.5);
    }
    ctx.fillStyle = '#d8d8c8';
    for (let y = 0; y < S; y += 64) ctx.fillRect(S / 2 - 2, y, 4, 32);
    ctx.fillStyle = 'rgba(160,130,90,0.5)';
    ctx.fillRect(0, 0, 10, S); ctx.fillRect(S - 10, 0, 10, S);
    return toTexture(c);
  });
}

export function stonePitchingTexture() {
  return cached('stonepitch', () => {
    const rand = mulberry32(19);
    const S = 256;
    const [c, ctx] = canvas(S, S);
    const [hc, hctx] = canvas(S, S);
    ctx.fillStyle = '#5b5148'; ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#000'; hctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 380; i++) {
      const x = rand() * S, y = rand() * S, r = 6 + rand() * 9;
      const v = 105 + Math.floor(rand() * 60);
      ctx.fillStyle = `rgb(${v + 10},${v},${v - 12})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, rand() * 3, 0, Math.PI * 2); ctx.fill();
      hctx.fillStyle = '#ddd';
      hctx.beginPath(); hctx.ellipse(x, y, r * 0.9, r * 0.6, 0, 0, Math.PI * 2); hctx.fill();
    }
    return { map: toTexture(c), normalMap: heightToNormal(hc, 2.2) };
  });
}

export function brickWallTexture(color = '#b4664a') {
  return cached('brick' + color, () => {
    const rand = mulberry32(color.length);
    const W = 256, H = 256;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#c9c0b0'; ctx.fillRect(0, 0, W, H);
    const bw = 32, bh = 14;
    for (let y = 0; y < H; y += bh) {
      const off = (y / bh) % 2 ? bw / 2 : 0;
      for (let x = -bw; x < W; x += bw) {
        const k = 0.85 + rand() * 0.25;
        const col = new THREE.Color(color).multiplyScalar(k);
        ctx.fillStyle = `#${col.getHexString()}`;
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
    return toTexture(c);
  });
}

// ---------------------------------------------------------------- Signage
export function stationBoardTexture(name, code) {
  return cached('board3|' + name, () => {
    const W = 1024, H = 512;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#f5c518'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 16; ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const nm = boardNames(code, name);
    const fit = (text, font, size, y, weight = 'bold') => {
      let sz = size;
      ctx.font = `${weight} ${sz}px ${font}`;
      while (ctx.measureText(text).width > W - 90 && sz > 30) { sz -= 4; ctx.font = `${weight} ${sz}px ${font}`; }
      ctx.fillText(text, W / 2, y);
    };
    const english = name.replace(/\bJN\b\.?/, 'JN.');
    if (nm.local) {
      fit(nm.local, SCRIPT_FONT[nm.lang], 104, 112);
      fit(nm.hi, SCRIPT_FONT.hi, 96, 252);
      fit(english, '"Arial Black", Arial, sans-serif', 104, 392);
    } else {
      fit(nm.hi, SCRIPT_FONT.hi, 130, 160);
      fit(english, '"Arial Black", Arial, sans-serif', 124, 352);
    }
    ctx.font = 'bold 30px Arial';
    ctx.fillText(code, W - 90, H - 44);
    return toTexture(c, { wrap: false });
  });
}

export function genericBoardTexture(text, { bg = '#f5c518', fg = '#111', w = 768, h = 192, font = 'bold 96px Arial' } = {}) {
  return cached(`gb|${text}|${bg}|${fg}|${w}|${h}`, () => {
    const [c, ctx] = canvas(w, h);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg; ctx.lineWidth = 8; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font;
    const lines = String(text).split('\n');
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (h / (lines.length + 0.6)), w - 48)); // squeeze long names to fit
    return toTexture(c, { wrap: false });
  });
}

export function ledIndicatorTexture(label) {
  return cached('led' + label, () => {
    const [c, ctx] = canvas(256, 96);
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#ff3b1f';
    ctx.font = 'bold 64px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 50);
    return toTexture(c, { wrap: false });
  });
}

// Indian station building facade: cream walls, maroon trim, arches.
export function stationFacadeTexture(name) {
  return cached('facade' + name, () => {
    const W = 2048, H = 512;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#ead9b4'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#8c2f22'; ctx.fillRect(0, 0, W, 34); ctx.fillRect(0, 248, W, 18); ctx.fillRect(0, H - 30, W, 30);
    for (let x = 40; x < W - 60; x += 120) {
      // upper windows
      ctx.fillStyle = '#7a2a1e'; ctx.fillRect(x + 18, 70, 64, 120);
      ctx.fillStyle = '#2b3440'; ctx.fillRect(x + 24, 76, 52, 108);
      ctx.fillStyle = '#ead9b4'; ctx.fillRect(x + 48, 76, 4, 108);
      // ground arches
      ctx.fillStyle = '#7a2a1e';
      ctx.beginPath(); ctx.moveTo(x + 10, H - 30); ctx.lineTo(x + 10, 340); ctx.arc(x + 50, 340, 40, Math.PI, 0); ctx.lineTo(x + 90, H - 30); ctx.fill();
      ctx.fillStyle = '#1d2329';
      ctx.beginPath(); ctx.moveTo(x + 18, H - 30); ctx.lineTo(x + 18, 342); ctx.arc(x + 50, 342, 32, Math.PI, 0); ctx.lineTo(x + 82, H - 30); ctx.fill();
    }
    ctx.fillStyle = '#f5c518'; ctx.fillRect(W / 2 - 420, 196, 840, 46);
    ctx.fillStyle = '#111'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center';
    ctx.fillText(name, W / 2, 232);
    return toTexture(c, { wrap: false });
  });
}

// Residential facade (one storey, ~10 m x 3.2 m) with chajja shades and grills.
export function houseFacadeTexture(wall, seed, isShop = false) {
  return cached(`house|${wall}|${seed}|${isShop}`, () => {
    const rand = mulberry32(seed * 977 + 13);
    const W = 512, H = 160;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
    // weathering
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(60,50,40,${rand() * 0.06})`;
      ctx.fillRect(rand() * W, rand() * H * 0.3 + H * 0.7, 20 + rand() * 60, 4 + rand() * 20);
    }
    if (isShop) {
      const cols = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#7d3c98'];
      ctx.fillStyle = cols[Math.floor(rand() * cols.length)];
      ctx.fillRect(10, 10, W - 20, 38);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center';
      const names = ['SRI SAI TRADERS', 'BALAJI HOTEL', 'LAKSHMI STORES', 'MOBILE WORLD', 'VENKATESWARA MEDICAL', 'RAJU TEA STALL'];
      ctx.fillText(names[Math.floor(rand() * names.length)], W / 2, 38);
      ctx.fillStyle = '#5d6d7e'; ctx.fillRect(30, 60, W - 60, H - 60);
      for (let x = 30; x < W - 30; x += 12) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, 60, 2, H - 60); }
    } else {
      const n = 2 + Math.floor(rand() * 2);
      const doorAt = Math.floor(rand() * (n + 1));
      const slot = W / (n + 1);
      for (let i = 0; i <= n; i++) {
        const cx = slot * (i + 0.5);
        if (i === doorAt) {
          ctx.fillStyle = '#5b3a1e'; ctx.fillRect(cx - 26, 52, 52, H - 52);
          ctx.fillStyle = '#7a4f2a'; ctx.fillRect(cx - 20, 58, 18, H - 66); ctx.fillRect(cx + 2, 58, 18, H - 66);
        } else {
          ctx.fillStyle = '#3b4652'; ctx.fillRect(cx - 34, 50, 68, 62);
          ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
          for (let gx = cx - 30; gx < cx + 34; gx += 9) { ctx.beginPath(); ctx.moveTo(gx, 50); ctx.lineTo(gx, 112); ctx.stroke(); }
          ctx.strokeRect(cx - 34, 50, 68, 62);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(cx - 42, 40, 84, 8); // chajja shade
      }
    }
    return toTexture(c, { wrap: false });
  });
}

export function windowGlowTexture(seed) {
  return cached('glow' + seed, () => {
    const rand = mulberry32(seed + 99);
    const W = 512, H = 160;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const n = 3;
    const slot = W / (n + 1);
    for (let i = 0; i <= n; i++) {
      if (rand() > 0.45) { ctx.fillStyle = '#ffcf7a'; ctx.fillRect(slot * (i + 0.5) - 32, 52, 64, 58); }
    }
    return toTexture(c, { wrap: false });
  });
}

// ----------------------------------------------------------- Rolling stock
// Coach body is swept along a profile; v runs around the perimeter.
// side() draws one side band of height `sideH` px (top = roof line).
export function coachLiveryTextures(key, { body, roof = '#4b5563', vSide0, vSide1, vRoof1, side, emissiveSide, roughSide }) {
  return cached('coach' + key, () => {
    const W = 2048, H = 1024;
    const [c, ctx] = canvas(W, H);
    const [e, ectx] = canvas(W, H);
    const [r, rctx] = canvas(W, H);
    ctx.fillStyle = body; ctx.fillRect(0, 0, W, H);
    ectx.fillStyle = '#000'; ectx.fillRect(0, 0, W, H);
    rctx.fillStyle = '#7a7a7a'; rctx.fillRect(0, 0, W, H);
    const row = (v) => (1 - v) * H;
    // roof band
    ctx.fillStyle = roof; ctx.fillRect(0, row(vRoof1), W, row(vSide1) - row(vRoof1));
    rctx.fillStyle = '#b0b0b0'; rctx.fillRect(0, row(vRoof1), W, row(vSide1) - row(vRoof1));
    const sideH = Math.round(row(vSide0) - row(vSide1));
    const drawBand = (targetCtx, fn, flip) => {
      const [bc, bctx] = canvas(W, sideH);
      fn(bctx, W, sideH);
      targetCtx.save();
      if (!flip) {
        targetCtx.drawImage(bc, 0, row(vSide1));
      } else {
        targetCtx.translate(W, row(vRoof1));
        targetCtx.scale(-1, -1);
        targetCtx.drawImage(bc, 0, 0);
      }
      targetCtx.restore();
    };
    drawBand(ctx, side, false);
    drawBand(ctx, side, true);
    if (emissiveSide) { drawBand(ectx, emissiveSide, false); drawBand(ectx, emissiveSide, true); }
    if (roughSide) { drawBand(rctx, roughSide, false); drawBand(rctx, roughSide, true); }
    const map = toTexture(c, { wrap: false });
    const emissiveMap = toTexture(e, { wrap: false });
    const roughnessMap = toTexture(r, { srgb: false, wrap: false });
    return { map, emissiveMap, roughnessMap };
  });
}

export function locoSideTexture(key, draw) {
  return cached('loco' + key, () => {
    const [c, ctx] = canvas(2048, 512);
    draw(ctx, 2048, 512);
    const t = toTexture(c, { wrap: false });
    return t;
  });
}

export function coalTexture() {
  return cached('coal', () => {
    const rand = mulberry32(77);
    const S = 256;
    const [c, ctx] = canvas(S, S);
    const [hc, hctx] = canvas(S, S);
    ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#000'; hctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1800; i++) {
      const x = rand() * S, y = rand() * S, r = 1 + rand() * 4;
      const v = 18 + Math.floor(rand() * 40);
      ctx.fillStyle = `rgb(${v},${v},${v + 2})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      hctx.fillStyle = `rgba(255,255,255,${rand()})`;
      hctx.beginPath(); hctx.arc(x, y, r, 0, Math.PI * 2); hctx.fill();
    }
    return { map: toTexture(c), normalMap: heightToNormal(hc, 3) };
  });
}

export function boxnSideTexture() {
  return cached('boxnSide', () => {
    const W = 1024, H = 256;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#6b3020'; ctx.fillRect(0, 0, W, H);
    const rand = mulberry32(4);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${120 + rand() * 60},${60 + rand() * 30},20,${rand() * 0.25})`;
      ctx.fillRect(rand() * W, rand() * H, 3 + rand() * 30, 2 + rand() * 12);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 40; x < W; x += 92) ctx.fillRect(x, 0, 14, H);
    ctx.fillStyle = '#efefef'; ctx.font = 'bold 30px monospace';
    ctx.fillText('SCR  BOXNHL', 360, 120);
    ctx.font = 'bold 20px monospace';
    ctx.fillText('CC+8+2  71.0T  RTD', 380, 160);
    return toTexture(c, { wrap: false });
  });
}

export function grassTuftTexture() {
  return cached('grassTuft', () => {
    const rand = mulberry32(31);
    const [c, ctx] = canvas(128, 128);
    ctx.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) {
      const x = 10 + rand() * 108, h = 50 + rand() * 75, lean = (rand() - 0.5) * 30;
      const g = Math.floor(150 + rand() * 90);
      ctx.strokeStyle = `rgb(${Math.floor(g * 0.75)},${g},${Math.floor(g * 0.45)})`;
      ctx.lineWidth = 1.5 + rand() * 2;
      ctx.beginPath(); ctx.moveTo(x, 128); ctx.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.5, x + lean, 128 - h); ctx.stroke();
    }
    return toTexture(c, { wrap: false });
  });
}

export function starsTextureDot() {
  return cached('star', () => {
    const [c, ctx] = canvas(32, 32);
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    return toTexture(c, { wrap: false });
  });
}
