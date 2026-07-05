// Synthesis plugin regression suite — run by tests/regress.js (never in prod).
// Light guards on the reverse-engineering verbs; the cook/splice minigames are
// driven client-side and covered by their own client flow.
export default async function regress({ run, check }) {
  // reclaim needs a chem lab — the fake player has none, so it must error cleanly.
  const r = await run('reclaim nonexistent');
  check('reclaim without a lab errors cleanly', r?.type === 'error', r?.type);
}
