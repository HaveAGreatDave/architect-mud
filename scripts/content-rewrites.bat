@echo off
REM ============================================================================
REM  content-rewrites.bat - replay the one-shot CONTENT FILE rewrites.
REM
REM    scripts\content-rewrites.bat              dry run, prints what each would touch
REM    scripts\content-rewrites.bat --write      actually rewrite the files
REM
REM  WHEN DO YOU RUN THIS?  Almost certainly never, and that is the point of
REM  writing it down. If every script below prints 0 files, content/ already
REM  holds their output and there is nothing to do. That IS the steady state.
REM
REM  There is no prod target and there will never be one. Passing "prod" is a
REM  hard error a few lines down, because the mistake this file exists to
REM  prevent is somebody reading "one-shot" and pointing it at the live
REM  database. Nothing here has a query() in it. They rewrite JSON under
REM  content/ and stop.
REM
REM  THE THREE ONE-SHOT FILES, AND WHICH ONE YOU ACTUALLY WANT
REM
REM    oneshots.bat           DB. CONVERGING. Run after almost any deploy.
REM                           Runtime state the content tree structurally
REM                           cannot carry - vendor shelves, ATM units, lit
REM                           fixtures, struck cards. Safe to re-run forever.
REM
REM    oneshots-pending.bat   DB. CLAMPS. Run ONCE against prod after the
REM                           deploy that needs them, then delete the entries.
REM                           An empty file is the correct steady state.
REM
REM    content-rewrites.bat   FILES. Never a database, never prod. The record
REM    (this one)             of how content/ got the text it has. Useful for
REM                           exactly two things: replaying a pass onto a
REM                           checkout that predates it, and proving a pass is
REM                           idempotent by watching it report 0.
REM
REM  WHY THESE ARE NOT IN THE OTHER TWO FILES
REM  oneshots-pending.bat already says so in its own header: a script that
REM  writes content FILES has no business being pointed at prod, because the
REM  files are committed and the CODEX deploy imports them. Running a rewrite
REM  at prod would be doing by hand, badly, the job the deploy already did.
REM
REM  WHAT DOES NOT BELONG HERE
REM  A rewrite that appends, accumulates, or edits by position rather than by
REM  exact match. Everything listed below finds a specific string and replaces
REM  it, so once it has run the string is gone and a second run matches
REM  nothing. A script that cannot report 0 on a second run is not idempotent,
REM  and putting it in a file whose whole purpose is "safe to re-run" would
REM  make this the trap it was written to avoid. Run that one by hand, once,
REM  and leave it out.
REM
REM  AFTER --write: run  npm run content:lint,  check  git diff --stat,  then
REM  npm run content:import  to bring the local DB in line with the files.
REM ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set "WRITE="
for %%A in (%*) do (
  if /i "%%~A"=="--write" set "WRITE=--write"
  if /i "%%~A"=="prod" (
    echo [ERROR] There is no prod target here, and there never will be.
    echo         These scripts rewrite files under content/. The files are
    echo         committed and the CODEX deploy imports them - that IS how they
    echo         reach production. For database one-shots use scripts\oneshots.bat
    echo         ^(converging^) or scripts\oneshots-pending.bat ^(run once^).
    exit /b 1
  )
)

REM The splash is drawn by node, not by echo lines here - cmd.exe decodes a
REM batch file with whatever codepage is active when it reads each line, so
REM block glyphs embedded in a .bat mangle before any chcp can fix them.
node scripts/banner.mjs

echo.
if defined WRITE (
  echo === Replaying content rewrites - FILES WILL BE WRITTEN ===
) else (
  echo === Dry run - nothing will be written. Pass --write to apply. ===
)
set "FAILED="

REM --- the plain-writing pass, 2026-08-25 ------------------------------------
REM Applies docs/reference/plain-writing.md to the prose with the widest reach:
REM two waste texts covering 3,492 tiles, the Nave, three item strings that put
REM feelings in the player, and four NPC lines sharing a frame nineteen NPCs had.
call :run "content/prose-standard-pass.mjs"   "plain-writing pass (waste, Nave, soylent, 4 NPC lines)"

echo.
if defined FAILED (
  echo === FINISHED WITH FAILURES:!FAILED! ===
  exit /b 1
)
if defined WRITE (
  echo === Done. Now: npm run content:lint, git diff --stat, npm run content:import ===
) else (
  echo === Done. 0 files everywhere means content/ is already up to date. ===
)
exit /b 0

REM ---------------------------------------------------------------------------
:run
set "SCRIPT=%~1"
echo.
echo  -- %~2
echo     node scripts/%SCRIPT% %WRITE%
node scripts/%SCRIPT% %WRITE%
if errorlevel 1 (
  echo     [FAILED] %SCRIPT%
  set "FAILED=!FAILED! %SCRIPT%"
)
exit /b 0
