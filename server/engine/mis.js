/**
 * MIS consent substrate — the engine-owned gate for mature content.
 *
 * This is deliberately ALL that remains engine-side of MIS: multiple unrelated
 * systems (bodily targeting, appearance rendering, the MORPHEX machine, admin
 * routes) need to ask "is mature content on for this player?", so the flag is
 * a substrate. Everything MIS *does* — horniness, events, climax, verbs —
 * lives in plugins/mis/ (Phase 2, docs/proposals/engine-plugin-boundary.md).
 *
 * Gated: server setting mis_enabled='true' AND player.mis_enabled=1.
 * Players opt in via the hidden Maturity Slider in client settings.
 */
import { query } from '../models/db.js';
let serverMisEnabled = false; // default; DB overrides at load

export async function loadMisSettings() {
  const { rows } = await query(`SELECT value FROM server_settings WHERE key='mis_enabled'`);
  serverMisEnabled = rows.length ? rows[0].value === 'true' : false;
}

export function isMisServerEnabled() { return serverMisEnabled; }

export async function setServerMisEnabled(enabled) {
  serverMisEnabled = !!enabled;
  const val = serverMisEnabled ? 'true' : 'false';
  await query(`INSERT INTO server_settings (key,value) VALUES ('mis_enabled',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [val]);
}

export function isMisActive(player) {
  return serverMisEnabled && (player.mis_enabled === 1 || player.mis_enabled === true);
}

// The canon set. 'None' is a real answer, not an absence — it opts a character out
// of every attraction-driven beat (passive arousal on examine, willing threesome
// joiner, the receiver's share of a partner's arousal) while leaving the MIS verbs
// they choose to type working.
export const SEXUALITIES = ['Male', 'Female', 'Male and Female', 'None'];

// Returns true if `viewer` is attracted to the biological sex of `target`.
// An unset sexuality answers false rather than defaulting to 'Male': nothing
// should decide a character is attracted to men because nobody asked them.
export function isAttractedTo(viewer, target) {
  if (!viewer || !target) return false;
  const sex = target.biological_sex; // 'male' or 'female'
  const sexuality = viewer.sexuality;
  if (!sexuality || sexuality === 'None') return false;
  if (sexuality === 'Male and Female') return true;
  if (sex === 'male'   && sexuality === 'Male')   return true;
  if (sex === 'female' && sexuality === 'Female') return true;
  return false;
}
