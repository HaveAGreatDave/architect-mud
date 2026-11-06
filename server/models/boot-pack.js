// Boot pack: a big boot read comes out of Neon compressed, or not at all.
//
// A cold start reads the world over the wire, and that wire is the free tier's
// tightest limit: 21 MB of rows a boot, as JSON. Those same rows pack to about 2 MB
// with brotli, and between two boots they almost never change. So the first boot
// stores each big read in boot_pack, compressed, and later boots ask Postgres
// whether the rows still match it. If they do, the 2 MB comes back in place of the
// 21 MB. If not, it's the plain read, and that boot writes a new pack.
//
// THE FINGERPRINT IS WHAT MAKES IT SAFE. Postgres hashes the live rows itself, on
// every boot, so nothing about how the rows got that way matters: an import, the
// derive pass, a runtime INSERT, a hand edit on prod. A pack is only ever used if it
// holds what the plain read would have returned. That's why this isn't a read of the
// checkout: the files aren't what the database holds (derive writes columns of its
// own), and a cache that has to know every writer is wrong the day one is added.
//
// Hashing costs Neon compute (about 300 ms over the whole world) and no egress: the
// answer is one short string. The pack goes up on a write, and only reads are billed.
//
// Production only, because a dev database lives next to the server and a pack would
// save nothing. BOOT_PACK=1 turns it on elsewhere, for testing.
//
// Every failure falls through to the plain read. A boot never depends on a pack.
import v8 from 'node:v8';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompress, constants } from 'node:zlib';
import { query } from './db.js';

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);

// v8.serialize keeps what pg hands back (Dates, Buffers, undefined) where JSON would
// turn a Date into a string. Its format belongs to the engine, so a new Node version
// reads as a miss rather than a bad decode.
const FORMAT = `v8-br:${process.versions.v8}`;

// Order-free, so a table with no ORDER BY hashes the same however it's scanned. Each
// row's md5 is cut to 60 bits so it fits a bigint, and the sum is exact (numeric).
const fingerprintSql = (sql) => `
  SELECT count(*) || ':' || COALESCE(sum(('x' || substr(md5(q::text), 1, 15))::bit(60)::bigint), 0)
    FROM (${sql}) q`;

const pending = new Set();

/** Resolves once every pack this process started writing has landed. */
export function packsSettled() { return Promise.all(pending); }

const packStats = [];

/** What this process read: [{ key, rows, packed, bytes }]. `bytes` is the pack's size. */
export function bootPackStats() { return packStats; }

/** One line for the boot log, or nothing where packs are off. */
export function logBootPacks() {
  if (!packStats.length) return;
  const hits = packStats.filter((s) => s.packed);
  const mb = hits.reduce((a, s) => a + s.bytes, 0) / 1e6;
  const missed = packStats.filter((s) => !s.packed).map((s) => s.key);
  console.log(`  ⇢ boot pack: ${hits.length}/${packStats.length} reads from packs, ${mb.toFixed(2)} MB${missed.length ? `; read plain: ${missed.join(', ')}` : ''}`);
}

async function writePack(key, sql, params, fingerprint, serialized) {
  const payload = await compress(serialized, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 6,
      [constants.BROTLI_PARAM_LGWIN]: 24,
      [constants.BROTLI_PARAM_SIZE_HINT]: serialized.length,
    },
  });
  // Text, not BYTEA: pg sends BYTEA as hex, double the size on the wire, and base64 is
  // a third. The hash is taken again because the rows were read after the first one.
  // If play changed them in between, this pack would be filed under rows it doesn't
  // hold, so it isn't written at all.
  const { rows } = await query(`SELECT (${fingerprintSql(sql)}) AS fingerprint`, params);
  if (rows[0].fingerprint !== fingerprint) return;
  await query(
    `INSERT INTO boot_pack (key, fingerprint, format, payload, raw_bytes, packed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (key) DO UPDATE
       SET fingerprint = $2, format = $3, payload = $4, raw_bytes = $5, packed_at = NOW()`,
    [key, fingerprint, FORMAT, payload.toString('base64'), serialized.length],
  );
}

/**
 * The rows of `sql`, from the pack under `key` if it still matches them. Always packs,
 * so call packedRows from a loader; this is here for the tests.
 *
 * `key` must only ever mean one query. Different `params` under one key are safe,
 * since they'd return different rows and miss, but they'd overwrite each other's pack.
 */
export async function readPacked(key, sql, params = []) {
  let fingerprint = null;
  try {
    // query-lint-ok: boot only, and it returns one row. This is what replaces the full read.
    const { rows } = await query(
      `WITH live AS (${fingerprintSql(sql)})
       SELECT l.fp AS fingerprint, p.payload
         FROM (SELECT * FROM live) AS l(fp)
         LEFT JOIN boot_pack p ON p.key = $${params.length + 1}
                              AND p.fingerprint = l.fp AND p.format = $${params.length + 2}`,
      [...params, key, FORMAT],
    );
    fingerprint = rows[0].fingerprint;
    if (rows[0].payload) {
      const packed = Buffer.from(rows[0].payload, 'base64');
      const out = v8.deserialize(await decompress(packed));
      packStats.push({ key, rows: out.length, packed: true, bytes: packed.length });
      return out;
    }
  } catch (err) {
    console.warn(`⚠ boot pack: ${key} unreadable, reading it plain: ${err.message}`);
  }

  // query-lint-ok: the plain read a loader made before packs existed.
  const { rows } = await query(sql, params);
  packStats.push({ key, rows: rows.length, packed: false, bytes: 0 });
  if (fingerprint !== null) {
    // Serialized NOW, not in the background: the caller keeps these row objects and
    // the game mutates them from here on. The compress and the write don't hold up boot.
    const serialized = v8.serialize(rows);
    const job = writePack(key, sql, params, fingerprint, serialized)
      .catch((err) => console.warn(`⚠ boot pack: ${key} not written: ${err.message}`))
      .finally(() => pending.delete(job));
    pending.add(job);
  }
  return rows;
}

/** A boot loader's full-table read. Packed in production, a plain query everywhere else. */
export async function packedRows(key, sql, params = []) {
  if (process.env.CONTENT_READONLY || process.env.BOOT_PACK) return readPacked(key, sql, params);
  // query-lint-ok: boot loader; see the caller.
  return (await query(sql, params)).rows;
}
