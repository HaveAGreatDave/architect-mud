// A classic <script> from /shared, injected the first time something needs it instead of
// sitting in index.html for every boot. For the global-attaching banks and parsers
// (hockey-sfx.js, mod-parser.js) that only one activity uses. One promise per src, so
// two callers share one fetch; a failed load clears it so the next call retries.
const pending = new Map();

export function loadClassicScript(src) {
  let p = pending.get(src);
  if (p) return p;
  p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => { pending.delete(src); s.remove(); reject(new Error(`${src} failed to load`)); };
    document.head.appendChild(s);
  });
  pending.set(src, p);
  return p;
}
