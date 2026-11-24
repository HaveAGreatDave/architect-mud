// ROOM · A ROOM'S SIGNS. The lettering a room hangs on its walls (`flags.room.decor.signs`), painted on a canvas in a
// face from the house library (docs/reference/fonts.md) and laid on the wall as a decal (gl/room.js setDecals), so
// it's mipmapped and stays still as the camera moves. It replaced the legend face's letters built as boxes, which
// were blocky up close and shimmered from across the room.
//
// A sign is designed by its row; every field but wall, along, y and text is optional:
//
//   wall, along, y   the wall, metres along it, the sign's middle up from the floor
//   text, sub        the words, and a smaller second line under them
//   h                the height of a capital in metres (0.12)
//   style            how it's made (below); the default comes from the old `plate` and `lit`
//   font, subFont    a face from the library by its name (room-marks.js MARK_FONTS); each style has its own default
//   hex              the letters' colour (and a lit sign's light)
//   plateHex, rimHex the plate's colour and its edge's
//   shape            the plate's outline: rect, round, pill, oval, chamfer, hex, shield, banner, arch
//   icon             a device beside the words: star, bolt, chevron, arrow-left|right|up|down, wing, crown, gear,
//                    claw, flame, wrench, cross, diamond, ring
//   emblem           a maker's emblem from a shared table instead of an icon (client/shared/hover-car-emblems.js)
//   frame            none, line, double or tube (a neon tube round the plate)
//   track            letter spacing in capitals (0.08 is wide)
//   case             'none' keeps the row's own case; otherwise the words are set in capitals
//   lit              a lit style's light; false leaves it off
//
// styles: plate (a painted metal plate, screwed on), enamel (vitreous enamel, a raised rim, a sheen), lightbox
// (a dark plate whose letters are lit from behind), paint (lettering painted straight on the wall), cut (letters cut
// from metal, standing off the wall on pins), channel (box letters with lit faces and dark returns), halo (dark
// metal letters with their light thrown on the wall behind them), neon (bent glass tube), badge (a maker's badge: a
// chrome-rimmed shaped plate with its emblem).
// The old rows ({ plate, lit }) still work: plate and unlit is `plate`, plate and lit `lightbox`, no plate and lit
// `neon`, no plate and unlit `paint`.
//
// ⚠ NOTHING HERE NAMES A PLACE. The words, colours and emblems are the room's content; this only paints them.
import { MARK_FONTS, loadFont } from './room-marks.js';
import { facing } from '../../../shared/room-layout.js';
import { HOVER_EMBLEMS } from '../../../shared/hover-car-emblems.js';

const STYLES = new Set(['plate', 'enamel', 'lightbox', 'paint', 'cut', 'channel', 'halo', 'neon', 'badge']);
const LIT = new Set(['lightbox', 'channel', 'halo', 'neon']);
const FONT = { plate: 'Overpass', enamel: 'Bowlby One SC', lightbox: 'Michroma', paint: 'Staatliches', cut: 'Michroma', channel: 'Righteous', halo: 'Syncopate', neon: 'Tilt Neon', badge: 'Black Ops One' };
const SUB_FONT = { plate: 'Geist', enamel: 'Geist', lightbox: 'Geist', paint: 'Staatliches', cut: 'Geist', channel: 'Geist', halo: null, neon: 'Tilt Neon', badge: 'Geist' };
const INK = { plate: '#f2efe4', enamel: '#f4f1e6', lightbox: '#e8f4ff', paint: '#f0ece0', cut: '#c9ced4', channel: '#ffffff', halo: '#9fe6ff', neon: '#ff4fd8', badge: '#e8edf2' };
const PLATE = { plate: '#2a2f36', enamel: '#1d3f6e', lightbox: '#121418', badge: '#16191e' };
const SHAPED = new Set(['plate', 'enamel', 'lightbox', 'badge']);
const EMBLEMS = { ...HOVER_EMBLEMS };

const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
const num = (x, d, lo, hi) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : d);
const STACK = (n) => `"${n}", Geist, Arial, sans-serif`;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const alpha = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };

/** A row as the sign it paints: every default filled in. Null if it can't be one. */
export function signOf(s) {
  if (!s || !s.text || !['front', 'back', 'left', 'right'].includes(s.wall)) return null;
  const style = STYLES.has(s.style) ? s.style : s.lit ? (s.plate === false ? 'neon' : 'lightbox') : (s.plate === false ? 'paint' : 'plate');
  const up = (t) => (s.case === 'none' ? String(t) : String(t).toUpperCase());
  const plateHex = hex(s.plateHex, PLATE[style] || '#2a2f36');
  return {
    wall: s.wall, along: num(s.along, 0, -999, 999), y: num(s.y, 1.6, -50, 50), h: num(s.h, 0.12, 0.02, 2),
    style, text: up(s.text), sub: s.sub ? up(s.sub) : '',
    font: MARK_FONTS[s.font] ? s.font : FONT[style], subFont: MARK_FONTS[s.subFont] ? s.subFont : SUB_FONT[style] || (MARK_FONTS[s.font] ? s.font : FONT[style]),
    ink: hex(s.hex, INK[style]), plateHex, rimHex: hex(s.rimHex, style === 'enamel' ? '#e9e4d6' : style === 'badge' ? '#c9d0d8' : mix(plateHex, '#ffffff', 0.35)),
    shape: s.shape || (style === 'badge' ? 'chamfer' : style === 'enamel' ? 'round' : 'rect'),
    icon: s.icon || null, emblem: EMBLEMS[s.emblem] ? s.emblem : null,
    frame: s.frame || (style === 'enamel' || style === 'plate' || style === 'badge' ? 'line' : 'none'),
    track: num(s.track, style === 'halo' || style === 'lightbox' ? 0.08 : 0.03, -0.1, 0.6),
    lit: style === 'neon' || LIT.has(style) ? s.lit !== false : s.lit === true,
  };
}

// ── the devices ──────────────────────────────────────────────────────────────────────────────────
// Each fills a path in a box from -1 to 1 round (0, 0), y down, with the current fill.
function icon(g, name, r) {
  const P = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r))); g.closePath(); g.fill(); };
  const ring = (r0, r1) => { g.beginPath(); g.arc(0, 0, r1 * r, 0, Math.PI * 2); g.arc(0, 0, r0 * r, 0, Math.PI * 2, true); g.fill(); };
  switch (name) {
    case 'star': P(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? 0.42 : 1; return [Math.cos(a) * k, Math.sin(a) * k]; })); break;
    case 'bolt': P([[0.2, -1], [-0.55, 0.12], [-0.05, 0.12], [-0.25, 1], [0.55, -0.18], [0.05, -0.18]]); break;
    case 'chevron': for (const dy of [-0.45, 0.25]) P([[-0.85, dy + 0.35], [0, dy - 0.4], [0.85, dy + 0.35], [0.85, dy + 0.7], [0, dy - 0.05], [-0.85, dy + 0.7]]); break;
    case 'arrow-right': case 'arrow-left': case 'arrow-up': case 'arrow-down': {
      g.save(); g.rotate({ 'arrow-right': 0, 'arrow-down': Math.PI / 2, 'arrow-left': Math.PI, 'arrow-up': -Math.PI / 2 }[name]);
      P([[1, 0], [0.1, -0.85], [0.1, -0.35], [-0.95, -0.35], [-0.95, 0.35], [0.1, 0.35], [0.1, 0.85]]); g.restore(); break;
    }
    case 'wing': for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const y = -0.5 + i * 0.3, l = 1 - i * 0.2; P([[s * 0.12, y], [s * l, y - 0.22], [s * (l - 0.1), y + 0.06], [s * 0.12, y + 0.22]]); } P([[0, -0.6], [0.14, -0.2], [0, 0.7], [-0.14, -0.2]]); break;
    case 'crown': P([[-0.9, 0.6], [-0.9, -0.5], [-0.45, 0], [0, -0.75], [0.45, 0], [0.9, -0.5], [0.9, 0.6]]); break;
    case 'gear': { g.beginPath(); for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, k = (i >> 1) % 2 ? 0.72 : 0.95; g.lineTo(Math.cos(a) * k * r, Math.sin(a) * k * r); } g.closePath(); g.arc(0, 0, 0.3 * r, 0, Math.PI * 2, true); g.fill(); break; }
    case 'claw': for (let i = -1; i <= 1; i++) P([[i * 0.42 + 0.2, -0.95], [i * 0.42 + 0.34, -0.9], [i * 0.42 - 0.12, 0.95], [i * 0.42 - 0.24, 0.7]]); break;
    case 'flame': g.beginPath(); g.moveTo(0, -r); g.bezierCurveTo(0.9 * r, -0.1 * r, 0.8 * r, 0.9 * r, 0, r); g.bezierCurveTo(-0.8 * r, 0.9 * r, -0.7 * r, 0.1 * r, -0.2 * r, -0.3 * r); g.bezierCurveTo(-0.1 * r, 0.1 * r, 0.1 * r, 0.1 * r, 0, -r); g.fill(); break;
    case 'wrench': g.save(); g.rotate(-Math.PI / 4); P([[-0.14, -0.5], [0.14, -0.5], [0.14, 0.95], [-0.14, 0.95]]); g.beginPath(); g.arc(0, -0.62 * r, 0.36 * r, 0, Math.PI * 2); g.rect(-0.12 * r, -1.1 * r, 0.24 * r, 0.5 * r); g.fill('evenodd'); g.restore(); break;
    case 'cross': P([[-0.3, -0.9], [0.3, -0.9], [0.3, -0.3], [0.9, -0.3], [0.9, 0.3], [0.3, 0.3], [0.3, 0.9], [-0.3, 0.9], [-0.3, 0.3], [-0.9, 0.3], [-0.9, -0.3], [-0.3, -0.3]]); break;
    case 'diamond': P([[0, -1], [0.75, 0], [0, 1], [-0.75, 0]]); break;
    case 'ring': ring(0.62, 0.95); break;
    default: return false;
  }
  return true;
}
// a maker's emblem: its 'mark' pieces in the ink, its 'field' pieces cut out of them (or filled in `field`)
function emblem(g, key, r, field) {
  for (const pc of EMBLEMS[key] || []) {
    g.save();
    if (pc.tone === 'field') { if (field) g.fillStyle = field; else g.globalCompositeOperation = 'destination-out'; }
    g.beginPath(); pc.p.forEach(([x, y], i) => (i ? g.lineTo(x * r, -y * r) : g.moveTo(x * r, -y * r))); g.closePath(); g.fill();
    g.restore();
  }
}
// the plate's outline as a path, in the box x, y, w, h
function outline(g, shape, x, y, w, h) {
  g.beginPath();
  const rr = (r) => { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const poly = (pts) => { pts.forEach(([a, b], i) => (i ? g.lineTo(x + a, y + b) : g.moveTo(x + a, y + b))); g.closePath(); };
  const c = h * 0.28;
  switch (shape) {
    case 'round': rr(h * 0.2); break;
    case 'pill': rr(h / 2); break;
    case 'oval': g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'chamfer': poly([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]); break;
    case 'hex': poly([[h * 0.45, 0], [w - h * 0.45, 0], [w, h / 2], [w - h * 0.45, h], [h * 0.45, h], [0, h / 2]]); break;
    case 'shield': poly([[0, 0], [w, 0], [w, h * 0.55], [w / 2, h], [0, h * 0.55]]); break;
    case 'banner': poly([[0, 0], [w, 0], [w - h * 0.35, h / 2], [w, h], [0, h], [h * 0.35, h / 2]]); break;
    case 'arch': g.moveTo(x, y + h); g.lineTo(x, y + h * 0.42); g.ellipse(x + w / 2, y + h * 0.42, w / 2, h * 0.42, 0, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); break;
    default: rr(Math.min(h * 0.06, 12));
  }
}
// how much wider and taller a shape's box is than the words in it, as [x, y] in capitals
const SHAPE_PAD = { rect: [0.7, 0.5], round: [0.8, 0.5], pill: [1.1, 0.5], oval: [1.6, 0.9], chamfer: [0.9, 0.5], hex: [1.1, 0.5], shield: [0.8, 1.5], banner: [1.3, 0.5], arch: [0.8, 1.1] };

const cache = new Map();
/**
 * A sign's canvas and its size on the wall in metres: { src, w, h }. `part` splits a lit sign in two: 'panel' what
 * it's made of (painted over the wall), 'light' its light alone (added to the room). Null `part` for an unlit one.
 */
export function paintWallSign(S, part = null) {
  const key = JSON.stringify([S, part]);
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'), g = c.getContext('2d');
  // the layout in pixels, a capital C tall, then C shrunk until it fits the canvas's limits
  const lay = (C) => {
    g.letterSpacing = Math.round(C * S.track) + 'px';
    g.font = `400 ${C}px ${STACK(S.font)}`;
    const mH = g.measureText('H'), capK = (mH.actualBoundingBoxAscent || C * 0.72) / C, px = C / capK;
    g.font = `400 ${px}px ${STACK(S.font)}`;
    const tw = g.measureText(S.text).width;
    let sw = 0, spx = 0;
    if (S.sub) { spx = px * 0.4; g.letterSpacing = Math.round(C * 0.12) + 'px'; g.font = `500 ${spx}px ${STACK(S.subFont)}`; sw = g.measureText(S.sub).width; }
    g.letterSpacing = '0px';
    const dev = S.icon || S.emblem ? C * (S.style === 'badge' ? 2.1 : 1.5) : 0, gap = dev ? C * 0.5 : 0;
    const bw = dev + gap + Math.max(tw, sw), bh = Math.max(dev, S.sub ? C * 1.75 : C);
    // a neon sign with a tube round it needs the tube's room, as a pill-shaped plate would
    const plate = SHAPED.has(S.style), tube = S.style === 'neon' && S.frame === 'tube';
    const [px0, py0] = plate ? SHAPE_PAD[S.shape] || SHAPE_PAD.rect : tube ? [1.0, 0.45] : [0, 0];
    const glow = S.lit || S.style === 'cut' || S.style === 'paint' ? C * 0.6 : C * 0.2;
    const pw = bw + C * px0 * 2, ph = bh + C * py0 * 2;
    return { C, px, tw, spx, sw, dev, gap, bw, bh, pw, ph, glow, W: Math.ceil(pw + glow * 2), H: Math.ceil(ph + glow * 2) };
  };
  let C = Math.round(num(S.h * 620, 120, 56, 200)), Lo = lay(C);
  const k = Math.min(1, 2048 / Lo.W, 1024 / Lo.H);
  if (k < 1) { C = Math.max(24, Math.floor(C * k)); Lo = lay(C); }
  c.width = Lo.W; c.height = Lo.H;
  const { px, tw, spx, sw, dev, gap, bw, bh, pw, ph, glow } = Lo, ox = glow, oy = glow;
  // where things go: the plate's box, the device's middle, the words' left and baselines
  const x0 = ox + (pw - bw) / 2, yMid = oy + (S.shape === 'shield' ? ph * 0.36 : S.shape === 'arch' ? ph * 0.6 : ph / 2);
  const tx = x0 + dev + gap, textW = Math.max(tw, sw), base = S.sub ? yMid - bh / 2 + C : yMid + C / 2, sBase = yMid + bh / 2;
  const words = (fill, mode = 'fill') => {
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.letterSpacing = Math.round(C * S.track) + 'px'; g.font = `400 ${px}px ${STACK(S.font)}`;
    // the canvas adds the spacing after the last letter too: nudge back half of it to keep the words centred
    const nudge = C * S.track / 2, cx = tx + textW / 2 + nudge;
    if (mode === 'stroke') g.strokeText(S.text, cx, base); else { g.fillStyle = fill; g.fillText(S.text, cx, base); }
    if (S.sub) {
      g.letterSpacing = Math.round(C * 0.12) + 'px'; g.font = `500 ${spx}px ${STACK(S.subFont)}`;
      if (mode === 'stroke') g.strokeText(S.sub, tx + textW / 2 + C * 0.06, sBase); else g.fillText(S.sub, tx + textW / 2 + C * 0.06, sBase);
    }
    g.letterSpacing = '0px';
  };
  const device = (fill, field) => {
    if (!dev) return;
    g.save(); g.translate(x0 + dev / 2, yMid); g.fillStyle = fill;
    if (S.emblem) emblem(g, S.emblem, dev / 2, field); else icon(g, S.icon, dev * 0.42);
    g.restore();
  };
  const shapeAt = (inset) => outline(g, S.shape, ox + inset, oy + inset, pw - inset * 2, ph - inset * 2);
  const shadow = (blur, dx, dy, a) => { g.shadowColor = `rgba(0,0,0,${a})`; g.shadowBlur = blur; g.shadowOffsetX = dx; g.shadowOffsetY = dy; };
  const noShadow = () => { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0; };
  const bloom = (col, layers) => { for (const [b, a] of layers) { g.save(); g.shadowColor = col; g.shadowBlur = C * b; g.globalAlpha = a; words(col); device(col); g.restore(); } };
  const st = S.style, light = part === 'light';

  if (SHAPED.has(st)) {
    if (!light) {
      // the plate, standing off the wall: its shadow, its face with a sheen across the top, its rim
      g.save(); shadow(C * 0.25, C * 0.05, C * 0.09, 0.45); g.fillStyle = S.plateHex; shapeAt(0); g.fill(); g.restore();
      const sh = g.createLinearGradient(0, oy, 0, oy + ph);
      sh.addColorStop(0, 'rgba(255,255,255,0.16)'); sh.addColorStop(0.45, 'rgba(255,255,255,0.02)'); sh.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = sh; shapeAt(0); g.fill();
      if (st === 'badge') {
        // chrome: a band of bright and dark steps round the edge
        const ch = g.createLinearGradient(0, oy, 0, oy + ph);
        [[0, '#ffffff'], [0.3, S.rimHex], [0.5, '#5a6068'], [0.7, S.rimHex], [1, '#2e3238']].forEach(([t, v]) => ch.addColorStop(t, v));
        g.lineWidth = C * 0.16; g.strokeStyle = ch; shapeAt(C * 0.08); g.stroke();
      } else if (st === 'enamel') {
        g.lineWidth = C * 0.1; g.strokeStyle = S.rimHex; shapeAt(C * 0.05); g.stroke();
      } else { g.lineWidth = Math.max(2, C * 0.035); g.strokeStyle = alpha(S.rimHex, 0.8); shapeAt(C * 0.02); g.stroke(); }
      if (S.frame === 'line' || S.frame === 'double') { g.lineWidth = Math.max(1.5, C * 0.03); g.strokeStyle = alpha(st === 'lightbox' ? S.ink : S.rimHex, st === 'lightbox' ? 0.35 : 0.75); shapeAt(C * 0.24); g.stroke(); if (S.frame === 'double') { shapeAt(C * 0.33); g.stroke(); } }
      // a plain plate is screwed on at its corners
      if (st === 'plate' && ['rect', 'round', 'chamfer'].includes(S.shape)) {
        for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const x = ox + C * 0.22 + sx * (pw - C * 0.44), y = oy + C * 0.22 + sy * (ph - C * 0.44), r = C * 0.06;
          const sg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r); sg.addColorStop(0, '#e8ecef'); sg.addColorStop(1, '#5a6066');
          g.fillStyle = sg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
          g.strokeStyle = 'rgba(20,20,20,0.7)'; g.lineWidth = r * 0.3; g.beginPath(); g.moveTo(x - r * 0.6, y); g.lineTo(x + r * 0.6, y); g.stroke();
        }
      }
      if (S.frame === 'tube') { g.lineWidth = C * 0.07; g.strokeStyle = alpha(mix(S.ink, '#cfd6da', 0.6), 0.6); shapeAt(C * 0.2); g.stroke(); }
      // the words and the device: printed, or a lit sign's unlit faces
      const face = S.lit ? mix(S.ink, S.plateHex, 0.55) : S.ink;
      if (!S.lit && st !== 'lightbox') { g.save(); shadow(C * 0.04, C * 0.02, C * 0.03, 0.4); words(face); device(face, S.plateHex); g.restore(); }
      else { words(face); device(face, S.plateHex); }
    } else {
      if (S.frame === 'tube') { g.save(); g.lineWidth = C * 0.07; g.strokeStyle = S.ink; g.shadowColor = S.ink; g.shadowBlur = C * 0.5; shapeAt(C * 0.2); g.stroke(); g.lineWidth = C * 0.03; g.strokeStyle = mix(S.ink, '#ffffff', 0.7); g.shadowBlur = 0; g.stroke(); g.restore(); }
      bloom(S.ink, [[0.5, 0.45], [0.18, 0.8]]);
      words(mix(S.ink, '#ffffff', 0.5)); device(mix(S.ink, '#ffffff', 0.5));
    }
  } else if (st === 'paint') {
    // lettering painted on the wall: flat, a soft edge where the brush ran, and wear
    g.save(); g.globalAlpha = 0.92; words(S.ink); device(S.ink); g.restore();
    wear(g, c.width, c.height, key);
  } else if (st === 'cut') {
    // cut metal on pins: the shadow they throw on the wall, the face in a brushed gradient, a lit top edge
    g.save(); shadow(C * 0.12, C * 0.07, C * 0.12, 0.55); words('#000'); device('#000'); g.restore();
    const mg = g.createLinearGradient(0, base - C, 0, base);
    mg.addColorStop(0, mix(S.ink, '#ffffff', 0.55)); mg.addColorStop(0.5, S.ink); mg.addColorStop(0.55, mix(S.ink, '#000000', 0.25)); mg.addColorStop(1, mix(S.ink, '#ffffff', 0.15));
    words(mg); device(mg, null);
    g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < c.width; x += 3) g.fillRect(x, 0, 1, c.height);
    g.restore();
  } else if (st === 'channel') {
    if (!light) {
      // the returns: the letter's sides in dark metal, stepped down and right, then the acrylic face unlit
      g.save(); shadow(C * 0.2, C * 0.06, C * 0.1, 0.5);
      for (let i = 6; i >= 1; i--) { g.save(); g.translate(C * 0.012 * i, C * 0.016 * i); words('#24272b'); device('#24272b'); g.restore(); }
      g.restore();
      const face = S.lit ? mix(S.ink, '#30343a', 0.45) : S.ink;
      words(face); device(face);
      g.lineWidth = Math.max(1.5, C * 0.025); g.strokeStyle = '#3a3e44'; words(null, 'stroke');
    } else { bloom(S.ink, [[0.6, 0.35], [0.2, 0.7]]); words(mix(S.ink, '#ffffff', 0.35)); device(mix(S.ink, '#ffffff', 0.35)); }
  } else if (st === 'halo') {
    if (!light) {
      // dark letters a few centimetres off the wall, a hairline catching the light on their edge
      g.save(); shadow(C * 0.08, C * 0.03, C * 0.05, 0.5); words('#15171a'); device('#15171a'); g.restore();
      g.lineWidth = Math.max(1, C * 0.018); g.strokeStyle = 'rgba(200,210,220,0.35)'; words(null, 'stroke');
    } else {
      // the light thrown back on the wall round each letter, the letters themselves cut out of it
      bloom(S.ink, [[0.9, 0.55], [0.35, 0.9], [0.12, 1]]);
      g.save(); g.globalCompositeOperation = 'destination-out'; words('#000'); device('#000'); g.restore();
    }
  } else if (st === 'neon') {
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (!light) {
      // the glass when it's off: pale tube, the dark paint on its back runs, and the clips holding it
      g.save(); shadow(C * 0.1, C * 0.04, C * 0.08, 0.35); words(alpha(mix(S.ink, '#d8dde0', 0.6), 0.55)); device(alpha(mix(S.ink, '#d8dde0', 0.6), 0.55)); g.restore();
      if (S.frame === 'tube') { g.lineWidth = C * 0.07; g.strokeStyle = alpha(mix(S.ink, '#d8dde0', 0.6), 0.5); outline(g, 'pill', ox + C * 0.1, oy + C * 0.1, pw - C * 0.2, ph - C * 0.2); g.stroke(); }
    } else {
      bloom(S.ink, [[1.0, 0.35], [0.45, 0.6], [0.15, 0.9]]);
      if (S.frame === 'tube') { g.save(); g.shadowColor = S.ink; g.shadowBlur = C * 0.4; g.lineWidth = C * 0.07; g.strokeStyle = S.ink; outline(g, 'pill', ox + C * 0.1, oy + C * 0.1, pw - C * 0.2, ph - C * 0.2); g.stroke(); g.restore(); }
      // the hot core of the tube, nearly white
      words(mix(S.ink, '#ffffff', 0.6)); device(mix(S.ink, '#ffffff', 0.6));
    }
  }
  const out = { src: c, w: c.width * S.h / C, h: c.height * S.h / C };
  cache.set(key, out);
  return out;
}
// chips and grime on painted lettering, the same every time for the same sign
function wear(g, w, h, key) {
  let s = 7; for (const ch of key) s = (s * 31 + ch.charCodeAt(0)) | 0;
  const R = () => { s = (Math.imul(s, 1103515245) + 12345) | 0; return ((s >>> 8) & 0xffff) / 65536; };
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) { g.globalAlpha = 0.2 + R() * 0.6; g.fillRect(R() * w, R() * h, 1 + R() * w * 0.01, 1 + R() * 3); }
  g.restore();
}

/** The signs a room has, from its decor and from the decor pieces an owner can move (plugins/roomstage/decor-pieces.js). */
export function signsOf(L) {
  const rows = [...(L?.spec?.decor?.signs || [])];
  for (const p of L?.placed || []) {
    if (p.form !== 'walldecor' || p.decor?.key !== 'signs' || !p.decor.entry) continue;
    const wall = p.wall || p.decor.entry.wall;
    rows.push(p.wall ? { ...p.decor.entry, wall, along: wall === 'left' || wall === 'right' ? p.v : p.u } : p.decor.entry);
  }
  return rows.map(signOf).filter(Boolean);
}

/** The room's signs as decals ({ key, src, quad, n, glow? }), once their faces have loaded. */
export async function roomSigns(L) {
  const list = signsOf(L);
  if (!list.length || typeof document === 'undefined') return [];
  await Promise.all([...new Set(list.flatMap((s) => [s.font, s.subFont]))].map(loadFont));
  const W = L.spec.w, D = L.spec.d, out = [];
  list.forEach((s, i) => {
    for (const part of s.lit ? ['panel', 'light'] : [null]) {
      const { src, w, h } = paintWallSign(s, part);
      const turn = s.wall === 'front' ? 180 : s.wall === 'back' ? 0 : s.wall === 'left' ? 90 : -90;
      const u = s.wall === 'left' ? -W / 2 : s.wall === 'right' ? W / 2 : s.along, v = s.wall === 'front' ? 0 : s.wall === 'back' ? D : s.along;
      // 3.6 cm off the wall, clear of any cladding (1.5 cm) and its joints (2.5 cm), or 10 cm on a ribbed steel wall,
      // whose girts stand 9 cm proud (room-decor.js sheet); the light a few mm in front of the panel
      const deep = [].concat(L.spec.decor?.walls || []).some((c) => c?.kind === 'sheet' && (!c.on || c.on.includes(s.wall)));
      const [fu, fv] = facing(turn), su = -fv, sv = fu, z = (deep ? 0.1 : 0.036) + (i % 7) * 0.0015 + (part === 'light' ? 0.004 : 0);
      const P = (x, yy) => L.world(u + su * x + fu * z, v + sv * x + fv * z, yy);
      const o = L.world(u, v, 0), f = L.world(u + fu, v + fv, 0), y = s.y;
      out.push({ key: `rsign:${i}${part ? ':' + part : ''}`, src, quad: [P(w / 2, y + h / 2), P(-w / 2, y + h / 2), P(-w / 2, y - h / 2), P(w / 2, y - h / 2)], n: [f[0] - o[0], f[1] - o[1], f[2] - o[2]], ...(part === 'light' ? { glow: 0.95 } : {}) });
    }
  });
  return out;
}
