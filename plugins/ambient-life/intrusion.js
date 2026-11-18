// Somebody just walked into a home that isn't theirs.
//
// The burglary plugin already covers the loud version — a forced or bashed door
// wakes the household and starts a panic. This is the QUIET version, which had
// no reaction at all: an unlocked flat, or a lock the intruder legitimately
// opened, and the resident stood there saying nothing while a stranger walked
// around their bedroom.
//
// Two rules shape it:
//   • A resident asleep in their own home WAKES when someone walks in. Sleeping
//     through a stranger entering the room is the single worst read in the
//     system, so this forces the wake rather than rolling for it — the one
//     exception being someone genuinely dead to the world on drink or downers,
//     because that's a state the drug system is entitled to keep.
//   • Surprise is not the same as eviction. An admin walking in gets startled
//     recognition and nothing else — they are not challenged, not questioned and
//     not thrown out, because they are the one person in the world with a right
//     to be anywhere. Everybody else gets told to leave, in words only: this
//     layer never moves a player, because nothing else in the game ejects one
//     and inventing that here would be a mechanic hiding inside scenery.
import { on } from '../../server/engine/events.js';
import { world, getZone, getApartment, getLivePlayer } from '../../server/engine/world.js';
import { isDwellingZone } from '../../server/engine/zone-tags.js';
import { getBroadcast, sendToZone } from '../../server/engine/messaging.js';
import { playerControlsApt } from '../../server/engine/apartments.js';
import { isNpcAsleep, disturbSleeper } from '../../server/engine/ai-behaviour.js';
import { belongsHere } from './eviction.js';
import { startPanic, knowsAdmin, isPanicking } from './panic.js';

const COOLDOWN_MS = 3 * 60_000;   // per zone and player — pacing back and forth isn't three scenes
const lastReaction = new Map();   // `${zoneId}:${playerId}` → ts
// Told to get out and still standing there after this long: they panic and call the police (panic.js).
const GRACE_MS = 15_000;

const rand = arr => arr[Math.floor(Math.random() * arr.length)];
const isAdmin = (p) => ['admin', 'dev'].includes(p?.role);

// An admin's two beats, the fright and then "Oh. It's just you.", are panic.js's (ADMIN_START, ADMIN_KNOWN).

// Everybody else. Indignant, territorial, and entirely powerless about it.
const INTRUDER_LINES = [
  `{npc} whirls round. "Who... how did you get in here?"`,
  `{npc} backs up a step, eyes on the door behind you. "That's my door. That was locked."`,
  `{npc} stares at you. "This is my HOME. Out. Now."`,
  `{npc} goes very still. "I don't know you, and you're standing in my kitchen. Turn around."`,
  `{npc} points at the way you came in, hand not quite steady. "You've got about five seconds."`,
];

function residentsOf(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  const out = [];
  for (const id of zone.npcs) {
    const npc = world.npcs.get(id);
    if (!npc || npc._dead) continue;
    if (npc.home_zone !== zoneId) continue;      // a guest is not a householder
    if (npc._combatTargetId) continue;           // already having a worse evening
    if (npc.flags?.no_home_life) continue;       // same opt-out the domestic routines use
    if (npc.flags?.animal) continue;             // a cat doesn't tell you to get out of its kitchen
    if (npc._ai?.alarm || isPanicking(npc.id)) continue;   // the burglary plugin, or panic.js, has them already
    out.push(npc);
  }
  return out;
}

on('zone.entered', ({ actor, zone }) => {
  try {
    if (!actor?.id || !zone) return;
    if (!isDwellingZone(getZone(zone))) return;

    const now = Date.now(), key = `${zone}:${actor.id}`;
    if ((lastReaction.get(key) ?? 0) > now - COOLDOWN_MS) return;

    // Their own place — or the place they pay for. No reaction owed.
    const apt = getApartment(zone);
    if (apt && playerControlsApt(actor, apt)) return;

    // Somebody who belongs (a resident of the building, a friend of the household) gets no challenge at all,
    // and an admin this household has already recognised gets nothing either: nothing happened.
    const folk = residentsOf(zone).filter((n) => !knowsAdmin(n, actor) && (isAdmin(actor) || !belongsHere(actor, n, zone)));
    if (!folk.length) return;

    // A sleeper reacts before anyone awake does: being woken is the louder beat.
    const npc = folk.find(isNpcAsleep) || rand(folk);
    lastReaction.set(key, now);

    if (isNpcAsleep(npc)) {
      // Drink and downers still win. Everything else gets up.
      const dose = npc._ai?.dose;
      const deadToWorld = !!(dose?.out || dose?.loose);
      const res = disturbSleeper(npc, { broadcast: getBroadcast(), force: !deadToWorld });
      if (res && !res.woke) return;    // slept through it; the surprise never happens
    }

    // An admin gets the fright and then the look ("Oh. It's just you."), from panic.js, and nothing after.
    if (isAdmin(actor)) { startPanic(npc, actor, zone); return; }
    sendToZone(zone, { type: 'zone_event', message: rand(INTRUDER_LINES).replace(/\{npc\}/g, npc.name) });

    // …and then they mean it. Still here when the grace lapses and they're on the phone to the police
    // (panic.js: a star, a patrol on its way, and half a star more for every thirty seconds you stay).
    // Leave and that's the end of it. This used to walk you out to the hall (eviction.js scheduleEscort),
    // which left nothing to stay for; a shop's closing-time escort is still that.
    const t = setTimeout(() => {
      const live = getLivePlayer(actor.id), n = world.npcs.get(npc.id);
      if (!live || live.current_zone !== zone || !n || n._dead || n.zone_id !== zone || isNpcAsleep(n) || n._combatTargetId) return;
      startPanic(n, live, zone, { kind: 'home', opened: true });
    }, GRACE_MS);
    t.unref?.();
  } catch (e) {
    console.error('[ambient-life] intrusion:', e.message);
  }
});

// Test seam.
export const _intrusion = { residentsOf, INTRUDER_LINES, COOLDOWN_MS, GRACE_MS, lastReaction };
