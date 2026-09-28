// liveries:bake: write client/shared/liveries.js from content/liveries/*.json.
//
//   npm run liveries:bake
//
// The sibling of vehicles:bake. A livery is a few colours and a few ids, so this bake resolves
// nothing: it reads the directory, checks each file's shape (client/shared/livery-schema.js), runs
// its paint through the owning plugin's own sanitizer, and writes a module of literals.
//
// THE SANITIZER IS THE CHECK. Each plugin already coerces a paint patch to known values and drops
// the rest. A file whose value comes back changed is a value the game would never show, so it fails
// here instead of shipping a livery that quietly paints the default colours.
//
// Re-run after editing any file under content/liveries/. `node scripts/shapes/liveries.mjs` fails
// on a stale bake.
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLiveryDoc, liveryFileName, LIVERY_MODELS, ANY_MODEL } from '../../client/shared/livery-schema.js';
import { sanitizeLivery, LIVERY_DEFAULT, cleanPlate, TRIMS, CABIN_TRIMS } from '../../plugins/flight/livery.js';
import { sanitizePaint, PAINT_DEFAULT, sanitizeTrim } from '../../plugins/trucking/rig.js';
import { BOAT_DECALS } from '../../plugins/powerboat/service.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(ROOT, 'content', 'liveries');
export const OUT = join(ROOT, 'client', 'shared', 'liveries.js');

const HEX = /^#[0-9a-f]{6}$/i;

// One adapter per kind: which keys each half may carry, and the plugin's sanitizer run over them.
// `check` returns the keys whose value did not survive.
const changed = (given, got) => Object.keys(given).filter((k) => String(got[k]).toLowerCase() !== String(given[k]).toLowerCase());
const ADAPTERS = {
  aircraft: {
    exterior: ['base', 'trim', 'accent', 'ground', 'pattern', 'finish', 'decal', 'variant'],
    interior: ['cabin', 'uphol', 'itrim'],
    check(ext, int, model) {
      const got = sanitizeLivery({ ...ext, ...int }, { ...LIVERY_DEFAULT, variant: '\u0000', itrim: '\u0000' });
      const bad = changed({ ...ext, ...int }, got);
      // A factory scheme belongs to one class's mesh and cockpit; sanitizeLivery only knows it exists.
      const owns = (table, id) => id === 'stock' || (table[model] || []).some((t) => t.id === id);
      if (ext.variant && !bad.includes('variant') && !owns(TRIMS, ext.variant)) bad.push('variant');
      if (int.itrim && !bad.includes('itrim') && !owns(CABIN_TRIMS, int.itrim)) bad.push('itrim');
      return bad;
    },
    plate: (s) => cleanPlate(s) === s,
  },
  truck: {
    exterior: ['base', 'trim', 'hw', 'deck', 'bright', 'glow', 'glass', 'flash', 'finish', 'art', 'chrome'],
    interior: ['mat', 'col'],
    check(ext, int) {
      const bad = changed(ext, sanitizePaint(ext, PAINT_DEFAULT));
      if (Object.keys(int).length) bad.push(...changed(int, sanitizeTrim(int, {})).map((k) => 'interior.' + k));
      return bad;
    },
    plate: () => true,
  },
  boat: {
    exterior: ['base', 'trim', 'finish', 'decal'],
    interior: [],
    check(ext) {
      const bad = [];
      for (const k of ['base', 'trim']) if (k in ext && !HEX.test(ext[k])) bad.push(k);
      if ('decal' in ext && !BOAT_DECALS.some((d) => d.id === ext.decal)) bad.push('decal');
      return bad;
    },
    plate: () => true,
  },
};

export function readLiveryFiles(dir = SRC) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: f, doc: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

export function bakeLiveries(files = readLiveryFiles()) {
  const rows = [], errors = [], warnings = [];
  const seen = new Set(), defaults = new Map();
  for (const { file, doc } of files) {
    const v = validateLiveryDoc(doc, file);
    errors.push(...v.errors); warnings.push(...v.warnings);
    if (v.errors.length) continue;
    const want = liveryFileName(doc.kind, doc.model, doc.id);
    if (file !== want) { errors.push(file + ': this livery must be called ' + want); continue; }
    const key = doc.kind + '/' + doc.model + '/' + doc.id;
    if (seen.has(key)) { errors.push(file + ': ' + key + ' is authored twice'); continue; }
    seen.add(key);
    const ad = ADAPTERS[doc.kind];
    const ext = doc.exterior, int = doc.interior || {};
    for (const k of Object.keys(ext)) if (!ad.exterior.includes(k)) errors.push(file + ': exterior.' + k + ' is not a known ' + doc.kind + ' paint key');
    for (const k of Object.keys(int)) if (!ad.interior.includes(k)) errors.push(file + ': interior.' + k + ' is not a known ' + doc.kind + ' interior key');
    const known = new Set([...ad.exterior, ...ad.interior].flatMap((k) => [k, 'interior.' + k]));
    for (const k of ad.check(ext, int, doc.model).filter((k) => known.has(k))) errors.push(file + ': ' + k + ' has a value the ' + doc.kind + ' paint shop does not know');
    if (doc.plate != null && !ad.plate(doc.plate)) errors.push(file + ': plate "' + doc.plate + '" has letters the nameplate cannot print');
    if (doc.default) {
      const dk = doc.kind + '/' + doc.model;
      if (defaults.has(dk)) errors.push(file + ': ' + dk + ' already has a default (' + defaults.get(dk) + ')');
      else defaults.set(dk, doc.id);
    }
    rows.push({
      kind: doc.kind, model: doc.model, id: doc.id, name: doc.name, blurb: doc.blurb || '',
      default: !!doc.default, unlock: doc.unlock || null,
      exterior: ext, interior: int, plate: doc.plate || '',
    });
  }
  // Every aircraft class has a default, because that is how an unpainted aeroplane stops being
  // grey. Boats and trucks join as their depots move onto the shared livery.
  for (const model of LIVERY_MODELS.aircraft) {
    if (!defaults.has('aircraft/' + model)) errors.push('no default livery for aircraft/' + model + ' (add ' + liveryFileName('aircraft', model, 'stock') + ' with "default": true)');
  }
  // Defaults first, then by name, so a picker lists the factory look at the top.
  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.model.localeCompare(b.model)
    || (b.default - a.default) || (a.model === ANY_MODEL) - (b.model === ANY_MODEL) || a.name.localeCompare(b.name));
  return { rows, errors, warnings };
}

function lit(v) {
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (v === null || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(lit).join(', ') + ']';
  return '{ ' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ': ' + lit(v[k])).join(', ') + ' }';
}

export function renderModule({ rows }) {
  return [
    '// GENERATED by scripts/shapes/bake-liveries.mjs. Never edit by hand.',
    '//',
    '// Every authored livery (content/liveries/*.json): a whole look for one model, exterior,',
    '// interior and nameplate together. Read through client/shared/livery-sets.js.',
    '//',
    '// Re-run `npm run liveries:bake` after editing a livery file; `node scripts/shapes/liveries.mjs`',
    '// fails on a stale bake.',
    'export const LIVERIES = [',
    ...rows.map((r) => '  ' + lit(r) + ','),
    '];',
    '',
  ].join('\n');
}

export function bakeToString(files) {
  const res = bakeLiveries(files);
  return { ...res, text: res.errors.length ? null : renderModule(res) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { errors, warnings, text, rows } = bakeToString();
  for (const w of warnings) console.warn('warn: ' + w);
  if (errors.length) { for (const e of errors) console.error('error: ' + e); process.exit(1); }
  writeFileSync(OUT, text);
  console.log('liveries:bake: ' + rows.length + ' liveries → client/shared/liveries.js');
}
