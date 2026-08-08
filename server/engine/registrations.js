import { query } from '../models/db.js';

// Registration lock — a dev switch that closes the door on NEW accounts without
// touching anybody who already has one. Login, reset and every existing player
// keep working; only `/auth/register` is refused, and it's refused with a line
// the player is meant to READ, not a bare 403. Same shape as the mis /
// email-verification toggles: cached in memory, `server_settings` is the record.

const DEFAULT_MESSAGE =
  'New registrations are closed for the moment while we work on the world. ' +
  'They will open again — check back soon.';

let registrationsOpen = true; // default open
let closedMessage = DEFAULT_MESSAGE;

export async function loadRegistrationSettings() {
  const { rows } = await query(
    `SELECT key, value FROM server_settings WHERE key IN ('registrations_open','registrations_closed_message')`
  ).catch(() => ({ rows: [] }));
  for (const r of rows) {
    if (r.key === 'registrations_open') registrationsOpen = r.value !== 'false';
    if (r.key === 'registrations_closed_message' && r.value.trim()) closedMessage = r.value;
  }
}

export function areRegistrationsOpen() { return registrationsOpen; }
export function registrationsClosedMessage() { return closedMessage; }

export async function setRegistrationsOpen(open, message) {
  registrationsOpen = !!open;
  const writes = [
    query(
      `INSERT INTO server_settings (key,value) VALUES ('registrations_open',$1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [registrationsOpen ? 'true' : 'false']
    ),
  ];
  if (typeof message === 'string') {
    // An empty box means "use the house line", never a blank refusal.
    closedMessage = message.trim() || DEFAULT_MESSAGE;
    writes.push(query(
      `INSERT INTO server_settings (key,value) VALUES ('registrations_closed_message',$1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [closedMessage]
    ));
  }
  await Promise.all(writes);
}
