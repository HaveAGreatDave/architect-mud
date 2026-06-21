import { world } from './world.js';

// Minimum intensity for a sound to be heard at a given distance.
const HEAR_THRESHOLD = 0.5;

// Inverse-square intensity: loudness / (d² + 1). At d=0: loudness. Falls off quickly.
function intensity(loudness, distance) {
  return loudness / (distance * distance + 1);
}

// BFS over zone exits out to the furthest tile where intensity > threshold.
// Returns Map<zoneId, distance>.
export function getSoundReach(originZoneId, loudness) {
  const reach = new Map([[originZoneId, 0]]);
  const queue = [[originZoneId, 0]];
  while (queue.length) {
    const [zoneId, dist] = queue.shift();
    if (intensity(loudness, dist + 1) < HEAR_THRESHOLD) continue;
    const zone = world.zones.get(zoneId);
    if (!zone) continue;
    for (const neighborId of Object.values(zone.exits || {})) {
      if (!reach.has(neighborId)) {
        reach.set(neighborId, dist + 1);
        queue.push([neighborId, dist + 1]);
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
export function propagateSound(originZoneId, message, loudness, broadcastFn) {
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
    });
  }
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
        message: `<span style="color:var(--yellow);font-weight:bold">${senderHandle} yells: "${upped}"</span>`,
      }, senderId); // excludePlayerId — sender gets their own echo via command return
    } else {
      // Adjacent zones: muffled, some words dropped
      const muffled = dropWords(upped, YELL_LOUDNESS, distance);
      if (!muffled) continue;
      broadcastFn(zoneId, {
        type: 'output',
        message: `<span style="color:var(--yellow);opacity:0.7">Somewhere nearby, someone yells: "${muffled}"</span>`,
      });
    }
  }
}
