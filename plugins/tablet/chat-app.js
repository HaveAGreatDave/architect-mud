// Tablet OS — Chat app. The chat conversations (channels like your corp's
// #<corp name>, #arcnet, and open PMs) are entirely client-side state owned by
// client/game/js/panels/whisper.js — the floating chat window. This app is just
// a Home-screen tile + a `view: 'chat'` marker; the tablet client renders the
// conversations natively from whisper.js's exported chat API (getChatTabs /
// getChatMessages / sendChatMessage / onChatUpdate). No server chat data here.
import { registerTabletApp } from './registry.js';

async function buildScreen() {
  return { view: 'chat' };
}

registerTabletApp({
  id: 'chat', name: 'Chat', icon: '💬', category: 'Social',
  buildScreen,
});
