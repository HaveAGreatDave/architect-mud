/**
 * CPhL — the hockey sport module. Cluster Puck Hockey League.
 *
 * Same contract as sports/baseball.js: PURE and SEEDED. `simGame(matchup, players,
 * rand)` with the same three arguments returns the same game forever, on every
 * client, with nothing written to the database. Every roll in this file goes
 * through `rand` — there is no Math.random() anywhere, and there must never be,
 * because the whole league is a function of the slot index.
 *
 * WHAT MAKES IT HOCKEY RATHER THAN RESKINNED BASEBALL:
 *
 *  · The atomic unit is a SCORING CHANCE, not an at-bat. Baseball has ~76 discrete
 *    outcomes a game and has to thin them; hockey has ~5 goals, so the beat is the
 *    chance (~34/game, ~18% convert) and the density comes out about the same.
 *  · {strength} is live state. A penalty puts a man in the box and every beat after
 *    it knows about it, which is why almost every line can be situationally aware
 *    for free.
 *  · Violence has consequences. This is Blood Bowl on ice: a bad hit ends a
 *    player's night and his side finishes SHORT — no mid-game replacement. A fight
 *    loser serves five and the winner's team gets the power play (the Blades of
 *    Steel rule, not the real one, because a fight should move the scoreboard).
 *  · Sudden death is literal. Level after three periods → overtime that ends on the
 *    first goal OR the first fatality, whichever lands first.
 *
 * EVERY BEAT IS NARRATABLE. If the sim emits it, data/scripts/hockey.bsm has a pool
 * for it. Nothing may exist only as an animation — text-only viewers get the whole
 * game. See docs/bsm-format.md#sports-broadcasts-type-sports.
 */
import { sportsShuffle, sportsRng, sportsHash } from '../rng.js';
import { narrate } from './hockey-narrator.js';

// ── chance outcomes ──────────────────────────────────────────────────────────
// Tuned so a game lands around 5–6 goals on 55–65 shots: roughly a 10–11% shooting
// percentage once the non-shot outcomes (blocked, wide) are taken out.
export const CHANCE_TABLE = [
  { kind: 'save',      w: 300, shot: true },
  { kind: 'glove',     w: 74,  shot: true },
  { kind: 'pad',       w: 78,  shot: true },
  { kind: 'blocked',   w: 120, shot: false },
  { kind: 'wide',      w: 128, shot: false },
  { kind: 'post',      w: 26,  shot: true },
  { kind: 'breakaway', w: 22,  shot: true },
  // ~5.5% of chances. A period runs ~33 chances, so three periods is ~100 — at the
  // 16% this started on that produced EIGHTEEN goals a game. Shots were already
  // right (~56/game); it was purely the conversion rate that was wrong.
  { kind: 'goal',      w: 42,  shot: true },
];
const CHANCE_TOTAL = CHANCE_TABLE.reduce((s, o) => s + o.w, 0);

// Situational tunables — the knobs, all in one place.
const PERIODS = 3, PERIOD_SECS = 20 * 60;
const GAP_MIN = 18, GAP_MAX = 54;          // seconds of clock between chances
const PP_GOAL_MULT = 2.6;                  // a power play is worth ~2.6x on the chance
const SH_GOAL_MULT = 0.22;                 // shorthanded goals are a rare tail
const EN_GOAL_MULT = 3.4;                  // shooting at an unguarded cage
const PENALTY_CHANCE = 0.055;              // per chance-gap
const FIGHT_CHANCE = 0.030;                // per chance-gap; suppressed during a PP
const BOARDS_CHANCE = 0.075;               // a hit finished into the boards
const SCRUM_CHANCE = 0.060;                // bodies converging on a dead puck
const INJURY_ON_BOARDS = 0.085;            // that hit ended his night — see the injury band below
const PULL_WINDOW = 90;                    // seconds left when a trailing side pulls
const OT_SECS = 5 * 60;
const OT_FATAL = 0.09;                     // per OT chance-gap: somebody doesn't get up

const INFRACTIONS = [
  ['tripping', 2], ['hooking', 2], ['slashing', 2], ['high-sticking', 2],
  ['cross-checking', 2], ['interference', 2], ['roughing', 2], ['holding', 2],
  ['boarding', 5], ['charging', 5], ['spearing', 5], ['butt-ending', 5],
];
// The fallback pool, used only when a script ships no `::players`. Sized past
// 16 clubs × 6 so the fallback deals disjoint rosters too rather than quietly
// putting the same man on three teams — the failure mode this list exists to avoid.
export const DEFAULT_NAMES = [
  'Vasko', 'Halstrom', 'Deschamps', 'Prieto', 'Kolar', 'Bergqvist', 'Rennie', 'Ozawa',
  'Tvardovsky', 'Mullane', 'Ferro', 'Nyquist', 'Sandoval', 'Ilves', 'Broz', 'Okonkwo',
  'Rask', 'Petrosyan', 'Lindqvist', 'Achterberg', 'Moreau', 'Kovach', 'Wicks', 'Delacroix',
  'Bhandari', 'Osei', 'Tremblay', 'Nowak', 'Quist', 'Sepulveda', 'Yablonsky', 'Crane',
  'Voss', 'Aitkenhead', 'Marchetti', 'Ruiz', 'Solheim', 'Danilenko', 'Oyelaran', 'Brandt',
  'Kuznetsov', 'Frye', 'Malinowski', 'Arceneaux', 'Toivonen', 'Hargreaves', 'Baptiste', 'Szabo',
  'Mulvaney', 'Cordero', 'Ganguly', 'Vetrov', 'Lindgren', 'Abernathy', 'Kozak', 'Nakamura',
  'Fitzhugh', 'Draganov', 'Espinoza', 'Whitlock', 'Tarasenko', 'Halloran', 'Weiss', 'Adebayo',
  'Pankratov', 'Cifuentes', 'Duguay', 'Novikov', 'Strand', 'Bellwether', 'Ferreira', 'Zielinski',
  'Marsh', 'Okafor', 'Rautio', 'Villanueva', 'Grimaldi', 'Hovland', 'Trent', 'Amankwah',
  'Pribyl', 'Castellanos', 'Larkin', 'Ibarra', 'Mbeki', 'Radzinsky', 'Coburn', 'Alferov',
  'Nystrom', 'Guzman', 'Threlfall', 'Sorokin', 'Barrientos', 'Haugen', 'Onyekwere', 'Pilkington',
  'Vidal', 'Emsworth', 'Kalinowski', 'Torvald', 'Bergeron', 'Nagata',
];
const POSITIONS = ['LW', 'C', 'RW', 'D', 'D'];
const ROSTER_SIZE = POSITIONS.length + 1;    // five skaters and the man in the net

// ── persistent injuries ──────────────────────────────────────────────────────
// An injury that heals by the next airing costs a club nothing, and "his season is
// over" is the most interesting sentence this sport can produce. So a man carried off
// is out for a RANGE OF SLOTS, and the clubs that lose people lose games.
//
// THE HARD PART IS NOT THE INJURY, IT IS DETERMINISM. Every game in this league is a
// pure function of its slot — that is what lets standings be a zero-write fold and
// every TV render the same game. An injury that persists makes game N depend on games
// before it, which would break that outright if it were stored anywhere.
//
// It isn't. The schedule is deterministic, so THE INJURY LEDGER IS ALSO A PURE FUNCTION
// OF THE SLOT: fold the season's games forward in order, carrying who is hurt and until
// when, and every server arrives at the same ledger with nothing written down. The
// broadcast plugin owns that chain (`ledgerAt`) and hands the result in as
// `opts.unavailable`; the standings fold walks the SAME chain in the same order, so the
// table and the broadcast cannot disagree about who was playing.
// TUNED AGAINST THE WHOLE LEAGUE, not against one hit. At the first pass (16% of
// boards hits, 2-26 slots) FORTY PER CENT of the league was hurt at any moment, which
// makes ''their best man is out'' meaningless — an absence only lands when it is rare.
// These numbers hold the league at roughly one man in eight.
const INJURY_SLOTS_MIN = 2;    // ~a quarter of an in-game day off — a knock
const INJURY_SLOTS_MAX = 16;   // two game-days — a genuinely season-shaping loss
// Beyond this a club must be able to ice a team from somewhere, so nobody is ever
// unavailable for longer than the ledger window the chain carries.
export const INJURY_MAX_SLOTS = INJURY_SLOTS_MAX;

// ── club identity ────────────────────────────────────────────────────────────
// Sixteen clubs that behave identically are sixteen names. A club's character is
// derived from its NAME — so it costs no authoring, needs no storage, is identical
// on every server forever, and a club added to the .bsm arrives with a personality
// already formed. The traits are deliberately narrow multipliers: wide enough that
// the Longwatch Goons visibly fight more and the Ashway Zambonis visibly can't
// finish, narrow enough that no club is unwatchable.
//
// This is the ONE place the league stops being uniform, so it's worth being precise
// about what each knob does:
//   shooting     — how often this club's chances become goals
//   goaltending  — how much this club's netminder suppresses the other side's
//   discipline   — how often it takes a penalty (LOW discipline = more penalties)
//   violence     — how often it fights and finishes checks into the boards
const CLUB_COLOURS = [
  ['#c8382f', '#f2e4d0'], ['#2f6fd0', '#e8f1fb'], ['#1f8a5a', '#eaf6ef'], ['#d08a1f', '#241a08'],
  ['#7a2fd0', '#efe6fb'], ['#0f9aa8', '#e6f7f8'], ['#b8143c', '#f6e2e8'], ['#3d4a5c', '#dfe6ee'],
  ['#8a6a2f', '#f4ecd8'], ['#2f8ad0', '#e4f0fa'], ['#a83a12', '#f7e6dd'], ['#5c8a1f', '#eef6e0'],
  ['#c02f7a', '#fbe5f1'], ['#1f4f8a', '#e2ebf6'], ['#8a1f1f', '#f6e3e3'], ['#4a4a4a', '#e8e8e8'],
];
// Hash the name once and spend the bits on separate traits, so two clubs whose names
// happen to hash close together don't come out as the same club.
export function clubProfile(name) {
  const h = sportsHash(0, 0);   // seeds the mixer; the name is folded in below
  let x = h >>> 0;
  for (let i = 0; i < String(name).length; i++) x = (Math.imul(x ^ String(name).charCodeAt(i), 16777619) >>> 0);
  const bits = (shift, span) => ((x >>> shift) & 0xff) / 255 * span;
  const p = {
    name,
    shooting: 0.86 + bits(0, 0.30),        // 0.86 … 1.16
    goaltending: 0.86 + bits(6, 0.30),     // 0.86 … 1.16 (higher = harder to beat)
    discipline: 0.62 + bits(12, 0.86),     // 0.62 … 1.48 (lower = more penalties)
    violence: 0.55 + bits(18, 1.25),       // 0.55 … 1.80
    colours: CLUB_COLOURS[x % CLUB_COLOURS.length],
  };
  // A pure hash can't read, and these club names were AUTHORED to mean something —
  // it is absurd for the Longwatch Goons to come out as the league's gentlest side
  // because their name happened to hash low. So the name nudges its own trait after
  // the roll: the hash still decides where in the band a club sits, the word decides
  // which band. Additive and clamped, so a nudge tilts a club without flattening the
  // spread into "every club called Goons is identical".
  const n = String(name).toLowerCase();
  const nudge = (words, key, by) => { if (words.some(w => n.includes(w))) p[key] = Math.max(0.5, Math.min(1.9, p[key] + by)); };
  nudge(['goon', 'slasher', 'grinder', 'boarder', 'bender', 'mucker'], 'violence', 0.32);
  nudge(['goon', 'slasher', 'bender'], 'discipline', -0.26);        // they get caught, too
  nudge(['sniper', 'icehauler'], 'shooting', 0.09);
  nudge(['warden', 'whip', 'watch'], 'goaltending', 0.08);
  nudge(['slush', 'drifter', 'zamboni'], 'shooting', -0.07);        // clubs named for the ice, not the game
  return p;
}

// ── rivalries ────────────────────────────────────────────────────────────────
// Every club has exactly ONE rival, and the pairing is derived from the league the
// same way rosters are: sort, shuffle with a fixed seed, pair adjacent. Nothing is
// authored, so a club added to the .bsm gets a rival on arrival and the whole league
// re-pairs (which is what an expansion does to a schedule anyway).
//
// A rivalry is not a label — it changes the game. Two clubs that hate each other take
// more penalties and drop the gloves more often, so a rivalry night is visibly a
// different night, and the announcer can say so because the sim agrees with him.
const RIVALRY_VIOLENCE = 1.7;    // multiplier on fights and boards in a grudge match
const RIVALRY_PENALTY = 1.45;    // and on the arm going up
export function rivalOf(team, teams) {
  const league = (Array.isArray(teams) && teams.length > 1) ? [...teams].sort() : null;
  if (!league) return null;
  const order = sportsShuffle(league, sportsRng(sportsHash(league.length, 0x21a5)));
  const i = order.indexOf(team);
  if (i < 0) return null;
  // Pair adjacent: 0↔1, 2↔3, … An odd league leaves the last club without one, which
  // is honest — somebody has to be nobody's rival.
  const j = i % 2 === 0 ? i + 1 : i - 1;
  return order[j] || null;
}
const areRivals = (a, b, teams) => !!a && !!b && rivalOf(a, teams) === b;

// ── rosters ──────────────────────────────────────────────────────────────────
// A MAN BELONGS TO ONE CLUB. Before this existed the sim reshuffled the whole name
// pool for every game, so a skater played for whoever that game's seed dealt him to
// — which is invisible for a single broadcast and nonsense the moment anything spans
// more than one. The scoring race was the thing that exposed it: it added a man's
// goals together across four different sweaters and called him a leader.
//
// The deal is a pure function of the LEAGUE, not of the game: sort the clubs, shuffle
// the pool once with a fixed seed, and hand each club the next disjoint six. Nothing
// is stored, every server computes the identical rosters forever, and a club's centre
// is the same man taking every draw all season — which is what makes the scoring race,
// the casualty list and "{shooter} came up through the Ashway" mean anything.
//
// The sort is what keeps it stable: clubs arrive in schedule order, which varies by
// slot, so dealing in arrival order would reshuffle the league every game.
export function rosterFor(teamName, teams, pool) {
  const names = (Array.isArray(pool) && pool.length) ? pool : DEFAULT_NAMES;
  const league = (Array.isArray(teams) && teams.length) ? [...teams].sort() : [teamName];
  const idx = Math.max(0, league.indexOf(teamName));
  // Seeded off the league's SIZE only, so adding a club re-deals the whole league (as
  // an expansion draft would) but a normal night never does.
  const dealt = sportsShuffle(names, sportsRng(sportsHash(league.length, 0x1ce)));
  const out = [];
  // The modulo is a graceful degradation, not a design: a pool too small for the
  // league (fewer than clubs × 6 names) starts sharing men between clubs rather than
  // crashing. content:lint can't catch that, so `npm run test:regress` asserts it.
  for (let k = 0; k < ROSTER_SIZE; k++) out.push(names.length ? dealt[(idx * ROSTER_SIZE + k) % dealt.length] : `Skater ${k + 1}`);
  return out;
}

// The reserve: every name in the pool that no club's first six claimed. This is why the
// player list should run comfortably past `clubs × 6` — the slack IS the reserve, and a
// league with none of it cannot replace anybody.
export function reservePool(teams, pool) {
  const names = (Array.isArray(pool) && pool.length) ? pool : DEFAULT_NAMES;
  const league = (Array.isArray(teams) && teams.length) ? [...teams].sort() : [];
  const claimed = new Set();
  for (const t of league) for (const n of rosterFor(t, league, names)) claimed.add(n);
  return names.filter(n => !claimed.has(n));
}

// The six a club can actually ice tonight. Anyone in `unavailable` is replaced by a
// call-up, chosen deterministically from the reserve so every server dresses the same
// player. Call-ups are marked, because a kid up from the reserve is not the man he
// replaced and the announcer should be able to say so.
//
// A club can NEVER ice fewer than six. If the reserve is exhausted the injured man
// plays hurt — which is bleak, in keeping, and infinitely better than a crash.
export function icedRoster(team, teams, pool, unavailable) {
  const base = rosterFor(team, teams, pool);
  if (!unavailable || !unavailable.size) return base.map(name => ({ name, callup: false, replacing: '' }));
  const reserve = reservePool(teams, pool);
  const league = (Array.isArray(teams) && teams.length) ? [...teams].sort() : [team];
  // Offset the club's draw into the reserve so two clubs calling up on the same night
  // don't both reach for the same man.
  let cursor = Math.max(0, league.indexOf(team)) * 3;
  const taken = new Set();
  return base.map((name) => {
    if (!unavailable.has(name)) return { name, callup: false, replacing: '' };
    for (let i = 0; i < reserve.length; i++) {
      const cand = reserve[(cursor + i) % reserve.length];
      if (taken.has(cand) || unavailable.has(cand)) continue;
      taken.add(cand); cursor += i + 1;
      return { name: cand, callup: true, replacing: name };
    }
    return { name, callup: false, replacing: '', playingHurt: true };
  });
}

// ── the nine dots ────────────────────────────────────────────────────────────
// A real sheet has exactly nine faceoff dots and the puck is never dropped anywhere
// else. Which one gets used is not decoration — it's the rule, and it's the single
// clearest signal of what just happened:
//
//   C          centre ice. Period starts and AFTER EVERY GOAL, only.
//   {a|h}Z{L|R}  the four end-zone dots, inside a defending team's circles. The puck
//              died in that end: the goalie froze it, or that side took a penalty.
//   {a|h}N{L|R}  the four neutral-zone dots, outside the blue lines. Everything else
//              that stops play without either end being at fault.
//
// `aZL` means the AWAY team's defensive zone — the end away is defending — because
// that's the frame the announcer uses ("back into the away end"). The renderer maps
// these ids to coordinates; nothing else needs to know the geometry.
export const FACEOFF_DOTS = ['C', 'aZL', 'aZR', 'aNL', 'aNR', 'hNL', 'hNR', 'hZL', 'hZR'];
// Odds the goalie simply holds a save rather than leaving a rebound. A frozen puck is
// the most common whistle in hockey, and it's what puts a faceoff in the defending end.
const FREEZE_ON_SAVE = 0.42;

const pick = (arr, rand) => arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
const clockStr = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const ordinal = (n) => ['', '1st', '2nd', '3rd', 'OT', '2OT'][n] || `${n}th`;

// Neutral factual label for the Gameday play card, distinct from the announcer's
// flavour line — exactly the split baseball's playDesc makes.
const DESC = {
  save: 'Save', glove: 'Glove Save', pad: 'Pad Save', blocked: 'Shot Blocked',
  wide: 'Shot Wide', post: 'Off the Post', breakaway: 'Breakaway Stopped', goal: 'GOAL',
};
export function playDesc(b) {
  if (b.type === 'goal') {
    const s = b.strength === 'pp' ? ' (PP)' : b.strength === 'sh' ? ' (SH)' : b.strength === 'en' ? ' (EN)' : '';
    return `Goal${s} — ${b.shooter}`;
  }
  if (b.type === 'penalty') return `${b.penaltyMin}:00 ${b.infraction} — ${b.player}`;
  if (b.type === 'fight') return `Fight — ${b.winner} over ${b.loser}`;
  if (b.type === 'injury') return `${b.player} — out for the game`;
  if (b.type === 'death') return `${b.player} — DEAD`;
  if (b.type === 'boards') return `Big hit — ${b.hitter} on ${b.victim}`;
  return DESC[b.kind] || 'Chance';
}

// ── possession colour ────────────────────────────────────────────────────────
// The Gameday analogue of baseball's synthPitches: a sparse keyframe chain the
// client splines and improvises around. Cosmetic only — the outcome is already
// decided by the sim and is passed in, so this can never change the result.
export function synthPossession(seed, kind, side) {
  const rand = sportsRng(seed);
  const dir = side === 0 ? 1 : -1;
  const startX = side === 0 ? 0.22 : 0.78, netX = side === 0 ? 0.955 : 0.045;
  // WHO STARTS IT IS ROLLED, not fixed at zero. With a hardcoded carrier the same man
  // broke his club out on every single rush of every game — invisible while the chain
  // was only ever animated, and glaring the moment the booth started naming him.
  const nodes = [{ t: 0, p: [startX, 0.28 + rand() * 0.44], ev: 'breakout', carrier: Math.floor(rand() * 5) }];
  const n = 2 + Math.floor(rand() * 3);
  for (let i = 1; i <= n; i++) {
    const f = i / (n + 1);
    // MORE KINDS OF TOUCH, because both halves of the broadcast read this list. The
    // chain used to alternate between exactly two middle events — a pass or a cycle —
    // so every rush in the league was built the same way and the booth had two verbs to
    // describe it with. A `battle` is a puck nobody owns yet (carrier −1), which the
    // rink turns into a genuine race between the two nearest men; a `deke` and a `dump`
    // are things one man does. All of it is COLOUR: the outcome arrived decided.
    const r = rand();
    const ev = i === 1 ? 'entry'
      : r < 0.30 ? 'pass'
      : r < 0.50 ? 'cycle'
      : r < 0.68 ? 'battle'
      : r < 0.84 ? 'deke'
      : 'dump';
    nodes.push({
      t: Math.round(f * 0.8 * 100) / 100,
      p: [startX + (netX - startX) * f * (0.72 + rand() * 0.5), 0.16 + rand() * 0.68],
      ev,
      // A loose puck belongs to nobody until somebody wins it — which is exactly what
      // `carrier: -1` already means everywhere else in this chain.
      carrier: ev === 'battle' ? -1 : Math.floor(rand() * 5),
    });
  }
  nodes.push({ t: 0.88, p: [netX - dir * (0.07 + rand() * 0.05), 0.36 + rand() * 0.28], ev: 'shot', carrier: -1 });
  const endY = kind === 'wide' ? (rand() < 0.5 ? 0.2 : 0.8) : 0.42 + rand() * 0.16;
  nodes.push({ t: 1, p: [kind === 'blocked' ? netX - dir * 0.14 : netX, endY], ev: kind, carrier: -1 });
  return nodes;
}

// ── the build-up ─────────────────────────────────────────────────────────────
// THE WORDS AND THE PICTURE TELL THE SAME RUSH. The possession keyframes were animated
// by the rink and thrown away by the booth, so the announcer's entire account of a
// scoring chance was its LAST event — "saved" — laid over ten seconds of a play he never
// mentioned. The viewer watched a breakout, a zone entry and two passes, and heard about
// none of it. This walks the SAME chain the view splines and says what happened on the
// way up the ice, naming the men the carrier indices already point at.
//
// It decides nothing and invents nothing. It is a reading of keyframes that exist, which
// is precisely why the call can never disagree with what is on the screen — the one
// failure mode a generated play-by-play has that a human one doesn't.
const RUSH = {
  breakout: ['carries it out of his own end', 'starts it from behind his own net', 'digs it out of the corner', 'takes it up the boards'],
  entry: ['gains the line', 'carries it in over the blue', 'steps into the zone', 'walks it in'],
  cycle: ['works it down low', 'takes it behind the net', 'cycles it along the wall', 'holds it in the corner'],
  carry: ['drives the middle', 'cuts across the slot', 'pushes it wide'],
  // A man beating a man. The one event in the chain that is about somebody losing.
  deke: ['puts a man on his hip', 'dangles through the first check', 'cuts back and leaves him', 'toe-drags around a stick'],
  dump: ['chips it in behind them', 'dumps it deep', 'flips it in and goes after it'],
};
// A loose puck belongs to nobody, so it needs a sentence with no owner in it — the
// carrier index on a `battle` node is −1 and there is deliberately no man to name until
// somebody wins it.
const RUSH_BATTLE = ['it comes loose along the wall', 'the puck is free in the corner', 'a scramble for it below the dot', 'they both go in after it'];
const RUSH_WON = ['comes out with it', 'wins it', 'digs it free', 'comes up with the puck'];
const RUSH_PASS = ['finds', 'feeds', 'slides it across to', 'puts it on the tape of', 'drops it back for'];

// `names` is the attacking side's skaters in the order the carrier indices count.
export function describeRush(nodes, names, rand) {
  if (!Array.isArray(nodes) || !Array.isArray(names) || !names.length) return '';
  const who = (i) => names[((i | 0) % names.length + names.length) % names.length] || '';
  const parts = [];
  let holder = null;
  for (const n of nodes) {
    // Four clauses, not three. A battle costs a clause to say the puck came loose and
    // another to say who won it, so a three-clause cap swallowed the entry or the shot
    // set-up every time one appeared.
    if (!n || n.ev === 'shot' || parts.length >= 4) continue;
    // The outcome events (goal, save, wide…) are the END of the chain and are the
    // announcer's own line — the build-up stops at the shot, deliberately.
    if (!RUSH[n.ev] && n.ev !== 'pass' && n.ev !== 'battle') continue;
    if (n.ev === 'battle') {
      // Nobody owns it, so nobody is named — and whoever holds it next won it, which is
      // the next clause writing itself. This is why `battle` sets `holder` to null.
      parts.push(pick(RUSH_BATTLE, rand));
      holder = null;
      continue;
    }
    if (n.ev === 'pass') {
      const to = who(n.carrier);
      // A pass with nobody holding it yet has no sentence — skip rather than invent a
      // passer, because a named man who wasn't there is worse than a shorter call.
      if (!holder || !to || to === holder) { holder = to || holder; continue; }
      parts.push(`${parts.length ? '' : `${holder} `}${pick(RUSH_PASS, rand)} ${to}`);
      holder = to;
      continue;
    }
    const man = who(n.carrier);
    if (!man) continue;
    // Straight out of a loose puck, the first thing said about the man who has it is
    // that he WON it — "the puck is free in the corner, Voss comes out with it" — which
    // is what turns two adjacent clauses into one passage of play.
    if (holder === null && parts.length) { parts.push(`${man} ${pick(RUSH_WON, rand)}`); holder = man; continue; }
    // NAME HIM WHENEVER THE PUCK CHANGES HANDS, not only in the first clause. Naming
    // only once read as a single man doing everything — and then produced sentences
    // like "Renna digs it out … feeds Renna", because the carrier had silently changed
    // twice in between and the pass appeared to be to himself.
    parts.push(`${man === holder ? '' : `${man} `}${pick(RUSH[n.ev], rand)}`);
    holder = man;
  }
  if (!parts.length) return '';
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

// The fight exchange, same idea: a beat sequence the view can render richly or
// ignore entirely and just read `winner` from.
export function synthFightExchange(seed, a, b) {
  const rand = sportsRng(seed);
  const n = 6 + Math.floor(rand() * 7);
  const out = [];
  let stagA = 0, stagB = 0;
  for (let i = 0; i < n; i++) {
    const byA = rand() < 0.5;
    const landed = rand() < 0.62;
    if (landed) { if (byA) stagB += 1; else stagA += 1; }
    out.push({ n: i + 1, thrower: byA ? a : b, type: rand() < 0.3 ? 'uppercut' : 'right', landed, stagger: byA ? stagB : stagA });
  }
  return out;
}

// ── the sim ──────────────────────────────────────────────────────────────────
export function simGame(matchup, players, rand = Math.random, opts = {}) {
  // Who cannot play tonight, from the injury chain the caller owns (see ledgerAt in
  // plugins/broadcast/index.js). An empty set is an ordinary healthy night, which is
  // why every existing three-argument caller keeps working unchanged.
  const unavailable = opts.unavailable instanceof Set ? opts.unavailable : new Set(opts.unavailable || []);
  const awayName = matchup?.away || 'Away', homeName = matchup?.home || 'Home';
  // The club list, when the caller knows it (sportsGameForSlot passes it), is what
  // makes rosters a property of the LEAGUE rather than of this game. Without it each
  // club still gets a stable six — they just may share men, which is the honest
  // degradation for a caller that only handed us two names.
  const league = Array.isArray(matchup?.teams) && matchup.teams.length ? matchup.teams : [awayName, homeName];
  const mk = (name) => {
    const dressed = icedRoster(name, league, players, unavailable);
    const roster = dressed.map(d => d.name);
    return {
      name,
      dressed,
      score: 0,
      // Five skaters + a goalie, the same six every night. `out` players are gone for
      // the rest of the game and are NOT replaced — that is what makes an injury cost
      // more than a penalty.
      profile: clubProfile(name),
      skaters: POSITIONS.map((pos, k) => ({ name: roster[k], pos, goals: 0, assists: 0, out: false, dead: false, callup: !!dressed[k].callup, replacing: dressed[k].replacing || '' })),
      goalie: roster[POSITIONS.length],
      box: [],            // [{ name, until }] — penalties currently being served
      pulled: false,
    };
  };
  const away = mk(awayName);
  const home = mk(homeName);
  // A grudge match is a different game, not a different caption.
  const rivalry = areRivals(awayName, homeName, matchup?.teams);
  const rivalryVio = rivalry ? RIVALRY_VIOLENCE : 1;
  const rivalryPen = rivalry ? RIVALRY_PENALTY : 1;

  const beats = [];
  let period = 0, clock = 0, gameOver = false, deadPlayer = null;

  const live = (t) => t.skaters.filter(s => !s.out);
  const anyone = (t) => { const l = live(t); return l.length ? l[Math.floor(rand() * l.length)] : null; };
  const serving = (t, at) => t.box.filter(p => p.until > at).length;

  // Strength from the two boxes, plus an empty net if anyone has pulled.
  function strengthOf(att, def, at) {
    const a = 5 - serving(att, at) - (att.skaters.filter(s => s.out).length ? 0 : 0);
    const d = 5 - serving(def, at);
    if (def.pulled) return 'en';
    if (a > d) return 'pp';
    if (a < d) return 'sh';
    return 'even';
  }

  const push = (o) => beats.push({ period, clock: Math.max(0, Math.round(clock)), clockStr: clockStr(Math.max(0, clock)),
    awayScore: away.score, homeScore: home.score, ...o });

  // `att`/`def` carry the two clubs' profiles: a good shooting side against a weak
  // goaltender is the swing, and it compounds with the strength multiplier exactly as
  // it should — a power play against a bad netminder is where games get away.
  function rollChance(strength, att, def) {
    const base = strength === 'pp' ? PP_GOAL_MULT : strength === 'sh' ? SH_GOAL_MULT : strength === 'en' ? EN_GOAL_MULT : 1;
    const mult = base * ((att?.profile?.shooting ?? 1) / (def?.profile?.goaltending ?? 1));
    let total = 0;
    const weights = CHANCE_TABLE.map(o => { const w = o.kind === 'goal' ? o.w * mult : o.w; total += w; return w; });
    let roll = rand() * total;
    for (let i = 0; i < CHANCE_TABLE.length; i++) { roll -= weights[i]; if (roll <= 0) return CHANCE_TABLE[i]; }
    return CHANCE_TABLE[0];
  }

  // ── HOW IT WAS SHOT ─────────────────────────────────────────────────────────
  // The sim decided WHETHER a chance went in and never what it was struck with, so every
  // goal in the league was hit the same way: the booth said "he scores" and the rink
  // played one generic wind-up. The type is rolled here, on the same beat as the outcome,
  // so the words and the animation are reading the identical fact — a slapshot is called a
  // slapshot AND drawn as one, and neither can drift from the other.
  //
  // WEIGHTED BY WHAT ACTUALLY HAPPENED. A one-timer and a tip-in are things you do to a
  // pass, so they are only reachable when the chain ends in one; a wraparound comes from
  // behind the net, so it needs the puck to have been down low. Rolling these blind would
  // put wraparounds on point shots.
  function rollShot(nodes) {
    const last = Array.isArray(nodes) ? nodes[nodes.length - 2] : null;
    const offPass = !!last && last.ev === 'pass';
    const downLow = !!last && Array.isArray(last.p) && (last.p[0] > 0.88 || last.p[0] < 0.12);
    const table = [
      { id: 'wrist', w: 300, label: 'wrist shot' },
      { id: 'snap', w: 170, label: 'snap shot' },
      { id: 'slap', w: 150, label: 'slapshot' },
      { id: 'backhand', w: 105, label: 'backhand' },
      { id: 'onetimer', w: offPass ? 210 : 0, label: 'one-timer' },
      { id: 'tip', w: offPass ? 120 : 0, label: 'tip-in' },
      { id: 'wrap', w: downLow ? 90 : 0, label: 'wraparound' },
    ];
    let total = 0; for (const t of table) total += t.w;
    let roll = rand() * total;
    for (const t of table) { roll -= t.w; if (roll <= 0) return t; }
    return table[0];
  }

  function penalise(team, at, forced) {
    const s = anyone(team); if (!s) return null;
    const [infraction, mins] = forced || pick(INFRACTIONS, rand);
    team.box.push({ name: s.name, until: at - mins * 60 });
    push({ type: 'penalty', teamName: team.name, player: s.name, infraction, penaltyMin: mins,
      strength: '', section: ordinal(period) });
    return s;
  }

  // A fight: both men throw, one wins, the LOSER serves five and the winner's side
  // goes on the power play. Not the real rule — a much better one.
  function fight(att, def, at) {
    const a = anyone(att), b = anyone(def);
    if (!a || !b) return;
    const aWins = rand() < 0.5;
    const winner = aWins ? a : b, loser = aWins ? b : a;
    const loserTeam = aWins ? def : att;
    const exchange = synthFightExchange(Math.floor(rand() * 1e9), winner.name, loser.name);
    loserTeam.box.push({ name: loser.name, until: at - 5 * 60 });
    push({ type: 'fight', fighters: [a.name, b.name], winner: winner.name, loser: loser.name,
      loserTeam: loserTeam.name, winnerTeam: (aWins ? att : def).name, exchange,
      section: ordinal(period) });
  }

  function bigHit(att, def, at) {
    const hitter = anyone(att), victim = anyone(def);
    if (!hitter || !victim) return;
    push({ type: 'boards', hitter: hitter.name, victim: victim.name,
      hitterTeam: att.name, victimTeam: def.name, section: ordinal(period) });
    if (rand() < INJURY_ON_BOARDS) {
      victim.out = true;
      // How long he is gone for is decided HERE, by the game's own rand, so the
      // duration is as deterministic as the injury and the ledger can be rebuilt from
      // the schedule alone.
      const slotsOut = INJURY_SLOTS_MIN + Math.floor(rand() * (INJURY_SLOTS_MAX - INJURY_SLOTS_MIN + 1));
      victim.slotsOut = slotsOut;
      push({ type: 'injury', player: victim.name, teamName: def.name, slotsOut,
        remaining: live(def).length, section: ordinal(period) });
      faceoff(endDot(def), 'injury');   // play stops while they get him off the ice
    }
  }

  function scrum(att, def) {
    push({ type: 'scrum', teams: [att.name, def.name], section: ordinal(period) });
  }

  // ── faceoffs ───────────────────────────────────────────────────────────────
  // Play does not resume until the puck is dropped, so a faceoff is emitted for every
  // stoppage and NEVER anywhere else. The dot is chosen by the rule, not by taste:
  // centre after a goal or to start a period, the offending/defending end after a
  // penalty or a frozen puck, the neutral zone for everything else. That means the
  // dot alone tells a reader what just happened, which is why it's worth simulating
  // rather than sprinkling "puck's down at the dot" at random.
  //
  // The draw is taken by the centres. A club that has lost its C to a stretcher takes
  // it with whoever is left — being short costs you the dot as well as the man.
  const centreman = (t) => live(t).find(s => s.pos === 'C') || live(t)[0] || null;
  let foAway = 0, foHome = 0;
  const endDot = (t) => `${t === away ? 'a' : 'h'}Z${rand() < 0.5 ? 'L' : 'R'}`;
  const neutralDot = (t) => `${t === away ? 'a' : 'h'}N${rand() < 0.5 ? 'L' : 'R'}`;
  function faceoff(dot, reason) {
    const a = centreman(away), h = centreman(home);
    if (!a || !h) return;
    // The short-handed side is worse on the draw — a real and rarely-modelled cost of
    // the box, and the reason a power play so often starts with possession.
    const aEdge = 0.5 + (live(away).length - live(home).length) * 0.06
      + (serving(home, clock) - serving(away, clock)) * 0.05;
    const awayWins = rand() < Math.max(0.15, Math.min(0.85, aEdge));
    if (awayWins) foAway++; else foHome++;
    push({
      type: 'faceoff', dot, reason: reason || '',
      winner: (awayWins ? a : h).name, loser: (awayWins ? h : a).name,
      winTeam: (awayWins ? away : home).name, loseTeam: (awayWins ? home : away).name,
      foAway, foHome, section: ordinal(period),
    });
  }

  // ── a period ───────────────────────────────────────────────────────────────
  function playPeriod(secs, sudden) {
    clock = secs;
    push({ type: 'period_start', section: ordinal(period), sudden: !!sudden,
      strength: strengthOf(away, home, clock) });
    faceoff('C', 'period');   // every period opens at centre ice. No exceptions.

    while (clock > 0 && !gameOver) {
      const gap = GAP_MIN + rand() * (GAP_MAX - GAP_MIN);
      clock -= gap;
      if (clock < 0) clock = 0;

      // trailing side pulls the goalie late in regulation
      if (!sudden && period === PERIODS && clock < PULL_WINDOW && clock > 0) {
        for (const [t, o] of [[away, home], [home, away]]) {
          const down = o.score - t.score;
          if (!t.pulled && down > 0 && down <= 2) {
            t.pulled = true;
            push({ type: 'pull', teamName: t.name, down, section: ordinal(period) });
          }
        }
      }

      const attackAway = rand() < 0.5;
      const att = attackAway ? away : home, def = attackAway ? home : away;
      if (!live(att).length || !live(def).length) break;

      // off-puck events first: they change strength before the chance resolves
      // Each of these is a WHISTLE, and a whistle is followed by a drop — at the dot
      // the rule sends it to. A penalty goes back to the offending team's end; a fight
      // and a scrum are dead-puck stoppages that restart from the neutral zone.
      {
        // Which club is on the hook is rolled first, then ITS discipline decides
        // whether the arm goes up — so an undisciplined club takes more penalties
        // rather than the league simply calling more of them.
        const pt = rand() < 0.5 ? att : def;
        if (rand() < PENALTY_CHANCE * rivalryPen / (pt.profile?.discipline || 1)) {
          if (penalise(pt, clock)) faceoff(endDot(pt), 'penalty');
        }
      }
      const ppLive = serving(away, clock) || serving(home, clock);
      const meanness = ((att.profile?.violence || 1) + (def.profile?.violence || 1)) / 2 * rivalryVio;
      if (!ppLive && rand() < FIGHT_CHANCE * meanness) { fight(att, def, clock); faceoff(neutralDot(def), 'fight'); }
      if (rand() < BOARDS_CHANCE * (att.profile?.violence || 1) * rivalryVio) bigHit(att, def, clock);
      if (rand() < SCRUM_CHANCE) { scrum(att, def); faceoff(neutralDot(def), 'scrum'); }

      // sudden death can end on a body rather than a goal
      if (sudden && rand() < OT_FATAL) {
        const victim = anyone(def);
        if (victim) {
          victim.out = true; victim.dead = true; deadPlayer = victim.name;
          att.score += 1;
          push({ type: 'death', player: victim.name, teamName: def.name,
            winnerTeam: att.name, section: ordinal(period) });
          gameOver = true;
          break;
        }
      }

      const strength = strengthOf(att, def, clock);
      const out = rollChance(strength, att, def);
      const shooter = anyone(att), goalie = def.goalie;
      if (!shooter) break;

      if (out.kind === 'goal') {
        att.score += 1; shooter.goals += 1;
        const mates = live(att).filter(s => s !== shooter);
        const assist = mates.length && rand() < 0.72 ? mates[Math.floor(rand() * mates.length)] : null;
        if (assist) assist.assists += 1;
        const hat = shooter.goals === 3;
        const goalNodes = synthPossession(Math.floor(rand() * 1e9), 'goal', attackAway ? 0 : 1);
        const goalShot = rollShot(goalNodes);
        push({ type: 'goal', shooter: shooter.name, assist: assist ? assist.name : '', goalie,
          teamName: att.name, oppName: def.name, strength, hattrick: hat,
          shooterGoals: shooter.goals, section: ordinal(period),
          // How it was built. Read off the same keyframes the rink is about to animate.
          rush: describeRush(goalNodes, live(att).map(s => s.name), rand),
          // WHAT HE HIT IT WITH, on the same beat as the outcome, so the call and the
          // animation are reading one fact rather than two that can disagree.
          shotType: goalShot.id, shotLabel: goalShot.label,
          possession: goalNodes });
        if (hat) push({ type: 'hattrick', player: shooter.name, teamName: att.name, section: ordinal(period) });
        if (sudden) { gameOver = true; break; }
        faceoff('C', 'goal');   // a goal is the ONLY thing that sends it back to centre
      } else {
        // The goalie either covers it (whistle → a draw in his own end) or it stays
        // live. This is what makes end-zone dots the commonest in the game.
        const frozen = (out.kind === 'save' || out.kind === 'glove') && rand() < FREEZE_ON_SAVE;
        const chanceNodes = synthPossession(Math.floor(rand() * 1e9), out.kind, attackAway ? 0 : 1);
        const chanceShot = rollShot(chanceNodes);
        push({ type: 'chance', kind: out.kind, shot: out.shot, shooter: shooter.name, goalie,
          teamName: att.name, oppName: def.name, strength, frozen, section: ordinal(period),
          rush: describeRush(chanceNodes, live(att).map(s => s.name), rand),
          shotType: chanceShot.id, shotLabel: chanceShot.label,
          possession: chanceNodes });
        if (frozen) faceoff(endDot(def), 'freeze');
      }
    }

    if (!gameOver) push({ type: 'period_end', section: ordinal(period), sudden: !!sudden });
  }

  for (period = 1; period <= PERIODS && !gameOver; period++) playPeriod(PERIOD_SECS, false);
  period = PERIODS;

  // ── overtime: sudden death, then a shootout. NEVER a tie. ──────────────────
  if (away.score === home.score) {
    period = 4;
    playPeriod(OT_SECS, true);
  }
  if (away.score === home.score) {
    period = 4;
    push({ type: 'shootout_start', section: 'SO' });
    let a = 0, h = 0, round = 0;
    while (round < 3 || a === h) {
      round++;
      for (const [t, other] of [[away, home], [home, away]]) {
        const s = anyone(t); if (!s) continue;
        const scored = rand() < 0.33;
        if (scored) { if (t === away) a++; else h++; }
        push({ type: 'shootout', round, shooter: s.name, teamName: t.name,
          goalie: other.goalie, scored, soAway: a, soHome: h, section: 'SO' });
      }
      if (round >= 40) break;                     // paranoia, never reached
    }
    if (a > h) away.score += 1; else home.score += 1;
    push({ type: 'shootout_end', winner: a > h ? away.name : home.name, soAway: a, soHome: h, section: 'SO' });
  }

  const scorers = [...away.skaters, ...home.skaters]
    .filter(s => s.goals || s.assists)
    .map(s => ({ name: s.name, goals: s.goals, assists: s.assists }));
  push({ type: 'final', winner: away.score > home.score ? away.name : home.name, section: 'F' });

  return {
    away, home, awayScore: away.score, homeScore: home.score, beats,
    sections: period,
    // Did it go past sixty, and how was it settled? The league table pays a point for
    // an overtime loss, so this is a RESULT, not a detail — and only the sim can know
    // it (the score alone can't tell you a 3-2 was won in the shootout).
    rivalry,
    overtime: period > PERIODS,
    shootout: beats.some(b => b.type === 'shootout_end'),
    // Draws won, away/home. The one team stat this sim tracks that isn't on the
    // scoreboard, and the rink view's only honest "possession" number.
    faceoffs: { away: foAway, home: foHome },
    // what the season fold harvests
    scorers,
    // What the injury chain consumes: who went off, for how long, and for whom. A
    // death is permanent and carries no duration — there is nothing to come back from.
    casualties: [...away.skaters, ...home.skaters].filter(s => s.out)
      .map(s => ({ name: s.name, dead: !!s.dead, slotsOut: s.dead ? Infinity : (s.slotsOut || INJURY_SLOTS_MIN),
        team: away.skaters.includes(s) ? away.name : home.name })),
    // Who was dressed out of the reserve tonight, so the booth can name them.
    callups: [...away.dressed, ...home.dressed].filter(d => d.callup)
      .map(d => ({ name: d.name, replacing: d.replacing })),
    dead: deadPlayer,
  };
}

// ── the season ───────────────────────────────────────────────────────────────
// Hockey does not count wins and losses; it counts POINTS, and the whole shape of a
// hockey table comes from the one rule baseball has no equivalent for: losing in
// overtime still pays. Two for a win, one for going the distance and losing anyway.
// That single rule is why a hockey table reads differently from a baseball one, and
// it's why this is worth folding properly rather than reusing W-L.
//
// It also harvests the two things the sim produces that no other sport does: the
// scoring race, and the list of men the season has cost. Both are pure functions of
// the schedule like everything else here — nothing is stored per game.
export const SEASON = {
  finalName: 'Coldwater Cup',
  finalShort: 'CUP',
  columns: ['W', 'L', 'OTL', 'PTS'],
  fold(table, game) {
    const { awayScore, homeScore } = game;
    if (awayScore === homeScore) return;                 // never happens: no ties in this league
    const ot = !!game.overtime;                          // decided past regulation
    const bump = (team, w, l, otl, gf, ga) => {
      const t = table.get(team) || { team, wins: 0, losses: 0, otl: 0, goals_for: 0, goals_against: 0, points: 0 };
      t.wins += w; t.losses += l; t.otl += otl; t.goals_for += gf; t.goals_against += ga;
      t.points += w * 2 + otl;                           // 2 for a win, 1 for losing past sixty
      table.set(team, t);
    };
    const awayWon = awayScore > homeScore;
    // The LOSER's result is the one overtime changes. A win is a win at any hour.
    bump(game.away.name, awayWon ? 1 : 0, (!awayWon && !ot) ? 1 : 0, (!awayWon && ot) ? 1 : 0, awayScore, homeScore);
    bump(game.home.name, awayWon ? 0 : 1, (awayWon && !ot) ? 1 : 0, (awayWon && ot) ? 1 : 0, homeScore, awayScore);
  },
  sort(rows) {
    const gd = (r) => (r.goals_for || 0) - (r.goals_against || 0);
    return rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;      // regulation wins break a tie on points
      if (gd(b) !== gd(a)) return gd(b) - gd(a);
      return a.team.localeCompare(b.team);
    });
  },
  // The scoring race and the butcher's bill, accumulated across the season's games.
  // `acc` is opaque to the caller — only summariseExtras reads it back out.
  foldExtras(acc, game) {
    acc.scorers = acc.scorers || new Map();
    acc.casualties = acc.casualties || [];
    for (const s of game.scorers || []) {
      const r = acc.scorers.get(s.name) || { name: s.name, goals: 0, assists: 0, points: 0 };
      r.goals += s.goals || 0; r.assists += s.assists || 0; r.points = r.goals + r.assists;
      acc.scorers.set(s.name, r);
    }
    for (const c of game.casualties || []) acc.casualties.push({ ...c, teams: [game.away.name, game.home.name] });
  },
  summariseExtras(acc) {
    const scorers = [...(acc.scorers || new Map()).values()]
      .sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name))
      .slice(0, 10);
    const cas = acc.casualties || [];
    return { scorers, injuries: cas.length, deaths: cas.filter(c => c.dead).length };
  },
};

export const HOCKEY = {
  id: 'hockey',
  brand: 'CLUSTER PUCK',
  finalIcon: '🏒',
  season: SEASON,
  section: 'period',
  sectionPlural: 'periods',
  simGame,
  synthDetail: synthPossession,
  playDesc,
  defaultNames: DEFAULT_NAMES,
  ordinal,
  // The presence of `narrate` is what tells assembleSportsGraph to hand this sport
  // the middle of the broadcast instead of running the baseball body. Baseball has
  // no `narrate` and takes the original path untouched.
  narrate,
};

export default HOCKEY;
