/**
 * Mastery state — hydration, the sync read API, and the coalesced flush.
 *
 * The ONLY writer of `player_reads` and `player_disciplines`. Everything else in
 * the plugin goes through the sync getters here, because every one of them is
 * called from the swing seam and the swing seam may not query.
 *
 * Storage contract copied wholesale from server/engine/relations.js: one query
 * at login, a Map on the live player thereafter, a dirty Set, a coalesced
 * multi-row upsert on a 1m cadence, and decay computed lazily at hydrate with no
 * sweep tick at all.
 */
import { query } from '../../server/models/db.js';

export const DISCIPLINES = Object.freeze([
  'body', 'movement', 'senses', 'mind', 'combat', 'pain', 'breath', 'will',
]);

// A read you have not touched in a fortnight is half what it was. Applied ONCE,
// at hydrate, against last_seen_at — never written back, never ticked. You find
// out you have gone rusty by walking back in, which is the right way to find out.
const DECAY_HALF_LIFE_DAYS = 14;

// The row cap. `archetype` is already bounded by the content roster rather than
// the spawner, so this should never bite — it is here so that a world with a
// thousand enemy templates still cannot make one player's login query expensive.
export const MAX_READ_ROWS = 64;

const ZERO_READ = Object.freeze({ familiarity: 0, exploits: Object.freeze([]) });

// ── hydration ───────────────────────────────────────────────────────────────

/**
 * Login hydration. TWO tables, ONE round trip — they are unioned rather than
 * read separately because this joins the existing login Promise.all and the
 * whole budget for the feature is a single statement.
 */
export async function hydrateMastery(player) {
  if (!player?.id) return;
  const { rows } = await query(
    `SELECT 'read' AS kind, archetype AS key, familiarity AS num, exploits AS extra, last_seen_at AS seen
       FROM player_reads WHERE player_id = $1
     UNION ALL
     SELECT 'disc' AS kind, discipline AS key, rank AS num, to_jsonb(taught_by) AS extra, updated_at AS seen
       FROM player_disciplines WHERE player_id = $1
     UNION ALL
     SELECT 'purity' AS kind, '' AS key, load AS num, NULL AS extra, updated_at AS seen
       FROM player_purity WHERE player_id = $1`,
    [player.id]
  );

  const reads = new Map();
  const disciplines = new Map();
  const now = Date.now();

  let purity = null;
  for (const r of rows) {
    if (r.kind === 'purity') {
      // Stamped with the DB's own last-write time, so the stain keeps fading
      // while the player is logged off — which is the whole point of it being
      // lazy rather than ticked.
      purity = { load: Number(r.num) || 0, at: (Number(r.seen) || 0) * 1000 };
      continue;
    }
    if (r.kind === 'read') {
      const fam = decayed(Number(r.num) || 0, Number(r.seen) || 0, now);
      // A read that has decayed to nothing is not worth carrying in memory or
      // writing back — it will simply be re-learned the next time you meet one.
      if (fam < 1) continue;
      reads.set(r.key, { familiarity: fam, exploits: Array.isArray(r.extra) ? r.extra : [] });
    } else {
      disciplines.set(r.key, Number(r.num) || 0);
    }
  }

  // Mutate the live player IN PLACE — the game loop holds direct references, so
  // clone-and-replace would leave half the engine talking to a stale object.
  player._reads = reads;
  player._disciplines = disciplines;
  player._readsDirty = new Set();
  player._disciplinesDirty = new Set();
  player._readHeat = new Map();       // per-INSTANCE, runtime only, never persisted
  // Left NULL when there is no row: purity.js seeds it from the body's actual
  // load on first read, so a player who has never been modified never gets a
  // row at all and an unmodified world costs this table nothing.
  player._purity = purity;
  player._purityDirty = false;
}

function decayed(familiarity, lastSeenSec, now) {
  if (!lastSeenSec || !familiarity) return familiarity;
  const days = (now / 1000 - lastSeenSec) / 86400;
  if (days <= 0) return familiarity;
  return familiarity * Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS);
}

// ── the sync read API (SYNC BY CONTRACT — no awaits, no queries) ────────────

/** What this fighter knows about a kind of opponent. Shared frozen zero when nothing. */
export function getRead(player, archetype) {
  return player?._reads?.get(archetype) || ZERO_READ;
}

/** Raw stored rank, BEFORE the purity cap. Use effectiveRank() for anything mechanical. */
export function storedRank(player, discipline) {
  return player?._disciplines?.get(discipline) || 0;
}

export function allRanks(player) {
  const out = {};
  for (const d of DISCIPLINES) out[d] = storedRank(player, d);
  return out;
}

// ── writes (sync into memory; the DB catches up on the 1m flush) ────────────

export function adjustRead(player, archetype, { familiarity = 0, exploit = null } = {}) {
  if (!player || !archetype) return null;
  // Self-healing lazy init: the regress harness builds player objects that never
  // went through hydrate, and a write that throws there is a test failure about
  // nothing. Same accommodation relations.js makes.
  if (!(player._reads instanceof Map)) player._reads = new Map();
  if (!(player._readsDirty instanceof Set)) player._readsDirty = new Set();

  const rec = player._reads.get(archetype) || { familiarity: 0, exploits: [] };
  if (familiarity) rec.familiarity = Math.max(0, Math.min(100, rec.familiarity + familiarity));
  if (exploit && !rec.exploits.includes(exploit)) rec.exploits = [...rec.exploits, exploit];
  player._reads.set(archetype, rec);
  player._readsDirty.add(archetype);
  return rec;
}

export function setRank(player, discipline, rank) {
  if (!player || !DISCIPLINES.includes(discipline)) return 0;
  if (!(player._disciplines instanceof Map)) player._disciplines = new Map();
  if (!(player._disciplinesDirty instanceof Set)) player._disciplinesDirty = new Set();
  const v = Math.max(0, Math.min(100, Number(rank) || 0));
  player._disciplines.set(discipline, v);
  player._disciplinesDirty.add(discipline);
  return v;
}

export function raiseRank(player, discipline, by) {
  return setRank(player, discipline, storedRank(player, discipline) + by);
}

// ── flush ───────────────────────────────────────────────────────────────────

export async function flushMastery(player) {
  if (!player?.id) return;
  const readKeys = [...(player._readsDirty || [])];
  const discKeys = [...(player._disciplinesDirty || [])];
  if (!readKeys.length && !discKeys.length && !player._purityDirty) return;

  const jobs = [];

  if (player._purityDirty && player._purity) {
    // `at` is rebased to now on every read, so the row's own updated_at is the
    // correct fade origin and the scalar needs no timestamp column of its own.
    jobs.push(query(
      `INSERT INTO player_purity (player_id, load, updated_at)
       VALUES ($1, $2, EXTRACT(EPOCH FROM NOW()))
       ON CONFLICT (player_id) DO UPDATE
         SET load = EXCLUDED.load, updated_at = EXCLUDED.updated_at`,
      [player.id, player._purity.load]
    ));
    player._purityDirty = false;
  }

  if (readKeys.length) {
    // Prune before writing, not after: the cap exists to bound the LOGIN query,
    // so a row that would push us over is better dropped than stored and read.
    prune(player);
    const rows = readKeys
      .filter(k => player._reads?.has(k))
      .map(k => ({ k, rec: player._reads.get(k) }));
    if (rows.length) {
      const vals = [];
      const params = [player.id];
      for (const { k, rec } of rows) {
        const i = params.length;
        params.push(k, rec.familiarity, JSON.stringify(rec.exploits || []));
        vals.push(`($1, $${i + 1}, $${i + 2}, $${i + 3}::jsonb, EXTRACT(EPOCH FROM NOW()))`);
      }
      jobs.push(query(
        `INSERT INTO player_reads (player_id, archetype, familiarity, exploits, last_seen_at)
         VALUES ${vals.join(', ')}
         ON CONFLICT (player_id, archetype) DO UPDATE
           SET familiarity = EXCLUDED.familiarity,
               exploits    = EXCLUDED.exploits,
               last_seen_at = EXCLUDED.last_seen_at`,
        params
      ));
    }
  }

  if (discKeys.length) {
    const vals = [];
    const params = [player.id];
    for (const d of discKeys) {
      const i = params.length;
      params.push(d, storedRank(player, d));
      vals.push(`($1, $${i + 1}, $${i + 2}, EXTRACT(EPOCH FROM NOW()))`);
    }
    jobs.push(query(
      `INSERT INTO player_disciplines (player_id, discipline, rank, updated_at)
       VALUES ${vals.join(', ')}
       ON CONFLICT (player_id, discipline) DO UPDATE
         SET rank = EXCLUDED.rank, updated_at = EXCLUDED.updated_at`,
      params
    ));
  }

  player._readsDirty?.clear();
  player._disciplinesDirty?.clear();
  if (jobs.length) await Promise.all(jobs);
}

function prune(player) {
  const reads = player._reads;
  if (!(reads instanceof Map) || reads.size <= MAX_READ_ROWS) return;
  const ordered = [...reads.entries()].sort((a, b) => b[1].familiarity - a[1].familiarity);
  for (const [k] of ordered.slice(MAX_READ_ROWS)) {
    reads.delete(k);
    player._readsDirty?.delete(k);
  }
}

export const _test = { decayed, prune, ZERO_READ };
