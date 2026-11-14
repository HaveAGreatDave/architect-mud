// SHEETS ON A ROOM'S WALL, HUNG AS A RUN, AND THE JOIN. Paper a plugin says hangs in a room (`room.sheets`, sent on
// `room_view` as `sheets` and again as `room_sheets`): each sheet is one slot of a set, `{ id, set, slot, of, glyph,
// title, sub, line, ground, ink, accent, pose, seam? }`. A set's sheets hang edge to edge along the clearest stretch
// of wall, in slot order, each where its slot falls, so a run with gaps in it shows the gaps.
//
// The sheets are slices of one print. `printOf` paints the whole run as one canvas: the grounds run into each other,
// a sunburst and a skyline cross every seam, each slot has its hero and, faint in the ground behind them, its glyph.
// A sheet on the wall is its slice with torn edges, a little crooked and a little apart from the next.
//
// With every slot hung, the join plays once (`createSheetScene`): the camera goes to the wall, each sheet's glyph
// lights up in turn, the sheets close up with gold light along the seams, and the seams go, leaving one long sheet
// whose glyphs keep a low gleam. After that the set is drawn joined (`sheetDecals` with `joined`).
//
// ⚠ IT'S ALL DATA. Nothing here knows the word or the heroes: the plugin sends the glyphs, the titles and the colours
// (plugins/posters/sheets.js for Architect's). A second game's set of prints joins the same way.
//
// ⚠ A LEAF but for the layout's helpers: room-stage.js imports it, and the Room Lab through it.
//
// Decals for gl/room.js setDecals: paint for the sheets, `glow` for the light off the glyphs and the seams.

import { doorwaysOf, facing, HUNG_AT, FT_PER_M } from '../../../shared/room-layout.js';

const SHEET_W = 0.56, SHEET_H = 0.8;      // one sheet, metres
const MID_Y = 1.6;                        // where the middle of the run hangs
const PX = 384, PH = Math.round(PX * SHEET_H / SHEET_W);
const GLEAM = 0.32;                       // the glyphs' light on a joined run, for good
const PROUD = 0.024, GLOW_PROUD = 0.03;   // off the plaster: clear of a fine room's cladding (2 cm)

const perM = (L) => (L.ft || 1) * FT_PER_M;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { const t = clamp01(x); return t * t * t * (t * (t * 6 - 15) + 10); };
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const hex = (s, d) => (/^#[0-9a-f]{6}$/i.test(s || '') ? s : d);

/** The room's sheets grouped by set: [{ set, of, sheets: [...] }], each set's sheets one per slot, in slot order. */
export function setsOf(sheets) {
  const by = new Map();
  for (const s of sheets || []) {
    if (!s?.set || !Number.isInteger(s.slot) || !(s.of > 0) || s.slot < 0 || s.slot >= s.of) continue;
    const g = by.get(s.set) || by.set(s.set, { set: s.set, of: s.of, sheets: [] }).get(s.set);
    if (!g.sheets.some((q) => q.slot === s.slot)) g.sheets.push(s);
  }
  for (const g of by.values()) g.sheets.sort((a, b) => a.slot - b.slot);
  return [...by.values()];
}
export const isWhole = (g) => !!g && g.sheets.length === g.of;

// ── where the run hangs ───────────────────────────────────────────────────────────────────────────
// Along each wall, what's in the way at the run's height: a window, a door or a doorway, a lit sign, and any piece
// standing against that wall that comes up past the run's foot or hangs on it. The run goes on the longest clear
// stretch; on none long enough it's hung smaller, down to 60%, and past that not at all.
function wallsOf(L) {
  const S = L.spec, hu = L.w / 2;
  return [
    { wall: 'left', lo: 0, hi: L.d, across: L.w },
    { wall: 'right', lo: 0, hi: L.d, across: L.w },
    { wall: 'back', lo: -hu, hi: hu, across: L.d },
    { wall: 'front', lo: -hu, hi: hu, across: L.d },
  ].filter((W) => !(Array.isArray(S.glass) && S.glass.includes(W.wall)));
}
function busyOn(L, wall, y0, y1) {
  const S = L.spec, k = perM(L), out = [];
  const panes = S.windowless ? [] : S.windows?.length ? S.windows : S.window ? [{ wall: 'front', a: S.window[0], b: S.window[1] }] : [];
  for (const q of panes) if (q.wall === wall) out.push([q.a, q.b]);
  if (wall === 'back' && S.door) out.push([S.door[0], S.door[1]]);
  if (wall === 'back' && S.annex?.door) out.push([S.annex.door[0], S.annex.door[1]]);
  if (wall === 'front' && S.balcony?.door) out.push([S.balcony.door[0], S.balcony.door[1]]);
  for (const o of doorwaysOf(S)) if (o.wall === wall) out.push([o.a, o.b]);
  if (S.sign && (S.sign.wall || 'back') === wall) { const at = (Number(S.sign.at) || 0) * k; out.push([at - 1.6 * k, at + 1.6 * k]); }
  // the kitchen's wall units run the length of its wall, over the worktop
  if (S.plan?.run && wall === 'right') out.push([S.plan.run[2], S.plan.run[3]]);
  const near = 0.65 * k, hu = L.w / 2;
  for (const p of L.placed || []) {
    if (p.annex) continue;
    const [fu, fv] = facing(p.turn), su = -fv, sv = fu, hw = p.w / 2, hd = p.d / 2;
    const us = [-1, 1].flatMap((a) => [-1, 1].map((b) => p.u + su * hw * a + fu * hd * b));
    const vs = [-1, 1].flatMap((a) => [-1, 1].map((b) => p.v + sv * hw * a + fv * hd * b));
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const off = wall === 'left' ? u0 + hu : wall === 'right' ? hu - u1 : wall === 'front' ? v0 : L.d - v1;
    if (off > near) continue;
    const base = (p.y0 || 0) + (p.rise || 0);
    const [b, t] = Number.isFinite(p.mount) ? [p.mount - p.h / 2, p.mount + p.h / 2] : p.arche === 'cabinet' ? [HUNG_AT * k, HUNG_AT * k + p.h] : [base, base + p.h];
    if (t < y0 - 0.03 * k || b > y1) continue;
    out.push(wall === 'left' || wall === 'right' ? [v0, v1] : [u0, u1]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
/** Where a run of `of` sheets hangs: { wall, c, y, sw, sh, across } in the room's units, or null for nowhere. */
export function sheetRun(L, of, taken = []) {
  if (!L?.spec || !(of > 0)) return null;
  const k = perM(L), sw0 = SHEET_W * k, sh0 = SHEET_H * k, y = Math.min(MID_Y * k, (L.h || 2.6 * k) - sh0 / 2 - 0.15 * k);
  const need = of * sw0, edge = 0.2 * k, clear = 0.12 * k;
  let best = null;
  for (const W of wallsOf(L)) {
    const busy = [...busyOn(L, W.wall, y - sh0 / 2, y + sh0 / 2), ...taken.filter((t) => t.wall === W.wall).map((t) => [t.a, t.b])].sort((a, b) => a[0] - b[0]);
    let at = W.lo + edge;
    const gaps = [];
    for (const [a, b] of busy) { if (a - clear > at) gaps.push([at, a - clear]); at = Math.max(at, b + clear); }
    if (W.hi - edge > at) gaps.push([at, W.hi - edge]);
    for (const [a, b] of gaps) if (!best || b - a > best.b - best.a + 0.05 * k) best = { wall: W.wall, a, b, across: W.across };
  }
  if (!best) return null;
  const s = Math.min(1, (best.b - best.a) / need);
  if (s < 0.6) return null;
  return { wall: best.wall, c: (best.a + best.b) / 2, y, sw: sw0 * s, sh: sh0 * s, across: best.across, span: [best.a, best.b] };
}

// A point on the run's wall, `s` across it to the right as you face it from its middle and `y` up, `d` out of it,
// in the world. And the wall's inward normal.
function wallFrame(L, run) {
  const hu = L.w / 2, D = L.d, W = run.wall;
  const at = (a, y, d) => (W === 'front' ? L.world(a, d, y) : W === 'back' ? L.world(a, D - d, y) : W === 'left' ? L.world(-hu + d, a, y) : L.world(hu - d, a, y));
  const o = at(run.c, run.y, 0), q = at(run.c, run.y, 1), nn = [q[0] - o[0], 0, q[2] - o[2]], nl = Math.hypot(nn[0], nn[2]) || 1, n = [nn[0] / nl, 0, nn[2] / nl];
  // which way `a` runs for somebody facing the wall: right = (n.z, 0, -n.x)
  const p1 = at(run.c + 1, run.y, 0), sign = ((p1[0] - o[0]) * n[2] + (p1[2] - o[2]) * -n[0]) >= 0 ? 1 : -1;
  return { n, pt: (s, y, d) => at(run.c + sign * s, y, d) };
}

// ── the print ─────────────────────────────────────────────────────────────────────────────────────
const FACE = '900 {}px Impact, "Haettenschweiler", "Arial Narrow Bold", "Arial Black", sans-serif';
const font = (px) => FACE.replace('{}', String(Math.round(px)));
function fitText(g, text, px, maxW) {
  g.font = font(px);
  const w = g.measureText(text).width || 1;
  if (w > maxW) g.font = font(px * maxW / w);
}
// The hero, from the waist up, in the slot's ink with a line of its accent round them. `pose` changes the head and
// what the arms are doing; an unknown one is plain.
function hero(g, cx, H, sh, pose) {
  const r = PX * 0.088, hy = H * (pose === 'down' ? 0.355 : 0.33), sy = H * 0.47, bw = PX * 0.36;
  const tilt = pose === 'down' ? 0.22 : pose === 'shout' ? -0.12 : 0;
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = sh.accent; g.lineWidth = 7; g.fillStyle = sh.ink;
  // each part outlined in the accent and filled in the ink, one over the last, so an arm reads in front of the chest
  const part = (draw) => { g.beginPath(); draw(); g.stroke(); g.fill(); };
  const shape = () => {
    // shoulders and chest, cut off at the band
    g.moveTo(cx - bw, H * 0.82);
    g.quadraticCurveTo(cx - bw * 1.02, sy + r * 0.2, cx - bw * 0.55, sy - r * 0.1);
    g.lineTo(cx - r * 0.45, sy - r * 0.55);
    g.lineTo(cx - r * 0.45, hy + r * 0.8);
    g.lineTo(cx + r * 0.45, hy + r * 0.8);
    g.lineTo(cx + r * 0.45, sy - r * 0.55);
    g.lineTo(cx + bw * 0.55, sy - r * 0.1);
    g.quadraticCurveTo(cx + bw * 1.02, sy + r * 0.2, cx + bw, H * 0.82);
    g.closePath();
  };
  part(shape);
  // the head
  part(() => g.ellipse(cx + Math.sin(tilt) * r, hy, r, r * 1.18, tilt, 0, Math.PI * 2));
  {
    // what the arms are doing
    const arm = (pts, w) => part(() => { g.moveTo(pts[0][0] + w, pts[0][1]); for (const [x, y] of pts) g.lineTo(x, y); for (const [x, y] of [...pts].reverse()) g.lineTo(x + w, y + w * 0.4); g.closePath(); });
    if (pose === 'shout') arm([[cx + bw * 0.6, sy + r * 0.3], [cx + bw * 1.0, sy - r * 1.6], [cx + bw * 1.15, sy - r * 3.6]], r * 0.62);
    if (pose === 'blade') arm([[cx - bw * 0.6, sy + r * 0.3], [cx - bw * 1.0, sy - r * 1.3], [cx - bw * 0.85, sy - r * 3.1]], r * 0.6);
    if (pose === 'smoke') arm([[cx + bw * 0.7, sy + r * 1.6], [cx + bw * 0.45, sy + r * 0.2], [cx + r * 0.9, hy + r * 0.9]], r * 0.55);
    if (pose === 'down') arm([[cx - bw * 0.7, sy + r * 1.8], [cx - r * 0.6, sy + r * 0.9], [cx + r * 0.6, sy + r * 0.9], [cx + bw * 0.7, sy + r * 1.8]], r * 0.5);
    if (pose === 'hood') part(() => {
      // a cowl over the head, and the two points of it
      g.moveTo(cx - r * 1.25, hy + r * 0.9);
      g.quadraticCurveTo(cx - r * 1.45, hy - r * 1.2, cx - r * 0.75, hy - r * 1.95);
      g.lineTo(cx - r * 0.35, hy - r * 1.15); g.lineTo(cx + r * 0.35, hy - r * 1.15);
      g.lineTo(cx + r * 0.75, hy - r * 1.95);
      g.quadraticCurveTo(cx + r * 1.45, hy - r * 1.2, cx + r * 1.25, hy + r * 0.9);
      g.closePath();
    });
    // a flying helmet tucked under the left arm
    if (pose === 'helmet') part(() => g.ellipse(cx - bw * 0.62, sy + r * 2.2, r * 1.1, r * 0.95, 0, 0, Math.PI * 2));
  }
  // what the pose holds, in the accent
  g.strokeStyle = sh.accent; g.fillStyle = sh.accent;
  if (pose === 'rifle') {
    g.lineWidth = 9; g.beginPath(); g.moveTo(cx + bw * 0.75, H * 0.78); g.lineTo(cx - bw * 0.9, sy - r * 2.6); g.stroke();
    g.strokeStyle = sh.ink; g.lineWidth = 5; g.beginPath(); g.moveTo(cx + bw * 0.73, H * 0.78); g.lineTo(cx - bw * 0.88, sy - r * 2.58); g.stroke();
  }
  if (pose === 'blade') { g.lineWidth = 4; g.beginPath(); g.moveTo(cx - bw * 0.6, sy - r * 3.2); g.lineTo(cx - bw * 0.42, sy - r * 4.6); g.stroke(); }
  if (pose === 'down') { g.beginPath(); g.arc(cx, sy + r * 0.55, r * 0.32, 0, Math.PI * 2); g.fill(); }
  if (pose === 'smoke') {
    g.globalAlpha = 0.75; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 40; i++) { const t = i / 40, x = cx + r * 0.9 + Math.sin(t * 9) * r * 0.5 * t, y = hy + r * 0.6 - t * H * 0.24; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke(); g.globalAlpha = 1;
  }
  if (pose === 'hood') { g.beginPath(); g.ellipse(cx - r * 0.38, hy - r * 0.05, r * 0.2, r * 0.08, 0, 0, Math.PI * 2); g.ellipse(cx + r * 0.38, hy - r * 0.05, r * 0.2, r * 0.08, 0, 0, Math.PI * 2); g.fill(); }
  if (pose === 'helmet') { g.lineWidth = 4; g.beginPath(); g.ellipse(cx - bw * 0.62, sy + r * 2.0, r * 0.75, r * 0.3, 0, 0, Math.PI * 2); g.stroke(); }
  g.restore();
}
// Where a slot's glyph is, so the light off it lands on the one in the print
const glyphAt = (H) => ({ y: H * 0.5, px: H * 0.64 });

/** The whole run as one print: `of` slots across, those that hang painted in full. */
export function printOf(g0) {
  const W = PX * g0.of, H = PH, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), r = rng(hashOf(g0.set));
  const by = new Map(g0.sheets.map((s) => [s.slot, { ...s, ground: hex(s.ground, '#8a3a2a'), ink: hex(s.ink, '#141010'), accent: hex(s.accent, '#f0d080') }]));
  // the grounds run into each other across the seams
  const lin = g.createLinearGradient(0, 0, W, 0);
  for (const s of by.values()) {
    const c = (s.slot + 0.5) / g0.of, w = 0.22 / g0.of;
    lin.addColorStop(clamp01(c - w), s.ground); lin.addColorStop(clamp01(c + w), s.ground);
  }
  g.fillStyle = by.size ? lin : '#7a3a2a'; g.fillRect(0, 0, W, H);
  // one sunburst across the run, from over its middle sheet
  const ox = W / 2, oy = H * 0.42;
  g.fillStyle = 'rgba(255, 238, 200, 0.075)';
  const rays = 64;
  for (let i = 0; i < rays; i += 2) {
    const a0 = (i / rays) * Math.PI * 2, a1 = ((i + 1) / rays) * Math.PI * 2, R = W;
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + Math.cos(a0) * R, oy + Math.sin(a0) * R); g.lineTo(ox + Math.cos(a1) * R, oy + Math.sin(a1) * R); g.closePath(); g.fill();
  }
  const dark = g.createLinearGradient(0, 0, 0, H);
  dark.addColorStop(0, 'rgba(0,0,0,0.05)'); dark.addColorStop(0.55, 'rgba(0,0,0,0)'); dark.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = dark; g.fillRect(0, 0, W, H);
  // each glyph, huge and faint, in the ground behind its hero: there if you know to look
  const G = glyphAt(H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const s of by.values()) {
    g.font = font(G.px);
    g.fillStyle = 'rgba(0, 0, 0, 0.11)'; g.fillText(String(s.glyph || '').slice(0, 2), (s.slot + 0.5) * PX, G.y);
    g.strokeStyle = 'rgba(255, 240, 210, 0.05)'; g.lineWidth = 2; g.strokeText(String(s.glyph || '').slice(0, 2), (s.slot + 0.5) * PX, G.y);
  }
  // a skyline along the foot of the whole run
  const sky = by.values().next().value?.ink || '#141010';
  g.fillStyle = sky; g.globalAlpha = 0.5;
  for (let x = 0; x < W;) {
    const w = 14 + r() * 38, h = H * (0.05 + r() * 0.12);
    g.fillRect(x, H * 0.8 - h, w - 3, h);
    if (r() < 0.25) g.fillRect(x + w * 0.4, H * 0.8 - h - H * 0.04, 3, H * 0.04);
    x += w;
  }
  g.globalAlpha = 1;
  // the heroes, then what's printed across a tear
  for (const s of by.values()) hero(g, (s.slot + 0.5) * PX, H, s, s.pose);
  // a wing off the one sheet that runs on over the next (the pose `helmet`, the one who comes back)
  for (const s of by.values()) {
    if (s.pose !== 'helmet') continue;
    const x0 = (s.slot + 0.5) * PX + PX * 0.18, y0 = H * 0.24;
    g.save(); g.fillStyle = s.ink; g.strokeStyle = s.accent; g.lineWidth = 5;
    g.beginPath(); g.moveTo(x0, y0 + 26); g.lineTo(x0 + PX * 1.05, y0 - 30); g.lineTo(x0 + PX * 1.12, y0 - 14); g.lineTo(x0 + PX * 0.2, y0 + 44); g.closePath();
    g.stroke(); g.fill(); g.restore();
  }
  for (const s of by.values()) {
    if (!s.seam) continue;
    g.font = font(H * 0.07); g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillText(String(s.seam).split('').join(' '), (s.slot + 1) * PX, H * 0.66);
  }
  // each sheet's lettering: the name over the hero, what they were called under it, the slogan in the band at the foot
  for (const s of by.values()) {
    const cx = (s.slot + 0.5) * PX;
    g.fillStyle = s.ink; g.fillRect(s.slot * PX, H * 0.82, PX, H * 0.18);
    g.fillStyle = s.accent; g.fillRect(s.slot * PX, H * 0.82, PX, 4);
    fitText(g, String(s.title || '').toUpperCase(), H * 0.12, PX * 0.86);
    g.lineWidth = 8; g.strokeStyle = s.ink; g.strokeText(String(s.title || '').toUpperCase(), cx, H * 0.11);
    g.fillStyle = s.accent; g.fillText(String(s.title || '').toUpperCase(), cx, H * 0.11);
    fitText(g, String(s.sub || '').toUpperCase(), H * 0.036, PX * 0.84);
    g.fillStyle = 'rgba(255, 246, 228, 0.9)'; g.fillText(String(s.sub || '').toUpperCase(), cx, H * 0.185);
    fitText(g, String(s.line || '').toUpperCase(), H * 0.042, PX * 0.86);
    g.fillStyle = s.accent; g.fillText(String(s.line || '').toUpperCase(), cx, H * 0.91);
  }
  // the paper: a fold across the middle and a little grain
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, H * 0.5, W, 2);
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, H * 0.5 + 2, W, 2);
  for (let i = 0; i < W * H / 260; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,250,235,0.06)'; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
  return cv;
}

// One sheet: its slice of the print, torn at the sides. Only the first sheet's left edge is a clean margin.
function sheetCanvas(print, slot) {
  const cv = document.createElement('canvas');
  cv.width = PX; cv.height = PH;
  const g = cv.getContext('2d');
  g.drawImage(print, -slot * PX, 0);
  const r = rng(0x5eed + slot * 977);
  const tear = (x0, dir) => {
    const pts = [];
    for (let y = 0; y <= PH; y += 6) pts.push([x0 + dir * (2 + r() * 9 + Math.sin(y * 0.05 + slot) * 2), y]);
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.moveTo(x0 - dir * 2, 0); for (const [x, y] of pts) g.lineTo(x, y); g.lineTo(x0 - dir * 2, PH); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    // the paper's own colour along a torn edge
    g.strokeStyle = 'rgba(236, 226, 204, 0.85)'; g.lineWidth = 2;
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x + dir, y) : g.moveTo(x + dir, y))); g.stroke();
  };
  if (slot > 0) tear(0, 1);
  tear(PX, -1);
  return cv;
}
// The light off a glyph: the same glyph, where the print has it, gold with a wide soft edge
function glyphGlow(glyph) {
  const cv = document.createElement('canvas');
  cv.width = PX; cv.height = PH;
  const g = cv.getContext('2d'), G = glyphAt(PH);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = font(G.px);
  const t = String(glyph || '').slice(0, 2);
  g.shadowColor = 'rgba(255, 170, 60, 1)';
  g.shadowBlur = 46; g.fillStyle = 'rgba(255, 196, 96, 0.55)'; g.fillText(t, PX / 2, G.y);
  g.shadowBlur = 18; g.fillStyle = 'rgba(255, 226, 150, 0.8)'; g.fillText(t, PX / 2, G.y);
  g.shadowBlur = 0; g.fillStyle = 'rgba(255, 248, 225, 0.55)'; g.fillText(t, PX / 2, G.y);
  return cv;
}
// The light along a seam: a gold line, white at its heart, gone soft at both ends
function seamGlow() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 512;
  const g = cv.getContext('2d'), h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(255,160,40,0)'); h.addColorStop(0.36, 'rgba(255,178,64,0.55)'); h.addColorStop(0.5, 'rgba(255,250,228,1)');
  h.addColorStop(0.64, 'rgba(255,178,64,0.55)'); h.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = h; g.fillRect(0, 0, 64, 512);
  g.globalCompositeOperation = 'destination-in';
  const v = g.createLinearGradient(0, 0, 0, 512);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.08, 'rgba(0,0,0,1)'); v.addColorStop(0.92, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = v; g.fillRect(0, 0, 64, 512);
  return cv;
}

// What a set's paint is, kept while its sheets don't change
const cache = new Map();
function artOf(g0) {
  const sig = JSON.stringify(g0.sheets);
  const had = cache.get(g0.set);
  if (had?.sig === sig) return had;
  const print = printOf(g0), art = { sig, print, sheets: new Map(), glows: new Map() };
  for (const s of g0.sheets) { art.sheets.set(s.slot, sheetCanvas(print, s.slot)); art.glows.set(s.slot, glyphGlow(s.glyph)); }
  cache.set(g0.set, art);
  return art;
}
let seamCv = null;

// How far apart, how crooked and how far off line each sheet hangs before the join, metres and radians
function slack(slot) {
  const r = rng(0xa11 + slot * 131);
  return { gap: 0.018 + r() * 0.022, rot: (r() - 0.5) * 0.045, dy: (r() - 0.5) * 0.03 };
}

/**
 * A set's decals on its run, at a point in the join: `j` 0 hung apart, 1 closed up; `joined` draws it as one sheet;
 * `glyphs` (per slot) and `seams` (one number) are how strong the light off them is.
 */
function runDecals(L, run, g0, { j = 0, joined = false, glyphs = null, seams = 0 } = {}) {
  const art = artOf(g0), F = wallFrame(L, run), k = perM(L), out = [];
  const sw = run.sw, sh = run.sh, scale = sw / (SHEET_W * k);
  const quad = (cs, cy, w, h, rot, d) => {
    const c = Math.cos(rot), s = Math.sin(rot), at = (x, y) => F.pt(cs + x * c - y * s, cy + x * s + y * c, d);
    return [at(-w / 2, h / 2), at(w / 2, h / 2), at(w / 2, -h / 2), at(-w / 2, -h / 2)];
  };
  // where each slot hangs: closing up as `j` goes to 1
  const sl = [];
  for (let i = 0; i < g0.of; i++) sl.push(slack(i));
  const pitch = (i) => sl[i].gap * k * scale * (1 - j);
  let total = 0;
  for (let i = 0; i < g0.of; i++) total += sw + (i ? pitch(i) : 0);
  const centres = [];
  let x = -total / 2;
  for (let i = 0; i < g0.of; i++) { if (i) x += pitch(i); centres.push(x + sw / 2); x += sw; }
  const pose = (i) => ({ cs: centres[i], cy: run.y + sl[i].dy * k * (1 - j), rot: sl[i].rot * (1 - j) });
  if (joined) {
    out.push({ key: `sheets:${g0.set}:joined`, src: art.print, quad: quad(0, run.y, sw * g0.of, sh, 0, PROUD * k), n: F.n });
  } else {
    for (const s of g0.sheets) { const p = pose(s.slot); out.push({ key: `sheets:${g0.set}:${s.slot}`, src: art.sheets.get(s.slot), quad: quad(p.cs, p.cy, sw, sh, p.rot, PROUD * k), n: F.n }); }
  }
  for (const s of g0.sheets) {
    const gk = glyphs?.[s.slot] || 0;
    if (gk <= 0.002) continue;
    const p = joined ? { cs: (s.slot - (g0.of - 1) / 2) * sw, cy: run.y, rot: 0 } : pose(s.slot);
    out.push({ key: `sheets:${g0.set}:glow:${s.slot}`, src: art.glows.get(s.slot), quad: quad(p.cs, p.cy, sw, sh, p.rot, GLOW_PROUD * k), n: F.n, glow: gk });
  }
  if (seams > 0.002) {
    seamCv = seamCv || seamGlow();
    for (let i = 1; i < g0.of; i++) {
      const a = pose(i - 1), b = pose(i), cs = (a.cs + sw / 2 + b.cs - sw / 2) / 2;
      out.push({ key: 'sheets:seam', src: seamCv, quad: quad(cs, (a.cy + b.cy) / 2, 0.11 * k * scale, sh * 1.06, (a.rot + b.rot) / 2, GLOW_PROUD * k), n: F.n, glow: seams });
    }
  }
  return out;
}

/** Every set's runs in a room: [{ g, run }] for the sets that have a wall to go on, laid out one after another. */
export function sheetRuns(L, sheets) {
  const taken = [], out = [];
  for (const g of setsOf(sheets)) {
    const run = sheetRun(L, g.of, taken);
    if (!run) continue;
    taken.push({ wall: run.wall, a: run.c - (run.sw * g.of) / 2, b: run.c + (run.sw * g.of) / 2 });
    out.push({ g, run });
  }
  return out;
}

/** The room's sheets as decals, at rest: a whole set in `joined` (a Set of set names) drawn as one, with its gleam. */
export function sheetDecals(L, runs, joined = new Set()) {
  const out = [];
  for (const { g, run } of runs) {
    const one = isWhole(g) && joined.has(g.set);
    out.push(...runDecals(L, run, g, one ? { joined: true, j: 1, glyphs: Object.fromEntries(g.sheets.map((s) => [s.slot, GLEAM])) } : {}));
  }
  return out;
}

// ── the join ──────────────────────────────────────────────────────────────────────────────────────
// Seconds into it: the camera goes to the wall, each glyph lights in turn, the sheets close up under gold seams, the
// seams go and the glyphs settle to their gleam, and the camera comes back to where you were.
const T = { inEnd: 1.6, glyph0: 1.7, glyphStep: 0.42, glyphRise: 0.5, join0: 4.9, join1: 6.4, settle: 7.7, out0: 8.5, end: 10 };

function chime(i, n) {
  // a bell for each glyph, up a pentatonic scale
  const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21], f = 392 * Math.pow(2, steps[Math.min(i, steps.length - 1)] / 12) * (n > 7 ? 0.75 : 1);
  try {
    window.AudioEngine?.playSfx({ id: 'sfx_sheet_glyph', name: 'sfx_sheet_glyph', category: 'sfx', priority: 3, config: { duration: 1.6, layers: [
      { waveform: 'sine', freq: f, adsr: { a: 0.004, d: 1.2, s: 0, r: 0.3 }, gain: 0.22 },
      { waveform: 'sine', freq: f * 2.76, adsr: { a: 0.002, d: 0.35, s: 0, r: 0.1 }, gain: 0.05 },
      { waveform: 'triangle', freq: f / 2, adsr: { a: 0.01, d: 0.9, s: 0, r: 0.3 }, gain: 0.06 },
    ] } }, 0.45);
  } catch { /* the light is the scene; the sound is extra */ }
}
function swell() {
  try {
    window.AudioEngine?.playSfx({ id: 'sfx_sheet_join', name: 'sfx_sheet_join', category: 'sfx', priority: 3, config: { duration: 3.2, layers: [
      { waveform: 'sine', freq: 196, adsr: { a: 1.1, d: 0.6, s: 0.5, r: 1.2 }, gain: 0.16 },
      { waveform: 'sine', freq: 293.7, adsr: { a: 1.2, d: 0.6, s: 0.45, r: 1.2 }, gain: 0.1 },
      { waveform: 'sine', freq: 392, adsr: { a: 1.3, d: 0.5, s: 0.4, r: 1.3 }, gain: 0.08 },
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 6200, q: 3 }, adsr: { a: 1.0, d: 0.8, s: 0.2, r: 1.0 }, gain: 0.03 },
    ] } }, 0.5);
  } catch { /* as chime */ }
}

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * The join, played for a whole set on its run. `seat` is the walker's camera ({ eye, yaw, pitch, fov }), read live so
 * the way back ends where you are; `aspect()` the picture's width over its height. Each frame answers
 * `{ cam, decals, done }`: the camera to draw from and the set's decals as they are this moment. `skip()` ends it.
 */
export function createSheetScene({ L, run, g, seat, aspect = () => 16 / 9, now = 0, sound = true }) {
  const t0 = now, k = perM(L), F = wallFrame(L, run);
  const from = { eye: seat.eye.slice(), yaw: seat.yaw || 0, pitch: seat.pitch || 0, fov: seat.fov || 72 };
  // the shot: square on to the run's middle, far enough back to see all of it, as far as the room allows
  const shot = () => {
    const a = aspect(), half = (run.sw * g.of) / 2 * 1.16, vh = run.sh * 0.9;
    let fov = 62;
    const hfov = (f) => 2 * Math.atan(Math.tan(f * Math.PI / 360) * a);
    let dist = Math.max(half / Math.tan(hfov(fov) / 2), vh / Math.tan(fov * Math.PI / 360));
    const room = run.across - 0.4 * k;
    if (dist > room) {
      dist = room;
      // too close to take it all in: open the lens to fit, up to a point
      const want = 2 * Math.atan(half / dist);
      fov = Math.min(96, Math.max(fov, 2 * Math.atan(Math.tan(want / 2) / a) * 180 / Math.PI));
    }
    const c = F.pt(0, run.y, 0), eye = [c[0] + F.n[0] * dist, c[1] - 0.06 * k, c[2] + F.n[2] * dist];
    return { eye, yaw: Math.atan2(-F.n[0], -F.n[2]), pitch: Math.atan2(c[1] - eye[1], dist), fov };
  };
  const mix = (A, B, x) => ({ eye: A.eye.map((v, i) => v + (B.eye[i] - v) * x), yaw: A.yaw + wrapPi(B.yaw - A.yaw) * x, pitch: A.pitch + (B.pitch - A.pitch) * x, fov: A.fov + (B.fov - A.fov) * x, mode: 'free' });
  let skipped = false, rung = -1, swelled = false;
  return {
    get set() { return g.set; },
    skip() { skipped = true; },
    frame(at) {
      const t = skipped ? T.end : (at - t0) / 1000;
      const S = shot(), here = { eye: seat.eye.slice(), yaw: seat.yaw || 0, pitch: seat.pitch || 0, fov: seat.fov || 72 };
      const cam = t < T.inEnd ? mix(from, S, ease(t / T.inEnd)) : t < T.out0 ? { ...S, mode: 'free' } : mix(S, here, ease((t - T.out0) / (T.end - T.out0)));
      // the glyphs, one after another, then down to their gleam once the seams have gone
      const settle = ease((t - T.join1) / (T.settle - T.join1));
      const glyphs = {};
      g.sheets.forEach((s, i) => {
        const up = ease((t - (T.glyph0 + i * T.glyphStep)) / T.glyphRise);
        glyphs[s.slot] = up * (1.15 + 0.08 * Math.sin(t * 5 + i)) * (1 - settle) + GLEAM * settle;
        if (sound && !skipped && up > 0 && rung < i) { rung = i; chime(i, g.sheets.length); }
      });
      const j = ease((t - T.join0) / (T.join1 - T.join0));
      if (sound && !skipped && j > 0 && !swelled) { swelled = true; swell(); }
      const seams = t < T.join0 ? 0 : t < T.join1 ? 1.5 * ease((t - T.join0) / 0.7) : 1.5 * (1 - ease((t - T.join1) / (T.settle - T.join1)));
      const joined = t >= T.join1;
      return { cam, decals: runDecals(L, run, g, { j, joined, glyphs, seams }), done: t >= T.end, t };
    },
  };
}

export const _sheetsTest = { setsOf, sheetRun, sheetRuns, printOf, T, PX, PH, SHEET_W, SHEET_H };
