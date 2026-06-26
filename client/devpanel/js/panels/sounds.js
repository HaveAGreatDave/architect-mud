const AMBIENT_THEMES = ['outdoors','city','indoors','forest','industrial','underground','waterfront','ruins','commercial','residential'];
const SOUND_CATEGORIES = ['misc','gunshot','explosion','impact','animal','ambient','speech','mechanical','nature','electronic'];

// ── Combined Sounds panel ────────────────────────────────────────────────────

function renderSoundsPanel(data) {
  const panel = document.getElementById('list-panel');
  const sounds  = Array.isArray(data?.sounds)  ? data.sounds  : [];
  const ambients = Array.isArray(data?.ambients) ? data.ambients : [];

  const loudnessBar = v => {
    const pct = Math.round((v||0)/10*100);
    const color = v>=7?'var(--red)':v>=4?'var(--yellow)':'var(--cyan)';
    return `<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:var(--bg3);border-radius:2px;height:6px"><div style="width:${pct}%;background:${color};height:100%;border-radius:2px"></div></div><span style="font-size:10px;color:var(--text-dim);width:28px">${v??'?'}</span></div>`;
  };

  // Section 1: Sound Definitions
  const soundRows = sounds.map(s => {
    const descs = Array.isArray(s.descriptions) ? s.descriptions : [];
    const preview = descs[0] ? `<span style="color:var(--text-dim);font-size:11px;font-style:italic">${descs[0].slice(0,60)}${descs[0].length>60?'…':''}</span>` : '<span style="color:var(--border)">—</span>';
    return `<tr>
      <td style="font-weight:600;color:${s.enabled?'var(--text-bright)':'var(--text-dim)'}">${s.name}</td>
      <td><span style="font-size:10px;background:var(--bg3);padding:2px 6px;border-radius:2px;color:var(--accent)">${s.category}</span></td>
      <td>${preview}</td>
      <td style="min-width:90px">${loudnessBar(s.loudness)}</td>
      <td style="text-align:center;font-size:10px;color:var(--text-dim)">${Array.isArray(s.descriptions)?s.descriptions.length:0}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="editSound(${JSON.stringify(s).replace(/"/g,'&quot;')})">✏</button>
        <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteSound('${s.id}','${s.name.replace(/'/g,"\\'")}')">✕</button>
      </td>
    </tr>`;
  }).join('');

  // Section 2: Ambient Sounds, grouped by theme
  const byTheme = {};
  for (const e of ambients) {
    if (!byTheme[e.theme]) byTheme[e.theme] = [];
    byTheme[e.theme].push(e);
  }
  const ambientSections = Object.keys(byTheme).sort().map(theme => {
    const rows = byTheme[theme].map(e => `<tr>
      <td style="color:${e.enabled?'var(--text)':'var(--text-dim)'};font-size:12px;line-height:1.5;font-style:${e.enabled?'normal':'italic'}">${e.message}</td>
      <td style="min-width:80px">${loudnessBar(e.loudness??1)}</td>
      <td style="text-align:center;font-size:11px;color:var(--text-dim);width:50px">${e.weight??100}</td>
      <td style="text-align:right;white-space:nowrap;width:160px">
        <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="editAmbientEvent(${JSON.stringify(e).replace(/"/g,'&quot;')})">✏</button>
        <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px;color:var(--${e.enabled?'red':'green'})" onclick="toggleAmbientEvent('${e.id}',${e.enabled?0:1})">${e.enabled?'Disable':'Enable'}</button>
        <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteAmbientEvent('${e.id}')">✕</button>
      </td>
    </tr>`).join('');
    return `<div style="margin-bottom:12px">
      <div style="padding:5px 16px;background:var(--bg3);border-top:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--accent)">${theme}</span>
        <span style="font-size:10px;color:var(--text-dim)">${byTheme[theme].length} event${byTheme[theme].length!==1?'s':''}</span>
      </div>
      <table><thead><tr><th>Message</th><th style="min-width:80px">Loudness</th><th style="text-align:center;width:50px" title="Frequency weight">Wt</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div style="padding:10px 16px;border-bottom:2px solid var(--border);background:var(--bg2)">
      <div style="font-size:13px;font-weight:600;color:var(--accent);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Sound Definitions</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;color:var(--text-dim)">${sounds.length} sound${sounds.length!==1?'s':''} — triggered by objects &amp; events</span>
        <button class="action-btn" onclick="newSound()">+ New Sound</button>
      </div>
      ${sounds.length ? `<table>
        <thead><tr><th>Name</th><th>Category</th><th>Sample description</th><th>Loudness</th><th title="Variants">Var</th><th></th></tr></thead>
        <tbody>${soundRows}</tbody>
      </table>` : '<div style="padding:12px 0;color:var(--text-dim);font-size:12px">No sounds defined yet.</div>'}
    </div>
    <div style="padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg2);display:flex;justify-content:space-between;align-items:center;margin-top:4px">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--accent);letter-spacing:1px;text-transform:uppercase">Ambient Sounds</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${ambients.length} event${ambients.length!==1?'s':''} — by zone theme, weighted random selection</div>
      </div>
      <button class="action-btn" onclick="newAmbientEvent()">+ New Ambient</button>
    </div>
    ${ambientSections || '<div style="padding:24px;color:var(--text-dim)">No ambient events yet.</div>'}
  `;
}

// ── Sound definition CRUD ────────────────────────────────────────────────────

function newSound() { openSoundModal({}); }
function editSound(s) { openSoundModal(s); }

async function deleteSound(id, name) {
  if (!confirm(`Delete sound "${name}"?`)) return;
  await API(`/sounds/${id}`, 'DELETE');
  toast(`"${name}" deleted`);
  loadPanel('sounds');
}

function openSoundModal(s) {
  const isNew = !s.id;
  const modal = document.getElementById('generic-modal');
  document.getElementById('modal-title').textContent = isNew ? 'New Sound' : `Edit: ${s.name}`;
  const catOpts = SOUND_CATEGORIES.map(c => `<option value="${c}" ${(s.category||'misc')===c?'selected':''}>${c}</option>`).join('');
  const descs = Array.isArray(s.descriptions) ? s.descriptions : [];
  document.getElementById('modal-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="field"><label>Name</label><input id="sm-name" value="${s.name||''}"></div>
      <div class="field"><label>Category</label><select id="sm-cat">${catOpts}</select></div>
    </div>
    <div class="field"><label>Loudness <span style="color:var(--text-dim);font-weight:400">(0–10, affects tile range)</span></label>
      <input id="sm-loudness" type="number" min="0" max="10" step="0.5" value="${s.loudness??3}">
    </div>
    <div class="field"><label>Descriptions <span style="color:var(--text-dim);font-weight:400">(one per line — one is chosen at random when triggered)</span></label>
      <textarea id="sm-descs" rows="5" style="resize:vertical">${descs.join('\n')}</textarea>
    </div>
    <div class="field" style="display:flex;align-items:center;gap:10px">
      <input type="checkbox" id="sm-enabled" ${s.enabled!==0?'checked':''}>
      <label for="sm-enabled" style="margin:0;cursor:pointer">Enabled</label>
    </div>`;
  document.getElementById('modal-save').onclick = async () => {
    const name = document.getElementById('sm-name').value.trim();
    if (!name) { toast('Name is required', true); return; }
    const body = {
      name,
      category: document.getElementById('sm-cat').value,
      loudness: parseFloat(document.getElementById('sm-loudness').value)||3,
      descriptions: document.getElementById('sm-descs').value.split('\n').map(l=>l.trim()).filter(Boolean),
      enabled: document.getElementById('sm-enabled').checked ? 1 : 0,
    };
    const r = isNew ? await API('/sounds','POST',body) : await API(`/sounds/${s.id}`,'PUT',body);
    if (r?.error) { toast(r.error, true); return; }
    toast(isNew ? 'Sound created' : 'Sound updated');
    closeModal();
    loadPanel('sounds');
  };
  modal.style.display = 'flex';
}

// ── Ambient event CRUD ───────────────────────────────────────────────────────

function newAmbientEvent() { openAmbientEventModal({}); }
function editAmbientEvent(e) { openAmbientEventModal(e); }

async function toggleAmbientEvent(id, enabled) {
  await API(`/ambient-events/${id}`, 'PUT', { enabled });
  loadPanel('sounds');
}

async function deleteAmbientEvent(id) {
  if (!confirm('Delete this ambient event?')) return;
  await API(`/ambient-events/${id}`, 'DELETE');
  toast('Event deleted');
  loadPanel('sounds');
}

function openAmbientEventModal(e) {
  const isNew = !e.id;
  const modal = document.getElementById('generic-modal');
  document.getElementById('modal-title').textContent = isNew ? 'New Ambient Event' : 'Edit Ambient Event';
  const themeOpts = AMBIENT_THEMES.map(t => `<option value="${t}" ${(e.theme||'indoors')===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('');
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>Theme</label>
      <select id="ae-theme">${themeOpts}</select>
    </div>
    <div class="field"><label>Message</label>
      <textarea id="ae-message" rows="3" style="resize:vertical">${e.message||''}</textarea>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="field"><label>Loudness <span style="color:var(--text-dim);font-weight:400">(0–10)</span></label>
        <input id="ae-loudness" type="number" min="0" max="10" step="0.5" value="${e.loudness??1}">
      </div>
      <div class="field"><label>Weight <span style="color:var(--text-dim);font-weight:400">(frequency, default 100)</span></label>
        <input id="ae-weight" type="number" min="1" max="1000" value="${e.weight??100}">
      </div>
    </div>
    <div class="field" style="display:flex;align-items:center;gap:10px">
      <input type="checkbox" id="ae-enabled" ${e.enabled!==0?'checked':''}>
      <label for="ae-enabled" style="margin:0;cursor:pointer">Enabled</label>
    </div>`;
  document.getElementById('modal-save').onclick = async () => {
    const message = document.getElementById('ae-message').value.trim();
    if (!message) { toast('Message is required', true); return; }
    const body = {
      theme: document.getElementById('ae-theme').value,
      message,
      loudness: parseFloat(document.getElementById('ae-loudness').value)||1,
      weight: parseInt(document.getElementById('ae-weight').value)||100,
      enabled: document.getElementById('ae-enabled').checked ? 1 : 0,
    };
    const r = isNew
      ? await API('/ambient-events','POST',body)
      : await API(`/ambient-events/${e.id}`,'PUT',body);
    if (r?.error) { toast(r.error, true); return; }
    toast(isNew ? 'Event created' : 'Event updated');
    closeModal();
    loadPanel('sounds');
  };
  modal.style.display = 'flex';
}

