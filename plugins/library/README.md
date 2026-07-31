# library

**Purpose** — the *acquisition point* for the tablet's LIBRARY app. The books live in the `books` table and are read through `plugins/tablet/library-app.js`. This plugin exists so that the app **arrives** rather than simply being there.

## How the gate works
SCAN at furniture tagged `lending_terminal` sets the `library_unlocked` player flag — which is the **only** thing `library-app.js`'s `visible` gate checks. Before that scan the app is not on the home screen at all.

## The first scan
Prints an intro covering the four things that are not discoverable on your own: narration, minimize-and-keep-reading, the tap-to-gloss vocabulary layer, and per-book bookmarks. Later scans are a gentle no-op.

Examining a terminal teaches the verb once, via the house shimmer convention.

## Specialized actions
- `scan`

## Hooks
- `furniture.describe`

## Extension points
- `furniture.flags.lending_terminal`

## Leaf plugin
No table, no tick.

## See also
[docs/systems-library.md](../../docs/systems-library.md) — **read the copyright rule before adding a title.** The bar is US public domain. Not to be confused with [systems-codex.md](../../docs/systems-codex.md).
