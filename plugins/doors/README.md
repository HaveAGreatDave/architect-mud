# doors

**Purpose** — the door domain. The four specialized actions every lockable interactable needs, plus the hacking resolve.

## Specialized actions
- `open` · `close` · `lock` · `unlock` · `hack`

## Commands
- `hackresolve` — silent client callback from the hack minigame; never typed.

## See also
The engine half lives in `server/engine/commands/doors.js`, which owns the forcefield interaction — a door protecting an already-forcefielded unit refuses both the hack (at arm and at resolve) and a physical bash.
