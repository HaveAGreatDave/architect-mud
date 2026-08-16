// `wait for <pattern>` — the primitive that turns a macro script into a program.
//
// Without it a script can only fire commands and hope; it cannot say "swing, and
// when the thing dies, loot it". That is most of what people reach for a real
// scripting language to do, and it needs no scripting language — only somewhere
// for a running script to park until a line arrives.
//
// Standalone and import-free on purpose. automation.js FEEDS it (it owns the line
// observer) and smartbar-macros.js AWAITS it (it owns the runner), and
// automation.js already imports the runner — so putting the registry in either
// one would close a cycle. It is also pure, which is why the smoke can cover it.

let _waiters = [];   // { test, resolve, timer }

/**
 * Park until a line matches. Always resolves, never rejects: `{ matched, line,
 * captures }` on a hit, `{ matched: false }` on timeout.
 *
 * ⚠ A waiter ALWAYS has a timeout, and there is no way to ask for one without.
 * A script parked forever on a line that will never arrive is indistinguishable
 * from the client having hung — the player has no way to see it, and `stop`
 * cannot reach it because the runner is not on a step boundary. A wait that
 * gives up is recoverable; one that cannot is not.
 */
export function waitForLine(test, timeoutMs) {
  return new Promise((resolve) => {
    const w = { test, resolve: null, timer: null };
    w.resolve = (result) => {
      clearTimeout(w.timer);
      _waiters = _waiters.filter(x => x !== w);
      resolve(result);
    };
    w.timer = setTimeout(() => w.resolve({ matched: false }), Math.max(1, timeoutMs));
    _waiters.push(w);
  });
}

/**
 * Offer a line to everything parked. Called from the line observer.
 *
 * ⚠ Iterates a COPY. A waiter's resolve() removes it from `_waiters`, and the
 * continuation it wakes can register a new waiter synchronously — mutating the
 * array being walked, which silently skips the next waiter in it.
 *
 * Every waiter whose test matches is woken, not just the first: two scripts both
 * waiting on "the door opens" are both waiting on it, and picking one would be
 * arbitrary.
 */
export function offerLine(text, cls) {
  if (!_waiters.length) return;
  for (const w of [..._waiters]) {
    let m = null;
    try { m = w.test(text, cls); } catch { m = null; }
    if (m) w.resolve({ matched: true, line: text, captures: m });
  }
}

// Wake everything with a miss. Called by `stop` and on logout — a parked script
// must not outlive the thing it was waiting on, or it fires its next command
// minutes later into a completely different situation.
export function cancelAllWaits() {
  const n = _waiters.length;
  for (const w of [..._waiters]) w.resolve({ matched: false });
  return n;
}

export function pendingWaits() { return _waiters.length; }
