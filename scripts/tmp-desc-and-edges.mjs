import { query } from '../server/models/db.js';

// ── 1. Rewrite zone_meridian as the building's street frontage (its own text) ──
const meridianDesc =
`The street frontage of The Meridian, a residential tower that outlived the Collapse through pure institutional inertia. Its lower floors are clad in water-stained precast concrete; the ground level is a run of steel-framed glass doors, most still intact, one boarded over with a sheet of ply gone soft at the corners. A brass plaque bolted above the entrance reads THE MERIDIAN — ESTABLISHED 2031, the lettering polished by some optimist's hand. Through the glass you can make out a dim amber lobby and a bank of gutted mailboxes. A dented intercom panel dangles by its wires beside the doors, every call button worn blank. The noise of the district folds around the building and keeps going, indifferent.`;
await query(`UPDATE zones SET description=$1 WHERE id='zone_meridian'`, [meridianDesc]);
console.log('UPDATED zone_meridian description (street frontage).\n');

// ── 2. Map storefront entrance edges for the buildings still needing doors ──
const candidates = [
  'zone_mq_pigeon_bar','zone_mq_sump_bar','zone_mq_grocery','zone_mq_amp_shop',
  'zone_mq_cherry_floor','zone_studio_1782953094650','zone_furniture_store','zone_residential_lobby',
];
for (const id of candidates) {
  const { rows: z } = await query(`SELECT id,name,exits,flags->>'is_interior' interior FROM zones WHERE id=$1`, [id]);
  if (!z.length) { console.log(`${id}: NOT FOUND`); continue; }
  const exits = z[0].exits || {};
  // For each exit, is the target an outdoor/street tile? Show neighbour theme + reverse edge.
  const lines = [];
  for (const [dir, tgt] of Object.entries(exits)) {
    const { rows: n } = await query(`SELECT name, ambient_theme, flags->>'is_interior' interior, exits FROM zones WHERE id=$1`, [tgt]);
    const nb = n[0];
    const reverse = nb ? Object.entries(nb.exits||{}).find(([,t])=>t===id)?.[0] : null;
    lines.push(`      ${dir}→${tgt} (${nb?.name||'?'}) theme=${nb?.ambient_theme} interior=${nb?.interior} reverse=${reverse||'—'}`);
  }
  const { rows: doors } = await query(`SELECT exit_dir,name FROM doors WHERE zone_id=$1`, [id]);
  console.log(`• ${z[0].name} <${id}> interior=${z[0].interior} existingDoors=[${doors.map(d=>d.exit_dir).join(',')||'none'}]`);
  console.log(lines.join('\n'));
}
process.exit(0);
