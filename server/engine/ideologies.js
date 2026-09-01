/**
 * Ideology reputation + the stance/path values model.
 *
 * The four ideologies are the owner-less orgs (is_npc=1): the Ascendants, the
 * Long Watch, the Wildblood, the Exodus. Each declares its position as two things
 * in orgs.flags — a STANCE on the world and a PATH for humanity's future:
 *
 *   stance: 'redeem'   (the world can be saved — stay & resolve)
 *         | 'renounce' (the world is finished — leave & begin)
 *   path:   'machine' | 'flesh' | 'mind'   (three sibling ways to ASCEND)
 *         | 'human'                        (the fourth choice: STAY as we are)
 *
 * A player carries a signed stance (-100 renounce .. +100 redeem) and an affinity
 * toward each path; the ideology they lean toward is the one that best matches both.
 *
 * Tiers: hostile → unknown → neutral → known → trusted → inner_circle
 */
import { query } from '../models/db.js';
import { world, getLivePlayer } from './world.js';

export const REP_TIERS = [
  { id: 'hostile',      min: -1000, max: -200, label: 'Hostile',      color: '#e05555' },
  { id: 'unknown',      min: -200,  max: 0,    label: 'Unknown',      color: '#5a5a70' },
  { id: 'neutral',      min: 0,     max: 200,  label: 'Neutral',      color: '#b8b8cc' },
  { id: 'known',        min: 200,   max: 500,  label: 'Known',        color: '#d4c44a' },
  { id: 'trusted',      min: 500,   max: 900,  label: 'Trusted',      color: '#4caf74' },
  { id: 'inner_circle', min: 900,   max: 9999, label: 'Inner Circle', color: '#7b68ee' },
];

// The four paths. machine/flesh/mind are siblings (ASCEND); human is STAY.
export const PATHS = ['machine', 'flesh', 'mind', 'human'];
export const STANCE_DIR = { redeem: 1, renounce: -1 };

export function getTier(rep) {
  for (let i = REP_TIERS.length - 1; i >= 0; i--) {
    if (rep >= REP_TIERS[i].min) return REP_TIERS[i];
  }
  return REP_TIERS[0];
}

// Optional third dimension: on the MACHINE path, does technology serve the
// Architect ('architect') or humanity ('human')? It exists only to separate two
// orders that share a (stance, path) cell — the Ascendants (redeem·machine·
// architect) from the Prometheans (redeem·machine·human). Absent on non-machine
// orders. Carried as data now; NOT yet scored by classifyLean (see below).
export const AUTHORITY = ['architect', 'human'];

// Pure: the (stance, path[, authority]) profile an ideology declares in flags.
export function profileFromFlags(flags) {
  const stance = flags?.stance, path = flags?.path;
  if (!STANCE_DIR[stance] || !PATHS.includes(path)) return null;
  const authority = AUTHORITY.includes(flags?.authority) ? flags.authority : null;
  return { stance, path, authority };
}

// Pure: which ideology a player leans toward. `stance` is -100..100; `pathAff`
// is { machine, flesh, mind, human } affinity counts; `ideologies` each carry a
// `profile`. Score = stance agreement (-1..1) + normalized path affinity (0..1);
// highest wins. Returns null until the player has actually taken a position.
//
// Expansion orders are shown in the app as a preview but never win the lean —
// they are not mechanically live, and (Ascendants vs Prometheans) the plain
// stance+path score can't yet tell two orders in one cell apart. So they're
// skipped here.
//
// EXPANSION FOLLOW-UP (authority axis): once an expansion order goes live, two
// orders will share the redeem·machine cell (Ascendants vs Prometheans) and this
// scorer will tie between them. To resolve, add a signed player `authority_axis`
// flag (architect −100 .. +100 human) + an ADJUST_AUTHORITY action (mirror
// ADJUST_STANCE in plugins/ideologies), and add a small authority-agreement term
// here for machine-path orders that declare `profile.authority`.
export function classifyLean(stance, pathAff, ideologies) {
  const totalPath = PATHS.reduce((s, p) => s + (pathAff[p] || 0), 0);
  if (!stance && !totalPath) return null;
  let best = null, bestScore = -Infinity;
  for (const ideo of ideologies) {
    if (!ideo.profile || ideo.expansion) continue;
    const dir = STANCE_DIR[ideo.profile.stance] || 0;
    const stanceScore = (stance / 100) * dir;
    const pathScore = totalPath ? (pathAff[ideo.profile.path] || 0) / totalPath : 0;
    const score = stanceScore + pathScore;
    if (score > bestScore) { bestScore = score; best = ideo; }
  }
  return best;
}

// ── Standing is maintained, not banked ───────────────────────────────────────
//
// Reputation slides back toward a RESTING POINT over time. Two consequences,
// both deliberate:
//
//   • Positive standing decays. Being Trusted is something you keep being, not
//     something you did once. Stop showing up for an order and you drift back
//     to being nobody in particular.
//   • Negative standing ALSO decays. A grudge is not a life sentence; the
//     street forgets. You can burn a bridge and, given long enough, walk back
//     across it — which is what keeps a bad early decision from permanently
//     closing off a quarter of the game's content.
//
// The exception is the one the fiction demands: if you are MAJORLY, IDEOLOGICALLY
// opposed to an order — you've taken the opposite side of the stance axis AND
// committed to a different path — the drift stops short of neutral. They don't
// hate you personally forever, but they never forget what you are. That's a
// floor, not a sentence: you can still climb out of it by acting, the world just
// won't do the climbing for you.
//
// Lazy, like relations.js: computed from `updated_at` on read, no sweep tick.
// An offline player costs nothing and comes back to standing that has cooled.
const REP_HALFLIFE_DAYS = 30;
const OPPOSED_FLOOR = -200;      // the top of Hostile / bottom of Unknown
const OPPOSED_STANCE_MIN = 50;   // how committed you have to be for it to count
const DAY_MS = 86_400_000;

// ── The arc raises the floor ────────────────────────────────────────────────
//
// ⚠ THE ORIGINAL MODEL WAS A LEAK WITH NO TAP. Positive standing decayed toward
// zero and NOTHING repeatable paid ideology rep, so an order could be joined but
// never lived in: you climbed the forty-slot arc once and then watched it drain.
// The documented answer was favour quests — repeatable work that pays rep — but
// that makes maintaining standing a chore, and standing you already earned by
// doing an order's work should not need re-earning by doing it again.
//
// So the arc moves the RESTING POINT rather than paying rep. Both halves of the
// original design survive intact, which is the reason to do it here:
//
//   • What the arc earned you never drains. The arc is a record of what you did,
//     and the floor is where that record leaves you.
//   • Everything ABOVE that floor still decays, so "being Trusted is something
//     you keep being" is still true of deeds — it just stops being true of the
//     rite you passed a year ago.
//   • The opposed floor and the forgiveness curve are untouched; they are the
//     same function doing the same thing.
//
// ⚠ IT IS KEYED ON THE ARC FLAG, AND THAT IS WHAT MAKES LEAVING WORK. `lapse.js`
// already clears `asc_arc` when you walk away from the Ascendants, so the floor
// walks away with it — no second flag, no bespoke teardown, and renounce gets the
// same behaviour for free when it is built. A floor keyed on anything else would
// have needed every exit path to remember to lower it.
//
// The ceiling stops one tier short of the top ON PURPOSE: the arc can rest you at
// Trusted, never at Inner Circle. The last tier is the one you have to be holding
// right now, which keeps a maintained relationship meaningful at exactly the
// point where the mechanical rewards are richest.
const ARC_RESTING_BASE = 200;    // the rite (slot 10) rests you at Known
const ARC_RESTING_STEP = 150;    // ...and each rank of six is one step up
const ARC_RESTING_CAP = 800;     // ...stopping below Inner Circle (900). Deliberate.
const ARC_RITE_SLOT = 10;
const ARC_RANK_SLOTS = 6;

/**
 * Where an order's own arc leaves you standing, for ever. Pure.
 *
 * Slots 1–9 are worth nothing here by design: they are the movements where the
 * order is still measuring you, and a floor before the rite would pay a player
 * for work they did without ever committing.
 */
export function arcResting(arcSlot = 0) {
  const slot = Number(arcSlot);
  if (!Number.isFinite(slot) || slot < ARC_RITE_SLOT) return 0;
  const ranks = Math.floor((slot - ARC_RITE_SLOT) / ARC_RANK_SLOTS);
  return Math.min(ARC_RESTING_CAP, ARC_RESTING_BASE + ranks * ARC_RESTING_STEP);
}

/**
 * Where this player's standing with this order settles if nothing else happens.
 * Pure. `playerProfile` is `{ stance, path }` — an unknown profile always rests
 * at neutral, so the default behaviour without any player commitment is "slides
 * back to zero", which is the normal case.
 */
export function restingRep(orgProfile, playerProfile, arcSlot = 0) {
  const earned = arcResting(arcSlot);
  if (!orgProfile || !playerProfile) return earned;
  const dir = STANCE_DIR[orgProfile.stance] || 0;
  const stance = Number(playerProfile.stance) || 0;
  // Opposed on the axis: you're committed, and committed the OTHER way.
  const stanceOpposed = dir !== 0 && Math.abs(stance) >= OPPOSED_STANCE_MIN && Math.sign(stance) === -dir;
  // ...and you've picked a different answer to what we should become. Either
  // alone is a disagreement; both together is being a different kind of thing.
  const pathOpposed = !!playerProfile.path && playerProfile.path !== orgProfile.path;
  const opposed = (stanceOpposed && pathOpposed) ? OPPOSED_FLOOR : 0;
  // ⚠ The arc WINS over the opposed floor, and it has to. A player can pass an
  // order's rite and later drift to the opposite stance without ever leaving —
  // the Ascendants do not stop being your order because you started answering a
  // survey differently. What ends the arc floor is leaving, which clears the flag.
  //
  // ⚠ NOT `Math.max(earned, opposed)`. With no arc that is `max(0, -200)` = 0,
  // which deletes the opposed floor for every player who never started an arc —
  // i.e. almost all of them. Regress caught it: "an opposed player never fully
  // recovers" is the case, and it is the one this whole floor exists for.
  return earned > 0 ? earned : opposed;
}

/** Pure. Move `rep` toward `resting` by elapsed time. Never crosses it. */
export function decayRep(rep, updatedAtSec, resting = 0, now = Date.now()) {
  const value = Number(rep) || 0;
  const last = (Number(updatedAtSec) || 0) * 1000;
  if (!last) return value;                       // never stamped — leave it alone
  const days = Math.max(0, (now - last) / DAY_MS);
  if (days < 1) return value;                    // sub-day drift is noise
  return resting + (value - resting) * Math.pow(0.5, days / REP_HALFLIFE_DAYS);
}

// The player's own position, hydrated once at login and read from the live
// object thereafter — the same read-tier treatment relations.js gets, and for
// the same reason: `restingRep` is consulted on every vendor price lookup, and
// five flag round trips there would be indefensible.
const PROFILE_FLAGS = ['stance_axis', ...PATHS.map((p) => `path_${p}`)];

// Which flag holds each order's arc progress, from `orgs.flags.arc_flag` —
// authored data, exactly as `flags.role` is, so a new order's arc needs no code
// change here. An order with no arc built yet simply has no key, and contributes
// no floor. Sync: world.orgs is boot-loaded.
function arcFlagsByOrg() {
  const out = [];
  for (const o of world.orgs.values()) {
    if (o?.is_npc === 1 && o.flags?.arc_flag) out.push({ orgId: o.id, key: String(o.flags.arc_flag) });
  }
  return out;
}

export async function hydrateIdeologyProfile(player) {
  player._ideologyProfile = { stance: 0, path: null };
  player._ideologyArcs = {};
  if (!player?.id) return;
  try {
    // ONE round trip for the profile and every arc. `restingRep` is consulted on
    // every vendor price lookup, so the arc slot has to be sitting on the live
    // player object beside the profile — a flag read per order at price time is
    // the exact cost the profile cache exists to avoid.
    const arcs = arcFlagsByOrg();
    const { rows } = await query(
      'SELECT flag_key, flag_value FROM player_flags WHERE player_id = $1 AND flag_key = ANY($2)',
      [player.id, [...PROFILE_FLAGS, ...arcs.map((a) => a.key)]]
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.flag_key, Number(r.flag_value) || 0]));
    let path = null, best = 0;
    for (const p of PATHS) if ((byKey[`path_${p}`] || 0) > best) { best = byKey[`path_${p}`]; path = p; }
    player._ideologyProfile = { stance: byKey.stance_axis || 0, path };
    for (const a of arcs) player._ideologyArcs[a.orgId] = byKey[a.key] || 0;
  } catch (err) {
    // Standing that can't read your position rests at neutral — degraded, never
    // broken, and never a reason to fail a login.
    console.error(`[ideologies] profile hydrate failed for ${player.id}: ${err.message}`);
  }
}

// Sync. Falls back to "no position taken" for an offline player, which rests
// everything at neutral — the normal case, and a safe one.
function ideologyProfile(playerId) {
  return getLivePlayer(playerId)?._ideologyProfile || { stance: 0, path: null };
}

// Sync, same treatment. An offline player has no cached arcs, which rests them at
// the un-earned floor — the same degraded-never-broken fallback the profile takes.
function ideologyArc(playerId, orgId) {
  if (!orgId) return 0;
  return getLivePlayer(playerId)?._ideologyArcs?.[orgId] || 0;
}

// Decay one stored row. Shared by the three single-order readers below, each of
// which JOINs `orgs` so the profile comes back in the same round trip.
function currentRep_(row, playerId, orgId = null) {
  if (!row) return 0;
  const resting = restingRep(profileFromFlags(row.flags), ideologyProfile(playerId), ideologyArc(playerId, orgId));
  return decayRep(row.reputation || 0, row.updated_at, resting);
}

export async function getPlayerIdeologyRep(playerId) {
  // Ideologies live in the unified orgs table as NPC (is_npc=1) rows. All are
  // returned so the Ideology app can show the whole landscape, but each is
  // tagged `expansion` (flags.expansion = true) — expansion orders are a preview
  // of what's coming: they render with an "emerging" badge, they never win the
  // lean (see classifyLean), and no mechanics hang off them yet.
  // TO ACTIVATE an expansion order: drop `"expansion": true` from its
  // content/orgs/ideology_*.json (and see the authority-axis note above).
  const { rows: ideologies } = await query(
    'SELECT id, name, description, color, flags FROM orgs WHERE is_npc = 1'
  );
  const { rows: reps } = await query(
    'SELECT * FROM player_ideology_rep WHERE player_id = $1', [playerId]
  );
  const repMap = {};
  for (const r of reps) repMap[r.ideology_id] = r;

  const profile = ideologyProfile(playerId);
  return ideologies.map(f => {
    // What the row says, aged forward to now. The stored number is a checkpoint,
    // not the truth — see the decay note above.
    const row = repMap[f.id];
    const rep = row ? Math.round(decayRep(row.reputation || 0, row.updated_at, restingRep(profileFromFlags(f.flags), profile))) : 0;
    const tier = getTier(rep);
    return {
      id: f.id, name: f.name, description: f.description,
      color: f.color, profile: profileFromFlags(f.flags),
      expansion: f.flags?.expansion === true,
      reputation: rep, tier: tier.id,
      tier_label: tier.label, tier_color: tier.color,
    };
  });
}

export async function adjustReputation(playerId, ideologyId, delta, reason = '') {
  // JOIN the order so decay can be applied in the same round trip the read
  // already costs. Decay must land BEFORE the delta, or a player who's been away
  // has their stale standing resurrected by the act of earning one more point.
  const { rows } = await query(
    `SELECT r.reputation, r.updated_at, o.flags
       FROM player_ideology_rep r LEFT JOIN orgs o ON o.id = r.ideology_id
      WHERE r.player_id = $1 AND r.ideology_id = $2`,
    [playerId, ideologyId]
  );

  const currentRep = Math.round(currentRep_(rows[0], playerId, ideologyId));
  const newRep = Math.max(-1000, Math.min(9999, currentRep + delta));
  const oldTier = getTier(currentRep);
  const newTier = getTier(newRep);

  // The write is also the decay checkpoint: `updated_at` restarts the clock, and
  // the value it stamps is the already-decayed one, so drift is never double-counted.
  await query(
    `INSERT INTO player_ideology_rep (player_id, ideology_id, reputation, tier, updated_at)
     VALUES ($1, $2, $3, $4, EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (player_id, ideology_id) DO UPDATE
       SET reputation = $3, tier = $4, updated_at = EXTRACT(EPOCH FROM NOW())`,
    [playerId, ideologyId, newRep, newTier.id]
  );

  const tieredUp = newTier.id !== oldTier.id;
  return {
    ideology_id: ideologyId,
    old_rep: currentRep, new_rep: newRep,
    delta, tiered_up: tieredUp,
    old_tier: oldTier.id, new_tier: newTier.id,
    new_tier_label: newTier.label,
    reason,
  };
}

// Rep effects on gameplay
/**
 * The player's CURRENT standing with one order — decayed to now.
 *
 * Use this, never a raw `SELECT reputation`: the stored number is a checkpoint,
 * not the truth, and a reader that skips the decay is a split source (a door
 * that stays shut for standing the ideology app already shows as recovered).
 */
export async function getReputation(playerId, ideologyId, { nullIfUnknown = false } = {}) {
  const { rows } = await query(
    `SELECT r.reputation, r.updated_at, o.flags
       FROM player_ideology_rep r LEFT JOIN orgs o ON o.id = r.ideology_id
      WHERE r.player_id = $1 AND r.ideology_id = $2`,
    [playerId, ideologyId]
  );
  // `nullIfUnknown` distinguishes "no history with this order" from "history that
  // nets to zero" — dialogue mood uses it to stay untinted rather than render a
  // neutral badge at every faction NPC you've never dealt with.
  if (!rows.length && nullIfUnknown) return null;
  return Math.round(currentRep_(rows[0], playerId, ideologyId));
}

export async function getIdeologyDiscount(playerId, ideologyId) {
  const { rows } = await query(
    `SELECT r.reputation, r.updated_at, o.flags
       FROM player_ideology_rep r LEFT JOIN orgs o ON o.id = r.ideology_id
      WHERE r.player_id = $1 AND r.ideology_id = $2`,
    [playerId, ideologyId]
  );
  const tier = getTier(currentRep_(rows[0], playerId, ideologyId));
  const discounts = { hostile: -0.2, unknown: 0, neutral: 0, known: 0.05, trusted: 0.15, inner_circle: 0.25 };
  return discounts[tier.id] || 0;
}

export async function isIdeologyHostile(playerId, ideologyId) {
  const { rows } = await query(
    `SELECT r.reputation, r.updated_at, o.flags
       FROM player_ideology_rep r LEFT JOIN orgs o ON o.id = r.ideology_id
      WHERE r.player_id = $1 AND r.ideology_id = $2`,
    [playerId, ideologyId]
  );
  // Reads the DECAYED value, which is the whole point: an order that wanted you
  // dead a season ago has cooled to merely not liking you, without anyone
  // running a job to make that true.
  return getTier(currentRep_(rows[0], playerId, ideologyId)).id === 'hostile';
}
