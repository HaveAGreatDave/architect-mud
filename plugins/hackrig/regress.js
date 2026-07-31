// hackrig plugin regression suite — run by tests/regress.js (never loaded in
// production). Covers the rig selection rule as a pure function (the zone→
// furniture index isn't injectable without a DB, which is why pickRig is split
// out of findRig), the deck-grading helpers in the shared hack-gear substrate
// that this plugin and every live breach path now depend on, and the gated
// no-mutation path — the fake player carries no deck, so nothing is ever
// awarded or damaged.
import { _test } from './index.js';
import { deckPenalty, marginOf, DEFAULT_FAIL_DAMAGE } from '../../server/engine/hack-gear.js';

export default async function regress({ run, check }) {
  // ── Deck grading (server/engine/hack-gear.js) ──────────────────────────────
  // The contract every deck already in a player's bag depends on: no authored
  // tags means today's behaviour, unchanged.
  check('an untagged deck carries no difficulty penalty',
    deckPenalty({ tags: { hack_device: true } }) === 0);
  check('a junk deck adds its authored penalty',
    deckPenalty({ tags: { hack_device: true, hack_penalty: 2 } }) === 2);
  check('a nonsense penalty is clamped away rather than granted as a bonus',
    deckPenalty({ tags: { hack_penalty: -5 } }) === 0 && deckPenalty({ tags: { hack_penalty: 'x' } }) === 0);
  check('a missing deck grades as no penalty', deckPenalty(null) === 0);
  check('the historical five-failures default is intact', DEFAULT_FAIL_DAMAGE === 0.2);

  // ── Rig selection ──────────────────────────────────────────────────────────
  const rig   = { id: 'furn_rig',   name: 'practice lock rig', flags: { hack_rig: true } };
  const rig2  = { id: 'furn_rig2',  name: 'battered trainer',  flags: { hack_rig: true } };
  const chair = { id: 'furn_chair', name: 'plastic chair',     flags: {} };

  check('a rig in the room is found', _test.pickRig([chair, rig], null)?.id === 'furn_rig');
  check('a name hint picks the named rig', _test.pickRig([rig, rig2], 'battered')?.id === 'furn_rig2');
  check('a name hint that matches nothing finds no rig', _test.pickRig([rig], 'zzz') === null);
  check('non-rig furniture is never picked up', _test.pickRig([chair], null) === null);
  check('a room with no furniture yields null so other hack targets keep the verb',
    _test.pickRig([], null) === null && _test.pickRig(undefined, null) === null);

  // ── The curve that retires the rig ─────────────────────────────────────────
  // awardSkillUse's third arg is the MARGIN fed to ip.js's
  // `chance = base / (1 + |margin| × scale)` — NOT an award amount. EVERY hack
  // target now scores on the true skill-vs-difficulty gap (marginOf), so the rig
  // is simply the easiest one, and easy targets stop paying. These assertions
  // are what stop it silently out-earning real crime again.
  const chance = (m) => 1 / (1 + Math.abs(m) * 2);   // ip.js defaults
  const D = _test.DEFAULT_RIG_DIFFICULTY;
  const LIVE = 5;                                    // a stock ATM / vendor safe
  const liveMargin = (skill) => marginOf(skill, LIVE);

  check('a beginner at the rig difficulty learns the fastest possible',
    _test.rigMargin(D, D) === 0);
  check('the margin grows as the player outgrows the fixed rig',
    _test.rigMargin(D + 6, D) > _test.rigMargin(D + 3, D));
  check('beating something above your level teaches too (absolute gap)',
    _test.rigMargin(0, D) === D);
  check('a missing skill or difficulty degrades to a number, never NaN',
    Number.isFinite(_test.rigMargin(undefined, D)) && Number.isFinite(_test.rigMargin(D, undefined)));

  // The crossover — the whole answer to "does it push you to real targets".
  check('the rig beats a live target for a beginner',
    chance(_test.rigMargin(D, D)) > chance(liveMargin(D)));
  check('a live target beats the rig once you are good',
    chance(_test.rigMargin(D + 6, D)) < chance(liveMargin(D + 6)));
  check('and a harder live target beats an easier one at high skill',
    chance(marginOf(10, 7)) > chance(marginOf(10, 5)));
  check('a walkover teaches almost nothing wherever it happens',
    chance(marginOf(12, 2)) < 0.06);
  check('the warning fires on the wrong side of the crossover',
    _test.rigMargin(D + 6, D) >= _test.OUTGROWN_MARGIN
    && _test.rigMargin(D, D) < _test.OUTGROWN_MARGIN);

  check('rigs default to an easier-than-live difficulty', _test.DEFAULT_RIG_DIFFICULTY < 5);
  check('the rig cooldown is a pacing beat, not an ATM-style punishment lockout',
    _test.COOLDOWN_MS < 60 * 1000);

  // ── The verb stays shared ──────────────────────────────────────────────────
  // The fake player is not standing at a rig, so hackrig's handler must decline
  // the verb (return undefined) rather than swallow it — otherwise hacking a
  // hololock or vendor safe would break the moment this plugin loaded.
  const r = await run('hack');
  check('hack in a rigless room is not claimed by hackrig',
    !/lock sequence|leads/i.test(r?.message || ''), r?.message);
}
