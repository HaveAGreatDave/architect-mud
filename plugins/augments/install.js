/**
 * Install and removal — the pipeline that turns an object into a body part.
 *
 * THE HYBRID MODEL. Chrome you own is an ordinary `player_inventory` row: it has
 * a condition, it can be bought, sold, stolen, dropped and looted, and it wears
 * out in your pack exactly like a coat, because it IS one as far as the engine is
 * concerned. Installing CONSUMES that row and writes a `player_augments` record
 * carrying its condition across. From that moment it is not inventory — it is
 * body — and removal hands an item row back.
 *
 * This is why nothing here re-implements condition, quality, trade or looting:
 * all four already exist, and the only reason a bionics system would need its own
 * versions is if it refused to be an item first.
 *
 * SURGERY IS NOT EQUIPPING. You pay BEFORE the roll — the clinic and the repair
 * bench both charge for the attempt, and so does this. The five bands seed
 * condition and calibration; a sixth outcome, worse than all of them, destroys
 * the hardware outright. Every fresh install seeds calibration BELOW 100: new
 * chrome under-performs, and tuning is how you get the number on the tin.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { emit } from '../../server/engine/events.js';
import { setFlag } from '../../server/engine/flags.js';
import { burnAllMutations } from '../../server/engine/mutations.js';
import { recomputeEquipped } from '../../server/engine/commands/inventory.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { getPlayerIdeologyRep, REP_TIERS } from '../../server/engine/ideologies.js';
import { conditionBand } from '../../server/engine/durability.js';
import {
  catalog, findAugment, rosterOf, recordOf, persistRec, SLOT_CAPS, BOTCHED_CALIBRATION_CAP,
} from './state.js';
import {
  pickSurgeon, installDifficulty, installQuote, complicationChance, npcCheck, stars,
} from './surgeon.js';

const ASCENDANTS = 'ideology_ascendants';
const OPPOSED = ['ideology_long_watch', 'ideology_wildblood', 'ideology_null'];
const OPPOSED_REP_HIT = -25;
const PATH_GAIN = 8;
const TIER_RANK = Object.fromEntries(REP_TIERS.map((t, i) => [t.id, i]));

/**
 * THE FLOOR. Chrome is the Ascendants' discipline, the same way mutation is the
 * Wildblood's and mastery is the Long Watch's, so fitting ANY of it takes real
 * standing with them — you commit, and then you get the hardware.
 *
 * This is a floor under the per-augment `rep_gate`, not a replacement for it:
 * an author still sets the rung each piece sits on (the cortical backup is
 * inner_circle and should stay there), and this only stops a piece authored
 * below the floor from being a way to skip the commitment entirely.
 *
 * It is stated ONCE, here, rather than trusted to every author remembering,
 * because the failure mode is silent: a new augment with no `rep_gate` would
 * quietly become the free entry rung and nobody would notice until a player
 * with no Ascendant standing at all was walking around chromed.
 *
 * `known` is deliberately the value. Anything below it is free — a character
 * who has never met an Ascendant already sits at `neutral`, so gating at
 * `neutral` reads as a gate and functions as an open door.
 *
 * ⚠ When the unlicensed Promethean path is built, THIS is the constant it
 * carves an exemption out of — an unlicensed cutter is supposed to be how you
 * get chrome without kneeling to the campus. Until that exists, there is no
 * back door, and that is intentional rather than an oversight.
 */
const MIN_INSTALL_TIER = 'known';

/**
 * The five bands. Condition and calibration both fall together, but they fall for
 * different reasons and the player can act on them differently: condition is
 * repaired, calibration is tuned, and `botched` is neither — it is a permanent
 * ceiling, the one outcome you cannot buy your way out of afterwards.
 */
export const INSTALL_BANDS = [
  { id: 'flawless', min: 8,    condition: 1.00, calibration: 85, hpLoss: 0.00 },
  { id: 'clean',    min: 4,    condition: 0.98, calibration: 70, hpLoss: 0.05 },
  { id: 'sound',    min: 0,    condition: 0.92, calibration: 55, hpLoss: 0.10 },
  { id: 'rough',    min: -5,   condition: 0.75, calibration: 35, hpLoss: 0.25 },
  { id: 'botched',  min: -999, condition: 0.45, calibration: 20, hpLoss: 0.40 },
];
// Worse than botched: the hardware does not survive the theatre.
export const DESTROY_MARGIN = -10;

export function bandFor(margin) {
  return INSTALL_BANDS.find(b => margin >= b.min) || INSTALL_BANDS[INSTALL_BANDS.length - 1];
}

/**
 * What the theatre was like.
 *
 * TWO REGISTERS, and the split is the faction. Licensed work is private
 * medicine: quiet, attended, expensive, and the discomfort is managed rather
 * than endured. Unlicensed work is a back room with a bright lamp, and you are
 * awake for more of it than you would like. The MECHANICAL outcome is identical
 * for the same margin (the bands do not care who cut you), so this is purely
 * what the money bought, which is the honest thing for luxury to be.
 *
 * NO EM DASHES in any of these. The exemption in docs/story.md is for an
 * Ascendant NPC's own SPEECH; narration about Ascendants is narration, and the
 * rule names it explicitly. Luxury here is carried by what the sentences notice
 * (a glass already poured, somebody watching your numbers) rather than by
 * punctuation borrowed from a voice that is not talking.
 */
const BAND_LINES = {
  licensed: {
    flawless: name => `${name} works without hurrying and without a wasted movement: a low room, cool light, somebody whose whole job is watching your numbers. You are under before you have finished being nervous, and up before the anaesthetic has finished being interesting. It seats like it grew there.`,
    clean:    name => `${name} does clean work in a clean room. You wake to a warm blanket and a glass of water already poured, and the soreness has been anticipated and medicated before you noticed it was coming.`,
    sound:    name => `${name} takes longer than the estimate and says so, which is itself a kind of service. It is in, it works, and somebody sits with you until the shaking stops.`,
    rough:    name => `${name} goes back in a second time, and the room gets quieter in the way expensive rooms do when something is not going to plan. It is seated. It is not seated WELL, and everyone present knows it.`,
    botched:  name => `${name} steps back too early and does not meet your eye. There is a form to sign. The language on it is beautiful and it says, at length, that nothing here was anybody's fault. Something in there is not sitting square, and it never will.`,
  },
  unlicensed: {
    flawless: name => `${name} does it on a folding table under a work lamp, humming, and does it perfectly. Some hands do not need a building around them.`,
    clean:    name => `${name} works fast and talks the whole way through, which turns out to be the anaesthetic. Cleaner than the room deserved.`,
    sound:    name => `${name} gets it in. It is in, it works, and you were awake for a good deal more of that than you wanted to be.`,
    rough:    name => `${name} swears twice and goes back in with the same tool. It is seated. It is not seated WELL.`,
    botched:  name => `${name} stops, looks at it, and shrugs, an actual shrug, in front of you. Something in there is not sitting square, and it never will. There is no form to sign because there is no one to sign it to.`,
  },
};

const bandLine = (band, surgeon) =>
  BAND_LINES[surgeon.licensed ? 'licensed' : 'unlicensed'][band];

export function atClinic(player) {
  const zone = world.zones.get(player.current_zone);
  return !!zone?.flags?.augment_clinic;
}

async function ascendantRank(playerId) {
  const reps = await getPlayerIdeologyRep(playerId);
  const row = reps.find(r => r.id === ASCENDANTS);
  return TIER_RANK[row?.tier || 'unknown'] ?? 0;
}

/**
 * Give the player an item row. Used by removal (the chrome comes back out as a
 * thing) and by a destroyed install (you get the wreckage, and you still paid).
 */
export async function giveItemRow(playerId, itemId, { condition = 1, customData = {} } = {}) {
  if (!itemId) return null;
  const id = randomUUID();
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data)
     VALUES ($1,$2,$3,1,$4,$5)`,
    [id, playerId, itemId, Math.max(0, Math.min(1, condition)), JSON.stringify(customData)]
  );
  return id;
}

async function refresh(player) { await recomputeEquipped(player); }

// --- install ---------------------------------------------------------------

/**
 * `augment install <name> [with <surgeon>]`
 *
 * Order of operations matters and is deliberate: validate everything, quote,
 * charge, THEN roll. A player who cannot afford it is told so before anything
 * irreversible happens; a player who can has already bought the attempt.
 */
export async function installAugment(rest, player) {
  if (!rest) return { type: 'error', message: 'Install what? Try: augment install <name> [with <surgeon>]' };

  let name = rest, surgeonName = null;
  const m = rest.match(/^(.*?)\s+(?:with|by|from)\s+(.+)$/i);
  if (m) { name = m[1].trim(); surgeonName = m[2].trim(); }

  if (!atClinic(player)) {
    return { type: 'error', message: "You can't install chrome out here. This is clinic work. Find a chrome-doctor's theatre." };
  }
  const cache = await catalog();
  const aug = findAugment(cache, name);
  if (!aug) return { type: 'error', message: `No such augment: "${name}".` };

  const roster = rosterOf(player);
  if (roster.has(aug.id)) return { type: 'error', message: `You already have ${aug.name} installed.` };

  const cap = SLOT_CAPS[aug.slot] ?? 1;
  const usedInSlot = [...roster.values()].filter(r => r.slot === aug.slot).length;
  if (usedInSlot >= cap) {
    return { type: 'error', message: `No free ${aug.slot} slot (${usedInSlot}/${cap}). Pull something first.` };
  }

  // The floor and the piece's own gate are one check: whichever is higher wins,
  // so a piece authored above the floor keeps its own rung untouched.
  const rank = await ascendantRank(player.id);
  const pieceRank = TIER_RANK[aug.rep_gate] ?? 0;
  const floorRank = TIER_RANK[MIN_INSTALL_TIER];
  const needRank = Math.max(pieceRank, floorRank);
  if (rank < needRank) {
    const gate = REP_TIERS[needRank];
    // Two different refusals, because they send you to do different work.
    // "Not this one yet" means keep climbing; "not any of this yet" means you
    // have not joined, and a player who conflates them wastes a week.
    return { type: 'error', message: pieceRank <= floorRank
      ? `Chrome is not something you buy your way into. The Ascendants fit their own, `
        + `and nobody here knows you well enough to open you up. Do their work first.`
      : `${aug.name} is reserved for those the Ascendants trust (${gate?.label || 'higher standing'}). Raise your standing first.` };
  }

  // The hardware itself must be in your hands. This is the whole point of the
  // hybrid model: you cannot install what you do not own.
  const itemId = aug.item_id;
  if (!itemId) {
    return { type: 'error', message: `${aug.name} has no hardware anybody has ever laid hands on. Nothing to fit.` };
  }
  const rows = await resolveInventoryItem(player, { all: true, topLevel: true });
  const row = (rows || []).find(r => r.item_id === itemId && !r.is_equipped);
  if (!row) {
    return { type: 'error', message: `You aren't carrying the hardware. ${aug.name} has to be bought before it can be fitted.` };
  }
  const itemCondition = row.condition == null ? 1 : Number(row.condition);

  const picked = pickSurgeon(player.current_zone, surgeonName);
  if (picked.error) return { type: 'error', message: picked.error };
  const surgeon = picked.surgeon;

  const difficulty = installDifficulty(aug, {
    itemCondition, installedCount: roster.size, surgeon,
  });
  const cost = installQuote(player, surgeon, aug);
  if ((player.credits || 0) < cost) {
    return { type: 'error', message: `${surgeon.name} wants ₵${cost} to fit ${aug.name}. You don't have it.` };
  }

  // --- commit: charged before the roll ---
  await adjustCredits(player, -cost, undefined, 'augment:install');

  const check = npcCheck(surgeon.skill, difficulty);
  const complicated = Math.random() < complicationChance(player, surgeon, difficulty);
  const margin = check.margin;

  // Worse than any band: the hardware is destroyed on the table.
  if (margin < DESTROY_MARGIN) {
    await query('DELETE FROM player_inventory WHERE id=$1', [row.inv_id]);
    if (aug.salvage_item_id) {
      await giveItemRow(player.id, aug.salvage_item_id, {
        condition: 0.15, customData: { ruined: true, from_augment: aug.id },
      });
    }
    const line = aug.failure_messages?.dead
      || `${aug.name} comes apart under the light. Whatever it was, it is scrap now.`;
    return { type: 'error', message:
      `<span class="text-red">${line}</span>\n`
      + `${surgeon.name} does not look at you. ₵${cost} is gone and so is the hardware.` };
  }

  const band = complicated && margin >= INSTALL_BANDS[3].min
    ? INSTALL_BANDS.find(b => b.id === 'rough')      // a complication drags a good result down
    : bandFor(margin);

  // Condition carries across from the item — a surgeon cannot make a worn arm new,
  // which is the "a brilliant surgeon cannot transform cheap hardware" rule.
  const condition = Math.max(0.05, Math.min(itemCondition, band.condition));
  const calibration = band.id === 'botched'
    ? Math.min(band.calibration, BOTCHED_CALIBRATION_CAP)
    : band.calibration;

  await query('DELETE FROM player_inventory WHERE id=$1', [row.inv_id]);
  await query(
    `INSERT INTO player_augments
       (player_id, augment_id, slot, condition, calibration, install_quality, overclock_level, custom_data)
     VALUES ($1,$2,$3,$4,$5,$6,0,'{}')
     ON CONFLICT (player_id, augment_id) DO UPDATE
       SET condition = EXCLUDED.condition, calibration = EXCLUDED.calibration,
           install_quality = EXCLUDED.install_quality, overclock_level = 0`,
    [player.id, aug.id, aug.slot, condition, calibration, band.id]
  );

  const wasFirst = roster.size === 0;
  roster.set(aug.id, {
    augment_id: aug.id, slot: aug.slot, condition, calibration,
    install_quality: band.id, overclock_level: 0, custom_data: {}, installed_at: Date.now() / 1000,
  });

  // Trauma. The body pays for a bad fitting.
  if (band.hpLoss > 0) {
    player.hp = Math.max(1, Math.round(player.hp - player.hp_max * band.hpLoss));
  }

  // The first chrome burns off the flesh — a deliberate, warned, one-way choice.
  // `chromed_ever` is what makes it one-way: without it, a death that corrupts
  // every augment would silently re-open the flesh path.
  let burnLine = '';
  if (wasFirst) {
    await setFlag('player', 'chromed_ever', '1', player);
    const n = await burnAllMutations(player);
    if (n) burnLine = `\n<span style="opacity:.8">The needle finds the old flesh-code and overwrites it. ${n} mutation${n > 1 ? 's' : ''} slough away. Chrome and mutation cannot share a body.</span>`;
  }

  await dispatchAction({ type: 'ADJUST_PATH', actor: player, params: { path: 'machine', delta: PATH_GAIN } });
  for (const opp of OPPOSED) {
    await dispatchAction({ type: 'ADJUST_REPUTATION', actor: player, params: { ideology_id: opp, delta: OPPOSED_REP_HIT, reason: 'augment install' } });
  }
  await refresh(player);

  // The act, announced. Nothing in this plugin consumes it — it exists because a
  // fitting was the one thing chrome could do that the world never heard about,
  // so no quest could ask for it and no observer could react to it. Emitted after
  // the row, the roster, the path and the opposed-rep hit have all landed, so
  // anything listening sees a body that is already fitted rather than one mid-cut.
  emit('augment.installed', {
    actor: player, augment_id: aug.id, slot: aug.slot,
    quality: band.id, condition, calibration,
  });

  const capNote = band.id === 'botched'
    ? `\n<span class="text-red">It will never tune past ${BOTCHED_CALIBRATION_CAP}%. That is not something a better technician can fix.</span>`
    : '';
  return { type: 'augments', message:
    `${bandLine(band.id, surgeon)(surgeon.name)}\n\n`
    + `<span class="zone-name">${aug.name}</span> installed — condition ${Math.round(condition * 100)}%, calibration ${calibration}%.${capNote}${burnLine}\n`
    + `<span style="opacity:.7">Fresh chrome always runs under spec. Have it calibrated.</span>` };
}

// --- removal ---------------------------------------------------------------

const REMOVE_BANDS = [
  { id: 'clean',  min: 2,    keep: 1.00 },
  { id: 'rough',  min: -4,   keep: 0.70 },
  { id: 'ruined', min: -999, keep: 0.00 },
];

/**
 * `augment remove <name> [with <surgeon>]`
 *
 * Rolls too, and that is the point: without a removal risk, remove→reinstall is
 * a free unlimited re-roll of the install band and the whole surgery system is
 * a slot machine you can pull for the fitting fee.
 */
export async function removeAugment(rest, player) {
  if (!rest) return { type: 'error', message: 'Remove what? Try: augment remove <name> [with <surgeon>]' };

  let name = rest, surgeonName = null;
  const m = rest.match(/^(.*?)\s+(?:with|by|from)\s+(.+)$/i);
  if (m) { name = m[1].trim(); surgeonName = m[2].trim(); }

  if (!atClinic(player)) return { type: 'error', message: 'Pulling chrome is clinic work too. Not here.' };

  const cache = await catalog();
  const aug = findAugment(cache, name);
  if (!aug) return { type: 'error', message: `No such augment: "${name}".` };
  const rec = recordOf(player, aug.id);
  if (!rec) return { type: 'error', message: `You don't have ${aug.name} installed.` };

  const picked = pickSurgeon(player.current_zone, surgeonName);
  if (picked.error) return { type: 'error', message: picked.error };
  const surgeon = picked.surgeon;

  const cost = installQuote(player, surgeon, aug, { removing: true });
  if ((player.credits || 0) < cost) {
    return { type: 'error', message: `${surgeon.name} wants ₵${cost} to take it out. You don't have it.` };
  }
  await adjustCredits(player, -cost, undefined, 'augment:remove');

  const difficulty = installDifficulty(aug, { itemCondition: rec.condition, installedCount: 0, surgeon }) - 2;
  const check = npcCheck(surgeon.skill, difficulty);
  const band = REMOVE_BANDS.find(b => check.margin >= b.min) || REMOVE_BANDS[REMOVE_BANDS.length - 1];

  await query('DELETE FROM player_augments WHERE player_id=$1 AND augment_id=$2', [player.id, aug.id]);
  rosterOf(player).delete(aug.id);
  player._augmentsDirty?.delete(aug.id);
  player._augHeat?.delete(aug.id);
  player._augWearPending?.delete(aug.id);

  let back = '';
  if (band.keep > 0 && aug.item_id) {
    await giveItemRow(player.id, aug.item_id, { condition: rec.condition * band.keep });
    back = band.id === 'clean'
      ? `\n${aug.name} goes into a tray, still worth something.`
      : `\n${aug.name} comes out in worse shape than it went in. It will need work before anybody fits it again.`;
  } else if (aug.salvage_item_id) {
    await giveItemRow(player.id, aug.salvage_item_id, { condition: 0.2, customData: { ruined: true, from_augment: aug.id } });
    back = `\n<span class="text-red">${surgeon.name} gets it out of you in pieces. It is scrap.</span>`;
  }

  // The machine-path nudge reverses; the standing you burned with the human
  // orders stays burned — pulling chrome doesn't un-happen the offense.
  await dispatchAction({ type: 'ADJUST_PATH', actor: player, params: { path: 'machine', delta: -PATH_GAIN } });
  await refresh(player);

  return { type: 'augments', message: `<span class="zone-name">${aug.name}</span> removed.${back}` };
}

// --- repair ----------------------------------------------------------------

/**
 * `augment repair <name> [with <surgeon>]` — bench work on installed chrome.
 *
 * Restores CONDITION and nothing else. Calibration is untouched on purpose: a
 * machine can be physically sound and badly tuned, and collapsing the two would
 * delete half the system. This is also the only route back for chrome that has
 * gone dead at zero condition — which is why zero doesn't destroy it.
 */
export async function repairAugment(rest, player) {
  if (!rest) return { type: 'error', message: 'Repair what? Try: augment repair <name>' };
  let name = rest, surgeonName = null;
  const m = rest.match(/^(.*?)\s+(?:with|by|from)\s+(.+)$/i);
  if (m) { name = m[1].trim(); surgeonName = m[2].trim(); }

  if (!atClinic(player)) return { type: 'error', message: 'Chrome gets fixed in a theatre, not in the street.' };
  const cache = await catalog();
  const aug = findAugment(cache, name);
  if (!aug) return { type: 'error', message: `No such augment: "${name}".` };
  const rec = recordOf(player, aug.id);
  if (!rec) return { type: 'error', message: `You don't have ${aug.name} installed.` };

  const missing = 1 - Math.max(0, Math.min(1, rec.condition));
  if (missing < 0.02) return { type: 'error', message: `${aug.name} is in good order. Nothing to do.` };

  const picked = pickSurgeon(player.current_zone, surgeonName);
  if (picked.error) return { type: 'error', message: picked.error };
  const surgeon = picked.surgeon;

  const cost = Math.max(50, Math.round((Number(aug.cost) || 0) * 0.5 * missing * surgeon.rate));
  if ((player.credits || 0) < cost) {
    return { type: 'error', message: `${surgeon.name} quotes ₵${cost} to put ${aug.name} right. You don't have it.` };
  }
  await adjustCredits(player, -cost, undefined, 'augment:repair');

  const check = npcCheck(surgeon.skill, Number(aug.install_difficulty) || 5);
  const restore = check.margin >= 8 ? 1 : check.margin >= 3 ? 0.6 : check.margin >= 0 ? 0.35 : 0.1;
  const before = rec.condition;
  rec.condition = Math.max(0, Math.min(1, before + missing * restore));
  await persistRec(player, aug.id);
  await refresh(player);

  const band = conditionBand(rec.condition);
  return { type: 'output', message:
    `${surgeon.name} opens you up and works. ₵${cost}.\n`
    + `<span class="zone-name">${aug.name}</span> — condition ${Math.round(before * 100)}% → <b>${Math.round(rec.condition * 100)}%</b> (${band?.label || band?.id}).\n`
    + `<span style="opacity:.7">Calibration is untouched. Physically sound is not the same as tuned.</span>` };
}

// --- the quote, before you commit ------------------------------------------

/**
 * `augment quote <name>` — the risk estimate. The player must be able to see
 * what they are buying BEFORE they buy it; a surgery system that surprises you
 * is a dice game wearing a clinic's coat.
 */
export async function quoteInstall(rest, player) {
  if (!rest) return { type: 'error', message: 'Quote what? Try: augment quote <name>' };
  const cache = await catalog();
  const aug = findAugment(cache, rest);
  if (!aug) return { type: 'error', message: `No such augment: "${rest}".` };
  const { surgeonsIn } = await import('./surgeon.js');
  const all = surgeonsIn(player.current_zone);
  if (!all.length) return { type: 'error', message: 'Nobody here does the cutting.' };

  const rows = await resolveInventoryItem(player, { all: true, topLevel: true });
  const row = (rows || []).find(r => r.item_id === aug.item_id);
  const itemCondition = row ? (row.condition == null ? 1 : Number(row.condition)) : 1;

  let msg = `<span class="skills-header">FITTING — ${aug.name.toUpperCase()}</span>\n\n`;
  if (!row) msg += `<span class="outcast-warning">You are not carrying the hardware. These are prices, not appointments.</span>\n\n`;
  // Sorted best-hands-first. A quote sheet is a sales document and the house
  // always leads with the thing it would rather you bought.
  for (const s of [...all].sort((a, b) => b.skill - a.skill)) {
    const difficulty = installDifficulty(aug, { itemCondition, installedCount: rosterOf(player).size, surgeon: s });
    const risk = complicationChance(player, s, difficulty);
    const cost = installQuote(player, s, aug);
    // The two registers again. Licensed work sells you the ROOM and the aftercare
    // — the things you cannot see on a stat line and are paying for anyway.
    // Unlicensed work sells you the price, because that is all it has.
    const pitch = s.licensed
      ? (s.skill >= 8
          ? `<span style="opacity:.75">  Private suite, attended recovery, aftercare included.</span>\n`
          : `<span style="opacity:.75">  Licensed theatre. Recovery on the premises.</span>\n`)
      : `<span style="opacity:.6">  Unlicensed. No theatre, no aftercare, no paperwork.</span>\n`;
    msg += `<span class="zone-name">${s.name}</span>\n`
        +  `  Hands: ${stars(s.skill)}\n`
        +  pitch
        +  `  Complication rate: ${(risk * 100).toFixed(1)}%\n`
        +  `  Fee: <span class="credits">₵${cost}</span>\n\n`;
  }
  msg += `<span style="opacity:.7">augment install ${aug.name} with &lt;name&gt;</span>\n`
      +  `<span style="opacity:.55">The fee buys the attempt, not the outcome. It is taken either way.</span>`;
  return { type: 'output', message: msg };
}
