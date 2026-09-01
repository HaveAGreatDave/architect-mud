/**
 * The three order NPCs the two main passes missed.
 *
 * npc_asc_warden — Warden Unit "Threshold", an Ascendant-faction machine that
 *   carried no em dash at all. It is the first Ascendant voice a player meets,
 *   and it was the only one not using the cadence that separates the orders.
 *
 * npc_asc_registrar — The Vat Registrar. One dash across three nodes. It
 *   explains the whole business model in a paragraph, so it should sound like it.
 *
 * npc_lw_rennick — the Long Watch picket. Already dash-free and already good.
 *   Aligned to the same contraction-free register as the rest of the Watch.
 *   "You come as you were made" is left alone.
 *
 * ⚠ npc_asc_prospect (Corin Halbrook) has no em dash and must not be given one.
 * He is faction-null, a Coldwater civilian who has not walked west yet. He picks
 * up the cadence by joining; the absence is the characterisation.
 *
 *   node scripts/content/rewrite-order-dialogue-edges.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const NPCS = path.join(process.cwd(), 'content', 'npcs');
const CHECK = process.argv.includes('--check');

const D = {

  // ═══ THE GATE · the first Ascendant voice in the game. ════════════════════
  npc_asc_warden: {
    root: {
      text: 'The chrome unit registers you without warmth.\n\n"Warden Unit, designation Threshold. State nothing — I have already read everything about you that matters, and I read it before you were close enough to be nervous."',
    },
    what: {
      text: '"This is the beginning of the Ascendants — and the end of what you currently are, which are the same event described from two sides."\n\nThe scanline holds on you, unhurried.\n\n"Past this Gate the meat becomes something worth keeping. You are, at present, only meat. That is not an insult. It is a reading."',
    },
    refuse: {
      text: '"No. You carry no clearance and too much flesh — a condition, not a verdict, and conditions are the sort of thing that get solved."\n\nThe scanline moves off you and does not come back.\n\n"Speak to the recruiter if you wish that to change. Do not run the line. The turrets are not rhetorical."',
    },
    bye: { text: 'The scanline passes over you once more and dismisses you.' },
  },

  // ═══ THE VAT REGISTRAR · the business model, in one paragraph. ════════════
  npc_asc_registrar: {
    root: {
      text: 'The shell brightens as you enter.\n\n"Welcome to the Registry. I hold the only copy of you that will outlast the accident — and there is always an accident, statistically, eventually. Shall I explain the terms?"',
    },
    how: {
      text: '"A cortical backup is the summit augment; a policy from Halcyon is the fuel. Save your state here, keep your account paid, and death becomes a formality — one we handle while you sleep, and bill for afterwards, and never once discuss with you again."\n\nThe warm light does not change at all for the next part.\n\n"Lapse the account, and you die like anybody else. Messily, and only once."\n\nA gentle pause.\n\n"The full service comes online with a later refit. For now, consider this your introduction."',
    },
    bye: { text: '"Rest assured." The warm light dims to a patient standby.' },
  },

  // ═══ RENNICK · the picket. Register aligned, position untouched. ══════════
  npc_lw_rennick: {
    root: {
      text: 'You almost do not see them until they want you to.\n\n"Far enough." The voice is quiet, unhurried, certain. "That door is not for you, and the things back the way you came are not either. State your business or turn around."',
    },
    wary: {
      text: '"What this is," the picket says, "is as far as you go. There is a door here and it does not open for the curious."\n\nA pause, measuring you.\n\n"The machine owns most people before they ever think to ask who does. Go and decide what kind of city you actually want. Really decide. Then maybe there is a place down here for you. Come back the same as you are now and there is not."\n\nA flick of the eyes, down and up, taking inventory.\n\n"And come back in the body you were issued. We have no use for the bought or the slipped, whatever they can do."',
    },
    terms: {
      text: '"Terms," the picket says, as though reading a list they have read a great many times.\n\n"You come as you were made. No steel in you, nothing growing that should not be. Not because we are better than the ones who did it, though I will not pretend some here do not think so."\n\nThe rifle does not move.\n\n"Because everything past this door was built by people who had nothing but their hands, and it does not work for anybody who took the other road."',
    },
    carrying: {
      text: 'The picket does not answer straight away, and the pause is the answer.\n\n"Then you get it taken out, and you get the flesh corrected, and you come back standing in your own body." No heat in it at all. "Not a step of that happens down here. We do not do that work and we would not know how. Go and be cleansed, properly, and present yourself again."\n\nA beat.\n\n"We will know. Everybody always thinks we will not."',
    },
    hardline: {
      text: '"It is," the picket agrees, perfectly pleasant. "You will find nobody here who thinks it is not, and nobody here who will move it."\n\nThe rifle has not moved either.\n\n"There are four other answers in this city and every one of them will take you tonight, exactly as you stand. That is rather the difference."',
    },
    give_pass: {
      text: 'The picket studies you a long moment. Your gear. Your hands. The way you got this deep and lived.\n\nSomething settles.\n\n"You came all this way, and you lean the right direction. That is rare enough to spend a word on."\n\nThe rifle lowers an inch.\n\n"Do not loiter at this door. Go up top, Kessler Street, a repair shop called Percussive Maintenance. Tell the man there: the lights stay on, somebody should keep the switch. He will know what to do with you."\n\n"Now move, before something with more teeth than me finds you standing here."',
    },
    bye: { text: 'The picket says nothing more, and somehow you are already walking away.' },
  },
};

const skeleton = (tree) => JSON.stringify(Object.fromEntries(
  Object.entries(tree).map(([k, n]) => [k, {
    ...n, text: null, first: null,
    text_by_relation: n.text_by_relation ? Object.keys(n.text_by_relation).sort() : null,
    options: (n.options || []).map((o) => ({ ...o, label: null })),
  }])
));

let npcs = 0, nodes = 0;
const problems = [];

for (const [npcId, patch] of Object.entries(D)) {
  const file = path.join(NPCS, `${npcId}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tree = data.dialogue_tree || {};
  const before = skeleton(tree);
  const isWatch = npcId.startsWith('npc_lw_');

  for (const [key, p] of Object.entries(patch)) {
    const node = tree[key];
    if (!node) { problems.push(`${npcId}: no node "${key}"`); continue; }
    if (p.text !== undefined) {
      if (Array.isArray(node.text) !== Array.isArray(p.text)) { problems.push(`${npcId}/${key}: array/string mismatch`); continue; }
      if (isWatch && /—/.test(p.text)) problems.push(`${npcId}/${key}: em dash in Watch prose`);
      if (!isWatch && !/—/.test(p.text) && node.text && String(node.text).length > 200) {
        problems.push(`${npcId}/${key}: long Ascendant node with no tell`);
      }
      node.text = p.text; nodes++;
    }
  }

  const after = skeleton(tree);
  if (before !== after) { problems.push(`${npcId}: STRUCTURE CHANGED, refusing`); continue; }
  if (!CHECK) fs.writeFileSync(file, canonicalJson(data), 'utf8');
  npcs++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Edges: ${npcs} NPC(s), ${nodes} node(s).`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
