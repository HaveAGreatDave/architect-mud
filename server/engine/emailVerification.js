import { query } from '../models/db.js';

let emailVerificationEnabled = true; // default on

export async function loadEmailVerificationSetting() {
  const { rows } = await query(`SELECT value FROM server_settings WHERE key='email_verification_enabled'`);
  if (rows.length) emailVerificationEnabled = rows[0].value !== 'false';
}

export function isEmailVerificationEnabled() { return emailVerificationEnabled; }

export async function setEmailVerificationEnabled(enabled) {
  emailVerificationEnabled = !!enabled;
  const val = emailVerificationEnabled ? 'true' : 'false';
  await query(`INSERT INTO server_settings (key,value) VALUES ('email_verification_enabled',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [val]);
}
