// models:bake — write client/shared/building-models.js from content/building_models/*.json.
//
//   npm run models:bake
//
// The sibling of shapes:bake, pointing the other way. That one captures CODE and emits
// data for the cold open; this one reads AUTHORED data and emits the module the renderer
// itself loads.
//
// WHY A BAKE AND NOT A RUNTIME READ. windshield.js must not read content/ — it runs in a
// browser, there is no build step, and the cold open must stay free of it entirely. So
// the authored files are resolved here, once, into the exact shape the renderer already
// understands: every geometric scalar as an affine [a·fh + b·h + c] triple, which is what
// a captured segment is. That is the whole trick — an authored model and a captured one
// are the same data by the time anything draws them, so SHAPE_SINK, the LOD, the ground
// shadow, the occlusion hull, CFIT collision and the cold open all work on it with no
// change of their own.
//
// ⚠ Re-run after editing any file under content/building_models/. `npm run shapes:smoke`
// fails if you forget — it re-bakes in memory and diffs against the committed file,
// naming the models that drifted. A stale bake is a red test, never a silent one.
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateModel, compileModel } from '../../client/shared/building-model-schema.js';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'content', 'building_models');
const OUT = join(ROOT, 'client', 'shared', 'building-models.js');


export function readModelFiles(dir = SRC) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({
    file: f,
    doc: JSON.parse(readFileSync(join(dir, f), 'utf8')),
  }));
}

// The doc→record compile lives in client/shared/building-model-schema.js, NOT here, because the
// Modelshop's editor runs it in a browser on every keystroke. Two compiles is how a tool starts
// drawing something the build would not produce. This file owns only what a browser cannot do:
// reading the directory, resolving collisions ACROSS files, and writing the module.
export function bakeModels(files = readModelFiles()) {
  const models = {}, errors = [], warnings = [], byKey = new Map();
  for (const { file, doc } of files) {
    const v = validateModel(doc, file);
    errors.push(...v.errors); warnings.push(...v.warnings);
    if (v.errors.length) continue;

    const { rec, warnings: w, bindings } = compileModel(doc, file);
    warnings.push(...w);

    for (const key of bindings) {
      if (byKey.has(key)) {
        errors.push(`${file}: bind '${key}' is already claimed by ${byKey.get(key)} — two authored models cannot resolve to the same building`);
        continue;
      }
      byKey.set(key, file);
      models[key] = rec;
    }
  }
  return { models, errors, warnings };
}

function renderModule(models) {
  const body = Object.entries(models)
    .map(([k, m]) => `  ${JSON.stringify(k)}: ${JSON.stringify(m)},`)
    .join('\n');
  return `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Authored GLASS building models, baked from content/building_models/*.json by
// \`npm run models:bake\`. \`npm run shapes:smoke\` fails if this file is stale.
//
// Keyed by the same key space shapeModelRegistry() uses — \`named:<slug>\` for a
// building_name and \`type:<building_type>\` for a building_type. windshield.js merges
// these into NAMED_MODELS / TYPE_MODEL at load, and never over a hand-written arm.
//
// Every geometric scalar is an affine triple [a, b, c] meaning a·fh + b·h + c, which is
// exactly what SHAPE_SINK capture produces for a code arm. That is deliberate: by the
// time anything draws one, an authored model and a captured one are the same data.
export const AUTHORED_MODELS = {
${body}
};
`;
}

async function main() {
  const { models, errors, warnings } = bakeModels();
  for (const w of warnings) console.warn('  ! ' + w);
  if (errors.length) {
    for (const e of errors) console.error('  ✗ ' + e);
    console.error(`✗ models:bake — ${errors.length} error(s); nothing written.`);
    process.exit(1);
  }
  const text = renderModule(models);
  writeFileSync(OUT, text, 'utf8');
  const n = Object.keys(models).length;
  const segs = Object.values(models).reduce((a, m) => a + m.segs.length, 0);
  console.log(`✓ models:bake — ${n} binding(s), ${segs} segments → client/shared/building-models.js (${(text.length / 1024).toFixed(1)} kB)`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

export { renderModule, OUT };
