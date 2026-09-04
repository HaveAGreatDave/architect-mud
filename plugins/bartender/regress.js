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

  // Voices: every bartender's line set is complete, and an unknown NPC falls back
  // to Lowry's. Without the fallback a new bartender would speak `undefined`.
  check('voiceFor falls back to Lowry for an unlisted NPC',
    _test.voiceFor({ id: 'npc_nobody' }) === _test.LOWRY_VOICE);
  check('voiceFor handles a missing NPC', _test.voiceFor(undefined) === _test.LOWRY_VOICE);

  const POOLS = ['welcomes', 'graduation', 'veteranAdvice', 'heat', 'idle'];
  const allVoices = [['LOWRY', _test.LOWRY_VOICE], ...Object.entries(_test.VOICES)];
  let badVoice = null;
  for (const [id, v] of allVoices) {
    for (const key of POOLS) {
      if (!Array.isArray(v[key]) || v[key].length === 0
        || !v[key].every(l => typeof l === 'string' && l.trim()
          && (l.match(/"/g) || []).length % 2 === 0)) { badVoice = `${id}.${key}`; break; }
    }
    if (badVoice) break;
  }
  check('every voice has complete, quote-balanced line pools', badVoice === null, badVoice || '');

  // Coworker banter. A voice may legitimately have NO coworker — Sully works the
  // Pigeon alone, and the tick guards on `coworkerId` (`voice.coworkerId ? ... :
  // null`), so absence is the documented opt-out rather than a missing field.
  // This used to demand the pair outright, which cost nothing while both authored
  // voices happened to have one and then failed the first solo bar.
  //
  // What IS a bug is a HALF-configured pair: an id with no threads, or threads
  // with no id, either of which silently never fires and looks authored. The old
  // shape could not tell those two apart from a deliberate solo.
  //
  // Where a pair is present, every thread must be a well-formed two-hander —
  // non-empty, only 'L'/'O' speakers, both voices present, quotes balanced per turn.
  let badThread = null;
  let threadCount = 0;
  let soloCount = 0;
  for (const [id, v] of allVoices) {
    const hasId = !!v.coworkerId;
    const hasThreads = Array.isArray(v.coworker) && v.coworker.length > 0;
    if (!hasId && !hasThreads) { soloCount++; continue; }
    if (hasId !== hasThreads) {
      badThread = `${id}: half-configured coworker (coworkerId=${hasId}, coworker threads=${hasThreads})`;
      break;
    }
    for (const thread of v.coworker) {
      threadCount++;
      const whos = thread.map(t => t[0]);
      const twoSpeakers = whos.includes('L') && whos.includes('O');
      const validWhos = whos.every(w => w === 'L' || w === 'O');
      const linesOk = thread.every(([, line]) => typeof line === 'string' && line.trim().length > 0
        && (line.match(/"/g) || []).length % 2 === 0);
      if (!(thread.length >= 2 && twoSpeakers && validWhos && linesOk)) { badThread = JSON.stringify(thread).slice(0, 120); break; }
    }
    if (badThread) break;
  }
  check('coworker threads are well-formed two-handers', badThread === null,
    badThread || `${threadCount} threads, ${soloCount} solo bar(s)`);

  // Tip memory is per-bartender: a player who drained Lowry's pool still gets
  // Marla's. (freshP spent the default-keyed pool above.)
  check('tip pools are per-bartender', _test.nextTipFor(freshP, 'npc_reach_marla') !== null);

  // Housekeeping — don't leave regress ids in the shared in-memory maps.
  for (const k of [..._test.tipsGiven.keys()]) if (k.includes('regress_bartender')) _test.tipsGiven.delete(k);
}
