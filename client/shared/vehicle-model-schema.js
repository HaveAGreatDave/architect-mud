// THE AUTHORED VEHICLE ROW — what one file under content/vehicle_models/ may hold.
//
// The sibling of building-model-schema.js and, deliberately, a much smaller thing. A building is
// authored as GEOMETRY: segments, adornments, an affine basis, a compile step. A vehicle is not.
// Its mesh is built by code in aircraft3d.js off a row of plain numbers, so what is authored here
// is that row and nothing else — there are no shapes in this format, and adding some would mean
// writing a second mesh builder to disagree with the first.
//
// It lives in client/shared/ for the same reason its sibling does: three processes read it — the
// bake, the shapes smoke and the Modelshop's editor, which validates in the browser before it asks
// the server to write. One rule, three callers.
//
// ⚠ A FIXED-WING FILE IS THE RESOLVED ROW, not a patch over FW_DEFAULT. The code table spread the
// defaults into each class, and a file that kept doing that would be unreadable on its own — you
// could not tell a Warthog's span from its file. FW_DEFAULT stays in aircraft3d.js as the starting
// point for a NEW class and as the fallback for a class with no row, and nothing else reads it.
//
// ⚠ THE HAND-AUTHORED MESHES HAVE NO ROW AND MUST NEVER BE GIVEN ONE. The Mayfly, the Cub, both
// helicopters and the wreck are meshes somebody drew, not proportions somebody set; a file naming
// one of them would be authored data that changes nothing, which is worse than no file at all.
export const VEHICLE_KINDS = ['fw', 'truck'];

// Which classes and truck types a file may claim. A row for anything else is a file the renderer
// would never read, so it fails the build rather than sitting there looking authoritative.
export const VEHICLE_IDS = {
  fw: ['prop', 'gunship', 'heavy', 'locust', 'divebomber'],
  truck: ['scrapper', 'hauler', 'drayman', 'continental'],
};

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Every leaf must be a finite number, a boolean, a string or null. That is not a style rule: the
// row is baked into a module as a JSON literal, so a value JSON cannot carry is a value that
// silently becomes something else — NaN and undefined both land as `null` in the mesh builder,
// where they read as "this field was not set" rather than as an error.
function leafErrors(v, path, out) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(path + ' is not a finite number');
    return;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => leafErrors(x, path + '[' + i + ']', out)); return; }
  if (isPlain(v)) { for (const k of Object.keys(v)) leafErrors(v[k], path + '.' + k, out); return; }
  out.push(path + ' is a ' + typeof v + ', which cannot be baked');
}

export function validateVehicleRow(doc, file = '<doc>') {
  const errors = [], warnings = [];
  const at = (m) => file + ': ' + m;
  if (!isPlain(doc)) return { errors: [at('not an object')], warnings };

  for (const k of Object.keys(doc)) {
    if (!['id', 'kind', 'params'].includes(k)) errors.push(at('unknown key ' + JSON.stringify(k)));
  }
  if (!VEHICLE_KINDS.includes(doc.kind)) {
    errors.push(at('kind must be one of ' + VEHICLE_KINDS.join(', ')));
    return { errors, warnings };
  }
  if (!VEHICLE_IDS[doc.kind].includes(doc.id)) {
    errors.push(at('no ' + doc.kind + ' row is called ' + JSON.stringify(doc.id)
      + ' — the renderer reads ' + VEHICLE_IDS[doc.kind].join(', ')));
  }
  if (!isPlain(doc.params)) { errors.push(at('params must be an object')); return { errors, warnings }; }
  if (!Object.keys(doc.params).length) errors.push(at('params is empty'));
  // The leaf pass runs even when the id was rejected, so one bad edit does not hide the next.
  const leaves = [];
  leafErrors(doc.params, 'params', leaves);
  errors.push(...leaves.map(at));
  return { errors, warnings };
}

// The filename a row is authored in. One rule, because the bake, the server's write path and the
// orphan check each need it and a second spelling of it is a file nothing reads.
export const vehicleFileName = (kind, id) => kind + '_' + id + '.json';
