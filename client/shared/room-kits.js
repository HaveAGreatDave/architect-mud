// THE STARTING KIT A GENERATED ROOM IS FURNISHED WITH (docs/proposals/model-plan.md, phase 3 "Furnishing"). Pure.
//
// A room laid out from its building's plan has a role (building-plan.js: flat, living, bedroom, bath, shop,
// backroom, lobby, landing, hall, office). Each role has a short list of pieces, and the building's wealth bracket
// (`poor`, `middle`, `rich`) picks the version of each. The generator writes them as ordinary `furniture` rows with
// `flags.gen: true`; the Stage places them by their archetypes as it places any authored piece. A person edits or
// adds to them afterwards, and a re-run replaces only rows still marked `gen`.
//
// Keep the kits short: variety comes from the bracket and the seed, not long lists. Every row here copies the flags
// of a piece already in content/ (Corbett Mansions' flats, Screw It's counter), so nothing new has to be drawn.

export const BRACKETS = ['poor', 'middle', 'rich'];

const bed = { poor: ['the mattress', ['mattress', 'bed']], middle: ['the bed', ['bed', 'bedstead', 'mattress']], rich: ['the double bed', ['bed', 'double bed', 'bedstead']] };
const PIECES = {
  bed: (b) => ({ name: bed[b][0], object_type: 'furniture', flags: { aliases: bed[b][1], interactions: ['lie', 'sit'], look: { arche: 'bed', form: 'bed' } } }),
  wardrobe: () => ({ name: 'the wardrobe', object_type: 'container', flags: { aliases: ['wardrobe', 'closet'], container: 70000, interactions: ['lean'], wardrobe: true } }),
  sink: () => ({ name: 'the kitchen sink', object_type: 'sink', flags: { aliases: ['sink', 'kitchen sink', 'tap'], interactions: ['lean'], water_source: true } }),
  hob: (b) => ({ name: b === 'poor' ? 'the camping stove' : 'the cooker', object_type: 'fixture', power_draw_kw: 0.3, flags: { aliases: b === 'poor' ? ['stove', 'camping stove', 'hob'] : ['cooker', 'hob', 'rings', 'stove', 'oven'], interactions: ['lean'], stove_tier: b === 'rich' ? 'mid' : 'low' } }),
  fridge: () => ({ name: 'the fridge', object_type: 'container', power_draw_kw: 0.1, flags: { aliases: ['fridge', 'refrigerator'], appliance_grade: 'consumer', container: 40000, interactions: ['lean'], preserves: 'refrigerated' } }),
  toilet: () => ({ name: 'the toilet', object_type: 'toilet', flags: {} }),
  basin: () => ({ name: 'the basin', object_type: 'sink', flags: { aliases: ['basin', 'sink', 'taps'], water_source: true } }),
  shower: (b) => ({ name: b === 'rich' ? 'the bath' : 'the shower', object_type: 'shower', flags: { aliases: b === 'rich' ? ['bath', 'bathtub', 'tub'] : ['shower', 'cubicle'] } }),
  counter: () => ({ name: 'the counter', object_type: 'furniture', flags: { aliases: ['counter', 'till'], look: { arche: 'surface', form: 'tradecounter' } } }),
  shelves: () => ({ name: 'the shelves', object_type: 'decoration', flags: { aliases: ['shelves', 'shelving', 'stock'] } }),
};

// role -> bracket -> piece keys
export const KITS = {
  flat: { poor: ['bed', 'sink', 'hob'], middle: ['bed', 'wardrobe', 'sink', 'hob', 'fridge'], rich: ['bed', 'wardrobe', 'sink', 'hob', 'fridge'] },
  living: { poor: ['sink', 'hob'], middle: ['sink', 'hob', 'fridge'], rich: ['sink', 'hob', 'fridge'] },
  bedroom: { poor: ['bed'], middle: ['bed', 'wardrobe'], rich: ['bed', 'wardrobe'] },
  room: { poor: ['bed'], middle: ['bed', 'wardrobe'], rich: ['bed', 'wardrobe'] },
  washroom: { poor: ['toilet', 'basin', 'shower'], middle: ['toilet', 'basin', 'shower'], rich: ['toilet', 'basin', 'shower'] },
  bath: { poor: ['toilet', 'basin'], middle: ['toilet', 'basin', 'shower'], rich: ['toilet', 'basin', 'shower'] },
  shop: { poor: ['counter', 'shelves'], middle: ['counter', 'shelves'], rich: ['counter', 'shelves'] },
  backroom: { poor: ['shelves'], middle: ['shelves'], rich: ['shelves', 'sink'] },
};

// The pieces for a room: [{ key, name, object_type, flags, power_draw_kw? }], each flagged `gen`
export function kitFor(role, bracket) {
  const b = BRACKETS.includes(bracket) ? bracket : 'middle';
  return (KITS[role]?.[b] || []).map((key) => { const p = PIECES[key](b); return { key, ...p, flags: { ...p.flags, gen: true } }; });
}

// The bracket a building takes when its facade doesn't say (`flags.bracket`): from where it stands. Halcyon Fields
// is rich and the slum is poor; elsewhere the street condition falls west to east (regions.street_gradient, bands a
// fifth wide: the core and the middle ring middle, worn middle, unmaintained poor). It's a default to be overridden:
// a doss-house can stand in a good street.
export function bracketOf({ facadeFlags = {}, tileX = null, gradient = null } = {}) {
  if (BRACKETS.includes(facadeFlags.bracket)) return { bracket: facadeFlags.bracket, why: 'flags.bracket' };
  if (facadeFlags.region_id === 'region_halcyon_fields' || facadeFlags.district === 'halcyon_fields') return { bracket: 'rich', why: 'Halcyon Fields' };
  if (gradient?.dirt_districts?.includes(facadeFlags.district)) return { bracket: 'poor', why: `the ${facadeFlags.district} district` };
  if (gradient && Number.isFinite(tileX)) {
    const band = Math.floor(((tileX - gradient.west) * 5) / (gradient.east - gradient.west));
    const names = ['the core', 'the middle ring', 'worn streets', 'unmaintained streets', 'unmaintained streets'];
    const i = Math.max(0, Math.min(4, band));
    return { bracket: i >= 3 ? 'poor' : 'middle', why: `${names[i]} (column ${tileX})` };
  }
  return { bracket: 'middle', why: 'no default applies' };
}

// ── FINISHES: how a generated room is dressed past its furniture ──────────────────────────────────
// A plan names one (`finish`), and every room it lays out gets that finish's tones and `flags.room.decor`
// (gl/room-decor.js and the rooms it calls draw them; nothing here knows a building). Placed in the room's own
// frame from its size, and seeded by its id, so two rooms alike in size aren't dressed alike.
//
//   worn   old but sound: dark timber panelling to the dado, faded paint, a damp patch, a strip of paper
//          peeling, a worn runner on the landings, tiled bathrooms, and a payphone and a rent board in the hall.
//          Nothing broken and no rubbish: it's kept, just not kept up.
const h32 = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const rr = (n) => Math.round(n * 100) / 100;
export const FINISHES = ['worn'];
export function finishFor(style, role, { w, d, h, id }) {
  if (style !== 'worn') return null;
  const R = (k) => h32(`${id}|${k}`), wet = role === 'washroom' || role === 'bath';
  const tone = wet ? { wall: '#b8b4a6', trim: '#5a5248', ceiling: '#c4beb0' } : { wall: '#8a7c66', trim: '#3a2e24', ceiling: '#9a907e', accent: '#5a4a3a' };
  const decor = {};
  if (!wet) decor.walls = { hex: '#4a3a2a', kind: 'walnut', rail: 0.95, trim: '#2a2018', y1: 1.0 };
  // a damp patch near a corner, and in a bigger room another
  const corner = () => [rr((R('du') > 0.5 ? 1 : -1) * (w / 2 - 0.5 - R('dx') * 0.6)), rr(d - 0.6 - R('dv') * Math.min(2, d / 3))];
  decor.damp = [{ at: corner(), r: rr(0.4 + R('dr') * 0.4) }];
  if (w * d > 30) decor.damp.push({ at: [rr(-decor.damp[0].at[0] * 0.6), rr(0.8 + R('d2') * 1.5)], r: 0.35 });
  // paper coming away on one side wall, never in a bathroom
  if (!wet && R('torn') > 0.35) decor.torn = [{ wall: R('tw') > 0.5 ? 'left' : 'right', along: rr(0.6 + R('ta') * (d - 1.2)), y: 1.7, n: 2 + Math.floor(R('tn') * 3), seed: Math.floor(R('ts') * 90) + 1 }];
  if (role === 'landing' || role === 'hall' || role === 'lobby') decor.runner = { hex: '#3a2a24' };
  if (role === 'lobby') {
    // on the side walls by the street door, clear of the back wall's windows and the doors halfway down
    decor.payphone = [{ at: rr(Math.min(1.2, d / 4)), note: true, wall: 'left', y: 1.45 }];
    decor.chalk = [{ at: rr(Math.min(1.5, d / 4)), h: 0.8, title: 'Rent Due', w: 0.7, wall: 'right', y: 1.7 }];
  }
  return { tone, decor, ground: wet ? 'tile' : undefined };
}
