// content:import — apply the content file tree (content/<table>/<pk>.json) to a database.
//
//   npm run content:import                       local DB (post-merge hook runs this)
//   node scripts/content/import.mjs --dry-run    show what would change, touch nothing
//   node scripts/content/import.mjs --no-delete  upserts only, skip the deletion pass
//   node scripts/content/import.mjs --guard-wip  abort if pulled changes overlap unexported local edits
//   node scripts/content/import.mjs --report-drift          report DB↔files drift, change nothing
//   node scripts/content/import.mjs --prod --yes            CI prod deploy path
//
// What it does, in order (all row work inside ONE transaction):
//   0. Applies SCHEMA_SQL (idempotent DDL) — so a content commit that needs a new
//      column/table carries it, and fresh setup is just db + this command.
//   1. Deletion pass — git-diff-driven, NOT absence-based: reads the last imported
//      commit from server_settings ('content_pipeline.last_imported_sha'), lists
//      files DELETED between it and HEAD (git diff --diff-filter=D --no-renames),
//      recovers each row's pk from the old blob (git show <sha>:<path>), and
//      deletes those rows — scoped to the table's content predicate. Rows created
//      at runtime (player furniture, tapes, junction boxes…) never had files, so
//      this pass can never touch them. Missing marker ⇒ deletions are skipped
//      with a loud warning; upserts still apply. Runs BEFORE upserts so a
//      primary-key rename (old file deleted + new file added) frees any secondary
//      unique constraint before the new row inserts.
//   2. Upserts every file: INSERT … ON CONFLICT (pk) DO UPDATE SET <file's columns>,
//      guarded by IS DISTINCT FROM so an unchanged row writes nothing. Columns not
//      in the file (runtime-mutated excludeColumns, new defaults) are never touched
//      on existing rows.
//   3. Advances the marker to HEAD.
//
// Consequence: `git revert` of a bad content commit, then re-import, is a complete
// rollback — reverted values re-upsert, its added rows delete, its deletions restore.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { relative, sep } from 'node:path';
import { SCHEMA_SQL } from '../../server/models/schema.js';
import { contentEntries } from '../../server/models/content-registry.js';
import {
  connectTarget, readContentTree, columnTypes, paramFor,
  rowToFileObject, canonicalJson, schemaColumnsOf, CONTENT_DIR, REPO_ROOT, MARKER_KEY,
  isRuntimeResidueId, readPalette,
} from './lib.mjs';
import { writeDerived } from './derive-write.mjs';

const args = new Set(process.argv.slice(2));
const prod = args.has('--prod');
const yes = args.has('--yes');
const dryRun = args.has('--dry-run');
const noDelete = args.has('--no-delete');
const reportDrift = args.has('--report-drift');
const guardWip = args.has('--guard-wip');

function git(...argv) {
  // Capture stderr (don't inherit it): several call sites — notably the WIP
  // guard's `git show <marker>:<path>` for files that didn't exist at the marker
  // — expect git to fail and swallow it in a try/catch. Inheriting stderr would
  // still spray git's `fatal:` lines onto the terminal, making a handled miss
  // look like a real error. Piped stderr lands in the thrown error instead.
  return execFileSync('git', argv, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function contentPathOf(table, name) {
  // git paths are always forward-slash, relative to repo root
  return `${relative(REPO_ROOT, CONTENT_DIR).split(sep).join('/')}/${table}/${name}`;
}

try {
  const { entries, unknownDirs } = readContentTree();
  if (unknownDirs.length) {
    throw new Error(`content/ has directories that are not content tables: ${unknownDirs.join(', ')} — fix or reclassify in the registry first.`);
  }
  if (!entries.length) {
    console.log('content/ is empty or missing — nothing to import.');
    process.exit(0);
  }

  const { client, host } = await connectTarget({ prod, yes, purpose: 'import content INTO' });
  const byTable = new Map(contentEntries().map(e => [e.table, e]));

  // ── Drift report mode: read-only comparison, then exit ─────────────────────
  // The comparison runs INSIDE Postgres: file rows are uploaded to a temp table
  // (ingress — Neon doesn't bill writes) and joined against the real table, so
  // only mismatch keys ever leave the database. The old implementation pulled
  // `SELECT * FROM <every content table>` per deploy (~30MB of egress, audio
  // blobs included), which single-handedly blew Neon's free-plan transfer cap.
  // Equality is column-wise IS DISTINCT FROM on the columns a deploy would
  // write — the same predicate the upsert pass uses, so "differ" here means
  // precisely "the deploy will overwrite this row".
  if (reportDrift) {
    console.log(`— drift report: ${host} vs content/ files —`);
    let differing = 0;
    for (const { entry, files } of entries) {
      const types = await columnTypes(client, entry.table);
      // A whole table this SAME deploy introduces (e.g. `augments`) doesn't exist on
      // prod until the import step applies SCHEMA_SQL — it has no rows to drift-compare.
      // Skip it here; otherwise CREATE TEMP TABLE … FROM <missing table> throws and the
      // drift-report step fails the deploy (this is the new-column carve-out below, at
      // whole-table granularity).
      if (!types.size) continue;
      const excluded = new Set(entry.excludeColumns || []);
      // Compare the columns a deploy writes: schema-declared, not runtime-owned,
      // and present on the live DB. A column this SAME deploy introduces doesn't
      // exist on prod yet — skipping it here mirrors the old 42703 fallback.
      const cols = [...schemaColumnsOf(entry.table)].filter(c => types.has(c) && !excluded.has(c));
      for (const c of entry.pk) if (!cols.includes(c)) cols.push(c);
      const colList = cols.map(c => `"${c}"`).join(', ');

      // One transaction per table: the pooler endpoint is PgBouncer in transaction
      // mode, so a temp table only survives between statements while a transaction
      // pins the backend session.
      await client.query('BEGIN');
      await client.query(`CREATE TEMP TABLE _content_drift ON COMMIT DROP AS SELECT ${colList} FROM ${entry.table} WITH NO DATA`);
      for (let i = 0; i < files.length; i += 100) {
        const chunk = files.slice(i, i + 100);
        const params = [];
        const tuples = chunk.map(f =>
          `(${cols.map(c => `$${params.push(paramFor(f.data[c] ?? null, types.get(c)))}`).join(', ')})`);
        await client.query(`INSERT INTO _content_drift (${colList}) VALUES ${tuples.join(', ')}`, params);
      }

      const pk0 = entry.pk[0];
      const pkJoin = entry.pk.map(c => `f."${c}" = t."${c}"`).join(' AND ');
      const nonPk = cols.filter(c => !entry.pk.includes(c));
      const distinct = nonPk.length
        ? `(${nonPk.map(c => `f."${c}"`).join(', ')}) IS DISTINCT FROM (${nonPk.map(c => `t."${c}"`).join(', ')})`
        : 'FALSE';
      const compare = (where) => client.query(`
        SELECT * FROM (
          SELECT CASE WHEN t."${pk0}" IS NULL THEN 'file-only'
                      WHEN f."${pk0}" IS NULL THEN 'db-only'
                      WHEN ${distinct} THEN 'differ' END AS kind,
                 ${entry.pk.map(c => `COALESCE(f."${c}"::text, t."${c}"::text) AS "${c}"`).join(', ')}
          FROM _content_drift f
          FULL OUTER JOIN (SELECT ${colList} FROM ${entry.table}${where}) t ON ${pkJoin}
        ) d WHERE kind IS NOT NULL`);
      let rows;
      try {
        await client.query('SAVEPOINT scoped_compare');
        ({ rows } = await compare(entry.where ? ` WHERE ${entry.where}` : ''));
      } catch (e) {
        // A registry `where` predicate can reference a column this SAME deploy
        // introduces (e.g. furniture.origin). Fall back to an unscoped read —
        // runtime rows then show as "db-only", which the report already
        // tolerates. Self-heals the moment the column ships.
        if (entry.where && e.code === '42703') {
          await client.query('ROLLBACK TO SAVEPOINT scoped_compare');
          ({ rows } = await compare(''));
        } else {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        }
      }
      await client.query('COMMIT');

      const nameByKey = new Map(files.map(f => [entry.pk.map(c => String(f.data[c])).join('\0'), f.name]));
      const nameOf = (r) => nameByKey.get(entry.pk.map(c => String(r[c])).join('\0')) || entry.pk.map(c => r[c]).join('/');
      const diffs = rows.filter(r => r.kind === 'differ').map(nameOf);
      const fileOnly = rows.filter(r => r.kind === 'file-only');
      // db-only rows have no file: expected for runtime-created rows —
      // reported as a count, not a wall of names.
      const dbOnly = rows.filter(r => r.kind === 'db-only');
      if (fileOnly.length || diffs.length || dbOnly.length) {
        console.log(`  ${entry.table}: ${diffs.length} differ (deploy will overwrite), ${fileOnly.length} file-only (will insert), ${dbOnly.length} db-only (runtime rows or drift)`);
        for (const n of diffs.slice(0, 20)) console.log(`    ≠ ${n}`);
        if (diffs.length > 20) console.log(`    … and ${diffs.length - 20} more`);
        differing += diffs.length;
      }
    }
    console.log(differing
      ? `⚠ ${differing} row(s) in ${host} differ from files — a deploy will overwrite them. If these are deliberate hotfixes, export + commit them first.`
      : '✓ No differing rows.');
    await client.end();
    process.exit(0);
  }

  // ── WIP guard (local pulls): pulled changes vs unexported local edits ──────
  // For every content file changed in <marker>..HEAD, compare the CURRENT DB row
  // against both the pre-pull version (git show <marker>:<path>) and the new file.
  // DB matching either is fine (already imported / already identical). DB matching
  // neither means the pull is about to stomp an unexported local edit — abort.
  if (guardWip && !prod) {
    const { rows: m } = await client.query('SELECT value FROM server_settings WHERE key=$1', [MARKER_KEY]);
    const marker = m[0]?.value;
    if (!marker) {
      console.warn('⚠ --guard-wip: no import marker in this DB yet — guard skipped.');
    } else {
      let changed = [];
      try {
        changed = git('diff', '--name-status', '--no-renames', marker, 'HEAD', '--', 'content/')
          .split('\n').filter(Boolean).map(l => l.split('\t'));
      } catch (e) {
        console.warn(`⚠ --guard-wip: cannot diff against marker ${marker.slice(0, 10)} (${e.message.split('\n')[0]}) — guard skipped.`);
      }
      const conflicts = [];
      for (const [status, path] of changed) {
        if (status === 'D') continue; // deletions are handled (and logged) below
        const parts = path.split('/');
        const entry = byTable.get(parts[1]);
        if (!entry) continue;
        const incoming = entries.find(t => t.entry === entry)?.files.find(f => contentPathOf(entry.table, f.name) === path);
        if (!incoming) continue;
        const pkWhere = entry.pk.map((c, i) => `"${c}"=$${i + 1}`).join(' AND ');
        const { rows } = await client.query(`SELECT * FROM ${entry.table} WHERE ${pkWhere}`, entry.pk.map(c => incoming.data[c]));
        if (!rows.length) continue; // row doesn't exist locally — plain insert, no conflict
        const dbJson = canonicalJson(rowToFileObject(entry, rows[0]));
        if (dbJson === canonicalJson(incoming.data)) continue; // already matches incoming
        let markerJson = null;
        try {
          markerJson = canonicalJson(JSON.parse(git('show', `${marker}:${path}`)));
        } catch { /* file didn't exist at marker */ }
        if (markerJson !== null && dbJson === markerJson) continue; // untouched since last import
        conflicts.push(`${entry.table}/${incoming.name}`);
      }
      if (conflicts.length) {
        console.error('✗ Unexported local edits conflict with pulled changes:');
        for (const c of conflicts) console.error(`    ${c}`);
        console.error('  Run `npm run content:export`, resolve in git (commit/merge), then `npm run content:import`.');
        await client.end();
        process.exit(1);
      }
    }
  }

  // ── Step 0: schema (idempotent, outside the row transaction like db:schema) ─
  await client.query(SCHEMA_SQL);

  // ── Steps 1–3: one transaction ──────────────────────────────────────────────
  await client.query('BEGIN');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  let totalIns = 0, totalUpd = 0, totalDel = 0;

  try {
    // ── Deletion pass FIRST: git-diff-driven ──────────────────────────────────
    // Runs before the upserts (same transaction) so a primary-key rename — old
    // file deleted + new file added in one commit — doesn't collide on a
    // *secondary* unique constraint (e.g. media_channels.number). The old row is
    // removed before the new one inserts; without this ordering the new INSERT
    // trips the non-deferrable unique index and the whole import aborts.
    const head = git('rev-parse', 'HEAD').trim();
    if (noDelete) {
      console.log('  (deletion pass skipped: --no-delete)');
    } else {
      const { rows: m } = await client.query('SELECT value FROM server_settings WHERE key=$1', [MARKER_KEY]);
      const marker = m[0]?.value;
      if (!marker) {
        console.warn(`⚠ No import marker (${MARKER_KEY}) in this DB — deletion pass SKIPPED. It will run from the next import on.`);
      } else if (marker === head) {
        // nothing to diff
      } else {
        let deleted = [];
        try {
          deleted = git('diff', '--name-status', '--diff-filter=D', '--no-renames', marker, 'HEAD', '--', 'content/')
            .split('\n').filter(Boolean).map(l => l.split('\t')[1]);
        } catch (e) {
          console.warn(`⚠ Cannot diff against marker ${marker.slice(0, 10)} (${e.message.split('\n')[0]}) — deletion pass SKIPPED.`);
        }
        for (const path of deleted) {
          const table = path.split('/')[1];
          const entry = byTable.get(table);
          if (!entry) continue;
          let old;
          try {
            old = JSON.parse(git('show', `${marker}:${path}`));
          } catch {
            console.warn(`⚠ Cannot read ${path} at ${marker.slice(0, 10)} — skipping this deletion.`);
            continue;
          }
          // A leaked runtime-residue file (player furniture / SPECTER recording that
          // slipped through export review into git) being cleaned OUT of git must not
          // delete the live row: drop the file, keep the row.
          if (isRuntimeResidueId(entry.table, old.id)) {
            console.warn(`  ⚠ ${path}: runtime row (not authored content) — file removed from git, prod row kept.`);
            continue;
          }
          const pkVals = entry.pk.map(c => old[c]);
          const pkWhere = entry.pk.map((c, i) => `"${c}"=$${i + 1}`).join(' AND ');
          const scope = entry.where ? ` AND (${entry.where})` : '';
          // player_inventory.item_id has no FK by design (an FK would block this
          // very deletion pass) — deleting a template orphans player copies,
          // which app code tolerates but a human should know about.
          if (entry.table === 'items') {
            const { rows: held } = await client.query(
              'SELECT count(*)::int AS n FROM player_inventory WHERE item_id=$1', [old.id]);
            if (held[0].n) console.warn(`  ⚠ deleting items/${old.id} orphans ${held[0].n} player_inventory row(s) — players holding it will see the item vanish.`);
          }
          const res = await client.query(`DELETE FROM ${entry.table} WHERE ${pkWhere}${scope}`, pkVals);
          if (res.rowCount) {
            totalDel += res.rowCount;
            console.log(`  − ${table} ${entry.pk.map(c => old[c]).join('/')} (file deleted in ${marker.slice(0, 10)}..HEAD)`);
          }
        }
      }
    }

    // ── Upsert pass ───────────────────────────────────────────────────────────
    for (const { entry, files } of entries) {
      const types = await columnTypes(client, entry.table);
      // Absent-by-default override columns (registry omitWhenNull) are the one
      // case where a missing key is a STATEMENT — "no override" — rather than
      // "don't touch this". Force them into every upsert so removing an override
      // from a file actually clears the column; otherwise the old value would
      // survive in every database that ever imported it, and only a freshly
      // built one would match the files.
      const forcedNull = (entry.omitWhenNull || []).filter(c => types.has(c));
      let ins = 0, upd = 0;
      for (const f of files) {
        const cols = Object.keys(f.data).filter(c => types.has(c));
        for (const c of forcedNull) if (!cols.includes(c)) cols.push(c);
        const unknown = Object.keys(f.data).filter(c => !types.has(c));
        if (unknown.length) throw new Error(`${entry.table}/${f.name}: unknown column(s) ${unknown.join(', ')} — stale file or missing schema change.`);
        const nonPk = cols.filter(c => !entry.pk.includes(c));
        const colList = cols.map(c => `"${c}"`).join(', ');
        const params = cols.map((c, i) => `$${i + 1}`).join(', ');
        const values = cols.map(c => paramFor(f.data[c], types.get(c)));
        const conflict = entry.pk.map(c => `"${c}"`).join(', ');
        let sql;
        if (nonPk.length) {
          const set = nonPk.map(c => `"${c}"=EXCLUDED."${c}"`).join(', ');
          const distinct = `(${nonPk.map(c => `${entry.table}."${c}"`).join(', ')}) IS DISTINCT FROM (${nonPk.map(c => `EXCLUDED."${c}"`).join(', ')})`;
          sql = `INSERT INTO ${entry.table} (${colList}) VALUES (${params})
                 ON CONFLICT (${conflict}) DO UPDATE SET ${set} WHERE ${distinct}
                 RETURNING (xmax = 0) AS inserted`;
        } else {
          sql = `INSERT INTO ${entry.table} (${colList}) VALUES (${params})
                 ON CONFLICT (${conflict}) DO NOTHING RETURNING (xmax = 0) AS inserted`;
        }
        const res = await client.query(sql, values);
        if (res.rows.length) res.rows[0].inserted ? ins++ : upd++;
      }
      totalIns += ins; totalUpd += upd;
      if (ins || upd) console.log(`  ${entry.table.padEnd(26)} +${ins} inserted, ~${upd} updated (${files.length} files)`);
    }

    // ── Derive pass (spec §9) ─────────────────────────────────────────────────
    // Reads the zones and regions this transaction just committed, plus the
    // palette, and rebuilds the generated tables. Writes ONLY generated tables —
    // never `zones` — so the drift report and the git-diff deletion pass need no
    // changes at all. Runs on every push at zero Neon egress, because CI does the
    // whole lint → import → regress cycle against a throwaway local Postgres.
    {
      const palette = readPalette();
      const [zoneRows, regionRows] = await Promise.all([
        client.query('SELECT id, marker, color, bg_color, ambient_theme, audio_theme_id, flags FROM zones'),
        client.query('SELECT id, defaults FROM regions'),
      ]);
      const { rows: derived } = await writeDerived(client, {
        zones: zoneRows.rows, regions: regionRows.rows, palette,
      });
      console.log(`  ${'zone_render (derived)'.padEnd(26)} ${derived} rows${palette ? '' : '  ⚠ no content/map/terrain.json — palette rung empty'}`);
    }

    // ── Advance the marker ────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO server_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [MARKER_KEY, head]);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(`✓ DRY RUN (rolled back): would insert ${totalIns}, update ${totalUpd}, delete ${totalDel} on ${host}.`);
    } else {
      await client.query('COMMIT');
      console.log(`✓ Imported into ${host}: ${totalIns} inserted, ${totalUpd} updated, ${totalDel} deleted. Marker → ${head.slice(0, 10)}.`);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }

  // Seed runtime-managed state (empty on a fresh DB) — LOCAL only. Runs through
  // the engine's db.js pool (DATABASE_URL = localhost here); prod's runtime state
  // persists across deploys and uses PROD_DATABASE_URL, so it's a deliberate
  // manual step there (`node --env-file=.env.prod scripts/content/seed-runtime.mjs`).
  if (!prod && !dryRun) {
    console.log('— seeding runtime state (local) —');
    const { seedRuntime } = await import('./seed-runtime.mjs');
    await seedRuntime();
  }
  process.exit(0);
} catch (e) {
  console.error('✗ content:import failed:', e.message);
  process.exit(1);
}
