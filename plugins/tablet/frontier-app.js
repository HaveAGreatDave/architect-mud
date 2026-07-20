// Tablet OS — Frontier app. The abstract topology of the void-travel frontier:
// the regions and void-routes you've CHARTED (seen a gate) or SURVIVED (crossed).
// Fogged — what you haven't seen isn't on it. Reads frontierView from the
// voidwalking plugin (which owns the discovery state), same as corp-app fronts
// corps. You can't draw the void to scale, so this is a topology list, not the grid.
//
// Two tabs make it a one-stop void console: Routes (this topology) and Map (the live
// void survey — the same crossing map the standalone Map app shows, reused via
// buildMapPayload so there's one source of truth. It's only real while you're out on
// a crossing; on the grid the tab explains itself).
import { registerTabletApp, normScreen } from './registry.js';
import { buildMapPayload } from '../../server/engine/commands/movement.js';

const TABS = [{ id: 'routes', label: 'Routes' }, { id: 'map', label: 'Map' }];

function routesScreen(regions, activeTab) {
  const origins = Object.entries(regions);
  if (!origins.length) {
    return {
      view: 'detail', breadcrumb: [], tabs: TABS, activeTab,
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
    view: 'detail', breadcrumb: [], tabs: TABS, activeTab,
    detail: {
      name: 'The Frontier',
      desc: 'The regions and void-routes you know. Charted means you\'ve read the gate; survived means you\'ve crossed it on foot and lived. What isn\'t here, you haven\'t seen.',
      rows,
    },
    actions: [],
  };
}

async function buildScreen(player, screenId) {
  const { frontierView } = await import('../voidwalking/index.js');

  if (normScreen(screenId) === 'map') {
    // The live void survey. buildMapPayload returns mode:'crossing' with the trail
    // nodes while you're out on a crossing; the client (renderJourneyMap) draws the
    // big zoomable route from that. On the grid there's no void to survey, so say so
    // rather than dropping the city map into a void-travel console.
    const map = buildMapPayload(player, '');
    if (map.mode === 'crossing') {
      return { view: 'map', breadcrumb: [], tabs: TABS, activeTab: 'map', ...map };
    }
    return {
      view: 'detail', breadcrumb: [], tabs: TABS, activeTab: 'map',
      detail: {
        name: 'Void Survey',
        desc: 'You\'re on the grid. The void survey only exists while you\'re crossing the waste on foot — strike out through a perimeter gate and the trail will chart itself here as you go.',
        rows: [],
      },
      actions: [],
    };
  }

  const regions = await frontierView(player);
  return routesScreen(regions, 'routes');
}

registerTabletApp({
  id: 'frontier', name: 'Frontier', icon: '🧭', category: 'Navigation',
  buildScreen,
});
