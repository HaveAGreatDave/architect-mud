// Home life — what an NPC does in their own kitchen when nobody needs them.
//
// The street-life half of this plugin gives PUBLIC space a rhythm. This is the
// private half: an NPC who is home and off-shift makes something, eats or
// drinks it, and clears up. It is the difference between an apartment that
// contains a person and an apartment where somebody lives.
//
// IT IS NOT A SIMULATION, and that is the entire design. The NPC does not hold
// a vessel, does not run the cook clock, does not resolve a recipe and does not
// own a single database row for any of this. It picks a plausible OUTCOME up
// front — a dish from cooking's catalogue, a drink from the drinks one — and
// then narrates three or four beats toward it. Nobody watching can tell the
// difference, and the whole feature costs one timer and no writes.
//
// The nouns come from the real catalogues, so a recipe added for players turns
// up in NPC life the same day, with no edit here.
//
// Rules, all of which exist because their absence looked wrong:
//   • Home only. An NPC cooking in a bar is a bartender working, not a person.
//   • Off-shift only — the same isNpcScheduledNow gate banter uses.
//   • One household routine per zone, so a shared flat doesn't have three
//     people all frying eggs in silence.
//   • A witness must be present, and is re-checked before every beat: this is
//     scenery for whoever is in the room, not a simulation running in the dark.
//   • AND NOT IN AN ACTUAL BLACKOUT. "Something is frying" in a room with no
//     supply is the one line that makes the whole layer read as broken, so a
//     dark zone starts nothing and an in-flight scene stops where it is. What
//     plays instead is blackout.js, which is the reaction to the thing that
//     just interrupted dinner.
import { world, getZonePlayers, getZone, getZoneFurniture } from '../../server/engine/world.js';
import { isDwellingZone } from '../../server/engine/zone-tags.js';
import { sendToZone, getBroadcast } from '../../server/engine/messaging.js';
import { isNpcScheduledNow } from '../../server/engine/broadcast-bridge.js';
import { getEnvironmentState, getZoneTemperature } from '../../server/engine/environment.js';
import { feelOf } from '../../client/shared/comfort.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { npcWashAtHome } from '../../server/engine/hygiene.js';
import { query } from '../../server/models/db.js';
import { DISHES } from '../cooking/dishes.js';
import { DRINKS } from '../drinks/recipes.js';
import { isToilet, isShower } from '../bodily/index.js';
import { zoneIsDark } from './blackout.js';
import { randInt } from '../../server/engine/util.js';
import { emit } from '../../server/engine/events.js';
import { isBanterBusy } from '../../server/engine/npc-banter.js';
import { startHomeTalk, isTalking, sulkingAt } from './home-talk.js';
import { drinkUp, tipsyOf } from './tipsy.js';

const TALK_CHANCE = 0.45;   // of a household with two or more in starting a talk instead of a solo scene

const START_CHANCE = 0.35;                 // per eligible zone, per tick
const COOLDOWN_MS = [8 * 60_000, 20 * 60_000];
const BEAT_GAP_MS = [12_000, 24_000];      // domestic time is slow time

const rand = arr => arr[Math.floor(Math.random() * arr.length)];

const zoneCooldown = new Map();   // zoneId → ts
const activeHome = new Set();     // zoneId mid-routine

// ── The scenes ───────────────────────────────────────────────────────────────
// {npc} and {thing} are filled per run. Each scene is a whole small story: the
// last beat matters as much as the first, because a person who cooks and never
// washes up reads as a machine that cooks.

const MEAL = [
  [`{npc} starts pulling things out of the cupboard with the air of someone who has already decided.`,
   `Something is frying. {npc} isn't watching it as closely as they should be.`,
   `{npc} sits down to {thing} and eats the first three mouthfuls far too fast.`,
   `{npc} washes up, badly, and leaves one pan to soak.`],
  [`{npc} reads the back of a packet for a while, then puts it down and does it their own way.`,
   `{npc} gets {thing} going, and the smell of it fills the room: better than it has any right to be.`,
   `{npc} eats standing up, out of the pan, which they would deny if asked.`],
  [`{npc} chops something with more force than the task requires.`,
   `{npc} tastes it, makes a face, and adds something else.`,
   `{npc} tastes it again and nods, grudgingly satisfied.`,
   `{npc} eats {thing} slowly, and for a few minutes looks like nothing much is wrong.`],
  [`{npc} opens the fridge, shuts it, opens it again, and takes out the same three things.`,
   `{npc} gets the {thing} on and leans against the counter to wait.`,
   `{npc} eats the {thing} at the table with a tablet propped against the salt.`,
   `{npc} scrapes the pan into the bin and runs water into it.`],
  [`{npc} finds the one clean pan, wipes it anyway, and puts it on the heat.`,
   `The {thing} catches. {npc} turns the heat down, too late, and stirs.`,
   `{npc} eats the {thing} anyway, burnt bits and all.`],
  [`{npc} cooks with the radio on, singing the half of the words they know.`,
   `{npc} burns a finger on the pan, swears, and holds it under the tap.`,
   `{npc} sits down with the {thing}, one hand still wrapped in a damp cloth.`],
  [`{npc} weighs two tins in their hands, puts one back, and opens the other.`,
   `{npc} makes the {thing} in one pot and eats it out of the same pot.`,
   `{npc} leaves the pot to soak with the spoon still in it.`],
];

const DRINK = [
  [`{npc} puts something on to boil and stands there waiting for it, doing nothing else at all.`,
   `{npc} settles down with {thing} and wraps both hands around it.`],
  [`{npc} makes {thing} with the unthinking economy of someone who has made a thousand of them.`,
   `{npc} drinks it too hot, winces, and drinks it too hot again.`],
  [`{npc} pours {thing}, considers it, and tops it up.`,
   `{npc} drinks without hurrying. Whatever the day was, it's over now.`],
  [`{npc} rinses a cup that was already clean enough.`,
   `{npc} makes the {thing} and stands at the window to drink it.`],
  [`{npc} reaches for a glass, changes their mind, and takes a mug instead.`,
   `{npc} drinks the {thing} in small sips, reading something on a tablet.`,
   `{npc} looks into the empty cup for a moment and decides against a second.`],
  [`{npc} makes the {thing} and forgets it on the side.`,
   `{npc} finds the {thing} again, cold, and drinks it anyway.`],
  [`{npc} gets two cups down out of habit and puts one back.`,
   `{npc} drinks the {thing} sitting on the edge of the bed.`],
];

const TIDY = [
  [`{npc} moves around the room putting things back where they go.`,
   `{npc} stops halfway through, loses interest, and sits down.`],
  [`{npc} picks up a sock, looks around for the other one, and gives up.`,
   `{npc} moves everything on the chair onto the bed, and everything on the bed onto the chair.`],
  [`{npc} wipes down the counter, then the cooker, then the counter again.`,
   `{npc} ties off the bin bag and leaves it by the door for later.`],
  [`{npc} sweeps the floor into a small grey pile.`,
   `{npc} looks for the dustpan, can't find it, and pushes the pile under the cupboard.`],
  [`{npc} folds a pile of washing on the bed, one shirt at a time.`,
   `{npc} puts the pile in a drawer that won't quite shut, and leans on it until it does.`],
  [`{npc} washes every cup in the place and lines them up on the drainer.`,
   `{npc} counts the cups, frowns, and goes looking for the missing one.`],
];

// One side of a call. The other side is left to the imagination, which is where it's funniest.
const PHONE = [
  [`{npc}'s tablet buzzes. They look at it, sigh, and answer. "Hi, Mum."`,
   `"Yes. Yes, I'm eating. No, not just noodles."`,
   `"I have to go, there's someone at the door." There isn't. {npc} hangs up and looks relieved.`],
  [`{npc} answers a call. "Hello? No. No, I don't want to extend my warranty."`,
   `"I don't own a car. I've never owned a car."`,
   `"How do you know my blood type?" {npc} hangs up and stares at the tablet for a while.`],
  [`{npc} takes a call and goes straight into a whisper. "I can't talk now."`,
   `"Because I can't." A pause. "Because I'm in the flat."`,
   `"Fine. Same place, same time. Bring the thing." {npc} hangs up and acts normal, badly.`],
  [`{npc} rings somebody and waits a long time. "Hi, it's me. I'm calling about the boiler."`,
   `"Yes, again." {npc} listens. "No, it's not making the noise now. It makes it at night."`,
   `{npc} does an impression of the noise down the phone, quite a good one.`],
  [`{npc} is on hold. Tinny music leaks out of the tablet.`,
   `{npc} hums along to the hold music without meaning to.`,
   `Someone answers. {npc} has forgotten what they were calling about.`],
  [`{npc} answers a call. "Speaking." Their face falls. "Oh. Oh, no."`,
   `"When did it happen?" A long pause. "Was it the goose again?"`,
   `{npc} hangs up, shakes their head, and goes back to what they were doing.`],
];

// A hobby: what they'd do all day if they could.
const HOBBY = [
  [`{npc} gets a model aircraft half built out of a shoebox and squints at the instructions.`,
   `{npc} glues their finger to the wing.`,
   `{npc} gets the finger free, and the wing comes with it.`],
  [`{npc} tunes an old guitar for a long time.`,
   `{npc} plays the first four notes of a song, gets the fifth wrong, and starts again.`,
   `{npc} plays the first four notes again, then puts the guitar down, satisfied.`],
  [`{npc} sets up a little easel and starts painting the view out of the window.`,
   `{npc} steps back, tilts their head, and paints a boat in that isn't there.`],
  [`{npc} lays out a jigsaw on the floor and sorts the edge pieces.`,
   `{npc} finds a piece that doesn't belong to this puzzle and holds it up to the light.`,
   `{npc} puts the stray piece in their pocket for later.`],
  [`{npc} sits down to knit, and talks quietly to the needles.`,
   `{npc} holds up what they've made. It's either a scarf or a very long sock.`],
  [`{npc} plays a game on their tablet with the sound up.`,
   `{npc} loses, says "no" quite loudly, and starts again.`,
   `{npc} wins, and looks around for somebody to tell.`],
  [`{npc} does a crossword with a pen, confidently.`,
   `{npc} gets stuck on one clue and reads it out to themselves four times.`,
   `{npc} writes something in that doesn't fit and moves on.`],
  [`{npc} waters a row of seedlings on the windowsill and tells each one it's doing well.`,
   `{npc} pauses at the last one. "You, I'm worried about."`],
];

// Getting ready, or giving up on getting ready.
const GROOM = [
  [`{npc} trims their own fringe in a hand mirror.`,
   `{npc} evens up the left side, then the right side, then the left side again.`,
   `{npc} puts a hat on.`],
  [`{npc} tries on a shirt, looks down at it, and takes it off.`,
   `{npc} tries on a second shirt. Then the first one again.`,
   `{npc} goes with the first one, and looks like they regret it.`],
  [`{npc} cuts their toenails over the bin, mostly.`,
   `One flies off somewhere. {npc} looks for it, briefly, and gives up.`],
  [`{npc} irons a shirt on a towel on the table.`,
   `{npc} irons a crease into it that wasn't there before.`],
  [`{npc} does their hair in the reflection in the window.`,
   `{npc} gives a nod to the reflection, as if the two of them agree about something.`],
];

// Practising something they're going to say to someone else.
const REHEARSE = [
  [`{npc} stands in front of the mirror. "I'd like to talk about my wages."`,
   `{npc} tries it lower. "I'd like to TALK about my WAGES."`,
   `{npc} tries it a third way, loses their nerve, and goes and sits down.`],
  [`{npc} practises a speech to the empty room. "Thank you all for coming."`,
   `"He would have wanted..." {npc} stops. "No. He wouldn't have wanted any of this."`,
   `{npc} starts again from the top.`],
  [`{npc} rehearses an argument out loud, playing both sides.`,
   `{npc} wins the argument, and looks pleased.`,
   `{npc} thinks of the other side's best point, a bit late, and looks less pleased.`],
  [`{npc} says "no" to the mirror, firmly, a few times.`,
   `"No, I can't cover your shift." {npc} nods. "No. No, I can't."`],
];

// Something round the flat that needs fixing.
const DIY = [
  [`{npc} takes the front off a radio and looks inside it.`,
   `{npc} puts it back together with two screws left over.`,
   `{npc} turns it on. It works better than before, which annoys them.`],
  [`{npc} gets a stool down and changes a bulb, reaching up on tiptoe.`,
   `The stool wobbles. {npc} freezes, gets down, and decides the old bulb was fine.`],
  [`{npc} wraps tape round a dripping pipe under the sink.`,
   `{npc} wraps some more tape round it.`,
   `{npc} stands back. It still drips, but quieter.`],
  [`{npc} bleeds the radiator into a mug.`,
   `The radiator hisses, spits, and {npc} jumps back.`],
  [`{npc} takes a door off its hinges to fix the squeak.`,
   `{npc} spends some time getting it back on again.`,
   `{npc} opens and shuts the door. It still squeaks.`],
];

// Money: counting it, hiding it, worrying about it.
const MONEY = [
  [`{npc} counts out a pile of credit chits on the table, then counts it again.`,
   `{npc} gets a different answer the second time, and counts it a third time.`,
   `{npc} puts the pile in a sock and the sock in the freezer.`],
  [`{npc} goes through a stack of bills with a pen, crossing things off.`,
   `{npc} gets to the last one, reads it twice, and puts it at the bottom of the pile.`],
  [`{npc} checks their balance on their tablet, and puts the tablet face down.`,
   `{npc} checks it again a minute later, in case it's changed.`],
  [`{npc} finds a credit chit down the side of the sofa and holds it up like a prize.`,
   `{npc} goes back down the side of the sofa, looking for more.`],
];

// Looking at something: out of the window, at a screen, at a book.
const LEISURE = [
  [`{npc} lies on the sofa with their feet up, reading a paperback.`,
   `{npc} laughs at something in the book, then reads the line again.`,
   `{npc} falls asleep with the book open on their chest. A minute later they wake up and act like they didn't.`],
  [`{npc} puts some music on and does the washing-up in time with it.`,
   `{npc} dances a bit, then looks at the window to check no one saw.`],
  [`{npc} stands at the window watching the street.`,
   `{npc} watches someone fail to park for a while.`,
   `{npc} makes a small sound when they finally get in.`],
  [`{npc} sits on the floor with their back to the bed, scrolling.`,
   `{npc} shows the screen to nobody. "Look at this."`],
  [`{npc} lies flat on the floor in the middle of the room and looks at the ceiling.`,
   `{npc} stays there a while, then gets up as though nothing happened.`],
  [`{npc} does a few press-ups by the bed, counting out loud.`,
   `{npc} gets to seven and calls it ten.`],
  [`{npc} does some stretches, with a lot of noise for what they are.`,
   `Something in {npc}'s back clicks. They seem pleased about it.`],
];

// Late, and still up.
const NIGHT = [
  [`{npc} pads around in the dark, opens the fridge, and stands in its light.`,
   `{npc} eats something cold straight out of the container.`,
   `{npc} shuts the fridge quietly, as though somebody might be listening.`],
  [`{npc} can't sleep, and sits at the table with a glass of water.`,
   `{npc} starts writing a list, crosses most of it out, and leaves it.`],
  [`{npc} checks the lock on the door.`,
   `{npc} checks it again on the way back from the bathroom.`,
   `{npc} checks it a third time, and seems to feel better.`],
  [`{npc} is awake and on their tablet, and the screen lights up their face.`,
   `{npc} laughs at something, then covers their mouth.`],
];

// Up early, or trying to be.
const MORNING = [
  [`{npc} turns off an alarm, lies there, and turns off the second alarm.`,
   `{npc} gets up on the third alarm, and stands there for a while not doing anything.`],
  [`{npc} eats toast standing over the sink to save on crumbs.`,
   `{npc} looks at the time, swears, and leaves the crust.`],
  [`{npc} does up their boots, and then does up the other boot on the wrong foot.`,
   `{npc} sits down and starts again.`],
  [`{npc} hunts for their keys in every coat pocket.`,
   `{npc} finds the keys in their hand.`],
];

// Rare, and odd. The ones somebody watching will tell a friend about.
const ODD = [
  [`{npc} takes a small box out from under the bed, opens it, and checks what's inside.`,
   `{npc} counts whatever it is, nods, and slides the box back.`],
  [`{npc} talks to the ceiling for a moment. "If you're listening, the hot water's been off since Tuesday."`,
   `{npc} waits. Nothing happens. "Worth a go."`],
  [`{npc} takes a framed photo off the wall, looks at it, and turns it to face the wall.`,
   `{npc} turns it back round a minute later.`],
  [`{npc} practises a handshake with the coat stand.`,
   `{npc} does it again, firmer this time.`],
  [`{npc} finds a letter under the door, reads it, and puts it in the bin.`,
   `{npc} takes it back out of the bin and reads it again.`,
   `{npc} pins it to the fridge with a magnet.`],
  [`{npc} sets a little plate of food out on the windowsill.`,
   `{npc} watches it for a while, then puts it outside.`],
  [`{npc} gets a stick of chalk and draws a circle on the floor, then stands in it.`,
   `{npc} stands in the circle with their eyes shut.`,
   `{npc} opens their eyes, steps out, and rubs the circle away with a sock.`],
];

// The day after a row. {other} is the flatmate they fell out with (home-talk.js remembers who).
// A drink in the evening, the proper kind. Each counts toward how drunk they are (tipsy.js), which makes the
// next talk with a flatmate start hotter. The later ones are for somebody who's already had a few.
const BOOZE = [
  [`{npc} opens a beer and drinks the first third of it standing at the fridge.`,
   `{npc} sits down with the rest of it and puts their feet up.`],
  [`{npc} pours a measure of something brown, looks at it, and makes it a bigger measure.`,
   `{npc} drinks it slowly, with their eyes shut.`],
  [`{npc} finds half a bottle of wine at the back of the cupboard and doesn't bother with a glass.`],
  [`{npc} cracks open a can and holds it against their forehead for a second first.`,
   `{npc} finishes it and crushes the can one-handed.`],
];
const BOOZE_LATE = [
  [`{npc} opens another one and drops the cap behind the fridge.`,
   `{npc} spends a while trying to get the cap out with a fork.`],
  [`{npc} puts some music on too loud and sings along with the wrong words.`,
   `{npc} turns it down, then up again.`],
  [`{npc} tries to stand on one leg to prove something to nobody.`,
   `{npc} sits down quite suddenly.`],
  [`{npc} drafts a message to someone, reads it back, and deletes it.`,
   `{npc} writes it again, word for word, and sends it.`],
  [`{npc} eats cold beans out of the tin with a teaspoon.`,
   `{npc} tells the empty tin it was the best meal they've had all week.`],
];

const SULK = [
  [`{npc} washes up very loudly, in {other}'s general direction.`,
   `{npc} puts {other}'s mug at the back of the cupboard.`],
  [`{npc} makes one cup of tea, and doesn't ask {other} if they want one.`,
   `{npc} drinks it slowly, where {other} can see.`],
  [`{npc} sighs loudly, and waits to see if {other} heard.`,
   `{npc} sighs again, louder.`],
  [`{npc} moves {other}'s shoes from by the door to under the table.`,
   `{npc} looks at the shoes for a while, then moves them back.`],
];

// A flat past room temperature (client/shared/comfort.js). The further past it is, the more of the
// evening is about it. The supply is on, or homebodiesIn would have started nothing: this is a cold snap
// the heating can't keep up with, or a heatwave, not a blackout.
const CHILL = [
  [`{npc} rubs their arms and looks around for the draught.`,
   `{npc} pulls a blanket off the bed and wears it round their shoulders.`],
  [`{npc} blows on their hands.`,
   `{npc} puts a second jumper on over the first.`],
  [`{npc} checks the radiator with the back of a hand. It's barely warm.`,
   `{npc} stamps their feet and keeps their coat on.`],
  [`{npc} fills the kettle to have something warm to hold.`,
   `{npc} stands with both hands round the mug and doesn't drink it.`],
  [`{npc} shivers and shuts a window that was already shut.`,
   `{npc} pushes a rolled towel along the bottom of the door.`],
];
const HEAT = [
  [`{npc} opens the window as far as it goes. It doesn't help.`,
   `{npc} fans themselves with a takeaway menu.`],
  [`{npc} wipes their face on a sleeve.`,
   `{npc} runs the cold tap over their wrists for a while.`],
  [`{npc} peels their shirt away from their back.`,
   `{npc} stands in front of the open fridge until it starts to beep.`],
  [`{npc} drinks a glass of water in one go and fills it again.`,
   `{npc} holds the cold glass against their neck.`],
  [`{npc} tugs at their collar and looks at the window.`,
   `{npc} takes a layer off and leaves it on a chair.`],
];
const TEMP_CHANCE = [0.25, 0.75];   // of a scene being about the temperature: just past the edge, and at its worst

// ── The bathroom ─────────────────────────────────────────────────────────────
// The one domestic routine that is NOT pure narration, because it can't be: an
// ensuite is a real adjacent zone with a real door, so the NPC actually walks
// through it and comes back. That makes it the only routine a player can follow,
// walk in on, or find an empty room because of — which is the whole reason it's
// worth the extra machinery.
//
// It ends in npcWashAtHome(), the engine's existing abstract "someone who lives
// here keeps clean" reset. That call already happened invisibly every tick an
// NPC stood in their own home; this gives it somewhere to have happened.

const BATHROOM_MS   = [25_000, 60_000];   // how long they're gone
const BATHROOM_GOING = [
  `{npc} gets up without a word and heads for the bathroom.`,
  `{npc} says "give me a minute" to nobody in particular and goes through.`,
  `{npc} pauses mid-thought, makes a face, and goes to the bathroom.`,
  `{npc} goes into the bathroom and shuts the door.`,
];
const BATHROOM_BACK = [
  `{npc} comes back drying their hands on their trousers.`,
  `A cistern refills somewhere behind the wall. {npc} reappears, unbothered.`,
  `{npc} returns, hair damp at the temples, looking marginally more like a person.`,
  `{npc} comes back in, wiping their face, and picks up exactly where they left off.`,
];

// zoneId → { id: bathroomZoneId | null, at: ts }. A dwelling's ensuite doesn't
// move, so the positive answer is cached forever; a NEGATIVE is re-checked
// occasionally, because a builder can plumb a bathroom in at runtime and the
// alternative is that flat never having one until the next restart.
const bathroomOf = new Map();
const NEGATIVE_TTL_MS = 10 * 60_000;

function bathroomFor(zoneId) {
  const hit = bathroomOf.get(zoneId);
  if (hit && (hit.id || Date.now() - hit.at < NEGATIVE_TTL_MS)) return hit.id;

  // A bathroom is a SUB-zone of this dwelling with a fixture in it. There is no
  // bathroom flag in the world data and inventing one would mean backfilling
  // twenty-odd rooms, so this asks the question the fixtures already answer.
  let found = null;
  for (const dest of Object.values(getZone(zoneId)?.exits || {})) {
    if (getZone(dest)?.parent_zone !== zoneId) continue;
    if (getZoneFurniture(dest).some(f => isToilet(f) || isShower(f))) { found = dest; break; }
  }
  bathroomOf.set(zoneId, { id: found, at: Date.now() });
  return found;
}

// Bespoke rather than play(): the generic beat-runner aborts the moment the NPC
// isn't in the room any more, and being out of the room is the point of this one.
function playBathroom(zoneId, npc, bathId) {
  activeHome.add(zoneId);
  const done = () => { activeHome.delete(zoneId); startCooldown(zoneId); };
  const say = (pool) => sendToZone(zoneId, {
    type: 'ambient',
    message: `<span class="msg-ambient">${rand(pool).replace(/\{npc\}/g, npc.name)}</span>`,
    flavour: true,   // scenery — dropped at the Display Mode `log` rung
  });

  say(BATHROOM_GOING);
  setTimeout(() => {
    const live = world.npcs.get(npc.id);
    if (!live || live._dead || live.zone_id !== zoneId || live._combatTargetId
        || isBusyBeingUnconscious(live)) return done();
    if (!moveEntity(live, bathId, getBroadcast(), query)) return done();

    // Hold the behaviour graph off while they're in there, so the AI doesn't
    // decide mid-visit that this NPC is inexplicably away from home and path
    // them back out. Same lever sleep uses.
    const away = randInt(BATHROOM_MS[0], BATHROOM_MS[1]);
    if (live._ai) live._ai.waitUntil = Date.now() + away;

    setTimeout(() => {
      const back = world.npcs.get(npc.id);
      if (!back || back._dead) return done();
      if (back._ai) back._ai.waitUntil = null;
      // The point of the trip. Rate-limited inside, so a short interval between
      // visits just means this one was only a toilet visit.
      npcWashAtHome(back);
      if (back.zone_id === bathId && !moveEntity(back, zoneId, getBroadcast(), query)) return done();
      if (back.zone_id === zoneId && getZonePlayers(zoneId).length) say(BATHROOM_BACK);
      done();
    }, away);
  }, randInt(BEAT_GAP_MS[0], BEAT_GAP_MS[1]));
}

// A trip asked for from outside a scene: a resident on the Room Stage who needs the bathroom. False
// when the flat has none or something else is going on in it.
export function tripToBathroom(zoneId, npc) {
  if (activeHome.has(zoneId)) return false;
  const bath = bathroomFor(zoneId);
  if (!bath) return false;
  playBathroom(zoneId, npc, bath);
  return true;
}

// A plausible thing to have made. Straight off the live catalogues, so anything
// authored for players shows up here for free — and both are filtered to what a
// person would plausibly knock together at home rather than the whole list.
function pickMeal() {
  const keys = Object.keys(DISHES).filter(k => (DISHES[k].difficulty || 9) <= 6);
  return DISHES[rand(keys.length ? keys : Object.keys(DISHES))].noun;
}

function pickDrink(phase) {
  // Morning wants coffee; late evening does not.
  const morning = phase === 'dawn' || phase === 'morning';
  const keys = Object.keys(DRINKS).filter(k => {
    const t = DRINKS[k];
    if ((t.difficulty || 9) > 6) return false;
    if (morning) return t.hot;
    return true;
  });
  return DRINKS[rand(keys.length ? keys : Object.keys(DRINKS))].noun;
}

// Asleep, out cold, or otherwise horizontal. A sleeping NPC narrated frying eggs
// is the one thing that breaks the illusion outright, and the engine already
// tracks all three states — this reads them rather than inventing a fourth.
const isBusyBeingUnconscious = (npc) =>
  !!(npc._ai?.homeSleeping || npc._ai?.dosedOut || npc.posture === 'lying');

// Home, off-shift, alive, awake, and not in the middle of something else.
function homebodiesIn(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  // A KITCHEN, not a counter. Most of the cast has their own workplace registered
  // as home_zone, and cooking a meal on the shop floor is worse than saying
  // nothing — this is the same dwelling test the engine's passive ticker uses.
  if (!isDwellingZone(getZone(zoneId) || zone)) return [];
  if (zoneIsDark(zoneId)) return [];             // no supply, no dinner
  const out = [];
  for (const id of zone.npcs) {
    const npc = world.npcs.get(id);
    if (!npc || npc._dead) continue;
    if (npc.home_zone !== zoneId) continue;        // this is their place, not a shift
    if (npc._combatTargetId) continue;
    if (npc.flags?.no_home_life) continue;         // the opt-out, for anyone it reads wrong on
    if (isBusyBeingUnconscious(npc)) continue;     // asleep in the next room, not making dinner
    if (isNpcScheduledNow(npc.id)) continue;       // on shift — same gate banter uses
    out.push(npc);
  }
  return out;
}

// The rest of an evening at home, weighted, with the time of day and a fresh grudge leaning on it.
function soloScene(phase, sulking) {
  const late = phase === 'night', early = phase === 'dawn' || phase === 'morning';
  const table = [
    [TIDY, 'tidy', 3], [PHONE, 'phone', 2], [HOBBY, 'hobby', 3], [GROOM, 'groom', 1.5], [REHEARSE, 'rehearse', 1],
    [DIY, 'diy', 1.5], [MONEY, 'money', 1], [LEISURE, 'leisure', 3], [ODD, 'odd', 0.6],
    [NIGHT, 'night', late ? 5 : 0], [MORNING, 'morning', early ? 5 : 0], [SULK, 'sulk', sulking ? 6 : 0],
  ];
  let r = Math.random() * table.reduce((n, t) => n + t[2], 0);
  for (const [pool, kind, w] of table) { if ((r -= w) <= 0) return { beats: rand(pool), kind }; }
  return { beats: rand(TIDY), kind: 'tidy' };
}

function startCooldown(zoneId) {
  zoneCooldown.set(zoneId, Date.now() + randInt(COOLDOWN_MS[0], COOLDOWN_MS[1]));
}

function play(zoneId, npc, beats) {
  activeHome.add(zoneId);
  let i = 0;
  const step = () => {
    // Re-checked every beat: a routine performing to an empty room is a timer
    // burning for nobody, and an NPC who wandered off should stop cooking.
    const live = world.npcs.get(npc.id);
    // ...and re-checks unconsciousness with it: someone who lies down mid-routine
    // (or gets put down) stops cooking there and then rather than narrating the
    // rest of the meal from the floor.
    // ...and the supply with it: a blackout mid-scene ends the scene rather than
    // narrating the rest of the meal by touch.
    if (i >= beats.length || !getZonePlayers(zoneId).length
        || !live || live._dead || live.zone_id !== zoneId || live._combatTargetId
        || isBusyBeingUnconscious(live) || zoneIsDark(zoneId)) {
      activeHome.delete(zoneId);
      startCooldown(zoneId);
      return;
    }
    sendToZone(zoneId, { type: 'ambient', message: `<span class="msg-ambient">${beats[i++]}</span>`, flavour: true });
    if (i >= beats.length) { activeHome.delete(zoneId); startCooldown(zoneId); return; }
    setTimeout(step, randInt(BEAT_GAP_MS[0], BEAT_GAP_MS[1]));
  };
  step();
}

/**
 * One pass. Called from the ambient-life tick, so it inherits that tick's
 * idle-gating — no players, no candidates, no work.
 */
export function homeLifeTick() {
  const now = Date.now();
  const { timePhase } = getEnvironmentState();

  const candidates = new Set();
  for (const player of world.players.values()) {
    if (player.current_zone) candidates.add(player.current_zone);
  }

  for (const zoneId of candidates) {
    if (activeHome.has(zoneId)) continue;
    if ((zoneCooldown.get(zoneId) ?? 0) > now) continue;
    if (!getZonePlayers(zoneId).length) continue;
    if (Math.random() > START_CHANCE) continue;

    const folk = homebodiesIn(zoneId);
    if (!folk.length) continue;
    if (isTalking(zoneId)) continue;

    // Two or more at home: often they talk to each other instead (home-talk.js).
    if (folk.length >= 2 && !isBanterBusy(zoneId) && Math.random() < TALK_CHANCE) {
      activeHome.add(zoneId);
      startHomeTalk(zoneId, folk, {
        done: () => { activeHome.delete(zoneId); startCooldown(zoneId); },
        bathroom: (who) => { const bath = bathroomFor(zoneId); if (bath && !activeHome.has(zoneId)) playBathroom(zoneId, who, bath); },
      }).then((ok) => { if (!ok && !isTalking(zoneId)) activeHome.delete(zoneId); })
        .catch(() => activeHome.delete(zoneId));
      continue;
    }
    const npc = rand(folk);

    // Which kind of evening this is. Meals cluster around meal times; a drink
    // is always plausible; tidying is the quiet filler that stops every routine
    // being about food.
    const mealtime = ['morning', 'midday', 'evening'].includes(timePhase);
    const roll = Math.random();

    // Checked first and deliberately rare: a flat with a bathroom gets the one
    // routine that leaves the room. Most homes have no ensuite and fall straight
    // through to the narrated half, exactly as before.
    if (roll < 0.12) {
      const bath = bathroomFor(zoneId);
      if (bath) { playBathroom(zoneId, npc, bath); continue; }
    }

    let beats, kind;
    const feel = feelOf(getZoneTemperature(zoneId));
    if (feel && Math.random() < TEMP_CHANCE[0] + (TEMP_CHANCE[1] - TEMP_CHANCE[0]) * Math.abs(feel)) { beats = rand(feel < 0 ? CHILL : HEAT); kind = feel < 0 ? 'chill' : 'heat'; }
    else if (mealtime && roll < 0.3) { beats = rand(MEAL).map(l => l.replace('{thing}', pickMeal())); kind = 'meal'; }
    // evenings: a proper drink, and once they've had a few, the scenes that go with that
    else if ((timePhase === 'evening' || timePhase === 'dusk' || timePhase === 'night') && Math.random() < 0.3 + 0.15 * tipsyOf(npc)) {
      beats = rand(tipsyOf(npc) >= 2 ? BOOZE_LATE : BOOZE); kind = 'booze'; drinkUp(npc);
    }
    else if (roll < 0.42) { beats = rand(DRINK).map(l => l.replace('{thing}', pickDrink(timePhase))); kind = 'drink'; }
    else {
      const other = sulkingAt(npc);
      const pick = soloScene(timePhase, other && folk.includes(other));
      kind = pick.kind;
      beats = pick.kind === 'sulk' ? pick.beats.map(l => l.replace(/\{other\}/g, other.name.split(' ')[0])) : pick.beats;
    }
    // a Room Stage open on this flat walks them to the cooker for it (plugins/roomstage/npc-life.js)
    emit('npc.home.scene', { zoneId, npcId: npc.id, kind });

    play(zoneId, npc, beats.map(l => l.replace(/\{npc\}/g, npc.name)));
  }
}

// Test seam — regress asserts the catalogues actually yield nouns.
export const _internals = {
  pickMeal, pickDrink, MEAL, DRINK, TIDY, CHILL, HEAT, isBusyBeingUnconscious,
  bathroomFor, bathroomOf, BATHROOM_GOING, BATHROOM_BACK,
  PHONE, HOBBY, GROOM, REHEARSE, DIY, MONEY, LEISURE, NIGHT, MORNING, ODD, SULK, soloScene,
};
