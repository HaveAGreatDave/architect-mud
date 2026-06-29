# Audit Prompt — Client ↔ Server Protocol Contract

A reusable prompt for finding **message-type drift** across the WebSocket seam. The server and the game
client agree on an *implicit* protocol: the server emits `{ type: "...", ...payload }` and the client
dispatches on `msg.type`. Nothing enforces that the two halves agree. This is the same bug class as the
engine/plugin source-of-truth split ([source-of-truth-audit.md](source-of-truth-audit.md)), but it
crosses the network instead of the plugin boundary, so it is **even quieter**: a mismatch produces no
error, no log, no crash — the message is silently dropped on the floor.

## Why this is silent

The client's entire dispatch is [dispatch.js](../../client/game/js/dispatch.js):

```js
export function handleServerMsg(msg) {
  const handler = handlers[msg.type];
  if (handler) handler(msg);          // no else — unknown type vanishes
}
```

There is **no `else`**. A server message whose `type` has no entry in the `handlers` map is discarded
with zero feedback. Symmetrically, a `handlers` entry whose `type` the server never emits is dead UI
code that looks live. And a handler that reads `msg.foo` when the server sends `msg.bar` runs
successfully on `undefined` — the worst kind of "works in isolation" bug.

We already have one live instance of shape drift: the `player_update` handler
([dispatch.js:253](../../client/game/js/dispatch.js#L253)) does `Object.assign(state.player, msg)` —
reading the **top-level message** — while almost every sibling handler reads a nested
`msg.player_update` object. Both shapes exist in the codebase for the same logical concept.

## How to run

Paste the prompt below to an agent (or work it yourself). Scope it to **one direction at a time**
(server→client first, it's the larger surface) or to **one subsystem's message family** (combat
messages, ATM messages, broadcast/TV messages). The cross-referencing is the work; a focused pass is
far more reliable than "audit the whole protocol."

---

## Prompt

> You are auditing the Architect MUD codebase for **drift across the client↔server WebSocket protocol**.
> There is no schema; the contract is implicit. Background to internalize first: the game client dispatch
> is [client/game/js/dispatch.js](../../client/game/js/dispatch.js) — a `handlers` map keyed by
> `msg.type`, with `handleServerMsg` silently ignoring any unknown type (no `else`). Client→server
> messages are sent from [client/game/js/net.js](../../client/game/js/net.js) (`sendCmd`,
> `sendCmdSilent`, `sendDialogue`, `buyFromNpc`, `sendRaw`) and a few panels. The server side lives in
> [server/index.js](../../server/index.js) (`handleAuth`, `handleGameCommand`, the WS `message`
> dispatch) and every `send(...)`/`broadcast(...)` call across `server/`.
>
> Audit scope: **<NAME THE DIRECTION + FAMILY, e.g. "server→client combat & loot messages">**. Do this:
>
> 1. **Enumerate the emitted types.** Grep `server/` for `type:` in objects passed to the WS send
>    helpers. Build the set of `type` strings the server can emit in scope. Note the **payload keys**
>    next to each `type` (e.g. `combat` carries `message`, `killed`, `corpseLink`).
>
> 2. **Enumerate the handled types.** List the keys of the `handlers` map in `dispatch.js` in scope, and
>    the `msg.*` fields each one reads.
>
> 3. **Diff the two sets.**
>    - `type` emitted by server but **absent** from `handlers` → silently dropped at the client. Report
>      it; trace whether the drop is intended (some server output is informational) or a real gap.
>    - `type` in `handlers` but **never emitted** by the server → dead client code. Confirm by grepping
>      the whole server, not just the obvious file.
>
> 4. **Diff the payload shapes** for every type present on both sides. For each field the handler reads
>    (`msg.foo`), confirm the server actually sets `foo` on that message, with the same shape (flat vs
>    nested, string vs object, id vs full record). Flag every mismatch — these are the
>    `Object.assign(state.player, msg)` vs `msg.player_update` class of bug. Pay special attention to
>    `player_update` / `player` / vitals payloads, which are inconsistent today.
>
> 5. **Check the reverse direction too** when in scope: every client→server message
>    (`{ type: 'command' | 'auth' | 'auth_reconnect' | 'auth_token' | 'dialogue' | 'buy_npc' | ... }`)
>    must have a matching branch in the server's WS message dispatch. A client message type the server
>    doesn't switch on is a dead button.
>
> 6. **Verify, don't theorize.** For a suspected dropped/dead message, prove it: drive the server over
>    the WebSocket (`{type:"auth",username,password}` then `{type:"command",command:"…"}`) and watch the
>    frames, or add a temporary `console.warn` in the `handleServerMsg` no-handler path to surface every
>    unhandled type during a play session. A claim of "this message is dropped" must be demonstrated.
>
> 7. **Report**, per finding: the `type` · direction · which side is missing/mismatched · the exact field
>    shape drift · the minimal fix (add the handler, delete the dead one, or align the field name — pick
>    ONE canonical shape) · whether the protocol should be recorded. Keep changes surgical (per
>    CLAUDE.md); do not "tidy" adjacent handlers.

---

## Standardization this audit should push toward

The protocol is currently undocumented and shape-inconsistent. Where this audit finds harmony missing,
push toward these conventions (and note deviations rather than silently "fixing" working code):

- **One payload shape for player state.** Pick `msg.player_update` (a nested patch object) *or* top-level
  fields, not both. `player_update` reading `msg` directly ([dispatch.js:253](../../client/game/js/dispatch.js#L253))
  is the odd one out.
- **`type` naming.** Today both flat snake_case (`zone_event`, `combat_incoming`) and dotted namespaces
  (`environment.clockTick`, `environment.sync`) coexist. Decide the rule (namespaces for subsystem feeds,
  flat for one-off messages?) and apply it — see [naming-registry-harmony-audit.md](naming-registry-harmony-audit.md).
- **No silent drop in `handleServerMsg`.** Consider a `console.warn` in the no-handler path (dev builds
  only) so future drift is loud, not silent.

## Checklist (quick manual version)

- [ ] Read [dispatch.js](../../client/game/js/dispatch.js) `handlers` map + [net.js](../../client/game/js/net.js) senders.
- [ ] Grep `server/` for every `type:` sent to a WS helper → the emitted set.
- [ ] Emitted-but-unhandled? (silent drop) — list each, judge intended vs gap.
- [ ] Handled-but-never-emitted? (dead UI) — grep the *whole* server to confirm.
- [ ] For each shared type, does every `msg.field` the handler reads actually get set, same shape?
- [ ] Every client→server `type` has a server dispatch branch?
- [ ] Prove one finding live (WS client or a temporary warn) before changing code.
- [ ] Align on ONE player-state payload shape; record the protocol if a doc exists for the subsystem.
