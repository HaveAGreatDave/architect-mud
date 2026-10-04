// THE AUTHORED LIVERY: what one file under content/liveries/ may hold.
//
// A livery is a whole look for one model: the exterior paint, the interior, and the name on the
// nameplate, sold as a set. Devs author them here; players save their own onto the vehicle
// (custom_data.livery.schemes on an aircraft), and both are applied at the depot for the same fee.
//
// The files are baked into client/shared/liveries.js by `npm run liveries:bake`, the same way
// vehicle_models are baked, so the server and the client read one module of literals and nothing
// queries a table for them. `node scripts/shapes/liveries.mjs` fails on a stale bake.
//
// This file checks SHAPE only. Whether `pattern: "tiger"` means anything is the owning plugin's
// vocabulary, and the bake runs each file through that plugin's own sanitizer (see
// scripts/shapes/bake-liveries.mjs), so a value the game would silently drop fails the build.
//
// `exterior` and `interior` are the kind's native paint objects, not a new vocabulary:
//   aircraft  exterior = plugins/flight/livery.js fields (base trim accent ground pattern finish decal variant)
//             interior = cabin uphol itrim
//   truck     exterior = plugins/trucking/rig.js sanitizePaint; interior = client/shared/cab-trim.js sanitizeTrim
//   boat      exterior = base trim finish decal (plugins/powerboat/service.js)
//
// ⚠ A MODEL OF 'any' IS A GENERIC SCHEME, offered on every model of its kind. It can never be a
// model's default, because a default is what makes one model look like itself.

export const LIVERY_KINDS = ['aircraft', 'boat', 'truck'];

// Which models a file may claim. An aircraft livery keys on the CLASS (the mesh and the cockpit
// are per class), a truck on its type id, a boat on its hull.
export const LIVERY_MODELS = {
  aircraft: ['prop', 'gunship', 'heavy', 'locust', 'divebomber', 'heli', 'ultralight', 'grasshopper', 'drake'],
  boat: ['hydro', 'spur', 'gamecock'],
  truck: ['scrapper', 'hauler', 'drayman', 'continental'],
};
export const ANY_MODEL = 'any';

export const LIVERY_NAME_MAX = 32;
export const LIVERY_BLURB_MAX = 140;
export const LIVERY_PLATE_MAX = 16;

export const liveryFileName = (kind, model, id) => kind + '_' + model + '_' + id + '.json';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const SLUG = /^[a-z0-9_]+$/;
const FLAG_KEY = /^[a-z0-9_:.-]+$/;
const TOP_KEYS = new Set(['kind', 'model', 'id', 'name', 'blurb', 'default', 'unlock', 'exterior', 'interior', 'plate']);

export function validateLiveryDoc(doc, file = '?') {
  const errors = [], warnings = [];
  const err = (m) => errors.push(file + ': ' + m);
  if (!isPlain(doc)) { err('not an object'); return { errors, warnings }; }
  for (const k of Object.keys(doc)) if (!TOP_KEYS.has(k)) err('unknown key "' + k + '"');
  if (!LIVERY_KINDS.includes(doc.kind)) err('kind must be one of ' + LIVERY_KINDS.join(', '));
  const models = LIVERY_MODELS[doc.kind] || [];
  if (doc.model !== ANY_MODEL && !models.includes(doc.model)) err('model "' + doc.model + '" is not a ' + doc.kind + ' model (' + models.join(', ') + ', or any)');
  if (typeof doc.id !== 'string' || !SLUG.test(doc.id)) err('id must be a lowercase slug');
  if (typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > LIVERY_NAME_MAX) err('name must be 1-' + LIVERY_NAME_MAX + ' characters');
  if (doc.blurb != null && (typeof doc.blurb !== 'string' || doc.blurb.length > LIVERY_BLURB_MAX)) err('blurb must be a string of ' + LIVERY_BLURB_MAX + ' characters or fewer');
  if (doc.default != null && typeof doc.default !== 'boolean') err('default must be true or false');
  if (doc.default && doc.model === ANY_MODEL) err('a generic (any) livery cannot be a default');
  if (doc.default && doc.unlock) err('a default livery cannot be locked');
  if (doc.unlock != null && (typeof doc.unlock !== 'string' || !FLAG_KEY.test(doc.unlock))) err('unlock must be null or a player flag key');
  if (!isPlain(doc.exterior)) err('exterior must be an object');
  if (doc.interior != null && !isPlain(doc.interior)) err('interior must be an object');
  if (doc.plate != null && (typeof doc.plate !== 'string' || doc.plate.length > LIVERY_PLATE_MAX)) err('plate must be a string of ' + LIVERY_PLATE_MAX + ' characters or fewer');
  for (const part of ['exterior', 'interior']) {
    if (!isPlain(doc[part])) continue;
    for (const [k, v] of Object.entries(doc[part])) {
      if (!(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) err(part + '.' + k + ' must be a string, number or boolean');
    }
  }
  return { errors, warnings };
}
