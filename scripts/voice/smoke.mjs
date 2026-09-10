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

// ── no geminates ─────────────────────────────────────────────────────────────
// English has no doubled consonant inside a word, and the synth produced them
// wherever two phoneme sequences were JOINED — a compound's two halves, or a stem
// and a suffix. `tableland` came out "table-l-and" and `rubbly` "rub-b-ly", and
// those two are terrain words appearing 287 and 157 times in room prose, so Read
// Aloud said them wrong in hundreds of rooms. 126 words in the game's own
// vocabulary carried it (`scripts/voice/suspects.mjs` ranks them).
//
// ⚠ Guarded at the WORD level, not per-case: the fault is at the exit of
// pronounceWord, and a fix put anywhere earlier misses most of it — the first
// attempt went into the letter rules and changed nothing at all, because none of
// these words reach the letter rules.
lacks('a compound does not double at the join', 'tableland', 'L L');
lacks('…nor a stem and its suffix', 'funnelled', 'L L');
lacks('…nor -ttest', 'flattest', 'T T');
lacks('…nor across a hyphen', 'hand-drawn', 'D D');
lacks('…nor an invented name', 'marrick', 'R R');
// The other direction: degemination must not eat a real repeated sound or flatten
// an ordinary word. These are the shapes most at risk from a careless filter.
has('a single medial consonant is untouched', 'happy', 'HH * AE P IY');
has('…and so is a flap', 'little', 'L * IH DX AX L');
has('…and a long vowel run survives', 'banana', 'B AX N * AE N AX');
// ⚠ Asserts the FILTER'S SCOPE, not that this pronunciation is any good. `priya`
// is still wrong and sits in the suspects report — the -ia/-ya vowel fault is a
// separate bug with a separate cause. The point is that degemination must not
// start eating vowels, because that would quietly MASK the whole family, turning a
// visible "P R IH AX AX" into a plausible-looking "P R IH AX" that nobody fixes.
//
// ⚠ `priya` and not `fascia`, and the difference is worth knowing: only SOME of
// these vowel runs reach this filter at all. `fascia`, `cassius`, `aurelia` and
// `giardia` are unchanged whether the exemption is there or not, because their run
// is produced downstream of pronounceWord — so a guard written on one of those
// would pass no matter what this filter did.
has('degemination does not touch vowels', 'priya', 'AX AX');

// ── the game's own vocabulary is IN the dictionary ───────────────────────────
// The curated subset was "common English minus junk", chosen with no reference to
// what this game says — so 32% of the words in its names and descriptions fell to
// the letter-to-sound guesser, including nearly every character name. The guesser
// is decent and was still plainly wrong on a good share of them.
//
// These are pinned because the subset is CURATED: the build script preserves the
// existing list and adds to it, so the way this regresses is somebody re-deriving
// the cut and quietly dropping the additions. Every case below is a word the
// guesser got wrong before the dictionary carried it.
has('waders is not "wadders"',        'waders', 'W * EY');
has('odell is a name, not "oddle"',   'odell', 'OW D * EH L');
has('canteen stresses the second',    'canteen', 'T * IY N');
has('vestibule keeps its /j/',        'vestibule', 'B Y UW L');
lacks('rooke does not rhyme with kook', 'rooke', 'R * UW K');

// ── RP: non-rhoticity, and the linking-r that survives it ────────────────────
// The accent layer is a phoneme rewrite, so it belongs here with the rest of the
// phonology rather than with the graph tests in fm-smoke. GA is asserted beside
// every RP case, because an accent rule leaking into the DEFAULT accent changes
// how the whole game speaks and would surface as nothing more specific than
// "something sounds wrong".
{
  const rp = (t) => A._phonemesFor(t, { accent: 'rp' }).join(' ');
  const ga = (t) => A._phonemesFor(t).join(' ');
  const rpHas = (label, text, want) =>
    check(`rp: ${label}`, rp(text).includes(want), `"${text}" want …${want}… got ${rp(text)}`);
  const rpLacks = (label, text, no) =>
    check(`rp: ${label}`, !rp(text).includes(no), `"${text}" should NOT contain ${no}, got ${rp(text)}`);

  // Non-rhotic: /r/ goes unless a vowel follows it.
  rpLacks('a final /r/ is dropped', 'far gone', 'AA R');
  rpHas('…but a prevocalic one survives', 'very good', 'EH R');

  // LINKING-R. The /r/ of "far" comes back before a vowel-initial word, and the
  // bridge is broken by any real juncture — a full stop or a comma, not merely a
  // word gap. That distinction is the whole reason this cannot use `isGap`, which
  // matches every pause there is.
  rpHas('linking-r bridges a word gap', 'far away', 'AA R _');
  rpHas('…and mid-phrase', 'the car is here', 'AA R _');
  rpLacks('…but not across a full stop', 'far. Away', 'AA R');
  rpLacks('…nor across a comma', 'far, away', 'AA R');
  // ⚠ THESE TWO ARE THE ONES THAT MEAN ANYTHING. Spaced punctuation emits its
  // pause AND a word gap ("AA R __ _ AX"), so a buggy `isGap(phon[n])` would look
  // at the second gap, not a vowel, and refuse the link by luck. Unspaced
  // punctuation emits the pause alone — "far—away" is "AA R _D AX" — so the vowel
  // sits directly after it and a rule that skipped any pause would link straight
  // across a dash. Without these, the isGap mutation passes clean.
  rpLacks('…nor across an unspaced dash', 'far—away', 'AA R');
  rpLacks('…nor across an unspaced ellipsis', 'far...away', 'AA R');
  // ⚠ INTRUSIVE-R MUST NEVER APPEAR. "law and order" has no orthographic r, and
  // this design cannot produce one — it only ever KEEPS an /r/ the dictionary
  // supplied. Asserted anyway, because the day somebody "improves" linking-r by
  // inserting rather than preserving, this is the line that says no.
  rpLacks('no intrusive-r is invented', 'law and order', 'AO R');

  // GOAT: RP starts the diphthong central, GA back and rounded.
  rpHas('GOAT is the RP diphthong', 'go home', 'OWR');

  // The default accent must be untouched by every one of the above.
  check('ga: GOAT is unchanged', ga('go home').includes('OW') && !ga('go home').includes('OWR'), ga('go home'));
  check('ga: keeps every /r/', ga('far away').includes('AA R') && ga('far gone').includes('AA R'), ga('far gone'));
  check('ga: is still rhotic word-finally', ga('the car is here').endsWith('IY R'), ga('the car is here'));
}

// ── THE VOICE ACTUALLY REACHES THE SPEAKERS ──────────────────────────
//
// ⚠ EVERY TEST ABOVE PASSES ON A VOICE NOBODY CAN HEAR. They are pure
// text→phoneme and never build a node, so when the drive stage replaced the one
// line that carried the whole output chain it took the head of that chain with
// it: master, ringGain and presence were built, configured, and connected to
// nothing. Every oscillator still started, every envelope still scheduled,
// speak() still returned a real duration, and ORACLE was silent everywhere —
// broadcasts, the Architect, the library, Read Aloud.
//
// A missing edge in an audio graph throws nothing and reports nothing. So the
// assertion is REACHABILITY rather than any particular wiring: a source that was
// started must either walk to ctx.destination or terminate on an AudioParam (a
// modulator is not meant to be heard). That survives any future re-plumbing and
// needs no update when a stage is inserted, which is the case it exists for.
{
  let uid = 0;
  const edges = new Map();      // node id → Set of node ids, audio-rate only
  const modulators = new Set(); // ids that connect into an AudioParam
  const kinds = new Map();
  const started = [];
  const mkParam = (owner, name) => ({
    _owner: owner, _param: name, _v: 0,
    get value() { return this._v; }, set value(v) { this._v = v; },
    setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; }, setTargetAtTime() { return this; },
    cancelScheduledValues() { return this; }, setValueCurveAtTime() { return this; },
  });
  function mkNode(kind) {
    const id = ++uid; kinds.set(id, kind);
    const n = {
      _id: id, type: 'sine', buffer: null, curve: null, oversample: '', loop: false,
      channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers',
      connect(t) {
        if (t && t._param) { modulators.add(id); return t; } // modulation, not output
        if (!edges.has(id)) edges.set(id, new Set());
        edges.get(id).add(t._id); return t;
      },
      disconnect() { edges.delete(id); },
      start() { started.push(id); }, stop() {}, setPeriodicWave() {},
    };
    for (const q of ['gain', 'frequency', 'detune', 'Q', 'pan', 'delayTime', 'threshold',
      'knee', 'ratio', 'attack', 'release', 'playbackRate']) n[q] = mkParam(kind + id, q);
    return n;
  }
  class GraphContext {
    constructor() {
      this.state = 'running'; this.sampleRate = 48000; this.currentTime = 1.5;
      this.destination = mkNode('destination');
    }
    resume() { return Promise.resolve(); }
    createGain() { return mkNode('gain'); }
    createOscillator() { return mkNode('osc'); }
    createBiquadFilter() { return mkNode('biquad'); }
    createBufferSource() { return mkNode('buffersrc'); }
    createWaveShaper() { return mkNode('shaper'); }
    createDynamicsCompressor() { return mkNode('comp'); }
    createConvolver() { return mkNode('convolver'); }
    createStereoPanner() { return mkNode('panner'); }
    createChannelMerger() { return mkNode('merger'); }
    createDelay() { return mkNode('delay'); }
    createPeriodicWave() { return {}; }
    createBuffer(ch, len, sr) {
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr,
        getChannelData: () => new Float32Array(len) };
    }
  }
  // ensureContext() reads global.AudioContext at CALL time, so installing it down
  // here leaves every pure test above running with no context at all, as before.
  globalThis.AudioContext = GraphContext;
  const destId = 1; // the destination is the first node the context ever builds
  // ⚠ A MODULATOR IS RARELY THE NODE THAT TOUCHES THE PARAM. The wiring is
  // `jit.connect(jitG).connect(glot.frequency)`, so the oscillator sits one hop
  // behind the gain that does the modulating — asking only whether THIS node
  // modulates fails every jitter, shimmer and growl source in the voice.
  const arrives = (from) => {
    const seen = new Set([from]); const q = [from];
    while (q.length) {
      const n = q.pop();
      if (n === destId || modulators.has(n)) return true;
      for (const m of edges.get(n) || []) if (!seen.has(m)) { seen.add(m); q.push(m); }
    }
    return false;
  };

  // Seeds that between them roll the optional stages — drive, growl, the second
  // growl operator — because each one re-plumbs the tail, and inserting a stage is
  // exactly what was being done when the chain broke.
  const SEEDS = ['broadcast', 'reader', 'Dex Rime', 'Cyd', 'Vess', 'Maresh', 'Teague'];
  for (const seed of SEEDS) {
    // Both channels: 'ui' is Read Aloud, which takes a different bus and zeroes
    // drive and growl, so it is a different graph and not the same one twice.
    for (const channel of [undefined, 'ui']) {
      // ⚠ NEVER CLEARED. The bus graph (master, tv, ui, the reverb send) is built
      // ONCE when the context is created, so emptying the edge map between runs cuts
      // every voice after the first off from the speakers — the same trap
      // fm-smoke.mjs records about its own node list. Only the started list resets.
      started.length = 0;
      const label = seed + (channel ? ' (ui)' : '');
      let res = null, threw = null;
      try { res = A.speak('The Basin is quiet tonight. Is the door closed?', { seed, channel }); }
      catch (e) { threw = e; }
      check('graph: ' + label + ' speaks without throwing', !threw, threw && threw.stack);
      check('graph: ' + label + ' returns a duration', res && res.duration > 0, JSON.stringify(res));
      check('graph: ' + label + ' starts sources', started.length > 0, 'started ' + started.length);
      for (const src of started) {
        check('graph: ' + label + ' — ' + kinds.get(src) + '#' + src + ' reaches the speakers',
          arrives(src),
          'started, and leads neither to ctx.destination nor into any AudioParam');
      }
    }
  }
  A.cancelSpeech();
}

if (fails) { console.error(`\n✗ voice:smoke — ${fails} failure(s)`); process.exit(1); }
console.log('✓ voice:smoke clean.');
