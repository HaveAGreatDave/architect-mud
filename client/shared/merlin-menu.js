// THE MERLIN'S SETUP MENU (docs/proposals/merlin-menu.md).
//
// The HUD knob on the fascia, left of the yoke, opens it on the touch screen across the FANS and CHG
// pages (a tap on either page opens it too): a click opens it or picks the row under the cursor,
// turning the knob (the mouse wheel over it) moves the cursor, a long press steps the HUD colour as
// the knob always did. Rows, and the colour wheel on the HUD and LIGHTS pages, are tapped directly.
//
// Pure: the state is a plain object cockpit.js keeps on F.mrMenu and hands to the seat as
// `live.mrMenu`; the seat (interior-merlin.js) draws `menuRows()` and nothing else. No clock: the
// caller passes `now` (ms) for the idle close.
//
// Built: the HUD page (the HUD colour) and the LIGHTS page (the underglow, which the server keeps
// and other pilots see). TUNE and AUDIO are listed and say SOON.

export const MENU_IDLE_MS = 8000;      // untouched this long, it shuts and the map comes back
export const MENU_HOLD_MS = 450;       // a press held this long on the knob is the old colour step
export const MENU_MAX_ROWS = 5;

export const newMenu = () => ({ open: false, page: 'root', sel: 0, t: 0 });

// The rows of a page: { id, label, value?, off? }. `off` rows draw dim and pick nothing.
// `ctx.hudName` is the HUD colour's name (HUD_TINTS[id].name); `ctx.glowName` the underglow's, or OFF.
export function menuRows(M, ctx = {}) {
  if (M.page === 'hud') return [
    { id: 'hud.colour', label: 'COLOUR', value: ctx.hudName || 'GREEN' },
    { id: 'back', label: 'BACK' },
  ];
  if (M.page === 'lights') return [
    { id: 'glow.off', label: 'GLOW', value: ctx.glowName || 'OFF' },
    { id: 'back', label: 'BACK' },
  ];
  return [
    { id: 'tune', label: 'TUNE', value: 'SOON', off: true },
    { id: 'lights', label: 'LIGHTS' },
    { id: 'hud', label: 'HUD' },
    { id: 'audio', label: 'AUDIO', value: 'SOON', off: true },
    { id: 'close', label: 'CLOSE' },
  ];
}
export const menuTitle = (M) => (M.page === 'hud' ? 'SETUP / HUD' : M.page === 'lights' ? 'SETUP / LIGHTS' : 'CORVANE SETUP');
// The touch screen's right half: the HUD and LIGHTS pages show the colour wheel (the HUD's or the
// underglow's), every other page the Merlin's status (the wireframe, hull, charge and the owner).
export const menuPanel = (M) => (M.page === 'hud' || M.page === 'lights' ? 'wheel' : 'status');

// Turn the knob one detent: dir +1 down the list, -1 up. Opens the menu if it was shut.
export function menuTurn(M, dir, now, ctx) {
  if (!M.open) return menuOpen(M, now);
  const n = menuRows(M, ctx).length;
  M.sel = ((M.sel + dir) % n + n) % n;
  M.t = now;
  return null;
}
export function menuOpen(M, now) {
  M.open = true; M.page = 'root'; M.sel = 2; M.t = now;   // the cursor starts on HUD
  return null;
}
export const menuClose = (M) => { M.open = false; M.page = 'root'; M.sel = 0; };

// Pick a row (the cursor's, or `index` when a row was clicked on the screen). Returns the action the
// caller carries out, or null: 'hud.colour' (step the HUD colour) or 'glow.off' (underglow off).
// Navigation is handled here.
export function menuPick(M, now, ctx, index = M.sel) {
  if (!M.open) { menuOpen(M, now); return null; }
  const rows = menuRows(M, ctx), r = rows[index];
  M.t = now;
  if (!r) return null;
  M.sel = index;
  if (r.off) return null;
  if (r.id === 'close') { menuClose(M); return null; }
  if (r.id === 'back') { M.sel = M.page === 'lights' ? 1 : 2; M.page = 'root'; return null; }
  if (r.id === 'hud' || r.id === 'lights') { M.page = r.id; M.sel = 0; return null; }
  return r.id;
}

// Once a frame: shut it after the idle time.
export function menuTick(M, now) {
  if (M.open && now - M.t > MENU_IDLE_MS) menuClose(M);
}
