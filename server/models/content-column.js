// Reading an AUTHORED column off the checkout instead of out of Neon.
//
// In production the server runs from the git checkout the content pipeline
// deploys, so a column that is purely authored — the derive pass never writes
// it, runtime never writes it — is already sitting on the local disk in
// content/<table>/<id>.json. Fetching it from a remote Postgres on every cold
// start is paying for a copy of a file we already have, and on the free tier the
// network-transfer allowance is the binding constraint. `plugins/audio` has read
// its library that way since July; this is the same trade, per COLUMN rather
// than per table, for the tables that are otherwise worth loading from the DB.
//
// See docs/architecture.md → "A seventh: read it off the checkout" for when the
// tier applies. The short version: authored only, the file must be the same text
// the DB holds, and — for the lazy mode — nothing may bulk-scan the column.
//
// One consequence worth stating plainly: an edit made straight to PROD's database
// and never exported stops taking effect immediately, where before it survived
// until the next deploy. That is a shorter fuse on the same outcome, not a new
// one — the content import already rewrites every file-backed column on every
// deploy (ON CONFLICT DO UPDATE), so such an edit was always going to be
// overwritten. Git is the writer of prod content; this reads from the same place.
//
// This module deliberately does NOT decide eager vs lazy. That depends on the row
// count: 17k zone files cost seconds to read at boot, so descriptions fault in one
// at a time; 250 NPC files cost ~120ms, so those are read up front and the whole
// lazy hazard never arises. The caller picks; this owns the parts that would
// otherwise be copied between them.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, fileNameForRow } from '../../scripts/content/lib.mjs';

/**
 * @param {object} spec
 * @param {string} spec.table   content/<table>/ directory and the SQL table name
 * @param {string} spec.column  the authored column to source from the file
 * @param {(v: any) => any} spec.coerce  file value → the shape callers expect,
 *        including the answer for "absent". Stated per column rather than shared,
 *        because a missing description is '' and a missing tree is a fresh {} —
 *        and a shared empty object would be one object aliased across every row.
 */
export function contentColumn({ table, column, coerce }) {
  const dir = join(CONTENT_DIR, table);
  // The exporter's OWN id→filename rule, imported rather than re-implemented: a
  // second copy of that sanitiser is a second chance to look for a file under a
  // name nothing ever wrote. It also means an id can never walk out of `dir`.
  const fileName = (id) => fileNameForRow({ pk: ['id'] }, { id });
  const readOne = (id) => {
    try { return coerce(JSON.parse(readFileSync(join(dir, fileName(id)), 'utf8'))[column]); }
    catch { return coerce(undefined); }
  };

  return {
    /**
     * Filenames present on disk — a directory listing, nothing parsed. This is how
     * a row with no file is spotted cheaply: runtime INSERTs (environment.js power
     * rooms, minted clip broadcasts) have no content until the next export, and
     * they still need their column from somewhere.
     * Null when there is no content tree at all, which puts the caller back on the DB.
     */
    fileNames() {
      try { return new Set(readdirSync(dir).filter(f => f.endsWith('.json'))); }
      catch { return null; }
    },

    has(files, id) { return !!files && files.has(fileName(id)); },

    /** The authored value for one row, straight off the checkout. */
    read: readOne,

    /**
     * Hang a read-once value off a live object: the first read pays for the file,
     * then the property settles into a plain one. For tables where reading every
     * file at boot would cost real seconds.
     */
    defineLazy(obj, id) {
      const settle = (target, value) => {
        Object.defineProperty(target, column, { value, writable: true, enumerable: true, configurable: true });
        return value;
      };
      Object.defineProperty(obj, column, {
        configurable: true,
        enumerable: true,
        get() { return settle(this, readOne(id)); },
        // A plain assignment has to keep working. This is an accessor on a
        // strict-mode object, so with no setter `obj.col = x` would THROW rather
        // than write, and the first caller to find that out would be a live one.
        set(v) { settle(this, v); },
      });
    },

    /**
     * `SELECT` list for the table with this column left out, derived from the live
     * table rather than hardcoded so a new column loads itself instead of silently
     * going missing. Null when the lookup cannot prove it saw the real table —
     * guessing at a schema loses columns quietly, and `SELECT *` is the safe answer.
     */
    async columnsExcept(query) {
      const { rows } = await query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      ).catch(() => ({ rows: [] }));
      const cols = rows.map(r => r.column_name).filter(c => c !== column);
      if (!cols.length || cols.length === rows.length) return null;
      return cols.map(c => `"${c}"`).join(',');
    },
  };
}
