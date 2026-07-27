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
REM  The CODEX deploy is additive (INSERT ... ON CONFLICT DO NOTHING), so it can
REM  create rows but can never rewrite an existing one - and runtime-class columns
REM  (npcs.zone_id, furniture.light_on, npcs.vendor_stock) are excluded from
REM  content files entirely. Those two gaps are what every script below fills.
REM  CI never runs any of them. See CLAUDE.md "Running a one-shot against prod".
REM
REM  Everything here is IDEMPOTENT - re-running is a no-op. That is the entry
REM  requirement for being in this list. If you write a one-shot that is not safe
REM  to run twice, do NOT add it here; run it by hand.
REM
REM  MAINTENANCE: once a script has run against prod AND you are confident no
REM  fresh DB will ever need it again, delete its line. This list is meant to be
REM  short - it is a to-do queue, not an archive.
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

REM Plain ASCII on purpose: no box-drawing glyphs, so this file cannot mojibake
REM if an editor re-saves it as Windows-1252 (see the UTF-8 rule in CLAUDE.md).
echo.
echo   ###  ####   ###  #   # ### ##### #####  ###  #####
echo  #   # #   # #   # #   #  #    #   #     #   #   #
echo  ##### ####  #     #####  #    #   ###   #       #
echo  #   # #  #  #   # #   #  #    #   #     #   #   #
echo  #   # #   #  ###  #   # ###   #   ##### ###     #
echo.
echo  +-----------------------------------------------------------+
echo  ^|  A R C H I T E C T  ::  ONE-SHOT RUNNER                   ^|
echo  ^|  post-deploy data transformations the CODEX deploy cannot ^|
echo  ^|  perform on its own. All idempotent. CI never runs these. ^|
echo  +-----------------------------------------------------------+

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

REM --- Runtime state the content deploy structurally cannot carry -------------
REM Vendor shelves, ATM units, authored light fixtures. Safe and needed after
REM almost any deploy; everything else below is a specific historical fix.
call :run "content/seed-runtime.mjs"       "runtime state (vendors, ATMs, lights)"

REM --- Rows the additive deploy cannot delete or rewrite ----------------------
call :run "purge-surface-spawns.mjs"       "de-fang the surface (deleted spawn files)"
call :run "prologue-own-map.mjs"           "prologue zones onto map_prologue"
call :run "fix-playlist-drift.mjs"         "drop prod-only playlist rows shadowing KSAB"
call :run "cluster-puck-schedule.mjs"      "hand Tue/Thu 18:00 to Cluster Puck"

REM --- npcs.zone_id is runtime, so content moves leave the body behind --------
call :run "relocate-fs-dispatcher.mjs"     "un-strand the Franchise Strip dispatcher"
call :run "rehome-vale-tenement.mjs --apply" "move Sgt Vale out of a player's apartment"

REM --- Shelves and fixtures that would otherwise wait on a 24h tick -----------
call :run "lights-kitchenware.mjs"         "light Tine and Temper (kitchenware shop)"
call :run "seed-ration9-stock.mjs"         "stock Ration Nine's chiller + frozen well"
call :run "fill-velk-shelf.mjs"            "put Velk's whole showroom floor out"

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
