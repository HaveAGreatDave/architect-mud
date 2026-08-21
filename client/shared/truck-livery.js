// A TRUCK'S PAINT, IN THE SHAPE THE RENDERER TAKES — the one conversion, in one place.
//
// What the booth writes down (plugins/trucking/rig.js `sanitizePaint`) and what the model painter
// takes (`liveryPalette` in aircraft3d.js) are two different shapes, and the join between them is
// one word: `flash` is a truck paint job and `pattern` is what `faceWearsTrim` reads, under the
// `truck:` prefix that keeps the fleet's vocabulary from colliding with the airframes' (the fleet
// has a `stripe`, the airframes have `stripes`).
//
// ── WHY IT LIVES IN client/shared ────────────────────────────────────────────
// Three readers, on both sides of the wire, and none of them should own it — the same argument
// cab-trim.js makes for the INSIDE of the same paint job. The cab and the depot panel convert their
// own truck; the SERVER converts everybody else's, because a rig relayed to other drivers and to
// pilots overhead is a contact, and a contact carries a finished livery (plugins/trucking/state.js,
// mirroring flight's own contact shape). It sat in aircraft3d.js — a 7,000-line canvas renderer —
// which the server has no business importing to answer a ten-line question.
//
// A conversion written down in two places is a conversion that is wrong in one of them, and that
// has already happened once here: the cab handed its raw paint straight through, `pat` came out
// 'bare', and every flash in the catalogue rendered as one flat colour on the truck you were
// actually driving, and only on the truck you were actually driving.
//
// No imports, no side effects, no DOM. Null in, `{}` out — a truck nobody has painted wears
// whatever the mesh's own defaults are, exactly as it always did.
// ── AND THE ROAD ON TOP OF IT ────────────────────────────────────────────────
// `grime` (0..1, plugins/trucking/filth.js) is applied HERE, in the same conversion, for exactly
// the argument the header makes about paint: there are four painters — the cab, the depot booth,
// another driver's contact relayed by the server, and a parked box — and a truck that is brown out
// of the windscreen and clean on the depot turntable is the same bug as a flash that only renders
// on the rig you happen to be driving. One conversion, so every renderer inherits the dirt without
// knowing dirt exists.
//
// IT IS A TINT, NOT A TEXTURE. There is no per-facet muck map and there should not be: the models
// are flat-shaded facets and the dust plume in the cab is where the MOTION reads, so what this owes
// the driver is the flank going brown, the badges going quiet, and the chrome dying. Those are all
// colour.
//
// ⚠ IT NEVER REACHES BLACK, and `GRIME_MIX_MAX` is why. Mixing all the way to the muck colour makes
// every truck in the fleet the identical brown at the top of the bar, which deletes the paint job
// the player bought — and the whole point of a wash is that there is something underneath worth
// uncovering. At the cap the base colour is still legible as itself, just badly.
const MUCK = [92, 74, 52];          // dried road brown, the colour everything moves toward
const GLASS_MUCK = [104, 96, 80];   // glass takes a paler film — dust, not mud
const GRIME_MIX_MAX = 0.62;

function hexRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
// Mix toward the muck, and darken slightly as it goes — dirt is not just a hue shift, it eats the
// light off a panel. A colour this cannot parse is passed through untouched rather than defaulted:
// an unreadable value is the renderer's own default talking, and dirtying that would be inventing
// a colour nobody chose.
function soil(hex, k, muck = MUCK) {
  const c = hexRgb(hex);
  if (!c || k <= 0) return hex;
  const t = Math.min(1, k);
  return rgbHex(c.map((v, i) => (v * (1 - t) + muck[i] * t) * (1 - 0.10 * t)));
}

export function truckLivery(paint, grime = 0) {
  const p = paint || null;
  if (!p) return {};
  const g = Math.max(0, Math.min(1, Number.isFinite(grime) ? grime : 0));
  const k = g * GRIME_MIX_MAX;
  return {
    base: soil(p.base, k), trim: soil(p.trim, k), hw: soil(p.hw, k * 0.8), deck: soil(p.deck, k),
    // BRIGHTWORK DIES FASTEST and the glow does not die at all. Polished metal is the first thing
    // a road takes and the last thing a hose gives back, so it soils harder than the paint does —
    // while a lamp is a lamp: its colour is light coming out, not light bouncing off, and muddying
    // it would read as a bulb going out rather than as a dirty truck. What dirt does to a lamp is
    // dim it, which is the `chrome`/`bright` half of this line and not the `glow` half.
    bright: soil(p.bright, k * 1.15), glow: p.glow, glass: soil(p.glass, k * 0.55, GLASS_MUCK),
    chrome: typeof p.chrome === 'number' ? p.chrome * (1 - 0.75 * g) : p.chrome,
    pattern: `truck:${p.flash || 'none'}`,
    // A gloss coat under enough dirt is a matte coat, and the renderer already knows how to draw
    // one — so the finish is DERIVED past the point where a shine could survive rather than being
    // a second thing an author has to keep in step with the muck.
    finish: g > 0.5 ? 'matte' : (p.finish || 'gloss'),
    art: p.art || 'none',
  };
}
