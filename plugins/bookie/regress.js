// Bookie regression suite: the pricing maths and the guards. The take-and-settle
// path needs a live airing and a bookie in the room; that's manual QA.
import { _test } from './index.js';

export default async function regress({ run, check }) {
  const even = _test.homeWinProb({ wins: 5, losses: 5 }, { wins: 5, losses: 5 });
  check('even clubs: home side is the small favourite', even > 0.5 && even < 0.6, even);
  const strong = _test.homeWinProb({ wins: 1, losses: 9 }, { wins: 9, losses: 1 });
  check('a 9-1 home side is a big favourite', strong > 0.75 && strong <= 0.9, strong);
  check('no record is priced as .500', _test.strength(null) === 0.5);

  const line = _test.lineFor('Rustpile Rats', 'Coldwater Kingfishers', [
    { team: 'Rustpile Rats', wins: 2, losses: 8 }, { team: 'Coldwater Kingfishers', wins: 8, losses: 2 }]);
  check('the underdog pays more', line.away > line.home, JSON.stringify(line));
  check('the house keeps a margin', 1 / line.away + 1 / line.home > 1.0, JSON.stringify(line));
  check('prices never drop below 1.05', _test.priceOf(0.99) >= 1.05);

  const p1 = _test.parsePunt(['50', 'rats']);
  check('parsePunt amount first', p1?.amount === 50 && p1.team === 'rats', JSON.stringify(p1));
  const p2 = _test.parsePunt(['rustpile', 'rats', '20']);
  check('parsePunt amount last', p2?.amount === 20 && p2.team === 'rustpile rats', JSON.stringify(p2));
  check('parsePunt needs a team', _test.parsePunt(['50']) === null);

  const g = { away: 'Rustpile Rats', home: 'Coldwater Kingfishers' };
  check('pickTeam by word', _test.pickTeam('kingfishers', g) === 'Coldwater Kingfishers');
  check('pickTeam rejects a stranger', _test.pickTeam('wolves', g) === null);

  const r1 = await run('punt 50 rats');
  check('punt with no bookie in the room errors', r1?.type === 'error', r1?.message);
  const r2 = await run('odds');
  check('odds with no bookie in the room errors', r2?.type === 'error', r2?.message);
  const r3 = await run('slips');
  check('slips answers anywhere', r3?.type === 'output', r3?.message);
}
