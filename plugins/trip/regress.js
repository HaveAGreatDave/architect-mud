// Trip plugin regression suite — run by tests/regress.js (never loaded in
// production). Covers the phantom-mode seam: a per-player fake entity registered
// in the engine phantom registry must (a) render into the room look, (b) answer
// to examine/talk as itself, and (c) evaporate on a whiffed attack — while every
// non-phantom target falls straight through to the real engine handlers.
//
// The full drug→conjure→depart timeline is setTimeout-driven and covered by
// manual QA; here we drive the registry + command intercepts directly so the
// test is deterministic.
import { addPhantom, getPhantoms, getPhantomsInZone, clearPhantoms, matchPhantom } from '../../server/engine/phantoms.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  clearPhantoms(p.id);

  // A phantom conjured into the player's current room, plus a beast one.
  addPhantom(p.id, {
    id: 'ph_regress_person_' + p.id, name: 'a gaunt man in a hospital gown', kind: 'person',
    hp: 10, hp_max: 10, zone: p.current_zone,
    look: 'He stands too still and does not blink.',
    talk: 'The gaunt man only watches, and smiles a little.',
  });
  addPhantom(p.id, {
    id: 'ph_regress_beast_' + p.id, name: 'a low black dog', kind: 'beast',
    hp: 14, hp_max: 14, zone: p.current_zone,
    look: 'Its jaw hangs slightly wrong.',
  });

  check('registry holds both phantoms', getPhantomsInZone(p.id, p.current_zone).length === 2,
    `count=${getPhantomsInZone(p.id, p.current_zone).length}`);

  // matchPhantom resolves by fuzzy name, and only for real-miss targets.
  check('matchPhantom resolves "gaunt"', matchPhantom(p, 'gaunt')?.kind === 'person');
  check('matchPhantom resolves "dog"', matchPhantom(p, 'dog')?.kind === 'beast');
  check('matchPhantom misses unknown target', matchPhantom(p, 'nonesuch_xyz') === null);

  // Room look renders the phantoms as ordinary presences (light permitting — a
  // dark test zone would hide them like any NPC, so treat that as a skip).
  let r = await run('look');
  const lit = !/pitch|can't see|too dark/i.test(r?.message || '');
  if (lit) {
    check('look shows the phantom person', /gaunt man in a hospital gown/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 120));
    check('look shows the phantom beast', /low black dog/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 120));
  } else {
    check('look render (dark zone)', true, 'skipped — test zone is dark');
  }

  // examine returns the phantom's own description, routed through the plugin
  // intercept ahead of the real cmdExamine.
  r = await run('examine gaunt');
  check('examine returns the phantom look', /does not blink/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 120));

  // talk gets the uncanny non-response, not a dialogue tree.
  r = await run('talk gaunt');
  check('talk gets the phantom non-response', /only watches/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 120));

  // A target that matches nothing real AND no phantom falls through to the
  // engine — the plugin must not swallow it.
  r = await run('examine nonesuch_xyz');
  check('non-phantom examine falls through', !/does not blink/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 120));

  // The reveal: attacking a phantom whiffs and removes it from the registry.
  r = await run('attack dog');
  check('attack a phantom whiffs', /passes through empty air/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 140));
  check('whiffed phantom is gone from the registry', !getPhantoms(p.id).some(ph => ph.kind === 'beast'),
    `remaining=${getPhantoms(p.id).map(ph => ph.name).join('|')}`);

  // A no-target look/attack must not be claimed by the plugin (empty target →
  // fall through). `look` with no args returns a room look, not a phantom desc.
  r = await run('look');
  check('bare look is a room look, not a phantom intercept', r?.type === 'look', JSON.stringify(r)?.slice(0, 80));

  clearPhantoms(p.id);
  check('clearPhantoms empties the roster', getPhantoms(p.id).length === 0);
}
