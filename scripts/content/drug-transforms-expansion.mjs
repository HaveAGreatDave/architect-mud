/**
 * MORE FOR THE ROOM TO TURN INTO.
 *
 *   node scripts/content/drug-transforms-expansion.mjs [--check]
 *
 * `drug_transforms` had 82 rows across four pools — blotter, mescaline,
 * psilocybin and the shared ANY set. The three named pools are rich; the ANY
 * pool is what every OTHER transform-mode drug draws from, and at 20 rows
 * (9 object, 7 person, 1 room, 2 spawn, 1 weather) it was thin enough that a
 * long trip on anything unauthored met the same handful of things twice.
 *
 * This widens the SHARED pool rather than adding a fifth named one, which is
 * the higher-leverage half: everything that trips on an unauthored psychedelic
 * gets it, including drugs nobody has written yet.
 *
 * ── WHAT A TRANSFORM IS, AND WHAT IT IS NOT ─────────────────────────────────
 *
 * A transform RE-READS what is there. It is not a monster and not a threat:
 * `plugins/trip` dresses two or three real pieces of furniture and leaves the
 * rest ordinary, and the things that stay ordinary are what make the changed
 * ones land. The failure mode is writing a haunted house — that is the sanity
 * system's job (`dread`, `unhinged`), and a psychedelic borrowing its register
 * makes both of them mean less.
 *
 * ⚠ HOUSE VOICE. No em dashes (that is the Ascendant tell), contractions by
 * default, and the specific event rather than the mood. `{it}` in an emote is
 * substituted with the thing's transformed name.
 *
 * ⚠ `says` IS UNPROMPTED and `asks` EXPECTS AN ANSWER. The trip plugin fires
 * them on different paths, so a line written as a question in `says` lands as a
 * statement nobody can reply to.
 *
 * ⚠ AND A PERSON TRANSFORM IS STILL A REAL PERSON. It re-describes an NPC or
 * player who is actually standing there and who can be talked to, attacked and
 * robbed by everybody else in the room seeing something completely different.
 * So none of these may assert that the person is not human, gone, or dead:
 * walking up to a real NPC and being told they are a corpse is a bug report
 * waiting to happen, not a hallucination.
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const CHECK = process.argv.includes('--check');
const DIR = 'content/drug_transforms';

const T = (id, scope, name, description, looks, says, asks, emotes, extra = {}) => ({
  id, drug_id: null, matches: null, scope, name, description,
  looks, says, asks, emotes, fx: null, fx_intensity: 0.5, ...extra,
});

const ROWS = [
  // ── objects: things the furniture becomes ─────────────────────────────────
  T('dx_default_ledger', 'object', 'a ledger of everything left here',
    "A book the size of a door lies open on a stand that wasn't there, and it's keeping a list. Every item anybody has ever put down in this room is in it, in a hand that changes with the century.",
    ["The current page is today. Your own name is on it, twice, and you have only put down one thing.",
     "Earlier entries are in languages the room has forgotten. The handwriting gets better going back.",
     "There's a column for what was left and a column for whether it was collected. The second column is mostly empty."],
    ["Nothing is ever really lost. It's filed.",
     "You'd be amazed what people walk away from.",
     "I don't judge. I just record."],
    ["Are you leaving anything?", "Shall I put you down as collecting, or as forgetting?", "What did you come in here holding?"],
    ["A page turns itself, {it} makes a small note, and turns back.",
     "{it} underlines something and looks pleased about it.",
     "The stand under {it} adjusts its height, politely, to yours."]),

  T('dx_default_choir', 'object', 'a stack of mouths, all singing quietly',
    "What was standing there is a column of mouths set into old wood, one above another, all the way up. They're singing something slow with no words in it, and they're in tune.",
    ["Each mouth is a different age. The ones at the bottom sound like they've been at it longest.",
     "They breathe in sequence, so the note never actually stops.",
     "The wood between them is worn smooth, the way a handrail goes."],
    ["We're nearly at the good part.", "You're welcome to join in. Most people don't.", "It's the same song. It's always been the same song."],
    ["Do you know the words?", "Can you hear the low one, or only the top ones?", "Will you stay for the end of it?"],
    ["{it} takes a breath, all the way up, and holds it.",
     "One mouth in the middle of {it} goes quiet and the others close the gap.",
     "The whole of {it} drops a tone, together, without being asked."]),

  T('dx_default_weather_engine', 'object', 'a small engine making the weather',
    "A brass and glass machine sits where the furniture was, and inside it the weather is happening in miniature: a whole grey afternoon, rained on, about the size of a hat.",
    ["The tiny rain falls on a tiny version of this street. You can see a tiny you in it, not looking up.",
     "A dial on the side is set between BEARABLE and NEARLY.",
     "The glass is cold. It's cold in there."],
    ["It's not my fault. I only run it.", "I could do sunshine. There's no call for it.", "Somebody has to."],
    ["Would you like it to stop?", "Do you want to know what tomorrow is set to?", "Shall I put a wind through it?"],
    ["The little afternoon inside {it} goes darker, and it starts to rain harder in there.",
     "{it} ticks over to the next hour with a sound like a latch.",
     "A thread of real cold comes off {it} and reaches you."]),

  T('dx_default_waiting_room', 'object', 'a row of chairs that have been waiting longer than you',
    "The furniture has resolved into a row of hard chairs, bolted together, worn shiny in the middle of each seat. All of them are facing a door that isn't in this wall.",
    ["The wear on the seats is from people, and there have been a great many people.",
     "One chair at the end is clean and unworn. It's the only one that's never been sat in.",
     "There are marks on the floor where feet have moved, back and forth, for a long time."],
    ["You can sit. It doesn't speed anything up.", "They'll call you.", "Everyone says that, and then they sit down."],
    ["Would you like to wait?", "Do you know what you're here for?", "Have you been called yet?"],
    ["{it} creaks, all along the row, as though somebody just shifted.",
     "The clean chair at the end of {it} stays clean.",
     "Something on the far side of {it} settles in for another hour."]),

  // ⚠ The NAME asserts a thing. `plugins/trip`'s own suite fails any transform
  // named `%pretend%` or `%something that%`, and it is right to: this row was
  // first called 'a thing that has stopped pretending', which describes a state
  // rather than naming an object and reads as a hedge in a room list.
  T('dx_default_honest_object', 'object', 'a shape somebody agreed on',
    "It's the same object. It has given up the part where it looks like anything, and is now visibly what it always was: a shape somebody agreed on, holding itself in that shape out of habit.",
    ["Its edges are a decision rather than a fact, and you can see the decision being made, continuously.",
     "Where you aren't looking directly, it's a good deal vaguer.",
     "It's doing quite a lot of work to go on being a thing."],
    ["You keep looking. That's what does it.", "I'm as surprised as you are.", "It's easier than you'd think, and harder than it looks."],
    ["Do you want me to keep going?", "What did you think I was?", "Would you rather I didn't?"],
    ["{it} briefly forgets one of its own corners and then has it again.",
     "The outline of {it} thickens, like somebody going over a pencil line.",
     "{it} holds very still, which appears to help."]),

  T('dx_default_grandparent', 'object', 'a piece of furniture that knew your family',
    "The thing in front of you is enormously old and it recognises you. Not your face. Something further back than that, in the way you stand.",
    ["The grain runs in a pattern you have seen before and cannot place.",
     "There's a repair on one side, done badly, a long time ago, by somebody in a hurry.",
     "It has been moved a great many times and has never once been thrown away."],
    ["You have the same hands.", "I was in a different room when I last saw that.", "Somebody kept me. That's the whole of it."],
    ["Do you know who I belonged to?", "Have you still got the other one?", "Are you keeping anything?"],
    ["{it} leans a fraction of a degree toward you.",
     "The bad old repair on {it} looks, for a second, freshly done.",
     "{it} warms slightly, the way a thing does when it has been sat against."]),

  // ── people: how somebody standing there re-reads ──────────────────────────
  // ⚠ All of these describe a REAL person who can be talked to and fought.
  T('dxp_default_translated', 'person', 'somebody being translated as they speak',
    "They're talking, and a half-second behind their mouth the words arrive again in a better order, from slightly to the left of them. Both versions are theirs.",
    ["The second version is what they meant. The first is what they managed.",
     "When they pause, the translation catches up and then waits, politely.",
     "The gap between the two is exactly the length of a breath."],
    ["I know. I heard it too.", "The second one is the real one.", "It's a relief, honestly."],
    ["Which one are you listening to?", "Did that come out right?", "Can you hear the other one?"],
    ["{it} says something, and something behind {it} says it better.",
     "{it} stops mid-sentence and lets the rest of it arrive on its own.",
     "The two voices of {it} land on the same word at the same time, and {it} looks pleased."]),

  T('dxp_default_weather_front', 'person', 'somebody with their own weather',
    "They're standing in a small and private climate. It's brighter round them than it is round you, or colder, and it moves when they move.",
    ["The air within about a foot of them is doing something completely different to the air you're in.",
     "There's a faint line on the floor where their weather stops and the room's starts.",
     "Whatever it is in there, they've clearly been in it a while and stopped noticing."],
    ["It follows me. It has always followed me.", "You get used to it.", "Stand closer if you like. It's not catching."],
    ["Is it doing it again?", "Can you feel where it stops?", "Would you come in out of yours?"],
    ["The air around {it} thickens and goes a shade colder.",
     "Something falls on {it} that isn't falling anywhere else.",
     "{it} moves, and the weather goes too, a half-step late."]),

  T('dxp_default_earlier', 'person', 'somebody who is also here earlier today',
    "They're in front of you, and they're also further back in the room doing what they were doing an hour ago, and both of them are them. Neither seems put out by it.",
    ["The earlier one is going through motions that have already finished.",
     "They're wearing the same thing, which proves nothing, and standing the same way, which does.",
     "Occasionally the two of them do the same gesture and it lines up exactly."],
    ["I was here before. I'm still here before.", "Don't talk to that one, it can't hear you.", "It'll catch up."],
    ["Have you seen me yet?", "Which one did you come to speak to?", "Am I still over there?"],
    ["{it} does something, and a moment later something at the back of the room does it too.",
     "The earlier {it} finishes a sentence nobody started.",
     "{it} glances back at {it} and looks away again."]),

  T('dxp_default_scaffold', 'person', 'somebody with the working shown',
    "You can see how they're put together. Not bones. The decisions: where they chose to stand, which expression they went with, how much of this they're finding difficult.",
    ["The effort of being a person is visible on them, and it's more than you'd assumed.",
     "Several small choices are still being made, live, and you can watch each one land.",
     "Underneath the choosing they're doing fine, which is the reassuring part."],
    ["It's a lot, isn't it.", "Everyone's doing this. You are as well.", "I'd rather you didn't mention it."],
    ["Can you see it?", "Am I holding up?", "Is it obvious?"],
    ["{it} picks an expression, tries it, and keeps it.",
     "Something in the way {it} is standing is rebuilt, quietly, and {it} carries on.",
     "{it} does nothing at all, visibly, and it costs {it} something."]),

  // ── the room itself ───────────────────────────────────────────────────────
  T('dxr_default_underneath', 'room', 'the room, with the room taken off',
    "The room is where it was, but you're seeing what it's built on: the older room under this one, and the older one under that, all of them still faintly in use.",
    ["Three sets of doorways overlap in the same wall, at three different heights.",
     "There's a floor about a foot below the floor, and it's worn in different places.",
     "The oldest one is barely a shape, and it's the one everything else has agreed to sit on."],
    [], [], []),

  T('dxr_default_inventory', 'room', 'the room, itemised',
    "Everything in here has quietly labelled itself with what it cost, who carried it in, and how long it expects to last. The labels are in no language, and you can read all of them.",
    ["The oldest label is on the floor and gives up partway through a date.",
     "Nothing has a label saying what it's for. Only what it cost and who brought it.",
     "Your own things have labels too. You look away from those."],
    [], [], []),
];

const problems = [];
let written = 0;

for (const row of ROWS) {
  const f = path.join(DIR, `${row.id}.json`);
  // ⚠ Never clobber. A dev-panel edit to one of these is somebody's tuning, and
  // this script converges on a set rather than owning it.
  if (fs.existsSync(f)) { continue; }
  if (!CHECK) fs.writeFileSync(f, canonicalJson(row), 'utf8');
  written++;
}

// ── the checks ──────────────────────────────────────────────────────────────
const all = fs.readdirSync(DIR).map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));

// ⚠ A person transform re-describes a REAL person who is standing there and who
// everybody else sees normally. Telling a player that somebody is dead, gone or
// not a person is a bug report rather than a hallucination.
const BANNED_ON_PEOPLE = /\b(corpse|dead|a body|not human|isn't a person|no longer a person|skeleton)\b/i;
for (const r of all.filter(r => r.scope === 'person')) {
  const text = [r.name, r.description, ...(r.looks || []), ...(r.says || []), ...(r.asks || []), ...(r.emotes || [])].join(' ');
  if (BANNED_ON_PEOPLE.test(text)) problems.push(`${r.id}: a person transform must not say the person is gone or not a person`);
}
// The Ascendant voice tell. In-world prose everywhere else writes without one.
for (const r of all) {
  const text = [r.description, ...(r.looks || []), ...(r.says || []), ...(r.asks || []), ...(r.emotes || [])].join(' ');
  if (text.includes('—')) problems.push(`${r.id}: em dash in player-facing prose`);
}
// `says` is unprompted and `asks` expects an answer; a question filed as a
// statement lands as something nobody can reply to.
//
// ⚠ NOT every question mark. A RHETORICAL line is legitimate in `says` and the
// first cut of this check failed a real one — `dx_blotter_door_recursive` has a
// door chanting "Through, or through, or through?", which is an incantation
// rather than an enquiry, and filing it under `asks` would turn a door muttering
// to itself into a door interrogating the player. So it fires only on a question
// actually ADDRESSED to somebody: an interrogative opener, or one naming "you".
const ADDRESSED = /(^\s*(do|does|did|are|is|was|were|will|would|can|could|shall|should|have|has|how|what|which|why|who|when|where)\b|\byou(r|rs|'ve|'re|'d|'ll)?\b)/i;
for (const r of all) {
  for (const s of r.says || []) {
    if (/\?\s*$/.test(s) && ADDRESSED.test(s)) problems.push(`${r.id}: a question in \`says\` should be in \`asks\`: ${s}`);
  }
}
// An object that has nothing to say is furniture with a new coat of paint.
for (const r of all.filter(r => ['object', 'person'].includes(r.scope))) {
  if (!(r.looks || []).length) problems.push(`${r.id}: no \`looks\`, so examining it falls back to one flat line`);
}

const counts = {};
for (const r of all) counts[(r.drug_id || 'ANY') + '/' + r.scope] = (counts[(r.drug_id || 'ANY') + '/' + r.scope] || 0) + 1;
for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Transform expansion: ${written} new row(s); ${all.length} total.`);
console.log('  ' + Object.entries(counts).sort().map(([k, v]) => `${k}=${v}`).join('  '));
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
