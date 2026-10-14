// Club identity on the client: the crests, kits and tartans a sports league's clubs wear.
//
// The league's content owns every club's look (media_broadcasts.sports_pools.clubs, built
// by scripts/content/build-cphl-clubs.mjs for the CPhL). This file knows nothing about any
// club: it keeps whatever the server last sent, and draws a crest or a sett from data.
// A second game with its own league fills the same shape and gets its own badges.
//
// A crest is layered vector paths in a square box:
//   { box: 100, layers: [{ d, fill, stroke, sw, op }], small: [...] }
// `fill` is a colour, 'none', or 'sett' (the club's tartan). `small` is an optional second
// drawing for small sizes: the full one turns to mush below about 32px, so a club can
// author a simpler mark for the score bug and the jersey.
//
// One source, two outputs: crestSvg() for the broadcast's HTML, paintCrest() for a canvas
// (the jersey atlas, the 2-D figure's decal, centre ice). Both draw the same paths.

const SMALL_BELOW = 34;     // px: under this, a crest with a small drawing uses it

// ── the store ───────────────────────────────────────────────────────────────────
// Per sport, the clubs by name and the revision they came with. The server stamps every
// payload with the revision it holds, so a client that sees one it hasn't got asks again.
const _store = new Map();          // sport -> { rev, clubs }
const _listeners = new Set();
export function setClubs(sport, rev, clubs) {
  if (!sport || !clubs || typeof clubs !== 'object') return;
  _store.set(sport, { rev: String(rev || ''), clubs });
  for (const fn of _listeners) { try { fn(sport); } catch { /* a listener's own problem */ } }
}
export function clubsRev(sport) { return _store.get(sport)?.rev || ''; }
export function clubOf(name, sport = 'hockey') {
  if (!name) return null;
  return _store.get(sport)?.clubs?.[name] || null;
}
export function onClubs(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

// Called with every payload's stamp. Answers true when the caller should ask the server
// for the set (tv_clubs); false when it's held already, is on its way, or was found in
// this browser's storage from an earlier visit. Asks at most once every few seconds per
// sport, so a payload stream can't turn into a request stream.
const _asked = new Map();       // sport -> { rev, at }
const LS_KEY = (sport) => `thomas.clubs.${sport}`;
export function wantClubs(sport, rev) {
  if (!sport || !rev) return false;
  if (clubsRev(sport) === rev) return false;
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY(sport));
    if (raw) {
      const kept = JSON.parse(raw);
      if (kept && kept.rev === rev && kept.clubs) { setClubs(sport, rev, kept.clubs); return false; }
    }
  } catch { /* storage blocked or full: just ask */ }
  const last = _asked.get(sport);
  const now = Date.now();
  if (last && last.rev === rev && now - last.at < 8000) return false;
  _asked.set(sport, { rev, at: now });
  return true;
}
// The server's answer. Kept in memory, and in storage so the next visit needn't ask.
export function receiveClubs(msg) {
  if (!msg || !msg.sport || !msg.clubs) return;
  setClubs(msg.sport, msg.rev, msg.clubs);
  try { globalThis.localStorage?.setItem(LS_KEY(msg.sport), JSON.stringify({ rev: msg.rev, clubs: msg.clubs })); } catch { /* fine without */ }
}

// ── tartan ──────────────────────────────────────────────────────────────────────
// A sett is written the way a weaver's ticket writes it: 'K/4 Y4 K4 G24 ... LB/4', a
// colour code and a thread count per stripe, '/' marking the two pivots the pattern
// mirrors about. Expanded once into the full repeat of [colour, threads].
const _settCache = new Map();
export function settStripes(sett) {
  if (!sett || !sett.threads) return [];
  const key = sett.threads;
  if (_settCache.has(key)) return _settCache.get(key);
  const half = [];
  for (const m of String(sett.threads).matchAll(/([A-Za-z]+)\/?(\d+)/g)) half.push([m[1].toUpperCase(), +m[2]]);
  // symmetric: out to the far pivot and back, each pivot woven once
  const full = half.length > 2 ? [...half, ...half.slice(1, -1).reverse()] : half;
  const out = full.map(([c, n]) => [sett.colours?.[c] || '#808080', n]);
  _settCache.set(key, out);
  return out;
}
export function settThreads(sett) { return settStripes(sett).reduce((a, [, n]) => a + n, 0); }

// One full repeat of the sett on a canvas, `px` pixels per thread. Warp runs down, weft
// across, and the weft is laid over at half strength, which is what a twill shows at a
// distance: every crossing is the mix of its two stripes.
export function settCanvas(sett, px = 0.5) {
  const stripes = settStripes(sett);
  const n = settThreads(sett);
  if (!n || typeof document === 'undefined') return null;
  const size = Math.max(2, Math.round(n * px));
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d');
  if (!c) return null;
  let at = 0;
  for (const [col, t] of stripes) { c.fillStyle = col; c.fillRect(at * px, 0, t * px + 0.5, size); at += t; }
  c.globalAlpha = 0.5; at = 0;
  for (const [col, t] of stripes) { c.fillStyle = col; c.fillRect(0, at * px, size, t * px + 0.5); at += t; }
  c.globalAlpha = 1;
  return cv;
}

// The SVG version of the same repeat, as a <pattern> body in user units.
function settPatternSvg(id, sett, unit) {
  const stripes = settStripes(sett);
  const n = settThreads(sett);
  if (!n) return '';
  const S = n * unit;
  let warp = '', weft = '', at = 0;
  for (const [col, t] of stripes) {
    warp += `<rect x="${(at * unit).toFixed(2)}" y="0" width="${(t * unit + 0.05).toFixed(2)}" height="${S.toFixed(2)}" fill="${col}"/>`;
    weft += `<rect x="0" y="${(at * unit).toFixed(2)}" width="${S.toFixed(2)}" height="${(t * unit + 0.05).toFixed(2)}" fill="${col}"/>`;
    at += t;
  }
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${S.toFixed(2)}" height="${S.toFixed(2)}">${warp}<g opacity="0.5">${weft}</g></pattern>`;
}

// ── drawing a crest ─────────────────────────────────────────────────────────────
function layersFor(crest, px, opts) {
  if (!crest) return [];
  const small = opts?.small ?? (px < SMALL_BELOW);
  return (small && Array.isArray(crest.small) && crest.small.length) ? crest.small : (crest.layers || []);
}
const esc = (s) => String(s).replace(/[<&"]/g, '');
let _uid = 0;

// The crest as inline SVG. `club` is a club identity (it carries the crest and the sett)
// or a bare crest. `size` is a CSS length; a number is taken as px, and picks the drawing.
export function crestSvg(club, size = 24, opts = {}) {
  const crest = club?.crest || club;
  if (!crest || !Array.isArray(crest.layers)) return '';
  const px = typeof size === 'number' ? size : (parseFloat(size) || 24);
  const css = typeof size === 'number' ? `${size}px` : size;
  const box = crest.box || 100;
  const layers = layersFor(crest, px, opts);
  let defs = '', pid = '';
  if (layers.some((l) => l.fill === 'sett') && club?.sett) {
    pid = `cs${(++_uid).toString(36)}`;
    defs = `<defs>${settPatternSvg(pid, club.sett, crest.settUnit || 0.12)}</defs>`;
  }
  let body = '';
  for (const l of layers) {
    if (!l || !l.d) continue;
    const fill = l.fill === 'sett' ? (pid ? `url(#${pid})` : '#555') : (l.fill || 'none');
    body += `<path d="${esc(l.d)}" fill="${esc(fill)}"` +
      (l.stroke ? ` stroke="${esc(l.stroke)}" stroke-width="${+l.sw || 1}" stroke-linejoin="round" stroke-linecap="round"` : '') +
      (l.op != null ? ` opacity="${+l.op}"` : '') +
      (l.rule === 'evenodd' ? ' fill-rule="evenodd"' : '') + '/>';
  }
  const cls = opts.cls ? ` ${esc(opts.cls)}` : '';
  const title = opts.title ? `<title>${esc(opts.title)}</title>` : '';
  return `<svg class="club-crest${cls}" viewBox="0 0 ${box} ${box}" width="${css}" height="${css}" aria-hidden="${opts.title ? 'false' : 'true'}" role="img">${title}${defs}${body}</svg>`;
}

// The crest on a canvas, centred on (cx, cy), `size` px across.
const _paths = new Map();
function pathOf(d) {
  let p = _paths.get(d);
  if (!p) { p = new Path2D(d); _paths.set(d, p); }
  return p;
}
const _settPat = new WeakMap();
export function paintCrest(ctx, club, cx, cy, size, opts = {}) {
  const crest = club?.crest || club;
  if (!ctx || !crest || !Array.isArray(crest.layers) || typeof Path2D === 'undefined') return false;
  const box = crest.box || 100;
  const k = size / box;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(k, k);
  paintLayers(ctx, layersFor(crest, size, opts), club, crest.settUnit || 0.12);
  ctx.restore();
  return true;
}
// Layers ({ d, fill, stroke, sw, op, rule }) in the context's current transform: a crest's, or
// a keeper's mask (gl/arena.js). 'sett' fills with the club's tartan, `unit` user units a thread.
export function paintLayers(ctx, layers, club, unit = 0.12) {
  if (!ctx || !Array.isArray(layers) || typeof Path2D === 'undefined') return false;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const l of layers) {
    if (!l || !l.d) continue;
    const p = pathOf(l.d);
    ctx.globalAlpha = l.op != null ? +l.op : 1;
    if (l.fill && l.fill !== 'none') {
      let fs = l.fill;
      if (fs === 'sett') {
        fs = '#555';
        if (club?.sett) {
          let pat = _settPat.get(club.sett);
          if (pat === undefined) {
            const cv = settCanvas(club.sett, 1);
            pat = cv ? ctx.createPattern(cv, 'repeat') : null;
            _settPat.set(club.sett, pat);
          }
          if (pat) {
            // pattern space is the layers' own units: one thread is `unit` of them
            if (typeof DOMMatrix !== 'undefined') pat.setTransform?.(new DOMMatrix().scale(unit));
            fs = pat;
          }
        }
      }
      ctx.fillStyle = fs;
      ctx.fill(p, l.rule === 'evenodd' ? 'evenodd' : 'nonzero');
    }
    if (l.stroke) { ctx.strokeStyle = l.stroke; ctx.lineWidth = +l.sw || 1; ctx.stroke(p); }
  }
  ctx.restore();
  return true;
}
