// content:status — "do I have unexported local content changes?"
//
//   npm run content:status
//
// Exports the local DB's content into a temp directory and diffs it against the
// content/ working tree. Exit 0 = clean (files fully reflect your DB), exit 1 =
// you have local DB edits that aren't in files yet (run content:export) or file
// changes not yet imported (run content:import). The daily safety check before
// pulling or walking away.
import 'dotenv/config';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectTarget, exportContent, CONTENT_DIR } from './lib.mjs';
import { contentEntries } from '../../server/models/content-registry.js';

const tempDir = mkdtempSync(join(tmpdir(), 'architect-content-'));
try {
  const { client } = await connectTarget({ purpose: 'diff content of' });
  await exportContent(client, tempDir);
  await client.end();

  let dirty = 0;
  for (const entry of contentEntries()) {
    const dbDir = join(tempDir, entry.table);
    const fileDir = join(CONTENT_DIR, entry.table);
    const dbFiles = existsSync(dbDir) ? new Set(readdirSync(dbDir).filter(f => f.endsWith('.json'))) : new Set();
    const treeFiles = existsSync(fileDir) ? new Set(readdirSync(fileDir).filter(f => f.endsWith('.json'))) : new Set();
    const onlyDb = [...dbFiles].filter(f => !treeFiles.has(f));
    const onlyTree = [...treeFiles].filter(f => !dbFiles.has(f));
    const changed = [...dbFiles].filter(f => treeFiles.has(f)
      && readFileSync(join(dbDir, f), 'utf8') !== readFileSync(join(fileDir, f), 'utf8'));
    if (onlyDb.length || onlyTree.length || changed.length) {
      dirty += onlyDb.length + onlyTree.length + changed.length;
      console.log(`  ${entry.table}:`);
      for (const f of onlyDb.slice(0, 10)) console.log(`    + ${f}  (in DB, not in files — unexported)`);
      for (const f of changed.slice(0, 10)) console.log(`    ~ ${f}  (DB differs from file)`);
      for (const f of onlyTree.slice(0, 10)) console.log(`    - ${f}  (file exists, row absent — unimported or deleted locally)`);
      const more = Math.max(0, onlyDb.length - 10) + Math.max(0, changed.length - 10) + Math.max(0, onlyTree.length - 10);
      if (more) console.log(`    … and ${more} more`);
    }
  }
  if (dirty) {
    console.log(`✗ ${dirty} entity(ies) differ between your DB and content/. Export (DB→files) or import (files→DB) to reconcile.`);
    process.exit(1);
  }
  console.log('✓ content/ matches your local DB.');
  process.exit(0);
} catch (e) {
  console.error('✗ content:status failed:', e.message);
  process.exit(1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
