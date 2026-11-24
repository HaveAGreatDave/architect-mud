// parley: turn a typed line into a discourse act, the way Façade did.
//
// Pure and sync. The text is normalised (lowercase, contractions spelled out, common
// typos fixed), then every act's patterns are scored against it. The best act wins;
// a topic is the NPC's own keyword list matched the same way. Nothing here is
// Coldwater: these are plain English patterns any game on THOMAS could use, and an
// NPC's topics come from its own `flags.parley.topics`.
//
// → { act, topic, confidence, question }

const CONTRACTIONS = [
  [/\bwon't\b/g, 'will not'], [/\bcan't\b/g, 'can not'], [/\bain't\b/g, 'is not'],
  [/n't\b/g, ' not'], [/'re\b/g, ' are'], [/'m\b/g, ' am'], [/'ll\b/g, ' will'],
  [/'ve\b/g, ' have'], [/'d\b/g, ' would'], [/\bit's\b/g, 'it is'], [/\bthat's\b/g, 'that is'],
  [/\bwhat's\b/g, 'what is'], [/\bhow's\b/g, 'how is'], [/\bwho's\b/g, 'who is'],
  [/\bwhere's\b/g, 'where is'], [/\bthere's\b/g, 'there is'], [/\blet's\b/g, 'let us'],
];
const TYPOS = {
  u: 'you', ur: 'your', r: 'are', ya: 'you', yer: 'your', thx: 'thanks', ty: 'thanks', pls: 'please',
  plz: 'please', hiya: 'hi', heya: 'hey', sup: 'what is up', wassup: 'what is up', whats: 'what is',
  hows: 'how is', im: 'i am', dont: 'do not', cant: 'can not', wont: 'will not', thanx: 'thanks',
  luv: 'love', gud: 'good', gr8: 'great', lol: 'haha', lmao: 'haha', ok: 'okay', k: 'okay', yep: 'yes',
  yup: 'yes', yeah: 'yes', nah: 'no', nope: 'no', cya: 'bye', ttyl: 'bye', soz: 'sorry', sry: 'sorry',
};

export function normalise(text) {
  let t = String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to);
  t = t.replace(/[^a-z0-9?!' ]+/g, ' ');
  t = t.split(/\s+/).filter(Boolean).map((w) => TYPOS[w] ?? w).join(' ');
  return t.trim();
}

const W = (words) => new RegExp(`\\b(?:${words})\\b`);

// Each act: [pattern, weight]. Weights near 1 are a clear read; lower ones are hints
// that lose to anything clearer. Order doesn't matter; the highest score wins and a
// tie goes to the act listed first.
export const ACTS = {
  insult: [
    [W('idiot|moron|stupid|dumb|ugly|loser|useless|pathetic|scum|creep|prick|twat|bastard|dick|asshole|arsehole|bitch|wanker|jerk|fool|clown|pig|trash|garbage|rubbish|loser|freak|shut up|piss off|fuck you|screw you|go to hell|nobody likes you'), 1],
    [/\byou (?:are|look|smell|stink)\b.*\b(?:bad|terrible|awful|horrible|disgusting|old|fat|sad|weird|boring)\b/, 0.9],
    [W('this place (?:sucks|stinks|is a dump)|what a dump|shithole'), 0.7],
    [/\b(?:hate|despise) you\b/, 1],
  ],
  flirt: [
    [W('sexy|gorgeous|handsome|cute|hot stuff|beautiful|good looking|date me|go out with me|kiss me|marry me|your place or mine|come here often|single|wink'), 0.95],
    [/\b(?:i )?(?:like|love|fancy) you\b/, 0.9],
    [/\byou (?:are|look) (?:lovely|nice|pretty|fine|stunning)\b/, 0.85],
  ],
  apologise: [[W('sorry|apologies|apologise|apologize|my bad|forgive me|i was wrong|did not mean'), 0.95]],
  thank: [[W('thanks|thank you|cheers|much obliged|appreciate it|ta'), 0.9]],
  praise: [
    [W('great|brilliant|excellent|amazing|wonderful|fantastic|lovely|nice place|good job|well done|perfect|best|classy|top notch|impressive|love this place|love it'), 0.75],
    [/\b(?:nice|good|great|clean)\b.*\b(?:bar|place|glass|drink|work|vest|lounge|book|taste)\b/, 0.8],
    [/\b(?:bar|place|glass|drink|work|vest|lounge|book|taste)\b.*\b(?:nice|good|great|clean|lovely|spotless)\b/, 0.8],
    [/\bnot (?:that |so )?bad\b/, 0.75],
    // "nice moustache", "love the wig": a compliment on whatever they're wearing or doing.
    [/^(?:nice|great|lovely|cool|good|smart|fancy|love the|love your|i like the|i like your) [a-z]+/, 0.7],
  ],
  greet: [
    [/^(?:hi|hello|hey|howdy|evening|morning|afternoon|good (?:morning|evening|afternoon|day)|greetings|yo|hiya|alright|oi)\b/, 0.95],
    [W('hello|hi there|hey there|good evening|good morning|nice to meet you|pleased to meet you'), 0.8],
  ],
  farewell: [[W('bye|goodbye|good night|goodnight|see you|see ya|later|so long|farewell|take care|i am off|i should go|got to go|gotta go'), 0.9]],
  ask_name: [[/\bwhat is your name\b|\bwho are you\b|\byour name\b|\bwhat do (?:they|people) call you\b|\bhave we met\b/, 0.95]],
  ask_job: [[/\bwhat do you do\b|\bwhat is your (?:job|work|line)\b|\bwhere do you work\b|\bwhat are you doing here\b|\bwhat is this job\b/, 0.9]],
  ask_origin: [[/\bwhere (?:are you|do you come|you) from\b|\bwhere did you grow up\b|\bare you (?:from|local)\b|\bhow long have you (?:been here|lived here)\b/, 0.9]],
  ask_news: [[/\b(?:any|got any|what is the|heard any) (?:news|gossip|rumou?rs?)\b|\bheard anything\b|\bwhat is going on\b|\banything (?:new|happening|interesting)\b|\bwhat is new\b/, 0.9]],
  ask_advice: [[/\b(?:any|got any|give me|need) (?:advice|tips?)\b|\bwhat should i do\b|\bwhat would you do\b|\bi am new\b|\bnew (?:here|in town)\b/, 0.9]],
  ask_feeling: [
    [/\bhow (?:are|is|have) (?:you|things|it going|your day|life|business|work)\b/, 0.95],
    [/\b(?:you|are you) (?:okay|alright|well|good|doing okay)\b/, 0.8],
    [/\bwhat is up\b|\bhow do you do\b|\brough (?:day|night|shift)\b|\blong (?:day|night|shift)\b/, 0.85],
  ],
  order_drink: [
    [/\b(?:can|could|may) i (?:get|have)\b|\bi(?: would|'d)? like (?:a|an|some)\b|\bpour me\b|\bget me (?:a|an|some)\b/, 0.85],
    [W('beer|whiskey|whisky|vodka|gin|rum|wine|pint|shot|cocktail|drink|another one|same again|a round|on the rocks|neat'), 0.7],
    [W('menu|what do you (?:have|serve|recommend)|what is good'), 0.6],
  ],
  // "and then?": carries on whatever story they're in the middle of (react.js beats).
  continue: [[/^(?:and then|then what|go on|keep going|tell me more|more|what happened next|what happened then|what next|and after that|really|seriously|wow|no way|what then)\b/, 0.8], [/^and ?[?!]*$/, 0.8]],
  joke: [[W('haha|hehe|joke|kidding|just messing|funny|knock knock|walks into a bar'), 0.8]],
  complain: [[W('too expensive|rip off|ripoff|overpriced|slow service|took forever|dirty|filthy|warm beer|watered down|not good enough|terrible service|bad service'), 0.85]],
  agree: [[/^(?:yes|sure|okay|right|agreed|true|exactly|of course|absolutely|definitely|fair enough|indeed|alright then)\b/, 0.7]],
  disagree: [[/^(?:no|not really|wrong|i doubt it|never|nonsense|rubbish|i do not think so|disagree)\b/, 0.7]],
};

const QUESTION = /\?\s*$|^(?:who|what|where|when|why|how|which|do|does|did|is|are|can|could|would|will|have|has)\b/;

// Topics are `{ id: [keyword, ...] }`. A keyword may be several words.
function topicOf(t, topics) {
  let best = null, bestLen = 0;
  for (const [id, words] of Object.entries(topics || {})) {
    for (const w of [].concat(words || [])) {
      const k = normalise(w);
      if (k && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t) && k.length > bestLen) {
        best = id; bestLen = k.length;
      }
    }
  }
  return best;
}

export function parse(text, { topics = null, names = [] } = {}) {
  let t = normalise(text);
  // The NPC's own name is an address, not content: "hey lowry" is a greeting.
  for (const n of names) {
    const k = normalise(n);
    if (k) t = t.replace(new RegExp(`\\b${k}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  }
  const question = QUESTION.test(t) || /\?/.test(String(text));
  const topic = topicOf(t, topics);
  let act = null, confidence = 0;
  for (const [name, pats] of Object.entries(ACTS)) {
    for (const [re, w] of pats) {
      if (w > confidence && re.test(t)) { act = name; confidence = w; }
    }
  }
  // "not bad" and "not great" read the opposite way round to their words.
  if (act === 'praise' && /\bnot (?:so |very |that )?(?:great|good|nice|brilliant|amazing|lovely)\b/.test(t)) { act = 'complain'; confidence = 0.6; }
  if (act === 'insult' && /\bnot (?:that |so )?bad\b/.test(t)) { act = 'praise'; confidence = 0.6; }
  // A question about one of their topics is asking about it, unless something
  // clearer (an insult, a flirt) is in the same line.
  if (topic && (!act || confidence < 0.9) && (question || !act)) { act = 'ask_about'; confidence = Math.max(confidence, 0.75); }
  if (!act) {
    const letters = t.replace(/[^a-z]/g, '');
    const vowels = (letters.match(/[aeiouy]/g) || []).length;
    act = !letters || vowels / letters.length < 0.2 || /(.)\1{3,}/.test(letters) ? 'gibberish' : 'unknown';
    confidence = 0;
  }
  return { act, topic, confidence, question, text: t, raw: String(text || '') };
}
