// Tablet OS (Phase 1) — the shell + app registry.
//
// `tablet`/`os` opens the CRT-style shell by returning a `tablet_panel` payload
// from the command handler, the same push mechanism ATM/Corp Console already use
// (a plugin command handler's return value IS the message sent back to the
// invoking player — see plugins/atm/index.js `cmdAtm` / plugins/corps/index.js
// `buildConsolePayload`). No new WS message type is needed for that direction.
//
// Inbound nav/action from the client reuses the exact same mechanism in reverse:
// silent commands (`tabletnav <screen> [params...]`, `tabletaction <appId> <action>
// [params...]`) sent via sendCmdSilent, mirroring how trade.js/atm.js relay button
// clicks back as ordinary verbs. This avoids inventing a new WS routing layer.
//
// registerTabletApp(appDef) (registry.js — split out to dodge an ESM import-
// hoisting TDZ, see that file's header) is a simple in-memory registry — an
// array + a function, matching the codebase's existing registerAction pattern —
// that other plugins (quests, jobboard, flight/contracts, atm, apartments) call
// at their own module init time to add a Home-screen tile.
//
// appDef shape:
//   {
//     id, name, icon, category,
//     buildHome(player) -> summary data shown as the Home-screen tile (optional extra),
//     buildScreen(player, screenId, params) -> full screen payload for this app,
//   }

import { query } from '../../server/models/db.js';
import { getOrg, getPlayerMembership, getZone } from '../../server/engine/world.js';
import { getGameDateTime } from '../../server/engine/environment.js';
import { getNetXp } from '../../server/engine/ip.js';
import { getTabletApps, findTabletApp } from './registry.js';

// Every "simple" app registers itself with registry.js at import time.
import './quests-app.js';
import './skills-app.js';
import './bank-app.js';
import './weather-app.js';
import './vehicles-app.js';
import './properties-app.js';
import './settings-app.js';
import './corp-app.js';
import './surveillance-app.js';
import './chat-app.js';
import './news-app.js';
import './map-app.js';
import './arcade-app.js';

export { registerTabletApp, getTabletApps } from './registry.js';

// ── Home screen ──────────────────────────────────────────────────────────────

async function buildHomePayload(player) {
  const { rows } = await query('SELECT credits, bank_credits FROM players WHERE id=$1', [player.id]);
  const p = rows[0] || {};
  const { total } = await getNetXp(player.id).catch(() => ({ total: 0 }));

  const membership = getPlayerMembership(player.id);
  const org = membership ? getOrg(membership.org_id) : null;

  const zone = getZone(player.current_zone);
  const { date, time } = getGameDateTime();

  const appTiles = [];
  for (const app of getTabletApps()) {
    let extra = null;
    if (typeof app.buildHome === 'function') {
      try { extra = await app.buildHome(player); } catch { extra = null; }
    }
    appTiles.push({ id: app.id, name: app.name, icon: app.icon || '▫', category: app.category || 'General', ...(extra || {}) });
  }

  return {
    type: 'tablet_panel',
    screen: 'home',
    player: {
      handle: player.handle,
      corp: org ? { name: org.name } : null,
      xp: total,
      credits: p.credits ?? player.credits ?? 0,
      bank_credits: p.bank_credits ?? player.bank_credits ?? 0,
    },
    time: { date, time },
    location: zone?.name || player.current_zone,
    apps: appTiles,
  };
}

async function cmdTablet(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  return buildHomePayload(player);
}

// tabletnav <screenSpec...> — screenSpec is "home" or "<appId> [screenId] [params...]"
// Re-invokes the relevant app's buildScreen and pushes the updated payload.
async function cmdTabletNav(args, raw, player) {
  if (!player) return { type: 'noop' };
  const [first, screenId, ...rest] = args || [];
  if (!first || first === 'home') return buildHomePayload(player);

  const app = findTabletApp(first);
  if (!app) return buildHomePayload(player);

  const params = rest.join(' ');
  try {
    const screen = await app.buildScreen(player, screenId || null, params);
    return { type: 'tablet_panel', screen: 'app', appId: app.id, appName: app.name, ...(screen || {}) };
  } catch (e) {
    return { type: 'tablet_panel', screen: 'app', appId: app.id, appName: app.name, error: e.message || 'Screen failed to load.' };
  }
}

// tabletaction <appId> <actionId> [params...] — an app-defined action button. Apps
// that need this implement an optional `handleAction(player, actionId, params,
// broadcast)` on their appDef and return the next screen payload themselves;
// otherwise falls back to re-rendering the app's current screen. `broadcast` is
// forwarded so an app can delegate straight into another plugin's command
// dispatcher (e.g. corp-app.js calling plugins/corps' own `corp` commands),
// which is the zone-visible-effects contract those commands expect.
async function cmdTabletAction(args, raw, player, broadcast) {
  if (!player) return { type: 'noop' };
  const [appId, actionId] = args || [];
  const app = findTabletApp(appId);
  if (!app) return buildHomePayload(player);
  // Re-derive params from `raw` (not the pre-lowercased `args`) so free-text
  // input keeps the player's casing — e.g. a corp name founded from the app.
  const params = raw.trim().split(/\s+/).slice(3).join(' ');

  if (typeof app.handleAction === 'function') {
    try {
      const result = await app.handleAction(player, actionId, params, broadcast);
      // An app can hand off to another client UI (e.g. quests-app.js routing
      // "Turn In" into an NPC's dialogue) by returning { type: 'tablet_close' }
      // instead of a screen payload — passed through as-is so the client closes
      // the tablet shell rather than re-rendering it on top of whatever the app
      // just opened.
      if (result?.type === 'tablet_close') return result;
      if (result) return { type: 'tablet_panel', screen: 'app', appId: app.id, appName: app.name, ...result };
    } catch (e) {
      return { type: 'tablet_panel', screen: 'app', appId: app.id, appName: app.name, error: e.message || 'Action failed.' };
    }
  }
  const screen = await app.buildScreen(player, null, '');
  return { type: 'tablet_panel', screen: 'app', appId: app.id, appName: app.name, ...(screen || {}) };
}

export const commands = {
  tablet: cmdTablet,
  os: cmdTablet,
  tabletnav: cmdTabletNav,
  tabletaction: cmdTabletAction,
};

console.log('[tablet] Plugin loaded.');
