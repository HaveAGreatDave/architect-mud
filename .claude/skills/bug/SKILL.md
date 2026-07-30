---
name: bug
description: Turn a rambled bug report into a well-formed GitHub issue on HaveAGreatDave/architect-mud, and manage the issue backlog (list, triage, close, comment). Use when the user describes something broken/wrong/missing and wants it PARKED for later rather than fixed now — "log that", "file that", "add that to the list", "issue for that", "note this for future fixing", "what's on my bug list", "close that one". Do NOT use when the user wants the bug fixed in this session.
---

# bug — ramble in, clean GitHub issue out

The user's workflow: they play/browse the MUD, notice something broken, and **ramble at you**. You do the
rest — figure out what system it touches, check nothing like it is already filed, write the issue in
their voice but structured, and file it. They never open GitHub themselves.

Repo: `HaveAGreatDave/architect-mud` (the `origin` remote). `gh` is authed as `akerson`. Every command
below runs from the repo root.

## The one rule about scope

**This skill files. It does not fix.** If the user is clearly asking for a fix right now, don't invoke
this — just fix it. If they say "log it *and* fix it", file first (so it survives if the session dies),
then fix, then close the issue with a commit reference.

Never "helpfully" start investigating the code deeply before filing. A quick grep to name the right file
is fine; a debugging expedition is not. Filing should take one round of tool calls.

## Procedure

### 1. Read the ramble for the four things an issue needs

Extract what you can. Do **not** interrogate — the whole point is low friction.

| Field | What you're after | If missing |
|---|---|---|
| **What happened** | the observed wrong behavior | ask — this is the only thing you can't invent |
| **Where** | zone / verb / client screen / system | infer from the words, or leave `unknown` |
| **Expected** | what should have happened | infer from the system's doc; mark it as your inference |
| **Repro** | what they were doing | write what they said, verbatim-ish; `not captured` is acceptable |

**Ask at most one clarifying question, and only if the report is genuinely unactionable.** "The elevator
is weird" gets one question. "The elevator drops me on the wrong floor when I board from the roof" gets
filed immediately.

If the ramble contains **several distinct bugs**, file them as **separate issues** — one issue per
defect. Say so in your summary. Related-but-same-root-cause stays as one issue.

### 2. Locate it in the codebase (cheaply)

Map the report to a system so the issue is actionable six weeks from now:

- Check [CLAUDE.md](../../../CLAUDE.md)'s doc index for the owning `docs/systems-*.md`.
- Check [docs/plugins.md](../../../docs/plugins.md) if a **verb** is involved — the plugin owns it, the
  engine handler is probably dead code.
- One `Grep` for the verb name / error string to name a likely file is worth it. Two is the budget.

Put the result in the issue as a **Likely location** line with a `path/to/file.js:line` reference when
you have one, hedged (`likely`, `starts around`) if you didn't verify it.

### 3. Check for duplicates — always, before creating

```bash
gh issue list --state open --limit 100 --json number,title,labels
```

Then search the text of any that look close:

```bash
gh issue view <n>
```

- **Clear duplicate** → don't file. Add the new detail as a comment on the existing issue
  (`gh issue comment <n> --body "..."`) and tell the user which issue it joined.
- **Related but distinct** → file new, and cross-reference (`Related: #<n>`) in the body.
- **Unsure** → file new with `Possibly duplicates #<n>`. A duplicate is cheaper than a lost bug.

Note: issues titled `🚨 prod content deploy is failing` with the `deploy-stall` label are opened
**automatically by CI**, not by hand. Never dedupe a gameplay bug against one, and don't close one
manually — it closes itself when a deploy goes green.

### 4. Write the issue

**Title**: one line, specific, present tense, no severity prefix — the label carries that.
Good: `Elevator deposits player on boarding floor instead of destination`.
Bad: `elevator bug`, `BUG: elevator is broken (HIGH PRIORITY)`.

**Body** — this exact skeleton, omitting any section that would be empty:

```markdown
**What happens**
<one or two sentences, plain>

**Expected**
<what should happen — mark inferred guesses as such>

**Repro**
<steps or the situation as described; "not captured" is fine>

**Likely location**
`server/foo.js` — <one clause on why>. Owning doc: [docs/systems-x.md](docs/systems-x.md).

**Notes**
<anything the user said that doesn't fit above — tone complaints, hunches, "this started after the
broadcast change">

---
*Filed from a play session on <YYYY-MM-DD>.*
```

Keep the user's own phrasing where it's vivid. Don't sand it into corporate QA prose — this is their
backlog, it should sound like them.

### 5. Label it

Use the labels that exist (`gh label list`). The repo has the GitHub defaults plus `deploy-stall`.

- **Type** — exactly one: `bug` (broken), `enhancement` (missing/wanted), `documentation` (doc is
  wrong or stale).
- **Severity** — exactly one of `sev:blocker` / `sev:major` / `sev:minor` / `sev:polish`.
- **Area** — one `area:<system>` matching the `docs/systems-<x>.md` slug (`area:combat`,
  `area:broadcast`, `area:flight`, `area:economy`, `area:world`, `area:client`, `area:devpanel`,
  `area:pipeline`…). Use the doc slug, not a synonym, so areas stay a closed set.

Severity and area labels **may not exist yet**. Create on demand before use — this is idempotent and
safe to run every time:

```bash
gh label create "sev:major" --color "d93f0b" --description "Severity: major" --force
```

Palette: `sev:blocker` `#b60205`, `sev:major` `#d93f0b`, `sev:minor` `#fbca04`, `sev:polish` `#c2e0c6`,
any `area:*` `#1d76db`.

Severity is **your** call from the report, stated in your summary so the user can push back:

- **blocker** — unplayable, data loss, prod down, or a wipe of player state
- **major** — a system is wrong or unusable, but the game runs
- **minor** — wrong but survivable; a workaround exists
- **polish** — cosmetic, prose, tone, alignment

### 6. File it

```bash
gh issue create --title "..." --body-file <scratchpad>/issue.md --label "bug" --label "sev:major" --label "area:combat"
```

Write the body to a file in the scratchpad rather than inlining it — `--body` with newlines and the
project's Unicode glyphs (`₵ ⚙ ☢ ╱`) through PowerShell quoting is how you get mojibake in a permanent
public record. Write the file **UTF-8 without BOM** (the `Write` tool does this).

**File without asking for confirmation.** The user has standing authorization for this workflow — that's
the entire point of the skill. Two exceptions where you ask first: you're about to file **more than
three** issues from one ramble, or you think it's a duplicate but aren't sure enough to just comment.

### 7. Report back

One or two lines. Always include the clickable URL:

> Filed [#23 — Elevator deposits player on boarding floor](https://github.com/HaveAGreatDave/architect-mud/issues/23) · `bug`, `sev:major`, `area:world`. Called it major since the car still moves. Related: #16.

Then stop. Don't offer to fix it, don't summarize the codebase, don't propose a plan. They'll ask.

## Backlog management (same skill, other direction)

**"What's on my list?"** — group by severity, newest first, one line each; don't dump raw `gh` output:

```bash
gh issue list --state open --limit 100 --json number,title,labels,createdAt
```

**"That one's fixed" / "close that"** — resolve which issue they mean (ask if genuinely ambiguous),
then close with a reason:

```bash
gh issue close <n> --comment "Fixed in <sha> — <one clause on what changed>."
```

If it was fixed in this session, include the commit sha. If they just want it gone, close it with
`--reason "not planned"` and say which one you closed.

**"Add to that one"** — `gh issue comment <n> --body-file <scratchpad>/comment.md`.

## Failure modes

- **`gh` not authed / network down** — do not silently drop the report. Append it to
  `docs/bug-inbox.md` (create it, one `## <date> — <title>` block per report), tell the user it's
  parked locally, and offer to flush the inbox to GitHub next time.
- **Issues disabled or repo moved** — stop and say so; don't file against a guessed repo.
- **The "bug" is actually intended behavior** — say so in one sentence with the doc line that says so,
  and ask whether to file it as an `enhancement` instead. Don't file a bug you believe is wrong.
