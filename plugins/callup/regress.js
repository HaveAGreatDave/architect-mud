// callup regression suite, run by tests/regress.js. The verb over the shared vehicle stand, on a made-up kind so
// it needs no vehicle rows: a room that isn't a bay refuses, a bay lists, calls up, refuses a second, shows the
// stand to the Stage as the owner's and to nobody else's room, sends it back, and empties when it's boarded.
import { getZone } from '../../server/engine/world.js';
import { registerStandKind, standAt, standVehicles, standTaken, _resetStands } from '../../server/engine/vehicle-stand.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const here = getZone(p.current_zone);
  if (!here) { check('callup: the test player stands somewhere', false); return; }
  _resetStands();

  let r = await run('callup');
  check('callup: a room that is no bay says so', /nothing to call up here/i.test(r?.message || ''), r?.message?.slice(0, 60));

  // a made-up kind whose bay is the room the test player stands in
  let fleet = [{ id: 'vs_one', name: 'Rust Bucket', look: { cls: 'prop' } }, { id: 'vs_two', name: 'Second Wind', look: { cls: 'prop' } }];
  registerStandKind('regress_kind', {
    isBay: (z) => z?.id === here.id, from: 'back', label: 'TUG', moveMs: 50,
    board: (id) => `examine ${id}`, list: async () => fleet,
    words: { noun: 'thing', up: (n) => `Out comes the ${n}.`, down: (n) => `Away goes the ${n}.` },
  });

  r = await run('callup');
  check('callup: two kept here, it asks which and lists them', /Which thing/.test(r?.message || '') && /Rust Bucket/.test(r.message) && /Second Wind/.test(r.message), r?.message?.slice(0, 80));
  const seen0 = standVehicles(here.id, p, 'regress_kind');
  check('…and the Stage lists them to call up', seen0?.mine?.length === 2 && seen0.lift === null && seen0.label === 'TUG', JSON.stringify(seen0)?.slice(0, 80));

  r = await run('callup sec');
  check('callup <start of a name>: that one comes out', standAt(here.id)?.id === 'vs_two' && /Out comes the Second Wind/.test(r?.message || ''), r?.message?.slice(0, 60));
  const seen = standVehicles(here.id, p, 'regress_kind');
  check('…and the Stage sees it as the owner\'s, with the verb that boards it', seen?.lift?.id === 'vs_two' && seen.lift.mine === true && seen.lift.board === 'examine vs_two' && seen.lift.look?.cls === 'prop', JSON.stringify(seen?.lift)?.slice(0, 100));
  check('…and a kind that isn\'t this room\'s answers nothing', standVehicles(here.id, p, 'aircraft') === undefined);

  r = await run('callup 1');
  check('callup: one at a time', standAt(here.id)?.id === 'vs_two' && /already out/.test(r?.message || ''), r?.message?.slice(0, 60));

  r = await run('callup back');
  check('callup back: it starts back', standAt(here.id)?.down > 0 && /Away goes/.test(r?.message || ''), r?.message?.slice(0, 60));
  await new Promise((ok) => setTimeout(ok, 90));
  check('…and is gone once the move has run', standAt(here.id) === null);

  await run('callup 1');
  standTaken('vs_one', 'regress_kind');
  check('boarded: the floor is empty at once', standAt(here.id) === null);

  // `callup list`: fills the hangar display's hand, the kind's own shop with it, and calls nothing up
  registerStandKind('regress_kind', {
    isBay: (z) => z?.id === here.id, from: 'below', label: 'LIFT', moveMs: 50,
    board: (id) => `examine ${id}`, list: async () => fleet,
    shop: async () => [{ id: 't_one', name: 'Kite', price: 10, afford: true, cmd: 'buy t_one', look: { cls: 'prop' } }],
    words: { noun: 'thing' },
  });
  r = await run('callup list');
  const listed = standVehicles(here.id, p, 'regress_kind');
  check('callup list: names what\'s kept here and brings nothing out', /Yours here/.test(r?.message || '') && standAt(here.id) === null, r?.message?.slice(0, 60));
  check('…and the display gets both lists, a look on each', listed?.mine?.length === 2 && listed.mine[0].look?.cls === 'prop' && listed.shop?.[0]?.cmd === 'buy t_one' && listed.from === 'below', JSON.stringify(listed)?.slice(0, 120));

  // a desk (a terminal's display): `callup list` still lists, before the kind's own call; anything else is its call
  registerStandKind('regress_kind', {
    isBay: (z) => z?.id === here.id, desk: true, label: 'DESK',
    board: (id) => `examine ${id}`, list: async () => fleet, shop: async () => [],
    call: () => ({ type: 'emote', message: 'Kept in the hangar.' }), words: { noun: 'thing' },
  });
  r = await run('callup list');
  const desk = standVehicles(here.id, p, 'regress_kind');
  check('a desk: callup list lists and says it\'s a desk', /Yours here/.test(r?.message || '') && desk?.desk === true && desk.mine.length === 2, JSON.stringify(desk)?.slice(0, 100));
  r = await run('callup 1');
  check('…and raises nothing: its own call answers', /Kept in the hangar/.test(r?.message || '') && standAt(here.id) === null, r?.message?.slice(0, 60));

  // back to a floor bay: a desk answers every bare `callup` with its own call
  registerStandKind('regress_kind', {
    isBay: (z) => z?.id === here.id, from: 'below', label: 'LIFT', moveMs: 50,
    board: (id) => `examine ${id}`, list: async () => fleet, shop: async () => [], words: { noun: 'thing' },
  });
  fleet = [];
  r = await run('callup');
  check('callup: nothing kept here says so', /Nothing of yours/.test(r?.message || ''), r?.message?.slice(0, 60));

  _resetStands();
  // the made-up kind stays registered, but its bay test matches no room after this
  registerStandKind('regress_kind', { isBay: () => false, board: (id) => id, list: async () => [] });
}
