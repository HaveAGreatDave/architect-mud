/**
 * Job-aware schedule backfill.
 *
 * Assigns a presumed vendor_schedule to every NPC that currently has none,
 * EXCEPT:
 *   - Studio / broadcast folk (they schedule via the broadcast system) — skipped.
 *   - The summonable poker gambler (a commute schedule would pull him off his table).
 *
 * The shift is presumed from the NPC's job (flags.personality / npc_type), with a
 * description-keyword override (a "travelling vendor" who actually runs a bar → night).
 *
 * Dry-run by default. Pass --apply to write.
 *   node server/models/temp/backfill-npc-schedules.js
 *   node server/models/temp/backfill-npc-schedules.js --apply
 */
import 'dotenv/config';
import { query } from '../db.js';

const APPLY = process.argv.includes('--apply');
const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const allDays = blocks => Object.fromEntries(DAYS.map(d => [d, blocks]));

// Shift templates. Night shifts wrap midnight, so they are split into two blocks
// (the engine's inBlock test is `h >= from && h < to`, no wrap) applied every day.
const SHIFTS = {
  day_9_18:   { label: 'day 09:00–18:00',        blocks: [{ from: 9,  to: 18 }] },
  day_10_19:  { label: 'day 10:00–19:00',        blocks: [{ from: 10, to: 19 }] },
  day_8_17:   { label: 'day 08:00–17:00',        blocks: [{ from: 8,  to: 17 }] },
  day_8_18:   { label: 'day patrol 08:00–18:00', blocks: [{ from: 8,  to: 18 }] },
  night_18_2: { label: 'night 18:00–02:00',      blocks: [{ from: 0, to: 2 }, { from: 18, to: 24 }] },
  night_20_4: { label: 'night 20:00–04:00',      blocks: [{ from: 0, to: 4 }, { from: 20, to: 24 }] },
};

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
}
function hasSchedule(sched) {
  return sched && !Array.isArray(sched) && Object.keys(sched).length > 0;
}

// Presume a shift from the NPC's job. Returns { shift } or { skip, reason }.
function inferShift(npc, flags) {
  const persona = flags.personality || '';
  const desc = `${npc.name || ''} ${npc.description || ''}`.toLowerCase();
  const barlike = /\bbar\b|bartend|tavern|pub|club|pours|tap(?:s|room)?\b/.test(desc);

  if (npc.npc_type === 'gambler')
    return { skip: 'summonable poker opponent — a commute schedule would pull him off the table' };

  // Job personalities
  if (persona === 'bartender')          return { shift: 'night_18_2' };
  if (persona === 'dealer' || npc.npc_type === 'dealer') return { shift: 'night_20_4' };
  if (persona === 'vendor')             return { shift: 'day_9_18' };
  if (persona === 'travelling_vendor')  return { shift: barlike ? 'night_18_2' : 'day_10_19' };
  if (persona === 'stripper')           return { shift: 'night_18_2' };
  if (persona === 'tv_host')            return { skip: 'broadcast host — schedules via broadcast system' };

  // No job personality — infer from name/description
  if (/\b(officer|sergeant|patrol|police|constable|deput)/.test(desc)) return { shift: 'day_8_18' };
  if (/quartermaster|supply|requisition|ledger|clerk|stockroom/.test(desc)) return { shift: 'day_8_17' };
  if (barlike)                          return { shift: 'night_18_2' };

  // Fallback: a plain daytime worker.
  return { shift: 'day_9_18', generic: true };
}

async function main() {
  console.log(`=== backfill-npc-schedules (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  // Studio folk to exclude: any NPC sitting in / working at a channel studio zone,
  // plus anyone marked as an actor (studio_zone_id).
  const { rows: chans } = await query('SELECT studio_zone_id FROM media_channels WHERE studio_zone_id IS NOT NULL');
  const studioZones = new Set(chans.map(c => c.studio_zone_id));

  const { rows: npcs } = await query('SELECT * FROM npcs ORDER BY name');

  const assign = [];   // { npc, shift }
  const skipped = [];  // { npc, reason }

  // Being converted to a roaming soldier and have no work zone yet — no shift.
  const MANUAL_SKIP = {
    npc_pd_officer:   'converting to soldier; no work zone yet — schedule skipped',
    npc_quartermaster:'converting to soldier; no work zone yet — schedule skipped',
  };

  for (const npc of npcs) {
    const flags = parseJson(npc.flags, {});
    const sched = parseJson(npc.vendor_schedule, {});
    if (hasSchedule(sched)) continue; // already has one — leave it
    if (MANUAL_SKIP[npc.id]) { skipped.push({ npc, reason: MANUAL_SKIP[npc.id] }); continue; }

    // Exclude studio / broadcast folk entirely (they schedule via broadcast).
    const inStudio = npc.studio_zone_id
      || studioZones.has(npc.zone_id)
      || studioZones.has(npc.home_zone)
      || studioZones.has(npc.work_zone_id);
    if (inStudio) { skipped.push({ npc, reason: 'studio/broadcast NPC — untouched (broadcast schedule)' }); continue; }
    if (npc.npc_type === 'unemployed') { skipped.push({ npc, reason: 'unemployed — no work schedule' }); continue; }

    const r = inferShift(npc, flags);
    if (r.skip) { skipped.push({ npc, reason: r.skip }); continue; }
    assign.push({ npc, shift: r.shift, generic: r.generic, persona: flags.personality || '(none)' });
  }

  console.log(`NPCs missing a schedule: ${assign.length + skipped.length}`);
  console.log(`  → will assign: ${assign.length}    → skip: ${skipped.length}\n`);

  console.log('── PROPOSED SCHEDULES ─────────────────────────────────────');
  for (const a of assign) {
    const s = SHIFTS[a.shift];
    const g = a.generic ? '  \x1b[33m(generic — no clear job signal)\x1b[0m' : '';
    console.log(`  ${a.npc.id.padEnd(24)} ${(a.npc.name||'').padEnd(20)} job=${a.persona.padEnd(18)} → ${s.label}${g}`);
  }

  console.log('\n── SKIPPED (left with no schedule) ────────────────────────');
  for (const s of skipped) {
    console.log(`  ${s.npc.id.padEnd(24)} ${(s.npc.name||'').padEnd(20)} — ${s.reason}`);
  }

  if (!APPLY) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`\nDry run. Re-run with --apply to write the ${assign.length} schedule(s):`);
    console.log('  node server/models/temp/backfill-npc-schedules.js --apply');
    process.exit(0);
  }

  console.log(`\nApplying ${assign.length} schedule(s)...\n`);
  let changed = 0;
  for (const a of assign) {
    const schedule = allDays(SHIFTS[a.shift].blocks);
    await query('UPDATE npcs SET vendor_schedule=$1 WHERE id=$2', [JSON.stringify(schedule), a.npc.id]);
    console.log(`  ✓ ${a.npc.id} (${a.npc.name}) → ${SHIFTS[a.shift].label}`);
    changed++;
  }
  console.log(`\n${changed} NPC(s) updated. Trigger a world reload / restart to pick up the new schedules.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
