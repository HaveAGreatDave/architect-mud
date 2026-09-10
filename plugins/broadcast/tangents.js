// ── Tangents: going off script, at length ─────────────────────────────────────
//
// The delivery layer in index.js degrades a line: it slurs, stalls, and cuts to a
// single generic aside. What it cannot do is LOSE A THREAD, because it works one
// line at a time and knows nothing about what was being said. A host three drinks
// in does not mangle six consecutive sentences and then read the seventh cleanly —
// he abandons the seventh entirely and talks about his ex-wife for a minute.
//
// So a tangent is a RUN of lines, not a line: several beats that leave the script
// behind, and (if anyone else is on the floor) a co-host trying to reel him in.
// Three rules shape it.
//
// **A tangent belongs to a person, not to a state.** The house pools below exist
// so an unauthored NPC still works, but they are the floor, not the intent — the
// point of the feature is `flags.tangents`, which is where a character's own
// obsessions live. Authored REPLACES the house pool for that state (the same rule
// `delivery_lines` already uses in index.js): a host given three tangents of his
// own should be heard on those three, not on those three diluted by the generic
// set.
//
// **The tangent is keyed to what they are ON.** A stimulant tangent is a man with
// a plan talking too fast; a cannabis tangent wanders and is happy about it; a
// deliriant tangent is about who is in the room. Same seam, same beats, entirely
// different television — which is why the pools are keyed by the `_DELIVERY` state
// name rather than by a single "impaired" flag.
//
// **The co-host's lines are the CO-HOST's.** The wrangle is dialogue, so it is
// spoken by a named second person who is standing there, garbled by their OWN
// impairment (a sober producer reads clean while the host slurs), and authorable
// on them via `flags.wrangle_lines`. With nobody else on the floor there is no
// wrangle at all and the tangent simply runs itself out, which is the correct and
// much bleaker version of the same scene.
//
// This module is deliberately pure — no engine imports, no world reads. It is
// handed the NPC rows it needs and returns plain data, so the regress suite can
// drive it with object literals.

// A tangent is an ARRAY OF LINES, and stays one: the lines in a run are written to
// follow each other, so the pools hold whole runs and one is picked entire. A flat
// pool of individual lines shuffled together is how you get a man who mentions his
// divorce, then a coupon, then his divorce again, which reads as a bug rather than
// as a digression.
export const TANGENT_POOLS = {
  // Drink, and the depressant family that reads like it. The thread is lost
  // downhill: grievance, then the person, then the admission.
  drunk: [
    ["...you know what, no. No, I want to say something.",
     "I've done this show a long time. A long time. Longer than some of you have been alive.",
     "And not one person has ever asked me if I'm alright. Not one.",
     "...anyway."],
    ["...she used to watch this, you know.",
     "Every week. Sat right there off camera with a cup of tea going cold.",
     "I'd do the whole thing to her and not to the lens. You can probably tell, watching the old ones.",
     "I don't know why I said that."],
  ],
  loose: [
    ["...hang on, hang on. Who decided this order? Who decided we do it like this.",
     "Because I've been doing it in this order for years and nobody's ever once explained it to me.",
     "It might be wrong. It might have been wrong the entire time.",
     "That would be something, wouldn't it."],
    ["...I'll tell you what nobody tells you.",
     "Nobody tells you it just carries on. The show. Every week, same time, whatever's happened to you.",
     "Which is good. I'm not saying it isn't good. It's the only thing that does.",
     "...where were we."],
  ],
  // Stimulants. Not lost — LAUNCHED. The problem is he has nine of these and the
  // show is thirty minutes long.
  wired: [
    ["...okay, and this is actually the thing I wanted to talk about, forget the card,",
     "I've been up on this for a while now and I think I've genuinely got it.",
     "You do the whole show live. No cuts. Two hours, three, whatever it takes. People would watch that.",
     "They would. They'd watch it because it could go wrong. That's the product. The going wrong IS the product.",
     "I've got about six more of these."],
    ["...no, because everyone's doing the same show, that's the issue, everyone is doing the SAME SHOW.",
     "And I've said this, I've said it to people who could do something about it, and they look at me like I'm the problem.",
     "I'm not the problem. I'm the only one who's noticed.",
     "Write that down, actually. Somebody write that down."],
  ],
  // Cannabis. Nothing is wrong. It just goes somewhere else and stays there.
  mellow: [
    ["...sorry, sorry, but who eats the ones at the bottom?",
     "Of the tin. The ones at the bottom. Somebody's job is to put those in there and somebody eats them.",
     "That's a whole life, that. Start to finish.",
     "...that's beautiful, actually. Don't laugh."],
    ["...is it strange that we do this into a lens?",
     "There's nobody there. There's a lens. And then there's, what, thousands of people. Separately. All on their own.",
     "So it's the least lonely thing and the most lonely thing at the same time.",
     "Hm."],
  ],
  // Psychedelics. Delighted, and reading a different document.
  tripping: [
    ["...I want to say something to whoever's watching this on their own right now.",
     "You're not doing it wrong. I want you to know that. Whatever it is, you're not doing it wrong.",
     "The lights are unbelievable, by the way. Has anyone told the lighting people?",
     "Somebody should tell them. They've done something extraordinary in here."],
    ["...none of these words mean anything, do they. Say one twice and it stops meaning it.",
     "Try it. Any of them. Try 'programme'.",
     "See? It's gone. It's just a noise now and we've all agreed on it.",
     "That's what everything is. We've all just agreed."],
  ],
  // Dissociatives. He arrives at the tangent late and from a long way off.
  dissociated: [
    ["...how long have I been talking.",
     "No, genuinely. I'd like somebody to tell me how long I've been talking for.",
     "Because I can hear it. I can hear myself doing it. It just isn't very close.",
     "..."],
  ],
  // Deliriants. The tangent is about the room, and it is not a metaphor.
  paranoid: [
    ["...who's that behind the second unit. There's somebody behind the second unit.",
     "No, don't turn it. Don't turn it, leave it exactly where it is.",
     "I've been on this floor nine years and I know every person who is meant to be on it.",
     "Somebody let somebody in."],
  ],
  // The mean drunk. The tangent is an accusation, and it has a target in the room.
  belligerent: [
    ["...no, actually. Actually, let's do this now.",
     "Which one of you writes this? Because whoever writes this doesn't like me. That's clear.",
     "You put words in my mouth every week and then you stand there with your face doing that.",
     "Don't. Don't do the face."],
  ],
  // Not high any more. The tangent is the wheels coming off in the other direction.
  comedown: [
    ["...can I be honest for a second. Just for a second.",
     "I don't feel well. I haven't felt well since about four o'clock.",
     "I'll do the show. I'm going to do the show. I just wanted to say it out loud once.",
     "Right."],
  ],
};

// The co-host, trying to get the show back. Three registers, because the same line
// four times is a man reading a card and not a man losing patience — polite first,
// then flat, then a hand physically on the desk.
export const WRANGLE_POOLS = {
  early: [
    // Never a NAME in the house pools: these are read by whoever happens to be
    // standing on the floor of whichever show, and a default that says "Neil" is
    // one character's dialogue wearing a generic pool's clothes.
    'Hey. Hey. The card.',
    "We've got a card for this bit.",
    'Come back to me. Come back to the card.',
    "Let's park that.",
  ],
  late: [
    "You're doing it again. You know you're doing it.",
    "That's not on the card and you know it's not on the card.",
    'Nobody at home knows what any of this is about.',
    'Wrap it. Wrap it up.',
  ],
  // The one that ends it. Always the last beat, always a return to the running order.
  recover: [
    "Right. Top ten. You were on the top ten.",
    "We're going to the break. We're going to the break now.",
    "Read the next one. Just read the next one and we're square.",
    "Back on it. From the top of that page.",
  ],
};

// Which states can lose the thread at all. `lucid` is deliberately absent — a
// nootropic reads BETTER than sober, and a man who is sharper than usual does not
// wander off. An unknown state gets nothing rather than the generic pool, so a new
// delivery state has to decide what its tangent sounds like instead of inheriting
// somebody else's.
export const canTangent = (state) => !!(state && TANGENT_POOLS[state]);

const pickFrom = (arr, rand) => (arr && arr.length ? arr[Math.floor(rand() * arr.length)] : null);

/**
 * The runs available to this NPC in this state.
 *
 * Authoring seam, mirroring `delivery_lines` exactly —
 *
 *   "tangents": {
 *     "loose": [ ["line one", "line two", "line three"] ],
 *     "any":   [ ["a run they'd go on whatever they're on"] ]
 *   }
 *
 * Authored runs REPLACE the house pool for that state. `any` is the catch-all and
 * is only consulted when the state itself is unauthored, so writing one bespoke
 * drunk tangent doesn't silently disable the character on everything else.
 */
export function tangentRuns(npc, state) {
  const authored = npc?.flags?.tangents;
  const own = authored && (authored[state] || authored.any);
  if (Array.isArray(own) && own.length) return own;
  return TANGENT_POOLS[state] || [];
}

// A run may declare what it is ABOUT (`{ lines: [...], topic: 'divorce' }`), and a
// bare array is the same thing with no topic. Normalised in one place so every
// caller sees the same shape and neither form is the special case.
const runLines = (run) => (Array.isArray(run) ? run : (Array.isArray(run?.lines) ? run.lines : []));
const runTopic = (run) => (Array.isArray(run) ? null : (run?.topic || null));

/**
 * The co-host's line for one register, for one topic.
 *
 * ⚠ **A run declares its topic; it never supplies the interruption.** The obvious
 * shortcut is to let the host's run carry the co-host's lines, and it is wrong for
 * the reason the whole wrangle half exists: those words belong to a second person
 * standing on the floor, and authoring them on the host puts his dialogue in
 * somebody else's mouth. So the run says only what it is ABOUT, and the co-host
 * decides whether he has anything specific to say about that.
 *
 * Without it, a producer with one good topical line reads it at random over every
 * tangent — "nobody is watching this for your divorce" landing on a bit about
 * coffee, which is worse than the generic line it displaced.
 *
 *   "wrangle_lines": {
 *     "divorce": { "late": ["This is the pans again. Every week it's the pans."] },
 *     "late":    ["...the register default, for a tangent about anything else"]
 *   }
 *
 * Falls through topic → register → `any` → house, so a topic nobody has written
 * for is simply an ordinary tangent rather than a silent one.
 */
export function wrangleLines(npc, register, topic = null) {
  const own = npc?.flags?.wrangle_lines;
  const topical = topic && own?.[topic]?.[register];
  if (Array.isArray(topical) && topical.length) return topical;
  const set = own && (own[register] || own.any);
  if (Array.isArray(set) && set.length) return set;
  return WRANGLE_POOLS[register] || [];
}

/**
 * Build the beat list for one tangent, or null if there is nothing to say.
 *
 * `cohost` is optional and its ABSENCE is a supported piece of television: with an
 * empty studio floor the run plays out with nobody interrupting and nobody bringing
 * it back, and the show returns to script only because the man ran out of words.
 */
export function buildTangent({ host, cohost, cohosts, state, rand = Math.random }) {
  const runs = tangentRuns(host, state);
  const run = pickFrom(runs, rand);
  const lines = runLines(run);
  const topic = runTopic(run);
  if (!lines.length) return null;

  // WHO WRANGLES IS DECIDED BY THE RUN, not by who happens to be standing closest.
  // A floor with more than one other person on it is the normal case for a show with
  // a producer AND a mate on a barstool, and picking the first present body means the
  // sober one and the enabler are interchangeable — which is the entire distinction
  // between those two characters. So: whoever has something to say about THIS topic,
  // then whoever has any authored voice at all, then anyone.
  const pool = (Array.isArray(cohosts) && cohosts.length) ? cohosts : (cohost ? [cohost] : []);
  cohost = pool.find(c => topic && c?.flags?.wrangle_lines?.[topic])
        || pool.find(c => c?.flags?.wrangle_lines)
        || pool[0] || null;

  const beats = [];
  lines.forEach((text, i) => {
    beats.push({ who: 'host', text });
    // The interruption lands INSIDE the run rather than after it — a producer who
    // waits politely for the end of the digression is not wrangling anybody. Every
    // other line, and never after the last one, which the recover beat owns.
    if (cohost && i % 2 === 1 && i < lines.length - 1) {
      const register = i >= 3 ? 'late' : 'early';
      const text2 = pickFrom(wrangleLines(cohost, register, topic), rand);
      if (text2) beats.push({ who: 'cohost', text: text2 });
    }
  });
  if (cohost) {
    const text = pickFrom(wrangleLines(cohost, 'recover', topic), rand);
    if (text) beats.push({ who: 'cohost', text });
  }
  return { beats, i: 0, state, topic, hostId: host?.id || null, cohostId: cohost?.id || null };
}

// How long one beat holds. Length-scaled like a scripted line, so a four-word
// interjection doesn't sit on screen as long as a sentence.
export const tangentHoldMs = (text) =>
  Math.max(2200, Math.min(7000, 1500 + String(text || '').length * 45));

export const _tangentTest = { pickFrom, runLines, runTopic };
