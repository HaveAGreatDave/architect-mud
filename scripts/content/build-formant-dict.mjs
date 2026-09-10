// build-formant-dict — regenerate client/shared/formant-cmudict.js from upstream
// CMUdict, WITH lexical stress.
//
//   node scripts/content/build-formant-dict.mjs
//
// WHY A SCRIPT AND NOT HAND-AUTHORED DATA: same rule as fetch-books.mjs. This is
// bulk data with a known upstream, so the repo stores the RESULT (committed,
// deterministic, reviewable) and the derivation stays reproducible. It is
// idempotent — re-running writes the same file from the same source.
//
// WHY IT EXISTS AT ALL: the original formant-cmudict.js was committed as a blob
// with no generator, and its phone set was STRESS-STRIPPED. English is
// stress-timed — stressed syllables are longer, louder and higher, and unstressed
// ones collapse toward schwa — so a synth with no stress data has to guess from
// spelling. The guesser in audio-engine.js is decent and still runs for any word
// the dictionary doesn't have, but it gets `banana` wrong and always will.
// Carrying the two bits CMUdict already knows is strictly better.
//
// SOURCE: cmusphinx/cmudict (cmudict.dict). CMUdict is distributed under a
// permissive BSD-style licence that allows redistribution in source or binary
// form with attribution — hence the attribution header written into the output.
//
// THE WORD LIST IS NEVER RE-CHOSEN, ONLY ADDED TO. The original subset was curated
// (upstream is ~134k entries, most of them proper nouns and inflected junk a
// narrator will never say) and the whole file is shipped to every client on load,
// so this script re-looks-up the SAME words rather than re-deriving the cut. A
// regeneration must not silently change what the browser downloads.
//
// Two explicit additions sit on top of that, each with its reason below: EXTRA
// (contractions) and gameWords() (this game's own vocabulary). The second is why
// "preserved exactly" is no longer the right description — the curation's rule
// about proper nouns is correct for a generic narrator and wrong for one who says
// `Delacroix` and `Coldwater` all day. Both are reported when the script runs, and
// the output is committed, so an addition shows up in a diff rather than silently.
//
// ENCODING: one character per phone, indexed into `alpha`. Vowels now carry their
// stress digit, so the token set grows from 39 to 69 (15 vowels × 3 stress levels
// + 24 consonants) — but the blob is the same LENGTH, because it is still exactly
// one character per phone. The file size does not move.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'client', 'shared', 'formant-cmudict.js');
const SRC = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict';

const VOWELS = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'];
const CONSONANTS = ['B','CH','D','DH','F','G','HH','JH','K','L','M','N','NG','P','R','S','SH','T','TH','V','W','Y','Z','ZH'];

// Safe single-byte alphabet: no space (the blob's field separator), no newline
// (its record separator), no quote or backslash (it goes through a JS string).
const ALPHA = ('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
               '!#$%&()*+,-./:;<=>?@[]^_{|}~').split('');

// Recover the existing word list from the file we are about to overwrite.
async function existingWords() {
  const src = await readFile(OUT, 'utf8');
  const sandbox = {};
  new Function('window', src)(sandbox);
  const blob = sandbox.CMUDICT?.blob;
  if (!blob) throw new Error('could not read CMUDICT.blob from the existing file');
  return blob.split('\n').filter(Boolean).map(l => l.slice(0, l.indexOf(' ')));
}

// CONTRACTIONS. The original subset contained almost none of these, so every one
// of them fell through to the letter-guesser — which has no idea what an apostrophe
// means and mangled the most common words in English: "they're" came out with a
// voiceless TH as "thee-r", "don't" as "dahnt", "i'm" as "im", "you're" as "yowr".
// Upstream has them all, correctly. They are added explicitly rather than by
// widening the frequency cut, so the subset stays curated and the diff stays small.
const EXTRA = `
i'm i'll i've i'd you're you'll you've you'd we're we'll we've we'd they're they'll
they've they'd he's he'll he'd she's she'll she'd it's it'll that's that'll there's
here's what's who's where's when's how's let's y'all o'clock ma'am
don't doesn't didn't won't wouldn't can't cannot couldn't shouldn't mustn't
isn't aren't wasn't weren't hasn't haven't hadn't ain't needn't
`.trim().split(/\s+/);

// THE GAME'S OWN VOCABULARY. The curated subset was chosen as "common English
// minus junk" — and upstream is ~134k entries, "most of them proper nouns the
// narrator will never say". That reasoning is right for a generic narrator and
// wrong for this one, who says these proper nouns constantly: 32% of the words in
// the game's names and descriptions were absent, so every character name in the
// game went through the letter-to-sound guesser.
//
// Descriptions and not just names, because READ ALOUD SPEAKS THE WHOLE LOG. The
// words most likely to be mispronounced are the ones in room prose, to the player
// who most depends on the voice working.
//
// Only words upstream actually HAS are added (the intersection happens for free
// below — an unknown word simply finds no entry). The rest are true coinages that
// no dictionary can help with: `marrick`, `kesh`, `slagworks`, `everydayman`.
async function gameWords() {
  const dir = join(ROOT, 'content');
  const out = new Set();
  let kinds = [];
  try { kinds = await readdir(dir); } catch { return out; }
  for (const kind of kinds) {
    let files = [];
    try { files = await readdir(join(dir, kind)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      let row;
      try { row = JSON.parse(await readFile(join(dir, kind, f), 'utf8')); } catch { continue; }
      for (const key of ['name', 'description']) {
        const v = row?.[key];
        if (typeof v !== 'string') continue;
        for (const part of v.split(/[^A-Za-z'’-]+/)) {
          // Strip a possessive and any leading/trailing punctuation, then keep
          // only things that look like words — CMUdict is keyed lower-case.
          const w = part.replace(/[’']s$/, '').replace(/^[-']+|[-']+$/g, '').toLowerCase();
          if (/^[a-z][a-z'-]{2,}$/.test(w)) out.add(w);
        }
      }
    }
  }
  return out;
}

async function main() {
  const words = await existingWords();
  const before = words.length;
  const have = new Set(words);
  for (const w of EXTRA) if (!have.has(w)) { words.push(w); have.add(w); }
  console.log(`· preserving ${before} words from the existing subset (+${words.length - before} contractions)`);

  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`cmudict fetch failed: ${res.status}`);
  const raw = await res.text();

  // Parse. Alternate pronunciations are "word(2) ..." — the first entry wins,
  // which is what the old stress-stripped file did too.
  const dict = new Map();
  for (const line of raw.split('\n')) {
    const clean = line.split('#')[0].trim();
    if (!clean) continue;
    const sp = clean.indexOf(' ');
    if (sp < 0) continue;
    const w = clean.slice(0, sp);
    if (w.includes('(')) continue;                 // skip alternates
    if (!dict.has(w)) dict.set(w, clean.slice(sp + 1).trim().split(/\s+/));
  }
  console.log(`· upstream carries ${dict.size} base entries`);

  // Add the game's own vocabulary, intersected with upstream by construction:
  // a word the dictionary does not carry finds no entry and is skipped here, so
  // coinages never reach the encoder and never inflate the `missing` count below.
  //
  // Sorted, so the blob stays byte-deterministic across rebuilds. Reported rather
  // than silent — the file ships to every client on load, and the rule this script
  // was written under is that a regeneration must never quietly change what the
  // browser downloads. A content edit CAN change this set, which is exactly why
  // the count is printed and the result is committed.
  const game = await gameWords();
  const added = [];
  for (const w of [...game].sort()) {
    if (have.has(w) || !dict.has(w)) continue;
    words.push(w); have.add(w); added.push(w);
  }
  const coinages = [...game].filter(w => !dict.has(w) && !have.has(w)).length;
  console.log(`· game vocabulary: ${game.size} words, +${added.length} recovered from upstream, ` +
    `${coinages} coinages left to the guesser`);
  if (process.argv.includes('--list-added')) console.log(added.join(' '));

  // Token set: vowels keep their stress digit, consonants don't have one.
  const phones = [];
  for (const v of VOWELS) for (const s of ['0','1','2']) phones.push(v + s);
  phones.push(...CONSONANTS);
  if (phones.length > ALPHA.length) throw new Error('alphabet too small');
  const alpha = ALPHA.slice(0, phones.length).join('');
  const index = new Map(phones.map((p, i) => [p, i]));

  const out = [];
  let missing = 0, unknown = 0;
  for (const w of words) {
    const ph = dict.get(w);
    if (!ph) { missing++; continue; }
    let enc = '';
    let bad = false;
    for (const tok of ph) {
      const i = index.get(tok);
      if (i === undefined) { bad = true; break; }
      enc += alpha[i];
    }
    if (bad) { unknown++; continue; }
    out.push(w + ' ' + enc);
  }
  if (missing) console.log(`· ${missing} word(s) no longer in upstream — dropped`);
  if (unknown) console.log(`· ${unknown} word(s) used an unrecognised phone — dropped`);
  if (out.length < words.length * 0.98) {
    throw new Error(`kept only ${out.length}/${words.length} words — refusing to write a gutted dictionary`);
  }

  const header =
`// GENERATED — do not edit by hand. Rebuild with:
//   node scripts/content/build-formant-dict.mjs
//
// A ${out.length}-word subset of CMUdict, WITH lexical stress, encoded one
// character per phone. Consumed by the formant synth in audio-engine.js.
//
// Vowel tokens carry their stress digit: 0 unstressed, 1 primary, 2 secondary.
// AH0 is CMUdict's schwa and the synth maps it straight onto its AX phone; the
// other 0-stress vowels keep their quality (the vowel in "happy" is reduced in
// stress but not in colour) and lose only length and loudness.
//
// CMUdict is Copyright (C) 1993-2015 Carnegie Mellon University, redistributed
// under its BSD-style licence: use in source and binary forms, with or without
// modification, is permitted provided this notice is retained.
`;
  const body = 'window.CMUDICT = ' + JSON.stringify({ phones, alpha, blob: out.join('\n') }) + ';\n';
  await writeFile(OUT, header + body, 'utf8');

  const stressed = out.filter(l => {
    const enc = l.slice(l.indexOf(' ') + 1);
    return [...enc].some(ch => phones[alpha.indexOf(ch)].endsWith('1'));
  }).length;
  console.log(`✓ ${out.length} words (${stressed} carrying a primary stress), ${phones.length} tokens → ${OUT}`);
}

await main();
