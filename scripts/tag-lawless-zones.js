// One-shot data fix: mark the out-of-city regions as lawless (outside city limits).
//   Run once:  node scripts/tag-lawless-zones.js   (add --dry to preview)
//   Restart the server (or hit /world/reload) after — zone flags are cached at boot.
//
// A zone with flags.lawless has no police apparatus: no witness report there ever
// raises wanted stars (the surveillance plugin's raiseCrime short-circuits on it).
// This is what makes "attack on camera = immediate 4 stars" a city-limits-only rule —
// the wastes, the Redline, the western frontier trek, and the Under are all off-grid.
//
// A data transformation on existing rows (the additive deploy can't touch them), so
// it's a deliberate one-shot per CLAUDE.md. Idempotent: re-running just re-sets the flag.
import { query } from '../server/models/db.js';

// Prefix match against zone id. The policed city core (nc / mq / city / civ / gov /
// corp / media) plus the industrial edge (dock / yard / bay) are deliberately absent.
const LAWLESS_PREFIXES = [
  'zone_waste_',    // The Wastes
  'zone_red_',      // The Redline
  'zone_meat_',     // Redline meat district
  'zone_slag_',     // The Slagworks
  'zone_ashway_',   // The Ashway trek
  'zone_badland_',  // The Badlands
  'zone_deep_',     // The Under — deep warrens
  'zone_under_',    // The Under — commons/landing
  'zone_tunnels',   // The Under — tunnels
];

const dry = process.argv.includes('--dry');

const { rows } = await query('SELECT id, name, flags FROM zones');
const targets = rows.filter(r => LAWLESS_PREFIXES.some(p => r.id.startsWith(p)));

let changed = 0;
for (const z of targets) {
  const flags = z.flags || {};
  if (flags.lawless === true) continue;         // already tagged
  flags.lawless = true;
  changed++;
  if (dry) { console.log(`would tag  ${z.id.padEnd(28)} ${z.name || ''}`); continue; }
  await query('UPDATE zones SET flags=$2::jsonb WHERE id=$1', [z.id, JSON.stringify(flags)]);
  console.log(`✓ lawless  ${z.id.padEnd(28)} ${z.name || ''}`);
}

console.log(`\n${dry ? 'DRY RUN — ' : ''}${changed} zone(s) ${dry ? 'would be' : ''} tagged lawless (of ${targets.length} matched).`);
if (!dry) console.log('Restart the server (or /world/reload) so the zone cache picks it up.');
process.exit(0);
