// Tablet OS — Map app. A tablet-native version of the full-screen city map
// ("bigmap"): one continuous zoom axis (interior → local street → wider → region,
// the server's MAP_ZOOM_HALVES ladder) plus GPS route plotting and auto-walk,
// rendered inside the CRT shell instead of the popup. It reuses buildMapPayload
// (server/engine/commands/movement.js) so the tiles are identical to what the `map`
// command feeds the popup — one source of truth. The client (panels/tablet-os.js
// renderMap) does the GPS routing over those tiles using the popup's route machinery.
import { registerTabletApp } from './registry.js';
import { buildMapPayload } from '../../server/engine/commands/movement.js';

registerTabletApp({
  id: 'map',
  name: 'Map',
  icon: '🗺',
  category: 'General',
  // screenId carries the requested zoom arg (interior | z<n> | regional); null =
  // default (interior when inside a building, otherwise z0 — same rule as bare `map`).
  buildScreen(player, screenId /* zoom arg */) {
    return { view: 'map', ...buildMapPayload(player, screenId || '') };
  },
});
