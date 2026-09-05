// Vendor-safe plugin regression suite — run by tests/regress.js (never loaded in
// production). Covers the VAULT-CRACK resolve seam: the anti-spoof guard on
// `safecrackresolve` (you can't resolve a breach you never armed) and clean
// self-gating of `hack` when there's no safe here (it falls through to the
// doors plugin / builtin). The full arm→launch→win→payout path needs a real
// safe + linked vendor NPC with credits and is covered by manual QA.
export default async function regress({ run, check }) {
  // safecrackresolve with no args no-ops silently.
  let r = await run('safecrackresolve');
  check('safecrackresolve with no args no-ops', r?.type === 'noop', JSON.stringify(r)?.slice(0, 80));

  // A resolve for a safe the player never armed must no-op (anti-spoof) — it
  // must NOT pay out, so reaching the noop (not an output) is the guarantee.
  r = await run('safecrackresolve ghost_safe_xyz 1');
  check('unarmed safecrackresolve no-ops (no payout)', r?.type === 'noop', JSON.stringify(r)?.slice(0, 80));

  // With no vendor safe in the test zone, `hack` self-gates past us all the way
  // through the doors handler / builtin to a graceful message — proving our
  // fall-through (return undefined) is intact.
  r = await run('hack');
  check('hack self-gates cleanly when no safe present', r?.type === 'error' && /nothing worth hacking/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));

  // ── The deck gate ──────────────────────────────────────────────────────────
  // A vendor safe needs a `hack_device` in hand, same as the ATM, the hololock and
  // the practice rig. The gate must sit BELOW the no-safe fall-through, or `hack`
  // in a room with no safe would answer "you need a device" instead of letting the
  // other handlers have it — which is exactly what the check above proves still
  // works, so these two assertions are a pair. The fake player carries nothing, so
  // reaching the fall-through message (not a device error) is the proof of ordering.
  check('the device gate never swallows a hack aimed elsewhere',
    !/hacking device/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));
  const { hasHackDeck } = await import('../../server/engine/hack-gear.js');
  check('an empty-handed player has no deck', (await hasHackDeck('00000000-0000-0000-0000-000000000000')) === false);

  // ── The night alarm ────────────────────────────────────────────────────────
  // The owner standing there was the only risk in cracking a safe, so the whole
  // game was "come back at 3am". The tamper circuit arms exactly when that was
  // free: dark out, owner absent. Owner present is still the LOUD path (forced
  // witness at arm time) and must never double-fire the siren as well.
  const { _test, hooks } = await import('./index.js');
  const { getEnvironmentState } = await import('../../server/engine/environment.js');
  const phase = getEnvironmentState().phase;
  const dark = _test.ALARM_PHASES.has(phase);
  check('alarm never arms while the owner is standing there',
    _test.alarmArmed('zone_anywhere', true) === false, `phase=${phase}`);
  check("alarm arms iff it's dark and the owner is away",
    _test.alarmArmed('zone_anywhere', false) === dark, `phase=${phase} armed=${_test.alarmArmed('zone_anywhere', false)}`);

  // The examine tell reads the SAME condition, so it can never promise a quiet
  // safe that then screams (or warn about one that doesn't).
  const tell = await hooks['furniture.describe']({ flags: { vendor_safe: true, vendor_npc_id: 'npc_nobody' }, zone_id: 'zone_anywhere' }, null);
  check('the armed-safe tell agrees with the mechanic', (!!tell) === dark, `phase=${phase} tell=${!!tell}`);
  // undefined, not null — fireHook takes the LAST non-undefined result, so a null
  // here would blank out another plugin's examine line (it briefly did).
  check('a non-safe piece gets no tell, and doesn\'t blank another plugin\'s line',
    (await hooks['furniture.describe']({ flags: {}, zone_id: 'zone_anywhere' }, null)) === undefined);
}
