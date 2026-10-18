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

  // Deadball's batting, home-run and RBI races come off the same fold as the table.
  // The standings cache kept only hockey's extras, so they were folded and never shown.
  const bx = await _test.queryExtras('baseball');
  check("baseball's batting races reach the cache", Array.isArray(bx.batters) && Array.isArray(bx.homers) && Array.isArray(bx.rbis), Object.keys(bx).join(','));
  check('…and the formatter prints them', /BATTING/.test(_test.formatExtras({ batters: [{ name: 'Okafor', avg: 0.342, ab: 38, hits: 13 }], homers: [], rbis: [], minAb: 15 }, 'baseball')), 'no BATTING race');

  // ── Seasons and the finals ──────────────────────────────────────────────────
  const wsView = await run('curtaincall');
  check('curtaincall routed', wsView?.type === 'output', wsView?.message);
  const champs = await run('champions');
  check('champions routed', champs?.type === 'output', champs?.message);

  // Season clock: the day math that decides when a final triggers.
  check('season length spans a 30-day month', _test.daysBetween('2035-01-01', '2035-01-31') === 30, 'jan');
  check('season length spans a month boundary', _test.daysBetween('2035-01-15', '2035-02-14') === 30, 'cross-month');
  check('daysBetween is null on unknown date', _test.daysBetween(null, '2035-01-01') === null, 'null-guard');

  const emptyChamps = _test.formatChampions([]);
  check('formats empty champions', /trophy case is empty/i.test(emptyChamps), emptyChamps);
  const champList = _test.formatChampions([
    { season_no: 2, champion: 'Vellum Vultures', runner_up: 'Ironhides', champ_score: 6, runner_score: 5 },
  ]);
  check('champions list shows the winner', champList.includes('Vellum Vultures') && champList.includes('def. Ironhides 6-5'), champList);

  // ── Per-sport leagues ───────────────────────────────────────────────────────
  // Hockey counts points, not percentage, and the OT loss is the rule that makes its
  // table a different shape from baseball's. These assert the two leagues can't be
  // printing each other's columns.
  const hockeyRows = [
    { team: 'Docks Boarders', wins: 9, losses: 3, otl: 2, goals_for: 44, goals_against: 31, points: 20 },
    { team: 'Ashway Zambonis', wins: 2, losses: 11, otl: 1, goals_for: 25, goals_against: 58, points: 5 },
  ];
  const hTable = _test.formatStandings(hockeyRows, 'hockey');
  check('hockey table is the CPhL', /CPhL/.test(hTable) && /CLUSTER PUCK/.test(hTable), hTable);
  check('hockey table has an OTL column', /OTL/.test(hTable) && /PTS/.test(hTable), hTable);
  check('hockey table shows points, not pct', hTable.includes('20') && !/\.\d{3}/.test(hTable), hTable);
  check('hockey table shows goal diff', hTable.includes('+13') && hTable.includes('-33'), hTable);
  check('hockey empty table names the CPhL', /CPhL hasn't dropped a puck/i.test(_test.formatStandings([], 'hockey')), 'empty');
  check('baseball table is unchanged by the split', /COLDWATER LEAGUE/.test(_test.formatStandings([
    { team: 'Vellum Vultures', wins: 12, losses: 5, runs_for: 88, runs_against: 61 },
  ], 'baseball')), 'baseball head');

  // The scoring race + the butcher's bill only exist for the sport that harvests them.
  const extras = { scorers: [{ name: '"Meat" Prieto', goals: 7, assists: 4, points: 11 }], injuries: 6, deaths: 2 };
  const hx = _test.formatExtras(extras, 'hockey');
  check('scoring race lists the leader', hx.includes('"Meat" Prieto') && hx.includes('11'), hx);
  check('casualties are reported', /6 carried off/.test(hx) && /2 of them permanently/.test(hx), hx);
  check('baseball prints no scoring race', _test.formatExtras(extras, 'baseball') === '', 'baseball extras');

  // Both leagues are configured, and each knows its own championship.
  check('two leagues are registered', !!_test.LEAGUES.baseball && !!_test.LEAGUES.hockey, Object.keys(_test.LEAGUES).join(','));
  check('hockey crowns the Coldwater Cup', _test.LEAGUES.hockey.final === 'COLDWATER CUP', _test.LEAGUES.hockey.final);
  check('baseball crowns the Curtain Call', _test.LEAGUES.baseball.final === 'CURTAIN CALL', _test.LEAGUES.baseball.final);

  // ── Eras ────────────────────────────────────────────────────────────────────
  // A league's era names its roster. A season opened under any other one (or before eras
  // existed) closes with no champion on the next tick, and baseball, which has none, never does.
  const era = _test.LEAGUES.hockey.era;
  check('the CPhL has an era', typeof era === 'string' && era.length > 0, String(era));
  check('a hockey season from before eras is stale', _test.staleEra('hockey', { season_no: 3, era: null }) === true, 'null era');
  check('a hockey season in the current era is not', _test.staleEra('hockey', { season_no: 4, era }) === false, era);
  check('a hockey season from another era is stale', _test.staleEra('hockey', { season_no: 4, era: 'cphl-0' }) === true, 'old era');
  check('baseball is never reset by an era', !_test.LEAGUES.baseball.era && _test.staleEra('baseball', { season_no: 9, era: null }) === false, 'baseball');
  check('no season is never stale', _test.staleEra('hockey', null) === false, 'null season');

  // The Cup command routes, and `standings hockey` scopes to one league.
  const cup = await run('cup');
  check('cup routed', cup?.type === 'output', cup?.message);
  const hStand = await run('standings hockey');
  check('standings hockey routed', hStand?.type === 'output', hStand?.message);
  check('standings hockey shows only the CPhL', !/COLDWATER LEAGUE STANDINGS/.test(hStand?.message || ''), hStand?.message);
}
