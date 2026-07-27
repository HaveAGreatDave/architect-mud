// plugins/consort/appearance.js
//
// What a consort LOOKS like — generated from a seed, never authored.
//
// A placement's whole physicality is derived deterministically from its seed
// string, so the same seed always produces the same person: the B.L.I.S.S.
// roster can be regenerated cheaply, a listing can be shown before it's ordered
// and be identical after, and nothing about a consort's appearance ever needs a
// DB column beyond that one seed.
//
// The axes are deliberately many and independent — build, height, hair (colour,
// length, style), eyes, skin, mouth, an optional distinguishing mark, an
// optional chrome mod, grooming, scent, voice, an age band. Two consorts of the
// same archetype and the same build will still read as different people.
//
// Everything is per-sex where it needs to be (builds, garment layers, a couple
// of the feature pools) and shared where it doesn't (eye colour doesn't care).

// ── Seeded RNG ────────────────────────────────────────────────────────────────
// xmur3 + mulberry32: tiny, dependency-free, and stable across restarts — the
// same seed string must produce the same consort forever, so Math.random() is
// unusable here by construction.
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rngFor(seed) {
  const rand = mulberry32(xmur3(String(seed))());
  const r = {
    next: rand,
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
    int: (min, max) => min + Math.floor(rand() * (max - min + 1)),
    chance: (p) => rand() < p,
  };
  return r;
}

// ── Builds ────────────────────────────────────────────────────────────────────
// `tier` nudges price — rarity, not judgement. `layers` is the outfit the
// clothing model peels, outermost first (the flags.clothing_layers contract).
export const BUILDS = {
  female: {
    willowy: {
      label: 'Willowy', tier: 0,
      desc: 'long-limbed and narrow, all clean lines and shoulder blades, built like something drawn rather than grown',
      layers: ['a silk robe', 'a slip', 'a bra and panties'],
    },
    soft: {
      label: 'Soft', tier: 0,
      desc: 'soft and generously made, warm to look at, the shape the old paintings were about before everything got austere',
      layers: ['a heavy satin robe', 'a chemise', 'lace underthings'],
    },
    athletic: {
      label: 'Athletic', tier: 1,
      desc: 'compact and visibly strong, shoulders and thighs built by doing something rather than by being sculpted',
      layers: ['an oversized shirt', 'a sports top and shorts'],
    },
    statuesque: {
      label: 'Statuesque', tier: 1,
      desc: 'tall enough to make a room rearrange itself, broad through the shoulder, unhurried about all of it',
      layers: ['a floor-length robe', 'a bias-cut slip', 'a matched set in black'],
    },
    petite: {
      label: 'Petite', tier: 0,
      desc: 'small and quick and neatly put together, the sort of person who ends up folded into the corner of a chair',
      layers: ['an oversized cardigan', 'a camisole', 'cotton underthings'],
    },
    opulent: {
      label: 'Opulent', tier: 2,
      desc: 'built on a scale that reads as wealth by itself — heavy curves, expensive posture, nothing apologising for the room it takes up',
      layers: ['a fur-collared wrap', 'a beaded gown', 'a corset and stockings', 'almost nothing at all'],
    },
    rangy: {
      label: 'Rangy', tier: 1,
      desc: 'wiry and weather-cut, lean the way people get lean outside rather than in a gym, with hands that have done work',
      layers: ['a worn jacket', 'a vest', 'plain underthings'],
    },
    sculpted: {
      label: 'Sculpted', tier: 2,
      desc: 'symmetrical to a degree that is faintly unsettling, every proportion sitting exactly where an expensive clinic decided it should',
      layers: ['a structured coat', 'a bodysuit', 'engineered lingerie'],
    },
  },
  male: {
    lean: {
      label: 'Lean', tier: 0,
      desc: 'long and spare, narrow through the hip, built like a whip that hasn\'t been cracked yet',
      layers: ['an open shirt', 'a vest', 'shorts'],
    },
    broad: {
      label: 'Broad', tier: 1,
      desc: 'wide through the chest and shoulder, heavy-framed, the sort of shape a doorway has to be negotiated with',
      layers: ['a heavy robe', 'a loose shirt', 'briefs'],
    },
    cut: {
      label: 'Cut', tier: 1,
      desc: 'carved down to the working parts, every muscle legible, the whole thing maintained with obvious discipline',
      layers: ['a training jacket', 'a fitted tee', 'briefs'],
    },
    rangy: {
      label: 'Rangy', tier: 1,
      desc: 'wiry and weather-cut, lean the way people get lean outside rather than in a gym, with hands that have done work',
      layers: ['a worn jacket', 'a vest', 'plain shorts'],
    },
    soft: {
      label: 'Soft', tier: 0,
      desc: 'comfortably built and entirely at ease about it, warm and solid and easy to lean against',
      layers: ['a thick dressing gown', 'a soft shirt', 'shorts'],
    },
    towering: {
      label: 'Towering', tier: 2,
      desc: 'tall past the point of comment, long-boned, having to fold to fit most furniture and long since stopped minding',
      layers: ['a floor-length coat', 'an unbuttoned shirt', 'briefs'],
    },
    compact: {
      label: 'Compact', tier: 0,
      desc: 'short and dense and quick with it, low centre of gravity, deceptively hard to move',
      layers: ['a bomber jacket', 'a tank', 'shorts'],
    },
    sculpted: {
      label: 'Sculpted', tier: 2,
      desc: 'symmetrical to a degree that is faintly unsettling, every proportion sitting exactly where an expensive clinic decided it should',
      layers: ['a structured coat', 'a mesh top', 'engineered briefs'],
    },
  },
};

// ── Feature pools ─────────────────────────────────────────────────────────────
const HEIGHTS = [
  'barely over five foot', 'a shade under average', 'average height',
  'a little taller than you expect', 'tall', 'strikingly tall', 'head-and-shoulders tall',
];

const HAIR_COLOUR = [
  'black', 'blue-black', 'dark brown', 'chestnut', 'auburn', 'copper', 'ash blonde',
  'white-blonde', 'honey blonde', 'silver', 'stark white', 'grey at the temples',
  'bleached to straw', 'dyed a flat synthetic red', 'dyed deep violet', 'dyed seafoam green',
  'dyed traffic-cone orange', 'half-and-half, black on one side and white on the other',
];
const HAIR_LENGTH = [
  'cropped to the skull', 'buzzed short', 'ear-length', 'chin-length', 'shoulder-length',
  'long', 'very long', 'long enough to sit on',
];
const HAIR_STYLE = [
  'left to do as it likes', 'immaculately kept', 'pinned up and coming loose',
  'braided tight against the scalp', 'in a heavy plait', 'shaved at one side',
  'undercut', 'slicked back', 'a deliberate mess', 'in soft waves', 'poker-straight',
  'in tight coils', 'wound into a knot with something expensive holding it',
];

// Full phrases, not adjectives — several of these don't survive having the word
// "eyes" bolted onto the end of them.
const EYES = [
  'dark brown eyes', 'black-brown eyes', 'hazel eyes', 'green eyes', 'grey-green eyes',
  'pale grey eyes', 'ice-blue eyes', 'deep blue eyes', 'amber eyes', 'gold-flecked eyes',
  'mismatched eyes, one green and one brown',
  'eyes a shade of violet that was never native to anybody',
  'eyes so dark the pupil is hard to find',
  'eyes that are flat and faintly reflective, and clearly not the originals',
];

const SKIN = [
  'deep brown', 'warm brown', 'olive', 'sallow', 'fair and freckled', 'very pale',
  'sun-darkened', 'ashen', 'burnished copper', 'porcelain-pale and obviously maintained',
  'weathered', 'scattered with old sun damage nobody has bothered to correct',
];

const MOUTHS = [
  'a wide, easy mouth', 'a small serious mouth', 'a mouth that is always about to say something',
  'a crooked smile', 'a mouth held very carefully still', 'full lips and a habit of biting them',
  'a mouth that turns down at rest and looks like an opinion',
];

const MARKS = [
  'a thin white scar through one eyebrow',
  'an old burn scar down one forearm, long since faded to silver',
  'a scatter of freckles across the nose and shoulders',
  'a tattoo of a bird\'s skeleton along the ribs',
  'faded corporate ident numbers tattooed inside one wrist',
  'a fine tracery of scarwork across the back, deliberate and decorative',
  'a chipped front tooth that only shows when they really laugh',
  'a birthmark like spilled ink at the hip',
  'a puckered round scar under the collarbone that nobody explains',
  'stretch-silver at the hips, unhidden',
  'a hairline surgical seam behind one ear',
  'nicotine-stained fingers on the right hand',
  'knuckles that have been broken and reset badly',
  'a long clean scar down one thigh with neat stitch-marks either side',
];

const MODS = [
  'a slim chrome band inlaid along one cheekbone',
  'subdermal lights at the wrists that pulse when the pulse does',
  'polished chrome fingertips on one hand',
  'a spinal port at the base of the neck, capped and unused',
  'irises that gloss over silver in low light',
  'a filigree of circuitry visible under the skin of the throat',
  'ceramic plating replacing one shoulder, seamless and matte',
  'teeth that have been very quietly and very expensively replaced',
];

const GROOMING = [
  'immaculately turned out', 'expensively unkempt', 'plainly and cleanly kept',
  'overdressed for a room with nobody in it', 'wearing yesterday\'s look and unbothered',
  'scrubbed raw and scentless', 'lacquered to a finish',
];

const SCENTS = [
  'something green and expensive', 'clean soap and nothing else', 'smoke and citrus',
  'a heavy old-world floral', 'machine oil, faintly, under the perfume', 'salt and warm skin',
  'something sharp and medicinal', 'vanilla gone slightly sour', 'no scent at all, deliberately',
];

const VOICES = [
  'a low, unhurried voice', 'a bright quick voice', 'a voice worn rough at the edges',
  'a soft voice you have to lean in for', 'a carrying voice, trained somewhere',
  'a flat affectless delivery', 'a voice with a Basin accent under the polish',
  'a voice that laughs at the end of every sentence',
];

const AGES = [
  'young enough that it shows', 'somewhere in their twenties', 'somewhere in their thirties',
  'unmistakably in their forties and better for it', 'age genuinely difficult to place',
  'older than the roster implies, and not hiding it',
];

// ── Generation ────────────────────────────────────────────────────────────────
// One seed in, one whole person out. `sex` and `buildKey` can be forced (the
// pairing generator pins them); otherwise both come from the seed too.
export function generateAppearance(seed, { sex = null, build = null } = {}) {
  const r = rngFor(`appearance:${seed}`);
  const theSex = sex || (r.chance(0.5) ? 'female' : 'male');
  const builds = BUILDS[theSex];
  const buildKey = (build && builds[build]) ? build : r.pick(Object.keys(builds));
  const b = builds[buildKey];

  return {
    seed: String(seed),
    sex: theSex,
    build: buildKey,
    buildLabel: b.label,
    buildDesc: b.desc,
    layers: [...b.layers],
    tier: b.tier,

    height:   r.pick(HEIGHTS),
    hair:     `${r.pick(HAIR_LENGTH)} ${r.pick(HAIR_COLOUR)} hair, ${r.pick(HAIR_STYLE)}`,
    eyes:     r.pick(EYES),
    skin:     r.pick(SKIN),
    mouth:    r.pick(MOUTHS),
    grooming: r.pick(GROOMING),
    scent:    r.pick(SCENTS),
    voice:    r.pick(VOICES),
    age:      r.pick(AGES),
    // Not everyone carries a mark, and chrome is rarer still and costs more.
    mark:     r.chance(0.6) ? r.pick(MARKS) : null,
    mod:      r.chance(0.25) ? r.pick(MODS) : null,
  };
}

// The NPC `description` — what `examine <name>` prints. Written as prose rather
// than a stat block; the stat block is the app's job, not the room's.
export function describeAppearance(name, a) {
  const bits = [
    `${name} is ${a.height}, ${a.buildDesc}.`,
    `${cap(a.skin)} skin, ${a.hair}, and ${a.eyes} over ${a.mouth}.`,
  ];
  if (a.mark) bits.push(`${cap(a.mark)}.`);
  if (a.mod) bits.push(`${cap(a.mod)}.`);
  bits.push(`${cap(a.grooming)}, carrying ${a.scent}, with ${a.voice}.`);
  return bits.join(' ');
}

// The B.L.I.S.S. listing card — every physical characteristic, itemised, because
// the app is selling a product and has no shame about presenting one.
export function appearanceCard(a) {
  const rows = [
    ['Sex',      a.sex === 'male' ? 'Male' : 'Female'],
    ['Build',    `${a.buildLabel} — ${a.buildDesc}`],
    ['Height',   cap(a.height)],
    ['Age',      cap(a.age)],
    ['Hair',     cap(a.hair)],
    ['Eyes',     cap(a.eyes)],
    ['Skin',     cap(a.skin)],
    ['Mouth',    cap(a.mouth)],
    ['Grooming', cap(a.grooming)],
    ['Scent',    cap(a.scent)],
    ['Voice',    cap(a.voice)],
  ];
  if (a.mark) rows.push(['Marks', cap(a.mark)]);
  if (a.mod)  rows.push(['Chrome', cap(a.mod)]);
  return rows;
}

function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }
