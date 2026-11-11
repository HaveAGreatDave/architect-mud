// What people say when asked what they're up to. Plain speech, one or two sentences
// (docs/reference/house-voice.md, "How people talk").
//
// A line may use {work} (where they work), {place} (where they're walking to) and {when}
// ("about 3 hours" until their next shift). A line whose token has no value is never picked.

// Won't say. Keyed by why.
export const REFUSE = {
  // somebody who keeps to themselves
  guarded: [
    'Why do you want to know?',
    'Nothing that concerns you.',
    "I'm busy.",
    'Minding my own business.',
    "I'd rather not say.",
  ],
  // somebody whose business is better not known
  closed: [
    'None of your business.',
    "Who's asking?",
    "Don't worry about what I'm doing.",
    'Keep walking.',
    'Nothing. Go away.',
  ],
  // they don't like you
  disliked: [
    "I've got nothing to say to you.",
    'Get away from me.',
    "You're the last person I'd tell.",
  ],
  // an ordinary person who isn't in the mood
  notnow: [
    'Not now.',
    "I don't want to talk about it.",
    'Leave it, will you?',
  ],
};

// The short answer: true, and no more than that.
export const BRIEF = {
  working:      ['Working.', "I'm at work.", 'On shift.'],
  to_work:      ['Going to work.', 'Off to work.', "I've got work."],
  heading_home: ['Going home.', 'Heading home.', 'On my way home.'],
  at_home:      ["Nothing. I'm at home.", 'Not much.', 'Just at home.'],
  out:          ['Just out for a walk.', 'Nothing much. Walking.', 'Getting some air.'],
  idle:         ['Nothing much.', 'Not a lot.', 'Just standing here.'],
  // carrying the takings, to anybody who isn't close: true, and it gives nothing away
  banking:      ["I've got an errand to run.", 'Just dropping something off.'],
};

// The whole answer.
export const FULL = {
  working: [
    "Working. I'm at {work} today.",
    "I'm on shift at {work}. Same as most days.",
    'Working. Same as most days.',
    "I'm at work. It's been quiet so far.",
  ],
  to_work: [
    "Off to work. I'm at {work}.",
    "On my way to {work}. My shift's started.",
    "Going to work. I'm running a bit late.",
  ],
  heading_home: [
    "Heading home. I'm not back at {work} for {when}.",
    "Going home. I've got work in {when} and I want to sit down first.",
    "Heading home. I've been out long enough.",
    "Going home. I'm done for the day.",
  ],
  at_home: [
    "Not much. I've got work in {when}.",
    "Nothing really. I'm not due at {work} for {when}.",
    'Not much. Just having a quiet one at home.',
  ],
  out: [
    "Just walking. I thought I'd go over to {place}.",
    'Heading over to {place}. No reason, really.',
    "Nothing much. I've got work in {when}, so I'm just getting some air.",
    'Just out for a walk. Nowhere in particular.',
  ],
  // walking to one of their flags.haunt_zone(s)
  haunt: [
    "Going over to {place}. I'm there most days.",
    'Heading to {place}. Same as usual.',
  ],
  idle: [
    "Nothing much. I've got work in {when}.",
    'Not a lot. Just passing the time.',
    "Nothing really. I've got nowhere to be.",
  ],
  // only somebody close hears this one
  banking: [
    "Taking the day's takings to the bank. Keep that to yourself.",
    "Banking the till from {work}. Don't go telling people.",
  ],
};

// The player's way back to root, by how it went.
export const BACK = {
  refuse: ['Fair enough.', 'Forget I asked.', 'All right.'],
  brief:  ['Right.', 'Fair enough.'],
  full:   ['Right.', 'Fair enough.', 'Good to know.'],
};
