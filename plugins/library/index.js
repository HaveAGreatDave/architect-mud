/**
 * Library — the acquisition point for the tablet's Library app.
 *
 * The books themselves live in the `books` table and are read through
 * plugins/tablet/library-app.js. This plugin exists for one reason: to make the
 * app ARRIVE rather than simply be there. A tablet that ships pre-loaded with
 * eight novels is a menu item; a tablet that grows a Library app the first time
 * you put it in a brass slot in the back of the Hall of Records is a thing that
 * happened to you.
 *
 * So the app is hidden behind a player flag (library-app.js `visible`), and this
 * is the only thing that sets it. Nothing else changes: the books were always
 * there, the shelf was always full, and the moment you scan one the whole
 * catalogue opens at once — Marrowby is not a man who rations.
 *
 * Leaf plugin. No table, no tick. One flag, one verb, one hook.
 */
import { getZoneFurniture } from '../../server/engine/world.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { sendToPlayer, teachVerb, pointAt } from '../../server/engine/messaging.js';
import { hasTag } from '../../server/engine/tags.js';
import { UNLOCK_FLAG } from '../tablet/library-app.js';

// Any furniture tagged `lending_terminal` — the tag is the contract, so a second
// library elsewhere needs no code.
function terminalHere(zoneId) {
  return getZoneFurniture(zoneId).find(f => hasTag(f, 'lending_terminal')) || null;
}

// The reveal. Deliberately explains the FEATURES, not just the fact — a player
// who doesn't know it narrates and glosses will use it once and forget it.
function introText() {
  return [
    `<span class="ambient">The slot takes your tablet with a clunk that sounds older than the building. A progress bar crawls. Then, all at once, the whole catalogue.</span>`,
    ``,
    `<b>LIBRARY</b> is now on your tablet.`,
    `  <span class="text-dim">·</span> Every book on these shelves, in full — not extracts.`,
    `  <span class="text-dim">·</span> <b>Read Aloud</b> narrates a chapter to you, highlighting each line as it speaks.`,
    `  <span class="text-dim">·</span> <b>Minimize</b> keeps it reading while you go and do something else.`,
    `  <span class="text-dim">·</span> Old words are <b>underlined</b> — tap one for a plain-English gloss.`,
    `  <span class="text-dim">·</span> It remembers where you stopped, in every book, separately.`,
    ``,
    `<span class="ambient">Marrowby does not look up. "It's not lending if it comes back the same night. Take your time."</span>`,
  ].join('\n');
}

// Grant once. Returns true only on the transition, so the intro can never
// double-fire on a second scan.
async function unlock(player) {
  if (await getFlag('player', UNLOCK_FLAG, player)) return false;
  await setFlag('player', UNLOCK_FLAG, 'true', player);
  return true;
}

async function cmdScan(args, raw, player) {
  const term = terminalHere(player.current_zone);
  // Undefined = fall through, so `scan` stays available to anything else that
  // wants the verb somewhere there is no terminal.
  if (!term) return undefined;

  if (await unlock(player)) {
    return { type: 'output', message: introText(), refresh: true };
  }
  return {
    type: 'output',
    message: `<span class="ambient">The slot takes the tablet, thinks about it, and hands it back. Everything here is already on there.</span>\n<span class="text-dim">Open the LIBRARY app to read.</span>`,
  };
}

// Examining the terminal is the discovery path — it tells you the verb exists,
// once, using the house shimmer convention (docs: teachVerb + pointAt).
async function onFurnitureDescribe(furniture, player) {
  if (!furniture?.flags?.lending_terminal) return undefined;
  if (await getFlag('player', UNLOCK_FLAG, player)) return undefined;
  pointAt(player.id, 'examine', furniture.name);
  return `<span class="ambient">There is a tablet-shaped slot in the top, worn bright. ${teachVerb('scan', 'scan')} it and the terminal installs the <b>LIBRARY</b> app on your tablet — every book on these shelves, yours to read anywhere.</span>`;
}

export const specializedActions = [
  { verb: 'scan', requiredTag: 'lending_terminal', handler: cmdScan },
];

export const hooks = {
  'furniture.describe': onFurnitureDescribe,
};

export const _test = { introText, terminalHere, UNLOCK_FLAG };

console.log('[library] Plugin loaded.');
