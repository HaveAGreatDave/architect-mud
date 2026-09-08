// THE AUTHORED BUILDING-MODEL SCHEMA — one table, and the validator over it.
//
// ⚠ IT LIVES IN client/shared BECAUSE THREE PROCESSES READ IT, and only this directory is
// reachable from all three: the bake (node), shapes:smoke (node), and the Modelshop's editor
// (a browser, which compiles an edit to runtime shape live so the preview updates as you type).
// Same precedent as tagCatalog.js, which server/engine/tags.js imports for exactly this reason.
// A second copy of a validator is how a tool starts authoring things the build rejects.
//
// A GLASS building model has always been code: ~145 `case` arms inside drawTypeModel
// (client/game/js/panels/windshield.js). This is the data format that lets one be
// authored instead, as a file under content/building_models/.
//
// Read docs/reference/building-shapes.md first. Two of its rules are load-bearing here
// and both are enforced below rather than described:
//
//   · EVERY GEOMETRIC SCALAR IS AFFINE IN (fh, h) — `a·fh + b·h + c`. An author types
//     a plain number in tile units at a fixed basis and tags which one it scales with;
//     the triple is derived. A MIXED triple (both a and b non-zero) is deliberately not
//     authorable: no shipping arm needs one that a per-field tag cannot express, and
//     offering a two-slider basis produces geometry nobody can reason about. If one is
//     ever genuinely needed, that model is a code arm.
//
//   · `hw`/`fd` ARE PRE-CLAMP. draw3DBoxAt clamps a half-width to 0.44, an absolute
//     world constant, and a post-clamp number would only be valid at the one footprint
//     it was authored at. The renderer re-applies the clamp; the file never does.
//
// FIELD NAMES ARE THE PRIMITIVE'S OWN ARGUMENT NAMES (`hw`, `fd`, `rb`, `rt`, `n`,
// `cap`), so this table reads directly against draw3DBoxAt and drawFacetDrum and there
// is no translation table to get wrong.
//
// ⚠ THIS FILE AND THE RENDERER MUST AGREE, AND THEY CANNOT SHARE CODE. windshield.js
// must not import anything out of scripts/, so the adornment dispatch is written out by
// hand there. The guard is by VALUE, not by convention: windshield exports
// AUTHORED_ADORN_KINDS and scripts/shapes/smoke.mjs fails if it differs from
// ADORN_SCHEMA's keys. An adornment added here and forgotten there would otherwise be a
// field that silently never draws.

// ── The four mass kinds ─────────────────────────────────────────────────────
// Every mass primitive the renderer has: a box, a faceted drum, a barrel roof and a
// sawtooth monitor. Field names are the PRIMITIVE's own argument names throughout, so
// each block reads directly against draw3DBoxAt, drawFacetDrum, drawBarrelRoof and
// sawtoothRoof, and there is no translation table to get wrong.
export const SEG_SCHEMA = {
  box: {
    geom: { cx: 'fh', cy: 'fh', hw: 'fh', fd: 'fh', z0: 'h', z1: 'h' },
    required: ['hw', 'z0', 'z1'],
    plain: { pal: 'string', roof: 'boolean', yaw: 'number' },
  },
  drum: {
    geom: { cx: 'fh', cy: 'fh', rb: 'fh', rt: 'fh', z0: 'h', z1: 'h' },
    required: ['rb', 'z0', 'z1'],
    plain: { pal: 'string', cap: 'boolean', n: 'int' },
  },
  // A half-cylinder over a shed. `cx`/`cy` place the ANCHOR and `cxL` offsets the barrel
  // inside its own local frame, exactly as the primitive takes them.
  //
  // ⚠ `archH` defaults to the FOOTPRINT basis, not the height one. A barrel roof's rise is
  // proportional to its span — it is one of the nine models the capture doc names as deriving
  // a vertical from `fh`, and tagging it `h` would make a wide shed grow a taller arch when
  // somebody adds a storey.
  //
  // ⚠ `base` is a real authored field rather than a colour derived from `pal`. It is the one
  // colour the LOD renderer cannot work out from a palette key — the capture records it for
  // exactly that reason — so deriving it here would quietly repaint every ported roof.
  barrel: {
    geom: { cx: 'fh', cy: 'fh', cxL: 'fh', hl: 'fh', hw: 'fh', z0: 'h', archH: 'fh' },
    required: ['hl', 'hw', 'z0', 'archH'],
    plain: { pal: 'string', nf: 'int', base: 'rgb' },
  },
  // A north-light monitor roof: `teeth` sloped panels, each with a vertical glazed face.
  // Its three colours are authored because the primitive takes them as colours, not as a
  // palette — `roofc` and `glassc` are fills and `edge` is the stroke between them.
  sawtooth: {
    geom: { cx: 'fh', cy: 'fh', hx: 'fh', hy: 'fh', z0: 'h', rh: 'h' },
    required: ['hx', 'hy', 'z0', 'rh'],
    plain: { pal: 'string', teeth: 'int', roofc: 'string', glassc: 'string', edge: 'string' },
  },
};

// Kinds whose top is DERIVED rather than authored, and from what. A barrel's roof is its
// wall top plus the arch rise; a sawtooth's is its deck plus the tooth rise. Emitting the
// derived `z1` keeps every downstream consumer — bounds, framing, the LOD ranking, the cage
// — uniform across all four kinds instead of each one special-casing two of them.
const DERIVED_Z1 = { barrel: 'archH', sawtooth: 'rh' };

// ── Adornments ──────────────────────────────────────────────────────────────
// Each entry is one existing helper in windshield.js, with that helper's own argument
// names. They no-op under SHAPE_SINK already (every one opens with the house guard), so
// an authored model's CAPTURE is unaffected by anything in this list — which is what
// keeps collision, shadows, occlusion, LOD and the cold open identical whether a model
// wears neon or not.
export const ADORN_SCHEMA = {
  mast: { geom: { cx: 'fh', cy: 'fh', z0: 'h', z1: 'h' }, required: ['z0', 'z1'], plain: {} },
  dish: { geom: { cx: 'fh', cy: 'fh', z: 'h' }, required: ['z'], plain: { s: 'number' } },
  blinkLight: { geom: { cx: 'fh', cy: 'fh', z: 'h' }, required: ['z'], plain: { rgb: 'string', r: 'number' } },
  glowPool: { geom: { cx: 'fh', cy: 'fh', z: 'h' }, required: ['z'], plain: { rgb: 'string', s: 'number' } },
  helideck: { geom: { cx: 'fh', cy: 'fh', z: 'h', r: 'fh' }, required: ['z', 'r'], plain: { glow: 'string', paint: 'string', yaw: 'number' } },
  latticeTower: { geom: { cx: 'fh', cy: 'fh', z0: 'h', z1: 'h', r0: 'fh', r1: 'fh' }, required: ['z0', 'z1', 'r0', 'r1'], plain: {} },
  neonBlade: { geom: { cx: 'fh', cy: 'fh', z0: 'h', z1: 'h' }, required: ['z0', 'z1'], plain: { color: 'string', label: 'string' } },
  marqueeBand: { geom: { cx: 'fh', cy: 'fh', half: 'fh', z: 'h' }, required: ['half', 'z'], plain: { color: 'string', label: 'string' } },
  awning: { geom: { cx: 'fh', cy: 'fh', half: 'fh', lip: 'fh', z0: 'h', z1: 'h' }, required: ['half', 'z0', 'z1'], plain: { pal: 'string', depth: 'number' } },
};

// The authoring basis. These are the values captureRawPass itself uses, so a number an
// author types is the number the capture solves at.
export const DEFAULT_BASIS = { fh: 0.4, h: 1 };

// A scale tag turns an authored number into the affine triple everything downstream
// reads. `abs` is the escape hatch for a genuine world constant (the Layover's cone apex
// passes a literal 0.001); the bake warns on it, matching SHAPE_CONST_WARN, because a
// constant is also what a modelling slip looks like.
export function toTriple(value, tag, basis) {
  const v = Number(value);
  if (tag === 'abs') return [0, 0, v];
  if (tag === 'h') return [0, v / basis.h, 0];
  return [v / basis.fh, 0, 0];
}

// ── THE COMPILE — authored doc → the record the renderer draws ──────────────
//
// Three callers, one function, and that is the point. `models:bake` runs it to write
// client/shared/building-models.js; shapes:smoke runs it to detect a stale bake; and the
// Modelshop's editor runs it in the browser on every keystroke, so the preview you are
// looking at is the building the bake would produce rather than an approximation of it.
// A second compile in the tool is how an editor starts drawing something the build won't.
export const CONST_WARN = 1e-3;   // matches SHAPE_CONST_WARN — see docs/reference/building-shapes.md
const round = (n) => Number(n.toFixed(6));

// Geometric fields are emitted under the PRIMITIVE's own name, so `hw` becomes `hwRaw` and
// `fd` becomes `fdRaw` — those are the names a SHAPE_SINK capture uses, and matching them
// is exactly what lets one renderer draw a captured arm and an authored model alike.
export function compilePart(part, schema, basis, warnings = [], where = '') {
  const def = schema[part.kind];
  if (!def) return null;
  const out = { kind: part.kind };
  const scale = part.scale || {};
  for (const [f, defTag] of Object.entries(def.geom)) {
    if (part[f] == null) continue;
    const tag = scale[f] ?? defTag;
    const t = toTriple(part[f], tag, basis).map(round);
    if (tag === 'abs' && Math.abs(t[2]) > CONST_WARN) {
      warnings.push(`${where}: '${f}' is an absolute constant (${t[2]}) — it will NOT scale with the tile, `
        + 'which is right for a real world constant and is also what a modelling slip looks like');
    }
    out[f === 'hw' ? 'hwRaw' : f === 'fd' ? 'fdRaw' : f] = t;
  }
  for (const f of Object.keys(def.plain)) if (part[f] != null) out[f] = part[f];
  const rise = DERIVED_Z1[part.kind];
  if (rise && out.z0 && out[rise]) out.z1 = out.z0.map((v, i) => round(v + out[rise][i]));
  return out;
}

// The key space is shapeModelRegistry's, so the bake emits keys the renderer's own registry
// merge can loop over without a second idea of how a building resolves to a model.
export const bindKey = (b) => (b.by === 'name'
  ? 'named:' + String(b.key).toLowerCase().replace(/[^a-z0-9]+/g, '')
  : 'type:' + b.key);

export function compileModel(doc, file = '<model>') {
  const warnings = [];
  const basis = { ...DEFAULT_BASIS, ...(doc.basis || {}) };
  const rec = {
    type: 'authored',
    pal: doc.pal || null,
    segs: (doc.segs || []).map((s, i) => compilePart(s, SEG_SCHEMA, basis, warnings, `${file} segs[${i}]`)).filter(Boolean),
    adorn: (doc.adorn || []).map((a, i) => compilePart(a, ADORN_SCHEMA, basis, warnings, `${file} adorn[${i}]`)).filter(Boolean),
  };
  if (doc.neon) rec.neon = doc.neon;
  // Both reach the runtime record because both are read there: `portedFrom` decides whether
  // this model overrides an arm or defers to it, and modeldiff reads the pair back off the
  // live registry rather than re-reading these files.
  if (doc.portedFrom) { rec.portedFrom = doc.portedFrom; rec.pixdiff = doc.pixdiff ?? 0; }
  return { rec, warnings, bindings: (doc.bind || []).map((b) => bindKey(b)) };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function checkPart(where, part, schema, errors, basis) {
  const def = schema[part.kind];
  if (!def) { errors.push(`${where}: unknown kind '${part.kind}' (known: ${Object.keys(schema).join(', ')})`); return; }
  for (const f of def.required) {
    if (!isNum(part[f])) errors.push(`${where}: '${f}' is required and must be a number`);
  }
  const scale = part.scale || {};
  for (const [k, v] of Object.entries(part)) {
    if (k === 'kind' || k === 'scale') continue;
    if (k in def.geom) {
      if (!isNum(v)) errors.push(`${where}: '${k}' must be a number, got ${typeof v}`);
      const tag = scale[k] ?? def.geom[k];
      if (!['fh', 'h', 'abs'].includes(tag)) {
        errors.push(`${where}: scale.${k} must be 'fh', 'h' or 'abs', got '${tag}'`);
      } else if (tag !== 'abs' && !(basis[tag] > 0)) {
        // A basis of zero divides by zero and puts Infinity in the baked file, which renders
        // as nothing at all rather than as an error. Only asked once the tag is known good —
        // otherwise a typo'd tag reports twice and the second message is nonsense.
        errors.push(`${where}: basis.${tag} must be greater than zero to scale '${k}'`);
      }
    } else if (k in def.plain) {
      const want = def.plain[k];
      const ok = want === 'int' ? Number.isInteger(v)
        : want === 'number' ? isNum(v)
          : want === 'rgb' ? (Array.isArray(v) && v.length === 3 && v.every((c) => Number.isInteger(c) && c >= 0 && c <= 255))
            : typeof v === want;
      if (!ok) errors.push(`${where}: '${k}' must be ${want === 'rgb' ? 'three integers 0-255' : want}, got ${JSON.stringify(v)}`);
    } else {
      // Not a warning. An unread key is the failure mode this whole codebase keeps
      // hitting — `effects` on every mutation, read by nothing, for months.
      errors.push(`${where}: '${k}' is not a field of a ${part.kind} (nothing would read it)`);
    }
  }
  for (const k of Object.keys(scale)) {
    if (!(k in def.geom)) errors.push(`${where}: scale.${k} names '${k}', which is not a geometric field of a ${part.kind}`);
  }
}

// Validate one authored model. Returns { errors, warnings } — never throws, because both
// the bake and (later) the Studio-style save path want to report every problem at once
// rather than the first.
export function validateModel(doc, file = '<model>') {
  const errors = [], warnings = [];
  if (!doc || typeof doc !== 'object') return { errors: [`${file}: not an object`], warnings };

  if (!doc.id || typeof doc.id !== 'string') errors.push(`${file}: 'id' is required`);
  if (doc.pal != null && typeof doc.pal !== 'string') errors.push(`${file}: 'pal' must be a palette key`);

  // A PORT declares which hand-written arm it replaces. That claim is what makes it override the arm
  // instead of losing to it, and scripts/shapes/modeldiff.mjs re-checks it on every push for as long
  // as the arm still exists. `pixdiff` records how close "close enough" was, so a later regression is
  // a diff on a number rather than an argument about whether it always looked like that.
  if (doc.portedFrom != null && (typeof doc.portedFrom !== 'string' || !doc.portedFrom)) {
    errors.push(`${file}: 'portedFrom' must name the model type it replaces (the arm's case label)`);
  }
  if (doc.pixdiff != null) {
    if (typeof doc.pixdiff !== 'number' || !(doc.pixdiff >= 0) || doc.pixdiff > 1) {
      errors.push(`${file}: 'pixdiff' is a tolerance from 0 to 1 — the fraction of drawing operations allowed to differ`);
    }
    if (doc.portedFrom == null) errors.push(`${file}: 'pixdiff' is a port tolerance and means nothing without 'portedFrom'`);
  }

  const basis = { ...DEFAULT_BASIS, ...(doc.basis || {}) };
  if (!(basis.fh > 0) || !(basis.h > 0)) errors.push(`${file}: basis.fh and basis.h must both be greater than zero`);

  if (!Array.isArray(doc.segs) || !doc.segs.length) {
    errors.push(`${file}: 'segs' must hold at least one segment — a model with no mass draws nothing, and collision, shadows and the cold open would all read it as empty ground`);
  } else {
    doc.segs.forEach((s, i) => checkPart(`${file} segs[${i}]`, s, SEG_SCHEMA, errors, basis));
  }
  if (doc.adorn != null) {
    if (!Array.isArray(doc.adorn)) errors.push(`${file}: 'adorn' must be an array`);
    else doc.adorn.forEach((a, i) => checkPart(`${file} adorn[${i}]`, a, ADORN_SCHEMA, errors, basis));
  }

  // The bind is what puts the model in front of a player. A model with none is authored,
  // baked, renderable and unreachable — so it is a warning you can see rather than a
  // silence you cannot.
  if (!Array.isArray(doc.bind) || !doc.bind.length) {
    warnings.push(`${file}: no 'bind' — nothing in the world resolves to this model, so it will only ever be visible in the Modelshop`);
  } else {
    doc.bind.forEach((b, i) => {
      if (!b || !['type', 'name'].includes(b.by)) errors.push(`${file} bind[${i}]: 'by' must be 'type' (a building_type) or 'name' (a building_name)`);
      if (!b || typeof b.key !== 'string' || !b.key) errors.push(`${file} bind[${i}]: 'key' is required`);
    });
  }

  for (const k of Object.keys(doc)) {
    // ⚠ EVERY KEY HERE HAS A READER, AND THAT IS THE ENTRY BAR.
    //   id         the filename and the default bind (the editor); validated here
    //   pal        the model's fallback palette          -> drawAuthoredModel
    //   neon       its sign colour when an adornment names none -> AUTHORED_ADORN
    //   basis      the authoring scale                   -> toTriple
    //   segs/adorn the model                             -> drawAuthoredModel
    //   bind       where it resolves                     -> the registry merge
    //   portedFrom / pixdiff  the port claim             -> modeldiff.mjs
    //   note       prose for whoever opens the file — the ONE key with no code reader, on purpose
    // 'kind: authored' used to sit here too. Nothing read it: compileModel sets the record's type
    // itself, and the directory is what says these are models. An authored key with no reader is
    // the failure this codebase keeps rediscovering (see `effects` in systems-mutations.md), so it
    // is gone rather than tolerated.
    if (!['id', 'pal', 'neon', 'basis', 'segs', 'adorn', 'bind', 'note', 'portedFrom', 'pixdiff'].includes(k)) {
      errors.push(`${file}: unknown top-level key '${k}'`);
    }
  }
  return { errors, warnings };
}
