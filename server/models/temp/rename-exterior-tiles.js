/**
 * One-shot: rename the item_hack_deck and rename building-frontage exterior
 * tiles to generic street/area names (so a tile isn't named after one building)
 * with fresh descriptions. Dry-run by default; pass --apply to write.
 */
import 'dotenv/config';
import { query } from '../db.js';

const APPLY = process.argv.includes('--apply');

const ITEM = { id: 'item_hack_deck', name: 'Nexus IX Infiltrator' };

const ZONES = [
  {
    id: 'zone_meridian', name: 'Halcyon Walk',
    desc: "A stretch of cracked pavement the city has forgotten to condemn. Water-stained precast towers lean over it on both sides, their ground floors a monotony of steel-framed glass — most of it dark, a few doors still lit from within. The Meridian's lobby throws a wedge of sick fluorescent light across the walk here, doorman long gone, intercom panel hanging by its wires. Somewhere overhead a window unit drips onto its sill in a slow, patient rhythm.",
  },
  {
    id: 'zone_mq_chrome_court', name: 'Foundry Cut',
    desc: "A short cut between two boom-era towers, narrow enough that the wind funnels through hard enough to sting. Brushed-metal cladding sheets the walls, half of it peeled back to the rust beneath. Chrome Court's entrance stands at the far end — steel letters over the doors, three fallen and re-inked on cardboard — beside a solid brick of painted-over intercoms. The gutter runs with something that was recently oil.",
  },
  {
    id: 'zone_ext_1782953094650', name: 'Signal Yard',
    desc: "A fenced service yard behind the broadcast blocks, floodlit at all hours by lights nobody remembers installing. Coax and power run overhead in fat looms, stapled to anything that will hold them, humming faintly in the wet. KSAB-TV's stage door sits under a dead awning, its ON AIR bulb burned out mid-word so it reads only ON. A satellite dish the size of a paddling pool tilts drunkenly on the roofline, still tracking a bird that stopped answering years ago.",
  },
  {
    id: 'zone_mq_precinct', name: 'Muster Yard',
    desc: "A hard-standing of cracked concrete and painted lines nobody parks between anymore. Floodlights — real, working ones — wash the whole yard in interrogation white, so there is nowhere to stand that isn't seen. Precinct 9 fronts the yard behind a caged sally-port, its charter placard swapped so many times the old bolt holes have merged into one long scar. A departmental drone idles on its pad, optics tracking anything that moves too fast.",
  },
  {
    id: 'zone_mq_cage', name: 'Tin Lane',
    desc: "A dogleg of a service lane roofed in corrugated tin that drums like gunfire whenever it rains, which is always. Every ground-floor window wears its own cage of rebar and welded mesh; commerce here is conducted through slots. The Cage anchors the lane — steel screen floor to ceiling, a clerk somewhere behind it, a shotgun somewhere behind the clerk. A hand-lettered sign promises OPEN and, unusually, means it.",
  },
  {
    id: 'zone_drum_exterior', name: 'Bobbin Cut',
    desc: "A slim pedestrian cut that somehow keeps its dignity in a city this far gone — swept, even, the puddles smaller here than they have any right to be. Storefront glass runs its length, most of it soaped over, one window still dressed and lit. Drum's Fits shows two mannequins in loud, layered outfits that dare you to walk past without looking, a neon thread-spool buzzing pink above the door. The rest of the frontage waits for tenants who aren't coming.",
  },
  {
    id: 'zone_velk_exterior', name: 'Castoff Walk',
    desc: "A cramped walk wedged between two facades in slow structural surrender, close enough to touch both walls at once. What isn't rented out is stacked with other people's abandoned lives — chair legs, dead lamps, a wardrobe with no doors — chained together against the inevitable. Velk's Pre-Owned holds the middle of the walk, its window a chaos of salvaged furniture arranged with a curator's inexplicable pride. Everything smells of damp upholstery and someone else's cigarettes.",
  },
  {
    id: 'zone_powerplantnew', name: 'Coolant Flats',
    desc: "A flat apron of stained concrete where the ground still runs warm underfoot, waste heat bleeding up from whatever's left alive below. Fat coolant mains arc overhead on their gantries, weeping rust-orange at every joint, and the air tastes of hot metal and pond scum. The Coldwater Power Plant looms at the apron's edge behind chain-link and faded RADIATION placards, a turbine somewhere inside grinding on out of sheer habit. Steam ghosts up from a grate and refuses to disperse.",
  },
];

(async () => {
  console.log(APPLY ? '=== APPLYING ===\n' : '=== DRY RUN (pass --apply) ===\n');

  // Guard: refuse if a target new name already exists on a different zone.
  const names = ZONES.map(z => z.name);
  const { rows: clash } = await query(
    `SELECT id, name FROM zones WHERE name = ANY($1) AND id <> ALL($2)`,
    [names, ZONES.map(z => z.id)]);
  if (clash.length) {
    console.log('ABORT — new names collide with existing zones:');
    for (const c of clash) console.log(`  ${c.id}  "${c.name}"`);
    process.exit(1);
  }

  // Item
  const { rows: it } = await query(`SELECT name FROM items WHERE id=$1`, [ITEM.id]);
  console.log(`item ${ITEM.id}: "${it[0]?.name}" -> "${ITEM.name}"`);
  if (APPLY) await query(`UPDATE items SET name=$1 WHERE id=$2`, [ITEM.name, ITEM.id]);

  // Zones
  for (const z of ZONES) {
    const { rows } = await query(`SELECT name FROM zones WHERE id=$1`, [z.id]);
    if (!rows.length) { console.log(`  !! missing zone ${z.id}`); continue; }
    console.log(`\nzone ${z.id}: "${rows[0].name}" -> "${z.name}"`);
    if (APPLY) await query(`UPDATE zones SET name=$1, description=$2 WHERE id=$3`, [z.name, z.desc, z.id]);
  }

  console.log(`\nDone${APPLY ? ' (applied)' : ''}.`);
  process.exit(0);
})();
