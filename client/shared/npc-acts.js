// What an emote line says somebody is doing, as an act the Room Stage can draw (actor3d.js ACTOR_ACTS turns
// the act into a clip for how they are: on their feet, sitting or lying). The text world says it in words, and
// whoever has the room open sees the body do it. Pure, so a gate reads it.
//
// The line is the one the text game prints, its name already taken off the front: "wipes down the counter."
// First match wins, so the narrow ones come before the broad ones: "nods off" before "nods", "leans against"
// before "leans", "writes" before "counts".

const P = '(?:his|her|their|a|the)';
const ACTS = [
  // at a card table (plugins/gametable GameTable._gesture): before 'tap', 'toss' and 'lean' can take them
  ['rap', /\b(raps?|knocks?) (on )?the (felt|table)\b/],
  ['muck', /\bmucks?\b/],
  ['chips', /\b(slides?|pushes|push|shoves?) (chips|a stack|the whole stack)\b/],
  ['deal', /\bdeals? (them|the cards|a card|out)\b/],
  ['doze', /\b(doz(es?|ing)|nods? off|snor(es?|ing)|naps?|drifts? off|falls? asleep)\b/],
  ['cower', new RegExp(`\\b(cowers?|flinch(es)?|backs? away|ducks?|shields? ${P} (face|head)|throws? ${P} arms up)\\b`)],
  ['laugh', /\b(laugh(s|ing)?|chuckles?|cackles?|giggles?|snickers?|guffaws?)\b/],
  ['cough', /\b(coughs?|hacks?|splutters?|wheezes?)\b/],
  // a dancer taking a layer off and putting it back on (plugins/strippers): before 'tug' ("peels") and 'adjust'
  ['redress', /\b(back on|back over|back together|pulls? (his|her|their) clothes back)\b/],
  ['undress', /\b(slips? off|peels? .+ off|peels? off|steps? out of|unhooks?|unzips?|down to nothing)\b/],
  // too hot and too cold, and the small things somebody does with nothing to do: all narrower than what follows
  // ("wipes their face" isn't cleaning, "blows on their hands" isn't smoke, "does a few squats, counting" isn't the till)
  ['swelter', /\bfans? (himself|herself|themselves|themself)\b/],
  ['brow', new RegExp(`\\b(wipes?|mops?) ${P} (face|forehead|brow)\\b`)],
  ['tug', new RegExp(`\\b((tugs?|pulls?) at ${P} collar|peels? ${P} shirt)\\b`)],
  ['blow', new RegExp(`\\b(blows?|breathes?) (on|into) ${P} (cupped )?hands\\b`)],
  ['stoop', /\b(picks? (something|it|them|a \w+) up off|stoops?|bends? down)\b/],
  ['exercise', /\b(does (a few |some )?(slow )?squats|press-ups|push-ups|sit-ups)\b/],
  ['rub', new RegExp(`\\brubs? ${P} (eyes|face)\\b`)],
  ['knuckles', new RegExp(`\\bcracks? ${P} knuckles\\b`)],
  ['rock', new RegExp(`\\brocks? on ${P} heels\\b`)],
  ['tap', /\btaps? a foot\b/],
  ['roll', new RegExp(`\\brolls? ${P} neck\\b`)],
  ['smoke', /\b(smokes?|cigarettes?|cigars?|lights? up|lights? a|drags? on|takes? a drag|vapes?|blows? smoke|ashes)\b/],
  // behind a bar (plugins/bartender's lines): before 'drink', since "pours a drink" isn't drinking one
  ['pint', /\b(pulls? (you |him |her |them )?(a|another|two|three) (pint|half|beer)s?|draws? (a|another) (pint|beer))\b/],
  ['mix', /\b(shakes? (up )?(a |the |another |your )?(cocktail|martini|shaker|tin|drink)s?|mix(es)? (a|the|you|another|up)|muddles?|strains? (it|the|a))\b/],
  ['slide', /\bslides? (a |the |your |it |another |his |her )?(\w+ )?(down|across|along) the (bar|counter)\b/],
  ['eye', /\b(holds? (a|the) bottle (up )?to the light|checks? (the|a) (bottle|level))\b/],
  ['pour', /\b(pours?|tops? (it |you |him |her |them )?up)\b/],
  ['polish', /\b(polish(es)?|buffs?)\b/],
  ['drink', new RegExp(`\\b(drinks?|sips?|swigs?|gulps?|takes? a pull|knocks? back|nurses? ${P}|downs ${P})\\b`)],
  ['eat', /\b(eats?|chews?|bites? into|munch(es)?|nibbles?|wolfs?|takes? a bite)\b/],
  ['wipe', /\b(wipes?|scrubs?|mops?|dusts?|cleans?)\b/],
  ['wash', /\b(rinses?|wash(es)?|runs? the tap|fills? a glass)\b/],
  ['stir', /\b(stirs?|fries|cooks?|chops?|seasons?|flips? the)\b/],
  // what a show's stage directions ask for (data/scripts/*.bsm): bigger than anything a barman does
  ['stumble', /\b(trips?|stumbles?|staggers?|lurches?|falls? over)\b/],
  ['spread', new RegExp(`\\b(spreads? ${P} arms|arms (wide|out)|throws? ${P} arms (wide|out|open))\\b`)],
  ['holdup', /\b(holds? (it |them )?(up|aloft)|aloft|produces?|brandish(es)?)\b/],
  ['toss', /\b(throws?|toss(es|ing)?|flings?|hurls?|chucks?|slops?|fires? in|drops? (a|the|it|his|her|their) )/],
  ['slam', /\b(slams?|slaps?|pounds? (on|the|his|her|their)|thumps?|bangs? on)\b/],
  ['reach', new RegExp(`\\b(reach(es)?|press(es)? (the|a)|pushes the|claps? (him|her|them) on|pats?|tightens?|flips? to)\\b`)],
  ['grab', /\b(grabs?|seiz(es?|ing)|wrench(es)?|yanks?|hauls?)\b/],
  ['flex', /\bflex(es|ing)?\b/],
  ['point', /\b(points?|jabs? a finger|gestures? (at|to|toward))\b/],
  ['clap', /\b(applauds?|claps?)\b/],
  ['wink', /\bwinks?\b/],
  ['barsmoke', /\b(smok(es|ing) at the bar|leans? on the bar with a (cigarette|smoke))\b/],
  ['slouch', /\b(slouch(es|ed|ing)?|lounges?|sprawls?|leans? back (against|on))\b/],
  ['leanin', /\bleans? in\b/],
  ['lens', /\b(at|into|to) the (camera|lens)\b/],
  ['stare', /\b(stares? (into|as|at (?!nothing))|staring|sits? very still|does not move|motionless|has not blinked)\b/],
  // and changing what they've got on
  ['adjust', /\b(adjusts?|straightens? (his|her|their)|tugs? at|pulls? on|changes? (back )?into|strips? down|takes? a layer off|puts? (it|a second \w+) on)\b/],
  ['brace', /\b(barricad\w*|back against|braces? (himself|herself|themselves))\b/],
  ['enter', /\b(enters?( the frame)?|steps? into (frame|shot))\b/],
  ['rummage', /\b(takes? out|opens a|takes .+ off|rummages?|roots? (around|through)|digs? (around|through)|goes through|looks? (in|through|for)|searches|opens the|takes .+ out of|feels? around)\b/],
  ['write', /\b(writes?|scribbles?|jots?|signs? (something|a|the)|fills? (in|out))\b/],
  ['count', /\b(counts?|tallies|the till|the cash|a roll of notes)\b/],
  ['phone', /\b(phones?|texts?|thumbs? through|messages?|calls? someone)\b/],
  ['read', new RegExp(`\\b(reads?|flicks? through|leafs? through|newspaper|tablet|scrolls?|checks? ${P} (screen|list|ledger))\\b`)],
  ['dance', new RegExp(`\\b(danc(es?|ing)|sways?|bobs? ${P} head|taps? ${P} (foot|feet)|shimm(y|ies)|hums?)\\b`)],
  ['shiver', new RegExp(`\\b(shivers?|shudders?|rubs? ${P} (hands|arms)|blows? on ${P} hands|stamps? ${P} feet)\\b`)],
  ['shrug', /\bshrugs?\b/],
  ['stretch', new RegExp(`\\b(stretch(es)?|cracks? ${P} (back|neck|knuckles)|rolls? ${P} shoulders)\\b`)],
  ['yawn', /\byawns?\b/],
  ['sigh', new RegExp(`\\b(sighs?|groans?|lets? out a breath|exhales?|arm over ${P} eyes)\\b`)],
  ['scratch', /\bscratch(es)?\b/],
  ['time', new RegExp(`\\b(checks? ${P} (time|watch)|glances? at ${P} watch)\\b`)],
  ['wave', /\bwav(es?|ing)\b/],
  ['fold', new RegExp(`\\b(folds? ${P} arms|arms folded|cross(es)? ${P} arms)\\b`)],
  ['wait', new RegExp(`\\b(leans? (against|back)|waits?|drums? ${P} fingers|taps? ${P} fingers|stares? at nothing)\\b`)],
  ['lean', /\b(leans? (on|over|across|forward))\b/],
  ['nod', /\bnods?\b/],
  ['look', /\b(looks? (around|about|up|out|down|over|at)|watch(es)? as|glances? (around|about|over|up|at the door)|peers?|keeps? an eye|watches the)\b/],
];

// The act a line describes, or null.
export function actOfLine(line) {
  const t = String(line || '').toLowerCase();
  for (const [act, re] of ACTS) if (re.test(t)) return act;
  return null;
}
export const NPC_ACTS = ACTS.map(([act]) => act);

// Whose line it is: the longest name in `names` that the line starts with, then a space. Null if nobody's.
export function speakerOf(line, names) {
  const t = String(line || '');
  let best = null;
  for (const n of names) if (n && t.length > n.length && t.startsWith(n + ' ') && (!best || n.length > best.length)) best = n;
  return best;
}
