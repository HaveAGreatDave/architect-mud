// MIS Fit panel — authored prose for the fit model (plugins/mis/mis-body.js).
//
// The engine decides WHICH band an act lands in from the giver's size against
// the receiver's capacity; this tab decides what anyone reads when it does.
// Every (hole, band) pair is always listed, authored or not, so the grid shows
// the whole space rather than only the rows that exist.
//
// One textarea per pool, one line per message. Blank pool = the act keeps its
// ordinary text, so leaving a band empty is a valid answer.

let _misFitRows = [];
let _misFitOpen = null;   // `${hole}:${band}` currently expanded
let _misFitVocab = {};    // NAME → [words]
let _misFitBulk = new Set();  // ids ticked for a bulk write

const MISFIT_TOKENS = [
  ['{actor}',    'the one doing it'],
  ['{target}',   "the one it's being done to"],
  ['{part}',     'the hole in play (pussy / ass / mouth / throat)'],
  ['{size}',     "giver's length in cm"],
  ['{capacity}', "receiver's capacity in cm"],
];

const MISFIT_BAND_HELP = {
  cavernous:   'Far more room than needed. Least satisfying for both.',
  loose:       'Goes in easily, room left over.',
  comfortable: 'A good ordinary fit.',
  snug:        'The sweet spot — best arousal for both parties.',
  tight:       'Takes effort. Small pain chance. STRETCHES the receiver.',
  straining:   'Barely possible. Real pain chance. Stretches hard.',
  impossible:  'Refused outright — except a mouth, which gags instead.',
};

function misFitCard(r) {
  const open = _misFitOpen === r.id;
  const count = (r.actor_lines?.length || 0) + (r.target_lines?.length || 0) + (r.zone_lines?.length || 0);
  const stretches = !['mouth', 'throat'].includes(r.hole)
    && ['tight', 'straining', 'impossible'].includes(r.band);
  return `
  <div class="misfit-card" style="border:1px solid var(--border);border-radius:4px;margin-bottom:6px;background:var(--bg2)">
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer"
         onclick="misFitToggle('${r.id}')">
      <span style="min-width:70px;font-weight:600;color:var(--accent)">${r.hole}</span>
      <span style="min-width:110px">${r.band}</span>
      <span style="flex:1;font-size:11px;color:var(--text-dim)">${MISFIT_BAND_HELP[r.band] || ''}</span>
      ${stretches ? '<span style="font-size:10px;color:var(--red);border:1px solid var(--red);border-radius:3px;padding:1px 5px">STRETCHES</span>' : ''}
      <span style="font-size:11px;color:${count ? 'var(--green)' : 'var(--text-dim)'}">${count || 'unwritten'}</span>
      <span style="color:var(--text-dim)">${open ? '▾' : '▸'}</span>
    </div>
    ${open ? `
    <div style="padding:0 12px 12px">
      ${misFitPool('actor',  'To the one doing it',      r.actor_lines)}
      ${misFitPool('target', 'To the one receiving',     r.target_lines)}
      ${misFitPool('zone',   'To the room (third person)', r.zone_lines)}
      <button class="action-btn" onclick="misFitSave('${r.hole}','${r.band}')">Save ${r.hole} / ${r.band}</button>
      <span id="misfit-status-${r.id.replace(':','-')}" style="margin-left:10px;font-size:11px;color:var(--text-dim)"></span>
    </div>` : ''}
  </div>`;
}

function misFitPool(kind, label, lines) {
  return `<div class="field" style="margin-bottom:8px">
    <label>${label} <span style="color:var(--text-dim);font-weight:400">— one message per line, blank = use the ordinary act text</span></label>
    <textarea id="misfit-${kind}" rows="4" spellcheck="false"
      style="width:100%;font-family:var(--font-mono);font-size:12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px;box-sizing:border-box">${(lines || []).join('\n')}</textarea>
  </div>`;
}

function misFitToggle(id) {
  _misFitOpen = _misFitOpen === id ? null : id;
  misFitRender();
}

async function misFitSave(hole, band) {
  const get = (k) => document.getElementById(`misfit-${k}`)?.value || '';
  const statusEl = document.getElementById(`misfit-status-${hole}-${band}`);
  // API() resolves with { error } instead of throwing, so a catch block here
  // would silently swallow every failed save and report success.
  const res = await API('/mis-fit', 'PUT', {
    hole, band,
    actor_lines: get('actor').split('\n'),
    target_lines: get('target').split('\n'),
    zone_lines: get('zone').split('\n'),
  });
  if (!res || res.error) {
    if (statusEl) { statusEl.textContent = res?.error || 'Save failed.'; statusEl.style.color = 'var(--red)'; }
    return;
  }
  if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)'; }
  const fresh = await API('/mis-fit');
  _misFitRows = fresh?.rows || _misFitRows;
}

function misFitRender() {
  const el = document.getElementById('list-panel');
  if (!el) return;
  const tokens = MISFIT_TOKENS.map(([t, d]) =>
    `<code style="color:var(--accent)">${t}</code> <span style="color:var(--text-dim)">${d}</span>`).join(' &nbsp;·&nbsp; ');
  const byHole = {};
  for (const r of _misFitRows) (byHole[r.hole] = byHole[r.hole] || []).push(r);

  el.innerHTML = `
    <div style="padding:12px 16px">
      <div style="margin-bottom:12px;padding:8px 10px;background:var(--bg3);border-radius:4px;font-size:11px;line-height:1.7">
        <strong>Tokens:</strong> ${tokens}
        <div style="margin-top:6px;color:var(--text-dim)">
          The engine picks the band from the giver's <code>penis_length_cm</code> against the receiver's
          capacity (<code>labia_style</code> + accumulated stretch for pussy, a tighter fixed base for ass,
          a non-stretching depth for mouth/throat). Bands marked STRETCH permanently raise the receiver's
          capacity, which recovers slowly over days.
        </div>
      </div>
      ${misFitVocabBlock()}
      ${misFitBulkBlock()}
      ${Object.entries(byHole).map(([hole, rows]) => `
        <div style="margin-bottom:14px">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:6px">${hole}</div>
          ${rows.map(misFitCard).join('')}
        </div>`).join('')}
    </div>`;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────
//
// Define a word list once, use it in any template as [NAME]. Each render picks
// one at random, so a single template with three slots and five words each is
// 125 distinct lines you never had to type.
function misFitVocabBlock() {
  const text = Object.entries(_misFitVocab)
    .map(([k, v]) => `${k} = ${(v || []).join(', ')}`).join('\n');
  return `
  <details style="margin-bottom:10px;border:1px solid var(--border);border-radius:4px;background:var(--bg2)" open>
    <summary style="padding:8px 12px;cursor:pointer;font-weight:600">📖 Vocabulary <span style="font-weight:400;color:var(--text-dim);font-size:11px">— define once, use in every template as [NAME]</span></summary>
    <div style="padding:0 12px 12px">
      <div class="field">
        <label>One per line: <code>NAME = word, word, word</code></label>
        <textarea id="misfit-vocab" rows="7" spellcheck="false"
          style="width:100%;font-family:var(--font-mono);font-size:12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px;box-sizing:border-box"
          placeholder="TIGHT_ADJ = snug, gripping, vice-tight&#10;EFFORT = a shove, real work, both hands&#10;REACTION = gasps, swears, goes rigid">${text}</textarea>
      </div>
      <button class="action-btn" onclick="misFitSaveVocab()">Save vocabulary</button>
      <span id="misfit-vocab-status" style="margin-left:10px;font-size:11px;color:var(--text-dim)"></span>
      <div style="margin-top:8px;font-size:11px;color:var(--text-dim)">
        An undefined <code>[NAME]</code> is left visible in the output rather than blanked — so you can see what you still owe.
      </div>
    </div>
  </details>`;
}

async function misFitSaveVocab() {
  const raw = document.getElementById('misfit-vocab')?.value || '';
  const dict = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_ ]+?)\s*=\s*(.+)$/);
    if (m) dict[m[1].trim().toUpperCase()] = m[2];
  }
  const el = document.getElementById('misfit-vocab-status');
  const res = await API('/mis-fit/vocab', 'POST', { vocab: dict });
  if (!res || res.error) {
    if (el) { el.textContent = res?.error || 'Save failed.'; el.style.color = 'var(--red)'; }
    return;
  }
  _misFitVocab = res.vocab || {};
  if (el) { el.textContent = `Saved — ${res.terms} term(s).`; el.style.color = 'var(--green)'; }
}

// ── Bulk apply ───────────────────────────────────────────────────────────────
//
// Write one set of pools to as many (hole, band) cells as you like. Bands very
// often want the same template with different vocabulary, so doing twelve cells
// has to be one action rather than twelve.
function misFitBulkBlock() {
  const holes = [...new Set(_misFitRows.map(r => r.hole))];
  const bands = [...new Set(_misFitRows.map(r => r.band))];
  const grid = holes.map(h => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
      <span style="min-width:64px;font-size:11px;color:var(--accent)">${h}</span>
      ${bands.map(b => {
        const id = `${h}:${b}`;
        return `<label style="font-size:10px;display:flex;align-items:center;gap:3px;cursor:pointer;color:var(--text-dim)">
          <input type="checkbox" ${_misFitBulk.has(id) ? 'checked' : ''} onchange="misFitBulkToggle('${id}',this.checked)"> ${b.slice(0, 4)}
        </label>`;
      }).join('')}
      <button type="button" class="action-btn" style="padding:1px 6px;font-size:10px" onclick="misFitBulkRow('${h}')">all</button>
    </div>`).join('');

  return `
  <details style="margin-bottom:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg2)">
    <summary style="padding:8px 12px;cursor:pointer;font-weight:600">⚡ Bulk apply <span style="font-weight:400;color:var(--text-dim);font-size:11px">— one template, many bands</span></summary>
    <div style="padding:0 12px 12px">
      <div style="margin:6px 0 8px">${grid}</div>
      ${misFitPool('bulk-actor',  'To the one doing it',        [])}
      ${misFitPool('bulk-target', 'To the one receiving',       [])}
      ${misFitPool('bulk-zone',   'To the room (third person)', [])}
      <label style="font-size:11px;display:inline-flex;align-items:center;gap:5px;margin-bottom:8px">
        <input type="checkbox" id="misfit-bulk-merge" checked> Append to existing lines (uncheck to REPLACE them)
      </label><br>
      <button class="action-btn" onclick="misFitBulkApply()">Apply to ticked</button>
      <button class="action-btn" onclick="misFitPreview()">Preview</button>
      <span id="misfit-bulk-status" style="margin-left:10px;font-size:11px;color:var(--text-dim)"></span>
      <div id="misfit-preview" style="margin-top:8px;font-size:11px;color:var(--text-dim);white-space:pre-wrap"></div>
    </div>
  </details>`;
}

function misFitBulkToggle(id, on) { on ? _misFitBulk.add(id) : _misFitBulk.delete(id); }
function misFitBulkRow(hole) {
  const bands = [...new Set(_misFitRows.map(r => r.band))];
  const all = bands.every(b => _misFitBulk.has(`${hole}:${b}`));
  for (const b of bands) all ? _misFitBulk.delete(`${hole}:${b}`) : _misFitBulk.add(`${hole}:${b}`);
  misFitRender();
}

async function misFitBulkApply() {
  const el = document.getElementById('misfit-bulk-status');
  const targets = [..._misFitBulk].map(id => {
    const [hole, band] = id.split(':');
    return { hole, band };
  });
  if (!targets.length) {
    if (el) { el.textContent = 'Tick at least one band first.'; el.style.color = 'var(--red)'; }
    return;
  }
  const get = (k) => document.getElementById(`misfit-${k}`)?.value || '';
  const res = await API('/mis-fit/bulk', 'POST', {
    targets,
    merge: document.getElementById('misfit-bulk-merge')?.checked !== false,
    actor_lines: get('bulk-actor').split('\n'),
    target_lines: get('bulk-target').split('\n'),
    zone_lines: get('bulk-zone').split('\n'),
  });
  if (!res || res.error) {
    if (el) { el.textContent = res?.error || 'Apply failed.'; el.style.color = 'var(--red)'; }
    return;
  }
  if (el) { el.textContent = `Written to ${res.written} band(s).`; el.style.color = 'var(--green)'; }
  const fresh = await API('/mis-fit');
  _misFitRows = fresh?.rows || _misFitRows;
}

// Run the actor template through the vocabulary a few times, so you can see the
// spread a template really produces before writing it to a dozen cells.
async function misFitPreview() {
  const text = (document.getElementById('misfit-bulk-actor')?.value || '').split('\n')[0];
  const out = document.getElementById('misfit-preview');
  if (!text) { if (out) out.textContent = 'Write a line above first.'; return; }
  const res = await API('/mis-fit/preview', 'POST', { text });
  if (out) out.textContent = (res?.samples || []).map(s => `• ${s}`).join('\n') || res?.error || '';
}

async function misFitFetch() {
  const data = await API('/mis-fit');
  _misFitRows = data?.rows || [];
  _misFitVocab = data?.vocab || {};
  // The panel renders itself rather than using the shared table renderer — it's a
  // grouped editor grid, not a list of records.
  setTimeout(misFitRender, 0);
  return [];
}

// ── Staying hidden ───────────────────────────────────────────────────────────
//
// This tab has no nav item in the markup. It is injected at runtime, and only
// when BOTH of these are true:
//
//   1. somebody deliberately types the unlock word into the dev panel, and
//   2. the server answers /mis-fit at all — which it only does when the
//      server-wide MIS setting is on (it 404s otherwise, so a probe from a
//      server with MIS off is indistinguishable from a build without it).
//
// The unlock is per-session (sessionStorage, not localStorage): closing the tab
// re-hides it. There is deliberately no feedback on a wrong word, no hint, and
// no error when the probe 404s — a failed attempt looks exactly like nothing
// happening, because anything else would confirm there is something to find.
const MISFIT_UNLOCK = 'maturity';
let _misFitBuffer = '';

async function misFitReveal({ silent = true } = {}) {
  if (document.querySelector('[data-panel="mis-fit"]')) return true;
  // API() resolves with { error } rather than throwing, so the check has to be
  // on the payload — a try/catch here would never fire and would reveal the tab
  // on a server with MIS switched off.
  const probe = await API('/mis-fit');
  if (!probe || probe.error || !Array.isArray(probe.rows)) return false;  // silent by design
  const nav = document.querySelector('[data-panel="scavenging"]');
  if (!nav) return false;
  const item = document.createElement('div');
  item.className = 'nav-item';
  item.dataset.panel = 'mis-fit';
  item.textContent = '🔞 MIS Fit';
  item.onclick = () => showPanel('mis-fit');
  nav.insertAdjacentElement('afterend', item);
  sessionStorage.setItem('misFitUnlocked', '1');
  if (!silent) showPanel('mis-fit');
  return true;
}

// Keystroke buffer. Ignores anything typed into a field, so it can't fire while
// you're editing content — it only listens to the panel chrome itself.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (!/^[a-z]$/i.test(e.key)) { _misFitBuffer = ''; return; }
  _misFitBuffer = (_misFitBuffer + e.key.toLowerCase()).slice(-MISFIT_UNLOCK.length);
  if (_misFitBuffer === MISFIT_UNLOCK) {
    _misFitBuffer = '';
    misFitReveal({ silent: false });
  }
});

// Already unlocked this session → put it back after a reload, still silently.
if (sessionStorage.getItem('misFitUnlocked') === '1') {
  window.addEventListener('DOMContentLoaded', () => misFitReveal());
}
