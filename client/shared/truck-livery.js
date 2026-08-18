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
export function truckLivery(paint) {
  const p = paint || null;
  if (!p) return {};
  return {
    base: p.base, trim: p.trim, hw: p.hw, deck: p.deck, bright: p.bright, glow: p.glow, glass: p.glass,
    chrome: p.chrome, pattern: `truck:${p.flash || 'none'}`, finish: p.finish || 'gloss', art: p.art || 'none',
  };
}
