// ── Dev-panel UI registration ────────────────────────────────────────────────
//
// A plugin is self-contained everywhere except here. Drop a folder in `/plugins/`,
// declare a manifest, and the loader wires its commands, hooks, events, actions,
// ticks and routes with no core change — that is the stated rule. But the moment a
// plugin wanted an OPERATOR SURFACE it had to reach into four shared client files:
// a nav row and a <script> tag in `index.html`, an entry in `PANELS`, and sometimes
// a row in `NAV_ALIASES`. So every plugin with a dev UI was partly not a plugin.
//
// The cost was not theoretical. Those four files are edited by whoever is adding a
// panel, which on 2026-08-31/09-01 meant two sessions writing the same files at
// once: one session's half-finished panel edits were swept into another's commits
// twice, and a regress run against that intermediate state produced three failures
// that looked like flakes and were not.
//
// So: a plugin declares `devPanel` in its manifest, ships its panel file inside its
// own folder, and calls `registerDevPanel()` from it. Nothing in `client/devpanel/`
// is touched again.
//
// ⚠ WHY THE MANIFEST CARRIES THE NAV ROW AND THE SCRIPT CARRIES THE BEHAVIOUR.
// The shell needs the nav entry BEFORE the panel script has run — a nav row is what
// you click to make a panel load. But `fetch` and `render` are functions, and a
// manifest is JSON. Splitting them is not a compromise: it is the same split the
// engine already uses, where `plugin.json` declares WHAT a plugin offers and
// `index.js` provides it.
//
// ⚠ LOAD ORDER IS STILL A CONTRACT. Plugin panels are appended AFTER every core
// script, so `API`, `directAPI`, `PANELS`, `showPanel` and the shared helpers a
// panel reaches for (`ensureDistrictData` and friends) all exist by the time one
// runs. A plugin panel may depend on the core; the core may never depend on one.

/**
 * Called by a plugin's own panel script, once, at load.
 *
 *   registerDevPanel({
 *     id: 'unrest',
 *     title: 'Unrest',
 *     description: 'What the operator is looking at.',
 *     fetch: async () => ({ ...await directAPI('/unrest/state') }),
 *     render: renderUnrestPanel,
 *     noEdit: true,           // no Save/Delete/New — most operator panels
 *     navAlias: 'unrest',     // this panel highlights ANOTHER panel's nav row
 *   })
 *
 * Everything but `id` and `render` is optional.
 */
function registerDevPanel(def) {
  // ⚠ A panel needs an id and a WAY TO DRAW, and there are two of those. A bespoke
  // surface supplies `render`; a generic list supplies `columns` and is drawn by the
  // core list renderer with no render function at all — which is how the Incidents
  // catalogue has always worked. Demanding `render` rejected it, and the only reason
  // that was caught is that this seam's first real user happened to be a list panel.
  const drawable = typeof def?.render === 'function' || Array.isArray(def?.columns);
  if (!def || !def.id || !drawable) {
    console.warn('[devpanel] registerDevPanel needs { id } plus either render() or columns[]', def);
    return;
  }
  // ⚠ A plugin may not overwrite a core panel. The failure that guards against is
  // a plugin id colliding with `zones` or `items` and silently replacing the panel
  // the whole builder runs on — which would look like the dev panel breaking, not
  // like a plugin misbehaving.
  if (PANELS[def.id] && !PANELS[def.id]._fromPlugin) {
    console.warn(`[devpanel] plugin panel "${def.id}" collides with a core panel — ignored`);
    return;
  }
  // Everything the core registry understands is passed straight through, so a
  // plugin can register a generic LIST panel (columns/editForm/save/delete) as
  // readily as a bespoke render. Whitelisted rather than spread, because a typo'd
  // key silently doing nothing is a better failure than a typo'd key overwriting
  // machinery the list renderer relies on.
  const PASSTHROUGH = ['title', 'description', 'fetch', 'render', 'noEdit', 'idPrefix',
    'columns', 'editForm', 'save', 'delete', 'beforeList', 'afterList', 'rowClass', 'sortDefault'];
  const entry = { _fromPlugin: true };
  for (const k of PASSTHROUGH) if (def[k] !== undefined) entry[k] = def[k];
  entry.title = def.title || def.id;
  entry.description = def.description || '';
  // An operator surface defaults to read-only; a list panel that authors content
  // opts back in by passing `noEdit: false`.
  if (entry.noEdit === undefined) entry.noEdit = !def.columns;
  if (!entry.fetch) entry.fetch = async () => ({});
  PANELS[def.id] = entry;
  if (def.navAlias) NAV_ALIASES[def.id] = def.navAlias;
}

/**
 * Boot step: ask the server which plugins declare a panel, put their nav rows in
 * the sidebar, then load their scripts. Returns once every script has run, so the
 * caller can restore a panel from the URL knowing plugin panels are registered.
 *
 * Failure is deliberately quiet and total: a plugin panel that will not load must
 * cost the operator its tab and nothing else. The builder is what you reach for
 * when the game is already broken, so it can never be the second thing broken.
 */
async function loadPluginPanels() {
  let panels = [];
  try {
    const res = await fetch('/dev/plugin-panels.json', { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return;
    panels = (await res.json())?.panels || [];
  } catch { return; }
  if (!Array.isArray(panels) || !panels.length) return;

  const nav = document.getElementById('nav-plugin-panels');
  for (const p of panels) {
    if (!p?.plugin || !p?.id) continue;
    // The nav row goes in whether or not the script loads. A tab that errors on
    // click is a better bug report than a tab that silently never existed.
    if (nav && p.nav) {
      const row = document.createElement('div');
      row.className = 'nav-item';
      row.dataset.panel = p.navAlias || p.id;
      row.textContent = p.nav;
      row.onclick = () => showPanel(p.id);
      nav.appendChild(row);
    }
  }
  // Sequential, not Promise.all: a panel may reasonably depend on one registered
  // by a plugin it declares `after` in its manifest, and the server hands them
  // back in that same load order.
  for (const p of panels) {
    if (!p?.plugin) continue;
    // ⚠ SEQUENTIAL, AND IN THE DECLARED ORDER. These are classic scripts sharing
    // one global scope, so a panel that registers with a helper defined in a
    // sibling file needs that sibling to have run — `Promise.all` here would load
    // them in whatever order the network returned and fail intermittently, which
    // is the worst way for this to break.
    for (const file of (p.scripts || [])) {
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = `/dev/plugin/${encodeURIComponent(p.plugin)}/${encodeURIComponent(file)}`;
        s.onload = resolve;
        s.onerror = () => { console.warn(`[devpanel] plugin panel script failed: ${p.plugin}/${file}`); resolve(); };
        document.body.appendChild(s);
      });
    }
  }
}

window.registerDevPanel = registerDevPanel;
window.loadPluginPanels = loadPluginPanels;
