// Sneak / knockout regression suite. Exercises the two engine substrates and the
// verb gates; the reaction branches (NPC bolts, enemy turns) need live NPCs and
// are covered by play.
export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const { setPosture, getPosture } = await import('../../server/engine/posture.js');
  const { isSneaking, noticeRoll, hasNoticed, clearNotices, concealment, SNEAKING } =
    await import('../../server/engine/stealth.js');
  const { knockOut, wakeUp, isOut, KO_MS } = await import('../../server/engine/unconscious.js');
  const { _test } = await import('./index.js');

  // ── The verbs are gated, not free ───────────────────────────────────────────
  setPosture(p, 'standing');
  let r = await run('knockout nobodyhere');
  check('knocking out requires sneaking first', /sneak/i.test(r?.message || ''), r?.message);

  r = await run('sneak');
  check('sneak drops you into the posture', isSneaking(p) && getPosture(p) === SNEAKING, getPosture(p));
  r = await run('sneak');
  check('...and toggles back off', !isSneaking(p));

  setPosture(p, SNEAKING);
  r = await run('knockout nobodyhere');
  check("a target that isn't here is refused", /don't see/i.test(r?.message || ''), r?.message);

  // ── Weapons: blunt or nothing ───────────────────────────────────────────────
  // Swinging a blade at a skull is not a knockout attempt however quietly you
  // crept up on them — it is just a killing.
  check('bare hands are fine', _test.weaponOk({}).ok === true);
  check('a pipe is fine', _test.weaponOk({ equipped: { weapon: { name: 'lead pipe' } } }).ok === true);
  check('a bat is fine', _test.weaponOk({ equipped: { weapon: { name: 'scuffed baseball bat' } } }).ok === true);
  check('a knife is NOT', _test.weaponOk({ equipped: { weapon: { name: 'combat knife' } } }).ok === false);
  check('a pistol is NOT', _test.weaponOk({ equipped: { weapon: { name: 'scrap pistol' } } }).ok === false);

  // ── Being noticed is per-observer and sticky ────────────────────────────────
  const sneaker = { id: 'regress-sneaker', stat_senses: 5 };
  const blind = { id: 'regress-blind', stat_senses: 0, statuses: [] };
  clearNotices(sneaker.id);
  check('nobody has noticed before a roll', hasNoticed(sneaker.id, blind.id) === false);
  // Force a notice and confirm it sticks — walking away and back must not re-roll
  // a bad result into a good one.
  for (let i = 0; i < 60 && !hasNoticed(sneaker.id, blind.id); i++) noticeRoll(blind, sneaker, p.current_zone);
  if (hasNoticed(sneaker.id, blind.id)) {
    check('once somebody has clocked you, they stay clocked',
      noticeRoll(blind, sneaker, p.current_zone) === true);
  }
  clearNotices(sneaker.id);
  check('standing up clears the record', hasNoticed(sneaker.id, blind.id) === false);

  // An observer who is out cold or asleep notices nothing — this is what makes a
  // knocked-out guard genuinely out of the picture, and why the two systems have
  // to know about each other.
  const outCold = { id: 'regress-outcold', _koUntil: Date.now() + 60000, statuses: [] };
  let sawWhileOut = false;
  for (let i = 0; i < 60; i++) if (noticeRoll(outCold, sneaker, p.current_zone)) sawWhileOut = true;
  check('somebody out cold never notices you', sawWhileOut === false);
  const asleep = { id: 'regress-asleep', sleeping: { inDream: false }, statuses: [] };
  let sawWhileAsleep = false;
  for (let i = 0; i < 60; i++) if (noticeRoll(asleep, sneaker, p.current_zone)) sawWhileAsleep = true;
  check('...and neither does a sleeper', sawWhileAsleep === false);

  // Darkness is the lever players actually have — the lighting and power systems
  // feed straight into it.
  check('concealment is a number the room contributes to',
    Number.isFinite(concealment(sneaker, p.current_zone)));

  // ── Out cold ────────────────────────────────────────────────────────────────
  const victim = { id: 'regress-victim', hp: 12, hp_max: 20, statuses: [], _ai: {} };
  check("a fresh target isn't out", isOut(victim) === false);
  knockOut(victim, { by: { handle: 'Somebody' } });
  check('knocking out puts them under', isOut(victim) === true);
  check('...lying down', victim.posture === 'lying');
  // NPC death is hp<=0, so an NPC knocked to zero would simply die. One is the
  // floor for anything out cold.
  check('...with hp pinned at 1 or above, never 0', victim.hp >= 1, victim.hp);
  check('...and the AI yielding its graph', victim._ai.dosedOut === true);
  check('...remembering who did it', victim._koBy === 'Somebody');

  check('coming round reports it happened', wakeUp(victim) === true);
  check('...and is idempotent', wakeUp(victim) === false);
  check('...standing them back up', victim.posture === 'standing');
  check('...handing the AI back its graph', victim._ai.dosedOut === false);
  // A knockout that costs nothing is a nap. The concussion is what makes it cost
  // something even when nobody robs or finishes you.
  check('...and leaving them concussed', (victim.statuses || []).some(s => s.name === 'concussed'));

  // The tell the room reads. Out cold must win over asleep — it is the most
  // urgent thing about them, and the only one somebody else did to them.
  const { bodyTell } = await import('../../server/engine/dreamscape.js');
  const both = { id: 'x', _koUntil: Date.now() + 10000, sleeping: { inDream: false }, current_zone: p.current_zone };
  check('a body out cold reads as out cold, not asleep',
    bodyTell(both, p.current_zone) === 'out cold');

  // ── The three things that make it more than a posture ───────────────────────
  // Before these, a sneaker rolled unnoticed and was still announced on arrival
  // and listed in the room. The notice record had no consumer.
  const { isHiddenFrom, armSneakWindow, tickStealth, SNEAK_WINDOW_MS } =
    await import('../../server/engine/stealth.js');

  const crouched = { id: 'regress-crouched', posture: SNEAKING, current_zone: p.current_zone };
  clearNotices(crouched.id);
  check('an unnoticed sneaker is hidden from a viewer', isHiddenFrom(crouched, 'regress-viewer') === true);
  check('...but never from themselves', isHiddenFrom(crouched, crouched.id) === false);
  for (let i = 0; i < 60 && !hasNoticed(crouched.id, blind.id); i++) noticeRoll(blind, crouched, p.current_zone);
  if (hasNoticed(crouched.id, blind.id)) {
    check('...and not from someone who has clocked them', isHiddenFrom(crouched, blind.id) === false);
  }
  crouched.posture = 'standing';
  check('standing up hides you from nobody', isHiddenFrom(crouched, 'regress-viewer') === false);

  // The clock. Staying unnoticed is a thing that keeps being true, not a state
  // you reach — the window expiring is what gives the room another look.
  const { on: onEvent } = await import('../../server/engine/events.js');
  crouched.posture = SNEAKING;
  armSneakWindow(crouched, p.current_zone);
  check('sneaking arms a window', crouched._sneakUntil > Date.now(), crouched._sneakUntil);
  check('...of at least the base length', crouched._sneakUntil - Date.now() >= SNEAK_WINDOW_MS - 50);
  let fired = 0;
  onEvent('stealth.window', ({ player: who }) => { if (who?.id === crouched.id) fired++; });
  tickStealth([crouched]);
  check("an unexpired window doesn't re-roll the room", fired === 0);
  crouched._sneakUntil = Date.now() - 1;
  tickStealth([crouched]);
  check('an expired one does', fired === 1);
  check('...and re-arms itself rather than firing every tick', crouched._sneakUntil > Date.now());
  crouched.posture = 'standing';
  crouched._sneakUntil = Date.now() - 1;
  tickStealth([crouched]);
  check('standing up stops the clock entirely', fired === 1 && !crouched._sneakUntil);

  // Sneaking must SURVIVE a step, or you can only ever sneak where you already
  // are. forceStand('moved') used to clear it on every move.
  setPosture(p, SNEAKING);
  const before = p.current_zone;
  await run('look');
  check('sneaking survives a look', isSneaking(p));
  p.current_zone = before;

  // ── Panic: the flag must never outlive its driver ───────────────────────────
  // `_ai.alarm` only SUSPENDS the AI graph and waits for whoever set it to drive
  // the NPC and clear it. Setting it by hand — which this plugin used to do —
  // froze that NPC permanently.
  const { panicNpc, calmNpc, isPanicking, tickPanic, PANIC_MS } =
    await import('../../server/engine/panic.js');

  const scared = { id: 'regress-scared', name: 'Bystander', hp: 10, zone_id: p.current_zone, _ai: {} };
  check('panicking takes the NPC over', panicNpc(scared, { reason: 'assault' }) === true);
  check('...suspending its graph', scared._ai.alarm === true);
  check('...standing it up', scared.posture === 'standing');
  check("...and it's idempotent, so a per-swing event costs nothing",
    panicNpc(scared, { reason: 'assault' }) === false);
  check('isPanicking reports it', isPanicking(scared) === true);
  check('calming hands the graph back', calmNpc(scared) === true && scared._ai.alarm === false);
  check('...and is safe on someone who was never scared', calmNpc(scared) === false);

  // Two drivers on one suspended graph means whichever finishes first hands it
  // back while the other is still steering.
  const driven = { id: 'regress-driven', name: 'Resident', hp: 10, zone_id: p.current_zone, _ai: { alarm: true } };
  check('an NPC another plugin is already driving is left alone', panicNpc(driven) === false);
  const dosed = { id: 'regress-dosed', name: 'Nodder', hp: 10, zone_id: p.current_zone, _ai: { dosedOut: true } };
  check('...as is one the drug plugin has', panicNpc(dosed) === false);

  // Somebody out cold or asleep witnessed nothing — the same rule the notice
  // roll uses, and what makes clearing a room one body at a time work.
  const koWitness = { id: 'regress-ko-witness', name: 'Sleeper', hp: 10, zone_id: p.current_zone, _koUntil: Date.now() + 60000, _ai: {} };
  check("an unconscious NPC doesn't panic", panicNpc(koWitness) === false);
  const deadWitness = { id: 'regress-dead-witness', name: 'Corpse', hp: 0, zone_id: p.current_zone, _ai: {} };
  check('...nor a dead one', panicNpc(deadWitness) === false);

  // The tick must RELEASE an NPC that has gone away, or the flag outlives the
  // driver by another route.
  check('the tick is a no-op with nobody panicking', tickPanic() === undefined);
  const vanishing = { id: 'regress-vanishing', name: 'Ghost', hp: 10, zone_id: p.current_zone, _ai: {} };
  panicNpc(vanishing);
  tickPanic();   // not in world.npcs — dropped rather than left holding the flag
  check('a panicking NPC the world no longer has is dropped', isPanicking(vanishing) === false);
  check('panic is bounded, not indefinite', PANIC_MS > 0 && PANIC_MS <= 120000, PANIC_MS);

  setPosture(p, 'standing');
}
