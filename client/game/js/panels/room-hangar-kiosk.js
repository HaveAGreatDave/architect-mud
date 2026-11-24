// ROOM · THE HANGAR'S DISPLAY. A pedestal by the door of a hangar with a glass screen on it: walk up to it and it
// shows your aircraft kept at this field, and what the field's dealer sells, one at a time, turning in 3D on the
// glass. Pick one of yours and the floor lift brings her up (room-hoist.js plays the carousel); pick one for sale
// and it's bought, then it's yours to bring up.
//
// It decides nothing. Every key is a verb a player could type: `callup list` fills it (yours here, and the
// dealer's roster, server/engine/vehicle-stand.js), `callup <id>` brings one up, `callup back` sends it down, and
// a sale is the dealer's own `buy <type>`. The server says what's for sale and whether you can afford it.
//
// Where it stands is the room's stand's `kiosk` (`flags.room.stand.kiosk`, room-layout.js standSpecOf): a spot on
// the floor and the way its glass faces. The page is laid over the glass every frame (`matrix3d` from the four
// corners the renderer projects, as the hololock's card is), so its words are sharp and its buttons are buttons.
import { loadCss, escapeHtml as esc } from '../../../shared/dom.js';
import { loadAircraft3d, drawHangarFloorBay } from './aircraft3d-lazy.js';
import { quadMatrix } from './room-lock.js';
import { vtx, lin, MAT } from './gl/ballpark-mesh.js';

const CSS = await loadCss(new URL('./room-hangar-kiosk.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-hangar-kiosk-css')) return;
  const s = document.createElement('style');
  s.id = 'room-hangar-kiosk-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

// the page, px, and the glass it's laid on, metres
const PAGE = [520, 340], GLASS_W = 1.5, GLASS_Y0 = 1.05, GLASS_Y1 = 2.03;
// how near you must be to see it and to work it, metres
const SEEN = 10, FETCH = 7;
// the way each wall is from the middle of the room, in u and v (left is -u, front is v = 0)
const OUT = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] };

/**
 * The display of one open room. `project(p, w, h)` is the renderer's; `send(cmd)` types a verb; `walker()` is
 * where you stand, [u, v], or null.
 */
export function createHangarKiosk({ host, project, send, walker }) {
  ensureStyles();
  const page = document.createElement('div');
  page.className = 'hk-page'; page.style.display = 'none';
  page.setAttribute('role', 'group'); page.setAttribute('aria-label', 'Hangar display');
  page.innerHTML = `<div class="hk-head"><b>FLEET</b><span class="hk-field"></span></div>
    <div class="hk-tabs"><button type="button" data-tab="mine">YOURS <i></i></button><button type="button" data-tab="shop">FOR SALE <i></i></button></div>
    <div class="hk-stage"><button type="button" class="hk-prev" aria-label="Previous">◀</button><canvas width="300" height="170"></canvas><button type="button" class="hk-next" aria-label="Next">▶</button></div>
    <div class="hk-name"></div><div class="hk-sub"></div>
    <div class="hk-acts"></div>`;
  host.appendChild(page);
  const cv = page.querySelector('canvas'), ctx = cv.getContext('2d');

  let L = null, V = null, K = null, tab = 'mine', idx = 0, fetched = false, ready = false, shown = false, lastPaint = 0, sig = '';
  page.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) { tab = b.dataset.tab; idx = 0; sig = ''; }
    else if (b.classList.contains('hk-prev')) { idx--; sig = ''; }
    else if (b.classList.contains('hk-next')) { idx++; sig = ''; }
    // after a sale or a hire the lists are stale: read them again, and show yours, where she now is
    else if (b.dataset.cmd) { send(b.dataset.cmd); if (/^(buy|rent) /.test(b.dataset.cmd)) setTimeout(() => { fetched = false; tab = 'mine'; idx = 0; sig = ''; }, 1200); }
    b.blur();
  });

  const list = () => (tab === 'shop' ? V?.shop : V?.mine) || [];
  const geo = () => {
    if (!K) return null;
    const [u, v] = K.at, N = OUT[K.face] || OUT.back, A = [-N[1], N[0]], hw = GLASS_W / 2;
    // the glass stands a hand in front of the post, toward where it faces
    const cu = u + N[0] * 0.08, cv2 = v + N[1] * 0.08;
    const P = (a, y) => L.world(cu + A[0] * a, cv2 + A[1] * a, y);
    return { N, A, card: [P(-hw, GLASS_Y1), P(hw, GLASS_Y1), P(hw, GLASS_Y0), P(-hw, GLASS_Y0)], u, v };
  };

  function load(Lnew, vehicles) {
    if (Lnew) {
      L = Lnew; K = L.spec?.stand?.kiosk || L.spec?.kiosk || null; fetched = false;
      if (L.solid) {
        for (let i = L.solid.length - 1; i >= 0; i--) if (L.solid[i]._hoist === 'kiosk') L.solid.splice(i, 1);
        if (K) { const q = [K.at[0] - 0.45, K.at[0] + 0.45, K.at[1] - 0.45, K.at[1] + 0.45]; q._hoist = 'kiosk'; L.solid.push(q); }
      }
    }
    if (vehicles !== undefined) { V = vehicles; sig = ''; }
    if (K && !ready) loadAircraft3d().then(() => { ready = true; sig = ''; }).catch(() => {});
  }

  // the pedestal and the glass's frame, into the room's batch: a weighted foot, a raked post, a steel bezel
  function into(b) {
    if (!L || !K) return;
    const g = geo(), [u, v] = K.at, { N, A } = g;
    const up = [0, 1, 0], uv = [0, 0];
    const box = (a0, a1, n0, n1, y0, y1, col, mat = MAT.SATIN) => {
      const P = (a, n, y) => L.world(u + A[0] * a + N[0] * n, v + A[1] * a + N[1] * n, y);
      const c = [[a0, n0], [a1, n0], [a1, n1], [a0, n1]];
      const top = c.map(([a, n]) => P(a, n, y1)), bot = c.map(([a, n]) => P(a, n, y0));
      for (const i of [0, 1, 2, 0, 2, 3]) vtx(b, top[i], up, uv, col, mat);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4, e = [bot[j][0] - bot[i][0], 0, bot[j][2] - bot[i][2]], l = Math.hypot(e[0], e[2]) || 1, n = [e[2] / l, 0, -e[0] / l];
        for (const p of [bot[i], bot[j], top[j], bot[i], top[j], top[i]]) vtx(b, p, n, uv, col, mat);
      }
    };
    const steel = lin('#2c3036'), edge = lin('#8a929a'), glow = lin('#1a6f86');
    box(-0.42, 0.42, -0.36, 0.3, 0, 0.12, steel, MAT.PLATE);          // the foot
    box(-0.1, 0.1, -0.12, 0.04, 0.12, GLASS_Y0, steel);              // the post
    box(-GLASS_W / 2 - 0.05, GLASS_W / 2 + 0.05, -0.02, 0.06, GLASS_Y0 - 0.06, GLASS_Y1 + 0.06, edge, MAT.METAL);   // the bezel
    box(-GLASS_W / 2, GLASS_W / 2, 0.06, 0.075, GLASS_Y0, GLASS_Y1, glow, MAT.GLOSS);   // the dark glass the page lies on
    // a lit strip along the foot, so the thing reads from across the floor
    box(-0.4, 0.4, 0.3, 0.32, 0.03, 0.07, lin('#29e6ff'), MAT.GLOSS);
    b.lights = (b.lights || []).concat([{ p: L.world(u + N[0] * 0.5, v + N[1] * 0.5, 1.6), c: [0.2, 0.75, 0.95], r: 3 }]);
  }

  function paintPage() {
    const items = list(), n = items.length, mineN = V?.mine?.length || 0, shopN = V?.shop?.length || 0;
    if (n) idx = ((idx % n) + n) % n;
    const it = items[idx] || null, lf = V?.lift || null, busy = !!lf;
    const key = JSON.stringify([tab, idx, mineN, shopN, it?.id, it?.afford, lf?.id, lf?.down != null, fetched]);
    if (key === sig) return it;
    sig = key;
    page.querySelector('.hk-field').textContent = K?.label || (V?.desk ? 'TERMINAL' : 'HANGAR');
    const [tm, ts] = page.querySelectorAll('.hk-tabs button');
    tm.classList.toggle('on', tab === 'mine'); ts.classList.toggle('on', tab === 'shop');
    tm.querySelector('i').textContent = mineN; ts.querySelector('i').textContent = shopN;
    ts.hidden = !shopN;
    page.querySelector('.hk-prev').disabled = page.querySelector('.hk-next').disabled = n < 2;
    const name = page.querySelector('.hk-name'), subEl = page.querySelector('.hk-sub'), acts = page.querySelector('.hk-acts');
    if (!fetched && !n) { name.textContent = 'Reading the field…'; subEl.textContent = ''; acts.innerHTML = ''; return it; }
    if (!it) {
      name.textContent = tab === 'shop' ? 'Nothing for sale here' : 'Nothing of yours here';
      subEl.textContent = tab === 'mine' && shopN ? 'Have a look at what\'s for sale.' : '';
      acts.innerHTML = tab === 'mine' && shopN ? '<button type="button" data-tab="shop">See what\'s for sale</button>' : '';
      return it;
    }
    name.textContent = it.name;
    let html = '';
    const money = (n) => Number(n).toLocaleString() + '₵';
    if (tab === 'shop') {
      subEl.textContent = [it.seats ? `${it.seats} seat${it.seats > 1 ? 's' : ''}` : '', it.fuel ? String(it.fuel).replace(/_/g, ' ') : ''].filter(Boolean).join(' · ');
      if (it.cmd) html += `<button type="button" class="hk-buy" data-cmd="${esc(it.cmd)}"${it.afford ? '' : ' disabled'}>BUY · ${money(it.price)}</button>`;
      if (it.rentCmd) html += `<button type="button" class="hk-rent" data-cmd="${esc(it.rentCmd)}"${it.affordRent ? '' : ' disabled'}>RENT · ${money(it.rent)}/HR</button>`;
    } else if (V?.desk) {
      // a terminal: she's kept in the hangar, and boarding is out there; the bench is the hangar app, here as there
      // one waiting somewhere else, a dealer's delivery roof: the screen sends you to the lift
      subEl.textContent = it.away || K?.kept || 'In the hangar';
      html = it.away
        ? (it.go ? `<button type="button" class="hk-call" data-cmd="${esc(it.go)}">TO THE LIFT</button>` : '')
        : `<button type="button" class="hk-svc" data-cmd="hangar">SERVICE</button>`;
    } else {
      const out = lf && String(lf.id) === String(it.id);
      subEl.textContent = out ? (lf.down != null ? 'Going down…' : 'On the floor') : busy ? 'The lift is in use' : 'Parked below';
      if (out && lf.down == null && lf.mine) html = `<button type="button" class="hk-down" data-cmd="callup back">SEND HER DOWN</button>`;
      else if (!busy) html = `<button type="button" class="hk-call" data-cmd="callup ${esc(it.id)}">BRING HER UP</button>`;
      // the maintenance bench, paint and loadout: the hangar's own app, opened on her
      html += `<button type="button" class="hk-svc" data-cmd="hangar">SERVICE</button>`;
    }
    acts.innerHTML = html;
    return it;
  }

  // the turning model on the glass, at most 30 times a second while it's seen
  function paintModel(it, now) {
    if (now - lastPaint < 33) return;
    lastPaint = now;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!it?.look || !ready) return;
    try {
      drawHangarFloorBay(ctx, { cls: it.look.cls, armed: !!it.look.armed, variant: it.look.variant || '', livery: it.look.livery || {},
        w: cv.width, h: cv.height, flat: true, yaw: now / 1000 * 0.6, elev: 0.3, zoom: 1.1 });
    } catch { /* an empty glass is still a display */ }
  }

  /** Each frame: lay the page over the glass, fill it the first time you come near, turn the model. */
  function frame(now = performance.now()) {
    if (!L || !K || !V) { if (shown) { page.style.display = 'none'; shown = false; } return; }
    const at = walker(), g = geo();
    const du = at ? at[0] - g.u : 99, dv = at ? at[1] - g.v : 99, dist = Math.hypot(du, dv);
    if (!fetched && dist < FETCH) { fetched = true; sig = ''; send('callup list'); }
    const front = du * g.N[0] + dv * g.N[1] > 0.1;
    const w = host.clientWidth, h = host.clientHeight;
    let m = null;
    if (front && dist < SEEN && w && h) {
      const q = g.card.map((p) => project(p, w, h));
      if (q.every(Boolean)) {
        let pts = q.map((p) => [p.x, p.y]);
        const area = pts.reduce((s, p, i) => { const nx = pts[(i + 1) % 4]; return s + p[0] * nx[1] - nx[0] * p[1]; }, 0);
        if (area < 0) pts = [pts[1], pts[0], pts[3], pts[2]];
        const tall = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]);
        if (tall > 24 && pts.every((p) => Math.abs(p[0]) < 6 * w + 2000 && Math.abs(p[1]) < 6 * h + 2000)) m = quadMatrix(PAGE[0], PAGE[1], pts);
      }
    }
    if (!m) { if (shown) { page.style.display = 'none'; shown = false; } return; }
    if (!shown) { page.style.display = ''; shown = true; }
    page.style.transform = m;
    // close enough to touch: the keys work; further off it's a picture
    page.classList.toggle('hk-far', dist > 3.2);
    paintModel(paintPage(), now);
  }

  return { load, into, frame, get active() { return !!K; }, dispose() { page.remove(); } };
}
