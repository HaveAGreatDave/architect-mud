# gatewarn

**Purpose** — the one-time border briefing. The first time a player steps onto a tile carrying a `flags.gate_warning` string — the perimeter gates — the guards deliver that authored warning: what leaving the city costs you, and which regions lie past the Curtain. Then a `gate_warned:<zone>` player flag suppresses it forever.

## The split
The plugin owns **only the once-gating and the delivery**. The prose lives in **zone content**. Adding a new gate is authoring a flag, not editing this plugin.

## Events consumed
- `zone.entered`

## Commands
None.
