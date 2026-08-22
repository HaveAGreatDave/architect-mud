// CLIMBING — the gear half of the impassable-terrain law.
//
// The engine owns the law ("may a body enter this tile"), the property
// (`propsOf(id).climbable`) and the terrain that carries it. It does not know what
// a rope is, and must not: see the ⚠ on `engine:impassable-terrain` in
// server/engine/commands/movement.js and the climb seam in movement-gates.js. The
// engine ASKS; this file answers, in its own words.
//
// ── THE THREE RULES ──────────────────────────────────────────────────────────
//
// 1. IT IS NEVER A ROLL. The rule that governed cliffs for months was that "a wall
//    you can sometimes get over is not a funnel, it is a difficulty check", and
//    that objection survives a gear exemption intact — so there is no skill check
//    anywhere in this file. Carry the gear and you go up; do not and you do not.
//    The Climbing skill scales the COST, the way Swimming scales a stroke. A
//    player who can see a scree slope on the map can plan around it exactly as
//    reliably as they can plan around a road.
//
// 2. THE COST IS PAID ON ARRIVAL, NOT IN THE CHECK. `climbCheck` runs inside the
//    move-gate chain, before anything about the move has committed, and a later
//    gate can still veto the step — so a provider that drained stamina would
//    charge people for climbs they never made. The provider READS (gear, stamina)
//    and `zone.entered` WRITES, which is the same split swimming uses for its
//    stroke and for the same reason.
//
// 3. THE REFUSAL TEACHES. A scree tile that answered "the rock goes up sheer in
//    front of you" would be indistinguishable from the cliff beside it, which
//    would make painting it pointless — the entire value of a drawn route is that
//    the player learns what it is. So the refusals name what is missing and never
//    name a specific item: "the right kit" survives somebody authoring a second
//    kind of rope, and "a coil of Brannock line" does not.
//
// ⚠ NOTHING HERE OPENS A BARE CLIFF. This provider is only ever consulted for a
// tile that already carries `climbable`, which only the scree terrain sets. If you
// find yourself wanting to widen that, widen the PAINT — that is the seam that
// keeps the map honest.

import { query } from '../../server/models/db.js';
import { propsOf } from '../../server/engine/world.js';
import { registerClimbProvider } from '../../server/engine/movement-gates.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { mutationFlag } from '../../server/engine/mutations.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getItem } from '../../server/engine/items-cache.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
// The same wide linear band swimming's stroke uses, and deliberately steeper at
// both ends: a climb is a bigger single act than a stroke, and it is one tile
// rather than a crossing, so the number has to be felt once rather than
// accumulated. At effective skill 0 (a fresh character is ~3) a climb is about a
// third of a full stamina bar; a trained climber pays a fifth of that.
const BASE_CLIMB = 34;   // stamina for one climb at effective skill 0
const MIN_CLIMB  = 7;    // floor — even a Wildblood scrambler pays this
const PER_SKILL  = 2;    // stamina off per point of effective skill

// What it costs THIS body to go up one face. Pure, exported for regress: the
// tuning is the kind of thing somebody will want to assert directly rather than
// infer from a stamina bar after a move.
export function climbCost(eff) {
  return Math.max(MIN_CLIMB, Math.round(BASE_CLIMB - Math.max(0, eff) * PER_SKILL));
}

// ⚠ YOU MUST ARRIVE WITH SOMETHING LEFT. Charging down to exactly zero would put a
// player on a rock face with no stamina, and the tile they just climbed onto is a
// tile they may have to climb back off — so the check demands the cost PLUS a
// reserve. Without it the honest failure mode of this system is somebody stranded
// on a shelf, which is the same stranding the whole feature exists to end.
const RESERVE = 5;

const staminaOf = (p) => p.stamina ?? (p.stamina_max ?? 100);

// Gear carried loose or worn — the same uncontained test the `boat` and
// `rebreather` tags get in the swimming plugin. Rope in a locked footlocker at
// home is not rope you have.
async function hasGear(playerId) {
  const { rows } = await query(
    'SELECT item_id FROM player_inventory WHERE player_id=$1 AND container_id IS NULL', [playerId]
  ).catch(() => ({ rows: [] }));
  return rows.some(r => getItem(r.item_id)?.tags?.climbing);
}

// A body that grew climbing limbs. Folded in as EFFECTIVE SKILL rather than as an
// exemption, for the reason mutations.js gives about webbed hands: a mutation
// makes you better at the thing, it does not excuse you from it. Wings skip this
// path entirely — the engine gate lets them through before it ever asks.
function bodyBonus(player) {
  return (mutationFlag(player, 'claws') ? 3 : 0)
    + (mutationFlag(player, 'extra_limbs') ? 3 : 0);
}

// ── The provider ─────────────────────────────────────────────────────────────
// { ok } | { ok: false, message } — and every message is this plugin's, because
// the engine deliberately has no vocabulary for gear.
registerClimbProvider(async (player, to) => {
  if (!player || !to) return null;
  if (!await hasGear(player.id)) {
    return { ok: false, message: 'The rock is broken enough to climb — you can see the line up it — but not with your bare hands. <span class="text-dim">You would need the right kit.</span>' };
  }
  const eff = await effectiveSkill(player, 'climbing') + bodyBonus(player);
  const cost = climbCost(eff);
  if (staminaOf(player) < cost + RESERVE) {
    return { ok: false, message: 'You get two holds up and your arms tell you the truth. <span class="text-dim">Not with what you have left in you.</span>' };
  }
  return { ok: true };
});

// ── The cost, charged where the body actually arrives ────────────────────────
// Everything above is a READ. This is the only write, and it is deliberately not
// guarded on "did they come from a non-climbable tile" — a scree tile beside
// another scree tile is a second climb, and it should cost like one.
on('zone.entered', async ({ actor: player, opts }) => {
  if (!player) return;
  // A system move — shove, .gohome, a respawn — moves a body without anybody
  // climbing anything. Same named exemption the encumbrance law takes.
  if (opts?.bypassEncumbrance) return;
  const props = propsOf(player.current_zone);
  if (!props?.climbable || props.passable) return;
  // Wings got in without touching rock, so they pay nothing. Checked HERE as well
  // as in the gate because this handler fires for every arrival, not only the ones
  // the provider approved.
  if (mutationFlag(player, 'flight')) return;

  const eff = await effectiveSkill(player, 'climbing') + bodyBonus(player);
  const cost = climbCost(eff);
  player.stamina = Math.max(0, staminaOf(player) - cost);
  sendToPlayer(player.id, { type: 'resource_tick', player_update: { stamina: player.stamina } });
  query('UPDATE players SET stamina=$1 WHERE id=$2', [player.stamina, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'output', message: '<span class="msg-system">You work your way up the loose face, testing every hold, and haul yourself onto it.</span>' });

  // Trained by doing, with no check to take a margin from — so it pays a flat,
  // modest amount. ⚠ awardSkillUse's third argument is a skill-check MARGIN, not
  // an IP amount, and a BIGGER number pays LESS; 0 is the full award for an act
  // that had no difficulty roll behind it.
  awardSkillUse(player.id, 'climbing', 0);
});
