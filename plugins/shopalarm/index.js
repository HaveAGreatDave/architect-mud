/**
 * shopalarm plugin
 *
 * An intruder alarm on a shopfront. Breach the shutter and a box inside starts
 * counting; kill the panel before it finishes and nobody ever knows you were
 * there, miss it and it phones SPECTER-PD itself.
 *
 * ── THE ONE IDEA THIS RESTS ON ──────────────────────────────────────────────
 *
 * THE WINDOW IS THE MECHANIC, AND IT IS ONE CLOCK.
 *
 * The alarm arms the moment the LOCK gives, which is while you are still out on
 * the pavement. Everything after that spends the same clock: walking in, finding
 * the panel among the room's furniture, and the board itself. So `hack alarm`
 * opens a game whose length is WHAT IS LEFT — never a per-game constant — and a
 * player who browsed the shelves on the way in gets a shorter game than one who
 * went straight to the wall. That is the whole of what makes a faster alarm model
 * worth paying for: it does not make the puzzle harder so much as make you
 * commit before you have looked around.
 *
 * ⚠ THE SWEEP IS THE ONLY AUTHORITY ON WHETHER IT TRIPPED. The board carries its
 * own countdown because it has to draw one, and a board that believes it won
 * after the sweep already fired finds nothing in `pendingDisarm` and resolves to
 * a noop. Two clocks that can each decide the outcome is precisely the bug that
 * rule exists to prevent — and it is reachable in normal play, because a client
 * a second behind is an ordinary client.
 *
 * ── Why the sweep and not a timer ───────────────────────────────────────────
 * Demolition's fuse, copied deliberately: one `schedule('1s')` walking a RAM Map
 * rather than a `setTimeout` per alarm. The scheduler idle-gates it for free, and
 * a restart clearing the Map is the documented behaviour rather than a leak of
 * orphaned timers pointing at zones that may not exist any more.
 *
 * ── What is NOT here ────────────────────────────────────────────────────────
 * Police dispatch. `CHARGE_CRIME` already sirens and calls `dispatchPolice` at
 * any star count, so charging the crime IS sending the police, and a second
 * dispatch here would put two cars on one call.
 */
import { getZone, getZoneFurniture, getZoneNpcs, getZonePlayers } from '../../server/engine/world.js';
import { getBroadcast, sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { schedule } from '../../server/engine/scheduler.js';
import { textRender } from '../../server/engine/minigame.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { hackDifficulty, damageHackDeck, breachMargin, hasHackDeck } from '../../server/engine/hack-gear.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { on, emit } from '../../server/engine/events.js';
import { holdVendorGrudge } from '../../server/engine/vendor-grudge.js';
import { neighborZoneIds } from '../../server/engine/exits.js';
import { isNpcAsleep, disturbSleeper } from '../../server/engine/ai-behaviour.js';

// ── The models ──────────────────────────────────────────────────────────────
//
// Five rungs, authored per shop as `flags.alarm_tier` on the panel. The window
// and the difficulty move TOGETHER and in the same direction, which is the point:
// a better box gives you less time AND is harder once you get there, so the tiers
// are a single axis a shopkeeper buys up rather than two knobs to trade off.
//
// ⚠ The windows are in SECONDS of real time and are deliberately generous at the
// bottom. Tier 1 has to be beatable by somebody who has never seen the board,
// because the first shop anybody turns over will have one.
const TIERS = {
  1: { secs: 90, diff: 3,  name: 'a bell box'            },
  2: { secs: 60, diff: 4,  name: 'a standard panel'      },
  3: { secs: 40, diff: 6,  name: 'a graded panel'        },
  4: { secs: 25, diff: 8,  name: 'a bonded-grade panel'  },
  5: { secs: 15, diff: 10, name: 'an Ascendant unit'     },
};
const DEFAULT_TIER = 2;
const tierOf = (panel) => TIERS[clampTier(panel?.flags?.alarm_tier)] || TIERS[DEFAULT_TIER];
const clampTier = (v) => Math.max(1, Math.min(5, Math.round(Number(v) || DEFAULT_TIER)));

// A window under this is past helping, and the board refuses to open rather than
// opening onto a game nobody could finish. Demolition's `DEFUSE_FLOOR_S` rule:
// being told there is no time is a playable answer; a board that runs out under
// your hands two seconds in is not. It still trips — declining the game is not
// declining the consequence.
const DISARM_FLOOR_S = 4;

// An abandoned board expires rather than disarming later.
const PENDING_TTL_MS = 5 * 60_000;

// ── State (RAM only — see the header) ───────────────────────────────────────
// Keyed by the SHOP zone, not the player: one shop has one alarm however many
// people are standing in it, and a second breach of a ringing shop must not start
// a second clock.
const liveAlarms = new Map();   // shopZoneId -> { shopZoneId, streetZoneId, playerId, handle, tripAt, tier, panelId, lastChirp, vendorSeen }
const pendingDisarm = new Map();// playerId -> { shopZoneId, ts }

// A shop that IS ringing, as opposed to one counting down. It has to be its own
// state rather than an absence, for two reasons that are both about the red
// screen at the other end of this.
//
// ⚠ NOTHING ELSE CAN EVER TURN IT OFF. Only the server knows when an alarm has
// stopped mattering, there is no timeout behind the body class, and a missed
// clear is a player looking at a red room for the rest of the session — the
// drug-FX layer's "the client holds a source until told otherwise" trap, which
// is exactly this trap one system over. So the ring EXPIRES on the same sweep
// that started it and the end is pushed as deliberately as the beginning.
//
// ⚠ And a ring somebody WALKS INTO has to be pushed too. The trip message only
// reaches whoever was standing there; anybody arriving afterwards would get a
// room description of a shop full of red light with a screen that had never
// heard of it.
const ringing = new Map();      // shopZoneId -> { untilTs, streetZoneId }
const RING_MS = 90_000;         // it rings until somebody comes and kills it

const secsLeft = (a) => Math.max(0, Math.ceil((a.tripAt - Date.now()) / 1000));

// ── Finding the panel ───────────────────────────────────────────────────────
// A tag on furniture, so a builder decides which shops are worth alarming when
// they place the panel and this file never learns the name of a single shop.
const isPanel = (f) => f?.flags?.alarm_panel === true;
const panelIn = (zoneId) => getZoneFurniture(zoneId).find(isPanel);

// ── Arming ──────────────────────────────────────────────────────────────────
//
// `hololock.breached` fires for EVERY lock in the game, so the gate is simply
// whether the premises on the far side have a panel in them. That means this
// plugin needs to know nothing about shops, shutters, storefronts or trading
// hours — a panel behind a lock is an alarmed building, and an office, a lock-up
// or somebody's private gallery works the same way for free.
//
// ⚠ `zoneId` on that event is where the HACKER stands, which for a shopfront is
// the street. The premises are on the FAR side of the door, which is why the
// event carries the door.
on('hololock.breached', ({ player, zoneId, door }) => {
  if (!player || !door) return;
  for (const shopZoneId of farSideOf(door, zoneId)) {
    const panel = panelIn(shopZoneId);
    if (!panel) continue;
    if (liveAlarms.has(shopZoneId)) return;    // already counting; a second breach does not restart it
    arm(shopZoneId, zoneId, panel, player);
    return;                                     // one door, one alarm
  }
});

function farSideOf(door, fromZoneId) {
  const far = door.target_zone
    ? [door.target_zone, door.zone_id]
    : [door.zone_id, door.target_zone];
  return far.filter(z => z && z !== fromZoneId);
}

function arm(shopZoneId, streetZoneId, panel, player) {
  const tier = tierOf(panel);
  liveAlarms.set(shopZoneId, {
    shopZoneId, streetZoneId,
    playerId: player.id, handle: player.handle,
    tripAt: Date.now() + tier.secs * 1000,
    tier, panelId: panel.id,
    lastChirp: 0, vendorSeen: false,
  });
  // The first chirp lands immediately and is heard on BOTH sides, because the
  // breacher is still outside and the one thing they must not be able to do is
  // walk away not knowing. After this the chirps stay inside.
  chirp(shopZoneId, streetZoneId, 1);
  sendToPlayer(player.id, {
    type: 'message',
    message: `<span class="text-yellow">Somewhere inside, a panel starts chirping. Steady. Patient. It is counting, and it is not counting for your benefit.</span>`,
  });
  emit('shopalarm.armed', { player, zoneId: shopZoneId, tier: tier.secs });
}

// ── The warning tone ────────────────────────────────────────────────────────
//
// Accelerating: every 4s at the top of the window, every 1s in the last quarter.
// The acceleration is doing real work — it is the only thing that tells you how
// much of your window is gone without a number on the screen, and this system
// deliberately has no readout.
//
// ⚠ A LINE GOES WITH THE SOUND, ALWAYS. A player with audio off would otherwise
// get NO warning at all, which makes a timed feature invisible rather than hard;
// `client/game/js/esp.js` carries the same rule for the emergency siren and the
// client prints the line only when sound is actually off, so nobody hears it
// twice. It is the log, which is the one live region, so a screen reader gets it.
function chirp(shopZoneId, streetZoneId, urgency) {
  const msg = { type: 'audio_sfx_proc', params: { action: 'alarm', state: 'warn', intensity: urgency, seed: (Math.random() * 0xffffffff) >>> 0 } };
  sendToZone(shopZoneId, msg);
  sendToZone(shopZoneId, { type: 'alarm_chirp', urgency });
  if (streetZoneId) {
    sendToZone(streetZoneId, msg);
    sendToZone(streetZoneId, { type: 'alarm_chirp', urgency, muffled: true });
  }
}

function chirpGap(frac) {
  if (frac < 0.25) return 1000;   // last quarter
  if (frac < 0.5) return 2000;
  return 4000;
}

// ── The sweep ───────────────────────────────────────────────────────────────
schedule('1s', async () => {
  const now = Date.now();
  for (const alarm of [...liveAlarms.values()]) {
    if (alarm.tripAt > now) {
      // The vendor is checked EVERY tick, not once at the breach. They may walk
      // in on you at any point of this, which is the whole difference between an
      // alarm and a timer.
      checkVendor(alarm);
      const total = alarm.tier.secs * 1000;
      const frac = (alarm.tripAt - now) / total;
      const gap = chirpGap(frac);
      if (now - alarm.lastChirp >= gap) {
        alarm.lastChirp = now;
        chirp(alarm.shopZoneId, alarm.streetZoneId, 1 - frac);
      }
      continue;
    }
    liveAlarms.delete(alarm.shopZoneId);   // ⚠ delete BEFORE firing — it trips once
    await trip(alarm).catch(err => console.error(`[shopalarm] trip failed: ${err.message}`));
  }
  // The ring running out. Same sweep, same delete-before-acting shape.
  for (const [zoneId, ring] of [...ringing.entries()]) {
    if (ring.untilTs > now) continue;
    ringing.delete(zoneId);
    silence(zoneId, ring.streetZoneId);
  }
});

// Every way the red goes away ends here, so there is one of it.
function silence(shopZoneId, streetZoneId) {
  sendToZone(shopZoneId, { type: 'alarm_state', active: false, zoneId: shopZoneId });
  if (streetZoneId) sendToZone(streetZoneId, { type: 'alarm_state', active: false, zoneId: shopZoneId });
}

// Walking into a shop that is already going off. The client clears its own class
// on any room change and lets the server re-assert, so this is the only thing
// that can put it back — and it has to fire for the STREET side too, because the
// red light coming through the glass is a thing you can stand outside and see.
on('zone.entered', ({ actor, zone }) => {
  if (!actor?.id || !zone) return;
  const ringHere = ringing.has(zone)
    || [...ringing.values()].some(r => r.streetZoneId === zone);
  if (ringHere) sendToPlayer(actor.id, { type: 'alarm_state', active: true, zoneId: zone });
});

// ── The vendor ──────────────────────────────────────────────────────────────
//
// They are not a second alarm and they do not shorten the clock. What they do is
// remove the point of beating it: they have seen your face in their shop with the
// lock broken, so the charge lands whether or not the box ever finishes, and they
// will remember it the next time you want to buy something.
//
// ⚠ Once, not every tick — the flag is what stops an NPC standing in the room
// re-charging the crime and re-shouting a line once a second for the whole window.
function checkVendor(alarm) {
  if (alarm.vendorSeen) return;
  const vendor = (getZoneNpcs(alarm.shopZoneId) || []).find(n => n.vendor_inventory && !isNpcAsleep(n));
  if (!vendor) return;
  alarm.vendorSeen = true;

  const broadcast = getBroadcast() || (() => {});
  broadcast(alarm.shopZoneId, {
    type: 'zone_event',
    message: `<span class="text-red">${vendor.name} is standing in the back of the shop, absolutely still, watching you work. "I see you," they say. "I SEE you." They are already reaching for a handset.</span>`,
    refresh: true,
  });
  holdVendorGrudge(actorFor(alarm), vendor.id).catch(() => {});
  emit('shopalarm.vendorSaw', { playerId: alarm.playerId, zoneId: alarm.shopZoneId, npcId: vendor.id });
  chargeBreakIn(alarm, 'seen by the keyholder');
}

// ── The trip ────────────────────────────────────────────────────────────────
async function trip(alarm) {
  // ⚠ Presentation is the only thing allowed to be missing. `getBroadcast()` is
  // not installed in the regression harness or during early boot, and the law
  // must land whether or not anybody was there to hear it — demolition's own
  // note, and the same sweep-wrapped `.catch` makes the same mistake possible.
  const broadcast = getBroadcast() || (() => {});

  broadcast(alarm.shopZoneId, {
    type: 'zone_event',
    message: `<span class="text-red">The chirping stops.\n\nFor about a second the shop is completely silent — and then every light in the ceiling goes hard red and the box on the wall opens up: a two-tone howl, rising and falling, loud enough to lean on. It has already made the call.</span>`,
    refresh: true,
  });

  ringing.set(alarm.shopZoneId, { untilTs: Date.now() + RING_MS, streetZoneId: alarm.streetZoneId });

  const siren = { type: 'audio_sfx_proc', params: { action: 'alarm', state: 'siren', intensity: alarm.tier.diff / 10, seed: (Math.random() * 0xffffffff) >>> 0 } };
  sendToZone(alarm.shopZoneId, siren);
  sendToZone(alarm.shopZoneId, { type: 'alarm_state', active: true, zoneId: alarm.shopZoneId });
  if (alarm.streetZoneId) {
    sendToZone(alarm.streetZoneId, siren);
    broadcast(alarm.streetZoneId, { type: 'zone_event', message: `An alarm goes off behind the shutters — a hard two-tone howl, and red light strobing out through the glass.` });
  }

  // It carries. A siren through a wall is the least ambiguous wake-up there is.
  for (const neighbourId of neighborZoneIds(getZone(alarm.shopZoneId)) || []) {
    broadcast(neighbourId, { type: 'zone_event', message: `An alarm starts up somewhere close — a rising, falling howl that does not stop.` });
    for (const npc of getZoneNpcs(neighbourId) || []) {
      if (isNpcAsleep(npc)) disturbSleeper(npc, { broadcast, force: true });
    }
  }

  await chargeBreakIn(alarm, 'the alarm called it in');
  emit('shopalarm.tripped', { playerId: alarm.playerId, zoneId: alarm.shopZoneId });
}

// ── The law ─────────────────────────────────────────────────────────────────
//
// ⚠ `CHARGE_CRIME`, never `WANTED_RAISE`. The raw raise would give the stars and
// skip the evidence clip, the siren line and `dispatchPolice` — and the police
// actually coming is the entire consequence being asked for here. The crime key
// is `witness: 'always'` because the ALARM is the witness: it dialled them
// itself, so a dark street and a jammed camera buy nothing.
//
// The actor has to be a real player object where we can find one (the charge
// path reads the live handle and zone), and a reconstructed stub where we
// cannot — they may have legged it out of the room before the box finished,
// which is a reasonable thing to try and not a reason to go uncharged.
function actorFor(alarm) {
  return (getZonePlayers(alarm.shopZoneId) || []).find(p => p.id === alarm.playerId)
    || (getZonePlayers(alarm.streetZoneId) || []).find(p => p.id === alarm.playerId)
    || { id: alarm.playerId, handle: alarm.handle, current_zone: alarm.shopZoneId };
}

async function chargeBreakIn(alarm, reason) {
  const actor = actorFor(alarm);
  await dispatchAction({
    type: 'CHARGE_CRIME',
    actor,
    params: { key: 'breaking_and_entering', zoneId: alarm.shopZoneId, reason },
  }).catch(() => {});
}

// ── hack alarm ──────────────────────────────────────────────────────────────
//
// Self-gates (returns undefined) when there is no panel here, so the four other
// owners of `hack` — doors, hackrig, storefront, vendor-safe — still claim the
// verb in a room with no alarm in it.
async function cmdHack(args, raw, player) {
  const panel = panelIn(player.current_zone);
  if (!panel) return undefined;

  const alarm = liveAlarms.get(player.current_zone);
  if (!alarm) {
    return { type: 'output', message: `The panel's standby light is green and it is doing nothing at all. There is nothing here to stop.` };
  }

  if (!(await hasHackDeck(player.id)))
    return { type: 'error', message: `You get your hands to the panel and realise you have nothing to put into it. You need a hacking device.` };

  const left = secsLeft(alarm);
  if (left < DISARM_FLOOR_S) {
    // Declining the board is not declining the consequence — the sweep still has
    // it, and will fire on its own within the second.
    return { type: 'error', message: `<span class="text-red">You get the fascia off and the countdown is already into single figures. There is no time. There is not even time to try.</span>` };
  }

  pendingDisarm.set(player.id, { shopZoneId: alarm.shopZoneId, ts: Date.now() });
  return await textRender(player, {
    type: 'alarm_disarm',
    alarmId: alarm.shopZoneId,
    deviceName: panel.name || 'alarm panel',
    skill: await effectiveSkill(player, 'hacking'),
    difficulty: await hackDifficulty(player.id, alarm.tier.diff),
    // ⚠ WHAT IS LEFT, never a per-game constant. See the header.
    seconds: left,
    resolveCmd: 'alarmresolve',
  });
}

// alarmresolve <alarmId> <1|0> — silent; the board fires its own outcome.
async function cmdAlarmResolve(args, raw, player) {
  const alarmId = args[0];
  const win = args[1] === '1';
  if (!alarmId) return { type: 'noop' };

  // Must match a board this player actually opened, still fresh (anti-spoof).
  const pending = pendingDisarm.get(player.id);
  pendingDisarm.delete(player.id);
  if (!pending || pending.shopZoneId !== alarmId || Date.now() - pending.ts > PENDING_TTL_MS) return { type: 'noop' };

  // ⚠ The sweep may have tripped it while the board was still drawing. It is the
  // authority; a win arriving after the fact changes nothing.
  const alarm = liveAlarms.get(alarmId);
  if (!alarm) return { type: 'noop' };

  if (!win) {
    const deckMsg = await damageHackDeck(player.id);
    return { type: 'error', message: `<span class="text-red">The sequence rejects and the panel latches you out. Whatever happens now happens on its schedule.</span>${deckMsg}` };
  }

  liveAlarms.delete(alarmId);
  const broadcast = getBroadcast() || (() => {});
  broadcast(alarmId, { type: 'zone_event', message: `The chirping stops mid-note. The panel's light goes from amber to a dull, dead nothing.`, refresh: true }, player.id);
  silence(alarmId, alarm.streetZoneId);
  await awardSkillUse(player.id, 'hacking', await breachMargin(player, alarm.tier.diff));
  emit('shopalarm.disarmed', { player, zoneId: alarmId });

  // A vendor who already saw you is a charge you cannot take back by winning.
  const caught = alarm.vendorSeen
    ? `\n<span class="text-red">It does not help. They watched you do it.</span>`
    : '';
  return {
    type: 'output',
    message: `You find the line the box is holding open and you close it, gently, before it notices. The panel goes dark.\n<span class="ip-gain">Hacking improved.</span>${caught}`,
  };
}

// ── The tell ────────────────────────────────────────────────────────────────
//
// Fair warning, and the only warning. The line reads the SAME state the mechanic
// does, so what the panel says about itself can never disagree with what it is
// doing — vendor-safe's rule, and the reason a live alarm can be read off the
// fascia rather than only heard.
export const hooks = {
  'furniture.describe': (f, player) => {
    if (!isPanel(f)) return undefined;
    const zoneId = f.zone_id || player?.current_zone;
    const alarm = zoneId ? liveAlarms.get(zoneId) : null;
    if (!alarm) {
      const tier = tierOf(f);
      return `A standby light sits steady and green. ${cap(tier.name)}, and a good one costs what it costs.`;
    }
    return `<span class="text-red">The light is amber and stepping — on, off, on — and it is stepping faster than it was. HACK ALARM, or don't, but decide now.</span>`;
  },
};

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

export const specializedActions = [
  { verb: 'hack', requiredTag: 'alarm_panel', handler: cmdHack },
];

export const commands = { alarmresolve: cmdAlarmResolve };

// Test seam.
export const _test = { liveAlarms, pendingDisarm, ringing, RING_MS, TIERS, DISARM_FLOOR_S, tierOf, clampTier, chirpGap, secsLeft, isPanel, farSideOf, trip, arm, silence };
