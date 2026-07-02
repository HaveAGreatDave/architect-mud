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

// Returns true if `viewer` is attracted to the biological sex of `target`.
// sexuality values: 'Male', 'Female', 'Male and Female'
export function isAttractedTo(viewer, target) {
  if (!viewer || !target) return false;
  const sex = target.biological_sex; // 'male' or 'female'
  const sexuality = viewer.sexuality || 'Male';
  if (sexuality === 'Male and Female') return true;
  if (sex === 'male'   && sexuality === 'Male')   return true;
  if (sex === 'female' && sexuality === 'Female') return true;
  return false;
}
