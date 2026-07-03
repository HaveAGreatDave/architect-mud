// Reusable "reorderable list" engine. A list is any container whose direct-child
// rows can be dragged to reorder and individually deleted, with the arrangement
// persisted per-list in localStorage.
//
// Two kinds of list are supported through the same API:
//   - Static lists (e.g. Vitals): rows are fixed DOM. Register once; the applied
//     order/hidden state sticks because nothing rebuilds them.
//   - Re-rendered lists (e.g. Skills/Stats): the panel wipes and rebuilds its rows
//     from server data on every update. The render fn calls registerList again at
//     the end of each render; the engine re-applies the saved order + hidden set
//     and re-wires, so the player's custom arrangement survives the refresh.
//
// Editing is gated by a per-panel "scope": one edit toggle (mounted via
// mountScopeToggle) flips every list sharing that scope into edit mode at once.

const ORDER_PREFIX = 'architect_list_order_';
const HIDDEN_PREFIX = 'architect_list_hidden_';

// scope -> Set of container elements registered under it
const scopeLists = new Map();
// scope -> bool (transient; editing state is not persisted)
const scopeEditing = new Map();
// container -> options, so re-registration and toggles can find a list's config
const listOpts = new WeakMap();

let dragEl = null;

// Live containers for a scope, pruning any that a re-render has detached (the
// dynamic panels build a fresh section element every render, orphaning the old).
function liveLists(scope) {
  const set = scopeLists.get(scope);
  if (!set) return [];
  for (const c of set) if (!c.isConnected) set.delete(c);
  return [...set];
}

function loadArr(prefix, key) {
  try { return JSON.parse(localStorage.getItem(prefix + key)) || []; } catch { return []; }
}
function saveArr(prefix, key, arr) {
  if (arr.length) localStorage.setItem(prefix + key, JSON.stringify(arr));
  else localStorage.removeItem(prefix + key);
}

function rowsOf(container, sel) {
  return [...container.querySelectorAll(`:scope > ${sel}`)];
}

// The row is the ancestor of the event target that is a direct child of the
// container (closest() can't express ":scope >", so walk it by hand).
function rowFromTarget(container, sel, target) {
  let el = target;
  while (el && el.parentElement !== container) el = el.parentElement;
  return el && el.matches(sel) ? el : null;
}

function keyOf(el, opts, i) {
  return el.dataset.lrKey || el.id || (opts.rowKey && opts.rowKey(el, i)) || String(i);
}

// Reorder the rows to match the saved key order and mark hidden rows, without
// disturbing any non-row siblings (category labels, column headers) that sit
// above the rows.
function applyState(container, opts) {
  const rows = rowsOf(container, opts.rowSelector);
  if (!rows.length) return;
  rows.forEach((el, i) => { el.dataset.lrKey = keyOf(el, opts, i); });

  const order = loadArr(ORDER_PREFIX, opts.key);
  const hidden = new Set(loadArr(HIDDEN_PREFIX, opts.key));

  // Desired sequence: saved-order rows first (in saved order), then any rows not
  // in the saved list, in their current DOM order.
  const byKey = new Map(rows.map(el => [el.dataset.lrKey, el]));
  const ordered = [];
  for (const k of order) { if (byKey.has(k)) { ordered.push(byKey.get(k)); byKey.delete(k); } }
  for (const el of rows) { if (byKey.has(el.dataset.lrKey)) ordered.push(el); }

  // Re-insert the ordered rows starting at the first row's original slot, leaving
  // everything before it (labels/headers) untouched.
  const marker = document.createComment('lr');
  container.insertBefore(marker, rows[0]);
  const frag = document.createDocumentFragment();
  for (const el of ordered) {
    el.classList.toggle('list-row-hidden', hidden.has(el.dataset.lrKey));
    frag.appendChild(el);
  }
  container.insertBefore(frag, marker);
  marker.remove();
}

function ensureRowControls(container, opts) {
  for (const el of rowsOf(container, opts.rowSelector)) {
    el.classList.add('list-row');
    if (!el.querySelector(':scope > .list-row-del')) {
      const del = document.createElement('button');
      del.className = 'list-row-del';
      del.title = 'Remove from list';
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const hidden = new Set(loadArr(HIDDEN_PREFIX, opts.key));
        hidden.add(el.dataset.lrKey);
        saveArr(HIDDEN_PREFIX, opts.key, [...hidden]);
        el.classList.add('list-row-hidden');
        // Optional purge hook: lets the owner drop any backing data for a removed
        // row (e.g. a locally-cached file), beyond just hiding it from the list.
        if (opts.onRemove) opts.onRemove(el.dataset.lrKey, el);
      });
      el.appendChild(del);
    }
  }
}

function wireDrag(container, opts) {
  if (container._lrDragWired) return;
  container._lrDragWired = true;
  container.addEventListener('dragstart', (e) => {
    if (!scopeEditing.get(opts.scope)) return;
    const row = rowFromTarget(container, opts.rowSelector, e.target);
    if (!row) return;
    dragEl = row;
    row.classList.add('list-row-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover', (e) => {
    if (!dragEl || dragEl.parentElement !== container) return;
    e.preventDefault();
    const after = rowsOf(container, opts.rowSelector).find(r => {
      if (r === dragEl || r.classList.contains('list-row-hidden')) return false;
      const box = r.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    if (after) container.insertBefore(dragEl, after);
    else container.appendChild(dragEl);
  });
  container.addEventListener('drop', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    persistOrder(container, opts);
  });
  container.addEventListener('dragend', () => {
    if (dragEl) dragEl.classList.remove('list-row-dragging');
    dragEl = null;
  });
}

function persistOrder(container, opts) {
  const order = rowsOf(container, opts.rowSelector).map(el => el.dataset.lrKey);
  saveArr(ORDER_PREFIX, opts.key, order);
}

function applyEditClass(container, opts) {
  const on = !!scopeEditing.get(opts.scope);
  container.classList.toggle('list-editing', on);
  for (const el of rowsOf(container, opts.rowSelector)) el.draggable = on;
}

// Register (or re-register, after a re-render) one reorderable list.
//   container    — the element holding the rows
//   opts.scope   — groups lists under one edit toggle (e.g. 'vitals', 'skills')
//   opts.key     — localStorage namespace for this list's order/hidden state
//   opts.rowSelector — CSS selector for the row elements (relative to container)
//   opts.rowKey  — optional (el, index) => stableKey, when rows have no id
//   opts.onRemove — optional (key, el) => void, fired when a row's ✕ is clicked
//                   (after it's hidden), for owners that also need to purge
//                   backing data for that row
export function registerList(container, opts) {
  listOpts.set(container, opts);
  let set = scopeLists.get(opts.scope);
  if (!set) { set = new Set(); scopeLists.set(opts.scope, set); }
  set.add(container);

  applyState(container, opts);
  ensureRowControls(container, opts);
  wireDrag(container, opts);
  applyEditClass(container, opts);
}

// Mount the edit toggle (⇅) + reset (⟲) for a scope into a host element. Call once
// at panel init; the buttons drive every list sharing the scope.
export function mountScopeToggle(scope, host) {
  if (!host || host.querySelector(':scope > .list-edit-controls')) return;
  const wrap = document.createElement('span');
  wrap.className = 'list-edit-controls';

  const toggle = document.createElement('button');
  toggle.className = 'list-edit-toggle';
  toggle.title = 'Reorder / remove list items';
  toggle.innerHTML = '⇅';

  const reset = document.createElement('button');
  reset.className = 'list-edit-reset';
  reset.title = 'Reset this list to defaults';
  reset.innerHTML = '⟲';

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !scopeEditing.get(scope);
    scopeEditing.set(scope, on);
    wrap.classList.toggle('editing', on);
    toggle.classList.toggle('active', on);
    for (const c of liveLists(scope)) applyEditClass(c, listOpts.get(c));
  });

  reset.addEventListener('click', (e) => {
    e.stopPropagation();
    for (const c of liveLists(scope)) {
      const opts = listOpts.get(c);
      saveArr(ORDER_PREFIX, opts.key, []);
      saveArr(HIDDEN_PREFIX, opts.key, []);
    }
    resetScope(scope);
  });

  wrap.append(toggle, reset);
  host.appendChild(wrap);
}

// Re-apply saved (now-cleared) state to every list in a scope. For static lists
// this restores default order + unhides immediately; re-rendered lists also pick
// it up on their next render.
function resetScope(scope) {
  for (const c of liveLists(scope)) {
    const opts = listOpts.get(c);
    for (const el of rowsOf(c, opts.rowSelector)) el.classList.remove('list-row-hidden');
    applyState(c, opts);
    applyEditClass(c, opts);
  }
}
