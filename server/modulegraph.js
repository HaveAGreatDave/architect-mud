// server/modulegraph.js
//
// Generate <link rel="modulepreload"> hints for the game client's static module
// graph, computed at boot from the source itself.
//
// ── The problem this solves ──────────────────────────────────────────────────
// The client is 93 ES modules with no build step. A browser cannot request a
// module until it has downloaded AND parsed the module that imports it, so the
// graph resolves in *waves*, and every wave costs a full round trip to the edge.
//
// Measured against production (Cloudflare, HTTP/3, so multiplexing is NOT the
// constraint): median stall per JS file 516 ms, 45 s aggregate, and
// DOMContentLoaded at 2,129 ms against domInteractive at 500 ms. Roughly 1.6 s
// of the load is the browser discovering the graph one level at a time. It is
// *worse* in production than on localhost precisely because the round trips are
// real — which is the signature of a dependency waterfall rather than a
// bandwidth or connection-count problem.
//
// A modulepreload hint tells the browser about a module before its importer has
// been parsed, so all 93 fetches start immediately and in parallel.
//
// ── Why generated at boot, not written into the HTML ─────────────────────────
// A hand-maintained list in index.html would be wrong the first time anyone adds
// an import, and wrong silently — a missing hint just means that module goes
// back to being discovered late. Computing it from the source at boot means the
// hints cannot drift, and it keeps the repo's no-build-step rule intact.

import { readFileSync, existsSync } from 'fs';
import { dirname, join, relative, sep } from 'path';

// Static `import ... from '…'` / `export ... from '…'` only. Dynamic `import()`
// is deliberately EXCLUDED: those modules are lazy on purpose (the tablet app
// does this in eight places), and preloading them would drag the very code the
// author took care to defer back into the critical path.
const STATIC_FROM = /^\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/gm;
// `import './side-effect.js'` — no bindings, still a static dependency.
const BARE_IMPORT = /^\s*import\s*['"](\.[^'"]+)['"]/gm;

/**
 * Walk the static import closure from an entry module.
 * @param {string} entryFile absolute/relative path to the entry (js/main.js)
 * @param {string} webRoot   directory that maps to the site root for these URLs
 * @returns {string[]} web paths, in discovery order
 */
export function staticModuleGraph(entryFile, webRoot) {
  const seen = new Set();
  const order = [];

  const visit = (file) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { return; }
    order.push(file);
    for (const re of [STATIC_FROM, BARE_IMPORT]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const spec = m[1];
        // Bare specifiers would be a bundler concern; this codebase has none.
        if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
        const target = spec.startsWith('/')
          ? join(webRoot, '..', spec)          // '/shared/x.js' → client/shared/x.js
          : join(dirname(file), spec);
        visit(target.endsWith('.js') ? target : `${target}.js`);
      }
    }
  };
  visit(entryFile);

  return order.map((f) => {
    // '/shared/*' lives outside the game root; everything else is relative to it.
    const rel = relative(webRoot, f).split(sep).join('/');
    return rel.startsWith('..') ? `/${f.split(sep).slice(-2).join('/')}` : rel;
  });
}

/**
 * The <link> block to inject. The entry module itself is skipped — it already
 * has its own <script type="module">, and preloading it would be a duplicate
 * hint for a fetch the browser has already started.
 */
export function modulePreloadTags(entryFile, webRoot, { skipFirst = true } = {}) {
  const paths = staticModuleGraph(entryFile, webRoot);
  const list = skipFirst ? paths.slice(1) : paths;
  if (!list.length) return '';
  return list.map((p) => `<link rel="modulepreload" href="${p}">`).join('\n\t\t');
}
