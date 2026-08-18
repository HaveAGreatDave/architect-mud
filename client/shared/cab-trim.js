// What a truck's dashboard is MADE of and what colour it is — the two halves of a cab's surface,
// pulled out of the tier table so they can be bought separately from the tier.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// `CAB_TRIM` in windshield.js has always carried three unrelated things in one row: how many
// INSTRUMENTS the truck has, what its dash is MADE of, and what COLOUR everything is. That was
// right while the only way to change any of them was to buy a different truck. It stops being
// right the moment a bench can retrim one, because two of those three are cosmetic and the third
// is not.
//
// ⚠ THE LADDER IS INSTRUMENTS. A TRIM JOB IS SURFACE. Retrimming can put walnut and brass in a
// scrapyard Barrow, and it can never put a rev counter in one. `dials`, `band` and `lamps` stay on
// the tier row in windshield.js and are not reachable from here at all — the fleet ladder's teeth
// are INFORMATION (drive a Barrow on the sound of it, which is the oldest skill in the game), and
// a cosmetic bench must not be able to file them down. If you ever find yourself wanting to add an
// instrument count to a colourway, that is the moment the ladder stops meaning anything.
//
// It lives in client/shared for the same reason skyline-scale.js does: TWO sides read it and
// neither should own it. The renderer needs the colours; the maintenance bench
// (plugins/trucking/rig.js) needs to know what is buyable and refuse anything else. A list in each
// is a list that drifts, and the symptom would be a trim a player paid for that the cab cannot
// draw. No imports, no side effects.

// ── MATERIALS ────────────────────────────────────────────────────────────────
// One procedural tile each (see cabDashTex in windshield.js), laid over the colour as an overlay —
// so the tile carries the SURFACE and the colourway keeps owning the colour. Adding one is a key
// here and a branch there.
export const DASH_MATERIALS = {
  steel:   { label: 'pressed steel', blurb: 'brushed, and chipped back to bare metal where boots got it', gloss: 0.30 },
  plastic: { label: 'moulded plastic', blurb: 'pebble-grained, honest, anonymous', gloss: 0.50 },
  vinyl:   { label: 'stitched vinyl', blurb: 'padded and stitched along the lip', gloss: 0.75 },
  wood:    { label: 'book-matched veneer', blurb: 'grained, varnished, and somebody chose it', gloss: 1.00 },
};

// ── COLOURWAYS ───────────────────────────────────────────────────────────────
// The colour half of a trim, entire. Every key here was already in CAB_TRIM — these four ARE the
// four stock interiors, lifted out unchanged so the stock cabs keep rendering byte-for-byte what
// they always did, plus three the bench sells and no truck ships with.
//
// ⚠ TWO BROWNS, AND THEY MUST NEVER CONVERGE. `oxide` and `walnut` are both brown, which is right —
// one is enamel gone chalky over rust, the other is a man's choice of timber. What keeps them apart
// is everything except the hue: oxide is desaturated, matt, crazed and lit amber-orange; walnut is
// saturated red-brown, varnished, grained and lit gold. Retune either and check it against the
// other in the same light before shipping.
export const DASH_COLOURWAYS = {
  oxide:  { label: 'oxide brown', stock: true,
            hdr: ['#241c15', '#33281d'], pil: ['#261d16', '#3b2e22'], post: '#2b2119',
            dash: ['#6b5540', '#3b2f24', '#191410'], lip: 'rgba(226,200,158,0.14)',
            rim: 'rgba(40,31,23,0.95)', rimHi: 'rgba(198,170,128,0.10)',
            face: ['#1c150e', '#0c0805'], ring: 'rgba(186,158,112,0.24)', needle: '#d2833a',
            glow: '#c07a34', crazed: true },
  slate:  { label: 'slate grey', stock: true,
            hdr: ['#16181c', '#23262b'], pil: ['#1a1d21', '#2c3037'], post: '#212429',
            dash: ['#3b414a', '#1e2228', '#0d0f12'], lip: 'rgba(190,205,225,0.16)',
            rim: 'rgba(28,31,36,0.95)', rimHi: 'rgba(150,165,185,0.13)',
            face: ['#171a1f', '#0a0c0f'], ring: 'rgba(150,165,185,0.28)', needle: '#e8c07a',
            glow: '#9fb4c4' },
  moss:   { label: 'moss green', stock: true,
            hdr: ['#121815', '#1d2721'], pil: ['#151d19', '#26332c'], post: '#1a2320',
            dash: ['#33463d', '#18211c', '#0a0f0d'], lip: 'rgba(180,225,200,0.20)',
            rim: 'rgba(24,33,28,0.95)', rimHi: 'rgba(160,210,180,0.15)',
            face: ['#121a16', '#070b09'], ring: 'rgba(150,205,175,0.30)', needle: '#8fe0a0',
            glow: '#7fc98b' },
  walnut: { label: 'walnut and brass', stock: true,
            hdr: ['#1b1512', '#33261a'], pil: ['#1e1713', '#3f2f20'], post: '#261b13',
            dash: ['#7a4a24', '#3a1f0f', '#150a05'], lip: 'rgba(255,215,150,0.26)',
            rim: 'rgba(52,35,20,0.95)', rimHi: 'rgba(232,192,122,0.22)',
            face: ['#22150a', '#0d0704'], ring: 'rgba(232,192,122,0.40)', needle: '#ffd489',
            glow: '#e8c07a' },
  // The three the bench sells. Each one is a different LIGHT to drive by, which is the part of a
  // colourway you actually live with at night — the needle and the glow are what your face is lit
  // by for twenty minutes at a time, and that is why none of these is merely a different brown.
  oxblood: { label: 'oxblood and chrome',
            hdr: ['#1c1210', '#2e1b18'], pil: ['#1f1412', '#3a221e'], post: '#271713',
            dash: ['#6e2b26', '#331413', '#150807'], lip: 'rgba(255,190,180,0.20)',
            rim: 'rgba(46,26,23,0.95)', rimHi: 'rgba(226,180,172,0.16)',
            face: ['#1e100e', '#0b0505'], ring: 'rgba(228,170,160,0.30)', needle: '#ff9f86',
            glow: '#d2705c' },
  cobalt: { label: 'cobalt blue',
            hdr: ['#101720', '#1b2735'], pil: ['#121a24', '#22303f'], post: '#16202b',
            dash: ['#2a4463', '#132132', '#080d14'], lip: 'rgba(170,205,255,0.20)',
            rim: 'rgba(20,30,42,0.95)', rimHi: 'rgba(150,190,240,0.16)',
            face: ['#0f1722', '#05080d'], ring: 'rgba(150,190,240,0.32)', needle: '#8fc4ff',
            glow: '#6fa8e0' },
  bone:   { label: 'bone and black',
            hdr: ['#1a1a18', '#2a2a26'], pil: ['#1d1d1a', '#31312c'], post: '#22221e',
            dash: ['#8e8878', '#3f3c35', '#131211'], lip: 'rgba(255,248,225,0.22)',
            rim: 'rgba(32,31,28,0.95)', rimHi: 'rgba(226,220,198,0.18)',
            face: ['#191814', '#080807'], ring: 'rgba(220,214,192,0.32)', needle: '#f4e3b6',
            glow: '#d8cca4' },
};

// ── WHAT EACH TRUCK LEFT THE FACTORY IN ──────────────────────────────────────
// Keyed by fleet tier. This is the only place the ladder and the surface vocabulary touch, and it
// is here rather than in the renderer because the maintenance bench needs it too — to mark which
// swatch is already fitted, without keeping a second copy of the mapping that would drift the
// first time a stock interior was recoloured.
//
// It says nothing about instruments. `dials`/`band`/`lamps` stay in windshield.js and are not
// reachable from this file at all — see the note at the top.
export const STOCK_TRIM = {
  0: { col: 'oxide',  mat: 'steel' },     // KRELL BARROW
  1: { col: 'slate',  mat: 'plastic' },   // OSTREK COURIER
  2: { col: 'moss',   mat: 'vinyl' },     // VACHON DRAYMAN
  3: { col: 'walnut', mat: 'wood' },      // ORLOV CONTINENTAL
};
export const stockTrim = (tier) => STOCK_TRIM[tier] ?? STOCK_TRIM[1];

export const isDashMaterial = (k) => Object.hasOwn(DASH_MATERIALS, String(k || ''));
export const isDashColourway = (k) => Object.hasOwn(DASH_COLOURWAYS, String(k || ''));

// A trim as the truck stores it: two short keys and nothing else. Anything unrecognised falls back
// to what the truck already had rather than to a default, so a bad argument can never silently
// repaint a cab the player was happy with.
export function sanitizeTrim(next = {}, prev = {}) {
  return {
    mat: isDashMaterial(next.mat) ? String(next.mat) : (isDashMaterial(prev.mat) ? String(prev.mat) : null),
    col: isDashColourway(next.col) ? String(next.col) : (isDashColourway(prev.col) ? String(prev.col) : null),
  };
}
