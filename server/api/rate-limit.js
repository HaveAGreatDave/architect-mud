/**
 * A fixed-window rate limiter for the unauthenticated /auth routes.
 *
 * Everything under /auth is reachable with no credentials at all, so without
 * this a password guesser, an account enumerator or somebody using the reset
 * form as a way to mail a stranger repeatedly is bounded only by bandwidth.
 *
 * ⚠ TWO BUCKETS, NOT ONE, AND THE SECOND IS THE ONE THAT ACTUALLY CAPS. The
 * per-caller bucket is keyed on an address we cannot fully trust: behind a proxy
 * the client's own X-Forwarded-For is only appended to, and a direct caller can
 * put anything in it, so a spoofer rotating that header draws a fresh allowance
 * every request. The global bucket is what bounds that. The per-caller bucket's
 * job is the opposite one — stopping a single honest address from eating the
 * global allowance and locking everybody else out.
 *
 * In-memory by design: a restart forgiving an attacker a few minutes early is
 * not worth a table, a write per login attempt, or a read on the hot path.
 */

const buckets = new Map();   // `${name}:${key}` → { count, resetAt }
let lastSweep = 0;
const SWEEP_EVERY_MS = 5 * 60 * 1000;

function sweep(now) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [id, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(id);
}

// → seconds to wait, or null when this hit is within the allowance.
function hit(id, limit, windowMs, now) {
  let bucket = buckets.get(id);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(id, bucket);
  }
  bucket.count++;
  return bucket.count <= limit ? null : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
}

/**
 * The address to bucket a caller under. `x-remote-addr` is injected by the HTTP
 * server from the socket, and is stamped AFTER the real headers are spread, so a
 * caller cannot supply their own.
 *
 * ⚠ X-FORWARDED-FOR'S LEFTMOST ENTRY IS WHATEVER THE CLIENT SENT. Each proxy only
 * appends, so a caller rotating the header gets a fresh per-caller allowance on
 * every request and can drain the global bucket, which locks everybody out of
 * login and registration. TRUSTED_PROXY_HOPS is how many proxies in front of us
 * append (Render's edge); with it set, the key is that many entries from the
 * right, the address the outermost trusted proxy saw, which no client can forge.
 * Unset, it stays leftmost, because a wrong count would put every player behind
 * one shared edge address. The first forwarded request logs how many addresses
 * the header carries, which is what to set it to on prod (1 for a single
 * appending proxy).
 */
const TRUSTED_HOPS = Math.max(0, parseInt(process.env.TRUSTED_PROXY_HOPS || '0', 10) || 0);
let chainShapeLogged = false;
export function clientKey(headers) {
  const chain = String(headers?.['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (chain.length && !chainShapeLogged) {
    chainShapeLogged = true;
    console.log(`[rate-limit] X-Forwarded-For carries ${chain.length} address(es); TRUSTED_PROXY_HOPS=${TRUSTED_HOPS}`);
  }
  const forwarded = TRUSTED_HOPS > 0 ? (chain[chain.length - TRUSTED_HOPS] ?? chain[0]) : chain[0];
  return forwarded || String(headers?.['x-remote-addr'] || '') || 'unknown';
}

export function checkRateLimit(name, key, { limit, windowMs, globalLimit }) {
  const now = Date.now();
  sweep(now);
  // Both buckets are always hit — a caller over their own limit still counts
  // against the global one, or rotating the header would cost an attacker
  // nothing at all.
  const mine   = hit(`${name}:${key}`, limit, windowMs, now);
  const shared = globalLimit ? hit(`${name}:*`, globalLimit, windowMs, now) : null;
  const retryAfter = mine ?? shared;
  return retryAfter == null ? { ok: true } : { ok: false, retryAfter };
}

// ── Per-account failed logins ──────────────────────────────────────────────────
// The per-address bucket above is keyed on an address a caller can spoof, so on
// its own it can't stop somebody guessing one account's password from a rotating
// set of addresses. This counts FAILURES per username, so a real player who logs
// in often is never limited, and it's shared by both login doors (HTTP and WS).
// The cost: somebody can lock one account out for the rest of the window.
const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_WINDOW_MS = 15 * 60_000;

const failKey = (username) => `login-fail:${String(username || '').toLowerCase()}`;

/** → seconds to wait when this account has too many recent failures, else null. */
export function accountLocked(username) {
  const now = Date.now();
  const b = buckets.get(failKey(username));
  if (!b || now >= b.resetAt || b.count < LOGIN_FAIL_LIMIT) return null;
  return Math.max(1, Math.ceil((b.resetAt - now) / 1000));
}

export function noteFailedLogin(username) {
  if (!username) return;
  const now = Date.now();
  sweep(now);
  hit(failKey(username), LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW_MS, now);
}

// Tests only — the buckets are process-global and a suite that logs in twenty
// times shouldn't poison the one that runs after it.
export function resetRateLimits() {
  buckets.clear();
  lastSweep = 0;
}
