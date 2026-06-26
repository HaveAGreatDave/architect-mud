# Action as the canonical state-mutation path

We introduced an **Action** primitive (`{type, actor, params, context}`) dispatched through a single
Action Dispatcher, and made it the *only* sanctioned way to mutate game state. Player Commands,
Dialogue nodes, Scripts, and NPC AI are all just *Sources* that build Actions — so they share one
validation, permission, and Event-emission path instead of each mutating the DB directly.

## Considered Options

- **Parallel Action API** (commands stay as-is; Actions only for scripts/dialogue) — rejected: creates two
  mutation paths that drift, and a Script could do things a Command can't (or vice versa).
- **Actions only for cross-system verbs** — rejected: fuzzy boundary, and the "scripts can't touch state
  directly" guarantee leaks the moment a verb isn't an Action.

## Consequences

- Commands that mutate become thin parsers that dispatch an Action; read-only commands (`look`, `map`,
  inventory display) stay plain handlers — making them Actions would be ceremony with no payoff.
- The 1-second enemy-combat tick stays raw and never routes through the dispatcher (latency). Only
  *player-initiated* combat becomes an Action.
- Porting every mutating command is the largest mechanical cost; done domain-by-domain behind a stable
  dispatcher with the old handler as fallback until each verb is ported.
