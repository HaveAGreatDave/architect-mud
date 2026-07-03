// Flashlight plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player carries no flashlight and DB writes against it are
// no-ops, so this asserts the registry wiring, the perceive-hook contract, and
// the ladder math — not live inventory state transitions.
import { fireHook } from '../../server/engine/plugins.js';
import { getRegisteredSpecializedActions } from '../../server/engine/specializedActions.js';
import { floorVisibility } from '../../server/engine/environment.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // Verbs are registered as flashlight-gated specialized actions.
  const reg = getRegisteredSpecializedActions();
  for (const verb of ['light', 'unlight', 'reload']) {
    check(`${verb} registered on flashlight tag`,
      (reg[verb] || []).some(e => e.requiredTag === 'flashlight'),
      JSON.stringify(reg[verb]));
  }

  // floorVisibility raises a dark room to the LIT_FLOOR band...
  const dark = { category: 'dark', visibility: 0.12 };
  const lit = floorVisibility(dark, 'clear');
  check('floorVisibility raises dark → clear', lit.category === 'clear' && lit.visibility >= 0.6, JSON.stringify(lit));
  check('floorVisibility returns a copy', dark.category === 'dark', 'must not mutate input');
  // ...but never dims an already-bright room.
  const bright = { category: 'bright', visibility: 0.8 };
  check('floorVisibility never dims', floorVisibility(bright, 'clear') === bright, JSON.stringify(bright));

  // With no lit flashlight held, the perceive hook leaves visibility untouched.
  const perceived = await fireHook('visibility.perceive', p, { category: 'dark', visibility: 0.12 }, { id: p.current_zone });
  check('perceive hook is a no-op without a lit flashlight', perceived === undefined, JSON.stringify(perceived));

  // Typing `light` with no flashlight to resolve falls through without crashing.
  const r = await run('light');
  check('light dispatches without throwing', r !== null && r !== undefined, JSON.stringify(r)?.slice(0, 120));
}
