// ROOM · A ROOM'S MARKS. Everything a room has painted, stuck, hung or spilled on its walls and floor that isn't a
// piece of furniture: wayfinding, warning labels, hazard placards, servicing tags, LED readouts, stencils, a scrawl,
// a corporate poster, a stain. A room authors them as `flags.room.decor.marks` (the decor block reaches the spec
// whole); each is painted on a canvas in a face from the house library (docs/reference/fonts.md) and laid on the
// room as a decal (gl/room.js setDecals), by room-stadium.js beside the room's signs.
//
//   { kind, wall: 'front'|'back'|'left'|'right', at, y }   on a wall: `at` metres along it, `y` the mark's middle
//   { kind, floor: [u, v], turn }                           flat on the floor, `turn` degrees
//   w, h          the mark's size in metres
//   text, sub     the words; '|' breaks a line
//   font, tint    a face from FONTS, a colour ('#rrggbb'); each kind has its own default for both
//   arrow         a wayfinding sign's arrow: 'left', 'right', 'up', 'down'
//   lit           a readout or a lightbox is light, not paint (default true)
//   img           a poster's photograph, a path under client/game/assets (an advert with somebody on it)
//
// kinds: marquee (a name in light on the wall in a deco face, no board), wayfinding, label, placard, tag, readout, stencil, scrawl, poster, stain, logo (a company's mark: an emblem,
// its name set wide, `sub` a line under a rule, `tint` and `accent` the emblem's two colours), and the sign painter's own
// (lightbox, gilt, enamel, neon), which take the room's stadium style with this mark's font.
//
// ⚠ NOTHING HERE NAMES A PLACE. The words and colours are the room's content; this only paints them.
import { paintSign, styleOf } from './stadium-signs.js';
import { facing } from '../../../shared/room-layout.js';

export const MARK_FONTS = {
  Michroma: 'michroma.woff2', Geist: 'geist.woff2', 'Geist Mono': 'geist-mono.woff2', 'Stardos Stencil': 'stardos-stencil.woff2',
  'Allerta Stencil': 'allerta-stencil.woff2', 'Special Elite': 'special-elite.woff2', Doto: 'doto.woff2', 'Digit Tech 14': 'digit-tech-14.woff2',
  VT323: 'vt323.woff2', 'Rock Salt': 'rock-salt.woff2', 'Rainbow 2000': 'rainbow-2000.woff2', Overpass: 'overpass.woff2', Staatliches: 'staatliches.woff2',
  'Big Shoulders Stencil Display': 'big-shoulders-stencil-display.woff2', 'Share Tech Mono': 'share-tech-mono.woff2', Tektur: 'tektur.woff2',
  Oxanium: 'oxanium.woff2', 'Rubik Glitch': 'rubik-glitch.woff2', Splash: 'splash.woff2', 'Courier Prime': 'courier-prime.woff2',
  // the deco faces (docs/reference/fonts.md "Art deco"), for a marquee
  Limelight: 'limelight.woff2', 'Poiret One': 'poiret-one.woff2', Monoton: 'monoton.woff2', 'Fascinate Inline': 'fascinate-inline.woff2', Federo: 'federo.woff2',
};
const DEFAULT_FONT = { marquee: 'Limelight', logo: 'Michroma', wayfinding: 'Michroma', label: 'Geist', placard: 'Overpass', tag: 'Special Elite', readout: 'Doto', stencil: 'Stardos Stencil', scrawl: 'Rock Salt', poster: 'Staatliches' };
const SUB_FONT = { marquee: 'Poiret One', logo: 'Geist', wayfinding: 'Geist', label: 'Geist', placard: 'Geist Mono', poster: 'Geist', readout: 'Share Tech Mono' };
const KINDS = new Set(['marquee', 'logo', 'wayfinding', 'label', 'placard', 'tag', 'readout', 'stencil', 'scrawl', 'poster', 'stain', 'lightbox', 'gilt', 'enamel', 'neon']);

const loaded = new Map();
// a poster's photograph (`img`, a path under client/game/assets), loaded before the marks are painted
const photos = new Map();
function loadPhoto(path) {
  if (!path || typeof Image === 'undefined' || !/^[\w/.-]+\.(webp|png|jpg)$/.test(path) || path.includes('..')) return Promise.resolve(false);
  if (photos.has(path)) return Promise.resolve(true);
  return new Promise((ok) => { const im = new Image(); im.onload = () => { photos.set(path, im); ok(true); }; im.onerror = () => ok(false); im.src = new URL(`../../assets/${path}`, import.meta.url).href; });
}
export function loadFont(name) {
  if (!MARK_FONTS[name] || typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  if (!loaded.has(name)) {
    loaded.set(name, new FontFace(name, `url(${new URL(`../../../shared/fonts/${MARK_FONTS[name]}`, import.meta.url).href})`).load()
      .then((f) => { document.fonts.add(f); return true; }).catch(() => false));
  }
  return loaded.get(name);
}
const fontOf = (m) => (MARK_FONTS[m.font] ? m.font : DEFAULT_FONT[m.kind] || 'Geist');
const subOf = (m) => (MARK_FONTS[m.sub_font] ? m.sub_font : SUB_FONT[m.kind] || fontOf(m));
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
const STACK = (n) => `"${n}", Geist, Arial, sans-serif`;
const lines = (t) => String(t || '').split('|').map((s) => s.trim()).filter(Boolean);
// the kinds set in capitals, whatever case the room wrote them in (`case: 'none'` keeps the room's)
const UPPER = new Set(['stencil', 'wayfinding', 'label', 'placard', 'readout']);

// a seeded random, so a mark looks the same every time it's painted
function rnd(seed) { let s = Math.abs(Math.floor(seed)) % 2147483646 + 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const seedOf = (m) => { let h = 7; for (const c of JSON.stringify([m.text, m.sub, m.kind, m.at, m.floor, m.y])) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };

// sets `t` as large as fits in (bw, bh), centred on (cx, cy) unless `align` says otherwise
function fit(g, t, face, bw, bh, cx, cy, fill, o = {}) {
  if (!t) return 0;
  let px = bh;
  const set = (sz) => { g.font = `${o.weight || 400} ${sz}px ${STACK(face)}`; };
  set(px);
  let wd = g.measureText(t).width * (1 + (o.track || 0));
  if (wd > bw) { px *= bw / wd; set(px); wd = g.measureText(t).width * (1 + (o.track || 0)); }
  const m = g.measureText(t), asc = m.actualBoundingBoxAscent || px * 0.72, desc = m.actualBoundingBoxDescent || 0, base = cy + (asc - desc) / 2;
  g.textAlign = o.align || 'center';
  if (o.glow) { g.save(); g.shadowColor = o.glow; g.shadowBlur = px * 0.4; g.fillStyle = fill; g.fillText(t, cx, base); g.restore(); }
  if (o.shadow) { g.fillStyle = o.shadow; g.fillText(t, cx + px * 0.03, base + px * 0.04); }
  g.fillStyle = fill; g.fillText(t, cx, base);
  return px;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// scuffs, chips and grime over a printed or painted face
function weather(g, cw, ch, k, R) {
  g.save();
  for (let i = 0; i < 60; i++) { g.globalAlpha = k * R(); g.fillStyle = R() < 0.6 ? '#2a2620' : '#ffffff'; g.fillRect(R() * cw, R() * ch, 1 + R() * cw * 0.03, 1 + R() * 3); }
  const gr = g.createLinearGradient(0, ch * 0.6, 0, ch); gr.addColorStop(0, 'rgba(40,34,24,0)'); gr.addColorStop(1, `rgba(40,34,24,${0.25 * k * 3})`);
  g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
  g.restore();
}

const cache = new Map();
/** A mark's canvas, cached by what makes it. */
// `part` splits a lit mark in two: 'panel' the painted board it's on, 'light' its lit words alone (a lit decal is
// added to the room, so a dark board drawn with it would add nothing and the words would float on the wall)
export function paintMark(m, style = null, part = null) {
  const key = JSON.stringify([m, part]);
  if (cache.has(key)) return cache.get(key);
  const w = Math.max(0.05, +m.w || 0.6), h = Math.max(0.05, +m.h || 0.3), PX = 380;
  const cw = Math.max(48, Math.min(2048, Math.round(w * PX))), ch = Math.max(48, Math.min(2048, Math.round(h * PX)));
  if (['lightbox', 'gilt', 'enamel', 'neon'].includes(m.kind)) {
    const st = { ...styleOf(style ? { stadium: style } : null), ...(m.font ? { font: m.font, sub: m.sub_font || m.font } : {}) };
    const c = paintSign({ kind: m.kind, text: m.text || '', sub: m.sub || '', w, h, style: st, lit: m.lit !== false, tint: hex(m.tint, null) });
    cache.set(key, c);
    return c;
  }
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const up = (t) => (UPPER.has(m.kind) && m.case !== 'none' ? t.toUpperCase() : t);
  const g = c.getContext('2d'), R = rnd(seedOf(m)), F = fontOf(m), SF = subOf(m), L = lines(m.text).map(up), S = lines(m.sub).map((t) => (m.kind === 'readout' || m.kind === 'stencil' ? up(t) : t));
  if (m.kind === 'marquee') {
    // A NAME IN LIGHT, straight on the wall with no board behind it: the name in a deco face with a wide halo and a
    // tight one under a pale core, a fan of faint rays behind it, a stepped rule over it, and `sub` between two
    // double rules ending in diamonds. `tint` is the light's colour, `core` the letters' own; `rays: false` for none.
    const col = hex(m.tint, '#ffb35c'), core = hex(m.core, '#fff1d2'), on = m.lit !== false, dim = on ? col : '#5a4630';
    const two = S.length > 0, nameH = ch * (two ? 0.52 : 0.72), cy = ch * (two ? 0.4 : 0.5), T = L.join(' ');
    if (m.rays !== false) {
      g.save(); g.globalAlpha = on ? 0.16 : 0.06; g.strokeStyle = col; g.lineWidth = Math.max(1, ch * 0.005);
      const ox = cw / 2, oy = cy + nameH * 0.42, n = 19;
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (0.06 + 0.88 * i / (n - 1)), r0 = nameH * 0.75;
        g.beginPath(); g.moveTo(ox - Math.cos(a) * r0 * 1.6, oy - Math.sin(a) * r0); g.lineTo(ox - Math.cos(a) * cw * 0.55, oy - Math.sin(a) * ch); g.stroke();
      }
      g.restore();
    }
    if (on) for (const [blur, a] of [[0.55, 0.5], [0.25, 0.75], [0.08, 0.9]]) { g.save(); g.shadowColor = col; g.shadowBlur = nameH * blur; g.globalAlpha = a; fit(g, T, F, cw * 0.86, nameH, cw / 2, cy, col); g.restore(); }
    const px = fit(g, T, F, cw * 0.86, nameH, cw / 2, cy, on ? core : '#7a6040');
    const tw = g.measureText(T).width, lw = Math.max(1, ch * 0.008);
    // the stepped rule over the name, three bars, each shorter
    g.save(); if (on) { g.shadowColor = col; g.shadowBlur = ch * 0.03; }
    g.fillStyle = dim;
    for (let i = 0; i < 3; i++) { const half = tw * (0.36 - i * 0.1), y = cy - px * 0.62 - i * lw * 2.6; g.fillRect(cw / 2 - half, y, half * 2, lw); }
    if (two) {
      const sy = ch * 0.8, sub = S.join('  ');
      fit(g, sub, SF, cw * 0.5, ch * 0.14, cw / 2, sy, on ? core : '#6a5030', on ? { glow: col } : {});
      const sw = g.measureText(sub).width, gap = ch * 0.05, x0 = cw / 2 - tw / 2, x1 = cw / 2 - sw / 2 - gap;
      const diamond = (x, y, r) => { g.beginPath(); g.moveTo(x - r, y); g.lineTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.closePath(); g.fill(); };
      for (const s of [-1, 1]) {
        const a = cw / 2 + s * (cw / 2 - x0), b = cw / 2 + s * (cw / 2 - x1);
        for (const dy of [-lw * 1.6, lw * 1.6]) g.fillRect(Math.min(a, b), sy + dy - lw / 2, Math.abs(b - a), lw);
        diamond(a, sy, lw * 3.2);
      }
    }
    g.restore();
  } else if (m.kind === 'wayfinding') {
    // a charcoal panel with a band of colour down its leading edge, the words in white, an arrow if it points
    const band = hex(m.tint, '#3fd27a');
    g.fillStyle = '#16191c'; roundRect(g, 0, 0, cw, ch, ch * 0.06); g.fill();
    g.fillStyle = band; g.fillRect(0, 0, ch * 0.12, ch);
    const ax = m.arrow ? ch * 0.9 : 0, x0 = ch * 0.26, bw = cw - x0 - ax - ch * 0.12;
    const rows = L.length || 1, bh = ch * (S.length ? 0.5 : 0.62) / rows;
    L.forEach((t, i) => fit(g, t, F, bw, bh * 0.82, x0, ch * (S.length ? 0.14 : 0.2) + bh * (i + 0.5), '#f4f6f2', { align: 'left' }));
    S.forEach((t, i) => fit(g, t, SF, bw, ch * 0.13, x0, ch * 0.7 + ch * 0.15 * i, '#9aa4a8', { align: 'left' }));
    if (m.arrow) {
      g.save(); g.translate(cw - ax / 2 - ch * 0.08, ch / 2); g.rotate({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[m.arrow] || 0);
      g.fillStyle = band; g.beginPath(); const a = ch * 0.26;
      g.moveTo(a, 0); g.lineTo(-a * 0.2, -a * 0.9); g.lineTo(-a * 0.2, -a * 0.38); g.lineTo(-a, -a * 0.38); g.lineTo(-a, a * 0.38); g.lineTo(-a * 0.2, a * 0.38); g.lineTo(-a * 0.2, a * 0.9); g.closePath(); g.fill();
      g.restore();
    }
    weather(g, cw, ch, 0.08, R);
  } else if (m.kind === 'label') {
    // a printed vinyl warning label: the colour, a black rule round it, a triangle with its mark, the words
    const bg = hex(m.tint, '#f2c230');
    g.fillStyle = bg; roundRect(g, 0, 0, cw, ch, ch * 0.05); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = ch * 0.045; roundRect(g, ch * 0.06, ch * 0.06, cw - ch * 0.12, ch - ch * 0.12, ch * 0.03); g.stroke();
    const tx = ch * 0.5, ts = ch * 0.34;
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(tx, ch * 0.5 - ts); g.lineTo(tx + ts * 1.05, ch * 0.5 + ts * 0.8); g.lineTo(tx - ts * 1.05, ch * 0.5 + ts * 0.8); g.closePath(); g.fill();
    g.fillStyle = bg; fit(g, m.glyph || '!', 'Geist', ts, ts * 1.0, tx, ch * 0.56, bg, { weight: 800 });
    const x0 = ch * 1.0, bw = cw - x0 - ch * 0.14, rows = L.length || 1, bh = ch * (S.length ? 0.42 : 0.6) / rows;
    L.forEach((t, i) => fit(g, t, F, bw, bh * 0.85, x0, ch * 0.16 + bh * (i + 0.5), '#111', { align: 'left', weight: 800 }));
    S.forEach((t, i) => fit(g, t, SF, bw, ch * 0.12, x0, ch * 0.66 + ch * 0.13 * i, '#111', { align: 'left' }));
    weather(g, cw, ch, 0.12, R);
  } else if (m.kind === 'placard') {
    // a hazard diamond: a white face, its upper half in the colour, a number or word in the middle, a line under
    const col = hex(m.tint, '#c8262a'), s = Math.min(cw, ch);
    g.clearRect(0, 0, cw, ch); g.save(); g.translate(cw / 2, ch / 2); g.rotate(Math.PI / 4);
    const a = s * 0.68;
    g.fillStyle = '#f5f3ee'; g.fillRect(-a / 2, -a / 2, a, a);
    g.save(); g.beginPath(); g.rect(-a / 2, -a / 2, a, a); g.clip(); g.rotate(-Math.PI / 4); g.fillStyle = col; g.fillRect(-a, -a, a * 2, a * 0.98); g.restore();
    g.strokeStyle = '#111'; g.lineWidth = s * 0.02; g.strokeRect(-a / 2 + s * 0.03, -a / 2 + s * 0.03, a - s * 0.06, a - s * 0.06);
    g.restore();
    fit(g, L[0] || '', F, s * 0.5, s * 0.2, cw / 2, ch * 0.46, '#111', { weight: 800 });
    if (S[0]) fit(g, S[0], SF, s * 0.44, s * 0.07, cw / 2, ch * 0.66, '#111');
  } else if (m.kind === 'tag') {
    // a manila servicing tag: a punched hole with a reinforcing ring, ruled lines, typed words, a signature scrawl
    const pad = ch * 0.04;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = hex(m.tint, '#d9c7a0'); g.beginPath(); g.moveTo(pad + ch * 0.18, pad); g.lineTo(cw - pad, pad); g.lineTo(cw - pad, ch - pad); g.lineTo(pad + ch * 0.18, ch - pad); g.lineTo(pad, ch - pad - ch * 0.18); g.lineTo(pad, pad + ch * 0.18); g.closePath(); g.fill();
    g.fillStyle = '#c4b083'; g.beginPath(); g.arc(pad + ch * 0.2, ch / 2, ch * 0.1, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a2620'; g.beginPath(); g.arc(pad + ch * 0.2, ch / 2, ch * 0.05, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(80,90,140,0.35)'; g.lineWidth = 1;
    const rows = Math.max(3, L.length + S.length), rh = (ch - pad * 4) / rows, x0 = pad + ch * 0.38;
    for (let i = 1; i <= rows; i++) { g.beginPath(); g.moveTo(x0, pad * 2 + rh * i); g.lineTo(cw - pad * 2, pad * 2 + rh * i); g.stroke(); }
    [...L.map((t) => t.toUpperCase()), ...S].forEach((t, i) => fit(g, t, i < L.length ? F : 'Rock Salt', cw - x0 - pad * 3, rh * 0.7, x0, pad * 2 + rh * (i + 0.5), i < L.length ? '#1d1a16' : '#24306a', { align: 'left' }));
    weather(g, cw, ch, 0.18, R);
  } else if (m.kind === 'readout') {
    // a dark panel of LED text with its glow; a dim grid of unlit cells behind
    const col = hex(m.tint, '#5affc8'), on = m.lit !== false;
    if (part !== 'light') {
      g.fillStyle = '#05080a'; roundRect(g, 0, 0, cw, ch, ch * 0.04); g.fill();
      g.strokeStyle = '#2a3034'; g.lineWidth = ch * 0.02; roundRect(g, ch * 0.01, ch * 0.01, cw - ch * 0.02, ch - ch * 0.02, ch * 0.04); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.035)';
      for (let x = ch * 0.05; x < cw; x += ch * 0.045) for (let y = ch * 0.05; y < ch; y += ch * 0.045) g.fillRect(x, y, ch * 0.02, ch * 0.02);
      if (part === 'panel' && on) { cache.set(key, c); return c; }
    } else g.clearRect(0, 0, cw, ch);
    const all = [...L, ...S], rh = (ch * 0.86) / Math.max(1, all.length);
    all.forEach((t, i) => fit(g, t, i < L.length ? F : SF, cw * 0.9, rh * 0.78, cw * 0.05, ch * 0.07 + rh * (i + 0.5), on ? col : '#1a2a24', { align: 'left', ...(on ? { glow: col } : {}) }));
  } else if (m.kind === 'stencil') {
    // sprayed through a stencil: clear behind, overspray, a drip or two
    const col = hex(m.tint, '#e8e2d0');
    g.clearRect(0, 0, cw, ch);
    const rows = L.length + S.length || 1, rh = ch / rows;
    g.save(); g.shadowColor = col; g.shadowBlur = ch * 0.03;
    let px = 0;
    L.forEach((t, i) => { px = fit(g, t, F, cw * 0.94, rh * 0.8, cw / 2, rh * (i + 0.5), col); });
    S.forEach((t, i) => fit(g, t, F, cw * 0.9, rh * 0.5, cw / 2, rh * (L.length + i + 0.5), col));
    g.restore();
    g.fillStyle = col;
    if (!m.floor) for (let i = 0; i < 5; i++) g.fillRect(cw * (0.1 + R() * 0.8), rh * 0.75, Math.max(2, px * 0.03), px * (0.2 + R() * 0.7));
    weather(g, cw, ch, 0.15, R);
  } else if (m.kind === 'scrawl') {
    // written by hand in marker, a little off level
    const col = hex(m.tint, '#1a1a22');
    g.clearRect(0, 0, cw, ch); g.save(); g.translate(cw / 2, ch / 2); g.rotate((R() - 0.5) * 0.12);
    const all = [...L, ...S], rh = ch / Math.max(1, all.length);
    all.forEach((t, i) => fit(g, t, F, cw * 0.92, rh * 0.75, 0, -ch / 2 + rh * (i + 0.5), col));
    g.restore();
  } else if (m.kind === 'poster' && photos.get(m.img)) {
    // an advert with a photograph on it: the picture over the top two thirds, fading into the field of colour, the
    // title set across the fade, the copy and the small print under it
    const col = hex(m.tint, '#1d3a5c'), img = photos.get(m.img), ph = ch * 0.7;
    g.fillStyle = col; g.fillRect(0, 0, cw, ch);
    const s = Math.max(cw / img.width, ph / img.height), iw = img.width * s, ih = img.height * s;
    // anchored at the top, so the face is on the poster and the legs go under the fade
    g.drawImage(img, (cw - iw) / 2, 0, iw, ih);
    const fade = g.createLinearGradient(0, ph * 0.55, 0, ph); fade.addColorStop(0, col + '00'); fade.addColorStop(1, col);
    g.fillStyle = fade; g.fillRect(0, ph * 0.55, cw, ph * 0.45 + 1);
    const acc = hex(m.accent, '#f2c230');
    g.fillStyle = acc; g.fillRect(0, 0, cw, ch * 0.018); g.fillRect(0, ch * 0.982, cw, ch * 0.018);
    L.forEach((t, i) => fit(g, t, F, cw * 0.9, ch * 0.11, cw / 2, ch * 0.66 + ch * 0.1 * i, i ? '#ffffff' : acc, { glow: 'rgba(0,0,0,0.8)' }));
    S.forEach((t, i) => fit(g, t, SF, cw * 0.84, ch * 0.04, cw / 2, ch * (0.69 + 0.1 * L.length) + ch * 0.05 * i, 'rgba(255,255,255,0.88)'));
    if (m.small) fit(g, m.small, 'Geist Mono', cw * 0.84, ch * 0.025, cw / 2, ch * 0.95, 'rgba(255,255,255,0.6)');
    weather(g, cw, ch, 0.25, R);
  } else if (m.kind === 'poster') {
    // a corporate poster: a field of colour, a band, the title large, the copy under it, the small print at the foot
    const col = hex(m.tint, '#1d3a5c');
    g.fillStyle = col; g.fillRect(0, 0, cw, ch);
    const gr = g.createLinearGradient(0, 0, cw, ch); gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(cw * 0.08, ch * 0.08, cw * 0.84, ch * 0.012);
    g.beginPath(); g.arc(cw * 0.5, ch * 0.3, Math.min(cw, ch) * 0.13, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = ch * 0.012; g.stroke();
    g.beginPath(); g.arc(cw * 0.5, ch * 0.3, Math.min(cw, ch) * 0.06, 0, Math.PI * 2); g.fillStyle = hex(m.accent, '#f2c230'); g.fill();
    L.forEach((t, i) => fit(g, t, F, cw * 0.84, ch * 0.1, cw / 2, ch * 0.54 + ch * 0.11 * i, '#ffffff'));
    S.forEach((t, i) => fit(g, t, SF, cw * 0.8, ch * 0.045, cw / 2, ch * (0.56 + 0.11 * L.length) + ch * 0.06 * i, 'rgba(255,255,255,0.82)'));
    if (m.small) fit(g, m.small, 'Geist Mono', cw * 0.84, ch * 0.025, cw / 2, ch * 0.93, 'rgba(255,255,255,0.6)');
    weather(g, cw, ch, 0.2, R);
  } else if (m.kind === 'logo') {
    // A company's sign, lit from inside. A backplate of lacquered carbon fibre (a 2/2 twill, a sheen across its top)
    // in a bevelled dark-metal rim, a light line round the inside of the rim and brackets at its corners; the emblem
    // (two faces in profile, one the other's mirror, meeting in an M, cut out of a rounded hexagon in a gradient of
    // the two colours, an outline round it and a halo); the name set wide in the mark's face, its number (the
    // second line) in its own face (`num_font`) in an outlined tab, a ® after; a rule that starts at a diamond and
    // fades out; and the line under it in spaced capitals. `tint` and `accent` are the two colours.
    const c1 = hex(m.tint, '#2fd8ff'), c2 = hex(m.accent, '#9ff4ff'), NF = MARK_FONTS[m.num_font] ? m.num_font : F, rr = ch * 0.07;
    g.save(); roundRect(g, 0, 0, cw, ch, rr); g.clip();
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, cw, ch);
    const cell = Math.max(3, Math.round(ch * 0.022));
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 0, i = 0; y < ch; y += cell, i++) for (let x = 0, j = 0; x < cw; x += cell, j++) if (((i + j) & 3) < 2) g.fillRect(x, y, cell, cell);
    const sh = g.createLinearGradient(0, 0, 0, ch); sh.addColorStop(0, 'rgba(255,255,255,0.11)'); sh.addColorStop(0.32, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = sh; g.fillRect(0, 0, cw, ch);
    g.restore();
    g.lineWidth = ch * 0.035; g.strokeStyle = '#3a3f46'; roundRect(g, ch * 0.0175, ch * 0.0175, cw - ch * 0.035, ch - ch * 0.035, rr); g.stroke();
    g.lineWidth = Math.max(1, ch * 0.006); g.strokeStyle = 'rgba(255,255,255,0.28)'; roundRect(g, ch * 0.004, ch * 0.004, cw - ch * 0.008, ch - ch * 0.008, rr); g.stroke();
    const lg = g.createLinearGradient(0, 0, cw, 0); lg.addColorStop(0, c1); lg.addColorStop(0.5, c2); lg.addColorStop(1, c1);
    g.save(); g.shadowColor = c1; g.shadowBlur = ch * 0.06; g.lineWidth = Math.max(1, ch * 0.009); g.strokeStyle = lg;
    roundRect(g, ch * 0.065, ch * 0.065, cw - ch * 0.13, ch - ch * 0.13, rr * 0.6); g.stroke(); g.restore();
    // corner brackets, inside the light line
    g.strokeStyle = c2; g.lineWidth = Math.max(1, ch * 0.012); const bi = ch * 0.11, bk = ch * 0.09;
    for (const [x, y, dx, dy] of [[bi, bi, 1, 1], [cw - bi, bi, -1, 1], [bi, ch - bi, 1, -1], [cw - bi, ch - bi, -1, -1]]) { g.beginPath(); g.moveTo(x, y + dy * bk); g.lineTo(x, y); g.lineTo(x + dx * bk, y); g.stroke(); }
    // the emblem
    const ex = ch * 0.68, ey = ch / 2, er = ch * 0.3;
    const hexPath = (r) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a0 = Math.PI / 6 + i * Math.PI / 3, a1 = a0 + Math.PI / 3, k = 0.18, p0 = [Math.cos(a0) * r, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, Math.sin(a1) * r];
      if (i === 0) g.moveTo(p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k); g.lineTo(p0[0] + (p1[0] - p0[0]) * (1 - k), p0[1] + (p1[1] - p0[1]) * (1 - k));
      const a2 = a1 + Math.PI / 3, p2 = [Math.cos(a2) * r, Math.sin(a2) * r]; g.quadraticCurveTo(p1[0], p1[1], p1[0] + (p2[0] - p1[0]) * k, p1[1] + (p2[1] - p1[1]) * k); } g.closePath(); };
    g.save(); g.translate(ex, ey);
    const halo = g.createRadialGradient(0, 0, er * 0.5, 0, 0, er * 1.7); halo.addColorStop(0, c1 + '55'); halo.addColorStop(1, c1 + '00');
    g.fillStyle = halo; g.fillRect(-er * 1.8, -er * 1.8, er * 3.6, er * 3.6);
    const eg = g.createLinearGradient(-er, -er, er, er); eg.addColorStop(0, c2); eg.addColorStop(1, c1);
    hexPath(er); g.fillStyle = eg; g.shadowColor = c1; g.shadowBlur = ch * 0.07; g.fill(); g.shadowBlur = 0;
    hexPath(er * 1.18); g.strokeStyle = c1; g.lineWidth = Math.max(1, ch * 0.01); g.stroke();
    // the two profiles, cut out of it in the backplate's black: brow, nose, lips, chin, meeting in the M's middle stroke
    g.fillStyle = '#0b0d10';
    for (const s of [-1, 1]) {
      g.beginPath(); const X = (x) => x * er * s;
      g.moveTo(X(0.06), -er * 0.62); g.lineTo(X(0.42), -er * 0.62); g.lineTo(X(0.42), er * 0.6); g.lineTo(X(0.3), er * 0.6);
      g.lineTo(X(0.3), -er * 0.1); g.quadraticCurveTo(X(0.22), -er * 0.02, X(0.16), er * 0.12); g.lineTo(X(0.1), er * 0.2);
      g.quadraticCurveTo(X(0.16), er * 0.26, X(0.12), er * 0.34); g.quadraticCurveTo(X(0.04), er * 0.36, X(0.06), er * 0.3);
      g.lineTo(X(0.06), -er * 0.62); g.closePath(); g.fill();
    }
    g.restore();
    // the name, set wide (the canvas's own letter spacing, which measureText counts), lit a little in the first colour
    const x0 = ch * 1.26, bw = cw - x0 - ch * 0.22, name = (L[0] || 'MORPHEX').toUpperCase(), num = L[1] || '';
    g.letterSpacing = Math.round(ch * 0.045) + 'px';
    const px = fit(g, name, F, bw * (num ? 0.7 : 0.98), ch * 0.27, x0, ch * 0.41, '#f4f8fa', { align: 'left', weight: 400, glow: c1 });
    const nw = g.measureText(name).width;
    g.letterSpacing = '0px';
    if (num) {
      // the number in its tab, then the registered mark
      g.font = `600 ${px * 0.6}px ${STACK(NF)}`; g.textAlign = 'left';
      const tw = g.measureText(num).width, tx = x0 + nw + px * 0.22, th = px * 0.82, ty = ch * 0.41 - th / 2;
      g.strokeStyle = c1; g.lineWidth = Math.max(1, ch * 0.01); roundRect(g, tx, ty, tw + px * 0.36, th, th * 0.22); g.stroke();
      g.save(); g.shadowColor = c1; g.shadowBlur = ch * 0.04; g.fillStyle = c2; g.fillText(num, tx + px * 0.18, ch * 0.41 + px * 0.21); g.restore();
      g.font = `400 ${px * 0.24}px ${STACK(SF)}`; g.fillStyle = 'rgba(230,244,250,0.7)'; g.fillText('®', tx + tw + px * 0.42, ty + px * 0.2);
    }
    // the rule: a diamond, then a line fading out
    const ry = ch * 0.6, dm = ch * 0.022;
    g.fillStyle = c2; g.beginPath(); g.moveTo(x0, ry); g.lineTo(x0 + dm, ry - dm); g.lineTo(x0 + dm * 2, ry); g.lineTo(x0 + dm, ry + dm); g.closePath(); g.fill();
    const rg = g.createLinearGradient(x0 + dm * 2.5, 0, x0 + bw, 0); rg.addColorStop(0, c1); rg.addColorStop(1, c1 + '00');
    g.fillStyle = rg; g.fillRect(x0 + dm * 2.5, ry - Math.max(0.5, ch * 0.004), bw - dm * 2.5, Math.max(1, ch * 0.008));
    if (S[0]) { g.letterSpacing = Math.round(ch * 0.018) + 'px'; fit(g, S[0].toUpperCase(), SF, bw, ch * 0.085, x0, ch * 0.72, 'rgba(206,240,250,0.78)', { align: 'left', weight: 500 }); g.letterSpacing = '0px'; }
  } else if (m.kind === 'stain') {
    // no words: a blot soaked into the floor or a run down the wall, darker at its heart, ragged at its edge
    const col = hex(m.tint, '#3a4a26');
    const [r0, g0, b0] = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16));
    g.clearRect(0, 0, cw, ch);
    const blot = (x, y, r, a) => { const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, `rgba(${r0},${g0},${b0},${a})`); q.addColorStop(0.6, `rgba(${r0},${g0},${b0},${a * 0.6})`); q.addColorStop(1, `rgba(${r0},${g0},${b0},0)`); g.fillStyle = q; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    if (m.drip) {
      // runs from the top: a tide mark, then streaks of different lengths
      blot(cw / 2, ch * 0.05, cw * 0.4, 0.35);
      for (let i = 0; i < 9; i++) { const x = cw * (0.15 + R() * 0.7), l = ch * (0.3 + R() * 0.65), wd = cw * (0.015 + R() * 0.03); const q = g.createLinearGradient(0, 0, 0, l); q.addColorStop(0, `rgba(${r0},${g0},${b0},0.5)`); q.addColorStop(1, `rgba(${r0},${g0},${b0},0)`); g.fillStyle = q; g.fillRect(x - wd / 2, 0, wd, l); blot(x, l * 0.95, wd * 1.2, 0.25); }
    } else {
      const n = 6 + Math.floor(R() * 6), s = Math.min(cw, ch);
      for (let i = 0; i < n; i++) blot(cw * (0.3 + R() * 0.4), ch * (0.3 + R() * 0.4), s * (0.12 + R() * 0.28), 0.18 + R() * 0.25);
      // a darker tide line round the edge, where it dried
      g.globalCompositeOperation = 'source-atop'; g.strokeStyle = `rgba(${r0 * 0.5 | 0},${g0 * 0.5 | 0},${b0 * 0.5 | 0},0.35)`; g.lineWidth = s * 0.012;
      g.beginPath(); g.ellipse(cw / 2, ch / 2, s * 0.36, s * 0.3, R() * 3, 0, Math.PI * 2); g.stroke(); g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 14; i++) blot(cw * (0.1 + R() * 0.8), ch * (0.1 + R() * 0.8), s * (0.01 + R() * 0.03), 0.4);
    }
  }
  cache.set(key, c);
  return c;
}

/** The room's marks as decals ({ key, src, quad, n, glow? }), once their faces have loaded. */
export async function roomMarks(L) {
  const list = (L?.spec?.decor?.marks || []).filter((m) => m && KINDS.has(m.kind) && (m.floor || ['front', 'back', 'left', 'right'].includes(m.wall)));
  if (!list.length) return [];
  await Promise.all([...new Set(list.flatMap((m) => [fontOf(m), subOf(m), 'Rock Salt', ...(MARK_FONTS[m.num_font] ? [m.num_font] : [])]))].map(loadFont));
  await Promise.all(list.filter((m) => m.kind === 'poster' && m.img).map((m) => loadPhoto(m.img)));
  const W = L.spec.w, D = L.spec.d, st = L.spec.stadium || null, out = [];
  list.forEach((m0, i) => {
    const w = Math.max(0.05, +m0.w || 0.6), h = Math.max(0.05, +m0.h || 0.3);
    const split = m0.kind === 'readout' && m0.lit !== false;
    for (const part of split ? ['panel', 'light'] : [null]) place(m0, i, w, h, part);
  });
  return out;
  function place(m, i, w, h, part) {
    const src = paintMark(m, st, part), key = `mark:${i}${part ? ':' + part : ''}`;
    const glow = part === 'panel' ? undefined : (m.kind === 'readout' || m.kind === 'lightbox' || m.kind === 'neon' || m.kind === 'logo' || m.kind === 'marquee') && m.lit !== false ? 0.9 : undefined;
    if (Array.isArray(m.floor)) {
      // flat on the floor, a hair above it, turned about its middle; up the picture is toward the turn
      const [u, v] = m.floor, a = ((+m.turn || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      // on whatever floor is under its middle: the room's, or a pit's let into it (room-layout.js baseAt)
      const y0 = (L.baseAt ? L.baseAt(u, v) || 0 : 0) + 0.004;
      const P = (x, z) => L.world(u + x * ca - z * sa, v + x * sa + z * ca, y0);
      out.push({ key, src, quad: [P(w / 2, h / 2), P(-w / 2, h / 2), P(-w / 2, -h / 2), P(w / 2, -h / 2)], n: [0, 1, 0], ...(glow ? { glow } : {}) });
      return;
    }
    const turn = m.wall === 'front' ? 180 : m.wall === 'back' ? 0 : m.wall === 'left' ? 90 : -90;
    const u = m.wall === 'left' ? -W / 2 : m.wall === 'right' ? W / 2 : Number(m.at) || 0, v = m.wall === 'front' ? 0 : m.wall === 'back' ? D : Number(m.at) || 0;
    const y = Number(m.y) || 1.6, [fu, fv] = facing(turn), su = -fv, sv = fu, z = 0.012 + (i % 7) * 0.0012 + (part === 'light' ? 0.003 : 0);
    const P = (x, yy) => L.world(u + su * x + fu * z, v + sv * x + fv * z, yy);
    const o = L.world(u, v, 0), f = L.world(u + fu, v + fv, 0);
    out.push({ key, src, quad: [P(w / 2, y + h / 2), P(-w / 2, y + h / 2), P(-w / 2, y - h / 2), P(w / 2, y - h / 2)], n: [f[0] - o[0], f[1] - o[1], f[2] - o[2]], ...(glow ? { glow } : {}) });
  }
}
