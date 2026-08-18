import { world, doorOnLink } from './world.js';
import { allExits } from './exits.js';
import { OPPOSITE } from './directions.js';

// Minimum intensity for a sound to be heard at a given distance.
const HEAR_THRESHOLD = 0.5;

// ── Noisy-zone index ─────────────────────────────────────────────────────────
//
// `listen` reaches up to a dozen zones, and asking every one of them "what do
// you sound like" means a `gatherHook` fan-out across every plugin per zone —
// paid in full even when the entire neighbourhood is silent, which it usually
// is. This index inverts that: a source of ONGOING noise registers its zone, and
// the verb only interrogates zones that are actually in the set.
//
// So a listen in a quiet street costs zero hook calls, and a listen next to a
// kitchen costs one. It is the same trick as cooking's live-cook registry — RAM
// is the source of truth for runtime state, and the write funnel is narrow
// enough to keep honest.
//
// Refcounted by an opaque key (an inventory row id, a furniture id) so two cooks
// on two stoves in one room don't cancel each other when the first one finishes.
const noisy = new Map(); // zoneId -> Set(key)

export function markNoisy(zoneId, key) {
  if (!zoneId || key == null) return;
  let keys = noisy.get(zoneId);
  if (!keys) noisy.set(zoneId, keys = new Set());
  keys.add(String(key));
}

export function clearNoisy(zoneId, key) {
  const keys = noisy.get(zoneId);
  if (!keys) return;
  keys.delete(String(key));
  if (!keys.size) noisy.delete(zoneId);
}

// Sources sometimes lose track of where they were (a vessel carried to another
// room mid-cook). Cheap enough to sweep by key when that happens.
export function clearNoisyKey(key) {
  const k = String(key);
  for (const [zoneId, keys] of noisy) {
    if (keys.delete(k) && !keys.size) noisy.delete(zoneId);
  }
}

export const isNoisy = zoneId => noisy.has(zoneId);
export const noisyZoneCount = () => noisy.size;

// A closed, intact door on an edge muffles sound crossing it. Modeled as extra
// distance: inverse-square attenuation both shortens the reach and drops more
// words, so a closed door makes the room beyond you sound faint and clipped. A
// smashed door (hp<=0) or an open one is just a hole — no muffling.
// Doubled so a closed door heavily deadens all crossing noise (weather ambience
// included) — the room beyond stays at most barely audible, not merely faint.
const DOOR_MUFFLE_HOPS = 4;
// (OPPOSITE is imported from ./directions.js — this file used to keep its own
// byte-identical copy.)

function edgeMuffle(zoneId, dir, neighborId) {
  const door = doorOnLink(zoneId, dir, neighborId);
  return door && door.hp > 0 && !door.is_open ? DOOR_MUFFLE_HOPS : 0;
}

// Inverse-square intensity: loudness / (d² + 1). At d=0: loudness. Falls off quickly.
function intensity(loudness, distance) {
  return loudness / (distance * distance + 1);
}

// Weighted shortest-path over zone exits out to the furthest tile where intensity
// > threshold. Closed doors add muffle-distance to the edge they sit on, so a
// path through one lands farther away (fainter). Relaxes distances (re-enqueues
// on improvement) so an open route is still preferred over a doored one.
// Returns Map<zoneId, distance>.
export function getSoundReach(originZoneId, loudness) {
  const reach = new Map([[originZoneId, 0]]);
  const queue = [[originZoneId, 0]];
  while (queue.length) {
    const [zoneId, dist] = queue.shift();
    if (dist > reach.get(zoneId)) continue;              // stale entry superseded by a shorter path
    if (intensity(loudness, dist + 1) < HEAR_THRESHOLD) continue;
    const zone = world.zones.get(zoneId);
    if (!zone) continue;
    for (const { dir, target: neighborId } of allExits(zone)) {
      const nd = dist + 1 + edgeMuffle(zoneId, dir, neighborId);
      if (!reach.has(neighborId) || nd < reach.get(neighborId)) {
        reach.set(neighborId, nd);
        queue.push([neighborId, nd]);
      }
    }
  }
  return reach;
}

// Drop words proportionally to attenuation at distance d.
// At d=0: no drop. At large d, up to ~50% of words may vanish.
function dropWords(message, loudness, distance) {
  if (distance === 0) return message;
  const attenuation = 1 - intensity(loudness, distance) / loudness; // 0..1
  const dropChance = attenuation * 0.55;
  const words = message.split(/\s+/);
  const result = words.map(w => Math.random() < dropChance ? null : w).filter(Boolean);
  if (!result.length) return null;
  // Add ellipsis where words were dropped
  return words
    .map(w => Math.random() < dropChance ? '...' : w)
    .join(' ')
    .replace(/(\.\.\. ?){2,}/g, '... ')
    .trim();
}

// Wrap text in the appropriate distance prefix.
function distancePrefix(distance, loudness) {
  const vol = intensity(loudness, distance);
  if (distance === 0) return '';
  if (vol >= 4) return 'Nearby, ';
  if (vol >= 1.5) return 'In the distance, ';
  return 'Faintly, ';
}

// Propagate a sound from originZoneId outward. Calls broadcastFn for each zone.
// broadcastFn(zoneId, payload)
// `flavour` marks the sound as scene-setting rather than news — the periodic room
// ambient ("water drips somewhere behind the wall") as opposed to a gunshot or a
// scream. It rides the payload so the Display Mode `log` rung can drop the first
// and keep the second; see the note in broadcast() in server/index.js. Default
// false, so a caller that says nothing is treated as news. That direction is
// deliberate: over-speaking is a nuisance, under-speaking is a player not being
// told somebody just fired a gun next door.
export function propagateSound(originZoneId, message, loudness, broadcastFn, flavour = false) {
  const reach = getSoundReach(originZoneId, loudness);
  for (const [zoneId, distance] of reach) {
    let text = distance === 0 ? message : dropWords(message, loudness, distance);
    if (!text) continue;
    const prefix = distancePrefix(distance, loudness);
    const cssClass = distance === 0 ? 'msg-ambient' : 'msg-ambient msg-ambient-distant';
    broadcastFn(zoneId, {
      type: 'ambient',
      message: `<span class="${cssClass}">${prefix}${text}</span>`,
      loudness,
      ...(flavour ? { flavour: true } : {}),
    });
  }
}

// Propagate a one-shot audio SFX outward from an origin zone.
// Gain at each hop = loudness * (1/3)^distance; clamped to [0,1] for playback.
// Propagation stops when the gain falls below AUDIO_STOP_THRESHOLD.
const AUDIO_STOP_THRESHOLD = 0.05;

// A closed, intact door heavily deadens SFX crossing it: the crossing gain is
// cut to a ninth (two extra 1/3 hops on top of the normal one), so the room
// beyond a shut door is at most barely audible but not fully sealed off.
const DOOR_MUFFLE_GAIN = 1 / 9;

// ONE COPY PER ZONE. The walk relaxes — a room first reached through a closed
// door can be reached again, louder, by a longer open route — so broadcasting as
// each entry is dequeued sent that room the same cue twice, at two different
// gains. Two plays of one sound a beat apart is heard as an echo, not as a
// louder sound. So the walk only resolves gains; the sending happens once it is
// finished, exactly as `propagateSound` already does with its reach map.
export function propagateAudio(originZoneId, sfxDef, loudness, broadcastFn) {
  const visited = new Map([[originZoneId, loudness]]);
  const queue = [[originZoneId, loudness]];
  while (queue.length) {
    const [zoneId, gain] = queue.shift();
    if (gain < visited.get(zoneId)) continue;      // stale entry superseded by a louder path
    const hopGain = gain / 3;
    if (hopGain < AUDIO_STOP_THRESHOLD) continue;
    const zone = world.zones.get(zoneId);
    if (!zone) continue;
    for (const { dir, target: neighborId } of allExits(zone)) {
      // A closed door on this edge muffles the crossing further; relax on a
      // louder path so an open route is still preferred over a doored one.
      const nextGain = edgeMuffle(zoneId, dir, neighborId) ? hopGain * DOOR_MUFFLE_GAIN : hopGain;
      if (nextGain < AUDIO_STOP_THRESHOLD) continue;
      if (!visited.has(neighborId) || nextGain > visited.get(neighborId)) {
        visited.set(neighborId, nextGain);
        queue.push([neighborId, nextGain]);
      }
    }
  }
  for (const [zoneId, gain] of visited) {
    broadcastFn(zoneId, { type: 'audio_sfx', def: sfxDef, gain: Math.min(1, gain) });
  }
}

// ── Weather leak-in ─────────────────────────────────────────────────────────
// How much outdoor weather ambience (rain/wind loop gain) is audible at an
// indoor zone. Floods outward from the zone toward the nearest outdoor
// (map_world) tile, decaying gain per room crossed for plain walls, and much
// harder across a closed, intact door — so closing a door significantly cuts
// the weather noise, and a couple of rooms behind a shut door is barely audible.
const WEATHER_ROOM_DECAY = 0.55;       // per room hop, walls alone
const WEATHER_DOOR_DECAY = 0.0167;     // extra multiplier crossing a closed, intact door (tripled deadening: lets through a third as much as the old 0.05)
const WEATHER_LEAK_MAX_HOPS = 6;
const WEATHER_LEAK_STOP_THRESHOLD = 0.02;

function isOutdoorZone(zoneId) {
  return world.zones.get(zoneId)?.map_id === 'map_world';
}

// Finds the outdoor (map_world) tile whose weather actually leaks into this
// indoor zone the loudest, plus the gain of that leak. This is the tile whose
// local precip/wind should be sampled for indoor ambience — not the global
// weather state — so a building next to a dry tile doesn't hear rain just
// because it's raining somewhere else on the map.
export function getWeatherLeakSource(zoneId) {
  if (isOutdoorZone(zoneId)) return { outdoorZoneId: zoneId, gain: 1 };
  const visited = new Map([[zoneId, 1]]);
  const queue = [[zoneId, 1, 0]];
  let best = 0;
  let bestZoneId = null;
  while (queue.length) {
    const [id, gain, hops] = queue.shift();
    if ((visited.get(id) ?? 0) > gain) continue; // stale entry superseded by a stronger path
    if (hops >= WEATHER_LEAK_MAX_HOPS) continue;
    const zone = world.zones.get(id);
    if (!zone) continue;
    for (const { dir, target } of allExits(zone)) {
      const closed = edgeMuffle(id, dir, target) > 0;
      const nextGain = gain * (closed ? WEATHER_DOOR_DECAY : WEATHER_ROOM_DECAY);
      if (nextGain < WEATHER_LEAK_STOP_THRESHOLD) continue;
      if (isOutdoorZone(target)) {
        if (nextGain > best) { best = nextGain; bestZoneId = target; }
        continue;
      }
      if (nextGain > (visited.get(target) || 0)) {
        visited.set(target, nextGain);
        queue.push([target, nextGain, hops + 1]);
      }
    }
  }
  return { outdoorZoneId: bestZoneId, gain: best };
}

export function getWeatherLeakGain(zoneId) {
  return getWeatherLeakSource(zoneId).gain;
}

// Yell variant: all-caps, word-drop muffling at distance.
// senderId is excluded from the origin-zone broadcast (they get their own "You yell:" echo).
export function propagateYell(originZoneId, senderId, senderHandle, text, broadcastFn) {
  const YELL_LOUDNESS = 1.5; // heard 1 zone away
  const upped = text.toUpperCase();
  const reach = getSoundReach(originZoneId, YELL_LOUDNESS);

  for (const [zoneId, distance] of reach) {
    if (zoneId === originZoneId) {
      // Others in origin zone hear the full yell; sender gets their own echo via command return.
      broadcastFn(zoneId, {
        type: 'output',
        message: `<span class="speech-line yell">${senderHandle} yells, "${upped}"</span>`,
      }, senderId); // excludePlayerId — sender gets their own echo via command return
    } else {
      // Adjacent zones: muffled, some words dropped
      const muffled = dropWords(upped, YELL_LOUDNESS, distance);
      if (!muffled) continue;
      broadcastFn(zoneId, {
        type: 'output',
        message: `<span class="speech-line distant">Somewhere nearby, someone yells, "${muffled}"</span>`,
      });
    }
  }
}
