// TOUCH GESTURES — one finger drags, two fingers pinch, for a 3-D view whose camera is a mouse drag.
//
// Several seats orbit or look on the middle or right mouse button, which a finger can never press,
// and zoom on the wheel, which a phone does not have. This is the touch half of those controls, so a
// seat keeps its mouse code exactly as it is and adds one call:
//
//   bindTouchGestures(glass, { enabled, drag(dx, dy), pinch(f) })
//
// `drag` gets pixel deltas from the first finger down, `pinch` the ratio of the two fingers' spread
// since the last move (above 1 is spreading, which is zooming in). Only touch pointers are read, so a
// mouse on a touchscreen laptop still gets the seat's own handlers. Returns its own removal.
//
// ⚠ A FINGER THAT LANDS ON A CONTROL IS THE CONTROL'S. Anything clickable inside the glass is left
// alone, and `enabled(e)` can refuse a press too (a hotspot under the finger, a view the drag means
// nothing in).
export function bindTouchGestures(el, { enabled = () => true, drag, pinch } = {}) {
  if (!el) return () => {};
  const pts = new Map();   // pointerId → { x, y }
  let lead = null, spread = 0;
  const gap = () => { const [a, b] = [...pts.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const down = (e) => {
    if (e.pointerType !== 'touch') return;
    if (e.target?.closest?.('button, a, input, select, textarea, [role="button"]')) return;
    if (!pts.size && !enabled(e)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (lead == null) lead = e.pointerId;
    spread = gap();
    try { el.setPointerCapture?.(e.pointerId); } catch { /* a pointer already gone */ }
    e.preventDefault();
  };
  const move = (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    e.preventDefault();
    if (pts.size >= 2) {
      const s = gap();
      if (spread > 0 && s > 0 && pinch) pinch(s / spread);
      spread = s;
      return;
    }
    if (e.pointerId === lead && (dx || dy)) drag?.(dx, dy);
  };
  const up = (e) => {
    if (!pts.delete(e.pointerId)) return;
    // The finger left on the glass carries on dragging from where it is, with no jump.
    if (e.pointerId === lead) lead = pts.size ? pts.keys().next().value : null;
    spread = gap();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  if (el.style && !el.style.touchAction) el.style.touchAction = 'none';
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    pts.clear(); lead = null;
  };
}
