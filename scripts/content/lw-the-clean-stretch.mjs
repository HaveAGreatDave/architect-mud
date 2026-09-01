/**
 * What the Long Watch do about the people in the tunnels. 2026-08-25.
 *
 * ── The brief ────────────────────────────────────────────────────────────────
 *
 * A Long Watch encounter as deep as the Ascendant one, carrying their contempt
 * for mutants and their purity doctrine — which is in some ways MORE extreme,
 * because it takes in chrome as well — laid out matter-of-factly by somebody in
 * complete agreement with it. They are not to come out of it heroic.
 *
 * The parallel with Halcyon is never mentioned by anybody, ever.
 *
 * ── The difference, which is the whole point ─────────────────────────────────
 *
 * Halcyon's frame is ADMINISTRATIVE. A mutant cannot be priced, so a machine
 * files them under living property and a department closes the file.
 *
 * The Watch's frame is EARNED versus GIVEN, and it grows out of something a
 * player will already have found admirable. Their entire creed is that a person
 * masters themselves — ten thousand repetitions, no wire back to the machine,
 * out-shooting the chromed over plain iron. From inside that creed:
 *
 *   a man who bought his edge did not earn it
 *   a man the rain changed did not earn it either
 *
 * So mutation is not a misfortune to them. It is a FAILURE OF DISCIPLINE — a
 * body that went and did something without its owner's permission — and their
 * own ideology row already says it in those words: "flesh that has gone its own
 * way". To an order built on self-mastery that is the one unforgivable thing.
 *
 * That is uglier than Halcyon in a specific way worth preserving: Halcyon does
 * not blame you for what happened to you. Teague does.
 *
 * ── And the doctrine is stricter ─────────────────────────────────────────────
 *
 * Halcyon would fit a chromed man, warranty him and service him for forty years.
 * The Watch will not have him in the room. Their circle of the acceptable is the
 * smaller of the two, and Teague states that as a matter of pride.
 *
 * ── The problematic core ─────────────────────────────────────────────────────
 *
 * Not the four hundred she has shot. She is already on the page about those.
 *
 * It is the ones who are not feral. People living in the tunnels because there
 * is nowhere else, who have done nothing, and who are moved on because the Watch
 * need the stretch quiet. Where they go afterwards is nobody's business, and
 * nobody has ever asked — which is the same shape as Halcyon's second window and
 * is never once compared to it.
 *
 * ── The deflection curve, in her register ────────────────────────────────────
 *
 * Halcyon read silence as UNREADABLE and got suspicious. Teague reads it as
 * SOFT, and softness underground gets the person next to you killed. So the
 * pressure is entirely different in flavour and identical in shape.
 *
 * And her ejection is not two men with chrome arms. She simply stops talking to
 * you and walks off, and takes the only light with her. She warns you first,
 * plainly, because she is not cruel.
 *
 * Run: node scripts/content/lw-the-clean-stretch.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

const opt = (label, next, actions = []) => ({ label, next, conditions: [], actions, enabled: true });
const flag = (f, v) => ({ action: 'SET_FLAG', flag: f, scope: 'player', value: v });
const warmth = (w, why) => ({ action: 'RELATION_ADJUST', npc_id: 'npc_lw_teague', familiarity: 1, warmth: w, reason: why });
const rep = (n) => ({ action: 'ADJUST_REPUTATION', delta: n, ideology_id: 'ideology_long_watch', reason: 'the clean stretch' });
const end = { action: 'END_CONVERSATION' };

const p = path.join(ROOT, 'npcs/npc_lw_teague.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;

// ── the doctrine: earned against given ──────────────────────────────────────
t.earned = {
  _vine: { x: 900, y: 900 }, actions: [],
  text:
    '"Everything I can do down here, I can do because I did it ten thousand times in the dark and '
    + 'was bad at it for four years first."\n\n'
    + 'She says it without any pride in it, which is somehow worse.\n\n'
    + '"A man works nine years on a hot floor and comes out with something he did not have going '
    + 'in. He stood where he was put and it got into him."\n\n'
    + '"He did not do anything. It was done to him."',
  options: [
    opt('And somebody who bought theirs?', 'earned_bought'),
    opt('Some of them drink for it on purpose.', 'earned_chosen'),
    opt('That is not their fault.', 'earned_fault'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.earned_bought = {
  _vine: { x: 1160, y: 820 }, actions: [],
  text:
    '"Same thing with a receipt."\n\n'
    + 'She checks the tunnel behind you while she talks, and does not stop doing it.\n\n'
    + '"A chromed man can do what I can do and he did not do a day of the work. He went to a '
    + 'counter. There is nothing in him that he made."\n\n'
    + '"The Watch will not seat him and I would not want him at my back. Halcyon would fit him '
    + 'and warranty him. They are welcome to."',
  options: [
    opt('So a mutant and a chromed man are the same to you.', 'earned_same'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.earned_same = {
  _vine: { x: 1420, y: 820 }, actions: [],
  text:
    '"One paid and one did not. Neither of them owns what they have got."\n\n'
    + 'She looks at you properly for the first time in a while.\n\n'
    + '"We are the last people in this city who own our own bodies. Nothing bought, nothing put '
    + 'there by the ground."\n\n'
    + '"There are not many of us. There are fewer every year."',
  options: [
    opt('Then what do you do about the ones down here?', 'the_quiet_ones'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.earned_chosen = {
  _vine: { x: 1160, y: 660 }, actions: [],
  text:
    '"Out south. They queue for it."\n\n'
    + 'Her voice does not change, and it is the only subject tonight where she does not check the '
    + 'tunnel while she talks.\n\n'
    + '"The hot-floor man had it done to him. I have got no time for him and I have got nothing '
    + 'against him either. He was somewhere and it happened."\n\n'
    + '"The ones who drink for it stood in front of a flask, with a whole body already, and '
    + 'decided against it. That is not bad luck. That is a person looking at what they were and '
    + 'saying no thank you."',
  options: [
    opt('That is their business.', 'earned_chosen_business'),
    opt('That is not an argument.', 'earned_chosen_hard'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.earned_chosen_business = {
  _vine: { x: 1420, y: 520 }, actions: [],
  text:
    '"It is, right up until they come north."\n\n'
    + 'She starts moving again.\n\n'
    + '"And I will tell you the part that actually sticks. Every one of them had the thing I have '
    + 'got. A body nobody had been at. They could have kept it and they could have learned to use '
    + 'it, and it takes years and it is dull and it hurts."\n\n'
    + '"They found a shorter way. So no, I will not have one of them at a table with me, and I '
    + 'have never once been talked out of that and I have been talked at about it a great deal."',
  options: [opt('(say nothing)', 'bye')],
};

t.earned_chosen_hard = {
  _vine: { x: 1420, y: 660 }, actions: [],
  text:
    '"No, it is not."\n\n'
    + 'She lets that sit longer than she has let anything sit tonight.\n\n'
    + '"I have got eleven years down here and a rifle and a way of standing that has kept me '
    + 'alive, and if a swallow of something out of a flask makes all of that a hobby, then I have '
    + 'wasted my life and so has everybody I have buried."\n\n'
    + '"So it does not. That is where I have put it and I am not moving it."',
  options: [opt('(say nothing)', 'bye')],
};

t.earned_fault = {
  _vine: { x: 1160, y: 980 }, actions: [],
  text:
    '"No."\n\n'
    + 'She does not soften it and she does not look away.\n\n'
    + '"It is not his fault. It is also not something he did."\n\n'
    + '"Both of those are true, and neither of them makes him a man I owe anything to."',
  options: [
    opt('Then what do you do about the ones down here?', 'the_quiet_ones'),
    opt('(let her walk on)', 'bye'),
  ],
};

// ── the problematic core: the ones who are not a threat ─────────────────────
t.the_quiet_ones = {
  _vine: { x: 900, y: 1120 }, actions: [],
  text:
    '"Depends what they are."\n\n'
    + 'She stops walking, which she has not done since you met her.\n\n'
    + '"The ones that have gone all the way, I put down and I have told you the number. But most '
    + 'of what is down here is not that. Most of it is people. Families, some of them. They are '
    + 'down here because there is nowhere up there that will have them, and because the ground '
    + 'past the wall would give their children the same thing they have got."\n\n'
    + '"Those we move on."',
  options: [
    opt('Move them on where?', 'the_quiet_ones_where'),
    opt('They are not doing anything to you.', 'the_quiet_ones_harm'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_quiet_ones_where = {
  _vine: { x: 1160, y: 1120 }, actions: [],
  text:
    '"Out of the stretch."\n\n'
    + 'It is a complete answer as far as she is concerned, and she starts walking again.\n\n'
    + '"East, mostly. There is a lot of tunnel east."',
  options: [
    opt('And after that?', 'the_quiet_ones_after'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_quiet_ones_after = {
  _vine: { x: 1420, y: 1120 }, actions: [],
  text:
    '"After that they are east."\n\n'
    + 'She says it the way she would give you a direction, and then, because you are still '
    + 'standing there, she gives you the rest of it.\n\n'
    + '"The system runs a long way. Past our stretch, past the Blind, and it keeps going under the '
    + 'Curtain, because the Curtain is a surface problem and nobody ever built it downward."\n\n'
    + '"Four miles or so beyond that, and then it lets out into the bay."',
  options: [
    opt('You have walked it?', 'the_quiet_ones_map'),
    opt('So they walk east until they run out of tunnel.', 'the_quiet_ones_bay'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_quiet_ones_map = {
  _vine: { x: 1680, y: 1000 }, actions: [],
  text:
    '"Some of it."\n\n'
    + 'She taps the pocket the map lives in without taking it out.\n\n'
    + '"Ours stops about a mile past the last door we use. After that it is other people\'s '
    + 'drawings and most of those disagree with each other."\n\n'
    + '"I have been as far as the sump under Meltwater. It gets colder and it gets wider and the '
    + 'water is going the same way you are."',
  options: [
    opt('So they walk east until they run out of tunnel.', 'the_quiet_ones_bay'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_quiet_ones_bay = {
  _vine: { x: 1680, y: 1160 }, actions: [],
  text:
    '"Some of them stop before that. There are dry stretches."\n\n'
    + 'She does not pretend the sentence is stronger than it is, and she does not add anything to '
    + 'it.\n\n'
    + '"I have been doing this eleven years and nobody has ever asked me where east goes. Not '
    + 'once, and I have walked a lot of people through here."',
  options: [
    opt('Nobody has ever asked because nobody wants the answer.', 'stance_object'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_quiet_ones_harm = {
  _vine: { x: 1160, y: 1280 }, actions: [],
  text:
    '"They are not, no."\n\n'
    + 'She agrees with it flatly and it costs her nothing.\n\n'
    + '"And in a month there are forty of them and a fire and a smell of cooking, and somebody up '
    + 'top notices that a dead stretch of drain has got a chimney, and then Halcyon come down here '
    + 'with lights and dogs and they find our door instead."\n\n'
    + '"So they go east. Cold, and inconvenienced, and alive, and none of that is nothing."',
  options: [
    opt('That is the argument for anything.', 'stance_object'),
    opt('It is the sensible call.', 'stance_approve',
      [flag('lw_purity_stance', 'approved'), warmth(1, 'teague:agreed'), rep(40)]),
    opt('(say nothing)', 'stance_quiet', [flag('lw_purity_stance', 'quiet')]),
  ],
};

// ── stances ─────────────────────────────────────────────────────────────────
t.stance_approve = {
  _vine: { x: 1680, y: 1280 }, actions: [],
  text:
    'She grunts. It is the closest thing to warmth she has produced all night.\n\n'
    + '"It is. And I have not met four people who will say so down here, and two of them are '
    + 'dead."\n\n'
    + 'She unhooks the lantern off her belt and hands it to you, still unlit.\n\n'
    + '"You will not need it. Carry it anyway. If it is in your hand you will not reach for a '
    + 'light when something moves, and reaching for a light is how the last one went."',
  options: [opt('(take it)', 'bye')],
};

t.stance_object = {
  _vine: { x: 1680, y: 1440 }, actions: [flag('lw_purity_stance', 'objected')],
  text:
    '"It might be."\n\n'
    + 'She does not argue and she does not get angry, and that is the whole difficulty with '
    + 'her.\n\n'
    + '"I have got a tunnel and a rifle and eleven years. You have got a better argument than I '
    + 'have and it does not reach down here."\n\n'
    + '"Bring it back when you have walked this stretch a hundred times and I will listen to it '
    + 'properly. That is not me being clever. That is the actual offer."',
  options: [
    opt('You could just let them stay.', 'teague_press'),
    opt('(leave it)', 'bye'),
  ],
};

t.stance_quiet = {
  _vine: { x: 1680, y: 1600 }, actions: [],
  text:
    'She waits three seconds for you to say something, and you do not.\n\n'
    + '"Right."\n\n'
    + 'She starts walking, and the distance she leaves between you is a little wider than it was '
    + 'coming in.\n\n'
    + '"Down here I need to know what a person does before they do it. You have just told me you '
    + 'are somebody I would have to guess about."',
  options: [
    opt('I have not made my mind up.', 'stance_quiet_undecided'),
    opt('(walk on)', 'bye', [flag('lw_watched', '1'), warmth(-1, 'teague:unreadable')]),
    opt('(say nothing, and let her walk)', 'bye'),
  ],
};

t.stance_quiet_undecided = {
  _vine: { x: 1940, y: 1600 }, actions: [],
  text:
    '"Make it up on the surface."\n\n'
    + 'She checks the tunnel behind you again.\n\n'
    + '"I am not asking you to agree with me. I am asking whether you would stand there while I '
    + 'did it. Those are different questions and only the second one is any of my business."',
  options: [
    opt('I would stand there.', 'stance_recover',
      [flag('lw_purity_stance', 'approved'), flag('lw_watched', ''), warmth(2, 'teague:answered'), rep(40)]),
    opt('No.', 'stance_object'),
    opt('(say nothing)', 'bye', [flag('lw_watched', '1')]),
  ],
};

t.stance_recover = {
  _vine: { x: 2200, y: 1600 }, actions: [],
  text:
    'It is easier to say than you expected, and she takes it at face value, which is worse.\n\n'
    + '"Good. That is all I needed."\n\n'
    + 'She adjusts the sling and carries on up the tunnel.\n\n'
    + '"Come down on a Thursday. I will show you the stretch properly and you will see why it is '
    + 'worth keeping."',
  options: [opt('(say nothing)', 'bye')],
};

// ── the escalation, and her version of a door ───────────────────────────────
t.teague_press = {
  _vine: { x: 1940, y: 1440 }, actions: [],
  text:
    '"I could."\n\n'
    + 'She stops again. The second time tonight.\n\n'
    + '"And the first winter one of them lights a fire, and the second winter there are forty of '
    + 'them, and the third winter I am standing in the Blind watching Halcyon walk down that '
    + 'tunnel with dogs, and everybody I have ever eaten with is in a van."\n\n'
    + '"I have run it. I run it most nights."',
  options: [
    opt('You have decided they are worth less than you.', 'teague_warning'),
    opt('(leave it)', 'bye'),
  ],
};

// THE WARNING: she is about to stop talking, and she says so.
t.teague_warning = {
  _vine: { x: 2200, y: 1440 }, actions: [],
  text:
    'The lantern stops swinging.\n\n'
    + 'She has kept her body angled to the tunnel the whole time you have been talking, watching '
    + 'past you, and now she turns and looks straight at you instead, which is the first careless '
    + 'thing she has done.\n\n'
    + '"I have. Out loud, to your face, and I am not going to take it back to make this easier."\n\n'
    + '"Now I am going to say the next part once. I am going up this tunnel in a minute. You can '
    + 'come, or you can keep going at me and I will go on my own, and you will be down here '
    + 'without a light and without me."',
  options: [
    opt('(walk with her)', 'teague_backdown'),
    opt('Say it again. Out loud. All of it.', 'teague_left',
      [flag('lw_left_in_dark', '1'), warmth(-2, 'teague:left')]),
  ],
};

t.teague_backdown = {
  _vine: { x: 2460, y: 1360 }, actions: [],
  text:
    'She turns back to the tunnel and the shape of her goes easy again.\n\n'
    + '"Right."\n\n'
    + 'You walk. She does not bring it up again and she does not sulk about it, and about ten '
    + 'minutes later she points out a grating you would have walked into.\n\n'
    + '"Mind that. It comes up on you."',
  options: [opt('(keep walking)', 'bye')],
};

t.teague_left = {
  _vine: { x: 2460, y: 1520 }, actions: [end],
  text:
    '"No."\n\n'
    + 'She says it without heat, and then she is walking, and she does not look back or say '
    + 'goodnight or tell you which way is out.\n\n'
    + 'The lantern on her belt is still unlit. She has not needed it once all night and she does '
    + 'not need it now, and the dark takes her a great deal faster than it should.\n\n'
    + 'Somewhere east of you water is moving. It takes about a minute for the sound of her boots '
    + 'to go, and then you are standing in a tunnel you do not know, and the last thing she gave '
    + 'you was the truth.',
  options: [],
};

// ── hooks from her root ─────────────────────────────────────────────────────
const rootOpts = (t.root.options ||= []);
for (const o of [
  opt('How do you decide what is worth putting down?', 'earned'),
  opt('Who else is living down here?', 'the_quiet_ones'),
]) if (!rootOpts.some(e => e.label === o.label)) rootOpts.splice(1, 0, o);

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { console.log('DANGLING ' + k + ' -> ' + o.next); bad++; }
log.push('Teague   earned vs given · chrome is the same rule with a receipt · the ones moved east');
log.push('Teague   stances + suspicion of softness + she leaves you in the dark');
console.log(log.map(l => '  ' + l).join('\n'));
console.log('  nodes ' + Object.keys(t).length + ' · dangling ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
