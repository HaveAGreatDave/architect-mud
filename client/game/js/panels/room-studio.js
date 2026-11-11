// THE STUDIO FLOOR. A room a studio set claims (the set's `zone`, plugins/broadcast/sequences.js roomSet) is
// drawn as that set: standing on KSAB-TV's Sound Stage B, the Room Stage shows Neil's basement. It's the TV's
// live stage (tv-stage.js) laid over the room, so the room plays like the gallery's monitor: the set, whoever
// is on its floor on its marks, and a cut to whoever speaks. A show staged here is performed here, because its
// lines are said in this room; the bubbles have already voiced them (npc-bubbles.js), so this only cuts,
// moves mouths and acts out what an emote line says somebody does.
//
// The server answers `room_set` with the set and the people on it, host first while a show is on. The Room
// Stage asks again whenever somebody comes or goes, so the cast walking in for a show take their marks.

import { createTvStage } from './tv-stage.js';

export function createStudioFloor(host, { phone = false } = {}) {
  const stage = createTvStage(host, { phone, inset: '0' });
  let names = '';
  const onSpeaking = (e) => { const d = e.detail; if (d?.name && d.text) stage.player?.liveLine(d.name, d.text); };
  const onLine = (e) => { const t = e.detail?.text; if (t) stage.player?.liveAct(t); };
  const onVoice = (e) => { const d = e.detail; if (d?.name) stage.voice(d.name, d.trace, { delay: d.delay || 0 }); };
  window.addEventListener('npc:speaking', onSpeaking);
  window.addEventListener('npc:line', onLine);
  window.addEventListener('npc:voice', onVoice);
  return {
    // the server's answer; a fresh cast restarts the live stage with everyone on their marks
    show(msg) {
      const now = (msg.people || []).map((p) => p.id).join('|');
      // the same people: only where the show has put them may have changed (the host off to the star and back)
      if (now === names && stage.open) { for (const p of msg.people || []) stage.player?.liveBlock(p.name, p.to || 'seat'); return; }
      names = now;
      stage.show({ set: msg.set, people: msg.people || [], programName: msg.programName || '', broadcast: msg.zone });
    },
    // the names on the floor, to tell whether to ask again
    get cast() { return names; },
    dispose() {
      window.removeEventListener('npc:speaking', onSpeaking);
      window.removeEventListener('npc:line', onLine);
      window.removeEventListener('npc:voice', onVoice);
      stage.dispose();
    },
  };
}
