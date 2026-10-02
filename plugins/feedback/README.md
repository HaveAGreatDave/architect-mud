# feedback

**Status:** Built.

Players send feedback from the ⚑ button at the top right of the game client or with the `feedback` verb. Each report is stored with where the player was and what they were doing, and staff read them in the dev panel's ⚑ Feedback tab. See [docs/systems-feedback.md](../../docs/systems-feedback.md).

## Verbs

| Verb | What it does |
|---|---|
| `feedback [bug\|idea\|typo] <text>` | Sends a report. A leading category word sets the category; anything else is `other`. Bare, it prints usage. |

## How it works

- The client sends `{type:'feedback', category, text, client}`. The engine route in `server/index.js` only emits `feedback.submit`; this plugin validates it and answers `feedback_ok` or `feedback_err`.
- `submit()` is the one write path, shared by the route and the verb: cooldown check, `validate()`, `serverContext()`, one INSERT, then the optional webhook.
- `serverContext()` reads the live player and the world Maps only, with no queries.
- Discord: set `FEEDBACK_WEBHOOK_URL` and each report posts the category, handle, location and the first 300 characters. No telemetry and no player id go out.

## Limits

- 2000 characters of text. Client telemetry over 16 KB is replaced by a size note.
- One report a minute per player, held in RAM. A failed write doesn't start the cooldown.

## Data

`player_feedback` (in `SCHEMA_SQL`). Runtime only: not in the content registry, so it's never exported to `content/`.

## Routes (staff only)

| Route | What it does |
|---|---|
| `GET /api/feedback/list[/<status\|all>[/<offset>]]` | 50 rows, newest first, previews only, plus counts per status |
| `GET /api/feedback/<id>` | One report with its telemetry |
| `POST` or `PATCH /api/feedback/<id>` | Sets `status` (open, seen, fixed, wontfix) and/or `staff_note` |
