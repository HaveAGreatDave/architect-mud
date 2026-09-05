// The `help cooking` guide.
//
// Written beside the mechanics rather than in a doc, and DERIVED from the live
// catalogs wherever a number or a list would otherwise go stale: the recipe
// count, the vessel kinds, the doneness levels and the handling verbs are all
// read from the same tables the cook path uses. Add a dish or a doneness level
// and this page updates itself.
import { registerHelpTopic } from '../../server/engine/help.js';
import { PROFILES, donenessLevels, HANDLING_VERB } from './profiles.js';
import { DISHES, VESSEL_KINDS } from './dishes.js';
import { DISCOVERY_ATTEMPTS, DISCOVERY_MIN_BAND } from './config.js';

const cat = (label, body) => `\n<span class="help-category">${label}</span>\n${body}`;
const dim = s => `<span class="text-dim">${s}</span>`;

function build() {
  const label = k => PROFILES[k].label;
  const profiles = Object.keys(PROFILES).filter(p => !PROFILES[p].modifier);
  const modifiers = Object.keys(PROFILES).filter(p => PROFILES[p].modifier);
  const meatLevels = donenessLevels(PROFILES.dense_meat).map(l => l.name);
  const withDoneness = Object.keys(PROFILES).filter(p => donenessLevels(PROFILES[p]));
  const stirs = Object.keys(HANDLING_VERB).filter(k => HANDLING_VERB[k] === 'stir');

  return [
    dim('Food you can just eat, food that needs heat, and food that becomes something else.'),

    cat('THE BASICS', [
      `  cook <food>              ${dim('put it on a stove in the room')}`,
      `  cook <food> in <device>  ${dim('when the room has more than one — a range and a microwave cook differently')}`,
      `  plate <food>             ${dim('take it off — this is when quality is decided')}`,
      `  examine <food>           ${dim('how it looks right now. Free, and the only clock you get')}`,
      `  mise                     ${dim('also: prep — the whole board: every ingredient, which pan, how far along')}`,
      dim('  Leave it on the heat and it burns. Walking away is a choice with a result.'),
    ].join('\n')),

    cat('VESSELS', [
      `  add <food> in <vessel>   ${dim('also: put, stow, mix — "mix mustard into bowl" works')}`,
      `  cook <vessel>            ${dim('the vessel and everything in it goes on the heat')}`,
      `  plate <vessel>           ${dim('resolves the whole thing into ONE dish')}`,
      dim(`  Kinds: ${VESSEL_KINDS.join(', ')} — a stew needs a pot, a sear needs a pan, a roast a tray.`),
      dim('  Heavy cast iron holds heat and widens your window. Cooking bare on the stove works, badly.'),
    ].join('\n')),

    cat('HANDLING', [
      `  flip <food>              ${dim('needs tongs or a spatula in hand')}`,
      `  stir <food>              ${dim(`needs a ladle, spoon or whisk — for ${stirs.map(label).join(', ')}`)}`,
      dim('  Each food wants a set number of turns, spaced evenly. Some want none at all, and'),
      dim('  poking those makes them worse. Use the wrong verb and it points you at the right one.'),
    ].join('\n')),

    cat('HEAT', [
      `  stove <low|mid|high>     ${dim("sets the burner. A stove's tier is its CEILING, not its only setting")}`,
      dim('  Some foods want one steady heat. Meat and liquids want a curve — hard at the start,'),
      dim('  then backed off. Following the curve beats any flat setting.'),
      dim('  With several things in the pan, cook for the WEAKEST one, not the best one.'),
    ].join('\n')),

    cat('THE MICROWAVE', [
      dim('  Its own appliance, not a fast hob. It heats water, so it browns NOTHING — no crust,'),
      dim("  no sear, nothing left in the pan. There's a hard ceiling on anything that comes out"),
      dim('  of one, and no skill, prep or seasoning lifts it.'),
      dim("  In exchange it's the fastest thing in the kitchen, unbeatable at defrosting, and"),
      dim("  almost impossible to ruin food in. You also can't flip or stir — the door is shut."),
      dim('  Right for leftovers, thawing, and being in a hurry. Wrong for anything else.'),
    ].join('\n')),

    cat('DONENESS', [
      `  doneness <food> <target> ${dim('say how you want it, any time before your window opens')}`,
      dim(`  ${meatLevels.join(' · ')}`),
      dim(`  Only some foods offer a choice (${withDoneness.map(label).join(', ')}). The rest are done or they aren't.`),
      dim('  The rare end tastes no better and carries a real chance of making you ill.'),
      dim('  What gets recorded is what you MADE, not what you asked for.'),
    ].join('\n')),

    cat('PREP — BEFORE THE HEAT', [
      `  chop <food> [into N]     ${dim('cut it smaller: cooks proportionally faster, feeds you proportionally less')}`,
      `  mince <meat>             ${dim('a third of the cook time, two rungs off the top — forever')}`,
      `  score <meat>             ${dim('wider window, but it dries out faster once you pass it')}`,
      `  tenderise <meat>         ${dim('faster and far more forgiving, at one rung off the top')}`,
      `  marinate <meat> in <x>   ${dim('the biggest gain before heat. Costs the marinade, and real time')}`,
      `  butter <bread>           ${dim('counts as the fat AND improves it')}`,
      dim('  Every one of these is a TRADE. None is a button you always press, and none of them'),
      dim('  survives the cook — prep is spent by the meal it was done for.'),
    ].join('\n')),

    cat('TASTING', [
      `  taste <food|vessel>      ${dim("the only reading that isn't visual")}`,
      dim('  Everything else is something you can SEE. Tasting reaches seasoning, and whether the'),
      dim('  thing is any good. What it TELLS you scales with your Cooking skill — a novice learns'),
      dim("  one vague thing, an expert learns what's wrong and by how much."),
      dim("  Every taste is a mouthful you don't get back. Ten of them costs you a meal."),
    ].join('\n')),

    cat('THE PAN REMEMBERS', [
      `  deglaze <vessel>         ${dim('lift what a sear left behind — worth more than any seasoning')}`,
      `  scour <vessel>           ${dim('clean off residue you left too long')}`,
      dim('  A good sear leaves fond in a pan. Lift it into the next dish and it pays; leave it and'),
      dim('  it scorches; leave it long enough and it dries on, and a dirty pan is worse than a'),
      dim('  clean one until you scour it. Liquid lifts some of it whether you meant it to or not.'),
    ].join('\n')),

    cat('SANDWICHES', [
      `  add <food> in <bread>    ${dim('bread is a vessel — you build in it')}`,
      `  plate <bread>            ${dim('makes the sandwich, and eats the bread')}`,
      `  cut <dish> [into N]      ${dim('halve a finished meal, cooked or not')}`,
      dim('  Bread never makes a mess. Anything sensible between two slices is a real sandwich,'),
      dim('  named after what went in it, with no recipe needed and none learned by making it.'),
    ].join('\n')),

    cat('STAGING', [
      dim('  Heavy things cook slower than light ones. Put everything in at once and there may be'),
      dim("  no moment when all of it's good. Start the slow thing first, then:"),
      `  add <food> in <vessel>   ${dim('then')}  cook <vessel>   ${dim('again — it joins the same burner')}`,
    ].join('\n')),

    cat('SEASONING', [
      dim(`  ${modifiers.map(label).join(' and ')} season a dish instead of cooking in it. They never burn,`),
      dim("  and they're never handled. Each dish has an amount it wants: too little is bland,"),
      dim('  too much is worse than too little.'),
    ].join('\n')),

    cat('RECIPES', [
      dim(`  ${Object.keys(DISHES).length} dishes exist. A recipe asks for KINDS of ingredient, never a specific one —`),
      dim(`  any of the ${profiles.length} kinds will do, so beef and rat make the same roast under different names.`),
      dim(`  Cook a combination at ${DISCOVERY_MIN_BAND} or better ${DISCOVERY_ATTEMPTS} times and it goes in your cookbook.`),
      dim('  Recipe cards and a few people can teach you one outright. Knowing one never gates'),
      dim("  cooking it — it's worth a small edge and a line in the book."),
      `  tablet ${dim('→ Cookbook')}       ${dim('what you know, and how many you don\'t')}`,
    ].join('\n')),

    cat('IF IT GOES WRONG', [
      dim('  A combination no recipe claims still feeds you, and no more than that.'),
      dim('  Nothing is forbidden. The bad combinations are how you learn where the edges are.'),
    ].join('\n')),
  ].join('\n');
}

registerHelpTopic({
  name: 'cooking',
  summary: 'Stoves, vessels, timing, doneness and the cookbook.',
  aliases: ['cook', 'food', 'recipes'],
  build,
});
