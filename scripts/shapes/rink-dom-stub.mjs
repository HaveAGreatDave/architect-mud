// A DOM small enough to run the rink view and nothing more.
//
// Sibling of scripts/shapes/dom-stub.mjs (the flight-sim canvas stub) and there for the
// same reason: the client module under test is plain DOM and canvas code with no browser
// needed to prove it RUNS. This one parses the exact markup the rink shell emits, answers
// the handful of selectors it queries, hands out a permissive 2D context that counts what
// is drawn, and gives the harness a hand-cranked clock so the rAF loop can be advanced
// deterministically instead of waited on.
//
// Deliberately NOT a general DOM. If a selector form the rink doesn't use turns up here,
// the right fix is to add it — a stub that quietly answers everything hides the fact
// that it's answering wrongly.

// ── parsing ─────────────────────────────────────────────────────────────────────
const VOID_TAGS = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'use', 'path', 'circle', 'rect', 'line', 'ellipse', 'polygon', 'polyline', 'stop']);

// The 2D context: every call is accepted and counted, so the harness can tell a frame
// that drew something from one that drew nothing. Gradients and patterns are objects,
// because the renderer passes them back in as fill styles.
export const drawn = { calls: 0, images: 0, text: 0 };
const gradient = { addColorStop() {} };
function makeCtx(canvas) {
  return new Proxy({ canvas }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (txt) => ({ width: String(txt == null ? '' : txt).length * 8 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradient;
      if (k === 'createPattern') return () => ({ setTransform() {} });
      if (k === 'drawImage') return () => { drawn.calls++; drawn.images++; };
      if (k === 'fillText' || k === 'strokeText') return () => { drawn.calls++; drawn.text++; };
      return () => { drawn.calls++; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parent = null;
    this.text = '';
    // `setProperty` is how a custom property (`--gdr-stride`) is written — a real
    // CSSStyleDeclaration has it, and the view drives the stride cadence through it.
    const decl = {
      setProperty(k, v) { this[k] = v; },
      getPropertyValue(k) { return this[k] == null ? '' : this[k]; },
      removeProperty(k) { delete this[k]; },
    };
    this.style = new Proxy(decl, { set: (t, k, v) => { t[k] = v; return true; }, get: (t, k) => (k in t ? t[k] : '') });
    // The rink reads these to size the camera. Fixed values: a tall sliding surface
    // inside a short window, which is the case the camera clamp actually has to handle.
    this.offsetHeight = 400;
    this.clientHeight = 400;
    // a canvas has a backing store the renderer sizes from its box
    this.width = 300; this.height = 150;
  }
  // no WebGL here, so the view takes its 2-D fallback, which is the path this stub counts
  getContext(type) { if (/webgl/.test(String(type || ''))) return null; return (this.__ctx ??= makeCtx(this)); }
  get ownerDocument() { return globalThis.document; }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  get offsetWidth() { return this.__w ?? 520; }
  set offsetWidth(v) { this.__w = v; }
  setAttribute(k, v) { this.attrs.set(String(k), String(v)); }
  getAttribute(k) { const v = this.attrs.get(String(k)); return v == null ? null : v; }
  removeAttribute(k) { this.attrs.delete(String(k)); }
  hasAttribute(k) { return this.attrs.has(String(k)); }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n.__root === true; }
  get classList() {
    const self = this;
    const list = () => String(self.attrs.get('class') || '').split(/\s+/).filter(Boolean);
    const write = (a) => self.attrs.set('class', a.join(' '));
    return {
      add: (...c) => { const a = list(); for (const x of c) if (!a.includes(x)) a.push(x); write(a); },
      remove: (...c) => write(list().filter(x => !c.includes(x))),
      contains: (c) => list().includes(c),
      toggle: (c, on) => { const has = list().includes(c); const want = on === undefined ? !has : !!on; if (want && !has) { const a = list(); a.push(c); write(a); } else if (!want && has) write(list().filter(x => x !== c)); return want; },
    };
  }
  get className() { return String(this.attrs.get('class') || ''); }
  set className(v) { this.attrs.set('class', String(v)); }
  get dataset() {
    const self = this;
    return new Proxy({}, {
      get: (_, k) => self.attrs.get(`data-${String(k).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`),
      set: (_, k, v) => { self.attrs.set(`data-${String(k).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`, String(v)); return true; },
    });
  }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children = []; this.text = String(v); }
  get innerHTML() { return this.__html || ''; }
  set innerHTML(html) { this.__html = String(html); this.children = parse(String(html), this); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  getBoundingClientRect() { return { x: 0, y: 0, width: this.offsetWidth, height: this.offsetHeight, top: 0, left: 0, right: this.offsetWidth, bottom: this.offsetHeight }; }
  querySelector(sel) { return matchAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return matchAll(this, sel); }
  // The harness's own conveniences, not part of the DOM.
  find(sel) { return this.querySelector(sel); }
  findAll(sel) { return this.querySelectorAll(sel); }
}

function parse(html, parent) {
  const out = [];
  const stack = [{ el: parent, kids: out }];
  const re = /<\/?([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const [raw, tag, attrStr, selfClose, textRun] = m;
    const top = stack[stack.length - 1];
    if (textRun != null) {
      const t = textRun.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
      if (t.trim() && top.el) top.el.text += t;
      continue;
    }
    if (raw[1] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const el = new El(tag);
    const ar = /([^\s=]+)(?:\s*=\s*"([^"]*)")?/g;
    let a;
    while ((a = ar.exec(attrStr || ''))) { if (a[1]) el.attrs.set(a[1], a[2] == null ? '' : a[2]); }
    // Inline styles matter: the rink writes left/top through .style, but the SHELL
    // ships some of them as attributes and the two have to end up in one place.
    for (const decl of String(el.attrs.get('style') || '').split(';')) {
      const [k, v] = decl.split(':');
      if (k && v) el.style[k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v.trim();
    }
    el.parent = top.el;
    top.kids.push(el);
    if (!selfClose && !VOID_TAGS.has(tag.toLowerCase())) stack.push({ el, kids: el.children });
  }
  return out;
}

// ── selectors ───────────────────────────────────────────────────────────────────
// Supports exactly what the rink asks for: descendant chains of
// `.class`, `tag`, and `[attr="value"]`, combined.
function parseSimple(part) {
  const classes = [...part.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
  const attrs = [...part.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map(m => [m[1], m[2]]);
  const tagM = part.match(/^([a-zA-Z][\w-]*)/);
  return { tag: tagM ? tagM[1].toUpperCase() : null, classes, attrs };
}
function matchesSimple(el, s) {
  if (s.tag && el.tagName !== s.tag) return false;
  for (const c of s.classes) if (!el.classList.contains(c)) return false;
  for (const [k, v] of s.attrs) if (String(el.attrs.get(k)) !== v) return false;
  return true;
}
function descend(el, out) { for (const c of el.children) { out.push(c); descend(c, out); } }
function matchAll(root, sel) {
  const parts = String(sel).trim().split(/\s+(?![^[]*\])/).map(parseSimple);
  let pool = [];
  descend(root, pool);
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    const hit = pool.filter(el => matchesSimple(el, s));
    if (i === parts.length - 1) return hit;
    pool = [];
    for (const h of hit) descend(h, pool);
  }
  return [];
}

// ── the clock ───────────────────────────────────────────────────────────────────
// Hand-cranked, so a rAF loop and a pile of setTimeouts advance exactly as far as the
// harness says and no further. Waiting on real time would make the suite slow AND
// flaky, which is the pair of properties that gets a test deleted.
export function __install() {
  let now = 0;
  let rafs = new Map();
  let rafId = 1;
  let tos = new Map();
  let toId = 1;

  const doc = {
    createElement: (tag) => new El(tag),
    // Blade cuts are real SVG <line> elements appended one at a time, which is a
    // namespaced create — an ordinary createElement would produce an HTML element the
    // browser refuses to render inside an <svg>.
    createElementNS: (_ns, tag) => new El(tag),
    body: new El('body'),
  };
  const perf = { now: () => now };
  const raf = (fn) => { const id = rafId++; rafs.set(id, fn); return id; };
  const caf = (id) => { rafs.delete(id); };
  globalThis.document = doc;
  globalThis.performance = perf;
  globalThis.requestAnimationFrame = raf;
  globalThis.cancelAnimationFrame = caf;
  globalThis.setTimeout = (fn, ms) => { const id = toId++; tos.set(id, { fn, at: now + (ms || 0) }); return id; };
  globalThis.clearTimeout = (id) => { tos.delete(id); };
  // the view reaches the window through its host's document, and plays sound through it
  const sounds = [];
  globalThis.window = doc.defaultView = {
    AudioEngine: { playSfx: (d) => sounds.push(d && d.id) }, HockeySfx: null,
    SFXCatalog: { get: (id) => ({ id }) },
    requestAnimationFrame: raf, cancelAnimationFrame: caf, performance: perf, devicePixelRatio: 1,
  };

  return {
    sounds, drawn,
    makeHost() { const h = new El('div'); h.__root = true; return h; },
    // Advance the animation clock by `n` frames at 60fps, firing rAF callbacks and any
    // timers that come due in between — the same interleaving a browser would give.
    runFrames(n, stepMs = 16.7) {
      for (let i = 0; i < n; i++) {
        now += stepMs;
        this.drainTimers();
        const due = [...rafs.entries()];
        rafs = new Map();
        for (const [, fn] of due) fn(now);
      }
    },
    // Jump the clock forward and fire everything scheduled, without frames. For the
    // setTimeout chains (poses, crowd sfx, reveals) that don't need the loop.
    runTimers(ms) { now += ms; this.drainTimers(); },
    drainTimers() {
      for (let guard = 0; guard < 5000; guard++) {
        const due = [...tos.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) return;
        for (const [id, t] of due) { tos.delete(id); t.fn(); }
      }
    },
  };
}
