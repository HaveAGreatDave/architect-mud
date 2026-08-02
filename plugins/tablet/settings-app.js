// Tablet OS — Settings app. The full game settings surface, rendered natively
// in the Tablet (theme + contrast, font/display/layout/motion/weather/temp/
// D-Pad, poker felt, and audio), plus the Tablet's own theme link/unlink
// "locker". Almost entirely client-side: it reads/writes the existing
// `architect_settings` localStorage key via client/shared/settings.js, so the
// Tablet and the legacy settings panel stay in sync while both exist
// (client/game/js/panels/tablet-os.js renders it).
//
// The ONE exception is Display Mode (visual vs. text), which has to be server
// state — the flight plugin reads it on the server, at board time, to decide
// whether to push a graphical panel at all, and poker reads it on sit. So this
// screen ships its current value down and the client mirrors any change back
// through the silent `displaymode` command; localStorage is never its home.
import { registerTabletApp } from './registry.js';
import { displayRung } from '../../server/engine/presentation.js';

async function buildScreen(player) {
  return {
    view: 'tablet_settings',
    breadcrumb: [],
    actions: [],
    // The rung, or 'visual' for a player who has never chosen — that's what a
    // graphical client gets. It stays UNSET on the server either way, so an
    // old-school felt can still open in text for someone who hasn't decided.
    displayRung: (await displayRung(player)) || 'visual',
  };
}

registerTabletApp({
  id: 'settings', name: 'Settings', icon: '⚙', category: 'System',
  buildScreen,
});
