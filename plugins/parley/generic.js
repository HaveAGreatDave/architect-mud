// parley: what anybody says when they have nothing of their own written for it.
//
// Lines by act, then by personality archetype (`flags.personality`). An NPC's own
// `flags.parley.react` always wins; these fill the gaps, so somebody with no parley
// data at all still answers a greeting, a thank-you or "what's your name?".
// {first} is the NPC's first name, {name} the player. Keep them short and plain.

const BASE = {
  greet: ['Hello.', 'Hi.', '*nods.* Alright?', 'Evening.'],
  farewell: ['See you.', 'Take care.', '*nods.* Bye.'],
  thank: ['No problem.', 'Sure.', 'Any time.'],
  praise: ['Oh. Thanks.', 'That\'s nice of you.'],
  insult: ['Charming.', 'Right. Okay.', '*stares at you.* Wow.'],
  insult_last: ['I\'m done talking to you.', '*turns away.* Leave me alone.'],
  flirt: ['*laughs, a bit awkward.* Okay.', 'Steady on.', 'You don\'t even know me.'],
  apologise: ['It\'s fine.', 'Forget it.'],
  joke: ['*snorts.* Fair.', 'Ha.'],
  complain: ['Not my problem, sorry.', 'Take it up with someone who cares.'],
  ask_feeling: ['Fine. You?', 'Getting by.', 'Could be worse.'],
  order_drink: ['I don\'t sell drinks. Try a bar.'],
  ask_name: ['{first}.', 'It\'s {first}.', '{first}. And you are?'],
  // Somebody the game calls by what they are ("a chrome attendant") has no name to give.
  ask_name_unnamed: ['No name. Just the job.', 'Nobody gave me one.', 'Does it matter?'],
  ask_job: ['This and that.', 'Bit of everything. Nothing that pays.'],
  ask_origin: ['Here, mostly.', 'Round here. Same as everyone.'],
  ask_news: ['Nothing I\'ve heard.', 'Same as always. Rent\'s up.'],
  ask_advice: ['Keep your head down.', 'Don\'t trust anyone who smiles too much.'],
  // Company (company.js): being talked about, handing off, and passing things on.
  overheard: ['*glances over.* I can hear you, you know.', '*looks up at their name.* Hm?'],
  overheard_insult: ['I heard that.', '*stares at you.* Say it to my face.'],
  overheard_praise: ['*looks pleased, pretends not to be.*'],
  defer: ['Ask {other}. That\'s theirs.', '*nods at {other}.* They\'d know.'],
  gossip_rude: ['{other} says you were rude to them.'],
  gossip_story: ['{other} says you\'re all right.'],
  continue: ['That\'s about it.', 'Nothing more to tell.', '*shrugs.* That\'s all.'],
  agree: ['Yeah.', 'Right.'],
  disagree: ['If you say so.', 'Hm. No.'],
  deflect: ['Sorry?', 'Not sure what you mean.', '*shrugs.*', 'Okay...'],
};

// Only what's different about each kind of person.
const BY_PERSONALITY = {
  bartender: {
    greet: ['What can I get you?', 'Evening. Drink?'],
    order_drink: ['Sure. Have a look at the menu.', 'Coming up. What\'ll it be?'],
    ask_job: ['I pour drinks. You\'re looking at it.'],
    ask_news: ['People tell bartenders everything. I don\'t tell anyone anything.'],
    complain: ['Drink\'s a drink. It\'s not the Ritz.'],
  },
  vendor: {
    greet: ['Hi. Looking for anything?', 'Hello. Have a look around.'],
    ask_job: ['I sell things. You buy them. Easy.'],
    order_drink: ['Not that sort of shop.'],
    complain: ['Prices are the prices.'],
  },
  chatty: {
    greet: ['Oh, hello! How are you?', 'Hiya! Don\'t think I know you.'],
    ask_feeling: ['Oh, you know. Busy, busy. You?'],
    ask_news: ['Oh, where do I start? Actually, I\'d better not.'],
    deflect: ['Ha! Sorry, lost me there.', 'Oh, you\'re funny. I think.'],
  },
  gruff: {
    greet: ['*grunts.*', 'What.'],
    thank: ['*grunts.*'],
    ask_feeling: ['Fine.'],
    ask_name: ['Why?'],
    deflect: ['*grunts.*', 'What?'],
  },
  quiet: {
    greet: ['*nods.*', '...Hi.'],
    ask_feeling: ['*shrugs.* Okay.'],
    deflect: ['*says nothing.*', '...'],
  },
  guard: {
    greet: ['Move along.', 'Keep it moving.'],
    ask_job: ['Keeping the peace. Mostly from people like you.'],
    flirt: ['On duty.'],
    insult: ['Want to try that again? Slower?'],
    deflect: ['Move along.'],
  },
  dealer: {
    greet: ['*glances over.* Yeah?'],
    ask_name: ['Names cost extra.'],
    ask_job: ['I don\'t have a job. I have friends.'],
    ask_news: ['Not to you.'],
  },
};
BY_PERSONALITY.travelling_vendor = BY_PERSONALITY.vendor;
BY_PERSONALITY.police = BY_PERSONALITY.guard;
BY_PERSONALITY.stoic = BY_PERSONALITY.quiet;
BY_PERSONALITY.thug = BY_PERSONALITY.gruff;
BY_PERSONALITY.lowlife = BY_PERSONALITY.dealer;

// → a list of lines for this act, or null.
export function genericLines(npc, key) {
  const own = BY_PERSONALITY[npc?.flags?.personality]?.[key];
  return own || BASE[key] || null;
}
