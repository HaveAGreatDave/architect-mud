// house-posted-npcs.mjs — give the workplace-homed cast a home, a shift and a commute.
//
// THE PROBLEM. `home_zone` had drifted into meaning "where this NPC is when nothing
// else is happening". 110 of 178 NPCs had their own shop floor, the studio stage or a
// street tile registered as home, so `isDwellingZone` (which now gates home life) quite
// correctly silenced them — and left them with nowhere to be a person.
//
// A home is only worth having if you can leave it. So this does three things at once,
// and doing fewer would be worse than doing none:
//
//   1. HOME   — an apartment, assigned by real hop distance from their workplace, packed
//               2 to a unit (3 every fifth) per the housing-density rule.
//   2. SHIFT  — a `vendor_schedule`, derived from what they do, so CHECK_VENDOR_WORK has
//               an opinion about whether they are on the clock.
//   3. COMMUTE— the engine's OWN default graph (buildDefaultVendorGraph /
//               buildDefaultStudioGraph). Not a new graph invented here: adopting the
//               engine's default means this script can never drift from what the engine
//               knows how to run, and an NPC who already has a GO_TO_WORK graph keeps it.
//
// WHO IS LEFT ALONE, and why it is a rule rather than a list of names:
//   • flags.posted — authored "this NPC never goes home; the post is the life".
//   • the crew/police/ghost/fixture flags below, which already say the same thing.
//   • anyone with NO APARTMENT REACHABLE from their workplace. This is the load-bearing
//     one: it silently and correctly excludes The Reach, the Long Watch, the Under, the
//     Ascendant compound, the AA emplacements and the Echelon, without anybody having to
//     remember they are remote. If a district gets housing later, they house themselves.
//
// Dry run by default; --apply writes. File-authoring (git is the source of truth), so
// the sequence is: node scripts/house-posted-npcs.mjs --apply → npm run content:import.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from '../server/models/db.js';
import { buildDefaultVendorGraph, buildDefaultStudioGraph } from '../server/engine/ai-behaviour.js';

const APPLY = process.argv.includes('--apply');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sortKeys = (x) => Array.isArray(x) ? x.map(sortKeys)
  : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sortKeys(x[k])])) : x;
const readC = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const writeC = (rel, o) => writeFileSync(join(ROOT, rel), JSON.stringify(sortKeys(o), null, 2) + '\n');

const MAX_HOPS = 60;          // beyond this, "nearby" is a lie and they stay posted
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Flags that already mean "posted", so nobody has to author `posted` twice.
const POSTED_FLAGS = ['posted', 'aa_crew', 'aa_engineer', 'police', 'haunt_zone', 'no_attack'];

// A plausible shift, derived from what the NPC is rather than authored per head. The
// point is not accuracy — it is that CHECK_VENDOR_WORK has SOMETHING to answer, because
// an NPC with no schedule is never off-shift and therefore never goes home.
function deriveSchedule(npc) {
  const p = String(npc.flags?.personality || '');
  let from = 9, to = 18;
  if (npc.flags?.studio_npc)                            { from = 16; to = 23; }
  else if (['bartender', 'dancer', 'stripper', 'gambler', 'dealer'].includes(p) || npc.npc_type === 'gambler' || npc.npc_type === 'dealer') { from = 19; to = 27; }
  else if (['doctor', 'medic', 'nurse'].includes(p))    { from = 8;  to = 20; }
  else if (['labourer', 'mechanic', 'engineer'].includes(p)) { from = 7; to = 16; }
  const block = [{ from, to }];
  // Six days. The day off is derived from the id so it is stable and not everybody's
  // is a Sunday — a district where every shop shuts on the same day is a ghost town.
  const off = DAYS[[...npc.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 7];
  return Object.fromEntries(DAYS.map(d => [d, d === off ? [] : block]));
}

const hasCommute = (g) => JSON.stringify(g || {}).includes('GO_TO_WORK');

// ── World graph ───────────────────────────────────────────────────────────────
const { rows: zones } = await query('SELECT id, exits, flags FROM zones');
const zoneById = new Map(zones.map(z => [z.id, z]));
const adj = new Map();
for (const z of zones) {
  const out = new Set();
  for (const t of Object.values(z.exits || {})) if (t && zoneById.has(t)) out.add(t);
  adj.set(z.id, out);
}
// Undirected: a one-way exit still means the two rooms are neighbours for "how far is
// my flat from the shop", and half the interior seams are authored in only one direction.
for (const [from, outs] of adj) for (const t of outs) adj.get(t)?.add(from);

const isApartment = (id) => !!zoneById.get(id)?.flags?.is_apartment;
const isDwelling = (id) => { const f = zoneById.get(id)?.flags; return !!(f?.is_apartment || f?.is_dwelling); };

// Nearest apartments to a zone, nearest first, capped at MAX_HOPS.
function apartmentsNear(startId) {
  if (!adj.has(startId)) return [];
  const seen = new Set([startId]);
  let frontier = [startId], hops = 0;
  const found = [];
  while (frontier.length && hops < MAX_HOPS) {
    const next = [];
    for (const id of frontier) for (const t of adj.get(id) || []) {
      if (seen.has(t)) continue;
      seen.add(t);
      next.push(t);
      if (isApartment(t)) found.push({ id: t, hops: hops + 1 });
    }
    frontier = next; hops++;
  }
  return found;
}

// ── Who needs housing ─────────────────────────────────────────────────────────
const { rows: npcs } = await query(`
  SELECT id, name, npc_type, flags, home_zone, work_zone_id, studio_zone_id,
         vendor_schedule, behaviour_graph
    FROM npcs ORDER BY id`);

const occupancy = new Map();      // apartment zone -> count
for (const n of npcs) if (isApartment(n.home_zone)) occupancy.set(n.home_zone, (occupancy.get(n.home_zone) || 0) + 1);
const owned = new Set((await query('SELECT zone_id FROM apartments WHERE owner_id IS NOT NULL')).rows.map(r => r.zone_id));

const capOf = (id) => ([...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5 === 2 ? 3 : 2);
const hasRoom = (id) => !owned.has(id) && (occupancy.get(id) || 0) < capOf(id);

const posted = (n) => POSTED_FLAGS.some(f => n.flags?.[f]);

// Two candidate classes, because "has nowhere to live" and "has nowhere to go" are
// different failures with the same cure:
//   needsHome   — homed at their workplace. Gets a flat, and everything below.
//   needsRoute  — already lives somewhere real, has a job, and no way to reach it.
//                 Keeps the home they have; gets only the shift and the commute.
// Without the second class the build leaves a handful of NPCs sitting in a flat
// while their counter stands empty, which is the original bug wearing a hat.
const candidates = npcs.filter(n => n.home_zone && !isDwelling(n.home_zone) && !posted(n));
// ...and the workplace has to be a WORKPLACE. A handful of rows carry an apartment
// (their own, or a tenement unit) as work_zone_id; building a commute on top of that
// would send someone out to "work" in a flat, and a lair-dweller whose home IS their
// work would be given a shift to be absent for. Neither is a commute worth having.
const needsRoute = npcs.filter(n => n.home_zone && isDwelling(n.home_zone) && !posted(n)
  && (n.work_zone_id || n.studio_zone_id) && !hasCommute(n.behaviour_graph)
  && !isDwelling(n.work_zone_id || n.studio_zone_id));
const postedByFlag = npcs.filter(n => n.home_zone && !isDwelling(n.home_zone) && posted(n));

// ── Assign ────────────────────────────────────────────────────────────────────
const plan = [], unreachable = [];
for (const n of candidates) {
  const workZone = n.work_zone_id || n.studio_zone_id || n.home_zone;
  const unit = apartmentsNear(workZone).find(a => hasRoom(a.id));
  if (!unit) { unreachable.push({ n, workZone }); continue; }
  occupancy.set(unit.id, (occupancy.get(unit.id) || 0) + 1);
  plan.push({
    n, workZone, unit: unit.id, hops: unit.hops,
    setWork: !n.work_zone_id && !n.studio_zone_id,
    setSched: !n.vendor_schedule || !Object.values(n.vendor_schedule).some(v => v?.length),
    setGraph: !hasCommute(n.behaviour_graph),
    studio: !!n.flags?.studio_npc || !!n.studio_zone_id,
  });
}

// Already housed, just stranded: same treatment, minus the flat.
for (const n of needsRoute) {
  plan.push({
    n, workZone: n.work_zone_id || n.studio_zone_id, unit: null, hops: 0, keepHome: true,
    setWork: false,
    setSched: !n.vendor_schedule || !Object.values(n.vendor_schedule).some(v => v?.length),
    setGraph: true,
    studio: !!n.flags?.studio_npc || !!n.studio_zone_id,
  });
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — housing the workplace-homed cast\n`);
console.log(`  candidates          ${candidates.length}`);
console.log(`  posted by flag      ${postedByFlag.length}  (${[...new Set(postedByFlag.map(n => POSTED_FLAGS.find(f => n.flags?.[f])))].join(', ')})`);
console.log(`  no reachable flat   ${unreachable.length}`);
console.log(`  housed              ${plan.length}`);
console.log(`    ...given a work zone   ${plan.filter(p => p.setWork).length}`);
console.log(`    ...given a schedule    ${plan.filter(p => p.setSched).length}`);
console.log(`    ...given a commute     ${plan.filter(p => p.setGraph).length} (${plan.filter(p => p.setGraph && p.studio).length} studio, ${plan.filter(p => p.setGraph && !p.studio).length} vendor)`);
console.log(`  stranded at home    ${needsRoute.length}  (kept their flat, given a shift + commute)`);
const units = new Set(plan.filter(p => p.unit).map(p => p.unit));
const moved = plan.filter(p => !p.keepHome).length;
console.log(`  units used          ${units.size}  (avg ${(moved / (units.size || 1)).toFixed(1)} per unit)`);

if (unreachable.length) {
  console.log('\n  STAYING POSTED — no apartment within reach of their work:');
  const byZone = {};
  for (const u of unreachable) (byZone[u.workZone] ||= []).push(u.n.name);
  for (const [z, names] of Object.entries(byZone)) console.log(`    ${z.padEnd(34)} ${names.join(', ')}`);
}

console.log('\n  HOUSED:');
for (const p of plan.filter(x => !x.keepHome).sort((a, b) => a.unit.localeCompare(b.unit) || a.n.name.localeCompare(b.n.name))) {
  const tags = [p.setWork && 'work', p.setSched && 'shift', p.setGraph && (p.studio ? 'studio-graph' : 'vendor-graph')].filter(Boolean).join('+');
  console.log(`    ${p.n.name.padEnd(28)} → ${p.unit.padEnd(26)} ${String(p.hops).padStart(3)} hops   ${tags}`);
}
const stranded = plan.filter(x => x.keepHome);
if (stranded.length) {
  console.log('\n  ROUTED (kept their home):');
  for (const p of stranded) console.log(`    ${p.n.name.padEnd(28)}   work=${p.workZone}   ${[p.setSched && 'shift', p.studio ? 'studio-graph' : 'vendor-graph'].filter(Boolean).join('+')}`);
}

if (!APPLY) { console.log('\n(dry run — re-run with --apply to write content files)'); process.exit(0); }

// ── Write ─────────────────────────────────────────────────────────────────────
let wrote = 0;
for (const p of plan) {
  const rel = `content/npcs/${p.n.id}.json`;
  if (!existsSync(join(ROOT, rel))) { console.warn(`  ⚠ no content file for ${p.n.id} — skipped`); continue; }
  const f = readC(rel);
  if (!p.keepHome) f.home_zone = p.unit;
  if (p.setWork) f.work_zone_id = p.workZone;
  if (p.setSched) f.vendor_schedule = deriveSchedule(p.n);
  if (p.setGraph) f.behaviour_graph = p.studio ? buildDefaultStudioGraph() : buildDefaultVendorGraph();
  writeC(rel, f);
  wrote++;
}

// One registered primary resident per unit used, so findNearestVacantApartment stops
// handing the same flat to the next NPC that needs one.
const firstOf = new Map();
for (const p of plan.sort((a, b) => a.n.id.localeCompare(b.n.id))) {
  if (p.unit && !firstOf.has(p.unit)) firstOf.set(p.unit, p.n.id);   // routed-only movers have no unit
}
for (const [unit, npcId] of firstOf) writeC(`content/npc_residences/${unit}.json`, { note: null, npc_id: npcId, zone_id: unit });

console.log(`\n✓ wrote ${wrote} npc files and ${firstOf.size} residence registrations.`);
console.log('  next: npm run content:import && npm run test:regress');
process.exit(0);
