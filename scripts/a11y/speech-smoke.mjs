// Speech in and speech out, actually exercised — voice input (the mic button)
// and Read Aloud (the log reader). Both are in one file because they are one
// feature to the person using them: the game spoken to you and spoken back at.
//
//   node scripts/a11y/speech-smoke.mjs   (also wired into pretest:regress)
//
// The sibling of a11y/verb-smoke.mjs, and here for the same reason: for the
// player who uses it, this is the ONLY way to enter a command, so "the
// normalizer throws" or "north stopped working" is not something we get to find
// out from a bug report.
//
// It drives the REAL client/shared/dictation.js — that module is pure and
// import-free precisely so this can — plus a few static checks on the wiring
// around it. Needs no browser, DB or network.
//
// The transcripts below are the point. Each one is a thing a recognizer
// genuinely returns for a thing a player genuinely says; a generic "hello world
// round-trips" case would pass forever and guard nothing.
import { readFileSync } from 'node:fs';
import { normalizeDictation, GUARDED_VERBS, FREE_TEXT_VERBS } from '../../client/shared/dictation.js';

let failed = 0;
const bad = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

const NOUNS = ['rusty pipe', 'battered coat', 'chrome revolver', 'Grady', 'shopping list', 'steel locker'];

function heard(transcript, expect, note) {
  let r;
  try { r = normalizeDictation(transcript, { nouns: NOUNS }); }
  catch (e) { bad(`"${transcript}" threw: ${e.message}`); return null; }
  if (r.text === expect) ok(`"${transcript}" → ${r.text}${note ? `  (${note})` : ''}`);
  else bad(`"${transcript}" → "${r.text}", expected "${expect}"${note ? `  (${note})` : ''}`);
  return r;
}

// ── Directions ──────────────────────────────────────────────────────────────
// The single worst case in the game: `n` is one character and every filler word
// in English sounds like it. If this section goes red, walking is broken.
console.log('\nDirections — the one-token case:');
heard('in', 'n', 'the commonest mis-hear of "north"');
heard('And.', 'n', 'capitalized and punctuated, as recognizers deliver it');
heard('an', 'n');
heard('north', 'n');
heard('Ess', 's');
heard('east', 'e');
heard('double you', 'w', 'the only compass letter that is not a syllable');
heard('south east', 'se');
heard('sell', 'se', 'what a phone hears for "s e"');
heard('go north east', 'ne', 'longest phrase wins — never decided one word at a time');
heard('up', 'up');

// ── The cautious half ───────────────────────────────────────────────────────
// Rule 1 exists so the aggressive one-token table cannot reach inside a
// sentence. If these fail, the layer is actively destroying valid commands.
console.log('\nMulti-token utterances are left alone:');
heard('put the battered coat in the steel locker', 'put battered coat in steel locker',
  '"in" survives — it is not a bare direction here');
heard('say meet me at the bar', 'say meet me at the bar', 'free text is never noun-matched');
heard('tell Grady I am late', 'tell grady i am late');

// ── Verb repair + the live vocabulary ───────────────────────────────────────
console.log('\nVerb repair and live nouns:');
heard('field rusty pipe', 'wield rusty pipe', 'the mis-hear that started this');
heard('wield pipe', 'wield rusty pipe', 'partial name snaps to what is in your hands');
heard('examine the chrome revolver', 'examine chrome revolver', 'articles dropped');
heard('look at Grady', 'examine grady');
heard('pick up the rusty pipe', 'get rusty pipe');
heard('shop list', 'shoplist');
heard('x coat', 'examine battered coat');

// Rule 3: never invent. An unmatched noun passes through so the server answers
// as it would for a typo, rather than the layer running something else.
console.log('\nNever invents:');
heard('get flanged widget', 'get flanged widget', 'unknown noun passes through verbatim');
heard('frobnicate', 'frobnicate', 'unknown verb passes through verbatim');
{
  const r = normalizeDictation('', { nouns: NOUNS });
  if (r && r.text === '') ok('empty transcript is empty, not a crash');
  else bad('empty transcript did not return empty text');
}

// ── The guard ───────────────────────────────────────────────────────────────
// The thing that must not quietly stop working. Auto-send is the mode a player
// leaves on for hours; the guard is the only reason a mishearing costs a
// keypress rather than a rifle.
console.log('\nThe auto-send guard:');
{
  const cases = ['drop rusty pipe', 'give Grady the chrome revolver', 'attack Grady', 'buy coat', 'quit'];
  const unguarded = cases.filter(c => !normalizeDictation(c, { nouns: NOUNS }).guarded);
  if (unguarded.length) bad(`these are auto-sendable and must not be: ${unguarded.join(', ')}`);
  else ok(`all ${cases.length} costly commands are flagged guarded`);

  const safe = ['n', 'look', 'examine rusty pipe', 'say hello'];
  const wrong = safe.filter(c => normalizeDictation(c, { nouns: NOUNS }).guarded);
  if (wrong.length) bad(`these are guarded and should not be — Auto-send would be pointless: ${wrong.join(', ')}`);
  else ok('ordinary commands are not guarded, so Auto-send is still worth turning on');

  for (const v of ['drop', 'give', 'sell', 'attack', 'buy', 'pay', 'quit']) {
    if (!GUARDED_VERBS.has(v)) bad(`"${v}" has been removed from GUARDED_VERBS — it will now auto-send on a mishearing`);
  }
  if (!FREE_TEXT_VERBS.has('say')) bad('`say` is no longer free-text — spoken sentences will be rewritten into item names');
}

// ── The wiring ──────────────────────────────────────────────────────────────
// Static, like a11y/smoke.mjs: these can't tell you the button works, only that
// the arrangement that makes it reachable and safe is still there.
console.log('\nWiring:');
{
  const settings = readFileSync('client/shared/settings.js', 'utf8');
  const dict = readFileSync('client/game/js/dictation.js', 'utf8');
  const html = readFileSync('client/game/index.html', 'utf8');
  const input = readFileSync('client/game/js/input.js', 'utf8');

  // Off by default. The whole premise of shipping this: a player who never asks
  // for a microphone must never be asked for one.
  if (/dictation:\s*'off'/.test(settings)) ok('Voice Input is off by default');
  else bad('Voice Input is no longer off by default — every player is now prompted for microphone access');

  if (/key:\s*'dictation'/.test(settings)) ok('…and it lives in A11Y_OPTIONS, so it is in both the tablet and the `accessibility` verb');
  else bad('the dictation option is not in A11Y_OPTIONS — it will appear in one surface and not the other');

  // One submit path. A second one diverges silently.
  if (/export function submitCommand/.test(input)) ok('input.js exports the one submit path');
  else bad('submitCommand is gone from input.js — voice input has its own command path now, which will drift from the Enter key');
  if (/submitCommand/.test(dict) && !/sendCmd\(/.test(dict)) ok('…and dictation.js uses it rather than calling sendCmd itself');
  else bad('dictation.js bypasses submitCommand — spoken commands skip history, client verbs and the auto-walk prompt');

  // The guard, at the call site rather than only in the table.
  if (/mode === 'send' && !guarded/.test(dict)) ok('the auto-send branch checks the guard');
  else bad('dictation.js no longer checks `guarded` before auto-sending — a misheard `drop` now runs itself');

  // Interim results must not reach the one live region.
  if (/if \(interim && !final\) \{ input\.value = interim; return; \}/.test(dict)) ok('interim results go to the input box and stop there');
  else bad('interim handling changed — if partials now reach #output, the live region streams and a screen reader becomes unusable');

  if (/id="dictate-btn"[^>]*hidden/.test(html)) ok('the button ships hidden');
  else bad('#dictate-btn is not hidden in the markup — it will flash in for players who never enabled it');
  if (/id="dictate-btn"[^>]*aria-label=/.test(html)) ok('…and is labelled');
  else bad('#dictate-btn has no aria-label — it is announced as an unnamed button');
}

// ── The log reader ──────────────────────────────────────────────────────────
//
// The line filter is the part with real logic in it, and both ways of getting it
// wrong are bad: too greedy and the reader spends a minute saying the names of
// box-drawing characters; too strict and a message is silently never spoken,
// which for someone relying on this means the game just didn't tell them.
console.log('\nRead Aloud — what gets spoken:');
{
  globalThis.window = globalThis.window || { speechSynthesis: null };
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
  const { readableText } = await import('../../client/game/js/logreader.js');

  const el = (text, tag = 'DIV') => ({
    nodeType: 1, tagName: tag, textContent: text,
    querySelector: () => null, getAttribute: () => null,
  });
  const reads = (label, node, want) => {
    const got = readableText(node);
    if (!!got === want) ok(`${label}${want ? '' : ' (skipped)'}`);
    else bad(`${label} — readableText returned ${JSON.stringify(got)}, expected ${want ? 'text' : 'nothing'}`);
  };

  reads('ordinary prose is read', el('You are standing in a cold stairwell.'), true);
  reads('a short system line is read', el('You have 12 credits.'), true);
  // The minimap, the chess board, the card faces and the bounty poster are all
  // pre-formatted glyph art with a written record elsewhere.
  reads('a <pre> is never read', el('╔══╗\n║  ║\n╚══╝', 'PRE'), false);
  reads('a box-drawing line is not read', el('╔════════════════════╗'), false);
  reads('a bar gauge is not read', el('████████░░░░░░░░'), false);
  reads('an empty node is not read', el('   '), false);
  reads('aria-hidden content is not read',
    { nodeType: 1, tagName: 'DIV', textContent: 'decorative', querySelector: () => null,
      getAttribute: (k) => (k === 'aria-hidden' ? 'true' : null) }, false);
  reads('a node CONTAINING a <pre> is not read',
    { nodeType: 1, tagName: 'DIV', textContent: 'map', querySelector: () => ({}), getAttribute: () => null }, false);
  // A line with punctuation in it is still prose — this is the over-strict half.
  reads('prose with heavy punctuation is still read', el('"Get out," he says. "Now!"'), true);
  reads('a credit figure is still read', el('₵1,250 — paid.'), true);
}

console.log('\nRead Aloud — wiring:');
{
  const settings = readFileSync('client/shared/settings.js', 'utf8');
  const reader = readFileSync('client/game/js/logreader.js', 'utf8');
  const input = readFileSync('client/game/js/input.js', 'utf8');
  const engine = readFileSync('client/shared/audio-engine.js', 'utf8');

  // THE ONE THAT MATTERS. #output is a live region: a screen reader is already
  // reading it. On by default would speak every line twice, in two voices,
  // slightly out of step.
  if (/logVoice:\s*'off'/.test(settings)) ok('Read Aloud is off by default — it cannot double-speak a screen reader');
  else bad('Read Aloud is no longer off by default — every screen-reader user now hears every line twice');

  if (/key:\s*'logVoice'/.test(settings) && /key:\s*'logVoiceRate'/.test(settings)) ok('…and both it and its rate are in A11Y_OPTIONS');
  else bad('the Read Aloud options are not in A11Y_OPTIONS — they will not reach the `accessibility` verb');

  if (/MutationObserver/.test(reader)) ok('it observes the log rather than hooking the append helpers');
  else bad('the reader no longer observes #output — anything appended by a path it does not hook is now silently unread');

  if (/export function shush/.test(reader) && /shush\(\)/.test(input)) ok('entering a command interrupts the voice');
  else bad('barge-in is gone — the only way to skip a long line being read is to sit through it');

  // The reader is not a television.
  if (/channel === 'ui'/.test(engine)) ok("the reader bypasses the TV toggle (channel: 'ui')");
  else bad('the reader is behind the TV audio toggle again — muting the television now stops the game being read aloud');
}

console.log(failed ? `\n${failed} check(s) failed\n` : '\nvoice input + read aloud: all checks passed\n');
process.exit(failed ? 1 : 0);
