// One-shot content seed for the ambient-life plugin.
//
//   node scripts/seed-ambient-life.mjs
//
// Does two things, both idempotent:
//   1. Flags a curated set of pedestrian street zones with flags.street_life so
//      the routine tick only breathes life into real hubs (never the frozen bay
//      or a quiet apartment). The flag is MERGED into existing flags, not stomped.
//   2. Seeds the `ambient_routines` library — vignettes for all nine categories
//      (kids, drones, buskers, construction, traffic, crews, vendors, arguments,
//      dogs), gated by day-phase / theme / weather / zone, two of them interactive.
//
// Zones are filtered against the live `zones` table, so a stale id is dropped with
// a warning rather than flagging an orphan. A server restart (or /world reload)
// loads the flags into world.zones and the plugin picks up the library at boot.
// Never seeds on boot (deliberate content).
import { query } from '../server/models/db.js';

// ── Street zones (opt in to routine life) ────────────────────────────────────────
// North City street grid (theme 'city') + Marquee exterior, Civic commons, Docks,
// Media plaza (theme 'outdoors'). These are the walkable hubs where players gather.
const STREET_ZONES = [
  'zone_city_west', 'zone_city_north', 'zone_city_south', 'zone_city_east',
  'zone_city_ne', 'zone_city_se', 'zone_city_sw',
  'zone_mq_marquee', 'zone_mq_cathode', 'zone_mq_ember', 'zone_mq_overpass',
  'zone_civ_commons', 'zone_civ_steps',
  'zone_dock_quays', 'zone_dock_wharf', 'zone_dock_fishmarket',
  'zone_media_plaza',
];

// The pedestrian-heavy hubs where placement-sensitive life fits (kids, buskers,
// food carts) — NOT the working docks.
const HUBS = ['zone_city_west', 'zone_city_north', 'zone_mq_marquee', 'zone_civ_commons', 'zone_media_plaza'];

const FAIR = ['clear', 'cloudy', 'overcast', 'haze']; // weather people linger out in

// ── Routine library ──────────────────────────────────────────────────────────────
// { category, themes, zones, phases, weather, lines, loudness, interactive, weight }
// themes/zones/phases/weather empty = "any". loudness>0 → bleeds to neighbours.
// lines: one entry = a one-shot; several = a paced vignette.
const ROUTINES = [
  // 1. Kids playing — daylight, fair weather, in the hubs only.
  { category: 'kids', zones: HUBS, phases: ['day', 'dusk'], weather: FAIR,
    lines: [`A knot of kids tears past, shrieking, chasing a half-flat ball down the pavement.`] },
  { category: 'kids', zones: HUBS, phases: ['day', 'dusk'], weather: FAIR, weight: 60,
    lines: [`Two kids square off over the rules of a game only they understand.`,
            `One shoves the other; both are laughing again before the dust settles.`] },
  { category: 'kids', zones: HUBS, phases: ['day', 'dusk'], weather: FAIR,
    lines: [`A child drags a length of scavenged cable behind them, pretending it's something alive.`] },

  // 2. Delivery drones — anywhere, any time; audible overhead.
  { category: 'drones', loudness: 0.9,
    lines: [`A delivery drone whirs low overhead, rotors buzzing, and banks away to the north.`] },
  { category: 'drones', loudness: 0.9,
    lines: [`A courier drone drops altitude, rakes a doorway with a red needle of light, and moves on.`] },
  { category: 'drones', loudness: 0.9, weight: 60,
    lines: [`A delivery drone descends on a stuttering rotor, a parcel clutched underneath.`,
            `It drops the box on a doorstep, chirps once, and climbs back into the haze.`] },

  // 3. Street musicians — dusk/evening, fair weather, hubs. Plus one interactive busker.
  { category: 'musicians', zones: HUBS, phases: ['day', 'dusk', 'night'], weather: FAIR,
    lines: [`Somewhere close, a busker works a slow, sad tune out of a battered guitar.`] },
  { category: 'musicians', zones: HUBS, phases: ['dusk', 'night'], weather: FAIR,
    lines: [`A street musician taps out a rhythm on an upturned bucket, nodding at no one.`] },
  { category: 'musicians', zones: HUBS, phases: ['day', 'dusk', 'night'], weather: FAIR, interactive: 'tip',
    lines: [`A busker sets up on the corner and coaxes a slow tune from a scarred guitar, open case at her feet.`] },

  // 4. Construction — daytime work; loud, bleeds through walls.
  { category: 'construction', phases: ['day', 'dusk'], loudness: 1.2,
    lines: [`A rivet gun stutters somewhere overhead — three bursts, a pause, three more.`] },
  { category: 'construction', phases: ['day', 'dusk'], loudness: 1.2,
    lines: [`Sparks rain from a scaffold as someone welds a plate back onto the world.`] },
  { category: 'construction', phases: ['day', 'dusk'], loudness: 1.2, weight: 60,
    lines: [`A crane groans as it swings a girder across the gap between two towers.`,
            `Chains snap taut; the girder settles with a boom you feel in your teeth.`] },

  // 5. Traffic — any time; audible.
  { category: 'traffic', loudness: 1.0,
    lines: [`A convoy of cargo haulers grinds past, tyres hissing on wet ferrocrete.`] },
  { category: 'traffic', loudness: 1.0,
    lines: [`An autocab slews around the corner, horn blaring at nothing, and is gone.`] },
  { category: 'traffic', loudness: 1.0,
    lines: [`Traffic thickens for a moment — engines, a horn, the whine of a bad bearing — then thins.`] },

  // 6. Maintenance crews — any time; low, close-range sound.
  { category: 'crews', phases: ['day', 'dusk', 'night'], loudness: 0.6,
    lines: [`A maintenance crew in stained orange hunches over an open junction box, arguing about the wiring.`] },
  { category: 'crews', phases: ['day', 'dusk', 'night'], loudness: 0.6,
    lines: [`Someone in a hardhat hoses grime off a camera housing, swearing steadily.`] },
  { category: 'crews', phases: ['day', 'dusk', 'night'], loudness: 0.6, weight: 60,
    lines: [`A crew jacks open a manhole and feeds a cable reel down into the dark.`,
            `One of them calls a number up; another repeats it back, wrong, twice.`] },

  // 7. Food vendors — mealtimes; calls carry a little. Plus one interactive cart.
  { category: 'vendors', phases: ['day', 'dusk', 'night'], loudness: 0.4,
    lines: [`A vendor calls his wares over the crowd — something fried, something cheap, something 'fresh today'.`] },
  { category: 'vendors', phases: ['day', 'dusk', 'night'],
    lines: [`Steam and the smell of scorched fat roll off a griddle cart down the way.`] },
  { category: 'vendors', zones: HUBS, phases: ['day', 'dusk', 'night'], interactive: 'order',
    lines: [`A food cart rattles up, griddle already smoking. "Skewers! Hot skewers, three credits!"`] },

  // 8. Arguments — evenings mostly; voices carry a room or two.
  { category: 'arguments', phases: ['day', 'dusk', 'night'], loudness: 0.5, weight: 60,
    lines: [`Two voices rise nearby — a disagreement finding its edge.`,
            `"That's not what you said!" one of them snaps. The other laughs, which helps nothing.`,
            `A door slams. The street pretends it heard nothing.`] },
  { category: 'arguments', phases: ['dusk', 'night'], loudness: 0.5, weight: 60,
    lines: [`A couple bicker in a doorway, low and vicious, not caring who hears.`,
            `It stops as suddenly as it started, both of them staring in different directions.`] },
  { category: 'arguments', phases: ['dusk', 'night'], loudness: 0.6,
    lines: [`Somewhere above, a window bangs open and someone screams a name into the street.`] },

  // 9. Dogs barking — any time; carries.
  { category: 'dogs', loudness: 0.8,
    lines: [`A dog barks itself hoarse behind a fence, setting two more off streets away.`] },
  { category: 'dogs', loudness: 0.8,
    lines: [`Something four-legged and unhappy howls in the middle distance.`] },
  { category: 'dogs', loudness: 0.8,
    lines: [`A pack of strays scatters through an alley, snarling over something not worth it.`] },
];

async function seed() {
  // 1. Flag the street zones (merge, don't clobber existing flags).
  const { rows: have } = await query('SELECT id FROM zones WHERE id = ANY($1)', [STREET_ZONES]);
  const present = new Set(have.map(r => r.id));
  const missing = STREET_ZONES.filter(z => !present.has(z));
  if (missing.length) console.warn(`⚠ dropping ${missing.length} unknown street zone(s): ${missing.join(', ')}`);
  const toFlag = STREET_ZONES.filter(z => present.has(z));
  await query(
    `UPDATE zones SET flags = COALESCE(flags, '{}'::jsonb) || '{"street_life":true}'::jsonb WHERE id = ANY($1)`,
    [toFlag]);
  console.log(`✓ Flagged ${toFlag.length} zone(s) with street_life.`);

  // 2. Seed the routine library.
  let n = 0;
  for (const r of ROUTINES) {
    const id = `routine_${r.category}_${++n}`;
    await query(
      `INSERT INTO ambient_routines (id, category, themes, zones, phases, weather, lines, loudness, interactive, weight, sort_order, enabled)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,TRUE)
       ON CONFLICT (id) DO UPDATE SET
         category=EXCLUDED.category, themes=EXCLUDED.themes, zones=EXCLUDED.zones, phases=EXCLUDED.phases,
         weather=EXCLUDED.weather, lines=EXCLUDED.lines, loudness=EXCLUDED.loudness, interactive=EXCLUDED.interactive,
         weight=EXCLUDED.weight, sort_order=EXCLUDED.sort_order, enabled=TRUE`,
      [id, r.category, JSON.stringify(r.themes || []), JSON.stringify(r.zones || []),
       JSON.stringify(r.phases || []), JSON.stringify(r.weather || []), JSON.stringify(r.lines),
       r.loudness || 0, r.interactive || null, r.weight || 100, n]);
  }
  console.log(`✓ Seeded ${ROUTINES.length} ambient routine(s) across 9 categories.`);
  console.log(`\nRestart the server (or /world reload) to load the street_life flags; the plugin loads the library at boot.`);
}

seed().then(() => process.exit(0)).catch(e => { console.error('✗ seed failed:', e); process.exit(1); });
