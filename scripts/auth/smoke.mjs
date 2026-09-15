/**
 * auth:smoke — password hashing, session tokens, and the /auth rate limiter.
 *
 * None of this needs a database, a world or a browser, which is why it is a
 * standalone smoke rather than a layer in tests/regress.js: it runs in about a
 * second and it gates the three things whose failure mode is silent.
 *
 * The one it exists for is the FORGED TOKEN. Tokens used to be
 * `base64(playerId:role:issuedAt)` with no signature, so `role` was whatever the
 * holder typed and anybody who knew a player id could award themselves `admin`.
 * Nothing in the suite would have noticed, because a forged token is not an
 * error — it is a successful request by a caller who should not have been able
 * to make it.
 */
import { createHash } from 'crypto';
import { hashPassword, verifyPassword } from '../../server/engine/passwords.js';
import { signToken, verifyTokenString, revokeNow, onRevoke } from '../../server/engine/auth-tokens.js';
import { checkRateLimit, clientKey, resetRateLimits } from '../../server/api/rate-limit.js';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── passwords ───────────────────────────────────────────────────────────────
const stored = await hashPassword('correct horse battery');
check('hash records its own scrypt parameters', /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(stored), stored);
check('the same password hashes differently twice (salted)', stored !== await hashPassword('correct horse battery'));
check('the right password verifies', (await verifyPassword('correct horse battery', stored)).ok);
check('a wrong password does not', !(await verifyPassword('correct horse batteri', stored)).ok);
check('a scrypt match is not flagged for upgrade', (await verifyPassword('correct horse battery', stored)).legacy === false);

// ⚠ Every row that predates scrypt is a bare sha256 hex and MUST still verify,
// or the change locks out the entire existing player base.
const legacyRow = createHash('sha256').update('hunter2').digest('hex');
const legacyHit = await verifyPassword('hunter2', legacyRow);
check('a legacy sha256 row still verifies', legacyHit.ok);
check('…and is flagged for upgrade', legacyHit.legacy === true);
check('a legacy row rejects the wrong password', !(await verifyPassword('hunter3', legacyRow)).ok);
// A "needs upgrade" flag that survives a FAILED check is one careless caller
// away from re-hashing an account to whatever an attacker just typed.
check('a failed legacy check is never flagged for upgrade', (await verifyPassword('hunter3', legacyRow)).legacy === false);
check("a test row's 'x' hash matches nothing", !(await verifyPassword('x', 'x')).ok);
check('an empty stored hash matches nothing', !(await verifyPassword('', '')).ok);
check('a null stored hash matches nothing', !(await verifyPassword('pw', null)).ok);

// ── session tokens ──────────────────────────────────────────────────────────
const token = signToken('player_abc', 'player');
check('a signed token verifies', verifyTokenString(token)?.playerId === 'player_abc');
check('…and carries its role', verifyTokenString(token)?.role === 'player');

const [body, sig] = token.split('.');
const legacyShape = Buffer.from('player_abc:admin:' + Date.now()).toString('base64');
check('the old unsigned token format is refused', verifyTokenString(legacyShape) === null);
check('a made-up signature is refused',
  verifyTokenString(Buffer.from('player_abc:admin:' + Date.now()).toString('base64url') + '.' + 'x'.repeat(43)) === null);
check('a role swapped under a real signature is refused',
  verifyTokenString(Buffer.from('player_abc:admin:' + Date.now()).toString('base64url') + '.' + sig) === null);
check('a truncated signature is refused', verifyTokenString(`${body}.${sig.slice(0, -2)}`) === null);
check('a bodyless token is refused', verifyTokenString(`.${sig}`) === null);
check('garbage is refused', verifyTokenString('nonsense') === null);
check('an empty token is refused', verifyTokenString('') === null);

// ── revocation ──────────────────────────────────────────────────────────────
// A password reset that leaves the old session working has not taken the account
// back, and every part of that is invisible from the outside: the token still
// verifies, the socket stays open, and nothing errors.
{
  const before = signToken('player_rev', 'player');
  check('a token verifies before the reset', verifyTokenString(before)?.playerId === 'player_rev');
  // ⚠ The cutoff is millisecond-resolution, so `before` has to be provably
  // EARLIER than the revoke or this whole block tests the boundary by accident.
  await new Promise(r => setTimeout(r, 3));

  const seen = [];
  onRevoke(() => { throw new Error('this handler is meant to throw'); });  // must not strand the next one
  onRevoke((id) => seen.push(id));

  revokeNow('player_rev');
  check('the live-session teardown runs', seen.length === 1 && seen[0] === 'player_rev', JSON.stringify(seen));
  check('…even though an earlier handler threw', seen[0] === 'player_rev');
  check('the old token is dead after the reset', verifyTokenString(before) === null);
  // Issued in the SAME millisecond as the revoke — the victim coming straight
  // back to the login screen. It must survive: see the boundary note on the
  // cutoff comparison in auth-tokens.js.
  check('a token issued after the reset still works', verifyTokenString(signToken('player_rev', 'player'))?.playerId === 'player_rev');
  check('another player is untouched by it', verifyTokenString(signToken('player_other', 'player'))?.playerId === 'player_other');
  check('revoking nobody is a no-op', revokeNow(undefined) === 0);
}

// ── rate limiter ────────────────────────────────────────────────────────────
resetRateLimits();
const opts = { limit: 3, windowMs: 60_000, globalLimit: 5 };
const spend = [1, 2, 3, 4].map(() => checkRateLimit('/t', 'ip-a', opts).ok);
check('the allowance is spent and then refused', JSON.stringify(spend) === '[true,true,true,false]', JSON.stringify(spend));
check('a refusal says how long to wait', checkRateLimit('/t', 'ip-a', opts).retryAfter > 0);

// ⚠ The per-caller key comes off a header a caller can forge. The global bucket
// is the one that actually caps a spoofer, so it is the one worth asserting.
resetRateLimits();
const rotated = Array.from({ length: 8 }, (_, i) => checkRateLimit('/t', `ip-${i}`, opts).ok);
check('rotating the client key does not buy unlimited attempts', rotated.filter(Boolean).length === 5, JSON.stringify(rotated));

resetRateLimits();
check('each route has its own allowance', checkRateLimit('/other', 'ip-a', opts).ok);

check('x-forwarded-for wins where a proxy set it',
  clientKey({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1', 'x-remote-addr': '10.0.0.1' }) === '1.2.3.4');
check('the socket address is the fallback', clientKey({ 'x-remote-addr': '10.0.0.1' }) === '10.0.0.1');
check('no headers at all is survivable', clientKey({}) === 'unknown');
check('undefined headers are survivable', clientKey(undefined) === 'unknown');

if (failures) {
  console.error(`\nauth:smoke FAILED — ${failures} check(s)`);
  process.exit(1);
}
console.log('auth:smoke ok — hashes salt and migrate, tokens cannot be forged, /auth is capped.');
