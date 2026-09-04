// Training stations — the data half of the gym.
//
// A station is a verb + a piece of furniture + a stat it converts XP into. The
// bench (`lift` → Brawn) was the original and its numbers are unchanged; `spar`
// and `drill` are its Slagball-pit cousins, added when the Sump's back room gave
// the basin its first public gym.
//
// Everything that differs between stations lives here so index.js stays one
// workout loop rather than three. To add a station: add an entry, list its verb
// in plugin.json "commands", and flag a furniture piece with the matching
// `flags.interactions` key. Nothing else needs to know it exists.
//
// Fields:
//   verb        the command that starts it (also the plugin.json entry)
//   interaction the furniture `flags.interactions` key that marks a usable station
//   stat        the RAISABLE_STATS name; the column is `stat_<name>`
//   posture     posture required BEFORE starting ('lying' on a bench, 'standing'
//               for anything you do on your feet). null = no requirement.
//   setMs       real ms per set — the grind's tempo
//   staPerSet   stamina burned per set; the tank is the cap on one session
//   repsBase/repsPerLevel   sets needed for the next point = base + level×perLevel
//   noun        what the room calls it when there isn't one here
//   lines       the prose: three fatigue tiers, the gain, the openers, the exits

export const STATIONS = {
  // ── The bench: raw pressing strength ───────────────────────────────────────
  lift: {
    verb: 'lift', interaction: 'lift', stat: 'brawn', posture: 'lying',
    setMs: 8000, staPerSet: 12, repsBase: 4, repsPerLevel: 2,
    noun: 'a weight bench',
    busyLine: "You're already mid-set. Grit your teeth and keep pushing.",
    combatLine: "You're a little busy fighting to be lifting weights.",
    exhaustedLine: "You're still wrecked from your last set — give your arms a minute to come back before you touch the bar.",
    windedLine: "You're too winded to lift — you can barely make a fist right now. Catch your breath first.",
    missingLine: "There's nothing here to lift on — you'll want a weight bench.",
    postureLine: s => `Lie back on the ${s} first (try: lie on ${s}).`,
    startLine: () => 'You lie back, chalk your hands, and take the bar. Time to move some iron. (Type STOP to rack it.)',
    startZoneLine: h => `${h} takes the bar and starts pumping iron.`,
    stopLine: 'You rack the weights and sit up, muscles humming.',
    stopZoneLine: h => `${h} racks the weights and stands up.`,
    gassedLine: "Your arms give out mid-press. The bar clatters back into the rack and you slump off the bench, utterly spent. <b>You're exhausted.</b>",
    strong: [
      'You grind out another set, veins standing up like cabling.',
      'The bar bends. You do not. Another rep bangs home.',
      'You punch out a set, breath hissing through your teeth. Somewhere, a shirt sleeve dies.',
      'Iron up, iron down. Your muscles file a formal complaint.',
      'You crank another rep, grunting loud enough to worry the neighbours.',
      'Rusted plates rattle as you press them skyward one more time.',
      'You squeeze out a set. Your future arms thank you; your present ones scream.',
      'Another rep. The bench creaks a small prayer.',
      'You heave the bar up, hold, and drop it with a clang that rolls off the concrete.',
      'Sweat, grit, and pure spite. You pound through another set.',
      'You stare at the ceiling and will the bar back up. It obeys, eventually.',
      'One more. Always one more. Your shoulders hate this and love it.',
    ],
    labored: [
      'Your arms are getting heavy now — the bar comes up slower than it went down.',
      'Sweat sheets down your face. You blink it away and grind out another set.',
      'The burn is setting in deep. You push through it, jaw clenched.',
      'Breath coming ragged now, you muscle the bar up one more time.',
      'Your shirt is soaked through. The reps are getting ugly, but they still count.',
      'You blow out a hard breath and force another set. Legs starting to tremble.',
    ],
    gassed: [
      'Your arms are shaking. Each rep is a small war now.',
      'You can barely lock out the bar. Lungs heaving, you claw for one more.',
      'Every rep feels like it might be the last. You gasp and grind on anyway.',
      'Spots swim at the edge of your vision. The bar wobbles up, barely.',
      "You're running on fumes and spite now. Mostly spite.",
      'Your whole body screams to quit. You spit, grit your teeth, and press.',
    ],
    gain: [
      'Something in your shoulders shifts and settles heavier.',
      'The pump hits like a cheap drug — you are, measurably, more of a unit.',
      'New meat on old bone. The bar felt lighter that last set.',
      'You rack it, flex, and catch your reflection. Bigger. Meaner.',
      'A deep ache blooms and hardens into something useful.',
    ],
  },

  // ── The rebound wall: reading a slag off the bounce ────────────────────────
  spar: {
    verb: 'spar', interaction: 'spar', stat: 'reflexes', posture: 'standing',
    setMs: 6000, staPerSet: 9, repsBase: 4, repsPerLevel: 2,
    noun: 'a rebound wall',
    busyLine: "You're already in the ring, hands up. Watch the wall.",
    combatLine: "Someone is already throwing things at you. Consider that your session.",
    exhaustedLine: "Your hands are still hanging at your knees from the last round. Give it a minute.",
    windedLine: "You're blowing too hard to see a slag coming, let alone slip one. Catch your breath.",
    missingLine: "There's nothing to work off — you'd want a rebound wall, and the nerve to stand in front of it.",
    postureLine: s => `Get on your feet before you step up to the ${s}.`,
    startLine: s => `You toe the chalk, square up to the ${s}, and put the first one in hard. (Type STOP to step out.)`,
    startZoneLine: h => `${h} steps into the ring and starts working the wall.`,
    stopLine: 'You catch the last one on your chest, tuck it under an arm, and step off the chalk.',
    stopZoneLine: h => `${h} steps off the chalk, breathing hard.`,
    gassedLine: "The slag comes off the wall, you don't move, and it takes you square in the sternum. You sit down on the concrete, wheezing. <b>You're exhausted.</b>",
    strong: [
      'Throw, bounce, catch. Throw, bounce, catch. The rhythm builds.',
      'You put one in low and take the rebound off your knuckles without looking.',
      'The slag comes back mean. You slip it, catch it on the turn, and send it again.',
      'You work the angles — off the joist, off the wall, back to the chest.',
      'Two-handed, hard, flat. The foam thuds and comes home.',
      'You catch one blind and grin at nobody in particular.',
      'The wall gives back exactly what you give it.',
      'Off the padding, off the floor, up into your hands. Clean.',
      'You snap one out sidearm and pick the rebound out of the air like fruit.',
    ],
    labored: [
      'Your hands are getting slow — the last one nearly went past you.',
      'You catch it late, against your forearms, and it stings.',
      'The rhythm is going. You throw anyway, and mostly get there.',
      'Sweat in your eyes. The slag is a grey smear coming back at you.',
      'You misjudge the bounce and take it off a shoulder. It counts. It hurts.',
    ],
    gassed: [
      'You are catching with your chest now, because your hands stopped answering.',
      'The wall is winning. You throw one more out of spite and wear the rebound.',
      'Everything is slow and loud. You get a hand to it. Barely.',
      'You blink and the slag is already past you. You go and fetch it.',
      "Your arms are done. You're running on the memory of coordination.",
    ],
    gain: [
      'Something in your hands gets quicker than your thinking.',
      'The bounce stops surprising you. It just arrives, and you are already there.',
      'You catch one behind your own back, entirely by accident, entirely on purpose.',
      "Your eyes and your hands stop arguing about who saw it first.",
      'The wall throws its best and you are, briefly, faster than a wall.',
    ],
  },

  // ── The circuit: hauling dead weight until the room stops spinning ────────
  drill: {
    verb: 'drill', interaction: 'drill', stat: 'endurance', posture: 'standing',
    setMs: 9000, staPerSet: 14, repsBase: 4, repsPerLevel: 2,
    noun: 'a conditioning circuit',
    busyLine: "You're already on the circuit. Keep your feet moving.",
    combatLine: "You're getting all the cardio you need right now, thanks.",
    exhaustedLine: "Your legs are still made of wet rope from the last circuit. Sit this one out.",
    windedLine: "You've got nothing left in the tank to burn. Breathe first.",
    missingLine: "There's nothing here to work — you'd want a conditioning circuit, or at least something heavy and a long way to carry it.",
    postureLine: s => `You'll have to be on your feet to work the ${s}.`,
    startLine: s => `You strip down, chalk your palms, and start the ${s}. (Type STOP to pack it in.)`,
    startZoneLine: h => `${h} starts hauling weight back and forth, breathing like a bellows.`,
    stopLine: 'You set the last of it down, put your hands on your knees, and let the room come back.',
    stopZoneLine: h => `${h} sets the weight down and stops, hands on knees.`,
    gassedLine: "Your legs quit somewhere between one end and the other. You go down on the concrete, arms out, staring at the joists. <b>You're exhausted.</b>",
    strong: [
      'Up, across, down, back. Your lungs start to open.',
      'You haul the load the length of the room and set it down soft, because dropping it is quitting.',
      'Feet moving, breath even. This is the easy part and you know it.',
      'You get into the rhythm where the weight stops feeling like a decision.',
      'Another circuit. Your heart finds its working gear and stays there.',
      'Chalk, grip, lift, walk. The stack goes over and comes back.',
      'You count in your head and lose the number, which means it is going well.',
    ],
    labored: [
      'Your breath is coming in through your teeth now. The load has not changed. You have.',
      'Legs burning, you make the far wall and turn around anyway.',
      'You set it down a fraction harder than you meant to.',
      'Sweat is running off your chin in a steady line. You keep walking.',
      'The room is getting longer every trip. That is not how rooms work.',
    ],
    gassed: [
      'Your lungs are a house fire. You pick it up regardless.',
      'You make it halfway, stop, and refuse to be the kind of person who stops. You finish.',
      'Everything below the waist has filed a complaint. Everything above is too tired to read it.',
      'You are moving on autopilot and the autopilot is also tired.',
      'One more length. You have said that four times.',
    ],
    gain: [
      'Your heart stops hammering a full circuit earlier than it used to.',
      'Somewhere in there your body quietly decides it can take more of this.',
      'The burn arrives later and leaves faster. That is the whole game.',
      'You stand up straight at the end instead of folding. Small thing. Enormous thing.',
      'Your wind comes back before your pride does, for once.',
    ],
  },
};

// Verb → station, for the command table.
export const STATION_VERBS = Object.keys(STATIONS);

// Sets required for the next point at this station, at your current level.
export function repsFor(station, level) {
  return station.repsBase + Math.max(0, level) * station.repsPerLevel;
}

// Pick a set line by remaining stamina fraction — the emptier the tank, the more
// the reps visibly hurt. This is the progressive-exhaustion telegraph.
export function setFlavor(station, staFrac) {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  if (staFrac > 0.6) return pick(station.strong);
  if (staFrac > 0.3) return pick(station.labored);
  return pick(station.gassed);
}
