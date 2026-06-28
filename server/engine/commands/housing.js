import { query } from '../../models/db.js';
import { getZone } from '../world.js';
import { getZonePowerStatus, getZoneVisibility, setWindowState, getWindowsForZone } from '../environment.js';
import { cmdRent, cmdUnrent, cmdLockDoor, cmdUpgradeLock, cmdPickLock, cmdSleep, cmdSetHome } from '../apartments.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';

const STAFF_ROLES = new Set(['admin','dev','builder','designer']);

async function cmdCurtain(targetStr, player, open) {
  const windows = getWindowsForZone(player.current_zone);
  if (!windows.length) return { type:'error', message:'There are no windows here.' };

  // Strip generic noise words to get a window-specific query
  const query = targetStr.replace(/\b(curtains?|windows?)\b/gi, '').trim();

  let win;
  if (!query) {
    if (windows.length === 1) {
      win = windows[0];
    } else {
      createSelectionState(player.id, windows, { verb: open ? 'open' : 'close' });
      return { type:'output', message: formatSelectionPage({ allCandidates: windows, visibleIndex: 0, pageSize: 5 }) };
    }
  } else {
    const sift = siftResolve(query, windows);
    if (sift.type === 'none') return { type:'error', message:`No window matching "${query}" here.` };
    if (sift.type === 'ambiguous') {
      createSelectionState(player.id, sift.candidates, { verb: open ? 'open' : 'close' });
      return { type:'output', message: formatSelectionPage({ allCandidates: sift.candidates, visibleIndex: 0, pageSize: 5 }) };
    }
    win = sift.candidate;
  }

  if (win.glass_state === 'broken') {
    return { type:'examine', message:`The curtains of ${win.name} are already compromised — the glass is broken.` };
  }
  if (win.curtain_open === (open ? 1 : 0)) {
    return { type:'examine', message:`The curtains of ${win.name} are already ${open ? 'open' : 'closed'}.` };
  }
  await setWindowState(win.id, { curtain_open: open ? 1 : 0 });
  return { type:'action', message: open
    ? `You pull the curtains open. ${win.name} now lets in whatever light is outside.`
    : `You draw the curtains closed. ${win.name} is blocked.` };
}

async function cmdLightView(player) {
  if (!STAFF_ROLES.has(player.role)) return { type:'error', message:'Permission denied.' };
  const zone = getZone(player.current_zone);
  if (!zone) return { type:'error', message:'Zone not found.' };

  const vis = getZoneVisibility(zone.id);
  const powerStatus = getZonePowerStatus(zone.id);
  const { rows: lights } = await query(`SELECT * FROM furniture WHERE zone_id=$1 AND object_type='light' ORDER BY light_type,name`, [zone.id]);
  const windows = getWindowsForZone(zone.id);

  const maxArtificial = powerStatus === 'powered' ? vis.artificialLight
    : lights.length > 0 ? Math.min(1, 0.3 + 0.7 * Math.min(1, lights.length / 4)) : 0;
  const maxWindowLight = windows.length > 0
    ? Math.min(1, windows.reduce((best, w) => Math.max(best, (w.light_transmission ?? 0.8)), 0) * (vis.ambientLight || 0.5))
    : 0;
  const isInterior = !!(zone.flags?.is_interior || zone.flags?.is_apartment);
  const maxLight = Math.min(1, Math.max(isInterior ? Math.max(maxArtificial, maxWindowLight) : vis.ambientLight, maxArtificial));

  return {
    type: 'lightview',
    zoneName: zone.name,
    zoneId: zone.id,
    isInterior,
    powerStatus,
    visibility: vis,
    maxLight,
    lights,
    windows,
  };
}

export const handlers = {
  rent:      (args, raw, player) => cmdRent(player),
  unrent:    (args, raw, player) => cmdUnrent(player),
  vacate:    (args, raw, player) => cmdUnrent(player),
  lock:      (args, raw, player) => cmdLockDoor(player, true),
  unlock:    (args, raw, player) => cmdLockDoor(player, false),
  pick:      (args, raw, player) => cmdPickLock(player),
  picklock:  (args, raw, player) => cmdPickLock(player),
  sleep:     (args, raw, player, broadcast) => cmdSleep(player, broadcast),
  rest:      (args, raw, player, broadcast) => cmdSleep(player, broadcast),
  upgrade: (args, raw, player) => {
    if (args[0] === 'lock') return cmdUpgradeLock(player);
    return { type:'error', message:'Upgrade what? Try "upgrade lock".' };
  },
  '.home': (args, raw, player) => cmdSetHome(player),
  open:  (args, raw, player) => cmdCurtain(args.join(' '), player, true),
  close: (args, raw, player) => cmdCurtain(args.join(' '), player, false),
  draw:  (args, raw, player) => cmdCurtain(args.join(' ') || 'curtains', player, false),
  lightview: (args, raw, player) => cmdLightView(player),
};
