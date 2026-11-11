// How warm a room feels to somebody in it, and what they'd put on for it and for what they're doing.
// Pure, so the server (plugins/roomstage, plugins/ambient-life), the Room Stage and a gate read the same rules.

// Room temperature, in °C. Inside it nobody reacts.
export const ROOM_TEMP = [18, 24];
// How many degrees past either edge is as cold, or as hot, as the reaction gets.
const COLD_FULL = 12, HOT_FULL = 10;

// -1 (as cold as it gets) to 1 (as hot), in tenths; 0 at room temperature.
export function feelOf(c) {
  if (!Number.isFinite(c)) return 0;
  const k = c < ROOM_TEMP[0] ? -(ROOM_TEMP[0] - c) / COLD_FULL : c > ROOM_TEMP[1] ? (c - ROOM_TEMP[1]) / HOT_FULL : 0;
  // a degree past the edge still counts: it never rounds back to nothing
  return k ? Math.sign(k) * Math.max(0.1, Math.round(Math.min(1, Math.abs(k)) * 10) / 10) : 0;
}
// The same in four steps: -2 cold, -1 cool, 1 warm, 2 hot.
export const feelBand = (f) => (f <= -0.5 ? -2 : f < 0 ? -1 : f >= 0.5 ? 2 : f > 0 ? 1 : 0);

// Cuts (client/game/js/panels/figure.js FIGURE_CUTS) by what they're for.
const OUTER = new Set(['coat', 'jacket', 'duster', 'bomber', 'overcoat', 'trench', 'peacoat', 'parka', 'mac', 'cropjacket', 'gilet', 'blazer', 'suit', 'labcoat']);
const WARM = new Set([...OUTER, 'hoodie', 'sweater', 'turtleneck', 'cardigan', 'flannel', 'longsleeve']);
const BARE_LEGS = new Set(['shorts', 'cutoffs', 'bermudas', 'capris', 'mini']);
const WEAR = {
  sleep: { m: ['tee', 'tank', 'oversized'], f: ['oversized', 'tank', 'tee'] },
  home: { m: ['tee', 'hoodie', 'longsleeve', 'sweater', 'flannel'], f: ['tee', 'hoodie', 'longsleeve', 'sweater', 'cardigan'] },
  out: { m: ['blazer', 'oxford', 'rolled', 'jacket'], f: ['blazer', 'cropjacket', 'turtleneck', 'oxford'] },
  cool: ['hoodie', 'sweater', 'cardigan', 'turtleneck'], cold: ['parka', 'peacoat', 'coat', 'bomber'],
  warm: { m: ['tee', 'shortsleeve', 'tank'], f: ['tee', 'tank', 'crop'] }, hot: ['tank', 'tee'],
  skirts: ['pencil', 'aline', 'midi', ''], scarves: ['scarf', 'chunky', 'snood'],
};
export const WEAR_OCCASIONS = ['sleep', 'home', 'out'];
const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

// What somebody changes for an occasion and the temperature. `now` is what they have on ({ cut, bottoms, hat,
// scarf }); `occasion` is 'sleep', 'home', 'out' or nothing; `feel` is feelOf's or feelBand's. `r` and `r2` are
// the person's own 0..1, so they pick the same thing every time. Returns only the keys that change.
export function wearFor(now, { occasion = '', feel = 0, female = false } = {}, r = 0, r2 = 0) {
  const out = {}, band = Number.isInteger(feel) ? Math.max(-2, Math.min(2, feel)) : feelBand(feel), sex = female ? 'f' : 'm';
  const has = (k) => (k in out ? out[k] : now[k]) || '';
  if (occasion === 'sleep') { out.cut = pick(WEAR.sleep[sex], r); out.bottoms = 'shorts'; out.hat = ''; out.scarf = ''; }
  else if (occasion === 'home') {
    // the coat comes off indoors, and the hat and scarf with it
    if (OUTER.has(now.cut)) out.cut = pick(WEAR.home[sex], r);
    out.hat = ''; out.scarf = '';
  } else if (occasion === 'out') {
    out.cut = pick(WEAR.out[sex], r); out.hat = '';
    if (female && !now.bottoms) out.bottoms = pick(WEAR.skirts, r2);
  }
  if (band < 0) {
    if (occasion === 'sleep') { out.cut = 'longsleeve'; out.bottoms = ''; }
    else if (band === -2 ? !OUTER.has(has('cut')) : !WARM.has(has('cut'))) out.cut = pick(band === -2 ? WEAR.cold : WEAR.cool, r2);
    if (BARE_LEGS.has(has('bottoms'))) out.bottoms = '';
    if (band === -2 && occasion !== 'sleep') { if (!has('scarf')) out.scarf = pick(WEAR.scarves, r); if (!has('hat')) out.hat = 'beanie'; }
  } else if (band > 0) {
    if (band === 2 || WARM.has(has('cut'))) out.cut = pick(band === 2 ? WEAR.hot : WEAR.warm[sex], r2);
    out.scarf = '';
    if (has('hat') === 'beanie') out.hat = '';
    if (band === 2 && !has('bottoms')) out.bottoms = 'shorts';
  }
  for (const k of Object.keys(out)) if ((now[k] || '') === out[k]) delete out[k];
  return out;
}
