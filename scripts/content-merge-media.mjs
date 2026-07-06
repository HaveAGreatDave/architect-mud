// Broadcast/media reconciliation: adopt PROD's media as canonical on your LOCAL,
// clean up the stale channel-rebuild furniture, and graft back the few local edits
// worth keeping. Reads prod, writes local. DRY-RUN by default (does everything in a
// transaction, prints the result, then ROLLS BACK). Pass --commit to persist.
//
//   node scripts/content-merge-media.mjs            # dry run: show what would change
//   node scripts/content-merge-media.mjs --commit   # apply it
//
// Why this is separate from content-pull-prod: the media_* tables are entangled with
// FURNITURE (cameras + the media deck are furniture rows keyed by flags.channel_id),
// and a channel rebuild left LOCAL carrying two generations of camera/deck furniture.
// TVs bind by channel .number (not id), so swapping the channel id is safe as long as
// .number is preserved — which it is (both sides are channel 7).
//
// Strategy (prod = canonical):
//   1. snapshot local media_broadcasts + media_graphics (for the grafts)
//   2. delete ALL local media_* rows + ALL camera/deck furniture (both generations)
//   3. insert prod's media_* rows + prod's camera/deck furniture
//   4. graft back local keepers by recency:
//        · local-only graphics (id absent on prod)              -> re-insert   [jackpot_protocol_logo]
//        · shared graphics where local is newer                 -> keep local content [jerry_rosenberg_logo]
//        · broadcasts matched by name where local is newer      -> keep local body    [Neil McManistan graph]
//   TVs are untouched (they tune by number 7). The studio zone is preserved (we do NOT
//   use the app's channel-delete, which would apiDeleteZone the studio).
import 'dotenv/config';
import pg from 'pg';

const COMMIT = process.argv.includes('--commit');
const LOCAL = process.env.DATABASE_URL, PROD = process.env.PROD_DATABASE_URL;
if (!LOCAL || !PROD) { console.error('✗ Need DATABASE_URL (local) + PROD_DATABASE_URL in .env'); process.exit(1); }
if (/^(localhost|127\.0\.0\.1|::1)$/.test(new URL(PROD).hostname)) { console.error('✗ PROD_DATABASE_URL must be remote.'); process.exit(1); }
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(new URL(LOCAL).hostname)) { console.error('✗ DATABASE_URL must be localhost — this writes to it.'); process.exit(1); }

const prod = new pg.Client({ connectionString: PROD, ssl: { rejectUnauthorized: false } });
const local = new pg.Client({ connectionString: LOCAL });
await prod.connect(); await local.connect();

// ── serialization (jsonb-aware, matches buildDump) ───────────────────────────
const esc = (s) => s.replace(/'/g, "''");
const val = (v, cast) => {
  if (v === null || v === undefined) return 'NULL';
  if (cast) return `'${esc(JSON.stringify(v))}'::${cast}`;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${esc(JSON.stringify(v))}'::jsonb`;
  return `'${esc(String(v))}'`;
};
async function copy(table, where) {
  const res = await prod.query(`SELECT * FROM ${table}${where ? ' WHERE ' + where : ''}`);
  if (!res.rows.length) return 0;
  const cols = Object.keys(res.rows[0]);
  const cast = new Map((res.fields || []).filter(f => f.dataTypeID === 3802 || f.dataTypeID === 114)
    .map(f => [f.name, f.dataTypeID === 114 ? 'json' : 'jsonb']));
  const colList = cols.map(c => `"${c}"`).join(', ');
  for (const row of res.rows) {
    const vals = cols.map(c => val(row[c], cast.get(c))).join(', ');
    await local.query(`INSERT INTO ${table} (${colList}) VALUES (${vals}) ON CONFLICT DO NOTHING`);
  }
  return res.rows.length;
}
const MEDIA_FURN = `((flags->>'camera_id') IS NOT NULL OR (flags->>'broadcast_transmitter')='true' OR (flags->>'media_deck')='true')`;

console.log(`\n  ${COMMIT ? '⚙ COMMIT MODE — changes will persist' : '◐ DRY RUN — will roll back at the end (pass --commit to apply)'}\n`);

// ── 1. snapshot local keepers BEFORE we delete ───────────────────────────────
const lBroadcasts = (await local.query('SELECT * FROM media_broadcasts')).rows;
const lGraphics   = (await local.query('SELECT * FROM media_graphics')).rows;
const pGraphics   = (await prod.query('SELECT id, content, type, updated_at FROM media_graphics')).rows;
const pBroadcasts = (await prod.query('SELECT name, broadcast_graph, weather_pools, sports_pools, fallback_messages, updated_at FROM media_broadcasts')).rows;
const pGfById = new Map(pGraphics.map(r => [r.id, r]));
const pBcByName = new Map(pBroadcasts.map(r => [r.name, r]));
const localChIds = (await local.query('SELECT id FROM media_channels')).rows.map(r => r.id);
const j = (v) => JSON.stringify(v ?? null);
const newer = (a, b) => (Number(a) || 0) > (Number(b) || 0);
const bcBody = (r) => j([r.broadcast_graph, r.weather_pools, r.sports_pools, r.fallback_messages]);

await local.query('BEGIN');
await local.query('SET CONSTRAINTS ALL DEFERRED');
try {
  // ── 2. delete local media + all media furniture (both channel generations) ──
  const staleFurn = (await local.query(`SELECT count(*)::int n FROM furniture WHERE ${MEDIA_FURN}`)).rows[0].n;
  for (const t of ['media_channel_playlist','media_deck_units','media_cameras','media_broadcasts','media_channels','media_themes','media_graphics'])
    await local.query(`DELETE FROM ${t}`);
  await local.query(`DELETE FROM furniture WHERE ${MEDIA_FURN}`);
  console.log(`  cleared local media (7 tables) + ${staleFurn} camera/deck furniture row(s)`);

  // ── 3. insert prod media (FK-safe order) + prod camera/deck furniture ────────
  const counts = {};
  for (const t of ['media_themes','media_broadcasts','media_channels','media_cameras','media_deck_units','media_channel_playlist','media_graphics'])
    counts[t] = await copy(t);
  const furnN = await copy('furniture', MEDIA_FURN);
  console.log(`  inserted prod media: ` + Object.entries(counts).map(([k,v]) => `${k.replace('media_','')} ${v}`).join(', ') + `, furniture ${furnN}`);

  // ── 4. graft local keepers by recency ────────────────────────────────────────
  const grafts = [];
  // local-only graphics (absent on prod) -> re-insert
  for (const g of lGraphics) if (!pGfById.has(g.id)) {
    await local.query(`INSERT INTO media_graphics (id,name,description,type,content,tags) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO NOTHING`,
      [g.id, g.name, g.description ?? '', g.type ?? 'ascii', g.content ?? '', JSON.stringify(g.tags ?? [])]);
    grafts.push(`+graphic ${g.id} (local-only)`);
  }
  // shared graphics that genuinely DIFFER and where local is newer -> keep local content
  for (const g of lGraphics) { const p = pGfById.get(g.id); if (!p) continue;
    if ((g.content !== p.content || g.type !== p.type) && newer(g.updated_at, p.updated_at)) {
      await local.query(`UPDATE media_graphics SET content=$2, type=$3 WHERE id=$1`, [g.id, g.content, g.type]);
      grafts.push(`~graphic ${g.id} (local content newer)`);
    }
  }
  // broadcasts matched by name whose BODY genuinely differs and where local is newer -> keep local body
  for (const b of lBroadcasts) { const p = pBcByName.get(b.name); if (!p) continue;
    if (bcBody(b) !== bcBody(p) && newer(b.updated_at, p.updated_at)) {
      await local.query(
        `UPDATE media_broadcasts SET broadcast_graph=$2::jsonb, weather_pools=$3::jsonb, sports_pools=$4::jsonb, fallback_messages=$5::jsonb WHERE name=$1`,
        [b.name, j(b.broadcast_graph), j(b.weather_pools), j(b.sports_pools), j(b.fallback_messages)]);
      grafts.push(`~broadcast "${b.name.slice(0,34)}" (local body newer)`);
    }
  }
  console.log(`  grafts: ` + (grafts.length ? '\n    ' + grafts.join('\n    ') : '(none)'));

  // ── verify ───────────────────────────────────────────────────────────────────
  const q = async (s,p=[]) => (await local.query(s,p)).rows;
  const ch = await q('SELECT id, number, name FROM media_channels');
  const bc = await q('SELECT count(*)::int n FROM media_broadcasts');
  const jack = await q(`SELECT count(*)::int n FROM media_graphics WHERE id='jackpot_protocol_logo'`);
  const orphan = await q(`SELECT count(*)::int n FROM furniture WHERE flags->>'channel_id' = ANY($1)`, [localChIds]);
  const camFurn = await q(`SELECT count(*)::int n FROM furniture WHERE ${MEDIA_FURN}`);
  console.log(`\n  ── verification ──`);
  console.log(`  channels: ${ch.map(c=>c.name+' #'+c.number+' ['+c.id+']').join(', ')}`);
  console.log(`  broadcasts: ${bc[0].n}   jackpot_protocol_logo present: ${jack[0].n===1?'yes':'NO ⚠'}`);
  console.log(`  media furniture rows: ${camFurn[0].n}   stale (old local-channel) furniture left: ${orphan[0].n===0?'0 ✓':orphan[0].n+' ⚠'}`);

  if (COMMIT) { await local.query('COMMIT'); console.log(`\n✓ COMMITTED. Restart the server (or reload broadcast runtime) so the tunings/channels reload.\n`); }
  else { await local.query('ROLLBACK'); console.log(`\n◐ DRY RUN complete — rolled back, nothing changed. Re-run with --commit to apply.\n`); }
} catch (e) {
  await local.query('ROLLBACK');
  console.error('\n✗ Failed, rolled back:', e.message, '\n');
  process.exitCode = 1;
}
await prod.end(); await local.end();
