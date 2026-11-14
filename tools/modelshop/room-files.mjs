// THE ROOM LAB'S SAVE: the arrange mode's staff layout written straight to content/furniture, with no game server and
// no database (room-lab.html ?admin=1; client/game/js/panels/room-arrange.js). The Studio's way of working: read the
// files, write the files, and git ships them.
//
// ⚠ ONE READER OF A SAVE. It reads the same `arrange layout` words the game does (room-layout.js parseLayout) and
// builds a new piece's row the way the game does (furniture-row.js authoredFurnitureRow), so the Lab and the game can't
// disagree about what a layout means or what a placed item becomes. The file is written through the pipeline's own
// canonicalJson and rowToFileObject, so it's the bytes `content:export` would write.
// ⚠ A FILE CHANGED SINCE THE LAB READ IT IS NEVER OVERWRITTEN (the Studio's conflictOf). /api/room-lab sends each row's
// stamp (mtime and size) with the room, the Save sends them back, and a file whose stamp has moved since (a git pull,
// the dev panel, a hand edit) refuses the whole Save before anything is written. Reopen the room to pick it up.
// ⚠ ALL OR NOTHING, AND WHOLE FILES. Every check runs before the first write; each file is written to a temporary name
// and renamed into place, so a crash never leaves torn JSON for the importer to choke on.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson, rowToFileObject, schemaColumnsOf, fileNameForRow, CONTENT_DIR } from '../../scripts/content/lib.mjs';
import { contentEntries } from '../../server/models/content-registry.js';
import { parseLayout, rowDrawn, rowLook } from '../../client/shared/room-layout.js';
import { authoredFurnitureRow, furnitureInteractions, furnitureObjectType } from '../../client/shared/furniture-row.js';

const FDIR = join(CONTENT_DIR, 'furniture'), IDIR = join(CONTENT_DIR, 'items'), ZDIR = join(CONTENT_DIR, 'zones');
const entry = () => contentEntries().find((e) => e.table === 'furniture');
const fileOf = (id) => join(FDIR, fileNameForRow(entry(), { id }));
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
export const stampOf = (path) => { try { const s = statSync(path); return `${s.mtimeMs}:${s.size}`; } catch { return 'absent'; } };
// each row's stamp, for /api/room-lab to send with the room
export const stampsOf = (rows) => Object.fromEntries(rows.map((r) => [r.id, stampOf(fileOf(r.id))]));

// Every furniture item in content/items that's drawn on the Stage, with how it's drawn, as the game's `arrange catalog`.
export function labCatalog() {
  const items = [];
  for (const f of readdirSync(IDIR)) {
    const item = f.endsWith('.json') ? readJson(join(IDIR, f)) : null;
    if (item?.type !== 'furniture') continue;
    const flags = { ...(item.flags || {}), item_id: item.id }, row = { id: item.id, name: item.name, object_type: furnitureObjectType(flags), flags, price: item.value };
    if (!rowDrawn(row)) continue;
    items.push({ id: item.id, name: item.name, value: item.value ?? null, ...rowLook(row, item), verbs: furnitureInteractions(item), container: row.object_type === 'container' });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function writeWhole(path, text) {
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 6)}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

// A Save: { zone, command: 'arrange layout ...', stamps: { id: stamp } } in, { ok, message, bad, written } out.
export async function labArrange({ zone, command, stamps = {} } = {}) {
  const no = (message, bad = []) => ({ ok: false, message, bad });
  const words = String(command || '').trim().split(/\s+/);
  if (words[0] !== 'arrange' || words[1] !== 'layout') return no('That is not a layout.');
  if (!zone || !existsSync(join(ZDIR, `${zone}.json`))) return no(`There's no zone file for ${zone}.`);
  const all = parseLayout(words.slice(2));
  if (!all) return no("That layout didn't make sense. Nothing written.");
  if (!all.length) return { ok: true, message: 'Nothing to write.', bad: [], written: [] };
  // every check first: the rows are this room's and unchanged since they were read, the items exist
  const plan = [];
  for (const m of all) {
    if (m.add) {
      const item = readJson(join(IDIR, `${m.item}.json`));
      if (item?.type !== 'furniture') return no(`There's no furniture item "${m.item}" in content/items. Nothing written.`);
      plan.push({ add: true, item, spot: m.spot });
      continue;
    }
    const path = fileOf(m.id), row = readJson(path);
    if (!row) return no(`content/furniture/${m.id}.json isn't there any more. Reopen the room. Nothing written.`, [m.id]);
    if (row.zone_id !== zone) return no(`The ${row.name} isn't in this room's file (${row.zone_id}). Nothing written.`, [m.id]);
    if (stamps[m.id] && stamps[m.id] !== stampOf(path)) return no(`content/furniture/${m.id}.json changed on disk since the Lab read it (a git pull, the dev panel or a hand edit). Reopen the room to pick it up. Nothing written.`, [m.id]);
    plan.push({ ...m, path, row });
  }
  const written = [];
  for (const p of plan) {
    if (p.remove) { await unlink(p.path); written.push(`-${p.row.id}`); continue; }
    if (p.add) {
      const row = authoredFurnitureRow(p.item, zone, p.spot, randomUUID().slice(0, 4));
      const full = { ...Object.fromEntries([...schemaColumnsOf('furniture')].map((c) => [c, null])), ...row };
      await writeWhole(fileOf(row.id), canonicalJson(rowToFileObject(entry(), full)));
      written.push(`+${row.id}`);
      continue;
    }
    await writeWhole(p.path, canonicalJson({ ...p.row, flags: { ...(p.row.flags || {}), spot: p.spot } }));
    written.push(p.row.id);
  }
  return { ok: true, message: `Written to content/furniture: ${written.length} file${written.length === 1 ? '' : 's'}. Review with git diff; npm run content:import puts them in your local database.`, bad: [], written };
}
