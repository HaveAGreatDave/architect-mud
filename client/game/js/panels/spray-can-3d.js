// THE CAN IN 3-D: the spray can you shake and spray with in the spray session (spray-session.js).
//
// A small WebGL view of its own: an aerosol turned on a lathe (the domed base, the body, the shoulder,
// the crimp, the colour collar and the actuator with its nozzle), with a few dents in it, and a label
// painted onto a canvas and wrapped round the body. It sits big in the panel while you shake it, then
// follows the pointer as the can you spray with.
//
// ⚠ THE LABEL IS THE ITEM'S, NOT THIS FILE'S. The words and colours come from the can item's
// `can_label` tag (content/items, sent on `spray_editor` as `can.label`): brand, product, strap, fine
// print, the body colour and the house colours. This file only knows how a label is laid out, so a
// second brand is a content file, and a can with no label gets a plain one.
//
// Off the comic look (gl/house-style.js) it's lit smooth; on it, two bands and the house ink round it.
// No WebGL, and `ok` is false: the session keeps its flat CSS can.

import { HOUSE, comicOn } from './gl/house-style.js';

// A can with no `can_label`: grey, with what it is on it and nothing else.
export const PLAIN_LABEL = Object.freeze({ brand: 'SPRAY PAINT', product: '', strap: '', fine: '', net: '', body: '#4a4d52', colours: ['#b8f03a'], cap: '#e8e6e0', wear: 0 });

const SEG = 72;                       // round the can
const TEX = 1024;                     // the atlas: label on top, the collar's cells and the actuator below
const LABEL_H = 780, COLLAR_Y = 800, COLLAR_H = 80, CAP_Y = 900, CAP_H = 100;
const BODY_Y0 = 0.14, BODY_Y1 = 4.9;  // the label's height on the body, in can radii
const M = { LABEL: 0, METAL: 1, COLLAR: 2, CAP: 3, PAINT: 4 };
// where the can's been knocked about: round the back and the sides, never across the brand
const DENTS = [{ u: 0.17, y: 1.7, depth: 0.075, rad: 0.5 }, { u: 0.8, y: 3.9, depth: 0.055, rad: 0.38 }, { u: 0.66, y: 0.75, depth: 0.04, rad: 0.3 }];

// ── the label ────────────────────────────────────────────────────────────────────────────────────

const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const n = m ? parseInt(m[1], 16) : 0x808080; return [n >> 16, (n >> 8) & 255, n & 255]; };
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashStr = (s) => [...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const FACE = '"Arial Black", "Helvetica Neue", Impact, "Segoe UI", sans-serif';

/** A label as given, with anything missing or malformed taken from the plain one. */
export function labelOf(raw) {
  const L = raw && typeof raw === 'object' ? raw : {};
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const col = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
  const colours = (Array.isArray(L.colours) ? L.colours : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c || '')).slice(0, 6);
  return {
    brand: str(L.brand, 24) || PLAIN_LABEL.brand, product: str(L.product, 32), strap: str(L.strap, 48),
    fine: str(L.fine, 600), net: str(L.net, 16),
    body: col(L.body, PLAIN_LABEL.body), cap: col(L.cap, PLAIN_LABEL.cap),
    colours: colours.length ? colours : PLAIN_LABEL.colours.slice(),
    wear: Math.max(0, Math.min(1, Number(L.wear) || 0)),
  };
}

// One line of type squeezed to `w` wide if it's wider, centred on x.
function fitText(g, text, x, y, w, size, weight = 900, face = FACE) {
  g.font = `${weight} ${size}px ${face}`;
  const tw = g.measureText(text).width;
  g.save(); g.translate(x, y);
  if (tw > w) g.scale(w / tw, 1);
  g.fillText(text, 0, 0);
  g.restore();
}
function wrap(g, text, x, y, w, lh) {
  const words = text.split(/\s+/);
  let line = '';
  for (const word of words) {
    const t = line ? line + ' ' + word : word;
    if (g.measureText(t).width > w && line) { g.fillText(line, x, y); y += lh; line = word; } else line = t;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
}

/**
 * The atlas: the label (x is round the can, the front at the middle; y is down the body), the
 * collar's colour cells, and the actuator's white with the nozzle on its front. Alpha marks bare
 * metal where the print has worn through.
 */
export function paintCanAtlas(raw) {
  const L = labelOf(raw);
  const c = document.createElement('canvas'); c.width = TEX; c.height = TEX;
  const g = c.getContext('2d');
  const W = TEX, H = LABEL_H, cx = W / 2;
  const r = rngOf(hashStr(L.brand + L.product));
  const [c0, c1 = c0, c2 = c1] = L.colours;
  const spectrum = L.colours.filter((h) => { const [R, G, B] = hexRgb(h); return R + G + B < 700; });
  if (!spectrum.length) spectrum.push(c0);

  // the body: its colour, with a grain so it isn't flat plastic
  g.fillStyle = L.body; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? '#fff' : '#000'; g.fillRect(r() * W, r() * H, 1, 6 + r() * 30); }
  g.globalAlpha = 1;

  // a band of the house colours round the top and the bottom
  const bandH = 12;
  spectrum.slice(0, 3).forEach((h, i) => {
    g.fillStyle = h;
    g.fillRect(0, 22 + i * bandH, W, bandH - 3);
    g.fillRect(0, H - 22 - (i + 1) * bandH, W, bandH - 3);
  });

  // the prism: a white beam in from the left, a triangle, and the colours fanning out of it all the way
  // round the back and in again from the other side
  const py = 470, px = cx - 175;
  const fanEnd = W + 110;
  spectrum.forEach((h, i) => {
    const k = spectrum.length;
    const y0 = py - 14 + (i * 28) / k, y1 = py - 14 + ((i + 1) * 28) / k;
    const e0 = py - 60 + (i * 260) / k, e1 = py - 60 + ((i + 1) * 260) / k;
    // it fades out round the back rather than stopping at an edge
    const [R, G, B] = hexRgb(h), fade = g.createLinearGradient(px + 40, 0, fanEnd, 0);
    fade.addColorStop(0, h); fade.addColorStop(0.62, h); fade.addColorStop(1, `rgba(${R},${G},${B},0)`);
    g.fillStyle = fade;
    g.beginPath(); g.moveTo(px + 40, y0); g.lineTo(fanEnd, e0); g.lineTo(fanEnd, e1); g.lineTo(px + 40, y1); g.closePath(); g.fill();
    // ...the part that ran past the right-hand edge comes in at the left
    g.save(); g.translate(-W, 0);
    g.beginPath(); g.moveTo(px + 40, y0); g.lineTo(fanEnd, e0); g.lineTo(fanEnd, e1); g.lineTo(px + 40, y1); g.closePath(); g.fill();
    g.restore();
  });
  g.strokeStyle = '#ffffff'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(px - 210, py + 40); g.lineTo(px + 6, py); g.stroke();
  g.fillStyle = L.body; g.lineWidth = 6;
  g.beginPath(); g.moveTo(px, py - 52); g.lineTo(px + 48, py + 34); g.lineTo(px - 48, py + 34); g.closePath(); g.fill(); g.stroke();

  // the brand, big and white on the front, with a drop in the first house colour
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = c1; fitText(g, L.brand, cx + 5, 305, 380, 118);
  g.fillStyle = '#ffffff'; fitText(g, L.brand, cx, 300, 380, 118);
  if (L.product) { g.fillStyle = c0; fitText(g, L.product, cx, 372, 300, 46, 800); }
  if (L.strap) { g.fillStyle = '#ffffff'; fitText(g, L.strap, cx, 650, 320, 30, 800); }
  if (L.net) { g.fillStyle = 'rgba(255,255,255,0.8)'; fitText(g, L.net, cx, 700, 160, 26, 700); }

  // the hazard diamond, on the side the hand covers least
  const dx = cx + 255, dy = 652, ds = 46;
  g.save(); g.translate(dx, dy); g.rotate(Math.PI / 4);
  g.fillStyle = '#ffffff'; g.fillRect(-ds, -ds, ds * 2, ds * 2);
  g.strokeStyle = '#d4202a'; g.lineWidth = 10; g.strokeRect(-ds + 6, -ds + 6, ds * 2 - 12, ds * 2 - 12);
  g.restore();
  g.fillStyle = '#111';
  g.beginPath(); g.moveTo(dx, dy - 34); g.bezierCurveTo(dx + 26, dy - 6, dx + 22, dy + 26, dx, dy + 30);
  g.bezierCurveTo(dx - 24, dy + 26, dx - 22, dy, dx - 6, dy - 12); g.bezierCurveTo(dx - 4, dy + 2, dx + 4, dy + 4, dx + 2, dy - 6);
  g.bezierCurveTo(dx + 8, dy - 18, dx + 4, dy - 26, dx, dy - 34); g.fill();
  g.fillRect(dx - 26, dy + 34, 52, 6);

  // the back: the fine print in a column, and a barcode
  if (L.fine) {
    g.textAlign = 'left'; g.fillStyle = 'rgba(235,235,230,0.85)'; g.font = `600 17px ${FACE}`;
    wrap(g, L.fine.toUpperCase(), 40, 130, 190, 21);
  }
  g.fillStyle = '#f4f2ec'; g.fillRect(W - 170, 150, 120, 150);
  g.fillStyle = '#111';
  for (let x = W - 160; x < W - 60; ) { const w = 1 + Math.floor(r() * 4); if (r() < 0.6) g.fillRect(x, 160, w, 110); x += w + 1 + Math.floor(r() * 2); }

  // wear: the print rubbed through to the tin, at the ends where hands and pockets catch it, and a few scuffs
  if (L.wear > 0) {
    const img = g.getImageData(0, 0, W, H), d = img.data;
    const bare = (x, y) => { const i = (y * W + x) * 4; d[i] = 176; d[i + 1] = 180; d[i + 2] = 184; d[i + 3] = 128; };
    const scratches = Math.round(260 * L.wear);
    for (let s = 0; s < scratches; s++) {
      const nearEnd = r() < 0.7;
      let y = nearEnd ? (r() < 0.5 ? 8 + r() * 70 : H - 8 - r() * 70) : 80 + r() * (H - 160);
      let x = r() * W;
      // keep the brand legible: fewer scuffs across its middle
      if (!nearEnd && Math.abs(x - cx) < 210 && y < 400 && r() < 0.8) continue;
      const len = 6 + r() * (nearEnd ? 50 : 26), ang = (r() - 0.5) * 0.7;
      for (let t = 0; t < len; t++) {
        const xx = Math.floor(x + Math.cos(ang) * t) % W, yy = Math.floor(y + Math.sin(ang) * t);
        if (yy < 0 || yy >= H) continue;
        bare((xx + W) % W, yy);
        if (r() < 0.35 && yy + 1 < H) bare((xx + W) % W, yy + 1);
      }
    }
    g.putImageData(img, 0, 0);
  }

  // the collar: the colour cells you click through, twice round, chrome between them
  g.fillStyle = '#9da2a8'; g.fillRect(0, COLLAR_Y, W, COLLAR_H);
  const cells = [...L.colours, '#141414'];
  const n = cells.length * 2, cw = W / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = cells[i % cells.length];
    g.fillRect(i * cw + 5, COLLAR_Y + 12, cw - 10, COLLAR_H - 24);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(i * cw + cw / 2 - 1, COLLAR_Y, 2, 9);
  }

  // the actuator: the cap colour, and the nozzle on the front
  g.fillStyle = L.cap; g.fillRect(0, CAP_Y, W, CAP_H + 24);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, CAP_Y + CAP_H - 18, W, 6);
  g.fillStyle = '#2a2a2a'; g.beginPath(); g.ellipse(cx, CAP_Y + 42, 30, 22, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#050505'; g.beginPath(); g.ellipse(cx, CAP_Y + 42, 9, 7, 0, 0, Math.PI * 2); g.fill();
  return c;
}

// ── the shape ────────────────────────────────────────────────────────────────────────────────────

// Each part is a profile [r, y] turned round the y axis. `v(y)` places it on the atlas.
const quarter = (r0, r1, y0, y1, n) => Array.from({ length: n + 1 }, (_, i) => { const t = (i / n) * Math.PI / 2; return [r1 + (r0 - r1) * Math.cos(t), y0 + (y1 - y0) * Math.sin(t)]; });
const PARTS = [
  { m: M.METAL, prof: [[0, 0.17], [0.42, 0.12], [0.78, 0.05], [0.94, 0.0], [0.99, 0.03], [1.0, BODY_Y0]] },
  { m: M.LABEL, body: true, prof: Array.from({ length: 49 }, (_, i) => [1, BODY_Y0 + ((BODY_Y1 - BODY_Y0) * i) / 48]) },
  { m: M.PAINT, prof: quarter(1, 0.62, BODY_Y1, 5.62, 10) },
  { m: M.METAL, prof: [[0.62, 5.62], [0.69, 5.65], [0.7, 5.72], [0.64, 5.78], [0.52, 5.79]] },
  { m: M.COLLAR, prof: [[0.52, 5.79], [0.58, 5.82], [0.58, 6.0], [0.52, 6.05], [0.34, 6.06]] },
  { m: M.CAP, prof: [[0.3, 6.06], [0.3, 6.4], [0.27, 6.46], [0.15, 6.49], [0, 6.5]] },
];
const NOZZLE = [0, 6.24, 0.3];        // on the actuator's front, where the paint comes out
export const CAN_TOP = 6.5;

function dentAt(u, y) {
  let k = 1;
  for (const d of DENTS) {
    let du = Math.abs(u - d.u); du = Math.min(du, 1 - du) * Math.PI * 2;
    k -= d.depth * Math.exp(-(du * du + (y - d.y) * (y - d.y)) / (d.rad * d.rad));
  }
  return k;
}

function buildMesh() {
  const P = [], N = [], UV = [], MAT = [], I = [];
  for (const part of PARTS) {
    const prof = part.prof, rings = prof.length, base = P.length / 3;
    const grid = [];
    for (let j = 0; j < rings; j++) {
      const [r0, y] = prof[j];
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG, a = (u - 0.5) * Math.PI * 2;
        const r = part.body ? r0 * dentAt(u, y) : r0;
        grid.push([Math.sin(a) * r, y, Math.cos(a) * r]);
      }
    }
    for (let j = 0; j < rings; j++) {
      const [r0, y] = prof[j];
      const pa = prof[Math.max(0, j - 1)], pb = prof[Math.min(rings - 1, j + 1)];
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG, a = (u - 0.5) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
        const p = grid[j * (SEG + 1) + i];
        let n;
        if (part.body) {
          // the dents bend the normal, so take it off the surface itself
          const im = grid[j * (SEG + 1) + ((i - 1 + SEG) % SEG)], ip = grid[j * (SEG + 1) + ((i + 1) % SEG)];
          const jm = grid[Math.max(0, j - 1) * (SEG + 1) + i], jp = grid[Math.min(rings - 1, j + 1) * (SEG + 1) + i];
          const du = [ip[0] - im[0], ip[1] - im[1], ip[2] - im[2]], dv = [jp[0] - jm[0], jp[1] - jm[1], jp[2] - jm[2]];
          n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
        } else {
          // the profile's own normal, turned round: (dy, -dr) in the (r, y) plane
          const dr = pb[0] - pa[0], dy = pb[1] - pa[1];
          n = [dy * s, -dr, dy * c];
        }
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        P.push(p[0], p[1], p[2]); N.push(n[0] / l, n[1] / l, n[2] / l); MAT.push(part.m);
        let v;
        if (part.m === M.LABEL) v = ((BODY_Y1 - y) / (BODY_Y1 - BODY_Y0)) * (LABEL_H - 1) / TEX;
        else if (part.m === M.COLLAR) v = (COLLAR_Y + COLLAR_H / 2) / TEX;
        else if (part.m === M.CAP) v = (CAP_Y + Math.max(0, Math.min(CAP_H + 20, ((6.4 - y) / 0.34) * CAP_H * 0.9 + 4))) / TEX;
        else v = 0;
        UV.push(u, v);
      }
    }
    for (let j = 0; j < rings - 1; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = base + j * (SEG + 1) + i, b = a + SEG + 1;
        I.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  return { P: new Float32Array(P), N: new Float32Array(N), UV: new Float32Array(UV), MAT: new Float32Array(MAT), I: new Uint16Array(I) };
}

// ── the view ─────────────────────────────────────────────────────────────────────────────────────

const VS = `
attribute vec3 aP; attribute vec3 aN; attribute vec2 aUV; attribute float aM;
uniform mat4 uModel, uView, uProj; uniform float uInflate;
varying vec3 vN, vW; varying vec2 vUV; varying float vM;
void main() {
  vec4 w = uModel * vec4(aP + aN * uInflate, 1.0);
  vW = w.xyz; vN = mat3(uModel) * aN; vUV = aUV; vM = aM;
  gl_Position = uProj * uView * w;
}`;
const FS = `
precision mediump float;
uniform sampler2D uTex; uniform vec3 uEye, uKey, uPaint, uInk, uShade; uniform float uOutline, uBands;
varying vec3 vN, vW; varying vec2 vUV; varying float vM;
vec3 studio(vec3 r) {
  // a softbox overhead and a strip to the left, a dark floor: what chrome shows
  float sky = smoothstep(-0.2, 0.6, r.y);
  float strip = smoothstep(0.55, 0.8, -r.x) * (1.0 - abs(r.y));
  return mix(vec3(0.1, 0.1, 0.12), vec3(0.95), sky) + vec3(0.9) * strip;
}
float band(float x) { return uBands > 0.5 ? (x > 0.45 ? 1.0 : 0.35) : x; }
void main() {
  if (uOutline > 0.5) { gl_FragColor = vec4(uInk, 1.0); return; }
  vec3 n = normalize(vN), v = normalize(uEye - vW), l = normalize(uKey), h = normalize(l + v);
  vec3 base; float metal = 0.0, gloss = 0.35, shin = 48.0;
  if (vM < 0.5) { vec4 t = texture2D(uTex, vUV); base = t.rgb; metal = t.a < 0.75 ? 1.0 : 0.0; }
  else if (vM < 1.5) { base = vec3(0.8, 0.82, 0.85); metal = 1.0; }
  else if (vM < 3.5) { base = texture2D(uTex, vUV).rgb; gloss = 0.2; shin = 24.0; }
  else { base = uPaint; }
  float d = band(max(dot(n, l), 0.0));
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 lit;
  if (metal > 0.5) {
    vec3 env = studio(reflect(-v, n));
    if (uBands > 0.5) env = mix(vec3(0.25), vec3(1.0), step(0.55, dot(env, vec3(0.333))));
    lit = base * env * (0.55 + 0.45 * d);
  } else {
    vec3 shade = uBands > 0.5 ? uShade : vec3(0.42);
    lit = base * mix(shade, vec3(1.0), d) + base * 0.08;
  }
  float s = pow(max(dot(n, h), 0.0), shin) * (metal > 0.5 ? 0.9 : gloss);
  if (uBands > 0.5) s = step(0.5, s) * 0.8;
  lit += vec3(s) + vec3(0.18) * rim * (1.0 - metal);
  gl_FragColor = vec4(lit, 1.0);
}`;

function m4persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; }
function m4mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
const m4t = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const m4rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const m4ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const m4rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
const m4x = (m, p) => [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * (p[3] ?? 1));

/**
 * A can drawn into `canvas`. `render(pose)` draws it: `yaw` turns it (0 shows the front), `roll`
 * tips it sideways, `pitch` leans the top away, `lift` moves it up in can radii. It returns where the
 * nozzle landed, in CSS pixels of the canvas, so a caller can put the nozzle under a pointer.
 */
export function createCanView(canvas, rawLabel) {
  let gl = null;
  try { gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false }); } catch { gl = null; }
  if (!gl) return { ok: false, render: () => null, dispose() {} };

  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[spray-can-3d]', gl.getProgramInfoLog(prog)); return { ok: false, render: () => null, dispose() {} }; }
  gl.useProgram(prog);

  const mesh = buildMesh();
  const buf = (data, name, size) => {
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  buf(mesh.P, 'aP', 3); buf(mesh.N, 'aN', 3); buf(mesh.UV, 'aUV', 2); buf(mesh.MAT, 'aM', 1);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.I, gl.STATIC_DRAW);

  const L = labelOf(rawLabel);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paintCanAtlas(L));
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);

  const U = {};
  for (const n of ['uModel', 'uView', 'uProj', 'uInflate', 'uTex', 'uEye', 'uKey', 'uPaint', 'uInk', 'uShade', 'uOutline', 'uBands']) U[n] = gl.getUniformLocation(prog, n);
  const paint = hexRgb(L.body).map((x) => x / 255);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);

  const EYE = [0, 3.3, 17];
  const view = m4t(-EYE[0], -EYE[1], -EYE[2]);

  function render({ yaw = 0, roll = 0, pitch = 0, lift = 0, side = 0 } = {}) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // fit the can's height to the canvas, whatever its shape
    const asp = w / h, fov = 0.42 * Math.max(1, 0.62 / asp);
    const proj = m4persp(fov, asp, 1, 60);
    // about the can's middle: tip it, then turn it, then move it
    const model = m4mul(m4t(side, 3.25 + lift, 0), m4mul(m4rz(roll), m4mul(m4rx(pitch), m4mul(m4ry(yaw), m4t(0, -3.25, 0)))));
    gl.uniformMatrix4fv(U.uModel, false, model);
    gl.uniformMatrix4fv(U.uView, false, view);
    gl.uniformMatrix4fv(U.uProj, false, proj);
    gl.uniform1i(U.uTex, 0);
    gl.uniform3fv(U.uEye, EYE);
    gl.uniform3fv(U.uKey, [-0.55, 0.75, 0.6]);
    gl.uniform3fv(U.uPaint, paint);
    const comic = comicOn();
    gl.uniform3fv(U.uInk, HOUSE.ink);
    gl.uniform3fv(U.uShade, HOUSE.shade);
    gl.uniform1f(U.uBands, comic ? 1 : 0);
    // the house ink: the back faces, pushed out along their normals, in the ink
    if (comic) {
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
      gl.uniform1f(U.uOutline, 1); gl.uniform1f(U.uInflate, 0.045);
      gl.drawElements(gl.TRIANGLES, mesh.I.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.uniform1f(U.uOutline, 0); gl.uniform1f(U.uInflate, 0);
    gl.drawElements(gl.TRIANGLES, mesh.I.length, gl.UNSIGNED_SHORT, 0);
    // where the nozzle went
    const clip = m4x(m4mul(proj, m4mul(view, model)), [...NOZZLE, 1]);
    return [((clip[0] / clip[3]) * 0.5 + 0.5) * cw, (0.5 - (clip[1] / clip[3]) * 0.5) * ch];
  }

  function dispose() {
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* gone already */ }
  }
  return { ok: true, render, dispose, label: L };
}
