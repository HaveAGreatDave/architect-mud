// plugins/outings/lines.js
//
// What people at a night out or a house party say and do while you're in the room. Each line
// is a function of (a, b, rest, c): a is the one doing it, b someone else there, rest the rest
// of the group by name, c a third person (b again if there are only two). Pools are by kind
// ('house' or 'bar') and by stage of the night: early, peak and late, by how much of it has gone.
// Content only: nothing here decides anything.

// ── Anywhere, any time ──────────────────────────────────────────────────────
const WOO = [
  (a) => `${a} throws both hands in the air. "Wooo!"`,
  (a, b) => `${a} and ${b} put their hands up and go "Wooo!" at nothing in particular.`,
  (a, b, rest) => `${a} shouts "Wooo!" and ${rest} all shout it back.`,
  (a) => `${a} gets up on a chair, arms up. "WOOOO!" Somebody gets them down.`,
  (a, b) => `${a} grabs ${b}'s wrist and pumps their arm in the air. "Wooo!" ${b} goes along with it.`,
  (a) => `${a} goes "Wooo!" on their own, looks round, and goes "wooo" again, quieter.`,
  (a, b) => `The song changes. ${a} and ${b} both scream and put their hands up.`,
  (a, b, rest) => `${a} raises a drink. "To us!" ${rest}: "To us! Wooo!"`,
];

const DRINK = [
  (a, b) => `${a} pours ${b} a drink that's mostly vodka.`,
  (a, b) => `${a} and ${b} do a shot, pull the same face, and do another.`,
  (a) => `${a} drinks half a can in one go and burps the first two letters of the alphabet.`,
  (a, b) => `${a} tells ${b}, "I'm on water after this one." They aren't.`,
  (a, b, rest) => `${a} lines up shots for ${rest}. Nobody asks what's in them.`,
  (a, b) => `${a} opens a bottle with their teeth. ${b} winces.`,
  (a, b) => `${a} says to ${b}, "Tastes like batteries. Want some?"`,
  (a) => `${a} holds up an empty glass and looks sad until somebody fills it.`,
  (a, b) => `${a} mixes ${b} something blue. ${b} drinks it anyway.`,
];

const SMOKE = [
  (a, b) => `${a} asks ${b} for a light. ${b} has three lighters and none of them work.`,
  (a, b) => `${a} and ${b} go outside for a cigarette and come back twenty minutes later.`,
  (a) => `${a} lights a cigarette off the stove.`,
  (a, b) => `${a} says, "I quit," and takes one of ${b}'s cigarettes.`,
  (a, b) => `${a} blows a smoke ring. ${b} pokes a finger through it.`,
  (a) => `${a} rolls one, drops it, and rolls another.`,
  (a, b) => `${a} passes ${b} the end of a joint. "Don't bogart it."`,
];

const DRUGS = [
  (a, b) => `${a} shows ${b} a little bag. They both go to the bathroom.`,
  (a, b) => `${a} rubs their gums and tells ${b} they love them. Really, genuinely.`,
  (a) => `${a} has gone very quiet and is staring at their own hand.`,
  (a, b) => `${a} asks ${b}, "Is it hot in here, or is it me?" It's them.`,
  (a, b) => `${a} offers ${b} a pill. "It's fine. It's from a guy."`,
  (a) => `${a}'s jaw is going sideways. They're having a lovely time.`,
  (a, b) => `${a} says to ${b}, "I can hear the colours." ${b}: "Shh. Don't ruin it."`,
  (a, b) => `${a} and ${b} split a pill with a bus pass.`,
];

const TALK = [
  (a, b) => `${a} says to ${b}, "I didn't even want to come out tonight." They're having the best time.`,
  (a, b) => `${a} asks ${b}, "Who invited him?" Nobody knows.`,
  (a, b) => `${a} tells ${b}, "We should do this every week." They said that last time.`,
  (a, b) => `${a} says, "This is my song!" ${b}: "You said that about the last one."`,
  (a, b) => `${a} says to ${b}, "I'm not drunk, I'm just tired." Then they fall over a bit.`,
  (a, b) => `${a} shows ${b} a picture on their tablet. ${b} says "aww" without looking.`,
  (a, b) => `${a} asks ${b}, "Are you having fun? You look like you're not having fun."`,
  (a, b, rest, c) => `${a} tells ${b} a secret about ${c}. Loudly. ${c} is right there.`,
  (a, b) => `${a} says to ${b}, "Promise me we're getting food after." ${b} promises.`,
  (a, b) => `${a} and ${b} agree that work can go to hell. They clink on it.`,
  (a, b) => `${a} asks ${b}, "Do you think the Architect can see us right now?" ${b}: "God, I hope so."`,
  (a, b) => `${a} tells ${b}, "You're my best friend." They met at nine.`,
];

// ── House parties ───────────────────────────────────────────────────────────
const HOUSE_EARLY = [
  (a, b) => `${a} turns the music up. ${b} turns it back down.`,
  (a) => `${a} puts crisps in a bowl like a grown-up.`,
  (a, b) => `${a} tells ${b} the flat's bigger than it looks. It isn't.`,
  (a, b, rest) => `${a} hands round drinks to ${rest}.`,
  (a, b) => `${a} asks ${b} where to put their coat. ${b} points at the bed, which is already a pile.`,
  (a, b) => `${a} and ${b} stand by the snacks pretending not to be by the snacks.`,
  (a) => `${a} checks the door every time somebody walks past outside.`,
  (a, b) => `${a} asks ${b}, "Is anyone else coming?" ${b}: "Loads. Probably."`,
];

const HOUSE_PEAK = [
  (a, b) => `${a} and ${b} end up in the kitchen, the way people do.`,
  (a) => `Somebody bangs on the wall. ${a} bangs back, in time with the music.`,
  (a, b) => `${a} finds the last of the good stuff and shares it with ${b}.`,
  (a, b) => `${a} spills something on ${b}'s shoes and apologises twice.`,
  (a, b, rest) => `${a} turns the lights off. ${rest} cheer. Somebody turns them back on.`,
  (a, b) => `${a} and ${b} dance on the sofa. The sofa doesn't like it.`,
  (a) => `${a} takes over the music and plays the same song three times.`,
  (a, b) => `${a} sticks their head out of the window and shouts "WOOO!" at the street. ${b} pulls them back in.`,
  (a, b, rest) => `${a} starts a drinking game. Nobody, ${rest} included, understands the rules.`,
  (a, b) => `There's a queue for the bathroom. ${a} and ${b} have been in there a while.`,
  (a, b) => `${a} finds ${b}'s jacket and wears it as a hat.`,
  (a) => `${a} opens the fridge, stands in its light for a while, and shuts it.`,
  (a, b) => `${a} and ${b} sing the chorus at each other with their eyes shut.`,
  (a, b, rest, c) => `${a} tries to get ${c} to dance. ${c} says no, then dances the most.`,
];

const HOUSE_LATE = [
  (a) => `${a} is asleep in the bath, fully dressed, holding a can.`,
  (a, b) => `${a} and ${b} sit on the kitchen floor eating cereal out of the box.`,
  (a, b) => `${a} tells ${b} something real about their dad. ${b} listens.`,
  (a) => `${a} puts on a slow song and nobody stops them.`,
  (a, b) => `${a} asks ${b} if they've seen their other shoe. Nobody has.`,
  (a, b) => `${a} says to ${b}, "One more and then I'll go." That was three ago.`,
  (a) => `${a} lies on the floor with their eyes shut and says "wooo" very quietly.`,
  (a, b) => `${a} draws on ${b}'s arm with a pen while ${b} is dozing.`,
  (a, b) => `${a} and ${b} have a deep talk about whether fish get thirsty.`,
];

// ── Bars and clubs ──────────────────────────────────────────────────────────
const BAR_EARLY = [
  (a, b, rest) => `${a} buys a round for ${rest}.`,
  (a, b) => `${a} tells ${b} a story. ${b} doesn't believe a word of it.`,
  (a, b) => `${a} and ${b} argue about the hockey.`,
  (a, b) => `${a} steals one of ${b}'s chips.`,
  (a) => `${a} checks the time and orders another anyway.`,
  (a, b) => `${a} asks ${b} what they're having. ${b} says, "Whatever's cheapest."`,
  (a, b) => `${a} and ${b} fight over who's paying. ${a} loses on purpose.`,
];

const BAR_PEAK = [
  (a, b) => `${a} pulls ${b} onto the floor. ${b} goes, complaining.`,
  (a, b) => `${a} laughs at something ${b} said, louder than it deserved.`,
  (a, b) => `${a} leans over to ${b} and points out somebody across the room.`,
  (a, b, rest) => `${a} bangs the table. "Shots!" ${rest}: "SHOTS!"`,
  (a) => `${a} asks the bar to put on something with a beat. The bar does not.`,
  (a, b) => `${a} and ${b} dance badly on purpose, then badly by accident.`,
  (a, b) => `${a} tries to get ${b} to sing karaoke. There isn't any karaoke.`,
  (a) => `${a} stands on the rail of the bar, hands up, until somebody behind it looks over.`,
  (a, b) => `${a} sends a drink over to a stranger and then hides behind ${b}.`,
  (a, b, rest) => `${a} starts a chant. ${rest} join in. Nobody knows what it's for.`,
  (a, b) => `${a} loses ${b} in the crowd and finds them at the bar with new friends.`,
];

const BAR_LATE = [
  (a, b) => `${a} tells ${b}, "I love this place." It's a dump.`,
  (a) => `${a} is asleep against the wall, upright, with a straw in their mouth.`,
  (a, b) => `${a} asks ${b} if they're getting a kebab. They are.`,
  (a, b) => `${a} gives ${b} a long hug for no reason.`,
  (a) => `${a} tries to order and the bar says no.`,
  (a, b) => `${a} has ${b}'s drink. ${b} has nobody's drink.`,
  (a, b) => `${a} and ${b} sing the last song all the way through, wrong.`,
];

// Picks a pool for the moment. stage is 0..1, how much of the night has gone.
// The general pools (woo, drink, smoke, drugs, talk) come up often everywhere; the stage
// pools give the night its shape.
export function linesFor(kind, stage) {
  const house = kind === 'house';
  const staged = stage < 0.25 ? (house ? HOUSE_EARLY : BAR_EARLY)
    : stage < 0.75 ? (house ? HOUSE_PEAK : BAR_PEAK)
      : (house ? HOUSE_LATE : BAR_LATE);
  // Early on people talk and drink; the woos and the bathroom trips come later.
  if (stage < 0.25) return [staged, staged, TALK, DRINK, SMOKE];
  if (stage < 0.75) return [staged, staged, WOO, WOO, DRINK, SMOKE, DRUGS, TALK];
  return [staged, staged, staged, TALK, SMOKE, DRUGS, WOO];
}

export const _pools = { WOO, DRINK, SMOKE, DRUGS, TALK, HOUSE_EARLY, HOUSE_PEAK, HOUSE_LATE, BAR_EARLY, BAR_PEAK, BAR_LATE };
