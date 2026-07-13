// plugins/strippers/index.js
//
// Strip club — tip-driven dancers whose show escalates with the money on the
// rail, plus the VIP door that a big spender earns for a day.
//
// Model (per the design decisions on file):
//   • "Shared stage heat" — every tip from anyone in the room feeds one decaying
//     heat pool per dancer. Heat drives how many clothing layers are currently
//     peeled (engine's npc._clothingPeeled, read by the examine "wearing" line)
//     and how graphic her dance lines get. At 500 heat she's down to nothing.
//     Heat cools over time, so the show winds back down when the tips stop.
//   • VIP is per-player — once a single player has tipped 1000 total, they get a
//     24h pass (a player Flag) that the viplock door reads. MIS (sex) is allowed
//     in the VIP room and refused in the main room; that gate lives in the mis
//     plugin, driven by the dancer's flags.mis_requires_zone_flag + the room flag.
//
// A dancer is any NPC with flags.stripper=true and an ordered flags.clothing_layers
// (outermost → innermost). Nudity and explicit dance text are shown only to
// players who have opted into MIS (the maturity slider); everyone else sees the
// tamer version of the same beat.

import { getZone, getZoneNpcs, getZonePlayers, getMinimapData, world } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone, getBroadcast } from '../../server/engine/messaging.js';
import { isMisActive } from '../../server/engine/mis.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { schedule } from '../../server/engine/scheduler.js';
import { registerLockType } from '../../server/engine/locks.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { on } from '../../server/engine/events.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { describeZone } from '../../server/engine/commands/describe.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const NAKED_AT       = 500;              // heat at which every layer is off + graphic
const VIP_AT         = 1000;             // per-player total tipped that earns a VIP pass
const VIP_MS         = 24 * 60 * 60_000; // pass duration
const DECAY_PER_TICK = 12;               // heat bled off each 15s tick when idle
const REDRESS_GRACE  = 2;                // ticks (~30s) with no new tip before a dancer starts covering back up
const DANCE_CHANCE   = 0.55;             // per dancer per tick, chance to emit a line
const VIP_FLAG       = 'stripclub_vip_until'; // player Flag holding the pass expiry (ms)
const MIS_ZONE_FLAG  = 'mis_ok';         // zone flag that VIP rooms carry (matches NPC gate)

// ── Runtime state (ephemeral — resets on restart; the VIP pass persists in a Flag) ──
const heat       = new Map(); // npcId -> current shared heat
const playerTips = new Map(); // playerId -> lifetime credits tipped (this process)
const idleTicks  = new Map(); // npcId -> consecutive ticks since the last tip (drives re-dress)

const isStripper = (npc) => !!npc?.flags?.stripper && !npc._dead;
const layersOf   = (npc) => Array.isArray(npc.flags?.clothing_layers) ? npc.flags.clothing_layers : [];
// The show only happens on a club floor. A dancer who's wandered off-shift out into
// the city (an exterior tile) never performs — no poles on the street.
const isVenueZone = (zone) => !!(zone?.flags?.is_interior || zone?.flags?.is_building);

// How many outer layers should be off at a given heat. Scales with the outfit so
// a two-piece and a five-piece both end fully bare exactly at NAKED_AT.
function peeledForHeat(npc, h) {
  const n = layersOf(npc).length;
  if (!n) return 0;
  if (h >= NAKED_AT) return n;
  return Math.min(n, Math.floor((n * h) / NAKED_AT));
}

// Current show tier from heat: 0 tame → 4 graphic.
function tierForHeat(h) {
  if (h >= NAKED_AT) return 4;
  if (h >= 300) return 3;
  if (h >= 150) return 2;
  if (h >= 50)  return 1;
  return 0;
}

// Send a room line, but show the explicit version only to MIS-opted-in players.
function tieredZoneLine(zoneId, tame, graphic) {
  for (const p of getZonePlayers(zoneId)) {
    sendToPlayer(p.id, { type: 'zone_event', message: (graphic && isMisActive(p)) ? graphic : tame });
  }
}

// ── Dance lines ────────────────────────────────────────────────────────────────
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// index by tier (0-4). Tier 4 is the MIS-only graphic pool; non-MIS viewers fall
// back to tier 3 (see danceTick).
const DANCE = {
  0: (n) => pick([
    `${n} sways at the pole, working the room with a bored, practised smile.`,
    `${n} rolls a slow circuit of the stage, sizing up the crowd like inventory.`,
    `${n} traces a hand down the pole and lets the beat carry them.`,
  ]),
  1: (n) => pick([
    `${n} hooks a leg around the pole and leans back, all promise.`,
    `${n} pops a strap loose and grins at whoever's watching hardest.`,
    `${n} dips low, drags it out, and rises like it cost you something.`,
  ]),
  2: (n) => pick([
    `${n} peels the show open a little further, hips telling their own story.`,
    `${n} works the rail up close, close enough to feel the bass in your teeth.`,
    `${n} arches against the pole, skin catching the red light.`,
  ]),
  3: (n) => pick([
    `${n} moves like the whole room owes them money and is about to pay.`,
    `${n} leaves almost nothing to the imagination and knows exactly what it's worth.`,
    `${n} grinds slow against the pole, eyes daring the rail to keep up.`,
  ]),
  4: (n) => pick([
    `${n} dances bare and unhurried, every motion an open, filthy invitation.`,
    `${n} owns the pole naked as the day, grinding shameless into the red glow.`,
    `${n} puts the whole graphic show on display, slick with sweat and spotlight.`,
  ]),
};

const TIP_THANKS = {
  low:  (n) => pick([`${n}: "Mm. Keep 'em coming, sweetheart."`, `${n} tucks it away without missing a beat. "That all?"`]),
  mid:  (n) => pick([`${n}: "Now you're talking. Stay on the rail."`, `${n} rewards you with a slow, deliberate roll of the hips.`]),
  high: (n) => pick([`${n}: "Big spender. I remember faces like yours."`, `${n} leans right into you, breath warm. "You've got my attention."`]),
};

// ── Tip verb ─────────────────────────────────────────────────────────────────
// tip <dancer> <credits>   (also accepts "tip <credits> <dancer>")
async function cmdTip(args, raw, player, broadcast) {
  const rest = raw.replace(/^tip\s*/i, '').trim();
  if (!rest) return { type: 'error', message: 'Tip who, and how much? Try: tip <dancer> <credits>.' };

  const amtMatch = rest.match(/\b(\d+)\b/);
  if (!amtMatch) return { type: 'error', message: 'Tip how much? Try: tip <dancer> <credits>.' };
  const amount = parseInt(amtMatch[1], 10);
  const nameStr = (rest.slice(0, amtMatch.index) + rest.slice(amtMatch.index + amtMatch[1].length)).trim();
  if (!nameStr) return { type: 'error', message: 'Tip who? Try: tip <dancer> <credits>.' };
  if (amount <= 0) return { type: 'error', message: "That's not a tip." };

  const dancers = getZoneNpcs(player.current_zone).filter(isStripper);
  if (!dancers.length) return { type: 'error', message: "There's nobody here working the rail." };

  const r = siftResolve(nameStr, dancers);
  if (r.type === 'none') return { type: 'error', message: `There's no "${nameStr}" dancing here.` };
  if (r.type === 'ambiguous') return { type: 'error', message: 'Which dancer? Be more specific.' };
  const npc = r.candidate;

  if (!(await adjustCredits(player, -amount, undefined, 'strippers:tip'))) {
    return { type: 'error', message: "You can't cover that. Check your credits." };
  }

  const zoneId = player.current_zone;

  // Shared stage heat → peel layers as thresholds are crossed.
  const h = (heat.get(npc.id) || 0) + amount;
  heat.set(npc.id, h);
  idleTicks.set(npc.id, 0); // fresh money on the rail — the show is on, cancel any wind-down
  const layers = layersOf(npc);
  const before = npc._clothingPeeled || 0;
  const after = peeledForHeat(npc, h);
  if (after > before) {
    for (let i = before; i < after && i < layers.length; i++) {
      const g = layers[i];
      tieredZoneLine(zoneId,
        `${npc.name} slips off ${g}, playing to the rail.`,
        `${npc.name} peels ${g} off slow, eyes locked on the money, and lets it drop.`);
    }
    npc._clothingPeeled = after;
    if (after >= layers.length && layers.length) {
      tieredZoneLine(zoneId,
        `${npc.name} is down to nothing now, dancing bold as brass.`,
        `${npc.name} is completely naked now, putting the whole graphic show on full, filthy display.`);
    }
  }

  // Per-player lifetime tips → 24h VIP pass at the threshold.
  const total = (playerTips.get(player.id) || 0) + amount;
  playerTips.set(player.id, total);
  if (total >= VIP_AT) {
    const until = Number(await getFlag('player', VIP_FLAG, player)) || 0;
    if (until < Date.now()) {
      await setFlag('player', VIP_FLAG, String(Date.now() + VIP_MS), player);
      sendToPlayer(player.id, { type: 'output',
        message: `${npc.name} leans in close, voice low: "You've earned the red room, sweetheart — it's yours for the day. Follow the light."` });
    }
  }

  // Tell the room someone's tipping (actor gets their own line back).
  broadcast?.(zoneId, { type: 'zone_event', message: `${player.handle} tips ${npc.name} ${amount}₵.` }, player.id);

  const tier = tierForHeat(h);
  const thanks = tier >= 3 ? TIP_THANKS.high(npc.name) : tier >= 1 ? TIP_THANKS.mid(npc.name) : TIP_THANKS.low(npc.name);
  return { type: 'output', message: `You tip ${npc.name} ${amount}₵. ${thanks}` };
}

// Any NON-stripper NPC that's somehow undressed (_clothingPeeled > 0) re-dresses
// on the same cadence as the dancers — after REDRESS_GRACE idle ticks, one layer
// back on per tick until covered — but with neutral narration (no show, no heat,
// no MIS-gated graphic). Nothing peels a plain NPC today; this is the shared
// "cover back up" procedure for whatever future mechanic leaves one undressed.
function redressPlainNpc(npc, zoneId) {
  const layers = layersOf(npc);
  const peeledNow = npc._clothingPeeled || 0;
  if (peeledNow <= 0 || !layers.length) { idleTicks.delete(npc.id); return; }
  const idle = (idleTicks.get(npc.id) || 0) + 1;
  idleTicks.set(npc.id, idle);
  if (idle < REDRESS_GRACE) return;
  const newPeeled = peeledNow - 1;
  npc._clothingPeeled = newPeeled;
  if (newPeeled === 0) {
    idleTicks.delete(npc.id);
    sendToZone(zoneId, { type: 'zone_event', message: `${npc.name} pulls their clothes back on and straightens up.` });
  } else {
    sendToZone(zoneId, { type: 'zone_event', message: `${npc.name} pulls ${layers[newPeeled]} back on.` });
  }
}

// ── Tick: dancers dance, heat cools, and any undressed NPC re-dresses ───────────
function stripperTick() {
  for (const [zoneId, zone] of world.zones) {
    if (!zone.players || zone.players.size === 0) continue;
    for (const npc of getZoneNpcs(zoneId)) {
      if (npc.flags?.consort) continue; // a consort's undress/redress belongs to the consort plugin, not the club
      if (npc._combatTargetId || npc.posture === 'lying' || npc._ai?.homeSleeping) continue;
      // Force-stripped by the MIS `strip` verb: hold them fully bare and skip both
      // the dancer show and the plain-NPC re-dress, so a strip actually sticks.
      if (npc._forcedNude) { npc._clothingPeeled = layersOf(npc).length; continue; }
      if (!isStripper(npc)) { redressPlainNpc(npc, zoneId); continue; }

      // Cool the stage, and once the tips dry up, smartly cover back up. The
      // signal that the show's over is the money stopping: after REDRESS_GRACE
      // ticks with no new tip, the dancer commits to re-dressing — one layer per
      // tick, innermost-off first back on, each layer narrated — until fully
      // dressed. Between tips (inside the grace window) she HOLDS what the crowd
      // paid for rather than dressing and undressing on every short lull.
      const layers = layersOf(npc);
      const n = layers.length;
      const peeledNow = npc._clothingPeeled || 0;
      const idle = (idleTicks.get(npc.id) || 0) + 1;
      idleTicks.set(npc.id, idle);

      if (peeledNow > 0 && idle >= REDRESS_GRACE && n) {
        const newPeeled = peeledNow - 1;
        heat.set(npc.id, Math.floor((NAKED_AT * newPeeled) / n)); // keep the dance tier coherent with the cover-up
        npc._clothingPeeled = newPeeled;
        if (newPeeled === 0) {
          sendToZone(zoneId, { type: 'zone_event', message: `${npc.name} pulls their outfit back together. A shift's a shift.` });
        } else {
          const g = layers[newPeeled]; // the garment going back on this tick
          tieredZoneLine(zoneId,
            `${npc.name} slips ${g} back on, the show winding down.`,
            `${npc.name} slides ${g} back over slick skin, the show winding down.`);
        }
      } else {
        const h0 = heat.get(npc.id) || 0;
        if (h0 > 0) heat.set(npc.id, Math.max(0, h0 - DECAY_PER_TICK)); // ease the tier, hold the exposure
      }

      // Dance to the current tier — only on the club floor. Non-MIS viewers never see
      // the graphic pool. Off the floor (out in the city) a dancer never performs.
      if (isVenueZone(zone) && Math.random() < DANCE_CHANCE) {
        const tier = tierForHeat(heat.get(npc.id) || 0);
        tieredZoneLine(zoneId,
          DANCE[Math.min(tier, 3)](npc.name),
          DANCE[tier](npc.name));
      }
    }
  }
}
schedule('15s', stripperTick);

// ── VIP lock ───────────────────────────────────────────────────────────────────
// A door tagged { 'lock:viplock': {} } opens only for a player holding an active
// VIP pass (earned by tipping VIP_AT total). Not hackable — the pass is the key.
registerLockType('viplock', {
  tagType: 'lock:viplock',
  kitTag:  'lockkit:viplock',
  defaults: {
    messages: {
      lock:   'The red light over the door steadies. VIP is sealed.',
      unlock: 'The red light blinks to green. The VIP door releases.',
      denied: 'The bouncer plants a hand on your chest. "VIP only. Tip your way in."',
    },
  },
  authFn: async (lockTag, door, player) => {
    const until = Number(await getFlag('player', VIP_FLAG, player)) || 0;
    return until > Date.now();
  },
});

// ── Bouncer ──────────────────────────────────────────────────────────────────
// A bouncer NPC (flags.bouncer=true, optional flags.bouncer_eject_zone) enforces
// the one house rule on the club floor: hands off the dancers. He doesn't care
// what happens behind the VIP door — a room carrying the mis_ok flag is exempt —
// but a paw on a dancer anywhere else earns one terse warning, then the street.
//
// Detection rides the mis plugin's `mis.npc_act` event (fired whenever a player
// puts hands on ANY npc). We only act when: the target is a dancer, the room is
// NOT a VIP/mis_ok room, and a live bouncer is actually standing there.
const BOUNCER_WARN_LIMIT = 1;                 // free warnings before the toss
const bouncerStrikes = new Map();             // playerId -> offences this visit (ephemeral)

const BOUNCER_WARN = [
  (b) => `${b.name} clamps a hand on your shoulder like a car door. "Hands off. No touching on the floor." He doesn't blink. "Do it again and you're gone."`,
  (b) => `${b.name} steps between you and the rail before you've finished reaching. "We don't do that out here. Look, tip, leave it at that."`,
  (b) => `${b.name} peels your hand away without heat, the way you'd move a chair. "No touching. That's the whole rule. Next time you're out."`,
];
const BOUNCER_WARN_ROOM = (b, who) => `${b.name} materialises out of nowhere and puts ${who} back at arm's length from the dancer.`;
const BOUNCER_EJECT = [
  (b) => `${b.name} doesn't say much this time. A fistful of collar, your feet barely touching, and the noise of the club drops away behind a slamming door. "Told you. No touching."`,
  (b) => `${b.name} lifts you clean off the floor and walks you out mid-protest. Cold air, wet pavement, the door already shut. "Come back when you've learned some manners."`,
];
const BOUNCER_EJECT_ROOM = (b, who) => `${b.name} hauls ${who} off their feet and carries them bodily to the door.`;
const pickB = (arr) => arr[Math.floor(Math.random() * arr.length)];

// The fallback eject target: the first exit that leaves the club floor. Used when
// the bouncer NPC has no flags.bouncer_eject_zone set.
function fallbackEjectZone(zoneId) {
  const zone = getZone(zoneId);
  const exits = zone?.exits || {};
  for (const dir of Object.keys(exits)) {
    const t = typeof exits[dir] === 'string' ? exits[dir] : exits[dir]?.target;
    if (t && t !== zoneId) return t;
  }
  return null;
}

async function bouncerEject(player, bouncer, zoneId) {
  const dest = bouncer.flags?.bouncer_eject_zone || fallbackEjectZone(zoneId);
  const bc = getBroadcast();
  bc?.(zoneId, { type: 'zone_event', message: BOUNCER_EJECT_ROOM(bouncer, player.handle) }, player.id);
  if (dest) {
    await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: dest }, context: { broadcast: bc } });
    const zone = getZone(dest);
    if (zone) sendToPlayer(player.id, { type: 'move', message: await describeZone(zone, player), zone: dest, minimap: getMinimapData(dest, 8, player) });
  }
  sendToPlayer(player.id, { type: 'output', message: pickB(BOUNCER_EJECT)(bouncer) });
}

on('mis.npc_act', async ({ player, npc, zoneId }) => {
  if (!player?.id || !npc?.flags?.stripper) return;   // only hands-on-a-dancer
  if (getZone(zoneId)?.flags?.mis_ok) return;          // VIP room: not his problem
  const bouncer = getZoneNpcs(zoneId).find(n => n.flags?.bouncer && !n._dead);
  if (!bouncer) return;                                // nobody working the door

  const strikes = (bouncerStrikes.get(player.id) || 0) + 1;
  if (strikes <= BOUNCER_WARN_LIMIT) {
    bouncerStrikes.set(player.id, strikes);
    const bc = getBroadcast();
    bc?.(zoneId, { type: 'zone_event', message: BOUNCER_WARN_ROOM(bouncer, player.handle) }, player.id);
    sendToPlayer(player.id, { type: 'output', message: pickB(BOUNCER_WARN)(bouncer) });
  } else {
    bouncerStrikes.delete(player.id);
    await bouncerEject(player, bouncer, zoneId).catch(e => console.error('[strippers] bouncer eject:', e.message));
  }
});

// Wipe a player's strike count when they leave (or re-enter) — every visit to the
// floor is a clean slate, so one warning always precedes a toss.
on('zone.entered', ({ actor }) => { if (actor?.id) bouncerStrikes.delete(actor.id); });

export const commands = { tip: cmdTip };
