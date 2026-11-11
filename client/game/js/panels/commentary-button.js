// The Commentary toggle on a live sports picture (Deadball's Grandstand, Cluster Puck's rink):
// whether the booth's lines are spoken by the TV's voice as the game plays.
//
// The view doesn't own the setting. Whoever mounts it does, and passes it in as
// `opts.commentary = { on(), toggle() }`: the TV passes its Read Aloud switch (tvReadAloud), a seat
// in the stands passes Booth in the Stands (standsBooth). A view with none shows no button. Both
// settings are kept in this browser's storage, so the choice is still there next time.
//
// addCommentaryButton(into, commentary, doc) puts the button in `into` (the picture's box) and
// hands back sync(), which repaints it from on(): the host calls it when its own switch moves.

const ICON_ON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export function addCommentaryButton(into, commentary, doc = globalThis.document) {
  if (!into || !doc || !commentary || typeof commentary.on !== 'function' || typeof commentary.toggle !== 'function') return () => {};
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'view-voice';
  const sync = () => {
    let on = false;
    try { on = !!commentary.on(); } catch { /* host gone */ }
    btn.innerHTML = (on ? ICON_ON : ICON_OFF) + '<span>Commentary</span>';
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Commentary on: the booth is read aloud (click to turn it off)' : 'Commentary off: captions only (click to hear the booth)';
    btn.setAttribute('aria-label', 'Spoken commentary');
  };
  sync();
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    try { commentary.toggle(); } catch (err) { console.warn('[commentary] toggle failed:', err); }
    sync();
  });
  into.appendChild(btn);
  return sync;
}
