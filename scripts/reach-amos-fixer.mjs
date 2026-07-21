// scripts/reach-amos-fixer.mjs — one-shot content authoring.
//
// Amos Dune sold contraband and unlocked the raws run, but he had nothing to say
// about the RISK — so the customs-scan system (plugins/flight/contracts.js:
// checkCargoDropDelivery, the `customs bribe|bolt` verb, and the smuggler's-hold
// kit) was undiscoverable unless you'd already been caught by it once. A fence
// who doesn't warn you about the scanners isn't a fixer, he's a vending machine.
//
// Adds three nodes to his existing tree (root's other options are untouched):
//   • scans      — how the customs check actually works, in his voice
//   • scans_hold — points at kit_smuggler_hold and `installkit`
//   • inner      — gated on bm_trust ≥ 10: the real numbers, for regulars only
//
// Everything he says here is TRUE of the built system. Nothing is invented and no
// new mechanic is added — this is discoverability for what already ships.
//
// Idempotent. Writes the DB and the content file.
//
//   node scripts/reach-amos-fixer.mjs                     # local dev DB
//   node --env-file=.env.prod scripts/reach-amos-fixer.mjs # prod

import { writeFileSync } from 'node:fs';
import { query } from '../server/models/db.js';
import { contentEntries } from '../server/models/content-registry.js';
import { CONTENT_DIR, canonicalJson, fileNameForRow, rowToFileObject } from './content/lib.mjs';

const AMOS = 'npc_1784515608920';
const TRUST_GATE = 10;   // bm_trust — a few clean tier-2+ runs' worth of standing

const NEW_NODES = {
  scans: {
    _vine: { x: 420, y: 600 },
    text: '"Getting it off the Reach is the easy half." Amos closes the ledger with one finger in it. '
      + '"Every field that flies a flag runs a scan on what comes out of your hold. Here we don\'t — '
      + 'that\'s what here is for. Anywhere else, you\'re talking your way past a man with a reader." '
      + '<span class="text-dim">He looks at you levelly.</span> "If he doesn\'t like your answer you get one '
      + 'choice and about a minute to make it: pay him, or firewall it and go. Paying costs money. Running '
      + 'costs you the load and puts your name on a manufacturing charge."',
    options: [
      { label: 'How do I make him like my answer?', next: 'scans_hold' },
      { label: 'What are the actual odds?', next: 'inner', conditions: [{ flag: 'bm_trust', scope: 'player', op: 'gt', value: String(TRUST_GATE - 1) }] },
      { label: 'I\'ll take my chances.', next: 'root' },
    ],
  },
  scans_hold: {
    _vine: { x: 800, y: 600 },
    text: '"Two ways. Carry less and cook it lighter — a small clean load talks its way through fine. '
      + 'Or you stop relying on your mouth." <span class="text-dim">He taps the desk twice.</span> '
      + '"There\'s a false floor a decent shop can put in a hold. Smuggler\'s hold. Costs you cargo room and '
      + 'it costs you money, and about half the time the reader just doesn\'t find anything to ask about. '
      + 'Any hangar that fits kits will fit one — <b>installkit</b>, and don\'t come crying when it eats your payload."',
    options: [
      { label: 'Noted.', next: 'root' },
      { label: 'Back up — tell me about the scans again.', next: 'scans' },
    ],
  },
  // Trust-gated. He's telling a regular the arithmetic he'd never spell out for a
  // stranger — and it is the arithmetic: diff = 3 + maxCookTier + (pallets-1) - 2 if held.
  inner: {
    _vine: { x: 1180, y: 600 },
    text: 'Amos looks at you for a while. Then he sets the pen down, which is the most he has ever committed to a '
      + 'conversation.\n\n"You\'ve flown enough of mine that I\'ll say it plain. It starts hard and gets harder: '
      + 'every step up in what you\'ve cooked, that\'s one more thing he can find. Every extra pallet past the first, '
      + 'same again. The hold buys you back two steps and a coin-flip\'s worth of not being asked at all." '
      + '<span class="text-dim">He picks the pen back up.</span> "So: one pallet, cooked light, false floor in. '
      + 'That\'s a milk run. Four pallets of your best work in a bare hold is you handing a man your licence and a pen."',
    options: [
      { label: 'That\'s worth knowing.', next: 'root' },
      { label: 'Why tell me?', next: 'inner_why' },
    ],
  },
  inner_why: {
    _vine: { x: 1180, y: 800 },
    text: '"Because you keep coming back, and every load you lose out there is a load I don\'t sell." '
      + '<span class="text-dim">He returns to the ledger.</span> "Don\'t mistake it for fondness."',
    options: [{ label: 'Wouldn\'t dream of it.', next: 'root' }],
  },
};

const ROOT_OPTION = { label: 'What happens if I get scanned on the way home?', next: 'scans' };

async function main() {
  const { rows } = await query('SELECT dialogue_tree FROM npcs WHERE id = $1', [AMOS]);
  if (!rows.length) throw new Error(`${AMOS} not found`);
  const tree = rows[0].dialogue_tree || {};
  if (!tree.root) throw new Error('Amos has no root node — refusing to guess at the tree shape');

  Object.assign(tree, NEW_NODES);

  // Insert the entry point once, above "What is this place?" so the risk question
  // sits next to the job it's about.
  tree.root.options = tree.root.options || [];
  if (!tree.root.options.some(o => o.next === 'scans')) {
    const at = tree.root.options.findIndex(o => o.next === 'about');
    tree.root.options.splice(at < 0 ? tree.root.options.length : at, 0, ROOT_OPTION);
  }

  await query('UPDATE npcs SET dialogue_tree = $2 WHERE id = $1', [AMOS, JSON.stringify(tree)]);

  const entry = contentEntries().find(e => e.table === 'npcs');
  const { rows: after } = await query('SELECT * FROM npcs WHERE id = $1', [AMOS]);
  writeFileSync(`${CONTENT_DIR}/npcs/${fileNameForRow(entry, after[0])}`,
    canonicalJson(rowToFileObject(entry, after[0])), 'utf8');

  console.log(`✓ Amos now warns about customs (${Object.keys(NEW_NODES).length} nodes added).`);
  console.log(`  Inner-circle node gated on bm_trust > ${TRUST_GATE - 1}.`);
  console.log(`  root options: ${tree.root.options.map(o => o.next).join(', ')}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
