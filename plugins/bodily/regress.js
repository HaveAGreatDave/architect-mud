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

  r = await run('pee on nobodyhere');
  check('bodily target miss reports not-found', /don't see/i.test(r?.message || ''), r?.message);

  r = await run('flush');
  check('flush verb routed', /flush|no toilet/i.test(r?.message || ''), r?.message);

  r = await run('shower');
  check('shower verb routed + no-shower gate', /no shower here/i.test(r?.message || ''), r?.message);

  // Shower recognised the same three ways as a toilet (type / flag / name).
  const { isShower } = await import('./index.js');
  check('object_type shower recognised', isShower({ name: 'jet', object_type: 'shower', flags: {} }) === true);
  check('name-only shower recognised', isShower({ name: 'rain shower head', object_type: 'fixture', flags: {} }) === true);
  check('flag shower recognised', isShower({ name: 'stall', object_type: 'fixture', flags: { shower: true } }) === true);
  check('non-shower furniture ignored', isShower({ name: 'a wooden chair', object_type: 'furniture', flags: {} }) === false);

  // A toilet is recognised by name, not just object_type/flags — content
  // routinely types toilets as 'furniture'/'fixture'. Without this, relief,
  // flush, and the fouled/peed describe line all silently miss them.
  const { isToilet } = await import('./index.js');
  check('name-only toilet recognised', isToilet({ name: 'curtained toilet', object_type: 'fixture', flags: {} }) === true);
  check('object_type toilet recognised', isToilet({ name: 'steel bowl', object_type: 'toilet', flags: {} }) === true);
  check('non-toilet furniture ignored', isToilet({ name: 'a wooden chair', object_type: 'furniture', flags: {} }) === false);

  // Contaminated-water seam: the water + fillable plugins ask over these actions.
  const { dispatchAction } = await import('../../server/engine/actions.js');
  const clean = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'no-such-toilet' } });
  check('unfouled toilet reports clean', clean.fouled === false && clean.peed === false, JSON.stringify(clean));

  p.statuses = [];
  const foul = await dispatchAction({ type: 'bodily.drinkContaminated', actor: p, params: { fouled: true } });
  check('drinking foul water returns a warning line', /fouled|regret|gag/i.test(foul.message || ''), foul.message);
  check('drinking foul water applies the sick effect', (p.statuses || []).some(s => s.name === 'sick'));
  p.statuses = [];

  // Flush clears the filth: foul a toilet (both pee + poo), confirm it reports
  // contaminated, clear it the way flush does, confirm contamination is gone.
  const { foulToilet, clearToiletFilth } = await import('./index.js');
  foulToilet('regress-bowl', 'poop');
  foulToilet('regress-bowl', 'pee');
  let s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-bowl' } });
  check('fouled toilet reports contaminated', s.fouled === true && s.peed === true, JSON.stringify(s));
  clearToiletFilth('regress-bowl');
  s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-bowl' } });
  check('flush clears pee, poo, and contamination', s.fouled === false && s.peed === false, JSON.stringify(s));
}
