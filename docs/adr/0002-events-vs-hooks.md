# Events and Hooks are two distinct mechanisms

The engine keeps **two** extension mechanisms with different contracts rather than one: **Hooks**
(`fireHook`, "last non-undefined return wins") are *request/response* — the caller uses the return
value. **Events** (new `emit`/`on`) are *fire-and-forget* — fan-out to subscribers, return value
ignored, errors isolated, order-independent. The rule: if a caller needs a value back, it's a Hook;
if you're announcing that something already happened (past-tense name), it's an Event.

## Why not unify

A single mechanism that both collects return values and fans out muddies the guarantee that makes
Events safe to subscribe to — that a new subscriber can never change the outcome of the thing it
observes. The Action Dispatcher emits Events after every successful mutation precisely so unrelated
systems (e.g. Quests) can react without the mutating code knowing they exist; that decoupling only
holds if Events are return-less by contract.

## Consequences

- Existing notification-style hooks (`tick.minute`, `player.death`, `zone.create/update/delete`) migrate
  to Events during the port. Genuine request/response hooks (`zone.describeRoom`, `worldValidator.*`)
  stay Hooks.
