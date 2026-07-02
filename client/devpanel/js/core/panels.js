
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
  gossip: {
    title: 'Gossip Pool',
    description: 'Live in-memory gossip — strongest (most recent + credible) first. Read-only; the pool clears on server restart.',
    noEdit: true,
    fetch: () => API('/gossip'),
    columns: [
      { key: 'strength', label: 'Str', render: v => (v ?? 0).toFixed(3) },
      { key: 'category', label: 'Category' },
      { key: 'subject', label: 'Subject' },
      { key: 'zone', label: 'Zone' },
      { key: 'text', label: 'On the street', render: v => `<span style="color:var(--text-dim)">${v || ''}</span>` },
      { key: 'reach', label: 'Reach' },
      { key: 'planted', label: 'Planted', render: v => v ? '🗣' : '' },
      { key: 'truth', label: 'Truth', render: v => v == null ? '' : Number(v).toFixed(2) },
      { key: 'age_s', label: 'Age', render: v => v >= 60 ? `${Math.floor(v / 60)}m ${v % 60}s` : `${v}s` },
    ],
  },
  zones: {
    title: 'Zones',
    description: 'Edit room descriptions, exits, danger ratings, and zone properties.',
    idPrefix: 'zone',
    fetch: () => API('/zones'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'id', label: 'Zone ID', render: v => `<code style="font-size:11px;color:var(--text-dim)">${v}</code>` },
      { key: 'danger_rating', label: 'Danger', render: v => `<span class="badge badge-${v}">${v}</span>` },
      { key: 'pvp_enabled', label: 'PvP', render: v => v ? '<span class="badge badge-pvp">PvP</span>' : '' },
      { key: 'player_count', label: 'Players' },
      { key: 'exits', label: 'Exits', render: v => typeof v === 'object' ? Object.keys(v||{}).join(', ') : '' },
    ],
    editForm: zoneEditForm,
    save: saveZone,
    delete: id => API(`/zones/${id}`, 'DELETE'),
    render: () => renderZonesTable(allRecords),
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
      { key: 'rarity', label: 'Rarity' },
      { key: 'radiation_threshold', label: 'Rad. Threshold' },
    ],
    editForm: mutationEditForm,
    save: saveMutation,
    delete: id => API(`/mutations/${id}`, 'DELETE'),
  },
  drugs: {
    title: 'Drugs',
    description: 'Consumable substances with timed stat effects, addiction, and overdose thresholds.',
    idPrefix: 'drug',
    fetch: () => API('/drugs'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'duration_seconds', label: 'Duration (s)' },
      { key: 'addiction_chance', label: 'Addiction %', render: v => `${Math.round((v||0)*100)}%` },
      { key: 'overdose_threshold', label: 'OD Threshold' },
    ],
    editForm: drugEditForm,
    save: saveDrug,
    delete: id => API(`/drugs/${id}`, 'DELETE'),
  },
  crimes: {
    title: 'Crimes',
    description: 'Wanted-star weight per crime. Stars are additive and capped at 5. Click a crime to tune how many stars it adds; a camera that catches a crime flashes red and calls the suspect out to the room.',
    idPrefix: 'crime',
    fetch: () => API('/crimes'),
    columns: [
      { key: 'label', label: 'Crime' },
      { key: 'stars', label: 'Stars', render: v => `<span class="text-red">${'★'.repeat(Math.floor(v))}${(v%1)>=0.5?'½':''}</span> <span style="color:var(--text-dim)">(${v})</span>` },
      { key: 'witness', label: 'Caught by', render: v => v==='camera'?'📷 camera only':v==='always'?'always':'any witness' },
      { key: 'is_default', label: 'Source', render: v => v ? '<span style="color:var(--text-dim);font-size:11px">default</span>' : '<span style="color:var(--accent);font-size:11px">custom</span>' },
    ],
    editForm: crimeEditForm,
    save: saveCrime,
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
    fetch: () => Promise.all([API('/audio/instruments'), API('/audio/songs'), API('/audio/sfx'), API('/audio/ambient'), API('/audio/events'), API('/audio/samples')])
      .then(([instruments, songs, sfx, ambient, events, samples]) => ({ instruments, songs, sfx, ambient, events, samples })),
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
    fetch: () => API('/quests'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'id', label: 'Quest ID', render: v => `<code style="font-size:11px;color:var(--text-dim)">${v}</code>` },
      { key: 'objectives', label: 'Objectives', render: v => (Array.isArray(v) ? v : JSON.parse(v||'[]')).length },
      { key: 'repeatable', label: 'Repeatable', render: v => v ? '↻' : '' },
    ],
    editForm: questEditForm,
    save: saveQuest,
    delete: id => API(`/quests/${id}`, 'DELETE'),
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
  vine: {
    title: 'VINE Suite',
    description: 'Every VINE graph in the game — dialogue, behaviour, scripts, broadcasts, quests — reachable from one hub.',
    fetch: fetchVineSuite,
    noEdit: true,
    render: renderVineSuite,
  },
  maps: {
    title: 'Maps',
    description: 'Visual layout editor for connected zone maps.',
    fetch: () => API('/maps'),
    render: renderMapsPanel,
    noEdit: true,
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
    title: 'Emergency',
    description: 'Configure emergency alert tiers, broadcast triggers, and server-wide response protocols.',
    fetch: () => directAPI('/emergency/state'),
    noEdit: true,
    render: renderEmergencyPanel,
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

function activatePanelNav(name) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.panel === name));
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
  document.getElementById('new-btn').style.display = p.noEdit || name === 'worldstate' || name === 'players' || name === 'crimes' ? 'none' : '';

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

