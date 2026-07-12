// idle-logoff regress — drives the tick.minute sweep directly with a capturing
// broadcast, time-traveling the harness player's _lastInputAt stamp.
import { hooks, IDLE_WARN_MS, IDLE_KICK_MS } from './index.js';

export default async function ({ run, check, getPlayer }) {
  const p = getPlayer();
  const sent = [];
  const broadcast = (a, msg, b, playerId) => { if (playerId === p.id) sent.push(msg); };
  const sweep = () => hooks['tick.minute']({ broadcast });

  const saved = { last: p._lastInputAt, warned: p._idleWarnedAt };
  try {
    // Fresh player: first sweep seeds the clock, says nothing.
    delete p._lastInputAt; delete p._idleWarnedAt;
    await sweep();
    check('first sweep seeds the clock silently', sent.length === 0 && typeof p._lastInputAt === 'number', JSON.stringify(sent));

    // Under the warn threshold: silent.
    p._lastInputAt = Date.now() - (IDLE_WARN_MS - 60_000);
    await sweep();
    check('under 15 min → silent', sent.length === 0, JSON.stringify(sent));

    // 15 min idle: exactly one warning, not repeated on the next sweep.
    p._lastInputAt = Date.now() - IDLE_WARN_MS;
    await sweep();
    check('15 min idle → one warning', sent.length === 1 && sent[0].type === 'system' && /idle/i.test(sent[0].message), JSON.stringify(sent));
    await sweep();
    check('warning not repeated within one idle stretch', sent.length === 1, JSON.stringify(sent.map(m => m.type)));

    // Input after a warning re-arms it: warned long ago, fresh-er input, idle again.
    p._idleWarnedAt = Date.now() - IDLE_KICK_MS;
    p._lastInputAt = Date.now() - IDLE_WARN_MS;
    sent.length = 0;
    await sweep();
    check('new input re-arms the warning', sent.length === 1 && sent[0].type === 'system', JSON.stringify(sent.map(m => m.type)));

    // Recent input: nothing fires even with a stale warn latch.
    p._lastInputAt = Date.now();
    sent.length = 0;
    await sweep();
    check('recent input → silent', sent.length === 0, JSON.stringify(sent.map(m => m.type)));

    // 20 min idle: kicked.
    p._lastInputAt = Date.now() - IDLE_KICK_MS;
    sent.length = 0;
    await sweep();
    check('20 min idle → kicked', sent.length === 1 && sent[0].type === 'kicked', JSON.stringify(sent.map(m => m.type)));
  } finally {
    // Leave no idle state behind for later suites.
    if (saved.last == null) p._lastInputAt = Date.now(); else p._lastInputAt = saved.last;
    if (saved.warned == null) delete p._idleWarnedAt; else p._idleWarnedAt = saved.warned;
  }
}
