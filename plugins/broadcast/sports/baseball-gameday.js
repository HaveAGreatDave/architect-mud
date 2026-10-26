/**
 * DEADBALL — the Gameday payloads.
 *
 * What each at-bat, each play on the bases (sim v2) and each half-inning break hands the
 * Gameday views (the 2-D field today, the 3-D park later), built from one simulated
 * game. The broadcast
 * (plugins/broadcast/index.js) attaches each payload to the line that calls its play;
 * the gates build the very same payloads from the very same games with no server
 * (scripts/shapes/gameday-smoke.mjs).
 *
 * Pure, and it never touches the sim's random stream: the pitches and the ball in play come
 * from seeds of their own (`sportsHash` of the game seed, the half and the at-bat), so
 * building payloads can't change a game.
 *
 * What the broadcast adds on top, because only it knows them: the league table, the
 * leaders and the season on the game's first payload, the season so far (`ledger`) that
 * the men's lines start from, and how long each payload's line holds.
 */
import { sportsHash } from '../rng.js';
import { synthPitches, synthPlay, playDesc, handOf, battingSide, foldGame, quicknessOf, armOf, speedOf, pitcherStyleOf, LINEUP_POSITIONS } from './baseball.js';
import { venueField } from '../../../client/game/js/panels/diamond/geo.js';

const HIT = new Set(['single', 'double', 'triple', 'homerun']);

// The flat beat list grouped into half-innings: { start, atbats, end }.
export function gamedayHalves(beats) {
  const halves = [];
  let cur = null;
  for (const b of beats || []) {
    if (b.type === 'half_start') { cur = { start: b, atbats: [], end: null }; halves.push(cur); }
    else if (b.type === 'half_end') { if (cur) cur.end = b; }
    else if (cur) cur.atbats.push(b);
  }
  return halves;
}

// The progressive line score: walk every at-bat in game order, give the change in each
// team's running score to its inning (exact whatever the RBI semantics), and count hits.
// Snapshotted at every at-bat and at every half's start, so a payload aired mid-game
// shows the line up to that play and never spoils a later inning; the half's own
// snapshot keeps the line alive through the changeover. A sim v2 game (`errors`) also
// counts each side's errors, charged to the team in the field, for the line's E.
function lineSnapshots(halves, { errors = false } = {}) {
  const snap = new Map();   // beat -> { away: [runs by inning], home: [...], hAway, hHome, eAway?, eHome? }
  const la = [], lh = [];
  let pa = 0, ph = 0, ha = 0, hh = 0, ea = 0, eh = 0;
  const take = () => ({ away: la.slice(), home: lh.slice(), hAway: ha, hHome: hh, ...(errors ? { eAway: ea, eHome: eh } : {}) });
  for (const h of halves) {
    const inn = h.start.inning;
    while (la.length < inn) { la.push(0); lh.push(0); }
    snap.set(h.start, take());
    for (const b of h.atbats) {
      const a = Number.isFinite(b.awayScore) ? b.awayScore : pa;
      const hm = Number.isFinite(b.homeScore) ? b.homeScore : ph;
      la[inn - 1] += Math.max(0, a - pa); lh[inn - 1] += Math.max(0, hm - ph);
      pa = a; ph = hm;
      if (HIT.has(b.kind)) { if (h.start.half === 'top') ha++; else hh++; }
      if (b.kind === 'error') { if (h.start.half === 'top') eh++; else ea++; }
      snap.set(b, take());
    }
  }
  return snap;
}

// Where every man on a play ends up: each runner on base before it, and the batter.
// A v1 game keeps only which bags are occupied, so this works it out from the bags
// before and after, the kind of play and the runs it scored. The runs are the change
// in the batting side's score, not the RBI, because a run can score with none (on a
// double play in real scoring; v1 happens to count them the same). Runners can't pass each
// other, so the lead runners are the ones who come home and the rest fill the bags
// occupied afterwards, in order. That makes the answer unique. Lead runner first,
// the batter last:
//
//   { from, to }    from 0 (the batter) or a bag 1-3, to a bag 1-3 or 4 for a run.
//                   to === from is a runner who held.
//   { from, out }   put out at that bag; 0 is a batter who never left the box.
//   { from, off }   cleared by a play that ended the inning (an inning-ending
//                   double play, a triple play): he walks off without scoring.
//
// Sim v2 names its runners and hands over its own moves; this is for v1 games.
const BATTER_TO = { walk: 1, single: 1, double: 2, triple: 3, homerun: 4 };
const FORCED_AT = { doubleplay: { 1: 2 }, tripleplay: { 2: 3, 1: 2 } };   // a runner's bag -> where he's forced out
const RAN_IT_OUT = new Set(['groundout', 'productout', 'doubleplay', 'tripleplay']);
export function runnerMoves(before, after, kind, scored) {
  const forced = FORCED_AT[kind] || {};
  let batterTo = BATTER_TO[kind] || 0;
  // A hit with his bag empty afterwards is the sim's one-swing extra-inning finish,
  // which scores a run with nobody on: the batter scored it himself.
  if (batterTo && batterTo < 4 && !after[batterTo - 1]) batterTo = 4;
  let runs = (scored || 0) - (batterTo === 4 ? 1 : 0);
  const on = [3, 2, 1].filter((n) => before[n - 1]);
  const staying = on.filter((n) => !forced[n]);
  const bags = [3, 2, 1].filter((n) => after[n - 1] && n !== batterTo);
  const leave = staying.length - bags.length;
  const moves = on.map((n) => {
    if (forced[n]) return { from: n, out: forced[n] };
    const i = staying.indexOf(n);
    if (i >= leave) return { from: n, to: bags[i - leave] };
    if (runs > 0) { runs--; return { from: n, to: 4 }; }
    return { from: n, off: true };
  });
  moves.push(batterTo ? { from: 0, to: batterTo } : { from: 0, out: RAN_IT_OUT.has(kind) ? 1 : 0 });
  return moves;
}

// Each man's season line as it stood before each play: the season so far (`ledger`, the
// standings fold's every-man ledger from SEASON.summariseExtras) folded forward through
// this game. Only the men in this game are copied, and the ledger itself is never touched,
// because it's the standings cache's own. Returns Map(beat -> fields):
//
//   bl   the batter's [AB, H, HR, RBI, SB]
//   pl   the pitcher's [W, L, outs, ER, K]
//   sb   on a steal, the runner's steals with this one (the lead runner's on a double steal)
const NO_LINE = Object.freeze([0, 0, 0, 0, 0]);
function nightLines(game, ledger) {
  const names = new Set();
  for (const b of game.beats || []) {
    if (b.batter) names.add(b.batter);
    if (b.pitcher) names.add(b.pitcher);
    if (b.runner) names.add(b.runner);
  }
  const acc = { bats: new Map(), arms: new Map() };
  for (const n of names) {
    const r = ledger.bats?.get(n), a = ledger.arms?.get(n);
    if (r) acc.bats.set(n, { ...r });
    if (a) acc.arms.set(n, { ...a });
  }
  const out = new Map();
  foldGame(acc, game, {
    before(b) {
      const r = acc.bats.get(b.batter), a = acc.arms.get(b.pitcher);
      out.set(b, {
        bl: r ? [r.ab, r.hits, r.hr, r.rbi, r.sb] : NO_LINE,
        pl: a ? [a.w, a.l, a.outs, a.er, a.k] : NO_LINE,
      });
    },
    after(b) {
      const stole = b.kind === 'steal' || (b.kind === 'doublesteal' && !b.out);
      if (b.type === 'run' && stole && b.runner) out.get(b).sb = acc.bats.get(b.runner)?.sb ?? 0;
    },
  });
  return out;
}

// The league's leaders as a Gameday payload carries them, for the 3-D view's table between
// innings: five a race (home runs, average and steals for the hitters, strikeouts for the
// pitchers), trimmed to what the table shows. `x` is what SEASON.summariseExtras returned.
export function gamedayLeaders(x = {}) {
  const bat = (r) => ({ name: r.name, team: r.team, hr: r.hr, rbi: r.rbi, avg: Math.round((r.avg || 0) * 1000) / 1000, sb: r.sb || 0 });
  const arm = (r) => ({ name: r.name, team: r.team, w: r.w, l: r.l, era: Math.round((r.era || 0) * 100) / 100, k: r.k });
  return { hr: (x.homers || []).map(bat), avg: (x.batters || []).map(bat), sb: (x.steals || []).map(bat), k: (x.strikeouts || []).map(arm) };
}

// The game's most valuable player, for the champion's card at the end of a final: the
// winners' batter with the most bases and runs batted in (a hit's bases, plus one and a half a
// run batted in), first to it on a tie. `payloads` are the game's, in order (gamedayPayloads
// `order`). Returns { name, team, line ('2-4, HR, 3 RBI') } or null.
const HIT_BASES = { single: 1, double: 2, triple: 3, homerun: 4 };
const NO_AB = new Set(['walk', 'hitbypitch', 'sacfly', 'intentional']);
export function gameMvp(payloads, winner) {
  const by = new Map();
  for (const p of payloads || []) {
    if (p.phase || !p.batter || p.battingTeam !== winner) continue;
    const r = by.get(p.batter) || { name: p.batter, team: winner, ab: 0, h: 0, hr: 0, rbi: 0, bases: 0 };
    if (!NO_AB.has(p.kind)) r.ab++;
    if (HIT_BASES[p.kind]) { r.h++; r.bases += HIT_BASES[p.kind]; }
    if (p.kind === 'homerun') r.hr++;
    r.rbi += p.rbi | 0;
    by.set(p.batter, r);
  }
  let best = null;
  for (const r of by.values()) if (!best || r.bases + 1.5 * r.rbi > best.bases + 1.5 * best.rbi) best = r;
  if (!best) return null;
  const parts = [`${best.h}-${best.ab}`, best.hr ? (best.hr > 1 ? `${best.hr} HR` : 'HR') : '', best.rbi ? `${best.rbi} RBI` : ''].filter(Boolean);
  return { name: best.name, team: best.team, line: parts.join(', ') };
}

// The clocks a steal is run against, from the traits that decided it in the sim: the
// pitcher's time to the plate (quicknessOf) and the catcher's pop time to the bag (armOf),
// in seconds. A quick pitcher is about 1.2 to the plate and a strong arm about 1.85.
const STEAL_PLAYS = new Set(['steal', 'caughtstealing', 'doublesteal']);
const CATCHER = LINEUP_POSITIONS.indexOf('C');
function stealClock(game, b) {
  const side = game.home?.name === b.fieldingName ? game.home : game.away?.name === b.fieldingName ? game.away : null;
  const catcher = side?.lineup?.[CATCHER];
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    ...(b.pitcher ? { plate: r2(1.2 + 0.4 * (1 - quicknessOf(b.pitcher))) } : {}),
    ...(catcher ? { pop: r2(1.85 + 0.3 * (1 - armOf(catcher))) } : {}),
  };
}

// Every payload for one game. `abbr` and `ordinal` are the broadcast's own formatters
// (the score bug's team tags and "3rd"), passed in so the payloads match its lines.
// With `ledger` (the season so far), every play also carries the batter's and the
// pitcher's lines as they stood before it (nightLines); without one it carries none,
// since a line counted from tonight alone isn't a season. `venue` is the park
// (sports_pools.venue): a ball in play is judged against its fence.
// Returns { halves, atbat: Map(beat -> payload), half: Map(half_start -> payload),
// order: [every payload in game order] }. `atbat` holds every play's payload: the
// at-bats, and in a sim v2 game the plays on the bases too. An at-bat that put a ball in
// play carries it as `play` (synthPlay in baseball.js).
export function gamedayPayloads(game, seed, { abbr, ordinal, ledger = null, venue = null }) {
  const halves = gamedayHalves(game.beats);
  const fence = venueField(venue).fence;
  const v2 = game.version === 2;
  const line = lineSnapshots(halves, { errors: v2 });
  const lines = ledger ? nightLines(game, ledger) : null;
  const atbat = new Map(), half = new Map(), order = [];
  for (const h of halves) {
    const s = h.start;
    // The half-inning break. Deliberately not an at-bat: `phase: 'half'` is the marker,
    // and everything an at-bat needs to animate (pitches, bases, kind) is absent rather
    // than faked, so a client that doesn't know the phase draws nothing instead of a
    // play that never happened.
    const hp = {
      sport: 'baseball',
      phase: 'half',
      battingTeam: s.battingName, fieldingTeam: s.fieldingName,
      battingAbbr: abbr(s.battingName), fieldingAbbr: abbr(s.fieldingName),
      inning: s.inning, inningOrd: ordinal(s.inning), half: s.half,
      pitcher: s.pitcher || '', throws: handOf(s.pitcher).throws,
      awayScore: s.awayScore, homeScore: s.homeScore,
      line: line.get(s) || null,
    };
    half.set(s, hp); order.push(hp);
    let prev = [false, false, false];
    // The batting side's score, so a play's runs are what it put on the board.
    let score = s.half === 'top' ? s.awayScore : s.homeScore;
    // Pitches are seeded per at-bat, counting at-bats only, so a play on the bases
    // never reshuffles the pitches of the at-bats around it.
    let abIdx = 0;
    for (const b of h.atbats) {
      const now = b.half === 'top' ? b.awayScore : b.homeScore;
      const scored = Number.isFinite(now) && Number.isFinite(score) ? now - score : (b.rbi ?? 0);
      score = now;
      const after = b.bases || [false, false, false];
      const bats = battingSide(b.batter, b.pitcher);
      const common = {
        sport: 'baseball',
        batter: b.batter || '', pitcher: b.pitcher || '',
        // The side he bats from against this pitcher, and the pitcher's arm, from their names.
        bats, throws: handOf(b.pitcher).throws,
        ...(handOf(b.batter).bats === 'S' ? { switchHitter: true } : {}),
        battingTeam: b.battingName, fieldingTeam: b.fieldingName,
        battingAbbr: abbr(b.battingName), fieldingAbbr: abbr(b.fieldingName),
        inning: b.inning, inningOrd: ordinal(b.inning), half: b.half,
      };
      // A sim v2 game names its runners and hands over each man's fate; a v1 game's are
      // worked out from the bags.
      const moves = Array.isArray(b.moves) ? b.moves : runnerMoves(prev, after, b.kind, scored);
      // The at-bat's seed: its pitches, and the ball he put in play, each salted its own way.
      const abSeed = b.type === 'run' ? 0 : sportsHash(seed, b.inning * 2 + (b.half === 'bottom' ? 1 : 0), abIdx++ >>> 0);
      const play = b.type === 'run' ? null
        : synthPlay(abSeed, b.kind, { bats, before: prev, fielder: b.fielder, errorType: b.errorType, speed: speedOf(b.batter), fence });
      const p = b.type === 'run'
        // A play on the bases while the batter is up (sim v2): `phase: 'run'`, with the man
        // running and the bag in play, and no pitches of its own.
        ? {
          ...common, phase: 'run', kind: b.kind, runner: b.runner || '', base: b.base,
          outs: b.outs ?? 0, out: !!b.out, rbi: 0, runs: scored, walkoff: !!b.walkoff,
          basesBefore: prev, basesAfter: after, moves,
          awayScore: b.awayScore, homeScore: b.homeScore,
          desc: playDesc(b),
          line: line.get(b) || null,
          ...(STEAL_PLAYS.has(b.kind) ? stealClock(game, b) : {}),
          ...(lines?.get(b) || {}),
        }
        : {
          ...common,
          outs: b.outs ?? 0, rbi: b.rbi ?? 0, kind: b.kind, out: !!b.out, walkoff: !!b.walkoff,
          ...(v2 ? { runs: scored } : {}),
          ...(b.kind === 'error' ? { fielder: b.fielder, errorType: b.errorType } : {}),
          basesBefore: prev, basesAfter: after, moves,
          awayScore: b.awayScore, homeScore: b.homeScore,
          desc: playDesc(b),
          // drawn from the pitcher's own mix (pitcherStyleOf)
          pitches: synthPitches(abSeed, b.kind, pitcherStyleOf(b.pitcher)),
          ...(play ? { play } : {}),
          line: line.get(b) || null,
          ...(lines?.get(b) || {}),
        };
      prev = after;
      atbat.set(b, p); order.push(p);
    }
  }
  return { halves, atbat, half, order };
}
