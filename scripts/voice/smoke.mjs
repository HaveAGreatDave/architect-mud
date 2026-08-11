// voice smoke — the only automated coverage the formant synth has.
//
//   node scripts/voice/smoke.mjs
//
// Runs in pretest:regress, like scripts/shapes/smoke.mjs, and for exactly the same
// reason: before this existed the ONLY thing that ever checked a pronunciation was
// a person listening to a broadcast and noticing. Every defect found in this system
// so far surfaced that way — "intrusive sounds wrong", "architect loses its ct",
// "some sounds like sim", "Cyd comes out Seed" — which means each one shipped, aired,
// and was caught by luck. A regression here should turn a build red, not a listener's
// head.
//
// Needs no browser, DB or network. audio-engine.js is dual-mode and attaches to
// globalThis when `window` is absent, so it loads headlessly; the two debug hooks
// (_phonemesFor, _estimateDuration) are pure and touch no AudioContext.
//
// WHAT IT GUARDS, and why each case is here rather than being a generic sample:
//   • the letter-guesser's rules — it only ever runs on NAMES and coinages, so a
//     bug there repeats forever and is invisible in ordinary words
//   • the allophonic rules, each of which was wrong once
//   • stress, reduction and weak forms — the double-count family
//   • pacing against broadcast's nodeHoldMs, which is FITTED to estimateDuration
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
const say = (t) => A._phonemesFor(t).join(' ');

function check(label, cond, detail) {
  if (cond) return;
  fails++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
}
// `want` is a substring of the run — asserting the whole run would make every case
// brittle against unrelated tuning, and what each case is really about is one contrast.
function has(label, text, want) {
  const got = say(text);
  check(label, got.includes(want), `"${text}"\n      want …${want}…\n      got   ${got}`);
}
function lacks(label, text, unwanted) {
  const got = say(text);
  check(label, !got.includes(unwanted), `"${text}"\n      should NOT contain ${unwanted}\n      got   ${got}`);
}

// ── the letter-guesser: medial y is open/closed, not one value ────────────────
has('y closed → IH (Cyd is "Sid", not "Seed")', 'cyd', 'IH D');
has('y open → AY (cyborg)',                     'cyborg', 'AY');
has('y open through a digraph (cypher)',        'cypher', 'AY');
has('y final → IY (city)',                      'city', 'IY');
has('y initial → consonant (yes)',              'yes', 'Y ');
lacks('y closed is not AY (gym)',               'gym', 'AY');
// ER already carries its own r; emitting the following 'r' too gave a doubled rhotic.
lacks('ER does not double its r (cypher)',      'cypher', 'ER R');
has('but r before a vowel is a real onset (hero)', 'hero', 'R');

// ── hand-dictionary names: each was audibly wrong once ───────────────────────
has('echelon is French /ʃ/, not "etch"', 'echelon', 'SH');
has('auggie has a hard g',               'auggie', 'G IY');
has('vigo is "VEE-go"',                  'vigo', 'IY G OW');

// ── allophonic rules ─────────────────────────────────────────────────────────
has('final cluster keeps its T (architect)', 'architect', 'K T');
has('/h/ before a front vowel',              'he', 'HH');
has('contractions come from the dictionary, not the guesser', "they're", 'DH');
lacks("don't is not \"dahnt\"", "don't", 'D * AA N T');

// ── stress, reduction, weak forms ────────────────────────────────────────────
has('lexical stress from the dictionary (banana)', 'banana', 'N * AE N');
has('schwa where the dictionary says so',          'banana', 'B AX');
has('weak /uː/ → /ʊ/, not schwa ("you are")',      'you are here', 'Y UH');
has('weak "are" → schwa',                          'you are here', 'AX R');
has('nothing reduces at a phrase edge',            'look at me', 'M * IY');
has('polysyllabic word keeps internal stress',     'he walked into the room', '* IH N T UW');
lacks('"not" is never reduced',                    'you are not going', 'N AX T');

// ── emphasis: three cases, and they are not the same case ────────────────────
has('caps word inside prose is emphatic',   'it is GONE now', 'G ! AO N');
has('all-caps short line is a shout',       'FUCK!', 'F ! AH K');
lacks('all-caps LONG line is a banner, not a scream',
      'THIS IS THE COLDWATER EVENING REPORT, LIVE ON NINE.', '!');

// ── contractions ─────────────────────────────────────────────────────────────
// CMUdict has no apostrophe forms at all, so before the clitic rules existed every
// one of these reached the letter-guesser, which DELETES the apostrophe and reads
// what's left as a single word: "i'm" came back as "im", "you're" as "yoor-eh".
// These are among the most-spoken words there are, so the error was constant.
has("I'm is eye-m, not im",          "I'm", 'AY M');
has("you're is one syllable",        "you're", 'R');
lacks("you're doesn't grow a vowel", "you're", 'R EH');
has("it's takes a voiceless /s/",    "it's", 'T S');
has("he's takes a voiced /z/",       "he's", 'IY Z');
has("n't is stem + /ənt/ (isn't)",   "isn't", 'Z AX N T');
has("don't is irregular, not do+n't","don't", 'D * OW N T');
has("can't is irregular",            "can't", 'K * AE N T');
has("we'll",                         "we'll", 'IY L');
has("I've",                          "I've", 'AY V');
// G-DROPPING. The corpus is written the way people talk. None of these are in any
// dictionary; the -ing form is, so the rule asks for that and swallows the velar.
has("somethin' is the -ing word minus the velar", "somethin'", 'TH IH N');
lacks("somethin' keeps no NG",                    "somethin'", 'NG');
has("gettin' without the apostrophe too",         'gettin', 'IH N');

// ── /ɪ/ is a weak-form vowel and never reduces to schwa ─────────────────────
// "is in it his" are function words whose vowel is ALREADY /ɪ/. Mapping it to
// schwa with the other weak forms turned the most-spoken words in the language
// into "uhz uhn uht" — the single most audible source of mumble in the voice.
has('unstressed "is" keeps its /ɪ/',  'is it', 'IH Z');
has('unstressed "in" keeps its /ɪ/',  'in the water', 'IH N');
lacks('"his" does not centralise',    'his hand', 'HH AX Z');

// ── compounds: this game's whole vocabulary ─────────────────────────────────
// The coinages were invented here, so CMUdict has none of them and never will.
// Before compoundLook they all reached the letter guesser, which reads a long
// unknown word as one unstressed run: the first element usually survived and the
// second was always mush — "void-WAH-lking", "chem-buhnch", "GRASH-uh-per".
// Splitting fixes them wholesale because both halves are ordinary English.
has('voidwalking splits (was "wuhlking")',   'voidwalking', 'W AO K IH NG');
has('chembench splits (was "buhnch")',       'chembench', 'B EH N CH');
has('grasshopper keeps its /s/ and /h/',     'grasshopper', 'S HH AA P');
has('nanofilament splits',                   'nanofilament', 'F IH L AX M AX N T');
has('a productive STEM beats an entry per word (holo-)', 'hololock', 'HH * AA L OW');
// English compounds take ONE accent, on the first element. Two accents is two
// words read off a list, which is what a naive concatenation gives you.
lacks('a compound does not stress both halves', 'voidwalking', 'W * AO K');
// And the split must never fire on a word the dictionary already knows, or it
// would start finding compounds inside ordinary English.
lacks('a known word is never split ("therapist")', 'therapist', 'R * EY P');

// ── initialisms ─────────────────────────────────────────────────────────────
// The hand-list (dmv, gdp, crt) only ever covered what somebody had already
// noticed. "NPC" came back "M P K" — three consonants, no vowel, not speech.
has('an unknown initialism is spelled out (NPC)', 'NPC', 'P IY');
has('…with the accent on the last letter',       'NPC', 'S ! IY');
has('four letters too (VTOL)',                   'VTOL', '! EH L');
// The guards. ALL-CAPS is also how the corpus writes a shout and a station
// ident, so spelling out anything capitalised would scream at 11% of the .bsm
// corpus. A real word is known to the dictionary and must survive untouched.
lacks('a real caps word is not spelled out (GONE)', 'it is GONE now', 'JH IY');
lacks('nor a short one (GO)',                      'GO', 'JH IY');
lacks('nor a long acronym that is a word (SPECTER)', 'SPECTER', 'EH S P IY');

// ── the world's own units and symbols ───────────────────────────────────────
// ₵ was in no symbol pass, so it was SILENTLY DROPPED: "₵900" read as "nine
// hundred", no unit. Money is quoted in every shop, job, bounty and rent line in
// the game, which made it the most-repeated omission in the voice.
has('the credit symbol is spoken, and postfixed', '₵900', 'K R * EH DX IH T S');
has('…after the number, never before',            '₵900', 'N * AY N _ HH * AH N D R AX D _ K R');
has('& is a word, not silence',                   'nuts & bolts', 'AX N D');
has('#4 is "number four"',                        '#4', 'N * AH M B ER');
has('x2 is "times two"',                          'x2', 'T * AY M Z');
// CMUdict has an entry for `dr` and it means DRIVE. "Dr. Vale" was read
// "drive Vale" every single time.
has('Dr. is a doctor, not a drive', 'Dr. Vale', 'D * AA K T ER');
has('St. before a name is a saint', 'St. Mark', 'S * EY N T');
has('St. otherwise is a street',    'Dray St.', 'S T R * IY T');
// A colon is a phrase break everywhere else, which was putting a pause in the
// middle of the time.
has('4:30 is "four thirty"',   '4:30', 'F * AO R _ TH * ER');
has('9:00 is "nine o\'clock"', '9:00', 'K L * AA K');
lacks('…with no pause inside it', '4:30', '_S');

// ── punctuation shapes the phrase ────────────────────────────────────────────
has('comma is a continuation, not a full stop', 'bread, water', '_C');
has('full stop is terminal',                    'bread. water', '__');

// ── pacing: broadcast's nodeHoldMs is FITTED to estimateDuration ─────────────
// If these drift apart, captions land on top of the voice — which has happened
// twice, both times because a duration rule was added to one and not the other.
const HOLD = (n) => Math.ceil(Math.max(2200, Math.min(n * 75, 30000) + 900) / 1000) * 1000;
const LINES = [
  'Good evening, and welcome to the Coldwater evening report.',
  'Acid rain is expected after midnight; stay indoors and cover exposed skin.',
  'CraniumTrust announces a new line of cyberware for the discerning citizen.',
  'Stay tuned.', 'Yes.',
];
// 1.24 is the floor of the per-voice speed range: the SLOWEST narrator is what has
// to fit, not the average one.
const SLOWEST = 1.24 * 0.85;
for (const line of LINES) {
  const ms = A._estimateDuration(A._phonemesFor(line), SLOWEST) * 1000;
  check(`pacing: "${line.slice(0, 40)}…" fits its broadcast hold`,
    ms < HOLD(line.length), `speech ${Math.round(ms)}ms vs hold ${HOLD(line.length)}ms`);
}
// And the rate itself stays in the range of ordinary human speech. Wide bounds — this
// is a tripwire for a tuning change that went badly wrong, not a tuning assertion.
const rate = LINES.reduce((n, l) => n + A._estimateDuration(A._phonemesFor(l), SLOWEST) * 1000, 0)
           / LINES.reduce((n, l) => n + l.length, 0);
check(`speech rate ${rate.toFixed(1)}ms/char is within 55–110`, rate > 55 && rate < 110);

if (fails) { console.error(`\n✗ voice:smoke — ${fails} failure(s)`); process.exit(1); }
console.log('✓ voice:smoke clean.');
