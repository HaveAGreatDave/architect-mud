// NAMETAGS ON THE STREET, ON FOOT (freelook-view.js). A small name over the head of everybody nearby the server has
// named for you (`here`, plugins/freelook hereFor), so you can see who's who before you walk up. The figure is where
// GLASS drew them (streetActorSpots); who they are is only ever the server's list. A click on a tag holds the card on
// them, the same card a click on the figure gives, with Talk on it.
//
// Placed by bearing and elevation off the free camera (yaw degrees, pitch radians, z in tiles like x and y), the way
// streetClick reads a click, so it needs no matrix from GLASS and works with no room drawn.
import { loadCss, escapeHtml as esc } from '../../../shared/dom.js';
import { m2t as m2tf } from '../../../shared/world-scale.js';

const CSS = await loadCss(new URL('./street-tags.css', import.meta.url));

export const STREET_TAGS = { reachM: 14, aboveEyeM: 0.5, max: 8 };

// `root` the view's root, `pick(t)` called with a street token when its tag is clicked.
export function createStreetTags(root, pick) {
  if (CSS && !document.getElementById('street-tags-css')) {
    const s = document.createElement('style'); s.id = 'street-tags-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  const layer = document.createElement('div');
  layer.className = 'st-tags';
  root.appendChild(layer);
  const tags = new Map();   // token -> element
  layer.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.st-tag');
    if (!el) return;
    e.stopPropagation(); e.preventDefault();
    pick(el.dataset.t);
  });
  const drop = (t) => { tags.get(t)?.remove(); tags.delete(t); };
  return {
    // `here` Map token -> { n, npc }, `spots` [{ t, x, y }] absolute tiles, `eye` { x, y, z, yaw, pitch } absolute
    // tiles, `focal` px, `active` the token the card is on (or null)
    tick(here, spots, eye, focal, active) {
      const W = root.clientWidth, H = root.clientHeight, keep = new Set();
      if (here?.size && eye && W && H && focal > 0) {
        const yaw = eye.yaw * Math.PI / 180, fx = Math.sin(yaw), fy = -Math.cos(yaw), reach = m2tf(STREET_TAGS.reachM), up = m2tf(STREET_TAGS.aboveEyeM);
        const near = [];
        for (const q of spots) {
          const who = here.get(q.t);
          if (!who) continue;
          const dx = q.x - eye.x, dy = q.y - eye.y, d = Math.hypot(dx, dy);
          if (d > reach || d < 1e-4) continue;
          const ahead = dx * fx + dy * fy;
          if (ahead <= d * 0.2) continue;   // behind or off to the side
          near.push({ q, who, d, ahead, side: dx * -fy + dy * fx });
        }
        near.sort((a, b) => a.d - b.d);
        for (const { q, who, d, ahead, side } of near.slice(0, STREET_TAGS.max)) {
          const sx = W / 2 + focal * (side / ahead);
          const el = Math.atan2(up, d) - (eye.pitch || 0);
          if (Math.abs(el) > 1.3) continue;
          const sy = H / 2 - focal * Math.tan(el);
          if (sx < -40 || sx > W + 40 || sy < -20 || sy > H + 20) continue;
          let tag = tags.get(q.t);
          if (!tag) {
            tag = document.createElement('div');
            tag.className = 'st-tag'; tag.dataset.t = q.t;
            layer.appendChild(tag); tags.set(q.t, tag);
          }
          if (tag.dataset.n !== who.n) { tag.dataset.n = who.n; tag.innerHTML = esc(String(who.n)); }
          tag.classList.toggle('on', q.t === active);
          tag.classList.toggle('npc', !!who.npc);
          tag.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
          tag.style.opacity = String(Math.max(0.35, Math.min(1, 1.25 - d / reach)));
          keep.add(q.t);
        }
      }
      for (const t of [...tags.keys()]) if (!keep.has(t)) drop(t);
    },
    clear() { for (const t of [...tags.keys()]) drop(t); },
    dispose() { this.clear(); layer.remove(); },
  };
}
