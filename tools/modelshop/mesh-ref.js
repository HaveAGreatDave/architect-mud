// THE MESH REFERENCE PAGE: an image-to-mesh result (tools/mesh-gen) beside its source picture, with a
// GLASS building model ghosted over it at the same place and scale.
//
// A reference is something to trace, never a game asset. Nothing here writes a model or content; the
// page reads /api/mesh-refs (tools/mesh-gen/out/<name>/) and anything dropped on it. See
// docs/proposals/mesh-reference-pipeline.md.
//
// Its own small WebGL2 pass on purpose: the reference is arbitrary triangles in glTF's y-up metres, and
// the editor's viewport is GLASS's 2-D camera, so the two pictures are put into one z-up frame here and
// drawn by one shader rather than bolted onto a renderer that has no idea what a GLB is.
//
// window.__meshRef holds the state; __meshRef.shot(name) writes the frame through /api/shot.
import { compileShader } from '/client/game/js/panels/gl/programs.js';
import { perspective as perspective4, lookAt as lookAt4, UP_Z } from '/client/game/js/panels/gl/core/mat4.js';
import { shapeModelRegistry, captureModelMesh } from '/client/game/js/panels/windshield.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });

// ---------------------------------------------------------------- parsing

// GLB: the JSON chunk and the BIN chunk, every mesh primitive's POSITION and indices, placed by the
// node tree. Draco and meshopt compression are not read; the runner writes plain GLB.
function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = buf.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  const used = json.extensionsRequired || [];
  if (used.length) throw new Error('GLB needs ' + used.join(', ') + ', which this page does not read');
  const view = (i) => {
    const bv = json.bufferViews[i];
    return { off: bv.byteOffset || 0, stride: bv.byteStride || 0 };
  };
  const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const read = (ai) => {
    const a = json.accessors[ai], v = view(a.bufferView), n = SIZE[a.type];
    const ct = a.componentType;
    const bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[ct];
    const stride = v.stride || bytes * n, base = v.off + (a.byteOffset || 0);
    const d = new DataView(bin), out = new Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
      const p = base + i * stride + k * bytes;
      out[i * n + k] = ct === 5126 ? d.getFloat32(p, true) : ct === 5125 ? d.getUint32(p, true)
        : ct === 5123 ? d.getUint16(p, true) : ct === 5121 ? d.getUint8(p) : ct === 5122 ? d.getInt16(p, true) : d.getInt8(p);
    }
    return out;
  };
  const tris = [];
  const meshTris = (mi, M) => {
    for (const prim of json.meshes[mi].primitives) {
      if (prim.mode != null && prim.mode !== 4) continue;
      const P = read(prim.attributes.POSITION);
      const idx = prim.indices != null ? read(prim.indices) : [...Array(P.length / 3).keys()];
      for (const i of idx) tris.push(xf(M, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    }
  };
  const walk = (ni, parent) => {
    const n = json.nodes[ni], M = mul(parent, local(n));
    if (n.mesh != null) meshTris(n.mesh, M);
    for (const c of n.children || []) walk(c, M);
  };
  const scene = json.scenes ? json.scenes[json.scene || 0] : null;
  if (scene) for (const ni of scene.nodes) walk(ni, ID);
  else json.meshes.forEach((_, mi) => meshTris(mi, ID));
  return tris;
}

const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function local(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation || [0, 0, 0], [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const xf = (M, x, y, z) => [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];

function parseOBJ(text) {
  const v = [], tris = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') v.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'f') {
      const ix = t.slice(1).map((s) => { const i = parseInt(s, 10); return i < 0 ? v.length + i : i - 1; });
      for (let i = 1; i + 1 < ix.length; i++) tris.push(v[ix[0]], v[ix[i]], v[ix[i + 1]]);
    }
  }
  return tris;
}

// glTF and OBJ are y-up; GLASS is z-up. (x, y, z) -> (x, -z, y) keeps the handedness.
const toZUp = (tris) => tris.map(([x, y, z]) => [x, -z, y]);

// ---------------------------------------------------------------- state

const S = {
  refs: [], ref: null,          // the listed references and the one shown
  refTris: null,                // z-up, model-local
  gameKey: '', gameTris: null,  // the GLASS model's triangles, z-up
  fit: true, scale: 1, yaw: 0, ox: 0, oy: 0, oz: 0,
  mode: 'ghost',                // ghost | ref | game | side
  wire: false,
  cam: { yaw: -0.7, pitch: 0.45, dist: 3 },
};
window.__meshRef = S;

function bbox(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of tris) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]), mid: hi.map((h, k) => (h + lo[k]) / 2) };
}

// The reference placed in the game model's frame. Fit stands it on the model's footprint centre and
// scales it to the model's height; with no model it is scaled to a unit height.
function placedRef() {
  if (!S.refTris || !S.refTris.length) return [];
  const rb = bbox(S.refTris);
  let k = 1 / Math.max(1e-6, rb.size[2]), cx = 0, cy = 0, z0 = 0;
  if (S.gameTris && S.gameTris.length && S.fit) {
    const gb = bbox(S.gameTris);
    k = gb.size[2] / Math.max(1e-6, rb.size[2]);
    [cx, cy, z0] = [gb.mid[0], gb.mid[1], gb.lo[2]];
  }
  k *= S.scale;
  const c = Math.cos(S.yaw), s = Math.sin(S.yaw);
  const side = S.mode === 'side' && S.gameTris ? bbox(S.gameTris).size[0] * 1.15 : 0;
  return S.refTris.map(([x, y, z]) => {
    const X = (x - rb.mid[0]) * k, Y = (y - rb.mid[1]) * k;
    return [c * X - s * Y + cx + S.ox + side, s * X + c * Y + cy + S.oy, (z - rb.lo[2]) * k + z0 + S.oz];
  });
}

function loadGame(key) {
  S.gameKey = key;
  S.gameTris = null;
  if (!key) return;
  const row = shapeModelRegistry().find((r) => r.key === key);
  if (!row) return;
  const faces = captureModelMesh(row.m, { fh: 0.4, h: 1, seed: 3 });
  const tris = [];
  for (const f of faces) for (let i = 1; i + 1 < f.p.length; i++) tris.push(f.p[0], f.p[i], f.p[i + 1]);
  S.gameTris = tris;
}

async function loadRef(r) {
  S.ref = r;
  const res = await fetch(`/mesh-refs/${encodeURIComponent(r.name)}/${encodeURIComponent(r.mesh)}`);
  setRefFrom(r.mesh, res);
  showImage(r.image ? `/mesh-refs/${encodeURIComponent(r.name)}/${encodeURIComponent(r.image)}` : null);
  $('meta').textContent = Object.keys(r.meta || {}).length ? JSON.stringify(r.meta, null, 1) : '';
}

async function setRefFrom(name, resOrFile) {
  try {
    const tris = /\.obj$/i.test(name) ? parseOBJ(await resOrFile.text()) : parseGLB(await resOrFile.arrayBuffer());
    S.refTris = toZUp(tris);
    $('status').textContent = `${name}: ${(tris.length / 3) | 0} triangles`;
  } catch (e) {
    S.refTris = null;
    $('status').textContent = `${name}: ${e.message}`;
  }
  frame();
}

function showImage(src) {
  const img = $('image');
  img.hidden = !src;
  if (src) img.src = src;
}

// ---------------------------------------------------------------- drawing

const VS = `#version 300 es
in vec3 aP; in vec3 aN;
uniform mat4 uM;
out vec3 vN;
void main() { vN = aN; gl_Position = uM * vec4(aP, 1.0); }`;
const FS = `#version 300 es
precision mediump float;
in vec3 vN; uniform vec4 uC; uniform float uFlat;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  float l = mix(0.35 + 0.65 * abs(dot(n, normalize(vec3(0.4, -0.6, 0.7)))), 1.0, uFlat);
  o = vec4(uC.rgb * l, uC.a);
}`;
function program() {
  const sh = (t, src) => compileShader(gl, t, src, 'mesh-ref');
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  return p;
}
const prog = gl && program();
const buffers = new Map();

function upload(name, tris) {
  let b = buffers.get(name);
  if (!b) { b = { tri: gl.createBuffer(), line: gl.createBuffer(), n: 0, nl: 0 }; buffers.set(name, b); }
  const data = new Float32Array(tris.length * 6), lines = new Float32Array(tris.length * 12);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const [a, c, d] = [tris[i], tris[i + 1], tris[i + 2]];
    const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (let k = 0; k < 3; k++) data.set([...tris[i + k], ...n], (i + k) * 6);
    const e = [a, c, c, d, d, a];
    for (let k = 0; k < 6; k++) lines.set([...e[k], 0, 0, 1], (i * 2 + k) * 6);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, b.tri); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, b.line); gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
  b.n = tris.length; b.nl = tris.length * 2;
  return b;
}

const perspective = (fov, asp, n, f) => perspective4(fov, asp, n, f);
const lookAt = (e, c) => lookAt4(e, c, UP_Z);

let target = [0, 0, 0.5];
function frame() {
  // Frame what the mode shows, not what's loaded.
  const all = [...(S.mode !== 'ref' && S.gameTris || []), ...(S.mode !== 'game' ? placedRef() : [])];
  if (all.length) {
    const b = bbox(all);
    target = b.mid;
    // The field of view is vertical, so a narrow canvas needs the camera further back to fit the width.
    const asp = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    S.cam.dist = (Math.max(...b.size) * 1.8 || 3) / Math.min(1, asp);
  }
  draw();
}

function draw() {
  if (!gl) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.043, 0.051, 0.078, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(prog);
  const { yaw, pitch, dist } = S.cam;
  const eye = [target[0] + dist * Math.cos(pitch) * Math.cos(yaw), target[1] + dist * Math.cos(pitch) * Math.sin(yaw), target[2] + dist * Math.sin(pitch)];
  const M = mul(perspective(0.8, w / Math.max(1, h), dist * 0.01, dist * 20), lookAt(eye, target));
  gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uM'), false, M);
  const uC = gl.getUniformLocation(prog, 'uC'), uFlat = gl.getUniformLocation(prog, 'uFlat');
  const aP = gl.getAttribLocation(prog, 'aP'), aN = gl.getAttribLocation(prog, 'aN');
  const pass = (b, rgba, lines, flat) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, lines ? b.line : b.tri);
    gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(aN); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 24, 12);
    gl.uniform4fv(uC, rgba); gl.uniform1f(uFlat, flat ? 1 : 0);
    gl.drawArrays(lines ? gl.LINES : gl.TRIANGLES, 0, lines ? b.nl : b.n);
  };
  const showGame = S.gameTris && S.mode !== 'ref', showRef = S.refTris && S.mode !== 'game';
  const gb = showGame ? upload('game', S.gameTris) : null;
  const rb = showRef ? upload('ref', placedRef()) : null;
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  // Solid first: whichever the mode treats as the subject.
  if (S.mode === 'ghost') { if (gb) pass(gb, [0.55, 0.62, 0.72, 1], false, false); }
  else { if (gb) pass(gb, [0.55, 0.62, 0.72, 1], false, false); if (rb) pass(rb, [0.85, 0.66, 0.42, 1], false, false); }
  if (S.wire) { if (gb) pass(gb, [0.1, 0.12, 0.16, 1], true, true); if (rb && S.mode !== 'ghost') pass(rb, [0.2, 0.14, 0.08, 1], true, true); }
  // Ghost: the reference over the model, see-through and unoccluded so both read at once.
  if (S.mode === 'ghost' && rb) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    pass(rb, [0.95, 0.68, 0.35, 0.28], false, false);
    if (S.wire) pass(rb, [1, 0.8, 0.5, 0.35], true, true);
    gl.depthMask(true);
  }
}

// ---------------------------------------------------------------- controls

let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  S.cam.yaw -= (e.clientX - drag.x) * 0.01;
  S.cam.pitch = Math.max(-1.4, Math.min(1.4, S.cam.pitch + (e.clientY - drag.y) * 0.01));
  drag = { x: e.clientX, y: e.clientY };
  draw();
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); S.cam.dist *= Math.exp(e.deltaY * 0.001); draw(); }, { passive: false });
addEventListener('resize', draw);

// A GLB, an OBJ or a picture, from Open, a drop or the clipboard, without running the generator.
function loadFiles(files) {
  let n = 0;
  for (const f of files) {
    if (/\.(glb|obj)$/i.test(f.name)) { S.ref = null; $('ref').value = ''; $('meta').textContent = ''; setRefFrom(f.name, f); n++; }
    else if (/^image\//.test(f.type)) { showImage(URL.createObjectURL(f)); n++; }
  }
  return n;
}
// Pasted text is read as OBJ if it has vertex and face lines (copied out of an editor).
function loadText(text) {
  if (!/^\s*v\s/m.test(text) || !/^\s*f\s/m.test(text)) return false;
  S.ref = null; $('ref').value = ''; $('meta').textContent = '';
  setRefFrom('pasted.obj', { text: async () => text });
  return true;
}

addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); loadFiles(e.dataTransfer.files); });

// Ctrl+V anywhere: a copied file, a copied picture, or OBJ text.
addEventListener('paste', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const cd = e.clipboardData;
  if (!cd) return;
  const files = [...cd.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (files.length && loadFiles(files)) { e.preventDefault(); return; }
  const text = cd.getData('text/plain');
  if (text && loadText(text)) { e.preventDefault(); return; }
  $('status').textContent = 'Nothing on the clipboard this page can read: copy a .glb, .obj or picture.';
});

// The Paste button reads the clipboard itself, which the browser asks permission for.
async function pasteButton() {
  try {
    if (navigator.clipboard.read) {
      for (const item of await navigator.clipboard.read()) {
        const img = item.types.find((t) => t.startsWith('image/'));
        if (img) { const b = await item.getType(img); loadFiles([new File([b], 'pasted.png', { type: img })]); return; }
        if (item.types.includes('text/plain') && loadText(await (await item.getType('text/plain')).text())) return;
      }
    } else if (loadText(await navigator.clipboard.readText())) return;
    $('status').textContent = 'Nothing on the clipboard this page can read. A copied file pastes with Ctrl+V.';
  } catch (err) {
    $('status').textContent = 'The browser refused the clipboard (' + err.message + '). Press Ctrl+V instead.';
  }
}

function bindRange(id, key, k = 1) {
  const el = $(id), out = $(id + 'Out');
  const set = () => { S[key] = +el.value * k; if (out) out.textContent = (+el.value).toFixed(2); draw(); };
  el.addEventListener('input', set);
  set();
}

async function init() {
  if (!gl) { $('status').textContent = 'This page needs WebGL2.'; return; }
  const sel = $('ref'), model = $('model');
  try { S.refs = await (await fetch('/api/mesh-refs')).json(); } catch { S.refs = []; }
  sel.innerHTML = '';
  sel.append(new Option(S.refs.length ? '(pick a reference)' : '(none in tools/mesh-gen/out yet)', ''));
  for (const r of S.refs) sel.append(new Option(r.name, r.name));
  sel.addEventListener('change', () => { const r = S.refs.find((x) => x.name === sel.value); if (r) loadRef(r); });
  model.append(new Option('(no game model)', ''));
  for (const r of shapeModelRegistry()) model.append(new Option(r.key, r.key));
  model.addEventListener('change', () => { loadGame(model.value); frame(); });
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    for (const o of document.querySelectorAll('[data-mode]')) o.classList.toggle('on', o === b);
    frame();
  });
  $('wire').addEventListener('change', (e) => { S.wire = e.target.checked; draw(); });
  $('fit').addEventListener('change', (e) => { S.fit = e.target.checked; frame(); });
  bindRange('scale', 'scale');
  bindRange('yaw', 'yaw', Math.PI / 180);
  bindRange('ox', 'ox'); bindRange('oy', 'oy'); bindRange('oz', 'oz');
  $('reframe').addEventListener('click', frame);
  $('open').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => { loadFiles(e.target.files); e.target.value = ''; });
  $('paste').addEventListener('click', pasteButton);
  const q = new URLSearchParams(location.search);
  if (q.get('model')) { model.value = q.get('model'); loadGame(model.value); }
  const pick = q.get('ref') && S.refs.find((r) => r.name === q.get('ref'));
  if (pick) { sel.value = pick.name; await loadRef(pick); } else frame();
  if (window.msNav) {
    msNav.shortcuts([{ keys: ['F'], does: 're-frame' }]);
  }
  addEventListener('keydown', (e) => { if (e.key === 'f' && !e.ctrlKey && e.target === document.body) frame(); });
}

S.shot = async (name = 'mesh-ref') => {
  draw();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return fetch(`/api/shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob }).then((r) => r.json());
};

init();
