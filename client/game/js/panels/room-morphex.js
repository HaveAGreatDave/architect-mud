// The MORPHEX pod on the Room Stage: an upright chrome iron maiden. You walk up to it, turn round and back in, press
// the button by your hand, and its two halves swing shut on you. Inside, a ring scans you head to foot and the
// machine's visor lights with the editor, the body in front of you changing as you pick; when you're done it vents
// steam from every seam and swings open, and you step out somebody else. The pod itself is a piece (gl/room-decor.js 'morphex', `look.pod` on its row); this
// is its sequence, drawn as props over the room, and the menu over the picture.
//
// It decides nothing. Buying sends the same `morphex hair color …` lines the 2D panel sends (plugins/cosmetic-machine),
// which charge and refuse as they always have; the body you come out in is the one the server sends back in
// `room_people` (client/shared/player-figure.js). The draft on the body inside the pod is only a picture.
//
// room-stage.js hosts it: createMorphex(...) gives frame(now) → { cam, props, glass, glows }, self(now) → the body
// to draw for you (or null), and close(). It calls done({ at, yaw }) when you're out.

import { createBatch, grid, ellipsoid, vtx, lin, MAT } from './gl/ballpark-mesh.js';
import { facing, roomYaw } from '../../../shared/room-layout.js';
import { playerFigure } from '../../../shared/player-figure.js';
import { HAIR_STYLE_NAMES, FACE, FACE_TUNE, FACE_SHAPE_EYES, TUNE_MIN, TUNE_MAX, SKIN_RGB, TATTOO_PLACES, TATTOO_INKS } from '../../../shared/morphex-catalog.js';
import { loadCss, escapeHtml as esc } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./room-morphex.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('rmx-css')) return;
  const s = document.createElement('style'); s.id = 'rmx-css'; s.textContent = CSS; document.head.appendChild(s);
}

// What's for sale. The values are the ones plugins/cosmetic-machine accepts (client/shared/morphex-catalog.js);
// the prices are the brochure's.
const HAIR_COLORS = ['black', 'dark brown', 'brown', 'auburn', 'dirty blonde', 'blonde', 'red', 'grey', 'white', 'silver', 'dyed blue', 'dyed green', 'dyed purple', 'dyed red'];
const HAIR_LENGTHS = ['shaved', 'short', 'medium', 'long', 'very_long'];
const EYE_COLORS = ['brown', 'dark brown', 'blue', 'light blue', 'green', 'hazel', 'grey', 'amber'];
const SWATCH = {
  black: '#181412', 'dark brown': '#30201a', brown: '#563a24', auburn: '#78341e', 'dirty blonde': '#967a4e', blonde: '#ceb070', red: '#963218',
  grey: '#8c8a86', white: '#dedcd6', silver: '#bec2c8', 'dyed blue': '#2850c8', 'dyed green': '#28a050', 'dyed purple': '#6e32aa', 'dyed red': '#c81e28',
  'light blue': '#78aadc', blue: '#3c6eb4', green: '#468246', hazel: '#786432', amber: '#be8228',
};
const hexOf = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
for (const [k, v] of Object.entries(SKIN_RGB)) SWATCH['skin:' + k] = hexOf(v);
for (const [k, v] of Object.entries(TATTOO_INKS)) SWATCH['ink:' + k] = hexOf(v);
const LINES = [
  'Feeling ordinary? That is a symptom.',
  'YOU, BUT BETTER. Or different. We do not judge. We do invoice.',
  'Financing available on cheekbones. Cheekbones not available.',
  'Nine out of ten clones could not tell the difference. The tenth was recalled.',
  'Your old face will be disposed of responsibly, downstairs.',
  'Members save 0%. Membership is free. Join now.',
  'Results not typical. Nothing here is typical. That is the point.',
  'Tattoo removal is a separate department. It is also this department.',
  'Neon ink: be seen by people you would rather not be seen by.',
];
const TABS = [['hair', 'HAIR'], ['face', 'FACE'], ['body', 'BODY'], ['ink', 'INK']];
const PRICE = 10;
const label = (s) => String(s).replace(/_/g, ' ');
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// a fake list price per row, the same every visit, so the struck-out number looks considered
const rrp = (k) => { let h = 7; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 499 + (h % 45) * 100; };
// the look as a menu holds it: nested parts copied so a draft never writes into the look it started from
const copyLook = (l) => ({ ...l, face: { ...(l.face || {}) }, tattoos: { ...(l.tattoos || {}) }, ink: l.ink || 'black' });

export function createMorphex({ L, piece, mount, me, send, done }) {
  ensureStyles();
  // the pod's frame: its middle on the floor and the way its open side faces, in the room's u and v
  const [fu, fv] = facing(piece.turn), ru = -fv, rv = fu;
  const R = Math.min(piece.w, piece.d) / 2 * 0.9, H = piece.h, plinth = 0.16, top = H - 0.3;
  // the maiden's outline, a coffin stood on end: its half-width as a share of R at a height (gl/room-decor.js 'morphex' has the same)
  const prof = (y) => { const k = (y - plinth) / (top - plinth); return k < 0.74 ? 0.66 + 0.4 * (k / 0.74) : k < 0.86 ? 1.06 - 1.5 * (k - 0.74) : Math.max(0.05, 0.88 * Math.sqrt(Math.max(0, 1 - ((k - 0.86) / 0.16) ** 2))); };
  const cu = piece.u + fu * 0.05, cv = piece.v + fv * 0.05;
  const loc = (x, z) => [cu + ru * x + fu * z, cv + rv * x + fv * z];
  const W = (x, y, z) => { const [u, v] = loc(x, z); return L.world(u, v, y); };
  const outside = loc(0, piece.d / 2 + 0.9), front = loc(0, piece.d / 2 + 0.35), inside = loc(0, -0.04);
  const faceOut = roomYaw(L, fu, fv), faceIn = roomYaw(L, -fu, -fv);

  const was = copyLook(me.look), draft = copyLook(me.look);
  const S = { phase: 'in', t0: performance.now(), pulse: -1, steam: 0, flash: 0, bought: false, upsell: false, tier: 1, line: 0, tab: 'hair' };
  const props = createBatch(4096), glass = createBatch(4096), halos = createBatch(24000);
  const at = (now) => (now - S.t0) / 1000;
  const go = (phase, now = performance.now()) => { S.phase = phase; S.t0 = now; };

  // ── the menu ────────────────────────────────────────────────────────────────────────────────────
  const ui = document.createElement('div');
  ui.className = 'rmx';
  mount.appendChild(ui);
  // a chip's key: a column ('hair_color'), a face part ('face.shape'), a tattoo place ('tat.cheek') or 'ink'
  const get = (k) => (k.startsWith('face.') ? draft.face[k.slice(5)] : k.startsWith('tat.') ? draft.tattoos[k.slice(4)] || 'none' : draft[k]);
  const set = (k, v) => {
    if (k.startsWith('face.')) draft.face[k.slice(5)] = v;
    else if (k.startsWith('tat.')) { if (v === 'none') delete draft.tattoos[k.slice(4)]; else draft.tattoos[k.slice(4)] = v; }
    else draft[k] = v;
  };
  // what BECOME sends: the typed verbs, one a change
  function orders() {
    const out = [];
    const COL = { hair_color: 'hair color', hair_length: 'hair length', hair_style: 'hair style', eye_color: 'eye color', height_cm: 'height', weight_kg: 'weight' };
    for (const [k, verb] of Object.entries(COL)) if (draft[k] !== was[k]) out.push(`morphex ${verb} ${draft[k]}`);
    for (const k of Object.keys(FACE)) if (draft.face[k] && draft.face[k] !== was.face[k]) out.push(`morphex face ${k} ${draft.face[k]}`);
    for (const p of Object.keys(TATTOO_PLACES)) { const a = draft.tattoos[p] || 'none', b = was.tattoos[p] || 'none'; if (a !== b) out.push(`morphex tattoo ${p} ${a}`); }
    for (const k of Object.keys(FACE_TUNE)) { const a = Number(draft.face[k]) || 0; if (a !== (Number(was.face[k]) || 0)) out.push(`morphex face ${k} ${a}`); }
    if (draft.ink !== was.ink) out.push(`morphex ink ${draft.ink}`);
    return out;
  }
  const totalHtml = (n) => (n ? `${n} change${n > 1 ? 's' : ''} · <b>${n * PRICE}₵</b> <small>first one free if you've never had one</small>` : '<small>Pick something. You can afford to be someone.</small>');
  function paint() {
    const n = orders().length;
    const chips = (key, list, sw = '') => list.map((x) => `<button class="rmx-chip${get(key) === x ? ' on' : ''}${sw ? ' sw' : ''}" data-k="${key}" data-v="${esc(x)}"${sw ? ` style="--sw:${SWATCH[sw + x] || SWATCH[x] || '#888'}"` : ''} title="${esc(label(x))}">${sw ? '' : esc(label(x))}</button>`).join('');
    const row = (key, title, body) => `<section class="rmx-row"><header><b>${title}</b><span class="rmx-p"><s>RRP ${rrp(key).toLocaleString()}₵</s> ${PRICE}₵</span></header><div class="rmx-opts">${body}</div></section>`;
    const slider = (key, min, max, unit, lab) => `<input type="range" min="${min}" max="${max}" step="1" data-k="${key}" value="${draft[key]}" aria-label="${lab}"><output>${draft[key]} ${unit}</output>`;
    const tab = {
      hair: () => row('hair_color', 'Hair colour', chips('hair_color', HAIR_COLORS, ':')) + row('hair_style', `Hair style <small>${HAIR_STYLE_NAMES.length} cuts</small>`, chips('hair_style', HAIR_STYLE_NAMES)) + row('hair_length', 'Hair length <small>for cuts that grow</small>', chips('hair_length', HAIR_LENGTHS)),
      face: () => {
        const sliders = (keys) => keys.map((k) => {
          const T = FACE_TUNE[k], v = Number(draft.face[k]) || 0;
          return `<label class="rmx-sl" title="${esc(T.lo)} to ${esc(T.hi)}"><span>${esc(T.label)}</span><input type="range" min="${TUNE_MIN}" max="${TUNE_MAX}" step="1" data-k="face.${k}" value="${v}" aria-label="${esc(T.label)}, ${esc(T.lo)} to ${esc(T.hi)}"><output>${v > 0 ? '+' + v : v}</output></label>`;
        }).join('');
        const eyeKeys = Object.keys(FACE_TUNE).filter((k) => k.startsWith('eye')), restKeys = Object.keys(FACE_TUNE).filter((k) => !k.startsWith('eye'));
        // the eye shape is a sub-row of the face shape: 'natural' is whatever that face comes with
        const own = FACE_SHAPE_EYES[draft.face.shape];
        const title = (k, F) => k === 'shape' ? `${F.label} <small>${F.values.length} heads</small>` : k === 'eyeshape' ? `↳ ${F.label} <small>natural for this face: ${esc(label(own || 'natural'))}</small>` : F.label;
        return row('eye_color', 'Eye colour', chips('eye_color', EYE_COLORS, ':'))
          + Object.entries(FACE).map(([k, F]) => row('face.' + k, title(k, F), chips('face.' + k, F.values, k === 'skin' ? 'skin:' : '')).replace('class="rmx-row"', k === 'eyeshape' ? 'class="rmx-row rmx-sub"' : 'class="rmx-row"')).join('')
          + `<section class="rmx-row"><header><b>Eyes <small>on top of the eye shape · each slider moved is one change</small></b></header><div class="rmx-opts">${sliders(eyeKeys)}</div></section>`
          + `<section class="rmx-row"><header><b>Fine tuning <small>each slider moved is one change</small></b><button class="rmx-reset" data-act="untune">Reset</button></header><div class="rmx-opts">${sliders(restKeys)}</div></section>`;
      },
      body: () => row('height_cm', 'Height', slider('height_cm', 150, 205, 'cm', 'Height in centimetres')) + row('weight_kg', 'Build', slider('weight_kg', 45, 130, 'kg', 'Weight in kilograms'))
        + `<label class="rmx-up"><input type="checkbox" data-up ${S.upsell ? 'checked' : ''}> Add CONFIDENCE™ for 0₵. <small>Does nothing. Most popular.</small></label>`,
      ink: () => row('ink', 'Ink <small>one for all of them</small>', chips('ink', Object.keys(TATTOO_INKS), 'ink:')) + Object.entries(TATTOO_PLACES).map(([p, T]) => row('tat.' + p, T.label, chips('tat.' + p, ['none', ...T.designs]))).join(''),
    }[S.tab];
    const scroll = ui.querySelector('.rmx-body')?.scrollTop || 0;
    ui.innerHTML = `
      <div class="rmx-visor" aria-hidden="true"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="rmx-hud">BIOSCULPT CHAMBER · SEALED · O₂ 98% · SUBJECT HELD</span></div>
      <div class="rmx-panel" role="dialog" aria-label="MORPHEX 9000">
        <div class="rmx-head"><span class="rmx-logo">MORPHEX<i>9000</i></span><span class="rmx-tag">BioSculpt™ · YOU, BUT BETTER.</span></div>
        <div class="rmx-tiers">${['BASIC SELF', 'SELF+', 'SELF ULTRA™'].map((t, i) => `<button class="rmx-tier${S.tier === i ? ' on' : ''}" data-tier="${i}"${i === 2 ? ' disabled title="Coming soon to people like you"' : ''}>${t}</button>`).join('')}</div>
        <div class="rmx-tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" class="rmx-tab${S.tab === k ? ' on' : ''}" aria-selected="${S.tab === k}" data-tab="${k}">${t}</button>`).join('')}</div>
        <div class="rmx-body">${tab()}</div>
        <div class="rmx-foot">
          <div class="rmx-total">${totalHtml(n)}</div>
          <button class="rmx-cancel" data-act="cancel">No thanks, I like being like this</button>
          <button class="rmx-buy" data-act="buy"${n ? '' : ' disabled'}>BECOME</button>
        </div>
        <div class="rmx-ticker"><span>${esc(LINES[S.line % LINES.length])}</span></div>
      </div>`;
    const body = ui.querySelector('.rmx-body');
    if (body && !S.tabbed) body.scrollTop = scroll;
    S.tabbed = false;
  }
  const leave = () => { Object.assign(draft, copyLook(was)); ui.classList.remove('up'); go('open'); };
  ui.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || S.phase !== 'menu') return;
    if (b.dataset.k) { set(b.dataset.k, b.dataset.v); S.pulse = performance.now(); paint(); return; }
    if (b.dataset.tab) { S.tab = b.dataset.tab; S.tabbed = true; paint(); return; }
    if (b.dataset.tier) { S.tier = +b.dataset.tier; paint(); return; }
    if (b.dataset.act === 'cancel') { leave(); return; }
    if (b.dataset.act === 'untune') { for (const k of Object.keys(FACE_TUNE)) delete draft.face[k]; S.pulse = performance.now(); paint(); return; }
    if (b.dataset.act === 'buy') {
      for (const c of orders()) send(c);
      S.bought = true; ui.classList.remove('up'); go('steam');
    }
  });
  ui.addEventListener('input', (e) => {
    const k = e.target.dataset?.k;
    if (k) {
      const n = Number(e.target.value);
      if (k.startsWith('face.')) { if (n) set(k, n); else delete draft.face[k.slice(5)]; e.target.nextElementSibling.textContent = n > 0 ? '+' + n : String(n); }
      else { draft[k] = n; e.target.nextElementSibling.textContent = `${n} ${k === 'height_cm' ? 'cm' : 'kg'}`; }
      S.pulse = performance.now();
      const c = orders().length, t = ui.querySelector('.rmx-total');
      if (t) { t.innerHTML = totalHtml(c); ui.querySelector('.rmx-buy').disabled = !c; }
      return;
    }
    if ('up' in (e.target.dataset || {})) S.upsell = e.target.checked;
  });
  const onKey = (e) => { if (e.key === 'Escape' && S.phase === 'menu') { e.stopPropagation(); leave(); } };
  window.addEventListener('keydown', onKey, true);
  const ticker = setInterval(() => { S.line++; const t = ui.querySelector('.rmx-ticker span'); if (t) t.textContent = LINES[S.line % LINES.length]; }, 5200);

  // ── the timeline ──────────────────────────────────────────────────────────────────────────────────
  // door: 0 slid round the back, 1 shut across the front
  function doorK(now) {
    const t = at(now);
    // shut: the last tenth slams, with a small bounce off the seal; open: it swings out slow on a hiss
    switch (S.phase) {
      case 'in': case 'press': return 0;
      case 'shut': { const k = Math.min(1, t / 0.9); return k < 0.85 ? ease(k / 0.85) * 0.97 : 0.97 + 0.03 * Math.sin((k - 0.85) / 0.15 * Math.PI * 1.5) * (1 - k) * 6 + 0.03 * ((k - 0.85) / 0.15); }
      case 'open': return 1 - ease(Math.min(1, t / 1.2));
      case 'out': case 'gone': return 0;
      default: return 1;
    }
  }
  function step(now) {
    const t = at(now);
    if (S.phase === 'in' && t > 2.0) go('press', now);
    else if (S.phase === 'press' && t > 0.6) go('shut', now);
    else if (S.phase === 'shut' && t > 1.0) go('scan', now);
    else if (S.phase === 'scan' && t > 1.6) { go('menu', now); paint(); ui.classList.add('up'); }
    else if (S.phase === 'steam' && t > 2.6) go('open', now);
    else if (S.phase === 'open' && t > 1.25) go('out', now);
    else if (S.phase === 'out' && t > 1.1) { go('gone', now); finish(); }
    // steam builds over a second, holds while the body changes under it, and clears
    // steam: jets from the seams while it's shut and working, and the big release as it opens
    S.steam = S.phase === 'steam' ? (t < 0.6 ? 0.5 * ease(t / 0.6) : t < 2.2 ? 0.5 + 0.2 * Math.sin(t * 9) : 1) : S.phase === 'open' ? 1 - ease(Math.min(1, t / 1.4)) * 0.6 : Math.max(0, S.steam - 0.02);
    S.flash = S.phase === 'steam' ? Math.max(0, 1 - Math.abs(t - 1.2) / 0.25) : 0;
  }
  // where the scan ring is: parked in the canopy, swept down and up on the scan, and a quick pass on each pick
  function ringY(now) {
    const t = at(now);
    if (S.phase === 'scan') { const k = Math.min(1, t / 1.6), s = k < 0.5 ? ease(k * 2) : 1 - ease((k - 0.5) * 2); return top - 0.04 - s * (top - plinth - 0.1); }
    if (S.pulse > 0) { const k = (now - S.pulse) / 700; if (k < 1) return top - 0.04 - Math.sin(k * Math.PI) * (top - plinth - 0.1); }
    return top - 0.04;
  }

  // ── the picture ───────────────────────────────────────────────────────────────────────────────────
  const GLASS = lin('#bfe6ff'), RING = lin('#9be7ff'), EDGE = lin('#ff6a1e'), STEAM = lin('#eef6fa'), CARBON = lin('#16181b'), CARBON2 = lin('#22252a'), BAND = lin('#3a3f46'), RIVET = lin('#5a6068'),LINER = lin('#0b0d10'), STUD = lin('#2c3036'), TIP = lin('#7ff0ff'), BTN = lin('#5fe8ff');
  // a point on one half of the maiden: `side` -1 left, 1 right; `a` 0 at its hinge (the side) to 1 at the front seam;
  // `y` up it; `inset` in from the shell; `k` how shut (0 swung right out, 1 shut)
  function half(side, a, y, inset, k) {
    const w = R * prof(y) - inset, th = side * (Math.PI / 2) * (1 - a);
    const x0 = Math.sin(th) * w, z0 = Math.cos(th) * w;
    // swing about the hinge at (side * w, 0): out by up to 105 degrees
    const sw = -side * (1 - k) * 1.83, hx = side * R * prof(y), dx = x0 - hx;
    return [hx + dx * Math.cos(sw) - z0 * Math.sin(sw), z0 * Math.cos(sw) + dx * Math.sin(sw)];
  }
  // one soft ball of light-catching vapour into the halo batch: k 0..1 how dense, col its colour where it's thickest
  function puff(c, r, col, k) {
    if (k < 0.004) return;
    const nu = 10, nv = 6, pt = (i, j) => { const a = (i / nu) * Math.PI * 2, e = -Math.PI / 2 + (j / nv) * Math.PI; return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)]; };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
      for (const m of [0, 1, 2, 0, 2, 3]) { const d = q[m]; vtx(halos, [c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]], d, [k, 0], col, 40); }
    }
  }
  function build(now) {
    props.n = 0; glass.n = 0;
    // the two halves of the front, hinged at the sides: carbon fibre outside, a dark liner set with spikes lit cyan
    // inside. From inside (the scan and the menu) they're behind the camera, so they aren't drawn
    const k = doorK(now), inside = S.phase === 'scan' || S.phase === 'menu', ROWS = 16, COLS = 9;
    const yAt = (i) => plinth + 0.02 + (i / ROWS) * (top - plinth - 0.02);
    if (!inside) for (const side of [-1, 1]) {
      const at = (a, y, inset) => { const [x, z] = half(side, a, y, inset, k); return W(x, y, z); };
      // carbon fibre outside: lacquered panels in two blacks by turns, so the weave catches the light strip by strip
      for (let j = 0; j < COLS - 1; j++) grid(props, ROWS + 1, 2, (i, q) => at((j + q) / (COLS - 1), yAt(i), -0.03), { wrap: false, col: j % 2 ? CARBON2 : CARBON, mat: MAT.GLOSS });
      grid(props, ROWS + 1, COLS, (i, j) => at(j / (COLS - 1), yAt(i), 0.015), { wrap: false, col: LINER, mat: MAT.SATIN });
      // the studs on the liner, in rows, and the lit seam down the front edge
      // dark metal straps across the outside every few rows
      // dark metal straps across the outside every few rows, riveted at every other rib
      const dot = (p, r, col, mat = MAT.METAL) => ellipsoid(props, p, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [r, r, r], 4, 6, col, mat);
      for (let b = 1; b < ROWS; b += 4) {
        grid(props, 2, COLS, (i, j) => at(j / (COLS - 1), yAt(b) + i * 0.05, -0.045), { wrap: false, col: BAND, mat: MAT.METAL });
        for (let j = 0; j < COLS; j += 2) dot(at(j / (COLS - 1), yAt(b) + 0.025, -0.058), 0.012, RIVET);
      }
      // raised straps up the hinge side and down the front edge where the halves meet
      for (const a0 of [0, 0.88]) grid(props, ROWS + 1, 2, (i, j) => at(a0 + j * 0.1, yAt(i), -0.05), { wrap: false, col: BAND, mat: MAT.METAL });
      // the face cast in the head, each half carrying its side: a cheek plate, a brow, an eye slit lit cyan, the mouth
      const hy = plinth + 0.9 * (top - plinth), fh = (top - plinth) * 0.05, flat = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      grid(props, 3, 4, (i, j) => at(0.6 + j * 0.093, hy - fh * 1.8 + i * fh * 1.8, i === 1 ? -0.075 : -0.05), { wrap: false, col: BAND, mat: MAT.METAL });
      ellipsoid(props, at(0.76, hy + fh * 0.95, -0.09), flat, [0.075, 0.016, 0.03], 4, 7, CARBON2, MAT.GLOSS);
      ellipsoid(props, at(0.78, hy + fh * 0.25, -0.095), flat, [0.05, 0.009, 0.012], 3, 6, EDGE, MAT.EMISSIVE);
      ellipsoid(props, at(0.86, hy - fh * 1.15, -0.09), flat, [0.055, 0.006, 0.012], 3, 6, LINER, MAT.SATIN);
      // a boss on the breastplate, the hasp at the seam, and a padlock off the right half when it's shut
      dot(at(0.55, plinth + 0.62 * (top - plinth), -0.07), 0.045, BAND);
      dot(at(0.97, plinth + 0.5 * (top - plinth), -0.075), 0.028, RIVET);
      if (side > 0 && k > 0.95) ellipsoid(props, at(0.99, plinth + 0.5 * (top - plinth) - 0.08, -0.105), flat, [0.035, 0.045, 0.015], 4, 7, BAND, MAT.METAL);
      // the spikes on the liner, each a long dark-metal spindle pointing in at you, its point lit cyan
      for (let i = 2; i < ROWS - 1; i += 2) for (let j = 1; j < COLS - 1; j += 2) {
        const a = at(j / (COLS - 1), yAt(i), 0.02), b = at(j / (COLS - 1), yAt(i), 0.12), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1, f = d.map((c) => c / L);
        const s = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], r = [f[1] * s[2] - f[2] * s[1], f[2] * s[0] - f[0] * s[2], f[0] * s[1] - f[1] * s[0]], rl = Math.hypot(...r), rn = r.map((c) => c / rl), u = [f[1] * rn[2] - f[2] * rn[1], f[2] * rn[0] - f[0] * rn[2], f[0] * rn[1] - f[1] * rn[0]];
        ellipsoid(props, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [f, rn, u], [L / 2, 0.012, 0.012], 4, 6, STUD, MAT.METAL);
        ellipsoid(props, b, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.008, 0.008, 0.008], 3, 4, TIP, MAT.EMISSIVE);
      }
      for (let i = 0; i < ROWS; i += 1) ellipsoid(props, at(0.985, yAt(i + 0.5), -0.02), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.012, (top - plinth) / ROWS * 0.55, 0.012], 3, 5, EDGE, MAT.EMISSIVE);
    }
    // the button inside by your right hand, lit; it flashes when you press it
    const press = S.phase === 'press' ? at(now) : 9, flashB = press < 0.6 ? 0.5 + 0.5 * Math.sin(press * 40) : 0;
    ellipsoid(props, W(R * 0.62, 1.05, -R * 0.15), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.035, 0.035, 0.02], 5, 8, flashB > 0.5 ? lin('#ffffff') : BTN, MAT.EMISSIVE);
    // the scan ring: a thin lit band
    const y = ringY(now), live = S.phase === 'scan' || (S.pulse > 0 && now - S.pulse < 700);
    grid(props, 2, 40, (i, j) => { const a = j / 40 * 6.283; return W(Math.cos(a) * R * 0.86, y + i * 0.025, Math.sin(a) * R * 0.86); }, { col: live ? RING : lin('#5aa8c0'), mat: live ? MAT.EMISSIVE : MAT.METAL });
    // steam: volumetric puffs (additive halos, gl/beast-light.js) jetting hard out of the seams, then slowing, curling
    // and swelling as they rise. Low down they take the orange off the plinth, higher up the cyan of the visor; when it
    // opens the whole charge rolls out across the floor as a ground fog
    halos.n = 0;
    if (S.steam > 0.01) {
      const T = now / 1000, hz = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
      for (let i = 0; i < 70; i++) {
        const speed = 0.55 + 0.5 * hz(i, 1), life = (T * speed + hz(i, 2)) % 1, seam = i % 3, yy = plinth + 0.2 + hz(i, 3) * (top - plinth - 0.35);
        const base = seam === 0 ? [0, R * prof(yy) + 0.02] : [(seam === 1 ? -1 : 1) * R * prof(yy), 0.05];
        const out = seam === 0 ? [0.35 * (hz(i, 4) - 0.5), 1] : [seam === 1 ? -1 : 1, 0.35];
        // the jet: fast out of the seam, braking hard (1 - e^-x), then buoyancy takes it up and the eddies curl it
        const reach = (1 - Math.exp(-life * 5)) * (0.35 + 0.5 * hz(i, 5)), rise = life * life * 0.9, curl = Math.sin(T * 2.3 + i) * 0.12 * life;
        const p = W(base[0] + out[0] * reach + curl, yy + rise, base[1] + out[1] * reach + Math.cos(T * 1.9 + i) * 0.08 * life);
        const r = 0.04 + 0.32 * Math.pow(life, 0.7), fade = Math.sin(Math.PI * Math.min(1, life * 1.15)) * (1 - life * 0.4);
        const warm = Math.max(0, 1 - (yy + rise - plinth) / 0.9);
        puff(p, [r * 1.15, r * 0.85, r * 1.15], [0.75 + 0.3 * warm, 0.85 - 0.2 * warm, 1.0 - 0.75 * warm], 0.22 * fade * S.steam);
      }
      // the release: a ring of fog rolling out over the floor from the plinth as it swings open
      if (S.phase === 'open' || S.phase === 'out') {
        const k = Math.min(1, at(now) / 1.6) + (S.phase === 'out' ? 1 : 0);
        for (let i = 0; i < 18; i++) {
          const a = i / 18 * 6.283 + Math.sin(T * 0.7 + i) * 0.15, d = R * (0.8 + 1.4 * Math.min(1.5, k) * (0.7 + 0.3 * hz(i, 6)));
          puff(W(Math.cos(a) * d, 0.08 + 0.05 * hz(i, 7), Math.sin(a) * d), [0.45, 0.12, 0.45], [0.7, 0.85, 1], 0.12 * S.steam * (1 - Math.min(1, k * 0.5)));
        }
      }
      // the flash as the body changes: a hot core of light bursting in the steam
      if (S.flash > 0) puff(W(0, H * 0.55, 0.2), [0.6, 0.9, 0.6], [1, 0.6, 0.3], 0.5 * S.flash);
    }
    // the body's own light, whenever you're in it: a warm key high to the front left, a cool fill off the right
    // and a hard rim from behind, so the face and the shape read while you change them
    const lit = S.phase !== 'out' && S.phase !== 'gone';
    const glows0 = lit ? [{ p: W(-0.9, 2.1, 1.6), c: [3.2, 2.9, 2.5], r: 4.0 }, { p: W(1.1, 1.3, 1.3), c: [0.9, 1.2, 1.5], r: 3.2 }, { p: W(0.2, 1.9, -0.7), c: [2.2, 2.6, 3.0], r: 2.4 }] : [];
    const glows = [...glows0, { p: W(0, y, 0), c: live ? [0.4, 0.9, 1.2] : [0.25, 0.5, 0.6], r: 1.6 }, { p: W(0, plinth + 0.05, 0), c: EDGE.map((c) => c * 0.9), r: 1.4 }];
    // the maiden lights you from inside once it has you: a cold key light off the visor, and the liner's studs
    if (S.phase === 'scan' || S.phase === 'menu' || S.phase === 'shut' || S.phase === 'steam') glows.push({ p: W(0, 0.8, R * 0.8), c: [1.0, 1.6, 2.0], r: 2.0 });
    if (S.flash > 0) glows.push({ p: W(0, H * 0.6, 0.3), c: [2.4 * S.flash, 1.3 * S.flash, 0.6 * S.flash], r: 4 });
    return glows;
  }
  // the camera: a three-quarter view from the front, closing in for the scan, drifting slowly round while you shop
  function cam(now) {
    const t = at(now);
    if (S.phase === 'scan' || S.phase === 'menu') {
      // inside the shut maiden, where its visor is: a hand in front of your face, looking at you
      const head = S.phase === 'menu' && S.tab === 'face' ? 1 : 0;
      S.headK = (S.headK || 0) + (head - (S.headK || 0)) * 0.08;
      const hk = S.headK, sway = S.phase === 'menu' ? Math.sin(now * 0.0004) * 0.08 : 0;
      const eye = W(sway, 1.35 + 0.3 * hk, piece.d / 2 + 0.9 - 1.0 * hk), look = W(-0.5 * (1 - hk), 1.05 + 0.6 * hk, 0);
      const d = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]], l = Math.hypot(...d) || 1;
      return { eye, yaw: Math.atan2(d[0] / l, d[2] / l), pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / l))), fov: 58 - 22 * hk, mode: 'free' };
    }
    const close = S.phase === 'steam' ? 0.4 : S.phase === 'shut' ? 0.4 * ease(t / 0.9) : S.phase === 'open' ? 0.4 * (1 - ease(t / 1.2)) : 0;
    const drift = S.phase === 'menu' ? Math.sin(now * 0.00025) * 0.5 : 0;
    // with the menu up on the right of the screen the pod sits left of centre
    const x = 1.2 + drift - 0.5 * close, z = piece.d / 2 + 3.1 - 0.7 * close, y = 1.75 - 0.15 * close;
    // the face's tab brings the camera in to the head
    const head = S.phase === 'menu' && S.tab === 'face' ? 1 : 0;
    S.headK = (S.headK || 0) + (head - (S.headK || 0)) * 0.08;
    const hk = S.headK, eye = W(x * (1 - 0.7 * hk), y + (1.72 - y) * hk, z - (z - piece.d / 2 - 0.4) * hk), look = W((S.phase === 'menu' ? -0.55 : 0) * (1 - 0.6 * hk), 1.15 + 0.5 * hk, 0);
    const d = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]], l = Math.hypot(...d) || 1;
    return { eye, yaw: Math.atan2(d[0] / l, d[2] / l), pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / l))), fov: 52 - 6 * close, mode: 'free' };
  }

  // you, walking in, standing in it, walking out
  let figWas = null, figDraft = null;
  function self(now) {
    const t = at(now);
    // the body inside shows the draft while you shop; under the steam it becomes what you bought, and after that
    // it's what the server sent (room-stage.js keeps me.look current)
    let look = S.phase === 'menu' || (S.phase === 'steam' && t < 1.2) ? draft : S.bought ? me.look : was;
    if (S.phase === 'steam' && t >= 1.2 && S.bought) look = draft;
    const key = JSON.stringify(look);
    if (figDraft?.key !== key) figDraft = { key, fig: playerFigure(look) };
    figWas = figDraft.fig;
    const body = { id: me.id, sculpt: true, sex: me.sex, figure: figWas, pose: 'stand' };
    if (S.phase === 'in') {
      // up to the front of it facing it, round, and back in: the turn's a quarter second each way of the middle
      if (t < 0.9) { const k = ease(t / 0.9); return { ...body, at: [outside[0] + (front[0] - outside[0]) * k, outside[1] + (front[1] - outside[1]) * k], yaw: faceIn, clip: 'walk' }; }
      if (t < 1.3) { const k = ease((t - 0.9) / 0.4); return { ...body, at: front.slice(), yaw: faceIn + (faceOut - faceIn) * k }; }
      const k = ease(Math.min(1, (t - 1.3) / 0.65));
      return { ...body, at: [front[0] + (inside[0] - front[0]) * k, front[1] + (inside[1] - front[1]) * k], yaw: faceOut, ...(k < 0.97 ? { clip: 'walk', phase: -t } : {}) };
    }
    if (S.phase === 'out' || S.phase === 'gone') {
      const k = ease(Math.min(1, t / 1.0));
      return { ...body, at: [inside[0] + (outside[0] - inside[0]) * k, inside[1] + (outside[1] - inside[1]) * k], yaw: faceOut, ...(k < 0.97 ? { clip: 'walk' } : {}) };
    }
    return { ...body, at: inside.slice(), yaw: faceOut };
  }

  let closed = false;
  function finish() { if (closed) return; close(); done?.({ at: outside.slice(), yaw: faceOut }); }
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(ticker);
    window.removeEventListener('keydown', onKey, true);
    ui.remove();
  }
  return {
    get on() { return !closed; },
    frame(now) { step(now); const glows = build(now); return { cam: cam(now), props, glass, halos, glows }; },
    self,
    // the server's answer to what you bought, as room_people sends it
    looked(look) { if (look) me.look = { ...look }; },
    close,
  };
}
