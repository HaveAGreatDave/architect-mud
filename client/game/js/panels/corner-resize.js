// Corner grips that resize a floating window: the tablet and the CRT TV.
//
// Four grips straddle the window's corners. Dragging one moves that corner and
// leaves the opposite one where it is, so the window takes its pixel position
// on the first press, the way makeDraggable does. The size is kept in
// localStorage under `key` and comes back on the next open, clamped to the
// viewport. A double-click on any grip forgets it and hands the size back to
// the stylesheet.
//
// `box` is the element that's positioned and carries the grips; `sizeEl` is the
// one whose width and height change (the tablet sizes its panel inside a
// positioned anchor; the TV is one element). With `lockAspect` only the width
// is written and the stylesheet's aspect-ratio sets the height, so the set
// keeps the shape of its picture.
//
// The compact (phone) layout fills the screen with both windows, so there the
// grips are hidden and any stored size is left off the element until the
// layout goes back to desktop.

const isCompact = () => document.documentElement.getAttribute('data-density') === 'compact';

function readSize(key) {
  try {
    const s = JSON.parse(localStorage.getItem(key));
    return s && s.w > 0 ? s : null;
  } catch { return null; }
}
function writeSize(key, s) {
  try { if (s) localStorage.setItem(key, JSON.stringify(s)); else localStorage.removeItem(key); } catch { /* storage blocked */ }
}

export function makeCornerResizable(box, { key, sizeEl = box, minW = 320, minH = 240, lockAspect = false } = {}) {
  if (!box || box.dataset.cornerResize) return;
  box.dataset.cornerResize = '1';

  const clearSize = () => {
    sizeEl.style.width = '';
    sizeEl.style.height = '';
    sizeEl.style.maxHeight = '';
  };

  // Write a stored size, shrunk to fit the viewport. The aspect comes from the
  // stored pair, because the TV is display:none when this first runs.
  const applySize = (w, h) => {
    const vw = globalThis.innerWidth, vh = globalThis.innerHeight;
    if (lockAspect) {
      const aspect = h > 0 ? w / h : 1;
      w = Math.max(minW, Math.min(w, vw, vh * aspect));
      sizeEl.style.width = Math.round(w) + 'px';
    } else {
      w = Math.max(minW, Math.min(w, vw));
      h = Math.max(minH, Math.min(h, vh));
      sizeEl.style.width = Math.round(w) + 'px';
      sizeEl.style.height = Math.round(h) + 'px';
      sizeEl.style.maxHeight = 'none';
    }
    // A placed window that now hangs off the edge comes back inside.
    if (box.style.left) {
      const x = Math.max(0, Math.min(vw - box.offsetWidth, parseFloat(box.style.left) || 0));
      const y = Math.max(0, Math.min(vh - box.offsetHeight, parseFloat(box.style.top) || 0));
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    }
  };

  const restore = () => {
    if (!box.isConnected) return;
    if (isCompact()) { clearSize(); return; }
    const s = readSize(key);
    if (s) applySize(s.w, s.h);
  };

  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const grip = document.createElement('div');
    grip.className = 'corner-grip';
    grip.dataset.corner = corner;
    grip.setAttribute('aria-hidden', 'true');
    grip.title = 'Drag to resize. Double-click to reset.';
    box.appendChild(grip);

    const west = corner[1] === 'w', north = corner[0] === 'n';
    let start = null;

    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || isCompact()) return;
      e.preventDefault();
      e.stopPropagation();
      const r = box.getBoundingClientRect();
      // Pin the window where it is, so only the dragged corner moves.
      box.style.position = 'fixed';
      box.style.margin = '0';
      box.style.transform = 'none';
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      start = {
        x: e.clientX, y: e.clientY,
        w: sizeEl.offsetWidth, h: sizeEl.offsetHeight,
        right: r.left + r.width, bottom: r.top + r.height, left: r.left, top: r.top,
        // the box's own chrome around sizeEl (the anchor is the panel's size, the TV is itself)
        padW: r.width - sizeEl.offsetWidth, padH: r.height - sizeEl.offsetHeight,
      };
      grip.setPointerCapture(e.pointerId);
      box.classList.add('corner-resizing');
    });

    grip.addEventListener('pointermove', (e) => {
      if (!start || !grip.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      let w = start.w + (west ? -dx : dx);
      let h = start.h + (north ? -dy : dy);
      // The room the fixed corner leaves on this side of the viewport.
      const maxW = (west ? start.right : globalThis.innerWidth - start.left) - start.padW;
      const maxH = (north ? start.bottom : globalThis.innerHeight - start.top) - start.padH;
      if (lockAspect) {
        const aspect = start.w / start.h;
        // Follow whichever way the pointer has gone further.
        if (Math.abs(h - start.h) * aspect > Math.abs(w - start.w)) w = h * aspect;
        w = Math.max(minW, Math.min(w, maxW, maxH * aspect));
        h = w / aspect;
        sizeEl.style.width = Math.round(w) + 'px';
      } else {
        w = Math.max(minW, Math.min(w, maxW));
        h = Math.max(minH, Math.min(h, maxH));
        sizeEl.style.width = Math.round(w) + 'px';
        sizeEl.style.height = Math.round(h) + 'px';
        sizeEl.style.maxHeight = 'none';
      }
      if (west) box.style.left = (start.right - Math.round(w) - start.padW) + 'px';
      if (north) box.style.top = (start.bottom - Math.round(h) - start.padH) + 'px';
    });

    const end = () => {
      if (!start) return;
      start = null;
      box.classList.remove('corner-resizing');
      writeSize(key, { w: sizeEl.offsetWidth, h: sizeEl.offsetHeight });
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);

    grip.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      writeSize(key, null);
      clearSize();
    });
  }

  restore();
  // A size saved on a big monitor has to fit a small window, and the phone
  // layout drops it altogether. The tablet is rebuilt on every open, so the
  // listener takes itself off once its window has left the page.
  const onResize = () => {
    if (!box.isConnected) { globalThis.removeEventListener('resize', onResize); return; }
    restore();
  };
  globalThis.addEventListener?.('resize', onResize);
}
