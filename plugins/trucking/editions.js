// TRUCK EDITIONS: a second body for a truck you already own (docs/proposals/hover-rigs.md).
//
// An edition is a body and a cab and nothing else. It changes no number in TYPES: same price on the
// lot, same deck, tank, gearbox and horn, so the ladder and the tuning don't move. It's fitted at the
// bench (`rig edition`), the way an aircraft's 2076 trim is chosen in the hangar, because a truck you
// have to sell to get the look is a truck you stop caring about.
//
// Stored as `trucks.custom_data.edition` (an id, absent for the stock body) and `owned_editions`, the
// horn's rule: paid for once, yours for good, swapping back is free. On the wire it's the mesh
// grammar's `~e<id>`, after the type and any `+t` (aircraft3d.js truckMeshFaces), which is the whole
// wire cost: contacts, the cab and the depot already carry the variant string.
//
// A body only exists if the mesh file names it in `variants`. Adding one is a row here and a generator
// under scripts/shapes/concepts/.

// Pearl and gold, the concept's own. A truck nobody has painted wears this with the body on.
const PEARL = { base: '#ece6da', trim: '#c9a23a', hw: '#2b303a', deck: '#d9d3c6', bright: '#d4af37', glow: '#3ad1c6', glass: '#22384c', chrome: 0.85, flash: 'none', finish: 'pearl' };
export const EDITIONS = {
  hauler: {
    2076: { name: 'Courier 2076', mul: 0.6, paint: PEARL,
      desc: "A pearl body and a glass cabin on the same chassis. It's no faster and it carries no more, but the dash knows what the trailer is doing." },
  },
};
const STOCK_DESC = 'The cab the truck left the factory with.';

export const editionsFor = (typeId) => EDITIONS[typeId] || {};
// What's on this truck, read against the catalogue: a retired id wears the stock body, not nothing.
export const editionOf = (cd, typeId) => (cd?.edition && editionsFor(typeId)[cd.edition] ? String(cd.edition) : null);
export const editionSuffix = (cd, typeId) => { const e = editionOf(cd, typeId); return e ? '~e' + e : ''; };
export const ownsEdition = (cd, id) => Array.isArray(cd?.owned_editions) && cd.owned_editions.includes(id);
// What it costs this truck now: nothing for the stock body or one it already has.
export function editionPrice(cd, typeId, type, id) {
  const e = editionsFor(typeId)[id];
  return !e || ownsEdition(cd, id) ? 0 : Math.round((type.price || 0) * e.mul);
}
// The bench's list, the stock body first. Empty for a truck with no second body.
export function editionCatalogue(cd, typeId, type) {
  const rows = Object.entries(editionsFor(typeId));
  if (!rows.length) return [];
  return [{ id: 'stock', name: 'Stock cab', desc: STOCK_DESC, price: 0 },
    ...rows.map(([id, e]) => ({ id, name: e.name, desc: e.desc, price: editionPrice(cd, typeId, type, id) }))];
}
// The factory paint a body brings, for a truck nobody has painted.
export const editionPaint = (cd, typeId) => { const e = editionOf(cd, typeId); return e ? editionsFor(typeId)[e].paint : null; };
