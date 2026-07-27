// Script Triggers panel — the event→script binding editor.
// Server side: server/engine/script-triggers.js + /api/script-triggers.
//
// The event field is free text (any events.js name works, including one a plugin
// adds tomorrow); the datalist below is a discoverability aid, not a whitelist.

// Every event name currently emitted anywhere in server/ or plugins/, grouped so
// the picker reads as a menu of authoring opportunities rather than a wall.
const TRIGGER_EVENT_CATALOG = {
  'Movement & world': ['zone.entered', 'zone.broadcast', 'door.toggled', 'posture.changed', 'environment.dayRollover', 'environment.timeSet', 'tick.minute'],
  'Items & credits': ['item.taken', 'item.dropped', 'item.given', 'item.granted', 'item.removed', 'item.equipped', 'item.unequipped', 'inventory.changed', 'credits.changed', 'vendor.purchase'],
  'Player state': ['player.login', 'player.logout', 'player.death', 'player.respawn', 'player.spoke', 'player.command', 'player.stop', 'player.drugUsed', 'appearance.changed', 'stance.changed', 'ip.roll', 'party.changed'],
  'Combat & crime': ['enemy.killed', 'npc.killed', 'npc.attacked', 'player.attacked', 'crime.witnessed', 'theft.caught', 'shoplifting.caught', 'breakin.attempt', 'hololock.breached', 'burglary.reported', 'police.dispatch', 'hack.success'],
  'Quests & flags': ['quest.started', 'quest.advanced', 'quest.completed', 'quest.abandoned', 'flag.set', 'flag.cleared', 'accolade.unlocked'],
  'Weather': ['weather.event', 'weather.lightningStrike', 'weather.thunder', 'weather.zoneAmbience'],
  'Flight': ['flight.crashed', 'flight.aaFired', 'flight.aaSilenced', 'flight.aaRepaired', 'flight.strafeIncoming'],
  'Social & misc': ['npc.gift', 'gossip.housing', 'gossip.bigBuy', 'gossip.pokerWin', 'atm.jacked', 'atm.drained', 'device.power.changed', 'device.tuned', 'camera.recorded', 'corp.asset.claimed', 'sports.game', 'sports.champion'],
};

// Events whose payload carries no player. A trigger on one of these can still
// run world-scope work, but `say`, `once` and player-scope conditions have no
// actor to act on — worth saying out loud rather than debugging later.
const ACTORLESS_EVENTS = new Set([
  'tick.minute', 'environment.dayRollover', 'environment.timeSet', 'weather.event',
  'weather.thunder', 'weather.lightningStrike', 'weather.zoneAmbience', 'door.toggled',
  'sports.game', 'sports.champion', 'police.dispatch', 'broadcast.message',
]);

async function triggerEditForm(rec, isNew) {
  let scripts = [];
  try { scripts = await API('/scripts'); } catch { scripts = []; }
  const scriptOpts = ['<option value="">— pick a script —</option>', ...scripts.map(s =>
    `<option value="${s.id}" ${s.id === rec.script_id ? 'selected' : ''}>${s.name} (${s.id})</option>`)].join('');
  const dataOpts = Object.entries(TRIGGER_EVENT_CATALOG).map(([group, evts]) =>
    evts.map(e => `<option value="${e}">${group}</option>`).join('')).join('');
  const conds = Array.isArray(rec.conditions) ? rec.conditions : (rec.conditions ? JSON.parse(rec.conditions) : []);
  const params = (rec.params && typeof rec.params === 'object') ? rec.params : (rec.params ? JSON.parse(rec.params) : {});

  return `
    <div class="field"><label>Trigger ID</label><input id="f-id" value="${isNew ? '' : rec.id}" ${!isNew ? 'readonly style="opacity:0.5"' : ''} placeholder="trigger_my_thing"></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name || ''}" placeholder="First visit to the Slagworks"></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="2">${rec.description || ''}</textarea></div>

    <div class="field"><label>When this event fires</label>
      <input id="f-event" list="trigger-events" value="${rec.event || ''}" placeholder="zone.entered" oninput="triggerActorHint()">
      <datalist id="trigger-events">${dataOpts}</datalist>
      <div id="trigger-actor-hint" style="font-size:11px;color:var(--text-dim);margin-top:4px"></div>
    </div>
    <div class="field"><label>Run this script</label><select id="f-script_id">${scriptOpts}</select></div>

    <div class="field"><label>Only in zone (blank = anywhere)</label>
      <input id="f-zone_id" value="${rec.zone_id || ''}" placeholder="zone_slagworks_gate"></div>
    <div class="field"><label>Conditions (flag gates, ANDed)</label>
      <textarea id="f-conditions" rows="3" placeholder='[{"flag":"met_grady","scope":"player","op":"set"}]'>${JSON.stringify(conds)}</textarea></div>
    <div class="field"><label>Params — fill the script's <code>\${tokens}</code></label>
      <textarea id="f-params" rows="3" placeholder='{"venue":"pigeon","drink":"item_drink_basin_swill"}'>${JSON.stringify(params)}</textarea>
      <div style="font-size:11px;color:var(--text-dim);margin-top:4px">One authored script, one row per instance: a graph whose flag reads <code>bar_\${venue}_visits</code> tracks a different bar per trigger.<br>
      Always supplied: <code>\${zone}</code>, and the event payload as dotted paths — <code>\${event.delta}</code>, <code>\${event.item.name}</code>, <code>\${event.actor.handle}</code>. A counter's <code>delta</code> takes one too, so it can total a value instead of counting events.</div></div>

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:110px"><label>Cooldown (s)</label>
        <input id="f-cooldown_seconds" type="number" min="0" value="${rec.cooldown_seconds ?? 0}"></div>
      <div class="field" style="flex:1;min-width:110px"><label>Chance (0–1)</label>
        <input id="f-chance" type="number" min="0" max="1" step="0.05" value="${rec.chance ?? 1}"></div>
      <div class="field" style="flex:1;min-width:110px"><label>Once per player</label>
        <select id="f-once"><option value="0" ${!rec.once ? 'selected' : ''}>no</option><option value="1" ${rec.once ? 'selected' : ''}>yes</option></select></div>
      <div class="field" style="flex:1;min-width:110px"><label>Enabled</label>
        <select id="f-enabled"><option value="1" ${rec.enabled !== 0 ? 'selected' : ''}>yes</option><option value="0" ${rec.enabled === 0 ? 'selected' : ''}>no</option></select></div>
    </div>
  `;
}

// Warn when the chosen event has no player in its payload — `say`, `once` and
// player-scope conditions silently do nothing there.
function triggerActorHint() {
  const el = document.getElementById('trigger-actor-hint');
  const evt = document.getElementById('f-event')?.value?.trim();
  if (!el) return;
  el.innerHTML = ACTORLESS_EVENTS.has(evt)
    ? '⚠ This event carries no player — <code>say</code>, "once per player" and player-scope conditions will not apply. World-scope flags still work.'
    : '';
}

async function saveScriptTrigger(existing) {
  const isNew = !existing?.id;
  let conditions = [], params = {};
  try { conditions = JSON.parse(document.getElementById('f-conditions').value || '[]'); }
  catch { toast('Conditions: invalid JSON', true); return null; }
  try { params = JSON.parse(document.getElementById('f-params').value || '{}'); }
  catch { toast('Params: invalid JSON', true); return null; }

  const body = {
    name: document.getElementById('f-name').value || 'Untitled Trigger',
    description: document.getElementById('f-description').value || '',
    event: document.getElementById('f-event').value.trim(),
    script_id: document.getElementById('f-script_id').value,
    zone_id: document.getElementById('f-zone_id').value.trim() || null,
    conditions,
    params,
    cooldown_seconds: Number(document.getElementById('f-cooldown_seconds').value) || 0,
    chance: Number(document.getElementById('f-chance').value),
    once: Number(document.getElementById('f-once').value),
    enabled: Number(document.getElementById('f-enabled').value),
  };
  if (!body.event || !body.script_id) { toast('Event and script are both required', true); return null; }
  if (isNew) { body.id = document.getElementById('f-id').value.trim() || undefined; return API('/script-triggers', 'POST', body); }
  return API(`/script-triggers/${existing.id}`, 'PUT', body);
}
