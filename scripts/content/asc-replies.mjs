/**
 * The Ascendants let you nod through the worst of it. 2026-08-26.
 *
 * Same audit that found 17 walls in Teague, pointed at the rest of the game.
 * The Ascendants are worse: 37 nodes across Maresh, Ives and Vess where the only
 * thing the player can do is say nothing — and they are not small nodes. They
 * are "What happens to them afterwards is data. We keep it", "I have not met
 * him", "You do not re-wire a district you are waiting on". The three most
 * chilling lines the order has, each followed by a button that means shrug.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 *
 * "(say nothing)" is for LEAVING, never for advancing. Where it advanced, it was
 * either an act — sitting down, taking a coat, wiping your hands, which is a
 * real choice with a body behind it — or it was a continue button. Acts stay.
 *
 * ⚠ AND AT LEAST ONE REPLY IS NEVER AN ACCUSATION. Same rule the Teague pass
 * ran on and it matters more here, because the Ascendants are written to be
 * appealing and a player who can only ever snarl at them never finds out why
 * anybody joins. Maresh concedes a fair hit and enjoys it. Ives would price the
 * thing nobody has asked her to price, properly, given a fortnight and somebody's
 * authority. Vess takes the wellbeing session back off your file in front of you.
 *
 * ── WHAT THE NEW REPLIES MUST NOT DO ─────────────────────────────────────────
 *
 * ⚠ Nothing here confirms where a declined life goes. Asked directly, Maresh
 * does not deflect and does not lie — he does not know, he says which department
 * would, and he says it has never come up in a meeting he was in. That is worse
 * than a cover-up and it is the whole design: see the invariant in
 * docs/systems-ascension.md and the note in asc-say-mutant.mjs.
 *
 * ⚠ And Vess's "I have never asked" now gets "Ask." — she agrees, writes a real
 * note, and means it. Nothing ever follows it up. If somebody later writes the
 * answer into a quest, this stops working.
 *
 * ── KEPT MUTE, ON PURPOSE ────────────────────────────────────────────────────
 *
 * The stance outcomes (hand_approve, hand_recover, hand_stay_watched,
 * stance_recover, stance_refused), the post-warning beats (maresh_backdown,
 * ives_backdown), the acts (the_coat_worth, coldchain_report,
 * gallery_removal_ask, stance_approve), the two dismissals where the NPC has
 * ended it (Maresh's `cold`, the Curator's `cold`), and the quest reports. In
 * every one of those a further line is the player getting the last word off
 * somebody who has stopped talking to them.
 *
 * Run: node scripts/content/asc-replies.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });
const log = [];

function edit(file, fn) {
  const p = path.join(ROOT, 'npcs/' + file + '.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.dialogue_tree;
  let x = 1200, y = 2600;
  const add = (key, text, options = [opt('(say nothing)', 'bye')]) => {
    t[key] = { _vine: { x: (x += 40), y: (y += 90) }, actions: [], text, options };
  };
  const reply = (key, ...options) => {
    if (!t[key]) { log.push('  MISS  ' + file + ' · ' + key); return; }
    t[key].options = [...options, opt('(say nothing)', 'bye')];
  };
  fn({ t, add, reply });
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
  // per-file checks
  const names = new Set([...Object.keys(t), 'bye']);
  for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
    if (o.next && !names.has(o.next)) log.push('DANGLING ' + file + ' · ' + k + ' -> ' + o.next);
  const linked = new Set(['root']);
  for (const v of Object.values(t)) for (const o of v.options || []) if (o.next) linked.add(o.next);
  for (const k of Object.keys(t)) if (!linked.has(k) && !k.startsWith('_')) log.push('ORPHAN ' + file + ' · ' + k);
  log.push('  ok    ' + file.padEnd(20) + Object.keys(t).length + ' nodes');
}

// ════════════════════════════════════════════════════════════════════════════
// MARESH — the recruiter
// ════════════════════════════════════════════════════════════════════════════
edit('npc_asc_recruiter', ({ add, reply }) => {
  add('maresh_document',
    '"We do. That is what the intake form is for."\n\n'
    + 'He is not being clever. He believes he has answered you.\n\n'
    + '"What happens after intake is a different department and I have never worked in it."');

  add('maresh_same',
    '"It is not the same, and I will show you why."\n\n'
    + '"Their man cannot sit down because of what he is. Our man cannot be covered because of what '
    + 'we cannot measure. If we could measure it we would cover it and we would be delighted to, '
    + 'because that is a market."\n\n'
    + '"You are welcome to find that colder. It is not the same."');

  reply('why_us_purity',
    opt('Then document a mutant.', 'maresh_document'),
    opt('That is a nicer way of saying the same thing.', 'maresh_same'));

  // ⚠ The direct question, and he neither deflects nor lies.
  add('maresh_where_go',
    '"Out, mostly."\n\n'
    + 'The smile does not move.\n\n'
    + '"I am not being coy. I do not run intake. Ives would know the form number and Kesh would '
    + 'know the ward."\n\n'
    + '"It has never come up in a meeting I was in, and I have sat in a great many meetings."');

  add('maresh_kept',
    '"Somebody reads it. Everything is read eventually — that is the whole promise of the '
    + 'place."\n\n'
    + '"Whether anybody acts on what they read is a separate question, and I would not raise that '
    + 'one on a first visit."');

  reply('the_words_them',
    opt('Where do they go?', 'maresh_where_go'),
    opt('You keep it and nobody reads it.', 'maresh_kept'));

  add('maresh_sent_where',
    'He is already on the next thing and has to come back for it.\n\n'
    + '"Sent anywhere. It is a turn of phrase."\n\n'
    + 'He waits, pleasantly, to see whether you have another question.');

  add('maresh_not_me',
    '"No."\n\n'
    + 'A beat.\n\n'
    + '"No, you were not."\n\n'
    + 'He looks at you for slightly longer than the conversation requires.\n\n'
    + '"That is a credit to you, and I would keep it to yourself in here."');

  reply('the_second_window_reassure',
    opt('Sent where?', 'maresh_sent_where'),
    opt('I was not asking about me.', 'maresh_not_me'));

  add('maresh_reads',
    '"Almost nobody. We know the number."\n\n'
    + '"It is on a slide. Somebody presents it once a year and everybody agrees it is a shame."');
  reply('why_us_price', opt('Nobody reads the form.', 'maresh_reads'));

  add('maresh_admire',
    '"I do. It costs me nothing and it is true."\n\n'
    + '"They will lose. They will lose slowly and with excellent manners, and I would rather it '
    + 'were somebody other than me doing it to them."');
  reply('why_us_watch', opt('You admire them.', 'maresh_admire'));

  add('maresh_load_bearing',
    '"For the people standing under it."\n\n'
    + 'He gestures at the queue without looking at it.\n\n'
    + '"Which is everybody. Including me, before you say it."');
  reply('codex_certain', opt('Load-bearing for who?', 'maresh_load_bearing'));

  add('maresh_answerable',
    '"The bench. Then the floor. Then a man called Alder, who I have met twice and did not enjoy '
    + 'either time."\n\n'
    + '"That is not nothing. Ask out south for the equivalent and see what you are handed."');
  reply('why_us_flask_works', opt('Answerable to who, though?', 'maresh_answerable'));

  add('maresh_fair_hit',
    '"Now that is a fair hit."\n\n'
    + 'He does not stop enjoying himself.\n\n'
    + '"Yes. The people who would put it best are not in this building, and that is by '
    + 'arrangement, and the arrangement is ours."');
  reply('why_us_flask_barb', opt('Nobody has explained it because nobody gets to.', 'maresh_fair_hit'));
});

// ════════════════════════════════════════════════════════════════════════════
// IVES — the actuary
// ════════════════════════════════════════════════════════════════════════════
edit('npc_asc_ives', ({ add, reply }) => {
  add('ives_met',
    '"It would change the afternoon."\n\n'
    + 'She finishes the column before she answers the rest of it.\n\n'
    + '"It would not change the reserve. That is the argument for not meeting him. I did not '
    + 'invent it and I have never been able to fault it."');

  // The one that explains her.
  add('ives_go_meet',
    '"I could. I did, once, in my second year."\n\n'
    + '"Ranner, on Cinder Lane. I put four hundred of my own into his account and the file closed '
    + 'on the day it was always going to close."\n\n'
    + 'She marks the column.\n\n'
    + '"So now I do the column."');

  reply('the_number_bad',
    opt('Would it change anything if you had?', 'ives_met'),
    opt('Then go and meet him.', 'ives_go_meet'));

  add('ives_still_event',
    '"Yes."\n\n'
    + 'She does not soften it and she does not add to it.\n\n'
    + '"It is simply not one of ours, and I have no book for those."');
  reply('the_number_stop', opt('It is still an event.', 'ives_still_event'));

  // ⚠ She is not the obstacle, and finding that out should cost the player a question.
  add('ives_price_it',
    'She stops writing.\n\n'
    + 'It is the longest she has gone without writing since you came in.\n\n'
    + '"I would want a fortnight, the second book, and somebody\'s authority. All three in '
    + 'writing."\n\n'
    + 'She picks the pen back up.\n\n'
    + '"Bring me somebody who can give me those and I will do it properly."');
  reply('the_mutant_count', opt('I am asking.', 'ives_price_it'));

  add('ives_count_them',
    '"Thousands is the count."\n\n'
    + 'She turns the page.\n\n'
    + '"You want me to say that I remember one. I remember four. I am not going to tell you about '
    + 'them, because you would take it as the good news and it is not."');
  reply('the_loss_body', opt('Do you count them?', 'ives_count_them'));

  add('ives_your_name',
    'She tells you. Correctly, with the stress in the right place, and she has not looked at '
    + 'anything to do it.\n\n'
    + '"It was on the gate log at eleven minutes past."\n\n'
    + '"You are not being watched, you are being served. Those feel identical from where you are '
    + 'standing and they are not the same thing."');
  reply('the_note_what', opt('What is my name?', 'ives_your_name'));

  add('ives_again',
    '"Eleven thousand and forty."\n\n'
    + 'She says it exactly as she said it the first time, which is the answer to what you were '
    + 'actually asking.');
  reply('the_second_book_many', opt('Say that number again.', 'ives_again'));

  add('ives_should_be',
    '"Why."\n\n'
    + 'Not hostile. She would like the argument, if you have one.\n\n'
    + '"If it were difficult I would be slower. The slowness would come off the lights on the '
    + 'approach, and then there would be four hundred people watching a dark road."');
  reply('the_watch', opt('It should be difficult.', 'ives_should_be'));
});

// ════════════════════════════════════════════════════════════════════════════
// VESS — the curator's colleague
// ════════════════════════════════════════════════════════════════════════════
edit('npc_asc_vess', ({ add, reply }) => {
  add('vess_waiting_on',
    '"For the book to close on it."\n\n'
    + 'She says it as a scheduling fact, because to her it is one.\n\n'
    + '"The Row has about nine years in it. After that it is not a district, it is a site, and you '
    + 'wire a site properly rather than patching one twice."');
  reply('the_gallery_cost', opt('Waiting on what?', 'vess_waiting_on'));

  // She takes it back off the file in front of you, and the record stays anyway.
  add('vess_no_session',
    '"Of course. I will take it off."\n\n'
    + 'She does, in front of you, and you watch the line go.\n\n'
    + '"It stays on the wellbeing side either way, because I have to record that it was offered. '
    + 'That is not a mark against you either."');
  reply('choosing_cage', opt('I do not want a session.', 'vess_no_session'));

  // ⚠ She agrees, means it, and nothing ever follows it up.
  add('vess_ask',
    '"I will."\n\n'
    + 'She writes herself a note, and it is a real note, and she will genuinely do it.\n\n'
    + '"Come and see me in a month. If it turns out to be nothing, I will tell you it was '
    + 'nothing."');
  reply('looked_after_where', opt('Then ask.', 'vess_ask'));

  add('vess_nine_for_who',
    '"Everybody in the district. That is the number, averaged."\n\n'
    + '"You are about to ask whether it is nine years for everybody or eighteen for half of them. '
    + 'It is nearer the second. I have said so in writing twice."');
  reply('the_numbers_argued', opt('Nine years for who?', 'vess_nine_for_who'));

  add('vess_decent_right',
    '"No, it is not, and I have never said it was."\n\n'
    + '"It is the only part of it that is mine to decide. If you find something else in this '
    + 'building that is mine, tell me, and I will decide that properly as well."');
  reply('the_difficulty_decent', opt('That is not the same as it being right.', 'vess_decent_right'));

  add('vess_not_choosing',
    '"It is the only kind there is."\n\n'
    + 'She is not being combative. She thinks this is obvious.\n\n'
    + '"Nobody chooses between a good thing and a better one. They choose between a hard winter '
    + 'and an easier one, and they always have, and we did not invent the winter."');
  reply('choosing_want', opt('That is not choosing.', 'vess_not_choosing'));
});

console.log(log.join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
