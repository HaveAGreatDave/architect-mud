/**
 * Password hashing.
 *
 * Until now this was one line in api/routes.js — `sha256(pw)`, unsalted, no
 * work factor — so a leaked `players` table was a rainbow-table lookup away
 * from every account on it. Hashes are scrypt now, salted per row.
 *
 * ⚠ THE LEGACY FORMAT STILL VERIFIES, AND HAS TO. Every row that exists today
 * holds a bare 64-character sha256 hex, and there is no way to re-hash one
 * without the plaintext — which only ever arrives at a login. So
 * `verifyPassword` accepts both shapes and says which one it matched, and
 * `verifyAndUpgrade` writes the modern hash back on the spot. An account
 * upgrades itself the first time its owner signs in; a row nobody ever signs
 * into stays legacy for ever, which is the best available short of forcing a
 * reset on the whole player base.
 *
 * ⚠ HASHING IS ASYNC NOW. The old helper was a sync expression that callers
 * dropped straight into a query's parameter array — `hashPassword(password)`
 * still reads fine there and would bind a Promise as the password. Every call
 * site takes an `await`.
 */
import { scrypt as _scrypt, randomBytes, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import { query } from '../models/db.js';

const scrypt = promisify(_scrypt);

// ~16 MB and ~100 ms per hash on the Render free tier. N is the only one of the
// three that materially moves either figure, and it is recorded IN the stored
// string, so raising it later doesn't strand the rows hashed before the change.
// ⚠ Memory is 128·N·r = 16 MB here, which fits under node's 32 MB scrypt
// default; raising either past that needs an explicit `maxmem` beside it.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN  = 32;

const LEGACY_SHA256 = /^[0-9a-f]{64}$/;

// ⚠ timingSafeEqual THROWS on a length mismatch rather than returning false,
// and the lengths genuinely do differ here — test rows carry 'x' as a hash.
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const dk = await scrypt(String(password ?? ''), salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

/**
 * → { ok, legacy }. `legacy` says the match came from the old unsalted sha256,
 * which is the signal to re-hash — it is never true for a failed check, so a
 * caller can't upgrade a row on a wrong password.
 */
export async function verifyPassword(password, stored) {
  const pw = String(password ?? '');
  if (!stored || typeof stored !== 'string') return { ok: false, legacy: false };

  if (stored.startsWith('scrypt$')) {
    const [, n, r, p, salt, hash] = stored.split('$');
    const expected = Buffer.from(hash || '', 'base64');
    if (!expected.length) return { ok: false, legacy: false };
    try {
      const dk = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length,
        { N: Number(n), r: Number(r), p: Number(p) });
      return { ok: sameBytes(dk, expected), legacy: false };
    } catch { return { ok: false, legacy: false }; }
  }

  if (!LEGACY_SHA256.test(stored)) return { ok: false, legacy: false };
  const legacy = createHash('sha256').update(pw).digest('hex');
  // ⚠ `legacy` tracks `ok`, and is never true on its own. verifyAndUpgrade
  // happens to test `ok` first, but a flag meaning "this row is due an upgrade"
  // that is also set on a WRONG password is one careless caller away from
  // re-hashing an account to whatever an attacker just typed.
  const ok = sameBytes(Buffer.from(legacy), Buffer.from(stored));
  return { ok, legacy: ok };
}

/**
 * The one call every login path should use. Verifies, and on a legacy match
 * quietly re-hashes the row to scrypt — including the in-memory row it was
 * handed, so a caller that goes on to read `password_hash` sees the new value.
 * A failed write is logged and swallowed: the player typed the right password
 * and must still get in.
 */
export async function verifyAndUpgrade(playerRow, password) {
  const { ok, legacy } = await verifyPassword(password, playerRow?.password_hash);
  if (!ok) return false;
  if (legacy && playerRow?.id) {
    try {
      const fresh = await hashPassword(password);
      await query('UPDATE players SET password_hash=$1 WHERE id=$2', [fresh, playerRow.id]);
      playerRow.password_hash = fresh;
    } catch (e) {
      console.error('[auth] password hash upgrade failed for', playerRow.id, e.message);
    }
  }
  return true;
}
