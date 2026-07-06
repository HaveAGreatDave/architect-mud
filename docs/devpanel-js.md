# Dev Panel JS Reference

The dev panel (`/dev`) is served from `client/devpanel/`. Its JavaScript lives in `client/devpanel/js/` as ~38 plain classic scripts (plus the `vine-*` graph-editor files documented in [vine.md](vine.md)) loaded in a fixed order by `index.html`. All scripts share one global scope — no modules, no bundler.

See `client/devpanel/js/README.md` for the load-order contract.

---

## `core/`

### `state.js`
Top-level mutable globals shared across every other file. Includes the auth token, current panel name, the active record under edit, the full record list, the logged-in player's role/handle/id, the staging toggle flag, and the sort state for the list table. Also holds the `collapsedItemTypes` set used by the items panel (the zones accordion keeps its own `_zonesExpanded` state in `panels/zones.js`).

### `api.js`
The two HTTP helpers used everywhere:

- **`API(path, method, body)`** — the primary call wrapper. Automatically intercepts writes to stageable entity types (`/zones`, `/enemies`, `/items`, `/npcs`, `/furniture`, `/recipes`, `/mutations`, `/drugs`, `/windows`) and routes them through the staging pipeline (`/api/staging/stage`) instead of applying them directly. (`/scavenging-tables` is also staged, as the `scavenging_table` type.) Falls through to a direct fetch for reads and excluded sub-resource paths.
- **`directAPI(path, method, body)`** — bypasses staging entirely. Used for live-world actions (spawn, despawn, reload zone, power commands, etc.) that should take effect immediately.

Also holds `STAGED_ENTITY_TYPES` (the path→entityType map) and `getEntityType()`.

### `table.js`
The shared list/edit lifecycle that every panel rides on:

- `renderTable(columns, records, noEdit)` — builds the sortable HTML table in `#list-panel`.
- `renderZonesTable(records)` — zones-specific override: a furniture-panel-style accordion, not a table. Tiers: exterior zone (ordered by BFS distance out from `zone_start`) → buildings (attached via exits / `world_exit_zone`) → floors grouped by `grid_z` ascending (collapsible, skipped for single-floor buildings) → rooms. Building membership is BFS over exits from the entrance. `filterZones(q)` / `zToggle(header)` back its search and per-section expand/collapse (state in `_zonesExpanded`).
- `sortTableBy(key)` / `sortWorldStateBy(key)` / `filterTable()` — sort and search.
- `selectRecord(id)` / `editRecord(id)` / `newRecord()` — record selection.
- `openEdit(record, isNew)` / `closeEdit()` — open/close the right-hand edit panel. The panel carries a **Save/Delete bar both above (`#edit-actions-top`) and below (`.edit-footer`) the form**; buttons share the `.js-save-btn`/`.js-delete-btn` classes so `openEdit`/`saveRecord` drive both. `openEdit` hides Delete on a new record; the broadcast NPC sidebar override hides the top bar (it swaps the footer for its own buttons).
- `saveRecord()` / `deleteRecord()` — call the current panel's `save`/`delete` hooks.
- `deleteFurnitureStaged(id, name)` — staged-delete shortcut used from furniture rows.

### `panels.js`
The central dispatch table and panel lifecycle. **Must load after all `panels/*` and `ui/*` files** because the `PANELS` object literal evaluates function references at construction time.

- **`PANELS`** — one entry per nav section (dashboard, zones, maps, power, enemies, items, npcs, furniture, recipes, scavenging, scripts, quests, vine, mutations, drugs, sounds, audio, bank, emergency, broadcasts, tags, worldstate, timeweather, players, validator, changes). Each entry declares `title`, `fetch`, optional `columns`, `editForm`, `save`, `delete`, and `render`.
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

### `markup.js`
A dev-panel port of the client chat markup parser (`client/game/js/markup.js`). HTML-escapes input first, then applies BBCode. Because the dev panel has no live player state, `$token` expansion only resolves `$name` (→ the admin handle); every other token passes through untouched. Holds `_MARKUP_TOKEN_PATTERN`.

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
- **Panel render**: `renderItemsPanel()` — groups items by type with collapsible sections; a row click opens the editor. Deletion is done from the editor's Delete button (like the other entity panels), not a per-row checkbox.
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
Thin editors for mutations, drugs, recipes, and crimes — all follow the same pattern of a form function + an async save.

- `mutationEditForm(rec, isNew)` / `saveMutation(existing)`
- `drugEditForm(rec, isNew)` / `saveDrug(existing)` — the inline form keeps a raw-JSON `effects` fallback plus an **⚗ Open Structured Editor…** button → `openDrugEditorFromForm()` (see `drug-editor-modal.js`). A **Legality** dropdown sets `flags.legal` (legal drugs like coffee/beer sell at normal vendors and draw no police heat).
- `recipeEditForm(rec, isNew)` / `saveRecipe(existing)`

### `drug-editor-modal.js`
Pop-out structured editor for a drug's `effects` schema — sectioned controls (basics / instant / phases + peak-mod rows / tolerance / withdrawal + mod rows / overdose / hallucination + event rows) instead of raw JSON. Global-scope; self-builds its overlay (`.modal-overlay`/`.modal-card`). Seeds from the inline form's current field values, composes the `effects` object on save, and PUT/POSTs to `/drugs` via the shared `API` helper (staging applies), then `loadPanel('drugs')`.

- `openDrugEditorFromForm()` — reads the inline `f-*` fields, parses `effects` JSON, opens the modal.
- `openDrugEditorModal(rec, isNew)` — builds the sectioned UI; `_dgSave()` collects + saves.
- Row builders: `_modRow()` / `_eventRow()`, add via `_dgAddMod()` / `_dgAddEvt()`, remove via `_dgRemoveRow()`.

### `scavenging.js`
The Scavenging Tables panel — CRUD for reusable scavenge loot templates (`scavenging_tables` + `scavenging_table_items`). Attached to zones via `flags.scavenging_table_id` from the zone editor.

- `scavengingEditForm(rec, isNew)` — table metadata + loot-entry row builder + optional flavor line-lists. Fetches the full table (`/scavenging-tables/:id`) on edit since the list row only carries counts.
- Entry rows: `scavEntryRow()`, `addScavEntry()`, `removeScavEntry()`, `scavItemOptions()`, plus `scavUpdateHints()` / `scavReachHint()` for the live reach + draw-share hints.
- `saveScavengingTable(existing)` — POST/PUT with `{ name, replenish_interval_seconds, entries, messages }`. Staged as the `scavenging_table` entity type.
- Holds `_scavItems` (item cache for the picker).

### `quests.js`
Thin editor for the `quests` table (consumed by the quests plugin). Objectives and rewards are edited as raw JSON, matching the simple-entities pattern.

- `questEditForm(rec, isNew)` / `saveQuest(existing)`

### `vine-suite.js`
The VINE Suite panel (`noEdit`, custom render): a cross-cutting **index** of every VINE graph. It owns no editor — it navigates to the owning panel and opens that record's real per-panel editor.

- `fetchVineSuite()` — parallel-fetches npcs, enemies, scripts, quests.
- `renderVineSuite(data)` / `vsRenderIndex()` — the searchable index: one colour-coded section per kind, each listing its assets (name, id, node-count badge). A row calls `vineOpenAsset`.
- `vineOpenAsset(kind, id)` — the navigator: `activatePanelNav` + set `currentPanel`, `await loadPanel`, set `currentRecord`, `await openEdit`, then fire that panel's own VINE button (e.g. `npcOpenVineAI`). Reuses the core panel/edit helpers; opens nothing itself.
- `vineJumpTo(kind, id)` — generic cross-editor jump fired from inside an editor: `vineModalSave()` (commit current graph to its form) then open the referenced asset in the standalone `#vine-modal`, saved straight to the DB via that kind's canonical route. Does **not** navigate panels, so the editor you jumped from stays behind it. Creates a quest stub on demand.
- `vineJumpToQuest(questId)` — back-compat shim → `vineJumpTo('quest', …)`.
- Holds `VINE_KINDS` (registry: index fields `label/icon/color/source/panel/opener/badge`; cross-jump fields `noun/schema/listRoute/toGraph/save[/createStub]`), `_VS_ORDER`, `_vineSuiteData`. Broadcasts are intentionally not in the index (the broadcast panel uses a custom selection flow, edited from its own panel).

`quests.js` also gained `questsOpenVine()` — opens the VINE quest editor seeded from the form fields; on save writes derived `objectives[]`/`rewards{}` back into them.

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

### `bank.js`
The Bank panel — ATM network overview, unit management, and network CRUD (see [systems-atm.md](systems-atm.md)).

- **Panel render**: `renderBankPanel()`, `_renderBankBody()`.
- **ATM units**: `bankFillAtm()`, `bankRepairAtm()`, `bankSetStock()`, `bankEditUnit()`, `bankSaveUnit()`, `bankReplenishAll()`, `bankRenameAtm()`, `bankDeleteAtm()`, `bankCreateAtm()`, `bankCreateAtmSave()`.
- **Networks**: `_networkModal()`, `bankNewNetwork()`, `bankEditNetwork()`, `bankSaveNetwork()`, `bankDeleteNetwork()`, `bankInjectNetwork()`.
- Holds `_bankUnits`, `_bankNetworks`, `_bankZones`.

### `emergency.js`
The Emergency Services panel — Emergency Service Provider (ESP) alerts and Arbiter deployment.

- **Panel render**: `renderEmergencyPanel(data)`, `_arbiterDot(arbiters)` (status indicator).
- **ESP**: `espActivate()`, `espDeactivate()`, `espSaveMessage()`.
- **Arbiters**: `arbitersActivate()`, `arbitersStandDown()`, `arbitersAdminProtection()`.
- **Crime registry**: `_loadCrimeConfig()` builds the per-crime rows (enable toggle + inline wanted-star weight input + witness mode). `toggleCrime(id, enabled)` and `saveCrimeStars(id, value)` both `PUT /crimes/:id` (partial: just the toggle or just the stars, clamped 0–5, reloaded live). This is where star weights are tuned now — the standalone Crimes panel was removed.

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

### `broadcast-schedule.js`
The 24-hour daily broadcast schedule editor — a zoomable horizontal timeline for arranging broadcasts (and commercials) across a channel's day, with a live "now" line.

- **Panel render**: `renderSchedulePanel()`, `_schedRenderSidebar()`, `_schedRenderContent()`, `_schedChBody()`, `_schedBuildTimeline()`.
- **Timeline math**: `_schedScale()`, `_schedW()`, `_schedToX()`, `_schedToSec()`, `_schedClamp()`, `_schedZoom()`, `_schedZoomLabel()`, `_schedFmtTime()`, `_schedUpdateNowLine()`.
- **Channels/items**: `_schedToggleNewCh()`, `_schedCreateChannel()`, `_schedLoadItems()`, `_schedSaveChMeta()`, `_schedMarkDirty()`, `_schedUpdateSaveBtn()`.
- State globals: `_schedChannels`, `_schedBroadcasts`, `_schedNpcs`.

### `broadcast-themes.js`
The Broadcast Themes panel — create/edit CSS-variable overrides for the TV panel, with live preview and color pickers. Colors can be derived from a UI theme (`_broadcastColorsFromTheme`).

- `renderThemesPanel()`, `openBroadcastThemeEditor()`, `_themePickerSync()`, `_themeTextSync()`, `_themeApplyPreset()`, `_updateThemePreview()`, `saveTheme()`, `deleteTheme()`.
- Helper: `escHtml3()` (local escape, avoids colliding with the other broadcast panels' helpers).

### `broadcast-graphics.js`
The Broadcast Graphics panel — an ASCII-art library for VINE `title_card` nodes, with an interactive canvas grid editor (paint chars/colors, import from text or SVG).

- **Panel/editor**: `renderGraphicsPanel()`, `openGraphicEditor()`, `_grTab()`.
- **Palette/tools**: `_grBuildPalette()`, `_grSelectChar()`, `_grSetColor()`, `_grToggleErase()`.
- **Canvas**: `_grInitCanvas()`, `_grCellSize()`, `_grRedraw()`, `_grCellFromEvent()`, `_grPaintCell()`, `_grKeydown()`, `_grResize()`, `_grClear()`.
- **Import/sync**: `_grParseLine()`, `_grLoadFromText()`, `_grImportFromText()`, `_grLoadSvgFile()`, `_grSyncToTextarea()`.
- Holds `ASCII_PALETTE`.

### `sounds.js`
The Sounds & Ambience panel.

- `renderSoundsPanel(data)` — renders both the sound library and the ambient event schedule.
- Sound CRUD: `newSound()`, `editSound()`, `deleteSound()`, `openSoundModal()`.
- Ambient event CRUD: `newAmbientEvent()`, `editAmbientEvent()`, `deleteAmbientEvent()`, `toggleAmbientEvent()`, `openAmbientEventModal()`.
- Holds `AMBIENT_THEMES`, `SOUND_CATEGORIES`.

### `audio.js`
The Audio editor — procedural Web Audio assets (instruments, songs, sfx, ambient, samples). **Separate from `sounds.js`**, which is the text-based gameplay Sound system; the two are never merged. Functional forms plus instant local preview through `window.AudioEngine` against the browser's own `AudioContext` (no server round-trip); no canvas/timeline editor yet.

- **Panel/tabs**: `renderAudioPanel()`, `setAudioTab()`, `renderAudioTabBody()`, `findAudioAsset()`, `_resolveInstrumentsById()`.
- **Preview**: `previewAudioAsset()`, `stopAllAudioPreviews()`.
- **Export**: `exportAudioAsset()` (writes `.amp` JSON — see [amp-format.md](amp-format.md)).
- **Import**: `openAudioImportModal()`, and the `.MOD` tracker importer `openModImportModal()` / `_modImport()` with helpers `_parseMod()`, `_modChannelsForTag()`, `_midiToNoteStr()`, `_periodToNote()`, `_cellFx()`, `_modSanitize()`, `_pcm8ToWavBase64()`. The MOD importer imports at the module's own tempo and honors volume, arpeggio, portamento, tone-portamento, vibrato and volume-slide effects, sample finetune, pattern break/jump (loop point), and Amiga stereo panning.
- **Editor + save**: `newAudioAsset()`, `editAudioAsset()`, and per-type form/save handlers.
- Holds `AUDIO_IMPORT_FIELDS` (the per-type field lists for import/export).

### `players.js`
The Players panel and player editor.

- `renderPlayersPanel(data)` — online/all player list with role badges and action buttons.
- `confirmSmite()`, `confirmDelete()`, `setPlayerRole()` — quick player actions.
- `openPlayerEdit(id)` / `savePlayerEdit()` — full player editor (stats, inventory, flags).

### `timeweather.js`
The Time & Weather panel. Covers the world clock, weather overrides, and climate profiles.

- `renderTimeWeatherPanel(data)` — renders all three sections.
- **Clock**: `devApplyTime()`, `devToggleFreeze()`, `startPanelClock()`, `devSyncToMyClockNow()`, `devForceTick()`.
- **Weather**: `devApplyWeather()`, `devClearWeatherOverride()`, `devRecalculateForecast()`, `devResetBuildingTemps()`, `devScheduleForecastDay()` (edits an upcoming forecast day 1-6 in place, e.g. to schedule an extreme-weather event ahead of time; forecast grid also flags severe days with ⚠).
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
- **Item integrity**: `runItemValidation()` scans every item client-side against `TAG_CATALOG` for null columns (name/weight/value), non-object tags, and unknown/malformed tags. `validateItem()`/`tagValueError()`/`deriveItemName()` do detection; `renderItemValidatorResults()` renders a checkbox list (mirrors the Changes screen — Select All/None + per-row Fix/Remove select). `resolveSelectedItemIssues()` routes each choice through staging (Fix = full-object PUT to `/items/:id`; Remove = staged item delete), so resolutions land in the Changes panel to publish.
- `toggleValidatorAutoRun()`, `exportValidatorReport()`.

### `tags.js`
`renderTagsPanel(data)` — the Tag Catalog panel. `data` is `{ catalog, supertags }`. Two sections:

- **Tags**: the full tag list with an inline editor for adding/updating/deleting tag definitions (label, shape, scope, group, help text), persisted via `PUT /tag-catalog`.
- **Supertags**: reusable bundles of tags ("classes" of items, e.g. a `weapon` supertag). Add/edit/delete supertags, each with a label/group/help and a member-tag builder that reuses the item editor's `itemTagWidget`/`readItemTag`. Persisted via `PUT /tag-supertags`. Applying a supertag to an item (in the item editor) is a one-time template — it copies the supertag's member tags into the item's own editable fields once; editing a supertag here never touches items already stamped with it. Member-tag widgets read from the global `TAG_CATALOG`; the supertag registry is the global `TAG_SUPERTAGS` (loaded from `/shared/tagSupertags.js`).

### `aliases.js`
`renderAliasesPanel(data)` — the Aliases panel. CRUD over verb shortcuts (`command_aliases` table): a typed shortcut is rewritten to its canonical verb before command dispatch (invisible to players). Engine ships defaults (`server/engine/commands/aliases.js`); rows add/override, deleting an override restores the default. Writes go through `directAPI` (`POST`/`DELETE /command-aliases`) — applied live, not staged. Handlers: `window.aliasAdd`, `window.aliasDelete`.

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
