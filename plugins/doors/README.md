# doors

**Purpose** — the door domain. The four specialized actions every lockable interactable needs, plus the hacking resolve.

## Specialized actions
- `open` · `close` · `lock` · `unlock` · `hack`

## Commands
- `hackresolve` — silent client callback from the hack minigame; never typed.

## What a lock says about itself
A lock type's `defaults` carry two fields the engine reads back out of the registry rather than
hard-coding: **`canHack`**, which decides whether `hack` will target it at all, and **`noun`**, what
to call it in a line of prose ("hololock", "shutter", "shop lock"; anything without one is just a
lock).

⚠ **`canHack` had no reader until 2026-09-19.** `isHackableLock` and `hackDoor` named `lock:hololock`
and nothing else, so every other lock type's `canHack` was a field nobody looked at — `lock:shopshutter`
has declared `canHack: true` since the storefront plugin was written and could never be hacked: the
verb returned `undefined` for it and fell through to the next handler, so a player working a shop
shutter got an answer about a safe. The registry is the authority on what a lock is; a second one in
the hack path is how a lock type ships with a capability nobody can reach.

## See also
The engine half lives in `server/engine/commands/doors.js`, which owns the forcefield interaction — a door protecting an already-forcefielded unit refuses both the hack (at arm and at resolve) and a physical bash.
