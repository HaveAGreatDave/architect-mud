// Incidents panel — the authored catalogue behind plugins/unrest.
//
// A row here is a THING THAT CAN HAPPEN in a city block, never a thing that is
// happening. The live side — what is standing right now, and why nothing is —
// lives on the Unrest panel and is directAPI. This one is authored content and
// goes through API() so it is staged like everything else; picking the wrong one
// either silently stages an operator action or bypasses review on content.
//
// The stage vocabulary is a registry in the plugin, not a list here, so the
// picker below is a discoverability aid rather than a whitelist. An unregistered
// step name fails the regression suite, which is the real gate.

const INCIDENT_STEP_HELP = {
  gossip: "gossip — a street rumour. { do:'gossip', text:'...' }",
  news: "news — one bulletin on the wire, in the Ascendant register. { do:'news', text:'...', priority:'critical' }",
  graffiti: "graffiti — a tag on a wall, by nobody. { do:'graffiti', text:'...', author:'nobody' }",
  ambient: "ambient — overrides the room's own lines while it stands. { do:'ambient', lines:['...'] }",
  sound: "sound — a noise that carries off the block. { do:'sound', text:'...', loudness:6 }",
  hostile: "hostile — real enemies, warned first. { do:'hostile', enemy:'enemy_id', count:3, warn:'...' }",
  checkpoint: "checkpoint — a real gate on one street. { do:'checkpoint', guards:'...', checks:['wanted'], wantedMode:'bluff' }",
  esp: "esp — the citywide emergency protocol. Only one incident may ever hold it. { do:'esp', message:'...' }",
};

function _incidentEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function incidentEditForm(rec, isNew) {
  const stage = Array.isArray(rec.stage) ? rec.stage : (rec.stage ? JSON.parse(rec.stage) : []);
  const flags = (rec.flags && typeof rec.flags === 'object') ? rec.flags : (rec.flags ? JSON.parse(rec.flags) : {});
  const sel = (v, opts) => opts.map(o =>
    `<option value="${o[0]}" ${String(v) === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('');
  const help = Object.values(INCIDENT_STEP_HELP)
    .map(h => `<div style="margin-bottom:2px">${_incidentEsc(h)}</div>`).join('');

  return `
    <div class="field"><label>Incident ID</label>
      <input id="f-id" value="${isNew ? '' : _incidentEsc(rec.id)}" ${!isNew ? 'readonly style="opacity:0.5"' : ''} placeholder="incident_wall_writing"></div>
    <div class="field"><label>Name</label>
      <input id="f-name" value="${_incidentEsc(rec.name || '')}" placeholder="Somebody has been at the walls"></div>
    <div class="field"><label>Description — why this exists, for the next person</label>
      <textarea id="f-description" rows="2">${_incidentEsc(rec.description || '')}</textarea></div>

    <div class="field"><label>Staged by</label>
      <select id="f-writes">${sel(rec.writes || 'heat', [
        ['heat', 'heat — the resident insurgency (the Long Watch)'],
        ['grip', 'grip — the authority (the Ascendants)'],
      ])}</select>
      <div style="font-size:11px;color:var(--text-dim);margin-top:4px">
        Nothing may stage in a cell that has not carried a perceivable signal <b>from this same
        order</b> in the last six hours. That is what makes a checkpoint read as the reply to
        yesterday's graffiti rather than as spawn noise.
      </div>
    </div>

    <div class="field"><label>Lowest band it may stage at</label>
      <select id="f-min_band">${sel(rec.min_band || 'watchful', [
        ['watchful', 'watchful — the first thing a block does'],
        ['tense', 'tense'],
        ['flashpoint', 'flashpoint — the top, and rare'],
      ])}</select></div>

    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:120px"><label>Weight</label>
        <input id="f-weight" type="number" min="1" value="${Number(rec.weight) || 10}"></div>
      <div class="field" style="flex:1;min-width:120px"><label>Duration (min)</label>
        <input id="f-duration_min" type="number" min="1" value="${Number(rec.duration_min) || 60}"></div>
      <div class="field" style="flex:1;min-width:120px"><label>Cooldown per cell (min)</label>
        <input id="f-cooldown_min" type="number" min="0" value="${Number(rec.cooldown_min) || 240}"></div>
    </div>

    <div class="field"><label>Stage — ordered steps, run in order and torn down in reverse</label>
      <textarea id="f-stage" rows="10" placeholder='[{"do":"ambient","lines":["..."]}]'>${_incidentEsc(JSON.stringify(stage, null, 2))}</textarea>
      <div style="font-size:11px;color:var(--text-dim);margin-top:6px">
        ${help}
        <div style="margin-top:6px"><b>{place}</b> is the only token, and it resolves to a part of
        town given by orientation — "the north end", "the west side". Never write a district or a
        building name into a line: a named place invites a mental map with a status per name, which
        is one step from the readout the design bans.</div>
      </div>
    </div>

    <div class="field"><label>Flags</label>
      <textarea id="f-flags" rows="2" placeholder="{}">${_incidentEsc(JSON.stringify(flags))}</textarea></div>

    <div class="field"><label>Enabled</label>
      <select id="f-enabled">${sel(rec.enabled === 0 ? '0' : '1', [['1', 'Yes'], ['0', 'No']])}</select></div>`;
}

async function saveIncident(existing) {
  const isNew = !existing?.id;
  let stage = [], flags = {};
  try { stage = JSON.parse(document.getElementById('f-stage').value || '[]'); }
  catch { toast('Stage: invalid JSON', true); return null; }
  try { flags = JSON.parse(document.getElementById('f-flags').value || '{}'); }
  catch { toast('Flags: invalid JSON', true); return null; }
  if (!Array.isArray(stage) || !stage.length) { toast('Stage must be a non-empty array of steps', true); return null; }
  const bad = stage.find(s => !s || typeof s.do !== 'string');
  if (bad) { toast('Every stage step needs a "do"', true); return null; }
  const unknown = stage.map(s => s.do).filter(d => !(d in INCIDENT_STEP_HELP));
  if (unknown.length && !confirm(`These steps are not in the known vocabulary: ${unknown.join(', ')}. Save anyway?`)) return null;

  const body = {
    name: document.getElementById('f-name').value || 'Untitled Incident',
    description: document.getElementById('f-description').value || '',
    writes: document.getElementById('f-writes').value,
    min_band: document.getElementById('f-min_band').value,
    weight: Number(document.getElementById('f-weight').value) || 10,
    duration_min: Number(document.getElementById('f-duration_min').value) || 60,
    cooldown_min: Number(document.getElementById('f-cooldown_min').value) || 240,
    stage,
    flags,
    enabled: Number(document.getElementById('f-enabled').value),
  };
  let res;
  if (isNew) {
    body.id = document.getElementById('f-id').value.trim() || undefined;
    res = await API('/incidents', 'POST', body);
  } else {
    res = await API(`/incidents/${existing.id}`, 'PUT', body);
  }
  // The engine cannot import a plugin, so the write does not reload the plugin's
  // in-memory catalogue. This does, and it is the only route that knows how.
  try { await directAPI('/unrest/reload', 'POST', {}); } catch { /* the sim picks it up on the next boot */ }
  return res;
}
