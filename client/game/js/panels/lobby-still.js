// LOBBY STILLS: walking in off the street without a cut and without losing the keys.
//
// The first time the Room Stage opens a lobby from its street door, it keeps a picture of its own view from just
// inside that door (`keepStill`), by the door's tile. The next time you walk through that door, the street view lays
// the picture over the pane at once (freelook-view.js coverPane), before the server has answered, so the street
// pushes straight into the lobby, and the real room takes over from the same eye and the same framing.
//
// The keys you were holding on the street go with you (`noteCarry`, `takeCarry`): the room's walker starts with
// them held, and a key let go in between is let go here, so W held through the door keeps you walking.
//
// Kept in memory and in localStorage, a small JPEG a door. A missing or stale picture costs nothing: the old cover.

const STORE = 'lobbyStill:';
const WIDTH = 800;
const mem = new Map();
let door = null;

export const doorKey = (d) => d ? `${d.gx},${d.gy},${d.edge || ''}` : null;

// the door you're walking through now; good for a few seconds, the time a room takes to come
export function noteDoor(d) { door = d ? { key: doorKey(d), t: performance.now() } : null; }
export function currentDoor() { return door && performance.now() - door.t < 8000 ? door.key : null; }
export function takeDoor() { const k = currentDoor(); door = null; return k; }

export function stillFor(key) {
  if (!key) return null;
  if (mem.has(key)) return mem.get(key);
  try { const u = localStorage.getItem(STORE + key); if (u) { mem.set(key, u); return u; } } catch { /* no storage */ }
  return null;
}

// `cv` must have been drawn in this same task (a GL canvas keeps nothing after its frame)
export function keepStill(key, cv) {
  if (!key || !cv?.width) return;
  try {
    const k = Math.min(1, WIDTH / cv.width), c = document.createElement('canvas');
    c.width = Math.round(cv.width * k); c.height = Math.round(cv.height * k);
    c.getContext('2d').drawImage(cv, 0, 0, c.width, c.height);
    // ⚠ ENCODED OFF THE FRAME. toDataURL is a synchronous JPEG encode, tens of ms, and this runs while you're
    // walking into the lobby: it was the hitch in the first steps. toBlob encodes off the main thread.
    c.toBlob((b) => {
      if (!b || b.size < 1000) return;   // a blank frame
      const r = new FileReader();
      r.onload = () => {
        const url = r.result;
        mem.set(key, url);
        try { localStorage.setItem(STORE + key, url); } catch { /* full: memory only */ }
      };
      r.readAsDataURL(b);
    }, 'image/jpeg', 0.8);
  } catch { /* a tainted or lost canvas: nothing kept */ }
}

// ── the lobby seen through its own doorway from the street ───────────────────
// The still, cropped to what the doorway would show of it and handed to GLASS as a decal's skin (glass/street-doors.js),
// so the street sees into the lobby before you walk in. The still is taken from just inside the door at eye height,
// looking in level, so the horizon is half-way up the picture and the doorway's head is a little above it.
const imgs = new Map(), cards = new Map();
function stillImage(key) {
  const url = stillFor(key);
  if (!url) return null;
  let e = imgs.get(key);
  if (!e || e.url !== url) { const im = new Image(); im.src = url; e = { url, im, v: (e?.v || 0) + 1 }; imgs.set(key, e); }
  return e.im.complete && e.im.naturalWidth ? e : null;
}
// `aspect` is the doorway's width over its height
export function stillCard(key, aspect) {
  const e = key && stillImage(key);
  if (!e) return null;
  const a = Math.max(0.2, Math.min(3, aspect)), ck = key + '|' + e.v + '|' + a.toFixed(2);
  let c = cards.get(ck);
  if (c) return c;
  const im = e.im, W = im.naturalWidth, H = im.naturalHeight;
  // the head of the door about a quarter of the way down from the top of the crop, the floor at the bottom
  const y0 = H * 0.34, ch = H - y0, cw = Math.min(W, ch * a), x0 = (W - cw) / 2;
  const cv = document.createElement('canvas');
  cv.height = 256; cv.width = Math.max(16, Math.round(256 * cw / ch));
  const g = cv.getContext('2d');
  g.drawImage(im, x0, y0, cw, ch, 0, 0, cv.width, cv.height);
  // a little dimmer than the room is, as a lit interior is from outside, darkest at the edges of the opening
  const v = g.createRadialGradient(cv.width / 2, cv.height * 0.6, cv.height * 0.15, cv.width / 2, cv.height * 0.6, cv.height * 0.8);
  v.addColorStop(0, 'rgba(0,0,0,0.05)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v; g.fillRect(0, 0, cv.width, cv.height);
  c = { key: 'lobby|' + ck, img: cv, lit: false };
  for (const k of cards.keys()) if (k.startsWith(key + '|')) cards.delete(k);
  cards.set(ck, c);
  return c;
}

// ── the keys through the door ────────────────────────────────────────────────
const WALK = new Set(['w', 'a', 's', 'd']);
let carry = null, carryT = 0;
const onKey = (e) => {
  if (!carry) return;
  const k = String(e.key || '').toLowerCase();
  if (k === 'shift') { carry.sprint = e.type === 'keydown'; return; }
  if (!WALK.has(k)) return;
  if (e.type === 'keydown') carry.held.add(k); else carry.held.delete(k);
};
const unhook = () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('keyup', onKey, true); window.removeEventListener('blur', drop); };
const drop = () => { carry = null; unhook(); };
export function noteCarry(keys, sprint = false) {
  unhook();
  carry = { held: new Set([...(keys || [])].filter((k) => WALK.has(k))), sprint: !!sprint };
  carryT = performance.now();
  document.addEventListener('keydown', onKey, true); document.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', drop);
}
// in the shape room-walk.js `carry` takes
export function takeCarry() {
  const c = carry && performance.now() - carryT < 8000 ? carry : null;
  drop();
  return c && c.held.size ? { held: [...c.held], spin: [], sprint: c.sprint, crouched: false } : null;
}
