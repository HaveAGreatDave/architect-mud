// Regression suite for the sportsleague plugin. Asserts the `standings` verb
// routes and returns a table, and that the pure formatter handles empty + real
// standings rows (no DB writes — recordGame is exercised via its formatter output).
import { _test } from './index.js';

export default async function regress({ run, check }) {
  const r = await run('standings');
  check('standings routed', r?.type === 'output', r?.message);
  check('standings returns a string', typeof r?.message === 'string', JSON.stringify(r));

  const empty = _test.formatStandings([]);
  check('formats empty standings', /no baseball games/i.test(empty), empty);

  const table = _test.formatStandings([
    { team: 'Vellum Vultures', wins: 12, losses: 5, runs_for: 88, runs_against: 61 },
    { team: 'Rustpile Rats', wins: 3, losses: 14, runs_for: 52, runs_against: 99 },
  ]);
  check('table lists both teams', table.includes('Vellum Vultures') && table.includes('Rustpile Rats'), table);
  check('table shows a win pct', table.includes('.706'), table);       // 12/17
  check('table shows a positive run diff', table.includes('+27'), table); // 88-61
  check('table shows a negative run diff', table.includes('-47'), table); // 52-99

  // ── Seasons / World Series ──────────────────────────────────────────────────
  const wsView = await run('worldseries');
  check('worldseries routed', wsView?.type === 'output', wsView?.message);
  const champs = await run('champions');
  check('champions routed', champs?.type === 'output', champs?.message);

  // Season clock: the day math that decides when the World Series triggers.
  check('season length spans a 30-day month', _test.daysBetween('2035-01-01', '2035-01-31') === 30, 'jan');
  check('season length spans a month boundary', _test.daysBetween('2035-01-15', '2035-02-14') === 30, 'cross-month');
  check('daysBetween is null on unknown date', _test.daysBetween(null, '2035-01-01') === null, 'null-guard');

  const emptyChamps = _test.formatChampions([]);
  check('formats empty champions', /trophy case is empty/i.test(emptyChamps), emptyChamps);
  const champList = _test.formatChampions([
    { season_no: 2, champion: 'Vellum Vultures', runner_up: 'Ironhides', champ_score: 6, runner_score: 5 },
  ]);
  check('champions list shows the winner', champList.includes('Vellum Vultures') && champList.includes('def. Ironhides 6-5'), champList);
}
