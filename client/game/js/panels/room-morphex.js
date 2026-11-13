// The MORPHEX pod on the Room Stage: you step into the machine, the door slides round, a ring scans you head to
// foot, a sales screen comes up over the glass and the body inside changes as you pick, then steam, a flash, and
// you step out somebody else. The pod itself is a piece (gl/room-decor.js 'morphex', `look.pod` on its row); this
// is its sequence, drawn as props over the room, and the menu over the picture.
//
// It decides nothing. Buying sends the same `morphex hair color …` lines the 2D panel sends (plugins/cosmetic-machine),
// which charge and refuse as they always have; the body you come out in is the one the server sends back in
// `room_people` (client/shared/player-figure.js). The draft on the body inside the pod is only a picture.
//
// room-stage.js hosts it: createMorphex(...) gives frame(now) → { cam, props, glass, glows }, self(now) → the body
// to draw for you (or null), and close(). It calls done({ at, yaw }) when you're out.

import { createBatch, grid, ellipsoid, lin, MAT } from './gl/ballpark-mesh.js';
import { facing, roomYaw } from '../../../shared/room-layout.js';
import { playerFigure } from '../../../shared/player-figure.js';
import { HAIR_STYLE_NAMES, FACE, SKIN_RGB, TATTOO_PLACES, TATTOO_INKS } from '../../../shared/morphex-catalog.js';
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
  const cu = piece.u + fu * 0.05, cv = piece.v + fv * 0.05;
  const loc = (x, z) => [cu + ru * x + fu * z, cv + rv * x + fv * z];
  const W = (x, y, z) => { const [u, v] = loc(x, z); return L.world(u, v, y); };
  const outside = loc(0, piece.d / 2 + 0.9), inside = loc(0, 0);
  const faceOut = roomYaw(L, fu, fv), faceIn = roomYaw(L, -fu, -fv);

  const was = copyLook(me.look), draft = copyLook(me.look);
  const S = { phase: 'in', t0: performance.now(), pulse: -1, steam: 0, flash: 0, bought: false, upsell: false, tier: 1, line: 0, tab: 'hair' };
  const props = createBatch(4096), glass = createBatch(4096);
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
      face: () => row('eye_color', 'Eyes', chips('eye_color', EYE_COLORS, ':')) + Object.entries(FACE).map(([k, F]) => row('face.' + k, F.label, chips('face.' + k, F.values, k === 'skin' ? 'skin:' : ''))).join(''),
      body: () => row('height_cm', 'Height', slider('height_cm', 150, 205, 'cm', 'Height in centimetres')) + row('weight_kg', 'Build', slider('weight_kg', 45, 130, 'kg', 'Weight in kilograms'))
        + `<label class="rmx-up"><input type="checkbox" data-up ${S.upsell ? 'checked' : ''}> Add CONFIDENCE™ for 0₵. <small>Does nothing. Most popular.</small></label>`,
      ink: () => row('ink', 'Ink <small>one for all of them</small>', chips('ink', Object.keys(TATTOO_INKS), 'ink:')) + Object.entries(TATTOO_PLACES).map(([p, T]) => row('tat.' + p, T.label, chips('tat.' + p, ['none', ...T.designs]))).join(''),
    }[S.tab];
    const scroll = ui.querySelector('.rmx-body')?.scrollTop || 0;
    ui.innerHTML = `
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
    if (b.dataset.act === 'buy') {
      for (const c of orders()) send(c);
      S.bought = true; ui.classList.remove('up'); go('steam');
    }
  });
  ui.addEventListener('input', (e) => {
    const k = e.target.dataset?.k;
    if (k) {
      draft[k] = Number(e.target.value); e.target.nextElementSibling.textContent = `${draft[k]} ${k === 'height_cm' ? 'cm' : 'kg'}`; S.pulse = performance.now();
      const n = orders().length, t = ui.querySelector('.rmx-total');
      if (t) { t.innerHTML = totalHtml(n); ui.querySelector('.rmx-buy').disabled = !n; }
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
    switch (S.phase) {
      case 'in': return 0;
      case 'shut': return ease(t / 0.7);
      case 'open': return 1 - ease(t / 0.7);
      case 'out': case 'gone': return 0;
      default: return 1;
    }
  }
  function step(now) {
    const t = at(now);
    if (S.phase === 'in' && t > 1.3) go('shut', now);
    else if (S.phase === 'shut' && t > 0.75) go('scan', now);
    else if (S.phase === 'scan' && t > 1.6) { go('menu', now); paint(); ui.classList.add('up'); }
    else if (S.phase === 'steam' && t > 2.6) go('open', now);
    else if (S.phase === 'open' && t > 0.75) go('out', now);
    else if (S.phase === 'out' && t > 1.1) { go('gone', now); finish(); }
    // steam builds over a second, holds while the body changes under it, and clears
    S.steam = S.phase === 'steam' ? (t < 0.9 ? ease(t / 0.9) : t < 1.5 ? 1 : 1 - ease((t - 1.5) / 1.1)) : Math.max(0, S.steam - 0.04);
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
  const GLASS = lin('#bfe6ff'), RING = lin('#9be7ff'), PINK = lin('#ff4fd8'), STEAM = lin('#eef6fa');
  function build(now) {
    props.n = 0; glass.n = 0;
    // the door: an arc of glass 220 degrees round, its middle at the back when open and the front when shut
    const k = doorK(now), span = 220 * Math.PI / 180, mid = Math.PI / 2 * -1 + k * Math.PI, segs = 28;
    const ang = (j) => mid - span / 2 + j / (segs - 1) * span;
    // `mid` is measured from the pod's +x toward +z; the open side faces +z
    const arcAt = (a, y, r) => W(Math.cos(a) * r, y, Math.sin(a) * r);
    grid(glass, 2, segs, (i, j) => arcAt(ang(j), plinth + 0.02 + i * (top - plinth - 0.06), R + 0.035), { wrap: false, col: GLASS, mat: MAT.GLOSS, centre: W(0, (top + plinth) / 2, 0) });
    // its chrome edges
    for (const j of [0, segs - 1]) grid(props, 2, 6, (i, s) => { const a = ang(j), r = R + 0.035, o = 0.012; return W(Math.cos(a) * r + Math.cos(s / 6 * 6.283) * o, plinth + 0.02 + i * (top - plinth - 0.06), Math.sin(a) * r + Math.sin(s / 6 * 6.283) * o); }, { col: lin('#d8dde3'), mat: MAT.METAL });
    // the scan ring: a thin lit band
    const y = ringY(now), live = S.phase === 'scan' || (S.pulse > 0 && now - S.pulse < 700);
    grid(props, 2, 40, (i, j) => { const a = j / 40 * 6.283; return W(Math.cos(a) * R * 0.86, y + i * 0.025, Math.sin(a) * R * 0.86); }, { col: live ? RING : lin('#5aa8c0'), mat: live ? MAT.EMISSIVE : MAT.METAL });
    // steam, a stack of soft balls filling the glass
    if (S.steam > 0.01) {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = i * 2.399, r = R * (0.25 + 0.5 * ((i * 37) % 10) / 10), yy = plinth + 0.2 + (i / n) * (top - plinth - 0.3);
        const s = (0.2 + 0.18 * Math.sin(now * 0.002 + i)) * S.steam;
        ellipsoid(glass, W(Math.cos(a + now * 0.0004) * r, yy, Math.sin(a + now * 0.0004) * r), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [s * 1.4, s, s * 1.4], 5, 8, STEAM, MAT.SATIN);
      }
    }
    const glows = [{ p: W(0, y, 0), c: live ? [0.4, 0.9, 1.2] : [0.25, 0.5, 0.6], r: 1.6 }, { p: W(0, plinth + 0.05, 0), c: PINK.map((c) => c * 0.8), r: 1.2 }];
    if (S.flash > 0) glows.push({ p: W(0, H * 0.6, 0.3), c: [2.4 * S.flash, 1.2 * S.flash, 2.2 * S.flash], r: 4 });
    return glows;
  }
  // the camera: a three-quarter view from the front, closing in for the scan, drifting slowly round while you shop
  function cam(now) {
    const t = at(now), close = S.phase === 'scan' || S.phase === 'menu' || S.phase === 'steam' ? 1 : S.phase === 'shut' ? ease(t / 0.7) : S.phase === 'open' ? 1 - ease(t / 0.7) : 0;
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
      const k = ease(Math.min(1, t / 1.15));
      return { ...body, at: [outside[0] + (inside[0] - outside[0]) * k, outside[1] + (inside[1] - outside[1]) * k], yaw: k < 0.85 ? faceIn : faceOut, ...(k < 0.97 ? { clip: 'walk' } : {}) };
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
    frame(now) { step(now); const glows = build(now); return { cam: cam(now), props, glass, glows }; },
    self,
    // the server's answer to what you bought, as room_people sends it
    looked(look) { if (look) me.look = { ...look }; },
    close,
  };
}
