// mesh — the command line for authored vehicle meshes.
//
//   npm run mesh -- fingerprint [--out file] [--check file]
//
// A vehicle mesh is a face list, so "did this change anything" is a question about data rather than
// pixels, and it can be answered exactly. `fingerprint` hashes every mesh the renderer can build —
// every class at both details, armed and not, every truck type with and without a trailer, every
// hull — into one table, so a refactor of the builders can be held against the table taken before
// it. ⚠ The hash is over a CANONICAL form, not JSON.stringify: JSON writes −0 as 0, and a port that
// turns a −0 into a +0 is a different mesh (it flips which way a face's normal falls on an axis).
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir as osTmp } from 'node:os';

const A3D = '../../client/game/js/panels/aircraft3d.js';

// Every number by its exact value, −0 kept; object keys sorted, so key ORDER is not identity but
// the key SET is.
export function canon(v) {
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return v === undefined ? 'u' : JSON.stringify(v);
}
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

const CLASSES = ['prop', 'heavy', 'ultralight', 'heli', 'gunship', 'divebomber', 'grasshopper', 'locust', 'wreck', 'hydro'];
const TRUCKS = ['scrapper', 'hauler', 'drayman', 'continental'];

export async function fingerprintAll() {
  const m = await import(A3D);
  m.clearVehicleFacesCache();
  const out = {};
  const put = (key, faces) => { out[key] = faces.length + ':' + hash(faces.map(canon).join('\n')); };
  for (const cls of CLASSES) for (const detail of [0, 1]) for (const armed of [false, true]) {
    put(cls + ':' + detail + (armed ? ':a' : ''), m.aircraftFaces(cls, detail, armed, ''));
  }
  for (const t of TRUCKS) for (const detail of [0, 1]) for (const v of [t, t + '+t', t + '~p']) {
    put('truck:' + detail + ':' + v, m.aircraftFaces('truck', detail, false, v));
  }
  if (m._wreckFaces) put('wreck:hangar', m._wreckFaces());
  return out;
}

const VM = '../../client/shared/vehicle-mesh.js';
const DIR = new URL('../../content/vehicle_models/', import.meta.url);
export function readMeshDoc(id) {
  return JSON.parse(readFileSync(new URL('mesh_' + id + '.json', DIR), 'utf8'));
}
// Where a part path points inside a doc, as a short label: 'parts[5].parts[1]~L' → 'skids > skid toe (left)'.
function partLabel(params, path) {
  if (!path) return '?';
  const left = path.endsWith('~L');
  let node = { parts: params.parts }, out = [];
  for (const m of path.replace(/~L$/, '').matchAll(/parts\[(\d+)\]/g)) {
    node = node.parts?.[+m[1]];
    if (!node) break;
    out.push(node.name || node.kind);
  }
  return out.join(' > ') + (left ? ' (left)' : '');
}

// Hold an authored mesh against the builder it replaced, at both details. Prints the first face
// that differs, the field, both values and the part that emitted it — which is the whole loop for
// converting a builder: run it, fix the part it names, run it again.
export async function diffMesh(id, { quiet = false } = {}) {
  const m = await import(A3D);
  const { compileMesh, meshSource, meshDiff } = await import(VM);
  const doc = readMeshDoc(id);
  let bad = 0;
  for (const detail of [0, 1]) {
    const legacy = m.legacyMeshFaces(id, detail);
    if (!legacy) { if (!quiet) console.log(id + ': no legacy builder to compare against'); return 0; }
    const { faces } = compileMesh(doc.params, { detail, finish: false });   // the builder drew geometry, never a finish
    const d = meshDiff(faces, legacy, { ignore: doc.params.paints ? ['paint'] : [] });   // nor any paint slot
    if (!d) { if (!quiet) console.log(id + ' detail ' + detail + ': identical (' + faces.length + ' faces)'); continue; }
    bad++;
    const src = meshSource(faces)?.[d.index];
    console.log(id + ' detail ' + detail + ': face ' + d.index + ' differs in ' + d.field
      + '\n  authored: ' + JSON.stringify(d.a) + '\n  builder:  ' + JSON.stringify(d.b)
      + '\n  part:     ' + partLabel(doc.params, src) + '  [' + src + ']'
      + '\n  counts:   authored ' + faces.length + ', builder ' + legacy.length);
  }
  return bad;
}

// ── A LOOK WITHOUT A BROWSER ─────────────────────────────────────────────────
// `mesh png <id>` draws the compiled faces orthographically — side, top, front and a three-quarter —
// through the software depth buffer the renderer already has (model-raster.js), coloured through
// the renderer's own faceBaseRgb. It is a BLUEPRINT, not the picture: no perspective, no lamps, no
// rotor blur. What it is for is the silhouette, which is most of what a modeller needs to see and
// the part a session with no Browser pane could otherwise not see at all. The picture is the
// Modelshop's (`__mesh.sheet()`), because that is the real renderer.
const ROLE_RGB = { body: [150, 160, 172], glass: [70, 120, 160], window: [230, 200, 80], wing: [120, 170, 120], aileron: [90, 150, 90],
  flap: [90, 150, 90], stab: [120, 170, 120], elevator: [90, 150, 90], fin: [200, 150, 90], rudder: [180, 120, 70], nacelle: [170, 130, 190],
  rotor: [90, 90, 90], gear: [70, 70, 76], strut: [110, 110, 118], gun: [60, 50, 50], deck: [120, 140, 170] };
const VIEWS = {
  side: ([f, g, h]) => [f, -h, -g],
  top: ([f, g, h]) => [g, -f, -h],
  front: ([f, g, h]) => [-g, -h, -f],
  '34': ([f, g, h]) => { const a = 35 * Math.PI / 180, e = 22 * Math.PI / 180; const x = f * Math.cos(a) - g * Math.sin(a), d = f * Math.sin(a) + g * Math.cos(a);
    return [x, -(h * Math.cos(e) - d * Math.sin(e)), -(h * Math.sin(e) + d * Math.cos(e))]; },
};
function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
async function writePng(file, rgba, w, h) {
  const { deflateSync } = await import('node:zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
export async function meshPng(id, { views = ['side', 'top', 'front', '34'], cell = [420, 260], color = 'livery', detail = 1, out = null, faces: given = null, pose = null } = {}) {
  const m = await import(A3D);
  const { rasterFaces, readPixels } = await import('../../client/game/js/panels/model-raster.js');
  const { compileMesh, animFacePoints } = await import(VM);
  // Moving parts are drawn posed: at their rest pose unless `pose` gives a channel, e.g. { wings: 1 }.
  const faces = (given || compileMesh(readMeshDoc(id).params, { detail }).faces).map((f) => (f.anim ? { ...f, p: animFacePoints(f, pose) } : f));
  const pal = m.liveryPalette(null);
  const L = (() => { const v = [0.45, -0.35, 0.82], n = Math.hypot(...v); return v.map((x) => x / n); })();
  const [cw, ch] = cell, W = cw * views.length, H = ch;
  const sheet = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 22; sheet[i * 4 + 1] = 26; sheet[i * 4 + 2] = 31; sheet[i * 4 + 3] = 255; }
  views.forEach((vname, vi) => {
    const P = VIEWS[vname];
    const proj = faces.filter((f) => f.role !== 'rotor' && f.p?.length >= 3).map((f) => ({ f, q: f.p.map(P) }));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const { q } of proj) for (const [x, y] of q) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = Math.min((cw - 24) / Math.max(1e-6, x1 - x0), (ch - 24) / Math.max(1e-6, y1 - y0));
    // ⚠ The rasteriser is a PERSPECTIVE one: it interpolates 1/z and drops any vertex at z <= 0 as
    // behind the eye. An orthographic depth goes negative, which silently deleted half of every
    // wing, so depth is pushed into a positive band far enough out that 1/z is linear to a hair.
    let zMin = Infinity; for (const { q } of proj) for (const v of q) zMin = Math.min(zMin, v[2]);
    const ZOFF = 100 - zMin;
    const ox = (cw - (x1 - x0) * k) / 2 - x0 * k, oy = (ch - (y1 - y0) * k) / 2 - y0 * k;
    const recs = proj.map(({ f, q }) => {
      let nx = 0, ny = 0, nz = 0;
      for (let a = 0; a < f.p.length; a++) { const A = f.p[a], B = f.p[(a + 1) % f.p.length]; nx += (A[1] - B[1]) * (A[2] + B[2]); ny += (A[2] - B[2]) * (A[0] + B[0]); nz += (A[0] - B[0]) * (A[1] + B[1]); }
      const nl = Math.hypot(nx, ny, nz) || 1, lam = Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      const base = color === 'role' ? (ROLE_RGB[f.role] || [200, 60, 200]) : m.faceBaseRgb(f, pal);
      const s = (f.sh ?? 0.7) * (0.72 + 0.5 * lam);
      return { pts: q.map(([x, y, z]) => ({ x: x * k + ox, y: y * k + oy, z: z + ZOFF })), r: Math.min(255, base[0] * s), g: Math.min(255, base[1] * s), b: Math.min(255, base[2] * s), a: 255 };
    });
    const res = rasterFaces(recs, 0, 0, cw, ch, 1, false);
    if (!res) return;
    const px = readPixels(res);
    for (let y = 0; y < Math.min(ch, px.height); y++) for (let x = 0; x < Math.min(cw, px.width); x++) {
      const s = (y * px.width + x) * 4; if (!px.data[s + 3]) continue;
      const d = (y * W + vi * cw + x) * 4; sheet[d] = px.data[s]; sheet[d + 1] = px.data[s + 1]; sheet[d + 2] = px.data[s + 2]; sheet[d + 3] = 255;
    }
    for (let y = 0; y < ch; y++) { const d = (y * W + vi * cw) * 4; sheet[d] = 60; sheet[d + 1] = 70; sheet[d + 2] = 82; }
  });
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { mkdirSync } = await import('node:fs');
  const dir = join(tmpdir(), 'architect-shots'); mkdirSync(dir, { recursive: true });
  const file = out || join(dir, 'mesh-' + id + '-' + views.join('-') + (color === 'role' ? '-roles' : '') + '.png');
  await writePng(file, sheet, W, H);
  return file;
}

// Freeze a mesh the renderer already draws into literal faces: a starting point to edit rather than
// a model to maintain. Consecutive faces with one role become one `poly` part, so the part list reads
// as the structure the builder emitted (hull, wing, stab…) instead of one blob of 300 faces.
// `--from legacy` reads the hand-drawn builder a file replaced; otherwise the live class.
export async function freezeFaces(faces) {
  const parts = [];
  let run = null, n = {};
  for (const f of faces) {
    if (!run || run.role !== f.role) {
      n[f.role] = (n[f.role] || 0) + 1;
      run = { role: f.role, part: { kind: 'poly', name: f.role + ' ' + n[f.role], faces: [] } };
      parts.push(run.part);
    }
    const o = {};
    for (const k of Object.keys(f)) o[k] = k === 'p' || k === 'hinge' ? f[k].map((v) => [v[0], v[1], v[2]]) : f[k];
    run.part.faces.push(o);
  }
  return parts;
}

const tmpdirOf = () => join(osTmp(), 'architect-shots');
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : null; };
  if (cmd === 'png') {
    const id = rest.find((a) => !a.startsWith('--'));
    const views = (opt('views') || 'side,top,front,34').split(',');
    const pose = opt('pose') ? Object.fromEntries(opt('pose').split(',').map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : null;
    const file = await meshPng(id, { views, color: opt('color') || 'livery', detail: opt('detail') === '0' ? 0 : 1, pose,
      out: pose ? join(tmpdirOf(), 'mesh-' + id + '-' + Object.entries(pose).map(([k, v]) => k + v).join('-') + '.png') : null });
    console.log(file);
    return;
  }
  if (cmd === 'stats') {
    const { compileMesh, meshStats, meshSource } = await import(VM);
    for (const id of rest.filter((a) => !a.startsWith('--'))) {
      const doc = readMeshDoc(id);
      const near = compileMesh(doc.params, { detail: 1 }).faces, far = compileMesh(doc.params, { detail: 0 }).faces;
      const st = meshStats(near);
      console.log('mesh_' + id + '.json — ' + (doc.params.name || id) + (doc.params.portedFrom ? ' (replaces ' + doc.params.portedFrom + ')' : ''));
      console.log('  faces ' + st.faces + ' near, ' + far.length + ' far · vertices ' + st.verts + ' (' + st.unique + ' unique) · 5+-gons ' + st.ngons + ' · symmetry ' + (st.symmetry * 100).toFixed(1) + '%');
      console.log('  extent f ' + st.bounds.lo[0].toFixed(3) + '…' + st.bounds.hi[0].toFixed(3) + ' · g ' + st.bounds.lo[1].toFixed(3) + '…' + st.bounds.hi[1].toFixed(3) + ' · h ' + st.bounds.lo[2].toFixed(3) + '…' + st.bounds.hi[2].toFixed(3));
      console.log('  roles ' + Object.entries(st.roles).map(([k, n]) => k + ' ' + n).join(', '));
      if (Object.keys(st.paints).length) console.log('  paints ' + Object.entries(st.paints).map(([k, n]) => k + ' ' + n).join(', '));
      const src = meshSource(near) || [], per = new Map();
      for (const p of src) { const top = p.replace(/~L$/, '').match(/^parts\[\d+\]/)[0]; per.set(top, (per.get(top) || 0) + 1); }
      doc.params.parts.forEach((p, i) => console.log('  parts[' + i + '] ' + p.kind.padEnd(7) + ' ' + String(per.get('parts[' + i + ']') || 0).padStart(4) + '  ' + (p.name || '')));
    }
    return;
  }
  if (cmd === 'validate') {
    const { validateMesh } = await import(VM);
    const { readdirSync } = await import('node:fs');
    const ids = rest.filter((a) => !a.startsWith('--'));
    const all = ids.length ? ids : readdirSync(DIR).filter((f) => /^mesh_.+\.json$/.test(f)).map((f) => f.slice(5, -5));
    let bad = 0;
    for (const id of all) {
      const v = validateMesh(readMeshDoc(id).params, 'mesh_' + id + '.json');
      for (const e of v.errors) console.log('✗ ' + e);
      for (const w of v.warnings) console.log('  warn: ' + w);
      if (v.errors.length) bad++; else console.log('✓ mesh_' + id + '.json');
    }
    process.exit(bad ? 1 : 0);
  }
  if (cmd === 'new') {
    const id = rest.find((a) => !a.startsWith('--'));
    const { formatMesh } = await import(VM);
    const out = new URL('mesh_' + id + '.json', DIR);
    const { existsSync } = await import('node:fs');
    if (existsSync(out)) { console.error('mesh_' + id + '.json already exists'); process.exit(1); }
    const doc = { id, kind: 'mesh', params: { name: opt('name') || id, parts: [
      { kind: 'loft', name: 'fuselage', sides: 12, section: 'super', role: 'body', exp: [0.82, 0.9, 0.8], shade: { base: 0.62, amp: 0.36 },
        stations: [{ f: 0.8, rg: 0.04, rvT: 0.04, rvB: 0.04, cz: 0 }, { f: 0.4, rg: 0.12, rvT: 0.12, rvB: 0.12, cz: 0 }, { f: -0.2, rg: 0.12, rvT: 0.12, rvB: 0.12, cz: 0 }, { f: -0.9, rg: 0.03, rvT: 0.03, rvB: 0.03, cz: 0.05 }],
        capFore: { kind: 'apex', at: [0.9, 0, 0] }, capAft: { kind: 'apex', at: [-1, 0, 0.05] } },
    ] } };
    writeFileSync(out, formatMesh(doc));
    console.log('wrote content/vehicle_models/mesh_' + id + '.json — add \'' + id + '\' to VEHICLE_IDS.mesh in client/shared/vehicle-model-schema.js, then npm run vehicles:bake');
    return;
  }
  if (cmd === 'freeze') {
    const id = rest.find((a) => !a.startsWith('--'));
    const m = await import(A3D);
    const { formatMesh } = await import(VM);
    const faces = opt('from') === 'legacy' ? m.legacyMeshFaces(id, 1) : m.aircraftFaces(id, 1, false, '');
    if (!faces) { console.error('no mesh for ' + id); process.exit(1); }
    const doc = { id, kind: 'mesh', params: { name: opt('name') || id, parts: await freezeFaces(faces) } };
    if (opt('from') === 'legacy') doc.params.portedFrom = opt('builder') || 'legacy';
    const out = new URL('mesh_' + id + '.json', DIR);
    writeFileSync(out, formatMesh(doc));
    console.log('froze ' + faces.length + ' faces into ' + doc.params.parts.length + ' parts → content/vehicle_models/mesh_' + id + '.json');
    return;
  }
  if (cmd === 'diff') {
    const ids = rest.filter((a) => !a.startsWith('--'));
    let bad = 0;
    for (const id of ids) bad += await diffMesh(id);
    process.exit(bad ? 1 : 0);
  }
  if (cmd === 'fingerprint') {
    const fp = await fingerprintAll();
    const out = opt('out'), check = opt('check');
    if (out) writeFileSync(out, JSON.stringify(fp, null, 1));
    if (check) {
      const was = JSON.parse(readFileSync(check, 'utf8'));
      let bad = 0;
      for (const k of new Set([...Object.keys(was), ...Object.keys(fp)])) {
        if (was[k] !== fp[k]) { bad++; console.log('CHANGED ' + k + ': ' + was[k] + ' -> ' + fp[k]); }
      }
      console.log(bad ? bad + ' of ' + Object.keys(fp).length + ' meshes changed' : 'all ' + Object.keys(fp).length + ' meshes identical');
      process.exit(bad ? 1 : 0);
    }
    if (!out) for (const [k, v] of Object.entries(fp)) console.log(k.padEnd(28) + v);
    return;
  }
  console.log('usage: npm run mesh -- <stats|validate|diff|png|new|freeze|fingerprint> [id…] [--views side,top,front,34] [--color livery|role] [--from legacy]');
  process.exit(2);
}

if (import.meta.url === 'file:///' + process.argv[1].replace(/\\/g, '/') || process.argv[1].endsWith('mesh.mjs')) main();
