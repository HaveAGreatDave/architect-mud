// Trade plugin regression suite — run by tests/regress.js (never loaded in
// production). Verb routing + fail-safe guards + the escape helper. The full
// invite→stake→swap flow needs two live players and is covered by manual QA.
import { _test } from './index.js';

export default async function regress({ run, check }) {
  check('esc neutralizes angle brackets', _test.esc('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;');

  const off = await run('tradeoffer knife');
  check('tradeoffer outside a trade errors', off?.type === 'error', off?.type);
  const ready = await run('tradeready');
  check('tradeready outside a trade errors', ready?.type === 'error', ready?.type);
  const retract = await run('traderetract credits');
  check('traderetract outside a trade errors', retract?.type === 'error', retract?.type);
  const cancel = await run('tradecancel');
  check('tradecancel outside a trade errors', cancel?.type === 'error', cancel?.type);
  const noWho = await run('trade');
  check('trade with no target and no invite errors', noWho?.type === 'error', noWho?.type);
  const ghost = await run('trade ghost');
  check('trade with nobody here errors cleanly', ghost?.type === 'error', ghost?.type);

  const status = await run('trade status');
  check('trade status outside a trade errors', status?.type === 'error', status?.type);

  // ── The written record ─────────────────────────────────────────────────────
  // The anti-scam rule ("any change unlocks both sides") is only a protection if
  // you can SEE what the other side staked. Four of the five state changes used to
  // produce no log output at all, and the panel's buttons submit silently — so a
  // player who closed the window mid-trade had no trace of what was agreed, and a
  // player who couldn't use the panel was being asked to lock in blind.
  //
  // Two live players are out of reach for the harness, so the RENDERERS are
  // asserted directly on a synthetic session.
  {
    const A = 'p_a', B = 'p_b';
    const session = {
      players: [A, B],
      handles: { [A]: 'Alice', [B]: 'Bob' },
      offers: {
        [A]: { items: [{ invId: 'i1', qty: 2, name: 'ration tin' }], credits: 50, ready: false },
        [B]: { items: [{ invId: 'i2', qty: 1, name: 'cutter' }], credits: 0, ready: true },
      },
    };
    const mine = _test.offerLines(session, A);

    check('record: your own stake is listed', /ration tin ×2/.test(mine), mine);
    check('record: …with staked credits', /₵50/.test(mine), mine);
    check('record: THEIR stake is listed too — the whole point of the rule',
      /cutter/.test(mine), mine);
    check('record: their lock state is visible', /locked in/.test(mine), mine);
    check('record: your unlocked state is visible', /not locked/.test(mine), mine);
    // Both sides are named, from the viewer's side, so a log line can't be
    // misread as the other person's offer.
    check('record: sides are labelled You / their handle',
      /\bYou\b/.test(mine) && /Bob/.test(mine), mine);

    // The same block from the other seat must mirror, not repeat.
    const theirs = _test.offerLines(session, B);
    check('record: the other seat sees it mirrored',
      /\bYou\b/.test(theirs) && /Alice/.test(theirs) && /cutter/.test(theirs), theirs);

    // An empty offer must say so rather than rendering blank — "nothing" and "I
    // failed to draw this" have to be distinguishable before you lock in.
    const empty = _test.offerLines(
      { players: [A, B], handles: session.handles, offers: { [A]: { items: [], credits: 0, ready: false }, [B]: session.offers[B] } }, A);
    check('record: an empty side reads as "nothing", never blank', /nothing/.test(empty), empty);

    // Handles and item names are escaped — they are player-supplied.
    const nasty = _test.offerLines(
      { players: [A, B], handles: { [A]: 'Alice', [B]: '<script>' },
        offers: { [A]: { items: [{ invId: 'i', qty: 1, name: '<img>' }], credits: 0, ready: false }, [B]: session.offers[B] } }, A);
    check('record: item names and handles are escaped', !/<script>|<img>/.test(nasty), nasty);

    const block = _test.statusBlock(session, A, 'HEAD');
    check('status: the block leads with its headline', /^HEAD/.test(block), block.slice(0, 40));
    check('status: …and offers a way to re-read it', /trade status/.test(block), 'no re-read link');
  }
}
