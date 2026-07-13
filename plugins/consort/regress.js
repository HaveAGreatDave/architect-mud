// consort plugin regression suite — run by tests/regress.js (never in production).
// The plugin has no player commands; its surface is the ambient tick's helpers and
// the npc.talk hook. We exercise those directly against fake NPCs/players.
import { _test } from './index.js';

export default async function regress({ check }) {
  const roxy = {
    id: 'regress_consort_roxy', name: 'Roxy', zone_id: 'zone_nowhere',
    flags: { consort: true, devoted_to: 'Cyd', clothing_layers: ['a robe', 'a slip', 'a bra and panties'] },
  };

  // Consort identity.
  check('isConsort: flagged NPC is a consort', _test.isConsort(roxy) === true);
  check('isConsort: dead consort is not', _test.isConsort({ ...roxy, _dead: true }) === false);
  check('isConsort: plain NPC is not', _test.isConsort({ id: 'x', flags: {} }) === false);

  // Arousal → peeled layers: none at rest, all at max, monotonic in between.
  check('peel: nothing off at zero arousal', _test.peeledForArousal(roxy, 0) === 0);
  check('peel: everything off at max arousal', _test.peeledForArousal(roxy, _test.MAX_AROUSAL) === 3);
  let mono = true, prev = -1;
  for (let a = 0; a <= _test.MAX_AROUSAL; a += 5) {
    const p = _test.peeledForArousal(roxy, a);
    if (p < prev) mono = false;
    prev = p;
  }
  check('peel: layers come off monotonically with arousal', mono);

  // Talk hook: warm to the keeper, shy to a stranger, ignores non-consorts.
  const toKeeper = await _test.onTalk({ player: { handle: 'Cyd' }, npc: roxy });
  check('talk: keeper gets a warm reply', !!toKeeper && /I|you|me/i.test(toKeeper.message || ''), toKeeper?.message?.slice(0, 80));

  const toStranger = await _test.onTalk({ player: { handle: 'RandomGuest' }, npc: roxy });
  check('talk: stranger gets a shy reply', !!toStranger && /guest|tour|aboard|rather|Sorry|didn't say/i.test(toStranger.message || ''), toStranger?.message?.slice(0, 80));

  const notConsort = await _test.onTalk({ player: { handle: 'Cyd' }, npc: { id: 'y', flags: {} } });
  check('talk: falls through for a non-consort', notConsort === undefined);

  // Two-hander threads are well-formed 'R'/'B' pairs (both voices, balanced quotes).
  for (const [poolName, pool] of [['private', _test.PAIR_PRIVATE], ['with-keeper', _test.PAIR_WITH_KEEPER]]) {
    check(`banter: ${poolName} pool has threads`, Array.isArray(pool) && pool.length > 0, `${pool?.length}`);
    let bad = null;
    for (const thread of pool) {
      const whos = thread.map(t => t[0]);
      const twoSpeakers = whos.includes('R') && whos.includes('B');
      const validWhos = whos.every(w => w === 'R' || w === 'B');
      const linesOk = thread.every(([, line]) => typeof line === 'string' && line.trim().length > 0
        && (line.match(/"/g) || []).length % 2 === 0);
      if (!(thread.length >= 2 && twoSpeakers && validWhos && linesOk)) { bad = thread; break; }
    }
    check(`banter: ${poolName} threads are well-formed two-handers`, bad === null, bad ? JSON.stringify(bad).slice(0, 120) : '');
  }

  // The tick must survive a sweep of the live world without throwing.
  let threw = false;
  try { _test.consortTick(); } catch { threw = true; }
  check('tick: sweeps the world without throwing', threw === false);

  // Housekeeping — don't leave regress ids in the shared in-memory maps.
  _test.arousal.delete('regress_consort_roxy');
  _test.lastSpoke.delete('regress_consort_roxy');
}
