/**
 * Session tokens: minting, verification, revocation.
 *
 * The old token was `base64(playerId + ':' + role + ':' + issuedAt)` and nothing
 * else — no signature — so `role` was simply whatever the holder had typed into
 * it. Anyone who knew a player id could mint themselves `admin` and every
 * dev/admin route in the API would believe it. Tokens carry an HMAC now, and the
 * role is only trusted because the signature says the server issued it.
 *
 * ⚠ REVOCATION IS IN RAM *AND* PERSISTED, AND IT NEEDS BOTH. Verification runs
 * on every HTTP request and is SYNC BY CONTRACT — a DB read there would put a
 * round trip in front of every dev-panel call — so the per-player cutoff lives
 * in a Map. A Map on its own would resurrect every revoked token at the next
 * restart, which for a 24-hour TTL is most of a day's worth, so each cutoff is
 * also written to `player_flags` (the mandated home for per-player scalar state)
 * and the Map is hydrated once at boot.
 *
 * ⚠ THE SECRET MUST OUTLIVE THE PROCESS. Generated per boot, every token dies at
 * every restart and Render restarts free services constantly. AUTH_SECRET wins
 * where it is set; otherwise one is generated once and kept in `server_settings`.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { query } from '../models/db.js';
import { setFlagById } from './flags.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const EPOCH_FLAG   = 'auth_epoch';
const SECRET_KEY   = 'auth_token_secret';

let _secret = null;
let _warnedEphemeral = false;

// playerId → ms. A token issued at or before this is dead.
const _revokedBefore = new Map();

// Things that also need tearing down when a player's credentials change but that
// this module has no business knowing about — the live WebSocket session and its
// reconnect token, both owned by server/index.js. It registers one of these at
// boot. Kept as a list rather than an import so the substrate stays free of the
// server it runs inside.
const _alsoRevoke = [];
export function onRevoke(fn) { if (typeof fn === 'function') _alsoRevoke.push(fn); }

/**
 * Called once from boot(), before the HTTP server listens. Loads (or mints) the
 * signing secret and hydrates the revocation cutoffs.
 */
export async function loadAuthSecret() {
  if (process.env.AUTH_SECRET) {
    _secret = process.env.AUTH_SECRET;
  } else {
    const { rows } = await query('SELECT value FROM server_settings WHERE key=$1', [SECRET_KEY]);
    if (rows.length && rows[0].value) {
      _secret = rows[0].value;
    } else {
      // ⚠ DO NOTHING, then re-read. Two processes booting together would other-
      // wise each write their own secret and the loser would invalidate every
      // token the winner had already signed.
      const minted = randomBytes(32).toString('hex');
      await query(
        'INSERT INTO server_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING',
        [SECRET_KEY, minted]
      );
      const { rows: after } = await query('SELECT value FROM server_settings WHERE key=$1', [SECRET_KEY]);
      _secret = after[0]?.value || minted;
      console.log('[auth] minted a session-token secret (set AUTH_SECRET to pin it)');
    }
  }

  const { rows: epochs } = await query(
    'SELECT player_id, flag_value FROM player_flags WHERE flag_key=$1', [EPOCH_FLAG]
  );
  for (const row of epochs) {
    const at = Number(row.flag_value);
    if (Number.isFinite(at)) _revokedBefore.set(row.player_id, at);
  }
}

// A process that never called loadAuthSecret() — the regress suite, a one-shot
// script — still needs signing to work rather than to throw. It gets a throwaway
// secret, which is safe (nothing outside the process can forge against it) and
// loud, so a boot-ordering mistake in production is visible in the log.
function secret() {
  if (!_secret) {
    _secret = randomBytes(32).toString('hex');
    if (!_warnedEphemeral) {
      _warnedEphemeral = true;
      console.warn('[auth] no persisted token secret loaded — using an ephemeral one for this process');
    }
  }
  return _secret;
}

const mac = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function signToken(playerId, role) {
  const body = Buffer.from(`${playerId}:${role}:${Date.now()}`).toString('base64url');
  return `${body}.${mac(body)}`;
}

export function verifyTokenString(raw) {
  const token = String(raw || '').trim();
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want  = Buffer.from(mac(body));
  if (given.length !== want.length) return null;         // timingSafeEqual throws otherwise
  if (!timingSafeEqual(given, want)) return null;

  let playerId, role, issuedAt;
  try {
    [playerId, role, issuedAt] = Buffer.from(body, 'base64url').toString().split(':');
  } catch { return null; }

  const issued = Number(issuedAt);
  if (!playerId || !role || !Number.isFinite(issued)) return null;
  if (Date.now() - issued > TOKEN_TTL_MS) return null;

  // ⚠ STRICTLY BEFORE, and the boundary matters because timestamps here are only
  // millisecond-resolution. The cutoff's job is to kill tokens minted with the
  // OLD password; a token stamped the same millisecond as the reset was minted by
  // somebody who could authenticate at that instant, which after a reset means
  // they used the new password. `<=` looks safer and is not — it rejects the
  // victim's own immediate re-login, which is the common path out of the reset
  // screen, in exchange for a race an attacker would have to win to the
  // millisecond against an event they cannot see.
  const cutoff = _revokedBefore.get(playerId);
  if (cutoff != null && issued < cutoff) return null;

  return { playerId, role };
}

export function verifyToken(headers) {
  return verifyTokenString((headers?.authorization || '').replace('Bearer ', ''));
}

/**
 * Kills every token already issued to this player. Called when the password
 * changes — a reset that leaves whoever prompted it still signed in has not
 * actually taken the account back.
 */
/**
 * The synchronous half — the in-RAM cutoff, plus the teardowns that must not sit
 * behind a DB round trip while a revoked session goes on playing. Split out so
 * the ordering is stated rather than implied by where an `await` happens to fall,
 * and so it can be tested with no database. → the cutoff, or 0 for no player.
 */
export function revokeNow(playerId) {
  if (!playerId) return 0;
  const now = Date.now();
  _revokedBefore.set(playerId, now);
  for (const fn of _alsoRevoke) {
    // One handler throwing must not strand the rest: this is the path that takes
    // an account back from somebody.
    try { fn(playerId); } catch (e) { console.error('[auth] revoke handler threw:', e.message); }
  }
  return now;
}

export async function revokeTokensFor(playerId) {
  const now = revokeNow(playerId);
  if (!now) return;
  try {
    await setFlagById(playerId, EPOCH_FLAG, String(now));
  } catch (e) {
    // In RAM the revocation holds; it just won't survive a restart. Worth a
    // line in the log rather than failing the password reset that caused it.
    console.error('[auth] could not persist token revocation for', playerId, e.message);
  }
}
