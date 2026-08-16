// Tablet OS — Deadhead. The CB, as a window.
//
// It is the Chat app pointed at one conversation, and that is the whole implementation: CB traffic
// is already a chat conversation (client/game/js/panels/cb-radio.js registers it through
// whisper.js's registerLocalChannel), so this app needs no server state, no payload and no
// rendering of its own — `view: 'chat'` hands it to the renderer that already draws tabs, unread
// pips, scrollback and a send box.
//
// WHY IT IS ITS OWN TILE AT ALL. A driver looking for the radio looks for the radio. Making them
// find Chat and then find the right tab is the kind of navigation that reads as an oversight, and
// the tile is also the only thing on the Home screen that tells somebody who has never driven that
// the radio exists. `visible` keeps it off the screen for everybody else: an app that opens onto a
// channel you cannot hear or answer is worse than no app.
//
// The name is trucker slang for running empty — which is when you have the most time to talk.
import { registerTabletApp } from './registry.js';

async function buildScreen() {
  return { view: 'chat' };
}

registerTabletApp({
  id: 'deadhead', name: 'Deadhead', icon: '📻', category: 'Social',
  // The verbs a player at the `log` rung can type to do this app's job without the screen. `cb`
  // alone is the status line and the four controls; `cb <words>` is the app's entire purpose.
  verbs: ['cb'],
  // Only while there is a set to listen to. The tablet's own live player object carries the RAM
  // flag the cab writes at mount (state.js mountRig), which is the same flag the engine's own
  // "can an enemy swing at this player" check reads — one truth about being in a cab, not two.
  visible: (player) => !!player?._inCab,
  buildScreen,
});
