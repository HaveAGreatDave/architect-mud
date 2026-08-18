/**
 * MUTATIONS — the plugin half.
 *
 * The substrate is engine (server/engine/mutations.js) because combat, describe
 * and senses all read it on hot paths. What lives HERE is everything that is
 * about presentation and policy rather than state: the verb, the trigger tick,
 * the prose an onlooker gets, and the voice the city refuses you in.
 *
 * The split is worth stating because it is what makes the fiction replaceable.
 * The engine knows a mutation is `obvious` at 62% expression on the torso; it
 * has no opinion about what that looks like or how a shopkeeper feels about it.
 * Every string in this file could be rewritten without the engine noticing.
 */
import {
  getMutations, detectMutations, visibilityOf, expressionBandOf,
  checkMutationTrigger, getClothingConflicts, canUseMutagen, consumeMutagen,
  getMutationDef, applyMutagenMutation, addRadiationMutation,
} from '../../server/engine/mutations.js';
import { registerAction } from '../../server/engine/actions.js';
import { hasTag } from '../../server/engine/tags.js';
import { world } from '../../server/engine/world.js';
import { registerEquipGate } from '../../server/engine/equip-gates.js';
import { organCommands } from './organs.js';
import './reactions.js';                      // the social ladder, wired on zone.entered
import { registerThornGate } from './door.js';
import './onset.js';                          // what it costs your body to change, on mutation.gained
import { on } from '../../server/engine/events.js';
import { applyCloneInheritance, undiagnosedMutations } from '../../server/engine/mutations.js';
import { sendToPlayer } from '../../server/engine/messaging.js';

registerThornGate();

// Coming out of the vats. The policy itself is the substrate's (survivesCloning);
// what belongs here is the sentence you read when something did not come back
// with you. Default policy is `all`, so for almost every body this is a no-op.
on('player.respawn', async ({ player }) => {
  if (!player?._mutations?.size) return;
  const lost = await applyCloneInheritance(player);
  if (!lost.length) return;
  sendToPlayer(player.id, {
    type: 'zone_event',
    message: `\n<span class="msg-system">Something did not come back with you. `
      + `${lost.map(m => m.name).join(', ')}: gone, as though it had never been. `
      + `You cannot decide whether to be glad.</span>`,
  });
});

// ── The verb ─────────────────────────────────────────────────────────────────

// Expression as a word, not a number. The percentage is shown too — a player
// tuning a build wants it — but the word is what the sentence is built from,
// because "marked" is a thing you can say out loud and "43%" is not.
const BAND_WORD = {
  latent: 'barely there',
  common: 'mild',
  marked: 'marked',
  strong: 'strong',
  severe: 'severe',
  profound: 'profound',
  legendary: 'total',
};

const VIS_WORD = {
  hidden: 'nothing anyone can see',
  concealable: 'hideable under clothes',
  obvious: 'plain to see',
  extreme: 'unmistakable',
};

function cmdMutations(args, raw, player) {
  const muts = getMutations(player);
  if (!muts.length) {
    return {
      type: 'mutations',
      message: "Nothing has changed about you yet. Give it time in the hot places. Or don't — that's a choice too.",
    };
  }

  const rad = muts.filter(m => m.source !== 'mutagen');
  const wild = muts.filter(m => m.source === 'mutagen');

  let msg = '<span class="skills-header">YOUR BODY</span>\n\n';
  if (rad.length) msg += section('What the rads did', rad, player);
  if (wild.length) msg += section('What you chose', wild, player);

  const vis = visibilityOf(player);
  if (vis === 'obvious' || vis === 'extreme') {
    msg += `<span class="msg-error">People can tell. In Custodian country that is a problem before it is anything else.</span>\n`;
  }
  return { type: 'mutations', message: msg };
}

function section(title, list, player) {
  let out = `<span class="zone-name">${title}</span>\n`;
  for (const entry of list) {
    const m = entry.mutation;
    const band = BAND_WORD[entry.band] || entry.band;

    // UNDIAGNOSED. You know something is wrong; you do not know what. Only ever
    // happens to a mutation you cannot see, because you do not need a physician
    // to tell you your hands have claws on them. A clinic will name it.
    if (!entry.diagnosed) {
      out += `\n  <span class="hit-part">Something unnamed</span> — ${band}\n`;
      out += `    <span class="text-dim">You can feel that it is there and you have no idea what it is. `
           + `A physician could tell you.</span>\n`;
      continue;
    }

    out += `\n  <span class="hit-part">${m.name}</span> — ${band} (${entry.expression}%)`;
    // Held down by medication. The RAW number stays on the line above: a player
    // being medicated needs to see that their 70% is being held at 17%, not be
    // told they have a 17% mutation, which would read as a cure.
    out += entry.suppressed ? ` <span class="text-dim">[suppressed to ${entry.effective}%]</span>\n` : '\n';
    if (m.description) out += `    ${m.description}\n`;
    out += `    Visibility: ${VIS_WORD[entry.visibility] || entry.visibility}\n`;

    const parts = Array.isArray(m.body_parts) ? m.body_parts : [];
    if (parts.length) out += `    Affects: ${parts.join(', ').replace(/_/g, ' ')}\n`;

    const blocked = Array.isArray(m.blocks_slots) ? m.blocks_slots : [];
    if (blocked.length && entry.expression >= 40) {
      out += `    <span class="msg-error">Won't fit: ${blocked.join(', ')}</span>\n`;
    }
    if (m.treatable === false) out += `    <span class="msg-error">No clinic will undo this one.</span>\n`;
  }
  return out + '\n';
}

// ── The trigger ──────────────────────────────────────────────────────────────
//
// The roll itself is the engine's (it owns the eligibility and the expression
// ladder); what's here is the sweep and the announcement. The `radiation < 40`
// pre-check is duplicated from checkMutationTrigger deliberately — it saves a
// function call per player per minute for the overwhelming majority who are
// nowhere near a hot tile, and the engine still refuses on its own.

export const hooks = {
  'tick.minute': async ({ broadcast } = {}) => {
    for (const [playerId, player] of world.players) {
      if ((player.radiation || 0) < 40) continue;
      const got = await checkMutationTrigger(player);
      if (!got || !broadcast) continue;

      const m = got.mutation;
      const band = BAND_WORD[expressionBandOf(got.expression)] || '';
      broadcast(null, {
        type: 'mutation_gained',
        message:
          `\n<span class="rad-warning">⚠ SOMETHING HAS CHANGED: ${m.name}</span>\n` +
          `${m.description || ''}\n` +
          `It has taken hold ${band === 'total' ? 'completely' : `${band}ly`.replace('mildly', 'mildly')} (${got.expression}%). ` +
          `${got.visibility === 'hidden' ? 'Nobody would know to look at you.' : 'You will want to think about what you wear.'}\n`,
      }, null, playerId);
    }
  },

  // The appearance seam. describePlayerAppearance fires this for every look at
  // a body; what we return is one line per mutation the VIEWER can actually
  // detect — which is per-observer, so the Wildblood with the sharpened eyes
  // sees what the barman misses.
  'player.appearanceNotes': ({ target, viewer, isSelf } = {}) => {
    if (!target) return null;
    const seen = detectMutations(viewer || target, target);
    if (!seen.length) return null;

    const lines = [];
    for (const entry of seen) {
      const app = entry.mutation.appearance || {};
      const key = entry.visibility === 'extreme' ? 'extreme'
        : entry.visibility === 'obvious' ? 'obvious' : 'subtle';
      // Fall back down the bands, then to nothing. An unauthored appearance is
      // a valid state — it means the mutation is simply not described, not that
      // the engine invents a sentence for it.
      const text = app[key] || app.obvious || app.subtle || null;
      if (!text) continue;

      if (entry.certain === false) {
        // Caught on acuity alone, through clothing. Hedge — naming it would
        // give away more than the observer actually has.
        lines.push(`<span class="mutation-tag">Something about ${isSelf ? 'you' : 'them'} is not quite right, under the cloth.</span>`);
      } else {
        lines.push(`<span class="mutation-tag">${text}</span>`);
      }
    }
    if (!lines.length) return null;
    // Dedupe: two mutations that both only managed the hedge line read as a bug.
    return [...new Set(lines)].join('\n');
  },
};

// ── The city's voice ─────────────────────────────────────────────────────────

/**
 * How a vendor refuses a visibly mutated customer.
 *
 * Shaped after server/engine/vendor-grudge.js on purpose: the refusal is a
 * STRING this module owns, consulted at the trade funnels, rather than a new
 * gate mechanism. One voice, one place.
 *
 * Only `extreme` refuses outright. `obvious` is served, badly — which is the
 * point of the whole escalation: the city is socially hostile long before it is
 * practically hostile, and a shopkeeper who serves you while making sure you
 * know you are unwelcome is worse to walk past than one who simply says no.
 */
export function mutationRefusal(npc, player) {
  if (visibilityOf(player) !== 'extreme') return null;
  const name = npc?.name || 'The shopkeeper';
  return `${name} looks at you, and keeps looking, and does not move toward the counter. "I'm going to ask you to leave."`;
}

/** The warning line the gear screen shows for a garment this body can't take. */
export function conflictNote(player, item) {
  const conflicts = getClothingConflicts(player, item);
  if (!conflicts.length) return null;
  return conflicts.map(c => `${c.mutation.name} makes this a poor fit.`).join(' ');
}

// ── The mutagen ──────────────────────────────────────────────────────────────
//
// Claims any `mutagen`-tagged item off the engine's `consume.begin` offer, the
// same seam the drinks and drugs plugins use. Returning `{ passthrough: true }`
// declines and lets the ordinary consumable path have it.
//
// THE GATE IS RE-CHECKED HERE AND AGAIN INSIDE consumeMutagen. That is not
// belt-and-braces paranoia, it is the requirement: a verb, a script node, a
// dialogue action and a traded item are four different doors, and a check that
// lives at only one of them is a check somebody can walk around. Refusing here
// means the item is NOT consumed, so buying mutagen early and drinking it in an
// alley gets you nothing but a wasted trip.
registerAction({
  type: 'MUTAGEN_CONSUME',
  handler: async ({ actor: player, params = {} }) => {
    const { item } = params;
    if (!item || !hasTag(item, 'mutagen')) return { passthrough: true };

    const gate = await canUseMutagen(player);
    if (!gate.allowed) {
      // The refusal is in-fiction and does NOT explain the mechanism. A player
      // who has not been through the Quickening should not learn the gate's
      // shape from an error message; they should learn it from the Wildblood.
      return { type: 'error', message: REFUSAL[gate.reason] || REFUSAL.no_ritual };
    }

    const result = await consumeMutagen(player);
    if (!result.ok) {
      return {
        type: 'error',
        message: result.reason === 'nothing_left'
          ? 'You hold it and wait, and your body has nothing left to become. Whatever this was for, it has already happened to you.'
          : 'Something is wrong with it. Nothing happens, and that is somehow worse.',
      };
    }

    const m = result.mutation;
    return {
      type: 'mutation_gained',
      consumed: true,
      message:
        `<span class="rad-warning">You drink it, and for a while you are not sure you are still there.</span>\n\n`
        + `When you come back, there is more of you than there was.\n\n`
        + `<span class="hit-part">${m.name}</span> at ${result.expression}%. ${m.description}\n`,
    };
  },
});

/**
 * GRANT_MUTATION — the authoring seam.
 *
 * Named in docs/proposals/wildblood-stronghold.md as the one net-new mechanic
 * the Wildblood content needed, and this is it: a dialogue node, a quest reward
 * or a script can hand somebody a specific mutation without an engine change.
 *
 * Flat params, like every VINE action:
 *   { "type": "GRANT_MUTATION", "mutation_id": "mut_thornhide", "expression": 45 }
 *
 * `expression` is optional and rolls on the mutation's own ladder when omitted,
 * which is almost always what you want — an authored 90 is a designer deciding
 * something the distribution exists to decide.
 *
 * THE GATE STILL APPLIES. A mutagen-source mutation granted this way goes
 * through `applyMutagenMutation`, which re-checks membership. That is the whole
 * reason this is a thin wrapper rather than a direct call to the substrate: an
 * authored action is a door, and §5 of the design says every door is checked.
 * Radiation-source mutations are ungated, because a script that irradiates you
 * is describing something the world did TO you.
 */
registerAction({
  type: 'GRANT_MUTATION',
  handler: async ({ actor: player, params = {} }) => {
    const id = params.mutation_id || params.mutation || params.id;
    const mutation = id ? getMutationDef(id) : null;
    if (!mutation) return { type: 'error', message: `GRANT_MUTATION: unknown mutation "${id}".` };

    const expression = params.expression != null ? Number(params.expression) : null;

    if ((mutation.source || 'radiation') === 'mutagen') {
      const res = await applyMutagenMutation(player, mutation.id, { expression });
      if (!res.ok) {
        // Authored content asked for something the player has not earned. Refuse
        // in fiction rather than erroring, so a mis-gated node reads as a beat
        // rather than as a bug on the player's screen.
        return { type: 'dialogue_line', text: REFUSAL[res.reason] || REFUSAL.no_ritual };
      }
      return {
        type: 'dialogue_line',
        text: `<span class="hit-part">${mutation.name}</span> takes hold, at ${res.expression}%.`,
      };
    }

    const granted = await addRadiationMutation(player, mutation.id, { expression, source: 'radiation' });
    if (!granted) return { type: 'dialogue_line', text: 'Nothing changes. Whatever that was meant to do, your body has already done it.' };
    return {
      type: 'dialogue_line',
      text: `<span class="rad-warning">${mutation.name}</span> settles into you, at ${granted.expression}%.`,
    };
  },
});

// Why a body refuses the mutagen, said the way the world would say it. Never
// names rep, flags or Inner Circle: the mechanism is the Wildblood's to explain.
const REFUSAL = {
  chromed: 'You get it to your lips and your body will not take it. Whatever the chrome did to you, it closed this door behind it.',
  no_rep: 'You hold the flask and cannot make yourself open it. This was not given to you. Drinking it would be theft of something that is not really a thing.',
  no_ritual: 'You raise it, and stop. You have not been under. Whatever this does, it does it to people who have already been taken apart once, and you have not.',
  no_player: 'Nothing happens.',
};

// ── Clothing conflicts, enforced ─────────────────────────────────────────────
//
// Phase 1 shipped `getClothingConflicts` as a read-only warning and left the
// equip-gate chain empty on purpose. This is the promised one call.
//
// THE RULE: nothing is destroyed and nothing is confiscated. The garment is
// fine, your body is not the shape it was made for, and the game says so in
// those terms. A system that ate your coat when you grew a tail would be
// punishing a player for the content they went and found.
//
// Expression-gated at 40 inside getClothingConflicts, so a lightly expressed
// mutation is an inconvenience you read about on examine and a heavily
// expressed one is a wardrobe problem you have to solve.
registerEquipGate(({ player, item }) => {
  const conflicts = getClothingConflicts(player, item);
  if (!conflicts.length) return null;

  // Tailored gear is the way out, and it is checked HERE rather than inside
  // getClothingConflicts because accommodation is a property of the garment
  // while the conflict is a property of the body. A garment that accommodates
  // every mutation blocking its slot fits.
  const accommodates = new Set(asAccommodationList(item));
  const unmet = conflicts.filter(c => !accommodates.has(accommodationTagFor(c.mutation)));
  if (!unmet.length) return null;

  const c = unmet[0];
  return {
    block: true,
    message: `You get it as far as your ${bodyWordFor(c.slot)} and stop. `
      + `<span class="msg-error">${c.mutation.name} will not go through it.</span> `
      + `The ${item?.name || 'garment'} is not the problem. You are a different shape than it was cut for.`,
  };
}, 'mutations');

/**
 * The accommodation vocabulary. A garment declares which SHAPES it is cut for
 * via the `accommodates` tag; a mutation declares which shape it is.
 *
 * Deliberately a small closed list rather than mutation ids: a coat is made with
 * a slit for a tail, not made for `mut_wb_prehensile_tail` specifically, and a
 * tailor who had to re-cut for every new mutation id would be the per-item
 * authoring trap wearing a different hat.
 */
const ACCOMMODATION = {
  tail: 'TAIL', wing_left: 'WINGS', wing_right: 'WINGS', aux_limb: 'EXTRA_LIMBS',
  head_2: 'LARGE_HEAD',
};

function accommodationTagFor(mutation) {
  for (const part of (Array.isArray(mutation.body_parts) ? mutation.body_parts : [])) {
    if (ACCOMMODATION[part]) return ACCOMMODATION[part];
  }
  // Anything that blocks a slot without growing a named part is bulk: a
  // carapace, a boneplate, a knot of overgrown joints.
  return 'CARAPACE';
}

function asAccommodationList(item) {
  const raw = (item?.tags || item || {}).accommodates;
  return Array.isArray(raw) ? raw.map(String) : (raw ? [String(raw)] : []);
}

const SLOT_WORD = { head: 'head', torso: 'shoulders', hands: 'hands', legs: 'hips', feet: 'feet' };
const bodyWordFor = slot => SLOT_WORD[slot] || 'body';

export const commands = {
  mutations: cmdMutations,
  ...organCommands,
};
