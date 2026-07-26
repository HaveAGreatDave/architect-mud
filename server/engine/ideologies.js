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
  for (const r of reps) repMap[r.ideology_id] = r.reputation;

  return ideologies.map(f => {
    const rep = repMap[f.id] || 0;
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
  const { rows } = await query(
    'SELECT reputation FROM player_ideology_rep WHERE player_id = $1 AND ideology_id = $2',
    [playerId, ideologyId]
  );

  const currentRep = rows[0]?.reputation || 0;
  const newRep = Math.max(-1000, Math.min(9999, currentRep + delta));
  const oldTier = getTier(currentRep);
  const newTier = getTier(newRep);

  await query(
    `INSERT INTO player_ideology_rep (player_id, ideology_id, reputation, tier)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (player_id, ideology_id) DO UPDATE SET reputation = $3, tier = $4`,
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
export async function getIdeologyDiscount(playerId, ideologyId) {
  const { rows } = await query(
    'SELECT reputation FROM player_ideology_rep WHERE player_id = $1 AND ideology_id = $2',
    [playerId, ideologyId]
  );
  const rep = rows[0]?.reputation || 0;
  const tier = getTier(rep);
  const discounts = { hostile: -0.2, unknown: 0, neutral: 0, known: 0.05, trusted: 0.15, inner_circle: 0.25 };
  return discounts[tier.id] || 0;
}

export async function isIdeologyHostile(playerId, ideologyId) {
  const { rows } = await query(
    'SELECT reputation FROM player_ideology_rep WHERE player_id = $1 AND ideology_id = $2',
    [playerId, ideologyId]
  );
  const rep = rows[0]?.reputation || 0;
  return getTier(rep).id === 'hostile';
}
