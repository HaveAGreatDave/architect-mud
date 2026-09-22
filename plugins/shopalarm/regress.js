// shopalarm regression suite — run by tests/regress.js (never loaded in
// production).
//
// What is worth testing here is not "does the alarm go off" — it does, on a
// one-second sweep, and a test that waits for one is a slow test that proves a
// scheduler works. What is worth testing is every place this system can be
// SILENTLY wrong: the anti-spoof seams, the tier arithmetic, the one-clock rule,
// and the ordering that decides whether a trip charges four stars or nothing.
export default async function regress({ run, check, getPlayer }) {
  const { _test, hooks, specializedActions } = await import('./index.js');
  const player = getPlayer();

  // ── The resolve seam ───────────────────────────────────────────────────────
  let r = await run('alarmresolve');
  check('alarmresolve with no args no-ops', r?.type === 'noop', JSON.stringify(r)?.slice(0, 80));

  // A resolve for a board the player never opened must no-op. This is the one
  // that matters: a win accepted here would disarm an alarm from across the city.
  r = await run('alarmresolve zone_ghost_shop 1');
  check('unarmed alarmresolve no-ops (no remote disarm)', r?.type === 'noop', JSON.stringify(r)?.slice(0, 80));

  // ⚠ THE ONE-CLOCK RULE. A board that believes it won AFTER the sweep already
  // tripped must change nothing — the sweep is the only authority, and a client a
  // second behind is an ordinary client rather than a cheat. Stage a pending
  // board whose alarm is no longer live and confirm the win is dropped.
  // ⚠ Staged against the HARNESS'S OWN player. The resolve verb looks the pending
  // board up by the acting player's id, so a hardcoded one stages a row nothing
  // can ever match — which passes the "it no-ops" half for entirely the wrong
  // reason and then fails the consume half, pointing at nothing.
  _test.pendingDisarm.set(player.id, { shopZoneId: 'zone_ghost_shop', ts: Date.now() });
  r = await run('alarmresolve zone_ghost_shop 1');
  check('a win arriving after the sweep tripped it is dropped', r?.type === 'noop', JSON.stringify(r)?.slice(0, 80));
  check('the stale pending board is consumed either way', !_test.pendingDisarm.has(player.id));

  // ── The `hack` fall-through ────────────────────────────────────────────────
  // Five plugins own `hack`. Ours must return undefined with no panel here or it
  // swallows the verb from doors, hackrig, storefront and vendor-safe.
  r = await run('hack');
  check('hack self-gates cleanly when no panel present',
    r?.type === 'error' && !/panel|standby|alarm/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));

  const hackAction = specializedActions.find(a => a.verb === 'hack');
  check('hack is tag-gated on alarm_panel, so examine advertises it',
    hackAction?.requiredTag === 'alarm_panel');

  // ── The tiers ──────────────────────────────────────────────────────────────
  // The window and the difficulty move together and in the same direction: a
  // better box gives you LESS time and is HARDER. If these ever cross, a tier
  // stops being a rung on one ladder and becomes a trade-off nobody authored.
  const tiers = [1, 2, 3, 4, 5].map(t => _test.TIERS[t]);
  check('every tier is defined', tiers.every(Boolean));
  for (let i = 1; i < tiers.length; i++) {
    check(`tier ${i + 1} gives less time than tier ${i}`, tiers[i].secs < tiers[i - 1].secs,
      `${tiers[i - 1].secs} -> ${tiers[i].secs}`);
    check(`tier ${i + 1} is harder than tier ${i}`, tiers[i].diff > tiers[i - 1].diff,
      `${tiers[i - 1].diff} -> ${tiers[i].diff}`);
  }

  // An unauthored, junk or out-of-range tier must land on a real rung rather than
  // on `undefined`, which would arm an alarm with a NaN window — a clock that is
  // never in the past, so a box that never goes off and never says why.
  check('an unauthored panel falls back to a real tier', !!_test.tierOf({ flags: {} })?.secs);
  check('a junk tier falls back to a real tier', !!_test.tierOf({ flags: { alarm_tier: 'yes' } })?.secs);
  check('tier 99 clamps into range', _test.clampTier(99) === 5);
  check('tier 0 clamps into range', _test.clampTier(0) === 2, String(_test.clampTier(0)));
  check('every tier window is a finite positive number',
    [1, 2, 3, 4, 5].every(t => Number.isFinite(_test.TIERS[t].secs) && _test.TIERS[t].secs > 0));

  // Every window has to leave room for the board to be worth opening, or the
  // fastest model is a tier nobody can ever play against.
  check('even the fastest tier clears the disarm floor',
    _test.TIERS[5].secs > _test.DISARM_FLOOR_S, `${_test.TIERS[5].secs} vs ${_test.DISARM_FLOOR_S}`);

  // ── The chirp cadence ──────────────────────────────────────────────────────
  // The acceleration IS the readout — there is no number on screen in any display
  // mode — so it must strictly speed up as the window closes.
  check('the chirp accelerates toward the end',
    _test.chirpGap(0.9) > _test.chirpGap(0.4) && _test.chirpGap(0.4) > _test.chirpGap(0.1),
    `${_test.chirpGap(0.9)} / ${_test.chirpGap(0.4)} / ${_test.chirpGap(0.1)}`);

  // ── Which side of the door is the shop ─────────────────────────────────────
  // ⚠ The hacker stands on the STREET, so the premises are always the far side.
  // Getting this backwards arms an alarm in the road, where there is no panel, so
  // it silently arms nothing at all — and both door anchorings occur in content
  // (some rows are anchored on the interior, some on the street).
  const doorOut = { zone_id: 'zone_shop_inside', target_zone: 'zone_street' };
  const doorIn = { zone_id: 'zone_street', target_zone: 'zone_shop_inside' };
  check('a door anchored inside resolves the shop from the street',
    _test.farSideOf(doorOut, 'zone_street').includes('zone_shop_inside'));
  check('a door anchored on the street resolves the shop from the street',
    _test.farSideOf(doorIn, 'zone_street').includes('zone_shop_inside'));
  check('the street is never the premises',
    !_test.farSideOf(doorOut, 'zone_street').includes('zone_street')
    && !_test.farSideOf(doorIn, 'zone_street').includes('zone_street'));

  // ── The panel predicate ────────────────────────────────────────────────────
  check('a panel is recognised', _test.isPanel({ flags: { alarm_panel: true } }) === true);
  check('ordinary furniture is not a panel', _test.isPanel({ flags: {} }) === false);
  check('a missing piece is not a panel', _test.isPanel(null) === false);

  // ── The examine tell ───────────────────────────────────────────────────────
  // ⚠ undefined, never null — fireHook keeps the LAST non-undefined result, so a
  // null here blanks out another plugin's examine line.
  check("a non-panel piece gets no tell, and doesn't blank another plugin's line",
    (await hooks['furniture.describe']({ flags: {}, zone_id: 'zone_anywhere' }, null)) === undefined);
  const quiet = await hooks['furniture.describe']({ flags: { alarm_panel: true, alarm_tier: 3 }, zone_id: 'zone_quiet_shop' }, null);
  check('a quiet panel tells you it is quiet', typeof quiet === 'string' && /green/i.test(quiet), String(quiet).slice(0, 80));

  // The tell has to read the same state the mechanic does, or the fascia can
  // promise a dead panel that is actually counting.
  _test.liveAlarms.set('zone_live_shop', {
    shopZoneId: 'zone_live_shop', streetZoneId: 'zone_street',
    playerId: 'p', handle: 'p', tripAt: Date.now() + 30_000,
    tier: _test.TIERS[3], panelId: 'f', lastChirp: 0, vendorSeen: false,
  });
  const live = await hooks['furniture.describe']({ flags: { alarm_panel: true, alarm_tier: 3 }, zone_id: 'zone_live_shop' }, null);
  check('a counting panel says so on the fascia', typeof live === 'string' && /HACK ALARM/i.test(live), String(live).slice(0, 80));
  check('secsLeft reports the window, not the whole tier',
    _test.secsLeft(_test.liveAlarms.get('zone_live_shop')) <= 30);
  _test.liveAlarms.delete('zone_live_shop');

  // ── The crime ──────────────────────────────────────────────────────────────
  // Four stars was the whole ask, and the registry is where it lives — a plugin
  // asserting its own number would be asserting a copy of it.
  const { getCrimeStars, getCrimeWitness, isCrimeEnabled } = await import('../../server/engine/crimes.js');
  check('breaking and entering is a real crime key', isCrimeEnabled('breaking_and_entering'));
  check('breaking and entering is four stars', getCrimeStars('breaking_and_entering') === 4,
    String(getCrimeStars('breaking_and_entering')));
  // ⚠ 'always'. The alarm IS the witness — it made the call itself — so a dark
  // street and a jammed camera must buy nothing. Any other value makes the whole
  // feature a coin flip on a witness roll.
  check('the alarm is its own witness', getCrimeWitness('breaking_and_entering') === 'always',
    String(getCrimeWitness('breaking_and_entering')));
  // At one star or more, surveillance sirens and dispatches on its own, which is
  // why this plugin sends no police of its own.
  check('four stars is enough to dispatch police', getCrimeStars('breaking_and_entering') >= 1);

  // ── The authored panels ────────────────────────────────────────────────────
  //
  // ⚠ READ THE FILES, NEVER THE LIVE WORLD. `content/` is the source of truth for
  // authored content and the CI order is lint → import → regress, so the world
  // only holds these once somebody has imported. Asking `world.furniture` makes
  // the check answer a question about the reader's local database rather than
  // about the content — it reads 0 on any dev box whose DB is a day old, which is
  // a red that points at nothing, and it would go GREEN on a stale DB that still
  // held a panel somebody had since deleted.
  const fs = await import('node:fs');
  const dir = 'content/furniture';
  const panels = fs.readdirSync(dir)
    .map(f => { try { return JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); } catch { return null; } })
    .filter(f => _test.isPanel(f));
  check('the world has alarm panels authored in it', panels.length > 0, `found ${panels.length}`);

  // A panel in a zone that does not exist is a feature that silently never arms.
  const zoneExists = (id) => fs.existsSync(`content/zones/${id}.json`);
  check('every authored panel is in a zone that exists',
    panels.every(p => zoneExists(p.zone_id)),
    panels.filter(p => !zoneExists(p.zone_id)).map(p => p.id).join(',') || 'all present');

  // Clicking it in the room description is half the interface, and it is one
  // authored flag — so a panel without it can only be reached by typing.
  check('every authored panel is clickable',
    panels.every(p => p.flags?.click_cmd === 'hack alarm'),
    panels.filter(p => p.flags?.click_cmd !== 'hack alarm').map(p => p.id).join(',') || 'all clickable');

  // ⚠ And `hack alarm` resolves through SIFT against the piece's NAME, so a panel
  // called "the alarm box" needs the word in its aliases or the verb misses it.
  check('every authored panel answers to the word "alarm"',
    panels.every(p => String(p.flags?.aliases || '').includes('alarm')),
    panels.filter(p => !String(p.flags?.aliases || '').includes('alarm')).map(p => p.id).join(',') || 'all aliased');

  // Every tier authored has to be one the plugin knows, or the panel quietly
  // arms at the default and the author's choice does nothing.
  check('every authored tier is a real rung',
    panels.every(p => !!_test.TIERS[p.flags?.alarm_tier]),
    panels.filter(p => !_test.TIERS[p.flags?.alarm_tier]).map(p => `${p.id}=${p.flags?.alarm_tier}`).join(',') || 'all real');

  // ── The ring ───────────────────────────────────────────────────────────────
  // ⚠ The red screen has no timeout behind it, so an alarm that rings for ever is
  // a player looking at a red room for the rest of the session.
  check('the ring is finite', Number.isFinite(_test.RING_MS) && _test.RING_MS > 0, String(_test.RING_MS));
  check('silence() is reachable as the one way the red goes away', typeof _test.silence === 'function');
}
