// Zone tag helpers — the readers for zone properties that used to be columns.
// zones.flags is the catalog-validated zone tag bag (scope 'zone' in
// client/shared/tagCatalog.js); tagsOf() already reads it, so these are thin
// conventions every consumer goes through instead of touching the raw bag.
//
// Pure functions over the zone object only — no world.js import (danger.js and
// districts.js sit under world.js in the import graph and use these too).
import { hasTag, tagValue } from './tags.js';

// Ambient radiation 0–100. Entry gain is floor(value * 0.1) in cmdMove.
export function getZoneRadiation(zone) {
  return Number(tagValue(zone, 'radiation', 0)) || 0;
}

// Sanctuary = the civilization carve-out: combat protection (published through
// the protection substrate in world.js), safe sleep, AI safe-flee target, and
// no hostile spawns. Attached DELIBERATELY — the legacy is_safe_zone column
// (a builder-default sleep marker stamped on 61% of the world) was dropped
// without conversion (2026-07 decision): sleep now requires an owned apartment
// or a curated sanctuary.
export function isSanctuary(zone) {
  return hasTag(zone, 'sanctuary');
}

// Allow-sleep = an explicit "you may sleep here" marker WITHOUT the sanctuary
// bundle. Grants rest (safe-zone restore rate) but no combat protection /
// forcefield / spawn suppression. For places like the Precinct 9 holding cell
// where the game should let a prisoner doze but must NOT shield them.
export function allowsSleep(zone) {
  return hasTag(zone, 'allow_sleep');
}
