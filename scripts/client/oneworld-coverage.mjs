// oneworld:coverage: how much of the city one-world can already walk you through, and what keeps the rest on the
// Room Stage (docs/proposals/one-world-interiors.md, "The conversion"). A report, not a gate: it never fails.
//
// Reads content/ the way the Modelshop's /api/building-rooms does (tools/modelshop/serve.mjs buildingRooms): every
// building whose walk is ready, each room's spec as the roomstage plugin builds it, its furniture laid out, and the
// same rule freelook-view.js uses (glass/interiors-near.js oneWorldBlocker). Rooms with a Stage spec that aren't on a
// ready walk are counted apart: one-world can't place them at all until their building's plan is drawn.
//
//   node scripts/client/oneworld-coverage.mjs           counts by reason
//   node scripts/client/oneworld-coverage.mjs --list    and every room under each reason
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkPlans, buildingView, zoneSpecOf } from '../../client/shared/building-graph.js';
import { roomLayout, layRows } from '../../client/shared/room-layout.js';
import { oneWorldBlocker } from '../../client/game/js/panels/glass/interiors-near.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIST = process.argv.includes('--list');
const read = (dir) => readdirSync(join(ROOT, 'content', dir)).filter((f) => f.endsWith('.json'))
  .map((f) => { try { return JSON.parse(readFileSync(join(ROOT, 'content', dir, f), 'utf8')); } catch { return null; } }).filter(Boolean);

const zones = new Map(read('zones').map((z) => [z.id, z]));
const specOf = (id) => { const z = zones.get(id); return z ? zoneSpecOf(zones, z) : null; };
const plans = walkPlans({ zones, maps: read('maps'), specOf: (z) => zoneSpecOf(zones, z) });
const rows = new Map();
for (const r of read('furniture')) if (r.zone_id) (rows.get(r.zone_id) || rows.set(r.zone_id, []).get(r.zone_id)).push(r);
const items = new Map(read('items').map((i) => [i.id, i]));
const itemOf = (x) => (x.flags?.item_id ? items.get(x.flags.item_id) || null : null);

const by = new Map(), buildings = new Set();
const note = (reason, id) => (by.get(reason) || by.set(reason, []).get(reason)).push(id);
for (const bld of new Set(plans.values())) {
  buildings.add(bld);
  const ids = Object.keys(bld.plan.rooms), mine = new Set(ids), why = new Map(), Ls = new Map();
  for (const id of ids) {
    // a lift car: walked once a walked landing has its doors (cars, below); GLASS takes it a copy per landing
    if (bld.plan.lifts?.[id]) { why.set(id, 'not-entry'); Ls.set(id, { spec: { openings: [] } }); continue; }
    const spec = buildingView(bld, id, specOf(id), { specOf }).spec;
    if (!spec) continue;
    let L;
    try { L = roomLayout(spec, layRows(rows.get(id) || [], spec, { finish: spec.finish, itemOf }).pieces); }
    catch (e) { note('layout-error', `${id} (${e.message})`); continue; }
    Ls.set(id, L); why.set(id, oneWorldBlocker(L, (z) => mine.has(z)));
  }
  // freelook-view.js oneWorldRoom: a room that isn't an entry is taken when a doorway, a flight of stairs or a typed
  // move (a zone exit with no opening drawn) leads to it from a room you're already walking in GLASS, or when it's a landing of a lift car you got into
  // from one (the Stage rides the car; phase E). So walk out from the taken entry rooms, room to room and car to landing.
  const walked = new Set([...why].filter(([, w]) => w === null).map(([id]) => id)), queue = [...walked], cars = new Set();
  const take = (id) => { if (!walked.has(id) && why.get(id) === 'not-entry') { walked.add(id); queue.push(id); } };
  while (queue.length) {
    const from = queue.shift(), L = Ls.get(from), storey = Number(bld.plan.rooms[from].floor) || 0;
    for (const o of L.spec.openings || []) {
      if (!o.dir) continue;
      if (o.lift) {
        if (cars.has(o.to)) continue;
        cars.add(o.to);
        take(o.to);
        for (const [id, Lq] of Ls) if ((Lq.spec.openings || []).some((q) => q.lift && q.to === o.to)) take(id);
        continue;
      }
      if (o.kind !== 'stair' && Math.abs((Number(bld.plan.rooms[o.to]?.floor) || 0) - storey) > 0.1) continue;
      take(o.to);
    }
    // a typed `up` or `down` where the plan draws no stair (the Meridian's): the zone's own exits, to rooms of this building
    for (const t of Object.values(zones.get(from)?.exits || {}).flat()) if (Ls.has(t)) take(t);
  }
  for (const [id, w] of why) note(w === null ? 'taken' : walked.has(id) ? 'walked-to' : w, id);
}
let off = 0;
const offList = [];
for (const z of zones.values()) if (z.flags?.room && !plans.has(z.id)) { off++; offList.push(z.id); }

const on = [...by.values()].reduce((a, l) => a + l.length, 0);
console.log(`one-world coverage: ${buildings.size} buildings on a ready walk, ${on} rooms on them; ${off} Stage rooms not on a ready walk`);
const order = ['taken', 'walked-to', 'not-entry', 'cooking', 'vending', 'lift', 'open', 'balcony', 'rink', 'layout-error'];
for (const k of [...order, ...[...by.keys()].filter((k) => !order.includes(k))]) {
  const l = by.get(k);
  if (!l) continue;
  console.log(`  ${k.padEnd(13)} ${String(l.length).padStart(4)}`);
  if (LIST) for (const id of l.sort()) console.log('      ' + id);
}
console.log(`  ${'off-walk'.padEnd(13)} ${String(off).padStart(4)}`);
if (LIST) for (const id of offList.sort()) console.log('      ' + id);
