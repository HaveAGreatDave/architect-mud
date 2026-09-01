
// Panel management
const PANELS = {
  dashboard: {
    title: 'Dashboard',
    description: 'Live server status, active players, and world health at a glance.',
    fetch: async () => {
      const [world, env] = await Promise.all([API('/world/state'), API('/environment/state')]);
      if (env && !env.error) window._lastEnv = env;
      return { ...world, _env: env };
    },
    noEdit: true,
    render: renderDashboard,
  },
  devlog: {
    title: 'Dev Log',
    description: 'Team heads-ups and recent code activity. Post important changes (server restarts, migrations, content scripts) so the next dev checking in sees them, alongside a feed of recent commits by author.',
    noEdit: true,
    fetch: async () => {
      const [notes, activity, ids, contrib] = await Promise.all([directAPI('/dev/notes'), directAPI('/dev/activity'), directAPI('/dev/identities'), directAPI('/dev/contributions')]);
      return { notes: notes?.notes || [], commits: activity?.commits || [],
               needsSync: !!(activity?.needsSync || contrib?.needsSync),
               syncedThrough: activity?.syncedThrough || null,
               routeError: (activity?.error || contrib?.error || (notes?.error && notes.error)) || null,
               identities: ids?.identities || [], players: ids?.players || [], contributions: contrib?.ranges || null };
    },
    render: renderDevLog,
  },
  gossip: {
    title: 'Gossip Pool',
    description: 'Live in-memory gossip — strongest (most recent + credible) first. Spread a rumour as any NPC; the pool clears on server restart.',
    noEdit: true,
    fetch: () => API('/gossip'),
    render: renderGossip,
  },
  cards: {
    title: 'Trading Cards',
    description: 'Every struck card — players who minted themselves, plus the NPC and enemy cards cut from world content when a series opened. Edit rarity, pool weight and the three text blocks; the character counters enforce the budgets, because a card must never truncate. NPC flavour overrides (flags.card_quote / card_note / card_rarity) live on the NPC row, in the NPCs panel.',
    idPrefix: 'card',
    fetch: async () => {
      _cardQuery = '';   // a stale query from the last visit would hide the list
      const r = await API('/cards');
      if (r?.budgets) _cardBudgets = { ...(_cardBudgets), ...r.budgets };
      if (Array.isArray(r?.ranks)) _cardRanks = r.ranks;
      return r?.cards || [];
    },
    columns: [
      { key: 'subject_name', label: 'Subject' },
      { key: 'subject_type', label: 'Type' },
      { key: 'rarity', label: 'Rarity' },
      { key: 'power', label: 'Power' },
      { key: 'pool_weight', label: 'Pool' },
    ],
    editForm: cardEditForm,
    save: saveCard,
    delete: id => API(`/cards/${id}`, 'DELETE'),
    // renderCardsTable RETURNS markup (the toolbar/empty-state share it), so the
    // panel hook has to place it — a render() that only returns leaves an empty body.
    render: () => { document.getElementById('list-panel').innerHTML = renderCardsTable(allRecords); },
    // Own the search, or `filterTable` falls back to the generic five-column
    // table above and throws this panel's shape (and its sort) away.
    filter: filterCards,
  },
  zones: {
    title: 'Zones',
    description: 'Edit room descriptions, exits, danger ratings, and zone properties.',
    idPrefix: 'zone',
    fetch: () => API('/zones'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'id', label: 'Zone ID', render: v => `<code style="font-size:11px;color:var(--text-dim)">${v}</code>` },
      { key: 'danger', label: 'Danger', render: v => `<span class="badge badge-${v}">${v}</span>` },
      { key: 'pvp_enabled', label: 'PvP', render: v => v ? '<span class="badge badge-pvp">PvP</span>' : '' },
      { key: 'player_count', label: 'Players' },
      { key: 'exits', label: 'Exits', render: v => typeof v === 'object' ? Object.keys(v||{}).join(', ') : '' },
    ],
    editForm: zoneEditForm,
    save: saveZone,
    delete: id => API(`/zones/${id}`, 'DELETE'),
    render: () => renderZonesTable(allRecords),
    filter: filterZones,
  },
  enemies: {
    title: 'Enemies',
    description: 'Define enemy stats, behaviour trees, attack patterns, and loot tables.',
    idPrefix: 'enemy',
    fetch: () => API('/enemies'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'hp_max', label: 'HP' },
      { key: 'hit', label: 'Hit' },
      { key: 'dodge', label: 'Dodge' },
      { key: 'behavior', label: 'Behavior' },
    ],
    editForm: enemyEditForm,
    save: saveEnemy,
    delete: id => API(`/enemies/${id}`, 'DELETE'),
    render: renderEnemiesPanel,
    filter: filterEnemies,
  },
  items: {
    title: 'Items',
    description: 'Create and edit weapons, armour, consumables, and world objects.',
    idPrefix: 'item',
    fetch: () => API('/items'),
    render: renderItemsPanel,
    filter: filterItems,
    editForm: itemEditForm,
    save: saveItem,
    delete: id => API(`/items/${id}`, 'DELETE'),
  },
  npcs: {
    title: 'NPCs',
    description: 'Configure named characters — dialogue, faction, schedules, and AI.',
    idPrefix: 'npc',
    fetch: () => API('/npcs'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'zone_id', label: 'Zone' },
      { key: 'faction', label: 'Faction' },
      { key: '_work_status', label: 'Work Status', render: v => v || '—' },
    ],
    render: renderNpcsPanel,
    editForm: npcEditForm,
    save: saveNpc,
    delete: id => API(`/npcs/${id}`, 'DELETE'),
  },
  furniture: {
    title: 'Furniture',
    description: 'Interactive objects placed in zones — terminals, vendors, seats, and more.',
    idPrefix: 'furniture',
    fetch: () => Promise.all([API('/furniture'), API('/zones')]).then(([f, z]) => ({ furniture: Array.isArray(f) ? f : [], zones: Array.isArray(z) ? z : [] })),
    render: renderFurniturePanel,
    filter: filterFurniture,
    editForm: furnitureEditForm,
    save: saveFurniture,
    delete: id => API(`/furniture/${id}`, 'DELETE'),
  },
  mutations: {
    title: 'Mutations',
    description: 'Radiation-triggered biological modifications that alter player stats and abilities.',
    idPrefix: 'mutation',
    fetch: () => API('/mutations'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'polarity', label: 'Polarity', render: v => `<span class="badge badge-${v==='positive'?'safe-zone':v==='negative'?'lethal':'medium'}">${v}</span>` },
      { key: 'visible', label: 'Visible', render: v => v ? '👁' : '' },
      { key: 'radiation_threshold', label: 'Rad. Threshold' },
    ],
    editForm: mutationEditForm,
    save: saveMutation,
    delete: id => API(`/mutations/${id}`, 'DELETE'),
  },
  // Three tables, one editor — a dream room and a hallucination room are the same
  // kind of thing, kept apart by the `cause` label. See docs/systems-dreams.md.
  //
  // All three are ONE nav entry (🌒 Unreality) with two tabs, and the active
  // PANELS entry IS the tab — see renderDreamSuite in panels/dreams.js. Each keeps
  // its own columns/editForm/save/delete so the generic machinery is untouched;
  // only the list rendering is shared. `hideNewBtn` because the toolbar's single
  // + New can't say which of two tables on screen it means — each section has its own.
  dream_templates: {
    title: 'Dream Rooms',
    description: 'Rooms for the experiences a player can be put inside — a sleep dream, or a dissociative hallucination. Not zones: they have no coordinates and no place on any map.',
    idPrefix: 'dt',
    fetch: () => dreamSuiteFetch('dream_templates'),
    columns: [
      { key: 'name', label: 'Room' },
      { key: 'cause', label: 'Cause', render: (_v, r) => causeBadge(r) },
      { key: 'objects', label: 'Objects', render: v => (Array.isArray(v) ? v.length : 0) },
      { key: 'ambient', label: 'Ambient', render: v => (Array.isArray(v) ? v.length : 0) },
    ],
    render: renderDreamSuite,
    filter: renderDreamSuite,
    hideNewBtn: true,
    editForm: dreamTemplateEditForm,
    save: saveDreamTemplate,
    delete: id => API(`/dream-templates/${encodeURIComponent(id)}`, 'DELETE'),
  },
  dream_presences: {
    title: 'Dream Presences',
    description: 'The wandering figure that moves between the rooms of an instance. It is announced arriving and leaving, and never resolves into anything.',
    idPrefix: 'dp',
    fetch: () => dreamSuiteFetch('dream_presences'),
    columns: [
      { key: 'name', label: 'Presence' },
      { key: 'cause', label: 'Cause', render: (_v, r) => causeBadge(r) },
      { key: 'looks', label: 'Looks', render: v => (Array.isArray(v) ? v.length : 0) },
    ],
    render: renderDreamSuite,
    filter: renderDreamSuite,
    hideNewBtn: true,
    editForm: dreamPresenceEditForm,
    save: saveDreamPresence,
    delete: id => API(`/dream-presences/${encodeURIComponent(id)}`, 'DELETE'),
  },
  drug_transforms: {
    title: 'Drug Transforms',
    description: 'What a psychedelic turns the real furniture around you into. Live world, per-viewer — these never build a room.',
    idPrefix: 'dx',
    fetch: () => dreamSuiteFetch('drug_transforms'),
    columns: [
      { key: 'name', label: 'Becomes' },
      { key: 'drug_id', label: 'Drug', render: v => `<span class="badge badge-medium">${v || 'default set'}</span>` },
      { key: 'matches', label: 'Only on', render: v => v || '<span class="text-dim">anything</span>' },
      { key: 'says', label: 'Says', render: v => (Array.isArray(v) ? v.length : 0) },
    ],
    render: renderDreamSuite,
    filter: renderDreamSuite,
    hideNewBtn: true,
    editForm: drugTransformEditForm,
    save: saveDrugTransform,
    delete: id => API(`/drug-transforms/${encodeURIComponent(id)}`, 'DELETE'),
  },
  drugs: {
    title: 'Drugs',
    description: 'Consumable substances with timed stat effects, addiction, and overdose thresholds.',
    idPrefix: 'drug',
    fetch: () => API('/drugs'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'duration_seconds', label: 'Duration (s)' },
      // Not a probability — an additive step toward the 0.5 addiction threshold, so
      // 0.6 means hooked on the first dose. Superseded by effects.withdrawal.addiction_per_dose.
      { key: 'addiction_chance', label: 'Addiction/dose', render: v => (v || 0).toFixed(2) },
      { key: 'overdose_threshold', label: 'OD Threshold' },
    ],
    editForm: drugEditForm,
    save: saveDrug,
    delete: id => API(`/drugs/${id}`, 'DELETE'),
  },
  aliases: {
    title: 'Aliases',
    description: 'Verb shortcuts. The typed shortcut is rewritten to its canonical verb before the command runs — invisible to players. Engine-shipped defaults can be overridden; deleting an override restores the default.',
    fetch: () => API('/command-aliases'),
    noEdit: true,
    render: renderAliasesPanel,
  },
  sounds: {
    title: 'SoundScript',
    description: 'Named audio-text sound effects and ambient text events broadcast by zone theme.',
    fetch: () => Promise.all([API('/sounds'), API('/ambient-events')]).then(([s, a]) => ({ sounds: s, ambients: a })),
    noEdit: true,
    render: renderSoundsPanel,
  },
  audio: {
    title: 'Audio',
    description: 'Music instruments, songs, SFX clips, ambient tracks, and audio event bindings.',
    fetch: () => Promise.all([API('/audio/instruments'), API('/audio/songs'), API('/audio/sfx'), API('/audio/ambient'), API('/audio/events'), API('/audio/samples'), API('/audio/interface-sfx')])
      .then(([instruments, songs, sfx, ambient, events, samples, interfaceSfx]) => ({ instruments, songs, sfx, ambient, events, samples, interfaceSfx })),
    noEdit: true,
    render: renderAudioPanel,
  },
  tags: {
    title: 'Tag Catalog',
    description: 'Property tags that attach behaviours and rules to items, zones, and entities.',
    fetch: async () => ({ catalog: await API('/tag-catalog'), supertags: await API('/tag-supertags') }),
    noEdit: true,
    render: renderTagsPanel,
  },
  recipes: {
    title: 'Recipes',
    description: 'Crafting recipes linking ingredient items to output items, with skill and station requirements.',
    idPrefix: 'recipe',
    fetch: () => API('/recipes'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'skill_id', label: 'Skill' },
      { key: 'base_difficulty', label: 'Difficulty' },
      { key: 'requires_station', label: 'Station' },
    ],
    editForm: recipeEditForm,
    save: saveRecipe,
    delete: id => API(`/recipes/${id}`, 'DELETE'),
  },
  'mis-fit': {
    title: 'MIS Fit Lines',
    description: 'Authored prose for the fit model — what the room and both parties read when a size lands in each band. Blank pools fall back to the ordinary act text.',
    idPrefix: 'misfit',
    noEdit: true,
    fetch: misFitFetch,
    columns: [],
  },
  scavenging: {
    title: 'Scavenging Tables',
    description: 'Reusable loot templates for the scavenge action. Attach one to a zone from the zone editor (Scavenging section); per-zone stock is tracked automatically.',
    idPrefix: 'scav',
    fetch: () => API('/scavenging-tables'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'id', label: 'Table ID', render: v => `<code style="font-size:11px;color:var(--text-dim)">${v}</code>` },
      { key: 'entry_count', label: 'Items' },
      { key: 'zone_count', label: 'Zones' },
      { key: 'replenish_interval_seconds', label: 'Replenish', render: v => `${Math.round((v||0)/60)}m` },
    ],
    editForm: scavengingEditForm,
    save: saveScavengingTable,
    delete: id => API(`/scavenging-tables/${id}`, 'DELETE'),
  },
  quests: {
    title: 'Quests',
    description: 'Multi-step player objectives with triggers, conditions, and rewards.',
    idPrefix: 'quest',
    // Hide auto-generated 'flight' contract instances by default — they're ephemeral
    // board postings (plugins/flight/contracts.js topUp), not authored content. Their
    // 'flight_template' archetypes (and ordinary/jobboard quests) still show.
    fetch: () => API('/quests').then(rows => (Array.isArray(rows) ? rows : []).filter(r => r.quest_type !== 'flight')),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'id', label: 'Quest ID', render: v => `<code style="font-size:11px;color:var(--text-dim)">${v}</code>` },
      { key: 'quest_type', label: 'Type', render: v => v === 'flight_template' ? '✈ Flight Template' : 'Standard' },
      { key: 'objectives', label: 'Objectives', render: v => (Array.isArray(v) ? v : JSON.parse(v||'[]')).length },
      { key: 'repeatable', label: 'Repeatable', render: v => v ? '↻' : '' },
    ],
    editForm: questEditForm,
    save: saveQuest,
    delete: id => API(`/quests/${id}`, 'DELETE'),
  },
  jobBoards: {
    title: 'Job Boards',
    description: 'Rotating job boards (jobboard plugin): pick which repeatable quests a zone posts as legal early-money gigs, and how many rotate / how often.',
    idPrefix: 'board',
    fetch: () => API('/job-boards'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'zone_id', label: 'Zone', render: v => `<code style="font-size:11px;color:var(--text-dim)">${v}</code>` },
      { key: 'quest_pool', label: 'Pool', render: v => (Array.isArray(v) ? v : JSON.parse(v||'[]')).length },
      { key: 'rotation_size', label: 'Shows' },
      { key: 'rotation_period', label: 'Every', render: v => `${Math.round((v||21600)/3600*10)/10}h` },
    ],
    editForm: jobBoardEditForm,
    save: saveJobBoard,
    delete: id => API(`/job-boards/${id}`, 'DELETE'),
  },
  scripts: {
    title: 'Scripts',
    description: 'VINE behaviour graphs for scripted events, branching dialogue, and quest logic.',
    idPrefix: 'script',
    fetch: () => API('/scripts'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
      { key: 'graph', label: 'Nodes', render: g => Object.keys((typeof g === 'object' ? g : JSON.parse(g||'{}')).nodes || {}).length },
    ],
    editForm: scriptEditForm,
    save: saveScript,
    delete: id => API(`/scripts/${id}`, 'DELETE'),
  },
  'script-triggers': {
    title: 'Script Triggers',
    description: 'Bindings that fire a Script when a game event happens — "on entering this zone, run that graph". The engine ships the channel; every binding is content you author here.',
    idPrefix: 'trigger',
    fetch: () => API('/script-triggers'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'event', label: 'On event' },
      { key: 'script_id', label: 'Runs' },
      { key: 'zone_id', label: 'Zone', render: v => v || '—' },
      { key: 'enabled', label: 'On', render: v => v ? '✓' : '—' },
    ],
    editForm: triggerEditForm,
    save: saveScriptTrigger,
    delete: id => API(`/script-triggers/${id}`, 'DELETE'),
  },
  incidents: {
    title: 'Incidents',
    description: 'The authored catalogue behind Unrest — what CAN happen in a city block, never what is happening. The live side is on the Unrest panel.',
    idPrefix: 'incident',
    fetch: () => API('/incidents'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'writes', label: 'Order', render: v => v === 'grip' ? 'authority' : 'insurgency' },
      { key: 'min_band', label: 'From band' },
      { key: 'weight', label: 'Weight' },
      { key: 'duration_min', label: 'Runs for', render: v => `${v}m` },
      { key: 'stage', label: 'Steps', render: v => (Array.isArray(v) ? v : []).map(s => s.do).join(' → ') || '—' },
      { key: 'enabled', label: 'On', render: v => v ? '✓' : '—' },
    ],
    editForm: incidentEditForm,
    save: saveIncident,
    delete: id => API(`/incidents/${id}`, 'DELETE'),
  },
  vine: {
    title: 'VINE Suite',
    description: 'Every VINE graph in the game — dialogue, behaviour, scripts, broadcasts, quests — reachable from one hub.',
    fetch: fetchVineSuite,
    noEdit: true,
    render: renderVineSuite,
  },
  maps: {
    title: 'Region Maps',
    description: 'Visual layout editor for connected zone maps.',
    fetch: () => API('/maps'),
    render: renderMapsPanel,
    noEdit: true,
  },
  world: {
    title: 'World Map',
    description: 'Every region on the global grid. Create a new region (size + base terrain), jump into one to edit its tiles, or drag to reposition it. Changes are staged.',
    fetch: async () => {
      const [d, m] = await Promise.all([API('/maps/regions'), API('/maps/map_world')]);
      return { regions: d?.regions || [], zones: m?.zones || [] };
    },
    noEdit: true,
    render: renderWorldEditor,
  },
  power: {
    title: 'Power Grid',
    description: 'Manage city power infrastructure and zone power dependencies.',
    fetch: () => API('/maps/map_world').then(d => d?.zones || []),
    render: renderPowerPanel,
    noEdit: true,
  },
  bank: {
    title: 'Bank & ATMs',
    description: 'ATM networks, faction banking, credit limits, and fee configuration.',
    fetch: () => Promise.resolve({}),
    noEdit: true,
    render: renderBankPanel,
  },
  emergency: {
    title: 'Crime',
    description: 'Live crime log, the fine/jail penalty multiplier, per-crime enforcement toggles, the Emergency Security Protocol, and the Arbiter subsystem.',
    fetch: () => directAPI('/emergency/state'),
    noEdit: true,
    render: renderEmergencyPanel,
  },
  unrest: {
    title: 'Unrest',
    description: 'The faction-conflict ledger — grip/heat/pressure per derived city block, the band each is in, the authored role roster, and every live incident. Operator-only by design: none of it reaches the player.',
    fetch: async () => {
      const [state, incidents] = await Promise.all([
        directAPI('/unrest/state'),
        directAPI('/unrest/incidents'),
      ]);
      return { ...state, incidents };
    },
    noEdit: true,
    render: renderUnrestPanel,
  },
  flight: {
    title: 'Flight',
    description: 'Charter-pilot work status, the flight request log, and every aircraft instance (test-flight conjures, player buy/rent, wrecks) — delete stale ones from here.',
    fetch: () => Promise.resolve({}),
    noEdit: true,
    render: renderFlightPanel,
  },
  worldstate: {
    title: 'World State',
    description: 'Live flags and variables governing the world\'s current global state.',
    fetch: () => API('/world/state'),
    render: renderWorldState,
  },
  timeweather: {
    title: 'Time & Weather',
    description: 'Day/night cycle settings, climate profiles, and weather forecasting.',
    fetch: async () => {
      const [env, forecast, climateProfiles] = await Promise.all([
        API('/environment/state'), API('/environment/forecast'), API('/environment/climate/profiles')
      ]);
      return { env, forecast: Array.isArray(forecast) ? forecast : [], climateProfiles: Array.isArray(climateProfiles) ? climateProfiles : [] };
    },
    noEdit: true,
    render: renderTimeWeatherPanel,
  },
  players: {
    title: 'Players',
    description: 'Connected and registered player accounts, character stats, and session data.',
    fetch: () => API('/players'),
    noEdit: true,
    render: renderPlayersPanel,
  },
  games: {
    title: 'Games',
    description: 'Live poker tables — who\'s seated, blind levels, and table recovery.',
    fetch: () => directAPI('/gametable/tables'),
    noEdit: true,
    render: renderGamesPanel,
  },
  validator: {
    title: 'Zone Validator',
    description: 'Cross-reference zones and content for broken exits, missing references, and bad data.',
    fetch: () => Promise.resolve({}),
    noEdit: true,
    render: renderValidatorPanel,
  },
  broadcasts: {
    title: 'Broadcasts',
    description: 'TV channels, schedules, NPC hosts, themes, and live broadcast content.',
    fetch: async () => {
      const [broadcasts, channels, npcs, themes, graphics, zones] = await Promise.all([
        directAPI('/broadcast/broadcasts'),
        directAPI('/broadcast/channels'),
        directAPI('/npcs'),
        directAPI('/broadcast/themes'),
        directAPI('/broadcast/graphics'),
        directAPI('/zones'),
      ]);
      return {
        broadcasts: Array.isArray(broadcasts) ? broadcasts : [],
        channels:   Array.isArray(channels)   ? channels   : [],
        npcs:       Array.isArray(npcs)        ? npcs       : [],
        themes:     Array.isArray(themes)      ? themes     : [],
        graphics:   Array.isArray(graphics)    ? graphics   : [],
        zones:      Array.isArray(zones)       ? zones      : [],
      };
    },
    noEdit: true,
    render: renderBroadcastSuite,
  },
  changes: {
    title: 'Changes',
    description: 'Staged edits awaiting review before publishing to production.',
    fetch: () => API('/staging/pending'),
    noEdit: true,
    render: renderChangesPanel,
  },
};

const VINE_GROUP_PANELS = new Set(['vine', 'scripts', 'script-triggers', 'quests', 'vine-dialogue', 'vine-ai']);

// Ops mode (/admin — see bootstrap.js) carries the SAME sidebar /dev carries:
// nothing is pruned, because the server lets every read through and refuses every
// content write anyway, which makes a content panel on production exactly a viewer.
// They answer the questions a live bug actually raises — why can't they leave this
// room, where is that NPC, what does this item really do — without a DB shell.
//
// What varies is whether a panel can WRITE. These are the panels whose routes are
// on the server's ops allowlist (OPS_ROUTES / ENV_OPS_ROUTES in server/api/routes.js).
// Every other panel is read-only: same default-deny as the server, mirrored here so
// the Save/Delete/New buttons are gone and the reason is stated once, at the top,
// instead of a button firing into a 403.
const OPS_WRITABLE_PANELS = new Set(['dashboard', 'devlog', 'worldstate', 'timeweather', 'players',
                                     'games', 'gossip', 'validator', 'power', 'emergency', 'bank',
                                     'flight', 'cards']);
function opsPanelReadOnly(name) {
  if (!window.OPS_MODE) return false;
  return !OPS_WRITABLE_PANELS.has(NAV_ALIASES[name] || name);
}
const OPS_READONLY_BANNER =
  '<b>READ-ONLY — production.</b> This is world content: it\'s edited on your <b>local</b> dev panel and '
  + 'reaches prod through the CODEX deploy (a push to <code>main</code>). Nothing changed here would save — '
  + 'and if it did, the next deploy would revert it. Live-world actions (spawning an enemy, restocking a '
  + 'vendor) still work.';
// A panel that shares a nav entry with its siblings highlights that entry rather
// than one of its own (the Unreality suite: three panels, one 🌒 row, two tabs).
const NAV_ALIASES = {
  dream_templates: 'dreams', dream_presences: 'dreams', drug_transforms: 'dreams',
};

function activatePanelNav(name) {
  const nav = NAV_ALIASES[name] || name;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.panel === nav));
  const group = document.getElementById('nav-vine-children');
  if (group) group.classList.toggle('open', VINE_GROUP_PANELS.has(name));
}

async function showPanel(name) {
  currentPanel = name;
  sortState = { key: null, dir: 1 };
  activatePanelNav(name);
  closeEdit();
  loadPanel(name);
}

async function loadPanel(name) {
  if (_panelClockTimeout)  { clearTimeout(_panelClockTimeout);   _panelClockTimeout  = null; }
  if (_panelClockInterval) { clearInterval(_panelClockInterval); _panelClockInterval = null; }
  const p = PANELS[name];
  if (!p) return;
  document.getElementById('panel-title').textContent = p.title;
  document.getElementById('panel-description').textContent = p.description || '';
  // Read-only ops panel: banner up, Save/Delete/New hidden (body class → styles.css).
  const readOnly = opsPanelReadOnly(name);
  document.body.classList.toggle('ops-ro-panel', readOnly);
  const banner = document.getElementById('ops-ro-banner');
  if (banner) {
    banner.innerHTML = readOnly ? OPS_READONLY_BANNER : '';
    banner.style.display = readOnly ? '' : 'none';
  }
  document.getElementById('new-btn').style.display = readOnly || p.noEdit || p.hideNewBtn || name === 'worldstate' || name === 'players' ? 'none' : '';

  let data;
  try {
    data = await p.fetch();
  } catch (err) {
    document.getElementById('list-panel').innerHTML = `<div style="padding:24px;color:var(--red)">Error loading panel: ${err.message}</div>`;
    return;
  }

  if (data?.error) {
    document.getElementById('list-panel').innerHTML = `<div style="padding:24px;color:var(--red)">Server error: ${data.error}</div>`;
    return;
  }

  allRecords = Array.isArray(data) ? data : (data.furniture || data.zones || []);

  // Overlay pending staged changes — must happen before any render path so
  // panels with custom renderers (Zones, Maps, Furniture) still reflect staged edits.
  const entityType = STAGED_ENTITY_TYPES[`/${name}`];
  if (stagingEnabled && entityType && pendingChanges.length) {
    const staged = pendingChanges.filter(c => c.entityType === entityType);
    if (staged.length) {
      const stagedById = new Map(staged.map(c => [c.entityId, c]));
      allRecords = allRecords.map(r => {
        const s = stagedById.get(r.id);
        if (!s) return r;
        if (s.changeType === 'update') return { ...r, ...s.stagedData, _stagingStatus: `staged` };
        if (s.changeType === 'delete') return { ...r, _stagingStatus: `pending delete` };
        return r;
      });
      for (const s of staged) {
        if (s.changeType === 'create' && !allRecords.find(r => r.id === s.entityId)) {
          allRecords.unshift({ ...s.stagedData, id: s.entityId, _stagingStatus: `new (staged)` });
        }
      }
    }
  }

  if (p.render) {
    // Pass merged allRecords back into structured data so custom renderers see staged items.
    const mergedData = Array.isArray(data) ? allRecords
      : data.furniture ? { ...data, furniture: allRecords }
      : data;
    p.render(mergedData);
    return;
  }

  // Add a Status column when any rows have a staging status.
  const hasStagedRows = allRecords.some(r => r._stagingStatus);
  const columns = hasStagedRows
    ? [...p.columns, {
        key: '_stagingStatus', label: 'Status',
        render: v => v === 'pending delete'
          ? `<span style="color:var(--danger);font-size:11px">!Marked for Deletion</span>`
          : v ? `<span style="color:var(--warning);font-size:11px">!Not Published</span>` : '',
      }]
    : p.columns;

  renderTable(columns, allRecords, p.noEdit);
}

