/**
 * Fit lines — the authored half of the fit model.
 *
 * mis-body.js computes WHICH band an act lands in; this decides what anyone
 * reads. Rows live in `mis_fit_lines` and are edited in the dev panel (MIS Fit
 * tab), one row per (hole, band) with three pools:
 *
 *   actor_lines   — private, to the giver
 *   target_lines  — private, to the receiver
 *   zone_lines    — the room, third person
 *
 * READ TIER: loaded once into memory at boot and re-read only when the dev panel
 * writes. These are read on the act path, so a query here would be a round trip
 * per act — the same rule the tunables and crime tables follow.
 *
 * An empty pool falls back to the ordinary act text, so the model is fully
 * functional with this table empty. Nothing here is required.
 */
import { query } from '../../server/models/db.js';

// `${hole}:${band}` → { actor: [], target: [], zone: [] }
let CACHE = new Map();

export const HOLES = ['pussy', 'ass', 'mouth', 'throat'];

export async function loadFitLines() {
  const next = new Map();
  try {
    const { rows } = await query('SELECT hole, band, actor_lines, target_lines, zone_lines FROM mis_fit_lines');
    for (const r of rows) {
      next.set(`${r.hole}:${r.band}`, {
        actor:  Array.isArray(r.actor_lines)  ? r.actor_lines  : [],
        target: Array.isArray(r.target_lines) ? r.target_lines : [],
        zone:   Array.isArray(r.zone_lines)   ? r.zone_lines   : [],
      });
    }
  } catch (e) {
    // A missing table degrades to "no authored lines", never a boot failure.
    console.error(`[mis] fit lines load failed: ${e.message}`);
  }
  CACHE = next;
  return CACHE.size;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────
//
// The bulk-authoring layer. Rather than writing every band's lines out in full,
// you define a word list ONCE — `TIGHT_ADJ = snug, gripping, vice-tight` — and
// reference it from any number of templates as [TIGHT_ADJ]. Each render picks a
// word at random, so one template with three slots and five words per slot is
// 125 distinct lines without writing any of them.
//
// Stored in `server_settings` (a key/value store that already exists) rather
// than its own table: it's one small JSON blob, edited rarely, read from memory.
const VOCAB_KEY = 'mis_fit_vocab';
let VOCAB = new Map();   // NAME → [words]

export async function loadFitVocab() {
  try {
    const { rows } = await query('SELECT value FROM server_settings WHERE key=$1', [VOCAB_KEY]);
    const raw = rows.length ? JSON.parse(rows[0].value || '{}') : {};
    VOCAB = new Map(Object.entries(raw).map(([k, v]) => [
      k.toUpperCase(),
      (Array.isArray(v) ? v : String(v).split(',')).map(s => String(s).trim()).filter(Boolean),
    ]));
  } catch (e) {
    console.error(`[mis] fit vocab load failed: ${e.message}`);
    VOCAB = new Map();
  }
  return VOCAB.size;
}

export function allFitVocab() {
  return Object.fromEntries([...VOCAB].map(([k, v]) => [k, v]));
}

export async function saveFitVocab(dict) {
  const clean = {};
  for (const [k, v] of Object.entries(dict || {})) {
    const name = String(k).trim().toUpperCase().replace(/[^A-Z0-9_ ]/g, '');
    if (!name) continue;
    const words = (Array.isArray(v) ? v : String(v).split(/[,\n]/))
      .map(s => String(s).trim()).filter(Boolean);
    if (words.length) clean[name] = words;
  }
  await query(
    `INSERT INTO server_settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    [VOCAB_KEY, JSON.stringify(clean)]
  );
  await loadFitVocab();
  return Object.keys(clean).length;
}

// [NAME] → a random word from that list. An unknown name is left exactly as it
// was written, so an unfilled placeholder is visible rather than silently blank —
// you want to SEE that you never defined [SOME_ADJ].
function expandVocab(text) {
  return String(text).replace(/\[([A-Z0-9_ ]+)\]/g, (whole, name) => {
    const words = VOCAB.get(name.trim().toUpperCase());
    if (!words?.length) return whole;
    return words[Math.floor(Math.random() * words.length)];
  });
}

/**
 * Pick a line for a pool. Sync, cache-only, safe on the act path.
 * Returns null when nothing is authored — callers keep their existing text.
 *
 * Tokens available to authors: {actor} {target} {part} {size} {capacity}
 * Vocabulary slots: [ANY_NAME] you have defined in the vocabulary editor.
 */
export function fitLine(hole, band, pool, vars = {}) {
  const entry = CACHE.get(`${hole}:${band}`);
  const list = entry?.[pool];
  if (!list?.length) return null;
  const raw = list[Math.floor(Math.random() * list.length)];
  return expandVocab(String(raw).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`));
}

// Preview for the dev panel: the same expansion, run N times, so an author can
// see the spread a template actually produces before committing to it.
export function previewFitLine(text, vars = {}, n = 3) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(expandVocab(String(text).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)));
  }
  return out;
}

export function allFitLines() {
  const out = [];
  for (const [key, v] of CACHE) {
    const [hole, band] = key.split(':');
    out.push({ id: key, hole, band, actor_lines: v.actor, target_lines: v.target, zone_lines: v.zone });
  }
  return out;
}

export async function saveFitLines(hole, band, { actor_lines = [], target_lines = [], zone_lines = [] }) {
  const id = `${hole}:${band}`;
  await query(
    `INSERT INTO mis_fit_lines (id, hole, band, actor_lines, target_lines, zone_lines, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET actor_lines=EXCLUDED.actor_lines,
       target_lines=EXCLUDED.target_lines, zone_lines=EXCLUDED.zone_lines,
       updated_at=EXCLUDED.updated_at`,
    [id, hole, band, JSON.stringify(actor_lines), JSON.stringify(target_lines), JSON.stringify(zone_lines)]
  );
  await loadFitLines();
  return id;
}
