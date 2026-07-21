// Drama plugin regression suite — run by tests/regress.js (never loaded in
// production). Covers the authoring verb, the $player substitution, and the
// one-shot nature of the arming.
import { hooks } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const fire = () => hooks['movement.arriveMessage']({ player: p });

  check('no line written yet → drama nags instead of arming', /no entrance written/i.test((await run('drama')).message || ''));

  const set = await run('drama $player steps out of the dark, unhurried.');
  check('writing a line reports it back with the handle substituted', (set.message || '').includes(`${p.handle} steps out of the dark`), set.message);

  const first = fire();
  check('armed entrance fires with $player substituted', first === `${p.handle} steps out of the dark, unhurried.`, String(first));
  check('it switches off once used', fire() === undefined);

  const rearm = await run('drama');
  check('bare drama re-arms the stored line', /armed/i.test(rearm.message || ''), rearm.message);
  check('re-armed entrance fires again', fire() === `${p.handle} steps out of the dark, unhurried.`);

  await run('drama <span onclick=hack>tag soup</span>');
  const sanitized = fire();
  check('angle brackets are stripped out of player text', !/[<>]/.test(sanitized || ''), String(sanitized));

  const off = await run('drama off');
  check('drama off clears the line', /cleared/i.test(off.message || ''), off.message);
  check('cleared means nothing fires', fire() === undefined);
  check('cleared line is gone from storage', /no entrance written/i.test((await run('drama')).message || ''));
}
