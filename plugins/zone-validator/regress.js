// zone-validator regress.
//
// One property, and it is the one the egress fix could have broken.
//
// `runZone` fires on EVERY zone save (zone.create / zone.update), and with
// autoRepair on it STRIPS any exit whose destination it cannot find. It used to
// establish "cannot find" with a bare `SELECT id FROM zones` — 17k rows, ~0.5MB
// off Neon, per save — so the dev-panel map painter, which saves one tile per
// request, cost half a megabyte for every tile a brush passed over.
//
// It now asks `world.zones` first. That is only safe if a memory MISS falls
// through to the DB rather than being treated as an answer: a bulk direct-DB
// insert is live in the table before it is live in the Map, and reading a miss
// as "gone" would quietly disconnect the fresh grid. So the case below removes a
// real zone from the Map and asserts its exits survive anyway.
export default async ({ check }) => {
  const { hooks } = await import('./index.js');
  const { world } = await import('../../server/engine/world.js');
  const { allExits } = await import('../../server/engine/exits.js');

  const runZone = hooks['worldValidator.runZone'];
  check('runZone hook is registered', typeof runZone === 'function');
  if (typeof runZone !== 'function') return;

  // A real tile with a real exit to a real neighbour. Skipping transient zones:
  // those have no DB row, so they are not what this case is about.
  let subject = null, target = null;
  for (const z of world.zones.values()) {
    if (world.transientZones.has(z.id)) continue;
    const hit = allExits(z).find(e =>
      e.target && e.target !== z.id && world.zones.has(e.target) && !world.transientZones.has(e.target));
    if (hit) { subject = z; target = hit.target; break; }
  }
  check('found a zone with a resolvable exit to test against', !!subject);
  if (!subject) return;

  const missing = (r) => (r?.issues || []).filter(i => i.type === 'missing_dest').map(i => i.destId);

  // Baseline: the neighbour is in the Map, so nothing is dangling.
  const before = await runZone(subject.id, { autoRepair: false });
  check('a resolvable exit is not reported dangling', !missing(before).includes(target));

  // THE CASE. The row is still in the DB; only the Map has lost it. Read as an
  // answer that would be a `missing_dest`, and with autoRepair on, a deletion.
  const saved = world.zones.get(target);
  let after;
  try {
    world.zones.delete(target);
    after = await runZone(subject.id, { autoRepair: false });
  } finally {
    world.zones.set(target, saved); // restore before any assertion can bail out
  }
  check('a zone missing from the Map but present in the DB is NOT called dangling',
    !missing(after).includes(target));
  check('the world Map is left exactly as it was found', world.zones.get(target) === saved);
};
