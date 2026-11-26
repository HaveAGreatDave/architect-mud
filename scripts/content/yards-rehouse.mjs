// One-shot: homes for the people the Yards Tenement's refit left without one, and the Solenne kept for the people
// who can afford it (docs/proposals/model-plan.md, phase 3).
//
//   node scripts/content/yards-rehouse.mjs [--write]
//
// 1. The Solenne is for the well-off and the well-known: the TV hosts, old money, John Akerson in the penthouse,
//    and Cyd's cat (Cyd is a player, so his own flat isn't content). The four who work for a wage there move to
//    empty units at Chrome Court, each pair kept together: Sister Ida Adler and Gus Hallory, Bettine Halm and Thea
//    Wrenn. Neve Pace stays with Bijou Pace, her kin.
// 2. Everyone living in a Yards room the refit left over (plan-rooms.mjs --replace writes the list to left-over.txt)
//    moves, household together, into a free flat in the new Yards, then a room at Rest Assured on Lever Lane.
//    A flat with nobody takes a household of up to three; one with somebody takes nobody else.
// 3. npc_residences, one row a room named for it, follows: a new home gets a row naming its first resident, a room
//    whose residents all left loses its row, and a room still lived in keeps one naming somebody who's still there.
// Nobody's work zone is in a room that goes (it checks).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { canonicalJson } from './lib.mjs';

const C = path.resolve(process.cwd(), 'content');
const WRITE = process.argv.includes('--write');
const rd = (dir) => fs.readdirSync(path.join(C, dir)).filter((f) => f.endsWith('.json')).map((f) => ({ f, d: JSON.parse(fs.readFileSync(path.join(C, dir, f), 'utf8')) }));
const zones = rd('zones').map((x) => x.d), npcs = rd('npcs'), resRows = rd('npc_residences');
const Z = new Map(zones.map((z) => [z.id, z]));
const leftFile = path.join(os.tmpdir(), 'plan-out', 'yards_tenement', 'left-over.txt');
const gone = new Set(fs.readFileSync(leftFile, 'utf8').split('\n').filter((l) => l.startsWith('zone')).map((l) => l.match(/zones\/(\S+)\.json/)[1]));

const homeOf = new Map(npcs.map(({ d }) => [d.id, d.home_zone]));
const residents = (zone) => [...homeOf].filter(([, h]) => h === zone).map(([id]) => id);
const move = new Map();   // npc id -> new home
const freeIn = (pred) => zones.filter((z) => z.flags?.is_apartment && z.map_id !== 'map_set_aside' && !gone.has(z.id) && pred(z) && residents(z.id).length === 0 && !resRows.some((r) => r.d.zone_id === z.id)).map((z) => z.id).sort();

// 1. the Solenne
const OUT_OF_SOLENNE = [['npc_clinic_medic', 'npc_diner_cook'], ['npc_adequate_clerk', 'npc_salon_barista']];
const chrome = freeIn((z) => z.map_id === 'map_int_mq_chrome');
OUT_OF_SOLENNE.forEach((pair, i) => { if (!chrome[i]) throw new Error('Chrome Court has no empty unit left'); for (const id of pair) move.set(id, chrome[i]); });

// 2. the Yards
const households = new Map();
for (const { d } of npcs) if (gone.has(d.home_zone)) households.set(d.home_zone, [...(households.get(d.home_zone) || []), d.id]);
for (const { d } of npcs) if (gone.has(d.work_zone_id)) throw new Error(`${d.id} works in ${d.work_zone_id}, which goes; move that by hand`);
const targets = [...freeIn((z) => z.map_id === 'map_int_yards_tenement'), ...freeIn((z) => z.map_id === 'map_int_restassured')];
for (const [was, people] of [...households].sort()) {
  const to = targets.shift();
  if (!to) throw new Error(`nowhere left for the household from ${was}`);
  for (const id of people) move.set(id, to);
}

// 3. write
const writes = [], deletes = [];
for (const { f, d } of npcs) if (move.has(d.id)) writes.push(['npcs', f, { ...d, home_zone: move.get(d.id) }]);
const after = new Map([...homeOf].map(([id, h]) => [id, move.get(id) || h]));
const livesIn = (zone) => [...after].filter(([, h]) => h === zone).map(([id]) => id).sort();
const touched = new Set([...move.values(), ...[...move.keys()].map((id) => homeOf.get(id))]);
for (const zone of touched) {
  const row = resRows.find((r) => r.d.zone_id === zone), who = livesIn(zone);
  if (!who.length) { if (row) deletes.push(`npc_residences/${row.f}`); continue; }
  if (row && who.includes(row.d.npc_id)) continue;
  writes.push(['npc_residences', row ? row.f : `${zone}.json`, { ...(row?.d || { note: null }), npc_id: who[0], zone_id: zone }]);
}
for (const [id, to] of [...move].sort((a, b) => a[1].localeCompare(b[1]))) console.log(`${(npcs.find((n) => n.d.id === id).d.name).padEnd(26)} ${homeOf.get(id)} -> ${to} (${Z.get(to).name})`);
for (const [dir, f] of writes.map(([a, b]) => [a, b])) console.log(`${WRITE ? 'wrote' : 'would write'} content/${dir}/${f}`);
for (const f of deletes) console.log(`${WRITE ? 'deleted' : 'would delete'} content/${f}`);
if (WRITE) {
  for (const [dir, f, obj] of writes) fs.writeFileSync(path.join(C, dir, f), canonicalJson(obj));
  for (const f of deletes) fs.rmSync(path.join(C, f));
} else console.log('dry run: --write to write');
