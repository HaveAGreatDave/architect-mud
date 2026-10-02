// Guest characters: the `register` verb that makes one permanent, the reminder a
// guest gets at login, and the sweep that deletes a guest nobody has played for
// GUEST_TTL_DAYS. Creation is the WebSocket `auth_guest` handler
// (server/index.js); what a guest can't do is engine/guest.js, read at dispatch.

import { query } from '../../server/models/db.js';
import { on } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { getLivePlayer } from '../../server/engine/world.js';
import { isGuest, GUEST_TTL_DAYS } from '../../server/engine/guest.js';
import { purgePlayers } from '../../server/engine/new-player.js';

const SWEEP_EVERY_MS = 6 * 60 * 60_000;
const SWEEP_BATCH = 200;
let lastSweep = 0;

// Opens the claim form. The fields go to the server as claim_account, never as
// a typed command, so the password stays out of the command log.
function cmdClaim(args, raw, player) {
  if (!isGuest(player)) return { type: 'error', message: 'This character already has an account.' };
  return { type: 'claim_form', handle: player.handle };
}

on('player.login', ({ id }) => {
  const p = getLivePlayer(id);
  if (!isGuest(p)) return;
  sendToPlayer(id, {
    type: 'output',
    message: `<span class="msg-system">You're playing as a guest. This browser is your only way back, and an unplayed guest is gone after ${GUEST_TTL_DAYS} days. Type ${teachVerb('register')} to keep the character.</span>`,
  });
});

// Unclaimed guests not seen for GUEST_TTL_DAYS. One select and one delete per
// table for the whole batch (purgePlayers). The scheduler only runs while
// somebody is online, and a cold start resets the hourly timer, so the run is
// throttled here rather than put on a 24h cadence that might never fire.
export async function sweepGuests(now = Date.now()) {
  const cutoff = Math.floor(now / 1000) - GUEST_TTL_DAYS * 86400;
  const { rows } = await query(
    `SELECT id FROM players WHERE role='guest' AND last_seen < $1 ORDER BY last_seen LIMIT ${SWEEP_BATCH}`,
    [cutoff]
  );
  if (!rows.length) return 0;
  const gone = await purgePlayers(rows.map(r => r.id));
  if (gone) console.log(`[guest] purged ${gone} expired guest${gone === 1 ? '' : 's'}`);
  return gone;
}

schedule('1h', async () => {
  if (Date.now() - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = Date.now();
  await sweepGuests().catch(e => console.error('[guest] sweep failed:', e.message));
});

export const commands = {
  register: cmdClaim,
};

console.log('[guest] Plugin loaded.');
