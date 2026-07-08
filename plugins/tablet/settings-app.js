// Tablet OS — Settings app. Scoped to Tablet-relevant settings only (not the
// full game settings panel — density/motion/audio/etc. aren't Tablet's
// business). The only thing Tablet's own look depends on is the shared UI
// theme (--accent/--bg/--bg2), so this screen is a theme picker: entirely
// client-side, reads/writes the existing `architect_settings` localStorage
// key the rest of the client already uses (client/game/js/panels/
// tablet-os.js renders it natively — no server-authoritative state here).
import { registerTabletApp } from './registry.js';

async function buildScreen() {
  return { view: 'tablet_settings', breadcrumb: [], actions: [] };
}

registerTabletApp({
  id: 'settings', name: 'Settings', icon: '⚙', category: 'System',
  buildScreen,
});
