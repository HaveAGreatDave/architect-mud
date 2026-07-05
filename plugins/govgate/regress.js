/**
 * govgate regress — the checkpoint is a pure move-gate law with no verbs, so the
 * manifest sweep + boot already prove it registered. Here we just confirm it didn't
 * break ordinary command dispatch (the gate no-ops off the checkpoint tile).
 */
export default async ({ run, check }) => {
  const r = await run('look');
  check('look still works with govgate loaded', r && r.type !== 'error', JSON.stringify(r)?.slice(0, 100));
};
