// Tablet OS — Properties app. Queries the apartments table for units the player
// owns; action buttons delegate to the real verb handlers rather than
// reimplementing them:
//   - "Navigate" plots a gps_route the same way plugins/gps/index.js does.
//   - "Set Home" calls pinch's `home` command (plugins/pinch/index.js cmdHome) —
//     it already handles both "bind home here" (standing in an owned unit) and
//     "walk home" depending on where the player currently is.
// Deviation from the plan: there is no standalone "pay rent early" verb in this
// codebase — rent auto-collects on the game-day tick (server/engine/apartments.js).
// cmdRent/cmdUnrent only operate on player.current_zone (rent/vacate the unit
// you're standing in), so they aren't meaningfully wireable as a remote Tablet
// button either; omitted rather than fabricated.
import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { registerTabletApp } from './registry.js';

async function myApartments(playerId) {
  const { rows } = await query(
    'SELECT zone_id, building_name, rent_cost, rent_due_date, forcefield_active FROM apartments WHERE owner_id=$1 ORDER BY building_name, zone_id',
    [playerId]
  );
  return rows.map(r => ({
    id: r.zone_id, name: getZone(r.zone_id)?.name || r.zone_id,
    building: r.building_name || '', rentCost: r.rent_cost ?? 100,
    rentDue: r.rent_due_date, forcefield: !!r.forcefield_active,
  }));
}

async function buildHome(player) {
  const list = await myApartments(player.id);
  return { count: list.length };
}

async function buildScreen(player, screenId, params) {
  const list = await myApartments(player.id);
  const id = (params || '').trim();

  if (id) {
    const p = list.find(x => x.id === id);
    if (!p) return { view: 'error', message: 'Property not found.' };
    return {
      view: 'detail',
      breadcrumb: [p.name],
      detail: {
        name: p.name, desc: p.building,
        rows: [
          { label: 'Rent', value: `${p.rentCost}c` },
          { label: 'Rent due', value: p.rentDue || 'n/a' },
          { label: 'Forcefield', value: p.forcefield ? 'Active' : 'Inactive' },
          { label: 'Home set', value: player.home_zone === p.id ? 'Yes' : 'No' },
        ],
      },
      actions: [{ id: 'navigate', label: 'Navigate' }, { id: 'sethome', label: 'Set Home' }],
    };
  }

  return {
    view: 'list',
    breadcrumb: [],
    items: list.map(p => ({ id: p.id, label: p.name, sub: `${p.building ? p.building + ' · ' : ''}${p.rentCost}c/wk` })),
  };
}

async function handleAction(player, actionId, params) {
  const zoneId = (params || '').trim();
  if (!zoneId) return buildScreen(player, null, '');

  if (actionId === 'navigate') {
    const destZone = getZone(zoneId);
    if (destZone && zoneId !== player.current_zone) {
      const path = findPath(player.current_zone, zoneId);
      if (path && path.length >= 2) {
        sendToPlayer(player.id, { type: 'gps_route', message: `GPS locked: ${destZone.name}. Route plotted on the map.`, path });
      }
    }
    return buildScreen(player, null, zoneId);
  }

  if (actionId === 'sethome') {
    const { commands: pinchCommands } = await import('../pinch/index.js');
    const res = await pinchCommands.home([], 'home', player, () => {});
    if (res?.type === 'error') return { view: 'error', message: res.message };
    return buildScreen(player, null, zoneId);
  }

  return buildScreen(player, null, zoneId);
}

registerTabletApp({
  id: 'properties', name: 'Properties', icon: '🏠', category: 'Assets',
  buildHome, buildScreen, handleAction,
});
