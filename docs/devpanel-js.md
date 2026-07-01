# Dev Panel JS Reference

The dev panel (`/dev`) is served from `client/devpanel/`. Its JavaScript lives in `client/devpanel/js/` as 28 plain classic scripts loaded in a fixed order by `index.html`. All scripts share one global scope — no modules, no bundler.

See `client/devpanel/js/README.md` for the load-order contract.

---

## `core/`

### `state.js`
Top-level mutable globals shared across every other file. Includes the auth token, current panel name, the active record under edit, the full record list, the logged-in player's role/handle/id, the staging toggle flag, and the sort state for the list table. Also holds the `collapsedBuildings` and `collapsedItemTypes` sets used by the zones and items panels.

### `api.js`
The two HTTP helpers used everywhere:

- **`API(path, method, body)`** — the primary call wrapper. Automatically intercepts writes to stageable entity types (`/zones`, `/enemies`, `/items`, `/npcs`, `/furniture`, `/recipes`, `/mutations`, `/drugs`, `/windows`) and routes them through the staging pipeline (`/api/staging/stage`) instead of applying them directly. (`/scavenging-tables` is also staged, as the `scavenging_table` type.) Falls through to a direct fetch for reads and excluded sub-resource paths.
- **`directAPI(path, method, body)`** — bypasses staging entirely. Used for live-world actions (spawn, despawn, reload zone, power commands, etc.) that should take effect immediately.

Also holds `STAGED_ENTITY_TYPES` (the path→entityType map) and `getEntityType()`.

### `table.js`
The shared list/edit lifecycle that every panel rides on:

- `renderTable(columns, records, noEdit)` — builds the sortable HTML table in `#list-panel`.
- `renderZonesTable(records)` — zones-specific override (grouped by building, collapsible).
- `sortTableBy(key)` / `sortWorldStateBy(key)` / `filterTable()` — sort and search.
- `selectRecord(id)` / `editRecord(id)` / `newRecord()` — record selection.
- `openEdit(record, isNew)` / `closeEdit()` — open/close the right-hand edit panel.
- `saveRecord()` / `deleteRecord()` — call the current panel's `save`/`delete` hooks.
- `deleteFurnitureStaged(id, name)` — staged-delete shortcut used from furniture rows.

### `panels.js`
The central dispatch table and panel lifecycle. **Must load after all `panels/*` and `ui/*` files** because the `PANELS` object literal evaluates function references at construction time.

- **`PANELS`** — one entry per nav section (dashboard, zones, maps, power, enemies, items, npcs, furniture, recipes, scavenging, scripts, quests, mutations, drugs, sounds, tags, worldstate, timeweather, players, validator, changes). Each entry declares `title`, `fetch`, optional `columns`, `editForm`, `save`, `delete`, and `render`.
- `activatePanelNav(name)` — highlights the active nav item.
- `showPanel(name)` / `loadPanel(name)` — fetch data, call the panel's render function, wire up the toolbar.

### `auth.js`
Login, logout, and the play button:

- `devLogin()` — POSTs credentials, validates role, stores token, kicks off panel load and polling.
- `devpanelLogout()` — clears token and reloads.
- `launchPlayerClient()` / `showPlayButton()` — opens the game client in a new tab using a one-time session token.

### `staging.js`
The staging/change-review system:

- `pendingChanges` — module-level cache of staged changes.
- `updateStagingBadge()` — fetches pending count and shows/hides the "Publish All" / "Reject All" header buttons.
- `publishAll()` / `rejectAll()` / `publishSelected()` / `rejectSelected()` — bulk and selective staging actions.
- `renderChangesPanel(data)` — renders the Changes panel table with diff previews.
- `exportDatabaseDump()` — triggers a full DB export from the Power Tools section.

---

## `ui/`

### `modal.js`
The generic modal and the toast notification:

- `openModal(title, bodyHtml)` / `closeModal()` — populates and shows/hides `#generic-modal`.
- `openSettingsPanel()` / `closeSettingsPanel()` — the settings overlay.
- `toast(msg, isError)` — shows the bottom-center flash message.

### `settings.js`
User preferences and the theme editor:

- `loadDevSettings()` / `saveDevSettings(s)` / `applyDevSettings()` — read/write/apply settings from `localStorage`. Applies theme, font size, density, and custom color overrides to CSS variables.
- `populateThemeDropdown()` — builds the theme `<select>` including any saved custom themes.
- `THEME_COLOR_VARS` — the list of CSS variable names and human labels shown in the theme editor.
- `BUILTIN_THEME_VALUES` — `['dark','light','contrast','phosphor','synthwave','bloodmoon','slate']`.
- Theme editor functions: `openThemeEditor()`, `closeThemeEditor()`, `saveAsCustomTheme()`, `deleteCustomTheme()`, `_renderThemeEditorRows()`, `_loadBaseTheme()`, `onThemeColorHexInput()`, `onThemeColorPickerInput()`, `resetThemeColors()`.
- Power tile color helpers (live with settings because they depend on theme CSS vars): `POWER_STATUS_RGBA`, `powerTileTextColor(status)`, `repaintPowerTileColors()`.

### `whisper.js`
The floating whisper chat panel:

- `toggleWhisperPanel()` / `openWhisper(id, handle)` / `closeWhisper()` — show/hide/target.
- `sendWhisper()` — POSTs a whisper message via the API.
- Holds `_whisperTargetId`, `_whisperTargetHandle`, `_whisperPanelOpen`, `ADMIN_ROLES`.

---

## `panels/`

### `dashboard.js`
`renderDashboard(data)` — the landing panel. Renders server stats, online players, recent activity, and quick-action buttons.

### `zones.js`
Everything for the Zones list panel and the full zone editor form. The largest file.

- **List/table**: `renderZonesTable(records)` (also in `table.js` for the shared override), `deleteZoneRow(id)`, `cloneZoneRow(id)`.
- **Zone editor form**: `zoneEditForm(rec, isNew)` — builds the entire zone editor: metadata fields, building/apartment fields, exits builder, and all subsection tabs (rooms, NPCs, doors, spawns, furniture, generators, windows). Roughly 700 lines.
- **Exits**: `renderExitsBuilder(selfId)`, `addExit(selfId)`, `removeExit(dir)`.
- **Building fields**: `toggleBuildingFields(show, zoneId)`.
- **Zone world dropdown**: `_worldExtZonesCache`, `populateWorldZonesDropdown(selectedId)`.
- **Save**: `saveZone(existing)`, `refreshZoneEditPanel(zoneId)`.
- **Generators**: `installGeneratorQuick(zoneId)`, `_installBuildingGenerator(zoneId, rec)`, `reassignZoneGenerator(zoneId)`, `removeGeneratorQuick(generatorId, zoneId)`.
- **Apartments**: `saveApartmentDetailsQuick(zoneId)`.
- **Map color helpers**: `syncColorWheel(fieldId, wheelId)`, `setZoneColor(c)`, `setBgColor(c)`, `updateColorPreview()`, `mapsGuard()`.
- **Constants**: `BUILDING_TYPES`.

### `zone-subeditors.js`
Quick-edit sub-panels that open inside the zone editor without navigating away. Covers rooms, zone-attached NPCs, doors/locks, enemy spawns (add/remove from zone context), furniture (add/remove from zone context), and zone windows.

- **Rooms**: `openAddRoomForm()`, `submitAddRoom()`, `deleteRoomQuick()`.
- **Zone NPCs**: `openAddNpcForm()`, `submitAddNpc()`, `openAddExistingNpcForm()`, `submitAddExistingNpc()`, `openEditNpcQuick()`, `submitEditNpcQuick()`, `deleteNpcQuick()`.
- **Doors**: `refreshDoorList(zoneId)`, `submitAddDoor(zoneId)`, `openEditDoorDialog(doorId, zoneId)`, `onEditDoorLockTypeChange()`, `saveDoorEdit(doorId, zoneId)`, `deleteDoorQuick()`. Holds `LOCK_MESSAGES` and `DOOR_TYPE_OPTIONS`.
- **Spawn item**: `spawnItemInZone(zoneId)`.
- **Enemy spawns (zone-level)**: `openAddSpawnForm()`, `submitAddSpawn()`, `refreshEnemiesSection()`, `openEditEnemyInline()`, `confirmDeleteSpawn()`, `deleteSpawnQuick()`, `despawnAllEnemies()`, `despawnAllZoneEnemies()`, `respawnAllZoneEnemies()`, `deleteAllZoneSpawns()`.
- **Furniture (zone-level)**: `openAddFurnitureForm()`, `submitAddFurniture()`, `openEditFurnitureQuick()`, `submitEditFurnitureQuick()`, `deleteFurnitureQuick()`.
- **Windows**: `zoneWindowsRefresh()`, `zoneWindowDelete()`, `zoneWindowAdd()`, `_openZoneWindowModal()`.

### `enemies.js`
The global enemies panel and enemy editor.

- **Spawn list rendering**: `renderEnemyRows(spawns, liveEnemies, zoneId)` — renders enemy spawn rows with live-enemy overlap.
- **Loot**: `_lootItems`, `lootItemOptions()`, `lootRow()`, `addLootRow()`, `removeLootRow()`, `lootItemList()`.
- **Weapons/body parts**: `weaponRow()`, `addWeaponRow()`, `removeWeaponRow()`, `bodyPartRow()`, `addBodyPartRow()`, `removeBodyPartRow()`, `defaultBodyParts()`. Holds `ENEMY_DAMAGE_TYPES`, `ENEMY_BODY_PARTS`, `DEFAULT_BODY_PART_WEIGHTS`.
- **Editor + save**: `enemyEditForm(rec, isNew)`, `saveEnemy(existing)`.

### `items.js`
The Items panel and item editor.

- **Tag widget**: `itemTagWidget(name, value)`, `itemTagRow()`, `itemAddTagPicker()`, `refreshItemTagPicker()`, `addItemTag()`, `removeItemTag()`, `readItemTag()`.
- **Panel render**: `renderItemsPanel()` — groups items by type with collapsible sections.
- **Editor + save**: `itemEditForm(rec, isNew)`, `saveItem(existing)`.

### `npcs.js`
- `renderNpcsPanel(data)` — renders NPCs grouped by zone.
- `deleteNpcRow(id)` — deletes with confirmation.
- `npcEditForm(rec, isNew)` / `saveNpc(existing)` — NPC editor and save.

### `furniture.js`
The global Furniture panel (all placed furniture across all zones).

- **Panel render**: `renderFurniturePanel(data)`, `furnitureItemRow(f)` — zone-grouped collapsible list.
- **Zone-level quick add**: `openFurnitureAddModal(zoneId)`, `openFurnitureRoomModal(zoneId)`.
- **Bulk tools**: `bulkAddStreetlights()`.
- **Editor + save**: `furnitureEditForm(rec, isNew)`, `saveFurniture(existing)`, `assignRoomToJB(zoneId)`.
- **Collapse toggle**: `fToggle(header)`.
- Holds `_furnitureAllItems`, `_furnitureZoneNames`, `_furnitureExpandedZones`, `_furniturePublishedNames`.

### `simple-entities.js`
Thin editors for mutations, drugs, and recipes — all follow the same pattern of a form function + an async save.

- `mutationEditForm(rec, isNew)` / `saveMutation(existing)`
- `drugEditForm(rec, isNew)` / `saveDrug(existing)`
- `recipeEditForm(rec, isNew)` / `saveRecipe(existing)`

### `scavenging.js`
The Scavenging Tables panel — CRUD for reusable scavenge loot templates (`scavenging_tables` + `scavenging_table_items`). Attached to zones via `flags.scavenging_table_id` from the zone editor.

- `scavengingEditForm(rec, isNew)` — table metadata + loot-entry row builder + optional flavor line-lists. Fetches the full table (`/scavenging-tables/:id`) on edit since the list row only carries counts.
- Entry rows: `scavEntryRow()`, `addScavEntry()`, `removeScavEntry()`, `scavItemOptions()`, plus `scavUpdateHints()` / `scavReachHint()` for the live reach + draw-share hints.
- `saveScavengingTable(existing)` — POST/PUT with `{ name, replenish_interval_seconds, entries, messages }`. Staged as the `scavenging_table` entity type.
- Holds `_scavItems` (item cache for the picker).

### `quests.js`
Thin editor for the `quests` table (consumed by the quests plugin). Objectives and rewards are edited as raw JSON, matching the simple-entities pattern.

- `questEditForm(rec, isNew)` / `saveQuest(existing)`

### `scripts.js`
The NPC/world script graph editor.

- `scriptEditForm(rec, isNew)` — wraps the graph editor UI.
- `renderScriptEditor()` — renders node list and connections.
- `addScriptNode()`, `deleteScriptNode(id)`, `changeNodeType()`, `setNodeField()`, `setNodeJSON()`.
- `syncScriptJSON()` / `applyScriptJSON(v)` — keep the raw JSON textarea in sync with the visual editor.
- `saveScript(existing)`.
- Holds `_scriptGraph`, `SCRIPT_NODE_TYPES`.

### `maps.js`
The map overview editor and the shared big-map grid renderer used by both the Maps panel and the Power panel.

- **Shared grid**: `buildDynamicMapGrid(zones, mode, powerById, clickable)`, `mapLegendHtml(mode)`, `luminanceTextColor(bgHex)`, `zoneColorStyle()`. Used by both the Maps and Power panels.
- **Big map overlay** (the modal launched from zones/maps): `openBigMap(mode)`, `renderBigMapOverlay()`, `changeBigMapFloor()`, `closeBigMap()`, `bigMapTileClick()`, `applyZoneEditToMap()`, `mapTileEditClick()`, `diveInto()`.
- **Maps panel**: `renderMapsPanel(data)`, `loadMapOverview(mapId)`, `validateMapOverview()`, `renderMapOverview()`.
- **Map editing**: `switchMap()`, `changeFloor()`, `mapToggleConn()`, `mapFixGeometry()`, `mapAddReciprocal()`, `mapRemoveExit()`.
- **Drag/drop**: `mapGridDrop()`, `mapDragStart()`, `mapTrayDragStart()`, `mapInteriorTrayDragStart()`, `mapDrop()`.
- **Interior maps**: `openInteriorLinkModal()`, `linkInteriorToExterior()`, `switchMapTab()`, `switchInteriorMap()`.
- **Zone placement**: `createZoneAt()`, `pendingZonePlacement`.
- Holds `MAP_PALETTE`, `MAP_DIR3D`, `MAP_OPP`, and all map state globals (`mapsList`, `mapOverview`, `mapViewTab`, etc.).

### `power.js`
The Power Grid panel.

- **Panel render**: `renderPowerPanel(zones)`, `renderPowerPanelBody()`.
- **View controls**: `setPowerPanelMode()`, `setPowerPanelView()`, `setPowerPanelBuilding()`, `setPowerPanelInteriorZ()`, `_buildInteriorMapHtml()`.
- **Generator actions**: `toggleGeneratorPower()`, `editGeneratorCapacity()`, `viewGeneratorZones()`, `editZoneMaxCapacity()`, `removeGeneratorFromPowerPanel()`.
- **Junction box**: `setJunctionBoxCityGen()`.
- **Power tools**: `fixZonePowerConnections()`, `fixBuildingPowerConnections()`, `forceRecomputePower()`, `powerToolLog()`.
- **Internal helpers**: `_refreshPowerMapData()`, `_buildJbByOutdoor()`.
- Holds `powerPanelGenerators`, `powerPanelMode`, `powerPanelView`, `powerPanelBuilding`, `powerJbByOutdoor`.

### `broadcast.js`
The Broadcasts panel — list and modal editor for `media_broadcasts` assets.

- **Panel render**: `renderBroadcastsPanel(data)` — table of broadcasts with name, category, playback mode, calculated duration. `data` contains both `broadcasts` and `channels` (channels are available for the channel editor but the broadcasts panel only uses broadcasts).
- **Modal**: `openBroadcastModal(rec, isNew)` — metadata fields plus a flat message sequence builder with move/delete/add rows and a live duration preview.
- **VINE**: `broadcastOpenVine()` — opens the VINE broadcast graph editor (`VineBroadcastSchema`). A "VINE graph" badge appears when a graph is attached. Graph stored in `_broadcastGraph`.
- **Save**: `saveBroadcast()` — POST/PUT to `/broadcast/broadcasts/:id`, includes `broadcast_graph`.
- **Delete**: `deleteBroadcast(id, name)` — confirmation + DELETE.
- **Clone**: `cloneBroadcast(rec)` — POST with a new id.
- State globals: `_broadcastList`, `_broadcastEditTarget`, `_broadcastMessages`, `_broadcastGraph`.
- Constants: `BROADCAST_CATEGORIES`, `BROADCAST_MODES`.

### `broadcast-channel.js`
The Channels panel — list and visual timeline editor for `media_channels` and their playlists.

- **Panel render**: `renderChannelsPanel(data)` — channel list with number, name, type, item count.
- **Timeline editor**: horizontal scrollable canvas with absolutely-positioned items (`start_time × scale`). Drag to reposition (snaps 30 s); resize via right-edge drag; drag from library pane to create new items.
- **Library**: left pane lists `_channelBroadcasts` as draggable assets.
- **Cameras section**: lists cameras for this channel; edit, clear buffer, convert to broadcast.
- **Save**: posts metadata to `/broadcast/channels/:id`, then replaces playlist via `PUT /broadcast/channels/:id/playlist`.
- State globals: `_channelList`, `_channelPlaylist`, `_channelBroadcasts`, `_tlScale`, `_tlLoopDuration`, `_tlDragging`, `_tlResizing`.
- Helper: `escHtml2()` — local escaping helper (avoids colliding with `broadcast.js`'s `escHtml()`).

### `sounds.js`
The Sounds & Ambience panel.

- `renderSoundsPanel(data)` — renders both the sound library and the ambient event schedule.
- Sound CRUD: `newSound()`, `editSound()`, `deleteSound()`, `openSoundModal()`.
- Ambient event CRUD: `newAmbientEvent()`, `editAmbientEvent()`, `deleteAmbientEvent()`, `toggleAmbientEvent()`, `openAmbientEventModal()`.
- Holds `AMBIENT_THEMES`, `SOUND_CATEGORIES`.

### `players.js`
The Players panel and player editor.

- `renderPlayersPanel(data)` — online/all player list with role badges and action buttons.
- `confirmSmite()`, `confirmDelete()`, `setPlayerRole()` — quick player actions.
- `openPlayerEdit(id)` / `savePlayerEdit()` — full player editor (stats, inventory, flags).

### `timeweather.js`
The Time & Weather panel. Covers the world clock, weather overrides, and climate profiles.

- `renderTimeWeatherPanel(data)` — renders all three sections.
- **Clock**: `devApplyTime()`, `devToggleFreeze()`, `startPanelClock()`, `devSyncToMyClockNow()`, `devForceTick()`.
- **Weather**: `devApplyWeather()`, `devClearWeatherOverride()`, `devRecalculateForecast()`, `devResetBuildingTemps()`.
- **Climate**: `devLoadClimatePreset()`, `devReadClimateInputs()`, `devSaveClimateProfile()`, `devSetActiveClimate()`, `devDeleteClimateProfile()`, `CLIMATE_PRESETS`.

### `worldstate.js`
The World State panel and the persistent server-status sidebar.

- `renderWorldState(data)` — populates the World State panel (live enemies, corpses, zones, players).
- `startWorldStatePolling()` / `reloadZone(id)` / `refreshWorld()` — keep the sidebar live.
- `openGhostMode()` / `confirmGhostMode()` / `closeGhostModal()` — the Ghost Mode zone-picker overlay.
- `showPlayButton()` / `launchPlayerClient()` — the 🎮 Play button in the header.

### `validator.js`
The Zone Validator panel (data integrity checks).

- `renderValidatorPanel()` — entry point; runs auto-check if enabled.
- `runFullValidation()` / `runZoneValidation(zoneId)` — hit the validator API and render results.
- `renderValidatorResults(r)` — renders issue list with severity icons and fix buttons.
- **Orphan cleanup**: `deleteOrphan()`, `deleteAllOrphans()`.
- **Map geometry**: `runMapGeometryValidation()`, `renderValidatorMapResults()`.
- **Auto-fix helpers**: `vFixRemoveExit()`, `vFixAddReciprocal()`, `vFixGeometry()`.
- `toggleValidatorAutoRun()`, `exportValidatorReport()`.

### `tags.js`
`renderTagsPanel(data)` — the Tag Catalog panel. `data` is `{ catalog, supertags }`. Two sections:

- **Tags**: the full tag list with an inline editor for adding/updating/deleting tag definitions (label, shape, scope, group, help text), persisted via `PUT /tag-catalog`.
- **Supertags**: reusable bundles of tags ("classes" of items, e.g. a `weapon` supertag). Add/edit/delete supertags, each with a label/group/help and a member-tag builder that reuses the item editor's `itemTagWidget`/`readItemTag`. Persisted via `PUT /tag-supertags`, which re-materializes every item that references the edited supertag (live reference). Member-tag widgets read from the global `TAG_CATALOG`; the supertag registry is the global `TAG_SUPERTAGS` (loaded from `/shared/tagSupertags.js`).

### `dashboard.js`
`renderDashboard(data)` — the landing screen shown on login. Displays server health, online player count, recent changes, and quick-links to the most-used panels.

---

## `bootstrap.js`

**Loaded last.** Contains all code that executes immediately on script load:

- `let devSettings = loadDevSettings()` — initialises settings from `localStorage`.
- `applyDevSettings()` — applies theme/font/density before the first render.
- `window.addEventListener('storage', ...)` — syncs settings changes from other tabs.
- `document.addEventListener('DOMContentLoaded', ...)` — wires up the settings panel controls (theme select, font size buttons, density buttons).
- The password-field `keydown` listener (Enter → `devLogin()`).
- The auto-auth IIFE — checks `sessionStorage` for a token passed from the game client and skips the login screen if valid.
