// plugins/wear/index.js
//
// Repair — the other half of durability. The engine substrate
// (server/engine/durability.js) knows what condition MEANS; this knows what a
// person does about it.
//
// Registered as a SPECIALIZED ACTION, not a command, which is what makes `repair`
// shareable rather than owned: flight's `repair` (a plugin command) runs first,
// self-gates on "am I at a hangar with a craft", and returns undefined in a bar;
// the engine's `repair` builtin targets infrastructure. Different registries, no
// collision, no `after:` needed — SIFT sorts out what you actually pointed at.
//
// ── Two paths, deliberately unequal ──────────────────────────────────────────
//
//   HAND   — your own Fabrication and a repair kit, anywhere. The ceiling rises
//            with skill: a novice tops out at Battered, a real tradesman matches
//            a bench, and only a person can REINFORCE (see below).
//   BENCH  — an NPC who does this for a living. Certain, same-day, EXPENSIVE, and
//            it never leaves the thing better than new. Costs less from someone
//            who knows you (relationHelp) — the point of having a guy.
//
// An item worn to zero DISINTEGRATES — there is no broken-but-repairable state.
// So repair is the only thing standing between a player and losing something they
// cared about, and the warnings that precede it (the Failing band, the fatigue
// line on examine) are load-bearing rather than polite.
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction } from '../../server/engine/actions.js';
import { query } from '../../server/models/db.js';
import { skillCheck, awardSkillUse, effectiveSkill } from '../../server/engine/skills.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getZoneNpcs } from '../../server/engine/world.js';
import { relationHelp } from '../../server/engine/relations.js';
import { getItem } from '../../server/engine/items-cache.js';
import {
  wears, isRepairable, conditionBand, repairItem, destroyItem, effectiveCondition,
  reinforcementOf, REINFORCE_MAX,
} from '../../server/engine/durability.js';

// ── The economics: why you'd use a person instead of a counter ───────────────
//
// Watts is a SERVICE. He is always open, he practically never fails, and he is
// EXPENSIVE. What he cannot sell you at any price is reinforcement — a bench
// restores an item, it never makes it better than it was.
//
// A skilled player CAN. Hand your coat to someone with real Fabrication and a
// masterful roll hands it back tougher than it left the factory (permanent,
// transferable, three deep). That is the whole reason to seek one out, and it is
// deliberately not purchasable: it is somebody's skill, not somebody's stock.
//
// So the choice is real in three directions:
//   Watts        — costly, certain, same day, never better than new
//   a good hand  — cheaper by negotiation, and can leave it BETTER than new
//   a bad hand   — cheapest, and may finish off what was already broken
const FIELD_BASE_CAP = 0.65;       // top of Battered — what an unskilled patch tops out at
const FIELD_BASE_DIFFICULTY = 4;
const BENCH_BASE_DIFFICULTY = 2;   // a professional at a bench, with the right tools
const BOTCH_LOSS = 0.05;           // what a failed repair costs; enough to finish off something already Failing

// Skill lifts the ceiling on hand repair. A competent tradesman is no longer
// doing a "field patch" — at Fabrication 8 they match a bench, and past that the
// cap stops mattering because mastery is doing the work.
export const FIELD_CAP_AT_SKILL = 8;
export function fieldCapFor(skill) {
  const t = Math.max(0, Math.min(1, (Number(skill) || 0) / FIELD_CAP_AT_SKILL));
  return FIELD_BASE_CAP + (1 - FIELD_BASE_CAP) * t;
}

// Reinforcement is gated on BOTH a masterful roll and real skill, so it can't be
// farmed by a novice getting lucky — it has to be someone who actually knows how.
export const REINFORCE_SKILL_MIN = 6;
export const REINFORCE_MARGIN_MIN = 8;

// What a bench charges. Deliberately steep: Watts is the convenient option, and
// convenience is what you're paying for. Relationship discount rides on top —
// the same `relationHelp` scalar the clinic and vendors read, so his regulars
// pay meaningfully less than a stranger off the street.
const REPAIR_RATE = 0.9;           // fraction of item value to restore it from nothing
const REPAIR_MINIMUM = 25;

export function repairQuote(item, condition, help = 0) {
  const missing = Math.max(0, 1 - condition);
  const base = Math.max(REPAIR_MINIMUM, Math.ceil((Number(item?.value) || 10) * REPAIR_RATE * missing));
  return Math.max(1, Math.round(base * (1 - help)));
}

// A repairman is any NPC flagged for it. Content-driven, like every other role.
function repairmanIn(zoneId) {
  return getZoneNpcs(zoneId).find(n => n?.flags?.repairman) || null;
}

async function carriedRepairables(player) {
  const { rows } = await query(
    `SELECT pi.id AS inv_id, pi.item_id, pi.condition, pi.custom_data, pi.is_equipped,
            i.name, i.tags, i.value
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL`,
    [player.id]
  );
  // Only things that wear AND aren't already perfect — "repair" on a pristine
  // jacket should say so, not offer you a bill.
  return rows.filter(r => wears(r));
}

// jsonb comes back parsed, but a hand-written row can still be a string.
const customDataOf = (row) => {
  const v = row?.custom_data;
  if (typeof v !== 'string') return v || {};
  try { return JSON.parse(v); } catch { return {}; }
};

async function hasPatchKit(player) {
  const { rows } = await query(
    `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND jsonb_exists(i.tags, 'repair_kit') LIMIT 1`,
    [player.id]
  );
  return rows.length > 0;
}

// ── The act ──────────────────────────────────────────────────────────────────

async function doRepair(player, row, broadcast) {
  const item = { tags: row.tags, value: row.value };
  const condition = effectiveCondition(row);
  const band = conditionBand(condition);

  if (!isRepairable(row)) {
    return { type: 'error', message: `The ${row.name} isn't something anyone can put right.` };
  }

  // EMP damage is a separate axis from wear: a fried device can be in perfect
  // physical condition and still be a brick. Only a bench can bring one back —
  // you don't re-flash cooked firmware with a patch kit in an alley — and it's
  // handled before the condition checks below precisely because condition has
  // nothing to say about it.
  if (customDataOf(row)?.fried) {
    const shop = repairmanIn(player.current_zone);
    if (!shop) {
      return { type: 'error', message: `The ${row.name} is cooked through — dead firmware, not a dent. You'd need a proper bench and someone who knows what they're looking at.` };
    }
    const price = Math.max(25, Math.round((Number(row.value) || 50) * 0.4 * relationHelp(player, shop.id)));
    if (!(await adjustCredits(player, -price, undefined, 'repair:emp'))) {
      return { type: 'error', message: `${shop.name} turns the ${row.name} over once. "Board's cooked. ${price}₵ to re-flash it. Not a credit less."` };
    }
    await query(
      `UPDATE player_inventory SET custom_data = COALESCE(custom_data, '{}'::jsonb) - 'fried' WHERE id = $1`,
      [row.inv_id || row.id]
    );
    return {
      type: 'repair',
      message: `${shop.name} strips the ${row.name} down, swaps what the pulse took, and hands it back warm. It wakes up. <span class="credits">−${price}₵</span>`,
      refresh: true,
    };
  }

  if (condition >= 0.999) {
    return { type: 'error', message: `The ${row.name} is in perfect shape. Leave it alone.` };
  }

  const npc = repairmanIn(player.current_zone);
  const bench = !!npc;

  if (!bench && !(await hasPatchKit(player))) {
    return { type: 'error', message: `You've nothing to patch the ${row.name} with, and nobody here who could.` };
  }
  const skill = bench ? 0 : await effectiveSkill(player, 'fabrication');
  const handCap = fieldCapFor(skill);
  if (!bench && condition >= handCap) {
    return {
      type: 'error',
      message: skill >= FIELD_CAP_AT_SKILL
        ? `The ${row.name} is as good as it's going to get.`
        : `The ${row.name} is past what your hands and this kit will do. Someone better could take it further.`,
    };
  }

  // Better gear is harder to put right — which is exactly the pressure that makes
  // knowing a good repairman worth something.
  const grade = Math.log10(Math.max(10, Number(row.value) || 10));
  const difficulty = (bench ? BENCH_BASE_DIFFICULTY : FIELD_BASE_DIFFICULTY) + grade + (band.id === 'failing' ? 2 : 0);

  let cost = 0;
  if (bench) {
    cost = repairQuote(item, condition, relationHelp(player, npc.id));
    if (!(await adjustCredits(player, -cost, undefined, 'repair:bench'))) {
      return { type: 'error', message: `${npc.name} looks at the ${row.name}, then at you. "${cost}₵. Come back when you've got it."` };
    }
  }

  // The bench rolls the NPC's competence, not yours — you're paying for their
  // hands. A field repair is your own Fabrication.
  const check = bench
    ? { success: Math.random() < 0.92, margin: 4 + Math.floor(Math.random() * 6) }
    : await skillCheck(player, 'fabrication', difficulty);
  if (!bench) await awardSkillUse(player.id, 'fabrication', check.margin);

  // A failed repair costs progress and, on a bad enough hand, finishes the job:
  // an item already Failing has nothing left to give, and a botch takes it to
  // zero — where it disintegrates like any other worn-out thing. Nothing else in
  // repair can destroy an item, and this can only ever bite on something the
  // game has already told you was on its way out.
  if (!check.success) {
    const after = await repairItem(row, -BOTCH_LOSS);
    if (after.after <= 0) {
      await destroyItem(row);
      return {
        type: 'repair',
        message: `<span class="msg-system">You work at the ${row.name} until something gives that shouldn't have. What's left comes apart in your hands.</span>`,
        refresh: true,
      };
    }
    return { type: 'repair', message: `You make a mess of it. The ${row.name} is no better — a little worse, if anything.` };
  }

  // Margin drives how much you get back. A great roll at a bench leaves it
  // better than serviceable; a scrape gets you working again and no more.
  const quality = check.margin >= REINFORCE_MARGIN_MIN ? 'masterful' : check.margin >= 3 ? 'sound' : 'rough';
  const restore = quality === 'masterful' ? 1 : quality === 'sound' ? 0.6 : 0.3;
  const ceiling = bench ? 1 : handCap;
  const target = Math.min(ceiling, condition + restore);

  // THE payoff for skill, and the one thing a counter cannot sell: a masterful
  // repair by a real tradesman leaves the thing tougher than it was. Bench work
  // never reinforces — Watts restores, he doesn't improve.
  const reinforce = !bench
    && quality === 'masterful'
    && skill >= REINFORCE_SKILL_MIN
    && reinforcementOf(row) < REINFORCE_MAX;

  const result = await repairItem(row, target - condition, {
    quality, reinforce, by: bench ? npc.name : player.handle,
  });

  const mend = result.repairs > 1 ? ` It's been through this ${result.repairs} times now.` : '';
  if (bench) {
    const line = quality === 'masterful'
      ? `${npc.name} takes the ${row.name} away for a while and hands it back as good as it came out of the box.`
      : `${npc.name} works the ${row.name} over and returns it ${result.band.label.toLowerCase()}.`;
    return { type: 'repair', message: `${line}${mend} <span class="credits">−${cost}₵</span>`, refresh: true };
  }
  if (reinforce) {
    return {
      type: 'repair',
      message: `<span class="msg-system">You don't just patch the ${row.name} — you go through it. Seams doubled, stress points backed, the weak spot that was going to fail one day simply gone. It comes out tougher than it went in.</span>${mend}`,
      refresh: true,
    };
  }
  return {
    type: 'repair',
    message: `You work the ${row.name} over — ${result.band.label.toLowerCase()}, and it'll hold.${mend}`,
    refresh: true,
  };
}

// ── Verb ─────────────────────────────────────────────────────────────────────

async function cmdRepair(args, raw, player, broadcast) {
  const q = args.slice(1).join(' ').trim();
  const candidates = await carriedRepairables(player);
  // Nothing of ours here — fall THROUGH (undefined), so the engine's
  // infrastructure repair and flight's craft repair still work normally.
  if (!candidates.length) return undefined;

  if (!q) {
    const worst = candidates
      .filter(r => effectiveCondition(r) < 0.999)
      .sort((a, b) => effectiveCondition(a) - effectiveCondition(b))[0];
    if (!worst) return { type: 'error', message: "Nothing you're carrying needs work." };
    return doRepair(player, worst, broadcast);
  }

  const r = siftResolve(q, candidates);
  if (r.type === 'ambiguous') {
    // Replay through an Action — the builtin replay path can't reach a plugin
    // verb (the SIFT replay trap; same pattern as thievery).
    createSelectionState(player.id, r.candidates, { dispatchType: 'wear.repair_item', dispatchParam: 'candidate' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  if (r.type !== 'match' || !r.candidate) return undefined;   // not ours — fall through
  return doRepair(player, r.candidate, broadcast);
}

registerAction({
  type: 'wear.repair_item',
  handler: async ({ actor, params, context }) => doRepair(actor, params.candidate, context?.broadcast),
});

export const specializedActions = [
  // No requiredTag: what's repairable is DERIVED from the item (weapon / armour /
  // apparel / tool), never authored. The handler self-gates and falls through.
  { verb: 'repair', handler: cmdRepair },
];

export const _test = { repairQuote, fieldCapFor, FIELD_CAP_AT_SKILL, REINFORCE_SKILL_MIN, REINFORCE_MARGIN_MIN };
