// Tablet OS — Gear app. A tablet-native view of the equipment screen: the same
// worn loadout, per-region soak, and passive effects the `gear` command feeds the
// desktop panel, presented as a paperdoll over a human silhouette. It reuses
// cmdGear (server/engine/commands/inventory.js) so the numbers are identical to
// the desktop Gear panel — one source of truth. The client (panels/tablet-os.js
// renderGear) draws the silhouette, per-slot boxes, and the layer selector.
import { registerTabletApp } from './registry.js';
import { cmdGear } from '../../server/engine/commands/inventory.js';

async function buildGear(player) {
  const g = await cmdGear(player);
  return {
    view: 'gear',
    items: g.items,
    effects: g.effects,
    weight: g.weight,
    capacity: g.capacity,
  };
}

registerTabletApp({
  id: 'gear',
  name: 'Gear',
  icon: '🧥',
  category: 'General',
  buildScreen(player) {
    return buildGear(player);
  },
});
