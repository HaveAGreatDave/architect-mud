// Turning a speech transcript into a command.
//
// This is the whole feature. The recognizer half (client/game/js/dictation.js)
// is twenty lines of Web Speech API boilerplate; the difficulty is that general
// ASR is trained on English prose and this game's input is terse jargon. Nobody
// dictates "wield rusty pipe" and gets it back — they get "field rusty pipe".
// Say a bare "n" and you get "in", "and", "an", or "en", never the letter. So a
// mic button without this layer is a feature that works beautifully in a demo
// and is useless to the person it was built for.
//
// Pure functions, no DOM, no imports — which is what lets scripts/a11y/
// dictation-smoke.mjs drive the real thing in Node rather than a copy of it.
// Same reasoning as a11y-command.js's relative import: the code that runs must
// be the code that's tested, because this is somebody's only way to play.
//
// Three rules shape everything below.
//
//   1. AGGRESSIVE ON ONE TOKEN, CAUTIOUS ON MANY. A lone utterance is almost
//      certainly a direction or a bare verb, so "in" can safely become `n`. The
//      same word inside a longer sentence ("put the coat in the locker") must be
//      left completely alone. Nearly every mapping here is therefore gated on
//      the utterance being a single token — that gate is what stops the layer
//      from mangling the sentences it was meant to help with.
//
//   2. THE VOCABULARY IS LIVE, NOT LISTED. Item and target names come from what
//      is actually in the room and in your hands, passed in as `ctx.nouns`. A
//      static noun list would be a second copy of the world's content, and would
//      be wrong the day after it was written.
//
//   3. NEVER INVENT. Anything unmatched passes through verbatim so the server
//      answers `Unknown command` exactly as it would for a typo. A normalizer
//      that guesses is worse than one that gives up, because a guess that lands
//      on a real verb runs it.
//
// See docs/systems-accessibility.md.

// ── Verbs that are never auto-sent ──────────────────────────────────────────
//
// Even with Auto-send on, these fill the input box and wait for Enter. The
// asymmetry isn't close: the cost of the guard is one keypress, and the cost of
// a mishearing is your rifle on the floor of the Under, your credits in a
// stranger's account, or a fight you didn't pick. "give" and "drop" in
// particular are one phoneme from words you would say in ordinary conversation.
//
// This is a set of first tokens, matched after normalization.
export const GUARDED_VERBS = new Set([
  'drop', 'give', 'sell', 'buy', 'pay', 'trade', 'transfer', 'withdraw', 'deposit',
  'attack', 'kill', 'shoot', 'fire', 'airfire', 'execute', 'cosh',
  'eat', 'drink', 'inject', 'snort', 'smoke', 'use', 'consume',
  'quit', 'signout', 'logout', 'sleep', 'delete', 'abandon', 'destroy',
  'rent', 'evict', 'unequip', 'remove',
]);

// ── Verbs whose arguments are free text ─────────────────────────────────────
//
// Everything after these is a sentence a human wrote, not a noun to be snapped
// to something in the room. Running the noun matcher over `say meet me at the
// bar` would happily rewrite half of it into inventory items.
export const FREE_TEXT_VERBS = new Set([
  'say', 'shout', 'yell', 'whisper', 'tell', 'ooc', 'emote', 'me', 'echo',
  'chat', 'radio', 'note', 'describe', 'macro',
]);

// ── Single-token utterances ─────────────────────────────────────────────────
//
// What the recognizer actually returns for each. These are not clever guesses;
// they are what testing a phone against the eight compass directions produces.
// Only ever applied when the utterance is ONE token (rule 1).
const SINGLE_TOKEN = {
  // north — the letter n is the worst case in the whole game, because every
  // common English filler word sounds like it.
  in: 'n', and: 'n', an: 'n', en: 'n', inn: 'n', north: 'n',
  // south
  es: 's', ess: 's', south: 's',
  // east
  e: 'e', ee: 'e', east: 'e',
  // west
  w: 'w', west: 'w',
  // the diagonals, which ASR renders as words far more often than as letters
  ne: 'ne', northeast: 'ne',
  nw: 'nw', northwest: 'nw',
  se: 'se', southeast: 'se', sell: 'se', tell: 'se', essay: 'se',
  sw: 'sw', southwest: 'sw', swear: 'sw',
  // vertical + the bare verbs people say on their own
  up: 'up', down: 'down', out: 'out',
  look: 'look', looked: 'look', luke: 'look',
  inventory: 'i', inventor: 'i',
  wait: 'wait', weight: 'wait',
  score: 'score', scorer: 'score',
  rest: 'rest', wrest: 'rest',
  stand: 'stand', stands: 'stand',
  sit: 'sit', set: 'sit',
  flee: 'flee', flea: 'flee',
  stop: 'stop',
  help: 'help', held: 'help',
};

// ── Multi-word phrases, replaced before anything else ───────────────────────
//
// Longest match wins, so `go north east` reaches `ne` rather than stopping at
// `n`. These are safe unanchored because each is a phrase nobody types as part
// of a longer command.
const PHRASES = [
  ['go north east', 'ne'], ['go north west', 'nw'],
  ['go south east', 'se'], ['go south west', 'sw'],
  ['north east', 'ne'], ['north west', 'nw'],
  ['south east', 'se'], ['south west', 'sw'],
  ['go north', 'n'], ['go south', 's'], ['go east', 'e'], ['go west', 'w'],
  ['go up', 'up'], ['go down', 'down'], ['go out', 'out'],
  ['pick up', 'get'], ['look at', 'examine'],
  ['open pack', 'openpack'], ['shop list', 'shoplist'], ['air fire', 'airfire'],
  ['display mode', 'displaymode'], ['tablet nav', 'tabletnav'],
  ['auto walk', 'auto'],
  // Spelling out a compass letter. "w" is the only one that isn't a syllable,
  // so it is the only one that comes back as two words.
  ['double you', 'w'], ['double u', 'w'],
];

// ── First-token verb repairs ────────────────────────────────────────────────
//
// Applied to token 1 of a multi-token utterance. Every entry here is a word the
// recognizer prefers because it is commoner in English than the game's verb is.
const VERB_ALIASES = {
  field: 'wield', filled: 'wield', yield: 'wield', wielded: 'wield',
  where: 'wear', ware: 'wear', we: 'wear',
  gets: 'get', got: 'get', guest: 'get',
  drops: 'drop',
  examined: 'examine', exam: 'examine', inspect: 'examine',
  x: 'examine', ex: 'examine',
  attacked: 'attack', attach: 'attack',
  tock: 'talk', tuck: 'talk', torque: 'talk',
  bye: 'buy', by: 'buy',
  cell: 'sell',
  reed: 'read', red: 'read',
  hunt: 'hand',
  putt: 'put',
  serge: 'search', surge: 'search',
  climbed: 'climb',
  scream: 'scan',
  poor: 'pour',
  aim: 'aim',
  lite: 'light', right: 'light',
};

// ── Text hygiene ────────────────────────────────────────────────────────────
//
// Recognizers capitalize, punctuate, and sometimes hand back a trailing period
// even for one word. Commands are lowercase and unpunctuated, so all of it goes
// — except the apostrophe, which survives inside a word so `bishop's` still
// matches an authored name.
function tidy(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[.,!?;:"“”]/g, ' ')
    .replace(/['’](?![a-z])/g, ' ')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Edit distance capped at 1 — enough to forgive a dropped or doubled letter,
// and cheap because it bails the moment a second difference appears. Anything
// looser starts matching genuinely different words to each other.
function near(a, b) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.length - s.length > 1) return false;
  let i = 0, j = 0, slips = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (s.length === l.length) { i++; j++; } else { j++; }
  }
  return slips + (l.length - j) + (s.length - i) <= 1;
}

// How well one candidate name from the live vocabulary explains what was heard.
// Scored as the fraction of the HEARD words the candidate accounts for, not the
// other way round — so "pipe" scores 1.0 against "rusty pipe".
//
// That direction is deliberate and it is worth saying why, because the obvious
// choice is the other one. A partial name is not a problem this layer has to
// solve: `wield pipe` is already valid input, resolved by the server's own SIFT
// target matcher. What this layer is for is words the recognizer got WRONG. So
// the question to ask of a candidate is "does it account for what I heard",
// which forgives a short reference and still refuses a phrase full of words the
// candidate has nothing to do with — the sentence case that rule 1 protects.
function scoreNoun(heardWords, candidate) {
  const cw = tidy(candidate).split(' ').filter(Boolean);
  if (!cw.length || !heardWords.length) return 0;
  let hit = 0;
  for (const h of heardWords) if (cw.some(c => near(h, c))) hit++;
  return hit / heardWords.length;
}

// The live vocabulary, matched against the argument half of the utterance.
// Returns null unless one candidate is both good enough AND clearly ahead of
// the runner-up — an ambiguous match is left alone rather than resolved by
// coin-flip, because picking the wrong one of two similar items is exactly the
// failure this whole layer exists to avoid.
function snapNoun(argWords, nouns) {
  if (!argWords.length || !nouns || !nouns.length) return null;
  let best = null, bestScore = 0, runnerUp = 0;
  for (const n of nouns) {
    const s = scoreNoun(argWords, n);
    if (s > bestScore) { runnerUp = bestScore; bestScore = s; best = n; }
    else if (s > runnerUp) runnerUp = s;
  }
  if (bestScore < 0.6) return null;
  if (bestScore === runnerUp) return null;
  return tidy(best);
}

/**
 * Normalize one speech transcript into a command line.
 *
 * @param {string} raw           what the recognizer heard
 * @param {object} ctx
 * @param {string[]} ctx.nouns   live vocabulary — item/NPC/exit names currently
 *                               in the room, the smartbar and your inventory
 * @returns {{ text: string, guarded: boolean, changed: boolean }}
 *          `text` is what goes in the input box; `guarded` means it must never
 *          be auto-sent; `changed` means this layer altered what was heard,
 *          which the caller shows so a wrong repair is visible rather than
 *          mysterious.
 */
export function normalizeDictation(raw, ctx = {}) {
  const heard = tidy(raw);
  if (!heard) return { text: '', guarded: false, changed: false };

  // Phrases first (rule 1's longest-match half), so `go north east` never gets
  // decided one word at a time.
  let text = heard;
  for (const [from, to] of PHRASES) {
    if (text === from) { text = to; break; }
    if (text.startsWith(from + ' ')) { text = to + text.slice(from.length); break; }
  }

  let tokens = text.split(' ').filter(Boolean);

  // A single token is almost certainly a direction or a bare verb, and is the
  // one place it is safe to be aggressive.
  if (tokens.length === 1) {
    const one = SINGLE_TOKEN[tokens[0]];
    if (one) tokens = one.split(' ');
  } else if (VERB_ALIASES[tokens[0]]) {
    tokens[0] = VERB_ALIASES[tokens[0]];
  }

  const verb = tokens[0];

  // Free-text verbs keep their arguments exactly as spoken. This is the whole
  // reason `say` works at all — it is the one place ordinary English is the
  // correct input, and the noun matcher would eat it.
  if (!FREE_TEXT_VERBS.has(verb) && tokens.length > 1) {
    // Drop the articles ASR loves and the game never wants, then try the live
    // vocabulary. A failed match leaves the words alone (rule 3).
    const argWords = tokens.slice(1).filter(w => w !== 'the' && w !== 'a' && w !== 'an');
    const snapped = snapNoun(argWords, ctx.nouns);
    tokens = [verb, ...(snapped ? snapped.split(' ') : argWords)];
  }

  const out = tokens.join(' ').trim();
  return {
    text: out,
    guarded: GUARDED_VERBS.has(tokens[0]),
    changed: out !== heard,
  };
}
