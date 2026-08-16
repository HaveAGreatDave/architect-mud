// Flight — LIVERY: the paint model, shared by the server (hangar panel, room
// examine, the AA/ground "conspicuousness" fold) and mirrored by the client panel
// art. Pure and dependency-free so the regress harness can exercise it headless.
//
// The whole scheme lives in aircraft.custom_data.livery (no schema): exterior
// base/trim colour + pattern + finish, and an interior cabin colour + upholstery.
// A craft's PAINT drives one derived signal — how easy it is to spot — that scales
// the anti-air gun solution and the ground/police notice reach: dark + matte +
// camo hides, bright + gloss + hazard shouts. Nothing here reads the DB or DOM.

// ── The model ─────────────────────────────────────────────────────────────────
export const LIVERY_DEFAULT = {
  base: '#5a5f66', trim: '#8a9099', accent: '#c22b8c', ground: '#eee7d6', pattern: 'bare', finish: 'satin',
  decal: 'none', cabin: '#2a2e33', uphol: 'standard', text: '',
};

// Nose art / decals — a cosmetic top layer (does NOT feed the signature).
export const DECALS = [
  { id: 'none',      label: 'None' },
  { id: 'sharkmouth', label: 'Shark Mouth' },
  { id: 'killmarks', label: 'Kill Marks' },
  { id: 'sigil',     label: 'Faction Sigil' },
  { id: 'eye',       label: "Architect's Eye" },
  { id: 'ace',       label: 'Ace of Spades' },
  { id: 'reaper',    label: 'Grim Reaper' },
  { id: 'flames',    label: 'Nose Flames' },
  { id: 'shrike',    label: 'Impaled Shrike' },
];

// Exterior patterns. `sig` is the signature multiplier the pattern contributes
// (1 = neutral; <1 hides, >1 shouts). Camo hides; hazard chevrons shout.
export const PATTERNS = [
  { id: 'bare',     label: 'Bare Metal',      sig: 1.00 },
  { id: 'solid',    label: 'Solid',           sig: 1.00 },
  { id: 'twotone',  label: 'Two-Tone',        sig: 1.00 },
  { id: 'stripes',  label: 'Racing Stripes',  sig: 1.05 },
  { id: 'splinter', label: 'Splinter Camo',   sig: 0.85 },
  { id: 'tiger',    label: 'Tiger Stripe',    sig: 0.90 },
  { id: 'digital',  label: 'Digital Camo',    sig: 0.85 },
  { id: 'checker',  label: 'Checkerboard',    sig: 1.10 },
  { id: 'hazard',   label: 'Hazard Chevrons', sig: 1.15 },
  { id: 'jazz',     label: 'Jazz',            sig: 1.18 },   // Memphis dry-brush splatter — the loudest thing on the ramp
];

// Finish coat — the other signature lever. Matte/weathered kill glare; gloss flares.
export const FINISHES = [
  { id: 'gloss',     label: 'Gloss',     sig: 1.10 },
  { id: 'satin',     label: 'Satin',     sig: 1.00 },
  { id: 'matte',     label: 'Matte',     sig: 0.88 },
  { id: 'weathered', label: 'Weathered', sig: 0.90 },
];

// Interior — purely cosmetic (cockpit accent + examine-once-aboard).
export const UPHOLSTERY = [
  { id: 'standard', label: 'Standard' },
  { id: 'leather',  label: 'Leather' },
  { id: 'quilted',  label: 'Quilted' },
  { id: 'mesh',     label: 'Tactical Mesh' },
];

// One-click curated schemes (all fields at once) shown beside the hex pickers.
export const PRESETS = [
  { id: 'baremetal', label: 'Bare Metal',  base: '#7d838b', trim: '#9aa0a8', pattern: 'bare',     finish: 'satin',     cabin: '#2a2e33', uphol: 'standard' },
  { id: 'nightops',  label: 'Night Ops',   base: '#14171c', trim: '#20242b', pattern: 'solid',    finish: 'matte',     cabin: '#0e1013', uphol: 'mesh' },
  { id: 'hazard',    label: 'Hazard',      base: '#f2b01e', trim: '#1a1a1a', pattern: 'hazard',   finish: 'gloss',     cabin: '#2a2410', uphol: 'standard' },
  { id: 'desert',    label: 'Desert',      base: '#b79a63', trim: '#6d5c38', pattern: 'splinter', finish: 'weathered', cabin: '#3a3324', uphol: 'leather' },
  { id: 'racing',    label: 'Racing Red',  base: '#b81f24', trim: '#e8e8e8', pattern: 'stripes',  finish: 'gloss',     cabin: '#2a1416', uphol: 'leather' },
  { id: 'coldblue',  label: 'Cold Blue',   base: '#274b7a', trim: '#7fb0e0', pattern: 'twotone',  finish: 'satin',     cabin: '#16202e', uphol: 'quilted' },
  { id: 'jazz',      label: 'Jazz Wave',   base: '#18b8c2', trim: '#5a2c9c', accent: '#c22b8c', ground: '#eee7d6', pattern: 'jazz', finish: 'gloss', cabin: '#1a1230', uphol: 'quilted' },
];

const PATTERN_IDS = new Set(PATTERNS.map(p => p.id));
const FINISH_IDS = new Set(FINISHES.map(f => f.id));
const UPHOL_IDS = new Set(UPHOLSTERY.map(u => u.id));
const DECAL_IDS = new Set(DECALS.map(d => d.id));

// ── Colour helpers ────────────────────────────────────────────────────────────
export function isHex(s) { return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s); }
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
// Relative luminance 0..1 (perceptual weights) — drives the brightness signature.
export function luminance(hex) {
  if (!isHex(hex)) return 0.4;
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Named anchors for hex→word in the room examine. Nearest by RGB distance.
const COLOR_NAMES = [
  ['black', '#111214'], ['charcoal', '#33373d'], ['gunmetal', '#5a5f66'], ['silver', '#b9bfc6'], ['white', '#f2f4f6'],
  ['crimson', '#b81f24'], ['red', '#e03030'], ['rust', '#8a3b1e'], ['orange', '#e2701e'], ['amber', '#f2b01e'],
  ['gold', '#c9a227'], ['yellow', '#ece04a'], ['sand', '#c9b072'], ['tan', '#b79a63'], ['olive', '#6d6a34'],
  ['drab', '#565b39'], ['green', '#3a9d4a'], ['teal', '#2f8f8f'], ['sky-blue', '#7fb0e0'], ['blue', '#2f5fb0'],
  ['navy', '#1d2c52'], ['indigo', '#3b3b8f'], ['purple', '#6a3b8f'], ['magenta', '#c03b8f'], ['pink', '#e08ab0'],
  ['brown', '#5a3a22'],
];
export function colorName(hex) {
  if (!isHex(hex)) return 'bare';
  const [r, g, b] = rgb(hex);
  let best = 'grey', bd = Infinity;
  for (const [name, h] of COLOR_NAMES) {
    const [pr, pg, pb] = rgb(h);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

// ── Normalise ─────────────────────────────────────────────────────────────────
// custom_data.livery may be absent, a legacy free-text STRING (the old
// `modify livery <text>`), or the structured object. Always yield a full object.
export function normalizeLivery(cd) {
  const raw = cd && cd.livery;
  if (typeof raw === 'string') return { ...LIVERY_DEFAULT, text: raw.slice(0, 80) };
  if (!raw || typeof raw !== 'object') return { ...LIVERY_DEFAULT };
  return {
    base:    isHex(raw.base) ? raw.base : LIVERY_DEFAULT.base,
    trim:    isHex(raw.trim) ? raw.trim : LIVERY_DEFAULT.trim,
    accent:  isHex(raw.accent) ? raw.accent : LIVERY_DEFAULT.accent,
    ground:  isHex(raw.ground) ? raw.ground : LIVERY_DEFAULT.ground,
    pattern: PATTERN_IDS.has(raw.pattern) ? raw.pattern : LIVERY_DEFAULT.pattern,
    finish:  FINISH_IDS.has(raw.finish) ? raw.finish : LIVERY_DEFAULT.finish,
    decal:   DECAL_IDS.has(raw.decal) ? raw.decal : LIVERY_DEFAULT.decal,
    cabin:   isHex(raw.cabin) ? raw.cabin : LIVERY_DEFAULT.cabin,
    uphol:   UPHOL_IDS.has(raw.uphol) ? raw.uphol : LIVERY_DEFAULT.uphol,
    text:    typeof raw.text === 'string' ? raw.text.slice(0, 80) : '',
  };
}

// Coerce a client-submitted paint patch to clean, in-range fields (used by paintset).
export function sanitizeLivery(patch, prev = LIVERY_DEFAULT) {
  const p = patch || {};
  return {
    base:    isHex(p.base) ? p.base : prev.base,
    trim:    isHex(p.trim) ? p.trim : prev.trim,
    accent:  isHex(p.accent) ? p.accent : (prev.accent || LIVERY_DEFAULT.accent),
    ground:  isHex(p.ground) ? p.ground : (prev.ground || LIVERY_DEFAULT.ground),
    pattern: PATTERN_IDS.has(p.pattern) ? p.pattern : prev.pattern,
    finish:  FINISH_IDS.has(p.finish) ? p.finish : prev.finish,
    decal:   DECAL_IDS.has(p.decal) ? p.decal : (prev.decal || 'none'),
    cabin:   isHex(p.cabin) ? p.cabin : prev.cabin,
    uphol:   UPHOL_IDS.has(p.uphol) ? p.uphol : prev.uphol,
    text:    typeof prev.text === 'string' ? prev.text : '',
  };
}

// Saved paint schemes live at custom_data.livery.schemes = { name: {core fields} }.
// Kept OUT of normalizeLivery so the frequent cockpit HUD payload stays lean; the
// hangar layer reads/writes them directly through these two helpers.
export function readSchemes(cd) {
  const s = cd && cd.livery && cd.livery.schemes;
  return (s && typeof s === 'object') ? s : {};
}
// The core (non-schemes, non-text) fields that make up one saved scheme.
export function schemeOf(livery) {
  const lv = normalizeLivery({ livery });
  return { base: lv.base, trim: lv.trim, accent: lv.accent, ground: lv.ground, pattern: lv.pattern, finish: lv.finish, decal: lv.decal, cabin: lv.cabin, uphol: lv.uphol };
}

// ── Signature / conspicuousness ───────────────────────────────────────────────
const CLAMP_LO = 0.75, CLAMP_HI = 1.25;   // ±25% band (the "meaningful, not dominant" call)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// The paint signature multiplier: brightness × pattern × finish, clamped to ±25%.
// >1 = shouts (easier to spot/hit), <1 = hides.
export function signatureMult(livery) {
  const lv = livery && livery.pattern ? livery : normalizeLivery({ livery });
  const brightness = 0.85 + luminance(lv.base) * 0.30;                 // 0.85 (black) .. 1.15 (white)
  const pat = (PATTERNS.find(p => p.id === lv.pattern) || {}).sig || 1;
  const fin = (FINISHES.find(f => f.id === lv.finish) || {}).sig || 1;
  return clamp(brightness * pat * fin, CLAMP_LO, CLAMP_HI);
}

// A 0..100 LOW↔HIGH readout for the panel's live signature meter.
export function signatureScore(livery) {
  return Math.round(((signatureMult(livery) - CLAMP_LO) / (CLAMP_HI - CLAMP_LO)) * 100);
}

// Fold: a live aircraft's paint-driven conspicuousness multiplier, read straight
// off its row. This is what the noise reach and AA gun solution scale by (the
// airframe's own loudness/size is the base it multiplies).
export function conspicuousnessMult(live) {
  return signatureMult(normalizeLivery(live?.row?.custom_data));
}

// ── Prose (room examine) ──────────────────────────────────────────────────────
const FINISH_ADJ = { gloss: 'glossy', satin: '', matte: 'matte', weathered: 'weathered, sun-faded' };
function trimClause(lv) {
  const c = colorName(lv.trim);
  switch (lv.pattern) {
    case 'solid':    return `a solid ${c} trim`;
    case 'twotone':  return `a two-tone ${c} flank`;
    case 'stripes':  return `${c} racing stripes down the fuselage`;
    case 'splinter': return `${c} splinter camo`;
    case 'tiger':    return `${c} tiger-stripe camo`;
    case 'digital':  return `${c} digital pixel camo`;
    case 'checker':  return `a ${c} checkerboard down the flank`;
    case 'hazard':   return `${c} hazard chevrons`;
    case 'jazz':     return `a wild ${colorName(lv.trim)}-and-${colorName(lv.accent)} jazz splatter`;
    default:         return '';   // bare
  }
}
// The exterior description shown when someone examines the parked craft. Reads the
// livery live, so it changes the instant it's repainted. `text` (the player's own
// hand-written line) is appended if present.
const DECAL_CLAUSE = {
  sharkmouth: 'A shark\'s mouth grins across the nose.',
  killmarks:  'A row of kill marks is stencilled below the cockpit.',
  sigil:      'A faction sigil is painted on the tail.',
  eye:        "The Architect's all-seeing eye stares out from the nose.",
  ace:        'An ace of spades is stencilled below the cockpit.',
  reaper:     "A grinning reaper's skull leers off the nose.",
  flames:     'Hot-rod flames lick back from the nose.',
  // The bird the aeroplane is named after keeps its larder on a thorn bush. Somebody thought
  // that was worth painting on, and they were not wrong.
  shrike:     'A small grey bird is painted on the cowl, holding something on a long thorn.',
};
export function describeExterior(livery, typeName, tail) {
  const lv = normalizeLivery({ livery });
  const name = tail ? `${typeName} "${tail}"` : typeName;
  let body;
  if (lv.pattern === 'bare') {
    const adj = FINISH_ADJ[lv.finish];
    body = `A ${adj ? adj + ' ' : ''}bare-metal ${name} sits here.`;
  } else {
    const adj = FINISH_ADJ[lv.finish];
    const base = colorName(lv.base);
    const clause = trimClause(lv);
    body = `A ${adj ? adj + ' ' : ''}${base} ${name} sits here${clause ? `, ${clause}` : ''}.`;
  }
  if (DECAL_CLAUSE[lv.decal]) body += ` ${DECAL_CLAUSE[lv.decal]}`;
  if (lv.text) body += ` <span class="text-dim">${lv.text}</span>`;
  return body;
}

// Short colour word for the room's "on the ramp" line (bare = no colour word).
export function rampColorWord(livery) {
  const lv = normalizeLivery({ livery });
  return lv.pattern === 'bare' ? '' : colorName(lv.base);
}

// ── Respray fee (scaled by airframe class) ────────────────────────────────────
const PAINT_COST = { ultralight: 80, heli: 180, prop: 150, heavy: 400, gunship: 300 };
export function paintCost(type) { return PAINT_COST[type?.class] ?? 150; }

// A wreck is junk and a rental is temporary — neither is paintable (owner-only).
export function isPaintable(row) { return row && !row.is_wreck && !row.rental; }
