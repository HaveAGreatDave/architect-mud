// What an emote line says somebody is doing, as an act the Room Stage can draw (actor3d.js ACTOR_ACTS turns
// the act into a clip for how they are: on their feet, sitting or lying). The text world says it in words, and
// whoever has the room open sees the body do it. Pure, so a gate reads it.
//
// The line is the one the text game prints, its name already taken off the front: "wipes down the counter."
// First match wins, so the narrow ones come before the broad ones: "nods off" before "nods", "leans against"
// before "leans", "writes" before "counts".

const P = '(?:his|her|their|a|the)';
const ACTS = [
  ['doze', /\b(doz(es?|ing)|nods? off|snor(es?|ing)|naps?|drifts? off|falls? asleep)\b/],
  ['cower', new RegExp(`\\b(cowers?|flinch(es)?|backs? away|ducks?|shields? ${P} (face|head)|throws? ${P} arms up)\\b`)],
  ['laugh', /\b(laugh(s|ing)?|chuckles?|cackles?|giggles?|snickers?|guffaws?)\b/],
  ['cough', /\b(coughs?|hacks?|splutters?|wheezes?)\b/],
  ['smoke', /\b(smokes?|cigarettes?|cigars?|lights? up|lights? a|drags? on|takes? a drag|vapes?|blows? smoke|ashes)\b/],
  ['polish', /\b(polish(es)?|buffs?)\b/],
  ['drink', new RegExp(`\\b(drinks?|sips?|swigs?|gulps?|takes? a pull|knocks? back|nurses? ${P}|downs ${P})\\b`)],
  ['eat', /\b(eats?|chews?|bites? into|munch(es)?|nibbles?|wolfs?|takes? a bite)\b/],
  ['wipe', /\b(wipes?|scrubs?|mops?|dusts?|cleans?)\b/],
  ['wash', /\b(rinses?|wash(es)?|runs? the tap|fills? a glass)\b/],
  ['stir', /\b(stirs?|fries|cooks?|chops?|seasons?|flips? the)\b/],
  ['rummage', /\b(rummages?|roots? (around|through)|digs? (around|through)|goes through|looks? (in|through|for)|searches|opens the|takes .+ out of|feels? around)\b/],
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
  ['wave', /\bwaves?\b/],
  ['fold', new RegExp(`\\b(folds? ${P} arms|arms folded|cross(es)? ${P} arms)\\b`)],
  ['wait', new RegExp(`\\b(leans? (against|back)|waits?|drums? ${P} fingers|taps? ${P} fingers|stares? at nothing)\\b`)],
  ['lean', /\b(leans? (on|over|across|forward))\b/],
  ['nod', /\bnods?\b/],
  ['look', /\b(looks? (around|about|up|out|down|over)|glances? (around|about|over|up|at the door)|peers?|keeps? an eye|watches the)\b/],
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
