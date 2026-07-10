// Tablet OS — Arcade app. A self-aware novelty: a "game" on your tablet called
// ARCHITECT that boots a fake login screen and a tiny playable MUD terminal —
// with a tablet you can tap inside it, which brings up a shrunk recreation of
// this very tablet. Pure client-side theatre: buildScreen carries no server
// state beyond the player's handle (prefilled into the fake login for flavour);
// every transition (login → boot → play → mini-tablet) lives in tablet-os.js's
// `fakeplay` view. No handleAction — nothing here round-trips.
import { registerTabletApp } from './registry.js';

async function buildScreen(player) {
  return { view: 'fakeplay', handle: player.handle };
}

registerTabletApp({
  id: 'arcade', name: 'ARCHITECT', icon: '🎮', category: 'Fun',
  buildScreen,
});
