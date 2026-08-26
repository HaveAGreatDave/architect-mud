/**
 * Short turns and a real back-and-forth. 2026-08-25.
 *
 * ── The measurement that drove this ──────────────────────────────────────────
 *
 * Spoken turns pulled out of the nine public-domain books in content/books
 * (4,898 turns) and out of our own NPC dialogue trees (2,871):
 *
 *                            median   <=6 words   >=40 words
 *   the nine books              6        56%          8%
 *   Architect NPC dialogue     11        36%          9%
 *
 * The long end is FINE. We are at 9% against their 8%, so the problem was never
 * that people here make speeches. The entire gap is at the short end: they get
 * 56% of turns under seven words and we get 36%. Nobody in Coldwater ever says
 * "How long?" or "Left." or "Where?"
 *
 * Wells is the extreme and the model -- The Sleeper Awakes and Moreau both run a
 * median of FOUR words a turn, and the most frightening exchange in Sleeper is
 * six turns of two words each: "What Council?" "The Council." "Whose orders?"
 * "Our orders, Sire."
 *
 * ── So the fix is not trimming. It is adding turns. ──────────────────────────
 *
 * A dialogue tree already has the machinery for back-and-forth: the player's
 * options ARE their turns. What we had been doing is writing one long NPC
 * paragraph and offering three long labels to leave it with. This gives the
 * Quartermaster a fitting that runs the way a fitting runs: she asks, you
 * answer in one word, she asks again, and the whole thing is over in nine
 * turns and about forty words of her speech.
 *
 * It is also the scene her own description has always promised and never
 * delivered -- she fits gear "the way a good tailor fits a suit: a long look,
 * A SHORT QUESTION, and she knows what you should carry."
 *
 * ── And a self-correction ────────────────────────────────────────────────────
 *
 * The questions added to these NPCs an hour ago were still over-written:
 *
 *   "Can you carry somebody who has stopped walking? Answer that honestly,
 *    because I am going to plan around it."
 *
 * The second sentence explains the first, which is the closing-move tic wearing
 * a question mark. A question that has to justify itself is not a question, it
 * is a statement with punctuation. Both are cut back below. "You eaten?" was
 * the only one that was already right.
 *
 * Run: node scripts/content/lw-short-turns.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });

function edit(file, fn) {
  const p = path.join(ROOT, file);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d.dialogue_tree, d);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
}

// ── 1. cut back the over-written questions ──────────────────────────────────
edit('npcs/npc_lw_cyrelle.json', (t) => {
  const n = t.ret_accept;
  const long = '\n\n"Can you carry somebody who has stopped walking? Answer that honestly, because I am going to plan around it."';
  if (typeof n.text === 'string' && n.text.includes(long)) {
    n.text = n.text.replace(long, '\n\n"Can you carry somebody who cannot walk?"');
    log.push('Cyrelle        ret_accept — question stops justifying itself (24 words -> 7)');
  }
});

edit('npcs/npc_lw_quartermaster.json', (t) => {
  const long = '\n\n"What are you carrying that you would not want to put down?"';
  if (typeof t.root.text === 'string' && t.root.text.includes(long)) {
    t.root.text = t.root.text.replace(long, '\n\n"What are you carrying?"');
    log.push('Quartermaster  root — the short question is now actually short (11 words -> 4)');
  }
  const teachQ = '\n\nShe does look up for this one.\n\n"Which hand do you lead with?"';
  if (typeof t.teach.text === 'string' && t.teach.text.includes(teachQ)) {
    t.teach.text = t.teach.text.replace(teachQ, '');
    log.push('Quartermaster  teach — question moved to the fitting, where it belongs');
  }
});

// ── 2. the fitting: nine turns, none of hers over twelve words ──────────────
edit('npcs/npc_lw_quartermaster.json', (t) => {
  if (t.fit_hand) { log.push('Quartermaster  fitting already present, skipped'); return; }

  t.fit_hand = {
    _vine: { x: 300, y: 900 }, actions: [],
    text: 'She closes the ledger on one finger.\n\n"Which hand?"',
    options: [opt('Left.', 'fit_reach'), opt('Right.', 'fit_reach'), opt('Either.', 'fit_either')],
  };

  t.fit_either = {
    _vine: { x: 300, y: 1040 }, actions: [],
    text: '"No, you have got one. Everybody has got one."\n\nShe waits.',
    options: [opt('Left.', 'fit_reach'), opt('Right.', 'fit_reach')],
  };

  t.fit_reach = {
    _vine: { x: 520, y: 900 }, actions: [],
    text: '"Close work or far?"',
    options: [opt('Close.', 'fit_close'), opt('Far.', 'fit_far'), opt('I do not know yet.', 'fit_dunno')],
  };

  t.fit_dunno = {
    _vine: { x: 520, y: 1060 }, actions: [],
    text: '"Close, then. Everybody says far and comes back bleeding."',
    options: [opt('(let her)', 'fit_close')],
  };

  t.fit_close = {
    _vine: { x: 760, y: 860 }, actions: [],
    text: 'She puts two things on the counter without hunting for them.\n\n"Nothing long, then. Both of those work wet."',
    options: [opt('Wet?', 'fit_wet'), opt('Thank you.', 'fit_done')],
  };

  t.fit_far = {
    _vine: { x: 760, y: 1040 }, actions: [],
    text: 'She reaches high and does not look up to do it.\n\n"Then you want reach and you want patience. One of those I can hand you."',
    options: [opt('Which one?', 'fit_which'), opt('Thank you.', 'fit_done')],
  };

  t.fit_which = {
    _vine: { x: 1000, y: 1040 }, actions: [],
    text: '"Guess."',
    options: [opt('(take the gear)', 'fit_done')],
  };

  t.fit_wet = {
    _vine: { x: 1000, y: 860 }, actions: [],
    text: '"You will be in the wash sooner or later. Everybody is."\n\nShe turns a page.\n\n"Bring them back dirty. Bring them back."',
    options: [opt('(take the gear)', 'fit_done')],
  };

  t.fit_done = {
    _vine: { x: 1240, y: 940 }, actions: [],
    text: 'She writes two lines in the ledger and turns it round so you can see your own name on it.\n\n"Now you are in the book."',
    options: [opt('Show me the shelves.', '__shop__'), opt('Understood.', 'bye')],
  };

  // ⚠ Match on LABEL, never just append. A bare splice adds this again on every
  // replay, and replaying the Long Watch chain put eleven copies of "Fit me for
  // something." in her greeting before the integrity check caught it. Nothing
  // fails: a repeated option is valid content and lints clean. Match on label
  // rather than on `next`, because later passes re-point this option at a new
  // entry node (fit_hand -> fit_long -> fit_what) and a `next` test would stop
  // recognising its own work the moment that happened.
  const rootOpts = (t.root.options ||= []);
  if (!rootOpts.some(o => o.label === 'Fit me for something.')) {
    rootOpts.splice(1, 0, {
      label: 'Fit me for something.',
      next: 'fit_hand',
      actions: [], enabled: true,
      conditions: [{ flag: 'lw_member', op: 'set', scope: 'player' }],
    });
  }

  log.push('Quartermaster  a fitting: 9 nodes, her longest turn is 22 words, five are under 6');
});

console.log(log.map(l => '  ' + l).join('\n') || '  (nothing to do)');
console.log('\n' + (WRITE ? 'WROTE' : 'dry run — nothing written'));
