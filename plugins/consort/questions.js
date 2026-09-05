// plugins/consort/questions.js
//
// Questions a consort asks their keeper — and actually waits on the answer to.
//
// The "settle it" beat (index.js) proved the shape: play a line, hand the room
// back, and let the `player.say` hook read whatever the keeper says next. That one
// needs BOTH members of a pairing present. This is the solo version, and it is the
// main thing a consort does with their mouth when nobody is undressing: they ask
// something, you answer out loud, and they take the answer personally.
//
// The rules that shape the pool:
//
//   • A question is written for ANY consort — every line is pronoun-tokenised
//     ({they}/{their}/…) and none of them assume the KEEPER's sex, because the
//     keeper is a player. Archetype does not gate a question; the same words land
//     differently coming from an Ice than from a Brat, and that's enough.
//   • The classifier is DELIBERATELY generous and never guesses hard. Anything it
//     can't read is `dodge`, and every question has a written dodge reaction —
//     a non-answer is a real answer here, not a parse failure.
//   • `mood` on a branch is arousal the answer is worth. Warmth moves them; a
//     dodge mostly doesn't; a couple of answers cool the room, which is the point
//     of asking at all.
//   • Nothing here is MIS-gated. These are the clothed half of the relationship.
//
// Shape:
//   { key, ask, answers: [[branch, /re/], …], react: { branch: [lines] }, mood: {} }
// `react.timeout` is what they say when the keeper says nothing at all.

import { MORE_QUESTIONS, MORE_DYNAMIC } from './questions-extra.js';

const YES  = /\b(yes|yeah|yep|yup|aye|sure|of course|always|definitely|absolutely|i do|i am|i will|course i)\b/;
const NO   = /\b(no|nope|nah|never|not really|i don'?t|i won'?t|i'?m not)\b/;

export const QUESTIONS = [
  {
    key: 'staying',
    ask: `{lean} back and {watch} you a moment. "Are you staying tonight? Say it either way — I'd rather know than hope."`,
    answers: [['yes', YES], ['no', NO]],
    mood: { yes: 10, no: -6 },
    react: {
      yes: [
        `nods once, like {they} {was} filing it somewhere safe. "Good. Then I'll stop listening for the door."`,
        `"You'd be amazed how much of an evening I spend waiting to find that out."`,
      ],
      no: [
        `takes it without a flicker. "Then eat something before you go. That's not affection, that's maintenance."`,
        `"Go on. I'll keep the lamp on the low setting — it's better light anyway."`,
      ],
      dodge: [
        `"That's a maybe. Maybes are how I end up asleep in this chair with my shoes on."`,
      ],
      timeout: [
        `answers {themself}, eventually. "...not staying, then."`,
      ],
    },
  },
  {
    key: 'name',
    ask: `"Do you ever think about the fact that somebody chose this name for me before you ever saw my face? Does that bother you?"`,
    answers: [['yes', YES], ['no', NO]],
    mood: { yes: 6, no: 4 },
    react: {
      yes: [
        `"It bothers me some nights too. Then you say it and it sounds like mine." {They} {shrug} it off, badly.`,
      ],
      no: [
        `"No. Right." A pause. "I asked because I wanted you to think about it for a second, and you did. That'll do."`,
      ],
      dodge: [
        `lets the silence sit, then lets it go. "Forget it. It's a three-in-the-morning question and it's not three in the morning."`,
      ],
      timeout: [
        `"Mm. That's the answer everyone gives it."`,
      ],
    },
  },
  {
    key: 'day',
    ask: `"What did you actually do out there today? Not the version you'd tell somebody at a bar. The real one."`,
    answers: [
      ['violent', /\b(kill|killed|shot|shoot|fought|fight|stabbed|hit|beat|blood|bodies|dead)\b/],
      ['work',    /\b(work|worked|job|shift|delivery|deliver|hauled|contract|paid|credits|money|sold|selling|flew|flight)\b/],
      ['nothing', /\b(nothing|not much|walked|slept|drank|drinking|around|wandered|same as|usual)\b/],
    ],
    mood: { violent: 8, work: 4, nothing: 2 },
    react: {
      violent: [
        `doesn't blink. {They} {reach} over and {check} your knuckles instead, turning your hand to the light. "Uh huh. And you came straight back."`,
        `"I'm not going to tell you not to. I'm going to tell you to come back with the same number of hands."`,
      ],
      work: [
        `"Honest hours. Look at you." {They} {sound} genuinely pleased and slightly suspicious of being pleased.`,
      ],
      nothing: [
        `"Nothing. All day." {They} {consider} that. "Good. You're allowed a nothing. You're bad at them, but you're allowed one."`,
      ],
      dodge: [
        `"That's the bar version." {They} {let} it stand anyway. "Fine. Keep it."`,
      ],
      timeout: [
        `"You're not going to say. That's alright — I can usually tell from how you sit down."`,
      ],
    },
  },
  {
    key: 'afraid',
    ask: `"Is there anything out there you're actually afraid of? I'm asking honestly. I'll believe whatever you say."`,
    answers: [
      ['yes',     YES],
      ['no',      NO],
      ['tender',  /\b(you|losing you|this|dying|death|alone|the dark|nothing left)\b/],
    ],
    mood: { yes: 8, tender: 14, no: 3 },
    react: {
      yes: [
        `"Good. The ones who say no get carried home." {Their} voice is soft under the flint.`,
      ],
      no: [
        `"Nothing at all." {They} {smile} without believing a word of it. "Alright, hero. I'll write that down."`,
      ],
      tender: [
        `is quiet for a beat longer than is comfortable, then {move} closer without making a thing of it. "...that's the one I'd have picked too."`,
      ],
      dodge: [
        `"Mm." {They} {let} you off it. "Ask me sometime. I'll answer."`,
      ],
      timeout: [
        `"Alright. Some questions get to stay under the floor."`,
      ],
    },
  },
  {
    key: 'ledger',
    ask: `"Do you ever look at what I cost you and do the arithmetic? Go on. I won't be hurt."`,
    answers: [['yes', YES], ['no', NO], ['worth', /\b(worth it|worth every|cheap|bargain|don'?t care|doesn'?t matter|whatever it costs)\b/]],
    mood: { worth: 14, no: 6, yes: -4 },
    react: {
      yes: [
        `laughs, entirely unoffended. "Course you do. I'd think less of you if you didn't." A beat. "What'd the numbers say?"`,
      ],
      no: [
        `"You should. One of us has to." {They} {settle} back. "It won't be me. I'm biased."`,
      ],
      worth: [
        `goes still, and then busies {themself} with something that didn't need doing. "...well. Don't say that where the billing hears you. It'll put my rate up."`,
      ],
      dodge: [
        `"That's a man not doing the arithmetic in front of the merchandise." {They} {sound} amused, mostly.`,
      ],
      timeout: [
        `"Everybody does the arithmetic. Nobody says the total out loud."`,
      ],
    },
  },
  {
    key: 'freedom',
    ask: `"If the retainer stopped tomorrow — if it just lapsed and nobody came for me — do you think I'd go?"`,
    answers: [['no', NO], ['yes', YES], ['choice', /\b(your (choice|call|decision)|up to you|whatever you want|you'?d decide|not my call)\b/]],
    mood: { no: 10, choice: 12, yes: -8 },
    react: {
      no: [
        `"No." {They} {turn} that over. "You said that fast. I'm choosing to enjoy that instead of examining it."`,
      ],
      yes: [
        `takes a moment. "Right. Then it's good we both know where we stand." {Their} tone is perfectly level, which is the tell.`,
      ],
      choice: [
        `"My call." {They} {breathe} out. "Nobody's said that to me since before the name. I'd stay, since you didn't ask."`,
      ],
      dodge: [
        `"You don't want to answer that one. Noted, and forgiven, and remembered."`,
      ],
      timeout: [
        `"...that's alright. It was a trap of a question and I knew it when I set it."`,
      ],
    },
  },
  {
    key: 'drink',
    ask: `"I'm making myself something. Do you want one, or are you working tonight?"`,
    answers: [['yes', YES], ['no', NO]],
    mood: { yes: 6, no: 2 },
    react: {
      yes: [
        `"Two, then." {They} {go} to fetch it with the unhurried competence of somebody who has poured a thousand of these.`,
      ],
      no: [
        `"Working. Fine." {They} {pour} one anyway, and {leave} it where your hand will find it.`,
      ],
      dodge: [
        `"I'll take that as a yes. You always mean yes."`,
      ],
      timeout: [
        `pours two regardless, and drinks {their} own first.`,
      ],
    },
  },
  {
    key: 'other',
    ask: `"Be honest with me. Is there someone else out there you'd rather be spending this hour with?"`,
    answers: [['no', NO], ['yes', YES]],
    mood: { no: 12, yes: -10 },
    react: {
      no: [
        `"No." {They} {let} that land somewhere behind {their} ribs. "...alright. Good. That's all I wanted."`,
      ],
      yes: [
        `nods slowly, and {their} whole posture changes about a centimetre. "Then don't waste the hour on me. I mean that. Mostly."`,
      ],
      dodge: [
        `"That's a long pause for a short question." {They} {let} it go, in the way that isn't letting it go.`,
      ],
      timeout: [
        `"Right." Whatever {they} {was} going to say after that, {they} {keep} it.`,
      ],
    },
  },
  {
    key: 'scars',
    ask: `"Where'd you get the worst one? I've had my hands all over you and I still don't know the story."`,
    answers: [
      ['story', /\b(fight|fought|knife|gun|shot|crash|fell|burn|burned|war|job|deal|cop|police|enemy|bear|dog|explosion)\b/],
      ['no',    /\b(don'?t remember|no idea|can'?t recall|forgot|nothing|not telling|none of your)\b/],
    ],
    mood: { story: 10, no: 4 },
    react: {
      story: [
        `listens all the way to the end without interrupting once, which almost nobody does. "...thank you. I'll stop guessing now."`,
      ],
      no: [
        `"Don't remember." {Their} thumb finds it anyway. "Then I'll make one up, and mine will be better."`,
      ],
      dodge: [
        `"Keep it, then. I'll keep asking about a different one every so often until you slip."`,
      ],
      timeout: [
        `traces it once with a thumb and asks nothing further.`,
      ],
    },
  },
  {
    key: 'tomorrow',
    ask: `"What do you want tomorrow to look like? Not the grand plan. Just tomorrow."`,
    answers: [
      ['quiet', /\b(quiet|rest|sleep|nothing|here|with you|stay|slow|easy|peace)\b/],
      ['work',  /\b(work|job|money|credits|earn|fly|flight|contract|build|deal|shop)\b/],
      ['blood', /\b(kill|kill(ing|ed)?|revenge|war|fight|hunt|burn|blood|even)\b/],
    ],
    mood: { quiet: 12, work: 4, blood: 6 },
    react: {
      quiet: [
        `"Quiet." {They} {sound} like somebody set a weight down. "I can do quiet. I'm very good at quiet."`,
      ],
      work: [
        `"Then you'll want an early night and you won't take one." {They} {say} it fondly, and {they} {is} right.`,
      ],
      blood: [
        `"Ah." {They} {do} not argue with it. "Then I'll leave the water hot and I won't ask about the shirt."`,
      ],
      dodge: [
        `"No idea." {They} {nod}. "That's most people, most days. It's not a failing."`,
      ],
      timeout: [
        `"Tomorrow'll decide for itself. It usually does."`,
      ],
    },
  },
];

// ── Dynamic questions — the ones that read the room ───────────────────────────
//
// Everything above is a question a consort could ask on any evening. These are the
// ones they only ask because of something they can SEE: the hour on the clock, the
// state you walked in in, the weather you walked in out of, the number of stars on
// you, what's left in the account, how long they've been here.
//
// Shape is the same as a static question with two differences:
//
//   • `applies(ctx)` gates it. If the state isn't there, the question doesn't exist.
//   • `ask(ctx)` and any reaction line may be a FUNCTION of the context, so the
//     question can quote the actual number back at you. The context is snapshotted
//     when the question is ASKED, so the reaction still reads correctly if the
//     state has moved on by the time the keeper answers.
//
// Every value in the context is read from live memory — the player object, the
// world maps, the in-memory wanted runtime, the consort's own ledger row. NOTHING
// here queries, because this is assembled on a 15s tick.
//
// The lines are still pronoun-tokenised and still never assume the keeper's sex.

const hhmm = (mins) => {
  const h = Math.floor((mins % 1440) / 60), m = Math.floor(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const money = (n) => `₵${Math.round(n || 0).toLocaleString('en-US')}`;

export const DYNAMIC_QUESTIONS = [
  {
    key: 'late',
    applies: (c) => c.hour >= 2 && c.hour < 5,
    ask: (c) => `glances at the clock. "It's gone ${hhmm(c.gameMinutes)}. Do you actually sleep, or is that something you had taken out of you?"`,
    answers: [['yes', YES], ['no', NO], ['soon', /\b(soon|in a bit|shortly|after this|about to|going to now|heading to bed)\b/]],
    mood: { soon: 8, yes: 4, no: -2 },
    react: {
      yes: [`"Then go and do it. I'll still be here in the morning — that's the whole product."`],
      no: [`"No." {They} {do} not look surprised. "Right. I'll leave the lamp on the low setting and pretend I'm not waiting up."`],
      soon: [`"Good." {They} {move} something off the bed without being asked about it.`],
      dodge: [`"That's a no dressed up." {They} {let} it go and {leave} water where you'll find it.`],
      timeout: [(c) => `checks the clock again — ${hhmm(c.gameMinutes + 4)} now — and says nothing further about it.`],
    },
  },
  {
    key: 'hurt',
    applies: (c) => c.hpPct < 0.8,
    ask: (c) => `{their} eyes go straight to you. "You're walking around on about ${Math.round(c.hpPct * 100)} percent of yourself. Who did that?"`,
    answers: [
      ['someone', /\b(guy|man|woman|cop|police|gang|crew|kid|dealer|enforcer|merc|bastard|them|him|her|a few|three|two)\b/],
      ['nobody',  /\b(nobody|no one|nothing|myself|fell|slipped|my own fault|accident|it'?s fine|i'?m fine)\b/],
      ['done',    /\b(dead|killed|handled|dealt with|took care|settled it|won|they'?re gone)\b/],
    ],
    mood: { someone: 6, done: 10, nobody: 2 },
    react: {
      someone: [
        `"Uh huh." {They} {take} your hand and {turn} it to the light without asking. "Sit down. I'm not going to make a speech about it."`,
      ],
      done: [`"Then it's finished." {They} {breathe} out. "Sit down anyway."`],
      nobody: [`"Nobody." {They} {do} not believe you and {do} not push. "Sit down."`],
      dodge: [`{They} {stop} asking and {start} looking instead, and {they} {know} what that does.`],
      timeout: [`says nothing more about it, and quietly moves the good chair nearer.`],
    },
  },
  {
    key: 'heat',
    applies: (c) => c.stars >= 2,
    ask: (c) => `keeps {their} voice very level. "There's ${c.stars} stars on you${c.charge ? ` and the word is "${c.charge}"` : ' and the word is out'}. Are they coming here?"`,
    answers: [
      ['yes',  YES],
      ['no',   NO],
      ['leaving', /\b(leaving|i'?ll go|moving|clear out|lay low|laying low|won'?t stay|not staying)\b/],
    ],
    mood: { no: 6, leaving: 4, yes: -8 },
    react: {
      yes: [
        `nods once. "Then tell me what you want me to say when they knock, and I'll say exactly that and nothing else."`,
      ],
      no: [`"Good." {They} {check} the door anyway, on the way past, like {they} {was} going that way regardless.`],
      leaving: [`"Don't." A beat, and {they} {let} go of it. "...fine. Go. But you come back and tell me it's over."`],
      dodge: [`"You don't know." {Their} mouth flattens. "Then I'll assume yes and lay the table for three."`],
      timeout: [`stops asking, and spends the next while with one ear on the corridor.`],
    },
  },
  {
    key: 'ledger_thin',
    applies: (c) => c.dailyRate > 0 && (c.credits + c.bank) < c.dailyRate * 3,
    ask: (c) => `"I can see the account from the terminal, you know. ${money(c.credits + c.bank)} against ${money(c.dailyRate)} a day. Am I about to become a thing you can't afford?"`,
    answers: [
      ['yes', YES],
      ['no',  NO],
      ['fix', /\b(working on it|i'?ll fix|handle it|sort it|got a job|got work|money coming|earning|payday|deal)\b/],
    ],
    mood: { no: 6, fix: 8, yes: -6 },
    react: {
      yes: [
        `"Right." {They} {do} not flinch. "Then miss one and tell me, don't miss two and hope. Two is when they come."`,
      ],
      no: [`"No." {They} {let} it go. "Alright. I'll stop reading the terminal."`],
      fix: [`"Working on it." {They} {smile}, thin and real. "That's what everybody says the first time. Say it again on the day after tomorrow."`],
      dodge: [`"Say nothing, then. I can count." {They} {sound} more tired than angry.`],
      timeout: [(c) => `does the arithmetic out loud, to nobody: "${Math.max(0, Math.floor((c.credits + c.bank) / Math.max(1, c.dailyRate)))} days."`],
    },
  },
  {
    key: 'missed_draft',
    applies: (c) => c.missed >= 1,
    ask: () => `"The draft didn't clear. I'm not asking you for money — I'm asking whether I should be packing. Do I need to worry?"`,
    answers: [['no', NO], ['yes', YES]],
    mood: { no: 8, yes: -10 },
    react: {
      no: [`"Then I won't." {They} {say} it like a decision rather than a belief.`],
      yes: [`goes quiet for a long moment. "Alright. Thank you for saying it straight. Most wouldn't."`],
      dodge: [`"That's two misses away from a van, and you're doing a joke." But {they} {let} you have it.`],
      timeout: [`starts, very slowly, tidying things that were already tidy.`],
    },
  },
  {
    key: 'weather_in',
    applies: (c) => c.severity >= 0.5 || c.tempC <= 2 || c.tempC >= 36,
    ask: (c) => `"It's ${c.weather} out there — ${Math.round(c.tempC)} degrees. Was whatever you went out for worth it?"`,
    answers: [
      ['yes', /\b(yes|yeah|worth|got it|found it|paid|of course|absolutely)\b/],
      ['no',  /\b(no|nope|not really|waste|nothing|pointless|wasted)\b/],
    ],
    mood: { yes: 6, no: 4 },
    react: {
      yes: [`"Then show me later." {They} {take} the wet thing off your shoulders without waiting to be handed it.`],
      no: [`"Out in that, for nothing." {They} {shake} {their} head and {go} to run the water hot.`],
      dodge: [`"You're dripping on the floor and being mysterious. Go and get warm."`],
      timeout: [`gives up on the answer and goes to run the water hot instead.`],
    },
  },
  {
    key: 'unfed',
    applies: (c) => c.hunger <= 45 || c.thirst <= 45,
    ask: (c) => (c.thirst <= c.hunger
      ? `"When did you last drink anything that wasn't alcohol? Actual water. There's a right answer and it isn't 'earlier'."`
      : `"When did you last eat? And I mean a meal, not something you unwrapped while walking."`),
    answers: [
      ['recent', /\b(this morning|earlier|an hour|a bit ago|just|today|recently|before i came)\b/],
      ['long',   /\b(yesterday|days|can'?t remember|don'?t remember|a while|long time|no idea|not since)\b/],
    ],
    mood: { recent: 3, long: 4 },
    react: {
      recent: [`"Earlier." {They} {sound} unconvinced and {go} to fix something anyway.`],
      long: [`"That's what I thought." {They} {is} already up. "Sit. This isn't a favour, it's maintenance."`],
      dodge: [`"You didn't answer, which is an answer." {They} {go} to fix something.`],
      timeout: [`goes and fixes something without being asked, and puts it in front of you.`],
    },
  },
  {
    key: 'tenure',
    applies: (c) => c.daysKept >= 21,
    ask: (c) => `"${c.daysKept} days I've been here. Did you think, on the first one, that it'd still be going?"`,
    answers: [['yes', YES], ['no', NO]],
    mood: { yes: 12, no: 8 },
    react: {
      yes: [`"You did." {They} {look} at you a moment too long. "...that's a nicer answer than I was braced for."`],
      no: [`"No. Honest {person}." {They} {seem} pleased rather than stung. "Neither did I. Here we are."`],
      dodge: [(c) => `"${c.daysKept} days and you still won't answer a straight question. Consistency, at least."`],
      timeout: [(c) => `lets it go. "${c.daysKept} days. I'll count for both of us."`],
    },
  },
  {
    key: 'colleague',
    applies: (c) => !!c.companionName,
    ask: (c) => `"Am I supposed to be getting on with ${c.companionName}, or would you rather not have to manage that? Say it plainly, I'll do either."`,
    answers: [
      ['friends', /\b(get on|getting on|friends|be nice|nice to|kind|both of you|together|make it work|like{0,1} ?each other)\b/],
      ['apart',   /\b(apart|separate|stay out|don'?t|keep away|not friends|rather not|avoid)\b/],
      ['choose',  /\b(your (call|choice)|up to you|whatever you want|not my business|do what you like)\b/],
    ],
    mood: { friends: 8, choose: 6, apart: 2 },
    react: {
      friends: [`"Fine." {They} {consider} it. "I've had worse assignments than being kind to somebody."`],
      apart: [`"Understood." No argument, no sulk — {they} {file} it and {move} on, which is its own kind of unsettling.`],
      choose: [`"My call, then." {They} {smile} slightly. "You'll regret that phrasing eventually. Not today."`],
      dodge: [`"You'd rather not think about it. Noted. I'll work it out with §other and you can be surprised."`],
      timeout: [`answers it {themself} with a small shrug and lets the subject drop.`],
    },
  },
  {
    key: 'wrecked',
    applies: (c) => c.impaired >= 2,
    ask: () => `"You can't stand up straight. I'm not judging — I want to know what we're drinking about."`,
    answers: [
      ['reason', /\b(work|job|deal|money|someone|died|dead|lost|hard day|rough|failed|deal went|because)\b/],
      ['nothing', /\b(nothing|no reason|fun|celebrating|felt like|why not|good day)\b/],
    ],
    mood: { reason: 8, nothing: 4 },
    react: {
      reason: [`listens the whole way through without a single interruption. "Right. Then we're drinking about that. Sit down and do it properly."`],
      nothing: [`"No reason at all." {They} {laugh}, low. "Best kind. Move over."`],
      dodge: [`"Mm." {They} {take} the glass out of your hand, refill it, and hand it back. "Talk when you're ready."`],
      timeout: [`takes the glass out of your hand, tops it up, and puts it back in it.`],
    },
  },
];

// A dynamic question's context is snapshotted at ASK time, so a line can safely be
// a function of it in the reaction too. Anything that isn't a function passes
// through untouched (most lines are plain strings).
export const resolveLine = (line, ctx) => (typeof line === 'function' ? line(ctx) : line);

// Which dynamic questions the current state supports. Never throws on a partial
// context — a missing value simply means that question doesn't apply.
export function applicableDynamic(ctx) {
  return DYNAMIC_QUESTIONS.filter(q => { try { return !!q.applies(ctx); } catch { return false; } });
}

// Branch resolution. Ordered — the first pattern that matches wins — and anything
// unmatched is a dodge, never an error. A blank or one-word grunt is a dodge too.
export function classifyAnswer(question, text) {
  const lower = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ')} `;
  if (!lower.trim()) return 'dodge';
  for (const [branch, re] of question.answers || []) {
    if (re.test(lower) && question.react?.[branch]) return branch;
  }
  return 'dodge';
}

// The rest of the pool lives in questions-extra.js — same shapes, same rules. It's
// pushed onto the two arrays rather than exported separately so nothing downstream
// (the rotation, applicableDynamic, questionByKey, regress) knows there are two files.
QUESTIONS.push(...MORE_QUESTIONS);
DYNAMIC_QUESTIONS.push(...MORE_DYNAMIC);

export const ALL_QUESTIONS = [...QUESTIONS, ...DYNAMIC_QUESTIONS];

export const questionByKey = (key) =>
  QUESTIONS.find(q => q.key === key) || DYNAMIC_QUESTIONS.find(q => q.key === key) || null;
