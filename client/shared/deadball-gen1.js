// DEADBALL'S FIRST GENERATION: the league's first augmented and mutant players.
//
// Thirty-two players from the four orders, eight each, of whom sixteen play a season: every club
// drafts two, off the season's number, so the draft is a pure function like the rosters it sits on
// (plugins/broadcast/sports/baseball.js clubRosters). The league turns them on with
// `sports_pools.sim.firstGen` on the Deadball row; off, nothing here is read and the rosters are
// the ones the league always had.
//
// The draft's rules:
//   · the western clubs (WEST) take Ascendants only, two each;
//   · the Crows take two Long Watch and nobody else, and they pick first, so no other club can take
//     a Long Watch man before they have both;
//   · every other club takes two from the Long Watch, the Wildblood and the Null, one from each of
//     two different orders.
//
// Who a man is also decides how he plays: his legs, his arm and his hand come off his ratings
// here instead of his name's hash (baseball.js traitOf, handOf), so a Wildblood leaper steals.
// How he looks is the TV's (gl/ballplayer-mesh.js gen1Gear, gl/ballpark.js gen1Fx): his club's kit,
// with his order's colours on whatever he's had fitted or grown.
//
// Pure: no DOM, no clock. The server and the client both import it.

// Each order's colours: `base` and `trim` for what's fitted or grown, `glow` for what lights.
// Ascendants clinical blue and white, the Long Watch earth, the Wildblood red, the Null grey to black.
export const GEN1_ORDERS = Object.freeze({
  asc: Object.freeze({ name: 'Ascendant', base: '#eef4f8', trim: '#3d8fd6', dark: '#1d4f7d', glow: '#8fd2ff' }),
  lw: Object.freeze({ name: 'Long Watch', base: '#7a5a3a', trim: '#b8925a', dark: '#3e2c1c', glow: '#e8b060' }),
  wb: Object.freeze({ name: 'Wildblood', base: '#9e1b1b', trim: '#e0402c', dark: '#4a0c0c', glow: '#ff4a22' }),
  nul: Object.freeze({ name: 'Null', base: '#3a3c40', trim: '#8c9198', dark: '#0e0f11', glow: '#e4e8ee' }),
});

// [name, nickname, order, position, [contact, power, speed, arm] out of 10, bats, throws, build, gear, skin]
// `build` is { inches, girth, shoulders } over the cast's own (diamond/cast.js buildOf); `gear` names
// the parts gl/ballplayer-mesh.js gen1Gear fits; `skin` replaces the name's draw where he's changed.
const ROWS = [
  ['Aurel Vance', 'The Gilt Arm', 'asc', 'P', [3, 4, 4, 10], 'R', 'R', null, ['cyberArm', 'pauldron', 'lenses', 'spine'], null],
  ['Solace Wren', 'Halo', 'asc', 'SS', [7, 4, 8, 7], 'R', 'R', null, ['halo', 'neckSeams', 'lenses'], null],
  ['Kasimir Oduya', 'Chrome Clipper', 'asc', '1B', [5, 10, 1, 5], 'R', 'R', { inches: 82, girth: 0.08, shoulders: 1.12 }, ['chestPlate', 'pauldrons', 'jaw'], null],
  ['Petra Lisle', 'Second Skin', 'asc', 'CF', [6, 3, 10, 5], 'L', 'L', { inches: 70, girth: -0.03 }, ['lenses', 'skinWeave', 'calfFins'], '#eef0f2'],
  ['Dorian Saltmarsh', 'The Ledger', 'asc', 'C', [5, 4, 2, 8], 'R', 'R', { girth: 0.07 }, ['crown', 'chestCore'], null],
  ['Ilse Marrow', 'Gilt Lady', 'asc', '3B', [8, 7, 5, 6], 'R', 'R', null, ['jaw', 'neckSeams', 'droneRing'], null],
  ['Benedikt Croft', 'Glasshand', 'asc', 'P', [2, 2, 3, 9], 'R', 'R', null, ['glassHand', 'stole'], null],
  ['Yuna Castellane', 'The Ascension', 'asc', 'DH', [10, 6, 2, 1], 'S', 'R', null, ['thrusters', 'crown', 'lenses'], null],
  ['Hiro Thane', 'The Quiet Hand', 'lw', 'SS', [8, 4, 8, 8], 'R', 'R', null, ['wrap', 'hood', 'wristWraps'], null],
  ['Mara Coil', 'Nine Breaths', 'lw', 'CF', [7, 3, 9, 7], 'L', 'L', { inches: 69 }, ['wrap', 'feather', 'beads'], null],
  ['Ansel Pike', 'The Long Count', 'lw', 'P', [2, 2, 4, 9], 'L', 'L', null, ['hood', 'wristWraps'], null],
  ['Teodor Vey', 'Two Strikes', 'lw', '2B', [10, 3, 6, 5], 'L', 'R', { girth: -0.04 }, ['cord', 'beads'], null],
  ['Rook Hallam', 'Nightwatch', 'lw', 'C', [6, 5, 3, 10], 'R', 'R', null, ['mantle', 'beads'], null],
  ['Sela Fen', 'The Patient', 'lw', '1B', [9, 4, 4, 4], 'S', 'R', null, ['braid', 'beads', 'wristWraps'], null],
  ['Corvin Ashe', 'Corvid', 'lw', 'RF', [6, 6, 7, 8], 'L', 'R', null, ['mantle', 'wrap', 'feather'], null],
  ['Wen Halloway', 'The Last Bat', 'lw', 'DH', [10, 1, 5, 2], 'L', 'R', { girth: -0.02 }, ['beard', 'beads'], null],
  ['Grist Mallow', 'Hopscotch', 'wb', '2B', [5, 3, 10, 5], 'R', 'R', null, ['ears', 'hindLegs', 'claws'], '#8f857b'],
  ['Vesna Ruk', 'Long Jump', 'wb', 'LF', [5, 5, 9, 7], 'L', 'L', null, ['ears', 'tail', 'hindLegs'], '#b59a7a'],
  ['Bram Ochre', 'The Horn', 'wb', '1B', [4, 10, 3, 5], 'R', 'R', { inches: 80, girth: 0.09, shoulders: 1.1 }, ['horns', 'hump', 'spurs', 'tusks'], '#8a3a28'],
  ['Ottilie Fenn', 'Four Arms', 'wb', '3B', [6, 5, 5, 8], 'R', 'R', null, ['arms4', 'claws'], '#b69a7a'],
  ['Mott Caul', 'Mudlark', 'wb', 'C', [5, 6, 2, 9], 'R', 'R', { girth: 0.07 }, ['frogEyes', 'mottle', 'glowSpots'], '#5d7a48'],
  ['Kessa Thorn', 'Briar', 'wb', 'P', [3, 3, 4, 10], 'L', 'L', null, ['thorns', 'claws'], '#9a6a5a'],
  ['Hob Lantern', 'Lantern', 'wb', 'CF', [6, 4, 9, 7], 'R', 'R', null, ['ears', 'glowSpots', 'spurs'], '#4f7c74'],
  ['Dace Ironjaw', 'The Underdog', 'wb', 'P', [2, 4, 4, 9], 'R', 'R', null, ['muzzle', 'ears', 'blades', 'mane'], '#6b625a'],
  ['Pax Static', 'Zero Day', 'nul', 'CF', [8, 4, 8, 6], 'R', 'R', null, ['visor', 'sleeveCable', 'ports'], null],
  ['Juno Blank', 'The Glitch', 'nul', 'SS', [6, 3, 9, 8], 'S', 'R', null, ['halfMask', 'ports'], null],
  ['Rasmus Kell', 'Brute Force', 'nul', 'DH', [2, 10, 3, 4], 'R', 'R', { inches: 80, girth: 0.08, shoulders: 1.12 }, ['gunArm', 'spinePlates', 'roboJaw'], null],
  ['Nyx Ohara', 'Null Pointer', 'nul', 'P', [2, 2, 2, 10], 'L', 'L', null, ['visor', 'pack'], null],
  ['Fennick Dross', 'Backdoor', 'nul', '3B', [9, 6, 3, 6], 'R', 'R', null, ['ports', 'cables', 'headset'], null],
  ['Ada Vox', 'Overwrite', 'nul', '2B', [7, 5, 7, 6], 'R', 'R', null, ['roboLegs', 'ports'], null],
  ['Kip Nullson', 'Dead Pixel', 'nul', 'RF', [5, 6, 5, 10], 'R', 'R', null, ['roboHead'], null],
  ['Sorrel Dane', 'Rootkit', 'nul', 'C', [6, 5, 2, 8], 'R', 'R', null, ['cage', 'headset'], null],
];
export const GEN1 = Object.freeze(ROWS.map(([name, nick, order, pos, r, bats, throws, build, gear, skin]) => Object.freeze({
  name, nick, order, pos, bats, throws, build, gear: Object.freeze(gear), skin,
  ratings: Object.freeze({ contact: r[0], power: r[1], speed: r[2], arm: r[3] }),
})));
const BY_NAME = new Map(GEN1.map((p) => [p.name, p]));
export const gen1Of = (name) => BY_NAME.get(name) || null;
export const isPitcher = (p) => p.pos === 'P';

// The western clubs, which take Ascendants only, and the Crows, who take the Long Watch.
export const WEST = Object.freeze(['Westside White Sox', 'Docks District Dolphins']);
export const CROWS = 'Coldwater Crows';
const EAST_ORDERS = ['lw', 'wb', 'nul'];

function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffled = (list, r) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// The season's draft: { [club]: [name, name] }. `teams` is the league; `season` the roster season
// (baseball.js seasonOfDay). A club never gets two men for the same place in the field.
const _drafts = new Map();
export function gen1Draft(teams, season) {
  const league = (Array.isArray(teams) ? [...teams] : []).sort();
  const key = `${league.join('|')}#${season | 0}`;
  if (_drafts.has(key)) return _drafts.get(key);
  const r = rngOf(Math.imul((season | 0) ^ 0x6e31, 0x9e3779b1));
  const pool = {};
  for (const o of Object.keys(GEN1_ORDERS)) pool[o] = shuffled(GEN1.filter((p) => p.order === o).map((p) => p.name), r);
  const out = Object.fromEntries(league.map((t) => [t, []]));
  const clash = (t, n) => { const p = BY_NAME.get(n); return out[t].some((m) => { const q = BY_NAME.get(m); return q.pos === p.pos && !isPitcher(p); }); };
  const take = (t, o) => {
    const list = pool[o];
    if (!list?.length) return false;
    let i = list.findIndex((n) => !clash(t, n));
    if (i < 0) i = 0;
    out[t].push(list.splice(i, 1)[0]);
    return true;
  };
  // the Crows first, both picks, so the Long Watch is theirs to choose from
  if (out[CROWS]) { take(CROWS, 'lw'); take(CROWS, 'lw'); }
  // then two rounds, the second run backward, in an order drawn for the season
  const order = shuffled(league.filter((t) => t !== CROWS), r);
  for (const round of [0, 1]) {
    for (const t of round ? [...order].reverse() : order) {
      if (WEST.includes(t)) { take(t, 'asc'); continue; }
      const have = new Set(out[t].map((n) => BY_NAME.get(n).order));
      const open = EAST_ORDERS.filter((o) => !have.has(o) && pool[o].length);
      // the deepest of the orders still open, ties to the draw
      const most = Math.max(0, ...open.map((o) => pool[o].length));
      const best = open.filter((o) => pool[o].length === most);
      if (best.length) take(t, best[Math.floor(r() * best.length)]);
    }
  }
  const frozen = Object.freeze(Object.fromEntries(Object.entries(out).map(([t, l]) => [t, Object.freeze(l)])));
  _drafts.set(key, frozen);
  return frozen;
}

// A season's rosters with the draft played into them: each man takes the place he plays, a
// pitcher a turn in the rotation. Who he puts out of the side sits the season out. `R` is
// clubRosters' { clubs, unsigned }; a new object comes back and `R` is left as it was.
export function gen1Rosters(R, teams, season) {
  if (!R?.clubs) return R;
  const draft = gen1Draft(teams, season), clubs = {};
  for (const [t, c] of Object.entries(R.clubs)) {
    const club = { lineup: c.lineup.map((e) => ({ ...e })), rotation: c.rotation.map((e) => ({ ...e })), bench: c.bench.map((e) => ({ ...e })) };
    let arm = 0;
    for (const name of draft[t] || []) {
      const p = BY_NAME.get(name), entry = { name, pos: isPitcher(p) ? 'P' : p.pos, since: season, gen1: true };
      if (isPitcher(p)) { if (club.rotation.length) club.rotation[arm++ % club.rotation.length] = entry; continue; }
      const i = club.lineup.findIndex((e) => e.pos === p.pos);
      if (i >= 0) club.lineup[i] = entry;
      else if (club.bench.length) club.bench[0] = { ...entry, pos: 'UT' };
    }
    clubs[t] = club;
  }
  return { clubs, unsigned: R.unsigned };
}

// What a Gen 1 man's ratings make of the sim's 0-to-1 traits (baseball.js speedOf, armOf,
// quicknessOf), and his hand. Null for anybody else, who keeps his name's.
export function gen1Trait(name, trait) {
  const p = BY_NAME.get(name);
  if (!p) return null;
  const r = p.ratings;
  if (trait === 'speed') return Math.min(0.99, r.speed / 10);
  if (trait === 'arm') return Math.min(0.99, r.arm / 10);
  if (trait === 'quickness') return Math.min(0.99, (r.arm + r.speed) / 20);
  return null;
}
export const gen1Hand = (name) => { const p = BY_NAME.get(name); return p ? { bats: p.bats, throws: p.throws } : null; };
