// Voice-indistinguishability suite. Imported by plugins/sanity/regress.js.
//
// The single load-bearing property of the whole feature is that a hallucinated line is
// byte-identical to a real one. That property lives in two files that know nothing about each
// other — ai-behaviour.js `formatChitchat` and commands/social.js `cmdSay` — so it can be
// broken by an innocent edit to either, in a way no human would notice on screen for weeks.
// These tests are the only thing standing between that and a silent tell.
import { _test as V } from './voices.js';
import { formatChitchat } from '../../server/engine/ai-behaviour.js';

export default function regressVoices({ check }) {
  const { asNpcLine, asPlayerLine, poolFor, fill, MUNDANE, PERSONAL, WRONG } = V;

  // ── The forgery, checked against the real thing ────────────────────────────
  // formatChitchat is the genuine NPC speech formatter. A fake NPC line must match its
  // output exactly — same type, same inline style attribute (NOT a class), quotes inside
  // the span, nothing added.
  const real = formatChitchat('Sister Ida Adler', '"You look terrible."');
  const fake = asNpcLine('Sister Ida Adler', 'You look terrible.');
  check('a fake NPC line uses the same message type as a real one', fake.type === real.type, `${fake.type} vs ${real.type}`);
  check('a fake NPC line is byte-identical to a real one', fake.message === real.message,
    `\n    real: ${real.message}\n    fake: ${fake.message}`);
  // The specific things that would give it away if someone "tidied" either side.
  check('the forgery keeps the INLINE style, not a class', /style="color:var\(--yellow\)"/.test(fake.message), fake.message);
  check('the forgery carries no speaker id or data attribute', !/data-|id=/.test(fake.message), fake.message);

  // Player speech is plain text on a `say` payload — the client renders it with textContent,
  // so any markup at all would both look wrong and prove it was fake.
  const pFake = asPlayerLine('Akerson', 'Don\'t.');
  check('a fake player line is a say payload', pFake.type === 'say', pFake.type);
  check('a fake player line matches cmdSay\'s format exactly', pFake.message === 'Akerson says: "Don\'t."', pFake.message);
  check('a fake player line carries no markup (textContent would expose it)',
    !/[<>]/.test(pFake.message), pFake.message);

  // A real emote goes out as zone_event, and an unquoted line must NOT be dressed as speech.
  const emote = formatChitchat('Graham Mercer', 'shrugs and looks away.');
  check('an unquoted line is an emote, not speech (the forgery must not confuse the two)',
    emote.type === 'zone_event' && !/says:/.test(emote.message), `${emote.type}: ${emote.message}`);

  // ── The ladder of pools ────────────────────────────────────────────────────
  check('tier 1 is the mundane pool', poolFor(1) === MUNDANE, 'mundane');
  check('tier 2 addresses you personally', poolFor(2) === PERSONAL, 'personal');
  check('tier 3 has stopped pretending', poolFor(3) === WRONG, 'wrong');
  check('an out-of-range tier falls back to the mildest pool', poolFor(0) === MUNDANE && poolFor(99) === WRONG, 'clamped');

  // Being addressed by NAME is held back — it is the moment it stops being ambient, so it
  // must not leak into the first pool a player ever hears.
  check('the mundane pool never uses your name', !MUNDANE.some(l => l.includes('{you}')), 'anonymous');
  check('the later pools do', PERSONAL.concat(WRONG).some(l => l.includes('{you}')), 'personal');
  check('the name token is filled from the handle', fill('Hello {you}.', { handle: 'Akerson' }) === 'Hello Akerson.', fill('Hello {you}.', { handle: 'Akerson' }));
  check('a handle-less player degrades gracefully', fill('{you}.', {}) === 'you.', fill('{you}.', {}));
  check('no line leaks an unfilled token',
    MUNDANE.concat(PERSONAL, WRONG).every(l => !/\{(?!you\})/.test(l)), 'clean');

  // Every line must be quotable speech — no stage directions, or the forgery reads as an
  // emote wearing a speech tag.
  check('no voice line is written as an action',
    MUNDANE.concat(PERSONAL, WRONG).every(l => !/^\w+s\b/.test(l) || /[.?!"]$/.test(l)), 'all speech');
}
