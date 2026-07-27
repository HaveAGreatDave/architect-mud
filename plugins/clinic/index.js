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

// Tuning. All overridable per-node so a back-alley cutter and a corporate
// trauma bay can charge wildly different money off the same Action.
const DEFAULT_RATE     = 2;    // credits per point of missing HP
const DEFAULT_MINIMUM  = 10;   // nobody opens a sterile pack for less
const DEFAULT_BLEED_FEE = 25;  // surcharge to stop an active bleed
// Per WOUND (docs/proposals/injury-system.md Phase 5). Clearing an injury outright
// is the one thing no field kit can do — they all floor at Bruised — so it is
// surgical work and priced as such, per problem rather than per point of HP.
const DEFAULT_WOUND_FEE = 40;

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
  if (!missing && !bleeding && !wounds) return { missing: 0, bleeding: false, wounds: 0, cost: 0, free: false };

  const rate    = Number(params.rate ?? DEFAULT_RATE);
  const minimum = Number(params.minimum ?? DEFAULT_MINIMUM);
  const bleedFee = bleeding ? Number(params.bleed_fee ?? DEFAULT_BLEED_FEE) : 0;
  const woundFee = wounds * Number(params.wound_fee ?? DEFAULT_WOUND_FEE);
  const authoredFree = params.free === true || params.free === 'true';

  // Close enough and she stops charging you. Deliberately a hard cliff at the
  // top of the ladder rather than an asymptote — "she waves the money away" is a
  // moment; "she charges you 4₵" is a rounding error nobody notices.
  const onTheHouse = authoredFree || (npcId && relationAtLeast(getRelation(player, npcId), 'close'));
  if (onTheHouse) return { missing, bleeding, wounds, cost: 0, free: true };

  const base = Math.max(minimum, Math.ceil(missing * rate)) + bleedFee + woundFee;
  const help = npcId ? relationHelp(player, npcId) : 0;
  return { missing, bleeding, wounds, cost: Math.max(1, Math.round(base * (1 - help))), free: false };
}

registerAction({
  type: 'CLINIC_TREAT',
  handler: async ({ actor, params = {}, context }) => {
    const npcId = params.npc_id || context?.npc?.id || null;
    const { missing, bleeding, wounds, cost, free } = treatmentQuote(actor, params, npcId);

    // No injury = no charge and no state change. This also makes the Action
    // safe to re-render: dialogue fires node actions every time the node is
    // drawn, so a second look at a patched-up player is a free flavour line
    // rather than a second bill.
    if (!missing && !bleeding && !wounds) return { type: 'dialogue_line', text: pick(NOT_HURT) };

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

    const bleedLine = bleeding ? ' She packs the bleed first, hard enough to hurt, and it stops.' : '';
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
      text: `Gloves, light, pressure.${bleedLine}${woundLine} Whatever was wrong with you is closed, cleaned and taped. You come off the table whole.${priceLine}`,
    };
  },
});
