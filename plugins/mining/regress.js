// Mining plugin regression suite — run by tests/regress.js (never loaded in production).
// The fake regress player stands in a synthetic zone with no mining_table_id and
// carries nothing, so we assert routing + the gate refusals (no row writes needed).
export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const savedPosture = p.posture;

  // Routes to the plugin, and refuses in a zone with no deposit (the zone gate,
  // checked before the tool gate).
  p.posture = 'standing';
  let r = await run('mine');
  check('mine verb routed + zone gate', /no deposit here/i.test(r?.message || ''), r?.message);

  // Posture gate: must be on your feet.
  p.posture = 'sitting';
  r = await run('mine');
  check('mine refused while seated', /on your feet/i.test(r?.message || ''), r?.message);

  p.posture = savedPosture;
}
