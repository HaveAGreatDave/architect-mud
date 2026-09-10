/**
 * Accolades — a sardonic achievement system.
 *
 * The conceit: these are not awards, they are entries in a file something keeps
 * on you. The prologue already establishes the watcher ("somewhere far above, an
 * algorithm notes that its very large number is, once again, correct"), so the
 * system is that algorithm doing its filing. Nothing is earned; it is merely
 * observed. Every entry is worth exactly 1 XP, forever, including the hardest —
 * the flatness is the joke.
 *
 * Design constraints worth keeping if you touch this:
 *   • DISCOVERY-ONLY. There is no list of locked entries, no total, no denominator.
 *     Adding entry N+1 is invisible to players by construction, which is why the
 *     launch set can be small and grow silently.
 *   • FULLY PRIVATE. No zone broadcast, no `file <player>`. Your file is yours.
 *   • UNIQUE UNLOCK is the whole XP safety story. The composite PK on
 *     player_achievements caps lifetime grant at one per entry — currently 12 XP
 *     across a character's entire life, against 100 XP per stat point. There is
 *     no grind here because there is nothing repeatable.
 *
 * Read-tier note (docs/architecture.md): the triggers hang off hot events
 * (zone.entered fires on every move), so this plugin never awaits a DB read on a
 * trigger path. Per-player unlock sets load once at login into memory; counters
 * are in-memory and flushed on logout. The only queries are the initial load, the
 * one INSERT per genuine unlock, and the `file` verb's own read.
 */
import { query } from '../../server/models/db.js';
import { getFlagsByPrefix, setFlags } from '../../server/engine/flags.js';
import { on, emit } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { grantXp } from '../../server/engine/ip.js';
import { ENTRIES, BY_KEY, LISTENED_EVENTS } from './catalog.js';

// playerId -> { unlocked:Set<key>, counters:Map<string,number>, dirty:boolean }
const state = new Map();

function blank() {
  return { unlocked: new Set(), counters: new Map(), dirty: false };
}

/**
 * Counters are deliberately memory-first and flushed on logout, not per bump.
 * A bump can happen on every single move, and a per-bump write would put a DB
 * round trip on the movement path — the exact thing the read-tier rules forbid.
 * The tradeoff is bounded and cheap: a hard server kill loses partial progress
 * toward a threshold entry (nine of ten deaths), never a granted one, because
 * unlocks are written immediately and synchronously.
 */
// `bump`/`has` always take an explicit player id, so the context is stateless and
// no entry is ever created for an unidentified actor.
const CTX = {
  bump(id, key) {
    if (!id) return 0;
    let t = state.get(id);
    if (!t) { t = blank(); state.set(id, t); }
    const next = (t.counters.get(key) || 0) + 1;
    t.counters.set(key, next);
    t.dirty = true;
    return next;
  },
  has: (id, key) => !!state.get(id)?.unlocked.has(key),
};

async function loadPlayer(playerId) {
  if (!playerId || state.has(playerId)) return state.get(playerId);
  const s = blank();
  state.set(playerId, s);           // set first: concurrent events reuse this object
  try {
    const [{ rows: unlocked }, counters] = await Promise.all([
      query('SELECT entry_key FROM player_achievements WHERE player_id = $1', [playerId]),
      getFlagsByPrefix(playerId, 'rec_'),
    ]);
    for (const r of unlocked) s.unlocked.add(r.entry_key);
    for (const [flagKey, flagValue] of counters) s.counters.set(flagKey.slice(4), Number(flagValue) || 0);
  } catch (e) {
    console.error('[accolades] load failed for', playerId, e.message);
  }
  return s;
}

async function flushCounters(playerId) {
  const s = state.get(playerId);
  if (!s?.dirty || !s.counters.size) return;
  s.dirty = false;
  const entries = [...s.counters].map(([k, v]) => [`rec_${k}`, String(v)]);
  try {
    // Still one round trip for the whole counter set — now through the flag
    // store, so a live player's cached Map moves with it.
    await setFlags(playerId, entries);
  } catch (e) {
    console.error('[accolades] counter flush failed for', playerId, e.message);
  }
}

/**
 * Log an entry. The INSERT's rowCount is the source of truth for "was this
 * genuinely new" — not the in-memory Set — so two events racing the same unlock
 * can only ever grant XP once.
 */
async function logEntry(playerId, entry) {
  const s = state.get(playerId) || blank();
  if (!state.has(playerId)) state.set(playerId, s);
  if (s.unlocked.has(entry.key)) return false;
  s.unlocked.add(entry.key);        // optimistic, so a same-tick re-trigger short-circuits

  let inserted = false;
  try {
    const res = await query(
      `INSERT INTO player_achievements (player_id, entry_key) VALUES ($1, $2)
       ON CONFLICT (player_id, entry_key) DO NOTHING`,
      [playerId, entry.key]
    );
    inserted = res.rowCount > 0;
  } catch (e) {
    s.unlocked.delete(entry.key);   // let it try again rather than silently vanish
    // 23503 = FK violation: the "player" isn't one. Enemies, transient combat
    // actors, corpses and the regress harness's fake player all surface through
    // these events with ids that have no players row — that's the FK doing its
    // job, not an error worth a line of console per move.
    if (e.code !== '23503') console.error('[accolades] insert failed', entry.key, e.message);
    return false;
  }
  if (!inserted) return false;      // already on file from another session

  await grantXp(playerId, 1);

  sendToPlayer(playerId, {
    type: 'accolade_unlocked',
    title: entry.title,
    line: entry.line,
    xp: 1,
  });

  emit('accolade.unlocked', { playerId, key: entry.key, total: s.unlocked.size });
  return true;
}

// One subscription per distinct event in the catalog. An entry that uses a new
// event needs no wiring here — LISTENED_EVENTS is derived from the catalog.
for (const evt of LISTENED_EVENTS) {
  on(evt, async (payload) => {
    for (const entry of ENTRIES) {
      if (entry.on !== evt) continue;
      let playerId;
      try {
        playerId = entry.test(payload, CTX);
      } catch (e) {
        console.error('[accolades] test threw for', entry.key, e.message);
        continue;
      }
      if (!playerId) continue;
      if (state.get(playerId)?.unlocked.has(entry.key)) continue;
      try {
        await logEntry(playerId, entry);
      } catch (e) {
        console.error('[accolades] unlock failed for', entry.key, e.message);
      }
    }
  });
}

on('player.login', ({ id }) => { if (id) loadPlayer(id); });
on('player.logout', async ({ id }) => {
  if (!id) return;
  await flushCounters(id);
  state.delete(id);
});

/** Entries on a player's file, newest first. Used by the verb and the tablet app. */
export async function fileFor(playerId) {
  const { rows } = await query(
    `SELECT entry_key, unlocked_at FROM player_achievements
     WHERE player_id = $1 ORDER BY unlocked_at DESC, entry_key DESC`,
    [playerId]
  );
  return rows
    .map((r) => {
      const e = BY_KEY.get(r.entry_key);
      // A row whose entry was retired from the catalog is skipped rather than
      // rendered blank — the fact stays in the DB, it just has nothing to say.
      return e ? { key: r.entry_key, title: e.title, line: e.line, at: Number(r.unlocked_at) || 0 } : null;
    })
    .filter(Boolean);
}

/** Opening your own file is itself an observation. */
export function noteOpened(playerId) {
  emit('accolade.opened', { playerId });
}

async function cmdAccolades(args, raw, player) {
  const entries = await fileFor(player.id);
  noteOpened(player.id);

  if (!entries.length) {
    return {
      type: 'system',
      message: `<span class="system">Your file is empty. That isn't the same as clean.</span>`,
    };
  }

  const lines = entries.map(
    (e) =>
      `<span class="text-bright">${e.title}</span>\n` +
      `  <span class="ambient">${e.line}</span>`
  );
  return {
    type: 'system',
    message:
      `<span class="system">━━ ACCOLADES ━━ ${entries.length} ` +
      `${entries.length === 1 ? 'entry' : 'entries'} on file</span>\n` +
      lines.join('\n') +
      `\n<span class="hint">Nothing here is earned. It's merely observed.</span>`,
  };
}

export const commands = {
  accolades: cmdAccolades,
  // `file` kept as a second verb rather than an alias: it is how the fiction
  // refers to the thing ("your file"), it reads better in play, and aliases.js is
  // reserved for pure abbreviations of an existing verb.
  file: cmdAccolades,
};
