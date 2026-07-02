// Bodily plugin regression suite — run by tests/regress.js (never loaded in
// production). Only exercises the gated no-mutation paths: a real relief would
// stain the actual zone the fake player stands in.
export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const savedThirst = p.thirst, savedHunger = p.hunger;

  p.thirst = 0;
  let r = await run('pee');
  check('pee verb routed + dehydration gate', /too dehydrated/.test(r?.message || ''), r?.message);

  p.hunger = 0;
  r = await run('poop');
  check('poop verb routed + empty-stomach gate', /haven't eaten/.test(r?.message || ''), r?.message);

  p.thirst = savedThirst; p.hunger = savedHunger;

  r = await run('flush');
  check('flush verb routed', /flush|no toilet/i.test(r?.message || ''), r?.message);
}
