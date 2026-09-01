/**
 * The second window. 2026-08-25.
 *
 * ── Two things ───────────────────────────────────────────────────────────────
 *
 * 1. "You are asking me to touch it as well." was muddled — "as well" was doing
 *    two jobs and the sentence had to be read twice. What he means is that
 *    courtesy is cheap and contact is not, which is exactly his register, so he
 *    should say that. It also prices a handshake, which nobody else in the game
 *    would think to do.
 *
 * 2. A mutant who comes to Halcyon for help is taken somewhere and is not seen
 *    again, AND NOBODY EVER SAYS SO.
 *
 * ── How the disappearance is built ───────────────────────────────────────────
 *
 * Every piece of it is a helpful, ordinary thing said by somebody being kind.
 * Nothing is sinister on its own. The player assembles it, or does not.
 *
 *   Maresh sends the man to the SECOND WINDOW and promises he will be seen
 *   today. He is telling the truth as far as he knows it.
 *
 *   Ask Maresh what is at the second window and he does not know. It is not his
 *   department. He has worked there eleven years.
 *
 *   Vess, asked what becomes of them, is warm and completely without detail.
 *   "They are looked after." She is not evading. She has never wondered.
 *
 *   Ives files the F-forty to a department that has no name on the routing
 *   slip, only a number, and she has never had cause to go there.
 *
 *   And one physical fact, stated once, with no comment attached: there is
 *   never a queue at the second window.
 *
 * ⚠ Nobody in this game may ever confirm it. No document, no overheard line, no
 * quest reward that explains where they go. The moment it is stated it becomes a
 * plot the player can defeat, and it stops being the thing that makes an
 * otherwise reasonable organisation unbearable. If a later pass wants to use it,
 * the strongest version is still somebody's relative who "was seen today" in a
 * year nobody can quite place.
 *
 * Run: node scripts/content/asc-second-window.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });
const insertOpts = (node, ...opts) => {
  const list = (node.options ||= []);
  const fresh = opts.filter(o => !list.some(e => e.label === o.label));
  if (fresh.length) list.splice(1, 0, ...fresh);
};
const edit = (rel, fn) => {
  const p = path.join(ROOT, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d, d.dialogue_tree);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── Maresh ──────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.the_handshake_ask.text =
    '"I did not, no."\n\n'
    + 'He is not embarrassed and he does not pretend not to understand.\n\n'
    + '"I was courteous to him, and he will be seen today, which is more than he would get '
    + 'anywhere else in this city."\n\n'
    + 'He straightens something on the desk that was already straight.\n\n'
    + '"Being courteous cost me nothing. What you are asking about would have."';
  t.the_handshake_ask.options = [
    opt('What is at the second window?', 'the_second_window'),
    opt('(say nothing)', 'bye'),
  ];

  t.the_second_window = {
    _vine: { x: 1420, y: 1980 }, actions: [],
    text:
      '"Intake."\n\n'
      + 'He does not lower his voice for it. It is a department, and he says it the way he would '
      + 'say a floor number.\n\n'
      + '"Not my desk. Somebody assesses him, and there is a form, and after that he is a '
      + 'clinical matter rather than a commercial one."',
    options: [
      opt('Have you ever been through that door?', 'the_second_window_long'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_second_window_long = {
    _vine: { x: 1680, y: 1980 }, actions: [],
    text:
      '"No."\n\n'
      + 'He thinks about it, which he has plainly never done before, and it takes him no time at '
      + 'all.\n\n'
      + '"Eleven years and I have never had a reason to."\n\n'
      + 'Then he says the next part kindly, because he believes it will put you at your ease.\n\n'
      + '"Neither will you."',
    options: [
      opt('That is not reassuring.', 'the_second_window_reassure'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_second_window_reassure = {
    _vine: { x: 1940, y: 1980 }, actions: [],
    text:
      '"Is it not?"\n\n'
      + 'He is genuinely puzzled for about a second, and then he has it, and he is sorry.\n\n'
      + '"Ah. You are worrying about him."\n\n'
      + 'He turns his chair slightly towards you, and he is being kind, and he does not know he '
      + 'is answering a different question.\n\n'
      + '"You are class four. You could not be sent there if you tried."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('What happens at the second window?', 'the_second_window'));
  log.push('Maresh   courtesy cost nothing · Intake · eleven years and never been through it');
});

// ── Vess: warm, and completely without detail ───────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.looked_after = {
    _vine: { x: 900, y: 2120 }, actions: [],
    text:
      '"They are looked after."\n\n'
      + 'She says it warmly and it is plain she believes it.\n\n'
      + '"Nobody is put out on the road. That is the thing people always assume and it has never '
      + 'once been true."',
    options: [
      opt('Looked after where?', 'looked_after_where'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.looked_after_where = {
    _vine: { x: 1160, y: 2120 }, actions: [],
    text:
      'She thinks about it, and the thinking is genuine, and it does not take long.\n\n'
      + '"Do you know, I have never asked."\n\n'
      + 'She is already turning back to the case she was showing you.\n\n'
      + '"Somebody will know."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('What happens to a mutant who comes here for help?', 'looked_after'));
  log.push('Vess     "They are looked after" · "Do you know, I have never asked."');
});

// ── Ives: a department with a number and no name ────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.the_mutant_form.text =
    '"It is where we record anything alive that we cannot put a value on."\n\n'
    + 'She is not defensive. She has not understood the objection and does not know that she has '
    + 'not.\n\n'
    + '"The page goes to Nine. Not the ninth floor — the department. There is no name on the '
    + 'slip, only the number, which I have always assumed is an oversight."\n\n'
    + '"Nineteen years, and I have never had cause to send anything else there."';
  log.push('Ives     the F-forty routes to a department with a number and no name');
});

// ── the gate itself: one physical fact, no comment ──────────────────────────
{
  const p = path.join(ROOT, 'zones/zone_halcyon_lobby.json');
  if (fs.existsSync(p)) {
    const z = JSON.parse(fs.readFileSync(p, 'utf8'));
    const add = ' Two windows serve the floor. There is always a queue at the first one.';
    if (!z.description.includes('always a queue at the first')) {
      z.description = z.description.trimEnd() + add;
      if (WRITE) fs.writeFileSync(p, canonicalJson(z), 'utf8');
      log.push('Grand Lobby  "There is always a queue at the first one."');
    }
  } else log.push('Grand Lobby  MISSING zone_halcyon_lobby.json — skipped');
}

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
