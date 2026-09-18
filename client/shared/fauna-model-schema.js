// THE AUTHORED FAUNA ROW — what one file under content/fauna_models/ may hold.
//
// The third member of a family: building-model-schema.js authors GEOMETRY (segments, adornments,
// an affine basis, a compile step), vehicle-model-schema.js authors a ROW OF PROPORTIONS that code
// builds a mesh from, and this authors the same kind of row for an animal. There are no shapes in
// this format either, and adding some would mean writing a second mesh builder to disagree with
// fauna3d.js.
//
// ⚠ AN ANIMAL IS NOT A VEHICLE, which is why this is its own family and not a `kind` on the one
// next door. `aircraftFaces` is welded to CONTACT_SIZE, MODEL_SCALE, vehicleLamps, groundPitchFor
// and sortTruckFaces, and `vehicleRenderSmoke()` sweeps VEHICLE_CLASSES through drawAircraftModel
// — so a goose filed as a vehicle would arrive at livery palettes, jazz splatter, canopy glass,
// gear retraction and navigation lamps, every one of them a surface a goose has no business
// having and every one a way for a gate to fail on something that is not a bug.
//
// It lives in client/shared/ for the reason both its siblings do: three processes read it — the
// bake, the shapes smoke, and the Modelshop's editor, which validates in the browser before it
// asks the server to write. One rule, three callers.
export const FAUNA_KINDS = ['bird'];

// Which animals a file may claim. A row for anything else is a file the renderer would never
// read, so it fails the build rather than sitting there looking authoritative.
export const FAUNA_IDS = {
  bird: ['goose'],
};

// ⚠ THIS FORMAT SAYS MORE THAN "IT IS JSON", AND IT EARNS IT TWICE OVER.
//
// The vehicle schema deliberately types nothing, and the cost is written down there: a string
// where a number belongs is legal JSON, so it reaches the mesh builder as NaN, which paints
// nothing and throws nothing. That format is stuck with it — a fixed-wing row has forty fields
// including nested specs and enum strings like `rig: 'rack'`, so typing it would be a second copy
// of the builder's argument list. Its only guard is the push gate, which is a long way from the
// Save button.
//
// A FAUNA ROW HAS NO ENUMS. Every field is a proportion or a colour, which means the rule can be
// stated without naming a single number: **a string is only ever a colour, and a colour is only
// ever #rrggbb.** That closes both silent holes at once — `hex2rgb` answers null on a bad colour
// and `rgb(null,null,null)` is a string the headless stub accepts and a real browser throws on,
// while `Number('wide')` is NaN and draws a bird with no vertices.
//
// It was not theoretical. `{ span: 'wide' }` was posted at the Modelshop's own save route, passed
// validation, was written to content and was baked into the module — all four steps green.
export const COLOUR_FIELDS = new Set([
  'bodyCol', 'bellyCol', 'neckCol', 'cheekCol', 'billCol', 'wingCol', 'patchCol', 'legCol',
]);

const HEX = /^#[0-9a-fA-F]{6}$/;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Every leaf must be a finite number, a boolean, or — for a colour field only — a #rrggbb string.
// A value JSON cannot carry is a value that silently becomes something else: NaN and undefined
// both land as `null` in the mesh builder, where they read as "this field was not set" rather
// than as an error.
function leafErrors(v, path, key, out) {
  const colour = COLOUR_FIELDS.has(key);
  if (typeof v === 'boolean') return;
  if (typeof v === 'string') {
    if (!colour) out.push(path + ' is a string, and the only strings a fauna row may hold are the colours (' + [...COLOUR_FIELDS].join(', ') + ') — anything else reaches the mesh builder as NaN');
    else if (!HEX.test(v)) out.push(path + ' must be a #rrggbb colour, not ' + JSON.stringify(v) + ' (it would resolve to null and paint nothing)');
    return;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(path + ' is not a finite number');
    else if (colour) out.push(path + ' is a colour field and must be a #rrggbb string');
    return;
  }
  if (v === null) { out.push(path + ' is null — a field a row does not set is left OUT, so that the mesh builder\'s own default applies'); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => leafErrors(x, path + '[' + i + ']', key, out)); return; }
  if (isPlain(v)) { for (const k of Object.keys(v)) leafErrors(v[k], path + '.' + k, k, out); return; }
  out.push(path + ' is a ' + typeof v + ', which cannot be baked');
}

export function validateFaunaRow(doc, file = '<doc>') {
  const errors = [], warnings = [];
  const at = (m) => file + ': ' + m;
  if (!isPlain(doc)) return { errors: [at('not an object')], warnings };

  for (const k of Object.keys(doc)) {
    if (!['id', 'kind', 'params'].includes(k)) errors.push(at('unknown key ' + JSON.stringify(k)));
  }
  if (!FAUNA_KINDS.includes(doc.kind)) {
    errors.push(at('kind must be one of ' + FAUNA_KINDS.join(', ')));
    return { errors, warnings };
  }
  if (!FAUNA_IDS[doc.kind].includes(doc.id)) {
    errors.push(at('no ' + doc.kind + ' row is called ' + JSON.stringify(doc.id)
      + ' — the renderer reads ' + FAUNA_IDS[doc.kind].join(', ')));
  }
  if (!isPlain(doc.params)) { errors.push(at('params must be an object')); return { errors, warnings }; }
  if (!Object.keys(doc.params).length) errors.push(at('params is empty'));
  // The leaf pass runs even when the id was rejected, so one bad edit does not hide the next.
  const leaves = [];
  for (const k of Object.keys(doc.params)) leafErrors(doc.params[k], 'params.' + k, k, leaves);
  errors.push(...leaves.map(at));
  return { errors, warnings };
}

// The filename a row is authored in. One rule, because the bake, the server's write path and the
// orphan check each need it and a second spelling of it is a file nothing reads.
export const faunaFileName = (kind, id) => kind + '_' + id + '.json';
