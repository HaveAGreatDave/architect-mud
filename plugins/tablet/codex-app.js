// Tablet OS — CODEX.
//
// The tablet's reference shelf: what the world is, and where you stand in it.
// Replaces the old standalone "Ideology" app — that reader is now the CODEX's
// Orders section, unchanged, sitting beside the lore volumes (see
// codex/sections.js for why sections are typed rather than uniform).
//
// Everything rides in one payload per section; the client pages through it, so
// opening a volume is a single fetch, not a round trip per chapter.
import { on } from '../../server/engine/events.js';
import { getLivePlayer } from '../../server/engine/world.js';
import { getFlag } from '../../server/engine/flags.js';
import { registerAction } from '../../server/engine/actions.js';
import { registerTabletApp } from './registry.js';
import { getCodexSections, findCodexSection } from './codex/sections.js';
import { unlockChapter } from './codex/unlocks.js';
import { CHAPTERS } from './codex/chapters.js';
import './codex/section-chapters.js';   // registers 'quiet' + 'basin'
import './codex/section-orders.js';     // registers 'orders'

export { unlockChapter, grantVolume } from './codex/unlocks.js';

// ── Derived unlocks ──────────────────────────────────────────────────────────
// Some chapters are about a thing the player is *already doing*, and gating those
// behind a specific NPC would mean a player who took the machine path from a
// vending-machine argument never gets the chapter about the machine path. So the
// alignment-driven entries are derived from the stance/path flags, evaluated when
// the app is opened — a cold path, no tick, no hot-path read.
const DERIVED = [
  { id: 'answers', test: (s, p) => Math.abs(s) >= 20 || Object.values(p).some(v => v >= 20) },
  { id: 'chrome',  test: (s, p) => p.machine >= 30 },
  { id: 'flesh',   test: (s, p) => p.flesh >= 30 },
  { id: 'mind',    test: (s, p) => p.mind >= 30 },
];

async function syncDerivedUnlocks(player) {
  const stance = Number(await getFlag('player', 'stance_axis', player)) || 0;
  const paths = {};
  for (const p of ['machine', 'flesh', 'mind', 'human']) {
    paths[p] = Number(await getFlag('player', `path_${p}`, player)) || 0;
  }
  for (const d of DERIVED) {
    if (d.test(stance, paths)) await unlockChapter(player, d.id, { quiet: true });
  }
}

// ── World triggers ───────────────────────────────────────────────────────────
// Deliberately few and all cheap: each hangs off an event the engine already
// emits, and does nothing at all once the chapter is open (unlockChapter
// short-circuits on the flag).

// The Inheritance — you bought something from a company that has no headquarters.
on('vendor.purchase', async ({ player }) => {
  const live = player?.id ? getLivePlayer(player.id) : null;
  if (live) await unlockChapter(live, 'inheritance');
});

// What It Wants — standing inside pre-Quiet infrastructure that is still running
// with nobody left to run it. The Under's conduit vault and machine sump are
// exactly the detail story.md points at: not a mystery to solve, just something
// humming long after its reason died.
const WANTS_ZONES = new Set(['zone_under_conduitvlt', 'zone_under_machsump']);
on('zone.entered', async ({ actor, zone }) => {
  if (actor?.id && WANTS_ZONES.has(zone)) await unlockChapter(actor, 'wants');
});

// ── CODEX_UNLOCK — the authoring seam ────────────────────────────────────────
// So an NPC who explains a piece of the world can hand over the chapter about it,
// from a VINE dialogue option or script node, with no code change.
registerAction({
  type: 'CODEX_UNLOCK',
  handler: async ({ actor, params }) => {
    if (!actor?.id) return { type: 'error', message: 'CODEX_UNLOCK requires an actor.' };
    const id = params.chapter || params.chapter_id || params.id;
    if (!CHAPTERS.some(c => c.id === id)) {
      return { type: 'error', message: `CODEX_UNLOCK: unknown chapter "${id}".` };
    }
    const opened = await unlockChapter(actor, id, { quiet: params.quiet === true || params.quiet === 'true' });
    return { type: 'codex', chapter: id, opened };
  },
});

// ── The app ──────────────────────────────────────────────────────────────────

async function buildScreen(player, screenId) {
  await syncDerivedUnlocks(player);

  const sections = [];
  for (const s of getCodexSections()) {
    let extra = null;
    if (typeof s.summary === 'function') { try { extra = await s.summary(player); } catch { extra = null; } }
    sections.push({ id: s.id, kind: s.kind, title: s.title, subtitle: s.subtitle, glyph: s.glyph, ...(extra || {}) });
  }

  const section = screenId ? findCodexSection(screenId) : null;
  if (!section) return { view: 'codex', breadcrumb: [], section: null, sections };

  const payload = await section.build(player);
  return {
    view: 'codex',
    breadcrumb: [section.title],
    section: section.id, sectionKind: section.kind, sectionTitle: section.title,
    sections,
    ...payload,
  };
}

registerTabletApp({
  id: 'codex', name: 'Codex', icon: '◈', category: 'Reference',
  verbs: ['codex'],
  buildScreen,
});
