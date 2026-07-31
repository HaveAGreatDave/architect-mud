// CODEX — the lore volumes ('quiet' and 'basin'), both of kind 'chapters'.
//
// One payload carries the whole volume (like the ideology reader and the corp
// dashboard): every chapter's metadata, and the prose for the ones the player has
// actually opened. A locked chapter ships its hint and NOTHING of its body — the
// text never reaches a client that hasn't earned it, so "view source" isn't a
// walkthrough.
import { VOLUMES, chaptersInVolume } from './chapters.js';
import { unlockedSet } from './unlocks.js';
import { registerCodexSection } from './sections.js';

async function buildVolume(vol, player) {
  const open = await unlockedSet(player);
  const chapters = chaptersInVolume(vol.id).map(c => {
    const unlocked = open.has(c.id);
    return {
      id: c.id, n: c.n, title: c.title, eyebrow: c.eyebrow, lede: c.lede,
      unlocked,
      hint: unlocked ? null : (c.hint || null),
      body: unlocked ? c.body : null,
    };
  });
  return {
    note: vol.note,
    chapters,
    progress: { have: chapters.filter(c => c.unlocked).length, total: chapters.length },
  };
}

for (const [i, vol] of VOLUMES.entries()) {
  registerCodexSection({
    id: vol.id, kind: 'chapters', order: 10 + i,
    title: vol.title, subtitle: vol.subtitle, glyph: vol.glyph,
    build: (player) => buildVolume(vol, player),
    summary: async (player) => {
      const open = await unlockedSet(player);
      const all = chaptersInVolume(vol.id);
      const have = all.filter(c => open.has(c.id)).length;
      return {
        progress: { have, total: all.length },
        line: have === all.length ? 'Complete' : `${have} of ${all.length} recovered`,
      };
    },
  });
}
