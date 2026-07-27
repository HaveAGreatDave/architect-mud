// CODEX — section registry.
//
// The CODEX app is a shelf, not a screen. Each SECTION is one volume on that
// shelf, and sections are deliberately typed rather than uniform, because they
// don't render alike: a lore volume is a reader (chapter rail + prose column),
// the orders volume is the existing alignment instrument (compass charts, rep
// ladders, live data). One app, several kinds of thing, exactly like the tablet
// itself is one shell over many apps.
//
// Section shape:
//   id        slug, used as the tabletnav screenId
//   kind      how the CLIENT renders it: 'chapters' | 'orders'
//   title     shelf title
//   subtitle  one line under it on the shelf
//   glyph     a single character for the shelf tile (the app's own icon is SVG)
//   order     sort key on the shelf, ascending
//   build     async (player) -> payload merged into the screen when opened
//   summary   optional async (player) -> { line, progress: {have,total} } for the
//             shelf tile, so the shelf can show "6 of 15 recovered" without the
//             section having to be opened
//
// Registered here rather than through registerTabletApp so that a future volume
// (a bestiary, a gazetteer, a corp registry) is one call and no client surgery —
// as long as it reuses one of the existing kinds.
const sections = [];

export function registerCodexSection(def) {
  if (!def?.id || typeof def.build !== 'function') {
    throw new Error('registerCodexSection requires { id, build }');
  }
  if (sections.some(s => s.id === def.id)) return; // idempotent, like registerTabletApp
  sections.push({ order: 100, kind: 'chapters', glyph: '◆', ...def });
  sections.sort((a, b) => a.order - b.order);
}

export function getCodexSections() { return sections; }
export function findCodexSection(id) { return sections.find(s => s.id === id) || null; }
