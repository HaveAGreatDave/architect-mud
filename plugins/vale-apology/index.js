// vale-apology — a one-time thank-you beat between Sergeant Vale and the player
// Akerson.
//
// Backstory: Vale (npc_pd_officer) was auto-homed into Akerson's owned Embassy unit
// (Unit 1A / zone_apt_1) while she got back on her feet. Her *real* home is now
// Unit 2B (zone_apt_6) — set on her `home_zone` — but she's still physically
// standing in his apartment. This plugin is the on-screen resolution: the first
// time Akerson walks into the room she's in, she squares up with him and moves out.
//
// The scene, once:
//   • she catches him, apologises for crashing at his place,
//   • thanks him, presses ₵200 into his hand (a real credit transfer),
//   • gathers her things and heads upstairs to her own unit (a real NPC move,
//     persisted so she never drifts back into his apartment).
//
// Fires exactly once, forever — a persistent `world` flag survives restarts, and a
// synchronous in-memory latch blocks any double-fire within a process. If Akerson
// walks out mid-scene the substantive outcomes (the ₵200 and the move-out) still
// happen; only the spoken lines are gated on him still being in the room.
//
// Trigger is co-presence, not a hardcoded room: it fires wherever Vale and Akerson
// first share a zone. In practice that's Unit 1A, since Vale doesn't wander — the
// moment he comes home to his own unit and finds her there.

import { on } from '../../server/engine/events.js';
import { world, moveNpcToZone, getLivePlayer, getZonePlayers } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { formatChitchat } from '../../server/engine/ai-behaviour.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { query } from '../../server/models/db.js';

const VALE_ID  = 'npc_pd_officer';   // Sergeant Vale
const APT_ZONE = 'zone_apt_1';       // Akerson's owned unit (Unit 1A) she squatted in
const HOME     = 'zone_apt_6';       // her real home (Unit 2B), already her home_zone
const GIFT     = 200;                // credits she presses into his hand
const FLAG     = 'vale_apology_akerson'; // world scope — never replay

// Beat timing (ms). Kept short so he's likely still in the room for all of it.
const BEAT = [0, 2600, 5200, 7800];

// In-memory latch, seeded from the persistent flag on load. Set synchronously the
// instant the trigger matches so two rapid zone.entered events can't both fire.
let done = false;
getFlag('world', FLAG).then(v => { if (v) done = true; }).catch(() => {});

// Is this the player Akerson? Prefer the deed: whoever owns the unit she squatted
// in. Fall back to the handle/username so it still resolves if the ownership row
// isn't loaded (e.g. a fresh dev DB with no player accounts).
function isAkerson(actor) {
  if (!actor) return false;
  const ownerId = world.apartments?.get(APT_ZONE)?.owner_id;
  if (ownerId && actor.id === ownerId) return true;
  const h = (actor.handle || '').toLowerCase();
  const u = (actor.username || '').toLowerCase();
  return h === 'akerson' || u === 'akerson';
}

const say = (line) => formatChitchat('Sergeant Vale', line);
// He's still in the room to hear the spoken lines?
const present = (playerId, zoneId) =>
  !!getLivePlayer(playerId) && getZonePlayers(zoneId).some(p => p.id === playerId);

async function runScene(actor, vale, zoneId) {
  // Claim it persistently up front — this scene resolves exactly once.
  await setFlag('world', FLAG, 'true').catch(() => {});

  const name = actor.handle || 'friend';

  const beat1 = () => {
    if (present(actor.id, zoneId)) sendToZone(zoneId, say(`"${name}. Good — I've been meaning to catch you."`));
  };
  const beat2 = () => {
    if (present(actor.id, zoneId))
      sendToZone(zoneId, say(`"I owe you a straight word. Crashing in your place while I got back on my feet — that was no small thing. You could've put me out on the street and you didn't."`));
  };
  const beat3 = async () => {
    if (present(actor.id, zoneId)) sendToZone(zoneId, say(`"So. Thank you. And let me square it — I don't like owing anyone."`));
    // The substantive part happens whether or not he stayed to watch.
    const paid = await adjustCredits(actor, GIFT, undefined, 'npc:gift').catch(() => false);
    if (paid) {
      sendToZone(zoneId, say(`presses ₵${GIFT} into ${name}'s hand with a rare, tired smile.`), actor.id);
      sendToPlayer(actor.id, { type: 'output', message: `<span style="color:var(--yellow)">Sergeant Vale presses ₵${GIFT} into your hand. "We're square."</span>` });
    }
  };
  const beat4 = async () => {
    if (present(actor.id, zoneId))
      sendToZone(zoneId, say(`"Got my own place now — Unit 2B, upstairs. Finally. I'll get out of your hair."`));
    // Move her out for real, and persist it so a restart doesn't put her back in
    // his apartment. Her home_zone is already Unit 2B.
    if (moveNpcToZone(VALE_ID, HOME)) {
      sendToZone(zoneId, { type: 'zone_event', message: `Sergeant Vale gathers her few belongings and heads upstairs to her own place at last.` });
      sendToZone(HOME, { type: 'zone_event', message: `Sergeant Vale lets herself into Unit 2B and sets her things down, home at last.` });
    }
    await query('UPDATE npcs SET zone_id=$1, home_zone=$1 WHERE id=$2', [HOME, VALE_ID]).catch(() => {});
  };

  setTimeout(beat1, BEAT[0]);
  setTimeout(beat2, BEAT[1]);
  setTimeout(() => { beat3(); }, BEAT[2]);
  setTimeout(() => { beat4(); }, BEAT[3]);
}

on('zone.entered', ({ actor, zone }) => {
  if (done) return;
  if (!isAkerson(actor)) return;
  const vale = world.npcs.get(VALE_ID);
  if (!vale || vale._dead) return;
  if (vale.zone_id !== zone) return;   // must actually share the room
  done = true;                         // latch synchronously before any await
  runScene(actor, vale, zone);
});

export const commands = {};

// Exposed for the regress suite.
export const _test = { isAkerson, VALE_ID, APT_ZONE, HOME, GIFT, FLAG };
