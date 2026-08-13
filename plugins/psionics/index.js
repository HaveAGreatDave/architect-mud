/**
 * PSIONICS — the verbs.
 *
 * The substrate is server/engine/psionics.js, the vocabulary is
 * server/engine/psionics-abilities.js and resistance is
 * server/engine/psi-resist.js. Read all three before changing anything here; this
 * file is the player-facing half and deliberately holds no rules of its own.
 *
 * ── Phase 1 ─────────────────────────────────────────────────────────────────
 *
 *   psi                     free, no roll — what you are and what you have left
 *   dwell                   the room's residue
 *   dwell <object>          an object's history (the psychometry board)
 *   still                   the posture: slow, perpetual, drains while held
 *   draw <item>             take a thing you could not reach
 *   reach <thing> [verb]    work a mechanism from across the room
 *   press <target> [part]   force, somewhere specific on a body
 *
 * ── Why `dwell` and not `read` ──────────────────────────────────────────────
 *
 * `read` is the obvious name and it is poison. It is not a registered COMMAND
 * anywhere, which makes it look free — but six plugins (bounty, bulletin, jail,
 * jobboard, library, prologue) register it as a SPECIALIZED ACTION, and dispatch
 * runs plugin commands BEFORE specialized actions. Claiming `read` here would
 * silently shadow every wanted board, notice board, charge sheet and book in the
 * game, and the symptom would show up nowhere near this file.
 *
 * `dwell` is also simply the better word: it describes what the player is doing
 * (staying with a thing until it gives something up) without claiming a mechanism,
 * which is the deniability law in prose.js applied to the verb list itself.
 *
 * `psi` costs nothing on purpose. It is the discoverability rung — a newly
 * awakened player needs one verb that always works and always shows them the
 * surface exists, and making the entry verb a dice roll means a player's first
 * experience of the discipline is it not working. Same reasoning as `nullscan`.
 *
 * ── Two rules to preserve ───────────────────────────────────────────────────
 *
 * 1. EVERY LINE GOES THROUGH `voice()`. The deniability law (see prose.js) is the
 *    setting's whole position on whether any of this is real, and a law spread
 *    across forty template strings is a wish rather than a law.
 *
 * 2. TELEKINESIS DELIVERS EXISTING VERBS, IT DOES NOT REIMPLEMENT THEM. `reach`
 *    fires the specialized-action registry. The day somebody writes a bespoke
 *    `psi_open_door` is the day this stops scaling.
 */
import { on } from '../../server/engine/events.js';
import { registerAction } from '../../server/engine/actions.js';
import { setFlag } from '../../server/engine/flags.js';
import { getReputation } from '../../server/engine/ideologies.js';
import { rosterOf } from '../augments/state.js';
import { getMutations } from '../../server/engine/mutations.js';
import { world } from '../../server/engine/world.js';
import { teachVerb, sendToPlayer } from '../../server/engine/messaging.js';
import { effectiveSkill } from '../../server/engine/skills.js';
import {
  psiState, psiRank, psiFocus, psiSecondFocus, hasChosenFocus,
  strainBandOf, forgetPlayer, isAwakened, maxResonance,
} from '../../server/engine/psionics.js';
import {
  getDisciplines, getPsiAbilities, rankAtLeast, RANKS, rankIndex,
} from '../../server/engine/psionics-abilities.js';
import { registerPsiResistor } from '../../server/engine/psi-resist.js';
import { readRoom, readObject, still, stillTick } from './psychometry.js';
import { draw, reach, press } from './telekinesis.js';
import { registerStrainEffects } from './strain.js';
import { wireResidue } from './residue.js';
import { voice } from './prose.js';
import { registerPsiDoor } from './door.js';
import { wireExodusReactions } from './reactions.js';
import { registerPurifier } from './purifier.js';
import {
  registerAegisEffects, registerAegisSoak, wardUpkeep,
  ward, bulwark, redoubt, spark, burn, cascade,
} from './aegis.js';

registerStrainEffects();
registerAegisEffects();
registerAegisSoak();
wireResidue();
registerPsiDoor();
registerPurifier();
wireExodusReactions();

/**
 * A psion's own trained mind resists other psions.
 *
 * Registered here rather than in the engine because it is this plugin's
 * contribution, exactly as mastery's and augments' will be theirs. Note it scales
 * with RANK and not with the skill: holding your own mind shut is a matter of how
 * far along you are, not of how hard you can push outwards.
 */
registerPsiResistor((target) => {
  const rank = psiRank(target);
  if (!rank) return 0;
  return 2 + (RANKS.indexOf(rank) * 0.75);
}, 'psionics');

// ── `psi` — the overview ─────────────────────────────────────────────────────

async function cmdPsi(args, raw, player) {
  if (!isAwakened(player)) return { type: 'error', message: 'Unknown command.' };

  const state = psiState(player);
  const rank = psiRank(player);
  const band = strainBandOf(player);
  const level = await effectiveSkill(player, 'psionics');

  const bar = (v, max, width = 10) => {
    const filled = Math.max(0, Math.min(width, Math.round((v / (max || 1)) * width)));
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  };

  const lines = [
    `<span class="hdr">${rank.toUpperCase()}</span>  <span class="ambient">(Psionics ${level})</span>`,
    `RESONANCE  ${bar(state.resonance, state.max)}  ${Math.round(state.resonance)}/${state.max}`,
    `STRAIN     ${bar(state.strain, 100)}  ${band}`,
  ];

  if (hasChosenFocus(player)) {
    const major = getDisciplines().find(d => d.id === psiFocus(player));
    const minor = getDisciplines().find(d => d.id === psiSecondFocus(player));
    lines.push('');
    lines.push(`MAJOR      ${major ? major.label : '(none)'}`);
    if (minor) lines.push(`MINOR      ${minor.label}`);
    lines.push(`<span class="ambient">Everything outside those costs more, and shows on you.</span>`);
  } else if (rankAtLeast(rank, 'channeler')) {
    lines.push('');
    lines.push(`<span class="ambient">You have not committed to a discipline yet. You will have to.</span>`);
  }

  // What is actually available to you right now — derived from the registry, so
  // a new ability appears here the day it is registered and never needs adding
  // to a list in two places.
  const open = getPsiAbilities().filter(a => rankAtLeast(rank, a.rank));
  if (open.length) {
    lines.push('');
    lines.push(`<span class="ambient">${open.map(a => a.label).join(', ')}</span>`);
  }

  if (!player._flags?.get('taught_psi_dwell')) {
    lines.push('');
    lines.push(`<span class="ambient">(${teachVerb('dwell')} to listen to a room.)</span>`);
  }

  return { type: 'output', message: lines.join('<br>') };
}

// ── `read` — routes to room or object ────────────────────────────────────────

async function cmdDwell(args, raw, player, broadcast) {
  if (!isAwakened(player)) return { type: 'error', message: 'Unknown command.' };
  const target = (args || []).join(' ').trim();
  return target
    ? readObject(player, target, broadcast)
    : readRoom(player, broadcast);
}

async function cmdStill(args, raw, player) {
  if (!isAwakened(player)) return { type: 'error', message: 'Unknown command.' };
  return still(player);
}

async function cmdDraw(args, raw, player, broadcast) {
  if (!isAwakened(player)) return { type: 'error', message: 'Unknown command.' };
  return draw(player, (args || []).join(' ').trim(), broadcast);
}

async function cmdReach(args, raw, player, broadcast) {
  if (!isAwakened(player)) return { type: 'error', message: 'Unknown command.' };
  return reach(player, (args || []).join(' ').trim(), broadcast);
}

async function cmdPress(args, raw, player, broadcast) {
  if (!isAwakened(player)) return { type: 'error', message: 'Unknown command.' };
  return press(player, (args || []).join(' ').trim(), broadcast);
}

/**
 * The psychometry board's resolve hook.
 *
 * The client reports which fragment it focused on and how it went. The server
 * decided the fragment STRENGTHS before the board was ever drawn (see
 * `fragmentsFor`), so a client that lies can only choose which of its own
 * pre-authorised fragments to reveal — it cannot invent one. Same shape as every
 * other minigame in the tree.
 */
async function cmdPsiResolve(args, raw, player) {
  if (!isAwakened(player)) return { type: 'error', message: 'Unknown command.' };
  const [, focus] = args || [];
  const REVEAL = {
    image:    { low: 'A shape, moving. You could not swear to what it was.',
                high: 'You see it: a room like this one, and somebody in a hurry.' },
    emotion:  { low: 'Whoever held this last was not calm.',
                high: 'Fear, and under it something much older and much more tired.' },
    location: { low: 'Somewhere with a hard floor. That is all it will give up.',
                high: 'Somewhere underground, with water running close by.' },
    identity: { low: 'Hands. Nothing about whose.',
                high: 'A person about your height, favouring one leg. No face, and there never will be.' },
  };
  const t = REVEAL[focus] || REVEAL.image;
  return { type: 'output', message: `<span class="ambient">${voice(player, t)}</span>` };
}

// ── Wiring ───────────────────────────────────────────────────────────────────

// Runtime state is per-session by design (see the substrate header) — drop it.
on('player.logout', ({ id }) => { if (id) forgetPlayer(id); });

/**
 * Set the marker the Long Watch reads.
 *
 * `plugins/mastery/purity.js` ships a four-rung regard ladder (pure > psionic >
 * augmented > mutant) whose `isPsionic()` reads `player._psionic`, with a comment
 * saying in as many words: "this is the seam it will arrive on rather than a guess
 * at how it will work: anything that sets the marker lands on the right rung the
 * day that system exists". Today is that day.
 *
 * Note the DIRECTION. Psionics sets a marker; mastery reads it. Nothing in mastery
 * imports anything from here, so the Watch's opinion of you keeps working whether
 * or not this plugin is loaded — which is the same contributor discipline the
 * `tech.targets` and `workspace.provider` seams use.
 */
function markPsionic(player) {
  if (!player) return;
  if (isAwakened(player)) player._psionic = true;
  else delete player._psionic;
}

on('player.login', ({ player }) => { try { markPsionic(player); } catch { /* the Watch can wait */ } });

// ── Aegis / Ergokinesis verbs ────────────────────────────────────────────────

const gated = (fn) => async (args, raw, player, broadcast) => {
  if (!isAwakened(player)) return { type: 'error', message: 'Unknown command.' };
  return fn(player, (args || []).join(' ').trim(), broadcast);
};
// `ward`, `redoubt` and `cascade` take no target.
const gatedSelf = (fn) => async (args, raw, player, broadcast) => {
  if (!isAwakened(player)) return { type: 'error', message: 'Unknown command.' };
  return fn(player, broadcast);
};

export const hooks = {
  'tick.minute': async ({ broadcast } = {}) => {
    for (const [, player] of world.players) {
      if (!player) continue;
      try {
        if (player.psiAttuned) await stillTick(player, broadcast);
        // A ward drains while it stands and collapses at empty — and says so.
        // A shield that vanishes silently is a shield you get killed behind.
        const collapsed = wardUpkeep(player);
        if (collapsed) {
          sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">${collapsed}</span>` });
        }
      } catch (err) { console.error(`psionics tick: ${err.message}`); }
    }
  },
};

// ── PSI_AWAKEN — the authored way in ─────────────────────────────────────────
//
// Psionics is the Exodus's discipline, so this is the seam a quest chain uses to
// open it, and `GRANT_MUTATION`'s rule applies exactly: AN AUTHORED DOOR IS STILL
// A DOOR. The action re-checks Exodus standing rather than trusting the author,
// because a dialogue node is content and content gets copied.
//
// THREE THINGS IT REFUSES, each of which a bare SET_FLAG would have allowed:
//
// 1. A rung that is not on the ladder. `psiRank` runs the stored value through
//    `rankIndex` and returns null for anything unrecognised, so a typo would not
//    error — it would silently leave the player unawakened with a flag that looks
//    set. That is the worst possible failure and it is invisible in the DB.
// 2. Going BACKWARDS. An authored node that re-fires must never demote a
//    dreamwalker to awakened, and quests get re-run in ways nobody predicts.
// 3. Anyone the Exodus have not taken in. Same threshold nullcraft uses.
//
// It says nothing to the player. The deniability law (prose.js) means the moment
// of awakening cannot be announced by the engine — whatever the player is told,
// they are told by the NPC standing in front of them, in a line that claims
// nothing. A system message here would be the game confirming psionics, which is
// the one thing it never does.
const EXODUS = 'ideology_exodus';
const AWAKEN_REP = 200;

registerAction({
  type: 'PSI_AWAKEN',
  handler: async ({ actor, params }) => {
    if (!actor?.id) return { type: 'error', message: 'No one to awaken.' };
    const to = String(params?.rank || 'awakened').toLowerCase();
    if (rankIndex(to) < 0) return { type: 'error', message: `Unknown psi rank: ${to}` };

    if ((await getReputation(actor.id, EXODUS)) < AWAKEN_REP) {
      // Silent, and deliberately so: an authored node that fires for someone who
      // has not done the work should do nothing at all rather than explain
      // itself. The NPC's own prose is the only thing the player ever sees.
      return { type: 'psi', awakened: false, reason: 'standing' };
    }

    // The Purifier is not decoration. This doc's own initiation says the Exodus
    // strip every mutation and augment out of you BEFORE they let you in, and
    // until this check existed that was prose with nothing behind it — a chromed
    // player could walk the chain and awaken with the chair untouched.
    //
    // It reads the two loads directly rather than any purity/standing helper,
    // for the same reason the Long Watch door does: those helpers carry social
    // rungs (former, psionic) that would refuse people who are already clean.
    //
    // Read from the SOURCES (augments' roster, the mutations engine) rather than
    // through mastery's `carriesModification`, which is the same predicate: that
    // would make psionics depend on the Long Watch's plugin for an Exodus rule.
    const carryingChrome = [...(rosterOf(actor)?.values() || [])].some(r => (r?.condition ?? 1) > 0);
    const carryingFlesh = (getMutations(actor) || []).some(m => (Number(m?.expression) || 0) > 0);
    if (carryingChrome || carryingFlesh) {
      return { type: 'psi', awakened: false, reason: 'unclean' };
    }

    const from = psiRank(actor);
    if (from && rankIndex(from) >= rankIndex(to)) {
      return { type: 'psi', awakened: false, reason: 'already', rank: from };
    }

    await setFlag('player', 'psi_rank', to, actor);
    return { type: 'psi', awakened: true, rank: to };
  },
});

export const commands = {
  psi: cmdPsi,
  dwell: cmdDwell,
  still: cmdStill,
  draw: cmdDraw,
  reach: cmdReach,
  press: cmdPress,
  psiresolve: cmdPsiResolve,
  // Aegis
  ward: gatedSelf(ward),
  bulwark: gated(bulwark),
  redoubt: gatedSelf(redoubt),
  // Ergokinesis
  spark: gated(spark),
  burn: gated(burn),
  cascade: gatedSelf(cascade),
};

export const _test = {
  markPsionic,
  cmdPsi, cmdDwell, cmdStill, cmdDraw, cmdReach, cmdPress, cmdPsiResolve,
};
