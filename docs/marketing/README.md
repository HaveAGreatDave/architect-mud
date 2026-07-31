# marketing/

Player-facing promotional material. **Not** world content, not engine docs — nothing
in here is loaded by the game, imported by the CODEX pipeline, or read at runtime.
It exists so the copy lives somewhere versioned instead of in someone's downloads.

| File | What it is |
| --- | --- |
| [architect-ad.html](architect-ad.html) | Full-page magazine advert. Self-contained, no external assets, opens straight in a browser. |

## Conventions

- **Self-contained.** Inline the CSS, embed any image as a data URI. These get emailed,
  pasted into things, and opened off a USB stick — a file that needs a sibling asset is
  a file that arrives broken.
- **Claims must be true.** An earlier draft of the ad said "no graphics", which is both
  false (`client/` is the largest body of code in the repo) and self-contradicting two
  columns later, where it boasts about volumetric cloud. If a line asserts something
  about the game, it should survive someone checking it.
- **Lore copy comes from the Codex** ([plugins/tablet/codex/chapters.js](../plugins/tablet/codex/chapters.js)),
  which is the actual in-game text, so the pitch and the game agree. Note that Volume II
  is **locked and earned in play** — quoting it in marketing spoils chapters a player is
  meant to unlock. The current ad does quote it. That's a live judgement call, not an
  oversight.
- **The URL is [architectgame.net](https://www.architectgame.net).** Don't invent one; a
  draft of this ad shipped a made-up domain before it was caught.
