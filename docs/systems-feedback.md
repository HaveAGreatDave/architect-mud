# Player feedback

**Status:** Built.

Players send bugs, typos and ideas from the ⚑ button at the top right of the game client, or with `feedback [bug|idea|typo] <text>`. Each report is stored with where the player was, what they were doing and what their client was doing, and staff read them in the dev panel. The code is [plugins/feedback](../plugins/feedback/README.md).

## The path

1. The ⚑ button (`#feedback-btn` in `client/game/index.html`) opens `showFeedbackDialog` from `client/game/js/panels/confirm.js`: a category, a text box (2000 characters) and Send. Ctrl+Enter sends; keys typed in the form are stopped there, so a seat that owns the keyboard never sees them.
2. `client/game/js/feedback-telemetry.js` sends `{type:'feedback', category, text, client}` with `sendRaw`.
3. The `feedback` route in `server/index.js` only emits `feedback.submit`. It shares the normal message flood bucket.
4. The plugin checks the cooldown (one a minute per player), validates, builds the server context, writes one row and answers `feedback_ok` (the client prints the report number) or `feedback_err` (the form reopens with the text and the reason).

The verb takes the same `submit()` path with no client telemetry.

## What's recorded

**Server** (`server_ctx`), read from the live player and the world Maps with no queries:

- the player's id, handle and role;
- the zone (id, name, map and grid position), its map anchor (`powerAnchorOf`), region and district;
- posture, `sittingOn`, aircraft and seat, sleeping, in combat, display rung;
- hp, max hp and statuses;
- the game clock and the server time.

**Client** (`client_ctx`), read at send time:

- path, user agent, language, viewport and DPR, the density and pane-claimed flags, display rung, current zone;
- the renderer (GLASS 1 or 2, cloud volume state) and the FPS meter's summary if it's on;
- whether a seat holds the keyboard, and which windows and panels are open;
- the last 30 lines of the log and the last 10 uncaught errors, from a ring installed in `main.js`.

Client telemetry over 16 KB is replaced by a size note. There are no screenshots.

## Storage

`player_feedback` in `SCHEMA_SQL`: a runtime table, not in the content registry, so it never reaches `content/`. A row is a few KB. The inbox list selects previews only; the JSONB is read one report at a time.

## Staff

- **Dev panel:** the ⚑ Feedback tab lists reports by status (open, seen, fixed, wontfix) with counts. Clicking a row shows the full text and telemetry, sets the status and a staff note, and copies the report as markdown for a GitHub issue.
- **Discord:** set `FEEDBACK_WEBHOOK_URL` and each report also posts the number, category, handle, location and the first 300 characters. Telemetry and the player id never go out. A failed post is logged and dropped.
- **Routes** (`/api/feedback/…`, staff roles only): listed in the plugin README.
