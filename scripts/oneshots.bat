@echo off
REM ============================================================================
REM  oneshots.bat - run the outstanding one-shot data transformations in order.
REM
REM    scripts\oneshots.bat              local DB (DATABASE_URL from .env)
REM    scripts\oneshots.bat prod         production (needs .env.prod), confirms first
REM    scripts\oneshots.bat prod --forgive-xp    also writes off negative XP debt
REM    scripts\oneshots.bat prod --dry-run       print what would run, touch nothing
REM
REM  WHY THIS FILE EXISTS
REM  Two gaps in the CODEX deploy, and they are narrower than they look.
REM
REM    1. RUNTIME COLUMNS. npcs.zone_id, furniture.light_on, npcs.vendor_stock,
REM       game_tables, struck trading cards - state the content tree does not
REM       carry at all, because it is not authored. No file, so no deploy.
REM    2. DELETIONS the git-diff pass cannot see - a row hand-made on prod and
REM       never exported has no file to remove, so nothing tells the import it
REM       is gone.
REM
REM  What is NOT a gap: rewriting an existing row. This header used to say the
REM  import was additive (INSERT ... ON CONFLICT DO NOTHING) and "can never
REM  rewrite an existing one". That is wrong, and believing it sent two
REM  unnecessary scripts at prod on 2026-08-02. For any table with non-PK
REM  columns the import is ON CONFLICT (pk) DO UPDATE SET <every file column>
REM  (scripts/content/import.mjs - DO NOTHING is only the branch for PK-only
REM  tables). Because a WHOLE COLUMN is replaced, editing a content file is
REM  enough to change or even REMOVE a JSONB key: dropping flags.utility_room
REM  from content/zones/*.json cleared it from 79 prod tiles with no script.
REM
REM  So before adding anything here, ask whether the new value can be derived
REM  from the files. If it can, edit the files - that IS the deploy. A one-shot
REM  is for state the files do not carry, or a table the pipeline does not own.
REM  CI never runs any of them. See CLAUDE.md "Running a one-shot against prod".
REM
REM  WHAT BELONGS IN HERE - THE ONE TEST
REM  Idempotent is NOT the same as safe-to-keep-running, and conflating the two is
REM  how a convenience script quietly becomes a wrecking ball. Only scripts that
REM  CONVERGE belong here: run it a year from now on a world that has grown, and it
REM  still arrives at the right answer.
REM
REM  A script that CLAMPS state back to a decision made on one particular day does
REM  NOT belong here, however idempotent it looks. Six of those lived in this file
REM  until 2026-07-27 - purging spawns by RULE (which would delete any surface spawn
REM  authored later), forcing an NPC's tile (dragging her back out of a new home),
REM  setting light_on_intended unconditionally (overriding a player who deliberately
REM  killed the lights). They had all landed on prod, and the content tree now
REM  produces their result directly, so they were removed rather than kept "just in
REM  case". Run a clamp by hand, once, and delete it. Never add one to this list.
REM
REM  Note how content/seed-runtime passes the test where lights-kitchenware did not:
REM  it only lights fixtures the power sim has NEVER touched (light_on_intended IS
REM  NULL), so it cannot overwrite a decision anyone has since made. That care is
REM  the whole difference.
REM ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set "TARGET=local"
set "ENVFLAG="
set "FORGIVE_XP="
set "DRYRUN="

for %%A in (%*) do (
  if /i "%%~A"=="prod"         set "TARGET=prod"
  if /i "%%~A"=="--forgive-xp" set "FORGIVE_XP=1"
  if /i "%%~A"=="--dry-run"    set "DRYRUN=1"
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
  echo  #  One of them DELETES rows ^(four shadow playlist entries^).        #
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

REM Vendor shelves, ATM units, authored light fixtures - the runtime state the
REM content deploy structurally cannot carry. Needed after almost any deploy.
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

REM Deletes retired item rows BY ID. The deploy's own deletion pass covers files
REM that were committed and then removed, but it does NOT check whether a player
REM is holding one - this does, and refuses rather than stranding an inventory
REM row. Converges: a fixed id list of dead content, so it is a permanent no-op
REM once they are gone and can never match an item authored later.
call :run "oneshots/retire-items.mjs"      "delete retired item rows (safe: skips owned)"

REM Cuts the NPC + enemy trading cards for the open series. They are DERIVED from
REM content, so they are runtime rows the deploy structurally cannot carry.
REM Converges: strikeSeries skips any subject already carded, so a later run only
REM cards the NPCs and enemies added since. It can never restat or rewrite a card.
call :run "oneshots/strike-card-series.mjs" "strike NPC + enemy trading cards"

REM Returns NPCs left standing somewhere they cannot reach their own workplace
REM from - the residue of a home_zone reassignment (npcs.zone_id is runtime, so
REM the deploy cannot carry it). Converges: it asks the live pathfinder rather
REM than forcing tiles from a list, so an NPC who has moved somewhere new and can
REM still get to work is never touched. A no-op once the world is consistent.
call :run "oneshots/reconcile-stranded-npcs.mjs" "return NPCs stranded away from work"

REM Registers the Solenne chess board. `game_tables` is runtime-classified and is
REM not carried by content:import, so the row only exists where this has run -
REM without it the chairs answer "No game table here." Converges: it refreshes the
REM config and never touches a game in progress.
call :run "seed-solenne-chess.mjs"         "register the Solenne chess table"

REM Deletes the superseded drug_transforms rows BY ID - the old hedged text ("a
REM large animal pretending to be a bed") the rewritten pool replaces. Additive
REM deploys cannot remove a row. Converges: a fixed id list, permanent no-op once
REM they are gone.
call :run "drop-retired-transforms.mjs"    "drop retired drug transform rows"

REM Stands up trailers hitched to a truck row that no longer exists - the residue
REM of selling a tractor with a box on the pin, back when that was a bare DELETE.
REM Such a row is unreachable, not just mislabelled: no parked_zone, so it is in
REM no yard, and a towed_by, so every hitch and every sale refuses it. Converges:
REM the join can only match a trailer whose truck is GONE, so a box genuinely on
REM a fifth wheel is invisible to it and this is a no-op once none are left.
call :run "oneshots/repark-orphan-trailers.mjs" "stand up trailers hitched to sold trucks"

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
