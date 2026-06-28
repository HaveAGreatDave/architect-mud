# VINE — Visual Interaction Node Editor

VINE is the dev panel's graph editor for authoring structured data that has conditional branching and sequential flow — currently dialogue trees (NPCs) and script graphs (scripted events). It lives entirely in `client/devpanel/js/vine/`.

---

## Architecture

VINE is split into four layers:

| File | Role |
|---|---|
| `vine-core.js` | Generic DOM/SVG graph editor — nodes, edges, drag, pan/zoom, undo, properties panel |
| `vine-edges.js` | Bezier edge rendering, obstacle avoidance, gradients |
| `vine-schema-dialogue.js` | Dialogue tree node types, form editor, graph ↔ JSON conversion |
| `vine-schema-script.js` | Script graph node types, form editor, graph ↔ JSON conversion |
| `vine-action-types.js` | Catalogue of all action types and their parameter definitions |
| `vine-history.js` | Undo/redo command stack |

**Engine vs. content:** `vine-core.js` knows nothing about dialogue or scripts. All domain logic lives in schema files. To add a new use case, write a schema object and pass it to `new VineEditor(container, schema)`.

---

## Core (`vine-core.js`)

### `VineEditor`

Instantiate with a container element and a schema:

```js
const editor = new VineEditor(containerEl, schema);
editor.load(graphData);   // populate
editor.save();            // returns { nodes, edges, _view }
editor.destroy();         // clean up DOM + listeners
editor.on('change', fn);  // fired on any mutation
editor.on('nodeSelect', fn); // fired with nodeId when a node is selected
```

#### Internal layout

```
containerEl (flex row)
├── _area (flex:1, overflow hidden)
│   ├── _canvas (div, absolutely positioned, transform-scaled)   z-index:2
│   ├── _svg   (SVG, inset:0, pointer-events:none)               z-index:1
│   └── _toolbar (absolute, top-left)                            z-index:30
└── _props (280px, right panel)
```

Nodes are absolutely positioned `div`s inside `_canvas`. Edges are `<path>` elements inside `_svg`. Because nodes are z-index:2 and edges z-index:1, nodes always render above edges at rest.

**During drag:** the dragged node goes to z-index:4 and the SVG to z-index:3, so the moving node's connections are visible above all sibling nodes.

#### Graph data format

```js
{
  nodes: {
    nodeId: { type: string, x: number, y: number, data: { ...schemaSpecific } }
  },
  edges: [
    { fromNode: string, fromPort: string, toNode: string }
  ],
  _view: { x: number, y: number, scale: number }  // optional, preserved on save
}
```

#### Controls

| Action | How |
|---|---|
| Pan | Middle-click drag, or Alt+left-drag |
| Zoom | Ctrl+scroll |
| Select node | Click node body |
| Select all | Ctrl+A |
| Delete selected | Delete / Backspace |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |
| Draw edge | Drag from an output port dot (●) to another node's input dot |
| Delete edge | Click an existing edge |

---

## Edge Rendering (`vine-edges.js`)

All edges are cubic bezier `<path>` elements. `VineEdges.render()` is stateless and called on every graph change.

### Visual language

| Edge type | Colour | Shape |
|---|---|---|
| Forward (left→right) | `--accent2` → `--accent` gradient | S-curve |
| Backward / loop | `--accent3` solid | U-curve routing below both nodes |
| Temp wire (mid-draw) | `--accent2` → `--accent3` gradient, dashed | S-curve |

- **`--accent2` (green)** is used at the **output / source** end — the "end" of the originating node.
- **`--accent` (pink)** is used at the **input / destination** end — the "beginning" of the receiving node.

This makes flow direction readable from colour alone.

### Obstacle avoidance

Forward edges sample 5 points along the default bezier and check whether any intermediate node's bounding rect is intersected. If so, the control points are nudged above or below to route around the obstacle. The shorter detour is always chosen.

### Temp wire gradient

The `#vine-wire-grad` SVG linearGradient lives permanently in the SVG `<defs>`. Its `x1/y1/x2/y2` endpoints are updated on every `mousemove` tick, so the gradient always follows the actual wire direction in real time.

---

## Schemas

A schema is a plain object:

```js
{
  nodeTypes: {
    typeName: {
      label: string,          // shown in toolbar "+ Add" button and node header
      color: string,          // node header background (CSS color or var())
      defaultData: {},        // cloned when a new node is created

      renderBody(node) → htmlString,
      // Renders the preview content inside the node card.

      getOutPorts(node) → [{ key, label }],
      // Returns the list of output port dots to render.
      // Each port key matches the fromPort in an edge.

      renderProperties(node, editor, nodeId) → htmlString,
      // Returns HTML for the right-hand properties panel.
      // Elements with data-vine-field="data.foo" are auto-bound by vine-core.

      afterRenderProperties(propsEl, node, editor, nodeId),
      // Optional. Called after propsEl.innerHTML is set and data-vine-field
      // bindings are wired. Use for complex DOM-driven UIs (list editors, etc.).
    }
  }
}
```

### `data-vine-field` bindings

Any `input`, `textarea`, or `select` inside `renderProperties` HTML with `data-vine-field="data.foo"` is automatically bound: changes update `node.data.foo` and fire `change`. Supported modifiers:

- `data-vine-type="json"` — parses value as JSON before storing
- `data-vine-type="number"` — coerces to Number
- `data-vine-instant` — binds `input` event instead of `change` (live preview)

### `afterRenderProperties`

For UIs that can't be expressed as static HTML + data-vine-field (list editors, dynamic action pickers), implement `afterRenderProperties(propsEl, node, editor, nodeId)`. It receives the live DOM element after insertion. Mutate `node.data` directly and call `editor._refreshNodeDisplay(nodeId)` + `editor._renderEdges()` + `editor._fire('change')` to keep the canvas in sync.

---

## Dialogue Schema (`vine-schema-dialogue.js`)

### Node type: `dialogue`

Represents one NPC beat: what the NPC says, what options the player can pick, and what actions fire when the node is entered.

**Data shape:**
```js
{
  text: string,          // NPC speech
  options: [
    {
      text: string,      // player-facing choice label
      enabled: boolean,
      conditions: [],    // flag/stat conditions (JSON, checked at runtime)
      actions: [],       // actions that fire when this option is chosen
      // 'next' is NOT stored here — it's a VINE edge
    }
  ],
  actions: []            // actions that fire when this node is entered
}
```

**Out ports:** one port per option (`opt_0`, `opt_1`, …). If there are no options, a single `fallthrough` port is shown.

**Properties panel:** fully visual form editor:
- NPC Text — textarea with live preview on the node card
- Options — card list with text input, enabled toggle, per-option actions picker, conditions JSON
- Node Actions — action type picker with dynamic param fields

### Conversion helpers

```js
VineDialogueSchema.fromDialogueTree(tree)   // dialogue_tree JSONB → VINE graph
VineDialogueSchema.toDialogueTree(vineGraph) // VINE graph → dialogue_tree JSONB
```

The `_vine: { x, y }` key is embedded in each tree node to preserve layout positions across saves.

---

## Script Schema (`vine-schema-script.js`)

### Node types

| Type | Colour | Out ports | Purpose |
|---|---|---|---|
| `action` | Blue | `next` | Run a single action (from VineActionTypes) |
| `setflag` | Amber | `next` | Set or clear a player/world flag |
| `condition` | Red | `ifTrue`, `ifFalse` | Branch on a flag condition |
| `say` | Green | `next` | Output text to the player |
| `wait` | Steel | `next` | Pause execution N seconds |
| `script` | Purple | `next` | Run another script by ID |

### Conversion helpers

```js
VineScriptSchema.fromScriptGraph(graph)    // script JSON → VINE graph
VineScriptSchema.toScriptGraph(vineGraph)  // VINE graph → script JSON
```

---

## Action Types (`vine-action-types.js`)

`window.VineActionTypes` is an array of action definitions used by both the dialogue and script properties panels to build action pickers:

```js
{
  type: 'GRANT_ITEM',
  label: 'Give Item',
  params: [
    { key: 'item_id', type: 'text',    label: 'Item ID',  required: true },
    { key: 'quantity', type: 'number', label: 'Quantity', default: 1 },
    { key: 'once',    type: 'boolean', label: 'Once only', default: true },
  ]
}
```

Supported param types: `text`, `number`, `boolean`, `select` (with `options` array), `json`.

The full list of action types: `GRANT_ITEM`, `REMOVE_ITEM`, `START_QUEST`, `COMPLETE`, `TURN_IN`, `OPEN_SHOP`, `OPEN_BANK`, `OPEN_STORAGE`, `OPEN_CRAFTING`, `TELEPORT`, `EXECUTE_SCRIPT`, `TRIGGER_EVENT`, `SET_FLAG`, `CLEAR_FLAG`, `END_CONVERSATION`, `GOTO_NODE`.

---

## Auto-layout

The ⟳ Auto-layout toolbar button runs a Sugiyama-style layered layout:

1. **Back-edge detection** — DFS identifies edges that create cycles so they're excluded from layering (they render as U-curves regardless of position).
2. **Longest-path layering** — Kahn's topological BFS assigns each node to the rightmost column possible given its dependencies. Source nodes (no incoming edges) land in column 0.
3. **Barycenter cross-minimisation** — 3 forward + 3 backward sweeps reorder nodes within each column by the average rank of their neighbors in the adjacent column, reducing crossing count.
4. **Position assignment** — fixed 320px column width, 180px row height, origin at 40,60.

Auto-layout is undoable (Ctrl+Z restores previous positions).

---

## Opening VINE

VINE is opened via a full-screen modal. From any panel:

```js
vineModalOpen(
  title,      // shown in modal header
  schema,     // VineDialogueSchema or VineScriptSchema
  graphData,  // { nodes, edges } or {} for a blank graph
  onSave      // callback(savedGraph) — called when user clicks Save & Close
);
```

The active editor instance is also exposed at `window._vineActiveEditor` for console access during development.

---

## Broadcast Schema (`vine-schema-broadcast.js`)

Node types for the visual broadcast script editor. Saved to `media_broadcasts.broadcast_graph`.

### Node types

| Type | Out ports | Purpose |
|---|---|---|
| `start` | `next` | Entry point. One per graph. |
| `say` | `next` | Push a line to viewers. Stops execution for this tick. `style: raw\|ticker`. |
| `ticker` | `next` | Push `>> text <<` formatted ticker line. |
| `npc_anchor` | `next` | Set the active NPC voice — prefixes say nodes with `[NPC Name]`. |
| `inject_news` | `next` | Pull from news queue (category-filtered); fallback text if queue empty. |
| `camera_cut` | `next` | Read a live zone description, push as `[CAM: label] …`. |
| `break` | `next` | Natural cut-point; drains news queue inline. Lets urgent news interrupt a show cleanly. |
| `condition` | `ifTrue`, `ifFalse` | Branch on a world condition (synchronous). |
| `wait` | `next` | Pause N seconds for this channel only. |
| `loop` | `next` | Jump to connected node, or `_start` if unconnected. |
| `random` | N branch ports | Weighted random branch. |
| `set_flag` | `next` | Set a world flag. |

Conditions available: `IS_DAYTIME`, `VIEWERS_PRESENT`, `NEWS_AVAILABLE`, `HOUR_RANGE`, `RANDOM_CHANCE`.

### Conversion helpers

```js
VineBroadcastSchema.fromBroadcastGraph(dbGraph)  // DB JSONB → VINE graph
VineBroadcastSchema.toBroadcastGraph(vineGraph)   // VINE graph → DB JSONB
```

Auto-layout runs when a graph has no `_vine` position data. See [`docs/systems-broadcast.md`](systems-broadcast.md) for the full runtime description.

---

## AI Schema additions (`vine-schema-ai.js`)

Two entries were added to the AI catalogue to support broadcast-aware NPC behaviour:

**Condition:** `CHANNEL_HAS_VIEWERS` — params: `channel_id`. Synchronous check via `broadcast-bridge.js`.

**Action:** `BROADCAST_SAY` — params: `channel_id`, `text`. Emits `npc.broadcast_say`; the broadcast plugin queues the text on the target channel.

---

## Adding a New Schema

1. Create `client/devpanel/js/vine/vine-schema-yourtype.js`.
2. Define `window.VineYourTypeSchema = { nodeTypes: { ... } }`.
3. Add a `<script>` tag for it in `client/devpanel/index.html` after `vine-core.js`.
4. Call `vineModalOpen(title, VineYourTypeSchema, data, onSave)` from wherever it's needed.

No changes to `vine-core.js` or `vine-edges.js` are required.
