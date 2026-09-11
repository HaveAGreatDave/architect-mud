// The lights just went out, and somebody was standing in the room.
//
// The power sim has always been thorough about the FIXTURES — it cuts them,
// preserves what they were doing, restores them, and narrates all three. What it
// never had was a person in the room with an opinion about it. A blackout landed
// in a kitchen with two residents in it and both of them carried on in silence,
// which reads as a room full of mannequins rather than a room full of people.
//
// This is the reaction. It is words only: the engine owns the lights, the fridge,
// the till and the dark, and this layer owns what somebody SAYS about them. The
// same rule intrusion.js is written to — a scenery file that starts moving bodies
// or spoiling stock is a mechanic hiding inside the furniture.
//
// Four rules, each of which is a thing the first draft got wrong:
//
//   • WHERE THEY ARE DECIDES WHAT THEY SAY. A blackout at home is an
//     inconvenience with a sigh in it; a blackout at work is money, stock and a
//     dead till; a blackout in a corridor you happen to be walking down is barely
//     anything. One pool each, chosen off `home_zone` / `work_zone_id`, which 266
//     and 224 of the cast respectively already carry. Without the split every
//     shopkeeper in Coldwater complained about their heating.
//
//   • NOBODY WAKES UP FOR IT. A sleeper's lights were already off. The intrusion
//     beat forces a wake because a stranger in your bedroom is the loudest thing
//     that can happen to you; a power cut is not, and an apartment block sitting
//     up in bed at 3am because a generator tripped would be worse than silence.
//
//   • ONE VOICE PER ROOM, ON A COOLDOWN. The brownout rotation re-derives the
//     grid every five minutes and a zone that flaps at its ceiling transitions
//     every other cycle. Without the cooldown that is a tenant complaining about
//     the same flicker all night.
//
//   • OUTDOORS IN DAYLIGHT, NOTHING HAPPENED. Losing a street's supply at noon
//     changes nothing anybody standing in it can perceive, so there is nothing to
//     react to. Indoors it always counts, because the things that die indoors are
//     appliances rather than daylight.
import { on } from '../../server/engine/events.js';
import { world, getZone } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { isIndoorZone, getEnvironmentState, getZonePowerStatus } from '../../server/engine/environment.js';
import { isNpcAsleep } from '../../server/engine/ai-behaviour.js';

/**
 * Is this zone currently without supply?
 *
 * ⚠ UNKNOWN MEANS POWERED, and getting that backwards is a silent world-wide
 * outage. `getZonePowerStatus` answers 'unpowered' for any zone with no
 * `power_zones` row at all, which is most of the map — treating that as "dark"
 * would switch off every caller everywhere the grid was simply never wired.
 * The ATM plugin's own reader makes the same call for the same reason.
 *
 * Exported because home-life asks it: a domestic routine narrating a fry-up in a
 * room with no power is the one thing that would make this feature read as a bug.
 */
export function zoneIsDark(zoneId) {
  const status = getZonePowerStatus(zoneId);
  return status === 'offline';
}

// Same threshold the sim uses to decide streetlights are needed (VISIBILITY_DIM).
// Below this, an outdoor zone losing its supply is something you can see happen.
const DARK_ENOUGH = 0.35;

const COOLDOWN_MS = 5 * 60_000;   // per zone — a flapping grid is not five scenes
const BEAT_MS = [1200, 3500];     // after the engine's own "the lights cut out"

const lastReaction = new Map();   // zoneId -> ts

const rand = arr => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// ── What they say ────────────────────────────────────────────────────────────
//
// Keyed [where][what]. `where` is home | work | passing; `what` is out (gone) |
// brown (browning out) | back (restored). {npc} is filled per run.
//
// ⚠ No em dashes inside quoted speech — that is the Ascendant voice tell and a
// grocer is not an Ascendant (docs/story.md, Tone → "The em dash rule").

const LINES = {
  home: {
    out: [
      `{npc} stops mid-sentence. "Oh, you have got to be joking."`,
      `{npc} goes very still in the dark, then lets out the sigh of somebody who has done this before.`,
      `A chair scrapes. "Nobody move," says {npc}. "The candles are in the drawer with the dead batteries, which is the whole problem."`,
      `Somewhere in the dark {npc} walks into something and declines to comment on it.`,
      `{npc} swears quietly at the fridge, which has stopped humming for the first time in a week.`,
      `"That's the third time this month," {npc} says, to the ceiling. The ceiling says nothing.`,
    ],
    brown: [
      `{npc} watches the ceiling light stutter and doesn't bother getting up. It does this.`,
      `{npc} looks up at the flicker. "Don't. Don't you dare."`,
      `{npc} unplugs something at the wall without being asked and without explaining why.`,
    ],
    back: [
      `The room comes back. {npc} looks at the blinking clock on the oven and visibly decides to deal with it later.`,
      `{npc} blinks at the light, then starts the kettle again from the beginning.`,
      `"Thank you," says {npc}, to nobody, and means it about the heating.`,
    ],
  },
  work: {
    out: [
      `{npc} puts both hands flat on the counter. "Right. Cash only, and nobody opens that freezer."`,
      `{npc} is moving before the dark has finished arriving. Somewhere behind the counter a torch clicks on.`,
      `{npc} looks at the dead till, then at you. "Give me a minute. It takes four to come back up. If it comes back up."`,
      `{npc} swears with real professional feeling. Whatever was on that screen is gone.`,
      `"Not now," {npc} tells the building. "Not in the middle of a shift."`,
      `{npc} goes straight to the stock without a word, counting what's going to be worth nothing by morning.`,
    ],
    brown: [
      `{npc} glances up at the stuttering strip light and moves a tray away from the freezer door.`,
      `{npc} watches the lights dip and starts counting under their breath.`,
      `"Come on," {npc} says to the till, quietly, the way you'd talk to a horse.`,
    ],
    back: [
      `{npc} waits for the till to finish booting, drumming one finger on the counter.`,
      `The lights come up. {npc} is already halfway through checking what spoiled.`,
      `{npc} lets out a breath. "Right. Where were we."`,
    ],
  },
  passing: {
    out: [
      `{npc} stops where they are and waits, the way you do.`,
      `{npc}'s hand goes to a pocket, finds nothing useful in it, and comes back out.`,
      `"Great," says {npc}, in the dark, to nobody at all.`,
      `{npc} doesn't react so much as pause, which is its own kind of reaction.`,
    ],
    brown: [
      `{npc} glances up at the flickering light and keeps walking.`,
      `{npc} notices the dip, decides it isn't their problem, and is right about that.`,
    ],
    back: [
      `{npc} squints at the light coming back and carries on as though nothing happened.`,
      `{npc} looks up, satisfied, as if they'd personally arranged it.`,
    ],
  },
};

// ── Who is in a position to have an opinion ──────────────────────────────────
//
// ⚠ NOT eligibleNpcs(). That predicate excludes an NPC on their vendor shift
// (`_ai.vendor_was_working`) because banter is something you do when you are NOT
// working — and the shopkeeper behind the counter is precisely the person this
// feature exists for. The rest of its gates are shared, for the same reasons.
function reactorsIn(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  const out = [];
  for (const id of zone.npcs) {
    const npc = world.npcs.get(id);
    if (!npc || npc._dead) continue;
    if (npc.zone_id !== zoneId) continue;       // the set is a net, npc.zone_id is the truth
    if (npc._combatTargetId) continue;          // already having a worse evening
    if (npc._ai?.shopPaused) continue;          // a player has them mid-transaction
    if (npc.flags?.no_banter) continue;         // the standard ambient opt-out
    if (isNpcAsleep(npc) || npc._ai?.dosedOut) continue;   // the lights were off for them already
    out.push(npc);
  }
  return out;
}

// Home, work, or just here. Home wins a tie: somebody who lives above their own
// shop is at home in the flat and at work on the floor, and those are two zones.
function placeFor(npc, zoneId) {
  if (npc.home_zone === zoneId) return 'home';
  if (npc.work_zone_id === zoneId) return 'work';
  return 'passing';
}

// Which of the three pools this transition asks for, or null if it asks for none.
// Only the transitions a person in the room could actually perceive:
//   → offline     the supply is gone
//   → overloaded  it is browning out, and the lights are saying so
//   → powered     it is back
// Anything else (offline → offline after a topology reload, overloaded shuffling
// its allocation) changed nothing anybody could point at.
function kindOf(prevStatus, status) {
  if (status === 'offline') return 'out';
  if (status === 'overloaded') return 'brown';
  if (status === 'powered' && prevStatus !== 'powered') return 'back';
  return null;
}

// Is losing the supply here something a person could notice? Indoors, always:
// the fridge, the till and the terminal all just died whatever the sun is doing.
// Outdoors it is a question about the sky.
function perceptible(zone) {
  if (isIndoorZone(zone)) return true;
  return (getEnvironmentState().ambientLight ?? 1) < DARK_ENOUGH;
}

on('zone.power.changed', ({ zoneId, prevStatus, status }) => {
  try {
    const kind = kindOf(prevStatus, status);
    if (!kind) return;

    // Nobody here, nothing happened. Checked first because on an EMP this fires
    // for every zone in the world and this is the line that makes that free.
    const zone = world.zones.get(zoneId);
    if (!zone || zone.players.size === 0) return;

    const now = Date.now();
    if ((lastReaction.get(zoneId) ?? 0) > now - COOLDOWN_MS) return;

    if (!perceptible(getZone(zoneId) || zone)) return;

    const folk = reactorsIn(zoneId);
    if (!folk.length) return;
    const npc = rand(folk);

    lastReaction.set(zoneId, now);

    // A beat behind the engine's own light line, never on top of it: the room
    // gets told it went dark, and THEN somebody in it says something about that.
    // Re-validated on the way out, because a second and a half is long enough for
    // the NPC to leave, the player to leave, or the grid to change its mind.
    setTimeout(() => {
      try {
        const live = world.npcs.get(npc.id);
        const z = world.zones.get(zoneId);
        if (!live || live._dead || live.zone_id !== zoneId) return;
        if (live._combatTargetId || isNpcAsleep(live)) return;
        if (!z || z.players.size === 0) return;
        const pool = LINES[placeFor(live, zoneId)][kind];
        sendToZone(zoneId, { type: 'zone_event', message: rand(pool).replace(/\{npc\}/g, live.name) });
      } catch (e) {
        console.error('[ambient-life] blackout beat:', e.message);
      }
    }, randInt(BEAT_MS[0], BEAT_MS[1]));
  } catch (e) {
    console.error('[ambient-life] blackout:', e.message);
  }
});

// Test seam.
export const _blackout = { LINES, reactorsIn, placeFor, kindOf, perceptible, COOLDOWN_MS, lastReaction, DARK_ENOUGH };
