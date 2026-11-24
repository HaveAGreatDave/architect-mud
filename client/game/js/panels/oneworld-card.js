// ONE WORLD · THE CARD (docs/proposals/one-world-interiors.md, phase B). Walking round a building's rooms in GLASS, the
// piece you're facing and within reach of has the Room Stage's card at the foot of the picture: its name and what it
// offers, F for the first line and 2 to 9 for the rest, or a click.
//
// The same pieces, the same acts and the same aim as the Stage: what's faced is room-layout.js roomAim off the room's
// own layout, and what it offers is room-acts.js pieceActs over the piece the server sent on `room_view` (its `acts`,
// furnitureActs). Every line sends its own typed verb, so nothing here decides anything. Sit down and Lie down put the
// camera on the seat as well (freelook-view.js owSit), and Get up or a step takes it off.
// ⚠ NOT EVERY LINE YET. A verb the Stage works with something of its own (the kitchen, a set's picture, a
// vending machine's front, the card table, a keypad) is left off until that piece moves over (STAGE_ONLY); it's still
// there to type.
import { pieceActs, vendorActs } from '../../../shared/room-acts.js';
import { roomAim, openingInside } from '../../../shared/room-layout.js';
import { FT_M } from '../../../shared/world-scale.js';
import { loadCss, escapeHtml as esc } from '../../../shared/dom.js';

// a vending machine's front and the card table (a poker_update opens the Stage). A Cachet's keypad isn't one: its pad is
// keypad.js's own overlay, and the card offers it as the Stage's does (`keypad` below).
export const STAGE_ONLY = new Set(['vend', 'join', 'pokerplay', 'leave']);

// What the card lists for a piece: the Stage's lines less the ones only the Stage can work yet. Sat on it, Get up comes
// first and there's no sitting down again, as on the Stage (room-stage.js actsOf). Pure.
export const GET_UP = { verb: 'stand', label: 'Get up', cmd: 'stand' };
export function glassActs(piece, seats = [], { sat = false, tvOn = null, keypad = false } = {}) {
  // a vending machine: its flavours and its plug, each a typed verb (room-acts.js vendorActs), as the Stage's card has them
  if (piece.form === 'vendor' && piece.vend) return vendorActs(piece);
  // a set's Watch is its power switch, and says which way it'll go (room-stage.js actsOf), when `tvOn` is known
  let acts = pieceActs(piece, seats).filter((a) => !STAGE_ONLY.has(a.verb) && a.verb !== 'keypad')
    .map((a) => (a.verb === 'watch' && tvOn !== null ? { ...a, label: tvOn ? 'Turn it off' : 'Turn it on' } : a));
  // a Cachet (plugins/concealment), as room-stage.js actsOf has it: a turned one's lab cooks, and its keypad is offered
  // only to whoever room_view says may know of it (`keypad`), first unless the lab is out
  if (piece.turned && !acts.some((a) => a.verb === 'workspace')) acts = [{ verb: 'workspace', label: 'Cook', cmd: 'workspace chembench' }, ...acts];
  if (piece.keypad && keypad) { const pad = { verb: 'keypad', label: 'Use the keypad', cmd: `keypad ${piece.name}` }; acts = piece.turned ? [...acts, pad] : [pad, ...acts]; }
  return sat ? [GET_UP, ...acts.filter((a) => a.verb !== 'sit' && a.verb !== 'lie')] : acts;
}

// The seat a Sit down or Lie down on a piece takes, as the Stage's runAct picks it: a lie for Lie down, or for a sit on
// a piece with only places to lie (a sun lounger). Null when it has none, and then the verb is only sent. Pure.
export function seatFor(seats, pieceId, verb) {
  const all = (seats || []).filter((q) => String(q.piece) === String(pieceId));
  const lie = verb === 'lie' || (all.length > 0 && all.every((q) => q.lie));
  return all.find((q) => !!q.lie === lie) || null;
}
// The verb the server is sent for sitting on a seat: its own (a toilet's is 'poop'), as the Stage's onSit sends.
export const sitCmd = (seat, piece) => `${seat?.lie ? 'lie' : seat?.verb || 'sit'} ${piece.name}`;

// Which piece of a room you're facing: `at` and `ahead` are [u, v] in the room's own frame, `ahead` a point a step
// in front of you. `pieces` is room_view's; a piece in the en-suite isn't offered from the main room. Pure.
export function facedPiece(L, pieces, at, ahead) {
  if (!L || !at || !ahead) return null;
  const du = ahead[0] - at[0], dv = ahead[1] - at[1], n = Math.hypot(du, dv);
  if (!n) return null;
  const byId = new Map((pieces || []).map((p) => [String(p.id), p]));
  const id = roomAim(L, at, du / n, dv / n, (pid) => { const p = byId.get(String(pid)); return !!p && !p.annex; });
  return id == null ? null : byId.get(String(id)) || null;
}

// The locked doorway you're stood at and facing (room_view's `locks`), as the Stage's lock aim has it: within reach of
// the step just inside it (2.3 m, room-lock.js REACH) and more or less in front of you. Pure.
const LOCK_REACH_M = 2.3, LOCK_FACING = 0.45;
export function facedLock(L, locks, at, ahead) {
  if (!L || !at || !ahead || !locks?.length) return null;
  const du = ahead[0] - at[0], dv = ahead[1] - at[1], n = Math.hypot(du, dv);
  if (!n) return null;
  const reach = LOCK_REACH_M * ((L.ft || FT_M) / FT_M);
  let best = null, score = Infinity;
  for (const k of locks) {
    const o = (L.spec?.openings || []).find((q) => q.to === k.to && q.dir);
    const p = o && openingInside(L, o)?.at;
    if (!p || k.glass) continue;
    const pu = p[0] - at[0], pv = p[1] - at[1], d = Math.hypot(pu, pv);
    if (d > reach || (d && (pu * du + pv * dv) / (d * n) < LOCK_FACING)) continue;
    if (d < score) { score = d; best = k; }
  }
  return best;
}

const CSS = await loadCss(new URL('./oneworld-card.css', import.meta.url));

// The card on a view's root. `run(act, piece)` does a line (the view sends its `cmd`, or sits you). `show(piece, seats,
// opts)` puts a piece up (or null takes it down; opts as glassActs'); `key(k)` takes F and 2 to 9 while it's up.
export function createOneWorldCard(root, onAct) {
  if (CSS && !document.getElementById('oneworld-card-css')) {
    const s = document.createElement('style'); s.id = 'oneworld-card-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  const el = document.createElement('div');
  el.className = 'ow-card'; el.hidden = true;
  el.innerHTML = '<b class="ow-card-name"></b><div class="ow-card-acts"></div>';
  root.appendChild(el);
  const nameEl = el.querySelector('.ow-card-name'), actsEl = el.querySelector('.ow-card-acts');
  let acts = [], key = '', shown = null;
  const run = (a) => { if (a) onAct(a, shown); return !!a; };
  actsEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) run(acts[Number(b.dataset.i)]); });
  return {
    show(piece, seats = [], opts = {}) {
      acts = piece ? opts.acts || glassActs(piece, seats, opts) : [];
      // a door's card shows even with nothing to press (a shop shut for the night): its name says it
      const k = piece && (acts.length || piece.lock) ? piece.id + acts.map((a) => a.verb + ':' + a.label).join() : '';
      shown = k ? piece : null;
      if (k === key) return;
      key = k; el.hidden = !k;
      nameEl.textContent = k ? piece.name || '' : '';
      actsEl.innerHTML = acts.slice(0, 9).map((a, i) => `<button type="button" data-i="${i}"><kbd>${i ? i + 1 : 'F'}</kbd>${esc(a.label)}</button>`).join('');
    },
    key(k) {
      if (!key) return false;
      if (k === 'f') return run(acts[0]);
      if (/^[2-9]$/.test(k)) return run(acts[Number(k) - 1]);
      return false;
    },
    up: () => !!key,
    remove() { el.remove(); },
  };
}
