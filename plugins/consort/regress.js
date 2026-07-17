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
  check('talk: stranger gets a shy reply', !!toStranger && /guest|tour|aboard|rather|Sorry|didn't say|one word/i.test(toStranger.message || ''), toStranger?.message?.slice(0, 80));

  const notConsort = await _test.onTalk({ player: { handle: 'Cyd' }, npc: { id: 'y', flags: {} } });
  check('talk: falls through for a non-consort', notConsort === undefined);

  // Talk opens a real conversation for the keeper when the consort carries a
  // dialogue_tree (renders the root through the shared engine renderer); without a
  // tree it falls back to a warm one-liner (exercised above).
  const roxyWithTree = { ...roxy, dialogue_tree: {
    root: { text: 'There he is.', options: [{ label: 'Hi.', next: 'bye' }] },
    bye:  { text: 'Go on.', options: [] },
  } };
  const convo = await _test.onTalk({ player: { handle: 'Cyd' }, npc: roxyWithTree });
  check('talk: keeper with a dialogue_tree opens a conversation', convo?.type === 'dialogue' && convo.node === 'root' && Array.isArray(convo.options), convo?.type);
  // A stranger never opens the tree, even when one exists.
  const strangerConvo = await _test.onTalk({ player: { handle: 'RandomGuest' }, npc: roxyWithTree });
  check('talk: stranger never opens the tree', strangerConvo?.type !== 'dialogue' && !!strangerConvo?.message, strangerConvo?.type);

  // Per-name VOICE registry: Roxy and Bijou resolve to their own registers, anyone
  // else to the neutral default, and every register carries the full set of pools.
  check('voice: Roxy resolves to her own register', _test.voiceOf({ name: 'Roxy' }) === _test.VOICE.roxy);
  check('voice: Bijou resolves to her own register', _test.voiceOf({ name: 'Bijou' }) === _test.VOICE.bijou);
  check('voice: an unknown consort falls back to default', _test.voiceOf({ name: 'Someone Else' }) === _test.VOICE.default);
  const VOICE_KEYS = ['devotedTame', 'devotedHot', 'arousedTame', 'arousedHot', 'shy', 'worried'];
  let voiceBad = null;
  for (const [vname, v] of Object.entries(_test.VOICE)) {
    for (const key of VOICE_KEYS) {
      if (!Array.isArray(v[key]) || v[key].length === 0 || !v[key].every(l => typeof l === 'string' && l.trim())) {
        voiceBad = `${vname}.${key}`; break;
      }
    }
    if (voiceBad) break;
  }
  check('voice: every register carries every pool, all non-empty', voiceBad === null, voiceBad || '');

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

  // Fellatio threads (their signature act) are well-formed [who, tame, hot] turns:
  // solo threads use only 'A', duo threads use 'A' and 'B', both variants non-empty
  // with balanced quotes and a name-template slot.
  for (const [poolName, pool, roles] of [
    ['solo', _test.FELLATIO_SOLO, new Set(['A'])],
    ['duo',  _test.FELLATIO_DUO,  new Set(['A', 'B'])],
  ]) {
    check(`fellatio: ${poolName} pool has threads`, Array.isArray(pool) && pool.length > 0, `${pool?.length}`);
    let bad = null;
    for (const thread of pool) {
      const ok = Array.isArray(thread) && thread.length >= 2 && thread.every(t =>
        Array.isArray(t) && t.length === 3 && roles.has(t[0])
        && typeof t[1] === 'string' && t[1].includes('§') && (t[1].match(/"/g) || []).length % 2 === 0
        && typeof t[2] === 'string' && t[2].includes('§') && (t[2].match(/"/g) || []).length % 2 === 0);
      const usesBoth = poolName === 'duo' ? thread.some(t => t[0] === 'A') && thread.some(t => t[0] === 'B') : true;
      if (!(ok && usesBoth)) { bad = thread; break; }
    }
    check(`fellatio: ${poolName} threads are well-formed`, bad === null, bad ? JSON.stringify(bad).slice(0, 120) : '');
  }

  // Beckon / dismiss are keeper-only: nobody's consorts answer to a stranger.
  check('consortsOf: bogus handle owns no consorts', _test.consortsOf('__nobody__').length === 0);

  const stranger = { handle: '__nobody__', id: 'regress_stranger', current_zone: 'zone_nowhere' };
  const beckonDenied = await _test.cmdBeckon([], 'beckon', stranger);
  check('beckon: stranger is refused', beckonDenied?.type === 'error' && /answers to you/i.test(beckonDenied.message || ''), beckonDenied?.message);
  const dismissDenied = await _test.cmdDismiss([], 'dismiss', stranger);
  check('dismiss: stranger is refused', dismissDenied?.type === 'error' && /answers to you/i.test(dismissDenied.message || ''), dismissDenied?.message);

  // Pour is keeper-gated: a stranger with no consort present is refused, and there's
  // no bar to pour from out in the void.
  const pourDenied = await _test.cmdPour([], 'pour', stranger);
  check('pour: stranger with no consort is refused', pourDenied?.type === 'error' && /pour for you|answers to/i.test(pourDenied.message || ''), pourDenied?.message);
  check('pour: barIn finds no bar in an empty zone', _test.barIn('zone_nowhere') === null);

  // Every voice carries pour pools, and each line renders the drink phrase it's given.
  let pourBad = null;
  for (const [vname, v] of Object.entries(_test.VOICE)) {
    for (const key of ['pourTame', 'pourHot']) {
      const pool = v[key];
      if (!Array.isArray(pool) || pool.length === 0
        || !pool.every(fn => typeof fn === 'function' && /a test cocktail/.test(String(fn('a test cocktail') || '')))) {
        pourBad = `${vname}.${key}`; break;
      }
    }
    if (pourBad) break;
  }
  check('pour: every register carries pour pools that render the drink', pourBad === null, pourBad || '');

  // retreatConsorts leaves an already-tucked-away consort untouched (home==here).
  const tucked = { name: 'Fake', home_zone: 'zone_boudoir_x', zone_id: 'zone_boudoir_x', flags: { consort: true } };
  check('retreat: no-op when already home', _test.retreatConsorts([tucked]).length === 0);

  // Area profiles: the deck she's on is read off zone flags (nothing hardcoded).
  check('area: sundeck flag → sundeck profile', _test.areaProfile({ flags: { echelon_sundeck: true } }) === 'sundeck');
  check('area: view flag → view profile', _test.areaProfile({ flags: { echelon_view: true } }) === 'view');
  check('area: helipad flag → helipad profile', _test.areaProfile({ flags: { echelon_helipad: true } }) === 'helipad');
  check('area: unflagged aboard zone → cabin profile', _test.areaProfile({ flags: {} }) === 'cabin');
  check('area: suite/boudoir are intimate zones', _test.isIntimateZone({ flags: { echelon_suite: true } }) === true);
  check('area: the sun deck is NOT an intimate zone', _test.isIntimateZone({ flags: { echelon_sundeck: true } }) === false);

  // Every activity in every profile is well-formed (a name-templating start line and
  // at least one idle beat), and all four profiles carry a variety.
  let actsBad = null, thinProfile = null;
  for (const [prof, list] of Object.entries(_test.AREA_ACTIVITIES)) {
    if (!Array.isArray(list) || list.length < 3) thinProfile = prof;
    for (const a of list) {
      const startOk = a.start && typeof a.start.t === 'function' && a.start.t('Roxy').includes('Roxy');
      const idleOk = Array.isArray(a.idle) && a.idle.length > 0 && a.idle.every(l => typeof l.t === 'function');
      if (!(a.key && startOk && idleOk)) { actsBad = `${prof}/${a.key}`; break; }
    }
    if (actsBad) break;
  }
  check('area: every activity is well-formed', actsBad === null, actsBad || '');
  check('area: sundeck/view/helipad/cabin all have variety', thinProfile === null, thinProfile || '');

  // runAreaActivity starts an activity for a consort on the sun deck without throwing,
  // and stamps the hold timer so she stays in it a while.
  const deckGirl = { id: 'regress_deck_roxy', name: 'Roxy', zone_id: 'zone_deck_x',
    flags: { consort: true, devoted_to: 'Cyd' } };
  let deckThrew = false;
  try { _test.runAreaActivity(deckGirl, { flags: { echelon_sundeck: true } }, 'zone_deck_x', 1_000_000, false, false); }
  catch { deckThrew = true; }
  check('area: runAreaActivity picks an activity without throwing', deckThrew === false && !!deckGirl._activity);
  check('area: the activity holds for a good while', (deckGirl._activityUntil || 0) - 1_000_000 >= _test.ACT_MIN_MS || (deckGirl._activityUntil || 0) > 1_000_000);
  check('area: onFurniture is set to a name or null (never undefined)', deckGirl.onFurniture === null || typeof deckGirl.onFurniture === 'string');

  // Every sun-deck activity that occupies furniture points at a real furniture name.
  const OCCUPIABLE = new Set(['jacuzzi', 'sun loungers']);
  let badOccupy = null;
  for (const a of _test.AREA_ACTIVITIES.sundeck) {
    if (a.occupies && !OCCUPIABLE.has(a.occupies)) { badOccupy = `${a.key}→${a.occupies}`; break; }
  }
  check('area: sundeck occupies-targets are real furniture names', badOccupy === null, badOccupy || '');

  // Deck banter pools are well-formed two-handers (both voices, balanced quotes).
  let bantBad = null;
  for (const [prof, pool] of Object.entries(_test.AREA_BANTER)) {
    for (const thread of pool) {
      const whos = thread.map(t => t[0]);
      const ok = thread.length >= 2 && whos.includes('R') && whos.includes('B')
        && whos.every(w => w === 'R' || w === 'B')
        && thread.every(([, line]) => typeof line === 'string' && line.trim() && (line.match(/"/g) || []).length % 2 === 0);
      if (!ok) { bantBad = `${prof}: ${JSON.stringify(thread).slice(0, 100)}`; break; }
    }
    if (bantBad) break;
  }
  check('area: deck banter threads are well-formed two-handers', bantBad === null, bantBad || '');

  // Furniture-describe hook: a line for a consort parked on the piece, nothing otherwise.
  const jac = { zone_id: 'zone_deck_x', name: 'jacuzzi' };
  check('furn: no describe line when nobody is parked', _test.onFurnitureDescribe(jac, null) === undefined);
  _test.arousal.delete('regress_deck_roxy');
  _test.lastSpoke.delete('regress_deck_roxy');

  // The tick must survive a sweep of the live world without throwing.
  let threw = false;
  try { _test.consortTick(); } catch { threw = true; }
  check('tick: sweeps the world without throwing', threw === false);

  // Housekeeping — don't leave regress ids in the shared in-memory maps.
  _test.arousal.delete('regress_consort_roxy');
  _test.lastSpoke.delete('regress_consort_roxy');
}
