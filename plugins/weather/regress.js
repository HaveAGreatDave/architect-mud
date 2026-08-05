// Weather regression suite — run by tests/regress.js (never loaded in production).
//
// Covers the two things about hero events that are easy to break silently:
// the scheduling being DETERMINISTIC (the forecast promises a week ahead, so a
// day that reads "acid rain" on Monday must still be acid rain when it arrives),
// and every event carrying a complete presentation block (the checklist that
// stops a future third event shipping with no icon, no bed, and no pools).
import { heroEventForDate, heroEventPresentation, heroEventAnnounce } from './index.js';
import { recomputeInsulation } from '../../server/engine/commands/inventory.js';
import { skyVantage } from '../../server/engine/environment.js';
import { world } from '../../server/engine/world.js';

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

  // ── Every phase is written from BOTH vantages ──────────────────────────────
  // The announce is a thing you are LOOKING AT, and it used to go to everybody —
  // a player in a windowless bathroom was told a green glow was crawling up the
  // horizon. `inside` falls back to `line` so an unauthored event still works,
  // which is exactly why the fallback must not be allowed to hide an unwritten
  // line: an indoor variant identical to the outdoor one is the bug coming back.
  for (const type of ['ion_storm', 'acid_rain']) {
    for (const phase of ['approach', 'peak', 'passing']) {
      const a = heroEventAnnounce(type, phase);
      check(`${type}.${phase} announces from outside`, !!a?.open);
      check(`${type}.${phase} announces from inside too`, !!a?.inside);
      check(`${type}.${phase} tells the two apart`, a.open !== a.inside,
        'the indoor line is the outdoor one verbatim — somebody indoors is being told what the sky looks like');
    }
  }
  check('an unknown phase announces nothing', heroEventAnnounce('ion_storm', 'nope') === null);

  // ── Vantage: who can see the sky ───────────────────────────────────────────
  // Against the REAL world rather than synthetic zones — the rule reads three
  // different sources (grid_z, the interior flags, the windows table) and the
  // risk is that it disagrees with what those actually hold.
  const anyZone = (fn) => [...world.zones.values()].find(fn)?.id || null;
  const outdoor = anyZone(z => !z.flags?.is_interior && !z.flags?.is_apartment
    && !z.flags?.is_building && (z.grid_z ?? 0) >= 0);
  const buried  = anyZone(z => (z.grid_z ?? 0) < 0);
  const sealed  = anyZone(z => (z.flags?.is_interior || z.flags?.is_apartment) && !z.flags?.open_sky
    && (z.grid_z ?? 0) >= 0);

  if (outdoor) check('a street sees the sky', skyVantage(outdoor) === 'open', `${outdoor} → ${skyVantage(outdoor)}`);
  if (buried)  check('underground sees nothing', skyVantage(buried) === 'buried', `${buried} → ${skyVantage(buried)}`);
  // A sealed room is `open` only if it has a window facing out — which is the
  // feature, so this asserts the two possible answers rather than one.
  if (sealed) {
    const v = skyVantage(sealed);
    check('an interior is either sealed or looking through a window',
      v === 'sealed' || v === 'open', `${sealed} → ${v}`);
  }
  // Fail LOUD, not silent: this is the only announce a hero event gets, so a
  // zone the engine cannot place must be told too much rather than nothing.
  check('an unknown zone still hears it', skyVantage('zone_does_not_exist') === 'open');

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
