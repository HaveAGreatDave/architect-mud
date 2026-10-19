// tv-reactions regression suite — run by tests/regress.js (never loaded in
// production). The live path needs a real broadcast tick, a tuned set and two
// NPCs in a room, which is manual QA; what's locked down here is the gating and
// the token resolution, because every failure mode of this plugin is "it talked
// when it shouldn't have".
import { _test } from './index.js';

export default async function regress({ check }) {
  const beat = (over = {}) => ({
    zoneId: 'zone_test_bar', text: 'AND HE IS DOWN AT THE PLATE.',
    programName: 'DEADBALL LIVE', stationName: 'KSAB-TV', mode: 'sports', style: 'raw',
    ...over,
  });

  // ── resolveLine — a line that names something the beat lacks is unusable ─────
  check('fills {program}',
    _test.resolveLine('"{program}. Again."', beat()) === '"DEADBALL LIVE. Again."',
    _test.resolveLine('"{program}. Again."', beat()));
  check('fills {station}',
    _test.resolveLine('"That\'s {station} all over."', beat()) === '"That\'s KSAB-TV all over."',
    'station');
  check('rejects a line whose token has no value',
    _test.resolveLine('"{program}. Again."', beat({ programName: null })) === null,
    'unresolvable → null');
  check('a line with no tokens always resolves',
    _test.resolveLine('shrugs at the set.', beat({ programName: null, stationName: null })) === 'shrugs at the set.',
    'plain line');

  // ── pickLine — always lands on something sayable ────────────────────────────
  // Even with every token absent, the generic pool's plain entries must carry it;
  // a null here means a room where the set is on and nobody can ever remark on it.
  let nulls = 0;
  for (let i = 0; i < 200; i++) {
    if (_test.pickLine(beat({ programName: null, stationName: null, mode: 'sports' })) === null) nulls++;
  }
  check('pickLine survives a beat with no program or station', nulls === 0, `${nulls} nulls in 200`);

  let unknown = 0;
  for (let i = 0; i < 200; i++) if (_test.pickLine(beat({ mode: 'no_such_mode' })) === null) unknown++;
  check('pickLine falls back for an unknown mode', unknown === 0, `${unknown} nulls in 200`);

  // ── A speaker's own lines (flags.tv_lines) ──────────────────────────────────
  // They replace the shared pool for their mode, and only for it; a pool whose
  // every line wants a token this beat lacks still lands on a shared line.
  const fan = { name: 'Test Fan', flags: { tv_lines: { sports: ['"Mine, every time."'], news: ['"{program}, mine."'] } } };
  check('tv_lines: a speaker\'s own line wins for its mode',
    _test.pickLineFor(fan, beat()) === '"Mine, every time."', _test.pickLineFor(fan, beat()));
  const fellBack = _test.pickLineFor(fan, beat({ mode: 'gameshow' }));
  check('tv_lines: another mode uses the shared pools',
    !!fellBack && fellBack !== '"Mine, every time."', fellBack);
  const unresolved = _test.pickLineFor(fan, beat({ mode: 'news', programName: null, stationName: null }));
  check('tv_lines: an own line wanting a missing token falls back',
    !!unresolved && !/mine/.test(unresolved), unresolved);
  check('tv_lines: no speaker, the shared pools as before',
    !!_test.pickLineFor(null, beat()), 'null speaker');

  // Sir Charles is the first character with lines of his own. Same rules as the
  // shared pools: no em dash, no token but the two that exist.
  {
    const { world } = await import('../../server/engine/world.js');
    const charles = world.npcs.get('npc_charles_hughson');
    const own = Object.values(charles?.flags?.tv_lines || {}).flat();
    if (charles) {
      check('Sir Charles has his own sports lines', own.length > 0 && Array.isArray(charles.flags.tv_lines.sports), `${own.length} lines`);
      check('his lines use no em dash or unknown token',
        !own.some(l => l.includes('—') || /\{(?!program\}|station\})[a-z_]+\}/.test(l)), own.join(' | '));
    }
  }

  // ── Every authored pool must be non-empty and sayable ───────────────────────
  // An empty pool is silent in a way that reads as a bug in the broadcast tick.
  const emptyPools = Object.entries(_test.MODE_LINES).filter(([, lines]) => !Array.isArray(lines) || !lines.length);
  check('no mode pool is empty', emptyPools.length === 0, emptyPools.map(([k]) => k).join(', '));
  check('the generic pool is non-empty', _test.GENERIC_LINES.length > 0, `${_test.GENERIC_LINES.length}`);

  // Em dashes are an Ascendant/Architect voice tell. Ordinary NPCs do not use them.
  const allLines = [...Object.values(_test.MODE_LINES).flat(), ..._test.GENERIC_LINES];
  const emdash = allLines.filter(l => l.includes('—'));
  check('no NPC reaction line uses an em dash', emdash.length === 0, emdash.join(' | '));

  // Only {program} and {station} exist. A typo'd token would print raw at a player.
  const badToken = allLines.filter(l => /\{(?!program\}|station\})[a-z_]+\}/.test(l));
  check('no reaction line uses an unsupported token', badToken.length === 0, badToken.join(' | '));

  // ── The gates ───────────────────────────────────────────────────────────────
  // No zone in the fake world, so every one of these must be a silent no-op that
  // also leaves the throttle untouched (a claimed slot with no line spoken would
  // mute the room for two and a half minutes for nothing).
  _test.lastReactAt.clear();
  _test.onBroadcastMessage(beat({ onStage: true }));
  check('a studio-floor beat is ignored', !_test.lastReactAt.has('zone_test_bar'), 'onStage');
  _test.onBroadcastMessage(beat({ style: 'overlay' }));
  check('a non-spoken style is ignored', !_test.lastReactAt.has('zone_test_bar'), 'overlay');
  _test.onBroadcastMessage(beat({ text: '' }));
  check('an empty beat is ignored', !_test.lastReactAt.has('zone_test_bar'), 'no text');
  _test.onBroadcastMessage(null);
  check('a malformed event never throws', true, 'null payload survived');
  _test.onBroadcastMessage(beat());
  check('a room with no players never reacts', !_test.lastReactAt.has('zone_test_bar'), 'no witness');
  _test.lastReactAt.clear();
}
