// CODEX — chapter unlock state.
//
// One player flag per chapter (`codex_ch_<id>`), because that is exactly what the
// flag store is for: sparse, per-player, boolean, never read on a hot path. No
// new table, no new `players` column (CLAUDE.md).
//
// Three ways a chapter opens:
//   1. grantVolume()      — the prologue hands over Volume I whole, since the
//                           player just watched the cinematic cut of it;
//   2. world events       — a handful of ordinary engine events (see index.js of
//                           this folder) that prove the player has met the thing
//                           the chapter is about;
//   3. CODEX_UNLOCK       — a registered action, so any VINE dialogue/script node
//                           can hand a chapter over when an NPC explains it.
//
// Reads are batched: openings are only ever fetched when the app is opened or a
// chapter is read, never per tick or per move.
import { getFlag, setFlag } from '../../../server/engine/flags.js';
import { sendToPlayer } from '../../../server/engine/messaging.js';
import { CHAPTERS, chapterById, chaptersInVolume } from './chapters.js';

export const chapterFlag = (id) => `codex_ch_${id}`;

export async function isChapterUnlocked(player, id) {
  const ch = chapterById(id);
  if (!ch) return false;
  if (!ch.locked) return true; // Volume I and anything else authored open
  return (await getFlag('player', chapterFlag(id), player)) === 'true';
}

/**
 * Every chapter's unlocked state in one pass. getFlag is per-key, so this is N
 * reads — but N is the size of the corpus (~15) and it only runs when the player
 * opens the app. Locked-by-default chapters are the only ones that need asking.
 */
export async function unlockedSet(player) {
  const out = new Set(CHAPTERS.filter(c => !c.locked).map(c => c.id));
  const gated = CHAPTERS.filter(c => c.locked);
  const vals = await Promise.all(gated.map(c => getFlag('player', chapterFlag(c.id), player)));
  gated.forEach((c, i) => { if (vals[i] === 'true') out.add(c.id); });
  return out;
}

/**
 * Open one chapter. Idempotent, and silent when it was already open — an NPC who
 * explains the same thing twice must not print the discovery line twice.
 * Returns true only on the transition.
 */
export async function unlockChapter(player, id, { quiet = false } = {}) {
  const ch = chapterById(id);
  if (!ch || !player?.id) return false;
  if (!ch.locked) return false;
  if ((await getFlag('player', chapterFlag(id), player)) === 'true') return false;
  await setFlag('player', chapterFlag(id), 'true', player);
  if (!quiet) {
    sendToPlayer(player.id, {
      type: 'output',
      message: `<span class="ip-gain">◈ CODEX — a new entry writes itself into your tablet: <b>${ch.title}</b>.</span> <span class="hint">(read it with <b>codex</b>)</span>`,
    });
  }
  return true;
}

/** Hand over a whole volume (the prologue does this for Volume I). */
export async function grantVolume(player, volumeId, opts = {}) {
  for (const ch of chaptersInVolume(volumeId)) await unlockChapter(player, ch.id, { quiet: true, ...opts });
}
