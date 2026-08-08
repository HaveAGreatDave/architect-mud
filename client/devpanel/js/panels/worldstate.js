function renderWorldState(data) {
  const panel = document.getElementById('list-panel');
  window._wsData = data; // cache full payload for re-sort without refetch
  let zones = data.zones || [];

  if (sortState.key) {
    zones = [...zones].sort((a, b) => {
      let av = a[sortState.key], bv = b[sortState.key];
      if (av == null) av = ''; if (bv == null) bv = '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortState.dir;
      if (sortState.key === 'danger') {
        const order = {safe:0,low:1,medium:2,high:3,lethal:4};
        return ((order[av]??2) - (order[bv]??2)) * sortState.dir;
      }
      return String(av).localeCompare(String(bv)) * sortState.dir;
    });
  }

  const cols = [
    {key:'name',label:'Zone'},{key:'danger',label:'Danger'},
    {key:'player_count',label:'Players'},{key:'enemy_count',label:'Enemies'},{key:'sanctuary',label:'Sanctuary'},
  ];
  let html = '<table><thead><tr>';
  for (const c of cols) {
    const isSorted = sortState.key === c.key;
    const arrow = isSorted ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
    html += `<th class="sortable-col${isSorted?' sorted':''}" onclick="sortWorldStateBy('${c.key}')">${c.label}${arrow}</th>`;
  }
  html += '<th></th></tr></thead><tbody>';
  for (const z of zones) {
    html += `<tr>
      <td>${z.name}</td>
      <td><span class="badge badge-${z.danger}">${z.danger}</span></td>
      <td>${z.player_count}</td>
      <td>${z.enemy_count}</td>
      <td>${z.sanctuary ? '⛨' : ''}</td>
      <td><button class="action-btn" onclick="reloadZone('${z.id}')">↻ Reload</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  panel.innerHTML = html;

  // Update sidebar
  const players = data.online_players || [];
  document.getElementById('ws-players').innerHTML = players.length
    ? players.map(p => `<div class="ws-player"><em>${p.handle}</em> — ${p.current_zone}</div>`).join('')
    : '<div class="ws-player" style="color:var(--text-dim)">None online</div>';
  document.getElementById('ws-enemies').textContent = data.live_enemies || 0;
  document.getElementById('ws-corpses').textContent = data.live_corpses || 0;
  document.getElementById('ws-zones').textContent = zones.length;
}

async function reloadZone(id) {
  await API('/world/reload', 'POST', { zone_id: id });
  toast(`Zone ${id} reloaded ✓`);
}

async function refreshWorld() { loadPanel(currentPanel); }

async function initMisToggle() {
  const toggle = document.getElementById('mis-server-toggle');
  if (!toggle) return;
  try {
    const data = await API('/mis/status');
    toggle.checked = !!data.enabled;
  } catch(e) { /* non-fatal */ }
  toggle.addEventListener('change', async () => {
    try {
      await API('/mis/toggle', 'POST', { enable: toggle.checked });
      toast(`MIS ${toggle.checked ? 'enabled' : 'disabled'}`);
    } catch(e) {
      toast('MIS toggle failed', true);
      toggle.checked = !toggle.checked;
    }
  });
}

async function initEmailVerifyToggle() {
  const toggle = document.getElementById('email-verify-toggle');
  if (!toggle) return;
  try {
    const data = await API('/email-verification/status');
    toggle.checked = !!data.enabled;
    // A gate with no mailer behind it is a locked door with no key — flag it here.
    if (data.enabled && data.mailerConfigured === false) {
      toast(`Email verification is ON but the mailer is ${data.mailerProblem} — new accounts can't verify`, true);
    }
  } catch(e) { /* non-fatal */ }
  toggle.addEventListener('change', async () => {
    try {
      await API('/email-verification/toggle', 'POST', { enable: toggle.checked });
      toast(`Email verification ${toggle.checked ? 'enabled' : 'disabled'}`);
    } catch(e) {
      toast('Email verification toggle failed', true);
      toggle.checked = !toggle.checked;
    }
  });
}

// Registrations: the switch closes the door on NEW accounts only — everyone who
// already has one still logs in. Clicking the LABEL edits the line new players
// are shown, so the refusal stays polite and can name a reason.
async function initRegistrationsToggle() {
  const toggle = document.getElementById('registrations-toggle');
  if (!toggle) return;
  let message = '';
  try {
    const data = await API('/registrations/status');
    toggle.checked = !!data.open;
    message = data.message || '';
  } catch(e) { /* non-fatal */ }

  async function push(open, msg) {
    const body = { open };
    if (typeof msg === 'string') body.message = msg;
    const res = await API('/registrations/toggle', 'POST', body);
    message = res?.message || message;
    toggle.checked = !!res?.open;
  }

  toggle.addEventListener('change', async () => {
    try {
      await push(toggle.checked);
      toast(`Registrations ${toggle.checked ? 'OPEN' : 'LOCKED'}`);
    } catch(e) {
      toast('Registration toggle failed', true);
      toggle.checked = !toggle.checked;
    }
  });

  document.getElementById('registrations-msg-edit')?.addEventListener('click', async () => {
    const next = await dpPrompt('Message shown to anyone trying to register while locked:', message, { title:'Registration Notice' });
    if (next === null) return;
    try {
      await push(toggle.checked, next);
      toast('Registration notice saved ✓');
    } catch(e) { toast('Could not save notice', true); }
  });
}

function updateEspDot(data) {
  const input = document.getElementById('ws-esp-toggle');
  const lbl = input?.closest('label');
  if (!input || !lbl) return;
  const active = !!data?.active;
  const standingDown = !!data?.arbiters?.standingDown;
  let title;
  if (active && !standingDown) { title = 'ESP: DEPLOYED'; }
  else if (standingDown)        { title = 'ESP: STANDING DOWN'; }
  else                          { title = 'Emergency Security Protocol'; }
  input.checked = active || standingDown;
  lbl.classList.toggle('esp-active', active && !standingDown);
  lbl.classList.toggle('esp-standingdown', !!standingDown);
  lbl.title = title;
}

function startWorldStatePolling() {
  // Fetch initial ESP state immediately on load
  directAPI('/emergency/state').then(d => updateEspDot(d)).catch(() => {});

  setInterval(async () => {
    if (document.hidden) return; // tab not visible — skip; sidebar refreshes on next visible tick
    const [data, esp] = await Promise.allSettled([
      API('/world/state'),
      directAPI('/emergency/state'),
    ]);
    if (data.status === 'fulfilled') {
      const players = data.value.online_players || [];
      document.getElementById('ws-players').innerHTML = players.length
        ? players.map(p => `<div class="ws-player"><em>${p.handle}</em></div>`).join('')
        : '<div class="ws-player" style="color:var(--text-dim)">None</div>';
      document.getElementById('ws-enemies').textContent = data.value.live_enemies || 0;
      document.getElementById('ws-corpses').textContent = data.value.live_corpses || 0;
    }
    if (esp.status === 'fulfilled') updateEspDot(esp.value);
  }, 10000);
}

async function openGhostMode() {
  if (!devPlayerId) { toast('Not logged in', true); return; }
  const zones = await API('/zones');
  if (!Array.isArray(zones) || !zones.length) { toast('Could not load zones', true); return; }

  const modal = document.getElementById('ghost-modal');
  const select = document.getElementById('ghost-zone-select');
  const filter = document.getElementById('ghost-zone-filter');

  const sorted = [...zones].sort((a, b) => a.name.localeCompare(b.name));

  function populateSelect(list) {
    select.innerHTML = list.map(z =>
      `<option value="${z.id}">${z.name} [${z.id}]</option>`
    ).join('');
  }
  populateSelect(sorted);
  filter.value = '';
  filter.oninput = () => {
    const q = filter.value.toLowerCase();
    populateSelect(q ? sorted.filter(z => z.name.toLowerCase().includes(q) || z.id.toLowerCase().includes(q)) : sorted);
  };
  filter.onkeydown = e => {
    if (e.key === 'Escape') closeGhostModal();
    if (e.key === 'Enter') confirmGhostMode();
  };

  modal.style.display = 'flex';
  filter.focus();
}

async function confirmGhostMode() {
  const select = document.getElementById('ghost-zone-select');
  const zoneId = select.value;
  if (!zoneId) { toast('Select a zone first', true); return; }
  closeGhostModal();
  openGhostDialog(zoneId);
}

function closeGhostModal() {
  document.getElementById('ghost-modal').style.display = 'none';
}

function showPlayButton() {
  const btn = document.getElementById('play-btn');
  if (btn) btn.style.display = '';
}

async function launchPlayerClient() {
  if (!token) { toast('Not logged in', true); return; }
  try {
    const res = await API('/auth/gen-switch-token', 'POST');
    if (res.error) { toast(res.error, true); return; }
    sessionStorage.setItem('game-switch-token', res.token);
    window.location.href = '/';
  } catch (err) {
    toast('Failed to generate switch token', true);
  }
}

// --- Staging ---

