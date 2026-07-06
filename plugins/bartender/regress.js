// bartender plugin regression suite — run by tests/regress.js (never in production).
// The plugin has no player commands; its surface is the ambient tick's helpers and
// the three dialogue actions. We exercise those directly (the fake player owns no
// zone TV / poker table, so the "nothing happening" branches are what's reachable).
import { dispatchAction } from '../../server/engine/actions.js';
import { _test } from './index.js';

export default async function regress({ check }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const freshP = { id: 'regress_bartender_new', handle: 'Greenhorn', created_at: nowSec - 3600 };
  const oldP   = { id: 'regress_bartender_vet', handle: 'Veteran',   created_at: nowSec - 40 * 86400 };

  // Newness gate.
  check('isNewPlayer: first-week account is new', _test.isNewPlayer(freshP) === true);
  check('isNewPlayer: 40-day account is not new', _test.isNewPlayer(oldP) === false);
  check('isNewPlayer: missing created_at is not new', _test.isNewPlayer({ id: 'x' }) === false);

  // Tip drip: every tip unique, then it dries up (→ graduation).
  const seen = new Set();
  let dry = false;
  for (let i = 0; i < _test.TIPS.length; i++) {
    const t = _test.nextTipFor(freshP);
    if (t == null) { dry = true; break; }
    seen.add(t);
  }
  check('tips drip unique, one per call', seen.size === _test.TIPS.length && !dry, `${seen.size}/${_test.TIPS.length}`);
  check('tips dry up after the pool is spent', _test.nextTipFor(freshP) === null);

  // Poker / TV line formatters.
  const pl = _test.pokerLine({ game: { pot: 250, community: [] }, seats: [1, 1, 1, null] });
  check('pokerLine reads the live pot', /₵250/.test(pl), pl);
  const plHeadsUp = _test.pokerLine({ game: { pot: 400, community: [1, 2, 3] }, seats: [1, 1, null, null] });
  check('pokerLine calls a heads-up pot', /two at the table/i.test(plHeadsUp), plHeadsUp);
  const tv = _test.tvLine({ program: 'DEADBALL LIVE', stationName: 'KSAB-TV', number: 7 });
  check('tvLine names the program', /DEADBALL LIVE/.test(tv), tv);

  // Dialogue actions return a spoken dialogue_line.
  const adviceNew = await dispatchAction({ type: 'BARTENDER_ADVICE', actor: { ...freshP, id: 'regress_bartender_advice' }, params: {}, context: { npc: { id: 'npc_embassy_barkeep' } } });
  check('BARTENDER_ADVICE gives a newcomer a tip', adviceNew?.type === 'dialogue_line' && !!adviceNew.text, JSON.stringify(adviceNew)?.slice(0, 100));

  const adviceVet = await dispatchAction({ type: 'BARTENDER_ADVICE', actor: oldP, params: {}, context: { npc: { id: 'npc_embassy_barkeep' } } });
  check('BARTENDER_ADVICE deflects a veteran', adviceVet?.type === 'dialogue_line' && !!adviceVet.text, JSON.stringify(adviceVet)?.slice(0, 100));

  const tvOff = await dispatchAction({ type: 'BARTENDER_TV', actor: { id: 'regress_bartender_tv', current_zone: 'zone_nonexistent' }, params: {}, context: {} });
  check('BARTENDER_TV handles a dark set', tvOff?.type === 'dialogue_line' && /dark/i.test(tvOff.text), tvOff?.text);

  const pokerCold = await dispatchAction({ type: 'BARTENDER_POKER', actor: { id: 'regress_bartender_poker', current_zone: 'zone_nonexistent' }, params: {}, context: {} });
  check('BARTENDER_POKER handles a cold table', pokerCold?.type === 'dialogue_line' && /cold/i.test(pokerCold.text), pokerCold?.text);

  // Housekeeping — don't leave regress ids in the shared in-memory maps.
  _test.tipsGiven.delete('regress_bartender_new');
  _test.tipsGiven.delete('regress_bartender_advice');
}
