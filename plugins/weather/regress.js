// Weather regression suite — run by tests/regress.js (never loaded in production).
//
// Covers the two things about hero events that are easy to break silently:
// the scheduling being DETERMINISTIC (the forecast promises a week ahead, so a
// day that reads "acid rain" on Monday must still be acid rain when it arrives),
// and every event carrying a complete presentation block (the checklist that
// stops a future third event shipping with no icon, no bed, and no pools).
import { heroEventForDate, heroEventPresentation } from './index.js';
import { recomputeInsulation } from '../../server/engine/commands/inventory.js';

const PRESENT_KEYS = ['icon', 'fx', 'audio', 'pool', 'sky', 'severe'];

export default async function regress({ check, getPlayer }) {
  // ── Scheduling is a pure function of the date ──
  const d = '2031-04-17';
  check('hero scheduling is deterministic', heroEventForDate(d) === heroEventForDate(d));
  check('a missing date schedules nothing', heroEventForDate(null) === null);

  // Over a long window we should see hero days, but they must stay rare — this
  // is the dial that decides whether the events feel like events.
  let hero = 0;
  const DAYS = 400;
  for (let i = 0; i < DAYS; i++) {
    const day = new Date(Date.UTC(2031, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    if (heroEventForDate(day)) hero++;
  }
  check('hero days actually occur', hero > 0, `${hero} in ${DAYS} days`);
  check('hero days stay rare', hero / DAYS < 0.25, `${(hero / DAYS * 100).toFixed(1)}% of days`);

  // ── Every event is fully presented ──
  for (const type of ['ion_storm', 'acid_rain']) {
    const p = heroEventPresentation(type);
    check(`${type} has a presentation block`, !!p);
    for (const k of PRESENT_KEYS) {
      check(`${type}.present.${k} is set`, !!p?.[k], 'a hero event with a missing surface ships silent');
    }
    check(`${type} has a label`, !!p?.label);
  }
  check('an unknown event has no presentation', heroEventPresentation('nope_storm') === null);

  // ── Acid coverage: the gate the whole acid hazard is balanced against ──
  const p = getPlayer();
  const slicker = { tags: { slot: 'torso', covers: ['legs', 'head'], waterproof: true } };
  const waders  = { tags: { slot: 'feet', waterproof: true } };
  const coat    = { tags: { slot: 'torso' } };

  await recomputeInsulation(p, []);
  check('bare skin has no acid cover', p.acidCover === 0);

  await recomputeInsulation(p, [coat]);
  check('ordinary clothing is not acid cover', p.acidCover === 0, 'any torso layer must not count as protection');

  await recomputeInsulation(p, [slicker]);
  check('a slicker alone is partial cover', p.acidCover > 0 && p.acidCover < 1, `${p.acidCover}`);

  await recomputeInsulation(p, [slicker, waders]);
  check('slicker + waders is full immunity', p.acidCover === 1, `${p.acidCover}`);
}
