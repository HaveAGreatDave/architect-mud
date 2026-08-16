/**
 * Bulletin plugin — registers READ as a tag-gated specialized action for
 * furniture carrying the `bulletin` capability. Reading the board shows the
 * server leaderboard: the top 5 survivors ranked by total XP, with ties broken
 * by account age (the older account ranks higher).
 *
 * Total XP mirrors the engine's definition (server/engine/ip.js): the per-skill
 * IP pool (SUM of player_skills.ip) plus players.bonus_xp. statSpent is the
 * implicit cost of raised stats and is NOT subtracted here — the board ranks
 * lifetime XP earned, not Net XP available to spend.
 *
 * The handler self-resolves a named (or any) bulletin furniture in the zone and
 * self-gates on the tag. If none matches it returns undefined to fall through.
 */
import { query } from '../../server/models/db.js';
import { hasTag } from '../../server/engine/tags.js';
import { getZoneFurniture } from '../../server/engine/world.js';

async function readBulletin(args, raw, player) {
  const target = args.join(' ').replace(/^(the)\s+/i, '').trim();

  // Off the world.furniture Map — the room's furniture is already in memory, and
  // this ran a round trip on every `read` to find out what is standing here.
  const here = getZoneFurniture(player.current_zone);
  const needle = target.toLowerCase();
  const furniture = target
    ? here.find(f => (f.name || '').toLowerCase().includes(needle))
    : here.find(f => f.flags && 'bulletin' in f.flags);
  if (!furniture || !hasTag(furniture, 'bulletin')) return undefined; // fall through

  const { rows: leaders } = await query(
    `SELECT p.handle,
            COALESCE(p.bonus_xp, 0) + COALESCE(s.skill_ip, 0) AS total_xp
     FROM players p
     LEFT JOIN (SELECT player_id, SUM(ip) AS skill_ip
                FROM player_skills GROUP BY player_id) s ON s.player_id = p.id
     ORDER BY total_xp DESC, p.created_at ASC
     LIMIT 5`
  );

  const lines = leaders.length
    ? leaders.map((r, i) => `${i + 1}. ${r.handle} — ${Number(r.total_xp)} XP`)
    : ['Nobody has made a mark yet.'];

  return {
    type: 'output',
    message: `[ ${furniture.name.toUpperCase()} — TOP SURVIVORS ]\n${lines.join('\n')}`,
  };
}

export const specializedActions = [
  { verb: 'read', requiredTag: 'bulletin', handler: readBulletin },
];

console.log('[bulletin] Plugin loaded.');
