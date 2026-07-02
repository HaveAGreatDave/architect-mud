# The Change Gate — "what kind of thing is this?"

Shared front-gate for every "add X to Architect MUD" request. `plugin-builder`, `engine-change`, and
`mud-designer` all run this **first**, then continue in their own workflow. Keep the routing logic here
so the skills can't drift apart. Basis: [engine-plugin-boundary.md](../../../docs/proposals/engine-plugin-boundary.md) §2.

**Read first (don't work from memory):** the boundary doc above, and [docs/plugins.md](../../../docs/plugins.md)
(command-precedence rule + catalogue — check whether something already owns this).

## Run the litmus tests in order, answer them out loud, then route

| The request is really… | Signal | Route to |
|---|---|---|
| **Content** | Retheme/retune, not re-code: NPC, item, zone, enemy, drug, recipe, dialogue, furniture, loot/scavenging table, VINE graph | **`mud-designer` skill** — DB via dev API. Never hardcode content into code. |
| **A substrate** | Two+ *unrelated* systems must read/write this state to decide things (position, weight, posture, a vital, cooldown, stain, light, protection, power…) | **`engine-change` skill** — engine, behind a mutation API. |
| **A law** | A rule about how a substrate behaves *no matter who touched it* (encumbrance blocks move, damage soaks, starvation, temp drift, death→corpse→respawn) | **`engine-change` skill** — engine; a law never names a system. |
| **A system / verb** | A leaf: nothing outside it reads its state, and it's something a player *does* or a reaction on an existing seam | **`plugin-builder` skill** — a plugin, however big. |
| **A tunable number** | A balance constant someone will want to change | `tunables.js` (or DB) — not a new code path. Usually part of one of the above, not its own task. |
| **Already owned** | A plugin/builtin already handles this verb or mechanic | Extend the existing owner. Check the [plugins.md](../../../docs/plugins.md) catalogue + `getRegisteredCommands()`. |

## The three tests that resolve most calls

1. **Substrate test** — do two+ unrelated systems read this value to make decisions? → engine substrate.
   (Posture: combat, movement, scavenging, butchering, appearance all read it → engine. Horniness: only
   MIS reads it → plugin.)
2. **Leaf test** — if nothing outside the system reads its state, it's a leaf → plugin, *however large*
   (MIS is 1,600 lines and a correct leaf).
3. **Total-conversion test** — would a different game on this engine keep the code byte-identical → engine;
   retheme or retune it → plugin or DB content.

## Two rules that override convenience

- **The interaction rule:** two systems may only meet in a **substrate, a law, a tag, an Action, or an
  event** — never by importing each other, never by an engine file naming a system. If your design needs
  plugin A to `import` plugin B, the design is wrong; find the shared substrate or the Action/event.
- **Don't over-extract / don't anchor a leaf.** Hubs (combat math, vitals laws, power/thermal sim,
  dispatch, SIFT) stay in the engine — extracting one just hides it behind a provider callback and adds a
  contract to break. Conversely, don't bolt a leaf into the engine because it's "core-ish." Extract leaves;
  anchor hubs.

**If the verdict is uncertain, say so and ask** — a wrong call here is the posture-bug class (two halves
silently disagreeing on a field). Cheap to prevent, expensive to find. When the request spans layers
(a plugin that needs a new substrate), split it: do the `engine-change` for the substrate first, then the
`plugin-builder` for the system on top.
