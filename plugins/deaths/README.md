# deaths

**Purpose** — the obituary column. Catalogues every player death off the `player.death` broadcast and reports it through the `deaths` command.

## The deliberate ignorance
This plugin **knows nothing about what can kill you**. Causes of death are supplied by the killing systems in their broadcast; adding a new way to die requires no edit here. That is the whole reason it is a listener and not a participant.

## Commands
- `deaths` — the recent dead.

## Events consumed
- `player.death`

## Data schema
- `player_deaths`
