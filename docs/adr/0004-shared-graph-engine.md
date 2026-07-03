# One graph engine for Dialogue and Scripts

Dialogue is already a node graph (`dialogue_tree`), and the Script System the rework adds is also a
node graph whose steps dispatch Actions. Rather than build a second, independent graph editor and
runtime beside dialogue, we build **one** graph engine (`server/engine/graph.js` + one devpanel
editor) with shared node primitives: dialogue is "a graph of `say`/`option` nodes", a script is "a
graph of `action`/`branch`/`wait`/`setflag`/`condition` nodes". `Execute Script` is just a dialogue
node that runs a script graph.

## Consequences

- The visual node editor — the riskiest single client build — edits the *exact JSON the runtime already
  runs*, so scripts and dialogue remain hand-authorable (as `dialogue_tree` is today) before the editor
  is polished, and the editor can ship incrementally.
- Scripts call Actions only; they never mutate state directly (see ADR-0001). This is what keeps a
  designer-authored Script from bypassing validation or Event emission.
