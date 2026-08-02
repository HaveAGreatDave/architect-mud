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
import { prefersTextDisplay } from '../../server/engine/presentation.js';

async function buildScreen(player) {
  return {
    view: 'tablet_settings',
    breadcrumb: [],
    actions: [],
    // undefined (never chosen) renders as Visual — the default a graphical
    // client gets — while staying unset on the server so a text felt can still
    // open in text for someone who hasn't decided.
    textDisplay: (await prefersTextDisplay(player)) === true,
  };
}

registerTabletApp({
  id: 'settings', name: 'Settings', icon: '⚙', category: 'System',
  buildScreen,
});
