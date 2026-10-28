// KITCHEN MATTER: what a food looks like, how it takes a blade and how it shows the heat.
//
// The Kitchen Stage (docs/proposals/kitchen-stage.md) draws food from this table, and the server
// reads the same numbers to set how hard a cut is. One entry per cooking profile class
// (plugins/cooking/profiles.js); an item corrects its class through `tags.matter`, which
// `matterFor` merges over the default one key deep. So a new ingredient is an item row, and a row
// that looks wrong gets a `tags.matter` with only the keys that differ.
//
// ⚠ COLOUR MOVES ON A BEAT, NEVER A CLOCK. `ramp` is one lit colour per cook beat, and the beat is
// the server's phase and stage (`beatOf`). Interpolating between beats would draw a countdown, and
// when to plate is the biggest quality lever in the kitchen; the workspace HUD withholds it for the
// same reason (plugins/cooking/workspace.js).
//
// ⚠ NO WALL CLOCK AND NO DOM. Pure data and pure functions, imported by the server, the client and
// scripts/shapes/kitchen-smoke.mjs.
//
// Units: centimetres. `form.w` runs along the food (the axis a knife crosses), `form.d` across it,
// `form.h` up.

export const FORMS = ['slab', 'log', 'sphere', 'leaf', 'grain', 'liquid', 'cluster', 'block'];
export const BEATS = ['raw', 'cook', 'peak', 'over', 'burnt'];
export const GRAINS = ['none', 'fibre', 'layers'];
export const STYLES = ['slice'];
export const BROWNING = ['maillard', 'caramel', 'set', 'wilt', 'melt', 'none'];
export const EMITTERS = ['sizzle', 'steam', 'bubble', 'spatter', 'smoke'];
export const TOSSES = ['flip', 'stir'];
export const STACKS = ['flat', 'lean', 'pile', 'pool'];
// What a food comes in when it stands on the counter (`look.pack`). In a pan it's the food again.
export const PACKS = ['jar', 'bottle', 'tin', 'sack', 'pouch', 'carton', 'tub', 'shaker', 'box', 'tube', 'wrap'];
const LOOK_COLOURS = ['skin', 'spots', 'stem', 'fins', 'stripes', 'label', 'flesh'];

// The keys a `tags.matter` may carry, each with its own keys. content:lint fails any other.
export const MATTER_KEYS = {
  form: ['kind', 'w', 'd', 'h', 'round'],
  ramp: BEATS,
  cut: ['firmness', 'grain', 'styles', 'juice'],
  cook: ['browning', 'shrink', 'emit', 'gloss', 'toss'],
  plate: ['stack', 'sauce'],
  // How a whole food differs from its class blob, all optional: `skin` the outside while raw,
  // `spots` speckles, `stem` a stalk, `fins` a fish's tail and back fin, `stripes` bands across,
  // `flesh` the cut face, `pack` and `label` its packaging on the counter, `size` that pack's scale.
  look: [...LOOK_COLOURS, 'pack', 'size'],
};

const ramp = (raw, cook, peak, over, burnt) => ({ raw, cook, peak, over, burnt });

export const MATTER = {
  dense_meat: {
    form: { kind: 'slab', w: 12, d: 8, h: 3, round: 0.35 },
    ramp: ramp('#c8545a', '#b0705a', '#8a4b2a', '#5e3320', '#2a1a14'),
    cut: { firmness: 0.7, grain: 'fibre', styles: ['slice'], juice: 0.4 },
    cook: { browning: 'maillard', shrink: 0.2, emit: ['sizzle', 'spatter'], gloss: 0.5, toss: 'flip' },
    plate: { stack: 'lean', sauce: true },
  },
  starchy_vegetable: {
    form: { kind: 'log', w: 10, d: 6, h: 5, round: 0.8 },
    ramp: ramp('#e8d6a0', '#e6c27a', '#d9a24a', '#a8722e', '#3a2a1a'),
    cut: { firmness: 0.8, grain: 'none', styles: ['slice'], juice: 0.1 },
    cook: { browning: 'caramel', shrink: 0.05, emit: ['sizzle', 'steam'], gloss: 0.2, toss: 'flip' },
    plate: { stack: 'pile', sauce: false },
  },
  dry_starch: {
    form: { kind: 'grain', w: 8, d: 8, h: 2, round: 1 },
    ramp: ramp('#efe6cf', '#f2ead6', '#f6f0e0', '#e0d2b0', '#6a5638'),
    cut: { firmness: 0.2, grain: 'none', styles: [], juice: 0 },
    cook: { browning: 'none', shrink: -0.4, emit: ['bubble', 'steam'], gloss: 0.3, toss: 'stir' },
    plate: { stack: 'pile', sauce: true },
  },
  soft_vegetable: {
    form: { kind: 'sphere', w: 7, d: 7, h: 6, round: 1 },
    ramp: ramp('#d8443a', '#cf4a34', '#b8462c', '#8a3a24', '#2e1a14'),
    cut: { firmness: 0.3, grain: 'layers', styles: ['slice'], juice: 0.8 },
    cook: { browning: 'wilt', shrink: 0.3, emit: ['sizzle', 'steam'], gloss: 0.6, toss: 'flip' },
    plate: { stack: 'flat', sauce: false },
  },
  liquid: {
    form: { kind: 'liquid', w: 14, d: 14, h: 4, round: 1 },
    ramp: ramp('#c9a46a', '#c49456', '#b4803e', '#8c5a2a', '#3a2414'),
    cut: { firmness: 0, grain: 'none', styles: [], juice: 1 },
    cook: { browning: 'none', shrink: 0.15, emit: ['bubble', 'steam'], gloss: 0.8, toss: 'stir' },
    plate: { stack: 'pool', sauce: false },
  },
  fruit: {
    form: { kind: 'sphere', w: 8, d: 8, h: 8, round: 1 },
    ramp: ramp('#e0b040', '#dca03a', '#c9822e', '#9a5a22', '#341c10'),
    cut: { firmness: 0.45, grain: 'none', styles: ['slice'], juice: 0.7 },
    cook: { browning: 'caramel', shrink: 0.2, emit: ['sizzle'], gloss: 0.7, toss: 'flip' },
    plate: { stack: 'lean', sauce: true },
  },
  egg: {
    form: { kind: 'sphere', w: 5, d: 4, h: 4, round: 1 },
    ramp: ramp('#f4efe2', '#f6f2ea', '#fbf7ee', '#e8d8b8', '#5a4228'),
    cut: { firmness: 0.25, grain: 'none', styles: ['slice'], juice: 0.5 },
    cook: { browning: 'set', shrink: 0, emit: ['sizzle', 'spatter'], gloss: 0.5, toss: 'flip' },
    plate: { stack: 'flat', sauce: false },
  },
  preserved: {
    form: { kind: 'block', w: 9, d: 6, h: 5, round: 0.2 },
    ramp: ramp('#b8604a', '#b0604a', '#a0583e', '#7a4430', '#2e1c14'),
    cut: { firmness: 0.6, grain: 'none', styles: ['slice'], juice: 0.2 },
    cook: { browning: 'maillard', shrink: 0.05, emit: ['sizzle'], gloss: 0.4, toss: 'flip' },
    plate: { stack: 'lean', sauce: false },
  },
  fat_or_oil: {
    form: { kind: 'liquid', w: 6, d: 6, h: 0.5, round: 1 },
    ramp: ramp('#e8d070', '#e8c860', '#e0b850', '#c09040', '#4a3418'),
    cut: { firmness: 0, grain: 'none', styles: [], juice: 1 },
    cook: { browning: 'none', shrink: 0, emit: ['sizzle', 'smoke'], gloss: 1, toss: 'stir' },
    plate: { stack: 'pool', sauce: false },
  },
  aromatic: {
    form: { kind: 'cluster', w: 4, d: 3, h: 3, round: 0.9 },
    ramp: ramp('#f0e8d8', '#ecdcb8', '#d8b878', '#a87a40', '#2e2014'),
    cut: { firmness: 0.4, grain: 'layers', styles: ['slice'], juice: 0.3 },
    cook: { browning: 'caramel', shrink: 0.3, emit: ['sizzle'], gloss: 0.4, toss: 'stir' },
    plate: { stack: 'flat', sauce: false },
  },
  bread: {
    form: { kind: 'block', w: 14, d: 9, h: 7, round: 0.5 },
    ramp: ramp('#ecd8a8', '#e4c488', '#cc9a50', '#9a6a30', '#2a1c12'),
    cut: { firmness: 0.35, grain: 'none', styles: ['slice'], juice: 0 },
    cook: { browning: 'maillard', shrink: 0, emit: ['smoke'], gloss: 0.1, toss: 'flip' },
    plate: { stack: 'lean', sauce: false },
  },
  dairy: {
    form: { kind: 'block', w: 7, d: 5, h: 3, round: 0.3 },
    ramp: ramp('#f2dc8a', '#f0d070', '#e8b850', '#c08a34', '#3a2a14'),
    cut: { firmness: 0.4, grain: 'none', styles: ['slice'], juice: 0.1 },
    cook: { browning: 'melt', shrink: 0.1, emit: ['bubble'], gloss: 0.8, toss: 'stir' },
    plate: { stack: 'flat', sauce: true },
  },
  batter: {
    form: { kind: 'liquid', w: 12, d: 12, h: 1, round: 1 },
    ramp: ramp('#f2e2b0', '#eed49a', '#d8a860', '#a8743a', '#2e1e12'),
    cut: { firmness: 0, grain: 'none', styles: [], juice: 0.6 },
    cook: { browning: 'maillard', shrink: 0, emit: ['bubble', 'sizzle'], gloss: 0.3, toss: 'flip' },
    plate: { stack: 'flat', sauce: true },
  },
};

// Food with no profile class (plain `needs_cooking`) still has to be drawn as something.
export const PLAIN = MATTER.starchy_vegetable;

// The class default with an item's `tags.matter` laid over it, one key deep. Unknown keys in the
// override are ignored here and failed by content:lint, so a typo shows up in the build rather
// than as a food that quietly keeps its class look.
export function matterFor(profile, override = null) {
  const base = MATTER[profile] || PLAIN;
  if (!override || typeof override !== 'object') return base;
  const out = {};
  for (const k of Object.keys(MATTER_KEYS)) {
    const o = override[k];
    out[k] = o && typeof o === 'object' && !Array.isArray(o) ? { ...base[k], ...pick(o, MATTER_KEYS[k]) } : base[k];
  }
  return out;
}
function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

// The problems with a `tags.matter`, as sentences. Empty when it's fine. content:lint calls this.
export function matterProblems(m) {
  if (m == null) return [];
  if (typeof m !== 'object' || Array.isArray(m)) return ['tags.matter must be an object'];
  const out = [];
  for (const [k, v] of Object.entries(m)) {
    if (!MATTER_KEYS[k]) { out.push(`tags.matter.${k} is not a matter key (${Object.keys(MATTER_KEYS).join(', ')})`); continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { out.push(`tags.matter.${k} must be an object`); continue; }
    for (const kk of Object.keys(v)) if (!MATTER_KEYS[k].includes(kk)) out.push(`tags.matter.${k}.${kk} is not a ${k} key (${MATTER_KEYS[k].join(', ')})`);
  }
  if (m.form?.kind != null && !FORMS.includes(m.form.kind)) out.push(`tags.matter.form.kind "${m.form.kind}" is not one of ${FORMS.join(', ')}`);
  if (m.cut?.grain != null && !GRAINS.includes(m.cut.grain)) out.push(`tags.matter.cut.grain "${m.cut.grain}" is not one of ${GRAINS.join(', ')}`);
  if (m.cook?.browning != null && !BROWNING.includes(m.cook.browning)) out.push(`tags.matter.cook.browning "${m.cook.browning}" is not one of ${BROWNING.join(', ')}`);
  if (m.plate?.stack != null && !STACKS.includes(m.plate.stack)) out.push(`tags.matter.plate.stack "${m.plate.stack}" is not one of ${STACKS.join(', ')}`);
  for (const e of m.cook?.emit || []) if (!EMITTERS.includes(e)) out.push(`tags.matter.cook.emit "${e}" is not one of ${EMITTERS.join(', ')}`);
  for (const k of LOOK_COLOURS) if (m.look?.[k] != null && !/^#[0-9a-f]{6}$/i.test(m.look[k])) out.push(`tags.matter.look.${k} must be a #rrggbb colour`);
  if (m.look?.pack != null && !PACKS.includes(m.look.pack)) out.push(`tags.matter.look.pack "${m.look.pack}" is not one of ${PACKS.join(', ')}`);
  if (m.look?.size != null && !(m.look.size > 0 && m.look.size <= 4)) out.push('tags.matter.look.size must be a number above 0 and at most 4');
  for (const b of Object.keys(m.ramp || {})) if (!/^#[0-9a-f]{6}$/i.test(m.ramp[b])) out.push(`tags.matter.ramp.${b} must be a #rrggbb colour`);
  return out;
}

// Which colour a food shows, from the workspace payload's `cook` block (plugins/cooking/workspace.js
// `component`). Phase and stage only: see the header.
export function beatOf(cook, cooked = false) {
  if (!cook) return cooked ? 'peak' : 'raw';
  switch (cook.phase) {
    case 'thaw': return 'raw';
    case 'window': return 'peak';
    case 'over': return 'over';
    case 'burnt': return 'burnt';
    default: {
      const s = Number(cook.stage) || 0, n = Number(cook.stages) || 1;
      return s * 2 > n ? 'cook' : 'raw';
    }
  }
}

// How hard a cut is, 0..1: firm food drags the blade, wet food slides under it, and grain gives
// the knife a line to follow or fight. The server sends it with the knife game; the client sizes
// the guides and the drag from it.
export function cutDifficulty(m) {
  const c = m?.cut || PLAIN.cut;
  const grain = c.grain === 'fibre' ? 0.15 : c.grain === 'layers' ? 0.1 : 0;
  return Math.max(0, Math.min(1, 0.25 + 0.4 * (c.firmness ?? 0.5) + 0.2 * (c.juice ?? 0) + grain));
}

// Whether a food can go on the board at all. Liquids and grains have no `styles`.
export const cuttable = (m) => (m?.cut?.styles || []).length > 0;
