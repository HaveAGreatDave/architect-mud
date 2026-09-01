/**
 * Teague on the flask. 2026-08-25.
 *
 * ── The brief ────────────────────────────────────────────────────────────────
 *
 * She talks about mutagen use directly. The disgust is explicit, the framing is
 * that a body is sacred, what comes out of the Pool is diseased flesh, it can be
 * purified, and until it is it stays out of the city and out of the Under.
 *
 * She is in complete agreement with all of it and states it as ordinary policy.
 *
 * ── Where the vocabulary comes from ──────────────────────────────────────────
 *
 * Not invented. Their own ideology row already ends: "Come back cleansed, or do
 * not come back." Cleansing is a real thing in this world — the Exodus keep a
 * Purifier that strips mutation out of somebody — so the Watch position is not
 * a wall, it is a door with a price on it, and Teague believes that makes it
 * fair. It is the part she is proudest of and the part that should sit worst.
 *
 * ── The sacred, without a religion ───────────────────────────────────────────
 *
 * The Watch are not devout. Their version of sacred is materialist and comes out
 * of everything else they believe: in a city where the Architect reads every
 * wire and Halcyon owns the chrome in your arm, the body is the last object
 * nobody else has been inside. That is why defacing it is not a lifestyle choice
 * to her, it is desecration, and she does not need a god to get there.
 *
 * ── The line that has to stay ────────────────────────────────────────────────
 *
 * ⚠ She never proposes killing them for it. The four hundred she has shot were
 * feral; mutagen users are people she will not seat, will not house, and will
 * not have in her tunnels. Segregation, stated with pride, is the whole of it.
 * If she starts advocating extermination she becomes a monster and the player
 * stops having to think about her.
 *
 * ⚠ And nobody ever compares this to Halcyon. Ever.
 *
 * Run: node scripts/content/lw-the-flask.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next, actions = []) => ({ label, next, conditions: [], actions, enabled: true });
const flag = (f, v) => ({ action: 'SET_FLAG', flag: f, scope: 'player', value: v });
const warmth = (w, why) => ({ action: 'RELATION_ADJUST', npc_id: 'npc_lw_teague', familiarity: 1, warmth: w, reason: why });
const rep = (n) => ({ action: 'ADJUST_REPUTATION', delta: n, ideology_id: 'ideology_long_watch', reason: 'the flask' });

const p = path.join(ROOT, 'npcs/npc_lw_teague.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;

// ── she has watched it happen ───────────────────────────────────────────────
t.the_flask = {
  _vine: { x: 900, y: 400 }, actions: [],
  text:
    '"I have watched it done."\n\n'
    + 'She says it the way she names any other job she has been on.\n\n'
    + '"A man at the Pool with his sleeves up and his arms out, and somebody tips a flask into '
    + 'him, and everybody there is pleased for him. Fortnight later there is something walking '
    + 'about wearing his face and his voice and getting on with its day."\n\n'
    + 'Her mouth does the thing a mouth does around a bad smell, and she puts it away again '
    + 'immediately, because she does not think it is a respectable way to argue.',
  options: [
    opt('It is his body.', 'the_flask_sacred'),
    opt('He is still the same man.', 'the_flask_diseased'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.the_flask_sacred = {
  _vine: { x: 1160, y: 320 }, actions: [],
  text:
    '"It was. That is my whole point and you have said it for me."\n\n'
    + 'She stops, and she is not performing this.\n\n'
    + '"Everything else in this city belongs to somebody. The wires are read. The water is '
    + 'metered. A chromed man rents his own arm off a company and it goes back to them when he '
    + 'dies, and that is in the paperwork."\n\n'
    + '"Your body is the last thing nobody has been inside. Nobody. Not Halcyon, not the '
    + 'Architect, not a surgeon. End to end, it is yours, and it is the only thing left that '
    + 'is."\n\n'
    + '"And they open their mouths and pour something in and let it eat that."',
  options: [
    opt('And that is desecration.', 'the_flask_desecration'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.the_flask_desecration = {
  _vine: { x: 1420, y: 320 }, actions: [],
  text:
    '"I would not use a word like that out loud. Rennick would have a field day."\n\n'
    + 'She adjusts the sling.\n\n'
    + '"But yes. There is nothing else it is."',
  options: [opt('(say nothing)', 'bye')],
};

t.the_flask_diseased = {
  _vine: { x: 1160, y: 480 }, actions: [],
  text:
    '"No."\n\n'
    + 'It is the flattest thing she has said tonight.\n\n'
    + '"He is diseased flesh that agreed to it. There is a difference between a man with an '
    + 'illness and a man who went and got one on purpose, and the difference is the whole of my '
    + 'opinion about him."\n\n'
    + '"I do not want it near me, I do not want it near the people I eat with, and I would not '
    + 'have it in a room where somebody is sleeping."',
  options: [
    opt('So there is no way back for him.', 'the_flask_cleansed'),
    opt('You are describing a person as an infection.', 'stance_object'),
    opt('(let her walk on)', 'bye'),
  ],
};

// ── the door she believes is open ───────────────────────────────────────────
t.the_flask_cleansed = {
  _vine: { x: 1420, y: 480 }, actions: [],
  text:
    '"There is. That is the part people leave out when they tell this back to me."\n\n'
    + '"The Exodus can take it out of somebody. It costs everything a person has and it hurts for '
    + 'about a year and some of them do not live through it, and afterwards they are just tired '
    + 'and ordinary and thirty."\n\n'
    + '"Come back cleansed and I will sit down and eat with you and never mention it again. That '
    + 'is not me being generous. That is the rule, it is written where anybody can read it, and '
    + 'it has not moved in forty years."',
  options: [
    opt('And until then?', 'the_flask_kept_out'),
    opt('(say nothing)', 'bye'),
  ],
};

// ── the policy, stated with pride ───────────────────────────────────────────
t.the_flask_kept_out = {
  _vine: { x: 1680, y: 480 }, actions: [],
  text:
    '"Until then they stay out."\n\n'
    + 'She lists it like a rota, because to her it is one.\n\n'
    + '"Not the city. Not inside the wall, not on the Row, not on a tram. And not down here '
    + 'either — not this stretch, not the Under, not one yard of it."\n\n'
    + '"People tell me the Under is nobody\'s. It is ours. It is ours because we walk it every '
    + 'night in the dark and nobody else will, and that is how a place becomes somebody\'s."',
  options: [
    opt('That is the right call.', 'stance_approve',
      [flag('lw_purity_stance', 'approved'), warmth(1, 'teague:flask-agreed'), rep(40)]),
    opt('(say nothing)', 'stance_quiet', [flag('lw_purity_stance', 'quiet')]),
    opt('You have just described putting people in the sea.', 'the_flask_sea'),
  ],
};

t.the_flask_sea = {
  _vine: { x: 1940, y: 480 }, actions: [],
  text:
    'She takes that one properly. It is the first thing tonight she has had to think about.\n\n'
    + '"East is four miles of tunnel and a lot of it is dry."\n\n'
    + 'A pause, and she does not fill it with anything.\n\n'
    + '"I have not walked all of it. I have told you that already and I am not going to '
    + 'pretend otherwise now because you have found a way of putting it that stings."',
  options: [
    opt('You could walk it and find out.', 'teague_press'),
    opt('(leave it)', 'bye'),
  ],
};

// ── hook it to her root ─────────────────────────────────────────────────────
const rootOpts = (t.root.options ||= []);
const hook = opt('What do you make of the ones who drink for it?', 'the_flask');
if (!rootOpts.some(o => o.label === hook.label)) rootOpts.splice(1, 0, hook);

// and from the doctrine branch, so it is reachable either way
for (const node of ['earned_chosen', 'earned_chosen_business']) {
  const n = t[node];
  if (!n) continue;
  const o = opt('You have watched it done, then.', 'the_flask');
  if (!(n.options || []).some(e => e.label === o.label)) n.options.unshift(o);
}

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { console.log('DANGLING ' + k + ' -> ' + o.next); bad++; }
console.log('  Teague   the flask: watched it done · the body is the last thing nobody owns');
console.log('  Teague   diseased flesh that agreed to it · cleansing is real · kept out of the Under');
console.log('  nodes ' + Object.keys(t).length + ' · dangling ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
