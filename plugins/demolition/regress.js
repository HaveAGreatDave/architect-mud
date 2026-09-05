// Demolition plugin regression suite — run by tests/regress.js (never loaded in
// production).
//
// The verbs are thin; what is worth pinning is the stuff that is invisible when
// it goes wrong:
//
//   1. A fuse fires ONCE. The sweep deletes before it detonates, and if that
//      order ever inverts a charge detonates every second forever.
//   2. The blast goes through `applyStrikeToPlayer`. Writing hp by hand would
//      still "work" — the number goes down — and would silently skip typed soak,
//      the body-part roll and every injury observer. So this asserts on the
//      SIDE EFFECTS of the strike path, not on the hp delta.
//   3. All three Display Mode rungs produce something a player can act on. A
//      rung that opens nothing is the one failure this whole layer exists to
//      prevent, and it is invisible from any other rung.
import { _test } from './index.js';
import { textRender, resolveForLogRung } from '../../server/engine/minigame.js';
import { setFlag, clearFlag } from '../../server/engine/flags.js';
import { world } from '../../server/engine/world.js';
import { on, off } from '../../server/engine/events.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();

  // ── Verb routing ──────────────────────────────────────────────────────────
  // ⚠ `rig` belongs to plugins/trucking (coupling a trailer) and the collision is
  // silent — the first draft of this plugin registered `rig` and got trucking's
  // "You would need to be at a depot" instead. This asserts the word still means
  // what trucking means by it, so a rename back is a red rather than a mystery.
  let r = await run('rig');
  check('rig still belongs to trucking, not to us', /depot|trailer|yards/i.test(r?.message || ''), r?.message);

  r = await run('breach');
  check('breach verb routed', /wire a charge to what/i.test(r?.message || ''), r?.message);

  r = await run('defuse');
  check('defuse verb routed', /nothing here is ticking/i.test(r?.message || ''), r?.message);

  r = await run('charges');
  check('charges verb routed', r?.type === 'output' && /counting down/i.test(r?.message || ''), r?.message);

  // Wiring a charge with nothing demolishable in the room is refused BEFORE the inventory
  // check, so a player standing in an ordinary room is told the useful thing
  // ("nothing here") rather than the confusing one ("you have no charge").
  r = await run('breach the wall');
  check('breach refuses a room with nothing demolishable', /nothing here worth wiring/i.test(r?.message || ''), r?.message);

  // A stale resolve is a no-op rather than an error or an arming. This is the
  // shape that stops a replayed `breachresolve` from conjuring a charge.
  r = await run('breachresolve chg_nope 1 30');
  check('an unknown breachresolve is silently dropped', r?.type === 'noop', JSON.stringify(r));
  r = await run('defuseresolve chg_nope 1');
  check('an unknown defuseresolve is silently dropped', r?.type === 'noop', JSON.stringify(r));

  // ── The fuse fires once ───────────────────────────────────────────────────
  // Driven directly rather than through the scheduler: the sweep is one line and
  // what matters is that the map entry is gone before detonate() is awaited.
  //
  // ⚠ IT GOES OFF IN A SYNTHETIC **LAWLESS** ROOM WITH NOBODY IN IT, and both
  // halves of that are deliberate. The fake player is SHARED with every other
  // suite: detonating in their room would take 22–48 hp off them through the real
  // strike path, and the forced arson charge would leave 4★ on their record — the
  // first draft did exactly that and turned three jail checks and a tablet check
  // red for reasons that looked nothing like demolition. `flags.lawless` is
  // `raiseCrime`'s own early return, so no law reaches the waste and nothing
  // leaks; what is still under test is everything else in the blast path.
  const zid = '__regress_demo_zone__';
  world.zones.set(zid, { id: zid, name: 'a test room', flags: { lawless: true }, players: new Set(), npcs: new Set() });

  let blastError = '';
  let fired = null;
  const spy = ({ target_id }) => { fired = target_id; };
  on('demolition.detonated', spy);

  const charge = {
    id: '__regress_chg__', zoneId: zid, targetId: '__regress_target__',
    targetName: 'test object', ownerId: '__regress_demo_owner__', ownerHandle: 'Nobody',
    fuseAt: Date.now() - 1,
  };
  _test.liveCharges.set(charge.id, charge);
  check('a live charge is listed', _test.liveCharges.has(charge.id));

  // Emulate the sweep body exactly: delete, then detonate.
  _test.liveCharges.delete(charge.id);
  await _test.detonate({ ...charge }).catch(err => { blastError = err.message; });
  check("detonation doesn't throw on a target that's gone", blastError === '', blastError);
  check('the charge is off the board before it goes off — a second sweep finds nothing',
    !_test.liveCharges.has(charge.id));

  // The one line that makes `demolish` an objective type at all. If this stops
  // firing, every quest built on it silently stops advancing.
  check('detonation emits the event plugins/quests listens for',
    fired === '__regress_target__', String(fired));
  off('demolition.detonated', spy);
  world.zones.delete(zid);

  // ── The three rungs ───────────────────────────────────────────────────────
  // One payload, asked for three ways. What is being pinned is that every rung
  // hands back something the client can ACT on: a board to open, or an outcome
  // already decided. Never nothing.
  const payload = {
    type: 'bomb_rig', chargeId: 'x', deviceName: 'test object',
    skill: 5, difficulty: 5, resolveCmd: 'breachresolve',
  };

  await clearFlag('player', 'display_mode', player);
  let out = await textRender(player, { ...payload }, { skill: 'science' });
  check('visual rung opens the graphical board',
    out.render !== 'text' && out.render !== 'resolve' && out.resolveCmd === 'breachresolve', JSON.stringify(out.render));

  await setFlag('player', 'display_mode', 'textgames', player);
  out = await textRender(player, { ...payload }, { skill: 'science' });
  check('textgames rung marks the payload for the character board',
    out.render === 'text' && out.resolveCmd === 'breachresolve', JSON.stringify(out.render));

  await setFlag('player', 'display_mode', 'log', player);
  out = await textRender(player, { ...payload }, { skill: 'science' });
  check('log rung resolves rather than drawing', out.render === 'resolve', JSON.stringify(out.render));
  check('…and carries an outcome the client can report straight back',
    typeof out.autoWon === 'boolean' && out.resolveCmd === 'breachresolve', JSON.stringify(out));
  check('…and says something, so the bottom rung is never silent',
    typeof out.message === 'string' && out.message.length > 0, out.message);

  // ⚠ The log rung must grade the right competence. `textRender` defaults to
  // hacking; this family is `science`, and a silent default here would mean a
  // demolitions expert failing bombs because they cannot hack. Asserted by
  // resolving the same payload directly on the skill this plugin names.
  const resolved = await resolveForLogRung(player, { ...payload, difficulty: 5 }, { skill: 'science' });
  check('the log rung resolution is shaped for a boolean family',
    typeof resolved.won === 'boolean' && typeof resolved.line === 'string', JSON.stringify(resolved));

  await clearFlag('player', 'display_mode', player);

  // ── Tunables stay sane ────────────────────────────────────────────────────
  // The defuse floor has to sit below the minimum fuse, or a charge could be
  // armed and be un-defusable from the instant it was set.
  check('a minimum fuse still leaves room to defuse',
    _test.DEFUSE_FLOOR_S < _test.FUSE_MIN, `${_test.DEFUSE_FLOOR_S} < ${_test.FUSE_MIN}`);
  check('the fuse range is the right way round', _test.FUSE_MIN < _test.FUSE_MAX);

  // Leave nothing behind: a stray live charge would detonate under whichever
  // suite runs next, in a room it does not own.
  _test.liveCharges.clear();
  _test.pendingRig.clear();
  _test.pendingDefuse.clear();
  check('the suite leaves no live charges behind', _test.liveCharges.size === 0);
}
