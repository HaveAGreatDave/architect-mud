// Tablet OS — Settings app. The full game settings surface, rendered natively
// in the Tablet (theme + contrast, font/display/layout/motion/weather/temp/
// D-Pad, poker felt, and audio), plus the Tablet's own theme link/unlink
// "locker". Entirely client-side: it reads/writes the existing
// `architect_settings` localStorage key via client/shared/settings.js, so the
// Tablet and the legacy settings panel stay in sync while both exist
// (client/game/js/panels/tablet-os.js renders it — no server-authoritative
// state here; this screen just signals the view).
import { registerTabletApp } from './registry.js';

async function buildScreen() {
  return { view: 'tablet_settings', breadcrumb: [], actions: [] };
}

registerTabletApp({
  id: 'settings', name: 'Settings', icon: '⚙', category: 'System',
  buildScreen,
});
