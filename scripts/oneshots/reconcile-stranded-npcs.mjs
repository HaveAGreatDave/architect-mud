/**
 * One-shot: return NPCs who are stranded somewhere they cannot work from.
 *
 * WHY THIS EXISTS. `npcs.zone_id` is a runtime column — excluded from content
 * files, so the CODEX deploy structurally cannot carry it. `home_zone` IS
 * content, and it moves: evictions, relocations and housing rebuilds all rewrite
 * where an NPC lives. When those two disagree, the NPC's body is left standing in
 * the old place while their key moves to the new one.
 *
 * Before the egress fix in ai-behaviour.js (`leavingOwnSide`) that was terminal:
 * a locked apartment door they no longer owned sealed them in, GO_TO_WORK retried
 * the same blocked hop forever, and the shop they belonged to simply never opened.
 * Six NPCs were walled in this way on 2026-08-01.
 *
 * With that fix in place an NPC in the wrong room now walks out on its own, so
 * this script is deliberately NARROW: it only relocates an NPC that cannot reach
 * its work zone from where it currently stands BY ANY ROUTE, and only when home
 * is demonstrably better. Everything else it reports and leaves alone.
 *
 * WHY IT CONVERGES (and is not the clamp oneshots.bat forbids). It never forces
 * a tile from a list. It asks the live pathfinder a question about the world as it
 * is now, and acts only on a provable dead end — so an NPC who has legitimately
 * moved somewhere new and CAN still get to work is never dragged home. Once the
 * engine fix has been deployed for one tick cycle this is a permanent no-op.
 *
 * Local:  node scripts/oneshots/reconcile-stranded-npcs.mjs
 * Prod:   node --env-file=.env.prod scripts/oneshots/reconcile-stranded-npcs.mjs
 *
 * Pass --dry-run to report without writing.
 */
import { initWorld, world, resolveLanding } from '../../server/engine/world.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { query } from '../../server/models/db.js';

const DRY = process.argv.includes('--dry-run');

await initWorld();

const reachable = (from, to, npc) => {
  if (!from || !to) return false;
  if (from === to) return true;
  const p = findPath(from, to, npc);
  return !!(p && p.length >= 2);
};

let moved = 0, unreachableFromHomeToo = 0, fine = 0;

for (const npc of world.npcs.values()) {
  if (!npc.work_zone_id || !npc.home_zone || !npc.zone_id) continue;

  const work = resolveLanding(npc.work_zone_id);
  const here = npc.zone_id;
  if (here === work) { fine++; continue; }

  // Can they get to work from where they are? If so there is nothing to repair —
  // they are mid-commute, off shift, or living somewhere new and perfectly able.
  if (reachable(here, work, npc)) { fine++; continue; }

  // They cannot. Is home any better? If home is just as cut off, moving them
  // achieves nothing and would hide a real world-connectivity bug behind a
  // shuffled NPC — report it loudly instead.
  const home = resolveLanding(npc.home_zone);
  if (!reachable(home, work, npc)) {
    console.error(`[stranded] ${npc.name} (${npc.id}): cannot reach ${work} from ${here} OR from home ${home} — world connectivity problem, not a housing one. Left in place.`);
    unreachableFromHomeToo++;
    continue;
  }

  console.log(`[stranded] ${npc.name} (${npc.id}): ${here} -> ${home} (work ${work} unreachable from current tile)`);
  if (!DRY) {
    await query('UPDATE npcs SET zone_id = $1 WHERE id = $2', [npc.home_zone, npc.id]);
  }
  moved++;
}

console.log(`\n[reconcile-stranded-npcs] ${DRY ? '(dry run) would move' : 'moved'} ${moved}; ${unreachableFromHomeToo} unreachable from home too (reported above); ${fine} fine.`);
if (unreachableFromHomeToo) {
  console.log('An NPC unreachable from home as well means its workplace has no way in — check that building\'s facade/entrance exits rather than re-running this.');
}
process.exit(0);
