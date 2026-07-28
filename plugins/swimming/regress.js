// Swimming plugin regression suite — run by tests/regress.js (never loaded in
// production). Swimming has no player verbs (it's automatic on movement), so we
// exercise the pure cost math, the water-tile classifiers, and the `drowning`
// status effect the plugin registers.
import { _test } from './index.js';
import { applyEffect, tickEffects } from '../../server/engine/effects.js';
import { getZone, getAllZones } from '../../server/engine/world.js';
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
  check('isSwimZone: painted water', isSwimZone({ flags: { terrain: 'water' } }) === true);
  check('isSwimZone: legacy deep-water flag still reads (deprecated fallback)', isSwimZone({ flags: { water: true } }) === true);
  check('isSwimZone: underwater tile', isSwimZone({ flags: { underwater: true } }) === true);
  check('isSwimZone: dry land is not swim water', isSwimZone({ flags: { terrain: 'road' } }) === false);
  check('isSwimZone: null zone safe', isSwimZone(null) === false);
  check('isUnderwater true only for the flag', isUnderwater({ flags: { underwater: true } }) === true && isUnderwater({ flags: { terrain: 'water' } }) === false);

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
