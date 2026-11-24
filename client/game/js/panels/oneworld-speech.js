// WHAT PEOPLE SAY IN A ROOM WALKED IN GLASS (one-world-interiors.md, phase C): the Room Stage's speech, ported.
// npc-bubbles.js sends the same three events it sends the Stage, and this answers them for the room you're in:
//   `npc:speaking`  the line goes over the speaker's head (and `over` is set, so the bottom bubble isn't shown too),
//                   and they stand on the talk clip while it lasts (`clipOf`)
//   `npc:place`     their sex, and where their head is on the room's plan, the frame oneworld-sound.js poses the ear in
//   `npc:voice`     the line's handle, kept on them while they walk (`tick`)
// Nothing here decides anything; who's where is oneworld-people.js placePeople, as the Stage's placeOf.

import { loadCss, escapeHtml as esc } from '../../../shared/dom.js';
import { placePeople } from './oneworld-people.js';
import { token as personToken } from '../../../shared/person-token.js';
import { m2t } from '../../../shared/world-scale.js';

const CSS = await loadCss(new URL('./oneworld-speech.css', import.meta.url));
const HEAD_Z = { stand: 1.6, sit: 1.15, lie: 0.45 }, VOICE_AT = { ref: 1.5, rolloff: 0.6 };
const OVER_M = 2.0, OVER_SIT_M = 1.55;   // where the line's tail points, above the head

// `get()` is the view's state for the room you're walking ({ inside, root, ... }) or null; `project(x, y, z)` puts an
// absolute GLASS point on the root's box in px, or null behind the eye; `eared()` whether the room's ear is posed.
export function createOneWorldSpeech({ get, project, eared }) {
  const talking = new Map();   // name -> { until, text }
  const voiced = new Map();    // a live line's handle -> its speaker's name
  let inView = new Set(), layer = null, html = '';

  const roomOf = () => { const s = get(); return s?.inside?.room?.L ? s : null; };
  const personOf = (I, name) => (I.people || []).find((p) => p.id !== I.you && p.name === name);
  function headOf(I, name) {
    const p = personOf(I, name);
    if (!p) return null;
    const q = placePeople(I.room.L, I.people, I.you).find((r) => r.p.id === p.id);
    if (!q?.at) return null;
    const head = q.pose === 'lie' && q.head ? q.head : [0, 0];
    return [q.at[0] + head[0], q.at[1] + head[1], (HEAD_Z[q.pose] ?? HEAD_Z.stand) + (q.pose === 'sit' ? q.lift || 0 : 0)];
  }

  const onSpeaking = (e) => {
    const d = e.detail, s = roomOf();
    if (!d || !s || !personOf(s.inside, d.name)) return;
    talking.set(d.name, { until: performance.now() + d.ms, text: d.text });
    if (inView.has(d.name)) d.over = true;
  };
  const onPlace = (e) => {
    const d = e.detail, s = roomOf();
    if (!d || !s) return;
    const p = personOf(s.inside, d.name);
    if (!p) return;
    if (!d.sex && p.sex) d.sex = p.sex;
    if (d.place || !eared()) return;
    const at = headOf(s.inside, d.name);
    if (at) d.place = { position: at, ...VOICE_AT };
  };
  const onVoice = (e) => { const d = e.detail; if (d?.voice?.move && roomOf() && personOf(roomOf().inside, d.name)) voiced.set(d.voice, d.name); };
  window.addEventListener('npc:speaking', onSpeaking);
  window.addEventListener('npc:place', onPlace);
  window.addEventListener('npc:voice', onVoice);

  function draw(s, recs, now) {
    const I = s.inside;
    if (!layer || layer.parentNode !== s.root) {
      layer?.remove();
      layer = document.createElement('div'); layer.className = 'ow-says'; layer.setAttribute('aria-hidden', 'true');
      s.root.appendChild(layer); html = '';
    }
    const w = s.root.clientWidth, h = s.root.clientHeight, seen = new Set(), out = [];
    for (const p of I.people || []) {
      if (p.id === I.you) continue;
      const r = recs.find((q) => q.t === personToken(p.id));
      if (!r) continue;
      const at = project(r.x, r.y, r.z + m2t(r.clip === 'sit' ? OVER_SIT_M : OVER_M));
      if (!at || at.x < 0 || at.x > w || at.y < 0 || at.y > h) continue;
      seen.add(p.name);
      const line = talking.get(p.name);
      if (!(line?.until > now)) continue;
      // kept on screen, as the Stage keeps it
      const sx = Math.max(170, Math.min(w - 170, at.x)), sy = Math.max(110, at.y);
      out.push(`<span class="ow-say" style="left:${sx.toFixed(0)}px;top:${sy.toFixed(0)}px">${esc(line.text)}</span>`);
    }
    inView = seen;
    const next = out.join('');
    if (next !== html) { html = next; layer.innerHTML = next; }
  }

  return {
    // the talk clip for somebody standing still while their line lasts (the Stage's `eased`)
    clipOf(recs, people, now) {
      if (!talking.size) return recs;
      const toks = new Set();
      for (const [name, l] of talking) {
        if (l.until <= now) { talking.delete(name); continue; }
        const p = (people || []).find((q) => q.name === name);
        if (p) toks.add(personToken(p.id));
      }
      return toks.size ? recs.map((r) => (toks.has(r.t) && r.clip !== 'walk' && r.clip !== 'sit' ? { ...r, clip: 'talk' } : r)) : recs;
    },
    // once a frame while you're inside: the lines over heads and the voices kept on their speakers
    tick(recs, now) {
      const s = roomOf();
      if (!s) { this.clear(); return; }
      draw(s, recs || [], now);
      for (const [v, name] of voiced) {
        if (v.state?.()?.closed) { voiced.delete(v); continue; }
        const at = headOf(s.inside, name);
        if (at) v.move(at);
      }
    },
    clear() { talking.clear(); voiced.clear(); inView = new Set(); if (layer) { layer.remove(); layer = null; html = ''; } },
  };
}
