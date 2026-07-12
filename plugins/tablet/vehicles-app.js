// Tablet OS — Vehicles app. Aircraft-only today (no cars/boats exist in schema),
// but written generically against a `vehicleType` field so a future vehicle type
// needs no UI redesign. hull%/fuel% use the same shaping formula as the hangar
// bay panel (plugins/flight/hangars.js buildCards) — that function is scoped to
// one field's parked craft, so it can't be called directly for a global
// "everything I own" list; the formula itself (round((1-damage)*100) etc.) is
// duplicated here rather than the query.
import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { registerTabletApp } from './registry.js';

async function myAircraft(playerId) {
  const { rows } = await query(
    `SELECT a.id, a.name, a.damage, a.fuel, a.parked_zone_id, a.airborne, a.insured, a.rental, a.custom_data,
            t.name AS type_name, t.fuel_capacity
     FROM aircraft a JOIN aircraft_types t ON t.id = a.type_id
     WHERE a.owner_id=$1 AND a.is_wreck=0
     ORDER BY a.name`,
    [playerId]
  );
  return rows.map(r => ({
    id: r.id, tail: r.name || r.type_name, typeName: r.type_name, vehicleType: 'aircraft',
    hullPct: Math.max(0, Math.round((1 - (r.damage || 0)) * 100)),
    fuelPct: Math.max(0, Math.min(100, Math.round((r.fuel / (r.fuel_capacity || 1)) * 100))),
    location: r.airborne ? 'Airborne' : (r.parked_zone_id || 'Unknown'),
    insured: !!r.insured,
    rental: !!r.rental,
    airborne: !!r.airborne,
  }));
}

async function buildHome(player) {
  const list = await myAircraft(player.id);
  return { count: list.length };
}

async function buildScreen(player, screenId, params) {
  const list = await myAircraft(player.id);
  const id = (params || '').trim();

  if (id) {
    const v = list.find(x => x.id === id);
    if (!v) return { view: 'error', message: 'Vehicle not found.' };
    // Sell (owned outright) or Cancel Rental — remote fleet management, no need
    // to trek to wherever she's parked. Hidden while airborne (the action itself
    // also refuses, but there's no point showing a button that'll just bounce).
    const actions = v.airborne ? [] : v.rental
      ? [{ id: 'cancel_rental', label: 'Cancel Rental' }]
      : [{ id: 'sell', label: 'Sell' }];
    return {
      view: 'detail',
      breadcrumb: [v.tail],
      detail: {
        id: v.id, name: v.tail, desc: v.typeName,
        rows: [
          { label: 'Registration', value: v.tail },
          { label: 'Type', value: v.typeName },
          { label: 'Hull', value: `${v.hullPct}%` },
          { label: 'Fuel', value: `${v.fuelPct}%` },
          { label: 'Location', value: v.location },
          { label: 'Insured', value: v.insured ? 'Yes' : 'No' },
          { label: 'Rental', value: v.rental ? 'Yes' : 'No' },
        ],
      },
      actions,
    };
  }

  // A plane can get stranded showing "Airborne" (crashed tab / lost connection /
  // server restart) — unsellable and unmanageable until it's grounded. Offer a
  // one-tap recovery when the fleet has any craft aloft.
  const stuckAloft = list.filter(v => v.airborne).length;
  return {
    // A non-empty breadcrumb matters beyond display here: the client's list-item
    // click handler resends the CURRENT breadcrumb's last entry as the screenId
    // token alongside the clicked id as params (client/game/js/panels/tablet-os.js
    // wireBody's [data-open-item] handler) — an empty breadcrumb makes it send
    // screenId:null, which shoves the aircraft id into the wrong argument slot
    // and buildScreen never sees an id (silently re-renders this same list).
    view: 'list',
    breadcrumb: ['Fleet'],
    items: list.map(v => ({ id: v.id, label: v.tail, sub: `${v.typeName} · Hull ${v.hullPct}% · Fuel ${v.fuelPct}% · ${v.location}` })),
    actions: stuckAloft ? [{
      id: 'flush_airborne',
      label: `Flush Airborne Aircraft (${stuckAloft})`,
      confirm: `Ground ${stuckAloft} aircraft still flagged airborne with nobody aboard? Use this if a plane is stuck showing "Airborne" and won't sell.`,
    }] : [],
  };
}

// Sell / Cancel Rental — the actual ownership logic (and the ID-based, land-
// anywhere gating) lives in plugins/flight/hangars.js; dynamically imported
// (same cross-plugin pattern quests-app.js uses to call into flight/contracts.js)
// so this app doesn't have to know anything about aircraft internals beyond
// "call this function with an id." Bottom-pane message either way, then stay on
// this vehicle's screen on failure or fall back to the fleet list once she's gone.
async function handleAction(player, actionId, params) {
  // Fleet-level recovery: ground any of the player's aircraft stranded airborne.
  if (actionId === 'flush_airborne') {
    const { flushAirborne } = await import('../flight/hangars.js');
    const n = await flushAirborne(player);
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${n ? `Grounded ${n} aircraft that ${n === 1 ? 'was' : 'were'} stuck aloft.` : 'No stranded aircraft to flush.'}</span>` });
    return buildScreen(player, null, '');
  }

  const aircraftId = (params || '').trim();
  if (!aircraftId || (actionId !== 'sell' && actionId !== 'cancel_rental')) return buildScreen(player, null, aircraftId);

  const { sellAircraft, cancelRental } = await import('../flight/hangars.js');
  const res = actionId === 'sell' ? await sellAircraft(player, aircraftId) : await cancelRental(player, aircraftId);

  const failed = res?.type === 'error';
  sendToPlayer(player.id, { type: 'output', message: failed ? `<span class="msg-system">${res.message}</span>` : (res?.message || '') });
  // On failure the error also renders inline on this screen (not just the chat
  // log behind the tablet overlay, easy to miss) — same buildScreen result, one
  // extra field spread on top.
  if (failed) return { ...(await buildScreen(player, null, aircraftId)), notice: res.message };
  if (res?.player_update) sendToPlayer(player.id, { type: 'player_update', ...res.player_update });
  return buildScreen(player, null, '');
}

registerTabletApp({
  id: 'vehicles', name: 'Vehicles', icon: '✈', category: 'Assets',
  buildHome, buildScreen, handleAction,
});
