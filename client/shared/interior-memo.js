// PART MEMO — build a piece of a cockpit once, and again only when something it READ has changed.
//
// shellFaces is a pure function of (profile, live, opts), and each fit-out is a sequence of part
// functions that read the live values only through the object they are handed. So a part can be run
// against a proxy that RECORDS every value it reads, and its faces reused on a later frame while every
// recorded value is still the same. That is the split into static and live geometry, done by
// measurement rather than by hand: a bezel reads nothing live and is built once; a needle reads `rpm`
// and is rebuilt when the revs move; a door reads `on` and is rebuilt when the engine starts.
//
// ⚠ IT IS SOUND ONLY FOR A PURE PART. No clock, no module state, no reading `live` through anything
// but the tracked root — the Drake's parts read `Date.now()` and are not wrapped. What the proxy
// cannot see is a value captured BEFORE the part ran and handed in some other way; every input has to
// arrive through `root`, which is why the wrappers pass the whole S bag and nothing else.
// ⚠ ARRAYS ARE LEAVES, compared by value and returned raw. A proxy handed out in place of an array
// would end up on a face as its `rgb`, and the renderer looks colours up BY IDENTITY (SHINY, PANE,
// TEXTURE) — so a proxied C.amber is a different colour to it. Plain objects are proxied (live,
// live.pedals, live.toys) because that is where the reads fan out.
// ⚠ FACE ORDER IS PRESERVED: a hit appends the part's faces where the part would have pushed them,
// so the renderer's per-slot colour cache and the incremental upload see the same slots as before —
// and the SAME face objects, which is what lets both skip the part entirely.

let ENABLED = true;
export function setInteriorMemo(on) { ENABLED = !!on; }
export function interiorMemoOn() { return ENABLED; }

const STATS = { hit: 0, miss: 0, khit: 0, kmiss: 0, phit: 0, pmiss: 0, pmove: 0 };
export function interiorMemoStats(reset = false) {
  const s = { ...STATS };
  if (reset) for (const k of Object.keys(STATS)) STATS[k] = 0;
  return s;
}

const isPlain = (o) => { const p = Object.getPrototypeOf(o); return p === Object.prototype || p === null; };
const SEP = '\u0001';

// ⚠ AN ARRAY THE RENDERER LOOKS UP BY IDENTITY IS NEVER EQUAL TO A COPY OF ITSELF. SHINY, PANE and
// TEXTURE are keyed on the kit's colour constants, so C.amber and a fresh [255,176,64] draw
// differently; the kit registers that test here (it cannot be imported without a cycle).
let KEYED = () => false;
export function setKeyedColourTest(fn) { KEYED = fn; }

// A recorded value: the original (for identity) and a deep copy (for value, since a live array can
// be rewritten in place between frames).
function snap(v) {
  if (Array.isArray(v)) return { o: v, c: v.map(snap) };
  if (v !== null && typeof v === 'object' && isPlain(v)) { const c = {}; for (const k of Object.keys(v)) c[k] = snap(v[k]); return { o: v, c, obj: true }; }
  return { o: v };
}
function eqSnap(s, b) {
  if (Object.is(s.o, b)) return s.c === undefined || sameCopy(s, b);
  if (s.c === undefined) return false;
  if (s.obj) {
    if (b === null || typeof b !== 'object' || Array.isArray(b) || !isPlain(b)) return false;
    const ks = Object.keys(b);
    if (ks.length !== Object.keys(s.c).length) return false;
    for (const k of ks) { const e = s.c[k]; if (!e || !eqSnap(e, b[k])) return false; }
    return true;
  }
  if (!Array.isArray(b) || b.length !== s.c.length || KEYED(s.o) || KEYED(b)) return false;
  for (let i = 0; i < b.length; i++) if (!eqSnap(s.c[i], b[i])) return false;
  return true;
}
// Same object: still compare contents, since it may have been mutated in place.
function sameCopy(s, b) {
  if (s.obj) { for (const k of Object.keys(s.c)) if (!eqSnap(s.c[k], b[k])) return false; return Object.keys(b).length === Object.keys(s.c).length; }
  if (b.length !== s.c.length) return false;
  for (let i = 0; i < b.length; i++) if (!eqSnap(s.c[i], b[i])) return false;
  return true;
}
const sameVal = (rec, b) => eqSnap(rec, b);

// A proxy over `obj` at `path`, recording into `deps` (a Map keyed by kind+path).
function tracked(obj, path, deps, skip) {
  const kids = new Map();
  return new Proxy(obj, {
    get(t, k, r) {
      if (typeof k === 'symbol') return Reflect.get(t, k, r);
      if (skip && skip.has(k)) return skip.get(k);
      const v = t[k];
      const p = path.concat(k);
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && isPlain(v)) {
        let c = kids.get(k);
        if (!c || c.raw !== v) { c = { raw: v, px: tracked(v, p, deps, null) }; kids.set(k, c); }
        // The object's EXISTENCE is itself a read — `L.pedals || {}` branches on it.
        const key = 'o' + p.join(SEP);
        if (!deps.has(key)) deps.set(key, { kind: 'o', path: p });
        return c.px;
      }
      const key = 'g' + p.join(SEP);
      if (!deps.has(key)) deps.set(key, { kind: 'g', path: p, v: snap(v) });
      return v;
    },
    has(t, k) {
      const res = k in t;
      if (typeof k !== 'symbol') {
        const p = path.concat(k), key = 'h' + p.join(SEP);
        if (!deps.has(key)) deps.set(key, { kind: 'h', path: p, v: res });
      }
      return res;
    },
    ownKeys(t) {
      const ks = Reflect.ownKeys(t);
      const key = 'k' + path.join(SEP);
      if (!deps.has(key)) deps.set(key, { kind: 'k', path, v: ks.join(SEP) });
      return ks;
    },
    set() { throw new Error('interior-memo: a part wrote to its inputs'); },
  });
}

function resolve(root, path, n) {
  let o = root;
  for (let i = 0; i < n; i++) {
    if (o === null || (typeof o !== 'object' && typeof o !== 'function')) return undefined;
    o = o[path[i]];
  }
  return o;
}

function valid(root, deps) {
  for (const d of deps) {
    if (d.kind === 'g') { if (!sameVal(d.v, resolve(root, d.path, d.path.length))) return false; }
    else if (d.kind === 'o') {
      const v = resolve(root, d.path, d.path.length);
      if (v === null || typeof v !== 'object' || Array.isArray(v) || !isPlain(v)) return false;
    } else if (d.kind === 'h') {
      const o = resolve(root, d.path, d.path.length - 1);
      if (o === null || typeof o !== 'object' || ((d.path[d.path.length - 1] in o) !== d.v)) return false;
    } else {
      const o = resolve(root, d.path, d.path.length);
      if (o === null || typeof o !== 'object' || Reflect.ownKeys(o).join(SEP) !== d.v) return false;
    }
  }
  return true;
}

// The memo a collector carries. `store` lives on the profile, so a retrimmed or different seat has
// its own. Up to KEEP entries per part, so a lamp blinking between two states is two hits rather than
// a rebuild on every change.
const STORES = new WeakMap();
const KEEP = 4;
export function memoContext(P, out, collect, tag = '') {
  if (!ENABLED || !P || (typeof P !== 'object' && typeof P !== 'function')) return null;
  let s = STORES.get(P);
  if (!s) { s = new Map(); STORES.set(P, s); }
  return { store: s, out, collect, tag };
}

// Run `run(root', push')` as a memoised part. `root` is the one object the part reads live values
// through; `wire(push')` returns the root-level fields that must NOT be tracked because they are
// rebuilt around the recorder (the kit) or are the profile itself.
export function memoPart(push, id, root, run, wire) {
  const M = push && push.memo;
  if (!M) { run(root, push); return; }
  const key = M.tag + id;
  let list = M.store.get(key);
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (valid(root, e.deps)) {
        if (i) { list.splice(i, 1); list.unshift(e); }
        const out = M.out, f = e.faces;
        for (let j = 0; j < f.length; j++) out.push(f[j]);
        STATS.hit++;
        return;
      }
    }
  } else { list = []; M.store.set(key, list); }
  STATS.miss++;
  const faces = [];
  const rec = M.collect(faces);
  // The recorder carries a memo of its own, so the kit primitives the part calls are cached too.
  // `inPart`: a posed call (memoPosed) builds fresh in here; see the ⚠ there.
  rec.memo = { store: M.store, out: faces, collect: M.collect, tag: key + '#', inPart: true };
  const deps = new Map();
  const over = wire ? wire(rec) : null;
  const skip = over ? new Map(Object.entries(over)) : null;
  run(tracked(root, [], deps, skip), rec);
  list.unshift({ deps: [...deps.values()], faces });
  if (list.length > KEEP) list.length = KEEP;
  const out = M.out;
  for (let j = 0; j < faces.length; j++) out.push(faces[j]);
}

// ── KIT CALLS ────────────────────────────────────────────────────────────────
//
// Inside a part that did rebuild, each kit primitive (a bezel, a knob, a plate) is itself pure in
// its arguments, so it is cached on them — keyed by its ORDINAL in the part, so a part that takes a
// different branch just misses rather than being handed the wrong faces. One context per kit instance.
export function kitMemo(push) {
  const M = push && push.memo;
  if (!M) return null;
  M.kits = (M.kits || 0) + 1;
  // One slot array per kit instance, indexed by call ordinal, so a hit costs no key string.
  const k = M.tag + M.kits;
  let slots = M.store.get(k);
  if (!slots) { slots = []; M.store.set(k, slots); }
  return { M, n: 0, slots, fok: new Map(), fsnap: new Map() };
}
// A frame (the panel's origin and axes, or the kit's fwd) is shared by every call on that panel, so it
// is snapshotted once per build and checked once per build rather than once per call.
function frameOk(ctx, fsn, frame) {
  if (ctx.fok.get(fsn) === frame) return true;
  const ok = eqSnap(fsn, frame);
  if (ok) ctx.fok.set(fsn, frame);
  return ok;
}
function sameCall(ctx, e, name, frame, args) {
  if (e.name !== name || e.a.length !== args.length || !frameOk(ctx, e.fs, frame)) return false;
  for (let i = 0; i < args.length; i++) {
    const sv = e.s[i];
    if (sv === null ? !Object.is(e.a[i], args[i]) : !eqSnap(sv, args[i])) return false;
  }
  return true;
}
function callEntry(ctx, name, frame, args, faces) {
  let fs = ctx.fsnap.get(frame);
  if (!fs) { fs = snap(frame); ctx.fsnap.set(frame, fs); ctx.fok.set(fs, frame); }
  const a = new Array(args.length), sv = new Array(args.length);
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    a[i] = v;
    sv[i] = v !== null && typeof v === 'object' ? snap(v) : null;
  }
  return { name, fs, a, s: sv, faces };
}
export function memoCall(ctx, name, frame, args, run) {
  const M = ctx.M, n = ctx.n++;
  const e = ctx.slots[n];
  if (e && !e.posed && sameCall(ctx, e, name, frame, args)) { const out = M.out, f = e.faces; for (let j = 0; j < f.length; j++) out.push(f[j]); STATS.khit++; return; }
  STATS.kmiss++;
  const faces = [];
  run(M.collect(faces));
  ctx.slots[n] = callEntry(ctx, name, frame, args, faces);
  const out = M.out;
  for (let j = 0; j < faces.length; j++) out.push(faces[j]);
}

// ── POSED CALLS: A RIGID PART, MOVED RATHER THAN REBUILT ─────────────────────────
//
// A needle, a compass card, a control wheel: geometry that keeps its shape and only moves. It is
// built once AT REST, cached on its arguments like any kit call, and each frame the same face objects
// come back with their points rewritten through `X` (a 3x4 transform, row-major: rotation then
// translation). `mv` on a face goes up when its points do, so the renderer keeps its per-face record
// (windshield.js cabFace) and the GPU re-sends only the moved slots (gl/solids.js). A rebuilt needle
// was new face objects every frame: a new record and a re-upload each, about 2 ms of a cockpit frame
// with the instruments moving.
// ⚠ NEVER INSIDE A MEMOISED PART (`inPart`). A part keeps up to KEEP entries, each holding its
// faces, and posed faces shared between entries would show the newest pose in an older one. The kit
// builds those fresh (see `posed` in interior-kit.js).
const clonePosed = (f) => ({ ...f, p: f.p.map((q) => q.slice()), n: f.n ? f.n.slice() : f.n, mv: 0 });
function sameX(a, b) { if (!a) return false; for (let i = 0; i < 12; i++) if (a[i] !== b[i]) return false; return true; }
export function memoPosed(ctx, name, frame, args, X, run) {
  const M = ctx.M, n = ctx.n++;
  let e = ctx.slots[n];
  if (e && e.posed && sameCall(ctx, e, name, frame, args)) STATS.phit++;
  else {
    STATS.pmiss++;
    const faces = [];
    run(M.collect(faces));
    e = callEntry(ctx, name, frame, args, faces);
    e.posed = faces.map(clonePosed); e.x = null;
    ctx.slots[n] = e;
  }
  if (!sameX(e.x, X)) {
    STATS.pmove++;
    const F = e.faces, Q = e.posed;
    for (let i = 0; i < F.length; i++) {
      const src = F[i], dst = Q[i], sp = src.p, dp = dst.p;
      for (let j = 0; j < sp.length; j++) {
        const p = sp[j], d = dp[j], x = p[0], y = p[1], z = p[2];
        d[0] = X[0] * x + X[1] * y + X[2] * z + X[3];
        d[1] = X[4] * x + X[5] * y + X[6] * z + X[7];
        d[2] = X[8] * x + X[9] * y + X[10] * z + X[11];
      }
      if (src.n) { const v = src.n, x = v[0], y = v[1], z = v[2]; dst.n[0] = X[0] * x + X[1] * y + X[2] * z; dst.n[1] = X[4] * x + X[5] * y + X[6] * z; dst.n[2] = X[8] * x + X[9] * y + X[10] * z; }
      dst.mv++;
    }
    e.x = X.slice();
  }
  const out = M.out, Q = e.posed;
  for (let j = 0; j < Q.length; j++) out.push(Q[j]);
}
