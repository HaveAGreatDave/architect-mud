// The ESP (the city lockdown) from the Admin app and `sysop esp`. The emergency
// plugin owns it; this starts and stops it through the ESP_ACTIVATE and
// ESP_DEACTIVATE actions, as unrest does, so nothing imports across the plugin
// boundary. Whether it's on is read off `esp.changed`, which both the devpanel
// button and these actions fire, so the tablet and the devpanel always agree.
// The ESP is RAM-only and starts off on boot, so `false` is the right default.
import { on } from '../../server/engine/events.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { logActivity } from '../../server/models/db.js';

let active = false;
on('esp.changed', ({ active: a } = {}) => { active = !!a; });

export function espView() { return { active }; }

export async function setEsp(player, want, message) {
  if (want === active) return { ok: true, message: want ? 'The city is already locked down.' : 'The ESP is already off.' };
  if (want) {
    const msg = String(message || '').trim() || null;
    const r = await dispatchAction({ type: 'ESP_ACTIVATE', actor: player, params: { message: msg } });
    if (!r?.activated) return { ok: false, error: `The ESP didn't start${r?.reason ? `: ${r.reason}` : ''}.` };
    logActivity('admin_cmd', player.handle, null, `esp on${msg ? `: ${msg}` : ''}`);
    return { ok: true, message: `ESP on. Sirens across ${r.zones ?? 'every'} zones, the Curtain is shut and the South Lock is down.` };
  }
  const r = await dispatchAction({ type: 'ESP_DEACTIVATE', actor: player });
  if (!r?.deactivated) return { ok: false, error: `The ESP didn't stop${r?.reason ? `: ${r.reason}` : ''}.` };
  logActivity('admin_cmd', player.handle, null, 'esp off');
  return { ok: true, message: 'ESP off. The sirens wind down and the Curtain opens.' };
}
