# Dev Panel JS Reference

The dev panel (`/dev`) is served from `client/devpanel/`. Its JavaScript lives in `client/devpanel/js/` as ~48 plain classic scripts (plus the `vine-*` graph-editor files documented in [vine.md](vine.md)) loaded in a fixed order by `index.html`. All scripts share one global scope — no modules, no bundler.

See `client/devpanel/js/README.md` for the load-order contract.

---

## `core/`

### `state.js`
Top-level mutable globals shared across every other file. Includes the auth token, current panel name, the active record under edit, the full record list, the logged-in player's role/handle/id, the staging toggle flag, and the sort state for the list table. Also holds the `collapsedItemTypes` set used by the items panel (the zones accordion keeps its own `_zonesExpanded` state in `panels/zones.js`).

### `api.js`
The two HTTP helpers used everywhere:

- **`API(path, method, body)`** — the primary call wrapper. Automatically intercepts writes to stageable entity types (`/zones`, `/enemies`, `/items`, `/npcs`, `/furniture`, `/recipes`, `/mutations`, `/drugs`) and routes them through the staging pipeline (`/api/staging/stage`) instead of applying them directly. (`/scavenging-tables` is also staged, as the `scavenging_table` type.) Falls through to a direct fetch for reads and excluded sub-resource paths.
- **`directAPI(path, method, body)`** — bypasses staging entirely. Used for live-world actions (spawn, despawn, reload zone, power commands, etc.) that should take effect immediately.

Also holds `STAGED_ENTITY_TYPES` (the path→entityType map) and `getEntityType()`.

### `table.js`
The shared list/edit lifecycle that every panel rides on:

- `renderTable(columns, records, noEdit)` — builds the sortable HTML table in `#list-panel`. A panel can replace it wholesale by declaring its own `render` (zones does — see `panels/zones.js`).
- `sortTableBy(key)` / `sortWorldStateBy(key)` / `filterTable()` — sort and search.
- `selectRecord(id)` / `editRecord(id)` / `newRecord()` — record selection.
- `openEdit(record, isNew)` / `closeEdit()` — open/close the right-hand edit panel. The panel carries a **Save/Delete bar both above (`#edit-actions-top`) and below (`.edit-footer`) the form**; buttons share the `.js-save-btn`/`.js-delete-btn` classes so `openEdit`/`saveRecord` drive both. `openEdit` hides Delete on a new record; the broadcast NPC sidebar override hides the top bar (it swaps the footer for its own buttons).
- `saveRecord()` / `deleteRecord()` — call the current panel's `save`/`delete` hooks.
- `deleteFurnitureStaged(id, name)` — staged-delete shortcut used from furniture rows.

### `panels.js`
The central dispatch table and panel lifecycle. **Must load after all `panels/*` and `ui/*` files** because the `PANELS` object literal evaluates function references at construction time.

- **`PANELS`** — one entry per nav section (dashboard, zones, maps, world, power, enemies, items, npcs, furniture, recipes, scavenging, scripts, quests, vine, mutations, drugs, sounds, audio, bank, emergency, broadcasts, tags, worldstate, timeweather, players, validator, changes, aliases, devlog, gossip, flight, games, jobBoards). Each entry declares `title`, `fetch`, optional `description`, `columns`, `editForm`, `save`, `delete`, `noEdit`, `filter`, and `render`.
- `activatePanelNav(name)` — highlights the active nav item.
- `showPanel(name)` / `loadPanel(name)` — fetch data, call the panel's render function, wire up the toolbar.

### `auth.js`
Login and logout. Loads after `panels.js` (it calls into the panel lifecycle on a successful login).

- `devLogin()` — POSTs credentials, validates role, stores token, kicks off panel load and polling.
- `devpanelLogout()` — clears token and reloads.

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
- `dpConfirm(msg, opts)` / `dpPrompt(msg, default, opts)` / `dpAlert(msg, opts)` — themed, promise-returning replacements for the native `confirm`/`prompt`/`alert` (over `_dpDialog`). Use these, not the browser dialogs.
- `dpFloatAnchor(id, dflt)` / `window.dpFloatPos` — remembered positions for draggable floating panels.

### `settings.js`
User preferences and the theme editor:

- `loadDevSettings()` / `saveDevSettings(s)` / `applyDevSettings()` — read/write/apply settings from `localStorage`. Applies theme, font size, density, and custom color overrides to CSS variables.
- `populateThemeDropdown()` — builds the theme `<select>` including any saved custom themes.
- `THEME_COLOR_VARS` — the list of CSS variable names and human labels shown in the theme editor.
- `LIGHT_THEMES` / `DARK_THEMES` — the `[id, label]` theme lists, kept in lockstep with `client/shared/settings.js`; every id needs a palette in `client/shared/themes.css`. `BUILTIN_THEME_VALUES` is their ids flattened (used to tell a builtin from a saved custom theme).
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

- **List/table**: `renderZonesTable(records)` — a district-first accordion, not a table. Tier 1 is the zone's district (`districtKeyFor`: `flags.district` override → id-prefix map → `danger`-based default); within a district, buildings lead, then named exteriors, then the bulk map grid collapsed into one Terrain-tiles fold. Interiors nest under their building, derived live from the exit graph. A region dropdown (`setZonesRegion`) scopes the whole list; `filterZones(q)` / `zToggle(header)` back search and expand/collapse (state in `_zonesExpanded`). Plus `deleteZoneRow(id)`, `cloneZoneRow(id)`.
- **Zone editor form**: `zoneEditForm(rec, isNew)` — builds the entire zone editor: metadata fields, building/apartment fields, exits builder, and all subsection tabs (rooms, NPCs, doors, spawns, furniture, generators). Roughly 700 lines.
- **Exits**: `renderExitsBuilder(selfId)`, `addExit(selfId)`, `removeExit(dir)`.
- **Building fields**: `toggleBuildingFields(show, zoneId)`.
- **Zone world dropdown**: `_worldExtZonesCache`, `populateWorldZonesDropdown(selectedId)`.
- **Save**: `saveZone(existing)`, `refreshZoneEditPanel(zoneId)`.
- **Generators**: `installGeneratorQuick(zoneId)`, `_installBuildingGenerator(zoneId, rec)`, `reassignZoneGenerator(zoneId)`, `removeGeneratorQuick(generatorId, zoneId)`.
- **Apartments**: `saveApartmentDetailsQuick(zoneId)`.
- **Map color helpers**: `syncColorWheel(fieldId, wheelId)`, `setZoneColor(c)`, `setBgColor(c)`, `updateColorPreview()`, `mapsGuard()`.
- **Constants**: `BUILDING_TYPES`.

### `zone-subeditors.js`
Quick-edit sub-panels that open inside the zone editor without navigating away. Covers rooms, zone-attached NPCs, doors/locks, enemy spawns (add/remove from zone context), furniture (add/remove from zone context). Windows are a zone FLAG now (`flags.window`), edited with the zone itself.

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
- **Panel render**: `renderItemsPanel()` — groups items by type with collapsible sections; a row click opens the editor, and deletion is from the editor's Delete button.
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
The VINE Suite panel (`noEdit`, custom render): a cross-cutting **index** of every VINE graph. It owns no editor, no storage and no save path — a row navigates to the owning panel and fires that record's real per-panel editor. Entry points: `fetchVineSuite()`, `renderVineSuite(data)`, `vsRenderMasterList()`, `vsOpenExisting(family)`, `vineOpenAsset(kind, id)`, `vineJumpTo(kind, id)`, `vsHostPicker(family)`; registries `VINE_KINDS` / `VINE_FAMILIES`.

**[vine.md](vine.md) owns the behaviour** — front page, family tabs, cross-editor jumps, the registry field lists. Don't restate it here.

`quests.js` also holds `questsOpenVine()` — opens the VINE quest editor seeded from the form fields; on save writes derived `objectives[]`/`rewards{}` back into them.

### `scripts.js`
The NPC/world script graph editor.

- `scriptEditForm(rec, isNew)` — wraps the graph editor UI.
- `renderScriptEditor()` — renders node list and connections.
- `addScriptNode()`, `deleteScriptNode(id)`, `changeNodeType()`, `setNodeField()`, `setNodeJSON()`.
- `syncScriptJSON()` / `applyScriptJSON(v)` — keep the raw JSON textarea in sync with the visual editor.
- `saveScript(existing)`.
- Holds `_scriptGraph`, `SCRIPT_NODE_TYPES`.

### `script-triggers.js`
The event→script binding editor (Triggers panel). Server side is
`server/engine/script-triggers.js`; see
[scripting.md](scripting.md#script-triggers--event--script-bindings).

- `triggerEditForm(rec, isNew)` — **async** (fetches `/scripts` for the script picker).
- `saveScriptTrigger(existing)`, `triggerActorHint()`.
- Holds `TRIGGER_EVENT_CATALOG` (grouped datalist of every event emitted anywhere in
  `server/`+`plugins/` — a discoverability aid, not a whitelist; the field is free text)
  and `ACTORLESS_EVENTS` (events with no player in the payload, which warn in the form).

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

### `world-editor.js`
The World Map panel (`world`, `noEdit`) — every region on the global grid, drawn as one zoomable SVG. Distinct from `maps.js`: this edits **regions** (`/maps/regions`), not tiles. See [land-taxonomy.md](reference/land-taxonomy.md) for region vs. district vs. terrain.

- **Render**: `renderWorldEditor(data)`, `_wdToolbarHtml()`, `_wdSelectedBarHtml()`, `_wdWireChrome()`, `_wdWireSvg()`.
- **Viewport**: `_wdSetZoom()`, `_wdZoomLevel()`, `_wdFitBlock()`, `_wdClampView()`, `_wdGridLines()` — 10 zoom levels down to 6% of the full extent. Double-click is detected manually (`_wdLastClick`) because selecting re-renders the SVG.
- **Regions**: `_wdNewRegion()` / `_wdNewRegionDialog()` (size + base terrain), `_wdStageMove(id, dx, dy)` — drag-to-reposition, staged like every other write.
- Holds `_worldData`, `_worldSelected`, `_worldShowLegacy`, `_worldShowTerrain`, `_wdView`.

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
- **Crime registry**: `_loadCrimeConfig()` builds the per-crime rows (enable toggle + inline wanted-star weight input + witness mode). `toggleCrime(id, enabled)` and `saveCrimeStars(id, value)` both `PUT /crimes/:id` (partial: just the toggle or just the stars, clamped 0–5, reloaded live). The only place star weights are tuned.

### `broadcast.js`
The Broadcasts panel — list and modal editor for `media_broadcasts` assets.

- **Panel render**: `renderBroadcastsPanel(data)` — a sidebar (`_bcRenderSidebar`) plus an edit canvas, not a list table. `data` carries both `broadcasts` and `channels`. Auto-generated surveillance clips are hidden from the sidebar behind `_bcShowClips`.
- **VINE**: `broadcastOpenVine()` — opens the VINE broadcast graph editor (`VineBroadcastSchema`). A "VINE graph" badge appears when a graph is attached. Graph stored in `_broadcastGraph`.
- **Save**: `saveBroadcast()` — POST/PUT to `/broadcast/broadcasts/:id`, includes `broadcast_graph`.
- **Delete**: `deleteBroadcast(id, name)` — confirmation + DELETE.
- **Clone**: `cloneBroadcast(rec)` — POST with a new id.
- State globals: `_broadcastList`, `_bcChannels`, `_bcSelected` (record under edit), `_bcCards` (its message sequence), `_bcExpandedIdx`, `_broadcastGraph`, `_bcSuiteTab`.
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
- **Day scope** (the weekday-override editor — see [systems-broadcast.md](systems-broadcast.md#weekday-overrides--one-schedule-not-two-modes)): `_schedBuildDayBar()`, `_schedScopeHint()`, `_schedSetDay()`, `_schedOverrideGhost()`, `_schedDayChips()`, `_schedToggleDay()`, `_schedSetAllDays()`, and the mask helpers `_schedDayMask()`/`_schedDayBit()`/`_schedDayLabel()`/`_schedInScope()`/`_schedIsGhost()`/`_schedScopeMask()`. `_schedDay` = 0 (base grid) or 1–7 (that weekday's exceptions); it filters what the timeline draws and stamps `days` on anything created. Slot markup lives in `_schedItemHtml()`/`_schedGhostHtml()`, shared by the full build and the partial re-render.
- State globals: `_schedChannels`, `_schedBroadcasts`, `_schedNpcs`, `_schedDay`.

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

### `devlog.js`
Dev Log panel — curated team heads-ups (`change`/`heads-up`/`action-required` kinds) plus recent code activity pulled live from git.

### `flight.js`
Flight debug panel — charter pilot work status, the flight request log, and every aircraft instance (test-flight conjures, player buys, charter ghosts, wrecks). Deleting from here is the only cleanup path. Self-contained fetch (panel config `fetch` is a no-op), matching the bank/ATM pattern.

### `games.js`
`renderGamesPanel(data)` — active gametable (poker) tables, with a clear-all button.

### `gossip.js`
`renderGossip(data)` — inspector for the live in-memory gossip pool: per-row and clear-all delete, plus a "spread as NPC" form that plants a rumour at a chosen NPC's zone.

### `job-boards.js`
Job Boards panel — authors the `job_boards` table (jobboard plugin): quest pool picker, `rotation_size`, and `rotation_period` (stored in seconds, edited in hours).

---

## Root files

### `bsm-compiler.js`
`compileBsm(text)` — client-side compiler from `.bsm` broadcast scripts to a VINE graph + flat messages + assets (see [bsm-format.md](bsm-format.md)).

### `ghost-mode.js`
Ghost Mode — an in-panel floating dialog that opens a dedicated WebSocket tagged as a ghost session for live zone observation; the admin's real character never moves.

## `bootstrap.js`

**Loaded last.** Contains all code that executes immediately on script load:

- `let devSettings = loadDevSettings()` — initialises settings from `localStorage`.
- `applyDevSettings()` — applies theme/font/density before the first render.
- `window.addEventListener('storage', ...)` — syncs settings changes from other tabs.
- `document.addEventListener('DOMContentLoaded', ...)` — wires up the settings panel controls (theme select, font size buttons, density buttons).
- The password-field `keydown` listener (Enter → `devLogin()`).
- The auto-auth IIFE — checks `sessionStorage` for a token passed from the game client and skips the login screen if valid.
- **The ops-mode block** — sets `window.OPS_MODE` when the page was served at `/admin`, marks every nav entry whose panel can't write on prod with a `🔒` and `data-ops-ro`, injects the **show read-only** toggle at the top of the nav, adds `body.ops-mode`, and relabels the header.
- `setOpsShowReadonly()` / `applyOpsReadonlyVisibility()` — the toggle. Hides/shows the `data-ops-ro` entries (and any section header left standing over nothing), remembered in `localStorage` under `devpanel-ops-show-ro`.

### Ops mode (`/admin`) — one file, two views

`server/index.js` serves the *same* `client/devpanel/index.html` at `/dev` and `/admin`, and — when `CONTENT_READONLY` is set (production) — 302s the **bare** `/dev` path to `/admin`. Assets stay under `/dev/js/*` and are never redirected, which is what lets both views share one file and never drift.

**The `/admin` sidebar is 1:1 with `/dev`.** Nothing is pruned, because the server lets every read through and refuses every content write regardless — which makes a content panel on production exactly a viewer, and viewing is the whole point of being in there during a live bug. What varies is whether a panel can **write**.

Ops mode is a **UI affordance, not a security boundary**: the boundary is `contentReadonlyBlocks()` in `server/api/routes.js`, which already default-denies every content write on prod. Ops mode just stops the panel offering buttons that would 403 — and it mirrors the server's *shape*, default-deny, rather than listing content prefixes. Two places must agree:

- `OPS_WRITABLE_PANELS` in `js/core/panels.js` — the panels that can still write. `opsPanelReadOnly()` derives everything else, so nothing is authored on the nav entry in `index.html` any more.
- `OPS_WRITE_ROUTES` in `js/core/api.js` — a mirror of the server's `OPS_ROUTES` / `ENV_OPS_ROUTES` allowlists, which remain the actual authority.

Panels that mix ops and content read `window.OPS_MODE` directly: `panels/bank.js` hides ATM *networks*, terminal creation, and unit delete (all content writes) while keeping fill/repair/rename/settings (`/atm/units`, allowlisted).

#### Read-only panels

Every panel outside `OPS_WRITABLE_PANELS` is read-only on `/admin` — **Zones** (why can't they get out of this room), **NPCs** (where is she, what's her schedule), **Items** (what does this really do), **Broadcasts** (which channel owns which studio), and now the rest of the content tree with them.

A new panel needs **no** ops wiring at all: it is read-only by default, and only becomes writable by being named in `OPS_WRITABLE_PANELS` *and* having its routes allowlisted server-side.

Because the read-only half is most of the sidebar, it is **hidden by default** — the ops nav opens as the same short live-world list it always was, and the toggle at the top of the nav brings the rest back. That preference persists per browser.

What that buys:

- Writes are refused **client-side** by `opsReadonlyBlocks()` (checked by both `API` and `directAPI`), so a save returns a sentence explaining that content is edited locally and ships via CODEX — not a bare 403.
- `OPS_WRITE_ROUTES` keeps the live-ops actions that live *inside* content panels working — spawning a live enemy (`/zones/:id/live-enemies`), restocking a vendor (`/npcs/:id/restock`). These are runtime state, allowlisted server-side in `OPS_ROUTES`, and are part of why these panels are worth having on prod. Keep the two lists in step.
- `loadPanel()` raises the shared `#ops-ro-banner` (one wording for every read-only panel, so they can't drift), hides **+ New**, and sets `body.ops-ro-panel`, which hides every `.js-save-btn` / `.js-delete-btn` in `styles.css`.

Still not a security boundary — `contentReadonlyBlocks()` on the server remains the authority. This only changes what the panel *offers* and what it *says* when you try.
