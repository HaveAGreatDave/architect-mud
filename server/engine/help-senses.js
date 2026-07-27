// The `help senses` guide.
//
// Derived from the live tables wherever a number would otherwise go stale — the
// sense list, the baseline band and the attunement ladder all read from
// senses.js, so retuning the stat thresholds updates this page with them.
import { registerHelpTopic } from './help.js';
import { SENSES, BASE_FLOOR, BASE_LIMIT, perceptionBand, overloadThreshold, EXTREME } from './senses.js';

const cat = (label, body) => `\n<span class="help-category">${label}</span>\n${body}`;
const dim = s => `<span class="text-dim">${s}</span>`;

function build() {
  const sharp = perceptionBand(3);
  return [
    dim('What you notice, what you miss, and what it costs to notice more than other people.'),

    cat('THE VERBS', [
      `  smell                    ${dim("what is in this room that you cannot see")}`,
      `  listen                   ${dim('what is happening somewhere else — through walls, around corners')}`,
      `  look                     ${dim('sight has no verb of its own. Keen eyes simply see where others cannot')}`,
      dim('  Smell does not care about light or line of sight. Hearing reaches past the room.'),
      dim('  Neither of them cares whether the thing belongs to you.'),
    ].join('\n')),

    cat('BEING ORDINARY', [
      dim(`  A normal person notices obvious things and holds about ${BASE_LIMIT} of them at once.`),
      dim('  One quiet person standing in a dark room is below that. So is a cook that has only'),
      dim('  just started. Those things are happening either way — you are simply not equipped.'),
    ].join('\n')),

    cat('BEING NOT ORDINARY', [
      `  attune <${SENSES.join('|')}>   ${dim('which sense is yours')}`,
      dim('  Raise the SENSES stat and one sense becomes genuinely better than a human\'s. It is'),
      dim('  paid for the ordinary way: those points did not go into brawn.'),
      dim('  At 3 it sharpens. At 6 a second sense creeps up behind it. At 9 the first one is'),
      dim('  uncanny, and at 12 it is not really a human sense any more.'),
      dim('  You are never superb at two. Choosing is the whole mechanic, and changing your mind'),
      dim('  afterwards is surgery — find a clinic.'),
      dim(`  Sharp enough (${sharp.limit} things at once, and nothing is too faint) you can find people`),
      dim('  in the dark, hear a fight two rooms away, or see well enough in a black room to fight in it.'),
    ].join('\n')),

    cat('WHAT IT COSTS', [
      dim('  A sharp sense cannot look away. Walk a keen nose into something foul and it saturates:'),
      dim('  for a while afterwards you perceive LESS than an ordinary person would have.'),
      dim(`  The sharper you are the less it takes — an ordinary person only goes down to the very`),
      dim(`  worst things in the world (${EXTREME}+), and nobody at all is immune to those.`),
      dim('  Anyone who knows what you are can use it against you.'),
    ].join('\n')),

    cat('PROTECTION', [
      dim('  Gear that dulls a sense also shields it: a respirator, ear defenders, smoked lenses.'),
      dim('  They cut what you perceive and raise what it takes to overwhelm you by the same'),
      dim('  amount. Sealed up properly you can walk through the worst room in the city — and you'),
      dim('  will not notice a single thing in it.'),
      dim('  Plugs and foam take the edge off. Only a real seal gets you through the worst of it.'),
    ].join('\n')),
  ].join('\n');
}

registerHelpTopic({
  name: 'senses',
  summary: 'Smell, hearing, sight — and being better at one than everybody else.',
  aliases: ['smell', 'listen', 'attune', 'perception'],
  build,
});
