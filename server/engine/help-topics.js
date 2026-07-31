/**
 * Cross-cutting player guides for `help <topic>`.
 *
 * These live in the engine because each one spans several plugins — "hacking"
 * is an ATM, a door and a security console; "money" is commerce, banking, work
 * and trade. A guide that belongs to ONE system belongs beside that system
 * instead (see plugins/cooking/help.js), so it can derive itself from that
 * system's own catalogs and can't drift.
 *
 * Every verb named here is registered by a plugin manifest or an engine command
 * map. If a verb moves, this file is wrong — and `tests/regress.js` sweeps the
 * topics against the live registries to say so.
 */
import { registerHelpTopic } from './help.js';

const cat = (label, body) => `\n<span class="help-category">${label}</span>\n${body}`;
const dim = s => `<span class="text-dim">${s}</span>`;
const line = (cmd, note) => `  ${cmd.padEnd(26)}${dim(note)}`;

// Verbs each topic claims, swept by regress against what's actually registered.
export const TOPIC_VERBS = {
  hacking: ['jack', 'hack', 'hijack', 'scrub', 'conceal', 'sweep', 'plant', 'retrieve'],
  gambling: ['spin', 'slots', 'wager', 'takewager', 'cancelwager', 'join', 'bet', 'raise', 'fold', 'allin', 'standings'],
  crime: ['wanted', 'bribe', 'submit', 'conceal', 'sentence', 'time', 'steal', 'pick'],
  foraging: ['scavenge', 'fish', 'mine', 'butcher'],
  survival: ['eat', 'drink', 'sleep', 'stats', 'skills', 'raise', 'habits'],
  money: ['shop', 'buy', 'sell', 'balance', 'deposit', 'withdraw', 'pay', 'trade', 'gigs', 'work', 'shift', 'craft', 'recipes'],
};

registerHelpTopic({
  name: 'hacking',
  summary: 'Cash machines, locked doors, cameras and your own record.',
  aliases: ['hack'],
  build: () => [
    dim('Nothing here is a puzzle you solve once. Every attempt can be seen, and being seen is the real cost.'),
    cat('MACHINES', [
      line('jack', 'break into a cash machine you are standing at'),
      line('hack <door>', 'work a lock you have no key for'),
      dim('  Both are skill checks against the thing you are working on, not a fixed difficulty.'),
      dim('  Failure is rarely quiet.'),
    ].join('\n')),
    cat('SURVEILLANCE', [
      line('plant <device>', 'leave a camera or a bug somewhere useful'),
      line('retrieve <device>', 'take it back, with what it recorded'),
      line('sweep', 'find what somebody else planted here'),
      line('hijack <camera>', 'take over a camera that is not yours'),
      dim('  Your own devices feed a hub you can review later. So do everyone else\'s.'),
    ].join('\n')),
    cat('YOUR RECORD', [
      line('wanted', 'what the police think you have done'),
      line('scrub', 'at a police terminal — make some of it go away'),
      line('conceal <item>', 'hide something before you are searched'),
      dim('  Crimes are witnessed, not detected. Nobody watching means nobody charged.'),
    ].join('\n')),
    cat('SEE ALSO', dim('  help crime')),
  ].join('\n'),
});

registerHelpTopic({
  name: 'gambling',
  summary: 'Slots, poker tables and betting on the baseball.',
  aliases: ['betting', 'bet', 'casino', 'poker'],
  build: () => [
    dim('Three different ways to lose money, and one of them involves other people.'),
    cat('SLOTS', [
      line('spin [bet]', 'at a machine. Fast, thoughtless, and the house is the house'),
      line('slots', 'what the machine pays and for what'),
    ].join('\n')),
    cat('POKER', [
      line('join / seat', 'sit down at a table'),
      line('check  call  bet <n>', 'the usual'),
      line('raise <n>  fold  allin', ''),
      line('board  pot  players', 'what is on the table, and who is still in it'),
      line('spectate / watch', 'sit out and see how it goes for everyone else'),
      line('text / visual', 'switch how the table is drawn — your choice, per player'),
      dim('  Real people, real credits. The table does not care that you are new.'),
    ].join('\n')),
    cat('THE BALL GAME', [
      line('standings', 'who is winning the league'),
      line('wager <player> <amt> <team>', 'offer a bet to another player on a live game'),
      line('takewager / cancelwager', 'accept one, or withdraw yours'),
      dim('  Bets are player-to-player. There is no bookmaker to blame.'),
    ].join('\n')),
  ].join('\n'),
});

registerHelpTopic({
  name: 'crime',
  summary: 'Being seen, being wanted, being caught, and getting out.',
  aliases: ['police', 'wanted', 'jail'],
  build: () => [
    dim('You are not wanted for what you did. You are wanted for what somebody saw you do.'),
    cat('HEAT', [
      line('wanted', 'your current standing with the police'),
      line('bribe <officer>', 'if you have the credits and they have the inclination'),
      line('scrub', 'at a police terminal — edit the record itself'),
      dim('  Witnesses include cameras. Sweep for them first, or work somewhere nobody looks.'),
    ].join('\n')),
    cat('WORK', [
      line('steal <player>', 'lift something from someone in the room'),
      line('pick <lock>', 'get through a door the slow honest-thief way'),
      line('conceal <item>', 'so a search does not find it'),
    ].join('\n')),
    cat('GETTING CAUGHT', [
      line('sentence / time', 'how long you have left'),
      dim('  Go down while wanted and you wake up in holding, without your gear.'),
      dim('  Your things are in an evidence locker. The cell door is a door like any other.'),
    ].join('\n')),
    cat('SEE ALSO', dim('  help hacking')),
  ].join('\n'),
});

registerHelpTopic({
  name: 'foraging',
  summary: 'Getting food and materials out of the world for free.',
  aliases: ['scavenging', 'fishing', 'mining'],
  build: () => [
    dim('Everything here is posture-based: you start, you keep going, and you stop when something interrupts you.'),
    cat('THE VERBS', [
      line('scavenge', 'junk, almost anywhere. No tool needed'),
      line('fish', 'at water. Needs a rod'),
      line('mine', 'at a deposit. Needs a pick or a drill'),
      line('butcher <corpse>', 'meat off something you killed. Needs a blade'),
    ].join('\n')),
    cat('HOW IT GOES', [
      dim('  Each place has its own table of what can be found and how likely it is.'),
      dim('  Moving, fighting, or being attacked ends it. Standing still is the whole skill.'),
      dim('  Butchered meat remembers what it came off, and cooks under that name.'),
    ].join('\n')),
    cat('SEE ALSO', dim('  help cooking')),
  ].join('\n'),
});

registerHelpTopic({
  name: 'survival',
  summary: 'Hunger, thirst, temperature, sleep and the things that wear you down.',
  aliases: ['hunger', 'health'],
  build: () => [
    dim('The city does not need to kill you. It only has to wait.'),
    cat('THE BASICS', [
      line('eat <food>  drink <thing>', 'the two that never stop mattering'),
      line('sleep', 'somewhere you are allowed to. Restores more than hit points'),
      line('stats', 'everything the body is currently doing to you'),
    ].join('\n')),
    cat('WHAT WEARS YOU DOWN', [
      dim('  Hunger and thirst fall on their own. Cold and heat depend on what you are wearing'),
      dim('  and where you are standing. Radiation accumulates and does not leave on its own.'),
      dim('  Raw food, spoiled food and food you deliberately undercooked will each make you ill.'),
    ].join('\n')),
    cat('GETTING BETTER', [
      line('skills / raise <stat>', 'spend what you have earned'),
      line('habits', 'what you have been taking, and what it is costing'),
      dim('  Well-cooked food restores more than the same food cooked badly. Considerably more.'),
    ].join('\n')),
    cat('SEE ALSO', dim('  help cooking  |  help foraging')),
  ].join('\n'),
});

registerHelpTopic({
  name: 'money',
  summary: 'Earning it, banking it, spending it and moving it between people.',
  aliases: ['credits', 'work', 'jobs', 'economy'],
  build: () => [
    dim('Credits are the only thing in this city that everyone agrees on.'),
    cat('EARNING', [
      line('gigs / postings', 'legal day work off a job board'),
      line('work / shift', 'a steady job, if you have one'),
      line('courier / runs', 'move a parcel across town for somebody'),
      line('quests', 'what people have asked you to do'),
    ].join('\n')),
    cat('SPENDING', [
      line('shop <npc>  browse', 'see what a vendor has'),
      line('buy <item>  sell <item>', ''),
      line('checkout', 'settle up for anything you picked off a shop shelf'),
    ].join('\n')),
    cat('BANKING', [
      line('balance', 'at an ATM'),
      line('deposit <amt|all>', 'carried credits can be stolen. Banked ones cannot'),
      line('withdraw <amt|all>', ''),
    ].join('\n')),
    cat('BETWEEN PEOPLE', [
      line('pay <player> <amount>', 'hand over credits directly'),
      line('trade <player>', 'open a two-sided window nobody can cheat'),
    ].join('\n')),
    cat('MAKING THINGS', [
      line('recipes / craft <recipe>', 'the general workbench'),
      dim('  Food is its own system — see help cooking.'),
    ].join('\n')),
  ].join('\n'),
});
