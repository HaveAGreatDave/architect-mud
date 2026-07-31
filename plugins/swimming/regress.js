// Swimming plugin regression suite — run by tests/regress.js (never loaded in
// production). Swimming has no player verbs (it's automatic on movement), so we
// exercise the pure cost math, the water-tile classifiers, and the `drowning`
// status effect the plugin registers.
import { _test } from './index.js';
import { applyEffect, tickEffects } from '../../server/engine/effects.js';
import { world } from '../../server/engine/world.js';

export default async function regress({ check, getPlayer }) {
  const { isSwimZone, isUnderwater, strokeCost, treadCost, BASE_STROKE, MIN_STROKE, DIVE_EXTRA } = _test;

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
