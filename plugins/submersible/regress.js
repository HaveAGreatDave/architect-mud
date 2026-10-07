// SUBMERSIBLE — regress. The arithmetic first (sub.js, driven second by second), then the verbs
// against a real seated Drake over a real water tile, because a check that only asserts a refusal
// cannot tell a working gate from a broken verb (see powerboat's regress on the same point).
import { newSub, stepSub, HULL_TIERS, tierOf, crushRate, bearing, MIN_WATER, regenAir, REGEN_S, MIN_AIR_FRAC, FLOOD_S, DESCEND_MS, PLANE_MS, SUB_CEIL } from './sub.js';
import { subs, subTick, regenTick, isLandTile, floorUnder, airMaxOf } from './index.js';
import { liveAircraft, bounds, surfaceAt, persistIfChanged } from '../flight/state.js';
import { getAllZones, zoneTerrain } from '../../server/engine/world.js';
import { wildlandsAt } from '../../client/shared/wildlands.js';

export default async function regress({ run, check, getPlayer }) {
  // ── The ladder ─────────────────────────────────────────────────────────────
  check('five hull tiers', HULL_TIERS.length === 5);
  check('each tier goes deeper and breathes longer',
    HULL_TIERS.every((t, i) => i === 0 || (t.depth > HULL_TIERS[i - 1].depth && t.air > HULL_TIERS[i - 1].air)));
  check('an unrated hull is tier 1', tierOf(undefined).tier === 1 && tierOf(0).tier === 1 && tierOf(99).tier === 5);

  // ── The dive, second by second ─────────────────────────────────────────────
  {
    const s = newSub(1, 10);
    for (let i = 0; i < 20; i++) stepSub(s, 1, 40);
    check('she descends to her trimmed depth and holds it', s.depth === 10, String(s.depth));
    const bottom = newSub(1, Infinity);
    for (let i = 0; i < 60; i++) stepSub(bottom, 1, 12);
    check('"floor" sits her just off the bottom, never in it', bottom.depth > 10 && bottom.depth < 12, String(bottom.depth));
    const shoal = newSub(1, 10);
    for (let i = 0; i < 10; i++) stepSub(shoal, 1, 40);
    const r = stepSub(shoal, 1, MIN_WATER - 1);
    check('a shoal forces her up', r.ev.includes('shoal') && shoal.target === 0);
  }
  {
    const s = newSub(1, 5);
    let evs = [], dmg = 0;
    for (let i = 0; i < s.airMax + 5; i++) { const r = stepSub(s, 1, 40); evs.push(...r.ev); dmg += r.damage; }
    check('air warnings fire once each, in order',
      ['air50', 'air25', 'air10'].every(k => evs.filter(e => e === k).length === 1) && evs.indexOf('air50') < evs.indexOf('air10'));
    check('running out of air blows her to the surface, and it costs hull', evs.includes('emergency') && s.target === 0 && dmg > 0);
  }
  {
    check('inside her rating the hull takes nothing', crushRate(20, 25) === 0);
    check('past her rating it takes more the further past', crushRate(40, 25) > crushRate(30, 25) && crushRate(30, 25) > 0);
    const s = newSub(1, 60);            // tier 1 is rated to 25 m
    let dmg = 0, evs = [];
    for (let i = 0; i < 120; i++) { const r = stepSub(s, 1, 80); dmg += r.damage; evs.push(...r.ev); }
    check('a tier-1 hull at 60 m creaks and then breaks', evs.includes('creak') && evs.includes('rivet') && dmg >= 1, dmg.toFixed(2));
  }
  // ── The tanks ──────────────────────────────────────────────────────────────
  {
    const max = HULL_TIERS[0].air;
    let a = 0;
    for (let i = 0; i < REGEN_S; i++) a = regenAir(a, max, 1);
    check('empty tanks refill in REGEN_S seconds and never overfill', Math.abs(a - max) < 1e-6 && regenAir(max, max, 5) === max);
    const part = newSub(1, 5, max * 0.3);
    check('a dive starts with what is in the tanks, not a fresh fill', part.air === max * 0.3);
    const evs = [];
    for (let i = 0; i < 5; i++) evs.push(...stepSub(part, 1, 40).ev);
    check('warnings already passed at the start of a dive do not fire at once', !evs.includes('air50'), evs.join(','));
  }
  // ── The ballast and the planes ─────────────────────────────────────────────
  {
    const s = newSub(1, 20);
    stepSub(s, 1, 40);
    const firstStep = s.depth;
    for (let i = 0; i < FLOOD_S; i++) stepSub(s, 1, 40);
    check('the tanks fill over FLOOD_S and she sinks slowly while they do',
      s.ballast === 1 && firstStep > 0 && firstStep < DESCEND_MS * 0.5, `${firstStep} / ballast ${s.ballast}`);
    // The stick, with the tanks full: dive, then let go and hold.
    const t0 = 1000;
    const d0 = s.depth;
    s.planes = 1; s.planesAt = t0;
    stepSub(s, 1, 40, t0 + 0.5);
    check('full down planes take her deeper at PLANE_MS', Math.abs(s.depth - d0 - PLANE_MS) < 1e-9, `${d0} → ${s.depth}`);
    const held = s.depth;
    s.planes = 0;
    for (let i = 0; i < 5; i++) stepSub(s, 1, 40, t0 + 1 + i);
    check('centring the stick holds her where it left her', s.depth === held, `${held} → ${s.depth}`);
    s.planes = 0.8; s.planesAt = t0;
    stepSub(s, 1, 40, t0 + 10);
    check('a stale planes order is ignored', s.depth === held);
    // Flown up on the planes she holds at the ceiling: only a blow (BOAT mode) surfaces her.
    let ev = [];
    for (let i = 0; i < 30; i++) { s.planes = -1; s.planesAt = t0 + 20 + i; ev = ev.concat(stepSub(s, 1, 40, t0 + 20 + i).ev); }
    check('steering up stops at the ceiling and she stays under', !ev.includes('surfaced') && !s.blow && s.depth === SUB_CEIL, `depth ${s.depth}`);
    // Blowing empties the tanks, and the planes cannot fight a blow.
    const b = newSub(1, 10);
    for (let i = 0; i < 12; i++) stepSub(b, 1, 40);
    b.target = 0; b.planes = 1; b.planesAt = 0;
    stepSub(b, 1, 40, 0.5);
    check('blowing drains the tanks and she rises even with the planes down', b.blow && b.ballast < 1 && b.depth < 10, `${b.depth} / ${b.ballast}`);
  }
  check('bearings: y grows south', bearing(0, -1) === 'north' && bearing(1, 0) === 'east' && bearing(0, 1) === 'south' && bearing(-1, -1) === 'north-west');

  // ── The verbs, on a real Drake over real water ─────────────────────────────
  const nobody = await run('submerge');
  check('submerging from nowhere says so', /not aboard/i.test(nobody?.message || ''), JSON.stringify(nobody));

  // The deepest authored water tile in the world, found through the same land test the tick uses.
  let best = null;
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || (z.grid_z ?? 0) !== 0) continue;
    if (zoneTerrain(z) !== 'water' && !z.flags?.water && z.flags?.terrain !== 'water') continue;
    if (isLandTile(z.grid_x, z.grid_y)) continue;
    const fake = { fx: z.grid_x, fy: z.grid_y, row: {} };
    const d = floorUnder(fake);
    if (!best || d > best.d) best = { z, d };
  }
  check('the world has water deep enough to dive in', !!best && best.d >= MIN_WATER, best ? best.d.toFixed(1) : 'none');

  // Off the map the server's sea is the painted one (wildlandsAt, what fillOffMap draws from). A
  // private rule here once read land under 31,000 tiles of open sea the cockpit's SUB gate let her
  // dive in, so every dive out there was refused.
  {
    const b = bounds();
    let wrong = null, deep = null;
    for (let y = b.miny - 40; y < b.miny && !wrong; y += 3) for (let x = b.minx - 40; x <= b.maxx + 40 && !wrong; x += 7) {
      if (surfaceAt(x, y)) continue;
      const sea = !!wildlandsAt(x, y).sea;
      if (isLandTile(x, y) === sea) wrong = `${x},${y}`;
      else if (sea && !deep && floorUnder({ fx: x, fy: y, row: {} }) >= MIN_WATER) deep = `${x},${y}`;
    }
    check('off the map, the server reads the sea the floor paints', !wrong, wrong || '');
    check('…and there is open sea past the map deep enough to dive', !!deep);
  }
  if (!best || best.d < MIN_WATER) return;

  const p = await getPlayer();
  const saved = { aircraftId: p.aircraftId, seat: p.seat };
  const id = 'rg_drake_sub';
  const live = {
    row: { id, custom_data: {}, damage: 0, engine_on: 0, grid_x: best.z.grid_x, grid_y: best.z.grid_y, is_wreck: 0 },
    type: { class: 'drake', name: 'Drake' }, occupants: new Set([p.id]),
    shape: { boat: true }, cont: { onGround: true }, fx: best.z.grid_x, fy: best.z.grid_y,
  };
  liveAircraft.set(id, live);
  p.aircraftId = id; p.seat = 'pilot';
  try {
    await run('submerge 2');
    check('submerge puts her under', subs.has(id));
    for (let i = 0; i < 3; i++) await subTick();
    check('…and the tick takes her down', subs.get(id)?.depth > 0, String(subs.get(id)?.depth));
    const gauges = await run('submerge');
    check('a bare submerge reads the gauges', /Depth .* Air \d+:\d\d/.test(gauges?.message || ''), JSON.stringify(gauges));
    const sonar = await run('sonar');
    check('sonar reports the bottom', /Bottom at/.test(sonar?.message || ''), JSON.stringify(sonar));
    await run('surface');
    for (let i = 0; i < 5; i++) await subTick();
    check('surface brings her up and ends the dive', !subs.has(id));

    // The tanks belong to the Drake: what the dive spent is still spent, and only the engine refills it.
    const max = airMaxOf(live);
    check('the dive drew on the tanks', live.subAir < max, `${live.subAir} of ${max}`);
    check('…and the figure is banked on the row', Number.isFinite(live.row.custom_data.sub_air));
    live.row.engine_on = 0;
    const before = live.subAir;
    regenTick(10);
    check('engine off: the tanks do not refill', live.subAir === before);
    live.row.engine_on = 1;
    regenTick(10);
    check('engine on and surfaced: the tanks refill', live.subAir > before, `${before} → ${live.subAir}`);
    live.subAir = max * MIN_AIR_FRAC * 0.5;
    const low = await run('submerge');
    check('she will not go under on nearly empty tanks', /Not enough to go under/.test(low?.message || '') && !subs.has(id), JSON.stringify(low));
    live.subAir = max;
    p.seat = 'passenger';
    const notPilot = await run('submerge');
    check('only the pilot can take her down', /pilot's seat/i.test(notPilot?.message || ''), JSON.stringify(notPilot));
  } finally {
    subs.delete(id); liveAircraft.delete(id);
    p.aircraftId = saved.aircraftId; p.seat = saved.seat;
  }

  // ── The periodic save skips a row that hasn't changed ─────────────────────
  // flight's tick and the dive both save through persistIfChanged. The id matches
  // no aircraft, so each write that does go out updates nothing.
  {
    const live = { row: { id: `regress_persist_${process.pid}`, grid_x: 1, grid_y: 2, altitude_band: 'ground', heading: 'n',
      parked_zone_id: null, fuel: 10.5, throttle: 0, engine_temp: 20, damage: 0, airborne: 0, engine_on: 1, is_wreck: 0, custom_data: {} } };
    check('persistIfChanged writes the first time', (await persistIfChanged(live)) === true);
    check('persistIfChanged skips an unchanged row', (await persistIfChanged(live)) === false);
    live.row.engine_temp = 20.0000001;   // below what a REAL column keeps
    check('persistIfChanged ignores a change the column cannot store', (await persistIfChanged(live)) === false);
    live.row.grid_x = 3;
    check('persistIfChanged writes a moved row', (await persistIfChanged(live)) === true);
    live.row.custom_data = { sub_air: 40 };
    check('persistIfChanged sees a custom_data change', (await persistIfChanged(live)) === true);
  }
}
