// Accent smoke: where ORACLE puts its accents.
//
//   node scripts/voice/accent-smoke.mjs
//
// Runs in the voice gates beside smoke.mjs. smoke.mjs checks sounds; this checks the
// phrase-level marks placeAccents writes into the run (see the mark list above
// isLong in client/shared/audio-engine.js):
//   '+'   the light nucleus, one per phrase
//   '^'   the held nucleus of a sold line (opt.excite, as speak() takes it)
//   '_M'  a minor break nobody typed, in a long unpunctuated stretch
//   a missing '*' on a content word: given (said before) or the tail of a compound
// and that the word-level rules it builds on (caps emphasis, function-word
// deaccenting, the phrase-edge exemption) still do what they did.
//
// Needs no browser, DB or network.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p) => new Function(readFileSync(join(ROOT, p), 'utf8'))();

globalThis.window = globalThis;
load('client/shared/formant-cmudict.js');
load('client/shared/audio-engine.js');
const A = globalThis.AudioEngine;
if (!A?._phonemesFor) { console.error('✗ audio-engine did not expose its debug hooks'); process.exit(1); }

let fails = 0;
const say = (t, opt = {}) => A._phonemesFor(t, { marks: true, ...opt }).join(' ');
const count = (s, tok) => s.split(' ').filter(p => p === tok).length;

function check(label, cond, text, got) {
  if (cond) return;
  fails++;
  console.error(`  ✗ ${label}\n      "${text}"\n      got ${got}`);
}
const has = (label, text, want, opt) => { const g = say(text, opt); check(`${label} (want ${want})`, g.includes(want), text, g); };
const lacks = (label, text, bad, opt) => { const g = say(text, opt); check(`${label} (not ${bad})`, !g.includes(bad), text, g); };
const marks = (label, text, tok, n, opt) => { const g = say(text, opt); check(`${label} (${n} × ${tok})`, count(g, tok) === n, text, g); };

// ── 1. a nucleus in every phrase ─────────────────────────────────────────────
has('the nucleus is the last content word', 'The goalie made a save.', 'S + * EY V');
marks('…and there is one of it', 'The goalie made a save.', '+', 1);
marks('one per phrase', 'He shoots. He scores.', '+', 2);
marks('a comma is a phrase too', 'Vale shoots, and the goalie saves.', '+', 2);
has('the last caps word wins over a later content word', 'it is GONE now', 'G + ! AO N');
lacks('…so the content word after it is not the nucleus', 'it is GONE now', '+ * AW');
lacks('a function word is never the default nucleus', 'look at me', '+ * IY');
has('…the last content word is', 'look at me', 'L + * UH K');
// '+' asks for no hold; only a sold line gets '^', and it replaces the '+'.
marks('a calm line has no held nucleus', 'The goalie made a save.', '^', 0);
has('a sold line holds the same vowel', 'The goalie made a save.', 'S * ^ EY V', { excite: 1 });
marks('…and drops the light mark there', 'The goalie made a save.', '+', 0, { excite: 1 });
has('a sold line still holds the caps word', 'He shoots. He SCORES!', 'K ! ^ AO R Z', { excite: 1 });
marks('…one held vowel per sentence', 'He shoots. He SCORES!', '^', 2, { excite: 1 });

// ── 2. given/new ─────────────────────────────────────────────────────────────
has('a repeated word loses its accent', 'He made a save and then another save.', 'S EY V __');
has('…and the nucleus moves to the new word', 'He made a save and then another save.', 'AX N + * AH DH ER');
has('the first mention keeps its accent', 'He made a save and then another save.', 'S * EY V');
has('a plural is the same word said again', 'One goal, then two goals.', 'G OW L Z');
has('a caps repeat keeps its accent', 'He made a save and another SAVE.', 'S + ! EY V');
{
  const t = 'dogs chase cats but cats run';
  const g = say(t);
  check('a repeat after a contrast word keeps its accent', count(g.replace(/\+ /g, ''), '*') === 5, t, g);
}
marks('a phrase of nothing but given words gets its accent back', 'Vale. Vale!', '+', 2);

// ── 3. minor breaks ──────────────────────────────────────────────────────────
const LONG = 'The forward carries the puck through the neutral zone and drops it back to the defenceman at the point';
has('a long unpunctuated stretch breaks before a conjunction', LONG, 'Z + * OW N _M AX N D');
marks('…once', LONG, '_M', 1);
marks('…and each half has its nucleus', LONG, '+', 2);
marks('an ordinary line is unchanged', 'Vale takes it down the left side and fires a shot on goal', '_M', 0);
marks('a short line never breaks', 'He went to the shop with his dog', '_M', 0);
marks('a written comma resets the count', 'The forward carries the puck through the zone, and drops it back to the point', '_M', 0);

// ── 4. compound stress ───────────────────────────────────────────────────────
has('noun-noun leans on the first (fire station)', 'Meet me at the fire station.', 'F + * AY ER _ S T EY SH AX N');
has('ice rink', 'The ice rink is closed.', '* AY S _ R IH NG K');
has('the White House is an exception', 'the White House', 'W + * AY T _ HH AW S');
has('a street name leans on the name', 'Dray St.', 'D R + * EY _ S T R IY T');
has('an adjective is not a compound', 'an old station', 'S T + * EY SH');
has('nor is a material', 'a stone house', 'HH + * AW S');
has('nor a number', 'two teams', 'T + * IY M Z');
has('town hall is accented on the hall', 'the town hall', 'HH + * AO L');

// ── what was already true ────────────────────────────────────────────────────
has('caps inside prose is emphatic', 'it is GONE now', 'G + ! AO N');
has('an all-caps short line is a shout', 'FUCK!', 'F + ! AH K');
lacks('an all-caps long line is a banner', 'THIS IS THE COLDWATER EVENING REPORT, LIVE ON NINE.', '!');
has('a function word is deaccented', 'the end of the road', 'AX V _ DH AX');
lacks('…and carries no stress', 'the end of the road', 'DH * AH');
has('nothing reduces at a phrase edge', 'look at me', 'M * IY');
// Without opt.marks the debug hook hides '+', so checks about sounds need not spell it.
lacks('the light nucleus is hidden unless asked for', 'The goalie made a save.', '+', { marks: false });

if (fails) { console.error(`\n✗ accent:smoke: ${fails} failure(s)`); process.exit(1); }
console.log('✓ accent:smoke clean.');
