// ── Sidebar groups and the jump-to filter ──────────────────────────────────
// The nav is six folding groups (index.html, .nav-group[data-group]) under
// Dashboard and Dev Log, with a filter box above them.
//
// A group is open when you opened it, or when it holds the panel on screen and
// you haven't folded it yourself. Only your own clicks are remembered
// (localStorage), so opening a panel never leaves its group open for good, and
// the nav doesn't drift back into one long list.
//
// navRefresh() is the one entry point for anything that changes which rows
// exist or show: a panel opening (activatePanelNav), the ops read-only toggle,
// plugin rows arriving, the MIS Fit reveal. It recounts each group, hides a
// group with nothing visible in it, and reapplies the folds and the filter.

const NAV_FOLD_KEY = 'devpanel-nav-groups';
let _navFold = {};
try { _navFold = JSON.parse(localStorage.getItem(NAV_FOLD_KEY) || '{}') || {}; } catch { _navFold = {}; }
let _navQuery = '';

// Hidden by ops mode (display:none set in bootstrap.js), not by the filter.
function navRowShown(el) { return el.style.display !== 'none'; }

function navGroupIsOpen(g) {
  const want = _navFold[g.dataset.group];
  if (want === true) return true;
  if (want === false) return false;
  return !!g.querySelector('.nav-item.active');
}

function navToggleGroup(id) {
  const g = document.querySelector(`.nav-group[data-group="${CSS.escape(id)}"]`);
  if (!g) return;
  _navFold[id] = !navGroupIsOpen(g);
  try { localStorage.setItem(NAV_FOLD_KEY, JSON.stringify(_navFold)); } catch {}
  navRefresh();
}

function navRowMatches(el, q, groupLabel) {
  const hay = (el.textContent + ' ' + (el.dataset.panel || '') + ' ' + groupLabel).toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

function navRefresh() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const q = _navQuery;
  nav.classList.toggle('nav-filtering', !!q);
  // Dashboard and Dev Log sit outside the groups; the filter still reaches them.
  nav.querySelectorAll(':scope > .nav-item[data-panel]').forEach(el => {
    el.classList.toggle('nav-miss', !!q && !navRowMatches(el, q, ''));
  });
  nav.querySelectorAll('.nav-group').forEach(g => {
    const head = g.querySelector('.nav-group-head');
    const label = head ? (head.dataset.label || (head.dataset.label = head.textContent.trim())) : '';
    const rows = [...g.querySelectorAll('.nav-item')].filter(navRowShown);
    let hits = 0;
    rows.forEach(el => {
      const miss = !!q && !navRowMatches(el, q, label);
      el.classList.toggle('nav-miss', miss);
      if (!miss) hits++;
    });
    // VINE's sub-rows fold under their parent; a filter hit inside has to show.
    g.querySelectorAll('.nav-children').forEach(c => {
      c.classList.toggle('nav-children-hit', !!q && !!c.querySelector('.nav-item:not(.nav-miss)'));
    });
    const open = q ? hits > 0 : navGroupIsOpen(g);
    g.style.display = rows.length && (!q || hits) ? '' : 'none';
    g.classList.toggle('open', open);
    g.classList.toggle('has-active', !!g.querySelector('.nav-item.active'));
    if (head) {
      head.innerHTML = '';
      head.append(label);
      const n = document.createElement('span');
      n.className = 'nav-group-count';
      n.textContent = q ? `${hits}` : `${rows.length}`;
      head.append(n);
      head.title = open ? `Fold ${label}` : `Show ${label}`;
    }
  });
}

function navFilter(value) {
  _navQuery = String(value || '').trim().toLowerCase();
  navRefresh();
}

function navClearFilter(input) {
  if (input) input.value = '';
  navFilter('');
}

function navFilterKey(e) {
  if (e.key === 'Escape') {
    navClearFilter(e.target);
    e.target.blur();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const first = [...document.querySelectorAll('#nav .nav-item:not(.nav-miss)')]
      .find(el => navRowShown(el) && el.closest('.nav-group')?.style.display !== 'none' && el.offsetParent !== null);
    if (!first) return;
    navClearFilter(e.target);
    e.target.blur();
    first.click();
  }
}

// Ctrl+K / Cmd+K from anywhere. On a phone the nav is a drawer, so open it first.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return;
  const input = document.getElementById('nav-filter');
  if (!input) return;
  e.preventDefault();
  const layout = document.getElementById('layout');
  if (layout && matchMedia('(max-width: 768px)').matches) layout.classList.add('nav-open');
  input.focus();
  input.select();
});

document.addEventListener('DOMContentLoaded', navRefresh);

window.navToggleGroup = navToggleGroup;
window.navRefresh = navRefresh;
window.navFilter = navFilter;
window.navFilterKey = navFilterKey;
