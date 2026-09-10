// THE TOOL PALETTE — a floating panel, not a dialog.
//
// It replaced a modal picker, and the reason is the whole design: a modal is a thing you open,
// take one action from, and dismiss, which is exactly wrong for the surface you pick a tool from
// while you work. This stays open over the viewport, is dragged where you want it by its head, and
// is closed and brought back with the Tools button or T.
//
// Everything in it is an ICON with a tooltip rather than a labelled tile. That is not decoration:
// sixteen labelled tiles is a panel the size of the rail, and the panel has to be small enough to
// leave beside the model.
//
// ⚠ Icons are drawn as SVG through createElementNS, never as an innerHTML string. This tool builds
// its markup through the DOM everywhere else for the reason CLAUDE.md gives (a backtick inside a
// template literal ends the string mid-sentence), and one file that does it differently is the one
// that eventually breaks the client boot.
const NS = 'http://www.w3.org/2000/svg';

// 24x24, one or two paths each. Drawn as line art so a tool reads at 16px: the shapes are the
// silhouette of the thing the tool makes, so `drum` is a cylinder and `sawtooth` is a sawtooth.
const ICONS = {
  move: ['M12 3v18M3 12h18', 'M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3'],
  scale: ['M4 20V9h11v11z', 'M9 4h11v11M20 4l-7 7'],
  rotate: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v4h-4'],

  box: ['M4 8l8-4 8 4v8l-8 4-8-4z', 'M4 8l8 4 8-4M12 12v8'],
  drum: ['M6 7c0-1.7 2.7-3 6-3s6 1.3 6 3v10c0 1.7-2.7 3-6 3s-6-1.3-6-3z', 'M6 7c0 1.7 2.7 3 6 3s6-1.3 6-3'],
  barrel: ['M4 19v-6a8 8 0 0 1 16 0v6', 'M4 19h16'],
  sawtooth: ['M3 19v-5l4-4v5l4-4v5l4-4v5l4-4v11z', 'M3 19h18'],

  mast: ['M12 21V4', 'M12 4l4 6M12 4L8 10M7 21l5-4 5 4'],
  dish: ['M5 17a9 9 0 0 1 12-9', 'M9 21h8M13 21l1-5'],
  blinkLight: ['M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M12 4v3M12 17v3M4 12h3M17 12h3M6 6l2 2M18 6l-2 2'],
  glowPool: ['M12 16c5 0 8-1.3 8-3s-3-3-8-3-8 1.3-8 3 3 3 8 3z', 'M12 12.5h.01'],
  helideck: ['M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0', 'M9 8v8M15 8v8M9 12h6'],
  latticeTower: ['M8 21L11 3M16 21L13 3', 'M9 16h6M10 11h4M10.5 7h3'],
  neonBlade: ['M9 3h6v18H9z', 'M12 6v3M12 12v3'],
  marqueeBand: ['M3 9h18v6H3z', 'M6 9v6M10 9v6M14 9v6M18 9v6'],
  awning: ['M3 8h18l-3 6H6z', 'M6 14v3M18 14v3'],
};

function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '17'); svg.setAttribute('height', '17');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // A tool with no icon still gets a button — an unnamed square rather than nothing at all, so a
  // kind added to the schema appears here immediately instead of silently going missing.
  for (const d of ICONS[name] || ['M5 5h14v14H5z']) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// Where the panel sits and whether it is open, kept per browser so it stays where you put it.
// A missing or unreadable value is simply the default — this is a convenience, and a tool that
// refused to start because localStorage was blocked would be a worse tool.
const STORE = 'modelshop.toolbox';
function saved() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; }
}
function save(v) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private window, no harm */ }
}

export function toolboxOpen() { return saved().open !== false; }

export function setToolboxOpen(open) {
  const box = document.getElementById('toolbox');
  if (!box) return;
  box.hidden = !open;
  save({ ...saved(), open });
}

export function toggleToolbox() { setToolboxOpen(!!document.getElementById('toolbox')?.hidden); }

// One group of icon buttons.
export function toolboxSection(host, name, items) {
  const h = document.createElement('div'); h.className = 'grp'; h.textContent = name;
  const grid = document.createElement('div'); grid.className = 'icons';
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'ic' + (it.on ? ' on' : '') + (it.enabled === false ? ' off' : '');
    // The tooltip carries what the labelled tile used to say, which is why the icons can be this
    // small: the name and the sentence are both still there, one hover away.
    b.title = it.title + (it.help ? ' — ' + it.help : '')
      + (it.enabled === false ? '\n(select an authored model first — a hand-written arm cannot be edited)' : '');
    b.setAttribute('aria-label', it.title);
    b.append(icon(it.icon || it.title));
    if (it.enabled !== false) b.onclick = it.onPick;
    grid.append(b);
  }
  host.append(h, grid);
}

// Dragged by its head, and clamped so it can never be dropped off the edge of the stage where
// there is no way to get it back.
export function initToolbox(onClose) {
  const box = document.getElementById('toolbox');
  const head = document.getElementById('tbhead');
  if (!box || !head) return;
  const pos = saved();
  box.style.left = (pos.x ?? 10) + 'px';
  box.style.top = (pos.y ?? 46) + 'px';
  box.hidden = !toolboxOpen();

  let drag = null;
  head.addEventListener('mousedown', (ev) => {
    if (ev.target.id === 'tbclose') return;
    ev.preventDefault();
    drag = { dx: ev.clientX - box.offsetLeft, dy: ev.clientY - box.offsetTop };
  });
  addEventListener('mousemove', (ev) => {
    if (!drag) return;
    const stage = box.offsetParent || document.body;
    const maxX = Math.max(0, stage.clientWidth - box.offsetWidth);
    const maxY = Math.max(0, stage.clientHeight - box.offsetHeight);
    const x = Math.min(maxX, Math.max(0, ev.clientX - drag.dx));
    const y = Math.min(maxY, Math.max(0, ev.clientY - drag.dy));
    box.style.left = x + 'px'; box.style.top = y + 'px';
  });
  addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null;
    save({ ...saved(), x: box.offsetLeft, y: box.offsetTop });
  });

  document.getElementById('tbclose').onclick = () => { setToolboxOpen(false); onClose?.(); };
}
