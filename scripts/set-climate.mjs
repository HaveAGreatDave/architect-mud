// Switch the active climate profile — the one lever of "climate" that git cannot
// ship.
//
//   node scripts/set-climate.mjs                    # list profiles, mark the active one
//   node scripts/set-climate.mjs Miami              # switch by name
//   node scripts/set-climate.mjs --none             # clear → seasonal defaults
//   node --env-file=.env.prod scripts/set-climate.mjs Miami    # …against prod
//
// WHY THIS EXISTS. "Climate" is three levers on three different paths, and only
// two of them are content:
//
//   1. the 12-month curves  → climate_profiles, class:'content'. Edit
//      content/climate_profiles/<id>.json and let the CODEX deploy ship it.
//   2. the per-region lean  → regions.climate_bias, also content.
//   3. WHICH profile is active → world_clock.active_climate_profile_id, which is
//      RUNTIME state. The content pipeline does not carry world_clock, so no file
//      edit will ever move it, and POST /environment/climate/active is blocked on
//      prod: CONTENT_READONLY is default-deny and ENV_OPS_ROUTES (server/api/
//      routes.js) allows /environment/time/, /weather/, /tick/force and three
//      power routes — no climate route is on the list. That leaves lever 3 with
//      no route at all on production. Hence this script.
//
// It writes exactly ONE runtime column and never touches content, so it cannot
// cause git↔prod drift and the next content deploy will not revert it.
//
// ⚠ RESTART AFTER RUNNING. environment.js reads the profile into
// state.activeClimateProfile only at boot (the `clockRow.active_climate_profile_id`
// block) and in the dev setters you cannot reach on prod. Without a restart the
// row is correct and the running simulation keeps the old curves — which looks
// exactly like the script did nothing.
//
// Run once, by hand. Deliberately NOT in scripts/oneshots.bat: that is for
// converging scripts safe to re-run on every deploy, and this one states an
// intent rather than converging on one.
import { query } from '../server/models/db.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function summarise(p) {
  const t = Array.isArray(p.monthly_temp_c) ? p.monthly_temp_c : [];
  if (!t.length) return 'no temperature curve';
  const lo = Math.min(...t), hi = Math.max(...t);
  return `${lo}°C (${MONTHS[t.indexOf(lo)]}) → ${hi}°C (${MONTHS[t.indexOf(hi)]})`;
}

// Exact name wins outright; otherwise fall back to a unique case-insensitive
// substring, and an id match so a profile with an awkward name is still reachable.
function resolve(profiles, term) {
  const q = term.trim().toLowerCase();
  const exact = profiles.filter(p => p.name.toLowerCase() === q || p.id.toLowerCase() === q);
  if (exact.length === 1) return { hit: exact[0] };
  const partial = profiles.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  if (partial.length === 1) return { hit: partial[0] };
  if (partial.length > 1) return { ambiguous: partial };
  return {};
}

async function main() {
  const arg = process.argv.slice(2).join(' ').trim();

  const { rows: profiles } = await query(
    'SELECT id, name, monthly_temp_c FROM climate_profiles ORDER BY name ASC'
  );
  const { rows: clock } = await query('SELECT active_climate_profile_id FROM world_clock WHERE id = 1');
  if (!clock.length) {
    console.error('No world_clock row (id = 1). Is this pointed at a built database?');
    process.exit(1);
  }
  const activeId = clock[0].active_climate_profile_id || null;
  const active = profiles.find(p => p.id === activeId) || null;
  const activeLabel = active ? `${active.name} (${active.id})` : 'none — seasonal defaults';

  // No argument, or an explicit --list: report and change nothing.
  if (!arg || arg === '--list' || arg === '-l') {
    console.log(`\nActive: ${activeLabel}\n`);
    if (!profiles.length) console.log('  (no climate profiles in this database)');
    for (const p of profiles) {
      console.log(`  ${p.id === activeId ? '*' : ' '} ${p.name.padEnd(18)} ${summarise(p).padEnd(26)} ${p.id}`);
    }
    console.log(`\n  node scripts/set-climate.mjs <name>   switch\n  node scripts/set-climate.mjs --none   clear to seasonal defaults\n`);
    process.exit(0);
  }

  let targetId = null, targetLabel = 'none — seasonal defaults';
  if (arg !== '--none') {
    const { hit, ambiguous } = resolve(profiles, arg);
    if (ambiguous) {
      console.error(`"${arg}" matches ${ambiguous.length} profiles — be more specific:`);
      for (const p of ambiguous) console.error(`  ${p.name}  (${p.id})`);
      process.exit(1);
    }
    if (!hit) {
      console.error(`No climate profile matches "${arg}". Known profiles:`);
      for (const p of profiles) console.error(`  ${p.name}  (${p.id})`);
      process.exit(1);
    }
    targetId = hit.id;
    targetLabel = `${hit.name} (${hit.id})`;
  }

  if (targetId === activeId) {
    console.log(`Already active: ${activeLabel}. Nothing written.`);
    process.exit(0);
  }

  const res = await query('UPDATE world_clock SET active_climate_profile_id = $1 WHERE id = 1', [targetId]);
  if (!res.rowCount) {
    console.error('UPDATE matched no rows — world_clock id = 1 vanished mid-run. Nothing changed.');
    process.exit(1);
  }

  console.log(`\n  from  ${activeLabel}`);
  console.log(`  to    ${targetLabel}\n`);
  console.log('⚠ Restart the server. The profile is read into memory only at boot,');
  console.log('  so until then the simulation keeps running the old curves.\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
