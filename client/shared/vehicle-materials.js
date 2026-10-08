// WHAT A VEHICLE'S EXTERIOR IS MADE OF: one number per face, read by the GPU's solids layer
// (gl/solids.js) and the 2-D renderer's reflectEnv (windshield.js). Positive is a metal, a tinted
// mirror of the world; negative is a clear coat, untinted and strongest at grazing; 0 is flat.
//
// The engine owns the vocabulary and the rules; the meshes own which part is which. A paint slot in
// a mesh file says what it's made of with `mat`, and a mesh says what its paintwork is with
// `finish` (content/vehicle_models/mesh_*.json, compiled by compileMesh in vehicle-mesh.js).
//
// ⚠ THIS USED TO BE A TABLE OF THE DRAKE'S SLOT NAMES, matched by name on every mesh. `belly` and
// `seam` are slots on the Mule, the Leviathan, the Reaper and the Shrike too, so their bellies came
// out as 0.4 metal mirrors, and the Reaper's guns took the Drake's chrome. Her numbers now live in
// her own file, and a name means nothing here.

// The words a mesh may use for `mat` or `finish`. A number is taken as the value itself.
export const VEHICLE_MATS = {
  chrome: 0.95,      // polished brightwork
  polished: 0.75,    // polished alloy: a spinner, a hub
  blued: 0.6,        // gun steel
  bare: 0.55,        // unpainted aluminium skin
  steel: 0.4,        // dull hardware, fan blades, a grille
  exhaust: 0.3,      // heat-dulled pipe
  metallic: -0.3,    // the coats a livery can choose, at the values the booth's finishes give
  candy: -0.26,
  gloss: -0.22,
  pearl: -0.2,
  satin: -0.1,
  matte: 0,          // flat paint, anti-glare panels, fabric
  rubber: -0.08,     // tyres, de-icing boots: a faint sheen and no more
  glass: -0.55,
};
// A livery's finish → its clear coat. Satin, matte, weathered and primer have none.
export const CLEARCOAT = { gloss: 0.22, metallic: 0.3, candy: 0.26, pearl: 0.2 };
// What a face with no slot is made of, by what it does.
export const METAL_ROLE = { gear: 0.45, strut: 0.4, gun: 0.6, ramp: 0.28, glass: -0.55, window: -0.55 };
// The roles a livery paints, so the roles a mesh's `finish` covers.
export const PAINT_ROLE = new Set(['body', 'wing', 'aileron', 'flap', 'stab', 'elevator', 'fin', 'rudder', 'nacelle', 'deck', 'accent', 'trim']);

// A `mat` or `finish` value → its number, or undefined if it isn't one.
export function matK(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= -1 && v <= 1 ? v : undefined;
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(VEHICLE_MATS, v) ? VEHICLE_MATS[v] : undefined;
}

// The material of one exterior face under one palette (aircraft3d.js liveryPalette).
//
// ⚠ THE OWNER'S PAINT DECIDES ITS OWN FINISH. A fixed slot (a gun, an exhaust, a tyre) keeps what
// the mesh says it is whatever the booth did. A slot the owner can paint keeps the factory finish
// only while the factory paint is on it; repainted, it takes the finish they chose. A metal slot
// that is also paint (the Drake's candy shell) stays metal either way: that is her finish.
export function metalKOf(face, pal) {
  // Truck brightwork. With the chrome switched off it is blacked out, which is paint, not glass:
  // the brightwork is role `window` for the old specular pass, so the role read it as a pane.
  if (face.pk === 'bright') return pal.chrome !== 0 ? VEHICLE_MATS.chrome : VEHICLE_MATS.satin;
  const coat = CLEARCOAT[pal.finish] || 0;
  // A face that says what it's made of (buildBoat's `mk`, a tyre). A boat's gelcoat is paint, so a
  // livery coat replaces it; a fixed fitting or a tyre is not, so nothing does.
  if (face.mk !== undefined) return face.mk < 0 && !face.fixed && coat && PAINT_ROLE.has(face.role) ? -coat : face.mk;
  const slot = face.paint && typeof face.paint === 'object' ? face.paint : null;
  const owned = (s) => !pal.factory && (!s || s.livery !== 'fixed' || !!(pal.parts && pal.parts[s.name]));
  if (slot && slot.mat !== undefined) return slot.mat <= 0 && owned(slot) ? -coat : slot.mat;
  // ⚠ A NAMED PAINT SLOT BEATS THE ROLE. `role` says what a face DOES (it retracts with the gear),
  // the slot says what it is MADE of. The Drake's gear doors are role `gear` painted `belly` cream,
  // and as a 0.45 mirror each flat door turned into a bright pale square beside the minigun.
  const m = slot && face.role !== 'glass' && face.role !== 'window' ? 0 : METAL_ROLE[face.role];
  if (m) return m;
  // A mesh that declares its finish (`coat`, stamped by compileMesh from `finish`).
  if (face.coat !== undefined) {
    if (!slot && !PAINT_ROLE.has(face.role)) return 0;
    return owned(slot) ? -coat : face.coat;
  }
  // Everything else: the livery's coat on the painted parts, as it always was.
  if ((face.role === 'body' || face.role === 'accent' || face.role === 'trim' || face.paint) && coat) return -coat;
  return 0;
}
