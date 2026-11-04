// street-systems: do the street's prices and room text keep the decisions in the Coldwater Streets doc?
//
//   node scripts/shapes/street-systems.mjs
//
// Reads plugins/streets/rules.js on a fake block. No world, no database.
import { LEVEL } from '../../client/game/js/panels/glass/street-kit.js';
import { PASSING, PASSING_DIRT, PRICE, ROOM_TEXT, offerLine, placeOf, roomLine, stripRide } from '../../plugins/streets/rules.js';

const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };

check(PRICE.strip === 1, 'the price has moved');
// A north-south block on column 2, rows 1 to 5, crossroads at each end.
const window = (sc) => {
  const m = new Map();
  return (x, y) => {
    const k = x + ',' + y;
    if (!m.has(k)) m.set(k, x !== 2 || y < 0 || y > 6 ? null : y === 0 || y === 6 ? { road: 1, rd: 'nesw', sc } : { road: 1, rd: 'ns', sc });
    return m.get(k);
  };
};
for (let sc = 0; sc < LEVEL.length; sc++) {
  const at = window(sc), lv = LEVEL[sc], mid = placeOf(at, 2, 3), end = placeOf(at, 2, 1);
  check(ROOM_TEXT[sc].length >= 4, `level ${sc} has too little room text`);
  check(ROOM_TEXT[sc].every((t) => !/\bCR\b|—/.test(t)), `level ${sc}: CR or an em dash in the text`);
  check(typeof roomLine(mid, 2, 3) === 'string', `level ${sc}: no room line`);
  check(stripRide(placeOf(at, 2, 0), 'north').no, `level ${sc}: a strip on a junction`);
  if (lv.dirt) {
    check(stripRide(mid, 'north').no === 'none', 'a strip on the dirt');
    check(offerLine(mid) === '' && offerLine(end) === '', 'a price on the dirt');
    continue;
  }
  check(stripRide(mid, 'east').no === 'across', `level ${sc}: a strip across the street`);
  const north = stripRide(mid, 'north'), south = stripRide(mid, 'south');
  if (lv.speed > 0) check(north.steps === 3 && south.steps === 3, `level ${sc}: a ride of ${north.steps} and ${south.steps}, not to the junction`);
  else check(north.steps === 1 && !north.running, `level ${sc}: a stopped belt carried somebody`);
  check(/₵1/.test(offerLine(mid)), `level ${sc}: the strip's price isn't posted`);
}
check(PASSING.length && PASSING_DIRT.length, 'no vehicles');

if (problems.length) {
  console.error(`street-systems: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
