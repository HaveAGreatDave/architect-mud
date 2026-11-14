// What a furniture item becomes when it's set down as a row: its verbs, its row type, and the authored row staff
// put in a room. Pure, so the game server (server/engine/furniture-shop.js, plugins/roomstage) and the Modelshop's
// Room Lab (tools/modelshop/serve.mjs, which writes content/furniture files with no database) build the same row.

export function furnitureInteractions(item) {
  const ix = item?.flags?.interactions;
  return Array.isArray(ix) ? ix : [];
}

// The `furniture.object_type` a placed piece is born as. A piece that HOLDS
// things has to be a `container`: `loadContainerById` and every `stow`/`open`
// path find a furniture container by `object_type='container'` and nothing
// else, so a bought fridge inserted as plain 'furniture' was a fridge you could
// never open, while the authored twin of the same appliance is a 'container'.
// Derived from the capacity flag, so no item declares its own row type.
export function furnitureObjectType(flags) {
  return Number(flags?.container) > 0 ? 'container' : 'furniture';
}

// The row a furniture item is set down as by staff (the arrange mode's + Furniture): placeFurnitureFromItem's row,
// but authored, with no owner and standing at `spot`. `tag` makes the id its own (a few random hex characters);
// the id reads as the room and the item, `furn_apt_3_sofa_busted_3f2a`.
export function authoredFurnitureRow(item, zoneId, spot, tag) {
  const flags = { ...(item.flags || {}), interactions: furnitureInteractions(item), item_id: item.id, spot };
  const draw = Number(flags.power_draw_kw);
  delete flags.power_draw_kw;
  const slug = (s) => String(s).toLowerCase().replace(/^((zone|item|furn)_)+/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
  return {
    id: `furn_${slug(zoneId)}_${slug(item.id)}_${tag}`, zone_id: zoneId, name: item.name,
    description: item.tags?.description ?? item.description ?? item.name, flags, object_type: furnitureObjectType(flags),
    price: item.value ?? null, origin: 'authored', ...(Number.isFinite(draw) ? { power_draw_kw: draw } : {}),
  };
}
