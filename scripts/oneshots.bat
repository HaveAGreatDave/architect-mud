@echo off
REM ============================================================================
REM  oneshots.bat - run the outstanding one-shot data transformations in order.
REM
REM    scripts\oneshots.bat              local DB (DATABASE_URL from .env)
REM    scripts\oneshots.bat prod         production (needs .env.prod), confirms first
REM    scripts\oneshots.bat prod --repairs       ALSO run the one-time repairs
REM    scripts\oneshots.bat prod --forgive-xp    also writes off negative XP debt
REM    scripts\oneshots.bat prod --dry-run       print what would run, touch nothing
REM
REM  WHY THIS FILE EXISTS
REM  The CODEX deploy is additive (INSERT ... ON CONFLICT DO NOTHING), so it can
REM  create rows but can never rewrite an existing one - and runtime-class columns
REM  (npcs.zone_id, furniture.light_on, npcs.vendor_stock) are excluded from
REM  content files entirely. Those two gaps are what every script below fills.
REM  CI never runs any of them. See CLAUDE.md "Running a one-shot against prod".
REM
REM  TWO TIERS, AND THE DISTINCTION MATTERS
REM  Everything here is idempotent in the narrow sense - run it twice, same result.
REM  But idempotent is NOT the same as safe-to-keep-running, and conflating the two
REM  is how a convenience script quietly becomes a wrecking ball:
REM
REM    ROUTINE  converges on the right answer no matter how often it runs, and
REM             stays correct as the world grows. Safe after any deploy. Default.
REM
REM    REPAIRS  CLAMPS state back to a decision made on one particular day. Run it
REM             once and it fixes the thing; run it a year later and it re-asserts
REM             a fact the world has moved past - deleting spawns you have since
REM             authored, dragging an NPC back out of her new home, flipping a
REM             shop's lights back on after a player deliberately killed them.
REM             Opt in with --repairs, and DELETE the line once it has run.
REM
REM  If you write a one-shot, decide which tier it is before adding it. When in
REM  doubt it is a REPAIR - that is the tier that fails safe.
REM ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set "TARGET=local"
set "ENVFLAG="
set "FORGIVE_XP="
set "DRYRUN="
set "REPAIRS="

for %%A in (%*) do (
  if /i "%%~A"=="prod"         set "TARGET=prod"
  if /i "%%~A"=="--forgive-xp" set "FORGIVE_XP=1"
  if /i "%%~A"=="--dry-run"    set "DRYRUN=1"
  if /i "%%~A"=="--repairs"    set "REPAIRS=1"
)

REM The splash is drawn by node, not by echo lines here. cmd.exe decodes a batch
REM file with whatever codepage is active when it READS each line, so block glyphs
REM embedded in a .bat mangle before the chcp meant to fix them ever runs. Keeping
REM this file pure ASCII sidesteps that entirely - see scripts/banner.mjs.
node scripts/banner.mjs

if "%TARGET%"=="prod" (
  if not exist ".env.prod" (
    echo [ERROR] .env.prod not found. It holds the production DATABASE_URL and is
    echo         git-ignored, so it never ships - create it before running prod.
    exit /b 1
  )
  set "ENVFLAG=--env-file=.env.prod"
)

if "%TARGET%"=="prod" if not defined DRYRUN (
  echo.
  echo  ####################################################################
  echo  #  These scripts will MUTATE THE LIVE PRODUCTION DATABASE.         #
  echo  #  Some of them DELETE rows ^(spawns, playlist entries^).            #
  echo  #  CI backs prod up before each deploy; there is no backup here.   #
  echo  ####################################################################
  echo.
  set /p "CONFIRM=Type  yes  to continue: "
  if /i not "!CONFIRM!"=="yes" (
    echo Aborted - nothing ran.
    exit /b 1
  )
)

echo.
if defined DRYRUN (
  echo === DRY RUN - target %TARGET% - nothing will be executed ===
) else (
  echo === Running one-shots against: %TARGET% ===
)
set "FAILED="

REM ===== ROUTINE - converge on the right answer, safe after any deploy ========
REM Vendor shelves, ATM units, authored light fixtures. seed-runtime is careful:
REM it only lights fixtures the power sim has NEVER touched, so it can't override
REM a switch a player threw. That care is exactly what makes it routine.
call :run "content/seed-runtime.mjs"       "runtime state (vendors, ATMs, lights)"

REM Sets map_id on four zones that imported with NULL. Converges; a zone that
REM already has the right map is untouched.
call :run "prologue-own-map.mjs"           "prologue zones onto map_prologue"

REM Deletes four playlist rows BY ID that were hand-made on prod and never
REM exported, so the git-diff deletion pass cannot see them. Once they are gone
REM this is a permanent no-op - it can never match a row authored later.
call :run "fix-playlist-drift.mjs"         "drop prod-only playlist rows shadowing KSAB"

REM Runs Dell Fry's sourced-container restock so Ration Nine's chiller is stocked
REM now rather than at the next 24h tick. Restock is what the game does anyway.
call :run "seed-ration9-stock.mjs"         "stock Ration Nine's chiller + frozen well"

REM ===== REPAIRS - clamp state to a past decision; --repairs, then delete =====
if not defined REPAIRS (
  echo.
  echo  -- skipped 6 REPAIR scripts ^(pass --repairs to include^)
  echo     They re-assert decisions from a specific day. Read the tier note at
  echo     the top of this file before running them on a world that has moved on.
  goto :after_repairs
)

REM Mass DELETE of zone_spawns. Matches a content commit that removed the spawn
REM files; the additive deploy could never delete the prod rows. DANGER: it does
REM not target ids, it deletes by RULE (everything but the Under and the
REM clonejackers) - so any surface spawn authored after today dies here too.
call :run "purge-surface-spawns.mjs"       "de-fang the surface (deleted spawn files)"

REM Rewrites Deadball's day mask 95 -> 85 to free Tue/Thu 18:00. Re-authoring the
REM schedule later and then running this would silently stomp it back.
call :run "cluster-puck-schedule.mjs"      "hand Tue/Thu 18:00 to Cluster Puck"

REM npcs.zone_id is runtime, so a content move leaves the body behind. Both of
REM these FORCE an NPC to a tile - fine today, wrong the moment a story moves her.
call :run "relocate-fs-dispatcher.mjs"     "un-strand the Franchise Strip dispatcher"
call :run "rehome-vale-tenement.mjs --apply" "move Sgt Vale out of a player's apartment"

REM Sets light_on AND light_on_intended = 1. Unlike seed-runtime it does NOT check
REM whether the sim has touched the fixture, so re-running overrides a player who
REM deliberately switched these off.
call :run "lights-kitchenware.mjs"         "light Tine and Temper (kitchenware shop)"

REM Overwrites vendor_stock wholesale from the catalogue - re-running wipes
REM whatever Velk has since sold or restocked and resets her to a full floor.
call :run "fill-velk-shelf.mjs"            "put Velk's whole showroom floor out"

:after_repairs

REM --- Policy, not repair: opt in explicitly ---------------------------------
REM Lifts players carrying negative net XP after a stat retune up to exactly 0.
REM That debt is real and deliberate - writing it off is a decision, so it only
REM runs when you ask for it.
if defined FORGIVE_XP (
  call :run "zero-negative-xp.mjs"         "forgive negative XP debt"
) else (
  echo  -- skipped  zero-negative-xp.mjs  ^(pass --forgive-xp to include^)
)

echo.
if defined FAILED (
  echo === FINISHED WITH FAILURES:!FAILED! ===
  echo Everything here is idempotent - fix the cause and re-run the whole file.
  exit /b 1
)
echo === All one-shots completed against %TARGET%. ===
exit /b 0

REM ---------------------------------------------------------------------------
:run
set "SCRIPT=%~1"
echo.
echo  -- %~2
echo     node %ENVFLAG% scripts/%SCRIPT%
if defined DRYRUN exit /b 0
node %ENVFLAG% scripts/%SCRIPT%
if errorlevel 1 (
  echo     [FAILED] %SCRIPT%
  set "FAILED=!FAILED! %SCRIPT%"
)
exit /b 0
