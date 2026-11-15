// ROOM · A STADIUM'S SIGNS. Every sign in a stadium's rooms is painted here on a canvas, in a real display face, and
// laid on the room as a decal (panels/room-stadium.js): the lightbox over a seat door, the ticket window's band, a
// card machine's header, the plate under the Cup, the champions board's caption, the restroom doors, and whatever
// the room's own `stadium.signs` puts on its walls. The mesh draws the plate or the box; the words are these.
//
// ⚠ THE LOOK IS THE VENUE'S. `spec.stadium` (a room's flags.room.stadium) says which faces and colours: `font` for the
// big words, `sub` for the small ones, `ink`, `plate`, `accent` and `gilt`. Nothing here names a building: a deco
// barn and a modern bowl author different styles and get different signs from the same painter.
//
//   kinds:  lightbox  a backlit panel, the words dark on it (a seat door, the ticket window, a machine's header)
//           gilt      gold leaf on black glass, bevelled and shaded (a deco house's plaques and its wall lettering)
//           enamel    a painted steel plate with rounded corners and screw heads (the restrooms, a staff door)
//           neon      lit tube on a dark backer, a glow round each stroke (a bar, a card machine)
//           stencil   sprayed through a stencil straight onto the wall, overspray and drips (the Zamboni bay)

const FACES = {
  Limelight: 'limelight.woff2', Italiana: 'italiana.ttf', 'Big Shoulders Display': 'big-shoulders-display.woff2', Bungee: 'bungee.woff2',
  'Bungee Inline': 'bungee-inline.woff2', 'Playfair Display SC': 'playfair-display-sc.woff2', 'Saira Stencil One': 'saira-stencil-one.woff2',
  'Alfa Slab One': 'alfa-slab-one.woff2', 'Black Ops One': 'black-ops-one.woff2', Audiowide: 'audiowide.woff2', Rye: 'rye.woff2',
  Yellowtail: 'yellowtail.woff2', Sacramento: 'sacramento.woff2', 'Varela Round': 'varela-round.woff2', Orbitron: 'orbitron.woff2',
};
const loaded = new Map();
// Loads a face once; resolves true when it can be drawn with. A face that isn't in the set is the browser's own.
export function loadFace(name) {
  if (!FACES[name] || typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  if (!loaded.has(name)) {
    loaded.set(name, new FontFace(name, `url(${new URL(`../../../shared/fonts/${FACES[name]}`, import.meta.url).href})`).load()
      .then((f) => { document.fonts.add(f); return true; }).catch(() => false));
  }
  return loaded.get(name);
}
export const facesOf = (style) => [style?.font, style?.sub, 'Saira Stencil One'].filter((f) => FACES[f]);

const STACK = (name, fallback = 'Georgia, serif') => (name ? `"${name}", ${fallback}` : fallback);
// the house style with its defaults: a plain modern bowl if the venue says nothing
export function styleOf(spec) {
  const s = spec?.stadium || {};
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
  return { font: s.font || 'Big Shoulders Display', sub: s.sub || s.font || 'Big Shoulders Display', ink: hex(s.ink, '#14243a'), plate: hex(s.plate, '#f4f1e8'),
    accent: hex(s.accent, '#c9a24a'), frame: hex(s.frame, '#24364c'), gilt: s.gilt !== false, case: s.case === 'none' ? 'none' : 'upper' };
}

const cache = new Map();
// A sign's canvas, cached by everything that makes it. `w`/`h` is the face's size in metres (the canvas keeps its shape).
export function paintSign({ kind = 'lightbox', text = '', sub = '', w = 1, h = 0.3, style, lit = true, tint = null }) {
  const st = style || styleOf(null), up = (t) => (st.case === 'upper' ? String(t).toUpperCase() : String(t));
  const key = JSON.stringify([kind, text, sub, w.toFixed(2), h.toFixed(2), st, lit, tint]);
  if (cache.has(key)) return cache.get(key);
  const PX = 420, cw = Math.max(64, Math.min(2048, Math.round(w * PX))), ch = Math.max(48, Math.min(1024, Math.round(h * PX)));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  // sets `t` as large as fits in (bw, bh) in `face`, centred at (cx, cy), with `fill` (a colour or a gradient)
  const fitText = (t, face, bw, bh, cx, cy, fill, o = {}) => {
    if (!t) return 0;
    let px = bh;
    g.font = `${o.weight || 400} ${px}px ${STACK(face)}`;
    const tr = o.track || 0, width = (sz) => { g.font = `${o.weight || 400} ${sz}px ${STACK(face)}`; return g.measureText(t).width + tr * sz * (t.length - 1); };
    let wd = width(px);
    if (wd > bw) { px *= bw / wd; wd = width(px); }
    const m = g.measureText(t), asc = m.actualBoundingBoxAscent || px * 0.72, desc = m.actualBoundingBoxDescent || 0, base = cy + (asc - desc) / 2;
    const draw = (dx = 0, dy = 0) => {
      if (!tr) { g.fillText(t, cx + dx, base + dy); return; }
      let x = cx - wd / 2;
      g.textAlign = 'left';
      for (const chr of t) { g.fillText(chr, x + dx, base + dy); x += g.measureText(chr).width + tr * px; }
      g.textAlign = 'center';
    };
    if (o.shadow) { g.fillStyle = o.shadow; draw(px * 0.04, px * 0.05); }
    if (o.glow) { g.save(); g.shadowColor = o.glow; g.shadowBlur = px * 0.35; g.fillStyle = fill; draw(); draw(); g.restore(); }
    if (o.stroke) { g.lineWidth = px * 0.06; g.strokeStyle = o.stroke; g.lineJoin = 'round'; if (!tr) g.strokeText(t, cx, base); }
    g.fillStyle = fill; draw();
    return px;
  };
  const T = up(text), S = up(sub), two = !!S;
  if (kind === 'gilt') {
    // gold leaf on black glass: a bevel of gold round the edge, the words in a gradient of leaf with a dark shade under
    const bg = g.createLinearGradient(0, 0, 0, ch); bg.addColorStop(0, '#15130f'); bg.addColorStop(0.5, '#090807'); bg.addColorStop(1, '#13110d');
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    const leaf = (y0, y1) => { const q = g.createLinearGradient(0, y0, 0, y1); q.addColorStop(0, '#8a6424'); q.addColorStop(0.3, '#e9cf8a'); q.addColorStop(0.5, '#fff3cc'); q.addColorStop(0.7, '#c9a050'); q.addColorStop(1, '#7a5520'); return q; };
    const m = Math.round(ch * 0.08);
    g.strokeStyle = leaf(0, ch); g.lineWidth = Math.max(2, ch * 0.025); g.strokeRect(m, m, cw - 2 * m, ch - 2 * m);
    g.lineWidth = Math.max(1, ch * 0.008); g.strokeRect(m * 1.7, m * 1.7, cw - 3.4 * m, ch - 3.4 * m);
    // deco corners: a stepped notch in each
    g.fillStyle = leaf(0, ch);
    for (const [x, y] of [[m, m], [cw - m, m], [m, ch - m], [cw - m, ch - m]]) { g.save(); g.translate(x, y); g.fillRect(-m * 0.5, -m * 0.5, m, m); g.restore(); }
    const bh = ch * (two ? 0.4 : 0.56), cy = two ? ch * 0.42 : ch * 0.52;
    fitText(T, st.font, cw - 6 * m, bh, cw / 2, cy, leaf(cy - bh / 2, cy + bh / 2), { shadow: 'rgba(0,0,0,0.85)', track: 0.08 });
    if (two) fitText(S, st.sub, cw - 8 * m, ch * 0.16, cw / 2, ch * 0.74, leaf(ch * 0.66, ch * 0.82), { track: 0.2 });
  } else if (kind === 'enamel') {
    // a painted steel plate: the plate's colour, a rim in the ink, rounded corners and four screw heads, light wear
    const rad = Math.min(cw, ch) * 0.14;
    g.fillStyle = tint || st.frame; roundRect(g, 0, 0, cw, ch, rad); g.fill();
    g.fillStyle = st.plate; roundRect(g, ch * 0.06, ch * 0.06, cw - ch * 0.12, ch - ch * 0.12, rad * 0.75); g.fill();
    g.strokeStyle = tint || st.frame; g.lineWidth = ch * 0.03; roundRect(g, ch * 0.11, ch * 0.11, cw - ch * 0.22, ch - ch * 0.22, rad * 0.55); g.stroke();
    for (const [x, y] of [[0.09, 0.15], [0.91, 0.15], [0.09, 0.85], [0.91, 0.85]]) { g.fillStyle = '#9a9a96'; g.beginPath(); g.arc(cw * x, ch * y, ch * 0.03, 0, Math.PI * 2); g.fill(); }
    fitText(T, st.font, cw * 0.74, ch * (two ? 0.4 : 0.52), cw / 2, two ? ch * 0.42 : ch * 0.52, tint || st.ink);
    if (two) fitText(S, st.sub, cw * 0.7, ch * 0.16, cw / 2, ch * 0.72, tint || st.ink, { track: 0.12 });
    wear(g, cw, ch, 0.12);
  } else if (kind === 'neon') {
    g.fillStyle = 'rgba(8,8,12,0.92)'; roundRect(g, 0, 0, cw, ch, ch * 0.1); g.fill();
    const col = tint || st.accent;
    fitText(T, st.font, cw * 0.86, ch * (two ? 0.5 : 0.62), cw / 2, two ? ch * 0.44 : ch * 0.52, lit ? '#fff6f0' : '#3a3438', lit ? { glow: col, stroke: col } : { stroke: '#2a2428' });
    if (two) fitText(S, st.sub, cw * 0.8, ch * 0.18, cw / 2, ch * 0.8, lit ? col : '#2a2428', lit ? { glow: col } : {});
  } else if (kind === 'stencil') {
    // sprayed on the wall: clear behind, the words with overspray and a drip or two
    g.clearRect(0, 0, cw, ch);
    const col = tint || st.accent;
    g.save(); g.shadowColor = col; g.shadowBlur = ch * 0.04;
    const px = fitText(T, 'Saira Stencil One', cw * 0.94, ch * (two ? 0.56 : 0.8), cw / 2, two ? ch * 0.38 : ch * 0.5, col, { track: 0.04 });
    g.restore();
    if (two) fitText(S, 'Saira Stencil One', cw * 0.9, ch * 0.24, cw / 2, ch * 0.82, col, { track: 0.06 });
    let seed = T.length * 7 + 3;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    g.fillStyle = col;
    for (let i = 0; i < 6; i++) { const x = cw * (0.1 + rnd() * 0.8), y = ch * (two ? 0.5 : 0.7), l = px * (0.2 + rnd() * 0.6); g.fillRect(x, y, Math.max(2, px * 0.03), l); }
  } else {
    // a lightbox: lit from behind, the words in the ink with a thin rule under them, the face a touch warmer at the middle
    const bg = g.createRadialGradient(cw / 2, ch / 2, ch * 0.1, cw / 2, ch / 2, cw * 0.7);
    bg.addColorStop(0, lit ? '#ffffff' : '#9a9890'); bg.addColorStop(1, lit ? st.plate : '#6a6862');
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    fitText(T, st.font, cw * 0.9, ch * (two ? 0.5 : 0.7), cw / 2, two ? ch * 0.4 : ch * 0.52, tint || st.ink, { track: 0.04 });
    if (two) fitText(S, st.sub, cw * 0.86, ch * 0.2, cw / 2, ch * 0.8, tint || st.ink, { track: 0.14 });
    g.fillStyle = st.accent; g.fillRect(cw * 0.06, ch * 0.92, cw * 0.88, Math.max(2, ch * 0.025));
  }
  cache.set(key, c);
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
// scuffs and chips on a painted plate
function wear(g, cw, ch, k) {
  let s = cw * 13 + ch;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.save();
  for (let i = 0; i < 40; i++) { g.globalAlpha = k * rnd(); g.fillStyle = rnd() < 0.5 ? '#3a3430' : '#ffffff'; g.fillRect(rnd() * cw, rnd() * ch, 1 + rnd() * cw * 0.02, 1 + rnd() * 2); }
  g.restore();
}
