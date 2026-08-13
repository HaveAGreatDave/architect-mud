@echo off
REM ============================================================================
REM  oneshots-pending.bat - the BY-HAND one-shots outstanding from recent work.
REM
REM    scripts\oneshots-pending.bat              local DB (DATABASE_URL from .env)
REM    scripts\oneshots-pending.bat prod         production (needs .env.prod), confirms first
REM    scripts\oneshots-pending.bat prod --dry-run   print what would run, touch nothing
REM
REM  WHY THIS IS A SEPARATE FILE FROM oneshots.bat
REM  Because oneshots.bat has ONE rule and both scripts below break it. That file
REM  holds only CONVERGING scripts - run it a year from now on a world that has
REM  grown and it still arrives at the right answer. A script that CLAMPS state
REM  back to a decision made on one particular day does not belong there however
REM  idempotent it looks; six of those were purged from it on 2026-07-27 for
REM  exactly that reason, and its header says so in as many words.
REM
REM  Both of these are that kind of script. They are correct TODAY, against a
REM  world that has just taken a specific deploy, and they are meant to be run
REM  once and then forgotten - NOT wired into the routine post-deploy pass. This
REM  file exists so "run the outstanding ones" is a single command instead of a
REM  memory test, and so that fact is written down next to them rather than in a
REM  chat log.
REM
REM  AFTER YOU HAVE RUN THIS AGAINST PROD, DELETE THE ENTRIES. An empty
REM  pending file is the correct steady state. If you find three months of
REM  accumulated clamps in here, the file has quietly become the thing it was
REM  written to avoid.
REM
REM  WHAT IS DELIBERATELY NOT IN HERE
REM    - build-terminus / build-deadwater / build-scarletwastes / the Reach moves
REM      and bake-terminus-markers / demote-thornwarren-shells. Every one of those
REM      writes content FILES, and the files are already committed - the CODEX
REM      deploy imports them. Running a world builder at prod would duplicate work
REM      the deploy already did.
REM    - every scripts/*-smoke.mjs and the dom stubs. Test tooling, run by
REM      pretest:regress, nothing to do with a database.
REM    - lights-truck-depots.mjs, which was written on 2026-08-13 and deleted the
REM      same day: lights-latched-off.mjs below already covers the depots BY NAME
REM      and does it more safely (it is scoped to rooms where nothing at all is
REM      lit and whose power is currently fine, so it cannot stomp a bay somebody
REM      darkened on purpose). Two scripts for one bug is how you end up with six.
REM ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set "TARGET=local"
set "ENVFLAG="
set "DRYRUN="

for %%A in (%*) do (
  if /i "%%~A"=="prod"      set "TARGET=prod"
  if /i "%%~A"=="--dry-run" set "DRYRUN=1"
)

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
  echo  #  unbake-mutation-stats REWRITES players.stat_* - read the note   #
  echo  #  about deploy ORDER below before you answer yes.                 #
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
  echo === Running PENDING one-shots against: %TARGET% ===
)
set "FAILED="

REM ---------------------------------------------------------------------------
REM  1. THE MUTATION UNBAKE - and it is the one with a deploy ORDER attached.
REM
REM  Until 2026-08 grantMutation added a mutation's stat_modifiers straight into
REM  players.stat_*, and the rework derives them at read time instead. Both at
REM  once means every mutated character's stats are counted TWICE, silently.
REM
REM  RUN THIS BEFORE THE MUTATION CODE SERVES TRAFFIC. Script first costs a few
REM  minutes with the bonus missing and self-heals the instant the deploy lands;
REM  code first is silent double-counting for everyone. If the mutation deploy is
REM  ALREADY live, run it now anyway - it is still the correction, it has just
REM  been wrong in the meantime.
REM
REM  It cannot be a content edit: the values sit in players.stat_*, a class:player
REM  table the pipeline never writes, and computing the correction needs live
REM  player_mutations joined against mutations.stat_modifiers. Neither is a file.
REM
REM  Safe to re-run: guarded per player by the `mutations_unbaked` flag, written
REM  in the same transaction as the correction. A second run is a no-op, and so
REM  is a run against a fresh database.
call :run "unbake-mutation-stats.mjs"  "unbake baked mutation stat modifiers"

REM ---------------------------------------------------------------------------
REM  2. RELIGHT THE ROOMS THAT LATCHED OFF - includes both truck depots.
REM
REM  light_on / light_on_intended are runtime columns the content pipeline cannot
REM  carry, so an imported fixture lands OFF and seed-runtime switches it on
REM  afterwards - gated on `light_on_intended IS NULL` so it can never stomp a
REM  switch a player actually threw. That gate is a RACE: if a live server takes a
REM  power tick before seed-runtime runs, the tick backfills intended = 0 and the
REM  fixture becomes indistinguishable from one somebody turned off on purpose.
REM  seed-runtime skips it forever and the room is dark for good.
REM
REM  This is the general fix, and it is why there should never be another
REM  lights-<area>.mjs written again. It sweeps two cases: rooms where every
REM  fixture has both columns at 0, and rooms with stranded brownout intent (the
REM  restore is edge-triggered, so a supply fixed while the server was down never
REM  gets its edge). The truck depots are the second case, called out by name in
REM  the script - junction boxes with no city plant behind them.
REM
REM  Safe because it is scoped to rooms where NOTHING is lit and whose power is
REM  currently fine. Somebody who kills one light in a room with two leaves the
REM  other on and is never touched.
call :run "lights-latched-off.mjs"     "relight interiors that latched dark (incl. depots)"

echo.
if defined FAILED (
  echo === FINISHED WITH FAILURES:!FAILED! ===
  echo Both scripts above are re-runnable - fix the cause and run the file again.
  exit /b 1
)
echo === Pending one-shots completed against %TARGET%. ===
echo.
echo  Once these have run against PROD, delete their entries from this file.
echo  An empty pending list is the correct steady state.
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
