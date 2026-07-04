# 🌅 Morning, Akerson — get Relay + Cyd's latest

> *Sleepy Akerson —*
> *Relay hums, Cyd's night flows in*
> *coffee, then we build*

**One-time thing to understand:** Relay is the tool that syncs everything, but it can't
install *itself*. So the very first time you do one plain `git pull` by hand. After that,
Relay does the work.

## Do these in order

**1. Open a terminal in the architect repo folder.**
Wherever you cloned it — the folder with `package.json` in it.

**2. Get Cyd's work (plain git — one time):**
```
git pull
```
- If it just works, great — move on.
- If it says *"your local changes would be overwritten"*, you have unsaved edits. Do this instead:
  ```
  git stash
  git pull
  git stash pop
  ```
  (`stash` tucks your changes aside, `stash pop` puts them back after the pull.)

**3. Refresh dependencies (quick, safe):**
```
npm install
```

**4. Rebuild your local world DB from Cyd's latest content:**
```
npm run db:setup-local
```
⚠️ This **wipes and rebuilds your local `architect_dev` database** from the shared seed —
that's expected. Your login/character is local-only, so **you'll re-register a character
in-game** afterward. (Do this via the command, not Relay, this one time — Relay's "Sync"
only rebuilds when a *fresh* pull changes the seed, and you already pulled in step 2.)

**5. Start Relay:**
```
npm run relay
```
A browser tab opens at **http://localhost:4599**. That's Relay.

## Now you're in Relay — what to click

- **🏚 Launch server** — starts the Architect game server on `localhost:3000`. Wait ~2 sec;
  the light turns green ("Architect server running").
- **▶ Architect** — opens the game. **⚙ Devpanel** — opens the dev panel.
- **Recent activity** (bottom card) — you should see **Cyd's commits from last night**
  listed. That's how you confirm the sync worked.
- **Pre-flight panel** (top) — all the important lights: DB is local, tracking main, up to
  date. Glance at it; green is good.

## From tomorrow on, your daily loop is just:
```
npm run relay
```
Then in Relay: **⇩ Sync content** (pulls Cyd's latest + rebuilds DB if the world changed) →
**🏚 Launch server** → build/play. No more hand-typed git for normal days.

## If something's weird
- **"Port 3000 already in use"** when launching → an old server is stuck. Run
  `npm run kill:orphans`, then Launch again.
- **Relay page won't open / port 4599 busy** → close the old Relay tab/terminal, re-run
  `npm run relay`.
- **Recent activity doesn't show Cyd's commits** → the pull didn't land. Re-run `git pull`
  and check for an error message.
- **Optional nicety:** `npm run hooks:install` once — it nudges you to sync whenever a pull
  brings new world content.

*Everything Relay does is just the same `git` / `npm` commands with a safety net — nothing
magic, nothing that can quietly break the live game.*
