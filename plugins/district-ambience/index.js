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

// zone.smells handler. The ambient tick shows a district line 35% of the time
// and only when it feels like it; `smell` is the player deliberately asking, so
// it always answers — no dice roll, no abstaining. Weak on purpose: the
// neighbourhood is the background a room's real smells sit on top of, and it
// should never crowd out the pan that's burning.
//
// Same outdoor gate as the ambient line, for the same reason: you cannot smell
// the Slaglands from inside a sealed room.
function districtSmell(zone) {
  if (!isOutdoor(zone)) return undefined;
  const line = pickLine(districtFor(zone));
  // Sits exactly ON the baseline floor: outdoors, a deliberate sniff always
  // gets the neighbourhood, but it's the weakest thing in the room and drops off
  // the moment three realer smells are competing with it.
  return line ? { text: `under it all, ${line.replace(/\.$/, '')}`, strength: 5 } : undefined;
}

export const hooks = {
  'zone.describeAmbient': describeAmbient,
  'zone.smells': districtSmell,
};

export const _test = { describeAmbient, isOutdoor, pickLine, districtSmell };

console.log('[district-ambience] Plugin loaded.');
