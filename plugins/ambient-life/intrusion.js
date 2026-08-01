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
import { world, getZone, getApartment } from '../../server/engine/world.js';
import { isDwellingZone } from '../../server/engine/zone-tags.js';
import { getBroadcast, sendToZone } from '../../server/engine/messaging.js';
import { playerControlsApt } from '../../server/engine/apartments.js';
import { isNpcAsleep, disturbSleeper } from '../../server/engine/ai-behaviour.js';

const COOLDOWN_MS = 3 * 60_000;   // per zone — pacing back and forth isn't three scenes
const lastReaction = new Map();   // zoneId → ts

const rand = arr => arr[Math.floor(Math.random() * arr.length)];

// They know exactly who you are, and that settles it. The beat is the moment of
// alarm and the moment it's dismissed, in the same line — nobody asks the
// administrator of reality to explain themselves.
const ADMIN_LINES = [
  `{npc} startles badly, gets a proper look at you, and visibly decides not to make anything of it.`,
  `{npc} comes up off the chair fast — then stops, straightens, and says, "Oh. It's you. Carry on."`,
  `{npc} freezes with one hand half-raised, recognises you, and lets the hand drop. "Right. Right, of course."`,
  `{npc} looks at you the way you'd look at weather: startled, then simply accepting of it.`,
  `{npc} opens their mouth to shout, thinks better of it, and settles for watching you very carefully.`,
];

// Everybody else. Indignant, territorial, and entirely powerless about it.
const INTRUDER_LINES = [
  `{npc} whirls round. "Who — how did you get in here?"`,
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
    out.push(npc);
  }
  return out;
}

on('zone.entered', ({ actor, zone }) => {
  try {
    if (!actor?.id || !zone) return;
    if (!isDwellingZone(getZone(zone))) return;

    const now = Date.now();
    if ((lastReaction.get(zone) ?? 0) > now - COOLDOWN_MS) return;

    // Their own place — or the place they pay for. No reaction owed.
    const apt = getApartment(zone);
    if (apt && playerControlsApt(actor, apt)) return;

    const folk = residentsOf(zone);
    if (!folk.length) return;

    // A sleeper reacts before anyone awake does: being woken is the louder beat.
    const npc = folk.find(isNpcAsleep) || rand(folk);
    lastReaction.set(zone, now);

    if (isNpcAsleep(npc)) {
      // Drink and downers still win. Everything else gets up.
      const dose = npc._ai?.dose;
      const deadToWorld = !!(dose?.out || dose?.loose);
      const res = disturbSleeper(npc, { broadcast: getBroadcast(), force: !deadToWorld });
      if (res && !res.woke) return;    // slept through it; the surprise never happens
    }

    const admin = ['admin', 'dev'].includes(actor.role);
    const line = rand(admin ? ADMIN_LINES : INTRUDER_LINES).replace(/\{npc\}/g, npc.name);
    sendToZone(zone, { type: 'zone_event', message: line });
  } catch (e) {
    console.error('[ambient-life] intrusion:', e.message);
  }
});

// Test seam.
export const _intrusion = { residentsOf, ADMIN_LINES, INTRUDER_LINES, COOLDOWN_MS, lastReaction };
