// Swimming plugin regression suite — run by tests/regress.js (never loaded in
// production). Swimming has no player verbs (it's automatic on movement), so we
// exercise the pure cost math, the water-tile classifiers, and the `drowning`
// status effect the plugin registers.
import { _test } from './index.js';
import { applyEffect, tickEffects } from '../../server/engine/effects.js';
import { world, getZone, getAllZones } from '../../server/engine/world.js';
import { runMoveGates } from '../../server/engine/movement-gates.js';

export default async function regress({ run, check, getPlayer }) {
  const { isSwimZone, isUnderwater, strokeCost, treadCost, isVesselZone, vesselAt, vesselNear, waterUnder,
          BASE_STROKE, MIN_STROKE, DIVE_EXTRA } = _test;
  // Surface water on her map — she sails, so every vessel assertion below is derived
  // from her live position rather than a hardcoded berth.
  const getAllWater = () => getAllZones().filter(z =>
    z.map_id === getZone('zone_echelon_exterior')?.map_id && !z.flags?.underwater &&
    !z.flags?.vessel && isSwimZone(z) && z.grid_x != null);

  // ── Water-tile classifiers ──────────────────────────────────────────────────
  // isSwimZone asks the DERIVED `swimmable` property, not the paint — the build
  // resolves terrain preset ∪ tile override into zone_derived.props. So a fixture
  // has to supply the row the build would have written; a bare flags bag is not a
  // tile as far as gameplay is concerned. See terrain-property-presets.md.
  const SWIM = 'zone_regress_swim', DRY = 'zone_regress_dry', FROZEN = 'zone_regress_frozen',
        UW = 'zone_regress_underwater';
  const prevRender = new Map();
  const derive = (id, props) => { prevRender.set(id, world.render.get(id)); world.render.set(id, { zone_id: id, spec: {}, props }); };
  derive(SWIM,   { liquid: true,  swimmable: true,  underwater: false, routable: false, buildable: false });
  derive(DRY,    { liquid: false, swimmable: false, underwater: false, routable: true,  buildable: true });
  derive(FROZEN, { liquid: false, swimmable: false, underwater: false, routable: true,  buildable: false }); // water you walk on
  derive(UW,     { liquid: true,  swimmable: true,  underwater: true,  routable: false, buildable: false });
  try {
    check('isSwimZone: a tile the build resolved swimmable', isSwimZone({ id: SWIM, flags: { terrain: 'water' } }) === true);
    check('isSwimZone: dry land is not swim water', isSwimZone({ id: DRY, flags: { terrain: 'road' } }) === false);
    // The frozen bay: still terrain water, still blue on the map, NOT swimmable
    // because the tile overrode the preset. This is the case the tristate shape
    // exists for — if the override rung ever collapses back to presence-only,
    // this is what fails.
    check('isSwimZone: a frozen bay is water you do not swim in',
      isSwimZone({ id: FROZEN, flags: { terrain: 'water', swimmable: false } }) === false);
    // The legacy `flags.water` marker was DELETED 2026-07-30 (it sat on no tile, which had
    // quietly turned every water check in GPS/pathfinding into a no-op). Assert it stays inert
    // so nobody resurrects a second way to say "water".
    check('isSwimZone: the removed legacy water flag is inert', isSwimZone({ id: DRY, flags: { water: true } }) === false);
    // `underwater` joined the props rail on 2026-07-30 — preset by its own terrain,
    // which paints exactly like water. It was an authored flag on 82 tiles that ALL
    // carried terrain 'water': two facts saying one thing.
    check('isSwimZone: an underwater tile is swim water', isSwimZone({ id: UW }) === true);
    check('isUnderwater: only the underwater tile', isUnderwater({ id: UW }) === true && isUnderwater({ id: SWIM }) === false);
    check('isUnderwater: the removed raw flag is inert', isUnderwater({ id: DRY, flags: { underwater: true } }) === false);
    check('isSwimZone: null zone safe', isSwimZone(null) === false);
  } finally {
    for (const [id, r] of prevRender) { if (r) world.render.set(id, r); else world.render.delete(id); }
  }
  // (isUnderwater is asserted above, against the derived rows — it reads the resolved
  // property now, not a raw flag, so a bare flags bag can no longer stand in for a tile.)

  // ── Stroke cost scales with skill, floors, dive surcharge ───────────────────
  check('unskilled stroke costs the base', strokeCost(0) === BASE_STROKE, String(strokeCost(0)));
  check('skill makes a stroke cheaper', strokeCost(6) < strokeCost(0), `${strokeCost(6)} < ${strokeCost(0)}`);
  check('stroke never cheaper than the floor', strokeCost(999) === MIN_STROKE, String(strokeCost(999)));
  check('diving down adds the buoyancy surcharge', strokeCost(0, true) === BASE_STROKE + DIVE_EXTRA, String(strokeCost(0, true)));

  // ── Tread cost lessens with skill but never zeroes ──────────────────────────
  check('tread bleed floors at 1', treadCost(999) === 1, String(treadCost(999)));
  check('skill lessens the tread bleed', treadCost(10) <= treadCost(0), `${treadCost(10)} <= ${treadCost(0)}`);

  // ── Vessels: her tile is closed, her sides are the way up ───────────────────
  const deck = getZone('zone_echelon_exterior');
  check('the Echelon is a boardable vessel zone', isVesselZone(deck) === true, JSON.stringify(deck?.flags?.vessel));

  // Her hull fills the water zone sharing her coordinates — that tile is shut, and the
  // one alongside is where you `embark` from. Derived from her LIVE position: she sails.
  const underHull = getAllWater().find(z => z.grid_x === deck.grid_x && z.grid_y === deck.grid_y);
  const alongside = getAllWater().find(z => Math.abs(z.grid_x - deck.grid_x) + Math.abs(z.grid_y - deck.grid_y) === 1);
  check('a water tile exists under her hull to close off', !!underHull, `${deck?.grid_x},${deck?.grid_y}`);
  check('open water alongside her exists to board from', !!alongside);
  check('her own tile reads as occupied by her', vesselAt(underHull)?.id === deck.id);
  check('a tile alongside is not occupied by her', vesselAt(alongside) === null);
  check('embarking is offered from alongside', vesselNear(alongside)?.id === deck.id);
  check('embarking is NOT offered from under her keel (you never get there)', vesselNear(underHull) === null);
  check('going over the side lands you alongside, never under the hull', waterUnder(deck)?.id !== underHull?.id && !!waterUnder(deck));

  const g = await runMoveGates({ player: getPlayer(), from: alongside, to: underHull, direction: 'north' });
  check('swimming under the hull is refused, and names the way up', g?.block === true && /embark/i.test(g?.message || ''), g?.message);

  const g2 = await runMoveGates({ player: getPlayer(), from: underHull, to: alongside, direction: 'north' });
  check('ordinary open water is unaffected by the hull gate', !g2?.block, JSON.stringify(g2));

  // The verb seam: `embark` on dry land is still the flight plugin's answer, never ours.
  const r = await run('embark');
  check('embark ashore still answers for aircraft', r?.type === 'emote' && /aircraft/i.test(r.message || ''), r?.message);

  // ── The swimmer roster: who the per-second tick is allowed to look at ───────
  // The tick no longer derives this by walking every logged-in player, so the
  // roster IS the correctness boundary — an id that never gets added is a player
  // who never drowns, and one that never leaves is a body treading water ashore.
  {
    const { syncSwimmer, dropSwimmer, swimmers, swimTick } = _test;
    const p = getPlayer();
    const savedZone = p.current_zone, savedHp = p.hp, savedStatuses = p.statuses, savedStam = p.stamina;
    const savedBoat = p._hasBoat, savedSub = p._submerged;
    swimmers.clear();

    p.current_zone = alongside.id;
    p._hasBoat = false;
    check('entering open water puts you on the roster', syncSwimmer(p) === true && swimmers.has(p.id));
    check('…and marks you submerged for wetness/temperature to read', p._submerged === true);

    p.current_zone = deck.id;                     // hauled out onto her deck
    check('leaving the water takes you off the roster', syncSwimmer(p) === false && !swimmers.has(p.id));
    check('…and clears the submerged flag', p._submerged === false && p._breath === null);

    // A boat rides you across the surface: submerged is false, so there is no tread,
    // no breath and no drowning — and therefore nothing for the tick to do.
    p.current_zone = alongside.id;
    p._hasBoat = true;
    check('riding a boat keeps you off the roster', syncSwimmer(p) === false && !swimmers.has(p.id));
    p._hasBoat = false;

    // Logging out mid-swim must not leave an id nobody can serve.
    p.current_zone = alongside.id;
    syncSwimmer(p);
    dropSwimmer(p);
    check('logging out clears you from the roster', !swimmers.has(p.id) && p._submerged === false);

    // Self-heal: an id for a player who is no longer live is dropped by the tick
    // rather than being re-checked every second for the rest of the process.
    swimmers.add('nobody-at-all');
    await swimTick();
    check('the tick sweeps an id with no live player', !swimmers.has('nobody-at-all'));

    // An empty roster is the common case and must cost nothing — no live-player walk.
    swimmers.clear();
    check('an empty roster leaves the tick with nothing to do', swimmers.size === 0);

    p.current_zone = savedZone; p.hp = savedHp; p.statuses = savedStatuses;
    p.stamina = savedStam; p._hasBoat = savedBoat; p._submerged = savedSub;
    swimmers.clear();
  }

  // ── The `drowning` status effect bleeds HP (engine tick would persist/kill) ──
  const p = getPlayer();
  const savedHp = p.hp, savedStatuses = p.statuses;
  p.hp = 100; p.hp_max = 100; p.statuses = [];
  applyEffect(p, 'drowning', 3);
  const msgs = tickEffects(p);
  check('drowning is registered and drains HP', p.hp < 100, `hp=${p.hp}`);
  check('drowning emits a warning line', msgs.some(m => /drown/i.test(m)), msgs.join(' | '));
  p.hp = savedHp; p.statuses = savedStatuses;
}
