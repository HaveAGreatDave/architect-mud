function renderPlayersPanel(data) {
  const panel = document.getElementById('list-panel');
  const all = Array.isArray(data) ? data : [];
  const admins = all.filter(p => ADMIN_ROLES.has(p.role));
  const players = all.filter(p => !ADMIN_ROLES.has(p.role));

  const onlineDot = online => `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${online?'var(--accent2)':'var(--border)'};margin-right:5px;vertical-align:middle"></span>`;
  const roleColor = r => ({admin:'var(--red)',dev:'var(--accent)',builder:'var(--accent3)',designer:'var(--accent3)'}[r]||'var(--text-dim)');

  const actionCells = p => `
    <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="openPlayerEdit('${p.id}')">✏ Edit</button>
    <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="openWhisper('${p.id}','${p.handle.replace(/'/g,"\\'")}')">✉ Whisper</button>
    <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px;color:var(--cyan);border-color:var(--cyan)" onclick="gotoPlayer('${p.id}','${p.handle.replace(/'/g,"\\'")}')">→ Go To</button>
    <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px;color:var(--accent2);border-color:var(--accent2)" onclick="sendPlayerToZone('${p.id}','${p.handle.replace(/'/g,"\\'")}','${(p.current_zone||'').replace(/'/g,"\\'")}')">↩ Send To</button>
    <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="confirmSmite('${p.id}','${p.handle.replace(/'/g,"\\'")}')">⚡ Smite</button>
    <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="confirmDelete('${p.id}','${p.handle.replace(/'/g,"\\'")}')">✕ Delete</button>
    <select onchange="setPlayerRole('${p.id}','${p.handle.replace(/'/g,"\\'")}',this.value);this.value=''" style="margin-left:4px;background:var(--bg3);border:1px solid var(--border);color:var(--text-dim);font-family:var(--font);font-size:10px;padding:3px 4px;border-radius:2px;cursor:pointer">
      <option value="">role…</option>
      <option value="player">player</option>
      <option value="builder">builder</option>
      <option value="designer">designer</option>
      <option value="dev">dev</option>
      <option value="admin">admin</option>
    </select>`;

  const tableRows = list => list.map(p => `<tr>
    <td style="width:14px;padding-right:0">${onlineDot(p.online)}</td>
    <td style="font-weight:600;color:${ADMIN_ROLES.has(p.role)?'var(--red)':'var(--text-bright)'}">${p.handle}</td>
    <td style="color:var(--text-dim)">${p.username}</td>
    <td><span style="color:${roleColor(p.role)}">${p.role}</span></td>
    <td style="color:var(--text-dim);font-size:11px">${p.current_zone||'—'}</td>
    <td>${p.credits??0}</td>
    <td style="text-align:right;white-space:nowrap">${actionCells(p)}</td>
  </tr>`).join('');

  const thead = `<thead><tr><th></th><th>Handle</th><th>Username</th><th>Role</th><th>Zone</th><th>Credits</th><th style="text-align:right">Actions</th></tr></thead>`;

  const section = (title, color, list) => list.length ? `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:${color};padding:16px 16px 8px">
      ${title} <span style="font-weight:400;opacity:0.6">(${list.length})</span>
    </div>
    <table>${thead}<tbody>${tableRows(list)}</tbody></table>` : '';

  const toolbar = `<div style="padding:16px 16px 0;display:flex;gap:8px;flex-wrap:wrap">
    <button class="action-btn" onclick="clearAllGameTables()">🃏 Clear all poker tables</button>
  </div>`;

  panel.innerHTML = toolbar
    + section('Admins & Staff', 'var(--accent)', admins)
    + section('Players', 'var(--text-dim)', players)
    + (!all.length ? '<div style="padding:24px;color:var(--text-dim)">No players found.</div>' : '');
}

async function clearAllGameTables() {
  if (!confirm('Clear all players from every poker table? Seated players and bots are cashed out and stood up.')) return;
  const r = await directAPI('/gametable/clear-all', 'POST', {});
  if (r.error) { toast(r.error, true); return; }
  toast(`🃏 Cleared ${r.cleared} occupant(s) from ${r.tables} table(s)`);
}

async function confirmSmite(id, handle) {
  if (!confirm(`Smite ${handle} with lightning? This will kill them instantly.`)) return;
  const r = await API(`/players/${id}/smite`, 'POST');
  if (r.error) { toast(r.error, true); return; }
  toast(`⚡ ${handle} has been smitten`);
}

async function confirmDelete(id, handle) {
  if (!confirm(`Permanently delete ${handle}? This cannot be undone.`)) return;
  if (!confirm(`Are you sure? All data for "${handle}" will be erased.`)) return;
  const r = await API(`/players/${id}`, 'DELETE');
  if (r.error) { toast(r.error, true); return; }
  toast(`${handle} deleted`);
  loadPanel('players');
}

async function setPlayerRole(id, handle, role) {
  if (!role) return;
  if (!confirm(`Set ${handle}'s role to "${role}"?`)) return;
  const r = await API(`/players/${id}/role`, 'PUT', { role });
  if (r.error) { toast(r.error, true); return; }
  toast(`${handle} is now ${role}`);
  loadPanel('players');
}

let _editingPlayerId = null;
let _editingPlayerOriginal = null;

async function openPlayerEdit(id) {
  const all = Array.isArray(allRecords) ? allRecords : [];
  const p = all.find(r => r.id === id);
  if (!p) { toast('Player not found in current list', true); return; }
  _editingPlayerId = id;
  _editingPlayerOriginal = p;

  const field = (label, key, type='text', opts={}) => {
    const val = p[key] ?? '';
    if (type === 'select') {
      const options = opts.options.map(o => `<option value="${o}"${String(p[key])===String(o)?'selected':''}>${o}</option>`).join('');
      return `<div class="field"><label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">${label}</label>
        <select id="pe-${key}" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">${options}</select></div>`;
    }
    if (type === 'checkbox') {
      return `<div class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pe-${key}"${val?'checked':''}><label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">${label}</label></div>`;
    }
    return `<div class="field"><label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">${label}</label>
      <input type="${type}" id="pe-${key}" value="${String(val).replace(/"/g,'&quot;')}" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px;box-sizing:border-box"></div>`;
  };

  const section = (title, content) => `<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--accent);margin:16px 0 8px;border-bottom:1px solid var(--border);padding-bottom:4px">${title}</div>${content}`;
  const row2 = (a, b) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${a}${b}</div>`;
  const row3 = (a, b, c) => `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">${a}${b}${c}</div>`;

  const onlineTag = p.online ? `<span style="background:var(--accent2);color:var(--bg);font-size:10px;padding:2px 8px;border-radius:10px;margin-left:8px">ONLINE</span>` : '';

  document.getElementById('modal-title').innerHTML = `Edit Player — ${p.handle}${onlineTag}`;
  document.getElementById('modal-body').innerHTML = `
    ${section('Identity',
      row2(field('Handle','handle'), field('Username','username')) +
      field('Role','role','select',{options:['player','builder','designer','dev','admin']}) +
      field('Origin Fragment','origin_fragment') +
      field('Archetype','archetype')
    )}
    ${section('Location',
      row2(field('Current Zone','current_zone'), field('Anchor Zone','anchor_zone'))
    )}
    ${section('Vitals',
      row2(field('HP','hp','number'), field('HP Max','hp_max','number')) +
      row2(field('Sanity','sanity','number'), field('Sanity Max','sanity_max','number')) +
      row3(field('Hunger','hunger','number'), field('Thirst','thirst','number'), field('Radiation','radiation','number')) +
      row2(field('Stamina','stamina','number'), field('Stamina Max','stamina_max','number')) +
      field('Body Temp (°C)','body_temp_c','number')
    )}
    ${section('Stats',
      row3(field('Brawn','stat_brawn','number'), field('Reflexes','stat_reflexes','number'), field('Endurance','stat_endurance','number')) +
      row3(field('Brains','stat_brains','number'), field('Cool','stat_cool','number')) +
      field('Bonus XP','bonus_xp','number')
    )}
    ${section('Progression (read-only)',
      `<div id="pe-progression" style="font-size:12px;color:var(--text-dim)">Loading…</div>`
    )}
    ${section('Economy',
      row2(field('Credits','credits','number'), field('Bank Credits','bank_credits','number'))
    )}
    ${section('Flags',
      row2(field('Visibly Mutated','visibly_mutated','checkbox'), field('Offline Sleeping','offline_sleeping','checkbox')) +
      row2(field('Covered in Blood','covered_in_blood','checkbox'), '')
    )}
    <div style="font-size:10px;color:var(--text-dim);margin-top:12px">
      Created: ${p.created_at ? new Date(p.created_at*1000).toLocaleString() : '—'} &nbsp;|&nbsp;
      Last Seen: ${p.last_seen ? new Date(p.last_seen*1000).toLocaleString() : '—'}
    </div>`;

  document.getElementById('modal-save').onclick = savePlayerEdit;
  document.getElementById('modal-save').textContent = 'Save Changes';

  // Add revert button next to cancel
  const footer = document.getElementById('modal-save').parentElement;
  if (!document.getElementById('modal-revert')) {
    const revertBtn = document.createElement('button');
    revertBtn.id = 'modal-revert';
    revertBtn.className = 'action-btn';
    revertBtn.style.cssText = 'flex:0 0 auto';
    revertBtn.textContent = 'Revert';
    revertBtn.onclick = () => openPlayerEdit(_editingPlayerId);
    footer.insertBefore(revertBtn, footer.children[1]);
  } else {
    document.getElementById('modal-revert').style.display = '';
  }

  document.getElementById('generic-modal').style.display = 'flex';
  loadPlayerProgression(id);
}

async function loadPlayerProgression(id) {
  const el = document.getElementById('pe-progression');
  if (!el) return;
  const r = await API(`/players/${id}/progression`, 'GET');
  if (!el.isConnected || _editingPlayerId !== id) return; // modal closed/changed
  if (!r || r.error) { el.textContent = r?.error || 'Failed to load progression.'; return; }

  const xpRow = (label, val) => `<div style="display:flex;justify-content:space-between"><span>${label}</span><span style="color:var(--text-bright)">${val}</span></div>`;
  const xpSummary = `<div style="display:grid;gap:3px;margin-bottom:10px">
    ${xpRow('Total XP', r.total_xp)}
    ${xpRow('Spent on stats', r.spent_xp)}
    ${xpRow('Net XP (spendable)', r.net_xp)}
    ${xpRow('Bonus XP (starting + grants)', r.bonus_xp)}
  </div>`;

  const skills = Array.isArray(r.skills) ? r.skills : [];
  const skillRows = skills.length
    ? skills.map(s => `<tr>
        <td style="color:var(--text-bright)">${s.name}</td>
        <td style="color:var(--text-dim);font-size:11px">${s.category}</td>
        <td style="text-align:right">L${s.level}</td>
        <td style="text-align:right">${s.ip} IP</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="color:var(--text-dim)">No skill IP yet.</td></tr>`;

  el.innerHTML = xpSummary +
    `<table style="width:100%;font-size:12px"><thead><tr>
      <th style="text-align:left">Skill</th><th style="text-align:left">Category</th>
      <th style="text-align:right">Level</th><th style="text-align:right">IP</th>
    </tr></thead><tbody>${skillRows}</tbody></table>`;
}

async function gotoPlayer(id, handle) {
  const r = await API(`/players/${id}/goto`, 'POST');
  if (r?.error) { toast(r.error, true); return; }
  await launchPlayerClient();
}

async function sendPlayerToZone(id, handle, currentZone) {
  const zoneId = prompt(`Send ${handle} to zone:\n(currently in: ${currentZone || 'unknown'})`)?.trim();
  if (!zoneId) return;
  const r = await API(`/players/${id}/teleport`, 'POST', { zoneId });
  if (r?.error) { toast(r.error, true); return; }
  toast(`↩ Sent ${handle} to ${zoneId}`);
  loadPanel('players');
}

async function savePlayerEdit() {
  const id = _editingPlayerId;
  if (!id) return;
  const NUM = ['hp','hp_max','sanity','sanity_max','hunger','thirst','radiation','stamina','stamina_max',
    'body_temp_c','stat_brawn','stat_reflexes','stat_endurance','stat_brains','stat_cool',
    'bonus_xp','credits','bank_credits'];
  const BOOL = ['visibly_mutated','offline_sleeping','covered_in_blood'];
  const TEXT = ['handle','username','role','current_zone','anchor_zone','origin_fragment','archetype'];
  const body = {};
  for (const k of TEXT) { const el=document.getElementById(`pe-${k}`); if (el) body[k]=el.value.trim(); }
  for (const k of NUM)  { const el=document.getElementById(`pe-${k}`); if (el) body[k]=Number(el.value); }
  for (const k of BOOL) { const el=document.getElementById(`pe-${k}`); if (el) body[k]=el.checked?1:0; }

  const r = await API(`/players/${id}`, 'PUT', body);
  if (r?.error) { toast(r.error, true); return; }
  toast(`${body.handle || id} saved`);
  closeModal();
  loadPanel('players');
}

