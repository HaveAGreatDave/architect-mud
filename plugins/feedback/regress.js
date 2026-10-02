// Feedback regression suite. Run by tests/regress.js, never loaded in production.
//
// The fake player's id matches no players row, so the INSERT fails on the FK and
// nothing is written. What's pinned here is everything before the write:
// validation, the cooldown, and that the server context reads from memory.
import { validate, cooldownLeft, serverContext, submit, _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  check('empty text is refused', !!validate({ category: 'bug', text: '   ' }).error);
  check('over-long text is refused', !!validate({ category: 'bug', text: 'x'.repeat(_test.MAX_TEXT + 1) }).error);
  check('an unknown category becomes other', validate({ category: 'rant', text: 'hi' }).category === 'other');
  const big = validate({ category: 'bug', text: 'hi', client: { blob: 'x'.repeat(20000) } });
  check('oversized client telemetry is replaced by a size note', big.clientCtx?.truncated === true, JSON.stringify(big.clientCtx));

  const p = getPlayer();
  const ctx = serverContext(p);
  check('server context names the player and zone', ctx.player.id === p.id && ctx.zone.id === p.current_zone, JSON.stringify(ctx.zone));
  check('server context carries activity and the game clock', 'posture' in ctx.activity && !!ctx.gameTime);

  // A failed write must not start the cooldown, or a DB blip locks a player out.
  _test.lastSent.delete(p.id);
  const res = await submit(p, { category: 'bug', text: 'regress' });
  check('a failed insert reports an error', !!res.error, JSON.stringify(res));
  check('a failed insert leaves no cooldown', cooldownLeft(p.id) === 0);

  _test.lastSent.set(p.id, Date.now());
  check('a recent report starts the cooldown', cooldownLeft(p.id) > 0);
  const again = await submit(p, { category: 'bug', text: 'again' });
  check('the cooldown refuses a second report', /Try again/.test(again.error || ''), JSON.stringify(again));
  _test.lastSent.delete(p.id);

  const out = await run('feedback');
  check('bare feedback prints usage', /Usage: feedback/.test(JSON.stringify(out)), JSON.stringify(out).slice(0, 200));
}
