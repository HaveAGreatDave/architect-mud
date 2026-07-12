# idle-logoff

**Purpose** — disconnects players who stop driving their client. An
unattended-but-connected client holds a WebSocket, keeps triggering the
per-player survival ticks (and their DB writes), and pads the online roster.
15 minutes without deliberate input earns a warning; 20 minutes severs the
link. Applies to **everyone** — no role or combat exemptions, by design.

## Hooks

- `tick.minute` — sweeps all live players once a minute. At `IDLE_WARN_MS`
  (15 min) sends a one-per-idle-stretch `system` warning; at `IDLE_KICK_MS`
  (20 min) sends `kicked` — the same message type the admin kick uses, so the
  client shows the reason, closes the socket, and the server's normal ws-close
  logout cleanup runs. If a client ignores `kicked` it is re-sent each minute.

## The activity contract (split-system)

The engine's WS dispatcher (`server/index.js`) stamps
`player._lastInputAt` (epoch ms, **runtime-only, never persisted**) on
deliberate player messages: non-silent `command`, `dialogue`, the NPC shop
ops (`buy_npc`/`sell_npc`/`sell_all_npc`/`shop_close`), and `mis_toggle`.
Excluded on purpose:

- app-level `ping` keepalives and the auth handshakes
- client automation — `sendCmdSilent` (post-move look refresh, tablet re-nav
  polls) tags its payload `silent: true`, so a parked client still reads idle

This plugin owns the read side and the thresholds. A player never stamped
(fresh login, no input yet) has the clock seeded at first sweep.

## Transient player state (in-memory, never persisted)

- `player._lastInputAt` — epoch ms of the last deliberate input (stamped by the engine)
- `player._idleWarnedAt` — epoch ms of the last warning; a newer `_lastInputAt` re-arms it
