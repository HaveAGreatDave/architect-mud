// One-shot content script: light every vendor shop that was sitting dark.
//
// An audit of vendor shop interiors found 9 that read gloomy/dark at night: all
// already have building power (a junction box from the earlier vendor-utility
// backfill), they simply had no LIT overhead fixture. Two had an overhead that
// was switched off; seven had no fixture at all.
//
// This authors a lit overhead in each (mirroring the dev-panel "add light"
// recipe: object_type='light', light_on=1, light_on_intended=1, power_draw_kw=
// 0.02, flags.is_light) and switches the two off fixtures on. It deliberately
// does NOT use flags.always_lit — these are ordinary powered shops and should go
// dark in a city blackout like everything else; the fixtures draw from the
// building junction box the normal way.
//
// Idempotent by deterministic id (furn_light_<zone>). Re-running only updates.
// Run once:  node scripts/add-shop-lighting.mjs
//   then:    npm run content:export  → review diff → commit → push (CODEX)
import { query } from '../server/models/db.js';

// Shops that already have an overhead fixture — just flip it on.
const TURN_ON = ['zone_velk_shop', 'zone_ration_interior'];

// Shops with no fixture at all — author a themed overhead. lumen tuned to venue:
// ~1200lm → "clear", ~1800 → "bright", ~3000 → "blazing".
const NEW_LIGHTS = [
  { zone: 'zone_casino_interior', name: 'neon canopy', lumens: 3000,
    desc: "Banks of magenta and cyan neon race around the coffered ceiling, and a low chandelier of salvaged fibre-optics rains cold light over the felt. It never dims — the house wants you to see exactly how much you're losing." },
  { zone: 'zone_chemsupply_interior', name: 'fluorescent battens', lumens: 1800,
    desc: 'Rows of caged fluorescent battens hum overhead, flat and shadowless, the better to read hazard labels by. Half the tubes buzz at a frequency that lives behind your eyes.' },
  { zone: 'zone_fence_interior', name: 'counter bulb & LED rope', lumens: 1400,
    desc: 'A single bare bulb over the counter and a string of scavenged LED rope tacked along the shelves — just enough light to appraise the goods, not enough to see how you are being appraised back.' },
  { zone: 'zone_halcyon_lobby', name: 'glass-rod cascade', lumens: 3000,
    desc: 'A cascade of suspended glass rods pours warm corporate light down over the marble, every fixture immaculate and metered. The lobby is never dark; darkness is bad for the brand.' },
  { zone: 'zone_gunshop_interior', name: 'caged sodium fixtures', lumens: 1800,
    desc: 'Caged sodium fixtures bolted to the joists throw a hard amber wash over the racks of hardware. One flickers on a tired ballast, ticking like a countdown.' },
  { zone: 'zone_clinic_interior', name: 'surgical panel lights', lumens: 2000,
    desc: 'Sterile white panel lights flood the room with a flat, merciless glare that leaves nowhere for a wound — or a lie — to hide.' },
  { zone: 'zone_halcyon_concourse', name: 'chasing LED strips', lumens: 2500,
    desc: 'Strips of colour-shift LED chase along the concourse ceiling, washing the shopfronts in restless neon that never quite settles on a single hue.' },
];

for (const zone of TURN_ON) {
  const r = await query(
    `UPDATE furniture SET light_on=1, light_on_intended=1
       WHERE zone_id=$1 AND object_type='light' AND light_type != 'streetlight'`,
    [zone]
  );
  console.log(`ON    ${zone}  (${r.rowCount} fixture(s) switched on)`);
}

for (const L of NEW_LIGHTS) {
  const id = `furn_light_${L.zone}`;
  const { rows: have } = await query('SELECT 1 FROM furniture WHERE id=$1', [id]);
  if (have.length) {
    await query(
      `UPDATE furniture SET light_on=1, light_on_intended=1, lumen_output=$2, description=$3 WHERE id=$1`,
      [id, L.lumens, L.desc]
    );
    console.log(`UPD   ${id}  (${L.lumens}lm)`);
    continue;
  }
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, flags, light_on, light_type,
                            power_draw_kw, light_on_intended, object_type, lumen_output, price, hp, hp_max)
     VALUES ($1,$2,$3,$4,$5::jsonb,1,'overhead',0.02,1,'light',$6,NULL,NULL,NULL)`,
    [id, L.zone, L.name, L.desc, JSON.stringify({ is_light: true, light_type: 'overhead' }), L.lumens]
  );
  console.log(`ADD   ${id}  ${L.name} (${L.lumens}lm) in ${L.zone}`);
}

// Recompute lighting_states.total_lumens for the touched shops so they read
// bright immediately (the cold-start seam: authored lights need one aggregation
// pass). Mirrors resyncAllLightingStates' per-zone upsert.
const touched = [...TURN_ON, ...NEW_LIGHTS.map(L => L.zone)];
for (const zone of touched) {
  const { rows: lc } = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(CASE WHEN light_on=1 THEN COALESCE(lumen_output,0) ELSE 0 END),0)::int AS lm
       FROM furniture WHERE zone_id=$1 AND object_type='light'`, [zone]
  );
  await query(
    `INSERT INTO lighting_states (zone_id,has_emergency_lighting,artificial_light_level,fixture_count,total_lumens)
     VALUES ($1,0,0,$2,$3) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
    [zone, lc[0]?.cnt || 0, lc[0]?.lm || 0]
  );
}
console.log('\nlighting_states resynced for touched shops. Reload the world (/world/reload) or restart so caches pick these up.');
console.log('Next: npm run content:export → review diff → commit → push.');
process.exit(0);
