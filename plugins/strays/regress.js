// strays plugin regression suite — run by tests/regress.js, never loaded in
// production.
//
// The most valuable check in this file is the respawn one. Killing Cathode is
// supposed to take it out of the world for 24 hours, but combat.js has already
// set _respawnAt to now + 60 SECONDS by the time our event handler runs, and
// npcWanderTick will happily act on that. If anything ever reorders the weapon
// plugin's emit, or an `await` creeps above that assignment in onKilled, the
// feature silently degrades to a one-minute sulk and absolutely nothing else in
// the codebase notices. That is what this suite is for.

import { _test as strays, CAT_ID, DEN_ZONE, LANE_ZONES } from './index.js';
import { BEHAVIOURS, pickBehaviour } from './behaviours.js';
import { moodToward, PETS_FLAG, KILLS_FLAG, PET_AT_FLAG, PET_COOLDOWN_MS } from './memory.js';
import { ANIMAL_CHITCHAT_LINES, DEFAULT_CHITCHAT_LINES, formatChitchat } from '../../server/engine/ai-behaviour.js';
import { getNpcChitchat } from '../../server/engine/npc-personality.js';
import { world, getZone } from '../../server/engine/world.js';
import { setFlag, clearFlag } from '../../server/engine/flags.js';

export default async function regress({ run, check, getPlayer }) {
  const { S, cat, surface, despawn, onKilled, hiddenUntil, setHiddenUntil, isSurfaced, HIDE_MS } = strays;

  // ── The behaviour table (pure — always runs) ────────────────────────────────
  const keys = BEHAVIOURS.map((b) => b.key);
  check('behaviours: every key is unique', new Set(keys).size === keys.length,
    `${keys.length} entries, ${new Set(keys).size} unique`);
  check('behaviours: the table is actually varied', BEHAVIOURS.length >= 30, String(BEHAVIOURS.length));

  // Every gate must survive a minimal ctx. The tick builds a rich one, but a gate
  // that assumes furniture/env/player exists will throw on a bare room at 3am and
  // silently make the cat mute — pickBehaviour swallows gate errors by design.
  const bare = { name: 'Cathode', zone: {}, players: [], furniture: [], env: {}, mood: 'wary', pets: 0 };
  let threw = null;
  for (const b of BEHAVIOURS) {
    try { b.gate(bare); } catch (e) { threw = `${b.key}: ${e.message}`; break; }
  }
  check('behaviours: no gate throws on a minimal ctx', !threw, threw || 'all clean');

  // Every line must render for the mood it gates on, with no name left dangling.
  let badLine = null;
  for (const b of BEHAVIOURS) {
    const ctx = { ...bare, mood: 'seek', pets: 12, player: { handle: 'Tester' } };
    try {
      const s = b.line(ctx);
      if (typeof s !== 'string' || !s.trim()) badLine = `${b.key}: empty`;
      else if (s.includes('undefined')) badLine = `${b.key}: ${s.slice(0, 60)}`;
    } catch (e) { badLine = `${b.key}: ${e.message}`; }
    if (badLine) break;
  }
  check('behaviours: every line renders without "undefined"', !badLine, badLine || 'all clean');

  // ── Cuddling up ────────────────────────────────────────────────────────────
  // She only ever settles against somebody she is neutral or better toward. A
  // stranger does not get leaned on and a killer certainly does not.
  const cuddles = BEHAVIOURS.filter((b) => b.key.startsWith('cuddle_'));
  check('cuddle: there is something to cuddle with', cuddles.length >= 2, String(cuddles.length));
  const sitter = { handle: 'Tester', posture: 'sitting' };
  const gatedFor = (mood) => cuddles.filter((b) => {
    try { return !!b.gate({ ...bare, mood, pets: 12, player: sitter }); } catch { return false; }
  });
  check('cuddle: a regular gets cuddled', gatedFor('seek').length > 0);
  check('cuddle: so does somebody it merely knows', gatedFor('neutral').length > 0);
  check('cuddle: a stranger does not', gatedFor('wary').length === 0,
    gatedFor('wary').map((b) => b.key).join(', '));
  check('cuddle: a killer does not', gatedFor('flee').length === 0,
    gatedFor('flee').map((b) => b.key).join(', '));
  check('cuddle: none of them fires with nobody to cuddle',
    cuddles.every((b) => { try { return !b.gate({ ...bare, mood: 'seek' }); } catch { return false; } }));

  // A behaviour aimed at somebody must render BOTH halves — index.js sends the
  // second person to them and the third person to the room, and a broken `you`
  // would silently drop the room line with it.
  let badYou = null;
  for (const b of BEHAVIOURS.filter((x) => x.you)) {
    const ctx = { ...bare, mood: 'seek', pets: 12, player: sitter };
    try {
      const s = b.you(ctx);
      if (typeof s !== 'string' || !s.trim() || s.includes('undefined')) badYou = `${b.key}: ${String(s).slice(0, 60)}`;
      else if (/\bthey\b|\bTester\b/.test(s)) badYou = `${b.key}: third person in a second-person line`;
    } catch (e) { badYou = `${b.key}: ${e.message}`; }
    if (badYou) break;
  }
  check('cuddle: every second-person line renders in the second person', !badYou, badYou || 'all clean');

  check('behaviours: the plain-cat baseline survives', keys.includes('loaf') && keys.includes('groom'),
    'a table of nothing but paw jokes is a mechanism, not an animal');
  check('behaviours: pickBehaviour returns something for a bare room',
    !!pickBehaviour(bare, []), 'silence reads as a bug');
  check('behaviours: recency does not starve the pool to nothing',
    !!pickBehaviour(bare, keys), 'a repeat beats going mute');

  // ── Memory (pure-ish — flag reads on a hydrated player) ────────────────────
  const P = getPlayer();
  const resetMemory = async () => {
    await clearFlag('player', PETS_FLAG, P);
    await clearFlag('player', KILLS_FLAG, P);
    await clearFlag('player', PET_AT_FLAG, P);
  };

  await resetMemory();
  check('memory: a stranger is wary', await moodToward(P, CAT_ID) === 'wary');

  await setFlag('player', PETS_FLAG, '1', P);
  check('memory: one pet makes it neutral', await moodToward(P, CAT_ID) === 'neutral');

  await setFlag('player', PETS_FLAG, '6', P);
  check('memory: a regular is sought out', await moodToward(P, CAT_ID) === 'seek');

  // The whole moral weight of the feature: a kill outranks everything, including
  // being its favourite person five minutes earlier.
  await setFlag('player', KILLS_FLAG, '1', P);
  check('memory: a kill outranks any amount of petting',
    await moodToward(P, CAT_ID) === 'flee', 'there is deliberately no way back');

  await resetMemory();
  check('memory: the pet cooldown is a real duration', PET_COOLDOWN_MS >= 60 * 60_000, String(PET_COOLDOWN_MS));

  // ── World integration ──────────────────────────────────────────────────────
  // Needs the content loaded. In CI the order is lint -> import -> regress, so
  // the cat is there; locally a stale DB gives one honest red rather than a
  // silent skip.
  const c = cat();
  check('content: Cathode is loaded', !!c, `${CAT_ID} missing — run: npm run content:import`);
  check('content: the den zone exists', !!getZone(DEN_ZONE), DEN_ZONE);

  if (c && getZone(DEN_ZONE)) {
    check('content: the cat is flagged for the plugin to find', c.flags?.stray_cat === true, JSON.stringify(c.flags));
    check('content: home_zone is the den (the engine returns it to hiding for free)',
      c.home_zone === DEN_ZONE, c.home_zone);
    check('content: the cat does not wander (the engine must not move it)', !c.wanders, String(c.wanders));
    check('content: the cat has no behaviour graph (ditto)',
      !c.behaviour_graph?._start, JSON.stringify(c.behaviour_graph)?.slice(0, 60));
    // A no_attack cat would be a statue with a personality. The whole weight of
    // the feature is that killing it is easy and permitted.
    check('content: the cat is killable on purpose', !c.flags?.no_attack, 'no_attack must stay unset');
    check('content: the den is sealed', Object.keys(getZone(DEN_ZONE).exits || {}).length === 0,
      JSON.stringify(getZone(DEN_ZONE).exits));

    // Default state: hidden, and in no lane room.
    const inLane = () => LANE_ZONES.filter((z) => world.zones.get(z)?.npcs?.has(CAT_ID));
    const inDen = () => !!world.zones.get(DEN_ZONE)?.npcs?.has(CAT_ID);

    const wasZone = c.zone_id;
    const wasHidden = await hiddenUntil();
    try {
      await setHiddenUntil(0);
      despawn();
      check('hiding: at rest the cat is in the den', inDen(), c.zone_id);
      check('hiding: at rest the cat is in no lane room', inLane().length === 0, inLane().join(','));

      // ── Membership integrity ────────────────────────────────────────────────
      // A raw set poke that gets this wrong yields a cat in two rooms, or in
      // none. reconcileNpcMembership now sweeps that on the 30s tick, but it
      // trusts `npc.zone_id` — so it repairs a drifted SET and cannot see a
      // wrongly-written FIELD, which is what these assertions are for.
      const lane = LANE_ZONES[2];
      surface(lane, 'regress: surfacing');
      check('surface: the cat is in the lane room', world.zones.get(lane)?.npcs?.has(CAT_ID), lane);
      check('surface: and is NOT still in the den', !inDen(), 'membership drift');
      check('surface: and is in exactly one lane room', inLane().length === 1, inLane().join(','));
      check('surface: state agrees with the world', isSurfaced() && S.zoneId === lane, String(S.zoneId));

      despawn('regress: despawning');
      check('despawn: back in the den', inDen(), c.zone_id);
      check('despawn: gone from every lane room', inLane().length === 0, inLane().join(','));
      check('despawn: state agrees with the world', !isSurfaced(), String(S.zoneId));

      // ── The hide gate ───────────────────────────────────────────────────────
      await setHiddenUntil(Date.now() + HIDE_MS);
      S.lastSurfaceAt = 0;                       // pretend the quiet gap has passed
      await strays.strayTick();
      check('hide gate: a hidden cat does not surface even with the lane occupied',
        !isSurfaced() && inLane().length === 0, String(S.zoneId));

      // ── THE ONE THAT MATTERS ────────────────────────────────────────────────
      // combat.js sets _respawnAt to now + 60s. Our handler must overwrite it
      // synchronously, before any await, or npcWanderTick resurrects the cat a
      // minute after it died and the 24-hour grief window quietly becomes 60s.
      c._respawnAt = Date.now() + 60_000;        // exactly what combat.js just did
      c._dead = true;
      onKilled({ actor: P, npc: c });            // sync path only; no await
      const window = c._respawnAt - Date.now();
      check('kill: the 24h hide overwrites the engine 60s respawn SYNCHRONOUSLY',
        window > 23 * 60 * 60_000, `${Math.round(window / 60_000)} min`);
      check('kill: the cat is sent home to the den', c.home_zone === DEN_ZONE, c.home_zone);
      check('kill: any open window is closed immediately', !isSurfaced(), String(S.zoneId));

      // The durable half. finishKill is async and best-effort; await it directly
      // rather than racing the fire-and-forget bus.
      await strays.finishKill({ actor: P, npc: c });
      check('kill: the hide deadline survives a restart (world flag)',
        (await hiddenUntil()) - Date.now() > 23 * 60 * 60_000,
        String(Math.round(((await hiddenUntil()) - Date.now()) / 60_000)));
      check('kill: the killer is remembered', await moodToward(P, CAT_ID) === 'flee');

      // ── A killer is refused, and never told why ─────────────────────────────
      // Asserted by MEMBERSHIP in the authored lists, not by matching words in
      // the prose — a regex over flavour text fails the build every time somebody
      // writes a new line, which trains people to weaken the check.
      const refusal = await strays.onPetAttempt({ player: P, npc: c, zoneId: P.current_zone, broadcast: () => {} });
      const anyRung = [...strays.HISS_LINES, ...strays.BITE_LINES, ...strays.BOLT_LINES];
      check('pet: a killer is refused',
        refusal?.type === 'output' && anyRung.includes(refusal.message),
        (refusal?.message || '').slice(0, 60));
      // The refusal must never NAME the thing. Not "you killed it", not "it
      // remembers", not "after what you did" — the player knows exactly why, and
      // the game saying so out loud turns a cold shoulder into a lecture.
      //
      // Checked against EVERY authored refusal, not just whichever one this run
      // happened to roll: a random pick means a leaky line would only fail the
      // build sometimes, which is worse than not testing it at all.
      //
      // Word choice matters here. Bare /before/ and /again/ were both tried and
      // both are wrong — "gone before your hand is halfway down" and "sits down
      // again facing away" are innocent, and banning the vocabulary costs good
      // prose without catching anything. These patterns are phrases that can
      // only be an accusation.
      const ACCUSING = /kill|dead|murder|remembers|what you did|last time|deserve|after all/i;
      const leaky = anyRung.filter((line) => ACCUSING.test(line));
      check('pet: no refusal line on any rung mentions what they did',
        leaky.length === 0, leaky[0]?.slice(0, 80) || `${anyRung.length} lines clean`);

      // ── The refusal ladder: hiss, then bite, then simply gone ───────────────
      // The order is the characterisation. A cat that bit on the first reach
      // would be vicious; one that never escalated would be scenery.
      const petAgain = () => strays.onPetAttempt({ player: P, npc: c, zoneId: P.current_zone, broadcast: () => {} });

      strays.refusalAttempts.delete(P.id);
      await setFlag('player', KILLS_FLAG, '1', P);

      const r1 = await petAgain();
      check('ladder: the first reach after a kill gets a warning, not an injury',
        strays.HISS_LINES.includes(r1?.message), (r1?.message || '').slice(0, 60));

      const hpBefore = P.hp;
      const r2 = await petAgain();
      check('ladder: reaching again after the warning gets bitten',
        strays.BITE_LINES.includes(r2?.message), (r2?.message || '').slice(0, 60));
      check('ladder: the bite actually costs HP', P.hp < hpBefore, `${hpBefore} -> ${P.hp}`);
      check('ladder: the bite reports the new HP to the client',
        r2?.player_update?.hp === P.hp, JSON.stringify(r2?.player_update));

      // A cat must never be able to kill a player — that would route `pet` into
      // the whole death path (corpse, gear, respawn, wanted state).
      P.hp = 1;
      const r3 = await petAgain();
      check('ladder: a bite can never be lethal', P.hp >= 1, `hp=${P.hp}`);
      check('ladder: ...and still reads as a bite', strays.BITE_LINES.includes(r3?.message), (r3?.message || '').slice(0, 50));
      P.hp = hpBefore;

      // Twice killed: it stops arguing entirely. No warning, no defence, gone.
      await setFlag('player', KILLS_FLAG, '2', P);
      strays.refusalAttempts.delete(P.id);
      // Live for this one: the kill test left it dead and `surface` refuses on a
      // corpse, which made "bolting removes it from the room" pass without ever
      // having put it in a room.
      const deadForBolt = c._dead;
      c._dead = false;
      surface(LANE_ZONES[2], 'regress: surfacing for the bolt test');
      check('ladder: it is actually in the room to bolt from', isSurfaced());
      c._dead = deadForBolt;
      const hpBeforeBolt = P.hp;
      const r4 = await petAgain();
      check('ladder: a second kill means it just leaves',
        strays.BOLT_LINES.includes(r4?.message), (r4?.message || '').slice(0, 60));
      check('ladder: ...on the FIRST reach, with no warning rung',
        !strays.HISS_LINES.includes(r4?.message), 'the ladder must not restart');
      check('ladder: ...and it never becomes hostile', P.hp === hpBeforeBolt, `${hpBeforeBolt} -> ${P.hp}`);
      check('ladder: bolting actually removes it from the room', !isSurfaced(), String(S.zoneId));

      // ── Walking in on her, having killed her twice ──────────────────────────
      // The other half of the top rung: nobody reached for her, she was simply
      // in a room this player is also in. She hisses once and goes.
      // The kill test above left the cat dead, and `surface` refuses on a corpse.
      // These cases are about a live animal in a room, so put it back on its feet
      // for the duration and hand it over dead again afterwards.
      const wasDead = c._dead;
      c._dead = false;

      await setFlag('player', KILLS_FLAG, '2', P);
      surface(LANE_ZONES[3], 'regress: surfacing for the spook test');
      check('spook: she is out before the killer arrives', isSurfaced());
      await strays.onZoneEntered({ actor: P, zone: LANE_ZONES[3] });
      check('spook: a twice-over killer walking in empties the room',
        !isSurfaced(), String(S.zoneId));

      // One kill is not this rung. She still gets to exist in a room you are
      // standing in; that is the difference between unforgiven and weather.
      await setFlag('player', KILLS_FLAG, '1', P);
      surface(LANE_ZONES[3], 'regress: surfacing for the single-kill case');
      await strays.onZoneEntered({ actor: P, zone: LANE_ZONES[3] });
      check('spook: one kill does not empty the room', isSurfaced(), String(S.zoneId));
      despawn('regress: cleanup');
      c._dead = wasDead;

      check('spook: the threshold is the ladder\'s own top rung, not a new one',
        strays.REPEAT_KILLS === 2, String(strays.REPEAT_KILLS));
      // Same silence rule as every other refusal: she may hiss, she may never
      // say why.
      const spookLines = [...strays.SPOOK_YOU, ...strays.SPOOK_ROOM];
      const spookLeaky = spookLines.filter((l) => ACCUSING.test(l));
      check('spook: no line says what they did',
        spookLeaky.length === 0, spookLeaky[0]?.slice(0, 80) || `${spookLines.length} lines clean`);
      check('spook: the room line names who it was about',
        strays.SPOOK_ROOM.every((l) => l.includes('$who')), 'a bolt nobody can attribute is just a cat leaving');

      strays.refusalAttempts.delete(P.id);

      // ── Calling her ─────────────────────────────────────────────────────────
      const { CALL_RE, CALL_MISSES, CALL_HITS, CALL_CHANCE, lastCall, lastAnswered } = strays;

      check('call: "Cathode!" is understood', CALL_RE.test('Cathode!'));
      check('call: "Here Cathode!!" is understood', CALL_RE.test('Here Cathode!!'));
      check('call: the bare name works', CALL_RE.test('cathode'));
      check('call: "call cathode" works', CALL_RE.test('call cathode'));
      check('call: "summon cathode" works', CALL_RE.test('summon cathode'));
      check('call: pspsps works', CALL_RE.test('pspsps') && CALL_RE.test('psps') && CALL_RE.test('pspspsps'));

      // THE ONE THAT PROTECTS SOMEBODY ELSE'S PLUGIN. Bare `call`/`summon` are
      // gametable's (poker). If this matcher ever widens to swallow them, a
      // player at a poker table silently loses the ability to call a bet, and
      // nothing else in the suite would notice.
      check('call: bare "call" still belongs to poker', !CALL_RE.test('call'), 'gametable owns it');
      check('call: bare "summon" still belongs to poker', !CALL_RE.test('summon'), 'gametable owns it');
      check('call: "call dealer" is not swallowed', !CALL_RE.test('calldealer') && !CALL_RE.test('call dealer'));
      check('call: an unrelated sentence is not swallowed',
        !CALL_RE.test('say cathode is a cat') && !CALL_RE.test('kill cathode'));

      const MISS_OR_HIT = [...CALL_MISSES, ...CALL_HITS, 'She came.'];

      // Not in Coldwater: she has never left it, whatever you roll.
      await resetMemory();
      lastCall.delete(P.id); lastAnswered.delete(P.id);
      despawn();
      check('call: outside the city she is unreachable',
        strays.inTheCity({ id: 'zone_somewhere', flags: { region_id: 'region_scarletwastes' } }) === false);
      check('call: a dream/void room is not the city',
        strays.inTheCity({ id: [...world.transientZones][0] || 'zone_none', flags: { region_id: 'region_coldwater' } })
          === (world.transientZones.size ? false : true));

      // The 60s cooldown, and the fact that it is the SECOND call that is
      // refused — the first must always be allowed to roll.
      lastCall.delete(P.id);
      const firstShout = await strays.onCalled([], 'Cathode!', P, () => {});
      check('call: the first shout is answered one way or the other',
        MISS_OR_HIT.includes(firstShout?.message), (firstShout?.message || '').slice(0, 50));
      const secondShout = await strays.onCalled([], 'Cathode!', P, () => {});
      check('call: shouting again inside 60s is refused',
        !MISS_OR_HIT.includes(secondShout?.message), (secondShout?.message || '').slice(0, 50));
      check('call: the cooldown is the 60s asked for', strays.CALL_COOLDOWN_MS === 60_000,
        String(strays.CALL_COOLDOWN_MS));

      // SPAMMING MUST NOT HELP. The chance is flat, so a hundred refused-and-
      // retried calls may not raise it. This is the assertion that catches
      // somebody "improving" it with a pity counter.
      lastCall.delete(P.id); lastAnswered.delete(P.id);
      const chanceBefore = CALL_CHANCE.wary;
      for (let i = 0; i < 25; i++) {
        lastCall.delete(P.id);
        await strays.onCalled([], 'Cathode!', P, () => {});
      }
      check('call: 25 calls do not raise the odds (no streak/pity counter)',
        CALL_CHANCE.wary === chanceBefore, `${chanceBefore} -> ${CALL_CHANCE.wary}`);

      // A regular is likelier than a stranger, and a killer is never answered.
      check('call: the relationship is the only thing that moves the number',
        CALL_CHANCE.seek > CALL_CHANCE.neutral && CALL_CHANCE.neutral > CALL_CHANCE.wary,
        JSON.stringify(CALL_CHANCE));
      check('call: even the best odds stay rare', CALL_CHANCE.seek <= 0.25, String(CALL_CHANCE.seek));

      await setFlag('player', KILLS_FLAG, '1', P);
      despawn();
      lastCall.delete(P.id); lastAnswered.delete(P.id);
      let answeredAKiller = false;
      for (let i = 0; i < 40; i++) {
        lastCall.delete(P.id);
        const r = await strays.onCalled([], 'Cathode!', P, () => {});
        if (CALL_HITS.includes(r?.message) || r?.message === 'She came.') { answeredAKiller = true; break; }
      }
      check('call: she never comes for a killer, however many times they shout',
        !answeredAKiller && !isSurfaced(), 'she is there; she does not come; it is never said');

      // And the miss a killer gets is the ORDINARY miss — no special line, or
      // the message itself would tell them what they had done.
      lastCall.delete(P.id);
      const killerMiss = await strays.onCalled([], 'Cathode!', P, () => {});
      check('call: a killer gets the ordinary miss, not a special one',
        CALL_MISSES.includes(killerMiss?.message), (killerMiss?.message || '').slice(0, 50));

      await resetMemory();
      lastCall.delete(P.id); lastAnswered.delete(P.id);
      despawn();

      // A killer searching finds nothing. It is right there.
      await setHiddenUntil(0);
      const searched = await strays.searchForCat({ player: P, zoneId: lane, margin: 20 });
      check('search: a killer never finds it', searched === null, JSON.stringify(searched)?.slice(0, 60));

      // ── And a non-killer can ────────────────────────────────────────────────
      await resetMemory();
      c._dead = false;
      c._respawnAt = null;
      despawn();
      strays.perPlayerSearch.delete(P.id);
      const hit = await strays.searchForCat({ player: P, zoneId: lane, margin: 20 });
      check('search: a good roll in the lane turns the cat up', hit?.found === true, JSON.stringify(hit)?.slice(0, 80));
      check('search: finding it surfaces it into the searcher\'s room', S.zoneId === lane, String(S.zoneId));

      // A bad roll finds nothing, so `search` can never be a reliable detector.
      despawn();
      strays.perPlayerSearch.delete(P.id);
      check('search: a poor roll finds nothing',
        (await strays.searchForCat({ player: P, zoneId: lane, margin: 0 })) === null);

      // Outside the lane it does not exist, whatever you roll.
      strays.perPlayerSearch.delete(P.id);
      check('search: the cat is not findable outside its lane',
        (await strays.searchForCat({ player: P, zoneId: 'zone_start', margin: 20 })) === null);

      // ── Petting pays once ───────────────────────────────────────────────────
      await resetMemory();
      const first = await strays.onPetAttempt({ player: P, npc: c, zoneId: P.current_zone, broadcast: () => {} });
      check('pet: a stranger may pet it', first?.type === 'output', first?.type);
      const sanityAfterFirst = P.sanity;
      const second = await strays.onPetAttempt({ player: P, npc: c, zoneId: P.current_zone, broadcast: () => {} });
      check('pet: petting again still WORKS', second?.type === 'output', second?.type);
      check('pet: but pays no second helping of sanity', P.sanity === sanityAfterFirst,
        `${sanityAfterFirst} -> ${P.sanity}`);

      // ── The hook ignores every other animal ─────────────────────────────────
      // The guard against the cmdPet edit regressing every dog in the game.
      const other = await strays.onPetAttempt({
        player: P, npc: { id: 'npc_some_dog', name: 'a dog', flags: {} },
        zoneId: P.current_zone, broadcast: () => {},
      });
      check('pet: the hook falls through for any other animal', other === undefined, JSON.stringify(other));
    } finally {
      // Leave the world as we found it — a stray surfaced cat or a 24h world flag
      // would leak into every later suite.
      await setHiddenUntil(wasHidden || 0);
      await resetMemory();
      strays.perPlayerSearch.delete(P.id);
      strays.refusalAttempts.delete(P.id);
      strays.lastCall.delete(P.id);
      strays.lastAnswered.delete(P.id);
      c._dead = false;
      c._respawnAt = null;
      S.zoneId = null;
      S.surfacedUntil = 0;
      S.lastSurfaceAt = Date.now();
      if (wasZone && c.zone_id !== wasZone) {
        world.zones.get(c.zone_id)?.npcs?.delete(CAT_ID);
        c.zone_id = wasZone;
        world.zones.get(wasZone)?.npcs?.add(CAT_ID);
      }
    }
  }
  // ── She is a cat, and she talks like one ─────────────────────────────────
  // `talk` falls through to chitchat for an NPC with no dialogue tree, and the
  // engine default is a PERSON's small talk: wrist terminals, recycled air,
  // knuckles. Cathode had none authored, so talking to the stray cat used to
  // make her mutter about the radiation levels.
  {
    const c = strays.cat();
    const lines = getNpcChitchat(c) || [];
    check('cathode has her own noises', lines.length > 0, String(lines.length));
    // ⚠ UNQUOTED, DELIBERATELY. formatChitchat renders a "quoted" line as
    // `Cathode says, "…"` and anything else as an emote with the name prepended.
    // A quoted cat noise is a person doing an impression of a cat.
    const quoted = lines.filter((l) => l.trim().startsWith('"'));
    check('…and none of them is speech', quoted.length === 0, quoted.join(' | '));
    for (const l of lines) {
      const out = formatChitchat('Cathode', l).message;
      if (/says,/.test(out)) { check('…every line renders as an emote', false, out); break; }
    }
    check('…every line renders as an emote', !lines.some((l) => /says,/.test(formatChitchat('Cathode', l).message)));
    // The engine floor under an animal nobody has written lines for yet.
    check('the animal fallback is not a person s small talk',
      !ANIMAL_CHITCHAT_LINES.some((l) => DEFAULT_CHITCHAT_LINES.includes(l)));
  }

}
