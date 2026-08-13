// search plugin regression suite — run by tests/regress.js, never loaded in
// production.
//
// The verb owns almost no logic, so what's worth asserting is the CONTRACT it
// offers everything else: it routes, it fails gracefully with no providers, the
// cooldown holds, and — the one that matters — a failed search is indistinguishable
// from an empty room. A regression that leaked "you sense something nearby" would
// turn every provider in the game into a detector, and nothing else would catch it.
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const { FAILURES, COOLDOWN_MS, lastSearch } = _test;

  const player = getPlayer();
  const clearCooldown = () => lastSearch.delete(`${player.id}:${player.current_zone}`);

  // ── Routing ────────────────────────────────────────────────────────────────
  clearCooldown();
  let r = await run('search');
  check('search: the verb is registered and routes',
    r && r.type !== 'error' || !/unknown command/i.test(r?.message || ''),
    JSON.stringify(r)?.slice(0, 140));

  // ── No provider claims it ⇒ a failure LINE, never an error ─────────────────
  // The regress fixture stands in an ordinary room with no cat and no disguise
  // furniture, so nothing should claim. That has to read as "you looked and found
  // nothing", not as a broken command.
  clearCooldown();
  r = await run('search');
  check('search: an unclaimed search returns prose, not an error', r?.type === 'output', r?.type);
  check('search: the unclaimed line is one of the authored failures',
    FAILURES.includes(r?.message), (r?.message || '').slice(0, 80));

  // ── The failure line never hints ───────────────────────────────────────────
  // Every one of them, not just the one we happened to roll. This is the check
  // that stops a future author adding "...but something is definitely here."
  const LEAKY = /nearby|close by|somewhere|hidden here|you sense|almost|just miss|nearly/i;
  check('search: no failure line hints that something was missed',
    FAILURES.every((line) => !LEAKY.test(line)),
    FAILURES.find((line) => LEAKY.test(line)) || 'all clean');

  // ── Cooldown ───────────────────────────────────────────────────────────────
  // The previous search set it; a second one in the same room must refuse.
  r = await run('search');
  check('search: a second search in the same room is refused', r?.type === 'error', r?.type);
  check('search: the cooldown is a real duration', COOLDOWN_MS >= 10_000, String(COOLDOWN_MS));

  // ── A target string is accepted and does not break the roll ────────────────
  clearCooldown();
  r = await run('search bins');
  check('search <thing>: still resolves to a normal result', r?.type === 'output', r?.type);

  clearCooldown();
}
