// plugins/amp/regress.js — routing + gating for the AMP cassette economy.
// DB writes against the fake player are no-ops, so this asserts dispatch and
// gating only, not real unlock state.
export default async function regress({ run, check }) {
  const empty = await run('insert');
  check('insert with no arg prompts', empty?.type === 'error' && /insert what/i.test(empty.message || ''), empty?.message);

  const missing = await run('insert nonexistent-tape');
  check('insert with no matching cassette errors', missing?.type === 'error' && /no cassette/i.test(missing.message || ''), missing?.message);
}
