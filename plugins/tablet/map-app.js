// Tablet OS — Map app. A tablet-native version of the full-screen city map
// ("bigmap"): one continuous zoom axis (interior → local street → wider → region,
// the server's MAP_ZOOM_HALVES ladder) plus GPS route plotting and auto-walk,
// rendered inside the CRT shell instead of the popup. It reuses buildMapPayload
// (server/engine/commands/movement.js) so the tiles are identical to what the `map`
// command feeds the popup — one source of truth. The client (panels/tablet-os.js
// renderMap) does the GPS routing over those tiles using the popup's route machinery.
import { registerTabletApp } from './registry.js';
import { buildMapPayload } from '../../server/engine/commands/movement.js';
import { getZone, world } from '../../server/engine/world.js';
import { getHUDPayload } from '../../server/engine/environment.js';

// ── Home widget: where you are ───────────────────────────────────────────────
// The most useful thing a new player can be told, and the question a text game
// asks you to hold in your head constantly: where am I, what is this place, is it
// dark, is it raining on me. All of it off the in-memory zone row and the HUD
// snapshot — no query — so it's affordable on the home screen (see the buildWidget
// contract in index.js).
function buildWidget(player) {
  const z = getZone(player.current_zone);
  if (!z) return null;
  const f = z.flags || {};
  const hud = getHUDPayload() || {};
  const region = f.region_id ? world.regions.get(f.region_id)?.name : null;
  const inside = !!f.is_interior;
  // Terrain is the ground-surface SSOT (docs/systems-terrain.md); underfoot is
  // worth a beginner knowing, because it's what the pacing and the map read from.
  const where = [region, inside ? 'indoors' : f.terrain || 'outdoors'].filter(Boolean).join(' · ');
  // The glyph does the talking: a roof if you're under one, otherwise whatever the
  // sky is currently doing to you. Reads before the words do.
  const icon = inside ? '⌂' : (hud.currentWeatherIcon || hud.weatherIcon || '☼');
  return {
    id: 'place',
    title: 'Where you are',
    kind: 'lines',
    icon,
    lines: [
      { text: z.name || player.current_zone, sub: hud.time || '' },
      { text: where || '—', sub: inside ? 'sheltered' : `${hud.currentWeatherType || ''}`.trim() },
    ],
  };
}

registerTabletApp({
  id: 'map',
  name: 'Map',
  icon: '🗺',
  category: 'General',
  verbs: ['map', 'gps'],
  buildWidget,
  // screenId carries the requested zoom arg (interior | z<n> | regional); null =
  // default (interior when inside a building, otherwise z0 — same rule as bare `map`).
  buildScreen(player, screenId /* zoom arg */) {
    return { view: 'map', ...buildMapPayload(player, screenId || '') };
  },
});
