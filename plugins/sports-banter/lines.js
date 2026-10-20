// plugins/sports-banter/lines.js
//
// What people in a room say when the game on the set does something. Voice, not world
// data, the same as tv-reactions' pools. Quoted is said, bare is done (formatChitchat).
//
// Tokens, filled per speaker:
//   {team}    the club the play was good for        {opp}     the club it hurt
//   {player}  the man who did it (or had it done to him), by surname
//   {loser}   the man who lost the fight
//   {mine}    the speaker's club                    {rival}   the speaker's club's rival
//   {to}      the other person, by first name       {theirs}  the other person's club
// A club reads "the Crows". A line whose token has no value here is skipped for one
// that resolves, the rule banter and tv-reactions already use.
//
// Every group has a pool for every stance (fans.js stanceOf), so a room never goes
// quiet because nobody wrote "a neutral man watches a double play".

// Which pool a play falls back to when its own kind has no line for the stance.
export const GROUP_OF = {
  goal: 'score', run: 'score', homerun: 'score', grandslam: 'score', walkoff: 'score', hattrick: 'score',
  doubleplay: 'defence', tripleplay: 'defence',
  error: 'blunder',
  fight: 'fight',
  injury: 'hurt', death: 'hurt',
  final: 'final', champion: 'final',
};

export const STANCES = ['up', 'down', 'gloat', 'sour', 'neutral'];
export const GROUPS = ['score', 'defence', 'blunder', 'fight', 'hurt', 'final'];
export const TOKENS = ['team', 'opp', 'player', 'loser', 'mine', 'rival', 'to', 'theirs'];

// ── One person, to the room ──────────────────────────────────────────────────
export const SOLO = {
  // groups: complete, one pool per stance
  score: {
    up: [
      'punches the air. "Yes! Get in!"',
      '"{player}! I love that man. Never met him. Love him."',
      'is on their feet before the replay starts.',
      '"That is {mine}. That is what {mine} do."',
      'slaps the table hard enough to move everyone\'s drink.',
      '"Did everybody see that? Somebody tell me they saw that."',
    ],
    down: [
      'puts their face in their hands and leaves it there.',
      '"Who was on him? Was anybody on him?"',
      '"Nobody talk to me for a minute."',
      'stares at the set like it owes them money.',
      '"Every week with {mine}. Every single week."',
      'says a word you can\'t say on television.',
    ],
    gloat: [
      'laughs, one short ugly laugh. "{rival}. Beautiful."',
      '"Not my game. Still, anything that hurts {rival}."',
      'raises a glass at the screen. "{team}, just for today."',
      '"Look at {rival}. Look at their little faces."',
    ],
    sour: [
      '"Oh, good. {rival} are happy. Wonderful."',
      'mutters something about {rival} that would get them banned from church.',
      '"Lucky. That was lucky and everybody knows it."',
    ],
    neutral: [
      'glances up at the score, then back at their drink.',
      '"Huh. {team}."',
      '"Somebody in here just lost money on that."',
      'nods at the screen, as if it had asked them something.',
    ],
  },
  defence: {
    up: [
      '"Two! Turned two! Lovely."',
      'nods slowly. "That is fielding. That is what fielding looks like."',
      'claps three times, very precisely.',
    ],
    down: [
      '"Double play. Course it is."',
      'groans and slides a little lower in their seat.',
      '"Run, you lump. RUN."',
    ],
    gloat: [
      '"{rival} hit into two. Love to see it."',
      'grins at the screen. "Keep doing that, {rival}."',
    ],
    sour: [
      '"Oh, now {rival} can field."',
      'rolls their eyes at the set.',
    ],
    neutral: [
      '"Tidy."',
      'watches the replay with the air of a man judging a pie.',
    ],
  },
  blunder: {
    up: [
      '"He dropped it! He DROPPED it!"',
      '"Thank you, {player}. Thank you very much."',
      'laughs so hard they have to hold the bar.',
    ],
    down: [
      '"{player}. You have one job. You have a glove for it."',
      'mimes a catch at the screen, slowly, as a lesson.',
      '"Somebody take his glove off him. He isn\'t using it."',
    ],
    gloat: [
      '"{rival} couldn\'t catch a cold."',
      '"Ha! That\'s {rival} all over."',
    ],
    sour: [
      '"Even {rival} get lucky sometimes."',
    ],
    neutral: [
      '"Oof. That\'ll be on the highlights."',
      'winces on the fielder\'s behalf.',
    ],
  },
  fight: {
    up: [
      '"Put him DOWN. Yes!"',
      'throws two short punches at nobody.',
      '"{player}! That\'s our boy!"',
    ],
    down: [
      '"He had him. He HAD him."',
      '"Get up. Get up, you big soft lump."',
      'looks away from the screen for the bad part.',
    ],
    gloat: [
      '"Somebody finally hit one of {rival}. About time."',
      '"Hit him again for me, {player}."',
    ],
    sour: [
      '"{rival} fight dirty. Always have."',
    ],
    neutral: [
      '"Now we\'re watching hockey."',
      'leans forward for the first time all night.',
      '"Oh, here we go."',
    ],
  },
  hurt: {
    up: [
      '"He\'ll live." A pause. "Probably."',
      'shrugs. "Should have had his head up."',
      'opens their mouth to cheer and thinks better of it.',
    ],
    down: [
      '"That\'s {player}. That\'s OUR {player}."',
      'winces and looks away from the set.',
      '"Why isn\'t he getting up?"',
    ],
    gloat: [
      '"Couldn\'t happen to a nicer club than {rival}."',
      '"I hate {rival}. I don\'t want that, though. Mostly."',
    ],
    sour: [
      'watches them carry one of {rival} off and says nothing, which is new.',
    ],
    neutral: [
      'winces in sympathy.',
      '"That\'s a bone. I heard that through the set."',
      '"They\'ll have him back by Thursday. Most of him."',
    ],
  },
  final: {
    up: [
      '"WINNERS. Drinks are on somebody else. I\'m skint."',
      'sings something tuneless and triumphant.',
      '"{mine} win! You can all say it to me."',
    ],
    down: [
      '"Next week. We\'ll have them next week."',
      'switches off behind the eyes, like a set at closing time.',
      '"Well. That\'s my night."',
    ],
    gloat: [
      '"{rival} lost. That\'s the whole day sorted."',
      'toasts the screen. "To whoever beat {rival}."',
    ],
    sour: [
      '"{rival} won. Lovely. Somebody change the channel."',
    ],
    neutral: [
      '"That\'s the game, then."',
      'checks the final score, then their watch.',
    ],
  },

  // kinds: partial, tried before their group
  homerun: {
    up: [
      '"GONE. Go on, ball. Get out of here."',
      'stands and watches it leave, like they hit it themselves.',
      '"{player}! Over the wall! Over the WALL!"',
    ],
    down: [
      '"Who throws him that? Who on this earth throws him that?"',
      'watches the ball leave the park and quietly finishes their drink.',
    ],
    neutral: [
      '"That one\'s still going."',
    ],
  },
  grandslam: {
    up: [
      '"Four! FOUR! Somebody write it down!"',
      'is standing on a chair. Nobody saw them get on it.',
    ],
    down: [
      '"Bases loaded and you throw him THAT?"',
    ],
    neutral: [
      '"Grand slam. Somebody\'s going to get fired for that."',
    ],
  },
  walkoff: {
    up: [
      '"HOME! Everybody\'s going HOME!"',
      'is up on the table before anybody can stop them.',
      '"That\'s the game. That is the GAME."',
    ],
    down: [
      '"No. Not like this. Not at the very end."',
      'sits very still while the room goes off around them.',
    ],
    gloat: [
      '"{rival} walked off losers. Best thing I\'ll see all week."',
    ],
    neutral: [
      '"Well. That\'s that, then."',
    ],
  },
  hattrick: {
    up: [
      'throws their hat at the screen. It seemed like the thing to do.',
      '"Three! {player} has three! Get that man a drink!"',
    ],
    down: [
      '"Three goals. Three. The goalie should walk home."',
    ],
    neutral: [
      '"Hat trick." They look around. Nobody throws a hat.',
    ],
  },
  tripleplay: {
    up: [
      '"ALL THREE? I have never seen that. I have never SEEN that."',
      'stands up, sits down, and stands up again.',
    ],
    down: [
      '"Three outs on one ball. That isn\'t baseball. That\'s an insult."',
    ],
    neutral: [
      '"Did they just get three? Off one ball?"',
      'counts on their fingers, then counts again.',
    ],
  },
  death: {
    up: [
      '"Well." A long pause. "Two points is two points."',
      'starts to cheer, stops, and looks at the floor.',
    ],
    down: [
      'goes quiet, and stays quiet.',
      '"Not {player}. Not him."',
      'takes their cap off and holds it.',
    ],
    neutral: [
      '"Is he dead? On the ice?"',
      '"Every season somebody doesn\'t go home."',
    ],
  },
  champion: {
    up: [
      '"CHAMPIONS. Say it. Everybody say it."',
      'cries a little and doesn\'t care who sees.',
    ],
    down: [
      '"A whole season. A whole season for that."',
    ],
  },
};

// ── One person, at somebody else, without a conversation ─────────────────────
// Used when the room has a fan on the other side and nobody starts a two-hander:
// the happy side looks at them, or the unhappy side refuses to. {to} is that person.
export const AT = {
  up: [
    'turns, very slowly, to look at {to}.',
    'catches {to}\'s eye and says nothing at all. Just smiles.',
    'raises a glass in {to}\'s direction.',
    '"{to}. {to}. Look at me, {to}."',
  ],
  gloat: [
    'looks over at {to} and does a small, horrible dance.',
    '"Thoughts, {to}? Any thoughts at all?"',
  ],
  down: [
    'won\'t look at {to}.',
    'holds up a hand towards {to} without turning round. "Don\'t."',
    '"Not one word, {to}."',
  ],
  sour: [
    'can feel {to} looking at them and won\'t give them the satisfaction.',
  ],
};

// ── Two people ───────────────────────────────────────────────────────────────
// A is the side the play was good for, and speaks turns 0, 2, 4. B speaks 1, 3, 5.
// `on` lists the kinds or groups a thread fits; nothing fits everything, because a
// thread written for a goal reads wrong over a man carried off on a stretcher.
// `sport` limits a thread to one league.
//   clash         A's club did it to B's club
//   feud          the same, and their clubs are rivals: the nastiest
//   needle        it was done to B's club, which is A's rival (A's club may not be playing)
//   brag          A's club did it, and B backs A's rival
//   together_up   both back the club it was good for
//   together_down both back the club it hurt
export const THREADS = {
  clash: [
    { on: ['score'], turns: ['"Get IN! Did you see that, {to}?"', '"I saw it. I\'m sat right here."', '"{mine}, {to}. Say it with me."', '"I will not."'] },
    { on: ['score'], turns: ['"That right there is the difference between {mine} and {theirs}."', '"The difference is luck."', '"Luck you\'re paying for. Five credits, {to}. We shook on it."', 'pays up without a word.'] },
    { on: ['score'], turns: ['"Hear that, {to}? That\'s the sound of {theirs} crying."', '"That\'s the sound of you talking."'] },
    { on: ['goal'], turns: ['laughs and points at the screen, then at {to}.', '"Yeah, alright. It won\'t last."', '"It lasted all the way into the net."'] },
    { on: ['homerun', 'grandslam'], turns: ['"Where\'s that ball now, {to}? Where is it?"', '"Somebody\'s windscreen, probably."', '"Send {theirs} the bill."'] },
    { on: ['defence'], turns: ['"Two outs off one swing. Thank you very much."', '"Bad hop. Your lot got lucky on a bad hop."', '"There\'s no luck in a double play, {to}. Only skill."'] },
    { on: ['blunder'], turns: ['"Ha! Butterfingers!"', '"He slipped. Anybody would slip."', '"On a dry field?"', '"It\'s humid."'] },
    { on: ['fight'], turns: ['"Our man won that, {to}. Clean."', '"Clean? He had a fistful of jersey the whole time."', '"That\'s technique."'] },
    { on: ['injury'], turns: ['"Ooh. He won\'t be back tonight."', '"Don\'t sound so pleased."', '"I\'m not pleased. I\'m informed."'] },
    { on: ['death'], turns: ['opens their mouth to say something to {to}, then closes it again.', '"Don\'t."'] },
    { on: ['final'], turns: ['"And THAT is the game. Who\'s buying, {to}?"', '"Not me. Never again me."'] },
    { on: ['final'], turns: ['"Good game, {to}."', '"Was it."', '"For me it was."'] },
  ],
  feud: [
    { on: ['score', 'defence', 'blunder'], turns: ['"{theirs}. Absolute frauds, {to}. Every one of them."', '"Say that again."', '"Frauds."', 'stands up. After a moment, sits back down.'] },
    { on: ['score', 'final'], turns: ['"Told you. I TOLD you. {mine} own {theirs}."', '"Since when?"', '"Since always. It\'s in the history books."', '"There aren\'t any history books. There was a fire."'] },
    { on: ['score', 'final'], turns: ['"My grandad hated {theirs}, {to}. I hate {theirs}. My kids will hate {theirs}."', '"You haven\'t got kids."', '"Not yet. But they\'ll be ready."'] },
    { on: ['score'], turns: ['leans right into {to}\'s face and says nothing, very loudly.', '"Get out of my face."', '"Can\'t hear you over the score."'] },
    { on: ['fight'], turns: ['"That\'s for last season, {to}!"', '"Your man fights like he\'s folding laundry."', '"Your man is lying on the ice."'] },
    { on: ['injury'], turns: ['"Shame." A sip. "Not really."', '"You\'d say that about your own mother."', '"Not if she played for {theirs}."'] },
    { on: ['death'], turns: ['"I hate {theirs}, {to}. You know I do. Not like that, though."', '"No."', '"Not like that."'] },
    { on: ['final'], turns: ['"Rivalry game, {to}. And who won the rivalry game?"', '"Season\'s long."', '"Not long enough for {theirs}."'] },
  ],
  needle: [
    { on: ['score', 'defence', 'blunder', 'fight'], turns: ['"Oh dear. Oh dear, {to}. That\'s your lot, isn\'t it?"', '"Don\'t start."', '"I haven\'t started. This is me being supportive."'] },
    { on: ['score', 'defence', 'blunder'], turns: ['laughs at the screen, then turns and laughs at {to}.', '"It isn\'t even your game. Why do you care?"', '"Because it\'s {theirs}, {to}. I always care when it\'s {theirs}."'] },
    { on: ['final'], turns: ['"Is that {theirs} losing? Again? I\'m so sorry, {to}."', '"You\'re not sorry."', '"I\'m not sorry."'] },
    { on: ['score', 'defence', 'blunder'], turns: ['whistles, long and low, and looks at {to}.', '"Yes. Thank you. I saw."'] },
    { on: ['score'], turns: ['"{theirs} again, {to}? Very generous of them."', '"It\'s early."', '"It\'s always early with {theirs}."'] },
    { on: ['final'], turns: ['"Whoever beat {theirs} tonight, {to}, I owe them a drink."', '"They don\'t know you exist."', '"They will when the drink arrives."'] },
  ],
  brag: [
    { on: ['score', 'defence', 'final'], turns: ['"Did you see that, {to}? That\'s {mine}. That\'s how it\'s done."', '"Nobody asked you."', '"Nobody has to. It\'s on the television."'] },
    { on: ['score', 'defence'], turns: ['"Taking notes, {to}? {theirs} could learn a thing or two."', '"{theirs} would beat that lot by six."', '"{theirs} couldn\'t beat a rug."'] },
    { on: ['fight'], turns: ['"See that, {to}? That\'s a club with a spine."', '"That\'s a club with a dentist on retainer."'] },
  ],
  together_up: [
    { on: ['score', 'defence', 'blunder', 'fight'], turns: ['grabs {to} by the shoulders. "Did you SEE that?"', '"I SAW it!"'] },
    { on: ['score'], turns: ['"Here we go, {to}. Here we go."', '"Don\'t jinx it."', '"I\'m not jinxing it. I\'m celebrating it."', '"With {mine}, that\'s the same thing."'] },
    { on: ['score', 'final'], turns: ['goes for a high five with {to} and misses completely.', '"Again."', 'tries again, and this time it connects.'] },
    { on: ['final'], turns: ['"{mine}, {to}. {mine}!"', '"I know! I know!"'] },
  ],
  together_down: [
    { on: ['score', 'defence', 'blunder', 'fight'], turns: ['"Tell me that didn\'t just happen, {to}."', '"It happened."', '"I asked you to tell me it didn\'t."'] },
    { on: ['score', 'defence', 'final'], turns: ['sighs.', 'sighs, louder.'] },
    { on: ['score', 'final'], turns: ['"Twenty years I\'ve followed {mine}, {to}."', '"Twenty-two for me."', '"Why do we do this?"', '"Nobody knows."'] },
    { on: ['injury'], turns: ['"That\'s {player} gone, {to}. For weeks, that."', '"Who\'ve we got instead?"', '"Nobody. We\'ve got nobody."'] },
    { on: ['death'], turns: ['"He was a good one, {to}."', '"He was."'] },
  ],
};
