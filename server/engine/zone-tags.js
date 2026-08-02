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

// Dwelling = somewhere a person LIVES, which is a narrower question than "is this
// indoors" and a different one from "can this be rented".
//
// It exists because `home_zone` had drifted into meaning "where you can be found
// when you're not working" — 110 of 178 NPCs had their own shop floor, the studio
// stage or a street tile as their home. Home life read off `home_zone` alone, so a
// shopkeeper tidied her apartment in front of customers and eleven studio actors
// microwaved something questionable on a live set.
//
// Two flags, deliberately:
//   • is_apartment — the rentable pool, players and NPCs share it.
//   • is_dwelling  — everything else somebody genuinely lives in and nobody rents:
//                    the Reach cabins, Akerson's penthouse, the Long Watch
//                    bunkroom, a sewer lair.
//
// A workplace gets NEITHER, and that is the whole point. An NPC posted at their
// counter still stands there, still sleeps there, still talks to you — they just
// stop performing domestic scenes in public.
export function isDwellingZone(zone) {
  return !!(zone?.flags?.is_apartment || zone?.flags?.is_dwelling);
}

// Allow-sleep = an explicit "you may sleep here" marker WITHOUT the sanctuary
// bundle. Grants rest (safe-zone restore rate) but no combat protection /
// forcefield / spawn suppression. For places like the Precinct 9 holding cell
// where the game should let a prisoner doze but must NOT shield them.
export function allowsSleep(zone) {
  return hasTag(zone, 'allow_sleep');
}
