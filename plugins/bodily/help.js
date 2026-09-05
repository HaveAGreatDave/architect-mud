// The `help bodily` guide.
//
// Written because the plugin shipped five verbs and a mechanic that can cost a
// player their dignity, with no way to find out any of it existed in-game. The
// risk numbers are DERIVED from the live constants so this page can't drift from
// what the code actually does.
import { registerHelpTopic } from '../../server/engine/help.js';
import { fartRisk } from './index.js';

const cat = (label, body) => `\n<span class="help-category">${label}</span>\n${body}`;
const dim = s => `<span class="text-dim">${s}</span>`;

function build() {
  // Find the pressure the gamble actually starts at rather than hardcoding it.
  let floor = 0;
  for (let p = 0; p <= 1.0001; p += 0.01) { if (fartRisk(p) > 0) { floor = p; break; } }
  const worst = Math.round(fartRisk(1) * 100);

  return [
    dim('Everything your body does whether or not you were planning on it.'),

    cat('THE VERBS', [
      `  pee ${dim('/ piss / urinate')}       ${dim("needs a toilet, or somewhere you're willing to use")}`,
      `  poop ${dim('/ shit / defecate')}     ${dim("takes a while, and you aren't going anywhere during it")}`,
      `  fart                     ${dim('deliberately. See below')}`,
      `  flush                    ${dim('be a decent person')}`,
      `  shower                   ${dim('removes every stain, every fluid, and the blood')}`,
      dim('  You can relieve yourself on the ground, on furniture, or on a person. All three are'),
      dim('  witnessed, and public elimination is an offence somebody may care about.'),
    ].join('\n')),

    cat('PRESSURE', [
      dim("  Eating and drinking fill two meters you can't see. They never go down on their own —"),
      dim("  waiting doesn't help, and the only way down is a toilet."),
      dim('  Your body will start telling you well before it matters. Listen to it.'),
      dim('  Ignore it long enough and the decision gets taken away from you, in public.'),
    ].join('\n')),

    cat('FARTING', [
      dim('  Scales with how badly you need the other thing: barely anything there and you get a'),
      dim('  thin squeak, genuinely full and the room learns something about you. No two are'),
      dim('  quite the same.'),
      dim(`  Once every five minutes. It relieves NOTHING — you still need the toilet.`),
      `  ${dim(`Past about ${Math.round(floor * 100)}% full it stops being free: you're relying on a muscle that`)}`,
      `  ${dim(`is already struggling, and at its worst it fails roughly ${worst}% of the time.`)}`,
      dim("  If you get away with it, you'll be told you nearly did not. That's your warning."),
    ].join('\n')),

    cat('AFTERWARDS', [
      dim("  Stains go on your clothes, or on the floor if you weren't wearing any. They stay"),
      dim('  there. People can see them, and a room can be smelled long after the fact.'),
      `  ${dim('shower')}                   ${dim('the only complete fix')}`,
    ].join('\n')),
  ].join('\n');
}

registerHelpTopic({
  name: 'bodily',
  summary: 'Pissing, shitting, farting, and the consequences of putting them off.',
  aliases: ['pee', 'poop', 'fart', 'toilet', 'shower'],
  build,
});
