// GL CORE · GPU TIME PER PASS (docs/proposals/gl-core.md, docs/reference/glass-notes.md#per-pass-gpu-time-__glpassms).
//
// One collector for every renderer on the page: GLASS's passes, ROOM, the ballpark and the rink.
// Off (null) unless a bench turns it on, and an untimed frame pays one null check per pass.
//
//   const t0 = passTimer(true);   // start collecting
//   ... paint some frames ...
//   const t = passTimer(false);   // stop; t is the collector
//   const ms = await passTimes(t);  // { mass: 2.7, room: 4.1, ... } summed over the frames, or null
//
// Uses EXT_disjoint_timer_query_webgl2. Without it a pass runs untimed. Timer queries can't nest on
// one context, so an inner pass pauses its outer one and the outer is resumed after; passes on
// different contexts don't touch each other. Results arrive a few frames late, and a disjoint read
// (the GPU clock jumped) gives null.

let PASS_T = null;

export function passTimer(on) {
  const prev = PASS_T;
  PASS_T = on ? { list: [], stack: [] } : null;
  return prev;
}

// Whether a collector is open now.
export const timing = () => PASS_T !== null;

// Reads a finished collector into ms per name, summed over every frame it saw, or null.
export async function passTimes(t) {
  if (!t || !t.list.length) return null;
  const [, lastQ, gl] = t.list[t.list.length - 1];
  for (let k = 0; k < 200 && !gl.getQueryParameter(lastQ, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((r) => setTimeout(r, 10));
  const out = {};
  let disjoint = false;
  for (const [name, q, g, ext] of t.list) {
    disjoint = disjoint || !!g.getParameter(ext.GPU_DISJOINT_EXT);
    if (g.getQueryParameter(q, g.QUERY_RESULT_AVAILABLE)) out[name] = (out[name] || 0) + g.getQueryParameter(q, g.QUERY_RESULT) / 1e6;
    g.deleteQuery(q);
  }
  return disjoint ? null : out;
}

// A `timed(name, fn)` for one context: runs fn, inside a timer query when a collector is open.
// The extension is looked up the first time a timed frame needs it.
export function timerFor(gl) {
  let ext;
  return function timed(name, fn) {
    const T = PASS_T;
    if (!T) return fn();
    if (ext === undefined) ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return fn();
    const open = (n) => { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); T.list.push([n, q, gl, ext]); };
    const top = T.stack[T.stack.length - 1], outer = top && top[1] === gl ? top[0] : null;
    if (outer) gl.endQuery(ext.TIME_ELAPSED_EXT);
    T.stack.push([name, gl]); open(name);
    try { return fn(); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); T.stack.pop(); if (outer) open(outer); }
  };
}

// Wraps a renderer's methods so each is timed under its name: `pairs` is [[method, name], ...].
// Fixed arity rather than rest args, so an untimed call allocates nothing (no method takes more than
// six). Returns `api`, changed in place.
export function timeMethods(gl, api, pairs) {
  const timed = timerFor(gl);
  for (const [k, name] of pairs) {
    const f = api[k];
    if (typeof f !== 'function') continue;
    api[k] = (a, b, c, d, e, g) => (PASS_T ? timed(name, () => f.call(api, a, b, c, d, e, g)) : f.call(api, a, b, c, d, e, g));
  }
  return api;
}
