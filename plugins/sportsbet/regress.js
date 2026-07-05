// Sportsbet plugin regression suite — run by tests/regress.js (never loaded in
// production). Pure parsing/scoring helpers + verb routing + fail-safe guards.
// The full offer→lock→settle path needs a live baseball airing + two players and
// is covered by manual QA.
import { _test } from './index.js';

export default async function regress({ run, check }) {
  // ── parseScore ─────────────────────────────────────────────────────────────
  check('parseScore reads away-home', JSON.stringify(_test.parseScore('5-3')) === JSON.stringify({ away: 5, home: 3 }));
  check('parseScore rejects junk', _test.parseScore('nope') === null);

  // ── parseWager ─────────────────────────────────────────────────────────────
  const w = _test.parseWager(['Bob', '100', 'Rustpile', 'Rats', '5-3']);
  check('parseWager splits name/amount/team/score', w && w.who === 'Bob' && w.amount === 100 && w.team === 'Rustpile Rats' && w.score?.away === 5, JSON.stringify(w));
  const w2 = _test.parseWager(['Bob', '50', 'Kingfishers']);
  check('parseWager without a score', w2 && w2.score === null && w2.team === 'Kingfishers', JSON.stringify(w2));
  check('parseWager needs a name before the amount', _test.parseWager(['100', 'Rats']) === null);

  // ── pickTeam ───────────────────────────────────────────────────────────────
  const game = { away: 'Rustpile Rats', home: 'Coldwater Kingfishers' };
  check('pickTeam matches away by word', _test.pickTeam('rats', game) === 'Rustpile Rats');
  check('pickTeam matches home by word', _test.pickTeam('kingfishers', game) === 'Coldwater Kingfishers');
  check('pickTeam rejects a team not in the game', _test.pickTeam('wolves', game) === null);

  // ── scoreEq ────────────────────────────────────────────────────────────────
  check('scoreEq exact match', _test.scoreEq({ away: 5, home: 3 }, 5, 3) === true);
  check('scoreEq mismatch', _test.scoreEq({ away: 5, home: 3 }, 4, 3) === false);
  check('scoreEq null guess', _test.scoreEq(null, 5, 3) === false);

  // ── verb routing + guards (no game is airing in the harness) ───────────────
  const noGame = await run('wager Bob 50 Rats');
  check('wager with no game on air errors cleanly', noGame?.type === 'error', noGame?.message);
  const noArg = await run('wager');
  check('wager with no args prompts usage', noArg?.type === 'error', noArg?.type);
  const tw = await run('takewager');
  check('takewager with no offer errors', tw?.type === 'error', tw?.type);
  const cw = await run('cancelwager');
  check('cancelwager with nothing pending errors', cw?.type === 'error', cw?.type);
}
