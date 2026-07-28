/**
 * Dreamscape — the dream you can walk around in.
 *
 * Most dreams are a line of text. Occasionally, on a deep enough sleep, you go
 * somewhere instead: a small generated room you can look at, move through and
 * poke, which dissolves the moment you wake.
 *
 * Built on `registerTransientZone` — the same non-DB room mechanism the void
 * crossings use — so a dreamscape costs no schema, no content and no cleanup
 * beyond forgetting it. The rooms are generated per sleep and removed on waking,
 * which is also the only exit: there is no door out of a dream.
 *
 * WHY IT'S RARE
 *
 * Because it interrupts. Being pulled somewhere is a strong beat and it stops
 * being one if it happens every night — this fires on a minority of sleeps, and
 * a frayed mind gets it more often, which makes the deep end of the sanity track
 * genuinely different rather than just worse.
 *
 * THE RULES ARE WRONG ON PURPOSE
 *
 * A dream room has exits that don't reciprocate, objects that read differently
 * each time you look, and geography that doesn't close. That's the point: the
 * player should work out within a room or two that this place does not obey the
 * things the rest of the game has taught them.
 */
import { registerTransientZone, removeTransientZone, world, addPlayerToZone, removePlayerFromZone } from './world.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const maybe = (p) => Math.random() < p;

export const DREAM_ZONE_PREFIX = 'zone_dream_';

const ROOMS = [
  {
    name: 'A Corridor',
    desc: 'A corridor with a carpet you are certain you have knelt on. It runs further in both directions than the building it is in could possibly allow. The lights are on but you cannot find them.',
  },
  {
    name: 'The Kitchen',
    desc: 'Somebody else’s kitchen, mid-meal. Four places laid, four chairs pushed back, the food still steaming. The window shows a street you do not recognise at an hour that has no light in it.',
  },
  {
    name: 'A Waiting Room',
    desc: 'Rows of chairs facing a door with no handle. A clock on the wall keeps perfect time and is definitely wrong. Somebody has been here recently; the seat nearest you is warm.',
  },
  {
    name: 'The Stairwell',
    desc: 'Concrete stairs going down. You have been descending for a while. The numbers painted on the landings have stopped being numbers.',
  },
  {
    name: 'The Flooded Floor',
    desc: 'Standing water to the ankle, black and completely still, over a floor you half know. Your reflection is doing what you are doing, at its own pace.',
  },
  {
    name: 'A Room With No Floor',
    desc: 'The walls are ordinary — papered, scuffed, a light switch at the right height. There is no floor. This does not seem to be a problem for either of you.',
  },
  {
    name: 'The Market',
    desc: 'Stalls under strung bulbs, every one of them stacked with the same object. The traders are all mid-sentence with customers who are not there.',
  },
];

// Things you can look at. They deliberately give a slightly different answer
// each time, because a dream object that reads identically twice is furniture.
const OBJECTS = [
  { name: 'a door', looks: [
    'It is ajar. You are certain it was shut.',
    'Shut, and warm to the touch, as though something were leaning on the other side.',
    'It has no handle on this side. It never did.',
  ] },
  { name: 'a mirror', looks: [
    'You are in it, half a second late.',
    'You are in it, and you are not looking back.',
    'It shows the room, correctly, and without you in it.',
  ] },
  { name: 'a telephone', looks: [
    'It has been ringing this whole time. You only notice now.',
    'The receiver is off the hook. Someone is breathing on the other end, patiently.',
    'It is not plugged into anything. It rings anyway.',
  ] },
  { name: 'a photograph', looks: [
    'People you know, arranged wrong, all looking slightly left of the camera.',
    'A room you have stood in. There is somebody in the doorway who was not there.',
    'It is a photograph of this room, taken a moment ago, from behind you.',
  ] },
  { name: 'a chair', looks: [
    'Pushed back, as though someone stood up in a hurry.',
    'Occupied. You cannot afterwards say by what.',
    'Perfectly ordinary, which in here is the strangest thing in the room.',
  ] },
  { name: 'your own hands', looks: [
    'Six fingers. You count them twice and are not alarmed either time.',
    'Clean. Very clean. Cleaner than you left them.',
    'They are doing something careful and you are not the one doing it.',
  ] },
];

const DIRS = ['north', 'south', 'east', 'west', 'up', 'down', 'in', 'out'];

/**
 * Build a small dreamscape and return its entry zone id.
 *
 * `size` rooms, wired with exits that deliberately do NOT reciprocate — you can
 * walk deeper and rarely walk back the way you came, which is what a dream
 * actually does and what tells the player where they are.
 */
export function buildDreamscape(playerId, { size = 3, tether = {} } = {}) {
  const stamp = `${DREAM_ZONE_PREFIX}${playerId}_${Date.now().toString(36)}`;
  const ids = Array.from({ length: size }, (_, i) => `${stamp}_${i}`);

  ids.forEach((id, i) => {
    const room = pick(ROOMS);
    // Exits lead onward, and sometimes to a room you have already been in — a
    // dream loops rather than branching.
    const exits = {};
    const outCount = 1 + (maybe(0.5) ? 1 : 0);
    const dirs = [...DIRS].sort(() => Math.random() - 0.5).slice(0, outCount);
    for (const d of dirs) exits[d] = pick(ids.filter(x => x !== id)) || id;

    // The tether puts something of the sleeper's real life in the description —
    // the same trick the text dreams use, for the same reason.
    const anchored = tether.zone && maybe(0.4)
      ? ` Through a gap you can see ${tether.zone}, rebuilt slightly wrong.`
      : '';

    registerTransientZone({
      id,
      name: room.name,
      description: room.desc + anchored,
      exits,
      // No light system in a dream: it is exactly as bright as it needs to be.
      flags: { is_interior: true, always_lit: true, dream: true, no_combat: true },
      ambient_events: [
        'Somewhere behind you, a door closes politely.',
        'The light changes without anything having moved.',
        'You hear your own voice, from another room, answering somebody.',
        'For a moment everything is very slightly too far away.',
      ],
      // Two or three things to poke at, stored on the zone for `examine`.
      dreamObjects: Array.from({ length: 2 + (maybe(0.5) ? 1 : 0) }, () => {
        const o = pick(OBJECTS);
        return { name: o.name, look: pick(o.looks) };
      }),
    });
  });

  return ids[0];
}

/** Is this a dream room? */
export const isDreamZone = (zoneId) => typeof zoneId === 'string' && zoneId.startsWith(DREAM_ZONE_PREFIX);

/** Everything a player can poke at in the dream room they're standing in. */
export function dreamObjectsAt(zoneId) {
  return world.zones.get(zoneId)?.dreamObjects || [];
}

/**
 * Tear down every room of a player's dreamscape. Called on waking — the dream
 * does not persist, and leaving the rooms registered would leak a handful of
 * zones per sleep for the life of the process.
 */
/**
 * Yank a player out of a dream, wherever it happened from.
 *
 * There are FIVE places sleep can end — waking naturally, a command, the game
 * loop, and two ways of being attacked in your bed — and every one of them has
 * to put the body back and tear the rooms down. A path that forgets leaves the
 * player stranded in a room whose exits go nowhere real, and leaks a handful of
 * zones per sleep for the life of the process.
 *
 * So it lives here, it's idempotent, and it's safe to call on someone who was
 * never dreaming. Call it on EVERY wake path, including violent ones.
 */
export function wakeFromDream(player) {
  if (!player?.sleeping?.inDream) return false;
  const home = player.sleeping.bodyZone;
  if (home && isDreamZone(player.current_zone)) {
    removePlayerFromZone(player.id, player.current_zone);
    player.current_zone = home;
    // The body never left, so this is normally a no-op on a Set that already has
    // them. Kept because it costs nothing and makes this correct even if some
    // other path (death respawn sweeps every zone) evicted them mid-dream.
    addPlayerToZone(player.id, home);
  }
  player.sleeping.inDream = false;
  dissolveDreamscape(player.id);
  return true;
}

export function dissolveDreamscape(playerId) {
  let removed = 0;
  for (const id of [...world.zones.keys()]) {
    if (id.startsWith(`${DREAM_ZONE_PREFIX}${playerId}_`)) { removeTransientZone(id); removed++; }
  }
  return removed;
}
