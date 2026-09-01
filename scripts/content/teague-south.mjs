/**
 * Teague gets a position on the Wildblood, and the Watch finally has one.
 *
 * WHY THIS EXISTS. Rennick's `terms` node has been carrying half an argument on
 * its own: "You come as you were made. No steel in you, nothing growing that
 * should not be. Not because we are better than the ones who did it, though I
 * will not pretend some here do not think so." That last clause points at
 * somebody, and until now it pointed at nobody — the Long Watch never named the
 * Wildblood anywhere in the game. The correction existed without the thing it
 * corrects.
 *
 * WHY TEAGUE. Because a bigot is easy to dismiss and a veteran is not. Her
 * `clean` node already implies she has spent years exterminating something in
 * these tunnels and declines to say what: "Things that breed down here breed
 * toward the warm. Somebody decided a while back that they were not going to
 * breed toward this particular warm." Her position on a town of mutants is
 * already latent in that, and it is *earned*, which is what makes it hard.
 *
 * THE RULE IT IS BUILT ON (docs/reference/plain-writing.md, corrected 2026-08-25):
 * foreign-as-nightmare belongs in a mouth, never in the narration. What is wrong
 * with De Quincey is not the device, it is that he believes it. So:
 *
 *   - She is never described as wrong. Nothing in the prose takes Rennick's side.
 *   - She is given something she is genuinely right about, and it is the last
 *     thing she says: nobody who corrects her has ever answered her actual
 *     question. London's rule — give the enemy a sincere ethic and never let
 *     them doubt it.
 *   - The correction is a walk south, and the player can take it. Per
 *     proposals/scarletwastes.md the inside is domestic and nothing ever remarks
 *     on the difference, so a player who only ever listens to the orders keeps
 *     the nightmare and a player who goes gets a town. Neither is announced and
 *     ⚠ neither is rewarded.
 *
 * ⚠ No em dashes. Teague is Long Watch.
 *
 *   node scripts/content/teague-south.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const FILE = path.join(process.cwd(), 'content', 'npcs', 'npc_lw_teague.json');
const CHECK = process.argv.includes('--check');
const DASH = /[—–]/;

const NODE_KEY = 'south';

const NODE = {
  text:
    "She does not answer straight away.\n\n" +
    "\"Eleven years I have been down here. In that time I have put down a bit over four hundred things that used to be something else, and not once have I had to stop and work out which was which. You know on sight. That is the whole of my expertise and it has never been wrong.\"\n\n" +
    "She adjusts the sling.\n\n" +
    "\"So somebody tells me there is a town of them out past the Curtain. Wall round it. A gate. Children in it, they say.\"\n\n" +
    "A beat.\n\n" +
    "\"What I hear is a nest that has learned to keep house.\"\n\n" +
    // ⚠ No stage direction here. The first draft had "she looks at you
    // properly", which is Pike's gesture, and the second had "she stops moving,
    // which she has not done once since you got here" — and her `root` node has
    // her step into your light and stop. "I know how that sounds" already
    // carries that she has registered your face; anything in front of it is the
    // writer adding weight the line does not need.
    "\"I know how that sounds. Rennick has explained it to me at length, twice. He is a better man than I am and I still think he is wrong.\"\n\n" +
    "She starts walking.\n\n" +
    "\"Go south if you like. They all come back telling me I have it wrong. Not one of them has ever told me what I was supposed to have done with the four hundred.\"",
  options: [
    { label: 'They have children.', next: 'south_children' },
    { label: 'Nothing.', next: 'bye' },
  ],
};

// One follow-up, because the flat refusal is worth more than the speech. She
// does not soften, she does not escalate, and she does not answer.
const FOLLOWUP = {
  text:
    "\"They do.\" She does not slow down. \"So did the block on Ferrier Street, and I went in there too.\"\n\n" +
    "The lantern on her belt is still unlit. She has not needed it once.\n\n" +
    "\"You want me to say the word that makes it all right. I have not got one. I have got a tunnel and a rifle and eleven years, and none of the three has ever asked me for a reason.\"",
  options: [
    { label: 'Understood.', next: 'bye' },
  ],
};

const ROOT_OPTION = {
  _src: 'lw_vigil',
  conditions: [{ flag: 'lw_member', op: 'set', scope: 'player' }],
  label: 'They say there is a town of them, south.',
  next: NODE_KEY,
};

// ─── apply ───────────────────────────────────────────────────────────────────
const problems = [];
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const tree = data.dialogue_tree || {};

for (const [k, v] of [[NODE_KEY, NODE], ['south_children', FOLLOWUP]]) {
  if (DASH.test(v.text)) problems.push(`${k}: em dash in Long Watch prose`);
  for (const o of v.options) if (!tree[o.next] && o.next !== 'south_children') problems.push(`${k}: option points at missing node "${o.next}"`);
}
if (!tree.root) problems.push('no root node');
if (!tree.bye) problems.push('no bye node to fall back to');

const already = Boolean(tree[NODE_KEY]);
tree[NODE_KEY] = NODE;
tree.south_children = FOLLOWUP;

const opts = tree.root.options || [];
const has = opts.some((o) => o.next === NODE_KEY);
if (!has) {
  // Sits above "Nothing.", which is always last.
  const i = opts.findIndex((o) => o.next === 'bye');
  opts.splice(i === -1 ? opts.length : i, 0, ROOT_OPTION);
  tree.root.options = opts;
}
data.dialogue_tree = tree;

for (const p of problems) console.error('  ! ' + p);
if (!problems.length && !CHECK) fs.writeFileSync(FILE, canonicalJson(data), 'utf8');
console.log(`${CHECK ? '[check] ' : ''}Teague: 2 node(s) ${already ? 'updated' : 'added'}, root option ${has ? 'already present' : 'added'}.`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
