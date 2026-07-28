// MIS plugin regression suite — run by tests/regress.js (never loaded in production).
// The harness's fake player starts with mis_enabled=0, so the first half verifies
// the consent gate and the multi-word input-matcher routing; the second half opts
// in (server setting + player flag, both restored afterwards) and drives the verbs
// that actually run, which nothing used to cover.
import { ejaculateDescription } from '../../server/engine/appearance.js';
import { THREESOME_JOIN_MSGS, THREESOME_CLIMAX_MSGS, hasMisEvent, stopMisEvent } from './mis-system.js';
import { isAttractedTo, isMisServerEnabled, setServerMisEnabled } from '../../server/engine/mis.js';
import { getRegisteredSpecializedActions } from '../../server/engine/specializedActions.js';
import { refractoryFactor, refractoryMs, markClimax, exert, volumeOf, burnOf,
  overflowsToZone, soakSlotsFor, AMPOULE_FLAG, fitOf, sizeOf } from './mis-body.js';
import { hygieneOf, creatureFilthSmells, WASH_FLAG } from '../../server/engine/hygiene.js';
import { hasConsent, canAsk, markAsked, refusal, _seedGrant, _dropGrant,
  isOpenAll, revoke, revokeAll, _resetConsents, _seedOpenAll } from './consent.js';
import { setLivePlayer, addPlayerToZone, removePlayerFromZone, getLivePlayer } from '../../server/engine/world.js';

export default async function regress({ run, check, getPlayer }) {
  // Threesome pools are well-formed: join lines name the third party, both pools
  // non-empty strings. (The {name}/{target} tokens are optional per line; {third}
  // must appear on every join line so the joiner is always named.)
  check('threesome: join pool non-empty and always names the third',
    Array.isArray(THREESOME_JOIN_MSGS) && THREESOME_JOIN_MSGS.length > 0
    && THREESOME_JOIN_MSGS.every(l => typeof l === 'string' && l.includes('{third}')),
    `${THREESOME_JOIN_MSGS?.length}`);
  check('threesome: climax pool non-empty and names the third',
    Array.isArray(THREESOME_CLIMAX_MSGS) && THREESOME_CLIMAX_MSGS.length > 0
    && THREESOME_CLIMAX_MSGS.every(l => typeof l === 'string' && l.includes('{third}')),
    `${THREESOME_CLIMAX_MSGS?.length}`);

  // Fluid on the penis is a body site; clothing that fills the `legs` slot must hide
  // it. Covered legs → nothing shown; bare legs → shown. (Regression: "penis" never
  // matched the "legs" slot key, so it leaked through fully clothed legs.)
  {
    const p = { handle: 'Test', appearance_data: { ejaculate_state: { locations: ['penis'] } } };
    check('ejaculate on penis hidden when legs are clothed',
      ejaculateDescription(p, true, new Set(['legs'])) === null,
      ejaculateDescription(p, true, new Set(['legs'])));
    check('ejaculate on penis shown when legs are bare',
      /penis/.test(ejaculateDescription(p, true, new Set(['torso'])) || ''),
      ejaculateDescription(p, true, new Set(['torso'])));
  }

  let r = await run('touch self');
  check('verb gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  r = await run('jerk off on somebody');
  check('multi-word matcher routes + gates', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  r = await run('mis');
  check('mis toggle verb reachable', r != null && !/Unknown command/.test(r?.message || ''), r?.message);

  r = await run('finger somebody');
  check('finger verb gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  r = await run("cum in somebody's mouth");
  check('cum-in gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  // strip is a MIS verb: hidden from a player who hasn't opted in.
  r = await run('strip somebody');
  check('strip gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  // The consent verbs are MIS verbs and hide like the rest — a player who never
  // opted in must not learn the surface exists by going looking for protection
  // from it.
  r = await run('consent');
  check('consent gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);
  r = await run('revoke somebody');
  check('revoke gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  // ── Consent, as pure logic ────────────────────────────────────────────────
  // The direction of the grant is the whole model, so it gets asserted directly
  // rather than only through the verbs: A consenting to B lets B act on A, and
  // grants NOTHING in the other direction.
  {
    _seedGrant('c_alice', 'c_bob');
    check('consent: grant is one-way (grantee may act on granter)', hasConsent('c_bob', 'c_alice'));
    check('consent: grant is one-way (granter may NOT act on grantee)', !hasConsent('c_alice', 'c_bob'));
    check('consent: strangers have nothing', !hasConsent('c_bob', 'c_carol'));
    check('consent: self never needs a grant', hasConsent('c_bob', 'c_bob'));
    _dropGrant('c_alice', 'c_bob');
    check('consent: revoked grant stops authorising', !hasConsent('c_bob', 'c_alice'));

    // The ask is rate-limited so it can't become a way to needle someone.
    check('consent ask: first ask allowed', canAsk('c_bob', 'c_alice'));
    markAsked('c_bob', 'c_alice');
    check('consent ask: second ask inside the cooldown refused', !canAsk('c_bob', 'c_alice'));
    _seedGrant('c_dave', 'c_bob');
    check('consent ask: pointless once you already hold the grant', !canAsk('c_bob', 'c_dave'));
    _dropGrant('c_dave', 'c_bob');
  }

  // ── The open door (`consent all`) ──────────────────────────────────────────
  // The widest thing a player can say, so the assertions are about what it must
  // NOT do: it must not act on anyone else's behalf, and it must never outrank a
  // specific refusal. `revoke` shutting the door is load-bearing rather than
  // cosmetic — the per-pair block is session-only RAM, so an open door left open
  // would silently re-admit a revoked player after a restart.
  {
    _resetConsents();
    check('open door: closed by default', !isOpenAll('c_erin'));
    check('open door: a stranger has nothing before it opens', !hasConsent('c_frank', 'c_erin'));

    _seedOpenAll('c_erin');
    check('open door: isOpenAll reports it', isOpenAll('c_erin'));
    check('open door: any actor is authorised', hasConsent('c_frank', 'c_erin'));
    check('open door: and another', hasConsent('c_gil', 'c_erin'));
    // The door is one player's own state and grants nothing outward.
    check('open door: does NOT let the opener act on others', !hasConsent('c_erin', 'c_frank'));
    check('open door: does not leak to anyone else', !hasConsent('c_erin', 'c_gil'));

    // A named refusal beats the general yes, and takes the door with it.
    // Named `rv` rather than reusing the outer `r` — shadowing it in this block
    // would put the outer binding in the TDZ for anything above this line.
    const rv = await revoke('c_erin', 'c_frank');
    check('open door: revoke reports it shut the door', rv.wasOpen === true, JSON.stringify(rv));
    check('open door: the revoked player is refused', !hasConsent('c_frank', 'c_erin'));
    check('open door: and the door is shut for everyone', !hasConsent('c_gil', 'c_erin'));
    check('open door: isOpenAll agrees', !isOpenAll('c_erin'));

    // Named grants are a separate ledger and survive the door closing.
    _resetConsents();
    _seedGrant('c_erin', 'c_gil');
    _seedOpenAll('c_erin');
    const ra = await revokeAll('c_erin');
    check('open door: revoke all reports the door', ra.wasOpen === true, JSON.stringify(ra));
    check('open door: revoke all took the named grant too', ra.n === 1, String(ra.n));
    check('open door: nothing authorised afterwards', !hasConsent('c_gil', 'c_erin'));
    _resetConsents();
  }

  // ── Attraction ─────────────────────────────────────────────────────────────
  // 'None' is a real answer and an unset sexuality must not silently read as
  // 'Male' — nothing should decide a character is attracted to men because
  // nobody asked them.
  {
    const male = { biological_sex: 'male' }, female = { biological_sex: 'female' };
    check('attraction: Male → men only',
      isAttractedTo({ sexuality: 'Male' }, male) && !isAttractedTo({ sexuality: 'Male' }, female));
    check('attraction: Female → women only',
      isAttractedTo({ sexuality: 'Female' }, female) && !isAttractedTo({ sexuality: 'Female' }, male));
    check('attraction: Male and Female → both',
      isAttractedTo({ sexuality: 'Male and Female' }, male) && isAttractedTo({ sexuality: 'Male and Female' }, female));
    check('attraction: None opts out of both',
      !isAttractedTo({ sexuality: 'None' }, male) && !isAttractedTo({ sexuality: 'None' }, female));
    check('attraction: unset does not default to men',
      !isAttractedTo({}, male) && !isAttractedTo({}, female));
  }

  // `wash` is object-gated (a sink) but stays an ordinary command, so it needs the
  // declaration-only registry row or no sink ever advertises it. Layer 1b enforces
  // this against the manifest; this pins the tag itself.
  {
    const wash = getRegisteredSpecializedActions().wash || [];
    check('wash is discoverable on water_source furniture',
      wash.some(e => e.requiredTag === 'water_source' && e.pluginName === 'mis'),
      JSON.stringify(wash));
  }

  // ── Body mechanics ─────────────────────────────────────────────────────────
  // Pure functions, no world state — the numbers are the contract.
  {
    const male = { biological_sex: 'male', stat_endurance: 0 };
    check('refractory: a fresh body is at full rate', refractoryFactor(male) === 1);
    markClimax(male);
    check('refractory: the instant after climax is heavily damped',
      refractoryFactor(male) < 0.2, String(refractoryFactor(male)));
    check('refractory: endurance shortens it',
      refractoryMs({ biological_sex: 'male', stat_endurance: 8 })
        < refractoryMs({ biological_sex: 'male', stat_endurance: 0 }));

    // Exertion costs a body something, and running a body to zero ends the act.
    const p = { stamina: 100, stamina_max: 100, thirst: 100, stat_endurance: 0 };
    const first = exert(p);
    check('exertion: a beat costs stamina', p.stamina < 100 && !first.collapsed, `stamina=${p.stamina}`);
    check('exertion: a beat costs hydration', p.thirst < 100, `thirst=${p.thirst}`);
    check('exertion: sweat accrues on the engine meter', (p._sweat || 0) > 0, `sweat=${p._sweat}`);
    p.stamina = 1;
    check('exertion: running out ends the act', exert(p).collapsed === true);
  }

  // Hygiene: the substrate has to answer for filth it did not invent.
  {
    const clean = { _flags: new Map([[WASH_FLAG, String(Date.now())]]) };
    check('hygiene: a washed body reads clean', hygieneOf(clean).score >= 85, JSON.stringify(hygieneOf(clean)));

    const filthy = {
      _flags: new Map([[WASH_FLAG, String(Date.now())]]),
      clothing_contamination: { legs: 'feces' },
      covered_in_blood: 1,
    };
    const h = hygieneOf(filthy);
    check('hygiene: shit and blood both register', h.sources.length >= 2, JSON.stringify(h.sources.map(s => s.type)));
    check('hygiene: filth tanks the score', h.score < 40, String(h.score));

    // MIS fluid is a contaminant like any other, but withheld from the unopted —
    // the smell would otherwise be the tell that the whole surface exists.
    const misP = {
      _flags: new Map([[WASH_FLAG, String(Date.now())]]),
      appearance_data: { ejaculate_state: { locations: ['torso'], at: Date.now() } },
    };
    check('hygiene: fresh fluid is a source', hygieneOf(misP).sources.some(s => s.type === 'ejaculate'));
    check('hygiene: fluid smell withheld from a viewer without MIS',
      creatureFilthSmells([misP], { mis_enabled: 0 }, 0).every(s => s.source !== 'sex'));

    // Dried is not smelt — the appearance note outlives the smell by design.
    const dried = {
      _flags: new Map([[WASH_FLAG, String(Date.now())]]),
      appearance_data: { ejaculate_state: { locations: ['torso'], at: Date.now() - 60 * 60 * 1000 } },
    };
    check('hygiene: dried fluid no longer smells',
      !hygieneOf(dried).sources.some(s => s.type === 'ejaculate'));
  }

  // Volume: the scalar that turns ejaculate from a flag into a quantity.
  {
    const fresh = { biological_sex: 'male', thirst: 100, stat_endurance: 5, horniness: 100 };
    check('a rested body produces a full measure', volumeOf(fresh) > 0.7, String(volumeOf(fresh)));
    const spent = { ...fresh, _lastClimaxAt: Date.now() };
    check('finishing again immediately produces almost nothing', volumeOf(spent) < 0.15, String(volumeOf(spent)));
    const dry = { ...fresh, thirst: 5 };
    check('dehydration cuts it down', volumeOf(dry) < volumeOf(fresh), String(volumeOf(dry)));
    // Measured against a PARTIALLY recovered body — a fully rested one is already
    // clamped at 1, so a multiplier there would have nothing to show.
    const partial = { ...fresh, _lastClimaxAt: Date.now() - 60 * 60 * 1000 };
    const dosed = { ...partial, activeDrugs: [{ flags: { volume_boost: 2.4 } }] };
    check('the ampoule multiplies it', volumeOf(dosed) > volumeOf(partial),
      `${volumeOf(partial)} → ${volumeOf(dosed)}`);

    // The hidden cost: past the free doses, the ceiling drops and never recovers.
    const burned = { ...fresh, _flags: new Map([[AMPOULE_FLAG, '15']]) };
    check('heavy ampoule use quietly lowers the ceiling', volumeOf(burned) < volumeOf(fresh), String(volumeOf(burned)));
    check('burn is capped, never total', burnOf({ _flags: new Map([[AMPOULE_FLAG, '9999']]) }) <= 0.75);
    check('the first few doses are genuinely free', burnOf({ _flags: new Map([[AMPOULE_FLAG, '4']]) }) === 0);

    check('a big finish reaches the floor', overflowsToZone(0.9) === true);
    check('a small one does not', overflowsToZone(0.2) === false);
    check('volume decides how many slots soak', soakSlotsFor(0.9).length > soakSlotsFor(0.2).length);
  }

  // Fit: the model has to stay sane at both ends of the authored size range
  // (0.25in micropenis .. 15in), and the bands have to be ordered.
  {
    const tightP  = { appearance_data: { labia_style: 'tight' } };
    const looseP  = { appearance_data: { labia_style: 'loose' } };
    const micro   = { appearance_data: { penis_length_cm: 0.6 } };
    const huge    = { appearance_data: { penis_length_cm: 38.1 } };
    const average = { appearance_data: { penis_length_cm: 14 } };

    check('a micropenis is cavernous even in the tightest fit',
      fitOf(micro, tightP, 'pussy').band === 'cavernous', fitOf(micro, tightP, 'pussy').band);
    check('the maximum is impossible even at the loosest',
      fitOf(huge, looseP, 'pussy').band === 'impossible', fitOf(huge, looseP, 'pussy').band);
    check('impossible is refused for a pussy', fitOf(huge, looseP, 'pussy').canProceed === false);
    check('…but a mouth gags rather than refusing', fitOf(huge, looseP, 'mouth').canProceed === true);
    check('a mouth never stretches', fitOf(huge, looseP, 'mouth').stretches === false);
    // An ass (base 9cm) is tighter than an ORDINARY pussy (14cm). Against the
    // tightest labia the two baselines are deliberately equal, so compare with a
    // default receiver or the assertion is vacuous.
    const plainP = { appearance_data: {} };
    check('an ass is tighter than an ordinary pussy for the same size',
      fitOf(average, plainP, 'ass').ratio > fitOf(average, plainP, 'pussy').ratio,
      `${fitOf(average, plainP, 'ass').ratio} vs ${fitOf(average, plainP, 'pussy').ratio}`);
    check('a loose pussy needs more to fill than a tight one',
      fitOf(average, looseP, 'pussy').ratio < fitOf(average, tightP, 'pussy').ratio);
    check('snug is the arousal sweet spot for the receiver',
      fitOf({ appearance_data: { penis_length_cm: 9.5 } }, tightP, 'pussy').receiverMult > 1);
    check('size is clamped to the authored range',
      sizeOf({ appearance_data: { penis_length_cm: 900 } }) === 38.1);
  }

  // ── Opted in ───────────────────────────────────────────────────────────────
  // Everything above proves the verbs are hidden. Nothing proved they work.
  const p = getPlayer();
  const savedServer = isMisServerEnabled();
  const savedPlayer = p.mis_enabled;
  const savedHorny = p.horniness || 0;
  try {
    await setServerMisEnabled(true);
    p.mis_enabled = 1;
    p.horniness = 0;

    r = await run('touch self');
    check('opted in: touch self is no longer an unknown command',
      r != null && !/Unknown command/.test(r?.message || ''), r?.message);
    check('opted in: a MIS act builds horniness', (p.horniness || 0) > 0, `horniness=${p.horniness}`);

    // Event lifecycle: an ongoing act registers, and the unified STOP halts it.
    // (Masturbation self-gates on leg clothing — if the harness player happens to
    // be dressed for it, that refusal is the correct answer and there's no event
    // to stop.)
    // ── Consent gate, end to end ───────────────────────────────────────────
    // A second opted-in player in the room, who has granted nothing. Every
    // player-targeting path must refuse. THREE of these verbs resolve with the
    // raw resolver instead of resolveTargetMis and carry their own copy of the
    // check — slap, strip and examine — so each is asserted individually. If a
    // future refactor drops one of those copies, this is what catches it.
    const TID = 'p_regress_consent';
    setLivePlayer(TID, { id: TID, handle: 'Consentless', current_zone: p.current_zone,
      posture: 'standing', mis_enabled: 1, biological_sex: 'female', sexuality: 'None',
      horniness: 0, sanity: 100, sanity_max: 100 });
    addPlayerToZone(TID, p.current_zone);
    try {
      const REFUSED = refusal('Consentless');
      for (const [label, cmd] of [
        ['resolveTargetMis path (touch)', 'touch Consentless'],
        ['raw-resolver bypass: slap',     "slap Consentless's ass"],
        ['raw-resolver bypass: strip',    'strip Consentless'],
        ['raw-resolver bypass: examine',  "examine Consentless's tits"],
      ]) {
        const rr = await run(cmd);
        check(`consent gate refuses — ${label}`,
          rr?.type === 'error' && rr.message === REFUSED, `${rr?.type}: ${rr?.message}`);
      }

      // The refusal must read the same whether they never opted in or simply
      // haven't consented — otherwise the message is a probe for who has MIS on.
      const withMis = await run('touch Consentless');
      setLivePlayer(TID, { ...getLivePlayer(TID), mis_enabled: 0 });
      const withoutMis = await run('touch Consentless');
      check('consent gate leaks nothing: same refusal with MIS off as with no grant',
        withMis?.message === withoutMis?.message, `${withMis?.message} / ${withoutMis?.message}`);
      setLivePlayer(TID, { ...getLivePlayer(TID), mis_enabled: 1 });

      // With the grant in place the same verb goes through.
      _seedGrant(TID, p.id);
      const allowed = await run('touch Consentless');
      check('consent gate admits once the target has granted',
        allowed != null && allowed.message !== REFUSED, `${allowed?.type}: ${allowed?.message}`);
      _dropGrant(TID, p.id);
      const refusedAgain = await run('touch Consentless');
      check('consent gate refuses again after revoke',
        refusedAgain?.type === 'error' && refusedAgain.message === REFUSED, refusedAgain?.message);
    } finally {
      removePlayerFromZone(TID, p.current_zone);
      _dropGrant(TID, p.id);
    }

    const m = await run('masturbate');
    if (/clothing in the way/i.test(m?.message || '')) {
      check('opted in: masturbate refuses through heavy clothing', m?.type === 'error', m?.message);
    } else {
      check('opted in: masturbate starts an ongoing event', hasMisEvent(p.id), m?.message);
      const s = await run('stop');
      check('opted in: stop halts the ongoing event', !hasMisEvent(p.id),
        `${s?.message} (event still running)`);
    }
  } finally {
    stopMisEvent(p.id);            // never leave an 8s interval running into the next suite
    p.mis_enabled = savedPlayer;
    p.horniness = savedHorny;
    await setServerMisEnabled(savedServer);
  }
}
