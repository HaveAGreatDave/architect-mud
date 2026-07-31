// Dream / hallucination authoring.
//
// THREE TABLES, ONE EDITOR. A sleep dream room and a drug hallucination room are
// the same kind of thing — a room you are put inside that isn't real — so they
// share a table and this panel. What keeps them from bleeding into each other is
// the `cause` label on every row, which the form makes impossible to get wrong:
// picking "dream" hides and clears the drug selector.
//
//   dream_templates   the rooms (cause dream|drug, drug_id null = default set)
//   dream_presences   the wandering figure that moves between them
//   drug_transforms   what a psychedelic turns real furniture INTO (live world,
//                     never a room — see docs/systems-dreams.md)
//
// No cache invalidation to worry about: all three are readTier COLD and read once
// per instance, so a save is live on the next dream.

// A list of one-line strings, edited as a textarea (one per line) rather than raw
// JSON. Every field here is a pool of alternates, and asking an author to count
// brackets to add a sentence is how pools stay small.
const linesToArr = (v) => (v || '').split('\n').map(s => s.trim()).filter(Boolean);
const arrToLines = (a) => (Array.isArray(a) ? a : []).join('\n');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Drugs that can actually put you somewhere, for the picker. Anything else in the
// drugs table would author a pool nothing ever reads.
let DREAM_DRUGS = [];
async function loadDreamDrugs() {
  try {
    const drugs = await API('/drugs');
    DREAM_DRUGS = (Array.isArray(drugs) ? drugs : []).map(d => ({
      id: d.id, name: d.name,
      mode: (typeof d.effects === 'string' ? JSON.parse(d.effects || '{}') : (d.effects || {}))?.hallucination?.mode || null,
    }));
  } catch { DREAM_DRUGS = []; }
}

function drugOptions(selected, wantMode) {
  const pool = DREAM_DRUGS.filter(d => !wantMode || d.mode === wantMode);
  return [`<option value="">— default set (any drug with none of its own) —</option>`]
    .concat(pool.map(d => `<option value="${esc(d.id)}" ${selected === d.id ? 'selected' : ''}>${esc(d.name)} (${esc(d.id)})</option>`))
    .join('');
}

// Shown under the drug picker: a pool of one room means every room in the
// instance is the same room. Warn rather than silently topping up from the
// defaults, which would undo the whole point of scoping by drug.
function thinPoolWarning(count) {
  if (count >= 3) return '';
  if (count === 0) return `<div class="field-hint" style="color:var(--yellow)">⚠ Nothing authored for this yet — an experience here degrades to the default set, or to an overlay trip.</div>`;
  return `<div class="field-hint" style="color:var(--yellow)">⚠ Only ${count} room${count === 1 ? '' : 's'} in this pool. An instance is capped to the pool size, so this yields a short ${count}-room experience rather than a repetitive one. Three or more reads best.</div>`;
}

// ── dream_templates ─────────────────────────────────────────────────────────

function dreamTemplateEditForm(rec, isNew) {
  const objects = Array.isArray(rec.objects) ? rec.objects
    : (typeof rec.objects === 'string' ? JSON.parse(rec.objects || '[]') : []);
  const cause = rec.cause || 'dream';
  const samePool = (window._dreamTemplateCache || []).filter(r =>
    (r.cause || 'dream') === cause && (r.drug_id || null) === (rec.drug_id || null));
  return `
    <div class="field"><label>Template ID</label><input id="f-id" value="${isNew ? '' : esc(rec.id)}" ${!isNew ? 'readonly style="opacity:0.5"' : ''} placeholder="dt_the_queue"></div>
    <div class="field"><label>Room name</label><input id="f-name" value="${esc(rec.name)}" placeholder="A Corridor"></div>
    <div class="field-row">
      <div class="field"><label>Cause</label>
        <select id="f-cause" onchange="dreamToggleDrug()">
          <option value="dream" ${cause === 'dream' ? 'selected' : ''}>dream — ordinary sleep</option>
          <option value="drug" ${cause === 'drug' ? 'selected' : ''}>drug — a dissociative hallucination</option>
        </select>
        <div class="field-hint">Mutually exclusive on purpose: a room written for the K-hole must never turn up in an ordinary night's sleep.</div>
      </div>
      <div class="field" id="f-drug-wrap" style="${cause === 'drug' ? '' : 'display:none'}">
        <label>Drug</label>
        <select id="f-drug_id">${drugOptions(rec.drug_id, 'dreamzone')}</select>
        <div class="field-hint">Only dissociatives (mode <code>dreamzone</code>) are listed — a psychedelic uses Transforms instead.</div>
      </div>
    </div>
    ${thinPoolWarning(samePool.length)}
    <div class="field"><label>Description</label><textarea id="f-description" rows="5" placeholder="What the player reads on arriving.">${esc(rec.description)}</textarea></div>
    <div class="field"><label>Ambient lines <span class="text-dim">(one per line — emitted on the scheduled ambient tick while they're in this room)</span></label>
      <textarea id="f-ambient" rows="4">${esc(arrToLines(rec.ambient))}</textarea></div>
    <div class="field"><label>Objects</label>
      <div class="field-hint">Each object needs SEVERAL alternate looks — one is picked per instance. An object that reads identically twice is furniture.</div>
      <div id="f-objects">${objects.map((o, i) => objectRow(o, i)).join('') || objectRow({ name: '', looks: [] }, 0)}</div>
      <button type="button" class="btn btn-sm" onclick="dreamAddObject()">+ object</button>
    </div>
    ${rawJsonBox('objects', objects)}
  `;
}

// ── Raw JSON mirror ─────────────────────────────────────────────────────────
//
// Same pattern the script-node editor uses: the form is the friendly path, and a
// collapsed raw-JSON box beside it is the power path. It matters most here
// because these fields are POOLS — pasting fifteen alternates in one go, or
// copying a whole object set between two drugs, is the difference between a pool
// that grows and one that stays at three entries forever.
//
// The box wins when it is open and parses. On save we read it only if the author
// actually opened it, so a stale box can never silently clobber form edits.
function rawJsonBox(field, value) {
  return `
    <details class="field" style="margin-top:6px">
      <summary style="cursor:pointer;color:var(--text-dim)">Raw JSON — <code>${field}</code> <span class="text-dim">(paste a whole pool at once)</span></summary>
      <textarea id="f-raw-${field}" rows="10" spellcheck="false"
        oninput="dreamValidateJson('${field}')"
        style="font-family:var(--mono,monospace);font-size:12px">${esc(JSON.stringify(value ?? [], null, 2))}</textarea>
      <div id="f-raw-${field}-err" class="field-hint"></div>
      <div class="field-hint">Open and edited, this WINS over the fields above. Leave it closed to use the form.</div>
    </details>`;
}

window.dreamValidateJson = function (field) {
  const el = document.getElementById(`f-raw-${field}`);
  const err = document.getElementById(`f-raw-${field}-err`);
  if (!el || !err) return;
  try { JSON.parse(el.value); err.textContent = ''; err.style.color = ''; el.style.borderColor = ''; }
  catch (e) { err.textContent = `⚠ ${e.message}`; err.style.color = 'var(--red, #e66)'; el.style.borderColor = 'var(--red, #e66)'; }
};

// Read a raw box only when the author opened it — an untouched box holds whatever
// the record had at render time and would silently undo form edits made after.
function rawOverride(field) {
  const box = document.getElementById(`f-raw-${field}`);
  if (!box || !box.closest('details')?.open) return undefined;
  try { return JSON.parse(box.value); } catch { return { __invalid: true }; }
}

function objectRow(o, i) {
  return `
    <div class="dream-object" data-idx="${i}" style="border:1px solid var(--border);padding:8px;margin-bottom:8px">
      <div class="field"><label>Object name</label><input class="obj-name" value="${esc(o.name)}" placeholder="a mirror"></div>
      <div class="field"><label>Looks <span class="text-dim">(one per line)</span></label>
        <textarea class="obj-looks" rows="3">${esc(arrToLines(o.looks))}</textarea></div>
      <button type="button" class="btn btn-sm btn-danger" onclick="this.closest('.dream-object').remove()">remove</button>
    </div>`;
}

window.dreamAddObject = function () {
  const host = document.getElementById('f-objects');
  host.insertAdjacentHTML('beforeend', objectRow({ name: '', looks: [] }, host.children.length));
};

window.dreamToggleDrug = function () {
  const cause = document.getElementById('f-cause')?.value;
  const wrap = document.getElementById('f-drug-wrap');
  if (wrap) wrap.style.display = cause === 'drug' ? '' : 'none';
  // Clearing rather than just hiding: a dream row that kept a stale drug_id would
  // be authored into a pool the fallback chain never selects.
  if (cause !== 'drug') { const s = document.getElementById('f-drug_id'); if (s) s.value = ''; }
};

function collectObjects() {
  return [...document.querySelectorAll('#f-objects .dream-object')].map(el => ({
    name: el.querySelector('.obj-name').value.trim(),
    looks: linesToArr(el.querySelector('.obj-looks').value),
  })).filter(o => o.name);
}

async function saveDreamTemplate(existing) {
  const isNew = !existing?.id;
  const cause = document.getElementById('f-cause').value;
  const rawObjects = rawOverride('objects');
  if (rawObjects?.__invalid) return { error: 'Raw JSON (objects): invalid JSON — fix it or collapse the box to use the form.' };
  const body = {
    name: document.getElementById('f-name').value.trim(),
    description: document.getElementById('f-description').value,
    cause,
    drug_id: cause === 'drug' ? (document.getElementById('f-drug_id').value || null) : null,
    ambient: linesToArr(document.getElementById('f-ambient').value),
    objects: rawObjects !== undefined ? rawObjects : collectObjects(),
  };
  if (!Array.isArray(body.objects)) return { error: 'Objects must be a JSON array of { name, looks: [] }.' };
  const badObj = body.objects.find(o => !o || typeof o.name !== 'string' || !Array.isArray(o.looks));
  if (badObj) return { error: `Each object needs a string "name" and an array "looks". Bad entry: ${JSON.stringify(badObj).slice(0, 80)}` };
  if (!body.name) return { error: 'A room needs a name.' };
  if (!body.description.trim()) return { error: 'A room needs a description — it is the first thing the player reads.' };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/dream-templates', 'POST', body); }
  return API(`/dream-templates/${encodeURIComponent(existing.id)}`, 'PUT', body);
}

// ── dream_presences ─────────────────────────────────────────────────────────

function dreamPresenceEditForm(rec, isNew) {
  const cause = rec.cause || 'dream';
  return `
    <div class="field"><label>Presence ID</label><input id="f-id" value="${isNew ? '' : esc(rec.id)}" ${!isNew ? 'readonly style="opacity:0.5"' : ''} placeholder="dp_the_other_one"></div>
    <div class="field"><label>Name <span class="text-dim">(what examine calls it)</span></label><input id="f-name" value="${esc(rec.name)}" placeholder="someone else"></div>
    <div class="field-row">
      <div class="field"><label>Cause</label>
        <select id="f-cause" onchange="dreamToggleDrug()">
          <option value="dream" ${cause === 'dream' ? 'selected' : ''}>dream</option>
          <option value="drug" ${cause === 'drug' ? 'selected' : ''}>drug</option>
        </select>
      </div>
      <div class="field" id="f-drug-wrap" style="${cause === 'drug' ? '' : 'display:none'}">
        <label>Drug</label><select id="f-drug_id">${drugOptions(rec.drug_id, 'dreamzone')}</select>
      </div>
    </div>
    <div class="field"><label>Arrivals <span class="text-dim">(one per line — shown when it enters the room you're in)</span></label>
      <textarea id="f-arrivals" rows="3">${esc(arrToLines(rec.arrivals))}</textarea></div>
    <div class="field"><label>Departures <span class="text-dim">(one per line)</span></label>
      <textarea id="f-departures" rows="3">${esc(arrToLines(rec.departures))}</textarea></div>
    <div class="field"><label>Looks <span class="text-dim">(one per line — picked per look, so it never resolves into anything)</span></label>
      <textarea id="f-looks" rows="4">${esc(arrToLines(rec.looks))}</textarea></div>
    ${rawJsonBox('arrivals', rec.arrivals)}
    ${rawJsonBox('departures', rec.departures)}
    ${rawJsonBox('looks', rec.looks)}
  `;
}

async function saveDreamPresence(existing) {
  const isNew = !existing?.id;
  const cause = document.getElementById('f-cause').value;
  const body = {
    name: document.getElementById('f-name').value.trim(),
    cause,
    drug_id: cause === 'drug' ? (document.getElementById('f-drug_id').value || null) : null,
    arrivals: rawOverride('arrivals') ?? linesToArr(document.getElementById('f-arrivals').value),
    departures: rawOverride('departures') ?? linesToArr(document.getElementById('f-departures').value),
    looks: rawOverride('looks') ?? linesToArr(document.getElementById('f-looks').value),
  };
  if (!body.name) return { error: 'A presence needs a name.' };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/dream-presences', 'POST', body); }
  return API(`/dream-presences/${encodeURIComponent(existing.id)}`, 'PUT', body);
}

// ── drug_transforms ─────────────────────────────────────────────────────────

function drugTransformEditForm(rec, isNew) {
  return `
    <div class="field"><label>Transform ID</label><input id="f-id" value="${isNew ? '' : esc(rec.id)}" ${!isNew ? 'readonly style="opacity:0.5"' : ''} placeholder="dx_blotter_elaborating"></div>
    <div class="field-row">
      <div class="field"><label>Drug</label><select id="f-drug_id">${drugOptions(rec.drug_id, 'transform')}</select>
        <div class="field-hint">Only psychedelics (mode <code>transform</code>). These do NOT build rooms — they re-dress the real room the player is standing in.</div>
      </div>
      <div class="field"><label>Only applies to furniture matching <span class="text-dim">(blank = anything)</span></label>
        <input id="f-matches" value="${esc(rec.matches)}" placeholder="chair"></div>
    </div>
    <div class="field"><label>Becomes <span class="text-dim">(the name while you're high)</span></label>
      <input id="f-name" value="${esc(rec.name)}" placeholder="a chair made of the pattern behind chairs"></div>
    <div class="field"><label>Description <span class="text-dim">(its line in the room)</span></label>
      <textarea id="f-description" rows="3">${esc(rec.description)}</textarea></div>
    <div class="field"><label>Looks <span class="text-dim">(one per line — answers to examining it)</span></label>
      <textarea id="f-looks" rows="4">${esc(arrToLines(rec.looks))}</textarea></div>
    <div class="field"><label>Says <span class="text-dim">(one per line — spoken at the player, unprompted)</span></label>
      <textarea id="f-says" rows="4">${esc(arrToLines(rec.says))}</textarea></div>
    ${rawJsonBox('looks', rec.looks)}
    ${rawJsonBox('says', rec.says)}
  `;
}

async function saveDrugTransform(existing) {
  const isNew = !existing?.id;
  const body = {
    drug_id: document.getElementById('f-drug_id').value || null,
    matches: document.getElementById('f-matches').value.trim() || null,
    name: document.getElementById('f-name').value.trim(),
    description: document.getElementById('f-description').value,
    looks: rawOverride('looks') ?? linesToArr(document.getElementById('f-looks').value),
    says: rawOverride('says') ?? linesToArr(document.getElementById('f-says').value),
  };
  if (!body.name) return { error: 'A transform needs a name — what the thing becomes.' };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/drug-transforms', 'POST', body); }
  return API(`/drug-transforms/${encodeURIComponent(existing.id)}`, 'PUT', body);
}

// ── Roll a preview ──────────────────────────────────────────────────────────
//
// Non-reciprocating exits and per-instance object looks cannot be judged from a
// form. This builds a real throwaway instance from the live templates, shows what
// it made, and dissolves it — nobody ever enters it.

window.dreamRollPreview = async function () {
  const cause = document.getElementById('dream-prev-cause').value;
  const drugId = document.getElementById('dream-prev-drug').value || null;
  const out = document.getElementById('dream-prev-out');
  out.innerHTML = '<div class="text-dim">Rolling…</div>';
  const res = await API('/dream-preview', 'POST', { cause, drug_id: drugId, size: 4 });
  if (res?.error) { out.innerHTML = `<div class="text-danger">${esc(res.error)}</div>`; return; }
  if (res?.empty) { out.innerHTML = `<div style="color:var(--yellow)">⚠ ${esc(res.reason)}</div>`; return; }
  out.innerHTML = (res.rooms || []).map((r, i) => `
    <div style="border:1px solid var(--border);padding:10px;margin-bottom:10px">
      <strong>${esc(r.name)}</strong> ${r.id === res.entry ? '<span class="badge badge-safe-zone">entry</span>' : ''}
      <div style="margin:6px 0">${esc(r.description)}</div>
      <div class="text-dim">Exits: ${Object.keys(r.exits || {}).join(', ') || '<em>none</em>'} — these deliberately do not reciprocate.</div>
      <div class="text-dim">Objects: ${(r.objects || []).map(o => `${esc(o.name)} — “${esc(o.look)}”`).join(' · ') || '<em>none</em>'}</div>
    </div>`).join('');
};

function dreamPreviewWidget() {
  return `
    <div style="border:1px solid var(--border);padding:12px;margin-bottom:16px">
      <strong>Roll a preview</strong>
      <div class="field-hint">Builds a real instance from the live templates and dissolves it. Nobody enters it. The only way to see how non-reciprocating exits and rolled object looks actually read.</div>
      <div class="field-row" style="margin-top:8px">
        <div class="field"><label>Cause</label>
          <select id="dream-prev-cause"><option value="dream">dream</option><option value="drug">drug</option></select></div>
        <div class="field"><label>Drug <span class="text-dim">(blank = default set)</span></label>
          <select id="dream-prev-drug">${drugOptions(null, 'dreamzone')}</select></div>
      </div>
      <button type="button" class="btn" onclick="dreamRollPreview()">Roll</button>
      <div id="dream-prev-out" style="margin-top:12px"></div>
    </div>`;
}

// Cached so the thin-pool warning can count siblings without another round trip.
function cacheTemplates(rows) { window._dreamTemplateCache = Array.isArray(rows) ? rows : []; return window._dreamTemplateCache; }

const causeBadge = (r) => r.cause === 'drug'
  ? `<span class="badge badge-medium">${esc(r.drug_id || 'default set')}</span>`
  : `<span class="badge badge-safe-zone">dream</span>`;

// ── Unreality suite (one nav item, two tabs) ────────────────────────────────
//
// Three tables, one sidebar entry. A room and the presence that walks through it
// are halves of the same authoring job — you cannot judge a pool of rooms without
// knowing who turns up in them — so they share a tab and are read together.
// Transforms get their own tab because they are the opposite thing: no room at
// all, just the real world re-dressed (see docs/systems-dreams.md).
//
// There is no separate suite panel: the three PANELS entries stay exactly as they
// were, and the ACTIVE ONE is the tab. That is what keeps the generic machinery
// working untouched — currentPanel still names one table, so editForm/save/delete
// and the post-save loadPanel() all resolve to the right one with no overrides.

const DREAM_SUITE_PANELS = ['dream_templates', 'dream_presences', 'drug_transforms'];
const DREAM_SUITE_TAB = { dream_templates: 'dreams', dream_presences: 'dreams', drug_transforms: 'trips' };
const DREAM_SUITE_TABS = [
  { id: 'dreams', label: '🌒 Dreamscapes', panel: 'dream_templates' },
  { id: 'trips',  label: '🌀 Drug Transforms', panel: 'drug_transforms' },
];
const DREAM_SUITE_TITLE = 'Unreality';
const DREAM_SUITE_DESC = 'Everything a player experiences that isn\'t there — the rooms sleep and dissociatives build, whoever wanders them, and what a psychedelic turns the real world into.';

// Every tab fetches all three tables (they are tiny, cold-tier, and the pool
// warnings read across them), but returns only the ACTIVE panel's rows so
// loadPanel's `allRecords` — and therefore editRecord's lookup — stays correct.
async function dreamSuiteFetch(which) {
  const [templates, presences, transforms] = await Promise.all([
    API('/dream-templates'), API('/dream-presences'), API('/drug-transforms'),
    // The drug pickers in all three forms read DREAM_DRUGS; nothing else loads it.
    loadDreamDrugs(),
  ]);
  window._dreamSuite = {
    dream_templates: Array.isArray(templates) ? templates : [],
    dream_presences: Array.isArray(presences) ? presences : [],
    drug_transforms: Array.isArray(transforms) ? transforms : [],
  };
  cacheTemplates(window._dreamSuite.dream_templates);
  return window._dreamSuite[which];
}

// Rows carry their own panel key rather than relying on currentPanel at click
// time: two tables from two tables live in one view, and the click has to say
// which one it came from.
window.dreamSuiteEdit = function (panel, id) {
  currentPanel = panel;
  allRecords = (window._dreamSuite?.[panel]) || [];
  editRecord(id);
};

window.dreamSuiteNew = function (panel) {
  currentPanel = panel;
  allRecords = (window._dreamSuite?.[panel]) || [];
  newRecord();
};

window.dreamSuiteTab = function (tabId) {
  const tab = DREAM_SUITE_TABS.find(t => t.id === tabId);
  if (tab) showPanel(tab.panel);
};

function dreamSuiteSection(panel, rows) {
  const p = PANELS[panel];
  const singular = p.title.replace(/s$/, '');
  const head = `
    <div style="display:flex;align-items:baseline;gap:10px;margin:18px 0 6px">
      <strong>${esc(p.title)}</strong>
      <span class="text-dim" style="font-size:11px">${esc(p.description)}</span>
      <button type="button" class="btn btn-sm" style="margin-left:auto"
        onclick="dreamSuiteNew('${panel}')">+ New ${esc(singular)}</button>
    </div>`;
  if (!rows.length) return head + '<div style="padding:16px;color:var(--text-dim)">No records found.</div>';
  const body = rows.map(rec => `
    <tr onclick="dreamSuiteEdit('${panel}','${esc(rec.id)}')">
      ${p.columns.map(c => `<td>${c.render ? c.render(rec[c.key], rec) : (rec[c.key] ?? '—')}</td>`).join('')}
      <td><button class="action-btn" onclick="event.stopPropagation();dreamSuiteEdit('${panel}','${esc(rec.id)}')">Edit</button></td>
    </tr>`).join('');
  return `${head}<table><thead><tr>${p.columns.map(c => `<th>${c.label}</th>`).join('')}<th></th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderDreamSuite() {
  const active = DREAM_SUITE_TAB[currentPanel] || 'dreams';
  const q = (document.getElementById('search-input')?.value || '').toLowerCase();
  const rowsOf = (panel) => {
    const rows = (window._dreamSuite?.[panel]) || [];
    return q ? rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q))) : rows;
  };
  // loadPanel wrote the active table's own title into the toolbar; the suite is
  // one place as far as the author is concerned, so say so.
  document.getElementById('panel-title').textContent = DREAM_SUITE_TITLE;
  document.getElementById('panel-description').textContent = DREAM_SUITE_DESC;

  const tabs = `
    <div class="bc-tabs">
      ${DREAM_SUITE_TABS.map(t => `
        <button class="bc-tab${active === t.id ? ' bc-tab-active' : ''}"
          onclick="dreamSuiteTab('${t.id}')">${t.label}</button>`).join('')}
    </div>`;

  const body = active === 'dreams'
    ? dreamPreviewWidget()
      + dreamSuiteSection('dream_templates', rowsOf('dream_templates'))
      + dreamSuiteSection('dream_presences', rowsOf('dream_presences'))
    : dreamSuiteSection('drug_transforms', rowsOf('drug_transforms'));

  document.getElementById('list-panel').innerHTML = tabs + body;
}
