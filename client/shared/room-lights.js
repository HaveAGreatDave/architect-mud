// A ROOM'S LIGHT SWITCH, this viewer's own (docs/proposals/one-world-interiors.md, phase D). Kept per room in
// localStorage, never sent: the Room Stage (panels/room-stage.js) and a room walked in GLASS (panels/freelook-view.js)
// read and flip the same switch, so a room you left dark on one is dark on the other. Its mains are the server's
// (`room_view.power`, `room_power`: 'on', 'low' or 'off', plugins/roomstage powerOf).
export const LIGHTS_KEY = 'roomLights';
const LIGHTS_KEPT = 300;

export function lightsSaved() {
  try { const o = JSON.parse(localStorage.getItem(LIGHTS_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
export function switchOf(zone) {
  const r = lightsSaved()[zone] || {};
  return { on: !r.off, level: Math.max(0.1, Math.min(1, Number(r.level) || 1)) };
}
export function saveSwitch(zone, on, level) {
  try {
    const o = lightsSaved();
    delete o[zone];
    if (!on || level < 0.995) o[zone] = { ...(on ? {} : { off: 1 }), ...(level < 0.995 ? { level: Math.round(level * 100) / 100 } : {}) };
    const ks = Object.keys(o);
    for (const k of ks.slice(0, Math.max(0, ks.length - LIGHTS_KEPT))) delete o[k];
    localStorage.setItem(LIGHTS_KEY, JSON.stringify(o));
  } catch { /* private window */ }
}
// Whether a room's lamps are lit: its switch is on and its mains aren't off.
export const litOf = (zone, power) => switchOf(zone).on && (power || 'on') !== 'off';
