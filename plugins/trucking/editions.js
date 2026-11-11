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
// The gold is `trim`, a paint (concepts/courier-2076.mjs `gilt`); `bright` is the brightwork, drawn as
// chrome, so it stays a neutral chrome or the sky in it turns olive.
const PEARL = { base: '#ece6da', trim: '#c9a23a', hw: '#2b303a', deck: '#d9d3c6', bright: '#e2e8f0', glow: '#3ad1c6', glass: '#22384c', chrome: 0.85, flash: 'none', finish: 'pearl' };
// Gunmetal and hazard orange, after the Bulwark HX.
const BULWARK = { base: '#4a4f57', trim: '#e8731c', hw: '#1e2126', deck: '#3a3e45', bright: '#c8ccd2', glow: '#ff9a2e', glass: '#1c2630', chrome: 0.45, flash: 'none', finish: 'satin' };
// Navy and teal, after the Strand.
const STRAND = { base: '#1b2a44', trim: '#2ab7b0', hw: '#11161f', deck: '#243248', bright: '#3ce0d4', glow: '#3ce0d4', glass: '#0e1a26', chrome: 0.35, flash: 'none', finish: 'metallic' };
// Rust and primer, after the Mule. Matte, not weathered: weathering greys every panel alike, and the
// salvaged door and the primer have to read as different panels.
const MULE = { base: '#8a4a2a', trim: '#8f8e86', hw: '#2a2622', deck: '#5a4636', bright: '#b4b0a6', glow: '#ffae42', glass: '#2a3236', chrome: 0.12, flash: 'rust', finish: 'matte' };
export const EDITIONS = {
  hauler: {
    2076: { name: 'Courier 2076', mul: 0.6, paint: PEARL,
      desc: "A pearl body and a glass cabin on the same chassis. It's no faster and it carries no more, but the dash knows what the trailer is doing." },
  },
  continental: {
    2076: { name: 'Continental 2076', mul: 0.6, paint: BULWARK,
      desc: 'A slab cab with grille slats, a light bar and twin horns on the roof, on heavy pads under a deep skirt. Same sleeper, same deck, and a dash that shows the whole rig.' },
  },
  drayman: {
    2076: { name: 'Drayman 2076', mul: 0.6, paint: STRAND,
      desc: "Dark and smooth, with a lit visor over the screen and sensor masts on the roof. It looks like it drives itself. It doesn't." },
  },
  scrapper: {
    2076: { name: 'Barrow 2076', mul: 0.6, paint: MULE,
      desc: 'A secondhand 2076 body cut down to fit a Barrow, with two stacks, a pod cradle on the roof and somebody else\'s fleet number. Half the dash works.' },
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
