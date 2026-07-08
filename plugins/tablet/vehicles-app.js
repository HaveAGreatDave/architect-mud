// Tablet OS — Vehicles app. Aircraft-only today (no cars/boats exist in schema),
// but written generically against a `vehicleType` field so a future vehicle type
// needs no UI redesign. hull%/fuel% use the same shaping formula as the hangar
// bay panel (plugins/flight/hangars.js buildCards) — that function is scoped to
// one field's parked craft, so it can't be called directly for a global
// "everything I own" list; the formula itself (round((1-damage)*100) etc.) is
// duplicated here rather than the query.
import { query } from '../../server/models/db.js';
import { registerTabletApp } from './registry.js';

async function myAircraft(playerId) {
  const { rows } = await query(
    `SELECT a.id, a.name, a.damage, a.fuel, a.parked_zone_id, a.airborne, a.insured, a.custom_data,
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
    return {
      view: 'detail',
      breadcrumb: [v.tail],
      detail: {
        name: v.tail, desc: v.typeName,
        rows: [
          { label: 'Registration', value: v.tail },
          { label: 'Type', value: v.typeName },
          { label: 'Hull', value: `${v.hullPct}%` },
          { label: 'Fuel', value: `${v.fuelPct}%` },
          { label: 'Location', value: v.location },
          { label: 'Insured', value: v.insured ? 'Yes' : 'No' },
        ],
      },
      actions: [],
    };
  }

  return {
    view: 'list',
    breadcrumb: [],
    items: list.map(v => ({ id: v.id, label: v.tail, sub: `${v.typeName} · Hull ${v.hullPct}% · Fuel ${v.fuelPct}% · ${v.location}` })),
  };
}

registerTabletApp({
  id: 'vehicles', name: 'Vehicles', icon: '✈', category: 'Assets',
  buildHome, buildScreen,
});
