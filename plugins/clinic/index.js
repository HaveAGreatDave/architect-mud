// plugins/clinic/index.js
//
// Paid treatment — the other half of a clinic. The medics already SELL supplies
// (an ordinary vendor `__shop__` node); this is the service you walk in for when
// you can't patch yourself: they put you back together and bill you for it.
//
// Deliberately a leaf. Nothing outside this file reads its state, because it
// keeps none: it reads the player's HP, moves credits through the engine's
// economy service, and writes the same `player.hp` / `player.statuses` fields
// every other healing path already writes. The periodic gameLoop save persists
// HP, so there's no DB write of our own.
//
// Authored as a dialogue Action rather than a verb: the price is a *negotiation
// with a person*, and the medic's own tree is where it belongs. Dialogue actions
// arrive FLAT ({action, rate, …}) from the VINE editor, hence `params` fallback
// in dialogue.js — every param below is read off the flat bag.
import { registerAction } from '../../server/engine/actions.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { relationHelp, relationAtLeast, getRelation } from '../../server/engine/relations.js';
import { injuryReport, clearInjuries } from '../injury/index.js';
import { frostbiteReport, clearFrostbite } from '../frostbite/index.js';
import {
  getMutations, treatMutation, VISIBILITY,
  diagnoseMutation, undiagnosedMutations, suppressMutation,
} from '../../server/engine/mutations.js';

// Tuning. All overridable per-node so a back-alley cutter and a corporate
// trauma bay can charge wildly different money off the same Action.
const DEFAULT_RATE     = 2;    // credits per point of missing HP
const DEFAULT_MINIMUM  = 10;   // nobody opens a sterile pack for less
const DEFAULT_BLEED_FEE = 25;  // surcharge to stop an active bleed
// Per WOUND (docs/proposals/injury-system.md Phase 5). Clearing an injury outright
// is the one thing no field kit can do — they all floor at Bruised — so it is
// surgical work and priced as such, per problem rather than per point of HP.
const DEFAULT_WOUND_FEE = 40;
// Per FROSTBITE STAGE. Dearer than a wound, and it should be: a deep case is dead tissue
// that will never thaw on its own, so unlike every other line on this bill it is not
// something the patient could have waited out. It is the only permanent injury in the game,
// and this is the only thing that undoes it.
const DEFAULT_FROST_FEE = 60;
// Worst-first, matching the plugin's own stage order, so the bill scales with the work.
const STAGE_RANK = { frostnip: 1, frostbite: 2, deep_frostbite: 3 };

const NOT_HURT = [
  `She looks you over, unimpressed. "You're fine. Come back when something's open."`,
  `"Nothing on you I'd charge for. Save your money."`,
  `A quick once-over, a shrug. "You'll live. Next."`,
];
const BROKE = [
  `"Credit first, then the table. I've been stiffed by better-dressed corpses than you."`,
  `She glances at your hands, then your eyes. "You can't cover it. I'm sorry — I don't do favours on a Tuesday."`,
];
const pick = (pool) => pool[Math.floor(Math.random() * pool.length)];

// The bill: linear in what's actually wrong with you, floored so a scratch
// isn't free, plus a flat surcharge if they have to stop a bleed first — then
// adjusted by what the medic thinks of you.
//
// `npcId` opts the quote into the relationship discount. A medic who knows you
// charges less; one who's wary of you charges more; someone she's close to gets
// patched for nothing, which is the clearest "she is on your side" the game can
// say without saying it. The minimum floor is applied BEFORE the relationship
// adjustment so a friend can actually get below it — otherwise the floor eats
// exactly the generosity that's supposed to be felt.
export function treatmentQuote(player, params = {}, npcId = null) {
  const missing  = Math.max(0, (player?.hp_max ?? 0) - (player?.hp ?? 0));
  const bleeding = (player?.statuses || []).some(s => s.name === 'bleeding');
  // Wounds are a separate line on the bill. A player can walk in at full HP with
  // a ruined leg — HP and injury are different problems and always were.
  const wounds = injuryReport(player).length;
  // Frostbite is its own line for the same reason wounds are: a player can walk in at full
  // HP, unbled and unwounded, with two dead fingers. Priced per STAGE, so a deep case costs
  // three times a nip — which is also the shape of the work.
  const frost = frostbiteReport(player);
  const frostStages = frost ? (STAGE_RANK[frost.stage] || 0) : 0;
  if (!missing && !bleeding && !wounds && !frostStages) {
    return { missing: 0, bleeding: false, wounds: 0, frost: null, cost: 0, free: false };
  }

  const rate    = Number(params.rate ?? DEFAULT_RATE);
  const minimum = Number(params.minimum ?? DEFAULT_MINIMUM);
  const bleedFee = bleeding ? Number(params.bleed_fee ?? DEFAULT_BLEED_FEE) : 0;
  const woundFee = wounds * Number(params.wound_fee ?? DEFAULT_WOUND_FEE);
  const frostFee = frostStages * Number(params.frost_fee ?? DEFAULT_FROST_FEE);
  const authoredFree = params.free === true || params.free === 'true';

  // Close enough and she stops charging you. Deliberately a hard cliff at the
  // top of the ladder rather than an asymptote — "she waves the money away" is a
  // moment; "she charges you 4₵" is a rounding error nobody notices.
  const onTheHouse = authoredFree || (npcId && relationAtLeast(getRelation(player, npcId), 'close'));
  if (onTheHouse) return { missing, bleeding, wounds, frost, cost: 0, free: true };

  const base = Math.max(minimum, Math.ceil(missing * rate)) + bleedFee + woundFee + frostFee;
  const help = npcId ? relationHelp(player, npcId) : 0;
  return { missing, bleeding, wounds, frost, cost: Math.max(1, Math.round(base * (1 - help))), free: false };
}

registerAction({
  type: 'CLINIC_TREAT',
  handler: async ({ actor, params = {}, context }) => {
    const npcId = params.npc_id || context?.npc?.id || null;
    const { missing, bleeding, wounds, frost, cost, free } = treatmentQuote(actor, params, npcId);

    // No injury = no charge and no state change. This also makes the Action
    // safe to re-render: dialogue fires node actions every time the node is
    // drawn, so a second look at a patched-up player is a free flavour line
    // rather than a second bill.
    if (!missing && !bleeding && !wounds && !frost) return { type: 'dialogue_line', text: pick(NOT_HURT) };

    if (cost > 0 && !(await adjustCredits(actor, -cost, undefined, 'clinic:treatment'))) {
      return { type: 'dialogue_line', text: pick(BROKE) };
    }

    actor.hp = actor.hp_max;
    if (bleeding) actor.statuses = (actor.statuses || []).filter(s => s.name !== 'bleeding');
    // A paid patch-up supersedes whatever kit you'd already cracked on yourself.
    actor.healOverTime = [];
    // The surgical tier: clears wounds OUTRIGHT, including Maimed. Every field
    // kit floors at Bruised, so this is the only thing in the game that makes you
    // whole — which is what makes a clinic a destination rather than a vendor.
    const mended = clearInjuries(actor);
    // The one permanent injury in the game, and the only thing that lifts it. A field kit
    // can walk deep frostbite back to a working hand; nothing but this gives you the hand.
    const thawed = await clearFrostbite(actor);

    const bleedLine = bleeding ? ' She packs the bleed first, hard enough to hurt, and it stops.' : '';
    const frostLine = thawed
      ? ` She takes your hands in hers, turns them over, and does not say anything for a moment. What she does next is slow, and expensive, and you get to keep your fingers.`
      : '';
    const woundLine = mended.length
      ? ` She sets and closes ${mended.map(m => m.partLabel).join(', ')} — unhurried, and it hurts more than the wound did.`
      : '';
    // "She waves it away" is the payoff for being someone she cares about, so it
    // has to read differently from an authored charity node.
    const priceLine = cost > 0
      ? ` <span class="credits">−${cost}₵</span>`
      : (free && npcId && relationAtLeast(getRelation(actor, npcId), 'close')
        ? ' You reach for your credits. She waves it off without looking up.'
        : ' On the house, this once.');
    return {
      type: 'dialogue_line',
      text: `Gloves, light, pressure.${bleedLine}${woundLine}${frostLine} Whatever was wrong with you is closed, cleaned and taped. You come off the table whole.${priceLine}`,
    };
  },
});

// ── Mutation treatment ───────────────────────────────────────────────────────
//
// A separate Action from CLINIC_TREAT, deliberately. Everything above is repair:
// you arrived damaged and you leave as you were. This is not repair, it is
// REVERSAL, and the game has an opinion about it. City medicine looks at a
// mutation and sees a disease to be removed. The Wildblood look at the same
// mutation and see a transformation to be continued. Putting the two on one
// button would make that argument invisible.
//
// It is also the expensive half of a pair. Installing chrome burns every
// mutation off you at once, for free, permanently, and closes the flesh path
// forever (plugins/augments). This bills you per mutation and leaves every door
// open. Two routes at genuinely different prices, which is the whole point.
//
// One course walks expression back by a quarter. Below the visibility floor the
// mutation is gone outright, so a lightly expressed thing is one visit and a
// profound one is a course of treatment you save up for. That gradient is the
// system: the further you have gone, the more it costs to come back.

const DEFAULT_MUT_REDUCE = 25;   // expression points per course

const NO_MUTATION = [
  `She runs the scanner over you twice and shrugs. "Nothing in you I'd bill for. You're as human as you started."`,
  `"There's nothing to take off you. Whatever you think you've got, you haven't."`,
];
const UNTREATABLE = [
  `She looks at it for a long time. "I can't take that off you. Nobody can. I'm sorry."`,
  `"That one's yours now. There's no cutting it out without cutting out a great deal of you with it."`,
];
const CANT_PAY = [
  `"That's surgery, not a plaster. Come back with the money."`,
  `She names the figure and waits. You don't have it, and she can see that you don't.`,
];

/**
 * The bill for walking a mutation back.
 *
 * Superlinear in expression rather than proportional: the authored `treat_cost`
 * is the price of the whole thing, and what you pay for one course scales with
 * how much of it there is to fight. Taking the last quarter off something barely
 * expressed is cheap. Taking the first quarter off something profound is not.
 */
export function mutationTreatmentQuote(player, mutationId, npcId = null, params = {}) {
  const carried = getMutations(player).find(e => e.id === mutationId);
  if (!carried) return { ok: false, reason: 'absent' };
  if (carried.mutation.treatable === false) return { ok: false, reason: 'untreatable', mutation: carried.mutation };

  const reduce = Number(params.reduce ?? DEFAULT_MUT_REDUCE);
  const full = Number(carried.mutation.treat_cost) || 500;
  const share = Math.min(1, reduce / 100);
  // The (expression/100)^1.5 curve is the superlinear part. At 20% expression a
  // course is about a tenth of the full price; at 95% it is most of it.
  const severity = Math.pow(carried.expression / 100, 1.5);
  const base = Math.ceil(full * share * 4 * severity);

  const onTheHouse = npcId && relationAtLeast(getRelation(player, npcId), 'close');
  if (onTheHouse) return { ok: true, cost: 0, free: true, reduce, ...carried };

  const help = npcId ? relationHelp(player, npcId) : 0;
  return { ok: true, cost: Math.max(25, Math.round(base * (1 - help))), free: false, reduce, ...carried };
}

// ── Diagnosis ────────────────────────────────────────────────────────────────
//
// The cheapest thing on the mutation menu, and the only one that changes nothing
// about your body. You are buying a NAME.
//
// It exists because a mutation you cannot see is a mutation you have no way to
// identify: you know something is wrong and that is all you know. Diagnosis is
// deliberately mechanically inert — it does not improve the outcome, because a
// diagnostic that also helped would make not-knowing a penalty rather than an
// information state, and the information IS the product.
const DEFAULT_DIAGNOSE_FEE = 80;

const NOTHING_TO_NAME = [
  `She runs the scanner over you twice. "Everything in you, I can already see from here. There's nothing hiding."`,
  `"You know what you've got. You don't need me to charge you for saying it out loud."`,
];

registerAction({
  type: 'CLINIC_DIAGNOSE',
  handler: async ({ actor, params = {}, context }) => {
    const npcId = params.npc_id || context?.npc?.id || null;
    const unknown = undiagnosedMutations(actor);
    if (!unknown.length) return { type: 'dialogue_line', text: pick(NOTHING_TO_NAME) };

    const base = Number(params.fee ?? DEFAULT_DIAGNOSE_FEE) * unknown.length;
    const help = npcId ? relationHelp(actor, npcId) : 0;
    const free = npcId && relationAtLeast(getRelation(actor, npcId), 'close');
    const cost = free ? 0 : Math.max(20, Math.round(base * (1 - help)));

    if (cost > 0 && !(await adjustCredits(actor, -cost, undefined, 'clinic:diagnose'))) {
      return { type: 'dialogue_line', text: pick(BROKE) };
    }

    const named = [];
    for (const entry of unknown) {
      const got = await diagnoseMutation(actor, entry.id);
      if (got) named.push(got.mutation.name);
    }

    const priceLine = cost > 0 ? ` <span class="credits">−${cost}₵</span>` : ' She waves it off.';
    return {
      type: 'dialogue_line',
      text: `Bloods, a long look at the readout, and a longer pause. `
        + `"Right. ${named.join(', ')}." She writes it down and hands you the slip, `
        + `and the thing you have been carrying without a name has a name now.${priceLine}`,
    };
  },
});

// ── Suppression ──────────────────────────────────────────────────────────────
//
// The middle tier, and the one that makes the mutation economy a choice rather
// than a savings target. Treatment is expensive and permanent; this is cheap and
// wears off. What you are buying is an evening: a body quiet enough to walk into
// a Custodian bar, get served, and get out before it comes back.
//
// It holds the mutation to a quarter of itself, which reaches every derived
// contribution at once (see effectiveExpression in engine/mutations.js). It does
// not stack and re-dosing never shortens a running course.
const DEFAULT_SUPPRESS_FEE = 220;
const DEFAULT_SUPPRESS_HOURS = 6;

registerAction({
  type: 'CLINIC_SUPPRESS',
  handler: async ({ actor, params = {}, context }) => {
    const npcId = params.npc_id || context?.npc?.id || null;

    // Whatever is loudest, which is what somebody asking for this actually wants.
    let targetId = params.mutation_id || null;
    if (!targetId) {
      const carried = getMutations(actor)
        .filter(e => e.mutation.treatable !== false && !e.suppressed)
        .sort((a, b) => VISIBILITY.indexOf(b.visibility) - VISIBILITY.indexOf(a.visibility)
          || b.expression - a.expression);
      targetId = carried[0]?.id || null;
    }
    if (!targetId) {
      return { type: 'dialogue_line', text: `"Nothing on you I can quiet down that isn't quiet already."` };
    }

    const hours = Number(params.hours ?? DEFAULT_SUPPRESS_HOURS);
    const entry = getMutations(actor).find(e => e.id === targetId);
    // Priced off expression like treatment is, but LINEARLY and far cheaper: you
    // are renting quiet, not buying surgery.
    const base = Math.ceil(Number(params.fee ?? DEFAULT_SUPPRESS_FEE) * ((entry?.expression || 50) / 100) * (hours / DEFAULT_SUPPRESS_HOURS));
    const help = npcId ? relationHelp(actor, npcId) : 0;
    const cost = Math.max(30, Math.round(base * (1 - help)));

    if (!(await adjustCredits(actor, -cost, undefined, 'clinic:suppress'))) {
      return { type: 'dialogue_line', text: pick(BROKE) };
    }

    const res = await suppressMutation(actor, targetId, { hours });
    if (!res.ok) {
      await adjustCredits(actor, cost, undefined, 'clinic:suppress:refund');
      return { type: 'dialogue_line', text: `"Not that one. That one I can't touch."` };
    }

    return {
      type: 'dialogue_line',
      text: `The injection goes in slow and cold and it hurts going up your arm. `
        + `Within a minute the ${res.mutation.name} has gone quiet, held down to ${res.effective}% of itself. `
        + `<span class="text-dim">It will come back in about ${hours} hours, and she tells you so.</span>`
        + ` <span class="credits">−${cost}₵</span>`,
    };
  },
});

registerAction({
  type: 'CLINIC_MUTATION_TREAT',
  handler: async ({ actor, params = {}, context }) => {
    const npcId = params.npc_id || context?.npc?.id || null;

    // No id authored on the node means "whatever is worst", which is what a
    // patient actually asks for. Worst = loudest, not most expressed: what sends
    // someone to a clinic is being looked at, not being slightly stronger.
    let targetId = params.mutation_id || null;
    if (!targetId) {
      const carried = getMutations(actor)
        .filter(e => e.mutation.treatable !== false)
        .sort((a, b) => VISIBILITY.indexOf(b.visibility) - VISIBILITY.indexOf(a.visibility)
          || b.expression - a.expression);
      targetId = carried[0]?.id || null;
    }
    if (!targetId) return { type: 'dialogue_line', text: pick(NO_MUTATION) };

    const quote = mutationTreatmentQuote(actor, targetId, npcId, params);
    if (!quote.ok && quote.reason === 'untreatable') return { type: 'dialogue_line', text: pick(UNTREATABLE) };
    if (!quote.ok) return { type: 'dialogue_line', text: pick(NO_MUTATION) };

    if (quote.cost > 0 && !(await adjustCredits(actor, -quote.cost, undefined, 'clinic:mutation'))) {
      return { type: 'dialogue_line', text: pick(CANT_PAY) };
    }

    const name = quote.mutation.name;
    const result = await treatMutation(actor, targetId, { reduce: quote.reduce });
    if (!result.ok) return { type: 'dialogue_line', text: pick(NO_MUTATION) };

    const priceLine = quote.cost > 0
      ? ` <span class="credits">−${quote.cost}₵</span>`
      : ' She waves the money away and does not explain why.';

    if (result.removed) {
      return {
        type: 'dialogue_line',
        text: `It takes hours. When she is finished there is nothing left of the ${name} but a dressing and a great deal of soreness, and in a week there will not be that. You are exactly what you were.${priceLine}`,
      };
    }
    return {
      type: 'dialogue_line',
      text: `She works on the ${name} until she has taken back as much as one session safely can. It is still there, quieter, at ${result.expression}%. She tells you to come back.${priceLine}`,
    };
  },
});
