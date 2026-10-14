// Variety smoke: Deadball's balls in play over a season of seeded games, and the booth's
// lines they open.
//
// The server decides every ball in play (synthPlay in plugins/broadcast/sports/baseball.js)
// so the picture and the call agree. Thirty games a club means a regular viewer sees every
// kind of play many times, so they shouldn't look alike. Over a season of sim v2 games:
//
//   - grounders go to the hitter's pull side about three times in five, and fly balls spread
//     more evenly;
//   - exit speeds run about 50 to 115 mph, and launch angles from into the dirt to a pop-up;
//   - every fielding grade, every double play, every kind of home run and error turns up, and
//     so does every play sim v2 added;
//   - no two grounders to short are the same ball, and a play stays about 100 bytes on the
//     wire.
//
// Then, over plays made up directly for each kind (a triple play comes up about once in five
// hundred games), every tag a play can carry turns up, and every suffixed line pool in
// data/scripts/baseball.bsm has a play that opens it: a pool named for a tag no play of its
// kind carries would never air.
//
// Phase 3b adds that every clip in the library is reached.
//
// Run:  node scripts/shapes/variety-smoke.mjs

import { readFileSync } from 'node:fs';

const { sportsRng, sportsHash } = await import('../../plugins/broadcast/rng.js');
const B = await import('../../plugins/broadcast/sports/baseball.js');
const { gamedayPayloads } = await import('../../plugins/broadcast/sports/baseball-gameday.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};
const share = (n, of) => (of ? n / of : 0);
const pct = (x) => `${Math.round(x * 100)}%`;

// ── a season ───────────────────────────────────────────────────────────────────
// Eight clubs, thirty games each, is 120 games; twice that, so the rare plays show.
const GAMES = 240;
const fmt = { abbr: (n) => String(n).slice(0, 3).toUpperCase(), ordinal: (n) => `${n}th` };
const plays = [], events = new Set();
for (let s = 1; s <= GAMES; s++) {
  const seed = sportsHash(s, 0x5641);
  const game = B.simGameV2({ away: 'Rats', home: 'Kings' }, null, sportsRng(seed), { seed });
  for (const [b, p] of gamedayPayloads(game, seed, fmt).atbat) {
    events.add(b.type === 'run' ? `run.${b.kind}` : b.kind);
    if (p.play) plays.push({ kind: b.kind, play: p.play, bats: p.bats });
  }
}
check('a season puts thousands of balls in play', plays.length > 10000, String(plays.length));

// Spray by handedness: a ball's pull side is left field for a right-handed hitter.
const pulled = (x) => Math.sign(x.play.dir) === (x.bats === 'L' ? 1 : -1);
const aimed = plays.filter((x) => Math.abs(x.play.dir) >= 3 && Math.abs(x.play.dir) <= 45);
const grounders = aimed.filter((x) => x.play.t === 'gb'), flies = aimed.filter((x) => x.play.t === 'fb');
const gPull = share(grounders.filter(pulled).length, grounders.length), fPull = share(flies.filter(pulled).length, flies.length);
check('grounders go to the pull side about three times in five', gPull >= 0.55 && gPull <= 0.66, pct(gPull));
check('fly balls spread more evenly', fPull >= 0.42 && fPull <= 0.6 && fPull < gPull, pct(fPull));
for (const bats of ['L', 'R']) {
  const mine = grounders.filter((x) => x.bats === bats);
  check(`a ${bats === 'L' ? 'left' : 'right'}-handed hitter pulls his grounders too`, share(mine.filter(pulled).length, mine.length) >= 0.55, String(mine.length));
}

// Exit speed and launch angle cover their range.
const evs = plays.map((x) => x.play.ev), las = plays.map((x) => x.play.la);
const lo = Math.min(...evs), hi = Math.max(...evs);
check('exit speeds run about 50 to 115 mph', lo <= 52 && hi >= 112 && hi <= 120, `${lo}..${hi}`);
const tens = new Set(evs.map((v) => Math.floor(v / 10)));
check('every ten mph from 50 to 110 turns up', [5, 6, 7, 8, 9, 10, 11].every((d) => tens.has(d)), [...tens].sort().join(','));
check('launch angles run from into the dirt to a pop-up', Math.min(...las) <= -20 && Math.max(...las) >= 70, `${Math.min(...las)}..${Math.max(...las)}`);
for (const [kind, t] of [['single', ['gb', 'ld', 'fb']], ['double', ['gb', 'ld', 'fb']]]) {
  const seen = new Set(plays.filter((x) => x.kind === kind).map((x) => x.play.t));
  check(`a ${kind} can be a grounder, a liner or a fly`, t.every((k) => seen.has(k)), [...seen].join(','));
}

// Every grade, double play, home run and error.
const seen = (f) => new Set(plays.map(f).filter(Boolean));
const grades = seen((x) => x.play.g);
const GRADES = ['routine', 'ranging', 'diving', 'sliding', 'leaping', 'barehand', 'rail'];
check('every fielding grade turns up', GRADES.every((g) => grades.has(g)), GRADES.filter((g) => !grades.has(g)).join(', '));
const dps = seen((x) => (x.kind === 'doubleplay' ? x.play.f.join('') : null));
const DPS = ['643', '463', '543', '363', '163', '63', '43'];
check('every double play turns up', DPS.every((d) => dps.has(d)), DPS.filter((d) => !dps.has(d)).join(', '));
const hrs = seen((x) => x.play.hr);
check('every kind of home run turns up', ['nodoubt', 'plain', 'scraper', 'leap', 'pole'].every((h) => hrs.has(h)), [...hrs].join(','));
const errs = seen((x) => x.play.e);
check('every kind of error turns up', ['boot', 'legs', 'drop', 'past', 'stands'].every((e) => errs.has(e)), [...errs].join(','));
const V2 = ['hitbypitch', 'error', 'run.steal', 'run.caughtstealing', 'run.pickoff', 'run.throwover', 'run.doublesteal', 'run.wildpitch', 'run.passedball'];
check('every play sim v2 added turns up', V2.every((e) => events.has(e)), V2.filter((e) => !events.has(e)).join(', '));
const diving = share(plays.filter((x) => x.kind === 'groundout' && x.play.g === 'diving').length, plays.filter((x) => x.kind === 'groundout').length);
const routine = share(plays.filter((x) => x.kind === 'groundout' && x.play.g === 'routine').length, plays.filter((x) => x.kind === 'groundout').length);
check('most groundouts are routine and a dive is rare', routine >= 0.55 && diving > 0 && diving <= 0.06, `routine ${pct(routine)}, diving ${pct(diving)}`);

// No two grounders to short are the same ball.
const toShort = plays.filter((x) => x.play.t === 'gb' && x.play.f[0] === 6).map((x) => [x.play.dir, x.play.ev, x.play.la, x.play.d].join());
check('no two grounders to short are the same ball', toShort.length > 300 && share(new Set(toShort).size, toShort.length) >= 0.95, `${new Set(toShort).size} of ${toShort.length}`);
const bytes = share(plays.reduce((n, x) => n + JSON.stringify(x.play).length, 0), plays.length);
check('a play stays about 100 bytes on the wire', bytes <= 110, `${bytes.toFixed(0)} bytes`);

// ── every tag, and every suffixed pool ──────────────────────────────────────────
// Plays made up for each kind directly, with the hitter, the bags and sim v2's error charged
// round them, so the rare kinds get as many as the common ones.
const ERROR_ON = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const made = new Map();   // kind (an error by its type) -> Set of tags
const tagsFor = (kind) => made.get(kind) || made.set(kind, new Set()).get(kind);
const PER = 1500;
for (const kind of ['groundout', 'productout', 'doubleplay', 'tripleplay', 'flyout', 'sacfly', 'popout', 'single', 'double', 'triple', 'homerun', 'error:fielding', 'error:throwing']) {
  const [k, type] = kind.split(':');
  for (let i = 0; i < PER; i++) {
    const bats = i % 2 ? 'L' : 'R';
    const o = {
      bats, before: [i % 3 === 0, i % 5 === 0, i % 7 === 0], speed: (i % 10) / 9,
      ...(k === 'error' ? { fielder: ERROR_ON[i % ERROR_ON.length], errorType: type } : {}),
    };
    const play = B.synthPlay(sportsHash(i, 0x7a91, kind.length), k, o);
    for (const t of B.playTags(k, play, { bats })) tagsFor(kind).add(t);
  }
}
const every = new Set([...made.values()].flatMap((s) => [...s]));
const unreached = [...B.PLAY_TAGS].filter((t) => !every.has(t));
check('every tag a play can carry turns up', !unreached.length, unreached.join(', '));

const bsm = new Function(`${readFileSync(new URL('../../client/devpanel/js/bsm-compiler.js', import.meta.url), 'utf8')}\n;return compileBsm;`)();
const pools = bsm(readFileSync(new URL('../../data/scripts/baseball.bsm', import.meta.url), 'utf8')).sportsScript.pools;
// Which kinds of play each bare pool calls (plugins/broadcast/index.js, assembleSportsGraph).
const KINDS = {
  'atbat.groundout': ['groundout'], 'atbat.productout': ['productout'], 'atbat.doubleplay': ['doubleplay'], 'atbat.tripleplay': ['tripleplay'],
  'atbat.flyout': ['flyout'], 'atbat.sacfly': ['sacfly'], 'atbat.popout': ['popout'], 'atbat.single': ['single'], 'atbat.double': ['double'],
  'atbat.triple': ['triple'], 'atbat.error': ['error:fielding'], 'atbat.error.throwing': ['error:throwing'], rbi: ['single', 'double', 'triple'],
  hr: ['homerun'], 'hr.solo': ['homerun'], 'hr.grand': ['homerun'],
};
const bare = Object.keys(KINDS).sort((a, b) => b.length - a.length);
const silent = [];
let suffixed = 0;
for (const key of Object.keys(pools)) {
  const base = bare.find((b) => key.startsWith(`${b}.`));
  if (!base || KINDS[key]) continue;
  suffixed++;
  const tag = key.slice(base.length + 1);
  if (!KINDS[base].some((kind) => tagsFor(kind).has(tag))) silent.push(key);
}
check('every suffixed line pool has a play that opens it', suffixed > 30 && !silent.length, `${suffixed} pools; never open: ${silent.join(', ')}`);

console.log(`variety smoke: ${GAMES} games, ${plays.length} balls in play, ${suffixed} suffixed pools, ${passes} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
