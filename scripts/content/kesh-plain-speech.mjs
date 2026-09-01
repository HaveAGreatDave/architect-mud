/**
 * Kesh says what he is actually selling. 2026-08-25.
 *
 * The first draft of this scene had him offering "the unit", twice, without ever
 * saying what it was, what it did, or what it cost:
 *
 *   "The top one is the unit the Boulevard would sell you. The bottom one is the
 *    unit you actually need."
 *
 * That is a definite article pointing at nothing, and the effect is riddling.
 * The rule it broke: PEOPLE SPEAK PLAINLY UNLESS THEY ARE CONCEALING SOMETHING,
 * and obliqueness needs a motive the player can identify. Halloran refusing to
 * name the three people who make camera cores works, because he is protecting
 * them and the player can see that. Kesh is SELLING. Vagueness costs him the
 * sale. When a character is oblique and has no reason to be, that is not the
 * character being careful, it is the writer being atmospheric.
 *
 * It also mis-applied plain-writing.md's "withhold the description". That rule
 * is Wells refusing to name the shape in the corner of the hut, and it is about
 * a thing whose power is that its size is unknown. A surgical implant with a
 * price on it is the opposite case: naming it is what makes it real, and the
 * arithmetic is what makes the offer tempting.
 *
 * So he now names the joint, names both products, gives both prices, says how
 * long it takes and when the hand works again -- and is MORE persuasive for it,
 * because a man who talks you down in price in specific numbers is a man you
 * believe. The seduction is that he does not push.
 *
 * Run: node scripts/content/kesh-plain-speech.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const p = path.join(ROOT, 'npcs/npc_asc_kesh.json');
const n = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = n.dialogue_tree;

t.lw_wait_offer = {
  _vine: { x: 1200, y: 1080 },
  actions: [],
  options: [
    { label: 'About a year.', next: 'lw_wait_price', conditions: [], actions: [], enabled: true },
    { label: 'I am here for a part, not a consultation.', next: 'bye', conditions: [], actions: [], enabled: true },
  ],
  text:
    '"You have been favouring your left hand since you came through the door." He does not get '
    + 'up, and he does not make it sound like a sales opening. "The middle two knuckles. You are '
    + 'gripping with the outside of the hand and letting those two do nothing."\n\n'
    + '"How long has it been like that?"',
};

t.lw_wait_price = {
  _vine: { x: 1400, y: 1080 },
  actions: [],
  options: [
    { label: 'No.', next: 'bye', conditions: [], actions: [], enabled: true },
    { label: 'Not today.', next: 'bye', conditions: [], actions: [], enabled: true },
    { label: 'What is the catch?', next: 'lw_wait_catch', conditions: [], actions: [], enabled: true },
  ],
  text:
    '"A year means the cartilage is gone and the tendon is fine, which is the cheap way round." '
    + 'He writes two numbers on a pad and turns it towards you.\n\n'
    + '"Nine hundred is a whole new hand. Full sensory, matched to your skin tone, and you do '
    + 'not need it. People buy it because it is the one on the poster."\n\n'
    + '"Two hundred and twenty is the two knuckles. You keep your own hand, your own nerves and '
    + 'your own fingerprints. It takes me an afternoon and you would be opening a door with that '
    + 'hand by Thursday."\n\n'
    + 'He puts the pen down.\n\n'
    + '"I would rather you came back next week than said yes now. I am paid the same either way."',
};

t.lw_wait_catch = {
  _vine: { x: 1600, y: 1080 },
  actions: [],
  options: [
    { label: 'No.', next: 'bye', conditions: [], actions: [], enabled: true },
    { label: '(say nothing)', next: 'bye', conditions: [], actions: [], enabled: true },
  ],
  text:
    '"The catch is that it is ours." He says it without any change of tone at all. "Halcyon '
    + 'makes the joint, Halcyon services it, and in eleven years it will want servicing. You '
    + 'would be on our books from Thursday and you would stay there."\n\n'
    + '"I am not going to pretend that is nothing. It is the whole business. But you asked me '
    + 'what the catch was and I have got no reason to lie about it -- you will read it on the '
    + 'form before you sign it, and then you would only think I had tried."',
};

if (WRITE) {
  fs.writeFileSync(p, canonicalJson(n), 'utf8');
  console.log('WROTE npc_asc_kesh.json — 3 nodes (offer / price / catch)');
} else {
  console.log('dry run — would rewrite lw_wait_offer, lw_wait_price and add lw_wait_catch');
}
