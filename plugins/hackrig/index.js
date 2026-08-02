/**
 * hackrig plugin — somewhere to learn hacking without dying of it.
 *
 * Every existing `hack` target is a CRIME against something that fights back:
 * an ATM that can electrocute you to death, a safe whose owner never trades with
 * you again, a hololock that reports a burglary. That's correct for the payout
 * they carry, but it means there is no way to get from Hacking 0 to competent
 * except by committing felonies at a skill level that guarantees you fail them.
 *
 * A practice rig is furniture flagged `hack_rig` — a dummy lock panel with a
 * scoreboard and nothing behind it. Same Circuit Breach minigame, same deck
 * requirement, no credits, no crime, no shock. It is a GRINDER, and the thing
 * that stops it being free XP is the deck: a failure burns condition exactly as
 * it would on a real target (server/engine/hack-gear.js), so the skill has a
 * running cost in hardware. Cheap decks are cheap because they die here.
 *
 * ── Why the rig stops teaching you ──────────────────────────────────────────
 *
 * The rig does NOT get harder. YOU do, and that's what retires it.
 *
 * `awardSkillUse`'s third argument is the skill-check MARGIN (see
 * server/engine/hack-gear.js `marginOf`): ip.js rolls
 * `chance = base / (1 + |margin| × scale)`, so you learn most at the edge of
 * your ability and almost nothing from a walkover. Every hack target in the game
 * now scores that way, the rig included — so the rig isn't a special case, it's
 * just the EASIEST target, and easy targets stop paying:
 *
 *   Hacking 2  → margin 0  → ~100%   ← the on-ramp
 *   Hacking 5  → margin 3  → ~14%
 *   Hacking 8  → margin 6  → ~8%     ← a difficulty-5 ATM pays ~14% here
 *   Hacking 12 → margin 10 → ~5%     ← the wall
 *
 * The crossover against a live difficulty-5 target lands around Hacking 3–4.
 * Past that, grinding the rig is strictly worse than going and doing crimes, and
 * the deck you burn doing it is wasted. Nobody has to be told to leave — the
 * numbers evict them, and they keep evicting you all the way up the ladder
 * (ATMs → vaults → police networks) rather than only off the trainer.
 *
 * This is why the rig needs no cap, no daily limit, and no escalating-difficulty
 * knob. Escalation would just move one wall; the shared curve puts a wall behind
 * every target, in the right place, at any Brains score (the brains multiplier
 * rides on top of the same roll).
 */
import { getZoneFurniture } from '../../server/engine/world.js';
import { textRender } from '../../server/engine/minigame.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { hasHackDeck, hackDifficulty, damageHackDeck, marginOf } from '../../server/engine/hack-gear.js';

// Anti-spoof, mirroring every other breach path: the client reports its own
// minigame outcome, so it may only report one the server actually armed.
const _pending = new Map();   // playerId -> { rigId, expires }
const PENDING_TTL_MS = 180 * 1000;

// Short, so grinding stays a grind rather than a wait. This is not a punishment
// lockout like the ATM's five minutes — nothing was alarmed.
const _cooldown = new Map();  // playerId -> ts
const COOLDOWN_MS = 20 * 1000;

const DEFAULT_RIG_DIFFICULTY = 2;

// The rig scores itself with the SAME formula every live breach now uses
// (marginOf in hack-gear.js) — it just reads the snapshot it took at arm time
// instead of re-querying. Nothing about a practice rig is a special case; it's
// simply an easy target, and the shared curve does the rest.
const rigMargin = marginOf;

// Past this gap the roll is under ~10% and a live target pays better — so the
// rig says so, plainly, instead of letting someone burn decks on a dead end.
const OUTGROWN_MARGIN = 5;

// Split from findRig so the selection rule is testable without a live furniture
// cache (the zone→furniture index isn't injectable from a regress run).
function pickRig(furniture, nameHint) {
  const rigs = (furniture || []).filter(f => f.flags && 'hack_rig' in f.flags);
  if (!rigs.length) return null;
  if (!nameHint) return rigs[0];
  const hint = nameHint.toLowerCase();
  return rigs.find(f => f.name?.toLowerCase().includes(hint)) || null;
}

const findRig = (zoneId, nameHint) => pickRig(getZoneFurniture(zoneId), nameHint);

async function cmdHackRig(args, raw, player) {
  const rig = findRig(player.current_zone, args.join(' ').trim() || null);
  // No rig here — return undefined so the other `hack` handlers (vendor safes,
  // shop vaults, hololock doors) still get their shot at the verb.
  if (!rig) return undefined;

  if (!(await hasHackDeck(player.id)))
    return { type: 'error', message: `The ${rig.name} wants a deck on the other end of its leads. You don't have one.` };

  const until = _cooldown.get(player.id) || 0;
  if (Date.now() < until) {
    const secs = Math.ceil((until - Date.now()) / 1000);
    return { type: 'error', message: `The ${rig.name} is still cycling its lock sequence. ${secs}s.` };
  }

  const base = Number.isFinite(rig.flags?.hack_difficulty) ? rig.flags.hack_difficulty : DEFAULT_RIG_DIFFICULTY;
  const skill = await effectiveSkill(player, 'hacking');
  // The deck's penalty is part of what the rig asked of you, so it counts toward
  // the margin — a junk deck genuinely makes a difficulty-2 rig a 4, and keeps
  // teaching you slightly longer than a clean one would.
  const difficulty = await hackDifficulty(player.id, base, DEFAULT_RIG_DIFFICULTY);

  // Snapshot both: the resolve reads them back rather than re-deriving, so what
  // the minigame was actually played against is what scores it.
  _pending.set(player.id, { rigId: rig.id, skill, difficulty, expires: Date.now() + PENDING_TTL_MS });
  return textRender(player, {
    type: 'circuit_hack',
    deviceId: rig.id,
    deviceName: rig.name,
    skill,
    difficulty,
    resolveCmd: 'hackrigresolve',
  });
}

// hackrigresolve <rigId> <1|0> — the Circuit Breach overlay reports its own
// outcome. Authoritative for the result; there's nothing to steal, so there's
// nothing worth spoofing beyond the skill tick the pending-map already gates.
async function cmdHackRigResolve(args, raw, player) {
  const rigId = args[0];
  const win = args[1] === '1';
  if (!rigId) return { type: 'noop' };

  const pending = _pending.get(player.id);
  _pending.delete(player.id);
  if (!pending || pending.rigId !== rigId || Date.now() > pending.expires) return { type: 'noop' };

  const rig = findRig(player.current_zone, null);
  if (!rig) return { type: 'noop' };

  _cooldown.set(player.id, Date.now() + COOLDOWN_MS);

  if (!win) {
    // The rig is harmless. The deck is not — this is the whole cost of the
    // grind, and the only reason a practice target isn't free skill.
    const deckMsg = await damageHackDeck(player.id);
    return { type: 'error', message: `The ${rig.name} buzzes and resets its counter to zero. The scoreboard, helpfully, keeps your score.${deckMsg}` };
  }

  const margin = rigMargin(pending.skill, pending.difficulty);
  await awardSkillUse(player.id, 'hacking', margin);

  // Say so out loud once the rig has stopped being worth the deck it costs.
  // Rule: never let a player grind a dead end without the game telling them.
  const outgrown = margin >= OUTGROWN_MARGIN
    ? `\n<span class="text-dim">The sequence barely holds your attention. There's nothing left for you here — ` +
      `a real lock would teach you more in one go than a week on this thing.</span>`
    : '';

  return {
    type: 'output',
    message: `The ${rig.name} chirps, flashes green, and rolls a fresh lock sequence for the next idiot.${outgrown}`,
  };
}

// Tag-gated on the furniture flag so examining a rig advertises HACK in
// availableActions. The handler self-gates (undefined when no rig is present) so
// a hololock or vendor safe in the same room still claims the verb.
export const specializedActions = [
  { verb: 'hack', requiredTag: 'hack_rig', handler: cmdHackRig },
];

export const commands = { hackrigresolve: cmdHackRigResolve };

export const _test = { pickRig, rigMargin, DEFAULT_RIG_DIFFICULTY, OUTGROWN_MARGIN, COOLDOWN_MS };
