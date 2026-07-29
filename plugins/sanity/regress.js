// Sanity plugin regression suite — run by tests/regress.js (never loaded in
// production). Covers the band curve, the insane hysteresis flag driven by the
// minute tick, and the engine's insane substrate gate (scramble non-sleep
// commands, always allow sleep). Phantom conjuring itself is probabilistic and
// setTimeout-driven, covered by manual QA; the shared phantom seam is exercised
// by the trip plugin's suite.
import { bandFor, intensityFor, hooks } from './index.js';
import { getPhantoms } from '../../server/engine/phantoms.js';
import regressVoices from './regress-voices.js';

export default async function regress({ run, check, getPlayer }) {
  // The forgery suite: a hallucinated line must stay byte-identical to a real one, and the
  // two formats it copies live in files that know nothing about this one.
  regressVoices({ check });

  const p = getPlayer();
  const orig = p.sanity;

  // ── Band boundaries (raw sanity, honouring the insane flag) ────────────────
  p.insane = false;
  p.sanity = 80; check('sanity 80 → clear', bandFor(p) === 'clear');
  p.sanity = 49; check('sanity 49 → creep', bandFor(p) === 'creep');
  p.sanity = 25; check('sanity 25 → creep (boundary)', bandFor(p) === 'creep');
  p.sanity = 24; check('sanity 24 → halluc', bandFor(p) === 'halluc');
  p.sanity = 1;  check('sanity 1 → halluc', bandFor(p) === 'halluc');
  p.sanity = 0;  check('sanity 0 → insane', bandFor(p) === 'insane');

  // ── Intensity curve: 0 above 50, ramps to 1 at the bottom ──────────────────
  p.sanity = 60; check('intensity clear = 0', intensityFor(p) === 0);
  p.sanity = 25; check('intensity at 25 ≈ 0.5', Math.abs(intensityFor(p) - 0.5) < 0.001, intensityFor(p));
  p.sanity = 0;  p.insane = false; check('intensity at 0 = 1', intensityFor(p) === 1);

  // ── Insane hysteresis via the minute tick ──────────────────────────────────
  const tick = hooks['tick.minute'];
  const INSANE_RE = /nonsense|isn't there|makes no sense|melt|scream|refuses/i;
  p.insane = false;
  p.sanity = 0;  tick(); check('tick at 0 sets insane', p.insane === true);
  p.sanity = 5;  tick(); check('tick at 5 keeps insane (hysteresis)', p.insane === true);
  p.sanity = 10; tick(); check('tick at 10 lifts insane flag', p.insane === false);
  // 10 is still the hallucination band — climbing clear (≥50) is what tears down.
  p.sanity = 80; tick();
  check('full recovery drops our phantoms', !getPhantoms(p.id).some(ph => String(ph.id).startsWith('sane_')));

  // ── Engine insane substrate gate ───────────────────────────────────────────
  // While insane, ~55% of non-sleep commands collapse into nonsense; sleep/rest
  // always pass. Drive many looks to catch a scrambled one (P(all pass) ≈ 0).
  p.insane = true;
  let sawScramble = false;
  for (let i = 0; i < 40 && !sawScramble; i++) {
    const r = await run('look');
    if (r?.type === 'error' && INSANE_RE.test(r.message || '')) sawScramble = true;
  }
  check('insane scrambles some commands', sawScramble);

  // Sleep is never gated by the insane state (the only way back out): it may be
  // ineligible here ("can't sleep"), but must never return the nonsense refusal.
  let sleepEverScrambled = false;
  for (let i = 0; i < 20; i++) {
    const r = await run('sleep');
    if (r?.type === 'error' && INSANE_RE.test(r.message || '')) sleepEverScrambled = true;
  }
  check('insane never scrambles sleep', !sleepEverScrambled);

  // Cleanup — leave the fake player sane, not mid-nap, and BEHIND THEIR OWN EYES.
  //
  // That last one is not hypothetical. The ticks above run at sanity 0 and 5, both
  // under DISSOCIATE_AT (7), so each one rolls DISSOCIATE_CHANCE (0.06) to start a
  // dissociative episode on the shared fake player — about a 1-in-8 chance per run
  // that this suite ends with `_dissociating` set. That flag makes the engine's
  // dream gate (server/engine/commands/index.js) answer every verb outside
  // DREAM_VERBS with a DREAM_REFUSAL, for the rest of the process — so a LATER,
  // innocent suite went red at random instead (it was yacht's `sail`/`dock`
  // expecting a clearance error and getting "your real arm twitches under a
  // blanket"). endDissociation is the single funnel every wake path uses and is
  // idempotent, so this is a no-op on the runs where no episode fired — and on the
  // runs where one did, it also dissolves the dreamscape rooms it built.
  const { endDissociation } = await import('../../server/engine/dreamscape.js');
  endDissociation(p, { broadcast: null, reason: 'silent' });
  p.insane = false;
  p.sleeping = null;
  p.sanity = orig;
  tick();
}
