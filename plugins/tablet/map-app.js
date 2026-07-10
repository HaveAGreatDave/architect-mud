// Tablet OS — Map app. A tablet-native version of the full-screen city map
// ("bigmap"): the same three zoom levels (interior / zone / regional) plus GPS
// route plotting and auto-walk, rendered inside the CRT shell instead of the
// popup. It reuses buildMapPayload (server/engine/commands/movement.js) so the
// tiles are identical to what the `map` command feeds the popup — one source of
// truth. The client (panels/tablet-os.js renderMap) does the GPS routing over
// those tiles using the popup's own route machinery.
import { registerTabletApp } from './registry.js';
import { buildMapPayload } from '../../server/engine/commands/movement.js';

registerTabletApp({
  id: 'map',
  name: 'Map',
  icon: '🗺',
  category: 'General',
  // screenId carries the requested mode (interior|zone|regional); null = default
  // (interior when inside a building, otherwise zone — same rule as bare `map`).
  buildScreen(player, screenId /* mode */) {
    return { view: 'map', ...buildMapPayload(player, screenId || '') };
  },
});
