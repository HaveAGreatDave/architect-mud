// One-shot: add Sully's "bigger hauls" branch to his existing dialogue tree —
// the fence-gated unlock for the air-cargo raw pallets (flight/contracts.js
// UNLOCK_AIR_CARGO). Purely additive (new nodes + one new bm_menu option);
// idempotent — skipped if the branch is already present. Run once:
//   node scripts/add-fence-air-unlock.js
import { query } from '../server/models/db.js';

const NPC_ID = 'npc_barkeep'; // Sully Holt

const { rows } = await query('SELECT dialogue_tree FROM npcs WHERE id=$1', [NPC_ID]);
if (!rows.length) { console.error('[add-fence-air-unlock] Sully (npc_barkeep) not found.'); process.exit(1); }

const tree = rows[0].dialogue_tree || {};
if (tree.bm_air_offer) {
  console.log('[add-fence-air-unlock] Branch already present — nothing to do.');
  process.exit(0);
}
if (!tree.bm_menu?.options) {
  console.error('[add-fence-air-unlock] bm_menu not found on the tree as expected — aborting rather than guessing.');
  process.exit(1);
}

tree.bm_air_offer = {
  text: 'You lean in. "Word is you know someone who flies heavier than a MULE drone — no checkpoint at all." Sully studies you a long moment. "...Maybe. Guy runs cargo out past the Redline fence, off the Scald strip — same drop, bigger hauls. He won\'t deal with just anyone. You\'ve done enough clean runs he\'ll take the meeting."',
  _vine: { x: 700, y: 700 },
  actions: [],
  options: [
    { next: 'bm_air_confirmed', label: "I'm in.", actions: [{ action: 'UNLOCK_AIR_CARGO' }] },
    { next: 'bm_menu', label: 'Not yet.' },
  ],
};
tree.bm_air_confirmed = {
  text: "Done. Next time you're at an airfield, ask around for cargo — he keeps a pallet waiting for you at the Scald. Fly it home yourself; nobody's walking it through a checkpoint.",
  _vine: { x: 1040, y: 700 },
  actions: [],
  options: [{ next: 'bm_menu', label: 'Good to know.' }],
};
tree.bm_air_already = {
  text: '"Already sorted," Sully says, not looking up. "Go fly."',
  _vine: { x: 1040, y: 800 },
  actions: [],
  options: [{ next: 'bm_menu', label: 'Right.' }],
};

// Insert before the trailing "Nothing tonight." option.
const opts = tree.bm_menu.options;
const tailIdx = opts.findIndex(o => o.next === 'root');
const newOption = {
  next: 'bm_air_offer',
  label: 'You ever move anything... bigger?',
  conditions: [{ op: 'gt', flag: 'bm_trust', scope: 'player', value: '6' }],
};
if (tailIdx >= 0) opts.splice(tailIdx, 0, newOption);
else opts.push(newOption);

await query('UPDATE npcs SET dialogue_tree=$1 WHERE id=$2', [JSON.stringify(tree), NPC_ID]);
console.log('[add-fence-air-unlock] Added bm_air_offer/bm_air_confirmed/bm_air_already + the bm_menu option.');
process.exit(0);
