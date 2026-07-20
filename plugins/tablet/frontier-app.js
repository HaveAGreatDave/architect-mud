// Tablet OS — Frontier app. The abstract topology of the void-travel frontier:
// the regions and void-routes you've CHARTED (seen a gate) or SURVIVED (crossed).
// Fogged — what you haven't seen isn't on it. Reads frontierView from the
// wastecrossing plugin (which owns the discovery state), same as corp-app fronts
// corps. You can't draw the void to scale, so this is a topology list, not the grid.
import { registerTabletApp } from './registry.js';

async function buildScreen(player) {
  const { frontierView } = await import('../wastecrossing/index.js');
  const regions = await frontierView(player);
  const origins = Object.entries(regions);

  if (!origins.length) {
    return {
      view: 'detail', breadcrumb: [],
      detail: {
        name: 'The Frontier',
        desc: 'You have charted nothing yet. The waste keeps no maps — only the ones you make. Read a perimeter gate (frontier) or strike out, and the routes you find will appear here.',
        rows: [],
      },
      actions: [],
    };
  }

  const rows = [];
  for (const [origin, routes] of origins) {
    rows.push({ label: `◉ ${origin}`, value: '' });
    for (const r of routes) rows.push({ label: `   → ${r.heading}`, value: r.state === 'survived' ? '✓ survived' : '· charted' });
  }
  return {
    view: 'detail', breadcrumb: [],
    detail: {
      name: 'The Frontier',
      desc: 'The regions and void-routes you know. Charted means you\'ve read the gate; survived means you\'ve crossed it on foot and lived. What isn\'t here, you haven\'t seen.',
      rows,
    },
    actions: [],
  };
}

registerTabletApp({
  id: 'frontier', name: 'Frontier', icon: '🧭', category: 'Navigation',
  buildScreen,
});
