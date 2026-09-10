/**
 * Demolition — breaching charges, and the two minigames that bracket one.
 *
 * A charge is not a weapon. You do not throw it at somebody; you WIRE IT TO A
 * THING, set how long you have, and then the interesting part of the mechanic is
 * that you are standing next to it. Everything below follows from that: the fuse
 * is public (the room is told, loudly), the charge is defusable by anybody who
 * walks in, and the blast does not care whose it was.
 *
 * ── WHAT THIS PLUGIN DELIBERATELY DOES NOT OWN ──────────────────────────────
 * Damage, sound, crime and quest progress all already exist, and every one of
 * them is reached through the seam that already serves it:
 *
 *   damage  → `applyStrikeToPlayer` (combat.js). NEVER `player.hp -=`. Writing hp
 *             by hand skips the body-part roll, typed soak, and the damage
 *             observers the injury plugin hangs real wounds off — the same rule
 *             the mutations and psionics organs follow.
 *   sound   → `propagateSound`, so the neighbouring rooms hear it and the far
 *             ones hear something.
 *   crime   → the CHARGE_CRIME action (plugins/surveillance). Dispatched by name
 *             so this plugin never imports that one.
 *   quests  → we emit `demolition.detonated` and plugins/quests subscribes. The
 *             `demolish` objective type is one `on()` over there, exactly like
 *             `augment.installed`.
 *
 * ── STATE ───────────────────────────────────────────────────────────────────
 * Live charges are RAM-only, keyed by id, and a restart forgets them. That is
 * correct rather than lazy: a fuse is a thing measured in seconds, the durable
 * residue of one going off is the destroyed furniture row, and a table would buy
 * nothing but a migration. Same reasoning as heat in augments.js.
 *
 * ── THE TWO BOARDS ──────────────────────────────────────────────────────────
 * `rig` and `defuse` each open a minigame, and both go out through
 * `textRender()` so all three Display Mode rungs are served by one call:
 * graphical, character-drawn, or resolved on a skill check at the log rung.
 *
 * ⚠ THE VERB IS `breach`, AND IT WANTED TO BE `rig`. It cannot be: plugins/trucking
 * already owns `rig` (coupling a tractor to a trailer), plugins beat each other by
 * load order rather than by intent, and the collision does not error — the first
 * draft of this plugin shipped a `rig` that answered "You would need to be at a
 * depot. The benches are in the yards." Checking `plugin.json` command arrays
 * across every plugin is the only way to know a verb is free; the engine builtin
 * map is a second namespace to check after that. `breach` is also the better word
 * here, since the item is a breaching charge.
 *
 * ⚠ Both pass `skill: 'science'` explicitly. `textRender` defaults its log-rung
 * check to `hacking`, and a family whose board is not about breaking into a
 * computer must name its own skill or the bottom rung silently grades a
 * different competence than the other two. `science` was already defined as
 * "Energy weapons, CHARGES, and homemade bad ideas" — the skill for this was
 * written years before the mechanic was.
 */
import { getZoneFurniture, getFurnitureById, getZonePlayers, getZone, updateFurniture } from '../../server/engine/world.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { textRender } from '../../server/engine/minigame.js';
import { applyStrikeToPlayer } from '../../server/engine/combat.js';
import { propagateSound } from '../../server/engine/sounds.js';
import { getBroadcast, sendToPlayer } from '../../server/engine/messaging.js';
import { schedule } from '../../server/engine/scheduler.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { emit } from '../../server/engine/events.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { hasTag } from '../../server/engine/tags.js';
import { query } from '../../server/models/db.js';

// ── Tunables ────────────────────────────────────────────────────────────────
// FUSE_MIN is the floor the arming board can set, and it is deliberately short
// enough to be a bad idea. The whole tension of the rig board is that a shorter
// fuse is worth more (less time for anybody to find it) and leaves you less room
// to be somewhere else, so the floor has to be genuinely dangerous or the choice
// is not one.
const FUSE_MIN = 10;
const FUSE_MAX = 120;
const FUSE_DEFAULT = 45;
const RIG_STALE_MS = 3 * 60_000;   // an abandoned board expires rather than arming later
const BLAST_MIN = 22;
const BLAST_MAX = 48;
// A charge on a fuse under this is past helping — the defuse board refuses to
// open rather than opening onto a game nobody can finish. Being told "there is
// no time" is a playable answer; a board that closes itself mid-cut is not.
const DEFUSE_FLOOR_S = 4;

// ── State (RAM only — see the header) ───────────────────────────────────────
const liveCharges = new Map();  // chargeId -> { id, zoneId, targetId, targetName, ownerId, ownerHandle, fuseAt }
const pendingRig = new Map();   // playerId -> { chargeId, targetId, targetName, zoneId, chargeRow, ts }
const pendingDefuse = new Map();// playerId -> { chargeId, ts }
let seq = 0;
const nextId = () => `chg_${Date.now().toString(36)}_${(seq++).toString(36)}`;

// ── What can be rigged ──────────────────────────────────────────────────────
// Anything in the room with the `demolishable` tag. A tag rather than a hardcoded
// list, so a builder decides what is worth blowing up when they place it and this
// file never learns the name of a single piece of furniture.
function demolishableIn(zoneId) {
  return getZoneFurniture(zoneId).filter(f => hasTag(f, 'demolishable'));
}

// The charge in your hands. `explosive_charge` is the tag, so a future shaped
// charge, a satchel or somebody's homemade bad idea all work here for free — and
// naming one is optional, because the overwhelmingly common case is carrying one.
async function findCharge(player, hint) {
  return resolveInventoryItem(player, { tag: 'explosive_charge', ...(hint ? { name: hint } : {}) });
}

// Spend it. There is no shared "use one up" helper — the house pattern is this
// two-line decrement-or-delete against the row's own id, and `resolveInventoryItem`
// aliases that id to `inv_id`.
async function consumeOne(row) {
  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.inv_id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.inv_id]);
}

const secsLeft = (c) => Math.max(0, Math.ceil((c.fuseAt - Date.now()) / 1000));

// ── breach <target> [with <charge>] ────────────────────────────────────────────
async function cmdBreach(args, raw, player) {
  const words = args.join(' ').trim();
  if (!words) return { type: 'error', message: 'Wire a charge to what? Try "breach <thing> with <charge>".' };

  // "rig the colonnade with the breaching charge" — split on ` with `, which is
  // the only preposition this verb takes.
  const [targetHint, chargeHint] = words.split(/\s+with\s+/i);

  const candidates = demolishableIn(player.current_zone);
  if (!candidates.length) return { type: 'error', message: "There's nothing here worth wiring a charge to." };

  const r = siftResolve(targetHint, candidates, { verb: 'breach' });
  if (r.type === 'none') return { type: 'error', message: `You can't wire a charge to "${targetHint}".` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'demolition.rig_target', dispatchParam: 'target' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const target = r.candidate;

  const already = [...liveCharges.values()].find(c => c.targetId === target.id);
  if (already) {
    return { type: 'error', message: `There's already a charge on the ${target.name}, counting down from ${secsLeft(already)}.` };
  }

  const charge = await findCharge(player, chargeHint);
  if (!charge) {
    return { type: 'error', message: "You aren't carrying anything that would do it. You want a breaching charge." };
  }

  const chargeId = nextId();
  pendingRig.set(player.id, {
    chargeId, targetId: target.id, targetName: target.name,
    zoneId: player.current_zone, chargeRow: charge, ts: Date.now(),
  });

  return textRender(player, {
    type: 'bomb_rig',
    chargeId,
    deviceName: target.name,
    skill: await effectiveSkill(player, 'science'),
    difficulty: Number(target.flags?.rig_difficulty) || 5,
    fuseMin: FUSE_MIN, fuseMax: FUSE_MAX, fuseDefault: FUSE_DEFAULT,
    resolveCmd: 'breachresolve',
  }, { skill: 'science' });
}

// breachresolve <chargeId> <1|0> [fuseSeconds] — silent; the arming board fires it.
async function cmdBreachResolve(args, raw, player) {
  const [chargeId, wonArg, fuseArg] = args;
  const won = wonArg === '1';
  const pending = pendingRig.get(player.id);
  pendingRig.delete(player.id);
  if (!pending || pending.chargeId !== chargeId || Date.now() - pending.ts > RIG_STALE_MS) return { type: 'noop' };

  // The board hands back a fuse length; the server clamps it. A client is never
  // trusted with a number that decides how long anybody has to react.
  const fuse = Math.min(FUSE_MAX, Math.max(FUSE_MIN, Number(fuseArg) || FUSE_DEFAULT));

  if (!won) {
    // A fumbled seating wastes the charge. It does not go off in your hands —
    // there is no version of this game where a bad roll on a menu kills you with
    // no warning and nothing to do about it.
    await consumeOne(pending.chargeRow);
    return { type: 'error', message: "The detonator won't seat. You strip the leads and the charge is scrap." };
  }

  await consumeOne(pending.chargeRow);
  const charge = {
    id: chargeId, zoneId: pending.zoneId, targetId: pending.targetId, targetName: pending.targetName,
    ownerId: player.id, ownerHandle: player.handle, fuseAt: Date.now() + fuse * 1000,
  };
  liveCharges.set(chargeId, charge);
  await awardSkillUse(player.id, 'science', 2);
  emit('demolition.rigged', { actor: player, target_id: charge.targetId, zoneId: charge.zoneId, fuse });

  // The room is told. A charge nobody can see is an assassination, not a
  // demolition, and `defuse` would be a verb with no way to learn about its
  // target. The line is deliberately about the SOUND rather than about you.
  getBroadcast()(charge.zoneId, {
    type: 'zone_event',
    message: `<span class="msg-system">Something under the ${charge.targetName} starts to tick.</span>`,
  }, player.id);

  return {
    type: 'output',
    message: `<span class="msg-system">Charge seated on the ${charge.targetName}. <b>${fuse} seconds.</b> Be elsewhere.</span>`,
  };
}

// ── defuse <target> ─────────────────────────────────────────────────────────
async function cmdDefuse(args, raw, player) {
  const hint = args.join(' ').trim();
  const here = [...liveCharges.values()].filter(c => c.zoneId === player.current_zone);
  if (!here.length) return { type: 'error', message: 'Nothing here is ticking.' };

  const named = hint
    ? here.find(c => c.targetName.toLowerCase().includes(hint.toLowerCase()))
    : here[0];
  if (!named) return { type: 'error', message: `Nothing called "${hint}" is ticking.` };

  const left = secsLeft(named);
  if (left <= DEFUSE_FLOOR_S) {
    return { type: 'error', message: `<span class="text-red">There's no time. Run.</span>` };
  }

  pendingDefuse.set(player.id, { chargeId: named.id, ts: Date.now() });
  return textRender(player, {
    type: 'bomb_defuse',
    chargeId: named.id,
    deviceName: named.targetName,
    skill: await effectiveSkill(player, 'science'),
    // A defuse gets harder the less time is on the clock, which is the whole
    // reason the rig board lets you choose a short one.
    difficulty: left < 20 ? 8 : left < 45 ? 6 : 4,
    seconds: left,
    resolveCmd: 'defuseresolve',
  }, { skill: 'science' });
}

// defuseresolve <chargeId> <1|0>
async function cmdDefuseResolve(args, raw, player) {
  const [chargeId, wonArg] = args;
  const won = wonArg === '1';
  const pending = pendingDefuse.get(player.id);
  pendingDefuse.delete(player.id);
  if (!pending || pending.chargeId !== chargeId) return { type: 'noop' };

  const charge = liveCharges.get(chargeId);
  if (!charge) return { type: 'noop' }; // it already went off, or somebody beat you to it

  if (!won) {
    // Losing the board does not detonate it early. The clock was always the
    // threat; cutting the wrong lead simply means you are still standing there
    // with it ticking, which is punishment enough and stays legible.
    await awardSkillUse(player.id, 'science', -2);
    return { type: 'error', message: `Wrong lead. The count doesn't stop. <b>${secsLeft(charge)} seconds.</b>` };
  }

  liveCharges.delete(chargeId);
  await awardSkillUse(player.id, 'science', 3);
  emit('demolition.defused', { actor: player, target_id: charge.targetId, zoneId: charge.zoneId });
  getBroadcast()(charge.zoneId, {
    type: 'zone_event',
    message: `<span class="msg-system">${player.handle} pulls something out from under the ${charge.targetName}, and the ticking stops.</span>`,
  }, player.id);
  return { type: 'output', message: `<span class="ip-gain">The count stops.</span> You lift the charge clear of the ${charge.targetName}.` };
}

// ── charges ─────────────────────────────────────────────────────────────────
async function cmdCharges(args, raw, player) {
  const here = [...liveCharges.values()]
    .filter(c => c.zoneId === player.current_zone)
    .sort((a, b) => a.fuseAt - b.fuseAt);
  if (!here.length) return { type: 'output', message: 'Nothing in this room is counting down.' };
  const lines = here.map(c => `  <span class="text-red">${String(secsLeft(c)).padStart(3)}s</span>  ${c.targetName}`);
  return { type: 'output', message: `<span class="msg-system">Live:</span>\n${lines.join('\n')}` };
}

// ── The fuse ────────────────────────────────────────────────────────────────
// One '1s' subscriber sweeping the map, not a timer per charge: the scheduler
// idle-gates it for free, and a restart clearing the map is the documented
// behaviour rather than a leak of orphaned timeouts.
schedule('1s', async () => {
  const now = Date.now();
  for (const charge of [...liveCharges.values()]) {
    if (charge.fuseAt > now) continue;
    liveCharges.delete(charge.id);
    await detonate(charge).catch(err => console.error(`[demolition] detonation failed: ${err.message}`));
  }
});

async function detonate(charge) {
  // ⚠ THE BANG BEING UNHEARD MUST NEVER STOP THE BOMB GOING OFF. `getBroadcast()`
  // is not guaranteed to be installed — it isn't in the regression harness, and
  // it isn't during early boot — and `propagateSound` calls it without a guard.
  // The unguarded version threw here, and because the sweep wraps this call in a
  // `.catch`, the damage, the destruction, the crime and the quest event were all
  // silently skipped by a charge that had visibly been armed. Presentation is the
  // only thing allowed to be missing.
  const broadcast = getBroadcast() || (() => {});
  const zone = getZone(charge.zoneId);
  const occupants = getZonePlayers(charge.zoneId);

  // 1. The bang, before anything else — it is what everyone in earshot gets, and
  //    the loudness is high enough that the far rooms hear a dropped-word version.
  propagateSound(
    charge.zoneId,
    'a hard flat bang, and a long sound of things coming down',
    9,
    broadcast,
  );
  broadcast(charge.zoneId, {
    type: 'zone_event',
    message: `<span class="text-red">The ${charge.targetName} comes apart.</span>`,
  });

  // 2. Everyone standing in it. Through the strike seam, so the injury plugin's
  //    observers hang real wounds off the hit and armour soaks it by type.
  for (const p of occupants) {
    const hit = await applyStrikeToPlayer(p, { min: BLAST_MIN, max: BLAST_MAX, damageType: 'explosive' });
    if (!hit) continue;
    sendToPlayer(p.id, {
      type: 'output',
      message: `<span class="text-red">The blast catches you across the ${hit.partLabel}.</span> (−${hit.damage})`,
      player_update: { hp: p.hp },
    });
  }

  // 3. The thing itself. `destroyed` on the row rather than a DELETE, so a
  //    builder can still find it and the world keeps a scar.
  const target = getFurnitureById(charge.targetId);
  if (target) {
    await updateFurniture(charge.targetId, {
      flags: JSON.stringify({ ...(target.flags || {}), destroyed: true }),
    }).catch(() => {});
  }

  // 4. The law. An explosion is not something anybody fails to notice, so this
  //    is a forced charge — but `arson` only when there was somebody in the room
  //    to endanger, which is the difference the crime registry itself draws
  //    between arson ("an occupied structure") and vandalism.
  const owner = occupants.find(p => p.id === charge.ownerId) || { id: charge.ownerId, handle: charge.ownerHandle, current_zone: charge.zoneId };
  await dispatchAction({
    type: 'CHARGE_CRIME',
    actor: owner,
    params: { key: occupants.length ? 'arson' : 'vandalism', zoneId: charge.zoneId },
  }).catch(() => {});

  // 5. Quests last, so a quest that reacts to this is reacting to a world that
  //    has already changed.
  emit('demolition.detonated', {
    actor: owner,
    target_id: charge.targetId,
    zoneId: charge.zoneId,
    zone_name: zone?.name || charge.zoneId,
  });
}

export const commands = {
  breach: cmdBreach,
  defuse: cmdDefuse,
  charges: cmdCharges,
  breachresolve: cmdBreachResolve,
  defuseresolve: cmdDefuseResolve,
};

// Declaration-only: registers nothing at dispatch (the handler above self-resolves
// its target), but puts `rig` on the examine list of anything tagged demolishable
// so the verb is findable rather than folklore.
export const specializedActions = [
  { verb: 'breach', requiredTag: 'demolishable', handler: null },
];

// Exposed for the regression harness.
export const _test = { liveCharges, pendingRig, pendingDefuse, detonate, FUSE_MIN, FUSE_MAX, DEFUSE_FLOOR_S };
