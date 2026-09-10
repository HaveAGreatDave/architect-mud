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
    look: "He stands too still and doesn't blink.",
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
  check('examine returns the phantom look', /doesn't blink/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 120));

  // talk gets the uncanny non-response, not a dialogue tree.
  r = await run('talk gaunt');
  check('talk gets the phantom non-response', /only watches/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 120));

  // A target that matches nothing real AND no phantom falls through to the
  // engine — the plugin must not swallow it.
  r = await run('examine nonesuch_xyz');
  check('non-phantom examine falls through', !/doesn't blink/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 120));

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

  // ── A transformed thing is the ONLY thing there ─────────────────────────────
  //
  // If the bed is a sleeping lion, `examine lion` must work and `examine bed`
  // must not — a bed that still answers is a bed the player can prove is there,
  // which is the entire trick, gone.
  const { addTransform, clearTransforms, findTransformByName, isTransformed, getTransforms } =
    await import('../../server/engine/phantoms.js');
  const { getZoneFurniture, world } = await import('../../server/engine/world.js');
  // The test zone is usually bare, so borrow a real room that has a piece in it
  // — the resolution rule is what is under test, not the geography.
  const piece = (getZoneFurniture(p.current_zone) || [])[0]
    || [...world.furniture.values()].find(f => f.zone_id && f.name);
  const homeZone = p.current_zone;
  if (piece) {
    p.current_zone = piece.zone_id;
    clearTransforms(p.id);
    addTransform(p.id, piece.id, {
      name: 'a sleeping lion',
      description: 'A lion is asleep across the room, flanks rising and falling.',
      looks: ['One ear tracks you around the room. Nothing else moves.'],
      says: ["Lie down if you're going to."],
      emotes: ['{it} yawns, jaw cracking, and resettles.'],
      asks: ['Are you getting in or not?'],
    });
    check('the new name resolves', findTransformByName(p.id, 'lion')?.furnitureId === piece.id);
    check('...and so does a word inside it', findTransformByName(p.id, 'sleeping')?.furnitureId === piece.id);
    check('...and the piece reads as transformed', isTransformed(p.id, piece.id) === true);

    r = await run('examine lion');
    check('examine finds it under the name you can SEE',
      /One ear tracks you/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 140));

    // The real name must NOT come back — not the transform, and not the bed.
    const realWord = String(piece.name).split(/\s+/).pop();
    r = await run(`examine ${realWord}`);
    check("...while the thing it used to be isn't there any more",
      !new RegExp(piece.description?.slice(0, 25) || '__none__').test(r?.message || ''),
      JSON.stringify(r?.message)?.slice(0, 140));

    // The forgery has to wear the SAME markup a real NPC's speech wears — same
    // check the sanity plugin's voices make, and for the same reason.
    const { _speechLine, _fillTokens, _theOf } = await import('./index.js');
    const line = _speechLine('a sleeping lion', 'says', "Lie down if you're going to.");
    check('a thing speaks in the same wrapper an NPC does', /^<span class="speech-line">/.test(line), line);
    check('...with the standard attribution and quotes',
      /A sleeping lion says, "Lie down if you're going to\."/.test(line), line);
    check('...and never announces itself as a hallucination',
      !/without a mouth|hallucinat|pretend/i.test(line), line);
    check('{it} fills with the subject form of the new name',
      _fillTokens('{it} yawns.', { it: _theOf('a sleeping lion') }) === 'The sleeping lion yawns.');
    check('...from any article', _theOf('an enormous tree') === 'The enormous tree');

    // ── Coming down is WATCHED, not discovered ────────────────────────────
    // Going on, the pane animates real → hallucination. Coming off used to just
    // print the real name with nothing to say it had changed, which reads as a
    // rendering glitch. The fade is what gives the render the other end of the
    // same animation.
    const { beginTransformFade, applyTransforms, getTransformFade, clearTransformFade,
            clearTransformsForRedress } = await import('../../server/engine/phantoms.js');

    beginTransformFade(p.id);
    clearTransforms(p.id);
    check('coming down puts the room back', getTransforms(p.id).length === 0);
    check('...and leaves a fade behind to animate', !!getTransformFade(p.id));

    let shown = applyTransforms(p.id, [piece]).find(f => f.id === piece.id);
    check('the faded piece renders under its REAL name again',
      shown.name === piece.name, `${shown.name} vs ${piece.name}`);
    check('...and reports what the viewer had been seeing, for the morph',
      shown._morphFrom === 'a sleeping lion', String(shown._morphFrom));
    // ⚠ Never `_realName`: for an NPC that field is also the talk target, and
    // for furniture it is what callers act on. A fading piece is fully itself.
    check('...on _morphFrom, never _realName', shown._realName === undefined, String(shown._realName));
    check("...and isn't transformed any more", shown._transformed === undefined);

    r = await run('examine lion');
    check("...and the lion isn't there any more",
      !/One ear tracks you/.test(r?.message || ''), JSON.stringify(r?.message)?.slice(0, 120));

    // Re-dressing mid-trip is NOT a comedown. A fade surviving it would animate a
    // piece back to its real name while the player is still high.
    clearTransformFade(p.id);
    addTransform(p.id, piece.id, { name: 'a sleeping lion' });
    beginTransformFade(p.id);
    clearTransformsForRedress(p.id);
    check('re-dressing mid-trip drops the fade rather than animating back',
      !getTransformFade(p.id));
    shown = applyTransforms(p.id, [piece]).find(f => f.id === piece.id);
    check('...so the piece carries no morph at all', shown._morphFrom === undefined);

    // A fade for a piece whose name never actually changed is not a morph.
    clearTransformFade(p.id);
    addTransform(p.id, piece.id, { name: piece.name });
    beginTransformFade(p.id);
    clearTransforms(p.id);
    shown = applyTransforms(p.id, [piece]).find(f => f.id === piece.id);
    check('a transform that never changed the name animates nothing',
      shown._morphFrom === undefined, String(shown._morphFrom));
    clearTransformFade(p.id);

    // ── Other PLAYERS transform too ───────────────────────────────────────
    // A room where the staff can turn into herons and the customers never can is
    // a rule a player works out and then uses. But somebody else's night is not
    // your hallucination: the label changes and NOTHING else does.
    const { addPlayerTransform, applyPlayerTransforms, getPlayerTransform,
            findPlayerTransformByName, getPlayerTransforms } =
      await import('../../server/engine/phantoms.js');

    const victim = { id: 'regress_victim', handle: 'Marla', current_zone: p.current_zone };
    addPlayerTransform(p.id, victim.id, { name: 'a bear in a good coat', description: 'A bear.' });
    check('a player can be transformed for one viewer', !!getPlayerTransform(p.id, victim.id));
    check('...and resolves by the name being seen',
      findPlayerTransformByName(p.id, 'bear')?.targetId === victim.id);

    const seenList = applyPlayerTransforms(p.id, [victim]);
    const seenP = seenList[0];
    check('the viewer sees the transformed name', seenP._seenAs === 'a bear in a good coat', String(seenP._seenAs));
    // ⚠ The one that matters. Every caller that acts on a player reads `handle`;
    // rewriting it here would reroute somebody's attack at a name that does not
    // exist, and would let a griefer hide behind a third party's trip.
    check('...but the HANDLE is untouched, so they stay addressable',
      seenP.handle === 'Marla', String(seenP.handle));
    check("...and the live player object wasn't mutated",
      victim._seenAs === undefined && victim.handle === 'Marla');

    // Nobody else's view is affected.
    const otherView = applyPlayerTransforms('regress_bystander', [victim])[0];
    check('another viewer sees the real person', otherView._seenAs === undefined);

    // You are never your own hallucination.
    check("a viewer can't be transformed into themselves",
      addPlayerTransform(p.id, p.id, { name: 'a heron' }) === null);
    check('...and no such entry is stored', !getPlayerTransform(p.id, p.id));

    // Coming down animates a player back too.
    beginTransformFade(p.id);
    clearTransforms(p.id);
    check('a transformed player is released on comedown', getPlayerTransforms(p.id).length === 0);
    const faded = applyPlayerTransforms(p.id, [victim])[0];
    check('...and animates back from what was seen to the real handle',
      faded._morphFrom === 'a bear in a good coat' && faded.handle === 'Marla',
      `${faded._morphFrom}/${faded.handle}`);
    clearTransformFade(p.id);

    // Every authored `person` entry must be reachable BY A PLAYER, which means
    // unnarrowed: `matches` is tested against npc_type and a player has none, so
    // a narrowed entry can only ever fire on an NPC. Content check, not a code
    // one, and the reason it is here is that nothing else would ever catch it.
    const { rows: personRows } = await (await import('../../server/models/db.js'))
      .query(`SELECT id FROM drug_transforms WHERE scope='person' AND matches IS NOT NULL`);
    check('no person transform is narrowed out of ever reaching a player',
      personRows.length === 0, personRows.map(r => r.id).join(','));

    p.current_zone = homeZone;
  } else {
    check('transform resolution (no furniture in test zone)', true, 'skipped');
  }

  // ── Talking to it is a CONVERSATION ─────────────────────────────────────────
  //
  // One line back was never a conversation. `talk <shape>` opens the ordinary
  // dialogue panel against something with no npcs row behind it, routed through
  // the engine's dialogue.synthetic seam.
  if (piece) {
    p.current_zone = piece.zone_id;
    clearTransforms(p.id);
    addTransform(p.id, piece.id, {
      name: 'a sleeping lion',
      description: 'A lion is asleep across the room.',
      looks: ['One ear tracks you around the room.'],
      says: ["Lie down if you're going to."],
      emotes: ['{it} yawns and resettles.'],
      asks: ['Are you getting in or not?'],
    });
    const trip = await import('./index.js');
    r = await run('talk lion');
    check('talking to it opens a dialogue panel', r?.type === 'dialogue', JSON.stringify(r)?.slice(0, 120));
    check('...named after the shape, not the furniture',
      /lion/i.test(r?.npcName || '') && !/bed|chair/i.test(r?.npcName || ''), r?.npcName);
    check('...under an id no NPC row could own', String(r?.npcId || '').startsWith('trip:'), r?.npcId);
    check('...offering things you can only say to a hallucination',
      (r?.options || []).some(o => /isn't real/i.test(o.label)), JSON.stringify(r?.options));

    const conv = r;
    // Every branch has to answer — an empty pool would silently end the talk.
    for (const opt of conv.options.filter(o => o.next !== '__end__')) {
      const next = await trip.hooks['dialogue.synthetic']({ player: p, npcId: conv.npcId, choice: opt.next });
      check(`"${opt.label}" gets an answer`, !!next && (next.type === 'dialogue' || next.type === 'dialogue_end'),
        JSON.stringify(next)?.slice(0, 120));
      check(`..."${opt.label}" answers with words`, !!(next?.text || next?.message),
        JSON.stringify(next)?.slice(0, 120));
    }

    // It runs out of conversation rather than looping forever.
    let frame = await trip.hooks['dialogue.synthetic']({ player: p, npcId: conv.npcId, choice: 'answer' });
    let guard = 0;
    while (frame?.type === 'dialogue' && guard++ < 20) {
      frame = await trip.hooks['dialogue.synthetic']({ player: p, npcId: conv.npcId, choice: 'answer' });
    }
    check('the conversation winds down instead of looping', frame?.type === 'dialogue_end', `frames=${guard}`);

    // ...and the shape going away ends it rather than stranding an open panel.
    r = await run('talk lion');
    clearTransforms(p.id);
    const orphan = await trip.hooks['dialogue.synthetic']({ player: p, npcId: r.npcId, choice: 'answer' });
    check('coming down ends a conversation in progress', orphan?.type === 'dialogue_end',
      JSON.stringify(orphan)?.slice(0, 120));

    // A synthetic id belonging to nobody must not be claimed.
    const foreign = await trip.hooks['dialogue.synthetic']({ player: p, npcId: 'someotherplugin:xyz', choice: 'root' });
    check('another plugin\'s synthetic speaker is left alone', foreign === undefined, JSON.stringify(foreign));

    p.current_zone = homeZone;
  }

  // Every shared pool the beat draws on must actually have lines in it — an
  // empty pool degrades silently to nothing being said at all.
  {
    const { query: q3 } = await import('../../server/models/db.js');
    for (const src of ['object', 'object_emote', 'object_ask',
                       'object_reply_answer', 'object_reply_identity',
                       'object_reply_denial', 'object_reply_farewell']) {
      const { rows } = await q3(`SELECT COUNT(*)::int AS c FROM drug_reactions WHERE source=$1`, [src]);
      check(`the ${src} pool has lines`, rows[0].c >= 8, `count=${rows[0].c}`);
    }
    const { rows: sc } = await q3(`SELECT scope, COUNT(*)::int AS c FROM drug_transforms GROUP BY scope`);
    const byScope = Object.fromEntries(sc.map(r => [r.scope, r.c]));
    for (const s of ['object', 'room', 'spawn', 'person', 'weather']) {
      check(`there are ${s} transforms authored`, (byScope[s] || 0) > 0, JSON.stringify(byScope));
    }
    const { rows: hedged } = await q3(
      `SELECT id FROM drug_transforms WHERE name ILIKE '%pretend%' OR name ILIKE '%something that%'`);
    check('no transform hedges about what it is', hedged.length === 0,
      hedged.map(h => h.id).join('|'));
  }

  // ── Social reactions: who says it, and to whom ──────────────────────────────
  const { _scopeToNpc, _npcMaySpeak, _rememberSaid, _forgetSaid } = await import('./index.js');
  const { query: q2 } = await import('../../server/models/db.js');
  const pool = (await q2(`SELECT * FROM drug_reactions WHERE source='npc'`)).rows;
  check('there are npc reactions to draw on', pool.length >= 10);

  // SPECIFIC WINS, but only when something specific exists — no combination of
  // trade and relationship may leave an NPC with nothing to say.
  // The chain is TYPE → RELATION → general, each step only when it has anything.
  const byRelationOnly = _scopeToNpc(pool, { npc_type: 'nobody_has_this_type' }, 'stranger');
  check('an unknown trade falls through to the relationship', byRelationOnly.length > 0
    && byRelationOnly.every(r => r.relation === 'stranger'));
  const generic = _scopeToNpc(pool, { npc_type: 'nobody_has_this_type' }, 'no_such_tier');
  check('...and with neither, to the general pool', generic.length > 0);
  check('...which is genuinely unscoped', generic.every(r => !r.npc_type && !r.relation));
  const cop = _scopeToNpc(pool, { npc_type: 'cop' }, 'stranger');
  check('a cop gets cop lines', cop.length > 0 && cop.every(r => r.npc_type === 'cop'));
  const close = _scopeToNpc(pool, { npc_type: null }, 'close');
  check('a close friend gets friend lines, not stranger ones',
    close.length > 0 && close.every(r => r.relation === 'close'));
  check('...which are different from what a stranger gets',
    JSON.stringify(close.map(r => r.id)) !==
    JSON.stringify(_scopeToNpc(pool, { npc_type: null }, 'stranger').map(r => r.id)));
  for (const tier of ['stranger', 'known', 'familiar', 'close', 'wary', 'hostile']) {
    check(`a ${tier} npc always has something to say`, _scopeToNpc(pool, {}, tier).length > 0);
  }

  // MEMORY. Without it an NPC asks if you're all right, you step out and back in,
  // and it asks again — which reads as a broken robot rather than a person.
  _forgetSaid('regress-social');
  check('an npc who has said nothing may speak', _npcMaySpeak('regress-social', 'npc_a') === true);
  _rememberSaid('regress-social', 'npc_a', 'dr_npc_normal_501');
  check('...and then holds off for a while', _npcMaySpeak('regress-social', 'npc_a') === false);
  check('...while a DIFFERENT npc is unaffected', _npcMaySpeak('regress-social', 'npc_b') === true);
  _forgetSaid('regress-social');
  check('coming down clears what everyone remembers', _npcMaySpeak('regress-social', 'npc_a') === true);

  check('clearPhantoms empties the roster', getPhantoms(p.id).length === 0);
}
