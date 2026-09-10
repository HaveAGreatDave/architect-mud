// plugins/consort/questions-extra.js
//
// More of what a consort asks you — merged into QUESTIONS / DYNAMIC_QUESTIONS by
// questions.js. Same shape, same four rules, no exceptions:
//
//   • Written for ANY consort. Pronoun-tokenised, and nothing assumes the KEEPER's
//     sex, because the keeper is a player.
//   • The classifier is generous. Every question has a written `dodge` — a
//     non-answer is a real answer here — and a `timeout` for silence.
//   • `mood` is what the answer was worth. Some of these are negative on purpose;
//     a question you can only win isn't a question.
//   • Not MIS-gated. This is the clothed half of the relationship.
//
// Dynamic entries additionally take `applies(ctx)` and a functional `ask(ctx)`, and
// read ONLY the live-memory context questions.js assembles. Nothing here queries.

const YES = /\b(yes|yeah|yep|yup|aye|sure|of course|always|definitely|absolutely|i do|i am|i will|course i)\b/;
const NO  = /\b(no|nope|nah|never|not really|i don'?t|i won'?t|i'?m not)\b/;

export const MORE_QUESTIONS = [
  {
    key: 'first_thing',
    ask: `"What did you notice about me first? Don't be gallant about it, I'd rather have the true one."`,
    answers: [
      ['looks', /\b(face|eyes|mouth|hair|body|legs|beautiful|pretty|handsome|look(s|ed)?|gorgeous|smile)\b/],
      ['voice', /\b(voice|way you talk|talking|said|words|accent|laugh)\b/],
      ['other', /\b(quiet|calm|stillness|sad|angry|smart|clever|kind|dangerous|how you stood|the way you)\b/],
    ],
    mood: { looks: 6, voice: 10, other: 12 },
    react: {
      looks: [
        `"Of course it was." {They} {sound} amused rather than disappointed. "That's what it's advertised on. I don't mind, it's honest."`,
        `"Right. Well. It's a good one, I'll give me that." A small, pleased shrug.`,
      ],
      voice: [
        `"My voice." {They} {look} genuinely thrown. "Nobody's ever said that. I'll be thinking about it for a week."`,
      ],
      other: [
        `goes very quiet for a second. "That's not the sort of thing people notice about somebody like me."`,
      ],
      dodge: [
        `"You won't say." {They} {smile}. "Then it's something you'd be embarrassed by. Good. I like those better."`,
      ],
      timeout: [
        `"...I'll take the silence as the shallow answer and be flattered anyway."`,
      ],
    },
  },
  {
    key: 'sleep_side',
    ask: `"Do you sleep better with someone in the bed or worse? I'd like the real answer, not the polite one."`,
    answers: [['yes', /\b(better|yes|yeah|with you|much better|always have)\b/], ['no', /\b(worse|no|alone|on my own|can'?t sleep|light sleeper)\b/]],
    mood: { yes: 10, no: 2 },
    react: {
      yes: [`"Good." {They} {say} it like something's been settled that's been open a while.`],
      no: [`"Then say so and I'll go through. That's not a slight — I'd rather you slept."`],
      dodge: [`"You don't know." {They} {consider} that. "Then we'll keep running the experiment."`],
      timeout: [`answers it for you by not moving off the bed.`],
    },
  },
  {
    key: 'jealous',
    ask: `"If I got on well with somebody else — properly, not politely — would that be a problem? I'd rather find out now than the hard way."`,
    answers: [['yes', YES], ['no', NO], ['depends', /\b(depends|maybe|who|if|it'?d have to be|as long as)\b/]],
    mood: { yes: 6, depends: 8, no: 2 },
    react: {
      yes: [`"It would." {They} {do} not sound displeased about it. "That's useful. Filed."`],
      no: [`"No." A beat, and something behind the face does a small unhappy thing. "Right. Good. Very modern of you."`],
      depends: [`"Depends." {They} {nod}. "That's the honest answer and it's the one I'd have given."`],
      dodge: [`"You'd rather not have the conversation, which tells me the answer's yes."`],
      timeout: [`lets it go. "You'll find out when it happens. So will I."`],
    },
  },
  {
    key: 'worst_night',
    ask: `"What's the worst night you've ever had out there? I'm not being morbid. I'd just like to know what I'm competing with for the bad dreams."`,
    answers: [
      ['told',   /\b(when|there was|once|i was|we were|the night|year|winter|they|he|she|it was)\b/],
      ['refuse', /\b(don'?t want|not talking|leave it|drop it|no|never mind|another time)\b/],
    ],
    mood: { told: 14, refuse: 4 },
    react: {
      told: [`listens the whole way through without moving. "Thank you. I'll keep that where I keep things."`],
      refuse: [`"Alright." {They} {let} it go instantly and completely. "It's yours. You don't owe it to the room."`],
      dodge: [`"You've gone somewhere else for a second there." {They} {do} not follow you into it.`],
      timeout: [`doesn't ask twice, and sits nearer for the rest of the evening.`],
    },
  },
  {
    key: 'keep_me',
    ask: `"Why me? Out of a whole register of us. You looked at a list and you picked this. Why?"`,
    answers: [
      ['face',   /\b(face|look|pretty|beautiful|handsome|photo|picture|body|gorgeous)\b/],
      ['words',  /\b(what you said|the words|listing|described|sounded|your voice|the way you put)\b/],
      ['chance', /\b(chance|random|no reason|first one|luck|guess|whim|dunno|just did)\b/],
    ],
    mood: { words: 14, face: 4, chance: 2 },
    react: {
      face: [`"The picture." {They} {laugh}, without much in it. "Well. It's a good picture. It cost enough."`],
      words: [`"You read it." {They} {is} quiet a moment. "I wrote that myself, you know. Nobody's ever mentioned it before."`],
      chance: [`"Chance." {They} {consider} that with more equanimity than it deserves. "Most of the important things are."`],
      dodge: [`"You don't know why." {They} {shrug}. "Neither do I, most days, and I've had longer to think about it."`],
      timeout: [`lets the question go. "Doesn't matter. You did."`],
    },
  },
  {
    key: 'the_end',
    ask: `"How does this end? Everything does. I'd like to know which way you think it goes."`,
    answers: [
      ['never',  /\b(never|doesn'?t|it won'?t|not going to|forever|always|no end)\b/],
      ['badly',  /\b(bad|badly|die|dead|killed|prison|jail|broke|money|run out|they take)\b/],
      ['unsure', /\b(don'?t know|no idea|can'?t say|who knows|dunno|not sure)\b/],
    ],
    mood: { never: 12, unsure: 6, badly: 4 },
    react: {
      never: [`"It doesn't." {They} {do} not argue, which is either faith or manners. "Alright. Then it doesn't."`],
      badly: [`"That's my guess too." A grim little smile. "Nice to be aligned on something."`],
      unsure: [`"Neither do I." {They} {seem} comforted by that rather than otherwise.`],
      dodge: [`"You won't say it out loud in case it counts." {They} {nod}. "Fair enough. I'm the same about it."`],
      timeout: [`answers it {themself}, under {their} breath, and doesn't repeat it when asked.`],
    },
  },
  {
    key: 'body_count',
    ask: `"Do you keep count? Of the people. I've met both kinds and I've never worked out which is worse."`,
    answers: [['yes', YES], ['no', NO], ['some', /\b(some|a few|the ones|only the|i remember|certain ones|the first)\b/]],
    mood: { yes: 8, some: 12, no: 4 },
    react: {
      yes: [`"You keep count." {They} {take} that without flinching. "Then you're carrying them. That's the better of the two."`],
      no: [`"No count." {They} {look} at you a long moment. "I'm not going to make that mean anything. Not tonight."`],
      some: [`"Only some." {Their} voice softens. "That's the right answer. Nobody remembers all of them and everybody remembers one."`],
      dodge: [`"You'd rather not have that conversation in this room." {They} {let} it go. "Fine. Not in this room."`],
      timeout: [`doesn't press, and doesn't bring it up again, ever.`],
    },
  },
  {
    key: 'go_outside',
    ask: `"Would you take me out with you sometime? Not the work. Just — out. I've seen about four rooms since I got here."`,
    answers: [['yes', YES], ['no', NO], ['maybe', /\b(maybe|sometime|we'?ll see|one day|when it'?s|if it'?s safe|possibly)\b/]],
    mood: { yes: 14, maybe: 6, no: -6 },
    react: {
      yes: [`lights up before {they} can stop {themself}. "Right. Good. I'll hold you to that and I'll be insufferable about it."`],
      no: [`"No." {They} {take} it evenly. "It's not safe or it's not seemly. Either way I'd rather have the honest no."`],
      maybe: [`"Sometime." {They} {smile}, unconvinced. "That's what a maybe is for. I'll ask again."`],
      dodge: [`"You've gone vague on me. That's a no with better manners."`],
      timeout: [`looks toward the window, and doesn't ask again that evening.`],
    },
  },
  {
    key: 'my_name_real',
    ask: `"Do you want to know what I was called before the Syndicate named me? I'll tell you. I want you to actually want it first."`,
    answers: [['yes', YES], ['no', NO]],
    mood: { yes: 16, no: -4 },
    react: {
      yes: [`is quiet for a second, then {say} it — just once, quietly, and doesn't repeat it. "There. Now you've got both."`],
      no: [`"No." {They} {nod}, and something closes very neatly. "Fine. It wasn't much of a name anyway."`],
      dodge: [`"That's not a yes." {They} {let} the subject go and it doesn't come back.`],
      timeout: [`waits a long time, and then puts the question away somewhere it won't be found again soon.`],
    },
  },
  {
    key: 'good_at',
    ask: `"What am I actually good at? Not the obvious. I'd like to know what you'd say if somebody asked."`,
    answers: [
      ['skill', /\b(cook|listen|listening|talk|talking|calm|company|patient|clever|smart|read|know|organis|steady|funny|kind)\b/],
      ['bed',   /\b(bed|sex|fuck|body|mouth|that|obvious|you know what)\b/],
    ],
    mood: { skill: 14, bed: 4 },
    react: {
      skill: [`takes a second with that one. "Huh. I'd not have said that. I'm going to be pleased about it all week."`],
      bed: [`"The obvious." {They} {laugh}. "I said not the obvious. Try again tomorrow, I'll ask again."`],
      dodge: [`"You can't think of one." A beat. "That's alright. I couldn't either, for a long while."`],
      timeout: [`lets it drop, and is very slightly quieter for the rest of the evening.`],
    },
  },
  {
    key: 'who_knows',
    ask: `"Does anybody in your life know I'm here? I'm not asking to be paraded. I'm asking whether I'm a secret."`,
    answers: [['yes', YES], ['no', NO], ['some', /\b(some|a few|one|a couple|the ones who|people who matter|my crew)\b/]],
    mood: { yes: 12, some: 8, no: -4 },
    react: {
      yes: [`"Good." {They} {do} not make a thing of it, but the shoulders come down half an inch.`],
      no: [`"Nobody." {They} {take} it on the chin. "Alright. I've been worse things than a secret."`],
      some: [`"A few." {They} {nod}. "That's more than most in my position get. I'll take it."`],
      dodge: [`"You'd have said yes if it were yes." {They} {let} you off it anyway.`],
      timeout: [`doesn't push, and changes the subject kindly.`],
    },
  },
  {
    key: 'anger',
    ask: `"What do you do when you're properly angry? I'd rather know the shape of it in advance than find out."`,
    answers: [
      ['quiet',   /\b(quiet|go quiet|silent|nothing|walk|leave|shut down|withdraw|cold)\b/],
      ['loud',    /\b(shout|yell|loud|break|throw|smash|hit|swear|rage)\b/],
      ['nothing', /\b(don'?t get angry|never angry|not really|i don'?t)\b/],
    ],
    mood: { quiet: 8, loud: 6, nothing: 2 },
    react: {
      quiet: [`"Quiet." {They} {nod}. "That one I can work with. I can hear a quiet coming."`],
      loud: [`"Loud." {They} {consider} it without alarm. "Fine. Loud burns off. It's the quiet ones that keep."`],
      nothing: [`"Never angry." {They} {look} at you for a moment. "Then it's going somewhere. I'll keep an eye out for where."`],
      dodge: [`"You won't say, which usually means it's ugly." {They} {let} it stand. "I've handled ugly."`],
      timeout: [`files it under things to find out the hard way, and hopes not to.`],
    },
  },
  {
    key: 'kept_before',
    ask: `"Have you done this before? Kept somebody. I'd like to know whether I'm following anyone."`,
    answers: [['yes', YES], ['no', NO]],
    mood: { no: 10, yes: 6 },
    react: {
      no: [`"First." {They} {is} quiet. "Then neither of us knows what we're doing. That's oddly comforting."`],
      yes: [`"So there was somebody." {They} {do} not ask what happened. "I'll not ask what happened."`],
      dodge: [`"You've gone careful. There was somebody, then." {They} {leave} it there.`],
      timeout: [`draws {their} own conclusion and keeps it entirely to {themself}.`],
    },
  },
  {
    key: 'nickname',
    ask: `"You've got a name for me you use when you're not talking to me. Everyone does. What's it?"`,
    answers: [
      ['sweet', /\b(love|darling|sweetheart|dear|beautiful|angel|sunshine|treasure|pet)\b/],
      ['rude',  /\b(trouble|menace|nightmare|monster|brat|the problem|disaster|handful)\b/],
      ['none',  /\b(nothing|no name|just your name|your name|i don'?t|none)\b/],
    ],
    mood: { sweet: 12, rude: 10, none: 4 },
    react: {
      sweet: [`goes faintly pink and covers it badly. "Well. Don't stop, now I know it's there."`],
      rude: [`"That's the one, is it." {They} {look} delighted. "Right. That's mine now. I'm keeping it."`],
      none: [`"Just my name." {They} {consider} that. "That's the rarest one, actually. Most people can't manage it."`],
      dodge: [`"You won't tell me. So it's either very rude or very soft and I know which one I'm hoping for."`],
      timeout: [`decides {they}'d rather not know after all, and lets it go.`],
    },
  },
  {
    key: 'bad_day_help',
    ask: `"When it's a bad day — the real kind — what actually helps? Tell me and I'll just do it, no discussion required."`,
    answers: [
      ['alone',  /\b(alone|space|nothing|leave me|by myself|on my own|quiet|silence)\b/],
      ['touch',  /\b(touch|hold|held|near|close|beside|next to|arms|lie down)\b/],
      ['drink',  /\b(drink|drunk|smoke|drugs|get out of it|numb|bottle)\b/],
    ],
    mood: { touch: 12, alone: 6, drink: 4 },
    react: {
      alone: [`"Space." {They} {nod} once. "Then say the word on the night and I'll go through without it meaning anything."`],
      touch: [`"That I can do." {They} {sound} relieved to have a task. "That I'm actually good at."`],
      drink: [`"Right." {They} {do} not moralise about it. "Then I'll pour and I'll sit with you while you do it."`],
      dodge: [`"Nothing helps." {They} {take} that at face value. "Then I'll be nearby being useless. That's the offer."`],
      timeout: [`says nothing else about it, and quietly works it out over the following weeks.`],
    },
  },
  {
    key: 'lie_to_me',
    ask: `"Would you lie to me to keep me from worrying? Answer honestly, which is a genuinely funny thing to ask."`,
    answers: [['yes', YES], ['no', NO]],
    mood: { no: 12, yes: 6 },
    react: {
      no: [`"No." {They} {hold} your eye. "Then I'll believe you every time, and that's a thing you can spend. Spend it carefully."`],
      yes: [`"You would." {They} {take} it without offence. "At least you told me the truth about lying. That's something."`],
      dodge: [`"That's a yes with a hat on." {They} {smile} at you anyway.`],
      timeout: [`lets the silence answer, and decides to believe the generous version of it.`],
    },
  },
  {
    key: 'growing_old',
    ask: `"What happens to me when I'm not this anymore? I don't mean tomorrow. I mean the arithmetic of it."`,
    answers: [
      ['stay',  /\b(stay|here|with me|keep you|still here|never|always|nothing changes)\b/],
      ['money', /\b(money|paid|set up|provide|look after|sorted|fund|savings)\b/],
      ['unsure',/\b(don'?t know|no idea|haven'?t thought|dunno|can'?t say)\b/],
    ],
    mood: { stay: 16, money: 8, unsure: 2 },
    react: {
      stay: [`doesn't answer for a moment. "You say that easily. I'm going to hold it anyway."`],
      money: [`"Provided for." {They} {nod}. "That's the practical answer and it's a kind one. It isn't the one I asked for."`],
      unsure: [`"You haven't thought about it." {Their} mouth twists. "No. Why would you. I've thought about very little else."`],
      dodge: [`"That's the question everybody dodges. Don't feel singled out."`],
      timeout: [`lets it go, and is somewhere else for a while afterwards.`],
    },
  },
  {
    key: 'watched',
    ask: `"Do you ever get the feeling somebody's watching this place? I do. I'd like to know if it's just me being kept indoors too long."`,
    answers: [['yes', YES], ['no', NO]],
    mood: { yes: 8, no: 6 },
    react: {
      yes: [`"So it's not just me." {They} {look} at the window without moving toward it. "Right. Good. Bad, but good."`],
      no: [`"Just me, then." {They} {let} out a breath. "That's the better answer, even if I don't quite believe it."`],
      dodge: [`"You've not said no." {They} {check} the window on the way past, casually, on other business.`],
      timeout: [`stops asking, and starts sitting where the door is in {their} sightline.`],
    },
  },
  {
    key: 'favourite_room',
    ask: `"Which room in this place is actually yours? Not the biggest. The one you'd sit in if nobody was watching."`,
    answers: [
      ['here',  /\b(here|this one|this room|with you|where you are)\b/],
      ['other', /\b(kitchen|bath|window|roof|balcony|deck|bed|study|the small|the back)\b/],
      ['none',  /\b(none|don'?t|nowhere|not really|never thought)\b/],
    ],
    mood: { here: 14, other: 8, none: 4 },
    react: {
      here: [`"This one." {They} {look} around it like it's changed slightly. "Well. Now I like it more than I did."`],
      other: [`"Then that's where I'll find you when you're hiding." {They} {file} it away, visibly pleased with the intelligence.`],
      none: [`"Nowhere." {They} {consider} that. "Then we'll make one. That's a project, that is."`],
      dodge: [`"You've never thought about it. That's what having a lot of rooms does to a person."`],
      timeout: [`answers for you: "The one with the door you can see from." And {they}'re right.`],
    },
  },
  {
    key: 'permission',
    ask: `"Is there anything in this place I'm not allowed to touch? I'd rather have the list than find the edge of it by accident."`,
    answers: [
      ['nothing', /\b(nothing|anything|all of it|whatever you want|it'?s yours|no rules|help yourself)\b/],
      ['some',    /\b(the safe|my|don'?t touch|that one|the desk|the box|those|leave the)\b/],
    ],
    mood: { nothing: 12, some: 8 },
    react: {
      nothing: [`"Nothing at all." {They} {is} quiet a second. "Do you know how rare that sentence is? I've been counting all my life."`],
      some: [`"Understood." No argument, no curiosity, no follow-up. It's the most professional {they}'ve sounded in weeks.`],
      dodge: [`"Then I'll assume everything and you can correct me expensively."`],
      timeout: [`decides to touch nothing at all, which is its own kind of answer.`],
    },
  },
  {
    key: 'why_stay_out',
    ask: `"You could stop, you know. You've got enough. Why do you keep going back out there?"`,
    answers: [
      ['money',  /\b(money|credits|need|rent|debt|owe|pay|not enough|broke)\b/],
      ['love',   /\b(like it|love it|good at|alive|bored|boring|can'?t stop|need to|it'?s what i)\b/],
      ['duty',   /\b(have to|someone|people|owe|promised|they need|obligation|job)\b/],
    ],
    mood: { love: 10, duty: 8, money: 4 },
    react: {
      money: [`"Money." {They} {nod}. "That's the answer everybody starts with. Ask yourself again in a year."`],
      love: [`"Because you like it." {They} {do} not look surprised. "At least that's true. I can plan around true."`],
      duty: [`"For somebody else." {Their} mouth does something complicated. "That's the one I can't argue with, and I'd like to."`],
      dodge: [`"You don't know why you go out." {They} {let} it be. "That's the most honest version and the worst one."`],
      timeout: [`answers it {themself}, quietly: "Because in here nobody needs you."`],
    },
  },
  {
    key: 'touch_me',
    ask: `"Do you touch me because you want to, or because you think I'm expecting it? Genuine question. I've had both."`,
    answers: [
      ['want',   /\b(want|because i want|of course|obviously|i like|i do)\b/],
      ['owed',   /\b(expected|supposed|should|owe|paid|meant to|because you)\b/],
      ['unsure', /\b(don'?t know|both|not sure|hadn'?t thought|dunno)\b/],
    ],
    mood: { want: 14, unsure: 4, owed: -4 },
    react: {
      want: [`"Because you want to." {They} {breathe} out. "Good. That's the one I was hoping for and the one I'd never have asked twice for."`],
      owed: [`"Because it's expected." {They} {is} very still. "Then stop. I'd rather nothing than a duty."`],
      unsure: [`"Both." {They} {nod} slowly. "That's most people. It's not the worst thing I've been told tonight."`],
      dodge: [`"You'd rather not look at it." {They} {let} you not look at it.`],
      timeout: [`doesn't touch you for the rest of the evening, and it isn't a punishment. It's an answer.`],
    },
  },
  {
    key: 'song',
    ask: `"Is there a song you'd have played if this place had music in it? I'll learn it. I've got the time and the terminal."`,
    answers: [
      ['named', /\b(the|a|song|track|one about|that one|by|old)\b/],
      ['none',  /\b(no|don'?t|nothing|not really|never listen|dunno)\b/],
    ],
    mood: { named: 10, none: 4 },
    react: {
      named: [`repeats it back to make sure {they}'ve got it, and gets it slightly wrong, and doesn't correct it.`],
      none: [`"No music at all." {They} {look} faintly appalled. "Right. That's a project. I'm taking it on."`],
      dodge: [`"You can't think of one." {They} {shrug}. "I'll pick. You'll hate it. That's the fun."`],
      timeout: [`hums something anyway, low, for a while afterwards.`],
    },
  },
  {
    key: 'if_i_asked',
    ask: `"If I asked you for something — a real thing, not a drink — would you say yes because it's easy, or would you actually think about it?"`,
    answers: [
      ['think', /\b(think|consider|depends|weigh|properly|seriously|listen)\b/],
      ['yes',   /\b(yes|anything|of course|whatever you want|say yes|always)\b/],
    ],
    mood: { think: 12, yes: 8 },
    react: {
      think: [`"You'd think about it." {They} {nod}, satisfied. "That's worth more than a yes. A yes is cheap and I've had plenty."`],
      yes: [`"Anything." {They} {look} at you steadily. "Careful. I'm going to test that one day and I'm not going to warn you."`],
      dodge: [`"That's not an answer, which is fine — it means I'll have to just ask and find out."`],
      timeout: [`doesn't ask the real thing tonight. {They} {was} going to.`],
    },
  },
  {
    key: 'silence_ok',
    ask: `"Is it alright if we don't talk for a bit? I want to check that the quiet's comfortable and not just me running out of things."`,
    answers: [['yes', YES], ['no', NO]],
    mood: { yes: 10, no: 4 },
    react: {
      yes: [`settles, and doesn't say another word for a long, easy while.`],
      no: [`"Then I'll keep going." {They} {do}, about nothing in particular, and it's better than the quiet would have been.`],
      dodge: [`takes the non-answer as a yes and goes companionably silent.`],
      timeout: [`{smile} very slightly. "There we are. That's the answer, isn't it."`],
    },
  },
  {
    key: 'proud',
    ask: `"What's the one thing you've done that you're actually proud of? Not the impressive one. The one you'd want said about you."`,
    answers: [
      ['told',  /\b(i|we|when|once|the time|helped|saved|built|got|kept|made|never)\b/],
      ['none',  /\b(nothing|none|can'?t think|no idea|not much|dunno)\b/],
    ],
    mood: { told: 14, none: 6 },
    react: {
      told: [`listens right through it and doesn't interrupt once. "That'll be the one they say. I'd have picked it too."`],
      none: [`"Nothing at all." {They} {do} not accept it. "Give it time. I'll find one for you and tell you what it is."`],
      dodge: [`"You don't want to say it out loud in case it sounds small. It won't have been small."`],
      timeout: [`lets it sit, and later, out of nowhere, names one for you.`],
    },
  },
];

export const MORE_DYNAMIC = [
  {
    key: 'nearly_dead',
    applies: (c) => c.hpPct < 0.5,
    ask: (c) => `has gone very still. "You're at ${Math.round(c.hpPct * 100)} percent and you walked in here like it was a Tuesday. Did you nearly not come back tonight?"`,
    answers: [['yes', YES], ['no', NO]],
    mood: { yes: 12, no: 4 },
    react: {
      yes: [`"You nearly didn't." {They} {sit} down, which {they} {do} not usually do mid-conversation. "Right. Give me a minute with that."`],
      no: [`"No." {They} {do} not believe you and {do} not say so. "Sit down anyway. Humour me."`],
      dodge: [(c) => `"${Math.round(c.hpPct * 100)} percent, and a joke." {They} {go} to get the water hot.`],
      timeout: [`says nothing at all, and doesn't leave the room for the rest of the night.`],
    },
  },
  {
    key: 'small_hours',
    applies: (c) => c.hour >= 2 && c.hour < 5,
    ask: (c) => `"It's ${c.hour} in the morning and neither of us is asleep. What's the thing that's keeping you up? This hour's the only one that gets true answers."`,
    answers: [
      ['told',   /\b(work|money|someone|dead|afraid|scared|thinking|can'?t stop|worried|debt|them)\b/],
      ['nothing',/\b(nothing|no reason|just am|habit|always|dunno|not tired)\b/],
    ],
    mood: { told: 14, nothing: 4 },
    react: {
      told: [`doesn't offer a single piece of advice, which is the best thing anybody's done about it in months.`],
      nothing: [`"Nothing keeping you up." {They} {nod}. "That's what I say too. It's never been true once."`],
      dodge: [`"Not at this hour, then." {They} {settle} in anyway, awake for as long as you are.`],
      timeout: [(c) => `checks the clock — ${c.hour} — and stops expecting an answer, and stays up regardless.`],
    },
  },
  {
    key: 'starving',
    applies: (c) => c.hunger <= 25 && c.thirst <= 25,
    ask: (c) => `"You're running on nothing. Both — food and water, ${Math.round(c.hunger)} and ${Math.round(c.thirst)} by the look of you. Is this on purpose?"`,
    answers: [
      ['purpose', /\b(yes|on purpose|fasting|saving|no money|couldn'?t afford|deliberate)\b/],
      ['forgot',  /\b(forgot|busy|no time|didn'?t think|lost track|no|nope)\b/],
    ],
    mood: { forgot: 6, purpose: 2 },
    react: {
      purpose: [`"Deliberate." {They} {do} not argue about it. "Then eat because I'm asking, not because you need it."`],
      forgot: [`"You forgot." {They} {is} already up. "That's the one I can fix. Sit."`],
      dodge: [`"You'll not answer, and I'll cook anyway. It's a very stable system."`],
      timeout: [`goes and puts something in front of you without another word about it.`],
    },
  },
  {
    key: 'wanted_charge',
    applies: (c) => !!c.charge && c.stars >= 1,
    ask: (c) => `"The word on the wire is "${c.charge}". I'd like to hear your version before I hear anyone else's."`,
    answers: [
      ['did',    /\b(i did|yes|guilty|it was me|true|yeah|of course i)\b/],
      ['didnt',  /\b(no|didn'?t|wasn'?t me|set up|framed|lie|not true|bad information)\b/],
      ['worse',  /\b(worse|more than|there'?s more|other things|that'?s the least)\b/],
    ],
    mood: { did: 8, worse: 10, didnt: 6 },
    react: {
      did: [`"You did." {They} {take} it without a flicker. "Then that's the version I'll be repeating. Word for word."`],
      didnt: [`"Then somebody's spending money on you." {Their} eyes narrow. "That's worse than the charge, usually."`],
      worse: [`"Worse than the charge." {They} {laugh} once, entirely without humour. "Naturally. Sit down and tell me all of it."`],
      dodge: [(c) => `"You'd rather not say, with "${c.charge}" on the wire." {They} {let} it go. "Then I'll say nothing to anyone, which I'd have done regardless."`],
      timeout: [`stops asking, and starts thinking about what {they}'d say at a door.`],
    },
  },
  {
    key: 'long_tenure',
    applies: (c) => c.daysKept >= 40,
    ask: (c) => `"${c.daysKept} days. I've been here longer than I've been anywhere since I was a {kid}. Does that land for you at all, or is it just a number on a bill?"`,
    answers: [
      ['lands',  /\b(lands|yes|of course|it does|means|matters|noticed|counted)\b/],
      ['number', /\b(number|no|just a|hadn'?t|bill|hadn'?t noticed|don'?t count)\b/],
    ],
    mood: { lands: 16, number: -4 },
    react: {
      lands: [`"It lands." {They} {look} away, and then back. "Right. Good. That's — right."`],
      number: [`"A number." {They} {nod} slowly, absorbing it properly. "Alright. At least I know which of us is counting."`],
      dodge: [(c) => `"${c.daysKept} days and you've dodged it. That's almost impressive."`],
      timeout: [(c) => `"${c.daysKept}," {they} {say}, to nobody. "I'll keep counting on my own, then."`],
    },
  },
  {
    key: 'broke_soon',
    applies: (c) => c.dailyRate > 0 && (c.credits + c.bank) < c.dailyRate,
    ask: () => `"There isn't a day's rate in the account. I'm not asking for money. I'm asking whether you'd like me to go quietly before they come loudly."`,
    answers: [
      ['stay', /\b(stay|no|don'?t go|not going|i'?ll fix|handle it|never|please)\b/],
      ['go',   /\b(go|leave|maybe you should|yes|better if|safer)\b/],
    ],
    mood: { stay: 10, go: -12 },
    react: {
      stay: [`"Then I'll stay and we'll both be stupid about it together."`],
      go: [`is quiet a long moment. "Right. I'll pack tonight and be no trouble about it." {They} {do} not pack tonight.`],
      dodge: [`"You can't say it." {They} {nod}. "Then I'll stay until somebody makes me. That's my answer to your non-answer."`],
      timeout: [`starts, very quietly, putting things into an order that could become a bag quickly.`],
    },
  },
  {
    key: 'after_miss',
    applies: (c) => c.missed >= 1,
    ask: () => `"A draft's already gone through unpaid. When they come for me — and they do come — do you want me to fight it or go with them?"`,
    answers: [
      ['fight', /\b(fight|resist|don'?t go|stay|never|i'?ll stop them|no)\b/],
      ['go',    /\b(go|don'?t fight|with them|safer|yes|do what they say|comply)\b/],
    ],
    mood: { fight: 8, go: 4 },
    react: {
      fight: [`"Fight it." {They} {look} at you a long moment. "You've never seen them work. I'll do it anyway."`],
      go: [`"Go quietly." {They} {nod}. "That's the sensible answer. I hate it and I'll do it."`],
      dodge: [`"You've not decided." {They} {say} it flatly. "Then decide before they knock, because I won't have time to ask."`],
      timeout: [`answers it {themself}, silently, and you'll find out which way when it happens.`],
    },
  },
  {
    key: 'storm_outside',
    applies: (c) => c.severity >= 0.7,
    ask: (c) => `nods at the window. "It's ${c.weather} and it's getting worse. Are you going back out in that tonight? Say now, so I know whether to sleep."`,
    answers: [['yes', YES], ['no', NO]],
    mood: { no: 10, yes: -4 },
    react: {
      no: [`"Then that's the night settled." {They} {sound} genuinely relieved and doesn't hide it.`],
      yes: [`"You are." {They} {do} not argue. "Then take the heavier one and don't tell me what it looked like out there."`],
      dodge: [(c) => `"${c.weather}, and you won't say." {They} {leave} the warm things by the door either way.`],
      timeout: [`puts the heavy coat where you'll trip over it, which is the whole argument, made silently.`],
    },
  },
  {
    key: 'freezing',
    applies: (c) => c.tempC <= 0,
    ask: (c) => `takes your hands without asking. "${Math.round(c.tempC)} degrees out there and you've come in with hands like this. How long were you standing still?"`,
    answers: [
      ['long',  /\b(hour|hours|ages|a while|all night|long|waiting|watching)\b/],
      ['short', /\b(minutes|not long|no time|just got|quick|straight)\b/],
    ],
    mood: { long: 8, short: 4 },
    react: {
      long: [`"Waiting for something in that." {They} {do} not ask what. "Sit by the heat and give me your hands back."`],
      short: [`"Not long, in this." {They} {is} unconvinced. "Then it's colder than the reading. Sit down anyway."`],
      dodge: [`doesn't push, and doesn't give your hands back either.`],
      timeout: [`warms your hands between {theirs} in silence until they're somebody's hands again.`],
    },
  },
  {
    key: 'two_of_us',
    applies: (c) => !!c.companionName,
    ask: (c) => `keeps {their} voice light. "When it's the two of us in a room — me and ${c.companionName} — do you ever wish it was just the one? You can say."`,
    answers: [
      ['both',   /\b(both|no|never|like it|want both|keep both|the two of you)\b/],
      ['one',    /\b(sometimes|yes|just you|one|occasionally|now and then)\b/],
      ['refuse', /\b(not answering|won'?t|unfair|not saying|no comment)\b/],
    ],
    mood: { both: 10, one: 8, refuse: 4 },
    react: {
      both: [`"Both of us." {They} {nod}. "Good. I'll tell ${''}nobody you said that, obviously."`],
      one: [(c) => `"Sometimes." {They} {take} it evenly. "That's honest. I'll not repeat it to ${c.companionName} and neither will you."`],
      refuse: [`"You won't answer." {They} {smile}, almost approving. "That's the correct play. I'd have done the same."`],
      dodge: [`"Mm." {They} {let} it drop. "Forget I asked. It's a question that only causes weather."`],
      timeout: [(c) => `lets it go entirely, and is markedly kind to ${c.companionName} for the rest of the evening.`],
    },
  },
];
