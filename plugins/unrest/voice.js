// The two voices, and the one rule about place.
//
// ⚠ Rule 3: a cell has no name, so nothing here ever says one. A part of town is
// given by ORIENTATION — "the north end", "the west side" — derived from the
// engine's own `bearing()` against the centre of the built city. That helper
// already drops the minor axis (so a thing nearly due north reads "north" rather
// than "north-east") and it already knows `grid_y` runs SOUTHWARD, which
// hand-rolled direction code reliably gets backwards.
//
// A bearing is not a consolation for lacking district names. A named district
// invites a mental map with a status per name, which is one step from the
// readout rule 2 bans; a part of town given by orientation stays felt.
//
// ⚠ Rule 7, and it is the whole expressive trick: the wire carries the Ascendant
// version, the street carries the street version, they contradict each other and
// nothing ever reconciles them. Per house style the Ascendant copy takes em
// dashes and the street copy never does, so the faction split is encoded in the
// punctuation before a word of it is read.
import { bearing } from '../../server/engine/map-text.js';
import { allBlocks, blockInfo } from './blocks.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// The centre of the BUILT city, averaged over the cells the index actually
// found — not the region's centre, which sits in 2,865 tiles of redrock waste.
export function cityCentre() {
  const keys = allBlocks();
  if (!keys.length) return null;
  let sx = 0, sy = 0;
  for (const k of keys) { const b = blockInfo(k); sx += b.cx; sy += b.cy; }
  return { cx: sx / keys.length, cy: sy / keys.length };
}

const QUARTER = {
  'north': ['the north end', 'up the north end'],
  'south': ['the south end', 'down the south end'],
  'east': ['the east side', 'over east'],
  'west': ['the west side', 'over west'],
  'north-east': ['the north-east corner', 'up the north-east side'],
  'north-west': ['the north-west corner', 'up the north-west side'],
  'south-east': ['the south-east corner', 'down the south-east side'],
  'south-west': ['the south-west corner', 'down the south-west side'],
};

/** Where a cell is, said as a part of town. Never a name. */
export function quarterOf(key) {
  const b = blockInfo(key);
  const c = cityCentre();
  if (!b || !c) return 'the middle of town';
  const dir = bearing(b.cx - c.cx, b.cy - c.cy);
  if (dir === 'here' || !QUARTER[dir]) return 'the middle of town';
  return pick(QUARTER[dir]);
}

// ── Which order the line is about ────────────────────────────────────────────
// Keyed off the authored ROLE, never an org id, so a third order that writes
// grip needs no line written for it. `grip` is the authority squeezing; `heat`
// is the resident insurgency working underneath it.

const AMBIENT = {
  grip: {
    watchful: [
      "A patrol car rolls past at walking pace and doesn't stop.",
      'Somebody in a clean coat photographs a doorway, then moves on.',
      'Two uniforms stand where they can see the whole street, saying nothing.',
    ],
    tense: [
      'A marshal checks a face against a tablet, then waves the face on.',
      'There are more uniforms than customers, and everyone has noticed.',
      'A drone holds station overhead, low enough to hear.',
    ],
    flashpoint: [
      'The street is full of uniforms. Anyone with somewhere else to be has gone there.',
      'A loudhailer says something about compliance. Nobody stops walking.',
      'Two of them are putting a third person into a van, briskly and without conversation.',
    ],
  },
  heat: {
    watchful: [
      'Fresh paint on the shutter, half scrubbed off and still legible.',
      "Someone has taped a printed sheet to the pole. It isn't an advertisement.",
      'Two people stop talking as you pass, and start again after you have.',
    ],
    tense: [
      'A shutter comes down early three doors along. Nobody explains why.',
      'The same three words are on four walls in three different hands.',
      'Something goes over a fence behind you. Nobody turns round.',
    ],
    flashpoint: [
      'Glass across the pavement, and a smell of burnt plastic nobody is putting out.',
      'A bin is burning in the mouth of the alley and nobody is watching it.',
      'Every window on this side is boarded, and the boards are newer than the glass was.',
    ],
  },
};

const CROSSING = {
  watchful: [
    'The block reads a little wrong. People are walking faster than the weather warrants.',
    'Conversation drops half a step as you come round the corner.',
  ],
  tense: [
    'Something is going on here. Doors that should be open are shut.',
    "You're being looked at by three people who are pretending not to.",
  ],
  flashpoint: [
    'You have walked into the middle of something. Everyone here already knows what.',
    "Whatever is happening on this block, it started before you arrived and it isn't finished.",
  ],
};

// The street. ⚠ Never an em dash: that is the Ascendant voice tell.
const STREET = {
  grip: [
    (p) => `"They've got the whole of ${p} papered. Checkpoints, tablets, the lot. Go round."`,
    (p) => `"Stay out of ${p} if you like your evening. They're stopping everybody."`,
    (p) => `"Somebody got lifted in ${p} this morning for standing still. That's it. That's the charge."`,
  ],
  heat: [
    (p) => `"Don't go up ${p} tonight. Something's brewing and it isn't yours."`,
    (p) => `"They're at the walls again in ${p}. Third night running."`,
    (p) => `"I'd not be in ${p} after dark. Not this week."`,
  ],
};

// The wire. Em dashes are the point — this is the Ascendant register, and it
// contradicts the street on purpose. Nothing ever reconciles the two.
const WIRE = {
  grip: [
    (p) => `Municipal Safety confirms an expanded presence toward ${p} — a scheduled compliance review, concluded without incident.`,
    (p) => `Residents of ${p} are reminded that identity verification is routine — cooperation shortens it considerably.`,
  ],
  heat: [
    (p) => `Reports of disorder in ${p} are unverified — Basin infrastructure is operating normally and there's no cause for concern.`,
    (p) => `A small number of unlicensed gatherings in ${p} have been dispersed — the matter is considered closed.`,
  ],
};

/** The room ambient. Returns null at a band that has nothing to say. */
export function ambientLine(band, writes) {
  const pool = AMBIENT[writes]?.[band];
  return pool ? pick(pool) : null;
}

/** The beat when a player walks into a block that is not quiet. */
export function crossingLine(band) {
  const pool = CROSSING[band];
  return pool ? pick(pool) : null;
}

/** The street's version. `key` is the cell it is about. */
export function streetLine(key, writes) {
  const pool = STREET[writes];
  return pool ? pick(pool)(quarterOf(key)) : null;
}

/** The Ascendant version of the same thing. */
export function wireLine(key, writes) {
  const pool = WIRE[writes];
  return pool ? pick(pool)(quarterOf(key)) : null;
}

export const _test = { AMBIENT, CROSSING, STREET, WIRE, QUARTER, pick };
