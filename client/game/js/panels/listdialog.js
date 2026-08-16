// One generic list dialog, for every "pick one of N" surface in the game.
//
// This is the thing docs/audits/log-vs-dialog-audit.md asks for by name: not
// fourteen bespoke panels, but ONE focusable listbox that a server payload drives —
// `{ title, subtitle, rows: [{ label, detail, command, group }], footer }` — with
// plugins converted onto it one at a time.
//
// ── The decision this settles ───────────────────────────────────────────────
//
// The audit left `shop` at the bottom rung as an explicit open question: that
// branch drops the panel and prints the shelf into the log, which was written when
// "log rung" meant "this player wants text", and the audit asks whether a
// focus-trapped dialog is now the *more* accessible surface for the very player it
// was written for. Decided here, and the reasoning matters more than the answer:
//
//   A dialog is NOT silent to a screen reader. Moving focus into an aria-modal
//   dialog makes it announce its name, its role and its contents. The reason the
//   log was the safe choice is that `#output` is a live region and reads itself
//   with no focus management at all — but that is an argument about RECORDS, and a
//   68-line shop shelf is not a record. It is a control. You act on it, the next
//   thing you type means something different because it is open, and nothing in
//   the log says so.
//
// So: a control surface becomes a dialog, at every rung. A record stays in the log,
// at every rung. `shop` is the first conversion because it is the biggest (63 stock
// entries at Dell Fry) and the most frequently re-read.
//
// ⚠ What must NOT happen is the surface becoming invisible to the log. The dialog
// is the place you ACT; a one-line record still reaches `#output` saying what
// opened and how to re-read it, because a player scrolling back must be able to see
// that they went shopping. That line is the record; the dialog is the control.
//
// ── Why there is no keyboard code in here ───────────────────────────────────
//
// Rows are real `<button>`s in a real `<ul>`, and the panel id ends in `-panel`, so
// a11y-focus.js supplies role="dialog", aria-modal, the Tab trap, Escape-to-close
// and focus restoration. Arrow-key navigation is deliberately not added on top: Tab
// through buttons is standard and needs no state. See the roving-tabindex note in
// docs/systems-display-mode.md.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _send = null;

/** Injected at boot so this module imports nothing from the socket layer. */
export function initListDialog(sendCmd) { _send = sendCmd; }

function styles() {
  if (document.getElementById('list-dialog-css')) return;
  const s = document.createElement('style');
  s.id = 'list-dialog-css';
  s.textContent = `
    #list-dialog-panel { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
      width:min(38rem,95vw); max-height:85vh; display:none; flex-direction:column; z-index:900;
      background:var(--bg-panel,#12161c); color:var(--text,#d8dee9);
      border:2px solid var(--accent,#6aa7c4); border-radius:6px; box-shadow:0 0 0 100vmax rgba(0,0,0,.55); }
    #list-dialog-panel.active { display:flex; }
    #list-dialog-panel .ld-head { padding:.75rem 1rem; border-bottom:1px solid var(--border,#2a3340);
      display:flex; align-items:baseline; gap:.75rem; flex:0 0 auto; }
    #list-dialog-panel .ld-head h2 { margin:0; font-size:1.1rem; }
    #list-dialog-panel .ld-sub { opacity:.8; font-size:.9em; }
    #list-dialog-panel .ld-close { margin-left:auto; padding:.35rem .7rem; font:inherit; cursor:pointer;
      background:var(--bg-input,#1b222b); color:inherit; border:1px solid var(--border,#2a3340); border-radius:4px; }
    #list-dialog-panel .ld-body { overflow-y:auto; padding:.75rem 1rem; flex:1 1 auto; }
    #list-dialog-panel ul { list-style:none; margin:0; padding:0; }
    #list-dialog-panel h3 { font-size:.85em; text-transform:uppercase; letter-spacing:1px;
      opacity:.7; margin:1rem 0 .35rem; }
    #list-dialog-panel h3:first-child { margin-top:0; }
    #list-dialog-panel .ld-row { display:flex; justify-content:space-between; gap:1rem; width:100%;
      text-align:left; font:inherit; color:inherit; padding:.55rem .7rem; margin:.15rem 0; cursor:pointer;
      background:var(--bg-input,#1b222b); border:1px solid var(--border,#2a3340); border-radius:4px; }
    #list-dialog-panel .ld-row:hover { border-color:var(--accent,#6aa7c4); }
    #list-dialog-panel .ld-row:focus-visible { outline:2px solid var(--accent,#6aa7c4); outline-offset:2px; }
    #list-dialog-panel .ld-detail { opacity:.8; white-space:nowrap; }
    #list-dialog-panel .ld-multi { padding:.55rem .7rem; margin:.15rem 0;
      background:var(--bg-input,#1b222b); border:1px solid var(--border,#2a3340); border-radius:4px; }
    #list-dialog-panel .ld-multi-head { display:flex; justify-content:space-between; gap:1rem; }
    #list-dialog-panel .ld-multi-acts { display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.4rem; }
    #list-dialog-panel .ld-act { font:inherit; color:inherit; cursor:pointer; padding:.25rem .6rem;
      background:transparent; border:1px solid var(--border,#2a3340); border-radius:4px; }
    #list-dialog-panel .ld-act:hover { border-color:var(--accent,#6aa7c4); }
    #list-dialog-panel .ld-act:focus-visible { outline:2px solid var(--accent,#6aa7c4); outline-offset:2px; }
    #list-dialog-panel .ld-foot { padding:.6rem 1rem; border-top:1px solid var(--border,#2a3340);
      opacity:.85; font-size:.9em; flex:0 0 auto; }
  `;
  document.head.appendChild(s);
}

function panel() {
  let el = document.getElementById('list-dialog-panel');
  if (el) return el;
  styles();
  el = document.createElement('div');
  el.id = 'list-dialog-panel';
  el.innerHTML = `<div class="ld-head"><h2 id="ld-title" tabindex="-1"></h2>
      <span class="ld-sub" id="ld-sub"></span>
      <button type="button" class="ld-close" aria-label="Close">Close</button></div>
    <div class="ld-body" id="ld-body"></div>
    <div class="ld-foot" id="ld-foot"></div>`;
  document.body.appendChild(el);
  el.querySelector('.ld-close').addEventListener('click', closeListDialog);
  // Delegated once — the body is rewritten on every open, so per-row listeners leak.
  el.addEventListener('click', (e) => {
    const row = e.target.closest('[data-ld-cmd]');
    if (!row || !el.contains(row)) return;
    if (_send) _send(row.dataset.ldCmd);
    // Deliberately left OPEN. A shop is a list you buy several things from, and a
    // dialog that shut on the first purchase would make the second one four
    // keystrokes of re-opening. The server re-sends the payload after a purchase,
    // which refreshes prices and stock in place.
  });
  return el;
}

export function closeListDialog() {
  document.getElementById('list-dialog-panel')?.classList.remove('active');
}

export function openListDialog(msg) {
  const el = panel();
  const title = el.querySelector('#ld-title');
  title.textContent = msg.title || 'Choose';
  el.querySelector('#ld-sub').textContent = msg.subtitle || '';

  let html = '';
  let group = null;
  for (const r of msg.rows || []) {
    // Groups become real headings, so a screen reader can jump between sections
    // rather than walking sixty rows to find the one it wants.
    if (r.group && r.group !== group) { group = r.group; html += `${html ? '</ul>' : ''}<h3>${esc(group)}</h3><ul>`; }
    else if (!html) html += '<ul>';
    const detail = r.detail ? `<span class="ld-detail">${esc(r.detail)}</span>` : '';
    // Three row shapes, in order of how much the row can DO:
    //   `commands: [{label, command}]` — several actions (the audit's own shape).
    //   `command`                      — the whole row is one button.
    //   neither                        — a static line, deliberately not focusable.
    // The plural form exists because a workspace row is genuinely several verbs
    // (prepare / cook / put away) and collapsing it to one would silently drop the
    // rest, which is worse than not converting the surface at all.
    if (r.commands?.length) {
      html += `<li class="ld-multi"><div class="ld-multi-head"><span>${esc(r.label)}</span>${detail}</div>`
        + `<div class="ld-multi-acts">${r.commands.map(c =>
          `<button type="button" class="ld-act" data-ld-cmd="${esc(c.command)}">${esc(c.label || c.command)}</button>`).join('')}</div></li>`;
    } else if (r.command) {
      html += `<li><button type="button" class="ld-row" data-ld-cmd="${esc(r.command)}"><span>${esc(r.label)}</span>${detail}</button></li>`;
    } else {
      html += `<li class="ld-row" style="cursor:default">${esc(r.label)}${detail}</li>`;
    }
  }
  html += html ? '</ul>' : '<p>Nothing here.</p>';
  el.querySelector('#ld-body').innerHTML = html;
  el.querySelector('#ld-foot').textContent = msg.footer || '';

  el.classList.add('active');
  // Title first, so the dialog's name and role are announced before its contents.
  title.focus();
  return el;
}
