// Weather regression suite — run by tests/regress.js (never loaded in production).
//
// Covers the two things about hero events that are easy to break silently:
// the scheduling being DETERMINISTIC (the forecast promises a week ahead, so a
// day that reads "acid rain" on Monday must still be acid rain when it arrives),
// and every event carrying a complete presentation block (the checklist that
// stops a future third event shipping with no icon, no bed, and no pools).
import { heroEventForDate, heroEventPresentation, heroEventAnnounce, _testWeather } from './index.js';
import { recomputeInsulation } from '../../server/engine/commands/inventory.js';
import { skyVantage, isIndoorZone, getWindowsForZone, setWindowState } from '../../server/engine/environment.js';
import { world } from '../../server/engine/world.js';

const PRESENT_KEYS = ['icon', 'fx', 'audio', 'pool', 'sky', 'severe'];

export default async function regress({ check, getPlayer }) {
  // ── The ambient cloud floor rises with the weather ────────────────────────
  // Until 2026-08-31 it did not: storm sat at 0.5 and rain at 0.45, both BELOW a plain overcast
  // day's 0.7 — so forcing Max Storm made most of the map LESS cloudy than a grey Tuesday, which
  // is the opposite of what the button is for. The cells decide where it thickens; this is the
  // floor they sit on, and the floor has to be monotonic or no amount of cell tuning reads right.
  {
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    const floorFor = (type) => _testWeather.systemsForForecast(
      type, 1.0, 12, 30, bounds, _testWeather.mulberry32(_testWeather.seedFromString('regress:cloudfloor'))
    ).baseCloud;

    const clear = floorFor('clear'), cloudy = floorFor('cloudy'), overcast = floorFor('overcast');
    const rain = floorFor('rain'), storm = floorFor('thunderstorm');
    check('cloud floor: clear < cloudy', clear < cloudy, `${clear} < ${cloudy}`);
    check('cloud floor: cloudy < overcast', cloudy < overcast, `${cloudy} < ${overcast}`);
    // The two that were actually inverted. A precipitating sky is overcast by definition.
    check('cloud floor: overcast <= rain', overcast <= rain, `${overcast} <= ${rain}`);
    check('cloud floor: rain < storm', rain < storm, `${rain} < ${storm}`);
    check('a storm is the cloudiest thing there is', storm >= 0.8, String(storm));
  }

  // ── The snapshot carries that floor to every consumer ─────────────────────
  // sampleWeatherAt opens at field.baseCloud and only then maxes over the cells. The flight sim
  // reads this snapshot and runs the same overlap math client-side — so a snapshot that omits the
  // floor hands the canopy a sky up to 0.8 less cloudy than the one the ground is standing under,
  // and nothing anywhere throws. It is an absent KEY, which is why it went unnoticed for months.
  {
    const snap = _testWeather.getWeatherFieldSnapshot();
    check('the field snapshot carries the ambient cloud floor', typeof snap.baseCloud === 'number',
      `baseCloud=${JSON.stringify(snap.baseCloud)}`);
  }

  // ── The gap between regions has weather now ───────────────────────────────
  // A void crossing is walked through it and a highway is driven along it, and until 2026-08-21 both
  // happened in flat baseline weather: no heat off Terminus, no acid drifting out of the
  // Scarletwastes, a hundred miles of nothing in every sense. The gap is interpolated between its
  // neighbours instead of being its own authored thing.
  {
    const saved = _testWeather.field.regionSpans;
    const rb = await _testWeather.computeRegionBoxes();

    // ⚠ THE TRAP THIS EXISTS FOR. `effectiveBias` returns null for a region with no temp, dryness or
    // acid, and the box list filters those out — so Coldwater (null climate_bias, no REGION_BIAS
    // default) is absent from `boxes` entirely. A blend that only knew biased regions would skip the
    // busiest region on the map on all three of its roads and mix Deadwater with the Reach instead.
    const inSpans = rb.spans.some(r => r.id === 'region_coldwater');
    const inBoxes = rb.boxes.some(r => r.id === 'region_coldwater');
    check('a baseline region is in the blend list', inSpans, `spans=${rb.spans.length}`);
    check('…and correctly absent from the containment list', !inBoxes, `boxes=${rb.boxes.length}`);
    check('every region is spanned', rb.spans.length >= rb.boxes.length && rb.spans.length >= 4,
      `${rb.spans.length} spans / ${rb.boxes.length} boxes`);

    _testWeather.field.regionSpans = rb.spans;
    // Midway along the Coldwater→Terminus road, which is 282 tiles of gap and the longest in the game.
    const mid = _testWeather.blendedBiasAt(1060, 943);
    const terminus = rb.spans.find(r => r.id === 'region_terminus');
    check('the gap between two regions has a climate at all', !!mid, JSON.stringify(mid));
    if (mid && terminus) {
      // Between the two: warmer than Coldwater's baseline, cooler than Terminus' own lean.
      check('…blended between its neighbours rather than taking either whole',
        mid.temp > 0 && mid.temp < terminus.temp, `${mid.temp?.toFixed(2)} vs terminus ${terminus.temp}`);
      check('…and it names the pair it came from', /^gap:/.test(mid.id || ''), mid.id);
    }
    // Deep inside a region the containment answer still wins, blend or no blend.
    const inside = _testWeather.regionBiasAt(1220, 940);
    check('a point inside a region still takes that region whole',
      inside?.id === 'region_terminus', inside?.id);

    _testWeather.field.regionSpans = saved;
  }
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
  // The old bound was 0.25, which is five times the dial and would not have
  // noticed it drifting. Read the target in REAL time: a game day is 8 real hours
  // at time_scale 3, so this fraction is tripled before a player experiences it —
  // 0.04 of game days is one hero event every ~5.7 real days. 0.10 leaves room for
  // sampling noise on 400 days without letting the dial quietly double.
  check('hero days stay rare', hero / DAYS < 0.10, `${(hero / DAYS * 100).toFixed(1)}% of days`);

  // A rainbow is a hero event by machinery only. It is a property of a MOMENT
  // (a shower walking off under a sun that is still up), not of a day, so it
  // must never be schedulable — a forecast that promised one a week out would be
  // promising something the field alone decides.
  for (let i = 0; i < 800; i++) {
    const day = new Date(Date.UTC(2031, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const t = heroEventForDate(day);
    if (t === 'rainbow' || t === 'triple_rainbow') { check('rainbows are never scheduled', false, day); break; }
    if (i === 799) check('rainbows are never scheduled', true);
  }

  // ── Every event is fully presented ──
  for (const type of ['ion_storm', 'acid_rain', 'rainbow', 'triple_rainbow']) {
    const p = heroEventPresentation(type);
    check(`${type} has a presentation block`, !!p);
    for (const k of PRESENT_KEYS) {
      check(`${type}.present.${k} is set`, !!p?.[k], 'a hero event with a missing surface ships silent');
    }
    check(`${type} has a label`, !!p?.label);
  }
  check('an unknown event has no presentation', heroEventPresentation('nope_storm') === null);

  // A rainbow must never lift the severity floor. currentBaseSeverity() takes the
  // max of the day and the active event, so a non-zero severity here would put
  // every gear-gated lethal channel on alert because the sky looked nice.
  for (const type of ['rainbow', 'triple_rainbow']) {
    const p = heroEventPresentation(type);
    check(`${type} is benign`, p.benign === true);
    check(`${type} carries no severity`, p.severity === 0, `${p.severity}`);
  }
  check('a storm is not benign', heroEventPresentation('ion_storm').benign === false);

  // ── Every phase is written from BOTH vantages ──────────────────────────────
  // The announce is a thing you are LOOKING AT, and it used to go to everybody —
  // a player in a windowless bathroom was told a green glow was crawling up the
  // horizon. `inside` falls back to `line` so an unauthored event still works,
  // which is exactly why the fallback must not be allowed to hide an unwritten
  // line: an indoor variant identical to the outdoor one is the bug coming back.
  for (const type of ['ion_storm', 'acid_rain', 'rainbow', 'triple_rainbow']) {
    for (const phase of ['approach', 'peak', 'passing']) {
      const a = heroEventAnnounce(type, phase);
      for (const vantage of ['open', 'window', 'sealed']) {
        check(`${type}.${phase} announces from ${vantage}`, !!a?.[vantage]);
      }
      check(`${type}.${phase} tells all three vantages apart`,
        new Set([a.open, a.window, a.sealed]).size === 3,
        'a vantage is falling back to the outdoor line — somebody indoors is being told what the sky looks like');
      // The key set IS the vantage set, minus `buried`, which hears nothing by
      // having no key at all. A typo here is a phase that silently says nothing.
      check(`${type}.${phase} has no line for underground`, a.buried === undefined);
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
  // An interior is `window` only if it has one facing out and unobstructed —
  // which is the feature, so this asserts the two possible answers rather than
  // one. What it must NEVER be is `open`: a room with a roof is not outdoors.
  if (sealed) {
    const v = skyVantage(sealed);
    check('an interior is sealed, or looking through a window, but never open',
      v === 'sealed' || v === 'window', `${sealed} → ${v}`);
  }
  // Fail LOUD, not silent: this is the only announce a hero event gets, so a
  // zone the engine cannot place must be told too much rather than nothing.
  check('an unknown zone still hears it', skyVantage('zone_does_not_exist') === 'open');

  // ── The Under is sheltered, and nothing had ever said so ───────────────────
  // Its tiles are DISTRICT tiles on a lower level: they carry no `is_interior`,
  // so every climate question used to answer "outdoors" for them. A sewer was
  // lit by the sun, dark at night, took wind chill, and had rain broadcast to
  // it. `isIndoorZone` now answers on grid_z, which is the same fact `buried`
  // reads — one rule, so the light sim and the weather announce cannot disagree.
  if (buried) {
    const z = world.zones.get(buried);
    check('an underground tile counts as sheltered', isIndoorZone(z), buried);
    check('...and has no window to be lit through', skyVantage(buried) === 'buried');
  }
  // The rule must not have swallowed the ordinary outdoor case with it.
  if (outdoor) check('a street is still outdoors', !isIndoorZone(world.zones.get(outdoor)), outdoor);

  // ── Windows are a zone flag now ────────────────────────────────────────────
  // The table is gone; a window is `flags.window` plus runtime curtain/glass in
  // RAM. Every residence has one, which is the whole reason for the move: a
  // window used to cost a whole entity to author and the world had three.
  const withWindow = [...world.zones.values()].filter(z => z.flags?.window);
  check('the world has windows in it now', withWindow.length > 100, `${withWindow.length}`);
  const anyApt = [...world.zones.values()].filter(z => z.flags?.is_apartment);
  check('every rentable residence has one',
    anyApt.every(z => !!z.flags.window), anyApt.filter(z => !z.flags.window).map(z => z.id).join(', '));
  if (withWindow.length) {
    const w = getWindowsForZone(withWindow[0].id);
    check('a flagged zone yields one window row', w.length === 1, JSON.stringify(w));
    check('...shaped the way every caller already reads it',
      w[0].id && w[0].name && w[0].curtain_open === 1 && w[0].glass_state === 'intact', JSON.stringify(w[0]));
    // Curtain state is RUNTIME. If this ever round-trips through zones.flags,
    // every drawn curtain becomes a content diff.
    await setWindowState(w[0].id, { curtain_open: 0 });
    check('drawing the curtain changes the row', getWindowsForZone(withWindow[0].id)[0].curtain_open === 0);
    check('...and never touches the authored flag', world.zones.get(withWindow[0].id).flags.window.curtain_open === undefined);
    check('...and a drawn curtain seals the room off from the sky',
      skyVantage(withWindow[0].id) === 'sealed' || !isIndoorZone(world.zones.get(withWindow[0].id)));
    await setWindowState(w[0].id, { curtain_open: 1 });
  }
  check('a zone with no window flag has none', getWindowsForZone('zone_does_not_exist').length === 0);

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
