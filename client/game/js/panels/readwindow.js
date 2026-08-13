// THE READ WINDOW — the Long Watch's reaction beat, graphical rung.
//
// A closing ring, three tells fading in one after another, four answers. Commit
// to one before the ring closes.
//
// FLOATS RATHER THAN MOUNTING IN THE AREA PANE, unlike its sibling text skin.
// This one opens in the middle of a live fight: the player is watching the log
// and the room, and taking the pane away from them to show a board would hide
// the thing the board is about. The text rung mounts in the pane because that is
// where every other character board lives and its audience is reading, not
// watching — so that one IS registered in paneFreeForRoom and this one has no
// need to be.
//
// DOING NOTHING IS FREE. The composure was spent when the window opened, so the
// ring closing costs the player nothing — no penalty, no lost turn. The panel
// says so, quietly, because a countdown with no stated stake reads as a threat.
//
// The client decides NOTHING. It sends the chosen word; the server holds which
// one was right and answers.

let _el = null;
let _opts = null;
let _raf = 0;
let _started = 0;
let _answered = false;

export function isReadWindowActive() { return !!_el; }

const CSS = `
.rw-wrap{position:fixed;left:50%;bottom:12rem;transform:translateX(-50%);z-index:60;
  display:flex;flex-direction:column;align-items:center;gap:.5rem;pointer-events:auto;
  font-family:inherit;animation:rw-in .12s ease-out}
@keyframes rw-in{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1}}
.rw-ring{position:relative;width:88px;height:88px}
.rw-ring svg{transform:rotate(-90deg)}
.rw-ring .rw-track{stroke:rgba(255,255,255,.12)}
.rw-ring .rw-arc{stroke:var(--accent,#7fd1ff);transition:stroke .2s}
.rw-ring.rw-late .rw-arc{stroke:#ff6b6b}
.rw-name{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;opacity:.7;text-align:center;padding:0 .4rem}
.rw-tells{display:flex;flex-direction:column;align-items:center;gap:.12rem;min-height:3.2rem}
.rw-tell{font-size:.74rem;letter-spacing:.1em;opacity:0;transition:opacity .18s}
.rw-tell.rw-on{opacity:1;color:var(--accent,#7fd1ff)}
.rw-opts{display:flex;gap:.35rem}
.rw-opt{padding:.28rem .6rem;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.55);
  border-radius:3px;font-size:.7rem;letter-spacing:.06em;cursor:pointer}
.rw-opt:hover{border-color:var(--accent,#7fd1ff);color:var(--accent,#7fd1ff)}
.rw-opt b{opacity:.55;margin-right:.3rem}
.rw-free{font-size:.6rem;opacity:.4}
`;

function ensureStyles() {
  if (document.getElementById('rw-styles')) return;
  const s = document.createElement('style');
  s.id = 'rw-styles';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function frame() {
  if (!_el || !_opts) return;
  const elapsed = Date.now() - _started;
  const frac = Math.max(0, 1 - elapsed / _opts.ttlMs);

  const arc = _el.querySelector('.rw-arc');
  if (arc) {
    const C = 2 * Math.PI * 38;
    arc.setAttribute('stroke-dasharray', `${C}`);
    arc.setAttribute('stroke-dashoffset', `${C * (1 - frac)}`);
  }
  _el.querySelector('.rw-ring')?.classList.toggle('rw-late', frac < 0.3);

  // Tells land across the first two-thirds, so there is always a beat left to
  // answer in after the last one.
  const per = (_opts.ttlMs * 0.66) / Math.max(1, _opts.tells.length);
  const shown = Math.floor(elapsed / per) + 1;
  _el.querySelectorAll('.rw-tell').forEach((n, i) => n.classList.toggle('rw-on', i < shown));

  if (elapsed >= _opts.ttlMs) { close(); return; }
  _raf = requestAnimationFrame(frame);
}

function answer(choice) {
  if (!_el || _answered) return;
  _answered = true;
  // The CHOICE, never a verdict — the server holds which one was right.
  const cmd = `${_opts.resolveCmd} ${_opts.token} ${choice}`;
  _opts.onChoice?.(cmd);
  close();
}

function onKey(e) {
  if (!_el || !_opts) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= _opts.options.length) { e.preventDefault(); answer(_opts.options[n - 1]); return; }
  const k = String(e.key || '').toUpperCase();
  const hit = _opts.options.find(o => o[0] === k);
  if (hit) { e.preventDefault(); answer(hit); }
}

export function openReadWindow(opts) {
  if (!opts || !Array.isArray(opts.options) || !opts.options.length) return false;
  close();
  ensureStyles();
  _opts = opts;
  _answered = false;
  _started = Date.now();

  const tells = (opts.tells || []).map(t => `<div class="rw-tell">${t}</div>`).join('');
  const buttons = opts.options
    .map((o, i) => `<div class="rw-opt" data-choice="${o}"><b>${i + 1}</b>${o}</div>`)
    .join('');

  _el = document.createElement('div');
  _el.className = 'rw-wrap';
  _el.innerHTML = `
    <div class="rw-ring">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle class="rw-track" cx="44" cy="44" r="38" fill="none" stroke-width="3"></circle>
        <circle class="rw-arc" cx="44" cy="44" r="38" fill="none" stroke-width="3" stroke-linecap="round"></circle>
      </svg>
      <div class="rw-name">${opts.targetName || ''}</div>
    </div>
    <div class="rw-tells">${tells}</div>
    <div class="rw-opts">${buttons}</div>
    <div class="rw-free">let it close — it costs you nothing</div>`;

  _el.querySelectorAll('.rw-opt').forEach(b =>
    b.addEventListener('click', () => answer(b.dataset.choice)));
  document.body.appendChild(_el);
  window.addEventListener('keydown', onKey, true);
  _raf = requestAnimationFrame(frame);
  return true;
}

export function close() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0;
  window.removeEventListener('keydown', onKey, true);
  _el?.remove();
  _el = null;
  _opts = null;
}
