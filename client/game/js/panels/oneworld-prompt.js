// ONE WORLD · THE PROMPT (freelook-view.js). On foot in GLASS, a light pair of brackets ( ) round whatever F works on
// right now: the piece or person the card is on (oneworld-card.js), or the street door you're close enough to go in by.
// The first few times you meet each kind of thing, a line under the brackets says the key: "F to sit", "F to talk".
// After that only the brackets stay. The count is kept per character in the browser.
//
// It decides nothing. What it marks is what the card and footDoor already picked, and F does what it always did.
// Placed by bearing and elevation off the free camera, as the nametags are (street-tags.js).
import { loadCss } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./oneworld-prompt.css', import.meta.url));

// How many separate meetings with a kind of thing get the line, and the key it names.
export const PROMPT = { teach: 3, key: 'F' };

// What the line says for the first thing F does. Anything not here is its label, lower-cased. Pure.
const SAY = { sit: 'sit', lie: 'lie down', sleep: 'sleep', open: 'open', talk: 'talk', unlock: 'unlock', knock: 'knock', door: 'go in', watch: 'watch' };
export function promptLine(act) {
  if (!act) return '';
  const say = SAY[act.verb] || String(act.label || act.verb || '').toLowerCase();
  return say ? `${PROMPT.key} to ${say}` : '';
}
// The kind a meeting counts against: a seat is a seat whatever it's called. Pure.
export const promptKind = (act) => (act?.verb === 'lie' || act?.verb === 'sit' ? 'sit' : act?.verb || '');

const storeKey = (who) => `ow-prompt:${String(who || 'guest').toLowerCase()}`;
function readSeen(who) { try { return JSON.parse(localStorage.getItem(storeKey(who)) || '{}') || {}; } catch { return {}; } }
function writeSeen(who, seen) { try { localStorage.setItem(storeKey(who), JSON.stringify(seen)); } catch { /* storage blocked: it teaches again next time */ } }

export function createOneWorldPrompt(root) {
  if (CSS && !document.getElementById('oneworld-prompt-css')) {
    const s = document.createElement('style'); s.id = 'oneworld-prompt-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  const el = document.createElement('div');
  el.className = 'ow-prompt'; el.hidden = true;
  el.innerHTML = '<i class="ow-br ow-br-l"></i><i class="ow-br ow-br-r"></i><span class="ow-prompt-say"></span>';
  root.appendChild(el);
  const sayEl = el.querySelector('.ow-prompt-say');
  let who = null, seen = {}, meet = '', teaching = false;
  return {
    // `t` { id, act, x, y, dz } or null: x and y absolute tiles, dz the height of its middle off your eye, in tiles.
    // `eye` { x, y, yaw, pitch }, `focal` px, `me` the character's name.
    tick(t, eye, focal, me) {
      if (me !== who) { who = me; seen = readSeen(me); meet = ''; }
      const W = root.clientWidth, H = root.clientHeight;
      if (!t || !eye || !W || !H || !(focal > 0)) { el.hidden = true; meet = ''; return; }
      const yaw = eye.yaw * Math.PI / 180, fx = Math.sin(yaw), fy = -Math.cos(yaw);
      const dx = t.x - eye.x, dy = t.y - eye.y, d = Math.hypot(dx, dy), ahead = dx * fx + dy * fy;
      if (ahead <= d * 0.2 || ahead < 1e-4) { el.hidden = true; return; }
      const sx = W / 2 + focal * ((dx * -fy + dy * fx) / ahead);
      const sy = H / 2 - focal * Math.tan(Math.atan2(t.dz || 0, Math.max(d, 1e-4)) - (eye.pitch || 0));
      if (sx < 0 || sx > W || sy < 0 || sy > H) { el.hidden = true; return; }
      // a new meeting: count it against its kind, and say the key while the count is low
      const kind = promptKind(t.act);
      if (t.id !== meet) {
        meet = t.id;
        const n = seen[kind] || 0;
        teaching = !!kind && n < PROMPT.teach;
        if (teaching) { seen[kind] = n + 1; writeSeen(who, seen); }
        sayEl.textContent = teaching ? promptLine(t.act) : '';
      }
      // the brackets close in as it gets further off, never smaller than a fingertip
      const size = Math.max(28, Math.min(140, focal * (t.w || 0.06) / Math.max(d, 1e-4)));
      el.style.setProperty('--ow-size', size.toFixed(0) + 'px');
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      el.classList.toggle('teach', teaching);
      el.hidden = false;
    },
    // F was pressed on the thing it marks: that kind is learnt, so the line doesn't come back for it
    used(act) {
      const kind = promptKind(act);
      if (!kind || (seen[kind] || 0) >= PROMPT.teach) return;
      seen[kind] = PROMPT.teach; writeSeen(who, seen);
    },
    remove() { el.remove(); },
  };
}
