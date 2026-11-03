// Deadball games as they air, with no server: the pieces parkclock-smoke.mjs measures the park
// clock (client/game/js/panels/diamond/parkclock.js) against. Pure, no database, no files written.
//
//   seasonGames(script, { seasons })  a schedule of real slots for the script's clubs: four games a
//                                     day, every club once a day, thirty days a season
//   airGame(script, slot, { slotMs }) one slot's game at sim v3, its lines narrated by the booth
//                                     (plugins/broadcast/sports/baseball-narrator.js) and paced by
//                                     paceCalls, the payloads as they air with their holds, and every
//                                     play the booth doesn't call riding the payload before it
//                                     (`then`)
//   draftPitches(pitches, rand)       the draft pitch draw with more fouls (coliseum-seats.md §2),
//                                     built on today's draw for the same at-bat
//
// What airGame builds round the narrator is what assembleSportsGraph (plugins/broadcast/index.js)
// does: the node chain, `say`, the narration streams off the game's seed, then paceCalls and each
// payload's hold to the next payload. index.js can't be imported here, because it loads the
// plugin's state from the database as it's imported. The live table, season and injury chain are
// left out: every record reads 0-0 and nobody's hurt, which moves a few words, never a pitch.
import { sportsRng, sportsHash, sportsPick, sportsFill } from '../../plugins/broadcast/rng.js';
import { BASEBALL } from '../../plugins/broadcast/sports/baseball.js';
import { gamedayPayloads } from '../../plugins/broadcast/sports/baseball-gameday.js';
import { narrateBaseball } from '../../plugins/broadcast/sports/baseball-narrator.js';

// index.js's numbers: the play-by-play's share of the slot and the broadcast's tick.
export const GAME_FILL = 0.85, TICK_MS = 1000;
const DAY_MS = 86400000, SLOTS_PER_DAY = 8;
const ORD = ['', '1st', '2nd', '3rd'];
const ordinal = (n) => ORD[n] || `${n}th`;
const abbr = (name) => { const w = String(name || '').split(/\s+/).filter(Boolean); return (w.length > 1 ? w.map((x) => x[0]).join('') : String(name || '').slice(0, 3)).toUpperCase().slice(0, 3) || 'TBD'; };
const teamNames = (teams) => (Array.isArray(teams) ? teams : []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);

// Four games a day at the slate's baseball hours, every club once, the pairings turning round a
// circle so each club meets each other club in turn; home and away swap each time round.
export function seasonGames(script, { seasons = 1, from = Date.UTC(2035, 0, 1) } = {}) {
  const names = teamNames(script.teams);
  const day0 = Math.floor(from / DAY_MS), out = [];
  for (let d = 0; d < seasons * 30; d++) {
    const r = d % (names.length - 1), flip = Math.floor(d / (names.length - 1)) % 2 === 1;
    const ring = [names[0], ...names.slice(1).map((_, i) => names[1 + ((i + r) % (names.length - 1))])];
    for (let k = 0; k < names.length / 2; k++) {
      const a = ring[k], b = ring[ring.length - 1 - k];
      out.push({ slot: (day0 + d) * SLOTS_PER_DAY + 1 + 2 * k, away: flip ? b : a, home: flip ? a : b });
    }
  }
  return out;
}

// A payload's place in the game, for matching an aired copy to the one it was made from.
const keyOf = (p) => [p.phase || 'ab', p.inning, p.half, p.batter || '', p.kind || '', p.runner || '', p.outs ?? '', p.awayScore, p.homeScore].join('|');

export function airGame(script, { slot, away, home }, { slotMs = 3600000, version = 3, game: given = null } = {}) {
  const seed = sportsHash(slot >>> 0, 0x00);
  const matchup = { away, home, teams: teamNames(script.teams), ...(script.clubs ? { clubs: script.clubs } : {}) };
  const game = given || BASEBALL.simGame(matchup, script.players, sportsRng(seed), { version, seed, day: Math.floor(slot / SLOTS_PER_DAY) });
  const pools = script.pools || {}, announcer = script.announcer || 'your announcer';
  const nrng = sportsRng(seed ^ 0x9e3779b9), xrng = sportsRng(sportsHash(seed, 0x11fe));
  const pick = (...keys) => sportsPick(pools, nrng, ...keys), xpick = (...keys) => sportsPick(pools, xrng, ...keys);
  const nodes = {};
  let n = 0, prevId = null, startId = null;
  const add = (data) => { const id = `sp_${n++}`; nodes[id] = { ...data }; if (prevId) nodes[prevId].next = id; if (startId === null) startId = id; prevId = id; return id; };
  add({ type: 'start' });
  if (script.title) add({ type: 'title_card', graphic_id: script.title });
  const say = (line, tok, sb, graphic, gd, meta) => {
    if (!line) return;
    const text = sportsFill(line, tok).trim();
    if (!text) return;
    add({ type: 'say', text, ...(graphic ? { graphic } : {}), ...(gd ? { gameday: gd } : {}), ...(meta && meta.opt ? { _opt: meta.opt } : {}), ...(meta && meta.call ? { call: true } : {}) });
  };
  const { home: h, away: a, homeScore, awayScore } = game;
  const winner = () => (homeScore === awayScore ? '' : (homeScore > awayScore ? h.name : a.name));
  narrateBaseball({
    script, game, gs: { game, seed }, ws: false, announcer, pools, nrng, pick, xpick, say, winner, nodes, startId,
    sport: BASEBALL, fillMs: slotMs * GAME_FILL, abbr, ordinal,
    recordOf: () => '0-0', pregame: () => ({ overlayType: 'sportsfx', kind: 'pregame', duration: 18 }),
    standings: [], leaders: null, ledger: null, seasonState: { seasonNo: null }, venueRev: '',
    venueSaid: (s) => s?.venue?.said || s?.venue?.name || '', liveHoldS: 15,
    finalPackage: () => {}, lastId: () => prevId,
  });
  // the pacer, as index.js runs it, and each payload's hold to the next payload
  const chain = [];
  for (let id = startId; id; id = nodes[id].next) chain.push(nodes[id]);
  const { holds, dropped } = BASEBALL.paceCalls(chain.filter((nd) => nd.type === 'say'), slotMs * GAME_FILL, TICK_MS);
  const live = chain.filter((nd) => !dropped.has(nd));
  const holdOf = (nd) => (nd.type === 'say' ? Math.ceil((holds.get(nd) ?? 5000) / TICK_MS) * TICK_MS : 0);
  const aired = [];
  for (const nd of live) {
    if (nd.gameday && nd.type === 'say') aired.push({ ...nd.gameday, hold: 0 });
    if (aired.length) aired[aired.length - 1].hold += holdOf(nd);
  }
  // every play the sim made, and the ones the booth didn't call riding the payload before them
  const { order } = gamedayPayloads(game, seed, { abbr, ordinal, venue: script.venue || null });
  let j = aired[0]?.phase === 'arrive' ? 1 : 0;
  const uncalled = [];
  for (const p of order) {
    if (j < aired.length && keyOf(aired[j]) === keyOf(p)) { j++; continue; }
    const host = aired[j - 1];
    if (!host) throw new Error(`slot ${slot}: a play before the first payload`);
    (host.then ||= []).push(p);
    uncalled.push(p);
  }
  if (j !== aired.length) throw new Error(`slot ${slot}: aired payload ${j} (${keyOf(aired[j])}) matches no play`);
  return { seed, game, aired, order, uncalled, lines: live.filter((nd) => nd.type === 'say').length, droppedLines: dropped.size };
}

// The draft draw: a strike before the last pitch is fouled off instead with chance `relabel`, which
// moves no count; and with two strikes he fouls off more, each with chance `extra`, up to `most`
// fouls at two strikes. Nothing else changes: the last pitch and what came of it are the sim's.
export const DRAFT = Object.freeze({ relabel: 0.33, extra: 0.2, most: 4 });
export function draftPitches(pitches, rand, o = DRAFT) {
  if (!Array.isArray(pitches) || pitches.length < 1) return pitches;
  const last = pitches[pitches.length - 1];
  const pre = pitches.slice(0, -1).map((q) => ({ ...q, result: (q.result === 'called' || q.result === 'swinging') && rand() < o.relabel ? 'foul' : q.result }));
  // the strikes before the last pitch, and the fouls he has at two
  let strikes = 0, twoFouls = 0, twoAt = -1;
  pre.forEach((q, i) => {
    if (q.result === 'ball') return;
    if (strikes >= 2) { twoFouls++; return; }
    strikes++;
    if (strikes === 2) twoAt = i;
  });
  if (twoAt >= 0) {
    const like = pre[pre.length - 1] || last;
    while (twoFouls < o.most && rand() < o.extra) { pre.push({ ...like, result: 'foul' }); twoFouls++; }
  }
  let b = 0, s = 0;
  return [...pre, last].map((q, i) => {
    if (q.result === 'ball') b++;
    else if (q.result === 'foul') { if (s < 2) s++; }
    else if (q.result !== 'hbp') s++;
    return { ...q, n: i + 1, balls: b, strikes: s };
  });
}
