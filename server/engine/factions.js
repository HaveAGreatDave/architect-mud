/**
 * Faction reputation system.
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

function getTier(rep) {
  for (let i = REP_TIERS.length - 1; i >= 0; i--) {
    if (rep >= REP_TIERS[i].min) return REP_TIERS[i];
  }
  return REP_TIERS[0];
}

export async function getPlayerFactionRep(playerId) {
  const { rows: factions } = await query('SELECT * FROM factions');
  const { rows: reps } = await query(
    'SELECT * FROM player_faction_rep WHERE player_id = $1', [playerId]
  );
  const repMap = {};
  for (const r of reps) repMap[r.faction_id] = r.reputation;

  return factions.map(f => {
    const rep = repMap[f.id] || 0;
    const tier = getTier(rep);
    return {
      id: f.id, name: f.name, description: f.description,
      color: f.color, reputation: rep, tier: tier.id,
      tier_label: tier.label, tier_color: tier.color,
    };
  });
}

export async function adjustReputation(playerId, factionId, delta, reason = '') {
  const { rows } = await query(
    'SELECT reputation FROM player_faction_rep WHERE player_id = $1 AND faction_id = $2',
    [playerId, factionId]
  );

  const currentRep = rows[0]?.reputation || 0;
  const newRep = Math.max(-1000, Math.min(9999, currentRep + delta));
  const oldTier = getTier(currentRep);
  const newTier = getTier(newRep);

  await query(
    `INSERT INTO player_faction_rep (player_id, faction_id, reputation, tier)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (player_id, faction_id) DO UPDATE SET reputation = $3, tier = $4`,
    [playerId, factionId, newRep, newTier.id]
  );

  const tieredUp = newTier.id !== oldTier.id;
  return {
    faction_id: factionId,
    old_rep: currentRep, new_rep: newRep,
    delta, tiered_up: tieredUp,
    old_tier: oldTier.id, new_tier: newTier.id,
    new_tier_label: newTier.label,
    reason,
  };
}

// Rep effects on gameplay
export async function getFactionDiscount(playerId, factionId) {
  const { rows } = await query(
    'SELECT reputation FROM player_faction_rep WHERE player_id = $1 AND faction_id = $2',
    [playerId, factionId]
  );
  const rep = rows[0]?.reputation || 0;
  const tier = getTier(rep);
  const discounts = { hostile: -0.2, unknown: 0, neutral: 0, known: 0.05, trusted: 0.15, inner_circle: 0.25 };
  return discounts[tier.id] || 0;
}

export async function isFactionHostile(playerId, factionId) {
  const { rows } = await query(
    'SELECT reputation FROM player_faction_rep WHERE player_id = $1 AND faction_id = $2',
    [playerId, factionId]
  );
  const rep = rows[0]?.reputation || 0;
  return getTier(rep).id === 'hostile';
}
