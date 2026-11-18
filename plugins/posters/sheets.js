// The hero posters as ROOM draws them: one sheet each, a slice of the print run they were torn from.
//
// `roomSheets(rows)` answers the `room.sheets` gather (plugins/roomstage) for the furniture rows in a room: every
// hero poster hanging there as `{ id, set, slot, of, glyph, title, sub, line, ground, ink, accent, pose, seam?, art }`.
// `art` is the painted print ROOM cuts the sheet from; the rest is what ROOM paints one from when there's no art.
// ROOM knows nothing about these posters. It hangs a set's sheets edge to edge in slot order and, with every slot
// present, plays the join (client/game/js/panels/room-sheets.js). So the word, the order and how each sheet is printed
// are all here.
//
// ⚠ A LEAF: no server imports, so the Room Lab can import it to hang the run with no server.

// The wall order. Seven sheets torn from one print run: hung left to right in this sequence, the letter each one
// carries spells the word below. Djerk is the left-hand sheet (its outer edge is the only clean margin).
export const MURAL = ['djerk', 'alphagunman', 'ocelot', 'cyd', 'kiyo', 'stabbz', 'bonghitz'];
export const MURAL_WORD = 'HELLMOO';

// How each sheet is printed: its ground, its ink, the colour its hero is edged in, the slogan along the foot and the
// pose its hero is drawn in (room-sheets.js POSES). `seam` is lettering printed across the sheet's right-hand tear,
// half on this sheet and half on the next: the GRU that Kiyo and Cyd were printed round.
const PRINT = {
  djerk: { ground: '#b8372a', ink: '#1b1012', accent: '#f4d27a', pose: 'shout', line: 'DJERK SAID IT ONCE.' },
  alphagunman: { ground: '#2c5875', ink: '#0f1820', accent: '#f1c35e', pose: 'rifle', line: 'NEVER FIRED FIRST.' },
  ocelot: { ground: '#3a4a2e', ink: '#101409', accent: '#d9e08a', pose: 'hood', line: 'THE STREET NEVER SLEEPS ALONE.' },
  cyd: { ground: '#d27028', ink: '#22120a', accent: '#ffe08a', pose: 'helmet', line: 'PUTS IT DOWN WHERE YOU ARE.', seam: 'GRU' },
  kiyo: { ground: '#2a6b63', ink: '#0b1c1a', accent: '#bff0e0', pose: 'down', line: "KIYO DIDN'T LOOK UP." },
  stabbz: { ground: '#782242', ink: '#1c0710', accent: '#f6c7a0', pose: 'blade', line: 'ONLY WHAT NEEDS CUTTING.' },
  bonghitz: { ground: '#583c84', ink: '#150d22', accent: '#d8c2ff', pose: 'smoke', line: 'HE INHALED YOUR FEAR.' },
};

// The print itself: client/game/assets/posters/hellmoo.webp, the seven panels side by side with no lettering, and
// hellmoo-letters.webp, the gold HELLMOO that goes over it once the run has joined (scripts/posters/bake.mjs). `cols`
// are where the divider strips are, so panel i is cols[i]..cols[i + 1]; a sheet on its own is cut `inset` pixels inside
// the strips either side of it.
const ART = Object.freeze({ src: 'hellmoo', w: 1024, h: 559, cols: [0, 188.5, 327, 466, 605.5, 744, 883, 1024], inset: 5, height: 1.2 });

// "hero poster: CYD, THE ONE WHO COMES BACK" -> ['CYD', 'THE ONE WHO COMES BACK']
function titleOf(name, key) {
  const s = String(name || '').replace(/^hero poster:\s*/i, '');
  const i = s.indexOf(',');
  return i < 0 ? [s || key.toUpperCase(), ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
}

const isHero = (f) => f?.object_type === 'decoration' && String(f.flags?.hero_poster) === 'true';

/** One hung poster as a sheet, or null if it isn't one of the run. */
export function sheetOf(f) {
  const key = f?.flags?.poster_key, slot = MURAL.indexOf(key);
  if (!isHero(f) || slot < 0) return null;
  const [title, sub] = titleOf(f.name, key), p = PRINT[key];
  const spot = spotOf(f.flags?.sheet_spot);
  return { id: f.id, set: 'hellmoo', slot, of: MURAL.length, glyph: MURAL_WORD[slot], title, sub, line: p.line, ground: p.ground, ink: p.ink, accent: p.accent, pose: p.pose, ...(p.seam ? { seam: p.seam } : {}), ...(spot ? { spot } : {}), art: ART };
}

// Where the owner put the run: `{ wall, along? }`, the wall it hangs on and, if they slid it in the arrange mode, where
// its middle is along that wall in the room's own units (metres in a flat). No along: the clearest stretch of that wall. No spot: ROOM picks the wall.
export const SHEET_WALLS = ['left', 'right', 'front', 'back'];
export function spotOf(v) {
  let o = v;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  if (!o || !SHEET_WALLS.includes(o.wall)) return null;
  const along = Number(o.along);
  return o.along != null && Number.isFinite(along) ? { wall: o.wall, along: Math.round(along * 100) / 100 } : { wall: o.wall };
}

/** A carried poster as the sheet it would hang as (the arrange mode's Posters menu), or null. */
export function carriedSheet(key, name) {
  return sheetOf({ id: '', object_type: 'decoration', name, flags: { hero_poster: true, poster_key: key } });
}

/** The sheets hanging among a room's furniture rows, one per slot, in slot order. */
export function roomSheets(rows) {
  const out = new Map();
  for (const f of rows || []) { const s = sheetOf(f); if (s && !out.has(s.slot)) out.set(s.slot, s); }
  return [...out.values()].sort((a, b) => a.slot - b.slot);
}
