/*
 * PIPES — smoking apparatus: personal pipes and shared hookahs.
 *
 * THE ONE IDEA. An apparatus is not a consumable. Every drug in the game until
 * now was a thing you used up in one act: the item IS the dose. A pipe is the
 * opposite shape. You PACK it (spending something else) and then you PUFF it,
 * possibly several times, possibly not all of them yours. So the state that
 * matters is not on the drug and not on the player, it is on the BOWL, and the
 * two verbs are the two halves of that.
 *
 * WHY THE HOOKAH IS NOT JUST A BIGGER PIPE. Its bowl is SHARED. One person packs
 * it and everyone on a hose draws the same charges down. That is the whole
 * reason it is furniture instead of an item, and it is why the charge count
 * lives on the furniture rather than on any of the people around it: what the
 * room is sharing is a number, and there has to be exactly one of it.
 *
 * WHERE EACH BOWL LIVES, AND WHY THEY DIFFER. A pipe's bowl is on the item's own
 * `custom_data`, because a pipe is personal property that goes in a pocket and
 * comes back out tomorrow still loaded. A hookah's bowl is in memory here,
 * because `furniture` has no custom_data column to put it in, and because a
 * restart clearing a shared bowl is the correct outcome anyway: nobody is still
 * sitting round it. Neither is a substrate; nothing outside this file reads
 * either one.
 *
 * THIS PLUGIN IMPLEMENTS NO PHARMACOLOGY. Puffing calls the engine's `useDrug`
 * with `route: 'smoke'`, an existing route requiring the existing `smokeable`
 * flag. Tolerance, addiction, the shared depressant ceiling, overdose, the
 * come-up and the smoking plugin's behavioural layer therefore all behave
 * precisely as they do for a cigarette, and none of them know this file exists.
 * The only thing passed in is the sentence describing the act.
 *
 * AND IT GATES NOTHING IT DOES NOT OWN. The tempting design was "you cannot
 * smoke opium without a pipe", which would mean this plugin reaching into the
 * drug path to refuse something. It does not: raw resin is still chewable
 * through the ordinary `use` verb at the neutral route, and the apparatus is
 * simply the better route. The pipe is desirable rather than mandatory, and no
 * verb here has an opinion about anybody else's verb.
 */
import { getZoneFurniture } from '../../server/engine/world.js';
import { sendToZone, teachVerb } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { setPosture } from '../../server/engine/posture.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { getDrugCache, useDrug } from '../../server/engine/drugs.js';
import { query } from '../../server/models/db.js';

// How many pulls one packed load is worth. The hookah gets more because it is
// feeding a room, not because it is stronger: the per-puff dose is identical, so
// a hookah is not a way to get more drug out of one pellet, it is a way to get
// the same drug into more people.
const PIPE_CHARGES   = 3;
const HOOKAH_CHARGES = 6;

// Hoses in hand: playerId -> { furnId, zoneId, name }. Capacity is counted off
// this map rather than stored, so there is no second number to fall out of step
// with who is actually holding one.
const hoses = new Map();

// Shared bowls: furnId -> { drugId, drugName, charges, packedBy }. RAM only.
const bowls = new Map();

// ── Resolution ───────────────────────────────────────────────────────────────

function hookahIn(zoneId) {
  return getZoneFurniture(zoneId).find(f => f.flags?.hookah);
}

function hoseCount(furn) {
  const n = Number(furn?.flags?.hookah);
  return Number.isFinite(n) && n > 0 ? Math.min(12, Math.floor(n)) : 4;
}

function holdersOf(furnId) {
  let n = 0;
  for (const h of hoses.values()) if (h.furnId === furnId) n++;
  return n;
}

function pipeOf(player) {
  return resolveInventoryItem(player, { tag: 'smoking_apparatus' });
}

function readBowl(row) {
  const cd = typeof row.custom_data === 'string'
    ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })()
    : (row.custom_data || {});
  return { cd, bowl: cd.bowl && Number(cd.bowl.charges) > 0 ? cd.bowl : null };
}

async function writeBowl(row, bowl) {
  const { cd } = readBowl(row);
  if (bowl) cd.bowl = bowl; else delete cd.bowl;
  await query('UPDATE player_inventory SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), row.id]);
}

// Is this inventory row something a bowl will take? The drug row decides, not a
// second list here: anything the engine already considers smokeable (or the
// cannabis variant of the same idea) burns in a bowl. A new smokeable authored
// tomorrow is packable with no edit to this file.
function smokeableDrugFor(row) {
  const cache = getDrugCache();
  for (const id of Object.keys(cache)) {
    const d = cache[id];
    if (d.item_id !== row.item_id) continue;
    return (d.flags?.smokeable || d.flags?.cannabis) ? d : null;
  }
  return null;
}

// Spend one unit of the packed item. `burnCharge` is for pack_size rows and
// leaves a plain row alone, so a bowl does its own accounting on its own row.
async function spendOne(row) {
  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
}

// ── Hoses ────────────────────────────────────────────────────────────────────

function dropHose(player, { quiet = false } = {}) {
  const h = hoses.get(player.id);
  if (!h) return false;
  hoses.delete(player.id);
  if (!quiet) {
    sendToZone(h.zoneId, {
      type: 'zone_event',
      message: `${player.handle} coils the hose back over the ${h.name.toLowerCase()} and sits back.`,
    }, player.id);
  }
  if (player.sittingOn === h.furnId) setPosture(player, 'standing');
  return true;
}

async function cmdHookah(args, raw, player) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'off' || sub === 'stop' || sub === 'down') {
    return dropHose(player)
      ? { type: 'output', message: 'You let the hose go.' }
      : { type: 'error', message: "You aren't holding a hose." };
  }

  const furn = hookahIn(player.current_zone);
  if (!furn) return { type: 'error', message: "There's no hookah here." };
  const noun = furn.name.toLowerCase();

  if (hoses.has(player.id)) return { type: 'output', message: `You already have a hose off the ${noun}.` };

  if (holdersOf(furn.id) >= hoseCount(furn)) {
    return { type: 'error', message: `Every hose on the ${noun} is spoken for. You wait your turn, or somebody gives one up.` };
  }

  hoses.set(player.id, { furnId: furn.id, zoneId: player.current_zone, name: furn.name });
  setPosture(player, 'sitting', { sittingOn: furn.id });
  sendToZone(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} takes a hose off the ${noun} and settles in.`,
  }, player.id);

  const bowl = bowls.get(furn.id);
  const state = bowl
    ? `The bowl is packed with ${bowl.drugName}, and there is some left in it.`
    : `The bowl is empty. Somebody has to ${teachVerb('pack', 'pack')} it.`;
  return {
    type: 'output',
    message: `You take a hose off the ${noun} and settle back with the mouthpiece in your hand. ${state}<br>${teachVerb('puff', 'puff')} to draw on it.`,
  };
}

// ── Packing ──────────────────────────────────────────────────────────────────

const FILLER = ['the', 'with', 'a', 'an', 'some', 'my', 'it', 'up'];

async function cmdPack(args, raw, player) {
  // Which apparatus? The hose in your hand wins: if you are sitting at a hookah
  // holding a mouthpiece, `pack` unambiguously means that one.
  const h = hoses.get(player.id);
  const furn = h ? getZoneFurniture(player.current_zone).find(f => f.id === h.furnId) : null;
  const pipeRow = furn ? null : await pipeOf(player);

  if (!furn && !pipeRow) {
    return { type: 'error', message: "You've nothing to pack. That takes a pipe, or a hose off a hookah." };
  }

  const wanted = args.filter(a => !FILLER.includes(a.toLowerCase())).join(' ').trim();
  const row = await resolveInventoryItem(player, { tag: 'drug', ...(wanted ? { name: wanted } : {}) });
  if (!row) {
    return { type: 'error', message: wanted ? `You aren't carrying any ${wanted}.` : "You've nothing on you worth burning." };
  }
  const drug = smokeableDrugFor(row);
  if (!drug) {
    return { type: 'error', message: `${row.name[0].toUpperCase()}${row.name.slice(1)} isn't something that burns in a bowl.` };
  }

  // Already loaded? Refuse rather than overwrite. Tipping out a half-finished
  // bowl to put your own in is a thing you would have to mean.
  if (furn) {
    const existing = bowls.get(furn.id);
    if (existing) return { type: 'error', message: `The bowl already has ${existing.drugName} in it, and it isn't finished.` };
  } else {
    const { bowl } = readBowl(pipeRow);
    if (bowl) return { type: 'error', message: `The pipe is already packed with ${bowl.drugName}.` };
  }

  await spendOne(row);
  const load = {
    drugId: drug.id,
    drugName: drug.name,
    charges: furn ? HOOKAH_CHARGES : PIPE_CHARGES,
    packedBy: player.id,
  };

  if (furn) {
    const noun = furn.name.toLowerCase();
    bowls.set(furn.id, load);
    sendToZone(player.current_zone, {
      type: 'zone_event',
      message: `${player.handle} packs the ${noun} with ${drug.name} and gets it going. The water starts to knock.`,
    }, player.id);
    return {
      type: 'output',
      message: `You work the ${drug.name} into the bowl of the ${noun}, seat the coal on top and draw until the water knocks. It is going.<br>${teachVerb('puff', 'puff')} to take a pull. Anyone on a hose can.`,
    };
  }

  const pipeNoun = pipeRow.name.toLowerCase();
  await writeBowl(pipeRow, load);
  sendToZone(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} packs a pipe and lights it.`,
  }, player.id);
  return {
    type: 'output',
    message: `You roll the ${drug.name} into the bowl of the ${pipeNoun} and hold a flame under it until it takes.<br>${teachVerb('puff', 'puff')} to draw on it.`,
  };
}

// ── Puffing ──────────────────────────────────────────────────────────────────

async function cmdPuff(args, raw, player, broadcast) {
  const h = hoses.get(player.id);
  const furn = h ? getZoneFurniture(player.current_zone).find(f => f.id === h.furnId) : null;

  if (furn) {
    const noun = furn.name.toLowerCase();
    const bowl = bowls.get(furn.id);
    if (!bowl) return { type: 'error', message: `The bowl is out. Somebody needs to ${teachVerb('pack', 'pack')} it again.` };

    bowl.charges -= 1;
    const last = bowl.charges <= 0;
    if (last) bowls.delete(furn.id);

    sendToZone(player.current_zone, {
      type: 'zone_event',
      message: last
        ? `${player.handle} pulls on the ${noun}, the water knocks, and the coal goes grey.`
        : `${player.handle} pulls on the ${noun} and the water knocks.`,
    }, player.id);

    const takeLine = `You draw on the hose. The water knocks, the smoke comes through cool and enormous, and you hold it.${last ? ' The bowl gives up what it had left and goes out.' : ''}`;
    return applyPuff(player, bowl, broadcast, takeLine);
  }

  const pipeRow = await pipeOf(player);
  if (!pipeRow) return { type: 'error', message: "You've nothing to draw on." };
  const { bowl } = readBowl(pipeRow);
  if (!bowl) return { type: 'error', message: `The pipe is empty. ${teachVerb('pack', 'pack')} it first.` };

  const remaining = Number(bowl.charges) - 1;
  await writeBowl(pipeRow, remaining > 0 ? { ...bowl, charges: remaining } : null);
  sendToZone(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} draws on a pipe and holds it.`,
  }, player.id);

  const takeLine = `You draw on the ${pipeRow.name.toLowerCase()} and hold it until holding it stops being a decision.${remaining > 0 ? '' : ' The bowl burns out.'}`;
  return applyPuff(player, bowl, broadcast, takeLine);
}

// One pull = one dose, delivered by the engine. Everything interesting about
// what happens next is the engine's business and the drug row's.
async function applyPuff(player, bowl, broadcast, takeLine) {
  const result = await useDrug(player, bowl.drugId, broadcast, {
    route: 'smoke',
    takeLine,
    suppressComeupMessage: true,
  });
  return { type: 'output', message: result?.message || takeLine };
}

// ── Letting go ───────────────────────────────────────────────────────────────
// A hose is a thing in your hand: walking out of the room, standing up by any
// route, `stop`, or logging out all end it. Posture is an engine substrate and
// plenty of things force a stand, so the hose must not outlive the sitting.

on('zone.entered', ({ player: actor }) => {
  const h = actor && hoses.get(actor.id);
  if (h && actor.current_zone !== h.zoneId) dropHose(actor, { quiet: true });
});

on('player.stop', ({ player }) => { if (player) dropHose(player, { quiet: true }); });

on('posture.changed', ({ player, to }) => {
  if (player && to !== 'sitting' && hoses.has(player.id)) dropHose(player, { quiet: true });
});

on('player.logout', ({ id }) => { hoses.delete(id); });

// Declaration-only entry (handler: null) so examining a pipe advertises PACK.
// `hookah` needs no equivalent: it is the furniture's own name typed as a verb.
export const specializedActions = [
  { verb: 'pack', requiredTag: 'smoking_apparatus', handler: null },
];

export const commands = { hookah: cmdHookah, pack: cmdPack, puff: cmdPuff };

export const _internals = { hoses, bowls, hoseCount, holdersOf, smokeableDrugFor, PIPE_CHARGES, HOOKAH_CHARGES };
