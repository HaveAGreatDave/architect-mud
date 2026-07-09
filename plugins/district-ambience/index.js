/**
 * District ambience plugin — sensory signatures.
 *
 * Each district (server/engine/districts.js) carries a `signature` pool of
 * sensory leitmotif lines — a smell, a sound-texture, an air/light quality that
 * recurs often enough to imprint the neighborhood without content-authoring per
 * zone. This plugin surfaces one of those lines on the `zone.describeAmbient`
 * tick, at a LOW weight so hand-authored zone ambients and the global pool still
 * carry most of the atmosphere (see gameLoop.ambientTick).
 *
 * Two hard rules:
 *   1. OUTDOOR ONLY. Interiors/apartments/buildings never get a district line —
 *      you can't smell the Slaglands from inside a sealed room. Same gate the
 *      HVAC/weather layers use (flags.is_interior / is_apartment / is_building).
 *   2. ABSTAIN with `undefined`, never null. fireHook keeps the last non-undefined
 *      result across all handlers; returning undefined leaves other plugins'
 *      ambient (and the engine's own pool fallthrough) untouched.
 */
import { districtFor } from '../../server/engine/districts.js';

// Share of outdoor ambient ticks that become a district signature line. The rest
// abstain, falling through to authored `ambient_events` / the global pool.
const DISTRICT_AMBIENT_CHANCE = 0.35;

function isOutdoor(zone) {
  const f = zone?.flags || {};
  return !f.is_interior && !f.is_apartment && !f.is_building;
}

function pickLine(district) {
  const pool = district?.signature;
  if (!pool || !pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// zone.describeAmbient handler. Returns a plain line (gameLoop wraps it in the
// .msg-ambient span), or undefined to abstain.
function describeAmbient(zone) {
  if (!isOutdoor(zone)) return undefined;
  if (Math.random() > DISTRICT_AMBIENT_CHANCE) return undefined;
  return pickLine(districtFor(zone)) || undefined;
}

export const hooks = {
  'zone.describeAmbient': describeAmbient,
};

export const _test = { describeAmbient, isOutdoor, pickLine };

console.log('[district-ambience] Plugin loaded.');
