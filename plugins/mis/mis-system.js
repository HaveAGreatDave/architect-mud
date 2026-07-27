/**
 * MIS system state — horniness meter, erection state, climax events, ongoing
 * event registry, visibility notes, and message pools. Moved out of
 * server/engine/mis.js (Phase 2, docs/proposals/engine-plugin-boundary.md):
 * the engine keeps only the consent substrate (isMisActive / isAttractedTo /
 * server setting); everything a leaf system owns lives here.
 */
import { query } from '../../server/models/db.js';
import { isMisActive } from '../../server/engine/mis.js';
import { stainZone } from '../../server/engine/bodily.js';
// Body mechanics live next door (mis-body.js): this module owns the meter and the
// prose, that one owns what the meter does to a body.
import { refractoryFactor, refractoryMs, markClimax, soakClothing, REFRACTORY_MSGS,
  volumeOf, markClimaxVolume, soakSlotsFor, overflowsToZone, erectionForced } from './mis-body.js';

// Ongoing event intervals (masturbation, fucking, etc.) keyed by player ID
const MIS_EVENTS = new Map();   // playerId → intervalId
const MIS_EVENT_META = new Map(); // playerId → { action, target }

export function startMisEvent(playerId, intervalFn, intervalMs = 8000, meta = {}) {
  stopMisEvent(playerId);
  const id = setInterval(intervalFn, intervalMs);
  MIS_EVENTS.set(playerId, id);
  MIS_EVENT_META.set(playerId, meta);
}

export function stopMisEvent(playerId) {
  const id = MIS_EVENTS.get(playerId);
  if (id !== undefined) {
    clearInterval(id);
    MIS_EVENTS.delete(playerId);
  }
  const meta = MIS_EVENT_META.get(playerId);
  MIS_EVENT_META.delete(playerId);
  return meta || null;
}

export function hasMisEvent(playerId) {
  return MIS_EVENTS.has(playerId);
}

export function getMisEventMeta(playerId) {
  return MIS_EVENT_META.get(playerId) || null;
}


// Increase horniness and handle thresholds.
// Returns an array of messages to send privately to the player.
export async function addHorniness(player, amount, broadcast) {
  if (!isMisActive(player)) return [];
  const prev = player.horniness || 0;

  // A body that just finished doesn't rebuild at full rate. The ramp is smooth
  // rather than a refusal — you can keep going, it just isn't going anywhere yet.
  const early = [];
  const factor = refractoryFactor(player);
  if (factor < 1) {
    amount = Math.floor(amount * factor);
    // Once per refractory period, not once per beat. markClimax clears the flag.
    if (!player._misRefractoryTold) {
      player._misRefractoryTold = true;
      early.push(...pick(REFRACTORY_MSGS));
    }
  }
  if (amount <= 0) return early;

  player.horniness = Math.min(120, prev + amount);
  player.horniness_last_increased = Date.now(); // track for decay delay
  await query('UPDATE players SET horniness=$1 WHERE id=$2', [player.horniness, player.id]);

  const messages = [...early];

  // Escalating heat as horniness climbs past 50 — only the highest newly-crossed
  // tier fires, so a big single jump (an active event's +18/+20) doesn't spam
  // every message on the way up, just the one that matches how far it went.
  let crossedTier = null;
  for (const tier of HORNY_TIERS) {
    if (prev < tier.at && player.horniness >= tier.at) crossedTier = tier;
  }
  if (crossedTier) messages.push(...pick(crossedTier.messages));

  // Update erection for males
  if (player.biological_sex === 'male') {
    const wasErect = player.erect === 1;
    // A drug flagged `forced_erection` beats the meter outright — it does not go
    // down until the drug does, which is exactly as comfortable as it sounds.
    const nowErect = erectionForced(player) || player.horniness >= 40;
    if (nowErect !== wasErect) {
      player.erect = nowErect ? 1 : 0;
      await query('UPDATE players SET erect=$1 WHERE id=$2', [player.erect, player.id]);
    }
  }

  // The last beat before the edge — fires once per build-up, right before climax
  // actually lands, so it reads as "this is your last chance to direct it."
  if (prev < 97 && player.horniness >= 97) {
    messages.push(...pick(HNNNG_MESSAGES));
  }

  // Climax at 100 — only triggered here for passive accumulation; active events handle their own
  if (player.horniness >= 100 && !hasMisEvent(player.id)) {
    const climaxMsgs = await triggerClimax(player, broadcast);
    messages.push(...climaxMsgs);
  }

  return messages;
}

export async function triggerClimax(player, broadcast, location = null) {
  player.horniness = 0;
  player.erect = 0;
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
  player.horniness_last_increased = null;

  // Volume BEFORE the stamp — it measures time since the last one.
  const volume = volumeOf(player);
  markClimax(player);
  markClimaxVolume(player);
  delete player._misRefractoryTold;

  if (!player.appearance_data) player.appearance_data = {};
  if (player.biological_sex === 'male') {
    // Penis always gets residue; add the target location too if on/in someone.
    const ejacLoc = location ? ['penis', location] : ['torso', 'hands', 'penis'];
    // A big one goes further than it was aimed. This is the whole reason volume
    // exists: it decides how much of the mess is somebody else's problem.
    if (volume >= 0.6 && !ejacLoc.includes('torso')) ejacLoc.push('torso');
    if (volume >= 0.85 && !ejacLoc.includes('hands')) ejacLoc.push('hands');
    // `at` is what makes fluid a thing that ages: it dries on examine, it soaks
    // into clothing, and the room can smell it until it doesn't.
    player.appearance_data.ejaculate_state = { locations: ejacLoc, at: Date.now(), volume };
  } else {
    const ejacLoc = volume >= 0.6 ? ['legs', 'feet'] : ['legs'];
    player.appearance_data.ejaculate_state = { locations: ejacLoc, at: Date.now(), volume };
  }

  await query(
    'UPDATE players SET horniness=$1, erect=$2, sanity=$3, appearance_data=$4 WHERE id=$5',
    [player.horniness, player.erect, player.sanity, JSON.stringify(player.appearance_data), player.id]
  );

  // Anything that landed on a clothed slot soaked in rather than sitting on skin.
  // `legsCovered` in index.js already decided the floor-vs-trousers question for
  // the ejaculate verb; this covers every other climax path.
  const wanted = soakSlotsFor(volume);
  const soaked = await soakClothing(player, wanted);
  // What the clothes couldn't take runs out onto the floor, where it becomes a
  // zone stain the room can still smell after everyone involved has left.
  if (overflowsToZone(volume) && soaked.length < wanted.length) {
    stainZone(player.current_zone, 'ejaculate');
  }

  return pick(CLIMAX_MESSAGES);
}

// Climax directly onto the ground (masturbation events)
export async function triggerGroundClimax(player) {
  const volume = volumeOf(player);
  player.horniness = 0;
  player.erect = 0;
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
  player.horniness_last_increased = null;
  markClimax(player);
  markClimaxVolume(player);
  delete player._misRefractoryTold;

  await query(
    'UPDATE players SET horniness=$1, erect=$2, sanity=$3 WHERE id=$4',
    [player.horniness, player.erect, player.sanity, player.id]
  );

  // It went on the floor: that's a stain, and stains are how the world finds out.
  stainZone(player.current_zone, 'ejaculate');

  return pick(GROUND_CLIMAX_MESSAGES).map(m => volume >= 0.85 ? `${m} <span class="text-dim">There is a lot of it.</span>` : m);
}

function pick(arr) { return Array.isArray(arr[0]) ? arr[Math.floor(Math.random() * arr.length)] : [arr[Math.floor(Math.random() * arr.length)]]; }

/**
 * The extra sentence a big finish earns, chosen by WHERE it went. Returns '' for
 * anything under the heavy band, so an ordinary climax reads exactly as it always
 * did and only a real one gets the second line.
 *
 * `part` is the ejacPart the event loops already compute (throat/pussy/ass/body).
 */
export function overflowLine(part, volume, vars = {}) {
  if (volume < 0.6) return '';
  const pool = EJACULATE_ZONE_MSGS.overflow[part] || EJACULATE_ZONE_MSGS.overflow.body;
  const line = pool[Math.floor(Math.random() * pool.length)];
  return ' ' + line.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k);
}

/**
 * What the receiver privately feels, banded by volume and by part. This is the
 * half the room never sees, and it's the reason volume is worth tracking at all:
 * being finished inside is a different experience depending on how much there is.
 */
const RECEIVED_INSIDE = {
  pussy: {
    heavy: [`You feel it happen — hot, and far more of it than you were braced for. It keeps coming.`,
            `He empties into you in pulses you can actually count, and you feel every one.`],
    normal: [`You feel him finish inside you, warm and sudden.`],
  },
  ass: {
    heavy: [`It floods into you, more than you can hold, and you feel exactly how much is going to come back out.`,
            `The heat of it spreads through you in waves. There is a great deal of it.`],
    normal: [`You feel him finish inside you.`],
  },
  throat: {
    heavy: [`It hits the back of your throat in volume and you have a decision to make, fast.`,
            `More than a mouthful. Considerably more.`],
    normal: [`You feel him finish in your mouth, hot and sudden.`],
  },
  mouth: {
    heavy: [`It fills your mouth faster than you can deal with it.`],
    normal: [`He finishes across your tongue.`],
  },
  body: {
    heavy: [`It lands on you in far more quantity than you expected, and it is going to need washing off.`],
    normal: [`You feel it land warm across your skin.`],
  },
};

export function receivedLine(part, volume) {
  const set = RECEIVED_INSIDE[part] || RECEIVED_INSIDE.body;
  const band = volume >= 0.6 ? 'heavy' : 'normal';
  const pool = set[band] || set.normal;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Wash ejaculate off a player
export async function washEjaculate(player) {
  if (!player.appearance_data?.ejaculate_state) return false;
  player.appearance_data.ejaculate_state = null;
  await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(player.appearance_data), player.id]);
  return true;
}

// Describe erection visibility through clothing (appearance hook)
// layerCount: number of items equipped to legs slot
// tightSlots: Set of slots covered by low-bulkiness items
export function erectionVisibilityNote(player, tightSlots, layerCount) {
  if (!isMisActive(player)) return null;
  if (player.biological_sex !== 'male' || !player.erect) return null;
  // Visible only through ≤3 layers and only if no bulky outer layer
  if (layerCount > 3) return null;
  if (tightSlots.has('legs')) {
    return `The outline of an erection is visible through ${player.handle || 'their'} clothing.`;
  }
  return null;
}

// Breast + nipple visibility note for females.
export const NIPPLE_HARD = [
  `Her nipples are hard — fully committed to the bit.`,
  `Her nipples are erect, standing at attention like they got a memo.`,
  `Her nipples are stiff. They have strong opinions about this situation.`,
  `Her nipples are visibly hard. They're not subtle about it.`,
];
export const NIPPLE_SOFT = [
  `Her nipples are soft and relaxed, unbothered by everything.`,
  `Her nipples are at ease. No complaints. No agenda.`,
  `Her nipples are soft — at rest, diplomatically neutral.`,
];

// Bare-chest breast-size copy — shown whenever the torso is uncovered. Leading
// "Her" so the isSelf caller can swap it to "Your"; no other gendered pronouns.
const BREAST_BARE = {
  flat:         [`Her chest is nearly flat — efficient, aerodynamic, no complaints from physics.`, `Her breasts are barely there. Present in theory.`],
  small:        [`Her breasts are small and sit high — perky in a way that feels almost smug.`, `Her breasts are modest, and make no apologies about it.`],
  medium:       [`Her breasts are a solid medium — the kind that fill a bra without a fight.`, `Her breasts are average in the most satisfying sense of the word.`],
  large:        [`Her breasts are large and full. Gravity is aware of them.`, `Her breasts are generously sized — impossible to ignore.`],
  'very large': [`Her breasts are enormous, frankly — their own gravitational pull.`, `Her breasts are massive. Structurally impressive. An engineering concern.`],
};

// Female chest description (breast size + nipple state) with NO MIS gate — the
// caller is responsible for gating. breastVisibilityNote wraps this with the gate.
// torsoLayerCount: number of equipped torso items
// outermostBulkiness: bulkiness value of outermost torso layer (0 if none)
// outermostLayerMax: 1 = outermost torso piece is an underwear-layer item, 2 = clothing
// outermostName: display name of outermost torso item
export function femaleChestNote(player, torsoLayerCount, outermostBulkiness, outermostLayerMax, outermostName, tempC) {
  if (player.biological_sex !== 'female') return null;

  const data = player.appearance_data || {};
  const size = data.breast_size || 'medium';
  // Horniness >30 overrides temperature for nipple hardness
  const hard = (player.horniness || 0) > 30 || (tempC !== undefined && tempC < 10);
  const nipplePool = hard ? NIPPLE_HARD : NIPPLE_SOFT;
  const nipple = () => nipplePool[Math.floor(Math.random() * nipplePool.length)];

  if (torsoLayerCount === 0) {
    // Bare chest — breast size + a single nipple line.
    const bare = BREAST_BARE[size] || BREAST_BARE.medium;
    return `${bare[Math.floor(Math.random() * bare.length)]} ${nipple()}`;
  }

  if (torsoLayerCount === 1 && outermostLayerMax <= 1) {
    // A single under-layer with nothing over it (bra, camisole, undershirt…) —
    // describe the fit against the garment by name, not "bra" specifically.
    const garment = outermostName || 'top';
    const FILL = {
      flat:         `Her chest barely registers under the ${garment}. It's doing charity work.`,
      small:        `Her breasts sit neatly under the ${garment} — no complaints from either party.`,
      medium:       `Her breasts fill out the ${garment} in a satisfying, uneventful way.`,
      large:        `Her breasts press against the ${garment} with some conviction.`,
      'very large': `Her breasts are straining the ${garment}'s structural integrity. It's doing its best.`,
    };
    const fill = FILL[size] || FILL.medium;
    if (hard) {
      const NOTE = [`Her nipples press visibly against the fabric.`, `Hard nipples push through the thin material, undeniable.`];
      return `${fill} ${NOTE[Math.floor(Math.random() * NOTE.length)]}`;
    }
    return fill;
  }

  // Clothed: nipples show through 1 thin layer (bulkiness ≤ 2) or 2 very thin layers (≤ 1)
  const visible = (torsoLayerCount === 1 && outermostBulkiness <= 2) ||
                  (torsoLayerCount === 2 && outermostBulkiness <= 1);
  if (visible && hard) {
    const label = outermostName || 'fabric';
    const NOTE = [`Her nipples are visible through the ${label}.`, `Hard nipples press against the ${label}.`];
    return NOTE[Math.floor(Math.random() * NOTE.length)];
  }

  return null;
}

// MIS-gated wrapper around femaleChestNote (the clothed describe path gates on
// the viewer's MIS separately; this also requires the target to have MIS on,
// matching the prior behaviour).
export function breastVisibilityNote(player, torsoLayerCount, outermostBulkiness, outermostLayerMax, outermostName, tempC) {
  if (!isMisActive(player)) return null;
  return femaleChestNote(player, torsoLayerCount, outermostBulkiness, outermostLayerMax, outermostName, tempC);
}

// Escalating heat tiers — checked low-to-high in addHorniness, only the
// highest newly-crossed tier's pool fires per call.
const HORNY_TIERS = [
  { at: 50, messages: [
    ['Something stirs in you. A familiar warmth, building quietly.'],
    ['Your thoughts drift somewhere warmer. You push them aside — mostly.'],
    ['A low heat settles in your body, patient and insistent.'],
    ['You become aware of your body in a way you weren\'t a moment ago.'],
    ['A slow ache starts up, low and unhurried.'],
    ['Your skin prickles. Something in you just woke up and stretched.'],
  ]},
  { at: 65, messages: [
    ['The heat is getting harder to ignore. It has your attention now.'],
    [`Your pulse picks up for no reason you'd admit to out loud.`],
    ['You catch yourself thinking about it. More than once.'],
    [`There's a tension coiling low in your gut, winding tighter.`],
    ['You shift your weight. It doesn\'t help.'],
  ]},
  { at: 80, messages: [
    [`It's getting hard to think about anything else.`],
    ['Your body is very clearly asking for something now.'],
    [`The heat has stopped being subtle. You're squirming a little.`],
    [`Every thought keeps sliding back to the same place.`],
    [`You're breathing a little harder and you know exactly why.`],
  ]},
  { at: 92, messages: [
    [`You're right on the edge. It wouldn't take much at all.`],
    ['Every nerve feels lit up. You could go any second.'],
    [`You're teetering. One more push and you're gone.`],
    [`Your whole body is drawn tight as a wire.`],
    [`You're so close it aches. Do not stop now.`],
  ]},
];

// The final beat before climax — one last warning that this is the moment to
// direct where it lands, before your body takes the decision out of your hands.
const HNNNG_MESSAGES = [
  [`HNNNNNNNNNGGGGGGGGG— you're seconds away. Last chance to choose where this goes.`],
  [`HNNNGGGGGGH— it's right there. If you're going to aim, do it NOW.`],
  [`HNNNNNGGGGGGG— your whole body has locked up. This is it.`],
  [`HNNNNGH— no more decisions after this one. Aim or don't.`],
  [`HHHNNNNGGGG— the point of no return just waved goodbye. NOW.`],
];

const CLIMAX_MESSAGES = [
  ['A wave of release moves through you, sudden and overwhelming. The tension breaks. (+10 Sanity)'],
  ['Your body shudders. For a moment, nothing else exists. Then the world comes back. (+10 Sanity)'],
  ['The pressure crests and lets go all at once. You exhale. (+10 Sanity)'],
  ['It hits you like a dropped ceiling. Everything goes white, then quiet. (+10 Sanity)'],
  ['You come apart at the seams and take a moment to reassemble. (+10 Sanity)'],
  ['Release rolls through you, toes to scalp. You forget your own name briefly. (+10 Sanity)'],
];

const GROUND_CLIMAX_MESSAGES = [
  ['You come hard, spilling onto the ground at your feet. The tension leaves your body all at once. (+10 Sanity)'],
  ['Your body shudders through it and you finish on the floor. You stand still for a moment, catching your breath. (+10 Sanity)'],
  ['You let go, making a mess of the ground below you. Your legs feel weak. (+10 Sanity)'],
  ['You finish with a groan, painting the floor and swaying on your feet. (+10 Sanity)'],
  ['It rips through you and you spill onto the ground, knees buckling. (+10 Sanity)'],
  ['You come undone, making a mess of the floor and regretting nothing. (+10 Sanity)'],
];

// Message pools for ongoing masturbation events (zone-visible).
// MASTURBATE_EVENT_* (zone, third-person) and MASTURBATE_EVENT_SELF_* (actor,
// "you") are index-aligned — the event loop uses the same idx for both, so an
// onlooker's line always matches the actor's private one. Keep them in lockstep.
export const MASTURBATE_EVENT_MALE = [
  `{name} strokes themselves slowly, lost in it.`,
  `{name} jerks off against the wall, breath catching.`,
  `{name} works their cock with increasing urgency.`,
  `{name} masturbates openly, completely absorbed.`,
  `{name} pumps their fist in long, deliberate strokes.`,
  `{name} edges themselves, fingers tight, pace building.`,
  `{name} spits in their palm and keeps going, shameless.`,
  `{name} grips themselves harder, jaw clenched.`,
  `{name} strokes faster now, all pretense gone.`,
  `{name} works their cock like it owes them money.`,
  `{name} groans low, hips jerking into their own fist.`,
  `{name} thumbs the head and shudders, not stopping.`,
];

export const MASTURBATE_EVENT_FEMALE = [
  `{name} touches themselves slowly, eyes half-closed.`,
  `{name} fingers themselves against the wall, quietly.`,
  `{name} rubs between their legs with increasing focus.`,
  `{name} masturbates openly, breath coming in short pulls.`,
  `{name} works their fingers faster, thighs pressing together.`,
  `{name} pleasures themselves with slow, deliberate circles.`,
  `{name} sinks two fingers in and rolls their hips.`,
  `{name} rubs their clit in tight, urgent circles.`,
  `{name} bites their lip, grinding down onto their own hand.`,
  `{name} fucks themselves on their fingers, pace climbing.`,
  `{name} whimpers, thighs shaking around their wrist.`,
  `{name} works themselves harder, past caring who sees.`,
];

// Self ("you") versions, index-aligned with the zone-visible pools above.
export const MASTURBATE_EVENT_SELF_MALE = [
  `You stroke yourself slowly, lost in it.`,
  `You jerk off against the wall, breath catching.`,
  `You work your cock with increasing urgency.`,
  `You masturbate, completely absorbed.`,
  `You pump your fist in long, deliberate strokes.`,
  `You edge yourself, fingers tight, pace building.`,
  `You spit in your palm and keep going, shameless.`,
  `You grip yourself harder, jaw clenched.`,
  `You stroke faster now, all pretense gone.`,
  `You work your cock like it owes you money.`,
  `You groan low, hips jerking into your own fist.`,
  `You thumb the head and shudder, not stopping.`,
];

export const MASTURBATE_EVENT_SELF_FEMALE = [
  `You touch yourself slowly, eyes half-closed.`,
  `You finger yourself against the wall, quietly.`,
  `You rub between your legs with increasing focus.`,
  `You masturbate, breath coming in short pulls.`,
  `You work your fingers faster, thighs pressing together.`,
  `You pleasure yourself with slow, deliberate circles.`,
  `You sink two fingers in and roll your hips.`,
  `You rub your clit in tight, urgent circles.`,
  `You bite your lip, grinding down onto your own hand.`,
  `You fuck yourself on your fingers, pace climbing.`,
  `You whimper, thighs shaking around your wrist.`,
  `You work yourself harder, past caring who sees.`,
];

// Passive-witness reaction lines for NPCs who see a MIS act happen in their zone.
// Willing NPCs (mis_willing) react with arousal/interest; the rest with disgust/confusion.
export const NPC_WITNESS_AROUSED = [
  `{npc} watches, wetting their lips.`,
  `{npc} stares, openly interested.`,
  `{npc} shifts closer, eyes fixed on the show.`,
  `{npc} bites their lip, watching.`,
  `{npc} doesn't look away — they like what they see.`,
  `{npc} lets out a low, appreciative sound.`,
  `{npc} adjusts themselves, not bothering to hide it.`,
  `{npc} murmurs "oh, don't stop on my account."`,
  `{npc} leans against the wall to enjoy the view.`,
  `{npc} watches with the focus of a nature documentary crew.`,
  `{npc} grins and starts quietly rooting for you.`,
  `{npc}'s breath goes shallow watching.`,
];

export const NPC_WITNESS_DISGUST = [
  `{npc} recoils in disgust.`,
  `{npc} stares in open confusion.`,
  `{npc} looks away, revolted.`,
  `{npc} mutters something and grimaces.`,
  `{npc} shoots a horrified look their way.`,
  `{npc} wrinkles their nose and turns away.`,
  `{npc} gags audibly and steps back.`,
  `{npc} says "what is WRONG with you" to no one in particular.`,
  `{npc} covers their eyes like a scandalized aunt.`,
  `{npc} makes a note to burn this whole zone down later.`,
  `{npc} loudly announces they are calling someone about this.`,
  `{npc} whispers a prayer to whatever's listening.`,
];

// Reactions a willing NPC broadcasts as their (transient, in-memory) arousal
// climbs and finally breaks. {npc} = the NPC's name.
export const NPC_AROUSAL_MSGS = {
  building: [
    `{npc} lets out a soft moan.`,
    `{npc}'s breath goes ragged.`,
    `{npc} whimpers and pushes into it.`,
    `{npc} grips at you, breathing hard.`,
    `{npc} moans, hips moving on their own.`,
    `{npc} bites back a groan and fails.`,
  ],
  edge: [
    `{npc} is panting now, right on the edge.`,
    `{npc} claws at you, barely holding on.`,
    `{npc} gasps, "don't stop — don't you dare stop—"`,
    `{npc} shakes, teeth gritted, so close.`,
    `{npc} whines high in their throat, almost there.`,
  ],
};
export const NPC_CLIMAX_MSGS = {
  female: [
    `{npc} cries out and comes hard, shuddering against you.`,
    `{npc} arches, moans, and finishes with a full-body shudder.`,
    `{npc} clenches and comes, gasping someone's name.`,
    `{npc} shudders through a climax and sags, breathless.`,
  ],
  male: [
    `{npc} groans and spills, cock pulsing.`,
    `{npc} grunts and finishes, shuddering through it.`,
    `{npc} comes hard with a strangled groan.`,
    `{npc} empties with a shudder and goes slack.`,
  ],
};

// Ongoing fucking event messages by location
export const FUCK_EVENT_PLAYER_MSGS = {
  mouth: [
    `You keep going, using your mouth on {target}'s cock.`,
    `You pump {target}'s cock down your throat, setting a rhythm.`,
    `{target} grips your head and keeps fucking your face.`,
    `You gag slightly as {target} keeps going.`,
    `You bury {target} to the base and hold it there.`,
    `You drool down {target}'s cock, working it with your tongue.`,
    `You take {target} deeper, eyes watering.`,
  ],
  pussy: [
    `You thrust into {target} harder.`,
    `You drive into {target}'s pussy, deep and insistent.`,
    `You pick up the pace, fucking {target} harder.`,
    `You and {target} keep going, completely absorbed.`,
    `You grip {target}'s hips and slam home.`,
    `You feel {target} clench around you and keep pounding.`,
    `You fold {target} in half and go deeper.`,
  ],
  ass: [
    `You pump into {target}'s ass in a grinding rhythm.`,
    `You drive deep into {target} and keep going.`,
    `You set a harder pace, buried in {target}'s ass.`,
    `You grip {target}'s hips and bury yourself to the hilt.`,
    `You spread {target} wider and thrust deeper.`,
    `You ride {target}'s ass in long, punishing strokes.`,
  ],
  default: [
    `You keep going, fucking {target} with increasing urgency.`,
    `You and {target} go at it steadily.`,
    `You grip {target} tighter and pick up the pace.`,
    `You lose the rhythm to sheer need, hammering into {target}.`,
  ],
};

export const FUCK_EVENT_TARGET_MSGS = {
  mouth: [
    `{name} keeps going, using your mouth.`,
    `{name} pumps into your throat.`,
    `{name} grips your head and keeps going.`,
    `You gag slightly as {name} keeps going.`,
    `{name} holds you down, buried to the base.`,
    `{name} fucks your face without mercy.`,
    `{name} pushes deeper, your eyes watering.`,
  ],
  pussy: [
    `{name} drives into your pussy harder.`,
    `{name} thrusts into you with building intensity.`,
    `{name} picks up the pace, fucking you harder.`,
    `{name} grips your hips and slams home.`,
    `{name} folds you in half and goes deeper.`,
    `{name} fills you completely with every stroke.`,
  ],
  ass: [
    `{name} pumps into your ass in a grinding rhythm.`,
    `{name} drives deep and keeps going.`,
    `{name} sets a harder pace in your ass.`,
    `{name} buries themselves in your ass to the hilt.`,
    `{name} spreads you wider and thrusts deeper.`,
    `{name} rides your ass in long, punishing strokes.`,
  ],
  default: [
    `{name} keeps fucking you with increasing urgency.`,
    `You and {name} keep going.`,
    `{name} grips you tighter and picks up the pace.`,
    `{name} hammers into you, past all restraint.`,
  ],
};

export const FUCK_EVENT_MSGS = {
  mouth: [
    `{name} pumps into {target}'s throat, setting a rhythm.`,
    `{name} grips {target}'s head, fucking their face steadily.`,
    `{target} gags slightly as {name} keeps going.`,
    `{name} holds {target} down and thrusts deep.`,
    `{target} drools around {name}'s cock, taking it.`,
    `{name} uses {target}'s mouth without mercy.`,
  ],
  pussy: [
    `{name} thrusts into {target} with building intensity.`,
    `{name} and {target} fuck in a steady, urgent rhythm.`,
    `{name} drives into {target}'s pussy, deep and insistent.`,
    `{target} grips {name}'s back as {name} keeps thrusting.`,
    `{name} picks up the pace, fucking {target} harder.`,
    `{name} grips {target}'s hips and slams home.`,
    `{target} moans as {name} folds them in half.`,
    `{name} pounds into {target}, the slap of skin filling the room.`,
  ],
  ass: [
    `{name} pumps into {target}'s ass in a grinding rhythm.`,
    `{name} and {target} continue — {name} buried in {target}'s ass.`,
    `{name} drives deep into {target} and keeps going.`,
    `{target} grunts as {name} sets a harder pace.`,
    `{name} grips {target}'s hips and buries themselves to the hilt.`,
    `{name} spreads {target} wider and thrusts deeper.`,
    `{name} rides {target}'s ass in long, punishing strokes.`,
  ],
  default: [
    `{name} and {target} continue having sex.`,
    `{name} and {target} are going at it steadily.`,
    `{name} fucks {target} with increasing urgency.`,
    `{name} and {target} keep going, lost in each other.`,
    `{name} grips {target} tighter and picks up the pace.`,
    `{name} hammers into {target}, past all restraint.`,
  ],
};

// Threesome — a second willing partner ({third}) pulled into an ongoing fuck.
// {name} = the one doing the fucking, {target} = the primary partner, {third} =
// the joiner. Fired occasionally on the fuck tick; keep them room-flavour, not a
// full second event.
export const THREESOME_JOIN_MSGS = [
  `{third} presses in close, not content to just watch, hands roaming over {name} and {target} both.`,
  `{third} slides up behind {name}, kissing their neck and murmuring encouragement.`,
  `{third} straddles {target}'s face and grinds down while {name} keeps thrusting.`,
  `{third} guides {name}'s free hand between their legs and rides it.`,
  `{third} kisses {target} deep, swallowing their moans, then breaks off to lick their way down.`,
  `{third} works themselves against {name}'s hip, greedy for a share of it.`,
  `{third} traps {name}'s hand and uses it, gasping, refusing to be left out.`,
  `{name}, {target} and {third} tangle together, all limbs and heat and no idea where one stops.`,
];
export const THREESOME_CLIMAX_MSGS = [
  `{third} shudders through their own finish, clinging to the pair of them.`,
  `{third} cries out and comes too, dragged over the edge by the sight of it.`,
  `{third} presses their face to {target}'s shoulder and lets go, boneless.`,
];

// Zone-visible ejaculation broadcast messages
export const EJACULATE_ZONE_MSGS = {
  ground: [
    `{name} finishes with a groan, coming onto the ground.`,
    `{name} shudders and spills across the floor.`,
    `{name} comes hard, making a mess at their feet.`,
    `{name} grunts and empties onto the ground.`,
    `{name} paints the floor and exhales like they ran a marathon.`,
    `{name} finishes messily where they stand.`,
  ],
  on_player: [
    `{name} finishes on {target}, leaving them marked.`,
    `{name} comes across {target}'s {part}.`,
    `{name} shudders and empties onto {target}.`,
    `{name} paints {target}'s {part} and groans.`,
    `{name} coats {target}'s {part}, breathing hard.`,
    `{name} finishes all over {target}'s {part}.`,
  ],
  into_player: [
    `{name} buries deep and finishes inside {target}.`,
    `{name} comes hard inside {target}'s {part}.`,
    `{name} shudders through a climax, buried in {target}.`,
    `{name} holds {target} down and empties inside them.`,
    `{name} floods {target}'s {part} and stays buried.`,
    `{name} finishes deep in {target} with a low groan.`,
  ],
  into_mouth: [
    `{name} finishes down {target}'s throat.`,
    `{name} holds {target}'s head still and empties into their mouth.`,
    `{name} comes hard in {target}'s mouth; they swallow it down.`,
    `{name} shudders, spilling across {target}'s tongue.`,
    `{name} pumps the last of it into {target}'s mouth.`,
  ],
  // Volume-banded overflow lines, appended to the room broadcast when a finish
  // is too big for wherever it went. Keyed by the part it went into, because
  // "there is more of it than there is room for it" reads differently depending
  // on where you are standing.
  overflow: {
    pussy:  [`It runs back out of {target} and down their thigh before {name} has even pulled away.`,
             `There is too much of it; the excess spills out of {target} and onto the floor.`],
    ass:    [`{target} can't hold it. Most of it runs straight back out of them.`,
             `It leaks out of {target} the moment {name} withdraws, and keeps leaking.`],
    mouth:  [`{target} can't swallow fast enough — it spills past their lips and down their chin.`,
             `More than {target} bargained for. They choke, cough, and wear the rest of it.`],
    throat: [`{target} gags on the volume of it and loses half down their own front.`,
             `It's too much for {target}'s throat; the overflow goes down their chin.`],
    body:   [`There is far more of it than {target} expected, and it goes everywhere.`],
  },
  furniture: [
    `{name} finishes against the {target}, leaving it marked.`,
    `{name} comes onto the {target}.`,
    `{name} empties onto the {target} with a grunt.`,
    `{name} leaves the {target} dripping and doesn't apologize.`,
  ],
};

// ── Service acts (finger / handjob / suck / eat out) ─────────────────────────
// These are ongoing timed events where the ACTOR pleasures the TARGET, so the
// TARGET's horniness drives the climax (unlike fuck/masturbate, where the actor
// finishes). Pools keyed by act — {name} is the actor (performer), {target} is
// the receiver. zone = third-person room line, actor = performer's "you" line,
// target = receiver's "{name}…" line.
export const SERVICE_EVENTS = {
  finger_pussy: {
    zone: [
      `{name} works their fingers into {target}, wrist moving steadily.`,
      `{name} fingers {target} deep, thumb circling.`,
      `{target} rocks against {name}'s hand, breath ragged.`,
      `{name} curls their fingers inside {target} and doesn't let up.`,
    ],
    actor: [
      `You pump your fingers into {target}, curling them just right.`,
      `You work {target} open, thumb rolling over their clit.`,
      `You feel {target} clench around your fingers and go faster.`,
      `You finger {target} harder, their wetness slicking your hand.`,
    ],
    target: [
      `{name} works their fingers into you, curling them just right.`,
      `{name} thumbs your clit while they finger you deeper.`,
      `{name} picks up the pace, fingers buried in you.`,
      `{name} has you clenching helplessly around their hand.`,
    ],
  },
  finger_ass: {
    zone: [
      `{name} works a finger into {target}'s ass, slow and deliberate.`,
      `{name} fingers {target}'s ass, other hand gripping their hip.`,
      `{target} pushes back onto {name}'s hand with a grunt.`,
    ],
    actor: [
      `You ease your fingers into {target}'s ass and find a rhythm.`,
      `You work {target} open, feeling them tighten around you.`,
      `You finger {target}'s ass deeper, their breath hitching.`,
    ],
    target: [
      `{name} works their fingers into your ass, finding a rhythm.`,
      `{name} presses deeper, and you push back onto their hand.`,
      `{name} fingers your ass steadily, not letting up.`,
    ],
  },
  handjob: {
    zone: [
      `{name} strokes {target}'s cock in a steady rhythm.`,
      `{name} works {target} in their fist, wrist twisting.`,
      `{target}'s hips buck into {name}'s hand.`,
      `{name} pumps {target}'s cock faster, thumb over the head.`,
    ],
    actor: [
      `You stroke {target}'s cock, thumb sliding over the head.`,
      `You work {target} in your fist, twisting on the upstroke.`,
      `You feel {target} throb in your hand and speed up.`,
      `You jerk {target} harder, their breath going short.`,
    ],
    target: [
      `{name} strokes your cock, thumb sliding over the head.`,
      `{name} twists their fist on the upstroke and you groan.`,
      `{name} works you faster, grip just right.`,
      `{name} jerks you harder, and your hips buck into their hand.`,
    ],
  },
  suck_cock: {
    zone: [
      `{name} works their mouth up and down {target}'s cock.`,
      `{name} takes {target} deep, cheeks hollowing.`,
      `{target} grips the back of {name}'s head, hips twitching.`,
      `{name} drools around {target}'s cock, bobbing steadily.`,
    ],
    actor: [
      `You take {target}'s cock deep, tongue working the underside.`,
      `You bob up and down, cheeks hollowing around {target}.`,
      `You feel {target} throb against your tongue and take them deeper.`,
      `You drool down {target}'s cock and swallow around it.`,
    ],
    target: [
      `{name} takes your cock deep, tongue working the underside.`,
      `{name} bobs up and down, cheeks hollowing around you.`,
      `{name} swallows around you, and your hips twitch.`,
      `{name} takes you to the base and holds it there.`,
    ],
  },
  suck_tits: {
    zone: [
      `{name} sucks at {target}'s nipple, hand kneading the other breast.`,
      `{name} works {target}'s tits with mouth and hands.`,
      `{target} arches into {name}'s mouth with a gasp.`,
    ],
    actor: [
      `You suck {target}'s nipple, rolling the other between your fingers.`,
      `You lave {target}'s tits with your tongue, kneading them.`,
      `You feel {target} arch into your mouth and don't stop.`,
    ],
    target: [
      `{name} sucks your nipple, rolling the other between their fingers.`,
      `{name} works your tits with mouth and hands.`,
      `{name} has you arching into their mouth with every pass.`,
    ],
  },
  eatout_pussy: {
    zone: [
      `{name} buries their face between {target}'s legs, tongue working.`,
      `{name} eats {target} out with slow, deliberate focus.`,
      `{target} grinds against {name}'s mouth, thighs shaking.`,
      `{name} laps at {target}, hands pinning their hips.`,
    ],
    actor: [
      `You drag your tongue through {target}, slow and deliberate.`,
      `You suck {target}'s clit and feel their thighs clamp your head.`,
      `You eat {target} out, hands pinning their bucking hips.`,
      `You work {target} with your tongue until they're shaking.`,
    ],
    target: [
      `{name} drags their tongue through you, slow and deliberate.`,
      `{name} sucks your clit and your thighs clamp around their head.`,
      `{name} eats you out, hands pinning your bucking hips.`,
      `{name} works you with their tongue until you're shaking.`,
    ],
  },
  eatout_ass: {
    zone: [
      `{name} presses their tongue against {target}'s ass, working slowly.`,
      `{name} rims {target}, hands spreading them wide.`,
      `{target} shudders under {name}'s tongue.`,
    ],
    actor: [
      `You work your tongue against {target}'s ass, slow and thorough.`,
      `You rim {target}, spreading them wider with both hands.`,
      `You feel {target} shudder against your mouth and keep going.`,
    ],
    target: [
      `{name} works their tongue against your ass, slow and thorough.`,
      `{name} rims you, spreading you wider with both hands.`,
      `{name} has you shuddering against their mouth.`,
    ],
  },
};

// Receiver's climax (service acts). {name} = actor, {target} = receiver.
export const SERVICE_CLIMAX_ZONE = {
  female: [
    `{target} arches and comes hard as {name} keeps working.`,
    `{target} shudders through a climax under {name}.`,
    `{target} cries out, finishing while {name} doesn't let up.`,
  ],
  male: [
    `{target} groans and spills as {name} keeps working.`,
    `{target} shudders and finishes under {name}.`,
    `{target} comes hard, {name} working them through it.`,
  ],
};
export const SERVICE_CLIMAX_ACTOR = {
  generic: [
    `{target} comes apart under you. You work them through it.`,
    `You feel {target} tense and let go, and don't stop until they're done.`,
    `{target} finishes hard. You keep going until they're wrung out.`,
  ],
  suck_cock: [
    `{target} finishes in your mouth. You take all of it.`,
    `{target} spills across your tongue with a groan; you swallow.`,
    `{target} empties into your mouth and you don't spill a drop.`,
  ],
};
const SERVICE_TARGET_CLIMAX = [
  ['Your body seizes and lets go all at once. The tension breaks. (+10 Sanity)'],
  ['You come hard under their hands, legs shaking. (+10 Sanity)'],
  ['Release rips through you and leaves you boneless. (+10 Sanity)'],
];

// Reset the RECEIVER after a service-act climax. Males mark penis residue +
// caller stains the zone; females mark legs. Mirrors triggerClimax's bookkeeping.
export async function triggerServiceClimax(target) {
  target.horniness = 0;
  target.sanity = Math.min(target.sanity_max || 100, (target.sanity || 50) + 10);
  target.horniness_last_increased = null;
  if (!target.appearance_data) target.appearance_data = {};
  if (target.biological_sex === 'male') {
    target.erect = 0;
    target.appearance_data.ejaculate_state = { locations: ['penis'] };
    await query('UPDATE players SET horniness=0, erect=0, sanity=$1, appearance_data=$2 WHERE id=$3',
      [target.sanity, JSON.stringify(target.appearance_data), target.id]);
  } else {
    target.appearance_data.ejaculate_state = { locations: ['legs'] };
    await query('UPDATE players SET horniness=0, sanity=$1, appearance_data=$2 WHERE id=$3',
      [target.sanity, JSON.stringify(target.appearance_data), target.id]);
  }
  return pick(SERVICE_TARGET_CLIMAX);
}

export const MIS_TUTORIAL = `<span style="color:var(--accent)">— MATURE INTERACTION SYSTEM ENABLED —</span>

You've unlocked biological realism mode. This system simulates the body honestly — not to titillate, but because bodies are part of survival. Think of it as the same candor the game applies to violence.

<span style="color:var(--text-dim)">SOLO:</span>
  stroke / masturbate / jerkoff / rubself / fingerself
  jerk off on &lt;target&gt;
  ejaculate / cum [on &lt;target&gt;'s &lt;part&gt; / ground / &lt;furniture&gt;]  (requires 50%+ arousal; males only)

<span style="color:var(--text-dim)">WITH OTHERS — CONSENT FIRST:</span>
  Nobody can aim any of the verbs below at you until you say so, and this
  switch you've just flipped does not say so. It opts you into the system,
  not into anyone in particular.
  consent &lt;player&gt;       — let them act on you. One-way: they need their own.
  revoke &lt;player&gt; / all  — take it back. Instant, stops anything in progress.
  consent                — who you've let in, and who has let you in
  consent ask &lt;player&gt;   — ask once. Ignoring it is a complete answer.

  touch / squeeze / fondle / lick &lt;target&gt;'s &lt;body part&gt;
  kiss &lt;target&gt;
  slap &lt;target&gt;'s &lt;body part&gt;
  finger &lt;target&gt;['s pussy / asshole]   (defaults by their sex)
  handjob / hj &lt;target&gt;
  suck &lt;target&gt;'s [cock / tits / pussy]
  blowjob / bj &lt;target&gt;
  eat out &lt;target&gt;'s [pussy / ass]
  fuck &lt;target&gt; [in mouth / pussy / ass]
  sex / screw / rail / bang / breed &lt;target&gt; [in ...]
  cum in &lt;target&gt;'s [mouth / pussy / ass]  (males, 50%+ arousal)
  cum   — mid-sex, a bare "cum" finishes where you're already buried
          (pull out and aim it elsewhere with cum on/in &lt;target&gt;)

<span style="color:var(--text-dim)">LOOK CLOSER:</span>
  examine &lt;target&gt;'s [genitals / tits / nipples / ass / asshole]

<span style="color:var(--text-dim)">OTHER:</span>
  wash   — clean yourself at a sink, in the rain, or with water

Most acts restore sanity. Arousal builds during events and peaks at climax.
finger / handjob / suck / eat out are ongoing — they run until your partner
finishes (or you STOP), and the whole room can see. Penetrative sex requires
naked legs — clothed players grind instead.
Type <span style="color:var(--accent)">examine me</span> to see your current state.

<span style="color:var(--text-dim)">Type MIS OFF in the debug field to disable.</span>`;
