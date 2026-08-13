/**
 * PSYCHOMETRY — reading what a place or a thing remembers.
 *
 * The discipline that shipped first, because it is the one that proves the design.
 * `residue.js` holds the memory (fed entirely by events that already fire) and
 * this file turns it into prose a player can act on.
 *
 * ── Three rules ──────────────────────────────────────────────────────────────
 *
 * 1. NEVER A NAME. An impression is fragmentary, unattributed and uncorroborated.
 *    Cameras answer WHO; this answers WHAT HAPPENED HERE and sends you to find
 *    out who. Handing over an identity would delete the surveillance plugin and
 *    all of its counterplay in one verb.
 *
 * 2. THE ORDER IS WRONG ON A BAD ROLL. Not a shorter list, a SCRAMBLED one. A
 *    failure that just returns less is indistinguishable from an empty room, and
 *    teaches the player that low skill means the verb is broken. A failure that
 *    returns the right fragments in the wrong sequence is a genuinely different
 *    and worse answer, which is what an unreliable sense should feel like.
 *
 * 3. EVERY LINE THROUGH `voice()`. Below Seer nothing may claim a mechanism.
 */
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { awardSkillUse } from '../../server/engine/skills.js';
import { textRender } from '../../server/engine/minigame.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { conditionBand, effectiveCondition } from '../../server/engine/durability.js';
import {
  abilityRefusal, abilityCost, psiCheck, spend, UNKNOWN, addSignature,
} from '../../server/engine/psionics.js';
import { residueAt } from './residue.js';
import { resolveStrain } from './strain.js';
import { voice } from './prose.js';

/**
 * How each kind of residue reads.
 *
 * `strong` is what you get when the mark is fresh and the roll was good; `faint`
 * is the same event barely legible. Neither ever names anybody, and neither ever
 * says what caused the impression — they are written as things the room is doing,
 * not as things the reader is detecting.
 */
const RESIDUE_PROSE = {
  death: {
    strong: 'Something ended here. The room is still holding the shape of it.',
    faint:  'There is a stillness in one corner that the rest of the room does not share.',
  },
  violence: {
    strong: 'Fast movement. A lot of it, all at once, and then not.',
    faint:  'The air here has been disturbed and has not entirely settled.',
  },
  fear: {
    strong: 'Somebody was very frightened standing about where you are standing.',
    faint:  'A thin unease, like a draught from a door nobody can find.',
  },
  crime: {
    strong: 'Something was done here that was meant to go unseen.',
    faint:  'A furtiveness clings to the place. Somebody hurried.',
  },
  psionic: {
    strong: 'Somebody was working here, and they were not using their hands.',
    faint:  'The quiet here is the wrong shape.',
  },
  intimacy: {
    strong: 'Warmth, and the memory of somebody not wanting to leave.',
    faint:  'A softness in the room that does not match the furniture.',
  },
  sickness: {
    strong: 'Somebody was ill here for a long time.',
    faint:  'A sourness under everything.',
  },
  filth: {
    strong: 'Neglect, layered up over months.',
    faint:  'Nobody has cared about this room in a while.',
  },
};

function proseFor(entry) {
  const t = RESIDUE_PROSE[entry.kind];
  if (!t) return null;
  return entry.strength >= 1 ? t.strong : t.faint;
}

/** Fisher-Yates on a copy — rule 2. */
function scramble(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * `read` with no argument: the room.
 *
 * This is the investigation verb. It is also the one most likely to be a player's
 * first psionic act, so an empty room must answer with something rather than a
 * blank — a room where nothing has happened is INFORMATION, and saying so is what
 * teaches the player that the verb is working and the room is simply quiet.
 */
export async function readRoom(player, broadcast) {
  const refusal = abilityRefusal(player, 'residue', 'place');
  if (refusal === UNKNOWN) return { type: 'error', message: 'Unknown command.' };
  if (refusal) return { type: 'error', message: refusal };

  const cost = abilityCost(player, 'residue');
  const check = await psiCheck(player, 'residue');
  spend(player, cost.resonance, cost.strain + (check.success ? 0 : 1));

  const found = residueAt(player.current_zone);
  await awardSkillUse(player.id, 'psionics', check.margin);
  addSignature(player.id, player.current_zone, 'psychometry', 0.5);

  const lines = [];
  if (!found.length) {
    lines.push(voice(player, {
      low:  'Nothing. Whatever this room has been used for, it has been quiet a long while.',
      high: 'The room is empty in the way a swept floor is empty. Nothing recent has happened here at all.',
    }));
  } else {
    // A poor roll scrambles the sequence rather than shortening it — rule 2. The
    // player gets everything the room holds and no way to know what came first,
    // which is a worse answer than none in a genuinely useful way.
    const ordered = check.success ? found : scramble(found);
    const limit = check.success ? 4 : 3;
    for (const entry of ordered.slice(0, limit)) {
      const line = proseFor(entry);
      if (line) lines.push(voice(player, { low: line, high: line }));
    }
    if (!check.success && lines.length > 1) {
      lines.push(voice(player, {
        low:  'You could not say which of those came first.',
        high: 'The order will not hold still. They are all there; the sequence is not.',
      }));
    }
  }

  await resolveStrain(player, broadcast);
  return { type: 'output', message: lines.map(l => `<span class="ambient">${l}</span>`).join('<br>') };
}

/**
 * `read <object>`: an item's own history.
 *
 * Reads what `durability.js` and the inventory row ALREADY record — the condition
 * band, and whether the thing has been repaired. Nothing is invented and nothing
 * new is stored on the item, which is the same "no second copy of state" rule the
 * rest of this system runs on. A well-kept knife and a knife that has been put
 * back together twice are genuinely different objects and this is the verb that
 * can tell.
 */
export async function readObject(player, targetStr, broadcast) {
  const refusal = abilityRefusal(player, 'impression', 'object');
  if (refusal === UNKNOWN) return { type: 'error', message: 'Unknown command.' };
  if (refusal) return { type: 'error', message: refusal };

  const item = await resolveInventoryItem(player, { name: targetStr, fromNearby: true });
  if (!item) return { type: 'error', message: `You aren't holding anything like that.` };

  const cost = abilityCost(player, 'impression');
  const difficulty = 0;
  const check = await psiCheck(player, 'impression', difficulty);
  spend(player, cost.resonance, cost.strain + (check.success ? 0 : 1));
  await awardSkillUse(player.id, 'psionics', check.margin);
  addSignature(player.id, player.current_zone, 'psychometry', 0.5);

  // The board. `textRender` handles all three Display Mode rungs from one call —
  // a graphical panel, a text board, or an auto-resolved log line at the bottom
  // rung — so nothing here needs to know which one the player is on.
  await textRender(player, {
    type: 'psychometry',
    itemName: item.name,
    itemId: item.id,
    fragments: fragmentsFor(item, check),
    skill: 'psionics',
    difficulty: 4,
    resolveCmd: 'psiresolve',
  }, { skill: 'psionics' });

  await resolveStrain(player, broadcast);
  return null;   // the panel is the output
}

/**
 * What an object can tell you, derived from what the game already knows about it.
 *
 * Four meters, matching the brief's psychometry board: IMAGE, EMOTION, LOCATION,
 * IDENTITY. IDENTITY is deliberately the weakest one available and is capped hard
 * — it never resolves to a name, only to a shape of a person. That cap is rule 1
 * expressed as a number so it cannot be argued with later.
 */
function fragmentsFor(item, check) {
  // A knife that has been put back together twice is a genuinely different object
  // from a well-kept one, and durability.js already knows which is which. Nothing
  // is authored on the item for psionics' benefit.
  const band = conditionBand(effectiveCondition(item));
  const worn = band.id === 'battered' || band.id === 'failing' || band.id === 'broken';
  const margin = Math.max(0, Math.min(10, check.margin));

  return {
    image:    Math.min(10, 3 + margin + (worn ? 2 : 0)),
    emotion:  Math.min(10, 2 + margin),
    location: Math.min(10, 1 + Math.floor(margin / 2)),
    // Never above 4. An impression does not identify anybody, ever.
    identity: Math.min(4, Math.floor(margin / 3)),
  };
}

/**
 * `attune` — the posture.
 *
 * The scavenging/fishing shape: a low-grade perpetual sense that surfaces what a
 * single reach would miss, drains while it is held, and is broken by anything
 * that breaks a posture. Cheap per tick and expensive over time, which is the
 * opposite cost curve to `read` and gives the two verbs genuinely different uses.
 */
export async function still(player) {
  const refusal = abilityRefusal(player, 'stillness', 'self');
  if (refusal === UNKNOWN) return { type: 'error', message: 'Unknown command.' };
  if (refusal) return { type: 'error', message: refusal };

  if (player.psiAttuned) {
    player.psiAttuned = null;
    return { type: 'output', message: voice(player, {
      low:  'You stop listening and the room goes back to being a room.',
      high: 'You close, and the noise of everything that ever happened here mercifully stops.',
    }) };
  }

  player.psiAttuned = { at: Date.now(), zone: player.current_zone };
  const teach = ` <span class="ambient">(${teachVerb('dwell')} to settle on something in particular.)</span>`;
  return { type: 'output', message: voice(player, {
    low:  'You let your attention go slack, and wait.',
    high: 'You open, and the room begins to tell you things in no order at all.',
  }) + teach };
}

/** Called from the minute tick for anyone holding the posture. */
export async function stillTick(player, broadcast) {
  if (!player.psiAttuned) return;
  // Moving breaks it, the same way it breaks a scavenge.
  if (player.current_zone !== player.psiAttuned.zone) { player.psiAttuned = null; return; }

  const cost = abilityCost(player, 'stillness');
  spend(player, cost.resonance, cost.strain);

  const found = residueAt(player.current_zone);
  if (found.length) {
    const pick = found[Math.floor(Math.random() * found.length)];
    const line = proseFor(pick);
    if (line) sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">${voice(player, { low: line, high: line })}</span>` });
  }
  await resolveStrain(player, broadcast);
}
