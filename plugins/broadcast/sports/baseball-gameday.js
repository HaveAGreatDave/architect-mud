/**
 * DEADBALL — the Gameday payloads.
 *
 * What each at-bat and each half-inning break hands the Gameday views (the 2-D field
 * today, the 3-D park later), built from one simulated game. The broadcast
 * (plugins/broadcast/index.js) attaches each payload to the line that calls its play;
 * the gates build the very same payloads from the very same games with no server
 * (scripts/shapes/gameday-smoke.mjs).
 *
 * Pure, and it never touches the sim's random stream: the pitches come from seeds of
 * their own (`sportsHash` of the game seed, the half and the at-bat), so building
 * payloads can't change a game.
 *
 * What the broadcast adds on top, because only it knows them: the league table and the
 * season on the game's first payload, and how long each payload's line holds.
 */
import { sportsHash } from '../rng.js';
import { synthPitches, playDesc, handOf, battingSide } from './baseball.js';

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
// snapshot keeps the line alive through the changeover.
function lineSnapshots(halves) {
  const snap = new Map();   // beat -> { away: [runs by inning], home: [...], hAway, hHome }
  const la = [], lh = [];
  let pa = 0, ph = 0, ha = 0, hh = 0;
  for (const h of halves) {
    const inn = h.start.inning;
    while (la.length < inn) { la.push(0); lh.push(0); }
    snap.set(h.start, { away: la.slice(), home: lh.slice(), hAway: ha, hHome: hh });
    for (const b of h.atbats) {
      const a = Number.isFinite(b.awayScore) ? b.awayScore : pa;
      const hm = Number.isFinite(b.homeScore) ? b.homeScore : ph;
      la[inn - 1] += Math.max(0, a - pa); lh[inn - 1] += Math.max(0, hm - ph);
      pa = a; ph = hm;
      if (HIT.has(b.kind)) { if (h.start.half === 'top') ha++; else hh++; }
      snap.set(b, { away: la.slice(), home: lh.slice(), hAway: ha, hHome: hh });
    }
  }
  return snap;
}

// Every payload for one game. `abbr` and `ordinal` are the broadcast's own formatters
// (the score bug's team tags and "3rd"), passed in so the payloads match its lines.
// Returns { halves, atbat: Map(beat -> payload), half: Map(half_start -> payload),
// order: [every payload in game order] }.
export function gamedayPayloads(game, seed, { abbr, ordinal }) {
  const halves = gamedayHalves(game.beats);
  const line = lineSnapshots(halves);
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
    h.atbats.forEach((b, idx) => {
      const p = {
        sport: 'baseball',
        batter: b.batter || '', pitcher: b.pitcher || '',
        // The side he bats from against this pitcher, and the pitcher's arm, from their names.
        bats: battingSide(b.batter, b.pitcher), throws: handOf(b.pitcher).throws,
        ...(handOf(b.batter).bats === 'S' ? { switchHitter: true } : {}),
        battingTeam: b.battingName, fieldingTeam: b.fieldingName,
        battingAbbr: abbr(b.battingName), fieldingAbbr: abbr(b.fieldingName),
        inning: b.inning, inningOrd: ordinal(b.inning), half: b.half,
        outs: b.outs ?? 0, rbi: b.rbi ?? 0, kind: b.kind, out: !!b.out, walkoff: !!b.walkoff,
        basesBefore: prev,
        basesAfter: b.bases || [false, false, false],
        awayScore: b.awayScore, homeScore: b.homeScore,
        desc: playDesc(b),
        pitches: synthPitches(sportsHash(seed, b.inning * 2 + (b.half === 'bottom' ? 1 : 0), idx >>> 0), b.kind),
        line: line.get(b) || null,
      };
      prev = b.bases || [false, false, false];
      atbat.set(b, p); order.push(p);
    });
  }
  return { halves, atbat, half, order };
}
