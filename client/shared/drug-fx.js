// ── THE DRUG FX VOCABULARY ───────────────────────────────────────────────────
//
// What a substance does to your SIGHT, named once, in one place, read by the
// server (which decides what you are on) and by the client (which draws it).
//
// There are THREE SURFACES and they are not interchangeable — each one can do a
// thing the other two physically cannot, which is why this is three lists rather
// than one:
//
//   field    the weather-FX canvas over the room pane. STRICTLY ADDITIVE: it is
//            an overlay and cannot distort what is underneath it. Grain, trails,
//            closure, swell, things scuttling.
//   screen   CSS over the whole client. The only surface that can warp the TEXT
//            and the UI — blur, ghosted duplicates, letter crawl, a vignette
//            that closes over everything rather than over one pane.
//   window   the flight/cab canvas warp (flight-drugfx.js). The only surface
//            that can bend the 3-D world out of the windscreen.
//
// ⚠ A name in the wrong list renders NOTHING AT ALL and looks exactly like
// "nobody wanted an effect here" — the failure mode that shipped `fx: ''` on a
// dream template and went unnoticed for months. `scripts/shapes/weatherfx-smoke.mjs`
// executes every `field` name and `scripts/shapes/drugfx-smoke.mjs` pins the rest,
// so a typo is a push failure rather than an invisible one.
//
// ⚠ NO STROBE, EVER. A hard light flicker is a photosensitive-seizure risk and
// no amount of "but it would look like amphetamine" is worth it. Every effect
// here modulates on a curve slow enough to read as breathing, and every one of
// them is switched off by prefers-reduced-motion in ONE place (styles.css).

// ── field ────────────────────────────────────────────────────────────────────
// Weather falls from somewhere and leaves at an edge. A symptom is already
// behind the eye: seeded across the pane, recycling in place.
export const WEATHER_FX = ['rain', 'snow', 'ash', 'fog', 'wind'];

export const FIELD_FX = [
  'static',    // TV grain that re-rolls rather than moves
  'tunnel',    // peripheral closure, breathing
  'tracers',   // bright points dragging their own recent past
  'bloom',     // light sources swelling and subsiding
  'crawl',     // a lattice that will not sit still
  'swim',      // broad soft bands sliding at their own rate
  'fractal',   // geometry growing out of the centre and folding back
  'shimmer',   // vertical heat-haze wavering
  'spiders',   // small dark forms scuttling at the edge of sight
  'glitter',   // sharp pinpricks that pop and are gone
  'smear',     // long horizontal light-streaks stretching away
  'veins',     // dark branching filaments creeping in from the corners
  'embers',    // slow motes rising through the room
  'pulse',     // the whole field beating with something that isn't the room
];

// Back-compat alias: weather-fx.js exported this name before the vocabulary
// moved out of it, and the dream-template validators read it.
export const DRUG_FX = FIELD_FX;
export const ALL_FX = ['none', ...WEATHER_FX, ...FIELD_FX];

// ── screen ───────────────────────────────────────────────────────────────────
// Each becomes a `dfx-<name>` class on <body>. The CSS lives in styles.css under
// one `prefers-reduced-motion` block, so motion sensitivity is honoured for all
// of them at once and no renderer has to remember.
export const SCREEN_FX = [
  'breathe',  // the view scales in and out, slowly
  'sway',     // it lolls — a drunk's roll and drift
  'blur',     // focus swims; you cannot quite fix your eyes on it
  'double',   // ghosted duplicates offset off every line of text
  'melt',     // letters crawl: spacing and skew wander per word
  'narrow',   // tunnel vision over the WHOLE client, not one pane
  'jitter',   // micro-shake, too fast to be a sway and too small to read as one
  'halo',     // text wears a bloom it has not earned
  'desat',    // the colour drains out
  'oversat',  // the colour screams
];

// ── window ───────────────────────────────────────────────────────────────────
// Profiles understood by flight-drugfx.js. A name not in this list falls back to
// 'psychedelic', which is why the list is asserted rather than assumed.
export const WINDOW_PROFILES = [
  'psychedelic',   // breathing, melting, colour cycling
  'drunk',         // sway, focus swim, closing warm tunnel
  'dissociative',  // drift, distance wrong, colour gone
  'opiate',        // heavy, slow, narrowing, warm
  'stimulant',     // over-sharp, jittery, too much contrast
  'deliriant',     // murky, something moving at the edge
];

// Palette → base hue, used by the trip overlay and the log's [trip] text.
export const PALETTES = {
  green: 120, purple: 280, red: 0, gold: 45,
  cyan: 190, magenta: 320, blue: 220, amber: 32, bone: 40,
};

// ── THE DEFAULT SIGNATURE, DERIVED FROM THE FAMILY ───────────────────────────
//
// Authored per drug it would be 39 hand-written FX blocks — 39 chances for a
// psychedelic to look like a downer because somebody copied the wrong row. The
// family is already on every psychoactive and IS the axis this depends on, so
// the table is a LAW and the per-row `effects.fx` block is the exception, which
// is the same shape `SKIN_PERMEABILITY` already uses in engine/drugs.js.
//
// Each family declares a THREE-ACT ARC rather than one look, because the phase
// engine already walks come-up → peak → comedown and a drug whose visuals do
// not move through that arc is a drug with one slide. Nothing is authored to get
// that: a substance with a family has a visual story the moment it exists.
export const FX_BY_FAMILY = {
  psychedelic: {
    palette: 'magenta', window: 'psychedelic',
    comeup:   { field: 'shimmer', screen: ['breathe'] },
    peak:     { field: 'fractal', screen: ['breathe', 'melt', 'oversat'] },
    comedown: { field: 'bloom',   screen: ['melt'] },
  },
  dissociative: {
    palette: 'blue', window: 'dissociative',
    comeup:   { field: 'smear',  screen: ['blur'] },
    peak:     { field: 'tunnel', screen: ['narrow', 'desat', 'blur'] },
    comedown: { field: 'swim',   screen: ['desat'] },
  },
  deliriant: {
    palette: 'green', window: 'deliriant',
    comeup:   { field: 'shimmer', screen: ['jitter'] },
    peak:     { field: 'spiders', screen: ['jitter', 'desat'] },
    comedown: { field: 'crawl',   screen: ['blur'] },
  },
  stimulant: {
    palette: 'gold', window: 'stimulant',
    comeup:   { field: 'glitter', screen: ['halo'] },
    peak:     { field: 'pulse',   screen: ['jitter', 'oversat', 'halo'] },
    comedown: { field: 'static',  screen: ['desat', 'jitter'] },
  },
  depressant: {
    palette: 'blue', window: 'drunk',
    comeup:   { field: 'swim',   screen: ['sway'] },
    peak:     { field: 'swim',   screen: ['sway', 'blur', 'double'] },
    comedown: { field: 'tunnel', screen: ['blur', 'desat'] },
  },
  opioid: {
    palette: 'purple', window: 'opiate',
    comeup:   { field: 'bloom',  screen: ['blur'] },
    peak:     { field: 'veins',  screen: ['narrow', 'blur'] },
    comedown: { field: 'tunnel', screen: ['desat', 'narrow'] },
  },
  cannabis: {
    palette: 'gold', window: 'psychedelic',
    comeup:   { field: 'embers', screen: [] },
    peak:     { field: 'bloom',  screen: ['breathe'] },
    comedown: { field: 'embers', screen: [] },
  },
  nootropic: {
    palette: 'cyan', window: 'stimulant',
    comeup:   { field: 'static',  screen: [] },
    peak:     { field: 'static',  screen: ['halo'] },
    comedown: { field: 'shimmer', screen: ['desat'] },
  },
};

// A drug with no family but a class still pulls the same way on the same
// receptors, so it gets the class's look. Anything with neither gets nothing —
// coffee and a cigarette are deliberately invisible from the inside too.
export const FX_BY_CLASS = {
  stimulant:  FX_BY_FAMILY.stimulant,
  depressant: FX_BY_FAMILY.depressant,
};

// How hard each act of the arc pushes. A come-up you can already see everything
// through is not a come-up; a comedown at full strength never ends.
export const PHASE_SCALE = { comeup: 0.4, peak: 1, comedown: 0.55 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The FX descriptor for one drug in one phase, or null when nothing shows.
 *
 * PURE, and shared by the server (which sends it) and the smoke suites (which
 * pin it). `drug` is the drugs row; `phase` is 'comeup' | 'peak' | 'comedown'.
 *
 * Resolution order, narrowest first:
 *   effects.fx.phases[phase]   — this drug, this act
 *   effects.fx                 — this drug, every act
 *   FX_BY_FAMILY / FX_BY_CLASS — the law
 *
 * ⚠ A `phantom` hallucination returns null and MUST. The deliriant trips whose
 * whole illusion is that there is no drug — fake people walk into your real room
 * and behave — are ruined by a screen that announces you are high. plugins/trip
 * has always suppressed the client treatment for that mode; this is the same
 * rule at the other end, so an author cannot re-open the hole with an `fx` block.
 */
export function resolveDrugFx(drug, phase, potency = 1) {
  const eff = drug?.effects || {};
  if (eff.hallucination?.mode === 'phantom') return null;

  const authored = eff.fx || {};
  if (authored.none) return null;

  const family = drug?.flags?.drug_family;
  const law = FX_BY_FAMILY[family] || FX_BY_CLASS[drug?.flags?.drug_class] || null;
  const act = authored.phases?.[phase] || {};
  const lawAct = law?.[phase] || {};

  const field = act.field ?? authored.field ?? lawAct.field ?? null;
  const screen = act.screen ?? authored.screen ?? lawAct.screen ?? [];
  const window_ = act.window ?? authored.window ?? eff.hallucination?.fx_profile ?? law?.window ?? null;
  const palette = act.palette ?? authored.palette ?? eff.hallucination?.palette ?? law?.palette ?? null;

  if (!field && !screen.length && !window_) return null;

  // Authored intensity is the drug's own ceiling; the phase scale is the arc;
  // potency is tolerance and dose strength already worked out by useDrug. All
  // three multiply, so a saturated user's fourth pill of the day genuinely looks
  // fainter than their first — the same number that dulls the buff dulls the view.
  const base = act.intensity ?? authored.intensity ?? eff.hallucination?.intensity ?? 0.6;
  const intensity = clamp01(base * (PHASE_SCALE[phase] ?? 1) * clamp01(potency));
  if (intensity < 0.02) return null;

  return {
    field,
    fieldIntensity: intensity,
    screen: screen.filter(s => SCREEN_FX.includes(s)),
    profile: WINDOW_PROFILES.includes(window_) ? window_ : (window_ ? 'psychedelic' : null),
    palette,
    intensity,
  };
}

// ⚠ THE DEV PANEL IS NOT AN ESM APP. Its panels are classic `<script>` files
// talking to each other through globals, so the drug editor cannot `import`
// this — and an editor that hand-typed the symptom names would be the exact
// silent-typo surface the rest of this file exists to close. One assignment,
// loaded there by `<script type="module" src="/shared/drug-fx.js">`, and
// harmless everywhere else.
if (typeof window !== 'undefined') {
  window.DrugFX = { FIELD_FX, SCREEN_FX, WINDOW_PROFILES, PALETTES, PHASE_SCALE, FX_BY_FAMILY, FX_BY_CLASS, resolveDrugFx, unknownFxNames };
}

/** Every FX name an `effects.fx` block names that no renderer knows about. */
export function unknownFxNames(fx) {
  if (!fx || typeof fx !== 'object') return [];
  const bad = [];
  const checkAct = (a, where) => {
    if (!a || typeof a !== 'object') return;
    if (a.field && !FIELD_FX.includes(a.field)) bad.push(`${where}.field=${a.field}`);
    for (const s of a.screen || []) if (!SCREEN_FX.includes(s)) bad.push(`${where}.screen=${s}`);
    if (a.window && !WINDOW_PROFILES.includes(a.window)) bad.push(`${where}.window=${a.window}`);
    if (a.palette && !(a.palette in PALETTES)) bad.push(`${where}.palette=${a.palette}`);
  };
  checkAct(fx, 'fx');
  for (const [k, v] of Object.entries(fx.phases || {})) {
    if (!(k in PHASE_SCALE)) { bad.push(`fx.phases.${k}`); continue; }
    checkAct(v, `fx.phases.${k}`);
  }
  return bad;
}
