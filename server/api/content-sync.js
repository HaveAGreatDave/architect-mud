// Dev-panel save → content file writer (LOCAL DEV ONLY).
//
// When you create/update/delete a content entity through the dev panel against your
// LOCAL database, this mirrors that ONE entity to its content/<table>/<pk>.json file
// using the pipeline's canonical serializer (scripts/content/lib.mjs) — byte-identical
// to `content:export`. So dev-panel authoring and file authoring converge, and you
// never have to run a full `content:export` (which dumps the whole played-in DB and
// drags in runtime residue).
//
// Files are written UNSTAGED: review with `git status` and commit deliberately — the
// ship gate (regress → commit → push) stays a human step. See the `codex` skill.
//
// Guarded to local DBs (isLocalUrl): on prod the working tree is ephemeral and content
// is read-only, so every function here is a no-op there.

import { writeFileSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '../models/db.js';
import { contentEntries } from '../models/content-registry.js';
import { CONTENT_DIR, canonicalJson, rowToFileObject, fileNameForRow, isLocalUrl } from '../../scripts/content/lib.mjs';

const isLocal = () => isLocalUrl(process.env.DATABASE_URL);

function entryFor(table) {
  return contentEntries().find(e => e.table === table) || null;
}

// Write (row still present) or remove (row gone / no longer content) the file for one
// single-pk content entity. The where-predicate makes this safe for tables that mix
// authored + runtime rows (furniture): a runtime row selects 0 rows → no file written.
async function syncEntityFile(table, id) {
  const entry = entryFor(table);
  if (!entry || entry.pk.length !== 1) return;
  const pk = entry.pk[0];
  const where = entry.where ? ` AND ${entry.where}` : '';
  const { rows } = await query(`SELECT * FROM ${entry.table} WHERE ${pk}=$1${where} LIMIT 1`, [id]);
  const dir = join(CONTENT_DIR, entry.table);
  if (rows.length) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileNameForRow(entry, rows[0])), canonicalJson(rowToFileObject(entry, rows[0])));
  } else {
    const f = join(dir, fileNameForRow(entry, { [pk]: id }));
    if (existsSync(f)) rmSync(f);
  }
}

// Zone cascade-delete file cleanup. apiDeleteZone (which map-delete also funnels
// through) passes the FULL set of removed zone ids. Remove each zone's file plus any
// child content file whose zone reference is in that set — read from FILE CONTENT, not
// the DB, so this can't nuke file-authored rows that merely aren't imported locally.
const ZONE_REF_FIELDS = {
  zones:          ['id'],
  npcs:           ['zone_id', 'home_zone'],
  furniture:      ['zone_id'],
  zone_spawns:    ['zone_id'],
  windows:        ['zone_interior', 'zone_exterior'],
  apartments:     ['zone_id'],
  npc_residences: ['zone_id'],
  maps:           ['entry_zone_id', 'parent_zone_id'],
};

function syncZoneDeletion(deletedZoneIds) {
  if (!isLocal()) return;
  const dead = new Set((deletedZoneIds || []).map(String));
  if (!dead.size) return;
  for (const [table, fields] of Object.entries(ZONE_REF_FIELDS)) {
    if (!entryFor(table)) continue;
    const dir = join(CONTENT_DIR, table);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const full = join(dir, f);
      let data;
      try { data = JSON.parse(readFileSync(full, 'utf8')); } catch { continue; }
      if (fields.some(fld => dead.has(String(data[fld])))) rmSync(full);
    }
  }
}

// dev-panel URL segment → content table, for single-entity create/update/delete.
// Only id-pk content tables authored through the panel. Anything absent here (or a
// non-content table) simply doesn't auto-sync — safe by omission.
const URLSEG_TABLE = {
  items: 'items', enemies: 'enemies', npcs: 'npcs', furniture: 'furniture',
  drugs: 'drugs', mutations: 'mutations', recipes: 'recipes', scripts: 'scripts',
  windows: 'windows', doors: 'doors', sounds: 'sounds', spawns: 'zone_spawns',
  'scavenging-tables': 'scavenging_tables', 'ambient-events': 'global_ambient_events',
  maps: 'maps',
};
// Dialogue/behaviour graph PATCHes (/<seg>/:id/graph) mutate a content column.
const GRAPH_TABLE = { enemies: 'enemies', npcs: 'npcs', broadcasts: 'media_broadcasts' };
// Sub-paths under a content segment that are runtime ops, not content writes.
const RUNTIME_SUB = new Set(['restock', 'place-safe', 'safe-status', 'live-enemies', 'broadcast-schedule', 'rooms', 'doors']);

// Resolve a write request to the single content entity it touched, or null.
function contentTargetFor(path, method, result) {
  const segs = path.split('/').filter(Boolean);
  const seg0 = segs[0];
  const idFromResult = (table) => (result?.body?.id ? { table, id: String(result.body.id) } : null);

  // /<seg>/:id/graph PATCH
  if (method === 'PATCH' && segs[2] === 'graph' && GRAPH_TABLE[seg0]) return { table: GRAPH_TABLE[seg0], id: segs[1] };

  // Zones carry '/' in their ids — slice, don't split.
  if (seg0 === 'zones') {
    if (method === 'POST' && path.endsWith('/spawns')) return idFromResult('zone_spawns'); // /zones/:zid/spawns
    if (method === 'PATCH' && path.endsWith('/tag')) return { table: 'zones', id: path.slice('/zones/'.length, path.lastIndexOf('/')) };
    if (method === 'POST' && segs.length === 1) return idFromResult('zones');
    if (method === 'PUT' && segs.length >= 2) return { table: 'zones', id: path.slice('/zones/'.length) };
    return null; // DELETE is handled by apiDeleteZone's cascade, not here
  }

  const table = URLSEG_TABLE[seg0];
  if (!table) return null;
  if (segs.length >= 3 && RUNTIME_SUB.has(segs[2])) return null; // e.g. /npcs/:id/restock
  if (method === 'POST' && segs.length === 1) return idFromResult(table);
  if ((method === 'PUT' || method === 'DELETE') && segs.length === 2) return { table, id: segs[1] };
  return null;
}

// Called at the tail of handleApiRequest for every request. Best-effort — a sync
// failure must never change the API response the dev panel sees.
async function syncContentFromRequest(url, method, result) {
  if (!isLocal()) return;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
  if (!result || result.status >= 400) return;
  const path = url.replace(/^\/api/, '').split('?')[0];
  const target = contentTargetFor(path, method, result);
  if (target) await syncEntityFile(target.table, target.id);
}

export { syncContentFromRequest, syncZoneDeletion };
