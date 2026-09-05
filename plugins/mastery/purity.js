/**
 * Purity — the ceiling, the stain, and what the Watch calls you.
 *
 * Wildblood mutate, Ascendants install chrome, and the Long Watch master the
 * body they were issued. Without a limiter nothing stops a player taking all
 * three, so a modified body has a CEILING: every augment and every point of
 * mutation expression lowers how far any discipline can reach.
 *
 * Three rules carry the whole file.
 *
 * 1. THE CEILING IS A CEILING, NEVER A REFUSAL — but THE DOOR IS A DOOR. Two
 *    separate mechanisms, and keeping them separate is the whole trick.
 *
 *    The Watch will not teach a body that is STILL CARRYING metal or mutation.
 *    Cleanse yourself first; that is the price of admission, and `cleanseDemand`
 *    is where they say so. It reads `currentLoad` — a mechanical fact — and
 *    never the social ladder further down this file.
 *
 *    But once you HAVE cleansed, the door opens and only the ceiling remains:
 *    the stain lets you in, caps how far you go, and floors at 10, never 0. A
 *    retread still trains, still learns, still improves. They cannot get GOOD.
 *    Chrome does not make discipline impossible, it makes MASTERY impossible,
 *    and the distance between those two sentences is the fiction.
 *
 *    So the refusal is about what you ARE carrying and the ceiling is about what
 *    you CARRIED. Collapse them and one of the two dies: gate on the stain and
 *    the ceiling never gets read by anybody; gate on nothing and "cleanse
 *    yourself" is a line of prose with no teeth.
 *
 * 2. STORED RANK IS NEVER LOWERED — the cap applies on READ. Reversing the
 *    arithmetic into the stored number would be unrecoverable the moment any of
 *    it came back out, which is the lesson docs/systems-mutations.md already
 *    paid for once.
 *
 * 3. CLEANING UP DOES NOT CLEAN THE SLATE. Having chrome cut out or a mutation
 *    treated leaves a STAIN that fades over weeks. Without it, chrome is
 *    rentable: install it for the fight, have it pulled before you train, pay
 *    nothing. The stain is what makes the choice a choice.
 *
 * And the social half. To the Long Watch, staying in the body you were born
 * with is the virtue — not a rule, a VIRTUE, which is a different and colder
 * thing. They admit the formerly-modified, they train them, they fight beside
 * them, and they have words for them anyway. That contradiction is deliberate
 * and must never be resolved: nothing here bars anyone from anything, and
 * nothing here is ever violence. See docs/systems-mastery.md.
 *
 * SYNC BY CONTRACT. Every read here happens on the swing path. No awaits, no
 * queries, ever.
 */
import { rosterOf } from '../augments/state.js';
import { getMutations } from '../../server/engine/mutations.js';
import { isAwakened } from '../../server/engine/psionics.js';
import { storedRank } from './state.js';

export const CHROME_COST = 12;      // ceiling lost per installed, working augment
export const FLESH_PER_STEP = 20;   // …per this much total mutation expression
export const FLESH_COST = 5;
export const CAP_FLOOR = 10;

// How long the body takes to stop remembering. Long on purpose — a stain that
// faded in a session would be a cooldown, not a consequence.
export const STAIN_HALF_LIFE_DAYS = 21;
// Below this the stain is gone rather than asymptotically hanging around.
const STAIN_FLOOR = 1;
// Don't dirty the row for rounding noise; the flush is coalesced, not chatty.
const STAIN_WRITE_THRESHOLD = 1;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── raw load ────────────────────────────────────────────────────────────────

/** Installed chrome that still works. A dead augment is not a thing you are carrying. */
export function chromeLoad(player) {
  let n = 0;
  for (const rec of rosterOf(player).values()) if ((rec?.condition ?? 1) > 0) n++;
  return n;
}

/**
 * Total mutation expression carried. Uses the RAW expression `getMutations`
 * reports, never the suppressed one — a drug that holds a mutation down for an
 * hour has not un-mutated you, and a ceiling that rose and fell with a dose
 * would be a way to buy training you get to keep.
 */
export function fleshLoad(player) {
  let total = 0;
  for (const m of getMutations(player) || []) total += Number(m?.expression) || 0;
  return total;
}

/** What the body is carrying RIGHT NOW, before any stain. */
export function currentLoad(player) {
  return (CHROME_COST * chromeLoad(player))
       + (Math.floor(fleshLoad(player) / FLESH_PER_STEP) * FLESH_COST);
}

/**
 * Is this body still carrying the thing the Watch will not teach around?
 *
 * DELIBERATELY NOT `currentLoad(player) > 0`. The load quantises — a single
 * mutation at expression 12 floors to zero steps and costs no ceiling at all,
 * which is correct for a CEILING and completely wrong for a DOOR. The Watch are
 * not doing arithmetic; they are looking at you. Any working chrome, any
 * expressed mutation, and the answer is yes.
 *
 * Note what is absent: the stain, and `isPsionic`. Someone who cleaned up is
 * admitted (that is what the ceiling is FOR), and psionics is a mind rather than
 * a body, so it never reaches this — the Watch mock the Exodus at the door and
 * then hold it open, which is exactly the snobbery-with-no-teeth the ladder
 * below describes.
 */
export function carriesModification(player) {
  return chromeLoad(player) > 0 || fleshLoad(player) > 0;
}

// ── the stain ───────────────────────────────────────────────────────────────

/**
 * The effective load, current or remembered, whichever is worse.
 *
 * Lazy and self-renormalising, the same shape relations.js decay uses: the
 * scalar fades from whenever it was last set, and every read rebases it to now,
 * so the fade always measures from the last real change rather than from the
 * first time you were ever modified.
 *
 * SYNC. Called from the swing seam. It writes only to the live player object.
 */
export function effectiveLoad(player, now = Date.now()) {
  const current = currentLoad(player);
  if (!player) return current;

  let rec = player._purity;
  if (!rec) rec = player._purity = { load: current, at: now };

  const days = Math.max(0, (now - (rec.at || now)) / 86400000);
  let faded = (rec.load || 0) * Math.pow(0.5, days / STAIN_HALF_LIFE_DAYS);
  if (faded < STAIN_FLOOR) faded = 0;

  // The stain can never make you cleaner than you actually are.
  const effective = Math.max(current, faded);

  // Rebase. Marking dirty only on a material move keeps a per-swing read from
  // queueing a write every single minute.
  if (Math.abs(effective - (rec.load || 0)) >= STAIN_WRITE_THRESHOLD) player._purityDirty = true;
  rec.load = effective;
  rec.at = now;
  return effective;
}

/** How much of the load is memory rather than metal. 0 for a body carrying what it shows. */
export function stainOf(player, now = Date.now()) {
  return Math.max(0, effectiveLoad(player, now) - currentLoad(player));
}

// ── the ceiling ─────────────────────────────────────────────────────────────

/** The ceiling this body can reach in any discipline. SYNC. No query. Ever. */
export function purityCap(player, now = Date.now()) {
  return clamp(100 - effectiveLoad(player, now), CAP_FLOOR, 100);
}

/** What a discipline is actually WORTH right now. Every mechanical read uses this. */
export function effectiveRank(player, discipline) {
  return Math.min(storedRank(player, discipline), purityCap(player));
}

// ── standing: what the Watch calls you ──────────────────────────────────────
//
// Never a gate. Nothing in the codebase may read this to REFUSE anything — it
// exists to be said, not to be checked. Grep it before you wire it to a door.

// THE LADDER, in the Watch's own order of preference:
//
//     PURE  >  PSIONIC  >  AUGMENTED  >  MUTANT
//
// The AXIS IS THE BODY, which is what makes the Exodus rung the interesting one.
// A psionic has done nothing to themselves — they are bodily clean, and the
// Watch cannot fault them on the one measure they actually care about. So they
// fault them for other things instead: for WALKING (the Exodus left, and the
// Watch stayed), and for being cranks who believe they have mind powers.
//
// THE WATCH DO NOT CONCEDE PSIONICS IS REAL. Nothing in this file may imply
// they do — no line here calls it a shortcut, an advantage, or help, because
// every one of those words grants the premise. They think it is a congregation
// of people who left their posts to listen to static. Which sits well with
// systems-psionics.md's own first law: the game itself refuses to confirm it,
// and Codex XIV keeps it a joke.
//
// So the temperatures differ all the way down. Pure is a virtue. Psionic gets
// MOCKERY plus a grudge about desertion. Augmented gets cold superiority — you
// bought what we bled for. Mutant gets DISGUST, which is a different thing
// entirely and is the one place the Watch stops sounding reasonable.
//
// None of it is a gate. They admit all four. They train all four. They will
// stand next to all four in a fight and have words for three of them anyway,
// and that contradiction must never be resolved by the code — a Watch that
// refused service would be a simpler and much less interesting faction.
//
// NOTHING MAY READ THIS TO REFUSE ANYTHING. Grep it before you wire it to a
// door. It exists to be said, not to be checked.
export const REGARD = Object.freeze({
  PURE: 'pure',
  PSIONIC: 'psionic',
  AUGMENTED: 'augmented',
  MUTANT: 'mutant',
});
export const REGARD_ORDER = Object.freeze([REGARD.PURE, REGARD.PSIONIC, REGARD.AUGMENTED, REGARD.MUTANT]);

// The Exodus discipline (docs/systems-psionics.md). `isAwakened` is sync and
// reads the login-hydrated flag Map, so it is safe from the swing path — the
// same contract everything else in this file works under.
//
// Note what is NOT here: psionics costs no purity. An awakened mind has done
// nothing to the BODY, so the ceiling does not move — and the Watch cannot
// fault them on the one axis they claim to care about, which is precisely why
// their objection is about desertion and delusion instead. The contempt has no
// mechanical teeth at all, which is the most honest thing this file says about
// the Watch.
export function isPsionic(player) {
  return !!(player?._psionic || isAwakened(player));
}

/** Where the Watch places you RIGHT NOW, worst thing first. */
export function regardOf(player) {
  if (fleshLoad(player) > 0) return REGARD.MUTANT;      // disgust outranks everything
  if (chromeLoad(player) > 0) return REGARD.AUGMENTED;
  if (isPsionic(player)) return REGARD.PSIONIC;
  return REGARD.PURE;
}

// What somebody who cleaned up is called. The former state is its own small
// ladder and it never fully goes away while the stain lasts.
export const FORMER = Object.freeze({
  NONE: null,
  RETREAD: 'retread',       // had chrome cut out
  UNPICKED: 'unpicked',     // had mutations treated
  HALF_CLEAN: 'half_clean', // both
});

export function formerOf(player, now = Date.now()) {
  if (regardOf(player) !== REGARD.PURE) return FORMER.NONE;
  if (stainOf(player, now) <= 0) return FORMER.NONE;
  const wasChromed = !!(player?._chromedEver || player?.chromed);
  const wasMutated = !!player?._mutatedEver;
  if (wasChromed && wasMutated) return FORMER.HALF_CLEAN;
  if (wasMutated) return FORMER.UNPICKED;
  return FORMER.RETREAD;
}

// The words themselves. `first-body` is the only one anybody says warmly; the
// rest are old, worn smooth, and used without much thought by people who would
// be genuinely surprised to be told they were cruel.
const WORD = {
  [REGARD.PURE]: 'first-body',
  // NOT "shortcut" — that word concedes they got somewhere. The grievance is
  // that they LEFT, and the contempt is for the believing.
  [REGARD.PSIONIC]: 'walkaway',
  [REGARD.AUGMENTED]: 'bought',    // you bought what we bled for.
  [REGARD.MUTANT]: 'slipped',      // said the way you'd say something had gone off.
  [FORMER.RETREAD]: 'retread',
  [FORMER.UNPICKED]: 'unpicked',
  [FORMER.HALF_CLEAN]: 'half-clean',
};

/** What they call you. Former state wins while the stain lasts — it is more specific. */
export function standingWord(player, now = Date.now()) {
  const former = formerOf(player, now);
  if (former) return WORD[former];
  return WORD[regardOf(player)] || null;
}

/**
 * How an instructor takes you in.
 *
 * TWO REGISTERS, and the coded one is the default. The Watch mostly do not say
 * the quiet part — they say "the assisted", "how much of that is warranty",
 * "nobody holds it against you", and everyone in the room knows exactly what
 * was meant. Every so often somebody says it flat out instead, and the flat
 * version lands harder precisely because it is rare.
 *
 * The nastiest lines in here are the polite ones. "You can't help what you are"
 * is worse than any of the slurs and is doing the same work; that is the point,
 * and it is why the coded list is the longer one.
 *
 * Flavour only. The whole social layer gates nothing, and none of these is a
 * refusal — every one is followed by the lesson.
 */
const GREETINGS = {
  [FORMER.RETREAD]: {
    coded: [
      `${'{n}'} reads you left to right, the way you check a rebuilt engine. "Back in your own kit, then." A nod. "Takes a while to settle."`,
      `"You'll be finding it stiff," ${'{n}'} says, to nobody in particular. "They all do, after. Nothing to be done about that."`,
    ],
    plain: [`${'{n}'} looks you over. "Retread." Not quite an insult, not quite not one. "Well. You came back."`],
  },
  [FORMER.UNPICKED]: {
    coded: [
      `${'{n}'} looks a beat too long at where it used to be. "Corrected, I hear." The word does a lot of work. "Good. Start again from the feet."`,
      `"You'll want to be patient with yourself," ${'{n}'} says, kindly, watching your hands. "After."`,
    ],
    plain: [`${'{n}'} looks you over a beat too long. "Unpicked, then." A shrug that costs them something. "Body's yours again. Mostly."`],
  },
  [FORMER.HALF_CLEAN]: {
    coded: [`${'{n}'} takes you in and files you somewhere. "You've had a time of it." It isn't sympathy. "Stand up straight."`],
    plain: [`${'{n}'} takes you in and something in their mouth goes flat. "Half-clean." They say it the way you'd read a label. "Fine. Stand up straight."`],
  },
  [REGARD.PURE]: {
    coded: [
      `${'{n}'} looks you over once and finds nothing to look at twice. "Clean lines. No surprises." That's the whole inspection.`,
      `"Everything you bring in here is yours," ${'{n}'} says, and means it as the highest thing they say to anyone. "Right. Feet."`,
    ],
    plain: [`${'{n}'} gives you the once-over and nods, satisfied. "First-body. Good."`],
  },
  [REGARD.PSIONIC]: {
    // Mockery and a grudge, never acknowledgement. Note that not one of these
    // lines admits the thing works — the joke is always that it doesn't.
    coded: [
      `"Oh," says ${'{n}'}, without turning round. "You'll know what I'm about to say, then." They wait exactly long enough. "No? Hands up."`,
      `${'{n}'} looks at you the way you look at somebody's brother who has found a new church. "Still listening, are we." It isn't a question, and they don't wait for one.`,
      `"We had a few go that way," ${'{n}'} says, to the room, conversationally. "Walked off mid-watch to sit in a field." Back to you, flatly: "Feet apart."`,
    ],
    plain: [
      `${'{n}'} snorts. "Walkaway." They let it sit there. "Your lot left. We're still here. Hands up."`,
      `"Mind powers," ${'{n}'} says, and doesn't bother to make it a sneer. "Right. Let's see what your ARMS can do."`,
    ],
  },
  [REGARD.AUGMENTED]: {
    coded: [
      `${'{n}'} glances at where the metal goes in, and away. "How much of that's under warranty?" It's asked lightly, as a joke, twice.`,
      `"Serviced," ${'{n}'} says, half to themselves, marking something down. "Right. Let's find out what's still yours."`,
    ],
    plain: [`${'{n}'} doesn't pretend not to look. "Bought." A short breath through the nose. "Everything you've got, someone sold you. Let's see what's left."`],
  },
  [REGARD.MUTANT]: {
    // The polite ones are the worst ones. Pity doing the work of disgust.
    coded: [
      `${'{n}'} is scrupulously, elaborately normal with you. "Nobody holds it against you," they say, unprompted, before you have said anything at all.`,
      `"You can't help what you are," ${'{n}'} says, gently, and it's the gentleness that does it. "We'll work around it."`,
      `${'{n}'} doesn't step back. The effort of not stepping back is the whole greeting. "...Right. Hands up."`,
    ],
    plain: [`${'{n}'} looks at you the way you'd look at meat left out. "Slipped." They don't use your name today. "Hands up. Let's go."`],
  },
};

// How often somebody says it flat out instead of coding it. Low on purpose.
const PLAIN_CHANCE = 0.25;

export function standingGreeting(player, npcName, now = Date.now()) {
  const key = formerOf(player, now) || regardOf(player);
  const set = GREETINGS[key];
  if (!set) return null;
  const pool = (Math.random() < PLAIN_CHANCE && set.plain?.length) ? set.plain : set.coded;
  return pool[Math.floor(Math.random() * pool.length)].split('{n}').join(npcName);
}

/**
 * Why the ceiling is where it is, in prose. NEVER a number — an instructor who
 * can see what you have done to yourself says so; they do not read you a stat.
 */
export function capReason(player, now = Date.now()) {
  const chrome = chromeLoad(player);
  const flesh = fleshLoad(player);
  const stain = stainOf(player, now);

  if (!chrome && !flesh && stain <= 0) return null;

  if (!chrome && !flesh) {
    // The stain, which is the hardest one to explain and the most important to.
    return "you got it taken out, and the body hasn't finished forgetting";
  }
  if (chrome && flesh) return "there's metal in you, and the flesh has gone its own way besides";
  if (chrome) return chrome > 2
    ? "there's more machine in you than there's you"
    : "there's metal in you, and it doesn't listen the way bone does";
  return flesh > 60
    ? "your body is busy being something else, and it won't hold still long enough to learn"
    : "the flesh has started going its own way, and it doesn't take instruction";
}

// ── the door ────────────────────────────────────────────────────────────────

/**
 * The refusal at the door, for a body still carrying metal or mutation.
 *
 * The one thing in this file that IS a gate, and it reads `chromeLoad` /
 * `fleshLoad` — never `regardOf`, never `standingWord`. That separation is not
 * fussiness: the ladder has a PSIONIC rung and a FORMER rung, and wiring the
 * door to it would silently start refusing two groups the Watch admit.
 *
 * Three rules for the prose.
 *
 * - IT NAMES WHAT HAS TO GO, and nothing else. No number, no rank, no rep, no
 *   flag — the same convention `capReason` and the mutagen gate already keep.
 * - IT IS NOT AN ARGUMENT. They do not explain the philosophy, sell the order,
 *   or offer terms. They tell you to come back different and go back to work.
 *   An instructor who debated you would be recruiting; this is a closed door.
 * - THE MUTANT VERSION IS COLDER THAN THE CHROME ONE. Chrome is a thing you
 *   bought and can have taken out, and they say so almost practically. Flesh
 *   gets the register the ladder reserves for it, and they do not make it easy
 *   to hear. It must still never be violence, and never a slur here — the slur
 *   is for the people they DID let in.
 */
export function cleanseDemand(player, npcName = 'They') {
  const chrome = chromeLoad(player) > 0;
  const flesh = fleshLoad(player) > 0;
  if (!chrome && !flesh) return null;

  if (chrome && flesh) {
    return `${npcName} stops you at arm's length, and doesn't pretend to be looking anywhere else.`
      + `\n<span class="text-dim">"There's metal in you and the flesh has gone its own way besides. I'm not teaching that. Get yourself cut clean and unpicked both, and then we'll see about you."</span>`;
  }
  if (chrome) {
    return `${npcName} glances at where the metal goes in, and their whole manner closes like a door.`
      + `\n<span class="text-dim">"No. Not while you're carrying that." A shrug, almost practical. "Have it taken out. Come back in your own body and I'll start you at the feet — not before."</span>`;
  }
  return `${npcName} looks at you a beat too long, and steps back the exact distance they have decided is polite.`
    + `\n<span class="text-dim">"I'm not going to be able to help you." Flat, and final. "Go and get corrected. Properly. Then come and stand in front of me again."</span>`;
}

export const _test = { STAIN_FLOOR, STAIN_WRITE_THRESHOLD, WORD, GREETINGS, PLAIN_CHANCE };
