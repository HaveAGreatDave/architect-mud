// The frame round a street banter thread: how two people open, how they part, and what a third person in
// the room says over them. The thread itself is the engine's library (npc_banter_threads); this file is the
// Architect half, registered with registerBanterFrames() in server/engine/npc-banter.js.
//
// Which opener plays depends on how often this pair has talked since the last restart (RAM only):
//   stranger  never talked     -> a nod, a name, the weather
//   known     a few times      -> "You again."
//   regular   many times       -> no hello at all, straight in
// An opener's second line is the other person's. A closer is two lines, either way round.
// Tokens: {me} the speaker's first name, {you} the other's, {third} the interrupter's target,
// plus any topical token the engine snapshots ({weather} and so on); a line whose token has no
// value is skipped for another.

export const BANTER_FRAMES = {
  openers: {
    stranger: [
      ['nods at {you}.', 'nods back.'],
      ['"Don\'t think we\'ve met. I\'m {me}."', '"{me}. Good to meet you."'],
      ['"Mind if I stand here?"', '"It\'s a free street. Mostly."'],
      ['"Some {weather}, eh?"', '"Seen worse."'],
      ['"You waiting for someone?"', '"Not really. You?"'],
      ['"Is it always this quiet?"', '"Give it an hour."'],
    ],
    known: [
      ['"You again."', '"Me again."'],
      ['"{you}. How\'s things?"', '"Same as last time."'],
      ['"Thought I saw you earlier."', '"You probably did."'],
      ['raises a hand at {you}.', '"Oh, hey, {me}."'],
      ['"Still alive, then?"', '"Just about."'],
    ],
    regular: [
      ['"So I\'ve been thinking."', '"That\'s new."'],
      ['"Right, where were we?"', '"You were complaining."'],
      ['"Go on, then."', '"Go on what?"'],
      ['bumps shoulders with {you}.', 'doesn\'t look up. "{me}."'],
    ],
  },
  // Picked up from the last time this pair talked, when the engine remembers how it went.
  callbacks: [
    ['"About what you said last time."', '"I say a lot of things."'],
    ['"I looked into that thing you mentioned."', '"And?"'],
    ['"I\'m still annoyed about before, by the way."', '"I know. You told me."'],
  ],
  closers: [
    ['"Anyway."', '"Anyway."'],
    ['"I should go."', '"Go on, then."'],
    ['"See you round, {you}."', '"Not if I see you first."'],
    ['checks the time.', '"Yeah, same."'],
    ['"Right."', 'shrugs.'],
    ['"Don\'t tell anyone I said that."', '"Who would I tell?"'],
  ],
  // A third person in the room, said once the two have finished.
  interjections: [
    'mutters, "Some of us are trying to think."',
    '"You two do this every day?"',
    'snorts, half listening.',
    '"{third} is right, for once."',
    'rolls their eyes at nobody in particular.',
    '"Can you not?"',
    'pretends very hard not to have been listening.',
  ],
  // When a stranger to both is standing there, before the talk starts.
  asides: [
    ['glances at the stranger and lowers their voice.', 'leans in.'],
    ['"Who\'s that?"', '"No idea. Don\'t stare."'],
  ],
};
