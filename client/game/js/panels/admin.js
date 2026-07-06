// The .admin command reference — a centered modal (poker/trade "server renders
// the data, client draws" pattern). The server (world.js cmdAdmin) role-gates a
// catalog of admin/dev verbs and pushes it as { type:'admin_panel', commands }.
// This client groups them by category and lets you fire them:
//   • no-arg verbs run on click;
//   • verbs that take arguments prefill the command box so you can finish typing.
import { sendCmdSilent } from '../net.js';

let overlay = null;
let ROLE = '';

function ensureOverlay() {
  if (overlay) return;
  ensureStyles();
  overlay = document.createElement('div');
  overlay.id = 'admin-overlay';
  overlay.innerHTML = '<div id="admin-box"><div id="admin-body"></div></div>';
  overlay.style.display = 'none';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return closeAdmin();
    const row = e.target.closest('[data-verb]');
    if (row) return run(row.getAttribute('data-verb'), row.getAttribute('data-args') || '');
    if (e.target.closest('[data-act="close"]')) return closeAdmin();
  });
}

export function openAdminPanel(commands, role) {
  ensureOverlay();
  ROLE = role || '';
  render(commands || []);
  overlay.style.display = 'flex';
}

export function closeAdmin() { if (overlay) overlay.style.display = 'none'; }

// No-arg verbs fire straight away; arg-taking verbs prefill the input so the
// admin can supply the id/zone before hitting Enter.
function run(verb, args) {
  if (!args) { sendCmdSilent(verb); closeAdmin(); return; }
  const input = document.getElementById('cmd-input');
  if (input) { input.value = `${verb} `; input.focus(); }
  closeAdmin();
}

function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[ch])); }

function render(commands) {
  const body = document.getElementById('admin-body'); if (!body) return;
  const cats = [];
  for (const c of commands) {
    let g = cats.find(x => x.name === c.cat);
    if (!g) { g = { name: c.cat || 'Other', items: [] }; cats.push(g); }
    g.items.push(c);
  }
  const groups = cats.map(g => `
    <div class="adm-cat">${esc(g.name)}</div>
    ${g.items.map(c => `
      <button class="adm-cmd" data-verb="${esc(c.verb)}" data-args="${esc(c.args)}">
        <span class="adm-syntax"><span class="adm-verb">.${esc(c.verb)}</span>${c.args ? ` <span class="adm-args">${esc(c.args)}</span>` : ''}</span>
        <span class="adm-desc">${esc(c.desc)}</span>
        <span class="adm-go">${c.args ? '✎' : '▸'}</span>
      </button>`).join('')}`).join('');

  body.innerHTML = `
    <div class="adm-head">
      <span class="adm-title">⚙ ADMIN COMMANDS</span>
      <span class="adm-role">${esc(ROLE)}</span>
      <button class="adm-x" data-act="close">✕</button>
    </div>
    <div class="adm-list">${commands.length ? groups : '<div class="adm-empty">No admin commands available to your role.</div>'}</div>
    <div class="adm-foot"><span class="adm-go">✎</span> prefills the input &nbsp;·&nbsp; <span class="adm-go">▸</span> runs on click</div>`;
}

function ensureStyles() {
  if (document.getElementById('admin-styles')) return;
  const st = document.createElement('style'); st.id = 'admin-styles';
  st.textContent = `
  #admin-overlay { position:fixed; inset:0; z-index:9300; display:flex; align-items:center; justify-content:center;
    background:rgba(0,4,7,0.82); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
  #admin-box { width:min(620px,96vw); max-height:88vh; overflow:hidden; color:#a9d4ec;
    background:linear-gradient(180deg,#232b33,#12171c 60%,#0a0e12); border:1px solid #05080b; border-radius:10px;
    box-shadow:0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06); display:flex; flex-direction:column; }
  #admin-body { display:flex; flex-direction:column; min-height:0; }
  .adm-head { display:flex; align-items:center; gap:12px; padding:10px 14px; border-bottom:1px solid #2a3540; }
  .adm-title { color:#eaf6ff; font-weight:bold; letter-spacing:2px; }
  .adm-role { margin-left:auto; font-size:10px; letter-spacing:2px; color:#ffcf3e; text-transform:uppercase;
    border:1px solid #4a3b12; border-radius:4px; padding:1px 7px; }
  .adm-x { background:none; border:1px solid #2a3540; color:#8fb0c6; border-radius:5px; cursor:pointer; padding:2px 9px; }
  .adm-x:hover { background:#1a2730; }
  .adm-list { overflow-y:auto; padding:10px 12px; }
  .adm-cat { font-size:9px; letter-spacing:3px; color:#5f8299; margin:10px 2px 6px; border-bottom:1px solid #1e2833; padding-bottom:3px; }
  .adm-cat:first-child { margin-top:2px; }
  .adm-cmd { display:flex; align-items:center; gap:10px; width:100%; text-align:left; cursor:pointer; font-family:inherit;
    background:linear-gradient(160deg,#2a333c,#161c22 70%); border:1px solid #263039; border-radius:7px;
    padding:8px 11px; margin-bottom:6px; color:#a9d4ec; }
  .adm-cmd:hover { border-color:#4fb8e0; color:#eaf6ff; }
  .adm-syntax { flex:0 0 auto; white-space:nowrap; }
  .adm-verb { color:#7fc0ff; font-weight:bold; letter-spacing:1px; }
  .adm-args { color:#7fae99; font-size:11px; }
  .adm-desc { flex:1 1 auto; min-width:0; font-size:11px; color:#8fb0c6; overflow:hidden; text-overflow:ellipsis; }
  .adm-go { flex:0 0 auto; color:#4fb8e0; font-size:13px; }
  .adm-empty { color:#5f8299; text-align:center; padding:24px 10px; }
  .adm-foot { border-top:1px solid #2a3540; padding:7px 14px; font-size:10px; color:#5f8299; letter-spacing:1px; }
  @media (max-width:560px) { .adm-cmd { flex-wrap:wrap; } .adm-desc { flex-basis:100%; } }
  `;
  document.head.appendChild(st);
}
